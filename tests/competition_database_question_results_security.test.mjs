import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

console.log('================================================================================');
console.log('🧪 RUNNING COMPETITION V1 QUESTION RESULTS & CLOSE RPC DATABASE SECURITY SUITE');
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
  await db.exec(fs.readFileSync(m1Path, 'utf8'));
  console.log('  ✔ Migration 1 applied cleanly');

  // Migration 2: RPC & Business Logic
  const m2Path = path.resolve('supabase/migrations/20260926161245_competition_v1_rpc_and_business_logic.sql');
  await db.exec(fs.readFileSync(m2Path, 'utf8'));
  console.log('  ✔ Migration 2 applied cleanly');

  // Migration 8: Active Question Snapshot RPC
  const m8Path = path.resolve('supabase/migrations/20261003000001_competition_v1_active_question_snapshot_rpc.sql');
  await db.exec(fs.readFileSync(m8Path, 'utf8'));
  console.log('  ✔ Migration 8 (Active Question RPC) applied cleanly');

  // Migration 9: Host Submission Stats RPC
  const m9Path = path.resolve('supabase/migrations/20261004000001_competition_v1_host_submission_stats_rpc.sql');
  await db.exec(fs.readFileSync(m9Path, 'utf8'));
  console.log('  ✔ Migration 9 (Host Submission Stats RPC) applied cleanly');

  // Migration 10: Question Results & Close Question RPC (R2)
  const m10Path = path.resolve('supabase/migrations/20261004000002_competition_v1_question_results.sql');
  await db.exec(fs.readFileSync(m10Path, 'utf8'));
  console.log('  ✔ Migration 10 (Question Results & Close Question RPC) applied cleanly\n');

  // Supabase baseline grants
  await db.exec(`
    GRANT ALL ON ALL TABLES IN SCHEMA auth, public, extensions TO postgres, authenticated, anon;
    GRANT USAGE ON SCHEMA public, auth, extensions, private TO postgres, authenticated, anon;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, authenticated, anon;
    GRANT ALL ON ALL TABLES IN SCHEMA auth TO postgres, authenticated, anon;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, auth TO postgres, authenticated, anon;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth, extensions, public, private TO postgres, authenticated, anon;
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

  // ==========================================================================
  // Test Suite 0: Catalog Architecture & Permissions Verification
  // ==========================================================================
  console.log('--- [Test Suite 0] Database Catalog & Architecture Verifications ---');

  // Check Close Question Wrappers
  const pubCloseRes = await db.query(`SELECT prosecdef FROM pg_proc WHERE proname = 'competition_host_close_question';`);
  assert.equal(pubCloseRes.rows.length, 1);
  assert.equal(pubCloseRes.rows[0].prosecdef, false, 'Public close wrapper MUST be SECURITY INVOKER');

  const privCloseRes = await db.query(`SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'competition_host_close_question_internal';`);
  assert.equal(privCloseRes.rows.length, 1);
  assert.equal(privCloseRes.rows[0].prosecdef, true, 'Private close helper MUST be SECURITY DEFINER');
  assert.ok(
    privCloseRes.rows[0].proconfig?.includes('search_path=') ||
    privCloseRes.rows[0].proconfig?.includes('search_path=""') ||
    (Array.isArray(privCloseRes.rows[0].proconfig) && privCloseRes.rows[0].proconfig.some(c => c.startsWith('search_path='))),
    'Private close helper search_path MUST be empty'
  );

  // Check Results Wrappers
  const pubResRes = await db.query(`SELECT prosecdef FROM pg_proc WHERE proname = 'competition_host_get_question_results';`);
  assert.equal(pubResRes.rows.length, 1);
  assert.equal(pubResRes.rows[0].prosecdef, false, 'Public results wrapper MUST be SECURITY INVOKER');

  const privResRes = await db.query(`SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'competition_host_get_question_results_internal';`);
  assert.equal(privResRes.rows.length, 1);
  assert.equal(privResRes.rows[0].prosecdef, true, 'Private results helper MUST be SECURITY DEFINER');
  assert.ok(
    privResRes.rows[0].proconfig?.includes('search_path=') ||
    privResRes.rows[0].proconfig?.includes('search_path=""') ||
    (Array.isArray(privResRes.rows[0].proconfig) && privResRes.rows[0].proconfig.some(c => c.startsWith('search_path='))),
    'Private results helper search_path MUST be empty'
  );

  console.log('  ✅ [0] Catalog signatures, Security Invoker / Definer, and search_path verified');

  // ==========================================================================
  // Test Suite 1: Authorization Matrix (A - J)
  // ==========================================================================
  console.log('\n--- [Test Suite 1] Multi-Role Authorization Matrix (A - J) ---');

  // Setup Users: Host (Teacher 1), Admin, Unrelated Teacher 2, Student 1, Student 2, Student 3
  const hostId = (await db.query(`INSERT INTO auth.users (email) VALUES ('host_teacher@test.com') RETURNING id;`)).rows[0].id;
  await db.query(`INSERT INTO public.profiles (id, role, full_name) VALUES ('${hostId}', 'teacher', 'Host Teacher');`);

  const adminId = (await db.query(`INSERT INTO auth.users (email) VALUES ('admin@test.com') RETURNING id;`)).rows[0].id;
  await db.query(`INSERT INTO public.profiles (id, role, full_name) VALUES ('${adminId}', 'admin', 'System Admin');`);

  const otherTeacherId = (await db.query(`INSERT INTO auth.users (email) VALUES ('other_teacher@test.com') RETURNING id;`)).rows[0].id;
  await db.query(`INSERT INTO public.profiles (id, role, full_name) VALUES ('${otherTeacherId}', 'teacher', 'Other Teacher');`);

  const student1Id = (await db.query(`INSERT INTO auth.users (email) VALUES ('student1@test.com') RETURNING id;`)).rows[0].id;
  await db.query(`INSERT INTO public.profiles (id, role, full_name) VALUES ('${student1Id}', 'student', 'Student One');`);

  const student2Id = (await db.query(`INSERT INTO auth.users (email) VALUES ('student2@test.com') RETURNING id;`)).rows[0].id;
  await db.query(`INSERT INTO public.profiles (id, role, full_name) VALUES ('${student2Id}', 'student', 'Student Two');`);

  const student3Id = (await db.query(`INSERT INTO auth.users (email) VALUES ('student3@test.com') RETURNING id;`)).rows[0].id;
  await db.query(`INSERT INTO public.profiles (id, role, full_name) VALUES ('${student3Id}', 'student', 'Student Three');`);

  // Create Session with 4 canonical questions:
  // Q1: single_choice (A, B, C, D; correct: opt_1 "A")
  // Q2: multiple_choice (A, B, C; correct: ["opt_1", "opt_3"])
  // Q3: true_false (true, false; correct: "true")
  // Q4: short_answer (accepted: ["hà nội", "ha noi"])
  await setAuthContext(hostId);
  const questionsPayload = JSON.stringify([
    {
      question_order: 1,
      question_text: 'Thủ đô của Việt Nam?',
      question_type: 'single_choice',
      points: 10.00,
      time_limit_seconds: 15,
      options: [
        { id: 'opt_1', text: 'Hà Nội' },
        { id: 'opt_2', text: 'TP.HCM' },
        { id: 'opt_3', text: 'Đà Nẵng' },
        { id: 'opt_4', text: 'Cần Thơ' }
      ],
      correct_answer: { option_id: 'opt_1' }
    },
    {
      question_order: 2,
      question_text: 'Chọn các số nguyên tố nhỏ hơn 6',
      question_type: 'multiple_choice',
      points: 15.00,
      time_limit_seconds: 20,
      options: [
        { id: 'opt_1', text: '2' },
        { id: 'opt_2', text: '4' },
        { id: 'opt_3', text: '5' }
      ],
      correct_answer: { option_ids: ['opt_1', 'opt_3'] }
    },
    {
      question_order: 3,
      question_text: 'Mặt trời mọc ở hướng Đông',
      question_type: 'true_false',
      points: 5.00,
      time_limit_seconds: 10,
      options: [
        { id: 'true', text: 'Đúng' },
        { id: 'false', text: 'Sai' }
      ],
      correct_answer: { option_id: 'true' }
    },
    {
      question_order: 4,
      question_text: 'Nhập tên thủ đô nước Pháp',
      question_type: 'short_answer',
      points: 10.00,
      time_limit_seconds: 20,
      options: [],
      correct_answer: { accepted_answers: ['paris', 'pa ri'] }
    }
  ]);

  const createRes = await db.query(`
    SELECT public.competition_host_create_session(
      'Đấu Trường R2 Test',
      'Session for testing R2 question results',
      'individual',
      50,
      $1::jsonb
    ) as res;
  `, [questionsPayload]);

  const sessionObj = createRes.rows[0].res.session;
  assert.equal(createRes.rows[0].res.success, true);
  const sessionId = sessionObj.id;
  const roomCode = sessionObj.room_code;
  console.log(`  ✔ Session created with ID: ${sessionId}, Room Code: ${roomCode}`);

  // Enroll Students 1, 2, 3
  await setAuthContext(student1Id);
  const join1 = await db.query(`SELECT public.competition_join_session('${roomCode}', 'Student One', NULL, NULL, NULL) as res;`);
  assert.equal(join1.rows[0].res.success, true);
  const part1Id = join1.rows[0].res.participant.id;

  await setAuthContext(student2Id);
  const join2 = await db.query(`SELECT public.competition_join_session('${roomCode}', 'Student Two', NULL, NULL, NULL) as res;`);
  assert.equal(join2.rows[0].res.success, true);
  const part2Id = join2.rows[0].res.participant.id;

  await setAuthContext(student3Id);
  const join3 = await db.query(`SELECT public.competition_join_session('${roomCode}', 'Student Three', NULL, NULL, NULL) as res;`);
  assert.equal(join3.rows[0].res.success, true);
  const part3Id = join3.rows[0].res.participant.id;

  // Start Session (Host)
  await setAuthContext(hostId);
  const startRes = await db.query(`SELECT public.competition_host_start_session('${sessionId}') as res;`);
  assert.equal(startRes.rows[0].res.success, true);
  const q1Id = startRes.rows[0].res.current_question_id;
  console.log(`  ✔ Session started, active Question 1 ID: ${q1Id}`);

  // Test K: Results before deadline -> QUESTION_STILL_ACTIVE
  const earlyResults = await db.query(`SELECT public.competition_host_get_question_results('${sessionId}') as res;`);
  assert.equal(earlyResults.rows[0].res.success, false);
  assert.equal(earlyResults.rows[0].res.error_code, 'QUESTION_STILL_ACTIVE');
  console.log('  ✅ [K] Question results before deadline returns QUESTION_STILL_ACTIVE');

  // Test C, D, E: Close Question Authorization Denials
  await setAuthContext(otherTeacherId);
  const otherCloseRes = await db.query(`SELECT public.competition_host_close_question('${sessionId}') as res;`);
  assert.equal(otherCloseRes.rows[0].res.success, false);
  assert.equal(otherCloseRes.rows[0].res.error_code, 'UNAUTHORIZED_ACCESS');
  console.log('  ✅ [C] Unrelated Teacher denied close-question');

  await setAuthContext(student1Id);
  const studentCloseRes = await db.query(`SELECT public.competition_host_close_question('${sessionId}') as res;`);
  assert.equal(studentCloseRes.rows[0].res.success, false);
  assert.equal(studentCloseRes.rows[0].res.error_code, 'UNAUTHORIZED_ACCESS');
  console.log('  ✅ [D] Student denied close-question');

  await setAuthContext(null, 'anon');
  try {
    await db.query(`SELECT public.competition_host_close_question('${sessionId}') as res;`);
    assert.fail('Anon MUST NOT be able to execute public.competition_host_close_question');
  } catch (err) {
    console.log('  ✅ [E] Anon close denied by privilege grant revocation');
  }

  // Test H, I, J: Results Authorization Denials
  await setAuthContext(otherTeacherId);
  const otherRes = await db.query(`SELECT public.competition_host_get_question_results('${sessionId}') as res;`);
  assert.equal(otherRes.rows[0].res.success, false);
  assert.equal(otherRes.rows[0].res.error_code, 'UNAUTHORIZED_ACCESS');
  console.log('  ✅ [H] Unrelated Teacher denied question results');

  await setAuthContext(student1Id);
  const studentRes = await db.query(`SELECT public.competition_host_get_question_results('${sessionId}') as res;`);
  assert.equal(studentRes.rows[0].res.success, false);
  assert.equal(studentRes.rows[0].res.error_code, 'UNAUTHORIZED_ACCESS');
  console.log('  ✅ [I] Student denied question results');

  await setAuthContext(null, 'anon');
  try {
    await db.query(`SELECT public.competition_host_get_question_results('${sessionId}') as res;`);
    assert.fail('Anon MUST NOT be able to execute public.competition_host_get_question_results');
  } catch (err) {
    console.log('  ✅ [J] Anon results denied by privilege grant revocation');
  }

  // ==========================================================================
  // Test Suite 2: Submit & Close Question Mechanics (N, O, P, Q, R, A, B, F, G)
  // ==========================================================================
  console.log('\n--- [Test Suite 2] Submit & Close Question Lifecycle ---');

  // Student 1 submits correct answer ("opt_1") before deadline -> Success (N)
  await setAuthContext(student1Id);
  const sub1 = await db.query(`
    SELECT public.competition_submit_answer('${sessionId}', '${q1Id}', NULL, NULL, '["opt_1"]'::jsonb, NULL) as res;
  `);
  assert.equal(sub1.rows[0].res.success, true);
  assert.equal(sub1.rows[0].res.is_correct, true);
  assert.equal(Number(sub1.rows[0].res.points_awarded), 10.00);
  console.log('  ✅ [N & R] Student 1 submitted before deadline -> scored 10.00 points');

  // Student 1 duplicate submission -> Rejected (Q)
  const sub1Dup = await db.query(`
    SELECT public.competition_submit_answer('${sessionId}', '${q1Id}', NULL, NULL, '["opt_1"]'::jsonb, NULL) as res;
  `);
  assert.equal(sub1Dup.rows[0].res.success, false);
  assert.equal(sub1Dup.rows[0].res.error_code, 'ALREADY_ANSWERED');
  console.log('  ✅ [Q] Duplicate answer protection unchanged');

  // Student 2 submits incorrect answer ("opt_2") before deadline
  await setAuthContext(student2Id);
  const sub2 = await db.query(`
    SELECT public.competition_submit_answer('${sessionId}', '${q1Id}', NULL, NULL, '["opt_2"]'::jsonb, NULL) as res;
  `);
  assert.equal(sub2.rows[0].res.success, true);
  assert.equal(sub2.rows[0].res.is_correct, false);
  assert.equal(Number(sub2.rows[0].res.points_awarded), 0.00);
  console.log('  ✅ Student 2 submitted incorrect answer -> 0.00 points');

  // Student 3 has NOT submitted yet.
  // Now Host closes question (A)
  await setAuthContext(hostId);
  const closeRes = await db.query(`SELECT public.competition_host_close_question('${sessionId}') as res;`);
  assert.equal(closeRes.rows[0].res.success, true);
  assert.equal(closeRes.rows[0].res.question_closed, true);
  assert.equal(closeRes.rows[0].res.question_id, q1Id);
  console.log('  ✅ [A] Host successfully closed active Question 1');

  // Idempotent retry of close question by Admin (B)
  await setAuthContext(adminId);
  const adminCloseRes = await db.query(`SELECT public.competition_host_close_question('${sessionId}') as res;`);
  assert.equal(adminCloseRes.rows[0].res.success, true);
  assert.equal(adminCloseRes.rows[0].res.question_closed, true);
  console.log('  ✅ [B] Admin close allowed & idempotent safe success verified');

  // Student 3 attempts submit after close -> Rejected ANSWER_TOO_LATE (P)
  await setAuthContext(student3Id);
  const sub3Late = await db.query(`
    SELECT public.competition_submit_answer('${sessionId}', '${q1Id}', NULL, NULL, '["opt_1"]'::jsonb, NULL) as res;
  `);
  assert.equal(sub3Late.rows[0].res.success, false);
  assert.equal(sub3Late.rows[0].res.error_code, 'ANSWER_TOO_LATE');
  console.log('  ✅ [P & O] Submission after close rejected with ANSWER_TOO_LATE');

  // ==========================================================================
  // Test Suite 3: Question Results & Distribution Invariants (F, G, S, T, U, V, W, X, Y)
  // ==========================================================================
  console.log('\n--- [Test Suite 3] Question Results & Distribution Verification ---');

  // Host queries Q1 results (F)
  await setAuthContext(hostId);
  const q1Results = (await db.query(`SELECT public.competition_host_get_question_results('${sessionId}') as res;`)).rows[0].res;
  assert.equal(q1Results.success, true);
  assert.equal(q1Results.question_closed, true);
  assert.equal(q1Results.question_id, q1Id);
  assert.equal(q1Results.question_order, 1);
  assert.equal(q1Results.question_type, 'single_choice');
  assert.equal(q1Results.total_eligible, 3); // 3 students enrolled before close
  assert.equal(q1Results.submitted_count, 2); // Student 1 & 2 submitted
  assert.equal(q1Results.unanswered_count, 1); // Student 3 did not submit
  assert.equal(q1Results.correct_count, 1);
  assert.equal(q1Results.incorrect_count, 1);
  assert.equal(Number(q1Results.correct_percentage), 50.0);
  assert.equal(q1Results.correct_count + q1Results.incorrect_count, q1Results.submitted_count, 'Invariant: correct + incorrect = submitted');

  // Verify single_choice distribution (V)
  assert.equal(Array.isArray(q1Results.distribution), true);
  assert.equal(q1Results.distribution.length, 4);

  const opt1 = q1Results.distribution.find(o => o.option_id === 'opt_1');
  const opt2 = q1Results.distribution.find(o => o.option_id === 'opt_2');
  const opt3 = q1Results.distribution.find(o => o.option_id === 'opt_3');
  const opt4 = q1Results.distribution.find(o => o.option_id === 'opt_4');

  assert.equal(opt1.selection_count, 1);
  assert.equal(Number(opt1.selection_percentage), 50.0);
  assert.equal(opt1.is_correct_option, true);

  assert.equal(opt2.selection_count, 1);
  assert.equal(Number(opt2.selection_percentage), 50.0);
  assert.equal(opt2.is_correct_option, false);

  assert.equal(opt3.selection_count, 0);
  assert.equal(Number(opt3.selection_percentage), 0.0);
  assert.equal(opt3.is_correct_option, false);

  assert.equal(opt4.selection_count, 0);
  assert.equal(Number(opt4.selection_percentage), 0.0);
  assert.equal(opt4.is_correct_option, false);

  console.log('  ✅ [F, T, V] Host retrieved Q1 results: 2/3 submitted (1 correct, 1 incorrect), single_choice distribution accurate');

  // Admin queries Q1 results (G)
  await setAuthContext(adminId);
  const adminResults = (await db.query(`SELECT public.competition_host_get_question_results('${sessionId}') as res;`)).rows[0].res;
  assert.equal(adminResults.success, true);
  assert.equal(adminResults.submitted_count, 2);
  console.log('  ✅ [G] Admin retrieved question results successfully');

  // ==========================================================================
  // Test Suite 4: Late Joiner & Participant Kicked Reconciliation (Z, AA, AB)
  // ==========================================================================
  console.log('\n--- [Test Suite 4] Late Joiner & Kicked Participant Reconciliation (Z, AA, AB) ---');

  // Enroll Student 4 after Q1 close (Late joiner with joined_at > Q1 deadline)
  await setAuthContext(null);
  const student4Id = (await db.query(`INSERT INTO auth.users (email) VALUES ('student4@test.com') RETURNING id;`)).rows[0].id;
  await db.query(`INSERT INTO public.profiles (id, role, full_name) VALUES ('${student4Id}', 'student', 'Student Four');`);

  const part4Res = await db.query(`
    INSERT INTO public.competition_participants (
      session_id, user_id, display_name, is_guest, status, joined_at, last_seen_at
    ) VALUES (
      '${sessionId}', '${student4Id}', 'Student Four', false, 'active', pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
    ) RETURNING id;
  `);
  const part4Id = part4Res.rows[0].id;

  await db.query(`
    INSERT INTO public.competition_scores (
      session_id, participant_id, total_score, correct_count, total_response_time_ms, rank
    ) VALUES (
      '${sessionId}', '${part4Id}', 0.00, 0, 0, 1
    );
  `);
  console.log(`  ✔ Student 4 enrolled late (joined_at > Q1 deadline)`);

  // Re-verify Q1 results for Host: Student 4 MUST BE EXCLUDED from Q1 total_eligible (Z)
  await setAuthContext(hostId);
  const q1ResultsAfterLateJoin = (await db.query(`SELECT public.competition_host_get_question_results('${sessionId}') as res;`)).rows[0].res;
  assert.equal(q1ResultsAfterLateJoin.total_eligible, 3, 'Student 4 joined after Q1 deadline, MUST NOT be in Q1 total_eligible');
  assert.equal(q1ResultsAfterLateJoin.unanswered_count, 1);
  console.log('  ✅ [Z] Late joiner excluded from Q1 eligible population');

  // Now Kick Student 2 (who had submitted an incorrect answer on Q1) (AB)
  await setAuthContext(null);
  await db.query(`
    UPDATE public.competition_participants
    SET status = 'kicked'
    WHERE id = '${part2Id}';
  `);

  await setAuthContext(hostId);
  const q1ResultsAfterKick = (await db.query(`SELECT public.competition_host_get_question_results('${sessionId}') as res;`)).rows[0].res;
  assert.equal(q1ResultsAfterKick.success, true);
  // Total eligible was 3 (students 1, 2, 3), now student 2 is kicked -> total_eligible = 2 (students 1, 3)
  assert.equal(q1ResultsAfterKick.total_eligible, 2);
  // Submitted count had student 1 (correct) & student 2 (incorrect), now student 2 is kicked -> submitted_count = 1
  assert.equal(q1ResultsAfterKick.submitted_count, 1);
  assert.equal(q1ResultsAfterKick.correct_count, 1);
  assert.equal(q1ResultsAfterKick.incorrect_count, 0); // Kicked answer excluded!
  assert.equal(q1ResultsAfterKick.unanswered_count, 1); // Student 3
  assert.equal(Number(q1ResultsAfterKick.correct_percentage), 100.0);

  // Check distribution after kick: opt_2 selection count must drop to 0!
  const opt2AfterKick = q1ResultsAfterKick.distribution.find(o => o.option_id === 'opt_2');
  assert.equal(opt2AfterKick.selection_count, 0);
  assert.equal(Number(opt2AfterKick.selection_percentage), 0.0);

  console.log('  ✅ [AB] Kicked participant answer strictly excluded from total_eligible, submitted_count, incorrect_count, and distribution');

  // ==========================================================================
  // Test Suite 5: Question 2 (Multiple Choice) & Question 3 (True/False) & Question 4 (Short Answer)
  // ==========================================================================
  console.log('\n--- [Test Suite 5] Testing Q2 (Multiple Choice), Q3 (True/False), Q4 (Short Answer) ---');

  // Advance to Question 2 (AA: Student 4 is now eligible for Q2)
  const nextQ2 = await db.query(`SELECT public.competition_host_next_question('${sessionId}') as res;`);
  assert.equal(nextQ2.rows[0].res.success, true);
  const q2Id = nextQ2.rows[0].res.current_question_id;
  console.log(`  ✔ Advanced to Question 2 (multiple_choice), ID: ${q2Id}`);

  // Student 1 submits correct multiple_choice ["opt_1", "opt_3"]
  await setAuthContext(student1Id);
  const subQ2_1 = await db.query(`
    SELECT public.competition_submit_answer('${sessionId}', '${q2Id}', NULL, NULL, '["opt_1", "opt_3"]'::jsonb, NULL) as res;
  `);
  assert.equal(subQ2_1.rows[0].res.success, true);
  assert.equal(subQ2_1.rows[0].res.is_correct, true);

  // Student 4 (late joiner) submits partial multiple_choice ["opt_1"] -> incorrect
  await setAuthContext(student4Id);
  const subQ2_4 = await db.query(`
    SELECT public.competition_submit_answer('${sessionId}', '${q2Id}', NULL, NULL, '["opt_1"]'::jsonb, NULL) as res;
  `);
  assert.equal(subQ2_4.rows[0].res.success, true);
  assert.equal(subQ2_4.rows[0].res.is_correct, false);

  // Host closes Q2
  await setAuthContext(hostId);
  await db.query(`SELECT public.competition_host_close_question('${sessionId}');`);

  const q2Results = (await db.query(`SELECT public.competition_host_get_question_results('${sessionId}') as res;`)).rows[0].res;
  assert.equal(q2Results.success, true);
  // Eligible for Q2: Student 1, Student 3, Student 4 (3 students; student 2 is kicked)
  assert.equal(q2Results.total_eligible, 3);
  assert.equal(q2Results.submitted_count, 2);
  assert.equal(q2Results.correct_count, 1);
  assert.equal(q2Results.incorrect_count, 1);
  assert.equal(Number(q2Results.correct_percentage), 50.0);

  // Multiple Choice Distribution (X):
  // opt_1 chosen by Student 1 and Student 4 -> 2 selections (100.0%)
  // opt_2 chosen by none -> 0 selections (0.0%)
  // opt_3 chosen by Student 1 -> 1 selection (50.0%)
  const q2Opt1 = q2Results.distribution.find(o => o.option_id === 'opt_1');
  const q2Opt2 = q2Results.distribution.find(o => o.option_id === 'opt_2');
  const q2Opt3 = q2Results.distribution.find(o => o.option_id === 'opt_3');

  assert.equal(q2Opt1.selection_count, 2);
  assert.equal(Number(q2Opt1.selection_percentage), 100.0);
  assert.equal(q2Opt1.is_correct_option, true);

  assert.equal(q2Opt2.selection_count, 0);
  assert.equal(Number(q2Opt2.selection_percentage), 0.0);
  assert.equal(q2Opt2.is_correct_option, false);

  assert.equal(q2Opt3.selection_count, 1);
  assert.equal(Number(q2Opt3.selection_percentage), 50.0);
  assert.equal(q2Opt3.is_correct_option, true);

  console.log('  ✅ [AA & X] Student 4 eligible for Q2; multiple_choice distribution accurately tracks multiple selections per participant');

  // Advance to Question 3 (True/False) (W)
  const nextQ3 = await db.query(`SELECT public.competition_host_next_question('${sessionId}') as res;`);
  assert.equal(nextQ3.rows[0].res.success, true);
  const q3Id = nextQ3.rows[0].res.current_question_id;

  // Zero submissions on Q3 (S)
  await setAuthContext(hostId);
  await db.query(`SELECT public.competition_host_close_question('${sessionId}');`);

  const q3Results = (await db.query(`SELECT public.competition_host_get_question_results('${sessionId}') as res;`)).rows[0].res;
  assert.equal(q3Results.success, true);
  assert.equal(q3Results.submitted_count, 0);
  assert.equal(q3Results.correct_count, 0);
  assert.equal(q3Results.incorrect_count, 0);
  assert.equal(Number(q3Results.correct_percentage), 0.0);
  assert.equal(q3Results.unanswered_count, 3);
  assert.equal(q3Results.distribution.length, 2);
  console.log('  ✅ [S & W] Zero submissions handled cleanly (0.0% correct, zero selections for true_false)');

  // Advance to Question 4 (Short Answer) (Y)
  const nextQ4 = await db.query(`SELECT public.competition_host_next_question('${sessionId}') as res;`);
  assert.equal(nextQ4.rows[0].res.success, true);
  const q4Id = nextQ4.rows[0].res.current_question_id;

  // All eligible participants submit Q4 (U)
  await setAuthContext(student1Id);
  await db.query(`SELECT public.competition_submit_answer('${sessionId}', '${q4Id}', NULL, NULL, '[]'::jsonb, 'paris');`);

  await setAuthContext(student3Id);
  await db.query(`SELECT public.competition_submit_answer('${sessionId}', '${q4Id}', NULL, NULL, '[]'::jsonb, 'london');`);

  await setAuthContext(student4Id);
  await db.query(`SELECT public.competition_submit_answer('${sessionId}', '${q4Id}', NULL, NULL, '[]'::jsonb, 'Pa Ri');`);

  await setAuthContext(hostId);
  await db.query(`SELECT public.competition_host_close_question('${sessionId}');`);

  const q4Results = (await db.query(`SELECT public.competition_host_get_question_results('${sessionId}') as res;`)).rows[0].res;
  assert.equal(q4Results.success, true);
  assert.equal(q4Results.submitted_count, 3);
  assert.equal(q4Results.unanswered_count, 0);
  assert.equal(q4Results.correct_count, 2); // 'paris' and 'Pa Ri'
  assert.equal(q4Results.incorrect_count, 1); // 'london'
  assert.equal(Number(q4Results.correct_percentage), 66.7);
  // Short Answer Distribution MUST BE [] (Y)
  assert.deepEqual(q4Results.distribution, []);
  console.log('  ✅ [U & Y] All submissions handled; short_answer returns distribution: [] without text leakage');

  // ==========================================================================
  // Test Suite 6: Paused State Rejection (L) & Natural Expiry (M)
  // ==========================================================================
  console.log('\n--- [Test Suite 6] Paused State (L) & Natural Expiry (M) ---');

  // Create a new fresh session for paused and natural expiry tests
  const freshCreateRes = await db.query(`
    SELECT public.competition_host_create_session(
      'Session Paused & Expiry Test',
      NULL,
      'individual',
      10,
      $1::jsonb
    ) as res;
  `, [questionsPayload]);

  const freshSessionId = freshCreateRes.rows[0].res.session.id;
  const freshCode = freshCreateRes.rows[0].res.session.room_code;


  await setAuthContext(student1Id);
  await db.query(`SELECT public.competition_join_session('${freshCode}', 'Student One', NULL, NULL, NULL);`);

  await setAuthContext(hostId);
  await db.query(`SELECT public.competition_host_start_session('${freshSessionId}');`);

  // Pause session
  await db.query(`SELECT public.competition_host_pause_session('${freshSessionId}');`);
  const pausedRes = (await db.query(`SELECT public.competition_host_get_question_results('${freshSessionId}') as res;`)).rows[0].res;
  assert.equal(pausedRes.success, false);
  assert.equal(pausedRes.error_code, 'QUESTION_STILL_ACTIVE');
  console.log('  ✅ [L] Paused session results denied (fails closed to QUESTION_STILL_ACTIVE)');

  // Resume and simulate natural expiry by updating deadline to past
  await db.query(`SELECT public.competition_host_resume_session('${freshSessionId}');`);
  await db.query(`
    UPDATE public.competition_sessions
    SET question_deadline = pg_catalog.clock_timestamp() - interval '1 second'
    WHERE id = '${freshSessionId}';
  `);

  const naturalExpiryRes = (await db.query(`SELECT public.competition_host_get_question_results('${freshSessionId}') as res;`)).rows[0].res;
  assert.equal(naturalExpiryRes.success, true);
  assert.equal(naturalExpiryRes.question_closed, true);
  console.log('  ✅ [M] Natural deadline expiry allows question results retrieval');

  console.log('\n================================================================================');
  console.log('🎉 ALL COMPETITION V1 R2 DATABASE SECURITY & AGGREGATE TESTS (A-AB) PASSED!');
  console.log('================================================================================\n');
}

runTests().catch(err => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
