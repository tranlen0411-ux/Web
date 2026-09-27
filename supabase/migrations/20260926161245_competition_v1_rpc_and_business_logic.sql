-- ============================================================
-- COMPETITION V1 BUSINESS LOGIC & RPC (MIGRATION 2)
-- PHASE 1: Private Schema Foundation & Join Attempts Delta
-- PHASE 2A FINAL: Session Join & Rejoin Internal Helpers
-- PHASE 2B: Question Submission Internal Helper
-- PHASE 2C: Session Finish & Leaderboard Internal Helpers
-- PHASE 2D-1: Public Participant Security Invoker RPC Wrappers
-- PHASE 2D-2: Public Host Security Invoker RPCs
-- ============================================================

-- Conservative timeout protections
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ------------------------------------------------------------
-- 1. PRIVATE SCHEMA FOUNDATION
-- ------------------------------------------------------------
-- Encapsulate internal helper functions and rate-limiting logic.
CREATE SCHEMA IF NOT EXISTS private;

-- Revoke all default access from PUBLIC to ensure strict security baseline
REVOKE ALL ON SCHEMA private FROM PUBLIC;

-- ------------------------------------------------------------
-- 2. DELTA: public.competition_join_attempts
-- ------------------------------------------------------------
-- Allow ip_address to be optional when authenticated user or guest token is provided
ALTER TABLE public.competition_join_attempts
    ALTER COLUMN ip_address DROP NOT NULL;

-- Add authenticated user identity column with CASCADE to prevent blocking profile lifecycle
ALTER TABLE public.competition_join_attempts
    ADD COLUMN user_id UUID NULL,
    ADD CONSTRAINT competition_join_attempts_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Add guest identity hash column with 64-char SHA256 hex format validation
ALTER TABLE public.competition_join_attempts
    ADD COLUMN guest_token_hash VARCHAR(64) NULL,
    ADD CONSTRAINT check_competition_join_attempt_guest_token_hash
        CHECK (guest_token_hash IS NULL OR guest_token_hash ~ '^[0-9a-f]{64}$');

-- Add identity signal check: ensure at least one identifier is present
ALTER TABLE public.competition_join_attempts
    ADD CONSTRAINT check_competition_join_attempt_identity
        CHECK (
            user_id IS NOT NULL
            OR guest_token_hash IS NOT NULL
            OR ip_address IS NOT NULL
        );

-- ------------------------------------------------------------
-- 3. PARTIAL INDEXES FOR RATE LIMITING & AUDIT
-- ------------------------------------------------------------
-- Authenticated user rate limiting index
CREATE INDEX idx_competition_join_attempts_user
    ON public.competition_join_attempts (room_code, user_id, created_at DESC)
    WHERE user_id IS NOT NULL;

-- Guest token hash rate limiting index
CREATE INDEX idx_competition_join_attempts_guest
    ON public.competition_join_attempts (room_code, guest_token_hash, created_at DESC)
    WHERE guest_token_hash IS NOT NULL;

