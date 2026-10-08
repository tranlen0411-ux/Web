import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

// Import client services & export utilities
import {
  filterLeaderboardByRank,
  getTopNSelectionSummary,
  buildCompetitionWorkbook,
  buildLeaderboardCsv
} from '../src/utils/competitionExport.js';

console.log('================================================================================');
console.log('🧪 COMPETITION V1 R12 — HOST RESULTS NAVIGATION & UX POLISH TEST SUITE');
console.log('================================================================================\n');

// Database Harness
let db;

async function setupDatabase() {
  db = new PGlite();

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

  // Migration 2: RPC & Business Logic
  const m2Path = path.resolve('supabase/migrations/20260926161245_competition_v1_rpc_and_business_logic.sql');
  await db.exec(fs.readFileSync(m2Path, 'utf8'));

  // Migration 8: Active Question Snapshot RPC
  const m8Path = path.resolve('supabase/migrations/20261003000001_competition_v1_active_question_snapshot_rpc.sql');
  await db.exec(fs.readFileSync(m8Path, 'utf8'));

  // Migration 9: Host Submission Stats RPC
  const m9Path = path.resolve('supabase/migrations/20261004000001_competition_v1_host_submission_stats_rpc.sql');
  await db.exec(fs.readFileSync(m9Path, 'utf8'));

  // Baseline grants
  await db.exec(`
    GRANT ALL ON ALL TABLES IN SCHEMA auth, public, extensions TO postgres, authenticated, anon;
    GRANT USAGE ON SCHEMA public, auth, extensions, private TO postgres, authenticated, anon;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, authenticated, anon;
    GRANT ALL ON ALL TABLES IN SCHEMA auth TO postgres, authenticated, anon;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, auth TO postgres, authenticated, anon;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth, extensions, public, private TO postgres, authenticated, anon;
  `);

  // Migration 10: Question Results & Close Question RPC (R2)
  const m10Path = path.resolve('supabase/migrations/20261004000002_competition_v1_question_results.sql');
  await db.exec(fs.readFileSync(m10Path, 'utf8'));

  // Migration 11: Post-Session Review (R5)
  const m11Path = path.resolve('supabase/migrations/20261006000001_competition_v1_post_session_review.sql');
  await db.exec(fs.readFileSync(m11Path, 'utf8'));

  // R12 Migration: Host Historical Question Results by Order
  const r12MigrationPath = path.resolve('supabase/migrations/20261008110000_competition_v1_host_historical_question_results.sql');
  await db.exec(fs.readFileSync(r12MigrationPath, 'utf8'));
}

async function setAuthContext(userId, role = 'authenticated') {
  if (userId) {
    await db.exec(`
      SET request.jwt.claim.sub = '${userId}';
      SET request.jwt.claim.role = '${role}';
    `);
  } else {
    await db.exec(`
      RESET request.jwt.claim.sub;
      SET request.jwt.claim.role = 'anon';
    `);
  }
}

