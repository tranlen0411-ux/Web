-- ============================================================
-- TEST / EXAM BUILDER V1
-- PHASE 2D: TAB-SWITCH & INTEGRITY AUDIT RPC
-- TARGET_PROJECT_REF: szptvqkoiphrhlionfoh
-- FORBIDDEN_CORE_REF: nddimmxpymipalpxlops
-- ============================================================
-- PURPOSE:
-- Implements Phase 2D atomic integrity telemetry RPC:
-- public.rpc_exam_record_integrity_event:
--   - Records student tab-switch / focus-loss events
--   - Manages leave episode lifecycle (episode_opened, episode_closed, focus_loss_auxiliary)
--   - Enforces version tab_switch_policy (OFF, WARN_ONLY, WARN_AND_LOG)
--   - Maintains exam_attempts.tab_switch_count and active_leave_episode_id
--
-- SECURITY & ISOLATION:
-- - SECURITY DEFINER function owned by postgres.
-- - SET search_path = public, app_private.
-- - EXECUTE revoked from PUBLIC, anon, authenticated.
-- - EXECUTE granted exclusively to service_role (invoked via Exam BFF Edge Function).
-- - Row lock on exam_attempts ensures concurrency safety and idempotency.
-- - Telemetry only: Absolutely no automatic submit, grade deduction, score mutation, or punishment.
-- ============================================================

BEGIN;

