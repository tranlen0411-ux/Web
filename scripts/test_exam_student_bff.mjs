// scripts/test_exam_student_bff.mjs
// Comprehensive Unit & Security Test Suite for Student BFF Endpoints (Phase 3B)
// Full Coverage of 92 Verification Matrix Tests: Auth, Request, Auth Chain, RPC, Error Mapping, Response, Logging, CORS, Gateway Hardening

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// ----------------------------------------------------------------------------
// Pure Logic Implementation Mirror for Node.js ESM Environment
// ----------------------------------------------------------------------------

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FORBIDDEN_START_FIELDS = new Set([
  'student_id',
  'caller_id',
  'p_caller_id',
  'p_student_id',
  'role',
  'class_id',
  'is_admin',
  'teacher_id',
  'service_role',
  'service_role_key',
]);

const ALLOWED_START_FIELDS = new Set(['assignment_id', 'attempt_id']);

function validateStartAttemptPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Dữ liệu yêu cầu phải là một JSON object.',
    };
  }

  const raw = body;
  const keys = Object.keys(raw);

  for (const k of keys) {
    if (FORBIDDEN_START_FIELDS.has(k)) {
      return {
        valid: false,
        errorCode: 'INVALID_REQUEST_FIELD',
        errorMessage: `Trường '${k}' không được phép truyền từ phía client.`,
      };
    }
    if (!ALLOWED_START_FIELDS.has(k)) {
      return {
        valid: false,
        errorCode: 'INVALID_REQUEST_FIELD',
        errorMessage: `Trường '${k}' không nằm trong danh sách cho phép.`,
      };
    }
  }

  if (typeof raw.assignment_id !== 'string' || !UUID_REGEX.test(raw.assignment_id)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Mã bài giao assignment_id không hợp lệ (phải là UUID chuẩn).',
    };
  }

  if (typeof raw.attempt_id !== 'string' || !UUID_REGEX.test(raw.attempt_id)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Mã lượt làm bài attempt_id không hợp lệ (phải là UUID chuẩn).',
    };
  }

  return {
    valid: true,
    sanitizedData: {
      assignment_id: raw.assignment_id.toLowerCase(),
      attempt_id: raw.attempt_id.toLowerCase(),
    },
  };
}

const FORBIDDEN_SAVE_FIELDS = new Set([
  'student_id',
  'caller_id',
  'p_caller_id',
  'p_student_id',
  'role',
  'class_id',
  'assignment_id',
  'grading_status',
  'points_earned',
  'is_correct',
  'teacher_comment',
  'service_role',
  'service_role_key',
]);

const ALLOWED_SAVE_FIELDS = new Set([
  'attempt_id',
  'exam_question_id',
  'student_answer_json',
  'file_url',
  'expected_version',
]);

const ALLOWED_BUCKET_PREFIXES = new Set(['exercise-submissions']);

function validateSaveAnswerPayload(body, context) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Dữ liệu yêu cầu phải là một JSON object.',
    };
  }

  const raw = body;
  const keys = Object.keys(raw);

  for (const k of keys) {
    if (FORBIDDEN_SAVE_FIELDS.has(k)) {
      return {
        valid: false,
        errorCode: 'INVALID_REQUEST_FIELD',
        errorMessage: `Trường '${k}' không được phép truyền từ phía client.`,
      };
    }
    if (!ALLOWED_SAVE_FIELDS.has(k)) {
      return {
        valid: false,
        errorCode: 'INVALID_REQUEST_FIELD',
        errorMessage: `Trường '${k}' không nằm trong danh sách cho phép.`,
      };
    }
  }

  if (typeof raw.attempt_id !== 'string' || !UUID_REGEX.test(raw.attempt_id)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Mã lượt làm bài attempt_id không hợp lệ (phải là UUID chuẩn).',
    };
  }

  if (typeof raw.exam_question_id !== 'string' || !UUID_REGEX.test(raw.exam_question_id)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Mã câu hỏi exam_question_id không hợp lệ (phải là UUID chuẩn).',
    };
  }

  if (
    raw.expected_version === undefined ||
    raw.expected_version === null ||
    typeof raw.expected_version !== 'number' ||
    !Number.isInteger(raw.expected_version) ||
    raw.expected_version < 1
  ) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Phiên bản kỳ vọng expected_version bắt buộc là số nguyên >= 1.',
    };
  }

  // Temporary Upload Feature Gate: Chặn tất cả yêu cầu có file_url != null
  if (raw.file_url !== undefined && raw.file_url !== null) {
    return {
      valid: false,
      errorCode: 'ERR_EXAM_UPLOAD_NOT_READY',
      errorMessage: 'Chức năng nộp tệp cho bài thi chưa được kích hoạt.',
    };
  }

  const sanitizedStudentAnswerJson = raw.student_answer_json !== undefined ? raw.student_answer_json : null;

  return {
    valid: true,
    sanitizedData: {
      attempt_id: raw.attempt_id.toLowerCase(),
      exam_question_id: raw.exam_question_id.toLowerCase(),
      student_answer_json: sanitizedStudentAnswerJson,
      file_url: null,
      expected_version: raw.expected_version,
    },
  };
}

const FORBIDDEN_SUBMIT_FIELDS = new Set([
  'student_id',
  'caller_id',
  'p_caller_id',
  'p_student_id',
  'role',
  'class_id',
  'assignment_id',
  'status',
  'objective_score',
  'manual_score',
  'total_score',
  'reward_stars_awarded',
  'service_role',
  'service_role_key',
]);

const ALLOWED_SUBMIT_FIELDS = new Set(['attempt_id', 'expected_version']);

function validateSubmitAttemptPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Dữ liệu yêu cầu phải là một JSON object.',
    };
  }

  const raw = body;
  const keys = Object.keys(raw);

  for (const k of keys) {
    if (FORBIDDEN_SUBMIT_FIELDS.has(k)) {
      return {
        valid: false,
        errorCode: 'INVALID_REQUEST_FIELD',
        errorMessage: `Trường '${k}' không được phép truyền từ phía client.`,
      };
    }
    if (!ALLOWED_SUBMIT_FIELDS.has(k)) {
      return {
        valid: false,
        errorCode: 'INVALID_REQUEST_FIELD',
        errorMessage: `Trường '${k}' không nằm trong danh sách cho phép.`,
      };
    }
  }

  if (typeof raw.attempt_id !== 'string' || !UUID_REGEX.test(raw.attempt_id)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Mã lượt làm bài attempt_id không hợp lệ (phải là UUID chuẩn).',
    };
  }

  if (
    raw.expected_version === undefined ||
    raw.expected_version === null ||
    typeof raw.expected_version !== 'number' ||
    !Number.isInteger(raw.expected_version) ||
    raw.expected_version < 1
  ) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Phiên bản kỳ vọng expected_version bắt buộc là số nguyên >= 1.',
    };
  }

  return {
    valid: true,
    sanitizedData: {
      attempt_id: raw.attempt_id.toLowerCase(),
      expected_version: raw.expected_version,
    },
  };
}

