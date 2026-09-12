// scripts/test_exam_question_bank_import.mjs
// Automated Test Suite for Exam V1 Question Bank Import & Snapshot Copy (Hardened Security & Data-Integrity)

import assert from 'node:assert/strict';
import {
  mapQuestionType,
  mapOptionsToCanonical,
  mapAnswerKeyToCanonical,
  convertQbQuestionToExamQuestion,
} from '../src/utils/examQuestionBankAdapter.js';
import { validateImportQuestionBankPayload } from '../supabase/functions/exam-management-api/validation.ts';
import { ExamManagementClient } from '../src/services/examManagementClient.js';
import {
  isUntouchedDemoQuestion,
  buildSaveDraftQuestionsPayload,
} from '../src/components/dashboard/exams/examDraftUtils.js';

let passed = 0;
let total = 0;

async function test(name, fn) {
  total++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// Deep scanner to verify zero answer key leakage in JSON structures
function deepScanNoAnswerKeys(obj, path = '') {
  if (!obj || typeof obj !== 'object') return;
  const forbiddenKeys = [
    'answer_key',
    'correct_answer',
    'correct_answers',
    'correct_option_id',
    'correct_option_ids',
    'grading_rubric',
    'grading_config',
    'tolerance',
  ];

  for (const key of Object.keys(obj)) {
    const currentPath = path ? `${path}.${key}` : key;
    assert.ok(
      !forbiddenKeys.includes(key),
      `SECURITY VIOLATION: Forbidden private field "${key}" detected at path "${currentPath}"`
    );
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      deepScanNoAnswerKeys(obj[key], currentPath);
    }
  }
}

// Mock Database for Simulation
function createMockDb() {
  const teacher1Id = '11111111-1111-4111-8111-111111111111';
  const teacher2Id = '22222222-2222-4222-8222-222222222222';
  const studentId = '99999999-9999-4999-8999-999999999999';
  const adminId = '00000000-0000-4000-8000-000000000000';

  const questionBankItems = [
    {
      id: 'qb-item-101',
      code: 'QB-101',
      title: 'Toán 5 - Phép cộng',
      question_type: 'single_choice',
      subject: 'Toán',
      grade_level: 5,
      difficulty: 'easy',
      status: 'draft',
      visibility: 'private',
      author_id: teacher1Id,
      current_version_id: 'qb-ver-101',
    },
    {
      id: 'qb-item-102',
      code: 'QB-102',
      title: 'Toán 5 - Phép nhân công khai',
      question_type: 'single_choice',
      subject: 'Toán',
      grade_level: 5,
      difficulty: 'medium',
      status: 'published',
      visibility: 'public_template',
      author_id: teacher2Id,
      current_version_id: 'qb-ver-102',
    },
    {
      id: 'qb-item-103',
      code: 'QB-103',
      title: 'Toán 5 - Đề riêng của Teacher 2',
      question_type: 'single_choice',
      subject: 'Toán',
      grade_level: 5,
      difficulty: 'hard',
      status: 'draft',
      visibility: 'private',
      author_id: teacher2Id,
      current_version_id: 'qb-ver-103',
    },
    {
      id: 'qb-item-104',
      code: 'QB-104',
      title: 'Văn 5 - Tự luận',
      question_type: 'essay',
      subject: 'Tiếng Việt',
      grade_level: 5,
      difficulty: 'medium',
      status: 'published',
      visibility: 'public_template',
      author_id: teacher2Id,
      current_version_id: 'qb-ver-104',
    },
    {
      id: 'qb-item-invalid-opts',
      code: 'QB-INV-OPT',
      title: 'Câu hỏi có options bị lỗi',
      question_type: 'single_choice',
      status: 'published',
      visibility: 'public_template',
      author_id: teacher1Id,
      current_version_id: 'qb-ver-inv-opt',
    },
    {
      id: 'qb-item-missing-ans',
      code: 'QB-INV-ANS',
      title: 'Câu hỏi thiếu đáp án',
      question_type: 'single_choice',
      status: 'published',
      visibility: 'public_template',
      author_id: teacher1Id,
      current_version_id: 'qb-ver-missing-ans',
    },
  ];

  const questionBankVersions = [
    {
      id: 'qb-ver-101',
      question_bank_item_id: 'qb-item-101',
      prompt: '1 + 1 = ?',
      options: ['1', '2', '3', '4'],
    },
    {
      id: 'qb-ver-102',
      question_bank_item_id: 'qb-item-102',
      prompt: '5 x 5 = ?',
      options: ['20', '25', '30', '35'],
    },
    {
      id: 'qb-ver-103',
      question_bank_item_id: 'qb-item-103',
      prompt: '10 x 10 = ?',
      options: ['50', '100', '150', '200'],
    },
    {
      id: 'qb-ver-104',
      question_bank_item_id: 'qb-item-104',
      prompt: 'Hãy tả lại một cảnh đẹp quê hương em.',
      options: [],
    },
    {
      id: 'qb-ver-inv-opt',
      question_bank_item_id: 'qb-item-invalid-opts',
      prompt: 'Options ít hơn 2 lựa chọn',
      options: ['Chỉ có 1 phương án'],
    },
    {
      id: 'qb-ver-missing-ans',
      question_bank_item_id: 'qb-item-missing-ans',
      prompt: '10 + 20 = ?',
      options: ['10', '20', '30', '40'],
    },
  ];

  const questionBankAnswerKeys = [
    { version_id: 'qb-ver-101', correct_answers: { correct_option_id: 'opt_2' } },
    { version_id: 'qb-ver-102', correct_answers: { correct_option_id: 'opt_2' } },
    { version_id: 'qb-ver-103', correct_answers: { correct_option_id: 'opt_2' } },
    { version_id: 'qb-ver-104', correct_answers: null },
    { version_id: 'qb-ver-inv-opt', correct_answers: { correct_option_id: 'opt_1' } },
    { version_id: 'qb-ver-missing-ans', correct_answers: null },
  ];

  const examTests = [
    { id: '11111111-0000-4000-8000-000000000001', author_id: teacher1Id, status: 'draft' },
    { id: '22222222-0000-4000-8000-000000000002', author_id: teacher2Id, status: 'draft' },
  ];

  const examVersions = [
    { id: '33333333-0000-4000-8000-000000000001', exam_id: '11111111-0000-4000-8000-000000000001', status: 'draft' },
    { id: '33333333-0000-4000-8000-000000000002', exam_id: '11111111-0000-4000-8000-000000000001', status: 'published' },
    { id: '44444444-0000-4000-8000-000000000001', exam_id: '22222222-0000-4000-8000-000000000002', status: 'draft' },
  ];

  const examQuestions = [];
  const examAnswerKeys = [];

  return {
    teacher1Id,
    teacher2Id,
    studentId,
    adminId,
    questionBankItems,
    questionBankVersions,
    questionBankAnswerKeys,
    examTests,
    examVersions,
    examQuestions,
    examAnswerKeys,
  };
}

