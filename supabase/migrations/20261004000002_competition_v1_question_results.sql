-- ============================================================
-- COMPETITION V1 QUESTION RESULTS & CLOSE QUESTION RPC (MIGRATION 10)
-- SCOPE: 
-- 1. Submit Deadline Hardening (clock_timestamp >= deadline)
-- 2. Host Close Question RPC (Idempotent, Server Authoritative)
-- 3. Host Sanitized Question Results & Distribution RPC
-- ============================================================

BEGIN;

-- Conservative timeout protections
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ------------------------------------------------------------
-- 1. HARDEN EXISTING: private.competition_submit_answer_internal
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.competition_submit_answer_internal(
    p_session_id UUID,
    p_question_id UUID,
    p_participant_id UUID DEFAULT NULL,
    p_guest_token TEXT DEFAULT NULL,
    p_selected_option_ids JSONB DEFAULT '[]'::jsonb,
    p_text_answer TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_guest_token_hash VARCHAR(64);
    v_participant RECORD;
    v_session RECORD;
    v_question RECORD;
    v_score RECORD;
    v_existing_answer_id UUID;
    v_answer_id UUID;
    v_derived_start TIMESTAMPTZ;
    v_time_limit_ms BIGINT;
    v_time_taken_ms BIGINT;
    v_is_correct BOOLEAN := false;
    v_points_awarded NUMERIC(6, 2) := 0.00;
    v_correct_increment INT := 0;
    v_diag_constraint TEXT;
    
    -- Option checking variables
    v_opt_val TEXT;
    v_opt_exists BOOLEAN;
    v_student_opt TEXT;
    v_correct_target TEXT;
    v_student_arr TEXT[];
    v_correct_arr TEXT[];
    v_norm_student_text TEXT;
    v_accepted_text TEXT;
BEGIN
    -- 1. Input Validation: IDs
    IF p_session_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_ID',
            'message', 'ID phòng thi không được để trống.'
        );
    END IF;

    IF p_question_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_QUESTION_ID',
            'message', 'ID câu hỏi không được để trống.'
        );
    END IF;

    -- 2. Stage 1: Identity Resolution (Authenticated vs Guest Read-Only Precheck)
    v_user_id := auth.uid();
    IF v_user_id IS NOT NULL THEN
        -- Check caller profile role: only students participate
        IF NOT EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = v_user_id AND role = 'student'
        ) THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'ROLE_NOT_ALLOWED',
                'message', 'Chỉ tài khoản học sinh mới được phép nộp câu trả lời.'
            );
        END IF;

        -- Resolve participant record read-only precheck
        SELECT id, session_id, user_id, is_guest, status
        INTO v_participant
        FROM public.competition_participants
        WHERE session_id = p_session_id
          AND user_id = v_user_id
          AND is_guest = false;

        IF v_participant.id IS NULL THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'PARTICIPANT_NOT_FOUND',
                'message', 'Không tìm thấy thông tin thí sinh trong phòng thi này.'
            );
        END IF;
    ELSE
        -- Guest caller validation
        IF p_participant_id IS NULL OR p_guest_token IS NULL OR pg_catalog.length(pg_catalog.btrim(p_guest_token)) < 32 THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'INVALID_GUEST_CREDENTIALS',
                'message', 'Thiếu thông tin xác thực khách hoặc token không đủ độ dài hợp lệ (yêu cầu tối thiểu 32 ký tự).'
            );
        END IF;

        v_guest_token_hash := pg_catalog.encode(
            extensions.digest(pg_catalog.convert_to(pg_catalog.btrim(p_guest_token), 'UTF8'), 'sha256'),
            'hex'
        );

        SELECT id, session_id, user_id, is_guest, status
        INTO v_participant
        FROM public.competition_participants
        WHERE id = p_participant_id
          AND session_id = p_session_id
          AND is_guest = true
          AND guest_token_hash = v_guest_token_hash;

        IF v_participant.id IS NULL THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'INVALID_GUEST_CREDENTIALS',
                'message', 'Thông tin xác thực khách không hợp lệ cho phòng thi này.'
            );
        END IF;
    END IF;

    IF v_participant.status = 'kicked' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'PARTICIPANT_KICKED',
            'message', 'Bạn đã bị xóa khỏi phòng thi này.'
        );
    END IF;

    -- 3. Stage 2: Deterministic Locking Hierarchy (sessions -> participants -> scores -> answers)
    -- Step A: Lock Session Row FOR UPDATE (Serializes pause, question transition, finish)
    SELECT id, room_code, status, current_question_index, current_question_id, question_deadline, paused_remaining_ms
    INTO v_session
    FROM public.competition_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF v_session.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_NOT_FOUND',
            'message', 'Phòng thi không tồn tại.'
        );
    END IF;

    -- Validate Session State
    IF v_session.status = 'waiting' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_NOT_IN_PROGRESS',
            'message', 'Phòng thi chưa bắt đầu.'
        );
    ELSIF v_session.status = 'paused' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_PAUSED',
            'message', 'Phòng thi đang tạm dừng.'
        );
    ELSIF v_session.status IN ('finished', 'cancelled') THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_CLOSED',
            'message', 'Phòng thi đã kết thúc hoặc đã bị hủy.'
        );
    ELSIF v_session.status <> 'in_progress' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_NOT_IN_PROGRESS',
            'message', 'Trạng thái phòng thi không hợp lệ để nộp bài.'
        );
    END IF;

    -- Validate Active Question
    IF v_session.current_question_id IS DISTINCT FROM p_question_id THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'QUESTION_NOT_ACTIVE',
            'message', 'Câu hỏi này không phải là câu hỏi đang diễn ra.'
        );
    END IF;

    -- Validate Server Deadline (Hardened with clock_timestamp >= question_deadline)
    IF v_session.question_deadline IS NULL OR pg_catalog.clock_timestamp() >= v_session.question_deadline THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'ANSWER_TOO_LATE',
            'message', 'Đã hết thời gian trả lời cho câu hỏi này.'
        );
    END IF;

    -- Step B: Load Question with Composite FK (session_id, id)
    SELECT id, session_id, question_order, question_text, question_type, options, correct_answer, points, time_limit_seconds
    INTO v_question
    FROM public.competition_questions
    WHERE session_id = p_session_id AND id = p_question_id;

    IF v_question.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'QUESTION_NOT_FOUND',
            'message', 'Không tìm thấy câu hỏi trong phòng thi này.'
        );
    END IF;

    -- Step C: Lock Participant Row FOR UPDATE & Re-check Identity on Locked Row
    SELECT id, session_id, user_id, guest_token_hash, is_guest, status
    INTO v_participant
    FROM public.competition_participants
    WHERE id = v_participant.id AND session_id = p_session_id
    FOR UPDATE;

    IF v_participant.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'PARTICIPANT_NOT_FOUND',
            'message', 'Không tìm thấy thông tin thí sinh trong phòng thi này.'
        );
    END IF;

    -- Strict identity verification under lock
    IF v_user_id IS NOT NULL THEN
        IF v_participant.user_id IS DISTINCT FROM v_user_id OR v_participant.is_guest IS TRUE THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'PARTICIPANT_NOT_FOUND',
                'message', 'Thông tin thí sinh không khớp với phiên đăng nhập.'
            );
        END IF;
    ELSE
        IF v_participant.guest_token_hash IS DISTINCT FROM v_guest_token_hash OR v_participant.is_guest IS FALSE THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'INVALID_GUEST_CREDENTIALS',
                'message', 'Xác thực khách thất bại dưới khóa hàng.'
            );
        END IF;
    END IF;

    IF v_participant.status = 'kicked' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'PARTICIPANT_KICKED',
            'message', 'Bạn đã bị xóa khỏi phòng thi này.'
        );
    END IF;

    -- Step D: Lock Score Row FOR UPDATE (Serializes duplicate submissions from same participant, fail-closed)
    SELECT id, session_id, participant_id, total_score, correct_count, total_response_time_ms, rank
    INTO v_score
    FROM public.competition_scores
    WHERE session_id = v_session.id AND participant_id = v_participant.id
    FOR UPDATE;

    IF v_score.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SCORE_RECORD_MISSING',
            'message', 'Không tìm thấy bản ghi điểm của thí sinh trong phòng thi này.'
        );
    END IF;

    -- Step E: Check Duplicate Answer under Score Lock (First Write Wins)
    SELECT id INTO v_existing_answer_id
    FROM public.competition_answers
    WHERE session_id = p_session_id
      AND question_id = p_question_id
      AND participant_id = v_participant.id;

    IF v_existing_answer_id IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'ALREADY_ANSWERED',
            'message', 'Bạn đã nộp câu trả lời cho câu hỏi này.'
        );
    END IF;

    -- 4. Server-Authoritative Time Calculation
    v_time_limit_ms := (v_question.time_limit_seconds * 1000)::BIGINT;
    v_derived_start := v_session.question_deadline - (v_question.time_limit_seconds * interval '1 second');
    v_time_taken_ms := GREATEST(0::BIGINT, LEAST(v_time_limit_ms, pg_catalog.round(EXTRACT(EPOCH FROM (pg_catalog.now() - v_derived_start)) * 1000)::BIGINT));

    -- 5. Payload Validation & Server-Side Correctness Calculation (Canonical Format Enforcement)
    CASE v_question.question_type
        WHEN 'single_choice', 'true_false' THEN
            -- Fail-closed on missing/malformed options data
            IF v_question.options IS NULL 
               OR pg_catalog.jsonb_typeof(v_question.options) <> 'array'
               OR pg_catalog.jsonb_array_length(v_question.options) = 0 THEN
                RETURN pg_catalog.jsonb_build_object(
                    'success', false,
                    'error_code', 'MALFORMED_QUESTION_SNAPSHOT',
                    'message', 'Cấu hình danh sách lựa chọn của câu hỏi không hợp lệ.'
                );
            END IF;

            -- Validate canonical correct_answer shape: {"option_id": "..."}
            IF v_question.correct_answer IS NULL 
               OR pg_catalog.jsonb_typeof(v_question.correct_answer) <> 'object'
               OR NOT (v_question.correct_answer ? 'option_id')
               OR v_question.correct_answer->>'option_id' IS NULL
               OR pg_catalog.btrim(v_question.correct_answer->>'option_id') = '' THEN
                RETURN pg_catalog.jsonb_build_object(
                    'success', false,
                    'error_code', 'MALFORMED_QUESTION_SNAPSHOT',
                    'message', 'Cấu hình đáp án đúng của câu hỏi không hợp lệ theo chuẩn canonical.'
                );
            END IF;

            v_correct_target := v_question.correct_answer->>'option_id';

            -- Validate that selected_option_ids is JSON array with exactly 1 element
            IF p_selected_option_ids IS NULL 
               OR pg_catalog.jsonb_typeof(p_selected_option_ids) <> 'array'
               OR pg_catalog.jsonb_array_length(p_selected_option_ids) <> 1 THEN
                RETURN pg_catalog.jsonb_build_object(
                    'success', false,
                    'error_code', 'INVALID_ANSWER_PAYLOAD',
                    'message', 'Câu hỏi một lựa chọn yêu cầu chọn chính xác 1 đáp án.'
                );
            END IF;

            v_student_opt := p_selected_option_ids #>> '{0}';
            IF v_student_opt IS NULL OR pg_catalog.btrim(v_student_opt) = '' THEN
                RETURN pg_catalog.jsonb_build_object(
                    'success', false,
                    'error_code', 'INVALID_ANSWER_PAYLOAD',
                    'message', 'Đáp án chọn không được để trống.'
                );
            END IF;

            -- Validate option exists in question options (canonical option object with "id")
            SELECT EXISTS (
                SELECT 1 FROM pg_catalog.jsonb_array_elements(v_question.options) opt
                WHERE pg_catalog.jsonb_typeof(opt) = 'object' AND opt->>'id' = v_student_opt
            ) INTO v_opt_exists;

            IF NOT v_opt_exists THEN
                RETURN pg_catalog.jsonb_build_object(
                    'success', false,
                    'error_code', 'INVALID_OPTION_SELECTED',
                    'message', 'Đáp án được chọn không tồn tại trong danh sách lựa chọn của câu hỏi.'
                );
            END IF;

            -- Evaluate correctness
            IF v_student_opt = v_correct_target THEN
                v_is_correct := true;
            END IF;

        WHEN 'multiple_choice' THEN
            -- Fail-closed on missing/malformed options data
            IF v_question.options IS NULL 
               OR pg_catalog.jsonb_typeof(v_question.options) <> 'array'
               OR pg_catalog.jsonb_array_length(v_question.options) = 0 THEN
                RETURN pg_catalog.jsonb_build_object(
                    'success', false,
                    'error_code', 'MALFORMED_QUESTION_SNAPSHOT',
                    'message', 'Cấu hình danh sách lựa chọn của câu hỏi không hợp lệ.'
                );
            END IF;

            -- Validate canonical correct_answer shape: {"option_ids": ["...", "..."]}
            IF v_question.correct_answer IS NULL 
               OR pg_catalog.jsonb_typeof(v_question.correct_answer) <> 'object'
               OR NOT (v_question.correct_answer ? 'option_ids')
               OR pg_catalog.jsonb_typeof(v_question.correct_answer->'option_ids') <> 'array'
               OR pg_catalog.jsonb_array_length(v_question.correct_answer->'option_ids') = 0 THEN
                RETURN pg_catalog.jsonb_build_object(
                    'success', false,
                    'error_code', 'MALFORMED_QUESTION_SNAPSHOT',
                    'message', 'Cấu hình danh sách đáp án đúng của câu hỏi không hợp lệ theo chuẩn canonical.'
                );
            END IF;

            -- Validate that selected_option_ids is JSON array with >= 1 element
            IF p_selected_option_ids IS NULL 
               OR pg_catalog.jsonb_typeof(p_selected_option_ids) <> 'array'
               OR pg_catalog.jsonb_array_length(p_selected_option_ids) < 1 THEN
                RETURN pg_catalog.jsonb_build_object(
                    'success', false,
                    'error_code', 'INVALID_ANSWER_PAYLOAD',
                    'message', 'Câu hỏi nhiều lựa chọn yêu cầu chọn ít nhất 1 đáp án.'
                );
            END IF;

            -- Check each selected option exists in question options (canonical option object with "id")
            FOR v_opt_val IN SELECT * FROM pg_catalog.jsonb_array_elements_text(p_selected_option_ids)
            LOOP
                SELECT EXISTS (
                    SELECT 1 FROM pg_catalog.jsonb_array_elements(v_question.options) opt
                    WHERE pg_catalog.jsonb_typeof(opt) = 'object' AND opt->>'id' = v_opt_val
                ) INTO v_opt_exists;

                IF NOT v_opt_exists THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'INVALID_OPTION_SELECTED',
                        'message', 'Một trong các đáp án được chọn không tồn tại trong danh sách lựa chọn.'
                    );
                END IF;
            END LOOP;

            -- Evaluate set equality (canonical sorted unique array comparison)
            SELECT COALESCE(pg_catalog.array_agg(DISTINCT elem ORDER BY elem), ARRAY[]::TEXT[])
            INTO v_student_arr
            FROM pg_catalog.jsonb_array_elements_text(p_selected_option_ids) AS elem;

            SELECT COALESCE(pg_catalog.array_agg(DISTINCT elem ORDER BY elem), ARRAY[]::TEXT[])
            INTO v_correct_arr
            FROM pg_catalog.jsonb_array_elements_text(v_question.correct_answer->'option_ids') AS elem;

            IF v_student_arr = v_correct_arr AND pg_catalog.cardinality(v_student_arr) = pg_catalog.cardinality(v_correct_arr) THEN
                v_is_correct := true;
            END IF;

        WHEN 'short_answer' THEN
            -- Validate canonical correct_answer shape: {"accepted_answers": ["...", "..."]}
            IF v_question.correct_answer IS NULL 
               OR pg_catalog.jsonb_typeof(v_question.correct_answer) <> 'object'
               OR NOT (v_question.correct_answer ? 'accepted_answers')
               OR pg_catalog.jsonb_typeof(v_question.correct_answer->'accepted_answers') <> 'array'
               OR pg_catalog.jsonb_array_length(v_question.correct_answer->'accepted_answers') = 0 THEN
                RETURN pg_catalog.jsonb_build_object(
                    'success', false,
                    'error_code', 'MALFORMED_QUESTION_SNAPSHOT',
                    'message', 'Cấu hình đáp án đúng của câu hỏi không hợp lệ theo chuẩn canonical.'
                );
            END IF;

            v_norm_student_text := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_text_answer, '')));
            IF v_norm_student_text <> '' THEN
                FOR v_accepted_text IN SELECT * FROM pg_catalog.jsonb_array_elements_text(v_question.correct_answer->'accepted_answers')
                LOOP
                    IF v_norm_student_text = pg_catalog.lower(pg_catalog.btrim(v_accepted_text)) THEN
                        v_is_correct := true;
                        EXIT;
                    END IF;
                END LOOP;
            END IF;

        ELSE
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'UNSUPPORTED_QUESTION_TYPE',
                'message', 'Loại câu hỏi không được hỗ trợ.'
            );
    END CASE;

    -- 6. Server-Side Score Calculation
    IF v_is_correct THEN
        v_points_awarded := v_question.points;
        v_correct_increment := 1;
    ELSE
        v_points_awarded := 0.00;
        v_correct_increment := 0;
    END IF;

    -- 7. Step F: Insert Answer Record (with defense-in-depth unique_violation mapping)
    BEGIN
        INSERT INTO public.competition_answers (
            session_id,
            question_id,
            participant_id,
            selected_option_ids,
            text_answer,
            is_correct,
            points_awarded,
            time_taken_ms,
            submitted_at,
            created_at
        ) VALUES (
            v_session.id,
            v_question.id,
            v_participant.id,
            COALESCE(p_selected_option_ids, '[]'::jsonb),
            p_text_answer,
            v_is_correct,
            v_points_awarded,
            v_time_taken_ms,
            pg_catalog.now(),
            pg_catalog.now()
        ) RETURNING id INTO v_answer_id;
    EXCEPTION
        WHEN unique_violation THEN
            GET STACKED DIAGNOSTICS v_diag_constraint = CONSTRAINT_NAME;
            IF v_diag_constraint = 'unique_competition_answer_attempt' THEN
                RETURN pg_catalog.jsonb_build_object(
                    'success', false,
                    'error_code', 'ALREADY_ANSWERED',
                    'message', 'Bạn đã nộp câu trả lời cho câu hỏi này.'
                );
            ELSE
                RAISE;
            END IF;
    END;

    -- 8. Step G: Update Competition Score Row
    UPDATE public.competition_scores
    SET total_score = total_score + v_points_awarded,
        correct_count = correct_count + v_correct_increment,
        total_response_time_ms = total_response_time_ms + v_time_taken_ms,
        updated_at = pg_catalog.now()
    WHERE id = v_score.id
    RETURNING id, session_id, participant_id, total_score, correct_count, total_response_time_ms, rank
    INTO v_score;

    -- Update participant presence
    UPDATE public.competition_participants
    SET last_seen_at = pg_catalog.now(),
        status = CASE WHEN status = 'disconnected' THEN 'active' ELSE status END
    WHERE id = v_participant.id;

    -- 9. Return Structured Success Response
    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'answer_id', v_answer_id,
        'is_correct', v_is_correct,
        'points_awarded', v_points_awarded,
        'time_taken_ms', v_time_taken_ms,
        'total_score', v_score.total_score,
        'correct_count', v_score.correct_count,
        'total_response_time_ms', v_score.total_response_time_ms
    );
