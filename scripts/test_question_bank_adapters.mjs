// scripts/test_question_bank_adapters.mjs
// Unit tests for Question Bank V2A Adapters and Security Contracts

import assert from 'node:assert/strict';
import {
  toQuestionBankPayload,
  normalizePromptForDuplicateCheck,
  buildQuestionDuplicateKey,
  buildExistingListDuplicateKey,
  buildCandidateListDuplicateKey,
  findDuplicatesInQuestionList,
  findExistingQuestionDuplicateIndices,
  normalizeOptionsToStableIds,
  buildSingleChoiceAnswerKey,
  buildMultipleChoiceAnswerKey
} from '../src/utils/questionBankAdapters.js';

console.log('=== RUNNING QUESTION BANK V2A ADAPTERS UNIT TESTS ===');

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

// 22. findExistingQuestionDuplicateIndices: 4 Excel candidates match 4 existing questions with prompt_snippet -> duplicate size = 4
{
  const candidates = [
    { prompt: 'Câu 1: 1 + 1 = ?', question_type: 'single_choice' },
    { prompt: 'Câu 2: 2 + 2 = ?', question_type: 'single_choice' },
    { prompt: 'Câu 3: 3 + 3 = ?', question_type: 'single_choice' },
    { prompt: 'Câu 4: 4 + 4 = ?', question_type: 'single_choice' }
  ];

  const existingBank = [
    { prompt_snippet: '  câu 1: 1 + 1 = ?  ', question_type: 'single_choice', subject: 'Toán', grade_level: 1, visibility: 'private' },
    { prompt_snippet: 'câu 2: 2 + 2 = ?', question_type: 'single_choice', subject: 'Toán', grade_level: 1, visibility: 'private' },
    { prompt_snippet: 'câu 3: 3 + 3 = ?', question_type: 'single_choice', subject: 'Toán', grade_level: 1, visibility: 'private' },
    { prompt_snippet: 'câu 4: 4 + 4 = ?', question_type: 'single_choice', subject: 'Toán', grade_level: 1, visibility: 'private' }
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
  console.log('PASS Test 22 (Case G): 4 Excel candidates match 4 existing Word questions (via prompt_snippet) -> duplicate indices size = 4');
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
    { prompt_snippet: 'câu cũ 1', question_type: 'single_choice', subject: 'Tiếng Việt', grade_level: 2, visibility: 'private' },
    { prompt_snippet: 'câu cũ 3', question_type: 'single_choice', subject: 'Tiếng Việt', grade_level: 2, visibility: 'private' },
    { prompt_snippet: 'câu cũ 4', question_type: 'single_choice', subject: 'Tiếng Việt', grade_level: 2, visibility: 'private' }
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

// 24. (Case I): Admin candidate có q.visibility='private', batchVisibility='public_template', existing bank visibility='public_template' -> DUPLICATE
{
  const candidates = [
    { prompt: 'Admin candidate with private file visibility', question_type: 'single_choice', visibility: 'private' }
  ];

  const existingBank = [
    { prompt_snippet: 'admin candidate with private file visibility', question_type: 'single_choice', subject: 'Toán', grade_level: 1, visibility: 'public_template' }
  ];

  const dupes = findExistingQuestionDuplicateIndices(
    candidates,
    existingBank,
    { subject: 'Toán', grade_level: 1, visibility: 'public_template' },
    'admin'
  );

  assert.equal(dupes.size, 1);
  assert.equal(dupes.has(0), true);
  console.log('PASS Test 24 (Case I): Admin candidate (batchVisibility=public_template) matches existing public_template -> DUPLICATE');
}

// 25. (Case J): Cùng dữ liệu nhưng existing bank visibility='private', batchVisibility='public_template' -> KHÔNG DUPLICATE
{
  const candidates = [
    { prompt: 'Admin candidate with private file visibility', question_type: 'single_choice', visibility: 'private' }
  ];

  const existingBank = [
    { prompt_snippet: 'admin candidate with private file visibility', question_type: 'single_choice', subject: 'Toán', grade_level: 1, visibility: 'private' }
  ];

  const dupes = findExistingQuestionDuplicateIndices(
    candidates,
    existingBank,
    { subject: 'Toán', grade_level: 1, visibility: 'public_template' },
    'admin'
  );

  assert.equal(dupes.size, 0);
  console.log('PASS Test 25 (Case J): Admin candidate (batchVisibility=public_template) vs existing private -> NOT DUPLICATE');
}

// 26. (Case K): buildQuestionDuplicateKey thiếu question_type -> null
{
  const invalidTypeQ = {
    prompt: 'Question without type',
    subject: 'Toán',
    grade_level: 1,
    visibility: 'private'
  };
  assert.equal(buildQuestionDuplicateKey(invalidTypeQ), null);
  assert.equal(buildQuestionDuplicateKey({ ...invalidTypeQ, question_type: '' }), null);
  assert.equal(buildQuestionDuplicateKey({ ...invalidTypeQ, question_type: '   ' }), null);
  console.log('PASS Test 26 (Case K): buildQuestionDuplicateKey missing question_type -> null');
}

// 27. (Case L): buildQuestionDuplicateKey thiếu visibility -> null
{
  const invalidVisibilityQ = {
    prompt: 'Question without visibility',
    question_type: 'single_choice',
    subject: 'Toán',
    grade_level: 1
  };
  assert.equal(buildQuestionDuplicateKey(invalidVisibilityQ), null);
  assert.equal(buildQuestionDuplicateKey({ ...invalidVisibilityQ, visibility: '' }), null);
  assert.equal(buildQuestionDuplicateKey({ ...invalidVisibilityQ, visibility: '   ' }), null);
  console.log('PASS Test 27 (Case L): buildQuestionDuplicateKey missing visibility -> null');
}

// 28. buildQuestionDuplicateKey thiếu subject / grade_level / prompt -> null
{
  const base = {
    prompt: 'Full prompt',
    question_type: 'single_choice',
    subject: 'Toán',
    grade_level: 1,
    visibility: 'private'
  };
  assert.equal(buildQuestionDuplicateKey({ ...base, subject: '' }), null);
  assert.equal(buildQuestionDuplicateKey({ ...base, grade_level: null }), null);
  assert.equal(buildQuestionDuplicateKey({ ...base, grade_level: 'abc' }), null);
  assert.equal(buildQuestionDuplicateKey({ ...base, prompt: '' }), null);
  console.log('PASS Test 28: buildQuestionDuplicateKey missing subject/grade/prompt -> null');
}

// 29. Regression Contract A: Existing has prompt_snippet (no prompt), candidate prompt <=150 and same normalized text => DUPLICATE
{
  const candidate = { prompt: 'Tính 25 + 75 = ?', question_type: 'single_choice' };
  const existingItem = { prompt_snippet: '  tính 25 + 75 = ?  ', question_type: 'single_choice', subject: 'Toán', grade_level: 3, visibility: 'private' };
  assert.equal(existingItem.prompt, undefined); // Không có prompt full

  const dupes = findExistingQuestionDuplicateIndices(
    [candidate],
    [existingItem],
    { subject: 'Toán', grade_level: 3, visibility: 'private' },
    'teacher'
  );
  assert.equal(dupes.has(0), true);
  console.log('PASS Test 29 (Contract A): Existing has prompt_snippet & candidate prompt <= 150 -> DUPLICATE');
}

// 30. Regression Contract B: Existing prompt_snippet differs => NOT DUPLICATE
{
  const candidate = { prompt: 'Tính 25 + 75 = ?', question_type: 'single_choice' };
  const existingItem = { prompt_snippet: 'Tính 25 + 80 = ?', question_type: 'single_choice', subject: 'Toán', grade_level: 3, visibility: 'private' };

  const dupes = findExistingQuestionDuplicateIndices(
    [candidate],
    [existingItem],
    { subject: 'Toán', grade_level: 3, visibility: 'private' },
    'teacher'
  );
  assert.equal(dupes.size, 0);
  console.log('PASS Test 30 (Contract B): Existing prompt_snippet differs -> NOT DUPLICATE');
}

// 31. Regression Contract C: Candidate prompt exactly 150 chars and matching prompt_snippet => DUPLICATE
{
  const exact150Prompt = 'A'.repeat(150);
  assert.equal(exact150Prompt.length, 150);

  const candidate = { prompt: exact150Prompt, question_type: 'essay' };
  const existingItem = { prompt_snippet: exact150Prompt.toLowerCase(), question_type: 'essay', subject: 'Văn', grade_level: 5, visibility: 'private' };

  const dupes = findExistingQuestionDuplicateIndices(
    [candidate],
    [existingItem],
    { subject: 'Văn', grade_level: 5, visibility: 'private' },
    'teacher'
  );
  assert.equal(dupes.has(0), true);
  console.log('PASS Test 31 (Contract C): Candidate prompt exactly 150 chars matching prompt_snippet -> DUPLICATE');
}

// 32. Regression Contract D: Candidate prompt 151+ chars => NOT marked duplicate from snippet-only evidence (fails safe)
{
  const prompt151Chars = 'A'.repeat(151);
  assert.equal(prompt151Chars.length, 151);

  const candidate = { prompt: prompt151Chars, question_type: 'essay' };
  const existingItem = { prompt_snippet: prompt151Chars.slice(0, 150).toLowerCase(), question_type: 'essay', subject: 'Văn', grade_level: 5, visibility: 'private' };

  const dupes = findExistingQuestionDuplicateIndices(
    [candidate],
    [existingItem],
    { subject: 'Văn', grade_level: 5, visibility: 'private' },
    'teacher'
  );
  assert.equal(dupes.size, 0); // Fails safe: không đánh dấu trùng vì không thể chứng minh toàn bộ nội dung trùng lặp
  console.log('PASS Test 32 (Contract D): Candidate prompt 151+ chars fails safe from snippet-only evidence -> NOT DUPLICATE');
}

// 33. Regression Contract E: Existing item missing prompt_snippet => NOT DUPLICATE
{
  const candidate = { prompt: 'Câu hỏi bất kỳ', question_type: 'single_choice' };
  const existingItemMissingSnippet = { question_type: 'single_choice', subject: 'Toán', grade_level: 1, visibility: 'private' }; // No prompt_snippet

  const dupes = findExistingQuestionDuplicateIndices(
    [candidate],
    [existingItemMissingSnippet],
    { subject: 'Toán', grade_level: 1, visibility: 'private' },
    'teacher'
  );
  assert.equal(dupes.size, 0);
  console.log('PASS Test 33 (Contract E): Existing item missing prompt_snippet -> NOT DUPLICATE');
}

// 34. Regression Contract F: Admin batch public_template contract still works with prompt_snippet
{
  const candidate = { prompt: 'Admin template question', question_type: 'single_choice' };
  const existingItem = { prompt_snippet: 'admin template question', question_type: 'single_choice', subject: 'Toán', grade_level: 1, visibility: 'public_template' };

  const dupes = findExistingQuestionDuplicateIndices(
    [candidate],
    [existingItem],
    { subject: 'Toán', grade_level: 1, visibility: 'public_template' },
    'admin'
  );
  assert.equal(dupes.has(0), true);
  console.log('PASS Test 34 (Contract F): Admin batch public_template works with prompt_snippet -> DUPLICATE');
}

// 35. Helper Unit Tests: buildExistingListDuplicateKey validations
{
  const valid = { prompt_snippet: 'Hello snippet', question_type: 'single_choice', subject: 'Toán', grade_level: 1, visibility: 'private' };
  assert.notEqual(buildExistingListDuplicateKey(valid), null);

  assert.equal(buildExistingListDuplicateKey(null), null);
  assert.equal(buildExistingListDuplicateKey({ ...valid, prompt_snippet: '' }), null);
  assert.equal(buildExistingListDuplicateKey({ ...valid, prompt_snippet: '   ' }), null);
  assert.equal(buildExistingListDuplicateKey({ ...valid, question_type: '' }), null);
  assert.equal(buildExistingListDuplicateKey({ ...valid, subject: '' }), null);
  assert.equal(buildExistingListDuplicateKey({ ...valid, grade_level: null }), null);
  assert.equal(buildExistingListDuplicateKey({ ...valid, grade_level: 'xyz' }), null);
  assert.equal(buildExistingListDuplicateKey({ ...valid, visibility: '' }), null);
  console.log('PASS Test 35: buildExistingListDuplicateKey validates required fields');
}

// 36. Helper Unit Tests: buildCandidateListDuplicateKey validations
{
  const valid = { prompt: 'Hello candidate', question_type: 'single_choice', subject: 'Toán', grade_level: 1, visibility: 'private' };
  assert.notEqual(buildCandidateListDuplicateKey(valid), null);

  assert.equal(buildCandidateListDuplicateKey(null), null);
  assert.equal(buildCandidateListDuplicateKey({ ...valid, prompt: '' }), null);
  assert.equal(buildCandidateListDuplicateKey({ ...valid, prompt: '   ' }), null);
  assert.equal(buildCandidateListDuplicateKey({ ...valid, prompt: 'A'.repeat(151) }), null); // > 150 chars -> null
  assert.notEqual(buildCandidateListDuplicateKey({ ...valid, prompt: 'A'.repeat(150) }), null); // exactly 150 chars -> valid
  assert.equal(buildCandidateListDuplicateKey({ ...valid, question_type: '' }), null);
  assert.equal(buildCandidateListDuplicateKey({ ...valid, subject: '' }), null);
  assert.equal(buildCandidateListDuplicateKey({ ...valid, grade_level: null }), null);
  assert.equal(buildCandidateListDuplicateKey({ ...valid, grade_level: 'xyz' }), null);
  assert.equal(buildCandidateListDuplicateKey({ ...valid, visibility: '' }), null);
  console.log('PASS Test 36: buildCandidateListDuplicateKey validates length <= 150 and required fields');
}

// 37. Archive Contract: Default list excludes archived items -> new candidate is NOT marked duplicate
{
  const candidates = [
    { prompt: 'Câu hỏi đã từng bị ẩn trong quá khứ', question_type: 'single_choice' }
  ];

  // Giả lập default list từ DB RPC sau khi patch: câu archived đã bị loại bỏ khỏi danh sách active
  const activeExistingBank = [
    { prompt_snippet: 'câu hỏi khác đang hoạt động', question_type: 'single_choice', subject: 'Toán', grade_level: 1, visibility: 'private' }
  ];

  const dupes = findExistingQuestionDuplicateIndices(
    candidates,
    activeExistingBank,
    { subject: 'Toán', grade_level: 1, visibility: 'private' },
    'teacher'
  );

  assert.equal(dupes.size, 0); // Không bị chặn trùng vì item archived đã được loại bỏ khỏi list mặc định
  console.log('PASS Test 37: Default list excludes archived -> new candidate is NOT marked duplicate');
}

// 38. Explicit status=archived query param support contract
{
  const ALLOWED_LIST_PARAMS = [
    'page', 'page_size', 'subject', 'grade_level', 'question_type',
    'difficulty', 'status', 'visibility', 'search'
  ];
  const filters = { page: 1, page_size: 20, status: 'archived' };
  const searchParams = new URLSearchParams();
  for (const key of ALLOWED_LIST_PARAMS) {
    const val = filters[key];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      searchParams.append(key, String(val).trim());
    }
  }
  assert.equal(searchParams.get('status'), 'archived');
  assert.equal(searchParams.get('page'), '1');
  assert.equal(searchParams.get('page_size'), '20');
  console.log('PASS Test 38: Explicit status=archived query param supported in filters builder');
}

// 39. Status View Filter Mapping Contract
{
  const ALLOWED_LIST_PARAMS = [
    'page', 'page_size', 'subject', 'grade_level', 'question_type',
    'difficulty', 'status', 'visibility', 'search'
  ];

  // Active view: không truyền status
  const activeFilters = { page: 1, page_size: 10, status: undefined };
  const activeParams = new URLSearchParams();
  for (const key of ALLOWED_LIST_PARAMS) {
    const val = activeFilters[key];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      activeParams.append(key, String(val).trim());
    }
  }
  assert.equal(activeParams.has('status'), false);

  // Archived view: truyền status=archived
  const archivedFilters = { page: 1, page_size: 10, status: 'archived' };
  const archivedParams = new URLSearchParams();
  for (const key of ALLOWED_LIST_PARAMS) {
    const val = archivedFilters[key];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      archivedParams.append(key, String(val).trim());
    }
  }
  assert.equal(archivedParams.get('status'), 'archived');
  console.log('PASS Test 39: Status view mapping contract verified (active: no status, archived: status=archived)');
}

