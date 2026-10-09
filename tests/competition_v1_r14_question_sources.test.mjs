import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizeOption,
  normalizeQuestionBankItemToCompetitionQuestion,
  normalizeImportedQuestionToCompetitionQuestion,
  reindexCompetitionQuestions,
  sanitizeQuestionsForCreation,
  isDuplicateQuestion
} from '../src/utils/competitionQuestionAdapters.js';

const hostPageContent = fs.readFileSync('src/pages/CompetitionHostPage.jsx', 'utf8');
const qbModalContent = fs.readFileSync('src/components/competition/CompetitionQuestionBankModal.jsx', 'utf8');
const excelModalContent = fs.readFileSync('src/components/competition/CompetitionImportExcelModal.jsx', 'utf8');
const adaptersContent = fs.readFileSync('src/utils/competitionQuestionAdapters.js', 'utf8');

test('COMPETITION V1 R14 — QUESTION SOURCES PHASE 1 TEST SUITE', async (t) => {

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
      assert.match(hostPageContent, /Tạo câu hỏi mới/);
      assert.match(hostPageContent, /Chọn từ Ngân hàng/);
      assert.match(hostPageContent, /Nhập từ file Excel/);
    });

    await t.test('4. Both modals are rendered with existing questions and maxAllowed=5', () => {
      assert.match(hostPageContent, /<CompetitionQuestionBankModal[\s\S]*?isOpen=\{isQuestionBankModalOpen\}[\s\S]*?maxAllowed=\{5\}/);
      assert.match(hostPageContent, /<CompetitionImportExcelModal[\s\S]*?isOpen=\{isImportExcelModalOpen\}[\s\S]*?maxAllowed=\{5\}/);
    });
  });

  await t.test('Group 2: Question Bank Modal & BFF API Invariants', async (t) => {
    await t.test('1. Uses listQuestions from questionBankService (no direct table select)', () => {
      assert.match(qbModalContent, /import\s*\{\s*listQuestions\s*\}\s*from\s*['"]\.\.\/\.\.\/services\/questionBankService(\.js)?['"]/);
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
      assert.match(qbModalContent, /ĐÃ CÓ TRONG PHÒNG/);
    });
  });

  await t.test('Group 3: Excel Import Modal & Parser Invariants', async (t) => {
    await t.test('1. Reuses parseExcelQuestions from questionFileParsers', () => {
      assert.match(excelModalContent, /import\s*\{\s*parseExcelQuestions\s*\}\s*from\s*['"]\.\.\/\.\.\/utils\/questionFileParsers(\.js)?['"]/);
    });

    await t.test('2. Provides downloadable Competition Excel template', () => {
      assert.match(excelModalContent, /downloadCompetitionExcelTemplate/);
      assert.match(excelModalContent, /Tải file mẫu Excel/);
    });

    await t.test('3. Row-level validation evaluates valid vs malformed rows', () => {
      assert.match(excelModalContent, /normalizeImportedQuestionToCompetitionQuestion/);
      assert.match(excelModalContent, /HỢP LỆ/);
      assert.match(excelModalContent, /LỖI ĐỊNH DẠNG/);
    });

    await t.test('4. Auto-selects valid rows only up to remainingSlots', () => {
      assert.match(excelModalContent, /autoSelected\.size\s*<\s*remainingSlots/);
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

    await t.test('3. normalizeQuestionBankItemToCompetitionQuestion maps option text directly', () => {
      const qbItem = {
        id: 'qb_456',
        question_type: 'single_choice',
        prompt: 'Thủ đô của Pháp là?',
        options: [
          { text: 'London' },
          { text: 'Berlin' },
          { text: 'Paris' },
          { text: 'Rome' }
        ],
        correct_answer: { option_id: 'Paris' }
      };
      const normalized = normalizeQuestionBankItemToCompetitionQuestion(qbItem, 2);
      assert.deepStrictEqual(normalized.correct_answer, { option_id: 'opt_3' });
      assert.strictEqual(normalized.options[2].text, 'Paris');
    });

    await t.test('4. normalizeQuestionBankItemToCompetitionQuestion rejects non-single_choice (Fail Closed)', () => {
      const qbMulti = {
        id: 'qb_multi',
        question_type: 'multiple_choice',
        prompt: 'Chọn các số chẵn',
        options: ['1', '2', '3', '4'],
        correct_answer: ['B', 'D']
      };
      assert.throws(() => {
        normalizeQuestionBankItemToCompetitionQuestion(qbMulti, 1);
      }, /chưa được hỗ trợ trong Đấu trường R14/);
    });

    await t.test('5. normalizeQuestionBankItemToCompetitionQuestion rejects missing correct answer (Fail Closed)', () => {
      const qbInvalid = {
        id: 'qb_no_ans',
        question_type: 'single_choice',
        prompt: 'Câu hỏi không có đáp án',
        options: ['A', 'B'],
        correct_answer: null
      };
      assert.throws(() => {
        normalizeQuestionBankItemToCompetitionQuestion(qbInvalid, 1);
      }, /thiếu thông tin đáp án đúng/);
    });

    await t.test('6. normalizeImportedQuestionToCompetitionQuestion parses Excel columns accurately', () => {
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

    await t.test('7. normalizeImportedQuestionToCompetitionQuestion rejects rows with < 2 options', () => {
      const excelRow = {
        question_text: 'Một phương án?',
        option_a: 'Duy nhất',
        correct_answer: 'A'
      };
      assert.throws(() => {
        normalizeImportedQuestionToCompetitionQuestion(excelRow, 1);
      }, /ít nhất 2 phương án/);
    });

    await t.test('8. normalizeImportedQuestionToCompetitionQuestion rejects unresolvable correct answer', () => {
      const excelRow = {
        question_text: 'Đáp án sai lệch?',
        option_a: 'Lựa chọn 1',
        option_b: 'Lựa chọn 2',
        correct_answer: 'XYZ'
      };
      assert.throws(() => {
        normalizeImportedQuestionToCompetitionQuestion(excelRow, 1);
      }, /không khớp với bất kỳ phương án nào/);
    });

    await t.test('9. reindexCompetitionQuestions produces contiguous 1..N order', () => {
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

    await t.test('10. sanitizeQuestionsForCreation strips non-canonical metadata (_sourceBankId)', () => {
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

    await t.test('11. isDuplicateQuestion detects identical bank id and prompt text', () => {
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
      assert.match(hostPageContent, /Đã đạt giới hạn tối đa 5 câu hỏi trong phòng thi/);
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
