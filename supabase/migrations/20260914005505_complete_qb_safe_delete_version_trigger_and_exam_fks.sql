-- ============================================================
-- PR #80: COMPLETE HARD-DELETE SAFETY & RACE CONDITION PROTECTION
-- MIGRATION: 20260914005505_complete_qb_safe_delete_version_trigger_and_exam_fks.sql
-- TARGET SCHEMA: public
-- ============================================================
--
-- BUSINESS RULES & ARCHITECTURAL OBJECTIVES:
-- 1. Version Immutability & Safe-Delete Policy (public.fn_prevent_question_bank_version_mutation):
--    - Direct UPDATE is strictly prohibited in all cases (SQLSTATE 55000).
--    - Direct DELETE from any client/session is strictly prohibited by default (SQLSTATE 55000).
--    - DELETE is allowed ONLY when executed within the authorized transaction-local context
--      ('app_private.qb_hard_delete_item_id') established by public.rpc_qb_safe_delete_or_archive_question.
--    - Fail-closed re-checks in trigger before allowing DELETE:
--      a. Transaction-local context is present, non-empty, and a valid UUID.
--      b. Context UUID matches OLD.question_bank_item_id.
--      c. Parent item exists in public.question_bank_items.
--      d. Parent item status is strictly 'draft'.
--      e. Actual version count for the parent item is exactly 1.
--      f. No exam_questions reference the parent item (source_question_bank_item_id).
--      g. No exam_questions reference OLD.id or any version of the item (source_question_bank_version_id).
--      h. No fork lineage references OLD.id or any version of the item (forked_from_version_id).
--
-- 2. Foreign Key Protection against Concurrency Race Conditions:
--    - Adds Foreign Key from public.exam_questions(source_question_bank_item_id)
--      to public.question_bank_items(id) ON DELETE RESTRICT.
--    - Adds Foreign Key from public.exam_questions(source_question_bank_version_id)
--      to public.question_bank_versions(id) ON DELETE RESTRICT.
--    - Eliminates race conditions between Question Bank safe-delete and Exam Builder authoring.
--
-- 3. Security Hardening:
--    - SECURITY DEFINER with SET search_path = ''
--    - Full schema qualification (pg_catalog.*, public.*)
--    - Permissions revoked from PUBLIC, anon, authenticated, and service_role.
-- ============================================================

-- ------------------------------------------------------------
-- 1. UPDATE TRIGGER FUNCTION: public.fn_prevent_question_bank_version_mutation
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_prevent_question_bank_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_hard_delete_item_id pg_catalog.text;
    v_context_uuid pg_catalog.uuid;
    v_item_status pg_catalog.text;
    v_item_version_count pg_catalog.int4 := 0;
    v_has_exam_item_lineage pg_catalog.bool := false;
    v_has_exam_version_lineage pg_catalog.bool := false;
    v_has_fork_lineage pg_catalog.bool := false;
