// scripts/test_exam_question_bank_import.mjs
// Automated Test Suite for Exam V1 Question Bank Import & Snapshot Copy (26 Comprehensive Scenarios)

import assert from 'node:assert/strict';
import {
  mapQuestionType,
  mapOptionsToCanonical,
  mapAnswerKeyToCanonical,
  convertQbQuestionToExamQuestion,
} from '../src/utils/examQuestionBankAdapter.js';
import { validateImportQuestionBankPayload } from '../supabase/functions/exam-management-api/validation.ts';
import { ExamManagementClient } from '../src/services/examManagementClient.js';

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

// Mock in-memory database for BFF simulation
function createMockDb() {
  const teacher1Id = 'teacher-uuid-001';
  const teacher2Id = 'teacher-uuid-002';
  const studentId = 'student-uuid-999';
  const adminId = 'admin-uuid-000';

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
  ];

  const questionBankVersions = [
    {
      id: 'qb-ver-101',
      item_id: 'qb-item-101',
      prompt: '1 + 1 = ?',
      options: ['1', '2', '3', '4'],
    },
    {
      id: 'qb-ver-102',
      item_id: 'qb-item-102',
      prompt: '5 x 5 = ?',
      options: ['20', '25', '30', '35'],
    },
    {
      id: 'qb-ver-103',
      item_id: 'qb-item-103',
      prompt: '10 x 10 = ?',
      options: ['50', '100', '150', '200'],
    },
    {
      id: 'qb-ver-104',
      item_id: 'qb-item-104',
      prompt: 'Hãy tả lại một cảnh đẹp quê hương em.',
      options: [],
    },
  ];

  const questionBankAnswerKeys = [
    { version_id: 'qb-ver-101', correct_answers: { correct_option_id: 'opt_2' } },
    { version_id: 'qb-ver-102', correct_answers: { correct_option_id: 'opt_2' } },
    { version_id: 'qb-ver-103', correct_answers: { correct_option_id: 'opt_2' } },
    { version_id: 'qb-ver-104', correct_answers: null },
  ];

  const examTests = [
    { id: 'exam-001', author_id: teacher1Id, status: 'draft' },
    { id: 'exam-002', author_id: teacher2Id, status: 'draft' },
  ];

  const examVersions = [
    { id: 'ver-draft-001', exam_id: 'exam-001', status: 'draft' },
    { id: 'ver-pub-001', exam_id: 'exam-001', status: 'published' },
    { id: 'ver-draft-002', exam_id: 'exam-002', status: 'draft' },
  ];

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
  };
}

// BFF Import Endpoint Simulation
function simulateImportEndpoint(callerRole, callerId, payload, db) {
  if (!callerRole) {
    return { status: 401, error_code: 'UNAUTHORIZED', message: 'Yêu cầu xác thực Bearer token.' };
  }

  if (callerRole !== 'admin' && callerRole !== 'teacher') {
    return { status: 403, error_code: 'FORBIDDEN_ROLE', message: 'Chỉ Giáo viên hoặc Quản trị viên mới có quyền nhập câu hỏi.' };
  }

  if (payload.version_id) {
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
  }

  const items = db.questionBankItems.filter(item => payload.question_bank_item_ids.includes(item.id));
  if (items.length === 0) {
    return { status: 404, error_code: 'QUESTION_NOT_FOUND', message: 'Không tìm thấy câu hỏi nào.' };
  }

  const importedQuestions = [];
  for (const item of items) {
    if (callerRole === 'teacher') {
      const isOwn = item.author_id === callerId;
      const isPublishedShared = item.status === 'published' && item.visibility === 'public_template';
      if (!isOwn && !isPublishedShared) {
        return { status: 403, error_code: 'FORBIDDEN_QUESTION_ACCESS', message: `Bạn không có quyền sử dụng câu hỏi '${item.title}'.` };
      }
    }

    const ver = db.questionBankVersions.find(v => v.id === item.current_version_id);
    if (!ver) continue;
    const ansKey = db.questionBankAnswerKeys.find(k => k.version_id === ver.id);

    const q = convertQbQuestionToExamQuestion(item, ver, ansKey, importedQuestions.length + 1);
    importedQuestions.push(q);
  }

  return {
    status: 200,
    data: {
      total_imported: importedQuestions.length,
      imported_questions: importedQuestions,
    },
  };
}

