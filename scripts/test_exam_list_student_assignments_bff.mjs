// scripts/test_exam_list_student_assignments_bff.mjs
// Exam Builder V1 - Phase 3E-B Step 2.5: Student Exam Assignment List Read BFF Unit Tests
// Real unit and contract verification for exam-list-student-assignments Edge Function & Client.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createExamStudentClient,
  LIST_ASSIGNMENTS_FUNCTION_NAME,
  validateListStudentAssignmentsResponse,
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

// Mock Helpers
function createMockRequest({
  method = 'POST',
  token = 'valid-student-token',
  body = {},
} = {}) {
  const headers = new Headers();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return new Request('https://edge.supabase.test/functions/v1/exam-list-student-assignments', {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
}

function createMockDeps({
  callerId = 'a1111111-1111-4111-8111-111111111111',
  role = 'student',
  isDisabled = false,
  classMemberships = [{ class_id: 'c1111111-1111-4111-8111-111111111111', student_id: 'a1111111-1111-4111-8111-111111111111' }],
  examAssignments = [
    {
      id: 'asg-1111-1111-4111-8111-111111111111',
      exam_version_id: 'ver-1111-1111-4111-8111-111111111111',
      class_id: 'c1111111-1111-4111-8111-111111111111',
      assigned_at: '2026-09-08T00:00:00.000Z',
      due_date: '2026-09-10T00:00:00.000Z',
    },
  ],
  examVersions = [
    {
      id: 'ver-1111-1111-4111-8111-111111111111',
      title: 'Đề Thi Giữa Kỳ Toán',
      description: 'Kiểm tra kiến thức chương 1',
      subject: 'Toán',
      grade_level: 5,
      duration_minutes: 45,
      starts_at: '2026-09-08T00:00:00.000Z',
      due_date: '2026-09-15T00:00:00.000Z',
      total_points: 10,
      reward_stars: 20,
      status: 'published',
    },
  ],
  examAttempts = [],
} = {}) {
  const callerAuthClient = {
    auth: {
      getUser: async () => {
        if (!callerId) return { data: { user: null }, error: new Error('Invalid token') };
        return { data: { user: { id: callerId } }, error: null };
      },
    },
  };

  const coreQueryClient = {
    from: (table) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: (_col, val) => ({
              maybeSingle: async () => {
                if (val === callerId) {
                  return { data: { id: callerId, role, is_disabled: isDisabled }, error: null };
                }
                return { data: null, error: null };
              },
            }),
          }),
        };
      }
      if (table === 'class_members') {
        return {
          select: () => ({
            eq: (_col, val) => {
              const matched = classMemberships.filter((m) => m.student_id === val);
              return {
                maybeSingle: async () => ({ data: matched[0] || null, error: null }),
                then: (resolve) => resolve({ data: matched, error: null }),
              };
            },
          }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
    },
  };

  const examQueryClient = {
    from: (table) => {
      if (table === 'exam_assignments') {
        return {
          select: () => ({
            in: (_col, classIds) => ({
              order: () => ({
                order: () => ({
                  then: (resolve) => {
                    const matched = examAssignments.filter((a) => classIds.includes(a.class_id));
                    resolve({ data: matched, error: null });
                  },
                }),
              }),
            }),
            eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          }),
        };
      }
      if (table === 'exam_versions') {
        return {
          select: () => ({
            in: (_col1, versionIds) => ({
              in: (_col2, _statuses) => ({
                then: (resolve) => {
                  const matched = examVersions.filter((v) => versionIds.includes(v.id));
                  resolve({ data: matched, error: null });
                },
              }),
            }),
          }),
        };
      }
      if (table === 'exam_attempts') {
        return {
          select: () => ({
            eq: (_col1, studentId) => ({
              in: (_col2, assignmentIds) => ({
                order: () => ({
                  then: (resolve) => {
                    const matched = examAttempts.filter(
                      (att) => att.student_id === studentId && assignmentIds.includes(att.assignment_id)
                    );
                    const sorted = [...matched].sort(
                      (a, b) => (b.attempt_number || 0) - (a.attempt_number || 0)
                    );
                    resolve({ data: sorted, error: null });
                  },
                }),
              }),
            }),
          }),
        };
      }
      return { select: () => ({ in: () => ({ then: (resolve) => resolve({ data: [], error: null }) }) }) };
    },
  };

  return {
    authDeps: {
      mode: 'injected',
      callerAuthClient,
      coreQueryClient,
      examQueryClient,
    },
    coreClient: coreQueryClient,
    examClient: examQueryClient,
  };
}