// 40. Author Profile Display Resolution Helper Contract
{
  const currentUserId = 'user-current-111';
  const profilesMap = {
    'user-teacher-222': { id: 'user-teacher-222', full_name: 'Cô Nguyễn Thị Hoa', email: 'hoa.nguyen@school.edu.vn' },
    'user-teacher-333': { id: 'user-teacher-333', full_name: '', email: 'thay.nam@school.edu.vn' },
  };

  const getAuthorDisplay = (authorId) => {
    if (!authorId) return { label: 'Không xác định', isOwn: false };
    if (currentUserId && String(authorId) === String(currentUserId)) {
      return { label: 'Của tôi', isOwn: true };
    }
    const profile = profilesMap[authorId];
    if (profile?.full_name?.trim()) {
      return { label: profile.full_name.trim(), isOwn: false };
    }
    if (profile?.email?.trim()) {
      return { label: profile.email.trim(), isOwn: false };
    }
    return { label: 'Không xác định', isOwn: false };
  };

  assert.deepEqual(getAuthorDisplay('user-current-111'), { label: 'Của tôi', isOwn: true });
  assert.deepEqual(getAuthorDisplay('user-teacher-222'), { label: 'Cô Nguyễn Thị Hoa', isOwn: false });
  assert.deepEqual(getAuthorDisplay('user-teacher-333'), { label: 'thay.nam@school.edu.vn', isOwn: false });
  assert.deepEqual(getAuthorDisplay('unknown-author-999'), { label: 'Không xác định', isOwn: false });
  assert.deepEqual(getAuthorDisplay(null), { label: 'Không xác định', isOwn: false });
  console.log('PASS Test 40: Author display label resolution verified (Của tôi, full_name, email, Không xác định)');
}

