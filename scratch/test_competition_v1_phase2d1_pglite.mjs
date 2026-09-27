import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

export async function runPhase2D1TestSuite() {
  console.log('================================================================================');
  console.log('🚀 BẮT ĐẦU KIỂM THỬ PGLITE: COMPETITION V1 PHASE 2D-1 (PUBLIC PARTICIPANT RPCS)');
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
    // =========================================================================
    // Check AC: Migration 1 checksum preserved
    // =========================================================================
    const m1Path = path.resolve('supabase/migrations/20260926000001_competition_v1_baseline_schema.sql');
    const m1Sql = fs.readFileSync(m1Path, 'utf8');
    const m1Hash = crypto.createHash('sha256').update(m1Sql).digest('hex');
    const expectedM1Hash = '8e3231f34b3a57e43b0e1bcd7d863359a770d6334f59cff9a45c4662ed76b168';

    recordAssertion('GATE_AC', m1Hash === expectedM1Hash, `Migration 1 SHA256 mismatch: ${m1Hash}`);
    testResults.checks.GATE_AC = 'PASS';
    console.log('✔ [Check AC] Migration 1 SHA256 matches locked hash:', m1Hash);

    // =========================================================================
    // Check AD: Migration 1 -> Migration 2 clean apply
    // =========================================================================
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

    await db.exec(m1Sql);
    console.log('✔ [Check AD.1] Migration 1 applied cleanly');

    const m2Path = path.resolve('supabase/migrations/20260926161245_competition_v1_rpc_and_business_logic.sql');
    const m2Sql = fs.readFileSync(m2Path, 'utf8');
    await db.exec(m2Sql);
    recordAssertion('GATE_AD', true, 'Migration 2 Phase 2D-1 applied cleanly');
    testResults.checks.GATE_AD = 'PASS';
    console.log('✔ [Check AD.2] Migration 2 Phase 2D-1 applied cleanly');

    // =========================================================================
    // Check Z, AA, AB: Security Invoker, Definer count, Helper count
    // =========================================================================
    // Query functions metadata
    const funcsQuery = await db.query(`
      SELECT 
        n.nspname as schema_name,
        p.proname as function_name,
        p.prosecdef as is_security_definer
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname IN ('public', 'private')
        AND p.proname LIKE 'competition_%';
    `);

    const publicRPCs = funcsQuery.rows.filter(f => f.schema_name === 'public');
    const privateHelpers = funcsQuery.rows.filter(f => f.schema_name === 'private');

    // Check Z: Public functions are SECURITY INVOKER
    const participantRpcNames = [
      'competition_join_session',
      'competition_rejoin_session',
      'competition_submit_answer',
      'competition_get_leaderboard_snapshot'
    ];
    const participantRPCs = publicRPCs.filter(f => participantRpcNames.includes(f.function_name));
    const publicSecDef = publicRPCs.filter(f => f.is_security_definer === true);
    recordAssertion('GATE_Z', participantRPCs.length === 4, `Expected 4 participant public RPCs, found ${participantRPCs.length}`);
    recordAssertion('GATE_Z', participantRPCs.every(f => f.is_security_definer === false), 'All participant RPCs are SECURITY INVOKER');
    recordAssertion('GATE_Z', publicSecDef.length === 0, `Expected 0 public security definer functions, found ${publicSecDef.length}`);
    testResults.checks.GATE_Z = 'PASS';
    console.log('✔ [Check Z] All 4 public participant RPCs are SECURITY INVOKER');

    // Check AA: Public SECURITY DEFINER count = 0
    recordAssertion('GATE_AA', publicSecDef.length === 0, 'Public SECURITY DEFINER count is 0');
    testResults.checks.GATE_AA = 'PASS';
    console.log('✔ [Check AA] Public SECURITY DEFINER count is exactly 0');

    // Check AB: Private helper count remains 5
    recordAssertion('GATE_AB', privateHelpers.length === 5, `Expected 5 private helpers, found ${privateHelpers.length}`);
    recordAssertion('GATE_AB', privateHelpers.every(f => f.is_security_definer === true), 'All 5 private helpers are SECURITY DEFINER');
    testResults.checks.GATE_AB = 'PASS';
    console.log('✔ [Check AB] Private helpers count remains exactly 5');

    // Execution helpers
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
    const adminId = '00000000-0000-0000-0000-000000000002';
    const student1Id = '00000000-0000-0000-0000-000000000003';
    const student2Id = '00000000-0000-0000-0000-000000000004';
    const student3Id = '00000000-0000-0000-0000-000000000005';
    const studentOtherId = '00000000-0000-0000-0000-000000000006';
    const studentImpersonatorId = '00000000-0000-0000-0000-000000000007';

    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES 
        ('${hostId}', 'host@test.com'),
        ('${adminId}', 'admin@test.com'),
        ('${student1Id}', 'student1@test.com'),
        ('${student2Id}', 'student2@test.com'),
        ('${student3Id}', 'student3@test.com'),
        ('${studentOtherId}', 'other@test.com'),
        ('${studentImpersonatorId}', 'impersonator@test.com');

      INSERT INTO public.profiles (id, full_name, role) VALUES
        ('${hostId}', 'Host Teacher', 'teacher'),
        ('${adminId}', 'System Admin', 'admin'),
        ('${student1Id}', 'Student One', 'student'),
        ('${student2Id}', 'Student Two', 'student'),
        ('${student3Id}', 'Student Three', 'student'),
        ('${studentOtherId}', 'Unenrolled Student', 'student'),
        ('${studentImpersonatorId}', 'Attacker Student', 'student');
    `);

    // Create session
    const mainSessionRes = await db.query(`
      INSERT INTO public.competition_sessions (host_id, room_code, title, status, max_participants)
      VALUES ('${hostId}', 'ROOM01', 'Live Contest', 'waiting', 10)
      RETURNING id;
    `);
    const sessionId = mainSessionRes.rows[0].id;

    // Create Question Q1
    const q1Res = await db.query(`
      INSERT INTO public.competition_questions (session_id, question_order, question_text, question_type, options, correct_answer, points, time_limit_seconds)
      VALUES ('${sessionId}', 1, 'Question 1', 'single_choice', '[{"id":"opt_a","text":"Option A"},{"id":"opt_b","text":"Option B"}]'::jsonb, '{"option_id":"opt_a"}'::jsonb, 10.00, 30)
      RETURNING id;
    `);
    const q1Id = q1Res.rows[0].id;

    // =========================================================================
    // Check A: public join authenticated success
    // =========================================================================
    const joinAuthRes = await callAsAuth(student1Id, `
      SELECT public.competition_join_session('ROOM01', 'Student One', NULL, NULL, NULL) as result;
    `);
    const resA = joinAuthRes.rows[0].result;
    recordAssertion('GATE_A', resA.success === true, 'Public join authenticated succeeded');
    recordAssertion('GATE_A', resA.participant.is_guest === false, 'Participant is authenticated');
    const p1Id = resA.participant.id;
    testResults.checks.GATE_A = 'PASS';
    console.log('✔ [Check A] public join authenticated success');

    // =========================================================================
    // Check B: public join guest success
    // =========================================================================
    const guest1Token = 'guest_token_test_string_with_32_characters_1111';
    const joinGuestRes = await callAsAnon(`
      SELECT public.competition_join_session('ROOM01', 'Guest Player 1', NULL, NULL, '${guest1Token}') as result;
    `);
    const resB = joinGuestRes.rows[0].result;
    recordAssertion('GATE_B', resB.success === true, 'Public join guest succeeded');
    recordAssertion('GATE_B', resB.participant.is_guest === true, 'Participant is guest');
    recordAssertion('GATE_B', resB.participant.guest_token_hash === undefined, 'No guest_token_hash exposed in response');
    const pg1Id = resB.participant.id;
    testResults.checks.GATE_B = 'PASS';
    console.log('✔ [Check B] public join guest success');

    // =========================================================================
    // Check C: public join invalid room
    // =========================================================================
    const joinInvalidRes = await callAsAnon(`
      SELECT public.competition_join_session('INVALID_ROOM', 'Guest Fail', NULL, NULL, '${guest1Token}') as result;
    `);
    const resC = joinInvalidRes.rows[0].result;
    recordAssertion('GATE_C', resC.success === false, 'Invalid room join failed');
    recordAssertion('GATE_C', resC.error_code === 'SESSION_NOT_FOUND', 'Returns SESSION_NOT_FOUND');
    testResults.checks.GATE_C = 'PASS';
    console.log('✔ [Check C] public join invalid room');

    // =========================================================================
    // Check D: public join rate-limited result preserved
    // =========================================================================
    // Seed 10 failed attempts within 5 minutes for brute force probing
    const attackerGuestToken = 'attacker_guest_token_32_characters_99999999999';
    const attackerHash = crypto.createHash('sha256').update(attackerGuestToken).digest('hex');
    for (let i = 0; i < 10; i++) {
      await db.query(`
        INSERT INTO public.competition_join_attempts (room_code, guest_token_hash, attempt_status, created_at)
        VALUES ('BLOCKEDROOM', '${attackerHash}', 'failed_invalid_code', now() - interval '2 minutes');
      `);
    }

    const joinBlockedRes = await callAsAnon(`
      SELECT public.competition_join_session('BLOCKEDROOM', 'Attacker', NULL, NULL, '${attackerGuestToken}') as result;
    `);
    const resD = joinBlockedRes.rows[0].result;
    recordAssertion('GATE_D', resD.success === false, 'Rate limited call failed');
    recordAssertion('GATE_D', resD.error_code === 'TOO_MANY_JOIN_ATTEMPTS', 'Returns TOO_MANY_JOIN_ATTEMPTS');
    testResults.checks.GATE_D = 'PASS';
    console.log('✔ [Check D] public join rate-limited result preserved');

    // =========================================================================
    // Check E: public rejoin authenticated success
    // =========================================================================
    const rejoinAuthRes = await callAsAuth(student1Id, `
      SELECT public.competition_rejoin_session('${sessionId}', NULL, NULL) as result;
    `);
    const resE = rejoinAuthRes.rows[0].result;
    recordAssertion('GATE_E', resE.success === true, 'Authenticated rejoin succeeded');
    recordAssertion('GATE_E', resE.is_rejoin === true, 'is_rejoin is true');
    recordAssertion('GATE_E', resE.participant.id === p1Id, 'Participant id matches');
    testResults.checks.GATE_E = 'PASS';
    console.log('✔ [Check E] public rejoin authenticated success');

    // =========================================================================
    // Check F: public rejoin guest success
    // =========================================================================
    const rejoinGuestRes = await callAsAnon(`
      SELECT public.competition_rejoin_session('${sessionId}', '${pg1Id}', '${guest1Token}') as result;
    `);
    const resF = rejoinGuestRes.rows[0].result;
    recordAssertion('GATE_F', resF.success === true, 'Guest rejoin succeeded');
    recordAssertion('GATE_F', resF.is_rejoin === true, 'is_rejoin is true');
    recordAssertion('GATE_F', resF.participant.id === pg1Id, 'Participant id matches');
    testResults.checks.GATE_F = 'PASS';
    console.log('✔ [Check F] public rejoin guest success');

    // =========================================================================
    // Check G: public rejoin wrong guest token rejected
    // =========================================================================
    const rejoinWrongTokenRes = await callAsAnon(`
      SELECT public.competition_rejoin_session('${sessionId}', '${pg1Id}', 'wrong_guest_token_32_characters_long_1234') as result;
    `);
    const resG = rejoinWrongTokenRes.rows[0].result;
    recordAssertion('GATE_G', resG.success === false, 'Wrong guest token rejoin failed');
    recordAssertion('GATE_G', resG.error_code === 'PARTICIPANT_NOT_FOUND', 'Returns PARTICIPANT_NOT_FOUND');
    testResults.checks.GATE_G = 'PASS';
    console.log('✔ [Check G] public rejoin wrong guest token rejected');

    // =========================================================================
    // Check H: public rejoin cross-session rejected
    // =========================================================================
    const otherSessionRes = await db.query(`
      INSERT INTO public.competition_sessions (host_id, room_code, title, status, max_participants)
      VALUES ('${hostId}', 'ROOM02', 'Other Contest', 'waiting', 10)
      RETURNING id;
    `);
    const otherSessionId = otherSessionRes.rows[0].id;

    const rejoinCrossRes = await callAsAnon(`
      SELECT public.competition_rejoin_session('${otherSessionId}', '${pg1Id}', '${guest1Token}') as result;
    `);
    const resH = rejoinCrossRes.rows[0].result;
    recordAssertion('GATE_H', resH.success === false, 'Cross-session rejoin failed');
    recordAssertion('GATE_H', resH.error_code === 'PARTICIPANT_NOT_FOUND', 'Returns PARTICIPANT_NOT_FOUND');
    testResults.checks.GATE_H = 'PASS';
    console.log('✔ [Check H] public rejoin cross-session rejected');

    // Transition session to in_progress with active question
    await db.query(`
      UPDATE public.competition_sessions
      SET status = 'in_progress',
          current_question_id = '${q1Id}',
          question_deadline = now() + interval '30 seconds',
          paused_remaining_ms = NULL
      WHERE id = '${sessionId}';
    `);

    // =========================================================================
    // Check I: public submit authenticated correct
    // =========================================================================
    const submitAuthRes = await callAsAuth(student1Id, `
      SELECT public.competition_submit_answer('${sessionId}', '${q1Id}', NULL, NULL, '["opt_a"]'::jsonb, NULL) as result;
    `);
    const resI = submitAuthRes.rows[0].result;
    recordAssertion('GATE_I', resI.success === true, 'Authenticated submit succeeded');
    recordAssertion('GATE_I', resI.is_correct === true, 'Answer evaluated as correct');
    recordAssertion('GATE_I', Number(resI.points_awarded) === 10.00, 'Points awarded = 10.00');
    recordAssertion('GATE_I', Number(resI.total_score) === 10.00, 'Total score = 10.00');
    testResults.checks.GATE_I = 'PASS';
    console.log('✔ [Check I] public submit authenticated correct');

    // =========================================================================
    // Check J: public submit guest correct
    // =========================================================================
    const submitGuestRes = await callAsAnon(`
      SELECT public.competition_submit_answer('${sessionId}', '${q1Id}', '${pg1Id}', '${guest1Token}', '["opt_a"]'::jsonb, NULL) as result;
    `);
    const resJ = submitGuestRes.rows[0].result;
    recordAssertion('GATE_J', resJ.success === true, 'Guest submit succeeded');
    recordAssertion('GATE_J', resJ.is_correct === true, 'Guest answer evaluated as correct');
    recordAssertion('GATE_J', Number(resJ.points_awarded) === 10.00, 'Points awarded = 10.00');
    testResults.checks.GATE_J = 'PASS';
    console.log('✔ [Check J] public submit guest correct');

    // =========================================================================
    // Check K: public submit authenticated impersonation rejected
    // =========================================================================
    // StudentImpersonator tries to submit on behalf of p1Id
    const submitImpRes = await callAsAuth(studentImpersonatorId, `
      SELECT public.competition_submit_answer('${sessionId}', '${q1Id}', '${p1Id}', NULL, '["opt_a"]'::jsonb, NULL) as result;
    `);
    const resK = submitImpRes.rows[0].result;
    recordAssertion('GATE_K', resK.success === false, 'Impersonation submit failed');
    recordAssertion('GATE_K', resK.error_code === 'PARTICIPANT_NOT_FOUND', 'Returns PARTICIPANT_NOT_FOUND');
    testResults.checks.GATE_K = 'PASS';
    console.log('✔ [Check K] public submit authenticated impersonation rejected');

    // =========================================================================
    // Check L: public submit wrong guest token rejected
    // =========================================================================
    const submitWrongGuestRes = await callAsAnon(`
      SELECT public.competition_submit_answer('${sessionId}', '${q1Id}', '${pg1Id}', 'wrong_guest_token_32_characters_long_9999', '["opt_a"]'::jsonb, NULL) as result;
    `);
    const resL = submitWrongGuestRes.rows[0].result;
    recordAssertion('GATE_L', resL.success === false, 'Wrong guest token submit failed');
    recordAssertion('GATE_L', resL.error_code === 'INVALID_GUEST_CREDENTIALS', 'Returns INVALID_GUEST_CREDENTIALS');
    testResults.checks.GATE_L = 'PASS';
    console.log('✔ [Check L] public submit wrong guest token rejected');

    // =========================================================================
    // Check M: public submit late rejected
    // =========================================================================
    // Create Question Q2 and make deadline in the past
    const q2Res = await db.query(`
      INSERT INTO public.competition_questions (session_id, question_order, question_text, question_type, options, correct_answer, points, time_limit_seconds)
      VALUES ('${sessionId}', 2, 'Question 2', 'single_choice', '[{"id":"opt_a","text":"Option A"}]'::jsonb, '{"option_id":"opt_a"}'::jsonb, 10.00, 30)
      RETURNING id;
    `);
    const q2Id = q2Res.rows[0].id;

    await db.query(`
      UPDATE public.competition_sessions
      SET current_question_id = '${q2Id}',
          question_deadline = now() - interval '5 seconds'
      WHERE id = '${sessionId}';
    `);

    const submitLateRes = await callAsAuth(student1Id, `
      SELECT public.competition_submit_answer('${sessionId}', '${q2Id}', NULL, NULL, '["opt_a"]'::jsonb, NULL) as result;
    `);
    const resM = submitLateRes.rows[0].result;
    recordAssertion('GATE_M', resM.success === false, 'Late submit failed');
    recordAssertion('GATE_M', resM.error_code === 'ANSWER_TOO_LATE', 'Returns ANSWER_TOO_LATE');
    testResults.checks.GATE_M = 'PASS';
    console.log('✔ [Check M] public submit late rejected');

    // =========================================================================
    // Check N: public submit duplicate returns ALREADY_ANSWERED
    // =========================================================================
    // Reset deadline for Q1 to test duplicate submission
    await db.query(`
      UPDATE public.competition_sessions
      SET current_question_id = '${q1Id}',
          question_deadline = now() + interval '30 seconds'
      WHERE id = '${sessionId}';
    `);

    const submitDupRes = await callAsAuth(student1Id, `
      SELECT public.competition_submit_answer('${sessionId}', '${q1Id}', NULL, NULL, '["opt_a"]'::jsonb, NULL) as result;
    `);
    const resN = submitDupRes.rows[0].result;
    recordAssertion('GATE_N', resN.success === false, 'Duplicate submit failed');
    recordAssertion('GATE_N', resN.error_code === 'ALREADY_ANSWERED', 'Returns ALREADY_ANSWERED');
    testResults.checks.GATE_N = 'PASS';
    console.log('✔ [Check N] public submit duplicate returns ALREADY_ANSWERED');

    // =========================================================================
    // Check O: public submit does not accept client score authority
    // =========================================================================
    // Verify public wrapper function parameters in pg_proc do not contain score/rank/is_correct
    const submitProc = await db.query(`
      SELECT pg_get_function_arguments(p.oid) as args
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.proname = 'competition_submit_answer';
    `);
    const submitArgs = submitProc.rows[0].args;
    recordAssertion('GATE_O', !submitArgs.includes('is_correct'), 'No is_correct parameter in public wrapper');
    recordAssertion('GATE_O', !submitArgs.includes('points_awarded'), 'No points_awarded parameter in public wrapper');
    recordAssertion('GATE_O', !submitArgs.includes('score'), 'No score parameter in public wrapper');
    recordAssertion('GATE_O', !submitArgs.includes('rank'), 'No rank parameter in public wrapper');
    recordAssertion('GATE_O', !submitArgs.includes('time_taken_ms'), 'No time_taken_ms parameter in public wrapper');
    testResults.checks.GATE_O = 'PASS';
    console.log('✔ [Check O] public submit does not accept client score authority');

    // =========================================================================
    // Check P: public submit does not expose correct_answer
    // =========================================================================
    recordAssertion('GATE_P', resI.correct_answer === undefined, 'No correct_answer in submit response');
    recordAssertion('GATE_P', resJ.correct_answer === undefined, 'No correct_answer in submit response');
    testResults.checks.GATE_P = 'PASS';
    console.log('✔ [Check P] public submit does not expose correct_answer');

    // =========================================================================
    // Enroll more participants & seed scores to test Leaderboard (Q to Y)
    // =========================================================================
    const guest2Token = 'guest_token_test_string_with_32_characters_2222';
    // Temporarily set session back to waiting for new joins, then restore in_progress
    await db.query(`UPDATE public.competition_sessions SET status = 'waiting' WHERE id = '${sessionId}';`);

    // Student 2 join
    const j2 = await callAsAuth(student2Id, `SELECT public.competition_join_session('ROOM01', 'Student 2', NULL, NULL, NULL) as result;`);
    recordAssertion('SETUP_JOIN', j2.rows[0].result.success === true, 'Student 2 joined');
    const p2Id = j2.rows[0].result.participant.id;
    // Student 3 join
    const j3 = await callAsAuth(student3Id, `SELECT public.competition_join_session('ROOM01', 'Student 3', NULL, NULL, NULL) as result;`);
    recordAssertion('SETUP_JOIN', j3.rows[0].result.success === true, 'Student 3 joined');
    const p3Id = j3.rows[0].result.participant.id;
    // Guest 2 join
    const jg2 = await callAsAnon(`SELECT public.competition_join_session('ROOM01', 'Guest Player 2', NULL, NULL, '${guest2Token}') as result;`);
    recordAssertion('SETUP_JOIN', jg2.rows[0].result.success === true, 'Guest 2 joined');
    const pg2Id = jg2.rows[0].result.participant.id;

    // Restore in_progress
    await db.query(`UPDATE public.competition_sessions SET status = 'in_progress' WHERE id = '${sessionId}';`);

    // Seed mock score totals for ranking test:
    // Student 1: 30 pts, 3 correct, 5000ms -> Rank 1
    // Student 2: 20 pts, 2 correct, 3000ms -> Rank 2
    // Student 3: 20 pts, 1 correct, 2000ms -> Rank 3 (Tie)
    // Guest 1:   20 pts, 1 correct, 2000ms -> Rank 3 (Tie)
    // Guest 2:   10 pts, 1 correct, 9000ms -> Rank 5
    await db.exec(`
      UPDATE public.competition_scores SET total_score = 30.00, correct_count = 3, total_response_time_ms = 5000 WHERE participant_id = '${p1Id}';
      UPDATE public.competition_scores SET total_score = 20.00, correct_count = 2, total_response_time_ms = 3000 WHERE participant_id = '${p2Id}';
      UPDATE public.competition_scores SET total_score = 20.00, correct_count = 1, total_response_time_ms = 2000 WHERE participant_id = '${p3Id}';
      UPDATE public.competition_scores SET total_score = 20.00, correct_count = 1, total_response_time_ms = 2000 WHERE participant_id = '${pg1Id}';
      UPDATE public.competition_scores SET total_score = 10.00, correct_count = 1, total_response_time_ms = 9000 WHERE participant_id = '${pg2Id}';
    `);

    // =========================================================================
    // Check Q: public leaderboard host success
    // =========================================================================
    const lbHost = await callAsAuth(hostId, `
      SELECT public.competition_get_leaderboard_snapshot('${sessionId}', NULL, NULL) as result;
    `);
    const resQ = lbHost.rows[0].result;
    recordAssertion('GATE_Q', resQ.success === true, 'Host get leaderboard succeeded');
    recordAssertion('GATE_Q', Array.isArray(resQ.leaderboard), 'Leaderboard is array');
    testResults.checks.GATE_Q = 'PASS';
    console.log('✔ [Check Q] public leaderboard host success');

    // =========================================================================
    // Check R: public leaderboard admin success
    // =========================================================================
    const lbAdmin = await callAsAuth(adminId, `
      SELECT public.competition_get_leaderboard_snapshot('${sessionId}', NULL, NULL) as result;
    `);
    const resR = lbAdmin.rows[0].result;
    recordAssertion('GATE_R', resR.success === true, 'Admin get leaderboard succeeded');
    testResults.checks.GATE_R = 'PASS';
    console.log('✔ [Check R] public leaderboard admin success');

    // =========================================================================
    // Check S: public leaderboard enrolled student success
    // =========================================================================
    const lbStudent = await callAsAuth(student1Id, `
      SELECT public.competition_get_leaderboard_snapshot('${sessionId}', NULL, NULL) as result;
    `);
    const resS = lbStudent.rows[0].result;
    recordAssertion('GATE_S', resS.success === true, 'Enrolled student get leaderboard succeeded');
    testResults.checks.GATE_S = 'PASS';
    console.log('✔ [Check S] public leaderboard enrolled student success');

    // =========================================================================
    // Check T: public leaderboard guest success
    // =========================================================================
    const lbGuest = await callAsAnon(`
      SELECT public.competition_get_leaderboard_snapshot('${sessionId}', '${pg1Id}', '${guest1Token}') as result;
    `);
    const resT = lbGuest.rows[0].result;
    recordAssertion('GATE_T', resT.success === true, 'Guest get leaderboard succeeded');
    testResults.checks.GATE_T = 'PASS';
    console.log('✔ [Check T] public leaderboard guest success');

    // =========================================================================
    // Check U: public leaderboard non-member denied
    // =========================================================================
    const lbNonMember = await callAsAuth(studentOtherId, `
      SELECT public.competition_get_leaderboard_snapshot('${sessionId}', NULL, NULL) as result;
    `);
    const resU = lbNonMember.rows[0].result;
    recordAssertion('GATE_U', resU.success === false, 'Non-member get leaderboard failed');
    recordAssertion('GATE_U', resU.error_code === 'FORBIDDEN', 'Returns FORBIDDEN');
    testResults.checks.GATE_U = 'PASS';
    console.log('✔ [Check U] public leaderboard non-member denied');

    // =========================================================================
    // Check V: public leaderboard wrong guest token denied
    // =========================================================================
    const lbWrongToken = await callAsAnon(`
      SELECT public.competition_get_leaderboard_snapshot('${sessionId}', '${pg1Id}', 'wrong_guest_token_32_characters_long_9999') as result;
    `);
    const resV = lbWrongToken.rows[0].result;
    recordAssertion('GATE_V', resV.success === false, 'Wrong token guest leaderboard failed');
    recordAssertion('GATE_V', resV.error_code === 'FORBIDDEN', 'Returns FORBIDDEN');
    testResults.checks.GATE_V = 'PASS';
    console.log('✔ [Check V] public leaderboard wrong guest token denied');

    // =========================================================================
    // Check W: leaderboard ranking order preserved
    // =========================================================================
    const lb = resQ.leaderboard;
    recordAssertion('GATE_W', lb.length === 5, 'Leaderboard has 5 entries');
    recordAssertion('GATE_W', lb[0].participant_id === p1Id && lb[0].rank === 1, 'Rank 1 is Student 1');
    recordAssertion('GATE_W', lb[1].participant_id === p2Id && lb[1].rank === 2, 'Rank 2 is Student 2');
    testResults.checks.GATE_W = 'PASS';
    console.log('✔ [Check W] leaderboard ranking order preserved');

    // =========================================================================
    // Check X: exact tie shares rank
    // =========================================================================
    recordAssertion('GATE_X', lb[2].rank === 3 && lb[3].rank === 3, 'Tied participants share rank 3');
    recordAssertion('GATE_X', lb[4].rank === 5, 'Rank after tie skips to 5');
    testResults.checks.GATE_X = 'PASS';
    console.log('✔ [Check X] exact tie shares rank');

    // =========================================================================
    // Check Y: no sensitive fields exposed
    // =========================================================================
    for (const entry of lb) {
      recordAssertion('GATE_Y', entry.guest_token_hash === undefined, 'No guest_token_hash in leaderboard entry');
      recordAssertion('GATE_Y', entry.user_id === undefined, 'No user_id in leaderboard entry');
      recordAssertion('GATE_Y', entry.correct_answer === undefined, 'No correct_answer in leaderboard entry');
      recordAssertion('GATE_Y', entry.selected_option_ids === undefined, 'No selected answers in leaderboard entry');
      recordAssertion('GATE_Y', entry.text_answer === undefined, 'No text answers in leaderboard entry');
    }
    testResults.checks.GATE_Y = 'PASS';
    console.log('✔ [Check Y] no sensitive fields exposed in leaderboard snapshot');

    // =========================================================================
    // Check AE: no Realtime changes
    // =========================================================================
    // Verify no realtime publication alterations in migration 2
    const realtimeMatch = m2Sql.includes('supabase_realtime');
    recordAssertion('GATE_AE', !realtimeMatch, 'No supabase_realtime alterations in migration 2');
    testResults.checks.GATE_AE = 'PASS';
    console.log('✔ [Check AE] no Realtime changes');

    // =========================================================================
    // Check AF: no reward side effects
    // =========================================================================
    // Verify no rewards table or points mutation in public wrappers
    const rewardsMatch = m2Sql.includes('competition_rewards') || m2Sql.includes('user_rewards');
    recordAssertion('GATE_AF', !rewardsMatch, 'No rewards side effects in migration 2');
    testResults.checks.GATE_AF = 'PASS';
    console.log('✔ [Check AF] no reward side effects');

    testResults.OVERALL = 'PASS';
    console.log('\n================================================================================');
    console.log(`🎉 ALL PHASE 2D-1 GATES PASSED! (${testResults.assertionsPassed}/${testResults.totalAssertions} assertions)`);
    console.log('================================================================================');
    return testResults;

  } catch (err) {
    testResults.OVERALL = 'FAIL';
    testResults.errors.push(err.message);
    console.error('❌ PHASE 2D-1 VALIDATION ERROR:', err);
    throw err;
  }
}

if (process.argv[1]?.endsWith('test_competition_v1_phase2d1_pglite.mjs')) {
  runPhase2D1TestSuite().catch(() => process.exit(1));
}
