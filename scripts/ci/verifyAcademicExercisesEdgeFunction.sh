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
  echo "  ✅ Edge Function Empty Payload Test Passed!"
else
  echo "❌ EDGE FUNCTION TEST FAILED: Empty payload response invalid."
  exit 1
fi

echo "2. Testing Invalid Job IDs Payload..."
RES_INVALID=$(curl -s -X POST "$FUNC_URL" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"job_ids": ["invalid_uuid_123", null, 12345]}')

echo "Response: $RES_INVALID"

if [[ "$RES_INVALID" == *"\"invalid_job_ids\""* && "$RES_INVALID" == *"\"counter_invariant_valid\":true"* ]]; then
  echo "  ✅ Edge Function Invalid Job IDs Test Passed!"
else
  echo "❌ EDGE FUNCTION TEST FAILED: Invalid job IDs response failed."
  exit 1
fi

echo "================================================================="
echo "  EDGE FUNCTION INTEGRATION TESTS COMPLETED SUCCESSFULLY"
echo "================================================================="