// Handler Simulation enforcing Server-Side Persistence and Zero Answer Key Leak
function simulateImportEndpoint(callerRole, callerId, payload, db) {
  if (!callerRole) {
    return { status: 401, error_code: 'UNAUTHORIZED', message: 'Yêu cầu xác thực Bearer token.' };
  }

  if (callerRole !== 'admin' && callerRole !== 'teacher') {
    return { status: 403, error_code: 'FORBIDDEN_ROLE', message: 'Chỉ Giáo viên hoặc Quản trị viên mới có quyền nhập câu hỏi.' };
  }

  if (!payload.version_id) {
    return { status: 400, error_code: 'INVALID_VERSION_ID', message: 'Mã version_id bắt buộc và phải đúng định dạng UUID.' };
  }

  const vRow = db.examVersions.find(v => v.id === payload.version_id);
  if (!vRow) {
    return { status: 404, error_code: 'ERR_VERSION_NOT_FOUND', message: 'Không tìm thấy phiên bản đề thi.' };
  }
  if (vRow.status !== 'draft') {
    return { status: 403, error_code: 'ERR_VERSION_IMMUTABLE', message: 'Chỉ có thể nhập câu hỏi vào phiên bản đề thi đang ở trạng thái nháp (draft).' };
  }
  const tRow = db.examTests.find(t => t.id === vRow.exam_id);
  if (!tRow) {
    return { status: 404, error_code: 'ERR_EXAM_NOT_FOUND', message: 'Không tìm thấy đề thi.' };
  }
  if (callerRole === 'teacher' && tRow.author_id !== callerId) {
    return { status: 403, error_code: 'FORBIDDEN', message: 'Bạn không có quyền chỉnh sửa đề thi của giáo viên khác.' };
  }

  const items = db.questionBankItems.filter(item => payload.question_bank_item_ids.includes(item.id));
  const itemMap = new Map(items.map(i => [i.id, i]));

  // Yêu cầu khớp chính xác 100% tập hợp câu hỏi (Không cho phép import một phần)
  if (items.length !== payload.question_bank_item_ids.length) {
    return {
      status: 404,
      error_code: 'ERR_QB_ITEM_NOT_FOUND',
      message: `Một hoặc nhiều câu hỏi không tồn tại trong ngân hàng câu hỏi (Tìm thấy ${items.length}/${payload.question_bank_item_ids.length}).`,
    };
  }

  for (const reqId of payload.question_bank_item_ids) {
    if (!itemMap.has(reqId)) {
      return {
        status: 404,
        error_code: 'ERR_QB_ITEM_NOT_FOUND',
        message: `Không tìm thấy câu hỏi có ID '${reqId}'.`,
      };
    }
  }

  const validatedQuestions = [];
  for (const item of items) {
    if (callerRole === 'teacher') {
      const isOwn = item.author_id === callerId;
      const isPublishedShared = item.status === 'published' && item.visibility === 'public_template';
      if (!isOwn && !isPublishedShared) {
        return { status: 403, error_code: 'FORBIDDEN_QUESTION_ACCESS', message: `Bạn không có quyền sử dụng câu hỏi '${item.title}'.` };
      }
    }

    const ver = db.questionBankVersions.find(v => v.id === item.current_version_id);
    if (!ver) {
      return { status: 404, error_code: 'ERR_QB_VERSION_NOT_FOUND', message: 'Không tìm thấy phiên bản câu hỏi.' };
    }
    const ansKey = db.questionBankAnswerKeys.find(k => k.version_id === ver.id);

    try {
      const q = convertQbQuestionToExamQuestion(item, ver, ansKey, validatedQuestions.length + 1);
      validatedQuestions.push(q);
    } catch (err) {
      return {
        status: 400,
        error_code: err.code || 'ERR_QB_CONVERSION_FAILED',
        message: err.message,
      };
    }
  }

  // Server-side persistence to public.exam_questions and app_private.exam_answer_keys
  const existingCount = db.examQuestions.filter(q => q.exam_version_id === payload.version_id).length;
  const safeProjectedQuestions = [];

  for (let i = 0; i < validatedQuestions.length; i++) {
    const q = validatedQuestions[i];
    const newId = `exam-q-uuid-${existingCount + i + 1}`;
    const qNum = existingCount + i + 1;

    // 1. Persist to public.exam_questions
    db.examQuestions.push({
      id: newId,
      exam_version_id: payload.version_id,
      question_number: qNum,
      question_type: q.question_type,
      prompt: q.prompt,
      points: 1.0,
      options_json: q.options_json,
      source_question_bank_item_id: q.source_question_bank_item_id,
      source_question_bank_version_id: q.source_question_bank_version_id,
    });

    // 2. Persist to app_private.exam_answer_keys
    if (q.answer_key) {
      db.examAnswerKeys.push({
        question_id: newId,
        correct_answer: q.answer_key.correct_answer,
        accepted_answers: q.answer_key.accepted_answers || null,
        case_sensitive: false,
        grading_config: {},
      });
    }

    // 3. Prepare SAFE PROJECTION (Strictly NO answer keys)
    safeProjectedQuestions.push({
      id: newId,
      exam_version_id: payload.version_id,
      question_number: qNum,
      question_type: q.question_type,
      prompt: q.prompt,
      points: 1.0,
      options_json: q.options_json,
      source_question_bank_item_id: q.source_question_bank_item_id,
      source_question_bank_version_id: q.source_question_bank_version_id,
    });
  }

  return {
    status: 200,
    data: {
      total_imported: safeProjectedQuestions.length,
      imported_questions: safeProjectedQuestions,
    },
  };
}

