// supabase/functions/question-bank-api/errors.test.ts
// Unit Tests for Success Contract Mappers & Sanitized Error Normalizer (Pure Function Unit Tests)

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  createErrorResponse,
  createSuccessResponse,
  mapCreateQuestionSuccess,
  mapCreateVersionSuccess,
  mapGetStudentQuestionSuccess,
  mapGetAuthoringDetailSuccess,
  mapListQuestionsSuccess,
  mapForkQuestionSuccess,
  mapUpdateMetadataSuccess,
  normalizeRpcError,
} from './errors.ts';

const VALID_UUID_1 = 'a0000000-0000-0000-0000-000000000001';
const VALID_UUID_2 = 'a0000000-0000-0000-0000-000000000002';
const INVALID_UUID = 'not-a-valid-uuid';

// ============================================================================
// 1. Success Contract Mappers Tests (7 RPCs)
// ============================================================================

// --- RPC 1: mapCreateQuestionSuccess ---
Deno.test('mapCreateQuestionSuccess - PASS: valid payload with UUIDs, code, version_number', () => {
  const payload = {
    item_id: VALID_UUID_1,
    version_id: VALID_UUID_2,
    code: 'QB-MAT-G10-001',
    version_number: 1,
  };
  const result = mapCreateQuestionSuccess(payload);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.data.item_id, VALID_UUID_1);
    assertEquals(result.data.version_id, VALID_UUID_2);
    assertEquals(result.data.code, 'QB-MAT-G10-001');
    assertEquals(result.data.version_number, 1);
  }
});

Deno.test('mapCreateQuestionSuccess - FAIL: missing item_id', () => {
  const payload = {
    version_id: VALID_UUID_2,
    code: 'QB-MAT-G10-001',
    version_number: 1,
  };
  const result = mapCreateQuestionSuccess(payload);
  assertEquals(result.ok, false);
});

Deno.test('mapCreateQuestionSuccess - FAIL: invalid version_id format', () => {
  const payload = {
    item_id: VALID_UUID_1,
    version_id: INVALID_UUID,
    code: 'QB-MAT-G10-001',
    version_number: 1,
  };
  const result = mapCreateQuestionSuccess(payload);
  assertEquals(result.ok, false);
});

Deno.test('mapCreateQuestionSuccess - FAIL: empty code', () => {
  const payload = {
    item_id: VALID_UUID_1,
    version_id: VALID_UUID_2,
    code: '   ',
    version_number: 1,
  };
  const result = mapCreateQuestionSuccess(payload);
  assertEquals(result.ok, false);
});

Deno.test('mapCreateQuestionSuccess - FAIL: version_number <= 0', () => {
  const payload = {
    item_id: VALID_UUID_1,
    version_id: VALID_UUID_2,
    code: 'QB-MAT-G10-001',
    version_number: 0,
  };
  const result = mapCreateQuestionSuccess(payload);
  assertEquals(result.ok, false);
});

// --- RPC 2: mapCreateVersionSuccess ---
Deno.test('mapCreateVersionSuccess - PASS: valid payload', () => {
  const payload = {
    item_id: VALID_UUID_1,
    version_id: VALID_UUID_2,
    version_number: 2,
  };
  const result = mapCreateVersionSuccess(payload);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.data.item_id, VALID_UUID_1);
    assertEquals(result.data.version_id, VALID_UUID_2);
    assertEquals(result.data.version_number, 2);
  }
});

Deno.test('mapCreateVersionSuccess - FAIL: missing version_id', () => {
  const payload = {
    item_id: VALID_UUID_1,
    version_number: 2,
  };
  const result = mapCreateVersionSuccess(payload);
  assertEquals(result.ok, false);
});

Deno.test('mapCreateVersionSuccess - FAIL: invalid version_number (negative)', () => {
  const payload = {
    item_id: VALID_UUID_1,
    version_id: VALID_UUID_2,
    version_number: -1,
  };
  const result = mapCreateVersionSuccess(payload);
  assertEquals(result.ok, false);
});

// --- RPC 3: mapGetStudentQuestionSuccess ---
Deno.test('mapGetStudentQuestionSuccess - PASS: valid nested STUDENT_SAFE projection and objects', () => {
  const payload = {
    projection: 'STUDENT_SAFE',
    item: { id: VALID_UUID_1, title: 'Câu hỏi mẫu' },
    version: { id: VALID_UUID_2, prompt: 'Đề bài...' },
  };
  const result = mapGetStudentQuestionSuccess(payload);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.data.projection, 'STUDENT_SAFE');
    assertEquals(result.data.item.id, VALID_UUID_1);
    assertEquals(result.data.version.id, VALID_UUID_2);
  }
});

