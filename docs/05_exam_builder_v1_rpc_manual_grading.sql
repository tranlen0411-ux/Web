-- ============================================================
-- TEST / EXAM BUILDER V1
-- PHASE 2C: TEACHER MANUAL GRADING RPC (HARDENING V4)
-- TARGET_PROJECT_REF: szptvqkoiphrhlionfoh
-- FORBIDDEN_CORE_REF: nddimmxpymipalpxlops
-- ============================================================
-- PURPOSE:
-- Implements Phase 2C teacher manual grading RPC:
-- 1. public.rpc_exam_grade_manual_attempt: Atomic teacher grading of manual questions
--    (essay, image_upload, file_upload) for pending_manual_grade attempts.
--
-- HARDENING V4 INVARIANTS:
-- - Manual answer rows MUST already exist in exam_attempt_answers (created at Phase 2B2 submit).
-- - Zero INSERT during manual grading — uses UPDATE only.
-- - Pre-mutation validation checks all snapshot manual rows are in 'pending_manual' state with NULL points.
-- - Authoritative snapshot manual set derived strictly from attempt.exam_version_id and attempt.question_order.
-- - Finalized replay verifies all snapshot manual rows exist, are in 'manual_graded' state, and validates exact set completeness without duplicates.
--
-- SECURITY & ISOLATION:
-- - SECURITY DEFINER function owned by postgres.
-- - SET search_path = public, app_private.
-- - EXECUTE revoked from PUBLIC, anon, authenticated.
-- - EXECUTE granted exclusively to service_role (invoked via Exam BFF Edge Function after CORE auth check).
-- - Zero access to or mutation of private AUTO answer keys.
-- ============================================================

BEGIN;

