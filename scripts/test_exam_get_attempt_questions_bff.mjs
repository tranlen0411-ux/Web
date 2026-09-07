// scripts/test_exam_get_attempt_questions_bff.mjs
// Comprehensive Unit & Security Test Suite for Exam Builder V1 Phase 3E-B0
// Safe Student Question Delivery BFF (exam-get-attempt-questions)
// Tests Production TypeScript Modules (_shared/examErrors.ts, validation.ts) & Handler Dispatch Flow

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ----------------------------------------------------------------------------
// 1. Direct Imports of ACTUAL PRODUCTION TypeScript Modules
// ----------------------------------------------------------------------------
import {
  corsHeaders,
  createErrorResponse,
  createSuccessResponse,
  normalizeGetAttemptQuestionsRpcError,
  mapGetAttemptQuestionsSuccess,
  APPROVED_QUESTION_TYPES,
} from '../supabase/functions/_shared/examErrors.ts';

import {
  validateGetAttemptQuestionsPayload,
  UUID_REGEX,
  FORBIDDEN_FIELDS,
  ALLOWED_FIELDS,
} from '../supabase/functions/exam-get-attempt-questions/validation.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

async function test(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✓ PASS [${String(totalTests).padStart(2, '0')}]: ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`  ❌ FAIL [${String(totalTests).padStart(2, '0')}]: ${name}`);
    console.error(err);
  }
}

// ----------------------------------------------------------------------------
// 2. Node.js Spec Mirror for Handler Integration Flow
// (Deno Edge runtime uses https:// URL imports in examAuth.ts which Node ESM does not resolve directly)
// ----------------------------------------------------------------------------

async function handleGetAttemptQuestionsRequestMirror(req, deps) {
  // 1. CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // 2. Enforce POST HTTP Method
  if (req.method !== 'POST') {
    return createErrorResponse(
      405,
      'METHOD_NOT_ALLOWED',
      'Phương thức HTTP không được hỗ trợ. Chỉ chấp nhận POST.'
    );
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return createErrorResponse(401, 'AUTH_REQUIRED', 'Yêu cầu xác thực Bearer token.');
    }
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return createErrorResponse(401, 'AUTH_REQUIRED', 'Yêu cầu xác thực Bearer token.');
    }

    if (!deps || !deps.authDeps) {
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Dependencies not configured.');
    }

    const { callerAuthClient, coreQueryClient } = deps.authDeps;
    const { data: userData, error: authError } = await callerAuthClient.auth.getUser();
    if (authError || !userData?.user?.id) {
      return createErrorResponse(401, 'INVALID_TOKEN', 'Phiên đăng nhập không hợp lệ.');
    }
    const callerId = userData.user.id;

    const { data: profile, error: dbError } = await coreQueryClient.from('profiles').select('id, role, is_disabled').eq('id', callerId).maybeSingle();
    if (dbError || !profile) {
      return createErrorResponse(403, 'FORBIDDEN_ROLE', 'Hồ sơ người dùng không hợp lệ.');
    }
    if (profile.is_disabled === true) {
      return createErrorResponse(403, 'ACCOUNT_DISABLED', 'Tài khoản đã bị vô hiệu hóa.');
    }
    if (profile.role !== 'student') {
      return createErrorResponse(403, 'FORBIDDEN_ROLE', 'Chỉ Học sinh mới có quyền thực hiện.');
    }

    const examClient = deps.examClient;
    const coreClient = coreQueryClient;

    if (!coreClient || !examClient) {
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Database clients not configured.');
    }

    let rawBody;
    try {
      rawBody = await req.json();
    } catch (_) {
      return createErrorResponse(400, 'INVALID_INPUT', 'Dữ liệu yêu cầu không phải là JSON hợp lệ.');
    }

    const valResult = validateGetAttemptQuestionsPayload(rawBody, { callerId });
    if (!valResult.valid || !valResult.sanitizedData) {
      return createErrorResponse(400, valResult.errorCode || 'INVALID_INPUT', valResult.errorMessage || 'Invalid payload.');
    }

    const sanitized = valResult.sanitizedData;

    // BFF Anti-Oracle Precheck
    const { data: attemptRow, error: attemptErr } = await examClient
      .from('exam_attempts')
      .select('id, assignment_id, student_id')
      .eq('id', sanitized.attempt_id)
      .eq('student_id', callerId)
      .maybeSingle();

    if (attemptErr) {
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi truy vấn lượt thi.');
    }
    if (!attemptRow) {
      return createErrorResponse(404, 'ATTEMPT_NOT_FOUND', 'Không tìm thấy lượt làm bài thi.');
    }

    // Resolve assignment -> class_id
    const { data: assignmentRow, error: assignErr } = await examClient
      .from('exam_assignments')
      .select('id, class_id')
      .eq('id', attemptRow.assignment_id)
      .maybeSingle();

    if (assignErr) {
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi truy vấn bài giao.');
    }
    if (!assignmentRow) {
      return createErrorResponse(404, 'ERR_ASSIGNMENT_NOT_FOUND', 'Không tìm thấy bài thi được giao.');
    }

    const resolvedClassId = assignmentRow.class_id;

    // Check class membership
    // CROSS_PROJECT_MEMBERSHIP_CHECK_ATOMIC=NO
    const { data: memberRow, error: memberErr } = await coreClient
      .from('class_members')
      .select('class_id, student_id')
      .eq('class_id', resolvedClassId)
      .eq('student_id', callerId)
      .maybeSingle();

    if (memberErr) {
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi kiểm tra thành viên lớp.');
    }
    if (!memberRow) {
      return createErrorResponse(403, 'CLASS_ACCESS_DENIED', 'Bạn không thuộc lớp học này.');
    }

    // Call RPC
    const { data: rpcData, error: rpcErr } = await examClient.rpc('rpc_exam_get_attempt_questions', {
      p_caller_id: callerId,
      p_attempt_id: sanitized.attempt_id,
    });

    if (rpcErr) {
      const normalized = normalizeGetAttemptQuestionsRpcError(rpcErr);
      return createErrorResponse(normalized.status, normalized.errorCode, normalized.message);
    }

    const mapped = mapGetAttemptQuestionsSuccess(rpcData);
    if (!mapped.ok) {
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Dữ liệu phản hồi từ máy chủ không đúng chuẩn.');
    }

    return createSuccessResponse(mapped.data, 200);
  } catch (_) {
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi không xác định.');
  }
}

