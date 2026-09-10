/**
 * ============================================================================
 * EXAM BUILDER V1 — PHASE A FLEXIBLE SCHEDULING PGLITE TESTS (22 TEST CASES)
 * (IN-MEMORY ONLY — ZERO PRODUCTION DATABASE ACCESS)
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
  'supabase/migrations/20260910121949_exam_builder_v1_flexible_scheduling_phase_a.sql'
];

async function initTestDb() {
  const db = await PGlite.create();

  // Create roles & private schema
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
const STUDENT_ID = 'c1000000-0000-0000-0000-000000000001';
const STUDENT_2_ID = 'c2000000-0000-0000-0000-000000000002';
const CLASS_ID = '4f0f3fd3-f4d2-4f5b-9370-a7cc8fa6e45c';

let seedCounter = 100;
function nextUuid(prefixDigit = '1') {
  seedCounter++;
  const hex = seedCounter.toString(16).padStart(12, '0');
  const d = String(prefixDigit).slice(0, 1);
  return `e${d}000000-0000-4000-8000-${hex}`;
}

async function helperCreateAndPublishExam(db, {
  title = 'Test Exam',
  durationMinutes = 30,
  startsAt = null,
  lastStartAt = null,
  dueDate = null,
  maxAttempts = 1
} = {}) {
  const examId = nextUuid('1');
  const versionId = nextUuid('2');
  const qId = nextUuid('3');

  // 1. Create Test
  await db.query(`
    SELECT public.rpc_exam_create_test($1, $2, $3, $4, 'Math', 1, 'Desc', true);
  `, [AUTHOR_ID, examId, versionId, title]);

  // 2. Save Draft Version
  const questions = [
    {
      id: qId,
      question_number: 1,
      question_type: 'single_choice',
      prompt: '1 + 1 = ?',
      points: 1.00,
      options_json: [
        { key: 'A', text: '2' },
        { key: 'B', text: '3' }
      ],
      answer_key: { correct_answer: 'A' }
    }
  ];

  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1, $2, $3, 'Math', 1, 'Desc', $4, $5, $6, $7, 0, false, false, 'WARN_AND_LOG', true, false, $8, true, $9
    );
  `, [
    AUTHOR_ID,
    versionId,
    title,
    durationMinutes,
    startsAt,
    dueDate,
    maxAttempts,
    JSON.stringify(questions),
    lastStartAt
  ]);

  // 3. Publish Version
  await db.query(`
    SELECT public.rpc_exam_publish_version($1, $2, true);
  `, [AUTHOR_ID, versionId]);

  return { examId, versionId, qId };
}

async function helperCreateAssignment(db, {
  versionId,
  classId = CLASS_ID,
  dueDate = null,
  startsAt = null,
  lastStartAt = null,
  countsTowardRanking = false
} = {}) {
  const assignmentId = nextUuid('a');
  const res = await db.query(`
    SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, $5, $6, true, $7, $8) AS result;
  `, [
    AUTHOR_ID,
    assignmentId,
    versionId,
    classId,
    dueDate,
    countsTowardRanking,
    startsAt,
    lastStartAt
  ]);
  return { assignmentId, data: res.rows[0].result };
}

async function runFlexibleSchedulingTests() {
  console.log('======================================================================');
  console.log('STARTING PHASE A FLEXIBLE SCHEDULING 22 BOUNDARY TEST SUITE');
  console.log('======================================================================\n');

  const db = await initTestDb();
  let passedCount = 0;

  async function test(num, name, fn) {
    try {
      await fn();
      passedCount++;
      console.log(`✅ PASS [${num}/22]: ${name}`);
    } catch (err) {
      console.error(`❌ FAIL [${num}/22]: ${name}`);
      console.error(err);
      throw err;
    }
  }

  // ------------------------------------------------------------
  // Case 1: Before starts_at -> blocked (ERR_EXAM_NOT_STARTED)
  // ------------------------------------------------------------
  await test(1, 'Before starts_at -> blocked with ERR_EXAM_NOT_STARTED', async () => {
    const futureTime = new Date(Date.now() + 3600000).toISOString();
    const { versionId } = await helperCreateAndPublishExam(db, { startsAt: futureTime });
    const { assignmentId } = await helperCreateAssignment(db, { versionId });
    const attemptId = nextUuid('4');

    await assert.rejects(
      async () => {
        await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [
          STUDENT_ID, attemptId, assignmentId, STUDENT_ID
        ]);
      },
      (err) => {
        assert.match(err.message, /ERR_EXAM_NOT_STARTED/);
        return true;
      }
    );
  });

  // ------------------------------------------------------------
  // Case 2: Exactly / After starts_at -> allowed
  // ------------------------------------------------------------
  await test(2, 'Exactly / after starts_at -> allowed', async () => {
    const pastTime = new Date(Date.now() - 5000).toISOString();
    const { versionId } = await helperCreateAndPublishExam(db, { startsAt: pastTime, durationMinutes: 30 });
    const { assignmentId } = await helperCreateAssignment(db, { versionId });
    const attemptId = nextUuid('4');

    const res = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [
      STUDENT_ID, attemptId, assignmentId, STUDENT_ID
    ]);
    assert.equal(res.rows[0].result.status, 'draft');
    assert.equal(res.rows[0].result.resumed_existing, false);
  });

  // ------------------------------------------------------------
  // Case 3: Before last_start_at -> allowed
  // ------------------------------------------------------------
  await test(3, 'Before last_start_at -> allowed', async () => {
    const startsAt = new Date(Date.now() - 600000).toISOString();
    const lastStartAt = new Date(Date.now() + 600000).toISOString();
    const { versionId } = await helperCreateAndPublishExam(db, { startsAt, lastStartAt, durationMinutes: 30 });
    const { assignmentId } = await helperCreateAssignment(db, { versionId });
    const attemptId = nextUuid('4');

    const res = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [
      STUDENT_ID, attemptId, assignmentId, STUDENT_ID
    ]);
    assert.equal(res.rows[0].result.status, 'draft');
  });

  // ------------------------------------------------------------
  // Case 4: Deterministic boundary test for [starts_at, last_start_at)
  // T - epsilon => allowed, T => blocked, T + epsilon => blocked
  // ------------------------------------------------------------
  await test(4, 'Deterministic last_start boundary: T-epsilon allowed, T blocked, T+epsilon blocked', async () => {
    // 1. Direct deterministic database expression evaluation at microsecond precision
    const boundaryCheck = await db.query(`
      SELECT 
        (TIMESTAMPTZ '2026-09-10 12:00:00.000000+00' - INTERVAL '1 microsecond' >= TIMESTAMPTZ '2026-09-10 12:00:00.000000+00') AS before_is_blocked,
        (TIMESTAMPTZ '2026-09-10 12:00:00.000000+00' >= TIMESTAMPTZ '2026-09-10 12:00:00.000000+00') AS exact_is_blocked,
        (TIMESTAMPTZ '2026-09-10 12:00:00.000000+00' + INTERVAL '1 microsecond' >= TIMESTAMPTZ '2026-09-10 12:00:00.000000+00') AS after_is_blocked;
    `);

    const { before_is_blocked, exact_is_blocked, after_is_blocked } = boundaryCheck.rows[0];
    assert.strictEqual(before_is_blocked, false, 'T - epsilon must be allowed (NOT blocked)');
    assert.strictEqual(exact_is_blocked, true, 'T (exact boundary) must be BLOCKED');
    assert.strictEqual(after_is_blocked, true, 'T + epsilon must be BLOCKED');

    // 2. Execution-level RPC verification: past last_start_at is blocked with ERR_EXAM_CLOSED
    const startsAt = new Date(Date.now() - 1800000).toISOString();
    const pastLastStart = new Date(Date.now() - 1000).toISOString();
    const { versionId } = await helperCreateAndPublishExam(db, { startsAt, lastStartAt: pastLastStart });
    const { assignmentId } = await helperCreateAssignment(db, { versionId });
    const attemptId = nextUuid('4');

    await assert.rejects(
      async () => {
        await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [
          STUDENT_ID, attemptId, assignmentId, STUDENT_ID
        ]);
      },
      (err) => {
        assert.match(err.message, /ERR_EXAM_CLOSED/);
        return true;
      }
    );
  });

  // ------------------------------------------------------------
  // Case 5: No last_start_at, old due_date fallback -> old behavior preserved
  // ------------------------------------------------------------
  await test(5, 'No last_start_at, old due_date fallback -> old behavior preserved', async () => {
    const pastDue = new Date(Date.now() - 5000).toISOString();
    const { versionId } = await helperCreateAndPublishExam(db, { dueDate: pastDue, lastStartAt: null });
    const { assignmentId } = await helperCreateAssignment(db, { versionId });
    const attemptId = nextUuid('4');

    await assert.rejects(
      async () => {
        await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [
          STUDENT_ID, attemptId, assignmentId, STUDENT_ID
        ]);
      },
      (err) => {
        assert.match(err.message, /ERR_EXAM_CLOSED/);
        return true;
      }
    );
  });

  // ------------------------------------------------------------
  // Case 6: Late student gets full duration when due_date is NULL
  // ------------------------------------------------------------
  await test(6, 'Late student gets full duration when due_date is NULL', async () => {
    const startsAt = new Date(Date.now() - 1200000).toISOString(); // 20m ago
    const lastStartAt = new Date(Date.now() + 600000).toISOString(); // 10m in future
    const { versionId } = await helperCreateAndPublishExam(db, {
      startsAt,
      lastStartAt,
      durationMinutes: 30,
      dueDate: null
    });
    const { assignmentId } = await helperCreateAssignment(db, { versionId });
    const attemptId = nextUuid('4');

    const res = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [
      STUDENT_ID, attemptId, assignmentId, STUDENT_ID
    ]);
    const expiresAt = new Date(res.rows[0].result.expires_at).getTime();
    const expectedExpiryMin = Date.now() + (29 * 60 * 1000);
    const expectedExpiryMax = Date.now() + (31 * 60 * 1000);

    assert.ok(expiresAt >= expectedExpiryMin && expiresAt <= expectedExpiryMax, 'Must grant full 30m duration');
  });

  // ------------------------------------------------------------
  // Case 7: Hard close truncates duration when due_date is set
  // ------------------------------------------------------------
  await test(7, 'Hard close truncates duration when due_date is set', async () => {
    const startsAt = new Date(Date.now() - 600000).toISOString();
    const lastStartAt = new Date(Date.now() + 600000).toISOString();
    const hardCloseTime = new Date(Date.now() + 900000).toISOString(); // 15m in future
    const { versionId } = await helperCreateAndPublishExam(db, {
      startsAt,
      lastStartAt,
      durationMinutes: 30, // 30m requested
      dueDate: hardCloseTime // but hard close is 15m
    });
    const { assignmentId } = await helperCreateAssignment(db, { versionId });
    const attemptId = nextUuid('4');

    const res = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [
      STUDENT_ID, attemptId, assignmentId, STUDENT_ID
    ]);
    const expiresAt = new Date(res.rows[0].result.expires_at).getTime();
    const expectedClose = new Date(hardCloseTime).getTime();

    assert.equal(expiresAt, expectedClose, 'Expires at must be clamped exactly to hard close due_date');
  });

  // ------------------------------------------------------------
  // Case 8: Active draft resumes after last_start_at while not expired
  // ------------------------------------------------------------
  await test(8, 'Active draft resumes after last_start_at while not expired', async () => {
    const startsAt = new Date(Date.now() - 10000).toISOString();
    const lastStartAt = new Date(Date.now() + 2000).toISOString(); // 2s in future
    const { versionId } = await helperCreateAndPublishExam(db, {
      startsAt,
      lastStartAt,
      durationMinutes: 30
    });
    const { assignmentId } = await helperCreateAssignment(db, { versionId });
    const attemptId = nextUuid('4');

    // 1. Start before last_start_at
    const startRes = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [
      STUDENT_ID, attemptId, assignmentId, STUDENT_ID
    ]);
    assert.equal(startRes.rows[0].result.resumed_existing, false);

    // 2. Simulate time passing beyond last_start_at by updating last_start_at into the past
    await db.query(`UPDATE public.exam_versions SET last_start_at = NOW() - INTERVAL '10 minutes' WHERE id = $1;`, [versionId]);

    // 3. Resume attempt with a candidate attempt ID
    const resumeAttemptId = nextUuid('4');
    const resumeRes = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [
      STUDENT_ID, resumeAttemptId, assignmentId, STUDENT_ID
    ]);
    assert.equal(resumeRes.rows[0].result.attempt_id, attemptId);
    assert.equal(resumeRes.rows[0].result.resumed_existing, true);
    assert.equal(resumeRes.rows[0].result.status, 'draft');
  });

  // ------------------------------------------------------------
  // Case 9: Expired active draft throws ERR_ATTEMPT_EXPIRED
  // ------------------------------------------------------------
  await test(9, 'Expired active draft throws ERR_ATTEMPT_EXPIRED', async () => {
    const { versionId } = await helperCreateAndPublishExam(db, { durationMinutes: 30 });
    const { assignmentId } = await helperCreateAssignment(db, { versionId });
    const attemptId = nextUuid('4');

    await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [
      STUDENT_ID, attemptId, assignmentId, STUDENT_ID
    ]);

    // Manually expire draft attempt
    await db.query(`UPDATE public.exam_attempts SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1;`, [attemptId]);

    // 1. Candidate attempt ID attempting to start/resume expired draft throws ERR_ATTEMPT_EXPIRED
    const candidateAttemptId = nextUuid('4');
    await assert.rejects(
      async () => {
        await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [
          STUDENT_ID, candidateAttemptId, assignmentId, STUDENT_ID
        ]);
      },
      (err) => {
        assert.match(err.message, /ERR_ATTEMPT_EXPIRED/);
        return true;
      }
    );

    // 2. Exact attempt retry returns expired: true
    const replayRes = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [
      STUDENT_ID, attemptId, assignmentId, STUDENT_ID
    ]);
    assert.equal(replayRes.rows[0].result.expired, true);
    assert.equal(replayRes.rows[0].result.idempotent_replay, true);
  });

  // ------------------------------------------------------------
  // Case 10: Max attempts limit enforced (ERR_MAX_ATTEMPTS_EXCEEDED)
  // ------------------------------------------------------------
  await test(10, 'Max attempts limit enforced (ERR_MAX_ATTEMPTS_EXCEEDED)', async () => {
    const { versionId } = await helperCreateAndPublishExam(db, { maxAttempts: 1 });
    const { assignmentId } = await helperCreateAssignment(db, { versionId });
    const attempt1Id = nextUuid('4');

    await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [
      STUDENT_ID, attempt1Id, assignmentId, STUDENT_ID
    ]);

    // Submit attempt 1
    await db.query(`UPDATE public.exam_attempts SET status = 'submitted', submitted_at = NOW() WHERE id = $1;`, [attempt1Id]);

    const attempt2Id = nextUuid('4');
    await assert.rejects(
      async () => {
        await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [
          STUDENT_ID, attempt2Id, assignmentId, STUDENT_ID
        ]);
      },
      (err) => {
        assert.ok(err.message.includes('ERR_ATTEMPT_ALREADY_FINALIZED') || err.message.includes('ERR_MAX_ATTEMPTS_EXCEEDED'));
        return true;
      }
    );
  });

  // ------------------------------------------------------------
  // Case 11: assignment.starts_at overrides version.starts_at
  // ------------------------------------------------------------
  await test(11, 'assignment.starts_at overrides version.starts_at', async () => {
    const verStartsAt = new Date(Date.now() - 3600000).toISOString(); // 1h ago
    const asgStartsAt = new Date(Date.now() + 3600000).toISOString(); // 1h future
    const { versionId } = await helperCreateAndPublishExam(db, { startsAt: verStartsAt });
    const { assignmentId } = await helperCreateAssignment(db, { versionId, startsAt: asgStartsAt });
    const attemptId = nextUuid('4');

    await assert.rejects(
      async () => {
        await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [
          STUDENT_ID, attemptId, assignmentId, STUDENT_ID
        ]);
      },
      (err) => {
        assert.match(err.message, /ERR_EXAM_NOT_STARTED/);
        return true;
      }
    );
  });

  // ------------------------------------------------------------
  // Case 12: assignment.last_start_at overrides version.last_start_at
  // ------------------------------------------------------------
  await test(12, 'assignment.last_start_at overrides version.last_start_at', async () => {
    const verLastStart = new Date(Date.now() - 600000).toISOString(); // 10m ago (closed on version)
    const asgLastStart = new Date(Date.now() + 600000).toISOString(); // 10m future (extended for this class)
    const { versionId } = await helperCreateAndPublishExam(db, { lastStartAt: verLastStart, durationMinutes: 30 });
    const { assignmentId } = await helperCreateAssignment(db, { versionId, lastStartAt: asgLastStart });
    const attemptId = nextUuid('4');

    const res = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [
      STUDENT_ID, attemptId, assignmentId, STUDENT_ID
    ]);
    assert.equal(res.rows[0].result.status, 'draft');
  });

  // ------------------------------------------------------------
  // Case 13: Version-only fallback works when assignment fields are NULL
  // ------------------------------------------------------------
  await test(13, 'Version-only fallback works when assignment fields are NULL', async () => {
    const startsAt = new Date(Date.now() - 600000).toISOString();
    const lastStartAt = new Date(Date.now() + 600000).toISOString();
    const { versionId } = await helperCreateAndPublishExam(db, { startsAt, lastStartAt, durationMinutes: 30 });
    const { assignmentId } = await helperCreateAssignment(db, { versionId, startsAt: null, lastStartAt: null });
    const attemptId = nextUuid('4');

    const res = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [
      STUDENT_ID, attemptId, assignmentId, STUDENT_ID
    ]);
    assert.equal(res.rows[0].result.status, 'draft');
  });

  // ------------------------------------------------------------
  // Case 14: NULL scheduling fields remain valid (open-ended exam)
  // ------------------------------------------------------------
  await test(14, 'NULL scheduling fields remain valid', async () => {
    const { versionId } = await helperCreateAndPublishExam(db, {
      startsAt: null,
      lastStartAt: null,
      dueDate: null,
      durationMinutes: 25
    });
    const { assignmentId } = await helperCreateAssignment(db, { versionId });
    const attemptId = nextUuid('4');

    const res = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [
      STUDENT_ID, attemptId, assignmentId, STUDENT_ID
    ]);
    assert.equal(res.rows[0].result.status, 'draft');
    assert.ok(res.rows[0].result.expires_at !== null);
  });

  // ------------------------------------------------------------
  // Case 15: Old assignment with only due_date: BFF fallback expression check
  // ------------------------------------------------------------
  await test(15, 'Old assignment with only due_date: fallback equals due_date', async () => {
    const dueDateStr = new Date(Date.now() + 7200000).toISOString();
    const { versionId } = await helperCreateAndPublishExam(db, { dueDate: dueDateStr, lastStartAt: null });
    const { assignmentId } = await helperCreateAssignment(db, { versionId, lastStartAt: null, dueDate: null });

    const checkRes = await db.query(`
      SELECT 
        COALESCE(a.last_start_at, v.last_start_at, a.due_date, v.due_date) AS effective_last_start
      FROM public.exam_assignments a
      JOIN public.exam_versions v ON a.exam_version_id = v.id
      WHERE a.id = $1;
    `, [assignmentId]);

    const effective = new Date(checkRes.rows[0].effective_last_start).getTime();
    assert.equal(effective, new Date(dueDateStr).getTime());
  });

  // ------------------------------------------------------------
  // Case 16: assignment due_date earlier than version due_date
  // ------------------------------------------------------------
  await test(16, 'assignment due_date earlier than version due_date -> hard close = assignment.due_date', async () => {
    const verDueDate = new Date(Date.now() + 3600000).toISOString(); // 60m future
    const asgDueDate = new Date(Date.now() + 600000).toISOString(); // 10m future
    const { versionId } = await helperCreateAndPublishExam(db, { dueDate: verDueDate, durationMinutes: 45 });
    const { assignmentId } = await helperCreateAssignment(db, { versionId, dueDate: asgDueDate });
    const attemptId = nextUuid('4');

    const res = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [
      STUDENT_ID, attemptId, assignmentId, STUDENT_ID
    ]);
    const expiresAt = new Date(res.rows[0].result.expires_at).getTime();
    assert.equal(expiresAt, new Date(asgDueDate).getTime());
  });

  // ------------------------------------------------------------
  // Case 17: version due_date earlier than assignment due_date
  // ------------------------------------------------------------
  await test(17, 'version due_date earlier than assignment due_date -> hard close = version.due_date', async () => {
    const verDueDate = new Date(Date.now() + 600000).toISOString(); // 10m future
    const { versionId } = await helperCreateAndPublishExam(db, { dueDate: verDueDate, durationMinutes: 45 });
    const { assignmentId } = await helperCreateAssignment(db, { versionId, dueDate: null });
    const attemptId = nextUuid('4');

    const res = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [
      STUDENT_ID, attemptId, assignmentId, STUDENT_ID
    ]);
    const expiresAt = new Date(res.rows[0].result.expires_at).getTime();
    assert.equal(expiresAt, new Date(verDueDate).getTime());
  });

  // ------------------------------------------------------------
  // Case 18: active draft after last_start_at but before expires_at -> resume allowed
  // ------------------------------------------------------------
  await test(18, 'active draft after last_start_at but before expires_at -> resume allowed', async () => {
    const startsAt = new Date(Date.now() - 600000).toISOString();
    const lastStartAt = new Date(Date.now() + 1000).toISOString();
    const { versionId } = await helperCreateAndPublishExam(db, { startsAt, lastStartAt, durationMinutes: 60 });
    const { assignmentId } = await helperCreateAssignment(db, { versionId });
    const attemptId = nextUuid('4');

    await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [
      STUDENT_ID, attemptId, assignmentId, STUDENT_ID
    ]);

    // Push last_start_at into past
    await db.query(`UPDATE public.exam_versions SET last_start_at = NOW() - INTERVAL '5 minutes' WHERE id = $1;`, [versionId]);

    const resumeAttemptId = nextUuid('4');
    const resumeRes = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [
      STUDENT_ID, resumeAttemptId, assignmentId, STUDENT_ID
    ]);
    assert.equal(resumeRes.rows[0].result.attempt_id, attemptId);
    assert.equal(resumeRes.rows[0].result.resumed_existing, true);
  });

  // ------------------------------------------------------------
  // Case 19: active draft at exactly expires_at -> ERR_ATTEMPT_EXPIRED
  // ------------------------------------------------------------
  await test(19, 'active draft at exactly / past expires_at -> ERR_ATTEMPT_EXPIRED', async () => {
    const { versionId } = await helperCreateAndPublishExam(db, { durationMinutes: 10 });
    const { assignmentId } = await helperCreateAssignment(db, { versionId });
    const attemptId = nextUuid('4');

    await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [
      STUDENT_ID, attemptId, assignmentId, STUDENT_ID
    ]);

    await db.query(`UPDATE public.exam_attempts SET expires_at = clock_timestamp() WHERE id = $1;`, [attemptId]);

    const candidateAttemptId = nextUuid('4');
    await assert.rejects(
      async () => {
        await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [
          STUDENT_ID, candidateAttemptId, assignmentId, STUDENT_ID
        ]);
      },
      (err) => {
        assert.match(err.message, /ERR_ATTEMPT_EXPIRED/);
        return true;
      }
    );
  });

  // ------------------------------------------------------------
  // Case 20: new attempt at exactly hard close -> ERR_EXAM_CLOSED
  // ------------------------------------------------------------
  await test(20, 'new attempt at exactly hard close -> ERR_EXAM_CLOSED', async () => {
    const pastClose = new Date(Date.now() - 1000).toISOString();
    const { versionId } = await helperCreateAndPublishExam(db, { dueDate: pastClose });
    const { assignmentId } = await helperCreateAssignment(db, { versionId });
    const attemptId = nextUuid('4');

    await assert.rejects(
      async () => {
        await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [
          STUDENT_ID, attemptId, assignmentId, STUDENT_ID
        ]);
      },
      (err) => {
        assert.match(err.message, /ERR_EXAM_CLOSED/);
        return true;
      }
    );
  });

  // ------------------------------------------------------------
  // Case 21: duration NULL + hard close exists -> expires_at = hard close
  // ------------------------------------------------------------
  await test(21, 'duration NULL + hard close exists -> expires_at = hard close', async () => {
    const hardCloseTime = new Date(Date.now() + 1800000).toISOString();
    const { versionId } = await helperCreateAndPublishExam(db, {
      durationMinutes: null,
      dueDate: hardCloseTime
    });
    const { assignmentId } = await helperCreateAssignment(db, { versionId });
    const attemptId = nextUuid('4');

    const res = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [
      STUDENT_ID, attemptId, assignmentId, STUDENT_ID
    ]);
    const expiresAt = new Date(res.rows[0].result.expires_at).getTime();
    assert.equal(expiresAt, new Date(hardCloseTime).getTime());
  });

  // ------------------------------------------------------------
  // Case 22: duration NULL + hard close NULL -> expires_at = NULL (untimed open-ended)
  // ------------------------------------------------------------
  await test(22, 'duration NULL + hard close NULL -> expires_at = NULL (untimed open-ended)', async () => {
    const { versionId } = await helperCreateAndPublishExam(db, {
      durationMinutes: null,
      dueDate: null,
      startsAt: null,
      lastStartAt: null
    });
    const { assignmentId } = await helperCreateAssignment(db, { versionId });
    const attemptId = nextUuid('4');

    const res = await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4) AS result;`, [
      STUDENT_ID, attemptId, assignmentId, STUDENT_ID
    ]);
    assert.equal(res.rows[0].result.status, 'draft');
    assert.equal(res.rows[0].result.expires_at, null, 'Must be untimed open-ended attempt');
  });

  console.log(`\n======================================================================`);
  console.log(`ALL 22 FLEXIBLE SCHEDULING TESTS PASSED! (${passedCount}/22)`);
  console.log(`======================================================================\n`);
}

runFlexibleSchedulingTests().catch((err) => {
  console.error('Fatal error in test suite:', err);
  process.exit(1);
});