-- ------------------------------------------------------------
-- 4. PRIVATE HELPER: competition_join_session_internal
-- ------------------------------------------------------------
-- Handles atomic join/rejoin semantics, deterministic brute-force protection,
-- capacity protection via row-level locking, student-only role enforcement,
-- guest token length verification (min 32 chars), and atomic score initialization.
CREATE OR REPLACE FUNCTION private.competition_join_session_internal(
    p_room_code TEXT,
    p_display_name TEXT DEFAULT NULL,
    p_avatar_url TEXT DEFAULT NULL,
    p_team_id UUID DEFAULT NULL,
    p_guest_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_is_authenticated BOOLEAN;
    v_guest_token_hash VARCHAR(64);
    v_room_code VARCHAR(20);
    v_display_name VARCHAR(100);
    v_avatar_url TEXT;
    v_team_id UUID;
    v_profile RECORD;
    v_session RECORD;
    v_inactive_session RECORD;
    v_participant RECORD;
    v_existing_participant RECORD;
    v_verified_team_id UUID;
    v_participant_count INT;
    v_is_rate_limited BOOLEAN;
BEGIN
    -- 1. Input Validation: Normalize room code (VARCHAR(20) domain matching audit schema)
    v_room_code := pg_catalog.upper(pg_catalog.btrim(p_room_code));
    IF v_room_code IS NULL OR v_room_code = '' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_ROOM_CODE',
            'message', 'Mã phòng thi không được để trống.'
        );
    END IF;

    -- 2. Input & Identity Validation: Authenticated caller vs Guest caller
    v_user_id := auth.uid();
    IF v_user_id IS NOT NULL THEN
        v_is_authenticated := true;
        v_guest_token_hash := NULL;

        -- Fetch authenticated profile
        SELECT id, full_name, avatar_url, role INTO v_profile
        FROM public.profiles
        WHERE id = v_user_id;

        IF v_profile.id IS NULL THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'PROFILE_NOT_FOUND',
                'message', 'Không tìm thấy hồ sơ người dùng.'
            );
        END IF;

        -- Fail-safe role check: only student accounts participate in student competitions
        IF v_profile.role <> 'student' THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'ROLE_NOT_ALLOWED',
                'message', 'Chỉ tài khoản học sinh (student) mới được phép tham gia phòng thi với tư cách người chơi.'
            );
        END IF;

        -- Resolve display name and avatar
        v_display_name := pg_catalog.btrim(COALESCE(NULLIF(pg_catalog.btrim(p_display_name), ''), v_profile.full_name, 'Học sinh'));
        v_avatar_url := pg_catalog.btrim(COALESCE(NULLIF(pg_catalog.btrim(p_avatar_url), ''), v_profile.avatar_url));
    ELSE
        v_is_authenticated := false;
        v_user_id := NULL;

        -- Guest Token Length Validation: minimum 32 characters (CSPRNG generation enforced at Edge/Client)
        IF p_guest_token IS NULL OR pg_catalog.length(pg_catalog.btrim(p_guest_token)) < 32 THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'INVALID_GUEST_TOKEN',
                'message', 'Mã định danh khách (guest token) không đủ độ dài hợp lệ (yêu cầu tối thiểu 32 ký tự).'
            );
        END IF;

        v_guest_token_hash := pg_catalog.encode(
            extensions.digest(pg_catalog.convert_to(pg_catalog.btrim(p_guest_token), 'UTF8'), 'sha256'),
            'hex'
        );

        v_display_name := pg_catalog.btrim(p_display_name);
        IF v_display_name IS NULL OR v_display_name = '' THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'INVALID_DISPLAY_NAME',
                'message', 'Tên hiển thị của khách không được để trống.'
            );
        END IF;

        v_avatar_url := NULLIF(pg_catalog.btrim(p_avatar_url), '');
    END IF;

    -- 3. Deterministic Brute-Force Rate Limiting Check
    -- Rule: 10 RATE_LIMIT_THRESHOLD_FAILURES ('failed_invalid_code', 'failed_banned')
    -- within any 5-minute rolling window establishes a 15-minute block.
    v_is_rate_limited := false;

    SELECT true INTO v_is_rate_limited
    FROM (
        SELECT created_at,
               pg_catalog.lag(created_at, 9) OVER (ORDER BY created_at ASC) AS window_start
        FROM public.competition_join_attempts
        WHERE room_code = v_room_code
          AND (
              (v_is_authenticated AND user_id = v_user_id)
              OR (NOT v_is_authenticated AND guest_token_hash = v_guest_token_hash)
          )
          AND attempt_status IN ('failed_invalid_code', 'failed_banned')
          AND created_at >= (pg_catalog.now() - interval '20 minutes')
    ) sub
    WHERE sub.window_start IS NOT NULL
      AND (sub.created_at - sub.window_start) <= interval '5 minutes'
      AND pg_catalog.now() < (sub.created_at + interval '15 minutes')
    LIMIT 1;

    IF v_is_rate_limited IS TRUE THEN
        -- AUDIT_ONLY_FAILURE: logged as failed_rate_limited, does NOT count toward new threshold
        INSERT INTO public.competition_join_attempts (
            session_id, room_code, ip_address, user_id, guest_token_hash, attempt_status, failure_reason
        ) VALUES (
            NULL, v_room_code, NULL, v_user_id, v_guest_token_hash, 'failed_rate_limited',
            'Rate limit exceeded: 10 failed attempts within 5 minutes. Blocked for 15 minutes.'
        );

        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'TOO_MANY_JOIN_ATTEMPTS',
            'message', 'Quá nhiều lần tham gia thất bại. Vui lòng thử lại sau 15 phút.'
        );
    END IF;

    -- 4. Session Row Lock FOR UPDATE to eliminate capacity race conditions
    SELECT * INTO v_session
    FROM public.competition_sessions
    WHERE room_code = v_room_code
      AND status IN ('waiting', 'in_progress', 'paused')
    FOR UPDATE;

    IF v_session.id IS NULL THEN
        -- Check if inactive session exists for specific audit logging
        SELECT * INTO v_inactive_session
        FROM public.competition_sessions
        WHERE room_code = v_room_code
        ORDER BY created_at DESC
        LIMIT 1;

        IF v_inactive_session.id IS NOT NULL THEN
            -- AUDIT_ONLY_FAILURE: failed_room_inactive (room exists, not an invalid-code attack)
            INSERT INTO public.competition_join_attempts (
                session_id, room_code, ip_address, user_id, guest_token_hash, attempt_status, failure_reason
            ) VALUES (
                v_inactive_session.id, v_room_code, NULL, v_user_id, v_guest_token_hash, 'failed_room_inactive',
                'Session is not active (status: ' || v_inactive_session.status || ').'
            );

            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'SESSION_NOT_JOINABLE',
                'message', 'Phòng thi đã kết thúc hoặc không ở trạng thái mở.'
            );
        ELSE
            -- RATE_LIMIT_THRESHOLD_FAILURE: failed_invalid_code (brute-force code probing)
            INSERT INTO public.competition_join_attempts (
                session_id, room_code, ip_address, user_id, guest_token_hash, attempt_status, failure_reason
            ) VALUES (
                NULL, v_room_code, NULL, v_user_id, v_guest_token_hash, 'failed_invalid_code',
                'Room code not found.'
            );

            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'SESSION_NOT_FOUND',
                'message', 'Mã phòng thi không tồn tại hoặc không hợp lệ.'
            );
        END IF;
    END IF;

    -- 5. Inspect existing participant (duplicate / rejoin semantics)
    IF v_is_authenticated THEN
        SELECT id, session_id, user_id, guest_token_hash, display_name, avatar_url, team_id, is_guest, status, joined_at, last_seen_at
        INTO v_existing_participant
        FROM public.competition_participants
        WHERE session_id = v_session.id AND user_id = v_user_id;
    ELSE
        SELECT id, session_id, user_id, guest_token_hash, display_name, avatar_url, team_id, is_guest, status, joined_at, last_seen_at
        INTO v_existing_participant
        FROM public.competition_participants
        WHERE session_id = v_session.id AND guest_token_hash = v_guest_token_hash;
    END IF;

    IF v_existing_participant.id IS NOT NULL THEN
        -- RATE_LIMIT_THRESHOLD_FAILURE: failed_banned (kicked participant attempting reentry)
        IF v_existing_participant.status = 'kicked' THEN
            INSERT INTO public.competition_join_attempts (
                session_id, room_code, ip_address, user_id, guest_token_hash, attempt_status, failure_reason
            ) VALUES (
                v_session.id, v_room_code, NULL, v_user_id, v_guest_token_hash, 'failed_banned',
                'Participant has been kicked from this session.'
            );

            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'PARTICIPANT_KICKED',
                'message', 'Bạn đã bị xóa khỏi phòng thi này.'
            );
        END IF;

        -- Rejoin existing participant
        UPDATE public.competition_participants
        SET last_seen_at = pg_catalog.now(),
            status = CASE WHEN status = 'disconnected' THEN 'active' ELSE status END
        WHERE id = v_existing_participant.id
        RETURNING id, session_id, user_id, guest_token_hash, display_name, avatar_url, team_id, is_guest, status, joined_at, last_seen_at
        INTO v_existing_participant;

        INSERT INTO public.competition_join_attempts (
            session_id, room_code, ip_address, user_id, guest_token_hash, attempt_status, failure_reason
        ) VALUES (
            v_session.id, v_room_code, NULL, v_user_id, v_guest_token_hash, 'success',
            'Rejoin successful.'
        );

        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'is_rejoin', true,
            'session', pg_catalog.jsonb_build_object(
                'id', v_session.id,
                'room_code', v_session.room_code,
                'title', v_session.title,
                'description', v_session.description,
                'mode', v_session.mode,
                'status', v_session.status,
                'max_participants', v_session.max_participants,
                'current_question_index', v_session.current_question_index,
                'started_at', v_session.started_at,
                'ended_at', v_session.ended_at
            ),
            'participant', pg_catalog.jsonb_build_object(
                'id', v_existing_participant.id,
                'session_id', v_existing_participant.session_id,
                'display_name', v_existing_participant.display_name,
                'avatar_url', v_existing_participant.avatar_url,
                'team_id', v_existing_participant.team_id,
                'is_guest', v_existing_participant.is_guest,
                'status', v_existing_participant.status,
                'joined_at', v_existing_participant.joined_at,
                'last_seen_at', v_existing_participant.last_seen_at
            )
        );
    END IF;

    -- 6. Validate session status for NEW participant join (AUDIT_ONLY_FAILURE: failed_room_inactive)
    IF v_session.status <> 'waiting' THEN
        INSERT INTO public.competition_join_attempts (
            session_id, room_code, ip_address, user_id, guest_token_hash, attempt_status, failure_reason
        ) VALUES (
            v_session.id, v_room_code, NULL, v_user_id, v_guest_token_hash, 'failed_room_inactive',
            'New participants cannot join session in status: ' || v_session.status
        );

        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_NOT_JOINABLE',
            'message', 'Phòng thi đã bắt đầu hoặc không ở trạng thái mở tiếp nhận người mới.'
        );
    END IF;

    -- 7. Validate capacity under FOR UPDATE lock (AUDIT_ONLY_FAILURE: failed_room_full)
    SELECT pg_catalog.count(*) INTO v_participant_count
    FROM public.competition_participants
    WHERE session_id = v_session.id
      AND status <> 'kicked';

    IF v_participant_count >= v_session.max_participants THEN
        INSERT INTO public.competition_join_attempts (
            session_id, room_code, ip_address, user_id, guest_token_hash, attempt_status, failure_reason
        ) VALUES (
            v_session.id, v_room_code, NULL, v_user_id, v_guest_token_hash, 'failed_room_full',
            'Session capacity reached (' || v_session.max_participants || ').'
        );

        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'ROOM_FULL',
            'message', 'Phòng thi đã đủ số lượng người tham gia tối đa.'
        );
    END IF;

    -- 8. Validate team assignment (INPUT_VALIDATION_FAILURE: not rate-limited)
    v_team_id := NULL;
    IF v_session.mode = 'individual' THEN
        IF p_team_id IS NOT NULL THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'INVALID_TEAM_ASSIGNMENT',
                'message', 'Phòng thi cá nhân không áp dụng chọn đội.'
            );
        END IF;
    ELSIF v_session.mode = 'team' THEN
        IF p_team_id IS NOT NULL THEN
            SELECT id INTO v_verified_team_id
            FROM public.competition_teams
            WHERE id = p_team_id AND session_id = v_session.id;

            IF v_verified_team_id IS NULL THEN
                RETURN pg_catalog.jsonb_build_object(
                    'success', false,
                    'error_code', 'INVALID_TEAM',
                    'message', 'Đội thi không tồn tại hoặc không thuộc phòng thi này.'
                );
            END IF;
            v_team_id := v_verified_team_id;
        END IF;
    END IF;

    -- 9. Insert participant
    INSERT INTO public.competition_participants (
        session_id,
        user_id,
        guest_token_hash,
        display_name,
        avatar_url,
        team_id,
        is_guest,
        status,
        joined_at,
        last_seen_at
    ) VALUES (
        v_session.id,
        v_user_id,
        v_guest_token_hash,
        v_display_name,
        v_avatar_url,
        v_team_id,
        (NOT v_is_authenticated),
        'joined',
        pg_catalog.now(),
        pg_catalog.now()
    ) RETURNING id, session_id, user_id, guest_token_hash, display_name, avatar_url, team_id, is_guest, status, joined_at, last_seen_at
    INTO v_participant;

    -- 10. Atomic score initialization
    INSERT INTO public.competition_scores (
        session_id,
        participant_id,
        total_score,
        correct_count,
        total_response_time_ms,
        rank
    ) VALUES (
        v_session.id,
        v_participant.id,
        0.00,
        0,
        0,
        NULL
    );

    -- 11. Audit successful join
    INSERT INTO public.competition_join_attempts (
        session_id,
        room_code,
        ip_address,
        user_id,
        guest_token_hash,
        attempt_status,
        failure_reason
    ) VALUES (
        v_session.id,
        v_room_code,
        NULL,
        v_user_id,
        v_guest_token_hash,
        'success',
        NULL
    );

    -- 12. Return structured success payload
    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'is_rejoin', false,
        'session', pg_catalog.jsonb_build_object(
            'id', v_session.id,
            'room_code', v_session.room_code,
            'title', v_session.title,
            'description', v_session.description,
            'mode', v_session.mode,
            'status', v_session.status,
            'max_participants', v_session.max_participants,
            'current_question_index', v_session.current_question_index,
            'started_at', v_session.started_at,
            'ended_at', v_session.ended_at
        ),
        'participant', pg_catalog.jsonb_build_object(
            'id', v_participant.id,
            'session_id', v_participant.session_id,
            'display_name', v_participant.display_name,
            'avatar_url', v_participant.avatar_url,
            'team_id', v_participant.team_id,
            'is_guest', v_participant.is_guest,
            'status', v_participant.status,
            'joined_at', v_participant.joined_at,
            'last_seen_at', v_participant.last_seen_at
        )
    );
