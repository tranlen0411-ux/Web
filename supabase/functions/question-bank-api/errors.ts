// supabase/functions/question-bank-api/errors.ts
// Standardized Error & Success Envelope Definitions and Normalization for Question Bank BFF V1

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};

export type ErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_REQUEST_FIELD'
  | 'FORBIDDEN_VISIBILITY'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'SCHOOL_CONTEXT_NOT_AVAILABLE'
  | 'INVALID_STATUS_TRANSITION'
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

// Bảng danh sách các trường nhạy cảm tuyệt đối cấm lọt ra phía học sinh (Zero Leakage Guard)
const FORBIDDEN_STUDENT_FIELDS = [
  'answer_key',
  'correct_answers',
  'correct_answer',
  'correct_option_id',
  'correct_option_ids',
  'is_correct',
  'isCorrect',
  'correct',
  'score',
  'solution_explanation',
  'explanation',
  'grading_config',
  'grading_rubric',
  'scoring_guide',
  'server_grading',
];

function containsForbiddenStudentField(record: Record<string, unknown>): boolean {
  for (const forbidden of FORBIDDEN_STUDENT_FIELDS) {
    if (forbidden in record && record[forbidden] !== undefined && record[forbidden] !== null) {
      return true;
    }
  }
  return false;
}

function sanitizeStudentMediaField(mediaVal: unknown): { ok: boolean; data?: unknown } {
  if (mediaVal === undefined || mediaVal === null) return { ok: true, data: null };
  if (typeof mediaVal === 'string') return { ok: true, data: mediaVal };
  if (Array.isArray(mediaVal)) {
    const sanitizedList: unknown[] = [];
    for (const item of mediaVal) {
      if (typeof item === 'string') {
        sanitizedList.push(item);
      } else if (isPlainRecord(item)) {
        if (containsForbiddenStudentField(item)) {
          return { ok: false };
        }
        const safeItem: Record<string, unknown> = {};
        if (typeof item.url === 'string') safeItem.url = item.url;
        if (typeof item.type === 'string') safeItem.type = item.type;
        if (typeof item.alt === 'string') safeItem.alt = item.alt;
        sanitizedList.push(safeItem);
      } else {
        return { ok: false };
      }
    }
    return { ok: true, data: sanitizedList };
  }
  if (isPlainRecord(mediaVal)) {
    if (containsForbiddenStudentField(mediaVal)) {
      return { ok: false };
    }
    const safeItem: Record<string, unknown> = {};
    if (typeof mediaVal.url === 'string') safeItem.url = mediaVal.url;
    if (typeof mediaVal.type === 'string') safeItem.type = mediaVal.type;
    if (typeof mediaVal.alt === 'string') safeItem.alt = mediaVal.alt;
    return { ok: true, data: safeItem };
  }
  return { ok: false };
}

