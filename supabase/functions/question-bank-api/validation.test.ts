// supabase/functions/question-bank-api/validation.test.ts
// Unit Tests for Request Query & Payload Validators (Pure Function Unit Tests)

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  isValidUUID,
  isPlainObject,
  parseCanonicalPositiveInt,
  validateQueryParamsAllowlist,
  validateStudentQueryParams,
  validateAuthoringQueryParams,
  validateListFilters,
  validateCreateQuestionPayload,
  validateCreateVersionPayload,
  validateForkQuestionPayload,
  validateUpdateMetadataPayload,
} from './validation.ts';

const VALID_UUID = 'b0000000-0000-0000-0000-000000000001';
const INVALID_UUID = 'not-a-valid-uuid';

// ============================================================================
// 1. Primitive Validator Helpers Tests
// ============================================================================

Deno.test('isValidUUID - validates canonical UUID-format strings', () => {
  assertEquals(isValidUUID(VALID_UUID), true);
  assertEquals(isValidUUID(INVALID_UUID), false);
  assertEquals(isValidUUID(''), false);
  assertEquals(isValidUUID(123), false);
  assertEquals(isValidUUID(null), false);
});

Deno.test('isPlainObject - distinguishes plain objects from arrays/primitives', () => {
  assertEquals(isPlainObject({}), true);
  assertEquals(isPlainObject({ a: 1 }), true);
  assertEquals(isPlainObject([]), false);
  assertEquals(isPlainObject(null), false);
  assertEquals(isPlainObject('string'), false);
  assertEquals(isPlainObject(123), false);
});

Deno.test('parseCanonicalPositiveInt - accepts valid integer strings and enforces range', () => {
  // Valid canonical positive integers
  assertEquals(parseCanonicalPositiveInt('1', 1, 100, 'page').valid, true);
  assertEquals(parseCanonicalPositiveInt('100', 1, 100, 'page').value, 100);
  assertEquals(parseCanonicalPositiveInt(null, 1, 100, 'page').valid, true);

  // Non-canonical patterns rejected
  assertEquals(parseCanonicalPositiveInt('+2', 1, 100, 'page').valid, false);
  assertEquals(parseCanonicalPositiveInt('', 1, 100, 'page').valid, false);
  assertEquals(parseCanonicalPositiveInt('1abc', 1, 100, 'page').valid, false);
  assertEquals(parseCanonicalPositiveInt('2.5', 1, 100, 'page').valid, false);
  assertEquals(parseCanonicalPositiveInt('-5', 1, 100, 'page').valid, false);
  assertEquals(parseCanonicalPositiveInt('1e3', 1, 100, 'page').valid, false);
  assertEquals(parseCanonicalPositiveInt(' 10 ', 1, 100, 'page').valid, false);

  // Range bounds enforcement
  assertEquals(parseCanonicalPositiveInt('0', 1, 100, 'page').valid, false);
  assertEquals(parseCanonicalPositiveInt('101', 1, 100, 'page').valid, false);
});

// ============================================================================
// 2. Query Parameters Validation Tests
// ============================================================================

Deno.test('validateQueryParamsAllowlist - blocks duplicate keys, unexpected keys, and forbidden keys', () => {
  const allowed = new Set(['page', 'page_size']);

  // Valid
  const validParams = new URLSearchParams('page=1&page_size=20');
  assertEquals(validateQueryParamsAllowlist(validParams, allowed).valid, true);

  // Duplicate key
  const dupParams = new URLSearchParams('page=1&page=2');
  const dupResult = validateQueryParamsAllowlist(dupParams, allowed);
  assertEquals(dupResult.valid, false);
  assertEquals(dupResult.duplicateKey, 'page');

  // Unexpected key
  const unexpParams = new URLSearchParams('page=1&foo=bar');
  const unexpResult = validateQueryParamsAllowlist(unexpParams, allowed);
  assertEquals(unexpResult.valid, false);
  assertEquals(unexpResult.unexpectedKey, 'foo');

  // Forbidden injection key
  const forbiddenParams = new URLSearchParams('page=1&caller_id=123');
  const forbiddenResult = validateQueryParamsAllowlist(forbiddenParams, allowed);
  assertEquals(forbiddenResult.valid, false);
});