END;
$$;

-- ============================================================
-- 5. PRIVATE HELPER: competition_rejoin_session_internal (FINAL)
-- ============================================================
-- 2-Stage Identity Verification:
-- Stage 1: READ-ONLY identity precheck prevents lock amplification.
-- Stage 2: Fixed hierarchy lock (sessions -> participants) reduces
-- designed lock-cycle risk and serializes against host finish/cancel lifecycle.
CREATE OR REPLACE FUNCTION private.competition_rejoin_session_internal(
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
    v_user_id UUID;
    v_guest_token_hash VARCHAR(64);
    v_session RECORD;
    v_pre_participant RECORD;
    v_participant RECORD;
BEGIN
    -- 1. Input Validation: session_id
    IF p_session_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_ID',
            'message', 'ID phòng thi không được để trống.'
        );
    END IF;

    -- 2. Stage 1: READ-ONLY Identity Precheck (NO SESSION LOCK ACQUIRED)
    v_user_id := auth.uid();
    IF v_user_id IS NOT NULL THEN
        -- Authenticated participant: read-only precheck with minimal security columns
        SELECT id, session_id, user_id, is_guest, status
        INTO v_pre_participant
        FROM public.competition_participants
        WHERE session_id = p_session_id
          AND user_id = v_user_id
          AND is_guest = false;
    ELSE
        -- Guest caller: format validation and read-only precheck with minimal security columns
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
        INTO v_pre_participant
        FROM public.competition_participants
        WHERE id = p_participant_id
          AND session_id = p_session_id
          AND is_guest = true
          AND guest_token_hash = v_guest_token_hash;
    END IF;

    -- Fast-fail: If identity precheck fails, exit immediately WITHOUT locking session
    IF v_pre_participant.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'PARTICIPANT_NOT_FOUND',
            'message', 'Không tìm thấy thông tin người tham gia trong phòng thi này.'
        );
    END IF;

    IF v_pre_participant.status = 'kicked' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'PARTICIPANT_KICKED',
            'message', 'Bạn đã bị xóa khỏi phòng thi này.'
        );
    END IF;

    -- 3. Stage 2: Locking Hierarchy (sessions -> participants)
    -- Step A: Lock Session Row FOR UPDATE to serialize with host finish/cancel lifecycle
    SELECT id, room_code, title, description, mode, status, max_participants, current_question_index, started_at, ended_at
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

    -- Validate Session Status under lock
    IF v_session.status IN ('finished', 'cancelled') THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_CLOSED',
            'message', 'Phòng thi đã kết thúc hoặc đã bị hủy.'
        );
    END IF;

    -- Step B: Re-read and Lock Participant Row FOR UPDATE using exact existing schema columns
    SELECT id, session_id, user_id, guest_token_hash, display_name, avatar_url, team_id, is_guest, status, joined_at, last_seen_at
    INTO v_participant
    FROM public.competition_participants
    WHERE id = v_pre_participant.id
      AND session_id = p_session_id
    FOR UPDATE;

    IF v_participant.id IS NULL OR v_participant.status = 'kicked' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'PARTICIPANT_KICKED',
            'message', 'Bạn đã bị xóa khỏi phòng thi này.'
        );
    END IF;

    -- Re-verify identity consistency under lock
    IF v_user_id IS NOT NULL THEN
        IF v_participant.user_id IS DISTINCT FROM v_user_id OR v_participant.is_guest IS TRUE THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'PARTICIPANT_NOT_FOUND',
                'message', 'Thông tin người tham gia không hợp lệ.'
            );
        END IF;
    ELSE
        IF v_participant.guest_token_hash IS DISTINCT FROM v_guest_token_hash OR v_participant.is_guest IS FALSE THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'INVALID_GUEST_CREDENTIALS',
                'message', 'Xác thực khách thất bại.'
            );
        END IF;
    END IF;

    -- 4. Update participant presence under lock using timestamptz-safe now()
    UPDATE public.competition_participants
    SET last_seen_at = pg_catalog.now(),
        status = CASE WHEN status = 'disconnected' THEN 'active' ELSE status END
    WHERE id = v_participant.id
    RETURNING id, session_id, user_id, guest_token_hash, display_name, avatar_url, team_id, is_guest, status, joined_at, last_seen_at
    INTO v_participant;

    -- 5. Return structured success payload
    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'is_rejoin', true,
        'session', pg_catalog.jsonb_build_object(
            'id', v_session.id,
            'room_code', v_session.room_code,
            'title', v_session.title,
            'description', v_session.description,
            'mode', v_session.mode,
            'status', v_session.status,
            'max_participants', v_session.max_participants,
            'current_question_index', v_session.current_question_index,
            'started_at', v_session.started_at,
            'ended_at', v_session.ended_at
        ),
        'participant', pg_catalog.jsonb_build_object(
            'id', v_participant.id,
            'session_id', v_participant.session_id,
            'display_name', v_participant.display_name,
            'avatar_url', v_participant.avatar_url,
            'team_id', v_participant.team_id,
            'is_guest', v_participant.is_guest,
            'status', v_participant.status,
            'joined_at', v_participant.joined_at,
            'last_seen_at', v_participant.last_seen_at
        )
    );
END;
$$;

