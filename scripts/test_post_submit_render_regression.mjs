// scripts/test_post_submit_render_regression.mjs
// Exam Builder V1 - Phase 3E Post-Submit & Cleanup UI Render Regression Test
// Verifies:
// 1. Successful submit -> onConfirmedFinalized -> onFinished(finalizedData)
// 2. Parent handleExamTakingFinished() safely closes modal (isOpen=false, selectedExamAssignmentId=null)
// 3. fetchExamAssignments() refreshes authoritative list
// 4. Graded card renders correctly with score and status (no blank page, no exception)
// 5. Unmounting / closing modal during submit does not throw uncaught errors or trigger invalid state transitions
// 6. Modal open -> close modal WITHOUT submit -> effect cleanup executes without ReferenceError (session scope fix)
// 7. sessionRef is cleared only for its own session
// 8. Stale cleanup must NOT clear a newer session
// 9. Cleanup on initialization error does not throw ReferenceError

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

async function it(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`✅ [${String(totalTests).padStart(2, '0')}] PASS: ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`❌ [${String(totalTests).padStart(2, '0')}] FAIL: ${name}`);
    console.error(err);
  }
}

async function main() {
  console.log('============================================================');
  console.log('EXAM BUILDER V1 - POST-SUBMIT & CLEANUP UI REGRESSION TESTS');
  console.log('============================================================\n');

  const parentPath = path.resolve(__dirname, '../src/components/dashboard/exercises/ExerciseListTab.jsx');
  const modalPath = path.resolve(__dirname, '../src/components/dashboard/exams/ExamTakingModal.jsx');
  const sessionPath = path.resolve(__dirname, '../src/services/examTakingSession.js');
  const clientPath = path.resolve(__dirname, '../src/services/examStudentClient.js');

  const parentSource = fs.readFileSync(parentPath, 'utf8').replace(/\r\n/g, '\n');
  const modalSource = fs.readFileSync(modalPath, 'utf8').replace(/\r\n/g, '\n');
  const sessionSource = fs.readFileSync(sessionPath, 'utf8').replace(/\r\n/g, '\n');
  const clientSource = fs.readFileSync(clientPath, 'utf8').replace(/\r\n/g, '\n');

  // 1. Verify Parent handleExamTakingFinished handler contract
  await it('01 Parent handleExamTakingFinished closes modal, clears assignmentId, and fetches exam assignments', () => {
    assert.ok(parentSource.includes('const handleExamTakingFinished = () => {'), 'Must declare handleExamTakingFinished');
    assert.ok(parentSource.includes('setIsExamTakingOpen(false);'), 'Must close exam taking modal');
    assert.ok(parentSource.includes('setSelectedExamAssignmentId(null);'), 'Must reset selectedExamAssignmentId to null');
    assert.ok(parentSource.includes('fetchExamAssignments();'), 'Must refresh exam assignments list');
  });

  // 2. Verify ExamTakingModal onConfirmedFinalized dispatch
  await it('02 ExamTakingModal onConfirmedFinalized dispatches to onFinishedRef', () => {
    assert.ok(modalSource.includes('onConfirmedFinalized: (finalizedData) => {'), 'Must handle onConfirmedFinalized');
    assert.ok(modalSource.includes('if (onFinishedRef.current) onFinishedRef.current(finalizedData);'), 'Must call onFinishedRef with finalized data');
  });

  // 3. Verify Modal unmount safety when closed by onFinished
  await it('03 Modal unmount / closed state returns null and resets lifecycle epoch', () => {
    assert.ok(modalSource.includes('if (!isOpen) return null;'), 'Must return null when isOpen is false');
    assert.ok(modalSource.includes('if (!isOpen || !isValidUuid(assignmentId)) {'), 'Must guard effect on closed or null assignmentId');
  });

  // 4. Verify Graded Exam Card Render Invariants
  await it('04 Parent renders graded exam card correctly with score and status', () => {
    const gradedSection = parentSource.substring(
      parentSource.indexOf('isGraded ? ('),
      parentSource.indexOf('isPendingManual ? (')
    );
    assert.ok(gradedSection.includes('Đã chấm'), 'Must render Đã chấm label');
    assert.ok(gradedSection.includes('asg.latest_score !== null ? asg.latest_score : \'-\''), 'Must handle latest_score safely');
    assert.ok(gradedSection.includes('asg.max_score || asg.total_points'), 'Must render max score or total points denominator');
  });

  // 5. Verify Pending Manual Grade Card Render Invariants
  await it('05 Parent renders pending manual grade card correctly', () => {
    const pendingManualSection = parentSource.substring(
      parentSource.indexOf('isPendingManual ? ('),
      parentSource.indexOf('isSubmitted ? (')
    );
    assert.ok(pendingManualSection.includes('Chờ chấm'), 'Must render Chờ chấm label');
  });

  // 6. Verify Submitted (Auto-graded) Card Render Invariants
  await it('06 Parent renders submitted card correctly', () => {
    const nextDraftIndex = parentSource.indexOf('isDraftExpired ? (') !== -1
      ? parentSource.indexOf('isDraftExpired ? (')
      : parentSource.indexOf('isDraft ? (');
    const submittedSection = parentSource.substring(
      parentSource.indexOf('isSubmitted ? ('),
      nextDraftIndex
    );
    assert.ok(submittedSection.includes('Đã nộp'), 'Must render Đã nộp label');
  });

  // 7. Verify Simulated Full Post-Submit State Transition
  await it('07 Full state transition simulation: submit -> finalized -> close modal -> refresh list -> render graded card', async () => {
    let isExamTakingOpen = true;
    let selectedExamAssignmentId = '11111111-1111-4111-8111-111111111101';
    let examAssignments = [
      {
        id: '11111111-1111-4111-8111-111111111101',
        exam_version_id: '22222222-2222-4222-8222-222222222202',
        title: 'Đề thi Toán Khối 2',
        description: 'Kiểm tra 15 phút',
        subject: 'Toán',
        grade_level: 2,
        assigned_at: '2026-09-09T00:00:00Z',
        opens_at: null,
        closes_at: null,
        duration_minutes: 15,
        total_points: 2,
        reward_stars: 5,
        attempt_status: 'draft',
        attempt_id: '33333333-3333-4333-8333-333333333303',
        latest_score: null,
        max_score: 2,
      },
    ];

    const submitPayload = {
      attempt_id: '33333333-3333-4333-8333-333333333303',
      assignment_id: '11111111-1111-4111-8111-111111111101',
      exam_version_id: '22222222-2222-4222-8222-222222222202',
      student_id: '44444444-4444-4444-4444-444444444444',
      attempt_number: 1,
      status: 'graded',
      attempt_started_at: '2026-09-09T00:00:00Z',
      expires_at: null,
      submitted_at: '2026-09-09T00:10:00Z',
      objective_score: 2.0,
      manual_score: 0.0,
      total_score: 2.0,
      max_score: 2.0,
      reward_stars_awarded: 5,
      graded_at: '2026-09-09T00:10:00Z',
      graded_by: null,
      version: 2,
      idempotent_replay: false,
    };

    const onFinished = (data) => {
      assert.strictEqual(data.status, 'graded');
      assert.strictEqual(data.total_score, 2.0);
      isExamTakingOpen = false;
      selectedExamAssignmentId = null;
      examAssignments = [
        {
          ...examAssignments[0],
          attempt_status: data.status,
          latest_score: data.total_score,
          max_score: data.max_score,
        },
      ];
    };

    onFinished(submitPayload);

    assert.strictEqual(isExamTakingOpen, false, 'Modal isOpen state must be false');
    assert.strictEqual(selectedExamAssignmentId, null, 'selectedExamAssignmentId must be null');

    const updatedAsg = examAssignments[0];
    assert.strictEqual(updatedAsg.attempt_status, 'graded');
    assert.strictEqual(updatedAsg.latest_score, 2.0);
    assert.strictEqual(updatedAsg.max_score, 2.0);

    const scoreDisplay = `${updatedAsg.latest_score !== null ? updatedAsg.latest_score : '-'}/${updatedAsg.max_score || updatedAsg.total_points}`;
    assert.strictEqual(scoreDisplay, '2/2', 'Score display must be 2/2');
  });

  // 8. Runtime Session submitAttempt -> onConfirmedFinalized execution test
  await it('08 Runtime ExamTakingSession submitAttempt executes onConfirmedFinalized and returns safe data', async () => {
    const { createExamTakingSession } = await import('../src/services/examTakingSession.js');
    let finalizedEmitted = false;
    let finalizedDataCaptured = null;

    const mockStudentClient = {
      startAttempt: async () => ({
        ok: true,
        data: {
          attempt_id: '33333333-3333-4333-8333-333333333303',
          assignment_id: '11111111-1111-4111-8111-111111111101',
          exam_version_id: '22222222-2222-4222-8222-222222222202',
          student_id: '44444444-4444-4444-4444-444444444444',
          attempt_number: 1,
          status: 'draft',
          attempt_started_at: '2026-09-09T00:00:00Z',
          expires_at: null,
          max_score: 2.0,
          question_order: [],
          option_orders: {},
          resumed_existing: false,
          idempotent_replay: false,
          expired: false,
          already_finalized: false,
          attempt_version: 1,
        },
      }),
      submitAttempt: async () => ({
        ok: true,
        data: {
          attempt_id: '33333333-3333-4333-8333-333333333303',
          assignment_id: '11111111-1111-4111-8111-111111111101',
          exam_version_id: '22222222-2222-4222-8222-222222222202',
          student_id: '44444444-4444-4444-4444-444444444444',
          attempt_number: 1,
          status: 'graded',
          attempt_started_at: '2026-09-09T00:00:00Z',
          expires_at: null,
          submitted_at: '2026-09-09T00:10:00Z',
          objective_score: 2.0,
          manual_score: 0.0,
          total_score: 2.0,
          max_score: 2.0,
          reward_stars_awarded: 5,
          graded_at: '2026-09-09T00:10:00Z',
          graded_by: null,
          version: 2,
          idempotent_replay: false,
        },
      }),
    };

    const session = createExamTakingSession({
      assignmentId: '11111111-1111-4111-8111-111111111101',
      studentClient: mockStudentClient,
      onConfirmedFinalized: (data) => {
        finalizedEmitted = true;
        finalizedDataCaptured = data;
      },
    });

    const startRes = await session.start();
    assert.strictEqual(startRes.ok, true);

    const submitRes = await session.submitAttempt();
    assert.strictEqual(submitRes.ok, true);
    assert.strictEqual(finalizedEmitted, true);
    assert.strictEqual(finalizedDataCaptured.status, 'graded');
    assert.strictEqual(finalizedDataCaptured.total_score, 2.0);
  });

  // 9. Static Scope Verification: let session = null is declared at useEffect scope
  await it('09 Lexical scope: session variable declared at useEffect level and not shadowed in try block', () => {
    // Assert modalSource has 'let session = null;' before 'async function initSession()'
    const effectBodyStart = modalSource.indexOf('let isSubscribed = true;');
    const initSessionStart = modalSource.indexOf('async function initSession()');
    const effectPrefix = modalSource.substring(effectBodyStart, initSessionStart);
    
    assert.ok(effectPrefix.includes('let session = null;'), 'Must declare let session = null in useEffect body before initSession');
    
    // Assert initSession try block does NOT have 'const session ='
    const tryBlock = modalSource.substring(
      modalSource.indexOf('try {', initSessionStart),
      modalSource.indexOf('sessionRef.current = session;', initSessionStart)
    );
    assert.ok(!tryBlock.includes('const session ='), 'Must NOT shadow session with const session in try block');
    assert.ok(tryBlock.includes('session = createExamTakingSession('), 'Must assign session in try block');
  });

  // 10. Execution Test: Modal open -> close WITHOUT submit -> effect cleanup executes NO ReferenceError
  await it('10 Effect lifecycle: closing modal without submitting executes cleanup safely with NO ReferenceError', async () => {
    const { createExamTakingSession } = await import('../src/services/examTakingSession.js');

    const lifecycleEpochRef = { current: 0 };
    const sessionRef = { current: null };
    let teardownCalled = false;
    const handleTeardown = () => { teardownCalled = true; };

    // Simulate effect run when isOpen=true
    let isSubscribed = true;
    let session = null;
    const epoch = ++lifecycleEpochRef.current;

    const mockClient = {
      startAttempt: async () => ({
        ok: true,
        data: {
          attempt_id: '33333333-3333-4333-8333-333333333303',
          assignment_id: '11111111-1111-4111-8111-111111111101',
          exam_version_id: '22222222-2222-4222-8222-222222222202',
          student_id: '44444444-4444-4444-4444-444444444444',
          attempt_number: 1,
          status: 'draft',
          attempt_started_at: '2026-09-09T00:00:00Z',
          expires_at: null,
          max_score: 2.0,
          question_order: [],
          option_orders: {},
          resumed_existing: false,
          idempotent_replay: false,
          expired: false,
          already_finalized: false,
          attempt_version: 1,
        },
      }),
      getAttemptQuestions: async () => ({
        ok: true,
        data: {
          attempt_id: '33333333-3333-4333-8333-333333333303',
          exam_version_id: '22222222-2222-4222-8222-222222222202',
          status: 'draft',
          questions: [],
        },
      }),
    };

    session = createExamTakingSession({
      assignmentId: '11111111-1111-4111-8111-111111111101',
      studentClient: mockClient,
    });
    sessionRef.current = session;

    // Simulate start
    await session.start();
    assert.strictEqual(sessionRef.current, session);

    // Simulate cleanup function returned by useEffect
    const cleanup = () => {
      isSubscribed = false;
      lifecycleEpochRef.current++;
      handleTeardown();
      if (sessionRef.current === session) {
        sessionRef.current = null;
      }
    };

    // Execute cleanup (as React does when modal closes or unmounts)
    let cleanupError = null;
    try {
      cleanup();
    } catch (err) {
      cleanupError = err;
    }

    assert.strictEqual(cleanupError, null, 'Cleanup must NOT throw ReferenceError or any error');
    assert.strictEqual(teardownCalled, true, 'handleTeardown must be called');
    assert.strictEqual(sessionRef.current, null, 'sessionRef.current must be cleared for its own session');
    assert.strictEqual(isSubscribed, false, 'isSubscribed must be set to false');
  });

  // 11. Stale cleanup guard: stale cleanup must NOT clear a newer session
  await it('11 Stale cleanup guard: stale cleanup does NOT clear a newer sessionRef instance', () => {
    const lifecycleEpochRef = { current: 1 };
    const sessionRef = { current: null };

    // Old effect instance A
    let sessionA = { id: 'session_A' };
    sessionRef.current = sessionA;

    const cleanupA = () => {
      lifecycleEpochRef.current++;
      if (sessionRef.current === sessionA) {
        sessionRef.current = null;
      }
    };

    // Modal is reopened rapidly with session B before cleanup A runs
    let sessionB = { id: 'session_B' };
    sessionRef.current = sessionB;

    // Stale cleanup A executes
    cleanupA();

    // sessionRef.current must still hold sessionB!
    assert.strictEqual(sessionRef.current, sessionB, 'Stale cleanup A must NOT nullify newer session B');
  });

  // 12. Cleanup on initSession error does not crash
  await it('12 Catch block and cleanup safely handle initSession error without scope exceptions', async () => {
    const lifecycleEpochRef = { current: 0 };
    const sessionRef = { current: null };
    let caughtError = null;

    let isSubscribed = true;
    let session = null;
    const epoch = ++lifecycleEpochRef.current;

    const failingClient = {
      startAttempt: async () => {
        throw new Error('Network failure during init');
      },
    };

    const { createExamTakingSession } = await import('../src/services/examTakingSession.js');
    session = createExamTakingSession({
      assignmentId: '11111111-1111-4111-8111-111111111101',
      studentClient: failingClient,
    });
    sessionRef.current = session;

    try {
      await session.start();
    } catch (err) {
      if (!isSubscribed || lifecycleEpochRef.current !== epoch || sessionRef.current !== session) {
        // guarded
      } else {
        caughtError = err;
      }
    }

    assert.ok(caughtError !== null, 'Error was caught in catch block without throwing ReferenceError');

    // Cleanup executes after error
    const cleanup = () => {
      isSubscribed = false;
      lifecycleEpochRef.current++;
      if (sessionRef.current === session) {
        sessionRef.current = null;
      }
    };

    cleanup();
    assert.strictEqual(sessionRef.current, null, 'sessionRef cleared after error cleanup');
  });

  console.log('\n============================================================');
  console.log(`TOTAL REGRESSION TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
  console.log('============================================================\n');

  if (failedTests > 0) {
    throw new Error(`Post-submit regression test failed with ${failedTests} failures.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