async function main() {
  console.log('================================================================');
  console.log('🧪 RUNNING EXAM GET ATTEMPT QUESTIONS BFF TEST SUITE (PHASE 3E-B0)');
  console.log('================================================================\n');

  const VALID_STUDENT_ID = '11111111-1111-4111-8111-111111111111';
  const OTHER_STUDENT_ID = '22222222-2222-4222-8222-222222222222';
  const VALID_ATTEMPT_ID = '33333333-3333-4333-8333-333333333333';
  const VALID_ASSIGNMENT_ID = '44444444-4444-4444-8444-444444444444';
  const VALID_VERSION_ID = '55555555-5555-4555-8555-555555555555';
  const VALID_CLASS_ID = '66666666-6666-4666-8666-666666666666';

  function createMockDeps(overrides = {}) {
    const callerId = overrides.callerId !== undefined ? overrides.callerId : VALID_STUDENT_ID;
    const role = overrides.role !== undefined ? overrides.role : 'student';
    const isDisabled = overrides.isDisabled !== undefined ? overrides.isDisabled : false;
    const authError = overrides.authError || null;
    const isEnrolled = overrides.isEnrolled !== undefined ? overrides.isEnrolled : true;
    const attemptExists = overrides.attemptExists !== undefined ? overrides.attemptExists : true;
    const attemptOwnerId = overrides.attemptOwnerId || VALID_STUDENT_ID;
    const assignmentExists = overrides.assignmentExists !== undefined ? overrides.assignmentExists : true;
    const rpcResult = overrides.rpcResult !== undefined ? overrides.rpcResult : {
      attempt_id: VALID_ATTEMPT_ID,
      exam_version_id: VALID_VERSION_ID,
      status: 'draft',
      questions: [
        {
          id: 'a0000001-0000-4000-8000-000000000001',
          question_type: 'single_choice',
          prompt: '1 + 1 = ?',
          points: 1.0,
          options: [{ key: 'A', text: '2' }, { key: 'B', text: '3' }],
        },
      ],
    };
    const rpcError = overrides.rpcError || null;

    let recordedRpcCall = null;

    const callerAuthClient = {
      auth: {
        getUser: async () => {
          if (authError) return { data: { user: null }, error: authError };
          if (!callerId) return { data: { user: null }, error: null };
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
                  if (overrides.profileDbError) return { data: null, error: new Error('DB profile error') };
                  if (!val || val !== callerId || overrides.profileMissing) return { data: null, error: null };
                  return { data: { id: val, role, is_disabled: isDisabled }, error: null };
                },
              }),
            }),
          };
        }
        if (table === 'class_members') {
          return {
            select: () => ({
              eq: (_c1, val1) => ({
                eq: (_c2, val2) => ({
                  maybeSingle: async () => {
                    if (overrides.memberDbError) return { data: null, error: new Error('DB member error') };
                    if (!isEnrolled) return { data: null, error: null };
                    return { data: { class_id: val1, student_id: val2 }, error: null };
                  },
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected CORE table: ${table}`);
      },
    };

    const examClient = {
      from: (table) => {
        if (table === 'exam_attempts') {
          return {
            select: () => ({
              eq: (_c1, val1) => ({
                eq: (_c2, val2) => ({
                  maybeSingle: async () => {
                    if (overrides.attemptDbError) return { data: null, error: new Error('DB attempt error') };
                    if (!attemptExists || attemptOwnerId !== val2) return { data: null, error: null };
                    return { data: { id: val1, assignment_id: VALID_ASSIGNMENT_ID, student_id: val2 }, error: null };
                  },
                }),
              }),
            }),
          };
        }
        if (table === 'exam_assignments') {
          return {
            select: () => ({
              eq: (_col, val) => ({
                maybeSingle: async () => {
                  if (overrides.assignmentDbError) return { data: null, error: new Error('DB assignment error') };
                  if (!assignmentExists) return { data: null, error: null };
                  return { data: { id: val, class_id: VALID_CLASS_ID }, error: null };
                },
              }),
            }),
          };
        }
        throw new Error(`Unexpected EXAM table: ${table}`);
      },
      rpc: async (name, args) => {
        recordedRpcCall = { name, args };
        if (rpcError) return { data: null, error: rpcError };
        return { data: rpcResult, error: null };
      },
    };

    return {
      authDeps: { callerAuthClient, coreQueryClient },
      coreClient: coreQueryClient,
      examClient,
      getRecordedRpcCall: () => recordedRpcCall,
    };
  }

  function createRequest(options = {}) {
    const method = options.method || 'POST';
    const token = options.token !== undefined ? options.token : 'valid-token';
    const body = options.body !== undefined ? JSON.stringify(options.body) : JSON.stringify({ attempt_id: VALID_ATTEMPT_ID });

    const headers = new Headers();
    if (options.contentType !== null) {
      headers.set('content-type', options.contentType || 'application/json');
    }
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    if (method === 'GET' || method === 'OPTIONS') {
      return new Request('https://edge.supabase.local/exam-get-attempt-questions', { method, headers });
    }
    return new Request('https://edge.supabase.local/exam-get-attempt-questions', { method, headers, body });
  }

  // ==========================================
  // SECTION 1: AUTH & ROLE VALIDATION TESTS (1..10)
  // ==========================================
  await test('1. missing Authorization header returns 401 AUTH_REQUIRED', async () => {
    const req = new Request('https://edge.supabase.local/exam-get-attempt-questions', { method: 'POST', body: '{}' });
    const deps = createMockDeps();
    const res = await handleGetAttemptQuestionsRequestMirror(req, deps);
    const body = await res.json();
    assert.equal(res.status, 401);
    assert.equal(body.error_code, 'AUTH_REQUIRED');
  });

  await test('2. malformed Bearer token returns 401 AUTH_REQUIRED', async () => {
    const req = new Request('https://edge.supabase.local/exam-get-attempt-questions', {
      method: 'POST',
      headers: { Authorization: 'Basic xyz' },
      body: '{}',
    });
    const deps = createMockDeps();
    const res = await handleGetAttemptQuestionsRequestMirror(req, deps);
    const body = await res.json();
    assert.equal(res.status, 401);
    assert.equal(body.error_code, 'AUTH_REQUIRED');
  });

  await test('3. invalid JWT token returns 401 INVALID_TOKEN', async () => {
    const deps = createMockDeps({ authError: new Error('Invalid JWT') });
    const req = createRequest();
    const res = await handleGetAttemptQuestionsRequestMirror(req, deps);
    const body = await res.json();
    assert.equal(res.status, 401);
    assert.equal(body.error_code, 'INVALID_TOKEN');
  });

  await test('4. missing profile in CORE returns 403 FORBIDDEN_ROLE', async () => {
    const deps = createMockDeps({ profileMissing: true });
    const req = createRequest();
    const res = await handleGetAttemptQuestionsRequestMirror(req, deps);
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.error_code, 'FORBIDDEN_ROLE');
  });

  await test('5. teacher role returns 403 FORBIDDEN_ROLE', async () => {
    const deps = createMockDeps({ role: 'teacher' });
    const req = createRequest();
    const res = await handleGetAttemptQuestionsRequestMirror(req, deps);
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.error_code, 'FORBIDDEN_ROLE');
  });

  await test('6. admin role returns 403 FORBIDDEN_ROLE', async () => {
    const deps = createMockDeps({ role: 'admin' });
    const req = createRequest();
    const res = await handleGetAttemptQuestionsRequestMirror(req, deps);
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.error_code, 'FORBIDDEN_ROLE');
  });

  await test('7. parent role returns 403 FORBIDDEN_ROLE', async () => {
    const deps = createMockDeps({ role: 'parent' });
    const req = createRequest();
    const res = await handleGetAttemptQuestionsRequestMirror(req, deps);
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.error_code, 'FORBIDDEN_ROLE');
  });

  await test('8. disabled student account returns 403 ACCOUNT_DISABLED', async () => {
    const deps = createMockDeps({ isDisabled: true });
    const req = createRequest();
    const res = await handleGetAttemptQuestionsRequestMirror(req, deps);
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.error_code, 'ACCOUNT_DISABLED');
  });

  await test('9. callerId is derived strictly from validated token, not request body', async () => {
    const deps = createMockDeps({ callerId: VALID_STUDENT_ID });
    const req = createRequest({ body: { attempt_id: VALID_ATTEMPT_ID } });
    const res = await handleGetAttemptQuestionsRequestMirror(req, deps);
    assert.equal(res.status, 200);
    const rpcCall = deps.getRecordedRpcCall();
    assert.equal(rpcCall.args.p_caller_id, VALID_STUDENT_ID);
  });

  await test('10. DB error during profile lookup fails closed to 403/500', async () => {
    const deps = createMockDeps({ profileDbError: true });
    const req = createRequest();
    const res = await handleGetAttemptQuestionsRequestMirror(req, deps);
    assert.equal(res.status, 403);
  });

  // ==========================================
  // SECTION 2: HTTP PROTOCOL & METHOD TESTS (11..14)
  // ==========================================
  await test('11. OPTIONS preflight returns 200 OK with CORS headers', async () => {
    const req = createRequest({ method: 'OPTIONS' });
    const deps = createMockDeps();
    const res = await handleGetAttemptQuestionsRequestMirror(req, deps);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  });

  await test('12. GET method returns 405 METHOD_NOT_ALLOWED', async () => {
    const req = createRequest({ method: 'GET' });
    const deps = createMockDeps();
    const res = await handleGetAttemptQuestionsRequestMirror(req, deps);
    const body = await res.json();
    assert.equal(res.status, 405);
    assert.equal(body.error_code, 'METHOD_NOT_ALLOWED');
  });

  await test('13. PUT method returns 405 METHOD_NOT_ALLOWED', async () => {
    const req = createRequest({ method: 'PUT', body: { attempt_id: VALID_ATTEMPT_ID } });
    const deps = createMockDeps();
    const res = await handleGetAttemptQuestionsRequestMirror(req, deps);
    const body = await res.json();
    assert.equal(res.status, 405);
    assert.equal(body.error_code, 'METHOD_NOT_ALLOWED');
  });

  await test('14. DELETE method returns 405 METHOD_NOT_ALLOWED', async () => {
    const req = createRequest({ method: 'DELETE', body: { attempt_id: VALID_ATTEMPT_ID } });
    const deps = createMockDeps();
    const res = await handleGetAttemptQuestionsRequestMirror(req, deps);
    const body = await res.json();
    assert.equal(res.status, 405);
    assert.equal(body.error_code, 'METHOD_NOT_ALLOWED');
  });

  // ==========================================
  // SECTION 3: REQUEST BODY & VALIDATION TESTS (15..24)
  // ==========================================
  await test('15. malformed JSON body returns 400 INVALID_INPUT', async () => {
    const req = new Request('https://edge.supabase.local/exam-get-attempt-questions', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-token', 'content-type': 'application/json' },
      body: 'invalid-json{',
    });
    const deps = createMockDeps();
    const res = await handleGetAttemptQuestionsRequestMirror(req, deps);
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error_code, 'INVALID_INPUT');
  });

  await test('16. array body rejected with 400 INVALID_INPUT', async () => {
    const v = validateGetAttemptQuestionsPayload([1, 2, 3]);
    assert.equal(v.valid, false);
    assert.equal(v.errorCode, 'INVALID_INPUT');
  });

  await test('17. missing attempt_id returns 400 INVALID_INPUT', async () => {
    const v = validateGetAttemptQuestionsPayload({});
    assert.equal(v.valid, false);
    assert.equal(v.errorCode, 'INVALID_INPUT');
  });

  await test('18. empty string attempt_id returns 400 INVALID_INPUT', async () => {
    const v = validateGetAttemptQuestionsPayload({ attempt_id: '   ' });
    assert.equal(v.valid, false);
    assert.equal(v.errorCode, 'INVALID_INPUT');
  });

  await test('19. non-UUID attempt_id returns 400 INVALID_INPUT', async () => {
    const v = validateGetAttemptQuestionsPayload({ attempt_id: '123-not-a-uuid' });
    assert.equal(v.valid, false);
    assert.equal(v.errorCode, 'INVALID_INPUT');
  });

  await test('20. forbidden caller_id field returns 400 INVALID_REQUEST_FIELD', async () => {
    const v = validateGetAttemptQuestionsPayload({ attempt_id: VALID_ATTEMPT_ID, caller_id: VALID_STUDENT_ID });
    assert.equal(v.valid, false);
    assert.equal(v.errorCode, 'INVALID_REQUEST_FIELD');
  });

  await test('21. forbidden student_id field returns 400 INVALID_REQUEST_FIELD', async () => {
    const v = validateGetAttemptQuestionsPayload({ attempt_id: VALID_ATTEMPT_ID, student_id: VALID_STUDENT_ID });
    assert.equal(v.valid, false);
    assert.equal(v.errorCode, 'INVALID_REQUEST_FIELD');
  });

  await test('22. forbidden assignment_id field returns 400 INVALID_REQUEST_FIELD', async () => {
    const v = validateGetAttemptQuestionsPayload({ attempt_id: VALID_ATTEMPT_ID, assignment_id: VALID_ASSIGNMENT_ID });
    assert.equal(v.valid, false);
    assert.equal(v.errorCode, 'INVALID_REQUEST_FIELD');
  });

  await test('23. forbidden exam_version_id field returns 400 INVALID_REQUEST_FIELD', async () => {
    const v = validateGetAttemptQuestionsPayload({ attempt_id: VALID_ATTEMPT_ID, exam_version_id: VALID_VERSION_ID });
    assert.equal(v.valid, false);
    assert.equal(v.errorCode, 'INVALID_REQUEST_FIELD');
  });

  await test('24. unknown top-level field returns 400 INVALID_REQUEST_FIELD', async () => {
    const v = validateGetAttemptQuestionsPayload({ attempt_id: VALID_ATTEMPT_ID, hacker_param: 'exploit' });
    assert.equal(v.valid, false);
    assert.equal(v.errorCode, 'INVALID_REQUEST_FIELD');
  });

  // ==========================================
  // SECTION 4: ANTI-ORACLE PRECHECK & AUTHORIZATION (25..31)
  // ==========================================
  await test('25. nonexistent attempt in DB returns 404 ATTEMPT_NOT_FOUND', async () => {
    const deps = createMockDeps({ attemptExists: false });
    const req = createRequest();
    const res = await handleGetAttemptQuestionsRequestMirror(req, deps);
    const body = await res.json();
    assert.equal(res.status, 404);
    assert.equal(body.error_code, 'ATTEMPT_NOT_FOUND');
  });

  await test('26. attempt owned by another student returns 404 ATTEMPT_NOT_FOUND (Anti-Oracle)', async () => {
    const deps = createMockDeps({ attemptOwnerId: OTHER_STUDENT_ID });
    const req = createRequest();
    const res = await handleGetAttemptQuestionsRequestMirror(req, deps);
    const body = await res.json();
    assert.equal(res.status, 404);
    assert.equal(body.error_code, 'ATTEMPT_NOT_FOUND');
  });

  await test('27. DB error during attempt lookup returns 500 INTERNAL_ERROR', async () => {
    const deps = createMockDeps({ attemptDbError: true });
    const req = createRequest();
    const res = await handleGetAttemptQuestionsRequestMirror(req, deps);
    const body = await res.json();
    assert.equal(res.status, 500);
    assert.equal(body.error_code, 'INTERNAL_ERROR');
  });

  await test('28. assignment not found returns 404 ERR_ASSIGNMENT_NOT_FOUND', async () => {
    const deps = createMockDeps({ assignmentExists: false });
    const req = createRequest();
    const res = await handleGetAttemptQuestionsRequestMirror(req, deps);
    const body = await res.json();
    assert.equal(res.status, 404);
    assert.equal(body.error_code, 'ERR_ASSIGNMENT_NOT_FOUND');
  });

  await test('29. DB error during assignment lookup returns 500 INTERNAL_ERROR', async () => {
    const deps = createMockDeps({ assignmentDbError: true });
    const req = createRequest();
    const res = await handleGetAttemptQuestionsRequestMirror(req, deps);
    const body = await res.json();
    assert.equal(res.status, 500);
    assert.equal(body.error_code, 'INTERNAL_ERROR');
  });

  await test('30. student not enrolled in class returns 403 CLASS_ACCESS_DENIED', async () => {
    const deps = createMockDeps({ isEnrolled: false });
    const req = createRequest();
    const res = await handleGetAttemptQuestionsRequestMirror(req, deps);
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.error_code, 'CLASS_ACCESS_DENIED');
  });

  await test('31. DB error during membership check returns 500 INTERNAL_ERROR', async () => {
    const deps = createMockDeps({ memberDbError: true });
    const req = createRequest();
    const res = await handleGetAttemptQuestionsRequestMirror(req, deps);
    const body = await res.json();
    assert.equal(res.status, 500);
    assert.equal(body.error_code, 'INTERNAL_ERROR');
  });

  // ==========================================
  // SECTION 5: RPC INVOCATION & CONTRACT (32..34)
  // ==========================================
  await test('32. exact RPC name rpc_exam_get_attempt_questions is called', async () => {
    const deps = createMockDeps();
    const req = createRequest();
    await handleGetAttemptQuestionsRequestMirror(req, deps);
    const rpcCall = deps.getRecordedRpcCall();
    assert.equal(rpcCall.name, 'rpc_exam_get_attempt_questions');
  });

  await test('33. exact 2 parameters passed to RPC (p_caller_id, p_attempt_id)', async () => {
    const deps = createMockDeps();
    const req = createRequest();
    await handleGetAttemptQuestionsRequestMirror(req, deps);
    const rpcCall = deps.getRecordedRpcCall();
    const argsKeys = Object.keys(rpcCall.args).sort();
    assert.deepEqual(argsKeys, ['p_attempt_id', 'p_caller_id']);
  });

  await test('34. p_caller_id strictly equals verified callerId from CORE token', async () => {
    const deps = createMockDeps({ callerId: VALID_STUDENT_ID });
    const req = createRequest();
    await handleGetAttemptQuestionsRequestMirror(req, deps);
    const rpcCall = deps.getRecordedRpcCall();
    assert.equal(rpcCall.args.p_caller_id, VALID_STUDENT_ID);
    assert.equal(rpcCall.args.p_attempt_id, VALID_ATTEMPT_ID);
  });

  // ==========================================
  // SECTION 6: ERROR NORMALIZATION TESTS (35..44)
  // ==========================================
  await test('35. normalizeGetAttemptQuestionsRpcError: ERR_ATTEMPT_NOT_FOUND -> 404 ATTEMPT_NOT_FOUND', async () => {
    const res = normalizeGetAttemptQuestionsRpcError('ERR_ATTEMPT_NOT_FOUND: Attempt not found');
    assert.equal(res.status, 404);
    assert.equal(res.errorCode, 'ATTEMPT_NOT_FOUND');
  });

  await test('36. normalizeGetAttemptQuestionsRpcError: ERR_STUDENT_IDENTITY_MISMATCH -> 404 ATTEMPT_NOT_FOUND', async () => {
    const res = normalizeGetAttemptQuestionsRpcError('ERR_STUDENT_IDENTITY_MISMATCH: Caller mismatch');
    assert.equal(res.status, 404);
    assert.equal(res.errorCode, 'ATTEMPT_NOT_FOUND');
  });

  await test('37. normalizeGetAttemptQuestionsRpcError: ERR_ATTEMPT_FINALIZED -> 409 ERR_ATTEMPT_ALREADY_FINALIZED', async () => {
    const res = normalizeGetAttemptQuestionsRpcError('ERR_ATTEMPT_FINALIZED: Attempt already submitted');
    assert.equal(res.status, 409);
    assert.equal(res.errorCode, 'ERR_ATTEMPT_ALREADY_FINALIZED');
  });

  await test('38. normalizeGetAttemptQuestionsRpcError: ERR_ATTEMPT_NOT_DRAFT -> 409 ERR_ATTEMPT_ALREADY_FINALIZED', async () => {
    const res = normalizeGetAttemptQuestionsRpcError('ERR_ATTEMPT_NOT_DRAFT: Attempt status is not draft');
    assert.equal(res.status, 409);
    assert.equal(res.errorCode, 'ERR_ATTEMPT_ALREADY_FINALIZED');
  });

  await test('39. normalizeGetAttemptQuestionsRpcError: ERR_ATTEMPT_EXPIRED -> 409 ERR_ATTEMPT_EXPIRED', async () => {
    const res = normalizeGetAttemptQuestionsRpcError('ERR_ATTEMPT_EXPIRED: Time limit exceeded');
    assert.equal(res.status, 409);
    assert.equal(res.errorCode, 'ERR_ATTEMPT_EXPIRED');
  });

  await test('40. normalizeGetAttemptQuestionsRpcError: ERR_ATTEMPT_SNAPSHOT_INVALID -> 500 INTERNAL_ERROR', async () => {
    const res = normalizeGetAttemptQuestionsRpcError('ERR_ATTEMPT_SNAPSHOT_INVALID: Snapshot corruption');
    assert.equal(res.status, 500);
    assert.equal(res.errorCode, 'INTERNAL_ERROR');
  });

  await test('41. normalizeGetAttemptQuestionsRpcError: ERR_INVALID_OPTION_SCHEMA -> 500 INTERNAL_ERROR', async () => {
    const res = normalizeGetAttemptQuestionsRpcError('ERR_INVALID_OPTION_SCHEMA: Option schema malformed');
    assert.equal(res.status, 500);
    assert.equal(res.errorCode, 'INTERNAL_ERROR');
  });

  await test('42. normalizeGetAttemptQuestionsRpcError: ERR_OPTION_SNAPSHOT_INVALID -> 500 INTERNAL_ERROR', async () => {
    const res = normalizeGetAttemptQuestionsRpcError('ERR_OPTION_SNAPSHOT_INVALID: Option permutation mismatch');
    assert.equal(res.status, 500);
    assert.equal(res.errorCode, 'INTERNAL_ERROR');
  });

  await test('43. normalizeGetAttemptQuestionsRpcError: ERR_QUESTION_SNAPSHOT_INVALID -> 500 INTERNAL_ERROR', async () => {
    const res = normalizeGetAttemptQuestionsRpcError('ERR_QUESTION_SNAPSHOT_INVALID: Unknown question type');
    assert.equal(res.status, 500);
    assert.equal(res.errorCode, 'INTERNAL_ERROR');
  });

  await test('44. unknown SQL/DB error sanitized to 500 INTERNAL_ERROR with zero SQL leak', async () => {
    const res = normalizeGetAttemptQuestionsRpcError(new Error('FATAL: relation "secret_table" does not exist at character 42'));
    assert.equal(res.status, 500);
    assert.equal(res.errorCode, 'INTERNAL_ERROR');
    assert.equal(res.message.includes('secret_table'), false);
    assert.equal(res.message.includes('FATAL'), false);
  });

  // ==========================================
  // SECTION 7: STRICT MAPPER & RESPONSE PROJECTION (45..56)
  // ==========================================
  await test('45. non-draft status in RPC result rejected by mapper', async () => {
    const m = mapGetAttemptQuestionsSuccess({
      attempt_id: VALID_ATTEMPT_ID,
      exam_version_id: VALID_VERSION_ID,
      status: 'submitted',
      questions: [],
    });
    assert.equal(m.ok, false);
  });

  await test('46. missing attempt_id in RPC result rejected by mapper', async () => {
    const m = mapGetAttemptQuestionsSuccess({
      exam_version_id: VALID_VERSION_ID,
      status: 'draft',
      questions: [],
    });
    assert.equal(m.ok, false);
  });

  await test('47. missing exam_version_id in RPC result rejected by mapper', async () => {
    const m = mapGetAttemptQuestionsSuccess({
      attempt_id: VALID_ATTEMPT_ID,
      status: 'draft',
      questions: [],
    });
    assert.equal(m.ok, false);
  });

  await test('48. missing questions array in RPC result rejected by mapper', async () => {
    const m = mapGetAttemptQuestionsSuccess({
      attempt_id: VALID_ATTEMPT_ID,
      exam_version_id: VALID_VERSION_ID,
      status: 'draft',
      questions: 'not-an-array',
    });
    assert.equal(m.ok, false);
  });

  await test('49. invalid question_type in question rejected by mapper', async () => {
    const m = mapGetAttemptQuestionsSuccess({
      attempt_id: VALID_ATTEMPT_ID,
      exam_version_id: VALID_VERSION_ID,
      status: 'draft',
      questions: [
        {
          id: 'a0000001-0000-4000-8000-000000000001',
          question_type: 'unknown_matrix_type',
          prompt: 'P',
          points: 1,
          options: [],
        },
      ],
    });
    assert.equal(m.ok, false);
  });

  await test('50. non-positive or non-finite points in question rejected by mapper', async () => {
    const m1 = mapGetAttemptQuestionsSuccess({
      attempt_id: VALID_ATTEMPT_ID,
      exam_version_id: VALID_VERSION_ID,
      status: 'draft',
      questions: [
        {
          id: 'a0000001-0000-4000-8000-000000000001',
          question_type: 'single_choice',
          prompt: 'P',
          points: 0,
          options: [],
        },
      ],
    });
    assert.equal(m1.ok, false);

    const m2 = mapGetAttemptQuestionsSuccess({
      attempt_id: VALID_ATTEMPT_ID,
      exam_version_id: VALID_VERSION_ID,
      status: 'draft',
      questions: [
        {
          id: 'a0000001-0000-4000-8000-000000000001',
          question_type: 'single_choice',
          prompt: 'P',
          points: -5,
          options: [],
        },
      ],
    });
    assert.equal(m2.ok, false);
  });

  await test('51. empty option key rejected by mapper', async () => {
    const m = mapGetAttemptQuestionsSuccess({
      attempt_id: VALID_ATTEMPT_ID,
      exam_version_id: VALID_VERSION_ID,
      status: 'draft',
      questions: [
        {
          id: 'a0000001-0000-4000-8000-000000000001',
          question_type: 'single_choice',
          prompt: 'P',
          points: 1,
          options: [{ key: '', text: 'Opt' }],
        },
      ],
    });
    assert.equal(m.ok, false);
  });

  await test('52. extra internal fields in RPC stripped cleanly from final data projection', async () => {
    const m = mapGetAttemptQuestionsSuccess({
      attempt_id: VALID_ATTEMPT_ID,
      exam_version_id: VALID_VERSION_ID,
      status: 'draft',
      extra_secret_col: 'secret',
      questions: [
        {
          id: 'a0000001-0000-4000-8000-000000000001',
          question_type: 'single_choice',
          prompt: '1+1=?',
          points: 1,
          correct_answer: ['A'], // Extra leaked field from bad DB
          options: [{ key: 'A', text: '2', is_correct: true }],
        },
      ],
    });

    assert.equal(m.ok, true);
    assert.equal('extra_secret_col' in m.data, false);
    assert.equal('correct_answer' in m.data.questions[0], false);
    assert.equal('is_correct' in m.data.questions[0].options[0], false);
    assert.deepEqual(Object.keys(m.data).sort(), ['attempt_id', 'exam_version_id', 'questions', 'status'].sort());
    assert.deepEqual(Object.keys(m.data.questions[0]).sort(), ['id', 'options', 'points', 'prompt', 'question_type'].sort());
    assert.deepEqual(Object.keys(m.data.questions[0].options[0]).sort(), ['key', 'text'].sort());
  });

  await test('53. successful delivery preserves all 7 question types', async () => {
    const valid7Questions = [
      { id: 'a0000001-0000-4000-8000-000000000001', question_type: 'single_choice', prompt: 'P1', points: 1, options: [{ key: 'A', text: '1' }] },
      { id: 'a0000002-0000-4000-8000-000000000002', question_type: 'multiple_choice', prompt: 'P2', points: 1, options: [{ key: 'A', text: '1' }] },
      { id: 'a0000003-0000-4000-8000-000000000003', question_type: 'fill_blank', prompt: 'P3', points: 1, options: [] },
      { id: 'a0000004-0000-4000-8000-000000000004', question_type: 'short_answer', prompt: 'P4', points: 1, options: [] },
      { id: 'a0000005-0000-4000-8000-000000000005', question_type: 'essay', prompt: 'P5', points: 1, options: [] },
      { id: 'a0000006-0000-4000-8000-000000000006', question_type: 'image_upload', prompt: 'P6', points: 1, options: [] },
      { id: 'a0000007-0000-4000-8000-000000000007', question_type: 'file_upload', prompt: 'P7', points: 1, options: [] },
    ];

    const m = mapGetAttemptQuestionsSuccess({
      attempt_id: VALID_ATTEMPT_ID,
      exam_version_id: VALID_VERSION_ID,
      status: 'draft',
      questions: valid7Questions,
    });

    assert.equal(m.ok, true);
    assert.equal(m.data.questions.length, 7);
  });

  await test('54. successful delivery preserves exact option permutation', async () => {
    const permutedOptions = [
      { key: 'C', text: 'Three' },
      { key: 'A', text: 'One' },
      { key: 'B', text: 'Two' },
    ];

    const m = mapGetAttemptQuestionsSuccess({
      attempt_id: VALID_ATTEMPT_ID,
      exam_version_id: VALID_VERSION_ID,
      status: 'draft',
      questions: [
        {
          id: 'a0000001-0000-4000-8000-000000000001',
          question_type: 'single_choice',
          prompt: 'P',
          points: 1,
          options: permutedOptions,
        },
      ],
    });

    assert.equal(m.ok, true);
    assert.deepEqual(m.data.questions[0].options, permutedOptions);
  });

  await test('55. exact HTTP success envelope returned', async () => {
    const deps = createMockDeps();
    const req = createRequest();
    const res = await handleGetAttemptQuestionsRequestMirror(req, deps);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(typeof body.data, 'object');
    assert.equal(body.data.status, 'draft');
    assert.equal(Array.isArray(body.data.questions), true);
  });

  await test('56. zero answer key leakage in complete handler response', async () => {
    const deps = createMockDeps();
    const req = createRequest();
    const res = await handleGetAttemptQuestionsRequestMirror(req, deps);
    const text = await res.text();

    assert.equal(text.includes('correct_answer'), false);
    assert.equal(text.includes('accepted_answers'), false);
    assert.equal(text.includes('grading_config'), false);
    assert.equal(text.includes('question_number'), false);
  });

  // --- 57. Mapper rejects legacy 'type' field ---
  await test('57. mapper rejects question with only legacy type field', async () => {
    const m = mapGetAttemptQuestionsSuccess({
      attempt_id: VALID_ATTEMPT_ID,
      exam_version_id: VALID_VERSION_ID,
      status: 'draft',
      questions: [
        {
          id: 'a0000001-0000-4000-8000-000000000001',
          type: 'single_choice', // legacy field, missing question_type
          prompt: 'P',
          points: 1,
          options: [],
        },
      ],
    });
    assert.equal(m.ok, false);
  });

  // --- 58. Mapper accepts question_type and outputs zero legacy 'type' field ---
  await test('58. mapper accepts question_type and guarantees zero legacy type field in projected data', async () => {
    const m = mapGetAttemptQuestionsSuccess({
      attempt_id: VALID_ATTEMPT_ID,
      exam_version_id: VALID_VERSION_ID,
      status: 'draft',
      questions: [
        {
          id: 'a0000001-0000-4000-8000-000000000001',
          question_type: 'single_choice',
          type: 'legacy_alias_to_strip',
          prompt: 'P',
          points: 1,
          options: [{ key: 'A', text: '1', extra: 'strip_me' }],
        },
      ],
    });
    assert.equal(m.ok, true);
    assert.equal(m.data.questions[0].question_type, 'single_choice');
    assert.equal('type' in m.data.questions[0], false);
    assert.equal('extra' in m.data.questions[0].options[0], false);
    assert.deepEqual(Object.keys(m.data.questions[0]).sort(), ['id', 'options', 'points', 'prompt', 'question_type'].sort());
  });

  // --- 59. Mapper rejects non-string prompt ---
  await test('59. mapper rejects non-string prompt in question', async () => {
    const m = mapGetAttemptQuestionsSuccess({
      attempt_id: VALID_ATTEMPT_ID,
      exam_version_id: VALID_VERSION_ID,
      status: 'draft',
      questions: [
        {
          id: 'a0000001-0000-4000-8000-000000000001',
          question_type: 'single_choice',
          prompt: 12345, // non-string prompt
          points: 1,
          options: [],
        },
      ],
    });
    assert.equal(m.ok, false);
  });

  // --- 60. Mapper rejects non-string option text ---
  await test('60. mapper rejects non-string option text in option object', async () => {
    const m = mapGetAttemptQuestionsSuccess({
      attempt_id: VALID_ATTEMPT_ID,
      exam_version_id: VALID_VERSION_ID,
      status: 'draft',
      questions: [
        {
          id: 'a0000001-0000-4000-8000-000000000001',
          question_type: 'single_choice',
          prompt: 'P',
          points: 1,
          options: [{ key: 'A', text: 999 }], // non-string text
        },
      ],
    });
    assert.equal(m.ok, false);
  });

  // --- 61. Mapper rejects non-object option item ---
  await test('61. mapper rejects non-object option item in options array', async () => {
    const m = mapGetAttemptQuestionsSuccess({
      attempt_id: VALID_ATTEMPT_ID,
      exam_version_id: VALID_VERSION_ID,
      status: 'draft',
      questions: [
        {
          id: 'a0000001-0000-4000-8000-000000000001',
          question_type: 'single_choice',
          prompt: 'P',
          points: 1,
          options: ['string_option'],
        },
      ],
    });
    assert.equal(m.ok, false);
  });

  // --- 62. Mapper rejects non-UUID question ID ---
  await test('62. mapper rejects non-UUID question ID', async () => {
    const m = mapGetAttemptQuestionsSuccess({
      attempt_id: VALID_ATTEMPT_ID,
      exam_version_id: VALID_VERSION_ID,
      status: 'draft',
      questions: [
        {
          id: 'invalid-uuid-format',
          question_type: 'single_choice',
          prompt: 'P',
          points: 1,
          options: [],
        },
      ],
    });
    assert.equal(m.ok, false);
  });

  // --- 63. Strict projection schema verification ---
  await test('63. strict projection preserves only approved 4 root fields, 5 question fields, 2 option fields', async () => {
    const m = mapGetAttemptQuestionsSuccess({
      attempt_id: VALID_ATTEMPT_ID,
      exam_version_id: VALID_VERSION_ID,
      status: 'draft',
      questions: [
        {
          id: 'a0000001-0000-4000-8000-000000000001',
          question_type: 'single_choice',
          prompt: 'What is 1+1?',
          points: 2.5,
          options: [{ key: 'A', text: '2' }, { key: 'B', text: '3' }],
        },
      ],
    });

    assert.equal(m.ok, true);
    assert.deepEqual(Object.keys(m.data).sort(), ['attempt_id', 'exam_version_id', 'questions', 'status'].sort());
    assert.deepEqual(Object.keys(m.data.questions[0]).sort(), ['id', 'options', 'points', 'prompt', 'question_type'].sort());
    assert.deepEqual(Object.keys(m.data.questions[0].options[0]).sort(), ['key', 'text'].sort());
  });

  // --- 64. Full end-to-end BFF response has zero legacy 'type' field ---
  await test('64. full end-to-end BFF response contains question_type and NO legacy type field', async () => {
    const deps = createMockDeps();
    const req = createRequest();
    const res = await handleGetAttemptQuestionsRequestMirror(req, deps);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    for (const q of body.data.questions) {
      assert.equal(typeof q.question_type, 'string');
      assert.equal('type' in q, false);
    }
  });

  // --- 65. BFF payload validator rejects non-UUID or boolean attempt_id ---
  await test('65. BFF payload validator rejects boolean/numeric attempt_id', async () => {
    const v1 = validateGetAttemptQuestionsPayload({ attempt_id: true });
    assert.equal(v1.valid, false);
    assert.equal(v1.errorCode, 'INVALID_INPUT');

    const v2 = validateGetAttemptQuestionsPayload({ attempt_id: 12345 });
    assert.equal(v2.valid, false);
    assert.equal(v2.errorCode, 'INVALID_INPUT');
  });

  console.log('\n================================================================');
  console.log(`BFF TEST RUN COMPLETE: ${passedTests} PASSED, ${failedTests} FAILED (TOTAL: ${totalTests})`);
  console.log('================================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal BFF test error:', err);
  process.exit(1);
});
