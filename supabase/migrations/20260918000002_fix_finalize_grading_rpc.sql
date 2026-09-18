-- ============================================================================
-- MIGRATION: 20260918000002_fix_finalize_grading_rpc.sql
-- MỤC TIÊU:
-- 1. Hotfix RPC finalize_academic_submission_grading_with_annotations.
-- 2. Loại bỏ cập nhật cột 'updated_at' không tồn tại trên bảng academic_submission_answers.
-- 3. Giữ nguyên 100% logic chấm điểm, RLS, phân quyền và contract response.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.finalize_academic_submission_grading_with_annotations(
  p_submission_id UUID,
  p_manual_grades JSONB,
  p_annotations JSONB DEFAULT '[]'::jsonb,
  p_teacher_feedback TEXT DEFAULT '',
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
  v_has_permission BOOLEAN := FALSE;
  v_grade_item JSONB;
  v_ann_item JSONB;
  v_att_id UUID;
  v_ann_json JSONB;
  v_exp_ver INT;
  v_idemp UUID;
  v_cur_ver INT;
  v_new_ver INT;
  v_q_type TEXT;
  v_q_points NUMERIC;
  v_item_points NUMERIC;
  v_total_manual NUMERIC := 0;
  v_final_total NUMERIC := 0;
  v_new_status TEXT;
  v_ratio FLOAT := 0.0;
  v_stars_to_award INT := 0;
  v_seen_q_ids UUID[] := ARRAY[]::UUID[];
  v_curr_q_id UUID;
  v_seen_att_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  v_teacher_id := (SELECT auth.uid());
  IF v_teacher_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Lỗi: Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_teacher_id;

  SELECT * INTO v_sub FROM public.academic_submissions WHERE id = p_submission_id FOR UPDATE;
  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SUBMISSION_NOT_FOUND', 'message', 'Lỗi: Bài nộp không tồn tại.');
  END IF;

  IF v_sub.status NOT IN ('submitted', 'pending_manual_grade', 'revision_requested', 'graded') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'message', 'Lỗi: Chỉ được chấm bài nộp đã gửi.');
  END IF;

  SELECT * INTO v_ex FROM public.academic_exercises WHERE id = v_sub.exercise_id;

  -- Phân quyền
  IF v_role = 'admin' OR app_private.is_admin() THEN
    v_has_permission := TRUE;
  ELSIF EXISTS (
    SELECT 1 FROM public.academic_exercise_assignments a
    JOIN public.class_members cm ON cm.class_id = a.class_id
    WHERE a.exercise_id = v_sub.exercise_id
      AND cm.student_id = v_sub.student_id
      AND app_private.teacher_owns_class(a.class_id)
  ) OR EXISTS (
    SELECT 1 FROM public.academic_exercises e
    JOIN public.class_members cm ON cm.class_id = e.class_id
    WHERE e.id = v_sub.exercise_id
      AND cm.student_id = v_sub.student_id
      AND app_private.teacher_owns_class(e.class_id)
  ) THEN
    v_has_permission := TRUE;
  END IF;

  IF NOT v_has_permission THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Lỗi bảo mật: Không có quyền chấm bài nộp này.');
  END IF;

  -- 1. Lưu các annotation final nếu có
  IF jsonb_typeof(p_annotations) = 'array' THEN
    FOR v_ann_item IN SELECT * FROM jsonb_array_elements(p_annotations)
    LOOP
      v_att_id := (v_ann_item->>'attachment_id')::UUID;
      v_ann_json := v_ann_item->'annotation_json';
      v_exp_ver := (v_ann_item->>'expected_version')::INT;
      v_idemp := COALESCE((v_ann_item->>'idempotency_key')::UUID, gen_random_uuid());

      IF v_att_id IS NOT NULL AND v_ann_json IS NOT NULL THEN
        -- Check idempotency
        IF NOT EXISTS (
          SELECT 1 FROM public.academic_submission_annotation_versions
          WHERE teacher_id = v_teacher_id AND idempotency_key = v_idemp
        ) THEN
          SELECT COALESCE(MAX(version), 0) INTO v_cur_ver
          FROM public.academic_submission_annotation_versions
          WHERE attachment_id = v_att_id;

          IF v_exp_ver IS NOT NULL AND v_cur_ver != v_exp_ver THEN
            RETURN jsonb_build_object(
              'success', false,
              'error', 'VERSION_CONFLICT',
              'message', format('Phát hiện xung đột phiên bản annotation trên attachment %s.', v_att_id),
              'current_version', v_cur_ver,
              'expected_version', v_exp_ver
            );
          END IF;

          v_new_ver := v_cur_ver + 1;

          INSERT INTO public.academic_submission_annotation_versions (
            submission_id,
            attachment_id,
            teacher_id,
            version,
            status,
            schema_version,
            annotation_json,
            rendered_preview_bucket,
            rendered_preview_path,
            idempotency_key,
            created_at,
            updated_at
          ) VALUES (
            v_sub.id,
            v_att_id,
            v_teacher_id,
            v_new_ver,
            'final',
            1,
            v_ann_json,
            'exercise-submissions',
            v_ann_item->>'rendered_preview_path',
            v_idemp,
            NOW(),
            NOW()
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- 2. Chấm điểm manual_grades
  IF jsonb_typeof(p_manual_grades) = 'array' THEN
    FOR v_grade_item IN SELECT * FROM jsonb_array_elements(p_manual_grades)
    LOOP
      v_curr_q_id := (v_grade_item->>'question_id')::UUID;
      IF v_curr_q_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUESTION', 'message', 'Lỗi: question_id trong manual_grades không hợp lệ.');
      END IF;

      IF v_curr_q_id = ANY(v_seen_q_ids) THEN
        RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE_QUESTION', 'message', 'Lỗi: Trùng lặp question_id trong danh sách điểm chấm.');
      END IF;
      v_seen_q_ids := array_append(v_seen_q_ids, v_curr_q_id);

      SELECT question_type, points INTO v_q_type, v_q_points
      FROM public.academic_exercise_questions
      WHERE id = v_curr_q_id AND exercise_id = v_sub.exercise_id;

      IF v_q_type IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'QUESTION_NOT_FOUND', 'message', 'Lỗi: Câu hỏi không thuộc bài tập này.');
      END IF;

      IF v_q_type NOT IN ('essay', 'image_upload', 'file_upload') THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUESTION_TYPE', 'message', 'Lỗi: Chỉ được chấm điểm thủ công cho câu tự luận hoặc nộp file.');
      END IF;

      v_item_points := (v_grade_item->>'points_earned')::NUMERIC(8,2);
      IF v_item_points IS NULL OR v_item_points < 0 OR v_item_points > v_q_points THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_SCORE', 'message', format('Lỗi: Điểm câu %s không hợp lệ (Phải từ 0 đến %s).', v_curr_q_id, v_q_points));
      END IF;

      UPDATE public.academic_submission_answers
      SET
        points_earned = v_item_points,
        teacher_comment = COALESCE(v_grade_item->>'teacher_comment', teacher_comment)
      WHERE submission_id = p_submission_id AND question_id = v_curr_q_id;

      v_total_manual := v_total_manual + v_item_points;
    END LOOP;
  END IF;

  -- 3. Cập nhật tổng điểm bài nộp
  v_final_total := COALESCE(v_sub.objective_score, 0) + v_total_manual;
  IF v_final_total > v_sub.max_score THEN
    v_final_total := v_sub.max_score;
  END IF;

  IF p_request_revision THEN
    v_new_status := 'revision_requested';
  ELSE
    v_new_status := 'graded';
  END IF;

  UPDATE public.academic_submissions
  SET
    manual_score = v_total_manual,
    total_score = v_final_total,
    teacher_feedback = p_teacher_feedback,
    status = v_new_status,
    graded_by = v_teacher_id,
    graded_at = NOW(),
    updated_at = NOW()
  WHERE id = p_submission_id;

  -- 4. Thưởng sao học sinh nếu hoàn tất và đạt tiêu chí
  IF v_new_status = 'graded' AND v_sub.reward_applied_at IS NULL AND v_ex.reward_stars > 0 THEN
    IF v_sub.max_score > 0 THEN
      v_ratio := v_final_total::FLOAT / v_sub.max_score::FLOAT;
      IF v_ratio >= 0.5 THEN
        v_stars_to_award := ROUND(v_ex.reward_stars * v_ratio);
        IF v_stars_to_award > 0 THEN
          UPDATE public.profiles
          SET total_stars = COALESCE(total_stars, 0) + v_stars_to_award
          WHERE id = v_sub.student_id;

          UPDATE public.academic_submissions
          SET reward_applied_at = NOW()
          WHERE id = p_submission_id;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'submission_id', p_submission_id,
    'status', v_new_status,
    'total_score', v_final_total,
    'manual_score', v_total_manual,
    'reward_stars_awarded', v_stars_to_award
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_academic_submission_grading_with_annotations FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_academic_submission_grading_with_annotations TO authenticated, service_role;

COMMIT;
