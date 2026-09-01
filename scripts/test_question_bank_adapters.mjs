// scripts/test_question_bank_adapters.mjs
// Unit tests for Question Bank V2A Adapters and Security Contracts

import assert from 'node:assert/strict';
import {
  toQuestionBankPayload,
  normalizePromptForDuplicateCheck,
  buildQuestionDuplicateKey,
  findDuplicatesInQuestionList,
  findExistingQuestionDuplicateIndices,
  normalizeOptionsToStableIds,
  buildSingleChoiceAnswerKey,
  buildMultipleChoiceAnswerKey
} from '../src/utils/questionBankAdapters.js';

console.log('=== RUNNING QUESTION BANK V2A ADAPTERS UNIT TESTS (23 CASES) ===');

// 1. single_choice letter A/B/C -> correct opt id
{
  const input = {
    title: 'Single choice letter test',
    question_type: 'single_choice',
    prompt: '1 + 1 = ?',
    options: ['1', '2', '3', '4'],
    correct_answer: 'B' // letter B -> opt_2
  };
  const payload = toQuestionBankPayload(input, { role: 'teacher' });
  assert.deepEqual(payload.answer_key, { correct_option_id: 'opt_2' });
  console.log('PASS Test 1: single_choice letter A/B/C -> correct opt id');
}

// 2. single_choice text -> correct opt id
{
  const input = {
    title: 'Single choice text test',
    question_type: 'single_choice',
    prompt: '5 + 3 = ?',
    options: ['6', '7', '8', '9'],
    correct_answer: '8' // text 8 -> opt_3
  };
  const payload = toQuestionBankPayload(input, { role: 'teacher' });
  assert.deepEqual(payload.answer_key, { correct_option_id: 'opt_3' });
  console.log('PASS Test 2: single_choice text -> correct opt id');
}

// 3. single_choice invalid -> THROW
{
  const input = {
    title: 'Single choice invalid test',
    question_type: 'single_choice',
    prompt: '5 + 3 = ?',
    options: ['6', '7', '8', '9'],
    correct_answer: '100'
  };
  assert.throws(() => {
    toQuestionBankPayload(input, { role: 'teacher' });
  }, /Không thể xác định đáp án đúng/);
  console.log('PASS Test 3: single_choice invalid -> THROW');
}

// 4. multiple_choice all valid -> exact IDs
{
  const input = {
    prompt: 'Even numbers are:',
    question_type: 'multiple_choice',
    options: ['1', '2', '3', '4'],
    correct_answers: ['B', 'D'] // B=opt_2, D=opt_4
  };
  const payload = toQuestionBankPayload(input, { role: 'teacher' });
  assert.deepEqual(payload.answer_key, { correct_option_ids: ['opt_2', 'opt_4'] });

  const customOpts = [
    { id: 'opt_1', text: '1' },
    { id: 'opt_2', text: '2' },
    { id: 'opt_3', text: '3' }
  ];
  const directAndText = buildMultipleChoiceAnswerKey(customOpts, ['opt_1', '3']);
  assert.deepEqual(directAndText, { correct_option_ids: ['opt_1', 'opt_3'] });

  const dedupeTest = buildMultipleChoiceAnswerKey(customOpts, ['A', 'A']);
  assert.deepEqual(dedupeTest, { correct_option_ids: ['opt_1'] });

  console.log('PASS Test 4: multiple_choice all valid -> exact IDs');
}

// 5. multiple_choice partially invalid ["A","X"] -> THROW
{
  const inputPartialInvalid = {
    prompt: 'Multiple choice partial invalid:',
    question_type: 'multiple_choice',
    options: ['1', '2', '3', '4'],
    correct_answers: ['A', 'X'] // X does not exist
  };
  assert.throws(() => {
    toQuestionBankPayload(inputPartialInvalid, { role: 'teacher' });
  }, /Không thể ánh xạ đáp án đúng/);
  console.log('PASS Test 5: multiple_choice partially invalid ["A","X"] -> THROW');
}

// 6. multiple_choice invalid only ["X"] -> THROW
{
  const inputAllInvalid = {
    prompt: 'Multiple choice wholly invalid:',
    question_type: 'multiple_choice',
    options: ['1', '2', '3', '4'],
    correct_answers: ['X']
  };
  assert.throws(() => {
    toQuestionBankPayload(inputAllInvalid, { role: 'teacher' });
  }, /Không thể ánh xạ đáp án đúng/);
  console.log('PASS Test 6: multiple_choice invalid only ["X"] -> THROW');
}

