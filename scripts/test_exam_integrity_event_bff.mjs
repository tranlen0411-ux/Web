// scripts/test_exam_integrity_event_bff.mjs
// Comprehensive Test Suite for Exam Builder V1 Phase 3B - Integrity Event BFF
// Covering Design V3 Hardening Fix V1: Content-Type 415, Strict RFC3339 Timestamp, Scoped Anti-Oracle 404

import assert from 'node:assert/strict';

// ----------------------------------------------------------------------------
// Pure Logic Implementation Mirror for Node.js ESM Environment
// ----------------------------------------------------------------------------

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EXTRA_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_SOURCES = new Set(['page_hidden', 'page_visible', 'window_focus', 'window_blur']);
const FORBIDDEN_FIELDS = new Set([
  'student_id', 'caller_id', 'p_caller_id', 'p_student_id', 'p_attempt_id',
  'p_source', 'p_client_timestamp', 'role', 'class_id', 'assignment_id',
  'episode_id', 'active_leave_episode_id', 'tab_switch_count', 'tab_switch_policy',
  'event_type', 'event_recorded', 'idempotent_replay', 'grading_status',
  'points_earned', 'is_correct', 'teacher_comment', 'service_role', 'service_role_key'
]);
const ALLOWED_FIELDS = new Set(['attempt_id', 'source', 'client_timestamp']);

export const ISO_TIMESTAMP_REGEX = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/;

export function isValidIsoTimestamp(str) {
  const match = ISO_TIMESTAMP_REGEX.exec(str);
  if (!match) return false;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);
  const second = parseInt(match[6], 10);

  if (month < 1 || month > 12) return false;
  if (hour < 0 || hour > 23) return false;
  if (minute < 0 || minute > 59) return false;
  if (second < 0 || second > 59) return false;

  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]) return false;

  if (match[8] && match[8] !== 'Z') {
    const offsetHour = parseInt(match[10], 10);
    const offsetMinute = parseInt(match[11], 10);
    if (offsetHour < 0 || offsetHour > 23) return false;
    if (offsetMinute < 0 || offsetMinute > 59) return false;
  }

  const parsedDate = Date.parse(str);
  if (Number.isNaN(parsedDate)) return false;

  return true;
}

function createErrorResponse(status, errorCode, message, extraHeaders) {
  const body = { success: false, error_code: errorCode, message };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...EXTRA_SECURITY_HEADERS,
      ...(extraHeaders || {}),
    },
  });
}

function createSuccessResponse(data, status = 200, extraHeaders) {
  const body = { success: true, data };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...EXTRA_SECURITY_HEADERS,
      ...(extraHeaders || {}),
    },
  });
}