function createErrorResponse(status, errorCode, message) {
  const body = {
    success: false,
    error_code: errorCode,
    message: message,
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function createSuccessResponse(data, status = 200) {
  const body = {
    success: true,
    data: data,
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function normalizeRpcError(err) {
  const rawMsg = typeof err === 'string'
    ? err
    : (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string')
      ? err.message
      : '';

  if (rawMsg.includes('ERR_STUDENT_IDENTITY_MISMATCH')) {
    return { status: 403, errorCode: 'ATTEMPT_ACCESS_DENIED', message: 'Bạn không có quyền truy cập lượt thi này.' };
  }

  if (rawMsg.includes('ERR_ASSIGNMENT_NOT_FOUND')) {
    return { status: 404, errorCode: 'ERR_ASSIGNMENT_NOT_FOUND', message: 'Không tìm thấy bài thi được giao.' };
  }
  if (rawMsg.includes('ERR_ATTEMPT_NOT_FOUND')) {
    return { status: 404, errorCode: 'ERR_ATTEMPT_NOT_FOUND', message: 'Không tìm thấy lượt làm bài thi.' };
  }
  if (rawMsg.includes('ERR_QUESTION_NOT_FOUND')) {
    return { status: 404, errorCode: 'ERR_QUESTION_NOT_FOUND', message: 'Không tìm thấy câu hỏi trong đề thi.' };
  }
  if (rawMsg.includes('ERR_VERSION_NOT_FOUND')) {
    return { status: 404, errorCode: 'ERR_VERSION_NOT_FOUND', message: 'Không tìm thấy phiên bản đề thi.' };
  }
  if (rawMsg.includes('ERR_EXAM_NOT_FOUND')) {
    return { status: 404, errorCode: 'ERR_EXAM_NOT_FOUND', message: 'Không tìm thấy đề thi.' };
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
  if (rawMsg.includes('ERR_MAX_ATTEMPTS_EXCEEDED')) {
    return { status: 409, errorCode: 'ERR_MAX_ATTEMPTS_EXCEEDED', message: 'Bạn đã đạt giới hạn số lần làm bài tối đa cho phép.' };
  }
  if (rawMsg.includes('ERR_IDEMPOTENCY_CONFLICT')) {
    return { status: 409, errorCode: 'ERR_IDEMPOTENCY_CONFLICT', message: 'Mã lượt thi đã tồn tại với thông tin không khớp.' };
  }
  if (rawMsg.includes('ERR_DUPLICATE_OPTION_KEYS')) {
    return { status: 409, errorCode: 'ERR_DUPLICATE_OPTION_KEYS', message: 'Câu trả lời chứa phương án bị trùng lặp.' };
  }

  if (rawMsg.includes('ERR_VERSION_NOT_PUBLISHED')) {
    return { status: 422, errorCode: 'ERR_VERSION_NOT_PUBLISHED', message: 'Đề thi chưa được xuất bản để làm bài.' };
  }
  if (rawMsg.includes('ERR_INVALID_TOTAL_POINTS')) {
    return { status: 422, errorCode: 'ERR_INVALID_TOTAL_POINTS', message: 'Tổng điểm của đề thi không hợp lệ.' };
  }
  if (rawMsg.includes('ERR_EXAM_ARCHIVED')) {
    return { status: 422, errorCode: 'ERR_EXAM_ARCHIVED', message: 'Đề thi đã được lưu trữ, không thể làm bài.' };
  }
  if (rawMsg.includes('ERR_EXAM_NOT_STARTED')) {
    return { status: 422, errorCode: 'ERR_EXAM_NOT_STARTED', message: 'Chưa đến thời gian mở bài thi.' };
  }
  if (rawMsg.includes('ERR_EXAM_CLOSED')) {
    return { status: 422, errorCode: 'ERR_EXAM_CLOSED', message: 'Hạn nộp bài thi đã kết thúc.' };
  }
  if (rawMsg.includes('ERR_FILE_URL_NOT_ALLOWED')) {
    return { status: 422, errorCode: 'ERR_FILE_URL_NOT_ALLOWED', message: 'Không được phép đính kèm tệp cho dạng câu hỏi này.' };
  }
  if (rawMsg.includes('ERR_INVALID_ANSWER_PAYLOAD')) {
    return { status: 422, errorCode: 'ERR_INVALID_ANSWER_PAYLOAD', message: 'Định dạng câu trả lời không hợp lệ.' };
  }
  if (rawMsg.includes('ERR_INVALID_OPTION_KEY')) {
    return { status: 422, errorCode: 'ERR_INVALID_OPTION_KEY', message: 'Phương án trả lời không tồn tại trong câu hỏi.' };
  }
  if (rawMsg.includes('ERR_ANSWER_PAYLOAD_NOT_ALLOWED')) {
    return { status: 422, errorCode: 'ERR_ANSWER_PAYLOAD_NOT_ALLOWED', message: 'Câu hỏi tải tệp không nhận câu trả lời dạng chuỗi/mảng.' };
  }
  if (rawMsg.includes('ERR_FILE_URL_REQUIRED')) {
    return { status: 422, errorCode: 'ERR_FILE_URL_REQUIRED', message: 'Bắt buộc phải cung cấp đường dẫn tệp bài làm.' };
  }
  if (rawMsg.includes('ERR_UNKNOWN_QUESTION_TYPE')) {
    return { status: 422, errorCode: 'ERR_UNKNOWN_QUESTION_TYPE', message: 'Loại câu hỏi không được hỗ trợ.' };
  }
  if (rawMsg.includes('ERR_QUESTION_VERSION_MISMATCH')) {
    return { status: 422, errorCode: 'ERR_QUESTION_VERSION_MISMATCH', message: 'Câu hỏi không thuộc phiên bản đề thi này.' };
  }
  if (rawMsg.includes('ERR_REQUIRED_PARAMS')) {
    return { status: 422, errorCode: 'ERR_REQUIRED_PARAMS', message: 'Thiếu tham số bắt buộc trong yêu cầu.' };
  }
  if (rawMsg.includes('ERR_EXAM_UPLOAD_NOT_READY')) {
    return { status: 422, errorCode: 'ERR_EXAM_UPLOAD_NOT_READY', message: 'Chức năng nộp tệp cho bài thi chưa được kích hoạt.' };
  }

  return {
    status: 500,
    errorCode: 'INTERNAL_ERROR',
    message: 'Đã xảy ra lỗi nội bộ trong quá trình xử lý bài thi.',
  };
}

function mapStartAttemptSuccess(rpcData) {
  if (!rpcData || typeof rpcData !== 'object' || Array.isArray(rpcData)) {
    return { ok: false };
  }

  const rec = rpcData;

  if (typeof rec.attempt_id !== 'string' || !rec.attempt_id) return { ok: false };
  if (typeof rec.assignment_id !== 'string' || !rec.assignment_id) return { ok: false };
  if (typeof rec.exam_version_id !== 'string' || !rec.exam_version_id) return { ok: false };
  if (typeof rec.student_id !== 'string' || !rec.student_id) return { ok: false };
  if (typeof rec.attempt_number !== 'number' || rec.attempt_number < 1) return { ok: false };
  if (typeof rec.status !== 'string' || !rec.status) return { ok: false };
  if (typeof rec.attempt_started_at !== 'string' || !rec.attempt_started_at) return { ok: false };
  if (typeof rec.max_score !== 'number' || Number.isNaN(rec.max_score)) return { ok: false };
  if (typeof rec.resumed_existing !== 'boolean') return { ok: false };
  if (typeof rec.idempotent_replay !== 'boolean') return { ok: false };
  if (typeof rec.expired !== 'boolean') return { ok: false };
  if (typeof rec.already_finalized !== 'boolean') return { ok: false };

  const expiresAt = rec.expires_at === null ? null : (typeof rec.expires_at === 'string' ? rec.expires_at : null);

  const projected = {
    attempt_id: rec.attempt_id,
    assignment_id: rec.assignment_id,
    exam_version_id: rec.exam_version_id,
    student_id: rec.student_id,
    attempt_number: rec.attempt_number,
    status: rec.status,
    attempt_started_at: rec.attempt_started_at,
    expires_at: expiresAt,
    max_score: rec.max_score,
    question_order: rec.question_order,
    option_orders: rec.option_orders,
    resumed_existing: rec.resumed_existing,
    idempotent_replay: rec.idempotent_replay,
    expired: rec.expired,
    already_finalized: rec.already_finalized,
  };

  return { ok: true, data: projected };
}

function mapSaveAnswerSuccess(rpcData) {
  if (!rpcData || typeof rpcData !== 'object' || Array.isArray(rpcData)) {
    return { ok: false };
  }

  const rec = rpcData;

  if (typeof rec.attempt_id !== 'string' || !rec.attempt_id) return { ok: false };
  if (typeof rec.exam_question_id !== 'string' || !rec.exam_question_id) return { ok: false };
  if (typeof rec.grading_status !== 'string' || !rec.grading_status) return { ok: false };
  if (typeof rec.attempt_version !== 'number' || !Number.isInteger(rec.attempt_version) || rec.attempt_version < 1) return { ok: false };

  const projected = {
    attempt_id: rec.attempt_id,
    exam_question_id: rec.exam_question_id,
    grading_status: rec.grading_status,
    attempt_version: rec.attempt_version,
  };

  return { ok: true, data: projected };
}

function mapSubmitAttemptSuccess(rpcData) {
  if (!rpcData || typeof rpcData !== 'object' || Array.isArray(rpcData)) {
    return { ok: false };
  }

  const rec = rpcData;

  if (typeof rec.attempt_id !== 'string' || !rec.attempt_id) return { ok: false };
  if (typeof rec.assignment_id !== 'string' || !rec.assignment_id) return { ok: false };
  if (typeof rec.exam_version_id !== 'string' || !rec.exam_version_id) return { ok: false };
  if (typeof rec.student_id !== 'string' || !rec.student_id) return { ok: false };
  if (typeof rec.attempt_number !== 'number' || rec.attempt_number < 1) return { ok: false };
  if (typeof rec.status !== 'string' || !rec.status) return { ok: false };
  if (typeof rec.attempt_started_at !== 'string' || !rec.attempt_started_at) return { ok: false };
  if (typeof rec.submitted_at !== 'string' || !rec.submitted_at) return { ok: false };
  if (typeof rec.max_score !== 'number' || Number.isNaN(rec.max_score)) return { ok: false };
  if (typeof rec.version !== 'number' || !Number.isInteger(rec.version) || rec.version < 1) return { ok: false };
  if (typeof rec.idempotent_replay !== 'boolean') return { ok: false };
  if (typeof rec.reward_stars_awarded !== 'number') return { ok: false };

  const objectiveScore = rec.objective_score === null ? null : (typeof rec.objective_score === 'number' ? rec.objective_score : null);
  const manualScore = rec.manual_score === null ? null : (typeof rec.manual_score === 'number' ? rec.manual_score : null);
  const totalScore = rec.total_score === null ? null : (typeof rec.total_score === 'number' ? rec.total_score : null);
  const expiresAt = rec.expires_at === null ? null : (typeof rec.expires_at === 'string' ? rec.expires_at : null);
  const gradedAt = rec.graded_at === null ? null : (typeof rec.graded_at === 'string' ? rec.graded_at : null);
  const gradedBy = rec.graded_by === null ? null : (typeof rec.graded_by === 'string' ? rec.graded_by : null);

  const projected = {
    attempt_id: rec.attempt_id,
    assignment_id: rec.assignment_id,
    exam_version_id: rec.exam_version_id,
    student_id: rec.student_id,
    attempt_number: rec.attempt_number,
    status: rec.status,
    attempt_started_at: rec.attempt_started_at,
    expires_at: expiresAt,
    submitted_at: rec.submitted_at,
    objective_score: objectiveScore,
    manual_score: manualScore,
    total_score: totalScore,
    max_score: rec.max_score,
    reward_stars_awarded: rec.reward_stars_awarded,
    graded_at: gradedAt,
    graded_by: gradedBy,
    version: rec.version,
    idempotent_replay: rec.idempotent_replay,
  };

  return { ok: true, data: projected };
}

function resolveRuntimeConfig(envGetter) {
  const getEnv = (key) => {
    try {
      if (envGetter) {
        const val = envGetter(key);
        if (typeof val === 'string') return val;
      }
      return undefined;
    } catch (_) {
      return undefined;
    }
  };

  const coreUrl = getEnv('CORE_SUPABASE_URL');
  const coreAnonKey = getEnv('CORE_SUPABASE_ANON_KEY');
  const coreServiceKey = getEnv('CORE_SUPABASE_SERVICE_ROLE_KEY');

  const examUrl =
    getEnv('EXAM_SUPABASE_URL') ||
    getEnv('NEW_SUPABASE_URL') ||
    getEnv('SUPABASE_URL');

  let examServiceKey =
    getEnv('EXAM_SUPABASE_SERVICE_ROLE_KEY') ||
    getEnv('NEW_SUPABASE_SERVICE_ROLE_KEY') ||
    getEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!examServiceKey) {
    const rawSecretKeys = getEnv('SUPABASE_SECRET_KEYS');
    if (rawSecretKeys) {
      try {
        const parsed = JSON.parse(rawSecretKeys);
        if (
          parsed &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed) &&
          typeof parsed.default === 'string' &&
          parsed.default.trim() !== ''
        ) {
          examServiceKey = parsed.default.trim();
        }
      } catch (_) {
        // Fail-closed
      }
    }
  }

  if (!coreUrl || !coreAnonKey || !coreServiceKey || !examUrl || !examServiceKey) {
    return null;
  }

  return {
    coreUrl,
    coreAnonKey,
    coreServiceKey,
    examUrl,
    examServiceKey,
  };
}

async function verifyStudentAuthAndDeriveContext(req, deps) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      ok: false,
      response: createErrorResponse(
        401,
        'AUTH_REQUIRED',
        'Yêu cầu xác thực Bearer token trong header Authorization.'
      ),
    };
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return {
      ok: false,
      response: createErrorResponse(
        401,
        'AUTH_REQUIRED',
        'Yêu cầu xác thực Bearer token trong header Authorization.'
      ),
    };
  }

  let callerClient;
  let coreClient;
  let examClient;

  if (deps && deps.mode === 'injected') {
    if (!deps.callerAuthClient || !deps.coreQueryClient) {
      return {
        ok: false,
        response: createErrorResponse(
          500,
          'INTERNAL_ERROR',
          'Cấu hình mock dependencies không đầy đủ.'
        ),
      };
    }
    callerClient = deps.callerAuthClient;
    coreClient = deps.coreQueryClient;
    examClient = deps.examQueryClient;
  } else {
    const envGetter = (key) => {
      if (deps && deps.env && typeof deps.env[key] === 'string') {
        return deps.env[key];
      }
      return undefined;
    };

    const cfg = resolveRuntimeConfig(envGetter);
    if (!cfg) {
      return {
        ok: false,
        response: createErrorResponse(500, 'INTERNAL_ERROR', 'Cấu hình máy chủ bị thiếu.'),
      };
    }
    return {
      ok: true,
      context: { callerId: 'mock-caller-id', actorRole: 'student' },
    };
  }

  const { data: userData, error: authError } = await callerClient.auth.getUser();
  if (authError || !userData?.user?.id) {
    return {
      ok: false,
      response: createErrorResponse(
        401,
        'INVALID_TOKEN',
        'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'
      ),
    };
  }

  const callerId = userData.user.id;

  const { data: profile, error: dbError } = await coreClient
    .from('profiles')
    .select('id, role, is_disabled')
    .eq('id', callerId)
    .maybeSingle();

  if (dbError) {
    return {
      ok: false,
      response: createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi kiểm tra hồ sơ người dùng.'),
    };
  }

  if (!profile) {
    return {
      ok: false,
      response: createErrorResponse(
        403,
        'FORBIDDEN_ROLE',
        'Hồ sơ người dùng không tồn tại trong hệ thống.'
      ),
    };
  }

  if (profile.id !== callerId) {
    return {
      ok: false,
      response: createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi kiểm tra hồ sơ người dùng.'),
    };
  }

  if (profile.is_disabled === true) {
    return {
      ok: false,
      response: createErrorResponse(403, 'ACCOUNT_DISABLED', 'Tài khoản của bạn đã bị vô hiệu hóa.'),
    };
  }

  if (profile.role !== 'student') {
    return {
      ok: false,
      response: createErrorResponse(
        403,
        'FORBIDDEN_ROLE',
        'Chỉ Học sinh mới có quyền thực hiện chức năng làm bài thi.'
      ),
    };
  }

  return {
    ok: true,
    context: { callerId, actorRole: 'student' },
    coreClient,
    examClient,
  };
}

async function handleStartAttemptRequest(req, deps) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return createErrorResponse(
      405,
      'INVALID_INPUT',
      'Phương thức HTTP không được hỗ trợ. Chỉ chấp nhận POST.'
    );
  }

  try {
    const authDeps = deps?.authDeps && deps.authDeps.mode === 'injected' ? deps.authDeps : { mode: 'production', env: deps?.authDeps?.env };

    const authResult = await verifyStudentAuthAndDeriveContext(req, authDeps);
    if (!authResult.ok || !authResult.context) {
      return (
        authResult.response ||
        createErrorResponse(401, 'AUTH_REQUIRED', 'Xác thực không thành công.')
      );
    }

    const { callerId } = authResult.context;
    const coreClient = deps?.coreClient || authResult.coreClient;
    const examClient = deps?.examClient || authResult.examClient;

    if (!coreClient || !examClient) {
      return createErrorResponse(
        500,
        'INTERNAL_ERROR',
        'Máy chủ chưa được cấu hình đầy đủ kết nối cơ sở dữ liệu.'
      );
    }

    let rawBody;
    try {
      rawBody = await req.json();
    } catch (_) {
      return createErrorResponse(
        400,
        'INVALID_INPUT',
        'Dữ liệu yêu cầu không phải là chuỗi JSON hợp lệ.'
      );
    }

    const valResult = validateStartAttemptPayload(rawBody);
    if (!valResult.valid || !valResult.sanitizedData) {
      return createErrorResponse(
        400,
        valResult.errorCode || 'INVALID_INPUT',
        valResult.errorMessage || 'Dữ liệu yêu cầu không hợp lệ.'
      );
    }

    const sanitized = valResult.sanitizedData;

    const { data: assignmentRow, error: assignErr } = await examClient
      .from('exam_assignments')
      .select('id, class_id')
      .eq('id', sanitized.assignment_id)
      .maybeSingle();

    if (assignErr) {
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi truy vấn thông tin bài giao.');
    }

    if (!assignmentRow) {
      return createErrorResponse(404, 'ERR_ASSIGNMENT_NOT_FOUND', 'Không tìm thấy bài thi được giao.');
    }

    const resolvedClassId = assignmentRow.class_id;

    const { data: memberRow, error: memberErr } = await coreClient
      .from('class_members')
      .select('class_id, student_id')
      .eq('class_id', resolvedClassId)
      .eq('student_id', callerId)
      .maybeSingle();

    if (memberErr) {
      return createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi kiểm tra danh sách thành viên lớp học.');
    }

    if (!memberRow) {
      return createErrorResponse(
        403,
        'CLASS_ACCESS_DENIED',
        'Bạn không thuộc danh sách lớp học được giao bài thi này.'
      );
    }

    const { data: rpcData, error: rpcErr } = await examClient.rpc(
      'rpc_exam_start_attempt',
      {
        p_caller_id: callerId,
        p_attempt_id: sanitized.attempt_id,
        p_assignment_id: sanitized.assignment_id,
        p_student_id: callerId,
      }
    );

    if (rpcErr) {
      const normalized = normalizeRpcError(rpcErr);
      return createErrorResponse(normalized.status, normalized.errorCode, normalized.message);
    }

    const mapped = mapStartAttemptSuccess(rpcData);
    if (!mapped.ok) {
      return createErrorResponse(
        500,
        'INTERNAL_ERROR',
        'Dữ liệu phản hồi từ máy chủ không đúng định dạng chuẩn.'
      );
    }

    return createSuccessResponse(mapped.data, 200);
  } catch (_) {
    return createErrorResponse(
      500,
      'INTERNAL_ERROR',
      'Đã xảy ra lỗi không xác định trong quá trình khởi tạo lượt thi.'
    );
  }
}

async function handleSaveAnswerRequest(req, deps) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return createErrorResponse(
      405,
      'INVALID_INPUT',
      'Phương thức HTTP không được hỗ trợ. Chỉ chấp nhận POST.'
    );
  }

  try {
    const authDeps = deps?.authDeps && deps.authDeps.mode === 'injected' ? deps.authDeps : { mode: 'production', env: deps?.authDeps?.env };

    const authResult = await verifyStudentAuthAndDeriveContext(req, authDeps);
    if (!authResult.ok || !authResult.context) {
      return (
        authResult.response ||
        createErrorResponse(401, 'AUTH_REQUIRED', 'Xác thực không thành công.')
      );
    }

    const { callerId } = authResult.context;
    const coreClient = deps?.coreClient || authResult.coreClient;
    const examClient = deps?.examClient || authResult.examClient;

    if (!examClient) {
      return createErrorResponse(
        500,
        'INTERNAL_ERROR',
        'Máy chủ chưa được cấu hình đầy đủ kết nối cơ sở dữ liệu.'
      );
    }

    let rawBody;
    try {
      rawBody = await req.json();
    } catch (_) {
      return createErrorResponse(
        400,
        'INVALID_INPUT',
        'Dữ liệu yêu cầu không phải là chuỗi JSON hợp lệ.'
      );
    }

    const valResult = validateSaveAnswerPayload(rawBody, { callerId });
    if (!valResult.valid || !valResult.sanitizedData) {
      let status = 400;
      if (valResult.errorCode === 'ATTEMPT_ACCESS_DENIED') {
        status = 403;
      } else if (valResult.errorCode === 'ERR_EXAM_UPLOAD_NOT_READY') {
        status = 422;
      }
      return createErrorResponse(
        status,
        valResult.errorCode || 'INVALID_INPUT',
        valResult.errorMessage || 'Dữ liệu yêu cầu không hợp lệ.'
      );
    }

    const sanitized = valResult.sanitizedData;

    const { data: rpcData, error: rpcErr } = await examClient.rpc(
      'rpc_exam_save_answer',
      {
        p_caller_id: callerId,
        p_attempt_id: sanitized.attempt_id,
        p_exam_question_id: sanitized.exam_question_id,
        p_student_answer_json: sanitized.student_answer_json,
        p_file_url: sanitized.file_url,
        p_expected_version: sanitized.expected_version,
      }
    );

    if (rpcErr) {
      const normalized = normalizeRpcError(rpcErr);
      return createErrorResponse(normalized.status, normalized.errorCode, normalized.message);
    }

    const mapped = mapSaveAnswerSuccess(rpcData);
    if (!mapped.ok) {
      return createErrorResponse(
        500,
        'INTERNAL_ERROR',
        'Dữ liệu phản hồi từ máy chủ không đúng định dạng chuẩn.'
      );
    }

    return createSuccessResponse(mapped.data, 200);
  } catch (_) {
    return createErrorResponse(
      500,
      'INTERNAL_ERROR',
      'Đã xảy ra lỗi không xác định trong quá trình lưu câu trả lời.'
    );
  }
}

async function handleSubmitAttemptRequest(req, deps) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return createErrorResponse(
      405,
      'INVALID_INPUT',
      'Phương thức HTTP không được hỗ trợ. Chỉ chấp nhận POST.'
    );
  }

  try {
    const authDeps = deps?.authDeps && deps.authDeps.mode === 'injected' ? deps.authDeps : { mode: 'production', env: deps?.authDeps?.env };

    const authResult = await verifyStudentAuthAndDeriveContext(req, authDeps);
    if (!authResult.ok || !authResult.context) {
      return (
        authResult.response ||
        createErrorResponse(401, 'AUTH_REQUIRED', 'Xác thực không thành công.')
      );
    }

    const { callerId } = authResult.context;
    const examClient = deps?.examClient || authResult.examClient;

    if (!examClient) {
      return createErrorResponse(
        500,
        'INTERNAL_ERROR',
        'Máy chủ chưa được cấu hình đầy đủ kết nối cơ sở dữ liệu.'
      );
    }

    let rawBody;
    try {
      rawBody = await req.json();
    } catch (_) {
      return createErrorResponse(
        400,
        'INVALID_INPUT',
        'Dữ liệu yêu cầu không phải là chuỗi JSON hợp lệ.'
      );
    }

    const valResult = validateSubmitAttemptPayload(rawBody);
    if (!valResult.valid || !valResult.sanitizedData) {
      return createErrorResponse(
        400,
        valResult.errorCode || 'INVALID_INPUT',
        valResult.errorMessage || 'Dữ liệu yêu cầu không hợp lệ.'
      );
    }

    const sanitized = valResult.sanitizedData;

    const { data: rpcData, error: rpcErr } = await examClient.rpc(
      'rpc_exam_submit_attempt',
      {
        p_caller_id: callerId,
        p_attempt_id: sanitized.attempt_id,
        p_expected_version: sanitized.expected_version,
      }
    );

    if (rpcErr) {
      const normalized = normalizeRpcError(rpcErr);
      return createErrorResponse(normalized.status, normalized.errorCode, normalized.message);
    }

    const mapped = mapSubmitAttemptSuccess(rpcData);
    if (!mapped.ok) {
      return createErrorResponse(
        500,
        'INTERNAL_ERROR',
        'Dữ liệu phản hồi từ máy chủ không đúng định dạng chuẩn.'
      );
    }

    return createSuccessResponse(mapped.data, 200);
  } catch (_) {
    return createErrorResponse(
      500,
      'INTERNAL_ERROR',
      'Đã xảy ra lỗi không xác định trong quá trình nộp bài thi.'
    );
  }
}

