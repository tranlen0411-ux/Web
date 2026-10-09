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

test('COMPETITION V1 R14 - QUESTION SOURCES PHASE 1 TEST SUITE', async (t) => {

  await t.test('Group 1: Source Chooser UI & Integration', async (t) => {
    await t.test('1. Host Page imports Question Bank Modal and Excel Modal', () => {
      assert.match(hostPageContent, /import\s*\{\s*CompetitionQuestionBankModal\s*\}\s*from/);
      assert.match(hostPageContent, /import\s*\{\s*CompetitionImportExcelModal\s*\}\s*from/);
    });

    await t.test('2. Host Page defines state for both modals and add menu', () => {
      assert.match(hostPageContent, /const\s*\[isQuestionBankModalOpen,\s*setIsQuestionBankModalOpen\]\s*=\s*useState\(false\);/);
      assert.match(hostPageContent, /const\s*\[isImportExcelModalOpen,\s*setIsImportExcelModalOpen\]\s*=\s*useState\(false\);/);
      assert.match(hostPageContent, /const\s*\[isAddMenuOpen,\s*setIsAddMenuOpen\]\s*=\s*useState\(false\);/);
    });

    await t.test('3. Chooser dropdown provides 3 question adding methods', () => {
      assert.match(hostPageContent, /Tạo câu hỏi mới|T\?o cu h\?i m\?i/i);
      assert.match(hostPageContent, /Chọn từ Ngân hàng|Ch\?n t\? Ngn hng/i);
      assert.match(hostPageContent, /Nhập từ file Excel|Nh\?p t\? file Excel/i);
    });

    await t.test('4. Both modals are rendered with existing questions and maxAllowed=5', () => {
      assert.match(hostPageContent, /<CompetitionQuestionBankModal[\s\S]*?isOpen=\{isQuestionBankModalOpen\}[\s\S]*?maxAllowed=\{5\}/);
      assert.match(hostPageContent, /<CompetitionImportExcelModal[\s\S]*?isOpen=\{isImportExcelModalOpen\}[\s\S]*?maxAllowed=\{5\}/);
    });
  });

  await t.test('Group 2: Question Bank Modal & BFF API Invariants', async (t) => {
    await t.test('1. Uses listQuestions and getQuestionAuthoringDetail from questionBankService (no direct table select)', () => {
      assert.match(qbModalContent, /import\s*\{[^}]*listQuestions[^}]*\}\s*from\s*['"]\.\.\/\.\.\/services\/questionBankService(\.js)?['"]/);
      assert.match(qbModalContent, /import\s*\{[^}]*getQuestionAuthoringDetail[^}]*\}\s*from\s*['"]\.\.\/\.\.\/services\/questionBankService(\.js)?['"]/);
      assert.ok(!qbModalContent.includes("from('question_bank_items')"), 'Must not query question_bank_items directly');
      assert.ok(!qbModalContent.includes("from('competition_questions')"), 'Must not query competition_questions directly');
    });

    await t.test('2. Phase 1 requests ONLY single_choice and published questions', () => {
      assert.match(qbModalContent, /question_type:\s*['"]single_choice['"]/);
      assert.match(qbModalContent, /status:\s*['"]published['"]/);
    });

    await t.test('3. Modal calculates remainingSlots and restricts selection over limit', () => {
      assert.match(qbModalContent, /const\s+remainingSlots\s*=\s*Math\.max\(0,\s*maxAllowed\s*-\s*existingQuestions\.length\);/);
      assert.match(qbModalContent, /newMap\.size\s*>=\s*remainingSlots/);
    });

    await t.test('4. Modal highlights already added questions (duplicate guard)', () => {
      assert.match(qbModalContent, /isDuplicateQuestion/);
      assert.match(qbModalContent, /ĐÃ CÓ TRONG PHÒNG|DA CO TRONG PHONG/);
    });

    await t.test('5. Modal calls getQuestionAuthoringDetail on confirm import with loading indicator', () => {
      assert.match(qbModalContent, /getQuestionAuthoringDetail\(item\.id/);
      assert.match(qbModalContent, /isImporting/);
    });
  });

  await t.test('Group 3: Excel Import Modal & Parser Invariants', async (t) => {
    await t.test('1. Reuses parseExcelQuestions from questionFileParsers', () => {
      assert.match(excelModalContent, /import\s*\{\s*parseExcelQuestions\s*\}\s*from\s*['"]\.\.\/\.\.\/utils\/questionFileParsers(\.js)?['"]/);
    });

    await t.test('2. Provides downloadable Competition Excel template', () => {
      assert.match(excelModalContent, /downloadCompetitionExcelTemplate/);
      assert.match(excelModalContent, /Tải file mẫu Excel|T\?i file m\?u Excel/);
    });

    await t.test('3. Row-level validation evaluates valid vs malformed rows', () => {
      assert.match(excelModalContent, /normalizeImportedQuestionToCompetitionQuestion/);
      assert.match(excelModalContent, /HỢP LỆ|H\?P L\?/);
      assert.match(excelModalContent, /LỖI ĐỊNH DẠNG|L\?I D\?NH D\?NG/);
    });

    await t.test('4. Auto-selects valid rows only up to remainingSlots', () => {
      assert.match(excelModalContent, /autoSelected\.size\s*<\s*remainingSlots/);
    });

    await t.test('5. Excel template round-trip with parseExcelQuestions (100% fidelity)', async () => {
      const wb = createCompetitionExcelTemplateWorkbook();
      const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      const parsed = await parseExcelQuestions(buffer, 'template_test.xlsx');

      assert.strictEqual(parsed.success, true, 'parseExcelQuestions must succeed for standard template');
      assert.strictEqual(parsed.errors.length, 0, 'parseExcelQuestions must return 0 errors for template');
      assert.strictEqual(parsed.questions.length, 3, 'parseExcelQuestions must parse 3 sample questions');

      // Verify each parsed question can be normalized to competition format
      const compQuestions = parsed.questions.map((q, idx) =>
        normalizeImportedQuestionToCompetitionQuestion(q, idx + 1)
      );
      assert.strictEqual(compQuestions.length, 3);
      assert.strictEqual(compQuestions[0].question_order, 1);
      assert.strictEqual(compQuestions[0].question_type, 'single_choice');
      assert.strictEqual(compQuestions[0].options.length, 4);
      assert.deepStrictEqual(compQuestions[0].correct_answer, { option_id: 'opt_1' });
      assert.strictEqual(compQuestions[0].points, 10);
      assert.strictEqual(compQuestions[0].time_limit_seconds, 30);
    });
  });

  await t.test('Group 4: Adapter Logic & Canonical Normalization', async (t) => {
    await t.test('1. normalizeOption formats id as opt_N and trims text', () => {
      assert.deepStrictEqual(normalizeOption('  Hà Nội  ', 0), { id: 'opt_1', text: 'Hà Nội' });
      assert.deepStrictEqual(normalizeOption({ text: '  Đà Nẵng ' }, 2), { id: 'opt_3', text: 'Đà Nẵng' });
    });

    await t.test('2. normalizeQuestionBankItemToCompetitionQuestion maps letter A/B/C/D to opt_1..4', () => {
      const qbItem = {
        id: 'qb_123',
        question_type: 'single_choice',
        prompt: '1 + 1 = ?',
        options: ['1', '2', '3', '4'],
        correct_answer: 'B',
        points: 10,
        time_limit_seconds: 45
      };
      const normalized = normalizeQuestionBankItemToCompetitionQuestion(qbItem, 1);
      assert.strictEqual(normalized.question_order, 1);
      assert.strictEqual(normalized.question_text, '1 + 1 = ?');
      assert.strictEqual(normalized.question_type, 'single_choice');
      assert.strictEqual(normalized.points, 10);
      assert.strictEqual(normalized.time_limit_seconds, 45);
      assert.deepStrictEqual(normalized.correct_answer, { option_id: 'opt_2' });
      assert.strictEqual(normalized.options.length, 4);
      assert.strictEqual(normalized.options[1].id, 'opt_2');
      assert.strictEqual(normalized.options[1].text, '2');
      assert.strictEqual(normalized._sourceBankId, 'qb_123');
    });

    await t.test('3. normalizeQuestionBankItemToCompetitionQuestion maps full authoring detail ({ item, version, answer_key })', () => {
      const authoringDetail = {
        projection: 'authoring_safe',
        item: {
          id: 'qb_authoring_detail_uuid',
          title: 'Thủ đô của Pháp',
          question_type: 'single_choice',
          difficulty: 'medium',
          points: 15,
          time_limit_seconds: 40
        },
        version: {
          id: 'v_detail_uuid',
          prompt: 'Thủ đô của nước Pháp là thành phố nào?',
          question_type: 'single_choice',
          options: [
            { id: 'opt_uuid_10', text: 'London' },
            { id: 'opt_uuid_20', text: 'Berlin' },
            { id: 'opt_uuid_30', text: 'Paris' },
            { id: 'opt_uuid_40', text: 'Rome' }
          ],
          explanation: 'Paris là thủ đô nước Pháp'
        },
        answer_key: {
          correct_answers: {
            correct_option_id: 'opt_uuid_30'
          }
        }
      };

      const normalized = normalizeQuestionBankItemToCompetitionQuestion(authoringDetail, 2);
      assert.strictEqual(normalized.question_order, 2);
      assert.strictEqual(normalized.question_text, 'Thủ đô của nước Pháp là thành phố nào?');
      assert.strictEqual(normalized.question_type, 'single_choice');
      assert.strictEqual(normalized.points, 15);
      assert.strictEqual(normalized.time_limit_seconds, 40);
      assert.strictEqual(normalized.options.length, 4);
      assert.strictEqual(normalized.options[2].id, 'opt_3');
      assert.strictEqual(normalized.options[2].text, 'Paris');
      assert.deepStrictEqual(normalized.correct_answer, { option_id: 'opt_3' });
      assert.strictEqual(normalized.explanation, 'Paris là thủ đô nước Pháp');
      assert.strictEqual(normalized._sourceBankId, 'qb_authoring_detail_uuid');
    });

    await t.test('4. normalizeQuestionBankItemToCompetitionQuestion handles answer_key array format', () => {
      const authoringDetailArray = {
        item: { id: 'qb_arr_uuid', question_type: 'single_choice' },
        version: {
          prompt: 'Chọn đáp án A',
          options: [
            { id: 'uuid_a', text: 'Đáp án A' },
            { id: 'uuid_b', text: 'Đáp án B' }
          ]
        },
        answer_key: {
          correct_answers: ['uuid_a']
        }
      };

      const normalized = normalizeQuestionBankItemToCompetitionQuestion(authoringDetailArray, 1);
      assert.deepStrictEqual(normalized.correct_answer, { option_id: 'opt_1' });
    });

    await t.test('5. normalizeQuestionBankItemToCompetitionQuestion rejects non-single_choice (Fail Closed)', () => {
      const qbMulti = {
        id: 'qb_multi',
        question_type: 'multiple_choice',
        prompt: 'Chọn các số chẵn',
        options: ['1', '2', '3', '4'],
        correct_answer: ['B', 'D']
      };
      assert.throws(() => {
        normalizeQuestionBankItemToCompetitionQuestion(qbMulti, 1);
      }, /chưa được hỗ trợ trong Đấu trường R14|chua du\?c h\? tr\?/i);
    });

    await t.test('6. normalizeQuestionBankItemToCompetitionQuestion rejects missing correct answer (Fail Closed)', () => {
      const qbInvalid = {
        id: 'qb_no_ans',
        question_type: 'single_choice',
        prompt: 'Câu hỏi không có đáp án',
        options: ['A', 'B'],
        correct_answer: null
      };
      assert.throws(() => {
        normalizeQuestionBankItemToCompetitionQuestion(qbInvalid, 1);
      }, /thiếu thông tin đáp án đúng|thi\?u thng tin dp n dng/i);
    });

    await t.test('7. normalizeImportedQuestionToCompetitionQuestion parses Excel columns accurately', () => {
      const excelRow = {
        question_text: 'Đâu là loài linh trưởng?',
        option_a: 'Vượn',
        option_b: 'Cá voi',
        option_c: 'Đại bàng',
        option_d: 'Hổ',
        correct_answer: 'A',
        points: 10,
        time_limit_seconds: 30
      };
      const normalized = normalizeImportedQuestionToCompetitionQuestion(excelRow, 3);
      assert.strictEqual(normalized.question_order, 3);
      assert.strictEqual(normalized.question_text, 'Đâu là loài linh trưởng?');
      assert.strictEqual(normalized.options.length, 4);
      assert.deepStrictEqual(normalized.correct_answer, { option_id: 'opt_1' });
    });

    await t.test('8. normalizeImportedQuestionToCompetitionQuestion rejects rows with < 2 options', () => {
      const excelRow = {
        question_text: 'Một phương án?',
        option_a: 'Duy nhất',
        correct_answer: 'A'
      };
      assert.throws(() => {
        normalizeImportedQuestionToCompetitionQuestion(excelRow, 1);
      }, /ít nhất 2 phương án|t nh\?t 2 phuong n/i);
    });

    await t.test('9. normalizeImportedQuestionToCompetitionQuestion rejects unresolvable correct answer', () => {
      const excelRow = {
        question_text: 'Đáp án sai lệch?',
        option_a: 'Lựa chọn 1',
        option_b: 'Lựa chọn 2',
        correct_answer: 'XYZ'
      };
      assert.throws(() => {
        normalizeImportedQuestionToCompetitionQuestion(excelRow, 1);
      }, /không khớp với bất kỳ phương án nào|khng kh\?p v\?i b\?t k\? phuong n no/i);
    });

    await t.test('10. reindexCompetitionQuestions produces contiguous 1..N order', () => {
      const unordered = [
        { question_order: 5, question_text: 'Q1' },
        { question_order: 9, question_text: 'Q2' },
        { question_order: 1, question_text: 'Q3' }
      ];
      const reindexed = reindexCompetitionQuestions(unordered);
      assert.strictEqual(reindexed[0].question_order, 1);
      assert.strictEqual(reindexed[1].question_order, 2);
      assert.strictEqual(reindexed[2].question_order, 3);
    });

    await t.test('11. sanitizeQuestionsForCreation strips non-canonical metadata (_sourceBankId)', () => {
      const dirty = [
        {
          question_order: 1,
          question_text: 'Clean Q',
          question_type: 'single_choice',
          points: 10,
          time_limit_seconds: 30,
          options: [{ id: 'opt_1', text: 'A' }, { id: 'opt_2', text: 'B' }],
          correct_answer: { option_id: 'opt_1' },
          _sourceBankId: 'foreign_bank_uuid_123',
          extra_garbage: true
        }
      ];
      const sanitized = sanitizeQuestionsForCreation(dirty);
      assert.deepStrictEqual(sanitized, [
        {
          question_order: 1,
          question_text: 'Clean Q',
          question_type: 'single_choice',
          points: 10,
          time_limit_seconds: 30,
          options: [{ id: 'opt_1', text: 'A' }, { id: 'opt_2', text: 'B' }],
          correct_answer: { option_id: 'opt_1' }
        }
      ]);
      assert.strictEqual(sanitized[0]._sourceBankId, undefined);
      assert.strictEqual(sanitized[0].extra_garbage, undefined);
    });

    await t.test('12. isDuplicateQuestion detects identical bank id and prompt text', () => {
      const existing = [
        { question_order: 1, question_text: 'Hà Nội là thủ đô nước nào?', _sourceBankId: 'bank_item_1' }
      ];
      assert.strictEqual(isDuplicateQuestion({ _sourceBankId: 'bank_item_1', question_text: 'Khác' }, existing), true);
      assert.strictEqual(isDuplicateQuestion({ _sourceBankId: 'bank_item_2', question_text: 'Hà Nội là thủ đô nước nào?' }, existing), true);
      assert.strictEqual(isDuplicateQuestion({ _sourceBankId: 'bank_item_3', question_text: 'Câu hỏi hoàn toàn mới' }, existing), false);
    });
  });

  await t.test('Group 5: Shared Max 5 Limit & Copy-Snapshot Invariants', async (t) => {
    await t.test('1. Host Page import handlers cap imports to 5 - questions.length', () => {
      assert.match(hostPageContent, /const\s+remaining\s*=\s*5\s*-\s*questions\.length;/);
      assert.match(hostPageContent, /const\s+toAdd\s*=\s*newQuestions\.slice\(0,\s*remaining\);/);
      assert.match(hostPageContent, /Đã đạt giới hạn tối đa 5 câu hỏi trong phòng thi|Da d\?t gi\?i h\?n t\?i da 5 cu h\?i trong phng thi/i);
    });

    await t.test('2. Manual add button is disabled at questions.length >= 5', () => {
      assert.match(hostPageContent, /disabled=\{questions\.length\s*>=\s*5\}/);
    });

    await t.test('3. hostCreateSession uses sanitized questions snapshot', () => {
      assert.match(hostPageContent, /const\s+sanitizedQuestions\s*=\s*sanitizeQuestionsForCreation\(questions\);/);
      assert.match(hostPageContent, /questions:\s*sanitizedQuestions/);
    });
  });
});