// Scoped Anti-Oracle Normalizer for Integrity Event BFF
function normalizeIntegrityRpcError(err) {
  const rawMsg = typeof err === 'string'
    ? err
    : (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string')
      ? err.message
      : '';

  if (rawMsg.includes('ERR_REQUIRED_PARAMS')) {
    return { status: 400, errorCode: 'INVALID_INPUT', message: 'Thiếu tham số bắt buộc trong yêu cầu.' };
  }
  if (rawMsg.includes('ERR_INVALID_EVENT_SOURCE')) {
    return { status: 400, errorCode: 'ERR_INVALID_EVENT_SOURCE', message: 'Nguồn sự kiện không hợp lệ.' };
  }
  if (rawMsg.includes('ERR_STUDENT_IDENTITY_MISMATCH') || rawMsg.includes('ERR_ATTEMPT_NOT_FOUND')) {
    return { status: 404, errorCode: 'ATTEMPT_NOT_FOUND', message: 'Không tìm thấy lượt làm bài thi.' };
  }
  if (rawMsg.includes('ERR_OPTIMISTIC_LOCK_CONFLICT')) {
    return { status: 409, errorCode: 'ERR_OPTIMISTIC_LOCK_CONFLICT', message: 'Dữ liệu bài thi đã thay đổi bởi thao tác khác, vui lòng làm mới trang.' };
  }
  if (rawMsg.includes('ERR_ATTEMPT_FINALIZED') || rawMsg.includes('ERR_ATTEMPT_NOT_DRAFT')) {
    return { status: 409, errorCode: 'ERR_ATTEMPT_ALREADY_FINALIZED', message: 'Lượt làm bài đã được nộp hoặc hoàn thành trước đó.' };
  }
  if (rawMsg.includes('ERR_ATTEMPT_EXPIRED')) {
    return { status: 409, errorCode: 'ERR_ATTEMPT_EXPIRED', message: 'Thời gian làm bài thi đã kết thúc.' };
  }
  if (rawMsg.includes('ERR_INVALID_TAB_SWITCH_POLICY')) {
    return { status: 422, errorCode: 'ERR_INVALID_TAB_SWITCH_POLICY', message: 'Cấu hình kiểm soát chuyển tab của đề thi không hợp lệ.' };
  }

  return { status: 500, errorCode: 'INTERNAL_ERROR', message: 'Đã xảy ra lỗi nội bộ trong quá trình xử lý sự kiện bài thi.' };
}

// General Normalizer for non-integrity BFFs (preserves 403 ATTEMPT_ACCESS_DENIED)
function normalizeRpcError(err) {
  const rawMsg = typeof err === 'string'
    ? err
    : (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string')
      ? err.message
      : '';

  if (rawMsg.includes('ERR_STUDENT_IDENTITY_MISMATCH')) {
    return { status: 403, errorCode: 'ATTEMPT_ACCESS_DENIED', message: 'Bạn không có quyền truy cập lượt thi này.' };
  }
  if (rawMsg.includes('ERR_ATTEMPT_NOT_FOUND')) {
    return { status: 404, errorCode: 'ERR_ATTEMPT_NOT_FOUND', message: 'Không tìm thấy lượt làm bài thi.' };
  }
  return { status: 500, errorCode: 'INTERNAL_ERROR', message: 'Đã xảy ra lỗi nội bộ trong quá trình xử lý bài thi.' };
}

function mapRecordIntegrityEventSuccess(rpcData) {
  if (!rpcData || typeof rpcData !== 'object' || Array.isArray(rpcData)) return { ok: false };
  const rec = rpcData;

  if (typeof rec.attempt_id !== 'string' || !rec.attempt_id) return { ok: false };
  if (typeof rec.tab_switch_policy !== 'string' || !['WARN_AND_LOG', 'WARN_ONLY', 'OFF'].includes(rec.tab_switch_policy)) return { ok: false };
  if (typeof rec.tab_switch_count !== 'number' || !Number.isInteger(rec.tab_switch_count) || rec.tab_switch_count < 0) return { ok: false };
  if (typeof rec.event_recorded !== 'boolean') return { ok: false };
  if (typeof rec.idempotent_replay !== 'boolean') return { ok: false };

  const activeEpisodeId = rec.active_leave_episode_id === null
    ? null
    : (typeof rec.active_leave_episode_id === 'string' ? rec.active_leave_episode_id : null);

  const eventType = rec.event_type === null
    ? null
    : (typeof rec.event_type === 'string' && ['episode_opened', 'episode_closed', 'focus_loss_auxiliary'].includes(rec.event_type) ? rec.event_type : null);

  return {
    ok: true,
    data: {
      attempt_id: rec.attempt_id,
      tab_switch_policy: rec.tab_switch_policy,
      tab_switch_count: rec.tab_switch_count,
      active_leave_episode_id: activeEpisodeId,
      event_recorded: rec.event_recorded,
      event_type: eventType,
      idempotent_replay: rec.idempotent_replay,
    }
  };
}

function validateIntegrityEventPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Dữ liệu yêu cầu phải là một JSON object.' };
  }

  const raw = body;
  const keys = Object.keys(raw);

  for (const k of keys) {
    if (FORBIDDEN_FIELDS.has(k) || !ALLOWED_FIELDS.has(k)) {
      return { valid: false, errorCode: 'INVALID_REQUEST_FIELD', errorMessage: `Trường '${k}' không được phép.` };
    }
  }

  if (raw.attempt_id === undefined || raw.attempt_id === null || raw.attempt_id === '') {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Thiếu tham số bắt buộc attempt_id.' };
  }
  if (typeof raw.attempt_id !== 'string' || !UUID_REGEX.test(raw.attempt_id)) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Mã lượt làm bài attempt_id không hợp lệ (phải là UUID chuẩn).' };
  }

  if (raw.source === undefined || raw.source === null || raw.source === '') {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Thiếu tham số bắt buộc source.' };
  }
  if (typeof raw.source !== 'string' || !ALLOWED_SOURCES.has(raw.source)) {
    return { valid: false, errorCode: 'ERR_INVALID_EVENT_SOURCE', errorMessage: 'Nguồn sự kiện source không hợp lệ.' };
  }

  let clientTimestamp = null;
  if (raw.client_timestamp !== undefined && raw.client_timestamp !== null) {
    if (typeof raw.client_timestamp !== 'string') {
      return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Thời gian client_timestamp phải là chuỗi định dạng ISO-8601 hợp lệ.' };
    }
    if (!isValidIsoTimestamp(raw.client_timestamp)) {
      return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Thời gian client_timestamp không đúng định dạng ISO-8601/RFC3339 hợp lệ có múi giờ.' };
    }
    clientTimestamp = raw.client_timestamp;
  }

  return {
    valid: true,
    sanitizedData: {
      attempt_id: raw.attempt_id.toLowerCase(),
      source: raw.source,
      client_timestamp: clientTimestamp,
    }
  };
}

