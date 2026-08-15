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

echo "2. Setting Up Local Auth Fixture User..."
TEST_USER_ID=$(python3 -c "import uuid; print(uuid.uuid4())" 2>/dev/null || uuidgen)
TEST_EMAIL="ci_edge_user_${TEST_USER_ID}@local.test"
TEST_PASSWORD="TestPassword_123456!"

cleanup_fixture() {
  local exit_code=$?
  echo "Cleaning up local test fixture..."
  $PSQL_CMD -c "
    DELETE FROM public.profiles WHERE id = '$TEST_USER_ID';
    DELETE FROM auth.users WHERE id = '$TEST_USER_ID';
  " >/dev/null 2>&1 || true
  exit $exit_code
}
trap cleanup_fixture EXIT

$PSQL_CMD -c "
INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud)
VALUES (
  '$TEST_USER_ID',
  '00000000-0000-0000-0000-000000000000',
  '$TEST_EMAIL',
  crypt('$TEST_PASSWORD', gen_salt('bf')),
  NOW(),
  '{\"provider\":\"email\",\"providers\":[\"email\"]}',
  '{\"full_name\":\"CI Test Student\"}',
  NOW(),
  NOW(),
  'authenticated',
  'authenticated'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, full_name, role)
VALUES ('$TEST_USER_ID', 'CI Test Student', 'student')
ON CONFLICT (id) DO UPDATE SET role = 'student';
"

echo "3. Logging In Fixture User via Local Auth API..."
LOGIN_RES=$(curl -s -X POST "${API_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}")

USER_TOKEN=$(echo "$LOGIN_RES" | jq -r '.access_token // empty')

if [ -z "$USER_TOKEN" ] || [ "$USER_TOKEN" == "null" ]; then
  echo "❌ CRITICAL ERROR: Local Auth login failed for fixture user! Failing closed."
  exit 1
fi

echo "::add-mask::$USER_TOKEN"
echo "  ✅ Local fixture user created & logged in successfully!"

echo "4. Health Check: Waiting for Local Edge Function Endpoint..."
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

# Helper for executing requests
call_func() {
  local auth_val="$1"
  local apikey_val="$2"
  local payload="$3"
  local tmp_res
  tmp_res=$(mktemp)

  local code
  code=$(curl -s -w "%{http_code}" -o "$tmp_res" -X POST "$FUNC_URL" \
    ${auth_val:+-H "Authorization: $auth_val"} \
    ${apikey_val:+-H "apikey: $apikey_val"} \
    -H "Content-Type: application/json" \
    -d "$payload")

  local body
  body=$(cat "$tmp_res")
  rm -f "$tmp_res"

  echo "${code}:::${body}"
}

echo "5. Executing Integration Test Cases..."

# TEST 0: Missing Authorization Header
echo "-> Test 0: Missing Authorization Header..."
RES0=$(call_func "" "$ANON_KEY" '{"job_ids":[]}')
CODE0=$(echo "$RES0" | cut -d':' -f1)
BODY0=$(echo "$RES0" | cut -d':' -f4-)

if [[ "$CODE0" == "401" || "$CODE0" == "403" || "$BODY0" == *"unauthorized"* || "$BODY0" == *"Invalid JWT"* || "$BODY0" == *"Missing"* ]]; then
  echo "  ✅ Test 0 Passed: Missing Authorization rejected as expected (HTTP $CODE0)."
else
  echo "❌ TEST 0 FAILED: Expected HTTP 401/403 for missing auth, got HTTP $CODE0."
  exit 1
fi

# TEST 1: Invalid / Fake JWT
echo "-> Test 1: Invalid/Fake JWT..."
RES1=$(call_func "Bearer invalid.fake.jwt.token" "$ANON_KEY" '{"job_ids":[]}')
CODE1=$(echo "$RES1" | cut -d':' -f1)
BODY1=$(echo "$RES1" | cut -d':' -f4-)

if [[ "$CODE1" == "401" || "$BODY1" == *"Invalid JWT"* || "$BODY1" == *"UNAUTHORIZED"* ]]; then
  echo "  ✅ Test 1 Passed: Invalid JWT rejected by Gateway (HTTP $CODE1)."
else
  echo "❌ TEST 1 FAILED: Expected HTTP 401 for fake JWT, got HTTP $CODE1."
  exit 1
fi

# TEST 2: Valid User Token + Empty Payload
echo "-> Test 2: Valid User Token + Empty Payload..."
RES2=$(call_func "Bearer $USER_TOKEN" "$ANON_KEY" '{"job_ids":[]}')
CODE2=$(echo "$RES2" | cut -d':' -f1)
BODY2=$(echo "$RES2" | cut -d':' -f4-)

if [ "$CODE2" != "200" ]; then
  echo "❌ TEST 2 FAILED: Expected HTTP 200, got HTTP $CODE2 (Body: $BODY2)"
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
  echo "❌ TEST 2 FAILED: Response JSON assertions failed: $BODY2"
  exit 1
fi
echo "  ✅ Test 2 Passed: Empty payload response JSON verified perfectly!"

# TEST 3: Valid User Token + Invalid Job IDs
echo "-> Test 3: Valid User Token + Invalid Job IDs..."
RES3=$(call_func "Bearer $USER_TOKEN" "$ANON_KEY" '{"job_ids":["invalid_uuid_123", null, 12345, {}]}')
CODE3=$(echo "$RES3" | cut -d':' -f1)
BODY3=$(echo "$RES3" | cut -d':' -f4-)

if [ "$CODE3" != "200" ]; then
  echo "❌ TEST 3 FAILED: Expected HTTP 200, got HTTP $CODE3 (Body: $BODY3)"
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
  echo "❌ TEST 3 FAILED: Invalid job IDs assertions failed: $BODY3"
  exit 1
fi
echo "  ✅ Test 3 Passed: Invalid job IDs handled fail-closed with valid counter invariants!"

# TEST 4: Valid User Token + Duplicate Job IDs (Case Insensitive)
echo "-> Test 4: Valid User Token + Duplicate Job IDs..."
RES4=$(call_func "Bearer $USER_TOKEN" "$ANON_KEY" '{"job_ids":["a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", "A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11"]}')
CODE4=$(echo "$RES4" | cut -d':' -f1)
BODY4=$(echo "$RES4" | cut -d':' -f4-)

if [ "$CODE4" != "200" ]; then
  echo "❌ TEST 4 FAILED: Expected HTTP 200, got HTTP $CODE4 (Body: $BODY4)"
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
  echo "❌ TEST 4 FAILED: Duplicate job IDs assertions failed: $BODY4"
  exit 1
fi
echo "  ✅ Test 4 Passed: Duplicate job IDs deduplicated properly with valid counter invariants!"

echo "================================================================="
echo "  ALL LOCAL EDGE FUNCTION INTEGRATION TESTS PASSED (EXIT CODE 0)"
echo "================================================================="
