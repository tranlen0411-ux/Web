// supabase/functions/exam-grade-manual-attempt/errors.ts
// Standardized Error & Success Envelope Definitions and Normalization for Exam Builder BFF V1

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'INVALID_TOKEN'
  | 'FORBIDDEN_ROLE'
  | 'CLASS_ACCESS_DENIED'
  | 'ACCOUNT_DISABLED'
  | 'INVALID_INPUT'
  | 'INVALID_REQUEST_FIELD'
  | 'ERR_ATTEMPT_NOT_FOUND'
  | 'ERR_QUESTION_NOT_FOUND'
  | 'ERR_OPTIMISTIC_LOCK_CONFLICT'
  | 'ERR_ATTEMPT_ALREADY_GRADED'
  | 'ERR_DUPLICATE_MANUAL_GRADE'
  | 'ERR_INVALID_MANUAL_GRADES_PAYLOAD'
  | 'ERR_INVALID_MANUAL_POINTS'
  | 'ERR_MANUAL_GRADES_INCOMPLETE'
  | 'ERR_NOT_MANUAL_QUESTION'
  | 'ERR_QUESTION_VERSION_MISMATCH'
  | 'ERR_MANUAL_ANSWER_ROW_MISSING'
  | 'ERR_MANUAL_ANSWER_STATE'
  | 'ERR_ATTEMPT_SNAPSHOT_INVALID'
  | 'ERR_SCORE_INVARIANT'
  | 'ERR_NO_MANUAL_QUESTIONS'
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

export interface ApprovedGradingResult {
  attempt_id: string;
  status: string;
  objective_score: number | null;
  manual_score: number | null;
  total_score: number | null;
  max_score: number;
  teacher_feedback: string | null;
  graded_at: string | null;
  graded_by: string | null;
  reward_stars_awarded: number;
  version: number;
  idempotent_replay: boolean;
}

export function createErrorResponse(
  status: number,
  errorCode: ErrorCode,
  message: string
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
    },
  });
}

export function createSuccessResponse<T>(
  data: T,
  status = 200
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
    },
  });
}

// ----------------------------------------------------------------------------
// Deterministic RPC Error Normalizer (Fail-Closed & Sanitized)
// ----------------------------------------------------------------------------
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
  if (rawMsg.includes('ERR_QUESTION_NOT_FOUND')) {
    return { status: 404, errorCode: 'ERR_QUESTION_NOT_FOUND', message: 'Không tìm thấy câu hỏi trong ngân hàng đề thi.' };
  }

  // 409 Conflict Domain Errors
  if (rawMsg.includes('ERR_OPTIMISTIC_LOCK_CONFLICT')) {
    return { status: 409, errorCode: 'ERR_OPTIMISTIC_LOCK_CONFLICT', message: 'Dữ liệu bài thi đã thay đổi bởi phiên khác, vui lòng làm mới trang.' };
  }
  if (rawMsg.includes('ERR_ATTEMPT_ALREADY_GRADED')) {
    return { status: 409, errorCode: 'ERR_ATTEMPT_ALREADY_GRADED', message: 'Bài thi đã được chấm trước đó với điểm số hoặc nhận xét khác.' };
  }
  if (rawMsg.includes('ERR_DUPLICATE_MANUAL_GRADE')) {
    return { status: 409, errorCode: 'ERR_DUPLICATE_MANUAL_GRADE', message: 'Danh sách chấm bài chứa câu hỏi bị trùng lặp.' };
  }

  // 422 Unprocessable Entity Domain Errors
  if (rawMsg.includes('ERR_INVALID_MANUAL_GRADES_PAYLOAD')) {
    return { status: 422, errorCode: 'ERR_INVALID_MANUAL_GRADES_PAYLOAD', message: 'Cấu trúc dữ liệu chấm bài không hợp lệ.' };
  }
  if (rawMsg.includes('ERR_INVALID_MANUAL_POINTS')) {
    return { status: 422, errorCode: 'ERR_INVALID_MANUAL_POINTS', message: 'Điểm số chấm tự luận không hợp lệ hoặc vượt quá điểm tối đa.' };
  }
  if (rawMsg.includes('ERR_MANUAL_GRADES_INCOMPLETE')) {
    return { status: 422, errorCode: 'ERR_MANUAL_GRADES_INCOMPLETE', message: 'Số lượng câu hỏi chấm không khớp với số câu tự luận của đề thi.' };
  }
  if (rawMsg.includes('ERR_NOT_MANUAL_QUESTION')) {
    return { status: 422, errorCode: 'ERR_NOT_MANUAL_QUESTION', message: 'Chỉ có thể chấm điểm thủ công cho các câu hỏi tự luận hoặc tải tệp.' };
  }
  if (rawMsg.includes('ERR_QUESTION_VERSION_MISMATCH')) {
    return { status: 422, errorCode: 'ERR_QUESTION_VERSION_MISMATCH', message: 'Câu hỏi không thuộc phiên bản đề thi này.' };
  }
  if (rawMsg.includes('ERR_MANUAL_ANSWER_ROW_MISSING')) {
    return { status: 422, errorCode: 'ERR_MANUAL_ANSWER_ROW_MISSING', message: 'Thiếu bản ghi câu trả lời tương ứng trong bài thi.' };
  }
  if (rawMsg.includes('ERR_MANUAL_ANSWER_STATE')) {
    return { status: 422, errorCode: 'ERR_MANUAL_ANSWER_STATE', message: 'Trạng thái câu trả lời không hợp lệ để chấm điểm.' };
  }
  if (rawMsg.includes('ERR_ATTEMPT_SNAPSHOT_INVALID') || rawMsg.includes('ERR_QUESTION_NOT_IN_SNAPSHOT')) {
    return { status: 422, errorCode: 'ERR_ATTEMPT_SNAPSHOT_INVALID', message: 'Dữ liệu snapshot đề thi của lượt làm bài không hợp lệ.' };
  }
  if (rawMsg.includes('ERR_SCORE_INVARIANT')) {
    return { status: 422, errorCode: 'ERR_SCORE_INVARIANT', message: 'Điểm trắc nghiệm tự động của bài thi không hợp lệ.' };
  }
  if (rawMsg.includes('ERR_NO_MANUAL_QUESTIONS')) {
    return { status: 422, errorCode: 'ERR_NO_MANUAL_QUESTIONS', message: 'Đề thi toàn bộ là trắc nghiệm, không có câu tự luận để chấm điểm.' };
  }

  // 500 Fallback Sanitized (Zero SQL / DB leak)
  return {
    status: 500,
    errorCode: 'INTERNAL_ERROR',
    message: 'Đã xảy ra lỗi nội bộ trong quá trình xử lý chấm bài.',
  };
}

