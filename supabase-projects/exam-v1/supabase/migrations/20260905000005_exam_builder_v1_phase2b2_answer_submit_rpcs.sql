-- ============================================================
-- TEST / EXAM BUILDER V1
-- PHASE 2B2: SAVE ANSWER + SUBMIT ATTEMPT RPCS
-- TARGET_PROJECT_REF: szptvqkoiphrhlionfoh
-- FORBIDDEN_CORE_REF: nddimmxpymipalpxlops
-- ============================================================
-- PURPOSE:
-- Implements Phase 2B2 core student interaction RPCs:
-- 1. public.rpc_exam_save_answer: Atomic autosave of ONE answer with optimistic locking
-- 2. public.rpc_exam_submit_attempt: Atomic attempt finalization & server-side auto-grading
--
-- SECURITY & ISOLATION:
-- - SECURITY DEFINER functions owned by postgres.
-- - SET search_path = public, app_private.
-- - EXECUTE revoked from PUBLIC, anon, authenticated.
-- - EXECUTE granted exclusively to service_role (invoked via Exam BFF Edge Function).
-- - Zero exposure of answer keys to client (app_private.exam_answer_keys read only inside submit_attempt).
-- ============================================================

BEGIN;

-- Conservative timeout protections
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ------------------------------------------------------------
-- 1. rpc_exam_save_answer
-- ------------------------------------------------------------
-- Autosaves a single question answer for an active draft attempt.
-- Applies optimistic locking via p_expected_version = attempt.version.
-- Increments attempt.version exactly once on successful mutation.
-- Does NOT grade auto-graded questions on autosave (sets grading_status = 'pending_auto').
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_exam_save_answer(
    p_caller_id UUID,
    p_attempt_id UUID,
    p_exam_question_id UUID,
    p_student_answer_json JSONB DEFAULT NULL,
    p_file_url TEXT DEFAULT NULL,
    p_expected_version INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private
AS $$
DECLARE
    v_attempt_rec RECORD;
    v_question_rec RECORD;
    v_grading_status VARCHAR(30);
    v_new_version INT;
    v_key TEXT;
    v_opt_exists BOOLEAN;
    v_multi_keys TEXT[];
    v_k RECORD;
    v_key_clean TEXT;
BEGIN
    -- 1. Required parameters check
    IF p_caller_id IS NULL OR p_attempt_id IS NULL OR p_exam_question_id IS NULL OR p_expected_version IS NULL THEN
        RAISE EXCEPTION 'ERR_REQUIRED_PARAMS: caller_id, attempt_id, exam_question_id, and expected_version are required' USING ERRCODE = '22000';
    END IF;

    -- 2. Lock target attempt FOR UPDATE (serializes concurrent saves and saves vs submit)
    SELECT * INTO v_attempt_rec
    FROM public.exam_attempts
    WHERE id = p_attempt_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_ATTEMPT_NOT_FOUND: Attempt % does not exist', p_attempt_id USING ERRCODE = 'P0002';
    END IF;

    -- 3. Student identity invariant (Caller must be attempt owner)
    IF v_attempt_rec.student_id <> p_caller_id THEN
        RAISE EXCEPTION 'ERR_STUDENT_IDENTITY_MISMATCH: Caller % is not attempt student %', p_caller_id, v_attempt_rec.student_id USING ERRCODE = '42501';
    END IF;

    -- 4. Attempt status invariant (Must be draft)
    IF v_attempt_rec.status <> 'draft' THEN
        RAISE EXCEPTION 'ERR_ATTEMPT_FINALIZED: Cannot save answer to non-draft attempt (status: %)', v_attempt_rec.status USING ERRCODE = '22000';
    END IF;

    -- 5. Expiration check
    IF v_attempt_rec.expires_at IS NOT NULL AND clock_timestamp() >= v_attempt_rec.expires_at THEN
        RAISE EXCEPTION 'ERR_ATTEMPT_EXPIRED: Attempt expired at %', v_attempt_rec.expires_at USING ERRCODE = '22000';
    END IF;

    -- 6. Optimistic version check
    IF v_attempt_rec.version <> p_expected_version THEN
        RAISE EXCEPTION 'ERR_OPTIMISTIC_LOCK_CONFLICT: Attempt version mismatch (expected %, current %)', p_expected_version, v_attempt_rec.version USING ERRCODE = 'P0004';
    END IF;

    -- 7. Fetch and validate question & version snapshot isolation
    SELECT * INTO v_question_rec
    FROM public.exam_questions
    WHERE id = p_exam_question_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_QUESTION_NOT_FOUND: Question % does not exist', p_exam_question_id USING ERRCODE = 'P0002';
    END IF;

    IF v_question_rec.exam_version_id <> v_attempt_rec.exam_version_id THEN
        RAISE EXCEPTION 'ERR_QUESTION_VERSION_MISMATCH: Question % belongs to version %, attempt belongs to %', p_exam_question_id, v_question_rec.exam_version_id, v_attempt_rec.exam_version_id USING ERRCODE = '22000';
    END IF;

    -- 8. Payload validation by question type (Fail-Closed)
    CASE v_question_rec.question_type
        WHEN 'single_choice' THEN
            IF p_file_url IS NOT NULL THEN
                RAISE EXCEPTION 'ERR_FILE_URL_NOT_ALLOWED: File URL is not permitted for single_choice question' USING ERRCODE = '22000';
            END IF;

            IF p_student_answer_json IS NOT NULL THEN
                IF jsonb_typeof(p_student_answer_json) <> 'string' THEN
                    RAISE EXCEPTION 'ERR_INVALID_ANSWER_PAYLOAD: single_choice answer must be a JSON string' USING ERRCODE = '22000';
                END IF;

                v_key := p_student_answer_json #>> '{}';

                IF LENGTH(BTRIM(v_key)) = 0 THEN
                    RAISE EXCEPTION 'ERR_INVALID_ANSWER_PAYLOAD: single_choice answer key cannot be empty' USING ERRCODE = '22000';
                END IF;

                -- Validate option key exists in question options_json
                SELECT EXISTS (
                    SELECT 1 FROM jsonb_array_elements(v_question_rec.options_json) opt
                    WHERE opt->>'key' = v_key
                ) INTO v_opt_exists;

                IF NOT v_opt_exists THEN
                    RAISE EXCEPTION 'ERR_INVALID_OPTION_KEY: Option key % does not exist in question %', v_key, p_exam_question_id USING ERRCODE = '22000';
                END IF;
            END IF;

            v_grading_status := 'pending_auto';

        WHEN 'multiple_choice' THEN
            IF p_file_url IS NOT NULL THEN
                RAISE EXCEPTION 'ERR_FILE_URL_NOT_ALLOWED: File URL is not permitted for multiple_choice question' USING ERRCODE = '22000';
            END IF;

            IF p_student_answer_json IS NOT NULL THEN
                IF jsonb_typeof(p_student_answer_json) <> 'array' THEN
                    RAISE EXCEPTION 'ERR_INVALID_ANSWER_PAYLOAD: multiple_choice answer must be a JSON array of option keys' USING ERRCODE = '22000';
                END IF;

                v_multi_keys := ARRAY[]::TEXT[];

                FOR v_k IN SELECT * FROM jsonb_array_elements(p_student_answer_json)
                LOOP
                    IF jsonb_typeof(v_k.value) <> 'string' THEN
                        RAISE EXCEPTION 'ERR_INVALID_ANSWER_PAYLOAD: multiple_choice array elements must be string keys' USING ERRCODE = '22000';
                    END IF;

                    v_key_clean := v_k.value #>> '{}';

                    IF LENGTH(BTRIM(v_key_clean)) = 0 THEN
                        RAISE EXCEPTION 'ERR_INVALID_ANSWER_PAYLOAD: multiple_choice key cannot be empty' USING ERRCODE = '22000';
                    END IF;

                    -- Check duplicate keys in student submission
                    IF v_key_clean = ANY(v_multi_keys) THEN
                        RAISE EXCEPTION 'ERR_DUPLICATE_OPTION_KEYS: multiple_choice answer contains duplicate key %', v_key_clean USING ERRCODE = '22000';
                    END IF;

                    -- Validate key exists in question options_json
                    SELECT EXISTS (
                        SELECT 1 FROM jsonb_array_elements(v_question_rec.options_json) opt
                        WHERE opt->>'key' = v_key_clean
                    ) INTO v_opt_exists;

                    IF NOT v_opt_exists THEN
                        RAISE EXCEPTION 'ERR_INVALID_OPTION_KEY: Option key % does not exist in question %', v_key_clean, p_exam_question_id USING ERRCODE = '22000';
                    END IF;

                    v_multi_keys := array_append(v_multi_keys, v_key_clean);
                END LOOP;
            END IF;

            v_grading_status := 'pending_auto';

        WHEN 'fill_blank' THEN
            IF p_file_url IS NOT NULL THEN
                RAISE EXCEPTION 'ERR_FILE_URL_NOT_ALLOWED: File URL is not permitted for fill_blank question' USING ERRCODE = '22000';
            END IF;

            IF p_student_answer_json IS NOT NULL THEN
                IF jsonb_typeof(p_student_answer_json) <> 'string' THEN
                    RAISE EXCEPTION 'ERR_INVALID_ANSWER_PAYLOAD: fill_blank answer must be a JSON string' USING ERRCODE = '22000';
                END IF;
            END IF;

            v_grading_status := 'pending_auto';

        WHEN 'short_answer' THEN
            IF p_file_url IS NOT NULL THEN
                RAISE EXCEPTION 'ERR_FILE_URL_NOT_ALLOWED: File URL is not permitted for short_answer question' USING ERRCODE = '22000';
            END IF;

            IF p_student_answer_json IS NOT NULL THEN
                IF jsonb_typeof(p_student_answer_json) <> 'string' THEN
                    RAISE EXCEPTION 'ERR_INVALID_ANSWER_PAYLOAD: short_answer answer must be a JSON string' USING ERRCODE = '22000';
                END IF;
            END IF;

            v_grading_status := 'pending_auto';

        WHEN 'essay' THEN
            IF p_file_url IS NOT NULL THEN
                RAISE EXCEPTION 'ERR_FILE_URL_NOT_ALLOWED: File URL is not permitted for essay question' USING ERRCODE = '22000';
            END IF;

            IF p_student_answer_json IS NOT NULL THEN
                IF jsonb_typeof(p_student_answer_json) <> 'string' THEN
                    RAISE EXCEPTION 'ERR_INVALID_ANSWER_PAYLOAD: essay answer must be a JSON string' USING ERRCODE = '22000';
                END IF;
            END IF;

            v_grading_status := 'pending_manual';

        WHEN 'image_upload', 'file_upload' THEN
            IF p_student_answer_json IS NOT NULL THEN
                RAISE EXCEPTION 'ERR_ANSWER_PAYLOAD_NOT_ALLOWED: student_answer_json must be null for upload question types' USING ERRCODE = '22000';
            END IF;

            IF p_file_url IS NULL OR LENGTH(BTRIM(p_file_url)) = 0 THEN
                RAISE EXCEPTION 'ERR_FILE_URL_REQUIRED: file_url is required for upload question types' USING ERRCODE = '22000';
            END IF;

            v_grading_status := 'pending_manual';

        ELSE
            RAISE EXCEPTION 'ERR_UNKNOWN_QUESTION_TYPE: Unrecognized question type %', v_question_rec.question_type USING ERRCODE = '22000';
    END CASE;

    -- 9. UPSERT into public.exam_attempt_answers (never graded on autosave)
    INSERT INTO public.exam_attempt_answers (
        exam_version_id,
        attempt_id,
        exam_question_id,
        student_answer_json,
        file_url,
        points_earned,
        is_correct,
        grading_status,
        updated_at
    )
    VALUES (
        v_attempt_rec.exam_version_id,
        p_attempt_id,
        p_exam_question_id,
        p_student_answer_json,
        p_file_url,
        NULL,
        NULL,
        v_grading_status,
        clock_timestamp()
    )
    ON CONFLICT (attempt_id, exam_question_id)
    DO UPDATE SET
        student_answer_json = EXCLUDED.student_answer_json,
        file_url = EXCLUDED.file_url,
        points_earned = NULL,
        is_correct = NULL,
        grading_status = EXCLUDED.grading_status,
        updated_at = clock_timestamp();

    -- 10. Increment attempt.version exactly once
    UPDATE public.exam_attempts
    SET version = version + 1,
        updated_at = clock_timestamp()
    WHERE id = p_attempt_id
    RETURNING version INTO v_new_version;

    -- 11. Return response payload
    RETURN jsonb_build_object(
        'attempt_id', p_attempt_id,
        'exam_question_id', p_exam_question_id,
        'grading_status', v_grading_status,
        'attempt_version', v_new_version
    );
END;
$$;

-- ------------------------------------------------------------
-- 2. rpc_exam_submit_attempt
-- ------------------------------------------------------------
-- Finalizes a draft attempt atomically and performs server-side auto-grading.
-- Only auto-graded question types (single_choice, multiple_choice, fill_blank, short_answer)
-- are graded against app_private.exam_answer_keys (fail-closed if missing/malformed).
-- Manual question types (essay, image_upload, file_upload) remain pending_manual.
-- If any manual questions exist: status = 'pending_manual_grade', manual_score = NULL, total_score = NULL.
-- If all questions are auto-graded: status = 'graded', manual_score = 0.00, total_score = objective_score.
-- Exact replay of already-finalized attempts is strictly idempotent.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_exam_submit_attempt(
    p_caller_id UUID,
    p_attempt_id UUID,
    p_expected_version INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private
AS $$
DECLARE
    v_attempt_rec RECORD;
    v_version_rec RECORD;
    v_q RECORD;
    v_ans RECORD;
    v_key RECORD;
    v_is_correct BOOLEAN;
    v_points_earned NUMERIC(6, 2);
    v_objective_score NUMERIC(6, 2) := 0.00;
    v_manual_score NUMERIC(6, 2);
    v_total_score NUMERIC(6, 2);
    v_manual_count INT := 0;
    v_auto_count INT := 0;
    v_final_status VARCHAR(30);
    v_graded_at TIMESTAMPTZ;
    v_reward_stars_awarded INT := 0;
    v_submit_time TIMESTAMPTZ := clock_timestamp();

    -- Helper variables for grading comparisons
    v_ans_found BOOLEAN;
    v_key_found BOOLEAN;
    v_student_key TEXT;
    v_correct_key TEXT;
    v_student_arr TEXT[];
    v_correct_arr TEXT[];
    v_k RECORD;
    v_key_clean TEXT;
    v_opt_exists BOOLEAN;
    v_elem RECORD;
    v_clean_text TEXT;
    v_case_sens BOOLEAN;
    v_matched BOOLEAN;
BEGIN
    -- 1. Required parameters check
    IF p_caller_id IS NULL OR p_attempt_id IS NULL THEN
        RAISE EXCEPTION 'ERR_REQUIRED_PARAMS: caller_id and attempt_id are required' USING ERRCODE = '22000';
    END IF;

    -- 2. Lock target attempt FOR UPDATE
    SELECT * INTO v_attempt_rec
    FROM public.exam_attempts
    WHERE id = p_attempt_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_ATTEMPT_NOT_FOUND: Attempt % does not exist', p_attempt_id USING ERRCODE = 'P0002';
    END IF;

    -- 3. Student identity invariant (Caller must be attempt owner) - Checked BEFORE replay gate
    IF v_attempt_rec.student_id <> p_caller_id THEN
        RAISE EXCEPTION 'ERR_STUDENT_IDENTITY_MISMATCH: Caller % is not attempt student %', p_caller_id, v_attempt_rec.student_id USING ERRCODE = '42501';
    END IF;

    -- 4. Idempotent Finalized Replay Gate
    -- If attempt is already submitted/pending_manual_grade/graded, return stored immutable result immediately
    IF v_attempt_rec.status IN ('submitted', 'pending_manual_grade', 'graded') THEN
        RETURN jsonb_build_object(
            'attempt_id', v_attempt_rec.id,
            'assignment_id', v_attempt_rec.assignment_id,
            'exam_version_id', v_attempt_rec.exam_version_id,
            'student_id', v_attempt_rec.student_id,
            'attempt_number', v_attempt_rec.attempt_number,
            'status', v_attempt_rec.status,
            'attempt_started_at', v_attempt_rec.attempt_started_at,
            'expires_at', v_attempt_rec.expires_at,
            'submitted_at', v_attempt_rec.submitted_at,
            'objective_score', v_attempt_rec.objective_score,
            'manual_score', v_attempt_rec.manual_score,
            'total_score', v_attempt_rec.total_score,
            'max_score', v_attempt_rec.max_score,
            'reward_stars_awarded', v_attempt_rec.reward_stars_awarded,
            'graded_at', v_attempt_rec.graded_at,
            'graded_by', v_attempt_rec.graded_by,
            'version', v_attempt_rec.version,
            'idempotent_replay', true
        );
    END IF;

    -- 5. Status check for new submit (Must be draft)
    IF v_attempt_rec.status <> 'draft' THEN
        RAISE EXCEPTION 'ERR_ATTEMPT_NOT_DRAFT: Cannot submit attempt in status %', v_attempt_rec.status USING ERRCODE = '22000';
    END IF;

    -- 6. Optimistic version check for draft submit
    IF p_expected_version IS NULL OR v_attempt_rec.version <> p_expected_version THEN
        RAISE EXCEPTION 'ERR_OPTIMISTIC_LOCK_CONFLICT: Attempt version mismatch (expected %, current %)', p_expected_version, v_attempt_rec.version USING ERRCODE = 'P0004';
    END IF;

    -- 7. Expiration check on submit
    IF v_attempt_rec.expires_at IS NOT NULL AND v_submit_time >= v_attempt_rec.expires_at THEN
        RAISE EXCEPTION 'ERR_ATTEMPT_EXPIRED: Attempt expired at %', v_attempt_rec.expires_at USING ERRCODE = '22000';
    END IF;

    -- 8. Fetch parent exam_version
    SELECT * INTO v_version_rec
    FROM public.exam_versions
    WHERE id = v_attempt_rec.exam_version_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_VERSION_NOT_FOUND: Exam version % does not exist', v_attempt_rec.exam_version_id USING ERRCODE = 'P0002';
    END IF;

    -- 9. Process every question in snapshot: Ensure answer completeness & Auto-Grade
    FOR v_q IN 
        SELECT * 
        FROM public.exam_questions 
        WHERE exam_version_id = v_attempt_rec.exam_version_id
        ORDER BY question_number
    LOOP
        -- Check if student saved an answer for this question
        SELECT * INTO v_ans
        FROM public.exam_attempt_answers
        WHERE attempt_id = v_attempt_rec.id
          AND exam_question_id = v_q.id;
        v_ans_found := FOUND;

        IF v_q.question_type IN ('single_choice', 'multiple_choice', 'fill_blank', 'short_answer') THEN
            v_auto_count := v_auto_count + 1;
            v_is_correct := false;
            v_points_earned := 0.00;

            -- Fetch private answer key (FAIL-CLOSED)
            SELECT * INTO v_key
            FROM app_private.exam_answer_keys
            WHERE question_id = v_q.id;
            v_key_found := FOUND;

            IF NOT v_key_found THEN
                RAISE EXCEPTION 'ERR_ANSWER_KEY_MISSING: Missing answer key for question %', v_q.id USING ERRCODE = '22000';
            END IF;

            -- Validate key shape & evaluate student answer
            CASE v_q.question_type
                WHEN 'single_choice' THEN
                    IF jsonb_typeof(v_key.correct_answer) <> 'string' THEN
                        RAISE EXCEPTION 'ERR_INVALID_ANSWER_KEY: single_choice correct_answer must be a JSON string for question %', v_q.id USING ERRCODE = '22000';
                    END IF;

                    v_correct_key := v_key.correct_answer #>> '{}';

                    IF LENGTH(BTRIM(v_correct_key)) = 0 THEN
                        RAISE EXCEPTION 'ERR_INVALID_ANSWER_KEY: single_choice correct_answer cannot be empty for question %', v_q.id USING ERRCODE = '22000';
                    END IF;

                    -- Validate key exists in question options_json
                    SELECT EXISTS (
                        SELECT 1 FROM jsonb_array_elements(v_q.options_json) opt
                        WHERE opt->>'key' = v_correct_key
                    ) INTO v_opt_exists;

                    IF NOT v_opt_exists THEN
                        RAISE EXCEPTION 'ERR_INVALID_ANSWER_KEY: single_choice correct_answer % does not exist in options for question %', v_correct_key, v_q.id USING ERRCODE = '22000';
                    END IF;

                    -- Evaluate if student answered
                    IF v_ans_found AND v_ans.student_answer_json IS NOT NULL THEN
                        IF jsonb_typeof(v_ans.student_answer_json) = 'string' THEN
                            v_student_key := v_ans.student_answer_json #>> '{}';
                            IF v_student_key = v_correct_key THEN
                                v_is_correct := true;
                                v_points_earned := v_q.points;
                            END IF;
                        END IF;
                    END IF;

                WHEN 'multiple_choice' THEN
                    IF jsonb_typeof(v_key.correct_answer) <> 'array' THEN
                        RAISE EXCEPTION 'ERR_INVALID_ANSWER_KEY: multiple_choice correct_answer must be a JSON array for question %', v_q.id USING ERRCODE = '22000';
                    END IF;

                    IF jsonb_array_length(v_key.correct_answer) = 0 THEN
                        RAISE EXCEPTION 'ERR_INVALID_ANSWER_KEY: multiple_choice correct_answer cannot be empty for question %', v_q.id USING ERRCODE = '22000';
                    END IF;

                    v_correct_arr := ARRAY[]::TEXT[];

                    FOR v_k IN SELECT * FROM jsonb_array_elements(v_key.correct_answer)
                    LOOP
                        IF jsonb_typeof(v_k.value) <> 'string' THEN
                            RAISE EXCEPTION 'ERR_INVALID_ANSWER_KEY: multiple_choice correct_answer elements must be strings for question %', v_q.id USING ERRCODE = '22000';
                        END IF;

                        v_key_clean := v_k.value #>> '{}';

                        IF LENGTH(BTRIM(v_key_clean)) = 0 THEN
                            RAISE EXCEPTION 'ERR_INVALID_ANSWER_KEY: multiple_choice correct_answer contains empty key for question %', v_q.id USING ERRCODE = '22000';
                        END IF;

                        IF v_key_clean = ANY(v_correct_arr) THEN
                            RAISE EXCEPTION 'ERR_INVALID_ANSWER_KEY: multiple_choice correct_answer contains duplicate key % for question %', v_key_clean, v_q.id USING ERRCODE = '22000';
                        END IF;

                        SELECT EXISTS (
                            SELECT 1 FROM jsonb_array_elements(v_q.options_json) opt
                            WHERE opt->>'key' = v_key_clean
                        ) INTO v_opt_exists;

                        IF NOT v_opt_exists THEN
                            RAISE EXCEPTION 'ERR_INVALID_ANSWER_KEY: multiple_choice correct_answer key % does not exist in options for question %', v_key_clean, v_q.id USING ERRCODE = '22000';
                        END IF;

                        v_correct_arr := array_append(v_correct_arr, v_key_clean);
                    END LOOP;

                    -- Canonical sorted array for answer key
                    SELECT COALESCE(array_agg(x ORDER BY x), ARRAY[]::TEXT[])
                    INTO v_correct_arr
                    FROM unnest(v_correct_arr) x;

                    -- Evaluate if student answered
                    IF v_ans_found AND v_ans.student_answer_json IS NOT NULL THEN
                        IF jsonb_typeof(v_ans.student_answer_json) = 'array' THEN
                            SELECT COALESCE(array_agg(elem.val ORDER BY elem.val), ARRAY[]::TEXT[])
                            INTO v_student_arr
                            FROM (
                                SELECT CASE 
                                    WHEN jsonb_typeof(x.val) = 'string' THEN x.val #>> '{}'
                                    ELSE NULL
                                END AS val
                                FROM jsonb_array_elements(v_ans.student_answer_json) AS x(val)
                            ) elem
                            WHERE elem.val IS NOT NULL;

                            IF array_length(v_student_arr, 1) IS NOT NULL AND v_student_arr = v_correct_arr THEN
                                v_is_correct := true;
                                v_points_earned := v_q.points;
                            END IF;
                        END IF;
                    END IF;

                WHEN 'fill_blank', 'short_answer' THEN
                    IF jsonb_typeof(v_key.correct_answer) <> 'string' THEN
                        RAISE EXCEPTION 'ERR_INVALID_ANSWER_KEY: % correct_answer must be a JSON string for question %', v_q.question_type, v_q.id USING ERRCODE = '22000';
                    END IF;

                    IF v_key.accepted_answers IS NOT NULL THEN
                        IF jsonb_typeof(v_key.accepted_answers) <> 'array' THEN
                            RAISE EXCEPTION 'ERR_INVALID_ANSWER_KEY: % accepted_answers must be a JSON array for question %', v_q.question_type, v_q.id USING ERRCODE = '22000';
                        END IF;
                        IF (SELECT count(*) FROM jsonb_array_elements(v_key.accepted_answers) x WHERE jsonb_typeof(x.value) <> 'string') > 0 THEN
                            RAISE EXCEPTION 'ERR_INVALID_ANSWER_KEY: % accepted_answers elements must be strings for question %', v_q.question_type, v_q.id USING ERRCODE = '22000';
                        END IF;
                    END IF;

                    v_case_sens := COALESCE(v_key.case_sensitive, false);
                    v_matched := false;

                    IF v_ans_found AND v_ans.student_answer_json IS NOT NULL THEN
                        IF jsonb_typeof(v_ans.student_answer_json) = 'string' THEN
                            v_clean_text := BTRIM(v_ans.student_answer_json #>> '{}');

                            IF LENGTH(v_clean_text) > 0 THEN
                                -- 1. Compare with correct_answer
                                IF v_case_sens THEN
                                    IF v_clean_text = BTRIM(v_key.correct_answer #>> '{}') THEN
                                        v_matched := true;
                                    END IF;
                                ELSE
                                    IF LOWER(v_clean_text) = LOWER(BTRIM(v_key.correct_answer #>> '{}')) THEN
                                        v_matched := true;
                                    END IF;
                                END IF;

                                -- 2. Compare with accepted_answers if not yet matched
                                IF NOT v_matched AND v_key.accepted_answers IS NOT NULL THEN
                                    FOR v_elem IN SELECT * FROM jsonb_array_elements_text(v_key.accepted_answers)
                                    LOOP
                                        IF v_case_sens THEN
                                            IF v_clean_text = BTRIM(v_elem.value) THEN
                                                v_matched := true;
                                                EXIT;
                                            END IF;
                                        ELSE
                                            IF LOWER(v_clean_text) = LOWER(BTRIM(v_elem.value)) THEN
                                                v_matched := true;
                                                EXIT;
                                            END IF;
                                        END IF;
                                    END LOOP;
                                END IF;

                                IF v_matched THEN
                                    v_is_correct := true;
                                    v_points_earned := v_q.points;
                                END IF;
                            END IF;
                        END IF;
                    END IF;
            END CASE;

            -- Upsert auto-graded answer record
            INSERT INTO public.exam_attempt_answers (
                exam_version_id,
                attempt_id,
                exam_question_id,
                student_answer_json,
                file_url,
                points_earned,
                is_correct,
                grading_status,
                updated_at
            )
            VALUES (
                v_attempt_rec.exam_version_id,
                v_attempt_rec.id,
                v_q.id,
                CASE WHEN v_ans_found THEN v_ans.student_answer_json ELSE NULL END,
                CASE WHEN v_ans_found THEN v_ans.file_url ELSE NULL END,
                v_points_earned,
                v_is_correct,
                'auto_graded',
                v_submit_time
            )
            ON CONFLICT (attempt_id, exam_question_id)
            DO UPDATE SET
                points_earned = EXCLUDED.points_earned,
                is_correct = EXCLUDED.is_correct,
                grading_status = 'auto_graded',
                updated_at = v_submit_time;

            v_objective_score := v_objective_score + v_points_earned;

        ELSE
            -- Manual question type (essay, image_upload, file_upload)
            v_manual_count := v_manual_count + 1;

            INSERT INTO public.exam_attempt_answers (
                exam_version_id,
                attempt_id,
                exam_question_id,
                student_answer_json,
                file_url,
                points_earned,
                is_correct,
                grading_status,
                updated_at
            )
            VALUES (
                v_attempt_rec.exam_version_id,
                v_attempt_rec.id,
                v_q.id,
                CASE WHEN v_ans_found THEN v_ans.student_answer_json ELSE NULL END,
                CASE WHEN v_ans_found THEN v_ans.file_url ELSE NULL END,
                NULL,
                NULL,
                'pending_manual',
                v_submit_time
            )
            ON CONFLICT (attempt_id, exam_question_id)
            DO UPDATE SET
                points_earned = NULL,
                is_correct = NULL,
                grading_status = 'pending_manual',
                updated_at = v_submit_time;
        END IF;
    END LOOP;

    -- 10. Determine final attempt status, total score, and rewards
    v_reward_stars_awarded := 0; -- Phase 2B2: Always 0, deferred completely

    IF v_manual_count > 0 THEN
        v_final_status := 'pending_manual_grade';
        v_manual_score := NULL;
        v_total_score := NULL;
        v_graded_at := NULL;
    ELSE
        v_final_status := 'graded';
        v_manual_score := 0.00;
        v_total_score := v_objective_score;
        v_graded_at := v_submit_time;
    END IF;

    -- 11. Update public.exam_attempts
    UPDATE public.exam_attempts
    SET status = v_final_status,
        submitted_at = v_submit_time,
        objective_score = v_objective_score,
        manual_score = v_manual_score,
        total_score = v_total_score,
        reward_stars_awarded = v_reward_stars_awarded,
        graded_at = v_graded_at,
        graded_by = NULL,
        version = version + 1,
        updated_at = v_submit_time
    WHERE id = v_attempt_rec.id
    RETURNING * INTO v_attempt_rec;

    -- 12. Return submission summary (Strictly no answer keys leaked)
    RETURN jsonb_build_object(
        'attempt_id', v_attempt_rec.id,
        'assignment_id', v_attempt_rec.assignment_id,
        'exam_version_id', v_attempt_rec.exam_version_id,
        'student_id', v_attempt_rec.student_id,
        'attempt_number', v_attempt_rec.attempt_number,
        'status', v_attempt_rec.status,
        'attempt_started_at', v_attempt_rec.attempt_started_at,
        'expires_at', v_attempt_rec.expires_at,
        'submitted_at', v_attempt_rec.submitted_at,
        'objective_score', v_attempt_rec.objective_score,
        'manual_score', v_attempt_rec.manual_score,
        'total_score', v_attempt_rec.total_score,
        'max_score', v_attempt_rec.max_score,
        'reward_stars_awarded', v_attempt_rec.reward_stars_awarded,
        'graded_at', v_attempt_rec.graded_at,
        'graded_by', v_attempt_rec.graded_by,
        'version', v_attempt_rec.version,
        'idempotent_replay', false
    );
END;
$$;

-- ------------------------------------------------------------
-- 3. PERMISSIONS & SECURITY HARDENING
-- ------------------------------------------------------------
-- Strict zero-trust ACL: Lock down public and browser roles
REVOKE EXECUTE ON FUNCTION public.rpc_exam_save_answer(UUID, UUID, UUID, JSONB, TEXT, INT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_exam_submit_attempt(UUID, UUID, INT) FROM PUBLIC, anon, authenticated;

-- Grant execution exclusively to service_role (BFF Edge Function access only)
GRANT EXECUTE ON FUNCTION public.rpc_exam_save_answer(UUID, UUID, UUID, JSONB, TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_exam_submit_attempt(UUID, UUID, INT) TO service_role;

COMMIT;
