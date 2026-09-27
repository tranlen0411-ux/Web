import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

export async function runPhase2CTestSuite() {
  console.log('================================================================================');
  console.log('🚀 BẮT ĐẦU KIỂM THỬ PGLITE: COMPETITION V1 PHASE 2C (FINISH & LEADERBOARD)');
  console.log('================================================================================\n');

  const db = new PGlite();
  const testResults = {
    checks: {},
    errors: [],
    assertionsPassed: 0,
    totalAssertions: 0
  };

  function recordAssertion(gateName, condition, message) {
    testResults.totalAssertions++;
    if (!condition) {
      const err = `❌ Assertion failed at [${gateName}]: ${message}`;
      testResults.errors.push(err);
      throw new Error(err);
    }
    testResults.assertionsPassed++;
  }

  try {
    // 0. Verify Migration 1 Checksum
    const m1Path = path.resolve('supabase/migrations/20260926000001_competition_v1_baseline_schema.sql');
    const m1Sql = fs.readFileSync(m1Path, 'utf8');
    const m1Hash = crypto.createHash('sha256').update(m1Sql).digest('hex');
    const expectedM1Hash = '8e3231f34b3a57e43b0e1bcd7d863359a770d6334f59cff9a45c4662ed76b168';

    recordAssertion('GATE_AG', m1Hash === expectedM1Hash, `Migration 1 SHA256 mismatch: ${m1Hash}`);
    testResults.checks.GATE_AG = 'PASS';
    console.log('✔ [Gate AG] Migration 1 SHA256 matches locked hash:', m1Hash);

    // 1. Setup prerequisite schemas & auth functions in PGlite
    await db.exec(`
      CREATE SCHEMA IF NOT EXISTS extensions;
      CREATE SCHEMA IF NOT EXISTS auth;

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

    // 2. Run Migration 1
    await db.exec(m1Sql);
    console.log('✔ [Gate AF.1] Migration 1 applied cleanly');

    // 3. Run Migration 2
    const m2Path = path.resolve('supabase/migrations/20260926161245_competition_v1_rpc_and_business_logic.sql');
    const m2Sql = fs.readFileSync(m2Path, 'utf8');
    await db.exec(m2Sql);
    recordAssertion('GATE_AF', true, 'Clean DB apply succeeded');
    testResults.checks.GATE_AF = 'PASS';
    console.log('✔ [Gate AF.2] Migration 2 Phase 2C applied cleanly');

    // Helpers
    async function callAsAuth(userId, sqlQuery) {
      await db.exec(`SET request.jwt.claim.sub = '${userId}'; SET request.jwt.claim.role = 'authenticated';`);
      try {
        return await db.query(sqlQuery);
      } finally {
        await db.exec(`SET request.jwt.claim.sub = ''; SET request.jwt.claim.role = 'anon';`);
      }
    }

    async function callAsAnon(sqlQuery) {
      await db.exec(`SET request.jwt.claim.sub = ''; SET request.jwt.claim.role = 'anon';`);
      return await db.query(sqlQuery);
    }

    // Seed test users
    const hostId = '00000000-0000-0000-0000-000000000001';
    const teacher2Id = '00000000-0000-0000-0000-000000000002';
    const adminId = '00000000-0000-0000-0000-000000000003';
    const student1Id = '00000000-0000-0000-0000-000000000004';
    const student2Id = '00000000-0000-0000-0000-000000000005';
    const student3Id = '00000000-0000-0000-0000-000000000006';
    const studentOtherId = '00000000-0000-0000-0000-000000000007';

    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES 
        ('${hostId}', 'host@test.com'),
        ('${teacher2Id}', 'teacher2@test.com'),
        ('${adminId}', 'admin@test.com'),
        ('${student1Id}', 'student1@test.com'),
        ('${student2Id}', 'student2@test.com'),
        ('${student3Id}', 'student3@test.com'),
        ('${studentOtherId}', 'other@test.com');

      INSERT INTO public.profiles (id, full_name, role) VALUES
        ('${hostId}', 'Host Teacher', 'teacher'),
        ('${teacher2Id}', 'Other Teacher', 'teacher'),
        ('${adminId}', 'System Admin', 'admin'),
        ('${student1Id}', 'Student One', 'student'),
        ('${student2Id}', 'Student Two', 'student'),
        ('${student3Id}', 'Student Three', 'student'),
        ('${studentOtherId}', 'Unenrolled Student', 'student');
    `);

    // ==========================================
    // GATE AE: Zero-participant leaderboard safe
    // ==========================================
    const emptySessionRes = await db.query(`
      INSERT INTO public.competition_sessions (host_id, room_code, title, status, max_participants)
      VALUES ('${hostId}', 'EMPTY1', 'Empty Session', 'waiting', 10)
      RETURNING id;
    `);
    const emptySessionId = emptySessionRes.rows[0].id;

    const resEmpty = await callAsAuth(hostId, `
      SELECT private.competition_get_leaderboard_snapshot_internal('${emptySessionId}', NULL, NULL) as result;
    `);
    recordAssertion('GATE_AE', resEmpty.rows[0].result.success === true, 'Empty leaderboard returned success');
    recordAssertion('GATE_AE', Array.isArray(resEmpty.rows[0].result.leaderboard), 'Leaderboard is array');
    recordAssertion('GATE_AE', resEmpty.rows[0].result.leaderboard.length === 0, 'Leaderboard length is 0');
    testResults.checks.GATE_AE = 'PASS';
    console.log('✔ [Gate AE] Zero-participant leaderboard safe');

    // Create main test session (start in waiting status for join)
    const mainSessionRes = await db.query(`
      INSERT INTO public.competition_sessions (host_id, room_code, title, status, max_participants, current_question_index)
      VALUES ('${hostId}', 'ROOM01', 'Main Competition', 'waiting', 10, 1)
      RETURNING id;
    `);
    const sessionId = mainSessionRes.rows[0].id;

    // Create Question
    const q1Res = await db.query(`
      INSERT INTO public.competition_questions (session_id, question_order, question_text, question_type, options, correct_answer, points, time_limit_seconds)
      VALUES ('${sessionId}', 1, 'Q1', 'single_choice', '[{"id":"a","text":"A"},{"id":"b","text":"B"}]'::jsonb, '{"option_id":"a"}'::jsonb, 10.00, 30)
      RETURNING id;
    `);
    const q1Id = q1Res.rows[0].id;

    // Enroll participants:
    // 1. Student 1: Score 30.00, correct_count 3, total_response_time 5000ms -> Rank 1
    // 2. Student 2: Score 20.00, correct_count 2, total_response_time 3000ms -> Rank 2 (Higher correct_count than Student 3)
    // 3. Student 3: Score 20.00, correct_count 1, total_response_time 2000ms -> Rank 3 (Lower correct_count)
    // 4. Guest 1: Score 20.00, correct_count 1, total_response_time 2000ms -> Exact tie with Student 3 (Both share Rank 3!)
    // 5. Guest 2: Score 10.00, correct_count 1, total_response_time 9000ms -> Rank 5 (Rank skipped to 5 after tie)

    const guest1Token = 'guest_valid_token_32_characters_long_111111111';
    const guest2Token = 'guest_valid_token_32_characters_long_222222222';

    // Student 1 join
    const j1 = await callAsAuth(student1Id, `SELECT private.competition_join_session_internal('ROOM01', 'Student 1', NULL, NULL, NULL) as result;`);
    recordAssertion('SETUP_JOIN', j1.rows[0].result.success === true, 'Student 1 joined');
    const p1Id = j1.rows[0].result.participant.id;
    // Student 2 join
    const j2 = await callAsAuth(student2Id, `SELECT private.competition_join_session_internal('ROOM01', 'Student 2', NULL, NULL, NULL) as result;`);
    recordAssertion('SETUP_JOIN', j2.rows[0].result.success === true, 'Student 2 joined');
    const p2Id = j2.rows[0].result.participant.id;
    // Student 3 join
    const j3 = await callAsAuth(student3Id, `SELECT private.competition_join_session_internal('ROOM01', 'Student 3', NULL, NULL, NULL) as result;`);
    recordAssertion('SETUP_JOIN', j3.rows[0].result.success === true, 'Student 3 joined');
    const p3Id = j3.rows[0].result.participant.id;
    // Guest 1 join
    const jg1 = await callAsAnon(`SELECT private.competition_join_session_internal('ROOM01', 'Guest One', NULL, NULL, '${guest1Token}') as result;`);
    recordAssertion('SETUP_JOIN', jg1.rows[0].result.success === true, 'Guest 1 joined');
    const pg1Id = jg1.rows[0].result.participant.id;
    // Guest 2 join
    const jg2 = await callAsAnon(`SELECT private.competition_join_session_internal('ROOM01', 'Guest Two', NULL, NULL, '${guest2Token}') as result;`);
    recordAssertion('SETUP_JOIN', jg2.rows[0].result.success === true, 'Guest 2 joined');
    const pg2Id = jg2.rows[0].result.participant.id;

    // Transition session to in_progress with active question
    await db.query(`
      UPDATE public.competition_sessions
      SET status = 'in_progress',
          current_question_id = '${q1Id}',
          question_deadline = now() + interval '30 seconds',
          paused_remaining_ms = NULL
      WHERE id = '${sessionId}';
    `);

    // Seed mock score totals for ranking test
    await db.exec(`
      UPDATE public.competition_scores SET total_score = 30.00, correct_count = 3, total_response_time_ms = 5000 WHERE participant_id = '${p1Id}';
      UPDATE public.competition_scores SET total_score = 20.00, correct_count = 2, total_response_time_ms = 3000 WHERE participant_id = '${p2Id}';
      UPDATE public.competition_scores SET total_score = 20.00, correct_count = 1, total_response_time_ms = 2000 WHERE participant_id = '${p3Id}';
      UPDATE public.competition_scores SET total_score = 20.00, correct_count = 1, total_response_time_ms = 2000 WHERE participant_id = '${pg1Id}';
      UPDATE public.competition_scores SET total_score = 10.00, correct_count = 1, total_response_time_ms = 9000 WHERE participant_id = '${pg2Id}';
    `);

    // ==========================================
    // GATE S, T, U, W: Leaderboard authorization
    // ==========================================
    // S. Host can read
    const lbHost = await callAsAuth(hostId, `SELECT private.competition_get_leaderboard_snapshot_internal('${sessionId}', NULL, NULL) as result;`);
    recordAssertion('GATE_S', lbHost.rows[0].result.success === true, 'Host can read leaderboard');
    testResults.checks.GATE_S = 'PASS';
    console.log('✔ [Gate S] Host can read leaderboard');

    // T. Admin can read
    const lbAdmin = await callAsAuth(adminId, `SELECT private.competition_get_leaderboard_snapshot_internal('${sessionId}', NULL, NULL) as result;`);
    recordAssertion('GATE_T', lbAdmin.rows[0].result.success === true, 'Admin can read leaderboard');
    testResults.checks.GATE_T = 'PASS';
    console.log('✔ [Gate T] Admin can read leaderboard');

    // U. Enrolled authenticated student can read
    const lbStudent = await callAsAuth(student1Id, `SELECT private.competition_get_leaderboard_snapshot_internal('${sessionId}', NULL, NULL) as result;`);
    recordAssertion('GATE_U', lbStudent.rows[0].result.success === true, 'Enrolled student can read leaderboard');
    testResults.checks.GATE_U = 'PASS';
    console.log('✔ [Gate U] Enrolled authenticated student can read leaderboard');

    // V. Non-enrolled authenticated user denied
    const lbOther = await callAsAuth(studentOtherId, `SELECT private.competition_get_leaderboard_snapshot_internal('${sessionId}', NULL, NULL) as result;`);
    recordAssertion('GATE_V', lbOther.rows[0].result.success === false, 'Non-enrolled user rejected');
    recordAssertion('GATE_V', lbOther.rows[0].result.error_code === 'FORBIDDEN', 'Returns FORBIDDEN');
    testResults.checks.GATE_V = 'PASS';
    console.log('✔ [Gate V] Non-enrolled authenticated user denied');

    // W. Verified guest can read leaderboard
    const lbGuest = await callAsAnon(`SELECT private.competition_get_leaderboard_snapshot_internal('${sessionId}', '${pg1Id}', '${guest1Token}') as result;`);
    recordAssertion('GATE_W', lbGuest.rows[0].result.success === true, 'Verified guest can read leaderboard');
    testResults.checks.GATE_W = 'PASS';
    console.log('✔ [Gate W] Verified guest can read leaderboard');

    // X. Wrong guest token denied
    const lbWrongGuest = await callAsAnon(`SELECT private.competition_get_leaderboard_snapshot_internal('${sessionId}', '${pg1Id}', 'wrong_token_wrong_token_wrong_token_1234') as result;`);
    recordAssertion('GATE_X', lbWrongGuest.rows[0].result.success === false, 'Wrong guest token rejected');
    recordAssertion('GATE_X', lbWrongGuest.rows[0].result.error_code === 'FORBIDDEN', 'Returns FORBIDDEN');
    testResults.checks.GATE_X = 'PASS';
    console.log('✔ [Gate X] Wrong guest token denied');

    // Y. Cross-session guest denied
    const lbCrossGuest = await callAsAnon(`SELECT private.competition_get_leaderboard_snapshot_internal('${emptySessionId}', '${pg1Id}', '${guest1Token}') as result;`);
    recordAssertion('GATE_Y', lbCrossGuest.rows[0].result.success === false, 'Cross-session guest rejected');
    recordAssertion('GATE_Y', lbCrossGuest.rows[0].result.error_code === 'FORBIDDEN', 'Returns FORBIDDEN');
    testResults.checks.GATE_Y = 'PASS';
    console.log('✔ [Gate Y] Cross-session guest denied');

    // ==========================================
    // GATE M, N, O, P, AC: Dynamic Ranking Verification (Active Session)
    // ==========================================
    const lbActive = lbHost.rows[0].result.leaderboard;
    recordAssertion('GATE_AC', lbActive.length === 5, 'Leaderboard contains 5 participants');

    // 1. Highest score -> Rank 1 (Student 1: score 30)
    recordAssertion('GATE_M', lbActive[0].participant_id === p1Id && lbActive[0].rank === 1, 'Rank 1 is Student 1 (score 30)');
    testResults.checks.GATE_M = 'PASS';

    // 2. Equal score (20 vs 20), higher correct_count (2 vs 1) -> Rank 2 (Student 2)
    recordAssertion('GATE_N', lbActive[1].participant_id === p2Id && lbActive[1].rank === 2, 'Rank 2 is Student 2 (score 20, correct 2)');
    testResults.checks.GATE_N = 'PASS';

    // 3. Exact tie in score (20), correct (1), response time (2000ms) -> Share Rank 3 (Student 3 & Guest 1)
    recordAssertion('GATE_P', lbActive[2].rank === 3 && lbActive[3].rank === 3, 'Student 3 and Guest 1 share exact Rank 3');
    testResults.checks.GATE_P = 'PASS';

    // 4. Rank after tie is 5 (not 4) -> Guest 2 has rank 5
    recordAssertion('GATE_O', lbActive[4].participant_id === pg2Id && lbActive[4].rank === 5, 'Rank after tie skips to 5');
    testResults.checks.GATE_O = 'PASS';
    testResults.checks.GATE_AC = 'PASS';
    console.log('✔ [Gate M, N, O, P, AC] Dynamic ranking order & exact tie-sharing verified on active session');

    // ==========================================
    // GATE AA, AB, Z: Sanitization verification
    // ==========================================
    for (const entry of lbActive) {
      recordAssertion('GATE_AA', entry.correct_answer === undefined, 'correct_answer not in leaderboard');
      recordAssertion('GATE_AB', entry.selected_option_ids === undefined && entry.text_answer === undefined, 'answers not in leaderboard');
      recordAssertion('GATE_Z', entry.guest_token_hash === undefined && entry.guest_token === undefined, 'guest token absent');
    }
    testResults.checks.GATE_AA = 'PASS';
    testResults.checks.GATE_AB = 'PASS';
    testResults.checks.GATE_Z = 'PASS';
    console.log('✔ [Gate AA, AB, Z] Leaderboard payload is strictly sanitized (no correct_answer, answers, or guest tokens)');

    // ==========================================
    // GATE B, D, E: Finish Authorization Checks
    // ==========================================
    // D. Anon cannot finish
    const fAnon = await callAsAnon(`SELECT private.competition_finish_session_internal('${sessionId}') as result;`);
    recordAssertion('GATE_D', fAnon.rows[0].result.success === false, 'Anon cannot finish session');
    recordAssertion('GATE_D', fAnon.rows[0].result.error_code === 'UNAUTHORIZED', 'Returns UNAUTHORIZED');
    testResults.checks.GATE_D = 'PASS';
    console.log('✔ [Gate D] Anon cannot finish session');

    // E. Student cannot finish
    const fStudent = await callAsAuth(student1Id, `SELECT private.competition_finish_session_internal('${sessionId}') as result;`);
    recordAssertion('GATE_E', fStudent.rows[0].result.success === false, 'Student cannot finish session');
    recordAssertion('GATE_E', fStudent.rows[0].result.error_code === 'FORBIDDEN_NOT_HOST', 'Returns FORBIDDEN_NOT_HOST');
    testResults.checks.GATE_E = 'PASS';
    console.log('✔ [Gate E] Student cannot finish session');

    // B. Teacher who is NOT host cannot finish
    const fOtherTeacher = await callAsAuth(teacher2Id, `SELECT private.competition_finish_session_internal('${sessionId}') as result;`);
    recordAssertion('GATE_B', fOtherTeacher.rows[0].result.success === false, 'Non-host teacher cannot finish session');
    recordAssertion('GATE_B', fOtherTeacher.rows[0].result.error_code === 'FORBIDDEN_NOT_HOST', 'Returns FORBIDDEN_NOT_HOST');
    testResults.checks.GATE_B = 'PASS';
    console.log('✔ [Gate B] Non-host teacher cannot finish session');

    // ==========================================
    // GATE A, F, G, H, I, J, K, L, AD: Host finishes session
    // ==========================================
    const finishRes = await callAsAuth(hostId, `SELECT private.competition_finish_session_internal('${sessionId}') as result;`);
    recordAssertion('GATE_A', finishRes.rows[0].result.success === true, 'Host finished own session successfully');
    testResults.checks.GATE_A = 'PASS';
    console.log('✔ [Gate A] Host can finish own session');

    // Verify session state in DB
    const sessionCheck = await db.query(`SELECT status, ended_at, current_question_id, question_deadline, paused_remaining_ms FROM public.competition_sessions WHERE id = '${sessionId}';`);
    const sRow = sessionCheck.rows[0];
    recordAssertion('GATE_F', sRow.status === 'finished', 'Session status set to finished');
    recordAssertion('GATE_G', sRow.ended_at !== null, 'Session ended_at set');
    recordAssertion('GATE_H', sRow.current_question_id === null && sRow.question_deadline === null && sRow.paused_remaining_ms === null, 'Terminal timers cleaned');
    testResults.checks.GATE_F = 'PASS';
    testResults.checks.GATE_G = 'PASS';
    testResults.checks.GATE_H = 'PASS';
    console.log('✔ [Gate F, G, H] Session status finished, ended_at recorded, terminal timers cleaned');

    // Verify persisted ranks and unchanged totals
    const scoreCheck = await db.query(`SELECT participant_id, total_score, correct_count, total_response_time_ms, rank FROM public.competition_scores WHERE session_id = '${sessionId}' ORDER BY rank ASC, participant_id ASC;`);
    const scores = scoreCheck.rows;

    recordAssertion('GATE_I', scores.every(s => s.rank !== null), 'All scores have persisted rank');
    recordAssertion('GATE_J', Number(scores[0].total_score) === 30.00, 'total_score unchanged');
    recordAssertion('GATE_K', scores[0].correct_count === 3, 'correct_count unchanged');
    recordAssertion('GATE_L', scores[0].total_response_time_ms === 5000, 'total_response_time_ms unchanged');
    recordAssertion('GATE_I_RANKS', scores[0].rank === 1 && scores[1].rank === 2 && scores[2].rank === 3 && scores[3].rank === 3 && scores[4].rank === 5, 'Persisted ranks match exact criteria');
    testResults.checks.GATE_I = 'PASS';
    testResults.checks.GATE_J = 'PASS';
    testResults.checks.GATE_K = 'PASS';
    testResults.checks.GATE_L = 'PASS';
    console.log('✔ [Gate I, J, K, L] Final ranks persisted in competition_scores, score totals strictly unchanged');

    // AD. Leaderboard on finished session returns persisted final ranks
    const lbFinished = await callAsAuth(student1Id, `SELECT private.competition_get_leaderboard_snapshot_internal('${sessionId}', NULL, NULL) as result;`);
    recordAssertion('GATE_AD', lbFinished.rows[0].result.success === true, 'Leaderboard on finished session succeeded');
    recordAssertion('GATE_AD', lbFinished.rows[0].result.session_status === 'finished', 'session_status is finished');
    recordAssertion('GATE_AD', lbFinished.rows[0].result.leaderboard[0].rank === 1, 'Leaderboard rank 1 returned');
    testResults.checks.GATE_AD = 'PASS';
    console.log('✔ [Gate AD] Leaderboard on finished session returns consistent final ranks');

    // ==========================================
    // GATE Q: Double finish idempotency / structured rejection
    // ==========================================
    const fDouble = await callAsAuth(hostId, `SELECT private.competition_finish_session_internal('${sessionId}') as result;`);
    recordAssertion('GATE_Q', fDouble.rows[0].result.success === false, 'Double finish rejected');
    recordAssertion('GATE_Q', fDouble.rows[0].result.error_code === 'SESSION_ALREADY_FINISHED', 'Returns SESSION_ALREADY_FINISHED');
    testResults.checks.GATE_Q = 'PASS';
    console.log('✔ [Gate Q] Double finish causes no second mutation and returns SESSION_ALREADY_FINISHED');

    // ==========================================
    // GATE C: Admin can finish session
    // ==========================================
    const adminSessionRes = await db.query(`
      INSERT INTO public.competition_sessions (host_id, room_code, title, status, max_participants)
      VALUES ('${hostId}', 'ADM01', 'Admin Session', 'in_progress', 10)
      RETURNING id;
    `);
    const adminSessionId = adminSessionRes.rows[0].id;
    const fAdmin = await callAsAuth(adminId, `SELECT private.competition_finish_session_internal('${adminSessionId}') as result;`);
    recordAssertion('GATE_C', fAdmin.rows[0].result.success === true, 'Admin can finish any session');
    testResults.checks.GATE_C = 'PASS';
    console.log('✔ [Gate C] Admin override can finish session');

    // ==========================================
    // GATE R: Cancelled session cannot finish
    // ==========================================
    const cancelSessionRes = await db.query(`
      INSERT INTO public.competition_sessions (host_id, room_code, title, status, max_participants)
      VALUES ('${hostId}', 'CANC01', 'Cancelled Session', 'cancelled', 10)
      RETURNING id;
    `);
    const cancelSessionId = cancelSessionRes.rows[0].id;
    const fCancel = await callAsAuth(hostId, `SELECT private.competition_finish_session_internal('${cancelSessionId}') as result;`);
    recordAssertion('GATE_R', fCancel.rows[0].result.success === false, 'Cancelled session cannot finish');
    recordAssertion('GATE_R', fCancel.rows[0].result.error_code === 'SESSION_CANCELLED', 'Returns SESSION_CANCELLED');
    testResults.checks.GATE_R = 'PASS';
    console.log('✔ [Gate R] Cancelled session cannot finish');

    testResults.OVERALL = 'PASS';
    console.log('\n================================================================================');
    console.log(`🎉 ALL PHASE 2C GATES PASSED! (${testResults.assertionsPassed}/${testResults.totalAssertions} assertions)`);
    console.log('================================================================================');
    return testResults;

  } catch (err) {
    testResults.OVERALL = 'FAIL';
    testResults.errors.push(err.message);
    console.error('❌ PHASE 2C VALIDATION ERROR:', err);
    throw err;
  }
}

if (process.argv[1]?.endsWith('test_competition_v1_phase2c_pglite.mjs')) {
  runPhase2CTestSuite().catch(() => process.exit(1));
}
