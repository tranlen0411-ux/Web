-- ============================================================
-- Migration 3A: Competition V1 Realtime Schema Foundations
-- Target: public.competition_sessions
-- Scope: Add authoritative state_version column with non-negative check constraint
-- ============================================================

ALTER TABLE public.competition_sessions
  ADD COLUMN state_version BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.competition_sessions
  ADD CONSTRAINT check_competition_sessions_state_version
  CHECK (state_version >= 0);