-- Conservative timeout protections
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ------------------------------------------------------------
-- 1. rpc_exam_record_integrity_event
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_exam_record_integrity_event(
    p_caller_id UUID,
    p_attempt_id UUID,
    p_source TEXT,
    p_client_timestamp TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private
AS $$
DECLARE
    v_attempt_rec RECORD;
    v_episode_id UUID;
    v_closing_episode_id UUID;
    v_inserted_rows INT := 0;
    v_current_count INT;
    v_current_active_episode UUID;
    v_event_recorded BOOLEAN := false;
    v_event_type VARCHAR(30) := NULL;
    v_idempotent_replay BOOLEAN := false;
BEGIN
    -- 1. Required parameters check
    IF p_caller_id IS NULL OR p_attempt_id IS NULL OR p_source IS NULL THEN
        RAISE EXCEPTION 'ERR_REQUIRED_PARAMS: caller_id, attempt_id, and source are required' USING ERRCODE = '22000';
    END IF;

    -- 2. Validate allowed source values
    IF p_source NOT IN ('page_hidden', 'page_visible', 'window_focus', 'window_blur') THEN
        RAISE EXCEPTION 'ERR_INVALID_EVENT_SOURCE: Invalid event source %', p_source USING ERRCODE = '22000';
    END IF;

    -- 3. Lock target attempt FOR UPDATE of attempt table (serializes concurrent integrity calls)
    SELECT 
        a.id,
        a.assignment_id,
        a.exam_version_id,
        a.student_id,
        a.status,
        a.tab_switch_count,
        a.active_leave_episode_id,
        a.expires_at,
        v.tab_switch_policy
    INTO v_attempt_rec
    FROM public.exam_attempts a
    JOIN public.exam_versions v ON a.exam_version_id = v.id
    WHERE a.id = p_attempt_id
    FOR UPDATE OF a;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_ATTEMPT_NOT_FOUND: Attempt % does not exist', p_attempt_id USING ERRCODE = 'P0002';
    END IF;

    -- 4. Student identity invariant (Caller must be attempt owner)
    IF v_attempt_rec.student_id <> p_caller_id THEN
        RAISE EXCEPTION 'ERR_STUDENT_IDENTITY_MISMATCH: Caller % is not attempt student %', p_caller_id, v_attempt_rec.student_id USING ERRCODE = '42501';
    END IF;

    -- 5. Attempt status invariant (Must be draft)
    IF v_attempt_rec.status <> 'draft' THEN
        RAISE EXCEPTION 'ERR_ATTEMPT_NOT_DRAFT: Cannot record integrity events for non-draft attempt (status: %)', v_attempt_rec.status USING ERRCODE = '22000';
    END IF;

    -- 6. Expiration check
    IF v_attempt_rec.expires_at IS NOT NULL AND clock_timestamp() >= v_attempt_rec.expires_at THEN
        RAISE EXCEPTION 'ERR_ATTEMPT_EXPIRED: Attempt expired at %', v_attempt_rec.expires_at USING ERRCODE = '22000';
    END IF;

    -- 7. Policy-based handling
    IF v_attempt_rec.tab_switch_policy = 'OFF' OR v_attempt_rec.tab_switch_policy = 'WARN_ONLY' THEN
        -- Telemetry disabled or client warning only: no DB state mutation
        RETURN jsonb_build_object(
            'attempt_id', v_attempt_rec.id,
            'tab_switch_policy', v_attempt_rec.tab_switch_policy,
            'tab_switch_count', v_attempt_rec.tab_switch_count,
            'active_leave_episode_id', v_attempt_rec.active_leave_episode_id,
            'event_recorded', false,
            'event_type', NULL,
            'idempotent_replay', false
        );
    ELSIF v_attempt_rec.tab_switch_policy = 'WARN_AND_LOG' THEN
        -- Case A: page_hidden -> Open Leave Episode
        IF p_source = 'page_hidden' THEN
            IF v_attempt_rec.active_leave_episode_id IS NULL THEN
                v_episode_id := gen_random_uuid();
                
                INSERT INTO public.exam_audit_events (
                    attempt_id,
                    episode_id,
                    event_type,
                    signal_source,
                    client_timestamp,
                    metadata
                ) VALUES (
                    v_attempt_rec.id,
                    v_episode_id,
                    'episode_opened',
                    'page_hidden',
                    p_client_timestamp,
                    '{}'::jsonb
                );

                UPDATE public.exam_attempts
                SET 
                    tab_switch_count = tab_switch_count + 1,
                    active_leave_episode_id = v_episode_id,
                    updated_at = NOW()
                WHERE id = v_attempt_rec.id
                RETURNING tab_switch_count, active_leave_episode_id INTO v_current_count, v_current_active_episode;

                v_event_recorded := true;
                v_event_type := 'episode_opened';
                v_idempotent_replay := false;
            ELSE
                -- Already in an active episode: idempotent replay
                v_current_count := v_attempt_rec.tab_switch_count;
                v_current_active_episode := v_attempt_rec.active_leave_episode_id;
                v_event_recorded := false;
                v_event_type := 'episode_opened';
                v_idempotent_replay := true;
            END IF;

        -- Case B: page_visible / window_focus -> Close Active Leave Episode
        ELSIF p_source IN ('page_visible', 'window_focus') THEN
            IF v_attempt_rec.active_leave_episode_id IS NOT NULL THEN
                v_closing_episode_id := v_attempt_rec.active_leave_episode_id;

                INSERT INTO public.exam_audit_events (
                    attempt_id,
                    episode_id,
                    event_type,
                    signal_source,
                    client_timestamp,
                    metadata
                ) VALUES (
                    v_attempt_rec.id,
                    v_closing_episode_id,
                    'episode_closed',
                    p_source,
                    p_client_timestamp,
                    '{}'::jsonb
                )
                ON CONFLICT (attempt_id, episode_id, event_type) DO NOTHING;

                GET DIAGNOSTICS v_inserted_rows = ROW_COUNT;

                UPDATE public.exam_attempts
                SET 
                    active_leave_episode_id = NULL,
                    updated_at = NOW()
                WHERE id = v_attempt_rec.id
                RETURNING tab_switch_count, active_leave_episode_id INTO v_current_count, v_current_active_episode;

                IF v_inserted_rows > 0 THEN
                    v_event_recorded := true;
                    v_event_type := 'episode_closed';
                    v_idempotent_replay := false;
                ELSE
                    v_event_recorded := false;
                    v_event_type := 'episode_closed';
                    v_idempotent_replay := true;
                END IF;
            ELSE
                -- No active episode: idempotent replay
                v_current_count := v_attempt_rec.tab_switch_count;
                v_current_active_episode := NULL;
                v_event_recorded := false;
                v_event_type := 'episode_closed';
                v_idempotent_replay := true;
            END IF;

        -- Case C: window_blur -> Auxiliary focus loss event
        ELSIF p_source = 'window_blur' THEN
            INSERT INTO public.exam_audit_events (
                attempt_id,
                episode_id,
                event_type,
                signal_source,
                client_timestamp,
                metadata
            ) VALUES (
                v_attempt_rec.id,
                NULL,
                'focus_loss_auxiliary',
                'window_blur',
                p_client_timestamp,
                '{}'::jsonb
            );

            v_current_count := v_attempt_rec.tab_switch_count;
            v_current_active_episode := v_attempt_rec.active_leave_episode_id;
            v_event_recorded := true;
            v_event_type := 'focus_loss_auxiliary';
            v_idempotent_replay := false;
        END IF;

        RETURN jsonb_build_object(
            'attempt_id', v_attempt_rec.id,
            'tab_switch_policy', v_attempt_rec.tab_switch_policy,
            'tab_switch_count', v_current_count,
            'active_leave_episode_id', v_current_active_episode,
            'event_recorded', v_event_recorded,
            'event_type', v_event_type,
            'idempotent_replay', v_idempotent_replay
        );
    ELSE
        RAISE EXCEPTION 'ERR_INVALID_TAB_SWITCH_POLICY: Unknown tab switch policy %', v_attempt_rec.tab_switch_policy USING ERRCODE = '22000';
    END IF;
END;
$$;

-- ------------------------------------------------------------
-- 2. PRIVILEGES AND ACL HARDENING
-- ------------------------------------------------------------
ALTER FUNCTION public.rpc_exam_record_integrity_event(UUID, UUID, TEXT, TIMESTAMPTZ) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.rpc_exam_record_integrity_event(UUID, UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_exam_record_integrity_event(UUID, UUID, TEXT, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_exam_record_integrity_event(UUID, UUID, TEXT, TIMESTAMPTZ) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_exam_record_integrity_event(UUID, UUID, TEXT, TIMESTAMPTZ) TO service_role;

COMMIT;