Deno.test('validateStudentQueryParams - validates version_id query parameter', () => {
  // A. Valid with version_id
  const params1 = new URLSearchParams(`version_id=${VALID_UUID}`);
  const res1 = validateStudentQueryParams(params1);
  assertEquals(res1.valid, true);
  assertEquals(res1.sanitizedData?.versionId, VALID_UUID);

  // B. Valid without version_id
  const params2 = new URLSearchParams('');
  const res2 = validateStudentQueryParams(params2);
  assertEquals(res2.valid, true);
  assertEquals(res2.sanitizedData?.versionId, null);

  // C. Invalid UUID
  const params3 = new URLSearchParams(`version_id=${INVALID_UUID}`);
  const res3 = validateStudentQueryParams(params3);
  assertEquals(res3.valid, false);
  assertEquals(res3.errorCode, 'INVALID_INPUT');

  // D. Unknown query parameter
  const params4 = new URLSearchParams('unknown_param=1');
  const res4 = validateStudentQueryParams(params4);
  assertEquals(res4.valid, false);
  assertEquals(res4.errorCode, 'INVALID_REQUEST_FIELD');

  // E. Forbidden identity key
  const params5 = new URLSearchParams('caller_id=123');
  const res5 = validateStudentQueryParams(params5);
  assertEquals(res5.valid, false);
  assertEquals(res5.errorCode, 'INVALID_REQUEST_FIELD');

  // F. Duplicate version_id
  const params6 = new URLSearchParams(`version_id=${VALID_UUID}&version_id=${VALID_UUID}`);
  const res6 = validateStudentQueryParams(params6);
  assertEquals(res6.valid, false);
  assertEquals(res6.errorCode, 'INVALID_REQUEST_FIELD');
});

Deno.test('validateAuthoringQueryParams - validates full authoring query parameter matrix', () => {
  // A. Valid with version_id -> PASS
  const paramsA = new URLSearchParams(`version_id=${VALID_UUID}`);
  const resA = validateAuthoringQueryParams(paramsA);
  assertEquals(resA.valid, true);
  assertEquals(resA.sanitizedData?.versionId, VALID_UUID);

  // B. Missing version_id -> PASS + versionId null
  const paramsB = new URLSearchParams('');
  const resB = validateAuthoringQueryParams(paramsB);
  assertEquals(resB.valid, true);
  assertEquals(resB.sanitizedData?.versionId, null);

  // C. Invalid UUID -> FAIL INVALID_INPUT
  const paramsC = new URLSearchParams(`version_id=${INVALID_UUID}`);
  const resC = validateAuthoringQueryParams(paramsC);
  assertEquals(resC.valid, false);
  assertEquals(resC.errorCode, 'INVALID_INPUT');

  // D. Unknown key -> FAIL INVALID_REQUEST_FIELD
  const paramsD = new URLSearchParams('unknown_authoring_param=abc');
  const resD = validateAuthoringQueryParams(paramsD);
  assertEquals(resD.valid, false);
  assertEquals(resD.errorCode, 'INVALID_REQUEST_FIELD');

  // E. Forbidden identity key -> FAIL INVALID_REQUEST_FIELD
  const paramsE = new URLSearchParams('actor_role=admin');
  const resE = validateAuthoringQueryParams(paramsE);
  assertEquals(resE.valid, false);
  assertEquals(resE.errorCode, 'INVALID_REQUEST_FIELD');

  // F. Duplicate version_id -> FAIL INVALID_REQUEST_FIELD
  const paramsF = new URLSearchParams(`version_id=${VALID_UUID}&version_id=${VALID_UUID}`);
  const resF = validateAuthoringQueryParams(paramsF);
  assertEquals(resF.valid, false);
  assertEquals(resF.errorCode, 'INVALID_REQUEST_FIELD');
});

Deno.test('validateListFilters - validates pagination, grade_level, visibility, and search filters', () => {
  // Valid full filter set
  const params1 = new URLSearchParams('page=2&page_size=50&grade_level=10&subject=Toan&difficulty=medium&visibility=private&search=hinh_hoc');
  const res1 = validateListFilters(params1);
  assertEquals(res1.valid, true);
  assertEquals(res1.sanitizedData?.page, 2);
  assertEquals(res1.sanitizedData?.page_size, 50);
  assertEquals(res1.sanitizedData?.grade_level, 10);
  assertEquals(res1.sanitizedData?.subject, 'Toan');

  // Visibility school_shared gated in V1
  const schoolSharedParams = new URLSearchParams('visibility=school_shared');
  const schoolRes = validateListFilters(schoolSharedParams);
  assertEquals(schoolRes.valid, false);
  assertEquals(schoolRes.errorCode, 'SCHOOL_CONTEXT_NOT_AVAILABLE');

  // Forbidden query parameter (actor_role)
  const forbiddenParams = new URLSearchParams('actor_role=admin');
  const forbiddenRes = validateListFilters(forbiddenParams);
  assertEquals(forbiddenRes.valid, false);
  assertEquals(forbiddenRes.errorCode, 'INVALID_REQUEST_FIELD');

  // Duplicate query parameter
  const dupParams = new URLSearchParams('page=1&page=2');
  const dupRes = validateListFilters(dupParams);
  assertEquals(dupRes.valid, false);
  assertEquals(dupRes.errorCode, 'INVALID_REQUEST_FIELD');
});

