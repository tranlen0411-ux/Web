-- ============================================================================
-- SCRIPT MIGRATION: ĐỒNG BỘ PHÂN QUYỀN BÀI TẬP HỌC THUẬT THEO CLASS OWNERSHIP MODEL
-- GIÁO VIÊN HIỆN TẠI CỦA LỚP QUẢN LÝ / CHẤM BÀI NỘP, THU HỒI QUYỀN CỦA GV CŨ
-- GIỮ NGUYÊN TÁC GIẢ BÀI GỐC (TEACHER_ID) VÀ TOÀN VẸN LỊCH SỬ BÀI NỘP 100%
-- KHÔNG REDEFINE CÁC HÀM HELPER ĐÃ CÓ TRONG REPO (MINIMAL BLAST RADIUS)
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

-- 1. CẬP NHẬT RLS POLICIES TRÊN PUBLIC.ACADEMIC_EXERCISES
ALTER TABLE public.academic_exercises ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Academic exercises select policy" ON public.academic_exercises;
DROP POLICY IF EXISTS "Academic exercises insert policy" ON public.academic_exercises;
DROP POLICY IF EXISTS "Academic exercises update policy" ON public.academic_exercises;
DROP POLICY IF EXISTS "Academic exercises delete policy" ON public.academic_exercises;

CREATE POLICY "Academic exercises select policy" ON public.academic_exercises
FOR SELECT USING (
  app_private.is_admin()
  OR teacher_id = (SELECT auth.uid())
  OR app_private.teacher_owns_class(class_id)
  OR EXISTS (
    SELECT 1 FROM public.academic_exercise_assignments a
    WHERE a.exercise_id = public.academic_exercises.id AND app_private.teacher_owns_class(a.class_id)
  )
  OR (
    status = 'published' AND (
      is_global = true
      OR EXISTS (
        SELECT 1 FROM public.academic_exercise_assignments a
        WHERE a.exercise_id = public.academic_exercises.id AND app_private.student_in_class(a.class_id)
      )
      OR (
        class_id IS NOT NULL AND app_private.student_in_class(class_id)
      )
    )
  )
);

CREATE POLICY "Academic exercises insert policy" ON public.academic_exercises
FOR INSERT WITH CHECK (
  app_private.is_admin()
  OR (app_private.is_teacher() AND teacher_id = (SELECT auth.uid()))
);

CREATE POLICY "Academic exercises update policy" ON public.academic_exercises
FOR UPDATE USING (
  app_private.is_admin()
  OR (app_private.is_teacher() AND teacher_id = (SELECT auth.uid()))
)
WITH CHECK (
  app_private.is_admin()
  OR (app_private.is_teacher() AND teacher_id = (SELECT auth.uid()))
);

CREATE POLICY "Academic exercises delete policy" ON public.academic_exercises
FOR DELETE USING (
  app_private.is_admin()
  OR (app_private.is_teacher() AND teacher_id = (SELECT auth.uid()))
);

-- 2. CẬP NHẬT RLS POLICIES TRÊN PUBLIC.ACADEMIC_EXERCISE_QUESTIONS
ALTER TABLE public.academic_exercise_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Academic questions select policy" ON public.academic_exercise_questions;

CREATE POLICY "Academic questions select policy" ON public.academic_exercise_questions
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.academic_exercises e 
    WHERE e.id = exercise_id AND (
      app_private.is_admin()
      OR e.teacher_id = (SELECT auth.uid())
      OR app_private.teacher_owns_class(e.class_id)
      OR EXISTS (
        SELECT 1 FROM public.academic_exercise_assignments a
        WHERE a.exercise_id = e.id AND app_private.teacher_owns_class(a.class_id)
      )
      OR (
        e.status = 'published' AND (
          e.is_global = true 
          OR EXISTS (
            SELECT 1 FROM public.academic_exercise_assignments a
            WHERE a.exercise_id = e.id AND app_private.student_in_class(a.class_id)
          )
          OR (
            e.class_id IS NOT NULL AND app_private.student_in_class(e.class_id)
          )
        )
      )
    )
  )
);

