-- ============================================================
-- ACADEMIC EXERCISE SAFE DELETE & ARCHIVE RPC
-- MIGRATION: 20260913000014_academic_exercise_safe_delete_or_archive_rpc.sql
-- TARGET SCHEMA: public, app_private
-- ============================================================
--
-- BUSINESS RULES:
-- 1. Active In-Progress Blocking (ERR_EXERCISE_IN_USE):
--    - If any student submission is in progress (status = 'draft'):
--      RAISE EXCEPTION 'ERR_EXERCISE_IN_USE: Bài tập đang có học sinh làm bài dở dang. Chỉ có thể lưu trữ sau khi học sinh hoàn thành nộp bài.'
--    - If any assignment is active (due_date IS NULL OR due_date > NOW()):
--      RAISE EXCEPTION 'ERR_EXERCISE_IN_USE: Bài tập đang trong thời hạn giao cho lớp học. Vui lòng kết thúc thời hạn giao bài trước khi lưu trữ.'
--
-- 2. Used / Assigned Exercise Archival (Soft Delete):
--    - If the exercise has assignments, submissions, or was published/closed:
--      * Set academic_exercises.status = 'archived', updated_at = NOW()
--      * Submissions, submission answers, scores, and ranking entries remain 100% intact.
--
-- 3. Clean Draft Exercise (never assigned, no student submissions):
--    - Hard delete in atomic transaction:
--      * Delete public.academic_exercise_questions for this exercise
--      * Delete public.academic_exercises container
--
-- 4. Authorization & Security (Fail Closed):
--    - Caller identity derived server-side via auth.uid() (NEVER accepted from client).
--    - Admin role verified server-side from public.profiles (role = 'admin').
--    - Teachers can only delete/archive exercises they created (teacher_id = auth.uid()).
--    - Admins can delete/archive any exercise.
--    - Unauthenticated callers or non-owners are rejected.
--    - SET search_path = public, app_private
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_academic_delete_or_archive_exercise(
    p_exercise_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_is_admin BOOLEAN := FALSE;
    v_exercise RECORD;
    v_has_assignments BOOLEAN := FALSE;
    v_has_submissions BOOLEAN := FALSE;
    v_is_published BOOLEAN := FALSE;
    v_has_draft_submission BOOLEAN := FALSE;
    v_has_active_assignment BOOLEAN := FALSE;
BEGIN
    -- 1. Identity validation (Derived server-side from auth.uid())
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'ERR_CALLER_ID_REQUIRED: Bạn cần đăng nhập để thực hiện thao tác' USING ERRCODE = '22000';
    END IF;

    IF p_exercise_id IS NULL THEN
        RAISE EXCEPTION 'ERR_REQUIRED_PARAMS: exercise_id must be provided' USING ERRCODE = '22000';
    END IF;

    -- 2. Server-side Role Resolution (Trusted Source: public.profiles)
    SELECT role INTO v_caller_role
    FROM public.profiles
    WHERE id = v_caller_id;

    v_is_admin := (COALESCE(v_caller_role, '') = 'admin');

    -- 3. Lock and retrieve academic exercise row
    SELECT id, teacher_id, status, title
    INTO v_exercise
    FROM public.academic_exercises
    WHERE id = p_exercise_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_EXERCISE_NOT_FOUND: Không tìm thấy bài tập yêu cầu' USING ERRCODE = 'P0002';
    END IF;

    -- 4. Authorization check (Fail Closed)
    IF NOT v_is_admin AND v_exercise.teacher_id != v_caller_id THEN
        RAISE EXCEPTION 'ERR_UNAUTHORIZED: Bạn không có quyền xóa hoặc lưu trữ bài tập này' USING ERRCODE = '42501';
    END IF;

    -- 5. Idempotency: If already archived, return success with archived status
    IF v_exercise.status = 'archived' THEN
        RETURN jsonb_build_object(
            'success', true,
            'action', 'already_archived',
            'exercise_id', p_exercise_id,
            'message', 'Bài tập đã ở trạng thái lưu trữ từ trước.'
        );
    END IF;

    -- 6. Hardened Active Checks (Block if exercise is in use)
    -- 6.1. Check for in-progress draft student submissions
    SELECT EXISTS (
        SELECT 1
        FROM public.academic_submissions
        WHERE exercise_id = p_exercise_id
          AND status = 'draft'
    ) INTO v_has_draft_submission;

    IF v_has_draft_submission THEN
        RAISE EXCEPTION 'ERR_EXERCISE_IN_USE: Bài tập đang có học sinh làm bài dở dang. Chỉ có thể lưu trữ sau khi học sinh hoàn thành nộp bài.' USING ERRCODE = '55000';
    END IF;

    -- 6.2. Check for open / active assignments (due_date IS NULL OR due_date > NOW())
    SELECT EXISTS (
        SELECT 1
        FROM public.academic_exercise_assignments
        WHERE exercise_id = p_exercise_id
          AND (due_date IS NULL OR due_date > NOW())
    ) INTO v_has_active_assignment;

    IF v_has_active_assignment THEN
        RAISE EXCEPTION 'ERR_EXERCISE_IN_USE: Bài tập đang trong thời hạn giao cho lớp học. Vui lòng kết thúc thời hạn giao bài trước khi lưu trữ.' USING ERRCODE = '55000';
    END IF;

    -- 7. Relational usage inspection
    SELECT EXISTS (
        SELECT 1
        FROM public.academic_exercise_assignments
        WHERE exercise_id = p_exercise_id
    ) INTO v_has_assignments;

    SELECT EXISTS (
        SELECT 1
        FROM public.academic_submissions
        WHERE exercise_id = p_exercise_id
    ) INTO v_has_submissions;

    v_is_published := (v_exercise.status IN ('published', 'closed'));

    -- 8. Branch execution: Soft Archive vs Hard Delete
    IF v_has_assignments OR v_has_submissions OR v_is_published THEN
        -- Case A: SOFT DELETE / ARCHIVE
        UPDATE public.academic_exercises
        SET status = 'archived',
            updated_at = NOW()
        WHERE id = p_exercise_id;

        RETURN jsonb_build_object(
            'success', true,
            'action', 'archived',
            'exercise_id', p_exercise_id,
            'archived_at', NOW(),
            'message', 'Bài tập đã được lưu trữ an toàn; toàn bộ bài nộp và điểm số học sinh vẫn được bảo toàn nguyên vẹn.'
        );
    ELSE
        -- Case B: HARD DELETE (Clean Draft with no assignments, no submissions)
        DELETE FROM public.academic_exercise_questions
        WHERE exercise_id = p_exercise_id;

        DELETE FROM public.academic_exercises
        WHERE id = p_exercise_id;

        RETURN jsonb_build_object(
            'success', true,
            'action', 'deleted',
            'exercise_id', p_exercise_id,
            'message', 'Bài tập nháp đã được xóa vĩnh viễn thành công.'
        );
    END IF;
END;
$$;

-- Revoke all permissions and grant execute to authenticated and service_role
REVOKE ALL ON FUNCTION public.rpc_academic_delete_or_archive_exercise(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_academic_delete_or_archive_exercise(UUID) TO authenticated, service_role;
