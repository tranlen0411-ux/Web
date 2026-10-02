-- Migration 3C-E: Competition V1 Supabase Postgres Authoritative Rate Limiter
-- Purpose: Authoritative, native Postgres rate limiting for Capability Token Issuer
-- Replacing external Redis with zero external infrastructure dependency.
-- Policy:
--   1. Participant Token Bucket: capacity = 4, refill = 1 token / 30 seconds
--   2. Auth User Token Bucket: capacity = 4, refill = 1 token / 30 seconds
--   3. Session Rolling Window: maximum 50 requests per rolling 60 seconds (exact timestamp window)
-- Security:
--   - Schema isolation: competition_internal (unexposed to browser / PostgREST)
--   - Strict Security Definer owner-access model: service_role only gets EXECUTE on RPCs
--   - ZERO direct table grants to service_role, anon, authenticated, competition_guest, or PUBLIC
--   - Hardened search_path = pg_catalog, pg_temp with fully qualified objects
--   - Strict DDL: Zero "CREATE OR REPLACE" / Zero "IF NOT EXISTS" for drift safety

-- ============================================================================
-- 1. INTERNAL SCHEMA ISOLATION
-- ============================================================================
-- Strict DDL: Fails fast on unexpected pre-existing schema collision
CREATE SCHEMA competition_internal;

-- Revoke all schema privileges from all client and public roles
REVOKE ALL ON SCHEMA competition_internal FROM PUBLIC, anon, authenticated, competition_guest;

