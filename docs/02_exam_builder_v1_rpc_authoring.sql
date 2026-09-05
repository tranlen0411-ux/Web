-- ============================================================
-- TEST / EXAM BUILDER V1
-- PHASE 2A: AUTHORING RPC PROCEDURES DRAFT (HARDENING V3)
-- TARGET_PROJECT_REF: szptvqkoiphrhlionfoh
-- FORBIDDEN_CORE_REF: nddimmxpymipalpxlops
-- ============================================================
-- DRAFT/DESIGN ONLY — DO NOT EXECUTE DIRECTLY ON CLOUD
--
-- INCLUDED PROCEDURES:
-- 1. public.rpc_exam_create_test (DB-Enforced Idempotency & Full Conflict Invariant Validation)
-- 2. public.rpc_exam_save_draft_version (Mandatory Stable Question IDs + 2-Pass Atomic Replace)
-- 3. public.rpc_exam_publish_version (Safe Idempotent Replay on Current Version Only)
--
-- SECURITY ARCHITECTURE:
-- - SECURITY DEFINER with fixed search_path = public, app_private
-- - REVOKE ALL FROM PUBLIC, anon, authenticated
-- - GRANT EXECUTE ONLY TO service_role
-- - BFF Edge Function validates CORE JWT & generates/persists stable IDs for retries
-- ============================================================