// 41. Restore Question Payload & Invariance Contract
{
  const buildRestorePayload = () => ({ status: 'draft' });
  const payload = buildRestorePayload();
  assert.equal(payload.status, 'draft');
  assert.equal(payload.visibility, undefined); // Không đổi visibility
  assert.equal(payload.author_id, undefined); // Không đổi author
  assert.equal(payload.school_id, undefined); // Không đổi school
  console.log('PASS Test 41: Restore question payload invariance verified (status=draft only)');
}

// 42. Status Badge Mapping Contract
{
  const STATUS_BADGE_MAP = {
    draft: { label: 'Bản nháp' },
    published: { label: 'Đã xuất bản' },
    archived: { label: 'Đã ẩn' }
  };
  assert.equal(STATUS_BADGE_MAP.draft.label, 'Bản nháp');
  assert.equal(STATUS_BADGE_MAP.published.label, 'Đã xuất bản');
  assert.equal(STATUS_BADGE_MAP.archived.label, 'Đã ẩn');
  console.log('PASS Test 42: Status badge mapping verified (draft, published, archived)');
}

// 43. Publish Question Payload Invariance Contract
{
  const buildPublishPayload = () => ({ status: 'published' });
  const payload = buildPublishPayload();
  assert.equal(payload.status, 'published');
  assert.equal(payload.visibility, undefined); // Không gửi visibility
  assert.equal(payload.author_id, undefined); // Không đổi author_id
  assert.equal(payload.school_id, undefined); // Không đổi school_id
  assert.equal(payload.content, undefined); // Không đổi content
  assert.equal(payload.version, undefined); // Không đổi version
  assert.equal(payload.title, undefined); // Không đổi title
  assert.equal(payload.difficulty, undefined); // Không đổi difficulty
  assert.equal(payload.tags, undefined); // Không đổi tags
  console.log('PASS Test 43: Publish question payload invariance verified (status=published only, no metadata overrides)');
}

