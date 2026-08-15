#!/usr/bin/env bash
set -euo pipefail

echo "================================================================="
echo "  SUPABASE LOCAL ACADEMIC EXERCISES MIGRATION VERIFICATION (CI)"
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

PSQL_CMD="psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -v ON_ERROR_STOP=1"

echo "1. Running Baseline Schema (schema.sql)..."
$PSQL_CMD -f schema.sql

echo "2. Test A: Running ADD_ACADEMIC_EXERCISES.sql (First Execution)..."
$PSQL_CMD -f ADD_ACADEMIC_EXERCISES.sql
echo "  ✅ Test A Passed: Initial migration completed with Exit Code 0."

echo "3. Test B: Running ADD_ACADEMIC_EXERCISES.sql (Second Idempotent Execution)..."
$PSQL_CMD -f ADD_ACADEMIC_EXERCISES.sql
echo "  ✅ Test B Passed: Second migration execution completed idempotently with Exit Code 0."

echo "4. Running Post-Migration Verification SQL..."
if [ -f "supabase/tests/academic_exercises_verification.sql" ]; then
  $PSQL_CMD -f supabase/tests/academic_exercises_verification.sql
  echo "  ✅ Post-migration SQL assertions passed!"
fi

echo "================================================================="
echo "  ALL LOCAL MIGRATION TESTS PASSED SUCCESSFULLY (EXIT CODE 0)"
echo "================================================================="
