-- ============================================================================
-- MIGRATION: 20260919000003_harden_finalize_annotation_attachment_validation.sql
-- MỤC TIÊU:
-- 1. Gia cố bảo mật cho RPC finalize_academic_submission_grading_with_annotations.
-- 2. Ngăn chặn Cross-Submission Attachment Injection: Xác thực attachment tồn tại,
--    thuộc đúng submission_id đang chấm và đã upload_status = 'finalized'.
-- 3. Ngăn chặn duplicate attachment_id trong cùng p_annotations payload.
-- 4. Giới hạn kích thước payload annotation_json <= 512 KiB (524288 bytes).
-- 5. Xử lý tính nhất quán Idempotency Key giữa hai pass:
--    - Nếu caller cung cấp idempotency_key: Validate format UUID, duplicate trong payload
--      và kiểm tra existing record trong DB (trả về IDEMPOTENCY_KEY_MISMATCH nếu trỏ sai).
--    - Nếu caller không cung cấp idempotency_key: PASS 1 KHÔNG sinh random UUID giả,
--      PASS 2 sinh đúng 1 random UUID tại thời điểm INSERT.
-- 6. Xử lý an toàn expected_version: Trả về INVALID_EXPECTED_VERSION nếu truyền sai kiểu integer.
-- 7. Áp dụng Two-Pass Validation (Validate trước - Insert sau) đảm bảo tính Atomicity,
--    không để lại side-effects insert dở dang khi payload chứa item lỗi.
-- 8. Bảo toàn 100% logic chấm điểm, OCC, phân quyền, reward stars và return contract.
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
  v_raw_idemp TEXT;
  v_idemp UUID;
  v_has_idemp_record BOOLEAN := FALSE;
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
  v_seen_idempotency_keys UUID[] := ARRAY[]::UUID[];
  v_att RECORD;
  v_existing_idemp RECORD;
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

  -- Phân quyền: Admin hoặc giáo viên phụ trách lớp của bài tập
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

  -- --------------------------------------------------------------------------
  -- 1. XỬ LÝ ANNOTATIONS: TWO-PASS VALIDATION & ATOMIC INSERTION
  -- --------------------------------------------------------------------------
  IF jsonb_typeof(p_annotations) = 'array' THEN
    -- PASS 1: PRE-VALIDATION LOOP (Tất cả items phải pass trước khi insert bất kỳ record nào)
    FOR v_ann_item IN SELECT * FROM jsonb_array_elements(p_annotations)
    LOOP
      -- Parse & Validate attachment_id
      BEGIN
        v_att_id := (v_ann_item->>'attachment_id')::UUID;
      EXCEPTION WHEN OTHERS THEN
        v_att_id := NULL;
      END;

      IF v_att_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_ATTACHMENT', 'message', 'Lỗi: attachment_id không hợp lệ hoặc bị thiếu.');
      END IF;

      -- A. Duplicate attachment in same payload
      IF v_att_id = ANY(v_seen_att_ids) THEN
        RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE_ATTACHMENT', 'message', format('Lỗi: Trùng lặp attachment_id %s trong danh sách annotation.', v_att_id));
      END IF;
      v_seen_att_ids := array_append(v_seen_att_ids, v_att_id);

      -- B. Attachment exists in database
      SELECT * INTO v_att
      FROM public.academic_submission_attachments
      WHERE id = v_att_id;

      IF v_att.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'ATTACHMENT_NOT_FOUND', 'message', format('Lỗi: Attachment %s không tồn tại.', v_att_id));
      END IF;

      -- C. Attachment belongs to this submission (Prevent Cross-Submission Attachment Injection)
      IF v_att.submission_id <> p_submission_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'ATTACHMENT_MISMATCH', 'message', format('Lỗi: Attachment %s không thuộc bài nộp %s.', v_att_id, p_submission_id));
      END IF;

      -- D. Attachment must be finalized
      IF v_att.upload_status <> 'finalized' THEN
        RETURN jsonb_build_object('success', false, 'error', 'ATTACHMENT_NOT_FINALIZED', 'message', format('Lỗi: Attachment %s chưa ở trạng thái finalized.', v_att_id));
      END IF;

      -- E. Validate annotation JSON payload
      v_ann_json := v_ann_item->'annotation_json';
      IF v_ann_json IS NULL OR jsonb_typeof(v_ann_json) <> 'object' THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_PAYLOAD', 'message', 'Lỗi: annotation_json phải là một JSON object hợp lệ.');
      END IF;

      IF pg_column_size(v_ann_json) > 524288 THEN
        RETURN jsonb_build_object('success', false, 'error', 'PAYLOAD_TOO_LARGE', 'message', 'Lỗi: Dung lượng annotation_json vượt quá giới hạn cho phép (512 KiB).');
      END IF;

      -- F. Idempotency Key validation (OPTIONAL: Chỉ validate khi caller có cung cấp key)
      v_raw_idemp := NULLIF(TRIM(v_ann_item->>'idempotency_key'), '');
      v_has_idemp_record := FALSE;

      IF v_raw_idemp IS NOT NULL THEN
        BEGIN
          v_idemp := v_raw_idemp::UUID;
        EXCEPTION WHEN OTHERS THEN
          RETURN jsonb_build_object('success', false, 'error', 'INVALID_IDEMPOTENCY_KEY', 'message', 'Lỗi: idempotency_key không hợp lệ.');
        END;

        IF v_idemp = ANY(v_seen_idempotency_keys) THEN
          RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE_IDEMPOTENCY_KEY', 'message', format('Lỗi: Trùng lặp idempotency_key %s trong cùng payload.', v_idemp));
        END IF;
        v_seen_idempotency_keys := array_append(v_seen_idempotency_keys, v_idemp);

        -- Check existing idempotency record in DB
        SELECT * INTO v_existing_idemp
        FROM public.academic_submission_annotation_versions
        WHERE teacher_id = v_teacher_id AND idempotency_key = v_idemp;

        IF v_existing_idemp.id IS NOT NULL THEN
          v_has_idemp_record := TRUE;
          IF v_existing_idemp.attachment_id <> v_att_id OR v_existing_idemp.submission_id <> p_submission_id THEN
            RETURN jsonb_build_object(
              'success', false,
              'error', 'IDEMPOTENCY_KEY_MISMATCH',
              'message', format('Lỗi: Idempotency key %s đã được sử dụng cho attachment/submission khác.', v_idemp)
            );
          END IF;
        END IF;
      END IF;

      -- G. Validate expected_version (Structured error on malformed values)
      IF v_ann_item ? 'expected_version' AND v_ann_item->>'expected_version' IS NOT NULL AND TRIM(v_ann_item->>'expected_version') <> '' THEN
        BEGIN
          v_exp_ver := (v_ann_item->>'expected_version')::INT;
        EXCEPTION WHEN OTHERS THEN
          RETURN jsonb_build_object('success', false, 'error', 'INVALID_EXPECTED_VERSION', 'message', 'Lỗi: expected_version không hợp lệ.');
        END;
      ELSE
        v_exp_ver := NULL;
      END IF;

      -- H. Optimistic Concurrency Control (OCC) khi chưa tồn tại idempotency record
      IF NOT v_has_idemp_record THEN
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
      END IF;
    END LOOP;

    -- PASS 2: EXECUTION / INSERTION LOOP (Chỉ thực hiện sau khi PASS 1 đã hoàn toàn hợp lệ 100%)
    FOR v_ann_item IN SELECT * FROM jsonb_array_elements(p_annotations)
    LOOP
      v_att_id := (v_ann_item->>'attachment_id')::UUID;
      v_ann_json := v_ann_item->'annotation_json';
      v_raw_idemp := NULLIF(TRIM(v_ann_item->>'idempotency_key'), '');

      IF v_raw_idemp IS NOT NULL THEN
        v_idemp := v_raw_idemp::UUID;

        -- Bỏ qua nếu đã có bản ghi trùng teacher_id & idempotency_key (deduplicated an toàn)
        IF EXISTS (
          SELECT 1 FROM public.academic_submission_annotation_versions
          WHERE teacher_id = v_teacher_id AND idempotency_key = v_idemp
        ) THEN
          CONTINUE;
        END IF;
      ELSE
        -- Sinh đúng 1 random UUID tại thời điểm insert nếu caller không cung cấp key
        v_idemp := gen_random_uuid();
      END IF;

      SELECT COALESCE(MAX(version), 0) INTO v_cur_ver
      FROM public.academic_submission_annotation_versions
      WHERE attachment_id = v_att_id;

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
    END LOOP;
  END IF;

  -- --------------------------------------------------------------------------
  -- 2. CHẤM ĐIỂM MANUAL_GRADES
  -- --------------------------------------------------------------------------
  -- Note: p_manual_grades must contain all subjective/manual-grade questions because manual_score is recalculated from supplied items.
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

  -- --------------------------------------------------------------------------
  -- 3. CẬP NHẬT TỔNG ĐIỂM BÀI NỘP
  -- --------------------------------------------------------------------------
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

  -- --------------------------------------------------------------------------
  -- 4. THƯỞNG SAO HỌC SINH NẾU HOÀN TẤT VÀ ĐẠT TIÊU CHÍ
  -- --------------------------------------------------------------------------
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
