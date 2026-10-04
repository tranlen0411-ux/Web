import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

console.log('================================================================================');
console.log('🧪 RUNNING COMPETITION V1 ACTIVE QUESTION RPC DATABASE SECURITY TEST SUITE');
console.log('================================================================================\n');

const db = new PGlite();

async function setupDatabase() {
  console.log('--- [Setup] Initializing schemas, mock auth, and applying migrations ---');

  // Baseline auth & extensions mocks
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

  // Migration 1
  const m1Path = path.resolve('supabase/migrations/20260926000001_competition_v1_baseline_schema.sql');
  const m1Sql = fs.readFileSync(m1Path, 'utf8');
  await db.exec(m1Sql);
  console.log('  ✔ Migration 1 applied cleanly');

  // Migration 2
  const m2Path = path.resolve('supabase/migrations/20260926161245_competition_v1_rpc_and_business_logic.sql');
  const m2Sql = fs.readFileSync(m2Path, 'utf8');
  await db.exec(m2Sql);
  console.log('  ✔ Migration 2 applied cleanly');

  // Migration 8 (Active Question Snapshot RPC)
  const m8Path = path.resolve('supabase/migrations/20261003000001_competition_v1_active_question_snapshot_rpc.sql');
  const m8Sql = fs.readFileSync(m8Path, 'utf8');
  await db.exec(m8Sql);
  console.log('  ✔ Migration 8 (Active Question RPC) applied cleanly\n');

  // Supabase baseline grants
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO authenticated, anon;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, anon;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, anon;
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

  // Seed Users
  const teacherId = crypto.randomUUID();
  const student1Id = crypto.randomUUID();
  const student2Id = crypto.randomUUID();
  const kickedStudentId = crypto.randomUUID();
  const adminId = crypto.randomUUID();

  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${teacherId}', 'teacher@test.com'),
      ('${student1Id}', 'student1@test.com'),
      ('${student2Id}', 'student2@test.com'),
      ('${kickedStudentId}', 'kicked@test.com'),
      ('${adminId}', 'admin@test.com');

    INSERT INTO public.profiles (id, role, full_name) VALUES
      ('${teacherId}', 'teacher', 'Thầy Giáo'),
      ('${student1Id}', 'student', 'Học Sinh 1'),
      ('${student2Id}', 'student', 'Học Sinh 2'),
      ('${kickedStudentId}', 'student', 'Học Sinh Kicked'),
      ('${adminId}', 'admin', 'Quản Trị Viên');
  `);

  // Seed Session 1
  const sessionId1 = crypto.randomUUID();
  const question1Id = crypto.randomUUID();
  const question2Id = crypto.randomUUID();

  // Seed Session 2
  const sessionId2 = crypto.randomUUID();
  const questionSession2Id = crypto.randomUUID();

  await db.exec(`
    INSERT INTO public.competition_sessions (id, host_id, room_code, title, status, current_question_index, current_question_id, question_deadline)
    VALUES ('${sessionId1}', '${teacherId}', 'ROOM01', 'Đấu Trường V1', 'in_progress', 1, NULL, now() + interval '30 seconds');

    INSERT INTO public.competition_questions (id, session_id, question_order, question_text, question_type, options, correct_answer, points, time_limit_seconds, explanation)
    VALUES
      ('${question1Id}', '${sessionId1}', 1, 'Thủ đô của Việt Nam là gì?', 'single_choice', '[{"id": "opt1", "text": "Hà Nội"}, {"id": "opt2", "text": "TP.HCM"}]'::jsonb, '{"selected_options": ["opt1"]}'::jsonb, 10.00, 30, 'Hà Nội là thủ đô của nước CHXHCN Việt Nam.'),
      ('${question2Id}', '${sessionId1}', 2, '2 + 2 = ?', 'single_choice', '[{"id": "opt1", "text": "3"}, {"id": "opt2", "text": "4"}]'::jsonb, '{"selected_options": ["opt2"]}'::jsonb, 10.00, 30, 'Phép tính cơ bản 2 + 2 = 4.');

    UPDATE public.competition_sessions SET current_question_id = '${question1Id}' WHERE id = '${sessionId1}';

    INSERT INTO public.competition_sessions (id, host_id, room_code, title, status, current_question_index, current_question_id, question_deadline)
    VALUES ('${sessionId2}', '${teacherId}', 'ROOM02', 'Đấu Trường Session 2', 'in_progress', 1, NULL, now() + interval '30 seconds');

    INSERT INTO public.competition_questions (id, session_id, question_order, question_text, question_type, options, correct_answer, points, time_limit_seconds, explanation)
    VALUES ('${questionSession2Id}', '${sessionId2}', 1, 'Mặt trời mọc ở hướng nào?', 'single_choice', '[{"id": "opt1", "text": "Đông"}, {"id": "opt2", "text": "Tây"}]'::jsonb, '{"selected_options": ["opt1"]}'::jsonb, 10.00, 30, 'Mặt trời mọc ở hướng Đông.');

    UPDATE public.competition_sessions SET current_question_id = '${questionSession2Id}' WHERE id = '${sessionId2}';
  `);

  // Seed Participants for Session 1
  const part1Id = crypto.randomUUID();
  const kickedPartId = crypto.randomUUID();
  const guestPartId = crypto.randomUUID();
  const validGuestToken = 'abcdef1234567890abcdef1234567890'; // 32 chars
  const guestTokenHash = crypto.createHash('sha256').update(validGuestToken, 'utf8').digest('hex');

  // Seed Participant for Session 2
  const part2Session2Id = crypto.randomUUID();

  await db.exec(`
    INSERT INTO public.competition_participants (id, session_id, user_id, display_name, is_guest, status)
    VALUES
      ('${part1Id}', '${sessionId1}', '${student1Id}', 'Học Sinh 1', false, 'active'),
      ('${kickedPartId}', '${sessionId1}', '${kickedStudentId}', 'Học Sinh Kicked', false, 'kicked');

    INSERT INTO public.competition_participants (id, session_id, user_id, guest_token_hash, display_name, is_guest, status)
    VALUES ('${guestPartId}', '${sessionId1}', NULL, '${guestTokenHash}', 'Khách 1', true, 'active');

    INSERT INTO public.competition_participants (id, session_id, user_id, display_name, is_guest, status)
    VALUES ('${part2Session2Id}', '${sessionId2}', '${student2Id}', 'Học Sinh 2 Session 2', false, 'active');
  `);

  // =========================================================================
  // Test A: Host can still access full questions as before via direct RLS
  // =========================================================================
  console.log('--- [Test A] Host can access full questions directly via RLS ---');
  await setAuthContext(teacherId, 'authenticated');
  const hostSelect = await db.query(`
    SELECT id, question_text, correct_answer, explanation 
    FROM public.competition_questions 
    WHERE session_id = '${sessionId1}'
    ORDER BY question_order;
  `);
  assert.equal(hostSelect.rows.length, 2, 'Host must be able to SELECT all session questions');
  assert.ok(hostSelect.rows[0].correct_answer, 'Host can see correct_answer');
  assert.ok(hostSelect.rows[0].explanation, 'Host can see explanation');
  console.log('  ✅ [Test A] Host direct question access verified');

  // =========================================================================
  // Test B: Student cannot directly SELECT arbitrary competition_questions rows
  // =========================================================================
  console.log('\n--- [Test B] Student cannot directly SELECT from competition_questions (RLS Denied) ---');
  await setAuthContext(student1Id, 'authenticated');
  const studentSelect = await db.query(`
    SELECT id, question_text, correct_answer, explanation 
    FROM public.competition_questions 
    WHERE session_id = '${sessionId1}';
  `);
  assert.equal(studentSelect.rows.length, 0, 'Direct SELECT on competition_questions must return 0 rows for student due to RLS');
  console.log('  ✅ [Test B] Direct student SELECT blocked by RLS');

  // =========================================================================
  // Test C: Student participant can call sanitized active-question RPC
  // =========================================================================
  console.log('\n--- [Test C] Student participant can call sanitized active-question RPC ---');
  await setAuthContext(student1Id, 'authenticated');
  const rpcResultStudent = await db.query(`
    SELECT public.competition_get_active_question_snapshot(
      '${sessionId1}'::UUID,
      '${part1Id}'::UUID,
      NULL
    ) AS res;
  `);
  const sRes = rpcResultStudent.rows[0].res;
  assert.equal(sRes.success, true, 'Active question RPC must succeed for enrolled student');
  assert.equal(sRes.session_id, sessionId1);
  assert.equal(sRes.session_status, 'in_progress');
  assert.equal(sRes.current_question_index, 1);
  assert.ok(sRes.question, 'Question object must exist');
  assert.equal(sRes.question.id, question1Id);
  assert.equal(sRes.question.question_text, 'Thủ đô của Việt Nam là gì?');
  console.log('  ✅ [Test C] Sanitized active question snapshot returned successfully');

  // =========================================================================
  // Test D: Student cannot request a future question by arbitrary question ID
  // =========================================================================
  console.log('\n--- [Test D] RPC derives active question solely from server session state ---');
  // Note: RPC accepts session_id, participant_id, guest_token. There is no question_id parameter accepted.
  // It always returns session.current_question_id (Question 1), never Question 2.
  assert.equal(sRes.question.id, question1Id, 'RPC must return active question 1, cannot arbitrarily fetch question 2');
  console.log('  ✅ [Test D] No arbitrary question authority accepted');

  // =========================================================================
  // Test E: Student from another session cannot read this session's active question
  // =========================================================================
  console.log('\n--- [Test E] Student from session 2 denied access to session 1 ---');
  await setAuthContext(student2Id, 'authenticated');
  const rpcResultForeign = await db.query(`
    SELECT public.competition_get_active_question_snapshot(
      '${sessionId1}'::UUID,
      '${part2Session2Id}'::UUID,
      NULL
    ) AS res;
  `);
  const fRes = rpcResultForeign.rows[0].res;
  assert.equal(fRes.success, false, 'Student not enrolled in session 1 must be rejected');
  assert.equal(fRes.error_code, 'UNAUTHORIZED_ACCESS');
  console.log('  ✅ [Test E] Foreign student access denied');

  // =========================================================================
  // Test F: Kicked participant denied
  // =========================================================================
  console.log('\n--- [Test F] Kicked participant denied access ---');
  await setAuthContext(kickedStudentId, 'authenticated');
  const rpcResultKicked = await db.query(`
    SELECT public.competition_get_active_question_snapshot(
      '${sessionId1}'::UUID,
      '${kickedPartId}'::UUID,
      NULL
    ) AS res;
  `);
  const kRes = rpcResultKicked.rows[0].res;
  assert.equal(kRes.success, false, 'Kicked participant must be rejected');
  assert.equal(kRes.error_code, 'UNAUTHORIZED_ACCESS');
  console.log('  ✅ [Test F] Kicked participant denied');

  // =========================================================================
  // Test G: Guest with invalid token denied / valid guest allowed
  // =========================================================================
  console.log('\n--- [Test G] Guest authentication validation ---');
  await setAuthContext(null, 'anon');
  
  // Invalid guest token
  const rpcResultBadGuest = await db.query(`
    SELECT public.competition_get_active_question_snapshot(
      '${sessionId1}'::UUID,
      '${guestPartId}'::UUID,
      'wrong_token_1234567890123456789012'
    ) AS res;
  `);
  const badGRes = rpcResultBadGuest.rows[0].res;
  assert.equal(badGRes.success, false, 'Invalid guest token must be rejected');
  assert.equal(badGRes.error_code, 'UNAUTHORIZED_ACCESS');

  // Valid guest token
  const rpcResultGoodGuest = await db.query(`
    SELECT public.competition_get_active_question_snapshot(
      '${sessionId1}'::UUID,
      '${guestPartId}'::UUID,
      '${validGuestToken}'
    ) AS res;
  `);
  const goodGRes = rpcResultGoodGuest.rows[0].res;
  assert.equal(goodGRes.success, true, 'Valid guest must receive active question');
  assert.equal(goodGRes.question.id, question1Id);
  console.log('  ✅ [Test G] Guest authentication verified');

  // =========================================================================
  // Test H & I: correct_answer and explanation NEVER returned
  // =========================================================================
  console.log('\n--- [Test H & I] Strict sanitization check (No correct_answer, No explanation) ---');
  assert.equal(sRes.question.correct_answer, undefined, 'correct_answer must NOT exist in student response');
  assert.equal(sRes.question.explanation, undefined, 'explanation must NOT exist in student response');
  assert.equal(goodGRes.question.correct_answer, undefined, 'correct_answer must NOT exist in guest response');
  assert.equal(goodGRes.question.explanation, undefined, 'explanation must NOT exist in guest response');
  
  const rawJson = JSON.stringify(sRes);
  assert.ok(!rawJson.includes('correct_answer'), 'JSON string must not contain correct_answer key');
  assert.ok(!rawJson.includes('explanation'), 'JSON string must not contain explanation key');
  console.log('  ✅ [Test H & I] Zero correct_answer or explanation leakage verified');

  // =========================================================================
  // Test J: finished / cancelled / waiting returns question: null
  // =========================================================================
  console.log('\n--- [Test J] Lifecycle state question exposure rules ---');
  
  // Set session to waiting
  await setAuthContext(null, null);
  await db.exec(`UPDATE public.competition_sessions SET status = 'waiting' WHERE id = '${sessionId1}';`);
  await setAuthContext(student1Id, 'authenticated');
  const rpcWaiting = await db.query(`
    SELECT public.competition_get_active_question_snapshot('${sessionId1}'::UUID, '${part1Id}'::UUID, NULL) AS res;
  `);
  assert.equal(rpcWaiting.rows[0].res.question, null, 'waiting state must return question: null');

  // Set session to paused
  await setAuthContext(null, null);
  await db.exec(`UPDATE public.competition_sessions SET status = 'paused' WHERE id = '${sessionId1}';`);
  await setAuthContext(student1Id, 'authenticated');
  const rpcPaused = await db.query(`
    SELECT public.competition_get_active_question_snapshot('${sessionId1}'::UUID, '${part1Id}'::UUID, NULL) AS res;
  `);
  assert.ok(rpcPaused.rows[0].res.question, 'paused state retains question view');

  // Set session to finished
  await setAuthContext(null, null);
  await db.exec(`UPDATE public.competition_sessions SET status = 'finished' WHERE id = '${sessionId1}';`);
  await setAuthContext(student1Id, 'authenticated');
  const rpcFinished = await db.query(`
    SELECT public.competition_get_active_question_snapshot('${sessionId1}'::UUID, '${part1Id}'::UUID, NULL) AS res;
  `);
  assert.equal(rpcFinished.rows[0].res.question, null, 'finished state must return question: null');

  // Set session to cancelled
  await setAuthContext(null, null);
  await db.exec(`UPDATE public.competition_sessions SET status = 'cancelled' WHERE id = '${sessionId1}';`);
  await setAuthContext(student1Id, 'authenticated');
  const rpcCancelled = await db.query(`
    SELECT public.competition_get_active_question_snapshot('${sessionId1}'::UUID, '${part1Id}'::UUID, NULL) AS res;
  `);
  assert.equal(rpcCancelled.rows[0].res.question, null, 'cancelled state must return question: null');
  console.log('  ✅ [Test J] Lifecycle state transitions return question: null correctly');


  console.log('\n================================================================================');
  console.log('🎉 ALL DATABASE SECURITY CONTRACT TESTS (A-J) PASSED PERFECTLY!');
  console.log('================================================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ DATABASE SECURITY CONTRACT TEST FAILED:', err);
  process.exit(1);
});