BEGIN
    -- 1. UPDATE is strictly prohibited in ALL circumstances
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'VERSION_IMMUTABILITY_VIOLATION: question_bank_versions rows are immutable (append-only). UPDATE is strictly prohibited.' USING ERRCODE = '55000';
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
            RAISE EXCEPTION 'VERSION_IMMUTABILITY_VIOLATION: question_bank_versions rows are immutable audit logs. DELETE is strictly prohibited.' USING ERRCODE = '55000';
        END IF;

        -- Validate that transaction-local context is a valid UUID
        BEGIN
            v_context_uuid := v_hard_delete_item_id::pg_catalog.uuid;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'VERSION_IMMUTABILITY_VIOLATION: Invalid transaction context item UUID.' USING ERRCODE = '55000';
        END;

        -- Verify that OLD.question_bank_item_id matches the authorized context UUID
        IF OLD.question_bank_item_id IS DISTINCT FROM v_context_uuid THEN
            RAISE EXCEPTION 'VERSION_IMMUTABILITY_VIOLATION: Question version does not belong to authorized hard-delete question context.' USING ERRCODE = '55000';
        END IF;

        -- Verify that the parent question item exists and is currently in 'draft' status
        SELECT qbi.status
        INTO v_item_status
        FROM public.question_bank_items qbi
        WHERE qbi.id = OLD.question_bank_item_id;

        IF NOT FOUND OR v_item_status IS NULL THEN
            RAISE EXCEPTION 'VERSION_IMMUTABILITY_VIOLATION: Parent question item does not exist.' USING ERRCODE = '55000';
        END IF;

        IF v_item_status IS DISTINCT FROM 'draft' THEN
            RAISE EXCEPTION 'VERSION_IMMUTABILITY_VIOLATION: Only draft question versions can be hard-deleted in trusted context.' USING ERRCODE = '55000';
        END IF;

        -- Fail-closed integrity re-checks: version count must be exactly 1
        SELECT pg_catalog.count(*)::pg_catalog.int4
        INTO v_item_version_count
        FROM public.question_bank_versions
        WHERE question_bank_item_id = OLD.question_bank_item_id;

        IF v_item_version_count <> 1 THEN
            RAISE EXCEPTION 'VERSION_IMMUTABILITY_VIOLATION: Multi-version question versions cannot be hard-deleted.' USING ERRCODE = '55000';
        END IF;

        -- Fail-closed lineage re-checks: No exam questions referencing parent item ID
        SELECT EXISTS (
            SELECT 1
            FROM public.exam_questions
            WHERE source_question_bank_item_id = OLD.question_bank_item_id
        ) INTO v_has_exam_item_lineage;

        IF v_has_exam_item_lineage THEN
            RAISE EXCEPTION 'VERSION_IMMUTABILITY_VIOLATION: Question versions referenced in exams cannot be hard-deleted.' USING ERRCODE = '55000';
        END IF;

        -- Fail-closed lineage re-checks: No exam questions referencing version ID
        SELECT EXISTS (
            SELECT 1
            FROM public.exam_questions
            WHERE source_question_bank_version_id = OLD.id
               OR source_question_bank_version_id IN (
                   SELECT id FROM public.question_bank_versions WHERE question_bank_item_id = OLD.question_bank_item_id
               )
        ) INTO v_has_exam_version_lineage;

        IF v_has_exam_version_lineage THEN
            RAISE EXCEPTION 'VERSION_IMMUTABILITY_VIOLATION: Question versions referenced in exams cannot be hard-deleted.' USING ERRCODE = '55000';
        END IF;

        -- Fail-closed lineage re-checks: No fork lineage referencing any version of this item
        SELECT EXISTS (
            SELECT 1
            FROM public.question_bank_versions
            WHERE forked_from_version_id = OLD.id
               OR forked_from_version_id IN (
                   SELECT id FROM public.question_bank_versions WHERE question_bank_item_id = OLD.question_bank_item_id
               )
        ) INTO v_has_fork_lineage;

        IF v_has_fork_lineage THEN
            RAISE EXCEPTION 'VERSION_IMMUTABILITY_VIOLATION: Question versions referenced in fork lineage cannot be hard-deleted.' USING ERRCODE = '55000';
        END IF;

        -- All strict checks passed: Allow DELETE for clean draft within trusted transaction
        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$;

-- Security Grants: Revoke all execute rights (owner postgres retains execution for trigger)
REVOKE ALL ON FUNCTION public.fn_prevent_question_bank_version_mutation() FROM PUBLIC, anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 2. ADD FOREIGN KEYS ON public.exam_questions (ON DELETE RESTRICT)
-- ------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_exam_questions_source_qb_item'
    ) THEN
        ALTER TABLE public.exam_questions
            ADD CONSTRAINT fk_exam_questions_source_qb_item
            FOREIGN KEY (source_question_bank_item_id)
            REFERENCES public.question_bank_items(id)
            ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_exam_questions_source_qb_version'
    ) THEN
        ALTER TABLE public.exam_questions
            ADD CONSTRAINT fk_exam_questions_source_qb_version
            FOREIGN KEY (source_question_bank_version_id)
            REFERENCES public.question_bank_versions(id)
            ON DELETE RESTRICT;
    END IF;
END $$;