-- 3. CẬP NHẬT RLS POLICIES TRÊN PUBLIC.ACADEMIC_EXERCISE_ASSIGNMENTS
-- QUYỀN XEM VÀ QUẢN LÝ GIAO BÀI ĐI THEO LỚP HỌC (CLASS_ID), KHÔNG CẤP QUYỀN CHỈ VÌ LÀ TÁC GIẢ BÀI GỐC
ALTER TABLE public.academic_exercise_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Academic assignments select policy" ON public.academic_exercise_assignments;
DROP POLICY IF EXISTS "Academic assignments insert policy" ON public.academic_exercise_assignments;
DROP POLICY IF EXISTS "Academic assignments update policy" ON public.academic_exercise_assignments;
DROP POLICY IF EXISTS "Academic assignments delete policy" ON public.academic_exercise_assignments;

CREATE POLICY "Academic assignments select policy" ON public.academic_exercise_assignments
FOR SELECT USING (
  app_private.is_admin()
  OR app_private.teacher_owns_class(class_id)
  OR app_private.student_in_class(class_id)
);

CREATE POLICY "Academic assignments insert policy" ON public.academic_exercise_assignments
FOR INSERT WITH CHECK (
  app_private.is_admin() OR app_private.teacher_owns_class(class_id)
);

CREATE POLICY "Academic assignments update policy" ON public.academic_exercise_assignments
FOR UPDATE USING (
  app_private.is_admin() OR app_private.teacher_owns_class(class_id)
)
WITH CHECK (
  app_private.is_admin() OR app_private.teacher_owns_class(class_id)
);

CREATE POLICY "Academic assignments delete policy" ON public.academic_exercise_assignments
FOR DELETE USING (
  app_private.is_admin() OR app_private.teacher_owns_class(class_id)
);

-- 4. CẬP NHẬT RLS POLICIES TRÊN PUBLIC.ACADEMIC_SUBMISSIONS (THU HỒI QUYỀN CỦA GV CŨ & CHỐNG RÒ RỈ CHÉO)
ALTER TABLE public.academic_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Academic submissions select policy" ON public.academic_submissions;
DROP POLICY IF EXISTS "Academic submissions update policy" ON public.academic_submissions;

CREATE POLICY "Academic submissions select policy" ON public.academic_submissions
FOR SELECT USING (
  app_private.is_admin()
  OR student_id = (SELECT auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.academic_exercise_assignments a
    JOIN public.class_members cm ON cm.class_id = a.class_id
    WHERE a.exercise_id = public.academic_submissions.exercise_id 
      AND cm.student_id = public.academic_submissions.student_id
      AND app_private.teacher_owns_class(a.class_id)
  )
  OR EXISTS (
    SELECT 1 FROM public.academic_exercises e
    JOIN public.class_members cm ON cm.class_id = e.class_id
    WHERE e.id = public.academic_submissions.exercise_id 
      AND cm.student_id = public.academic_submissions.student_id
      AND app_private.teacher_owns_class(e.class_id)
  )
);

CREATE POLICY "Academic submissions update policy" ON public.academic_submissions
FOR UPDATE USING (
  app_private.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.academic_exercise_assignments a
    JOIN public.class_members cm ON cm.class_id = a.class_id
    WHERE a.exercise_id = public.academic_submissions.exercise_id 
      AND cm.student_id = public.academic_submissions.student_id
      AND app_private.teacher_owns_class(a.class_id)
  )
  OR EXISTS (
    SELECT 1 FROM public.academic_exercises e
    JOIN public.class_members cm ON cm.class_id = e.class_id
    WHERE e.id = public.academic_submissions.exercise_id 
      AND cm.student_id = public.academic_submissions.student_id
      AND app_private.teacher_owns_class(e.class_id)
  )
)
WITH CHECK (
  app_private.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.academic_exercise_assignments a
    JOIN public.class_members cm ON cm.class_id = a.class_id
    WHERE a.exercise_id = public.academic_submissions.exercise_id 
      AND cm.student_id = public.academic_submissions.student_id
      AND app_private.teacher_owns_class(a.class_id)
  )
  OR EXISTS (
    SELECT 1 FROM public.academic_exercises e
    JOIN public.class_members cm ON cm.class_id = e.class_id
    WHERE e.id = public.academic_submissions.exercise_id 
      AND cm.student_id = public.academic_submissions.student_id
      AND app_private.teacher_owns_class(e.class_id)
  )
);

-- 5. CẬP NHẬT RLS POLICIES TRÊN PUBLIC.ACADEMIC_SUBMISSION_ANSWERS
ALTER TABLE public.academic_submission_answers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Academic submission answers select policy" ON public.academic_submission_answers;
DROP POLICY IF EXISTS "Academic submission answers update policy" ON public.academic_submission_answers;

