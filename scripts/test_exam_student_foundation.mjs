// scripts/test_exam_student_foundation.mjs
// Exam Builder V1 - Phase 3E-A Frontend Foundation Unit Tests
// Tests ExamStudentClient, ExamTakingSession, and Phase 3D Attempt State Reset Hardening

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ExamStudentClient,
  START_FUNCTION_NAME,
  SAVE_FUNCTION_NAME,
  SUBMIT_FUNCTION_NAME,
  validateStartResponse,
  validateSaveResponse,
  validateSubmitResponse,
  sanitizeClientError,
  generateProvisionalAttemptId,
  isValidUuid,
} from '../src/services/examStudentClient.js';
import {
  ExamTakingSession,
  CONFIRMED_FINALIZED_STATUSES,
} from '../src/services/examTakingSession.js';
import {
  canonicalizeAttemptId,
  shouldResetIntegrityState,
  sanitizeIntegrityResult,
  sanitizeIntegrityError,
} from '../src/hooks/useExamIntegrity.js';

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

const TEST_ASSIGNMENT_ID = '11111111-1111-4111-8111-111111111111';
const TEST_ATTEMPT_ID_1 = '22222222-2222-4222-8222-222222222222';
const TEST_ATTEMPT_ID_2 = '33333333-3333-4333-8333-333333333333';
const TEST_QUESTION_ID_1 = '44444444-4444-4444-8444-444444444444';
const TEST_EXAM_VERSION_ID = '55555555-5555-4555-8555-555555555555';
const TEST_STUDENT_ID = '66666666-6666-4666-8666-666666666666';

function createValidStartData(overrides = {}) {
  return {
    attempt_id: TEST_ATTEMPT_ID_1,
    assignment_id: TEST_ASSIGNMENT_ID,
    exam_version_id: TEST_EXAM_VERSION_ID,
    student_id: TEST_STUDENT_ID,
    attempt_number: 1,
    status: 'draft',
    attempt_started_at: '2026-09-06T12:00:00.000Z',
    expires_at: '2026-09-06T13:00:00.000Z',
    max_score: 100,
    question_order: [TEST_QUESTION_ID_1],
    option_orders: { [TEST_QUESTION_ID_1]: ['A', 'B', 'C', 'D'] },
    attempt_version: 1,
    resumed_existing: false,
    idempotent_replay: false,
    expired: false,
    already_finalized: false,
    ...overrides,
  };
}

function createValidStartEnvelope(overrides = {}) {
  return {
    success: true,
    data: createValidStartData(overrides),
  };
}

function createValidSaveData(overrides = {}) {
  return {
    attempt_id: TEST_ATTEMPT_ID_1,
    exam_question_id: TEST_QUESTION_ID_1,
    grading_status: 'auto_graded',
    attempt_version: 2,
    ...overrides,
  };
}

function createValidSaveEnvelope(overrides = {}) {
  return {
    success: true,
    data: createValidSaveData(overrides),
  };
}

function createValidSubmitData(overrides = {}) {
  return {
    attempt_id: TEST_ATTEMPT_ID_1,
    assignment_id: TEST_ASSIGNMENT_ID,
    exam_version_id: TEST_EXAM_VERSION_ID,
    student_id: TEST_STUDENT_ID,
    attempt_number: 1,
    status: 'graded',
    attempt_started_at: '2026-09-06T12:00:00.000Z',
    expires_at: '2026-09-06T13:00:00.000Z',
    submitted_at: '2026-09-06T12:45:00.000Z',
    objective_score: 80,
    manual_score: null,
    total_score: 80,
    max_score: 100,
    reward_stars_awarded: 5,
    graded_at: '2026-09-06T12:45:01.000Z',
    graded_by: null,
    version: 3,
    idempotent_replay: false,
    ...overrides,
  };
}

function createValidSubmitEnvelope(overrides = {}) {
  return {
    success: true,
    data: createValidSubmitData(overrides),
  };
}

