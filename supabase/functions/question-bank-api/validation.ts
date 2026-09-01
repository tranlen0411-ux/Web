// supabase/functions/question-bank-api/validation.ts
// Strict Payload & Query Validation and Allowlists for Question Bank BFF V1

const FORBIDDEN_INJECTION_FIELDS = new Set([
  'caller_id',
  'p_caller_id',
  'actor_role',
  'p_actor_role',
  'school_id',
  'p_school_id',
  'server_grading',
  'service_role',
]);

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CANONICAL_INT_REGEX = /^[0-9]+$/;

export interface ValidationResult<T = Record<string, unknown>> {
  valid: boolean;
  errorCode?: 'INVALID_INPUT' | 'INVALID_REQUEST_FIELD' | 'SCHOOL_CONTEXT_NOT_AVAILABLE';
  errorMessage?: string;
  sanitizedData?: T;
}

export function isValidUUID(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseCanonicalPositiveInt(
  val: string | null,
  min: number,
  max: number,
  fieldName: string
): { valid: boolean; value?: number; errorMessage?: string } {
  if (val === null) return { valid: true };
  if (!CANONICAL_INT_REGEX.test(val)) {
    return {
      valid: false,
      errorMessage: `Tham số ${fieldName} phải là chuỗi số nguyên chuẩn (chỉ gồm các chữ số 0-9, không chứa ký tự lạ).`,
    };
  }
  const num = Number(val);
  if (num < min || num > max) {
    return {
      valid: false,
      errorMessage: `Tham số ${fieldName} phải nằm trong khoảng từ ${min} đến ${max}.`,
    };
  }
  return { valid: true, value: num };
}

export function checkForbiddenSecurityFields(
  payload: Record<string, unknown>
): { hasForbidden: boolean; fieldName?: string } {
  for (const key of Object.keys(payload)) {
    const normalizedKey = key.toLowerCase().trim();
    if (FORBIDDEN_INJECTION_FIELDS.has(normalizedKey)) {
      return { hasForbidden: true, fieldName: key };
    }
  }
  return { hasForbidden: false };
}

export function validateAllowlist(
  payload: Record<string, unknown>,
  allowedKeys: Set<string>
): { valid: boolean; unexpectedField?: string } {
  for (const key of Object.keys(payload)) {
    if (!allowedKeys.has(key)) {
      return { valid: false, unexpectedField: key };
    }
  }
  return { valid: true };
}

export function validateQueryParamsAllowlist(
  urlParams: URLSearchParams,
  allowedKeys: Set<string>
): { valid: boolean; unexpectedKey?: string; duplicateKey?: string } {
  const seenKeys = new Set<string>();

  for (const key of urlParams.keys()) {
    const normalizedKey = key.toLowerCase().trim();

    // Kiểm tra lặp khóa (duplicate key)
    if (seenKeys.has(normalizedKey)) {
      return { valid: false, duplicateKey: key };
    }
    seenKeys.add(normalizedKey);

    // Kiểm tra trường cấm và trường ngoài allowlist
    if (FORBIDDEN_INJECTION_FIELDS.has(normalizedKey) || !allowedKeys.has(key)) {
      return { valid: false, unexpectedKey: key };
    }
  }
  return { valid: true };
}

// ----------------------------------------------------------------------------
// 1. Create Question Payload Validation
// ----------------------------------------------------------------------------
const CREATE_QUESTION_ALLOWED_KEYS = new Set([
  'title',
  'question_type',
  'subject',
  'grade_level',
  'difficulty',
  'visibility',
  'prompt',
  'options',
  'answer_key',
  'hints',
  'explanation',
  'tags',
  'media_urls',
  'metadata',
]);

export function validateCreateQuestionPayload(
  raw: unknown
): ValidationResult<Record<string, unknown>> {
  if (!isPlainObject(raw)) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Payload phải là một JSON object hợp lệ.' };
  }

  const payload = raw;

  // Security Check 1: Chặn injection fields
  const forbiddenCheck = checkForbiddenSecurityFields(payload);
  if (forbiddenCheck.hasForbidden) {
    return {
      valid: false,
      errorCode: 'INVALID_REQUEST_FIELD',
      errorMessage: `Trường dữ liệu bị cấm: ${forbiddenCheck.fieldName}`,
    };
  }

  // Security Check 2: Chặn trường ngoài allowlist
  const allowlistCheck = validateAllowlist(payload, CREATE_QUESTION_ALLOWED_KEYS);
  if (!allowlistCheck.valid) {
    return {
      valid: false,
      errorCode: 'INVALID_REQUEST_FIELD',
      errorMessage: `Trường không nằm trong danh sách cho phép: ${allowlistCheck.unexpectedField}`,
    };
  }

  // Security Check 3: Chặn school_shared ở V1
  const visibility = typeof payload.visibility === 'string' ? payload.visibility.trim() : 'private';
  if (visibility === 'school_shared') {
    return {
      valid: false,
      errorCode: 'SCHOOL_CONTEXT_NOT_AVAILABLE',
      errorMessage: 'Tính năng chia sẻ cấp trường (school_shared) chưa được hỗ trợ trong phiên bản này.',
    };
  }

  if (visibility !== 'private' && visibility !== 'public_template') {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Visibility chỉ chấp nhận private hoặc public_template.',
    };
  }

  // Validate Required Fields
  if (typeof payload.title !== 'string' || payload.title.trim().length === 0 || payload.title.length > 500) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Tiêu đề câu hỏi (title) không hợp lệ (1-500 ký tự).' };
  }

  if (typeof payload.subject !== 'string' || payload.subject.trim().length === 0 || payload.subject.length > 100) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Môn học (subject) không hợp lệ.' };
  }

  const grade = Number(payload.grade_level);
  if (!Number.isInteger(grade) || grade < 1 || grade > 12) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Khối lớp (grade_level) phải từ 1 đến 12.' };
  }

  if (typeof payload.prompt !== 'string' || payload.prompt.trim().length === 0) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Nội dung đề bài (prompt) không được để trống.' };
  }

  if (!isPlainObject(payload.answer_key)) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Đáp án (answer_key) là bắt buộc và phải là JSON plain object.' };
  }

  return { valid: true, sanitizedData: payload };
}