CREATE POLICY "Academic submission answers select policy" ON public.academic_submission_answers
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.academic_submissions s
    WHERE s.id = submission_id AND (
      app_private.is_admin()
      OR s.student_id = (SELECT auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.academic_exercise_assignments a
        JOIN public.class_members cm ON cm.class_id = a.class_id
        WHERE a.exercise_id = s.exercise_id
          AND cm.student_id = s.student_id
          AND app_private.teacher_owns_class(a.class_id)
      )
      OR EXISTS (
        SELECT 1 FROM public.academic_exercises e
        JOIN public.class_members cm ON cm.class_id = e.class_id
        WHERE e.id = s.exercise_id
          AND cm.student_id = s.student_id
          AND app_private.teacher_owns_class(e.class_id)
      )
    )
  )
);

CREATE POLICY "Academic submission answers update policy" ON public.academic_submission_answers
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.academic_submissions s
    WHERE s.id = submission_id AND (
      app_private.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.academic_exercise_assignments a
        JOIN public.class_members cm ON cm.class_id = a.class_id
        WHERE a.exercise_id = s.exercise_id
          AND cm.student_id = s.student_id
          AND app_private.teacher_owns_class(a.class_id)
      )
      OR EXISTS (
        SELECT 1 FROM public.academic_exercises e
        JOIN public.class_members cm ON cm.class_id = e.class_id
        WHERE e.id = s.exercise_id
          AND cm.student_id = s.student_id
          AND app_private.teacher_owns_class(e.class_id)
      )
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.academic_submissions s
    WHERE s.id = submission_id AND (
      app_private.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.academic_exercise_assignments a
        JOIN public.class_members cm ON cm.class_id = a.class_id
        WHERE a.exercise_id = s.exercise_id
          AND cm.student_id = s.student_id
          AND app_private.teacher_owns_class(a.class_id)
      )
      OR EXISTS (
        SELECT 1 FROM public.academic_exercises e
        JOIN public.class_members cm ON cm.class_id = e.class_id
        WHERE e.id = s.exercise_id
          AND cm.student_id = s.student_id
          AND app_private.teacher_owns_class(e.class_id)
      )
    )
  )
);

-- 6. CẬP NHẬT STORAGE POLICIES CHO BUCKET EXERCISE-SUBMISSIONS
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Exercise submissions select policy" ON storage.objects;
CREATE POLICY "Exercise submissions select policy" ON storage.objects
FOR SELECT USING (
  bucket_id = 'exercise-submissions' AND (
    app_private.is_admin()
    OR (storage.foldername(name))[1] = (SELECT auth.uid())::text
    OR EXISTS (
      SELECT 1 FROM public.academic_submissions s
      WHERE s.id::text = (storage.foldername(name))[2] AND (
        EXISTS (
          SELECT 1 FROM public.academic_exercise_assignments a
          JOIN public.class_members cm ON cm.class_id = a.class_id
          WHERE a.exercise_id = s.exercise_id
            AND cm.student_id = s.student_id
            AND app_private.teacher_owns_class(a.class_id)
        )
        OR EXISTS (
          SELECT 1 FROM public.academic_exercises e
          JOIN public.class_members cm ON cm.class_id = e.class_id
          WHERE e.id = s.exercise_id
            AND cm.student_id = s.student_id
            AND app_private.teacher_owns_class(e.class_id)
        )
      )
    )
  )
);

-- 7. CẬP NHẬT RPC GRADE_ACADEMIC_SUBMISSION CHUẨN CLASS OWNERSHIP MODEL & PRODUCTION CONTRACT
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
  v_q_points INT;
  v_item_points INT;
  v_total_manual INT := 0;
  v_new_status TEXT;
  v_final_total INT := 0;
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

      BEGIN
        v_num_val := (v_grade_item->>'points_earned')::NUMERIC;
        IF v_num_val IS NULL OR v_num_val != TRUNC(v_num_val) THEN
          RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Điểm chấm cho câu ' || v_curr_q_id::text || ' phải là số nguyên (INT).');
        END IF;
        v_item_points := v_num_val::INT;
      EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Điểm chấm cho câu ' || v_curr_q_id::text || ' không hợp lệ, phải là số nguyên.');
      END;

      IF v_item_points < 0 OR v_item_points > COALESCE(v_q_points, 10) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Điểm chấm cho câu ' || v_curr_q_id::text || ' phải từ 0 đến ' || COALESCE(v_q_points, 10)::text || '.');
      END IF;

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
      SET points_earned = ((v_grade_item->>'points_earned')::NUMERIC)::INT,
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