async function main() {
  console.log('====================================================');
  console.log('EXAM BUILDER V1 - PHASE 3E-A FOUNDATION UNIT TESTS');
  console.log('====================================================\n');

  // ===============================================================
  // 1. Student Client Tests (01..29)
  // ===============================================================
  await it('01 exact function names defined', () => {
    assert.strictEqual(START_FUNCTION_NAME, 'exam-start-attempt');
    assert.strictEqual(SAVE_FUNCTION_NAME, 'exam-save-answer');
    assert.strictEqual(SUBMIT_FUNCTION_NAME, 'exam-submit-attempt');
  });

  await it('02 startAttempt sends exact assignment_id and attempt_id', async () => {
    let calledFn = null;
    let sentBody = null;
    const client = new ExamStudentClient({
      invokeFunction: async (fn, { body }) => {
        calledFn = fn;
        sentBody = body;
        return { data: createValidStartEnvelope() };
      },
    });

    const res = await client.startAttempt({
      assignmentId: TEST_ASSIGNMENT_ID,
      attemptId: TEST_ATTEMPT_ID_1,
    });

    assert.strictEqual(calledFn, 'exam-start-attempt');
    assert.deepStrictEqual(sentBody, {
      assignment_id: TEST_ASSIGNMENT_ID,
      attempt_id: TEST_ATTEMPT_ID_1,
    });
    assert.strictEqual(res.ok, true);
  });

  await it('03 startAttempt generates provisional UUID when attemptId omitted', async () => {
    let sentBody = null;
    const client = new ExamStudentClient({
      invokeFunction: async (fn, { body }) => {
        sentBody = body;
        return { data: createValidStartEnvelope({ attempt_id: body.attempt_id }) };
      },
    });

    const res = await client.startAttempt({ assignmentId: TEST_ASSIGNMENT_ID });
    assert.strictEqual(res.ok, true);
    assert.ok(isValidUuid(sentBody.attempt_id));
  });

  await it('04 startAttempt validates strictly 16 fields inside success envelope', () => {
    const validEnvelope = createValidStartEnvelope();
    const validated = validateStartResponse(validEnvelope);
    assert.ok(validated);
    assert.strictEqual(Object.keys(validated).length, 16);
  });

  await it('05 startAttempt malformed response missing attempt_version rejected', () => {
    const invalid = createValidStartEnvelope({ attempt_version: undefined });
    delete invalid.data.attempt_version;
    assert.strictEqual(validateStartResponse(invalid), null);
  });

  await it('06 startAttempt attempt_version must be integer >= 1', () => {
    assert.strictEqual(validateStartResponse(createValidStartEnvelope({ attempt_version: 0 })), null);
    assert.strictEqual(validateStartResponse(createValidStartEnvelope({ attempt_version: -1 })), null);
    assert.strictEqual(validateStartResponse(createValidStartEnvelope({ attempt_version: 1.5 })), null);
    assert.strictEqual(validateStartResponse(createValidStartEnvelope({ attempt_version: '1' })), null);
  });

  await it('07 saveAnswer sends exact request fields', async () => {
    let calledFn = null;
    let sentBody = null;
    const client = new ExamStudentClient({
      invokeFunction: async (fn, { body }) => {
        calledFn = fn;
        sentBody = body;
        return { data: createValidSaveEnvelope() };
      },
    });

    const res = await client.saveAnswer({
      attemptId: TEST_ATTEMPT_ID_1,
      examQuestionId: TEST_QUESTION_ID_1,
      studentAnswerJson: { selected: ['A'] },
      expectedVersion: 1,
    });

    assert.strictEqual(calledFn, 'exam-save-answer');
    assert.deepStrictEqual(sentBody, {
      attempt_id: TEST_ATTEMPT_ID_1,
      exam_question_id: TEST_QUESTION_ID_1,
      student_answer_json: { selected: ['A'] },
      file_url: null,
      expected_version: 1,
    });
    assert.strictEqual(res.ok, true);
  });

  await it('08 saveAnswer rejects non-null file_url (Phase 3E-A gate)', async () => {
    let called = false;
    const client = new ExamStudentClient({
      invokeFunction: async () => {
        called = true;
        return { data: createValidSaveEnvelope() };
      },
    });

    const res = await client.saveAnswer({
      attemptId: TEST_ATTEMPT_ID_1,
      examQuestionId: TEST_QUESTION_ID_1,
      file_url: 'https://example.com/file.png',
      expectedVersion: 1,
    });

    assert.strictEqual(called, false);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.safeErrorCode, 'ERR_EXAM_UPLOAD_NOT_READY');
  });

  await it('09 saveAnswer validates strictly 4 fields inside success envelope', () => {
    const valid = createValidSaveEnvelope();
    const validated = validateSaveResponse(valid);
    assert.ok(validated);
    assert.strictEqual(Object.keys(validated).length, 4);
    assert.strictEqual(validated.attempt_version, 2);
  });

  await it('10 saveAnswer rejects invalid expectedVersion', async () => {
    const client = new ExamStudentClient({ invokeFunction: async () => ({}) });
    const resZero = await client.saveAnswer({
      attemptId: TEST_ATTEMPT_ID_1,
      examQuestionId: TEST_QUESTION_ID_1,
      expectedVersion: 0,
    });
    assert.strictEqual(resZero.ok, false);
    assert.strictEqual(resZero.safeErrorCode, 'INVALID_INPUT');
  });

  await it('11 submitAttempt sends exact attempt_id and expected_version', async () => {
    let calledFn = null;
    let sentBody = null;
    const client = new ExamStudentClient({
      invokeFunction: async (fn, { body }) => {
        calledFn = fn;
        sentBody = body;
        return { data: createValidSubmitEnvelope() };
      },
    });

    const res = await client.submitAttempt({
      attemptId: TEST_ATTEMPT_ID_1,
      expectedVersion: 2,
    });

    assert.strictEqual(calledFn, 'exam-submit-attempt');
    assert.deepStrictEqual(sentBody, {
      attempt_id: TEST_ATTEMPT_ID_1,
      expected_version: 2,
    });
    assert.strictEqual(res.ok, true);
  });

  await it('12 submitAttempt validates strictly 18 fields inside success envelope', () => {
    const valid = createValidSubmitEnvelope();
    const validated = validateSubmitResponse(valid);
    assert.ok(validated);
    assert.strictEqual(Object.keys(validated).length, 18);
    assert.strictEqual(validated.version, 3);
  });

  await it('13 submitAttempt version field must be integer >= 1', () => {
    assert.strictEqual(validateSubmitResponse(createValidSubmitEnvelope({ version: 0 })), null);
    assert.strictEqual(validateSubmitResponse(createValidSubmitEnvelope({ version: -1 })), null);
    assert.strictEqual(validateSubmitResponse(createValidSubmitEnvelope({ version: 1.2 })), null);
    assert.strictEqual(validateSubmitResponse(createValidSubmitEnvelope({ version: '3' })), null);
  });

  await it('14 startAttempt invalid assignment UUID rejected pre-dispatch', async () => {
    const client = new ExamStudentClient({ invokeFunction: async () => ({}) });
    const res = await client.startAttempt({ assignmentId: 'not-a-uuid' });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.safeErrorCode, 'INVALID_INPUT');
  });

  await it('15 startAttempt invalid attempt UUID rejected pre-dispatch', async () => {
    const client = new ExamStudentClient({ invokeFunction: async () => ({}) });
    const res = await client.startAttempt({ assignmentId: TEST_ASSIGNMENT_ID, attemptId: 'bad-uuid' });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.safeErrorCode, 'INVALID_INPUT');
  });

  await it('16 sanitizeClientError preserves safeHttpStatus and safeErrorCode', () => {
    const err = sanitizeClientError({ status: 409, code: 'ERR_OPTIMISTIC_LOCK_CONFLICT' });
    assert.strictEqual(err.ok, false);
    assert.strictEqual(err.type, 'failed_http');
    assert.strictEqual(err.safeHttpStatus, 409);
    assert.strictEqual(err.safeErrorCode, 'ERR_OPTIMISTIC_LOCK_CONFLICT');
  });

  await it('17 sanitizeClientError masks arbitrary unknown error message', () => {
    const err = sanitizeClientError(new Error('SECRET_INTERNAL_DB_QUERY'));
    assert.strictEqual(err.ok, false);
    assert.strictEqual(err.safeErrorCode, 'INTERNAL_ERROR');
    assert.strictEqual(JSON.stringify(err).includes('SECRET_INTERNAL_DB_QUERY'), false);
  });

  await it('18 generateProvisionalAttemptId returns valid RFC4122 UUID', () => {
    const id = generateProvisionalAttemptId();
    assert.ok(isValidUuid(id));
  });

  await it('19 validateStartResponse accepts null expires_at', () => {
    const valid = createValidStartEnvelope({ expires_at: null });
    const validated = validateStartResponse(valid);
    assert.ok(validated);
    assert.strictEqual(validated.expires_at, null);
  });

  await it('20 validateSubmitResponse accepts null scores and null graded_by', () => {
    const valid = createValidSubmitEnvelope({
      objective_score: null,
      manual_score: null,
      total_score: null,
      graded_at: null,
      graded_by: null,
      status: 'pending_manual_grade',
    });
    const validated = validateSubmitResponse(valid);
    assert.ok(validated);
    assert.strictEqual(validated.objective_score, null);
    assert.strictEqual(validated.status, 'pending_manual_grade');
  });

  await it('21 validateStartResponse rejects non-boolean flags', () => {
    assert.strictEqual(validateStartResponse(createValidStartEnvelope({ resumed_existing: 'true' })), null);
    assert.strictEqual(validateStartResponse(createValidStartEnvelope({ idempotent_replay: 1 })), null);
    assert.strictEqual(validateStartResponse(createValidStartEnvelope({ expired: null })), null);
  });

  await it('22 validateSubmitResponse rejects array payload', () => {
    assert.strictEqual(validateSubmitResponse([]), null);
    assert.strictEqual(validateSubmitResponse(null), null);
    assert.strictEqual(validateSubmitResponse('string'), null);
  });

  await it('23 validateStartResponse rejects bare projection without { success: true, data }', () => {
    const bareProjection = createValidStartData();
    assert.strictEqual(validateStartResponse(bareProjection), null);
  });

  await it('24 validateSaveResponse rejects bare projection without { success: true, data }', () => {
    const bareProjection = createValidSaveData();
    assert.strictEqual(validateSaveResponse(bareProjection), null);
  });

  await it('25 validateSubmitResponse rejects bare projection without { success: true, data }', () => {
    const bareProjection = createValidSubmitData();
    assert.strictEqual(validateSubmitResponse(bareProjection), null);
  });

  await it('26 validateStartResponse rejects success: false with otherwise valid data', () => {
    const invalidEnvelope = {
      success: false,
      data: createValidStartData(),
    };
    assert.strictEqual(validateStartResponse(invalidEnvelope), null);
  });

  await it('27 validateSaveResponse rejects success: "true" string', () => {
    const invalidEnvelope = {
      success: 'true',
      data: createValidSaveData(),
    };
    assert.strictEqual(validateSaveResponse(invalidEnvelope), null);
  });

  await it('28 sanitizeClientError unknown provider code maps to safe fallback', () => {
    const err = sanitizeClientError({ status: 503, code: 'ERR_SECRET_CLOUD_OUTAGE' });
    assert.strictEqual(err.safeHttpStatus, 503);
    assert.strictEqual(err.safeErrorCode, 'HTTP_503');
    assert.strictEqual(JSON.stringify(err).includes('ERR_SECRET_CLOUD_OUTAGE'), false);
  });

  await it('29 sanitizeClientError known BFF error code remains stable', () => {
    const knownCodes = [
      'AUTH_REQUIRED',
      'INVALID_TOKEN',
      'FORBIDDEN_ROLE',
      'ACCOUNT_DISABLED',
      'INVALID_INPUT',
      'INVALID_REQUEST_FIELD',
      'ATTEMPT_NOT_FOUND',
      'CLASS_ACCESS_DENIED',
      'ERR_ATTEMPT_EXPIRED',
      'ERR_ATTEMPT_ALREADY_FINALIZED',
      'ERR_OPTIMISTIC_LOCK_CONFLICT',
    ];
    for (const code of knownCodes) {
      const sanitized = sanitizeClientError({ status: 400, code });
      assert.strictEqual(sanitized.safeErrorCode, code);
    }
  });

  // ===============================================================
  // 2. Taking Session Tests (30..52)
  // ===============================================================
  await it('30 initial session state is unstarted and owns provisional UUID', () => {
    const client = new ExamStudentClient({ invokeFunction: async () => ({}) });
    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
    });

    assert.strictEqual(session.getStatus(), 'unstarted');
    assert.strictEqual(session.getAttemptId(), null);
    assert.strictEqual(session.getCurrentVersion(), null);
    assert.ok(isValidUuid(session.getProvisionalAttemptId()));
    assert.strictEqual(session.isFinalized(), false);
  });

  await it('31 start success sets authoritative attemptId and version from server', async () => {
    const client = new ExamStudentClient({
      invokeFunction: async () => ({
        data: createValidStartEnvelope({
          attempt_id: TEST_ATTEMPT_ID_1,
          attempt_version: 1,
          status: 'draft',
        }),
      }),
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
    });

    const res = await session.start();
    assert.strictEqual(res.ok, true);
    assert.strictEqual(session.getAttemptId(), TEST_ATTEMPT_ID_1);
    assert.strictEqual(session.getCurrentVersion(), 1);
    assert.strictEqual(session.getStatus(), 'draft');
  });

  await it('32 resume existing replaces provisional ID with authoritative server ID', async () => {
    const RESUMED_ID = '99999999-9999-4999-8999-999999999999';
    const client = new ExamStudentClient({
      invokeFunction: async () => ({
        data: createValidStartEnvelope({
          attempt_id: RESUMED_ID,
          attempt_version: 5,
          resumed_existing: true,
        }),
      }),
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
    });

    const provisionalId = session.getProvisionalAttemptId();
    assert.notStrictEqual(provisionalId, RESUMED_ID);

    await session.start();
    assert.strictEqual(session.getAttemptId(), RESUMED_ID);
    assert.strictEqual(session.getCurrentVersion(), 5);
  });

  await it('33 saveAnswer updates currentVersion upon successful save', async () => {
    const client = new ExamStudentClient({
      invokeFunction: async (fn) => {
        if (fn === START_FUNCTION_NAME) {
          return { data: createValidStartEnvelope({ attempt_version: 1 }) };
        }
        if (fn === SAVE_FUNCTION_NAME) {
          return { data: createValidSaveEnvelope({ attempt_version: 2 }) };
        }
        return { data: {} };
      },
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
    });

    await session.start();
    assert.strictEqual(session.getCurrentVersion(), 1);

    const saveRes = await session.saveAnswer({
      examQuestionId: TEST_QUESTION_ID_1,
      studentAnswerJson: { selected: ['B'] },
    });

    assert.strictEqual(saveRes.ok, true);
    assert.strictEqual(session.getCurrentVersion(), 2);
    assert.deepStrictEqual(session.getAnswer(TEST_QUESTION_ID_1).studentAnswerJson, { selected: ['B'] });
  });

  await it('34 saveAnswer failure preserves currentVersion and prior answer state', async () => {
    let callCount = 0;
    const client = new ExamStudentClient({
      invokeFunction: async (fn) => {
        if (fn === START_FUNCTION_NAME) {
          return { data: createValidStartEnvelope({ attempt_version: 1 }) };
        }
        if (fn === SAVE_FUNCTION_NAME) {
          callCount++;
          if (callCount === 1) {
            return { data: createValidSaveEnvelope({ attempt_version: 2 }) };
          }
          return { error: { status: 500, code: 'INTERNAL_ERROR' } };
        }
        return { data: {} };
      },
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
    });

    await session.start();
    await session.saveAnswer({ examQuestionId: TEST_QUESTION_ID_1, studentAnswerJson: { text: 'Initial' } });
    assert.strictEqual(session.getCurrentVersion(), 2);

    // Second save fails
    const failRes = await session.saveAnswer({ examQuestionId: TEST_QUESTION_ID_1, studentAnswerJson: { text: 'Updated' } });
    assert.strictEqual(failRes.ok, false);
    assert.strictEqual(session.getCurrentVersion(), 2, 'Version must be preserved on failure');
    assert.deepStrictEqual(session.getAnswer(TEST_QUESTION_ID_1).studentAnswerJson, { text: 'Initial' });
  });

  await it('35 stale conflict (409) returns error without blind retry', async () => {
    let saveInvocations = 0;
    const client = new ExamStudentClient({
      invokeFunction: async (fn) => {
        if (fn === START_FUNCTION_NAME) {
          return { data: createValidStartEnvelope({ attempt_version: 1 }) };
        }
        if (fn === SAVE_FUNCTION_NAME) {
          saveInvocations++;
          return { error: { status: 409, code: 'ERR_OPTIMISTIC_LOCK_CONFLICT' } };
        }
        return { data: {} };
      },
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
    });

    await session.start();
    const res = await session.saveAnswer({ examQuestionId: TEST_QUESTION_ID_1, studentAnswerJson: 'ans' });

    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.safeHttpStatus, 409);
    assert.strictEqual(res.safeErrorCode, 'ERR_OPTIMISTIC_LOCK_CONFLICT');
    assert.strictEqual(saveInvocations, 1, 'Must not retry 409 automatically');
  });

  await it('36 submitAttempt updates currentVersion from response.version and marks finalized', async () => {
    let finalizedFired = 0;
    const client = new ExamStudentClient({
      invokeFunction: async (fn) => {
        if (fn === START_FUNCTION_NAME) {
          return { data: createValidStartEnvelope({ attempt_version: 2 }) };
        }
        if (fn === SUBMIT_FUNCTION_NAME) {
          return { data: createValidSubmitEnvelope({ version: 3, status: 'graded' }) };
        }
        return { data: {} };
      },
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
      onConfirmedFinalized: () => {
        finalizedFired++;
      },
    });

    await session.start();
    assert.strictEqual(session.getCurrentVersion(), 2);

    const submitRes = await session.submitAttempt();
    assert.strictEqual(submitRes.ok, true);
    assert.strictEqual(session.getCurrentVersion(), 3);
    assert.strictEqual(session.getStatus(), 'graded');
    assert.strictEqual(session.isFinalized(), true);
    assert.strictEqual(finalizedFired, 1);
  });

  await it('37 pending_manual_grade status confirms finalized', async () => {
    let finalizedFired = false;
    const client = new ExamStudentClient({
      invokeFunction: async (fn) => {
        if (fn === START_FUNCTION_NAME) return { data: createValidStartEnvelope() };
        if (fn === SUBMIT_FUNCTION_NAME) return { data: createValidSubmitEnvelope({ status: 'pending_manual_grade', version: 2 }) };
        return { data: {} };
      },
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
      onConfirmedFinalized: () => {
        finalizedFired = true;
      },
    });

    await session.start();
    await session.submitAttempt();
    assert.strictEqual(session.isFinalized(), true);
    assert.strictEqual(finalizedFired, true);
  });

  await it('38 submitted status confirms finalized', async () => {
    let finalizedFired = false;
    const client = new ExamStudentClient({
      invokeFunction: async (fn) => {
        if (fn === START_FUNCTION_NAME) return { data: createValidStartEnvelope() };
        if (fn === SUBMIT_FUNCTION_NAME) return { data: createValidSubmitEnvelope({ status: 'submitted', version: 2 }) };
        return { data: {} };
      },
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
      onConfirmedFinalized: () => {
        finalizedFired = true;
      },
    });

    await session.start();
    await session.submitAttempt();
    assert.strictEqual(session.isFinalized(), true);
    assert.strictEqual(finalizedFired, true);
  });

  await it('39 onConfirmedFinalized emitted EXACTLY ONCE on replay', async () => {
    let callbackCount = 0;
    const client = new ExamStudentClient({
      invokeFunction: async (fn) => {
        if (fn === START_FUNCTION_NAME) return { data: createValidStartEnvelope() };
        if (fn === SUBMIT_FUNCTION_NAME) return { data: createValidSubmitEnvelope({ idempotent_replay: true }) };
        return { data: {} };
      },
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
      onConfirmedFinalized: () => {
        callbackCount++;
      },
    });

    await session.start();
    await session.submitAttempt();
    await session.submitAttempt(); // Second submit replay
    assert.strictEqual(callbackCount, 1, 'Callback must fire max once per finalized attempt');
  });

  await it('40 non-finalized status does NOT trigger onConfirmedFinalized', async () => {
    let callbackCount = 0;
    const client = new ExamStudentClient({
      invokeFunction: async () => ({
        data: createValidStartEnvelope({ status: 'draft', already_finalized: false }),
      }),
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
      onConfirmedFinalized: () => {
        callbackCount++;
      },
    });

    await session.start();
    assert.strictEqual(session.isFinalized(), false);
    assert.strictEqual(callbackCount, 0);
  });

  await it('41 already_finalized start response marks session finalized and fires callback once', async () => {
    let callbackCount = 0;
    const client = new ExamStudentClient({
      invokeFunction: async () => ({
        data: createValidStartEnvelope({ status: 'submitted', already_finalized: true }),
      }),
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
      onConfirmedFinalized: () => {
        callbackCount++;
      },
    });

    await session.start();
    assert.strictEqual(session.isFinalized(), true);
    assert.strictEqual(callbackCount, 1);
  });

  await it('42 saveAnswer before start is rejected with ATTEMPT_NOT_STARTED', async () => {
    const client = new ExamStudentClient({ invokeFunction: async () => ({}) });
    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
    });

    const res = await session.saveAnswer({ examQuestionId: TEST_QUESTION_ID_1, studentAnswerJson: 'a' });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.safeErrorCode, 'ATTEMPT_NOT_STARTED');
  });

  await it('43 submitAttempt before start is rejected with ATTEMPT_NOT_STARTED', async () => {
    const client = new ExamStudentClient({ invokeFunction: async () => ({}) });
    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
    });

    const res = await session.submitAttempt();
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.safeErrorCode, 'ATTEMPT_NOT_STARTED');
  });

  await it('44 saveAnswer after finalization is rejected', async () => {
    const client = new ExamStudentClient({
      invokeFunction: async (fn) => {
        if (fn === START_FUNCTION_NAME) return { data: createValidStartEnvelope() };
        if (fn === SUBMIT_FUNCTION_NAME) return { data: createValidSubmitEnvelope() };
        return { data: {} };
      },
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
    });

    await session.start();
    await session.submitAttempt();
    assert.strictEqual(session.isFinalized(), true);

    const res = await session.saveAnswer({ examQuestionId: TEST_QUESTION_ID_1, studentAnswerJson: 'late' });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.safeErrorCode, 'ERR_ATTEMPT_ALREADY_FINALIZED');
  });

  await it('45 provisional ID is reused for same logical start until authoritative response', async () => {
    let receivedAttemptIds = [];
    const client = new ExamStudentClient({
      invokeFunction: async (fn, { body }) => {
        receivedAttemptIds.push(body.attempt_id);
        if (receivedAttemptIds.length === 1) {
          return { error: { status: 500, code: 'INTERNAL_ERROR' } }; // First attempt fails
        }
        return { data: createValidStartEnvelope({ attempt_id: body.attempt_id }) };
      },
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
    });

    const res1 = await session.start();
    assert.strictEqual(res1.ok, false);

    const res2 = await session.start();
    assert.strictEqual(res2.ok, true);

    assert.strictEqual(receivedAttemptIds.length, 2);
    assert.strictEqual(receivedAttemptIds[0], receivedAttemptIds[1], 'Provisional ID must be reused across retries');
  });

  await it('46 no local version increment: version is only updated by server response', async () => {
    const client = new ExamStudentClient({
      invokeFunction: async (fn) => {
        if (fn === START_FUNCTION_NAME) return { data: createValidStartEnvelope({ attempt_version: 10 }) };
        if (fn === SAVE_FUNCTION_NAME) return { data: createValidSaveEnvelope({ attempt_version: 15 }) };
        return { data: {} };
      },
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
    });

    await session.start();
    assert.strictEqual(session.getCurrentVersion(), 10);

    await session.saveAnswer({ examQuestionId: TEST_QUESTION_ID_1, studentAnswerJson: 'a' });
    assert.strictEqual(session.getCurrentVersion(), 15);
  });

  await it('47 state change listener is notified on start, save, submit', async () => {
    const states = [];
    const client = new ExamStudentClient({
      invokeFunction: async (fn) => {
        if (fn === START_FUNCTION_NAME) return { data: createValidStartEnvelope() };
        if (fn === SAVE_FUNCTION_NAME) return { data: createValidSaveEnvelope() };
        if (fn === SUBMIT_FUNCTION_NAME) return { data: createValidSubmitEnvelope() };
        return { data: {} };
      },
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
      onStateChange: (st) => states.push(st),
    });

    await session.start();
    await session.saveAnswer({ examQuestionId: TEST_QUESTION_ID_1, studentAnswerJson: 'a' });
    await session.submitAttempt();

    assert.strictEqual(states.length, 3);
    assert.strictEqual(states[0].status, 'draft');
    assert.strictEqual(states[1].answersCount, 1);
    assert.strictEqual(states[2].isFinalized, true);
  });

  await it('48 getState returns complete snapshot', async () => {
    const client = new ExamStudentClient({
      invokeFunction: async () => ({ data: createValidStartEnvelope() }),
    });
    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
    });
    await session.start();

    const st = session.getState();
    assert.strictEqual(st.assignmentId, TEST_ASSIGNMENT_ID);
    assert.strictEqual(st.attemptId, TEST_ATTEMPT_ID_1);
    assert.strictEqual(st.status, 'draft');
    assert.strictEqual(st.currentVersion, 1);
    assert.strictEqual(st.isFinalized, false);
  });

  await it('49 CONFIRMED_FINALIZED_STATUSES is frozen array with exactly 3 values', () => {
    assert.strictEqual(Array.isArray(CONFIRMED_FINALIZED_STATUSES), true);
    assert.strictEqual(Object.isFrozen(CONFIRMED_FINALIZED_STATUSES), true);
    assert.deepStrictEqual([...CONFIRMED_FINALIZED_STATUSES].sort(), [
      'graded',
      'pending_manual_grade',
      'submitted',
    ]);
  });

  await it('50 CONFIRMED_FINALIZED_STATUSES cannot be mutated via Set.add', () => {
    assert.strictEqual(typeof CONFIRMED_FINALIZED_STATUSES.add, 'undefined');
    assert.throws(() => {
      CONFIRMED_FINALIZED_STATUSES.push('draft');
    }, TypeError);
  });

  await it('51 saveAnswer with undefined/null studentAnswerJson normalizes to null', async () => {
    let capturedBody = null;
    const client = new ExamStudentClient({
      invokeFunction: async (fn, { body }) => {
        if (fn === START_FUNCTION_NAME) return { data: createValidStartEnvelope() };
        if (fn === SAVE_FUNCTION_NAME) {
          capturedBody = body;
          return { data: createValidSaveEnvelope() };
        }
        return { data: {} };
      },
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
    });

    await session.start();
    await session.saveAnswer({ examQuestionId: TEST_QUESTION_ID_1 });
    assert.strictEqual(capturedBody.student_answer_json, null);
  });

  await it('52 constructor throws on invalid assignment UUID', () => {
    assert.throws(() => {
      new ExamTakingSession({ assignmentId: 'invalid-uuid', studentClient: {} });
    });
  });

  // ===============================================================
  // 3. Phase 3D Attempt State Reset Hardening Tests (53..60)
  // ===============================================================
  await it('53 canonicalizeAttemptId: Scenario A valid attempt A vs valid attempt B produces different canonical IDs', () => {
    const canonicalA = canonicalizeAttemptId(TEST_ATTEMPT_ID_1);
    const canonicalB = canonicalizeAttemptId(TEST_ATTEMPT_ID_2);
    assert.ok(canonicalA);
    assert.ok(canonicalB);
    assert.notStrictEqual(canonicalA, canonicalB, 'Different valid attempts must not be equal');
  });

  await it('54 canonicalizeAttemptId: Scenario B valid attempt -> null transitions to null', () => {
    const canonicalValid = canonicalizeAttemptId(TEST_ATTEMPT_ID_1);
    const canonicalNull = canonicalizeAttemptId(null);
    assert.ok(canonicalValid);
    assert.strictEqual(canonicalNull, null);
    assert.notStrictEqual(canonicalValid, canonicalNull);
  });

  await it('55 canonicalizeAttemptId: Scenario C null -> valid attempt transitions from null', () => {
    const canonicalNull = canonicalizeAttemptId(null);
    const canonicalValid = canonicalizeAttemptId(TEST_ATTEMPT_ID_1);
    assert.strictEqual(canonicalNull, null);
    assert.ok(canonicalValid);
    assert.notStrictEqual(canonicalNull, canonicalValid);
  });

  await it('56 canonicalizeAttemptId: Scenario D same UUID different letter case produces SAME canonical ID (No false reset)', () => {
    const upper = '22222222-2222-4222-8222-222222222222'.toUpperCase();
    const lower = '22222222-2222-4222-8222-222222222222'.toLowerCase();
    const canonicalUpper = canonicalizeAttemptId(upper);
    const canonicalLower = canonicalizeAttemptId(lower);

    assert.strictEqual(canonicalUpper, canonicalLower, 'Uppercase and lowercase UUIDs must produce identical canonical identity');
  });

  await it('57 canonicalizeAttemptId: Scenario E invalid attempt string -> valid attempt starts clean', () => {
    const canonicalInvalid = canonicalizeAttemptId('not-a-valid-uuid');
    const canonicalValid = canonicalizeAttemptId(TEST_ATTEMPT_ID_1);

    assert.strictEqual(canonicalInvalid, null);
    assert.ok(canonicalValid);
    assert.notStrictEqual(canonicalInvalid, canonicalValid);
  });

  await it('58 canonicalizeAttemptId: Scenario F whitespace trimmed and normalized', () => {
    const withWhitespace = `   ${TEST_ATTEMPT_ID_1.toUpperCase()}   `;
    const clean = TEST_ATTEMPT_ID_1.toLowerCase();

    assert.strictEqual(canonicalizeAttemptId(withWhitespace), clean);
  });

  await it('59 shouldResetIntegrityState returns true on attempt change and false on identical canonical UUID', () => {
    assert.strictEqual(shouldResetIntegrityState(TEST_ATTEMPT_ID_1, TEST_ATTEMPT_ID_2), true);
    assert.strictEqual(shouldResetIntegrityState(TEST_ATTEMPT_ID_1, null), true);
    assert.strictEqual(shouldResetIntegrityState(null, TEST_ATTEMPT_ID_1), true);
    assert.strictEqual(
      shouldResetIntegrityState(TEST_ATTEMPT_ID_1.toLowerCase(), TEST_ATTEMPT_ID_1.toUpperCase()),
      false
    );
    assert.strictEqual(
      shouldResetIntegrityState(`  ${TEST_ATTEMPT_ID_1}  `, TEST_ATTEMPT_ID_1),
      false
    );
  });

  await it('60 static contract: useExamIntegrity effect sets both lastIntegrityResult(null) and lastIntegrityError(null) on canonical change', () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const hookSourcePath = path.resolve(__dirname, '../src/hooks/useExamIntegrity.js');
    const source = fs.readFileSync(hookSourcePath, 'utf8');

    assert.ok(source.includes('canonicalizeAttemptId(attemptId)'));
    assert.ok(source.includes('setLastIntegrityResult(null)'));
    assert.ok(source.includes('setLastIntegrityError(null)'));
    assert.ok(source.includes('lastCanonicalAttemptIdRef.current = canonicalAttemptId'));
  });

  console.log('\n====================================================');
  console.log(`TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
  console.log('====================================================\n');

  if (failedTests > 0) {
    throw new Error(`Test suite failed with ${failedTests} failures.`);
  }
}

main().catch((err) => {
  console.error('❌ Test execution terminated with error:', err);
  process.exit(1);
});
