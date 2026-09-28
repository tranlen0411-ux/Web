-- ============================================================
-- COMPETITION V1 HOST RPC GRANT HARDENING (MIGRATION 2.1)
-- Objective: Revoke EXECUTE from anon on all 7 public Host RPCs
-- Target: Least-privilege catalog ACL hardening
-- Invariants:
--   1. authenticated role retains EXECUTE
--   2. anon role has EXECUTE revoked
--   3. PUBLIC pseudo-role has EXECUTE revoked
--   4. No alteration to function bodies, tables, RLS, or global default privileges
-- ============================================================

-- Conservative timeout protections
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ------------------------------------------------------------
-- 1. REVOKE EXECUTE FROM anon & PUBLIC ON 7 HOST RPCs
-- ------------------------------------------------------------

-- 1.1 competition_host_create_session
REVOKE EXECUTE ON FUNCTION public.competition_host_create_session(
    TEXT, TEXT, TEXT, INT, JSONB, JSONB, BOOLEAN, JSONB
) FROM anon, PUBLIC;

-- 1.2 competition_host_start_session
REVOKE EXECUTE ON FUNCTION public.competition_host_start_session(
    UUID
) FROM anon, PUBLIC;

-- 1.3 competition_host_next_question
REVOKE EXECUTE ON FUNCTION public.competition_host_next_question(
    UUID
) FROM anon, PUBLIC;

-- 1.4 competition_host_pause_session
REVOKE EXECUTE ON FUNCTION public.competition_host_pause_session(
    UUID
) FROM anon, PUBLIC;

-- 1.5 competition_host_resume_session
REVOKE EXECUTE ON FUNCTION public.competition_host_resume_session(
    UUID
) FROM anon, PUBLIC;

-- 1.6 competition_host_cancel_session
REVOKE EXECUTE ON FUNCTION public.competition_host_cancel_session(
    UUID
) FROM anon, PUBLIC;

-- 1.7 competition_host_finish_session
REVOKE EXECUTE ON FUNCTION public.competition_host_finish_session(
    UUID
) FROM anon, PUBLIC;

-- ------------------------------------------------------------
-- 2. ENSURE EXECUTE IS GRANTED TO authenticated
-- ------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.competition_host_create_session(
    TEXT, TEXT, TEXT, INT, JSONB, JSONB, BOOLEAN, JSONB
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.competition_host_start_session(
    UUID
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.competition_host_next_question(
    UUID
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.competition_host_pause_session(
    UUID
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.competition_host_resume_session(
    UUID
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.competition_host_cancel_session(
    UUID
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.competition_host_finish_session(
    UUID
) TO authenticated;