-- 8. CẬP NHẬT RPC ASSIGN_EXERCISE_TO_CLASSES BẢO TOÀN LỊCH SỬ AUDIT (KHÔNG GHI ĐÈ ASSIGNED_AT / ASSIGNED_BY)
CREATE OR REPLACE FUNCTION public.assign_exercise_to_classes(
  p_exercise_id UUID,
  p_class_ids UUID[],
  p_counts_toward_ranking BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_ex RECORD;
  v_class_id UUID;
  v_class_record RECORD;
  v_first_assigned_class_id UUID := NULL;
  v_assigned_names TEXT[] := ARRAY[]::TEXT[];
  v_failed_names TEXT[] := ARRAY[]::TEXT[];
  v_unique_class_ids UUID[];
BEGIN
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'teacher') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bạn không có quyền giao bài tập.');
  END IF;

  SELECT * INTO v_ex FROM public.academic_exercises WHERE id = p_exercise_id;
  IF v_ex.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bài tập không tồn tại.');
  END IF;

  -- CHO PHÉP GIAO BÀI NẾU: Admin HOẶC Là Tác Giả HOẶC Bài Tập Đã Được Xuất Bản (status = 'published')
  -- Giáo viên KHÔNG được giao bản nháp (draft) của giáo viên khác
  IF v_caller_role <> 'admin' AND v_ex.teacher_id IS DISTINCT FROM v_caller_id AND v_ex.status <> 'published' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bạn không có quyền giao bài tập dạng bản nháp của giáo viên khác.');
  END IF;

  IF p_class_ids IS NULL OR array_length(p_class_ids, 1) = 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Vui lòng chọn ít nhất 1 Lớp học để giao bài.');
  END IF;

  SELECT ARRAY(SELECT DISTINCT unnest(p_class_ids)) INTO v_unique_class_ids;

  FOREACH v_class_id IN ARRAY v_unique_class_ids
  LOOP
    SELECT * INTO v_class_record FROM public.classes WHERE id = v_class_id;
    IF v_class_record.id IS NULL THEN
      v_failed_names := array_append(v_failed_names, 'ID: ' || v_class_id::text || ' (Không tồn tại)');
      CONTINUE;
    END IF;

    -- KIỂM TRA QUYỀN SỞ HỮU LỚP CỦA GIÁO VIÊN QUA TEACHER_OWNS_CLASS HOẶC ADMIN
    IF v_caller_role <> 'admin' AND NOT app_private.teacher_owns_class(v_class_id) THEN
      v_failed_names := array_append(v_failed_names, v_class_record.name);
      CONTINUE;
    END IF;

    -- ON CONFLICT: BẢO TOÀN NGUYÊN VẸN ASSIGNED_BY VÀ ASSIGNED_AT LỊCH SỬ, CHỈ CẬP NHẬT DUE_DATE / RANKING
    INSERT INTO public.academic_exercise_assignments (
      exercise_id, class_id, assigned_by, assigned_at, due_date, counts_toward_ranking
    ) VALUES (
      p_exercise_id, v_class_id, v_caller_id, NOW(), v_ex.due_date, COALESCE(p_counts_toward_ranking, true)
    )
    ON CONFLICT (exercise_id, class_id) DO UPDATE SET
      due_date = COALESCE(EXCLUDED.due_date, public.academic_exercise_assignments.due_date),
      counts_toward_ranking = EXCLUDED.counts_toward_ranking;

    IF v_first_assigned_class_id IS NULL THEN
      v_first_assigned_class_id := v_class_id;
    END IF;

    v_assigned_names := array_append(v_assigned_names, v_class_record.name);
  END LOOP;

  IF array_length(v_assigned_names, 1) > 0 THEN
    UPDATE public.academic_exercises
    SET status = 'published',
        class_id = COALESCE(class_id, v_first_assigned_class_id),
        updated_at = NOW()
    WHERE id = p_exercise_id;

    RETURN jsonb_build_object(
      'success', true,
      'assigned_classes', to_jsonb(v_assigned_names),
      'failed_classes', to_jsonb(v_failed_names),
      'message', 'Đã xuất bản và giao bài tập thành công.'
    );
  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'failed_classes', to_jsonb(v_failed_names),
      'message', 'Không thể giao bài tập. Bạn không phụ trách các lớp học được chọn.'
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_exercise_to_classes(UUID, UUID[], BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_exercise_to_classes(UUID, UUID[], BOOLEAN) TO authenticated, service_role, postgres;

COMMIT;
