// scripts/test_question_bank_templates.mjs
// Comprehensive verification for Question Bank templates (Static & Client-side Generated)

import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import {
  parseExcelQuestions,
  parseWordQuestions
} from '../src/utils/questionFileParsers.js';
import {
  buildQuestionBankExcelWorkbook,
  generateQuestionBankExcelBuffer,
  buildQuestionBankDocxZip,
  generateQuestionBankDocxBuffer
} from '../src/utils/questionBankTemplateGenerators.js';

console.log('=== RUNNING QUESTION BANK TEMPLATES COMPREHENSIVE VERIFICATION ===');

const excelStaticPath = path.resolve('public/templates/Mau_Nhap_Cau_Hoi_Question_Bank.xlsx');
const docxStaticPath = path.resolve('public/templates/Mau_Nhap_Cau_Hoi_Question_Bank.docx');

// 1. VERIFY STATIC EXCEL TEMPLATE
{
  assert.equal(fs.existsSync(excelStaticPath), true, 'Static Excel template file must exist in public/templates/');
  const buffer = fs.readFileSync(excelStaticPath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  assert.ok(wb.SheetNames.includes('CauHoi'), 'Workbook must contain CauHoi sheet');
  assert.ok(wb.SheetNames.includes('HuongDan'), 'Workbook must contain HuongDan sheet');

  const ws = wb.Sheets['CauHoi'];
  const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const headers = rawRows[0].map(h => String(h).trim().toLowerCase());
  const expectedHeaders = ['type', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer', 'reference_answer', 'points'];
  assert.deepEqual(headers, expectedHeaders, 'Excel headers must match parser expectations exactly');

  const result = await parseExcelQuestions(arrayBuffer, 'Mau_Nhap_Cau_Hoi_Question_Bank.xlsx');
  assert.equal(result.errors.length, 0, `Static Excel parse must have 0 errors, got: ${JSON.stringify(result.errors)}`);
  assert.equal(result.questions.length, 4, `Static Excel parse must produce exactly 4 questions, got ${result.questions.length}`);

  const counts = { single_choice: 0, fill_blank: 0, essay: 0 };
  result.questions.forEach(q => {
    counts[q.question_type] = (counts[q.question_type] || 0) + 1;
  });

  assert.equal(counts.single_choice, 2, 'Static Excel must contain 2 single_choice questions');
  assert.equal(counts.fill_blank, 1, 'Static Excel must contain 1 fill_blank question');
  assert.equal(counts.essay, 1, 'Static Excel must contain 1 essay question');

  console.log('✔ [1/4] STATIC EXCEL TEMPLATE PASS: 4 questions parsed, 0 errors, types: { single_choice: 2, fill_blank: 1, essay: 1 }');
}

// 2. VERIFY STATIC DOCX TEMPLATE
{
  assert.equal(fs.existsSync(docxStaticPath), true, 'Static DOCX template file must exist in public/templates/');
  const buffer = fs.readFileSync(docxStaticPath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

  const zip = await JSZip.loadAsync(arrayBuffer);
  assert.ok(zip.file('[Content_Types].xml'), 'DOCX must contain [Content_Types].xml');
  assert.ok(zip.file('word/document.xml'), 'DOCX must contain word/document.xml');

  const mammothRes = await mammoth.extractRawText({ buffer });
  assert.ok(mammothRes.value && mammothRes.value.length > 50, 'Mammoth must extract non-empty raw text');
  assert.ok(mammothRes.value.includes('[TRẮC NGHIỆM]'), 'Extracted text must contain [TRẮC NGHIỆM]');
  assert.ok(mammothRes.value.includes('[ĐIỀN KHUYẾT]'), 'Extracted text must contain [ĐIỀN KHUYẾT]');
  assert.ok(mammothRes.value.includes('[TỰ LUẬN]'), 'Extracted text must contain [TỰ LUẬN]');

  const result = await parseWordQuestions(arrayBuffer, 'Mau_Nhap_Cau_Hoi_Question_Bank.docx');
  assert.equal(result.errors.length, 0, `Static DOCX parse must have 0 errors, got: ${JSON.stringify(result.errors)}`);
  assert.equal(result.questions.length, 4, `Static DOCX parse must produce exactly 4 questions, got ${result.questions.length}`);

  const counts = { single_choice: 0, fill_blank: 0, essay: 0 };
  result.questions.forEach(q => {
    counts[q.question_type] = (counts[q.question_type] || 0) + 1;
  });

  assert.equal(counts.single_choice, 2, 'Static DOCX must contain 2 single_choice questions');
  assert.equal(counts.fill_blank, 1, 'Static DOCX must contain 1 fill_blank question');
  assert.equal(counts.essay, 1, 'Static DOCX must contain 1 essay question');

  console.log('✔ [2/4] STATIC DOCX TEMPLATE PASS: 4 questions parsed, 0 errors, types: { single_choice: 2, fill_blank: 1, essay: 1 }');
}

// 3. VERIFY CLIENT-SIDE GENERATED EXCEL BUFFER
{
  const uint8 = generateQuestionBankExcelBuffer();
  assert.ok(uint8 && uint8.length > 1000, 'Generated Excel Uint8Array must be non-empty and valid size');

  const arrayBuffer = uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength);
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  assert.ok(wb.SheetNames.includes('CauHoi'), 'Generated Workbook must contain CauHoi sheet');
  assert.ok(wb.SheetNames.includes('HuongDan'), 'Generated Workbook must contain HuongDan sheet');

  const ws = wb.Sheets['CauHoi'];
  const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const headers = rawRows[0].map(h => String(h).trim().toLowerCase());
  const expectedHeaders = ['type', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer', 'reference_answer', 'points'];
  assert.deepEqual(headers, expectedHeaders, 'Generated Excel headers must match parser expectations exactly');

  const result = await parseExcelQuestions(arrayBuffer, 'Generated_Question_Bank.xlsx');
  assert.equal(result.errors.length, 0, `Generated Excel parse must have 0 errors, got: ${JSON.stringify(result.errors)}`);
  assert.equal(result.questions.length, 4, `Generated Excel parse must produce exactly 4 questions, got ${result.questions.length}`);

  const counts = { single_choice: 0, fill_blank: 0, essay: 0 };
  result.questions.forEach(q => {
    counts[q.question_type] = (counts[q.question_type] || 0) + 1;
  });

  assert.equal(counts.single_choice, 2, 'Generated Excel must contain 2 single_choice questions');
  assert.equal(counts.fill_blank, 1, 'Generated Excel must contain 1 fill_blank question');
  assert.equal(counts.essay, 1, 'Generated Excel must contain 1 essay question');

  console.log('✔ [3/4] CLIENT-SIDE GENERATED EXCEL PASS: 4 questions parsed, 0 errors, types: { single_choice: 2, fill_blank: 1, essay: 1 }');
}

// 4. VERIFY CLIENT-SIDE GENERATED DOCX BUFFER
{
  const uint8 = await generateQuestionBankDocxBuffer();
  assert.ok(uint8 && uint8.length > 500, 'Generated DOCX Uint8Array must be non-empty and valid size');

  const arrayBuffer = uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength);
  const zip = await JSZip.loadAsync(arrayBuffer);
  assert.ok(zip.file('[Content_Types].xml'), 'Generated DOCX must contain [Content_Types].xml');
  assert.ok(zip.file('word/document.xml'), 'Generated DOCX must contain word/document.xml');

  const buffer = Buffer.from(uint8);
  const mammothRes = await mammoth.extractRawText({ buffer });
  assert.ok(mammothRes.value && mammothRes.value.length > 50, 'Mammoth must extract non-empty raw text from generated DOCX');
  assert.ok(mammothRes.value.includes('[TRẮC NGHIỆM]'), 'Generated DOCX text must contain [TRẮC NGHIỆM]');
  assert.ok(mammothRes.value.includes('[ĐIỀN KHUYẾT]'), 'Generated DOCX text must contain [ĐIỀN KHUYẾT]');
  assert.ok(mammothRes.value.includes('[TỰ LUẬN]'), 'Generated DOCX text must contain [TỰ LUẬN]');

  const result = await parseWordQuestions(arrayBuffer, 'Generated_Question_Bank.docx');
  assert.equal(result.errors.length, 0, `Generated DOCX parse must have 0 errors, got: ${JSON.stringify(result.errors)}`);
  assert.equal(result.questions.length, 4, `Generated DOCX parse must produce exactly 4 questions, got ${result.questions.length}`);

  const counts = { single_choice: 0, fill_blank: 0, essay: 0 };
  result.questions.forEach(q => {
    counts[q.question_type] = (counts[q.question_type] || 0) + 1;
  });

  assert.equal(counts.single_choice, 2, 'Generated DOCX must contain 2 single_choice questions');
  assert.equal(counts.fill_blank, 1, 'Generated DOCX must contain 1 fill_blank question');
  assert.equal(counts.essay, 1, 'Generated DOCX must contain 1 essay question');

  console.log('✔ [4/4] CLIENT-SIDE GENERATED DOCX PASS: 4 questions parsed, 0 errors, types: { single_choice: 2, fill_blank: 1, essay: 1 }');
}

console.log('=== ALL 4 STATIC & CLIENT-SIDE TEMPLATE TESTS PASSED 100%! ===');