-- ------------------------------------------------------------
-- 6. PRIVATE HELPER: competition_submit_answer_internal (PHASE 2B HARDENED)
-- ------------------------------------------------------------
-- ARCHITECTURAL CONTRACT & CANONICAL FORMAT (COMPETITION V1 DESIGN CONTRACT):
-- 1. Canonical Question Representation:
--    - single_choice:
--        options: [{"id": "opt_1", "text": "A"}, {"id": "opt_2", "text": "B"}]
--        correct_answer: {"option_id": "opt_1"}
--        submission: p_selected_option_ids = ["opt_1"]
--    - multiple_choice:
--        options: [{"id": "opt_1", "text": "A"}, {"id": "opt_2", "text": "B"}, {"id": "opt_3", "text": "C"}]
--        correct_answer: {"option_ids": ["opt_1", "opt_3"]}
--        submission: p_selected_option_ids = ["opt_1", "opt_3"]
--    - true_false:
--        options: [{"id": "true", "text": "Đúng"}, {"id": "false", "text": "Sai"}]
--        correct_answer: {"option_id": "true"}
--        submission: p_selected_option_ids = ["true"]
--    - short_answer:
--        options: []
--        correct_answer: {"accepted_answers": ["đáp án 1", "dap an 2"]}
--        submission: p_text_answer = "đáp án 1"
-- 2. Snapshot Invariant:
--    - Any future session creator (public.competition_host_create_session) MUST
--      canonicalize question bank / exam payloads into this exact shape before insertion.
--    - Reader strictly fails closed with 'MALFORMED_QUESTION_SNAPSHOT' on any mismatch.
-- 3. Locking Hierarchy:
--    - sessions -> participants -> scores -> answers
--    - Serializes duplicate submissions at score row level; unique constraint provides defense-in-depth.
-- 4. Architecture Baseline:
--    - 5 private SECURITY DEFINER helpers (join, rejoin, submit, finish, leaderboard_snapshot)
--    - 11 public SECURITY INVOKER RPCs
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

    -- Validate Server Deadline
    IF v_session.question_deadline IS NULL OR pg_catalog.now() > v_session.question_deadline THEN
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
-- 7. PRIVATE HELPER: competition_finish_session_internal (PHASE 2C)
-- ------------------------------------------------------------
-- Finalizes competition session state, atomic rank calculation, and session transition.
-- Lifecycle transitions allowed: waiting, in_progress, paused -> finished.
-- Rejected: finished (idempotent rejection, no double-mutation), cancelled (invalid transition).
-- Caller authorization: session host OR admin. Non-host teachers are rejected.
CREATE OR REPLACE FUNCTION private.competition_finish_session_internal(
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
    v_ended_at TIMESTAMPTZ;
BEGIN
    -- 1. Input Validation
    IF p_session_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_ID',
            'message', 'ID phòng thi không được để trống.'
        );
    END IF;

    -- 2. Caller Authentication Check (Must be Authenticated)
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'UNAUTHORIZED',
            'message', 'Yêu cầu đăng nhập để thực hiện thao tác kết thúc phòng thi.'
        );
    END IF;

    -- Resolve caller role from public.profiles
    SELECT role INTO v_caller_role
    FROM public.profiles
    WHERE id = v_caller_id;

    -- 3. Lock Session Row FOR UPDATE (Serializes concurrent submit/next/pause/resume)
    SELECT id, host_id, status, ended_at
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

    -- 4. Authorization: Session Host OR Admin
    IF v_session.host_id IS DISTINCT FROM v_caller_id AND v_caller_role IS DISTINCT FROM 'admin' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'FORBIDDEN_NOT_HOST',
            'message', 'Chỉ người tạo phòng thi (host) hoặc quản trị viên (admin) mới có quyền kết thúc phòng thi.'
        );
    END IF;

    -- 5. Lifecycle Transition Validation
    -- Finished -> Idempotent structured rejection without double mutation
    IF v_session.status = 'finished' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_ALREADY_FINISHED',
            'message', 'Phòng thi đã được kết thúc trước đó.'
        );
    ELSIF v_session.status = 'cancelled' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_CANCELLED',
            'message', 'Phòng thi đã bị hủy, không thể kết thúc.'
        );
    ELSIF v_session.status NOT IN ('waiting', 'in_progress', 'paused') THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_STATUS',
            'message', 'Trạng thái phòng thi không hợp lệ để kết thúc.'
        );
    END IF;

    -- 6. Atomic Final Rank Calculation and Persistence
    -- Locked ranking criteria: total_score DESC, correct_count DESC, total_response_time_ms ASC
    -- Uses RANK() window function: exact ties share rank.
    -- Totals (total_score, correct_count, total_response_time_ms) are strictly NOT mutated.
    WITH ranked AS (
        SELECT id,
               RANK() OVER (
                   ORDER BY total_score DESC,
                            correct_count DESC,
                            total_response_time_ms ASC
               )::INTEGER AS calc_rank
        FROM public.competition_scores
        WHERE session_id = v_session.id
    )
    UPDATE public.competition_scores s
    SET rank = r.calc_rank,
        updated_at = pg_catalog.now()
    FROM ranked r
    WHERE s.id = r.id;

    -- 7. Update Session State to Finished and Clean Active Timers
    v_ended_at := pg_catalog.now();
    UPDATE public.competition_sessions
    SET status = 'finished',
        ended_at = v_ended_at,
        current_question_id = NULL,
        question_deadline = NULL,
        paused_remaining_ms = NULL,
        updated_at = v_ended_at
    WHERE id = v_session.id;

    -- 8. Return Structured Success Response (Reward metadata only, zero side effects)
    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'session_id', v_session.id,
        'status', 'finished',
        'ended_at', v_ended_at
    );
END;
$$;

-- ------------------------------------------------------------
-- 8. PRIVATE HELPER: competition_get_leaderboard_snapshot_internal (PHASE 2C)
-- ------------------------------------------------------------
-- Fetches sanitized leaderboard snapshot with dynamic/persisted rank calculation.
-- Ranking order: total_score DESC, correct_count DESC, total_response_time_ms ASC.
-- Ties share rank (RANK() function).
-- Allowed callers: Host, Admin, Enrolled Authenticated Student, Verified Guest Participant.
-- Strict sanitization: Never exposes guest_token_hash, raw token, internal user_id, or answer payloads.
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
    v_leaderboard JSONB;
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
    SELECT id, host_id, status
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
            'error_code', 'FORBIDDEN',
            'message', 'Bạn không có quyền xem bảng xếp hạng phòng thi này.'
        );
    END IF;

    -- 4. Query Sanitized Leaderboard Snapshot
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

    -- 5. Return Structured Success Result
    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'session_id', v_session.id,
        'session_status', v_session.status,
        'leaderboard', v_leaderboard
    );
END;
$$;

