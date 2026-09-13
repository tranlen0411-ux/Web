// supabase/functions/exam-management-api/errors.ts
// Exam Builder Management BFF Error Mapping & Response Utilities

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export interface StandardErrorEnvelope {
  success: false;
  error_code: string;
  message: string;
}

export interface StandardSuccessEnvelope<T = unknown> {
  success: true;
  data: T;
}

export function createErrorResponse(
  status: number,
  errorCode: string,
  message: string
): Response {
  const body: StandardErrorEnvelope = {
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

export function createSuccessResponse<T>(data: T, status = 200): Response {
  const body: StandardSuccessEnvelope<T> = {
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

export function normalizeRpcError(err: unknown): {
  status: number;
  errorCode: string;
  message: string;
} {
  const msg = err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string'
    ? (err as { message: string }).message
    : 'Lỗi hệ thống CSDL';

  if (msg.includes('ERR_UNAUTHORIZED') || msg.includes('42501')) {
    return {
      status: 403,
      errorCode: 'ERR_UNAUTHORIZED',
      message: 'Bạn không có quyền thực hiện thao tác này trên đề thi.',
    };
  }

  if (msg.includes('ERR_EXAM_NOT_FOUND') || msg.includes('P0002') || msg.includes('ERR_VERSION_NOT_FOUND')) {
    return {
      status: 404,
      errorCode: 'ERR_NOT_FOUND',
      message: 'Không tìm thấy đề thi hoặc phiên bản yêu cầu.',
    };
  }

  if (msg.includes('ERR_EXAM_ARCHIVED')) {
    return {
      status: 400,
      errorCode: 'ERR_EXAM_ARCHIVED',
      message: 'Đề thi đã được lưu trữ (archived), không thể chỉnh sửa hoặc giao bài.',
    };
  }

  if (msg.includes('ERR_VERSION_IMMUTABLE')) {
    return {
      status: 400,
      errorCode: 'ERR_VERSION_IMMUTABLE',
      message: 'Phiên bản đã xuất bản không thể chỉnh sửa trực tiếp.',
    };
  }

  if (msg.includes('ERR_VERSION_NOT_PUBLISHED')) {
    return {
      status: 400,
      errorCode: 'ERR_VERSION_NOT_PUBLISHED',
      message: 'Chỉ phiên bản đã xuất bản (published) mới có thể giao cho lớp học.',
    };
  }

  if (msg.includes('ERR_NO_QUESTIONS') || msg.includes('ERR_ZERO_TOTAL_POINTS')) {
    return {
      status: 400,
      errorCode: 'ERR_CANNOT_PUBLISH',
      message: 'Đề thi phải có ít nhất 1 câu hỏi và tổng điểm lớn hơn 0 trước khi xuất bản.',
    };
  }

  if (msg.includes('ERR_INVALID_SCHEDULE') || msg.includes('ERR_INVALID_DUE_DATE')) {
    return {
      status: 400,
      errorCode: 'ERR_INVALID_SCHEDULE',
      message: 'Cấu hình lịch thi không hợp lệ (thời gian mở đề, hạn vào làm hoặc hạn nộp không hợp logic).',
    };
  }

  if (msg.includes('ERR_EXAM_IN_USE') || msg.includes('55000')) {
    return {
      status: 409,
      errorCode: 'ERR_EXAM_IN_USE',
      message: 'Đề đang trong thời gian thi hoặc có học sinh đang làm bài. Chỉ có thể lưu trữ sau khi kỳ thi kết thúc.',
    };
  }

  if (msg.includes('ERR_ASSIGNMENT_ALREADY_EXISTS') || msg.includes('23505') || msg.includes('ERR_IDEMPOTENCY_CONFLICT')) {
    return {
      status: 409,
      errorCode: 'ERR_CONFLICT',
      message: 'Đề thi phiên bản này đã được giao cho lớp học được chọn hoặc xung đột dữ liệu.',
    };
  }

  if (msg.includes('ERR_INVALID_') || msg.includes('ERR_REQUIRED_PARAMS') || msg.includes('22000') || msg.includes('22003')) {
    return {
      status: 400,
      errorCode: 'INVALID_INPUT',
      message: msg,
    };
  }

  return {
    status: 500,
    errorCode: 'INTERNAL_ERROR',
    message: msg,
  };
}
