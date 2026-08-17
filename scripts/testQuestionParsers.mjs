import * as XLSX from 'xlsx';
import {
  parseExcelQuestions,
  sanitizeText,
  getQuestionValidationErrors,
  normalizeQuestionOptions
} from '../src/utils/questionFileParsers.js';

console.log('=== RUNNING COMPREHENSIVE EXCEL & TEXT PARSER TESTS ===\n');

let totalTests = 0;
let passedTests = 0;

const assert = (condition, testName, extra = '') => {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`✅ [PASS] ${testName} ${extra}`);
  } else {
    console.error(`❌ [FAIL] ${testName} ${extra}`);
  }
};

// Helper: Build in-memory Excel ArrayBuffer
const createWorkbookBuffer = (rows) => {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Test');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
};

async function runTests() {
  // Test 1: Sanitize Formula Injection and HTML
  const sanitizedFormula = sanitizeText('=SUM(A1:A10)');
  assert(sanitizedFormula === 'SUM(A1:A10)', 'Sanitize formula injection strip leading =');

  const sanitizedHtml = sanitizeText('<b>Câu hỏi số 1</b>');
  assert(sanitizedHtml === 'Câu hỏi số 1', 'Sanitize strip HTML tags');

  const sanitizedNegativeNum = sanitizeText('-5');
  assert(sanitizedNegativeNum === '-5', 'Sanitize preserve negative numbers');

  // Test 2: Valid Excel with single_choice (A/B/C/D mapping), fill_blank, essay & Vietnamese Unicode
  const validRows = [
    ['type', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer', 'reference_answer', 'points'],
    ['single_choice', 'Phép cộng 3 + 4 có kết quả bằng bao nhiêu?', '6', '7', '8', '9', 'B', '', 1],
    ['single_choice', '57 - 23 = ? (Đáp án 2 lựa chọn)', '34', '35', '', '', '34', '', 1],
    ['fill_blank', 'Điền số thích hợp: 6 + 2 = ... (Tiếng Việt)', '', '', '', '', '8', '', 1.5],
    ['essay', 'Bé hãy nêu cảm nghĩ về bài thơ Lượm', '', '', '', '', '', 'Đoạn thơ thể hiện sự dũng cảm...', 2]
  ];
  const validBuf = createWorkbookBuffer(validRows);
  const resValid = await parseExcelQuestions(validBuf, 'test.xlsx');

  assert(resValid.success === true, 'Parse valid Excel successfully with Vietnamese Unicode');
  assert(resValid.questions.length === 4, 'Parsed exactly 4 questions');
  assert(resValid.questions[0].correct_answer === '7', 'Mapped correct_answer "B" to option "7"');
  assert(resValid.questions[1].options.length === 2, 'Supported exactly 2 options for single_choice');
  assert(resValid.questions[2].options.length === 0, 'fill_blank has empty options array');
  assert(resValid.questions[3].options.length === 0, 'essay has empty options array');

  // Test 3: Reject .xlsm files
  const resXlsm = await parseExcelQuestions(validBuf, 'dangerous.xlsm');
  assert(resXlsm.success === false && resXlsm.errors[0].message.includes('.xlsm'), 'Reject .xlsm files with macro warning');

  // Test 4: Missing required header columns
  const badHeadersRows = [
    ['cau_hoi_khong_dung', 'diem'],
    ['3 + 4 = ?', 1]
  ];
  const badHeadersBuf = createWorkbookBuffer(badHeadersRows);
  const resBadHeaders = await parseExcelQuestions(badHeadersBuf, 'bad_headers.xlsx');
  assert(resBadHeaders.success === false && resBadHeaders.errors[0].message.includes('Thiếu các cột bắt buộc'), 'Catch missing required header columns');

  // Test 5: Empty question prompt
  const emptyPromptRows = [
    ['type', 'question', 'option_a', 'option_b', 'correct_answer'],
    ['single_choice', '', 'A', 'B', 'A']
  ];
  const emptyPromptBuf = createWorkbookBuffer(emptyPromptRows);
  const resEmptyPrompt = await parseExcelQuestions(emptyPromptBuf, 'empty_prompt.xlsx');
  assert(resEmptyPrompt.success === false && resEmptyPrompt.errors[0].message.includes('không được để trống'), 'Catch empty question prompt');

  // Test 6: Invalid single_choice without enough options (1 option or 0 options)
  const fewOptionsRows = [
    ['type', 'question', 'option_a', 'correct_answer'],
    ['single_choice', '1 + 1 = ?', '2', '2']
  ];
  const fewOptionsBuf = createWorkbookBuffer(fewOptionsRows);
  const resFewOptions = await parseExcelQuestions(fewOptionsBuf, 'few_options.xlsx');
  assert(resFewOptions.success === false && resFewOptions.errors[0].message.includes('ít nhất 2'), 'Catch single_choice with < 2 options');

  // Test 7: Options containing whitespace-only strings
  const whitespaceOptionsRows = [
    ['type', 'question', 'option_a', 'option_b', 'correct_answer'],
    ['single_choice', '2 + 2 = ?', '4', '   ', '4']
  ];
  const whitespaceBuf = createWorkbookBuffer(whitespaceOptionsRows);
  const resWhitespace = await parseExcelQuestions(whitespaceBuf, 'whitespace.xlsx');
  assert(resWhitespace.success === false && resWhitespace.errors[0].message.includes('chỉ có 1 lựa chọn'), 'Filter out whitespace-only option cells and reject < 2 valid choices');

  // Test 8: Correct answer not matching any options
  const unmatchAnsRows = [
    ['type', 'question', 'option_a', 'option_b', 'correct_answer'],
    ['single_choice', '1 + 1 = ?', '2', '3', 'Không có đáp án']
  ];
  const unmatchAnsBuf = createWorkbookBuffer(unmatchAnsRows);
  const resUnmatchAns = await parseExcelQuestions(unmatchAnsBuf, 'unmatch_ans.xlsx');
  assert(resUnmatchAns.success === false && resUnmatchAns.errors[0].message.includes('không khớp với bất kỳ lựa chọn nào'), 'Catch unmatched correct answer');

  // Test 9: getQuestionValidationErrors utility
  console.log('\n--- TESTING GETQUESTIONVALIDATIONERRORS UTILITY ---');
  const mockQuestions = [
    { question_type: 'single_choice', prompt: 'Câu 1', options: ['A'], correct_answer: 'A', points: 1, source_row: 2 },
    { question_type: 'single_choice', prompt: 'Câu 2', options: ['A', 'B'], correct_answer: 'C', points: 1, source_row: 3 },
    { question_type: 'fill_blank', prompt: 'Câu 3', options: [], correct_answer: '10', points: 1, source_row: 4 },
    { question_type: 'essay', prompt: 'Câu 4', options: [], correct_answer: 'Gợi ý', points: 1, source_row: 5 }
  ];
  const validationErrs = getQuestionValidationErrors(mockQuestions);

  assert(validationErrs.length === 2, 'Identified exactly 2 validation errors');
  assert(validationErrs[0].message.includes('dòng Excel 2') && validationErrs[0].message.includes('chỉ có 1 lựa chọn'), 'Pinpointed exact Row 2 for < 2 options error');
  assert(validationErrs[1].message.includes('dòng Excel 3') && validationErrs[1].message.includes('không thuộc danh sách lựa chọn'), 'Pinpointed exact Row 3 for unmatched correct_answer error');

  // Test 10: INTEGRATION TEST FOR EXACT 9-QUESTION FILE STRUCTURE
  console.log('\n--- TESTING INTEGRATION FOR EXACT 9-QUESTION STRUCTURE (4 single_choice, 3 fill_blank, 2 essay) ---');
  const exact9Rows = [
    ['type', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer'],
    // 4 single_choice questions
    ['single_choice', 'Câu 1: 3 + 4 = ?', '6', '7', '8', '9', 'B'],
    ['single_choice', 'Câu 2: Số nào lớn nhất?', '10', '15', '20', '25', 'D'],
    ['single_choice', 'Câu 3: 5 * 5 = ?', '20', '25', '30', '35', '25'],
    ['single_choice', 'Câu 4: Thủ đô Việt Nam?', 'Hà Nội', 'Đà Nẵng', 'TP.HCM', 'Cần Thơ', 'A'],
    // 3 fill_blank questions (no options)
    ['fill_blank', 'Câu 5: 10 - 4 = ...', '', '', '', '', '6'],
    ['fill_blank', 'Câu 6: Điền chữ: Bông ... chăn trâu', '', '', '', '', 'cỏ'],
    ['fill_blank', 'Câu 7: 15 + 15 = ...', '', '', '', '', '30'],
    // 2 essay questions (no options)
    ['essay', 'Câu 8: Hãy nêu quy tắc cộng hai số tự nhiên', '', '', '', '', 'Cộng từ phải sang trái'],
    ['essay', 'Câu 9: Đặt 1 câu cảm thán về thời tiết hôm nay', '', '', '', '', 'Trời hôm nay đẹp quá!']
  ];

  const exact9Buf = createWorkbookBuffer(exact9Rows);
  const resExact9 = await parseExcelQuestions(exact9Buf, '74881fc6-8a16-433d-88ac-0a1425967c73.xlsx');

  assert(resExact9.success === true, 'Parse exact 9-question Excel file successfully');
  assert(resExact9.questions.length === 9, 'Parsed exactly 9 questions');

  // Build RPC payload simulation
  const payloadExact9 = resExact9.questions.map(q => {
    const normOpts = normalizeQuestionOptions(q);
    return {
      question_type: q.question_type,
      prompt: q.prompt,
      options: normOpts,
      options_json: normOpts,
      points: q.points || 1
    };
  });

  assert(payloadExact9.length === 9, 'Payload contains exactly 9 questions');

  const singleChoices = payloadExact9.filter(q => q.question_type === 'single_choice');
  assert(singleChoices.length === 4, 'Payload contains 4 single_choice questions');
  assert(singleChoices.every(q => Array.isArray(q.options_json) && q.options_json.length === 4), 'All 4 single_choice questions have options_json.length = 4');

  const otherQuestions = payloadExact9.filter(q => ['fill_blank', 'essay'].includes(q.question_type));
  assert(otherQuestions.length === 5, 'Payload contains 5 fill_blank and essay questions');
  assert(otherQuestions.every(q => Array.isArray(q.options_json) && q.options_json.length === 0), 'All fill_blank and essay questions have options_json = []');

  const totalPointsExact9 = payloadExact9.reduce((sum, q) => sum + q.points, 0);
  assert(totalPointsExact9 === 9, 'Total default points equals 9 when points column is omitted');

  // Test 11: Word (.docx) Parsing Simulation with standard structure
  console.log('\n--- TESTING WORD PARSER ---');
  const sampleWordText = `[TRẮC NGHIỆM]
Câu hỏi: 3 + 4 = ?
A. 6
B. 7
C. 8
D. 9
Đáp án: B
Điểm: 1

[ĐIỀN KHUYẾT]
Câu hỏi: Điền số thích hợp: 10 - 7 = ...
Đáp án: 3
Điểm: 1

[TỰ LUẬN]
Câu hỏi: Bé có 5 quả bóng, mẹ cho thêm 3 quả bóng nữa. Hỏi bé có tất cả bao nhiêu quả bóng?
Đáp án tham khảo: 8 quả bóng
Điểm: 2
`;

  // Test 12: Word rejection of old .doc binary files
  const dummyBuf = Buffer.from(sampleWordText);
  const { parseWordQuestions } = await import('../src/utils/questionFileParsers.js');
  const resDocOld = await parseWordQuestions(dummyBuf, 'bai_tap.doc');
  assert(resDocOld.success === false && resDocOld.errors[0].message.includes('.doc'), 'Reject old .doc binary files');

  // Summary
  console.log(`\n========================================`);
  console.log(`TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${totalTests - passedTests}`);
  if (passedTests === totalTests) {
    console.log('🎉 ALL PARSER, VALIDATOR & INTEGRATION TESTS PASSED 100%!');
  } else {
    process.exit(1);
  }
}

runTests();
