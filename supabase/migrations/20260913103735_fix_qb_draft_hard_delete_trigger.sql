-- ============================================================
-- FIX QUESTION BANK DRAFT HARD-DELETE TRIGGER CONFLICT
-- MIGRATION: 20260913103735_fix_qb_draft_hard_delete_trigger.sql
-- TARGET SCHEMA: app_private, public
-- ============================================================
--
-- BUSINESS RULES & TRUST BOUNDARY:
-- 1. Immutability Protection (app_private.fn_prevent_answer_key_mutation):
--    - Direct UPDATE is strictly prohibited in all cases.
--    - Direct DELETE from any client/session is blocked with SQLSTATE 55000 by default.
--    - DELETE is allowed ONLY when executed within a transaction-local context
--      ('app_private.qb_hard_delete_item_id') set by the trusted hard-delete RPC.
--    - The trigger verifies that:
--      a. Transaction-local context is present and matches the item containing OLD.version_id.
--      b. The question item is in 'draft' status.
--      c. The version count is exactly 1.
--      d. There is no exam lineage and no fork lineage.
--
-- 2. Safe Delete RPC (public.rpc_qb_safe_delete_or_archive_question):
--    - Re-asserts FOR UPDATE row lock and fail-closed permission/lineage checks.
--    - Sets transaction-local context: pg_catalog.set_config('app_private.qb_hard_delete_item_id', p_item_id::pg_catalog.text, true)
--    - Sequentially deletes answer keys, versions, and item container.
--
-- 3. Security Hardening:
--    - SECURITY DEFINER with SET search_path = '' on both functions.
--    - Full schema qualification (pg_catalog.*, public.*, app_private.*).
--    - PUBLIC/anon/authenticated have NO execute permissions.
-- ============================================================

-- ------------------------------------------------------------
-- 1. UPDATE TRIGGER FUNCTION: app_private.fn_prevent_answer_key_mutation
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.fn_prevent_answer_key_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_hard_delete_item_id pg_catalog.text;
    v_target_item_id pg_catalog.uuid;
    v_item_status pg_catalog.text;
    v_item_version_count pg_catalog.int4 := 0;
    v_has_exam_lineage pg_catalog.bool := false;
    v_has_fork_lineage pg_catalog.bool := false;
BEGIN
    -- 1. UPDATE is strictly prohibited in ALL circumstances
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'ANSWER_KEY_IMMUTABILITY_VIOLATION: Answer keys bound to immutable versions cannot be modified. UPDATE is strictly prohibited.' USING ERRCODE = '55000';
    END IF;

    -- 2. DELETE is prohibited by default, EXCEPT when authorized by transaction-local hard-delete context
    IF TG_OP = 'DELETE' THEN
        -- Retrieve transaction-local config (set via set_config(..., ..., true))
        BEGIN
            v_hard_delete_item_id := pg_catalog.current_setting('app_private.qb_hard_delete_item_id', true);
        EXCEPTION WHEN OTHERS THEN
            v_hard_delete_item_id := NULL;
        END;

        -- If no transaction-local context is active or empty, immediately block direct DELETE
        IF v_hard_delete_item_id IS NULL OR v_hard_delete_item_id = '' THEN
            RAISE EXCEPTION 'ANSWER_KEY_IMMUTABILITY_VIOLATION: Answer keys bound to immutable versions cannot be deleted directly. DELETE is strictly prohibited.' USING ERRCODE = '55000';
        END IF;

        -- Verify that OLD.version_id belongs to a version belonging to the authorized item
        SELECT qbv.question_bank_item_id
        INTO v_target_item_id
        FROM public.question_bank_versions qbv
        WHERE qbv.id = OLD.version_id;

        IF v_target_item_id IS NULL OR v_target_item_id::pg_catalog.text <> v_hard_delete_item_id THEN
            RAISE EXCEPTION 'ANSWER_KEY_IMMUTABILITY_VIOLATION: Answer key does not belong to authorized hard-delete question context.' USING ERRCODE = '55000';
        END IF;

        -- Verify that the question item is currently in 'draft' status
        SELECT qbi.status
        INTO v_item_status
        FROM public.question_bank_items qbi
        WHERE qbi.id = v_target_item_id;

        IF v_item_status IS DISTINCT FROM 'draft' THEN
            RAISE EXCEPTION 'ANSWER_KEY_IMMUTABILITY_VIOLATION: Only draft question answer keys can be hard-deleted in trusted context.' USING ERRCODE = '55000';
        END IF;

        -- Fail-closed integrity re-checks: version_count must be 1, no exam usage, no fork lineage
        SELECT pg_catalog.count(*)::pg_catalog.int4
        INTO v_item_version_count
        FROM public.question_bank_versions
        WHERE question_bank_item_id = v_target_item_id;

        IF v_item_version_count <> 1 THEN
            RAISE EXCEPTION 'ANSWER_KEY_IMMUTABILITY_VIOLATION: Multi-version question answer keys cannot be hard-deleted.' USING ERRCODE = '55000';
        END IF;

        SELECT EXISTS (
            SELECT 1
            FROM public.exam_questions
            WHERE source_question_bank_item_id = v_target_item_id
        ) INTO v_has_exam_lineage;

        IF v_has_exam_lineage THEN
            RAISE EXCEPTION 'ANSWER_KEY_IMMUTABILITY_VIOLATION: Answer keys referenced in exams cannot be hard-deleted.' USING ERRCODE = '55000';
        END IF;

        SELECT EXISTS (
            SELECT 1
            FROM public.question_bank_versions
            WHERE forked_from_version_id IN (
                SELECT id FROM public.question_bank_versions WHERE question_bank_item_id = v_target_item_id
            )
        ) INTO v_has_fork_lineage;

        IF v_has_fork_lineage THEN
            RAISE EXCEPTION 'ANSWER_KEY_IMMUTABILITY_VIOLATION: Answer keys referenced in fork lineage cannot be hard-deleted.' USING ERRCODE = '55000';
        END IF;

        -- All strict checks passed: Allow DELETE for clean draft within trusted transaction
        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION app_private.fn_prevent_answer_key_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.fn_prevent_answer_key_mutation() TO postgres, service_role;

-- ------------------------------------------------------------
-- 2. UPDATE RPC FUNCTION: public.rpc_qb_safe_delete_or_archive_question
-- ------------------------------------------------------------
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
        -- Set transaction-local context for answer key deletion (is_local = true)
        PERFORM pg_catalog.set_config('app_private.qb_hard_delete_item_id', p_item_id::pg_catalog.text, true);

        -- Step 1: Break circular FK
        UPDATE public.question_bank_items
        SET current_version_id = NULL
        WHERE id = p_item_id;

        -- Step 2: Delete private answer keys (authorized by transaction-local context)
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