// 7. fill_blank -> { correct_answers: [...] }
{
  const input = {
    prompt: 'Capital of Vietnam is [_____]',
    question_type: 'fill_blank',
    correct_answer: 'Ha Noi'
  };
  const payload = toQuestionBankPayload(input, { role: 'teacher' });
  assert.deepEqual(payload.answer_key, { correct_answers: ['Ha Noi'] });
  console.log('PASS Test 7: fill_blank -> { correct_answers: [...] }');
}

// 8. short_answer -> { correct_answers: [...] }
{
  const input = {
    prompt: 'How many sides does a triangle have?',
    question_type: 'short_answer',
    correct_answer: '3'
  };
  const payload = toQuestionBankPayload(input, { role: 'teacher' });
  assert.deepEqual(payload.answer_key, { correct_answers: ['3'] });
  console.log('PASS Test 8: short_answer -> { correct_answers: [...] }');
}

// 9. essay -> {}
{
  const input = {
    prompt: 'Write an essay about spring.',
    question_type: 'essay',
    explanation: 'Rubric criteria: Introduction, Body, Conclusion.'
  };
  const payload = toQuestionBankPayload(input, { role: 'teacher' });
  assert.deepEqual(payload.answer_key, {});
  assert.equal(payload.explanation, 'Rubric criteria: Introduction, Body, Conclusion.');
  console.log('PASS Test 9: essay -> {}');
}

// 10. teacher public_template -> forced private
{
  const teacherInput = {
    prompt: 'Teacher question',
    question_type: 'essay',
    visibility: 'public_template'
  };
  const teacherPayload = toQuestionBankPayload(teacherInput, { role: 'teacher' });
  assert.equal(teacherPayload.visibility, 'private');

  const adminPayload = toQuestionBankPayload(teacherInput, { role: 'admin' });
  assert.equal(adminPayload.visibility, 'public_template');
  console.log('PASS Test 10: teacher public_template -> forced private');
}

// 11. duplicate detection -> correct duplicate indexes
{
  const list = [
    { prompt: 'What is the capital of Vietnam?' },
    { prompt: '   what is the capital of VIETNAM?  ' },
    { prompt: 'How long is the Mekong river?' }
  ];
  const duplicates = findDuplicatesInQuestionList(list);
  assert.equal(duplicates.has(1), true);
  assert.equal(duplicates.has(0), false);
  assert.equal(duplicates.has(2), false);
  console.log('PASS Test 11: duplicate detection -> correct duplicate indexes');
}

// 12. forbidden security fields absent from output
{
  const maliciousInput = {
    prompt: 'Security question',
    question_type: 'essay',
    caller_id: 'hacker-uuid',
    actor_role: 'admin',
    school_id: 'fake-school',
    server_grading: true,
    service_role: 'secret-key'
  };
  const payload = toQuestionBankPayload(maliciousInput, { role: 'teacher' });
  assert.equal(payload.caller_id, undefined);
  assert.equal(payload.actor_role, undefined);
  assert.equal(payload.school_id, undefined);
  assert.equal(payload.server_grading, undefined);
  assert.equal(payload.service_role, undefined);
  console.log('PASS Test 12: forbidden security fields absent from output');
}

// 13. Regression: single_choice without tags/hints/media_urls -> array contract enforced
{
  const input = {
    prompt: 'Thủ đô của Việt Nam là gì?',
    question_type: 'single_choice',
    options: ['Hà Nội', 'Đà Nẵng', 'TP. Hồ Chí Minh', 'Cần Thơ'],
    correct_answer: 'A'
  };
  const payload = toQuestionBankPayload(input, { role: 'teacher' });

  assert.equal(Array.isArray(payload.options), true);
  assert.equal(Array.isArray(payload.hints), true);
  assert.equal(Array.isArray(payload.tags), true);
  assert.equal(Array.isArray(payload.media_urls), true);

  assert.notEqual(payload.options, null);
  assert.notEqual(payload.hints, null);
  assert.notEqual(payload.tags, null);
  assert.notEqual(payload.media_urls, null);

  assert.equal(payload.options.length, 4);
  assert.deepEqual(payload.hints, []);
  assert.deepEqual(payload.tags, []);
  assert.deepEqual(payload.media_urls, []);
  console.log('PASS Test 13: single_choice without tags/hints/media_urls -> array contract enforced');
}