// ----------------------------------------------------------------------------
// 2. Create Version Payload Validation
// ----------------------------------------------------------------------------
const CREATE_VERSION_ALLOWED_KEYS = new Set([
  'prompt',
  'options',
  'answer_key',
  'hints',
  'explanation',
  'change_log',
  'media_urls',
  'metadata',
]);

export function validateCreateVersionPayload(
  raw: unknown
): ValidationResult<Record<string, unknown>> {
  if (!isPlainObject(raw)) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Payload phải là một JSON object hợp lệ.' };
  }

  const payload = raw;

  const forbiddenCheck = checkForbiddenSecurityFields(payload);
  if (forbiddenCheck.hasForbidden) {
    return {
      valid: false,
      errorCode: 'INVALID_REQUEST_FIELD',
      errorMessage: `Trường dữ liệu bị cấm: ${forbiddenCheck.fieldName}`,
    };
  }

  const allowlistCheck = validateAllowlist(payload, CREATE_VERSION_ALLOWED_KEYS);
  if (!allowlistCheck.valid) {
    return {
      valid: false,
      errorCode: 'INVALID_REQUEST_FIELD',
      errorMessage: `Trường không nằm trong danh sách cho phép: ${allowlistCheck.unexpectedField}`,
    };
  }

  if (typeof payload.prompt !== 'string' || payload.prompt.trim().length === 0) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Nội dung đề bài (prompt) không được để trống.' };
  }

  if (!isPlainObject(payload.answer_key)) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Đáp án (answer_key) là bắt buộc và phải là JSON plain object.' };
  }

  return { valid: true, sanitizedData: payload };
}

// ----------------------------------------------------------------------------
// 3. Fork Question Payload Validation
// ----------------------------------------------------------------------------
const FORK_QUESTION_ALLOWED_KEYS = new Set(['title', 'visibility']);