Deno.test('mapGetStudentQuestionSuccess - PASS: valid flat Staging RPC payload without projection', () => {
  const payload = {
    id: VALID_UUID_1,
    code: 'QB-DDC17FD97E8D',
    title: '[SMOKE-TEST] Phép cộng đơn giản',
    question_type: 'single_choice',
    version_id: VALID_UUID_2,
    version_number: 1,
    prompt: '2 + 3 = ?',
    prompt_media: null,
    options: [
      { id: 'opt_1', text: '4' },
      { id: 'opt_2', text: '5' },
    ],
  };
  const result = mapGetStudentQuestionSuccess(payload);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.data.projection, 'STUDENT_SAFE');
    assertEquals(result.data.item.id, VALID_UUID_1);
    assertEquals(result.data.item.code, 'QB-DDC17FD97E8D');
    assertEquals(result.data.item.title, '[SMOKE-TEST] Phép cộng đơn giản');
    assertEquals(result.data.version.id, VALID_UUID_2);
    assertEquals(result.data.version.prompt, '2 + 3 = ?');
    assertEquals(Array.isArray(result.data.version.options), true);
  }
});

Deno.test('mapGetStudentQuestionSuccess - PASS: strict allowlist strips unauthorized draft or private fields', () => {
  const payload = {
    id: VALID_UUID_1,
    code: 'QB-TEST-ALLOWLIST',
    title: 'Câu hỏi kiểm tra allowlist',
    question_type: 'single_choice',
    version_id: VALID_UUID_2,
    prompt: 'Đề bài an toàn',
    options: [
      { id: 'opt_1', text: 'A', extra_metadata: 'meta', secret_tag: 'hidden' },
    ],
    // Các trường ngoài luồng không được phép rò rỉ:
    author_id: 'secret-author-uuid',
    school_id: 'secret-school-uuid',
    status: 'draft',
    internal_notes: 'ghi chú nhạy cảm',
  };
  const result = mapGetStudentQuestionSuccess(payload);
  assertEquals(result.ok, true);
  if (result.ok) {
    // Chỉ các trường trong allowlist được giữ lại:
    assertEquals('author_id' in result.data.item, false);
    assertEquals('school_id' in result.data.item, false);
    assertEquals('status' in result.data.item, false);
    assertEquals('internal_notes' in result.data.item, false);
    // Option được lọc sạch các trường ngoài allowlist:
    const opt = (result.data.version.options as Record<string, unknown>[])[0];
    assertEquals(opt.id, 'opt_1');
    assertEquals(opt.text, 'A');
    assertEquals('extra_metadata' in opt, false);
    assertEquals('secret_tag' in opt, false);
  }
});

Deno.test('mapGetStudentQuestionSuccess - FAIL: options contain is_correct or sensitive fields (fail-closed)', () => {
  // Option chứa is_correct: true
  assertEquals(mapGetStudentQuestionSuccess({
    id: VALID_UUID_1,
    version_id: VALID_UUID_2,
    prompt: 'Prompt',
    options: [{ id: 'opt_1', text: 'A', is_correct: true }],
  }).ok, false);

  // Option chứa is_correct: false
  assertEquals(mapGetStudentQuestionSuccess({
    id: VALID_UUID_1,
    version_id: VALID_UUID_2,
    prompt: 'Prompt',
    options: [{ id: 'opt_1', text: 'A', is_correct: false }],
  }).ok, false);

  // Option chứa score
  assertEquals(mapGetStudentQuestionSuccess({
    id: VALID_UUID_1,
    version_id: VALID_UUID_2,
    prompt: 'Prompt',
    options: [{ id: 'opt_1', text: 'A', score: 10 }],
  }).ok, false);

  // Option chứa explanation
  assertEquals(mapGetStudentQuestionSuccess({
    id: VALID_UUID_1,
    version_id: VALID_UUID_2,
    prompt: 'Prompt',
    options: [{ id: 'opt_1', text: 'A', explanation: 'Vì sao đáp án đúng' }],
  }).ok, false);
});

Deno.test('mapGetStudentQuestionSuccess - FAIL: options contain non-plain-object elements (null, string, number, array)', () => {
  // Option là null
  assertEquals(mapGetStudentQuestionSuccess({
    id: VALID_UUID_1,
    version_id: VALID_UUID_2,
    prompt: 'Prompt',
    options: [{ id: 'opt_1', text: 'A' }, null],
  }).ok, false);

  // Option là string
  assertEquals(mapGetStudentQuestionSuccess({
    id: VALID_UUID_1,
    version_id: VALID_UUID_2,
    prompt: 'Prompt',
    options: ['opt_1_as_string'],
  }).ok, false);

  // Option là number
  assertEquals(mapGetStudentQuestionSuccess({
    id: VALID_UUID_1,
    version_id: VALID_UUID_2,
    prompt: 'Prompt',
    options: [12345],
  }).ok, false);

  // Option là mảng lồng nhau
  assertEquals(mapGetStudentQuestionSuccess({
    id: VALID_UUID_1,
    version_id: VALID_UUID_2,
    prompt: 'Prompt',
    options: [[{ id: 'opt_1', text: 'A' }]],
  }).ok, false);
});

