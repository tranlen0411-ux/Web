// scripts/test_question_bank_templates.mjs
// Unit tests for Question Bank V2A Official Excel & Word Template files

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

console.log('=== RUNNING QUESTION BANK TEMPLATES VERIFICATION ===');

const excelPath = path.resolve('public/templates/Mau_Nhap_Cau_Hoi_Question_Bank.xlsx');
const docxPath = path.resolve('public/templates/Mau_Nhap_Cau_Hoi_Question_Bank.docx');

// 1. VERIFY EXCEL TEMPLATE
{
  assert.equal(fs.existsSync(excelPath), true, 'Excel template file must exist');
  const buffer = fs.readFileSync(excelPath);
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
  assert.equal(result.errors.length, 0, `Excel parse must have 0 errors, got: ${JSON.stringify(result.errors)}`);
  assert.equal(result.questions.length, 4, `Excel parse must produce exactly 4 questions, got ${result.questions.length}`);

  const counts = { single_choice: 0, fill_blank: 0, essay: 0 };
  result.questions.forEach(q => {
    counts[q.question_type] = (counts[q.question_type] || 0) + 1;
  });

  assert.equal(counts.single_choice, 2, 'Excel must contain 2 single_choice questions');
  assert.equal(counts.fill_blank, 1, 'Excel must contain 1 fill_blank question');
  assert.equal(counts.essay, 1, 'Excel must contain 1 essay question');

  console.log('✔ EXCEL TEMPLATE PASS: 4 questions parsed, 0 errors, types: { single_choice: 2, fill_blank: 1, essay: 1 }');
}

// 2. VERIFY DOCX TEMPLATE
{
  assert.equal(fs.existsSync(docxPath), true, 'DOCX template file must exist');
  const buffer = fs.readFileSync(docxPath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

  // Check valid ZIP and OpenXML entries
  const zip = await JSZip.loadAsync(arrayBuffer);
  assert.ok(zip.file('[Content_Types].xml'), 'DOCX must contain [Content_Types].xml');
  assert.ok(zip.file('word/document.xml'), 'DOCX must contain word/document.xml');

  // Check mammoth reading directly via buffer
  const mammothRes = await mammoth.extractRawText({ buffer });
  assert.ok(mammothRes.value && mammothRes.value.length > 50, 'Mammoth must extract non-empty raw text');
  assert.ok(mammothRes.value.includes('[TRẮC NGHIỆM]'), 'Extracted text must contain [TRẮC NGHIỆM]');
  assert.ok(mammothRes.value.includes('[ĐIỀN KHUYẾT]'), 'Extracted text must contain [ĐIỀN KHUYẾT]');
  assert.ok(mammothRes.value.includes('[TỰ LUẬN]'), 'Extracted text must contain [TỰ LUẬN]');

  // Check real parser using arrayBuffer
  const result = await parseWordQuestions(arrayBuffer, 'Mau_Nhap_Cau_Hoi_Question_Bank.docx');
  assert.equal(result.errors.length, 0, `DOCX parse must have 0 errors, got: ${JSON.stringify(result.errors)}`);
  assert.equal(result.questions.length, 4, `DOCX parse must produce exactly 4 questions, got ${result.questions.length}`);

  const counts = { single_choice: 0, fill_blank: 0, essay: 0 };
  result.questions.forEach(q => {
    counts[q.question_type] = (counts[q.question_type] || 0) + 1;
  });

  assert.equal(counts.single_choice, 2, 'DOCX must contain 2 single_choice questions');
  assert.equal(counts.fill_blank, 1, 'DOCX must contain 1 fill_blank question');
  assert.equal(counts.essay, 1, 'DOCX must contain 1 essay question');

  console.log('✔ DOCX TEMPLATE PASS: 4 questions parsed, 0 errors, types: { single_choice: 2, fill_blank: 1, essay: 1 }');
}

console.log('=== ALL TEMPLATE TESTS PASSED 100%! ===');