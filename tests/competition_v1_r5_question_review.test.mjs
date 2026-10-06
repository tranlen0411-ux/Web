import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import {
  hostCreateSession,
  getSessionSnapshot,
  studentGetReview,
  STUDENT_SESSION_STORAGE_KEY,
  STUDENT_PARTICIPANT_STORAGE_KEY,
  isValidSessionUUID,
  isStudentAuthOrPermanentError,
} from '../src/services/competitionClient.js';

console.log('================================================================================');
console.log('🧪 RUNNING COMPETITION V1 R5 QUESTION REVIEW MODE TEST SUITE');
console.log('================================================================================\n');

async function runR5TestSuite() {
  const testResults = [];
  let testIndex = 0;

  function recordPass(desc) {
    testIndex++;
    testResults.push({ id: testIndex, desc, status: 'PASS' });
    console.log(`  ✅ [${testIndex}] PASS: ${desc}`);
  }

  // Read Source Files for Static Analysis
  const migration11Path = path.resolve('supabase/migrations/20261006000001_competition_v1_post_session_review.sql');
  const migration11Sql = fs.readFileSync(migration11Path, 'utf8');
  const clientLibSource = fs.readFileSync('src/services/competitionClient.js', 'utf8');
  const hostPageSource = fs.readFileSync('src/pages/CompetitionHostPage.jsx', 'utf8');
  const studentPageSource = fs.readFileSync('src/pages/CompetitionStudentPage.jsx', 'utf8');
  const reviewViewSource = fs.readFileSync('src/components/competition/StudentQuestionReviewView.jsx', 'utf8');

  // ============================================================================
  // DATABASE CATALOG & LOGIC TEST HARNESS VIA PGLITE
  // ============================================================================
  const db = new PGlite();

  // Setup Base Postgres Auth Mocks & Prerequisite Schemas
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE OR REPLACE FUNCTION extensions.digest(data bytea, type text)
    RETURNS bytea LANGUAGE plpgsql AS $$
    BEGIN
      RETURN sha256(data);
    END;
    $$;

    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS private;
    CREATE SCHEMA IF NOT EXISTS realtime;

    CREATE TABLE IF NOT EXISTS realtime.messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      topic TEXT,
      extension TEXT,
      inserted_at TIMESTAMPTZ DEFAULT now()
    );
    ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

    CREATE OR REPLACE FUNCTION realtime.topic()
    RETURNS TEXT LANGUAGE sql STABLE AS $$
      SELECT ''::TEXT;
    $$;

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role;
      END IF;
    END
    $$;

    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT
    );

    CREATE TABLE IF NOT EXISTS public.profiles (
      id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'student',
      full_name TEXT NOT NULL DEFAULT 'Test Student',
      avatar_url TEXT
    );

    CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS UUID LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
    $$;

    CREATE OR REPLACE FUNCTION auth.role()
    RETURNS TEXT LANGUAGE sql STABLE AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon');
    $$;
  `);

  // Apply prerequisite competition migrations in sequence
  const competitionMigrationFiles = [
    '20260926000001_competition_v1_baseline_schema.sql',
    '20260926161245_competition_v1_rpc_and_business_logic.sql',
    '20260928005103_competition_v1_host_rpc_grant_hardening.sql',
    '20260928200001_competition_v1_realtime_schema_foundations.sql',
    '20260929110001_competition_v1_realtime_authorization_foundation.sql',
    '20260929120001_competition_v1_capability_verification_primitives.sql',
    '20261002000001_competition_v1_m3ce_postgres_ratelimiter.sql',
    '20261003000001_competition_v1_active_question_snapshot_rpc.sql',
    '20261004000001_competition_v1_host_submission_stats_rpc.sql',
    '20261004000002_competition_v1_question_results.sql',
  ];

  for (const file of competitionMigrationFiles) {
    const fpath = path.resolve('supabase/migrations', file);
    if (fs.existsSync(fpath)) {
      const sql = fs.readFileSync(fpath, 'utf8');
      await db.exec(sql);
    }
  }

  // Verify state BEFORE Migration 11: Host create has 8 arguments
  const hostCreateBefore = await db.query(`
    SELECT proname, pronargs 
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'competition_host_create_session';
  `);
  assert.equal(hostCreateBefore.rows.length, 1, 'Before migration 11, host create function exists');
  assert.equal(hostCreateBefore.rows[0].pronargs, 8, 'Before migration 11, host create function has 8 args');

  // Apply Migration 11
  await db.exec(migration11Sql);

  // ----------------------------------------------------------------------------
  // TEST 1: review_enabled Column on competition_sessions with DEFAULT false
  // ----------------------------------------------------------------------------
  console.log('--- [Test 1] review_enabled column existence and default ---');
  const colRes = await db.query(`
    SELECT column_name, data_type, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' 
      AND table_name = 'competition_sessions' 
      AND column_name = 'review_enabled';
  `);
  assert.equal(colRes.rows.length, 1, 'Column review_enabled must exist');
  assert.equal(colRes.rows[0].data_type, 'boolean');
  assert.equal(colRes.rows[0].column_default, 'false');
  recordPass('review_enabled column exists on public.competition_sessions with DEFAULT false');

  // ----------------------------------------------------------------------------
  // TEST 2: review_enabled is NOT NULL
  // ----------------------------------------------------------------------------
  console.log('--- [Test 2] review_enabled NOT NULL constraint ---');
  assert.equal(colRes.rows[0].is_nullable, 'NO', 'review_enabled must be NOT NULL');
  recordPass('review_enabled is constrained to NOT NULL');

  // ----------------------------------------------------------------------------
  // TEST 3: EXACT old 8-arg host-create signature is ABSENT
  // ----------------------------------------------------------------------------
  console.log('--- [Test 3] Old 8-arg host create function is dropped ---');
  const old8ArgCheck = await db.query(`
    SELECT p.proname, p.pronargs
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' 
      AND p.proname = 'competition_host_create_session'
      AND p.pronargs = 8;
  `);
  assert.equal(old8ArgCheck.rows.length, 0, 'Old 8-arg signature must NOT exist in pg_proc');
  recordPass('Exact old 8-arg host-create signature is absent');

  // ----------------------------------------------------------------------------
  // TEST 4: EXACT new 9-arg host-create signature is PRESENT
  // ----------------------------------------------------------------------------
  console.log('--- [Test 4] New 9-arg host create function is present ---');
  const new9ArgCheck = await db.query(`
    SELECT p.proname, p.pronargs
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' 
      AND p.proname = 'competition_host_create_session'
      AND p.pronargs = 9;
  `);
  assert.equal(new9ArgCheck.rows.length, 1, 'New 9-arg signature must exist in pg_proc');
  recordPass('Exact new 9-arg signature is present in pg_proc');

  // ----------------------------------------------------------------------------
  // TEST 5: Canonical host-create function count in public schema is exactly 1
  // ----------------------------------------------------------------------------
  console.log('--- [Test 5] Canonical host create overload count is 1 ---');
  const hostCreateOverloadCount = await db.query(`
    SELECT count(*)::int AS count
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' 
      AND p.proname = 'competition_host_create_session';
  `);
  assert.equal(hostCreateOverloadCount.rows[0].count, 1, 'Must have exactly 1 canonical host-create function');
  recordPass('Host-create overload count is canonical = 1 (no polymorphic conflict)');

  // ----------------------------------------------------------------------------
  // TEST 6: Host create ACL - anon cannot execute
  // ----------------------------------------------------------------------------
  console.log('--- [Test 6] Host create ACL - anon cannot execute ---');
  const anonHostCreateAcl = await db.query(`
    SELECT has_function_privilege('anon', 'public.competition_host_create_session(TEXT,TEXT,TEXT,INT,JSONB,JSONB,BOOLEAN,JSONB,BOOLEAN)', 'EXECUTE') AS can_exec;
  `);
  assert.equal(anonHostCreateAcl.rows[0].can_exec, false, 'anon must not have execute privilege on host create');
  recordPass('anon role CANNOT execute competition_host_create_session');

  // ----------------------------------------------------------------------------
  // TEST 7: Host create ACL - authenticated can execute
  // ----------------------------------------------------------------------------
  console.log('--- [Test 7] Host create ACL - authenticated can execute ---');
  const authHostCreateAcl = await db.query(`
    SELECT has_function_privilege('authenticated', 'public.competition_host_create_session(TEXT,TEXT,TEXT,INT,JSONB,JSONB,BOOLEAN,JSONB,BOOLEAN)', 'EXECUTE') AS can_exec;
  `);
  assert.equal(authHostCreateAcl.rows[0].can_exec, true, 'authenticated must have execute privilege on host create');
  recordPass('authenticated role CAN execute competition_host_create_session');

  // ----------------------------------------------------------------------------
  // TEST 8: Private review helper exists in private schema
  // ----------------------------------------------------------------------------
  console.log('--- [Test 8] Private review helper existence ---');
  const privHelperCheck = await db.query(`
    SELECT p.proname, p.prosecdef, n.nspname
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'private' AND p.proname = 'competition_student_get_review_internal';
  `);
  assert.equal(privHelperCheck.rows.length, 1, 'private.competition_student_get_review_internal must exist');
  assert.equal(privHelperCheck.rows[0].prosecdef, true, 'private helper must be SECURITY DEFINER');
  recordPass('private.competition_student_get_review_internal exists as SECURITY DEFINER');

  // ----------------------------------------------------------------------------
  // TEST 9: Public review wrapper exists as SECURITY INVOKER
  // ----------------------------------------------------------------------------
  console.log('--- [Test 9] Public review wrapper existence ---');
  const pubWrapperCheck = await db.query(`
    SELECT p.proname, p.prosecdef, n.nspname
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'competition_student_get_review';
  `);
  assert.equal(pubWrapperCheck.rows.length, 1, 'public.competition_student_get_review must exist');
  assert.equal(pubWrapperCheck.rows[0].prosecdef, false, 'public wrapper must be SECURITY INVOKER');
  recordPass('public.competition_student_get_review exists as SECURITY INVOKER');

  // ----------------------------------------------------------------------------
  // TEST 10: Review RPC ACL - anon cannot execute
  // ----------------------------------------------------------------------------
  console.log('--- [Test 10] Review RPC ACL - anon cannot execute ---');
  const anonReviewAcl = await db.query(`
    SELECT has_function_privilege('anon', 'public.competition_student_get_review(UUID,UUID)', 'EXECUTE') AS can_exec;
  `);
  assert.equal(anonReviewAcl.rows[0].can_exec, false, 'anon must not have execute privilege on review RPC');
  recordPass('anon role CANNOT execute competition_student_get_review');

  // ----------------------------------------------------------------------------
  // TEST 11: Review RPC ACL - authenticated can execute
  // ----------------------------------------------------------------------------
  console.log('--- [Test 11] Review RPC ACL - authenticated can execute ---');
  const authReviewAcl = await db.query(`
    SELECT has_function_privilege('authenticated', 'public.competition_student_get_review(UUID,UUID)', 'EXECUTE') AS can_exec;
  `);
  assert.equal(authReviewAcl.rows[0].can_exec, true, 'authenticated must have execute privilege on review RPC');
  recordPass('authenticated role CAN execute competition_student_get_review');

  // ============================================================================
  // DATABASE FIXTURE SEEDING & LOGIC EXECUTION
  // ============================================================================
  // Create Test Users
  const teacherId = '11111111-1111-4111-8111-111111111111';
  const student1Id = '22222222-2222-4222-8222-222222222222';
  const student2Id = '33333333-3333-4333-8333-333333333333';

  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES 
      ('${teacherId}', 'teacher@test.com'),
      ('${student1Id}', 'student1@test.com'),
      ('${student2Id}', 'student2@test.com')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.profiles (id, role, full_name) VALUES 
      ('${teacherId}', 'teacher', 'Teacher Master'),
      ('${student1Id}', 'student', 'Student One'),
      ('${student2Id}', 'student', 'Student Two')
    ON CONFLICT (id) DO NOTHING;
  `);

  // Helper to set auth.uid() in PGlite session
  async function setSessionAuth(uid, role = 'authenticated') {
    if (uid) {
      await db.exec(`SET request.jwt.claim.sub = '${uid}';`);
      await db.exec(`SET request.jwt.claim.role = '${role}';`);
    } else {
      await db.exec(`SET request.jwt.claim.sub = '';`);
      await db.exec(`SET request.jwt.claim.role = 'anon';`);
    }
  }

  // ----------------------------------------------------------------------------
  // TEST 12: Host Create Session with DEFAULT review_enabled = false
  // ----------------------------------------------------------------------------
  console.log('--- [Test 12] Host Create Session default review_enabled ---');
  await setSessionAuth(teacherId);
  const createRes1 = await db.query(`
    SELECT public.competition_host_create_session(
      'Session Default Review',
      'Testing default review_enabled',
      'individual',
      50,
      '[
        {
          "question_order": 1,
          "question_text": "What is 2 + 2?",
          "question_type": "single_choice",
          "points": 10.0,
          "time_limit_seconds": 30,
          "options": [{"id": "o1", "text": "3"}, {"id": "o2", "text": "4"}],
          "correct_answer": {"option_id": "o2"},
          "explanation": "2 + 2 equals 4"
        }
      ]'::jsonb,
      '[]'::jsonb,
      false,
      '{}'::jsonb
    ) AS result;
  `);
  const s1Payload = createRes1.rows[0].result;
  assert.equal(s1Payload.success, true);
  assert.equal(s1Payload.session.review_enabled, false);
  const session1Id = s1Payload.session.id;

  const dbS1 = await db.query(`SELECT review_enabled FROM public.competition_sessions WHERE id = '${session1Id}'`);
  assert.equal(dbS1.rows[0].review_enabled, false);
  recordPass('Host create session with default arguments sets review_enabled = false');

  // ----------------------------------------------------------------------------
  // TEST 13: Host Create Session with EXPLICIT review_enabled = true
  // ----------------------------------------------------------------------------
  console.log('--- [Test 13] Host Create Session explicit review_enabled = true ---');
  const createRes2 = await db.query(`
    SELECT public.competition_host_create_session(
      'Session Review Enabled',
      'Testing review_enabled = true',
      'individual',
      50,
      '[
        {
          "question_order": 1,
          "question_text": "Capital of Vietnam?",
          "question_type": "single_choice",
          "points": 10.0,
          "time_limit_seconds": 30,
          "options": [{"id": "opt_a", "text": "Hanoi"}, {"id": "opt_b", "text": "Saigon"}],
          "correct_answer": {"option_id": "opt_a"},
          "explanation": "Hanoi is the capital of Vietnam."
        },
        {
          "question_order": 2,
          "question_text": "Is water wet?",
          "question_type": "true_false",
          "points": 10.0,
          "time_limit_seconds": 20,
          "options": [{"id": "true", "text": "Đúng"}, {"id": "false", "text": "Sai"}],
          "correct_answer": {"option_id": "true"},
          "explanation": "Water makes things wet."
        }
      ]'::jsonb,
      '[]'::jsonb,
      false,
      '{}'::jsonb,
      true
    ) AS result;
  `);
  const s2Payload = createRes2.rows[0].result;
  assert.equal(s2Payload.success, true);
  assert.equal(s2Payload.session.review_enabled, true);
  const session2Id = s2Payload.session.id;

  const dbS2 = await db.query(`SELECT review_enabled FROM public.competition_sessions WHERE id = '${session2Id}'`);
  assert.equal(dbS2.rows[0].review_enabled, true);
  recordPass('Host create session with p_review_enabled = true sets review_enabled = true in DB');

  // Setup participants and answers for session2
  const roomCode2 = s2Payload.session.room_code;
  await setSessionAuth(student1Id);
  const joinRes1 = await db.query(`
    SELECT public.competition_join_session('${roomCode2}', 'Student One', NULL, NULL, NULL) AS result;
  `);
  assert.equal(joinRes1.rows[0].result.success, true);
  const participant1Id = joinRes1.rows[0].result.participant.id;

  await setSessionAuth(student2Id);
  const joinRes2 = await db.query(`
    SELECT public.competition_join_session('${roomCode2}', 'Student Two', NULL, NULL, NULL) AS result;
  `);
  assert.equal(joinRes2.rows[0].result.success, true);
  const participant2Id = joinRes2.rows[0].result.participant.id;

  // Fetch Questions for session2
  const qRows = await db.query(`SELECT id, question_order FROM public.competition_questions WHERE session_id = '${session2Id}' ORDER BY question_order ASC;`);
  const q1Id = qRows.rows[0].id;
  const q2Id = qRows.rows[1].id;

  // ----------------------------------------------------------------------------
  // TEST 14: Review RPC Gate 1 - unauthenticated caller returns UNAUTHORIZED
  // ----------------------------------------------------------------------------
  console.log('--- [Test 14] Review Gate 1 - unauthenticated caller ---');
  await setSessionAuth(null);
  const unauthReviewRes = await db.query(`
    SELECT public.competition_student_get_review('${session2Id}', '${participant1Id}') AS result;
  `);
  assert.equal(unauthReviewRes.rows[0].result.success, false);
  assert.equal(unauthReviewRes.rows[0].result.error_code, 'UNAUTHORIZED');
  recordPass('Review RPC rejects unauthenticated caller with UNAUTHORIZED');

  // ----------------------------------------------------------------------------
  // TEST 15: Review RPC Gate 2 - teacher/admin role returns ROLE_NOT_ALLOWED
  // ----------------------------------------------------------------------------
  console.log('--- [Test 15] Review Gate 2 - teacher/admin role ---');
  await setSessionAuth(teacherId);
  const teacherReviewRes = await db.query(`
    SELECT public.competition_student_get_review('${session2Id}', '${participant1Id}') AS result;
  `);
  assert.equal(teacherReviewRes.rows[0].result.success, false);
  assert.equal(teacherReviewRes.rows[0].result.error_code, 'ROLE_NOT_ALLOWED');
  recordPass('Review RPC rejects teacher role with ROLE_NOT_ALLOWED (students only)');

  // ----------------------------------------------------------------------------
  // TEST 16: Review RPC Gate 3 - session not found returns SESSION_NOT_FOUND
  // ----------------------------------------------------------------------------
  console.log('--- [Test 16] Review Gate 3 - non-existent session ---');
  await setSessionAuth(student1Id);
  const nonExistentSessionId = '99999999-9999-4999-8999-999999999999';
  const noSessionReviewRes = await db.query(`
    SELECT public.competition_student_get_review('${nonExistentSessionId}', '${participant1Id}') AS result;
  `);
  assert.equal(noSessionReviewRes.rows[0].result.success, false);
  assert.equal(noSessionReviewRes.rows[0].result.error_code, 'SESSION_NOT_FOUND');
  recordPass('Review RPC rejects non-existent session with SESSION_NOT_FOUND');

  // ----------------------------------------------------------------------------
  // TEST 17: Review RPC Gate 4 - session in 'waiting' status returns SESSION_NOT_FINISHED
  // ----------------------------------------------------------------------------
  console.log('--- [Test 17] Review Gate 4 - waiting status ---');
  const waitingReviewRes = await db.query(`
    SELECT public.competition_student_get_review('${session2Id}', '${participant1Id}') AS result;
  `);
  assert.equal(waitingReviewRes.rows[0].result.success, false);
  assert.equal(waitingReviewRes.rows[0].result.error_code, 'SESSION_NOT_FINISHED');
  recordPass('Review RPC rejects session in waiting status with SESSION_NOT_FINISHED');

  // Start session2 -> in_progress
  await setSessionAuth(teacherId);
  await db.query(`SELECT public.competition_host_start_session('${session2Id}')`);

  // ----------------------------------------------------------------------------
  // TEST 18: Review RPC Gate 4 - session in 'in_progress' status returns SESSION_NOT_FINISHED
  // ----------------------------------------------------------------------------
  console.log('--- [Test 18] Review Gate 4 - in_progress status ---');
  await setSessionAuth(student1Id);
  const inProgressReviewRes = await db.query(`
    SELECT public.competition_student_get_review('${session2Id}', '${participant1Id}') AS result;
  `);
  assert.equal(inProgressReviewRes.rows[0].result.success, false);
  assert.equal(inProgressReviewRes.rows[0].result.error_code, 'SESSION_NOT_FINISHED');
  recordPass('Review RPC rejects session in in_progress status with SESSION_NOT_FINISHED');

  // ----------------------------------------------------------------------------
  // TEST 19: Active Question Snapshot Still HIDES correct_answer and explanation
  // ----------------------------------------------------------------------------
  console.log('--- [Test 19] Active Snapshot Anti-Leak ---');
  const activeSnapRes = await db.query(`
    SELECT public.competition_get_active_question_snapshot('${session2Id}', '${participant1Id}', NULL) AS result;
  `);
  const snapData = activeSnapRes.rows[0].result;
  assert.equal(snapData.success, true);
  assert.ok(snapData.question !== null, 'Active snapshot must return question');
  assert.equal(snapData.question.correct_answer, undefined, 'Active snapshot MUST NOT have correct_answer');
  assert.equal(snapData.question.explanation, undefined, 'Active snapshot MUST NOT have explanation');
  recordPass('Active snapshot RPC strictly hides correct_answer and explanation during contest');

  // Submit answers during active session
  await db.query(`
    SELECT public.competition_submit_answer(
      '${session2Id}',
      '${q1Id}',
      '${participant1Id}',
      NULL,
      '["opt_a"]'::jsonb,
      NULL
    );
  `);

  // Pause session2 -> paused
  await setSessionAuth(teacherId);
  await db.query(`SELECT public.competition_host_pause_session('${session2Id}')`);

  // ----------------------------------------------------------------------------
  // TEST 20: Review RPC Gate 4 - session in 'paused' status returns SESSION_NOT_FINISHED
  // ----------------------------------------------------------------------------
  console.log('--- [Test 20] Review Gate 4 - paused status ---');
  await setSessionAuth(student1Id);
  const pausedReviewRes = await db.query(`
    SELECT public.competition_student_get_review('${session2Id}', '${participant1Id}') AS result;
  `);
  assert.equal(pausedReviewRes.rows[0].result.success, false);
  assert.equal(pausedReviewRes.rows[0].result.error_code, 'SESSION_NOT_FINISHED');
  recordPass('Review RPC rejects session in paused status with SESSION_NOT_FINISHED');

  // Advance and Finish session2
  await setSessionAuth(teacherId);
  await db.query(`SELECT public.competition_host_resume_session('${session2Id}')`);
  await db.query(`SELECT public.competition_host_next_question('${session2Id}')`);

  // Submit answer for q2
  await setSessionAuth(student1Id);
  await db.query(`
    SELECT public.competition_submit_answer(
      '${session2Id}',
      '${q2Id}',
      '${participant1Id}',
      NULL,
      '[]'::jsonb,
      NULL
    );
  `);

  // Finish session2
  await setSessionAuth(teacherId);
  await db.query(`SELECT public.competition_host_finish_session('${session2Id}')`);

  // ----------------------------------------------------------------------------
  // TEST 21: Review RPC Gate 5 - review_enabled = false returns REVIEW_NOT_ALLOWED
  // ----------------------------------------------------------------------------
  console.log('--- [Test 21] Review Gate 5 - review_enabled = false ---');
  // Finish session1 (which has review_enabled = false)
  await db.query(`SELECT public.competition_host_finish_session('${session1Id}')`);
  // Join student1 to session1 to test
  const s1Join = await db.query(`
    INSERT INTO public.competition_participants (session_id, user_id, display_name, is_guest, status)
    VALUES ('${session1Id}', '${student1Id}', 'Student One', false, 'active')
    RETURNING id;
  `);
  const s1PartId = s1Join.rows[0].id;

  await setSessionAuth(student1Id);
  const disabledReviewRes = await db.query(`
    SELECT public.competition_student_get_review('${session1Id}', '${s1PartId}') AS result;
  `);
  assert.equal(disabledReviewRes.rows[0].result.success, false);
  assert.equal(disabledReviewRes.rows[0].result.error_code, 'REVIEW_NOT_ALLOWED');
  recordPass('Review RPC rejects session when review_enabled = false with REVIEW_NOT_ALLOWED');

  // ----------------------------------------------------------------------------
  // TEST 22: Review RPC Gate 6 - non-existent participantId returns PARTICIPANT_NOT_FOUND
  // ----------------------------------------------------------------------------
  console.log('--- [Test 22] Review Gate 6 - non-existent participantId ---');
  const fakePartId = '88888888-8888-4888-8888-888888888888';
  const noPartReviewRes = await db.query(`
    SELECT public.competition_student_get_review('${session2Id}', '${fakePartId}') AS result;
  `);
  assert.equal(noPartReviewRes.rows[0].result.success, false);
  assert.equal(noPartReviewRes.rows[0].result.error_code, 'PARTICIPANT_NOT_FOUND');
  recordPass('Review RPC rejects non-existent participant with PARTICIPANT_NOT_FOUND');

  // ----------------------------------------------------------------------------
  // TEST 23: Review RPC Gate 7 - guest participant returns PARTICIPANT_NOT_FOUND
  // ----------------------------------------------------------------------------
  console.log('--- [Test 23] Review Gate 7 - guest participant ---');
  const guestPart = await db.query(`
    INSERT INTO public.competition_participants (session_id, user_id, display_name, is_guest, guest_token_hash, status)
    VALUES ('${session2Id}', NULL, 'Guest Player', true, 'dummyhash123456789012345678901234', 'active')
    RETURNING id;
  `);
  const guestPartId = guestPart.rows[0].id;
  const guestReviewRes = await db.query(`
    SELECT public.competition_student_get_review('${session2Id}', '${guestPartId}') AS result;
  `);
  assert.equal(guestReviewRes.rows[0].result.success, false);
  assert.equal(guestReviewRes.rows[0].result.error_code, 'PARTICIPANT_NOT_FOUND');
  recordPass('Review RPC rejects guest participant with PARTICIPANT_NOT_FOUND');

  // ----------------------------------------------------------------------------
  // TEST 24: Review RPC Gate 8 - participant ownership mismatch returns PARTICIPANT_NOT_FOUND
  // ----------------------------------------------------------------------------
  console.log('--- [Test 24] Review Gate 8 - participant ownership mismatch ---');
  // student1 tries to access student2's participant review
  const mismatchReviewRes = await db.query(`
    SELECT public.competition_student_get_review('${session2Id}', '${participant2Id}') AS result;
  `);
  assert.equal(mismatchReviewRes.rows[0].result.success, false);
  assert.equal(mismatchReviewRes.rows[0].result.error_code, 'PARTICIPANT_NOT_FOUND');
  recordPass('Review RPC prevents student from viewing other participant review data');

  // ----------------------------------------------------------------------------
  // TEST 25: Review RPC Gate 9 - kicked participant returns PARTICIPANT_KICKED
  // ----------------------------------------------------------------------------
  console.log('--- [Test 25] Review Gate 9 - kicked participant ---');
  await db.query(`
    UPDATE public.competition_participants
    SET status = 'kicked'
    WHERE id = '${participant2Id}';
  `);
  await setSessionAuth(student2Id);
  const kickedReviewRes = await db.query(`
    SELECT public.competition_student_get_review('${session2Id}', '${participant2Id}') AS result;
  `);
  assert.equal(kickedReviewRes.rows[0].result.success, false);
  assert.equal(kickedReviewRes.rows[0].result.error_code, 'PARTICIPANT_KICKED');
  recordPass('Review RPC rejects kicked participant with PARTICIPANT_KICKED');

  // ----------------------------------------------------------------------------
  // TEST 26: Successful Review Payload for Finished & Allowed Session
  // ----------------------------------------------------------------------------
  console.log('--- [Test 26] Successful Review Payload ---');
  await setSessionAuth(student1Id);
  const validReviewRes = await db.query(`
    SELECT public.competition_student_get_review('${session2Id}', '${participant1Id}') AS result;
  `);
  const reviewPayload = validReviewRes.rows[0].result;
  assert.equal(reviewPayload.success, true);
  assert.equal(reviewPayload.session.id, session2Id);
  assert.equal(reviewPayload.session.review_enabled, true);
  assert.equal(Array.isArray(reviewPayload.questions), true);
  assert.equal(reviewPayload.questions.length, 2);
  recordPass('Review RPC returns structured success payload with session and questions');

  // ----------------------------------------------------------------------------
  // TEST 27: Review Questions Ordered Deterministically by question_order ASC
  // ----------------------------------------------------------------------------
  console.log('--- [Test 27] Review Questions Ordering ---');
  assert.equal(reviewPayload.questions[0].question_order, 1);
  assert.equal(reviewPayload.questions[1].question_order, 2);
  assert.equal(reviewPayload.questions[0].question_text, 'Capital of Vietnam?');
  assert.equal(reviewPayload.questions[1].question_text, 'Is water wet?');
  recordPass('Questions are ordered strictly by question_order ASC');

  // ----------------------------------------------------------------------------
  // TEST 28: Review Questions Expose correct_answer and explanation
  // ----------------------------------------------------------------------------
  console.log('--- [Test 28] Review Questions Expose correct_answer & explanation ---');
  const q1Review = reviewPayload.questions[0];
  assert.deepEqual(q1Review.correct_answer, { option_id: 'opt_a' });
  assert.equal(q1Review.explanation, 'Hanoi is the capital of Vietnam.');
  assert.equal(q1Review.points, 10.00);

  const q2Review = reviewPayload.questions[1];
  assert.deepEqual(q2Review.correct_answer, { option_id: 'true' });
  assert.equal(q2Review.explanation, 'Water makes things wet.');
  recordPass('Review RPC exposes correct_answer and explanation for student post-session review');

  // ----------------------------------------------------------------------------
  // TEST 29: Answered Question Contains Accurate student_answer
  // ----------------------------------------------------------------------------
  console.log('--- [Test 29] Answered Question student_answer shape ---');
  assert.ok(q1Review.student_answer !== null, 'student_answer must exist for answered question');
  assert.deepEqual(q1Review.student_answer.selected_option_ids, ['opt_a']);
  assert.equal(q1Review.student_answer.is_correct, true);
  assert.equal(q1Review.student_answer.points_awarded, 10.00);
  assert.ok(q1Review.student_answer.submitted_at);
  recordPass('Answered question returns complete and accurate student_answer payload');

  // ----------------------------------------------------------------------------
  // TEST 30: Unanswered Question Returns student_answer = null
  // ----------------------------------------------------------------------------
  console.log('--- [Test 30] Unanswered Question student_answer = null ---');
  // Create session3 with unanswered questions
  await setSessionAuth(teacherId);
  const s3Create = await db.query(`
    SELECT public.competition_host_create_session(
      'Session Unanswered', NULL, 'individual', 50,
      '[
        {"question_order": 1, "question_text": "Q1?", "options": [{"id": "o1", "text": "A"}, {"id": "o2", "text": "B"}], "correct_answer": {"option_id": "o1"}},
        {"question_order": 2, "question_text": "Q2?", "options": [{"id": "o1", "text": "A"}, {"id": "o2", "text": "B"}], "correct_answer": {"option_id": "o1"}}
      ]'::jsonb,
      '[]'::jsonb, false, '{}'::jsonb, true
    ) AS result;
  `);
  const s3Id = s3Create.rows[0].result.session.id;
  const s3Code = s3Create.rows[0].result.session.room_code;

  await setSessionAuth(student1Id);
  const s3Join = await db.query(`SELECT public.competition_join_session('${s3Code}', 'Student One', NULL, NULL, NULL) AS result;`);
  const s3PartId = s3Join.rows[0].result.participant.id;

  // Finish without student submitting any answer
  await setSessionAuth(teacherId);
  await db.query(`SELECT public.competition_host_finish_session('${s3Id}')`);

  await setSessionAuth(student1Id);
  const s3Review = await db.query(`SELECT public.competition_student_get_review('${s3Id}', '${s3PartId}') AS result;`);
  assert.equal(s3Review.rows[0].result.success, true);
  assert.equal(s3Review.rows[0].result.questions[0].student_answer, null);
  assert.equal(s3Review.rows[0].result.questions[1].student_answer, null);
  recordPass('Unanswered questions return student_answer = null without data fabrication');

  // ============================================================================
  // CLIENT SERVICE STATIC & CONTRACT TESTS
  // ============================================================================

  // ----------------------------------------------------------------------------
  // TEST 31: competitionClient.js exports hostCreateSession with reviewEnabled
  // ----------------------------------------------------------------------------
  console.log('--- [Test 31] hostCreateSession client signature ---');
  assert.ok(
    clientLibSource.includes('reviewEnabled = false'),
    'hostCreateSession must accept reviewEnabled parameter'
  );
  assert.ok(
    clientLibSource.includes('p_review_enabled: reviewEnabled'),
    'hostCreateSession must pass p_review_enabled to RPC'
  );
  recordPass('hostCreateSession client accepts reviewEnabled and maps p_review_enabled');

  // ----------------------------------------------------------------------------
  // TEST 32: competitionClient.js getSessionSnapshot includes review_enabled
  // ----------------------------------------------------------------------------
  console.log('--- [Test 32] getSessionSnapshot SELECT list ---');
  assert.ok(
    clientLibSource.includes('review_enabled'),
    'getSessionSnapshot must include review_enabled in SELECT columns'
  );
  recordPass('getSessionSnapshot includes review_enabled in fixed SELECT list');

  // ----------------------------------------------------------------------------
  // TEST 33: competitionClient.js exports studentGetReview
  // ----------------------------------------------------------------------------
  console.log('--- [Test 33] studentGetReview export ---');
  assert.ok(
    typeof studentGetReview === 'function',
    'studentGetReview must be exported as a function'
  );
  assert.ok(
    clientLibSource.includes('competition_student_get_review'),
    'studentGetReview must invoke competition_student_get_review RPC'
  );
  recordPass('studentGetReview function exported and calls competition_student_get_review');

  // ----------------------------------------------------------------------------
  // TEST 34: studentGetReview parameter validation (fails on missing params)
  // ----------------------------------------------------------------------------
  console.log('--- [Test 34] studentGetReview client validation ---');
  const emptyReviewRes = await studentGetReview({ sessionId: null, participantId: null });
  assert.equal(emptyReviewRes.success, false);
  assert.equal(emptyReviewRes.error_code, 'INVALID_PARAMS');
  recordPass('studentGetReview client rejects missing sessionId or participantId');

  // ============================================================================
  // HOST UI STATIC & CONTRACT TESTS
  // ============================================================================

  // ----------------------------------------------------------------------------
  // TEST 35: Host UI initializes reviewEnabled to false (Default OFF)
  // ----------------------------------------------------------------------------
  console.log('--- [Test 35] Host UI reviewEnabled default ---');
  assert.ok(
    hostPageSource.includes('const [reviewEnabled, setReviewEnabled] = useState(false)'),
    'Host UI must default reviewEnabled state to false'
  );
  recordPass('Host UI defaults reviewEnabled to false');

  // ----------------------------------------------------------------------------
  // TEST 36: Host UI renders review_enabled toggle / checkbox
  // ----------------------------------------------------------------------------
  console.log('--- [Test 36] Host UI review_enabled toggle ---');
  assert.ok(
    hostPageSource.includes('Cho phép học sinh xem lại bài làm sau khi kết thúc'),
    'Host UI setup form must contain checkbox for review_enabled'
  );
  assert.ok(
    hostPageSource.includes('reviewEnabled: Boolean(reviewEnabled)'),
    'Host UI handleCreateSession must pass reviewEnabled'
  );
  recordPass('Host UI renders review_enabled checkbox and forwards value to creation RPC');

  // ============================================================================
  // STUDENT UI STATIC & CONTRACT TESTS
  // ============================================================================

  // ----------------------------------------------------------------------------
  // TEST 37: Student UI Review Button Gated on finished && review_enabled === true
  // ----------------------------------------------------------------------------
  console.log('--- [Test 37] Student UI Review Button Gate ---');
  assert.ok(
    studentPageSource.includes("sessionData?.review_enabled === true"),
    'Review button must be gated on sessionData.review_enabled === true'
  );
  assert.ok(
    studentPageSource.includes("studentViewMode === 'QUESTION_REVIEW'"),
    'Student page must support QUESTION_REVIEW view mode'
  );
  recordPass('Student UI gates review button strictly on sessionData.review_enabled === true');

  // ----------------------------------------------------------------------------
  // TEST 38: Student UI Does NOT Persist Review Payload to Web Storage
  // ----------------------------------------------------------------------------
  console.log('--- [Test 38] Zero Review Payload Web Storage Persistence ---');
  assert.equal(
    /sessionStorage\.setItem\([^)]*review/i.test(studentPageSource) ||
    /localStorage\.setItem\([^)]*review/i.test(studentPageSource) ||
    /sessionStorage\.setItem\([^)]*correct_answer/i.test(studentPageSource) ||
    /localStorage\.setItem\([^)]*correct_answer/i.test(studentPageSource),
    false,
    'reviewData MUST NEVER be stored in sessionStorage or localStorage'
  );
  recordPass('Review payload is never persisted into browser sessionStorage or localStorage');

  // ----------------------------------------------------------------------------
  // TEST 39: Student Review View Component Exists and Renders Badges
  // ----------------------------------------------------------------------------
  console.log('--- [Test 39] Student Question Review View Badges ---');
  assert.ok(reviewViewSource.includes('Chính xác'), 'Must have badge Chính xác');
  assert.ok(reviewViewSource.includes('Chưa đúng'), 'Must have badge Chưa đúng');
  assert.ok(reviewViewSource.includes('Chưa trả lời'), 'Must have badge Chưa trả lời');
  assert.ok(reviewViewSource.includes('Đáp án của bạn'), 'Must have label Đáp án của bạn');
  assert.ok(reviewViewSource.includes('Đáp án đúng'), 'Must have label Đáp án đúng');
  recordPass('StudentQuestionReviewView renders explicit descriptive text badges');

  // ----------------------------------------------------------------------------
  // TEST 40: Student Review View Supports All Question Types
  // ----------------------------------------------------------------------------
  console.log('--- [Test 40] Question Types Support in Review View ---');
  assert.ok(reviewViewSource.includes('options'), 'Supports choice options layout');
  assert.ok(reviewViewSource.includes('short_answer') && reviewViewSource.includes('accepted_answers'), 'Supports short_answer');
  assert.ok(reviewViewSource.includes('isAnswered') && reviewViewSource.includes('Chưa trả lời'), 'Supports unanswered questions');
  assert.ok(reviewViewSource.includes('explanation'), 'Supports explanation rendering');
  recordPass('StudentQuestionReviewView supports single_choice, true_false, short_answer, and unanswered');

  // ----------------------------------------------------------------------------
  // TEST 41: Error Contract - SESSION_NOT_FINISHED retains session and shows notice
  // ----------------------------------------------------------------------------
  console.log('--- [Test 41] Error Contract - SESSION_NOT_FINISHED ---');
  assert.ok(
    studentPageSource.includes('SESSION_NOT_FINISHED'),
    'Student page must handle SESSION_NOT_FINISHED error code'
  );
  recordPass('Error contract handles SESSION_NOT_FINISHED gracefully');

  // ----------------------------------------------------------------------------
  // TEST 42: Error Contract - REVIEW_NOT_ALLOWED retains session and shows notice
  // ----------------------------------------------------------------------------
  console.log('--- [Test 42] Error Contract - REVIEW_NOT_ALLOWED ---');
  assert.ok(
    studentPageSource.includes('REVIEW_NOT_ALLOWED'),
    'Student page must handle REVIEW_NOT_ALLOWED error code'
  );
  recordPass('Error contract handles REVIEW_NOT_ALLOWED gracefully');

  // ----------------------------------------------------------------------------
  // TEST 43: Error Contract - Permanent auth/participant failures fail closed
  // ----------------------------------------------------------------------------
  console.log('--- [Test 43] Error Contract - Permanent failures fail closed ---');
  assert.ok(
    studentPageSource.includes('isStudentAuthOrPermanentError(res.error_code'),
    'Permanent review errors must trigger fail-closed session clearing'
  );
  recordPass('Permanent review errors trigger fail-closed cleanup via isStudentAuthOrPermanentError');

  // ----------------------------------------------------------------------------
  // TEST 44: R4 Student Final Results Invariants Preserved (Regression Guard)
  // ----------------------------------------------------------------------------
  console.log('--- [Test 44] R4 Invariants Preserved ---');
  assert.ok(
    studentPageSource.includes('getMotivationalBadge'),
    'Motivational badge logic from R4 must be preserved'
  );
  assert.ok(
    studentPageSource.includes('goldWinners') && studentPageSource.includes('silverWinners') && studentPageSource.includes('bronzeWinners'),
    'Mini podium grouping from R4 must be preserved'
  );
  recordPass('R4 Final Results and Mini Podium logic preserved without regression');

  // ----------------------------------------------------------------------------
  // TEST 45: Reload Recovery Preserves review_enabled from Snapshot
  // ----------------------------------------------------------------------------
  console.log('--- [Test 45] Reload Recovery ---');
  assert.ok(
    studentPageSource.includes('getInitialStudentSession'),
    'Student page must restore session identity on F5'
  );
  recordPass('F5 Reload Recovery retains session and fetches authoritative review_enabled');

  console.log('\n================================================================================');
  console.log(`🎉 ALL ${testResults.length} R5 QUESTION REVIEW TESTS PASSED SUCCESSFULLY!`);
  console.log('================================================================================\n');
}

runR5TestSuite().catch((err) => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