Deno.test('mapGetStudentQuestionSuccess - FAIL: options is not an array (object, string, number)', () => {
  assertEquals(mapGetStudentQuestionSuccess({
    id: VALID_UUID_1,
    version_id: VALID_UUID_2,
    prompt: 'Prompt',
    options: { opt_1: 'A', opt_2: 'B' },
  }).ok, false);

  assertEquals(mapGetStudentQuestionSuccess({
    id: VALID_UUID_1,
    version_id: VALID_UUID_2,
    prompt: 'Prompt',
    options: 'invalid_options_string',
  }).ok, false);

  assertEquals(mapGetStudentQuestionSuccess({
    id: VALID_UUID_1,
    version_id: VALID_UUID_2,
    prompt: 'Prompt',
    options: 12345,
  }).ok, false);
});

Deno.test('mapGetStudentQuestionSuccess - FAIL: options contain sensitive fields in nested media', () => {
  // Sensitive field in media object
  assertEquals(mapGetStudentQuestionSuccess({
    id: VALID_UUID_1,
    version_id: VALID_UUID_2,
    prompt: 'Prompt',
    options: [
      {
        id: 'opt_1',
        text: 'A',
        media: { url: 'https://example.com/img.png', is_correct: true },
      },
    ],
  }).ok, false);

  // Sensitive field in media array
  assertEquals(mapGetStudentQuestionSuccess({
    id: VALID_UUID_1,
    version_id: VALID_UUID_2,
    prompt: 'Prompt',
    options: [
      {
        id: 'opt_1',
        text: 'A',
        media: [{ url: 'https://example.com/img.png', score: 100 }],
      },
    ],
  }).ok, false);
});

Deno.test('mapGetStudentQuestionSuccess - PASS: questions without options (essay/short answer)', () => {
  // options null
  const res1 = mapGetStudentQuestionSuccess({
    id: VALID_UUID_1,
    version_id: VALID_UUID_2,
    prompt: 'Hãy phân tích bài thơ...',
    options: null,
  });
  assertEquals(res1.ok, true);
  if (res1.ok) {
    assertEquals(res1.data.version.options, null);
  }

  // options undefined
  const res2 = mapGetStudentQuestionSuccess({
    id: VALID_UUID_1,
    version_id: VALID_UUID_2,
    prompt: 'Hãy phân tích bài thơ...',
  });
  assertEquals(res2.ok, true);
  if (res2.ok) {
    assertEquals(res2.data.version.options, null);
  }
});

Deno.test('mapGetStudentQuestionSuccess - FAIL: payload contains answer_key or correct_answers (leakage prevention)', () => {
  // Rò rỉ ở root:
  assertEquals(mapGetStudentQuestionSuccess({
    id: VALID_UUID_1,
    version_id: VALID_UUID_2,
    prompt: 'Prompt',
    answer_key: { correct_answer: 'A' },
  }).ok, false);

  assertEquals(mapGetStudentQuestionSuccess({
    id: VALID_UUID_1,
    version_id: VALID_UUID_2,
    prompt: 'Prompt',
    correct_answers: ['A'],
  }).ok, false);

  assertEquals(mapGetStudentQuestionSuccess({
    id: VALID_UUID_1,
    version_id: VALID_UUID_2,
    prompt: 'Prompt',
    solution_explanation: 'Lời giải chi tiết',
  }).ok, false);

  assertEquals(mapGetStudentQuestionSuccess({
    id: VALID_UUID_1,
    version_id: VALID_UUID_2,
    prompt: 'Prompt',
    grading_config: { points: 10 },
  }).ok, false);

  // Rò rỉ trong nested version:
  assertEquals(mapGetStudentQuestionSuccess({
    projection: 'STUDENT_SAFE',
    item: { id: VALID_UUID_1 },
    version: { id: VALID_UUID_2, correct_answers: ['A'] },
  }).ok, false);
});