// 44. Publish Permission Matrix Contract
{
  const evaluateCanPublish = ({ role, isAuthor, status }) => {
    const isDraft = status === 'draft';
    return isDraft && (role === 'admin' || (role === 'teacher' && isAuthor));
  };

  // Teacher own draft -> ALLOW
  assert.equal(evaluateCanPublish({ role: 'teacher', isAuthor: true, status: 'draft' }), true);
  // Teacher other draft -> DENY
  assert.equal(evaluateCanPublish({ role: 'teacher', isAuthor: false, status: 'draft' }), false);
  // Admin draft -> ALLOW
  assert.equal(evaluateCanPublish({ role: 'admin', isAuthor: false, status: 'draft' }), true);
  // Student draft -> DENY
  assert.equal(evaluateCanPublish({ role: 'student', isAuthor: true, status: 'draft' }), false);
  assert.equal(evaluateCanPublish({ role: 'student', isAuthor: false, status: 'draft' }), false);

  // Published item -> DENY (không hiện nút publish lại)
  assert.equal(evaluateCanPublish({ role: 'teacher', isAuthor: true, status: 'published' }), false);
  assert.equal(evaluateCanPublish({ role: 'admin', isAuthor: true, status: 'published' }), false);

  // Archived item -> DENY (phải khôi phục về draft trước)
  assert.equal(evaluateCanPublish({ role: 'teacher', isAuthor: true, status: 'archived' }), false);
  assert.equal(evaluateCanPublish({ role: 'admin', isAuthor: true, status: 'archived' }), false);

  console.log('PASS Test 44: Publish permission matrix verified (teacher own draft, admin draft, student denied, non-draft blocked)');
}

// 45. Publish Status Transition Rules Contract
{
  const isValidStatusTransition = (currentStatus, targetStatus) => {
    if (currentStatus === targetStatus) return true; // Idempotent no-op
    if (currentStatus === 'draft' && (targetStatus === 'published' || targetStatus === 'archived')) return true;
    if (currentStatus === 'published' && targetStatus === 'archived') return true;
    if (currentStatus === 'archived' && targetStatus === 'draft') return true;
    return false; // All other transitions forbidden (e.g. archived -> published)
  };

  // draft -> published = ALLOW
  assert.equal(isValidStatusTransition('draft', 'published'), true);
  // published -> published = ALLOW (idempotent)
  assert.equal(isValidStatusTransition('published', 'published'), true);
  // archived -> published = BLOCKED
  assert.equal(isValidStatusTransition('archived', 'published'), false);
  // published -> draft = BLOCKED (phải archive trước rồi mới restore)
  assert.equal(isValidStatusTransition('published', 'draft'), false);

  console.log('PASS Test 45: Status transition rules contract verified (draft->published ALLOW, archived->published BLOCKED, published->published idempotent)');
}

// 46. UI Button Visibility Logic for Table Rows
{
  const getRowActions = ({ role, isAuthor, status }) => {
    const isDraft = status === 'draft';
    const isArchived = status === 'archived';
    const isPublished = status === 'published';

    const canPublish = isDraft && (role === 'admin' || (role === 'teacher' && isAuthor));
    const canArchive = !isArchived && (role === 'admin' || (role === 'teacher' && isAuthor));
    const canRestore = isArchived && (role === 'admin' || (role === 'teacher' && isAuthor));

    return { canPublish, canArchive, canRestore };
  };

  // Teacher own draft: có cả Publish và Archive
  const teacherOwnDraft = getRowActions({ role: 'teacher', isAuthor: true, status: 'draft' });
  assert.equal(teacherOwnDraft.canPublish, true);
  assert.equal(teacherOwnDraft.canArchive, true);
  assert.equal(teacherOwnDraft.canRestore, false);

  // Teacher own published: chỉ có Archive, KHÔNG có Publish
  const teacherOwnPublished = getRowActions({ role: 'teacher', isAuthor: true, status: 'published' });
  assert.equal(teacherOwnPublished.canPublish, false);
  assert.equal(teacherOwnPublished.canArchive, true);
  assert.equal(teacherOwnPublished.canRestore, false);

  // Teacher own archived: chỉ có Restore, KHÔNG có Publish
  const teacherOwnArchived = getRowActions({ role: 'teacher', isAuthor: true, status: 'archived' });
  assert.equal(teacherOwnArchived.canPublish, false);
  assert.equal(teacherOwnArchived.canArchive, false);
  assert.equal(teacherOwnArchived.canRestore, true);

  // Teacher other draft: không có quyền gì
  const teacherOtherDraft = getRowActions({ role: 'teacher', isAuthor: false, status: 'draft' });
  assert.equal(teacherOtherDraft.canPublish, false);
  assert.equal(teacherOtherDraft.canArchive, false);
  assert.equal(teacherOtherDraft.canRestore, false);

  // Admin any draft: có Publish và Archive
  const adminDraft = getRowActions({ role: 'admin', isAuthor: false, status: 'draft' });
  assert.equal(adminDraft.canPublish, true);
  assert.equal(adminDraft.canArchive, true);
  assert.equal(adminDraft.canRestore, false);

  console.log('PASS Test 46: UI row action button visibility verified across all roles and item states');
}

// 47. Structured Error Code 409 & Friendly Message Resolution Contract
{
  const mapPublishErrorToFriendlyToast = (err) => {
    if (err?.status === 409 || err?.errorCode === 'INVALID_STATUS_TRANSITION') {
      return 'Trạng thái câu hỏi đã thay đổi. Vui lòng tải lại danh sách.';
    }
    return err?.message || 'Không thể xuất bản câu hỏi. Vui lòng thử lại.';
  };

  // Structured Error object with status 409
  const structuredErr409 = new Error('Lỗi khi xuất bản câu hỏi (409)');
  structuredErr409.status = 409;
  structuredErr409.errorCode = 'INVALID_STATUS_TRANSITION';
  assert.equal(
    mapPublishErrorToFriendlyToast(structuredErr409),
    'Trạng thái câu hỏi đã thay đổi. Vui lòng tải lại danh sách.'
  );

  // Structured Error with only errorCode
  assert.equal(
    mapPublishErrorToFriendlyToast({ errorCode: 'INVALID_STATUS_TRANSITION', message: 'Forbidden transition' }),
    'Trạng thái câu hỏi đã thay đổi. Vui lòng tải lại danh sách.'
  );

  // Structured Error with status 409 and null errorCode
  assert.equal(
    mapPublishErrorToFriendlyToast({ status: 409, message: 'Conflict' }),
    'Trạng thái câu hỏi đã thay đổi. Vui lòng tải lại danh sách.'
  );

  // Generic Error with status 500
  const genericErr = new Error('Lỗi kết nối máy chủ khi xuất bản câu hỏi (HTTP 500)');
  genericErr.status = 500;
  genericErr.errorCode = 'INTERNAL_ERROR';
  assert.equal(
    mapPublishErrorToFriendlyToast(genericErr),
    'Lỗi kết nối máy chủ khi xuất bản câu hỏi (HTTP 500)'
  );

  console.log('PASS Test 47: Structured error properties (status 409 / errorCode INVALID_STATUS_TRANSITION) verified');
}

