-- ============================================================================
-- MIGRATION: FIX_ACADEMIC_DECIMAL_MANUAL_GRADING.sql
-- MỤC TIÊU:
-- 1. Hỗ trợ chấm điểm thủ công số thập phân (0.5, 1.5, 2.75, ...) cho câu tự luận / nộp file.
-- 2. Nâng cấp kiểu dữ liệu 3 cột điểm thủ công & tổng điểm sang NUMERIC(8,2) với USING cast tường minh.
-- 3. Cập nhật RPC grade_academic_submission loại bỏ ràng buộc số nguyên (INT).
-- 4. Bao bọc Transaction an toàn với lock_timeout & statement_timeout.
-- 5. Bảo toàn 100% Class Ownership Model, Phân quyền, Thưởng sao (INT) & Audit.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ----------------------------------------------------------------------------
-- PHẦN 1: NÂNG CẤP KIỂU DỮ LIỆU TỐI THIỂU CHO 3 CỘT ĐIỂM SỐ (EXPLICIT CAST)
-- ----------------------------------------------------------------------------

ALTER TABLE public.academic_submission_answers
  ALTER COLUMN points_earned
  TYPE NUMERIC(8,2)
  USING points_earned::NUMERIC(8,2);

ALTER TABLE public.academic_submissions
  ALTER COLUMN manual_score
  TYPE NUMERIC(8,2)
  USING manual_score::NUMERIC(8,2),
  ALTER COLUMN total_score
  TYPE NUMERIC(8,2)
  USING total_score::NUMERIC(8,2);

