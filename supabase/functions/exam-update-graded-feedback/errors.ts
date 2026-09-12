// supabase/functions/exam-update-graded-feedback/errors.ts
// Standardized Error & Success Envelopes and Normalization for Feedback Update BFF

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
  | 'INVALID_INPUT'
  | 'INVALID_REQUEST_FIELD'
  | 'ERR_ATTEMPT_NOT_FOUND'
  | 'ERR_OPTIMISTIC_LOCK_CONFLICT'
  | 'ERR_INVALID_ATTEMPT_STATUS'
  | 'ERR_NOT_MANUAL_QUESTION'
  | 'ERR_DUPLICATE_QUESTION_COMMENT'
  | 'ERR_INVALID_QUESTION_COMMENTS_PAYLOAD'
  | 'ERR_INVALID_TEACHER_COMMENT'
  | 'ERR_MANUAL_ANSWER_ROW_MISSING'
  | 'ERR_ATTEMPT_SNAPSHOT_INVALID'
  | 'ERR_REQUIRED_PARAMS'
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
    message,
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
    data,
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

export function normalizeRpcError(err: unknown): { status: number; errorCode: ErrorCode; message: string } {
  const rawMsg = typeof err === 'string'
    ? err
    : (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string')
      ? (err as { message: string }).message
      : '';

  // 404 Not Found Domain Errors
  if (rawMsg.includes('ERR_ATTEMPT_NOT_FOUND')) {
    return { status: 404, errorCode: 'ERR_ATTEMPT_NOT_FOUND', message: 'Không tìm thấy lượt làm bài thi.' };
  }

  // 409 Conflict Domain Errors
  if (rawMsg.includes('ERR_OPTIMISTIC_LOCK_CONFLICT')) {
    return { status: 409, errorCode: 'ERR_OPTIMISTIC_LOCK_CONFLICT', message: 'Dữ liệu bài thi đã thay đổi bởi thao tác khác, vui lòng làm mới trang.' };
  }
  if (rawMsg.includes('ERR_INVALID_ATTEMPT_STATUS')) {
    return { status: 409, errorCode: 'ERR_INVALID_ATTEMPT_STATUS', message: 'Chỉ có thể cập nhật nhận xét cho bài thi đã hoàn tất chấm điểm (graded).' };
  }

  // 422 Unprocessable Entity Domain Errors
  if (rawMsg.includes('ERR_NOT_MANUAL_QUESTION')) {
    return { status: 422, errorCode: 'ERR_NOT_MANUAL_QUESTION', message: 'Chỉ có thể thêm nhận xét cho các câu hỏi tự luận hoặc tải tệp.' };
  }
  if (rawMsg.includes('ERR_DUPLICATE_QUESTION_COMMENT')) {
    return { status: 422, errorCode: 'ERR_DUPLICATE_QUESTION_COMMENT', message: 'Danh sách nhận xét chứa câu hỏi bị trùng lặp.' };
  }
  if (rawMsg.includes('ERR_INVALID_QUESTION_COMMENTS_PAYLOAD')) {
    return { status: 422, errorCode: 'ERR_INVALID_QUESTION_COMMENTS_PAYLOAD', message: 'Cấu trúc dữ liệu nhận xét câu hỏi không hợp lệ.' };
  }
  if (rawMsg.includes('ERR_INVALID_TEACHER_COMMENT')) {
    return { status: 422, errorCode: 'ERR_INVALID_TEACHER_COMMENT', message: 'Nội dung nhận xét câu hỏi không hợp lệ.' };
  }
  if (rawMsg.includes('ERR_MANUAL_ANSWER_ROW_MISSING')) {
    return { status: 422, errorCode: 'ERR_MANUAL_ANSWER_ROW_MISSING', message: 'Không tìm thấy bản ghi câu trả lời tương ứng trong bài thi.' };
  }
  if (rawMsg.includes('ERR_ATTEMPT_SNAPSHOT_INVALID')) {
    return { status: 422, errorCode: 'ERR_ATTEMPT_SNAPSHOT_INVALID', message: 'Dữ liệu cấu trúc bài thi không hợp lệ.' };
  }
  if (rawMsg.includes('ERR_REQUIRED_PARAMS')) {
    return { status: 422, errorCode: 'ERR_REQUIRED_PARAMS', message: 'Thiếu các tham số bắt buộc để cập nhật nhận xét.' };
  }

  // 500 Fallback Sanitized
  return {
    status: 500,
    errorCode: 'INTERNAL_ERROR',
    message: 'Đã xảy ra lỗi máy chủ trong quá trình cập nhật nhận xét bài thi.',
  };
}

export function mapFeedbackSuccess(data: unknown): {
  ok: boolean;
  data?: {
    attempt_id: string;
    status: string;
    teacher_feedback: string | null;
    version: number;
  };
} {
  if (!data || typeof data !== 'object') {
    return { ok: false };
  }

  const rec = data as Record<string, unknown>;
  if (
    typeof rec.attempt_id !== 'string' ||
    typeof rec.status !== 'string' ||
    typeof rec.version !== 'number'
  ) {
    return { ok: false };
  }

  return {
    ok: true,
    data: {
      attempt_id: rec.attempt_id,
      status: rec.status,
      teacher_feedback: typeof rec.teacher_feedback === 'string' ? rec.teacher_feedback : null,
      version: rec.version,
    },
  };
}