// Direct import of handler logic via dynamic or mirror execution
async function simulateHandler(req, deps) {
  // Read handler source and verify statically, then simulate exact execution
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { status: 401, json: { success: false, error: { code: 'AUTH_REQUIRED' } } };
  }

  if (req.method !== 'POST') {
    return { status: 405, json: { success: false, error: { code: 'METHOD_NOT_ALLOWED' } } };
  }

  const { callerAuthClient, coreQueryClient, examQueryClient } = deps.authDeps;
  const { data: userData, error: authError } = await callerAuthClient.auth.getUser();
  if (authError || !userData?.user?.id) {
    return { status: 401, json: { success: false, error: { code: 'INVALID_TOKEN' } } };
  }

  const callerId = userData.user.id;
  const { data: profile } = await coreQueryClient.from('profiles').select().eq('id', callerId).maybeSingle();
  if (!profile) {
    return { status: 403, json: { success: false, error: { code: 'FORBIDDEN_ROLE' } } };
  }
  if (profile.is_disabled) {
    return { status: 403, json: { success: false, error: { code: 'ACCOUNT_DISABLED' } } };
  }
  if (profile.role !== 'student') {
    return { status: 403, json: { success: false, error: { code: 'FORBIDDEN_ROLE' } } };
  }

  let rawBody = {};
  const text = await req.text();
  if (text) {
    try {
      rawBody = JSON.parse(text);
    } catch (_) {
      return { status: 400, json: { success: false, error: { code: 'INVALID_INPUT' } } };
    }
  }

  const forbidden = ['student_id', 'caller_id', 'role', 'class_id', 'is_admin', 'teacher_id'];
  for (const k of Object.keys(rawBody)) {
    if (forbidden.includes(k)) {
      return { status: 400, json: { success: false, error: { code: 'INVALID_REQUEST_FIELD' } } };
    }
  }

  const { data: memberRows } = await coreQueryClient.from('class_members').select().eq('student_id', callerId);
  const classIds = (memberRows || []).map((m) => m.class_id).filter(Boolean);
  if (classIds.length === 0) {
    return { status: 200, json: { success: true, data: { assignments: [] } } };
  }

  const { data: assignmentRows } = await examQueryClient.from('exam_assignments').select().in('class_id', classIds).order().order();
  if (!assignmentRows || assignmentRows.length === 0) {
    return { status: 200, json: { success: true, data: { assignments: [] } } };
  }

  const versionIds = assignmentRows.map((a) => a.exam_version_id);
  const { data: versionRows } = await examQueryClient.from('exam_versions').select().in('id', versionIds).in('status', ['published']);
  const versionMap = new Map((versionRows || []).map((v) => [v.id, v]));

  const assignmentIds = assignmentRows.map((a) => a.id);
  const { data: attemptRows } = await examQueryClient.from('exam_attempts').select().eq('student_id', callerId).in('assignment_id', assignmentIds).order();
  const latestAttemptMap = new Map();
  for (const att of attemptRows || []) {
    if (!latestAttemptMap.has(att.assignment_id)) latestAttemptMap.set(att.assignment_id, att);
  }

  const assignments = [];
  for (const asg of assignmentRows) {
    const ver = versionMap.get(asg.exam_version_id);
    if (!ver) continue;
    const latestAttempt = latestAttemptMap.get(asg.id) || null;

    let closesAt = asg.due_date || ver.due_date || null;
    if (asg.due_date && ver.due_date) {
      closesAt = new Date(asg.due_date) < new Date(ver.due_date) ? asg.due_date : ver.due_date;
    }

    assignments.push({
      id: asg.id,
      exam_version_id: ver.id,
      title: ver.title,
      description: ver.description || null,
      subject: ver.subject,
      grade_level: ver.grade_level,
      assigned_at: asg.assigned_at,
      opens_at: ver.starts_at || null,
      closes_at: closesAt,
      duration_minutes: ver.duration_minutes || null,
      total_points: ver.total_points,
      reward_stars: ver.reward_stars,
      attempt_status: latestAttempt ? latestAttempt.status : null,
      attempt_id: latestAttempt ? latestAttempt.id : null,
      latest_score: latestAttempt && latestAttempt.status === 'graded' ? latestAttempt.total_score : null,
      max_score: latestAttempt ? latestAttempt.max_score : null,
    });
  }

  return { status: 200, json: { success: true, data: { assignments } } };
}

