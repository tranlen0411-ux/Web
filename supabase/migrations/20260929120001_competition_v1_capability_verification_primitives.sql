-- Migration 3C-B: Competition V1 Capability Verification Primitives
-- Purpose: Backend verification RPCs for Capability JWT issuer (Guest & Authenticated)
-- and update Realtime authorization helper to support valid authenticated participants under role=competition_guest.
-- Security: SECURITY DEFINER, SET search_path = '', strict service_role ACL for verifiers, competition_guest ACL for helper.

-- ============================================================================
-- 1. BACKEND GUEST CAPABILITY VERIFIER RPC
-- ============================================================================
CREATE OR REPLACE FUNCTION public.competition_verify_guest_capability_credentials(
  p_session_id uuid,
  p_participant_id uuid,
  p_guest_token text
)
RETURNS TABLE (
  is_valid boolean,
  error_code text,
  participant_status text,
  session_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_guest_token_trimmed text;
  v_computed_hash varchar(64);
  v_session record;
  v_participant record;
BEGIN
  -- 1. Input Null & Format Checks
  IF p_session_id IS NULL OR p_participant_id IS NULL OR p_guest_token IS NULL THEN
    RETURN QUERY SELECT false, 'INVALID_INPUT'::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  v_guest_token_trimmed := pg_catalog.btrim(p_guest_token);
  IF pg_catalog.length(v_guest_token_trimmed) < 32 THEN
    RETURN QUERY SELECT false, 'INVALID_GUEST_TOKEN'::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- 2. Verify Session Existence & Lifecycle
  SELECT cs.id, cs.status
  INTO v_session
  FROM public.competition_sessions cs
  WHERE cs.id = p_session_id;

  IF v_session.id IS NULL THEN
    RETURN QUERY SELECT false, 'SESSION_NOT_FOUND'::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF v_session.status NOT IN ('waiting', 'in_progress', 'paused') THEN
    RETURN QUERY SELECT false, 'SESSION_CLOSED'::text, NULL::text, v_session.status::text;
    RETURN;
  END IF;

  -- 3. Verify Participant Existence, Relation & Status
  SELECT cp.id, cp.session_id, cp.is_guest, cp.user_id, cp.guest_token_hash, cp.status
  INTO v_participant
  FROM public.competition_participants cp
  WHERE cp.id = p_participant_id
    AND cp.session_id = p_session_id;

  IF v_participant.id IS NULL THEN
    RETURN QUERY SELECT false, 'PARTICIPANT_NOT_FOUND'::text, NULL::text, v_session.status::text;
    RETURN;
  END IF;

  -- Reject if not a guest or if user_id is present
  IF v_participant.is_guest IS NOT TRUE OR v_participant.user_id IS NOT NULL OR v_participant.guest_token_hash IS NULL THEN
    RETURN QUERY SELECT false, 'NOT_A_GUEST_PARTICIPANT'::text, v_participant.status::text, v_session.status::text;
    RETURN;
  END IF;

  -- Check Participant Lifecycle Status
  IF v_participant.status = 'kicked' THEN
    RETURN QUERY SELECT false, 'PARTICIPANT_KICKED'::text, v_participant.status::text, v_session.status::text;
    RETURN;
  END IF;

  IF v_participant.status = 'disconnected' THEN
    RETURN QUERY SELECT false, 'PARTICIPANT_DISCONNECTED'::text, v_participant.status::text, v_session.status::text;
    RETURN;
  END IF;

  IF v_participant.status NOT IN ('joined', 'active', 'submitted') THEN
    RETURN QUERY SELECT false, 'PARTICIPANT_STATUS_INVALID'::text, v_participant.status::text, v_session.status::text;
    RETURN;
  END IF;

  -- 4. Verify Cryptographic Guest Token Hash
  v_computed_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_guest_token_trimmed, 'UTF8'), 'sha256'),
    'hex'
  );

  IF v_participant.guest_token_hash IS DISTINCT FROM v_computed_hash THEN
    RETURN QUERY SELECT false, 'INVALID_GUEST_CREDENTIALS'::text, v_participant.status::text, v_session.status::text;
    RETURN;
  END IF;

  -- 5. All checks passed
  RETURN QUERY SELECT true, NULL::text, v_participant.status::text, v_session.status::text;
  RETURN;
END;
$$;

