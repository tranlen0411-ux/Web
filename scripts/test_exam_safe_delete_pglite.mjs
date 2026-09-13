/**
 * ============================================================================
 * EXAM BUILDER V1 — HARDEN SAFE DELETE PGLITE RUNTIME TESTS
 * (IN-MEMORY POSTGRESQL RUNTIME — ZERO PRODUCTION DATABASE ACCESS)
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

const MIGRATIONS = [
  'supabase/migrations/20260905000001_exam_builder_v1_phase1_schema.sql',
  'supabase/migrations/20260905000002_exam_builder_v1_phase1_1_grading_status.sql',
  'supabase/migrations/20260905000003_exam_builder_v1_phase2a_authoring_rpcs.sql',
  'supabase/migrations/20260905000004_exam_builder_v1_phase2b1_assignment_attempt_rpcs.sql',
  'supabase/migrations/20260905000005_exam_builder_v1_phase2b2_answer_submit_rpcs.sql',
  'supabase/migrations/20260905000006_exam_builder_v1_phase2c_manual_grading_rpc.sql',
  'supabase/migrations/20260905000007_exam_builder_v1_phase2d_tab_switch_audit_rpc.sql',
  'supabase/migrations/20260906000008_exam_builder_v1_start_attempt_version_hotfix.sql',
  'supabase/migrations/20260907000009_exam_builder_v1_get_attempt_questions.sql',
  'supabase/migrations/20260909000010_exam_builder_v1_get_attempt_questions_option_orders_fix.sql',
  'supabase/migrations/20260910121949_exam_builder_v1_flexible_scheduling_phase_a.sql',
  'supabase/migrations/20260911000011_exam_builder_v1_phase_b1_draft_detail_rpc.sql',
  'supabase/migrations/20260912000012_exam_v1_update_graded_feedback_rpc.sql',
  'supabase/migrations/20260913000013_exam_builder_v1_safe_delete_or_archive_rpc.sql'
];

async function initTestDb() {
  const db = await PGlite.create();

  // Initialize roles and private schema
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
    CREATE SCHEMA IF NOT EXISTS app_private;
  `);

  for (const relPath of MIGRATIONS) {
    const fullPath = path.resolve(rootDir, relPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Migration file not found: ${relPath}`);
    }
    const sql = fs.readFileSync(fullPath, 'utf-8');
    await db.exec(sql);
  }

  return db;
}

const AUTHOR_ID = 'a0000000-0000-0000-0000-000000000001';
const OTHER_TEACHER_ID = 'a0000000-0000-0000-0000-000000000002';
const ADMIN_ID = 'ad000000-0000-0000-0000-000000000001';
const STUDENT_ID = 'c1000000-0000-0000-0000-000000000001';
const CLASS_ID = '4f0f3fd3-f4d2-4f5b-9370-a7cc8fa6e45c';

let seedCounter = 300;
function nextUuid(prefixDigit = '1') {
  seedCounter++;
  const hex = seedCounter.toString(16).padStart(12, '0');
  const d = String(prefixDigit).slice(0, 1);
  return `e${d}000000-0000-4000-8000-${hex}`;
}

async function helperCreateDraftExam(db, {
  title = 'Draft Exam',
  authorId = AUTHOR_ID,
  durationMinutes = 30,
  startsAt = null,
  dueDate = null,
  lastStartAt = null,
  maxAttempts = 1
} = {}) {
  const examId = nextUuid('1');
  const versionId = nextUuid('2');
  const qId = nextUuid('3');

  // 1. Create Test
  await db.query(`
    SELECT public.rpc_exam_create_test($1, $2, $3, $4, 'Math', 10, 'Draft desc', true);
  `, [authorId, examId, versionId, title]);

  // 2. Save Draft Version with Question
  const questions = [
    {
      id: qId,
      question_number: 1,
      question_type: 'single_choice',
      prompt: 'Clean draft question prompt',
      points: 10,
      options_json: [
        { key: 'A', text: 'Option A' },
        { key: 'B', text: 'Option B' }
      ],
      answer_key: { correct_answer: 'A' }
    }
  ];

  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1, $2, $3, 'Math', 10, 'Draft desc', $4, $5, $6, $7, 0, false, false, 'WARN_AND_LOG', true, false, $8, true, $9
    );
  `, [
    authorId,
    versionId,
    title,
    durationMinutes,
    startsAt,
    dueDate,
    maxAttempts,
    JSON.stringify(questions),
    lastStartAt
  ]);

  return { examId, versionId, qId };
}

async function helperPublishAndAssignExam(db, {
  authorId = AUTHOR_ID,
  title = 'Published Exam',
  startsAt = null,
  dueDate = null,
  lastStartAt = null
} = {}) {
  const { examId, versionId, qId } = await helperCreateDraftExam(db, { authorId, title });

  // Publish
  await db.query(`
    SELECT public.rpc_exam_publish_version($1, $2, true);
  `, [authorId, versionId]);

  // Assign
  const assignmentId = nextUuid('4');
  await db.query(`
    SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, $5, false, true, $6, $7);
  `, [
    authorId,
    assignmentId,
    versionId,
    CLASS_ID,
    dueDate,
    startsAt,
    lastStartAt
  ]);

  return { examId, versionId, qId, assignmentId };
}

async function runAllTests() {
  console.log('--- STARTING EXAM SAFE DELETE PGLITE RUNTIME TESTS ---');
  let passCount = 0;
  let totalTests = 0;

  function recordPass(desc) {
    totalTests++;
    passCount++;
    console.log(`  [PASS] Test ${totalTests}: ${desc}`);
  }

  const db = await initTestDb();

  // =========================================================================
  // TEST 1: Clean Draft -> Hard Delete (all tables wiped completely)
  // =========================================================================
  {
    const { examId, versionId, qId } = await helperCreateDraftExam(db, { title: 'Draft to Hard Delete' });

    // Verify draft exists in DB
    const preCheckTest = await db.query(`SELECT status FROM public.exam_tests WHERE id = $1`, [examId]);
    assert.equal(preCheckTest.rows.length, 1);
    assert.equal(preCheckTest.rows[0].status, 'active');

    const preCheckVer = await db.query(`SELECT status FROM public.exam_versions WHERE id = $1`, [versionId]);
    assert.equal(preCheckVer.rows[0].status, 'draft');

    const preCheckQ = await db.query(`SELECT count(*) as count FROM public.exam_questions WHERE exam_version_id = $1`, [versionId]);
    assert.equal(Number(preCheckQ.rows[0].count), 1);

    const preCheckKeys = await db.query(`SELECT count(*) as count FROM app_private.exam_answer_keys WHERE question_id = $1`, [qId]);
    assert.equal(Number(preCheckKeys.rows[0].count), 1);

    // Call Safe Delete
    const delRes = await db.query(`
      SELECT public.rpc_exam_delete_or_archive_test($1, $2, false) as result;
    `, [AUTHOR_ID, examId]);

    const res = delRes.rows[0].result;
    assert.equal(res.success, true);
    assert.equal(res.action, 'deleted');
    assert.equal(res.exam_id, examId);

    // Verify completely deleted across all tables
    const postTest = await db.query(`SELECT * FROM public.exam_tests WHERE id = $1`, [examId]);
    assert.equal(postTest.rows.length, 0, 'exam_tests must be deleted');

    const postVer = await db.query(`SELECT * FROM public.exam_versions WHERE exam_id = $1`, [examId]);
    assert.equal(postVer.rows.length, 0, 'exam_versions must be deleted');

    const postQ = await db.query(`SELECT * FROM public.exam_questions WHERE exam_version_id = $1`, [versionId]);
    assert.equal(postQ.rows.length, 0, 'exam_questions must be deleted');

    const postKeys = await db.query(`SELECT * FROM app_private.exam_answer_keys WHERE question_id = $1`, [qId]);
    assert.equal(postKeys.rows.length, 0, 'app_private.exam_answer_keys must be deleted');

    recordPass('Clean draft exam is completely hard-deleted with all child records');
  }

  // =========================================================================
  // TEST 2: Active Assignment with future due_date -> Blocked (ERR_EXAM_IN_USE)
  // =========================================================================
  {
    const futureDue = new Date(Date.now() + 24 * 60 * 60 * 1000); // +1 day
    const { examId } = await helperPublishAndAssignExam(db, {
      title: 'Active Assignment Future Due',
      dueDate: futureDue
    });

    let threw = false;
    try {
      await db.query(`
        SELECT public.rpc_exam_delete_or_archive_test($1, $2, false) as result;
      `, [AUTHOR_ID, examId]);
    } catch (err) {
      threw = true;
      assert.ok(
        err.message.includes('ERR_EXAM_IN_USE') || err.message.includes('Đề đang trong thời gian thi hoặc có học sinh đang làm bài'),
        `Unexpected error message: ${err.message}`
      );
    }
    assert.equal(threw, true, 'Active assignment with future due_date must throw ERR_EXAM_IN_USE');

    // Verify data untouched
    const testRow = await db.query(`SELECT status FROM public.exam_tests WHERE id = $1`, [examId]);
    assert.equal(testRow.rows[0].status, 'active', 'Exam status must remain active');

    recordPass('Active exam with future due_date is blocked with ERR_EXAM_IN_USE');
  }

  // =========================================================================
  // TEST 3: Active Assignment with due_date IS NULL -> Blocked (ERR_EXAM_IN_USE)
  // =========================================================================
  {
    const { examId } = await helperPublishAndAssignExam(db, {
      title: 'Active Assignment No Due Date',
      dueDate: null // Indefinite window
    });

    let threw = false;
    try {
      await db.query(`
        SELECT public.rpc_exam_delete_or_archive_test($1, $2, false) as result;
      `, [AUTHOR_ID, examId]);
    } catch (err) {
      threw = true;
      assert.ok(
        err.message.includes('ERR_EXAM_IN_USE') || err.message.includes('Đề đang trong thời gian thi hoặc có học sinh đang làm bài'),
        `Unexpected error message: ${err.message}`
      );
    }
    assert.equal(threw, true, 'Assignment with due_date IS NULL must throw ERR_EXAM_IN_USE');

    // Verify data untouched
    const testRow = await db.query(`SELECT status FROM public.exam_tests WHERE id = $1`, [examId]);
    assert.equal(testRow.rows[0].status, 'active', 'Exam status must remain active');

    recordPass('Exam with due_date IS NULL (indefinite) is blocked with ERR_EXAM_IN_USE');
  }

  // =========================================================================
  // TEST 4: Attempt status = 'draft' in-progress -> Always blocked even if expired
  // =========================================================================
  {
    const pastDue = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
    const pastStart = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const { examId, versionId, assignmentId } = await helperPublishAndAssignExam(db, {
      title: 'Expired Assignment with In-progress Draft Attempt',
      startsAt: pastStart,
      dueDate: pastDue
    });

    // Create in-progress attempt (status = 'draft')
    const attemptId = nextUuid('5');
    await db.query(`
      INSERT INTO public.exam_attempts (
        id, assignment_id, exam_version_id, student_id, attempt_number,
        status, attempt_started_at, max_score, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, 1,
        'draft', NOW(), 10, NOW(), NOW()
      );
    `, [attemptId, assignmentId, versionId, STUDENT_ID]);

    let threw = false;
    try {
      await db.query(`
        SELECT public.rpc_exam_delete_or_archive_test($1, $2, false) as result;
      `, [AUTHOR_ID, examId]);
    } catch (err) {
      threw = true;
      assert.ok(
        err.message.includes('ERR_EXAM_IN_USE') || err.message.includes('Đề đang trong thời gian thi hoặc có học sinh đang làm bài'),
        `Unexpected error message: ${err.message}`
      );
    }
    assert.equal(threw, true, 'In-progress draft attempt must block deletion even if schedule expired');

    // Verify data untouched
    const testRow = await db.query(`SELECT status FROM public.exam_tests WHERE id = $1`, [examId]);
    assert.equal(testRow.rows[0].status, 'active', 'Exam status must remain active');

    recordPass('In-progress draft attempt strictly blocks deletion with ERR_EXAM_IN_USE');
  }

  // =========================================================================
  // TEST 5: Expired assignments & submitted attempts -> Soft Archive Success
  // =========================================================================
  {
    const pastDue = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
    const pastStart = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const { examId, versionId, qId, assignmentId } = await helperPublishAndAssignExam(db, {
      title: 'Expired Assignment Ready for Archive',
      startsAt: pastStart,
      dueDate: pastDue
    });

    // Create completed attempt (status = 'submitted') with answers and scores
    const attemptId = nextUuid('5');
    await db.query(`
      INSERT INTO public.exam_attempts (
        id, assignment_id, exam_version_id, student_id, attempt_number,
        status, attempt_started_at, submitted_at, total_score, max_score, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, 1,
        'submitted', $5, $6, 10, 10, NOW(), NOW()
      );
    `, [attemptId, assignmentId, versionId, STUDENT_ID, pastStart.toISOString(), pastDue.toISOString()]);

    const answerId = nextUuid('6');
    await db.query(`
      INSERT INTO public.exam_attempt_answers (
        id, exam_version_id, attempt_id, exam_question_id, student_answer_json, points_earned, is_correct, grading_status, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, '{"selected_option":"A"}'::jsonb, 10, true, 'auto_graded', NOW(), NOW()
      );
    `, [answerId, versionId, attemptId, qId]);

    // Call Safe Delete -> Should Archive
    const archRes = await db.query(`
      SELECT public.rpc_exam_delete_or_archive_test($1, $2, false) as result;
    `, [AUTHOR_ID, examId]);

    const res = archRes.rows[0].result;
    assert.equal(res.success, true);
    assert.equal(res.action, 'archived');
    assert.equal(res.exam_id, examId);
    assert.ok(res.archived_at, 'archived_at timestamp must be present');

    // Check DB status
    const postTest = await db.query(`SELECT status, archived_at FROM public.exam_tests WHERE id = $1`, [examId]);
    assert.equal(postTest.rows[0].status, 'archived');
    assert.ok(postTest.rows[0].archived_at);

    // Check version status (published version retains snapshot immutability)
    const postVer = await db.query(`SELECT status FROM public.exam_versions WHERE exam_id = $1`, [examId]);
    assert.equal(postVer.rows[0].status, 'published');

    // Check 100% preservation of historical records
    const postAssign = await db.query(`SELECT count(*) as count FROM public.exam_assignments WHERE exam_version_id = $1`, [versionId]);
    assert.equal(Number(postAssign.rows[0].count), 1, 'Assignments must be preserved');

    const postAttempts = await db.query(`SELECT count(*) as count FROM public.exam_attempts WHERE exam_version_id = $1`, [versionId]);
    assert.equal(Number(postAttempts.rows[0].count), 1, 'Attempts must be preserved');

    const postAnswers = await db.query(`SELECT count(*) as count FROM public.exam_attempt_answers WHERE attempt_id = $1`, [attemptId]);
    assert.equal(Number(postAnswers.rows[0].count), 1, 'Attempt answers must be preserved');

    const postScores = await db.query(`SELECT total_score FROM public.exam_attempts WHERE id = $1`, [attemptId]);
    assert.equal(Number(postScores.rows[0].total_score), 10, 'Scores must be preserved');

    recordPass('Expired exam with completed attempts is safely archived with 100% data preservation');
  }

  // =========================================================================
  // TEST 6: RBAC Authorization Checks
  // =========================================================================
  {
    const { examId } = await helperCreateDraftExam(db, {
      title: 'RBAC Test Exam',
      authorId: AUTHOR_ID
    });

    // 1. Other teacher -> Blocked ERR_UNAUTHORIZED
    let teacherThrew = false;
    try {
      await db.query(`
        SELECT public.rpc_exam_delete_or_archive_test($1, $2, false) as result;
      `, [OTHER_TEACHER_ID, examId]);
    } catch (err) {
      teacherThrew = true;
      assert.ok(
        err.message.includes('ERR_UNAUTHORIZED') || err.message.includes('ERR_FORBIDDEN') || err.message.includes('không có quyền'),
        `Expected permission error, got: ${err.message}`
      );
    }
    assert.equal(teacherThrew, true, 'Other teacher must be forbidden');

    // 2. Student (non-author, not admin) -> Blocked ERR_UNAUTHORIZED
    let studentThrew = false;
    try {
      await db.query(`
        SELECT public.rpc_exam_delete_or_archive_test($1, $2, false) as result;
      `, [STUDENT_ID, examId]);
    } catch (err) {
      studentThrew = true;
      assert.ok(
        err.message.includes('ERR_UNAUTHORIZED') || err.message.includes('ERR_FORBIDDEN') || err.message.includes('không có quyền'),
        `Expected permission error for student, got: ${err.message}`
      );
    }
    assert.equal(studentThrew, true, 'Student role must be forbidden');

    // 3. Admin -> Allowed
    const adminRes = await db.query(`
      SELECT public.rpc_exam_delete_or_archive_test($1, $2, true) as result;
    `, [ADMIN_ID, examId]);
    const res = adminRes.rows[0].result;
    assert.equal(res.success, true);
    assert.equal(res.action, 'deleted');

    recordPass('RBAC rules enforce author-only teacher permission and allows Admin override');
  }

  // =========================================================================
  // TEST 7: Idempotency (calling archive again on archived exam)
  // =========================================================================
  {
    const pastDue = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const { examId } = await helperPublishAndAssignExam(db, {
      title: 'Idempotency Exam',
      dueDate: pastDue
    });

    // First call -> archived
    const res1 = (await db.query(`
      SELECT public.rpc_exam_delete_or_archive_test($1, $2, false) as result;
    `, [AUTHOR_ID, examId])).rows[0].result;
    assert.equal(res1.action, 'archived');

    // Second call -> already_archived
    const res2 = (await db.query(`
      SELECT public.rpc_exam_delete_or_archive_test($1, $2, false) as result;
    `, [AUTHOR_ID, examId])).rows[0].result;
    assert.equal(res2.action, 'already_archived');
    assert.equal(res2.success, true);

    recordPass('Idempotency returns already_archived on successive calls');
  }

  // =========================================================================
  // TEST 8: Non-existent test ID -> ERR_TEST_NOT_FOUND
  // =========================================================================
  {
    const nonExistentId = nextUuid('9');
    let notFoundThrew = false;
    try {
      await db.query(`
        SELECT public.rpc_exam_delete_or_archive_test($1, $2, false) as result;
      `, [AUTHOR_ID, nonExistentId]);
    } catch (err) {
      notFoundThrew = true;
      assert.ok(
        err.message.includes('ERR_EXAM_NOT_FOUND') || err.message.includes('ERR_TEST_NOT_FOUND') || err.message.includes('Không tìm thấy'),
        `Expected not found error, got: ${err.message}`
      );
    }
    assert.equal(notFoundThrew, true, 'Non-existent test ID must throw not found error');

    recordPass('Non-existent test ID throws ERR_TEST_NOT_FOUND');
  }

  console.log(`\n✅ ALL ${passCount}/${totalTests} PGLITE RUNTIME SAFE DELETE TESTS PASSED!`);
}

runAllTests().catch((err) => {
  console.error('\n❌ PGLITE RUNTIME TEST FAILED:', err);
  process.exit(1);
});
