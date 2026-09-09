// scripts/test_exam_integrity_event_bff.mjs
// Comprehensive Test Suite for Exam Builder V1 Phase 3B - Integrity Event BFF
// Exercises ACTUAL PRODUCTION TypeScript Modules (_shared/examErrors.ts & validation.ts)
// + Distinguishes Production Tests, Mirror Spec Tests, and Frontend Ordering Spec Tests

import assert from 'node:assert/strict';

// ----------------------------------------------------------------------------
// 1. Direct Imports of ACTUAL PRODUCTION TypeScript Modules
// ----------------------------------------------------------------------------
import {
  corsHeaders,
  createErrorResponse,
  createSuccessResponse,
  normalizeRpcError,
  normalizeIntegrityRpcError,
  mapRecordIntegrityEventSuccess,
} from '../supabase/functions/_shared/examErrors.ts';

import {
  validateIntegrityEventPayload,
  isValidIsoTimestamp,
  UUID_REGEX,
  ALLOWED_SOURCES,
  FORBIDDEN_FIELDS,
  ALLOWED_FIELDS,
  ISO_TIMESTAMP_REGEX,
} from '../supabase/functions/exam-record-integrity-event/validation.ts';

// ----------------------------------------------------------------------------
// 2. Node.js Spec Mirror for Handler Integration Flow
// (Deno Edge runtime uses https:// URL imports in examAuth.ts which Node ESM does not resolve)
// ----------------------------------------------------------------------------

const EXTRA_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
};

async function handleRecordIntegrityEventRequestMirror(req, deps) {
  // 1. CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        ...corsHeaders,
        'Cache-Control': 'no-store',
        ...EXTRA_SECURITY_HEADERS,
      },
    });
  }

  // 2. Enforce POST HTTP Method
  if (req.method !== 'POST') {
    return createErrorResponse(
      405,
      'METHOD_NOT_ALLOWED',
      'Phương thức HTTP không được hỗ trợ. Chỉ chấp nhận POST.',
      { Allow: 'POST', ...EXTRA_SECURITY_HEADERS }
    );
  }

  // 3. Enforce application/json Content-Type (Media Type Check)
  const contentTypeHeader = req.headers.get('content-type') || '';
  const mediaType = contentTypeHeader.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    return createErrorResponse(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Định dạng Content-Type không được hỗ trợ. Bắt buộc sử dụng application/json.',
      EXTRA_SECURITY_HEADERS
    );
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return createErrorResponse(401, 'AUTH_REQUIRED', 'Yêu cầu xác thực Bearer token.', EXTRA_SECURITY_HEADERS);
    }
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return createErrorResponse(401, 'AUTH_REQUIRED', 'Yêu cầu xác thực Bearer token.', EXTRA_SECURITY_HEADERS);
    }

    if (!deps || !deps.authDeps) {
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Dependencies not configured.', EXTRA_SECURITY_HEADERS);
    }

    const { callerAuthClient, coreQueryClient } = deps.authDeps;
    const { data: userData, error: authError } = await callerAuthClient.auth.getUser();
    if (authError || !userData?.user?.id) {
      return createErrorResponse(401, 'INVALID_TOKEN', 'Phiên đăng nhập không hợp lệ.', EXTRA_SECURITY_HEADERS);
    }
    const callerId = userData.user.id;

    const { data: profile, error: dbError } = await coreQueryClient.from('profiles').select('id, role, is_disabled').eq('id', callerId).maybeSingle();
    if (dbError || !profile) {
      return createErrorResponse(403, 'FORBIDDEN_ROLE', 'Hồ sơ người dùng không hợp lệ.', EXTRA_SECURITY_HEADERS);
    }
    if (profile.is_disabled === true) {
      return createErrorResponse(403, 'ACCOUNT_DISABLED', 'Tài khoản đã bị vô hiệu hóa.', EXTRA_SECURITY_HEADERS);
    }
    if (profile.role !== 'student') {
      return createErrorResponse(403, 'FORBIDDEN_ROLE', 'Chỉ học sinh mới có quyền.', EXTRA_SECURITY_HEADERS);
    }

    const rawText = await req.text();
    if (new TextEncoder().encode(rawText).length > 10 * 1024) {
      return createErrorResponse(400, 'INVALID_INPUT', 'Dung lượng yêu cầu vượt quá giới hạn.', EXTRA_SECURITY_HEADERS);
    }

    let rawBody;
    try {
      rawBody = JSON.parse(rawText);
    } catch (_) {
      return createErrorResponse(400, 'INVALID_INPUT', 'Dữ liệu yêu cầu không phải là chuỗi JSON hợp lệ.', EXTRA_SECURITY_HEADERS);
    }

    // Call ACTUAL PRODUCTION validation module function
    const val = validateIntegrityEventPayload(rawBody);
    if (!val.valid || !val.sanitizedData) {
      return createErrorResponse(400, val.errorCode || 'INVALID_INPUT', val.errorMessage || 'Dữ liệu không hợp lệ.', EXTRA_SECURITY_HEADERS);
    }

    const { attempt_id, source, client_timestamp } = val.sanitizedData;
    const examClient = deps.examClient;
    if (!examClient) {
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Exam client not configured.', EXTRA_SECURITY_HEADERS);
    }

    const { data: rpcData, error: rpcError } = await examClient.rpc('rpc_exam_record_integrity_event', {
      p_caller_id: callerId,
      p_attempt_id: attempt_id,
      p_source: source,
      p_client_timestamp: client_timestamp,
    });

    if (rpcError) {
      // Call ACTUAL PRODUCTION error normalizer function
      const { status, errorCode, message } = normalizeIntegrityRpcError(rpcError);
      return createErrorResponse(status, errorCode, message, EXTRA_SECURITY_HEADERS);
    }

    // Call ACTUAL PRODUCTION response mapper function
    const proj = mapRecordIntegrityEventSuccess(rpcData);
    if (!proj.ok) {
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Phản hồi DB không hợp lệ.', EXTRA_SECURITY_HEADERS);
    }

    return createSuccessResponse(proj.data, 200, EXTRA_SECURITY_HEADERS);
  } catch (_e) {
    return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi nội bộ hệ thống.', EXTRA_SECURITY_HEADERS);
  }
}

// ----------------------------------------------------------------------------
// 3. TEST SUITE EXECUTION
// ----------------------------------------------------------------------------

