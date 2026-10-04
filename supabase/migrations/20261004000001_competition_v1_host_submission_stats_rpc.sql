-- ============================================================
-- COMPETITION V1 HOST SUBMISSION STATS RPC (MIGRATION 9)
-- SCOPE: Sanitized Real-time Question Submission Statistics for Host
-- MODEL A: Security Invoker Public Wrapper + Security Definer Private Helper
-- Strict Sanitization: Excludes answer choices, is_correct, points, time_taken, user_id, guest_token_hash
-- ============================================================

BEGIN;

-- Conservative timeout protections
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ------------------------------------------------------------
-- 1. PRIVATE HELPER: competition_host_get_submission_stats_internal
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.competition_host_get_submission_stats_internal(
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
    v_total_eligible INT := 0;
    v_submitted_count INT := 0;
    v_not_submitted_count INT := 0;
    v_participants_json JSONB := '[]'::jsonb;
    v_has_active_question BOOLEAN := false;
BEGIN
    -- 1. Input Validation
    IF p_session_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_ID',
            'message', 'ID phòng thi không được để trống.'
        );
    END IF;

    -- 2. Authorization Check: Require Authenticated Identity (Fail closed if NULL)
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'UNAUTHORIZED_ACCESS',
            'message', 'Yêu cầu đăng nhập để truy cập.'
        );
    END IF;

    -- 3. Load Session Record (Proven columns only)
    SELECT id, host_id, status, current_question_index, current_question_id
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
            'message', 'Bạn không có quyền xem thống kê nộp bài của phòng thi này.'
        );
    END IF;

    -- 5. Compute Submission Stats
    -- Count total eligible participants regardless of question state
    SELECT pg_catalog.count(*)::INT
    INTO v_total_eligible
    FROM public.competition_participants
    WHERE session_id = p_session_id
      AND status <> 'kicked';

    -- If there is a valid current_question_id, derive stats for current active question
    IF v_session.current_question_id IS NOT NULL THEN
        v_has_active_question := true;

        SELECT
            pg_catalog.count(a.id)::INT,
            (v_total_eligible - pg_catalog.count(a.id))::INT,
            COALESCE(
                pg_catalog.jsonb_agg(
                    pg_catalog.jsonb_build_object(
                        'participant_id', p.id,
                        'display_name', p.display_name,
                        'avatar_url', p.avatar_url,
                        'status', p.status,
                        'last_seen_at', p.last_seen_at,
                        'submitted', (a.id IS NOT NULL),
                        'submitted_at', a.submitted_at
                    )
                    ORDER BY (a.id IS NOT NULL) DESC, a.submitted_at ASC NULLS LAST, p.joined_at ASC
                ),
                '[]'::jsonb
            )
        INTO
            v_submitted_count,
            v_not_submitted_count,
            v_participants_json
        FROM public.competition_participants p
        LEFT JOIN public.competition_answers a
            ON a.session_id = p_session_id
           AND a.question_id = v_session.current_question_id
           AND a.participant_id = p.id
        WHERE p.session_id = p_session_id
          AND p.status <> 'kicked';
    ELSE
        -- Neutral state: No current question exists (waiting, finished/cancelled with null question)
        v_has_active_question := false;
        v_submitted_count := 0;
        v_not_submitted_count := 0;
        v_participants_json := '[]'::jsonb;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'session_id', v_session.id,
        'session_status', v_session.status,
        'has_active_question', v_has_active_question,
        'current_question_id', v_session.current_question_id,
        'current_question_index', v_session.current_question_index,
        'total_eligible', v_total_eligible,
        'submitted_count', v_submitted_count,
        'not_submitted_count', v_not_submitted_count,
        'participants', v_participants_json
    );
END;
$$;


-- ------------------------------------------------------------
-- 2. PUBLIC SECURITY INVOKER WRAPPER: competition_host_get_submission_stats
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.competition_host_get_submission_stats(
    p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RETURN private.competition_host_get_submission_stats_internal(
        p_session_id
    );
END;
$$;

-- ------------------------------------------------------------
-- 3. PERMISSIONS & ROLE GRANTS
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION private.competition_host_get_submission_stats_internal(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.competition_host_get_submission_stats_internal(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION private.competition_host_get_submission_stats_internal(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.competition_host_get_submission_stats(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.competition_host_get_submission_stats(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.competition_host_get_submission_stats(UUID) TO authenticated;

COMMIT;
