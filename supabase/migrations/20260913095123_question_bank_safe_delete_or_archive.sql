-- ============================================================
-- QUESTION BANK SAFE DELETE & ARCHIVE RPC (PHASE 2 IMPLEMENTATION)
-- MIGRATION: 20260913095123_question_bank_safe_delete_or_archive.sql
-- TARGET SCHEMA: public, app_private
-- ============================================================
--
-- BUSINESS RULES & TRUST BOUNDARY:
-- 1. Identity & Role Verification (Three-Client / BFF Trust Boundary):
--    - Edge Function verifies JWT using Core Auth (auth.getUser()), deriving callerId.
--    - Edge Function reads role from Core public.profiles using CORE_SERVICE_ROLE_KEY.
--    - Edge Function passes verified p_caller_id and p_actor_role to this RPC using QUESTION_BANK_SERVICE_ROLE_KEY.
--    - RPC is granted ONLY to service_role (REVOKED from PUBLIC, anon, authenticated).
--
-- 2. Authorization & Ownership Checks (Fail-Closed):
--    - Only 'teacher' and 'admin' roles are allowed.
--    - Admin can delete/archive any question item.
--    - Teacher can ONLY delete/archive question items where author_id = p_caller_id.
--
-- 3. Hard-Delete Policy (Clean Drafts with exactly 1 version):
--    - Criteria: status = 'draft' AND actual version_count = 1 AND no exam lineage AND no fork lineage.
--    - Zero-version or multi-version items FAIL-CLOSED to archive, NEVER hard-delete.
--    - Safe Circular FK Deletion Sequence:
--      a. UPDATE public.question_bank_items SET current_version_id = NULL WHERE id = p_item_id;
--      b. DELETE FROM app_private.question_bank_answer_keys WHERE version_id IN (...);
--      c. DELETE FROM public.question_bank_versions WHERE question_bank_item_id = p_item_id;
--      d. DELETE FROM public.question_bank_items WHERE id = p_item_id;
--    - Storage files are NOT deleted in V1.
--
-- 4. Archive Policy (Used / Historical / Published Questions):
--    - Criteria: status IN ('published', 'archived') OR version_count <> 1 OR has exam lineage OR has fork lineage.
--    - If already archived: returns action = 'already_archived' without mutation.
--    - Otherwise: UPDATE status = 'archived', updated_at = NOW(), returns action = 'archived'.
--
-- 5. Security Hardening:
--    - SECURITY DEFINER with SET search_path = ''
--    - Schema-qualify all functions, tables, and types (pg_catalog.*, public.*, app_private.*).
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_qb_safe_delete_or_archive_question(
    p_caller_id pg_catalog.uuid,
    p_actor_role pg_catalog.text,
    p_item_id pg_catalog.uuid
)
RETURNS pg_catalog.jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_item RECORD;
    v_actual_version_count pg_catalog.int4 := 0;
    v_has_exam_lineage pg_catalog.bool := false;
    v_has_fork_lineage pg_catalog.bool := false;
    v_now pg_catalog.timestamptz := pg_catalog.now();