export function validateForkQuestionPayload(
  raw: unknown
): ValidationResult<Record<string, unknown>> {
  if (!isPlainObject(raw)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Payload fork nếu được truyền phải là một JSON object hợp lệ.',
    };
  }

  const payload = raw;

  const forbiddenCheck = checkForbiddenSecurityFields(payload);
  if (forbiddenCheck.hasForbidden) {
    return {
      valid: false,
      errorCode: 'INVALID_REQUEST_FIELD',
      errorMessage: `Trường dữ liệu bị cấm: ${forbiddenCheck.fieldName}`,
    };
  }

  const allowlistCheck = validateAllowlist(payload, FORK_QUESTION_ALLOWED_KEYS);
  if (!allowlistCheck.valid) {
    return {
      valid: false,
      errorCode: 'INVALID_REQUEST_FIELD',
      errorMessage: `Trường không nằm trong danh sách cho phép: ${allowlistCheck.unexpectedField}`,
    };
  }

  if (payload.visibility === 'school_shared') {
    return {
      valid: false,
      errorCode: 'SCHOOL_CONTEXT_NOT_AVAILABLE',
      errorMessage: 'Tính năng chia sẻ cấp trường (school_shared) chưa được hỗ trợ.',
    };
  }

  return { valid: true, sanitizedData: payload };
}

// ----------------------------------------------------------------------------
// 4. Update Metadata Payload Validation
// ----------------------------------------------------------------------------
const UPDATE_METADATA_ALLOWED_KEYS = new Set([
  'title',
  'subject',
  'difficulty',
  'visibility',
  'tags',
]);

export function validateUpdateMetadataPayload(
  raw: unknown
): ValidationResult<Record<string, unknown>> {
  if (!isPlainObject(raw)) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Payload phải là một JSON object.' };
  }

  const payload = raw;

  const forbiddenCheck = checkForbiddenSecurityFields(payload);
  if (forbiddenCheck.hasForbidden) {
    return {
      valid: false,
      errorCode: 'INVALID_REQUEST_FIELD',
      errorMessage: `Trường dữ liệu bị cấm: ${forbiddenCheck.fieldName}`,
    };
  }

  const allowlistCheck = validateAllowlist(payload, UPDATE_METADATA_ALLOWED_KEYS);
  if (!allowlistCheck.valid) {
    return {
      valid: false,
      errorCode: 'INVALID_REQUEST_FIELD',
      errorMessage: `Trường không nằm trong danh sách cho phép: ${allowlistCheck.unexpectedField}`,
    };
  }

  if (Object.keys(payload).length === 0) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Phải cập nhật ít nhất một trường thông tin metadata.',
    };
  }

  if (payload.visibility === 'school_shared') {
    return {
      valid: false,
      errorCode: 'SCHOOL_CONTEXT_NOT_AVAILABLE',
      errorMessage: 'Không thể chuyển sang trạng thái chia sẻ trường học (school_shared) ở phiên bản V1.',
    };
  }

  return { valid: true, sanitizedData: payload };
}

// ----------------------------------------------------------------------------
// 5. Query Parameter Allowlists Validation
// ----------------------------------------------------------------------------
const STUDENT_QUERY_ALLOWED_KEYS = new Set(['version_id']);
const AUTHORING_QUERY_ALLOWED_KEYS = new Set(['version_id']);
const LIST_QUERY_ALLOWED_KEYS = new Set([
  'page',
  'page_size',
  'subject',
  'grade_level',
  'question_type',
  'difficulty',
  'status',
  'visibility',
  'search',
]);

