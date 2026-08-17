-- LOCAL TEST ONLY. Run against Supabase local after applying the migration.
-- Use two SQL sessions and replace placeholders with a local test batch/token.
-- Session A and B must execute the same call concurrently; exactly one result
-- may contain {"claimed":true}.

BEGIN;
SELECT public.claim_student_row(
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid,
  encode(extensions.digest('row-1','sha256'),'hex'),
  1,
  'LOCAL TEST STUDENT'
);
ROLLBACK;

-- Assertions to run after the concurrent harness:
-- SELECT batch_id,row_key,status,count(*)
-- FROM app_private.batch_student_rows
-- GROUP BY batch_id,row_key,status;
-- UNIQUE(batch_id,row_key) must prevent more than one row.
-- A stale claim_token must return claimed=false/reason=LEASE_INVALID.
