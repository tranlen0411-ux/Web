-- Migration 3B: Competition V1 Realtime Authorization Foundation
-- Fail-fast creation of custom database role, hardened authorization helper, minimal privileges, and RLS policies on realtime.messages.

-- ============================================================================
-- 1. FAIL-FAST ROLE CREATION
-- ============================================================================
CREATE ROLE competition_guest NOLOGIN NOINHERIT;

-- ============================================================================
-- 2. HARDENED AUTHORIZATION HELPER
-- ============================================================================
CREATE FUNCTION private.competition_realtime_can_connect(
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
    WHERE cp.id = p_participant_id
      AND cp.session_id = p_session_id
      AND cp.is_guest = true
      AND cp.user_id IS NULL
      AND cp.guest_token_hash IS NOT NULL
      AND cp.status IN ('joined', 'active', 'submitted')
  );
$$;

-- ============================================================================
-- 3. HELPER ACL HARDENING
-- ============================================================================
REVOKE ALL
ON FUNCTION private.competition_realtime_can_connect(uuid, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION private.competition_realtime_can_connect(uuid, uuid)
TO competition_guest;

-- ============================================================================
-- 4. MINIMAL SCHEMA AND TABLE PRIVILEGES
-- ============================================================================
GRANT USAGE ON SCHEMA private TO competition_guest;

GRANT USAGE ON SCHEMA realtime TO competition_guest;

GRANT SELECT, INSERT
ON realtime.messages
TO competition_guest;

-- ============================================================================
-- 5. REALTIME RLS POLICIES (realtime.messages)
-- ============================================================================

-- Policy 1: Broadcast Receive (SELECT)
CREATE POLICY "competition_guest_broadcast_select"
ON realtime.messages
FOR SELECT
TO competition_guest
USING (
  extension = 'broadcast'
  AND realtime.topic() = ('competition:session:' || (current_setting('request.jwt.claims', true)::jsonb ->> 'session_id'))
  AND private.competition_realtime_can_connect(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'session_id')::uuid,
    (current_setting('request.jwt.claims', true)::jsonb ->> 'participant_id')::uuid
  )
);

-- Policy 2: Presence Receive (SELECT)
CREATE POLICY "competition_guest_presence_select"
ON realtime.messages
FOR SELECT
TO competition_guest
USING (
  extension = 'presence'
  AND realtime.topic() = ('competition:session:' || (current_setting('request.jwt.claims', true)::jsonb ->> 'session_id'))
  AND private.competition_realtime_can_connect(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'session_id')::uuid,
    (current_setting('request.jwt.claims', true)::jsonb ->> 'participant_id')::uuid
  )
);

-- Policy 3: Presence Track (INSERT)
CREATE POLICY "competition_guest_presence_insert"
ON realtime.messages
FOR INSERT
TO competition_guest
WITH CHECK (
  extension = 'presence'
  AND realtime.topic() = ('competition:session:' || (current_setting('request.jwt.claims', true)::jsonb ->> 'session_id'))
  AND private.competition_realtime_can_connect(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'session_id')::uuid,
    (current_setting('request.jwt.claims', true)::jsonb ->> 'participant_id')::uuid
  )
);