Deno.test('mapGetStudentQuestionSuccess - FAIL: wrong projection (AUTHORING_SAFE, PUBLIC, empty, null)', () => {
  assertEquals(mapGetStudentQuestionSuccess({
    projection: 'AUTHORING_SAFE',
    item: { id: VALID_UUID_1 },
    version: { id: VALID_UUID_2 },
  }).ok, false);

  assertEquals(mapGetStudentQuestionSuccess({
    projection: 'PUBLIC',
    item: { id: VALID_UUID_1 },
    version: { id: VALID_UUID_2 },
  }).ok, false);

  assertEquals(mapGetStudentQuestionSuccess({
    projection: '',
    item: { id: VALID_UUID_1 },
    version: { id: VALID_UUID_2 },
  }).ok, false);

  assertEquals(mapGetStudentQuestionSuccess({
    projection: null,
    item: { id: VALID_UUID_1 },
    version: { id: VALID_UUID_2 },
  }).ok, false);
});

Deno.test('mapGetStudentQuestionSuccess - FAIL: missing item or id in payload', () => {
  // Thiếu item trong nested
  assertEquals(mapGetStudentQuestionSuccess({
    projection: 'STUDENT_SAFE',
    version: { id: VALID_UUID_2 },
  }).ok, false);

  // Thiếu id trong flat
  assertEquals(mapGetStudentQuestionSuccess({
    version_id: VALID_UUID_2,
    prompt: 'Prompt',
  }).ok, false);

  // id không phải string
  assertEquals(mapGetStudentQuestionSuccess({
    id: 12345,
    version_id: VALID_UUID_2,
  }).ok, false);
});

Deno.test('mapGetStudentQuestionSuccess - FAIL: missing version or version_id in payload', () => {
  // Thiếu version trong nested
  assertEquals(mapGetStudentQuestionSuccess({
    projection: 'STUDENT_SAFE',
    item: { id: VALID_UUID_1 },
  }).ok, false);

  // Thiếu version_id trong flat
  assertEquals(mapGetStudentQuestionSuccess({
    id: VALID_UUID_1,
    prompt: 'Prompt',
  }).ok, false);

  // version_id không phải string
  assertEquals(mapGetStudentQuestionSuccess({
    id: VALID_UUID_1,
    version_id: null,
  }).ok, false);
});

Deno.test('mapGetStudentQuestionSuccess - FAIL: non-record payload', () => {
  assertEquals(mapGetStudentQuestionSuccess(null).ok, false);
  assertEquals(mapGetStudentQuestionSuccess(undefined).ok, false);
  assertEquals(mapGetStudentQuestionSuccess('string').ok, false);
  assertEquals(mapGetStudentQuestionSuccess([]).ok, false);
  assertEquals(mapGetStudentQuestionSuccess(12345).ok, false);
});

// --- RPC 4: mapGetAuthoringDetailSuccess ---
Deno.test('mapGetAuthoringDetailSuccess - PASS: valid AUTHORING_SAFE with answer_key object', () => {
  const payload = {
    projection: 'AUTHORING_SAFE',
    item: { id: VALID_UUID_1 },
    version: { id: VALID_UUID_2 },
    answer_key: { correct_answers: ['A'], grading_rubric: {} },
  };
  const result = mapGetAuthoringDetailSuccess(payload);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.data.projection, 'AUTHORING_SAFE');
    assertEquals(result.data.answer_key !== null, true);
  }
});

Deno.test('mapGetAuthoringDetailSuccess - PASS: valid AUTHORING_SAFE with answer_key null (SQL contract compliant)', () => {
  const payload = {
    projection: 'AUTHORING_SAFE',
    item: { id: VALID_UUID_1 },
    version: { id: VALID_UUID_2 },
    answer_key: null,
  };
  const result = mapGetAuthoringDetailSuccess(payload);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.data.projection, 'AUTHORING_SAFE');
    assertEquals(result.data.answer_key, null);
  }
});

Deno.test('mapGetAuthoringDetailSuccess - PASS: valid legacy Staging payload without projection (answer_key object)', () => {
  const payload = {
    item: { id: VALID_UUID_1, title: '[SMOKE-TEST] Phép cộng đơn giản' },
    version: { id: VALID_UUID_2, prompt: '2 + 3 = ?' },
    answer_key: { correct_answers: { correct_option_id: 'opt_2' }, grading_config: null },
  };
  const result = mapGetAuthoringDetailSuccess(payload);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.data.projection, 'AUTHORING_SAFE');
    assertEquals(result.data.item.id, VALID_UUID_1);
    assertEquals(result.data.version.id, VALID_UUID_2);
    assertEquals(result.data.answer_key !== null, true);
  }
});

Deno.test('mapGetAuthoringDetailSuccess - PASS: valid legacy Staging payload without projection (answer_key null)', () => {
  const payload = {
    item: { id: VALID_UUID_1 },
    version: { id: VALID_UUID_2 },
    answer_key: null,
  };
  const result = mapGetAuthoringDetailSuccess(payload);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.data.projection, 'AUTHORING_SAFE');
    assertEquals(result.data.answer_key, null);
  }
});

