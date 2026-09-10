-- ============================================================
-- TEST / EXAM BUILDER V1
-- PHASE A: FLEXIBLE EXAM SCHEDULING CONTRACT MIGRATION
-- TARGET_PROJECT_REF: szptvqkoiphrhlionfoh
-- FORBIDDEN_CORE_REF: nddimmxpymipalpxlops
-- ============================================================
-- Adds flexible scheduling columns to exam_versions and exam_assignments.
-- Atomically updates authoring, assignment, and start-attempt RPCs.
-- Preserves backward compatibility for legacy assignments with only due_date.
-- Strictly transactional (BEGIN / COMMIT).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. SCHEMA EXTENSIONS (Non-destructive DDL)
-- ------------------------------------------------------------

-- Add last_start_at to public.exam_versions
ALTER TABLE public.exam_versions 
    ADD COLUMN IF NOT EXISTS last_start_at TIMESTAMPTZ NULL;

-- Add starts_at and last_start_at to public.exam_assignments
ALTER TABLE public.exam_assignments 
    ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS last_start_at TIMESTAMPTZ NULL;


-- ------------------------------------------------------------
-- 2. UPDATE RPC: public.rpc_exam_save_draft_version
-- ------------------------------------------------------------
-- Drop old 18-parameter signature to prevent ambiguous overload
DROP FUNCTION IF EXISTS public.rpc_exam_save_draft_version(
    UUID, UUID, VARCHAR, VARCHAR, INT, TEXT, INT, TIMESTAMPTZ, TIMESTAMPTZ, INT, INT, BOOLEAN, BOOLEAN, VARCHAR, BOOLEAN, BOOLEAN, JSONB, BOOLEAN
);

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
    p_is_admin BOOLEAN DEFAULT FALSE,
    p_last_start_at TIMESTAMPTZ DEFAULT NULL
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
    IF p_shuffle_questions IS NULL THEN
        RAISE EXCEPTION 'ERR_REQUIRED_PARAMS: shuffle_questions cannot be null' USING ERRCODE = '22000';
    END IF;

    IF p_shuffle_options IS NULL THEN
        RAISE EXCEPTION 'ERR_REQUIRED_PARAMS: shuffle_options cannot be null' USING ERRCODE = '22000';
    END IF;

    IF p_show_score_after_submit IS NULL THEN
        RAISE EXCEPTION 'ERR_REQUIRED_PARAMS: show_score_after_submit cannot be null' USING ERRCODE = '22000';
    END IF;

    IF p_show_correct_answers IS NULL THEN
        RAISE EXCEPTION 'ERR_REQUIRED_PARAMS: show_correct_answers cannot be null' USING ERRCODE = '22000';
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

    IF p_duration_minutes IS NOT NULL AND (p_duration_minutes < 1 OR p_duration_minutes > 300) THEN
        RAISE EXCEPTION 'ERR_INVALID_DURATION: Duration must be between 1 and 300 minutes' USING ERRCODE = '22003';
    END IF;

    IF p_max_attempts IS NULL OR p_max_attempts < 1 OR p_max_attempts > 100 THEN
        RAISE EXCEPTION 'ERR_INVALID_MAX_ATTEMPTS: Max attempts must be between 1 and 100' USING ERRCODE = '22003';
    END IF;

    IF p_reward_stars IS NULL OR p_reward_stars < 0 OR p_reward_stars > 1000 THEN
        RAISE EXCEPTION 'ERR_INVALID_REWARD_STARS: Reward stars must be between 0 and 1000' USING ERRCODE = '22003';
    END IF;

    IF p_tab_switch_policy IS NULL OR p_tab_switch_policy NOT IN ('OFF', 'WARN_ONLY', 'WARN_AND_LOG') THEN
        RAISE EXCEPTION 'ERR_INVALID_TAB_POLICY: Invalid tab switch policy %', p_tab_switch_policy USING ERRCODE = '22000';
    END IF;

    -- Scheduling window validation
    IF p_starts_at IS NOT NULL AND p_last_start_at IS NOT NULL AND p_last_start_at < p_starts_at THEN
        RAISE EXCEPTION 'ERR_INVALID_SCHEDULE: last_start_at (%) cannot be earlier than starts_at (%)', p_last_start_at, p_starts_at USING ERRCODE = '22000';
    END IF;

    IF p_due_date IS NOT NULL AND p_last_start_at IS NOT NULL AND p_last_start_at > p_due_date THEN
        RAISE EXCEPTION 'ERR_INVALID_SCHEDULE: last_start_at (%) cannot be later than due_date (%)', p_last_start_at, p_due_date USING ERRCODE = '22000';
    END IF;

    -- 5. Validate p_questions JSON Shape (Array Required)
    IF p_questions IS NULL OR jsonb_typeof(p_questions) <> 'array' THEN
        RAISE EXCEPTION 'ERR_INVALID_QUESTIONS_PAYLOAD: p_questions must be a JSON array' USING ERRCODE = '22000';
    END IF;

    -- 6. Complete Question Item & Provenance Validation BEFORE any mutation
    FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions)
    LOOP
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

        v_q_num := (v_q.value->>'question_number')::INT;
        IF v_q_num IS NULL OR v_q_num < 1 THEN
            RAISE EXCEPTION 'ERR_INVALID_QUESTION_NUMBER: question_number must be >= 1' USING ERRCODE = '22003';
        END IF;

        IF v_q_num = ANY(v_seen_numbers) THEN
            RAISE EXCEPTION 'ERR_DUPLICATE_QUESTION_NUMBER: Duplicate question_number % in payload', v_q_num USING ERRCODE = '23505';
        END IF;
        v_seen_numbers := array_append(v_seen_numbers, v_q_num);

        v_q_type := v_q.value->>'question_type';
        IF v_q_type NOT IN ('single_choice', 'multiple_choice', 'fill_blank', 'short_answer', 'essay', 'image_upload', 'file_upload') THEN
            RAISE EXCEPTION 'ERR_INVALID_QUESTION_TYPE: Unknown question_type %', v_q_type USING ERRCODE = '22000';
        END IF;

        v_prompt := BTRIM(v_q.value->>'prompt');
        IF v_prompt IS NULL OR LENGTH(v_prompt) = 0 THEN
            RAISE EXCEPTION 'ERR_INVALID_PROMPT: Question % prompt cannot be empty', v_q_num USING ERRCODE = '22000';
        END IF;

        v_points := (v_q.value->>'points')::NUMERIC(6, 2);
        IF v_points IS NULL OR v_points <= 0.00 THEN
            RAISE EXCEPTION 'ERR_INVALID_POINTS: Question % points must be > 0', v_q_num USING ERRCODE = '22003';
        END IF;

        IF v_q.value->>'source_question_bank_item_id' IS NOT NULL AND LENGTH(BTRIM(v_q.value->>'source_question_bank_item_id')) > 0 THEN
            BEGIN
                v_source_item_id := (v_q.value->>'source_question_bank_item_id')::UUID;
            EXCEPTION WHEN OTHERS THEN
                RAISE EXCEPTION 'ERR_INVALID_SOURCE_UUID: source_question_bank_item_id % is not a valid UUID', v_q.value->>'source_question_bank_item_id' USING ERRCODE = '22000';
            END;
        END IF;

        IF v_q.value->>'source_question_bank_version_id' IS NOT NULL AND LENGTH(BTRIM(v_q.value->>'source_question_bank_version_id')) > 0 THEN
            BEGIN
                v_source_ver_id := (v_q.value->>'source_question_bank_version_id')::UUID;
            EXCEPTION WHEN OTHERS THEN
                RAISE EXCEPTION 'ERR_INVALID_SOURCE_UUID: source_question_bank_version_id % is not a valid UUID', v_q.value->>'source_question_bank_version_id' USING ERRCODE = '22000';
            END;
        END IF;

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

    -- 7. PASS 2: Mutation Pass
    UPDATE public.exam_versions
    SET
        title = v_title_clean,
        description = p_description,
        subject = v_subject_clean,
        grade_level = p_grade_level,
        duration_minutes = p_duration_minutes,
        starts_at = p_starts_at,
        last_start_at = p_last_start_at,
        due_date = p_due_date,
        max_attempts = p_max_attempts,
        reward_stars = p_reward_stars,
        shuffle_questions = p_shuffle_questions,
        shuffle_options = p_shuffle_options,
        tab_switch_policy = p_tab_switch_policy,
        show_score_after_submit = p_show_score_after_submit,
        show_correct_answers = p_show_correct_answers
    WHERE id = p_version_id;

    -- Cleanly delete old questions
    DELETE FROM public.exam_questions WHERE exam_version_id = p_version_id;

    -- Insert validated questions and keys
    FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions)
    LOOP
        v_question_id := (v_q.value->>'id')::UUID;
        v_q_num := (v_q.value->>'question_number')::INT;
        v_q_type := v_q.value->>'question_type';
        v_prompt := BTRIM(v_q.value->>'prompt');
        v_points := COALESCE((v_q.value->>'points')::NUMERIC(6, 2), 1.00);
        v_options := COALESCE(v_q.value->'options_json', '[]'::jsonb);
        v_source_item_id := CASE WHEN v_q.value->>'source_question_bank_item_id' IS NOT NULL AND LENGTH(BTRIM(v_q.value->>'source_question_bank_item_id')) > 0 THEN (v_q.value->>'source_question_bank_item_id')::UUID ELSE NULL END;
        v_source_ver_id := CASE WHEN v_q.value->>'source_question_bank_version_id' IS NOT NULL AND LENGTH(BTRIM(v_q.value->>'source_question_bank_version_id')) > 0 THEN (v_q.value->>'source_question_bank_version_id')::UUID ELSE NULL END;
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

    RETURN jsonb_build_object(
        'version_id', p_version_id,
        'question_count', v_question_count,
        'status', 'draft'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_exam_save_draft_version(UUID, UUID, VARCHAR, VARCHAR, INT, TEXT, INT, TIMESTAMPTZ, TIMESTAMPTZ, INT, INT, BOOLEAN, BOOLEAN, VARCHAR, BOOLEAN, BOOLEAN, JSONB, BOOLEAN, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_exam_save_draft_version(UUID, UUID, VARCHAR, VARCHAR, INT, TEXT, INT, TIMESTAMPTZ, TIMESTAMPTZ, INT, INT, BOOLEAN, BOOLEAN, VARCHAR, BOOLEAN, BOOLEAN, JSONB, BOOLEAN, TIMESTAMPTZ) TO service_role;


-- ------------------------------------------------------------
-- 3. UPDATE RPC: public.rpc_exam_create_assignment
-- ------------------------------------------------------------
-- Drop old 7-parameter signature to prevent ambiguous overload
DROP FUNCTION IF EXISTS public.rpc_exam_create_assignment(
    UUID, UUID, UUID, UUID, TIMESTAMPTZ, BOOLEAN, BOOLEAN
);

CREATE OR REPLACE FUNCTION public.rpc_exam_create_assignment(
    p_caller_id UUID,
    p_assignment_id UUID,
    p_exam_version_id UUID,
    p_class_id UUID,
    p_due_date TIMESTAMPTZ DEFAULT NULL,
    p_counts_toward_ranking BOOLEAN DEFAULT TRUE,
    p_is_admin BOOLEAN DEFAULT FALSE,
    p_starts_at TIMESTAMPTZ DEFAULT NULL,
    p_last_start_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private
AS $$
DECLARE
    v_version_rec RECORD;
    v_test_rec RECORD;
    v_existing_assignment RECORD;
    v_existing_by_class RECORD;
    v_inserted_rows INT := 0;
BEGIN
    -- 1. Input validation
    IF p_caller_id IS NULL THEN
        RAISE EXCEPTION 'ERR_CALLER_ID_REQUIRED: Caller identity is required' USING ERRCODE = '22000';
    END IF;

    IF p_assignment_id IS NULL OR p_exam_version_id IS NULL OR p_class_id IS NULL THEN
        RAISE EXCEPTION 'ERR_REQUIRED_PARAMS: assignment_id, exam_version_id, and class_id are required' USING ERRCODE = '22000';
    END IF;

    IF p_counts_toward_ranking IS NULL THEN
        RAISE EXCEPTION 'ERR_REQUIRED_PARAMS: counts_toward_ranking cannot be null' USING ERRCODE = '22000';
    END IF;

    -- 2. Check if assignment ID already exists (Exact Replay Gate)
    SELECT * INTO v_existing_assignment
    FROM public.exam_assignments
    WHERE id = p_assignment_id
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing_assignment.exam_version_id = p_exam_version_id AND
           v_existing_assignment.class_id = p_class_id AND
           v_existing_assignment.assigned_by = p_caller_id AND
           v_existing_assignment.due_date IS NOT DISTINCT FROM p_due_date AND
           v_existing_assignment.starts_at IS NOT DISTINCT FROM p_starts_at AND
           v_existing_assignment.last_start_at IS NOT DISTINCT FROM p_last_start_at AND
           v_existing_assignment.counts_toward_ranking = p_counts_toward_ranking THEN

            RETURN jsonb_build_object(
                'assignment_id', v_existing_assignment.id,
                'exam_version_id', v_existing_assignment.exam_version_id,
                'class_id', v_existing_assignment.class_id,
                'assigned_by', v_existing_assignment.assigned_by,
                'due_date', v_existing_assignment.due_date,
                'starts_at', v_existing_assignment.starts_at,
                'last_start_at', v_existing_assignment.last_start_at,
                'counts_toward_ranking', v_existing_assignment.counts_toward_ranking,
                'idempotent_replay', true
            );
        ELSE
            RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: Assignment ID exists with conflicting payload' USING ERRCODE = '23505';
        END IF;
    END IF;

    -- 3. Lock & fetch target exam_version (Only for new assignments)
    SELECT * INTO v_version_rec
    FROM public.exam_versions
    WHERE id = p_exam_version_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_VERSION_NOT_FOUND: Version % does not exist', p_exam_version_id USING ERRCODE = 'P0002';
    END IF;

    IF v_version_rec.status <> 'published' THEN
        RAISE EXCEPTION 'ERR_VERSION_NOT_PUBLISHED: Only published versions can be assigned (current status: %)', v_version_rec.status USING ERRCODE = '22000';
    END IF;

    -- 4. Lock & fetch parent exam container
    SELECT * INTO v_test_rec
    FROM public.exam_tests
    WHERE id = v_version_rec.exam_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_EXAM_NOT_FOUND: Exam container % does not exist', v_version_rec.exam_id USING ERRCODE = 'P0002';
    END IF;

    IF v_test_rec.status <> 'active' THEN
        RAISE EXCEPTION 'ERR_EXAM_ARCHIVED: Cannot assign an archived exam (%)', v_version_rec.exam_id USING ERRCODE = '22000';
    END IF;

    -- 5. Authorization check: Only exam author or Admin can assign
    IF NOT p_is_admin AND v_test_rec.author_id <> p_caller_id THEN
        RAISE EXCEPTION 'ERR_UNAUTHORIZED: Caller is not the author of this exam' USING ERRCODE = '42501';
    END IF;

    -- 6. Due date override validation
    IF v_version_rec.due_date IS NOT NULL AND p_due_date IS NOT NULL THEN
        IF p_due_date > v_version_rec.due_date THEN
            RAISE EXCEPTION 'ERR_INVALID_DUE_DATE: Assignment due date (%) cannot be later than exam version due date (%)', p_due_date, v_version_rec.due_date USING ERRCODE = '22000';
        END IF;
    END IF;

    -- Schedule validation
    IF p_starts_at IS NOT NULL AND p_last_start_at IS NOT NULL AND p_last_start_at < p_starts_at THEN
        RAISE EXCEPTION 'ERR_INVALID_SCHEDULE: Assignment last_start_at (%) cannot be earlier than starts_at (%)', p_last_start_at, p_starts_at USING ERRCODE = '22000';
    END IF;

    -- 7. Check unique(exam_version_id, class_id) under a DIFFERENT assignment_id
    SELECT * INTO v_existing_by_class
    FROM public.exam_assignments
    WHERE exam_version_id = p_exam_version_id
      AND class_id = p_class_id;

    IF FOUND AND v_existing_by_class.id <> p_assignment_id THEN
        RAISE EXCEPTION 'ERR_ASSIGNMENT_ALREADY_EXISTS: Exam version % is already assigned to class % under assignment ID %', p_exam_version_id, p_class_id, v_existing_by_class.id USING ERRCODE = '23505';
    END IF;

    -- 8. Atomic insert
    INSERT INTO public.exam_assignments (
        id,
        exam_version_id,
        class_id,
        assigned_by,
        due_date,
        counts_toward_ranking,
        starts_at,
        last_start_at
    ) VALUES (
        p_assignment_id,
        p_exam_version_id,
        p_class_id,
        p_caller_id,
        p_due_date,
        p_counts_toward_ranking,
        p_starts_at,
        p_last_start_at
    )
    ON CONFLICT (id) DO NOTHING;

    GET DIAGNOSTICS v_inserted_rows = ROW_COUNT;

    IF v_inserted_rows = 0 THEN
        SELECT * INTO v_existing_assignment
        FROM public.exam_assignments
        WHERE id = p_assignment_id
        FOR UPDATE;

        IF v_existing_assignment.exam_version_id = p_exam_version_id AND
           v_existing_assignment.class_id = p_class_id AND
           v_existing_assignment.assigned_by = p_caller_id AND
           v_existing_assignment.due_date IS NOT DISTINCT FROM p_due_date AND
           v_existing_assignment.starts_at IS NOT DISTINCT FROM p_starts_at AND
           v_existing_assignment.last_start_at IS NOT DISTINCT FROM p_last_start_at AND
           v_existing_assignment.counts_toward_ranking = p_counts_toward_ranking THEN

            RETURN jsonb_build_object(
                'assignment_id', v_existing_assignment.id,
                'exam_version_id', v_existing_assignment.exam_version_id,
                'class_id', v_existing_assignment.class_id,
                'assigned_by', v_existing_assignment.assigned_by,
                'due_date', v_existing_assignment.due_date,
                'starts_at', v_existing_assignment.starts_at,
                'last_start_at', v_existing_assignment.last_start_at,
                'counts_toward_ranking', v_existing_assignment.counts_toward_ranking,
                'idempotent_replay', true
            );
        ELSE
            RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: Concurrent insert with conflicting assignment payload' USING ERRCODE = '23505';
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'assignment_id', p_assignment_id,
        'exam_version_id', p_exam_version_id,
        'class_id', p_class_id,
        'assigned_by', p_caller_id,
        'due_date', p_due_date,
        'starts_at', p_starts_at,
        'last_start_at', p_last_start_at,
        'counts_toward_ranking', p_counts_toward_ranking,
        'idempotent_replay', false
    );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_exam_create_assignment(UUID, UUID, UUID, UUID, TIMESTAMPTZ, BOOLEAN, BOOLEAN, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_exam_create_assignment(UUID, UUID, UUID, UUID, TIMESTAMPTZ, BOOLEAN, BOOLEAN, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;


-- ------------------------------------------------------------
-- 4. UPDATE RPC: public.rpc_exam_start_attempt
-- ------------------------------------------------------------
-- Signature unchanged: (p_caller_id UUID, p_attempt_id UUID, p_assignment_id UUID, p_student_id UUID)
-- Implements flexible scheduling runtime contract with backward-compatible due_date fallback.
CREATE OR REPLACE FUNCTION public.rpc_exam_start_attempt(
    p_caller_id UUID,
    p_attempt_id UUID,
    p_assignment_id UUID,
    p_student_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private
AS $$
DECLARE
    v_assignment_rec RECORD;
    v_version_rec RECORD;
    v_test_rec RECORD;
    v_active_draft RECORD;
    v_existing_attempt RECORD;
    v_next_attempt_number INT;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_effective_starts_at TIMESTAMPTZ;
    v_effective_last_start TIMESTAMPTZ;
    v_effective_hard_close TIMESTAMPTZ;
    v_duration_deadline TIMESTAMPTZ;
    v_expires_at TIMESTAMPTZ;
    v_question_order JSONB;
    v_option_orders JSONB := '{}'::jsonb;
    v_q RECORD;
    v_opt RECORD;
    v_seen_keys TEXT[];
    v_opt_key TEXT;
    v_shuffled_keys JSONB;
    v_is_expired BOOLEAN := FALSE;
BEGIN
    -- 1. Input parameter validation
    IF p_caller_id IS NULL THEN
        RAISE EXCEPTION 'ERR_CALLER_ID_REQUIRED: Caller identity is required' USING ERRCODE = '22000';
    END IF;

    IF p_attempt_id IS NULL OR p_assignment_id IS NULL OR p_student_id IS NULL THEN
        RAISE EXCEPTION 'ERR_REQUIRED_PARAMS: attempt_id, assignment_id, and student_id are required' USING ERRCODE = '22000';
    END IF;

    IF p_caller_id <> p_student_id THEN
        RAISE EXCEPTION 'ERR_STUDENT_IMPERSONATION: Caller % cannot start attempt for student %', p_caller_id, p_student_id USING ERRCODE = '42501';
    END IF;

    -- 2. Lock & fetch assignment
    SELECT * INTO v_assignment_rec
    FROM public.exam_assignments
    WHERE id = p_assignment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_ASSIGNMENT_NOT_FOUND: Assignment % does not exist', p_assignment_id USING ERRCODE = 'P0002';
    END IF;

    -- 3. Lock & fetch version
    SELECT * INTO v_version_rec
    FROM public.exam_versions
    WHERE id = v_assignment_rec.exam_version_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_VERSION_NOT_FOUND: Version % does not exist', v_assignment_rec.exam_version_id USING ERRCODE = 'P0002';
    END IF;

    IF v_version_rec.status <> 'published' THEN
        RAISE EXCEPTION 'ERR_VERSION_NOT_PUBLISHED: Version % is not published (current status: %)', v_version_rec.id, v_version_rec.status USING ERRCODE = '22000';
    END IF;

    -- 4. Lock & fetch exam container
    SELECT * INTO v_test_rec
    FROM public.exam_tests
    WHERE id = v_version_rec.exam_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_EXAM_NOT_FOUND: Exam % does not exist', v_version_rec.exam_id USING ERRCODE = 'P0002';
    END IF;

    IF v_test_rec.status <> 'active' THEN
        RAISE EXCEPTION 'ERR_EXAM_ARCHIVED: Exam % is archived', v_test_rec.id USING ERRCODE = '22000';
    END IF;

    -- 5. Exact Idempotency Check on attempt ID
    SELECT * INTO v_existing_attempt
    FROM public.exam_attempts
    WHERE id = p_attempt_id
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing_attempt.assignment_id = p_assignment_id AND
           v_existing_attempt.student_id = p_student_id AND
           v_existing_attempt.exam_version_id = v_assignment_rec.exam_version_id THEN

            IF v_existing_attempt.status IN ('submitted', 'pending_manual_grade', 'graded') THEN
                RETURN jsonb_build_object(
                    'attempt_id', v_existing_attempt.id,
                    'assignment_id', v_existing_attempt.assignment_id,
                    'exam_version_id', v_existing_attempt.exam_version_id,
                    'student_id', v_existing_attempt.student_id,
                    'attempt_number', v_existing_attempt.attempt_number,
                    'status', v_existing_attempt.status,
                    'attempt_started_at', v_existing_attempt.attempt_started_at,
                    'expires_at', v_existing_attempt.expires_at,
                    'max_score', v_existing_attempt.max_score,
                    'question_order', v_existing_attempt.question_order,
                    'option_orders', v_existing_attempt.option_orders,
                    'attempt_version', v_existing_attempt.version,
                    'resumed_existing', false,
                    'idempotent_replay', true,
                    'expired', false,
                    'already_finalized', true
                );
            END IF;

            v_is_expired := (v_existing_attempt.expires_at IS NOT NULL AND v_now >= v_existing_attempt.expires_at);

            IF v_is_expired THEN
                RETURN jsonb_build_object(
                    'attempt_id', v_existing_attempt.id,
                    'assignment_id', v_existing_attempt.assignment_id,
                    'exam_version_id', v_existing_attempt.exam_version_id,
                    'student_id', v_existing_attempt.student_id,
                    'attempt_number', v_existing_attempt.attempt_number,
                    'status', v_existing_attempt.status,
                    'attempt_started_at', v_existing_attempt.attempt_started_at,
                    'expires_at', v_existing_attempt.expires_at,
                    'max_score', v_existing_attempt.max_score,
                    'question_order', v_existing_attempt.question_order,
                    'option_orders', v_existing_attempt.option_orders,
                    'attempt_version', v_existing_attempt.version,
                    'resumed_existing', false,
                    'idempotent_replay', true,
                    'expired', true,
                    'already_finalized', false
                );
            END IF;

            RETURN jsonb_build_object(
                'attempt_id', v_existing_attempt.id,
                'assignment_id', v_existing_attempt.assignment_id,
                'exam_version_id', v_existing_attempt.exam_version_id,
                'student_id', v_existing_attempt.student_id,
                'attempt_number', v_existing_attempt.attempt_number,
                'status', v_existing_attempt.status,
                'attempt_started_at', v_existing_attempt.attempt_started_at,
                'expires_at', v_existing_attempt.expires_at,
                'max_score', v_existing_attempt.max_score,
                'question_order', v_existing_attempt.question_order,
                'option_orders', v_existing_attempt.option_orders,
                'attempt_version', v_existing_attempt.version,
                'resumed_existing', false,
                'idempotent_replay', true,
                'expired', false,
                'already_finalized', false
            );
        ELSE
            RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: Attempt ID exists with conflicting payload' USING ERRCODE = '23505';
        END IF;
    END IF;

    -- 6. Check if student already finalized an attempt under single attempt policy
    IF v_version_rec.max_attempts = 1 THEN
        SELECT * INTO v_existing_attempt
        FROM public.exam_attempts
        WHERE assignment_id = p_assignment_id
          AND student_id = p_student_id
          AND status IN ('submitted', 'pending_manual_grade', 'graded')
        ORDER BY attempt_number DESC
        LIMIT 1
        FOR UPDATE;

        IF FOUND THEN
            RAISE EXCEPTION 'ERR_ATTEMPT_ALREADY_FINALIZED: Student has already completed their single allowed attempt' USING ERRCODE = '22000';
        END IF;
    END IF;

    -- 7. Resume existing draft check (Evaluated BEFORE new attempt time window)
    SELECT * INTO v_active_draft
    FROM public.exam_attempts
    WHERE assignment_id = p_assignment_id
      AND student_id = p_student_id
      AND status = 'draft'
    ORDER BY attempt_number DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
        IF v_active_draft.expires_at IS NOT NULL AND v_now >= v_active_draft.expires_at THEN
            RAISE EXCEPTION 'ERR_ATTEMPT_EXPIRED: Active draft attempt expired at %', v_active_draft.expires_at USING ERRCODE = '22000';
        END IF;

        -- Resume existing active unexpired draft attempt with stored orders and expires_at unchanged
        RETURN jsonb_build_object(
            'attempt_id', v_active_draft.id,
            'assignment_id', v_active_draft.assignment_id,
            'exam_version_id', v_active_draft.exam_version_id,
            'student_id', v_active_draft.student_id,
            'attempt_number', v_active_draft.attempt_number,
            'status', v_active_draft.status,
            'attempt_started_at', v_active_draft.attempt_started_at,
            'expires_at', v_active_draft.expires_at,
            'max_score', v_active_draft.max_score,
            'question_order', v_active_draft.question_order,
            'option_orders', v_active_draft.option_orders,
            'attempt_version', v_active_draft.version,
            'resumed_existing', true,
            'idempotent_replay', false,
            'expired', false,
            'already_finalized', false
        );
    END IF;

    -- 8. New Attempt Time Window Validation (Only for newly created attempts)
    v_effective_starts_at := COALESCE(v_assignment_rec.starts_at, v_version_rec.starts_at);

    v_effective_last_start := COALESCE(
        v_assignment_rec.last_start_at,
        v_version_rec.last_start_at,
        v_assignment_rec.due_date,
        v_version_rec.due_date
    );

    IF v_version_rec.due_date IS NULL AND v_assignment_rec.due_date IS NULL THEN
        v_effective_hard_close := NULL;
    ELSIF v_version_rec.due_date IS NOT NULL AND v_assignment_rec.due_date IS NULL THEN
        v_effective_hard_close := v_version_rec.due_date;
    ELSIF v_version_rec.due_date IS NULL AND v_assignment_rec.due_date IS NOT NULL THEN
        v_effective_hard_close := v_assignment_rec.due_date;
    ELSE
        v_effective_hard_close := LEAST(v_version_rec.due_date, v_assignment_rec.due_date);
    END IF;

    -- A. Starts at check
    IF v_effective_starts_at IS NOT NULL AND v_now < v_effective_starts_at THEN
        RAISE EXCEPTION 'ERR_EXAM_NOT_STARTED: Exam has not started yet (starts at %)', v_effective_starts_at USING ERRCODE = '22000';
    END IF;

    -- B. Last start window check (Gate for new attempt creation: [starts_at, last_start_at) half-open interval)
    -- Allowed only while NOW() < last_start_at, blocked when NOW() >= last_start_at
    IF v_effective_last_start IS NOT NULL AND v_now >= v_effective_last_start THEN
        RAISE EXCEPTION 'ERR_EXAM_CLOSED: Exam start window has closed (closed at %)', v_effective_last_start USING ERRCODE = '22000';
    END IF;

    -- C. Hard close check
    IF v_effective_hard_close IS NOT NULL AND v_now >= v_effective_hard_close THEN
        RAISE EXCEPTION 'ERR_EXAM_CLOSED: Exam due date has passed (closed at %)', v_effective_hard_close USING ERRCODE = '22000';
    END IF;

    -- D. Calculate personal expires_at
    IF v_version_rec.duration_minutes IS NOT NULL THEN
        v_duration_deadline := v_now + (v_version_rec.duration_minutes || ' minutes')::INTERVAL;
    ELSE
        v_duration_deadline := NULL;
    END IF;

    IF v_duration_deadline IS NOT NULL AND v_effective_hard_close IS NOT NULL THEN
        v_expires_at := LEAST(v_duration_deadline, v_effective_hard_close);
    ELSIF v_duration_deadline IS NOT NULL AND v_effective_hard_close IS NULL THEN
        v_expires_at := v_duration_deadline;
    ELSIF v_duration_deadline IS NULL AND v_effective_hard_close IS NOT NULL THEN
        v_expires_at := v_effective_hard_close;
    ELSE
        v_expires_at := NULL;
    END IF;

    -- 9. Determine next attempt number and enforce max_attempts
    SELECT COALESCE(MAX(attempt_number), 0) + 1
    INTO v_next_attempt_number
    FROM public.exam_attempts
    WHERE assignment_id = p_assignment_id
      AND student_id = p_student_id;

    IF v_next_attempt_number > v_version_rec.max_attempts THEN
        RAISE EXCEPTION 'ERR_MAX_ATTEMPTS_EXCEEDED: Maximum attempts reached (%)', v_version_rec.max_attempts USING ERRCODE = '22000';
    END IF;

    -- 10. Generate Question Snapshot
    IF v_version_rec.shuffle_questions THEN
        SELECT jsonb_agg(id ORDER BY random())
        INTO v_question_order
        FROM public.exam_questions
        WHERE exam_version_id = v_assignment_rec.exam_version_id;
    ELSE
        SELECT jsonb_agg(id ORDER BY question_number ASC)
        INTO v_question_order
        FROM public.exam_questions
        WHERE exam_version_id = v_assignment_rec.exam_version_id;
    END IF;

    IF v_question_order IS NULL THEN
        v_question_order := '[]'::jsonb;
    END IF;

    -- 11. Generate Option Orders Snapshot
    IF v_version_rec.shuffle_options THEN
        FOR v_q IN 
            SELECT id, question_type, options_json, question_number 
            FROM public.exam_questions 
            WHERE exam_version_id = v_assignment_rec.exam_version_id
            ORDER BY question_number ASC
        LOOP
            IF v_q.question_type IN ('single_choice', 'multiple_choice') THEN
                IF v_q.options_json IS NULL OR jsonb_typeof(v_q.options_json) <> 'array' THEN
                    RAISE EXCEPTION 'ERR_CORRUPT_QUESTION_OPTIONS: Question % has non-array options_json', v_q.id USING ERRCODE = '22000';
                END IF;

                IF jsonb_array_length(v_q.options_json) < 2 THEN
                    RAISE EXCEPTION 'ERR_CORRUPT_QUESTION_OPTIONS: Choice question % has fewer than 2 options', v_q.id USING ERRCODE = '22000';
                END IF;

                v_seen_keys := ARRAY[]::TEXT[];
                FOR v_opt IN SELECT * FROM jsonb_array_elements(v_q.options_json)
                LOOP
                    v_opt_key := v_opt.value->>'key';
                    IF v_opt_key IS NULL OR LENGTH(BTRIM(v_opt_key)) = 0 THEN
                        RAISE EXCEPTION 'ERR_CORRUPT_QUESTION_OPTIONS: Option key in question % is empty', v_q.id USING ERRCODE = '22000';
                    END IF;
                    IF v_opt_key = ANY(v_seen_keys) THEN
                        RAISE EXCEPTION 'ERR_CORRUPT_QUESTION_OPTIONS: Duplicate option key % in question %', v_opt_key, v_q.id USING ERRCODE = '22000';
                    END IF;
                    v_seen_keys := array_append(v_seen_keys, v_opt_key);
                END LOOP;

                SELECT jsonb_agg(opt->>'key' ORDER BY random())
                INTO v_shuffled_keys
                FROM jsonb_array_elements(v_q.options_json) AS opt;

                v_option_orders := v_option_orders || jsonb_build_object(v_q.id::text, v_shuffled_keys);
            END IF;
        END LOOP;
    END IF;

    -- 12. Create Attempt Row
    INSERT INTO public.exam_attempts (
        id,
        assignment_id,
        exam_version_id,
        student_id,
        attempt_number,
        status,
        attempt_started_at,
        expires_at,
        submitted_at,
        objective_score,
        manual_score,
        total_score,
        max_score,
        question_order,
        option_orders,
        version
    ) VALUES (
        p_attempt_id,
        p_assignment_id,
        v_assignment_rec.exam_version_id,
        p_student_id,
        v_next_attempt_number,
        'draft',
        v_now,
        v_expires_at,
        NULL,
        NULL,
        NULL,
        NULL,
        v_version_rec.total_points,
        v_question_order,
        v_option_orders,
        1
    );

    -- 13. Return Success Payload
    RETURN jsonb_build_object(
        'attempt_id', p_attempt_id,
        'assignment_id', p_assignment_id,
        'exam_version_id', v_assignment_rec.exam_version_id,
        'student_id', p_student_id,
        'attempt_number', v_next_attempt_number,
        'status', 'draft',
        'attempt_started_at', v_now,
        'expires_at', v_expires_at,
        'max_score', v_version_rec.total_points,
        'question_order', v_question_order,
        'option_orders', v_option_orders,
        'attempt_version', 1,
        'resumed_existing', false,
        'idempotent_replay', false,
        'expired', false,
        'already_finalized', false
    );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_exam_start_attempt(UUID, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_exam_start_attempt(UUID, UUID, UUID, UUID) TO service_role;

COMMIT;
