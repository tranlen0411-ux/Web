// scripts/test_question_bank_import_duplicates.mjs
// Unit test for Import Question Bank Duplicate Check Workflow (File + Existing Bank Duplicates)

import assert from 'node:assert/strict';
import {
  findDuplicatesInQuestionList,
  findExistingQuestionDuplicateIndices
} from '../src/utils/questionBankAdapters.js';

console.log('=== RUNNING QUESTION BANK IMPORT DUPLICATE WORKFLOW TESTS ===');

// 1. Test 4 existing duplicates -> initialSelected.size === 0
{
  const parsedQuestions = [
    { prompt: 'Phép tính 5 + 5 bằng mấy?', question_type: 'single_choice' },
    { prompt: 'Điền số tiếp theo: 2, 4, 6, [_____]', question_type: 'fill_blank' },
    { prompt: 'Số nào sau đây là số lẻ?', question_type: 'single_choice' },
    { prompt: 'Em hãy nêu cảm nghĩ về bài thơ.', question_type: 'essay' }
  ];

  const existingBank = [
    { prompt: '  phép tính 5 + 5 bằng mấy?  ', question_type: 'single_choice', subject: 'Toán', grade_level: 1, visibility: 'private' },
    { prompt: 'điền số tiếp theo: 2, 4, 6, [_____]', question_type: 'fill_blank', subject: 'Toán', grade_level: 1, visibility: 'private' },
    { prompt: 'số nào sau đây là số lẻ?', question_type: 'single_choice', subject: 'Toán', grade_level: 1, visibility: 'private' },
    { prompt: 'em hãy nêu cảm nghĩ về bài thơ.', question_type: 'essay', subject: 'Toán', grade_level: 1, visibility: 'private' }
  ];

  const batchConfig = { subject: 'Toán', grade_level: 1, visibility: 'private' };
  const role = 'teacher';

  const fileDuplicates = findDuplicatesInQuestionList(parsedQuestions);
  const existingDuplicates = findExistingQuestionDuplicateIndices(parsedQuestions, existingBank, batchConfig, role);
  const combinedDuplicates = new Set([...fileDuplicates, ...existingDuplicates]);

  const initialSelected = new Set(
    parsedQuestions
      .map((_, idx) => idx)
      .filter(idx => !combinedDuplicates.has(idx))
  );

  assert.equal(fileDuplicates.size, 0);
  assert.equal(existingDuplicates.size, 4);
  assert.equal(combinedDuplicates.size, 4);
  assert.equal(initialSelected.size, 0); // 4 existing duplicates => selected = 0

  console.log('PASS Workflow 1: 4 existing duplicates -> selected = 0');
}

// 2. Test 3 existing duplicates + 1 new question -> initialSelected.size === 1
{
  const parsedQuestions = [
    { prompt: 'Câu 1 (Đã có)', question_type: 'single_choice' },
    { prompt: 'Câu 2 (Đã có)', question_type: 'single_choice' },
    { prompt: 'Câu 3 (MỚI TINH)', question_type: 'single_choice' },
    { prompt: 'Câu 4 (Đã có)', question_type: 'single_choice' }
  ];

  const existingBank = [
    { prompt: 'câu 1 (đã có)', question_type: 'single_choice', subject: 'Toán', grade_level: 2, visibility: 'private' },
    { prompt: 'câu 2 (đã có)', question_type: 'single_choice', subject: 'Toán', grade_level: 2, visibility: 'private' },
    { prompt: 'câu 4 (đã có)', question_type: 'single_choice', subject: 'Toán', grade_level: 2, visibility: 'private' }
  ];

  const batchConfig = { subject: 'Toán', grade_level: 2, visibility: 'private' };
  const role = 'teacher';

  const fileDuplicates = findDuplicatesInQuestionList(parsedQuestions);
  const existingDuplicates = findExistingQuestionDuplicateIndices(parsedQuestions, existingBank, batchConfig, role);
  const combinedDuplicates = new Set([...fileDuplicates, ...existingDuplicates]);

  const initialSelected = new Set(
    parsedQuestions
      .map((_, idx) => idx)
      .filter(idx => !combinedDuplicates.has(idx))
  );

  assert.equal(fileDuplicates.size, 0);
  assert.equal(existingDuplicates.size, 3);
  assert.equal(combinedDuplicates.size, 3);
  assert.equal(initialSelected.size, 1);
  assert.equal(initialSelected.has(2), true); // Chỉ câu index 2 (Mới tinh) được chọn

  console.log('PASS Workflow 2: 3 existing + 1 new -> selected = 1 (chỉ câu mới được chọn)');
}