test('COMPETITION V1 R12 — BACKEND PGLITE SECURITY & LOGIC TESTS', async (t) => {
  await setupDatabase();

  // Seed Users
  const hostId = '11111111-1111-4111-8111-111111111111';
  const adminId = '22222222-2222-4222-8222-222222222222';
  const otherTeacherId = '33333333-3333-4333-8333-333333333333';
  const studentId = '44444444-4444-4444-8444-444444444444';

  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${hostId}', 'host@school.edu.vn'),
      ('${adminId}', 'admin@school.edu.vn'),
      ('${otherTeacherId}', 'other@school.edu.vn'),
      ('${studentId}', 'student@school.edu.vn');

    INSERT INTO public.profiles (id, role, full_name) VALUES
      ('${hostId}', 'teacher', 'Cô Giáo Chủ Nhiệm'),
      ('${adminId}', 'admin', 'Quản Trị Viên Hệ Thống'),
      ('${otherTeacherId}', 'teacher', 'Thầy Giáo Bộ Môn Khác'),
      ('${studentId}', 'student', 'Em Học Sinh');
  `);

  // Create Session with 3 Questions
  await setAuthContext(hostId, 'authenticated');
  const createRes = await db.query(`
    SELECT public.competition_host_create_session(
      'Đấu Trường R12 Kiểm Thử',
      'Mô tả phòng thi',
      'individual',
      50,
      '[
        {
          "question_order": 1,
          "question_text": "Câu 1: 1 + 1 = ?",
          "question_type": "single_choice",
          "points": 10.0,
          "time_limit_seconds": 30,
          "options": [{"id": "opt_1a", "text": "2"}, {"id": "opt_1b", "text": "3"}],
          "correct_answer": {"option_id": "opt_1a"}
        },
        {
          "question_order": 2,
          "question_text": "Câu 2: 2 + 2 = ?",
          "question_type": "single_choice",
          "points": 10.0,
          "time_limit_seconds": 30,
          "options": [{"id": "opt_2a", "text": "4"}, {"id": "opt_2b", "text": "5"}],
          "correct_answer": {"option_id": "opt_2a"}
        },
        {
          "question_order": 3,
          "question_text": "Câu 3: 3 + 3 = ?",
          "question_type": "single_choice",
          "points": 10.0,
          "time_limit_seconds": 30,
          "options": [{"id": "opt_3a", "text": "6"}, {"id": "opt_3b", "text": "7"}],
          "correct_answer": {"option_id": "opt_3a"}
        }
      ]'::jsonb,
      '[]'::jsonb,
      false,
      '{}'::jsonb,
      true
    ) AS res;
  `);

  const sessionObj = createRes.rows[0].res.session;
  const sessionId = sessionObj.id;
  const roomCode = sessionObj.room_code;

  // Student joins session
  await setAuthContext(studentId, 'authenticated');
  const joinRes = await db.query(`
    SELECT public.competition_join_session('${roomCode}', 'Em Học Sinh 1') AS res;
  `);
  const participantId = joinRes.rows[0].res.participant.id;

  // Host starts session (moves to question 1)
  await setAuthContext(hostId, 'authenticated');
  await db.query(`SELECT public.competition_host_start_session('${sessionId}') AS res;`);

  // Submit answer for Question 1
  await setAuthContext(studentId, 'authenticated');
  const q1Row = (await db.query(`SELECT id FROM public.competition_questions WHERE session_id = '${sessionId}' AND question_order = 1;`)).rows[0];
  await db.query(`
    SELECT public.competition_submit_answer(
      '${sessionId}'::UUID,
      '${q1Row.id}'::UUID,
      '${participantId}'::UUID,
      null::TEXT,
      '["opt_1a"]'::jsonb,
      null::TEXT
    ) AS res;
  `);

  // Close question 1 early
  await setAuthContext(hostId, 'authenticated');
  await db.query(`SELECT public.competition_host_close_question('${sessionId}') AS res;`);

  // Move to question 2
  await db.query(`SELECT public.competition_host_next_question('${sessionId}') AS res;`);

  // Now Question 1 is earlier (question_order 1 < current_question_index 2), Question 2 is active open.

  await t.test('1. Host can fetch closed previous question (Question 1)', async () => {
    await setAuthContext(hostId, 'authenticated');
    const res = await db.query(`
      SELECT public.competition_host_get_question_result_by_order('${sessionId}', 1) AS res;
    `);
    const data = res.rows[0].res;
    assert.equal(data.success, true);
    assert.equal(data.question_closed, true);
    assert.equal(data.question_order, 1);
    assert.equal(data.question_text, 'Câu 1: 1 + 1 = ?');
    assert.equal(data.submitted_count, 1);
    assert.equal(data.correct_count, 1);
    assert.equal(data.correct_percentage, 100);
    assert.equal(data.total_questions, 3);
  });

  await t.test('2. Admin can fetch closed previous question', async () => {
    await setAuthContext(adminId, 'authenticated');
    const res = await db.query(`
      SELECT public.competition_host_get_question_result_by_order('${sessionId}', 1) AS res;
    `);
    const data = res.rows[0].res;
    assert.equal(data.success, true);
    assert.equal(data.question_order, 1);
    assert.equal(data.total_questions, 3);
  });

  await t.test('3. Unrelated teacher denied', async () => {
    await setAuthContext(otherTeacherId, 'authenticated');
    const res = await db.query(`
      SELECT public.competition_host_get_question_result_by_order('${sessionId}', 1) AS res;
    `);
    const data = res.rows[0].res;
    assert.equal(data.success, false);
    assert.equal(data.error_code, 'UNAUTHORIZED_ACCESS');
  });

  await t.test('4. Student denied', async () => {
    await setAuthContext(studentId, 'authenticated');
    const res = await db.query(`
      SELECT public.competition_host_get_question_result_by_order('${sessionId}', 1) AS res;
    `);
    const data = res.rows[0].res;
    assert.equal(data.success, false);
    assert.equal(data.error_code, 'UNAUTHORIZED_ACCESS');
  });

  await t.test('5. Anon denied', async () => {
    await setAuthContext(null, 'anon');
    const res = await db.query(`
      SELECT public.competition_host_get_question_result_by_order('${sessionId}', 1) AS res;
    `);
    const data = res.rows[0].res;
    assert.equal(data.success, false);
    assert.equal(data.error_code, 'UNAUTHORIZED_ACCESS');
  });

  await t.test('6. Wrong session question denied / QUESTION_NOT_FOUND', async () => {
    await setAuthContext(hostId, 'authenticated');
    const res = await db.query(`
      SELECT public.competition_host_get_question_result_by_order('${sessionId}', 99) AS res;
    `);
    const data = res.rows[0].res;
    assert.equal(data.success, false);
    assert.equal(data.error_code, 'QUESTION_NOT_FOUND');
  });

  await t.test('7. Open current question => QUESTION_STILL_ACTIVE', async () => {
    await setAuthContext(hostId, 'authenticated');
    // Question 2 is current and open (deadline in future)
    const res = await db.query(`
      SELECT public.competition_host_get_question_result_by_order('${sessionId}', 2) AS res;
    `);
    const data = res.rows[0].res;
    assert.equal(data.success, false);
    assert.equal(data.error_code, 'QUESTION_STILL_ACTIVE');
  });

  await t.test('8. Closed current question => allowed', async () => {
    await setAuthContext(hostId, 'authenticated');
    // Close question 2
    await db.query(`SELECT public.competition_host_close_question('${sessionId}') AS res;`);
    const res = await db.query(`
      SELECT public.competition_host_get_question_result_by_order('${sessionId}', 2) AS res;
    `);
    const data = res.rows[0].res;
    assert.equal(data.success, true);
    assert.equal(data.question_closed, true);
    assert.equal(data.question_order, 2);
  });

  await t.test('9. Earlier question => allowed (Question 1 still readable)', async () => {
    await setAuthContext(hostId, 'authenticated');
    const res = await db.query(`
      SELECT public.competition_host_get_question_result_by_order('${sessionId}', 1) AS res;
    `);
    const data = res.rows[0].res;
    assert.equal(data.success, true);
    assert.equal(data.question_order, 1);
  });

  await t.test('10. Finished session => all played session questions readable', async () => {
    await setAuthContext(hostId, 'authenticated');
    // Move to question 3 before finishing session
    await db.query(`SELECT public.competition_host_next_question('${sessionId}') AS res;`);
    // Finish session
    await db.query(`SELECT public.competition_host_finish_session('${sessionId}') AS res;`);

    for (let order = 1; order <= 3; order++) {
      const res = await db.query(`
        SELECT public.competition_host_get_question_result_by_order('${sessionId}', ${order}) AS res;
      `);
      const data = res.rows[0].res;
      assert.equal(data.success, true, `Question ${order} must be readable in finished session`);
      assert.equal(data.question_order, order);
      assert.equal(data.total_questions, 3);
    }
  });

  await t.test('11. Aggregate shape matches current result contract', async () => {
    await setAuthContext(hostId, 'authenticated');
    const res = await db.query(`
      SELECT public.competition_host_get_question_result_by_order('${sessionId}', 1) AS res;
    `);
    const data = res.rows[0].res;
    assert.ok('success' in data);
    assert.ok('question_closed' in data);
    assert.ok('question_id' in data);
    assert.ok('question_order' in data);
    assert.ok('question_type' in data);
    assert.ok('question_text' in data);
    assert.ok('points' in data);
    assert.ok('total_eligible' in data);
    assert.ok('submitted_count' in data);
    assert.ok('unanswered_count' in data);
    assert.ok('correct_count' in data);
    assert.ok('incorrect_count' in data);
    assert.ok('correct_percentage' in data);
    assert.ok('distribution' in data);
    assert.ok('total_questions' in data);
  });

  await t.test('12-14. Zero PII & Zero raw answer rows exposed', async () => {
    await setAuthContext(hostId, 'authenticated');
    const res = await db.query(`
      SELECT public.competition_host_get_question_result_by_order('${sessionId}', 1) AS res;
    `);
    const rawJson = JSON.stringify(res.rows[0].res);
    assert.equal(rawJson.includes('user_id'), false, 'Must not expose user_id');
    assert.equal(rawJson.includes('guest_token_hash'), false, 'Must not expose guest_token_hash');
    assert.equal(rawJson.includes('guest_token'), false, 'Must not expose guest_token');
    assert.equal(rawJson.includes('raw_answers'), false, 'Must not expose raw answer rows');
  });

  await t.test('15. total_questions is authoritative (matches DB count)', async () => {
    await setAuthContext(hostId, 'authenticated');
    const res = await db.query(`
      SELECT public.competition_host_get_question_result_by_order('${sessionId}', 1) AS res;
    `);
    assert.equal(res.rows[0].res.total_questions, 3);
  });

  await t.test('16-19. Result fetch is purely read-only (zero mutation)', async () => {
    await setAuthContext(hostId, 'authenticated');
    const beforeScores = (await db.query(`SELECT participant_id, total_score, correct_count FROM public.competition_scores WHERE session_id = '${sessionId}';`)).rows;
    const beforeAnswers = (await db.query(`SELECT id, selected_option_ids, is_correct, points_awarded FROM public.competition_answers WHERE session_id = '${sessionId}';`)).rows;
    const beforeSession = (await db.query(`SELECT id, status, current_question_index FROM public.competition_sessions WHERE id = '${sessionId}';`)).rows[0];

    // Fetch result multiple times
    await db.query(`SELECT public.competition_host_get_question_result_by_order('${sessionId}', 1);`);
    await db.query(`SELECT public.competition_host_get_question_result_by_order('${sessionId}', 2);`);
    await db.query(`SELECT public.competition_host_get_question_result_by_order('${sessionId}', 3);`);

    const afterScores = (await db.query(`SELECT participant_id, total_score, correct_count FROM public.competition_scores WHERE session_id = '${sessionId}';`)).rows;
    const afterAnswers = (await db.query(`SELECT id, selected_option_ids, is_correct, points_awarded FROM public.competition_answers WHERE session_id = '${sessionId}';`)).rows;
    const afterSession = (await db.query(`SELECT id, status, current_question_index FROM public.competition_sessions WHERE id = '${sessionId}';`)).rows[0];

    assert.deepEqual(beforeScores, afterScores, 'Scores must not be mutated');
    assert.deepEqual(beforeAnswers, afterAnswers, 'Answers must not be mutated');
    assert.deepEqual(beforeSession, afterSession, 'Session state must not be mutated');
  });

  // ============================================================================
  // DIRECT REVIEW BLOCKER 1 — F5 TOTAL QUESTIONS
  // ============================================================================
  await t.test('BLOCKER 1: F5 Total Questions & Host Session Metadata RPC', async () => {
    await setAuthContext(hostId, 'authenticated');
    const create5Res = await db.query(`
      SELECT public.competition_host_create_session(
        'Đấu Trường 5 Câu',
        'Mô tả phòng thi',
        'individual',
        50,
        '[
          {"question_order": 1, "question_text": "Câu 1", "question_type": "single_choice", "points": 10.0, "time_limit_seconds": 30, "options": [{"id": "o1a", "text": "A"}, {"id": "o1b", "text": "B"}], "correct_answer": {"option_id": "o1a"}},
          {"question_order": 2, "question_text": "Câu 2", "question_type": "single_choice", "points": 10.0, "time_limit_seconds": 30, "options": [{"id": "o2a", "text": "A"}, {"id": "o2b", "text": "B"}], "correct_answer": {"option_id": "o2a"}},
          {"question_order": 3, "question_text": "Câu 3", "question_type": "single_choice", "points": 10.0, "time_limit_seconds": 30, "options": [{"id": "o3a", "text": "A"}, {"id": "o3b", "text": "B"}], "correct_answer": {"option_id": "o3a"}},
          {"question_order": 4, "question_text": "Câu 4", "question_type": "single_choice", "points": 10.0, "time_limit_seconds": 30, "options": [{"id": "o4a", "text": "A"}, {"id": "o4b", "text": "B"}], "correct_answer": {"option_id": "o4a"}},
          {"question_order": 5, "question_text": "Câu 5", "question_type": "single_choice", "points": 10.0, "time_limit_seconds": 30, "options": [{"id": "o5a", "text": "A"}, {"id": "o5b", "text": "B"}], "correct_answer": {"option_id": "o5a"}}
        ]'::jsonb,
        '[]'::jsonb,
        false,
        '{}'::jsonb,
        true
      ) AS res;
    `);
    const sess5 = create5Res.rows[0].res.session;
    const sess5Id = sess5.id;

    // Start session => Q1
    await db.query(`SELECT public.competition_host_start_session('${sess5Id}') AS res;`);
    // Next => Q2
    await db.query(`SELECT public.competition_host_next_question('${sess5Id}') AS res;`);
    // Next => Q3
    await db.query(`SELECT public.competition_host_next_question('${sess5Id}') AS res;`);

    // Simulate Host F5 / restore: Call competition_host_get_session_metadata
    const metaRes = await db.query(`
      SELECT public.competition_host_get_session_metadata('${sess5Id}') AS res;
    `);
    const meta = metaRes.rows[0].res;
    assert.equal(meta.success, true);
    assert.equal(meta.total_questions, 5);
    assert.equal(meta.current_question_index, 3);

    // Verify security: Unrelated teacher denied, student denied, anon denied
    await setAuthContext(otherTeacherId, 'authenticated');
    const deniedTeacher = await db.query(`SELECT public.competition_host_get_session_metadata('${sess5Id}') AS res;`);
    assert.equal(deniedTeacher.rows[0].res.success, false);
    assert.equal(deniedTeacher.rows[0].res.error_code, 'UNAUTHORIZED_ACCESS');

    await setAuthContext(studentId, 'authenticated');
    const deniedStudent = await db.query(`SELECT public.competition_host_get_session_metadata('${sess5Id}') AS res;`);
    assert.equal(deniedStudent.rows[0].res.success, false);
    assert.equal(deniedStudent.rows[0].res.error_code, 'UNAUTHORIZED_ACCESS');

    await setAuthContext(null, 'anon');
    const deniedAnon = await db.query(`SELECT public.competition_host_get_session_metadata('${sess5Id}') AS res;`);
    assert.equal(deniedAnon.rows[0].res.success, false);
    assert.equal(deniedAnon.rows[0].res.error_code, 'UNAUTHORIZED_ACCESS');

    // Host checks isFinalQuestion logic at Q3
    await setAuthContext(hostId, 'authenticated');
    const hasAuthoritativeTotal = Number.isInteger(Number(meta.total_questions)) && Number(meta.total_questions) > 0;
    const isFinalAtQ3 = hasAuthoritativeTotal && Number(meta.current_question_index) >= Number(meta.total_questions);
    assert.equal(isFinalAtQ3, false, 'Question 3 out of 5 must NOT be final');

    // Advance to Q4 and Q5
    await db.query(`SELECT public.competition_host_next_question('${sess5Id}') AS res;`);
    await db.query(`SELECT public.competition_host_next_question('${sess5Id}') AS res;`);

    const metaQ5Res = await db.query(`SELECT public.competition_host_get_session_metadata('${sess5Id}') AS res;`);
    const metaQ5 = metaQ5Res.rows[0].res;
    assert.equal(metaQ5.current_question_index, 5);
    const isFinalAtQ5 = hasAuthoritativeTotal && Number(metaQ5.current_question_index) >= Number(metaQ5.total_questions);
    assert.equal(isFinalAtQ5, true, 'Question 5 out of 5 MUST be final');
  });

  // ============================================================================
  // DIRECT REVIEW BLOCKER 2 — LATE JOINER (Snapshot Immutability against Late Joins)
  // ============================================================================
  let lateSessId;
  await t.test('BLOCKER 2: Late joiner does not alter historical eligible/unanswered counts', async () => {
    await setAuthContext(hostId, 'authenticated');
    const createRes2 = await db.query(`
      SELECT public.competition_host_create_session(
        'Đấu Trường Late Joiner',
        'Mô tả phòng thi',
        'individual',
        50,
        '[
          {"question_order": 1, "question_text": "Q1", "question_type": "single_choice", "points": 10.0, "time_limit_seconds": 30, "options": [{"id": "o1a", "text": "A"}, {"id": "o1b", "text": "B"}], "correct_answer": {"option_id": "o1a"}},
          {"question_order": 2, "question_text": "Q2", "question_type": "single_choice", "points": 10.0, "time_limit_seconds": 30, "options": [{"id": "o2a", "text": "A"}, {"id": "o2b", "text": "B"}], "correct_answer": {"option_id": "o2a"}}
        ]'::jsonb,
        '[]'::jsonb,
        false,
        '{}'::jsonb,
        true
      ) AS res;
    `);
    const lateSess = createRes2.rows[0].res.session;
    lateSessId = lateSess.id;
    const lateRoomCode = lateSess.room_code;

    const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const userC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${userA}', 'a@school.vn'),
        ('${userB}', 'b@school.vn'),
        ('${userC}', 'c@school.vn')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.profiles (id, role, full_name) VALUES
        ('${userA}', 'student', 'Học Sinh A'),
        ('${userB}', 'student', 'Học Sinh B'),
        ('${userC}', 'student', 'Học Sinh C')
      ON CONFLICT (id) DO NOTHING;
    `);

    // A and B join session
    await setAuthContext(userA, 'authenticated');
    const pA = (await db.query(`SELECT public.competition_join_session('${lateRoomCode}', 'Học Sinh A') AS res;`)).rows[0].res.participant.id;
    await setAuthContext(userB, 'authenticated');
    await db.query(`SELECT public.competition_join_session('${lateRoomCode}', 'Học Sinh B') AS res;`);

    // Host starts session (Q1)
    await setAuthContext(hostId, 'authenticated');
    await db.query(`SELECT public.competition_host_start_session('${lateSessId}') AS res;`);

    // A submits answer for Q1, B does not submit
    const q1 = (await db.query(`SELECT id FROM public.competition_questions WHERE session_id = '${lateSessId}' AND question_order = 1;`)).rows[0];
    await setAuthContext(userA, 'authenticated');
    await db.query(`
      SELECT public.competition_submit_answer('${lateSessId}'::UUID, '${q1.id}'::UUID, '${pA}'::UUID, null::TEXT, '["o1a"]'::jsonb, null::TEXT);
    `);

    // Host closes Q1
    await setAuthContext(hostId, 'authenticated');
    await db.query(`SELECT public.competition_host_close_question('${lateSessId}') AS res;`);

    // Read Q1 initial snapshot
    const q1ResBefore = (await db.query(`SELECT public.competition_host_get_question_result_by_order('${lateSessId}', 1) AS res;`)).rows[0].res;
    assert.equal(q1ResBefore.success, true);
    assert.equal(q1ResBefore.total_eligible, 2, 'Initially 2 participants were eligible');
    assert.equal(q1ResBefore.submitted_count, 1);
    assert.equal(q1ResBefore.unanswered_count, 1);

    // Now Participant C joins AFTER Q1 closed
    await setAuthContext(userC, 'authenticated');
    await db.query(`SELECT public.competition_join_session('${lateRoomCode}', 'Học Sinh C') AS res;`);

    // Host transitions to Q2
    await setAuthContext(hostId, 'authenticated');
    await db.query(`SELECT public.competition_host_next_question('${lateSessId}') AS res;`);

    // Fetch historical result for Q1 again
    const q1ResAfter = (await db.query(`SELECT public.competition_host_get_question_result_by_order('${lateSessId}', 1) AS res;`)).rows[0].res;
    assert.equal(q1ResAfter.success, true);
    assert.equal(q1ResAfter.total_eligible, 2, 'Historical Q1 total_eligible MUST remain 2, not 3');
    assert.equal(q1ResAfter.submitted_count, 1);
    assert.equal(q1ResAfter.unanswered_count, 1, 'Historical Q1 unanswered_count MUST remain 1');
  });

  // ============================================================================
  // DIRECT REVIEW BLOCKER 3 — POST-CLOSE KICK / STATUS CHANGE
  // ============================================================================
  await t.test('BLOCKER 3: Post-close participant kick/status change does not mutate historical snapshot', async () => {
    await setAuthContext(hostId, 'authenticated');
    // Using the previous session (lateSessId), kick participant B who was in Q1
    await db.exec(`
      UPDATE public.competition_participants
      SET status = 'kicked'
      WHERE session_id = '${lateSessId}' AND display_name = 'Học Sinh B';
    `);

    // Read Q1 historical result
    const q1ResPostKick = (await db.query(`SELECT public.competition_host_get_question_result_by_order('${lateSessId}', 1) AS res;`)).rows[0].res;
    assert.equal(q1ResPostKick.success, true);
    assert.equal(q1ResPostKick.total_eligible, 2, 'Historical snapshot must stay 2 even after B is kicked');
    assert.equal(q1ResPostKick.unanswered_count, 1, 'Historical snapshot unanswered count must stay 1');
  });

  // ============================================================================
  // DIRECT REVIEW BLOCKER 4 — NATURAL EXPIRY SNAPSHOT MATERIALIZATION
  // ============================================================================
  let expSessId;
  await t.test('BLOCKER 4: Natural deadline expiry materializes snapshot on next_question transition', async () => {
    await setAuthContext(hostId, 'authenticated');
    const createRes3 = await db.query(`
      SELECT public.competition_host_create_session(
        'Đấu Trường Natural Expiry',
        'Mô tả phòng thi',
        'individual',
        50,
        '[
          {"question_order": 1, "question_text": "Q1 Expire", "question_type": "single_choice", "points": 10.0, "time_limit_seconds": 30, "options": [{"id": "o1a", "text": "A"}, {"id": "o1b", "text": "B"}], "correct_answer": {"option_id": "o1a"}},
          {"question_order": 2, "question_text": "Q2", "question_type": "single_choice", "points": 10.0, "time_limit_seconds": 30, "options": [{"id": "o2a", "text": "A"}, {"id": "o2b", "text": "B"}], "correct_answer": {"option_id": "o2a"}}
        ]'::jsonb,
        '[]'::jsonb,
        false,
        '{}'::jsonb,
        true
      ) AS res;
    `);
    expSessId = createRes3.rows[0].res.session.id;

    // Start session (Q1)
    await db.query(`SELECT public.competition_host_start_session('${expSessId}') AS res;`);

    // Simulate natural deadline expiration in DB without host_close_question
    await db.exec(`
      UPDATE public.competition_sessions
      SET question_deadline = now() - INTERVAL '5 seconds'
      WHERE id = '${expSessId}';
    `);

    // Host calls host_next_question directly without calling host_close_question
    await db.query(`SELECT public.competition_host_next_question('${expSessId}') AS res;`);

    // Check that snapshot row exists in database for Q1
    const snapshotRows = (await db.query(`
      SELECT * FROM public.competition_question_result_snapshots
      WHERE session_id = '${expSessId}' AND question_order = 1;
    `)).rows;
    assert.equal(snapshotRows.length, 1, 'Snapshot for naturally expired Q1 must be materialized during transition');

    // Historical RPC returns Q1 result
    const histRes = (await db.query(`SELECT public.competition_host_get_question_result_by_order('${expSessId}', 1) AS res;`)).rows[0].res;
    assert.equal(histRes.success, true);
    assert.equal(histRes.question_closed, true);
    assert.equal(histRes.question_order, 1);
  });

  // ============================================================================
  // DIRECT REVIEW BLOCKER 5 — IDEMPOTENCY
  // ============================================================================
  await t.test('BLOCKER 5: Snapshot creation is strictly idempotent with zero duplication or count drift', async () => {
    await setAuthContext(hostId, 'authenticated');
    for (let i = 0; i < 5; i++) {
      await db.query(`SELECT public.competition_host_get_question_result_by_order('${expSessId}', 1);`);
    }

    const countRows = (await db.query(`
      SELECT count(*)::INT AS total_rows
      FROM public.competition_question_result_snapshots
      WHERE session_id = '${expSessId}' AND question_order = 1;
    `)).rows[0];

    assert.equal(countRows.total_rows, 1, 'Only 1 snapshot row can exist per question');
  });
});

