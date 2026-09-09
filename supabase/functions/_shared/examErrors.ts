// supabase/functions/_shared/examErrors.ts
// Standardized Error & Success Envelopes and Normalization for Student BFF Endpoints

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'INVALID_TOKEN'
  | 'FORBIDDEN_ROLE'
  | 'ACCOUNT_DISABLED'
  | 'CLASS_ACCESS_DENIED'
  | 'ATTEMPT_ACCESS_DENIED'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'METHOD_NOT_ALLOWED'
  | 'INVALID_INPUT'
  | 'INVALID_REQUEST_FIELD'
  | 'ATTEMPT_NOT_FOUND'
  | 'ERR_ASSIGNMENT_NOT_FOUND'
  | 'ERR_ATTEMPT_NOT_FOUND'
  | 'ERR_QUESTION_NOT_FOUND'
  | 'ERR_VERSION_NOT_FOUND'
  | 'ERR_EXAM_NOT_FOUND'
  | 'ERR_OPTIMISTIC_LOCK_CONFLICT'
  | 'ERR_ATTEMPT_ALREADY_FINALIZED'
  | 'ERR_ATTEMPT_FINALIZED'
  | 'ERR_ATTEMPT_NOT_DRAFT'
  | 'ERR_ATTEMPT_EXPIRED'
  | 'ERR_MAX_ATTEMPTS_EXCEEDED'
  | 'ERR_IDEMPOTENCY_CONFLICT'
  | 'ERR_DUPLICATE_OPTION_KEYS'
  | 'ERR_VERSION_NOT_PUBLISHED'
  | 'ERR_INVALID_TOTAL_POINTS'
  | 'ERR_EXAM_ARCHIVED'
  | 'ERR_EXAM_NOT_STARTED'
  | 'ERR_EXAM_CLOSED'
  | 'ERR_FILE_URL_NOT_ALLOWED'
  | 'ERR_INVALID_ANSWER_PAYLOAD'
  | 'ERR_INVALID_OPTION_KEY'
  | 'ERR_ANSWER_PAYLOAD_NOT_ALLOWED'
  | 'ERR_FILE_URL_REQUIRED'
  | 'ERR_UNKNOWN_QUESTION_TYPE'
  | 'ERR_QUESTION_VERSION_MISMATCH'
  | 'ERR_REQUIRED_PARAMS'
  | 'ERR_INVALID_EVENT_SOURCE'
  | 'ERR_INVALID_TAB_SWITCH_POLICY'
  | 'FILE_REFERENCE_NOT_FOUND'
  | 'ERR_EXAM_UPLOAD_NOT_READY'
  | 'ERR_INVALID_OPTION_SCHEMA'
  | 'ERR_OPTION_SNAPSHOT_INVALID'
  | 'ERR_ATTEMPT_SNAPSHOT_INVALID'
  | 'ERR_QUESTION_SNAPSHOT_INVALID'
  | 'INTERNAL_ERROR';

export interface ErrorEnvelope {
  success: false;
  error_code: ErrorCode;
  message: string;
}

export interface SuccessEnvelope<T = unknown> {
  success: true;
  data: T;
}

export function createErrorResponse(
  status: number,
  errorCode: ErrorCode,
  message: string,
  extraHeaders?: Record<string, string>
): Response {
  const body: ErrorEnvelope = {
    success: false,
    error_code: errorCode,
    message: message,
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(extraHeaders || {}),
    },
  });
}

export function createSuccessResponse<T>(
  data: T,
  status = 200,
  extraHeaders?: Record<string, string>
): Response {
  const body: SuccessEnvelope<T> = {
    success: true,
    data: data,
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(extraHeaders || {}),
    },
  });
}

