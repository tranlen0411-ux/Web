#!/usr/bin/env bash
set -euo pipefail

echo "================================================================="
echo "  SUPABASE EDGE FUNCTION INTEGRATION VERIFICATION"
echo "================================================================="

FUNC_URL="${EDGE_FUNC_URL:-http://127.0.0.1:54321/functions/v1/cleanup-exercise-submission-files}"
ANON_KEY="${SUPABASE_ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.dummy_local_key}"

echo "1. Testing Empty Payload..."
RES=$(curl -s -X POST "$FUNC_URL" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"job_ids": []}')

echo "Response: $RES"

if [[ "$RES" == *"\"requested_count\":0"* && "$RES" == *"\"counter_invariant_valid\":true"* ]]; then
  echo "  ✅ Edge Function Test 1 (Empty Payload) Passed!"
else
  echo "❌ EDGE FUNCTION TEST FAILED: Empty payload response invalid."
  exit 1
fi

echo "2. Testing Invalid Job IDs Payload (null, number, invalid UUID format)..."
RES_INVALID=$(curl -s -X POST "$FUNC_URL" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"job_ids": ["invalid_uuid_123", null, 12345, {}]}')

echo "Response: $RES_INVALID"

if [[ "$RES_INVALID" == *"\"invalid_job_ids\""* && "$RES_INVALID" == *"\"counter_invariant_valid\":true"* ]]; then
  echo "  ✅ Edge Function Test 2 (Invalid Payload) Passed!"
else
  echo "❌ EDGE FUNCTION TEST FAILED: Invalid job IDs response failed."
  exit 1
fi

echo "3. Testing Duplicated Job IDs Payload..."
RES_DUP=$(curl -s -X POST "$FUNC_URL" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"job_ids": ["a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", "A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11"]}')

echo "Response: $RES_DUP"

if [[ "$RES_DUP" == *"\"counter_invariant_valid\":true"* ]]; then
  echo "  ✅ Edge Function Test 3 (Duplicated UUIDs) Passed!"
else
  echo "❌ EDGE FUNCTION TEST FAILED: Duplicated UUIDs check failed."
  exit 1
fi

echo "================================================================="
echo "  EDGE FUNCTION INTEGRATION TESTS COMPLETED SUCCESSFULLY"
echo "================================================================="
