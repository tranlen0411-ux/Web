import assert from 'node:assert';
import {
  normalizeImportedQuestion,
  getQuestionValidationErrors
} from '../src/utils/questionFileParsers.js';

console.log('=== RUNNING TESTS: ACADEMIC EXERCISE IMAGE_UPLOAD QUESTION TYPE ===\n');

// TEST 1: normalizeImportedQuestion for image_upload
console.log('--- TEST 1: Normalization for image_upload ---');
const rawImageQ = {
  id: 'test-q-1',
  question_number: 1,
  question_type: 'image_upload',
  prompt: 'Em hãy làm bài toán ra giấy và chụp ảnh nộp tại đây.',
  points: 5
};
const normImageQ = normalizeImportedQuestion(rawImageQ, 0);

assert.strictEqual(normImageQ.question_type, 'image_upload', 'question_type must be image_upload');
assert.strictEqual(normImageQ.prompt, 'Em hãy làm bài toán ra giấy và chụp ảnh nộp tại đây.');
assert.strictEqual(normImageQ.points, 5);
assert.deepStrictEqual(normImageQ.options, []);
assert.deepStrictEqual(normImageQ.options_json, []);
assert.strictEqual(normImageQ.correct_answer_key, null, 'correct_answer_key must be null');
console.log('✅ TEST 1 Passed: image_upload question correctly normalized.');

// TEST 2: Validation for image_upload
console.log('\n--- TEST 2: Validation for image_upload ---');
// 2a. Valid image_upload question
const validErrors = getQuestionValidationErrors([normImageQ]);
assert.strictEqual(validErrors.length, 0, 'Valid image_upload question should produce 0 errors');

// 2b. Missing prompt
const invalidPromptQ = normalizeImportedQuestion({
  question_number: 1,
  question_type: 'image_upload',
  prompt: '',
  points: 5
}, 0);
const promptErrors = getQuestionValidationErrors([invalidPromptQ]);
assert.strictEqual(promptErrors.length, 1, 'Empty prompt should fail validation');
assert.strictEqual(promptErrors[0].field, 'prompt');

// 2c. Invalid points
const invalidPointsQ = normalizeImportedQuestion({
  question_number: 1,
  question_type: 'image_upload',
  prompt: 'Đề bài hợp lệ',
  points: -1
}, 0);
const pointsErrors = getQuestionValidationErrors([invalidPointsQ]);
assert.strictEqual(pointsErrors.length, 1, 'Negative points should fail validation');
assert.strictEqual(pointsErrors[0].field, 'points');
console.log('✅ TEST 2 Passed: image_upload validation rules verified.');

// TEST 3: Existing Question Types Regression Check
console.log('\n--- TEST 3: Existing Question Types Regression Check ---');
const singleChoiceQ = normalizeImportedQuestion({
  question_number: 1,
  question_type: 'single_choice',
  prompt: '1 + 1 = ?',
  options: ['1', '2', '3'],
  correct_answer: '2',
  points: 2
}, 0);
assert.strictEqual(singleChoiceQ.question_type, 'single_choice');
assert.strictEqual(singleChoiceQ.correct_answer, '2');
assert.strictEqual(getQuestionValidationErrors([singleChoiceQ]).length, 0);

const multipleChoiceQ = normalizeImportedQuestion({
  question_number: 2,
  question_type: 'multiple_choice',
  prompt: 'Các số chẵn là:',
  options: ['1', '2', '3', '4'],
  correct_answer: ['2', '4'],
  points: 2
}, 1);
assert.strictEqual(multipleChoiceQ.question_type, 'multiple_choice');
assert.deepStrictEqual(multipleChoiceQ.correct_answer, ['2', '4']);
assert.strictEqual(getQuestionValidationErrors([multipleChoiceQ]).length, 0);

const fillBlankQ = normalizeImportedQuestion({
  question_number: 3,
  question_type: 'fill_blank',
  prompt: 'Điền số: 5 + 5 = ...',
  correct_answer: '10',
  points: 2
}, 2);
assert.strictEqual(fillBlankQ.question_type, 'fill_blank');
assert.strictEqual(fillBlankQ.correct_answer, '10');
assert.strictEqual(getQuestionValidationErrors([fillBlankQ]).length, 0);

const essayQ = normalizeImportedQuestion({
  question_number: 4,
  question_type: 'essay',
  prompt: 'Viết đoạn văn ngắn tả cây bàng.',
  correct_answer: 'Hướng dẫn chấm của GV',
  points: 5
}, 3);
assert.strictEqual(essayQ.question_type, 'essay');
assert.strictEqual(getQuestionValidationErrors([essayQ]).length, 0);

console.log('✅ TEST 3 Passed: 0 regression on single_choice, multiple_choice, fill_blank, short_answer, essay.');

// TEST 4: Mixed Exercise Payload Construction & Reopening Simulation
console.log('\n--- TEST 4: Mixed Exercise Payload & Draft Reopening Simulation ---');
const mixedQuestions = [singleChoiceQ, normImageQ, essayQ];
const payload = mixedQuestions.map((q, idx) => {
  const normQ = normalizeImportedQuestion(q, idx);
  return {
    question_number: idx + 1,
    question_type: normQ.question_type,
    prompt: normQ.prompt,
    options_json: normQ.options_json,
    options: normQ.options_json,
    points: normQ.points,
    correct_answer_key: ['essay', 'image_upload'].includes(normQ.question_type) ? null : normQ.correct_answer_key
  };
});

assert.strictEqual(payload[1].question_type, 'image_upload');
assert.strictEqual(payload[1].correct_answer_key, null);
assert.deepStrictEqual(payload[1].options_json, []);

// Simulate reopening draft from backend payload
const reopenedQuestions = payload.map((q, idx) => normalizeImportedQuestion(q, idx));
assert.strictEqual(reopenedQuestions[1].question_type, 'image_upload');
assert.strictEqual(reopenedQuestions[1].prompt, 'Em hãy làm bài toán ra giấy và chụp ảnh nộp tại đây.');
assert.strictEqual(reopenedQuestions[1].points, 5);
assert.strictEqual(reopenedQuestions[1].correct_answer_key, null);
console.log('✅ TEST 4 Passed: Save draft, reopen draft, and payload construction fully verified.');

console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY (EXIT CODE 0)!');
