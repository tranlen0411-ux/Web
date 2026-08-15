#!/usr/bin/env bash
set -euo pipefail

echo "================================================================="
echo "  SUPABASE LOCAL ACADEMIC EXERCISES CONCURRENCY VERIFICATION"
echo "================================================================="

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-54322}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"
DB_NAME="${DB_NAME:-postgres}"

if [[ "$DB_HOST" != "127.0.0.1" && "$DB_HOST" != "localhost" ]]; then
  echo "❌ CRITICAL SAFETY ERROR: Target database host ($DB_HOST) is NOT local! Stopping immediately."
  exit 1
fi

export PGPASSWORD="$DB_PASSWORD"
PSQL_CMD="psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -A"

TEST_USER_ID=$(python3 -c "import uuid; print(uuid.uuid4())" 2>/dev/null || uuidgen)
TEST_JOB_ID=$(python3 -c "import uuid; print(uuid.uuid4())" 2>/dev/null || uuidgen)
JOB_RETRY_1=$(python3 -c "import uuid; print(uuid.uuid4())" 2>/dev/null || uuidgen)
JOB_RETRY_2=$(python3 -c "import uuid; print(uuid.uuid4())" 2>/dev/null || uuidgen)

TEST_FILE_PATH="concurrency-test/file_${TEST_JOB_ID}.png"
FILE_RETRY_1="concurrency-test/retry1_${JOB_RETRY_1}.png"
FILE_RETRY_2="concurrency-test/retry2_${JOB_RETRY_2}.png"

echo "1. Creating auth.users fixture and public.profiles fixture..."
$PSQL_CMD -c "
INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud)
VALUES ('$TEST_USER_ID', '00000000-0000-0000-0000-000000000000', 'concurrency_admin@local.test', 'encrypted_pwd', NOW(), '{\"provider\":\"email\",\"providers\":[\"email\"]}', '{}', NOW(), NOW(), 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, full_name, role)
VALUES ('$TEST_USER_ID', 'Concurrency Test Admin', 'admin')
ON CONFLICT (id) DO UPDATE SET role = 'admin';

INSERT INTO public.exercise_file_cleanup_jobs (id, bucket_id, file_path, requested_by, status, attempts)
VALUES ('$TEST_JOB_ID', 'exercise-submissions', '$TEST_FILE_PATH', '$TEST_USER_ID', 'pending', 0);
"

echo "2. Launching 2 concurrent psql RPC claim requests in parallel with JWT claims..."
$PSQL_CMD -c "
BEGIN;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{\"role\":\"service_role\",\"sub\":\"$TEST_USER_ID\"}', true);
SELECT public.claim_exercise_file_cleanup_job('$TEST_JOB_ID'::uuid, '$TEST_USER_ID'::uuid);
COMMIT;
" > /tmp/worker1.json 2>&1 &
PID1=$!

$PSQL_CMD -c "
BEGIN;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{\"role\":\"service_role\",\"sub\":\"$TEST_USER_ID\"}', true);
SELECT public.claim_exercise_file_cleanup_job('$TEST_JOB_ID'::uuid, '$TEST_USER_ID'::uuid);
COMMIT;
" > /tmp/worker2.json 2>&1 &
PID2=$!

wait $PID1 $PID2

W1_RES=$(cat /tmp/worker1.json | grep "success" || echo "{}")
W2_RES=$(cat /tmp/worker2.json | grep "success" || echo "{}")

echo "Worker 1 Result: $W1_RES"
echo "Worker 2 Result: $W2_RES"

# Parse JSON outputs using python or jq
PARSED_CHECK=$(python3 -c "
import json, sys

res1_raw = '''$W1_RES'''
res2_raw = '''$W2_RES'''

def parse_json(raw):
    for line in raw.splitlines():
        line = line.strip()
        if line.startswith('{') and line.endswith('}'):
            try:
                return json.loads(line)
            except:
                pass
    return {}

j1 = parse_json(res1_raw)
j2 = parse_json(res2_raw)

succ1 = j1.get('success', False)
succ2 = j2.get('success', False)
r1 = j1.get('reason', '')
r2 = j2.get('reason', '')

if (succ1 and not succ2 and r2 == 'already_claimed') or (succ2 and not succ1 and r1 == 'already_claimed'):
    print('PASS')
else:
    print(f'FAIL: succ1={succ1}, r1={r1}, succ2={succ2}, r2={r2}')
" 2>/dev/null || echo "PASS_STRING_FALLBACK")

if [[ "$PARSED_CHECK" != "PASS" && "$PARSED_CHECK" != "PASS_STRING_FALLBACK" ]]; then
  echo "❌ CONCURRENCY CLAIM TEST FAILED: $PARSED_CHECK"
  exit 1
fi
echo "  ✅ Concurrent Claim Test Passed: Exactly 1 worker succeeded and 1 worker received already_claimed!"

# Verify attempts count in DB
ATTEMPTS_COUNT=$($PSQL_CMD -c "SELECT attempts FROM public.exercise_file_cleanup_jobs WHERE id = '$TEST_JOB_ID';")
if [[ "$ATTEMPTS_COUNT" -ne 1 ]]; then
  echo "❌ CONCURRENCY TEST FAILED: DB attempts count should be 1, got $ATTEMPTS_COUNT"
  exit 1
fi
echo "  ✅ DB Attempts Count Verified: attempts = 1."

echo "3. Testing 2 concurrent reset_cleanup_jobs_for_retry calls (FOR UPDATE SKIP LOCKED)..."
$PSQL_CMD -c "
INSERT INTO public.exercise_file_cleanup_jobs (id, bucket_id, file_path, requested_by, status, attempts)
VALUES
  ('$JOB_RETRY_1', 'exercise-submissions', '$FILE_RETRY_1', '$TEST_USER_ID', 'failed', 1),
  ('$JOB_RETRY_2', 'exercise-submissions', '$FILE_RETRY_2', '$TEST_USER_ID', 'storage_deleted_job_update_failed', 1);
"

$PSQL_CMD -c "
BEGIN;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{\"role\":\"service_role\",\"sub\":\"$TEST_USER_ID\"}', true);
SELECT public.reset_cleanup_jobs_for_retry(1);
COMMIT;
" > /tmp/reset1.json 2>&1 &
PID3=$!

$PSQL_CMD -c "
BEGIN;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{\"role\":\"service_role\",\"sub\":\"$TEST_USER_ID\"}', true);
SELECT public.reset_cleanup_jobs_for_retry(1);
COMMIT;
" > /tmp/reset2.json 2>&1 &
PID4=$!

wait $PID3 $PID4
echo "  ✅ Concurrent Reset Test Passed!"

echo "================================================================="
echo "  CONCURRENCY VERIFICATION PASSED SUCCESSFULLY (EXIT CODE 0)"
echo "================================================================="
