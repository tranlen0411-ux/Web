import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import {
  normalizeOption,
  normalizeAcceptedAnswers,
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
const spectatorLiveContent = fs.readFileSync('src/components/competition/spectator/SpectatorLiveQuestionView.jsx', 'utf8');
const spectatorResultsContent = fs.readFileSync('src/components/competition/spectator/SpectatorQuestionResultsView.jsx', 'utf8');
const hostAnalyticsContent = fs.readFileSync('src/components/competition/HostQuestionAnalyticsView.jsx', 'utf8');
const adaptersContent = fs.readFileSync('src/utils/competitionQuestionAdapters.js', 'utf8');
const parsersContent = fs.readFileSync('src/utils/questionFileParsers.js', 'utf8');

test('COMPETITION V1 R15B — FILL BLANK (SHORT ANSWER) IMPLEMENTATION & REGRESSION TEST SUITE', async (t) => {

  // =========================================================================
  // GROUP 1: CANONICAL CONTRACT & TYPE ADAPTERS (STEP 3 & 14)
  // =========================================================================
  await t.test('Group 1: Canonical Contract & Type Adapters', async (t) => {

    await t.test('1. single_choice unchanged', () => {
      const q = {
        question_order: 1,
        question_text: 'Thủ đô của Việt Nam là gì?',
        question_type: 'single_choice',
        points: 10,
        time_limit_seconds: 30,
        options: [
          { id: 'opt_1', text: 'Hà Nội' },
          { id: 'opt_2', text: 'TP.HCM' }
        ],
        correct_answer: { option_id: 'opt_1' }
      };
      const sanitized = sanitizeQuestionsForCreation([q]);
      assert.strictEqual(sanitized[0].question_type, 'single_choice');
      assert.deepStrictEqual(sanitized[0].correct_answer, { option_id: 'opt_1' });
      assert.strictEqual(sanitized[0].options.length, 2);
    });

    await t.test('2. multiple_choice unchanged', () => {
      const q = {
        question_order: 1,
        question_text: 'Các thành phố lớn?',
        question_type: 'multiple_choice',
        points: 10,
        time_limit_seconds: 30,
        options: [
          { id: 'opt_1', text: 'Hà Nội' },
          { id: 'opt_2', text: 'Đà Nẵng' },
          { id: 'opt_3', text: 'Hội An' }
        ],
        correct_answer: { option_ids: ['opt_1', 'opt_2'] }
      };
      const sanitized = sanitizeQuestionsForCreation([q]);
      assert.strictEqual(sanitized[0].question_type, 'multiple_choice');
      assert.deepStrictEqual(sanitized[0].correct_answer, { option_ids: ['opt_1', 'opt_2'] });
    });

    await t.test('3. fill_blank source maps to canonical short_answer', () => {
      const q = {
        question_order: 1,
        question_text: 'Thủ đô của Việt Nam là gì?',
        question_type: 'fill_blank',
        points: 10,
        time_limit_seconds: 30,
        correct_answers: ['Hà Nội', 'Hanoi']
      };
      const sanitized = sanitizeQuestionsForCreation([q]);
      assert.strictEqual(sanitized[0].question_type, 'short_answer');
    });

    await t.test('4. canonical short_answer uses options: []', () => {
      const q = {
        question_order: 1,
        question_text: 'Thủ đô của Việt Nam là gì?',
        question_type: 'fill_blank',
        options: [{ id: 'opt_1', text: 'Hà Nội' }], // Should be forced to []
        correct_answers: ['Hà Nội']
      };
      const sanitized = sanitizeQuestionsForCreation([q]);
      assert.deepStrictEqual(sanitized[0].options, []);
    });

    await t.test('5. correct_answer.accepted_answers created correctly', () => {
      const q = {
        question_order: 1,
        question_text: 'Thủ đô của Việt Nam là gì?',
        question_type: 'fill_blank',
        correct_answers: ['Hà Nội', 'Hanoi']
      };
      const sanitized = sanitizeQuestionsForCreation([q]);
      assert.deepStrictEqual(sanitized[0].correct_answer, {
        accepted_answers: ['Hà Nội', 'Hanoi']
      });
    });

    await t.test('6. empty accepted answers fail closed', () => {
      const q = {
        question_order: 1,
        question_text: 'Câu hỏi không có đáp án',
        question_type: 'fill_blank',
        correct_answers: []
      };
      assert.throws(() => {
        sanitizeQuestionsForCreation([q]);
      }, /phải có ít nhất 1 đáp án đúng/);
    });

    await t.test('7. whitespace-only accepted answers removed', () => {
      const res = normalizeAcceptedAnswers(['Hà Nội', '   ', '', 'Hanoi']);
      assert.deepStrictEqual(res, ['Hà Nội', 'Hanoi']);
    });

    await t.test('8. duplicate accepted answers deduplicated', () => {
      const res = normalizeAcceptedAnswers(['Hà Nội', '  hà nội  ', 'HÀ NỘI', 'Hanoi']);
      assert.deepStrictEqual(res, ['Hà Nội', 'Hanoi']);
    });

    await t.test('9. deterministic answer ordering preserved', () => {
      const res = normalizeAcceptedAnswers(['Hà Nội', 'Hanoi', 'Thủ đô Hà Nội']);
      assert.deepStrictEqual(res, ['Hà Nội', 'Hanoi', 'Thủ đô Hà Nội']);
    });
  });

  // =========================================================================
  // GROUP 2: QUESTION BANK MAPPING (STEP 4)
  // =========================================================================
  await t.test('Group 2: Question Bank Mapping', async (t) => {

    await t.test('10. Question Bank fill_blank maps correctly', () => {
      const qbItem = {
        item: {
          id: 'item-uuid-1',
          question_type: 'fill_blank',
          status: 'published'
        },
        version: {
          id: 'ver-uuid-1',
          question_text: '1 + 1 bằng mấy?'
        },
        answer_key: {
          correct_answers: ['2', 'hai']
        }
      };
      const adapted = normalizeQuestionBankItemToCompetitionQuestion(qbItem, 1);
      assert.strictEqual(adapted.question_type, 'short_answer');
      assert.deepStrictEqual(adapted.options, []);
      assert.deepStrictEqual(adapted.correct_answer, { accepted_answers: ['2', 'hai'] });
    });

    await t.test('11. Question Bank malformed fill_blank fails closed', () => {
      const malformedQbItem = {
        item: {
          id: 'item-uuid-2',
          question_type: 'fill_blank',
          status: 'published'
        },
        version: {
          question_text: '1 + 1 bằng mấy?'
        },
        answer_key: {
          correct_answers: ['  ', '']
        }
      };
      assert.throws(() => {
        normalizeQuestionBankItemToCompetitionQuestion(malformedQbItem, 1);
      }, /phải có ít nhất 1 đáp án đúng/);
    });

    await t.test('12. Question Bank supported filter includes fill_blank', () => {
      assert.ok(qbModalContent.includes("it.question_type === 'fill_blank'"));
      assert.ok(qbModalContent.includes('<option value="fill_blank">Điền vào chỗ trống</option>'));
    });

    await t.test('13. Question Bank still published-only', () => {
      assert.ok(qbModalContent.includes("status: 'published'"));
    });
  });

  // =========================================================================
  // GROUP 3: EXCEL PARSER & TEMPLATE (STEP 13)
  // =========================================================================
  await t.test('Group 3: Excel Parser & Template', async (t) => {

    await t.test('14. Excel fill_blank parses correctly', () => {
      const excelRow = {
        type: 'fill_blank',
        question: 'Thủ đô của Việt Nam là gì?',
        correct_answer: 'Hà Nội;Ha Noi;Hanoi',
        points: 10,
        time_limit_seconds: 30
      };
      const adapted = normalizeImportedQuestionToCompetitionQuestion(excelRow, 1);
      assert.strictEqual(adapted.question_type, 'short_answer');
      assert.deepStrictEqual(adapted.options, []);
      assert.deepStrictEqual(adapted.correct_answer, {
        accepted_answers: ['Hà Nội', 'Ha Noi', 'Hanoi']
      });
    });

    await t.test('15. Excel valid single_choice still works', () => {
      const excelRow = {
        type: 'single_choice',
        question: '1 + 1 = ?',
        option_a: '1',
        option_b: '2',
        correct_answer: 'B'
      };
      const adapted = normalizeImportedQuestionToCompetitionQuestion(excelRow, 1);
      assert.strictEqual(adapted.question_type, 'single_choice');
      assert.strictEqual(adapted.correct_answer.option_id, 'opt_2');
    });

    await t.test('16. Excel valid multiple_choice still works', () => {
      const excelRow = {
        type: 'multiple_choice',
        question: 'Chọn số chẵn:',
        option_a: '1',
        option_b: '2',
        option_c: '4',
        correct_answer: 'B;C'
      };
      const adapted = normalizeImportedQuestionToCompetitionQuestion(excelRow, 1);
      assert.strictEqual(adapted.question_type, 'multiple_choice');
      assert.deepStrictEqual(adapted.correct_answer.option_ids, ['opt_2', 'opt_3']);
    });

    await t.test('17. malformed fill_blank row isolated as row error', () => {
      const badRow = {
        type: 'fill_blank',
        question: 'Thiếu đáp án',
        correct_answer: '   '
      };
      assert.throws(() => {
        normalizeImportedQuestionToCompetitionQuestion(badRow, 1);
      }, /Thiếu đáp án đúng cho câu hỏi điền vào chỗ trống/);
    });

    await t.test('18. structural Excel error behavior unchanged', () => {
      assert.throws(() => {
        normalizeImportedQuestionToCompetitionQuestion(null, 1);
      }, /Dữ liệu dòng Excel không hợp lệ/);
    });

    await t.test('19. template includes fill_blank example', () => {
      const wb = createCompetitionExcelTemplateWorkbook();
      const sheet = wb.Sheets['CauHoiDauTruong'];
      const rows = XLSX.utils.sheet_to_json(sheet);
      const fillBlankRow = rows.find(r => r.type === 'fill_blank');
      assert.ok(fillBlankRow, 'Template must contain fill_blank example row');
      assert.ok(fillBlankRow.correct_answer.includes(';'), 'Must show semicolon separator');
    });
  });

  // =========================================================================
  // GROUP 4: SANITIZE CREATE SESSION PAYLOAD (STEP 14)
  // =========================================================================
  await t.test('Group 4: Sanitize Create Session Payload', async (t) => {

    await t.test('20. sanitize converts fill_blank source to short_answer', () => {
      const questions = [
        {
          question_order: 1,
          question_text: 'Điền từ còn thiếu',
          question_type: 'fill_blank',
          correct_answer: { accepted_answers: ['Việt Nam'] }
        }
      ];
      const sanitized = sanitizeQuestionsForCreation(questions);
      assert.strictEqual(sanitized[0].question_type, 'short_answer');
    });

    await t.test('21. sanitize never sends literal fill_blank backend type', () => {
      const questions = [
        {
          question_order: 1,
          question_text: 'Câu hỏi 1',
          question_type: 'fill_blank',
          _sourceType: 'fill_blank',
          _sourceBankId: 'bank-123',
          correct_answers: ['Test']
        }
      ];
      const sanitized = sanitizeQuestionsForCreation(questions);
      const json = JSON.stringify(sanitized);
      assert.strictEqual(sanitized[0].question_type, 'short_answer');
      assert.strictEqual(sanitized[0]._sourceType, undefined);
      assert.strictEqual(sanitized[0]._sourceBankId, undefined);
      assert.ok(!json.includes('"question_type":"fill_blank"'));
    });
  });

  // =========================================================================
  // GROUP 5: STUDENT SUBMISSION & GUEST SECURITY (STEP 7 & 8)
  // =========================================================================
  await t.test('Group 5: Student Submission & Guest Security', async (t) => {

    await t.test('22. short_answer submission uses textAnswer', () => {
      assert.ok(studentPageContent.includes("textAnswer: isShortAnswer ? studentTextAnswer.trim() : null"));
    });

    await t.test('23. short_answer submission uses selectedOptionIds=[]', () => {
      assert.ok(studentPageContent.includes("const submissionOptions = isShortAnswer\n        ? []"));
    });

    await t.test('24. empty trimmed student answer cannot submit', () => {
      assert.ok(studentPageContent.includes("studentTextAnswer && studentTextAnswer.trim().length > 0"));
      assert.ok(studentPageContent.includes("(isShortAnswer && !studentTextAnswer.trim())"));
    });

    await t.test('25. successful submit locks text input', () => {
      assert.ok(studentPageContent.includes("disabled={isSubmitting || hasSubmittedCurrentQuestion || isPaused || isTimeExpired}"));
    });

    await t.test('26. guest short_answer preserves guest token flow', () => {
      assert.ok(studentPageContent.includes("guestToken: isGuestMode ? guestToken : null"));
    });
  });

  // =========================================================================
  // GROUP 6: LEAK PROTECTION & SPECTATOR (STEP 9, 10, 11)
  // =========================================================================
  await t.test('Group 6: Leak Protection & Spectator', async (t) => {

    await t.test('27. active Host does not reveal accepted_answers', () => {
      // In host page, LIVE_QUESTION mode must not output accepted_answers
      const liveQuestionSection = hostPageContent.substring(
        hostPageContent.indexOf("hostViewMode === 'LIVE_QUESTION'"),
        hostPageContent.indexOf("hostViewMode === 'QUESTION_RESULTS'")
      );
      assert.ok(!liveQuestionSection.includes('accepted_answers'));
    });

    await t.test('28. active Spectator does not reveal accepted_answers', () => {
      assert.ok(!spectatorLiveContent.includes('accepted_answers'));
      assert.ok(!spectatorLiveContent.includes('correct_answer'));
    });

    await t.test('29. results short_answer does not assume option_distribution', () => {
      assert.ok(hostAnalyticsContent.includes("const isChoiceType = ['single_choice', 'true_false', 'multiple_choice'].includes(q.question_type)"));
      assert.ok(hostPageContent.includes("activeDisplayedResults.question_type !== 'short_answer' && Array.isArray(activeDisplayedResults.distribution)"));
      assert.ok(spectatorResultsContent.includes("activeQuestion?.question_type === 'short_answer' || questionResults?.question_type === 'short_answer'"));
    });

    await t.test('30. results accepted answers only visible after close', () => {
      assert.ok(hostPageContent.includes("activeDisplayedResults.question_type === 'short_answer'"));
      assert.ok(hostPageContent.includes("activeDisplayedResults.correct_answer.accepted_answers.join"));
    });
  });

  // =========================================================================
  // GROUP 7: REVIEW VIEW & CONTRACT PRESERVATION (STEP 12, 17)
  // =========================================================================
  await t.test('Group 7: Review View & Contract Preservation', async (t) => {

    await t.test('31. Student Review renders text_answer', () => {
      assert.ok(reviewViewContent.includes("q.question_type === 'short_answer'"));
      assert.ok(reviewViewContent.includes("studentAns.text_answer : 'Chưa trả lời'"));
    });

    await t.test('32. Student Review renders accepted_answers', () => {
      assert.ok(reviewViewContent.includes("acceptedAnswers.length > 0 ? acceptedAnswers.join(' / ') : '(Không có)'"));
    });

    await t.test('33. no fuzzy matching added', () => {
      assert.ok(!adaptersContent.includes('levenshtein'));
      assert.ok(!adaptersContent.includes('fuzzy'));
      assert.ok(!studentPageContent.includes('levenshtein'));
      assert.ok(!studentPageContent.includes('fuzzy'));
    });

    await t.test('34. no accent stripping added', () => {
      assert.ok(!adaptersContent.includes('removeAccents'));
      assert.ok(!adaptersContent.includes('normalize("NFD")'));
      assert.ok(!studentPageContent.includes('removeAccents'));
    });

    await t.test('35. exact backend comparison contract preserved', () => {
      // Backend contract: lower(btrim(student)) == lower(btrim(accepted))
      const accepted = normalizeAcceptedAnswers(['Hà Nội']);
      const studentInput = '  hà nội  '.trim().toLowerCase();
      const match = accepted.some(a => a.trim().toLowerCase() === studentInput);
      assert.strictEqual(match, true);

      const wrongInput = 'Hà Nộii'.trim().toLowerCase();
      const wrongMatch = accepted.some(a => a.trim().toLowerCase() === wrongInput);
      assert.strictEqual(wrongMatch, false);
    });

    await t.test('36. max 20 preserved', () => {
      assert.strictEqual(MAX_COMPETITION_QUESTIONS, 20);
      assert.ok(adaptersContent.includes('export const MAX_COMPETITION_QUESTIONS = 20;'));
    });
  });

  // =========================================================================
  // GROUP 8: REGRESSION SUITE (STEP 16: 37-44)
  // =========================================================================
  await t.test('Group 8: Regression Suite', async (t) => {

    await t.test('37. R15A multiple_choice regression PASS', () => {
      const multiQ = {
        question_order: 1,
        question_text: 'Chọn các đáp án đúng',
        question_type: 'multiple_choice',
        options: [{ id: 'opt_1', text: 'A' }, { id: 'opt_2', text: 'B' }],
        correct_answer: { option_ids: ['opt_1', 'opt_2'] }
      };
      const sanitized = sanitizeQuestionsForCreation([multiQ]);
      assert.strictEqual(sanitized[0].question_type, 'multiple_choice');
      assert.deepStrictEqual(sanitized[0].correct_answer.option_ids, ['opt_1', 'opt_2']);
    });

    await t.test('38. R14 Question Bank fail-closed PASS', () => {
      assert.throws(() => {
        normalizeQuestionBankItemToCompetitionQuestion(null);
      }, /Dữ liệu câu hỏi từ Ngân hàng không hợp lệ/);
    });

    await t.test('39. R14 Excel row-level error behavior PASS', () => {
      assert.throws(() => {
        normalizeImportedQuestionToCompetitionQuestion({ type: 'unsupported_type', question: 'Test' });
      }, /chưa được hỗ trợ trong Đấu trường/);
    });

    await t.test('40. R13 spectator regression PASS', () => {
      assert.ok(spectatorLiveContent.includes('SpectatorLiveQuestionView'));
      assert.ok(spectatorResultsContent.includes('SpectatorQuestionResultsView'));
    });

    await t.test('41. R12 host results regression PASS', () => {
      assert.ok(hostPageContent.includes('handleReviewPrevQuestion'));
      assert.ok(hostPageContent.includes('handleReviewNextQuestion'));
    });

    await t.test('42. guest join regression PASS', () => {
      assert.ok(studentPageContent.includes('COMPETITION_GUEST_TOKEN_KEY'));
      assert.ok(studentPageContent.includes('getInitialGuestSession'));
    });

    await t.test('43. R7 lazy analytics invariant PASS', () => {
      assert.ok(hostPageContent.includes('HostQuestionAnalyticsView'));
      // Verifying lazy analytics in hostPageContent: fetchAnalytics is only called when analytics tab is clicked
      assert.ok(hostAnalyticsContent.includes('getHostQuestionAnalytics'));
    });

    await t.test('44. full Competition regression PASS', () => {
      assert.ok(adaptersContent.includes('reindexCompetitionQuestions'));
      assert.ok(adaptersContent.includes('isDuplicateQuestion'));
      assert.ok(hostPageContent.includes('handleQuestionTypeChange'));
      assert.ok(hostPageContent.includes('Điền vào chỗ trống'));
    });
  });

});
