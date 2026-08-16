#!/usr/bin/env bash
set -euo pipefail

echo "================================================================="
echo "  SUPABASE LOCAL EDGE FUNCTION INTEGRATION VERIFICATION"
echo "================================================================="

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-54322}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"
DB_NAME="${DB_NAME:-postgres}"

# Safety Check: Target MUST be localhost / 127.0.0.1
if [[ "$DB_HOST" != "127.0.0.1" && "$DB_HOST" != "localhost" ]]; then
  echo "❌ CRITICAL SAFETY ERROR: Target database host ($DB_HOST) is NOT local! Stopping immediately."
  exit 1
fi

export PGPASSWORD="$DB_PASSWORD"
PSQL_CMD="psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -A"

echo "1. Retrieving Local Supabase Keys & Endpoints (Fail-Closed)..."
SUPABASE_STATUS_ENV=$(npx --no-install supabase status -o env 2>/dev/null || supabase status -o env 2>/dev/null || echo "")

ANON_KEY=$(echo "$SUPABASE_STATUS_ENV" | grep -E '^ANON_KEY=' | cut -d'=' -f2- | tr -d '"' | tr -d "'" | tr -d '\r')
SERVICE_ROLE_KEY=$(echo "$SUPABASE_STATUS_ENV" | grep -E '^SERVICE_ROLE_KEY=' | cut -d'=' -f2- | tr -d '"' | tr -d "'" | tr -d '\r')
API_URL=$(echo "$SUPABASE_STATUS_ENV" | grep -E '^API_URL=' | cut -d'=' -f2- | tr -d '"' | tr -d "'" | tr -d '\r')

if [ -z "$API_URL" ]; then
  API_URL="http://127.0.0.1:54321"
fi

FUNC_URL="${API_URL}/functions/v1/cleanup-exercise-submission-files"

if [ -z "$ANON_KEY" ] || [ -z "$SERVICE_ROLE_KEY" ]; then
  echo "❌ CRITICAL ERROR: Unable to retrieve local Supabase ANON_KEY or SERVICE_ROLE_KEY! Failing closed."
  exit 1
fi

# Mask sensitive keys in runner logs
echo "::add-mask::$ANON_KEY"
echo "::add-mask::$SERVICE_ROLE_KEY"

echo "2. Creating Local Auth Fixture User via Auth Admin API..."
RANDOM_HEX=$(python3 -c "import uuid; print(uuid.uuid4().hex[:8])" 2>/dev/null || echo "$RANDOM")
TEST_EMAIL="ci_edge_user_${RANDOM_HEX}@local.test"
TEST_PASSWORD="TestPassword_123456!"

echo "::add-mask::$TEST_PASSWORD"

TEST_USER_ID=""

cleanup_fixture() {
  local exit_code=$?
  if [ -n "${TEST_USER_ID:-}" ]; then
    echo "Cleaning up local test fixture..."
    $PSQL_CMD -c "DELETE FROM public.profiles WHERE id = '$TEST_USER_ID';" >/dev/null 2>&1 || true
    curl -s -X DELETE "${API_URL}/auth/v1/admin/users/${TEST_USER_ID}" \
      -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
      -H "apikey: ${SERVICE_ROLE_KEY}" >/dev/null 2>&1 || true
  fi
  exit $exit_code
}
trap cleanup_fixture EXIT

CREATE_USER_RES_FILE=$(mktemp)
CREATE_USER_CODE=$(curl -s -w "%{http_code}" -o "$CREATE_USER_RES_FILE" -X POST "${API_URL}/auth/v1/admin/users" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "apikey: ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\",\"email_confirm\":true,\"user_metadata\":{\"full_name\":\"CI Test Student\"}}")

CREATE_USER_BODY=$(cat "$CREATE_USER_RES_FILE")
rm -f "$CREATE_USER_RES_FILE"

if [[ "$CREATE_USER_CODE" != "200" && "$CREATE_USER_CODE" != "201" ]]; then
  echo "❌ CRITICAL ERROR: Local Auth Admin user creation failed (HTTP $CREATE_USER_CODE)! Failing closed."
  exit 1
fi

TEST_USER_ID=$(echo "$CREATE_USER_BODY" | jq -r '.id // .user.id // empty')

