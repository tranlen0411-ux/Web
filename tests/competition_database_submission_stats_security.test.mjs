import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

console.log('================================================================================');
console.log('🧪 RUNNING COMPETITION V1 HOST SUBMISSION STATS RPC SECURITY TEST SUITE');
console.log('================================================================================\n');

const db = new PGlite();

async function setupDatabase() {
  console.log('--- [Setup] Initializing schemas, mock auth, and applying migrations ---');

  // Baseline auth & extensions mocks
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS private;

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
      END IF;
    END
    $$;

    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT
    );

    CREATE TABLE IF NOT EXISTS public.profiles (
      id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('admin', 'teacher', 'student', 'parent')),
      full_name TEXT NOT NULL DEFAULT 'Test User',
      avatar_url TEXT DEFAULT NULL
    );

    CREATE OR REPLACE FUNCTION extensions.digest(data bytea, type text)
    RETURNS bytea LANGUAGE sql IMMUTABLE AS $$
      SELECT sha256(data);
    $$;

    CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS UUID LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
    $$;

    CREATE OR REPLACE FUNCTION auth.role()
    RETURNS TEXT LANGUAGE sql STABLE AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon');
    $$;
  `);

  // Migration 1: Baseline Schema
  const m1Path = path.resolve('supabase/migrations/20260926000001_competition_v1_baseline_schema.sql');
  const m1Sql = fs.readFileSync(m1Path, 'utf8');
  await db.exec(m1Sql);
  console.log('  ✔ Migration 1 applied cleanly');

  // Migration 2: RPC & Business Logic
  const m2Path = path.resolve('supabase/migrations/20260926161245_competition_v1_rpc_and_business_logic.sql');
  const m2Sql = fs.readFileSync(m2Path, 'utf8');
  await db.exec(m2Sql);
  console.log('  ✔ Migration 2 applied cleanly');

  // Migration 8: Active Question Snapshot RPC
  const m8Path = path.resolve('supabase/migrations/20261003000001_competition_v1_active_question_snapshot_rpc.sql');
  const m8Sql = fs.readFileSync(m8Path, 'utf8');
  await db.exec(m8Sql);
  console.log('  ✔ Migration 8 (Active Question RPC) applied cleanly');

  // Migration 9: Host Submission Stats RPC
  const m9Path = path.resolve('supabase/migrations/20261004000001_competition_v1_host_submission_stats_rpc.sql');
  const m9Sql = fs.readFileSync(m9Path, 'utf8');
  await db.exec(m9Sql);
  console.log('  ✔ Migration 9 (Host Submission Stats RPC) applied cleanly\n');

  // Supabase baseline grants
  await db.exec(`
    GRANT USAGE ON SCHEMA public, auth, extensions, private TO authenticated, anon;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, anon;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, anon;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth, extensions TO authenticated, anon;
  `);
}

async function setAuthContext(userId, role = 'authenticated') {
  if (userId) {
    await db.exec(`
      SET request.jwt.claim.sub = '${userId}';
      SET request.jwt.claim.role = '${role}';
      SET ROLE ${role};
    `);
  } else if (role === 'anon') {
    await db.exec(`
      RESET request.jwt.claim.sub;
      SET request.jwt.claim.role = 'anon';
      SET ROLE anon;
    `);
  } else {
    await db.exec(`
      RESET request.jwt.claim.sub;
      RESET request.jwt.claim.role;
      RESET ROLE;
    `);
  }
}

async function runTests() {
  await setupDatabase();

  const m9Path = path.resolve('supabase/migrations/20261004000001_competition_v1_host_submission_stats_rpc.sql');
  const m9Sql = fs.readFileSync(m9Path, 'utf8');

  // ==========================================================================
  // Test Suite 0: Static SQL & Catalog Architecture Verification (H, I, J, K, L)
  // ==========================================================================
  console.log('--- [Test Suite 0] Database Catalog & Architecture Verifications ---');

  // H: Public wrapper is SECURITY INVOKER
  const pubSecDefRes = await db.query(`
    SELECT prosecdef, proname
    FROM pg_proc
    WHERE proname = 'competition_host_get_submission_stats';
  `);
  assert.equal(pubSecDefRes.rows.length, 1);
  assert.equal(pubSecDefRes.rows[0].prosecdef, false, 'Public wrapper MUST be SECURITY INVOKER (prosecdef = false)');
  console.log('  ✅ [H] Public wrapper is confirmed SECURITY INVOKER');

  // I: Private helper is SECURITY DEFINER
  const privSecDefRes = await db.query(`
    SELECT prosecdef, proname
    FROM pg_proc
    WHERE proname = 'competition_host_get_submission_stats_internal';
  `);
  assert.equal(privSecDefRes.rows.length, 1);
  assert.equal(privSecDefRes.rows[0].prosecdef, true, 'Private helper MUST be SECURITY DEFINER (prosecdef = true)');
  console.log('  ✅ [I] Private helper is confirmed SECURITY DEFINER');

  // J: Private helper search_path is explicitly empty
  const privConfigRes = await db.query(`
    SELECT proconfig
    FROM pg_proc
    WHERE proname = 'competition_host_get_submission_stats_internal';
  `);
  assert.ok(
    privConfigRes.rows[0].proconfig?.includes('search_path=') ||
    privConfigRes.rows[0].proconfig?.includes('search_path=""'),
    'Private helper proconfig must set search_path to empty string'
  );
  console.log('  ✅ [J] Private helper search_path is verified empty (SET search_path = \'\')');

  // K: Nonexistent is_active column is NOT referenced
  assert.ok(
    !m9Sql.includes('is_active'),
    'Migration 9 must NOT reference nonexistent is_active column on competition_sessions'
  );
  console.log('  ✅ [K] Nonexistent is_active reference is completely absent');

  // L: public.users is NOT used for Competition role authorization
  assert.ok(
    !m9Sql.includes('FROM public.users') && !m9Sql.includes('FROM users'),
    'Migration 9 must NOT query public.users for role lookup'
  );
  assert.ok(
    m9Sql.includes('FROM public.profiles'),
    'Migration 9 must query public.profiles for role lookup'
  );
  console.log('  ✅ [L] public.profiles used exclusively for role authorization (public.users excluded)');


  // ==========================================================================
  // Test Suite 1: Session Creation & Multi-Role Authorization Matrix (A-G)
  // ==========================================================================
  console.log('\n--- [Test Suite 1] Session Creation & Multi-Role Authorization Matrix ---');

  // Seed Users
  const hostTeacherId = crypto.randomUUID();
  const unrelatedTeacherId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const student1Id = crypto.randomUUID();
  const student2Id = crypto.randomUUID();
  const kickedStudentId = crypto.randomUUID();

  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${hostTeacherId}', 'host@teacher.com'),
      ('${unrelatedTeacherId}', 'other@teacher.com'),
      ('${adminId}', 'admin@school.com'),
      ('${student1Id}', 's1@school.com'),
      ('${student2Id}', 's2@school.com'),
      ('${kickedStudentId}', 'kicked@school.com');

    INSERT INTO public.profiles (id, role, full_name) VALUES
      ('${hostTeacherId}', 'teacher', 'Host Teacher'),
      ('${unrelatedTeacherId}', 'teacher', 'Unrelated Teacher'),
      ('${adminId}', 'admin', 'System Admin'),
      ('${student1Id}', 'student', 'Student One'),
      ('${student2Id}', 'student', 'Student Two'),
      ('${kickedStudentId}', 'student', 'Kicked Student');
  `);

  // Create session as Host Teacher
  await setAuthContext(hostTeacherId);
  const createRes = await db.query(`
    SELECT public.competition_host_create_session(
      p_title := 'Math Arena 2026',
      p_description := 'Championship round',
      p_mode := 'individual',
      p_max_participants := 50,
      p_questions := '[
        {
          "question_order": 1,
          "question_text": "What is 10 + 20?",
          "question_type": "single_choice",
          "points": 10.0,
          "time_limit_seconds": 30,
          "options": [{"id": "opt_1", "text": "30"}, {"id": "opt_2", "text": "40"}],
          "correct_answer": {"option_id": "opt_1"}
        },
        {
          "question_order": 2,
          "question_text": "What is 15 * 2?",
          "question_type": "single_choice",
          "points": 10.0,
          "time_limit_seconds": 30,
          "options": [{"id": "opt_1", "text": "30"}, {"id": "opt_2", "text": "50"}],
          "correct_answer": {"option_id": "opt_1"}
        }
      ]'::jsonb
    ) AS res;
  `);

  const sessionObj = createRes.rows[0].res.session;
  const sessionId = sessionObj.id;
  const roomCode = sessionObj.room_code;
  console.log(`  ✔ Session created with ID: ${sessionId}, Room Code: ${roomCode}`);

  // Add Participants: Student 1, Student 2, Kicked Student, and Guest
  await setAuthContext(student1Id);
  const joinS1 = await db.query(`
    SELECT public.competition_join_session(
      p_room_code := '${roomCode}',
      p_display_name := 'Student One'
    ) AS res;
  `);
  const s1PartId = joinS1.rows[0].res.participant.id;

  await setAuthContext(student2Id);
  const joinS2 = await db.query(`
    SELECT public.competition_join_session(
      p_room_code := '${roomCode}',
      p_display_name := 'Student Two'
    ) AS res;
  `);
  const s2PartId = joinS2.rows[0].res.participant.id;

  await setAuthContext(kickedStudentId);
  const joinKicked = await db.query(`
    SELECT public.competition_join_session(
      p_room_code := '${roomCode}',
      p_display_name := 'Troublemaker'
    ) AS res;
  `);
  const kickedPartId = joinKicked.rows[0].res.participant.id;

  // Mark kicked student as kicked
  await setAuthContext(null); // system/super
  await db.exec(`
    UPDATE public.competition_participants
    SET status = 'kicked'
    WHERE id = '${kickedPartId}';
  `);

  // Join Guest
  const guestRawToken = 'guest_secret_token_1234567890_abcdefghij';
  await setAuthContext(null, 'anon');
  const joinGuest = await db.query(`
    SELECT public.competition_join_session(
      p_room_code := '${roomCode}',
      p_display_name := 'Guest Explorer',
      p_guest_token := '${guestRawToken}'
    ) AS res;
  `);
  const guestPartId = joinGuest.rows[0].res.participant.id;

  console.log('  ✔ Enrolled 3 students (1 kicked) + 1 guest');

  // Test A: Host owner allowed in waiting state
  await setAuthContext(hostTeacherId);
  const hostWaitingStats = await db.query(`
    SELECT public.competition_host_get_submission_stats('${sessionId}') AS res;
  `);
  const waitingData = hostWaitingStats.rows[0].res;
  assert.equal(waitingData.success, true, 'Host owner must succeed in calling RPC');
  assert.equal(waitingData.session_status, 'waiting');
  assert.equal(waitingData.has_active_question, false, 'Waiting state must report has_active_question: false');
  assert.equal(waitingData.current_question_id, null, 'Waiting state must have current_question_id: null');
  assert.equal(waitingData.total_eligible, 3, 'Total eligible must equal 3 (2 active students + 1 guest, excluding kicked)');
  assert.equal(waitingData.submitted_count, 0, 'Submitted count in waiting state must be 0');
  assert.equal(waitingData.not_submitted_count, 0, 'Not submitted count in waiting state must be 0 (neutral)');
  assert.deepEqual(waitingData.participants, [], 'Participants array in waiting state must be empty []');
  console.log('  ✅ [A] Host owner -> allowed with neutral stats when question is null');

  // Test B: Admin from public.profiles allowed
  await setAuthContext(adminId);
  const adminStats = await db.query(`
    SELECT public.competition_host_get_submission_stats('${sessionId}') AS res;
  `);
  assert.equal(adminStats.rows[0].res.success, true, 'Admin role from public.profiles must be authorized');
  console.log('  ✅ [B] Admin from public.profiles -> allowed');

  // Test C: Unrelated Teacher denied
  await setAuthContext(unrelatedTeacherId);
  const unrelatedStats = await db.query(`
    SELECT public.competition_host_get_submission_stats('${sessionId}') AS res;
  `);
  assert.equal(unrelatedStats.rows[0].res.success, false);
  assert.equal(unrelatedStats.rows[0].res.error_code, 'UNAUTHORIZED_ACCESS');
  console.log('  ✅ [C] Unrelated Teacher -> denied (UNAUTHORIZED_ACCESS)');

  // Test D: Authenticated Student denied
  await setAuthContext(student1Id);
  const studentStats = await db.query(`
    SELECT public.competition_host_get_submission_stats('${sessionId}') AS res;
  `);
  assert.equal(studentStats.rows[0].res.success, false);
  assert.equal(studentStats.rows[0].res.error_code, 'UNAUTHORIZED_ACCESS');
  console.log('  ✅ [D] Authenticated Student -> denied (UNAUTHORIZED_ACCESS)');

  // Test E: Anon caller denied
  await setAuthContext(null, 'anon');
  let anonCallDenied = false;
  try {
    const anonStats = await db.query(`
      SELECT public.competition_host_get_submission_stats('${sessionId}') AS res;
    `);
    if (anonStats.rows[0].res.success === false) {
      anonCallDenied = true;
    }
  } catch (err) {
    if (err.code === '42501' || err.message?.includes('permission denied')) {
      anonCallDenied = true;
    }
  }
  assert.equal(anonCallDenied, true, 'Anon caller must be denied');
  console.log('  ✅ [E] Anon caller -> denied');

  // Test F & G: Permissions check on public and private helper
  assert.ok(
    m9Sql.includes('REVOKE EXECUTE ON FUNCTION public.competition_host_get_submission_stats(UUID) FROM PUBLIC') ||
    m9Sql.includes('REVOKE EXECUTE ON FUNCTION public.competition_host_get_submission_stats(UUID) FROM PUBLIC, anon'),
    'Must revoke public wrapper from PUBLIC'
  );
  assert.ok(
    m9Sql.includes('REVOKE EXECUTE ON FUNCTION public.competition_host_get_submission_stats(UUID) FROM anon') ||
    m9Sql.includes('REVOKE EXECUTE ON FUNCTION public.competition_host_get_submission_stats(UUID) FROM PUBLIC, anon'),
    'Must revoke public wrapper from anon'
  );
  assert.ok(
    !m9Sql.includes('GRANT EXECUTE ON FUNCTION public.competition_host_get_submission_stats(UUID) TO anon'),
    'Must NEVER grant public wrapper to anon'
  );
  assert.ok(
    m9Sql.includes('GRANT EXECUTE ON FUNCTION public.competition_host_get_submission_stats(UUID) TO authenticated'),
    'Must grant public wrapper to authenticated'
  );
  assert.ok(
    !m9Sql.includes('GRANT EXECUTE ON FUNCTION private.competition_host_get_submission_stats_internal(UUID) TO anon'),
    'Must NEVER grant private helper to anon'
  );
  console.log('  ✅ [F & G] Privilege grants verified: Zero anon execute rights on public or private RPCs');


  // ==========================================================================
  // Test Suite 2: Active Question Progression & Submission Stats Derivation (N-Q)
  // ==========================================================================
  console.log('\n--- [Test Suite 2] Active Question Progression & Submission Stats Derivation ---');

  // Host starts session (moves to question 1)
  await setAuthContext(hostTeacherId);
  await db.query(`
    SELECT public.competition_host_start_session('${sessionId}') AS res;
  `);

  // Test N: Current question is server-derived
  const q1StatsRes = await db.query(`
    SELECT public.competition_host_get_submission_stats('${sessionId}') AS res;
  `);
  const q1Data = q1StatsRes.rows[0].res;
  assert.equal(q1Data.success, true);
  assert.equal(q1Data.session_status, 'in_progress');
  assert.equal(q1Data.current_question_index, 1);
  assert.ok(q1Data.current_question_id !== null, 'Server must derive current_question_id');
  assert.equal(q1Data.submitted_count, 0);
  assert.equal(q1Data.not_submitted_count, 3);
  console.log('  ✅ [N] Current question #1 is server-derived, 0/3 submitted initially');

  // Student 1 submits answer for Question 1
  await setAuthContext(student1Id);
  await db.query(`
    SELECT public.competition_submit_answer(
      p_session_id := '${sessionId}',
      p_question_id := '${q1Data.current_question_id}',
      p_selected_option_ids := '["opt_1"]'::jsonb
    ) AS res;
  `);
  console.log('  ✔ Student 1 submitted answer for Question 1');

  // Host checks stats again
  await setAuthContext(hostTeacherId);
  const q1StatsAfter1 = await db.query(`
    SELECT public.competition_host_get_submission_stats('${sessionId}') AS res;
  `);
  const dataAfter1 = q1StatsAfter1.rows[0].res;
  assert.equal(dataAfter1.submitted_count, 1, 'Submitted count must now be 1');
  assert.equal(dataAfter1.not_submitted_count, 2, 'Not submitted count must now be 2');

  const s1Entry = dataAfter1.participants.find(p => p.participant_id === s1PartId);
  const s2Entry = dataAfter1.participants.find(p => p.participant_id === s2PartId);
  const kickedEntry = dataAfter1.participants.find(p => p.participant_id === kickedPartId);

  // Test O: Kicked participant excluded
  assert.equal(kickedEntry, undefined, 'Kicked participant must NOT be in participants list');
  console.log('  ✅ [O] Kicked participant is excluded from total eligible and list');

  // Submission timestamp verified
  assert.ok(s1Entry, 'Student 1 must be present');
  assert.equal(s1Entry.submitted, true);
  assert.ok(s1Entry.submitted_at !== null, 'submitted_at must be populated');
  assert.ok(s2Entry, 'Student 2 must be present');
  assert.equal(s2Entry.submitted, false);
  assert.equal(s2Entry.submitted_at, null);
  console.log('  ✔ Student 1 submitted: true (with timestamp), Student 2 submitted: false');

  // Guest submits answer for Question 1
  await setAuthContext(null, 'anon');
  await db.query(`
    SELECT public.competition_submit_answer(
      p_session_id := '${sessionId}',
      p_question_id := '${q1Data.current_question_id}',
      p_participant_id := '${guestPartId}',
      p_guest_token := '${guestRawToken}',
      p_selected_option_ids := '["opt_1"]'::jsonb
    ) AS res;
  `);

  await setAuthContext(hostTeacherId);
  const q1StatsAfterGuest = await db.query(`
    SELECT public.competition_host_get_submission_stats('${sessionId}') AS res;
  `);
  const dataAfterGuest = q1StatsAfterGuest.rows[0].res;
  assert.equal(dataAfterGuest.submitted_count, 2, 'Submitted count must now be 2 (Student 1 + Guest)');
  assert.equal(dataAfterGuest.not_submitted_count, 1, 'Not submitted count must now be 1 (Student 2)');
  console.log('  ✔ Guest submission recorded; Host sees 2/3 submitted');


  // ==========================================================================
  // Test Suite 3: Strict Response Sanitization (M)
  // ==========================================================================
  console.log('\n--- [Test Suite 3] Strict Response Sanitization & Forbidden Fields Inspection ---');

  // Test M: Banned raw fields absent from returned JSON
  const bannedFields = [
    'selected_option_ids',
    'text_answer',
    'is_correct',
    'points_awarded',
    'time_taken_ms',
    'user_id',
    'guest_token_hash',
    'correct_answer',
    'explanation'
  ];

  const jsonString = JSON.stringify(dataAfterGuest);
  bannedFields.forEach(field => {
    assert.equal(
      jsonString.includes(`"${field}"`),
      false,
      `Returned JSON must NEVER contain banned raw field: '${field}'`
    );
  });
  console.log('  ✅ [M] Strict data sanitization verified: Zero answer choices, scores, or secret tokens leaked');


  // ==========================================================================
  // Test Suite 4: Question Advancement Stats Reset (P & Q)
  // ==========================================================================
  console.log('\n--- [Test Suite 4] Question Advancement Stats Reset ---');

  // Host advances to Question 2
  await setAuthContext(hostTeacherId);
  await db.query(`
    SELECT public.competition_host_next_question('${sessionId}') AS res;
  `);

  const q2StatsRes = await db.query(`
    SELECT public.competition_host_get_submission_stats('${sessionId}') AS res;
  `);
  const q2Data = q2StatsRes.rows[0].res;
  assert.equal(q2Data.current_question_index, 2);
  assert.notEqual(q2Data.current_question_id, q1Data.current_question_id);
  assert.equal(q2Data.submitted_count, 0, 'Submitted count must reset to 0 for Question 2');
  assert.equal(q2Data.not_submitted_count, 3, 'Not submitted count must reset to 3 for Question 2');
  assert.ok(q2Data.participants.every(p => p.submitted === false), 'All participants reset to submitted: false');
  console.log('  ✅ [Q] Stats reset cleanly upon advancing to Question 2 (prevents stale previous question stats)');

  // Test P: Finished and Cancelled session neutral state
  await db.query(`
    SELECT public.competition_host_finish_session('${sessionId}') AS res;
  `);
  const finishedStats = await db.query(`
    SELECT public.competition_host_get_submission_stats('${sessionId}') AS res;
  `);
  assert.equal(finishedStats.rows[0].res.session_status, 'finished');
  assert.equal(finishedStats.rows[0].res.success, true);

  const createRes2 = await db.query(`
    SELECT public.competition_host_create_session(
      p_title := 'Cancelled Arena Test',
      p_mode := 'individual',
      p_max_participants := 20,
      p_questions := '[
        {
          "question_order": 1,
          "question_text": "Sample Q",
          "question_type": "single_choice",
          "points": 10.0,
          "time_limit_seconds": 30,
          "options": [{"id": "opt_1", "text": "A"}, {"id": "opt_2", "text": "B"}],
          "correct_answer": {"option_id": "opt_1"}
        }
      ]'::jsonb
    ) AS res;
  `);
  const session2Id = createRes2.rows[0].res.session.id;

  await db.query(`
    SELECT public.competition_host_cancel_session('${session2Id}') AS res;
  `);

  const cancelledStats = await db.query(`
    SELECT public.competition_host_get_submission_stats('${session2Id}') AS res;
  `);
  const cData = cancelledStats.rows[0].res;
  assert.equal(cData.success, true);
  assert.equal(cData.session_status, 'cancelled');
  assert.equal(cData.has_active_question, false);
  assert.equal(cData.current_question_id, null);
  assert.equal(cData.submitted_count, 0);
  assert.equal(cData.not_submitted_count, 0);
  assert.deepEqual(cData.participants, []);
  console.log('  ✅ [P] Cancelled session with null question returns neutral stats (has_active_question: false, 0/0, [])');

  console.log('\n🎉 ALL COMPETITION V1 HOST SUBMISSION STATS RPC SECURITY TESTS (A-Q) PASSED!\n');
}

runTests().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