// ----------------------------------------------------------------------------
// Response Projection Allowlist (Strict Allowlist - Fail-Closed)
// ----------------------------------------------------------------------------
export function mapGradingSuccess(rpcData: unknown): { ok: true; data: ApprovedGradingResult } | { ok: false } {
  if (!rpcData || typeof rpcData !== 'object' || Array.isArray(rpcData)) {
    return { ok: false };
  }

  const rec = rpcData as Record<string, unknown>;

  if (typeof rec.attempt_id !== 'string' || !rec.attempt_id) return { ok: false };
  if (typeof rec.status !== 'string' || rec.status !== 'graded') return { ok: false };
  if (typeof rec.max_score !== 'number' || Number.isNaN(rec.max_score)) return { ok: false };
  if (typeof rec.version !== 'number' || !Number.isInteger(rec.version) || rec.version < 1) return { ok: false };
  if (typeof rec.idempotent_replay !== 'boolean') return { ok: false };
  if (typeof rec.reward_stars_awarded !== 'number') return { ok: false };

  const objectiveScore = rec.objective_score === null ? null : (typeof rec.objective_score === 'number' ? rec.objective_score : null);
  const manualScore = rec.manual_score === null ? null : (typeof rec.manual_score === 'number' ? rec.manual_score : null);
  const totalScore = rec.total_score === null ? null : (typeof rec.total_score === 'number' ? rec.total_score : null);
  const teacherFeedback = rec.teacher_feedback === null ? null : (typeof rec.teacher_feedback === 'string' ? rec.teacher_feedback : null);
  const gradedAt = rec.graded_at === null ? null : (typeof rec.graded_at === 'string' ? rec.graded_at : null);
  const gradedBy = rec.graded_by === null ? null : (typeof rec.graded_by === 'string' ? rec.graded_by : null);

  const projected: ApprovedGradingResult = {
    attempt_id: rec.attempt_id,
    status: rec.status,
    objective_score: objectiveScore,
    manual_score: manualScore,
    total_score: totalScore,
    max_score: rec.max_score,
    teacher_feedback: teacherFeedback,
    graded_at: gradedAt,
    graded_by: gradedBy,
    reward_stars_awarded: rec.reward_stars_awarded,
    version: rec.version,
    idempotent_replay: rec.idempotent_replay,
  };

  return { ok: true, data: projected };
}