-- ------------------------------------------------------------
-- 9. PRIVILEGE BASELINE (SECURITY MODEL A - 5 PRIVATE HELPERS)
-- ------------------------------------------------------------
-- Revoke all execute rights from PUBLIC
REVOKE EXECUTE ON FUNCTION private.competition_join_session_internal(TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.competition_rejoin_session_internal(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.competition_submit_answer_internal(UUID, UUID, UUID, TEXT, JSONB, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.competition_finish_session_internal(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.competition_get_leaderboard_snapshot_internal(UUID, UUID, TEXT) FROM PUBLIC;

-- Participant / Session actions: Authenticated and Anon (with internal guest credential verification)
GRANT EXECUTE ON FUNCTION private.competition_join_session_internal(TEXT, TEXT, TEXT, UUID, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION private.competition_rejoin_session_internal(UUID, UUID, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION private.competition_submit_answer_internal(UUID, UUID, UUID, TEXT, JSONB, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION private.competition_get_leaderboard_snapshot_internal(UUID, UUID, TEXT) TO authenticated, anon;

-- Finish session: Host/Admin only (Authenticated only, anon has NO EXECUTE)
GRANT EXECUTE ON FUNCTION private.competition_finish_session_internal(UUID) TO authenticated;

-- Allow schema usage for authenticated and anon roles
GRANT USAGE ON SCHEMA private TO authenticated, anon;

-- ------------------------------------------------------------
-- 10. PUBLIC SECURITY INVOKER RPCS (PHASE 2D-1: PARTICIPANT WRAPPERS)
-- ------------------------------------------------------------
-- All public participant wrappers run as SECURITY INVOKER and delegate
-- privileged operations to the corresponding private helpers (Model A).
-- The wrappers validate incoming parameter types, strictly maintain
-- search_path = '', and never accept client-side authority parameters.

-- 10.1 competition_join_session
CREATE OR REPLACE FUNCTION public.competition_join_session(
    p_room_code TEXT,
    p_display_name TEXT DEFAULT NULL,
    p_avatar_url TEXT DEFAULT NULL,
    p_team_id UUID DEFAULT NULL,
    p_guest_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RETURN private.competition_join_session_internal(
        p_room_code := p_room_code,
        p_display_name := p_display_name,
        p_avatar_url := p_avatar_url,
        p_team_id := p_team_id,
        p_guest_token := p_guest_token
    );
END;
$$;

-- 10.2 competition_rejoin_session
CREATE OR REPLACE FUNCTION public.competition_rejoin_session(
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
    RETURN private.competition_rejoin_session_internal(
        p_session_id := p_session_id,
        p_participant_id := p_participant_id,
        p_guest_token := p_guest_token
    );
END;
$$;

-- 10.3 competition_submit_answer
CREATE OR REPLACE FUNCTION public.competition_submit_answer(
    p_session_id UUID,
    p_question_id UUID,
    p_participant_id UUID DEFAULT NULL,
    p_guest_token TEXT DEFAULT NULL,
    p_selected_option_ids JSONB DEFAULT '[]'::jsonb,
    p_text_answer TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RETURN private.competition_submit_answer_internal(
        p_session_id := p_session_id,
        p_question_id := p_question_id,
        p_participant_id := p_participant_id,
        p_guest_token := p_guest_token,
        p_selected_option_ids := p_selected_option_ids,
        p_text_answer := p_text_answer
    );
END;
$$;

-- 10.4 competition_get_leaderboard_snapshot
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
        p_session_id := p_session_id,
        p_participant_id := p_participant_id,
        p_guest_token := p_guest_token
    );
END;
$$;

-- ------------------------------------------------------------
-- 11. PUBLIC RPC PRIVILEGE BASELINE (PHASE 2D-1)
-- ------------------------------------------------------------
-- Revoke all execute rights from PUBLIC
REVOKE EXECUTE ON FUNCTION public.competition_join_session(TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.competition_rejoin_session(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.competition_submit_answer(UUID, UUID, UUID, TEXT, JSONB, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.competition_get_leaderboard_snapshot(UUID, UUID, TEXT) FROM PUBLIC;

-- Grant EXECUTE to authenticated and anon
GRANT EXECUTE ON FUNCTION public.competition_join_session(TEXT, TEXT, TEXT, UUID, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.competition_rejoin_session(UUID, UUID, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.competition_submit_answer(UUID, UUID, UUID, TEXT, JSONB, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.competition_get_leaderboard_snapshot(UUID, UUID, TEXT) TO authenticated, anon;

-- ------------------------------------------------------------
-- 12. PUBLIC HOST SECURITY INVOKER RPCS (PHASE 2D-2)
-- ------------------------------------------------------------
-- All host RPCs run as SECURITY INVOKER under the authenticated caller identity.
-- Host eligibility requires role IN ('teacher', 'admin') from public.profiles.
-- Session lifecycle mutations require session.host_id = auth.uid() and serialize
-- on the competition_sessions row via FOR UPDATE lock.
-- All transition timestamps are captured using pg_catalog.clock_timestamp() AFTER acquiring the row lock.

-- 12.1 competition_host_create_session
CREATE OR REPLACE FUNCTION public.competition_host_create_session(
    p_title TEXT,
    p_description TEXT DEFAULT NULL,
    p_mode TEXT DEFAULT 'individual',
    p_max_participants INT DEFAULT 100,
    p_questions JSONB DEFAULT '[]'::jsonb,
    p_teams JSONB DEFAULT '[]'::jsonb,
    p_reward_enabled BOOLEAN DEFAULT false,
    p_reward_config JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_role TEXT;
    v_title VARCHAR(255);
    v_mode VARCHAR(20);
    v_max_participants INT;
    v_q_count INT;
    v_session_id UUID;
    v_room_code VARCHAR(10);
    v_alphabet TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    v_rand_idx INT;
    v_code_attempt INT := 0;
    v_code_found BOOLEAN := false;
    v_seen_orders INT[] := ARRAY[]::INT[];
    
    -- Question iteration variables
    v_q_elem JSONB;
    v_q_order INT;
    v_q_text TEXT;
    v_q_type VARCHAR(30);
    v_q_options JSONB;
    v_q_correct JSONB;
    v_q_points NUMERIC(6, 2);
    v_q_time_limit INT;
    v_q_explanation TEXT;
    
    -- Option checking variables
    v_opt_elem JSONB;
    v_opt_id TEXT;
    v_opt_ids_seen TEXT[];
    v_target_opt_id TEXT;
    
    -- Team iteration variables
    v_team_elem JSONB;
    v_team_name VARCHAR(100);
    v_team_color VARCHAR(30);
BEGIN
    -- 1. Caller Authentication Check
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'UNAUTHORIZED',
            'message', 'Yêu cầu đăng nhập để tạo phòng thi.'
        );
    END IF;

    -- 2. Authorization: Profile Role Check (Teacher or Admin only)
    SELECT role INTO v_role
    FROM public.profiles
    WHERE id = v_caller_id;

    IF v_role IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'PROFILE_NOT_FOUND',
            'message', 'Không tìm thấy hồ sơ người dùng.'
        );
    END IF;

    IF v_role NOT IN ('teacher', 'admin') THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'ROLE_NOT_ALLOWED',
            'message', 'Chỉ tài khoản giáo viên hoặc quản trị viên mới được phép tạo phòng thi.'
        );
    END IF;

    -- 3. Title & Basic Parameters Validation
    v_title := pg_catalog.btrim(COALESCE(p_title, ''));
    IF v_title = '' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_TITLE',
            'message', 'Tiêu đề phòng thi không được để trống.'
        );
    END IF;

    v_mode := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_mode, 'individual')));
    IF v_mode NOT IN ('individual', 'team') THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_MODE',
            'message', 'Chế độ phòng thi không hợp lệ (yêu cầu individual hoặc team).'
        );
    END IF;

    v_max_participants := COALESCE(p_max_participants, 100);
    IF v_max_participants < 1 OR v_max_participants > 1000 THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_MAX_PARTICIPANTS',
            'message', 'Số lượng người tham gia tối đa phải nằm trong khoảng từ 1 đến 1000.'
        );
    END IF;

    -- 4. Question Sequence & Canonical Format Pre-validation
    IF p_questions IS NULL 
       OR pg_catalog.jsonb_typeof(p_questions) <> 'array' 
       OR pg_catalog.jsonb_array_length(p_questions) = 0 THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'NO_QUESTIONS',
            'message', 'Phòng thi yêu cầu ít nhất một câu hỏi.'
        );
    END IF;

    v_q_count := pg_catalog.jsonb_array_length(p_questions);

    FOR v_q_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_questions)
    LOOP
        IF pg_catalog.jsonb_typeof(v_q_elem) <> 'object' THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                'message', 'Cấu trúc câu hỏi phải là một đối tượng JSON hợp lệ.'
            );
        END IF;

        -- Extract and validate question_order (integer, 1..N contiguous)
        IF NOT (v_q_elem ? 'question_order') 
           OR pg_catalog.jsonb_typeof(v_q_elem->'question_order') <> 'number' THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'INVALID_QUESTION_SEQUENCE',
                'message', 'Thứ tự câu hỏi (question_order) không hợp lệ.'
            );
        END IF;

        v_q_order := (v_q_elem->>'question_order')::INT;
        IF v_q_order < 1 OR v_q_order > v_q_count THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'INVALID_QUESTION_SEQUENCE',
                'message', 'Thứ tự câu hỏi phải là dãy liên tục từ 1 đến tổng số câu hỏi.'
            );
        END IF;

        IF v_q_order = ANY(v_seen_orders) THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'INVALID_QUESTION_SEQUENCE',
                'message', 'Thứ tự câu hỏi bị trùng lặp.'
            );
        END IF;
        v_seen_orders := pg_catalog.array_append(v_seen_orders, v_q_order);

        -- Validate question_text
        v_q_text := pg_catalog.btrim(COALESCE(v_q_elem->>'question_text', ''));
        IF v_q_text = '' THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                'message', 'Nội dung câu hỏi không được để trống.'
            );
        END IF;

        -- Validate question_type
        v_q_type := pg_catalog.btrim(COALESCE(v_q_elem->>'question_type', 'single_choice'));
        IF v_q_type NOT IN ('single_choice', 'multiple_choice', 'true_false', 'short_answer') THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                'message', 'Loại câu hỏi không được hỗ trợ.'
            );
        END IF;

        -- Validate points and time_limit
        v_q_points := COALESCE((v_q_elem->>'points')::NUMERIC, 10.00);
        IF v_q_points < 0.00 THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                'message', 'Điểm số của câu hỏi không được âm.'
            );
        END IF;

        v_q_time_limit := COALESCE((v_q_elem->>'time_limit_seconds')::INT, 30);
        IF v_q_time_limit < 5 OR v_q_time_limit > 600 THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                'message', 'Thời gian làm bài mỗi câu phải từ 5 đến 600 giây.'
            );
        END IF;

        -- Canonical Options & Correct Answer Validation
        CASE v_q_type
            WHEN 'single_choice' THEN
                IF NOT (v_q_elem ? 'options') 
                   OR pg_catalog.jsonb_typeof(v_q_elem->'options') <> 'array'
                   OR pg_catalog.jsonb_array_length(v_q_elem->'options') < 2 THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                        'message', 'Câu hỏi một lựa chọn yêu cầu ít nhất 2 phương án.'
                    );
                END IF;

                IF NOT (v_q_elem ? 'correct_answer')
                   OR pg_catalog.jsonb_typeof(v_q_elem->'correct_answer') <> 'object'
                   OR NOT (v_q_elem->'correct_answer' ? 'option_id')
                   OR v_q_elem->'correct_answer'->>'option_id' IS NULL
                   OR pg_catalog.btrim(v_q_elem->'correct_answer'->>'option_id') = '' THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                        'message', 'Đáp án đúng câu hỏi một lựa chọn không hợp lệ theo chuẩn canonical.'
                    );
                END IF;

                v_target_opt_id := v_q_elem->'correct_answer'->>'option_id';
                v_opt_ids_seen := ARRAY[]::TEXT[];
                FOR v_opt_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(v_q_elem->'options')
                LOOP
                    IF pg_catalog.jsonb_typeof(v_opt_elem) <> 'object' 
                       OR NOT (v_opt_elem ? 'id') 
                       OR pg_catalog.btrim(COALESCE(v_opt_elem->>'id', '')) = '' THEN
                        RETURN pg_catalog.jsonb_build_object(
                            'success', false,
                            'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                            'message', 'Mỗi lựa chọn phải có định danh id hợp lệ.'
                        );
                    END IF;
                    v_opt_ids_seen := pg_catalog.array_append(v_opt_ids_seen, v_opt_elem->>'id');
                END LOOP;

                IF NOT (v_target_opt_id = ANY(v_opt_ids_seen)) THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                        'message', 'Đáp án đúng không tồn tại trong danh sách lựa chọn.'
                    );
                END IF;

            WHEN 'multiple_choice' THEN
                IF NOT (v_q_elem ? 'options') 
                   OR pg_catalog.jsonb_typeof(v_q_elem->'options') <> 'array'
                   OR pg_catalog.jsonb_array_length(v_q_elem->'options') < 2 THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                        'message', 'Câu hỏi nhiều lựa chọn yêu cầu ít nhất 2 phương án.'
                    );
                END IF;

                IF NOT (v_q_elem ? 'correct_answer')
                   OR pg_catalog.jsonb_typeof(v_q_elem->'correct_answer') <> 'object'
                   OR NOT (v_q_elem->'correct_answer' ? 'option_ids')
                   OR pg_catalog.jsonb_typeof(v_q_elem->'correct_answer'->'option_ids') <> 'array'
                   OR pg_catalog.jsonb_array_length(v_q_elem->'correct_answer'->'option_ids') < 1 THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                        'message', 'Đáp án đúng câu hỏi nhiều lựa chọn không hợp lệ theo chuẩn canonical.'
                    );
                END IF;

                v_opt_ids_seen := ARRAY[]::TEXT[];
                FOR v_opt_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(v_q_elem->'options')
                LOOP
                    IF pg_catalog.jsonb_typeof(v_opt_elem) <> 'object' 
                       OR NOT (v_opt_elem ? 'id') 
                       OR pg_catalog.btrim(COALESCE(v_opt_elem->>'id', '')) = '' THEN
                        RETURN pg_catalog.jsonb_build_object(
                            'success', false,
                            'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                            'message', 'Mỗi lựa chọn phải có định danh id hợp lệ.'
                        );
                    END IF;
                    v_opt_ids_seen := pg_catalog.array_append(v_opt_ids_seen, v_opt_elem->>'id');
                END LOOP;

                FOR v_opt_id IN SELECT * FROM pg_catalog.jsonb_array_elements_text(v_q_elem->'correct_answer'->'option_ids')
                LOOP
                    IF NOT (v_opt_id = ANY(v_opt_ids_seen)) THEN
                        RETURN pg_catalog.jsonb_build_object(
                            'success', false,
                            'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                            'message', 'Một trong các đáp án đúng không tồn tại trong danh sách lựa chọn.'
                        );
                    END IF;
                END LOOP;

            WHEN 'true_false' THEN
                IF NOT (v_q_elem ? 'options') 
                   OR pg_catalog.jsonb_typeof(v_q_elem->'options') <> 'array'
                   OR pg_catalog.jsonb_array_length(v_q_elem->'options') <> 2 THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                        'message', 'Câu hỏi đúng/sai yêu cầu chính xác 2 lựa chọn.'
                    );
                END IF;

                IF NOT (v_q_elem ? 'correct_answer')
                   OR pg_catalog.jsonb_typeof(v_q_elem->'correct_answer') <> 'object'
                   OR NOT (v_q_elem->'correct_answer' ? 'option_id')
                   OR v_q_elem->'correct_answer'->>'option_id' NOT IN ('true', 'false') THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                        'message', 'Đáp án đúng câu hỏi đúng/sai phải là true hoặc false.'
                    );
                END IF;

            WHEN 'short_answer' THEN
                IF NOT (v_q_elem ? 'correct_answer')
                   OR pg_catalog.jsonb_typeof(v_q_elem->'correct_answer') <> 'object'
                   OR NOT (v_q_elem->'correct_answer' ? 'accepted_answers')
                   OR pg_catalog.jsonb_typeof(v_q_elem->'correct_answer'->'accepted_answers') <> 'array'
                   OR pg_catalog.jsonb_array_length(v_q_elem->'correct_answer'->'accepted_answers') < 1 THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                        'message', 'Đáp án đúng câu hỏi trả lời ngắn yêu cầu ít nhất một đáp án được chấp nhận.'
                    );
                END IF;
        END CASE;
    END LOOP;

    -- Verify no gaps in question order (must have all 1..v_q_count)
    IF pg_catalog.cardinality(v_seen_orders) <> v_q_count THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_QUESTION_SEQUENCE',
            'message', 'Dãy thứ tự câu hỏi bị ngắt quãng.'
        );
    END IF;

    -- 5. Team validation if mode = team
    IF v_mode = 'team' THEN
        IF p_teams IS NOT NULL AND pg_catalog.jsonb_typeof(p_teams) = 'array' THEN
            FOR v_team_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_teams)
            LOOP
                IF pg_catalog.jsonb_typeof(v_team_elem) <> 'object' 
                   OR NOT (v_team_elem ? 'team_name') 
                   OR pg_catalog.btrim(COALESCE(v_team_elem->>'team_name', '')) = '' THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'MALFORMED_TEAM_PAYLOAD',
                        'message', 'Thông tin đội thi không hợp lệ.'
                    );
                END IF;
            END LOOP;
        END IF;
    END IF;

    -- 6. Server-side Room Code Generation with Bounded Retry
    WHILE v_code_attempt < 10 AND NOT v_code_found LOOP
        v_code_attempt := v_code_attempt + 1;
        v_room_code := '';
        FOR i IN 1..6 LOOP
            v_rand_idx := 1 + (pg_catalog.floor(random() * 32)::INT);
            v_room_code := v_room_code || pg_catalog.substr(v_alphabet, v_rand_idx, 1);
        END LOOP;

        IF NOT EXISTS (
            SELECT 1 FROM public.competition_sessions
            WHERE room_code = v_room_code AND status IN ('waiting', 'in_progress', 'paused')
        ) THEN
            v_code_found := true;
        END IF;
    END LOOP;

    IF NOT v_code_found THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'ROOM_CODE_GENERATION_FAILED',
            'message', 'Không thể khởi tạo mã phòng thi ngẫu nhiên. Vui lòng thử lại.'
        );
    END IF;

    -- 7. Atomic Insert of Session Row
    BEGIN
        INSERT INTO public.competition_sessions (
            host_id,
            room_code,
            title,
            description,
            mode,
            status,
            max_participants,
            current_question_index,
            current_question_id,
            question_deadline,
            paused_remaining_ms,
            reward_enabled,
            reward_config,
            reward_status,
            started_at,
            ended_at,
            created_at,
            updated_at
        ) VALUES (
            v_caller_id,
            v_room_code,
            v_title,
            NULLIF(pg_catalog.btrim(COALESCE(p_description, '')), ''),
            v_mode,
            'waiting',
            v_max_participants,
            0,
            NULL,
            NULL,
            NULL,
            COALESCE(p_reward_enabled, false),
            COALESCE(p_reward_config, '{}'::jsonb),
            'not_applicable',
            NULL,
            NULL,
            pg_catalog.now(),
            pg_catalog.now()
        ) RETURNING id INTO v_session_id;
    EXCEPTION
        WHEN unique_violation THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'ROOM_CODE_GENERATION_FAILED',
                'message', 'Mã phòng thi bị trùng lặp trong phiên đồng thời. Vui lòng thử lại.'
            );
    END;

    -- 8. Atomic Insert of Questions
    FOR v_q_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_questions)
    LOOP
        v_q_order := (v_q_elem->>'question_order')::INT;
        v_q_text := pg_catalog.btrim(v_q_elem->>'question_text');
        v_q_type := pg_catalog.btrim(COALESCE(v_q_elem->>'question_type', 'single_choice'));
        v_q_options := COALESCE(v_q_elem->'options', '[]'::jsonb);
        v_q_correct := v_q_elem->'correct_answer';
        v_q_points := COALESCE((v_q_elem->>'points')::NUMERIC, 10.00);
        v_q_time_limit := COALESCE((v_q_elem->>'time_limit_seconds')::INT, 30);
        v_q_explanation := NULLIF(pg_catalog.btrim(COALESCE(v_q_elem->>'explanation', '')), '');

        INSERT INTO public.competition_questions (
            session_id,
            question_order,
            question_text,
            question_type,
            options,
            correct_answer,
            points,
            time_limit_seconds,
            explanation,
            created_at
        ) VALUES (
            v_session_id,
            v_q_order,
            v_q_text,
            v_q_type,
            v_q_options,
            v_q_correct,
            v_q_points,
            v_q_time_limit,
            v_q_explanation,
            pg_catalog.now()
        );
    END LOOP;

    -- 9. Atomic Insert of Teams (if mode = team)
    IF v_mode = 'team' AND p_teams IS NOT NULL AND pg_catalog.jsonb_typeof(p_teams) = 'array' THEN
        FOR v_team_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_teams)
        LOOP
            v_team_name := pg_catalog.btrim(v_team_elem->>'team_name');
            v_team_color := NULLIF(pg_catalog.btrim(COALESCE(v_team_elem->>'team_color', '')), '');

            INSERT INTO public.competition_teams (
                session_id,
                team_name,
                team_color,
                created_at
            ) VALUES (
                v_session_id,
                v_team_name,
                v_team_color,
                pg_catalog.now()
            );
        END LOOP;
    END IF;

    -- 10. Return Structured Sanitized Success Payload
    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'session', pg_catalog.jsonb_build_object(
            'id', v_session_id,
            'host_id', v_caller_id,
            'room_code', v_room_code,
            'title', v_title,
            'description', NULLIF(pg_catalog.btrim(COALESCE(p_description, '')), ''),
            'mode', v_mode,
            'status', 'waiting',
            'max_participants', v_max_participants,
            'current_question_index', 0,
            'question_count', v_q_count,
            'reward_enabled', COALESCE(p_reward_enabled, false),
            'created_at', pg_catalog.now()
        )
    );