if [ -z "$TEST_USER_ID" ] || [ "$TEST_USER_ID" == "null" ]; then
  echo "❌ CRITICAL ERROR: Unable to extract valid user ID from Auth Admin response! Failing closed."
  exit 1
fi

echo "3. Creating Public Profile Fixture for User $TEST_USER_ID..."
$PSQL_CMD -c "
INSERT INTO public.profiles (id, full_name, role)
VALUES ('$TEST_USER_ID', 'CI Test Student', 'student')
ON CONFLICT (id) DO UPDATE SET role = 'student';
"

echo "4. Logging In Fixture User via Local Auth API..."
LOGIN_RES_FILE=$(mktemp)
LOGIN_CODE=$(curl -s -w "%{http_code}" -o "$LOGIN_RES_FILE" -X POST "${API_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}")

LOGIN_BODY=$(cat "$LOGIN_RES_FILE")
rm -f "$LOGIN_RES_FILE"

if [ "$LOGIN_CODE" != "200" ]; then
  echo "❌ CRITICAL ERROR: Local Auth login failed (HTTP $LOGIN_CODE)! Failing closed."
  exit 1
fi

USER_TOKEN=$(echo "$LOGIN_BODY" | jq -r '.access_token // empty')
LOGGED_USER_ID=$(echo "$LOGIN_BODY" | jq -r '.user.id // empty')

if [ -z "$USER_TOKEN" ] || [ "$USER_TOKEN" == "null" ] || [ "$LOGGED_USER_ID" != "$TEST_USER_ID" ]; then
  echo "❌ CRITICAL ERROR: Local Auth login returned invalid access token or user ID mismatch! Failing closed."
  exit 1
fi

echo "::add-mask::$USER_TOKEN"
echo "  ✅ Local fixture user created via Auth Admin API & logged in successfully!"

echo "5. Health Check: Waiting for Local Edge Function Endpoint..."
MAX_RETRIES=15
RETRY_COUNT=0
HEALTH_READY=false

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  HTTP_CHECK=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$FUNC_URL" \
    -H "Authorization: Bearer $USER_TOKEN" \
    -H "apikey: $ANON_KEY" \
    -H "Content-Type: application/json" \
    -d '{"job_ids":[]}' || echo "000")
  
  if [ "$HTTP_CHECK" == "200" ]; then
    HEALTH_READY=true
    break
  fi
  RETRY_COUNT=$((RETRY_COUNT + 1))
  sleep 1
done

if [ "$HEALTH_READY" != "true" ]; then
  echo "❌ CRITICAL ERROR: Edge Function endpoint ($FUNC_URL) not ready (HTTP $HTTP_CHECK)! Failing closed."
  exit 1
fi
echo "  ✅ Edge Function endpoint is ready (HTTP 200)!"

call_func() {
  local auth_val="$1"
  local apikey_val="$2"
  local payload="$3"
  local out_file="$4"

  local code
  code=$(curl -s -w "%{http_code}" -o "$out_file" -X POST "$FUNC_URL" \
    ${auth_val:+-H "Authorization: $auth_val"} \
    ${apikey_val:+-H "apikey: $apikey_val"} \
    -H "Content-Type: application/json" \
    -d "$payload")

  echo "$code"
}

echo "6. Executing Integration Test Cases..."

# TEST 0: Missing Authorization Header
echo "-> Test 0: Missing Authorization Header..."
TMP_OUT0=$(mktemp)
CODE0=$(call_func "" "$ANON_KEY" '{"job_ids":[]}' "$TMP_OUT0")
BODY0=$(cat "$TMP_OUT0")
rm -f "$TMP_OUT0"

if [[ "$CODE0" == "401" || "$CODE0" == "403" ]]; then
  echo "  ✅ Test 0 Passed: Missing Authorization rejected as expected (HTTP $CODE0)."
else
  echo "❌ TEST 0 FAILED: Expected HTTP 401/403 for missing auth, got HTTP $CODE0."
  exit 1
fi

# TEST 1: Invalid / Fake JWT
echo "-> Test 1: Invalid/Fake JWT..."
TMP_OUT1=$(mktemp)
CODE1=$(call_func "Bearer invalid.fake.jwt.token" "$ANON_KEY" '{"job_ids":[]}' "$TMP_OUT1")
BODY1=$(cat "$TMP_OUT1")
rm -f "$TMP_OUT1"