-- ----------------------------------------------------------------------------
-- PHẦN 2: CẬP NHẬT RPC GRADE_ACADEMIC_SUBMISSION CHUẨN NUMERIC
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.grade_academic_submission(
  p_submission_id UUID,
  p_manual_grades JSONB,
  p_teacher_feedback TEXT,
  p_request_revision BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_teacher_id UUID;
  v_role TEXT;
  v_sub RECORD;
  v_ex RECORD;
  v_grade_item JSONB;
  v_q_type TEXT;
  v_q_points NUMERIC;
  v_item_points NUMERIC;
  v_total_manual NUMERIC := 0;
  v_new_status TEXT;
  v_final_total NUMERIC := 0;
  v_ratio FLOAT := 0.0;
  v_stars_to_award INT := 0;
  v_updated_rows INT;
  v_seen_q_ids UUID[] := ARRAY[]::UUID[];
  v_curr_q_id UUID;
  v_sub_ans_exists BOOLEAN := FALSE;
  v_total_subjective_count INT := 0;
  v_graded_subjective_count INT := 0;
  v_num_val NUMERIC;
  v_has_permission BOOLEAN := FALSE;
BEGIN
  -- =========================================================================
  -- PHASE 1: ZERO-DML VALIDATION PHASE
  -- =========================================================================
  v_teacher_id := (SELECT auth.uid());
  IF v_teacher_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_teacher_id;

  SELECT * INTO v_sub FROM public.academic_submissions WHERE id = p_submission_id FOR UPDATE;
  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bài nộp không tồn tại.');
  END IF;

  -- ALLOW-LIST CHỈ CHẤM SUBMITTED HOẶC PENDING_MANUAL_GRADE
  IF v_sub.status NOT IN ('submitted', 'pending_manual_grade') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Chỉ được chấm bài nộp ở trạng thái submitted hoặc pending_manual_grade.');
  END IF;

  SELECT * INTO v_ex FROM public.academic_exercises WHERE id = v_sub.exercise_id;

  -- KIỂM TRA PHÂN QUYỀN CHẤM BÀI THEO CLASS OWNERSHIP MODEL:
  -- Admin HOẶC GV hiện tại quản lý lớp mà bài tập và học sinh thuộc về
  IF v_role = 'admin' OR app_private.is_admin() THEN
    v_has_permission := TRUE;
  ELSIF EXISTS (
    SELECT 1 FROM public.academic_exercise_assignments a
    JOIN public.class_members cm ON cm.class_id = a.class_id
    WHERE a.exercise_id = v_sub.exercise_id
      AND cm.student_id = v_sub.student_id
      AND app_private.teacher_owns_class(a.class_id)
  ) THEN
    v_has_permission := TRUE;
  ELSIF v_ex.class_id IS NOT NULL
    AND app_private.teacher_owns_class(v_ex.class_id)
    AND EXISTS (
      SELECT 1 FROM public.class_members cm
      WHERE cm.class_id = v_ex.class_id AND cm.student_id = v_sub.student_id
    ) THEN
    v_has_permission := TRUE;
  END IF;

  IF NOT v_has_permission THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn không có quyền chấm bài nộp này (Bạn không phụ trách lớp học của học sinh).');
  END IF;

  IF p_manual_grades IS NOT NULL THEN
    IF jsonb_typeof(p_manual_grades) != 'array' THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Cấu trúc điểm chấm p_manual_grades phải là một mảng JSON.');
    END IF;

    FOR v_grade_item IN SELECT * FROM jsonb_array_elements(p_manual_grades)
    LOOP
      BEGIN
        v_curr_q_id := (v_grade_item->>'question_id')::UUID;
      EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: question_id trong p_manual_grades không đúng định dạng UUID.');
      END;

      IF v_curr_q_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: question_id không được để trống.');
      END IF;

      IF v_curr_q_id = ANY(v_seen_q_ids) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Trùng lặp question_id ' || v_curr_q_id::text || ' trong danh sách chấm điểm.');
      END IF;
      v_seen_q_ids := array_append(v_seen_q_ids, v_curr_q_id);

      SELECT question_type, points INTO v_q_type, v_q_points
      FROM public.academic_exercise_questions
      WHERE id = v_curr_q_id AND exercise_id = v_sub.exercise_id;

      IF v_q_type IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Câu hỏi ' || v_curr_q_id::text || ' không thuộc bài tập này.');
      END IF;

      IF v_q_type NOT IN ('essay', 'image_upload', 'file_upload') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Chỉ được chấm điểm thủ công cho câu hỏi tự luận hoặc nộp file.');
      END IF;

      SELECT EXISTS (
        SELECT 1 FROM public.academic_submission_answers
        WHERE submission_id = p_submission_id AND question_id = v_curr_q_id
      ) INTO v_sub_ans_exists;

      IF NOT v_sub_ans_exists THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Học sinh chưa nộp câu trả lời cho câu hỏi ' || v_curr_q_id::text || '.');
      END IF;

      -- VALIDATION ĐIỂM SỐ NUMERIC (HỖ TRỢ ĐIỂM SỐ NGUYÊN & SỐ THỰC 0.5, 1.5, 2.75...)
      BEGIN
        v_num_val := (v_grade_item->>'points_earned')::NUMERIC;
      EXCEPTION WHEN OTHERS THEN
        v_num_val := NULL;
      END;

      IF v_num_val IS NULL OR v_num_val < 0 OR v_num_val > COALESCE(v_q_points, 10) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Điểm chấm cho câu ' || v_curr_q_id::text || ' không hợp lệ, phải từ 0 đến ' || COALESCE(v_q_points, 10)::text || '.');
      END IF;

      v_item_points := v_num_val;
      v_total_manual := v_total_manual + v_item_points;
      v_graded_subjective_count := v_graded_subjective_count + 1;
    END LOOP;
  END IF;

  SELECT COUNT(*) INTO v_total_subjective_count
  FROM public.academic_exercise_questions
  WHERE exercise_id = v_sub.exercise_id AND question_type IN ('essay', 'image_upload', 'file_upload');

  IF NOT p_request_revision THEN
    IF v_graded_subjective_count < v_total_subjective_count THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn phải chấm đầy đủ điểm cho tất cả câu hỏi tự luận / nộp file trước khi chuyển trạng thái Đã Chấm (graded).');
    END IF;
  END IF;

  IF p_request_revision THEN
    v_new_status := 'revision_requested';
  ELSE
    v_new_status := 'graded';
  END IF;

  -- =========================================================================
  -- PHASE 2: ATOMIC DML EXECUTION PHASE
  -- =========================================================================
  IF p_manual_grades IS NOT NULL AND jsonb_array_length(p_manual_grades) > 0 THEN
    FOR v_grade_item IN SELECT * FROM jsonb_array_elements(p_manual_grades)
    LOOP
      UPDATE public.academic_submission_answers
      SET points_earned = (v_grade_item->>'points_earned')::NUMERIC,
          teacher_comment = NULLIF(TRIM(v_grade_item->>'teacher_comment'), '')
      WHERE submission_id = p_submission_id
        AND question_id = (v_grade_item->>'question_id')::UUID;

      GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
      IF v_updated_rows != 1 THEN
        RAISE EXCEPTION 'Chấm điểm thất bại: Không cập nhật được câu hỏi.';
      END IF;
    END LOOP;
  END IF;

  SELECT COALESCE(SUM(ans.points_earned), 0) INTO v_total_manual
  FROM public.academic_submission_answers ans
  JOIN public.academic_exercise_questions q ON q.id = ans.question_id
  WHERE ans.submission_id = p_submission_id AND q.question_type IN ('essay', 'image_upload', 'file_upload');

  v_final_total := LEAST(COALESCE(v_sub.objective_score, 0) + v_total_manual, COALESCE(v_sub.max_score, 100));

  -- TÍNH TOÁN SAO THƯỞNG (BẢO TOÀN KIỂU INT CHO PROFILES.TOTAL_STARS)
  IF v_new_status = 'graded' AND v_sub.reward_applied_at IS NULL AND v_final_total > 0 THEN
    v_ratio := (v_final_total::FLOAT / COALESCE(v_sub.max_score, 100)::FLOAT);
    v_stars_to_award := FLOOR(COALESCE(v_ex.reward_stars, 10) * v_ratio);
  END IF;

  UPDATE public.academic_submissions
  SET status = v_new_status,
      manual_score = v_total_manual,
      total_score = v_final_total,
      teacher_feedback = NULLIF(TRIM(p_teacher_feedback), ''),
      graded_at = NOW(),
      graded_by = v_teacher_id,
      reward_stars_awarded = CASE WHEN v_sub.reward_applied_at IS NULL THEN v_stars_to_award ELSE reward_stars_awarded END,
      reward_applied_at = CASE WHEN v_stars_to_award > 0 AND v_sub.reward_applied_at IS NULL THEN NOW() ELSE reward_applied_at END
  WHERE id = p_submission_id;

  IF v_stars_to_award > 0 AND v_sub.reward_applied_at IS NULL THEN
    UPDATE public.profiles
    SET total_stars = COALESCE(total_stars, 0) + v_stars_to_award
    WHERE id = v_sub.student_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', v_new_status,
    'total_score', v_final_total,
    'stars_awarded', CASE WHEN v_sub.reward_applied_at IS NULL THEN v_stars_to_award ELSE 0 END,
    'message', CASE
      WHEN v_new_status = 'graded' THEN 'Đã chấm bài hoàn tất và trao thưởng thành công!'
      WHEN v_new_status = 'revision_requested' THEN 'Đã yêu cầu học sinh làm lại bài.'
      ELSE 'Đã lưu điểm thành phần.'
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.grade_academic_submission(UUID, JSONB, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grade_academic_submission(UUID, JSONB, TEXT, BOOLEAN) TO authenticated, service_role, postgres;

COMMIT;