END;
$$;

-- 12.2 competition_host_start_session
CREATE OR REPLACE FUNCTION public.competition_host_start_session(
    p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_session RECORD;
    v_first_question RECORD;
    v_transition_time TIMESTAMPTZ;
    v_deadline TIMESTAMPTZ;
BEGIN
    -- 1. Caller Authentication Check
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'UNAUTHORIZED',
            'message', 'Yêu cầu đăng nhập để bắt đầu phòng thi.'
        );
    END IF;

    IF p_session_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_ID',
            'message', 'ID phòng thi không được để trống.'
        );
    END IF;

    -- 2. Lock Session Row FOR UPDATE
    SELECT id, host_id, status, current_question_index, current_question_id, started_at, ended_at
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

    -- 3. Host Ownership Check
    IF v_session.host_id <> v_caller_id THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'NOT_SESSION_HOST',
            'message', 'Chỉ người tạo phòng thi (host) mới có quyền bắt đầu phòng thi.'
        );
    END IF;

    -- 4. Lifecycle State Check
    IF v_session.status = 'in_progress' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_ALREADY_STARTED',
            'message', 'Phòng thi đã ở trạng thái đang diễn ra.'
        );
    ELSIF v_session.status = 'paused' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_PAUSED',
            'message', 'Phòng thi đang tạm dừng, vui lòng sử dụng lệnh tiếp tục (resume).'
        );
    ELSIF v_session.status IN ('finished', 'cancelled') THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_CLOSED',
            'message', 'Phòng thi đã kết thúc hoặc đã bị hủy.'
        );
    ELSIF v_session.status <> 'waiting' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_STATE',
            'message', 'Trạng thái phòng thi không hợp lệ để bắt đầu.'
        );
    END IF;

    -- 5. Load First Question (question_order = 1)
    SELECT id, question_order, question_text, question_type, options, points, time_limit_seconds
    INTO v_first_question
    FROM public.competition_questions
    WHERE session_id = p_session_id AND question_order = 1;

    IF v_first_question.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'NO_QUESTIONS',
            'message', 'Phòng thi chưa có câu hỏi nào để bắt đầu.'
        );
    END IF;

    -- 6. Transition Timing Captured AFTER Row Lock
    v_transition_time := pg_catalog.clock_timestamp();
    v_deadline := v_transition_time + (v_first_question.time_limit_seconds * interval '1 second');

    -- 7. Update Session State
    UPDATE public.competition_sessions
    SET status = 'in_progress',
       started_at = v_transition_time,
       current_question_index = 1,
       current_question_id = v_first_question.id,
       question_deadline = v_deadline,
       paused_remaining_ms = NULL,
       updated_at = v_transition_time
    WHERE id = p_session_id;

    -- 8. Return Sanitized Success Payload
    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'session_id', p_session_id,
        'status', 'in_progress',
        'started_at', v_transition_time,
        'current_question_index', 1,
        'current_question_id', v_first_question.id,
        'question_deadline', v_deadline,
        'current_question', pg_catalog.jsonb_build_object(
            'id', v_first_question.id,
            'question_order', v_first_question.question_order,
            'question_text', v_first_question.question_text,
            'question_type', v_first_question.question_type,
            'options', v_first_question.options,
            'points', v_first_question.points,
            'time_limit_seconds', v_first_question.time_limit_seconds
        )
    );