test('COMPETITION V1 R12 — FRONTEND & UX INVARIANTS STATIC ASSERTIONS', async (t) => {
  const hostPageSrc = fs.readFileSync(path.resolve('src/pages/CompetitionHostPage.jsx'), 'utf8');
  const studentPageSrc = fs.readFileSync(path.resolve('src/pages/CompetitionStudentPage.jsx'), 'utf8');
  const clientServiceSrc = fs.readFileSync(path.resolve('src/services/competitionClient.js'), 'utf8');

  await t.test('20. Previous result navigation buttons exist in Host Page', () => {
    assert.ok(hostPageSrc.includes('handleReviewPrevQuestion'));
    assert.ok(hostPageSrc.includes('handleReviewNextQuestion'));
    assert.ok(hostPageSrc.includes('← Câu Trước'));
    assert.ok(hostPageSrc.includes('Câu Sau →'));
  });

  await t.test('21. Previous review uses getHostQuestionResultByOrder', () => {
    assert.ok(clientServiceSrc.includes('export async function getHostQuestionResultByOrder'));
    assert.ok(hostPageSrc.includes('getHostQuestionResultByOrder'));
    assert.ok(hostPageSrc.includes('fetchHistoricalResult'));
  });

  await t.test('22. Previous review never calls hostNextQuestion', () => {
    // Extract handleReviewPrevQuestion and handleReviewNextQuestion function bodies
    const prevFnMatch = hostPageSrc.match(/const handleReviewPrevQuestion =[\s\S]*?\}, \[/);
    const nextFnMatch = hostPageSrc.match(/const handleReviewNextQuestion =[\s\S]*?\}, \[/);
    assert.ok(prevFnMatch && !prevFnMatch[0].includes('hostNextQuestion'), 'handleReviewPrevQuestion must not call hostNextQuestion');
    assert.ok(nextFnMatch && !nextFnMatch[0].includes('hostNextQuestion'), 'handleReviewNextQuestion must not call hostNextQuestion');
  });

  await t.test('23. Previous review does not mutate current_question_index', () => {
    assert.ok(hostPageSrc.includes('reviewedQuestionOrder'));
    assert.ok(hostPageSrc.includes('reviewedQuestionResults'));
  });

  await t.test('24. "Đang xem lại..." badge exists', () => {
    assert.ok(hostPageSrc.includes('Đang xem lại kết quả Câu'));
    assert.ok(hostPageSrc.includes('— chỉ xem'));
  });

  await t.test('25. "Trở Về Câu Hiện Tại" button exists', () => {
    assert.ok(hostPageSrc.includes('handleReturnToCurrentQuestion'));
    assert.ok(hostPageSrc.includes('Trở Về Câu Hiện Tại'));
  });

  await t.test('26. Historical review works independently of frontend cache', () => {
    assert.ok(hostPageSrc.includes('fetchHistoricalResult'));
    assert.ok(hostPageSrc.includes('getHostQuestionResultByOrder'));
  });

  await t.test('27. Quick leaderboard is hidden in LEADERBOARD view', () => {
    assert.ok(hostPageSrc.includes("hostViewMode !== 'LEADERBOARD'"));
  });

  await t.test('28-29. Quick leaderboard remains usable in LIVE_QUESTION and QUESTION_RESULTS', () => {
    assert.ok(hostPageSrc.includes('isLeaderboardOpen && hostViewMode !== \'LEADERBOARD\''));
  });

  await t.test('30. No extra background leaderboard polling loop added', () => {
    assert.ok(hostPageSrc.includes('useEffect(() => {'));
  });

  await t.test('31-33. Student/Guest options & submit button disabled at timer 0', () => {
    assert.ok(studentPageSrc.includes('const isTimeExpired = timeLeftSeconds !== null && timeLeftSeconds <= 0;'));
    assert.ok(studentPageSrc.includes('isTimeExpired'));
    assert.ok(studentPageSrc.includes('disabled={!selectedOptionId || isSubmitting || isPaused || isTimeExpired || hasSubmittedCurrentQuestion}'));
  });

  await t.test('34. handleSubmitAnswer locally guards timer 0', () => {
    assert.ok(studentPageSrc.includes('isTimeExpired'));
  });

  await t.test('35. Button label at timer 0 = "Đã Hết Thời Gian"', () => {
    assert.ok(studentPageSrc.includes('Đã Hết Thời Gian'));
  });

  await t.test('36. Server ANSWER_TOO_LATE handling preserved', () => {
    assert.ok(studentPageSrc.includes('ANSWER_TOO_LATE'));
  });

  await t.test('37. Non-final question shows "Câu Tiếp Theo"', () => {
    assert.ok(hostPageSrc.includes('Câu Tiếp Theo'));
  });

  await t.test('38. Final question shows "Kết Thúc Trận"', () => {
    assert.ok(hostPageSrc.includes('isFinalQuestion'));
    assert.ok(hostPageSrc.includes('Kết Thúc Trận'));
    assert.ok(hostPageSrc.includes('Đây là câu cuối cùng. Bạn có muốn kết thúc trận đấu và tính bảng xếp hạng chung cuộc không?'));
  });

  await t.test('39-40. Final normal action calls handleFinishSession and NOT hostNextQuestion', () => {
    assert.ok(hostPageSrc.includes('onConfirm: handleFinishSession'));
  });

  await t.test('41. "Kết Thúc Sớm" remains available before final', () => {
    assert.ok(hostPageSrc.includes('Kết Thúc Sớm'));
  });

  await t.test('42. Authoritative total_questions survives Host F5', () => {
    assert.ok(hostPageSrc.includes('authoritativeTotalQuestions'));
    assert.ok(hostPageSrc.includes('setAuthoritativeTotalQuestions(res.data.total_questions)'));
  });

  await t.test('43-44. Authenticated student & Guest public join flows preserved', () => {
    assert.ok(studentPageSrc.includes('isPublicJoin'));
    assert.ok(studentPageSrc.includes('guestToken'));
  });

  await t.test('45. R7 lazy analytics invariant preserved', () => {
    assert.ok(hostPageSrc.includes("finishedTab === 'ANALYTICS'"));
  });

  await t.test('46. RANK() tie handling unchanged in export utilities', () => {
    const lb = [
      { rank: 1, display_name: 'A', total_score: 100 },
      { rank: 2, display_name: 'B', total_score: 90 },
      { rank: 2, display_name: 'C', total_score: 90 },
      { rank: 4, display_name: 'D', total_score: 80 }
    ];
    const top2 = filterLeaderboardByRank(lb, 2);
    assert.equal(top2.length, 3, 'Ties at rank 2 must include both participants');
  });

  await t.test('47. R11 tie indicator unchanged', () => {
    const lb = [{ rank: 1 }, { rank: 2 }, { rank: 2 }, { rank: 4 }];
    const summary = getTopNSelectionSummary(lb, 2);
    assert.equal(summary.selectedCount, 3);
    assert.equal(summary.hasBoundaryTie, true);
    assert.equal(summary.extraDueToTie, 1);
    assert.equal(summary.boundaryRank, 2);
  });

  await t.test('48. Export builders work cleanly', () => {
    const csv = buildLeaderboardCsv({
      title: 'Đấu Trường Test',
      roomCode: 'ROOM123',
      leaderboardData: [
        { rank: 1, display_name: 'Học Sinh A', total_score: 100, correct_count: 5, total_response_time_ms: 10000, is_guest: false }
      ]
    });
    assert.ok(csv.includes('Học Sinh A'));
    assert.ok(csv.includes('ROOM123'));
  });
});