Deno.test('validateListFilters - direct page parsing bounds and noncanonical tests', () => {
  assertEquals(validateListFilters(new URLSearchParams('page=1')).valid, true);
  assertEquals(validateListFilters(new URLSearchParams('page=1abc')).valid, false);
  assertEquals(validateListFilters(new URLSearchParams('page=2.5')).valid, false);
  assertEquals(validateListFilters(new URLSearchParams('page=0')).valid, false);
  assertEquals(validateListFilters(new URLSearchParams('page=-1')).valid, false);
});

Deno.test('validateListFilters - direct page_size parsing bounds and noncanonical tests', () => {
  assertEquals(validateListFilters(new URLSearchParams('page_size=1')).valid, true);
  assertEquals(validateListFilters(new URLSearchParams('page_size=100')).valid, true);
  assertEquals(validateListFilters(new URLSearchParams('page_size=101')).valid, false);
  assertEquals(validateListFilters(new URLSearchParams('page_size=0')).valid, false);
  assertEquals(validateListFilters(new URLSearchParams('page_size=20.5')).valid, false);
});

Deno.test('validateListFilters - direct grade_level parsing bounds and noncanonical tests', () => {
  assertEquals(validateListFilters(new URLSearchParams('grade_level=1')).valid, true);
  assertEquals(validateListFilters(new URLSearchParams('grade_level=12')).valid, true);
  assertEquals(validateListFilters(new URLSearchParams('grade_level=0')).valid, false);
  assertEquals(validateListFilters(new URLSearchParams('grade_level=13')).valid, false);
  assertEquals(validateListFilters(new URLSearchParams('grade_level=G10')).valid, false);
});

// ============================================================================
// 3. Payload Validation Tests
// ============================================================================

// --- Create Question Payload ---
Deno.test('validateCreateQuestionPayload - PASS: valid full payload', () => {
  const payload = {
    title: 'Câu hỏi Toán Giải Tích 12',
    question_type: 'single_choice',
    subject: 'Toan',
    grade_level: 12,
    difficulty: 'medium',
    visibility: 'private',
    prompt: 'Tính đạo hàm của hàm số f(x) = x^2...',
    options: [{ id: 'opt_1', text: '2x' }],
    answer_key: { correct_answers: ['opt_1'] },
  };
  const res = validateCreateQuestionPayload(payload);
  assertEquals(res.valid, true);
});

Deno.test('validateCreateQuestionPayload - FAIL: non-object raw payload', () => {
  assertEquals(validateCreateQuestionPayload('invalid-string').valid, false);
  assertEquals(validateCreateQuestionPayload(null).valid, false);
  assertEquals(validateCreateQuestionPayload([1, 2, 3]).valid, false);
});

Deno.test('validateCreateQuestionPayload - FAIL: forbidden injection fields', () => {
  const payload = {
    title: 'Tiêu đề',
    subject: 'Toan',
    grade_level: 10,
    prompt: 'Đề bài',
    answer_key: {},
    caller_id: 'injected-caller-id',
  };
  const res = validateCreateQuestionPayload(payload);
  assertEquals(res.valid, false);
  assertEquals(res.errorCode, 'INVALID_REQUEST_FIELD');
});

Deno.test('validateCreateQuestionPayload - FAIL: unknown field outside allowlist', () => {
  const payload = {
    title: 'Tiêu đề',
    subject: 'Toan',
    grade_level: 10,
    prompt: 'Đề bài',
    answer_key: {},
    unapproved_extra_field: 'malicious',
  };
  const res = validateCreateQuestionPayload(payload);
  assertEquals(res.valid, false);
  assertEquals(res.errorCode, 'INVALID_REQUEST_FIELD');
});

Deno.test('validateCreateQuestionPayload - FAIL: answer_key is array / null / non-object', () => {
  const base = {
    title: 'Tiêu đề',
    subject: 'Toan',
    grade_level: 10,
    prompt: 'Đề bài',
  };

  assertEquals(validateCreateQuestionPayload({ ...base, answer_key: ['opt_1'] }).valid, false);
  assertEquals(validateCreateQuestionPayload({ ...base, answer_key: null }).valid, false);
  assertEquals(validateCreateQuestionPayload({ ...base, answer_key: 'string_key' }).valid, false);
});

