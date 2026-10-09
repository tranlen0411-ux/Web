import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import {
  normalizeOption,
  normalizeQuestionBankItemToCompetitionQuestion,
  normalizeImportedQuestionToCompetitionQuestion,
  reindexCompetitionQuestions,
  sanitizeQuestionsForCreation,
  isDuplicateQuestion,
  createCompetitionExcelTemplateWorkbook
} from '../src/utils/competitionQuestionAdapters.js';
import { parseExcelQuestions } from '../src/utils/questionFileParsers.js';

const hostPageContent = fs.readFileSync('src/pages/CompetitionHostPage.jsx', 'utf8');
const qbModalContent = fs.readFileSync('src/components/competition/CompetitionQuestionBankModal.jsx', 'utf8');
const excelModalContent = fs.readFileSync('src/components/competition/CompetitionImportExcelModal.jsx', 'utf8');
const adaptersContent = fs.readFileSync('src/utils/competitionQuestionAdapters.js', 'utf8');
const parsersContent = fs.readFileSync('src/utils/questionFileParsers.js', 'utf8');

test('COMPETITION V1 R14 — CONTRACT HARDENING & QUESTION SOURCES TEST SUITE', async (t) => {

  // =========================================================================
  // GROUP 1: QUESTION BANK AUTHORING DETAIL & FAIL-CLOSED INVARIANTS
  // =========================================================================
  await t.test('Group 1: Question Bank Authoring Detail & Fail-Closed Invariants', async (t) => {
    
    await t.test('1. Authoring detail success imports cleanly with option mapping and _sourceBankId', () => {
      const validDetail = {
        projection: 'authoring_safe',
        item: {
          id: '550e8400-e29b-41d4-a716-446655440001',
          title: 'Thủ đô nước Pháp',
          question_type: 'single_choice',
          points: 15,
          time_limit_seconds: 45
        },
        version: {
          id: 'v_france_1',
          prompt: 'Thủ đô của nước Pháp là thành phố nào?',
          question_type: 'single_choice',
          options: [
            { id: 'opt_paris_uuid', text: 'Paris' },
            { id: 'opt_lyon_uuid', text: 'Lyon' },
            { id: 'opt_marseille_uuid', text: 'Marseille' },
            { id: 'opt_nice_uuid', text: 'Nice' }
          ],
          explanation: 'Paris là thủ đô nước Pháp'
        },
        answer_key: {
          correct_answers: {
            correct_option_id: 'opt_paris_uuid'
          }
        }
      };

      const normalized = normalizeQuestionBankItemToCompetitionQuestion(validDetail, 1);
      assert.strictEqual(normalized.question_order, 1);
      assert.strictEqual(normalized.question_text, 'Thủ đô của nước Pháp là thành phố nào?');
      assert.strictEqual(normalized.question_type, 'single_choice');
      assert.strictEqual(normalized.points, 15);
      assert.strictEqual(normalized.time_limit_seconds, 45);
      assert.strictEqual(normalized.options.length, 4);
      assert.strictEqual(normalized.options[0].id, 'opt_1');
      assert.strictEqual(normalized.options[0].text, 'Paris');
      assert.deepStrictEqual(normalized.correct_answer, { option_id: 'opt_1' });
      assert.strictEqual(normalized._sourceBankId, '550e8400-e29b-41d4-a716-446655440001');
    });

    await t.test('2. Authoring detail failure does NOT fallback to list item (Modal uses Promise.allSettled and fails closed)', () => {
      // Static invariant check: Modal must NOT contain fallback return item in catch block
      assert.ok(!qbModalContent.includes('return item;'), 'Modal must not return list summary item on authoring detail failure');
      assert.match(qbModalContent, /Promise\.allSettled/, 'Modal must use Promise.allSettled for safe authoring detail retrieval');
      assert.match(qbModalContent, /failedItems\.length\s*>\s*0/, 'Modal must fail closed if any selected question fails detail retrieval');
    });

    await t.test('3. Malformed detail fails closed (throws descriptive error without corrupting state)', () => {
      const malformedDetailNoOptions = {
        item: { id: 'bad_item_1', question_type: 'single_choice' },
        version: { prompt: 'Câu hỏi không có lựa chọn', options: [] },
        answer_key: { correct_answers: 'A' }
      };

      assert.throws(() => {
        normalizeQuestionBankItemToCompetitionQuestion(malformedDetailNoOptions, 1);
      }, /yêu cầu ít nhất 2 phương án lựa chọn/);

      const malformedDetailNoAnswer = {
        item: { id: 'bad_item_2', question_type: 'single_choice' },
        version: {
          prompt: 'Câu hỏi không có đáp án',
          options: [{ text: 'Opt 1' }, { text: 'Opt 2' }]
        },
        answer_key: {}
      };

      assert.throws(() => {
        normalizeQuestionBankItemToCompetitionQuestion(malformedDetailNoAnswer, 1);
      }, /thiếu thông tin đáp án đúng/);
    });

    await t.test('4. Duplicate normalized prompt is blocked across batch and existing questions', () => {
      const existingQuestions = [
        {
          question_order: 1,
          question_text: 'Thủ đô của Việt Nam là thành phố nào?',
          _sourceBankId: 'bank_id_10'
        }
      ];

      // Same prompt text with different spacing and casing from another source ID
      const duplicatePromptCandidate = {
        question_text: '  thủ đô của việt nam là thành phố nào?  ',
        _sourceBankId: 'bank_id_99_different'
      };

      assert.strictEqual(
        isDuplicateQuestion(duplicatePromptCandidate, existingQuestions),
        true,
        'Must detect duplicate normalized prompt regardless of whitespace and case'
      );
    });

    await t.test('5. Duplicate source bank ID is blocked', () => {
      const existingQuestions = [
        {
          question_order: 1,
          question_text: 'Câu hỏi cũ',
          _sourceBankId: 'bank_item_uuid_123'
        }
      ];

      const sameBankIdCandidate = {
        question_text: 'Nội dung câu hỏi đã được sửa nhẹ',
        _sourceBankId: 'bank_item_uuid_123'
      };

      assert.strictEqual(
        isDuplicateQuestion(sameBankIdCandidate, existingQuestions),
        true,
        'Must block duplicate source bank ID'
      );
    });
  });

  // =========================================================================
  // GROUP 2: EXCEL TEMPLATE & TRUE TIME LIMIT ROUND-TRIP
  // =========================================================================
  await t.test('Group 2: Excel Template & True Time Limit Round-Trip', async (t) => {
    
    const wb = createCompetitionExcelTemplateWorkbook();
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const parsed = await parseExcelQuestions(buffer, 'template_roundtrip.xlsx');

    assert.strictEqual(parsed.success, true, 'Standard template must parse with 100% success');
    assert.strictEqual(parsed.errors.length, 0);
    assert.strictEqual(parsed.questions.length, 3);

    await t.test('6. Template time 25 survives parse and normalization', () => {
      const q1 = parsed.questions[0];
      assert.strictEqual(q1.time_limit_seconds, 25, 'Parser must preserve 25 seconds');
      const compQ1 = normalizeImportedQuestionToCompetitionQuestion(q1, 1);
      assert.strictEqual(compQ1.time_limit_seconds, 25, 'Competition adapter must preserve 25 seconds');
    });

    await t.test('7. Template time 45 survives parse and normalization', () => {
      const q2 = parsed.questions[1];
      assert.strictEqual(q2.time_limit_seconds, 45, 'Parser must preserve 45 seconds');
      const compQ2 = normalizeImportedQuestionToCompetitionQuestion(q2, 2);
      assert.strictEqual(compQ2.time_limit_seconds, 45, 'Competition adapter must preserve 45 seconds');
    });

    await t.test('8. Template time 60 survives parse and normalization', () => {
      const q3 = parsed.questions[2];
      assert.strictEqual(q3.time_limit_seconds, 60, 'Parser must preserve 60 seconds');
      const compQ3 = normalizeImportedQuestionToCompetitionQuestion(q3, 3);
      assert.strictEqual(compQ3.time_limit_seconds, 60, 'Competition adapter must preserve 60 seconds');
    });

    await t.test('9. Missing time safely defaults to Competition 30 seconds', async () => {
      const headers = ['type', 'question', 'option_a', 'option_b', 'correct_answer'];
      const rows = [
        ['single_choice', 'Câu hỏi không có thời gian', 'A1', 'B2', 'A']
      ];
      const testWs = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      const testWb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(testWb, testWs, 'Sheet1');
      const testBuf = XLSX.write(testWb, { type: 'array', bookType: 'xlsx' });

      const res = await parseExcelQuestions(testBuf, 'no_time.xlsx');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.questions[0].time_limit_seconds, undefined, 'Parser leaves omitted time as undefined');

      const compQ = normalizeImportedQuestionToCompetitionQuestion(res.questions[0], 1);
      assert.strictEqual(compQ.time_limit_seconds, 30, 'Competition adapter defaults missing time to 30');
    });

    await t.test('10. Invalid time produces row-level validation error in parser', async () => {
      const headers = ['type', 'question', 'option_a', 'option_b', 'correct_answer', 'time_limit_seconds'];
      const rows = [
        ['single_choice', 'Câu hỏi thời gian quá ngắn', 'A1', 'B2', 'A', 3], // < 5 seconds
        ['single_choice', 'Câu hỏi thời gian quá dài', 'A1', 'B2', 'A', 999]  // > 600 seconds
      ];
      const testWs = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      const testWb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(testWb, testWs, 'Sheet1');
      const testBuf = XLSX.write(testWb, { type: 'array', bookType: 'xlsx' });

      const res = await parseExcelQuestions(testBuf, 'invalid_time.xlsx');
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.errors.length, 2);
      assert.strictEqual(res.errors[0].row, 2);
      assert.match(res.errors[0].message, /Thời gian làm bài "3" không hợp lệ/);
      assert.strictEqual(res.errors[1].row, 3);
      assert.match(res.errors[1].message, /Thời gian làm bài "999" không hợp lệ/);
    });
  });

  // =========================================================================
  // GROUP 3: EXCEL ROW-LEVEL VS STRUCTURAL ERROR ISOLATION
  // =========================================================================
  await t.test('Group 3: Excel Row-level vs Structural Error Isolation', async (t) => {

    await t.test('11. One valid + one malformed row: valid row remains parsed and importable', async () => {
      const headers = ['type', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer', 'time_limit_seconds'];
      const rows = [
        ['single_choice', 'Câu 1 hợp lệ chuẩn', 'Đáp án 1', 'Đáp án 2', 'Đáp án 3', 'Đáp án 4', 'A', 25],
        ['single_choice', 'Câu 2 bị lỗi thời gian', 'Opt A', 'Opt B', 'Opt C', 'Opt D', 'A', 999]
      ];
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

      const res = await parseExcelQuestions(buf, 'mixed_rows.xlsx');
      assert.strictEqual(res.questions.length, 1, 'Valid row must be preserved in questions');
      assert.strictEqual(res.questions[0].prompt, 'Câu 1 hợp lệ chuẩn');
      assert.strictEqual(res.errors.length, 1, 'Malformed row must be recorded in errors');
      assert.strictEqual(res.errors[0].row, 3);
    });

    await t.test('12. Row error displayed and modal distinguishes row error vs structural error', () => {
      assert.match(excelModalContent, /structuralError\s*=\s*res\.errors\?\.find/);
      assert.match(excelModalContent, /rowErrors\s*=\s*res\.errors\?\.filter/);
      assert.match(excelModalContent, /LỖI ĐỊNH DẠNG|L\?I D\?NH D\?NG/);
    });

    await t.test('13. Structural missing-header error aborts whole file', async () => {
      const headers = ['invalid_header_1', 'invalid_header_2'];
      const rows = [['data1', 'data2']];
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

      const res = await parseExcelQuestions(buf, 'missing_headers.xlsx');
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.questions.length, 0);
      assert.strictEqual(res.errors[0].row, 1);
      assert.match(res.errors[0].message, /Thiếu các cột bắt buộc: type, question/);
    });

    await t.test('14. Unsupported question type rejected by Competition modal (single_choice only)', () => {
      const fillBlankRow = {
        question_type: 'fill_blank',
        question_text: 'Điền vào chỗ trống',
        correct_answer: '10'
      };

      assert.throws(() => {
        normalizeImportedQuestionToCompetitionQuestion(fillBlankRow, 1);
      }, /R14 hiện chỉ hỗ trợ Trắc nghiệm 1 đáp án/);

      const essayRow = {
        question_type: 'essay',
        question_text: 'Viết đoạn văn',
        correct_answer: 'Mẫu'
      };

      assert.throws(() => {
        normalizeImportedQuestionToCompetitionQuestion(essayRow, 1);
      }, /R14 hiện chỉ hỗ trợ Trắc nghiệm 1 đáp án/);
    });
  });

  // =========================================================================
  // GROUP 4: SESSION LIMITS, RPC PAYLOAD & ZERO LIVE FK INVARIANTS
  // =========================================================================
  await t.test('Group 4: Session Limits, RPC Payload & Zero Live FK Invariants', async (t) => {
    
    await t.test('15. Shared max 5 limit strictly enforced across all sources', () => {
      assert.match(hostPageContent, /const\s+remaining\s*=\s*5\s*-\s*questions\.length;/);
      assert.match(hostPageContent, /const\s+toAdd\s*=\s*newQuestions\.slice\(0,\s*remaining\);/);
      assert.match(hostPageContent, /disabled=\{questions\.length\s*>=\s*5\}/);
    });

    await t.test('16. Canonical hostCreateSession payload structure remains exact and compliant', () => {
      const rawCompetitionQuestions = [
        {
          question_order: 1,
          question_text: 'Câu 1',
          question_type: 'single_choice',
          points: 10,
          time_limit_seconds: 25,
          options: [
            { id: 'opt_1', text: 'A' },
            { id: 'opt_2', text: 'B' }
          ],
          correct_answer: { option_id: 'opt_1' },
          _sourceBankId: 'bank_uuid_should_be_stripped',
          extra_internal_state: 'garbage'
        }
      ];

      const sanitized = sanitizeQuestionsForCreation(rawCompetitionQuestions);
      assert.deepStrictEqual(sanitized, [
        {
          question_order: 1,
          question_text: 'Câu 1',
          question_type: 'single_choice',
          points: 10,
          time_limit_seconds: 25,
          options: [
            { id: 'opt_1', text: 'A' },
            { id: 'opt_2', text: 'B' }
          ],
          correct_answer: { option_id: 'opt_1' }
        }
      ]);
    });

    await t.test('17. _sourceBankId and external metadata are 100% stripped before RPC (No live FK created)', () => {
      const testList = [
        {
          question_order: 1,
          question_text: 'Câu hỏi từ Ngân hàng',
          question_type: 'single_choice',
          points: 10,
          time_limit_seconds: 30,
          options: [{ id: 'opt_1', text: 'A' }, { id: 'opt_2', text: 'B' }],
          correct_answer: { option_id: 'opt_1' },
          _sourceBankId: 'qb_12345'
        }
      ];

      const sanitized = sanitizeQuestionsForCreation(testList);
      assert.strictEqual(sanitized[0]._sourceBankId, undefined);
      assert.strictEqual(Object.keys(sanitized[0]).includes('_sourceBankId'), false);
    });
  });
});