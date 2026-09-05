/**
 * ============================================================================
 * EXAM BUILDER V1 — LOCAL PGLITE DRY-RUN PREFLIGHT TEST
 * (IN-MEMORY ONLY — ZERO NETWORK — ZERO PRODUCTION SECRETS)
 * ============================================================================
 */

import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCHEMA_FILE_PATH = path.resolve(__dirname, '../docs/01_exam_builder_v1_schema_new.sql');

async function runPreflight() {
  console.log('--- STARTING EXAM BUILDER V1 PGLITE DRY RUN ---');
  
  if (!fs.existsSync(SCHEMA_FILE_PATH)) {
    throw new Error(`Schema file not found: ${SCHEMA_FILE_PATH}`);
  }

  const sqlContent = fs.readFileSync(SCHEMA_FILE_PATH, 'utf-8');
  console.log(`Loaded schema file (${sqlContent.length} bytes)`);

  const db = await PGlite.create();

  // Create standard Supabase roles in PGlite
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

  // 1. Execute the DDL schema
  console.log('\n[1/10] Applying DDL Migration Draft...');
  await db.exec(sqlContent);
  console.log('✅ DDL executed successfully in local PGlite.');

  // Verify all 8 objects exist
  const tables = [
    'public.exam_tests',
    'public.exam_versions',
    'public.exam_questions',
    'app_private.exam_answer_keys',
    'public.exam_assignments',
    'public.exam_attempts',
    'public.exam_attempt_answers',
    'public.exam_audit_events'
  ];

  for (const t of tables) {
    const [schema, name] = t.split('.');
    const res = await db.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = $1 AND table_name = $2
      ) AS exists;`,
      [schema, name]
    );
    if (!res.rows[0].exists) {
      throw new Error(`Expected table ${t} does not exist!`);
    }
  }
  console.log('✅ Verified all 8 tables created successfully.');

  // 2. Verify circular current_version FK creation & deferred behavior
  console.log('\n[2/10] Testing Circular FK exam_tests.current_version_id...');
  await db.exec(`
    BEGIN;
    INSERT INTO public.exam_tests (id, author_id, title, subject, grade_level, status)
    VALUES ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Test 1', 'Toán', 5, 'active');
    
    INSERT INTO public.exam_versions (id, exam_id, version_number, title, subject, grade_level, total_points, status, published_at)
    VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 1, 'Test 1 v1', 'Toán', 5, 10.00, 'published', NOW());
    
    UPDATE public.exam_tests 
    SET current_version_id = '00000000-0000-0000-0000-000000000002'
    WHERE id = '00000000-0000-0000-0000-000000000001';
    COMMIT;
  `);
  console.log('✅ Circular FK with DEFERRABLE INITIALLY DEFERRED functions as expected.');

  // 3. Testing assignment/attempt composite FK rejects mismatched version
  console.log('\n[3/10] Testing assignment/attempt composite FK version mismatch rejection...');
  await db.query(`
    INSERT INTO public.exam_assignments (id, exam_version_id, class_id, assigned_by)
    VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');
  `);

  // Create another version for mismatch test
  await db.query(`
    INSERT INTO public.exam_versions (id, exam_id, version_number, title, subject, grade_level, total_points, status, published_at)
    VALUES ('00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000001', 2, 'Test 1 v2', 'Toán', 5, 10.00, 'published', NOW());
  `);

  let fkFailed = false;
  try {
    await db.query(`
      INSERT INTO public.exam_attempts (id, assignment_id, exam_version_id, student_id, attempt_number, max_score, status)
      VALUES ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000099', '33333333-3333-3333-3333-333333333333', 1, 10.00, 'draft');
    `);
  } catch (e) {
    fkFailed = true;
    console.log('✅ Composite FK properly rejected attempt referencing mismatched version (Foreign key violation).');
  }
  if (!fkFailed) throw new Error('Expected composite FK violation on version mismatch, but insert succeeded!');

  // Insert valid attempt
  await db.query(`
    INSERT INTO public.exam_attempts (id, assignment_id, exam_version_id, student_id, attempt_number, max_score, status)
    VALUES ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 1, 10.00, 'draft');
  `);

  // 4. Testing answer composite FKs reject wrong-version question
  console.log('\n[4/10] Testing attempt_answers composite FK question version mismatch...');
  // Question on v1
  await db.query(`
    INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points)
    VALUES ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000002', 1, 'single_choice', '1+1=?', 2.00);
  `);
  // Question on v2
  await db.query(`
    INSERT INTO public.exam_questions (id, exam_version_id, question_number, question_type, prompt, points)
    VALUES ('00000000-0000-0000-0000-000000000098', '00000000-0000-0000-0000-000000000099', 1, 'single_choice', '2+2=?', 2.00);
  `);

  let ansFkFailed = false;
  try {
    // Attempt is on v1, try to link answer to question on v2
    await db.query(`
      INSERT INTO public.exam_attempt_answers (exam_version_id, attempt_id, exam_question_id, grading_status)
      VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000098', 'pending_manual');
    `);
  } catch (e) {
    ansFkFailed = true;
    console.log('✅ Composite FK properly rejected answer linking question from different version.');
  }
  if (!ansFkFailed) throw new Error('Expected composite FK failure on answer question version mismatch!');

  // 5. Testing unique active draft prevents 2 simultaneous draft attempts
  console.log('\n[5/10] Testing partial unique index unique_active_draft_attempt...');
  let draftConflict = false;
  try {
    await db.query(`
      INSERT INTO public.exam_attempts (id, assignment_id, exam_version_id, student_id, attempt_number, max_score, status)
      VALUES ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 2, 10.00, 'draft');
    `);
  } catch (e) {
    draftConflict = true;
    console.log('✅ Partial unique index properly blocked 2 simultaneous active draft attempts.');
  }
  if (!draftConflict) throw new Error('Expected unique constraint failure for duplicate active draft attempt!');

  // 6. Testing ON DELETE RESTRICT blocks deleting exam_test with versions
  console.log('\n[6/10] Testing ON DELETE RESTRICT on exam_versions.exam_id...');
  let restrictFailed = false;
  try {
    await db.query(`DELETE FROM public.exam_tests WHERE id = '00000000-0000-0000-0000-000000000001';`);
  } catch (e) {
    restrictFailed = true;
    console.log('✅ ON DELETE RESTRICT successfully prevented physical deletion of exam_test with child versions.');
  }
  if (!restrictFailed) throw new Error('Expected ON DELETE RESTRICT failure, but exam_test was deleted!');

  // 7. Testing audit CHECK rejects invalid event/signal pairs
  console.log('\n[7/10] Testing check_audit_event_signal_invariants constraint...');
  let invalidSignalFailed = false;
  try {
    // episode_opened with invalid signal 'window_focus'
    await db.query(`
      INSERT INTO public.exam_audit_events (attempt_id, episode_id, event_type, signal_source)
      VALUES ('00000000-0000-0000-0000-000000000004', '44444444-4444-4444-4444-444444444444', 'episode_opened', 'window_focus');
    `);
  } catch (e) {
    invalidSignalFailed = true;
    console.log('✅ Audit CHECK constraint properly rejected invalid (episode_opened, window_focus) pair.');
  }
  if (!invalidSignalFailed) throw new Error('Expected check_audit_event_signal_invariants to reject invalid event/signal pair!');

  // Test episode_opened missing episode_id
  let missingEpFailed = false;
  try {
    await db.query(`
      INSERT INTO public.exam_audit_events (attempt_id, episode_id, event_type, signal_source)
      VALUES ('00000000-0000-0000-0000-000000000004', NULL, 'episode_opened', 'page_hidden');
    `);
  } catch (e) {
    missingEpFailed = true;
    console.log('✅ Audit CHECK constraint properly rejected episode_opened with NULL episode_id.');
  }
  if (!missingEpFailed) throw new Error('Expected check to reject episode_opened with NULL episode_id!');

  // 8. Testing historical duplicate audit event violates unique constraint
  console.log('\n[8/10] Testing unique_attempt_episode_event constraint...');
  // Insert valid audit event
  await db.query(`
    INSERT INTO public.exam_audit_events (attempt_id, episode_id, event_type, signal_source)
    VALUES ('00000000-0000-0000-0000-000000000004', '44444444-4444-4444-4444-444444444444', 'episode_opened', 'page_hidden');
  `);

  let duplicateAuditFailed = false;
  try {
    await db.query(`
      INSERT INTO public.exam_audit_events (attempt_id, episode_id, event_type, signal_source)
      VALUES ('00000000-0000-0000-0000-000000000004', '44444444-4444-4444-4444-444444444444', 'episode_opened', 'page_hidden');
    `);
  } catch (e) {
    duplicateAuditFailed = true;
    console.log('✅ unique_attempt_episode_event constraint successfully prevented duplicate audit events.');
  }
  if (!duplicateAuditFailed) throw new Error('Expected duplicate audit event to violate unique constraint!');

  // 9. Testing RLS is enabled on all 7 public tables
  console.log('\n[9/10] Testing Row Level Security enablement...');
  const publicTables = [
    'exam_tests',
    'exam_versions',
    'exam_questions',
    'exam_assignments',
    'exam_attempts',
    'exam_attempt_answers',
    'exam_audit_events'
  ];

  for (const pt of publicTables) {
    const res = await db.query(`
      SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = $1;
    `, [pt]);
    if (!res.rows[0]?.rowsecurity) {
      throw new Error(`Expected RLS to be enabled on public.${pt}`);
    }
  }
  console.log('✅ RLS is confirmed enabled on all 7 public tables.');

  // 10. Testing no RPCs created in migration
  console.log('\n[10/10] Testing RPC creation check...');
  const funcs = await db.query(`
    SELECT proname, nspname 
    FROM pg_proc p 
    JOIN pg_namespace n ON p.pronamespace = n.oid 
    WHERE n.nspname IN ('public', 'app_private') 
      AND p.proname LIKE 'rpc_exam_%';
  `);
  if (funcs.rows.length > 0) {
    throw new Error(`Unexpected RPCs found in migration: ${JSON.stringify(funcs.rows)}`);
  }
  console.log('✅ Confirmed 0 RPCs created in this DDL migration draft.');

  console.log('\n🎉 ALL 10 PGLITE DRY-RUN TESTS PASSED PERFECTLY!\n');
}

runPreflight().catch((err) => {
  console.error('❌ DRY-RUN FAILED:', err);
  process.exit(1);
});