// 14. Regression: fill_blank without tags/options/hints/media_urls -> array contract enforced
{
  const input = {
    prompt: 'Số chẵn nhỏ nhất có một chữ số là [_____]',
    question_type: 'fill_blank',
    correct_answer: '0'
  };
  const payload = toQuestionBankPayload(input, { role: 'teacher' });

  assert.equal(Array.isArray(payload.options), true);
  assert.equal(Array.isArray(payload.hints), true);
  assert.equal(Array.isArray(payload.tags), true);
  assert.equal(Array.isArray(payload.media_urls), true);

  assert.notEqual(payload.options, null);
  assert.notEqual(payload.hints, null);
  assert.notEqual(payload.tags, null);
  assert.notEqual(payload.media_urls, null);

  assert.deepEqual(payload.options, []);
  assert.deepEqual(payload.hints, []);
  assert.deepEqual(payload.tags, []);
  assert.deepEqual(payload.media_urls, []);
  console.log('PASS Test 14: fill_blank without tags/options/hints/media_urls -> array contract enforced');
}

// 15. Regression: essay without tags/options/hints/media_urls -> array contract enforced
{
  const input = {
    prompt: 'Em hãy viết đoạn văn ngắn tả một loài hoa em yêu thích.',
    question_type: 'essay',
    explanation: 'Tiêu chí: mở đoạn, thân đoạn, kết đoạn.'
  };
  const payload = toQuestionBankPayload(input, { role: 'teacher' });

  assert.equal(Array.isArray(payload.options), true);
  assert.equal(Array.isArray(payload.hints), true);
  assert.equal(Array.isArray(payload.tags), true);
  assert.equal(Array.isArray(payload.media_urls), true);

  assert.notEqual(payload.options, null);
  assert.notEqual(payload.hints, null);
  assert.notEqual(payload.tags, null);
  assert.notEqual(payload.media_urls, null);

  assert.deepEqual(payload.options, []);
  assert.deepEqual(payload.hints, []);
  assert.deepEqual(payload.tags, []);
  assert.deepEqual(payload.media_urls, []);
  console.log('PASS Test 15: essay without tags/options/hints/media_urls -> array contract enforced');
}

// 16. Duplicate key: Same prompt/type/subject/grade/visibility -> duplicate
{
  const q1 = { prompt: '3 + 4 = ?', question_type: 'single_choice', subject: 'Toán', grade_level: 1, visibility: 'private' };
  const q2 = { prompt: '3 + 4 = ?', question_type: 'single_choice', subject: 'Toán', grade_level: 1, visibility: 'private' };
  const key1 = buildQuestionDuplicateKey(q1);
  const key2 = buildQuestionDuplicateKey(q2);
  assert.notEqual(key1, null);
  assert.equal(key1, key2);
  console.log('PASS Test 16 (Case A): Same prompt/type/subject/grade/visibility -> duplicate');
}

// 17. Duplicate key: Different whitespace/case in prompt -> duplicate
{
  const q1 = { prompt: '3 + 4 bằng bao nhiêu?', question_type: 'single_choice', subject: 'Toán', grade_level: 1, visibility: 'private' };
  const q2 = { prompt: '  3 + 4 BẰNG bao nhiêu?  ', question_type: 'single_choice', subject: 'Toán', grade_level: 1, visibility: 'private' };
  const key1 = buildQuestionDuplicateKey(q1);
  const key2 = buildQuestionDuplicateKey(q2);
  assert.equal(key1, key2);
  console.log('PASS Test 17 (Case B): Different whitespace/case in prompt -> duplicate');
}

// 18. Duplicate key: Same prompt but grade 1 vs grade 2 -> NOT duplicate
{
  const q1 = { prompt: 'Tính 10 + 20', question_type: 'single_choice', subject: 'Toán', grade_level: 1, visibility: 'private' };
  const q2 = { prompt: 'Tính 10 + 20', question_type: 'single_choice', subject: 'Toán', grade_level: 2, visibility: 'private' };
  const key1 = buildQuestionDuplicateKey(q1);
  const key2 = buildQuestionDuplicateKey(q2);
  assert.notEqual(key1, key2);
  console.log('PASS Test 18 (Case C): Same prompt but grade 1 vs grade 2 -> NOT duplicate');
}

// 19. Duplicate key: Same prompt but subject different -> NOT duplicate
{
  const q1 = { prompt: 'Điền từ còn thiếu vào chỗ trống', question_type: 'fill_blank', subject: 'Tiếng Việt', grade_level: 2, visibility: 'private' };
  const q2 = { prompt: 'Điền từ còn thiếu vào chỗ trống', question_type: 'fill_blank', subject: 'Tiếng Anh', grade_level: 2, visibility: 'private' };
  const key1 = buildQuestionDuplicateKey(q1);
  const key2 = buildQuestionDuplicateKey(q2);
  assert.notEqual(key1, key2);
  console.log('PASS Test 19 (Case D): Same prompt but subject different -> NOT duplicate');
}

