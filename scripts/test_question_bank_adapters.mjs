// scripts/test_question_bank_adapters.mjs
// Unit tests for Question Bank V2A Adapters and Security Contracts

import assert from 'node:assert/strict';
import {
  toQuestionBankPayload,
  normalizePromptForDuplicateCheck,
  findDuplicatesInQuestionList,
  normalizeOptionsToStableIds,
  buildSingleChoiceAnswerKey,
  buildMultipleChoiceAnswerKey
} from '../src/utils/questionBankAdapters.js';

console.log('=== RUNNING QUESTION BANK V2A ADAPTERS UNIT TESTS (12 CASES) ===');

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

console.log('=== ALL 12 TESTS PASSED SUCCESSFULLY! ===');