// 3. Test Combined: 1 duplicate in file + 1 duplicate in bank + 2 new questions
{
  const parsedQuestions = [
    { prompt: 'Câu A trùng lặp', question_type: 'single_choice' },
    { prompt: '   Câu A   trùng lặp   ', question_type: 'single_choice' },
    { prompt: 'Câu B (Đã có trong Bank)', question_type: 'single_choice' },
    { prompt: 'Câu C (Hợp lệ)', question_type: 'single_choice' }
  ];

  const existingBank = [
    { prompt: 'câu b (đã có trong bank)', question_type: 'single_choice', subject: 'Tiếng Việt', grade_level: 3, visibility: 'private' }
  ];

  const batchConfig = { subject: 'Tiếng Việt', grade_level: 3, visibility: 'private' };
  const role = 'teacher';

  const fileDuplicates = findDuplicatesInQuestionList(parsedQuestions);
  const existingDuplicates = findExistingQuestionDuplicateIndices(parsedQuestions, existingBank, batchConfig, role);
  const combinedDuplicates = new Set([...fileDuplicates, ...existingDuplicates]);

  const initialSelected = new Set(
    parsedQuestions
      .map((_, idx) => idx)
      .filter(idx => !combinedDuplicates.has(idx))
  );

  assert.equal(fileDuplicates.has(1), true); // Index 1 bị trùng với Index 0 trong file
  assert.equal(existingDuplicates.has(2), true); // Index 2 bị trùng với existing bank
  assert.equal(initialSelected.size, 2); // Index 0 (lần 1) và Index 3 hợp lệ
  assert.equal(initialSelected.has(0), true);
  assert.equal(initialSelected.has(3), true);

  console.log('PASS Workflow 3: Combined file & existing bank duplicates correctly isolated');
}

// 4. Test Scope Change (User changes batchSubject or batchGrade)
{
  const parsedQuestions = [
    { prompt: 'Phép tính cộng trừ cơ bản', question_type: 'single_choice' }
  ];

  // Bank chỉ có câu này ở môn Toán, Lớp 1
  const existingBank = [
    { prompt: 'phép tính cộng trừ cơ bản', question_type: 'single_choice', subject: 'Toán', grade_level: 1, visibility: 'private' }
  ];

  // TH 1: Batch config là Toán, Lớp 1 -> Trùng
  const dupesGrade1 = findExistingQuestionDuplicateIndices(parsedQuestions, existingBank, { subject: 'Toán', grade_level: 1, visibility: 'private' }, 'teacher');
  assert.equal(dupesGrade1.size, 1);

  // TH 2: Người dùng đổi sang môn Toán, Lớp 2 -> KHÔNG trùng
  const dupesGrade2 = findExistingQuestionDuplicateIndices(parsedQuestions, existingBank, { subject: 'Toán', grade_level: 2, visibility: 'private' }, 'teacher');
  assert.equal(dupesGrade2.size, 0);

  console.log('PASS Workflow 4: Batch scope change re-evaluates duplicate identity correctly');
}

console.log('=== ALL IMPORT DUPLICATE WORKFLOW TESTS PASSED! ===');
