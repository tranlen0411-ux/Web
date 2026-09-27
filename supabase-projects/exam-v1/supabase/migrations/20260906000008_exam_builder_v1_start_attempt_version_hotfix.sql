-- supabase/migrations/20260906000008_exam_builder_v1_start_attempt_version_hotfix.sql
-- Exam Builder V1 - Student Start Attempt Version Contract Hotfix
-- Adds attempt_version to every successful rpc_exam_start_attempt return payload
-- Strictly preserves security definer, permissions, caller validation, and all lifecycle gates.

BEGIN;

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
    v_now TIMESTAMPTZ := NOW();
    v_effective_close TIMESTAMPTZ;
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

    -- Student Identity Invariant: Caller must match student identity (No impersonation in V1)
    IF p_caller_id <> p_student_id THEN
        RAISE EXCEPTION 'ERR_STUDENT_IDENTITY_MISMATCH: Caller identity (%) does not match student identity (%)', p_caller_id, p_student_id USING ERRCODE = '42501';
    END IF;

    -- 2. Fetch assignment to establish context
    SELECT * INTO v_assignment_rec
    FROM public.exam_assignments
    WHERE id = p_assignment_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_ASSIGNMENT_NOT_FOUND: Assignment % does not exist', p_assignment_id USING ERRCODE = 'P0002';
    END IF;

    -- 3. Concurrency & Attempt Control under Transaction Advisory Lock
    PERFORM pg_advisory_xact_lock(hashtext(p_assignment_id::text), hashtext(p_student_id::text));

    -- 4. Check if exact p_attempt_id was already created (Idempotent Replay Gate - before lifecycle & time gates)
    SELECT * INTO v_existing_attempt
    FROM public.exam_attempts
    WHERE id = p_attempt_id
    FOR UPDATE;

    IF FOUND THEN
        -- If p_attempt_id matches the exact assignment, student, and version, return stored record
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
            ELSIF v_existing_attempt.status = 'draft' THEN
                v_is_expired := (v_existing_attempt.expires_at IS NOT NULL AND v_now >= v_existing_attempt.expires_at);
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
                    'expired', v_is_expired,
                    'already_finalized', false
                );
            ELSE
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
        ELSE
            RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: Attempt ID % exists with conflicting payload or assignment', p_attempt_id USING ERRCODE = '23505';
        END IF;
    END IF;

    -- 5. Fetch immutable exam_version bound to this assignment (For non-replay paths)
    SELECT * INTO v_version_rec
    FROM public.exam_versions
    WHERE id = v_assignment_rec.exam_version_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_VERSION_NOT_FOUND: Version % does not exist', v_assignment_rec.exam_version_id USING ERRCODE = 'P0002';
    END IF;

    -- START ATTEMPT allows both 'published' and 'superseded' (Snapshot Immutability)
    IF v_version_rec.status NOT IN ('published', 'superseded') OR v_version_rec.published_at IS NULL THEN
        RAISE EXCEPTION 'ERR_VERSION_NOT_PUBLISHED: Cannot start attempt for non-published version (status: %)', v_version_rec.status USING ERRCODE = '22000';
    END IF;

    IF v_version_rec.total_points IS NULL OR v_version_rec.total_points <= 0.00 THEN
        RAISE EXCEPTION 'ERR_INVALID_TOTAL_POINTS: Exam total points must be > 0 (found: %)', v_version_rec.total_points USING ERRCODE = '22003';
    END IF;

    -- 6. Fetch parent exam container
    SELECT * INTO v_test_rec
    FROM public.exam_tests
    WHERE id = v_version_rec.exam_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_EXAM_NOT_FOUND: Exam container % does not exist', v_version_rec.exam_id USING ERRCODE = 'P0002';
    END IF;

    IF v_test_rec.status <> 'active' THEN
        RAISE EXCEPTION 'ERR_EXAM_ARCHIVED: Exam container is archived' USING ERRCODE = '22000';
    END IF;

    -- 7. Check if an existing draft attempt exists for this (assignment_id, student_id)
    SELECT * INTO v_active_draft
    FROM public.exam_attempts
    WHERE assignment_id = p_assignment_id
      AND student_id = p_student_id
      AND status = 'draft'
    FOR UPDATE;

    IF FOUND THEN
        -- Check if draft is expired
        IF v_active_draft.expires_at IS NOT NULL AND v_now >= v_active_draft.expires_at THEN
            RAISE EXCEPTION 'ERR_ATTEMPT_EXPIRED: An expired draft attempt already exists and must be finalized' USING ERRCODE = '22000';
        END IF;

        -- Resume existing active unexpired draft attempt with stored question_order, option_orders, and expires_at unchanged
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
    -- A. Starts at check
    IF v_version_rec.starts_at IS NOT NULL AND v_now < v_version_rec.starts_at THEN
        RAISE EXCEPTION 'ERR_EXAM_NOT_STARTED: Exam has not started yet (starts at %)', v_version_rec.starts_at USING ERRCODE = '22000';
    END IF;

    -- B. Calculate effective close (Null-safe earliest of version due_date and assignment due_date)
    IF v_version_rec.due_date IS NULL AND v_assignment_rec.due_date IS NULL THEN
        v_effective_close := NULL;
    ELSIF v_version_rec.due_date IS NOT NULL AND v_assignment_rec.due_date IS NULL THEN
        v_effective_close := v_version_rec.due_date;
    ELSIF v_version_rec.due_date IS NULL AND v_assignment_rec.due_date IS NOT NULL THEN
        v_effective_close := v_assignment_rec.due_date;
    ELSE
        v_effective_close := LEAST(v_version_rec.due_date, v_assignment_rec.due_date);
    END IF;

    -- C. Close check (No grace period)
    IF v_effective_close IS NOT NULL AND v_now >= v_effective_close THEN
        RAISE EXCEPTION 'ERR_EXAM_CLOSED: Exam due date has passed (closed at %)', v_effective_close USING ERRCODE = '22000';
    END IF;

    -- D. Calculate expires_at
    IF v_version_rec.duration_minutes IS NOT NULL THEN
        v_duration_deadline := v_now + (v_version_rec.duration_minutes || ' minutes')::INTERVAL;
    ELSE
        v_duration_deadline := NULL;
    END IF;

    IF v_duration_deadline IS NULL AND v_effective_close IS NULL THEN
        v_expires_at := NULL;
    ELSIF v_duration_deadline IS NOT NULL AND v_effective_close IS NULL THEN
        v_expires_at := v_duration_deadline;
    ELSIF v_duration_deadline IS NULL AND v_effective_close IS NOT NULL THEN
        v_expires_at := v_effective_close;
    ELSE
        v_expires_at := LEAST(v_duration_deadline, v_effective_close);
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

    -- 11. Generate Option Orders Snapshot (Option Shuffle Contract V1 Hardened)
    IF v_version_rec.shuffle_options THEN
        FOR v_q IN 
            SELECT id, question_type, options_json, question_number 
            FROM public.exam_questions 
            WHERE exam_version_id = v_assignment_rec.exam_version_id
            ORDER BY question_number ASC
        LOOP
            -- For single_choice / multiple_choice questions: require non-empty array with >= 2 options
            IF v_q.question_type IN ('single_choice', 'multiple_choice') THEN
                IF v_q.options_json IS NULL 
                   OR jsonb_typeof(v_q.options_json) <> 'array' 
                   OR jsonb_array_length(v_q.options_json) < 2 THEN
                    RAISE EXCEPTION 'ERR_INVALID_OPTION_SCHEMA: Question % (%) must have at least 2 options in options_json array', v_q.question_number, v_q.question_type USING ERRCODE = '22000';
                END IF;

                v_seen_keys := ARRAY[]::TEXT[];

                FOR v_opt IN SELECT * FROM jsonb_array_elements(v_q.options_json)
                LOOP
                    IF jsonb_typeof(v_opt.value) <> 'object' OR v_opt.value->>'key' IS NULL OR LENGTH(BTRIM(v_opt.value->>'key')) = 0 THEN
                        RAISE EXCEPTION 'ERR_INVALID_OPTION_SCHEMA: Question % option missing non-empty key', v_q.question_number USING ERRCODE = '22000';
                    END IF;

                    v_opt_key := BTRIM(v_opt.value->>'key');
                    IF v_opt_key = ANY(v_seen_keys) THEN
                        RAISE EXCEPTION 'ERR_INVALID_OPTION_SCHEMA: Question % duplicate option key %', v_q.question_number, v_opt_key USING ERRCODE = '22000';
                    END IF;

                    v_seen_keys := array_append(v_seen_keys, v_opt_key);
                END LOOP;

                -- Generate randomized permutation of keys for presentation order
                SELECT jsonb_agg(opt_key ORDER BY random())
                INTO v_shuffled_keys
                FROM unnest(v_seen_keys) AS opt_key;

                v_option_orders := jsonb_set(
                    v_option_orders, 
                    ARRAY[v_q.id::text], 
                    COALESCE(v_shuffled_keys, '[]'::jsonb), 
                    true
                );
            ELSIF v_q.options_json IS NOT NULL AND jsonb_typeof(v_q.options_json) = 'array' AND jsonb_array_length(v_q.options_json) > 0 THEN
                -- For other question types with options_json
                v_seen_keys := ARRAY[]::TEXT[];

                FOR v_opt IN SELECT * FROM jsonb_array_elements(v_q.options_json)
                LOOP
                    IF jsonb_typeof(v_opt.value) <> 'object' OR v_opt.value->>'key' IS NULL OR LENGTH(BTRIM(v_opt.value->>'key')) = 0 THEN
                        RAISE EXCEPTION 'ERR_INVALID_OPTION_SCHEMA: Question % option missing non-empty key', v_q.question_number USING ERRCODE = '22000';
                    END IF;

                    v_opt_key := BTRIM(v_opt.value->>'key');
                    IF v_opt_key = ANY(v_seen_keys) THEN
                        RAISE EXCEPTION 'ERR_INVALID_OPTION_SCHEMA: Question % duplicate option key %', v_q.question_number, v_opt_key USING ERRCODE = '22000';
                    END IF;

                    v_seen_keys := array_append(v_seen_keys, v_opt_key);
                END LOOP;

                SELECT jsonb_agg(opt_key ORDER BY random())
                INTO v_shuffled_keys
                FROM unnest(v_seen_keys) AS opt_key;

                v_option_orders := jsonb_set(
                    v_option_orders, 
                    ARRAY[v_q.id::text], 
                    COALESCE(v_shuffled_keys, '[]'::jsonb), 
                    true
                );
            END IF;
        END LOOP;
    ELSE
        v_option_orders := '{}'::jsonb;
    END IF;

    -- 12. Insert new draft attempt
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
        reward_stars_awarded,
        tab_switch_count,
        active_leave_episode_id,
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
        0,
        0,
        NULL,
        1
    );

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

-- Strict zero-trust ACL
REVOKE ALL ON FUNCTION public.rpc_exam_start_attempt(UUID, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_exam_start_attempt(UUID, UUID, UUID, UUID) TO service_role;

COMMIT;
