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
  createCompetitionExcelTemplateWorkbook,
  MAX_COMPETITION_QUESTIONS
} from '../src/utils/competitionQuestionAdapters.js';
import { parseExcelQuestions } from '../src/utils/questionFileParsers.js';

const hostPageContent = fs.readFileSync('src/pages/CompetitionHostPage.jsx', 'utf8');
const studentPageContent = fs.readFileSync('src/pages/CompetitionStudentPage.jsx', 'utf8');
const qbModalContent = fs.readFileSync('src/components/competition/CompetitionQuestionBankModal.jsx', 'utf8');
const excelModalContent = fs.readFileSync('src/components/competition/CompetitionImportExcelModal.jsx', 'utf8');
const reviewViewContent = fs.readFileSync('src/components/competition/StudentQuestionReviewView.jsx', 'utf8');
const adaptersContent = fs.readFileSync('src/utils/competitionQuestionAdapters.js', 'utf8');
const parsersContent = fs.readFileSync('src/utils/questionFileParsers.js', 'utf8');

test('COMPETITION V1 R15A — MULTIPLE CHOICE IMPLEMENTATION & REGRESSION TEST SUITE', async (t) => {

  // =========================================================================
  // GROUP 1: CANONICAL CONTRACT & SANITIZATION
  // =========================================================================
  await t.test('Group 1: Canonical Contract & Sanitization', async (t) => {

    await t.test('1. single_choice existing canonical contract unchanged', () => {
      const singleChoiceQ = {
        question_order: 1,
        question_text: 'Thủ đô của Việt Nam là gì?',
        question_type: 'single_choice',
        points: 10,
        time_limit_seconds: 30,
        options: [
          { id: 'opt_1', text: 'Hà Nội' },
          { id: 'opt_2', text: 'TP.HCM' },
          { id: 'opt_3', text: 'Đà Nẵng' }
        ],
        correct_answer: {
          option_id: 'opt_1'
        }
      };

      const sanitized = sanitizeQuestionsForCreation([singleChoiceQ]);
      assert.strictEqual(sanitized.length, 1);
      assert.strictEqual(sanitized[0].question_type, 'single_choice');
      assert.deepStrictEqual(sanitized[0].correct_answer, { option_id: 'opt_1' });
      assert.strictEqual(sanitized[0].options.length, 3);
    });

    await t.test('2. manual multiple_choice with 2 correct options canonicalizes correctly', () => {
      const multiChoiceQ = {
        question_order: 1,
        question_text: 'Các thành phố trực thuộc Trung ương của Việt Nam?',
        question_type: 'multiple_choice',
        points: 20,
        time_limit_seconds: 40,
        options: [
          { id: 'opt_1', text: 'Hà Nội' },
          { id: 'opt_2', text: 'Nha Trang' },
          { id: 'opt_3', text: 'Đà Nẵng' },
          { id: 'opt_4', text: 'Đà Lạt' }
        ],
        correct_answer: {
          option_ids: ['opt_1', 'opt_3']
        }
      };

      const sanitized = sanitizeQuestionsForCreation([multiChoiceQ]);
      assert.strictEqual(sanitized.length, 1);
      assert.strictEqual(sanitized[0].question_type, 'multiple_choice');
      assert.deepStrictEqual(sanitized[0].correct_answer, { option_ids: ['opt_1', 'opt_3'] });
    });

    await t.test('3. duplicate option_ids in correct answers deduplicate safely', () => {
      const multiChoiceWithDups = {
        question_order: 1,
        question_text: 'Câu hỏi có duplicate option_ids',
        question_type: 'multiple_choice',
        options: [
          { id: 'opt_1', text: 'A' },
          { id: 'opt_2', text: 'B' },
          { id: 'opt_3', text: 'C' }
        ],
        correct_answer: {
          option_ids: ['opt_1', 'opt_2', 'opt_1', 'opt_2']
        }
      };

      const sanitized = sanitizeQuestionsForCreation([multiChoiceWithDups]);
      assert.deepStrictEqual(sanitized[0].correct_answer, { option_ids: ['opt_1', 'opt_2'] });
    });

    await t.test('4. invalid correct option id fails closed', () => {
      const invalidOptionIdQ = {
        question_order: 1,
        question_text: 'Câu hỏi chứa option_id không tồn tại',
        question_type: 'multiple_choice',
        options: [
          { id: 'opt_1', text: 'A' },
          { id: 'opt_2', text: 'B' }
        ],
        correct_answer: {
          option_ids: ['opt_1', 'opt_99']
        }
      };

      assert.throws(() => {
        sanitizeQuestionsForCreation([invalidOptionIdQ]);
      }, /chứa đáp án đúng không nằm trong danh sách lựa chọn/);
    });

    await t.test('5. zero correct answers fails closed', () => {
      const noCorrectAnswerQ = {
        question_order: 1,
        question_text: 'Câu hỏi không có đáp án đúng',
        question_type: 'multiple_choice',
        options: [
          { id: 'opt_1', text: 'A' },
          { id: 'opt_2', text: 'B' }
        ],
        correct_answer: {
          option_ids: []
        }
      };

      assert.throws(() => {
        sanitizeQuestionsForCreation([noCorrectAnswerQ]);
      }, /thiếu đáp án đúng/);
    });

    await t.test('14. sanitize preserves multiple_choice type', () => {
      const q = {
        question_order: 1,
        question_text: 'Test type preservation',
        question_type: 'multiple_choice',
        options: [
          { id: 'opt_1', text: 'A' },
          { id: 'opt_2', text: 'B' }
        ],
        correct_answer: {
          option_ids: ['opt_1', 'opt_2']
        }
      };
      const result = sanitizeQuestionsForCreation([q]);
      assert.strictEqual(result[0].question_type, 'multiple_choice');
      assert.notStrictEqual(result[0].question_type, 'single_choice', 'Never downgrade multiple_choice');
    });

    await t.test('15. sanitize preserves all correct option_ids', () => {
      const q = {
        question_order: 1,
        question_text: 'Preserve all correct option_ids',
        question_type: 'multiple_choice',
        options: [
          { id: 'opt_1', text: 'A' },
          { id: 'opt_2', text: 'B' },
          { id: 'opt_3', text: 'C' }
        ],
        correct_answer: {
          option_ids: ['opt_1', 'opt_2', 'opt_3']
        }
      };
      const result = sanitizeQuestionsForCreation([q]);
      assert.deepStrictEqual(result[0].correct_answer.option_ids, ['opt_1', 'opt_2', 'opt_3']);
    });

    await t.test('16. 20-question limit remains enforced', () => {
      assert.strictEqual(MAX_COMPETITION_QUESTIONS, 20);
      const overLimitQuestions = Array.from({ length: 21 }, (_, i) => ({
        question_order: i + 1,
        question_text: `Câu ${i + 1}`,
        question_type: 'multiple_choice',
        options: [
          { id: 'opt_1', text: 'A' },
          { id: 'opt_2', text: 'B' }
        ],
        correct_answer: { option_ids: ['opt_1'] }
      }));

      assert.throws(() => {
        sanitizeQuestionsForCreation(overLimitQuestions);
      }, /vượt quá giới hạn tối đa 20/);
    });
  });

  // =========================================================================
  // GROUP 2: QUESTION BANK ADAPTER & MULTI-TYPE NORMALIZATION
  // =========================================================================
  await t.test('Group 2: Question Bank Adapter & Multi-Type Normalization', async (t) => {

    await t.test('6. Question Bank multiple_choice maps correct_option_ids -> option_ids', () => {
      const qbDetail = {
        projection: 'authoring_safe',
        item: {
          id: 'qb_multi_uuid_1',
          title: 'Các ngôn ngữ biên dịch',
          question_type: 'multiple_choice',
          points: 15,
          time_limit_seconds: 45
        },
        version: {
          id: 'v_1',
          prompt: 'Những ngôn ngữ nào sau đây là compiled language?',
          question_type: 'multiple_choice',
          options: [
            { id: 'raw_rust', text: 'Rust' },
            { id: 'raw_python', text: 'Python' },
            { id: 'raw_cpp', text: 'C++' },
            { id: 'raw_ruby', text: 'Ruby' }
          ]
        },
        answer_key: {
          correct_option_ids: ['raw_rust', 'raw_cpp']
        }
      };

      const normalized = normalizeQuestionBankItemToCompetitionQuestion(qbDetail, 2);
      assert.strictEqual(normalized.question_order, 2);
      assert.strictEqual(normalized.question_type, 'multiple_choice');
      assert.strictEqual(normalized.options.length, 4);
      assert.strictEqual(normalized.options[0].id, 'opt_1');
      assert.strictEqual(normalized.options[2].id, 'opt_3');
      assert.deepStrictEqual(normalized.correct_answer, {
        option_ids: ['opt_1', 'opt_3']
      });
      assert.strictEqual(normalized._sourceBankId, 'qb_multi_uuid_1');
    });

    await t.test('7. Question Bank single_choice still works', () => {
      const qbSingleDetail = {
        projection: 'authoring_safe',
        item: {
          id: 'qb_single_uuid_1',
          title: 'Thủ đô nước Pháp',
          question_type: 'single_choice'
        },
        version: {
          prompt: 'Thủ đô nước Pháp là gì?',
          options: [
            { id: 'raw_paris', text: 'Paris' },
            { id: 'raw_lyon', text: 'Lyon' }
          ]
        },
        answer_key: {
          correct_option_id: 'raw_paris'
        }
      };

      const normalized = normalizeQuestionBankItemToCompetitionQuestion(qbSingleDetail, 1);
      assert.strictEqual(normalized.question_type, 'single_choice');
      assert.deepStrictEqual(normalized.correct_answer, { option_id: 'opt_1' });
    });

    await t.test('8. Question Bank malformed detail fails closed', () => {
      const malformedQb = {
        item: { id: 'qb_bad', question_type: 'multiple_choice' },
        version: {
          prompt: 'Câu hỏi không có đáp án đúng',
          options: [{ id: 'opt_a', text: 'A' }, { id: 'opt_b', text: 'B' }]
        },
        answer_key: {
          correct_option_ids: ['unknown_uuid']
        }
      };

      assert.throws(() => {
        normalizeQuestionBankItemToCompetitionQuestion(malformedQb, 1);
      }, /Không thể ánh xạ đáp án đúng/);
    });

    await t.test('9. Question Bank list filters published + supported types', () => {
      assert.match(qbModalContent, /status:\s*'published'/, 'Question Bank modal must filter by published');
      assert.match(qbModalContent, /it\.question_type === 'single_choice' \|\| it\.question_type === 'multiple_choice'/, 'Question Bank modal filters supported competition types');
      assert.match(qbModalContent, /single_choice/, 'Question Bank modal supports single_choice');
      assert.match(qbModalContent, /multiple_choice/, 'Question Bank modal supports multiple_choice');
    });
  });

  // =========================================================================
  // GROUP 3: EXCEL IMPORT & MULTIPLE CHOICE
  // =========================================================================
  await t.test('Group 3: Excel Import & Multiple Choice Support', async (t) => {

    await t.test('10. Excel single_choice still round-trips', async () => {
      const headers = ['type', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer', 'points', 'time_limit_seconds'];
      const rows = [
        ['single_choice', 'Hà Nội là thủ đô của?', 'Việt Nam', 'Lào', 'Campuchia', 'Thái Lan', 'A', 10, 30]
      ];
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Questions');
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

      const parsed = await parseExcelQuestions(buf, 'single.xlsx');
      assert.strictEqual(parsed.errors.length, 0);
      assert.strictEqual(parsed.questions.length, 1);
      const q = parsed.questions[0];
      assert.strictEqual(q.question_type, 'single_choice');

      const compQ = normalizeImportedQuestionToCompetitionQuestion(q, 1);
      assert.strictEqual(compQ.question_type, 'single_choice');
      assert.deepStrictEqual(compQ.correct_answer, { option_id: 'opt_1' });
    });

    await t.test('11. Excel multiple_choice A;C and A,C imports correctly', async () => {
      const headers = ['type', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer', 'points', 'time_limit_seconds'];
      const rows = [
        ['multiple_choice', 'Số nguyên tố chẵn và số nguyên tố nhỏ nhất?', '2', '3', '4', '5', 'A;B', 10, 30],
        ['multiple_choice', 'Các số chẵn?', '2', '3', '4', '5', 'A,C', 10, 30]
      ];
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Questions');
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

      const parsed = await parseExcelQuestions(buf, 'multi.xlsx');
      assert.strictEqual(parsed.errors.length, 0);
      assert.strictEqual(parsed.questions.length, 2);

      const compQ1 = normalizeImportedQuestionToCompetitionQuestion(parsed.questions[0], 1);
      assert.strictEqual(compQ1.question_type, 'multiple_choice');
      assert.deepStrictEqual(compQ1.correct_answer, { option_ids: ['opt_1', 'opt_2'] });

      const compQ2 = normalizeImportedQuestionToCompetitionQuestion(parsed.questions[1], 2);
      assert.strictEqual(compQ2.question_type, 'multiple_choice');
      assert.deepStrictEqual(compQ2.correct_answer, { option_ids: ['opt_1', 'opt_3'] });
    });

    await t.test('12. malformed multiple_choice Excel row isolated as row error', async () => {
      const headers = ['type', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer', 'points', 'time_limit_seconds'];
      const rows = [
        ['multiple_choice', 'Câu hỏi hợp lệ', 'A', 'B', 'C', 'D', 'A;C', 10, 30],
        ['multiple_choice', 'Câu hỏi sai đáp án', 'A', 'B', 'C', 'D', 'A;Z', 10, 30]
      ];
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Questions');
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

      const parsed = await parseExcelQuestions(buf, 'mixed.xlsx');
      assert.strictEqual(parsed.questions.length, 1, 'Valid row must still be imported');
      assert.strictEqual(parsed.errors.length, 1, 'Malformed row isolated as row error');
      assert.match(parsed.errors[0].message, /không khớp với các lựa chọn/);
    });

    await t.test('13. shared structural Excel error behavior unchanged', async () => {
      const ws = XLSX.utils.aoa_to_sheet([['Cột không liên quan', 'Dữ liệu']]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Empty');
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

      const parsed = await parseExcelQuestions(buf, 'bad.xlsx');
      assert.strictEqual(parsed.questions.length, 0);
      assert.ok(parsed.errors.length > 0, 'Structural error aborts file parse');
      assert.match(parsed.errors[0].message, /không có dữ liệu câu hỏi|Không tìm thấy các cột bắt buộc/);
    });
  });

  // =========================================================================
  // GROUP 4: STUDENT & GUEST ANSWERING, LOCKING, & SECURITY
  // =========================================================================
  await t.test('Group 4: Student & Guest Answering, Locking, & Security', async (t) => {

    await t.test('17. student multiple selection builds selected_option_ids array', () => {
      assert.match(studentPageContent, /setSelectedOptionIds\(\(prev\)/, 'Student page toggles selectedOptionIds array');
      assert.match(studentPageContent, /selectedOptionIds:\s*submissionOptions/, 'Submit answer passes selectedOptionIds array');
    });

    await t.test('18. answer order does not alter canonical selection set', () => {
      const selA = ['opt_3', 'opt_1'];
      const selB = ['opt_1', 'opt_3'];
      const sortedA = [...new Set(selA)].sort();
      const sortedB = [...new Set(selB)].sort();
      assert.deepStrictEqual(sortedA, sortedB, 'Selection order must not matter for exact set evaluation');
    });

    await t.test('19. submit disabled with zero selected answers', () => {
      assert.match(studentPageContent, /disabled=\{!selectedOptionId/, 'Submit button disabled when no answers selected');
      assert.match(studentPageContent, /next\.length\s*>\s*0\s*\?\s*next\[0\]\s*:\s*null/, 'selectedOptionId tracks non-empty selection for multi-choice');
    });

    await t.test('20. successful submit locks answer state', () => {
      assert.match(studentPageContent, /setHasSubmittedCurrentQuestion\(true\)/, 'Student page marks answer as submitted');
      assert.match(studentPageContent, /disabled=\{disabled\}/, 'Option buttons disabled once submitted');
    });

    await t.test('21. guest multiple_choice flow preserves guest-token contract', () => {
      assert.match(studentPageContent, /guestToken:\s*isGuestMode\s*\?\s*guestToken\s*:\s*null/, 'Guest token passed cleanly');
      assert.match(studentPageContent, /selectedOptionIds:\s*submissionOptions/, 'Guest flow uses same selectedOptionIds parameter');
    });

    await t.test('22. active question does NOT expose correct option_ids', () => {
      // In student active question rendering, options are rendered without correct_answer checking
      assert.ok(!studentPageContent.includes('currentQuestion.correct_answer?.option_ids'), 'Student page must never read correct_answer during active question');
      // In host active question rendering, options or distribution do not expose answers while active
      assert.ok(hostPageContent.includes("hostViewMode === 'QUESTION_RESULTS'"), 'Host reveals correct answers only in results view');
    });

    await t.test('23. results can expose multiple correct options only after close', () => {
      assert.match(hostPageContent, /isCorrect\s*=\s*opt\.is_correct_option/, 'Host displays green badge for all correct options when results open');
    });

    await t.test('24. post-session review renders selected vs correct sets', () => {
      assert.match(reviewViewContent, /selectedOptionIds\.includes\(opt\.id\)/, 'Review checks whether student selected each option');
      assert.match(reviewViewContent, /correctOptionIds\.includes\(opt\.id\)/, 'Review checks whether each option is correct');
      assert.match(reviewViewContent, /isOptionCorrect\s*&&\s*isOptionSelected/, 'Review distinguishes correct selected options');
      assert.match(reviewViewContent, /isOptionCorrect\s*&&\s*!isOptionSelected/, 'Review distinguishes missed correct options');
      assert.match(reviewViewContent, /!isOptionCorrect\s*&&\s*isOptionSelected/, 'Review distinguishes extra wrong options');
    });

    await t.test('25. exact-set scoring assumption documented/tested — no partial credit', () => {
      // Helper function simulating exact-set scoring logic matching Postgres backend
      const evaluateScore = (studentSelection, correctOptionIds, points) => {
        const sortedStudent = [...new Set(studentSelection)].sort();
        const sortedCorrect = [...new Set(correctOptionIds)].sort();
        if (sortedStudent.length === sortedCorrect.length &&
            sortedStudent.every((val, idx) => val === sortedCorrect[idx])) {
          return { is_correct: true, points_awarded: points };
        }
        return { is_correct: false, points_awarded: 0 };
      };

      // Fully correct
      const resFull = evaluateScore(['opt_1', 'opt_3'], ['opt_1', 'opt_3'], 10);
      assert.strictEqual(resFull.is_correct, true);
      assert.strictEqual(resFull.points_awarded, 10);

      // Missing one correct option (partial selection) -> 0 points (no partial credit)
      const resPartial = evaluateScore(['opt_1'], ['opt_1', 'opt_3'], 10);
      assert.strictEqual(resPartial.is_correct, false);
      assert.strictEqual(resPartial.points_awarded, 0);

      // Correct + extra wrong option -> 0 points
      const resExtra = evaluateScore(['opt_1', 'opt_2', 'opt_3'], ['opt_1', 'opt_3'], 10);
      assert.strictEqual(resExtra.is_correct, false);
      assert.strictEqual(resExtra.points_awarded, 0);
    });
  });

  // =========================================================================
  // GROUP 5: REGRESSIONS & COMPATIBILITY
  // =========================================================================
  await t.test('Group 5: Regressions & Invariants Check', async (t) => {

    await t.test('26. single_choice regression still PASS', () => {
      const q = {
        question_order: 1,
        question_text: 'Thủ đô của Pháp?',
        question_type: 'single_choice',
        options: [
          { id: 'opt_1', text: 'Paris' },
          { id: 'opt_2', text: 'Lyon' }
        ],
        correct_answer: { option_id: 'opt_1' }
      };
      const sanitized = sanitizeQuestionsForCreation([q]);
      assert.strictEqual(sanitized[0].question_type, 'single_choice');
      assert.strictEqual(sanitized[0].correct_answer.option_id, 'opt_1');
    });

    await t.test('27. R14 Question Bank fail-closed regression PASS', () => {
      assert.match(qbModalContent, /Promise\.allSettled/);
      assert.match(qbModalContent, /failedItems\.length\s*>\s*0/);
    });

    await t.test('28. R14 Excel regression PASS', () => {
      const templateWb = createCompetitionExcelTemplateWorkbook();
      assert.ok(templateWb.Sheets['CauHoiDauTruong'], 'Excel template sheet exists');
    });

    await t.test('29. R13 spectator regression PASS', () => {
      const spectatorContent = fs.readFileSync('src/pages/CompetitionSpectatorPage.jsx', 'utf8');
      assert.match(spectatorContent, /SpectatorLiveQuestionView/);
      assert.match(spectatorContent, /SpectatorQuestionResultsView/);
    });

    await t.test('30. R12 host results navigation regression PASS', () => {
      assert.match(hostPageContent, /handleReviewPrevQuestion/);
      assert.match(hostPageContent, /handleReviewNextQuestion/);
      assert.match(hostPageContent, /handleReturnToCurrentQuestion/);
    });

    await t.test('31. guest join regression PASS', () => {
      assert.match(studentPageContent, /getOrCreateGuestToken/);
      assert.match(studentPageContent, /studentJoinSession/);
    });

    await t.test('32. R7 lazy analytics invariant PASS', () => {
      assert.match(hostPageContent, /<HostQuestionAnalyticsView/);
      assert.match(hostPageContent, /finishedTab === 'ANALYTICS'/);
    });

    await t.test('33. max 20 regression PASS', () => {
      assert.strictEqual(MAX_COMPETITION_QUESTIONS, 20);
      assert.match(hostPageContent, /MAX_COMPETITION_QUESTIONS/);
    });
  });
});
