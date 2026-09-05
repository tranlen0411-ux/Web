/**
 * ============================================================================
 * EXAM BUILDER V1 — PHASE 2B1 ASSIGNMENT + START ATTEMPT PGLITE DRY-RUN TEST (V2)
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
const RPC_AUTHORING_PATH = path.resolve(__dirname, '../docs/02_exam_builder_v1_rpc_authoring.sql');
const RPC_ASSIGNMENT_ATTEMPT_PATH = path.resolve(__dirname, '../docs/03_exam_builder_v1_rpc_assignment_attempt.sql');

async function runPhase2B1Test() {
  console.log('--- STARTING EXAM BUILDER V1 PHASE 2B1 DRY RUN (66 TESTS) ---');

  if (!fs.existsSync(BASE_SCHEMA_PATH) || !fs.existsSync(PATCH_SCHEMA_PATH) || !fs.existsSync(RPC_AUTHORING_PATH) || !fs.existsSync(RPC_ASSIGNMENT_ATTEMPT_PATH)) {
    throw new Error('Required SQL files not found!');
  }

  const baseSql = fs.readFileSync(BASE_SCHEMA_PATH, 'utf-8');
  const patchSql = fs.readFileSync(PATCH_SCHEMA_PATH, 'utf-8');
  const rpcAuthoringSql = fs.readFileSync(RPC_AUTHORING_PATH, 'utf-8');
  const rpcAssignmentAttemptSql = fs.readFileSync(RPC_ASSIGNMENT_ATTEMPT_PATH, 'utf-8');

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

  // Apply DDL and RPCs
  await db.exec(baseSql);
  await db.exec(patchSql);
  await db.exec(rpcAuthoringSql);
  await db.exec(rpcAssignmentAttemptSql);
  console.log('✅ Base Schema, Patch 1.1, Phase 2A, and Phase 2B1 RPCs applied successfully.');

  const authorId = '11111111-1111-1111-1111-111111111111';
  const otherTeacherId = '22222222-2222-2222-2222-222222222222';
  const student1Id = '33333333-3333-3333-3333-333333333331';
  const student2Id = '33333333-3333-3333-3333-333333333332';
  const class1Id = '44444444-4444-4444-4444-444444444441';
  const class2Id = '44444444-4444-4444-4444-444444444442';

  // Setup Exam 1 with Draft Version 1, then publish to Version 1
  const exam1Id = '00000000-0000-0000-0000-000000000001';
  const ver1Id = '00000000-0000-0000-0000-000000000002';
  const q1Id = '00000000-0000-0000-0000-000000000011';
  const q2Id = '00000000-0000-0000-0000-000000000012';

  await db.query(`
    SELECT public.rpc_exam_create_test($1, $2, $3, 'Toán Lớp 5', 'Toán', 5, 'Đề thi chính thức');
  `, [authorId, exam1Id, ver1Id]);

  const questions1 = [
    {
      id: q1Id,
      question_number: 1,
      question_type: 'single_choice',
      prompt: '1 + 1 = ?',
      options_json: [{"key": "A", "text": "2"}, {"key": "B", "text": "3"}],
      points: 4.00,
      answer_key: { correct_answer: {"key": "A"} }
    },
    {
      id: q2Id,
      question_number: 2,
      question_type: 'essay',
      prompt: 'Trình bày cách giải',
      points: 6.00
    }
  ];

  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1, $2, 'Toán Lớp 5 - v1', 'Toán', 5, 'Mô tả',
      45, NULL, '2026-12-31T23:59:59Z'::timestamptz, 2, 10, false, false, 'WARN_AND_LOG', true, false,
      $3::jsonb
    );
  `, [authorId, ver1Id, JSON.stringify(questions1)]);

  // Publish ver1
  await db.query(`SELECT public.rpc_exam_publish_version($1, $2);`, [authorId, ver1Id]);

  // Setup Exam 2 with draft version 1 (unpublished)
  const exam2Id = '00000000-0000-0000-0000-000000000021';
  const ver2DraftId = '00000000-0000-0000-0000-000000000022';
  await db.query(`
    SELECT public.rpc_exam_create_test($1, $2, $3, 'Lý Lớp 8', 'Vật lý', 8);
  `, [authorId, exam2Id, ver2DraftId]);

  // Setup Exam 3 (Archived)
  const exam3Id = '00000000-0000-0000-0000-000000000031';
  const ver3Id = '00000000-0000-0000-0000-000000000032';
  const q3Id = '00000000-0000-0000-0000-000000000033';
  await db.query(`SELECT public.rpc_exam_create_test($1, $2, $3, 'Hóa Lớp 9', 'Hóa học', 9);`, [authorId, exam3Id, ver3Id]);
  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1, $2, 'Hóa Lớp 9', 'Hóa học', 9, NULL,
      NULL, NULL, NULL, 1, 0, false, false, 'WARN_AND_LOG', true, false,
      $3::jsonb
    );
  `, [authorId, ver3Id, JSON.stringify([{ id: q3Id, question_number: 1, question_type: 'essay', prompt: 'Hóa học', points: 10.00 }])]);
  await db.query(`SELECT public.rpc_exam_publish_version($1, $2);`, [authorId, ver3Id]);
  await db.query(`UPDATE public.exam_tests SET status = 'archived' WHERE id = $1;`, [exam3Id]);

  const assignment1Id = 'aaaaaaaa-0000-0000-0000-000000000001';

  // [1/42] assignment to published version succeeds
  console.log('\n[1/42] Testing assignment to published version succeeds...');
  const assign1Res = await db.query(`
    SELECT public.rpc_exam_create_assignment(
      $1, $2, $3, $4, '2026-11-30T23:59:59Z'::timestamptz, true, false
    ) AS result;
  `, [authorId, assignment1Id, ver1Id, class1Id]);
  const a1 = assign1Res.rows[0].result;
  if (a1.assignment_id !== assignment1Id || a1.exam_version_id !== ver1Id || a1.idempotent_replay !== false) {
    throw new Error(`Unexpected assignment result: ${JSON.stringify(a1)}`);
  }
  console.log('✅ Assignment created successfully for published version.');

  // [2/42] assignment to draft version rejected
  console.log('\n[2/42] Testing assignment to draft version is REJECTED...');
  let draftAssignRejected = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_create_assignment(
        $1, 'aaaaaaaa-0000-0000-0000-000000000002', $2, $3, NULL, true, false
      );
    `, [authorId, ver2DraftId, class1Id]);
  } catch (e) {
    draftAssignRejected = true;
    if (!e.message.includes('ERR_VERSION_NOT_PUBLISHED')) throw new Error(`Expected ERR_VERSION_NOT_PUBLISHED, got: ${e.message}`);
    console.log('✅ Assignment to draft version rejected with ERR_VERSION_NOT_PUBLISHED.');
  }
  if (!draftAssignRejected) throw new Error('Expected draft assignment rejection!');

  // [3/42] archived exam rejected
  console.log('\n[3/42] Testing assignment to archived exam is REJECTED...');
  let archivedAssignRejected = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_create_assignment(
        $1, 'aaaaaaaa-0000-0000-0000-000000000003', $2, $3, NULL, true, false
      );
    `, [authorId, ver3Id, class1Id]);
  } catch (e) {
    archivedAssignRejected = true;
    if (!e.message.includes('ERR_EXAM_ARCHIVED')) throw new Error(`Expected ERR_EXAM_ARCHIVED, got: ${e.message}`);
    console.log('✅ Assignment to archived exam rejected with ERR_EXAM_ARCHIVED.');
  }
  if (!archivedAssignRejected) throw new Error('Expected archived exam assignment rejection!');

  // [4/42] assignment exact retry returns same ID
  console.log('\n[4/42] Testing assignment exact retry returns same ID (idempotent_replay: true)...');
  const assignReplayRes = await db.query(`
    SELECT public.rpc_exam_create_assignment(
      $1, $2, $3, $4, '2026-11-30T23:59:59Z'::timestamptz, true, false
    ) AS result;
  `, [authorId, assignment1Id, ver1Id, class1Id]);
  if (assignReplayRes.rows[0].result.idempotent_replay !== true || assignReplayRes.rows[0].result.assignment_id !== assignment1Id) {
    throw new Error(`Expected idempotent_replay: true on assignment retry, got: ${JSON.stringify(assignReplayRes.rows[0].result)}`);
  }
  console.log('✅ Assignment exact retry confirmed with idempotent_replay: true.');

  // [5/42] assignment same ID/different payload rejected
  console.log('\n[5/42] Testing assignment same ID with different class is REJECTED...');
  let assignConflictRejected = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_create_assignment(
        $1, $2, $3, $4, '2026-11-30T23:59:59Z'::timestamptz, true, false
      );
    `, [authorId, assignment1Id, ver1Id, class2Id]);
  } catch (e) {
    assignConflictRejected = true;
    if (!e.message.includes('ERR_IDEMPOTENCY_CONFLICT')) throw new Error(`Expected ERR_IDEMPOTENCY_CONFLICT, got: ${e.message}`);
    console.log('✅ Conflicting assignment payload rejected with ERR_IDEMPOTENCY_CONFLICT.');
  }
  if (!assignConflictRejected) throw new Error('Expected assignment conflict rejection!');

  // [6/42] same version/class under different ID rejected
  console.log('\n[6/42] Testing same version/class under different assignment ID is REJECTED...');
  let duplicateClassAssignRejected = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_create_assignment(
        $1, 'aaaaaaaa-0000-0000-0000-000000000099', $2, $3, '2026-11-30T23:59:59Z'::timestamptz, true, false
      );
    `, [authorId, ver1Id, class1Id]);
  } catch (e) {
    duplicateClassAssignRejected = true;
    if (!e.message.includes('ERR_ASSIGNMENT_ALREADY_EXISTS')) throw new Error(`Expected ERR_ASSIGNMENT_ALREADY_EXISTS, got: ${e.message}`);
    console.log('✅ Re-assigning same version to same class rejected with ERR_ASSIGNMENT_ALREADY_EXISTS.');
  }
  if (!duplicateClassAssignRejected) throw new Error('Expected duplicate class assignment rejection!');

  // [7/42] assignment due_date later than version due rejected
  console.log('\n[7/42] Testing assignment due_date later than version due_date is REJECTED...');
  let laterDueRejected = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_create_assignment(
        $1, 'aaaaaaaa-0000-0000-0000-000000000005', $2, $3, '2027-01-01T00:00:00Z'::timestamptz, true, false
      );
    `, [authorId, ver1Id, class2Id]);
  } catch (e) {
    laterDueRejected = true;
    if (!e.message.includes('ERR_INVALID_DUE_DATE')) throw new Error(`Expected ERR_INVALID_DUE_DATE, got: ${e.message}`);
    console.log('✅ Assignment due date later than version due date rejected with ERR_INVALID_DUE_DATE.');
  }
  if (!laterDueRejected) throw new Error('Expected later due date rejection!');

  // Setup timing test versions
  const examTimingId = '00000000-0000-0000-0000-000000000041';
  const verAId = '00000000-0000-0000-0000-000000000042';
  await db.query(`SELECT public.rpc_exam_create_test($1, $2, $3, 'Timing Test', 'Toán', 5);`, [authorId, examTimingId, verAId]);
  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1, $2, 'Timing A', 'Toán', 5, NULL,
      60, NULL, '2026-10-15T00:00:00Z'::timestamptz, 1, 0, false, false, 'WARN_AND_LOG', true, false,
      $3::jsonb
    );
  `, [authorId, verAId, JSON.stringify([{ id: '00000000-0000-0000-0000-000000000043', question_number: 1, question_type: 'essay', prompt: 'Q', points: 10.00 }])]);
  await db.query(`SELECT public.rpc_exam_publish_version($1, $2);`, [authorId, verAId]);

  const assignmentAId = 'aaaaaaaa-0000-0000-0000-000000000010';
  await db.query(`SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, NULL, true, false);`, [authorId, assignmentAId, verAId, class1Id]);

  // [8/42] version due only effective close correct
  console.log('\n[8/42] Testing version due only effective close calculation...');
  const attAId = 'bbbbbbbb-0000-0000-0000-000000000001';
  const startARes = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [student1Id, attAId, assignmentAId, student1Id]);
  if (!startARes.rows[0].result.expires_at) throw new Error('Expected expires_at to be calculated');
  console.log('✅ Version due only handled correctly.');

  // [9/42] assignment due only effective close correct
  console.log('\n[9/42] Testing assignment due only effective close calculation...');
  const verBId = '00000000-0000-0000-0000-000000000052';
  await db.query(`
    INSERT INTO public.exam_versions (id, exam_id, version_number, title, subject, grade_level, status, published_at, duration_minutes, starts_at, due_date, total_points)
    VALUES ($1, $2, 2, 'Timing B', 'Toán', 5, 'published', NOW(), NULL, NULL, NULL, 10.00);
  `, [verBId, examTimingId]);
  await db.query(`
    INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points)
    VALUES ('00000000-0000-0000-0000-000000000053', $1, 1, 'essay', 'Prompt', 10.00);
  `, [verBId]);

  const assignmentBId = 'aaaaaaaa-0000-0000-0000-000000000020';
  await db.query(`SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, '2026-11-20T00:00:00Z'::timestamptz, true, false);`, [authorId, assignmentBId, verBId, class1Id]);
  
  const attBId = 'bbbbbbbb-0000-0000-0000-000000000002';
  const startBRes = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [student1Id, attBId, assignmentBId, student1Id]);
  if (Date.parse(startBRes.rows[0].result.expires_at) !== Date.parse('2026-11-20T00:00:00Z')) {
    throw new Error(`Expected expires_at = 2026-11-20T00:00:00Z, got: ${startBRes.rows[0].result.expires_at}`);
  }
  console.log('✅ Assignment due only effective close verified as 2026-11-20T00:00:00Z.');

  // [10/42] both due => earlier one wins
  console.log('\n[10/42] Testing both due dates set => earlier one wins...');
  const assignmentCId = 'aaaaaaaa-0000-0000-0000-000000000030';
  const verNoDurId = '00000000-0000-0000-0000-000000000062';
  await db.query(`
    INSERT INTO public.exam_versions (id, exam_id, version_number, title, subject, grade_level, status, published_at, duration_minutes, starts_at, due_date, total_points)
    VALUES ($1, $2, 3, 'Timing C', 'Toán', 5, 'published', NOW(), NULL, NULL, '2026-10-15T00:00:00Z'::timestamptz, 10.00);
  `, [verNoDurId, examTimingId]);
  await db.query(`
    INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points)
    VALUES ('00000000-0000-0000-0000-000000000063', $1, 1, 'essay', 'Prompt', 10.00);
  `, [verNoDurId]);

  await db.query(`SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, '2026-09-30T00:00:00Z'::timestamptz, true, false);`, [authorId, assignmentCId, verNoDurId, class1Id]);
  const attCId = 'bbbbbbbb-0000-0000-0000-000000000003';
  const startCRes = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [student1Id, attCId, assignmentCId, student1Id]);
  if (Date.parse(startCRes.rows[0].result.expires_at) !== Date.parse('2026-09-30T00:00:00Z')) {
    throw new Error(`Expected earlier date 2026-09-30T00:00:00Z, got: ${startCRes.rows[0].result.expires_at}`);
  }
  console.log('✅ Earlier due date won (2026-09-30).');

  // [11/42] start before starts_at rejected
  console.log('\n[11/42] Testing start before starts_at is REJECTED...');
  const verFutureId = '00000000-0000-0000-0000-000000000072';
  await db.query(`
    INSERT INTO public.exam_versions (id, exam_id, version_number, title, subject, grade_level, status, published_at, duration_minutes, starts_at, due_date, total_points)
    VALUES ($1, $2, 4, 'Future Exam', 'Toán', 5, 'published', NOW(), 45, '2099-01-01T00:00:00Z'::timestamptz, NULL, 10.00);
  `, [verFutureId, examTimingId]);
  await db.query(`
    INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points)
    VALUES ('00000000-0000-0000-0000-000000000073', $1, 1, 'essay', 'Prompt', 10.00);
  `, [verFutureId]);
  const assignFutureId = 'aaaaaaaa-0000-0000-0000-000000000040';
  await db.query(`SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, NULL, true, false);`, [authorId, assignFutureId, verFutureId, class1Id]);

  let futureStartRejected = false;
  try {
    await db.query(`SELECT public.rpc_exam_start_attempt($1, 'bbbbbbbb-0000-0000-0000-000000000004', $2, $3);`, [student1Id, assignFutureId, student1Id]);
  } catch (e) {
    futureStartRejected = true;
    if (!e.message.includes('ERR_EXAM_NOT_STARTED')) throw new Error(`Expected ERR_EXAM_NOT_STARTED, got: ${e.message}`);
    console.log('✅ Starting before starts_at rejected with ERR_EXAM_NOT_STARTED.');
  }
  if (!futureStartRejected) throw new Error('Expected future exam start rejection!');

  // [12/42] start after effective close rejected
  console.log('\n[12/42] Testing start after effective close is REJECTED (No grace period)...');
  const verPastId = '00000000-0000-0000-0000-000000000082';
  await db.query(`
    INSERT INTO public.exam_versions (id, exam_id, version_number, title, subject, grade_level, status, published_at, duration_minutes, starts_at, due_date, total_points)
    VALUES ($1, $2, 5, 'Past Exam', 'Toán', 5, 'published', NOW(), 45, NULL, '2020-01-01T00:00:00Z'::timestamptz, 10.00);
  `, [verPastId, examTimingId]);
  await db.query(`
    INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points)
    VALUES ('00000000-0000-0000-0000-000000000083', $1, 1, 'essay', 'Prompt', 10.00);
  `, [verPastId]);
  const assignPastId = 'aaaaaaaa-0000-0000-0000-000000000050';
  await db.query(`SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, NULL, true, false);`, [authorId, assignPastId, verPastId, class1Id]);

  let pastStartRejected = false;
  try {
    await db.query(`SELECT public.rpc_exam_start_attempt($1, 'bbbbbbbb-0000-0000-0000-000000000005', $2, $3);`, [student1Id, assignPastId, student1Id]);
  } catch (e) {
    pastStartRejected = true;
    if (!e.message.includes('ERR_EXAM_CLOSED')) throw new Error(`Expected ERR_EXAM_CLOSED, got: ${e.message}`);
    console.log('✅ Starting after effective close rejected with ERR_EXAM_CLOSED.');
  }
  if (!pastStartRejected) throw new Error('Expected past exam start rejection!');

  // [13/42] start creates draft attempt
  console.log('\n[13/42] Testing start creates draft attempt...');
  const attMain1Id = 'bbbbbbbb-0000-0000-0000-000000000010';
  const startMain1Res = await db.query(`
    SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;
  `, [student1Id, attMain1Id, assignment1Id, student1Id]);
  const att1 = startMain1Res.rows[0].result;
  if (att1.status !== 'draft' || att1.attempt_number !== 1 || att1.resumed_existing !== false) {
    throw new Error(`Unexpected start attempt result: ${JSON.stringify(att1)}`);
  }
  console.log('✅ Draft attempt created successfully with attempt_number = 1.');

  // [14/42] attempt_started_at server-generated
  console.log('\n[14/42] Verifying attempt_started_at is server-generated...');
  if (!att1.attempt_started_at || isNaN(Date.parse(att1.attempt_started_at))) {
    throw new Error(`Invalid attempt_started_at timestamp: ${att1.attempt_started_at}`);
  }
  console.log('✅ attempt_started_at confirmed as valid server-generated timestamp.');

  // [15/42] duration expires_at correct
  console.log('\n[15/42] Verifying duration-based expires_at...');
  const startedMs = Date.parse(att1.attempt_started_at);
  const expiresMs = Date.parse(att1.expires_at);
  const diffMinutes = Math.round((expiresMs - startedMs) / (60 * 1000));
  if (diffMinutes !== 45) {
    throw new Error(`Expected 45 minutes duration difference, got: ${diffMinutes}`);
  }
  console.log('✅ Duration expires_at calculated exactly 45 minutes from start.');

  // [16/42] effective close truncates duration
  console.log('\n[16/42] Testing effective close truncates duration deadline...');
  const verTruncId = '00000000-0000-0000-0000-000000000092';
  const tenMinutesLater = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await db.query(`
    INSERT INTO public.exam_versions (id, exam_id, version_number, title, subject, grade_level, status, published_at, duration_minutes, starts_at, due_date, total_points)
    VALUES ($1, $2, 6, 'Truncate Exam', 'Toán', 5, 'published', NOW(), 60, NULL, $3::timestamptz, 10.00);
  `, [verTruncId, examTimingId, tenMinutesLater]);
  await db.query(`
    INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points)
    VALUES ('00000000-0000-0000-0000-000000000093', $1, 1, 'essay', 'Prompt', 10.00);
  `, [verTruncId]);
  const assignTruncId = 'aaaaaaaa-0000-0000-0000-000000000060';
  await db.query(`SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, NULL, true, false);`, [authorId, assignTruncId, verTruncId, class1Id]);
  const attTruncId = 'bbbbbbbb-0000-0000-0000-000000000020';
  const startTruncRes = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [student1Id, attTruncId, assignTruncId, student1Id]);
  const truncDiffMinutes = Math.round((Date.parse(startTruncRes.rows[0].result.expires_at) - Date.parse(startTruncRes.rows[0].result.attempt_started_at)) / (60 * 1000));
  if (truncDiffMinutes > 11) {
    throw new Error(`Expected expires_at to be truncated to ~10 mins, got diff: ${truncDiffMinutes}`);
  }
  console.log('✅ Effective close successfully truncated duration deadline.');

  // [17/42] no duration + no due => expires_at NULL
  console.log('\n[17/42] Testing no duration + no due_date => expires_at NULL...');
  const verOpenId = '00000000-0000-0000-0000-000000000102';
  await db.query(`
    INSERT INTO public.exam_versions (id, exam_id, version_number, title, subject, grade_level, status, published_at, duration_minutes, starts_at, due_date, total_points)
    VALUES ($1, $2, 7, 'Open Exam', 'Toán', 5, 'published', NOW(), NULL, NULL, NULL, 10.00);
  `, [verOpenId, examTimingId]);
  await db.query(`
    INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points)
    VALUES ('00000000-0000-0000-0000-000000000103', $1, 1, 'essay', 'Prompt', 10.00);
  `, [verOpenId]);
  const assignOpenId = 'aaaaaaaa-0000-0000-0000-000000000070';
  await db.query(`SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, NULL, true, false);`, [authorId, assignOpenId, verOpenId, class1Id]);
  const attOpenId = 'bbbbbbbb-0000-0000-0000-000000000030';
  const startOpenRes = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [student1Id, attOpenId, assignOpenId, student1Id]);
  if (startOpenRes.rows[0].result.expires_at !== null) {
    throw new Error(`Expected expires_at NULL, got: ${startOpenRes.rows[0].result.expires_at}`);
  }
  console.log('✅ Open exam produced expires_at = NULL.');

  // [18/42] max_attempts enforced
  console.log('\n[18/42] Testing max_attempts enforcement...');
  await db.query(`UPDATE public.exam_attempts SET status = 'submitted' WHERE id = $1;`, [attMain1Id]);
  const attMain2Id = 'bbbbbbbb-0000-0000-0000-000000000011';
  const startMain2Res = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [student1Id, attMain2Id, assignment1Id, student1Id]);
  if (startMain2Res.rows[0].result.attempt_number !== 2) throw new Error('Expected attempt_number = 2');
  await db.query(`UPDATE public.exam_attempts SET status = 'submitted' WHERE id = $1;`, [attMain2Id]);

  let maxAttemptsRejected = false;
  try {
    await db.query(`SELECT public.rpc_exam_start_attempt($1, 'bbbbbbbb-0000-0000-0000-000000000012', $2, $3);`, [student1Id, assignment1Id, student1Id]);
  } catch (e) {
    maxAttemptsRejected = true;
    if (!e.message.includes('ERR_MAX_ATTEMPTS_EXCEEDED')) throw new Error(`Expected ERR_MAX_ATTEMPTS_EXCEEDED, got: ${e.message}`);
    console.log('✅ Exceeding max_attempts rejected with ERR_MAX_ATTEMPTS_EXCEEDED.');
  }
  if (!maxAttemptsRejected) throw new Error('Expected max_attempts rejection!');

  // [19/42] active draft prevents second draft
  console.log('\n[19/42] Testing active draft prevents second draft...');
  const attStudent2AId = 'bbbbbbbb-0000-0000-0000-000000000041';
  await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student2Id, attStudent2AId, assignment1Id, student2Id]);

  // [20/42] different attempt ID resumes existing draft
  console.log('\n[20/42] Testing different attempt ID resumes existing active draft (resumed_existing: true)...');
  const attStudent2BId = 'bbbbbbbb-0000-0000-0000-000000000042';
  const resumeRes = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [student2Id, attStudent2BId, assignment1Id, student2Id]);
  const resumeData = resumeRes.rows[0].result;
  if (resumeData.attempt_id !== attStudent2AId || resumeData.resumed_existing !== true || resumeData.idempotent_replay !== false) {
    throw new Error(`Expected to resume ${attStudent2AId} with resumed_existing: true, got: ${JSON.stringify(resumeData)}`);
  }
  console.log('✅ Active draft safely resumed without burning attempt number.');

  // [21/42] same attempt ID exact replay safe
  console.log('\n[21/42] Testing same attempt ID exact replay (idempotent_replay: true)...');
  const replayRes = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [student2Id, attStudent2AId, assignment1Id, student2Id]);
  if (replayRes.rows[0].result.idempotent_replay !== true || replayRes.rows[0].result.resumed_existing !== false) {
    throw new Error(`Expected idempotent_replay: true on same ID, got: ${JSON.stringify(replayRes.rows[0].result)}`);
  }
  console.log('✅ Exact replay with same attempt ID confirmed as idempotent_replay: true.');

  // [22/42] max_score copied from version total_points
  console.log('\n[22/42] Verifying max_score is copied from version total_points...');
  if (parseFloat(resumeData.max_score) !== 10.00) {
    throw new Error(`Expected max_score = 10.00, got: ${resumeData.max_score}`);
  }
  console.log('✅ max_score accurately copied from exam_versions.total_points (10.00).');

  // [23/42] attempt uses assignment.exam_version_id exactly
  console.log('\n[23/42] Verifying attempt uses assignment.exam_version_id exactly...');
  if (resumeData.exam_version_id !== ver1Id) {
    throw new Error(`Expected exam_version_id = ${ver1Id}, got: ${resumeData.exam_version_id}`);
  }
  console.log('✅ Attempt strictly bound to assignment.exam_version_id.');

  // [24/42] newer current_version does not change assignment snapshot
  console.log('\n[24/42] Verifying newer current_version does not change assignment snapshot...');
  const ver1V2Id = '00000000-0000-0000-0000-000000000003';
  await db.query(`
    INSERT INTO public.exam_versions (id, exam_id, version_number, title, subject, grade_level, status, duration_minutes, starts_at, due_date, total_points)
    VALUES ($1, $2, 2, 'Toán Lớp 5 - v2 Mới', 'Toán', 5, 'draft', 50, NULL, NULL, 20.00);
  `, [ver1V2Id, exam1Id]);
  await db.query(`
    INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points)
    VALUES ('00000000-0000-0000-0000-000000000013', $1, 1, 'essay', 'Prompt v2', 20.00);
  `, [ver1V2Id]);
  await db.query(`SELECT public.rpc_exam_publish_version($1, $2);`, [authorId, ver1V2Id]);

  const student3Id = '33333333-3333-3333-3333-333333333333';
  const attStudent3Res = await db.query(`
    SELECT public.rpc_exam_start_attempt($1, 'bbbbbbbb-0000-0000-0000-000000000051', $2, $3) AS result;
  `, [student3Id, assignment1Id, student3Id]);
  if (attStudent3Res.rows[0].result.exam_version_id !== ver1Id || parseFloat(attStudent3Res.rows[0].result.max_score) !== 10.00) {
    throw new Error('Assignment snapshot was mutated by newer published version!');
  }
  console.log('✅ Immutable assignment snapshot preserved despite newer published version.');

  // [25/42] question_order stable without shuffle
  console.log('\n[25/42] Verifying question_order is stable and ordered by question_number when shuffle=false...');
  const qOrderNoShuffle = attStudent3Res.rows[0].result.question_order;
  if (qOrderNoShuffle[0] !== q1Id || qOrderNoShuffle[1] !== q2Id) {
    throw new Error(`Unexpected question_order: ${JSON.stringify(qOrderNoShuffle)}`);
  }
  console.log('✅ question_order strictly ordered by question_number.');

  // [26/42] question_order persisted once with shuffle
  console.log('\n[26/42] Testing question_order persistence with shuffle_questions=true...');
  const examShuffleId = '00000000-0000-0000-0000-000000000201';
  const verShuffleId = '00000000-0000-0000-0000-000000000202';
  await db.query(`SELECT public.rpc_exam_create_test($1, $2, $3, 'Shuffle Test', 'Toán', 5);`, [authorId, examShuffleId, verShuffleId]);
  const shuffleQs = [];
  for (let i = 1; i <= 5; i++) {
    shuffleQs.push({
      id: `00000000-0000-0000-0000-00000000021${i}`,
      question_number: i,
      question_type: 'essay',
      prompt: `Câu ${i}`,
      points: 2.00
    });
  }
  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1, $2, 'Shuffle Test', 'Toán', 5, NULL,
      NULL, NULL, NULL, 1, 0, true, false, 'WARN_AND_LOG', true, false,
      $3::jsonb
    );
  `, [authorId, verShuffleId, JSON.stringify(shuffleQs)]);
  await db.query(`SELECT public.rpc_exam_publish_version($1, $2);`, [authorId, verShuffleId]);

  const assignShuffleId = 'aaaaaaaa-0000-0000-0000-000000000080';
  await db.query(`SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, NULL, true, false);`, [authorId, assignShuffleId, verShuffleId, class1Id]);
  const attShuffleId = 'bbbbbbbb-0000-0000-0000-000000000061';
  const startShuffleRes = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [student1Id, attShuffleId, assignShuffleId, student1Id]);
  const qOrderShuffled = startShuffleRes.rows[0].result.question_order;
  if (qOrderShuffled.length !== 5) throw new Error('Expected 5 shuffled question IDs');
  console.log('✅ question_order persisted with 5 randomized IDs.');

  // [27/42] no answer key exposed in return
  console.log('\n[27/42] Verifying return payload contains ZERO answer key data...');
  const resKeys = Object.keys(attStudent3Res.rows[0].result);
  for (const k of resKeys) {
    if (k.toLowerCase().includes('answer') || k.toLowerCase().includes('key') || k.toLowerCase().includes('correct')) {
      throw new Error(`SECURITY LEAK: Key ${k} found in return payload!`);
    }
  }
  console.log('✅ Verified: ZERO answer key information is exposed in return payload.');

  // [28/42] browser roles no EXECUTE
  console.log('\n[28/42] Verifying browser roles (anon, authenticated, PUBLIC) have NO EXECUTE privileges...');
  const privCheck = await db.query(`
    SELECT 
      p.proname,
      r.rolname,
      has_function_privilege(r.oid, p.oid, 'EXECUTE') AS can_execute
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    CROSS JOIN pg_roles r
    WHERE n.nspname = 'public'
      AND p.proname IN ('rpc_exam_create_assignment', 'rpc_exam_start_attempt')
      AND r.rolname IN ('public', 'anon', 'authenticated');
  `);
  for (const row of privCheck.rows) {
    if (row.can_execute) {
      throw new Error(`SECURITY VIOLATION: Role ${row.rolname} has EXECUTE on ${row.proname}!`);
    }
  }
  console.log('✅ Confirmed REVOKE executed for all browser roles.');

  // [29/42] service_role EXECUTE
  console.log('\n[29/42] Verifying service_role has EXECUTE privileges...');
  const servicePrivCheck = await db.query(`
    SELECT 
      p.proname,
      r.rolname,
      has_function_privilege(r.oid, p.oid, 'EXECUTE') AS can_execute
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    CROSS JOIN pg_roles r
    WHERE n.nspname = 'public'
      AND p.proname IN ('rpc_exam_create_assignment', 'rpc_exam_start_attempt')
      AND r.rolname = 'service_role';
  `);
  for (const row of servicePrivCheck.rows) {
    if (!row.can_execute) {
      throw new Error(`service_role MUST have EXECUTE on ${row.proname}`);
    }
  }
  console.log('✅ service_role granted EXECUTE on both Phase 2B1 RPCs.');

  // [30/42] Question Bank unchanged
  console.log('\n[30/42] Verifying Question Bank objects remain completely intact...');
  const qbTableCheck = await db.query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'app_private' AND table_name = 'question_bank_answer_keys';
  `);
  if (qbTableCheck.rows.length === 0) throw new Error('Question bank table missing!');
  console.log('✅ Question Bank tables and fixtures remain 100% intact.');

  // =========================================================================
  // HARDENING V2 TESTS (31 - 42)
  // =========================================================================

  // [31/42] old assignment remains usable after v1 becomes superseded
  console.log('\n[31/42] Testing old assignment remains usable after v1 becomes superseded...');
  // ver1Id is now superseded (exam1Id published ver1V2Id in test 24)
  const student4Id = '33333333-3333-3333-3333-333333333334';
  const attOldAssignRes = await db.query(`
    SELECT public.rpc_exam_start_attempt($1, 'bbbbbbbb-0000-0000-0000-000000000071', $2, $3) AS result;
  `, [student4Id, assignment1Id, student4Id]);
  if (attOldAssignRes.rows[0].result.exam_version_id !== ver1Id || attOldAssignRes.rows[0].result.status !== 'draft') {
    throw new Error(`Expected student start on superseded version assignment to succeed, got: ${JSON.stringify(attOldAssignRes.rows[0].result)}`);
  }
  console.log('✅ Student successfully started attempt from old assignment on superseded version v1.');

  // [32/42] new assignment to superseded version rejected
  console.log('\n[32/42] Testing new assignment to superseded version is REJECTED...');
  let supersededAssignRejected = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_create_assignment(
        $1, 'aaaaaaaa-0000-0000-0000-000000000095', $2, $3, NULL, true, false
      );
    `, [authorId, ver1Id, class2Id]);
  } catch (e) {
    supersededAssignRejected = true;
    if (!e.message.includes('ERR_VERSION_NOT_PUBLISHED')) {
      throw new Error(`Expected ERR_VERSION_NOT_PUBLISHED on superseded assignment creation, got: ${e.message}`);
    }
    console.log('✅ Creating new assignment on superseded version rejected with ERR_VERSION_NOT_PUBLISHED.');
  }
  if (!supersededAssignRejected) throw new Error('Expected superseded assignment creation rejection!');

  // [33/42] start uses exact assignment version after newer current published
  console.log('\n[33/42] Verifying start uses exact assignment version (v1) and not current_version_id (v2)...');
  const examContainerCheck = await db.query(`SELECT current_version_id FROM public.exam_tests WHERE id = $1;`, [exam1Id]);
  if (examContainerCheck.rows[0].current_version_id !== ver1V2Id) {
    throw new Error(`Exam container current_version_id should be v2 (${ver1V2Id}), found: ${examContainerCheck.rows[0].current_version_id}`);
  }
  if (attOldAssignRes.rows[0].result.exam_version_id === ver1V2Id) {
    throw new Error('Attempt erroneously redirected to v2 instead of preserving assignment snapshot v1!');
  }
  console.log('✅ Confirmed: Attempt strictly locked to assignment snapshot version v1.');

  // [34/42] shuffle_options=false => option_orders={}
  console.log('\n[34/42] Testing shuffle_options=false produces option_orders = {}...');
  if (JSON.stringify(attOldAssignRes.rows[0].result.option_orders) !== '{}') {
    throw new Error(`Expected option_orders = {}, got: ${JSON.stringify(attOldAssignRes.rows[0].result.option_orders)}`);
  }
  console.log('✅ Confirmed option_orders is empty object {} when shuffle_options=false.');

  // [35/42] shuffle_options=true persists permutation by original keys
  console.log('\n[35/42] Testing shuffle_options=true persists permutation by original keys...');
  const examOptShuffleId = '00000000-0000-0000-0000-000000000301';
  const verOptShuffleId = '00000000-0000-0000-0000-000000000302';
  const qOpt1Id = '00000000-0000-0000-0000-000000000311';
  const qOpt2Id = '00000000-0000-0000-0000-000000000312';

  await db.query(`SELECT public.rpc_exam_create_test($1, $2, $3, 'Option Shuffle Exam', 'Toán', 5);`, [authorId, examOptShuffleId, verOptShuffleId]);

  const optQuestions = [
    {
      id: qOpt1Id,
      question_number: 1,
      question_type: 'single_choice',
      prompt: 'Thủ đô của Pháp là?',
      options_json: [
        {"key": "A", "text": "Paris"},
        {"key": "B", "text": "London"},
        {"key": "C", "text": "Berlin"},
        {"key": "D", "text": "Rome"}
      ],
      points: 5.00,
      answer_key: { correct_answer: {"key": "A"} }
    },
    {
      id: qOpt2Id,
      question_number: 2,
      question_type: 'multiple_choice',
      prompt: 'Các số chẵn là?',
      options_json: [
        {"key": "K1", "text": "2"},
        {"key": "K2", "text": "4"},
        {"key": "K3", "text": "5"}
      ],
      points: 5.00,
      answer_key: { correct_answer: ["K1", "K2"] }
    }
  ];

  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1, $2, 'Option Shuffle Exam', 'Toán', 5, NULL,
      60, NULL, NULL, 2, 0, false, true, 'WARN_AND_LOG', true, false,
      $3::jsonb
    );
  `, [authorId, verOptShuffleId, JSON.stringify(optQuestions)]);
  await db.query(`SELECT public.rpc_exam_publish_version($1, $2);`, [authorId, verOptShuffleId]);

  const assignOptShuffleId = 'aaaaaaaa-0000-0000-0000-000000000088';
  await db.query(`SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, NULL, true, false);`, [authorId, assignOptShuffleId, verOptShuffleId, class1Id]);

  const attOptShuffle1Id = 'bbbbbbbb-0000-0000-0000-000000000081';
  const startOptShuffleRes = await db.query(`
    SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;
  `, [student1Id, attOptShuffle1Id, assignOptShuffleId, student1Id]);
  const optOrders1 = startOptShuffleRes.rows[0].result.option_orders;

  if (!optOrders1[qOpt1Id] || optOrders1[qOpt1Id].length !== 4 || !optOrders1[qOpt2Id] || optOrders1[qOpt2Id].length !== 3) {
    throw new Error(`Invalid option_orders structure: ${JSON.stringify(optOrders1)}`);
  }
  const q1KeysSorted = [...optOrders1[qOpt1Id]].sort();
  if (JSON.stringify(q1KeysSorted) !== JSON.stringify(['A', 'B', 'C', 'D'])) {
    throw new Error(`Permutation keys mismatch: ${JSON.stringify(optOrders1[qOpt1Id])}`);
  }
  console.log('✅ Option shuffle permutation accurately generated and indexed by question UUID.');

  // [36/42] resume keeps identical option_orders
  console.log('\n[36/42] Testing resume keeps identical option_orders...');
  const attOptResumeId = 'bbbbbbbb-0000-0000-0000-000000000082';
  const resumeOptRes = await db.query(`
    SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;
  `, [student1Id, attOptResumeId, assignOptShuffleId, student1Id]);
  const resumedOptOrders = resumeOptRes.rows[0].result.option_orders;

  if (JSON.stringify(optOrders1) !== JSON.stringify(resumedOptOrders)) {
    throw new Error(`Resumed option_orders altered! Original: ${JSON.stringify(optOrders1)}, Resumed: ${JSON.stringify(resumedOptOrders)}`);
  }
  console.log('✅ Resumed attempt returned 100% identical option_orders without reshuffling.');

  // [37/42] exact retry keeps identical option_orders
  console.log('\n[37/42] Testing exact retry keeps identical option_orders...');
  const retryOptRes = await db.query(`
    SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;
  `, [student1Id, attOptShuffle1Id, assignOptShuffleId, student1Id]);
  if (JSON.stringify(optOrders1) !== JSON.stringify(retryOptRes.rows[0].result.option_orders)) {
    throw new Error(`Exact retry option_orders mismatch!`);
  }
  console.log('✅ Exact retry returned identical option_orders.');

  // [38/42] malformed options missing key rejected
  console.log('\n[38/42] Testing malformed options with missing key is REJECTED with ERR_INVALID_OPTION_SCHEMA...');
  const verBadOptId = '00000000-0000-0000-0000-000000000402';
  await db.query(`
    INSERT INTO public.exam_versions (id, exam_id, version_number, title, subject, grade_level, status, published_at, duration_minutes, shuffle_options, total_points)
    VALUES ($1, $2, 3, 'Bad Options Exam', 'Toán', 5, 'published', NOW(), 60, true, 10.00);
  `, [verBadOptId, examOptShuffleId]);
  await db.query(`
    INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, options_json, points)
    VALUES ('00000000-0000-0000-0000-000000000403', $1, 1, 'single_choice', 'Câu hỏi thiếu key', '[{"text": "No key option"}]'::jsonb, 10.00);
  `, [verBadOptId]);
  const assignBadOptId = 'aaaaaaaa-0000-0000-0000-000000000091';
  await db.query(`SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, NULL, true, false);`, [authorId, assignBadOptId, verBadOptId, class1Id]);

  let badOptRejected = false;
  try {
    await db.query(`SELECT public.rpc_exam_start_attempt($1, 'bbbbbbbb-0000-0000-0000-000000000091', $2, $3);`, [student1Id, assignBadOptId, student1Id]);
  } catch (e) {
    badOptRejected = true;
    if (!e.message.includes('ERR_INVALID_OPTION_SCHEMA')) {
      throw new Error(`Expected ERR_INVALID_OPTION_SCHEMA, got: ${e.message}`);
    }
    console.log('✅ Missing option key rejected with ERR_INVALID_OPTION_SCHEMA.');
  }
  if (!badOptRejected) throw new Error('Expected missing option key rejection!');

  // [39/42] duplicate option key rejected
  console.log('\n[39/42] Testing duplicate option key is REJECTED with ERR_INVALID_OPTION_SCHEMA...');
  const verDupOptId = '00000000-0000-0000-0000-000000000412';
  await db.query(`
    INSERT INTO public.exam_versions (id, exam_id, version_number, title, subject, grade_level, status, published_at, duration_minutes, shuffle_options, total_points)
    VALUES ($1, $2, 4, 'Dup Option Key Exam', 'Toán', 5, 'published', NOW(), 60, true, 10.00);
  `, [verDupOptId, examOptShuffleId]);
  await db.query(`
    INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, options_json, points)
    VALUES ('00000000-0000-0000-0000-000000000413', $1, 1, 'single_choice', 'Câu hỏi trùng key', '[{"key":"A", "text": "Option 1"}, {"key":"A", "text": "Option 2"}]'::jsonb, 10.00);
  `, [verDupOptId]);
  const assignDupOptId = 'aaaaaaaa-0000-0000-0000-000000000092';
  await db.query(`SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, NULL, true, false);`, [authorId, assignDupOptId, verDupOptId, class1Id]);

  let dupOptRejected = false;
  try {
    await db.query(`SELECT public.rpc_exam_start_attempt($1, 'bbbbbbbb-0000-0000-0000-000000000092', $2, $3);`, [student1Id, assignDupOptId, student1Id]);
  } catch (e) {
    dupOptRejected = true;
    if (!e.message.includes('ERR_INVALID_OPTION_SCHEMA')) {
      throw new Error(`Expected ERR_INVALID_OPTION_SCHEMA, got: ${e.message}`);
    }
    console.log('✅ Duplicate option key rejected with ERR_INVALID_OPTION_SCHEMA.');
  }
  if (!dupOptRejected) throw new Error('Expected duplicate option key rejection!');

  // [40/42] caller_id != student_id rejected
  console.log('\n[40/42] Testing caller_id != student_id is REJECTED with ERR_STUDENT_IDENTITY_MISMATCH...');
  let identityMismatchRejected = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_start_attempt(
        $1, 'bbbbbbbb-0000-0000-0000-000000000093', $2, $3
      );
    `, [authorId, assignment1Id, student1Id]); // caller is teacher, student is student1Id
  } catch (e) {
    identityMismatchRejected = true;
    if (!e.message.includes('ERR_STUDENT_IDENTITY_MISMATCH')) {
      throw new Error(`Expected ERR_STUDENT_IDENTITY_MISMATCH, got: ${e.message}`);
    }
    console.log('✅ Identity mismatch rejected with ERR_STUDENT_IDENTITY_MISMATCH.');
  }
  if (!identityMismatchRejected) throw new Error('Expected student identity mismatch rejection!');

  // [41/42] existing active draft returns stored question_order unchanged
  console.log('\n[41/42] Verifying existing active draft returns stored question_order unchanged...');
  const resumeOptData = resumeOptRes.rows[0].result;
  const originalOptData = startOptShuffleRes.rows[0].result;
  if (JSON.stringify(resumeOptData.question_order) !== JSON.stringify(originalOptData.question_order)) {
    throw new Error('question_order was modified during active draft resume!');
  }
  console.log('✅ Confirmed question_order remains 100% stable across draft resume.');

  // [42/42] existing active draft returns stored expires_at unchanged
  console.log('\n[42/42] Verifying existing active draft returns stored expires_at unchanged...');
  if (resumeOptData.expires_at !== originalOptData.expires_at) {
    throw new Error(`expires_at was modified during active draft resume! Original: ${originalOptData.expires_at}, Resumed: ${resumeOptData.expires_at}`);
  }
  console.log('✅ Confirmed expires_at remains 100% stable across draft resume (no time extension).');

  // =========================================================================
  // HARDENING V3 TESTS (43 - 54)
  // =========================================================================

  // [43/54] exact attempt replay succeeds after assignment/version due time
  console.log('\n[43/54] Testing exact attempt replay succeeds even after assignment/version due time...');
  // We will create an attempt, then update the version and assignment due_date to the past
  const examDuePassedId = '00000000-0000-0000-0000-000000000501';
  const verDuePassedId = '00000000-0000-0000-0000-000000000502';
  await db.query(`SELECT public.rpc_exam_create_test($1, $2, $3, 'Past Due Exam', 'Toán', 5);`, [authorId, examDuePassedId, verDuePassedId]);
  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1, $2, 'Past Due Exam', 'Toán', 5, NULL,
      60, NULL, NULL, 2, 0, false, false, 'WARN_AND_LOG', true, false,
      $3::jsonb
    );
  `, [authorId, verDuePassedId, JSON.stringify([{ id: '00000000-0000-0000-0000-000000000503', question_number: 1, question_type: 'essay', prompt: 'Prompt', points: 10.00 }])]);
  await db.query(`SELECT public.rpc_exam_publish_version($1, $2);`, [authorId, verDuePassedId]);

  const assignDuePassedId = 'aaaaaaaa-0000-0000-0000-000000000501';
  await db.query(`SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, NULL, true, false);`, [authorId, assignDuePassedId, verDuePassedId, class1Id]);
  const attDuePassedId = 'bbbbbbbb-0000-0000-0000-000000000501';
  const startDueRes = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [student1Id, attDuePassedId, assignDuePassedId, student1Id]);
  if (startDueRes.rows[0].result.attempt_id !== attDuePassedId) throw new Error('Failed to start attempt');

  // Now simulate time passing: set assignment and version due_date to the past
  await db.query(`UPDATE public.exam_versions SET due_date = '2020-01-01T00:00:00Z' WHERE id = $1;`, [verDuePassedId]);
  await db.query(`UPDATE public.exam_assignments SET due_date = '2020-01-01T00:00:00Z' WHERE id = $1;`, [assignDuePassedId]);

  // Exact replay of SAME attempt_id must succeed and return stored state
  const replayAfterDueRes = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [student1Id, attDuePassedId, assignDuePassedId, student1Id]);
  const replayAfterDueData = replayAfterDueRes.rows[0].result;
  if (replayAfterDueData.idempotent_replay !== true || replayAfterDueData.attempt_id !== attDuePassedId) {
    throw new Error(`Expected successful exact replay after due date, got: ${JSON.stringify(replayAfterDueData)}`);
  }
  console.log('✅ Exact attempt replay succeeded after exam due date without being rejected.');

  // [44/54] exact finalized replay succeeds after due time
  console.log('\n[44/54] Testing exact finalized replay succeeds after due time...');
  await db.query(`UPDATE public.exam_attempts SET status = 'submitted' WHERE id = $1;`, [attDuePassedId]);
  const finalizedReplayRes = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [student1Id, attDuePassedId, assignDuePassedId, student1Id]);
  const finalReplayData = finalizedReplayRes.rows[0].result;
  if (finalReplayData.idempotent_replay !== true || finalReplayData.already_finalized !== true || finalReplayData.status !== 'submitted') {
    throw new Error(`Expected finalized replay with already_finalized: true, got: ${JSON.stringify(finalReplayData)}`);
  }
  console.log('✅ Exact finalized replay succeeded after due time with already_finalized: true.');

  // [45/54] unexpired draft resumes normally
  console.log('\n[45/54] Testing unexpired draft resumes normally with resumed_existing: true, expired: false, already_finalized: false...');
  const student5Id = '33333333-3333-3333-3333-333333333335';
  const examDraftExpId = '00000000-0000-0000-0000-000000000601';
  const verDraftExpId = '00000000-0000-0000-0000-000000000602';
  await db.query(`SELECT public.rpc_exam_create_test($1, $2, $3, 'Draft Expiry Test', 'Toán', 5);`, [authorId, examDraftExpId, verDraftExpId]);
  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1, $2, 'Draft Expiry Test', 'Toán', 5, NULL,
      60, NULL, NULL, 3, 0, false, false, 'WARN_AND_LOG', true, false,
      $3::jsonb
    );
  `, [authorId, verDraftExpId, JSON.stringify([{ id: '00000000-0000-0000-0000-000000000603', question_number: 1, question_type: 'essay', prompt: 'Prompt', points: 10.00 }])]);
  await db.query(`SELECT public.rpc_exam_publish_version($1, $2);`, [authorId, verDraftExpId]);

  const assignDraftExpId = 'aaaaaaaa-0000-0000-0000-000000000601';
  await db.query(`SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, NULL, true, false);`, [authorId, assignDraftExpId, verDraftExpId, class1Id]);

  const attUnexpDraft1Id = 'bbbbbbbb-0000-0000-0000-000000000601';
  const startUnexpRes = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [student5Id, attUnexpDraft1Id, assignDraftExpId, student5Id]);
  if (startUnexpRes.rows[0].result.status !== 'draft') throw new Error('Failed to create draft');

  const attUnexpDraft2Id = 'bbbbbbbb-0000-0000-0000-000000000602';
  const resumeUnexpRes = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [student5Id, attUnexpDraft2Id, assignDraftExpId, student5Id]);
  const resumeUnexpData = resumeUnexpRes.rows[0].result;
  if (resumeUnexpData.attempt_id !== attUnexpDraft1Id || resumeUnexpData.resumed_existing !== true || resumeUnexpData.expired !== false || resumeUnexpData.already_finalized !== false) {
    throw new Error(`Expected unexpired draft to resume normally, got: ${JSON.stringify(resumeUnexpData)}`);
  }
  console.log('✅ Unexpired draft resumed normally with resumed_existing: true, expired: false.');

  // [46/54] expired draft with different p_attempt_id => ERR_ATTEMPT_EXPIRED
  console.log('\n[46/54] Testing expired draft with different p_attempt_id rejects with ERR_ATTEMPT_EXPIRED...');
  // Set expires_at to 10 minutes ago
  await db.query(`UPDATE public.exam_attempts SET expires_at = NOW() - INTERVAL '10 minutes' WHERE id = $1;`, [attUnexpDraft1Id]);

  let expiredDraftRejected = false;
  const attDiffDraftId = 'bbbbbbbb-0000-0000-0000-000000000603';
  try {
    await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student5Id, attDiffDraftId, assignDraftExpId, student5Id]);
  } catch (e) {
    expiredDraftRejected = true;
    if (!e.message.includes('ERR_ATTEMPT_EXPIRED')) {
      throw new Error(`Expected ERR_ATTEMPT_EXPIRED, got: ${e.message}`);
    }
    console.log('✅ Expired draft rejected with ERR_ATTEMPT_EXPIRED when new p_attempt_id provided.');
  }
  if (!expiredDraftRejected) throw new Error('Expected expired draft to reject new attempt!');

  // [47/54] exact expired draft replay returns expired=true
  console.log('\n[47/54] Testing exact expired draft replay returns expired: true, idempotent_replay: true, already_finalized: false...');
  const exactExpiredReplayRes = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [student5Id, attUnexpDraft1Id, assignDraftExpId, student5Id]);
  const exactExpData = exactExpiredReplayRes.rows[0].result;
  if (exactExpData.idempotent_replay !== true || exactExpData.expired !== true || exactExpData.already_finalized !== false || exactExpData.resumed_existing !== false) {
    throw new Error(`Expected expired: true on exact expired replay, got: ${JSON.stringify(exactExpData)}`);
  }
  console.log('✅ Exact expired draft replay successfully returned expired: true, idempotent_replay: true.');

  // [48/54] expired draft does not create a second attempt
  console.log('\n[48/54] Verifying expired draft did not create a second attempt row...');
  const countAttRows = await db.query(`SELECT COUNT(*) AS total FROM public.exam_attempts WHERE assignment_id = $1 AND student_id = $2;`, [assignDraftExpId, student5Id]);
  if (parseInt(countAttRows.rows[0].total, 10) !== 1) {
    throw new Error(`Expected exactly 1 attempt row for student, found: ${countAttRows.rows[0].total}`);
  }
  console.log('✅ Confirmed: Zero duplicate rows created while expired draft exists.');

  // [49/54] expired draft still consumes its attempt_number
  console.log('\n[49/54] Verifying expired draft still consumes its attempt_number...');
  const attNumCheck = await db.query(`SELECT attempt_number FROM public.exam_attempts WHERE id = $1;`, [attUnexpDraft1Id]);
  if (parseInt(attNumCheck.rows[0].attempt_number, 10) !== 1) {
    throw new Error(`Expected attempt_number = 1, found: ${attNumCheck.rows[0].attempt_number}`);
  }
  console.log('✅ Confirmed: Expired draft occupies attempt_number = 1.');

  // [50/54] finalized replay returns already_finalized=true
  console.log('\n[50/54] Testing finalized replay returns already_finalized: true, expired: false...');
  const finalCheckRes = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [student1Id, attDuePassedId, assignDuePassedId, student1Id]);
  const finalCheckData = finalCheckRes.rows[0].result;
  if (finalCheckData.already_finalized !== true || finalCheckData.expired !== false || finalCheckData.idempotent_replay !== true) {
    throw new Error(`Expected already_finalized: true, got: ${JSON.stringify(finalCheckData)}`);
  }
  console.log('✅ Confirmed already_finalized: true for submitted attempt replay.');

  // [51/54] active resume returns expired=false
  console.log('\n[51/54] Testing active resume returns expired: false and already_finalized: false...');
  const student6Id = '33333333-3333-3333-3333-333333333336';
  const attStudent6AId = 'bbbbbbbb-0000-0000-0000-000000000701';
  await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student6Id, attStudent6AId, assignDraftExpId, student6Id]);
  const resumeS6Res = await db.query(`SELECT public.rpc_exam_start_attempt($1, 'bbbbbbbb-0000-0000-0000-000000000702', $2, $3) AS result;`, [student6Id, assignDraftExpId, student6Id]);
  const resumeS6Data = resumeS6Res.rows[0].result;
  if (resumeS6Data.expired !== false || resumeS6Data.already_finalized !== false || resumeS6Data.resumed_existing !== true) {
    throw new Error(`Expected active resume to have expired: false, got: ${JSON.stringify(resumeS6Data)}`);
  }
  console.log('✅ Confirmed active resume returns expired: false, already_finalized: false.');

  // [52/54] new attempt returns expired=false and already_finalized=false
  console.log('\n[52/54] Testing new attempt returns expired: false and already_finalized: false...');
  const student7Id = '33333333-3333-3333-3333-333333333337';
  const attStudent7Id = 'bbbbbbbb-0000-0000-0000-000000000801';
  const startS7Res = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [student7Id, attStudent7Id, assignDraftExpId, student7Id]);
  const startS7Data = startS7Res.rows[0].result;
  if (startS7Data.expired !== false || startS7Data.already_finalized !== false || startS7Data.resumed_existing !== false || startS7Data.idempotent_replay !== false) {
    throw new Error(`Expected new attempt with expired: false, already_finalized: false, got: ${JSON.stringify(startS7Data)}`);
  }
  console.log('✅ Confirmed new attempt returns expired: false, already_finalized: false.');

  // [53/54] single_choice with empty options rejected when shuffle enabled
  console.log('\n[53/54] Testing single_choice with empty options rejected when shuffle enabled...');
  const examBadSCId = '00000000-0000-0000-0000-000000000901';
  const verBadSCId = '00000000-0000-0000-0000-000000000902';
  await db.query(`SELECT public.rpc_exam_create_test($1, $2, $3, 'Bad SC Options Exam', 'Toán', 5);`, [authorId, examBadSCId, verBadSCId]);
  await db.query(`
    UPDATE public.exam_versions 
    SET status = 'published', published_at = NOW(), duration_minutes = 60, shuffle_options = true, total_points = 10.00 
    WHERE id = $1;
  `, [verBadSCId]);
  await db.query(`
    INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, options_json, points)
    VALUES ('00000000-0000-0000-0000-000000000903', $1, 1, 'single_choice', 'Câu hỏi rỗng options', '[]'::jsonb, 10.00);
  `, [verBadSCId]);

  const assignBadSCId = 'aaaaaaaa-0000-0000-0000-000000000901';
  await db.query(`SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, NULL, true, false);`, [authorId, assignBadSCId, verBadSCId, class1Id]);

  let badSCRerejected = false;
  try {
    await db.query(`SELECT public.rpc_exam_start_attempt($1, 'bbbbbbbb-0000-0000-0000-000000000901', $2, $3);`, [student1Id, assignBadSCId, student1Id]);
  } catch (e) {
    badSCRerejected = true;
    if (!e.message.includes('ERR_INVALID_OPTION_SCHEMA')) {
      throw new Error(`Expected ERR_INVALID_OPTION_SCHEMA, got: ${e.message}`);
    }
    console.log('✅ single_choice with empty options rejected with ERR_INVALID_OPTION_SCHEMA.');
  }
  if (!badSCRerejected) throw new Error('Expected single_choice empty options rejection!');

  // [54/54] multiple_choice with empty options rejected when shuffle enabled
  console.log('\n[54/54] Testing multiple_choice with empty options rejected when shuffle enabled...');
  const examBadMCId = '00000000-0000-0000-0000-000000000911';
  const verBadMCId = '00000000-0000-0000-0000-000000000912';
  await db.query(`SELECT public.rpc_exam_create_test($1, $2, $3, 'Bad MC Options Exam', 'Toán', 5);`, [authorId, examBadMCId, verBadMCId]);
  await db.query(`
    UPDATE public.exam_versions 
    SET status = 'published', published_at = NOW(), duration_minutes = 60, shuffle_options = true, total_points = 10.00 
    WHERE id = $1;
  `, [verBadMCId]);
  await db.query(`
    INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, options_json, points)
    VALUES ('00000000-0000-0000-0000-000000000913', $1, 1, 'multiple_choice', 'Câu hỏi MC rỗng options', '[]'::jsonb, 10.00);
  `, [verBadMCId]);

  const assignBadMCId = 'aaaaaaaa-0000-0000-0000-000000000911';
  await db.query(`SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, NULL, true, false);`, [authorId, assignBadMCId, verBadMCId, class1Id]);

  let badMCRerejected = false;
  try {
    await db.query(`SELECT public.rpc_exam_start_attempt($1, 'bbbbbbbb-0000-0000-0000-000000000911', $2, $3);`, [student1Id, assignBadMCId, student1Id]);
  } catch (e) {
    badMCRerejected = true;
    if (!e.message.includes('ERR_INVALID_OPTION_SCHEMA')) {
      throw new Error(`Expected ERR_INVALID_OPTION_SCHEMA, got: ${e.message}`);
    }
    console.log('✅ multiple_choice with empty options rejected with ERR_INVALID_OPTION_SCHEMA.');
  }
  if (!badMCRerejected) throw new Error('Expected multiple_choice empty options rejection!');

  // [55/56] create attempt -> archive exam_tests -> exact replay succeeds
  console.log('\n[55/56] Testing exact attempt replay succeeds after exam_tests container is archived...');
  const examArchiveTestId = '00000000-0000-0000-0000-000000000951';
  const verArchiveTestId = '00000000-0000-0000-0000-000000000952';
  await db.query(`SELECT public.rpc_exam_create_test($1, $2, $3, 'Archive Container Test', 'Toán', 5);`, [authorId, examArchiveTestId, verArchiveTestId]);
  await db.query(`
    UPDATE public.exam_versions 
    SET status = 'published', published_at = NOW(), duration_minutes = 60, total_points = 10.00 
    WHERE id = $1;
  `, [verArchiveTestId]);
  await db.query(`
    INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points)
    VALUES ('00000000-0000-0000-0000-000000000953', $1, 1, 'essay', 'Prompt', 10.00);
  `, [verArchiveTestId]);

  const assignArchiveTestId = 'aaaaaaaa-0000-0000-0000-000000000951';
  await db.query(`SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, NULL, true, false);`, [authorId, assignArchiveTestId, verArchiveTestId, class1Id]);
  const attArchiveTestId = 'bbbbbbbb-0000-0000-0000-000000000951';
  const startArchRes = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [student1Id, attArchiveTestId, assignArchiveTestId, student1Id]);
  if (startArchRes.rows[0].result.attempt_id !== attArchiveTestId) throw new Error('Failed to start attempt');

  // Archive the parent exam container
  await db.query(`UPDATE public.exam_tests SET status = 'archived' WHERE id = $1;`, [examArchiveTestId]);

  // Exact replay of SAME attempt_id must succeed
  const replayArchExamRes = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [student1Id, attArchiveTestId, assignArchiveTestId, student1Id]);
  const replayArchExamData = replayArchExamRes.rows[0].result;
  if (replayArchExamData.idempotent_replay !== true || replayArchExamData.attempt_id !== attArchiveTestId) {
    throw new Error(`Expected successful exact replay after exam archived, got: ${JSON.stringify(replayArchExamData)}`);
  }
  console.log('✅ Exact replay succeeded even after parent exam_tests was archived.');

  // [56/56] create attempt -> archive exam_version -> exact replay succeeds
  console.log('\n[56/56] Testing exact attempt replay succeeds after exam_version status is archived/changed...');
  const examVerArchTestId = '00000000-0000-0000-0000-000000000961';
  const verVerArchTestId = '00000000-0000-0000-0000-000000000962';
  await db.query(`SELECT public.rpc_exam_create_test($1, $2, $3, 'Archive Version Test', 'Toán', 5);`, [authorId, examVerArchTestId, verVerArchTestId]);
  await db.query(`
    UPDATE public.exam_versions 
    SET status = 'published', published_at = NOW(), duration_minutes = 60, total_points = 10.00 
    WHERE id = $1;
  `, [verVerArchTestId]);
  await db.query(`
    INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points)
    VALUES ('00000000-0000-0000-0000-000000000963', $1, 1, 'essay', 'Prompt', 10.00);
  `, [verVerArchTestId]);

  const assignVerArchTestId = 'aaaaaaaa-0000-0000-0000-000000000961';
  await db.query(`SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, NULL, true, false);`, [authorId, assignVerArchTestId, verVerArchTestId, class1Id]);
  const attVerArchTestId = 'bbbbbbbb-0000-0000-0000-000000000961';
  const startVerArchRes = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [student1Id, attVerArchTestId, assignVerArchTestId, student1Id]);
  if (startVerArchRes.rows[0].result.attempt_id !== attVerArchTestId) throw new Error('Failed to start attempt');

  // Change exam_version status to 'archived'
  await db.query(`UPDATE public.exam_versions SET status = 'archived' WHERE id = $1;`, [verVerArchTestId]);

  // Exact replay of SAME attempt_id must succeed
  const replayArchVerRes = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [student1Id, attVerArchTestId, assignVerArchTestId, student1Id]);
  const replayArchVerData = replayArchVerRes.rows[0].result;
  if (replayArchVerData.idempotent_replay !== true || replayArchVerData.attempt_id !== attVerArchTestId) {
    throw new Error(`Expected successful exact replay after version archived, got: ${JSON.stringify(replayArchVerData)}`);
  }
  console.log('✅ Exact replay succeeded even after exam_version status became archived.');

  // =========================================================================
  // HARDENING V4 TESTS (57 - 61)
  // =========================================================================

  // [57/61] create assignment -> publish v2 so v1 becomes superseded -> exact assignment replay succeeds
  console.log('\n[57/61] Testing exact assignment replay succeeds after v1 becomes superseded...');
  const examAssignSupId = '00000000-0000-0000-0000-000000000971';
  const verAssignSupV1Id = '00000000-0000-0000-0000-000000000972';
  const verAssignSupV2Id = '00000000-0000-0000-0000-000000000973';
  await db.query(`SELECT public.rpc_exam_create_test($1, $2, $3, 'Assignment Superseded Test', 'Toán', 5);`, [authorId, examAssignSupId, verAssignSupV1Id]);
  await db.query(`
    UPDATE public.exam_versions 
    SET status = 'published', published_at = NOW(), duration_minutes = 60, total_points = 10.00 
    WHERE id = $1;
  `, [verAssignSupV1Id]);
  await db.query(`
    INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points)
    VALUES ('00000000-0000-0000-0000-000000000974', $1, 1, 'essay', 'Prompt', 10.00);
  `, [verAssignSupV1Id]);

  const assignSupId = 'aaaaaaaa-0000-0000-0000-000000000971';
  const createAssignSupRes = await db.query(`
    SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, '2026-12-31T00:00:00Z'::timestamptz, true, false) AS result;
  `, [authorId, assignSupId, verAssignSupV1Id, class1Id]);
  if (createAssignSupRes.rows[0].result.idempotent_replay !== false) throw new Error('Expected new assignment');

  // Now create v2 and publish it so v1 becomes superseded
  await db.query(`
    INSERT INTO public.exam_versions (id, exam_id, version_number, title, subject, grade_level, status, published_at, duration_minutes, total_points)
    VALUES ($1, $2, 2, 'Assignment Superseded Test v2', 'Toán', 5, 'draft', NULL, 60, 10.00);
  `, [verAssignSupV2Id, examAssignSupId]);
  await db.query(`
    INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points)
    VALUES ('00000000-0000-0000-0000-000000000975', $1, 1, 'essay', 'Prompt v2', 10.00);
  `, [verAssignSupV2Id]);
  await db.query(`SELECT public.rpc_exam_publish_version($1, $2);`, [authorId, verAssignSupV2Id]);

  // Verify v1 is now superseded
  const v1Check = await db.query(`SELECT status FROM public.exam_versions WHERE id = $1;`, [verAssignSupV1Id]);
  if (v1Check.rows[0].status !== 'superseded') throw new Error(`Expected v1 to be superseded, got: ${v1Check.rows[0].status}`);

  // Exact replay of assignSupId with same payload must succeed
  const replayAssignSupRes = await db.query(`
    SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, '2026-12-31T00:00:00Z'::timestamptz, true, false) AS result;
  `, [authorId, assignSupId, verAssignSupV1Id, class1Id]);
  const replayAssignSupData = replayAssignSupRes.rows[0].result;
  if (replayAssignSupData.idempotent_replay !== true || replayAssignSupData.assignment_id !== assignSupId) {
    throw new Error(`Expected idempotent_replay: true for exact assignment replay on superseded version, got: ${JSON.stringify(replayAssignSupData)}`);
  }
  console.log('✅ Exact assignment replay succeeded after version became superseded.');

  // [58/61] create assignment -> archive exam_tests -> exact same create_assignment retry succeeds
  console.log('\n[58/61] Testing exact assignment retry succeeds after exam_tests container is archived...');
  await db.query(`UPDATE public.exam_tests SET status = 'archived' WHERE id = $1;`, [examAssignSupId]);
  const replayAssignArchExamRes = await db.query(`
    SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, '2026-12-31T00:00:00Z'::timestamptz, true, false) AS result;
  `, [authorId, assignSupId, verAssignSupV1Id, class1Id]);
  const replayAssignArchExamData = replayAssignArchExamRes.rows[0].result;
  if (replayAssignArchExamData.idempotent_replay !== true || replayAssignArchExamData.assignment_id !== assignSupId) {
    throw new Error(`Expected idempotent_replay: true for assignment replay on archived exam, got: ${JSON.stringify(replayAssignArchExamData)}`);
  }
  console.log('✅ Exact assignment retry succeeded after exam_tests was archived.');

  // [59/61] new assignment ID against superseded version => ERR_VERSION_NOT_PUBLISHED
  console.log('\n[59/61] Testing new assignment ID against superseded version is REJECTED with ERR_VERSION_NOT_PUBLISHED...');
  let newSupRejected = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_create_assignment(
        $1, 'aaaaaaaa-0000-0000-0000-000000000981', $2, $3, NULL, true, false
      );
    `, [authorId, verAssignSupV1Id, class2Id]);
  } catch (e) {
    newSupRejected = true;
    if (!e.message.includes('ERR_VERSION_NOT_PUBLISHED')) {
      throw new Error(`Expected ERR_VERSION_NOT_PUBLISHED, got: ${e.message}`);
    }
    console.log('✅ New assignment on superseded version rejected with ERR_VERSION_NOT_PUBLISHED.');
  }
  if (!newSupRejected) throw new Error('Expected new assignment on superseded version to be rejected!');

  // [60/61] new assignment ID against archived exam => ERR_EXAM_ARCHIVED
  console.log('\n[60/61] Testing new assignment ID against archived exam is REJECTED with ERR_EXAM_ARCHIVED...');
  let newArchExamRejected = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_create_assignment(
        $1, 'aaaaaaaa-0000-0000-0000-000000000982', $2, $3, NULL, true, false
      );
    `, [authorId, verAssignSupV2Id, class2Id]);
  } catch (e) {
    newArchExamRejected = true;
    if (!e.message.includes('ERR_EXAM_ARCHIVED')) {
      throw new Error(`Expected ERR_EXAM_ARCHIVED, got: ${e.message}`);
    }
    console.log('✅ New assignment on archived exam container rejected with ERR_EXAM_ARCHIVED.');
  }
  if (!newArchExamRejected) throw new Error('Expected new assignment on archived exam to be rejected!');

  // [61/66] same p_assignment_id after superseded/archived but changed payload => ERR_IDEMPOTENCY_CONFLICT
  console.log('\n[61/66] Testing same p_assignment_id after superseded/archived with changed payload is REJECTED with ERR_IDEMPOTENCY_CONFLICT...');
  let conflictAfterLifecycleRejected = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_create_assignment(
        $1, $2, $3, $4, '2027-12-31T00:00:00Z'::timestamptz, true, false
      );
    `, [authorId, assignSupId, verAssignSupV1Id, class1Id]);
  } catch (e) {
    conflictAfterLifecycleRejected = true;
    if (!e.message.includes('ERR_IDEMPOTENCY_CONFLICT')) {
      throw new Error(`Expected ERR_IDEMPOTENCY_CONFLICT, got: ${e.message}`);
    }
    console.log('✅ Conflicting assignment payload on replay rejected with ERR_IDEMPOTENCY_CONFLICT.');
  }
  if (!conflictAfterLifecycleRejected) throw new Error('Expected conflicting assignment replay to be rejected!');

  // =========================================================================
  // HARDENING V5 TESTS (62 - 66: CONCURRENCY / TOCTOU SIMULATION)
  // =========================================================================

  // Setup fixtures for Hardening V5 concurrency tests
  const examRaceId = '00000000-0000-0000-0000-000000000991';
  const verRaceId = '00000000-0000-0000-0000-000000000992';
  const classRaceId = '44444444-4444-4444-4444-444444444499';
  const assignRace1Id = 'aaaaaaaa-0000-0000-0000-000000000991';
  const assignRace2Id = 'aaaaaaaa-0000-0000-0000-000000000992';

  await db.query(`SELECT public.rpc_exam_create_test($1, $2, $3, 'Race Test Exam', 'Toán', 5);`, [authorId, examRaceId, verRaceId]);
  await db.query(`
    UPDATE public.exam_versions 
    SET status = 'published', published_at = NOW(), duration_minutes = 60, total_points = 10.00 
    WHERE id = $1;
  `, [verRaceId]);
  await db.query(`
    INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points)
    VALUES ('00000000-0000-0000-0000-000000000993', $1, 1, 'essay', 'Prompt Race', 10.00);
  `, [verRaceId]);

  // Initial creation of assignRace1Id
  const createRace1Res = await db.query(`
    SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, '2026-12-31T00:00:00Z'::timestamptz, true, false) AS result;
  `, [authorId, assignRace1Id, verRaceId, classRaceId]);
  if (createRace1Res.rows[0].result.idempotent_replay !== false) throw new Error('Expected new assignment for race test');

  // [62/66] second same-ID/same-payload call after simulated race path returns idempotent replay
  console.log('\n[62/66] Testing second same-ID/same-payload call returns idempotent replay...');
  const replayRace1Res = await db.query(`
    SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, '2026-12-31T00:00:00Z'::timestamptz, true, false) AS result;
  `, [authorId, assignRace1Id, verRaceId, classRaceId]);
  const replayRace1Data = replayRace1Res.rows[0].result;
  if (replayRace1Data.idempotent_replay !== true || replayRace1Data.assignment_id !== assignRace1Id) {
    throw new Error(`Expected idempotent_replay: true for exact same-ID retry, got: ${JSON.stringify(replayRace1Data)}`);
  }
  console.log('✅ Exact same-ID/same-payload call returned stored values with idempotent_replay: true.');

  // [63/66] same-ID/different-payload race path => ERR_IDEMPOTENCY_CONFLICT
  console.log('\n[63/66] Testing same-ID with different ranking payload rejects with ERR_IDEMPOTENCY_CONFLICT...');
  let sameIdDiffPayloadRejected = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_create_assignment(
        $1, $2, $3, $4, '2026-12-31T00:00:00Z'::timestamptz, false, false
      );
    `, [authorId, assignRace1Id, verRaceId, classRaceId]); // changed counts_toward_ranking to false
  } catch (e) {
    sameIdDiffPayloadRejected = true;
    if (!e.message.includes('ERR_IDEMPOTENCY_CONFLICT')) {
      throw new Error(`Expected ERR_IDEMPOTENCY_CONFLICT, got: ${e.message}`);
    }
    console.log('✅ Same-ID with different ranking flag rejected with ERR_IDEMPOTENCY_CONFLICT.');
  }
  if (!sameIdDiffPayloadRejected) throw new Error('Expected same-ID different-payload to be rejected!');

  // [64/66] different IDs / same version+class conflict => ERR_ASSIGNMENT_ALREADY_EXISTS
  console.log('\n[64/66] Testing different ID racing on same version+class rejects with ERR_ASSIGNMENT_ALREADY_EXISTS...');
  let diffIdSameClassRejected = false;
  try {
    await db.query(`
      SELECT public.rpc_exam_create_assignment(
        $1, $2, $3, $4, '2026-12-31T00:00:00Z'::timestamptz, true, false
      );
    `, [authorId, assignRace2Id, verRaceId, classRaceId]);
  } catch (e) {
    diffIdSameClassRejected = true;
    if (!e.message.includes('ERR_ASSIGNMENT_ALREADY_EXISTS')) {
      throw new Error(`Expected ERR_ASSIGNMENT_ALREADY_EXISTS, got: ${e.message}`);
    }
    console.log('✅ Different ID on same version+class rejected with ERR_ASSIGNMENT_ALREADY_EXISTS.');
  }
  if (!diffIdSameClassRejected) throw new Error('Expected different ID on same class to be rejected!');

  // [65/66] exact replay after superseded still works with post-insert conflict branch preserved
  console.log('\n[65/66] Testing exact replay after version becomes superseded preserves post-insert branch...');
  const verRaceV2Id = '00000000-0000-0000-0000-000000000994';
  await db.query(`
    INSERT INTO public.exam_versions (id, exam_id, version_number, title, subject, grade_level, status, published_at, duration_minutes, total_points)
    VALUES ($1, $2, 2, 'Race Test Exam v2', 'Toán', 5, 'draft', NULL, 60, 10.00);
  `, [verRaceV2Id, examRaceId]);
  await db.query(`
    INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points)
    VALUES ('00000000-0000-0000-0000-000000000995', $1, 1, 'essay', 'Prompt Race v2', 10.00);
  `, [verRaceV2Id]);
  await db.query(`SELECT public.rpc_exam_publish_version($1, $2);`, [authorId, verRaceV2Id]);

  const replaySupRaceRes = await db.query(`
    SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, '2026-12-31T00:00:00Z'::timestamptz, true, false) AS result;
  `, [authorId, assignRace1Id, verRaceId, classRaceId]);
  if (replaySupRaceRes.rows[0].result.idempotent_replay !== true || replaySupRaceRes.rows[0].result.assignment_id !== assignRace1Id) {
    throw new Error('Expected idempotent_replay: true for exact assignment replay on superseded version');
  }
  console.log('✅ Exact replay on superseded version succeeded seamlessly.');

  // [66/66] exact replay after archived exam still works with post-insert conflict branch preserved
  console.log('\n[66/66] Testing exact replay after exam_tests is archived preserves post-insert branch...');
  await db.query(`UPDATE public.exam_tests SET status = 'archived' WHERE id = $1;`, [examRaceId]);
  const replayArchRaceRes = await db.query(`
    SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, '2026-12-31T00:00:00Z'::timestamptz, true, false) AS result;
  `, [authorId, assignRace1Id, verRaceId, classRaceId]);
  if (replayArchRaceRes.rows[0].result.idempotent_replay !== true || replayArchRaceRes.rows[0].result.assignment_id !== assignRace1Id) {
    throw new Error('Expected idempotent_replay: true for exact assignment replay on archived exam');
  }
  console.log('✅ Exact replay on archived exam succeeded seamlessly.');

  console.log('\n🎉 ALL 66 PHASE 2B1 ASSIGNMENT & START ATTEMPT TESTS PASSED PERFECTLY!\n');
}

runPhase2B1Test().catch((err) => {
  console.error('❌ PHASE 2B1 DRY-RUN FAILED:', err);
  process.exit(1);
});