// 20. Duplicate key: Same prompt but question_type different -> NOT duplicate
{
  const q1 = { prompt: 'Mặt trời mọc ở hướng nào?', question_type: 'single_choice', subject: 'Khoa học', grade_level: 3, visibility: 'private' };
  const q2 = { prompt: 'Mặt trời mọc ở hướng nào?', question_type: 'short_answer', subject: 'Khoa học', grade_level: 3, visibility: 'private' };
  const key1 = buildQuestionDuplicateKey(q1);
  const key2 = buildQuestionDuplicateKey(q2);
  assert.notEqual(key1, key2);
  console.log('PASS Test 20 (Case E): Same prompt but question_type different -> NOT duplicate');
}

// 21. Duplicate key: Same prompt but visibility private vs public_template -> NOT duplicate
{
  const q1 = { prompt: 'Câu hỏi mẫu', question_type: 'essay', subject: 'Toán', grade_level: 4, visibility: 'private' };
  const q2 = { prompt: 'Câu hỏi mẫu', question_type: 'essay', subject: 'Toán', grade_level: 4, visibility: 'public_template' };
  const key1 = buildQuestionDuplicateKey(q1);
  const key2 = buildQuestionDuplicateKey(q2);
  assert.notEqual(key1, key2);
  console.log('PASS Test 21 (Case F): Same prompt but visibility private vs public_template -> NOT duplicate');
}

// 22. findExistingQuestionDuplicateIndices: 4 Excel candidates match 4 existing Word-equivalent questions -> duplicate size = 4
{
  const candidates = [
    { prompt: 'Câu 1: 1 + 1 = ?', question_type: 'single_choice' },
    { prompt: 'Câu 2: 2 + 2 = ?', question_type: 'single_choice' },
    { prompt: 'Câu 3: 3 + 3 = ?', question_type: 'single_choice' },
    { prompt: 'Câu 4: 4 + 4 = ?', question_type: 'single_choice' }
  ];

  const existingBank = [
    { prompt: '  câu 1: 1 + 1 = ?  ', question_type: 'single_choice', subject: 'Toán', grade_level: 1, visibility: 'private' },
    { prompt: 'câu 2: 2 + 2 = ?', question_type: 'single_choice', subject: 'Toán', grade_level: 1, visibility: 'private' },
    { prompt: 'câu 3: 3 + 3 = ?', question_type: 'single_choice', subject: 'Toán', grade_level: 1, visibility: 'private' },
    { prompt: 'câu 4: 4 + 4 = ?', question_type: 'single_choice', subject: 'Toán', grade_level: 1, visibility: 'private' }
  ];

  const dupes = findExistingQuestionDuplicateIndices(
    candidates,
    existingBank,
    { subject: 'Toán', grade_level: 1, visibility: 'private' },
    'teacher'
  );

  assert.equal(dupes.size, 4);
  assert.equal(dupes.has(0), true);
  assert.equal(dupes.has(1), true);
  assert.equal(dupes.has(2), true);
  assert.equal(dupes.has(3), true);
  console.log('PASS Test 22 (Case G): 4 Excel candidates match 4 existing Word questions -> duplicate indices size = 4');
}

// 23. findExistingQuestionDuplicateIndices: 1 new + 3 existing -> only 1 available
{
  const candidates = [
    { prompt: 'Câu cũ 1', question_type: 'single_choice' },
    { prompt: 'Câu mới 2', question_type: 'single_choice' },
    { prompt: 'Câu cũ 3', question_type: 'single_choice' },
    { prompt: 'Câu cũ 4', question_type: 'single_choice' }
  ];

  const existingBank = [
    { prompt: 'câu cũ 1', question_type: 'single_choice', subject: 'Tiếng Việt', grade_level: 2, visibility: 'private' },
    { prompt: 'câu cũ 3', question_type: 'single_choice', subject: 'Tiếng Việt', grade_level: 2, visibility: 'private' },
    { prompt: 'câu cũ 4', question_type: 'single_choice', subject: 'Tiếng Việt', grade_level: 2, visibility: 'private' }
  ];

  const dupes = findExistingQuestionDuplicateIndices(
    candidates,
    existingBank,
    { subject: 'Tiếng Việt', grade_level: 2, visibility: 'private' },
    'teacher'
  );

  assert.equal(dupes.size, 3);
  assert.equal(dupes.has(0), true);
  assert.equal(dupes.has(1), false); // Câu mới 2 khả dụng
  assert.equal(dupes.has(2), true);
  assert.equal(dupes.has(3), true);
  console.log('PASS Test 23 (Case H): 1 new + 3 existing -> only new question available');
}

console.log('=== ALL 23 TESTS PASSED SUCCESSFULLY! ===');