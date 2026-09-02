// supabase/functions/question-bank-api/errors.ts
// Standardized Error & Success Envelope Definitions and Normalization for Question Bank BFF V1

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
};

export type ErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_REQUEST_FIELD'
  | 'FORBIDDEN_VISIBILITY'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'SCHOOL_CONTEXT_NOT_AVAILABLE'
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
// Internal Success Contract Validation Helpers
// ----------------------------------------------------------------------------
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function isUuidString(val: unknown): val is string {
  return typeof val === 'string' && UUID_REGEX.test(val);
}

function isNonEmptyString(val: unknown): val is string {
  return typeof val === 'string' && val.trim().length > 0;
}

function isPositiveInteger(val: unknown): val is number {
  return typeof val === 'number' && Number.isInteger(val) && val >= 1;
}

function isNonNegativeInteger(val: unknown): val is number {
  return typeof val === 'number' && Number.isInteger(val) && val >= 0;
}

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

export type SuccessMapResult<T> =
  | { ok: true; data: T }
  | { ok: false };

// ----------------------------------------------------------------------------
// Exact Success Projection Contract Mappers per RPC (Fail-Closed)
// ----------------------------------------------------------------------------
export interface CreateQuestionSuccessData {
  item_id: string;
  version_id: string;
  code: string;
  version_number: number;
}

export function mapCreateQuestionSuccess(
  res: unknown
): SuccessMapResult<CreateQuestionSuccessData> {
  if (!isPlainRecord(res)) return { ok: false };
  if (
    !isUuidString(res.item_id) ||
    !isUuidString(res.version_id) ||
    !isNonEmptyString(res.code) ||
    !isPositiveInteger(res.version_number)
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    data: {
      item_id: res.item_id,
      version_id: res.version_id,
      code: res.code,
      version_number: res.version_number,
    },
  };
}

export interface CreateVersionSuccessData {
  item_id: string;
  version_id: string;
  version_number: number;
}

export function mapCreateVersionSuccess(
  res: unknown
): SuccessMapResult<CreateVersionSuccessData> {
  if (!isPlainRecord(res)) return { ok: false };
  if (
    !isUuidString(res.item_id) ||
    !isUuidString(res.version_id) ||
    !isPositiveInteger(res.version_number)
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    data: {
      item_id: res.item_id,
      version_id: res.version_id,
      version_number: res.version_number,
    },
  };
}

export interface StudentQuestionSuccessData {
  projection: 'STUDENT_SAFE';
  item: Record<string, unknown>;
  version: Record<string, unknown>;
}

export function mapGetStudentQuestionSuccess(
  res: unknown
): SuccessMapResult<StudentQuestionSuccessData> {
  if (!isPlainRecord(res)) return { ok: false };
  if (
    res.projection !== 'STUDENT_SAFE' ||
    !isPlainRecord(res.item) ||
    !isPlainRecord(res.version)
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    data: {
      projection: 'STUDENT_SAFE',
      item: res.item,
      version: res.version,
    },
  };
}

export interface AuthoringDetailSuccessData {
  projection: 'AUTHORING_SAFE';
  item: Record<string, unknown>;
  version: Record<string, unknown>;
  answer_key: Record<string, unknown> | null;
}

export function mapGetAuthoringDetailSuccess(
  res: unknown
): SuccessMapResult<AuthoringDetailSuccessData> {
  if (!isPlainRecord(res)) return { ok: false };
  if (
    res.projection !== 'AUTHORING_SAFE' ||
    !isPlainRecord(res.item) ||
    !isPlainRecord(res.version) ||
    (!isPlainRecord(res.answer_key) && res.answer_key !== null)
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    data: {
      projection: 'AUTHORING_SAFE',
      item: res.item,
      version: res.version,
      answer_key: res.answer_key,
    },
  };
}

export interface ListQuestionsSuccessData {
  total_count: number;
  page: number;
  page_size: number;
  items: unknown[];
}

export function mapListQuestionsSuccess(
  res: unknown
): SuccessMapResult<ListQuestionsSuccessData> {
  if (!isPlainRecord(res)) return { ok: false };
  if (
    !isNonNegativeInteger(res.total_count) ||
    !isPositiveInteger(res.page) ||
    !isPositiveInteger(res.page_size) ||
    res.page_size > 100 ||
    !Array.isArray(res.items)
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    data: {
      total_count: res.total_count,
      page: res.page,
      page_size: res.page_size,
      items: res.items,
    },
  };
}

export interface ForkQuestionSuccessData {
  item_id: string;
  version_id: string;
  code: string;
  forked_from_version_id: string;
}

export function mapForkQuestionSuccess(
  res: unknown
): SuccessMapResult<ForkQuestionSuccessData> {
  if (!isPlainRecord(res)) return { ok: false };
  if (
    !isUuidString(res.item_id) ||
    !isUuidString(res.version_id) ||
    !isNonEmptyString(res.code) ||
    !isUuidString(res.forked_from_version_id)
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    data: {
      item_id: res.item_id,
      version_id: res.version_id,
      code: res.code,
      forked_from_version_id: res.forked_from_version_id,
    },
  };
}

