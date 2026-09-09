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
  GET_QUESTIONS_FUNCTION_NAME,
  ALLOWED_QUESTION_TYPES,
  SAFE_GET_ATTEMPT_QUESTIONS_ERROR_CODES,
  validateStartResponse,
  validateSaveResponse,
  validateSubmitResponse,
  validateGetAttemptQuestionsResponse,
  sanitizeClientError,
  sanitizeGetAttemptQuestionsError,
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

const TEST_QUESTION_ID_SINGLE = '44444444-4444-4444-8444-444444444401';
const TEST_QUESTION_ID_MULTI = '44444444-4444-4444-8444-444444444402';
const TEST_QUESTION_ID_FILL = '44444444-4444-4444-8444-444444444403';
const TEST_QUESTION_ID_SHORT = '44444444-4444-4444-8444-444444444404';
const TEST_QUESTION_ID_ESSAY = '44444444-4444-4444-8444-444444444405';
const TEST_QUESTION_ID_IMAGE = '44444444-4444-4444-8444-444444444406';
const TEST_QUESTION_ID_FILE = '44444444-4444-4444-8444-444444444407';

function createValidGetQuestionsData(overrides = {}) {
  return {
    attempt_id: TEST_ATTEMPT_ID_1,
    exam_version_id: TEST_EXAM_VERSION_ID,
    status: 'draft',
    questions: [
      {
        id: TEST_QUESTION_ID_SINGLE,
        question_type: 'single_choice',
        prompt: '1. What is 2 + 2?',
        points: 2.0,
        options: [{ key: 'A', text: '3' }, { key: 'B', text: '4' }],
      },
      {
        id: TEST_QUESTION_ID_MULTI,
        question_type: 'multiple_choice',
        prompt: '2. Which are prime numbers?',
        points: 2.0,
        options: [{ key: 'A', text: '2' }, { key: 'B', text: '3' }],
      },
      {
        id: TEST_QUESTION_ID_FILL,
        question_type: 'fill_blank',
        prompt: '3. Capital of Vietnam',
        points: 2.0,
        options: [],
      },
      {
        id: TEST_QUESTION_ID_SHORT,
        question_type: 'short_answer',
        prompt: '4. Define velocity',
        points: 2.0,
        options: [],
      },
      {
        id: TEST_QUESTION_ID_ESSAY,
        question_type: 'essay',
        prompt: '5. Essay on environment',
        points: 2.0,
        options: [],
      },
      {
        id: TEST_QUESTION_ID_IMAGE,
        question_type: 'image_upload',
        prompt: '6. Image prompt',
        points: 2.0,
        options: [],
      },
      {
        id: TEST_QUESTION_ID_FILE,
        question_type: 'file_upload',
        prompt: '7. File prompt',
        points: 2.0,
        options: [],
      },
    ],
    ...overrides,
  };
}