export function validateStudentQueryParams(
  urlParams: URLSearchParams
): ValidationResult<{ versionId: string | null }> {
  const queryCheck = validateQueryParamsAllowlist(urlParams, STUDENT_QUERY_ALLOWED_KEYS);
  if (!queryCheck.valid) {
    const msg = queryCheck.duplicateKey
      ? `Tham số query bị lặp lại: ${queryCheck.duplicateKey}`
      : `Tham số query không hợp lệ: ${queryCheck.unexpectedKey}`;
    return {
      valid: false,
      errorCode: 'INVALID_REQUEST_FIELD',
      errorMessage: msg,
    };
  }

  const versionIdParam = urlParams.get('version_id');
  if (versionIdParam !== null && !isValidUUID(versionIdParam)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Tham số version_id không đúng định dạng UUID.',
    };
  }

  return { valid: true, sanitizedData: { versionId: versionIdParam } };
}

export function validateAuthoringQueryParams(
  urlParams: URLSearchParams
): ValidationResult<{ versionId: string | null }> {
  const queryCheck = validateQueryParamsAllowlist(urlParams, AUTHORING_QUERY_ALLOWED_KEYS);
  if (!queryCheck.valid) {
    const msg = queryCheck.duplicateKey
      ? `Tham số query bị lặp lại: ${queryCheck.duplicateKey}`
      : `Tham số query không hợp lệ: ${queryCheck.unexpectedKey}`;
    return {
      valid: false,
      errorCode: 'INVALID_REQUEST_FIELD',
      errorMessage: msg,
    };
  }

  const versionIdParam = urlParams.get('version_id');
  if (versionIdParam !== null && !isValidUUID(versionIdParam)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Tham số version_id không đúng định dạng UUID.',
    };
  }

  return { valid: true, sanitizedData: { versionId: versionIdParam } };
}

export function validateListFilters(
  urlParams: URLSearchParams
): ValidationResult<Record<string, unknown>> {
  const queryCheck = validateQueryParamsAllowlist(urlParams, LIST_QUERY_ALLOWED_KEYS);
  if (!queryCheck.valid) {
    const msg = queryCheck.duplicateKey
      ? `Tham số query bị lặp lại: ${queryCheck.duplicateKey}`
      : `Tham số query không hợp lệ: ${queryCheck.unexpectedKey}`;
    return {
      valid: false,
      errorCode: 'INVALID_REQUEST_FIELD',
      errorMessage: msg,
    };
  }

  const filters: Record<string, unknown> = {};

  // Strict integer parsing with canonical regex & range bounds
  const pageParsed = parseCanonicalPositiveInt(urlParams.get('page'), 1, 1000000, 'page');
  if (!pageParsed.valid) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: pageParsed.errorMessage };
  }
  if (pageParsed.value !== undefined) {
    filters.page = pageParsed.value;
  }

  const pageSizeParsed = parseCanonicalPositiveInt(urlParams.get('page_size'), 1, 100, 'page_size');
  if (!pageSizeParsed.valid) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: pageSizeParsed.errorMessage };
  }
  if (pageSizeParsed.value !== undefined) {
    filters.page_size = pageSizeParsed.value;
  }

  const gradeParsed = parseCanonicalPositiveInt(urlParams.get('grade_level'), 1, 12, 'grade_level');
  if (!gradeParsed.valid) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: gradeParsed.errorMessage };
  }
  if (gradeParsed.value !== undefined) {
    filters.grade_level = gradeParsed.value;
  }

  const visibility = urlParams.get('visibility');
  if (visibility !== null) {
    if (visibility === 'school_shared') {
      return {
        valid: false,
        errorCode: 'SCHOOL_CONTEXT_NOT_AVAILABLE',
        errorMessage: 'Lọc danh sách school_shared chưa được hỗ trợ ở phiên bản này.',
      };
    }
    filters.visibility = visibility;
  }

  const subject = urlParams.get('subject');
  if (subject !== null) filters.subject = subject.slice(0, 100);

  const questionType = urlParams.get('question_type');
  if (questionType !== null) filters.question_type = questionType.slice(0, 50);

  const difficulty = urlParams.get('difficulty');
  if (difficulty !== null) filters.difficulty = difficulty.slice(0, 20);

  const status = urlParams.get('status');
  if (status !== null) filters.status = status.slice(0, 20);

  const search = urlParams.get('search');
  if (search !== null) filters.search = search.slice(0, 200);

  return { valid: true, sanitizedData: filters };
}