-- ------------------------------------------------------------
-- 1. rpc_exam_create_test (DB-Enforced Idempotency)
-- ------------------------------------------------------------
-- Accepts client/BFF generated stable UUIDs (p_exam_id, p_version_id).
-- First request creates exam_tests + exam_versions v1.
-- Retries with identical payload return existing IDs (idempotent_replay: true).
-- Retries with conflicting payload or state raise ERR_IDEMPOTENCY_CONFLICT.
CREATE OR REPLACE FUNCTION public.rpc_exam_create_test(
    p_caller_id UUID,
    p_exam_id UUID,
    p_version_id UUID,
    p_title VARCHAR(255),
    p_subject VARCHAR(100),
    p_grade_level INT,
    p_description TEXT DEFAULT NULL,
    p_is_admin BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private
AS $$
DECLARE
    v_title_clean TEXT;
    v_subject_clean TEXT;
    v_existing_test RECORD;
    v_existing_version RECORD;
    v_test_inserted BOOLEAN := FALSE;
    v_version_inserted BOOLEAN := FALSE;
BEGIN
    -- 1. Input sanitization & validation
    IF p_caller_id IS NULL THEN
        RAISE EXCEPTION 'ERR_CALLER_ID_REQUIRED: Caller identity is required' USING ERRCODE = '22000';
    END IF;

    IF p_exam_id IS NULL OR p_version_id IS NULL THEN
        RAISE EXCEPTION 'ERR_REQUIRED_PARAMS: exam_id and version_id must be supplied by BFF' USING ERRCODE = '22000';
    END IF;

    v_title_clean := BTRIM(p_title);
    v_subject_clean := BTRIM(p_subject);

    IF v_title_clean IS NULL OR LENGTH(v_title_clean) = 0 THEN
        RAISE EXCEPTION 'ERR_INVALID_TITLE: Title cannot be empty' USING ERRCODE = '22000';
    END IF;

    IF v_subject_clean IS NULL OR LENGTH(v_subject_clean) = 0 THEN
        RAISE EXCEPTION 'ERR_INVALID_SUBJECT: Subject cannot be empty' USING ERRCODE = '22000';
    END IF;

    IF p_grade_level IS NULL OR p_grade_level < 1 OR p_grade_level > 12 THEN
        RAISE EXCEPTION 'ERR_INVALID_GRADE: Grade level must be between 1 and 12' USING ERRCODE = '22003';
    END IF;

    -- 2. Insert exam container using ON CONFLICT (id) DO NOTHING
    INSERT INTO public.exam_tests (
        id,
        author_id,
        title,
        subject,
        grade_level,
        status,
        current_version_id
    ) VALUES (
        p_exam_id,
        p_caller_id,
        v_title_clean,
        v_subject_clean,
        p_grade_level,
        'active',
        NULL
    )
    ON CONFLICT (id) DO NOTHING;

    IF FOUND THEN
        v_test_inserted := TRUE;
    ELSE
        -- Conflict occurred on exam_tests: lock and inspect existing row to verify exact payload & state match
        SELECT * INTO v_existing_test
        FROM public.exam_tests
        WHERE id = p_exam_id
        FOR UPDATE;

        IF v_existing_test.author_id <> p_caller_id THEN
            RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: Exam ID exists with different author' USING ERRCODE = '23505';
        END IF;

        IF v_existing_test.title <> v_title_clean OR
           v_existing_test.subject <> v_subject_clean OR
           v_existing_test.grade_level <> p_grade_level OR
           v_existing_test.status <> 'active' OR
           v_existing_test.current_version_id IS NOT NULL THEN
            RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: Exam ID exists with conflicting payload or state' USING ERRCODE = '23505';
        END IF;
    END IF;

    -- 3. Insert draft version 1 using ON CONFLICT (id) DO NOTHING
    INSERT INTO public.exam_versions (
        id,
        exam_id,
        version_number,
        title,
        description,
        subject,
        grade_level,
        status,
        published_at,
        total_points
    ) VALUES (
        p_version_id,
        p_exam_id,
        1,
        v_title_clean,
        p_description,
        v_subject_clean,
        p_grade_level,
        'draft',
        NULL,
        0.00
    )
    ON CONFLICT (id) DO NOTHING;

    IF FOUND THEN
        v_version_inserted := TRUE;
    ELSE
        -- Conflict occurred on exam_versions: lock and inspect existing version
        SELECT * INTO v_existing_version
        FROM public.exam_versions
        WHERE id = p_version_id
        FOR UPDATE;

        IF v_existing_version.exam_id <> p_exam_id OR
           v_existing_version.version_number <> 1 OR
           v_existing_version.status <> 'draft' OR
           v_existing_version.published_at IS NOT NULL OR
           v_existing_version.title <> v_title_clean OR
           v_existing_version.subject <> v_subject_clean OR
           v_existing_version.grade_level <> p_grade_level OR
           v_existing_version.description IS DISTINCT FROM p_description THEN
            RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: Version ID exists with conflicting payload or state' USING ERRCODE = '23505';
        END IF;
    END IF;

    -- 4. Return result payload
    RETURN jsonb_build_object(
        'exam_id', p_exam_id,
        'version_id', p_version_id,
        'version_number', 1,
        'status', 'draft',
        'idempotent_replay', NOT v_test_inserted
    );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_exam_create_test(UUID, UUID, UUID, VARCHAR, VARCHAR, INT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_exam_create_test(UUID, UUID, UUID, VARCHAR, VARCHAR, INT, TEXT, BOOLEAN) TO service_role;


-- ------------------------------------------------------------
-- 2. rpc_exam_save_draft_version (2-Pass Atomic Validation & Replacement)
-- ------------------------------------------------------------
-- Pass 1: Validates version attributes and all question payloads (requires non-null, unique question UUIDs).
-- Pass 2: Performs UPDATE on version, cleanly deletes old questions, and inserts new questions & answer keys.
CREATE OR REPLACE FUNCTION public.rpc_exam_save_draft_version(
    p_caller_id UUID,
    p_version_id UUID,
    p_title VARCHAR(255),
    p_subject VARCHAR(100),
    p_grade_level INT,
    p_description TEXT DEFAULT NULL,
    p_duration_minutes INT DEFAULT NULL,
    p_starts_at TIMESTAMPTZ DEFAULT NULL,
    p_due_date TIMESTAMPTZ DEFAULT NULL,
    p_max_attempts INT DEFAULT 1,
    p_reward_stars INT DEFAULT 0,
    p_shuffle_questions BOOLEAN DEFAULT FALSE,
    p_shuffle_options BOOLEAN DEFAULT FALSE,
    p_tab_switch_policy VARCHAR(20) DEFAULT 'WARN_AND_LOG',
    p_show_score_after_submit BOOLEAN DEFAULT TRUE,
    p_show_correct_answers BOOLEAN DEFAULT FALSE,
    p_questions JSONB DEFAULT '[]'::jsonb,
    p_is_admin BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private
AS $$
DECLARE
    v_version_rec RECORD;
    v_test_rec RECORD;
    v_q RECORD;
    v_question_id UUID;
    v_q_num INT;
    v_q_type TEXT;
    v_prompt TEXT;
    v_points NUMERIC(6, 2);
    v_options JSONB;
    v_source_item_id UUID;
    v_source_ver_id UUID;
    v_answer_key JSONB;
    v_correct_answer JSONB;
    v_accepted_answers JSONB;
    v_case_sensitive BOOLEAN;
    v_grading_config JSONB;
    v_question_count INT := 0;
    v_seen_numbers INT[] := ARRAY[]::INT[];
    v_seen_ids UUID[] := ARRAY[]::UUID[];
    v_title_clean TEXT;
    v_subject_clean TEXT;
BEGIN
    IF p_caller_id IS NULL OR p_version_id IS NULL THEN
        RAISE EXCEPTION 'ERR_REQUIRED_PARAMS: caller_id and version_id are required' USING ERRCODE = '22000';
    END IF;

    -- 1. Lock and fetch target exam_version FOR UPDATE
    SELECT * INTO v_version_rec
    FROM public.exam_versions
    WHERE id = p_version_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_VERSION_NOT_FOUND: Version % does not exist', p_version_id USING ERRCODE = 'P0002';
    END IF;

    -- 2. Lock and fetch parent exam container FOR UPDATE
    SELECT * INTO v_test_rec
    FROM public.exam_tests
    WHERE id = v_version_rec.exam_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_EXAM_NOT_FOUND: Exam container % does not exist', v_version_rec.exam_id USING ERRCODE = 'P0002';
    END IF;

    -- 3. State and authorization checks
    IF v_test_rec.status <> 'active' THEN
        RAISE EXCEPTION 'ERR_EXAM_ARCHIVED: Exam container is archived' USING ERRCODE = '22000';
    END IF;

    IF v_version_rec.status <> 'draft' THEN
        RAISE EXCEPTION 'ERR_VERSION_IMMUTABLE: Only draft versions can be modified (current status: %)', v_version_rec.status USING ERRCODE = '22000';
    END IF;

    IF NOT p_is_admin AND v_test_rec.author_id <> p_caller_id THEN
        RAISE EXCEPTION 'ERR_UNAUTHORIZED: Caller is not the author of this exam' USING ERRCODE = '42501';
    END IF;

    -- 4. PASS 1: Validate Version Attributes
    v_title_clean := BTRIM(p_title);
    v_subject_clean := BTRIM(p_subject);

    IF v_title_clean IS NULL OR LENGTH(v_title_clean) = 0 THEN
        RAISE EXCEPTION 'ERR_INVALID_TITLE: Title cannot be empty' USING ERRCODE = '22000';
    END IF;

    IF v_subject_clean IS NULL OR LENGTH(v_subject_clean) = 0 THEN
        RAISE EXCEPTION 'ERR_INVALID_SUBJECT: Subject cannot be empty' USING ERRCODE = '22000';
    END IF;

    IF p_grade_level IS NULL OR p_grade_level < 1 OR p_grade_level > 12 THEN
        RAISE EXCEPTION 'ERR_INVALID_GRADE: Grade level must be between 1 and 12' USING ERRCODE = '22003';
    END IF;

    IF p_duration_minutes IS NOT NULL AND (p_duration_minutes < 1 OR p_duration_minutes > 300) THEN
        RAISE EXCEPTION 'ERR_INVALID_DURATION: Duration must be between 1 and 300 minutes' USING ERRCODE = '22003';
    END IF;

    IF p_max_attempts IS NULL OR p_max_attempts < 1 OR p_max_attempts > 100 THEN
        RAISE EXCEPTION 'ERR_INVALID_MAX_ATTEMPTS: Max attempts must be between 1 and 100' USING ERRCODE = '22003';
    END IF;

    IF p_reward_stars IS NULL OR p_reward_stars < 0 OR p_reward_stars > 1000 THEN
        RAISE EXCEPTION 'ERR_INVALID_REWARD_STARS: Reward stars must be between 0 and 1000' USING ERRCODE = '22003';
    END IF;

    IF p_tab_switch_policy NOT IN ('OFF', 'WARN_ONLY', 'WARN_AND_LOG') THEN
        RAISE EXCEPTION 'ERR_INVALID_TAB_POLICY: Invalid tab switch policy %', p_tab_switch_policy USING ERRCODE = '22000';
    END IF;

    -- 5. PASS 1 (Continued): Full Question Payload Validation BEFORE any mutation
    IF p_questions IS NOT NULL AND jsonb_typeof(p_questions) = 'array' THEN
        FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions)
        LOOP
            -- Check question ID
            IF v_q.value->>'id' IS NULL OR LENGTH(BTRIM(v_q.value->>'id')) = 0 THEN
                RAISE EXCEPTION 'ERR_QUESTION_ID_REQUIRED: Every draft question must have a non-null id' USING ERRCODE = '22000';
            END IF;

            BEGIN
                v_question_id := (v_q.value->>'id')::UUID;
            EXCEPTION WHEN OTHERS THEN
                RAISE EXCEPTION 'ERR_QUESTION_ID_REQUIRED: Question id % is not a valid UUID', v_q.value->>'id' USING ERRCODE = '22000';
            END;

            IF v_question_id = ANY(v_seen_ids) THEN
                RAISE EXCEPTION 'ERR_DUPLICATE_QUESTION_ID: Duplicate question id % in payload', v_question_id USING ERRCODE = '23505';
            END IF;
            v_seen_ids := array_append(v_seen_ids, v_question_id);

            -- Check question_number
            v_q_num := (v_q.value->>'question_number')::INT;
            IF v_q_num IS NULL OR v_q_num < 1 THEN
                RAISE EXCEPTION 'ERR_INVALID_QUESTION_NUMBER: question_number must be >= 1' USING ERRCODE = '22003';
            END IF;

            IF v_q_num = ANY(v_seen_numbers) THEN
                RAISE EXCEPTION 'ERR_DUPLICATE_QUESTION_NUMBER: Duplicate question_number % in payload', v_q_num USING ERRCODE = '23505';
            END IF;
            v_seen_numbers := array_append(v_seen_numbers, v_q_num);

            -- Check question_type
            v_q_type := v_q.value->>'question_type';
            IF v_q_type NOT IN ('single_choice', 'multiple_choice', 'fill_blank', 'short_answer', 'essay', 'image_upload', 'file_upload') THEN
                RAISE EXCEPTION 'ERR_INVALID_QUESTION_TYPE: Unknown question_type %', v_q_type USING ERRCODE = '22000';
            END IF;

            -- Check prompt
            v_prompt := BTRIM(v_q.value->>'prompt');
            IF v_prompt IS NULL OR LENGTH(v_prompt) = 0 THEN
                RAISE EXCEPTION 'ERR_INVALID_PROMPT: Question % prompt cannot be empty', v_q_num USING ERRCODE = '22000';
            END IF;

            -- Check points
            v_points := (v_q.value->>'points')::NUMERIC(6, 2);
            IF v_points IS NULL OR v_points <= 0.00 THEN
                RAISE EXCEPTION 'ERR_INVALID_POINTS: Question % points must be > 0', v_q_num USING ERRCODE = '22003';
            END IF;

            -- Check answer key rules
            v_answer_key := v_q.value->'answer_key';
            IF v_q_type IN ('single_choice', 'multiple_choice', 'fill_blank', 'short_answer') THEN
                IF v_answer_key IS NULL OR v_answer_key->'correct_answer' IS NULL OR jsonb_typeof(v_answer_key->'correct_answer') = 'null' THEN
                    RAISE EXCEPTION 'ERR_MISSING_ANSWER_KEY: Question % (%) requires a correct_answer', v_q_num, v_q_type USING ERRCODE = '22000';
                END IF;
            ELSE
                IF v_answer_key IS NOT NULL AND v_answer_key->'correct_answer' IS NOT NULL AND jsonb_typeof(v_answer_key->'correct_answer') <> 'null' THEN
                    RAISE EXCEPTION 'ERR_MANUAL_ANSWER_KEY_FORBIDDEN: Question % (%) cannot have an answer key', v_q_num, v_q_type USING ERRCODE = '22000';
                END IF;
            END IF;
        END LOOP;
    END IF;

    -- 6. PASS 2: Mutation Pass (Executed only after 100% of validation passed)
    UPDATE public.exam_versions
    SET
        title = v_title_clean,
        description = p_description,
        subject = v_subject_clean,
        grade_level = p_grade_level,
        duration_minutes = p_duration_minutes,
        starts_at = p_starts_at,
        due_date = p_due_date,
        max_attempts = p_max_attempts,
        reward_stars = p_reward_stars,
        shuffle_questions = p_shuffle_questions,
        shuffle_options = p_shuffle_options,
        tab_switch_policy = p_tab_switch_policy,
        show_score_after_submit = p_show_score_after_submit,
        show_correct_answers = p_show_correct_answers
    WHERE id = p_version_id;

    -- Cleanly delete old questions (CASCADE removes app_private.exam_answer_keys)
    DELETE FROM public.exam_questions WHERE exam_version_id = p_version_id;

    -- Insert validated questions and keys
    IF p_questions IS NOT NULL AND jsonb_typeof(p_questions) = 'array' THEN
        FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions)
        LOOP
            v_question_id := (v_q.value->>'id')::UUID;
            v_q_num := (v_q.value->>'question_number')::INT;
            v_q_type := v_q.value->>'question_type';
            v_prompt := BTRIM(v_q.value->>'prompt');
            v_points := COALESCE((v_q.value->>'points')::NUMERIC(6, 2), 1.00);
            v_options := COALESCE(v_q.value->'options_json', '[]'::jsonb);
            v_source_item_id := (v_q.value->>'source_question_bank_item_id')::UUID;
            v_source_ver_id := (v_q.value->>'source_question_bank_version_id')::UUID;
            v_answer_key := v_q.value->'answer_key';

            INSERT INTO public.exam_questions (
                id,
                exam_version_id,
                question_number,
                question_type,
                prompt,
                options_json,
                points,
                source_question_bank_item_id,
                source_question_bank_version_id
            ) VALUES (
                v_question_id,
                p_version_id,
                v_q_num,
                v_q_type,
                v_prompt,
                v_options,
                v_points,
                v_source_item_id,
                v_source_ver_id
            );

            v_question_count := v_question_count + 1;

            IF v_q_type IN ('single_choice', 'multiple_choice', 'fill_blank', 'short_answer') THEN
                v_correct_answer := v_answer_key->'correct_answer';
                v_accepted_answers := v_answer_key->'accepted_answers';
                v_case_sensitive := COALESCE((v_answer_key->>'case_sensitive')::BOOLEAN, FALSE);
                v_grading_config := COALESCE(v_answer_key->'grading_config', '{}'::jsonb);

                INSERT INTO app_private.exam_answer_keys (
                    question_id,
                    correct_answer,
                    accepted_answers,
                    case_sensitive,
                    grading_config
                ) VALUES (
                    v_question_id,
                    v_correct_answer,
                    v_accepted_answers,
                    v_case_sensitive,
                    v_grading_config
                );
            END IF;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'version_id', p_version_id,
        'question_count', v_question_count,
        'status', 'draft'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_exam_save_draft_version(UUID, UUID, VARCHAR, VARCHAR, INT, TEXT, INT, TIMESTAMPTZ, TIMESTAMPTZ, INT, INT, BOOLEAN, BOOLEAN, VARCHAR, BOOLEAN, BOOLEAN, JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_exam_save_draft_version(UUID, UUID, VARCHAR, VARCHAR, INT, TEXT, INT, TIMESTAMPTZ, TIMESTAMPTZ, INT, INT, BOOLEAN, BOOLEAN, VARCHAR, BOOLEAN, BOOLEAN, JSONB, BOOLEAN) TO service_role;


-- ------------------------------------------------------------
-- 3. rpc_exam_publish_version (Safe Idempotent Replay on Current Version)
-- ------------------------------------------------------------
-- Publishes a draft version.
-- Safe Replay: If called on an already published version that is the ACTIVE current_version_id,
-- returns existing published result safely (idempotent_replay: true).
-- Superseded or non-current version retries are strictly rejected with ERR_NOT_DRAFT.
CREATE OR REPLACE FUNCTION public.rpc_exam_publish_version(
    p_caller_id UUID,
    p_version_id UUID,
    p_is_admin BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private
AS $$
DECLARE
    v_version_rec RECORD;
    v_test_rec RECORD;
    v_computed_total NUMERIC(6, 2) := 0.00;
    v_question_count INT := 0;
    v_invalid_auto_count INT := 0;
    v_invalid_manual_count INT := 0;
    v_published_at TIMESTAMPTZ := NOW();
BEGIN
    IF p_caller_id IS NULL OR p_version_id IS NULL THEN
        RAISE EXCEPTION 'ERR_REQUIRED_PARAMS: caller_id and version_id are required' USING ERRCODE = '22000';
    END IF;

    -- 1. Lock target exam_version FOR UPDATE
    SELECT * INTO v_version_rec
    FROM public.exam_versions
    WHERE id = p_version_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_VERSION_NOT_FOUND: Version % does not exist', p_version_id USING ERRCODE = 'P0002';
    END IF;

    -- 2. Lock parent exam container FOR UPDATE
    SELECT * INTO v_test_rec
    FROM public.exam_tests
    WHERE id = v_version_rec.exam_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_EXAM_NOT_FOUND: Exam container % does not exist', v_version_rec.exam_id USING ERRCODE = 'P0002';
    END IF;

    -- 3. Authorization and container state checks
    IF NOT p_is_admin AND v_test_rec.author_id <> p_caller_id THEN
        RAISE EXCEPTION 'ERR_UNAUTHORIZED: Caller is not the author of this exam' USING ERRCODE = '42501';
    END IF;

    IF v_test_rec.status <> 'active' THEN
        RAISE EXCEPTION 'ERR_EXAM_ARCHIVED: Cannot publish version for an archived exam' USING ERRCODE = '22000';
    END IF;

    -- 4. Idempotent check: ONLY if currently active published version of this exam
    IF v_version_rec.status = 'published' AND v_test_rec.current_version_id = p_version_id THEN
        RETURN jsonb_build_object(
            'exam_id', v_version_rec.exam_id,
            'version_id', p_version_id,
            'version_number', v_version_rec.version_number,
            'total_points', v_version_rec.total_points,
            'status', 'published',
            'published_at', v_version_rec.published_at,
            'idempotent_replay', true
        );
    END IF;

    IF v_version_rec.status <> 'draft' THEN
        RAISE EXCEPTION 'ERR_NOT_DRAFT: Only draft versions can be published (current status: %)', v_version_rec.status USING ERRCODE = '22000';
    END IF;

    -- 5. Verify question counts & compute total_points server-side
    SELECT COUNT(*), COALESCE(SUM(points), 0.00)
    INTO v_question_count, v_computed_total
    FROM public.exam_questions
    WHERE exam_version_id = p_version_id;

    IF v_question_count = 0 THEN
        RAISE EXCEPTION 'ERR_NO_QUESTIONS: Exam must have at least 1 question to be published' USING ERRCODE = '22000';
    END IF;

    IF v_computed_total <= 0.00 THEN
        RAISE EXCEPTION 'ERR_INVALID_TOTAL_POINTS: Total points must be > 0 (calculated: %)', v_computed_total USING ERRCODE = '22003';
    END IF;

    -- 6. Validate Answer Key Invariants
    -- AUTO questions MUST have valid answer keys
    SELECT COUNT(*) INTO v_invalid_auto_count
    FROM public.exam_questions q
    LEFT JOIN app_private.exam_answer_keys k ON k.question_id = q.id
    WHERE q.exam_version_id = p_version_id
      AND q.question_type IN ('single_choice', 'multiple_choice', 'fill_blank', 'short_answer')
      AND (k.question_id IS NULL OR k.correct_answer IS NULL);

    IF v_invalid_auto_count > 0 THEN
        RAISE EXCEPTION 'ERR_AUTO_MISSING_ANSWER_KEYS: % auto-graded question(s) missing valid answer keys', v_invalid_auto_count USING ERRCODE = '22000';
    END IF;

    -- MANUAL questions MUST have ZERO answer key rows
    SELECT COUNT(*) INTO v_invalid_manual_count
    FROM public.exam_questions q
    JOIN app_private.exam_answer_keys k ON k.question_id = q.id
    WHERE q.exam_version_id = p_version_id
      AND q.question_type IN ('essay', 'image_upload', 'file_upload');

    IF v_invalid_manual_count > 0 THEN
        RAISE EXCEPTION 'ERR_MANUAL_HAS_ANSWER_KEYS: % manual question(s) have invalid answer key rows', v_invalid_manual_count USING ERRCODE = '22000';
    END IF;

    -- 7. Atomically transition states
    -- A. Supersede any previously published version of this exam
    UPDATE public.exam_versions
    SET status = 'superseded'
    WHERE exam_id = v_version_rec.exam_id
      AND status = 'published'
      AND id <> p_version_id;

    -- B. Publish target version
    UPDATE public.exam_versions
    SET
        status = 'published',
        published_at = v_published_at,
        total_points = v_computed_total
    WHERE id = p_version_id;

    -- C. Atomically point exam container current_version_id to this published version
    UPDATE public.exam_tests
    SET
        current_version_id = p_version_id,
        updated_at = v_published_at
    WHERE id = v_version_rec.exam_id;

    -- 8. Return summary
    RETURN jsonb_build_object(
        'exam_id', v_version_rec.exam_id,
        'version_id', p_version_id,
        'version_number', v_version_rec.version_number,
        'total_points', v_computed_total,
        'status', 'published',
        'published_at', v_published_at,
        'idempotent_replay', false
    );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_exam_publish_version(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_exam_publish_version(UUID, UUID, BOOLEAN) TO service_role;