Deno.test('mapGetAuthoringDetailSuccess - FAIL: wrong projection (STUDENT_SAFE)', () => {
  const payload = {
    projection: 'STUDENT_SAFE',
    item: { id: VALID_UUID_1 },
    version: { id: VALID_UUID_2 },
    answer_key: null,
  };
  const result = mapGetAuthoringDetailSuccess(payload);
  assertEquals(result.ok, false);
});

Deno.test('mapGetAuthoringDetailSuccess - FAIL: wrong projection (arbitrary string or empty)', () => {
  assertEquals(mapGetAuthoringDetailSuccess({
    projection: 'PUBLIC',
    item: { id: VALID_UUID_1 },
    version: { id: VALID_UUID_2 },
    answer_key: null,
  }).ok, false);

  assertEquals(mapGetAuthoringDetailSuccess({
    projection: '',
    item: { id: VALID_UUID_1 },
    version: { id: VALID_UUID_2 },
    answer_key: null,
  }).ok, false);

  assertEquals(mapGetAuthoringDetailSuccess({
    projection: null,
    item: { id: VALID_UUID_1 },
    version: { id: VALID_UUID_2 },
    answer_key: null,
  }).ok, false);
});

Deno.test('mapGetAuthoringDetailSuccess - FAIL: missing or invalid item', () => {
  assertEquals(mapGetAuthoringDetailSuccess({
    version: { id: VALID_UUID_2 },
    answer_key: null,
  }).ok, false);

  assertEquals(mapGetAuthoringDetailSuccess({
    item: null,
    version: { id: VALID_UUID_2 },
    answer_key: null,
  }).ok, false);

  assertEquals(mapGetAuthoringDetailSuccess({
    item: 'not-an-object',
    version: { id: VALID_UUID_2 },
    answer_key: null,
  }).ok, false);

  assertEquals(mapGetAuthoringDetailSuccess({
    item: [VALID_UUID_1],
    version: { id: VALID_UUID_2 },
    answer_key: null,
  }).ok, false);
});

Deno.test('mapGetAuthoringDetailSuccess - FAIL: missing or invalid version', () => {
  assertEquals(mapGetAuthoringDetailSuccess({
    item: { id: VALID_UUID_1 },
    answer_key: null,
  }).ok, false);

  assertEquals(mapGetAuthoringDetailSuccess({
    item: { id: VALID_UUID_1 },
    version: null,
    answer_key: null,
  }).ok, false);

  assertEquals(mapGetAuthoringDetailSuccess({
    item: { id: VALID_UUID_1 },
    version: 'not-an-object',
    answer_key: null,
  }).ok, false);
});

Deno.test('mapGetAuthoringDetailSuccess - FAIL: answer_key is string instead of object/null', () => {
  const payload = {
    projection: 'AUTHORING_SAFE',
    item: { id: VALID_UUID_1 },
    version: { id: VALID_UUID_2 },
    answer_key: 'invalid-string',
  };
  const result = mapGetAuthoringDetailSuccess(payload);
  assertEquals(result.ok, false);
});

Deno.test('mapGetAuthoringDetailSuccess - FAIL: answer_key is array', () => {
  const payload = {
    projection: 'AUTHORING_SAFE',
    item: { id: VALID_UUID_1 },
    version: { id: VALID_UUID_2 },
    answer_key: ['A', 'B'],
  };
  const result = mapGetAuthoringDetailSuccess(payload);
  assertEquals(result.ok, false);
});

Deno.test('mapGetAuthoringDetailSuccess - FAIL: non-record payload (null, undefined, string, array)', () => {
  assertEquals(mapGetAuthoringDetailSuccess(null).ok, false);
  assertEquals(mapGetAuthoringDetailSuccess(undefined).ok, false);
  assertEquals(mapGetAuthoringDetailSuccess('not-a-record').ok, false);
  assertEquals(mapGetAuthoringDetailSuccess([]).ok, false);
  assertEquals(mapGetAuthoringDetailSuccess(12345).ok, false);
});

// --- RPC 5: mapListQuestionsSuccess ---
Deno.test('mapListQuestionsSuccess - PASS: valid list structure', () => {
  const payload = {
    total_count: 50,
    page: 1,
    page_size: 20,
    items: [{ id: VALID_UUID_1 }],
  };
  const result = mapListQuestionsSuccess(payload);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.data.total_count, 50);
    assertEquals(result.data.page, 1);
    assertEquals(result.data.page_size, 20);
    assertEquals(result.data.items.length, 1);
  }
});