-- ============================================================================
-- 2. TOKEN BUCKET STORAGE (Participant & Auth User)
-- ============================================================================
CREATE TABLE competition_internal.rate_limit_token_buckets (
  bucket_key text PRIMARY KEY,
  tokens numeric(10, 4) NOT NULL,
  last_refill_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX idx_rate_limit_token_buckets_updated_at 
  ON competition_internal.rate_limit_token_buckets(updated_at);

ALTER TABLE competition_internal.rate_limit_token_buckets ENABLE ROW LEVEL SECURITY;

-- Explicitly revoke all privileges from client roles & service_role
-- (Tables accessed solely via SECURITY DEFINER function owner)
REVOKE ALL ON TABLE competition_internal.rate_limit_token_buckets FROM PUBLIC, anon, authenticated, competition_guest, service_role;

-- ============================================================================
-- 3. SESSION SERIALIZATION LOCK TABLE
-- ============================================================================
CREATE TABLE competition_internal.rate_limit_sessions (
  session_id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL
);

CREATE INDEX idx_rate_limit_sessions_last_seen_at 
  ON competition_internal.rate_limit_sessions(last_seen_at);

ALTER TABLE competition_internal.rate_limit_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE competition_internal.rate_limit_sessions FROM PUBLIC, anon, authenticated, competition_guest, service_role;

-- ============================================================================
-- 4. SESSION EXACT ROLLING WINDOW EVENT LOG
-- ============================================================================
CREATE TABLE competition_internal.rate_limit_session_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id uuid NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX idx_rate_limit_session_events_session_created 
  ON competition_internal.rate_limit_session_events(session_id, created_at);

ALTER TABLE competition_internal.rate_limit_session_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE competition_internal.rate_limit_session_events FROM PUBLIC, anon, authenticated, competition_guest, service_role;

-- ============================================================================
-- 5. BOUNDED TOKEN BUCKET CLEANUP HELPER RPC
-- ============================================================================
-- Strict DDL: CREATE FUNCTION (fails fast on conflict, zero CREATE OR REPLACE)
CREATE FUNCTION public.competition_cleanup_stale_rate_limit_buckets(
  p_max_rows integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_deleted_count integer := 0;
  v_limit integer;
BEGIN
  v_limit := GREATEST(1, LEAST(1000, COALESCE(p_max_rows, 100)));

  -- Lock-safe bounded cleanup using FOR UPDATE SKIP LOCKED to never block active mints
  WITH stale AS (
    SELECT bucket_key
    FROM competition_internal.rate_limit_token_buckets
    WHERE updated_at < (v_now - interval '24 hours')
    ORDER BY updated_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  ),
  deleted AS (
    DELETE FROM competition_internal.rate_limit_token_buckets target
    USING stale
    WHERE target.bucket_key = stale.bucket_key
    RETURNING target.bucket_key
  )
  SELECT pg_catalog.count(*) INTO v_deleted_count FROM deleted;

  RETURN v_deleted_count;
END;
$$;

-- Strict ACL: Explicitly revoke from all client roles, grant EXECUTE exclusively to service_role
REVOKE ALL ON FUNCTION public.competition_cleanup_stale_rate_limit_buckets(integer) FROM PUBLIC, anon, authenticated, competition_guest;
GRANT EXECUTE ON FUNCTION public.competition_cleanup_stale_rate_limit_buckets(integer) TO service_role;

-- ============================================================================
-- 6. BOUNDED SESSION LOCK ROW & EVENTS CLEANUP HELPER RPC
-- ============================================================================
-- Strict DDL: CREATE FUNCTION (fails fast on conflict, zero CREATE OR REPLACE)
CREATE FUNCTION public.competition_cleanup_stale_rate_limit_sessions(
  p_max_rows integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_deleted_count integer := 0;
  v_limit integer;
BEGIN
  v_limit := GREATEST(1, LEAST(1000, COALESCE(p_max_rows, 100)));

  -- 1. Identify and lock at most v_limit stale sessions (>24h inactive), skipping active/locked sessions
  WITH stale_sessions AS (
    SELECT s.session_id
    FROM competition_internal.rate_limit_sessions s
    WHERE s.last_seen_at < (v_now - interval '24 hours')
    ORDER BY s.last_seen_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  ),
  -- 2. Delete all historical events belonging ONLY to these selected stale sessions
  deleted_events AS (
    DELETE FROM competition_internal.rate_limit_session_events target
    USING stale_sessions
    WHERE target.session_id = stale_sessions.session_id
    RETURNING target.id
  ),
  -- 3. Delete the corresponding stale session serialization lock rows
  deleted_sessions AS (
    DELETE FROM competition_internal.rate_limit_sessions target
    USING stale_sessions
    WHERE target.session_id = stale_sessions.session_id
    RETURNING target.session_id
  )
  SELECT pg_catalog.count(*) INTO v_deleted_count FROM deleted_sessions;

  RETURN v_deleted_count;
END;
$$;

-- Strict ACL: Explicitly revoke from all client roles, grant EXECUTE exclusively to service_role
REVOKE ALL ON FUNCTION public.competition_cleanup_stale_rate_limit_sessions(integer) FROM PUBLIC, anon, authenticated, competition_guest;
GRANT EXECUTE ON FUNCTION public.competition_cleanup_stale_rate_limit_sessions(integer) TO service_role;

-- ============================================================================
-- 7. AUTHORITATIVE RATE LIMITER RPC (All-in-One Transaction)
-- ============================================================================
-- Strict DDL: CREATE FUNCTION (fails fast on conflict, zero CREATE OR REPLACE)
CREATE FUNCTION public.competition_check_capability_rate_limit(
  p_session_id uuid,
  p_participant_id uuid,
  p_auth_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  allowed boolean,
  limited_dimension text,
  retry_after_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  -- 1. Single captured logical time reference for all calculations in RPC
  v_now timestamptz := pg_catalog.clock_timestamp();
  
  -- Keys
  v_user_key text;
  v_part_key text;
  
  -- User bucket variables
  v_user_tokens numeric(10, 4);
  v_user_last_refill timestamptz;
  
  -- Participant bucket variables
  v_part_tokens numeric(10, 4);
  v_part_last_refill timestamptz;
  
  -- Math helpers
  v_elapsed numeric;
  v_refilled numeric;
  v_deficit numeric;
  v_retry_after integer;
  
  -- Session rolling window variables
  v_session_event_count bigint;
  v_oldest_event timestamptz;
  v_remaining_sec integer;
BEGIN
  -- Strict input validation (fail fast on null identifiers)
  IF p_session_id IS NULL OR p_participant_id IS NULL THEN
    RAISE EXCEPTION 'p_session_id and p_participant_id must not be null';
  END IF;

  -- --------------------------------------------------------------------------
  -- STEP 1: AUTH USER TOKEN BUCKET (If authenticated user id is present)
  -- Capacity = 4, Refill = 1 token / 30 seconds
  -- --------------------------------------------------------------------------
  IF p_auth_user_id IS NOT NULL THEN
    v_user_key := 'u:' || p_auth_user_id::text;

    -- Concurrency-safe initialization
    INSERT INTO competition_internal.rate_limit_token_buckets (
      bucket_key,
      tokens,
      last_refill_at,
      updated_at
    ) VALUES (
      v_user_key,
      4.0000,
      v_now,
      v_now
    ) ON CONFLICT (bucket_key) DO NOTHING;

    -- Atomic row lock & state retrieval
    SELECT tokens, last_refill_at
    INTO v_user_tokens, v_user_last_refill
    FROM competition_internal.rate_limit_token_buckets
    WHERE bucket_key = v_user_key
    FOR UPDATE;

    -- Calculate elapsed seconds and token refill
    v_elapsed := extract(epoch FROM (v_now - v_user_last_refill));
    IF v_elapsed < 0 THEN
      v_elapsed := 0;
    END IF;

    v_refilled := LEAST(4.0000::numeric, v_user_tokens + (v_elapsed * (1.0000::numeric / 30.0000::numeric)));

    IF v_refilled < 1.0000 THEN
      -- Rate limit exceeded on Auth User dimension
      v_deficit := 1.0000::numeric - v_refilled;
      v_retry_after := GREATEST(1, pg_catalog.ceil(v_deficit * 30.0000::numeric)::integer);

      UPDATE competition_internal.rate_limit_token_buckets
      SET tokens = v_refilled,
          last_refill_at = v_now,
          updated_at = v_now
      WHERE bucket_key = v_user_key;

      RETURN QUERY SELECT false, 'user'::text, v_retry_after;
      RETURN;
    ELSE
      -- Consume 1 token
      UPDATE competition_internal.rate_limit_token_buckets
      SET tokens = (v_refilled - 1.0000::numeric),
          last_refill_at = v_now,
          updated_at = v_now
      WHERE bucket_key = v_user_key;
    END IF;
  END IF;

  -- --------------------------------------------------------------------------
  -- STEP 2: PARTICIPANT TOKEN BUCKET
  -- Capacity = 4, Refill = 1 token / 30 seconds
  -- --------------------------------------------------------------------------
  v_part_key := 'p:' || p_session_id::text || ':' || p_participant_id::text;

  -- Concurrency-safe initialization
  INSERT INTO competition_internal.rate_limit_token_buckets (
    bucket_key,
    tokens,
    last_refill_at,
    updated_at
  ) VALUES (
    v_part_key,
    4.0000,
    v_now,
    v_now
  ) ON CONFLICT (bucket_key) DO NOTHING;

  -- Atomic row lock & state retrieval
  SELECT tokens, last_refill_at
  INTO v_part_tokens, v_part_last_refill
  FROM competition_internal.rate_limit_token_buckets
  WHERE bucket_key = v_part_key
  FOR UPDATE;

  -- Calculate elapsed seconds and token refill
  v_elapsed := extract(epoch FROM (v_now - v_part_last_refill));
  IF v_elapsed < 0 THEN
    v_elapsed := 0;
  END IF;

  v_refilled := LEAST(4.0000::numeric, v_part_tokens + (v_elapsed * (1.0000::numeric / 30.0000::numeric)));

  IF v_refilled < 1.0000 THEN
    -- Rate limit exceeded on Participant dimension
    v_deficit := 1.0000::numeric - v_refilled;
    v_retry_after := GREATEST(1, pg_catalog.ceil(v_deficit * 30.0000::numeric)::integer);

    UPDATE competition_internal.rate_limit_token_buckets
    SET tokens = v_refilled,
        last_refill_at = v_now,
        updated_at = v_now
    WHERE bucket_key = v_part_key;

    RETURN QUERY SELECT false, 'participant'::text, v_retry_after;
    RETURN;
  ELSE
    -- Consume 1 token
    UPDATE competition_internal.rate_limit_token_buckets
    SET tokens = (v_refilled - 1.0000::numeric),
        last_refill_at = v_now,
        updated_at = v_now
    WHERE bucket_key = v_part_key;
  END IF;

  -- --------------------------------------------------------------------------
  -- STEP 3: SESSION AGGREGATE EXACT ROLLING WINDOW (50 requests / 60 seconds)
  -- --------------------------------------------------------------------------
  -- Concurrency-safe session serialization lock row initialization
  INSERT INTO competition_internal.rate_limit_sessions (
    session_id,
    created_at,
    last_seen_at
  ) VALUES (
    p_session_id,
    v_now,
    v_now
  ) ON CONFLICT (session_id) DO UPDATE
  SET last_seen_at = v_now;

  -- Serialize concurrent requests for this exact session
  PERFORM 1
  FROM competition_internal.rate_limit_sessions
  WHERE session_id = p_session_id
  FOR UPDATE;

  -- Maintain accurate last_seen_at under exclusive session lock
  UPDATE competition_internal.rate_limit_sessions
  SET last_seen_at = v_now
  WHERE session_id = p_session_id;

  -- In-transaction scoped pruning of stale events for THIS session only (>120s old)
  DELETE FROM competition_internal.rate_limit_session_events
  WHERE session_id = p_session_id
    AND created_at < (v_now - interval '120 seconds');

  -- Count events in exact rolling 60-second window: [v_now - 60s, v_now] (Inclusive lower boundary)
  SELECT pg_catalog.count(*), pg_catalog.min(created_at)
  INTO v_session_event_count, v_oldest_event
  FROM competition_internal.rate_limit_session_events
  WHERE session_id = p_session_id
    AND created_at >= (v_now - interval '60 seconds');

  IF v_session_event_count >= 50 THEN
    -- Session limit reached (50 requests already accepted in rolling 60s)
    IF v_oldest_event IS NOT NULL THEN
      v_remaining_sec := pg_catalog.ceil(extract(epoch FROM ((v_oldest_event + interval '60 seconds') - v_now)))::integer;
      -- Defensive clamp: Guarantee retry_after is at least 1 second and strictly non-negative
      v_retry_after := GREATEST(1, v_remaining_sec);
    ELSE
      v_retry_after := 1;
    END IF;

    -- Note: Preceding User and Participant tokens were consumed, preserving M3C-D 429 semantics
    RETURN QUERY SELECT false, 'session'::text, v_retry_after;
    RETURN;
  ELSE
    -- Record this successful request into session events log
    INSERT INTO competition_internal.rate_limit_session_events (
      session_id,
      created_at
    ) VALUES (
      p_session_id,
      v_now
    );

    -- All dimensions allowed
    RETURN QUERY SELECT true, NULL::text, NULL::integer;
    RETURN;
  END IF;
END;
$$;

-- Strict ACL: Explicitly revoke from all client roles, grant EXECUTE exclusively to service_role
REVOKE ALL ON FUNCTION public.competition_check_capability_rate_limit(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, competition_guest;
GRANT EXECUTE ON FUNCTION public.competition_check_capability_rate_limit(uuid, uuid, uuid) TO service_role;
