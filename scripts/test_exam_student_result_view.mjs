// scripts/test_exam_student_result_view.mjs
// Student Result View V1 - Complete Unit, BFF, Security & Contract Test Suite

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createExamStudentClient,
  GET_RESULT_FUNCTION_NAME,
  validateGetStudentAttemptResultResponse,
} from '../src/services/examStudentClient.js';

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

// ---------------------------------------------------------
// Mock Data Fixtures (Strict RFC4122 Compliant Hex UUIDs)
// ---------------------------------------------------------
const STUDENT_A = '11111111-1111-4111-8111-111111111111';
const STUDENT_B = '22222222-2222-4222-8222-222222222222';
const TEACHER_T = '33333333-3333-4333-8333-333333333333';

const ATTEMPT_GRADED_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const ATTEMPT_SUBMITTED_A = 'aaaaaaaa-2222-4222-8222-222222222222';
const ATTEMPT_PENDING_MANUAL_A = 'aaaaaaaa-3333-4333-8333-333333333333';
const ATTEMPT_DRAFT_A = 'aaaaaaaa-4444-4444-8444-444444444444';
const ATTEMPT_GRADED_B = 'bbbbbbbb-1111-4111-8111-111111111111';

const EXAM_VERSION_1 = 'cccccccc-1111-4111-8111-111111111111';
const EXAM_ASSIGNMENT_1 = 'dddddddd-1111-4111-8111-111111111111';

const Q_UUID_1 = 'eeeeeeee-1111-4111-8111-111111111111';
const Q_UUID_2 = 'eeeeeeee-2222-4222-8222-222222222222';
const Q_UUID_3 = 'eeeeeeee-3333-4333-8333-333333333333';

const mockProfiles = {
  [STUDENT_A]: { id: STUDENT_A, role: 'student', is_disabled: false },
  [STUDENT_B]: { id: STUDENT_B, role: 'student', is_disabled: false },
  [TEACHER_T]: { id: TEACHER_T, role: 'teacher', is_disabled: false },
};

const mockAttempts = {
  [ATTEMPT_GRADED_A]: {
    id: ATTEMPT_GRADED_A,
    assignment_id: EXAM_ASSIGNMENT_1,
    student_id: STUDENT_A,
    status: 'graded',
    submitted_at: '2026-09-12T08:00:00.000Z',
    objective_score: 5.0,
    manual_score: 3.5,
    total_score: 8.5,
    max_score: 10.0,
    teacher_feedback: 'Làm bài rất tốt, câu tự luận giải thích rõ ràng!',
    reward_stars_awarded: 10,
    question_order: [Q_UUID_2, Q_UUID_1, Q_UUID_3],
    graded_by: TEACHER_T,
    internal_private_flag: 'SECRET_DO_NOT_LEAK',
  },
  [ATTEMPT_SUBMITTED_A]: {
    id: ATTEMPT_SUBMITTED_A,
    assignment_id: EXAM_ASSIGNMENT_1,
    student_id: STUDENT_A,
    status: 'submitted',
    submitted_at: '2026-09-12T08:00:00.000Z',
    objective_score: 5.0,
    manual_score: 0,
    total_score: 5.0,
    max_score: 10.0,
    teacher_feedback: null,
    reward_stars_awarded: 0,
    question_order: [Q_UUID_1, Q_UUID_2],
  },
  [ATTEMPT_PENDING_MANUAL_A]: {
    id: ATTEMPT_PENDING_MANUAL_A,
    assignment_id: EXAM_ASSIGNMENT_1,
    student_id: STUDENT_A,
    status: 'pending_manual_grade',
    submitted_at: '2026-09-12T08:00:00.000Z',
    objective_score: 5.0,
    manual_score: null,
    total_score: null,
    max_score: 10.0,
    teacher_feedback: null,
    reward_stars_awarded: 0,
    question_order: [Q_UUID_1, Q_UUID_2],
  },
  [ATTEMPT_DRAFT_A]: {
    id: ATTEMPT_DRAFT_A,
    assignment_id: EXAM_ASSIGNMENT_1,
    student_id: STUDENT_A,
    status: 'draft',
    submitted_at: null,
    objective_score: null,
    manual_score: null,
    total_score: null,
    max_score: 10.0,
    teacher_feedback: null,
    reward_stars_awarded: 0,
    question_order: [Q_UUID_1, Q_UUID_2],
  },
  [ATTEMPT_GRADED_B]: {
    id: ATTEMPT_GRADED_B,
    assignment_id: EXAM_ASSIGNMENT_1,
    student_id: STUDENT_B,
    status: 'graded',
    submitted_at: '2026-09-12T08:15:00.000Z',
    objective_score: 4.0,
    manual_score: 4.0,
    total_score: 8.0,
    max_score: 10.0,
    teacher_feedback: 'Bài của học sinh B',
    reward_stars_awarded: 10,
    question_order: [Q_UUID_1, Q_UUID_2],
  },
};