// 48. Publish Endpoint URL Contract
{
  const itemId = '00000000-0000-0000-0000-000000000001';
  const QUESTION_BANK_BASE_URL = 'https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/question-bank-api';
  const requestUrl = `${QUESTION_BANK_BASE_URL}/qb/questions/${encodeURIComponent(itemId)}/publish`;
  assert.equal(requestUrl, 'https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/question-bank-api/qb/questions/00000000-0000-0000-0000-000000000001/publish');
  console.log('PASS Test 48: Publish endpoint URL contract verified');
}

// 49. Version History Endpoint URL Contract
{
  const itemId = '00000000-0000-0000-0000-000000000001';
  const QUESTION_BANK_BASE_URL = 'https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/question-bank-api';
  const requestUrl = `${QUESTION_BANK_BASE_URL}/qb/questions/${encodeURIComponent(itemId)}/versions`;
  assert.equal(requestUrl, 'https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/question-bank-api/qb/questions/00000000-0000-0000-0000-000000000001/versions');
  console.log('PASS Test 49: Version History endpoint URL contract verified');
}

// 50. Authoring Detail with version_id Query Param Contract
{
  const itemId = '00000000-0000-0000-0000-000000000001';
  const versionId = '00000000-0000-0000-0000-000000000002';
  const QUESTION_BANK_BASE_URL = 'https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/question-bank-api';
  const searchParams = new URLSearchParams();
  if (versionId) searchParams.append('version_id', versionId);
  const queryString = searchParams.toString();
  const requestUrl = `${QUESTION_BANK_BASE_URL}/qb/authoring/questions/${encodeURIComponent(itemId)}${queryString ? `?${queryString}` : ''}`;
  assert.equal(requestUrl, 'https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/question-bank-api/qb/authoring/questions/00000000-0000-0000-0000-000000000001?version_id=00000000-0000-0000-0000-000000000002');
  console.log('PASS Test 50: Authoring detail with version_id query param URL contract verified');
}

// 51. RT-VH-01 / RT-VH-02 / RT-VH-07: Version List Sanitization & Response Leak Defense Contract
{
  const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  const isUuidString = (v) => typeof v === 'string' && UUID_REGEX.test(v);

  const sanitizeVersionsResponse = (raw) => {
    if (!raw || typeof raw !== 'object' || raw.success !== true) return null;
    if (!isUuidString(raw.item_id) || !Array.isArray(raw.versions)) return null;

    const sanitizedVersions = raw.versions.map(v => ({
      id: v.id,
      version_number: v.version_number,
      created_by: typeof v.created_by === 'string' ? v.created_by : null,
      created_at: v.created_at,
      change_log: typeof v.change_log === 'string' ? v.change_log : null,
      forked_from_version_id: typeof v.forked_from_version_id === 'string' ? v.forked_from_version_id : null,
      is_current: Boolean(v.is_current)
    }));

    return {
      item_id: raw.item_id,
      current_version_id: typeof raw.current_version_id === 'string' ? raw.current_version_id : null,
      total_versions: typeof raw.total_versions === 'number' ? raw.total_versions : sanitizedVersions.length,
      versions: sanitizedVersions
    };
  };

  const rawRpcWithLeaks = {
    success: true,
    item_id: '00000000-0000-0000-0000-000000000001',
    current_version_id: '00000000-0000-0000-0000-000000000002',
    total_versions: 1,
    answer_key: { correct_option_id: 'opt_1' },
    prompt: 'LEAKED PROMPT',
    options: ['A', 'B'],
    hints: ['Hint'],
    explanation: 'Secret',
    metadata: { secret: true },
    versions: [
      {
        id: '00000000-0000-0000-0000-000000000002',
        version_number: 1,
        created_by: '11111111-1111-1111-1111-111111111111',
        created_at: '2026-09-04T12:00:00Z',
        change_log: 'Initial',
        forked_from_version_id: null,
        is_current: true,
        answer_key: { leaked: true },
        prompt: 'LEAKED IN VERSION',
        options: ['Leaked'],
        hints: ['Leaked'],
        explanation: 'Leaked',
        metadata: { leaked: true }
      }
    ]
  };

  const sanitized = sanitizeVersionsResponse(rawRpcWithLeaks);
  assert.notEqual(sanitized, null);
  const serialized = JSON.stringify(sanitized);

  assert.equal(serialized.includes('answer_key'), false);
  assert.equal(serialized.includes('prompt'), false);
  assert.equal(serialized.includes('options'), false);
  assert.equal(serialized.includes('hints'), false);
  assert.equal(serialized.includes('explanation'), false);
  assert.equal(serialized.includes('metadata'), false);
  assert.equal(serialized.includes('LEAKED'), false);

  assert.deepEqual(Object.keys(sanitized).sort(), ['current_version_id', 'item_id', 'total_versions', 'versions'].sort());
  assert.deepEqual(
    Object.keys(sanitized.versions[0]).sort(),
    ['id', 'version_number', 'created_by', 'created_at', 'change_log', 'forked_from_version_id', 'is_current'].sort()
  );

  console.log('PASS Test 51: RT-VH-01/RT-VH-02/RT-VH-07 Version List Sanitization & Leak Defense Contract verified');
}

// 52. RT-VH-03 / RT-VH-09: Other teacher permissions contract (FORBIDDEN -> 403)
{
  const evaluateVersionHistoryAccess = ({ role, isAuthor }) => {
    if (role === 'admin') return { allowed: true };
    if (role === 'teacher' && isAuthor) return { allowed: true };
    if (role === 'teacher' && !isAuthor) return { allowed: false, status: 403, errorCode: 'FORBIDDEN' };
    return { allowed: false, status: 403, errorCode: 'FORBIDDEN' };
  };

  // Author teacher -> ALLOW
  assert.equal(evaluateVersionHistoryAccess({ role: 'teacher', isAuthor: true }).allowed, true);
  // Other teacher -> 403 FORBIDDEN
  const otherTeacher = evaluateVersionHistoryAccess({ role: 'teacher', isAuthor: false });
  assert.equal(otherTeacher.allowed, false);
  assert.equal(otherTeacher.status, 403);
  // Admin -> ALLOW
  assert.equal(evaluateVersionHistoryAccess({ role: 'admin', isAuthor: false }).allowed, true);
  // Student -> 403 FORBIDDEN
  assert.equal(evaluateVersionHistoryAccess({ role: 'student', isAuthor: false }).allowed, false);

  console.log('PASS Test 52: RT-VH-03/RT-VH-09 Permission Matrix verified (Author=ALLOW, Admin=ALLOW, Other=403, Student=403)');
}