END;
$$;


-- ------------------------------------------------------------
-- 2. PRIVATE HELPER: competition_host_close_question_internal
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.competition_host_close_question_internal(
    p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_session RECORD;
    v_is_authorized BOOLEAN := false;
    v_close_time TIMESTAMPTZ;
BEGIN
    -- 1. Input Validation
    IF p_session_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_ID',
            'message', 'ID phòng thi không được để trống.'
        );
    END IF;

    -- 2. Authorization Check: Require Authenticated Identity
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'UNAUTHORIZED_ACCESS',
            'message', 'Yêu cầu đăng nhập để thực hiện thao tác này.'
        );
    END IF;

    -- 3. Load and Lock Session Row
    SELECT id, host_id, status, current_question_index, current_question_id, question_deadline
    INTO v_session
    FROM public.competition_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF v_session.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_NOT_FOUND',
            'message', 'Phòng thi không tồn tại.'
        );
    END IF;

    -- 4. Check Authorization: Host or Admin
    IF v_session.host_id = v_caller_id THEN
        v_is_authorized := true;
    ELSE
        SELECT role INTO v_caller_role
        FROM public.profiles
        WHERE id = v_caller_id;

        IF v_caller_role = 'admin' THEN
            v_is_authorized := true;
        END IF;
    END IF;

    IF NOT v_is_authorized THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'UNAUTHORIZED_ACCESS',
            'message', 'Bạn không có quyền đóng câu hỏi trong phòng thi này.'
        );
    END IF;

    -- 5. Validate State: in_progress only
    IF v_session.status <> 'in_progress' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_NOT_IN_PROGRESS',
            'message', 'Phòng thi không ở trạng thái thi đấu.'
        );
    END IF;

    -- 6. Validate Active Question
    IF v_session.current_question_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'QUESTION_NOT_ACTIVE',
            'message', 'Không có câu hỏi đang diễn ra.'
        );
    END IF;

    -- 7. Idempotent check: If already closed
    IF v_session.question_deadline IS NOT NULL AND pg_catalog.clock_timestamp() >= v_session.question_deadline THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'session_id', v_session.id,
            'session_status', v_session.status,
            'question_id', v_session.current_question_id,
            'question_index', v_session.current_question_index,
            'question_closed', true,
            'closed_at', v_session.question_deadline
        );
    END IF;

    -- 8. Close the active question
    v_close_time := pg_catalog.clock_timestamp();

    UPDATE public.competition_sessions
    SET question_deadline = v_close_time,
        paused_remaining_ms = NULL,
        updated_at = v_close_time
    WHERE id = v_session.id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'session_id', v_session.id,
        'session_status', v_session.status,
        'question_id', v_session.current_question_id,
        'question_index', v_session.current_question_index,
        'question_closed', true,
        'closed_at', v_close_time
    );
