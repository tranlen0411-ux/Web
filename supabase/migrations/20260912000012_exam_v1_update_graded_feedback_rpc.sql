-- supabase/migrations/20260912000012_exam_v1_update_graded_feedback_rpc.sql
-- ============================================================================
-- EXAM V1 PHASE B2 EXTENSION: Post-Grading Feedback Update RPC
-- Atomic Teacher/Admin Feedback Update for Graded Exam Attempts
-- Enforces Strict Score Immutability & Safe Feedback-Only Mutations
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_exam_update_graded_feedback(
    p_caller_id UUID,
    p_attempt_id UUID,
    p_teacher_feedback TEXT DEFAULT NULL,
    p_question_comments JSONB DEFAULT '[]'::jsonb,
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
    v_processed_q_ids UUID[] := ARRAY[]::UUID[];
    v_elem RECORD;
    v_q_id_text TEXT;
    v_q_id UUID;
    v_comment TEXT;
    v_stored_ans RECORD;
    v_new_version INT;
BEGIN
    -- 1. Required parameters validation
    IF p_caller_id IS NULL OR p_attempt_id IS NULL THEN
        RAISE EXCEPTION 'ERR_REQUIRED_PARAMS: caller_id and attempt_id are required' USING ERRCODE = '22000';
    END IF;

    IF p_expected_version IS NULL THEN
        RAISE EXCEPTION 'ERR_REQUIRED_PARAMS: expected_version is required' USING ERRCODE = '22000';
    END IF;

    IF p_question_comments IS NOT NULL AND jsonb_typeof(p_question_comments) <> 'array' THEN
        RAISE EXCEPTION 'ERR_INVALID_QUESTION_COMMENTS_PAYLOAD: question_comments must be a JSON array' USING ERRCODE = '22000';
    END IF;

    -- 2. Lock target attempt FOR UPDATE (serializes concurrent updates)
    SELECT * INTO v_attempt_rec
    FROM public.exam_attempts
    WHERE id = p_attempt_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_ATTEMPT_NOT_FOUND: Attempt % does not exist', p_attempt_id USING ERRCODE = 'P0002';
    END IF;

    -- 3. Require status = 'graded' (feedback-only mutation is exclusively allowed on finalized attempts)
    IF v_attempt_rec.status <> 'graded' THEN
        RAISE EXCEPTION 'ERR_INVALID_ATTEMPT_STATUS: Cannot update feedback for attempt in status %, expected graded', v_attempt_rec.status USING ERRCODE = '22000';
    END IF;

    -- 4. Optimistic locking check
    IF v_attempt_rec.version <> p_expected_version THEN
        RAISE EXCEPTION 'ERR_OPTIMISTIC_LOCK_CONFLICT: Attempt version mismatch (expected %, current %)', p_expected_version, v_attempt_rec.version USING ERRCODE = 'P0004';
    END IF;

    -- 5. Construct snapshot of questions
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

    -- 6. Validate & apply question comments
    IF p_question_comments IS NOT NULL AND jsonb_array_length(p_question_comments) > 0 THEN
        FOR v_elem IN SELECT * FROM jsonb_array_elements(p_question_comments)
        LOOP
            IF jsonb_typeof(v_elem.value) <> 'object' THEN
                RAISE EXCEPTION 'ERR_INVALID_QUESTION_COMMENTS_PAYLOAD: question comment entries must be JSON objects' USING ERRCODE = '22000';
            END IF;

            -- Reject unknown extra fields
            IF (SELECT count(*) FROM jsonb_object_keys(v_elem.value) AS k WHERE k NOT IN ('exam_question_id', 'teacher_comment')) > 0 THEN
                RAISE EXCEPTION 'ERR_INVALID_QUESTION_COMMENTS_PAYLOAD: Unknown extra fields in question comment entry' USING ERRCODE = '22000';
            END IF;

            v_q_id_text := v_elem.value->>'exam_question_id';
            IF v_q_id_text IS NULL THEN
                RAISE EXCEPTION 'ERR_INVALID_QUESTION_COMMENTS_PAYLOAD: exam_question_id is required' USING ERRCODE = '22000';
            END IF;

            BEGIN
                v_q_id := v_q_id_text::UUID;
            EXCEPTION WHEN OTHERS THEN
                RAISE EXCEPTION 'ERR_INVALID_UUID: Invalid UUID format for exam_question_id %', v_q_id_text USING ERRCODE = '22000';
            END;

            IF NOT (v_q_id = ANY(v_snapshot_manual_q_ids)) THEN
                RAISE EXCEPTION 'ERR_NOT_MANUAL_QUESTION: Question % is not a manual question in attempt snapshot', v_q_id USING ERRCODE = '22000';
            END IF;

            -- Reject duplicate question comments in payload
            IF v_q_id = ANY(v_processed_q_ids) THEN
                RAISE EXCEPTION 'ERR_DUPLICATE_QUESTION_COMMENT: Duplicate comment entry for question % in payload', v_q_id USING ERRCODE = '22000';
            END IF;

            v_processed_q_ids := array_append(v_processed_q_ids, v_q_id);

            IF v_elem.value ? 'teacher_comment' AND (v_elem.value->'teacher_comment') IS NOT NULL AND jsonb_typeof(v_elem.value->'teacher_comment') <> 'null' THEN
                IF jsonb_typeof(v_elem.value->'teacher_comment') <> 'string' THEN
                    RAISE EXCEPTION 'ERR_INVALID_TEACHER_COMMENT: teacher_comment must be a string or null' USING ERRCODE = '22000';
                END IF;
                v_comment := v_elem.value->>'teacher_comment';
            ELSE
                v_comment := NULL;
            END IF;

            -- Validate answer row exists
            SELECT * INTO v_stored_ans
            FROM public.exam_attempt_answers
            WHERE attempt_id = p_attempt_id
              AND exam_question_id = v_q_id;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'ERR_MANUAL_ANSWER_ROW_MISSING: Missing answer row for manual question % on attempt %', v_q_id, p_attempt_id USING ERRCODE = '22000';
            END IF;

            -- Update ONLY teacher_comment on answer row (Zero score / status mutation)
            UPDATE public.exam_attempt_answers
            SET teacher_comment = v_comment,
                updated_at = NOW()
            WHERE attempt_id = p_attempt_id
              AND exam_question_id = v_q_id;
        END LOOP;
    END IF;

    -- 7. Update attempt teacher_feedback and increment version exactly once
    v_new_version := v_attempt_rec.version + 1;

    UPDATE public.exam_attempts
    SET teacher_feedback = p_teacher_feedback,
        version = v_new_version,
        updated_at = NOW()
    WHERE id = p_attempt_id;

    -- 8. Return safe output
    RETURN jsonb_build_object(
        'attempt_id', v_attempt_rec.id,
        'status', v_attempt_rec.status,
        'teacher_feedback', p_teacher_feedback,
        'version', v_new_version
    );
END;
$$;

-- Security Hardening: Revoke default access and grant exclusively to service_role
REVOKE ALL ON FUNCTION public.rpc_exam_update_graded_feedback(UUID, UUID, TEXT, JSONB, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_exam_update_graded_feedback(UUID, UUID, TEXT, JSONB, INT) TO service_role;