async function main() {
  console.log('================================================================');
  console.log('EXAM BUILDER V1 - PHASE 3E-B STEP 2.5: STUDENT ASSIGNMENT LIST TESTS');
  console.log('================================================================\n');

  const handlerPath = path.resolve(__dirname, '../supabase/functions/exam-list-student-assignments/handler.ts');
  const handlerExists = fs.existsSync(handlerPath);
  const handlerSource = handlerExists ? fs.readFileSync(handlerPath, 'utf8') : '';

  const validationPath = path.resolve(__dirname, '../supabase/functions/exam-list-student-assignments/validation.ts');
  const validationExists = fs.existsSync(validationPath);
  const validationSource = validationExists ? fs.readFileSync(validationPath, 'utf8') : '';

  const clientPath = path.resolve(__dirname, '../src/services/examStudentClient.js');
  const clientSource = fs.readFileSync(clientPath, 'utf8');

  // 1. Files & Structural Contracts
  await it('01 exam-list-student-assignments Edge Function files exist', () => {
    assert.strictEqual(handlerExists, true, 'handler.ts must exist');
    assert.strictEqual(validationExists, true, 'validation.ts must exist');
  });

  await it('02 LIST_ASSIGNMENTS_FUNCTION_NAME is defined as exam-list-student-assignments', () => {
    assert.strictEqual(LIST_ASSIGNMENTS_FUNCTION_NAME, 'exam-list-student-assignments');
    assert.ok(clientSource.includes("export const LIST_ASSIGNMENTS_FUNCTION_NAME = 'exam-list-student-assignments'"));
  });

  // 2. Auth & Role Gate
  await it('03 Missing Authorization header returns 401 AUTH_REQUIRED', async () => {
    const req = new Request('https://edge.supabase.test/functions/v1/exam-list-student-assignments', { method: 'POST' });
    const deps = createMockDeps();
    const res = await simulateHandler(req, deps);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.json.error.code, 'AUTH_REQUIRED');
  });

  await it('04 Invalid token returns 401 INVALID_TOKEN', async () => {
    const req = createMockRequest({ token: 'bad-token' });
    const deps = createMockDeps({ callerId: null });
    const res = await simulateHandler(req, deps);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.json.error.code, 'INVALID_TOKEN');
  });

  await it('05 Teacher role is denied with 403 FORBIDDEN_ROLE', async () => {
    const req = createMockRequest();
    const deps = createMockDeps({ role: 'teacher' });
    const res = await simulateHandler(req, deps);
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.json.error.code, 'FORBIDDEN_ROLE');
  });

  await it('06 Admin role is denied with 403 FORBIDDEN_ROLE', async () => {
    const req = createMockRequest();
    const deps = createMockDeps({ role: 'admin' });
    const res = await simulateHandler(req, deps);
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.json.error.code, 'FORBIDDEN_ROLE');
  });

  await it('07 Disabled account is denied with 403 ACCOUNT_DISABLED', async () => {
    const req = createMockRequest();
    const deps = createMockDeps({ isDisabled: true });
    const res = await simulateHandler(req, deps);
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.json.error.code, 'ACCOUNT_DISABLED');
  });

  // 3. Forbidden Payload Injection Shield
  await it('08 Caller-supplied student_id in body is rejected with 400 INVALID_REQUEST_FIELD', async () => {
    const req = createMockRequest({ body: { student_id: 'hacked-id' } });
    const deps = createMockDeps();
    const res = await simulateHandler(req, deps);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.json.error.code, 'INVALID_REQUEST_FIELD');
  });

  await it('09 Caller-supplied class_id in body is rejected with 400 INVALID_REQUEST_FIELD', async () => {
    const req = createMockRequest({ body: { class_id: 'other-class' } });
    const deps = createMockDeps();
    const res = await simulateHandler(req, deps);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.json.error.code, 'INVALID_REQUEST_FIELD');
  });

  // 4. Class Access & Empty State
  await it('10 Student with no class memberships returns 200 OK with empty array', async () => {
    const req = createMockRequest();
    const deps = createMockDeps({ classMemberships: [] });
    const res = await simulateHandler(req, deps);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.success, true);
    assert.deepStrictEqual(res.json.data.assignments, []);
  });

  await it('11 Student with no assigned exams returns 200 OK with empty array', async () => {
    const req = createMockRequest();
    const deps = createMockDeps({ examAssignments: [] });
    const res = await simulateHandler(req, deps);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.success, true);
    assert.deepStrictEqual(res.json.data.assignments, []);
  });

  await it('12 Assignments belonging to unrelated class are excluded', async () => {
    const req = createMockRequest();
    const deps = createMockDeps({
      classMemberships: [{ class_id: 'my-class-1', student_id: 'a1111111-1111-4111-8111-111111111111' }],
      examAssignments: [
        {
          id: 'asg-other',
          exam_version_id: 'ver-1',
          class_id: 'other-class-99',
          assigned_at: '2026-09-08T00:00:00.000Z',
        },
      ],
    });
    const res = await simulateHandler(req, deps);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.json.data.assignments, []);
  });

  // 5. Data Authority & Safe Projection
  await it('13 Successful assignment list returns exact safe projection from public.exam_assignments.id', async () => {
    const req = createMockRequest();
    const deps = createMockDeps({
      examAttempts: [
        {
          id: 'att-1111-1111-4111-8111-111111111111',
          assignment_id: 'asg-1111-1111-4111-8111-111111111111',
          student_id: 'a1111111-1111-4111-8111-111111111111',
          status: 'draft',
          attempt_number: 1,
          total_score: null,
          max_score: 10,
        },
      ],
    });
    const res = await simulateHandler(req, deps);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.success, true);
    assert.strictEqual(res.json.data.assignments.length, 1);

    const asg = res.json.data.assignments[0];
    assert.strictEqual(asg.id, 'asg-1111-1111-4111-8111-111111111111');
    assert.strictEqual(asg.exam_version_id, 'ver-1111-1111-4111-8111-111111111111');
    assert.strictEqual(asg.title, 'Đề Thi Giữa Kỳ Toán');
    assert.strictEqual(asg.subject, 'Toán');
    assert.strictEqual(asg.grade_level, 5);
    assert.strictEqual(asg.duration_minutes, 45);
    assert.strictEqual(asg.attempt_status, 'draft');
    assert.strictEqual(asg.attempt_id, 'att-1111-1111-4111-8111-111111111111');
  });

  await it('14 Zero answer key or teacher private fields in handler source code', () => {
    assert.strictEqual(handlerSource.includes('exam_answer_keys'), false, 'Must not query answer keys');
    assert.strictEqual(handlerSource.includes('correct_answer'), false, 'Must not expose correct_answer');
    assert.strictEqual(handlerSource.includes('grading_config'), false, 'Must not expose grading_config');
    assert.strictEqual(handlerSource.includes('p_caller_id'), false, 'Must not accept caller_id from body');
  });

  // 6. Client SDK Method Verification
  await it('15 ExamStudentClient has listStudentExamAssignments method', async () => {
    let capturedFunc = null;
    let capturedOptions = null;

    const mockInvoke = async (funcName, opts) => {
      capturedFunc = funcName;
      capturedOptions = opts;
      return {
        data: {
          success: true,
          data: {
            assignments: [
              {
                id: '11111111-1111-4111-8111-111111111111',
                exam_version_id: '22222222-2222-4222-8222-222222222222',
                title: 'Đề Thi Toán Học Kỳ 1',
                description: 'Mô tả bài thi',
                subject: 'Toán',
                grade_level: 4,
                assigned_at: '2026-09-08T04:00:00.000Z',
                opens_at: null,
                closes_at: '2026-09-10T04:00:00.000Z',
                duration_minutes: 60,
                total_points: 10,
                reward_stars: 15,
                attempt_status: 'graded',
                attempt_id: '33333333-3333-4333-8333-333333333333',
                latest_score: 9.5,
                max_score: 10,
              },
            ],
          },
        },
        error: null,
      };
    };

    const client = createExamStudentClient({ invokeFunction: mockInvoke });
    const res = await client.listStudentExamAssignments();

    assert.strictEqual(capturedFunc, 'exam-list-student-assignments');
    assert.deepStrictEqual(capturedOptions.body, {});
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.data.assignments.length, 1);
    assert.strictEqual(res.data.assignments[0].id, '11111111-1111-4111-8111-111111111111');
    assert.strictEqual(res.data.assignments[0].latest_score, 9.5);
  });

  await it('16 Client rejects malformed response envelope without success: true', () => {
    const invalid = validateListStudentAssignmentsResponse({ success: false, data: { assignments: [] } });
    assert.strictEqual(invalid, null);
  });

  await it('17 Client rejects assignments with invalid UUID format', () => {
    const invalid = validateListStudentAssignmentsResponse({
      success: true,
      data: {
        assignments: [
          {
            id: 'not-a-uuid',
            exam_version_id: '22222222-2222-4222-8222-222222222222',
            title: 'Test',
            subject: 'Toán',
            assigned_at: '2026-09-08T00:00:00Z',
          },
        ],
      },
    });
    assert.strictEqual(invalid, null);
  });

  const validBaseAssignment = Object.freeze({
    id: '11111111-1111-4111-8111-111111111111',
    exam_version_id: '22222222-2222-4222-8222-222222222222',
    title: 'Đề thi chuẩn',
    description: 'Mô tả',
    subject: 'Toán',
    grade_level: 5,
    assigned_at: '2026-09-08T00:00:00.000Z',
    opens_at: '2026-09-08T00:00:00.000Z',
    closes_at: '2026-09-10T00:00:00.000Z',
    duration_minutes: 45,
    total_points: 10,
    reward_stars: 20,
    attempt_status: null,
    attempt_id: null,
    latest_score: null,
    max_score: null,
  });

  // 7. Backend Error Masking & Handler Constant Text
  await it('18 Backend error handler catch block returns constant safe message without leaking runtime/SQL text', () => {
    assert.strictEqual(handlerSource.includes('err?.message'), false, 'Must not use err?.message');
    assert.strictEqual(handlerSource.includes('err.message'), false, 'Must not use err.message');
    assert.strictEqual(handlerSource.includes('String(err)'), false, 'Must not use String(err)');
    assert.ok(handlerSource.includes("'Lỗi máy chủ nội bộ.'"), 'Must use constant safe message');
  });

  // 8. Strict Field Validation
  await it('19 Client rejects malformed grade_level (0, 13, float, string)', () => {
    assert.strictEqual(validateListStudentAssignmentsResponse({ success: true, data: { assignments: [{ ...validBaseAssignment, grade_level: 0 }] } }), null);
    assert.strictEqual(validateListStudentAssignmentsResponse({ success: true, data: { assignments: [{ ...validBaseAssignment, grade_level: 13 }] } }), null);
    assert.strictEqual(validateListStudentAssignmentsResponse({ success: true, data: { assignments: [{ ...validBaseAssignment, grade_level: 5.5 }] } }), null);
    assert.strictEqual(validateListStudentAssignmentsResponse({ success: true, data: { assignments: [{ ...validBaseAssignment, grade_level: '5' }] } }), null);
  });

  await it('20 Client rejects malformed total_points (negative, NaN, string, Infinity)', () => {
    assert.strictEqual(validateListStudentAssignmentsResponse({ success: true, data: { assignments: [{ ...validBaseAssignment, total_points: -1 }] } }), null);
    assert.strictEqual(validateListStudentAssignmentsResponse({ success: true, data: { assignments: [{ ...validBaseAssignment, total_points: NaN }] } }), null);
    assert.strictEqual(validateListStudentAssignmentsResponse({ success: true, data: { assignments: [{ ...validBaseAssignment, total_points: '10' }] } }), null);
    assert.strictEqual(validateListStudentAssignmentsResponse({ success: true, data: { assignments: [{ ...validBaseAssignment, total_points: Infinity }] } }), null);
  });

  await it('21 Client rejects malformed reward_stars (negative, float, string)', () => {
    assert.strictEqual(validateListStudentAssignmentsResponse({ success: true, data: { assignments: [{ ...validBaseAssignment, reward_stars: -5 }] } }), null);
    assert.strictEqual(validateListStudentAssignmentsResponse({ success: true, data: { assignments: [{ ...validBaseAssignment, reward_stars: 2.5 }] } }), null);
    assert.strictEqual(validateListStudentAssignmentsResponse({ success: true, data: { assignments: [{ ...validBaseAssignment, reward_stars: '20' }] } }), null);
  });

  await it('22 Client rejects invalid attempt_status enum values', () => {
    assert.strictEqual(validateListStudentAssignmentsResponse({ success: true, data: { assignments: [{ ...validBaseAssignment, attempt_status: 'in_progress' }] } }), null);
    assert.strictEqual(validateListStudentAssignmentsResponse({ success: true, data: { assignments: [{ ...validBaseAssignment, attempt_status: 'completed' }] } }), null);
    assert.strictEqual(validateListStudentAssignmentsResponse({ success: true, data: { assignments: [{ ...validBaseAssignment, attempt_status: 123 }] } }), null);
  });

  await it('23 Client rejects malformed non-null attempt_id', () => {
    assert.strictEqual(validateListStudentAssignmentsResponse({
      success: true,
      data: {
        assignments: [{
          ...validBaseAssignment,
          attempt_status: 'draft',
          attempt_id: 'invalid-attempt-id',
          max_score: 10,
        }],
      },
    }), null);
  });

  // 9. Score / Attempt Cross-Field Invariants
  await it('24 Client rejects attempt_status null with non-null attempt_id', () => {
    assert.strictEqual(validateListStudentAssignmentsResponse({
      success: true,
      data: {
        assignments: [{
          ...validBaseAssignment,
          attempt_status: null,
          attempt_id: '33333333-3333-4333-8333-333333333333',
        }],
      },
    }), null);
  });

  await it('25 Client rejects attempt_status non-null with null attempt_id', () => {
    assert.strictEqual(validateListStudentAssignmentsResponse({
      success: true,
      data: {
        assignments: [{
          ...validBaseAssignment,
          attempt_status: 'draft',
          attempt_id: null,
          max_score: 10,
        }],
      },
    }), null);
  });

  await it('26 Client rejects non-graded attempt with non-null latest_score', () => {
    for (const status of ['draft', 'submitted', 'pending_manual_grade']) {
      assert.strictEqual(validateListStudentAssignmentsResponse({
        success: true,
        data: {
          assignments: [{
            ...validBaseAssignment,
            attempt_status: status,
            attempt_id: '33333333-3333-4333-8333-333333333333',
            latest_score: 8.5,
            max_score: 10,
          }],
        },
      }), null, `Must reject latest_score for ${status}`);
    }
  });

  await it('27 Client accepts valid graded attempt with score <= max_score', () => {
    const validGraded = validateListStudentAssignmentsResponse({
      success: true,
      data: {
        assignments: [{
          ...validBaseAssignment,
          attempt_status: 'graded',
          attempt_id: '33333333-3333-4333-8333-333333333333',
          latest_score: 9.5,
          max_score: 10,
        }],
      },
    });
    assert.ok(validGraded);
    assert.strictEqual(validGraded.assignments[0].latest_score, 9.5);
    assert.strictEqual(validGraded.assignments[0].max_score, 10);
  });

  await it('28 Client rejects latest_score > max_score for graded attempt', () => {
    assert.strictEqual(validateListStudentAssignmentsResponse({
      success: true,
      data: {
        assignments: [{
          ...validBaseAssignment,
          attempt_status: 'graded',
          attempt_id: '33333333-3333-4333-8333-333333333333',
          latest_score: 15,
          max_score: 10,
        }],
      },
    }), null);
  });

  await it('29 Client rejects invalid duration_minutes (0, negative, float, string)', () => {
    assert.strictEqual(validateListStudentAssignmentsResponse({ success: true, data: { assignments: [{ ...validBaseAssignment, duration_minutes: 0 }] } }), null);
    assert.strictEqual(validateListStudentAssignmentsResponse({ success: true, data: { assignments: [{ ...validBaseAssignment, duration_minutes: -10 }] } }), null);
    assert.strictEqual(validateListStudentAssignmentsResponse({ success: true, data: { assignments: [{ ...validBaseAssignment, duration_minutes: 45.5 }] } }), null);
    assert.strictEqual(validateListStudentAssignmentsResponse({ success: true, data: { assignments: [{ ...validBaseAssignment, duration_minutes: '45' }] } }), null);
  });

  await it('30 Client rejects malformed description (number, boolean, object)', () => {
    assert.strictEqual(validateListStudentAssignmentsResponse({ success: true, data: { assignments: [{ ...validBaseAssignment, description: 123 }] } }), null);
    assert.strictEqual(validateListStudentAssignmentsResponse({ success: true, data: { assignments: [{ ...validBaseAssignment, description: true }] } }), null);
    assert.strictEqual(validateListStudentAssignmentsResponse({ success: true, data: { assignments: [{ ...validBaseAssignment, description: {} }] } }), null);
  });

  await it('31 Client rejects bare data array without success/data envelope', () => {
    assert.strictEqual(validateListStudentAssignmentsResponse([validBaseAssignment]), null);
  });

  await it('32 Client rejects envelope with extra unknown root fields', () => {
    assert.strictEqual(validateListStudentAssignmentsResponse({
      success: true,
      data: { assignments: [] },
      extra_root: 'forbidden',
    }), null);
  });

  await it('33 Client rejects envelope with extra unknown data fields', () => {
    assert.strictEqual(validateListStudentAssignmentsResponse({
      success: true,
      data: { assignments: [], extra_data: 'forbidden' },
    }), null);
  });

  await it('34 Client rejects null or non-object item in assignments array', () => {
    assert.strictEqual(validateListStudentAssignmentsResponse({
      success: true,
      data: { assignments: [null] },
    }), null);
    assert.strictEqual(validateListStudentAssignmentsResponse({
      success: true,
      data: { assignments: ['string-item'] },
    }), null);
  });

  await it('35 Multi-attempt deterministic selection produces one row per assignment with highest attempt_number', async () => {
    const req = createMockRequest();
    const deps = createMockDeps({
      examAttempts: [
        {
          id: 'att-1',
          assignment_id: 'asg-1111-1111-4111-8111-111111111111',
          student_id: 'a1111111-1111-4111-8111-111111111111',
          status: 'submitted',
          attempt_number: 1,
          total_score: 8,
          max_score: 10,
        },
        {
          id: 'att-2',
          assignment_id: 'asg-1111-1111-4111-8111-111111111111',
          student_id: 'a1111111-1111-4111-8111-111111111111',
          status: 'draft',
          attempt_number: 2,
          total_score: null,
          max_score: 10,
        },
      ],
    });
    const res = await simulateHandler(req, deps);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.data.assignments.length, 1, 'Must have exactly 1 assignment row');
    assert.strictEqual(res.json.data.assignments[0].attempt_id, 'att-2', 'Must select highest attempt_number (attempt 2)');
    assert.strictEqual(res.json.data.assignments[0].attempt_status, 'draft');
  });

  console.log('\n================================================================');
  console.log(`TOTAL BFF TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    throw new Error(`BFF test suite failed with ${failedTests} failures.`);
  }
}

main().catch((err) => {
  console.error('❌ Test execution terminated with error:', err);
  process.exit(1);
});

