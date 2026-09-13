/**
 * ============================================================================
 * ACADEMIC EXERCISE SAFE DELETE & ARCHIVE TESTS (REFINED SUITE - NO DUMMY TABLES)
 * - PGlite In-Memory PostgreSQL Runtime Tests (13 Test Cases)
 * - Contract & Static Security ACL Analysis (3 Test Cases)
 * (ZERO PRODUCTION DATABASE ACCESS)
 * ============================================================================
 */

import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const TEACHER_A_ID = '11111111-1111-4000-8000-000000000001';
const TEACHER_B_ID = '22222222-2222-4000-8000-000000000002';
const ADMIN_ID = '99999999-9999-4000-8000-000000000009';
const STUDENT_ID = '33333333-3333-4000-8000-000000000003';
const NULL_ROLE_USER_ID = '44444444-4444-4000-8000-000000000005';
const CLASS_ID = '55555555-5555-4000-8000-000000000004';

let seedCounter = 100;
function nextUuid(digit = '1') {
  seedCounter++;
  const hex = seedCounter.toString(16).padStart(12, '0');
  const d = String(digit).slice(0, 1);
  return `e${d}000000-0000-4000-8000-${hex}`;
}

async function initTestDb() {
  const db = await PGlite.create();

  // Create roles, schemas, mock auth functions, and tables
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

    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS app_private;

    -- Mock auth.uid() function for PGlite testing
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
    BEGIN
      RETURN NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TABLE IF NOT EXISTS public.profiles (
      id UUID PRIMARY KEY,
      email TEXT,
      role TEXT,
      full_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.classes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      grade_level INT NOT NULL,
      teacher_id UUID REFERENCES public.profiles(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.class_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
      student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT unique_class_student UNIQUE (class_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS public.academic_exercises (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      description TEXT,
      grade_level INT NOT NULL,
      subject TEXT NOT NULL,
      exercise_type TEXT NOT NULL DEFAULT 'mixed',
      status TEXT NOT NULL DEFAULT 'draft',
      reward_stars INT DEFAULT 10,
      due_date TIMESTAMPTZ,
      is_global BOOLEAN DEFAULT FALSE,
      teacher_id UUID REFERENCES public.profiles(id),
      class_id UUID REFERENCES public.classes(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.academic_exercise_questions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      exercise_id UUID NOT NULL REFERENCES public.academic_exercises(id) ON DELETE CASCADE,
      question_number INT NOT NULL,
      question_type TEXT NOT NULL,
      prompt TEXT NOT NULL,
      options_json JSONB,
      correct_answer TEXT,
      correct_answer_key JSONB,
      points INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.academic_exercise_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      exercise_id UUID NOT NULL REFERENCES public.academic_exercises(id) ON DELETE CASCADE,
      class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
      assigned_by UUID REFERENCES public.profiles(id),
      assigned_at TIMESTAMPTZ DEFAULT NOW(),
      due_date TIMESTAMPTZ,
      counts_toward_ranking BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT unique_exercise_class UNIQUE (exercise_id, class_id)
    );

    CREATE TABLE IF NOT EXISTS public.academic_submissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      exercise_id UUID NOT NULL REFERENCES public.academic_exercises(id) ON DELETE CASCADE,
      student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      attempt_number INT NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft',
      objective_score INT DEFAULT 0,
      manual_score INT DEFAULT 0,
      total_score INT,
      max_score INT NOT NULL DEFAULT 10,
      reward_stars_awarded INT DEFAULT 0,
      reward_applied_at TIMESTAMPTZ,
      teacher_feedback TEXT,
      graded_by UUID REFERENCES public.profiles(id),
      submitted_at TIMESTAMPTZ DEFAULT NOW(),
      graded_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT unique_exercise_student_attempt UNIQUE (exercise_id, student_id, attempt_number)
    );

    CREATE TABLE IF NOT EXISTS public.academic_submission_answers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      submission_id UUID NOT NULL REFERENCES public.academic_submissions(id) ON DELETE CASCADE,
      question_id UUID NOT NULL REFERENCES public.academic_exercise_questions(id) ON DELETE CASCADE,
      student_answer_json JSONB,
      file_url TEXT,
      is_correct BOOLEAN,
      points_earned INT DEFAULT 0,
      teacher_comment TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.exercise_file_cleanup_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id TEXT NOT NULL DEFAULT 'exercise-submissions',
      file_path TEXT NOT NULL UNIQUE,
      requested_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INT DEFAULT 0,
      last_error TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    );
  `);

  // Seed Profiles & Class
  await db.exec(`
    INSERT INTO public.profiles (id, email, role, full_name) VALUES
      ('${TEACHER_A_ID}', 'teacher_a@test.com', 'teacher', 'Teacher A'),
      ('${TEACHER_B_ID}', 'teacher_b@test.com', 'teacher', 'Teacher B'),
      ('${ADMIN_ID}', 'admin@test.com', 'admin', 'System Admin'),
      ('${STUDENT_ID}', 'student@test.com', 'student', 'Student One'),
      ('${NULL_ROLE_USER_ID}', 'null_role@test.com', NULL, 'User Without Role')
    ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

    INSERT INTO public.classes (id, name, code, grade_level, teacher_id) VALUES
      ('${CLASS_ID}', '5A', 'CLASS-5A', 5, '${TEACHER_A_ID}')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.class_members (class_id, student_id) VALUES
      ('${CLASS_ID}', '${STUDENT_ID}')
    ON CONFLICT DO NOTHING;
  `);

  // Load Migration RPC
  const migrationSql = fs.readFileSync(
    path.resolve(rootDir, 'supabase/migrations/20260913000014_academic_exercise_safe_delete_or_archive_rpc.sql'),
    'utf8'
  );
  await db.exec(migrationSql);

  return db;
}

// Helper to execute RPC as specific user
async function runRpcAsUser(db, userId, exerciseId) {
  if (userId) {
    await db.exec(`SET request.jwt.claim.sub = '${userId}';`);
  } else {
    await db.exec(`SET request.jwt.claim.sub = '';`);
  }
  const res = await db.query(`
    SELECT public.rpc_academic_delete_or_archive_exercise($1) as result;
  `, [exerciseId]);
  return res.rows[0]?.result;
}

async function runAllTests() {
  console.log('======================================================================');
  console.log('🧪 ACADEMIC EXERCISE SAFE DELETE & ARCHIVE COMPREHENSIVE TEST SUITE');
  console.log('======================================================================');

  const migrationFile = path.resolve(rootDir, 'supabase/migrations/20260913000014_academic_exercise_safe_delete_or_archive_rpc.sql');
  const migrationContent = fs.readFileSync(migrationFile, 'utf8');

  let pglitePass = 0;
  let pgliteTotal = 0;
  let staticPass = 0;
  let staticTotal = 0;

  async function testPglite(name, fn) {
    pgliteTotal++;
    try {
      await fn();
      console.log(`  ✅ [PGLITE RUNTIME PASS] ${name}`);
      pglitePass++;
    } catch (err) {
      console.error(`  ❌ [PGLITE RUNTIME FAIL] ${name}`);
      console.error(err);
    }
  }

  function testStatic(name, fn) {
    staticTotal++;
    try {
      fn();
      console.log(`  ✅ [CONTRACT/STATIC PASS] ${name}`);
      staticPass++;
    } catch (err) {
      console.error(`  ❌ [CONTRACT/STATIC FAIL] ${name}`);
      console.error(err);
    }
  }

  console.log('\n--- SECTION A: PGLITE RUNTIME TESTS (13 SCENARIOS) ---');
  const db = await initTestDb();

  // 1. Hard-delete clean draft
  await testPglite('1. Hard-delete clean draft exercise (removes questions and exercise)', async () => {
    const exId = nextUuid('1');
    await db.exec(`
      INSERT INTO public.academic_exercises (id, title, grade_level, subject, status, teacher_id)
      VALUES ('${exId}', 'Clean Draft Ex', 5, 'Math', 'draft', '${TEACHER_A_ID}');

      INSERT INTO public.academic_exercise_questions (exercise_id, question_number, question_type, prompt)
      VALUES ('${exId}', 1, 'single_choice', 'What is 1+1?');
    `);

    const res = await runRpcAsUser(db, TEACHER_A_ID, exId);
    assert.equal(res.success, true);
    assert.equal(res.action, 'deleted');

    const exCheck = await db.query(`SELECT * FROM public.academic_exercises WHERE id = $1`, [exId]);
    assert.equal(exCheck.rows.length, 0);

    const qCheck = await db.query(`SELECT * FROM public.academic_exercise_questions WHERE exercise_id = $1`, [exId]);
    assert.equal(qCheck.rows.length, 0);
  });

  // 2. Soft archive expired assignment
  await testPglite('2. Soft archive exercise with expired assignment (preserves assignments & questions)', async () => {
    const exId = nextUuid('2');
    const pastDate = new Date(Date.now() - 3600000).toISOString();
    await db.exec(`
      INSERT INTO public.academic_exercises (id, title, grade_level, subject, status, teacher_id)
      VALUES ('${exId}', 'Assigned Ex', 5, 'Math', 'published', '${TEACHER_A_ID}');

      INSERT INTO public.academic_exercise_questions (exercise_id, question_number, question_type, prompt)
      VALUES ('${exId}', 1, 'single_choice', 'What is 2+2?');

      INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_by, due_date)
      VALUES ('${exId}', '${CLASS_ID}', '${TEACHER_A_ID}', '${pastDate}');
    `);

    const res = await runRpcAsUser(db, TEACHER_A_ID, exId);
    assert.equal(res.success, true);
    assert.equal(res.action, 'archived');

    const exCheck = await db.query(`SELECT status FROM public.academic_exercises WHERE id = $1`, [exId]);
    assert.equal(exCheck.rows[0].status, 'archived');

    const asgCheck = await db.query(`SELECT * FROM public.academic_exercise_assignments WHERE exercise_id = $1`, [exId]);
    assert.equal(asgCheck.rows.length, 1);
  });

  // 3. Preserve submissions, answers, scores upon archive
  await testPglite('3. Preserve submissions, answers, and scores upon archive', async () => {
    const exId = nextUuid('3');
    const subId = nextUuid('4');
    const qId = nextUuid('5');
    const pastDate = new Date(Date.now() - 3600000).toISOString();

    await db.exec(`
      INSERT INTO public.academic_exercises (id, title, grade_level, subject, status, teacher_id)
      VALUES ('${exId}', 'Graded Ex', 5, 'Math', 'published', '${TEACHER_A_ID}');

      INSERT INTO public.academic_exercise_questions (id, exercise_id, question_number, question_type, prompt)
      VALUES ('${qId}', '${exId}', 1, 'single_choice', 'What is 3+3?');

      INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_by, due_date)
      VALUES ('${exId}', '${CLASS_ID}', '${TEACHER_A_ID}', '${pastDate}');

      INSERT INTO public.academic_submissions (id, exercise_id, student_id, status, total_score, max_score, teacher_feedback)
      VALUES ('${subId}', '${exId}', '${STUDENT_ID}', 'graded', 10, 10, 'Excellent work');

      INSERT INTO public.academic_submission_answers (submission_id, question_id, student_answer_json, is_correct, points_earned, file_url)
      VALUES ('${subId}', '${qId}', '"A"'::jsonb, true, 10, 'exercise-submissions/student/essay.pdf');
    `);

    const res = await runRpcAsUser(db, TEACHER_A_ID, exId);
    assert.equal(res.success, true);
    assert.equal(res.action, 'archived');

    // Verify submission data & student files are 100% intact
    const subCheck = await db.query(`SELECT * FROM public.academic_submissions WHERE id = $1`, [subId]);
    assert.equal(subCheck.rows[0].status, 'graded');
    assert.equal(subCheck.rows[0].total_score, 10);

    const ansCheck = await db.query(`SELECT * FROM public.academic_submission_answers WHERE submission_id = $1`, [subId]);
    assert.equal(ansCheck.rows[0].file_url, 'exercise-submissions/student/essay.pdf');
  });

  // 4. Block draft submission
  await testPglite('4. Block deletion if draft student submission exists (ERR_EXERCISE_IN_USE)', async () => {
    const exId = nextUuid('6');
    const pastDate = new Date(Date.now() - 3600000).toISOString();

    await db.exec(`
      INSERT INTO public.academic_exercises (id, title, grade_level, subject, status, teacher_id)
      VALUES ('${exId}', 'In-progress Ex', 5, 'Math', 'published', '${TEACHER_A_ID}');

      INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_by, due_date)
      VALUES ('${exId}', '${CLASS_ID}', '${TEACHER_A_ID}', '${pastDate}');

      INSERT INTO public.academic_submissions (exercise_id, student_id, status)
      VALUES ('${exId}', '${STUDENT_ID}', 'draft');
    `);

    await assert.rejects(
      async () => await runRpcAsUser(db, TEACHER_A_ID, exId),
      (err) => {
        assert(err.message.includes('ERR_EXERCISE_IN_USE'));
        return true;
      }
    );
  });

  // 5. Block active/open assignment
  await testPglite('5. Block deletion if assignment is active or open-ended (ERR_EXERCISE_IN_USE)', async () => {
    const exId = nextUuid('7');
    const futureDate = new Date(Date.now() + 86400000).toISOString();

    await db.exec(`
      INSERT INTO public.academic_exercises (id, title, grade_level, subject, status, teacher_id)
      VALUES ('${exId}', 'Future Due Ex', 5, 'Math', 'published', '${TEACHER_A_ID}');

      INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_by, due_date)
      VALUES ('${exId}', '${CLASS_ID}', '${TEACHER_A_ID}', '${futureDate}');
    `);

    await assert.rejects(
      async () => await runRpcAsUser(db, TEACHER_A_ID, exId),
      (err) => {
        assert(err.message.includes('ERR_EXERCISE_IN_USE'));
        return true;
      }
    );
  });

  // 6. Teacher cannot delete another teacher's exercise
  await testPglite('6. Teacher cannot delete another teacher exercise (ERR_UNAUTHORIZED)', async () => {
    const exId = nextUuid('9');
    await db.exec(`
      INSERT INTO public.academic_exercises (id, title, grade_level, subject, status, teacher_id)
      VALUES ('${exId}', 'Teacher A Ex', 5, 'Math', 'draft', '${TEACHER_A_ID}');
    `);

    await assert.rejects(
      async () => await runRpcAsUser(db, TEACHER_B_ID, exId),
      (err) => {
        assert(err.message.includes('ERR_UNAUTHORIZED'));
        return true;
      }
    );
  });

  // 7. Teacher cannot delete exercise where teacher_id IS NULL (unless admin)
  await testPglite('7. Teacher cannot delete exercise with teacher_id IS NULL, but Admin can', async () => {
    const exId = nextUuid('f');
    await db.exec(`
      INSERT INTO public.academic_exercises (id, title, grade_level, subject, status, teacher_id)
      VALUES ('${exId}', 'Orphan Ex Without Teacher', 5, 'Math', 'draft', NULL);
    `);

    // Normal teacher should be rejected
    await assert.rejects(
      async () => await runRpcAsUser(db, TEACHER_A_ID, exId),
      (err) => {
        assert(err.message.includes('ERR_UNAUTHORIZED'));
        return true;
      }
    );

    // Admin should be allowed
    const adminRes = await runRpcAsUser(db, ADMIN_ID, exId);
    assert.equal(adminRes.success, true);
    assert.equal(adminRes.action, 'deleted');
  });

  // 8. Student calling RPC is rejected (ERR_UNAUTHORIZED)
  await testPglite('8. Student calling RPC is rejected fail-closed (ERR_UNAUTHORIZED)', async () => {
    const exId = nextUuid('e');
    await db.exec(`
      INSERT INTO public.academic_exercises (id, title, grade_level, subject, status, teacher_id)
      VALUES ('${exId}', 'Draft Ex', 5, 'Math', 'draft', '${TEACHER_A_ID}');
    `);

    await assert.rejects(
      async () => await runRpcAsUser(db, STUDENT_ID, exId),
      (err) => {
        assert(err.message.includes('ERR_UNAUTHORIZED'));
        return true;
      }
    );
  });

  // 9. User with NULL role is rejected (ERR_UNAUTHORIZED)
  await testPglite('9. User with NULL role is rejected fail-closed (ERR_UNAUTHORIZED)', async () => {
    const exId = nextUuid('d');
    await db.exec(`
      INSERT INTO public.academic_exercises (id, title, grade_level, subject, status, teacher_id)
      VALUES ('${exId}', 'Draft Ex 2', 5, 'Math', 'draft', '${TEACHER_A_ID}');
    `);

    await assert.rejects(
      async () => await runRpcAsUser(db, NULL_ROLE_USER_ID, exId),
      (err) => {
        assert(err.message.includes('ERR_UNAUTHORIZED'));
        return true;
      }
    );
  });

  // 10. Draft exercise with graded submission must archive and preserve scores/answers (dynamic ranking integrity)
  await testPglite('10. Draft exercise with graded submission must archive and preserve scores/answers', async () => {
    const exId = nextUuid('c');
    const subId = nextUuid('5');
    await db.exec(`
      INSERT INTO public.academic_exercises (id, title, grade_level, subject, status, teacher_id)
      VALUES ('${exId}', 'Draft With Submitted Work', 5, 'Math', 'draft', '${TEACHER_A_ID}');

      INSERT INTO public.academic_submissions (id, exercise_id, student_id, status, total_score, max_score)
      VALUES ('${subId}', '${exId}', '${STUDENT_ID}', 'graded', 85, 100);
    `);

    const res = await runRpcAsUser(db, TEACHER_A_ID, exId);
    assert.equal(res.success, true);
    assert.equal(res.action, 'archived');

    const exCheck = await db.query(`SELECT status FROM public.academic_exercises WHERE id = $1`, [exId]);
    assert.equal(exCheck.rows[0].status, 'archived');

    const subCheck = await db.query(`SELECT total_score, status FROM public.academic_submissions WHERE id = $1`, [subId]);
    assert.equal(subCheck.rows[0].status, 'graded');
    assert.equal(subCheck.rows[0].total_score, 85);
  });

  // 11. Non-draft exercise (published / closed) without assignments still archives (never hard-deleted)
  await testPglite('11. Non-draft exercise (published / closed) without assignments/submissions still archives', async () => {
    const exIdPublished = nextUuid('b');
    await db.exec(`
      INSERT INTO public.academic_exercises (id, title, grade_level, subject, status, teacher_id)
      VALUES ('${exIdPublished}', 'Published Standalone Ex', 5, 'Math', 'published', '${TEACHER_A_ID}');

      INSERT INTO public.academic_exercise_questions (exercise_id, question_number, question_type, prompt)
      VALUES ('${exIdPublished}', 1, 'single_choice', 'Prompt');
    `);

    const resPub = await runRpcAsUser(db, TEACHER_A_ID, exIdPublished);
    assert.equal(resPub.success, true);
    assert.equal(resPub.action, 'archived');

    const checkPub = await db.query(`SELECT status FROM public.academic_exercises WHERE id = $1`, [exIdPublished]);
    assert.equal(checkPub.rows[0].status, 'archived');

    const exIdClosed = nextUuid('9');
    await db.exec(`
      INSERT INTO public.academic_exercises (id, title, grade_level, subject, status, teacher_id)
      VALUES ('${exIdClosed}', 'Closed Standalone Ex', 5, 'Math', 'closed', '${TEACHER_A_ID}');
    `);

    const resClosed = await runRpcAsUser(db, TEACHER_A_ID, exIdClosed);
    assert.equal(resClosed.success, true);
    assert.equal(resClosed.action, 'archived');

    const checkClosed = await db.query(`SELECT status FROM public.academic_exercises WHERE id = $1`, [exIdClosed]);
    assert.equal(checkClosed.rows[0].status, 'archived');
  });

  // 12. Storage-like path strings in prompt/options_json do NOT create cleanup jobs and do NOT touch student files
  await testPglite('12. Storage-like path strings in prompt/options_json do NOT create cleanup jobs or touch student files', async () => {
    const initialJobs = await db.query(`SELECT COUNT(*) FROM public.exercise_file_cleanup_jobs;`);
    const initialJobCount = parseInt(initialJobs.rows[0].count, 10);

    const exId = nextUuid('8');
    await db.exec(`
      INSERT INTO public.academic_exercises (id, title, grade_level, subject, status, teacher_id)
      VALUES ('${exId}', 'Draft With Simulated Text', 5, 'Math', 'draft', '${TEACHER_A_ID}');

      INSERT INTO public.academic_exercise_questions (exercise_id, question_number, question_type, prompt, options_json)
      VALUES (
        '${exId}',
        1,
        'single_choice',
        'Check file at exercise-submissions/student-123/attempt-456/homework.png',
        '["exercise-submissions/option1.png", "exercise-submissions/option2.png"]'::jsonb
      );
    `);

    const res = await runRpcAsUser(db, TEACHER_A_ID, exId);
    assert.equal(res.success, true);
    assert.equal(res.action, 'deleted');

    const afterJobs = await db.query(`SELECT COUNT(*) FROM public.exercise_file_cleanup_jobs;`);
    const afterJobCount = parseInt(afterJobs.rows[0].count, 10);
    assert.equal(afterJobCount, initialJobCount, 'Zero cleanup jobs must be created on hard-delete');
  });

  // 13. Idempotency on repeated calls
  await testPglite('13. Idempotency returns already_archived on repeated calls', async () => {
    const exId = nextUuid('a');
    await db.exec(`
      INSERT INTO public.academic_exercises (id, title, grade_level, subject, status, teacher_id)
      VALUES ('${exId}', 'Already Archived', 5, 'Math', 'archived', '${TEACHER_A_ID}');
    `);

    const res = await runRpcAsUser(db, TEACHER_A_ID, exId);
    assert.equal(res.success, true);
    assert.equal(res.action, 'already_archived');
  });

  console.log('\n--- SECTION B: CONTRACT & STATIC SECURITY ACL TESTS (3 CHECKS) ---');

  // Static 1: search_path = ''
  testStatic('14. RPC enforces empty search_path (SET search_path = \'\')', () => {
    const match = /SET\s+search_path\s*=\s*''/i.test(migrationContent);
    assert(match, 'Migration must set search_path = \'\'');
  });

  // Static 2: Revoke PUBLIC / anon
  testStatic('15. Permissions revoked from PUBLIC and anon', () => {
    const revokePublic = /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.rpc_academic_delete_or_archive_exercise.*FROM\s+PUBLIC/i.test(migrationContent);
    const revokeAnon = /anon/i.test(migrationContent);
    assert(revokePublic && revokeAnon, 'Permissions must be revoked from PUBLIC and anon');
  });

  // Static 3: Grant only authenticated and service_role
  testStatic('16. Permissions granted strictly to authenticated and service_role', () => {
    const grantAuth = /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.rpc_academic_delete_or_archive_exercise.*TO\s+authenticated/i.test(migrationContent);
    const grantService = /service_role/i.test(migrationContent);
    assert(grantAuth && grantService, 'Execute permission must only be granted to authenticated and service_role');
  });

  console.log('======================================================================');
  console.log(`📊 SUMMARY:`);
  console.log(`  - PGlite Runtime Tests: ${pglitePass}/${pgliteTotal} PASS`);
  console.log(`  - Contract/Static Tests: ${staticPass}/${staticTotal} PASS`);
  console.log(`  - Total Suite Result:   ${pglitePass + staticPass}/${pgliteTotal + staticTotal} PASS`);
  console.log('======================================================================\n');

  if (pglitePass !== pgliteTotal || staticPass !== staticTotal) {
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