END;
$$;

-- 12.3 competition_host_next_question
CREATE OR REPLACE FUNCTION public.competition_host_next_question(
    p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_session RECORD;
    v_next_order INT;
    v_next_question RECORD;
    v_transition_time TIMESTAMPTZ;
    v_deadline TIMESTAMPTZ;
BEGIN
    -- 1. Caller Authentication Check
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'UNAUTHORIZED',
            'message', 'Yêu cầu đăng nhập để chuyển câu hỏi.'
        );
    END IF;

    IF p_session_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_ID',
            'message', 'ID phòng thi không được để trống.'
        );
    END IF;

    -- 2. Lock Session Row FOR UPDATE
    SELECT id, host_id, status, current_question_index, current_question_id
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

    -- 3. Host Ownership Check
    IF v_session.host_id <> v_caller_id THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'NOT_SESSION_HOST',
            'message', 'Chỉ người tạo phòng thi (host) mới có quyền chuyển câu hỏi.'
        );
    END IF;

    -- 4. State Check
    IF v_session.status <> 'in_progress' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_STATE',
            'message', 'Phòng thi phải ở trạng thái đang diễn ra (in_progress) để chuyển câu hỏi.'
        );
    END IF;

    -- 5. Load Next Question (current_question_index + 1)
    v_next_order := v_session.current_question_index + 1;

    SELECT id, question_order, question_text, question_type, options, points, time_limit_seconds
    INTO v_next_question
    FROM public.competition_questions
    WHERE session_id = p_session_id AND question_order = v_next_order;

    IF v_next_question.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'NO_MORE_QUESTIONS',
            'message', 'Đã là câu hỏi cuối cùng của phòng thi.'
        );
    END IF;

    -- 6. Transition Timing Captured AFTER Row Lock
    v_transition_time := pg_catalog.clock_timestamp();
    v_deadline := v_transition_time + (v_next_question.time_limit_seconds * interval '1 second');

    -- 7. Update Session State
    UPDATE public.competition_sessions
    SET current_question_index = v_next_order,
        current_question_id = v_next_question.id,
        question_deadline = v_deadline,
        paused_remaining_ms = NULL,
        updated_at = v_transition_time
    WHERE id = p_session_id;

    -- 8. Return Sanitized Success Payload
    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'session_id', p_session_id,
        'status', 'in_progress',
        'current_question_index', v_next_order,
        'current_question_id', v_next_question.id,
        'question_deadline', v_deadline,
        'current_question', pg_catalog.jsonb_build_object(
            'id', v_next_question.id,
            'question_order', v_next_question.question_order,
            'question_text', v_next_question.question_text,
            'question_type', v_next_question.question_type,
            'options', v_next_question.options,
            'points', v_next_question.points,
            'time_limit_seconds', v_next_question.time_limit_seconds
        )
    );
