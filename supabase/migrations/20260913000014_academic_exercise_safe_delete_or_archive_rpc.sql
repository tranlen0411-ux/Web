-- ============================================================
-- ACADEMIC EXERCISE SAFE DELETE & ARCHIVE RPC (HARDENED & CLEANED)
-- MIGRATION: 20260913000014_academic_exercise_safe_delete_or_archive_rpc.sql
-- TARGET SCHEMA: public, app_private
-- ============================================================
--
-- BUSINESS RULES & SECURITY HARDENING:
-- 1. Identity & Role Verification (Fail-Closed):
--    - Caller identity derived server-side via auth.uid() (NEVER accepted from client).
--    - Role verified server-side from public.profiles. Only 'teacher' and 'admin' are permitted.
--    - Students, NULL roles, or unknown roles receive ERR_UNAUTHORIZED (HTTP 403 / 42501).
--    - Ownership check: IF NOT v_is_admin AND v_exercise.teacher_id IS DISTINCT FROM v_caller_id THEN ERR_UNAUTHORIZED.
--      (Ensures orphan/NULL teacher_id cannot be deleted by arbitrary non-admin teachers).
--
-- 2. Active In-Progress Blocking (ERR_EXERCISE_IN_USE):
--    - If any student submission is in progress (status = 'draft'):
--      RAISE EXCEPTION 'ERR_EXERCISE_IN_USE: Bài tập đang có học sinh làm bài dở dang. Chỉ có thể lưu trữ sau khi học sinh hoàn thành nộp bài.'
--    - If any assignment is active (due_date IS NULL OR due_date > NOW()):
--      RAISE EXCEPTION 'ERR_EXERCISE_IN_USE: Bài tập đang trong thời hạn giao cho lớp học. Vui lòng kết thúc thời hạn giao bài trước khi lưu trữ.'
--
-- 3. Used / Historical Exercise Archival (Soft Delete):
--    - If the exercise status != 'draft' (e.g. 'published', 'closed') OR has assignments, submissions,
--      or ranking entries (academic_ranking_entries):
--      * Set academic_exercises.status = 'archived', updated_at = pg_catalog.now()
--      * Submissions, answers, files, scores, and ranking entries remain 100% intact.
--      * Student submission files in bucket 'exercise-submissions' are NEVER touched or deleted.
--
-- 4. Clean Draft Exercise Hard-Delete (Database-Only):
--    - Hard delete ONLY when: status = 'draft' AND 0 assignments AND 0 submissions AND 0 rankings.
--    - Delete public.academic_exercise_questions for this exercise.
--    - Delete public.academic_exercises container.
--    - ARCHITECTURAL NOTE: Không quét Storage hay chèn job vào exercise_file_cleanup_jobs (bucket exercise-submissions
--      là của học sinh). Khi tương lai có attachment giáo viên, phải dùng bucket/cột metadata riêng và cleanup worker
--      riêng; không suy đoán từ nội dung văn bản.
--
-- 5. Security & Function Configuration:
--    - SECURITY DEFINER with SET search_path = '' (empty search path).
--    - Fully qualified table, type, and catalog function references throughout (pg_catalog.*).
--    - REVOKE ALL from PUBLIC, anon; GRANT EXECUTE to authenticated, service_role.
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_academic_delete_or_archive_exercise(
    p_exercise_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_is_admin BOOLEAN := FALSE;
    v_exercise RECORD;
    v_has_assignments BOOLEAN := FALSE;
    v_has_submissions BOOLEAN := FALSE;
    v_has_rankings BOOLEAN := FALSE;
    v_has_draft_submission BOOLEAN := FALSE;
    v_has_active_assignment BOOLEAN := FALSE;
    v_now TIMESTAMPTZ := pg_catalog.now();
BEGIN
    -- 1. Identity validation (Derived server-side from auth.uid())
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'ERR_CALLER_ID_REQUIRED: Bạn cần đăng nhập để thực hiện thao tác' USING ERRCODE = '22000';
    END IF;

    IF p_exercise_id IS NULL THEN
        RAISE EXCEPTION 'ERR_REQUIRED_PARAMS: exercise_id must be provided' USING ERRCODE = '22000';
    END IF;

    -- 2. Server-side Role Resolution (Fail-Closed: Only 'teacher' and 'admin')
    SELECT role INTO v_caller_role
    FROM public.profiles
    WHERE id = v_caller_id;

    IF v_caller_role IS NULL OR v_caller_role NOT IN ('teacher', 'admin') THEN
        RAISE EXCEPTION 'ERR_UNAUTHORIZED: Chỉ giáo viên hoặc quản trị viên mới có quyền thao tác' USING ERRCODE = '42501';
    END IF;

    v_is_admin := (v_caller_role = 'admin');

    -- 3. Lock and retrieve academic exercise row
    SELECT id, teacher_id, status, title
    INTO v_exercise
    FROM public.academic_exercises
    WHERE id = p_exercise_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_EXERCISE_NOT_FOUND: Không tìm thấy bài tập yêu cầu' USING ERRCODE = 'P0002';
    END IF;

    -- 4. Authorization check (Fail-Closed with IS DISTINCT FROM)
    IF NOT v_is_admin AND v_exercise.teacher_id IS DISTINCT FROM v_caller_id THEN
        RAISE EXCEPTION 'ERR_UNAUTHORIZED: Bạn không có quyền xóa hoặc lưu trữ bài tập này' USING ERRCODE = '42501';
    END IF;

    -- 5. Idempotency: If already archived, return success with archived status
    IF v_exercise.status = 'archived' THEN
        RETURN pg_catalog.jsonb_build_object(
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
          AND (due_date IS NULL OR due_date > v_now)
    ) INTO v_has_active_assignment;

    IF v_has_active_assignment THEN
        RAISE EXCEPTION 'ERR_EXERCISE_IN_USE: Bài tập đang trong thời hạn giao cho lớp học. Vui lòng kết thúc thời hạn giao bài trước khi lưu trữ.' USING ERRCODE = '55000';
    END IF;

    -- 7. Relational usage & history inspection
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

    SELECT EXISTS (
        SELECT 1
        FROM public.academic_ranking_entries
        WHERE exercise_id = p_exercise_id
    ) INTO v_has_rankings;

    -- 8. Branch execution: Soft Archive vs Hard Delete
    -- RULE: Hard-delete ONLY when status = 'draft' AND no assignments AND no submissions AND no rankings.
    -- All other statuses (published, closed) or items with relational history must be preserved via archive.
    IF v_exercise.status != 'draft' OR v_has_assignments OR v_has_submissions OR v_has_rankings THEN
        -- Case A: SOFT DELETE / ARCHIVE (Preserve 100% of historical data, rankings, files)
        UPDATE public.academic_exercises
        SET status = 'archived',
            updated_at = v_now
        WHERE id = p_exercise_id;

        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'action', 'archived',
            'exercise_id', p_exercise_id,
            'archived_at', v_now,
            'message', 'Bài tập đã được lưu trữ an toàn; toàn bộ bài nộp, điểm số và bảng xếp hạng vẫn được bảo toàn nguyên vẹn.'
        );
    ELSE
        -- Case B: HARD DELETE (Clean Draft: status = 'draft', 0 assignments, 0 submissions, 0 rankings)
        -- Database-only deletion. Không quét hay can thiệp Storage (bucket exercise-submissions thuộc về học sinh).
        -- Khi tương lai có attachment giáo viên, phải dùng bucket/cột metadata riêng và cleanup worker riêng; không suy đoán từ nội dung văn bản.
        DELETE FROM public.academic_exercise_questions
        WHERE exercise_id = p_exercise_id;

        DELETE FROM public.academic_exercises
        WHERE id = p_exercise_id;

        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'action', 'deleted',
            'exercise_id', p_exercise_id,
            'message', 'Bài tập nháp đã được xóa vĩnh viễn thành công.'
        );
    END IF;
END;
$$;

-- Revoke all permissions from public/anon and grant execute only to authenticated and service_role
REVOKE ALL ON FUNCTION public.rpc_academic_delete_or_archive_exercise(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_academic_delete_or_archive_exercise(UUID) TO authenticated, service_role;