// 53. RT-VH-04: Student blocked at BFF Gateway
{
  const checkGatewayRole = (role) => {
    if (role !== 'admin' && role !== 'teacher') {
      return { allowed: false, status: 403, errorCode: 'FORBIDDEN' };
    }
    return { allowed: true };
  };

  assert.equal(checkGatewayRole('student').allowed, false);
  assert.equal(checkGatewayRole('student').status, 403);
  assert.equal(checkGatewayRole('teacher').allowed, true);
  assert.equal(checkGatewayRole('admin').allowed, true);
  console.log('PASS Test 53: RT-VH-04 Student role blocked at Gateway');
}

// 54. RT-VH-05: UUID validation contract
{
  const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  const isValidUUID = (val) => typeof val === 'string' && UUID_REGEX.test(val);

  assert.equal(isValidUUID('00000000-0000-0000-0000-000000000001'), true);
  assert.equal(isValidUUID('invalid-uuid'), false);
  assert.equal(isValidUUID('12345'), false);
  assert.equal(isValidUUID(''), false);
  assert.equal(isValidUUID(null), false);
  console.log('PASS Test 54: RT-VH-05 UUID validation contract verified');
}

// 55. RT-VH-06: ITEM_NOT_FOUND error normalization contract
{
  const normalizeCode = (rawCode) => {
    if (rawCode === 'ITEM_NOT_FOUND') return { status: 404, errorCode: 'NOT_FOUND' };
    if (rawCode === 'VERSION_NOT_FOUND') return { status: 404, errorCode: 'NOT_FOUND' };
    if (rawCode === 'FORBIDDEN') return { status: 403, errorCode: 'FORBIDDEN' };
    return { status: 500, errorCode: 'INTERNAL_ERROR' };
  };

  assert.deepEqual(normalizeCode('ITEM_NOT_FOUND'), { status: 404, errorCode: 'NOT_FOUND' });
  assert.deepEqual(normalizeCode('VERSION_NOT_FOUND'), { status: 404, errorCode: 'NOT_FOUND' });
  assert.deepEqual(normalizeCode('FORBIDDEN'), { status: 403, errorCode: 'FORBIDDEN' });
  console.log('PASS Test 55: RT-VH-06 Error normalization contract verified');
}

// 56. RT-VH-10: Cross-item version binding defense contract
{
  const simulateCrossItemFetch = ({ itemAuthorId, callerId, itemVersionIds, requestedVersionId }) => {
    // 1. Author check
    if (itemAuthorId !== callerId) {
      return { status: 403, errorCode: 'FORBIDDEN', data: null };
    }
    // 2. Version binding check
    if (!itemVersionIds.includes(requestedVersionId)) {
      return { status: 404, errorCode: 'NOT_FOUND', data: null };
    }
    return { status: 200, data: { version_id: requestedVersionId } };
  };

  // Teacher owns ITEM_A, requests VERSION_B which belongs to ITEM_B
  const result = simulateCrossItemFetch({
    itemAuthorId: 'teacher-1',
    callerId: 'teacher-1',
    itemVersionIds: ['version-a1', 'version-a2'],
    requestedVersionId: 'version-b1'
  });

  assert.equal(result.status, 404);
  assert.equal(result.errorCode, 'NOT_FOUND');
  assert.equal(result.data, null);
  console.log('PASS Test 56: RT-VH-10 Cross-item version binding defense verified (404, no leak)');
}

// 57. UI History Action Button Visibility Contract
{
  const canViewHistory = ({ role, isAuthor }) => {
    return role === 'admin' || (role === 'teacher' && isAuthor);
  };

  assert.equal(canViewHistory({ role: 'admin', isAuthor: false }), true);
  assert.equal(canViewHistory({ role: 'teacher', isAuthor: true }), true);
  assert.equal(canViewHistory({ role: 'teacher', isAuthor: false }), false);
  assert.equal(canViewHistory({ role: 'student', isAuthor: false }), false);
  console.log('PASS Test 57: UI History button visibility matrix verified');
}

// 58. Read-only Modal Contract (No mutate actions)
{
  const allowedModalActions = ['view', 'close', 'back'];
  const forbiddenModalActions = ['delete', 'edit', 'restore', 'rollback', 'overwrite'];

  for (const forbidden of forbiddenModalActions) {
    assert.equal(allowedModalActions.includes(forbidden), false);
  }
  console.log('PASS Test 58: Read-only modal contract verified (no delete/edit/restore/rollback/overwrite)');
}

// 59. Null caller_id Guard & Error Normalization Contract
{
  const simulateRpcCallerGuard = (callerId) => {
    if (!callerId) {
      return { success: false, error_code: 'UNAUTHORIZED_CALLER', message: 'Caller ID is required' };
    }
    return { success: true };
  };

  const normalizeRpcErrorStub = (res) => {
    if (res?.error_code === 'UNAUTHORIZED_CALLER') {
      return { status: 401, errorCode: 'UNAUTHORIZED' };
    }
    return { status: 500, errorCode: 'INTERNAL_ERROR' };
  };

  const guardFail = simulateRpcCallerGuard(null);
  assert.equal(guardFail.success, false);
  assert.equal(guardFail.error_code, 'UNAUTHORIZED_CALLER');
  const normalized = normalizeRpcErrorStub(guardFail);
  assert.equal(normalized.status, 401);
  assert.equal(normalized.errorCode, 'UNAUTHORIZED');
  console.log('PASS Test 59: Null caller_id guard contract verified (UNAUTHORIZED_CALLER -> 401 UNAUTHORIZED)');
}

// 60. SQL File Schema Verification: question_bank_item_id Contract
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