function createValidGetQuestionsEnvelope(overrides = {}) {
  return {
    success: true,
    data: createValidGetQuestionsData(overrides),
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

  // ===============================================================
  // 4. Phase 3E-B Step 1 Student Question Delivery Tests (61..90)
  // ===============================================================
  await it('61 GET_QUESTIONS_FUNCTION_NAME defined as exam-get-attempt-questions', () => {
    assert.strictEqual(GET_QUESTIONS_FUNCTION_NAME, 'exam-get-attempt-questions');
    assert.deepStrictEqual(ALLOWED_QUESTION_TYPES, [
      'single_choice',
      'multiple_choice',
      'fill_blank',
      'short_answer',
      'essay',
      'image_upload',
      'file_upload',
    ]);
  });

  await it('62 getAttemptQuestions sends exact single field body { attempt_id }', async () => {
    let calledFn = null;
    let sentBody = null;
    const client = new ExamStudentClient({
      invokeFunction: async (fn, { body }) => {
        calledFn = fn;
        sentBody = body;
        return { data: createValidGetQuestionsEnvelope() };
      },
    });

    const res = await client.getAttemptQuestions({ attempt_id: TEST_ATTEMPT_ID_1 });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(calledFn, 'exam-get-attempt-questions');
    assert.deepStrictEqual(Object.keys(sentBody), ['attempt_id']);
    assert.strictEqual(sentBody.attempt_id, TEST_ATTEMPT_ID_1.toLowerCase());
  });

  await it('63 getAttemptQuestions accepts string UUID or { attemptId } alias', async () => {
    let sentBodies = [];
    const client = new ExamStudentClient({
      invokeFunction: async (fn, { body }) => {
        sentBodies.push(body);
        return { data: createValidGetQuestionsEnvelope() };
      },
    });

    const res1 = await client.getAttemptQuestions(TEST_ATTEMPT_ID_1);
    const res2 = await client.getAttemptQuestions({ attemptId: TEST_ATTEMPT_ID_2 });

    assert.strictEqual(res1.ok, true);
    assert.strictEqual(res2.ok, true);
    assert.strictEqual(sentBodies[0].attempt_id, TEST_ATTEMPT_ID_1.toLowerCase());
    assert.strictEqual(sentBodies[1].attempt_id, TEST_ATTEMPT_ID_2.toLowerCase());
  });

  await it('64 getAttemptQuestions validates strictly 4 fields in { success: true, data } envelope', () => {
    const raw = createValidGetQuestionsEnvelope();
    const validated = validateGetAttemptQuestionsResponse(raw);
    assert.ok(validated);
    assert.deepStrictEqual(Object.keys(validated).sort(), ['attempt_id', 'exam_version_id', 'questions', 'status']);
    assert.strictEqual(validated.status, 'draft');
  });

  await it('65 getAttemptQuestions rejects bare projection without { success: true, data }', () => {
    const bareData = createValidGetQuestionsData();
    assert.strictEqual(validateGetAttemptQuestionsResponse(bareData), null);
    assert.strictEqual(validateGetAttemptQuestionsResponse({ success: false, data: bareData }), null);
    assert.strictEqual(validateGetAttemptQuestionsResponse({ success: 'true', data: bareData }), null);
    assert.strictEqual(validateGetAttemptQuestionsResponse(null), null);
  });

  await it('66 getAttemptQuestions validates strictly 5 question fields and 2 option fields', () => {
    const raw = createValidGetQuestionsEnvelope();
    const validated = validateGetAttemptQuestionsResponse(raw);
    const q1 = validated.questions[0];
    assert.deepStrictEqual(Object.keys(q1).sort(), ['id', 'options', 'points', 'prompt', 'question_type']);
    const opt = q1.options[0];
    assert.deepStrictEqual(Object.keys(opt).sort(), ['key', 'text']);
  });

  await it('67 getAttemptQuestions supports all 7 approved question types', () => {
    const raw = createValidGetQuestionsEnvelope();
    const validated = validateGetAttemptQuestionsResponse(raw);
    const deliveredTypes = validated.questions.map(q => q.question_type);
    assert.deepStrictEqual(deliveredTypes, [
      'single_choice',
      'multiple_choice',
      'fill_blank',
      'short_answer',
      'essay',
      'image_upload',
      'file_upload',
    ]);
  });

  await it('68 getAttemptQuestions rejects unknown question type', () => {
    const raw = createValidGetQuestionsEnvelope();
    raw.data.questions[0].question_type = 'audio_matching';
    assert.strictEqual(validateGetAttemptQuestionsResponse(raw), null);
  });

  await it('69 getAttemptQuestions rejects non-draft status', () => {
    const submitted = createValidGetQuestionsEnvelope({ status: 'submitted' });
    const graded = createValidGetQuestionsEnvelope({ status: 'graded' });
    const pending = createValidGetQuestionsEnvelope({ status: 'pending_manual_grade' });

    assert.strictEqual(validateGetAttemptQuestionsResponse(submitted), null);
    assert.strictEqual(validateGetAttemptQuestionsResponse(graded), null);
    assert.strictEqual(validateGetAttemptQuestionsResponse(pending), null);
  });

  await it('70 getAttemptQuestions rejects invalid UUIDs in attempt, version, or question ID', () => {
    const badAttempt = createValidGetQuestionsEnvelope({ attempt_id: 'bad-uuid' });
    const badVersion = createValidGetQuestionsEnvelope({ exam_version_id: 'bad-uuid' });
    const badQuestion = createValidGetQuestionsEnvelope();
    badQuestion.data.questions[0].id = 'bad-uuid';

    assert.strictEqual(validateGetAttemptQuestionsResponse(badAttempt), null);
    assert.strictEqual(validateGetAttemptQuestionsResponse(badVersion), null);
    assert.strictEqual(validateGetAttemptQuestionsResponse(badQuestion), null);
  });

  await it('71 getAttemptQuestions rejects non-positive or NaN or zero points', () => {
    const zeroPts = createValidGetQuestionsEnvelope();
    zeroPts.data.questions[0].points = 0;
    const negPts = createValidGetQuestionsEnvelope();
    negPts.data.questions[0].points = -5;
    const nanPts = createValidGetQuestionsEnvelope();
    nanPts.data.questions[0].points = NaN;
    const strPts = createValidGetQuestionsEnvelope();
    strPts.data.questions[0].points = '2.0';

    assert.strictEqual(validateGetAttemptQuestionsResponse(zeroPts), null);
    assert.strictEqual(validateGetAttemptQuestionsResponse(negPts), null);
    assert.strictEqual(validateGetAttemptQuestionsResponse(nanPts), null);
    assert.strictEqual(validateGetAttemptQuestionsResponse(strPts), null);
  });

  await it('72 getAttemptQuestions rejects malformed options', () => {
    const emptyKey = createValidGetQuestionsEnvelope();
    emptyKey.data.questions[0].options = [{ key: '', text: 'Option A' }];
    const nonStrText = createValidGetQuestionsEnvelope();
    nonStrText.data.questions[0].options = [{ key: 'A', text: 123 }];
    const nullOpt = createValidGetQuestionsEnvelope();
    nullOpt.data.questions[0].options = [null];

    assert.strictEqual(validateGetAttemptQuestionsResponse(emptyKey), null);
    assert.strictEqual(validateGetAttemptQuestionsResponse(nonStrText), null);
    assert.strictEqual(validateGetAttemptQuestionsResponse(nullOpt), null);
  });

  await it('73 getAttemptQuestions strips/rejects extra private fields', () => {
    const rawWithExtra = createValidGetQuestionsEnvelope();
    rawWithExtra.data.questions[0].answer_key = { correct_answer: 'B' };
    rawWithExtra.data.questions[0].correct_answer = 'B';
    rawWithExtra.data.questions[0].options[0].is_correct = true;

    const validated = validateGetAttemptQuestionsResponse(rawWithExtra);
    assert.ok(validated);
    assert.strictEqual(validated.questions[0].answer_key, undefined);
    assert.strictEqual(validated.questions[0].correct_answer, undefined);
    assert.strictEqual(validated.questions[0].options[0].is_correct, undefined);
  });

  await it('74 getAttemptQuestions invalid attempt UUID rejected pre-dispatch', async () => {
    let called = false;
    const client = new ExamStudentClient({
      invokeFunction: async () => {
        called = true;
        return { data: {} };
      },
    });

    const res = await client.getAttemptQuestions('invalid-uuid');
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.type, 'failed_pre_dispatch');
    assert.strictEqual(res.safeErrorCode, 'INVALID_INPUT');
    assert.strictEqual(called, false);
  });

  await it('75 getAttemptQuestions known error codes sanitized cleanly', async () => {
    const client = new ExamStudentClient({
      invokeFunction: async () => {
        return {
          error: {
            status: 404,
            code: 'ATTEMPT_NOT_FOUND',
            message: 'Database query failed or row not found',
          },
        };
      },
    });

    const res = await client.getAttemptQuestions(TEST_ATTEMPT_ID_1);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.safeErrorCode, 'ATTEMPT_NOT_FOUND');
    assert.strictEqual(res.safeHttpStatus, 404);
  });

  await it('76 getAttemptQuestions unknown error code maps to safe HTTP fallback', async () => {
    const client = new ExamStudentClient({
      invokeFunction: async () => {
        return {
          error: {
            status: 502,
            code: 'PG_CONNECTION_DROPPED_PRIVATE_SECRET',
            message: 'Internal connection lost to pg pool',
          },
        };
      },
    });

    const res = await client.getAttemptQuestions(TEST_ATTEMPT_ID_1);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.safeErrorCode, 'HTTP_502');
  });

  await it('77 getAttemptQuestions no manual Authorization header or token getter used', async () => {
    let capturedOptions = null;
    const client = new ExamStudentClient({
      invokeFunction: async (fn, opts) => {
        capturedOptions = opts;
        return { data: createValidGetQuestionsEnvelope() };
      },
    });

    await client.getAttemptQuestions(TEST_ATTEMPT_ID_1);
    assert.ok(capturedOptions);
    assert.strictEqual(capturedOptions.headers, undefined);
    assert.strictEqual(capturedOptions.token, undefined);
  });

  await it('78 getAttemptQuestions no retry on failure', async () => {
    let callCount = 0;
    const client = new ExamStudentClient({
      invokeFunction: async () => {
        callCount++;
        return { error: { status: 500, code: 'INTERNAL_ERROR' } };
      },
    });

    const res = await client.getAttemptQuestions(TEST_ATTEMPT_ID_1);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(callCount, 1);
  });

  await it('79 session loadQuestions before start is rejected with ATTEMPT_NOT_STARTED', async () => {
    const client = new ExamStudentClient({
      invokeFunction: async () => ({ data: createValidGetQuestionsEnvelope() }),
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
    });

    const res = await session.loadQuestions();
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.type, 'failed_pre_dispatch');
    assert.strictEqual(res.safeErrorCode, 'ATTEMPT_NOT_STARTED');
    assert.strictEqual(session.hasQuestions(), false);
  });

  await it('80 session loadQuestions uses authoritative attemptId, never provisional attemptId', async () => {
    let capturedAttemptId = null;
    const client = new ExamStudentClient({
      invokeFunction: async (fn, { body }) => {
        if (fn === START_FUNCTION_NAME) {
          return { data: createValidStartEnvelope({ attempt_id: TEST_ATTEMPT_ID_2 }) };
        }
        if (fn === GET_QUESTIONS_FUNCTION_NAME) {
          capturedAttemptId = body.attempt_id;
          return { data: createValidGetQuestionsEnvelope({ attempt_id: TEST_ATTEMPT_ID_2 }) };
        }
        return { data: {} };
      },
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
    });

    const provisionalId = session.getProvisionalAttemptId();
    await session.start();
    await session.loadQuestions();

    assert.notStrictEqual(capturedAttemptId, provisionalId);
    assert.strictEqual(capturedAttemptId, TEST_ATTEMPT_ID_2.toLowerCase());
    assert.strictEqual(session.getAttemptId(), TEST_ATTEMPT_ID_2.toLowerCase());
  });

  await it('81 session loadQuestions stores and returns questions on success (memory only)', async () => {
    const client = new ExamStudentClient({
      invokeFunction: async (fn) => {
        if (fn === START_FUNCTION_NAME) return { data: createValidStartEnvelope() };
        if (fn === GET_QUESTIONS_FUNCTION_NAME) return { data: createValidGetQuestionsEnvelope() };
        return { data: {} };
      },
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
    });

    await session.start();
    const res = await session.loadQuestions();

    assert.strictEqual(res.ok, true);
    assert.strictEqual(session.hasQuestions(), true);
    assert.strictEqual(session.getQuestions().length, 7);
    assert.strictEqual(session.getQuestionsResult().attempt_id, TEST_ATTEMPT_ID_1.toLowerCase());
  });

  await it('82 session loadQuestions does NOT change or increment currentVersion', async () => {
    const client = new ExamStudentClient({
      invokeFunction: async (fn) => {
        if (fn === START_FUNCTION_NAME) return { data: createValidStartEnvelope({ attempt_version: 1 }) };
        if (fn === GET_QUESTIONS_FUNCTION_NAME) return { data: createValidGetQuestionsEnvelope() };
        return { data: {} };
      },
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
    });

    await session.start();
    assert.strictEqual(session.getCurrentVersion(), 1);

    await session.loadQuestions();
    assert.strictEqual(session.getCurrentVersion(), 1);
  });

  await it('83 session loadQuestions failure preserves currentVersion and does not mutate session', async () => {
    let getShouldFail = true;
    const client = new ExamStudentClient({
      invokeFunction: async (fn) => {
        if (fn === START_FUNCTION_NAME) return { data: createValidStartEnvelope({ attempt_version: 2 }) };
        if (fn === GET_QUESTIONS_FUNCTION_NAME) {
          if (getShouldFail) return { error: { status: 500, code: 'INTERNAL_ERROR' } };
          return { data: createValidGetQuestionsEnvelope() };
        }
        return { data: {} };
      },
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
    });

    await session.start();
    assert.strictEqual(session.getCurrentVersion(), 2);

    const resFail = await session.loadQuestions();
    assert.strictEqual(resFail.ok, false);
    assert.strictEqual(session.getCurrentVersion(), 2);
    assert.strictEqual(session.hasQuestions(), false);
    assert.ok(session.getQuestionsError());
  });

  await it('84 session loadQuestions 409 ERR_ATTEMPT_ALREADY_FINALIZED does NOT fire onConfirmedFinalized', async () => {
    let finalizedEmitted = false;
    const client = new ExamStudentClient({
      invokeFunction: async (fn) => {
        if (fn === START_FUNCTION_NAME) return { data: createValidStartEnvelope() };
        if (fn === GET_QUESTIONS_FUNCTION_NAME) {
          return { error: { status: 409, code: 'ERR_ATTEMPT_ALREADY_FINALIZED' } };
        }
        return { data: {} };
      },
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
      onConfirmedFinalized: () => {
        finalizedEmitted = true;
      },
    });

    await session.start();
    const res = await session.loadQuestions();

    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.safeErrorCode, 'ERR_ATTEMPT_ALREADY_FINALIZED');
    assert.strictEqual(finalizedEmitted, false);
    assert.strictEqual(session.isFinalized(), false);
  });

  await it('85 session loadQuestions 409 ERR_ATTEMPT_EXPIRED surfaces safe error without side effects', async () => {
    const client = new ExamStudentClient({
      invokeFunction: async (fn) => {
        if (fn === START_FUNCTION_NAME) return { data: createValidStartEnvelope() };
        if (fn === GET_QUESTIONS_FUNCTION_NAME) {
          return { error: { status: 409, code: 'ERR_ATTEMPT_EXPIRED' } };
        }
        return { data: {} };
      },
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
    });

    await session.start();
    const res = await session.loadQuestions();

    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.safeErrorCode, 'ERR_ATTEMPT_EXPIRED');
    assert.strictEqual(session.getCurrentVersion(), 1);
    assert.strictEqual(session.isFinalized(), false);
  });

  await it('86 session loadQuestions repeat calls return stable memory results without random reshuffle', async () => {
    let fetchCount = 0;
    const client = new ExamStudentClient({
      invokeFunction: async (fn) => {
        if (fn === START_FUNCTION_NAME) return { data: createValidStartEnvelope() };
        if (fn === GET_QUESTIONS_FUNCTION_NAME) {
          fetchCount++;
          return { data: createValidGetQuestionsEnvelope() };
        }
        return { data: {} };
      },
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
    });

    await session.start();
    await session.loadQuestions();
    const q1 = session.getQuestions();

    await session.loadQuestions();
    const q2 = session.getQuestions();

    assert.strictEqual(fetchCount, 2);
    assert.deepStrictEqual(q1, q2);
  });

  await it('87 session loadQuestions notifies state change listener on successful fetch', async () => {
    const notifications = [];
    const client = new ExamStudentClient({
      invokeFunction: async (fn) => {
        if (fn === START_FUNCTION_NAME) return { data: createValidStartEnvelope() };
        if (fn === GET_QUESTIONS_FUNCTION_NAME) return { data: createValidGetQuestionsEnvelope() };
        return { data: {} };
      },
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
      onStateChange: (state) => notifications.push(state),
    });

    await session.start();
    assert.strictEqual(notifications[notifications.length - 1].hasQuestions, false);

    await session.loadQuestions();
    const lastState = notifications[notifications.length - 1];
    assert.strictEqual(lastState.hasQuestions, true);
    assert.strictEqual(lastState.questionsCount, 7);
  });

  await it('88 session getQuestions / getQuestionsResult / getState return accurate memory snapshot', async () => {
    const client = new ExamStudentClient({
      invokeFunction: async (fn) => {
        if (fn === START_FUNCTION_NAME) return { data: createValidStartEnvelope() };
        if (fn === GET_QUESTIONS_FUNCTION_NAME) return { data: createValidGetQuestionsEnvelope() };
        return { data: {} };
      },
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
    });

    await session.start();
    await session.loadQuestions();

    const questionsCopy = session.getQuestions();
    questionsCopy[0].prompt = 'MUTATED PROMPT';
    assert.notStrictEqual(session.getQuestions()[0].prompt, 'MUTATED PROMPT');

    const state = session.getState();
    assert.strictEqual(state.hasQuestions, true);
    assert.strictEqual(state.questionsCount, 7);
  });

  await it('89 session questions without options (fill_blank, essay, image_upload, file_upload) return options=[]', async () => {
    const client = new ExamStudentClient({
      invokeFunction: async (fn) => {
        if (fn === START_FUNCTION_NAME) return { data: createValidStartEnvelope() };
        if (fn === GET_QUESTIONS_FUNCTION_NAME) return { data: createValidGetQuestionsEnvelope() };
        return { data: {} };
      },
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
    });

    await session.start();
    await session.loadQuestions();

    const questions = session.getQuestions();
    const essayQ = questions.find(q => q.question_type === 'essay');
    const imageQ = questions.find(q => q.question_type === 'image_upload');
    const fileQ = questions.find(q => q.question_type === 'file_upload');

    assert.deepStrictEqual(essayQ.options, []);
    assert.deepStrictEqual(imageQ.options, []);
    assert.deepStrictEqual(fileQ.options, []);
  });

  await it('90 static verification: Zero localStorage / sessionStorage / IndexedDB references in student client and session', () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    const clientSource = fs.readFileSync(path.resolve(__dirname, '../src/services/examStudentClient.js'), 'utf8');
    const sessionSource = fs.readFileSync(path.resolve(__dirname, '../src/services/examTakingSession.js'), 'utf8');

    for (const source of [clientSource, sessionSource]) {
      assert.strictEqual(source.includes('localStorage'), false, 'Must not reference localStorage');
      assert.strictEqual(source.includes('sessionStorage'), false, 'Must not reference sessionStorage');
      assert.strictEqual(source.includes('indexedDB'), false, 'Must not reference indexedDB');
      assert.strictEqual(source.includes('openDatabase'), false, 'Must not reference WebSQL');
    }
  });

  await it('91 sanitizeGetAttemptQuestionsError prevents ERR_OPTIMISTIC_LOCK_CONFLICT from escaping', async () => {
    const client = new ExamStudentClient({
      invokeFunction: async () => ({
        error: { status: 409, code: 'ERR_OPTIMISTIC_LOCK_CONFLICT', message: 'Optimistic lock conflict' },
      }),
    });
    const res = await client.getAttemptQuestions(TEST_ATTEMPT_ID_1);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.safeErrorCode, 'HTTP_409');
    assert.strictEqual(res.safeHttpStatus, 409);
  });

  await it('92 sanitizeGetAttemptQuestionsError prevents ERR_INVALID_ANSWER_PAYLOAD from escaping', async () => {
    const client = new ExamStudentClient({
      invokeFunction: async () => ({
        error: { status: 422, code: 'ERR_INVALID_ANSWER_PAYLOAD', message: 'Invalid answer payload' },
      }),
    });
    const res = await client.getAttemptQuestions(TEST_ATTEMPT_ID_1);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.safeErrorCode, 'HTTP_422');
    assert.strictEqual(res.safeHttpStatus, 422);
  });

  await it('93 sanitizeGetAttemptQuestionsError prevents ERR_IDEMPOTENCY_CONFLICT from escaping', async () => {
    const client = new ExamStudentClient({
      invokeFunction: async () => ({
        error: { status: 409, code: 'ERR_IDEMPOTENCY_CONFLICT', message: 'Idempotency conflict' },
      }),
    });
    const res = await client.getAttemptQuestions(TEST_ATTEMPT_ID_1);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.safeErrorCode, 'HTTP_409');
    assert.strictEqual(res.safeHttpStatus, 409);
  });

  await it('94 sanitizeGetAttemptQuestionsError prevents arbitrary provider code from escaping (no status -> INTERNAL_ERROR)', async () => {
    const client = new ExamStudentClient({
      invokeFunction: async () => ({
        error: { code: 'CUSTOM_UNAPPROVED_PROVIDER_CODE', message: 'Secret provider exception' },
      }),
    });
    const res = await client.getAttemptQuestions(TEST_ATTEMPT_ID_1);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.safeErrorCode, 'INTERNAL_ERROR');
    assert.strictEqual(res.safeHttpStatus, undefined);
  });

  await it('95 sanitizeGetAttemptQuestionsError preserves approved ATTEMPT_NOT_FOUND', async () => {
    const client = new ExamStudentClient({
      invokeFunction: async () => ({
        error: { status: 404, code: 'ATTEMPT_NOT_FOUND' },
      }),
    });
    const res = await client.getAttemptQuestions(TEST_ATTEMPT_ID_1);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.safeErrorCode, 'ATTEMPT_NOT_FOUND');
    assert.strictEqual(res.safeHttpStatus, 404);
  });

  await it('96 sanitizeGetAttemptQuestionsError preserves approved CLASS_ACCESS_DENIED', async () => {
    const client = new ExamStudentClient({
      invokeFunction: async () => ({
        error: { status: 403, code: 'CLASS_ACCESS_DENIED' },
      }),
    });
    const res = await client.getAttemptQuestions(TEST_ATTEMPT_ID_1);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.safeErrorCode, 'CLASS_ACCESS_DENIED');
    assert.strictEqual(res.safeHttpStatus, 403);
  });

  await it('97 sanitizeGetAttemptQuestionsError preserves approved ERR_ATTEMPT_EXPIRED', async () => {
    const client = new ExamStudentClient({
      invokeFunction: async () => ({
        error: { status: 409, code: 'ERR_ATTEMPT_EXPIRED' },
      }),
    });
    const res = await client.getAttemptQuestions(TEST_ATTEMPT_ID_1);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.safeErrorCode, 'ERR_ATTEMPT_EXPIRED');
    assert.strictEqual(res.safeHttpStatus, 409);
  });

  await it('98 sanitizeGetAttemptQuestionsError preserves approved ERR_ATTEMPT_ALREADY_FINALIZED', async () => {
    const client = new ExamStudentClient({
      invokeFunction: async () => ({
        error: { status: 409, code: 'ERR_ATTEMPT_ALREADY_FINALIZED' },
      }),
    });
    const res = await client.getAttemptQuestions(TEST_ATTEMPT_ID_1);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.safeErrorCode, 'ERR_ATTEMPT_ALREADY_FINALIZED');
    assert.strictEqual(res.safeHttpStatus, 409);
  });

  await it('99 session loadQuestions defensive ownership: mutate loadQuestions returned prompt leaves internal state unchanged', async () => {
    const client = new ExamStudentClient({
      invokeFunction: async (fn) => {
        if (fn === START_FUNCTION_NAME) return { data: createValidStartEnvelope() };
        if (fn === GET_QUESTIONS_FUNCTION_NAME) return { data: createValidGetQuestionsEnvelope() };
        return { data: {} };
      },
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
    });

    await session.start();
    const result = await session.loadQuestions();
    assert.strictEqual(result.ok, true);

    const originalPrompt = result.data.questions[0].prompt;
    result.data.questions[0].prompt = 'MALICIOUS_PROMPT_MUTATION';

    assert.strictEqual(session.getQuestions()[0].prompt, originalPrompt);
    assert.strictEqual(session.getQuestionsResult().questions[0].prompt, originalPrompt);
  });

  await it('100 session loadQuestions defensive ownership: mutate loadQuestions returned option text leaves internal state unchanged', async () => {
    const client = new ExamStudentClient({
      invokeFunction: async (fn) => {
        if (fn === START_FUNCTION_NAME) return { data: createValidStartEnvelope() };
        if (fn === GET_QUESTIONS_FUNCTION_NAME) return { data: createValidGetQuestionsEnvelope() };
        return { data: {} };
      },
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
    });

    await session.start();
    const result = await session.loadQuestions();
    assert.strictEqual(result.ok, true);

    const singleChoiceQ = result.data.questions.find(q => q.options && q.options.length > 0);
    const originalText = singleChoiceQ.options[0].text;
    singleChoiceQ.options[0].text = 'MALICIOUS_OPTION_TEXT_MUTATION';

    const internalSingleChoiceQ = session.getQuestions().find(q => q.id === singleChoiceQ.id);
    assert.strictEqual(internalSingleChoiceQ.options[0].text, originalText);
  });

  await it('101 session loadQuestions defensive ownership: push into returned questions array leaves internal count unchanged', async () => {
    const client = new ExamStudentClient({
      invokeFunction: async (fn) => {
        if (fn === START_FUNCTION_NAME) return { data: createValidStartEnvelope() };
        if (fn === GET_QUESTIONS_FUNCTION_NAME) return { data: createValidGetQuestionsEnvelope() };
        return { data: {} };
      },
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
    });

    await session.start();
    const result = await session.loadQuestions();
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.data.questions.length, 7);

    result.data.questions.push({ id: 'injected-fake-question' });
    assert.strictEqual(result.data.questions.length, 8);

    assert.strictEqual(session.getQuestions().length, 7);
    assert.strictEqual(session.getQuestionsResult().questions.length, 7);
    assert.strictEqual(session.getState().questionsCount, 7);
  });

  await it('102 session getQuestions defensive ownership: mutating getQuestions result leaves internal state unchanged', async () => {
    const client = new ExamStudentClient({
      invokeFunction: async (fn) => {
        if (fn === START_FUNCTION_NAME) return { data: createValidStartEnvelope() };
        if (fn === GET_QUESTIONS_FUNCTION_NAME) return { data: createValidGetQuestionsEnvelope() };
        return { data: {} };
      },
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
    });

    await session.start();
    await session.loadQuestions();

    const qList1 = session.getQuestions();
    qList1.pop();
    assert.strictEqual(qList1.length, 6);
    assert.strictEqual(session.getQuestions().length, 7);

    const qList2 = session.getQuestions();
    qList2[0].points = 99999;
    assert.notStrictEqual(session.getQuestions()[0].points, 99999);
  });

  await it('103 session getQuestionsResult defensive ownership: mutating getQuestionsResult leaves internal state unchanged', async () => {
    const client = new ExamStudentClient({
      invokeFunction: async (fn) => {
        if (fn === START_FUNCTION_NAME) return { data: createValidStartEnvelope() };
        if (fn === GET_QUESTIONS_FUNCTION_NAME) return { data: createValidGetQuestionsEnvelope() };
        return { data: {} };
      },
    });

    const session = new ExamTakingSession({
      assignmentId: TEST_ASSIGNMENT_ID,
      studentClient: client,
    });

    await session.start();
    await session.loadQuestions();

    const res1 = session.getQuestionsResult();
    res1.status = 'tampered_status';
    res1.questions = [];
    assert.strictEqual(session.getQuestionsResult().status, 'draft');
    assert.strictEqual(session.getQuestionsResult().questions.length, 7);
  });

  await it('104 SAFE_GET_ATTEMPT_QUESTIONS_ERROR_CODES contains exactly 11 approved codes', () => {
    assert.strictEqual(SAFE_GET_ATTEMPT_QUESTIONS_ERROR_CODES.size, 11);
    const expected = [
      'AUTH_REQUIRED',
      'INVALID_TOKEN',
      'FORBIDDEN_ROLE',
      'ACCOUNT_DISABLED',
      'INVALID_INPUT',
      'INVALID_REQUEST_FIELD',
      'ATTEMPT_NOT_FOUND',
      'CLASS_ACCESS_DENIED',
      'ERR_ATTEMPT_ALREADY_FINALIZED',
      'ERR_ATTEMPT_EXPIRED',
      'INTERNAL_ERROR',
    ];
    for (const code of expected) {
      assert.strictEqual(SAFE_GET_ATTEMPT_QUESTIONS_ERROR_CODES.has(code), true, `Missing code: ${code}`);
    }
    assert.strictEqual(SAFE_GET_ATTEMPT_QUESTIONS_ERROR_CODES.has('ERR_OPTIMISTIC_LOCK_CONFLICT'), false);
    assert.strictEqual(SAFE_GET_ATTEMPT_QUESTIONS_ERROR_CODES.has('ERR_INVALID_ANSWER_PAYLOAD'), false);
    assert.strictEqual(SAFE_GET_ATTEMPT_QUESTIONS_ERROR_CODES.has('ERR_IDEMPOTENCY_CONFLICT'), false);
  });

  await it('105 PostgreSQL UUID structural acceptance: c1000000-0000-0000-0000-000000000001 accepted by isValidUuid', () => {
    const pgStudentId = 'c1000000-0000-0000-0000-000000000001';
    const pgClassId = '4f0f3fd3-f4d2-4f5b-9370-a7cc8fa6e45c';
    const pgAssignmentId = '99999999-9999-4999-8999-000001000004';
    assert.strictEqual(isValidUuid(pgStudentId), true);
    assert.strictEqual(isValidUuid(pgClassId), true);
    assert.strictEqual(isValidUuid(pgAssignmentId), true);
  });

  await it('106 Normal RFC4122 v4 UUID remains accepted by isValidUuid', () => {
    const rfc4122Uuid1 = '58c4193e-80d9-461c-903d-9a84a06395cf';
    const rfc4122Uuid2 = '11111111-1111-4111-8111-111111111111';
    assert.strictEqual(isValidUuid(rfc4122Uuid1), true);
    assert.strictEqual(isValidUuid(rfc4122Uuid2), true);
  });

  await it('107 Invalid UUID values remain strictly rejected by isValidUuid', () => {
    assert.strictEqual(isValidUuid(''), false);
    assert.strictEqual(isValidUuid('   '), false);
    assert.strictEqual(isValidUuid(null), false);
    assert.strictEqual(isValidUuid(undefined), false);
    assert.strictEqual(isValidUuid(12345), false);
    assert.strictEqual(isValidUuid('not-a-uuid'), false);
    assert.strictEqual(isValidUuid('c1000000-0000-0000-0000-00000000000g'), false); // non-hex 'g'
    assert.strictEqual(isValidUuid('c1000000-0000-0000-0000-00000000000'), false); // 11 chars
    assert.strictEqual(isValidUuid('c1000000-0000-0000-0000-0000000000001'), false); // 13 chars
    assert.strictEqual(isValidUuid('c10000000000000000000000000000001'), false); // missing hyphens
  });

  await it('108 Exact hosted start-response structure with PostgreSQL student_id passes validateStartResponse', () => {
    const hostedEnvelope = {
      success: true,
      data: {
        attempt_id: '58c4193e-80d9-461c-903d-9a84a06395cf',
        assignment_id: '99999999-9999-4999-8999-000001000004',
        exam_version_id: '99999999-9999-4999-8999-000001000002',
        student_id: 'c1000000-0000-0000-0000-000000000001',
        attempt_number: 1,
        status: 'draft',
        attempt_started_at: '2026-09-09T15:34:04.123Z',
        expires_at: '2026-09-09T16:34:04.123Z',
        max_score: 2,
        question_order: [
          '99999999-9999-4999-8999-000001000011',
          '99999999-9999-4999-8999-000001000012',
        ],
        option_orders: {},
        attempt_version: 1,
        resumed_existing: true,
        idempotent_replay: false,
        expired: false,
        already_finalized: false,
      },
    };

    const validated = validateStartResponse(hostedEnvelope);
    assert.ok(validated);
    assert.strictEqual(validated.attempt_id, '58c4193e-80d9-461c-903d-9a84a06395cf');
    assert.strictEqual(validated.assignment_id, '99999999-9999-4999-8999-000001000004');
    assert.strictEqual(validated.exam_version_id, '99999999-9999-4999-8999-000001000002');
    assert.strictEqual(validated.student_id, 'c1000000-0000-0000-0000-000000000001');
    assert.strictEqual(validated.attempt_number, 1);
    assert.strictEqual(validated.status, 'draft');
    assert.strictEqual(validated.max_score, 2);
    assert.strictEqual(validated.resumed_existing, true);
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