BEGIN
    -- 1. Fail-closed Parameter & Role Validation
    IF p_caller_id IS NULL THEN
        RAISE EXCEPTION 'ERR_UNAUTHORIZED: Caller ID is required' USING ERRCODE = '42501';
    END IF;

    IF p_actor_role IS NULL OR p_actor_role NOT IN ('admin', 'teacher') THEN
        RAISE EXCEPTION 'ERR_UNAUTHORIZED: Chỉ giáo viên hoặc quản trị viên mới có quyền thao tác' USING ERRCODE = '42501';
    END IF;

    IF p_item_id IS NULL THEN
        RAISE EXCEPTION 'ERR_REQUIRED_PARAMS: Item ID is required' USING ERRCODE = '22000';
    END IF;

    -- 2. Lock & Retrieve Question Item
    SELECT id, author_id, status, current_version_id
    INTO v_item
    FROM public.question_bank_items
    WHERE id = p_item_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_ITEM_NOT_FOUND: Không tìm thấy câu hỏi yêu cầu' USING ERRCODE = 'P0002';
    END IF;

    -- 3. Ownership Authorization Check
    IF p_actor_role <> 'admin' AND v_item.author_id IS DISTINCT FROM p_caller_id THEN
        RAISE EXCEPTION 'ERR_UNAUTHORIZED: Bạn không có quyền xóa hoặc lưu trữ câu hỏi của người khác' USING ERRCODE = '42501';
    END IF;

    -- 4. Idempotency Check for Already Archived Item
    IF v_item.status = 'archived' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'action', 'already_archived',
            'item_id', p_item_id,
            'message', 'Câu hỏi đã ở trạng thái lưu trữ từ trước.'
        );
    END IF;

    -- 5. Count Actual Versions in public.question_bank_versions (Fail-closed on 0 or > 1)
    SELECT pg_catalog.count(*)::pg_catalog.int4
    INTO v_actual_version_count
    FROM public.question_bank_versions
    WHERE question_bank_item_id = p_item_id;

    -- 6. Lineage Checks (Using EXISTS to safely determine relational presence)
    -- 6.1. Exam Builder Lineage (Used in exam_questions)
    SELECT EXISTS (
        SELECT 1
        FROM public.exam_questions
        WHERE source_question_bank_item_id = p_item_id
    ) INTO v_has_exam_lineage;

    -- 6.2. Fork Lineage (Another question version was forked from any version of this item)
    SELECT EXISTS (
        SELECT 1
        FROM public.question_bank_versions
        WHERE forked_from_version_id IN (
            SELECT id FROM public.question_bank_versions WHERE question_bank_item_id = p_item_id
        )
    ) INTO v_has_fork_lineage;

    -- 7. Decision Branch: Hard-Delete vs Archive
    -- Hard-delete ONLY when status is draft AND actual versions count is EXACTLY 1 AND no lineage exists
    IF v_item.status = 'draft'
       AND v_actual_version_count = 1
       AND NOT v_has_exam_lineage
       AND NOT v_has_fork_lineage
    THEN
        -- Case A: HARD DELETE (Clean Draft with exactly 1 version and no history / lineage)
        -- Step 1: Break circular FK
        UPDATE public.question_bank_items
        SET current_version_id = NULL
        WHERE id = p_item_id;

        -- Step 2: Delete private answer keys
        DELETE FROM app_private.question_bank_answer_keys
        WHERE version_id IN (
            SELECT id FROM public.question_bank_versions WHERE question_bank_item_id = p_item_id
        );

        -- Step 3: Delete versions
        DELETE FROM public.question_bank_versions
        WHERE question_bank_item_id = p_item_id;

        -- Step 4: Delete item container
        DELETE FROM public.question_bank_items
        WHERE id = p_item_id;

        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'action', 'deleted',
            'item_id', p_item_id,
            'version_count', v_actual_version_count,
            'message', 'Câu hỏi bản nháp đã được xóa vĩnh viễn.'
        );
    ELSE
        -- Case B: SOFT DELETE / ARCHIVE (Published, version_count <> 1, zero version, or referenced in lineage)
        UPDATE public.question_bank_items
        SET status = 'archived',
            updated_at = v_now
        WHERE id = p_item_id;

        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'action', 'archived',
            'item_id', p_item_id,
            'version_count', v_actual_version_count,
            'archived_at', v_now,
            'message', 'Câu hỏi đã được chuyển vào lưu trữ an toàn.'
        );
    END IF;
END;
$$;

-- Security Grants (Fail-Closed: service_role ONLY)
REVOKE ALL ON FUNCTION public.rpc_qb_safe_delete_or_archive_question(pg_catalog.uuid, pg_catalog.text, pg_catalog.uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_qb_safe_delete_or_archive_question(pg_catalog.uuid, pg_catalog.text, pg_catalog.uuid) TO service_role;