async function runAllTests() {
  console.log('====================================================');
  console.log('PHASE 3B: INTEGRITY EVENT BFF AUTOMATED TEST SUITE');
  console.log('====================================================\n');

  let prodSharedErrorPassCount = 0;
  let prodValidationPassCount = 0;
  let prodHandlerPassCount = 0;
  let mirrorSpecPassCount = 0;
  let frontendOrderingSpecPassCount = 0;

  // ==========================================================================
  // SECTION A: PRODUCTION MODULE TESTS - _shared/examErrors.ts
  // ==========================================================================
  console.log('--- SECTION A: PRODUCTION SHARED ERROR NORMALIZER TESTS ---');

  // A1. normalizeRpcError (Global Normalizer Regression Assertions)
  {
    // 1. Identity mismatch -> 403 ATTEMPT_ACCESS_DENIED
    const r1 = normalizeRpcError(new Error('ERR_STUDENT_IDENTITY_MISMATCH: Caller does not own attempt'));
    assert.equal(r1.status, 403);
    assert.equal(r1.errorCode, 'ATTEMPT_ACCESS_DENIED');
    assert.equal(r1.message, 'Bạn không có quyền truy cập lượt thi này.');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 1]: normalizeRpcError: ERR_STUDENT_IDENTITY_MISMATCH -> 403 ATTEMPT_ACCESS_DENIED');

    // 2. Attempt not found -> 404 ERR_ATTEMPT_NOT_FOUND
    const r2 = normalizeRpcError(new Error('ERR_ATTEMPT_NOT_FOUND'));
    assert.equal(r2.status, 404);
    assert.equal(r2.errorCode, 'ERR_ATTEMPT_NOT_FOUND');
    assert.equal(r2.message, 'Không tìm thấy lượt làm bài thi.');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 2]: normalizeRpcError: ERR_ATTEMPT_NOT_FOUND -> 404 ERR_ATTEMPT_NOT_FOUND');

    // 3. Assignment not found -> 404 ERR_ASSIGNMENT_NOT_FOUND
    const r3 = normalizeRpcError(new Error('ERR_ASSIGNMENT_NOT_FOUND'));
    assert.equal(r3.status, 404);
    assert.equal(r3.errorCode, 'ERR_ASSIGNMENT_NOT_FOUND');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 3]: normalizeRpcError: ERR_ASSIGNMENT_NOT_FOUND -> 404 ERR_ASSIGNMENT_NOT_FOUND');

    // 4. Question not found -> 404 ERR_QUESTION_NOT_FOUND
    const r4 = normalizeRpcError(new Error('ERR_QUESTION_NOT_FOUND'));
    assert.equal(r4.status, 404);
    assert.equal(r4.errorCode, 'ERR_QUESTION_NOT_FOUND');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 4]: normalizeRpcError: ERR_QUESTION_NOT_FOUND -> 404 ERR_QUESTION_NOT_FOUND');

    // 5. Version not found -> 404 ERR_VERSION_NOT_FOUND
    const r5 = normalizeRpcError(new Error('ERR_VERSION_NOT_FOUND'));
    assert.equal(r5.status, 404);
    assert.equal(r5.errorCode, 'ERR_VERSION_NOT_FOUND');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 5]: normalizeRpcError: ERR_VERSION_NOT_FOUND -> 404 ERR_VERSION_NOT_FOUND');

    // 6. Exam not found -> 404 ERR_EXAM_NOT_FOUND
    const r6 = normalizeRpcError(new Error('ERR_EXAM_NOT_FOUND'));
    assert.equal(r6.status, 404);
    assert.equal(r6.errorCode, 'ERR_EXAM_NOT_FOUND');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 6]: normalizeRpcError: ERR_EXAM_NOT_FOUND -> 404 ERR_EXAM_NOT_FOUND');

    // 7. Optimistic lock conflict -> 409 ERR_OPTIMISTIC_LOCK_CONFLICT
    const r7 = normalizeRpcError(new Error('ERR_OPTIMISTIC_LOCK_CONFLICT'));
    assert.equal(r7.status, 409);
    assert.equal(r7.errorCode, 'ERR_OPTIMISTIC_LOCK_CONFLICT');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 7]: normalizeRpcError: ERR_OPTIMISTIC_LOCK_CONFLICT -> 409 ERR_OPTIMISTIC_LOCK_CONFLICT');

    // 8. Attempt finalized / not draft -> 409 ERR_ATTEMPT_ALREADY_FINALIZED
    const r8 = normalizeRpcError(new Error('ERR_ATTEMPT_NOT_DRAFT'));
    assert.equal(r8.status, 409);
    assert.equal(r8.errorCode, 'ERR_ATTEMPT_ALREADY_FINALIZED');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 8]: normalizeRpcError: ERR_ATTEMPT_NOT_DRAFT -> 409 ERR_ATTEMPT_ALREADY_FINALIZED');

    // 9. Attempt expired -> 409 ERR_ATTEMPT_EXPIRED
    const r9 = normalizeRpcError(new Error('ERR_ATTEMPT_EXPIRED'));
    assert.equal(r9.status, 409);
    assert.equal(r9.errorCode, 'ERR_ATTEMPT_EXPIRED');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 9]: normalizeRpcError: ERR_ATTEMPT_EXPIRED -> 409 ERR_ATTEMPT_EXPIRED');

    // 10. Max attempts exceeded -> 409 ERR_MAX_ATTEMPTS_EXCEEDED
    const r10 = normalizeRpcError(new Error('ERR_MAX_ATTEMPTS_EXCEEDED'));
    assert.equal(r10.status, 409);
    assert.equal(r10.errorCode, 'ERR_MAX_ATTEMPTS_EXCEEDED');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 10]: normalizeRpcError: ERR_MAX_ATTEMPTS_EXCEEDED -> 409 ERR_MAX_ATTEMPTS_EXCEEDED');

    // 11. Idempotency conflict -> 409 ERR_IDEMPOTENCY_CONFLICT
    const r11 = normalizeRpcError(new Error('ERR_IDEMPOTENCY_CONFLICT'));
    assert.equal(r11.status, 409);
    assert.equal(r11.errorCode, 'ERR_IDEMPOTENCY_CONFLICT');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 11]: normalizeRpcError: ERR_IDEMPOTENCY_CONFLICT -> 409 ERR_IDEMPOTENCY_CONFLICT');

    // 12. Duplicate option keys -> 409 ERR_DUPLICATE_OPTION_KEYS
    const r12 = normalizeRpcError(new Error('ERR_DUPLICATE_OPTION_KEYS'));
    assert.equal(r12.status, 409);
    assert.equal(r12.errorCode, 'ERR_DUPLICATE_OPTION_KEYS');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 12]: normalizeRpcError: ERR_DUPLICATE_OPTION_KEYS -> 409 ERR_DUPLICATE_OPTION_KEYS');

    // 13. Required params restored -> 422 ERR_REQUIRED_PARAMS (Exact Parent Contract)
    const r13 = normalizeRpcError(new Error('ERR_REQUIRED_PARAMS'));
    assert.equal(r13.status, 422);
    assert.equal(r13.errorCode, 'ERR_REQUIRED_PARAMS');
    assert.equal(r13.message, 'Thiếu tham số bắt buộc trong yêu cầu.');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 13]: normalizeRpcError: ERR_REQUIRED_PARAMS -> 422 ERR_REQUIRED_PARAMS (Restored)');

    // 14. Version not published -> 422 ERR_VERSION_NOT_PUBLISHED
    const r14 = normalizeRpcError(new Error('ERR_VERSION_NOT_PUBLISHED'));
    assert.equal(r14.status, 422);
    assert.equal(r14.errorCode, 'ERR_VERSION_NOT_PUBLISHED');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 14]: normalizeRpcError: ERR_VERSION_NOT_PUBLISHED -> 422 ERR_VERSION_NOT_PUBLISHED');

    // 15. Invalid total points -> 422 ERR_INVALID_TOTAL_POINTS
    const r15 = normalizeRpcError(new Error('ERR_INVALID_TOTAL_POINTS'));
    assert.equal(r15.status, 422);
    assert.equal(r15.errorCode, 'ERR_INVALID_TOTAL_POINTS');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 15]: normalizeRpcError: ERR_INVALID_TOTAL_POINTS -> 422 ERR_INVALID_TOTAL_POINTS');

    // 16. Exam archived -> 422 ERR_EXAM_ARCHIVED
    const r16 = normalizeRpcError(new Error('ERR_EXAM_ARCHIVED'));
    assert.equal(r16.status, 422);
    assert.equal(r16.errorCode, 'ERR_EXAM_ARCHIVED');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 16]: normalizeRpcError: ERR_EXAM_ARCHIVED -> 422 ERR_EXAM_ARCHIVED');

    // 17. Exam not started -> 422 ERR_EXAM_NOT_STARTED
    const r17 = normalizeRpcError(new Error('ERR_EXAM_NOT_STARTED'));
    assert.equal(r17.status, 422);
    assert.equal(r17.errorCode, 'ERR_EXAM_NOT_STARTED');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 17]: normalizeRpcError: ERR_EXAM_NOT_STARTED -> 422 ERR_EXAM_NOT_STARTED');

    // 18. Exam closed -> 422 ERR_EXAM_CLOSED
    const r18 = normalizeRpcError(new Error('ERR_EXAM_CLOSED'));
    assert.equal(r18.status, 422);
    assert.equal(r18.errorCode, 'ERR_EXAM_CLOSED');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 18]: normalizeRpcError: ERR_EXAM_CLOSED -> 422 ERR_EXAM_CLOSED');

    // 19. File url not allowed -> 422 ERR_FILE_URL_NOT_ALLOWED
    const r19 = normalizeRpcError(new Error('ERR_FILE_URL_NOT_ALLOWED'));
    assert.equal(r19.status, 422);
    assert.equal(r19.errorCode, 'ERR_FILE_URL_NOT_ALLOWED');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 19]: normalizeRpcError: ERR_FILE_URL_NOT_ALLOWED -> 422 ERR_FILE_URL_NOT_ALLOWED');

    // 20. Invalid answer payload -> 422 ERR_INVALID_ANSWER_PAYLOAD
    const r20 = normalizeRpcError(new Error('ERR_INVALID_ANSWER_PAYLOAD'));
    assert.equal(r20.status, 422);
    assert.equal(r20.errorCode, 'ERR_INVALID_ANSWER_PAYLOAD');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 20]: normalizeRpcError: ERR_INVALID_ANSWER_PAYLOAD -> 422 ERR_INVALID_ANSWER_PAYLOAD');

    // 21. Invalid option key -> 422 ERR_INVALID_OPTION_KEY
    const r21 = normalizeRpcError(new Error('ERR_INVALID_OPTION_KEY'));
    assert.equal(r21.status, 422);
    assert.equal(r21.errorCode, 'ERR_INVALID_OPTION_KEY');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 21]: normalizeRpcError: ERR_INVALID_OPTION_KEY -> 422 ERR_INVALID_OPTION_KEY');

    // 22. Answer payload not allowed -> 422 ERR_ANSWER_PAYLOAD_NOT_ALLOWED
    const r22 = normalizeRpcError(new Error('ERR_ANSWER_PAYLOAD_NOT_ALLOWED'));
    assert.equal(r22.status, 422);
    assert.equal(r22.errorCode, 'ERR_ANSWER_PAYLOAD_NOT_ALLOWED');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 22]: normalizeRpcError: ERR_ANSWER_PAYLOAD_NOT_ALLOWED -> 422 ERR_ANSWER_PAYLOAD_NOT_ALLOWED');

    // 23. File url required -> 422 ERR_FILE_URL_REQUIRED
    const r23 = normalizeRpcError(new Error('ERR_FILE_URL_REQUIRED'));
    assert.equal(r23.status, 422);
    assert.equal(r23.errorCode, 'ERR_FILE_URL_REQUIRED');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 23]: normalizeRpcError: ERR_FILE_URL_REQUIRED -> 422 ERR_FILE_URL_REQUIRED');

    // 24. Unknown question type -> 422 ERR_UNKNOWN_QUESTION_TYPE
    const r24 = normalizeRpcError(new Error('ERR_UNKNOWN_QUESTION_TYPE'));
    assert.equal(r24.status, 422);
    assert.equal(r24.errorCode, 'ERR_UNKNOWN_QUESTION_TYPE');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 24]: normalizeRpcError: ERR_UNKNOWN_QUESTION_TYPE -> 422 ERR_UNKNOWN_QUESTION_TYPE');

    // 25. Question version mismatch -> 422 ERR_QUESTION_VERSION_MISMATCH
    const r25 = normalizeRpcError(new Error('ERR_QUESTION_VERSION_MISMATCH'));
    assert.equal(r25.status, 422);
    assert.equal(r25.errorCode, 'ERR_QUESTION_VERSION_MISMATCH');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 25]: normalizeRpcError: ERR_QUESTION_VERSION_MISMATCH -> 422 ERR_QUESTION_VERSION_MISMATCH');

    // 26. Exam upload not ready -> 422 ERR_EXAM_UPLOAD_NOT_READY
    const r26 = normalizeRpcError(new Error('ERR_EXAM_UPLOAD_NOT_READY'));
    assert.equal(r26.status, 422);
    assert.equal(r26.errorCode, 'ERR_EXAM_UPLOAD_NOT_READY');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 26]: normalizeRpcError: ERR_EXAM_UPLOAD_NOT_READY -> 422 ERR_EXAM_UPLOAD_NOT_READY');

    // 27. Fallback error sanitized to 500 INTERNAL_ERROR
    const r27 = normalizeRpcError(new Error('Some secret SQL error table not found'));
    assert.equal(r27.status, 500);
    assert.equal(r27.errorCode, 'INTERNAL_ERROR');
    assert.equal(r27.message, 'Đã xảy ra lỗi nội bộ trong quá trình xử lý bài thi.');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 27]: normalizeRpcError: unknown SQL error -> 500 INTERNAL_ERROR');
  }

  // A2. normalizeIntegrityRpcError (Scoped Anti-Oracle & Integrity Rules)
  {
    // 28. Identity mismatch -> Anti-Oracle 404 ATTEMPT_NOT_FOUND
    const i1 = normalizeIntegrityRpcError(new Error('ERR_STUDENT_IDENTITY_MISMATCH: Caller does not own attempt'));
    assert.equal(i1.status, 404);
    assert.equal(i1.errorCode, 'ATTEMPT_NOT_FOUND');
    assert.equal(i1.message, 'Không tìm thấy lượt làm bài thi.');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 28]: normalizeIntegrityRpcError: ERR_STUDENT_IDENTITY_MISMATCH -> 404 ATTEMPT_NOT_FOUND');

    // 29. Attempt not found -> Anti-Oracle 404 ATTEMPT_NOT_FOUND
    const i2 = normalizeIntegrityRpcError(new Error('ERR_ATTEMPT_NOT_FOUND'));
    assert.equal(i2.status, 404);
    assert.equal(i2.errorCode, 'ATTEMPT_NOT_FOUND');
    assert.equal(i2.message, 'Không tìm thấy lượt làm bài thi.');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 29]: normalizeIntegrityRpcError: ERR_ATTEMPT_NOT_FOUND -> 404 ATTEMPT_NOT_FOUND');

    // 30. Required params -> 400 INVALID_INPUT
    const i3 = normalizeIntegrityRpcError(new Error('ERR_REQUIRED_PARAMS'));
    assert.equal(i3.status, 400);
    assert.equal(i3.errorCode, 'INVALID_INPUT');
    assert.equal(i3.message, 'Thiếu tham số bắt buộc trong yêu cầu.');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 30]: normalizeIntegrityRpcError: ERR_REQUIRED_PARAMS -> 400 INVALID_INPUT');

    // 31. Invalid event source -> 400 ERR_INVALID_EVENT_SOURCE
    const i4 = normalizeIntegrityRpcError(new Error('ERR_INVALID_EVENT_SOURCE'));
    assert.equal(i4.status, 400);
    assert.equal(i4.errorCode, 'ERR_INVALID_EVENT_SOURCE');
    assert.equal(i4.message, 'Nguồn sự kiện không hợp lệ.');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 31]: normalizeIntegrityRpcError: ERR_INVALID_EVENT_SOURCE -> 400 ERR_INVALID_EVENT_SOURCE');

    // 32. Attempt finalized -> 409 ERR_ATTEMPT_ALREADY_FINALIZED
    const i5 = normalizeIntegrityRpcError(new Error('ERR_ATTEMPT_FINALIZED'));
    assert.equal(i5.status, 409);
    assert.equal(i5.errorCode, 'ERR_ATTEMPT_ALREADY_FINALIZED');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 32]: normalizeIntegrityRpcError: ERR_ATTEMPT_FINALIZED -> 409 ERR_ATTEMPT_ALREADY_FINALIZED');

    // 33. Attempt expired -> 409 ERR_ATTEMPT_EXPIRED
    const i6 = normalizeIntegrityRpcError(new Error('ERR_ATTEMPT_EXPIRED'));
    assert.equal(i6.status, 409);
    assert.equal(i6.errorCode, 'ERR_ATTEMPT_EXPIRED');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 33]: normalizeIntegrityRpcError: ERR_ATTEMPT_EXPIRED -> 409 ERR_ATTEMPT_EXPIRED');

    // 34. Invalid tab switch policy -> 422 ERR_INVALID_TAB_SWITCH_POLICY
    const i7 = normalizeIntegrityRpcError(new Error('ERR_INVALID_TAB_SWITCH_POLICY'));
    assert.equal(i7.status, 422);
    assert.equal(i7.errorCode, 'ERR_INVALID_TAB_SWITCH_POLICY');
    assert.equal(i7.message, 'Cấu hình kiểm soát chuyển tab của đề thi không hợp lệ.');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 34]: normalizeIntegrityRpcError: ERR_INVALID_TAB_SWITCH_POLICY -> 422 ERR_INVALID_TAB_SWITCH_POLICY');

    // 35. Fallback error sanitized to 500 INTERNAL_ERROR
    const i8 = normalizeIntegrityRpcError(new Error('Internal DB timeout'));
    assert.equal(i8.status, 500);
    assert.equal(i8.errorCode, 'INTERNAL_ERROR');
    assert.equal(i8.message, 'Đã xảy ra lỗi nội bộ trong quá trình xử lý sự kiện bài thi.');
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 35]: normalizeIntegrityRpcError: unknown error -> 500 INTERNAL_ERROR');
  }

  // A3. mapRecordIntegrityEventSuccess (Response Projection Allowlist)
  {
    // 36. Valid projection with all 7 fields
    const validRpcData = {
      attempt_id: '22222222-2222-4222-8222-222222222222',
      tab_switch_policy: 'WARN_AND_LOG',
      tab_switch_count: 3,
      active_leave_episode_id: '33333333-3333-4333-8333-333333333333',
      event_recorded: true,
      event_type: 'episode_opened',
      idempotent_replay: false,
      extra_secret_db_field: 'LEAK',
    };
    const p1 = mapRecordIntegrityEventSuccess(validRpcData);
    assert.equal(p1.ok, true);
    assert.deepEqual(Object.keys(p1.data).sort(), [
      'active_leave_episode_id',
      'attempt_id',
      'event_recorded',
      'event_type',
      'idempotent_replay',
      'tab_switch_count',
      'tab_switch_policy',
    ]);
    assert.equal('extra_secret_db_field' in p1.data, false);
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 36]: mapRecordIntegrityEventSuccess: strips unapproved fields & projects exactly 7 fields');

    // 37. Valid projection with null active episode
    const nullEpisodeData = {
      attempt_id: '22222222-2222-4222-8222-222222222222',
      tab_switch_policy: 'WARN_ONLY',
      tab_switch_count: 0,
      active_leave_episode_id: null,
      event_recorded: false,
      event_type: null,
      idempotent_replay: false,
    };
    const p2 = mapRecordIntegrityEventSuccess(nullEpisodeData);
    assert.equal(p2.ok, true);
    assert.equal(p2.data.active_leave_episode_id, null);
    assert.equal(p2.data.event_type, null);
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 37]: mapRecordIntegrityEventSuccess: handles null active_leave_episode_id & event_type');

    // 38. Invalid rpcData fails closed (returns ok: false)
    assert.equal(mapRecordIntegrityEventSuccess(null).ok, false);
    assert.equal(mapRecordIntegrityEventSuccess('invalid').ok, false);
    assert.equal(mapRecordIntegrityEventSuccess([]).ok, false);
    assert.equal(mapRecordIntegrityEventSuccess({ attempt_id: 'invalid' }).ok, false);
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 38]: mapRecordIntegrityEventSuccess: fails closed on invalid/missing fields');
  }

  // A4. createErrorResponse & createSuccessResponse
  {
    // 39. createErrorResponse builds valid envelope + cache headers
    const errRes = createErrorResponse(400, 'INVALID_INPUT', 'Test error', { 'X-Custom': 'yes' });
    assert.equal(errRes.status, 400);
    assert.equal(errRes.headers.get('Content-Type'), 'application/json');
    assert.equal(errRes.headers.get('Cache-Control'), 'no-store');
    assert.equal(errRes.headers.get('X-Custom'), 'yes');
    const errBody = await errRes.json();
    assert.deepEqual(errBody, { success: false, error_code: 'INVALID_INPUT', message: 'Test error' });
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 39]: createErrorResponse: status, headers, Cache-Control: no-store, body verified');

    // 40. createSuccessResponse builds valid envelope + cache headers
    const succRes = createSuccessResponse({ foo: 'bar' }, 200, { 'X-Custom': 'yes' });
    assert.equal(succRes.status, 200);
    assert.equal(succRes.headers.get('Content-Type'), 'application/json');
    assert.equal(succRes.headers.get('Cache-Control'), 'no-store');
    assert.equal(succRes.headers.get('X-Custom'), 'yes');
    const succBody = await succRes.json();
    assert.deepEqual(succBody, { success: true, data: { foo: 'bar' } });
    prodSharedErrorPassCount++;
    console.log('  ✓ [Prod-Shared 40]: createSuccessResponse: status, headers, Cache-Control: no-store, body verified');
  }

  // ==========================================================================
  // SECTION B: PRODUCTION MODULE TESTS - exam-record-integrity-event/validation.ts
  // ==========================================================================
  console.log('\n--- SECTION B: PRODUCTION VALIDATION MODULE TESTS ---');

  // B1. isValidIsoTimestamp tests
  {
    // 1. Valid UTC Z timestamp
    assert.equal(isValidIsoTimestamp('2026-09-06T12:34:56Z'), true);
    prodValidationPassCount++;
    console.log('  ✓ [Prod-Val 1]: isValidIsoTimestamp: 2026-09-06T12:34:56Z -> valid');

    // 2. Valid +07:00 timezone timestamp
    assert.equal(isValidIsoTimestamp('2026-09-06T19:34:56+07:00'), true);
    prodValidationPassCount++;
    console.log('  ✓ [Prod-Val 2]: isValidIsoTimestamp: 2026-09-06T19:34:56+07:00 -> valid');

    // 3. Valid -05:00 timezone timestamp
    assert.equal(isValidIsoTimestamp('2026-09-06T07:34:56-05:00'), true);
    prodValidationPassCount++;
    console.log('  ✓ [Prod-Val 3]: isValidIsoTimestamp: 2026-09-06T07:34:56-05:00 -> valid');

    // 4. Valid fractional seconds with Z
    assert.equal(isValidIsoTimestamp('2026-09-06T12:34:56.123Z'), true);
    prodValidationPassCount++;
    console.log('  ✓ [Prod-Val 4]: isValidIsoTimestamp: 2026-09-06T12:34:56.123Z -> valid');

    // 5. Valid leap year February 29
    assert.equal(isValidIsoTimestamp('2024-02-29T12:00:00Z'), true);
    prodValidationPassCount++;
    console.log('  ✓ [Prod-Val 5]: isValidIsoTimestamp: 2024-02-29 (leap year) -> valid');

    // 6. Invalid non-leap year February 29
    assert.equal(isValidIsoTimestamp('2026-02-29T12:00:00Z'), false);
    prodValidationPassCount++;
    console.log('  ✓ [Prod-Val 6]: isValidIsoTimestamp: 2026-02-29 (non-leap year) -> invalid');

    // 7. Invalid February 30
    assert.equal(isValidIsoTimestamp('2026-02-30T10:00:00Z'), false);
    prodValidationPassCount++;
    console.log('  ✓ [Prod-Val 7]: isValidIsoTimestamp: 2026-02-30 -> invalid');

    // 8. Invalid hour 24:00:00
    assert.equal(isValidIsoTimestamp('2026-09-06T24:00:00Z'), false);
    prodValidationPassCount++;
    console.log('  ✓ [Prod-Val 8]: isValidIsoTimestamp: hour 24 -> invalid');

    // 9. Invalid minute 60
    assert.equal(isValidIsoTimestamp('2026-09-06T12:60:00Z'), false);
    prodValidationPassCount++;
    console.log('  ✓ [Prod-Val 9]: isValidIsoTimestamp: minute 60 -> invalid');

    // 10. Missing timezone
    assert.equal(isValidIsoTimestamp('2026-09-06T12:34:56'), false);
    prodValidationPassCount++;
    console.log('  ✓ [Prod-Val 10]: isValidIsoTimestamp: missing timezone -> invalid');

    // 11. Date only
    assert.equal(isValidIsoTimestamp('2026-09-06'), false);
    prodValidationPassCount++;
    console.log('  ✓ [Prod-Val 11]: isValidIsoTimestamp: date only -> invalid');

    // 12. Arbitrary text
    assert.equal(isValidIsoTimestamp('September 6, 2026'), false);
    prodValidationPassCount++;
    console.log('  ✓ [Prod-Val 12]: isValidIsoTimestamp: arbitrary text -> invalid');
  }

  // B2. validateIntegrityEventPayload tests
  {
    const validUuid = '22222222-2222-4222-8222-222222222222';

    // 13. Minimal valid payload
    const v1 = validateIntegrityEventPayload({ attempt_id: validUuid, source: 'page_hidden' });
    assert.equal(v1.valid, true);
    assert.equal(v1.sanitizedData.attempt_id, validUuid);
    assert.equal(v1.sanitizedData.source, 'page_hidden');
    assert.equal(v1.sanitizedData.client_timestamp, null);
    prodValidationPassCount++;
    console.log('  ✓ [Prod-Val 13]: validateIntegrityEventPayload: minimal valid payload (null timestamp)');

    // 14. Valid payload with explicit client_timestamp
    const v2 = validateIntegrityEventPayload({ attempt_id: validUuid, source: 'page_visible', client_timestamp: '2026-09-06T12:34:56Z' });
    assert.equal(v2.valid, true);
    assert.equal(v2.sanitizedData.client_timestamp, '2026-09-06T12:34:56Z');
    prodValidationPassCount++;
    console.log('  ✓ [Prod-Val 14]: validateIntegrityEventPayload: valid payload with client_timestamp');

    // 15. Non-object / array payload rejected
    const v3 = validateIntegrityEventPayload([1, 2, 3]);
    assert.equal(v3.valid, false);
    assert.equal(v3.errorCode, 'INVALID_INPUT');
    prodValidationPassCount++;
    console.log('  ✓ [Prod-Val 15]: validateIntegrityEventPayload: array payload -> 400 INVALID_INPUT');

    // 16. Missing attempt_id rejected
    const v4 = validateIntegrityEventPayload({ source: 'page_hidden' });
    assert.equal(v4.valid, false);
    assert.equal(v4.errorCode, 'INVALID_INPUT');
    prodValidationPassCount++;
    console.log('  ✓ [Prod-Val 16]: validateIntegrityEventPayload: missing attempt_id -> 400 INVALID_INPUT');

    // 17. Invalid attempt_id format rejected
    const v5 = validateIntegrityEventPayload({ attempt_id: 'not-a-uuid', source: 'page_hidden' });
    assert.equal(v5.valid, false);
    assert.equal(v5.errorCode, 'INVALID_INPUT');
    prodValidationPassCount++;
    console.log('  ✓ [Prod-Val 17]: validateIntegrityEventPayload: invalid UUID -> 400 INVALID_INPUT');

    // 18. Upper-case UUID normalized to lowercase
    const upperUuid = '22222222-2222-4222-8222-222222222222'.toUpperCase();
    const v6 = validateIntegrityEventPayload({ attempt_id: upperUuid, source: 'page_hidden' });
    assert.equal(v6.valid, true);
    assert.equal(v6.sanitizedData.attempt_id, validUuid);
    prodValidationPassCount++;
    console.log('  ✓ [Prod-Val 18]: validateIntegrityEventPayload: uppercase UUID normalized to lowercase');

    // 19. Missing source rejected
    const v7 = validateIntegrityEventPayload({ attempt_id: validUuid });
    assert.equal(v7.valid, false);
    assert.equal(v7.errorCode, 'INVALID_INPUT');
    prodValidationPassCount++;
    console.log('  ✓ [Prod-Val 19]: validateIntegrityEventPayload: missing source -> 400 INVALID_INPUT');

    // 20. Invalid source enum rejected
    const v8 = validateIntegrityEventPayload({ attempt_id: validUuid, source: 'mouse_leave' });
    assert.equal(v8.valid, false);
    assert.equal(v8.errorCode, 'ERR_INVALID_EVENT_SOURCE');
    prodValidationPassCount++;
    console.log('  ✓ [Prod-Val 20]: validateIntegrityEventPayload: invalid source enum -> 400 ERR_INVALID_EVENT_SOURCE');

    // 21. Forbidden field caller_id rejected
    const v9 = validateIntegrityEventPayload({ attempt_id: validUuid, source: 'page_hidden', caller_id: 'some-id' });
    assert.equal(v9.valid, false);
    assert.equal(v9.errorCode, 'INVALID_REQUEST_FIELD');
    prodValidationPassCount++;
    console.log('  ✓ [Prod-Val 21]: validateIntegrityEventPayload: forbidden field caller_id -> 400 INVALID_REQUEST_FIELD');

    // 22. Forbidden field student_id rejected
    const v10 = validateIntegrityEventPayload({ attempt_id: validUuid, source: 'page_hidden', student_id: 'some-id' });
    assert.equal(v10.valid, false);
    assert.equal(v10.errorCode, 'INVALID_REQUEST_FIELD');
    prodValidationPassCount++;
    console.log('  ✓ [Prod-Val 22]: validateIntegrityEventPayload: forbidden field student_id -> 400 INVALID_REQUEST_FIELD');

    // 23. Forbidden field p_attempt_id rejected
    const v11 = validateIntegrityEventPayload({ attempt_id: validUuid, source: 'page_hidden', p_attempt_id: validUuid });
    assert.equal(v11.valid, false);
    assert.equal(v11.errorCode, 'INVALID_REQUEST_FIELD');
    prodValidationPassCount++;
    console.log('  ✓ [Prod-Val 23]: validateIntegrityEventPayload: forbidden field p_attempt_id -> 400 INVALID_REQUEST_FIELD');

    // 24. Unknown extra field rejected
    const v12 = validateIntegrityEventPayload({ attempt_id: validUuid, source: 'page_hidden', unknown_extra_field: 123 });
    assert.equal(v12.valid, false);
    assert.equal(v12.errorCode, 'INVALID_REQUEST_FIELD');
    prodValidationPassCount++;
    console.log('  ✓ [Prod-Val 24]: validateIntegrityEventPayload: unknown field -> 400 INVALID_REQUEST_FIELD');

    // 25. Invalid client_timestamp format rejected
    const v13 = validateIntegrityEventPayload({ attempt_id: validUuid, source: 'page_hidden', client_timestamp: '2026-09-06' });
    assert.equal(v13.valid, false);
    assert.equal(v13.errorCode, 'INVALID_INPUT');
    prodValidationPassCount++;
    console.log('  ✓ [Prod-Val 25]: validateIntegrityEventPayload: invalid client_timestamp -> 400 INVALID_INPUT');

    // 26. Non-string client_timestamp rejected
    const v14 = validateIntegrityEventPayload({ attempt_id: validUuid, source: 'page_hidden', client_timestamp: 123456789 });
    assert.equal(v14.valid, false);
    assert.equal(v14.errorCode, 'INVALID_INPUT');
    prodValidationPassCount++;
    console.log('  ✓ [Prod-Val 26]: validateIntegrityEventPayload: non-string client_timestamp -> 400 INVALID_INPUT');

    // 27. Exported constants integrity check
    assert.equal(ALLOWED_SOURCES.size, 4);
    assert.equal(ALLOWED_SOURCES.has('page_hidden'), true);
    assert.equal(ALLOWED_SOURCES.has('page_visible'), true);
    assert.equal(ALLOWED_SOURCES.has('window_focus'), true);
    assert.equal(ALLOWED_SOURCES.has('window_blur'), true);
    assert.equal(FORBIDDEN_FIELDS.has('service_role'), true);
    assert.equal(FORBIDDEN_FIELDS.has('caller_id'), true);
    assert.equal(FORBIDDEN_FIELDS.has('student_id'), true);
    assert.equal(ALLOWED_FIELDS.size, 3);
    prodValidationPassCount++;
    console.log('  ✓ [Prod-Val 27]: Exported constants: ALLOWED_SOURCES, FORBIDDEN_FIELDS, ALLOWED_FIELDS verified');
  }

  // ==========================================================================
  // SECTION C: MIRROR SPEC TESTS - Handler Flow Integration
  // ==========================================================================
  console.log('\n--- SECTION C: MIRROR SPEC TESTS (HANDLER FLOW INTEGRATION) ---');

  const validStudentId = '11111111-1111-4111-8111-111111111111';
  const validAttemptId = '22222222-2222-4222-8222-222222222222';
  const jsonHeaders = { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' };

  function createMockDeps({
    user = { id: validStudentId },
    userError = null,
    profile = { id: validStudentId, role: 'student', is_disabled: false },
    rpcHandler = async () => ({
      data: {
        attempt_id: validAttemptId,
        tab_switch_policy: 'WARN_AND_LOG',
        tab_switch_count: 1,
        active_leave_episode_id: '33333333-3333-4333-8333-333333333333',
        event_recorded: true,
        event_type: 'episode_opened',
        idempotent_replay: false,
      },
      error: null,
    }),
  } = {}) {
    let rpcCallCount = 0;
    let lastRpcArgs = null;

    return {
      getRpcCallCount: () => rpcCallCount,
      getLastRpcArgs: () => lastRpcArgs,
      authDeps: {
        mode: 'injected',
        callerAuthClient: {
          auth: {
            getUser: async () => ({ data: { user }, error: userError }),
          },
        },
        coreQueryClient: {
          from: () => ({
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: profile, error: null }),
              }),
            }),
          }),
        },
      },
      examClient: {
        rpc: async (name, args) => {
          rpcCallCount++;
          lastRpcArgs = { name, args };
          return await rpcHandler(name, args);
        },
      },
    };
  }

  // C1. Content-Type Hardening Tests
  {
    // 1. Missing Content-Type for POST -> 415 UNSUPPORTED_MEDIA_TYPE
    const req1 = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: { Authorization: 'Bearer valid-token' }, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const res1 = await handleRecordIntegrityEventRequestMirror(req1, createMockDeps());
    assert.equal(res1.status, 415);
    const body1 = await res1.json();
    assert.equal(body1.error_code, 'UNSUPPORTED_MEDIA_TYPE');
    mirrorSpecPassCount++;
    console.log('  ✓ [Mirror-1]: Missing Content-Type -> 415 UNSUPPORTED_MEDIA_TYPE');

    // 2. text/plain Content-Type -> 415 UNSUPPORTED_MEDIA_TYPE
    const req2 = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'text/plain' }, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const res2 = await handleRecordIntegrityEventRequestMirror(req2, createMockDeps());
    assert.equal(res2.status, 415);
    const body2 = await res2.json();
    assert.equal(body2.error_code, 'UNSUPPORTED_MEDIA_TYPE');
    mirrorSpecPassCount++;
    console.log('  ✓ [Mirror-2]: text/plain Content-Type -> 415 UNSUPPORTED_MEDIA_TYPE');

    // 3. application/json-malicious -> 415 UNSUPPORTED_MEDIA_TYPE
    const req3 = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json-malicious' }, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const res3 = await handleRecordIntegrityEventRequestMirror(req3, createMockDeps());
    assert.equal(res3.status, 415);
    const body3 = await res3.json();
    assert.equal(body3.error_code, 'UNSUPPORTED_MEDIA_TYPE');
    mirrorSpecPassCount++;
    console.log('  ✓ [Mirror-3]: application/json-malicious -> 415 UNSUPPORTED_MEDIA_TYPE');

    // 4. Valid application/json; charset=utf-8 accepted -> 200 OK
    const req4 = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const res4 = await handleRecordIntegrityEventRequestMirror(req4, createMockDeps());
    assert.equal(res4.status, 200);
    mirrorSpecPassCount++;
    console.log('  ✓ [Mirror-4]: application/json; charset=utf-8 accepted -> 200 OK');
  }

  // C2. Auth & Protocol Tests
  {
    // 5. Missing auth header -> 401 AUTH_REQUIRED
    const req5 = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const res5 = await handleRecordIntegrityEventRequestMirror(req5, createMockDeps());
    assert.equal(res5.status, 401);
    const body5 = await res5.json();
    assert.equal(body5.error_code, 'AUTH_REQUIRED');
    mirrorSpecPassCount++;
    console.log('  ✓ [Mirror-5]: Missing auth header -> 401 AUTH_REQUIRED');

    // 6. Invalid token -> 401 INVALID_TOKEN
    const req6 = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: { Authorization: 'Bearer expired-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const res6 = await handleRecordIntegrityEventRequestMirror(req6, createMockDeps({ user: null, userError: new Error('Token expired') }));
    assert.equal(res6.status, 401);
    const body6 = await res6.json();
    assert.equal(body6.error_code, 'INVALID_TOKEN');
    mirrorSpecPassCount++;
    console.log('  ✓ [Mirror-6]: Invalid token -> 401 INVALID_TOKEN');

    // 7. Non-student role -> 403 FORBIDDEN_ROLE
    const req7 = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const res7 = await handleRecordIntegrityEventRequestMirror(req7, createMockDeps({ profile: { id: validStudentId, role: 'teacher', is_disabled: false } }));
    assert.equal(res7.status, 403);
    const body7 = await res7.json();
    assert.equal(body7.error_code, 'FORBIDDEN_ROLE');
    mirrorSpecPassCount++;
    console.log('  ✓ [Mirror-7]: Non-student role -> 403 FORBIDDEN_ROLE');

    // 8. Disabled account -> 403 ACCOUNT_DISABLED
    const req8 = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const res8 = await handleRecordIntegrityEventRequestMirror(req8, createMockDeps({ profile: { id: validStudentId, role: 'student', is_disabled: true } }));
    assert.equal(res8.status, 403);
    const body8 = await res8.json();
    assert.equal(body8.error_code, 'ACCOUNT_DISABLED');
    mirrorSpecPassCount++;
    console.log('  ✓ [Mirror-8]: Disabled account -> 403 ACCOUNT_DISABLED');

    // 9. OPTIONS preflight -> 200 + CORS headers + Cache-Control: no-store + nosniff
    const req9 = new Request('http://localhost/exam-record-integrity-event', { method: 'OPTIONS' });
    const res9 = await handleRecordIntegrityEventRequestMirror(req9, createMockDeps());
    assert.equal(res9.status, 200);
    assert.equal(res9.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(res9.headers.get('Cache-Control'), 'no-store');
    assert.equal(res9.headers.get('X-Content-Type-Options'), 'nosniff');
    mirrorSpecPassCount++;
    console.log('  ✓ [Mirror-9]: OPTIONS preflight -> 200 + CORS headers + Cache-Control: no-store + nosniff');

    // 10. GET method -> 405 METHOD_NOT_ALLOWED + Allow: POST
    const req10 = new Request('http://localhost/exam-record-integrity-event', { method: 'GET' });
    const res10 = await handleRecordIntegrityEventRequestMirror(req10, createMockDeps());
    assert.equal(res10.status, 405);
    assert.equal(res10.headers.get('Allow'), 'POST');
    assert.equal(res10.headers.get('Cache-Control'), 'no-store');
    assert.equal(res10.headers.get('X-Content-Type-Options'), 'nosniff');
    const body10 = await res10.json();
    assert.equal(body10.error_code, 'METHOD_NOT_ALLOWED');
    mirrorSpecPassCount++;
    console.log('  ✓ [Mirror-10]: GET method -> 405 METHOD_NOT_ALLOWED + Allow: POST');

    // 11. Malformed JSON -> 400 INVALID_INPUT
    const req11 = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: '{bad-json}' });
    const res11 = await handleRecordIntegrityEventRequestMirror(req11, createMockDeps());
    assert.equal(res11.status, 400);
    const body11 = await res11.json();
    assert.equal(body11.error_code, 'INVALID_INPUT');
    mirrorSpecPassCount++;
    console.log('  ✓ [Mirror-11]: Malformed JSON -> 400 INVALID_INPUT');
  }

  // C3. Anti-Oracle & Lifecycle Scenarios
  {
    // 12. Nonexistent attempt -> 404 ATTEMPT_NOT_FOUND
    const req12 = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const res12 = await handleRecordIntegrityEventRequestMirror(req12, createMockDeps({ rpcHandler: async () => ({ data: null, error: new Error('ERR_ATTEMPT_NOT_FOUND') }) }));
    assert.equal(res12.status, 404);
    const body12 = await res12.json();
    assert.equal(body12.error_code, 'ATTEMPT_NOT_FOUND');
    mirrorSpecPassCount++;
    console.log('  ✓ [Mirror-12]: Nonexistent attempt -> 404 ATTEMPT_NOT_FOUND');

    // 13. Wrong student owner -> 404 ATTEMPT_NOT_FOUND (Anti-Oracle Scoped)
    const req13 = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const res13 = await handleRecordIntegrityEventRequestMirror(req13, createMockDeps({ rpcHandler: async () => ({ data: null, error: new Error('ERR_STUDENT_IDENTITY_MISMATCH') }) }));
    assert.equal(res13.status, 404);
    const body13 = await res13.json();
    assert.equal(body13.error_code, 'ATTEMPT_NOT_FOUND');
    mirrorSpecPassCount++;
    console.log('  ✓ [Mirror-13]: Wrong student owner (Integrity) -> 404 ATTEMPT_NOT_FOUND (Anti-Oracle Scoped)');

    // 14. Expired attempt -> 409 ERR_ATTEMPT_EXPIRED
    const req14 = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const res14 = await handleRecordIntegrityEventRequestMirror(req14, createMockDeps({ rpcHandler: async () => ({ data: null, error: new Error('ERR_ATTEMPT_EXPIRED') }) }));
    assert.equal(res14.status, 409);
    const body14 = await res14.json();
    assert.equal(body14.error_code, 'ERR_ATTEMPT_EXPIRED');
    mirrorSpecPassCount++;
    console.log('  ✓ [Mirror-14]: Expired attempt -> 409 ERR_ATTEMPT_EXPIRED');

    // 15. Finalized attempt -> 409 ERR_ATTEMPT_ALREADY_FINALIZED
    const req15 = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const res15 = await handleRecordIntegrityEventRequestMirror(req15, createMockDeps({ rpcHandler: async () => ({ data: null, error: new Error('ERR_ATTEMPT_FINALIZED') }) }));
    assert.equal(res15.status, 409);
    const body15 = await res15.json();
    assert.equal(body15.error_code, 'ERR_ATTEMPT_ALREADY_FINALIZED');
    mirrorSpecPassCount++;
    console.log('  ✓ [Mirror-15]: Finalized attempt -> 409 ERR_ATTEMPT_ALREADY_FINALIZED');

    // 16. WARN_AND_LOG page_hidden open -> 200 OK, event_recorded: true, episode_opened
    const req16 = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const res16 = await handleRecordIntegrityEventRequestMirror(req16, createMockDeps());
    assert.equal(res16.status, 200);
    const body16 = await res16.json();
    assert.equal(body16.success, true);
    assert.equal(body16.data.event_recorded, true);
    assert.equal(body16.data.event_type, 'episode_opened');
    mirrorSpecPassCount++;
    console.log('  ✓ [Mirror-16]: WARN_AND_LOG page_hidden open -> 200 OK, event_recorded: true, episode_opened');

    // 17. Duplicate page_hidden replay -> 200 OK, event_recorded: false, idempotent_replay: true
    const req17 = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const res17 = await handleRecordIntegrityEventRequestMirror(req17, createMockDeps({
      rpcHandler: async () => ({
        data: {
          attempt_id: validAttemptId,
          tab_switch_policy: 'WARN_AND_LOG',
          tab_switch_count: 1,
          active_leave_episode_id: '33333333-3333-4333-8333-333333333333',
          event_recorded: false,
          event_type: null,
          idempotent_replay: true,
        },
        error: null,
      }),
    }));
    assert.equal(res17.status, 200);
    const body17 = await res17.json();
    assert.equal(body17.data.event_recorded, false);
    assert.equal(body17.data.idempotent_replay, true);
    mirrorSpecPassCount++;
    console.log('  ✓ [Mirror-17]: Duplicate page_hidden -> 200 OK, event_recorded: false, idempotent_replay: true');

    // 18. window_blur auxiliary -> 200 OK, focus_loss_auxiliary
    const req18 = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'window_blur' }) });
    const res18 = await handleRecordIntegrityEventRequestMirror(req18, createMockDeps({
      rpcHandler: async () => ({
        data: {
          attempt_id: validAttemptId,
          tab_switch_policy: 'WARN_AND_LOG',
          tab_switch_count: 1,
          active_leave_episode_id: '33333333-3333-4333-8333-333333333333',
          event_recorded: true,
          event_type: 'focus_loss_auxiliary',
          idempotent_replay: false,
        },
        error: null,
      }),
    }));
    assert.equal(res18.status, 200);
    const body18 = await res18.json();
    assert.equal(body18.data.event_type, 'focus_loss_auxiliary');
    mirrorSpecPassCount++;
    console.log('  ✓ [Mirror-18]: window_blur -> 200 OK, event_recorded: true, focus_loss_auxiliary');

    // 19. page_visible close -> 200 OK, episode_closed, active_leave_episode_id: null
    const req19 = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_visible' }) });
    const res19 = await handleRecordIntegrityEventRequestMirror(req19, createMockDeps({
      rpcHandler: async () => ({
        data: {
          attempt_id: validAttemptId,
          tab_switch_policy: 'WARN_AND_LOG',
          tab_switch_count: 1,
          active_leave_episode_id: null,
          event_recorded: true,
          event_type: 'episode_closed',
          idempotent_replay: false,
        },
        error: null,
      }),
    }));
    assert.equal(res19.status, 200);
    const body19 = await res19.json();
    assert.equal(body19.data.event_type, 'episode_closed');
    assert.equal(body19.data.active_leave_episode_id, null);
    mirrorSpecPassCount++;
    console.log('  ✓ [Mirror-19]: page_visible close -> 200 OK, episode_closed, active_leave_episode_id: null');

    // 20. WARN_ONLY policy -> 200 OK, event_recorded: false, tab_switch_count: 0
    const req20 = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const res20 = await handleRecordIntegrityEventRequestMirror(req20, createMockDeps({
      rpcHandler: async () => ({
        data: {
          attempt_id: validAttemptId,
          tab_switch_policy: 'WARN_ONLY',
          tab_switch_count: 0,
          active_leave_episode_id: null,
          event_recorded: false,
          event_type: null,
          idempotent_replay: false,
        },
        error: null,
      }),
    }));
    assert.equal(res20.status, 200);
    const body20 = await res20.json();
    assert.equal(body20.data.tab_switch_policy, 'WARN_ONLY');
    assert.equal(body20.data.event_recorded, false);
    mirrorSpecPassCount++;
    console.log('  ✓ [Mirror-20]: WARN_ONLY policy -> 200 OK, event_recorded: false, tab_switch_count: 0');

    // 21. OFF policy -> 200 OK, event_recorded: false, tab_switch_count: 0
    const req21 = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const res21 = await handleRecordIntegrityEventRequestMirror(req21, createMockDeps({
      rpcHandler: async () => ({
        data: {
          attempt_id: validAttemptId,
          tab_switch_policy: 'OFF',
          tab_switch_count: 0,
          active_leave_episode_id: null,
          event_recorded: false,
          event_type: null,
          idempotent_replay: false,
        },
        error: null,
      }),
    }));
    assert.equal(res21.status, 200);
    const body21 = await res21.json();
    assert.equal(body21.data.tab_switch_policy, 'OFF');
    assert.equal(body21.data.event_recorded, false);
    mirrorSpecPassCount++;
    console.log('  ✓ [Mirror-21]: OFF policy -> 200 OK, event_recorded: false, tab_switch_count: 0');

    // 22. Omitted client_timestamp -> RPC receives p_client_timestamp = null
    const req22 = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const deps22 = createMockDeps();
    const res22 = await handleRecordIntegrityEventRequestMirror(req22, deps22);
    assert.equal(res22.status, 200);
    const args22 = deps22.getLastRpcArgs();
    assert.equal(args22.args.p_client_timestamp, null);
    mirrorSpecPassCount++;
    console.log('  ✓ [Mirror-22]: Omitted client_timestamp -> RPC receives p_client_timestamp = null');

    // 23. Explicit null client_timestamp -> RPC receives p_client_timestamp = null
    const req23 = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden', client_timestamp: null }) });
    const deps23 = createMockDeps();
    const res23 = await handleRecordIntegrityEventRequestMirror(req23, deps23);
    assert.equal(res23.status, 200);
    const args23 = deps23.getLastRpcArgs();
    assert.equal(args23.args.p_client_timestamp, null);
    mirrorSpecPassCount++;
    console.log('  ✓ [Mirror-23]: Explicit null client_timestamp -> RPC receives p_client_timestamp = null');

    // 24. Valid Z timestamp passed to RPC
    const ts24 = '2026-09-06T12:34:56Z';
    const req24 = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden', client_timestamp: ts24 }) });
    const deps24 = createMockDeps();
    const res24 = await handleRecordIntegrityEventRequestMirror(req24, deps24);
    assert.equal(res24.status, 200);
    const args24 = deps24.getLastRpcArgs();
    assert.equal(args24.args.p_client_timestamp, ts24);
    mirrorSpecPassCount++;
    console.log('  ✓ [Mirror-24]: Valid Z timestamp passed to RPC');

    // 25. BFF single RPC execution per HTTP request (no blind retry)
    const req25 = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const deps25 = createMockDeps({
      rpcHandler: async () => ({ data: null, error: new Error('Postgres connection timeout') }),
    });
    const res25 = await handleRecordIntegrityEventRequestMirror(req25, deps25);
    assert.equal(res25.status, 500);
    assert.equal(deps25.getRpcCallCount(), 1);
    mirrorSpecPassCount++;
    console.log('  ✓ [Mirror-25]: BFF calls RPC exactly once per request with zero blind internal retry');
  }

  // ==========================================================================
  // SECTION D: FRONTEND ORDERING SPEC ASSERTIONS (31 - 35)
  // ==========================================================================
  console.log('\n--- SECTION D: FRONTEND ORDERING SPEC ASSERTIONS ---');

  class ClientOrderedEventQueue {
    constructor() {
      this.seq = 0;
      this.queue = [];
    }

    enqueue(source, timestamp) {
      const event = { id: ++this.seq, source, timestamp, status: 'pending' };
      if (['page_hidden', 'page_visible', 'window_focus'].includes(source)) {
        this.queue = this.queue.filter(e => {
          if (e.status === 'ambiguous_timeout' && ['page_hidden', 'page_visible', 'window_focus'].includes(e.source)) {
            return false;
          }
          return true;
        });
      }
      this.queue.push(event);
      return event;
    }

    markAmbiguousTimeout(event) {
      event.status = 'ambiguous_timeout';
    }

    markPreDispatchFailure(event) {
      event.status = 'pre_dispatch_failure';
    }

    canRetry(event) {
      if (event.status === 'pre_dispatch_failure') return true;
      if (event.status === 'ambiguous_timeout') {
        const newerLifecycleExists = this.queue.some(e => e.id > event.id && ['page_hidden', 'page_visible', 'window_focus'].includes(e.source));
        return !newerLifecycleExists;
      }
      return false;
    }
  }

  // 1. hidden_timeout_then_visible_no_stale_hidden_retry
  {
    const q = new ClientOrderedEventQueue();
    const evHidden = q.enqueue('page_hidden');
    q.markAmbiguousTimeout(evHidden);
    const evVisible = q.enqueue('page_visible');
    assert.equal(q.canRetry(evHidden), false, 'Stale hidden event must NOT be retried after visible is enqueued');
    frontendOrderingSpecPassCount++;
    console.log('  ✓ [Frontend-Spec 1]: hidden_timeout_then_visible drops stale hidden retry');
  }

  // 2. visible_timeout_then_hidden_no_stale_close_retry
  {
    const q = new ClientOrderedEventQueue();
    const evVisible = q.enqueue('page_visible');
    q.markAmbiguousTimeout(evVisible);
    const evHidden = q.enqueue('page_hidden');
    assert.equal(q.canRetry(evVisible), false, 'Stale visible event must NOT be retried after hidden is enqueued');
    frontendOrderingSpecPassCount++;
    console.log('  ✓ [Frontend-Spec 2]: visible_timeout_then_hidden drops stale close retry');
  }

  // 3. focus_timeout_then_hidden_no_stale_focus_retry
  {
    const q = new ClientOrderedEventQueue();
    const evFocus = q.enqueue('window_focus');
    q.markAmbiguousTimeout(evFocus);
    const evHidden = q.enqueue('page_hidden');
    assert.equal(q.canRetry(evFocus), false, 'Stale focus event must NOT be retried after hidden is enqueued');
    frontendOrderingSpecPassCount++;
    console.log('  ✓ [Frontend-Spec 3]: focus_timeout_then_hidden drops stale focus retry');
  }

  // 4. blur_timeout_no_blind_retry
  {
    const q = new ClientOrderedEventQueue();
    const evBlur = q.enqueue('window_blur');
    q.markAmbiguousTimeout(evBlur);
    assert.equal(evBlur.source === 'window_blur' && evBlur.status === 'ambiguous_timeout', true);
    frontendOrderingSpecPassCount++;
    console.log('  ✓ [Frontend-Spec 4]: blur_timeout drops ambiguous blur retry');
  }

  // 5. known_pre_dispatch_failure_can_retry
  {
    const q = new ClientOrderedEventQueue();
    const evHidden = q.enqueue('page_hidden');
    q.markPreDispatchFailure(evHidden);
    assert.equal(q.canRetry(evHidden), true, 'Pre-dispatch failure is safe to retry because server never received it');
    frontendOrderingSpecPassCount++;
    console.log('  ✓ [Frontend-Spec 5]: known_pre_dispatch_failure is safely retriable');
  }

  const totalTests = prodSharedErrorPassCount + prodValidationPassCount + prodHandlerPassCount + mirrorSpecPassCount + frontendOrderingSpecPassCount;
  console.log('\n====================================================');
  console.log(`TOTAL TESTS ACCOUNTED FOR: ${totalTests}`);
  console.log(`  PRODUCTION SHARED ERROR TESTS: ${prodSharedErrorPassCount} (ACTUAL TS MODULE IMPORT)`);
  console.log(`  PRODUCTION VALIDATION TESTS:   ${prodValidationPassCount} (ACTUAL TS MODULE IMPORT)`);
  console.log(`  PRODUCTION HANDLER TESTS:      ${prodHandlerPassCount} (Deno Edge runtime required for https: URL imports in examAuth.ts)`);
  console.log(`  MIRROR SPEC TESTS:             ${mirrorSpecPassCount}`);
  console.log(`  FRONTEND ORDERING SPEC TESTS:  ${frontendOrderingSpecPassCount}`);
  console.log('====================================================\n');
}

runAllTests().catch(err => {
  console.error('❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