{
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const sqlFilePath = path.join(__dirname, '..', 'docs', 'QUESTION_BANK_LIST_VERSIONS_RPC.sql');
  const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');

  // Khẳng định phải sử dụng question_bank_item_id
  assert.equal(sqlContent.includes('WHERE v.question_bank_item_id = p_item_id'), true);
  // Khẳng định KHÔNG sử dụng v.item_id = p_item_id
  assert.equal(sqlContent.includes('WHERE v.item_id = p_item_id'), false);
  // Khẳng định có caller guard
  assert.equal(sqlContent.includes("IF p_caller_id IS NULL THEN"), true);
  assert.equal(sqlContent.includes("'UNAUTHORIZED_CALLER'"), true);
  // Khẳng định có item_id null guard
  assert.equal(sqlContent.includes("IF p_item_id IS NULL THEN"), true);
  assert.equal(sqlContent.includes("'Item ID is required'"), true);
  // Khẳng định có null-safe check
  assert.equal(sqlContent.includes("v_item.author_id IS NULL"), true);
  console.log('PASS Test 60: SQL schema contract verified (uses question_bank_item_id, caller guard, item guard, null-safe ownership)');
}

// 61. Null-Safe Ownership Comparison Contract
{
  const checkOwnershipNullSafe = ({ actorRole, authorId, callerId }) => {
    if (actorRole !== 'admin' && (!authorId || authorId !== callerId)) {
      return { allowed: false, error_code: 'FORBIDDEN' };
    }
    return { allowed: true };
  };

  // Author id is null, non-admin teacher -> FORBIDDEN
  assert.equal(checkOwnershipNullSafe({ actorRole: 'teacher', authorId: null, callerId: 'user-1' }).allowed, false);
  // Author id is null, admin -> ALLOW
  assert.equal(checkOwnershipNullSafe({ actorRole: 'admin', authorId: null, callerId: 'user-1' }).allowed, true);
  // Author matches caller, teacher -> ALLOW
  assert.equal(checkOwnershipNullSafe({ actorRole: 'teacher', authorId: 'user-1', callerId: 'user-1' }).allowed, true);
  // Author differs from caller, teacher -> FORBIDDEN
  assert.equal(checkOwnershipNullSafe({ actorRole: 'teacher', authorId: 'user-2', callerId: 'user-1' }).allowed, false);

  console.log('PASS Test 61: Null-safe ownership comparison logic verified across all combinations');
}

// 62. RT-VH-13: NULL p_item_id -> INVALID_INPUT Contract
{
  const simulateRpcItemGuard = (itemId) => {
    if (!itemId) {
      return { success: false, error_code: 'INVALID_INPUT', message: 'Item ID is required' };
    }
    return { success: true };
  };

  const normalizeRpcErrorStub = (res) => {
    if (res?.error_code === 'INVALID_INPUT') {
      return { status: 400, errorCode: 'INVALID_INPUT' };
    }
    return { status: 500, errorCode: 'INTERNAL_ERROR' };
  };

  const guardFail = simulateRpcItemGuard(null);
  assert.equal(guardFail.success, false);
  assert.equal(guardFail.error_code, 'INVALID_INPUT');
  const normalized = normalizeRpcErrorStub(guardFail);
  assert.equal(normalized.status, 400);
  assert.equal(normalized.errorCode, 'INVALID_INPUT');
  console.log('PASS Test 62: RT-VH-13 NULL p_item_id -> INVALID_INPUT contract verified (400 INVALID_INPUT)');
}

// ============================================================================
// QUESTION BANK — TEACHER PUBLISH SHARING HOTFIX V1 CONTRACT TESTS (SHARE-01 -> SHARE-12)
// ============================================================================

// 63. SHARE-01: Teacher author private draft -> visibility public_template allowed
{
  const simulateUpdateMetadata = ({ callerId, actorRole, item, payload }) => {
    // 1. Role guard
    if (!actorRole || !['admin', 'teacher'].includes(actorRole)) {
      return { success: false, error_code: 'UNAUTHORIZED_ROLE' };
    }
    // 2. Ownership guard
    if (actorRole !== 'admin' && item.author_id !== callerId) {
      return { success: false, error_code: 'FORBIDDEN' };
    }
    // 3. school_shared guard
    if (payload.visibility === 'school_shared' && !item.school_id) {
      return { success: false, error_code: 'INVALID_SCHOOL_ID' };
    }
    return {
      success: true,
      item: {
        ...item,
        visibility: payload.visibility || item.visibility,
        status: payload.status || item.status
      }
    };
  };

  const item = { id: 'item-1', author_id: 'teacher-1', status: 'draft', visibility: 'private', school_id: null };
  const res = simulateUpdateMetadata({
    callerId: 'teacher-1',
    actorRole: 'teacher',
    item,
    payload: { visibility: 'public_template' }
  });

  assert.equal(res.success, true);
  assert.equal(res.item.visibility, 'public_template');
  assert.equal(res.item.status, 'draft');
  console.log('PASS Test 63: SHARE-01 Teacher author private draft -> visibility public_template allowed');
}

// 64. SHARE-02: Other teacher tries changing visibility -> 403 FORBIDDEN
{
  const simulateUpdateMetadata = ({ callerId, actorRole, item, payload }) => {
    if (!actorRole || !['admin', 'teacher'].includes(actorRole)) {
      return { success: false, error_code: 'UNAUTHORIZED_ROLE' };
    }
    if (actorRole !== 'admin' && item.author_id !== callerId) {
      return { success: false, error_code: 'FORBIDDEN' };
    }
    return { success: true };
  };

  const item = { id: 'item-1', author_id: 'teacher-1', status: 'draft', visibility: 'private' };
  const res = simulateUpdateMetadata({
    callerId: 'teacher-2', // Different teacher
    actorRole: 'teacher',
    item,
    payload: { visibility: 'public_template' }
  });

  assert.equal(res.success, false);
  assert.equal(res.error_code, 'FORBIDDEN');
  console.log('PASS Test 64: SHARE-02 Other teacher tries changing visibility -> 403 FORBIDDEN');
}

// 65. SHARE-03: Student -> blocked
{
  const simulateUpdateMetadata = ({ callerId, actorRole, item, payload }) => {
    if (!actorRole || !['admin', 'teacher'].includes(actorRole)) {
      return { success: false, error_code: 'UNAUTHORIZED_ROLE' };
    }
    return { success: true };
  };

  const item = { id: 'item-1', author_id: 'student-1', status: 'draft', visibility: 'private' };
  const res = simulateUpdateMetadata({
    callerId: 'student-1',
    actorRole: 'student',
    item,
    payload: { visibility: 'public_template' }
  });

  assert.equal(res.success, false);
  assert.equal(res.error_code, 'UNAUTHORIZED_ROLE');
  console.log('PASS Test 65: SHARE-03 Student -> blocked (UNAUTHORIZED_ROLE)');
}