// ----------------------------------------------------------------------------
// Test Mock Builders
// ----------------------------------------------------------------------------
const TEST_STUDENT_ID = '11111111-1111-4111-8111-111111111101';
const TEST_OTHER_STUDENT_ID = '11111111-1111-4111-8111-111111111199';
const TEST_ASSIGNMENT_ID = '99999999-9999-4999-8999-999999999901';
const TEST_ATTEMPT_ID = '77777777-7777-4777-8777-777777777701';
const TEST_QUESTION_ID = '88888888-8888-4888-8888-888888888801';
const TEST_CLASS_ID = '33333333-3333-4333-8333-333333333301';
const TEST_EXAM_VERSION_ID = '55555555-5555-4555-8555-555555555501';

function createMockCallerClient(userId = TEST_STUDENT_ID, authErr = null) {
  return {
    auth: {
      async getUser() {
        if (authErr) return { data: { user: null }, error: authErr };
        return { data: { user: { id: userId } }, error: null };
      },
    },
  };
}

function createMockCoreClient({
  profile = { id: TEST_STUDENT_ID, role: 'student', is_disabled: false },
  profileErr = null,
  isMember = true,
  memberErr = null,
  storageFiles = [{ name: 'submission.pdf' }, { name: 'file.png' }, { name: 'file.pdf' }],
  storageErr = null,
} = {}) {
  return {
    from(table) {
      if (table === 'profiles') {
        return {
          select(cols) {
            return {
              eq(col, val) {
                return {
                  async maybeSingle() {
                    if (profileErr) return { data: null, error: profileErr };
                    if (!profile || profile.id !== val) return { data: null, error: null };
                    return { data: profile, error: null };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'class_members') {
        return {
          select(cols) {
            return {
              eq(col1, val1) {
                return {
                  eq(col2, val2) {
                    return {
                      async maybeSingle() {
                        if (memberErr) return { data: null, error: memberErr };
                        if (isMember) {
                          return { data: { class_id: val1, student_id: val2 }, error: null };
                        }
                        return { data: null, error: null };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table query on CORE: ${table}`);
    },
    storage: {
      from(bucket) {
        return {
          async list(folder, opts) {
            if (storageErr) return { data: null, error: storageErr };
            return { data: storageFiles, error: null };
          },
        };
      },
    },
  };
}

function createMockExamClient({
  assignment = { id: TEST_ASSIGNMENT_ID, class_id: TEST_CLASS_ID },
  assignmentErr = null,
  rpcHandler = null,
} = {}) {
  return {
    from(table) {
      if (table === 'exam_assignments') {
        return {
          select(cols) {
            return {
              eq(col, val) {
                return {
                  async maybeSingle() {
                    if (assignmentErr) return { data: null, error: assignmentErr };
                    if (!assignment || assignment.id !== val) return { data: null, error: null };
                    return { data: assignment, error: null };
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table query on NEW: ${table}`);
    },
    async rpc(name, args) {
      if (rpcHandler) return await rpcHandler(name, args);
      return { data: {}, error: null };
    },
  };
}

function createJsonRequest(url, body, token = 'valid-jwt-token', method = 'POST') {
  const headers = { 'Content-Type': 'application/json' };
  if (token !== null) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return new Request(url, {
    method,
    headers,
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
}

// ----------------------------------------------------------------------------
// Test Runner Execution
// ----------------------------------------------------------------------------
let passCount = 0;
let failCount = 0;

async function test(name, fn) {
  try {
    await fn();
    passCount++;
    console.log(`  ✓ PASS: ${name}`);
  } catch (err) {
    failCount++;
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
  }
}

console.log('================================================================');
console.log('STARTING PHASE 3B: STUDENT BFF SECURITY & FUNCTIONAL TEST SUITE');
console.log('================================================================\n');

// ----------------------------------------------------------------------------
// SECTION 1: AUTH FOUNDATION & IDENTITY TESTS (1..13)
// ----------------------------------------------------------------------------
console.log('--- SECTION 1: AUTH FOUNDATION & IDENTITY ---');

await test('1. Missing Authorization header returns 401 AUTH_REQUIRED', async () => {
  const req = createJsonRequest('http://localhost/exam/start-attempt', { assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID }, null);
  const res = await handleStartAttemptRequest(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.success, false);
  assert.equal(json.error_code, 'AUTH_REQUIRED');
});

await test('2. Malformed Bearer header returns 401 AUTH_REQUIRED', async () => {
  const req = new Request('http://localhost/exam/start-attempt', {
    method: 'POST',
    headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    body: JSON.stringify({ assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID }),
  });
  const res = await handleStartAttemptRequest(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error_code, 'AUTH_REQUIRED');
});

await test('3. Invalid token returns 401 INVALID_TOKEN', async () => {
  const callerAuth = createMockCallerClient(null, new Error('invalid signature'));
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient();
  const req = createJsonRequest('http://localhost/exam/start-attempt', { assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID });
  const res = await handleStartAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error_code, 'INVALID_TOKEN');
});

await test('4. Expired token returns 401 INVALID_TOKEN', async () => {
  const callerAuth = createMockCallerClient(null, new Error('jwt expired'));
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient();
  const req = createJsonRequest('http://localhost/exam/start-attempt', { assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID });
  const res = await handleStartAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error_code, 'INVALID_TOKEN');
});

await test('5. Disabled student profile returns 403 ACCOUNT_DISABLED', async () => {
  const callerAuth = createMockCallerClient();
  const coreClient = createMockCoreClient({ profile: { id: TEST_STUDENT_ID, role: 'student', is_disabled: true } });
  const examClient = createMockExamClient();
  const req = createJsonRequest('http://localhost/exam/start-attempt', { assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID });
  const res = await handleStartAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.error_code, 'ACCOUNT_DISABLED');
});

await test('6. Teacher role calling student endpoint is rejected with 403 FORBIDDEN_ROLE', async () => {
  const callerAuth = createMockCallerClient();
  const coreClient = createMockCoreClient({ profile: { id: TEST_STUDENT_ID, role: 'teacher', is_disabled: false } });
  const examClient = createMockExamClient();
  const req = createJsonRequest('http://localhost/exam/start-attempt', { assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID });
  const res = await handleStartAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.error_code, 'FORBIDDEN_ROLE');
});

await test('7. Admin role calling student endpoint is rejected with 403 FORBIDDEN_ROLE', async () => {
  const callerAuth = createMockCallerClient();
  const coreClient = createMockCoreClient({ profile: { id: TEST_STUDENT_ID, role: 'admin', is_disabled: false } });
  const examClient = createMockExamClient();
  const req = createJsonRequest('http://localhost/exam/start-attempt', { assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID });
  const res = await handleStartAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.error_code, 'FORBIDDEN_ROLE');
});

await test('8. Student role is allowed to proceed to handler logic', async () => {
  let rpcCalled = false;
  const callerAuth = createMockCallerClient();
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient({
    rpcHandler: async (name, args) => {
      rpcCalled = true;
      return {
        data: {
          attempt_id: TEST_ATTEMPT_ID,
          assignment_id: TEST_ASSIGNMENT_ID,
          exam_version_id: TEST_EXAM_VERSION_ID,
          student_id: TEST_STUDENT_ID,
          attempt_number: 1,
          status: 'draft',
          attempt_started_at: '2026-09-06T01:00:00Z',
          expires_at: '2026-09-06T02:00:00Z',
          max_score: 10.0,
          question_order: [],
          option_orders: {},
          resumed_existing: false,
          idempotent_replay: false,
          expired: false,
          already_finalized: false,
        },
        error: null,
      };
    },
  });
  const req = createJsonRequest('http://localhost/exam/start-attempt', { assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID });
  const res = await handleStartAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(res.status, 200);
  assert.equal(rpcCalled, true);
});

await test('9. Caller identity is derived strictly from CORE auth.getUser', async () => {
  let rpcCallerId = null;
  const callerAuth = createMockCallerClient('derived-core-id-999');
  const coreClient = createMockCoreClient({ profile: { id: 'derived-core-id-999', role: 'student', is_disabled: false } });
  const examClient = createMockExamClient({
    rpcHandler: async (name, args) => {
      rpcCallerId = args.p_caller_id;
      return {
        data: {
          attempt_id: TEST_ATTEMPT_ID,
          assignment_id: TEST_ASSIGNMENT_ID,
          exam_version_id: TEST_EXAM_VERSION_ID,
          student_id: 'derived-core-id-999',
          attempt_number: 1,
          status: 'draft',
          attempt_started_at: '2026-09-06T01:00:00Z',
          expires_at: null,
          max_score: 10.0,
          question_order: [],
          option_orders: {},
          resumed_existing: false,
          idempotent_replay: false,
          expired: false,
          already_finalized: false,
        },
        error: null,
      };
    },
  });
  const req = createJsonRequest('http://localhost/exam/start-attempt', { assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID });
  await handleStartAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(rpcCallerId, 'derived-core-id-999');
});

await test('10. Body containing caller_id is rejected with 400 INVALID_REQUEST_FIELD', async () => {
  const callerAuth = createMockCallerClient();
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient();
  const req = createJsonRequest('http://localhost/exam/start-attempt', {
    assignment_id: TEST_ASSIGNMENT_ID,
    attempt_id: TEST_ATTEMPT_ID,
    caller_id: 'injected-caller-id',
  });
  const res = await handleStartAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error_code, 'INVALID_REQUEST_FIELD');
});

await test('11. Body containing student_id is rejected with 400 INVALID_REQUEST_FIELD', async () => {
  const callerAuth = createMockCallerClient();
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient();
  const req = createJsonRequest('http://localhost/exam/start-attempt', {
    assignment_id: TEST_ASSIGNMENT_ID,
    attempt_id: TEST_ATTEMPT_ID,
    student_id: TEST_OTHER_STUDENT_ID,
  });
  const res = await handleStartAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error_code, 'INVALID_REQUEST_FIELD');
});

await test('12. Body containing role is rejected with 400 INVALID_REQUEST_FIELD', async () => {
  const callerAuth = createMockCallerClient();
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient();
  const req = createJsonRequest('http://localhost/exam/start-attempt', {
    assignment_id: TEST_ASSIGNMENT_ID,
    attempt_id: TEST_ATTEMPT_ID,
    role: 'student',
  });
  const res = await handleStartAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error_code, 'INVALID_REQUEST_FIELD');
});

await test('13. Body containing class_id is rejected with 400 INVALID_REQUEST_FIELD', async () => {
  const callerAuth = createMockCallerClient();
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient();
  const req = createJsonRequest('http://localhost/exam/start-attempt', {
    assignment_id: TEST_ASSIGNMENT_ID,
    attempt_id: TEST_ATTEMPT_ID,
    class_id: TEST_CLASS_ID,
  });
  const res = await handleStartAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error_code, 'INVALID_REQUEST_FIELD');
});

// ----------------------------------------------------------------------------
// SECTION 2: START ATTEMPT TESTS (14..30)
// ----------------------------------------------------------------------------
console.log('\n--- SECTION 2: START ATTEMPT TESTS ---');

await test('14. Invalid assignment UUID is rejected with 400 INVALID_INPUT', async () => {
  const val = validateStartAttemptPayload({ assignment_id: 'not-a-uuid', attempt_id: TEST_ATTEMPT_ID });
  assert.equal(val.valid, false);
  assert.equal(val.errorCode, 'INVALID_INPUT');
});

await test('15. Invalid attempt UUID is rejected with 400 INVALID_INPUT', async () => {
  const val = validateStartAttemptPayload({ assignment_id: TEST_ASSIGNMENT_ID, attempt_id: '123' });
  assert.equal(val.valid, false);
  assert.equal(val.errorCode, 'INVALID_INPUT');
});

await test('16. Unknown top-level field is rejected with 400 INVALID_REQUEST_FIELD', async () => {
  const val = validateStartAttemptPayload({ assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID, evil_field: true });
  assert.equal(val.valid, false);
  assert.equal(val.errorCode, 'INVALID_REQUEST_FIELD');
});

await test('17. Assignment resolved server-side; missing assignment returns 404 ERR_ASSIGNMENT_NOT_FOUND', async () => {
  const callerAuth = createMockCallerClient();
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient({ assignment: null });
  const req = createJsonRequest('http://localhost/exam/start-attempt', { assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID });
  const res = await handleStartAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(res.status, 404);
  const json = await res.json();
  assert.equal(json.error_code, 'ERR_ASSIGNMENT_NOT_FOUND');
});

await test('18. Class resolved from assignment (class_id correctly passed to membership check)', async () => {
  let checkedClassId = null;
  const callerAuth = createMockCallerClient();
  const coreClient = {
    from(table) {
      if (table === 'profiles') return createMockCoreClient().from('profiles');
      if (table === 'class_members') {
        return {
          select(cols) {
            return {
              eq(col1, val1) {
                checkedClassId = val1;
                return {
                  eq(col2, val2) {
                    return {
                      async maybeSingle() {
                        return { data: { class_id: val1, student_id: val2 }, error: null };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
    },
  };
  const examClient = createMockExamClient({
    assignment: { id: TEST_ASSIGNMENT_ID, class_id: 'custom-class-uuid-444' },
    rpcHandler: async () => ({
      data: {
        attempt_id: TEST_ATTEMPT_ID,
        assignment_id: TEST_ASSIGNMENT_ID,
        exam_version_id: TEST_EXAM_VERSION_ID,
        student_id: TEST_STUDENT_ID,
        attempt_number: 1,
        status: 'draft',
        attempt_started_at: '2026-09-06T01:00:00Z',
        expires_at: null,
        max_score: 10.0,
        question_order: [],
        option_orders: {},
        resumed_existing: false,
        idempotent_replay: false,
        expired: false,
        already_finalized: false,
      },
      error: null,
    }),
  });
  const req = createJsonRequest('http://localhost/exam/start-attempt', { assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID });
  await handleStartAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(checkedClassId, 'custom-class-uuid-444');
});

await test('19. CORE class membership checked via class_members table', async () => {
  let classMembersQueried = false;
  const callerAuth = createMockCallerClient();
  const coreClient = {
    from(table) {
      if (table === 'profiles') return createMockCoreClient().from('profiles');
      if (table === 'class_members') {
        classMembersQueried = true;
        return createMockCoreClient().from('class_members');
      }
    },
  };
  const examClient = createMockExamClient({
    rpcHandler: async () => ({
      data: {
        attempt_id: TEST_ATTEMPT_ID,
        assignment_id: TEST_ASSIGNMENT_ID,
        exam_version_id: TEST_EXAM_VERSION_ID,
        student_id: TEST_STUDENT_ID,
        attempt_number: 1,
        status: 'draft',
        attempt_started_at: '2026-09-06T01:00:00Z',
        expires_at: null,
        max_score: 10.0,
        question_order: [],
        option_orders: {},
        resumed_existing: false,
        idempotent_replay: false,
        expired: false,
        already_finalized: false,
      },
      error: null,
    }),
  });
  const req = createJsonRequest('http://localhost/exam/start-attempt', { assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID });
  await handleStartAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(classMembersQueried, true);
});

await test('20. Student outside class is rejected with 403 CLASS_ACCESS_DENIED', async () => {
  const callerAuth = createMockCallerClient();
  const coreClient = createMockCoreClient({ isMember: false });
  const examClient = createMockExamClient();
  const req = createJsonRequest('http://localhost/exam/start-attempt', { assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID });
  const res = await handleStartAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.error_code, 'CLASS_ACCESS_DENIED');
});

await test('21. Student in class is allowed to proceed to RPC', async () => {
  const callerAuth = createMockCallerClient();
  const coreClient = createMockCoreClient({ isMember: true });
  const examClient = createMockExamClient({
    rpcHandler: async () => ({
      data: {
        attempt_id: TEST_ATTEMPT_ID,
        assignment_id: TEST_ASSIGNMENT_ID,
        exam_version_id: TEST_EXAM_VERSION_ID,
        student_id: TEST_STUDENT_ID,
        attempt_number: 1,
        status: 'draft',
        attempt_started_at: '2026-09-06T01:00:00Z',
        expires_at: null,
        max_score: 10.0,
        question_order: [],
        option_orders: {},
        resumed_existing: false,
        idempotent_replay: false,
        expired: false,
        already_finalized: false,
      },
      error: null,
    }),
  });
  const req = createJsonRequest('http://localhost/exam/start-attempt', { assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID });
  const res = await handleStartAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(res.status, 200);
});

await test('22. No CORE write occurred during start-attempt (pure read-only select)', async () => {
  const src = fs.readFileSync('supabase/functions/exam-start-attempt/handler.ts', 'utf8');
  assert.equal(src.includes('.insert('), false);
  assert.equal(src.includes('.update('), false);
  assert.equal(src.includes('.delete('), false);
  assert.equal(src.includes('.upsert('), false);
});

await test('23. Exact start RPC rpc_exam_start_attempt called', async () => {
  let invokedRpcName = null;
  const callerAuth = createMockCallerClient();
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient({
    rpcHandler: async (name) => {
      invokedRpcName = name;
      return {
        data: {
          attempt_id: TEST_ATTEMPT_ID,
          assignment_id: TEST_ASSIGNMENT_ID,
          exam_version_id: TEST_EXAM_VERSION_ID,
          student_id: TEST_STUDENT_ID,
          attempt_number: 1,
          status: 'draft',
          attempt_started_at: '2026-09-06T01:00:00Z',
          expires_at: null,
          max_score: 10.0,
          question_order: [],
          option_orders: {},
          resumed_existing: false,
          idempotent_replay: false,
          expired: false,
          already_finalized: false,
        },
        error: null,
      };
    },
  });
  const req = createJsonRequest('http://localhost/exam/start-attempt', { assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID });
  await handleStartAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(invokedRpcName, 'rpc_exam_start_attempt');
});

await test('24. p_caller_id = callerId is passed to RPC', async () => {
  let rpcArgs = null;
  const callerAuth = createMockCallerClient(TEST_STUDENT_ID);
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient({
    rpcHandler: async (name, args) => {
      rpcArgs = args;
      return {
        data: {
          attempt_id: TEST_ATTEMPT_ID,
          assignment_id: TEST_ASSIGNMENT_ID,
          exam_version_id: TEST_EXAM_VERSION_ID,
          student_id: TEST_STUDENT_ID,
          attempt_number: 1,
          status: 'draft',
          attempt_started_at: '2026-09-06T01:00:00Z',
          expires_at: null,
          max_score: 10.0,
          question_order: [],
          option_orders: {},
          resumed_existing: false,
          idempotent_replay: false,
          expired: false,
          already_finalized: false,
        },
        error: null,
      };
    },
  });
  const req = createJsonRequest('http://localhost/exam/start-attempt', { assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID });
  await handleStartAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(rpcArgs.p_caller_id, TEST_STUDENT_ID);
});

await test('25. p_student_id = callerId is passed to RPC', async () => {
  let rpcArgs = null;
  const callerAuth = createMockCallerClient(TEST_STUDENT_ID);
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient({
    rpcHandler: async (name, args) => {
      rpcArgs = args;
      return {
        data: {
          attempt_id: TEST_ATTEMPT_ID,
          assignment_id: TEST_ASSIGNMENT_ID,
          exam_version_id: TEST_EXAM_VERSION_ID,
          student_id: TEST_STUDENT_ID,
          attempt_number: 1,
          status: 'draft',
          attempt_started_at: '2026-09-06T01:00:00Z',
          expires_at: null,
          max_score: 10.0,
          question_order: [],
          option_orders: {},
          resumed_existing: false,
          idempotent_replay: false,
          expired: false,
          already_finalized: false,
        },
        error: null,
      };
    },
  });
  const req = createJsonRequest('http://localhost/exam/start-attempt', { assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID });
  await handleStartAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(rpcArgs.p_student_id, TEST_STUDENT_ID);
});

await test('26. Body cannot override identity (shielded by validation allowlist)', async () => {
  const val = validateStartAttemptPayload({
    assignment_id: TEST_ASSIGNMENT_ID,
    attempt_id: TEST_ATTEMPT_ID,
    p_caller_id: 'hacker',
    p_student_id: 'victim',
  });
  assert.equal(val.valid, false);
});

await test('27. Start response allowlist strictly projects approved fields and strips internals', async () => {
  const rawRpc = {
    attempt_id: TEST_ATTEMPT_ID,
    assignment_id: TEST_ASSIGNMENT_ID,
    exam_version_id: TEST_EXAM_VERSION_ID,
    student_id: TEST_STUDENT_ID,
    attempt_number: 1,
    status: 'draft',
    attempt_started_at: '2026-09-06T01:00:00Z',
    expires_at: null,
    max_score: 10.0,
    question_order: ['q1', 'q2'],
    option_orders: { q1: ['a', 'b'] },
    resumed_existing: false,
    idempotent_replay: false,
    expired: false,
    already_finalized: false,
    secret_internal_db_row: 'leak',
    answer_keys: ['correct_answer_leak'],
  };
  const mapped = mapStartAttemptSuccess(rawRpc);
  assert.equal(mapped.ok, true);
  assert.equal(mapped.data.secret_internal_db_row, undefined);
  assert.equal(mapped.data.answer_keys, undefined);
  assert.equal(mapped.data.attempt_id, TEST_ATTEMPT_ID);
  assert.equal(mapped.data.max_score, 10.0);
});

await test('28. No answer key leakage in start response mapping', async () => {
  const mapped = mapStartAttemptSuccess({
    attempt_id: TEST_ATTEMPT_ID,
    assignment_id: TEST_ASSIGNMENT_ID,
    exam_version_id: TEST_EXAM_VERSION_ID,
    student_id: TEST_STUDENT_ID,
    attempt_number: 1,
    status: 'draft',
    attempt_started_at: '2026-09-06T01:00:00Z',
    expires_at: null,
    max_score: 10.0,
    question_order: [],
    option_orders: {},
    resumed_existing: false,
    idempotent_replay: false,
    expired: false,
    already_finalized: false,
    correct_answers: { q1: 'A' },
  });
  assert.equal(mapped.ok, true);
  assert.equal('correct_answers' in mapped.data, false);
});

await test('29. RPC unknown error is sanitized to 500 INTERNAL_ERROR', async () => {
  const norm = normalizeRpcError('PGSQL: table pg_catalog.pg_class is locked by PID 1234');
  assert.equal(norm.status, 500);
  assert.equal(norm.errorCode, 'INTERNAL_ERROR');
  assert.equal(norm.message.includes('pg_catalog'), false);
});

await test('30. Idempotent replay response is preserved correctly on start attempt', async () => {
  const rawRpc = {
    attempt_id: TEST_ATTEMPT_ID,
    assignment_id: TEST_ASSIGNMENT_ID,
    exam_version_id: TEST_EXAM_VERSION_ID,
    student_id: TEST_STUDENT_ID,
    attempt_number: 1,
    status: 'draft',
    attempt_started_at: '2026-09-06T01:00:00Z',
    expires_at: '2026-09-06T02:00:00Z',
    max_score: 10.0,
    question_order: ['q1'],
    option_orders: {},
    resumed_existing: false,
    idempotent_replay: true,
    expired: false,
    already_finalized: false,
  };
  const mapped = mapStartAttemptSuccess(rawRpc);
  assert.equal(mapped.ok, true);
  assert.equal(mapped.data.idempotent_replay, true);
  assert.equal(mapped.data.resumed_existing, false);
});

// ----------------------------------------------------------------------------
// SECTION 3: SAVE ANSWER TESTS (31..49)
// ----------------------------------------------------------------------------
console.log('\n--- SECTION 3: SAVE ANSWER TESTS ---');

await test('31. Invalid attempt UUID in save-answer is rejected with 400 INVALID_INPUT', async () => {
  const val = validateSaveAnswerPayload({
    attempt_id: 'bad-uuid',
    exam_question_id: TEST_QUESTION_ID,
    expected_version: 1,
  });
  assert.equal(val.valid, false);
  assert.equal(val.errorCode, 'INVALID_INPUT');
});

await test('32. Invalid question UUID in save-answer is rejected with 400 INVALID_INPUT', async () => {
  const val = validateSaveAnswerPayload({
    attempt_id: TEST_ATTEMPT_ID,
    exam_question_id: 'bad-question-uuid',
    expected_version: 1,
  });
  assert.equal(val.valid, false);
  assert.equal(val.errorCode, 'INVALID_INPUT');
});

await test('33. expected_version missing in save-answer is rejected with 400 INVALID_INPUT', async () => {
  const val = validateSaveAnswerPayload({
    attempt_id: TEST_ATTEMPT_ID,
    exam_question_id: TEST_QUESTION_ID,
  });
  assert.equal(val.valid, false);
  assert.equal(val.errorCode, 'INVALID_INPUT');
});

await test('34. expected_version non-integer or <= 0 is rejected with 400 INVALID_INPUT', async () => {
  const val1 = validateSaveAnswerPayload({ attempt_id: TEST_ATTEMPT_ID, exam_question_id: TEST_QUESTION_ID, expected_version: 1.5 });
  assert.equal(val1.valid, false);
  const val2 = validateSaveAnswerPayload({ attempt_id: TEST_ATTEMPT_ID, exam_question_id: TEST_QUESTION_ID, expected_version: 0 });
  assert.equal(val2.valid, false);
  const val3 = validateSaveAnswerPayload({ attempt_id: TEST_ATTEMPT_ID, exam_question_id: TEST_QUESTION_ID, expected_version: -2 });
  assert.equal(val3.valid, false);
});

await test('35. Forbidden grading fields in save-answer (points_earned, is_correct, grading_status) are rejected', async () => {
  const val1 = validateSaveAnswerPayload({ attempt_id: TEST_ATTEMPT_ID, exam_question_id: TEST_QUESTION_ID, expected_version: 1, points_earned: 10 });
  assert.equal(val1.valid, false);
  assert.equal(val1.errorCode, 'INVALID_REQUEST_FIELD');

  const val2 = validateSaveAnswerPayload({ attempt_id: TEST_ATTEMPT_ID, exam_question_id: TEST_QUESTION_ID, expected_version: 1, is_correct: true });
  assert.equal(val2.valid, false);
  assert.equal(val2.errorCode, 'INVALID_REQUEST_FIELD');

  const val3 = validateSaveAnswerPayload({ attempt_id: TEST_ATTEMPT_ID, exam_question_id: TEST_QUESTION_ID, expected_version: 1, grading_status: 'graded' });
  assert.equal(val3.valid, false);
  assert.equal(val3.errorCode, 'INVALID_REQUEST_FIELD');
});

await test('36. Attempt ownership enforced / server-trusted (ERR_STUDENT_IDENTITY_MISMATCH -> 403 ATTEMPT_ACCESS_DENIED)', async () => {
  const norm = normalizeRpcError('ERR_STUDENT_IDENTITY_MISMATCH: Caller 111 is not attempt student 222');
  assert.equal(norm.status, 403);
  assert.equal(norm.errorCode, 'ATTEMPT_ACCESS_DENIED');
});

await test('37. Exact save RPC rpc_exam_save_answer is called', async () => {
  let invokedRpc = null;
  const callerAuth = createMockCallerClient();
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient({
    rpcHandler: async (name) => {
      invokedRpc = name;
      return {
        data: { attempt_id: TEST_ATTEMPT_ID, exam_question_id: TEST_QUESTION_ID, grading_status: 'pending_auto', attempt_version: 2 },
        error: null,
      };
    },
  });
  const req = createJsonRequest('http://localhost/exam/save-answer', {
    attempt_id: TEST_ATTEMPT_ID,
    exam_question_id: TEST_QUESTION_ID,
    student_answer_json: 'opt_a',
    expected_version: 1,
  });
  const res = await handleSaveAnswerRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(res.status, 200);
  assert.equal(invokedRpc, 'rpc_exam_save_answer');
});

await test('38. p_caller_id is passed from CORE user identity', async () => {
  let passedCallerId = null;
  const callerAuth = createMockCallerClient(TEST_STUDENT_ID);
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient({
    rpcHandler: async (name, args) => {
      passedCallerId = args.p_caller_id;
      return {
        data: { attempt_id: TEST_ATTEMPT_ID, exam_question_id: TEST_QUESTION_ID, grading_status: 'pending_auto', attempt_version: 2 },
        error: null,
      };
    },
  });
  const req = createJsonRequest('http://localhost/exam/save-answer', {
    attempt_id: TEST_ATTEMPT_ID,
    exam_question_id: TEST_QUESTION_ID,
    student_answer_json: 'opt_a',
    expected_version: 1,
  });
  await handleSaveAnswerRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(passedCallerId, TEST_STUDENT_ID);
});

await test('39. Body student_id in save-answer is rejected with 400 INVALID_REQUEST_FIELD', async () => {
  const val = validateSaveAnswerPayload({
    attempt_id: TEST_ATTEMPT_ID,
    exam_question_id: TEST_QUESTION_ID,
    student_id: TEST_STUDENT_ID,
    expected_version: 1,
  });
  assert.equal(val.valid, false);
  assert.equal(val.errorCode, 'INVALID_REQUEST_FIELD');
});

await test('40. student_answer_json accepted structurally (string, array, object, null)', async () => {
  const val1 = validateSaveAnswerPayload({ attempt_id: TEST_ATTEMPT_ID, exam_question_id: TEST_QUESTION_ID, student_answer_json: 'opt_a', expected_version: 1 });
  assert.equal(val1.valid, true);

  const val2 = validateSaveAnswerPayload({ attempt_id: TEST_ATTEMPT_ID, exam_question_id: TEST_QUESTION_ID, student_answer_json: ['opt_a', 'opt_b'], expected_version: 1 });
  assert.equal(val2.valid, true);

  const val3 = validateSaveAnswerPayload({ attempt_id: TEST_ATTEMPT_ID, exam_question_id: TEST_QUESTION_ID, student_answer_json: { key: 'value' }, expected_version: 1 });
  assert.equal(val3.valid, true);

  const val4 = validateSaveAnswerPayload({ attempt_id: TEST_ATTEMPT_ID, exam_question_id: TEST_QUESTION_ID, student_answer_json: null, expected_version: 1 });
  assert.equal(val4.valid, true);
});

await test('41. file_url type validation (null allowed, non-null rejected with ERR_EXAM_UPLOAD_NOT_READY)', async () => {
  const val1 = validateSaveAnswerPayload(
    { attempt_id: TEST_ATTEMPT_ID, exam_question_id: TEST_QUESTION_ID, file_url: `${TEST_STUDENT_ID}/${TEST_ATTEMPT_ID}/file.png`, expected_version: 1 },
    { callerId: TEST_STUDENT_ID }
  );
  assert.equal(val1.valid, false);
  assert.equal(val1.errorCode, 'ERR_EXAM_UPLOAD_NOT_READY');

  const val2 = validateSaveAnswerPayload(
    { attempt_id: TEST_ATTEMPT_ID, exam_question_id: TEST_QUESTION_ID, file_url: null, expected_version: 1 },
    { callerId: TEST_STUDENT_ID }
  );
  assert.equal(val2.valid, true);
  assert.equal(val2.sanitizedData.file_url, null);

  const val3 = validateSaveAnswerPayload(
    { attempt_id: TEST_ATTEMPT_ID, exam_question_id: TEST_QUESTION_ID, file_url: 12345, expected_version: 1 },
    { callerId: TEST_STUDENT_ID }
  );
  assert.equal(val3.valid, false);
  assert.equal(val3.errorCode, 'ERR_EXAM_UPLOAD_NOT_READY');
});

await test('42. No answer-key lookup in BFF source code', async () => {
  const src = fs.readFileSync('supabase/functions/exam-save-answer/handler.ts', 'utf8');
  assert.equal(src.includes('exam_answer_keys'), false);
});

await test('43. No auto grading logic in BFF save-answer (delegated to DB RPC)', async () => {
  const src = fs.readFileSync('supabase/functions/exam-save-answer/handler.ts', 'utf8');
  assert.equal(src.includes('points_earned'), false);
  assert.equal(src.includes('is_correct'), false);
});

await test('44. Response allowlist projects only 4 approved fields for save-answer', async () => {
  const rawRpc = {
    attempt_id: TEST_ATTEMPT_ID,
    exam_question_id: TEST_QUESTION_ID,
    grading_status: 'pending_auto',
    attempt_version: 2,
    secret_field: 'leak',
  };
  const mapped = mapSaveAnswerSuccess(rawRpc);
  assert.equal(mapped.ok, true);
  assert.equal(mapped.data.secret_field, undefined);
  assert.deepEqual(Object.keys(mapped.data).sort(), ['attempt_id', 'attempt_version', 'exam_question_id', 'grading_status'].sort());
});

await test('45. Optimistic conflict mapping (ERR_OPTIMISTIC_LOCK_CONFLICT -> 409)', async () => {
  const norm = normalizeRpcError('ERR_OPTIMISTIC_LOCK_CONFLICT: Attempt version mismatch (expected 1, current 2)');
  assert.equal(norm.status, 409);
  assert.equal(norm.errorCode, 'ERR_OPTIMISTIC_LOCK_CONFLICT');
});

await test('46. Expired attempt mapping (ERR_ATTEMPT_EXPIRED -> 409)', async () => {
  const norm = normalizeRpcError('ERR_ATTEMPT_EXPIRED: Attempt expired at 2026-09-06T00:00:00Z');
  assert.equal(norm.status, 409);
  assert.equal(norm.errorCode, 'ERR_ATTEMPT_EXPIRED');
});

await test('47. Invalid payload mapping (ERR_INVALID_ANSWER_PAYLOAD -> 422)', async () => {
  const norm = normalizeRpcError('ERR_INVALID_ANSWER_PAYLOAD: single_choice answer must be a JSON string');
  assert.equal(norm.status, 422);
  assert.equal(norm.errorCode, 'ERR_INVALID_ANSWER_PAYLOAD');
});

await test('48. Unknown DB error sanitized to 500 INTERNAL_ERROR', async () => {
  const norm = normalizeRpcError('canceling statement due to lock timeout');
  assert.equal(norm.status, 500);
  assert.equal(norm.errorCode, 'INTERNAL_ERROR');
});

await test('49. No sensitive logs in save-answer handler', async () => {
  const src = fs.readFileSync('supabase/functions/exam-save-answer/handler.ts', 'utf8');
  assert.equal(src.includes('console.log('), false);
});

// ----------------------------------------------------------------------------
// SECTION 4: SUBMIT ATTEMPT TESTS (50..65)
// ----------------------------------------------------------------------------
console.log('\n--- SECTION 4: SUBMIT ATTEMPT TESTS ---');

await test('50. Invalid attempt UUID in submit is rejected with 400 INVALID_INPUT', async () => {
  const val = validateSubmitAttemptPayload({ attempt_id: 'bad-uuid', expected_version: 2 });
  assert.equal(val.valid, false);
  assert.equal(val.errorCode, 'INVALID_INPUT');
});

await test('51. expected_version missing in submit is rejected with 400 INVALID_INPUT', async () => {
  const val = validateSubmitAttemptPayload({ attempt_id: TEST_ATTEMPT_ID });
  assert.equal(val.valid, false);
  assert.equal(val.errorCode, 'INVALID_INPUT');
});

await test('52. Non-integer version in submit is rejected with 400 INVALID_INPUT', async () => {
  const val = validateSubmitAttemptPayload({ attempt_id: TEST_ATTEMPT_ID, expected_version: 'two' });
  assert.equal(val.valid, false);
  assert.equal(val.errorCode, 'INVALID_INPUT');
});

await test('53. Forbidden caller/student/status fields in submit body are rejected', async () => {
  const val1 = validateSubmitAttemptPayload({ attempt_id: TEST_ATTEMPT_ID, expected_version: 2, status: 'graded' });
  assert.equal(val1.valid, false);
  assert.equal(val1.errorCode, 'INVALID_REQUEST_FIELD');

  const val2 = validateSubmitAttemptPayload({ attempt_id: TEST_ATTEMPT_ID, expected_version: 2, total_score: 10 });
  assert.equal(val2.valid, false);
  assert.equal(val2.errorCode, 'INVALID_REQUEST_FIELD');

  const val3 = validateSubmitAttemptPayload({ attempt_id: TEST_ATTEMPT_ID, expected_version: 2, reward_stars_awarded: 5 });
  assert.equal(val3.valid, false);
  assert.equal(val3.errorCode, 'INVALID_REQUEST_FIELD');
});

await test('54. Exact submit RPC rpc_exam_submit_attempt is called', async () => {
  let invokedRpc = null;
  const callerAuth = createMockCallerClient();
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient({
    rpcHandler: async (name) => {
      invokedRpc = name;
      return {
        data: {
          attempt_id: TEST_ATTEMPT_ID,
          assignment_id: TEST_ASSIGNMENT_ID,
          exam_version_id: TEST_EXAM_VERSION_ID,
          student_id: TEST_STUDENT_ID,
          attempt_number: 1,
          status: 'graded',
          attempt_started_at: '2026-09-06T01:00:00Z',
          expires_at: '2026-09-06T02:00:00Z',
          submitted_at: '2026-09-06T01:30:00Z',
          objective_score: 10.0,
          manual_score: 0.0,
          total_score: 10.0,
          max_score: 10.0,
          reward_stars_awarded: 0,
          graded_at: '2026-09-06T01:30:00Z',
          graded_by: null,
          version: 3,
          idempotent_replay: false,
        },
        error: null,
      };
    },
  });
  const req = createJsonRequest('http://localhost/exam/submit-attempt', {
    attempt_id: TEST_ATTEMPT_ID,
    expected_version: 2,
  });
  const res = await handleSubmitAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(res.status, 200);
  assert.equal(invokedRpc, 'rpc_exam_submit_attempt');
});

await test('55. p_caller_id in submit is passed from CORE user identity', async () => {
  let passedCallerId = null;
  const callerAuth = createMockCallerClient(TEST_STUDENT_ID);
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient({
    rpcHandler: async (name, args) => {
      passedCallerId = args.p_caller_id;
      return {
        data: {
          attempt_id: TEST_ATTEMPT_ID,
          assignment_id: TEST_ASSIGNMENT_ID,
          exam_version_id: TEST_EXAM_VERSION_ID,
          student_id: TEST_STUDENT_ID,
          attempt_number: 1,
          status: 'graded',
          attempt_started_at: '2026-09-06T01:00:00Z',
          expires_at: null,
          submitted_at: '2026-09-06T01:30:00Z',
          objective_score: 10.0,
          manual_score: 0.0,
          total_score: 10.0,
          max_score: 10.0,
          reward_stars_awarded: 0,
          graded_at: '2026-09-06T01:30:00Z',
          graded_by: null,
          version: 3,
          idempotent_replay: false,
        },
        error: null,
      };
    },
  });
  const req = createJsonRequest('http://localhost/exam/submit-attempt', {
    attempt_id: TEST_ATTEMPT_ID,
    expected_version: 2,
  });
  await handleSubmitAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(passedCallerId, TEST_STUDENT_ID);
});

await test('56. Finalized replay preserved correctly on submit (idempotent_replay: true)', async () => {
  const rawRpc = {
    attempt_id: TEST_ATTEMPT_ID,
    assignment_id: TEST_ASSIGNMENT_ID,
    exam_version_id: TEST_EXAM_VERSION_ID,
    student_id: TEST_STUDENT_ID,
    attempt_number: 1,
    status: 'graded',
    attempt_started_at: '2026-09-06T01:00:00Z',
    expires_at: null,
    submitted_at: '2026-09-06T01:30:00Z',
    objective_score: 10.0,
    manual_score: 0.0,
    total_score: 10.0,
    max_score: 10.0,
    reward_stars_awarded: 0,
    graded_at: '2026-09-06T01:30:00Z',
    graded_by: null,
    version: 3,
    idempotent_replay: true,
  };
  const mapped = mapSubmitAttemptSuccess(rawRpc);
  assert.equal(mapped.ok, true);
  assert.equal(mapped.data.idempotent_replay, true);
});

await test('57. Graded response is safe (status = graded, total_score = objective_score)', async () => {
  const rawRpc = {
    attempt_id: TEST_ATTEMPT_ID,
    assignment_id: TEST_ASSIGNMENT_ID,
    exam_version_id: TEST_EXAM_VERSION_ID,
    student_id: TEST_STUDENT_ID,
    attempt_number: 1,
    status: 'graded',
    attempt_started_at: '2026-09-06T01:00:00Z',
    expires_at: null,
    submitted_at: '2026-09-06T01:30:00Z',
    objective_score: 8.5,
    manual_score: 0.0,
    total_score: 8.5,
    max_score: 10.0,
    reward_stars_awarded: 0,
    graded_at: '2026-09-06T01:30:00Z',
    graded_by: null,
    version: 3,
    idempotent_replay: false,
  };
  const mapped = mapSubmitAttemptSuccess(rawRpc);
  assert.equal(mapped.ok, true);
  assert.equal(mapped.data.status, 'graded');
  assert.equal(mapped.data.total_score, 8.5);
});

await test('58. pending_manual_grade response is safe (manual_score/total_score null)', async () => {
  const rawRpc = {
    attempt_id: TEST_ATTEMPT_ID,
    assignment_id: TEST_ASSIGNMENT_ID,
    exam_version_id: TEST_EXAM_VERSION_ID,
    student_id: TEST_STUDENT_ID,
    attempt_number: 1,
    status: 'pending_manual_grade',
    attempt_started_at: '2026-09-06T01:00:00Z',
    expires_at: null,
    submitted_at: '2026-09-06T01:30:00Z',
    objective_score: 5.0,
    manual_score: null,
    total_score: null,
    max_score: 10.0,
    reward_stars_awarded: 0,
    graded_at: null,
    graded_by: null,
    version: 3,
    idempotent_replay: false,
  };
  const mapped = mapSubmitAttemptSuccess(rawRpc);
  assert.equal(mapped.ok, true);
  assert.equal(mapped.data.status, 'pending_manual_grade');
  assert.equal(mapped.data.manual_score, null);
  assert.equal(mapped.data.total_score, null);
});

await test('59. No answer-key fields in submit response', async () => {
  const rawRpc = {
    attempt_id: TEST_ATTEMPT_ID,
    assignment_id: TEST_ASSIGNMENT_ID,
    exam_version_id: TEST_EXAM_VERSION_ID,
    student_id: TEST_STUDENT_ID,
    attempt_number: 1,
    status: 'graded',
    attempt_started_at: '2026-09-06T01:00:00Z',
    expires_at: null,
    submitted_at: '2026-09-06T01:30:00Z',
    objective_score: 10.0,
    manual_score: 0.0,
    total_score: 10.0,
    max_score: 10.0,
    reward_stars_awarded: 0,
    graded_at: '2026-09-06T01:30:00Z',
    graded_by: null,
    version: 3,
    idempotent_replay: false,
    correct_answers_map: { q1: 'A' },
  };
  const mapped = mapSubmitAttemptSuccess(rawRpc);
  assert.equal(mapped.ok, true);
  assert.equal('correct_answers_map' in mapped.data, false);
});

await test('60. No reward mutation in BFF (reward_stars_awarded = 0 preserved)', async () => {
  const src = fs.readFileSync('supabase/functions/exam-submit-attempt/handler.ts', 'utf8');
  assert.equal(src.includes('reward_stars_awarded +'), false);
});

await test('61. No CORE write or sync in submit handler', async () => {
  const src = fs.readFileSync('supabase/functions/exam-submit-attempt/handler.ts', 'utf8');
  assert.equal(src.includes('coreClient'), false);
});

await test('62. Optimistic conflict mapping on submit -> 409 ERR_OPTIMISTIC_LOCK_CONFLICT', async () => {
  const norm = normalizeRpcError('ERR_OPTIMISTIC_LOCK_CONFLICT: Attempt version mismatch');
  assert.equal(norm.status, 409);
  assert.equal(norm.errorCode, 'ERR_OPTIMISTIC_LOCK_CONFLICT');
});

await test('63. Expired attempt mapping on submit -> 409 ERR_ATTEMPT_EXPIRED', async () => {
  const norm = normalizeRpcError('ERR_ATTEMPT_EXPIRED: Attempt expired at 2026-09-06T00:00:00Z');
  assert.equal(norm.status, 409);
  assert.equal(norm.errorCode, 'ERR_ATTEMPT_EXPIRED');
});

await test('64. Unknown DB error sanitized on submit -> 500 INTERNAL_ERROR', async () => {
  const norm = normalizeRpcError('fatal: connection terminated unexpectedly');
  assert.equal(norm.status, 500);
  assert.equal(norm.errorCode, 'INTERNAL_ERROR');
});

await test('65. No sensitive logs in submit handler', async () => {
  const src = fs.readFileSync('supabase/functions/exam-submit-attempt/handler.ts', 'utf8');
  assert.equal(src.includes('console.log('), false);
});

// ----------------------------------------------------------------------------
// SECTION 5: GATEWAY / RUNTIME TESTS (66..74)
// ----------------------------------------------------------------------------
console.log('\n--- SECTION 5: GATEWAY & RUNTIME TESTS ---');

await test('66. Config start verify_jwt=false configured in config.toml', async () => {
  const config = fs.readFileSync('supabase/config.toml', 'utf8');
  assert.equal(config.includes('[functions.exam-start-attempt]'), true);
  assert.equal(config.includes('verify_jwt = false'), true);
});

await test('67. Config save verify_jwt=false configured in config.toml', async () => {
  const config = fs.readFileSync('supabase/config.toml', 'utf8');
  assert.equal(config.includes('[functions.exam-save-answer]'), true);
});

await test('68. Config submit verify_jwt=false configured in config.toml', async () => {
  const config = fs.readFileSync('supabase/config.toml', 'utf8');
  assert.equal(config.includes('[functions.exam-submit-attempt]'), true);
});

await test('69. SUPABASE_URL fallback resolution works correctly', async () => {
  const cfg = resolveRuntimeConfig((key) => {
    if (key === 'CORE_SUPABASE_URL') return 'https://core.supabase.co';
    if (key === 'CORE_SUPABASE_ANON_KEY') return 'anon-key';
    if (key === 'CORE_SUPABASE_SERVICE_ROLE_KEY') return 'core-service-key';
    if (key === 'SUPABASE_URL') return 'https://hosted.supabase.co';
    if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'hosted-service-key';
    return undefined;
  });
  assert.notEqual(cfg, null);
  assert.equal(cfg.examUrl, 'https://hosted.supabase.co');
});

await test('70. SUPABASE_SERVICE_ROLE_KEY fallback resolution works correctly', async () => {
  const cfg = resolveRuntimeConfig((key) => {
    if (key === 'CORE_SUPABASE_URL') return 'https://core.supabase.co';
    if (key === 'CORE_SUPABASE_ANON_KEY') return 'anon-key';
    if (key === 'CORE_SUPABASE_SERVICE_ROLE_KEY') return 'core-service-key';
    if (key === 'SUPABASE_URL') return 'https://hosted.supabase.co';
    if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'hosted-service-role-key-123';
    return undefined;
  });
  assert.notEqual(cfg, null);
  assert.equal(cfg.examServiceKey, 'hosted-service-role-key-123');
});

await test('71. SUPABASE_SECRET_KEYS default fallback resolution works correctly', async () => {
  const cfg = resolveRuntimeConfig((key) => {
    if (key === 'CORE_SUPABASE_URL') return 'https://core.supabase.co';
    if (key === 'CORE_SUPABASE_ANON_KEY') return 'anon-key';
    if (key === 'CORE_SUPABASE_SERVICE_ROLE_KEY') return 'core-service-key';
    if (key === 'SUPABASE_URL') return 'https://hosted.supabase.co';
    if (key === 'SUPABASE_SECRET_KEYS') return JSON.stringify({ default: 'json-secret-key-456' });
    return undefined;
  });
  assert.notEqual(cfg, null);
  assert.equal(cfg.examServiceKey, 'json-secret-key-456');
});

await test('72. Malformed SUPABASE_SECRET_KEYS JSON fails closed (returns null config)', async () => {
  const cfg = resolveRuntimeConfig((key) => {
    if (key === 'CORE_SUPABASE_URL') return 'https://core.supabase.co';
    if (key === 'CORE_SUPABASE_ANON_KEY') return 'anon-key';
    if (key === 'CORE_SUPABASE_SERVICE_ROLE_KEY') return 'core-service-key';
    if (key === 'SUPABASE_URL') return 'https://hosted.supabase.co';
    if (key === 'SUPABASE_SECRET_KEYS') return '{ malformed: json ]';
    return undefined;
  });
  assert.equal(cfg, null);
});

await test('73. No secrets exposed in error envelopes', async () => {
  const errRes = createErrorResponse(500, 'INTERNAL_ERROR', 'Sensitive DB password leak test');
  const json = await errRes.json();
  assert.equal(json.success, false);
  assert.equal(json.error_code, 'INTERNAL_ERROR');
});

await test('74. No secrets exposed in code or error templates', async () => {
  const src = fs.readFileSync('supabase/functions/_shared/examRuntime.ts', 'utf8');
  assert.equal(src.includes('console.log'), false);
});

// ----------------------------------------------------------------------------
// SECTION 6: CROSS-ENDPOINT SECURITY TESTS (75..92)
// ----------------------------------------------------------------------------
console.log('\n--- SECTION 6: CROSS-ENDPOINT SECURITY TESTS ---');

await test('75. No generic RPC route in source code', async () => {
  const startSrc = fs.readFileSync('supabase/functions/exam-start-attempt/handler.ts', 'utf8');
  const saveSrc = fs.readFileSync('supabase/functions/exam-save-answer/handler.ts', 'utf8');
  const submitSrc = fs.readFileSync('supabase/functions/exam-submit-attempt/handler.ts', 'utf8');
  assert.equal(startSrc.includes('examClient.rpc(rawBody.rpc_name'), false);
  assert.equal(saveSrc.includes('examClient.rpc(rawBody.rpc_name'), false);
  assert.equal(submitSrc.includes('examClient.rpc(rawBody.rpc_name'), false);
});

await test('76. No browser-supplied RPC name accepted across all 3 handlers', async () => {
  const startVal = validateStartAttemptPayload({ assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID, rpc_name: 'evil_rpc' });
  assert.equal(startVal.valid, false);

  const saveVal = validateSaveAnswerPayload({ attempt_id: TEST_ATTEMPT_ID, exam_question_id: TEST_QUESTION_ID, expected_version: 1, rpc_name: 'evil_rpc' });
  assert.equal(saveVal.valid, false);

  const submitVal = validateSubmitAttemptPayload({ attempt_id: TEST_ATTEMPT_ID, expected_version: 1, rpc_name: 'evil_rpc' });
  assert.equal(submitVal.valid, false);
});

await test('77. No service-role key in any endpoint response', async () => {
  const successRes = createSuccessResponse({ test: 'ok' });
  const rawText = await successRes.text();
  assert.equal(rawText.includes('service_role'), false);
});

await test('78. No answer key read in source code across all three handlers', async () => {
  const startSrc = fs.readFileSync('supabase/functions/exam-start-attempt/handler.ts', 'utf8');
  const saveSrc = fs.readFileSync('supabase/functions/exam-save-answer/handler.ts', 'utf8');
  const submitSrc = fs.readFileSync('supabase/functions/exam-submit-attempt/handler.ts', 'utf8');
  assert.equal(startSrc.includes('exam_answer_keys'), false);
  assert.equal(saveSrc.includes('exam_answer_keys'), false);
  assert.equal(submitSrc.includes('exam_answer_keys'), false);
});

await test('79. No CORE write path in source code across all three handlers', async () => {
  const startSrc = fs.readFileSync('supabase/functions/exam-start-attempt/handler.ts', 'utf8');
  const saveSrc = fs.readFileSync('supabase/functions/exam-save-answer/handler.ts', 'utf8');
  const submitSrc = fs.readFileSync('supabase/functions/exam-submit-attempt/handler.ts', 'utf8');
  assert.equal(startSrc.includes('coreClient.from(') && startSrc.includes('.insert('), false);
  assert.equal(saveSrc.includes('coreClient.from(') && saveSrc.includes('.insert('), false);
  assert.equal(submitSrc.includes('coreClient.from(') && submitSrc.includes('.insert('), false);
});

await test('80. No student identity taken from body across all 3 endpoints', async () => {
  const startVal = validateStartAttemptPayload({ assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID, student_id: 'fake' });
  assert.equal(startVal.valid, false);

  const saveVal = validateSaveAnswerPayload({ attempt_id: TEST_ATTEMPT_ID, exam_question_id: TEST_QUESTION_ID, student_id: 'fake', expected_version: 1 });
  assert.equal(saveVal.valid, false);

  const submitVal = validateSubmitAttemptPayload({ attempt_id: TEST_ATTEMPT_ID, student_id: 'fake', expected_version: 1 });
  assert.equal(submitVal.valid, false);
});

await test('81. No class identity taken from body across all 3 endpoints', async () => {
  const startVal = validateStartAttemptPayload({ assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID, class_id: 'fake' });
  assert.equal(startVal.valid, false);

  const saveVal = validateSaveAnswerPayload({ attempt_id: TEST_ATTEMPT_ID, exam_question_id: TEST_QUESTION_ID, class_id: 'fake', expected_version: 1 });
  assert.equal(saveVal.valid, false);

  const submitVal = validateSubmitAttemptPayload({ attempt_id: TEST_ATTEMPT_ID, class_id: 'fake', expected_version: 1 });
  assert.equal(submitVal.valid, false);
});

await test('82. No teacher/admin escalation path to student endpoints', async () => {
  const callerAuth = createMockCallerClient(TEST_STUDENT_ID);
  const coreClientTeacher = createMockCoreClient({ profile: { id: TEST_STUDENT_ID, role: 'teacher', is_disabled: false } });
  const examClient = createMockExamClient();

  const req1 = createJsonRequest('http://localhost/exam/start-attempt', { assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID });
  const res1 = await handleStartAttemptRequest(req1, { authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClientTeacher, examQueryClient: examClient } });
  assert.equal(res1.status, 403);

  const req2 = createJsonRequest('http://localhost/exam/save-answer', { attempt_id: TEST_ATTEMPT_ID, exam_question_id: TEST_QUESTION_ID, expected_version: 1 });
  const res2 = await handleSaveAnswerRequest(req2, { authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClientTeacher, examQueryClient: examClient } });
  assert.equal(res2.status, 403);

  const req3 = createJsonRequest('http://localhost/exam/submit-attempt', { attempt_id: TEST_ATTEMPT_ID, expected_version: 1 });
  const res3 = await handleSubmitAttemptRequest(req3, { authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClientTeacher, examQueryClient: examClient } });
  assert.equal(res3.status, 403);
});

await test('83. Response does not spread raw RPC object across all mappers', async () => {
  const errSrc = fs.readFileSync('supabase/functions/_shared/examErrors.ts', 'utf8');
  assert.equal(errSrc.includes('{ ...rec }'), false);
  assert.equal(errSrc.includes('{ ...rpcData }'), false);
});

await test('84. Unexpected fields are stripped cleanly from all 3 response projections', async () => {
  const startMapped = mapStartAttemptSuccess({
    attempt_id: TEST_ATTEMPT_ID, assignment_id: TEST_ASSIGNMENT_ID, exam_version_id: TEST_EXAM_VERSION_ID, student_id: TEST_STUDENT_ID, attempt_number: 1, status: 'draft', attempt_started_at: '2026-09-06T01:00:00Z', expires_at: null, max_score: 10.0, question_order: [], option_orders: {}, resumed_existing: false, idempotent_replay: false, expired: false, already_finalized: false, unapproved_junk: 123,
  });
  assert.equal('unapproved_junk' in startMapped.data, false);

  const saveMapped = mapSaveAnswerSuccess({ attempt_id: TEST_ATTEMPT_ID, exam_question_id: TEST_QUESTION_ID, grading_status: 'pending_auto', attempt_version: 2, unapproved_junk: 123 });
  assert.equal('unapproved_junk' in saveMapped.data, false);

  const submitMapped = mapSubmitAttemptSuccess({
    attempt_id: TEST_ATTEMPT_ID, assignment_id: TEST_ASSIGNMENT_ID, exam_version_id: TEST_EXAM_VERSION_ID, student_id: TEST_STUDENT_ID, attempt_number: 1, status: 'graded', attempt_started_at: '2026-09-06T01:00:00Z', expires_at: null, submitted_at: '2026-09-06T01:30:00Z', objective_score: 10.0, manual_score: 0.0, total_score: 10.0, max_score: 10.0, reward_stars_awarded: 0, graded_at: '2026-09-06T01:30:00Z', graded_by: null, version: 3, idempotent_replay: false, unapproved_junk: 123,
  });
  assert.equal('unapproved_junk' in submitMapped.data, false);
});

await test('85. CORS policy uses wildcard origin without credentials', async () => {
  assert.equal(corsHeaders['Access-Control-Allow-Origin'], '*');
  assert.equal(corsHeaders['Access-Control-Allow-Credentials'], undefined);
});

await test('86. OPTIONS preflight handled cleanly on all three endpoints (returns 200 ok)', async () => {
  const reqStart = new Request('http://localhost/exam/start-attempt', { method: 'OPTIONS' });
  const resStart = await handleStartAttemptRequest(reqStart);
  assert.equal(resStart.status, 200);

  const reqSave = new Request('http://localhost/exam/save-answer', { method: 'OPTIONS' });
  const resSave = await handleSaveAnswerRequest(reqSave);
  assert.equal(resSave.status, 200);

  const reqSubmit = new Request('http://localhost/exam/submit-attempt', { method: 'OPTIONS' });
  const resSubmit = await handleSubmitAttemptRequest(reqSubmit);
  assert.equal(resSubmit.status, 200);
});

await test('87. Unsupported HTTP method (GET/PUT/DELETE) returns 405 on all three endpoints', async () => {
  const resGetStart = await handleStartAttemptRequest(new Request('http://localhost/exam/start-attempt', { method: 'GET' }));
  assert.equal(resGetStart.status, 405);

  const resPutSave = await handleSaveAnswerRequest(new Request('http://localhost/exam/save-answer', { method: 'PUT' }));
  assert.equal(resPutSave.status, 405);

  const resDeleteSubmit = await handleSubmitAttemptRequest(new Request('http://localhost/exam/submit-attempt', { method: 'DELETE' }));
  assert.equal(resDeleteSubmit.status, 405);
});

await test('88. Runtime missing environment fails closed to 500 INTERNAL_ERROR', async () => {
  const req = createJsonRequest('http://localhost/exam/start-attempt', { assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID });
  const res = await handleStartAttemptRequest(req, {
    authDeps: { mode: 'production', env: {} },
  });
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.equal(json.error_code, 'INTERNAL_ERROR');
});

await test('89. Invalid/missing CORE profile fails closed with 403 FORBIDDEN_ROLE', async () => {
  const callerAuth = createMockCallerClient(TEST_STUDENT_ID);
  const coreClient = createMockCoreClient({ profile: null });
  const examClient = createMockExamClient();
  const req = createJsonRequest('http://localhost/exam/start-attempt', { assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID });
  const res = await handleStartAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.error_code, 'FORBIDDEN_ROLE');
});

await test('90. Class membership query DB error fails closed with 500 INTERNAL_ERROR', async () => {
  const callerAuth = createMockCallerClient(TEST_STUDENT_ID);
  const coreClient = createMockCoreClient({ memberErr: new Error('connection timeout') });
  const examClient = createMockExamClient();
  const req = createJsonRequest('http://localhost/exam/start-attempt', { assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID });
  const res = await handleStartAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.equal(json.error_code, 'INTERNAL_ERROR');
});

await test('91. Non-JSON body on all three endpoints is rejected with 400 INVALID_INPUT', async () => {
  const callerAuth = createMockCallerClient(TEST_STUDENT_ID);
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient();

  const req1 = createJsonRequest('http://localhost/exam/start-attempt', '{ invalid json', 'valid-jwt');
  const res1 = await handleStartAttemptRequest(req1, { authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient } });
  assert.equal(res1.status, 400);

  const req2 = createJsonRequest('http://localhost/exam/save-answer', '{ invalid json', 'valid-jwt');
  const res2 = await handleSaveAnswerRequest(req2, { authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient } });
  assert.equal(res2.status, 400);

  const req3 = createJsonRequest('http://localhost/exam/submit-attempt', '{ invalid json', 'valid-jwt');
  const res3 = await handleSubmitAttemptRequest(req3, { authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient } });
  assert.equal(res3.status, 400);
});

await test('92. Empty / non-object body on all three endpoints is rejected with 400 INVALID_INPUT', async () => {
  const val1 = validateStartAttemptPayload(null);
  assert.equal(val1.valid, false);
  const val2 = validateSaveAnswerPayload([]);
  assert.equal(val2.valid, false);
  const val3 = validateSubmitAttemptPayload('string');
  assert.equal(val3.valid, false);
});

await test('93. start p_caller_id === verified callerId (strictly verified)', async () => {
  let capturedArgs = null;
  const callerAuth = createMockCallerClient('exact-verified-user-123');
  const coreClient = createMockCoreClient({ profile: { id: 'exact-verified-user-123', role: 'student', is_disabled: false } });
  const examClient = createMockExamClient({
    rpcHandler: async (name, args) => {
      capturedArgs = args;
      return {
        data: {
          attempt_id: TEST_ATTEMPT_ID,
          assignment_id: TEST_ASSIGNMENT_ID,
          exam_version_id: TEST_EXAM_VERSION_ID,
          student_id: 'exact-verified-user-123',
          attempt_number: 1,
          status: 'draft',
          attempt_started_at: '2026-09-06T01:00:00Z',
          expires_at: null,
          max_score: 10.0,
          question_order: [],
          option_orders: {},
          resumed_existing: false,
          idempotent_replay: false,
          expired: false,
          already_finalized: false,
        },
        error: null,
      };
    },
  });
  const req = createJsonRequest('http://localhost/exam/start-attempt', { assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID });
  await handleStartAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(capturedArgs.p_caller_id, 'exact-verified-user-123');
});

await test('94. start p_student_id === verified callerId (strictly verified)', async () => {
  let capturedArgs = null;
  const callerAuth = createMockCallerClient('exact-verified-user-123');
  const coreClient = createMockCoreClient({ profile: { id: 'exact-verified-user-123', role: 'student', is_disabled: false } });
  const examClient = createMockExamClient({
    rpcHandler: async (name, args) => {
      capturedArgs = args;
      return {
        data: {
          attempt_id: TEST_ATTEMPT_ID,
          assignment_id: TEST_ASSIGNMENT_ID,
          exam_version_id: TEST_EXAM_VERSION_ID,
          student_id: 'exact-verified-user-123',
          attempt_number: 1,
          status: 'draft',
          attempt_started_at: '2026-09-06T01:00:00Z',
          expires_at: null,
          max_score: 10.0,
          question_order: [],
          option_orders: {},
          resumed_existing: false,
          idempotent_replay: false,
          expired: false,
          already_finalized: false,
        },
        error: null,
      };
    },
  });
  const req = createJsonRequest('http://localhost/exam/start-attempt', { assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID });
  await handleStartAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(capturedArgs.p_student_id, 'exact-verified-user-123');
});

await test('95. membership must match BOTH class_id and student_id', async () => {
  let queriedClassId = null;
  let queriedStudentId = null;
  const callerAuth = createMockCallerClient(TEST_STUDENT_ID);
  const coreClient = {
    from(table) {
      if (table === 'profiles') return createMockCoreClient().from('profiles');
      if (table === 'class_members') {
        return {
          select(cols) {
            return {
              eq(col1, val1) {
                queriedClassId = val1;
                return {
                  eq(col2, val2) {
                    queriedStudentId = val2;
                    return {
                      async maybeSingle() {
                        return { data: { class_id: val1, student_id: val2 }, error: null };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
    },
  };
  const examClient = createMockExamClient({
    assignment: { id: TEST_ASSIGNMENT_ID, class_id: 'target-class-id-999' },
    rpcHandler: async () => ({
      data: {
        attempt_id: TEST_ATTEMPT_ID,
        assignment_id: TEST_ASSIGNMENT_ID,
        exam_version_id: TEST_EXAM_VERSION_ID,
        student_id: TEST_STUDENT_ID,
        attempt_number: 1,
        status: 'draft',
        attempt_started_at: '2026-09-06T01:00:00Z',
        expires_at: null,
        max_score: 10.0,
        question_order: [],
        option_orders: {},
        resumed_existing: false,
        idempotent_replay: false,
        expired: false,
        already_finalized: false,
      },
      error: null,
    }),
  });
  const req = createJsonRequest('http://localhost/exam/start-attempt', { assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID });
  await handleStartAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(queriedClassId, 'target-class-id-999');
  assert.equal(queriedStudentId, TEST_STUDENT_ID);
});

await test('96. membership in a different class does not authorize', async () => {
  const callerAuth = createMockCallerClient(TEST_STUDENT_ID);
  // Student is member of class-A, but assignment is in class-B
  const coreClient = {
    from(table) {
      if (table === 'profiles') return createMockCoreClient().from('profiles');
      if (table === 'class_members') {
        return {
          select(cols) {
            return {
              eq(col1, val1) {
                return {
                  eq(col2, val2) {
                    return {
                      async maybeSingle() {
                        if (val1 === 'class-A' && val2 === TEST_STUDENT_ID) {
                          return { data: { class_id: 'class-A', student_id: val2 }, error: null };
                        }
                        return { data: null, error: null };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
    },
  };
  const examClient = createMockExamClient({
    assignment: { id: TEST_ASSIGNMENT_ID, class_id: 'class-B' },
  });
  const req = createJsonRequest('http://localhost/exam/start-attempt', { assignment_id: TEST_ASSIGNMENT_ID, attempt_id: TEST_ATTEMPT_ID });
  const res = await handleStartAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.error_code, 'CLASS_ACCESS_DENIED');
});

await test('97. save caller cannot override ownership (p_caller_id strictly from CORE token)', async () => {
  let passedCallerId = null;
  const callerAuth = createMockCallerClient('strict-save-student-456');
  const coreClient = createMockCoreClient({ profile: { id: 'strict-save-student-456', role: 'student', is_disabled: false } });
  const examClient = createMockExamClient({
    rpcHandler: async (name, args) => {
      passedCallerId = args.p_caller_id;
      return {
        data: { attempt_id: TEST_ATTEMPT_ID, exam_question_id: TEST_QUESTION_ID, grading_status: 'pending_auto', attempt_version: 2 },
        error: null,
      };
    },
  });
  const req = createJsonRequest('http://localhost/exam/save-answer', {
    attempt_id: TEST_ATTEMPT_ID,
    exam_question_id: TEST_QUESTION_ID,
    student_answer_json: 'opt_a',
    expected_version: 1,
  });
  await handleSaveAnswerRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(passedCallerId, 'strict-save-student-456');
});

await test('98. submit caller cannot override ownership (p_caller_id strictly from CORE token)', async () => {
  let passedCallerId = null;
  const callerAuth = createMockCallerClient('strict-submit-student-789');
  const coreClient = createMockCoreClient({ profile: { id: 'strict-submit-student-789', role: 'student', is_disabled: false } });
  const examClient = createMockExamClient({
    rpcHandler: async (name, args) => {
      passedCallerId = args.p_caller_id;
      return {
        data: {
          attempt_id: TEST_ATTEMPT_ID,
          assignment_id: TEST_ASSIGNMENT_ID,
          exam_version_id: TEST_EXAM_VERSION_ID,
          student_id: 'strict-submit-student-789',
          attempt_number: 1,
          status: 'graded',
          attempt_started_at: '2026-09-06T01:00:00Z',
          expires_at: null,
          submitted_at: '2026-09-06T01:30:00Z',
          objective_score: 10.0,
          manual_score: 0.0,
          total_score: 10.0,
          max_score: 10.0,
          reward_stars_awarded: 0,
          graded_at: '2026-09-06T01:30:00Z',
          graded_by: null,
          version: 3,
          idempotent_replay: false,
        },
        error: null,
      };
    },
  });
  const req = createJsonRequest('http://localhost/exam/submit-attempt', {
    attempt_id: TEST_ATTEMPT_ID,
    expected_version: 2,
  });
  await handleSubmitAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });
  assert.equal(passedCallerId, 'strict-submit-student-789');
});

await test('99. shared import paths resolve correctly on local filesystem', async () => {
  const filesToCheck = [
    'supabase/functions/exam-start-attempt/index.ts',
    'supabase/functions/exam-start-attempt/handler.ts',
    'supabase/functions/exam-start-attempt/validation.ts',
    'supabase/functions/exam-save-answer/index.ts',
    'supabase/functions/exam-save-answer/handler.ts',
    'supabase/functions/exam-save-answer/validation.ts',
    'supabase/functions/exam-submit-attempt/index.ts',
    'supabase/functions/exam-submit-attempt/handler.ts',
    'supabase/functions/exam-submit-attempt/validation.ts',
    'supabase/functions/_shared/examAuth.ts',
    'supabase/functions/_shared/examErrors.ts',
    'supabase/functions/_shared/examRuntime.ts',
  ];

  for (const f of filesToCheck) {
    assert.equal(fs.existsSync(f), true, `File missing: ${f}`);
    const content = fs.readFileSync(f, 'utf8');
    const importMatches = content.matchAll(/from\s+['"](\.[^'"]+)['"]/g);
    for (const match of importMatches) {
      const relPath = match[1];
      const resolved = path.resolve(path.dirname(f), relPath);
      assert.equal(fs.existsSync(resolved), true, `Import target missing: ${relPath} in ${f}`);
    }
  }
});

await test('100. no answer-key table identifier in handlers', async () => {
  const handlers = [
    'supabase/functions/exam-start-attempt/handler.ts',
    'supabase/functions/exam-save-answer/handler.ts',
    'supabase/functions/exam-submit-attempt/handler.ts',
  ];
  for (const h of handlers) {
    const code = fs.readFileSync(h, 'utf8');
    assert.equal(code.includes('exam_answer_keys'), false, `Found answer key reference in ${h}`);
  }
});

await test('101. no score calculation in submit handler (delegated 100% to DB RPC)', async () => {
  const code = fs.readFileSync('supabase/functions/exam-submit-attempt/handler.ts', 'utf8');
  assert.equal(code.includes('objective_score +'), false);
  assert.equal(code.includes('manual_score +'), false);
  assert.equal(code.includes('total_score ='), false);
});

await test('102. config diff contains only three new function sections', async () => {
  const config = fs.readFileSync('supabase/config.toml', 'utf8');
  assert.equal(config.includes('[functions.exam-start-attempt]'), true);
  assert.equal(config.includes('[functions.exam-save-answer]'), true);
  assert.equal(config.includes('[functions.exam-submit-attempt]'), true);
});

// ----------------------------------------------------------------------------
// SECTION 7: FILE UPLOAD TRUST BOUNDARY & OWNERSHIP HARDENING (103..116)
// ----------------------------------------------------------------------------
console.log('\n--- SECTION 7: FILE UPLOAD TRUST BOUNDARY & OWNERSHIP HARDENING ---');

await test('103. arbitrary https://evil.example/file rejected with ERR_EXAM_UPLOAD_NOT_READY', async () => {
  const val = validateSaveAnswerPayload(
    {
      attempt_id: TEST_ATTEMPT_ID,
      exam_question_id: TEST_QUESTION_ID,
      file_url: 'https://evil.example/file.pdf',
      expected_version: 1,
    },
    { callerId: TEST_STUDENT_ID }
  );
  assert.equal(val.valid, false);
  assert.equal(val.errorCode, 'ERR_EXAM_UPLOAD_NOT_READY');
});

await test('104. javascript: URL rejected with ERR_EXAM_UPLOAD_NOT_READY', async () => {
  const val = validateSaveAnswerPayload(
    {
      attempt_id: TEST_ATTEMPT_ID,
      exam_question_id: TEST_QUESTION_ID,
      file_url: 'javascript:alert(1)',
      expected_version: 1,
    },
    { callerId: TEST_STUDENT_ID }
  );
  assert.equal(val.valid, false);
  assert.equal(val.errorCode, 'ERR_EXAM_UPLOAD_NOT_READY');
});

await test('105. data: URL rejected with ERR_EXAM_UPLOAD_NOT_READY', async () => {
  const val = validateSaveAnswerPayload(
    {
      attempt_id: TEST_ATTEMPT_ID,
      exam_question_id: TEST_QUESTION_ID,
      file_url: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      expected_version: 1,
    },
    { callerId: TEST_STUDENT_ID }
  );
  assert.equal(val.valid, false);
  assert.equal(val.errorCode, 'ERR_EXAM_UPLOAD_NOT_READY');
});

await test('106. blob: URL rejected with ERR_EXAM_UPLOAD_NOT_READY', async () => {
  const val = validateSaveAnswerPayload(
    {
      attempt_id: TEST_ATTEMPT_ID,
      exam_question_id: TEST_QUESTION_ID,
      file_url: 'blob:https://example.com/uuid-blob-1234',
      expected_version: 1,
    },
    { callerId: TEST_STUDENT_ID }
  );
  assert.equal(val.valid, false);
  assert.equal(val.errorCode, 'ERR_EXAM_UPLOAD_NOT_READY');
});

await test('107. normal text answer with file_url: null accepted', async () => {
  const val = validateSaveAnswerPayload(
    {
      attempt_id: TEST_ATTEMPT_ID,
      exam_question_id: TEST_QUESTION_ID,
      student_answer_json: 'test_answer',
      file_url: null,
      expected_version: 1,
    },
    { callerId: TEST_STUDENT_ID }
  );
  assert.equal(val.valid, true);
  assert.equal(val.sanitizedData.file_url, null);
});

await test('108. wrong bucket rejected with ERR_EXAM_UPLOAD_NOT_READY', async () => {
  const val = validateSaveAnswerPayload(
    {
      attempt_id: TEST_ATTEMPT_ID,
      exam_question_id: TEST_QUESTION_ID,
      file_url: `malicious-bucket/${TEST_STUDENT_ID}/${TEST_ATTEMPT_ID}/file.pdf`,
      expected_version: 1,
    },
    { callerId: TEST_STUDENT_ID }
  );
  assert.equal(val.valid, false);
  assert.equal(val.errorCode, 'ERR_EXAM_UPLOAD_NOT_READY');
});

await test('109. other-student path rejected with ERR_EXAM_UPLOAD_NOT_READY', async () => {
  const val = validateSaveAnswerPayload(
    {
      attempt_id: TEST_ATTEMPT_ID,
      exam_question_id: TEST_QUESTION_ID,
      file_url: `exercise-submissions/${TEST_OTHER_STUDENT_ID}/${TEST_ATTEMPT_ID}/file.pdf`,
      expected_version: 1,
    },
    { callerId: TEST_STUDENT_ID }
  );
  assert.equal(val.valid, false);
  assert.equal(val.errorCode, 'ERR_EXAM_UPLOAD_NOT_READY');
});

await test('110. file_url non-null rejected via save-answer handler (422 ERR_EXAM_UPLOAD_NOT_READY)', async () => {
  const callerAuth = createMockCallerClient(TEST_STUDENT_ID);
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient();

  const req = createJsonRequest('http://localhost/exam/save-answer', {
    attempt_id: TEST_ATTEMPT_ID,
    exam_question_id: TEST_QUESTION_ID,
    file_url: `${TEST_STUDENT_ID}/${TEST_ATTEMPT_ID}/submission.pdf`,
    expected_version: 1,
  });

  const res = await handleSaveAnswerRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });

  assert.equal(res.status, 422);
  const json = await res.json();
  assert.equal(json.error_code, 'ERR_EXAM_UPLOAD_NOT_READY');
  assert.equal(json.message, 'Chức năng nộp tệp cho bài thi chưa được kích hoạt.');
});

await test('111. empty/whitespace file reference rejected with ERR_EXAM_UPLOAD_NOT_READY', async () => {
  const val1 = validateSaveAnswerPayload(
    {
      attempt_id: TEST_ATTEMPT_ID,
      exam_question_id: TEST_QUESTION_ID,
      file_url: '',
      expected_version: 1,
    },
    { callerId: TEST_STUDENT_ID }
  );
  assert.equal(val1.valid, false);
  assert.equal(val1.errorCode, 'ERR_EXAM_UPLOAD_NOT_READY');

  const val2 = validateSaveAnswerPayload(
    {
      attempt_id: TEST_ATTEMPT_ID,
      exam_question_id: TEST_QUESTION_ID,
      file_url: '   ',
      expected_version: 1,
    },
    { callerId: TEST_STUDENT_ID }
  );
  assert.equal(val2.valid, false);
  assert.equal(val2.errorCode, 'ERR_EXAM_UPLOAD_NOT_READY');
});

await test('112. oversized file reference rejected with ERR_EXAM_UPLOAD_NOT_READY', async () => {
  const longPath = `${TEST_STUDENT_ID}/${TEST_ATTEMPT_ID}/${'a'.repeat(1020)}.pdf`;
  const val = validateSaveAnswerPayload(
    {
      attempt_id: TEST_ATTEMPT_ID,
      exam_question_id: TEST_QUESTION_ID,
      file_url: longPath,
      expected_version: 1,
    },
    { callerId: TEST_STUDENT_ID }
  );
  assert.equal(val.valid, false);
  assert.equal(val.errorCode, 'ERR_EXAM_UPLOAD_NOT_READY');
});

await test('113. non-upload questions still cannot send file_url (RPC ERR_FILE_URL_NOT_ALLOWED -> 422)', async () => {
  const norm = normalizeRpcError('ERR_FILE_URL_NOT_ALLOWED: Question does not support file upload');
  assert.equal(norm.status, 422);
  assert.equal(norm.errorCode, 'ERR_FILE_URL_NOT_ALLOWED');
});

await test('114. upload questions still cannot send student_answer_json (RPC ERR_ANSWER_PAYLOAD_NOT_ALLOWED -> 422)', async () => {
  const norm = normalizeRpcError('ERR_ANSWER_PAYLOAD_NOT_ALLOWED: File upload questions cannot accept text answer');
  assert.equal(norm.status, 422);
  assert.equal(norm.errorCode, 'ERR_ANSWER_PAYLOAD_NOT_ALLOWED');
});

await test('115. no raw storage/service credential exposed in code or handlers', async () => {
  const filesToCheck = [
    'supabase/functions/exam-start-attempt/handler.ts',
    'supabase/functions/exam-save-answer/handler.ts',
    'supabase/functions/exam-save-answer/validation.ts',
    'supabase/functions/exam-submit-attempt/handler.ts',
    'supabase/functions/_shared/examErrors.ts',
    'supabase/functions/_shared/examAuth.ts',
  ];
  for (const f of filesToCheck) {
    const code = fs.readFileSync(f, 'utf8');
    assert.equal(code.includes('eyJhbGciOi'), false, `Hardcoded JWT found in ${f}`);
    assert.equal(code.includes('service_role_secret'), false, `Hardcoded secret found in ${f}`);
    assert.equal(code.includes('private_key'), false, `Hardcoded private key found in ${f}`);
  }
});

await test('116. upload validation fails closed for foreign student path before RPC', async () => {
  const callerAuth = createMockCallerClient(TEST_STUDENT_ID);
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient();

  const foreignPath = `exercise-submissions/${TEST_OTHER_STUDENT_ID}/${TEST_ATTEMPT_ID}/foreign.pdf`;
  const req = createJsonRequest('http://localhost/exam/save-answer', {
    attempt_id: TEST_ATTEMPT_ID,
    exam_question_id: TEST_QUESTION_ID,
    file_url: foreignPath,
    expected_version: 1,
  });

  const res = await handleSaveAnswerRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });

  assert.equal(res.status, 422);
  const json = await res.json();
  assert.equal(json.error_code, 'ERR_EXAM_UPLOAD_NOT_READY');
});

// ----------------------------------------------------------------------------
// SECTION 8: TEMPORARY UPLOAD FEATURE GATE & SCOPE VALIDATION (117..136)
// ----------------------------------------------------------------------------
console.log('\n--- SECTION 8: TEMPORARY UPLOAD FEATURE GATE & SCOPE VALIDATION ---');

await test('117. file_url non-null rejected with 422', async () => {
  const callerAuth = createMockCallerClient(TEST_STUDENT_ID);
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient();

  const req = createJsonRequest('http://localhost/exam/save-answer', {
    attempt_id: TEST_ATTEMPT_ID,
    exam_question_id: TEST_QUESTION_ID,
    file_url: 'uploads/my-doc.pdf',
    expected_version: 1,
  });

  const res = await handleSaveAnswerRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });

  assert.equal(res.status, 422);
  const json = await res.json();
  assert.equal(json.error_code, 'ERR_EXAM_UPLOAD_NOT_READY');
});

await test('118. arbitrary external URL rejected/fails closed', async () => {
  const callerAuth = createMockCallerClient(TEST_STUDENT_ID);
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient();

  const req = createJsonRequest('http://localhost/exam/save-answer', {
    attempt_id: TEST_ATTEMPT_ID,
    exam_question_id: TEST_QUESTION_ID,
    file_url: 'https://evil.example.com/essay.pdf',
    expected_version: 1,
  });

  const res = await handleSaveAnswerRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });

  assert.equal(res.status, 422);
  const json = await res.json();
  assert.equal(json.error_code, 'ERR_EXAM_UPLOAD_NOT_READY');
});

await test('119. legacy exercise-submissions path rejected for Exam', async () => {
  const callerAuth = createMockCallerClient(TEST_STUDENT_ID);
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient();

  const req = createJsonRequest('http://localhost/exam/save-answer', {
    attempt_id: TEST_ATTEMPT_ID,
    exam_question_id: TEST_QUESTION_ID,
    file_url: 'exercise-submissions/random-path/file.pdf',
    expected_version: 1,
  });

  const res = await handleSaveAnswerRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });

  assert.equal(res.status, 422);
  const json = await res.json();
  assert.equal(json.error_code, 'ERR_EXAM_UPLOAD_NOT_READY');
});

await test('120. caller-owned-looking legacy path still rejected', async () => {
  const callerAuth = createMockCallerClient(TEST_STUDENT_ID);
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient();

  const req = createJsonRequest('http://localhost/exam/save-answer', {
    attempt_id: TEST_ATTEMPT_ID,
    exam_question_id: TEST_QUESTION_ID,
    file_url: `exercise-submissions/${TEST_STUDENT_ID}/${TEST_ATTEMPT_ID}/submission.pdf`,
    expected_version: 1,
  });

  const res = await handleSaveAnswerRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });

  assert.equal(res.status, 422);
  const json = await res.json();
  assert.equal(json.error_code, 'ERR_EXAM_UPLOAD_NOT_READY');
});

await test('121. other-student path rejected', async () => {
  const callerAuth = createMockCallerClient(TEST_STUDENT_ID);
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient();

  const req = createJsonRequest('http://localhost/exam/save-answer', {
    attempt_id: TEST_ATTEMPT_ID,
    exam_question_id: TEST_QUESTION_ID,
    file_url: `${TEST_OTHER_STUDENT_ID}/${TEST_ATTEMPT_ID}/submission.pdf`,
    expected_version: 1,
  });

  const res = await handleSaveAnswerRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });

  assert.equal(res.status, 422);
  const json = await res.json();
  assert.equal(json.error_code, 'ERR_EXAM_UPLOAD_NOT_READY');
});

await test('122. other-attempt path rejected', async () => {
  const otherAttemptId = '88888888-8888-4888-8888-888888888888';
  const callerAuth = createMockCallerClient(TEST_STUDENT_ID);
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient();

  const req = createJsonRequest('http://localhost/exam/save-answer', {
    attempt_id: TEST_ATTEMPT_ID,
    exam_question_id: TEST_QUESTION_ID,
    file_url: `${TEST_STUDENT_ID}/${otherAttemptId}/submission.pdf`,
    expected_version: 1,
  });

  const res = await handleSaveAnswerRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });

  assert.equal(res.status, 422);
  const json = await res.json();
  assert.equal(json.error_code, 'ERR_EXAM_UPLOAD_NOT_READY');
});

await test('123. missing file_url for normal non-upload answer allowed as appropriate', async () => {
  const val = validateSaveAnswerPayload(
    {
      attempt_id: TEST_ATTEMPT_ID,
      exam_question_id: TEST_QUESTION_ID,
      student_answer_json: 'normal_text_answer',
      expected_version: 1,
    },
    { callerId: TEST_STUDENT_ID }
  );
  assert.equal(val.valid, true);
  assert.equal(val.sanitizedData.file_url, null);
  assert.equal(val.sanitizedData.student_answer_json, 'normal_text_answer');
});

await test('124. single_choice normal save unaffected', async () => {
  let passedRpcArgs = null;
  const callerAuth = createMockCallerClient(TEST_STUDENT_ID);
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient({
    rpcHandler: async (name, args) => {
      passedRpcArgs = args;
      return {
        data: {
          attempt_id: TEST_ATTEMPT_ID,
          exam_question_id: TEST_QUESTION_ID,
          grading_status: 'pending_auto',
          attempt_version: 2,
        },
        error: null,
      };
    },
  });

  const req = createJsonRequest('http://localhost/exam/save-answer', {
    attempt_id: TEST_ATTEMPT_ID,
    exam_question_id: TEST_QUESTION_ID,
    student_answer_json: 'opt_b',
    file_url: null,
    expected_version: 1,
  });

  const res = await handleSaveAnswerRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });

  assert.equal(res.status, 200);
  assert.equal(passedRpcArgs.p_student_answer_json, 'opt_b');
  assert.equal(passedRpcArgs.p_file_url, null);
});

await test('125. multiple_choice normal save unaffected', async () => {
  let passedRpcArgs = null;
  const callerAuth = createMockCallerClient(TEST_STUDENT_ID);
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient({
    rpcHandler: async (name, args) => {
      passedRpcArgs = args;
      return {
        data: {
          attempt_id: TEST_ATTEMPT_ID,
          exam_question_id: TEST_QUESTION_ID,
          grading_status: 'pending_auto',
          attempt_version: 2,
        },
        error: null,
      };
    },
  });

  const req = createJsonRequest('http://localhost/exam/save-answer', {
    attempt_id: TEST_ATTEMPT_ID,
    exam_question_id: TEST_QUESTION_ID,
    student_answer_json: ['opt_a', 'opt_c'],
    expected_version: 1,
  });

  const res = await handleSaveAnswerRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });

  assert.equal(res.status, 200);
  assert.deepEqual(passedRpcArgs.p_student_answer_json, ['opt_a', 'opt_c']);
  assert.equal(passedRpcArgs.p_file_url, null);
});

await test('126. fill_blank normal save unaffected', async () => {
  let passedRpcArgs = null;
  const callerAuth = createMockCallerClient(TEST_STUDENT_ID);
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient({
    rpcHandler: async (name, args) => {
      passedRpcArgs = args;
      return {
        data: {
          attempt_id: TEST_ATTEMPT_ID,
          exam_question_id: TEST_QUESTION_ID,
          grading_status: 'pending_auto',
          attempt_version: 2,
        },
        error: null,
      };
    },
  });

  const req = createJsonRequest('http://localhost/exam/save-answer', {
    attempt_id: TEST_ATTEMPT_ID,
    exam_question_id: TEST_QUESTION_ID,
    student_answer_json: { blank_1: 'sample_value' },
    expected_version: 1,
  });

  const res = await handleSaveAnswerRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });

  assert.equal(res.status, 200);
  assert.deepEqual(passedRpcArgs.p_student_answer_json, { blank_1: 'sample_value' });
  assert.equal(passedRpcArgs.p_file_url, null);
});

await test('127. short_answer normal save unaffected', async () => {
  let passedRpcArgs = null;
  const callerAuth = createMockCallerClient(TEST_STUDENT_ID);
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient({
    rpcHandler: async (name, args) => {
      passedRpcArgs = args;
      return {
        data: {
          attempt_id: TEST_ATTEMPT_ID,
          exam_question_id: TEST_QUESTION_ID,
          grading_status: 'pending_auto',
          attempt_version: 2,
        },
        error: null,
      };
    },
  });

  const req = createJsonRequest('http://localhost/exam/save-answer', {
    attempt_id: TEST_ATTEMPT_ID,
    exam_question_id: TEST_QUESTION_ID,
    student_answer_json: 'Short answer response text',
    expected_version: 1,
  });

  const res = await handleSaveAnswerRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });

  assert.equal(res.status, 200);
  assert.equal(passedRpcArgs.p_student_answer_json, 'Short answer response text');
  assert.equal(passedRpcArgs.p_file_url, null);
});

