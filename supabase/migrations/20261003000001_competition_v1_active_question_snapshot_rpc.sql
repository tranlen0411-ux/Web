-- ============================================================
-- COMPETITION V1 ACTIVE QUESTION SNAPSHOT RPC (MIGRATION 8)
-- SCOPE: Sanitized Active Question Reader for Students & Guests
-- MODEL A: Security Invoker Public Wrapper + Security Definer Private Helper
-- Strict Sanitization: Excludes correct_answer, explanation, guest_token_hash
-- ============================================================

BEGIN;

-- Conservative timeout protections
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ------------------------------------------------------------
-- 1. PRIVATE HELPER: competition_get_active_question_snapshot_internal
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.competition_get_active_question_snapshot_internal(
    p_session_id UUID,
    p_participant_id UUID DEFAULT NULL,
    p_guest_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_guest_token_hash VARCHAR(64);
    v_session RECORD;
    v_participant RECORD;
    v_question RECORD;
    v_is_authorized BOOLEAN := false;
    v_question_json JSONB := NULL;
BEGIN
    -- 1. Input Validation
    IF p_session_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_ID',
            'message', 'ID phòng thi không được để trống.'
        );
    END IF;

    -- 2. Load Session Record
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

    -- 3. Identity Resolution & Authorization Check
    v_caller_id := auth.uid();

    IF v_caller_id IS NOT NULL THEN
        -- Check if caller is Host
        IF v_session.host_id = v_caller_id THEN
            v_is_authorized := true;
        ELSE
            -- Check if caller is Admin
            SELECT role INTO v_caller_role
            FROM public.profiles
            WHERE id = v_caller_id;

            IF v_caller_role = 'admin' THEN
                v_is_authorized := true;
            ELSE
                -- Check if caller is an enrolled authenticated student in this session (status != 'kicked')
                SELECT id, session_id, user_id, is_guest, status
                INTO v_participant
                FROM public.competition_participants
                WHERE session_id = p_session_id
                  AND user_id = v_caller_id
                  AND is_guest = false;

                IF v_participant.id IS NOT NULL AND v_participant.status <> 'kicked' THEN
                    v_is_authorized := true;
                END IF;
            END IF;
        END IF;
    ELSE
        -- Guest caller authorization
        IF p_participant_id IS NOT NULL AND p_guest_token IS NOT NULL AND pg_catalog.length(pg_catalog.btrim(p_guest_token)) >= 32 THEN
            v_guest_token_hash := pg_catalog.encode(
                extensions.digest(pg_catalog.convert_to(pg_catalog.btrim(p_guest_token), 'UTF8'), 'sha256'),
                'hex'
            );

            SELECT id, session_id, is_guest, status
            INTO v_participant
            FROM public.competition_participants
            WHERE id = p_participant_id
              AND session_id = p_session_id
              AND is_guest = true
              AND guest_token_hash = v_guest_token_hash;

            IF v_participant.id IS NOT NULL AND v_participant.status <> 'kicked' THEN
                v_is_authorized := true;
            END IF;
        END IF;
    END IF;

    IF NOT v_is_authorized THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'UNAUTHORIZED_ACCESS',
            'message', 'Bạn không có quyền truy cập thông tin câu hỏi của phòng thi này.'
        );
    END IF;

    -- 4. Session Status Handling & Sanitized Question Fetch
    -- States: waiting, finished, cancelled return question: null
    IF v_session.status IN ('waiting', 'finished', 'cancelled') THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'session_id', v_session.id,
            'session_status', v_session.status,
            'current_question_index', v_session.current_question_index,
            'question_deadline', NULL,
            'question', NULL
        );
    END IF;

    -- States: in_progress, paused
    IF v_session.current_question_id IS NOT NULL THEN
        SELECT
            id,
            session_id,
            question_order,
            question_text,
            question_type,
            options,
            points,
            time_limit_seconds
        INTO v_question
        FROM public.competition_questions
        WHERE id = v_session.current_question_id
          AND session_id = p_session_id;

        IF v_question.id IS NOT NULL THEN
            v_question_json := pg_catalog.jsonb_build_object(
                'id', v_question.id,
                'session_id', v_question.session_id,
                'question_order', v_question.question_order,
                'question_text', v_question.question_text,
                'question_type', v_question.question_type,
                'options', v_question.options,
                'points', v_question.points,
                'time_limit_seconds', v_question.time_limit_seconds
            );
        END IF;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'session_id', v_session.id,
        'session_status', v_session.status,
        'current_question_index', v_session.current_question_index,
        'question_deadline', v_session.question_deadline,
        'question', v_question_json
    );
END;
$$;

-- ------------------------------------------------------------
-- 2. PUBLIC SECURITY INVOKER WRAPPER: competition_get_active_question_snapshot
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.competition_get_active_question_snapshot(
    p_session_id UUID,
    p_participant_id UUID DEFAULT NULL,
    p_guest_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RETURN private.competition_get_active_question_snapshot_internal(
        p_session_id,
        p_participant_id,
        p_guest_token
    );
END;
$$;

-- ------------------------------------------------------------
-- 3. PERMISSIONS & ROLE GRANTS
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION private.competition_get_active_question_snapshot_internal(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.competition_get_active_question_snapshot_internal(UUID, UUID, TEXT) TO authenticated, anon;

REVOKE EXECUTE ON FUNCTION public.competition_get_active_question_snapshot(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.competition_get_active_question_snapshot(UUID, UUID, TEXT) TO authenticated, anon;

COMMIT;