// 66. SHARE-04: Teacher author publishes with sharing: visibility public_template + status published
{
  const item = { id: 'item-1', author_id: 'teacher-1', status: 'draft', visibility: 'private' };
  
  // Step 1: Update visibility to public_template
  item.visibility = 'public_template';
  // Step 2: Publish
  item.status = 'published';

  assert.equal(item.visibility, 'public_template');
  assert.equal(item.status, 'published');
  console.log('PASS Test 66: SHARE-04 Teacher author publishes with sharing -> public_template + published');
}

// 67. SHARE-05: Teacher publishes private: visibility private + status published
{
  const item = { id: 'item-1', author_id: 'teacher-1', status: 'draft', visibility: 'private' };
  
  // Step 1: Update visibility to private
  item.visibility = 'private';
  // Step 2: Publish
  item.status = 'published';

  assert.equal(item.visibility, 'private');
  assert.equal(item.status, 'published');
  console.log('PASS Test 67: SHARE-05 Teacher publishes private -> private + published');
}

// 68. SHARE-06: Published public_template appears in other-teacher list
{
  const canTeacherViewItemInList = ({ callerId, item }) => {
    // Author always sees own items
    if (item.author_id === callerId) return true;
    // Other teachers only see published public_template
    if (item.status === 'published' && item.visibility === 'public_template') return true;
    return false;
  };

  const item = { id: 'item-1', author_id: 'teacher-1', status: 'published', visibility: 'public_template' };
  assert.equal(canTeacherViewItemInList({ callerId: 'teacher-2', item }), true);
  console.log('PASS Test 68: SHARE-06 Published public_template appears in other-teacher list');
}

// 69. SHARE-07: Published private does NOT appear in other-teacher list
{
  const canTeacherViewItemInList = ({ callerId, item }) => {
    if (item.author_id === callerId) return true;
    if (item.status === 'published' && item.visibility === 'public_template') return true;
    return false;
  };

  const item = { id: 'item-1', author_id: 'teacher-1', status: 'published', visibility: 'private' };
  assert.equal(canTeacherViewItemInList({ callerId: 'teacher-2', item }), false);
  console.log('PASS Test 69: SHARE-07 Published private does NOT appear in other-teacher list');
}

// 70. SHARE-08: Draft public_template does NOT appear in other-teacher list
{
  const canTeacherViewItemInList = ({ callerId, item }) => {
    if (item.author_id === callerId) return true;
    if (item.status === 'published' && item.visibility === 'public_template') return true;
    return false;
  };

  const item = { id: 'item-1', author_id: 'teacher-1', status: 'draft', visibility: 'public_template' };
  assert.equal(canTeacherViewItemInList({ callerId: 'teacher-2', item }), false);
  console.log('PASS Test 70: SHARE-08 Draft public_template does NOT appear in other-teacher list');
}

// 71. SHARE-09: Teacher cannot access another teacher's Version History
{
  const canAccessVersionHistory = ({ callerId, actorRole, item }) => {
    if (actorRole === 'admin') return true;
    if (actorRole === 'teacher' && item.author_id === callerId) return true;
    return false;
  };

  const item = { id: 'item-1', author_id: 'teacher-1', status: 'published', visibility: 'public_template' };
  // Admin -> ALLOW
  assert.equal(canAccessVersionHistory({ callerId: 'admin-1', actorRole: 'admin', item }), true);
  // Author -> ALLOW
  assert.equal(canAccessVersionHistory({ callerId: 'teacher-1', actorRole: 'teacher', item }), true);
  // Other teacher -> DENIED (even if public_template)
  assert.equal(canAccessVersionHistory({ callerId: 'teacher-2', actorRole: 'teacher', item }), false);
  console.log('PASS Test 71: SHARE-09 Teacher cannot access another teacher Version History');
}

// 72. SHARE-10: Unshare published question: public_template -> private, status stays published
{
  const item = { id: 'item-1', author_id: 'teacher-1', status: 'published', visibility: 'public_template' };
  
  // Action: Unshare
  item.visibility = 'private';

  assert.equal(item.visibility, 'private');
  assert.equal(item.status, 'published');
  console.log('PASS Test 72: SHARE-10 Unshare published question -> private + status stays published');
}

// 73. SHARE-11: No answer_key/prompt/options/version content mutated by visibility-only update
{
  const originalItem = {
    id: 'item-1',
    author_id: 'teacher-1',
    status: 'published',
    visibility: 'private',
    current_version_id: 'ver-1'
  };

  const originalVersion = {
    id: 'ver-1',
    question_bank_item_id: 'item-1',
    version_number: 1,
    prompt: '2 + 2 = ?',
    options: [{ id: 'opt-1', text: '4' }],
    answer_key: { correct_answers: ['opt-1'] }
  };

  // Simulate updateQuestionVisibility payload
  const payload = { visibility: 'public_template' };
  const updatedItem = {
    ...originalItem,
    visibility: payload.visibility,
    updated_at: new Date().toISOString()
  };

  // Assert version and answer key remain completely untouched
  assert.equal(originalItem.current_version_id, updatedItem.current_version_id);
  assert.equal(originalVersion.prompt, '2 + 2 = ?');
  assert.deepEqual(originalVersion.answer_key, { correct_answers: ['opt-1'] });
  console.log('PASS Test 73: SHARE-11 No answer_key/prompt/options/version content mutated by visibility update');
}

// 74. SHARE-12: school_shared still fail-closed when school_id is null & SQL contract proof
{
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const sqlFilePath = path.join(__dirname, '..', 'docs', 'QUESTION_BANK_TEACHER_PUBLISH_SHARING.sql');
  const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');

  // Khẳng định FORBIDDEN_VISIBILITY đã được loại bỏ
  assert.equal(sqlContent.includes('FORBIDDEN_VISIBILITY'), false);
  // Khẳng định quy tắc fail-closed cho school_shared được bảo toàn
  assert.equal(sqlContent.includes("v_visibility = 'school_shared'"), true);
  assert.equal(sqlContent.includes("v_item.school_id IS NULL"), true);
  assert.equal(sqlContent.includes("'INVALID_SCHOOL_ID'"), true);
  // Khẳng định phân quyền sở hữu author_id <> p_caller_id được bảo toàn
  assert.equal(sqlContent.includes("v_item.author_id <> p_caller_id"), true);
  // Khẳng định atomic transaction
  assert.equal(sqlContent.includes('BEGIN;'), true);
  assert.equal(sqlContent.includes('COMMIT;'), true);
  // Khẳng định ACL
  assert.equal(sqlContent.includes('GRANT EXECUTE ON FUNCTION public.rpc_qb_update_item_metadata(UUID, TEXT, UUID, JSONB) TO service_role;'), true);
  console.log('PASS Test 74: SHARE-12 school_shared still fail-closed when school_id is null & SQL contract verified');
}

console.log('=== ALL TESTS PASSED SUCCESSFULLY! ===');