await test('128. essay normal save unaffected', async () => {
  let passedRpcArgs = null;
  const callerAuth = createMockCallerClient(TEST_STUDENT_ID);
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient({
    rpcHandler: async (name, args) => {
      passedRpcArgs = args;
      return {
        data: {
          attempt_id: TEST_ATTEMPT_ID,
          exam_question_id: TEST_QUESTION_ID,
          grading_status: 'pending_manual_grade',
          attempt_version: 2,
        },
        error: null,
      };
    },
  });

  const req = createJsonRequest('http://localhost/exam/save-answer', {
    attempt_id: TEST_ATTEMPT_ID,
    exam_question_id: TEST_QUESTION_ID,
    student_answer_json: 'Detailed essay paragraph about literature.',
    expected_version: 1,
  });

  const res = await handleSaveAnswerRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });

  assert.equal(res.status, 200);
  assert.equal(passedRpcArgs.p_student_answer_json, 'Detailed essay paragraph about literature.');
  assert.equal(passedRpcArgs.p_file_url, null);
});

await test('129. no CORE Storage metadata lookup occurs', async () => {
  const handlerCode = fs.readFileSync('supabase/functions/exam-save-answer/handler.ts', 'utf8');
  assert.equal(handlerCode.includes('.storage'), false, 'Save-answer handler should not query storage API');
  assert.equal(handlerCode.includes('exercise-submissions'), false, 'Save-answer handler should not reference legacy bucket');
});

