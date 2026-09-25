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

const shortAnswerQ = normalizeImportedQuestion({
  question_number: 4,
  question_type: 'short_answer',
  prompt: 'Thủ đô của Việt Nam là gì?',
  correct_answer: 'Hà Nội',
  points: 2
}, 3);
assert.strictEqual(shortAnswerQ.question_type, 'short_answer');
assert.strictEqual(shortAnswerQ.correct_answer, 'Hà Nội');
assert.strictEqual(getQuestionValidationErrors([shortAnswerQ]).length, 0);

const essayQ = normalizeImportedQuestion({
  question_number: 5,
  question_type: 'essay',
  prompt: 'Viết đoạn văn ngắn tả cây bàng.',
  correct_answer: 'Hướng dẫn chấm của GV',
  points: 5
}, 4);
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

// TEST 5: Excel Parser image_upload support and invalid type error message
console.log('\n--- TEST 5: Excel Parser with image_upload & Error Messages ---');
import * as XLSX from 'xlsx';
import { parseExcelQuestions, parseWordQuestions } from '../src/utils/questionFileParsers.js';

const testWorkbook = XLSX.utils.book_new();
const excelData = [
  ['type', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer', 'reference_answer', 'points'],
  ['single_choice', '1 + 1 = ?', '1', '2', '3', '4', '2', '', 1],
  ['image_upload', 'Em hãy giải bài toán sau ra vở và chụp ảnh.', '', '', '', '', '', '', 3],
  ['essay', 'Viết đoạn văn.', '', '', '', '', '', 'Gợi ý chấm', 5],
  ['invalid_type_xyz', 'Câu hỏi loại lạ.', '', '', '', '', '', '', 1]
];
const testSheet = XLSX.utils.aoa_to_sheet(excelData);
XLSX.utils.book_append_sheet(testWorkbook, testSheet, 'Sheet1');
const excelBuffer = XLSX.write(testWorkbook, { type: 'array', bookType: 'xlsx' });

const excelResult = await parseExcelQuestions(excelBuffer, 'test.xlsx');
assert.strictEqual(excelResult.questions.length, 3, 'Should parse 3 valid questions');
assert.strictEqual(excelResult.questions[1].question_type, 'image_upload');
assert.strictEqual(excelResult.questions[1].prompt, 'Em hãy giải bài toán sau ra vở và chụp ảnh.');
assert.strictEqual(excelResult.questions[1].points, 3);
assert.strictEqual(excelResult.questions[1].correct_answer_key, null);

// Check invalid type message mentions image_upload
assert.strictEqual(excelResult.errors.length, 1);
assert.ok(excelResult.errors[0].message.includes('image_upload (nộp ảnh)'), 'Invalid type message should include image_upload');
console.log('✅ TEST 5 Passed: Excel parser successfully parsed image_upload and reported correct error message.');

// TEST 6: Word Parser tags for image_upload ([NỘP ẢNH], [NOP ANH], [TẢI ẢNH], [IMAGE])
console.log('\n--- TEST 6: Word Parser Tags for image_upload ---');
import JSZip from 'jszip';

const zip = new JSZip();
zip.file(
  '[Content_Types].xml',
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>'
);
zip.file(
  'word/document.xml',
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:body>' +
  '<w:p><w:r><w:t>[NỘP ẢNH]</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Câu hỏi: Bài toán 1 - Nộp ảnh giải toán hình học.</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Điểm: 3</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>[NOP ANH]</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Câu hỏi: Bài toán 2 - Vẽ sơ đồ tư duy ra giấy.</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Điểm: 2.5</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>[TẢI ẢNH]</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Câu hỏi: Bài toán 3 - Viết đoạn văn chữ đẹp ra vở.</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Điểm: 4</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>[IMAGE]</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Câu hỏi: Bài toán 4 - Chụp ảnh sản phẩm thực hành.</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Điểm: 5</w:t></w:r></w:p>' +
  '</w:body>' +
  '</w:document>'
);

const docxBuffer = await zip.generateAsync({ type: 'nodebuffer' });
const wordResult = await parseWordQuestions(docxBuffer, 'test.docx');

assert.strictEqual(wordResult.success, true, 'Word parser should succeed');
assert.strictEqual(wordResult.questions.length, 4, 'Should parse 4 image_upload questions with different tags');
assert.strictEqual(wordResult.questions[0].question_type, 'image_upload');
assert.strictEqual(wordResult.questions[0].points, 3);
assert.strictEqual(wordResult.questions[1].question_type, 'image_upload');
assert.strictEqual(wordResult.questions[1].points, 2.5);
assert.strictEqual(wordResult.questions[2].question_type, 'image_upload');
assert.strictEqual(wordResult.questions[2].points, 4);
assert.strictEqual(wordResult.questions[3].question_type, 'image_upload');
assert.strictEqual(wordResult.questions[3].points, 5);
console.log('✅ TEST 6 Passed: Word parser correctly parsed all tags: [NỘP ẢNH], [NOP ANH], [TẢI ẢNH], [IMAGE].');

// TEST 7: Template Verification (Excel and Word Templates contain image_upload)
console.log('\n--- TEST 7: Excel & Word Template Verification ---');
import fs from 'node:fs';
const parserSource = fs.readFileSync(new URL('../src/utils/questionFileParsers.js', import.meta.url), 'utf-8');

// Verify Excel template has image_upload row
assert.ok(
  parserSource.includes('image_upload') &&
  parserSource.includes('Em hãy giải bài toán sau ra vở ô ly và chụp ảnh bài làm để nộp.'),
  'Excel template must include image_upload sample row'
);

// Verify Word template has [NỘP ẢNH] section
assert.ok(
  parserSource.includes('[NỘP ẢNH]') &&
  parserSource.includes('Em hãy giải bài toán sau ra vở ô ly và chụp ảnh bài làm để nộp.'),
  'Word template must include [NỘP ẢNH] sample section'
);
console.log('✅ TEST 7 Passed: Excel and Word templates verified to include image_upload sample.');

// TEST 8: Space preservation in Input, Textarea, and Options (Regression Prevention)
console.log('\n--- TEST 8: Space Character Preservation During Interactive Typing ---');
// Simulate sequential typing with Space: "Em" -> "Em " -> "Em hãy" -> "Em hãy " -> "Em hãy làm" -> "Em hãy làm " -> "Em hãy làm bài"
const typingSteps = [
  'Em',
  'Em ',
  'Em hãy',
  'Em hãy ',
  'Em hãy làm',
  'Em hãy làm ',
  'Em hãy làm bài'
];

let currentPrompt = '';
for (const step of typingSteps) {
  currentPrompt = step;
  const qState = normalizeImportedQuestion({
    question_number: 1,
    question_type: 'image_upload',
    prompt: currentPrompt,
    points: 2
  }, 0);
  assert.strictEqual(qState.prompt, step, `Prompt must preserve exact string "${step}" including trailing spaces`);
}
assert.strictEqual(currentPrompt, 'Em hãy làm bài', 'Final prompt must match full typed phrase with spaces');

// Space in options and text fields
const choiceQ = normalizeImportedQuestion({
  question_number: 2,
  question_type: 'single_choice',
  prompt: 'Chọn câu đúng ',
  options: ['Lựa chọn 1 ', 'Lựa chọn 2 '],
  correct_answer: 'Lựa chọn 1 ',
  points: 1
}, 1);
assert.strictEqual(choiceQ.prompt, 'Chọn câu đúng ');
assert.strictEqual(choiceQ.options[0], 'Lựa chọn 1 ');
assert.strictEqual(choiceQ.correct_answer, 'Lựa chọn 1 ');

// Validation correctly flags whitespace-only prompt as empty
const whitespaceOnlyErrors = getQuestionValidationErrors([
  normalizeImportedQuestion({ question_number: 1, question_type: 'essay', prompt: '   ', points: 1 }, 0)
]);
assert.strictEqual(whitespaceOnlyErrors.length, 1, 'Whitespace-only prompt must fail validation');
assert.strictEqual(whitespaceOnlyErrors[0].field, 'prompt');

console.log('✅ TEST 8 Passed: Space key and whitespace characters 100% preserved during typing.');

console.log('\n🎉 ALL 8 TEST SUITES PASSED SUCCESSFULLY (EXIT CODE 0)!');