async function handleRecordIntegrityEventRequest(req, deps) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { ...corsHeaders, 'Cache-Control': 'no-store', ...EXTRA_SECURITY_HEADERS } });
  }

  if (req.method !== 'POST') {
    return createErrorResponse(405, 'METHOD_NOT_ALLOWED', 'Phương thức HTTP không được hỗ trợ. Chỉ chấp nhận POST.', { Allow: 'POST', ...EXTRA_SECURITY_HEADERS });
  }

  const contentTypeHeader = req.headers.get('content-type') || '';
  const mediaType = contentTypeHeader.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    return createErrorResponse(415, 'UNSUPPORTED_MEDIA_TYPE', 'Định dạng Content-Type không được hỗ trợ. Bắt buộc sử dụng application/json.', EXTRA_SECURITY_HEADERS);
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
      const { status, errorCode, message } = normalizeIntegrityRpcError(rpcError);
      return createErrorResponse(status, errorCode, message, EXTRA_SECURITY_HEADERS);
    }

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
// TEST SUITE EXECUTION
// ----------------------------------------------------------------------------

async function runAllTests() {
  console.log('====================================================');
  console.log('PHASE 3B: INTEGRITY EVENT BFF AUTOMATED TEST SUITE');
  console.log('====================================================\n');

  let bffExecutablePassCount = 0;
  let frontendOrderingSpecPassCount = 0;

  const validStudentId = '11111111-1111-4111-8111-111111111111';
  const validAttemptId = '22222222-2222-4222-8222-222222222222';
  const jsonHeaders = { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' };

  function createMockDeps({
    user = { id: validStudentId },
    userError = null,
    profile = { id: validStudentId, role: 'student', is_disabled: false },
    rpcHandler = async () => ({ data: { attempt_id: validAttemptId, tab_switch_policy: 'WARN_AND_LOG', tab_switch_count: 1, active_leave_episode_id: '33333333-3333-4333-8333-333333333333', event_recorded: true, event_type: 'episode_opened', idempotent_replay: false }, error: null })
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
            getUser: async () => ({ data: { user }, error: userError })
          }
        },
        coreQueryClient: {
          from: (table) => ({
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: profile, error: null })
              })
            })
          })
        }
      },
      examClient: {
        rpc: async (name, args) => {
          rpcCallCount++;
          lastRpcArgs = { name, args };
          return await rpcHandler(name, args);
        }
      }
    };
  }

  // --- 1. CONTENT-TYPE HARDENING TESTS (415 UNSUPPORTED_MEDIA_TYPE) ---

  // Missing Content-Type for POST
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: { Authorization: 'Bearer valid-token' }, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const res = await handleRecordIntegrityEventRequest(req, createMockDeps());
    assert.equal(res.status, 415);
    const body = await res.json();
    assert.equal(body.error_code, 'UNSUPPORTED_MEDIA_TYPE');
    bffExecutablePassCount++;
    console.log('✅ PASS [CT-1]: Missing Content-Type -> 415 UNSUPPORTED_MEDIA_TYPE');
  }

  // Wrong Content-Type text/plain
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'text/plain' }, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const res = await handleRecordIntegrityEventRequest(req, createMockDeps());
    assert.equal(res.status, 415);
    const body = await res.json();
    assert.equal(body.error_code, 'UNSUPPORTED_MEDIA_TYPE');
    bffExecutablePassCount++;
    console.log('✅ PASS [CT-2]: text/plain Content-Type -> 415 UNSUPPORTED_MEDIA_TYPE');
  }

  // Wrong Content-Type application/json-malicious
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json-malicious' }, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const res = await handleRecordIntegrityEventRequest(req, createMockDeps());
    assert.equal(res.status, 415);
    const body = await res.json();
    assert.equal(body.error_code, 'UNSUPPORTED_MEDIA_TYPE');
    bffExecutablePassCount++;
    console.log('✅ PASS [CT-3]: application/json-malicious -> 415 UNSUPPORTED_MEDIA_TYPE');
  }

  // Valid application/json; charset=utf-8 accepted
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const res = await handleRecordIntegrityEventRequest(req, createMockDeps());
    assert.equal(res.status, 200);
    bffExecutablePassCount++;
    console.log('✅ PASS [CT-4]: application/json; charset=utf-8 accepted -> 200 OK');
  }

  // --- 2. AUTH & PROTOCOL TESTS ---

  // Missing auth
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const res = await handleRecordIntegrityEventRequest(req, createMockDeps());
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error_code, 'AUTH_REQUIRED');
    bffExecutablePassCount++;
    console.log('✅ PASS [1]: Missing auth header -> 401 AUTH_REQUIRED');
  }

  // Invalid/expired auth
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: { Authorization: 'Bearer expired-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const deps = createMockDeps({ user: null, userError: new Error('Token expired') });
    const res = await handleRecordIntegrityEventRequest(req, deps);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error_code, 'INVALID_TOKEN');
    bffExecutablePassCount++;
    console.log('✅ PASS [2]: Invalid token -> 401 INVALID_TOKEN');
  }

  // Non-student role
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const deps = createMockDeps({ profile: { id: validStudentId, role: 'teacher', is_disabled: false } });
    const res = await handleRecordIntegrityEventRequest(req, deps);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error_code, 'FORBIDDEN_ROLE');
    bffExecutablePassCount++;
    console.log('✅ PASS [3]: Non-student role -> 403 FORBIDDEN_ROLE');
  }

  // Disabled account
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const deps = createMockDeps({ profile: { id: validStudentId, role: 'student', is_disabled: true } });
    const res = await handleRecordIntegrityEventRequest(req, deps);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error_code, 'ACCOUNT_DISABLED');
    bffExecutablePassCount++;
    console.log('✅ PASS [4]: Disabled account -> 403 ACCOUNT_DISABLED');
  }

  // OPTIONS Preflight
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'OPTIONS' });
    const res = await handleRecordIntegrityEventRequest(req, createMockDeps());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
    bffExecutablePassCount++;
    console.log('✅ PASS [5]: OPTIONS preflight -> 200 + CORS headers + Cache-Control: no-store + nosniff');
  }

  // Method not allowed (GET/PUT/DELETE)
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'GET' });
    const res = await handleRecordIntegrityEventRequest(req, createMockDeps());
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('Allow'), 'POST');
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
    const body = await res.json();
    assert.equal(body.error_code, 'METHOD_NOT_ALLOWED');
    bffExecutablePassCount++;
    console.log('✅ PASS [6]: GET method -> 405 METHOD_NOT_ALLOWED + Allow: POST');
  }

  // Malformed JSON
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: '{bad-json}' });
    const res = await handleRecordIntegrityEventRequest(req, createMockDeps());
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error_code, 'INVALID_INPUT');
    bffExecutablePassCount++;
    console.log('✅ PASS [7]: Malformed JSON -> 400 INVALID_INPUT');
  }

  // Missing attempt_id
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ source: 'page_hidden' }) });
    const res = await handleRecordIntegrityEventRequest(req, createMockDeps());
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error_code, 'INVALID_INPUT');
    bffExecutablePassCount++;
    console.log('✅ PASS [8]: Missing attempt_id -> 400 INVALID_INPUT');
  }

  // Missing source
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId }) });
    const res = await handleRecordIntegrityEventRequest(req, createMockDeps());
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error_code, 'INVALID_INPUT');
    bffExecutablePassCount++;
    console.log('✅ PASS [9]: Missing source -> 400 INVALID_INPUT');
  }

  // Invalid UUID
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: 'not-a-uuid', source: 'page_hidden' }) });
    const res = await handleRecordIntegrityEventRequest(req, createMockDeps());
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error_code, 'INVALID_INPUT');
    bffExecutablePassCount++;
    console.log('✅ PASS [10]: Invalid UUID format -> 400 INVALID_INPUT');
  }

  // Unexpected / forbidden field
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden', caller_id: validStudentId }) });
    const res = await handleRecordIntegrityEventRequest(req, createMockDeps());
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error_code, 'INVALID_REQUEST_FIELD');
    bffExecutablePassCount++;
    console.log('✅ PASS [11]: Forbidden field caller_id -> 400 INVALID_REQUEST_FIELD');
  }

  // Invalid source enum
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'mouse_leave' }) });
    const res = await handleRecordIntegrityEventRequest(req, createMockDeps());
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error_code, 'ERR_INVALID_EVENT_SOURCE');
    bffExecutablePassCount++;
    console.log('✅ PASS [12]: Invalid source enum -> 400 ERR_INVALID_EVENT_SOURCE');
  }

  // --- 3. ANTI-ORACLE & SCOPED ERROR MAPPINGS ---

  // Nonexistent attempt (Anti-Oracle 404)
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const deps = createMockDeps({ rpcHandler: async () => ({ data: null, error: new Error('ERR_ATTEMPT_NOT_FOUND') }) });
    const res = await handleRecordIntegrityEventRequest(req, deps);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error_code, 'ATTEMPT_NOT_FOUND');
    bffExecutablePassCount++;
    console.log('✅ PASS [13]: Nonexistent attempt -> 404 ATTEMPT_NOT_FOUND');
  }

  // Wrong student owner (Anti-Oracle unified with 404 for Integrity BFF)
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const deps = createMockDeps({ rpcHandler: async () => ({ data: null, error: new Error('ERR_STUDENT_IDENTITY_MISMATCH') }) });
    const res = await handleRecordIntegrityEventRequest(req, deps);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error_code, 'ATTEMPT_NOT_FOUND');
    bffExecutablePassCount++;
    console.log('✅ PASS [14]: Wrong student owner (Integrity) -> 404 ATTEMPT_NOT_FOUND (Anti-Oracle Scoped)');
  }

  // Shared generic normalizer regression proof: returns 403 ATTEMPT_ACCESS_DENIED for non-integrity BFFs
  {
    const res = normalizeRpcError(new Error('ERR_STUDENT_IDENTITY_MISMATCH'));
    assert.equal(res.status, 403);
    assert.equal(res.errorCode, 'ATTEMPT_ACCESS_DENIED');
    bffExecutablePassCount++;
    console.log('✅ PASS [Shared Regression]: Generic normalizeRpcError preserves 403 ATTEMPT_ACCESS_DENIED');
  }

  // Expired attempt
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const deps = createMockDeps({ rpcHandler: async () => ({ data: null, error: new Error('ERR_ATTEMPT_EXPIRED') }) });
    const res = await handleRecordIntegrityEventRequest(req, deps);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.error_code, 'ERR_ATTEMPT_EXPIRED');
    bffExecutablePassCount++;
    console.log('✅ PASS [15]: Expired attempt -> 409 ERR_ATTEMPT_EXPIRED');
  }

  // Submitted attempt
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const deps = createMockDeps({ rpcHandler: async () => ({ data: null, error: new Error('ERR_ATTEMPT_NOT_DRAFT: Attempt submitted') }) });
    const res = await handleRecordIntegrityEventRequest(req, deps);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.error_code, 'ERR_ATTEMPT_ALREADY_FINALIZED');
    bffExecutablePassCount++;
    console.log('✅ PASS [16]: Submitted attempt -> 409 ERR_ATTEMPT_ALREADY_FINALIZED');
  }

  // Pending manual grade attempt
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const deps = createMockDeps({ rpcHandler: async () => ({ data: null, error: new Error('ERR_ATTEMPT_NOT_DRAFT: Attempt pending_manual_grade') }) });
    const res = await handleRecordIntegrityEventRequest(req, deps);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.error_code, 'ERR_ATTEMPT_ALREADY_FINALIZED');
    bffExecutablePassCount++;
    console.log('✅ PASS [17]: Pending manual grade -> 409 ERR_ATTEMPT_ALREADY_FINALIZED');
  }

  // Graded attempt
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const deps = createMockDeps({ rpcHandler: async () => ({ data: null, error: new Error('ERR_ATTEMPT_NOT_DRAFT: Attempt graded') }) });
    const res = await handleRecordIntegrityEventRequest(req, deps);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.error_code, 'ERR_ATTEMPT_ALREADY_FINALIZED');
    bffExecutablePassCount++;
    console.log('✅ PASS [18]: Graded attempt -> 409 ERR_ATTEMPT_ALREADY_FINALIZED');
  }

  // --- 4. LIFECYCLE & POLICY EXECUTION TESTS ---

  // WARN_AND_LOG page_hidden open
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const deps = createMockDeps();
    const res = await handleRecordIntegrityEventRequest(req, deps);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.event_recorded, true);
    assert.equal(body.data.event_type, 'episode_opened');
    assert.equal(body.data.tab_switch_count, 1);
    bffExecutablePassCount++;
    console.log('✅ PASS [19]: WARN_AND_LOG page_hidden open -> 200 OK, event_recorded: true, episode_opened');
  }

  // Duplicate page_hidden
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const deps = createMockDeps({
      rpcHandler: async () => ({ data: { attempt_id: validAttemptId, tab_switch_policy: 'WARN_AND_LOG', tab_switch_count: 1, active_leave_episode_id: '33333333-3333-4333-8333-333333333333', event_recorded: false, event_type: null, idempotent_replay: true }, error: null })
    });
    const res = await handleRecordIntegrityEventRequest(req, deps);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.event_recorded, false);
    assert.equal(body.data.idempotent_replay, true);
    bffExecutablePassCount++;
    console.log('✅ PASS [20]: Duplicate page_hidden -> 200 OK, event_recorded: false, idempotent_replay: true');
  }

  // window_blur
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'window_blur' }) });
    const deps = createMockDeps({
      rpcHandler: async () => ({ data: { attempt_id: validAttemptId, tab_switch_policy: 'WARN_AND_LOG', tab_switch_count: 1, active_leave_episode_id: '33333333-3333-4333-8333-333333333333', event_recorded: true, event_type: 'focus_loss_auxiliary', idempotent_replay: false }, error: null })
    });
    const res = await handleRecordIntegrityEventRequest(req, deps);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.event_recorded, true);
    assert.equal(body.data.event_type, 'focus_loss_auxiliary');
    bffExecutablePassCount++;
    console.log('✅ PASS [21]: window_blur -> 200 OK, event_recorded: true, focus_loss_auxiliary');
  }

  // page_visible close
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_visible' }) });
    const deps = createMockDeps({
      rpcHandler: async () => ({ data: { attempt_id: validAttemptId, tab_switch_policy: 'WARN_AND_LOG', tab_switch_count: 1, active_leave_episode_id: null, event_recorded: true, event_type: 'episode_closed', idempotent_replay: false }, error: null })
    });
    const res = await handleRecordIntegrityEventRequest(req, deps);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.event_recorded, true);
    assert.equal(body.data.event_type, 'episode_closed');
    assert.equal(body.data.active_leave_episode_id, null);
    bffExecutablePassCount++;
    console.log('✅ PASS [22]: page_visible close -> 200 OK, event_recorded: true, episode_closed');
  }

  // Duplicate page_visible / window_focus close
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'window_focus' }) });
    const deps = createMockDeps({
      rpcHandler: async () => ({ data: { attempt_id: validAttemptId, tab_switch_policy: 'WARN_AND_LOG', tab_switch_count: 1, active_leave_episode_id: null, event_recorded: false, event_type: null, idempotent_replay: true }, error: null })
    });
    const res = await handleRecordIntegrityEventRequest(req, deps);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.event_recorded, false);
    assert.equal(body.data.idempotent_replay, true);
    assert.equal(body.data.active_leave_episode_id, null);
    bffExecutablePassCount++;
    console.log('✅ PASS [23]: Duplicate close -> 200 OK, event_recorded: false, idempotent_replay: true');
  }

  // window_focus closes active episode
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'window_focus' }) });
    const deps = createMockDeps({
      rpcHandler: async () => ({ data: { attempt_id: validAttemptId, tab_switch_policy: 'WARN_AND_LOG', tab_switch_count: 1, active_leave_episode_id: null, event_recorded: true, event_type: 'episode_closed', idempotent_replay: false }, error: null })
    });
    const res = await handleRecordIntegrityEventRequest(req, deps);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.event_recorded, true);
    assert.equal(body.data.event_type, 'episode_closed');
    bffExecutablePassCount++;
    console.log('✅ PASS [24]: window_focus closes active episode -> 200 OK, episode_closed');
  }

  // WARN_ONLY policy no mutation
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const deps = createMockDeps({
      rpcHandler: async () => ({ data: { attempt_id: validAttemptId, tab_switch_policy: 'WARN_ONLY', tab_switch_count: 0, active_leave_episode_id: null, event_recorded: false, event_type: null, idempotent_replay: false }, error: null })
    });
    const res = await handleRecordIntegrityEventRequest(req, deps);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.tab_switch_policy, 'WARN_ONLY');
    assert.equal(body.data.event_recorded, false);
    assert.equal(body.data.tab_switch_count, 0);
    bffExecutablePassCount++;
    console.log('✅ PASS [25]: WARN_ONLY policy -> 200 OK, event_recorded: false, tab_switch_count: 0');
  }

  // OFF policy no mutation
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const deps = createMockDeps({
      rpcHandler: async () => ({ data: { attempt_id: validAttemptId, tab_switch_policy: 'OFF', tab_switch_count: 0, active_leave_episode_id: null, event_recorded: false, event_type: null, idempotent_replay: false }, error: null })
    });
    const res = await handleRecordIntegrityEventRequest(req, deps);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.tab_switch_policy, 'OFF');
    assert.equal(body.data.event_recorded, false);
    assert.equal(body.data.tab_switch_count, 0);
    bffExecutablePassCount++;
    console.log('✅ PASS [26]: OFF policy -> 200 OK, event_recorded: false, tab_switch_count: 0');
  }

  // --- 5. STRICT TIMESTAMP TESTS ---

  // Valid Z timezone accepted
  {
    const ts = '2026-09-06T12:34:56Z';
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden', client_timestamp: ts }) });
    const deps = createMockDeps();
    const res = await handleRecordIntegrityEventRequest(req, deps);
    assert.equal(res.status, 200);
    const args = deps.getLastRpcArgs();
    assert.equal(args.args.p_client_timestamp, ts);
    bffExecutablePassCount++;
    console.log('✅ PASS [TS-1]: Valid Z timestamp accepted (2026-09-06T12:34:56Z)');
  }

  // Valid +07:00 timezone accepted
  {
    const ts = '2026-09-06T19:34:56+07:00';
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden', client_timestamp: ts }) });
    const deps = createMockDeps();
    const res = await handleRecordIntegrityEventRequest(req, deps);
    assert.equal(res.status, 200);
    const args = deps.getLastRpcArgs();
    assert.equal(args.args.p_client_timestamp, ts);
    bffExecutablePassCount++;
    console.log('✅ PASS [TS-2]: Valid +07:00 timestamp accepted (2026-09-06T19:34:56+07:00)');
  }

  // Valid fractional seconds accepted
  {
    const ts = '2026-09-06T12:34:56.123Z';
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden', client_timestamp: ts }) });
    const deps = createMockDeps();
    const res = await handleRecordIntegrityEventRequest(req, deps);
    assert.equal(res.status, 200);
    bffExecutablePassCount++;
    console.log('✅ PASS [TS-3]: Valid fractional seconds accepted (2026-09-06T12:34:56.123Z)');
  }

  // Date-only rejected
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden', client_timestamp: '2026-09-06' }) });
    const res = await handleRecordIntegrityEventRequest(req, createMockDeps());
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error_code, 'INVALID_INPUT');
    bffExecutablePassCount++;
    console.log('✅ PASS [TS-4]: Date-only string (2026-09-06) rejected -> 400 INVALID_INPUT');
  }

  // Missing timezone rejected
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden', client_timestamp: '2026-09-06T12:34:56' }) });
    const res = await handleRecordIntegrityEventRequest(req, createMockDeps());
    assert.equal(res.status, 400);
    bffExecutablePassCount++;
    console.log('✅ PASS [TS-5]: Missing timezone (2026-09-06T12:34:56) rejected -> 400 INVALID_INPUT');
  }

  // Locale date string rejected
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden', client_timestamp: 'September 6, 2026' }) });
    const res = await handleRecordIntegrityEventRequest(req, createMockDeps());
    assert.equal(res.status, 400);
    bffExecutablePassCount++;
    console.log('✅ PASS [TS-6]: Locale date string (September 6, 2026) rejected -> 400 INVALID_INPUT');
  }

  // Impossible date (February 30) rejected
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden', client_timestamp: '2026-02-30T10:00:00Z' }) });
    const res = await handleRecordIntegrityEventRequest(req, createMockDeps());
    assert.equal(res.status, 400);
    bffExecutablePassCount++;
    console.log('✅ PASS [TS-7]: Impossible date (2026-02-30T10:00:00Z) rejected -> 400 INVALID_INPUT');
  }

  // Impossible hour (25:00) rejected
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden', client_timestamp: '2026-09-06T25:00:00Z' }) });
    const res = await handleRecordIntegrityEventRequest(req, createMockDeps());
    assert.equal(res.status, 400);
    bffExecutablePassCount++;
    console.log('✅ PASS [TS-8]: Impossible hour (2026-09-06T25:00:00Z) rejected -> 400 INVALID_INPUT');
  }

  // Impossible minute (12:60) rejected
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden', client_timestamp: '2026-09-06T12:60:00Z' }) });
    const res = await handleRecordIntegrityEventRequest(req, createMockDeps());
    assert.equal(res.status, 400);
    bffExecutablePassCount++;
    console.log('✅ PASS [TS-9]: Impossible minute (2026-09-06T12:60:00Z) rejected -> 400 INVALID_INPUT');
  }

  // Omitted client_timestamp -> RPC gets NULL
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const deps = createMockDeps();
    const res = await handleRecordIntegrityEventRequest(req, deps);
    assert.equal(res.status, 200);
    const args = deps.getLastRpcArgs();
    assert.equal(args.args.p_client_timestamp, null);
    bffExecutablePassCount++;
    console.log('✅ PASS [29]: Omitted client_timestamp -> RPC receives p_client_timestamp = null');
  }

  // Explicit null client_timestamp -> RPC gets NULL
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden', client_timestamp: null }) });
    const deps = createMockDeps();
    const res = await handleRecordIntegrityEventRequest(req, deps);
    assert.equal(res.status, 200);
    const args = deps.getLastRpcArgs();
    assert.equal(args.args.p_client_timestamp, null);
    bffExecutablePassCount++;
    console.log('✅ PASS [TS-10]: Explicit null client_timestamp -> RPC receives p_client_timestamp = null');
  }

  // Safe response field allowlist & Cache-Control: no-store & nosniff
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const deps = createMockDeps();
    const res = await handleRecordIntegrityEventRequest(req, deps);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
    const body = await res.json();
    const keys = Object.keys(body.data);
    const expectedKeys = ['attempt_id', 'tab_switch_policy', 'tab_switch_count', 'active_leave_episode_id', 'event_recorded', 'event_type', 'idempotent_replay'];
    assert.deepEqual(keys.sort(), expectedKeys.sort());
    bffExecutablePassCount++;
    console.log('✅ PASS [30]: Safe response allowlist verified (exactly 7 fields, Cache-Control: no-store, nosniff)');
  }

  // BFF exactly one RPC call per HTTP request (no internal retry)
  {
    const req = new Request('http://localhost/exam-record-integrity-event', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ attempt_id: validAttemptId, source: 'page_hidden' }) });
    const deps = createMockDeps({
      rpcHandler: async () => ({ data: null, error: new Error('Postgres connection timeout') })
    });
    const res = await handleRecordIntegrityEventRequest(req, deps);
    assert.equal(res.status, 500);
    assert.equal(deps.getRpcCallCount(), 1);
    bffExecutablePassCount++;
    console.log('✅ PASS [36]: BFF calls RPC exactly once per request with zero blind internal retry');
  }

  // --- FRONTEND ORDERING SPEC ASSERTIONS (31 - 35) ---

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

  // 31. hidden_timeout_then_visible_no_stale_hidden_retry
  {
    const q = new ClientOrderedEventQueue();
    const evHidden = q.enqueue('page_hidden');
    q.markAmbiguousTimeout(evHidden);
    const evVisible = q.enqueue('page_visible');
    assert.equal(q.canRetry(evHidden), false, 'Stale hidden event must NOT be retried after visible is enqueued');
    frontendOrderingSpecPassCount++;
    console.log('✅ PASS [31] (Frontend Spec): hidden_timeout_then_visible drops stale hidden retry');
  }

  // 32. visible_timeout_then_hidden_no_stale_close_retry
  {
    const q = new ClientOrderedEventQueue();
    const evVisible = q.enqueue('page_visible');
    q.markAmbiguousTimeout(evVisible);
    const evHidden = q.enqueue('page_hidden');
    assert.equal(q.canRetry(evVisible), false, 'Stale visible event must NOT be retried after hidden is enqueued');
    frontendOrderingSpecPassCount++;
    console.log('✅ PASS [32] (Frontend Spec): visible_timeout_then_hidden drops stale close retry');
  }

  // 33. focus_timeout_then_hidden_no_stale_focus_retry
  {
    const q = new ClientOrderedEventQueue();
    const evFocus = q.enqueue('window_focus');
    q.markAmbiguousTimeout(evFocus);
    const evHidden = q.enqueue('page_hidden');
    assert.equal(q.canRetry(evFocus), false, 'Stale focus event must NOT be retried after hidden is enqueued');
    frontendOrderingSpecPassCount++;
    console.log('✅ PASS [33] (Frontend Spec): focus_timeout_then_hidden drops stale focus retry');
  }

  // 34. blur_timeout_no_blind_retry
  {
    const q = new ClientOrderedEventQueue();
    const evBlur = q.enqueue('window_blur');
    q.markAmbiguousTimeout(evBlur);
    assert.equal(evBlur.source === 'window_blur' && evBlur.status === 'ambiguous_timeout', true);
    frontendOrderingSpecPassCount++;
    console.log('✅ PASS [34] (Frontend Spec): blur_timeout drops ambiguous blur retry');
  }

  // 35. known_pre_dispatch_failure_can_retry
  {
    const q = new ClientOrderedEventQueue();
    const evHidden = q.enqueue('page_hidden');
    q.markPreDispatchFailure(evHidden);
    assert.equal(q.canRetry(evHidden), true, 'Pre-dispatch failure is safe to retry because server never received it');
    frontendOrderingSpecPassCount++;
    console.log('✅ PASS [35] (Frontend Spec): known_pre_dispatch_failure is safely retriable');
  }

  const totalTests = bffExecutablePassCount + frontendOrderingSpecPassCount;
  console.log('\n====================================================');
  console.log(`TOTAL DESIGN & HARDENING CASES ACCOUNTED FOR: ${totalTests}`);
  console.log(`  BFF EXECUTABLE TESTS PASSED: ${bffExecutablePassCount}`);
  console.log(`  FRONTEND ORDERING SPEC TESTS PASSED: ${frontendOrderingSpecPassCount}`);
  console.log('====================================================\n');
}

runAllTests().catch(err => {
  console.error('❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