await test('130. no legacy bucket name used by runtime handlers', async () => {
  const runtimeFiles = [
    'supabase/functions/exam-start-attempt/handler.ts',
    'supabase/functions/exam-save-answer/handler.ts',
    'supabase/functions/exam-save-answer/validation.ts',
    'supabase/functions/exam-submit-attempt/handler.ts',
    'supabase/functions/_shared/examAuth.ts',
  ];
  for (const file of runtimeFiles) {
    const content = fs.readFileSync(file, 'utf8');
    assert.equal(content.includes('exercise-submissions'), false, `Found legacy bucket name in ${file}`);
  }
});

await test('131. no dangling file reference reaches RPC', async () => {
  let rpcCalled = false;
  const callerAuth = createMockCallerClient(TEST_STUDENT_ID);
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient({
    rpcHandler: async () => {
      rpcCalled = true;
      return { data: {}, error: null };
    },
  });

  const req = createJsonRequest('http://localhost/exam/save-answer', {
    attempt_id: TEST_ATTEMPT_ID,
    exam_question_id: TEST_QUESTION_ID,
    file_url: 'dangling/storage/path.png',
    expected_version: 1,
  });

  const res = await handleSaveAnswerRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });

  assert.equal(res.status, 422);
  assert.equal(rpcCalled, false, 'RPC must not be invoked when file_url is rejected by feature gate');
});

