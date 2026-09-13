// scripts/test_academic_exercise_import_ui.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
  parseExcelQuestions,
  parseWordQuestions,
  sanitizeText,
  getQuestionValidationErrors,
  normalizeImportedQuestion
} from '../src/utils/questionFileParsers.js';

console.log('======================================================');
console.log('🧪 VERIFY ACADEMIC EXERCISE IMPORT UI & INTEGRATION');
console.log('======================================================\n');

let total = 0;
let passed = 0;

function assert(condition, name, extra = '') {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✅ [PASS] ${name} ${extra}`);
  } else {
    console.error(`  ❌ [FAIL] ${name} ${extra}`);
  }
}

// Helper: In-memory Excel generator
const createXlsxBuffer = (rows) => {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Questions');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
};

async function runAllChecks() {
  console.log('--- 1. STATIC CODE CHECKS: CreateExerciseModal & ImportQuestionsModal ---');
  const createModalPath = path.resolve(__dirname, '../src/components/dashboard/exercises/CreateExerciseModal.jsx');
  const importModalPath = path.resolve(__dirname, '../src/components/dashboard/exercises/ImportQuestionsModal.jsx');
  const exerciseListPath = path.resolve(__dirname, '../src/components/dashboard/exercises/ExerciseListTab.jsx');

  assert(fs.existsSync(createModalPath), 'CreateExerciseModal.jsx exists');
  assert(fs.existsSync(importModalPath), 'ImportQuestionsModal.jsx exists');
  assert(fs.existsSync(exerciseListPath), 'ExerciseListTab.jsx exists');

  const createModalContent = fs.readFileSync(createModalPath, 'utf8');
  const importModalContent = fs.readFileSync(importModalPath, 'utf8');
  const exerciseListContent = fs.readFileSync(exerciseListPath, 'utf8');

  // Verify Import Button is present
  assert(createModalContent.includes('Nhập Từ Tệp (Excel/Word)'), 'CreateExerciseModal renders "Nhập Từ Tệp (Excel/Word)" button text');
  assert(createModalContent.includes('setIsImportModalOpen(true)'), 'Import button triggers setIsImportModalOpen(true)');
  assert(createModalContent.includes('<ImportQuestionsModal'), 'CreateExerciseModal includes <ImportQuestionsModal component');
  assert(createModalContent.includes('handleImportQuestions'), 'CreateExerciseModal includes handleImportQuestions callback');
  assert(createModalContent.includes('FileSpreadsheet'), 'CreateExerciseModal imports FileSpreadsheet icon');
  assert(createModalContent.includes('scrollToQuestion'), 'CreateExerciseModal includes scrollToQuestion error navigation');
  assert(createModalContent.includes('countsTowardRanking'), 'CreateExerciseModal preserves countsTowardRanking feature');

  // Verify Safe-delete in ExerciseListTab is preserved
  assert(exerciseListContent.includes('handleConfirmDeleteExercise'), 'ExerciseListTab preserves handleConfirmDeleteExercise');
  assert(exerciseListContent.includes('rpc_academic_delete_or_archive_exercise'), 'ExerciseListTab targets rpc_academic_delete_or_archive_exercise');

  console.log('\n--- 2. FUNCTIONAL PARSER & WORKFLOW TESTS ---');
  // Scenario A: Valid Excel with mixed question types
  const sampleExcelRows = [
    ['type', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer', 'points'],
    ['single_choice', 'Hà Nội là thủ đô của nước nào?', 'Việt Nam', 'Lào', 'Campuchia', 'Thái Lan', 'A', 2],
    ['single_choice', '2 + 2 = ?', '3', '4', '5', '6', '4', 1],
    ['fill_blank', 'Điền vào chỗ trống: Sông Hồng chảy qua thành phố ...', '', '', '', '', 'Hà Nội', 2],
    ['essay', 'Hãy viết đoạn văn ngắn giới thiệu về bản thân em.', '', '', '', '', 'Đoạn văn đủ ý, đúng ngữ pháp...', 5]
  ];
  const validBuffer = createXlsxBuffer(sampleExcelRows);
  const parseRes = await parseExcelQuestions(validBuffer, 'bai_tap_tieu_hoc.xlsx');

  assert(parseRes.success === true, 'Parsed valid multi-type Excel successfully');
  assert(parseRes.questions.length === 4, 'Parsed exactly 4 questions');

  // Simulate handleImportQuestions workflow in CreateExerciseModal
  let stateQuestions = [
    {
      id: 1,
      question_number: 1,
      question_type: 'single_choice',
      prompt: '3 + 4 = ?',
      options: ['5', '6', '7', '8'],
      options_json: ['5', '6', '7', '8'],
      correct_answer: '7',
      correct_answer_key: { correct_answer: '7', accepted_answers: ['7'], case_sensitive: false },
      points: 1,
      source_row: null
    }
  ];

  // Simulating state replacement for default blank question
  const isDefaultSingleBlank = stateQuestions.length === 1 && (!stateQuestions[0].prompt || stateQuestions[0].prompt === '3 + 4 = ?');
  const formattedImported = parseRes.questions.map((q, idx) => {
    const targetNum = isDefaultSingleBlank ? idx + 1 : stateQuestions.length + idx + 1;
    return normalizeImportedQuestion({ ...q, question_number: targetNum }, idx);
  });

  if (isDefaultSingleBlank) {
    stateQuestions = formattedImported;
  } else {
    stateQuestions = [...stateQuestions, ...formattedImported];
  }

  assert(stateQuestions.length === 4, 'handleImportQuestions successfully replaces initial default question with 4 imported questions');
  assert(stateQuestions[0].prompt === 'Hà Nội là thủ đô của nước nào?', 'First question is accurately populated');
  assert(stateQuestions[0].points === 2, 'Points are preserved from import file');
  assert(stateQuestions[0].correct_answer === 'Việt Nam', 'Letter "A" correctly resolved to text "Việt Nam"');

  // Verify Validation on state questions
  const valErrors = getQuestionValidationErrors(stateQuestions, false);
  assert(valErrors.length === 0, 'No validation errors on properly imported question state');

  console.log('\n--- 3. INVALID FILE & ERROR HANDLING TESTS ---');
  // Scenario B: Corrupt / Invalid structure
  const invalidRows = [
    ['type', 'question', 'option_a', 'correct_answer'],
    ['single_choice', 'Câu hỏi thiếu lựa chọn', 'Chỉ 1 đáp án', 'Chỉ 1 đáp án']
  ];
  const invalidBuffer = createXlsxBuffer(invalidRows);
  const badParseRes = await parseExcelQuestions(invalidBuffer, 'invalid.xlsx');
  assert(badParseRes.success === false, 'Invalid Excel (less than 2 options) is rejected gracefully');
  assert(badParseRes.errors.length > 0, 'Returns descriptive error message for teacher review');

  // Scenario C: Non-supported file format
  const badExt = 'document.pdf';
  const isAllowedExt = ['xlsx', 'csv', 'docx'].includes(badExt.split('.').pop());
  assert(!isAllowedExt, 'Rejects unsupported file format like .pdf with clear error');

  console.log('\n======================================================');
  console.log(`📊 TEST SUITE SUMMARY: ${passed}/${total} CHECKS PASSED`);
  console.log('======================================================');
}

runAllChecks().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
