-- supabase/migrations/20260909000010_exam_builder_v1_get_attempt_questions_option_orders_fix.sql
-- Exam Builder V1 - Phase 3E-B Forward-only Fix for Option Snapshot Semantics
-- Aligns rpc_exam_get_attempt_questions with rpc_exam_start_attempt option_orders invariant:
-- CASE A (shuffle_options = false): Natural source option order projected; empty/absent option_orders[q.id] is valid.
-- CASE B (shuffle_options = true): Strict option_orders snapshot validation preserved; missing snapshot raises ERR_OPTION_SNAPSHOT_INVALID.

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_exam_get_attempt_questions(
    p_caller_id UUID,
    p_attempt_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private
AS $$
DECLARE
    v_attempt RECORD;
    v_shuffle_options BOOLEAN;
    v_db_q_count INT;
    v_matched_count INT;
    v_questions_json JSONB := '[]'::jsonb;
    v_q RECORD;
    v_q_elem RECORD;
    v_ordered_options JSONB;
    v_opt_val JSONB;
    v_opt_key TEXT;
    v_opt_text TEXT;
    v_source_opt_count INT;
    v_opt_order_arr JSONB;
    v_opt_item RECORD;
    v_seen_keys TEXT[];
    v_seen_order_keys TEXT[];
BEGIN
    -- 1. Input parameter validation
    IF p_caller_id IS NULL OR p_attempt_id IS NULL THEN
        RAISE EXCEPTION 'ERR_REQUIRED_PARAMS: caller_id and attempt_id are required' USING ERRCODE = '22000';
    END IF;

    -- 2. Resolve attempt with BOTH id and student_id (Anti-Oracle Defense-in-depth)
    SELECT * INTO v_attempt
    FROM public.exam_attempts
    WHERE id = p_attempt_id
      AND student_id = p_caller_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_ATTEMPT_NOT_FOUND: Attempt not found or access denied' USING ERRCODE = 'P0002';
    END IF;

    -- 3. Validate attempt status: ONLY draft allowed
    IF v_attempt.status IN ('submitted', 'pending_manual_grade', 'graded') THEN
        RAISE EXCEPTION 'ERR_ATTEMPT_FINALIZED: Attempt is already finalized' USING ERRCODE = '25000';
    ELSIF v_attempt.status <> 'draft' THEN
        RAISE EXCEPTION 'ERR_ATTEMPT_NOT_DRAFT: Attempt is not in draft status' USING ERRCODE = '25000';
    END IF;

    -- 4. Validate expiration (Server-authoritative check with clock_timestamp())
    IF v_attempt.expires_at IS NOT NULL AND clock_timestamp() >= v_attempt.expires_at THEN
        RAISE EXCEPTION 'ERR_ATTEMPT_EXPIRED: Attempt has expired' USING ERRCODE = '25000';
    END IF;

    -- 5. Resolve version shuffle_options policy
    SELECT shuffle_options INTO v_shuffle_options
    FROM public.exam_versions
    WHERE id = v_attempt.exam_version_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_VERSION_NOT_FOUND: Exam version does not exist' USING ERRCODE = 'P0002';
    END IF;

    -- 6. Full Question Snapshot Permutation Validation
    IF v_attempt.question_order IS NULL 
       OR jsonb_typeof(v_attempt.question_order) <> 'array' 
       OR jsonb_array_length(v_attempt.question_order) = 0 THEN
        RAISE EXCEPTION 'ERR_ATTEMPT_SNAPSHOT_INVALID: Invalid attempt snapshot' USING ERRCODE = '22023';
    END IF;

    -- Validate every element in question_order is a string and valid UUID format
    FOR v_q_elem IN SELECT value, ordinality FROM jsonb_array_elements(v_attempt.question_order) WITH ORDINALITY LOOP
        IF jsonb_typeof(v_q_elem.value) <> 'string' THEN
            RAISE EXCEPTION 'ERR_ATTEMPT_SNAPSHOT_INVALID: Invalid attempt snapshot' USING ERRCODE = '22023';
        END IF;
        IF (v_q_elem.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RAISE EXCEPTION 'ERR_ATTEMPT_SNAPSHOT_INVALID: Invalid attempt snapshot' USING ERRCODE = '22023';
        END IF;
    END LOOP;

    -- Check for duplicate UUIDs in question_order
    SELECT count(DISTINCT value #>> '{}') INTO v_matched_count
    FROM jsonb_array_elements(v_attempt.question_order);

    IF v_matched_count <> jsonb_array_length(v_attempt.question_order) THEN
        RAISE EXCEPTION 'ERR_ATTEMPT_SNAPSHOT_INVALID: Invalid attempt snapshot' USING ERRCODE = '22023';
    END IF;

    -- Check DB question count for this version
    SELECT count(*) INTO v_db_q_count
    FROM public.exam_questions
    WHERE exam_version_id = v_attempt.exam_version_id;

    IF v_db_q_count = 0 OR v_db_q_count <> jsonb_array_length(v_attempt.question_order) THEN
        RAISE EXCEPTION 'ERR_ATTEMPT_SNAPSHOT_INVALID: Invalid attempt snapshot' USING ERRCODE = '22023';
    END IF;

    -- Check that every snapshot ID exists in exam_questions for this version
    SELECT count(*) INTO v_matched_count
    FROM jsonb_array_elements_text(v_attempt.question_order) AS s(q_id)
    JOIN public.exam_questions q ON q.id = s.q_id::uuid AND q.exam_version_id = v_attempt.exam_version_id;

    IF v_matched_count <> v_db_q_count THEN
        RAISE EXCEPTION 'ERR_ATTEMPT_SNAPSHOT_INVALID: Invalid attempt snapshot' USING ERRCODE = '22023';
    END IF;

    -- 7. Validate option_orders container
    IF v_attempt.option_orders IS NULL OR jsonb_typeof(v_attempt.option_orders) <> 'object' THEN
        RAISE EXCEPTION 'ERR_OPTION_SNAPSHOT_INVALID: Invalid option snapshot' USING ERRCODE = '22023';
    END IF;

    -- 8. Fetch questions in EXACT question_order sequence and project safely
    FOR v_q IN 
        SELECT 
            q.id,
            q.question_type,
            q.prompt,
            q.options_json,
            q.points,
            s.ord
        FROM jsonb_array_elements_text(v_attempt.question_order) WITH ORDINALITY AS s(q_id, ord)
        JOIN public.exam_questions q ON q.id = s.q_id::uuid AND q.exam_version_id = v_attempt.exam_version_id
        ORDER BY s.ord ASC
    LOOP
        -- Validate question_type
        IF v_q.question_type NOT IN ('single_choice', 'multiple_choice', 'fill_blank', 'short_answer', 'essay', 'image_upload', 'file_upload') THEN
            RAISE EXCEPTION 'ERR_QUESTION_SNAPSHOT_INVALID: Invalid question snapshot' USING ERRCODE = '22023';
        END IF;

        IF v_q.points <= 0 THEN
            RAISE EXCEPTION 'ERR_QUESTION_SNAPSHOT_INVALID: Invalid question snapshot' USING ERRCODE = '22023';
        END IF;

        -- Process choice vs non-choice options
        IF v_q.question_type IN ('single_choice', 'multiple_choice') THEN
            -- Validate source options_json schema
            IF v_q.options_json IS NULL 
               OR jsonb_typeof(v_q.options_json) <> 'array' 
               OR jsonb_array_length(v_q.options_json) = 0 THEN
                RAISE EXCEPTION 'ERR_INVALID_OPTION_SCHEMA: Invalid choice option schema' USING ERRCODE = '22023';
            END IF;

            v_source_opt_count := jsonb_array_length(v_q.options_json);
            v_seen_keys := ARRAY[]::TEXT[];

            -- Validate each source option item strictly by JSON types
            FOR v_opt_val IN SELECT value FROM jsonb_array_elements(v_q.options_json) LOOP
                IF jsonb_typeof(v_opt_val) <> 'object' THEN
                    RAISE EXCEPTION 'ERR_INVALID_OPTION_SCHEMA: Invalid choice option schema' USING ERRCODE = '22023';
                END IF;

                IF NOT (v_opt_val ? 'key') OR jsonb_typeof(v_opt_val->'key') <> 'string' THEN
                    RAISE EXCEPTION 'ERR_INVALID_OPTION_SCHEMA: Invalid choice option schema' USING ERRCODE = '22023';
                END IF;

                v_opt_key := v_opt_val->>'key';
                IF btrim(v_opt_key) = '' THEN
                    RAISE EXCEPTION 'ERR_INVALID_OPTION_SCHEMA: Invalid choice option schema' USING ERRCODE = '22023';
                END IF;

                IF v_opt_key = ANY(v_seen_keys) THEN
                    RAISE EXCEPTION 'ERR_INVALID_OPTION_SCHEMA: Invalid choice option schema' USING ERRCODE = '22023';
                END IF;
                v_seen_keys := array_append(v_seen_keys, v_opt_key);

                IF NOT (v_opt_val ? 'text') OR jsonb_typeof(v_opt_val->'text') <> 'string' THEN
                    RAISE EXCEPTION 'ERR_INVALID_OPTION_SCHEMA: Invalid choice option schema' USING ERRCODE = '22023';
                END IF;
            END LOOP;

            IF v_shuffle_options THEN
                -- CASE B: shuffle_options = TRUE -> Strict option_orders snapshot required
                IF NOT (v_attempt.option_orders ? v_q.id::text) THEN
                    RAISE EXCEPTION 'ERR_OPTION_SNAPSHOT_INVALID: Invalid option snapshot' USING ERRCODE = '22023';
                END IF;

                v_opt_order_arr := v_attempt.option_orders->v_q.id::text;
                IF jsonb_typeof(v_opt_order_arr) <> 'array' THEN
                    RAISE EXCEPTION 'ERR_OPTION_SNAPSHOT_INVALID: Invalid option snapshot' USING ERRCODE = '22023';
                END IF;

                IF jsonb_array_length(v_opt_order_arr) <> v_source_opt_count THEN
                    RAISE EXCEPTION 'ERR_OPTION_SNAPSHOT_INVALID: Invalid option snapshot' USING ERRCODE = '22023';
                END IF;

                v_seen_order_keys := ARRAY[]::TEXT[];
                v_ordered_options := '[]'::jsonb;

                FOR v_opt_item IN SELECT value, ordinality FROM jsonb_array_elements(v_opt_order_arr) WITH ORDINALITY LOOP
                    IF jsonb_typeof(v_opt_item.value) <> 'string' THEN
                        RAISE EXCEPTION 'ERR_OPTION_SNAPSHOT_INVALID: Invalid option snapshot' USING ERRCODE = '22023';
                    END IF;

                    v_opt_key := v_opt_item.value #>> '{}';
                    IF btrim(v_opt_key) = '' THEN
                        RAISE EXCEPTION 'ERR_OPTION_SNAPSHOT_INVALID: Invalid option snapshot' USING ERRCODE = '22023';
                    END IF;

                    IF v_opt_key = ANY(v_seen_order_keys) THEN
                        RAISE EXCEPTION 'ERR_OPTION_SNAPSHOT_INVALID: Invalid option snapshot' USING ERRCODE = '22023';
                    END IF;
                    v_seen_order_keys := array_append(v_seen_order_keys, v_opt_key);

                    -- Verify key exists in source options
                    IF NOT (v_opt_key = ANY(v_seen_keys)) THEN
                        RAISE EXCEPTION 'ERR_OPTION_SNAPSHOT_INVALID: Invalid option snapshot' USING ERRCODE = '22023';
                    END IF;

                    -- Look up source option text
                    SELECT value->>'text' INTO v_opt_text
                    FROM jsonb_array_elements(v_q.options_json)
                    WHERE value->>'key' = v_opt_key;

                    -- Project safe option object (EXACTLY 2 fields: key, text)
                    v_ordered_options := v_ordered_options || jsonb_build_array(
                        jsonb_build_object(
                            'key', v_opt_key,
                            'text', v_opt_text
                        )
                    );
                END LOOP;

                IF array_length(v_seen_order_keys, 1) <> array_length(v_seen_keys, 1) THEN
                    RAISE EXCEPTION 'ERR_OPTION_SNAPSHOT_INVALID: Invalid option snapshot' USING ERRCODE = '22023';
                END IF;
            ELSE
                -- CASE A: shuffle_options = FALSE -> Natural source option order
                v_ordered_options := '[]'::jsonb;
                FOR v_opt_val IN SELECT value FROM jsonb_array_elements(v_q.options_json) LOOP
                    v_ordered_options := v_ordered_options || jsonb_build_array(
                        jsonb_build_object(
                            'key', v_opt_val->>'key',
                            'text', v_opt_val->>'text'
                        )
                    );
                END LOOP;
            END IF;
        ELSE
            -- Non-choice question types: options = []
            v_ordered_options := '[]'::jsonb;
        END IF;

        -- Append safe question projection (EXACTLY 5 fields)
        v_questions_json := v_questions_json || jsonb_build_array(
            jsonb_build_object(
                'id', v_q.id,
                'question_type', v_q.question_type,
                'prompt', v_q.prompt,
                'points', v_q.points,
                'options', v_ordered_options
            )
        );
    END LOOP;

    -- Return safe RPC payload (EXACTLY 4 fields)
    RETURN jsonb_build_object(
        'attempt_id', v_attempt.id,
        'exam_version_id', v_attempt.exam_version_id,
        'status', v_attempt.status,
        'questions', v_questions_json
    );
END;
$$;

ALTER FUNCTION public.rpc_exam_get_attempt_questions(UUID, UUID) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.rpc_exam_get_attempt_questions(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_exam_get_attempt_questions(UUID, UUID) TO service_role;

COMMIT;