const mockAssignments = {
  [EXAM_ASSIGNMENT_1]: {
    id: EXAM_ASSIGNMENT_1,
    exam_version_id: EXAM_VERSION_1,
    class_id: 'class-1',
  },
};

const mockVersions = {
  [EXAM_VERSION_1]: {
    id: EXAM_VERSION_1,
    title: 'Đề Kiểm Tra Giữa Kỳ Toán 5',
    subject: 'Toán',
    grade_level: 5,
    total_points: 10.0,
  },
};

const mockAttemptAnswers = {
  [ATTEMPT_GRADED_A]: [
    {
      attempt_id: ATTEMPT_GRADED_A,
      exam_question_id: Q_UUID_1,
      student_answer: 'A',
      is_correct: true,
      points_earned: 5.0,
      teacher_comment: null,
    },
    {
      attempt_id: ATTEMPT_GRADED_A,
      exam_question_id: Q_UUID_2,
      student_answer: 'Lời giải bài toán tự luận hình học...',
      is_correct: null,
      points_earned: 3.5,
      teacher_comment: 'Vẽ hình đúng nhưng thiếu đơn vị ở đáp số.',
    },
    {
      attempt_id: ATTEMPT_GRADED_A,
      exam_question_id: Q_UUID_3,
      student_answer: 'Chưa làm',
      is_correct: false,
      points_earned: 0,
      teacher_comment: 'Cần làm thêm bài tập dạng này.',
    },
  ],
};

const mockQuestions = {
  [Q_UUID_1]: {
    id: Q_UUID_1,
    exam_version_id: EXAM_VERSION_1,
    question_type: 'single_choice',
    prompt: '1 + 1 bằng bao nhiêu?',
    options_json: [
      { key: 'A', text: '2' },
      { key: 'B', text: '3' },
      { key: 'C', text: '4' },
    ],
    points: 5.0,
    order_index: 1,
    correct_answer: 'A', // MUST NEVER BE LEAKED TO STUDENT
  },
  [Q_UUID_2]: {
    id: Q_UUID_2,
    exam_version_id: EXAM_VERSION_1,
    question_type: 'essay',
    prompt: 'Tính diện tích hình tròn có bán kính r = 3cm.',
    options_json: null,
    points: 4.0,
    order_index: 2,
    correct_answer: '28.26', // MUST NEVER BE LEAKED
  },
  [Q_UUID_3]: {
    id: Q_UUID_3,
    exam_version_id: EXAM_VERSION_1,
    question_type: 'short_answer',
    prompt: 'Thủ đô của Việt Nam là gì?',
    options_json: null,
    points: 1.0,
    order_index: 3,
    correct_answer: 'Hà Nội', // MUST NEVER BE LEAKED
  },
};

// ---------------------------------------------------------
// Pure Validation Logic (mirroring validation.ts)
// ---------------------------------------------------------
function isUuid(val) {
  if (typeof val !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val.trim());
}

function validatePayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Dữ liệu yêu cầu phải là một JSON object.' };
  }

  const forbiddenKeys = [
    'student_id',
    'caller_id',
    'role',
    'is_admin',
    'teacher_id',
    'is_correct',
    'correct_answer',
    'answer_key',
    'points_earned',
    'graded_by',
    'scores',
  ];

  for (const key of Object.keys(body)) {
    if (forbiddenKeys.includes(key)) {
      return { valid: false, errorCode: 'FORBIDDEN_FIELD', errorMessage: `Trường '${key}' không được phép gửi lên.` };
    }
  }

  if (!body.attempt_id) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: "Thiếu trường 'attempt_id'." };
  }

  if (!isUuid(body.attempt_id)) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: "Trường 'attempt_id' phải là một UUID hợp lệ." };
  }

  return { valid: true, sanitizedPayload: { attempt_id: body.attempt_id.trim() } };
}

// ---------------------------------------------------------
// Pure Handler Execution Simulator (mirroring handler.ts)
// ---------------------------------------------------------
let queriedTables = [];

async function simulateGetStudentAttemptResult(req, deps) {
  queriedTables = [];

  // 1. Method check
  if (req.method !== 'POST') {
    return {
      status: 405,
      body: { success: false, error_code: 'METHOD_NOT_ALLOWED', message: 'Phương thức HTTP không được hỗ trợ.' },
    };
  }

  // 2. Auth check
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      status: 401,
      body: { success: false, error_code: 'AUTH_REQUIRED', message: 'Yêu cầu đăng nhập để xem kết quả.' },
    };
  }

  const callerId = deps.callerId;
  if (!callerId) {
    return {
      status: 401,
      body: { success: false, error_code: 'AUTH_REQUIRED', message: 'Token không hợp lệ.' },
    };
  }

  // 3. Profile & Role check
  queriedTables.push('profiles');
  const profile = mockProfiles[callerId];
  if (!profile || profile.role !== 'student') {
    return {
      status: 403,
      body: { success: false, error_code: 'FORBIDDEN_ROLE', message: 'Chỉ học sinh mới có quyền xem kết quả bài thi.' },
    };
  }

  // 4. Payload validation
  let rawBody = {};
  const text = await req.text();
  if (text) {
    try {
      rawBody = JSON.parse(text);
    } catch (_) {
      return {
        status: 400,
        body: { success: false, error_code: 'INVALID_INPUT', message: 'Dữ liệu JSON không hợp lệ.' },
      };
    }
  }

  const valRes = validatePayload(rawBody);
  if (!valRes.valid) {
    return {
      status: 400,
      body: { success: false, error_code: valRes.errorCode, message: valRes.errorMessage },
    };
  }

  const { attempt_id } = valRes.sanitizedPayload;

  // 5. Load attempt and verify ownership: query by ID AND student_id === callerId
  queriedTables.push('exam_attempts');
  const attempt = mockAttempts[attempt_id];

  // Foreign attempt OR nonexistent attempt => UNIFIED 404
  if (!attempt || attempt.student_id !== callerId) {
    return {
      status: 404,
      body: { success: false, error_code: 'ATTEMPT_NOT_FOUND', message: 'Không tìm thấy lượt làm bài thi.' },
    };
  }

  // 6. Enforce Release Rule: Only status === 'graded' may return detailed result
  if (attempt.status !== 'graded') {
    return {
      status: 403,
      body: {
        success: false,
        error_code: 'ERR_RESULT_NOT_FINAL',
        message: 'Kết quả bài thi chưa sẵn sàng để công bố. Bài thi đang ở trạng thái chưa hoàn tất chấm điểm.',
      },
    };
  }

  // 7. Load assignment and exam version
  queriedTables.push('exam_assignments');
  const assignment = mockAssignments[attempt.assignment_id];
  queriedTables.push('exam_versions');
  const version = assignment ? mockVersions[assignment.exam_version_id] : null;

  // 8. Load student attempt answers
  queriedTables.push('exam_attempt_answers');
  const attemptAnswers = mockAttemptAnswers[attempt_id] || [];

  // 9. Load exam questions
  queriedTables.push('exam_questions');
  const questionIds = attemptAnswers.map((a) => a.exam_question_id).filter(Boolean);
  const questions = questionIds.map((qid) => mockQuestions[qid]).filter(Boolean);
  const questionMap = new Map(questions.map((q) => [q.id, q]));
  const answerMap = new Map(attemptAnswers.map((a) => [a.exam_question_id, a]));

  // 10. Order preservation
  const orderedQuestionIds =
    Array.isArray(attempt.question_order) && attempt.question_order.length > 0
      ? attempt.question_order
      : questions.sort((a, b) => a.order_index - b.order_index).map((q) => q.id);

  const projectedQuestions = [];
  let displayOrder = 1;

  for (const qId of orderedQuestionIds) {
    const q = questionMap.get(qId);
    if (!q) continue;

    const ans = answerMap.get(qId);

    // Safe options display for single_choice
    let safeOptions = null;
    if (Array.isArray(q.options_json) && q.options_json.length > 0) {
      safeOptions = q.options_json.map((opt) => ({
        key: String(opt?.key || ''),
        text: String(opt?.text || opt?.label || ''),
      }));
    }

    projectedQuestions.push({
      exam_question_id: q.id,
      question_number: displayOrder++,
      prompt: q.prompt,
      question_type: q.question_type,
      options_json: safeOptions,
      points_possible: Number(q.points || 0),
      student_answer: ans?.student_answer !== undefined ? ans.student_answer : null,
      file_url: ans?.file_url || null,
      points_earned: ans && typeof ans.points_earned === 'number' ? ans.points_earned : 0,
      teacher_comment: ans?.teacher_comment || null,
    });
  }

  // 11. Strict Safe Envelope
  return {
    status: 200,
    body: {
      success: true,
      data: {
        attempt: {
          id: attempt.id,
          status: 'graded',
          submitted_at: attempt.submitted_at || null,
          objective_score: Number(attempt.objective_score || 0),
          manual_score: Number(attempt.manual_score || 0),
          total_score: Number(attempt.total_score || 0),
          max_score: Number(attempt.max_score || 0),
          teacher_feedback: attempt.teacher_feedback || null,
          reward_stars_awarded: Number(attempt.reward_stars_awarded || 0),
        },
        exam: {
          title: version?.title || 'Đề kiểm tra',
          subject: version?.subject || '',
          grade_level: version?.grade_level || 1,
        },
        questions: projectedQuestions,
      },
    },
  };
}

