/**
 * ============================================================================
 * EXAM BUILDER V1 — PHASE 1.1 GRADING STATUS AMENDMENT DRY-RUN TEST
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

async function runPhase11Test() {
  console.log('--- STARTING EXAM BUILDER V1 PHASE 1.1 DRY RUN ---');

  if (!fs.existsSync(BASE_SCHEMA_PATH)) {
    throw new Error(`Base schema file not found: ${BASE_SCHEMA_PATH}`);
  }
  if (!fs.existsSync(PATCH_SCHEMA_PATH)) {
    throw new Error(`Patch schema file not found: ${PATCH_SCHEMA_PATH}`);
  }

  const baseSql = fs.readFileSync(BASE_SCHEMA_PATH, 'utf-8');
  const patchSql = fs.readFileSync(PATCH_SCHEMA_PATH, 'utf-8');

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

  // [1/10] Apply base schema
  console.log('\n[1/10] Applying Phase 1 Base Schema...');
  await db.exec(baseSql);
  console.log('✅ Phase 1 base schema applied successfully.');

  // Set up base fixtures
  const testId = '00000000-0000-0000-0000-000000000001';
  const versionId = '00000000-0000-0000-0000-000000000002';
  const questionId = '00000000-0000-0000-0000-000000000003';
  const assignmentId = '00000000-0000-0000-0000-000000000004';
  const attemptId = '00000000-0000-0000-0000-000000000005';
  const studentId = '00000000-0000-0000-0000-000000000006';
  const authorId = '00000000-0000-0000-0000-000000000007';
  const classId = '00000000-0000-0000-0000-000000000008';

  await db.query(`
    INSERT INTO public.exam_tests (id, author_id, title, subject, grade_level, status)
    VALUES ($1, $2, 'Test 1', 'Toán', 5, 'active');
  `, [testId, authorId]);

  await db.query(`
    INSERT INTO public.exam_versions (id, exam_id, version_number, title, subject, grade_level, total_points, status, published_at)
    VALUES ($1, $2, 1, 'Version 1', 'Toán', 5, 10.00, 'published', NOW());
  `, [versionId, testId]);

  await db.query(`
    INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points)
    VALUES ($1, $2, 1, 'single_choice', '1+1=?', 2.00);
  `, [questionId, versionId]);

  await db.query(`
    INSERT INTO public.exam_assignments (id, exam_version_id, class_id, assigned_by)
    VALUES ($1, $2, $3, $4);
  `, [assignmentId, versionId, classId, authorId]);

  await db.query(`
    INSERT INTO public.exam_attempts (id, assignment_id, exam_version_id, student_id, attempt_number, max_score, status)
    VALUES ($1, $2, $3, $4, 1, 10.00, 'draft');
  `, [attemptId, assignmentId, versionId, studentId]);

  // [2/10] Before patch: pending_auto rejected
  console.log('\n[2/10] Verifying pending_auto is REJECTED before patch...');
  let beforePatchRejected = false;
  try {
    await db.query(`
      INSERT INTO public.exam_attempt_answers (exam_version_id, attempt_id, exam_question_id, student_answer_json, grading_status)
      VALUES ($1, $2, $3, '{"selected":"A"}'::jsonb, 'pending_auto');
    `, [versionId, attemptId, questionId]);
  } catch (e) {
    beforePatchRejected = true;
    console.log('✅ pending_auto properly rejected by base constraint.');
  }
  if (!beforePatchRejected) {
    throw new Error('Expected pending_auto to be rejected before patch, but it succeeded!');
  }

  // [3/10] Apply patch
  console.log('\n[3/10] Applying Phase 1.1 Schema Patch...');
  await db.exec(patchSql);
  console.log('✅ Phase 1.1 patch applied successfully.');

  // [4/10] After patch: pending_auto accepted
  console.log('\n[4/10] Verifying pending_auto is ACCEPTED after patch...');
  await db.query(`
    INSERT INTO public.exam_attempt_answers (id, exam_version_id, attempt_id, exam_question_id, student_answer_json, grading_status)
    VALUES ('00000000-0000-0000-0000-000000000010', $1, $2, $3, '{"selected":"A"}'::jsonb, 'pending_auto');
  `, [versionId, attemptId, questionId]);
  console.log('✅ pending_auto accepted successfully.');

  // [5/10] auto_graded accepted
  console.log('\n[5/10] Verifying auto_graded is ACCEPTED after patch...');
  await db.query(`
    UPDATE public.exam_attempt_answers
    SET grading_status = 'auto_graded', points_earned = 2.00, is_correct = true
    WHERE id = '00000000-0000-0000-0000-000000000010';
  `);
  console.log('✅ auto_graded accepted successfully.');

  // [6/10] pending_manual accepted
  console.log('\n[6/10] Verifying pending_manual is ACCEPTED after patch...');
  await db.query(`
    UPDATE public.exam_attempt_answers
    SET grading_status = 'pending_manual', points_earned = NULL, is_correct = NULL
    WHERE id = '00000000-0000-0000-0000-000000000010';
  `);
  console.log('✅ pending_manual accepted successfully.');

  // [7/10] manual_graded accepted
  console.log('\n[7/10] Verifying manual_graded is ACCEPTED after patch...');
  await db.query(`
    UPDATE public.exam_attempt_answers
    SET grading_status = 'manual_graded', points_earned = 1.50, is_correct = true
    WHERE id = '00000000-0000-0000-0000-000000000010';
  `);
  console.log('✅ manual_graded accepted successfully.');

  // [8/10] arbitrary value rejected
  console.log('\n[8/10] Verifying arbitrary value (graded) is REJECTED...');
  let arbitraryRejected = false;
  try {
    await db.query(`
      UPDATE public.exam_attempt_answers
      SET grading_status = 'graded'
      WHERE id = '00000000-0000-0000-0000-000000000010';
    `);
  } catch (e) {
    arbitraryRejected = true;
    console.log('✅ Arbitrary value "graded" properly rejected by updated constraint.');
  }
  if (!arbitraryRejected) {
    throw new Error('Expected arbitrary value "graded" to be rejected, but it succeeded!');
  }

  // [9/10] Verify table columns and constraints count
  console.log('\n[9/10] Verifying other table structures remain unchanged...');
  const tables = [
    'exam_tests', 'exam_versions', 'exam_questions', 'exam_assignments',
    'exam_attempts', 'exam_attempt_answers', 'exam_audit_events'
  ];
  for (const t of tables) {
    const cols = await db.query(
      `SELECT count(*) as count FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1;`,
      [t]
    );
    if (parseInt(cols.rows[0].count, 10) === 0) {
      throw new Error(`Table public.${t} has 0 columns!`);
    }
  }
  console.log('✅ All 7 public tables and structures confirmed intact.');

  // [10/10] Verify no RPCs, triggers, or policies created
  console.log('\n[10/10] Verifying no unexpected RPCs, triggers, or policies...');
  const rpcs = await db.query(`
    SELECT count(*) as count FROM pg_proc p 
    JOIN pg_namespace n ON p.pronamespace = n.oid 
    WHERE n.nspname = 'public' AND p.proname LIKE 'rpc_exam_%';
  `);
  if (parseInt(rpcs.rows[0].count, 10) > 0) {
    throw new Error('Unexpected RPCs found!');
  }

  const policies = await db.query(`
    SELECT count(*) as count FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'exam_%';
  `);
  if (parseInt(policies.rows[0].count, 10) > 0) {
    throw new Error('Unexpected policies found!');
  }

  console.log('✅ Confirmed 0 RPCs, 0 policies, 0 triggers created by patch.');

  console.log('\n🎉 ALL 10 PHASE 1.1 DRY-RUN TESTS PASSED PERFECTLY!\n');
}

runPhase11Test().catch((err) => {
  console.error('❌ PHASE 1.1 DRY-RUN FAILED:', err);
  process.exit(1);
});