// ----------------------------------------------------------------------------
// Deterministic RPC Error Normalizer (Fail-Closed & Sanitized for General Exam BFFs)
// ----------------------------------------------------------------------------
export function normalizeRpcError(err: unknown): { status: number; errorCode: ErrorCode; message: string } {
  const rawMsg = typeof err === 'string'
    ? err
    : (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string')
      ? (err as { message: string }).message
      : '';

  // 403 Forbidden Domain Errors
  if (rawMsg.includes('ERR_STUDENT_IDENTITY_MISMATCH')) {
    return { status: 403, errorCode: 'ATTEMPT_ACCESS_DENIED', message: 'Bạn không có quyền truy cập lượt thi này.' };
  }

  // 404 Not Found Domain Errors
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

  // 409 Conflict Domain Errors
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

  // 422 Unprocessable Entity Domain Errors
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

  // 500 Fallback Sanitized (Zero SQL / DB leak)
  return {
    status: 500,
    errorCode: 'INTERNAL_ERROR',
    message: 'Đã xảy ra lỗi nội bộ trong quá trình xử lý bài thi.',
  };
}

// ----------------------------------------------------------------------------
// Scoped Anti-Oracle Error Normalizer for Integrity Event BFF
// ----------------------------------------------------------------------------
export function normalizeIntegrityRpcError(err: unknown): { status: number; errorCode: ErrorCode; message: string } {
  const rawMsg = typeof err === 'string'
    ? err
    : (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string')
      ? (err as { message: string }).message
      : '';

  // 400 Bad Request Domain Errors
  if (rawMsg.includes('ERR_REQUIRED_PARAMS')) {
    return { status: 400, errorCode: 'INVALID_INPUT', message: 'Thiếu tham số bắt buộc trong yêu cầu.' };
  }
  if (rawMsg.includes('ERR_INVALID_EVENT_SOURCE')) {
    return { status: 400, errorCode: 'ERR_INVALID_EVENT_SOURCE', message: 'Nguồn sự kiện không hợp lệ.' };
  }

  // 404 Not Found & Anti-Oracle Protection (Unified 404 for nonexistent attempt or student mismatch)
  if (rawMsg.includes('ERR_STUDENT_IDENTITY_MISMATCH') || rawMsg.includes('ERR_ATTEMPT_NOT_FOUND')) {
    return { status: 404, errorCode: 'ATTEMPT_NOT_FOUND', message: 'Không tìm thấy lượt làm bài thi.' };
  }

  // 409 Conflict Domain Errors
  if (rawMsg.includes('ERR_ATTEMPT_FINALIZED') || rawMsg.includes('ERR_ATTEMPT_NOT_DRAFT')) {
    return { status: 409, errorCode: 'ERR_ATTEMPT_ALREADY_FINALIZED', message: 'Lượt làm bài đã được nộp hoặc hoàn thành trước đó.' };
  }
  if (rawMsg.includes('ERR_ATTEMPT_EXPIRED')) {
    return { status: 409, errorCode: 'ERR_ATTEMPT_EXPIRED', message: 'Thời gian làm bài thi đã kết thúc.' };
  }

  // 422 Unprocessable Entity Domain Errors
  if (rawMsg.includes('ERR_INVALID_TAB_SWITCH_POLICY')) {
    return { status: 422, errorCode: 'ERR_INVALID_TAB_SWITCH_POLICY', message: 'Cấu hình kiểm soát chuyển tab của đề thi không hợp lệ.' };
  }

  // 500 Fallback Sanitized (Zero SQL / DB leak)
  return {
    status: 500,
    errorCode: 'INTERNAL_ERROR',
    message: 'Đã xảy ra lỗi nội bộ trong quá trình xử lý sự kiện bài thi.',
  };
}

// ----------------------------------------------------------------------------
// Response Projection Allowlist (Strict Allowlist - Fail-Closed)
// ----------------------------------------------------------------------------

export interface ApprovedStartAttemptResult {
  attempt_id: string;
  assignment_id: string;
  exam_version_id: string;
  student_id: string;
  attempt_number: number;
  status: string;
  attempt_started_at: string;
  expires_at: string | null;
  max_score: number;
  question_order: unknown;
  option_orders: unknown;
  attempt_version: number;
  resumed_existing: boolean;
  idempotent_replay: boolean;
  expired: boolean;
  already_finalized: boolean;
}

export function mapStartAttemptSuccess(
  rpcData: unknown
): { ok: true; data: ApprovedStartAttemptResult } | { ok: false } {
  if (!rpcData || typeof rpcData !== 'object' || Array.isArray(rpcData)) {
    return { ok: false };
  }

  const rec = rpcData as Record<string, unknown>;

  if (typeof rec.attempt_id !== 'string' || !rec.attempt_id) return { ok: false };
  if (typeof rec.assignment_id !== 'string' || !rec.assignment_id) return { ok: false };
  if (typeof rec.exam_version_id !== 'string' || !rec.exam_version_id) return { ok: false };
  if (typeof rec.student_id !== 'string' || !rec.student_id) return { ok: false };
  if (typeof rec.attempt_number !== 'number' || rec.attempt_number < 1) return { ok: false };
  if (typeof rec.status !== 'string' || !rec.status) return { ok: false };
  if (typeof rec.attempt_started_at !== 'string' || !rec.attempt_started_at) return { ok: false };
  if (typeof rec.max_score !== 'number' || Number.isNaN(rec.max_score)) return { ok: false };
  if (typeof rec.attempt_version !== 'number' || !Number.isInteger(rec.attempt_version) || rec.attempt_version < 1) return { ok: false };
  if (typeof rec.resumed_existing !== 'boolean') return { ok: false };
  if (typeof rec.idempotent_replay !== 'boolean') return { ok: false };
  if (typeof rec.expired !== 'boolean') return { ok: false };
  if (typeof rec.already_finalized !== 'boolean') return { ok: false };

  const expiresAt = rec.expires_at === null ? null : (typeof rec.expires_at === 'string' ? rec.expires_at : null);

  const projected: ApprovedStartAttemptResult = {
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
    attempt_version: rec.attempt_version,
    resumed_existing: rec.resumed_existing,
    idempotent_replay: rec.idempotent_replay,
    expired: rec.expired,
    already_finalized: rec.already_finalized,
  };

  return { ok: true, data: projected };
}

export interface ApprovedSaveAnswerResult {
  attempt_id: string;
  exam_question_id: string;
  grading_status: string;
  attempt_version: number;
}

export function mapSaveAnswerSuccess(
  rpcData: unknown
): { ok: true; data: ApprovedSaveAnswerResult } | { ok: false } {
  if (!rpcData || typeof rpcData !== 'object' || Array.isArray(rpcData)) {
    return { ok: false };
  }

  const rec = rpcData as Record<string, unknown>;

  if (typeof rec.attempt_id !== 'string' || !rec.attempt_id) return { ok: false };
  if (typeof rec.exam_question_id !== 'string' || !rec.exam_question_id) return { ok: false };
  if (typeof rec.grading_status !== 'string' || !rec.grading_status) return { ok: false };
  if (typeof rec.attempt_version !== 'number' || !Number.isInteger(rec.attempt_version) || rec.attempt_version < 1) return { ok: false };

  const projected: ApprovedSaveAnswerResult = {
    attempt_id: rec.attempt_id,
    exam_question_id: rec.exam_question_id,
    grading_status: rec.grading_status,
    attempt_version: rec.attempt_version,
  };

  return { ok: true, data: projected };
}

export interface ApprovedSubmitAttemptResult {
  attempt_id: string;
  assignment_id: string;
  exam_version_id: string;
  student_id: string;
  attempt_number: number;
  status: string;
  attempt_started_at: string;
  expires_at: string | null;
  submitted_at: string;
  objective_score: number | null;
  manual_score: number | null;
  total_score: number | null;
  max_score: number;
  reward_stars_awarded: number;
  graded_at: string | null;
  graded_by: string | null;
  version: number;
  idempotent_replay: boolean;
}

export function mapSubmitAttemptSuccess(
  rpcData: unknown
): { ok: true; data: ApprovedSubmitAttemptResult } | { ok: false } {
  if (!rpcData || typeof rpcData !== 'object' || Array.isArray(rpcData)) {
    return { ok: false };
  }

  const rec = rpcData as Record<string, unknown>;

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

  const projected: ApprovedSubmitAttemptResult = {
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

export interface ApprovedIntegrityEventResult {
  attempt_id: string;
  tab_switch_policy: 'WARN_AND_LOG' | 'WARN_ONLY' | 'OFF';
  tab_switch_count: number;
  active_leave_episode_id: string | null;
  event_recorded: boolean;
  event_type: 'episode_opened' | 'episode_closed' | 'focus_loss_auxiliary' | null;
  idempotent_replay: boolean;
}

export function mapRecordIntegrityEventSuccess(
  rpcData: unknown
): { ok: true; data: ApprovedIntegrityEventResult } | { ok: false } {
  if (!rpcData || typeof rpcData !== 'object' || Array.isArray(rpcData)) {
    return { ok: false };
  }

  const rec = rpcData as Record<string, unknown>;

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
    : (typeof rec.event_type === 'string' && ['episode_opened', 'episode_closed', 'focus_loss_auxiliary'].includes(rec.event_type) ? rec.event_type as ApprovedIntegrityEventResult['event_type'] : null);

  const projected: ApprovedIntegrityEventResult = {
    attempt_id: rec.attempt_id,
    tab_switch_policy: rec.tab_switch_policy as 'WARN_AND_LOG' | 'WARN_ONLY' | 'OFF',
    tab_switch_count: rec.tab_switch_count,
    active_leave_episode_id: activeEpisodeId,
    event_recorded: rec.event_recorded,
    event_type: eventType,
    idempotent_replay: rec.idempotent_replay,
  };

  return { ok: true, data: projected };
}

// ----------------------------------------------------------------------------
// Scoped Error Normalizer for Question Delivery BFF (Phase 3E-B0)
// ----------------------------------------------------------------------------
export function normalizeGetAttemptQuestionsRpcError(
  err: unknown
): { status: number; errorCode: ErrorCode; message: string } {
  const rawMsg = typeof err === 'string'
    ? err
    : (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string')
      ? (err as { message: string }).message
      : '';

  // 404 Not Found & Anti-Oracle Protection (Unified 404 for nonexistent attempt or student mismatch)
  if (rawMsg.includes('ERR_ATTEMPT_NOT_FOUND') || rawMsg.includes('ERR_STUDENT_IDENTITY_MISMATCH')) {
    return { status: 404, errorCode: 'ATTEMPT_NOT_FOUND', message: 'Không tìm thấy lượt làm bài thi.' };
  }

  // 409 Conflict Domain Errors
  if (rawMsg.includes('ERR_ATTEMPT_FINALIZED') || rawMsg.includes('ERR_ATTEMPT_NOT_DRAFT')) {
    return { status: 409, errorCode: 'ERR_ATTEMPT_ALREADY_FINALIZED', message: 'Lượt làm bài đã được nộp hoặc hoàn thành trước đó.' };
  }
  if (rawMsg.includes('ERR_ATTEMPT_EXPIRED')) {
    return { status: 409, errorCode: 'ERR_ATTEMPT_EXPIRED', message: 'Thời gian làm bài thi đã kết thúc.' };
  }

  // Internal Corruption Markers -> 500 INTERNAL_ERROR
  if (
    rawMsg.includes('ERR_ATTEMPT_SNAPSHOT_INVALID') ||
    rawMsg.includes('ERR_INVALID_OPTION_SCHEMA') ||
    rawMsg.includes('ERR_OPTION_SNAPSHOT_INVALID') ||
    rawMsg.includes('ERR_QUESTION_SNAPSHOT_INVALID') ||
    rawMsg.includes('ERR_UNKNOWN_QUESTION_TYPE')
  ) {
    return { status: 500, errorCode: 'INTERNAL_ERROR', message: 'Đã xảy ra lỗi nội bộ trong quá trình tải dữ liệu đề thi.' };
  }

  // 500 Fallback Sanitized (Zero SQL / DB leak)
  return {
    status: 500,
    errorCode: 'INTERNAL_ERROR',
    message: 'Đã xảy ra lỗi nội bộ trong quá trình tải dữ liệu đề thi.',
  };
}

// ----------------------------------------------------------------------------
// Response Projection Allowlist for Get Attempt Questions (Phase 3E-B0)
// ----------------------------------------------------------------------------

export type ApprovedQuestionType =
  | 'single_choice'
  | 'multiple_choice'
  | 'fill_blank'
  | 'short_answer'
  | 'essay'
  | 'image_upload'
  | 'file_upload';

export const APPROVED_QUESTION_TYPES: ReadonlySet<string> = new Set([
  'single_choice',
  'multiple_choice',
  'fill_blank',
  'short_answer',
  'essay',
  'image_upload',
  'file_upload',
]);

export interface ApprovedQuestionOption {
  key: string;
  text: string;
}

export interface ApprovedDeliveredQuestion {
  id: string;
  question_type: ApprovedQuestionType;
  prompt: string;
  points: number;
  options: ApprovedQuestionOption[];
}

export interface ApprovedGetAttemptQuestionsResult {
  attempt_id: string;
  exam_version_id: string;
  status: 'draft';
  questions: ApprovedDeliveredQuestion[];
}

const QUESTION_DELIVERY_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function mapGetAttemptQuestionsSuccess(
  rpcData: unknown
): { ok: true; data: ApprovedGetAttemptQuestionsResult } | { ok: false } {
  if (!rpcData || typeof rpcData !== 'object' || Array.isArray(rpcData)) {
    return { ok: false };
  }

  const rec = rpcData as Record<string, unknown>;

  if (typeof rec.attempt_id !== 'string' || !QUESTION_DELIVERY_UUID_REGEX.test(rec.attempt_id.trim())) return { ok: false };
  if (typeof rec.exam_version_id !== 'string' || !QUESTION_DELIVERY_UUID_REGEX.test(rec.exam_version_id.trim())) return { ok: false };
  if (rec.status !== 'draft') return { ok: false };
  if (!Array.isArray(rec.questions)) return { ok: false };

  const sanitizedQuestions: ApprovedDeliveredQuestion[] = [];

  for (const q of rec.questions) {
    if (!q || typeof q !== 'object' || Array.isArray(q)) return { ok: false };
    const qRec = q as Record<string, unknown>;

    if (typeof qRec.id !== 'string' || !QUESTION_DELIVERY_UUID_REGEX.test(qRec.id.trim())) return { ok: false };
    if (typeof qRec.question_type !== 'string' || !APPROVED_QUESTION_TYPES.has(qRec.question_type)) return { ok: false };
    if (typeof qRec.prompt !== 'string') return { ok: false };
    if (typeof qRec.points !== 'number' || !Number.isFinite(qRec.points) || qRec.points <= 0) return { ok: false };
    if (!Array.isArray(qRec.options)) return { ok: false };

    const sanitizedOptions: ApprovedQuestionOption[] = [];

    for (const opt of qRec.options) {
      if (!opt || typeof opt !== 'object' || Array.isArray(opt)) return { ok: false };
      const optRec = opt as Record<string, unknown>;

      if (typeof optRec.key !== 'string' || optRec.key.trim() === '') return { ok: false };
      if (typeof optRec.text !== 'string') return { ok: false };

      // Strictly 2 fields: key, text
      sanitizedOptions.push({
        key: optRec.key,
        text: optRec.text,
      });
    }

    // Strictly 5 fields: id, question_type, prompt, points, options
    sanitizedQuestions.push({
      id: qRec.id,
      question_type: qRec.question_type as ApprovedQuestionType,
      prompt: qRec.prompt,
      points: qRec.points,
      options: sanitizedOptions,
    });
  }

  // Strictly 4 fields: attempt_id, exam_version_id, status, questions
  const projected: ApprovedGetAttemptQuestionsResult = {
    attempt_id: rec.attempt_id,
    exam_version_id: rec.exam_version_id,
    status: 'draft',
    questions: sanitizedQuestions,
  };

  return { ok: true, data: projected };
}