-- ============================================================================
-- 2. BACKEND AUTHENTICATED CAPABILITY VERIFIER RPC
-- ============================================================================
CREATE OR REPLACE FUNCTION public.competition_verify_auth_capability_credentials(
  p_session_id uuid,
  p_participant_id uuid,
  p_user_id uuid
)
RETURNS TABLE (
  is_valid boolean,
  error_code text,
  participant_status text,
  session_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session record;
  v_participant record;
BEGIN
  -- 1. Input Null Checks
  IF p_session_id IS NULL OR p_participant_id IS NULL OR p_user_id IS NULL THEN
    RETURN QUERY SELECT false, 'INVALID_INPUT'::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- 2. Verify Session Existence & Lifecycle
  SELECT cs.id, cs.status
  INTO v_session
  FROM public.competition_sessions cs
  WHERE cs.id = p_session_id;

  IF v_session.id IS NULL THEN
    RETURN QUERY SELECT false, 'SESSION_NOT_FOUND'::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF v_session.status NOT IN ('waiting', 'in_progress', 'paused') THEN
    RETURN QUERY SELECT false, 'SESSION_CLOSED'::text, NULL::text, v_session.status::text;
    RETURN;
  END IF;

  -- 3. Verify Participant Existence, Relation & Ownership
  SELECT cp.id, cp.session_id, cp.is_guest, cp.user_id, cp.guest_token_hash, cp.status
  INTO v_participant
  FROM public.competition_participants cp
  WHERE cp.id = p_participant_id
    AND cp.session_id = p_session_id;

  IF v_participant.id IS NULL THEN
    RETURN QUERY SELECT false, 'PARTICIPANT_NOT_FOUND'::text, NULL::text, v_session.status::text;
    RETURN;
  END IF;

  -- Reject if guest or user_id mismatch or guest_token_hash is present
  IF v_participant.is_guest IS TRUE OR v_participant.user_id IS NULL OR v_participant.guest_token_hash IS NOT NULL THEN
    RETURN QUERY SELECT false, 'NOT_AN_AUTHENTICATED_PARTICIPANT'::text, v_participant.status::text, v_session.status::text;
    RETURN;
  END IF;

  IF v_participant.user_id IS DISTINCT FROM p_user_id THEN
    RETURN QUERY SELECT false, 'USER_ID_MISMATCH'::text, v_participant.status::text, v_session.status::text;
    RETURN;
  END IF;

  -- Check Participant Lifecycle Status
  IF v_participant.status = 'kicked' THEN
    RETURN QUERY SELECT false, 'PARTICIPANT_KICKED'::text, v_participant.status::text, v_session.status::text;
    RETURN;
  END IF;

  IF v_participant.status = 'disconnected' THEN
    RETURN QUERY SELECT false, 'PARTICIPANT_DISCONNECTED'::text, v_participant.status::text, v_session.status::text;
    RETURN;
  END IF;

  IF v_participant.status NOT IN ('joined', 'active', 'submitted') THEN
    RETURN QUERY SELECT false, 'PARTICIPANT_STATUS_INVALID'::text, v_participant.status::text, v_session.status::text;
    RETURN;
  END IF;

  -- 4. All checks passed
  RETURN QUERY SELECT true, NULL::text, v_participant.status::text, v_session.status::text;
  RETURN;
END;
$$;

-- ============================================================================
-- 3. ACL HARDENING FOR BOTH PUBLIC VERIFIER RPCs
-- ============================================================================
REVOKE ALL
ON FUNCTION public.competition_verify_guest_capability_credentials(uuid, uuid, text)
FROM PUBLIC, anon, authenticated, competition_guest;

GRANT EXECUTE
ON FUNCTION public.competition_verify_guest_capability_credentials(uuid, uuid, text)
TO service_role;

REVOKE ALL
ON FUNCTION public.competition_verify_auth_capability_credentials(uuid, uuid, uuid)
FROM PUBLIC, anon, authenticated, competition_guest;

GRANT EXECUTE
ON FUNCTION public.competition_verify_auth_capability_credentials(uuid, uuid, uuid)
TO service_role;

-- ============================================================================
-- 4. UPDATE REALTIME CONNECT AUTHORIZATION HELPER
-- ============================================================================
CREATE OR REPLACE FUNCTION private.competition_realtime_can_connect(
  p_session_id uuid,
  p_participant_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.competition_participants cp
    JOIN public.competition_sessions cs ON cs.id = cp.session_id
    WHERE cp.id = p_participant_id
      AND cp.session_id = p_session_id
      AND cs.id = p_session_id
      AND cs.status IN ('waiting', 'in_progress', 'paused')
      AND (
        (cp.is_guest = true AND cp.user_id IS NULL AND cp.guest_token_hash IS NOT NULL)
        OR
        (cp.is_guest = false AND cp.user_id IS NOT NULL AND cp.guest_token_hash IS NULL)
      )
      AND cp.status IN ('joined', 'active', 'submitted')
  );
$$;

-- ============================================================================
-- 5. PRESERVE REALTIME HELPER ACL
-- ============================================================================
REVOKE ALL
ON FUNCTION private.competition_realtime_can_connect(uuid, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION private.competition_realtime_can_connect(uuid, uuid)
TO competition_guest;