-- Conservative timeout protections
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ------------------------------------------------------------
-- 1. rpc_exam_grade_manual_attempt
-- ------------------------------------------------------------
-- Allows teacher/admin to grade manual questions of a submitted attempt in status 'pending_manual_grade'.
-- Preserves objective_score calculated by Phase 2B2 server-side auto-grader.
-- Computes manual_score = SUM(points_earned of manual questions in attempt snapshot).
-- Computes total_score = objective_score + manual_score.
-- Transitions attempt status from 'pending_manual_grade' to 'graded'.
-- Stores teacher_comment on individual answers and overall teacher_feedback on attempt.
-- Preserves original student_answer_json and file_url.
-- Idempotent finalized replay is supported if the payload logically matches stored manual grades and covers the exact question set without duplicates.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_exam_grade_manual_attempt(
    p_caller_id UUID,
    p_attempt_id UUID,
    p_manual_grades JSONB,
    p_teacher_feedback TEXT DEFAULT NULL,
    p_expected_version INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private
AS $$
DECLARE
    v_attempt_rec RECORD;
    v_snapshot_q_ids UUID[] := ARRAY[]::UUID[];
    v_snapshot_manual_q_ids UUID[] := ARRAY[]::UUID[];
    v_manual_count INT;
    v_manual_grades_count INT;
    v_processed_q_ids UUID[] := ARRAY[]::UUID[];
    v_replay_processed_q_ids UUID[] := ARRAY[]::UUID[];
    v_elem RECORD;
    v_q_id_text TEXT;
    v_q_id UUID;
    v_points_text TEXT;
    v_points NUMERIC(6, 2);
    v_comment TEXT;
    v_q_rec RECORD;
    v_manual_score NUMERIC(6, 2) := 0.00;
    v_total_score NUMERIC(6, 2) := 0.00;
    v_new_version INT;
    v_graded_at TIMESTAMPTZ;

    -- Replay / Validation verification variables
    v_stored_ans RECORD;
BEGIN
    -- 1. Required parameters validation
    IF p_caller_id IS NULL OR p_attempt_id IS NULL OR p_manual_grades IS NULL THEN
        RAISE EXCEPTION 'ERR_REQUIRED_PARAMS: caller_id, attempt_id, and manual_grades are required' USING ERRCODE = '22000';
    END IF;

    IF jsonb_typeof(p_manual_grades) <> 'array' THEN
        RAISE EXCEPTION 'ERR_INVALID_MANUAL_GRADES_PAYLOAD: manual_grades must be a JSON array' USING ERRCODE = '22000';
    END IF;

    -- 2. Lock target attempt FOR UPDATE (serializes concurrent grading / replay)
    SELECT * INTO v_attempt_rec
    FROM public.exam_attempts
    WHERE id = p_attempt_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_ATTEMPT_NOT_FOUND: Attempt % does not exist', p_attempt_id USING ERRCODE = 'P0002';
    END IF;

    -- 3. Construct Authoritative Question Snapshot from attempt.question_order
    IF v_attempt_rec.question_order IS NULL OR jsonb_typeof(v_attempt_rec.question_order) <> 'array' THEN
        RAISE EXCEPTION 'ERR_ATTEMPT_SNAPSHOT_INVALID: question_order is missing or not a JSON array on attempt %', p_attempt_id USING ERRCODE = '22000';
    END IF;

    BEGIN
        SELECT array_agg(q_elem::text::uuid)
        INTO v_snapshot_q_ids
        FROM jsonb_array_elements_text(v_attempt_rec.question_order) AS q_elem;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'ERR_ATTEMPT_SNAPSHOT_INVALID: Malformed UUID found in question_order on attempt %', p_attempt_id USING ERRCODE = '22000';
    END;

    IF v_snapshot_q_ids IS NULL THEN
        v_snapshot_q_ids := ARRAY[]::UUID[];
    END IF;

    -- Extract manual question IDs belonging to attempt.exam_version_id present in question_order snapshot
    SELECT array_agg(id)
    INTO v_snapshot_manual_q_ids
    FROM public.exam_questions
    WHERE exam_version_id = v_attempt_rec.exam_version_id
      AND id = ANY(v_snapshot_q_ids)
      AND question_type IN ('essay', 'image_upload', 'file_upload');

    IF v_snapshot_manual_q_ids IS NULL THEN
        v_snapshot_manual_q_ids := ARRAY[]::UUID[];
    END IF;

    v_manual_count := COALESCE(array_length(v_snapshot_manual_q_ids, 1), 0);

    -- 4. Idempotent Finalized Replay Gate
    IF v_attempt_rec.status = 'graded' THEN
        -- Verify that the authoritative attempt snapshot actually has manual questions
        IF v_manual_count = 0 THEN
            RAISE EXCEPTION 'ERR_NO_MANUAL_QUESTIONS: Attempt % belongs to all-auto exam with no manual questions and cannot be manually graded or replayed', p_attempt_id USING ERRCODE = '22000';
        END IF;

        -- Verify logical match of teacher_feedback
        IF p_teacher_feedback IS DISTINCT FROM v_attempt_rec.teacher_feedback THEN
            RAISE EXCEPTION 'ERR_ATTEMPT_ALREADY_GRADED: Attempt % has already been graded with different feedback', p_attempt_id USING ERRCODE = '22000';
        END IF;

        IF jsonb_array_length(p_manual_grades) <> v_manual_count THEN
            RAISE EXCEPTION 'ERR_ATTEMPT_ALREADY_GRADED: Attempt % has already been graded with different manual question count', p_attempt_id USING ERRCODE = '22000';
        END IF;

        -- Verify all snapshot manual rows exist and are in 'manual_graded' state
        FOREACH v_q_id IN ARRAY v_snapshot_manual_q_ids
        LOOP
            SELECT * INTO v_stored_ans
            FROM public.exam_attempt_answers
            WHERE attempt_id = v_attempt_rec.id
              AND exam_question_id = v_q_id;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'ERR_MANUAL_GRADING_STATE_INVALID: Attempt % is missing manual answer row for question %', p_attempt_id, v_q_id USING ERRCODE = '22000';
            END IF;

            IF v_stored_ans.grading_status <> 'manual_graded' THEN
                RAISE EXCEPTION 'ERR_MANUAL_GRADING_STATE_INVALID: Stored manual answer for question % is in state %, expected manual_graded', v_q_id, v_stored_ans.grading_status USING ERRCODE = '22000';
            END IF;
        END LOOP;

        -- Check every entry in p_manual_grades matches stored answer and covers exact distinct set
        FOR v_elem IN SELECT * FROM jsonb_array_elements(p_manual_grades)
        LOOP
            IF jsonb_typeof(v_elem.value) <> 'object' THEN
                RAISE EXCEPTION 'ERR_INVALID_MANUAL_GRADES_PAYLOAD: manual grade entries must be JSON objects' USING ERRCODE = '22000';
            END IF;

            -- Check strict keys in replay payload
            IF (SELECT count(*) FROM jsonb_object_keys(v_elem.value) AS k WHERE k NOT IN ('exam_question_id', 'points_earned', 'teacher_comment')) > 0 THEN
                RAISE EXCEPTION 'ERR_INVALID_MANUAL_GRADES_PAYLOAD: Unknown extra fields in manual grade entry' USING ERRCODE = '22000';
            END IF;

            v_q_id_text := v_elem.value->>'exam_question_id';
            IF v_q_id_text IS NULL THEN
                RAISE EXCEPTION 'ERR_INVALID_MANUAL_GRADES_PAYLOAD: exam_question_id is required' USING ERRCODE = '22000';
            END IF;

            BEGIN
                v_q_id := v_q_id_text::UUID;
            EXCEPTION WHEN OTHERS THEN
                RAISE EXCEPTION 'ERR_INVALID_UUID: Invalid UUID format for exam_question_id %', v_q_id_text USING ERRCODE = '22000';
            END;

            IF NOT (v_q_id = ANY(v_snapshot_manual_q_ids)) THEN
                RAISE EXCEPTION 'ERR_ATTEMPT_ALREADY_GRADED: Question % is not a manual question in attempt snapshot', v_q_id USING ERRCODE = '22000';
            END IF;

            -- Reject duplicate question in replay payload
            IF v_q_id = ANY(v_replay_processed_q_ids) THEN
                RAISE EXCEPTION 'ERR_DUPLICATE_MANUAL_GRADE: Duplicate grade entry for question % in replay payload', v_q_id USING ERRCODE = '22000';
            END IF;

            v_replay_processed_q_ids := array_append(v_replay_processed_q_ids, v_q_id);

            IF jsonb_typeof(v_elem.value->'points_earned') <> 'number' THEN
                RAISE EXCEPTION 'ERR_INVALID_MANUAL_POINTS: points_earned must be a JSON number' USING ERRCODE = '22000';
            END IF;

            v_points_text := v_elem.value->>'points_earned';
            IF v_points_text ~ '\.[0-9]{3,}$' THEN
                RAISE EXCEPTION 'ERR_INVALID_MANUAL_POINTS: points_earned % exceeds 2 decimal places for question %', v_points_text, v_q_id_text USING ERRCODE = '22000';
            END IF;

            BEGIN
                v_points := v_points_text::NUMERIC(6, 2);
            EXCEPTION WHEN OTHERS THEN
                RAISE EXCEPTION 'ERR_INVALID_MANUAL_POINTS: points_earned % is out of numeric range for question %', v_points_text, v_q_id_text USING ERRCODE = '22000';
            END;

            IF v_elem.value ? 'teacher_comment' AND (v_elem.value->'teacher_comment') IS NOT NULL AND jsonb_typeof(v_elem.value->'teacher_comment') <> 'null' THEN
                IF jsonb_typeof(v_elem.value->'teacher_comment') <> 'string' THEN
                    RAISE EXCEPTION 'ERR_INVALID_TEACHER_COMMENT: teacher_comment must be a string or null' USING ERRCODE = '22000';
                END IF;
                v_comment := v_elem.value->>'teacher_comment';
            ELSE
                v_comment := NULL;
            END IF;

            SELECT * INTO v_stored_ans
            FROM public.exam_attempt_answers
            WHERE attempt_id = v_attempt_rec.id
              AND exam_question_id = v_q_id;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'ERR_ATTEMPT_ALREADY_GRADED: Attempt % has already been graded with different questions', p_attempt_id USING ERRCODE = '22000';
            END IF;

            -- Check points equality numerically (e.g. 2.5 == 2.50) and comment equality NULL-safely
            IF v_stored_ans.points_earned <> v_points OR v_stored_ans.teacher_comment IS DISTINCT FROM v_comment THEN
                RAISE EXCEPTION 'ERR_ATTEMPT_ALREADY_GRADED: Attempt % has already been graded with different grades or comments', p_attempt_id USING ERRCODE = '22000';
            END IF;
        END LOOP;

        -- Ensure all snapshot manual questions were covered in replay payload
        IF array_length(v_replay_processed_q_ids, 1) <> v_manual_count THEN
            RAISE EXCEPTION 'ERR_ATTEMPT_ALREADY_GRADED: Replay payload does not cover all manual questions in attempt snapshot for attempt %', p_attempt_id USING ERRCODE = '22000';
        END IF;

        FOREACH v_q_id IN ARRAY v_snapshot_manual_q_ids
        LOOP
            IF NOT (v_q_id = ANY(v_replay_processed_q_ids)) THEN
                RAISE EXCEPTION 'ERR_ATTEMPT_ALREADY_GRADED: Replay payload is missing manual question % from attempt snapshot', v_q_id USING ERRCODE = '22000';
            END IF;
        END LOOP;

        -- Exact logical replay match: return stored immutable state (preserve original graded_by)
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
            'teacher_feedback', v_attempt_rec.teacher_feedback,
            'reward_stars_awarded', v_attempt_rec.reward_stars_awarded,
            'graded_at', v_attempt_rec.graded_at,
            'graded_by', v_attempt_rec.graded_by,
            'version', v_attempt_rec.version,
            'idempotent_replay', true
        );
    END IF;

    -- 5. Status invariant for new manual grading operation
    IF v_attempt_rec.status = 'draft' THEN
        RAISE EXCEPTION 'ERR_ATTEMPT_NOT_SUBMITTED: Cannot manually grade draft attempt %', p_attempt_id USING ERRCODE = '22000';
    END IF;

    IF v_attempt_rec.status <> 'pending_manual_grade' THEN
        RAISE EXCEPTION 'ERR_INVALID_ATTEMPT_STATUS: Cannot manually grade attempt in status %', v_attempt_rec.status USING ERRCODE = '22000';
    END IF;

    -- 6. Optimistic version check for new manual grading
    IF p_expected_version IS NULL OR v_attempt_rec.version <> p_expected_version THEN
        RAISE EXCEPTION 'ERR_OPTIMISTIC_LOCK_CONFLICT: Attempt version mismatch (expected %, current %)', p_expected_version, v_attempt_rec.version USING ERRCODE = 'P0004';
    END IF;

    -- 7. Invariant check on existing objective_score
    IF v_attempt_rec.objective_score IS NULL THEN
        RAISE EXCEPTION 'ERR_SCORE_INVARIANT: objective_score is NULL on submitted attempt %', p_attempt_id USING ERRCODE = '22000';
    END IF;

    -- 8. Fetch and validate manual questions in authoritative snapshot
    IF v_manual_count = 0 THEN
        RAISE EXCEPTION 'ERR_NO_MANUAL_QUESTIONS: Exam version % has no manual questions to grade in attempt snapshot', v_attempt_rec.exam_version_id USING ERRCODE = '22000';
    END IF;

    v_manual_grades_count := jsonb_array_length(p_manual_grades);

    IF v_manual_grades_count < v_manual_count THEN
        RAISE EXCEPTION 'ERR_MANUAL_GRADES_INCOMPLETE: Expected % manual question grades, received %', v_manual_count, v_manual_grades_count USING ERRCODE = '22000';
    END IF;

    IF v_manual_grades_count > v_manual_count THEN
        RAISE EXCEPTION 'ERR_MANUAL_GRADES_INCOMPLETE: Received % grades for % manual questions', v_manual_grades_count, v_manual_count USING ERRCODE = '22000';
    END IF;

    -- 9. Pre-mutation validation: Prove all snapshot manual rows exist and are in 'pending_manual' state
    FOREACH v_q_id IN ARRAY v_snapshot_manual_q_ids
    LOOP
        SELECT * INTO v_stored_ans
        FROM public.exam_attempt_answers
        WHERE attempt_id = p_attempt_id
          AND exam_question_id = v_q_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'ERR_MANUAL_ANSWER_ROW_MISSING: Missing answer row for manual question % on attempt %', v_q_id, p_attempt_id USING ERRCODE = '22000';
        END IF;

        IF v_stored_ans.exam_version_id <> v_attempt_rec.exam_version_id THEN
            RAISE EXCEPTION 'ERR_MANUAL_ANSWER_STATE: Answer row for question % has mismatched exam_version_id', v_q_id USING ERRCODE = '22000';
        END IF;

        IF v_stored_ans.grading_status <> 'pending_manual' THEN
            RAISE EXCEPTION 'ERR_MANUAL_ANSWER_STATE: Answer row for question % has invalid grading_status %, expected pending_manual', v_q_id, v_stored_ans.grading_status USING ERRCODE = '22000';
        END IF;

        IF v_stored_ans.points_earned IS NOT NULL OR v_stored_ans.is_correct IS NOT NULL THEN
            RAISE EXCEPTION 'ERR_MANUAL_ANSWER_STATE: Answer row for question % already has points_earned or is_correct populated', v_q_id USING ERRCODE = '22000';
        END IF;
    END LOOP;

    -- 10. Validate all manual grade entries in payload (Fail-Closed)
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_manual_grades)
    LOOP
        IF jsonb_typeof(v_elem.value) <> 'object' THEN
            RAISE EXCEPTION 'ERR_INVALID_MANUAL_GRADES_PAYLOAD: manual grade entries must be JSON objects' USING ERRCODE = '22000';
        END IF;

        -- Strict keys check: only exam_question_id, points_earned, and teacher_comment allowed
        IF (SELECT count(*) FROM jsonb_object_keys(v_elem.value) AS k WHERE k NOT IN ('exam_question_id', 'points_earned', 'teacher_comment')) > 0 THEN
            RAISE EXCEPTION 'ERR_INVALID_MANUAL_GRADES_PAYLOAD: Unknown extra fields in manual grade entry for question %', COALESCE(v_elem.value->>'exam_question_id', 'unknown') USING ERRCODE = '22000';
        END IF;

        IF NOT (v_elem.value ? 'exam_question_id' AND v_elem.value ? 'points_earned') THEN
            RAISE EXCEPTION 'ERR_INVALID_MANUAL_GRADES_PAYLOAD: exam_question_id and points_earned are required' USING ERRCODE = '22000';
        END IF;

        v_q_id_text := v_elem.value->>'exam_question_id';
        IF v_q_id_text IS NULL OR LENGTH(BTRIM(v_q_id_text)) = 0 THEN
            RAISE EXCEPTION 'ERR_INVALID_MANUAL_GRADES_PAYLOAD: exam_question_id is required' USING ERRCODE = '22000';
        END IF;

        BEGIN
            v_q_id := v_q_id_text::UUID;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'ERR_INVALID_UUID: Invalid UUID format for exam_question_id %', v_q_id_text USING ERRCODE = '22000';
        END;

        -- Check duplicate question IDs in payload
        IF v_q_id = ANY(v_processed_q_ids) THEN
            RAISE EXCEPTION 'ERR_DUPLICATE_MANUAL_GRADE: Duplicate grade entry for question %', v_q_id USING ERRCODE = '22000';
        END IF;

        -- Fetch and validate question snapshot
        SELECT * INTO v_q_rec
        FROM public.exam_questions
        WHERE id = v_q_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'ERR_QUESTION_NOT_FOUND: Question % does not exist', v_q_id USING ERRCODE = 'P0002';
        END IF;

        IF v_q_rec.exam_version_id <> v_attempt_rec.exam_version_id THEN
            RAISE EXCEPTION 'ERR_QUESTION_VERSION_MISMATCH: Question % belongs to version %, attempt belongs to %', v_q_id, v_q_rec.exam_version_id, v_attempt_rec.exam_version_id USING ERRCODE = '22000';
        END IF;

        -- Validate question exists in attempt snapshot manual question set
        IF NOT (v_q_id = ANY(v_snapshot_manual_q_ids)) THEN
            IF v_q_rec.question_type NOT IN ('essay', 'image_upload', 'file_upload') THEN
                RAISE EXCEPTION 'ERR_NOT_MANUAL_QUESTION: Question % is type %, only manual types can be manually graded', v_q_id, v_q_rec.question_type USING ERRCODE = '22000';
            ELSE
                RAISE EXCEPTION 'ERR_QUESTION_NOT_IN_SNAPSHOT: Question % is not in attempt question snapshot', v_q_id USING ERRCODE = '22000';
            END IF;
        END IF;

        -- Validate points_earned (must be JSON number, <= 2 decimal places, within numeric bounds)
        IF jsonb_typeof(v_elem.value->'points_earned') <> 'number' THEN
            RAISE EXCEPTION 'ERR_INVALID_MANUAL_POINTS: points_earned must be a JSON number for question %', v_q_id USING ERRCODE = '22000';
        END IF;

        v_points_text := v_elem.value->>'points_earned';
        IF v_points_text ~ '\.[0-9]{3,}$' THEN
            RAISE EXCEPTION 'ERR_INVALID_MANUAL_POINTS: points_earned % exceeds 2 decimal places for question %', v_points_text, v_q_id USING ERRCODE = '22000';
        END IF;

        BEGIN
            v_points := v_points_text::NUMERIC(6, 2);
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'ERR_INVALID_MANUAL_POINTS: points_earned % is out of numeric range for question %', v_points_text, v_q_id USING ERRCODE = '22000';
        END;

        IF v_points < 0.00 THEN
            RAISE EXCEPTION 'ERR_INVALID_MANUAL_POINTS: points_earned cannot be negative (% for question %)', v_points, v_q_id USING ERRCODE = '22000';
        END IF;

        IF v_points > v_q_rec.points THEN
            RAISE EXCEPTION 'ERR_INVALID_MANUAL_POINTS: points_earned % exceeds question max points % for question %', v_points, v_q_rec.points, v_q_id USING ERRCODE = '22000';
        END IF;

        -- Validate teacher_comment
        IF v_elem.value ? 'teacher_comment' AND (v_elem.value->'teacher_comment') IS NOT NULL AND jsonb_typeof(v_elem.value->'teacher_comment') <> 'null' THEN
            IF jsonb_typeof(v_elem.value->'teacher_comment') <> 'string' THEN
                RAISE EXCEPTION 'ERR_INVALID_TEACHER_COMMENT: teacher_comment must be a string or null for question %', v_q_id USING ERRCODE = '22000';
            END IF;
            v_comment := v_elem.value->>'teacher_comment';
        ELSE
            v_comment := NULL;
        END IF;

        v_processed_q_ids := array_append(v_processed_q_ids, v_q_id);
    END LOOP;

    -- Ensure all snapshot manual questions were covered
    IF array_length(v_processed_q_ids, 1) <> v_manual_count THEN
        RAISE EXCEPTION 'ERR_MANUAL_GRADES_INCOMPLETE: Expected % manual question grades, processed %', v_manual_count, COALESCE(array_length(v_processed_q_ids, 1), 0) USING ERRCODE = '22000';
    END IF;

    -- 11. Apply manual grades (UPDATE ONLY — NEVER INSERT)
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_manual_grades)
    LOOP
        v_q_id := (v_elem.value->>'exam_question_id')::UUID;
        v_points := (v_elem.value->>'points_earned')::NUMERIC(6, 2);

        IF v_elem.value ? 'teacher_comment' AND (v_elem.value->'teacher_comment') IS NOT NULL AND jsonb_typeof(v_elem.value->'teacher_comment') <> 'null' THEN
            v_comment := v_elem.value->>'teacher_comment';
        ELSE
            v_comment := NULL;
        END IF;

        UPDATE public.exam_attempt_answers
        SET points_earned = v_points,
            is_correct = NULL,
            grading_status = 'manual_graded',
            teacher_comment = v_comment,
            updated_at = clock_timestamp()
        WHERE attempt_id = p_attempt_id
          AND exam_question_id = v_q_id;
    END LOOP;

    -- 12. Compute scores strictly from snapshot manual questions
    SELECT COALESCE(SUM(points_earned), 0.00) INTO v_manual_score
    FROM public.exam_attempt_answers
    WHERE attempt_id = p_attempt_id
      AND exam_question_id = ANY(v_snapshot_manual_q_ids);

    v_total_score := v_attempt_rec.objective_score + v_manual_score;

    IF v_total_score > v_attempt_rec.max_score THEN
        RAISE EXCEPTION 'ERR_SCORE_INVARIANT: total_score % exceeds max_score % for attempt %', v_total_score, v_attempt_rec.max_score, p_attempt_id USING ERRCODE = '22000';
    END IF;

    -- 13. Finalize attempt transition to 'graded'
    UPDATE public.exam_attempts
    SET status = 'graded',
        manual_score = v_manual_score,
        total_score = v_total_score,
        teacher_feedback = p_teacher_feedback,
        graded_at = clock_timestamp(),
        graded_by = p_caller_id,
        version = version + 1,
        updated_at = clock_timestamp()
    WHERE id = p_attempt_id
    RETURNING version, graded_at INTO v_new_version, v_graded_at;

    -- 14. Return explicit response payload
    RETURN jsonb_build_object(
        'attempt_id', v_attempt_rec.id,
        'assignment_id', v_attempt_rec.assignment_id,
        'exam_version_id', v_attempt_rec.exam_version_id,
        'student_id', v_attempt_rec.student_id,
        'attempt_number', v_attempt_rec.attempt_number,
        'status', 'graded',
        'attempt_started_at', v_attempt_rec.attempt_started_at,
        'expires_at', v_attempt_rec.expires_at,
        'submitted_at', v_attempt_rec.submitted_at,
        'objective_score', v_attempt_rec.objective_score,
        'manual_score', v_manual_score,
        'total_score', v_total_score,
        'max_score', v_attempt_rec.max_score,
        'teacher_feedback', p_teacher_feedback,
        'reward_stars_awarded', v_attempt_rec.reward_stars_awarded,
        'graded_at', v_graded_at,
        'graded_by', p_caller_id,
        'version', v_new_version,
        'idempotent_replay', false
    );
END;
$$;

-- ------------------------------------------------------------
-- 2. SECURITY PRIVILEGES (FAIL-CLOSED)
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.rpc_exam_grade_manual_attempt(UUID, UUID, JSONB, TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_exam_grade_manual_attempt(UUID, UUID, JSONB, TEXT, INT) TO service_role;

COMMIT;
