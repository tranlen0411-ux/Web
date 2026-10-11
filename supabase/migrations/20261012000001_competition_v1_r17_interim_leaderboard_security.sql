-- ============================================================
-- MIGRATION: 20261012000001_competition_v1_r17_interim_leaderboard_security.sql
-- DESCRIPTION: R17 - Interim Leaderboard Security Hardening & Paused Bypass Fix
-- INVARIANTS:
-- 1. Paused Bypass Fixed: Session in 'paused' status blocks Student/Guest with QUESTION_STILL_OPEN.
-- 2. Authoritative Close Verification: Student/Guest can only view leaderboard when question_deadline
--    has passed AND snapshot for current_question_id exists in competition_question_result_snapshots.
-- 3. Stale Snapshot Isolation: Previous question snapshots never unlock the leaderboard for active questions.
-- 4. Host & Admin Always Permitted: Real-time leaderboard view preserved for room organizers.
-- 5. Role & Credential Consistency: Authenticated students and Guest hashes strictly enforced.
-- 6. Scoring, Tie-break, and Sanitization preserved 100%.
-- ============================================================

CREATE OR REPLACE FUNCTION private.competition_get_leaderboard_snapshot_internal(
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
    v_is_authorized BOOLEAN := false;
    v_is_host_or_admin BOOLEAN := false;
    v_snapshot_ready BOOLEAN := false;
    v_leaderboard JSONB;
    v_verify_session RECORD;
BEGIN
    -- 1. Input Validation
    IF p_session_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_ID',
            'message', 'ID phòng thi không được để trống.'
        );
    END IF;

    -- 2. Load Session Info
    SELECT id, host_id, status, current_question_id, current_question_index, question_deadline, paused_remaining_ms
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
            v_is_host_or_admin := true;
        ELSE
            -- Check if caller is Admin
            SELECT role INTO v_caller_role
            FROM public.profiles
            WHERE id = v_caller_id;

            IF v_caller_role = 'admin' THEN
                v_is_authorized := true;
                v_is_host_or_admin := true;
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
            'error_code', 'FORBIDDEN',
            'message', 'Bạn không có quyền xem bảng xếp hạng phòng thi này.'
        );
    END IF;

    -- 4. Gate for Student / Guest callers across all session statuses
    IF NOT v_is_host_or_admin THEN
        IF v_session.status = 'cancelled' THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'SESSION_CANCELLED',
                'message', 'Phòng thi đã bị hủy.'
            );
        ELSIF v_session.status = 'waiting' THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', true,
                'session_id', v_session.id,
                'session_status', v_session.status,
                'current_question_index', v_session.current_question_index,
                'current_question_id', v_session.current_question_id,
                'leaderboard', '[]'::jsonb
            );
        ELSIF v_session.status = 'paused' THEN
            -- FIX BLOCKER: Session is paused mid-question or mid-match.
            -- Prevent data leakage while match is on hold.
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'QUESTION_STILL_OPEN',
                'message', 'Phòng thi đang tạm dừng. Bảng xếp hạng sẽ mở sau khi câu hỏi kết thúc.'
            );
        ELSIF v_session.status = 'in_progress' THEN
            -- In-progress gate: must have an active question, deadline must be reached,
            -- and snapshot for the current question must be materialized in competition_question_result_snapshots.
            IF v_session.current_question_id IS NULL THEN
                RETURN pg_catalog.jsonb_build_object(
                    'success', false,
                    'error_code', 'QUESTION_NOT_ACTIVE',
                    'message', 'Chưa có câu hỏi đang diễn ra.'
                );
            END IF;

            IF v_session.question_deadline IS NULL OR pg_catalog.clock_timestamp() < v_session.question_deadline THEN
                RETURN pg_catalog.jsonb_build_object(
                    'success', false,
                    'error_code', 'QUESTION_STILL_OPEN',
                    'message', 'Câu hỏi đang diễn ra. Bảng xếp hạng sẽ mở sau khi câu hỏi kết thúc.'
                );
            END IF;

            -- Verify authoritative question snapshot readiness
            -- Strictly isolates by session_id and current_question_id (never relies on stale question snapshots)
            SELECT EXISTS(
                SELECT 1
                FROM public.competition_question_result_snapshots
                WHERE session_id = v_session.id
                  AND question_id = v_session.current_question_id
            ) INTO v_snapshot_ready;

            IF NOT v_snapshot_ready THEN
                RETURN pg_catalog.jsonb_build_object(
                    'success', false,
                    'error_code', 'QUESTION_STILL_OPEN',
                    'message', 'Kết quả câu hỏi đang được tổng hợp. Bảng xếp hạng sẽ mở sau khi câu hỏi kết thúc.'
                );
            END IF;
        ELSIF v_session.status = 'finished' THEN
            -- Session finished: allow final leaderboard view
            NULL;
        ELSE
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'INVALID_SESSION_STATE',
                'message', 'Trạng thái phòng thi không hợp lệ để xem bảng xếp hạng.'
            );
        END IF;
    END IF;

    -- 5. Query Sanitized Leaderboard Snapshot
    -- Dynamic rank calculation matching locked criteria:
    -- total_score DESC, correct_count DESC, total_response_time_ms ASC
    -- Ties share exact rank.
    -- Strict field sanitation: No guest_token_hash, raw token, internal user_id, or answer payloads exposed.
    SELECT COALESCE(
        pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
                'participant_id', t.participant_id,
                'display_name', t.display_name,
                'avatar_url', t.avatar_url,
                'team_id', t.team_id,
                'is_guest', t.is_guest,
                'total_score', t.total_score,
                'correct_count', t.correct_count,
                'total_response_time_ms', t.total_response_time_ms,
                'rank', t.calc_rank
            )
            ORDER BY t.calc_rank ASC, t.participant_id ASC
        ),
        '[]'::jsonb
    )
    INTO v_leaderboard
    FROM (
        SELECT 
            p.id AS participant_id,
            p.display_name,
            p.avatar_url,
            p.team_id,
            p.is_guest,
            s.total_score,
            s.correct_count,
            s.total_response_time_ms,
            RANK() OVER (
                ORDER BY s.total_score DESC,
                         s.correct_count DESC,
                         s.total_response_time_ms ASC
            )::INTEGER AS calc_rank
        FROM public.competition_scores s
        JOIN public.competition_participants p ON s.participant_id = p.id
        WHERE s.session_id = p_session_id
          AND p.status <> 'kicked'
    ) t;

    -- 6. Atomicity & Concurrency Guard (Post-query state verification)
    -- Protect against race conditions if Host transitioned questions while score query was running
    IF NOT v_is_host_or_admin THEN
        SELECT current_question_id, current_question_index, status
        INTO v_verify_session
        FROM public.competition_sessions
        WHERE id = p_session_id;

        IF v_verify_session.current_question_id IS DISTINCT FROM v_session.current_question_id
           OR v_verify_session.current_question_index IS DISTINCT FROM v_session.current_question_index
           OR v_verify_session.status IS DISTINCT FROM v_session.status THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'QUESTION_STILL_OPEN',
                'message', 'Phòng thi đã chuyển sang câu hỏi tiếp theo. Bảng xếp hạng sẽ mở sau khi câu hỏi kết thúc.'
            );
        END IF;
    END IF;

    -- 7. Return Structured Success Result with metadata
    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'session_id', v_session.id,
        'session_status', v_session.status,
        'current_question_index', v_session.current_question_index,
        'current_question_id', v_session.current_question_id,
        'leaderboard', v_leaderboard
    );
END;
$$;

-- Privileges & Grants
REVOKE EXECUTE ON FUNCTION private.competition_get_leaderboard_snapshot_internal(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.competition_get_leaderboard_snapshot_internal(UUID, UUID, TEXT) TO authenticated, anon;
GRANT USAGE ON SCHEMA private TO authenticated, anon;

-- Public Invoker RPC Wrapper (re-assert to guarantee freshness)
CREATE OR REPLACE FUNCTION public.competition_get_leaderboard_snapshot(
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
    RETURN private.competition_get_leaderboard_snapshot_internal(
        p_session_id,
        p_participant_id,
        p_guest_token
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.competition_get_leaderboard_snapshot(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.competition_get_leaderboard_snapshot(UUID, UUID, TEXT) TO authenticated, anon;