if [[ "$CODE1" == "401" || "$CODE1" == "403" ]]; then
  echo "  ✅ Test 1 Passed: Invalid JWT rejected by Gateway (HTTP $CODE1)."
else
  echo "❌ TEST 1 FAILED: Expected HTTP 401/403 for fake JWT, got HTTP $CODE1."
  exit 1
fi

# TEST 2: Valid User Token + Empty Payload
echo "-> Test 2: Valid User Token + Empty Payload..."
TMP_OUT2=$(mktemp)
CODE2=$(call_func "Bearer $USER_TOKEN" "$ANON_KEY" '{"job_ids":[]}' "$TMP_OUT2")
BODY2=$(cat "$TMP_OUT2")
rm -f "$TMP_OUT2"

if [ "$CODE2" != "200" ]; then
  echo "❌ TEST 2 FAILED: Expected HTTP 200, got HTTP $CODE2"
  exit 1
fi

CHECK2=$(echo "$BODY2" | jq -r '
  if .requested_count == 0 and 
     .completed_count == 0 and 
     .unresolved_count == 0 and 
     .skipped_count == 0 and 
     .counter_invariant_valid == true and 
     .success == true and 
     .partial_success == false 
  then "PASS" else "FAIL" end
')

if [ "$CHECK2" != "PASS" ]; then
  echo "❌ TEST 2 FAILED: Response JSON assertions failed."
  exit 1
fi
echo "  ✅ Test 2 Passed: Empty payload response JSON verified perfectly!"

# TEST 3: Valid User Token + Invalid Job IDs
echo "-> Test 3: Valid User Token + Invalid Job IDs..."
TMP_OUT3=$(mktemp)
CODE3=$(call_func "Bearer $USER_TOKEN" "$ANON_KEY" '{"job_ids":["invalid_uuid_123", null, 12345, {}]}' "$TMP_OUT3")
BODY3=$(cat "$TMP_OUT3")
rm -f "$TMP_OUT3"

if [ "$CODE3" != "200" ]; then
  echo "❌ TEST 3 FAILED: Expected HTTP 200, got HTTP $CODE3"
  exit 1
fi

CHECK3=$(echo "$BODY3" | jq -r '
  if (.invalid_job_ids | length) > 0 and 
     .counter_invariant_valid == true and 
     .requested_count == (.completed_count + .unresolved_count + .skipped_count) and 
     (.success != .partial_success or (.success == false and .partial_success == false))
  then "PASS" else "FAIL" end
')

if [ "$CHECK3" != "PASS" ]; then
  echo "❌ TEST 3 FAILED: Invalid job IDs assertions failed."
  exit 1
fi
echo "  ✅ Test 3 Passed: Invalid job IDs handled fail-closed with valid counter invariants!"

# TEST 4: Valid User Token + Duplicate Job IDs (Case Insensitive)
echo "-> Test 4: Valid User Token + Duplicate Job IDs..."
TMP_OUT4=$(mktemp)
CODE4=$(call_func "Bearer $USER_TOKEN" "$ANON_KEY" '{"job_ids":["a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", "A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11"]}' "$TMP_OUT4")
BODY4=$(cat "$TMP_OUT4")
rm -f "$TMP_OUT4"

if [ "$CODE4" != "200" ]; then
  echo "❌ TEST 4 FAILED: Expected HTTP 200, got HTTP $CODE4"
  exit 1
fi

CHECK4=$(echo "$BODY4" | jq -r '
  if (.duplicate_job_ids | length) > 0 and 
     .skipped_count > 0 and 
     .counter_invariant_valid == true and 
     .requested_count == (.completed_count + .unresolved_count + .skipped_count)
  then "PASS" else "FAIL" end
')

if [ "$CHECK4" != "PASS" ]; then
  echo "❌ TEST 4 FAILED: Duplicate job IDs assertions failed."
  exit 1
fi
echo "  ✅ Test 4 Passed: Duplicate job IDs deduplicated properly with valid counter invariants!"

echo "================================================================="
echo "  ALL LOCAL EDGE FUNCTION INTEGRATION TESTS PASSED (EXIT CODE 0)"
echo "================================================================="
