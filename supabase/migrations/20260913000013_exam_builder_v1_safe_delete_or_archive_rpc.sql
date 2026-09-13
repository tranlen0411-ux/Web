-- ============================================================
-- TEST / EXAM BUILDER V1
-- SAFE DELETE OR ARCHIVE EXAM RPC
-- MIGRATION: 20260913000013_exam_builder_v1_safe_delete_or_archive_rpc.sql
-- TARGET_PROJECT_REF: szptvqkoiphrhlionfoh
-- FORBIDDEN_CORE_REF: nddimmxpymipalpxlops
-- ============================================================
--
-- BUSINESS RULES:
-- 1. Clean Draft Exams (never assigned, no student attempts, no published versions):
--    - Hard delete in atomic transaction.
--    - Safe deletion order:
--      a. Break circular composite FK: UPDATE exam_tests SET current_version_id = NULL
--      b. Delete app_private.exam_answer_keys for all related questions
--      c. Delete public.exam_questions for all versions of this exam
--      d. Delete public.exam_versions for this exam
--      e. Delete public.exam_tests container
--
-- 2. Active / Published / Assigned / Attempted Exams:
--    - NEVER delete assignments, attempts, attempt answers, or grading records.
--    - Soft delete / Archive:
--      a. Set exam_tests.status = 'archived', archived_at = NOW(), updated_at = NOW()
--      b. Set any draft exam_versions.status = 'archived'
--      c. Published exam_versions remain intact for historical & attempt review integrity.
--
-- 3. Authorization (RBAC):
--    - Teachers can only delete/archive exams they authored (author_id = p_caller_id).
--    - Admins can delete/archive any exam.
--    - Students and unauthenticated callers are rejected.
--    - Fail closed if caller is unauthorized or exam not found.
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_exam_delete_or_archive_test(
    p_caller_id UUID,
    p_exam_id UUID,
    p_is_admin BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private
AS $$
DECLARE
    v_test RECORD;
    v_has_assignments BOOLEAN := FALSE;
    v_has_attempts BOOLEAN := FALSE;
    v_has_published BOOLEAN := FALSE;
BEGIN
    -- 1. Input sanitization & validation
    IF p_caller_id IS NULL THEN
        RAISE EXCEPTION 'ERR_CALLER_ID_REQUIRED: Caller identity is required' USING ERRCODE = '22000';
    END IF;

    IF p_exam_id IS NULL THEN
        RAISE EXCEPTION 'ERR_REQUIRED_PARAMS: exam_id must be provided' USING ERRCODE = '22000';
    END IF;

    -- 2. Lock and retrieve exam row
    SELECT id, author_id, status, title
    INTO v_test
    FROM public.exam_tests
    WHERE id = p_exam_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_EXAM_NOT_FOUND: Không tìm thấy đề thi yêu cầu' USING ERRCODE = 'P0002';
    END IF;

    -- 3. Authorization check (Fail Closed)
    IF NOT COALESCE(p_is_admin, FALSE) AND v_test.author_id != p_caller_id THEN
        RAISE EXCEPTION 'ERR_UNAUTHORIZED: Bạn không có quyền xóa hoặc lưu trữ đề thi này' USING ERRCODE = '42501';
    END IF;

    -- 4. Idempotency: If already archived, return success with archived status
    IF v_test.status = 'archived' THEN
        RETURN jsonb_build_object(
            'success', true,
            'action', 'already_archived',
            'exam_id', p_exam_id,
            'message', 'Đề thi đã ở trạng thái lưu trữ từ trước.'
        );
    END IF;

    -- 5. Relational usage inspection across all versions
    -- Check if any version has assignments
    SELECT EXISTS (
        SELECT 1
        FROM public.exam_assignments a
        JOIN public.exam_versions v ON a.exam_version_id = v.id
        WHERE v.exam_id = p_exam_id
    ) INTO v_has_assignments;

    -- Check if any version has attempts (student submissions or in-progress drafts)
    SELECT EXISTS (
        SELECT 1
        FROM public.exam_attempts att
        JOIN public.exam_versions v ON att.exam_version_id = v.id
        WHERE v.exam_id = p_exam_id
    ) INTO v_has_attempts;

    -- Check if any version is published or superseded
    SELECT EXISTS (
        SELECT 1
        FROM public.exam_versions
        WHERE exam_id = p_exam_id
          AND status IN ('published', 'superseded')
    ) INTO v_has_published;

    -- 6. Branch execution: Archive vs Hard Delete
    IF v_has_assignments OR v_has_attempts OR v_has_published THEN
        -- Case A: SOFT DELETE / ARCHIVE
        -- Protect all student attempts, submissions, answers, scores, and class assignment history
        UPDATE public.exam_tests
        SET status = 'archived',
            archived_at = NOW(),
            updated_at = NOW()
        WHERE id = p_exam_id;

        -- Update any draft version to archived so no further edits can occur
        UPDATE public.exam_versions
        SET status = 'archived'
        WHERE exam_id = p_exam_id
          AND status = 'draft';

        RETURN jsonb_build_object(
            'success', true,
            'action', 'archived',
            'exam_id', p_exam_id,
            'message', 'Đề thi đã được lưu trữ an toàn; toàn bộ lịch sử giao bài và kết quả học sinh vẫn được bảo toàn nguyên vẹn.'
        );
    ELSE
        -- Case B: HARD DELETE (Clean Draft with no assignments, no attempts, no published versions)
        -- Order of deletion respects all foreign key constraints:

        -- Step 1: Break circular composite FK on exam_tests.current_version_id
        UPDATE public.exam_tests
        SET current_version_id = NULL
        WHERE id = p_exam_id;

        -- Step 2: Delete private answer keys for all questions in this exam
        DELETE FROM app_private.exam_answer_keys
        WHERE question_id IN (
            SELECT q.id
            FROM public.exam_questions q
            JOIN public.exam_versions v ON q.exam_version_id = v.id
            WHERE v.exam_id = p_exam_id
        );

        -- Step 3: Delete exam questions for all versions of this exam
        DELETE FROM public.exam_questions
        WHERE exam_version_id IN (
            SELECT id
            FROM public.exam_versions
            WHERE exam_id = p_exam_id
        );

        -- Step 4: Delete exam versions
        DELETE FROM public.exam_versions
        WHERE exam_id = p_exam_id;

        -- Step 5: Delete exam_tests container
        DELETE FROM public.exam_tests
        WHERE id = p_exam_id;

        RETURN jsonb_build_object(
            'success', true,
            'action', 'deleted',
            'exam_id', p_exam_id,
            'message', 'Đề thi nháp đã được xóa vĩnh viễn thành công.'
        );
    END IF;
END;
$$;

-- Revoke all permissions and grant execute exclusively to service_role
REVOKE ALL ON FUNCTION public.rpc_exam_delete_or_archive_test(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_exam_delete_or_archive_test(UUID, UUID, BOOLEAN) TO service_role;