// ---------------------------------------------------------
// Master Test Suite
// ---------------------------------------------------------
async function runAllTests() {
  console.log('====================================================');
  console.log('STUDENT RESULT VIEW V1 — SUITE OF TESTS');
  console.log('====================================================\n');

  // --- 1. PAYLOAD VALIDATION & INJECTION DEFENSE ---
  console.log('--- 1. Validation & Strict Input Tests ---');

  await it('Payload: Valid UUID attempt_id passes validation', async () => {
    const res = validatePayload({
      attempt_id: ATTEMPT_GRADED_A,
    });
    assert.equal(res.valid, true);
    assert.equal(res.sanitizedPayload.attempt_id, ATTEMPT_GRADED_A);
  });

  await it('Payload: Missing attempt_id is rejected with 400 INVALID_INPUT', async () => {
    const res = validatePayload({});
    assert.equal(res.valid, false);
    assert.equal(res.errorCode, 'INVALID_INPUT');
  });

  await it('Payload: Invalid UUID format is rejected with 400 INVALID_INPUT', async () => {
    const res = validatePayload({
      attempt_id: 'not-a-uuid-1234',
    });
    assert.equal(res.valid, false);
    assert.equal(res.errorCode, 'INVALID_INPUT');
  });

  await it('Payload: Client injecting fake student_id is rejected with FORBIDDEN_FIELD', async () => {
    const res = validatePayload({
      attempt_id: ATTEMPT_GRADED_A,
      student_id: STUDENT_B,
    });
    assert.equal(res.valid, false);
    assert.equal(res.errorCode, 'FORBIDDEN_FIELD');
  });

  await it('Payload: Client injecting role or is_correct is rejected with FORBIDDEN_FIELD', async () => {
    const res = validatePayload({
      attempt_id: ATTEMPT_GRADED_A,
      role: 'admin',
    });
    assert.equal(res.valid, false);
    assert.equal(res.errorCode, 'FORBIDDEN_FIELD');
  });

  // --- 2. AUTH & ROLE REQUIREMENTS ---
  console.log('\n--- 2. Auth & Role Tests ---');

  await it('Auth: Missing Authorization header returns 401 AUTH_REQUIRED', async () => {
    const req = new Request('https://edge.supabase.test/functions/v1/exam-get-student-attempt-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attempt_id: ATTEMPT_GRADED_A }),
    });

    const res = await simulateGetStudentAttemptResult(req, { callerId: null });
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error_code, 'AUTH_REQUIRED');
  });

  await it('Auth: Non-student role (e.g. teacher) returns 403 FORBIDDEN_ROLE', async () => {
    const req = new Request('https://edge.supabase.test/functions/v1/exam-get-student-attempt-result', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer teacher-token',
      },
      body: JSON.stringify({ attempt_id: ATTEMPT_GRADED_A }),
    });

    const res = await simulateGetStudentAttemptResult(req, { callerId: TEACHER_T });
    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error_code, 'FORBIDDEN_ROLE');
  });

  // --- 3. OWNERSHIP & 404 PRIVACY ENFORCEMENT ---
  console.log('\n--- 3. Ownership & Privacy Tests ---');

  await it('Ownership: Student A attempting to access Student B attempt returns unified 404 ATTEMPT_NOT_FOUND', async () => {
    const req = new Request('https://edge.supabase.test/functions/v1/exam-get-student-attempt-result', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer student-a-token',
      },
      body: JSON.stringify({ attempt_id: ATTEMPT_GRADED_B }),
    });

    const res = await simulateGetStudentAttemptResult(req, { callerId: STUDENT_A });
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error_code, 'ATTEMPT_NOT_FOUND');
  });

  await it('Ownership: Nonexistent attempt_id returns exact same unified 404 ATTEMPT_NOT_FOUND', async () => {
    const req = new Request('https://edge.supabase.test/functions/v1/exam-get-student-attempt-result', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer student-a-token',
      },
      body: JSON.stringify({ attempt_id: '99999999-9999-4999-8999-999999999999' }),
    });

    const res = await simulateGetStudentAttemptResult(req, { callerId: STUDENT_A });
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error_code, 'ATTEMPT_NOT_FOUND');
  });

  // --- 4. STATUS & RELEASE GATING ---
  console.log('\n--- 4. Status Release Gating Tests ---');

  await it('Status: Draft attempt returns 403 ERR_RESULT_NOT_FINAL', async () => {
    const req = new Request('https://edge.supabase.test/functions/v1/exam-get-student-attempt-result', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer student-a-token',
      },
      body: JSON.stringify({ attempt_id: ATTEMPT_DRAFT_A }),
    });

    const res = await simulateGetStudentAttemptResult(req, { callerId: STUDENT_A });
    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error_code, 'ERR_RESULT_NOT_FINAL');
  });

  await it('Status: Submitted attempt returns 403 ERR_RESULT_NOT_FINAL', async () => {
    const req = new Request('https://edge.supabase.test/functions/v1/exam-get-student-attempt-result', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer student-a-token',
      },
      body: JSON.stringify({ attempt_id: ATTEMPT_SUBMITTED_A }),
    });

    const res = await simulateGetStudentAttemptResult(req, { callerId: STUDENT_A });
    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error_code, 'ERR_RESULT_NOT_FINAL');
  });

  await it('Status: Pending manual grade attempt returns 403 ERR_RESULT_NOT_FINAL', async () => {
    const req = new Request('https://edge.supabase.test/functions/v1/exam-get-student-attempt-result', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer student-a-token',
      },
      body: JSON.stringify({ attempt_id: ATTEMPT_PENDING_MANUAL_A }),
    });

    const res = await simulateGetStudentAttemptResult(req, { callerId: STUDENT_A });
    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error_code, 'ERR_RESULT_NOT_FINAL');
  });

  // --- 5. GRADED ATTEMPT SUCCESS & DATA SAFETY PROJECTION ---
  console.log('\n--- 5. Graded Success & Data Safety Projection Tests ---');

  let successResponseEnvelope = null;

  await it('Graded: Student A accessing own graded attempt returns 200 OK with safe projection', async () => {
    const req = new Request('https://edge.supabase.test/functions/v1/exam-get-student-attempt-result', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer student-a-token',
      },
      body: JSON.stringify({ attempt_id: ATTEMPT_GRADED_A }),
    });

    const res = await simulateGetStudentAttemptResult(req, { callerId: STUDENT_A });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data);
    successResponseEnvelope = res.body;
  });

  await it('Data Safety: app_private.exam_answer_keys was NEVER queried', async () => {
    assert.equal(
      queriedTables.includes('exam_answer_keys') || queriedTables.includes('app_private.exam_answer_keys'),
      false,
      'app_private.exam_answer_keys must never be queried in student result path'
    );
  });

  await it('Data Safety: Response contains NO answer keys or correct_answer', async () => {
    const rawStr = JSON.stringify(successResponseEnvelope);
    assert.equal(rawStr.includes('correct_answer'), false, 'correct_answer must not exist in response');
    assert.equal(rawStr.includes('answer_key'), false, 'answer_key must not exist in response');
  });

  await it('Data Safety: Response contains NO is_correct flag in V1', async () => {
    const rawStr = JSON.stringify(successResponseEnvelope);
    assert.equal(rawStr.includes('"is_correct"'), false, 'is_correct must not exist in response');
  });

  await it('Data Safety: Response contains NO graded_by or internal service fields', async () => {
    const rawStr = JSON.stringify(successResponseEnvelope);
    assert.equal(rawStr.includes('graded_by'), false, 'graded_by must not exist in response');
    assert.equal(rawStr.includes('SECRET_DO_NOT_LEAK'), false, 'private fields must not exist');
  });

  await it('Data: Attempt scores and feedback match authoritative values', async () => {
    const att = successResponseEnvelope.data.attempt;
    assert.equal(att.id, ATTEMPT_GRADED_A);
    assert.equal(att.status, 'graded');
    assert.equal(att.objective_score, 5.0);
    assert.equal(att.manual_score, 3.5);
    assert.equal(att.total_score, 8.5);
    assert.equal(att.max_score, 10.0);
    assert.equal(att.teacher_feedback, 'Làm bài rất tốt, câu tự luận giải thích rõ ràng!');
    assert.equal(att.reward_stars_awarded, 10);
  });

  await it('Data: Exam metadata projected safely', async () => {
    const exam = successResponseEnvelope.data.exam;
    assert.equal(exam.title, 'Đề Kiểm Tra Giữa Kỳ Toán 5');
    assert.equal(exam.subject, 'Toán');
    assert.equal(exam.grade_level, 5);
  });

  await it('Data & Ordering: Question order from attempt.question_order is preserved', async () => {
    const questions = successResponseEnvelope.data.questions;
    assert.equal(questions.length, 3);
    // question_order was [Q_UUID_2, Q_UUID_1, Q_UUID_3]
    assert.equal(questions[0].exam_question_id, Q_UUID_2);
    assert.equal(questions[0].question_number, 1);
    assert.equal(questions[0].points_earned, 3.5);
    assert.equal(questions[0].teacher_comment, 'Vẽ hình đúng nhưng thiếu đơn vị ở đáp số.');

    assert.equal(questions[1].exam_question_id, Q_UUID_1);
    assert.equal(questions[1].question_number, 2);
    assert.equal(questions[1].points_earned, 5.0);
    assert.equal(questions[1].teacher_comment, null);
    // Single choice options text are present, but no correct_answer
    assert.ok(Array.isArray(questions[1].options_json));
    assert.equal(questions[1].options_json.length, 3);
    assert.equal(questions[1].options_json[0].key, 'A');
    assert.equal(questions[1].options_json[0].text, '2');

    assert.equal(questions[2].exam_question_id, Q_UUID_3);
    assert.equal(questions[2].question_number, 3);
    assert.equal(questions[2].points_earned, 0);
  });

  // --- 6. FRONTEND CLIENT & VALIDATION CONTRACT ---
  console.log('\n--- 6. Frontend Client & Contract Validation Tests ---');

  await it('Client: validateGetStudentAttemptResultResponse validates correct shape', async () => {
    const valid = validateGetStudentAttemptResultResponse(successResponseEnvelope);
    assert.ok(valid);
    assert.equal(valid.attempt.id, ATTEMPT_GRADED_A);
    assert.equal(valid.questions.length, 3);
  });

  await it('Client: getStudentAttemptResult successfully invokes Edge Function with proper payload', async () => {
    let invokedName = null;
    let invokedBody = null;

    const client = createExamStudentClient({
      invokeFunction: async (fnName, { body }) => {
        invokedName = fnName;
        invokedBody = body;
        return {
          data: successResponseEnvelope,
          error: null,
        };
      },
    });

    const res = await client.getStudentAttemptResult({ attempt_id: ATTEMPT_GRADED_A });
    assert.equal(res.ok, true);
    assert.equal(invokedName, GET_RESULT_FUNCTION_NAME);
    assert.equal(invokedBody.attempt_id, ATTEMPT_GRADED_A);
    assert.equal(res.data.attempt.id, ATTEMPT_GRADED_A);
  });

  await it('Client: getStudentAttemptResult maps ERR_RESULT_NOT_FINAL gracefully', async () => {
    const client = createExamStudentClient({
      invokeFunction: async () => {
        return {
          data: {
            success: false,
            error_code: 'ERR_RESULT_NOT_FINAL',
            message: 'Kết quả bài thi chưa sẵn sàng để công bố.',
          },
          error: {
            status: 403,
            message: 'Forbidden',
          },
        };
      },
    });

    const res = await client.getStudentAttemptResult({ attempt_id: ATTEMPT_SUBMITTED_A });
    assert.equal(res.ok, false);
    assert.equal(res.safeErrorCode, 'ERR_RESULT_NOT_FINAL');
  });

  // --- 7. SOURCE INSPECTION CHECKS ---
  console.log('\n--- 7. Source Inspection Checks ---');

  await it('Source: ExerciseListTab renders "Xem Kết Quả" button for graded exam', async () => {
    const tabSource = fs.readFileSync(
      path.join(__dirname, '../src/components/dashboard/exercises/ExerciseListTab.jsx'),
      'utf-8'
    );
    assert.ok(tabSource.includes('StudentExamResultModal'), 'Must import StudentExamResultModal');
    assert.ok(tabSource.includes('handleOpenExamResult'), 'Must define handleOpenExamResult');
    assert.ok(tabSource.includes('Xem Kết Quả'), 'Must have button Xem Kết Quả');
    assert.ok(tabSource.includes('Đã nộp • Chờ chấm'), 'Must have text Đã nộp • Chờ chấm for pending');
  });

  await it('Source: StudentExamResultModal has no answer key or "Đáp án đúng" UI text', async () => {
    const modalSource = fs.readFileSync(
      path.join(__dirname, '../src/components/dashboard/exams/StudentExamResultModal.jsx'),
      'utf-8'
    );
    assert.equal(modalSource.includes('Đáp án đúng'), false, 'Modal must NOT display Đáp án đúng');
    assert.equal(modalSource.includes('correct_answer'), false, 'Modal must NOT refer to correct_answer');
    assert.equal(modalSource.includes('is_correct'), false, 'Modal must NOT refer to is_correct');
  });

  await it('Source: Edge Function config registered in supabase/config.toml', async () => {
    const configToml = fs.readFileSync(
      path.join(__dirname, '../supabase/config.toml'),
      'utf-8'
    );
    assert.ok(
      configToml.includes('[functions.exam-get-student-attempt-result]'),
      'supabase/config.toml must register exam-get-student-attempt-result'
    );
  });

  await it('Source: Backend handler enforces student_id === callerId with unified ATTEMPT_NOT_FOUND', async () => {
    const handlerSource = fs.readFileSync(
      path.join(__dirname, '../supabase/functions/exam-get-student-attempt-result/handler.ts'),
      'utf-8'
    );
    assert.ok(
      handlerSource.includes("eq('student_id', callerId)"),
      "Handler must enforce eq('student_id', callerId)"
    );
    assert.ok(
      handlerSource.includes('ATTEMPT_NOT_FOUND'),
      'Handler must return ATTEMPT_NOT_FOUND'
    );
    assert.ok(
      handlerSource.includes('ERR_RESULT_NOT_FINAL'),
      'Handler must return ERR_RESULT_NOT_FINAL'
    );
  });

  await it('Regression: DB_COLUMN_SOURCE=points and API_RESPONSE_FIELD=points_possible', async () => {
    const handlerSource = fs.readFileSync(
      path.join(__dirname, '../supabase/functions/exam-get-student-attempt-result/handler.ts'),
      'utf-8'
    );

    // 1. Must query 'points' from public.exam_questions
    assert.ok(
      handlerSource.includes(".select('id, prompt, question_type, points, options_json')"),
      "Handler must select 'points' from public.exam_questions"
    );

    // 2. Must NOT query 'points_possible' in the SQL select
    assert.equal(
      handlerSource.includes("select('id, prompt, question_type, points_possible"),
      false,
      "Handler must NOT query 'points_possible' from DB"
    );

    // 3. Must map 'points_possible: Number(q.points || 0)' for the frontend API response
    assert.ok(
      handlerSource.includes('points_possible: Number(q.points || 0)'),
      'Handler must map points_possible from q.points'
    );

    // 4. Client validation strictly accepts points_possible
    const sampleResponse = {
      success: true,
      data: {
        attempt: {
          id: ATTEMPT_GRADED_A,
          status: 'graded',
          attempt_number: 1,
          submitted_at: '2026-09-12T08:00:00.000Z',
          objective_score: 5.0,
          manual_score: 3.5,
          total_score: 8.5,
          max_score: 10.0,
          teacher_feedback: 'Tốt',
          reward_stars_awarded: 10,
        },
        exam: {
          title: 'Đề Toán',
          subject: 'Toán',
          grade_level: 5,
        },
        questions: [
          {
            exam_question_id: Q_UUID_1,
            question_number: 1,
            prompt: '1 + 1 = ?',
            question_type: 'single_choice',
            points_possible: 5.0,
            options_json: [{ key: 'A', text: '2' }],
            student_answer: 'A',
            file_url: null,
            points_earned: 5.0,
            teacher_comment: null,
          },
        ],
      },
    };
    const validated = validateGetStudentAttemptResultResponse(sampleResponse);
    assert.ok(validated);
    assert.equal(validated.questions[0].points_possible, 5.0);
  });

  console.log('\n====================================================');
  console.log(`TOTAL: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
  console.log('====================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