END;
$$;


-- ------------------------------------------------------------
-- 3. PUBLIC SECURITY INVOKER WRAPPER: competition_host_close_question
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.competition_host_close_question(
    p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RETURN private.competition_host_close_question_internal(
        p_session_id
    );
END;
$$;


-- ------------------------------------------------------------
-- 4. PRIVATE HELPER: competition_host_get_question_results_internal
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.competition_host_get_question_results_internal(
    p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_session RECORD;
    v_question RECORD;
    v_is_authorized BOOLEAN := false;
    v_total_eligible INT := 0;
    v_submitted_count INT := 0;
    v_unanswered_count INT := 0;
    v_correct_count INT := 0;
    v_incorrect_count INT := 0;
    v_correct_percentage NUMERIC(5, 1) := 0.0;
    v_distribution JSONB := '[]'::jsonb;
BEGIN
    -- 1. Input Validation
    IF p_session_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_ID',
            'message', 'ID phòng thi không được để trống.'
        );
    END IF;

    -- 2. Authorization Check: Require Authenticated Identity
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'UNAUTHORIZED_ACCESS',
            'message', 'Yêu cầu đăng nhập để xem kết quả câu hỏi.'
        );
    END IF;

    -- 3. Load Session Record
    SELECT id, host_id, status, current_question_index, current_question_id, question_deadline
    INTO v_session
    FROM public.competition_sessions
    WHERE id = p_session_id;

    IF v_session.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_NOT_FOUND',
            'message', 'Phòng thi không tồn tại.'
        );
    END IF;

    -- 4. Check Ownership or Admin Role from public.profiles
    IF v_session.host_id = v_caller_id THEN
        v_is_authorized := true;
    ELSE
        SELECT role INTO v_caller_role
        FROM public.profiles
        WHERE id = v_caller_id;

        IF v_caller_role = 'admin' THEN
            v_is_authorized := true;
        END IF;
    END IF;

    IF NOT v_is_authorized THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'UNAUTHORIZED_ACCESS',
            'message', 'Bạn không có quyền xem kết quả câu hỏi của phòng thi này.'
        );
    END IF;

    -- 5. Result Reveal Gate
    IF v_session.status <> 'in_progress' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'QUESTION_STILL_ACTIVE',
            'message', 'Phòng thi không ở trạng thái thi đấu hoặc đang tạm dừng.'
        );
    END IF;

    IF v_session.current_question_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'QUESTION_NOT_ACTIVE',
            'message', 'Không có câu hỏi đang diễn ra.'
        );
    END IF;

    IF v_session.question_deadline IS NULL OR pg_catalog.clock_timestamp() < v_session.question_deadline THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'QUESTION_STILL_ACTIVE',
            'message', 'Câu hỏi vẫn đang diễn ra, chưa đến thời điểm mở kết quả.'
        );
    END IF;

    -- 6. Load Current Question Snapshot
    SELECT id, session_id, question_order, question_type, question_text, options, correct_answer, points
    INTO v_question
    FROM public.competition_questions
    WHERE session_id = p_session_id
      AND id = v_session.current_question_id;

    IF v_question.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'QUESTION_NOT_FOUND',
            'message', 'Không tìm thấy thông tin câu hỏi hiện tại.'
        );
    END IF;

    -- 7. Count Eligible Population & Answer Aggregates (Strictly consistent filter)
    SELECT pg_catalog.count(*)::INT
    INTO v_total_eligible
    FROM public.competition_participants
    WHERE session_id = p_session_id
      AND status <> 'kicked'
      AND joined_at <= v_session.question_deadline;

    SELECT
        pg_catalog.count(a.id)::INT,
        pg_catalog.count(a.id) FILTER (WHERE a.is_correct = true)::INT,
        pg_catalog.count(a.id) FILTER (WHERE a.is_correct = false)::INT
    INTO
        v_submitted_count,
        v_correct_count,
        v_incorrect_count
    FROM public.competition_answers a
    INNER JOIN public.competition_participants p
        ON p.id = a.participant_id
       AND p.session_id = p_session_id
       AND p.status <> 'kicked'
       AND p.joined_at <= v_session.question_deadline
    WHERE a.session_id = p_session_id
      AND a.question_id = v_session.current_question_id;

    v_unanswered_count := GREATEST(v_total_eligible - v_submitted_count, 0);

    IF v_submitted_count > 0 THEN
        v_correct_percentage := pg_catalog.round((v_correct_count::NUMERIC * 100.0) / v_submitted_count::NUMERIC, 1);
    ELSE
        v_correct_percentage := 0.0;
    END IF;

    -- 8. Compute Distribution
    IF v_question.question_type IN ('single_choice', 'true_false', 'multiple_choice') THEN
        IF v_question.options IS NOT NULL AND pg_catalog.jsonb_typeof(v_question.options) = 'array' AND pg_catalog.jsonb_array_length(v_question.options) > 0 THEN
            WITH opt_rows AS (
                SELECT
                    opt->>'id' AS option_id,
                    opt->>'text' AS option_text,
                    opt_ordinality
                FROM pg_catalog.jsonb_array_elements(v_question.options) WITH ORDINALITY AS t(opt, opt_ordinality)
            ),
            opt_counts AS (
                SELECT
                    o.option_id,
                    o.option_text,
                    o.opt_ordinality,
                    pg_catalog.count(a.id)::INT AS selection_count,
                    CASE
                        WHEN v_question.question_type = 'multiple_choice' THEN
                            (v_question.correct_answer->'option_ids' @> pg_catalog.jsonb_build_array(o.option_id))
                        ELSE
                            (v_question.correct_answer->>'option_id' = o.option_id)
                    END AS is_correct_option
                FROM opt_rows o
                LEFT JOIN (
                    SELECT a.id, a.selected_option_ids
                    FROM public.competition_answers a
                    INNER JOIN public.competition_participants p
                        ON p.id = a.participant_id
                       AND p.session_id = p_session_id
                       AND p.status <> 'kicked'
                       AND p.joined_at <= v_session.question_deadline
                    WHERE a.session_id = p_session_id
                      AND a.question_id = v_session.current_question_id
                ) a ON a.selected_option_ids @> pg_catalog.jsonb_build_array(o.option_id)
                GROUP BY o.option_id, o.option_text, o.opt_ordinality
            )
            SELECT COALESCE(
                pg_catalog.jsonb_agg(
                    pg_catalog.jsonb_build_object(
                        'option_id', option_id,
                        'option_text', option_text,
                        'selection_count', selection_count,
                        'selection_percentage', CASE
                            WHEN v_submitted_count > 0 THEN
                                pg_catalog.round((selection_count::NUMERIC * 100.0) / v_submitted_count::NUMERIC, 1)
                            ELSE 0.0
                        END,
                        'is_correct_option', is_correct_option
                    )
                    ORDER BY opt_ordinality ASC
                ),
                '[]'::jsonb
            )
            INTO v_distribution
            FROM opt_counts;
        ELSE
            v_distribution := '[]'::jsonb;
        END IF;
    ELSE
        -- short_answer or unsupported: empty distribution
        v_distribution := '[]'::jsonb;
    END IF;

    -- 9. Return Sanitized Result Shape
    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'session_id', v_session.id,
        'session_status', v_session.status,
        'question_closed', true,
        'question_id', v_question.id,
        'question_order', v_question.question_order,
        'question_type', v_question.question_type,
        'question_text', v_question.question_text,
        'points', v_question.points,
        'total_eligible', v_total_eligible,
        'submitted_count', v_submitted_count,
        'unanswered_count', v_unanswered_count,
        'correct_count', v_correct_count,
        'incorrect_count', v_incorrect_count,
        'correct_percentage', v_correct_percentage,
        'distribution', v_distribution
    );
END;
$$;


-- ------------------------------------------------------------
-- 5. PUBLIC SECURITY INVOKER WRAPPER: competition_host_get_question_results
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.competition_host_get_question_results(
    p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RETURN private.competition_host_get_question_results_internal(
        p_session_id
    );
END;
$$;


-- ------------------------------------------------------------
-- 6. PERMISSIONS & ROLE GRANTS
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION private.competition_submit_answer_internal(UUID, UUID, UUID, TEXT, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.competition_submit_answer_internal(UUID, UUID, UUID, TEXT, JSONB, TEXT) TO authenticated, anon;

REVOKE EXECUTE ON FUNCTION private.competition_host_close_question_internal(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.competition_host_close_question_internal(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION private.competition_host_close_question_internal(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.competition_host_close_question(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.competition_host_close_question(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.competition_host_close_question(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION private.competition_host_get_question_results_internal(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.competition_host_get_question_results_internal(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION private.competition_host_get_question_results_internal(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.competition_host_get_question_results(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.competition_host_get_question_results(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.competition_host_get_question_results(UUID) TO authenticated;

COMMIT;
