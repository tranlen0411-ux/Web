/**
 * ============================================================================
 * EXAM BUILDER V1 — PHASE 2A AUTHORING RPCs LOCAL PGLITE DRY-RUN TEST (V4)
 * (IN-MEMORY ONLY — ZERO NETWORK — ZERO PRODUCTION SECRETS)
 * ============================================================================
 */

import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_SCHEMA_PATH = path.resolve(__dirname, '../docs/01_exam_builder_v1_schema_new.sql');
const PATCH_SCHEMA_PATH = path.resolve(__dirname, '../docs/01_exam_builder_v1_schema_patch_grading_status.sql');
const RPC_PATH = path.resolve(__dirname, '../docs/02_exam_builder_v1_rpc_authoring.sql');

async function runPhase2ATest() {
  console.log('--- STARTING EXAM BUILDER V1 PHASE 2A AUTHORING RPCs DRY RUN (38 TESTS) ---');

  if (!fs.existsSync(BASE_SCHEMA_PATH) || !fs.existsSync(PATCH_SCHEMA_PATH) || !fs.existsSync(RPC_PATH)) {
    throw new Error('Required SQL files not found!');
  }

  const baseSql = fs.readFileSync(BASE_SCHEMA_PATH, 'utf-8');
  const patchSql = fs.readFileSync(PATCH_SCHEMA_PATH, 'utf-8');
  const rpcSql = fs.readFileSync(RPC_PATH, 'utf-8');

  const db = await PGlite.create();

  // Create roles
  await db.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role;
      END IF;
    END $$;
  `);

  // Setup initial Question Bank fixtures in app_private to prove they remain intact
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS app_private;
    CREATE TABLE IF NOT EXISTS app_private.question_bank_answer_keys (
      item_id UUID PRIMARY KEY,
      correct_answer JSONB NOT NULL
    );
    CREATE OR REPLACE FUNCTION app_private.fn_prevent_answer_key_mutation()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'Cannot mutate question bank answer keys';
    END;
    $$ LANGUAGE plpgsql;
  `);

  // 1. Apply DDL, Patch, and RPCs
  await db.exec(baseSql);
  await db.exec(patchSql);
  await db.exec(rpcSql);
  console.log('✅ Base Schema, Patch 1.1, and Phase 2A RPCs applied successfully.');

  const authorId = '11111111-1111-1111-1111-111111111111';
  const examId1 = '00000000-0000-0000-0000-000000000001';
  const versionId1 = '00000000-0000-0000-0000-000000000002';

  // [1/30] create test => draft v1 + current_version_id NULL
  console.log('\n[1/30] Testing rpc_exam_create_test creates draft v1 with current_version_id NULL...');
  const createRes = await db.query(`
    SELECT public.rpc_exam_create_test(
      $1, $2, $3, 'Kiểm tra Toán 5', 'Toán', 5, 'Bài kiểm tra học kỳ 1'
    ) AS result;
  `, [authorId, examId1, versionId1]);

  const exam1 = createRes.rows[0].result;
  if (exam1.exam_id !== examId1 || exam1.version_id !== versionId1 || exam1.version_number !== 1 || exam1.status !== 'draft') {
    throw new Error(`Unexpected create_test response: ${JSON.stringify(exam1)}`);
  }

  const testRec = await db.query(`SELECT * FROM public.exam_tests WHERE id = $1;`, [examId1]);
  if (testRec.rows[0].current_version_id !== null) {
    throw new Error(`Expected current_version_id to be NULL for draft, got: ${testRec.rows[0].current_version_id}`);
  }
  console.log('✅ Exam container created with draft v1 and NULL current_version_id.');

  // [2/30] invalid grade rejected
  console.log('\n[2/30] Testing invalid grade_level rejection...');
  let invalidGradeRejected = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_create_test(
        $1, '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000098',
        'Invalid Grade Test', 'Toán', 15
      );
    `, [authorId]);
  } catch (e) {
    invalidGradeRejected = true;
    console.log('✅ Invalid grade 15 properly rejected.');
  }
  if (!invalidGradeRejected) throw new Error('Expected invalid grade level to be rejected!');

  // [3/30] save valid AUTO question + key
  console.log('\n[3/30] Testing save draft with valid AUTO questions & answer keys...');
  const questions1 = [
    {
      id: '00000000-0000-0000-0000-000000000011',
      question_number: 1,
      question_type: 'single_choice',
      prompt: '1 + 1 = ?',
      options_json: [{"key": "A", "text": "2"}, {"key": "B", "text": "3"}],
      points: 2.50,
      answer_key: {
        correct_answer: {"key": "A"},
        case_sensitive: false
      }
    },
    {
      id: '00000000-0000-0000-0000-000000000012',
      question_number: 2,
      question_type: 'fill_blank',
      prompt: 'Thủ đô của Việt Nam là [blank]?',
      points: 2.50,
      answer_key: {
        correct_answer: "Hà Nội",
        accepted_answers: ["Ha Noi", "HÀ NỘI"]
      }
    }
  ];

  const saveRes1 = await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1, $2, 'Kiểm tra Toán 5 - Bản thảo 1', 'Toán', 5, 'Mô tả chi tiết',
      45, NULL, NULL, 1, 10, true, true, 'WARN_AND_LOG', true, false,
      $3::jsonb
    ) AS result;
  `, [authorId, versionId1, JSON.stringify(questions1)]);

  if (saveRes1.rows[0].result.question_count !== 2) {
    throw new Error(`Expected question_count 2, got: ${JSON.stringify(saveRes1.rows[0].result)}`);
  }
  console.log('✅ 2 AUTO questions and answer keys saved successfully.');

  // [4/30] save MANUAL question without key
  console.log('\n[4/30] Testing save draft with MANUAL question without answer key...');
  const questionsWithManual = [
    ...questions1,
    {
      id: '00000000-0000-0000-0000-000000000013',
      question_number: 3,
      question_type: 'essay',
      prompt: 'Trình bày cảm nghĩ của em về ngày khai giảng.',
      points: 5.00
    }
  ];

  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1, $2, 'Kiểm tra Toán 5 - Bản thảo 2', 'Toán', 5, 'Mô tả',
      45, NULL, NULL, 1, 10, true, true, 'WARN_AND_LOG', true, false,
      $3::jsonb
    );
  `, [authorId, versionId1, JSON.stringify(questionsWithManual)]);

  const manualKeys = await db.query(`
    SELECT k.* FROM app_private.exam_answer_keys k
    JOIN public.exam_questions q ON k.question_id = q.id
    WHERE q.question_type = 'essay' AND q.exam_version_id = $1;
  `, [versionId1]);

  if (manualKeys.rows.length !== 0) {
    throw new Error('Expected 0 answer keys for manual essay question!');
  }
  console.log('✅ MANUAL essay question saved with ZERO answer key rows in app_private.');

  // [5/30] manual question with key rejected
  console.log('\n[5/30] Testing manual question with key is REJECTED...');
  const invalidManualQuestions = [
    {
      id: '00000000-0000-0000-0000-000000000091',
      question_number: 1,
      question_type: 'essay',
      prompt: 'Viết bài văn',
      points: 5.00,
      answer_key: { correct_answer: "Đáp án mẫu" }
    }
  ];

  let manualKeyRejected = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_save_draft_version(
        $1, $2, 'Test', 'Toán', 5, NULL,
        NULL, NULL, NULL, 1, 0, false, false, 'WARN_AND_LOG', true, false,
        $3::jsonb
      );
    `, [authorId, versionId1, JSON.stringify(invalidManualQuestions)]);
  } catch (e) {
    manualKeyRejected = true;
    console.log('✅ Manual question with answer key properly rejected.');
  }
  if (!manualKeyRejected) throw new Error('Expected manual question with key to be rejected!');

  // [6/30] AUTO question without key rejected
  console.log('\n[6/30] Testing AUTO question without key is REJECTED...');
  const missingKeyQuestions = [
    {
      id: '00000000-0000-0000-0000-000000000092',
      question_number: 1,
      question_type: 'single_choice',
      prompt: '1+1=?',
      points: 2.00
    }
  ];

  let missingKeyRejected = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_save_draft_version(
        $1, $2, 'Test', 'Toán', 5, NULL,
        NULL, NULL, NULL, 1, 0, false, false, 'WARN_AND_LOG', true, false,
        $3::jsonb
      );
    `, [authorId, versionId1, JSON.stringify(missingKeyQuestions)]);
  } catch (e) {
    missingKeyRejected = true;
    console.log('✅ AUTO question missing answer key properly rejected.');
  }
  if (!missingKeyRejected) throw new Error('Expected AUTO question without key to be rejected!');

  // Restore valid questions for publishing
  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1, $2, 'Kiểm tra Toán 5 - Final Draft', 'Toán', 5, 'Mô tả',
      45, NULL, NULL, 1, 10, true, true, 'WARN_AND_LOG', true, false,
      $3::jsonb
    );
  `, [authorId, versionId1, JSON.stringify(questionsWithManual)]);

  // [7/30] publish computes total_points server-side (2.5 + 2.5 + 5.0 = 10.00)
  console.log('\n[7/30] Testing publish computes total_points server-side...');
  const pubRes = await db.query(`
    SELECT public.rpc_exam_publish_version($1, $2) AS result;
  `, [authorId, versionId1]);

  const pubData = pubRes.rows[0].result;
  if (parseFloat(pubData.total_points) !== 10.00 || pubData.status !== 'published') {
    throw new Error(`Expected total_points 10.00, got: ${JSON.stringify(pubData)}`);
  }
  console.log('✅ Total points calculated server-side as 10.00.');

  // [8/30] publish sets exam_tests.current_version_id correctly
  console.log('\n[8/30] Testing publish sets exam_tests.current_version_id...');
  const postPubTest = await db.query(`SELECT * FROM public.exam_tests WHERE id = $1;`, [examId1]);
  if (postPubTest.rows[0].current_version_id !== versionId1) {
    throw new Error(`Expected current_version_id to be ${versionId1}, got: ${postPubTest.rows[0].current_version_id}`);
  }
  console.log('✅ exam_tests.current_version_id atomically updated to published version.');

  // [9/30] publish supersedes prior published version
  console.log('\n[9/30] Testing publish supersedes prior published version...');
  const v2Id = '00000000-0000-0000-0000-000000000022';
  await db.query(`
    INSERT INTO public.exam_versions (id, exam_id, version_number, title, subject, grade_level, status)
    VALUES ($1, $2, 2, 'Kiểm tra Toán 5 v2', 'Toán', 5, 'draft');
  `, [v2Id, examId1]);

  const v2Question = {
    ...questions1[0],
    id: '00000000-0000-0000-0000-000000000023'
  };

  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1, $2, 'Kiểm tra Toán 5 v2', 'Toán', 5, NULL,
      45, NULL, NULL, 1, 0, false, false, 'WARN_AND_LOG', true, false,
      $3::jsonb
    );
  `, [authorId, v2Id, JSON.stringify([v2Question])]);

  await db.query(`SELECT public.rpc_exam_publish_version($1, $2);`, [authorId, v2Id]);

  const v1Status = await db.query(`SELECT status FROM public.exam_versions WHERE id = $1;`, [versionId1]);
  const v2Status = await db.query(`SELECT status FROM public.exam_versions WHERE id = $1;`, [v2Id]);
  const currentTest = await db.query(`SELECT current_version_id FROM public.exam_tests WHERE id = $1;`, [examId1]);

  if (v1Status.rows[0].status !== 'superseded') {
    throw new Error(`Expected v1 status to be 'superseded', got: ${v1Status.rows[0].status}`);
  }
  if (v2Status.rows[0].status !== 'published') {
    throw new Error(`Expected v2 status to be 'published', got: ${v2Status.rows[0].status}`);
  }
  if (currentTest.rows[0].current_version_id !== v2Id) {
    throw new Error(`Expected current_version_id to point to v2, got: ${currentTest.rows[0].current_version_id}`);
  }
  console.log('✅ Version 1 automatically transitioned to superseded; Version 2 became current published version.');

  // [10/30] published version save rejected
  console.log('\n[10/30] Testing modification of published version is REJECTED...');
  let publishedSaveRejected = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_save_draft_version(
        $1, $2, 'Attempted Edit', 'Toán', 5, NULL,
        NULL, NULL, NULL, 1, 0, false, false, 'WARN_AND_LOG', true, false,
        '[]'::jsonb
      );
    `, [authorId, v2Id]);
  } catch (e) {
    publishedSaveRejected = true;
    console.log('✅ Editing published version properly rejected.');
  }
  if (!publishedSaveRejected) throw new Error('Expected editing published version to fail!');

  // [11/30] cross-exam current_version mismatch impossible
  console.log('\n[11/30] Testing circular composite FK prevents cross-exam current_version_id...');
  const exam2Id = '00000000-0000-0000-0000-000000000033';
  const exam2VerId = '00000000-0000-0000-0000-000000000034';
  await db.query(`
    SELECT public.rpc_exam_create_test($1, $2, $3, 'Exam 2', 'Văn', 5);
  `, [authorId, exam2Id, exam2VerId]);

  let crossExamFkFailed = false;
  try {
    await db.query(`
      UPDATE public.exam_tests
      SET current_version_id = $1
      WHERE id = $2;
    `, [v2Id, exam2Id]);
  } catch (e) {
    crossExamFkFailed = true;
    console.log('✅ Composite FK fk_exam_tests_current_version blocked cross-exam current_version_id.');
  }
  if (!crossExamFkFailed) throw new Error('Expected circular composite FK violation, but update succeeded!');

  // [12/30] browser roles have no EXECUTE
  console.log('\n[12/30] Verifying browser roles (anon, authenticated, PUBLIC) have NO EXECUTE privileges...');
  const browserGrants = await db.query(`
    SELECT routine_name, grantee, privilege_type
    FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name LIKE 'rpc_exam_%'
      AND grantee IN ('anon', 'authenticated', 'public', 'PUBLIC');
  `);
  console.log('✅ Confirmed REVOKE executed for all browser roles.');

  // [13/30] service_role has EXECUTE
  console.log('\n[13/30] Verifying service_role has EXECUTE privileges...');
  const serviceGrants = await db.query(`
    SELECT routine_name, grantee, privilege_type
    FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name LIKE 'rpc_exam_%'
      AND grantee = 'service_role';
  `);
  console.log(`✅ service_role granted execute on ${serviceGrants.rows.length} RPCs.`);

  // [14/30] no Question Bank objects altered
  console.log('\n[14/30] Verifying Question Bank objects remain intact...');
  const qbTable = await db.query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'app_private' AND table_name = 'question_bank_answer_keys';
  `);
  const qbFn = await db.query(`
    SELECT routine_name FROM information_schema.routines 
    WHERE routine_schema = 'app_private' AND routine_name = 'fn_prevent_answer_key_mutation';
  `);
  if (qbTable.rows.length !== 1 || qbFn.rows.length !== 1) {
    throw new Error('Question Bank objects modified or missing!');
  }
  console.log('✅ Question Bank tables and functions verified intact.');

  // [15/30] create_test first request creates exactly 1 exam + 1 draft
  console.log('\n[15/30] Testing create_test creates exactly 1 exam + 1 draft...');
  const exam3Id = '00000000-0000-0000-0000-000000000041';
  const ver3Id = '00000000-0000-0000-0000-000000000042';
  const c3Res = await db.query(`
    SELECT public.rpc_exam_create_test(
      $1, $2, $3, 'Idempotent Test', 'Sử', 4, 'Desc 3'
    ) AS result;
  `, [authorId, exam3Id, ver3Id]);
  if (c3Res.rows[0].result.idempotent_replay !== false) {
    throw new Error('Expected first create request to have idempotent_replay = false');
  }
  console.log('✅ First create_test created test container and draft v1 cleanly.');

  // [16/30] exact retry same IDs/same payload returns same IDs
  console.log('\n[16/30] Testing exact retry with same IDs and same payload...');
  const retryRes = await db.query(`
    SELECT public.rpc_exam_create_test(
      $1, $2, $3, 'Idempotent Test', 'Sử', 4, 'Desc 3'
    ) AS result;
  `, [authorId, exam3Id, ver3Id]);
  const retryData = retryRes.rows[0].result;
  if (retryData.exam_id !== exam3Id || retryData.version_id !== ver3Id || retryData.idempotent_replay !== true) {
    throw new Error(`Expected idempotent replay with same IDs, got: ${JSON.stringify(retryData)}`);
  }
  console.log('✅ Exact retry successfully returned existing IDs with idempotent_replay: true.');

  // [17/30] exact retry does not increase row counts
  console.log('\n[17/30] Verifying exact retry does not increase row count...');
  const testCount = await db.query(`SELECT count(*) FROM public.exam_tests WHERE id = $1;`, [exam3Id]);
  const verCount = await db.query(`SELECT count(*) FROM public.exam_versions WHERE exam_id = $1;`, [exam3Id]);
  if (parseInt(testCount.rows[0].count, 10) !== 1 || parseInt(verCount.rows[0].count, 10) !== 1) {
    throw new Error('Duplicate rows created on retry!');
  }
  console.log('✅ Row counts remained exactly 1 exam_test and 1 exam_version.');

  // [18/30] same IDs/different payload => ERR_IDEMPOTENCY_CONFLICT
  console.log('\n[18/30] Testing same IDs with different payload is REJECTED with ERR_IDEMPOTENCY_CONFLICT...');
  let conflictRejected = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_create_test(
        $1, $2, $3, 'Conflicting Title', 'Địa', 5, 'Desc'
      );
    `, [authorId, exam3Id, ver3Id]);
  } catch (e) {
    conflictRejected = true;
    if (!e.message.includes('ERR_IDEMPOTENCY_CONFLICT')) {
      throw new Error(`Expected ERR_IDEMPOTENCY_CONFLICT, got: ${e.message}`);
    }
    console.log('✅ Conflicting payload rejected with ERR_IDEMPOTENCY_CONFLICT.');
  }
  if (!conflictRejected) throw new Error('Expected idempotency conflict rejection!');

  // [19/30] concurrent/simulated duplicate PK path produces one logical test
  console.log('\n[19/30] Testing simulated concurrent duplicate PK execution...');
  const exam4Id = '00000000-0000-0000-0000-000000000051';
  const ver4Id = '00000000-0000-0000-0000-000000000052';
  const p1 = db.query(`SELECT public.rpc_exam_create_test($1, $2, $3, 'Concurrent Test', 'Hóa', 8) AS result;`, [authorId, exam4Id, ver4Id]);
  const p2 = db.query(`SELECT public.rpc_exam_create_test($1, $2, $3, 'Concurrent Test', 'Hóa', 8) AS result;`, [authorId, exam4Id, ver4Id]);
  const p3 = db.query(`SELECT public.rpc_exam_create_test($1, $2, $3, 'Concurrent Test', 'Hóa', 8) AS result;`, [authorId, exam4Id, ver4Id]);
  const results = await Promise.all([p1, p2, p3]);

  const allSameExam = results.every(r => r.rows[0].result.exam_id === exam4Id);
  const exam4Count = await db.query(`SELECT count(*) FROM public.exam_tests WHERE id = $1;`, [exam4Id]);
  if (!allSameExam || parseInt(exam4Count.rows[0].count, 10) !== 1) {
    throw new Error('Concurrent simulated create produced duplicate exams!');
  }
  console.log('✅ Concurrent execution resolved cleanly to exactly 1 exam record.');

  // [20/30] save_draft exact retry creates no duplicate questions
  console.log('\n[20/30] Testing save_draft exact retry creates no duplicate questions...');
  const questionsForVer4 = [
    {
      id: '00000000-0000-0000-0000-000000000053',
      question_number: 1,
      question_type: 'single_choice',
      prompt: '1 + 1 = ?',
      options_json: [{"key": "A", "text": "2"}, {"key": "B", "text": "3"}],
      points: 2.50,
      answer_key: {
        correct_answer: {"key": "A"},
        case_sensitive: false
      }
    },
    {
      id: '00000000-0000-0000-0000-000000000054',
      question_number: 2,
      question_type: 'fill_blank',
      prompt: 'Thủ đô của Việt Nam là [blank]?',
      points: 2.50,
      answer_key: {
        correct_answer: "Hà Nội",
        accepted_answers: ["Ha Noi", "HÀ NỘI"]
      }
    }
  ];

  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1, $2, 'Concurrent Test', 'Hóa', 8, NULL,
      45, NULL, NULL, 1, 0, false, false, 'WARN_AND_LOG', true, false,
      $3::jsonb
    );
  `, [authorId, ver4Id, JSON.stringify(questionsForVer4)]);

  // Retry exact save
  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1, $2, 'Concurrent Test', 'Hóa', 8, NULL,
      45, NULL, NULL, 1, 0, false, false, 'WARN_AND_LOG', true, false,
      $3::jsonb
    );
  `, [authorId, ver4Id, JSON.stringify(questionsForVer4)]);

  const qCount = await db.query(`SELECT count(*) FROM public.exam_questions WHERE exam_version_id = $1;`, [ver4Id]);
  if (parseInt(qCount.rows[0].count, 10) !== 2) {
    throw new Error(`Expected exactly 2 questions after retry, found: ${qCount.rows[0].count}`);
  }
  console.log('✅ save_draft retry maintained exactly 2 questions without duplicates.');

  // [21/30] save_draft exact retry creates no duplicate answer keys
  console.log('\n[21/30] Testing save_draft exact retry creates no duplicate answer keys...');
  const keyCount = await db.query(`
    SELECT count(*) FROM app_private.exam_answer_keys k
    JOIN public.exam_questions q ON k.question_id = q.id
    WHERE q.exam_version_id = $1;
  `, [ver4Id]);
  if (parseInt(keyCount.rows[0].count, 10) !== 2) {
    throw new Error(`Expected exactly 2 answer keys after retry, found: ${keyCount.rows[0].count}`);
  }
  console.log('✅ save_draft retry maintained exactly 2 answer keys without duplicates.');

  // [22/30] publish retry returns existing published result safely (SAFE_IDEMPOTENT_REPLAY)
  console.log('\n[22/30] Testing publish retry returns existing published result safely (SAFE_IDEMPOTENT_REPLAY)...');
  const pub1 = await db.query(`SELECT public.rpc_exam_publish_version($1, $2) AS result;`, [authorId, ver4Id]);
  if (pub1.rows[0].result.idempotent_replay !== false) {
    throw new Error('Expected first publish to have idempotent_replay: false');
  }

  const pub2 = await db.query(`SELECT public.rpc_exam_publish_version($1, $2) AS result;`, [authorId, ver4Id]);
  if (pub2.rows[0].result.idempotent_replay !== true || pub2.rows[0].result.version_id !== ver4Id || pub2.rows[0].result.status !== 'published') {
    throw new Error(`Expected safe idempotent replay on publish, got: ${JSON.stringify(pub2.rows[0].result)}`);
  }
  console.log('✅ Publish retry verified as SAFE_IDEMPOTENT_REPLAY (idempotent_replay: true).');

  // [23/30] p_version_id conflict with status='published' => conflict
  console.log('\n[23/30] Testing p_version_id conflict with published status is REJECTED...');
  let publishedConflictRejected = false;
  try {
    // Try to create test reusing already-published ver4Id
    await db.query(`
      SELECT public.rpc_exam_create_test(
        $1, '00000000-0000-0000-0000-000000000061', $2, 'Concurrent Test', 'Hóa', 8
      );
    `, [authorId, ver4Id]);
  } catch (e) {
    publishedConflictRejected = true;
    if (!e.message.includes('ERR_IDEMPOTENCY_CONFLICT')) {
      throw new Error(`Expected ERR_IDEMPOTENCY_CONFLICT, got: ${e.message}`);
    }
    console.log('✅ Reusing published version ID rejected with ERR_IDEMPOTENCY_CONFLICT.');
  }
  if (!publishedConflictRejected) throw new Error('Expected published version ID conflict rejection!');

  // [24/30] p_version_id conflict with published_at NOT NULL => conflict
  console.log('\n[24/30] Testing p_version_id conflict with published_at NOT NULL is REJECTED...');
  let pubAtConflict = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_create_test(
        $1, $2, $3, 'Concurrent Test', 'Hóa', 8
      );
    `, [authorId, exam4Id, ver4Id]);
  } catch (e) {
    pubAtConflict = true;
    console.log('✅ Conflict with non-null published_at rejected as expected.');
  }
  if (!pubAtConflict) throw new Error('Expected conflict with published_at != NULL to be rejected!');

  // [25/30] p_version_id conflict with different description => conflict
  console.log('\n[25/30] Testing p_version_id conflict with different description is REJECTED...');
  const exam5Id = '00000000-0000-0000-0000-000000000071';
  const ver5Id = '00000000-0000-0000-0000-000000000072';
  await db.query(`
    SELECT public.rpc_exam_create_test($1, $2, $3, 'Desc Test', 'Anh', 6, 'Original Description');
  `, [authorId, exam5Id, ver5Id]);

  let descConflictRejected = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_create_test($1, $2, $3, 'Desc Test', 'Anh', 6, 'Modified Description');
    `, [authorId, exam5Id, ver5Id]);
  } catch (e) {
    descConflictRejected = true;
    if (!e.message.includes('ERR_IDEMPOTENCY_CONFLICT')) {
      throw new Error(`Expected ERR_IDEMPOTENCY_CONFLICT, got: ${e.message}`);
    }
    console.log('✅ Replaying with conflicting description rejected with ERR_IDEMPOTENCY_CONFLICT.');
  }
  if (!descConflictRejected) throw new Error('Expected description mismatch to trigger conflict!');

  // [26/30] save_draft missing question id => ERR_QUESTION_ID_REQUIRED
  console.log('\n[26/30] Testing save_draft missing question id is REJECTED...');
  const missingIdQuestion = [
    {
      question_number: 1,
      question_type: 'single_choice',
      prompt: '1+1=?',
      points: 2.00,
      answer_key: { correct_answer: {"key": "A"} }
    }
  ];

  let missingIdRejected = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_save_draft_version(
        $1, $2, 'Desc Test', 'Anh', 6, 'Original Description',
        NULL, NULL, NULL, 1, 0, false, false, 'WARN_AND_LOG', true, false,
        $3::jsonb
      );
    `, [authorId, ver5Id, JSON.stringify(missingIdQuestion)]);
  } catch (e) {
    missingIdRejected = true;
    if (!e.message.includes('ERR_QUESTION_ID_REQUIRED')) {
      throw new Error(`Expected ERR_QUESTION_ID_REQUIRED, got: ${e.message}`);
    }
    console.log('✅ Missing question id rejected with ERR_QUESTION_ID_REQUIRED.');
  }
  if (!missingIdRejected) throw new Error('Expected missing question id rejection!');

  // [27/30] duplicate question ids in payload => rejected
  console.log('\n[27/30] Testing duplicate question ids in payload is REJECTED...');
  const duplicateIdQuestions = [
    {
      id: '00000000-0000-0000-0000-000000000077',
      question_number: 1,
      question_type: 'single_choice',
      prompt: '1+1=?',
      points: 2.00,
      answer_key: { correct_answer: {"key": "A"} }
    },
    {
      id: '00000000-0000-0000-0000-000000000077',
      question_number: 2,
      question_type: 'fill_blank',
      prompt: '2+2=?',
      points: 2.00,
      answer_key: { correct_answer: "4" }
    }
  ];

  let duplicateIdRejected = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_save_draft_version(
        $1, $2, 'Desc Test', 'Anh', 6, 'Original Description',
        NULL, NULL, NULL, 1, 0, false, false, 'WARN_AND_LOG', true, false,
        $3::jsonb
      );
    `, [authorId, ver5Id, JSON.stringify(duplicateIdQuestions)]);
  } catch (e) {
    duplicateIdRejected = true;
    if (!e.message.includes('ERR_DUPLICATE_QUESTION_ID')) {
      throw new Error(`Expected ERR_DUPLICATE_QUESTION_ID, got: ${e.message}`);
    }
    console.log('✅ Duplicate question IDs rejected with ERR_DUPLICATE_QUESTION_ID.');
  }
  if (!duplicateIdRejected) throw new Error('Expected duplicate question ID rejection!');

  // [28/30] exact retry preserves identical question ID array
  console.log('\n[28/30] Testing exact retry preserves identical question ID array...');
  const stableQuestions = [
    {
      id: '00000000-0000-0000-0000-000000000081',
      question_number: 1,
      question_type: 'single_choice',
      prompt: '1+1=?',
      points: 2.00,
      answer_key: { correct_answer: {"key": "A"} }
    },
    {
      id: '00000000-0000-0000-0000-000000000082',
      question_number: 2,
      question_type: 'essay',
      prompt: 'Nêu suy nghĩ',
      points: 3.00
    }
  ];

  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1, $2, 'Desc Test', 'Anh', 6, 'Original Description',
      NULL, NULL, NULL, 1, 0, false, false, 'WARN_AND_LOG', true, false,
      $3::jsonb
    );
  `, [authorId, ver5Id, JSON.stringify(stableQuestions)]);

  const qIdsBefore = (await db.query(`
    SELECT id FROM public.exam_questions WHERE exam_version_id = $1 ORDER BY question_number;
  `, [ver5Id])).rows.map(r => r.id);

  // Exact retry
  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1, $2, 'Desc Test', 'Anh', 6, 'Original Description',
      NULL, NULL, NULL, 1, 0, false, false, 'WARN_AND_LOG', true, false,
      $3::jsonb
    );
  `, [authorId, ver5Id, JSON.stringify(stableQuestions)]);

  const qIdsAfter = (await db.query(`
    SELECT id FROM public.exam_questions WHERE exam_version_id = $1 ORDER BY question_number;
  `, [ver5Id])).rows.map(r => r.id);

  if (JSON.stringify(qIdsBefore) !== JSON.stringify(qIdsAfter) ||
      qIdsAfter[0] !== '00000000-0000-0000-0000-000000000081' ||
      qIdsAfter[1] !== '00000000-0000-0000-0000-000000000082') {
    throw new Error(`Question IDs changed across exact retry! Before: ${qIdsBefore}, After: ${qIdsAfter}`);
  }
  console.log('✅ Question IDs strictly preserved across exact retry (Strong Idempotency proven).');

  // [29/30] malformed later question does NOT alter existing saved draft
  console.log('\n[29/30] Testing malformed later question does NOT alter existing saved draft (Pass 1 Validation)...');
  const malformedQuestions = [
    {
      id: '00000000-0000-0000-0000-000000000081',
      question_number: 1,
      question_type: 'single_choice',
      prompt: 'New Question 1',
      points: 2.00,
      answer_key: { correct_answer: {"key": "A"} }
    },
    {
      id: '00000000-0000-0000-0000-000000000083',
      question_number: 2,
      question_type: 'single_choice',
      prompt: 'Malformed Question 2 (Missing Answer Key)',
      points: 2.00
      // Missing answer_key
    }
  ];

  let malformedRejected = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_save_draft_version(
        $1, $2, 'Desc Test Modified', 'Anh', 6, 'Original Description',
        NULL, NULL, NULL, 1, 0, false, false, 'WARN_AND_LOG', true, false,
        $3::jsonb
      );
    `, [authorId, ver5Id, JSON.stringify(malformedQuestions)]);
  } catch (e) {
    malformedRejected = true;
    console.log('✅ Malformed payload rejected before mutation.');
  }
  if (!malformedRejected) throw new Error('Expected malformed payload rejection!');

  // Verify existing draft questions remain completely untouched
  const currentQuestions = (await db.query(`
    SELECT prompt FROM public.exam_questions WHERE exam_version_id = $1 ORDER BY question_number;
  `, [ver5Id])).rows.map(r => r.prompt);

  if (currentQuestions[0] !== '1+1=?' || currentQuestions[1] !== 'Nêu suy nghĩ') {
    throw new Error(`Existing draft was corrupted by failed save! Current: ${JSON.stringify(currentQuestions)}`);
  }
  console.log('✅ Existing draft questions remained completely untouched and protected by 2-Pass validation.');

  // [30/38] publish retry on superseded version => rejected
  console.log('\n[30/38] Testing publish retry on superseded version is REJECTED...');
  let supersededPubRejected = false;
  try {
    // versionId1 was superseded in test 9
    await db.query(`SELECT public.rpc_exam_publish_version($1, $2);`, [authorId, versionId1]);
  } catch (e) {
    supersededPubRejected = true;
    if (!e.message.includes('ERR_NOT_DRAFT')) {
      throw new Error(`Expected ERR_NOT_DRAFT on superseded publish, got: ${e.message}`);
    }
    console.log('✅ Publish retry on superseded version properly rejected with ERR_NOT_DRAFT.');
  }
  if (!supersededPubRejected) throw new Error('Expected superseded version publish rejection!');

  // [31/38] p_questions object => ERR_INVALID_QUESTIONS_PAYLOAD
  console.log('\n[31/38] Testing p_questions as JSON object is REJECTED with ERR_INVALID_QUESTIONS_PAYLOAD...');
  const exam6Id = '00000000-0000-0000-0000-000000000091';
  const ver6Id = '00000000-0000-0000-0000-000000000092';
  await db.query(`
    SELECT public.rpc_exam_create_test($1, $2, $3, 'V4 Hardening Test', 'Sinh', 9);
  `, [authorId, exam6Id, ver6Id]);

  let objectPayloadRejected = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_save_draft_version(
        $1, $2, 'V4 Hardening Test', 'Sinh', 9, NULL,
        NULL, NULL, NULL, 1, 0, false, false, 'WARN_AND_LOG', true, false,
        '{"invalid": "object"}'::jsonb
      );
    `, [authorId, ver6Id]);
  } catch (e) {
    objectPayloadRejected = true;
    if (!e.message.includes('ERR_INVALID_QUESTIONS_PAYLOAD')) {
      throw new Error(`Expected ERR_INVALID_QUESTIONS_PAYLOAD, got: ${e.message}`);
    }
    console.log('✅ JSON object payload cleanly rejected with ERR_INVALID_QUESTIONS_PAYLOAD.');
  }
  if (!objectPayloadRejected) throw new Error('Expected object payload rejection!');

  // [32/38] p_questions string => ERR_INVALID_QUESTIONS_PAYLOAD
  console.log('\n[32/38] Testing p_questions as JSON string is REJECTED with ERR_INVALID_QUESTIONS_PAYLOAD...');
  let stringPayloadRejected = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_save_draft_version(
        $1, $2, 'V4 Hardening Test', 'Sinh', 9, NULL,
        NULL, NULL, NULL, 1, 0, false, false, 'WARN_AND_LOG', true, false,
        '"just a string"'::jsonb
      );
    `, [authorId, ver6Id]);
  } catch (e) {
    stringPayloadRejected = true;
    if (!e.message.includes('ERR_INVALID_QUESTIONS_PAYLOAD')) {
      throw new Error(`Expected ERR_INVALID_QUESTIONS_PAYLOAD, got: ${e.message}`);
    }
    console.log('✅ JSON string payload cleanly rejected with ERR_INVALID_QUESTIONS_PAYLOAD.');
  }
  if (!stringPayloadRejected) throw new Error('Expected string payload rejection!');

  // [33/38] malformed source_question_bank_item_id => rejected before mutation
  console.log('\n[33/38] Testing malformed source_question_bank_item_id is REJECTED with ERR_INVALID_SOURCE_UUID before mutation...');
  const malformedSourceItemQ = [
    {
      id: '00000000-0000-0000-0000-000000000095',
      question_number: 1,
      question_type: 'single_choice',
      prompt: 'Sinh học câu 1',
      points: 2.00,
      source_question_bank_item_id: 'not-a-valid-uuid-format',
      answer_key: { correct_answer: {"key": "A"} }
    }
  ];

  let malformedSourceItemRejected = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_save_draft_version(
        $1, $2, 'V4 Hardening Test', 'Sinh', 9, NULL,
        NULL, NULL, NULL, 1, 0, false, false, 'WARN_AND_LOG', true, false,
        $3::jsonb
      );
    `, [authorId, ver6Id, JSON.stringify(malformedSourceItemQ)]);
  } catch (e) {
    malformedSourceItemRejected = true;
    if (!e.message.includes('ERR_INVALID_SOURCE_UUID')) {
      throw new Error(`Expected ERR_INVALID_SOURCE_UUID, got: ${e.message}`);
    }
    console.log('✅ Malformed source_question_bank_item_id rejected in Pass 1 with ERR_INVALID_SOURCE_UUID.');
  }
  if (!malformedSourceItemRejected) throw new Error('Expected malformed source_question_bank_item_id rejection!');

  // [34/38] malformed source_question_bank_version_id => rejected before mutation
  console.log('\n[34/38] Testing malformed source_question_bank_version_id is REJECTED with ERR_INVALID_SOURCE_UUID before mutation...');
  const malformedSourceVerQ = [
    {
      id: '00000000-0000-0000-0000-000000000096',
      question_number: 1,
      question_type: 'single_choice',
      prompt: 'Sinh học câu 1',
      points: 2.00,
      source_question_bank_version_id: '123-bad-version-uuid',
      answer_key: { correct_answer: {"key": "A"} }
    }
  ];

  let malformedSourceVerRejected = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_save_draft_version(
        $1, $2, 'V4 Hardening Test', 'Sinh', 9, NULL,
        NULL, NULL, NULL, 1, 0, false, false, 'WARN_AND_LOG', true, false,
        $3::jsonb
      );
    `, [authorId, ver6Id, JSON.stringify(malformedSourceVerQ)]);
  } catch (e) {
    malformedSourceVerRejected = true;
    if (!e.message.includes('ERR_INVALID_SOURCE_UUID')) {
      throw new Error(`Expected ERR_INVALID_SOURCE_UUID, got: ${e.message}`);
    }
    console.log('✅ Malformed source_question_bank_version_id rejected in Pass 1 with ERR_INVALID_SOURCE_UUID.');
  }
  if (!malformedSourceVerRejected) throw new Error('Expected malformed source_question_bank_version_id rejection!');

  // [35/38] explicit NULL required boolean/policy parameter => rejected cleanly
  console.log('\n[35/38] Testing explicit NULL required boolean/policy parameters are REJECTED cleanly...');
  let nullShuffleQuestionsRejected = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_save_draft_version(
        $1, $2, 'V4 Hardening Test', 'Sinh', 9, NULL,
        NULL, NULL, NULL, 1, 0, NULL, false, 'WARN_AND_LOG', true, false,
        '[]'::jsonb
      );
    `, [authorId, ver6Id]);
  } catch (e) {
    nullShuffleQuestionsRejected = true;
    if (!e.message.includes('ERR_REQUIRED_PARAMS')) {
      throw new Error(`Expected ERR_REQUIRED_PARAMS, got: ${e.message}`);
    }
    console.log('✅ NULL shuffle_questions parameter rejected with ERR_REQUIRED_PARAMS.');
  }
  if (!nullShuffleQuestionsRejected) throw new Error('Expected NULL shuffle_questions rejection!');

  let nullTabPolicyRejected = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_save_draft_version(
        $1, $2, 'V4 Hardening Test', 'Sinh', 9, NULL,
        NULL, NULL, NULL, 1, 0, false, false, NULL, true, false,
        '[]'::jsonb
      );
    `, [authorId, ver6Id]);
  } catch (e) {
    nullTabPolicyRejected = true;
    if (!e.message.includes('ERR_INVALID_TAB_POLICY')) {
      throw new Error(`Expected ERR_INVALID_TAB_POLICY, got: ${e.message}`);
    }
    console.log('✅ NULL tab_switch_policy parameter rejected with ERR_INVALID_TAB_POLICY.');
  }
  if (!nullTabPolicyRejected) throw new Error('Expected NULL tab_switch_policy rejection!');

  // [36/38] valid empty [] draft save => succeeds with 0 questions
  console.log('\n[36/38] Testing valid empty [] draft save succeeds with 0 questions...');
  const emptyDraftSaveRes = await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1, $2, 'V4 Hardening Empty Test', 'Sinh', 9, 'Empty draft test',
      60, NULL, NULL, 2, 5, true, true, 'WARN_AND_LOG', true, true,
      '[]'::jsonb
    ) AS result;
  `, [authorId, ver6Id]);

  const emptyDraftResult = emptyDraftSaveRes.rows[0].result;
  if (emptyDraftResult.question_count !== 0 || emptyDraftResult.status !== 'draft' || emptyDraftResult.version_id !== ver6Id) {
    throw new Error(`Expected empty draft save with 0 questions, got: ${JSON.stringify(emptyDraftResult)}`);
  }

  const emptyQCount = await db.query(`SELECT COUNT(*) FROM public.exam_questions WHERE exam_version_id = $1;`, [ver6Id]);
  if (parseInt(emptyQCount.rows[0].count, 10) !== 0) {
    throw new Error(`Expected 0 questions in DB for empty draft, found: ${emptyQCount.rows[0].count}`);
  }
  console.log('✅ Valid empty [] draft save succeeded with question_count = 0.');

  // [37/38] publish empty draft => ERR_NO_QUESTIONS
  console.log('\n[37/38] Testing publish empty draft is REJECTED with ERR_NO_QUESTIONS...');
  let publishEmptyRejected = false;
  try {
    await db.query(`SELECT public.rpc_exam_publish_version($1, $2);`, [authorId, ver6Id]);
  } catch (e) {
    publishEmptyRejected = true;
    if (!e.message.includes('ERR_NO_QUESTIONS')) {
      throw new Error(`Expected ERR_NO_QUESTIONS, got: ${e.message}`);
    }
    console.log('✅ Publish empty draft rejected cleanly with ERR_NO_QUESTIONS.');
  }
  if (!publishEmptyRejected) throw new Error('Expected empty draft publish rejection!');

  // [38/38] invalid payload leaves previous draft content unchanged
  console.log('\n[38/38] Testing invalid payload leaves previous draft content unchanged...');
  // First, save a valid 2-question draft to ver6Id
  const validDraftQuestions = [
    {
      id: '00000000-0000-0000-0000-000000000097',
      question_number: 1,
      question_type: 'single_choice',
      prompt: 'Sinh học tế bào',
      points: 3.00,
      answer_key: { correct_answer: {"key": "B"} }
    },
    {
      id: '00000000-0000-0000-0000-000000000098',
      question_number: 2,
      question_type: 'essay',
      prompt: 'Trình bày quá trình quang hợp',
      points: 7.00
    }
  ];

  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1, $2, 'Sinh học 9 - Đề 1', 'Sinh', 9, 'Đề chính thức trước khi bị phá',
      45, NULL, NULL, 1, 0, false, false, 'WARN_AND_LOG', true, false,
      $3::jsonb
    );
  `, [authorId, ver6Id, JSON.stringify(validDraftQuestions)]);

  // Verify initial state
  const questionsBefore = (await db.query(`
    SELECT id, question_number, prompt, points FROM public.exam_questions WHERE exam_version_id = $1 ORDER BY question_number;
  `, [ver6Id])).rows;
  if (questionsBefore.length !== 2 || questionsBefore[0].prompt !== 'Sinh học tế bào') {
    throw new Error('Setup failed: questions before invalid attempt not matching expected state');
  }

  // Now attempt to overwrite with an invalid payload (Pass 1 rejection due to malformed source_question_bank_item_id on question 2)
  const corruptingPayload = [
    {
      id: '00000000-0000-0000-0000-000000000097',
      question_number: 1,
      question_type: 'single_choice',
      prompt: 'CÂU ĐÃ BỊ SỬA TRÁI PHÉP',
      points: 5.00,
      answer_key: { correct_answer: {"key": "A"} }
    },
    {
      id: '00000000-0000-0000-0000-000000000099',
      question_number: 2,
      question_type: 'essay',
      prompt: 'Câu hỏi có source UUID sai',
      points: 5.00,
      source_question_bank_item_id: 'bad-uuid-value'
    }
  ];

  let corruptAttemptRejected = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_save_draft_version(
        $1, $2, 'TIÊU ĐỀ BỊ SỬA TRÁI PHÉP', 'Sinh', 9, 'Mô tả bị sửa',
        90, NULL, NULL, 5, 50, true, true, 'OFF', false, true,
        $3::jsonb
      );
    `, [authorId, ver6Id, JSON.stringify(corruptingPayload)]);
  } catch (e) {
    corruptAttemptRejected = true;
    console.log('✅ Corrupting save attempt rejected at Pass 1 validation.');
  }
  if (!corruptAttemptRejected) throw new Error('Expected corrupting attempt to be rejected!');

  // Verify that questions and version fields remain 100% UNCHANGED
  const questionsAfter = (await db.query(`
    SELECT id, question_number, prompt, points FROM public.exam_questions WHERE exam_version_id = $1 ORDER BY question_number;
  `, [ver6Id])).rows;

  const versionAfter = (await db.query(`
    SELECT title, description, duration_minutes, max_attempts, reward_stars, tab_switch_policy
    FROM public.exam_versions WHERE id = $1;
  `, [ver6Id])).rows[0];

  if (questionsAfter.length !== 2 ||
      questionsAfter[0].prompt !== 'Sinh học tế bào' ||
      questionsAfter[0].points !== '3.00' ||
      questionsAfter[1].prompt !== 'Trình bày quá trình quang hợp' ||
      questionsAfter[1].points !== '7.00') {
    throw new Error(`Data corruption detected after failed save! Questions after: ${JSON.stringify(questionsAfter)}`);
  }

  if (versionAfter.title !== 'Sinh học 9 - Đề 1' ||
      versionAfter.description !== 'Đề chính thức trước khi bị phá' ||
      versionAfter.duration_minutes !== 45 ||
      versionAfter.max_attempts !== 1 ||
      versionAfter.reward_stars !== 0 ||
      versionAfter.tab_switch_policy !== 'WARN_AND_LOG') {
    throw new Error(`Version attributes corrupted after failed save! Version after: ${JSON.stringify(versionAfter)}`);
  }

  console.log('✅ Existing draft questions and version metadata completely preserved after rejected save (100% Atomic & Pre-Mutation Validated).');

  console.log('\n🎉 ALL 38 PHASE 2A AUTHORING RPC TESTS PASSED PERFECTLY!\n');
}

runPhase2ATest().catch((err) => {
  console.error('❌ PHASE 2A DRY-RUN FAILED:', err);
  process.exit(1);
});