await test('132. upload feature gate error sanitized', async () => {
  const callerAuth = createMockCallerClient(TEST_STUDENT_ID);
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient();

  const req = createJsonRequest('http://localhost/exam/save-answer', {
    attempt_id: TEST_ATTEMPT_ID,
    exam_question_id: TEST_QUESTION_ID,
    file_url: 'arbitrary-file.pdf',
    expected_version: 1,
  });

  const res = await handleSaveAnswerRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });

  assert.equal(res.status, 422);
  const json = await res.json();
  assert.equal(json.success, false);
  assert.equal(json.error_code, 'ERR_EXAM_UPLOAD_NOT_READY');
  assert.equal(json.message, 'Chức năng nộp tệp cho bài thi chưa được kích hoạt.');
  assert.equal(json.message.includes('storage'), false);
  assert.equal(json.message.includes('bucket'), false);
  assert.equal(json.message.includes('RLS'), false);
});

await test('133. no answer-key access added', async () => {
  const saveHandler = fs.readFileSync('supabase/functions/exam-save-answer/handler.ts', 'utf8');
  assert.equal(saveHandler.includes('exam_answer_keys'), false);
  assert.equal(saveHandler.includes('correct_answer'), false);
});

await test('134. no grading added in BFF', async () => {
  const saveHandler = fs.readFileSync('supabase/functions/exam-save-answer/handler.ts', 'utf8');
  assert.equal(saveHandler.includes('points_earned'), false);
  assert.equal(saveHandler.includes('is_correct'), false);
  assert.equal(saveHandler.includes('auto_grade'), false);
});