export function mapGetStudentQuestionSuccess(
  res: unknown
): SuccessMapResult<StudentQuestionSuccessData> {
  if (!isPlainRecord(res)) return { ok: false };

  // 1. Kiểm tra projection:
  // - Hợp đồng chuẩn: projection bắt buộc là 'STUDENT_SAFE'.
  // - Hợp đồng phẳng Staging hiện tại: projection là undefined.
  // - Nghiêm cấm: Mọi giá trị projection khác (kể cả AUTHORING_SAFE, null, rỗng) đều bị từ chối.
  if (res.projection !== undefined && res.projection !== 'STUDENT_SAFE') {
    return { ok: false };
  }

  // 2. Chặn đứng nếu payload chứa trực tiếp các trường nhạy cảm bị cấm ở tầng root
  if (containsForbiddenStudentField(res)) {
    return { ok: false };
  }

  let rawItem: Record<string, unknown>;
  let rawVersion: Record<string, unknown>;

  // Trường hợp A: Hợp đồng chuẩn lồng nhau (Nested format)
  if (isPlainRecord(res.item) && isPlainRecord(res.version)) {
    rawItem = res.item;
    rawVersion = res.version;
  }
  // Trường hợp B: Hợp đồng phẳng thực tế trên Supabase Staging RPC (Flat format)
  else if (typeof res.id === 'string' && typeof res.version_id === 'string') {
    rawItem = {
      id: res.id,
      code: res.code,
      title: res.title,
      question_type: res.question_type,
      subject: res.subject,
      grade_level: res.grade_level,
      difficulty: res.difficulty,
    };
    rawVersion = {
      id: res.version_id,
      version_number: res.version_number,
      prompt: res.prompt,
      prompt_media: res.prompt_media ?? res.media_urls ?? null,
      media_urls: res.media_urls ?? res.prompt_media ?? null,
      options: res.options,
    };
  } else {
    // Không khớp bất kỳ định dạng hợp lệ nào -> Từ chối fail-closed
    return { ok: false };
  }

  // Bắt buộc ID câu hỏi và ID phiên bản phải là chuỗi hợp lệ
  if (typeof rawItem.id !== 'string' || typeof rawVersion.id !== 'string') {
    return { ok: false };
  }

  // Chặn đứng nếu rawItem hoặc rawVersion chứa các trường nhạy cảm
  if (containsForbiddenStudentField(rawItem) || containsForbiddenStudentField(rawVersion)) {
    return { ok: false };
  }

  // 3. Áp dụng Strict Allowlist cho Item (Chỉ chuyển tiếp các trường an toàn được chỉ định)
  const sanitizedItem: Record<string, unknown> = {
    id: rawItem.id,
  };
  if (typeof rawItem.code === 'string') sanitizedItem.code = rawItem.code;
  if (typeof rawItem.title === 'string') sanitizedItem.title = rawItem.title;
  if (typeof rawItem.question_type === 'string') sanitizedItem.question_type = rawItem.question_type;
  if (typeof rawItem.subject === 'string') sanitizedItem.subject = rawItem.subject;
  if (typeof rawItem.grade_level === 'number') sanitizedItem.grade_level = rawItem.grade_level;
  if (typeof rawItem.difficulty === 'string') sanitizedItem.difficulty = rawItem.difficulty;

  // 4. Áp dụng Strict Allowlist & Validation cho Version
  const sanitizedVersion: Record<string, unknown> = {
    id: rawVersion.id,
  };
  if (typeof rawVersion.version_number === 'number') sanitizedVersion.version_number = rawVersion.version_number;
  if (typeof rawVersion.prompt === 'string') sanitizedVersion.prompt = rawVersion.prompt;

  // Xử lý media an toàn
  const mediaResult1 = sanitizeStudentMediaField(rawVersion.prompt_media);
  if (!mediaResult1.ok) return { ok: false };
  sanitizedVersion.prompt_media = mediaResult1.data;

  const mediaResult2 = sanitizeStudentMediaField(rawVersion.media_urls);
  if (!mediaResult2.ok) return { ok: false };
  sanitizedVersion.media_urls = mediaResult2.data;

  // 5. Khắc phục triệt để đường xử lý Options (Fail-Closed & Deep Field Allowlist)
  if (rawVersion.options !== undefined && rawVersion.options !== null) {
    // Nếu options có giá trị, bắt buộc phải là mảng
    if (!Array.isArray(rawVersion.options)) {
      return { ok: false };
    }

    const safeOptionsList: Array<Record<string, unknown>> = [];
    for (const opt of rawVersion.options) {
      // Mỗi phần tử options BẮT BUỘC phải là plain object
      if (!isPlainRecord(opt)) {
        return { ok: false };
      }

      // Tuyệt đối không chứa bất kỳ trường nhạy cảm hoặc điểm số/đáp án
      if (containsForbiddenStudentField(opt)) {
        return { ok: false };
      }

      const safeOpt: Record<string, unknown> = {};

      // Kiểm tra id lựa chọn (bắt buộc kiểu string hoặc number nếu có)
      if (opt.id !== undefined) {
        if (typeof opt.id !== 'string' && typeof opt.id !== 'number') {
          return { ok: false };
        }
        safeOpt.id = opt.id;
      }

      // Kiểm tra text lựa chọn (bắt buộc kiểu string nếu có)
      if (opt.text !== undefined) {
        if (typeof opt.text !== 'string') {
          return { ok: false };
        }
        safeOpt.text = opt.text;
      }

      // Kiểm tra media đính kèm lựa chọn (nếu có phải an toàn)
      if (opt.media !== undefined && opt.media !== null) {
        const optMediaRes = sanitizeStudentMediaField(opt.media);
        if (!optMediaRes.ok) return { ok: false };
        safeOpt.media = optMediaRes.data;
      }

      if (opt.media_url !== undefined && opt.media_url !== null) {
        if (typeof opt.media_url !== 'string') {
          return { ok: false };
        }
        safeOpt.media_url = opt.media_url;
      }

      safeOptionsList.push(safeOpt);
    }

    sanitizedVersion.options = safeOptionsList;
  } else {
    // Câu hỏi không có options (ví dụ tự luận / trả lời ngắn)
    sanitizedVersion.options = null;
  }

  return {
    ok: true,
    data: {
      projection: 'STUDENT_SAFE',
      item: sanitizedItem,
      version: sanitizedVersion,
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

  // 1. Kiểm tra projection:
  // - Hợp đồng chuẩn mới: projection bắt buộc là 'AUTHORING_SAFE'.
  // - Hợp đồng legacy Staging: Chấp nhận khi projection là undefined (chưa có nhãn projection trong RPC).
  // - Nghiêm cấm: Mọi giá trị projection khác (kể cả null, rỗng, hoặc STUDENT_SAFE) đều bị từ chối.
  if (res.projection !== undefined && res.projection !== 'AUTHORING_SAFE') {
    return { ok: false };
  }

  // 2. Kiểm tra cấu trúc item và version (bắt buộc là plain object):
  if (!isPlainRecord(res.item) || !isPlainRecord(res.version)) {
    return { ok: false };
  }

  // 3. Kiểm tra answer_key (bắt buộc là plain object hoặc null):
  if (!isPlainRecord(res.answer_key) && res.answer_key !== null) {
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
  forked_from_version_id: string;
  code?: string;
}

export interface MapForkQuestionOptions {
  isStaging?: boolean;
}

export function mapForkQuestionSuccess(
  res: unknown,
  options?: MapForkQuestionOptions
): SuccessMapResult<ForkQuestionSuccessData> {
  if (!isPlainRecord(res)) return { ok: false };

  // Fail-closed if envelope reports explicit failure
  if ('success' in res && res.success === false) {
    return { ok: false };
  }

  // 1. Resolve sub-records if nested structure (Postgres RPC standard: { success: true, item: {...}, version: {...} })
  const itemRecord = isPlainRecord(res.item) ? res.item : null;
  const versionRecord = isPlainRecord(res.version) ? res.version : null;

  // 2. Extract item_id (support both flat legacy payload and nested item.id)
  let itemId: string | null = null;
  if (isUuidString(res.item_id)) {
    itemId = res.item_id;
  } else if (itemRecord && isUuidString(itemRecord.id)) {
    itemId = itemRecord.id;
  }
  if (!itemId) return { ok: false };

  // 3. Extract version_id (support both flat legacy payload and nested version.id)
  let versionId: string | null = null;
  if (isUuidString(res.version_id)) {
    versionId = res.version_id;
  } else if (versionRecord && isUuidString(versionRecord.id)) {
    versionId = versionRecord.id;
  }
  if (!versionId) return { ok: false };

  // 4. Cross-integrity validation between flat and nested records
  if (
    isUuidString(res.item_id) &&
    itemRecord &&
    isUuidString(itemRecord.id) &&
    res.item_id !== itemRecord.id
  ) {
    return { ok: false };
  }
  if (
    isUuidString(res.version_id) &&
    versionRecord &&
    isUuidString(versionRecord.id) &&
    res.version_id !== versionRecord.id
  ) {
    return { ok: false };
  }
  if (versionRecord && 'question_bank_item_id' in versionRecord) {
    if (versionRecord.question_bank_item_id !== itemId) {
      return { ok: false };
    }
  }

  // 5. Extract forked_from_version_id
  // Verified empirical sources:
  // a) res.forked_from_version_id (flat legacy payload)
  // b) versionRecord.forked_from_version_id (direct column in public.question_bank_versions)
  // c) itemRecord.metadata.forked_from_version_id (jsonb metadata in public.question_bank_items)
  let forkedFromId: string | null = null;
  if (isUuidString(res.forked_from_version_id)) {
    forkedFromId = res.forked_from_version_id;
  } else if (versionRecord && isUuidString(versionRecord.forked_from_version_id)) {
    forkedFromId = versionRecord.forked_from_version_id;
  } else if (
    itemRecord &&
    isPlainRecord(itemRecord.metadata) &&
    isUuidString(itemRecord.metadata.forked_from_version_id)
  ) {
    forkedFromId = itemRecord.metadata.forked_from_version_id;
  }
  if (!forkedFromId) return { ok: false };

  // Cross-integrity: If both versionRecord and itemRecord.metadata contain provenance, they must match
  if (
    versionRecord &&
    isUuidString(versionRecord.forked_from_version_id) &&
    itemRecord &&
    isPlainRecord(itemRecord.metadata) &&
    isUuidString(itemRecord.metadata.forked_from_version_id) &&
    versionRecord.forked_from_version_id !== itemRecord.metadata.forked_from_version_id
  ) {
    return { ok: false };
  }

  // 6. Handle code field based on verified trusted server-side environment
  // - Staging (isStaging === true): code is optional because Staging schema has no code column.
  //   If code is present, it must be a valid non-empty string; if absent, it is allowed without fabrication.
  // - Production (isStaging !== true): code is strictly mandatory (Production schema enforces code NOT NULL).
  const isStaging = options?.isStaging === true;

  let code: string | undefined = undefined;
  const rawCode =
    'code' in res
      ? res.code
      : itemRecord && 'code' in itemRecord
        ? itemRecord.code
        : undefined;

  if (rawCode !== undefined) {
    if (!isNonEmptyString(rawCode)) {
      return { ok: false };
    }
    code = rawCode;
  } else {
    if (!isStaging) {
      // Production strictly requires valid code!
      return { ok: false };
    }
  }

  const data: ForkQuestionSuccessData = {
    item_id: itemId,
    version_id: versionId,
    forked_from_version_id: forkedFromId,
  };
  if (code !== undefined) {
    data.code = code;
  }

  return {
    ok: true,
    data,
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

export interface PublishQuestionSuccessData {
  item_id: string;
  status: 'published';
  visibility?: string;
  message: string;
}

export function mapPublishQuestionSuccess(
  res: unknown
): SuccessMapResult<PublishQuestionSuccessData> {
  if (!isPlainRecord(res)) return { ok: false };
  if (!isUuidString(res.item_id) || !isNonEmptyString(res.message)) {
    return { ok: false };
  }
  return {
    ok: true,
    data: {
      item_id: res.item_id,
      status: 'published',
      visibility: typeof res.visibility === 'string' ? res.visibility : undefined,
      message: res.message,
    },
  };
}

export interface VersionSummaryItem {
  id: string;
  version_number: number;
  created_by: string | null;
  created_at: string;
  change_log: string | null;
  forked_from_version_id: string | null;
  is_current: boolean;
}

export interface ListVersionsSuccessData {
  item_id: string;
  current_version_id: string | null;
  total_versions: number;
  versions: VersionSummaryItem[];
}

export function mapListVersionsSuccess(
  res: unknown
): SuccessMapResult<ListVersionsSuccessData> {
  if (!isPlainRecord(res)) return { ok: false };
  if (
    !isUuidString(res.item_id) ||
    (res.current_version_id !== null && !isUuidString(res.current_version_id)) ||
    !isNonNegativeInteger(res.total_versions) ||
    !Array.isArray(res.versions)
  ) {
    return { ok: false };
  }

  const sanitizedVersions: VersionSummaryItem[] = [];
  for (const v of res.versions) {
    if (!isPlainRecord(v)) return { ok: false };
    if (!isUuidString(v.id) || !isPositiveInteger(v.version_number)) {
      return { ok: false };
    }
    if (v.created_by !== null && typeof v.created_by !== 'string') {
      return { ok: false };
    }
    if (typeof v.created_at !== 'string' || v.created_at.trim().length === 0) {
      return { ok: false };
    }
    if (v.change_log !== null && typeof v.change_log !== 'string') {
      return { ok: false };
    }
    if (v.forked_from_version_id !== null && !isUuidString(v.forked_from_version_id)) {
      return { ok: false };
    }
    if (typeof v.is_current !== 'boolean') {
      return { ok: false };
    }

    sanitizedVersions.push({
      id: v.id,
      version_number: v.version_number,
      created_by: typeof v.created_by === 'string' ? v.created_by : null,
      created_at: v.created_at,
      change_log: typeof v.change_log === 'string' ? v.change_log : null,
      forked_from_version_id:
        typeof v.forked_from_version_id === 'string' ? v.forked_from_version_id : null,
      is_current: v.is_current,
    });
  }

  return {
    ok: true,
    data: {
      item_id: res.item_id,
      current_version_id:
        typeof res.current_version_id === 'string' ? res.current_version_id : null,
      total_versions: res.total_versions,
      versions: sanitizedVersions,
    },
  };
}

export interface SafeDeleteQuestionSuccessData {
  item_id: string;
  action: 'deleted' | 'archived' | 'already_archived';
  archived_at?: string | null;
  message?: string;
}

export function mapSafeDeleteQuestionSuccess(
  res: unknown
): SuccessMapResult<SafeDeleteQuestionSuccessData> {
  if (
    !isPlainRecord(res) ||
    !isUuidString(res.item_id) ||
    typeof res.action !== 'string' ||
    !['deleted', 'archived', 'already_archived'].includes(res.action)
  ) {
    return { ok: false };
  }

  return {
    ok: true,
    data: {
      item_id: res.item_id,
      action: res.action as 'deleted' | 'archived' | 'already_archived',
      archived_at: typeof res.archived_at === 'string' ? res.archived_at : null,
      message: typeof res.message === 'string' ? res.message : undefined,
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
    let errCode = '';
    let errMsg = '';

    if (typeof rpcError === 'string') {
      errMsg = rpcError;
    } else if (rpcError && typeof rpcError === 'object') {
      if ('code' in rpcError && typeof (rpcError as Record<string, unknown>).code === 'string') {
        errCode = (rpcError as Record<string, unknown>).code as string;
      }
      if ('message' in rpcError && typeof (rpcError as Record<string, unknown>).message === 'string') {
        errMsg = (rpcError as Record<string, unknown>).message as string;
      }
    }

    if (
      errCode === 'P0002' ||
      errMsg.includes('ERR_ITEM_NOT_FOUND')
    ) {
      return {
        status: 404,
        errorCode: 'NOT_FOUND',
        message: 'Không tìm thấy câu hỏi yêu cầu.',
      };
    }

    if (
      errCode === '42501' ||
      errMsg.includes('ERR_UNAUTHORIZED')
    ) {
      return {
        status: 403,
        errorCode: 'FORBIDDEN',
        message: 'Bạn không có quyền thực hiện thao tác này trên câu hỏi.',
      };
    }

    if (
      errCode === '22000' ||
      errCode === '22P02' ||
      errMsg.includes('ERR_REQUIRED_PARAMS')
    ) {
      return {
        status: 400,
        errorCode: 'INVALID_INPUT',
        message: 'Tham số yêu cầu không hợp lệ hoặc bị thiếu.',
      };
    }

    return {
      status: 500,
      errorCode: 'INTERNAL_ERROR',
      message: 'Đã xảy ra lỗi máy chủ nội bộ khi thực thi thao tác.',
    };
  }

  if (!rpcRes || rpcRes.success !== true) {
    const rawCode = typeof rpcRes?.error_code === 'string' ? rpcRes.error_code : '';

    switch (rawCode) {
      case 'INVALID_STATUS_TRANSITION':
        return {
          status: 409,
          errorCode: 'INVALID_STATUS_TRANSITION',
          message: 'Chuyển đổi trạng thái câu hỏi không hợp lệ.',
        };
      case 'FORBIDDEN_VISIBILITY':
        return {
          status: 403,
          errorCode: 'FORBIDDEN_VISIBILITY',
          message: 'Chỉ quản trị viên mới có quyền thiết lập trạng thái chia sẻ mẫu công khai.',
        };
      case 'UNAUTHORIZED_CALLER':
        return {
          status: 401,
          errorCode: 'UNAUTHORIZED',
          message: 'Yêu cầu xác thực danh tính người gọi.',
        };
      case 'FORBIDDEN':
      case 'UNAUTHORIZED_ROLE':
      case 'FORBIDDEN_VERSION':
      case 'QUESTION_NOT_PUBLISHED':
        return {
          status: 403,
          errorCode: 'FORBIDDEN',
          message: 'Bạn không có quyền thực hiện thao tác này trên câu hỏi.',
        };
      case 'ITEM_NOT_FOUND':
      case 'QUESTION_NOT_FOUND':
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
      case 'CONFLICT':
      case 'VERSION_CONFLICT':
        return {
          status: 409,
          errorCode: 'CONFLICT',
          message: 'Phiên bản câu hỏi đã thay đổi trên máy chủ (đã có bản nháp mới hơn được tạo). Vui lòng tải lại trang để kiểm tra trước khi xuất bản.',
        };
      case 'MISSING_EXPECTED_VERSION':
      case 'CANNOT_PUBLISH_EMPTY_ITEM':
      case 'MISSING_ANSWER_KEY':
      case 'INVALID_PROMPT':
      case 'INVALID_QUESTION_ID':
      case 'INVALID_SCHOOL_ID':
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