Deno.test('validateCreateQuestionPayload - FAIL: school_shared visibility blocked in V1', () => {
  const payload = {
    title: 'Tiêu đề',
    subject: 'Toan',
    grade_level: 10,
    prompt: 'Đề bài',
    answer_key: {},
    visibility: 'school_shared',
  };
  const res = validateCreateQuestionPayload(payload);
  assertEquals(res.valid, false);
  assertEquals(res.errorCode, 'SCHOOL_CONTEXT_NOT_AVAILABLE');
});

Deno.test('validateCreateQuestionPayload - FAIL: invalid grade_level', () => {
  const base = {
    title: 'Tiêu đề',
    subject: 'Toan',
    prompt: 'Đề bài',
    answer_key: {},
  };
  assertEquals(validateCreateQuestionPayload({ ...base, grade_level: 0 }).valid, false);
  assertEquals(validateCreateQuestionPayload({ ...base, grade_level: 13 }).valid, false);
  assertEquals(validateCreateQuestionPayload({ ...base, grade_level: 'abc' }).valid, false);
});

// --- Create Version Payload ---
Deno.test('validateCreateVersionPayload - PASS: valid version payload', () => {
  const payload = {
    prompt: 'Nội dung đề bài cập nhật cho version 2',
    options: [{ id: 'opt_1', text: 'Đáp án mới' }],
    answer_key: { correct_answers: ['opt_1'] },
    change_log: 'Cập nhật đề bài rõ nghĩa hơn',
  };
  const res = validateCreateVersionPayload(payload);
  assertEquals(res.valid, true);
});

Deno.test('validateCreateVersionPayload - FAIL: missing prompt or non-object answer_key', () => {
  assertEquals(validateCreateVersionPayload({ prompt: '', answer_key: {} }).valid, false);
  assertEquals(validateCreateVersionPayload({ prompt: 'Đề bài', answer_key: null }).valid, false);
});

Deno.test('validateCreateVersionPayload - FAIL: forbidden fields in version payload', () => {
  const payload = {
    prompt: 'Đề bài',
    answer_key: {},
    p_actor_role: 'admin',
  };
  const res = validateCreateVersionPayload(payload);
  assertEquals(res.valid, false);
  assertEquals(res.errorCode, 'INVALID_REQUEST_FIELD');
});

// --- Fork Question Payload ---
Deno.test('validateForkQuestionPayload - PASS: empty object or override payload', () => {
  assertEquals(validateForkQuestionPayload({}).valid, true);
  assertEquals(validateForkQuestionPayload({ title: 'Bản sao tùy chỉnh', visibility: 'private' }).valid, true);
});

Deno.test('validateForkQuestionPayload - FAIL: non-object or invalid types', () => {
  assertEquals(validateForkQuestionPayload(null).valid, false);
  assertEquals(validateForkQuestionPayload('string').valid, false);
  assertEquals(validateForkQuestionPayload([1, 2]).valid, false);
});

Deno.test('validateForkQuestionPayload - FAIL: school_shared visibility blocked', () => {
  const res = validateForkQuestionPayload({ visibility: 'school_shared' });
  assertEquals(res.valid, false);
  assertEquals(res.errorCode, 'SCHOOL_CONTEXT_NOT_AVAILABLE');
});

Deno.test('validateForkQuestionPayload - FAIL: forbidden fields', () => {
  const res = validateForkQuestionPayload({ actor_role: 'admin' });
  assertEquals(res.valid, false);
  assertEquals(res.errorCode, 'INVALID_REQUEST_FIELD');
});

// --- Update Metadata Payload ---
Deno.test('validateUpdateMetadataPayload - PASS: valid metadata updates', () => {
  const payload = {
    title: 'Tiêu đề cập nhật',
    subject: 'VatLy',
    difficulty: 'hard',
    visibility: 'private',
    tags: ['chuong1', 'donghoc'],
  };
  const res = validateUpdateMetadataPayload(payload);
  assertEquals(res.valid, true);
});

Deno.test('validateUpdateMetadataPayload - FAIL: forbidden school_id or school_shared', () => {
  assertEquals(validateUpdateMetadataPayload({ school_id: VALID_UUID }).valid, false);
  assertEquals(validateUpdateMetadataPayload({ visibility: 'school_shared' }).valid, false);
});

Deno.test('validateUpdateMetadataPayload - FAIL: empty metadata object', () => {
  const res = validateUpdateMetadataPayload({});
  assertEquals(res.valid, false);
  assertEquals(res.errorCode, 'INVALID_INPUT');
  assertEquals(res.errorMessage, 'Phải cập nhật ít nhất một trường thông tin metadata.');
});
