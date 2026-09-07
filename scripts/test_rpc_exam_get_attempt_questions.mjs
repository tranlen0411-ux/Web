// scripts/test_rpc_exam_get_attempt_questions.mjs
// Comprehensive Unit & Security Test Suite for rpc_exam_get_attempt_questions (Phase 3E-B0)
// Uses @electric-sql/pglite to test real PostgreSQL PL/pgSQL execution

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Kích hoạt cờ --liftoff-only kết hợp các cờ V8 tối ưu bộ nhớ để ngăn V8 TurboFan Zone OOM trên Windows
if (!process.execArgv.includes('--liftoff-only')) {
  const result = spawnSync(
    process.execPath,
    [
      '--liftoff-only',
      '--v8-pool-size=1',
      '--no-wasm-async-compilation',
      ...process.execArgv,
      __filename,
      ...process.argv.slice(2)
    ],
    { stdio: 'inherit' }
  );
  process.exit(result.status ?? 0);
}

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

async function test(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✓ PASS [${String(totalTests).padStart(2, '0')}]: ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`  ❌ FAIL [${String(totalTests).padStart(2, '0')}]: ${name}`);
    console.error(err);
  }
}

async function setupDatabase() {
  const db = new PGlite();

  // 1. Core roles & schema
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS app_private;
    CREATE SCHEMA IF NOT EXISTS auth;

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END
    $$;
  `);

  // 2. Load phase 1 schema migration
  const schemaMigrationPath = path.resolve(__dirname, '../supabase/migrations/20260905000001_exam_builder_v1_phase1_schema.sql');
  const schemaSql = await fs.readFile(schemaMigrationPath, 'utf8');
  await db.exec(schemaSql);

  // 3. Load Phase 3E-B0 RPC migration
  const rpcMigrationPath = path.resolve(__dirname, '../supabase/migrations/20260907000009_exam_builder_v1_get_attempt_questions.sql');
  const rpcSql = await fs.readFile(rpcMigrationPath, 'utf8');
  await db.exec(rpcSql);

  return db;
}

async function runRpc(db, callerId, attemptId) {
  const res = await db.query(
    `SELECT public.rpc_exam_get_attempt_questions($1::uuid, $2::uuid) AS result;`,
    [callerId, attemptId]
  );
  return res.rows[0]?.result;
}

async function main() {
  console.log('================================================================');
  console.log('🧪 RUNNING RPC EXAM GET ATTEMPT QUESTIONS TEST SUITE (PHASE 3E-B0)');
  console.log('================================================================\n');

  const db = await setupDatabase();

  const TEACHER_ID = '11111111-1111-4111-8111-111111111111';
  const STUDENT_1_ID = '22222222-2222-4222-8222-222222222222';
  const STUDENT_2_ID = '33333333-3333-4333-8333-333333333333';
  const CLASS_ID = '44444444-4444-4444-8444-444444444444';

  const EXAM_ID = '55555555-5555-4555-8555-555555555555';
  const VERSION_ID = '66666666-6666-4666-8666-666666666666';
  const ASSIGNMENT_ID = '77777777-7777-4777-8777-777777777777';

  // Seed Exam, Version, Assignment
  await db.exec(`
    INSERT INTO public.exam_tests (id, author_id, title, subject, grade_level, status)
    VALUES ('${EXAM_ID}', '${TEACHER_ID}', 'Toán Học Kỳ 1', 'Toán', 5, 'active');

    INSERT INTO public.exam_versions (id, exam_id, version_number, title, subject, grade_level, total_points, status, published_at)
    VALUES ('${VERSION_ID}', '${EXAM_ID}', 1, 'Đề chính thức V1', 'Toán', 5, 10.00, 'published', NOW());

    UPDATE public.exam_tests SET current_version_id = '${VERSION_ID}' WHERE id = '${EXAM_ID}';

    INSERT INTO public.exam_assignments (id, exam_version_id, class_id, assigned_by)
    VALUES ('${ASSIGNMENT_ID}', '${VERSION_ID}', '${CLASS_ID}', '${TEACHER_ID}');
  `);

  // Question IDs for 7 types
  const Q_SINGLE = 'a0000001-0000-4000-8000-000000000001';
  const Q_MULTI = 'a0000002-0000-4000-8000-000000000002';
  const Q_BLANK = 'a0000003-0000-4000-8000-000000000003';
  const Q_SHORT = 'a0000004-0000-4000-8000-000000000004';
  const Q_ESSAY = 'a0000005-0000-4000-8000-000000000005';
  const Q_IMG = 'a0000006-0000-4000-8000-000000000006';
  const Q_FILE = 'a0000007-0000-4000-8000-000000000007';

  const ALL_Q_IDS = [Q_SINGLE, Q_MULTI, Q_BLANK, Q_SHORT, Q_ESSAY, Q_IMG, Q_FILE];

  // Insert 7 questions into version
  await db.exec(`
    INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points, options_json)
    VALUES
      ('${Q_SINGLE}', '${VERSION_ID}', 1, 'single_choice', '1 + 1 = ?', 2.00, '[{"key":"A","text":"1"},{"key":"B","text":"2"},{"key":"C","text":"3"}]'::jsonb),
      ('${Q_MULTI}', '${VERSION_ID}', 2, 'multiple_choice', 'Số chẵn là:', 2.00, '[{"key":"opt1","text":"2"},{"key":"opt2","text":"4"},{"key":"opt3","text":"5"}]'::jsonb),
      ('${Q_BLANK}', '${VERSION_ID}', 3, 'fill_blank', 'Thủ đô của Việt Nam là ___', 1.50, '[]'::jsonb),
      ('${Q_SHORT}', '${VERSION_ID}', 4, 'short_answer', 'Kể tên 1 hành tinh', 1.50, '[]'::jsonb),
      ('${Q_ESSAY}', '${VERSION_ID}', 5, 'essay', 'Cảm nghĩ về bài thơ...', 1.00, '[]'::jsonb),
      ('${Q_IMG}', '${VERSION_ID}', 6, 'image_upload', 'Vẽ sơ đồ tư duy', 1.00, '[]'::jsonb),
      ('${Q_FILE}', '${VERSION_ID}', 7, 'file_upload', 'Nộp bài tập file pdf', 1.00, '[]'::jsonb);

    -- Also insert private answer keys for auto-graded to verify RPC NEVER leaks them
    INSERT INTO app_private.exam_answer_keys (question_id, correct_answer)
    VALUES
      ('${Q_SINGLE}', '["B"]'::jsonb),
      ('${Q_MULTI}', '["opt1", "opt2"]'::jsonb),
      ('${Q_BLANK}', '["Hà Nội"]'::jsonb),
      ('${Q_SHORT}', '["Trái Đất"]'::jsonb);
  `);

  // Default valid option orders (randomized/permuted)
  const VALID_OPTION_ORDERS = {
    [Q_SINGLE]: ['C', 'A', 'B'],
    [Q_MULTI]: ['opt3', 'opt2', 'opt1']
  };

  // Helper to create an attempt
  let attemptCounter = 0;
  async function createAttempt(overrides = {}) {
    attemptCounter++;
    await db.exec(`DELETE FROM public.exam_attempts;`);
    const id = overrides.id || `b0000000-0000-4000-8000-${String(attemptCounter).padStart(12, '0')}`;
    const studentId = overrides.student_id || STUDENT_1_ID;
    const assignmentId = overrides.assignment_id || ASSIGNMENT_ID;
    const status = overrides.status || 'draft';
    const attemptNumber = overrides.attempt_number || attemptCounter;
    const expiresAt = overrides.expires_at !== undefined ? overrides.expires_at : "NOW() + INTERVAL '1 hour'";
    const questionOrder = overrides.question_order !== undefined ? JSON.stringify(overrides.question_order) : JSON.stringify(ALL_Q_IDS);
    const optionOrders = overrides.option_orders !== undefined ? JSON.stringify(overrides.option_orders) : JSON.stringify(VALID_OPTION_ORDERS);
    const attemptVersionId = overrides.exam_version_id || VERSION_ID;

    const expiresAtSql = expiresAt === null ? 'NULL' : (typeof expiresAt === 'string' && expiresAt.startsWith('NOW()') ? expiresAt : `'${expiresAt}'`);

    await db.exec(`
      INSERT INTO public.exam_attempts (
        id, assignment_id, exam_version_id, student_id, attempt_number, status, max_score,
        question_order, option_orders, expires_at
      ) VALUES (
        '${id}', '${assignmentId}', '${attemptVersionId}', '${studentId}', ${attemptNumber}, '${status}', 10.00,
        '${questionOrder}'::jsonb, '${optionOrders}'::jsonb, ${expiresAtSql}
      );
    `);
    return id;
  }

  // --- 1. Own draft attempt returns questions ---
  await test('1. own draft attempt returns valid question payload', async () => {
    const attemptId = await createAttempt();
    const res = await runRpc(db, STUDENT_1_ID, attemptId);

    assert.equal(res.attempt_id, attemptId);
    assert.equal(res.exam_version_id, VERSION_ID);
    assert.equal(res.status, 'draft');
    assert.equal(res.questions.length, 7);
  });

  // --- 2. Nonexistent attempt denied ---
  await test('2. nonexistent attempt raises ERR_ATTEMPT_NOT_FOUND', async () => {
    const fakeId = '99999999-9999-4999-8999-999999999999';
    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, fakeId),
      /ERR_ATTEMPT_NOT_FOUND/
    );
  });

  // --- 3. Other student anti-oracle denied ---
  await test('3. other student attempt raises identical ERR_ATTEMPT_NOT_FOUND (anti-oracle)', async () => {
    const attemptId = await createAttempt({ student_id: STUDENT_2_ID });
    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_ATTEMPT_NOT_FOUND/
    );
  });

  // --- 4. Submitted attempt denied ---
  await test('4. submitted attempt raises ERR_ATTEMPT_FINALIZED', async () => {
    const attemptId = await createAttempt({ status: 'submitted' });
    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_ATTEMPT_FINALIZED/
    );
  });

  // --- 5. Pending manual grade denied ---
  await test('5. pending_manual_grade attempt raises ERR_ATTEMPT_FINALIZED', async () => {
    const attemptId = await createAttempt({ status: 'pending_manual_grade' });
    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_ATTEMPT_FINALIZED/
    );
  });

  // --- 6. Graded attempt denied ---
  await test('6. graded attempt raises ERR_ATTEMPT_FINALIZED', async () => {
    const attemptId = await createAttempt({ status: 'graded' });
    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_ATTEMPT_FINALIZED/
    );
  });

  // --- 7. Expired draft denied ---
  await test('7. expired draft attempt raises ERR_ATTEMPT_EXPIRED', async () => {
    const attemptId = await createAttempt({ expires_at: "NOW() - INTERVAL '5 minutes'" });
    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_ATTEMPT_EXPIRED/
    );
  });

  // --- 8. Question order not array ---
  await test('8. question_order not an array raises ERR_ATTEMPT_SNAPSHOT_INVALID', async () => {
    await db.exec(`DELETE FROM public.exam_attempts;`);
    const attemptId = `c0000000-0000-4000-8000-${String(++attemptCounter).padStart(12, '0')}`;
    await db.exec(`
      INSERT INTO public.exam_attempts (id, assignment_id, exam_version_id, student_id, attempt_number, status, max_score, question_order, option_orders)
      VALUES ('${attemptId}', '${ASSIGNMENT_ID}', '${VERSION_ID}', '${STUDENT_1_ID}', ${attemptCounter}, 'draft', 10.00, '{"a": 1}'::jsonb, '{}'::jsonb);
    `);
    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_ATTEMPT_SNAPSHOT_INVALID/
    );
  });

  // --- 9. Empty question order ---
  await test('9. empty question_order array raises ERR_ATTEMPT_SNAPSHOT_INVALID', async () => {
    const attemptId = await createAttempt({ question_order: [] });
    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_ATTEMPT_SNAPSHOT_INVALID/
    );
  });

  // --- 10. Non-string entry in question_order ---
  await test('10. non-string entry in question_order raises ERR_ATTEMPT_SNAPSHOT_INVALID', async () => {
    const corrupted = [Q_SINGLE, 12345, Q_BLANK, Q_SHORT, Q_ESSAY, Q_IMG, Q_FILE];
    const attemptId = await createAttempt({ question_order: corrupted });
    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_ATTEMPT_SNAPSHOT_INVALID/
    );
  });

  // --- 11. Invalid UUID format in question_order ---
  await test('11. invalid UUID string in question_order raises ERR_ATTEMPT_SNAPSHOT_INVALID', async () => {
    const corrupted = [Q_SINGLE, 'not-a-valid-uuid', Q_BLANK, Q_SHORT, Q_ESSAY, Q_IMG, Q_FILE];
    const attemptId = await createAttempt({ question_order: corrupted });
    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_ATTEMPT_SNAPSHOT_INVALID/
    );
  });

  // --- 12. Duplicate UUID in question_order ---
  await test('12. duplicate UUID in question_order raises ERR_ATTEMPT_SNAPSHOT_INVALID', async () => {
    const duplicated = [Q_SINGLE, Q_SINGLE, Q_BLANK, Q_SHORT, Q_ESSAY, Q_IMG, Q_FILE];
    const attemptId = await createAttempt({ question_order: duplicated });
    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_ATTEMPT_SNAPSHOT_INVALID/
    );
  });

  // --- 13. Omitted valid version question ---
  await test('13. omitted version question (subset order) raises ERR_ATTEMPT_SNAPSHOT_INVALID', async () => {
    const subset = [Q_SINGLE, Q_MULTI, Q_BLANK, Q_SHORT, Q_ESSAY, Q_IMG]; // Missing Q_FILE
    const attemptId = await createAttempt({ question_order: subset });
    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_ATTEMPT_SNAPSHOT_INVALID/
    );
  });

  // --- 14. Extra/foreign question in snapshot ---
  await test('14. extra / foreign question ID raises ERR_ATTEMPT_SNAPSHOT_INVALID', async () => {
    const foreignQ = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const corrupted = [Q_SINGLE, Q_MULTI, Q_BLANK, Q_SHORT, Q_ESSAY, Q_IMG, foreignQ];
    const attemptId = await createAttempt({ question_order: corrupted });
    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_ATTEMPT_SNAPSHOT_INVALID/
    );
  });

  // --- 15. Exact full permutation returned in snapshot order ---
  await test('15. exact full permutation returned in snapshot order (not question_number order)', async () => {
    const customOrder = [Q_FILE, Q_ESSAY, Q_IMG, Q_SHORT, Q_BLANK, Q_MULTI, Q_SINGLE];
    const attemptId = await createAttempt({ question_order: customOrder });
    const res = await runRpc(db, STUDENT_1_ID, attemptId);

    assert.equal(res.questions.length, 7);
    for (let i = 0; i < 7; i++) {
      assert.equal(res.questions[i].id, customOrder[i]);
    }
  });

  // --- 16. Source options not array ---
  await test('16. source options_json not array in choice question raises ERR_INVALID_OPTION_SCHEMA', async () => {
    const BAD_Q = 'd0000001-0000-4000-8000-000000000001';
    const BAD_VER = 'd0000002-0000-4000-8000-000000000002';
    const BAD_ASSIGN = 'd0000003-0000-4000-8000-000000000003';

    await db.exec(`
      INSERT INTO public.exam_versions (id, exam_id, version_number, title, subject, grade_level, total_points, status, published_at)
      VALUES ('${BAD_VER}', '${EXAM_ID}', 2, 'Bad Version', 'Toán', 5, 2.00, 'published', NOW());
      INSERT INTO public.exam_assignments (id, exam_version_id, class_id, assigned_by)
      VALUES ('${BAD_ASSIGN}', '${BAD_VER}', '${CLASS_ID}', '${TEACHER_ID}');
      INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points, options_json)
      VALUES ('${BAD_Q}', '${BAD_VER}', 1, 'single_choice', 'Q?', 2.00, '{"not": "array"}'::jsonb);
    `);

    const attemptId = await createAttempt({
      assignment_id: BAD_ASSIGN,
      exam_version_id: BAD_VER,
      question_order: [BAD_Q],
      option_orders: { [BAD_Q]: ['A'] }
    });

    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_INVALID_OPTION_SCHEMA/
    );
  });

  // --- 17. Empty choice options in source ---
  await test('17. empty options_json in choice question raises ERR_INVALID_OPTION_SCHEMA', async () => {
    const BAD_Q = 'd0000004-0000-4000-8000-000000000004';
    const BAD_VER = 'd0000005-0000-4000-8000-000000000005';
    const BAD_ASSIGN = 'd0000006-0000-4000-8000-000000000006';

    await db.exec(`
      INSERT INTO public.exam_versions (id, exam_id, version_number, title, subject, grade_level, total_points, status, published_at)
      VALUES ('${BAD_VER}', '${EXAM_ID}', 3, 'Bad Version 3', 'Toán', 5, 2.00, 'published', NOW());
      INSERT INTO public.exam_assignments (id, exam_version_id, class_id, assigned_by)
      VALUES ('${BAD_ASSIGN}', '${BAD_VER}', '${CLASS_ID}', '${TEACHER_ID}');
      INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points, options_json)
      VALUES ('${BAD_Q}', '${BAD_VER}', 1, 'single_choice', 'Q?', 2.00, '[]'::jsonb);
    `);

    const attemptId = await createAttempt({
      assignment_id: BAD_ASSIGN,
      exam_version_id: BAD_VER,
      question_order: [BAD_Q],
      option_orders: { [BAD_Q]: [] }
    });

    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_INVALID_OPTION_SCHEMA/
    );
  });

  // --- 18. Option element not object in source ---
  await test('18. non-object option element in source raises ERR_INVALID_OPTION_SCHEMA', async () => {
    const BAD_Q = 'd0000007-0000-4000-8000-000000000007';
    const BAD_VER = 'd0000008-0000-4000-8000-000000000008';
    const BAD_ASSIGN = 'd0000009-0000-4000-8000-000000000009';

    await db.exec(`
      INSERT INTO public.exam_versions (id, exam_id, version_number, title, subject, grade_level, total_points, status, published_at)
      VALUES ('${BAD_VER}', '${EXAM_ID}', 4, 'Bad Version 4', 'Toán', 5, 2.00, 'published', NOW());
      INSERT INTO public.exam_assignments (id, exam_version_id, class_id, assigned_by)
      VALUES ('${BAD_ASSIGN}', '${BAD_VER}', '${CLASS_ID}', '${TEACHER_ID}');
      INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points, options_json)
      VALUES ('${BAD_Q}', '${BAD_VER}', 1, 'single_choice', 'Q?', 2.00, '["string_item"]'::jsonb);
    `);

    const attemptId = await createAttempt({
      assignment_id: BAD_ASSIGN,
      exam_version_id: BAD_VER,
      question_order: [BAD_Q],
      option_orders: { [BAD_Q]: ['string_item'] }
    });

    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_INVALID_OPTION_SCHEMA/
    );
  });

  // --- 19. Missing key in source option ---
  await test('19. missing key property in source option raises ERR_INVALID_OPTION_SCHEMA', async () => {
    const BAD_Q = 'd0000010-0000-4000-8000-000000000010';
    const BAD_VER = 'd0000011-0000-4000-8000-000000000011';
    const BAD_ASSIGN = 'd0000012-0000-4000-8000-000000000012';

    await db.exec(`
      INSERT INTO public.exam_versions (id, exam_id, version_number, title, subject, grade_level, total_points, status, published_at)
      VALUES ('${BAD_VER}', '${EXAM_ID}', 5, 'Bad Version 5', 'Toán', 5, 2.00, 'published', NOW());
      INSERT INTO public.exam_assignments (id, exam_version_id, class_id, assigned_by)
      VALUES ('${BAD_ASSIGN}', '${BAD_VER}', '${CLASS_ID}', '${TEACHER_ID}');
      INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points, options_json)
      VALUES ('${BAD_Q}', '${BAD_VER}', 1, 'single_choice', 'Q?', 2.00, '[{"text": "only text"}]'::jsonb);
    `);

    const attemptId = await createAttempt({
      assignment_id: BAD_ASSIGN,
      exam_version_id: BAD_VER,
      question_order: [BAD_Q],
      option_orders: { [BAD_Q]: ['A'] }
    });

    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_INVALID_OPTION_SCHEMA/
    );
  });

  // --- 20. Non-string key in source option ---
  await test('20. non-string key in source option raises ERR_INVALID_OPTION_SCHEMA', async () => {
    const BAD_Q = 'd0000013-0000-4000-8000-000000000013';
    const BAD_VER = 'd0000014-0000-4000-8000-000000000014';
    const BAD_ASSIGN = 'd0000015-0000-4000-8000-000000000015';

    await db.exec(`
      INSERT INTO public.exam_versions (id, exam_id, version_number, title, subject, grade_level, total_points, status, published_at)
      VALUES ('${BAD_VER}', '${EXAM_ID}', 6, 'Bad Version 6', 'Toán', 5, 2.00, 'published', NOW());
      INSERT INTO public.exam_assignments (id, exam_version_id, class_id, assigned_by)
      VALUES ('${BAD_ASSIGN}', '${BAD_VER}', '${CLASS_ID}', '${TEACHER_ID}');
      INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points, options_json)
      VALUES ('${BAD_Q}', '${BAD_VER}', 1, 'single_choice', 'Q?', 2.00, '[{"key": 123, "text": "Num key"}]'::jsonb);
    `);

    const attemptId = await createAttempt({
      assignment_id: BAD_ASSIGN,
      exam_version_id: BAD_VER,
      question_order: [BAD_Q],
      option_orders: { [BAD_Q]: ['123'] }
    });

    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_INVALID_OPTION_SCHEMA/
    );
  });

  // --- 21. Empty string key in source option ---
  await test('21. empty string key in source option raises ERR_INVALID_OPTION_SCHEMA', async () => {
    const BAD_Q = 'd0000016-0000-4000-8000-000000000016';
    const BAD_VER = 'd0000017-0000-4000-8000-000000000017';
    const BAD_ASSIGN = 'd0000018-0000-4000-8000-000000000018';

    await db.exec(`
      INSERT INTO public.exam_versions (id, exam_id, version_number, title, subject, grade_level, total_points, status, published_at)
      VALUES ('${BAD_VER}', '${EXAM_ID}', 7, 'Bad Version 7', 'Toán', 5, 2.00, 'published', NOW());
      INSERT INTO public.exam_assignments (id, exam_version_id, class_id, assigned_by)
      VALUES ('${BAD_ASSIGN}', '${BAD_VER}', '${CLASS_ID}', '${TEACHER_ID}');
      INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points, options_json)
      VALUES ('${BAD_Q}', '${BAD_VER}', 1, 'single_choice', 'Q?', 2.00, '[{"key": "  ", "text": "Blank key"}]'::jsonb);
    `);

    const attemptId = await createAttempt({
      assignment_id: BAD_ASSIGN,
      exam_version_id: BAD_VER,
      question_order: [BAD_Q],
      option_orders: { [BAD_Q]: ['  '] }
    });

    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_INVALID_OPTION_SCHEMA/
    );
  });

  // --- 22. Duplicate key in source options ---
  await test('22. duplicate key in source options raises ERR_INVALID_OPTION_SCHEMA', async () => {
    const BAD_Q = 'd0000019-0000-4000-8000-000000000019';
    const BAD_VER = 'd0000020-0000-4000-8000-000000000020';
    const BAD_ASSIGN = 'd0000021-0000-4000-8000-000000000021';

    await db.exec(`
      INSERT INTO public.exam_versions (id, exam_id, version_number, title, subject, grade_level, total_points, status, published_at)
      VALUES ('${BAD_VER}', '${EXAM_ID}', 8, 'Bad Version 8', 'Toán', 5, 2.00, 'published', NOW());
      INSERT INTO public.exam_assignments (id, exam_version_id, class_id, assigned_by)
      VALUES ('${BAD_ASSIGN}', '${BAD_VER}', '${CLASS_ID}', '${TEACHER_ID}');
      INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points, options_json)
      VALUES ('${BAD_Q}', '${BAD_VER}', 1, 'single_choice', 'Q?', 2.00, '[{"key": "A", "text": "1"}, {"key": "A", "text": "2"}]'::jsonb);
    `);

    const attemptId = await createAttempt({
      assignment_id: BAD_ASSIGN,
      exam_version_id: BAD_VER,
      question_order: [BAD_Q],
      option_orders: { [BAD_Q]: ['A'] }
    });

    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_INVALID_OPTION_SCHEMA/
    );
  });

  // --- 23. Missing text in source option ---
  await test('23. missing text in source option raises ERR_INVALID_OPTION_SCHEMA', async () => {
    const BAD_Q = 'd0000022-0000-4000-8000-000000000022';
    const BAD_VER = 'd0000023-0000-4000-8000-000000000023';
    const BAD_ASSIGN = 'd0000024-0000-4000-8000-000000000024';

    await db.exec(`
      INSERT INTO public.exam_versions (id, exam_id, version_number, title, subject, grade_level, total_points, status, published_at)
      VALUES ('${BAD_VER}', '${EXAM_ID}', 9, 'Bad Version 9', 'Toán', 5, 2.00, 'published', NOW());
      INSERT INTO public.exam_assignments (id, exam_version_id, class_id, assigned_by)
      VALUES ('${BAD_ASSIGN}', '${BAD_VER}', '${CLASS_ID}', '${TEACHER_ID}');
      INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points, options_json)
      VALUES ('${BAD_Q}', '${BAD_VER}', 1, 'single_choice', 'Q?', 2.00, '[{"key": "A"}]'::jsonb);
    `);

    const attemptId = await createAttempt({
      assignment_id: BAD_ASSIGN,
      exam_version_id: BAD_VER,
      question_order: [BAD_Q],
      option_orders: { [BAD_Q]: ['A'] }
    });

    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_INVALID_OPTION_SCHEMA/
    );
  });

  // --- 24. Non-string text in source option ---
  await test('24. non-string text in source option raises ERR_INVALID_OPTION_SCHEMA', async () => {
    const BAD_Q = 'd0000025-0000-4000-8000-000000000025';
    const BAD_VER = 'd0000026-0000-4000-8000-000000000026';
    const BAD_ASSIGN = 'd0000027-0000-4000-8000-000000000027';

    await db.exec(`
      INSERT INTO public.exam_versions (id, exam_id, version_number, title, subject, grade_level, total_points, status, published_at)
      VALUES ('${BAD_VER}', '${EXAM_ID}', 10, 'Bad Version 10', 'Toán', 5, 2.00, 'published', NOW());
      INSERT INTO public.exam_assignments (id, exam_version_id, class_id, assigned_by)
      VALUES ('${BAD_ASSIGN}', '${BAD_VER}', '${CLASS_ID}', '${TEACHER_ID}');
      INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points, options_json)
      VALUES ('${BAD_Q}', '${BAD_VER}', 1, 'single_choice', 'Q?', 2.00, '[{"key": "A", "text": 999}]'::jsonb);
    `);

    const attemptId = await createAttempt({
      assignment_id: BAD_ASSIGN,
      exam_version_id: BAD_VER,
      question_order: [BAD_Q],
      option_orders: { [BAD_Q]: ['A'] }
    });

    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_INVALID_OPTION_SCHEMA/
    );
  });

  // --- 25. Missing option_orders entry for choice question ---
  await test('25. missing entry in option_orders for choice question raises ERR_OPTION_SNAPSHOT_INVALID', async () => {
    const attemptId = await createAttempt({
      option_orders: {
        [Q_SINGLE]: ['A', 'B', 'C']
        // Missing Q_MULTI
      }
    });

    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_OPTION_SNAPSHOT_INVALID/
    );
  });

  // --- 26. option_order entry is not an array ---
  await test('26. option_order entry is not array raises ERR_OPTION_SNAPSHOT_INVALID', async () => {
    const attemptId = await createAttempt({
      option_orders: {
        ...VALID_OPTION_ORDERS,
        [Q_SINGLE]: 'not-an-array'
      }
    });

    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_OPTION_SNAPSHOT_INVALID/
    );
  });

  // --- 27. Duplicate key in option_order ---
  await test('27. duplicate key in option_order raises ERR_OPTION_SNAPSHOT_INVALID', async () => {
    const attemptId = await createAttempt({
      option_orders: {
        ...VALID_OPTION_ORDERS,
        [Q_SINGLE]: ['A', 'A', 'B']
      }
    });

    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_OPTION_SNAPSHOT_INVALID/
    );
  });

  // --- 28. Missing key in option_order ---
  await test('28. missing key in option_order (subset) raises ERR_OPTION_SNAPSHOT_INVALID', async () => {
    const attemptId = await createAttempt({
      option_orders: {
        ...VALID_OPTION_ORDERS,
        [Q_SINGLE]: ['A', 'B'] // Missing 'C'
      }
    });

    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_OPTION_SNAPSHOT_INVALID/
    );
  });

  // --- 29. Extra / non-existent key in option_order ---
  await test('29. extra foreign key in option_order raises ERR_OPTION_SNAPSHOT_INVALID', async () => {
    const attemptId = await createAttempt({
      option_orders: {
        ...VALID_OPTION_ORDERS,
        [Q_SINGLE]: ['A', 'B', 'Z'] // 'Z' does not exist in source options
      }
    });

    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_OPTION_SNAPSHOT_INVALID/
    );
  });

  // --- 30. Exact option permutation reflected in return payload ---
  await test('30. exact option permutation reflected in returned choices', async () => {
    const customOptionOrders = {
      [Q_SINGLE]: ['B', 'C', 'A'],
      [Q_MULTI]: ['opt2', 'opt1', 'opt3']
    };

    const attemptId = await createAttempt({
      option_orders: customOptionOrders
    });

    const res = await runRpc(db, STUDENT_1_ID, attemptId);
    const singleQ = res.questions.find(q => q.id === Q_SINGLE);
    assert.deepEqual(singleQ.options.map(o => o.key), ['B', 'C', 'A']);
    assert.deepEqual(singleQ.options.map(o => o.text), ['2', '3', '1']);

    const multiQ = res.questions.find(q => q.id === Q_MULTI);
    assert.deepEqual(multiQ.options.map(o => o.key), ['opt2', 'opt1', 'opt3']);
    assert.deepEqual(multiQ.options.map(o => o.text), ['4', '2', '5']);
  });

  // --- 31. All 7 question types returned ---
  await test('31. all 7 approved question types returned correctly', async () => {
    const attemptId = await createAttempt();
    const res = await runRpc(db, STUDENT_1_ID, attemptId);

    const types = res.questions.map(q => q.question_type);
    assert.deepEqual(types, [
      'single_choice',
      'multiple_choice',
      'fill_blank',
      'short_answer',
      'essay',
      'image_upload',
      'file_upload'
    ]);
  });

  // --- 32. Non-choice question types have options: [] ---
  await test('32. non-choice question types return options = []', async () => {
    const attemptId = await createAttempt();
    const res = await runRpc(db, STUDENT_1_ID, attemptId);

    const nonChoiceQuestions = res.questions.filter(
      q => !['single_choice', 'multiple_choice'].includes(q.question_type)
    );

    assert.equal(nonChoiceQuestions.length, 5);
    for (const q of nonChoiceQuestions) {
      assert.deepEqual(q.options, []);
    }
  });

  // --- 33. Exact 4 fields in root result ---
  await test('33. root return JSON contains EXACTLY 4 approved fields', async () => {
    const attemptId = await createAttempt();
    const res = await runRpc(db, STUDENT_1_ID, attemptId);

    const rootKeys = Object.keys(res).sort();
    assert.deepEqual(rootKeys, ['attempt_id', 'exam_version_id', 'questions', 'status'].sort());
  });

  // --- 34. Exact 5 fields in each question and 2 fields in each option ---
  await test('34. question objects contain EXACTLY 5 fields, option objects contain EXACTLY 2 fields', async () => {
    const attemptId = await createAttempt();
    const res = await runRpc(db, STUDENT_1_ID, attemptId);

    for (const q of res.questions) {
      const qKeys = Object.keys(q).sort();
      assert.deepEqual(qKeys, ['id', 'options', 'points', 'prompt', 'question_type'].sort());

      for (const opt of q.options) {
        const optKeys = Object.keys(opt).sort();
        assert.deepEqual(optKeys, ['key', 'text'].sort());
      }
    }
  });

  // --- 35. Zero answer-key or private fields in RPC return ---
  await test('35. zero answer-key, grading config, or internal metadata in returned payload', async () => {
    const attemptId = await createAttempt();
    const res = await runRpc(db, STUDENT_1_ID, attemptId);

    const rawJson = JSON.stringify(res);
    assert.equal(rawJson.includes('correct_answer'), false);
    assert.equal(rawJson.includes('accepted_answers'), false);
    assert.equal(rawJson.includes('case_sensitive'), false);
    assert.equal(rawJson.includes('grading_config'), false);
    assert.equal(rawJson.includes('question_number'), false);
    assert.equal(rawJson.includes('source_question_bank'), false);
    assert.equal(rawJson.includes('is_correct'), false);
  });

  // --- 36. SECURITY DEFINER, Explicit OWNER & Strict ACL static contract ---
  await test('36. function is SECURITY DEFINER with search_path=public, app_private, OWNER postgres and granted ONLY to service_role', async () => {
    const rpcMigrationPath = path.resolve(__dirname, '../supabase/migrations/20260907000009_exam_builder_v1_get_attempt_questions.sql');
    const sql = await fs.readFile(rpcMigrationPath, 'utf8');

    assert.match(sql, /SECURITY DEFINER/i);
    assert.match(sql, /SET search_path = public, app_private/i);
    assert.match(sql, /ALTER FUNCTION public\.rpc_exam_get_attempt_questions\(UUID, UUID\) OWNER TO postgres;/i);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.rpc_exam_get_attempt_questions\(UUID, UUID\) FROM PUBLIC, anon, authenticated;/i);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.rpc_exam_get_attempt_questions\(UUID, UUID\) TO service_role;/i);
  });

  // --- 37. RPC returns question_type, never type ---
  await test('37. RPC returns question_type and NEVER legacy type field', async () => {
    const attemptId = await createAttempt();
    const res = await runRpc(db, STUDENT_1_ID, attemptId);

    for (const q of res.questions) {
      assert.equal(typeof q.question_type, 'string');
      assert.equal(APPROVED_QUESTION_TYPES_SET.has(q.question_type), true);
      assert.equal('type' in q, false);
    }
  });

  // --- 38. Expiry contract uses clock_timestamp() ---
  await test('38. expiry contract source uses clock_timestamp', async () => {
    const rpcMigrationPath = path.resolve(__dirname, '../supabase/migrations/20260907000009_exam_builder_v1_get_attempt_questions.sql');
    const sql = await fs.readFile(rpcMigrationPath, 'utf8');

    assert.match(sql, /clock_timestamp\(\)\s*>=\s*v_attempt\.expires_at/i);
  });

  // --- 39. Boolean source option key rejected ---
  await test('39. boolean source option key rejected with ERR_INVALID_OPTION_SCHEMA', async () => {
    const BAD_Q = 'e0000001-0000-4000-8000-000000000001';
    const BAD_VER = 'e0000002-0000-4000-8000-000000000002';
    const BAD_ASSIGN = 'e0000003-0000-4000-8000-000000000003';

    await db.exec(`
      INSERT INTO public.exam_versions (id, exam_id, version_number, title, subject, grade_level, total_points, status, published_at)
      VALUES ('${BAD_VER}', '${EXAM_ID}', 11, 'Bad Version 11', 'Toán', 5, 2.00, 'published', NOW());
      INSERT INTO public.exam_assignments (id, exam_version_id, class_id, assigned_by)
      VALUES ('${BAD_ASSIGN}', '${BAD_VER}', '${CLASS_ID}', '${TEACHER_ID}');
      INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points, options_json)
      VALUES ('${BAD_Q}', '${BAD_VER}', 1, 'single_choice', 'Q?', 2.00, '[{"key": true, "text": "Bool key"}]'::jsonb);
    `);

    const attemptId = await createAttempt({
      assignment_id: BAD_ASSIGN,
      exam_version_id: BAD_VER,
      question_order: [BAD_Q],
      option_orders: { [BAD_Q]: ['true'] }
    });

    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_INVALID_OPTION_SCHEMA/
    );
  });

  // --- 40. Boolean source option text rejected ---
  await test('40. boolean source option text rejected with ERR_INVALID_OPTION_SCHEMA', async () => {
    const BAD_Q = 'e0000004-0000-4000-8000-000000000004';
    const BAD_VER = 'e0000005-0000-4000-8000-000000000005';
    const BAD_ASSIGN = 'e0000006-0000-4000-8000-000000000006';

    await db.exec(`
      INSERT INTO public.exam_versions (id, exam_id, version_number, title, subject, grade_level, total_points, status, published_at)
      VALUES ('${BAD_VER}', '${EXAM_ID}', 12, 'Bad Version 12', 'Toán', 5, 2.00, 'published', NOW());
      INSERT INTO public.exam_assignments (id, exam_version_id, class_id, assigned_by)
      VALUES ('${BAD_ASSIGN}', '${BAD_VER}', '${CLASS_ID}', '${TEACHER_ID}');
      INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points, options_json)
      VALUES ('${BAD_Q}', '${BAD_VER}', 1, 'single_choice', 'Q?', 2.00, '[{"key": "A", "text": false}]'::jsonb);
    `);

    const attemptId = await createAttempt({
      assignment_id: BAD_ASSIGN,
      exam_version_id: BAD_VER,
      question_order: [BAD_Q],
      option_orders: { [BAD_Q]: ['A'] }
    });

    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_INVALID_OPTION_SCHEMA/
    );
  });

  // --- 41. Numeric option_order element rejected ---
  await test('41. numeric option_order element rejected with ERR_OPTION_SNAPSHOT_INVALID', async () => {
    const attemptId = await createAttempt({
      option_orders: {
        ...VALID_OPTION_ORDERS,
        [Q_SINGLE]: [123, 456, 789]
      }
    });

    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_OPTION_SNAPSHOT_INVALID/
    );
  });

  // --- 42. Boolean option_order element rejected ---
  await test('42. boolean option_order element rejected with ERR_OPTION_SNAPSHOT_INVALID', async () => {
    const attemptId = await createAttempt({
      option_orders: {
        ...VALID_OPTION_ORDERS,
        [Q_SINGLE]: [true, false, true]
      }
    });

    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_OPTION_SNAPSHOT_INVALID/
    );
  });

  // --- 43. Corruption exception messages do NOT embed private details ---
  await test('43. corruption exception messages do NOT embed question UUID, option key, student ID, or attempt ID', async () => {
    // Test attempt snapshot corruption
    const corruptedSnapshotAttemptId = await createAttempt({ question_order: ['not-a-uuid'] });
    try {
      await runRpc(db, STUDENT_1_ID, corruptedSnapshotAttemptId);
      assert.fail('Expected exception');
    } catch (err) {
      const msg = err.message || '';
      assert.match(msg, /ERR_ATTEMPT_SNAPSHOT_INVALID: Invalid attempt snapshot/);
      assert.equal(msg.includes('not-a-uuid'), false);
      assert.equal(msg.includes(STUDENT_1_ID), false);
      assert.equal(msg.includes(corruptedSnapshotAttemptId), false);
    }

    // Test option snapshot corruption
    const corruptedOptionAttemptId = await createAttempt({
      option_orders: {
        ...VALID_OPTION_ORDERS,
        [Q_SINGLE]: ['NON_EXISTENT_KEY', 'A', 'B']
      }
    });
    try {
      await runRpc(db, STUDENT_1_ID, corruptedOptionAttemptId);
      assert.fail('Expected exception');
    } catch (err) {
      const msg = err.message || '';
      assert.match(msg, /ERR_OPTION_SNAPSHOT_INVALID: Invalid option snapshot/);
      assert.equal(msg.includes('NON_EXISTENT_KEY'), false);
      assert.equal(msg.includes(Q_SINGLE), false);
    }
  });

  // --- 44. Object option_order element rejected ---
  await test('44. object option_order element rejected with ERR_OPTION_SNAPSHOT_INVALID', async () => {
    const attemptId = await createAttempt({
      option_orders: {
        ...VALID_OPTION_ORDERS,
        [Q_SINGLE]: [{ key: 'A' }, { key: 'B' }, { key: 'C' }]
      }
    });

    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_OPTION_SNAPSHOT_INVALID/
    );
  });

  // --- 45. Array option_order element rejected ---
  await test('45. array option_order element rejected with ERR_OPTION_SNAPSHOT_INVALID', async () => {
    const attemptId = await createAttempt({
      option_orders: {
        ...VALID_OPTION_ORDERS,
        [Q_SINGLE]: [['A'], ['B'], ['C']]
      }
    });

    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_OPTION_SNAPSHOT_INVALID/
    );
  });

  // --- 46. Null option_order element rejected ---
  await test('46. null option_order element rejected with ERR_OPTION_SNAPSHOT_INVALID', async () => {
    const attemptId = await createAttempt({
      option_orders: {
        ...VALID_OPTION_ORDERS,
        [Q_SINGLE]: [null, 'B', 'C']
      }
    });

    await assert.rejects(
      async () => await runRpc(db, STUDENT_1_ID, attemptId),
      /ERR_OPTION_SNAPSHOT_INVALID/
    );
  });

  console.log('\n================================================================');
  console.log(`TEST RUN COMPLETE: ${passedTests} PASSED, ${failedTests} FAILED (TOTAL: ${totalTests})`);
  console.log('================================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

const APPROVED_QUESTION_TYPES_SET = new Set([
  'single_choice',
  'multiple_choice',
  'fill_blank',
  'short_answer',
  'essay',
  'image_upload',
  'file_upload',
]);

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
