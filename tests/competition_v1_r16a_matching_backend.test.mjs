import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { MAX_COMPETITION_QUESTIONS } from '../src/utils/competitionQuestionAdapters.js';

console.log('================================================================================');
console.log('🧪 COMPETITION V1 R16-A — MATCHING BACKEND CONTRACT TEST SUITE');
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

  // Migration 12: Host Historical Question Results by Order (R12)
  const m12Path = path.resolve('supabase/migrations/20261008110000_competition_v1_host_historical_question_results.sql');
  await db.exec(fs.readFileSync(m12Path, 'utf8'));

  // Migration 13: R16-A Matching Backend Contract
  const m13Path = path.resolve('supabase/migrations/20261011000001_competition_v1_r16a_matching_backend.sql');
  await db.exec(fs.readFileSync(m13Path, 'utf8'));
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

test('COMPETITION V1 R16-A — MATCHING BACKEND CONTRACT TEST MATRIX (43 TESTS)', async (t) => {
  await setupDatabase();

  // Seed Users
  const hostId = '11111111-1111-4111-8111-111111111111';
  const adminId = '22222222-2222-4222-8222-222222222222';
  const otherTeacherId = '33333333-3333-4333-8333-333333333333';
  const student1Id = '44444444-4444-4444-8444-444444444444';
  const student2Id = '55555555-5555-5555-8555-555555555555';
  const student3Id = '66666666-6666-6666-8666-666666666666';

  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${hostId}', 'host@test.com'),
      ('${adminId}', 'admin@test.com'),
      ('${otherTeacherId}', 'teacher2@test.com'),
      ('${student1Id}', 'student1@test.com'),
      ('${student2Id}', 'student2@test.com'),
      ('${student3Id}', 'student3@test.com');

    INSERT INTO public.profiles (id, role, full_name) VALUES
      ('${hostId}', 'teacher', 'Host Teacher'),
      ('${adminId}', 'admin', 'System Admin'),
      ('${otherTeacherId}', 'teacher', 'Other Teacher'),
      ('${student1Id}', 'student', 'Student One'),
      ('${student2Id}', 'student', 'Student Two'),
      ('${student3Id}', 'student', 'Student Three');
  `);

  // Canonical helper to create matching question
  function makeMatchingQuestion(numPairs = 4) {
    const options = [];
    const pairs = [];
    for (let i = 1; i <= numPairs; i++) {
      options.push({ id: `l_${i}`, side: 'left', text: `Vế trái ${i}` });
      options.push({ id: `r_${i}`, side: 'right', text: `Vế phải ${i}` });
      pairs.push({ left_id: `l_${i}`, right_id: `r_${i}` });
    }
    return {
      question_order: 1,
      question_text: `Nối cặp từ ${numPairs} mục`,
      question_type: 'matching',
      points: 20,
      time_limit_seconds: 30,
      options,
      correct_answer: { pairs }
    };
  }

  // =========================================================================
  // GROUP 1: CREATION & VALIDATION MATRIX (TESTS 1 - 16)
  // =========================================================================
  await t.test('Group 1: Host Create Session Matching Validation (Tests 1-16)', async (t) => {
    await setAuthContext(hostId);

    // 1. matching canonical question accepted
    await t.test('1. matching canonical question accepted', async () => {
      const q = makeMatchingQuestion(4);
      const res = await db.query(
        `SELECT public.competition_host_create_session($1, $2, $3, $4, $5::jsonb) AS result`,
        ['Phòng thi Matching 1', 'Mô tả', 'individual', 100, JSON.stringify([q])]
      );
      const data = res.rows[0].result;
      assert.strictEqual(data.success, true);
      assert.ok(data.session_id);
    });

    // 2. matching 2 pairs accepted
    await t.test('2. matching 2 pairs accepted', async () => {
      const q = makeMatchingQuestion(2);
      const res = await db.query(
        `SELECT public.competition_host_create_session($1, $2, $3, $4, $5::jsonb) AS result`,
        ['Phòng thi Matching 2', 'Mô tả', 'individual', 100, JSON.stringify([q])]
      );
      const data = res.rows[0].result;
      assert.strictEqual(data.success, true);
    });

    // 3. matching 6 pairs accepted
    await t.test('3. matching 6 pairs accepted', async () => {
      const q = makeMatchingQuestion(6);
      const res = await db.query(
        `SELECT public.competition_host_create_session($1, $2, $3, $4, $5::jsonb) AS result`,
        ['Phòng thi Matching 6', 'Mô tả', 'individual', 100, JSON.stringify([q])]
      );
      const data = res.rows[0].result;
      assert.strictEqual(data.success, true);
    });

    // 4. matching 1 pair rejected
    await t.test('4. matching 1 pair rejected', async () => {
      const q = makeMatchingQuestion(1);
      const res = await db.query(
        `SELECT public.competition_host_create_session($1, $2, $3, $4, $5::jsonb) AS result`,
        ['Phòng thi Matching 1 pair', 'Mô tả', 'individual', 100, JSON.stringify([q])]
      );
      const data = res.rows[0].result;
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.error_code, 'MALFORMED_QUESTION_PAYLOAD');
    });

    // 5. matching 7 pairs rejected
    await t.test('5. matching 7 pairs rejected', async () => {
      const q = makeMatchingQuestion(7);
      const res = await db.query(
        `SELECT public.competition_host_create_session($1, $2, $3, $4, $5::jsonb) AS result`,
        ['Phòng thi Matching 7 pairs', 'Mô tả', 'individual', 100, JSON.stringify([q])]
      );
      const data = res.rows[0].result;
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.error_code, 'MALFORMED_QUESTION_PAYLOAD');
    });

    // 6. unequal left/right counts rejected
    await t.test('6. unequal left/right counts rejected', async () => {
      const q = makeMatchingQuestion(3);
      q.options.push({ id: 'l_4', side: 'left', text: 'Thừa vế trái' });
      const res = await db.query(
        `SELECT public.competition_host_create_session($1, $2, $3, $4, $5::jsonb) AS result`,
        ['Phòng thi unequal', 'Mô tả', 'individual', 100, JSON.stringify([q])]
      );
      const data = res.rows[0].result;
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.error_code, 'MALFORMED_QUESTION_PAYLOAD');
    });

    // 7. duplicate option ID rejected
    await t.test('7. duplicate option ID rejected', async () => {
      const q = makeMatchingQuestion(3);
      q.options[1].id = q.options[0].id;
      const res = await db.query(
        `SELECT public.competition_host_create_session($1, $2, $3, $4, $5::jsonb) AS result`,
        ['Phòng thi duplicate id', 'Mô tả', 'individual', 100, JSON.stringify([q])]
      );
      const data = res.rows[0].result;
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.error_code, 'MALFORMED_QUESTION_PAYLOAD');
    });

    // 8. invalid side rejected
    await t.test('8. invalid side rejected', async () => {
      const q = makeMatchingQuestion(3);
      q.options[0].side = 'center';
      const res = await db.query(
        `SELECT public.competition_host_create_session($1, $2, $3, $4, $5::jsonb) AS result`,
        ['Phòng thi invalid side', 'Mô tả', 'individual', 100, JSON.stringify([q])]
      );
      const data = res.rows[0].result;
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.error_code, 'MALFORMED_QUESTION_PAYLOAD');
    });

    // 9. empty text rejected
    await t.test('9. empty text rejected', async () => {
      const q = makeMatchingQuestion(3);
      q.options[0].text = '   ';
      const res = await db.query(
        `SELECT public.competition_host_create_session($1, $2, $3, $4, $5::jsonb) AS result`,
        ['Phòng thi empty text', 'Mô tả', 'individual', 100, JSON.stringify([q])]
      );
      const data = res.rows[0].result;
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.error_code, 'MALFORMED_QUESTION_PAYLOAD');
    });

    // 10. malformed correct_answer rejected
    await t.test('10. malformed correct_answer rejected', async () => {
      const q = makeMatchingQuestion(3);
      q.correct_answer = { invalid: true };
      const res = await db.query(
        `SELECT public.competition_host_create_session($1, $2, $3, $4, $5::jsonb) AS result`,
        ['Phòng thi malformed answer', 'Mô tả', 'individual', 100, JSON.stringify([q])]
      );
      const data = res.rows[0].result;
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.error_code, 'MALFORMED_QUESTION_PAYLOAD');
    });

    // 11. unknown left_id rejected
    await t.test('11. unknown left_id rejected', async () => {
      const q = makeMatchingQuestion(3);
      q.correct_answer.pairs[0].left_id = 'l_unknown';
      const res = await db.query(
        `SELECT public.competition_host_create_session($1, $2, $3, $4, $5::jsonb) AS result`,
        ['Phòng thi unknown left', 'Mô tả', 'individual', 100, JSON.stringify([q])]
      );
      const data = res.rows[0].result;
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.error_code, 'MALFORMED_QUESTION_PAYLOAD');
    });

    // 12. unknown right_id rejected
    await t.test('12. unknown right_id rejected', async () => {
      const q = makeMatchingQuestion(3);
      q.correct_answer.pairs[0].right_id = 'r_unknown';
      const res = await db.query(
        `SELECT public.competition_host_create_session($1, $2, $3, $4, $5::jsonb) AS result`,
        ['Phòng thi unknown right', 'Mô tả', 'individual', 100, JSON.stringify([q])]
      );
      const data = res.rows[0].result;
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.error_code, 'MALFORMED_QUESTION_PAYLOAD');
    });

    // 13. duplicated left mapping rejected
    await t.test('13. duplicated left mapping rejected', async () => {
      const q = makeMatchingQuestion(3);
      q.correct_answer.pairs[1].left_id = q.correct_answer.pairs[0].left_id;
      const res = await db.query(
        `SELECT public.competition_host_create_session($1, $2, $3, $4, $5::jsonb) AS result`,
        ['Phòng thi dup left map', 'Mô tả', 'individual', 100, JSON.stringify([q])]
      );
      const data = res.rows[0].result;
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.error_code, 'MALFORMED_QUESTION_PAYLOAD');
    });

    // 14. duplicated right mapping rejected
    await t.test('14. duplicated right mapping rejected', async () => {
      const q = makeMatchingQuestion(3);
      q.correct_answer.pairs[1].right_id = q.correct_answer.pairs[0].right_id;
      const res = await db.query(
        `SELECT public.competition_host_create_session($1, $2, $3, $4, $5::jsonb) AS result`,
        ['Phòng thi dup right map', 'Mô tả', 'individual', 100, JSON.stringify([q])]
      );
      const data = res.rows[0].result;
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.error_code, 'MALFORMED_QUESTION_PAYLOAD');
    });

    // 15. incomplete correct mapping rejected
    await t.test('15. incomplete correct mapping rejected', async () => {
      const q = makeMatchingQuestion(3);
      q.correct_answer.pairs.pop();
      const res = await db.query(
        `SELECT public.competition_host_create_session($1, $2, $3, $4, $5::jsonb) AS result`,
        ['Phòng thi incomplete map', 'Mô tả', 'individual', 100, JSON.stringify([q])]
      );
      const data = res.rows[0].result;
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.error_code, 'MALFORMED_QUESTION_PAYLOAD');
    });

    // 16. extra correct mapping rejected
    await t.test('16. extra correct mapping rejected', async () => {
      const q = makeMatchingQuestion(3);
      q.correct_answer.pairs.push({ left_id: 'l_1', right_id: 'r_1' });
      const res = await db.query(
        `SELECT public.competition_host_create_session($1, $2, $3, $4, $5::jsonb) AS result`,
        ['Phòng thi extra map', 'Mô tả', 'individual', 100, JSON.stringify([q])]
      );
      const data = res.rows[0].result;
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.error_code, 'MALFORMED_QUESTION_PAYLOAD');
    });
  });

  // =========================================================================
  // GROUP 2: SUBMISSION, VALIDATION & SCORING MATRIX (TESTS 17 - 29)
  // =========================================================================
  await t.test('Group 2: Matching Submission Scoring & Invariants (Tests 17-29)', async (t) => {
    // Create live matching session
    await setAuthContext(hostId);
    const qMatching = {
      question_order: 1,
      question_text: 'Nối thủ đô với quốc gia',
      question_type: 'matching',
      points: 50,
      time_limit_seconds: 40,
      options: [
        { id: 'l_vn', side: 'left', text: 'Việt Nam' },
        { id: 'l_jp', side: 'left', text: 'Nhật Bản' },
        { id: 'l_fr', side: 'left', text: 'Pháp' },
        { id: 'r_hn', side: 'right', text: 'Hà Nội' },
        { id: 'r_ty', side: 'right', text: 'Tokyo' },
        { id: 'r_pa', side: 'right', text: 'Paris' }
      ],
      correct_answer: {
        pairs: [
          { left_id: 'l_vn', right_id: 'r_hn' },
          { left_id: 'l_jp', right_id: 'r_ty' },
          { left_id: 'l_fr', right_id: 'r_pa' }
        ]
      }
    };

    const createRes = await db.query(
      `SELECT public.competition_host_create_session($1, $2, $3, $4, $5::jsonb, '[]'::jsonb, false, '{}'::jsonb, true) AS result`,
      ['Đấu trường Matching Live', 'Mô tả', 'individual', 100, JSON.stringify([qMatching])]
    );
    const sessionId = createRes.rows[0].result.session_id;
    const roomCode = createRes.rows[0].result.room_code;

    // Join Student 1, Student 2, Student 3
    await setAuthContext(student1Id);
    await db.query(`SELECT public.competition_join_session($1, 'Học Sinh 1') AS result`, [roomCode]);

    await setAuthContext(student2Id);
    await db.query(`SELECT public.competition_join_session($1, 'Học Sinh 2') AS result`, [roomCode]);

    await setAuthContext(student3Id);
    await db.query(`SELECT public.competition_join_session($1, 'Học Sinh 3') AS result`, [roomCode]);

    // Host starts session
    await setAuthContext(hostId);
    await db.query(`SELECT public.competition_host_start_session($1) AS result`, [sessionId]);

    // Retrieve active question id
    const qRow = (await db.query(
      `SELECT current_question_id FROM public.competition_sessions WHERE id = $1`,
      [sessionId]
    )).rows[0];
    const questionId = qRow.current_question_id;

    // 17. correct submission exact order PASS
    await t.test('17. correct submission exact order PASS', async () => {
      await setAuthContext(student1Id);
      const submission = [
        { left_id: 'l_vn', right_id: 'r_hn' },
        { left_id: 'l_jp', right_id: 'r_ty' },
        { left_id: 'l_fr', right_id: 'r_pa' }
      ];
      const res = await db.query(
        `SELECT public.competition_submit_answer($1, $2, NULL, NULL, $3::jsonb, NULL) AS result`,
        [sessionId, questionId, JSON.stringify(submission)]
      );
      const data = res.rows[0].result;
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.is_correct, true);
      assert.strictEqual(data.points_awarded, 50);
      assert.strictEqual(data.correct_count, 1);
    });

    // 18. correct submission different order PASS
    await t.test('18. correct submission different order PASS', async () => {
      await setAuthContext(student2Id);
      const submission = [
        { left_id: 'l_fr', right_id: 'r_pa' },
        { left_id: 'l_vn', right_id: 'r_hn' },
        { left_id: 'l_jp', right_id: 'r_ty' }
      ];
      const res = await db.query(
        `SELECT public.competition_submit_answer($1, $2, NULL, NULL, $3::jsonb, NULL) AS result`,
        [sessionId, questionId, JSON.stringify(submission)]
      );
      const data = res.rows[0].result;
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.is_correct, true);
      assert.strictEqual(data.points_awarded, 50);
      assert.strictEqual(data.correct_count, 1);
    });

    // 19. wrong pair mapping FAIL
    await t.test('19. wrong pair mapping FAIL', async () => {
      await setAuthContext(student3Id);
      const submission = [
        { left_id: 'l_vn', right_id: 'r_ty' },
        { left_id: 'l_jp', right_id: 'r_hn' },
        { left_id: 'l_fr', right_id: 'r_pa' }
      ];
      const res = await db.query(
        `SELECT public.competition_submit_answer($1, $2, NULL, NULL, $3::jsonb, NULL) AS result`,
        [sessionId, questionId, JSON.stringify(submission)]
      );
      const data = res.rows[0].result;
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.is_correct, false);
      assert.strictEqual(data.points_awarded, 0);
      assert.strictEqual(data.correct_count, 0);
    });

    // Test submission validation errors on a fresh session created by Host
    await setAuthContext(hostId);
    const createSubErrSession = await db.query(
      `SELECT public.competition_host_create_session($1, $2, $3, $4, $5::jsonb) AS result`,
      ['Session Test Errors', 'Mô tả', 'individual', 100, JSON.stringify([qMatching])]
    );
    const errSessionId = createSubErrSession.rows[0].result.session_id;
    const errRoomCode = createSubErrSession.rows[0].result.room_code;

    await setAuthContext(student1Id);
    await db.query(`SELECT public.competition_join_session($1, 'Học Sinh 1')`, [errRoomCode]);

    await setAuthContext(hostId);
    await db.query(`SELECT public.competition_host_start_session($1)`, [errSessionId]);
    const errQId = (await db.query(`SELECT current_question_id FROM public.competition_sessions WHERE id = $1`, [errSessionId])).rows[0].current_question_id;

    // 20. missing submission pair rejected/fail-closed
    await t.test('20. missing submission pair rejected/fail-closed', async () => {
      await setAuthContext(student1Id);
      const missingPairSub = [
        { left_id: 'l_vn', right_id: 'r_hn' },
        { left_id: 'l_jp', right_id: 'r_ty' }
      ];
      const res = await db.query(
        `SELECT public.competition_submit_answer($1, $2, NULL, NULL, $3::jsonb) AS result`,
        [errSessionId, errQId, JSON.stringify(missingPairSub)]
      );
      assert.strictEqual(res.rows[0].result.success, false);
      assert.strictEqual(res.rows[0].result.error_code, 'INVALID_ANSWER_PAYLOAD');
    });

    // 21. extra submission pair rejected/fail-closed
    await t.test('21. extra submission pair rejected/fail-closed', async () => {
      await setAuthContext(student1Id);
      const extraPairSub = [
        { left_id: 'l_vn', right_id: 'r_hn' },
        { left_id: 'l_jp', right_id: 'r_ty' },
        { left_id: 'l_fr', right_id: 'r_pa' },
        { left_id: 'l_extra', right_id: 'r_extra' }
      ];
      const res = await db.query(
        `SELECT public.competition_submit_answer($1, $2, NULL, NULL, $3::jsonb) AS result`,
        [errSessionId, errQId, JSON.stringify(extraPairSub)]
      );
      assert.strictEqual(res.rows[0].result.success, false);
      assert.strictEqual(res.rows[0].result.error_code, 'INVALID_ANSWER_PAYLOAD');
    });

    // 22. duplicate submitted left rejected
    await t.test('22. duplicate submitted left rejected', async () => {
      await setAuthContext(student1Id);
      const dupLeftSub = [
        { left_id: 'l_vn', right_id: 'r_hn' },
        { left_id: 'l_vn', right_id: 'r_ty' },
        { left_id: 'l_fr', right_id: 'r_pa' }
      ];
      const res = await db.query(
        `SELECT public.competition_submit_answer($1, $2, NULL, NULL, $3::jsonb) AS result`,
        [errSessionId, errQId, JSON.stringify(dupLeftSub)]
      );
      assert.strictEqual(res.rows[0].result.success, false);
      assert.strictEqual(res.rows[0].result.error_code, 'INVALID_ANSWER_PAYLOAD');
    });

    // 23. duplicate submitted right rejected
    await t.test('23. duplicate submitted right rejected', async () => {
      await setAuthContext(student1Id);
      const dupRightSub = [
        { left_id: 'l_vn', right_id: 'r_hn' },
        { left_id: 'l_jp', right_id: 'r_hn' },
        { left_id: 'l_fr', right_id: 'r_pa' }
      ];
      const res = await db.query(
        `SELECT public.competition_submit_answer($1, $2, NULL, NULL, $3::jsonb) AS result`,
        [errSessionId, errQId, JSON.stringify(dupRightSub)]
      );
      assert.strictEqual(res.rows[0].result.success, false);
      assert.strictEqual(res.rows[0].result.error_code, 'INVALID_ANSWER_PAYLOAD');
    });

    // 24. unknown submitted ID rejected
    await t.test('24. unknown submitted ID rejected', async () => {
      await setAuthContext(student1Id);
      const unknownSub = [
        { left_id: 'l_unknown', right_id: 'r_hn' },
        { left_id: 'l_jp', right_id: 'r_ty' },
        { left_id: 'l_fr', right_id: 'r_pa' }
      ];
      const res = await db.query(
        `SELECT public.competition_submit_answer($1, $2, NULL, NULL, $3::jsonb) AS result`,
        [errSessionId, errQId, JSON.stringify(unknownSub)]
      );
      assert.strictEqual(res.rows[0].result.success, false);
      assert.strictEqual(res.rows[0].result.error_code, 'INVALID_OPTION_SELECTED');
    });

    // 25. matching points full credit only
    await t.test('25. matching points full credit only', async () => {
      const scoreRow = (await db.query(
        `SELECT total_score FROM public.competition_scores s
         JOIN public.competition_participants p ON p.id = s.participant_id
         WHERE s.session_id = $1 AND p.user_id = $2`,
        [sessionId, student1Id]
      )).rows[0];
      assert.strictEqual(Number(scoreRow.total_score), 50.00);
    });

    // 26. matching incorrect gets zero points
    await t.test('26. matching incorrect gets zero points', async () => {
      const scoreRow = (await db.query(
        `SELECT total_score FROM public.competition_scores s
         JOIN public.competition_participants p ON p.id = s.participant_id
         WHERE s.session_id = $1 AND p.user_id = $2`,
        [sessionId, student3Id]
      )).rows[0];
      assert.strictEqual(Number(scoreRow.total_score), 0.00);
    });

    // 27. correct_count increments exactly 1
    await t.test('27. correct_count increments exactly 1', async () => {
      const scoreRow = (await db.query(
        `SELECT correct_count FROM public.competition_scores s
         JOIN public.competition_participants p ON p.id = s.participant_id
         WHERE s.session_id = $1 AND p.user_id = $2`,
        [sessionId, student1Id]
      )).rows[0];
      assert.strictEqual(scoreRow.correct_count, 1);
    });

    // 28. incorrect correct_count increment 0
    await t.test('28. incorrect correct_count increment 0', async () => {
      const scoreRow = (await db.query(
        `SELECT correct_count FROM public.competition_scores s
         JOIN public.competition_participants p ON p.id = s.participant_id
         WHERE s.session_id = $1 AND p.user_id = $2`,
        [sessionId, student3Id]
      )).rows[0];
      assert.strictEqual(scoreRow.correct_count, 0);
    });

    // 29. response time accumulation preserved
    await t.test('29. response time accumulation preserved', async () => {
      const scoreRow = (await db.query(
        `SELECT total_response_time_ms FROM public.competition_scores s
         JOIN public.competition_participants p ON p.id = s.participant_id
         WHERE s.session_id = $1 AND p.user_id = $2`,
        [sessionId, student1Id]
      )).rows[0];
      assert.ok(scoreRow.total_response_time_ms >= 0);
    });
  });

  // =========================================================================
  // GROUP 3: SNAPSHOT, REVEAL GATE & SECURITY MATRIX (TESTS 30 - 35)
  // =========================================================================
  await t.test('Group 3: Snapshot, Results Contract & Security (Tests 30-35)', async (t) => {
    // Create new session for snapshot testing
    await setAuthContext(hostId);
    const qMatching = makeMatchingQuestion(3);
    const createRes = await db.query(
      `SELECT public.competition_host_create_session($1, $2, $3, $4, $5::jsonb, '[]'::jsonb, false, '{}'::jsonb, true) AS result`,
      ['Session Snapshot Sec', 'Mô tả', 'individual', 100, JSON.stringify([qMatching])]
    );
    const sessionId = createRes.rows[0].result.session_id;
    const roomCode = createRes.rows[0].result.room_code;

    // Join student and guest WHILE SESSION IS IN 'waiting' STATUS
    await setAuthContext(student1Id);
    await db.query(`SELECT public.competition_join_session($1, 'Học Sinh 1')`, [roomCode]);

    // Guest joins in waiting state
    await setAuthContext(null);
    const guestToken = '12345678901234567890123456789012';
    const guestJoin = await db.query(
      `SELECT public.competition_join_session($1, 'Khách 1', NULL, NULL, $2) AS result`,
      [roomCode, guestToken]
    );
    const guestData = guestJoin.rows[0].result;
    assert.strictEqual(guestData.success, true);
    const guestPartId = guestData.participant.id;

    // Host starts session
    await setAuthContext(hostId);
    await db.query(`SELECT public.competition_host_start_session($1)`, [sessionId]);

    // 30. active snapshot excludes correct mapping
    await t.test('30. active snapshot excludes correct mapping', async () => {
      await setAuthContext(student1Id);
      const snapRes = await db.query(
        `SELECT public.competition_get_active_question_snapshot($1) AS result`,
        [sessionId]
      );
      const snap = snapRes.rows[0].result;
      assert.strictEqual(snap.success, true);
      assert.ok(snap.question);
      assert.strictEqual(snap.question.question_type, 'matching');
      assert.ok(Array.isArray(snap.question.options));
      assert.strictEqual(snap.question.correct_answer, undefined);
      assert.strictEqual(snap.question.pairs, undefined);
      assert.strictEqual(snap.question.explanation, undefined);
    });

    // 33. active Spectator cannot see correct mapping
    await t.test('33. active Spectator cannot see correct mapping', async () => {
      await setAuthContext(null); // Anon spectator
      const snapRes = await db.query(
        `SELECT public.competition_host_get_question_results($1) AS result`,
        [sessionId]
      );
      assert.strictEqual(snapRes.rows[0].result.success, false);
      assert.strictEqual(snapRes.rows[0].result.error_code, 'UNAUTHORIZED_ACCESS');
    });

    // 34. guest active answer leak absent
    await t.test('34. guest active answer leak absent', async () => {
      const guestSnap = await db.query(
        `SELECT public.competition_get_active_question_snapshot($1, $2, $3) AS result`,
        [sessionId, guestPartId, guestToken]
      );
      assert.strictEqual(guestSnap.rows[0].result.success, true);
      assert.strictEqual(guestSnap.rows[0].result.question.correct_answer, undefined);
      assert.strictEqual(guestSnap.rows[0].result.question.pairs, undefined);
    });

    // Close question
    await setAuthContext(hostId);
    const closeRes = await db.query(
      `SELECT public.competition_host_close_question($1) AS result`,
      [sessionId]
    );
    assert.strictEqual(closeRes.rows[0].result.success, true);

    // 31. closed Host results include sanitized correct pairs
    await t.test('31. closed Host results include sanitized correct pairs', async () => {
      await setAuthContext(hostId);
      const res = await db.query(
        `SELECT public.competition_host_get_question_results($1) AS result`,
        [sessionId]
      );
      const data = res.rows[0].result;
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.question_type, 'matching');
      assert.ok(Array.isArray(data.matching_pairs), 'matching_pairs must be an array');
      assert.strictEqual(data.matching_pairs.length, 3);
      assert.strictEqual(data.matching_pairs[0].left_id, 'l_1');
      assert.strictEqual(data.matching_pairs[0].left_text, 'Vế trái 1');
      assert.strictEqual(data.matching_pairs[0].right_id, 'r_1');
      assert.strictEqual(data.matching_pairs[0].right_text, 'Vế phải 1');
    });

    // 32. historical closed result includes sanitized correct pairs
    await t.test('32. historical closed result includes sanitized correct pairs', async () => {
      await setAuthContext(hostId);
      const res = await db.query(
        `SELECT public.competition_host_get_question_result_by_order($1, 1) AS result`,
        [sessionId]
      );
      const data = res.rows[0].result;
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.question_type, 'matching');
      assert.ok(Array.isArray(data.matching_pairs));
      assert.strictEqual(data.matching_pairs.length, 3);
      assert.strictEqual(data.matching_pairs[0].left_id, 'l_1');
      assert.strictEqual(data.matching_pairs[0].right_id, 'r_1');
      assert.ok(Array.isArray(data.distribution));
      assert.strictEqual(data.distribution.length, 3);
    });

    // 35. Guest review restriction preserved
    await t.test('35. Guest review restriction preserved', async () => {
      await setAuthContext(hostId);
      await db.query(`SELECT public.competition_host_finish_session($1)`, [sessionId]);

      // Guest attempts review
      await setAuthContext(null);
      const reviewRes = await db.query(
        `SELECT public.competition_student_get_review($1, $2) AS result`,
        [sessionId, guestPartId]
      );
      assert.strictEqual(reviewRes.rows[0].result.success, false);
      assert.strictEqual(reviewRes.rows[0].result.error_code, 'UNAUTHORIZED');
    });
  });

  // =========================================================================
  // GROUP 4: REGRESSION MATRIX (TESTS 36 - 43)
  // =========================================================================
  await t.test('Group 4: Regression & Invariants Suite (Tests 36-43)', async (t) => {
    await setAuthContext(hostId);

    // 36. existing single_choice regression
    await t.test('36. existing single_choice regression', async () => {
      const q = {
        question_order: 1,
        question_text: 'Thủ đô Việt Nam?',
        question_type: 'single_choice',
        points: 10,
        time_limit_seconds: 30,
        options: [
          { id: 'opt_hn', text: 'Hà Nội' },
          { id: 'opt_sg', text: 'Sài Gòn' }
        ],
        correct_answer: { option_id: 'opt_hn' }
      };
      const res = await db.query(
        `SELECT public.competition_host_create_session($1, $2, $3, $4, $5::jsonb) AS result`,
        ['Regression SC', 'Mô tả', 'individual', 100, JSON.stringify([q])]
      );
      assert.strictEqual(res.rows[0].result.success, true);
    });

    // 37. existing true_false regression
    await t.test('37. existing true_false regression', async () => {
      const q = {
        question_order: 1,
        question_text: 'Mặt trời mọc đằng đông?',
        question_type: 'true_false',
        points: 10,
        time_limit_seconds: 30,
        options: [
          { id: 'true', text: 'Đúng' },
          { id: 'false', text: 'Sai' }
        ],
        correct_answer: { option_id: 'true' }
      };
      const res = await db.query(
        `SELECT public.competition_host_create_session($1, $2, $3, $4, $5::jsonb) AS result`,
        ['Regression TF', 'Mô tả', 'individual', 100, JSON.stringify([q])]
      );
      assert.strictEqual(res.rows[0].result.success, true);
    });

    // 38. existing multiple_choice regression
    await t.test('38. existing multiple_choice regression', async () => {
      const q = {
        question_order: 1,
        question_text: 'Thành phố lớn VN?',
        question_type: 'multiple_choice',
        points: 15,
        time_limit_seconds: 30,
        options: [
          { id: 'hn', text: 'Hà Nội' },
          { id: 'dn', text: 'Đà Nẵng' },
          { id: 'vt', text: 'Vũng Tàu' }
        ],
        correct_answer: { option_ids: ['hn', 'dn'] }
      };
      const res = await db.query(
        `SELECT public.competition_host_create_session($1, $2, $3, $4, $5::jsonb) AS result`,
        ['Regression MC', 'Mô tả', 'individual', 100, JSON.stringify([q])]
      );
      assert.strictEqual(res.rows[0].result.success, true);
    });

    // 39. existing short_answer regression
    await t.test('39. existing short_answer regression', async () => {
      const q = {
        question_order: 1,
        question_text: '1 + 1 = ?',
        question_type: 'short_answer',
        points: 10,
        time_limit_seconds: 30,
        options: [],
        correct_answer: { accepted_answers: ['2', 'hai'] }
      };
      const res = await db.query(
        `SELECT public.competition_host_create_session($1, $2, $3, $4, $5::jsonb) AS result`,
        ['Regression SA', 'Mô tả', 'individual', 100, JSON.stringify([q])]
      );
      assert.strictEqual(res.rows[0].result.success, true);
    });

    // 40. R15B fill_blank canonical regression
    await t.test('40. R15B fill_blank canonical regression', async () => {
      const checkConstraintRes = await db.query(`
        SELECT pg_get_constraintdef(oid) AS def
        FROM pg_constraint
        WHERE conname = 'check_competition_question_type';
      `);
      const def = checkConstraintRes.rows[0].def;
      assert.ok(def.includes("'short_answer'"));
      assert.ok(def.includes("'matching'"));
      assert.ok(!def.includes("'fill_blank'"), 'fill_blank must NOT be added to DB constraint');
    });

    // 41. leaderboard tie-break unchanged
    await t.test('41. leaderboard tie-break unchanged', async () => {
      const q = {
        question_order: 1,
        question_text: 'Ai nhanh hơn?',
        question_type: 'single_choice',
        points: 10,
        time_limit_seconds: 30,
        options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }],
        correct_answer: { option_id: 'a' }
      };
      const cRes = await db.query(
        `SELECT public.competition_host_create_session($1, $2, $3, $4, $5::jsonb) AS result`,
        ['Tie break test', 'Mô tả', 'individual', 100, JSON.stringify([q])]
      );
      const sId = cRes.rows[0].result.session_id;
      const sCode = cRes.rows[0].result.room_code;

      await setAuthContext(student1Id);
      await db.query(`SELECT public.competition_join_session($1, 'Học Sinh 1')`, [sCode]);
      await setAuthContext(student2Id);
      await db.query(`SELECT public.competition_join_session($1, 'Học Sinh 2')`, [sCode]);

      // Seed manual scores to test tie-break ordering
      await db.exec(`
        UPDATE public.competition_scores
        SET total_score = 50, total_response_time_ms = 2000
        WHERE session_id = '${sId}' AND participant_id = (SELECT id FROM public.competition_participants WHERE session_id = '${sId}' AND user_id = '${student1Id}');

        UPDATE public.competition_scores
        SET total_score = 50, total_response_time_ms = 1000
        WHERE session_id = '${sId}' AND participant_id = (SELECT id FROM public.competition_participants WHERE session_id = '${sId}' AND user_id = '${student2Id}');
      `);

      const lbRes = await db.query(`SELECT public.competition_get_leaderboard_snapshot($1) AS result`, [sId]);
      const lb = lbRes.rows[0].result.leaderboard;
      assert.strictEqual(lb[0].display_name, 'Học Sinh 2', 'Lower response time must rank first on tie');
      assert.strictEqual(lb[1].display_name, 'Học Sinh 1');
    });

    // 42. RANK() gap behavior unchanged
    await t.test('42. RANK() gap behavior unchanged', async () => {
      const lbQuery = await db.query(`
        SELECT RANK() OVER (ORDER BY total_score DESC, total_response_time_ms ASC) AS rank
        FROM (VALUES (10, 100), (10, 100), (5, 50)) AS t(total_score, total_response_time_ms);
      `);
      const ranks = lbQuery.rows.map(r => Number(r.rank));
      assert.deepStrictEqual(ranks, [1, 1, 3], 'Standard SQL RANK() gap behavior preserved');
    });

    // 43. MAX_COMPETITION_QUESTIONS = 20 unchanged
    await t.test('43. MAX_COMPETITION_QUESTIONS = 20 unchanged', async () => {
      assert.strictEqual(MAX_COMPETITION_QUESTIONS, 20);
    });
  });
});