export interface UpdateMetadataSuccessData {
  item_id: string;
  message: string;
}

export function mapUpdateMetadataSuccess(
  res: unknown
): SuccessMapResult<UpdateMetadataSuccessData> {
  if (!isPlainRecord(res)) return { ok: false };
  if (!isUuidString(res.item_id) || !isNonEmptyString(res.message)) {
    return { ok: false };
  }
  return {
    ok: true,
    data: {
      item_id: res.item_id,
      message: res.message,
    },
  };
}

export interface ArchiveQuestionSuccessData {
  item_id: string;
  status: 'archived';
  message: string;
}

export function mapArchiveQuestionSuccess(
  res: unknown
): SuccessMapResult<ArchiveQuestionSuccessData> {
  if (!isPlainRecord(res)) return { ok: false };
  if (!isUuidString(res.item_id) || !isNonEmptyString(res.message)) {
    return { ok: false };
  }
  return {
    ok: true,
    data: {
      item_id: res.item_id,
      status: 'archived',
      message: res.message,
    },
  };
}

export interface RestoreQuestionSuccessData {
  item_id: string;
  status: 'draft';
  message: string;
}

export function mapRestoreQuestionSuccess(
  res: unknown
): SuccessMapResult<RestoreQuestionSuccessData> {
  if (!isPlainRecord(res)) return { ok: false };
  if (!isUuidString(res.item_id) || !isNonEmptyString(res.message)) {
    return { ok: false };
  }
  return {
    ok: true,
    data: {
      item_id: res.item_id,
      status: 'draft',
      message: res.message,
    },
  };
}


// ----------------------------------------------------------------------------
// Sanitized Error Normalization from Database RPC to Public API
// ----------------------------------------------------------------------------
export interface NormalizedError {
  status: number;
  errorCode: ErrorCode;
  message: string;
}

export function normalizeRpcError(
  rpcError: unknown,
  rpcRes: Record<string, unknown> | null | undefined
): NormalizedError {
  if (rpcError) {
    return {
      status: 500,
      errorCode: 'INTERNAL_ERROR',
      message: 'Đã xảy ra lỗi máy chủ nội bộ khi thực thi thao tác.',
    };
  }

  if (!rpcRes || rpcRes.success !== true) {
    const rawCode = typeof rpcRes?.error_code === 'string' ? rpcRes.error_code : '';

    switch (rawCode) {
      case 'FORBIDDEN_VISIBILITY':
        return {
          status: 403,
          errorCode: 'FORBIDDEN_VISIBILITY',
          message: 'Chỉ quản trị viên mới có quyền thiết lập trạng thái chia sẻ mẫu công khai.',
        };
      case 'FORBIDDEN':
      case 'UNAUTHORIZED_ROLE':
        return {
          status: 403,
          errorCode: 'FORBIDDEN',
          message: 'Bạn không có quyền thực hiện thao tác này trên câu hỏi.',
        };
      case 'ITEM_NOT_FOUND':
        return {
          status: 404,
          errorCode: 'NOT_FOUND',
          message: 'Không tìm thấy câu hỏi yêu cầu.',
        };
      case 'VERSION_NOT_FOUND':
        return {
          status: 404,
          errorCode: 'NOT_FOUND',
          message: 'Không tìm thấy phiên bản câu hỏi yêu cầu.',
        };
      case 'SOURCE_VERSION_NOT_FOUND':
        return {
          status: 404,
          errorCode: 'NOT_FOUND',
          message: 'Không tìm thấy phiên bản câu hỏi nguồn để sao chép.',
        };
      case 'INVALID_INPUT':
      case 'INVALID_SINGLE_CHOICE_ANSWER_KEY':
      case 'INVALID_MULTIPLE_CHOICE_ANSWER_KEY':
      case 'INVALID_TRUE_FALSE_ANSWER_KEY':
      case 'INVALID_FILL_BLANK_ANSWER_KEY':
      case 'INVALID_GRADE_LEVEL':
      case 'INVALID_DIFFICULTY':
      case 'INVALID_STATUS':
      case 'INVALID_VISIBILITY':
      case 'INVALID_SUBJECT':
      case 'PROMPT_REQUIRED':
      case 'OPTIONS_REQUIRED':
        return {
          status: 400,
          errorCode: 'INVALID_INPUT',
          message: 'Dữ liệu đầu vào hoặc cấu trúc đáp án không hợp lệ theo quy chuẩn.',
        };
      case 'DATABASE_ERROR':
      default:
        return {
          status: 500,
          errorCode: 'INTERNAL_ERROR',
          message: 'Đã xảy ra lỗi máy chủ nội bộ.',
        };
    }
  }

  return {
    status: 500,
    errorCode: 'INTERNAL_ERROR',
    message: 'Đã xảy ra lỗi không xác định.',
  };
}