Deno.test('mapListQuestionsSuccess - PASS: empty items list with total_count = 0', () => {
  const payload = {
    total_count: 0,
    page: 1,
    page_size: 20,
    items: [],
  };
  const result = mapListQuestionsSuccess(payload);
  assertEquals(result.ok, true);
});

Deno.test('mapListQuestionsSuccess - FAIL: negative total_count', () => {
  const payload = {
    total_count: -1,
    page: 1,
    page_size: 20,
    items: [],
  };
  const result = mapListQuestionsSuccess(payload);
  assertEquals(result.ok, false);
});

Deno.test('mapListQuestionsSuccess - FAIL: page = 0', () => {
  const payload = {
    total_count: 10,
    page: 0,
    page_size: 20,
    items: [],
  };
  const result = mapListQuestionsSuccess(payload);
  assertEquals(result.ok, false);
});

Deno.test('mapListQuestionsSuccess - FAIL: page_size = 0', () => {
  const payload = {
    total_count: 10,
    page: 1,
    page_size: 0,
    items: [],
  };
  const result = mapListQuestionsSuccess(payload);
  assertEquals(result.ok, false);
});

Deno.test('mapListQuestionsSuccess - FAIL: page_size > 100', () => {
  const payload = {
    total_count: 10,
    page: 1,
    page_size: 101,
    items: [],
  };
  const result = mapListQuestionsSuccess(payload);
  assertEquals(result.ok, false);
});

Deno.test('mapListQuestionsSuccess - FAIL: items is not an array', () => {
  const payload = {
    total_count: 10,
    page: 1,
    page_size: 20,
    items: { item: 1 },
  };
  const result = mapListQuestionsSuccess(payload);
  assertEquals(result.ok, false);
});

// --- RPC 6: mapForkQuestionSuccess ---
Deno.test('mapForkQuestionSuccess - PASS: valid fork payload', () => {
  const payload = {
    item_id: VALID_UUID_1,
    version_id: VALID_UUID_2,
    code: 'QB-MAT-G10-FORK-001',
    forked_from_version_id: 'a0000000-0000-0000-0000-000000000003',
  };
  const result = mapForkQuestionSuccess(payload);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.data.item_id, VALID_UUID_1);
    assertEquals(result.data.forked_from_version_id, 'a0000000-0000-0000-0000-000000000003');
  }
});

Deno.test('mapForkQuestionSuccess - FAIL: missing forked_from_version_id', () => {
  const payload = {
    item_id: VALID_UUID_1,
    version_id: VALID_UUID_2,
    code: 'QB-MAT-G10-FORK-001',
  };
  const result = mapForkQuestionSuccess(payload);
  assertEquals(result.ok, false);
});

Deno.test('mapForkQuestionSuccess - FAIL: invalid source version UUID', () => {
  const payload = {
    item_id: VALID_UUID_1,
    version_id: VALID_UUID_2,
    code: 'QB-MAT-G10-FORK-001',
    forked_from_version_id: INVALID_UUID,
  };
  const result = mapForkQuestionSuccess(payload);
  assertEquals(result.ok, false);
});

Deno.test('mapForkQuestionSuccess - FAIL: empty code', () => {
  const payload = {
    item_id: VALID_UUID_1,
    version_id: VALID_UUID_2,
    code: '',
    forked_from_version_id: VALID_UUID_1,
  };
  const result = mapForkQuestionSuccess(payload);
  assertEquals(result.ok, false);
});

// --- RPC 7: mapUpdateMetadataSuccess ---
Deno.test('mapUpdateMetadataSuccess - PASS: valid update metadata response', () => {
  const payload = {
    item_id: VALID_UUID_1,
    message: 'Item metadata updated successfully',
  };
  const result = mapUpdateMetadataSuccess(payload);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.data.item_id, VALID_UUID_1);
    assertEquals(result.data.message, 'Item metadata updated successfully');
  }
});

Deno.test('mapUpdateMetadataSuccess - FAIL: missing item_id', () => {
  const payload = {
    message: 'Item metadata updated successfully',
  };
  const result = mapUpdateMetadataSuccess(payload);
  assertEquals(result.ok, false);
});

Deno.test('mapUpdateMetadataSuccess - FAIL: bad UUID for item_id', () => {
  const payload = {
    item_id: INVALID_UUID,
    message: 'Item metadata updated successfully',
  };
  const result = mapUpdateMetadataSuccess(payload);
  assertEquals(result.ok, false);
});

Deno.test('mapUpdateMetadataSuccess - FAIL: empty message', () => {
  const payload = {
    item_id: VALID_UUID_1,
    message: '   ',
  };
  const result = mapUpdateMetadataSuccess(payload);
  assertEquals(result.ok, false);
});

// ============================================================================
// 2. Error Normalization Tests (normalizeRpcError)
// ============================================================================

