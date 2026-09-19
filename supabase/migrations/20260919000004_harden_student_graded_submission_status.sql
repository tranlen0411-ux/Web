-- ============================================================================
-- MIGRATION 20260919000004: HARDEN STUDENT GRADED SUBMISSION STATUS GATE
-- ============================================================================
-- Mục tiêu: Siết chặt phân quyền học sinh trong public.get_student_graded_submission.
-- Chỉ cho phép học sinh chính chủ xem kết quả khi bài nộp đã ở trạng thái 'graded' hoặc 'revision_requested'.
-- Giữ nguyên quyền truy cập cho Giáo viên phụ trách lớp và Admin.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.get_student_graded_submission(
  p_submission_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_role TEXT;
  v_sub RECORD;
  v_ex RECORD;
  v_has_permission BOOLEAN := FALSE;
  v_questions JSONB;
  v_answers JSONB;
  v_attachments JSONB;
BEGIN
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Lỗi: Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_caller_id;

  SELECT * INTO v_sub FROM public.academic_submissions WHERE id = p_submission_id;
  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SUBMISSION_NOT_FOUND', 'message', 'Lỗi: Bài nộp không tồn tại.');
  END IF;

  -- Phân quyền
  IF v_sub.student_id = v_caller_id THEN
    -- Học sinh chính chủ: CHỈ ĐƯỢC XEM khi bài đã chấm hoàn tất hoặc có yêu cầu sửa
    IF v_sub.status NOT IN ('graded', 'revision_requested') THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'SUBMISSION_NOT_GRADED',
        'message', 'Bài làm chưa được chấm hoàn tất.'
      );
    END IF;

    v_has_permission := TRUE;
  ELSIF v_role = 'admin' OR app_private.is_admin() THEN
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
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Lỗi bảo mật: Không có quyền xem bài nộp này.');
  END IF;

  SELECT id, title, subject, grade_level, status, reward_stars INTO v_ex
  FROM public.academic_exercises WHERE id = v_sub.exercise_id;

  -- 1. Câu hỏi
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', q.id,
      'question_number', q.question_number,
      'question_type', q.question_type,
      'prompt', q.prompt,
      'points', q.points,
      'options_json', q.options_json
    ) ORDER BY q.question_number
  ) INTO v_questions
  FROM public.academic_exercise_questions q
  WHERE q.exercise_id = v_sub.exercise_id;

  -- 2. Câu trả lời
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'question_id', a.question_id,
      'student_answer_json', a.student_answer_json,
      'file_url', a.file_url,
      'is_correct', a.is_correct,
      'points_earned', a.points_earned,
      'teacher_comment', a.teacher_comment
    )
  ) INTO v_answers
  FROM public.academic_submission_answers a
  WHERE a.submission_id = p_submission_id;

  -- 3. Attachments + FINAL Annotation DUY NHẤT (Ẩn các bản draft tạm của GV)
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', att.id,
      'question_id', att.question_id,
      'storage_bucket', att.storage_bucket,
      'storage_path', att.storage_path,
      'original_file_name', att.original_file_name,
      'mime_type', att.mime_type,
      'byte_size', att.byte_size,
      'width', att.width,
      'height', att.height,
      'sort_order', att.sort_order,
      'created_at', att.created_at,
      'final_annotation', (
        SELECT jsonb_build_object(
          'id', ann.id,
          'version', ann.version,
          'schema_version', ann.schema_version,
          'annotation_json', ann.annotation_json,
          'rendered_preview_path', ann.rendered_preview_path,
          'updated_at', ann.updated_at
        )
        FROM public.academic_submission_annotation_versions ann
        WHERE ann.attachment_id = att.id
          AND ann.status = 'final'
        ORDER BY ann.version DESC
        LIMIT 1
      )
    ) ORDER BY att.sort_order, att.created_at
  ) INTO v_attachments
  FROM public.academic_submission_attachments att
  WHERE att.submission_id = p_submission_id
    AND att.upload_status = 'finalized';

  RETURN jsonb_build_object(
    'success', true,
    'submission', jsonb_build_object(
      'id', v_sub.id,
      'exercise_id', v_sub.exercise_id,
      'status', v_sub.status,
      'objective_score', v_sub.objective_score,
      'manual_score', v_sub.manual_score,
      'total_score', v_sub.total_score,
      'max_score', v_sub.max_score,
      'teacher_feedback', v_sub.teacher_feedback,
      'submitted_at', v_sub.submitted_at,
      'graded_at', v_sub.graded_at,
      'exercise', row_to_json(v_ex)
    ),
    'questions', COALESCE(v_questions, '[]'::jsonb),
    'answers', COALESCE(v_answers, '[]'::jsonb),
    'attachments', COALESCE(v_attachments, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_graded_submission(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_graded_submission(UUID) TO authenticated, service_role;

COMMIT;