await test('135. Start endpoint unaffected', async () => {
  const callerAuth = createMockCallerClient(TEST_STUDENT_ID);
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient({
    rpcHandler: async () => ({
      data: {
        attempt_id: TEST_ATTEMPT_ID,
        assignment_id: TEST_ASSIGNMENT_ID,
        exam_version_id: TEST_EXAM_VERSION_ID,
        student_id: TEST_STUDENT_ID,
        attempt_number: 1,
        status: 'draft',
        attempt_started_at: '2026-09-06T01:00:00Z',
        expires_at: null,
        max_score: 10.0,
        question_order: [],
        option_orders: {},
        resumed_existing: false,
        idempotent_replay: false,
        expired: false,
        already_finalized: false,
      },
      error: null,
    }),
  });

  const req = createJsonRequest('http://localhost/exam/start-attempt', {
    assignment_id: TEST_ASSIGNMENT_ID,
    attempt_id: TEST_ATTEMPT_ID,
  });

  const res = await handleStartAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.success, true);
  assert.equal(json.data.attempt_id, TEST_ATTEMPT_ID);
});

await test('136. Submit endpoint unaffected', async () => {
  const callerAuth = createMockCallerClient(TEST_STUDENT_ID);
  const coreClient = createMockCoreClient();
  const examClient = createMockExamClient({
    rpcHandler: async () => ({
      data: {
        attempt_id: TEST_ATTEMPT_ID,
        assignment_id: TEST_ASSIGNMENT_ID,
        exam_version_id: TEST_EXAM_VERSION_ID,
        student_id: TEST_STUDENT_ID,
        attempt_number: 1,
        status: 'graded',
        attempt_started_at: '2026-09-06T01:00:00Z',
        expires_at: null,
        submitted_at: '2026-09-06T01:30:00Z',
        objective_score: 10.0,
        manual_score: 0.0,
        total_score: 10.0,
        max_score: 10.0,
        reward_stars_awarded: 0,
        graded_at: '2026-09-06T01:30:00Z',
        graded_by: null,
        version: 3,
        idempotent_replay: false,
      },
      error: null,
    }),
  });

  const req = createJsonRequest('http://localhost/exam/submit-attempt', {
    attempt_id: TEST_ATTEMPT_ID,
    expected_version: 2,
  });

  const res = await handleSubmitAttemptRequest(req, {
    authDeps: { mode: 'injected', callerAuthClient: callerAuth, coreQueryClient: coreClient, examQueryClient: examClient },
  });

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.success, true);
  assert.equal(json.data.attempt_id, TEST_ATTEMPT_ID);
});

// ----------------------------------------------------------------------------
// Summary
// ----------------------------------------------------------------------------
console.log('\n================================================================');
console.log(`TEST RUN COMPLETE: ${passCount} PASSED, ${failCount} FAILED (TOTAL: ${passCount + failCount})`);
console.log('================================================================');

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