Deno.test('normalizeRpcError - Transport error present -> 500 INTERNAL_ERROR', () => {
  const err = normalizeRpcError(new Error('Connection timeout'), null);
  assertEquals(err.status, 500);
  assertEquals(err.errorCode, 'INTERNAL_ERROR');
  assertEquals(err.message, 'Đã xảy ra lỗi máy chủ nội bộ khi thực thi thao tác.');
});

Deno.test('normalizeRpcError - DATABASE_ERROR -> 500 INTERNAL_ERROR', () => {
  const rawDbMessage = 'pg_catalog.query error: relation question_bank_items corrupted';
  const err = normalizeRpcError(null, {
    success: false,
    error_code: 'DATABASE_ERROR',
    message: rawDbMessage,
  });
  assertEquals(err.status, 500);
  assertEquals(err.errorCode, 'INTERNAL_ERROR');
  assertEquals(err.message, 'Đã xảy ra lỗi máy chủ nội bộ.');
  // Raw DB message must NOT leak
  assertEquals(err.message.includes('pg_catalog'), false);
  assertEquals(err.message !== rawDbMessage, true);
});

Deno.test('normalizeRpcError - Unknown DB code -> 500 INTERNAL_ERROR', () => {
  const rawInternalDetail = 'UNEXPECTED_SQL_STATE_CODE_XYZ: table lock contention';
  const err = normalizeRpcError(null, {
    success: false,
    error_code: 'UNEXPECTED_SQL_STATE_CODE_XYZ',
    message: rawInternalDetail,
  });
  assertEquals(err.status, 500);
  assertEquals(err.errorCode, 'INTERNAL_ERROR');
  assertEquals(err.message, 'Đã xảy ra lỗi máy chủ nội bộ.');
  assertEquals(err.message.includes('UNEXPECTED_SQL_STATE'), false);
  assertEquals(err.message !== rawInternalDetail, true);
});

Deno.test('normalizeRpcError - FORBIDDEN -> 403 FORBIDDEN', () => {
  const err = normalizeRpcError(null, {
    success: false,
    error_code: 'FORBIDDEN',
    message: 'You can only update your own questions',
  });
  assertEquals(err.status, 403);
  assertEquals(err.errorCode, 'FORBIDDEN');
  assertEquals(err.message, 'Bạn không có quyền thực hiện thao tác này trên câu hỏi.');
});

Deno.test('normalizeRpcError - UNAUTHORIZED_ROLE -> 403 FORBIDDEN', () => {
  const err = normalizeRpcError(null, {
    success: false,
    error_code: 'UNAUTHORIZED_ROLE',
    message: 'Access denied for role student',
  });
  assertEquals(err.status, 403);
  assertEquals(err.errorCode, 'FORBIDDEN');
  assertEquals(err.message, 'Bạn không có quyền thực hiện thao tác này trên câu hỏi.');
});

Deno.test('normalizeRpcError - FORBIDDEN_VISIBILITY -> 403 FORBIDDEN_VISIBILITY', () => {
  const err = normalizeRpcError(null, {
    success: false,
    error_code: 'FORBIDDEN_VISIBILITY',
    message: 'Only admins can set public_template',
  });
  assertEquals(err.status, 403);
  assertEquals(err.errorCode, 'FORBIDDEN_VISIBILITY');
  assertEquals(err.message, 'Chỉ quản trị viên mới có quyền thiết lập trạng thái chia sẻ mẫu công khai.');
});

Deno.test('normalizeRpcError - ITEM_NOT_FOUND -> 404 NOT_FOUND', () => {
  const err = normalizeRpcError(null, {
    success: false,
    error_code: 'ITEM_NOT_FOUND',
  });
  assertEquals(err.status, 404);
  assertEquals(err.errorCode, 'NOT_FOUND');
  assertEquals(err.message, 'Không tìm thấy câu hỏi yêu cầu.');
});

Deno.test('normalizeRpcError - VERSION_NOT_FOUND -> 404 NOT_FOUND', () => {
  const err = normalizeRpcError(null, {
    success: false,
    error_code: 'VERSION_NOT_FOUND',
  });
  assertEquals(err.status, 404);
  assertEquals(err.errorCode, 'NOT_FOUND');
  assertEquals(err.message, 'Không tìm thấy phiên bản câu hỏi yêu cầu.');
});

Deno.test('normalizeRpcError - Dual-Head access codes -> 403 FORBIDDEN', () => {
  for (const code of ['FORBIDDEN_VERSION', 'QUESTION_NOT_PUBLISHED']) {
    const err = normalizeRpcError(null, {
      success: false,
      error_code: code,
      message: 'Access denied',
    });
    assertEquals(err.status, 403);
    assertEquals(err.errorCode, 'FORBIDDEN');
    assertEquals(err.message, 'Bạn không có quyền thực hiện thao tác này trên câu hỏi.');
  }
});