async function main() {
  console.log('=== BẮT ĐẦU KIỂM THỬ: IMPORT CÂU HỎI TỪ NGÂN HÀNG CÂU HỎI VÀO ĐỀ THI (EXAM V1) ===\n');

  // =========================================================================
  // PHẦN 1: ADAPTER & CANONICAL SCHEMA TESTS (1 - 7)
  // =========================================================================
  console.log('--- PHẦN 1: Adapter & Canonical Mapping ---');

  await test('1.1 mapQuestionType chuyển đổi chính xác tất cả các loại câu hỏi', () => {
    assert.equal(mapQuestionType('single_choice'), 'single_choice');
    assert.equal(mapQuestionType('choice'), 'single_choice');
    assert.equal(mapQuestionType('trac_nghiem'), 'single_choice');
    assert.equal(mapQuestionType('multiple_choice'), 'multiple_choice');
    assert.equal(mapQuestionType('fill_blank'), 'fill_blank');
    assert.equal(mapQuestionType('dien_khuyet'), 'fill_blank');
    assert.equal(mapQuestionType('short_answer'), 'short_answer');
    assert.equal(mapQuestionType('tra_loi_ngan'), 'short_answer');
    assert.equal(mapQuestionType('essay'), 'essay');
    assert.equal(mapQuestionType('tu_luan'), 'essay');
    assert.equal(mapQuestionType('image_upload'), 'image_upload');
    assert.equal(mapQuestionType('file_upload'), 'file_upload');
    assert.equal(mapQuestionType('unknown_custom'), 'single_choice');
  });

  await test('1.2 mapOptionsToCanonical chuyển đổi mảng chuỗi & object thành [{ key, text }]', () => {
    const fromStrings = mapOptionsToCanonical(['Hà Nội', 'Đà Nẵng', 'Hồ Chí Minh', 'Cần Thơ']);
    assert.equal(fromStrings.length, 4);
    assert.deepEqual(fromStrings[0], { key: 'A', text: 'Hà Nội', originalId: 'opt_1' });
    assert.deepEqual(fromStrings[1], { key: 'B', text: 'Đà Nẵng', originalId: 'opt_2' });

    const fromObjects = mapOptionsToCanonical([
      { id: 'opt_1', text: 'Phương án 1' },
      { id: 'opt_2', text: 'Phương án 2' },
    ]);
    assert.equal(fromObjects.length, 2);
    assert.deepEqual(fromObjects[0], { key: 'A', text: 'Phương án 1', originalId: 'opt_1' });
    assert.deepEqual(fromObjects[1], { key: 'B', text: 'Phương án 2', originalId: 'opt_2' });
  });

  await test('1.3 mapOptionsToCanonical tự động bổ sung tối thiểu 2 phương án nếu thiếu', () => {
    const emptyCanonical = mapOptionsToCanonical([]);
    assert.equal(emptyCanonical.length, 0);

    const q = convertQbQuestionToExamQuestion(
      { id: 'qb-1', question_type: 'single_choice', title: 'Test' },
      { id: 'v-1', prompt: 'Prompt', options: [] }
    );
    assert.ok(q.options_json.length >= 2);
    assert.equal(q.options_json[0].key, 'A');
    assert.equal(q.options_json[1].key, 'B');
  });

  await test('1.4 mapAnswerKeyToCanonical cho single_choice ánh xạ chuẩn opt_1/A/Text', () => {
    const options = [
      { key: 'A', text: 'Paris', originalId: 'opt_1' },
      { key: 'B', text: 'London', originalId: 'opt_2' },
      { key: 'C', text: 'Berlin', originalId: 'opt_3' },
    ];
    assert.deepEqual(mapAnswerKeyToCanonical('single_choice', options, { correct_option_id: 'opt_2' }), { correct_answer: 'B' });
    assert.deepEqual(mapAnswerKeyToCanonical('single_choice', options, { correct_answer: 'C' }), { correct_answer: 'C' });
    assert.deepEqual(mapAnswerKeyToCanonical('single_choice', options, { correct_answer: 'Paris' }), { correct_answer: 'A' });
  });

  await test('1.5 mapAnswerKeyToCanonical cho multiple_choice ánh xạ mảng các key [A, C]', () => {
    const options = [
      { key: 'A', text: 'Đúng 1', originalId: 'opt_1' },
      { key: 'B', text: 'Sai 1', originalId: 'opt_2' },
      { key: 'C', text: 'Đúng 2', originalId: 'opt_3' },
      { key: 'D', text: 'Sai 2', originalId: 'opt_4' },
    ];
    assert.deepEqual(
      mapAnswerKeyToCanonical('multiple_choice', options, { correct_option_ids: ['opt_1', 'opt_3'] }),
      { correct_answer: ['A', 'C'] }
    );
  });

  await test('1.6 mapAnswerKeyToCanonical cho fill_blank & short_answer', () => {
    const ansKey = {
      correct_text: 'Thủ đô Hà Nội',
      accepted_texts: ['Hà Nội', 'ha noi', 'Ha Noi'],
    };
    assert.deepEqual(mapAnswerKeyToCanonical('fill_blank', [], ansKey), {
      correct_answer: 'Thủ đô Hà Nội',
      accepted_answers: ['Hà Nội', 'ha noi', 'Ha Noi'],
    });
  });

  await test('1.7 mapAnswerKeyToCanonical cho câu tự luận / upload trả về null an toàn', () => {
    assert.equal(mapAnswerKeyToCanonical('essay', [], { correct_answer: 'any' }), null);
    assert.equal(mapAnswerKeyToCanonical('image_upload', [], null), null);
    assert.equal(mapAnswerKeyToCanonical('file_upload', [], {}), null);
  });

  // =========================================================================
  // PHẦN 2: VALIDATION TESTS (8 - 13)
  // =========================================================================
  console.log('\n--- PHẦN 2: Payload Validation ---');

  await test('2.1 validateImportQuestionBankPayload từ chối dữ liệu không phải object', () => {
    assert.equal(validateImportQuestionBankPayload(null).valid, false);
    assert.equal(validateImportQuestionBankPayload('string').valid, false);
  });

  await test('2.2 validateImportQuestionBankPayload từ chối mảng rỗng', () => {
    const res = validateImportQuestionBankPayload({ question_bank_item_ids: [] });
    assert.equal(res.valid, false);
    assert.equal(res.errorCode, 'INVALID_QUESTION_BANK_IDS');
  });

  await test('2.3 validateImportQuestionBankPayload từ chối batch size > 100 câu', () => {
    const longList = Array.from({ length: 101 }, () => '11111111-1111-4111-8111-111111111111');
    const res = validateImportQuestionBankPayload({ question_bank_item_ids: longList });
    assert.equal(res.valid, false);
    assert.equal(res.errorCode, 'INVALID_BATCH_SIZE');
  });

  await test('2.4 validateImportQuestionBankPayload từ chối ID không đúng chuẩn UUID', () => {
    const res = validateImportQuestionBankPayload({
      question_bank_item_ids: ['invalid-uuid-123', '11111111-1111-4111-8111-111111111111'],
    });
    assert.equal(res.valid, false);
    assert.equal(res.errorCode, 'INVALID_QUESTION_BANK_ID');
  });

  await test('2.5 validateImportQuestionBankPayload tự động loại bỏ trùng lặp (deduplicate)', () => {
    const id1 = '11111111-1111-4111-8111-111111111111';
    const id2 = '22222222-2222-4222-8222-222222222222';
    const res = validateImportQuestionBankPayload({
      question_bank_item_ids: [id1, id2, id1, id2],
      version_id: '33333333-3333-4333-8333-333333333333',
    });
    assert.equal(res.valid, true);
    assert.equal(res.data.question_bank_item_ids.length, 2);
    assert.deepEqual(res.data.question_bank_item_ids, [id1, id2]);
  });

  await test('2.6 validateImportQuestionBankPayload kiểm tra UUID hợp lệ cho version_id & exam_id', () => {
    const res1 = validateImportQuestionBankPayload({
      question_bank_item_ids: ['11111111-1111-4111-8111-111111111111'],
      version_id: 'invalid-ver-id',
    });
    assert.equal(res1.valid, false);
    assert.equal(res1.errorCode, 'INVALID_VERSION_ID');

    const res2 = validateImportQuestionBankPayload({
      question_bank_item_ids: ['11111111-1111-4111-8111-111111111111'],
      exam_id: 'invalid-exam-id',
    });
    assert.equal(res2.valid, false);
    assert.equal(res2.errorCode, 'INVALID_EXAM_ID');
  });

  // =========================================================================
  // PHẦN 3: SECURITY & AUTHORIZATION GUARDS (14 - 22)
  // =========================================================================
  console.log('\n--- PHẦN 3: Security & Authorization Guards ---');

  await test('3.1 Yêu cầu chưa đăng nhập (không có token/role) bị từ chối 401 UNAUTHORIZED', () => {
    const db = createMockDb();
    const res = simulateImportEndpoint(null, null, { question_bank_item_ids: ['qb-item-101'] }, db);
    assert.equal(res.status, 401);
    assert.equal(res.error_code, 'UNAUTHORIZED');
  });

  await test('3.2 Học sinh bị từ chối 403 FORBIDDEN_ROLE khi gọi endpoint import', () => {
    const db = createMockDb();
    const res = simulateImportEndpoint('student', db.studentId, { question_bank_item_ids: ['qb-item-101'] }, db);
    assert.equal(res.status, 403);
    assert.equal(res.error_code, 'FORBIDDEN_ROLE');
  });

  await test('3.3 Giáo viên nhập câu hỏi của chính mình thành công (200 OK)', () => {
    const db = createMockDb();
    const res = simulateImportEndpoint('teacher', db.teacher1Id, {
      version_id: 'ver-draft-001',
      question_bank_item_ids: ['qb-item-101'],
    }, db);
    assert.equal(res.status, 200);
    assert.equal(res.data.total_imported, 1);
    assert.equal(res.data.imported_questions[0].source_question_bank_item_id, 'qb-item-101');
  });

  await test('3.4 Giáo viên nhập câu hỏi public_template của giáo viên khác thành công (200 OK)', () => {
    const db = createMockDb();
    const res = simulateImportEndpoint('teacher', db.teacher1Id, {
      version_id: 'ver-draft-001',
      question_bank_item_ids: ['qb-item-102'],
    }, db);
    assert.equal(res.status, 200);
    assert.equal(res.data.total_imported, 1);
    assert.equal(res.data.imported_questions[0].source_question_bank_item_id, 'qb-item-102');
  });

  await test('3.5 Giáo viên bị từ chối 403 FORBIDDEN_QUESTION_ACCESS khi cố nhập câu hỏi private của giáo viên khác', () => {
    const db = createMockDb();
    const res = simulateImportEndpoint('teacher', db.teacher1Id, {
      version_id: 'ver-draft-001',
      question_bank_item_ids: ['qb-item-103'],
    }, db);
    assert.equal(res.status, 403);
    assert.equal(res.error_code, 'FORBIDDEN_QUESTION_ACCESS');
  });

  await test('3.6 Admin có quyền nhập bất kỳ câu hỏi nào (kể cả private của giáo viên khác)', () => {
    const db = createMockDb();
    const res = simulateImportEndpoint('admin', db.adminId, {
      version_id: 'ver-draft-001',
      question_bank_item_ids: ['qb-item-103'],
    }, db);
    assert.equal(res.status, 200);
    assert.equal(res.data.total_imported, 1);
  });

  await test('3.7 Từ chối 403 ERR_VERSION_IMMUTABLE nếu phiên bản đề thi đã xuất bản (published)', () => {
    const db = createMockDb();
    const res = simulateImportEndpoint('teacher', db.teacher1Id, {
      version_id: 'ver-pub-001',
      question_bank_item_ids: ['qb-item-101'],
    }, db);
    assert.equal(res.status, 403);
    assert.equal(res.error_code, 'ERR_VERSION_IMMUTABLE');
  });

  await test('3.8 Giáo viên không thể nhập vào bản nháp đề thi của giáo viên khác (403 FORBIDDEN)', () => {
    const db = createMockDb();
    const res = simulateImportEndpoint('teacher', db.teacher1Id, {
      version_id: 'ver-draft-002', // Đề của Teacher 2
      question_bank_item_ids: ['qb-item-101'],
    }, db);
    assert.equal(res.status, 403);
    assert.equal(res.error_code, 'FORBIDDEN');
  });

  await test('3.9 Trả về 404 QUESTION_NOT_FOUND nếu không tìm thấy ID câu hỏi nào tồn tại', () => {
    const db = createMockDb();
    const res = simulateImportEndpoint('teacher', db.teacher1Id, {
      version_id: 'ver-draft-001',
      question_bank_item_ids: ['non-existent-qb-id'],
    }, db);
    assert.equal(res.status, 404);
    assert.equal(res.error_code, 'QUESTION_NOT_FOUND');
  });

  // =========================================================================
  // PHẦN 4: SNAPSHOT INDEPENDENCE & PROJECTION INTEGRITY (23 - 25)
  // =========================================================================
  console.log('\n--- PHẦN 4: Snapshot Copy & Projection Integrity ---');

  await test('4.1 Độc lập snapshot: Sửa câu hỏi gốc trong QB không làm thay đổi câu hỏi đã import vào đề thi', () => {
    const db = createMockDb();
    const res = simulateImportEndpoint('teacher', db.teacher1Id, {
      version_id: 'ver-draft-001',
      question_bank_item_ids: ['qb-item-101'],
    }, db);
    assert.equal(res.status, 200);

    const importedQ = res.data.imported_questions[0];
    const initialPrompt = importedQ.prompt;
    assert.equal(initialPrompt, '1 + 1 = ?');

    // Sửa trực tiếp question bank version
    const qbVer = db.questionBankVersions.find(v => v.id === 'qb-ver-101');
    qbVer.prompt = '100 + 200 = ? (Đã chỉnh sửa trong QB)';

    // Câu hỏi trong đề thi snapshot không bị biến động
    assert.equal(importedQ.prompt, '1 + 1 = ?');
    assert.notEqual(importedQ.prompt, qbVer.prompt);
  });

  await test('4.2 Đảm bảo không rò rỉ đáp án trong options_json (Answer key separation)', () => {
    const db = createMockDb();
    const res = simulateImportEndpoint('teacher', db.teacher1Id, {
      version_id: 'ver-draft-001',
      question_bank_item_ids: ['qb-item-101'],
    }, db);
    const q = res.data.imported_questions[0];
    for (const opt of q.options_json) {
      assert.equal(opt.is_correct, undefined);
      assert.equal(opt.correct, undefined);
    }
  });

  await test('4.3 Thêm nối tiếp câu hỏi vào danh sách đề thi giữ đúng thứ tự question_number liên tục', () => {
    const existingQuestions = [
      { id: 'q-1', question_number: 1, prompt: 'Câu 1' },
      { id: 'q-2', question_number: 2, prompt: 'Câu 2' },
    ];
    const importedFromQB = [
      { id: 'q-new-1', prompt: 'Câu QB 1' },
      { id: 'q-new-2', prompt: 'Câu QB 2' },
    ];
    const updated = [
      ...existingQuestions,
      ...importedFromQB.map((q, idx) => ({
        ...q,
        question_number: existingQuestions.length + idx + 1,
      })),
    ];
    assert.equal(updated.length, 4);
    assert.equal(updated[0].question_number, 1);
    assert.equal(updated[1].question_number, 2);
    assert.equal(updated[2].question_number, 3);
    assert.equal(updated[3].question_number, 4);
  });

  // =========================================================================
  // PHẦN 5: CLIENT SDK TESTS (26)
  // =========================================================================
  console.log('\n--- PHẦN 5: Client SDK Integration ---');

  await test('5.1 ExamManagementClient.importQuestionsFromQuestionBank gửi đúng payload, method và action', async () => {
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
              question_number: idx + 1,
              prompt: `Câu hỏi ${idx + 1}`,
              source_question_bank_item_id: id,
            })),
          },
        };
      },
    });

    const res = await mockClient.importQuestionsFromQuestionBank({
      versionId: '11111111-1111-4111-8111-111111111111',
      examId: '22222222-2222-4222-8222-222222222222',
      questionBankItemIds: ['qb-item-1', 'qb-item-2'],
    });

    assert.equal(dispatchedAction, 'import-question-bank-items');
    assert.equal(dispatchedMethod, 'POST');
    assert.equal(dispatchedPayload.version_id, '11111111-1111-4111-8111-111111111111');
    assert.equal(dispatchedPayload.exam_id, '22222222-2222-4222-8222-222222222222');
    assert.deepEqual(dispatchedPayload.question_bank_item_ids, ['qb-item-1', 'qb-item-2']);
    assert.equal(res.ok, true);
    assert.equal(res.data.total_imported, 2);
  });

  // =========================================================================
  // TỔNG KẾT
  // =========================================================================
  console.log('\n==================================================');
  console.log(`KẾT QUẢ KIỂM THỬ: ${passed}/${total} TESTS PASSED`);
  if (passed === total) {
    console.log('🎉 TẤT CẢ 26 TEST CASES ĐÃ VƯỢT QUA XUẤT SẮC!');
  } else {
    console.error(`⚠️ CÓ ${total - passed} TEST CASES BỊ LỖI!`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Lỗi khi chạy test suite:', err);
  process.exit(1);
});