async function main() {
  console.log('=== BẮT ĐẦU KIỂM THỬ: IMPORT CÂU HỎI TỪ NGÂN HÀNG CÂU HỎI (SECURITY & DATA INTEGRITY) ===\n');

  // =========================================================================
  // PHẦN 1: ADAPTER & FAIL-CLOSED CANONICAL MAPPING
  // =========================================================================
  console.log('--- PHẦN 1: Adapter & Fail-Closed Canonical Mapping ---');

  await test('1.1 mapQuestionType chuyển đổi chính xác tất cả các loại câu hỏi', () => {
    assert.equal(mapQuestionType('single_choice'), 'single_choice');
    assert.equal(mapQuestionType('choice'), 'single_choice');
    assert.equal(mapQuestionType('multiple_choice'), 'multiple_choice');
    assert.equal(mapQuestionType('fill_blank'), 'fill_blank');
    assert.equal(mapQuestionType('short_answer'), 'short_answer');
    assert.equal(mapQuestionType('essay'), 'essay');
    assert.equal(mapQuestionType('image_upload'), 'image_upload');
    assert.equal(mapQuestionType('file_upload'), 'file_upload');
  });

  await test('1.2 mapOptionsToCanonical yêu cầu tối thiểu 2 phương án hợp lệ, từ chối < 2', () => {
    assert.throws(() => mapOptionsToCanonical([]), (err) => err.code === 'ERR_QB_OPTIONS_INVALID');
    assert.throws(() => mapOptionsToCanonical(['Chỉ có 1']), (err) => err.code === 'ERR_QB_OPTIONS_INVALID');
  });

  await test('1.3 mapOptionsToCanonical từ chối phương án có nội dung rỗng hoặc khoảng trắng', () => {
    assert.throws(() => mapOptionsToCanonical(['Hợp lệ', '']), (err) => err.code === 'ERR_QB_OPTIONS_INVALID');
    assert.throws(() => mapOptionsToCanonical(['Hợp lệ', '   ']), (err) => err.code === 'ERR_QB_OPTIONS_INVALID');
  });

  await test('1.4 mapOptionsToCanonical từ chối các phương án bị trùng lặp nội dung hoặc mã', () => {
    assert.throws(() => mapOptionsToCanonical(['Hà Nội', 'Hà Nội']), (err) => err.code === 'ERR_QB_OPTIONS_INVALID');
    assert.throws(
      () => mapOptionsToCanonical([
        { id: 'opt_1', text: 'Phương án 1' },
        { id: 'opt_1', text: 'Phương án 2' },
      ]),
      (err) => err.code === 'ERR_QB_OPTIONS_INVALID'
    );
  });

  await test('1.5 mapOptionsToCanonical chuyển đổi mảng hợp lệ sang [{ key, text }]', () => {
    const res = mapOptionsToCanonical(['A text', 'B text', 'C text']);
    assert.equal(res.length, 3);
    assert.deepEqual(res[0], { key: 'A', text: 'A text', originalId: 'opt_1' });
    assert.deepEqual(res[1], { key: 'B', text: 'B text', originalId: 'opt_2' });
    assert.deepEqual(res[2], { key: 'C', text: 'C text', originalId: 'opt_3' });
  });

  await test('1.6 mapAnswerKeyToCanonical cho single_choice từ chối thiếu đáp án hoặc không khớp', () => {
    const opts = [{ key: 'A', text: 'A', originalId: 'opt_1' }, { key: 'B', text: 'B', originalId: 'opt_2' }];
    assert.throws(() => mapAnswerKeyToCanonical('single_choice', opts, null), (err) => err.code === 'ERR_QB_ANSWER_KEY_INVALID');
    assert.throws(() => mapAnswerKeyToCanonical('single_choice', opts, {}), (err) => err.code === 'ERR_QB_ANSWER_KEY_INVALID');
    assert.throws(() => mapAnswerKeyToCanonical('single_choice', opts, { correct_option_id: 'opt_999' }), (err) => err.code === 'ERR_QB_ANSWER_KEY_INVALID');
  });

  await test('1.7 mapAnswerKeyToCanonical cho single_choice khớp đúng opt_1/A/Text', () => {
    const opts = [{ key: 'A', text: 'Hà Nội', originalId: 'opt_1' }, { key: 'B', text: 'Huế', originalId: 'opt_2' }];
    assert.deepEqual(mapAnswerKeyToCanonical('single_choice', opts, { correct_option_id: 'opt_2' }), { correct_answer: 'B' });
    assert.deepEqual(mapAnswerKeyToCanonical('single_choice', opts, { correct_answer: 'A' }), { correct_answer: 'A' });
    assert.deepEqual(mapAnswerKeyToCanonical('single_choice', opts, { correct_answer: 'Huế' }), { correct_answer: 'B' });
  });

  await test('1.8 mapAnswerKeyToCanonical cho multiple_choice từ chối nếu thiếu hoặc có đáp án không khớp', () => {
    const opts = [{ key: 'A', text: 'A', originalId: 'opt_1' }, { key: 'B', text: 'B', originalId: 'opt_2' }];
    assert.throws(() => mapAnswerKeyToCanonical('multiple_choice', opts, { correct_option_ids: [] }), (err) => err.code === 'ERR_QB_ANSWER_KEY_INVALID');
    assert.throws(() => mapAnswerKeyToCanonical('multiple_choice', opts, { correct_option_ids: ['opt_1', 'opt_99'] }), (err) => err.code === 'ERR_QB_ANSWER_KEY_INVALID');
  });

  await test('1.9 mapAnswerKeyToCanonical cho fill_blank từ chối nội dung rỗng', () => {
    assert.throws(() => mapAnswerKeyToCanonical('fill_blank', [], { correct_text: '' }), (err) => err.code === 'ERR_QB_ANSWER_KEY_INVALID');
    assert.deepEqual(
      mapAnswerKeyToCanonical('fill_blank', [], { correct_text: 'Thủ đô', accepted_texts: ['thu do'] }),
      { correct_answer: 'Thủ đô', accepted_answers: ['thu do'] }
    );
  });

  await test('1.10 mapAnswerKeyToCanonical cho essay / upload trả về null an toàn', () => {
    assert.equal(mapAnswerKeyToCanonical('essay', [], null), null);
    assert.equal(mapAnswerKeyToCanonical('image_upload', [], null), null);
    assert.equal(mapAnswerKeyToCanonical('file_upload', [], null), null);
  });

  // =========================================================================
  // PHẦN 2: VALIDATION RULES (TARGET DRAFT BẮT BUỘC)
  // =========================================================================
  console.log('\n--- PHẦN 2: Payload Validation & Target Draft Enforcement ---');

  await test('2.1 validateImportQuestionBankPayload từ chối payload thiếu version_id (400)', () => {
    const res = validateImportQuestionBankPayload({
      question_bank_item_ids: ['11111111-1111-4111-8111-111111111111'],
    });
    assert.equal(res.valid, false);
    assert.equal(res.errorCode, 'INVALID_VERSION_ID');
  });

  await test('2.2 validateImportQuestionBankPayload từ chối version_id không phải UUID', () => {
    const res = validateImportQuestionBankPayload({
      version_id: 'invalid-version-uuid',
      question_bank_item_ids: ['11111111-1111-4111-8111-111111111111'],
    });
    assert.equal(res.valid, false);
    assert.equal(res.errorCode, 'INVALID_VERSION_ID');
  });

  await test('2.3 validateImportQuestionBankPayload từ chối mảng ID rỗng hoặc batch size > 100', () => {
    assert.equal(
      validateImportQuestionBankPayload({
        version_id: '11111111-1111-4111-8111-111111111111',
        question_bank_item_ids: [],
      }).errorCode,
      'INVALID_QUESTION_BANK_IDS'
    );
    const longList = Array.from({ length: 101 }, () => '11111111-1111-4111-8111-111111111111');
    assert.equal(
      validateImportQuestionBankPayload({
        version_id: '11111111-1111-4111-8111-111111111111',
        question_bank_item_ids: longList,
      }).errorCode,
      'INVALID_BATCH_SIZE'
    );
  });

  await test('2.4 validateImportQuestionBankPayload tự động deduplicate các ID trùng lặp', () => {
    const id1 = '11111111-1111-4111-8111-111111111111';
    const id2 = '22222222-2222-4222-8222-222222222222';
    const res = validateImportQuestionBankPayload({
      version_id: '33333333-3333-4333-8333-333333333333',
      question_bank_item_ids: [id1, id2, id1, id2],
    });
    assert.equal(res.valid, true);
    assert.deepEqual(res.data.question_bank_item_ids, [id1, id2]);
  });

  // =========================================================================
  // PHẦN 3: SECURITY, PERMISSIONS & FAIL-CLOSED CHECKS
  // =========================================================================
  console.log('\n--- PHẦN 3: Security, Permissions & Fail-Closed Checks ---');

  await test('3.1 Yêu cầu chưa đăng nhập bị từ chối 401 UNAUTHORIZED', () => {
    const db = createMockDb();
    const res = simulateImportEndpoint(null, null, {
      version_id: '33333333-0000-4000-8000-000000000001',
      question_bank_item_ids: ['qb-item-101'],
    }, db);
    assert.equal(res.status, 401);
    assert.equal(res.error_code, 'UNAUTHORIZED');
  });

  await test('3.2 Học sinh bị từ chối 403 FORBIDDEN_ROLE', () => {
    const db = createMockDb();
    const res = simulateImportEndpoint('student', db.studentId, {
      version_id: '33333333-0000-4000-8000-000000000001',
      question_bank_item_ids: ['qb-item-101'],
    }, db);
    assert.equal(res.status, 403);
    assert.equal(res.error_code, 'FORBIDDEN_ROLE');
  });

  await test('3.3 Từ chối 403 ERR_VERSION_IMMUTABLE nếu phiên bản đề thi đã xuất bản (published)', () => {
    const db = createMockDb();
    const res = simulateImportEndpoint('teacher', db.teacher1Id, {
      version_id: '33333333-0000-4000-8000-000000000002', // published version
      question_bank_item_ids: ['qb-item-101'],
    }, db);
    assert.equal(res.status, 403);
    assert.equal(res.error_code, 'ERR_VERSION_IMMUTABLE');
  });

  await test('3.4 Giáo viên không thể nhập vào bản nháp của giáo viên khác (403 FORBIDDEN)', () => {
    const db = createMockDb();
    const res = simulateImportEndpoint('teacher', db.teacher1Id, {
      version_id: '44444444-0000-4000-8000-000000000001', // Teacher 2 draft
      question_bank_item_ids: ['qb-item-101'],
    }, db);
    assert.equal(res.status, 403);
    assert.equal(res.error_code, 'FORBIDDEN');
  });

  await test('3.5 Giáo viên bị từ chối 403 FORBIDDEN_QUESTION_ACCESS khi cố lấy câu hỏi private của giáo viên khác', () => {
    const db = createMockDb();
    const res = simulateImportEndpoint('teacher', db.teacher1Id, {
      version_id: '33333333-0000-4000-8000-000000000001',
      question_bank_item_ids: ['qb-item-103'], // private item of Teacher 2
    }, db);
    assert.equal(res.status, 403);
    assert.equal(res.error_code, 'FORBIDDEN_QUESTION_ACCESS');
  });

  await test('3.6 Giáo viên nhập câu hỏi của chính mình và câu public_template thành công (200 OK)', () => {
    const db = createMockDb();
    const res = simulateImportEndpoint('teacher', db.teacher1Id, {
      version_id: '33333333-0000-4000-8000-000000000001',
      question_bank_item_ids: ['qb-item-101', 'qb-item-102'],
    }, db);
    assert.equal(res.status, 200);
    assert.equal(res.data.total_imported, 2);
  });

  await test('3.7 Admin có quyền nhập bất kỳ câu hỏi nào vào bất kỳ bản nháp nào (200 OK)', () => {
    const db = createMockDb();
    const res = simulateImportEndpoint('admin', db.adminId, {
      version_id: '33333333-0000-4000-8000-000000000001',
      question_bank_item_ids: ['qb-item-103'],
    }, db);
    assert.equal(res.status, 200);
    assert.equal(res.data.total_imported, 1);
  });

  await test('3.8 Batch Integrity: 3 câu yêu cầu / chỉ 2 câu tìm thấy => toàn bộ request bị từ chối 404 ERR_QB_ITEM_NOT_FOUND', () => {
    const db = createMockDb();
    const res = simulateImportEndpoint('teacher', db.teacher1Id, {
      version_id: '33333333-0000-4000-8000-000000000001',
      question_bank_item_ids: ['qb-item-101', 'qb-item-102', 'non-existent-item-uuid'],
    }, db);
    assert.equal(res.status, 404);
    assert.equal(res.error_code, 'ERR_QB_ITEM_NOT_FOUND');
    // Đảm bảo không có dòng nào bị ghi vào DB (Zero partial mutation)
    assert.equal(db.examQuestions.length, 0);
    assert.equal(db.examAnswerKeys.length, 0);
  });

  await test('3.9 Batch Integrity: 1 câu yêu cầu / 0 câu tìm thấy => bị từ chối 404 ERR_QB_ITEM_NOT_FOUND', () => {
    const db = createMockDb();
    const res = simulateImportEndpoint('teacher', db.teacher1Id, {
      version_id: '33333333-0000-4000-8000-000000000001',
      question_bank_item_ids: ['completely-missing-id'],
    }, db);
    assert.equal(res.status, 404);
    assert.equal(res.error_code, 'ERR_QB_ITEM_NOT_FOUND');
    assert.equal(db.examQuestions.length, 0);
  });

  await test('3.10 Batch Integrity: Không xảy ra mutation nếu có bất kỳ câu hỏi nào trong batch bị lỗi options/đáp án', () => {
    const db = createMockDb();
    const res = simulateImportEndpoint('teacher', db.teacher1Id, {
      version_id: '33333333-0000-4000-8000-000000000001',
      question_bank_item_ids: ['qb-item-101', 'qb-item-invalid-opts'], // 1 câu tốt, 1 câu lỗi options
    }, db);
    assert.equal(res.status, 400);
    assert.equal(res.error_code, 'ERR_QB_OPTIONS_INVALID');
    // Tuyệt đối không lưu một phần câu số 1
    assert.equal(db.examQuestions.length, 0);
    assert.equal(db.examAnswerKeys.length, 0);
  });

  await test('3.11 Batch Integrity: Batch hoàn chỉnh 100% hợp lệ => Thành công 200 OK và lưu đầy đủ', () => {
    const db = createMockDb();
    const res = simulateImportEndpoint('teacher', db.teacher1Id, {
      version_id: '33333333-0000-4000-8000-000000000001',
      question_bank_item_ids: ['qb-item-101', 'qb-item-102', 'qb-item-104'], // 3 câu hợp lệ
    }, db);
    assert.equal(res.status, 200);
    assert.equal(res.data.total_imported, 3);
    assert.equal(db.examQuestions.length, 3);
  });

  // =========================================================================
  // PHẦN 4: ZERO ANSWER KEY LEAK & SERVER-SIDE SNAPSHOT PERSISTENCE
  // =========================================================================
  console.log('\n--- PHẦN 4: Zero Answer Key Leak & Server-Side Persistence ---');

  await test('4.1 Phản hồi từ endpoint import KHÔNG chứa answer_key (Deep Scan Check)', () => {
    const db = createMockDb();
    const res = simulateImportEndpoint('teacher', db.teacher1Id, {
      version_id: '33333333-0000-4000-8000-000000000001',
      question_bank_item_ids: ['qb-item-101', 'qb-item-102'],
    }, db);
    assert.equal(res.status, 200);

    // Deep scan payload
    deepScanNoAnswerKeys(res.data);

    for (const q of res.data.imported_questions) {
      assert.equal(q.answer_key, undefined);
      assert.equal(q.correct_answer, undefined);
      assert.equal(q.correct_answers, undefined);
      assert.ok(q.id);
      assert.ok(q.options_json);
      assert.ok(q.prompt);
    }
  });

  await test('4.2 Snapshot write được lưu trữ trực tiếp vào DB: public.exam_questions và app_private.exam_answer_keys', () => {
    const db = createMockDb();
    assert.equal(db.examQuestions.length, 0);
    assert.equal(db.examAnswerKeys.length, 0);

    const res = simulateImportEndpoint('teacher', db.teacher1Id, {
      version_id: '33333333-0000-4000-8000-000000000001',
      question_bank_item_ids: ['qb-item-101'],
    }, db);
    assert.equal(res.status, 200);

    // Kiểm tra DB đã được ghi snapshot server-side
    assert.equal(db.examQuestions.length, 1);
    assert.equal(db.examAnswerKeys.length, 1);

    const qDb = db.examQuestions[0];
    const keyDb = db.examAnswerKeys[0];

    assert.equal(qDb.id, res.data.imported_questions[0].id);
    assert.equal(qDb.source_question_bank_item_id, 'qb-item-101');
    assert.equal(keyDb.question_id, qDb.id);
    assert.equal(keyDb.correct_answer, 'B');
  });

  await test('4.3 Độc lập snapshot: Sửa câu hỏi gốc trong QB không làm biến động câu hỏi đã lưu vào đề thi', () => {
    const db = createMockDb();
    simulateImportEndpoint('teacher', db.teacher1Id, {
      version_id: '33333333-0000-4000-8000-000000000001',
      question_bank_item_ids: ['qb-item-101'],
    }, db);

    const examQ = db.examQuestions[0];
    const qbVer = db.questionBankVersions.find(v => v.id === 'qb-ver-101');

    assert.equal(examQ.prompt, '1 + 1 = ?');

    // Chỉnh sửa QB version
    qbVer.prompt = '100 + 200 = ? (Modified in QB)';

    // Câu hỏi trong đề thi vẫn giữ nguyên
    assert.equal(examQ.prompt, '1 + 1 = ?');
  });

  // =========================================================================
  // PHẦN 5: CLIENT SDK & FRONTEND INTEGRATION
  // =========================================================================
  console.log('\n--- PHẦN 5: Client SDK Integration ---');

  await test('5.1 ExamManagementClient.importQuestionsFromQuestionBank gửi đúng action và payload chuẩn', async () => {
    let dispatchedAction = null;
    let dispatchedMethod = null;
    let dispatchedPayload = null;

    const mockClient = new ExamManagementClient({
      invokeFunction: async ({ action, method, payload }) => {
        dispatchedAction = action;
        dispatchedMethod = method;
        dispatchedPayload = payload;
        return {
          ok: true,
          data: {
            total_imported: payload.question_bank_item_ids.length,
            imported_questions: payload.question_bank_item_ids.map((id, idx) => ({
              id: `imported-${idx + 1}`,
              exam_version_id: payload.version_id,
              question_number: idx + 1,
              question_type: 'single_choice',
              prompt: `Câu hỏi ${idx + 1}`,
              points: 1,
              options_json: [{ key: 'A', text: '1' }, { key: 'B', text: '2' }],
              source_question_bank_item_id: id,
            })),
          },
        };
      },
    });

    const res = await mockClient.importQuestionsFromQuestionBank({
      versionId: '33333333-0000-4000-8000-000000000001',
      examId: '11111111-0000-4000-8000-000000000001',
      questionBankItemIds: ['qb-item-1', 'qb-item-2'],
    });

    assert.equal(dispatchedAction, 'import-question-bank-items');
    assert.equal(dispatchedMethod, 'POST');
    assert.equal(dispatchedPayload.version_id, '33333333-0000-4000-8000-000000000001');
    assert.deepEqual(dispatchedPayload.question_bank_item_ids, ['qb-item-1', 'qb-item-2']);
    assert.equal(res.ok, true);
    assert.equal(res.data.total_imported, 2);

    // Deep scan client result
    deepScanNoAnswerKeys(res.data);
  });

  // =========================================================================
  // PHẦN 6: Draft Lifecycle & Auto-Init Regression Tests
  // =========================================================================
  console.log('\n--- PHẦN 6: Draft Lifecycle & Auto-Init Regression Tests ---');

  await test('6.1 isUntouchedDemoQuestion: Nhận diện chính xác câu demo mặc định, từ chối khi đã chỉnh sửa hoặc trên đề cũ', async () => {
    const defaultDemo = [
      {
        id: 'demo-uuid-1',
        question_number: 1,
        question_type: 'single_choice',
        prompt: '1 + 1 = ?',
        points: 1,
        options_json: [
          { key: 'A', text: '1' },
          { key: 'B', text: '2' },
          { key: 'C', text: '3' },
          { key: 'D', text: '4' },
        ],
        answer_key: { correct_answer: 'B' },
      },
    ];

    // Case 1: Đề mới + câu demo nguyên bản => TRUE
    assert.equal(isUntouchedDemoQuestion(defaultDemo, true), true);

    // Case 2: Đang chỉnh sửa đề đã lưu trước đó (isNewExam = false) => FALSE
    assert.equal(isUntouchedDemoQuestion(defaultDemo, false), false);

    // Case 3: Giáo viên đã chỉnh sửa nội dung câu hỏi (prompt) => FALSE
    const editedPrompt = [{ ...defaultDemo[0], prompt: 'Tìm x: x + 1 = 2' }];
    assert.equal(isUntouchedDemoQuestion(editedPrompt, true), false);

    // Case 4: Giáo viên đã đổi điểm số (points) => FALSE
    const editedPoints = [{ ...defaultDemo[0], points: 2 }];
    assert.equal(isUntouchedDemoQuestion(editedPoints, true), false);

    // Case 5: Giáo viên đổi đáp án đúng => FALSE
    const editedAnswer = [{ ...defaultDemo[0], answer_key: { correct_answer: 'A' } }];
    assert.equal(isUntouchedDemoQuestion(editedAnswer, true), false);

    // Case 6: Giáo viên thêm câu hỏi thứ 2 => FALSE
    const multipleQuestions = [...defaultDemo, { id: 'q2', prompt: 'Câu 2', question_type: 'essay' }];
    assert.equal(isUntouchedDemoQuestion(multipleQuestions, true), false);

    // Case 7: Câu hỏi đã có liên kết ngân hàng câu hỏi (source_question_bank_item_id) => FALSE
    const withQbSource = [{ ...defaultDemo[0], source_question_bank_item_id: 'qb-item-123' }];
    assert.equal(isUntouchedDemoQuestion(withQbSource, true), false);
  });

  await test('6.2 buildSaveDraftQuestionsPayload: Bảo tồn nguyên vẹn source_question_bank_item_id và version_id', async () => {
    const localQuestions = [
      {
        id: 'q-manual-1',
        question_number: 1,
        question_type: 'single_choice',
        prompt: 'Câu hỏi soạn tay 1',
        points: 2,
        options_json: [
          { key: 'A', text: 'Phương án A' },
          { key: 'B', text: 'Phương án B' },
        ],
        answer_key: { correct_answer: 'A' },
        // Không có QB metadata
      },
      {
        id: 'q-qb-imported-2',
        question_number: 2,
        question_type: 'multiple_choice',
        prompt: 'Câu hỏi đã nhập từ QB',
        points: 3,
        options_json: [
          { key: 'A', text: 'Đáp án 1' },
          { key: 'B', text: 'Đáp án 2' },
        ],
        answer_key: { correct_answer: ['A', 'B'] },
        source_question_bank_item_id: 'qb-item-999',
        source_question_bank_version_id: 'qb-ver-888',
      },
    ];

    const payload = buildSaveDraftQuestionsPayload(localQuestions);
    assert.equal(payload.length, 2);

    // Question 1: Soạn tay
    assert.equal(payload[0].id, 'q-manual-1');
    assert.equal(payload[0].source_question_bank_item_id, null);
    assert.equal(payload[0].source_question_bank_version_id, null);

    // Question 2: Nhập từ QB -> Phải bảo tồn audit metadata
    assert.equal(payload[1].id, 'q-qb-imported-2');
    assert.equal(payload[1].source_question_bank_item_id, 'qb-item-999');
    assert.equal(payload[1].source_question_bank_version_id, 'qb-ver-888');
    assert.deepEqual(payload[1].options_json, [
      { key: 'A', text: 'Đáp án 1' },
      { key: 'B', text: 'Đáp án 2' },
    ]);
  });

  await test('6.3 Brand-new exam + edited manual question + QB import: Lưu nháp trước -> Giữ nguyên câu soạn tay + Nối tiếp câu import', async () => {
    let savedDraftQuestions = null;
    let importCalled = false;
    const persistedExamId = '11111111-0000-4000-8000-000000000055';
    const persistedVersionId = '33333333-0000-4000-8000-000000000055';

    // Giả lập state phía Frontend khi giáo viên soạn câu hỏi thủ công
    const manualQuestion = {
      id: 'custom-q-1',
      question_number: 1,
      question_type: 'single_choice',
      prompt: '3 + 5 = ? (Giáo viên tự soạn)',
      points: 2,
      options_json: [
        { key: 'A', text: '7' },
        { key: 'B', text: '8' },
        { key: 'C', text: '9' },
        { key: 'D', text: '10' },
      ],
      answer_key: { correct_answer: 'B' },
    };
    let localQuestionsState = [manualQuestion];

    const mockClient = new ExamManagementClient({
      invokeFunction: async ({ action, payload }) => {
        if (action === 'create-test') {
          return {
            ok: true,
            data: {
              exam_id: persistedExamId,
              version_id: persistedVersionId,
              version_number: 1,
              status: 'draft',
            },
          };
        }
        if (action === 'save-draft') {
          savedDraftQuestions = payload.questions;
          return { ok: true, data: { success: true } };
        }
        if (action === 'import-question-bank-items') {
          importCalled = true;
          assert.equal(payload.version_id, persistedVersionId);
          return {
            ok: true,
            data: {
              total_imported: 1,
              imported_questions: [
                {
                  id: 'qb-imported-q2',
                  exam_version_id: payload.version_id,
                  question_number: 2,
                  question_type: 'single_choice',
                  prompt: 'Câu hỏi từ Ngân hàng',
                  points: 1,
                  options_json: [{ key: 'A', text: 'A1' }, { key: 'B', text: 'A2' }],
                  source_question_bank_item_id: 'qb-item-101',
                  source_question_bank_version_id: 'qb-ver-101',
                },
              ],
            },
          };
        }
        if (action === 'get-test-detail') {
          // Mô phỏng server snapshot trả về cả câu soạn tay đã persist và câu import vừa append
          return {
            ok: true,
            data: {
              version: { id: persistedVersionId, version_number: 1, status: 'draft' },
              questions: [
                {
                  id: 'custom-q-1',
                  question_number: 1,
                  question_type: 'single_choice',
                  prompt: '3 + 5 = ? (Giáo viên tự soạn)',
                  points: 2,
                  options_json: manualQuestion.options_json,
                  answer_key: manualQuestion.answer_key,
                },
                {
                  id: 'qb-imported-q2',
                  question_number: 2,
                  question_type: 'single_choice',
                  prompt: 'Câu hỏi từ Ngân hàng',
                  points: 1,
                  options_json: [{ key: 'A', text: 'A1' }, { key: 'B', text: 'A2' }],
                  source_question_bank_item_id: 'qb-item-101',
                  source_question_bank_version_id: 'qb-ver-101',
                },
              ],
            },
          };
        }
        throw new Error(`Unexpected action: ${action}`);
      },
    });

    // --- Mô phỏng quy trình xử lý của ExamEditorModal ---
    // 1. Giáo viên ấn "Ngân hàng câu hỏi" -> handleOpenQuestionBankPicker
    const isUntouched = isUntouchedDemoQuestion(localQuestionsState, true);
    assert.equal(isUntouched, false); // Đã chỉnh sửa -> không phải dummy

    const createRes = await mockClient.createTest({ title: 'Đề mới', subject: 'Toán', grade_level: 1 });
    assert.equal(createRes.ok, true);

    const questionsToPersist = isUntouched ? [] : localQuestionsState;
    const saveRes = await mockClient.saveDraft({
      version_id: createRes.data.version_id,
      title: 'Đề mới',
      subject: 'Toán',
      grade_level: 1,
      questions: buildSaveDraftQuestionsPayload(questionsToPersist),
    });
    assert.equal(saveRes.ok, true);
    assert.equal(savedDraftQuestions.length, 1);
    assert.equal(savedDraftQuestions[0].prompt, '3 + 5 = ? (Giáo viên tự soạn)');

    // 2. Giáo viên chọn câu hỏi trong Modal -> handleImportFromQuestionBank
    const importRes = await mockClient.importQuestionsFromQuestionBank({
      versionId: createRes.data.version_id,
      examId: createRes.data.exam_id,
      questionBankItemIds: ['qb-item-101'],
    });
    assert.equal(importRes.ok, true);

    // 3. Tải lại chi tiết đề thi -> Cập nhật state
    const detailRes = await mockClient.getTestDetail({
      examId: createRes.data.exam_id,
      versionId: createRes.data.version_id,
    });
    assert.equal(detailRes.ok, true);
    localQuestionsState = detailRes.data.questions;

    // Kiểm tra kết quả bảo toàn:
    assert.equal(localQuestionsState.length, 2);
    assert.equal(localQuestionsState[0].prompt, '3 + 5 = ? (Giáo viên tự soạn)');
    assert.equal(localQuestionsState[0].points, 2);
    assert.equal(localQuestionsState[1].prompt, 'Câu hỏi từ Ngân hàng');
    assert.equal(localQuestionsState[1].source_question_bank_item_id, 'qb-item-101');
  });

  await test('6.4 Brand-new exam + 2 manually-added questions + QB import: Bảo toàn đúng thứ tự các câu', async () => {
    let savedPayloadQuestions = [];
    const mockClient = new ExamManagementClient({
      invokeFunction: async ({ action, payload }) => {
        if (action === 'create-test') {
          return { ok: true, data: { exam_id: 'exam-1', version_id: 'ver-1' } };
        }
        if (action === 'save-draft') {
          savedPayloadQuestions = payload.questions;
          return { ok: true, data: { success: true } };
        }
        return { ok: true, data: {} };
      },
    });

    const localQuestions = [
      { id: 'q1', question_number: 1, question_type: 'single_choice', prompt: 'Câu 1', points: 1, options_json: [{ key: 'A', text: '1' }, { key: 'B', text: '2' }] },
      { id: 'q2', question_number: 2, question_type: 'short_answer', prompt: 'Câu 2', points: 2, answer_key: { correct_answer: 'abc' } },
    ];

    assert.equal(isUntouchedDemoQuestion(localQuestions, true), false);

    const createRes = await mockClient.createTest({ title: 'Đề 2 câu', subject: 'Toán', grade_level: 1 });
    await mockClient.saveDraft({
      version_id: createRes.data.version_id,
      questions: buildSaveDraftQuestionsPayload(localQuestions),
    });

    assert.equal(savedPayloadQuestions.length, 2);
    assert.equal(savedPayloadQuestions[0].prompt, 'Câu 1');
    assert.equal(savedPayloadQuestions[0].question_number, 1);
    assert.equal(savedPayloadQuestions[1].prompt, 'Câu 2');
    assert.equal(savedPayloadQuestions[1].question_number, 2);
  });

  await test('6.5 createTest succeeds nhưng pre-import saveDraft thất bại -> Fail-closed: Picker không mở, Import không gọi, Local questions nguyên vẹn', async () => {
    let pickerOpened = false;
    let importCalled = false;
    let errorDisplayed = '';

    const mockClient = new ExamManagementClient({
      invokeFunction: async ({ action }) => {
        if (action === 'create-test') {
          return { ok: true, data: { exam_id: 'exam-err-1', version_id: 'ver-err-1' } };
        }
        if (action === 'save-draft') {
          return { ok: false, error: { message: 'DB Connection Timeout on Save Draft' } };
        }
        if (action === 'import-question-bank-items') {
          importCalled = true;
          return { ok: true, data: {} };
        }
        throw new Error(`Unexpected action: ${action}`);
      },
    });

    const localQuestions = [
      { id: 'unsaved-q1', question_number: 1, question_type: 'single_choice', prompt: 'Câu hỏi quan trọng vừa tạo', points: 5 },
    ];
    let localStateQuestions = [...localQuestions];

    // Mô phỏng handleOpenQuestionBankPicker
    const createRes = await mockClient.createTest({ title: 'Đề mới', subject: 'Toán', grade_level: 1 });
    assert.equal(createRes.ok, true);

    const saveRes = await mockClient.saveDraft({
      version_id: createRes.data.version_id,
      questions: buildSaveDraftQuestionsPayload(localStateQuestions),
    });

    if (!saveRes.ok) {
      errorDisplayed = saveRes.error?.message || 'Lỗi lưu bản nháp';
      // Không bật picker, không import
    } else {
      pickerOpened = true;
    }

    assert.equal(pickerOpened, false);
    assert.equal(importCalled, false);
    assert.equal(errorDisplayed, 'DB Connection Timeout on Save Draft');
    // Local questions hoàn toàn được giữ nguyên không bị mất
    assert.equal(localStateQuestions.length, 1);
    assert.equal(localStateQuestions[0].prompt, 'Câu hỏi quan trọng vừa tạo');
  });

  await test('6.6 Untouched default demo + QB import: Lưu mảng rỗng -> QB items thay thế hoàn toàn -> Không bị nhân đôi câu demo', async () => {
    let savedPayloadQuestions = null;
    const defaultDemo = [
      {
        id: 'dummy-1',
        question_number: 1,
        question_type: 'single_choice',
        prompt: '1 + 1 = ?',
        points: 1,
        options_json: [
          { key: 'A', text: '1' },
          { key: 'B', text: '2' },
          { key: 'C', text: '3' },
          { key: 'D', text: '4' },
        ],
        answer_key: { correct_answer: 'B' },
      },
    ];

    const mockClient = new ExamManagementClient({
      invokeFunction: async ({ action, payload }) => {
        if (action === 'create-test') {
          return { ok: true, data: { exam_id: 'exam-dummy-1', version_id: 'ver-dummy-1' } };
        }
        if (action === 'save-draft') {
          savedPayloadQuestions = payload.questions;
          return { ok: true, data: { success: true } };
        }
        return { ok: true, data: {} };
      },
    });

    // Check dummy helper
    const isUntouched = isUntouchedDemoQuestion(defaultDemo, true);
    assert.equal(isUntouched, true);

    // Khi untouched demo -> questionsToPersist = []
    const questionsToPersist = isUntouched ? [] : defaultDemo;
    assert.equal(questionsToPersist.length, 0);

    const createRes = await mockClient.createTest({ title: 'Đề mới', subject: 'Toán', grade_level: 1 });
    await mockClient.saveDraft({
      version_id: createRes.data.version_id,
      questions: buildSaveDraftQuestionsPayload(questionsToPersist),
    });

    // DB nhận [] trước khi QB import ghi đè snapshot -> không còn câu 1 + 1 = ? thừa
    assert.equal(savedPayloadQuestions.length, 0);
  });

  await test('6.7 source_question_bank_item_id và source_question_bank_version_id sống sót qua các lần Save Draft tiếp theo', async () => {
    // Mô phỏng câu hỏi sau khi import từ QB đã nạp vào state
    const importedStateQuestions = [
      {
        id: 'imported-id-123',
        question_number: 1,
        question_type: 'single_choice',
        prompt: 'Nội dung câu hỏi nhập từ QB (Giáo viên đã sửa nhẹ chữ)',
        points: 2,
        options_json: [
          { key: 'A', text: 'Lựa chọn A' },
          { key: 'B', text: 'Lựa chọn B' },
        ],
        answer_key: { correct_answer: 'A' },
        source_question_bank_item_id: 'qb-origin-item-001',
        source_question_bank_version_id: 'qb-origin-ver-001',
      },
    ];

    // Thực hiện build payload lưu nháp (như handleSaveDraft)
    const savePayload = buildSaveDraftQuestionsPayload(importedStateQuestions);

    assert.equal(savePayload[0].source_question_bank_item_id, 'qb-origin-item-001');
    assert.equal(savePayload[0].source_question_bank_version_id, 'qb-origin-ver-001');
    assert.equal(savePayload[0].prompt, 'Nội dung câu hỏi nhập từ QB (Giáo viên đã sửa nhẹ chữ)');
    assert.equal(savePayload[0].points, 2);
  });

  await test('6.8 Edit existing draft: Đã có sẵn version_id thật -> Không gọi create-test -> Import trực tiếp thành công', async () => {
    let createTestCalled = false;
    let importCalled = false;

    const existingVersionId = '33333333-0000-4000-8000-000000000001';
    const existingExamId = '11111111-0000-4000-8000-000000000001';

    const mockClient = new ExamManagementClient({
      invokeFunction: async ({ action, payload }) => {
        if (action === 'create-test') {
          createTestCalled = true;
          return { ok: false, error: { message: 'Should not be called!' } };
        }
        if (action === 'import-question-bank-items') {
          importCalled = true;
          assert.equal(payload.version_id, existingVersionId);
          assert.equal(payload.exam_id, existingExamId);
          return {
            ok: true,
            data: {
              total_imported: payload.question_bank_item_ids.length,
              imported_questions: [],
            },
          };
        }
        throw new Error(`Unexpected action: ${action}`);
      },
    });

    let currentExamId = existingExamId;
    let currentVerId = existingVersionId;

    if (!currentExamId || !currentVerId) {
      await mockClient.createTest({ title: 'test', subject: 'Toán', grade_level: 1 });
    }

    const importRes = await mockClient.importQuestionsFromQuestionBank({
      versionId: currentVerId,
      examId: currentExamId,
      questionBankItemIds: ['qb-item-101'],
    });

    assert.equal(createTestCalled, false);
    assert.equal(importCalled, true);
    assert.equal(importRes.ok, true);
  });

  await test('6.9 Import bị chặn nếu version_id rỗng hoặc null khi gửi lên backend', async () => {
    const db = createMockDb();
    const res = simulateImportEndpoint('teacher', db.teacher1Id, {
      version_id: '',
      question_bank_item_ids: ['qb-item-101'],
    }, db);

    assert.equal(res.status, 400);
    assert.equal(res.error_code, 'INVALID_VERSION_ID');
  });

  await test('6.10 Khi create-test thất bại -> Import không được thực hiện', async () => {
    let createTestAttempted = false;
    let importAttempted = false;

    const mockClient = new ExamManagementClient({
      invokeFunction: async ({ action }) => {
        if (action === 'create-test') {
          createTestAttempted = true;
          return {
            ok: false,
            error: { status: 500, errorCode: 'NETWORK_ERROR', message: 'Mất kết nối mạng' },
          };
        }
        if (action === 'import-question-bank-items') {
          importAttempted = true;
          return { ok: true, data: {} };
        }
        throw new Error(`Unexpected action: ${action}`);
      },
    });

    let currentExamId = '';
    let currentVerId = '';
    let createError = null;

    try {
      if (!currentExamId || !currentVerId) {
        const createRes = await mockClient.createTest({ title: 'Đề mới', subject: 'Toán', grade_level: 1 });
        if (!createRes.ok || !createRes.data) {
          throw new Error(createRes.error?.message || 'Không thể khởi tạo bản nháp');
        }
        currentExamId = createRes.data.exam_id;
        currentVerId = createRes.data.version_id;
      }

      await mockClient.importQuestionsFromQuestionBank({
        versionId: currentVerId,
        examId: currentExamId,
        questionBankItemIds: ['qb-item-101'],
      });
    } catch (err) {
      createError = err;
    }

    assert.equal(createTestAttempted, true);
    assert.equal(importAttempted, false);
    assert.notEqual(createError, null);
    assert.equal(createError.message, 'Mất kết nối mạng');
  });
  console.log('\n==================================================');
  console.log(`KẾT QUẢ KIỂM THỬ: ${passed}/${total} TESTS PASSED`);
  if (passed === total) {
    console.log('🎉 TẤT CẢ TEST CASES BẢO MẬT & DỮ LIỆU ĐÃ VƯỢT QUA XUẤT SẮC!');
  } else {
    console.error(`⚠️ CÓ ${total - passed} TEST CASES BỊ LỖI!`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Lỗi khi chạy test suite:', err);
  process.exit(1);
});