Deno.test('normalizeRpcError - QUESTION_NOT_FOUND -> 404 NOT_FOUND', () => {
  const err = normalizeRpcError(null, {
    success: false,
    error_code: 'QUESTION_NOT_FOUND',
  });
  assertEquals(err.status, 404);
  assertEquals(err.errorCode, 'NOT_FOUND');
  assertEquals(err.message, 'Không tìm thấy câu hỏi yêu cầu.');
});

Deno.test('normalizeRpcError - SOURCE_VERSION_NOT_FOUND -> 404 NOT_FOUND', () => {
  const err = normalizeRpcError(null, {
    success: false,
    error_code: 'SOURCE_VERSION_NOT_FOUND',
  });
  assertEquals(err.status, 404);
  assertEquals(err.errorCode, 'NOT_FOUND');
  assertEquals(err.message, 'Không tìm thấy phiên bản câu hỏi nguồn để sao chép.');
});

Deno.test('normalizeRpcError - CONFLICT & VERSION_CONFLICT -> 409 CONFLICT', () => {
  for (const code of ['CONFLICT', 'VERSION_CONFLICT']) {
    const err = normalizeRpcError(null, {
      success: false,
      error_code: code,
      message: 'Concurrent version modification detected',
    });
    assertEquals(err.status, 409);
    assertEquals(err.errorCode, 'CONFLICT');
    assertEquals(err.message, 'Phiên bản câu hỏi đã thay đổi trên máy chủ (đã có bản nháp mới hơn được tạo). Vui lòng tải lại trang để kiểm tra trước khi xuất bản.');
  }
});

Deno.test('normalizeRpcError - Known validation codes -> 400 INVALID_INPUT', () => {
  const validationCodes = [
    'CANNOT_PUBLISH_EMPTY_ITEM',
    'MISSING_ANSWER_KEY',
    'MISSING_EXPECTED_VERSION',
    'INVALID_PROMPT',
    'INVALID_QUESTION_ID',
    'INVALID_SCHOOL_ID',
    'INVALID_INPUT',
    'INVALID_SINGLE_CHOICE_ANSWER_KEY',
    'INVALID_MULTIPLE_CHOICE_ANSWER_KEY',
    'INVALID_TRUE_FALSE_ANSWER_KEY',
    'INVALID_FILL_BLANK_ANSWER_KEY',
    'INVALID_GRADE_LEVEL',
    'INVALID_DIFFICULTY',
    'INVALID_STATUS',
    'INVALID_VISIBILITY',
    'INVALID_SUBJECT',
    'PROMPT_REQUIRED',
    'OPTIONS_REQUIRED',
  ];

  for (const code of validationCodes) {
    const err = normalizeRpcError(null, { success: false, error_code: code });
    assertEquals(err.status, 400);
    assertEquals(err.errorCode, 'INVALID_INPUT');
    assertEquals(err.message, 'Dữ liệu đầu vào hoặc cấu trúc đáp án không hợp lệ theo quy chuẩn.');
  }
});

// ============================================================================
// 3. Response Envelopes & CORS Headers Tests
// ============================================================================

Deno.test('createErrorResponse - constructs compliant ErrorEnvelope and CORS headers', async () => {
  const res = createErrorResponse(404, 'NOT_FOUND', 'Không tìm thấy.');
  assertEquals(res.status, 404);
  assertEquals(res.headers.get('Content-Type'), 'application/json');
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
  assertEquals(res.headers.get('Access-Control-Allow-Headers'), 'authorization, x-client-info, apikey, content-type');
  assertEquals(res.headers.get('Access-Control-Allow-Methods'), 'GET, POST, PATCH, DELETE, OPTIONS');

  const body = await res.json();
  assertEquals(body.success, false);
  assertEquals(body.error_code, 'NOT_FOUND');
  assertEquals(body.message, 'Không tìm thấy.');
});

Deno.test('createSuccessResponse - constructs compliant SuccessEnvelope and CORS headers', async () => {
  const res = createSuccessResponse({ id: VALID_UUID_1 }, 201);
  assertEquals(res.status, 201);
  assertEquals(res.headers.get('Content-Type'), 'application/json');
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
  assertEquals(res.headers.get('Access-Control-Allow-Headers'), 'authorization, x-client-info, apikey, content-type');
  assertEquals(res.headers.get('Access-Control-Allow-Methods'), 'GET, POST, PATCH, DELETE, OPTIONS');

  const body = await res.json();
  assertEquals(body.success, true);
  assertEquals(body.data.id, VALID_UUID_1);
});