END;
$$;

-- 12.4 competition_host_pause_session
CREATE OR REPLACE FUNCTION public.competition_host_pause_session(
    p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_session RECORD;
    v_transition_time TIMESTAMPTZ;
    v_remaining_ms BIGINT;
BEGIN
    -- 1. Caller Authentication Check
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'UNAUTHORIZED',
            'message', 'Yêu cầu đăng nhập để tạm dừng phòng thi.'
        );
    END IF;

    IF p_session_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_ID',
            'message', 'ID phòng thi không được để trống.'
        );
    END IF;

    -- 2. Lock Session Row FOR UPDATE
    SELECT id, host_id, status, current_question_id, question_deadline
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

    -- 3. Host Ownership Check
    IF v_session.host_id <> v_caller_id THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'NOT_SESSION_HOST',
            'message', 'Chỉ người tạo phòng thi (host) mới có quyền tạm dừng phòng thi.'
        );
    END IF;

    -- 4. State Check
    IF v_session.status = 'paused' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_ALREADY_PAUSED',
            'message', 'Phòng thi đã ở trạng thái tạm dừng.'
        );
    ELSIF v_session.status = 'waiting' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_NOT_STARTED',
            'message', 'Phòng thi chưa bắt đầu, không thể tạm dừng.'
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
            'error_code', 'INVALID_SESSION_STATE',
            'message', 'Trạng thái phòng thi không hợp lệ để tạm dừng.'
        );
    END IF;

    IF v_session.current_question_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'NO_ACTIVE_QUESTION',
            'message', 'Không có câu hỏi đang hoạt động để tạm dừng.'
        );
    END IF;

    -- 5. Compute Remaining Time Captured AFTER Lock
    v_transition_time := pg_catalog.clock_timestamp();
    IF v_session.question_deadline IS NOT NULL AND v_session.question_deadline > v_transition_time THEN
        v_remaining_ms := pg_catalog.round(EXTRACT(EPOCH FROM (v_session.question_deadline - v_transition_time)) * 1000)::BIGINT;
    ELSE
        v_remaining_ms := 0;
    END IF;

    -- 6. Update Session State
    UPDATE public.competition_sessions
    SET status = 'paused',
        paused_remaining_ms = v_remaining_ms,
        question_deadline = NULL,
        updated_at = v_transition_time
    WHERE id = p_session_id;

    -- 7. Return Structured Success Result
    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'session_id', p_session_id,
        'status', 'paused',
        'paused_remaining_ms', v_remaining_ms
    );
END;
$$;

-- 12.5 competition_host_resume_session
CREATE OR REPLACE FUNCTION public.competition_host_resume_session(
    p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_session RECORD;
    v_transition_time TIMESTAMPTZ;
    v_deadline TIMESTAMPTZ;
    v_remaining_ms BIGINT;
BEGIN
    -- 1. Caller Authentication Check
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'UNAUTHORIZED',
            'message', 'Yêu cầu đăng nhập để tiếp tục phòng thi.'
        );
    END IF;

    IF p_session_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_ID',
            'message', 'ID phòng thi không được để trống.'
        );
    END IF;

    -- 2. Lock Session Row FOR UPDATE
    SELECT id, host_id, status, current_question_id, paused_remaining_ms
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

    -- 3. Host Ownership Check
    IF v_session.host_id <> v_caller_id THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'NOT_SESSION_HOST',
            'message', 'Chỉ người tạo phòng thi (host) mới có quyền tiếp tục phòng thi.'
        );
    END IF;

    -- 4. State Check
    IF v_session.status <> 'paused' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_NOT_PAUSED',
            'message', 'Phòng thi không ở trạng thái tạm dừng (paused) để tiếp tục.'
        );
    END IF;

    IF v_session.current_question_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'NO_ACTIVE_QUESTION',
            'message', 'Không có câu hỏi đang hoạt động để tiếp tục.'
        );
    END IF;

    -- 5. Reconstruct Deadline Captured AFTER Lock
    v_transition_time := pg_catalog.clock_timestamp();
    v_remaining_ms := COALESCE(v_session.paused_remaining_ms, 0);
    v_deadline := v_transition_time + (v_remaining_ms * interval '1 millisecond');

    -- 6. Update Session State
    UPDATE public.competition_sessions
    SET status = 'in_progress',
        question_deadline = v_deadline,
        paused_remaining_ms = NULL,
        updated_at = v_transition_time
    WHERE id = p_session_id;

    -- 7. Return Structured Success Result
    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'session_id', p_session_id,
        'status', 'in_progress',
        'question_deadline', v_deadline
    );
END;
$$;

-- 12.6 competition_host_cancel_session
CREATE OR REPLACE FUNCTION public.competition_host_cancel_session(
    p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_session RECORD;
    v_transition_time TIMESTAMPTZ;
BEGIN
    -- 1. Caller Authentication Check
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'UNAUTHORIZED',
            'message', 'Yêu cầu đăng nhập để hủy phòng thi.'
        );
    END IF;

    IF p_session_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_ID',
            'message', 'ID phòng thi không được để trống.'
        );
    END IF;

    -- 2. Lock Session Row FOR UPDATE
    SELECT id, host_id, status
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

    -- 3. Host Ownership Check
    IF v_session.host_id <> v_caller_id THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'NOT_SESSION_HOST',
            'message', 'Chỉ người tạo phòng thi (host) mới có quyền hủy phòng thi.'
        );
    END IF;

    -- 4. State Check
    IF v_session.status = 'finished' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_ALREADY_FINISHED',
            'message', 'Phòng thi đã kết thúc, không thể hủy.'
        );
    ELSIF v_session.status = 'cancelled' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_ALREADY_CANCELLED',
            'message', 'Phòng thi đã bị hủy trước đó.'
        );
    ELSIF v_session.status NOT IN ('waiting', 'in_progress', 'paused') THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_STATE',
            'message', 'Trạng thái phòng thi không hợp lệ để hủy.'
        );
    END IF;

    -- 5. Transition Timing Captured AFTER Lock
    v_transition_time := pg_catalog.clock_timestamp();

    -- 6. Update Session State to Cancelled (Zero Score / Rank Mutation)
    UPDATE public.competition_sessions
    SET status = 'cancelled',
        ended_at = v_transition_time,
        current_question_id = NULL,
        question_deadline = NULL,
        paused_remaining_ms = NULL,
        updated_at = v_transition_time
    WHERE id = p_session_id;

    -- 7. Return Structured Success Result
    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'session_id', p_session_id,
        'status', 'cancelled',
        'ended_at', v_transition_time
    );
END;
$$;

-- 12.7 competition_host_finish_session
CREATE OR REPLACE FUNCTION public.competition_host_finish_session(
    p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RETURN private.competition_finish_session_internal(
        p_session_id := p_session_id
    );
END;
$$;

-- ------------------------------------------------------------
-- 13. PUBLIC HOST RPC PRIVILEGES (PHASE 2D-2)
-- ------------------------------------------------------------
-- Revoke all execute rights from PUBLIC
REVOKE EXECUTE ON FUNCTION public.competition_host_create_session(TEXT, TEXT, TEXT, INT, JSONB, JSONB, BOOLEAN, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.competition_host_start_session(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.competition_host_next_question(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.competition_host_pause_session(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.competition_host_resume_session(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.competition_host_cancel_session(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.competition_host_finish_session(UUID) FROM PUBLIC;

-- Grant EXECUTE to authenticated only (NEVER anon)
GRANT EXECUTE ON FUNCTION public.competition_host_create_session(TEXT, TEXT, TEXT, INT, JSONB, JSONB, BOOLEAN, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.competition_host_start_session(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.competition_host_next_question(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.competition_host_pause_session(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.competition_host_resume_session(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.competition_host_cancel_session(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.competition_host_finish_session(UUID) TO authenticated;




