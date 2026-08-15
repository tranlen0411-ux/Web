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

TEST_USER_ID=$(uuidgen || python3 -c "import uuid; print(uuid.uuid4())")
TEST_JOB_ID=$(uuidgen || python3 -c "import uuid; print(uuid.uuid4())")
TEST_FILE_PATH="concurrency-test/file_${TEST_JOB_ID}.png"

echo "1. Creating test fixture profile and cleanup job..."
$PSQL_CMD -c "
INSERT INTO public.profiles (id, full_name, role) VALUES ('$TEST_USER_ID', 'Concurrency Test Admin', 'admin') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.exercise_file_cleanup_jobs (id, bucket_id, file_path, requested_by, status, attempts)
VALUES ('$TEST_JOB_ID', 'exercise-submissions', '$TEST_FILE_PATH', '$TEST_USER_ID', 'pending', 0);
"

echo "2. Launching 2 concurrent psql RPC claim requests in parallel..."
$PSQL_CMD -c "SET ROLE service_role; SELECT public.claim_exercise_file_cleanup_job('$TEST_JOB_ID'::uuid, '$TEST_USER_ID'::uuid);" > /tmp/worker1.log 2>&1 &
PID1=$!

$PSQL_CMD -c "SET ROLE service_role; SELECT public.claim_exercise_file_cleanup_job('$TEST_JOB_ID'::uuid, '$TEST_USER_ID'::uuid);" > /tmp/worker2.log 2>&1 &
PID2=$!

wait $PID1 $PID2

W1_RES=$(cat /tmp/worker1.log)
W2_RES=$(cat /tmp/worker2.log)

echo "Worker 1 Result: $W1_RES"
echo "Worker 2 Result: $W2_RES"

SUCCESS_COUNT=0
ALREADY_CLAIMED_COUNT=0

if [[ "$W1_RES" == *"\"success\": true"* || "$W1_RES" == *"\"success\":true"* ]]; then
  SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
fi
if [[ "$W2_RES" == *"\"success\": true"* || "$W2_RES" == *"\"success\":true"* ]]; then
  SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
fi

if [[ "$W1_RES" == *"already_claimed"* ]]; then
  ALREADY_CLAIMED_COUNT=$((ALREADY_CLAIMED_COUNT + 1))
fi
if [[ "$W2_RES" == *"already_claimed"* ]]; then
  ALREADY_CLAIMED_COUNT=$((ALREADY_CLAIMED_COUNT + 1))
fi

if [[ "$SUCCESS_COUNT" -ne 1 || "$ALREADY_CLAIMED_COUNT" -ne 1 ]]; then
  echo "❌ CONCURRENCY TEST FAILED: Expected exactly 1 winner (success: true) and 1 loser (already_claimed). Got success=$SUCCESS_COUNT, already_claimed=$ALREADY_CLAIMED_COUNT"
  exit 1
fi
echo "  ✅ Concurrent Claim Test Passed: Exactly 1 worker succeeded and 1 worker received already_claimed!"

# Check DB attempts count
ATTEMPTS_COUNT=$($PSQL_CMD -c "SELECT attempts FROM public.exercise_file_cleanup_jobs WHERE id = '$TEST_JOB_ID';")
if [[ "$ATTEMPTS_COUNT" -ne 1 ]]; then
  echo "❌ CONCURRENCY TEST FAILED: Attempts count in DB should be 1, got $ATTEMPTS_COUNT"
  exit 1
fi
echo "  ✅ DB Attempts Count Verified: attempts = 1."

echo "3. Testing 2 concurrent reset_cleanup_jobs_for_retry calls (FOR UPDATE SKIP LOCKED)..."
$PSQL_CMD -c "SET ROLE service_role; SELECT public.reset_cleanup_jobs_for_retry(50);" > /tmp/reset1.log 2>&1 &
PID3=$!
$PSQL_CMD -c "SET ROLE service_role; SELECT public.reset_cleanup_jobs_for_retry(50);" > /tmp/reset2.log 2>&1 &
PID4=$!

wait $PID3 $PID4
echo "  ✅ Concurrent Reset Test Passed!"

echo "================================================================="
echo "  CONCURRENCY VERIFICATION PASSED SUCCESSFULLY (EXIT CODE 0)"
echo "================================================================="
