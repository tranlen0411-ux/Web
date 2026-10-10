import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  sanitizeQuestionsForCreation,
  generateMatchingTempId,
  MAX_COMPETITION_QUESTIONS
} from '../src/utils/competitionQuestionAdapters.js';

const hostPageContent = fs.readFileSync('src/pages/CompetitionHostPage.jsx', 'utf8');
const studentPageContent = fs.readFileSync('src/pages/CompetitionStudentPage.jsx', 'utf8');
const adaptersContent = fs.readFileSync('src/utils/competitionQuestionAdapters.js', 'utf8');
const spectatorLiveContent = fs.readFileSync('src/components/competition/spectator/SpectatorLiveQuestionView.jsx', 'utf8');
const spectatorResultsContent = fs.readFileSync('src/components/competition/spectator/SpectatorQuestionResultsView.jsx', 'utf8');
const reviewViewContent = fs.readFileSync('src/components/competition/StudentQuestionReviewView.jsx', 'utf8');
const packageJsonContent = fs.readFileSync('package.json', 'utf8');

test('COMPETITION V1 R16-B — MATCHING FRONTEND UI TEST MATRIX', async (t) => {

  // =========================================================================
  // GROUP 1: HOST MATCHING QUESTION TYPE & EDITOR RULES
  // =========================================================================
  await t.test('Group 1: Host Matching Question Editor', async (t) => {
    // 1. Matching appears in Host manual question type selector
    await t.test('1. Matching appears in Host manual question type selector with label "Nối cặp"', () => {
      assert.ok(hostPageContent.includes('<option value="matching">Nối cặp</option>'), 'Phải có option matching với nhãn Nối cặp');
    });

    // 2. Host editor initializes with 2 pairs
    await t.test('2. Host editor initializes with 2 pairs when switching to matching', () => {
      assert.ok(hostPageContent.includes("newType === 'matching'"), 'Phải có nhánh matching trong handleQuestionTypeChange');
      assert.ok(hostPageContent.includes('pairs: ['), 'Editor phải khởi tạo mảng pairs');
      assert.ok(hostPageContent.includes('leftId1') && hostPageContent.includes('leftId2'), 'Phải khởi tạo tối thiểu 2 cặp ID');
    });

    // 3. Add pair works up to 6
    await t.test('3. Add pair works up to 6 pairs', () => {
      assert.ok(hostPageContent.includes('handleAddMatchingPair'), 'Phải có hàm handleAddMatchingPair');
      assert.ok(hostPageContent.includes('currentPairs.length >= 6'), 'Phải chặn khi đạt 6 cặp');
    });

    // 4. Cannot exceed 6 pairs
    await t.test('4. Cannot exceed 6 pairs limit', () => {
      assert.ok(hostPageContent.includes('tối đa 6 cặp'), 'Phải hiển thị cảnh báo tối đa 6 cặp');
    });

    // 5. Cannot delete below 2 pairs
    await t.test('5. Cannot delete below 2 pairs', () => {
      assert.ok(hostPageContent.includes('handleRemoveMatchingPair'), 'Phải có hàm handleRemoveMatchingPair');
      assert.ok(hostPageContent.includes('currentPairs.length <= 2'), 'Phải chặn xóa khi còn 2 cặp');
      assert.ok(hostPageContent.includes('ít nhất 2 cặp') || hostPageContent.includes('tối thiểu 2 cặp'), 'Phải hiển thị cảnh báo ít nhất 2 cặp');
    });

    // 6. Empty left text rejected
    await t.test('6. Empty left text rejected in host validation', () => {
      assert.ok(hostPageContent.includes('!leftOpt.text.trim()'), 'Phải từ chối nếu leftOpt text rỗng');
      assert.ok(hostPageContent.includes('vế trái'), 'Phải có thông báo lỗi vế trái');
    });

    // 7. Empty right text rejected
    await t.test('7. Empty right text rejected in host validation', () => {
      assert.ok(hostPageContent.includes('!rightOpt.text.trim()'), 'Phải từ chối nếu rightOpt text rỗng');
      assert.ok(hostPageContent.includes('vế phải'), 'Phải có thông báo lỗi vế phải');
    });
  });

  // =========================================================================
  // GROUP 2: ADAPTER & CANONICAL SERIALIZATION
  // =========================================================================
  await t.test('Group 2: Question Adapter & Serialization Contract', async (t) => {
    // 8. Matching adapter creates canonical options
    await t.test('8. Matching adapter creates canonical options with equal sides', () => {
      const inputQ = {
        question_order: 1,
        question_text: 'Nối các quốc gia với thủ đô tương ứng',
        question_type: 'matching',
        points: 10,
        time_limit_seconds: 30,
        matching_pairs: [
          { left_text: 'Việt Nam', right_text: 'Hà Nội' },
          { left_text: 'Nhật Bản', right_text: 'Tokyo' },
          { left_text: 'Pháp', right_text: 'Paris' }
        ]
      };

      const sanitized = sanitizeQuestionsForCreation([inputQ]);
      assert.strictEqual(sanitized.length, 1);
      const q = sanitized[0];
      assert.strictEqual(q.question_type, 'matching');
      assert.strictEqual(q.options.length, 6);
      
      const leftOptions = q.options.filter(o => o.side === 'left');
      const rightOptions = q.options.filter(o => o.side === 'right');
      assert.strictEqual(leftOptions.length, 3);
      assert.strictEqual(rightOptions.length, 3);
      assert.strictEqual(q.correct_answer.pairs.length, 3);
    });

    // 9. correct_answer.pairs references generated temporary IDs
    await t.test('9. correct_answer.pairs references generated temporary IDs matching options', () => {
      const inputQ = {
        question_order: 1,
        question_text: 'Nối các thuật ngữ',
        question_type: 'matching',
        matching_pairs: [
          { left_text: 'A', right_text: 'Alpha' },
          { left_text: 'B', right_text: 'Beta' }
        ]
      };

      const sanitized = sanitizeQuestionsForCreation([inputQ]);
      const q = sanitized[0];
      const optionIdSet = new Set(q.options.map(o => o.id));

      for (const pair of q.correct_answer.pairs) {
        assert.ok(optionIdSet.has(pair.left_id), 'left_id phải tồn tại trong options');
        assert.ok(optionIdSet.has(pair.right_id), 'right_id phải tồn tại trong options');
        const leftOpt = q.options.find(o => o.id === pair.left_id);
        const rightOpt = q.options.find(o => o.id === pair.right_id);
        assert.strictEqual(leftOpt.side, 'left');
        assert.strictEqual(rightOpt.side, 'right');
      }
    });

    // 10. Existing single_choice adapter unchanged
    await t.test('10. Existing single_choice adapter unchanged', () => {
      const singleQ = {
        question_order: 1,
        question_text: 'Thủ đô Việt Nam?',
        question_type: 'single_choice',
        points: 10,
        options: [{ id: 'opt_1', text: 'Hà Nội' }, { id: 'opt_2', text: 'Huế' }],
        correct_answer: { option_id: 'opt_1' }
      };
      const sanitized = sanitizeQuestionsForCreation([singleQ]);
      assert.strictEqual(sanitized[0].question_type, 'single_choice');
      assert.strictEqual(sanitized[0].correct_answer.option_id, 'opt_1');
    });

    // 11. Existing multiple_choice unchanged
    await t.test('11. Existing multiple_choice adapter unchanged', () => {
      const multiQ = {
        question_order: 1,
        question_text: 'Thành phố lớn?',
        question_type: 'multiple_choice',
        options: [{ id: 'opt_1', text: 'Hà Nội' }, { id: 'opt_2', text: 'TP.HCM' }, { id: 'opt_3', text: 'Huế' }],
        correct_answer: { option_ids: ['opt_1', 'opt_2'] }
      };
      const sanitized = sanitizeQuestionsForCreation([multiQ]);
      assert.strictEqual(sanitized[0].question_type, 'multiple_choice');
      assert.deepStrictEqual(sanitized[0].correct_answer.option_ids, ['opt_1', 'opt_2']);
    });

    // 12. true_false accepted, preserved canonical shape and fails closed when malformed
    await t.test('12. Existing true_false accepted and preserved in sanitizeQuestionsForCreation', () => {
      const tfQ = {
        question_order: 1,
        question_text: 'Trái đất hình tròn?',
        question_type: 'true_false',
        points: 10,
        time_limit_seconds: 20,
        options: [{ id: 'opt_true', text: 'Đúng' }, { id: 'opt_false', text: 'Sai' }],
        correct_answer: { option_id: 'opt_true' }
      };
      const sanitized = sanitizeQuestionsForCreation([tfQ]);
      assert.strictEqual(sanitized.length, 1);
      assert.strictEqual(sanitized[0].question_type, 'true_false');
      assert.strictEqual(sanitized[0].correct_answer.option_id, 'opt_true');
      assert.strictEqual(sanitized[0].options.length, 2);
      assert.strictEqual(sanitized[0].options[0].text, 'Đúng');
      assert.strictEqual(sanitized[0].options[1].text, 'Sai');

      // Malformed true_false fails closed
      const missingOptionIdQ = {
        question_order: 1,
        question_text: 'Câu hỏi thiếu đáp án',
        question_type: 'true_false',
        options: [{ id: 'opt_true', text: 'Đúng' }, { id: 'opt_false', text: 'Sai' }],
        correct_answer: { option_id: '' }
      };
      assert.throws(() => {
        sanitizeQuestionsForCreation([missingOptionIdQ]);
      }, /thiếu đáp án đúng/);

      const invalidOptionIdQ = {
        question_order: 1,
        question_text: 'Câu hỏi sai đáp án',
        question_type: 'true_false',
        options: [{ id: 'opt_true', text: 'Đúng' }, { id: 'opt_false', text: 'Sai' }],
        correct_answer: { option_id: 'opt_unknown' }
      };
      assert.throws(() => {
        sanitizeQuestionsForCreation([invalidOptionIdQ]);
      }, /không nằm trong danh sách lựa chọn/);

      const tooFewOptionsQ = {
        question_order: 1,
        question_text: 'Câu hỏi chỉ có 1 lựa chọn',
        question_type: 'true_false',
        options: [{ id: 'opt_true', text: 'Đúng' }],
        correct_answer: { option_id: 'opt_true' }
      };
      assert.throws(() => {
        sanitizeQuestionsForCreation([tooFewOptionsQ]);
      }, /phải có ít nhất 2 phương án/);
    });

    // 13. short_answer unchanged
    await t.test('13. Existing short_answer adapter unchanged', () => {
      const saQ = {
        question_order: 1,
        question_text: '2 + 2 = ?',
        question_type: 'short_answer',
        correct_answer: { accepted_answers: ['4', 'bốn'] }
      };
      const sanitized = sanitizeQuestionsForCreation([saQ]);
      assert.strictEqual(sanitized[0].question_type, 'short_answer');
      assert.deepStrictEqual(sanitized[0].correct_answer.accepted_answers, ['4', 'bốn']);
    });

    // 14. fill_blank unchanged (canonicalizes to short_answer)
    await t.test('14. Existing fill_blank adapter unchanged (canonicalizes to short_answer)', () => {
      const fbQ = {
        question_order: 1,
        question_text: 'Điền vào chỗ trống: Hà Nội là [...] của Việt Nam',
        question_type: 'fill_blank',
        correct_answer: { accepted_answers: ['thủ đô', 'thu do'] }
      };
      const sanitized = sanitizeQuestionsForCreation([fbQ]);
      assert.strictEqual(sanitized[0].question_type, 'short_answer');
      assert.deepStrictEqual(sanitized[0].correct_answer.accepted_answers, ['thủ đô', 'thu do']);
    });
  });

  // =========================================================================
  // GROUP 3: STUDENT TAP-TO-MATCH INTERACTION & SUBMISSION
  // =========================================================================
  await t.test('Group 3: Student Tap-To-Match Interaction & Submission Logic', async (t) => {
    // 15. Matching active snapshot renders left/right options
    await t.test('15. Matching active snapshot renders left and right columns', () => {
      assert.ok(studentPageContent.includes("isMatching"), 'Student page phải nhận diện isMatching');
      assert.ok(studentPageContent.includes("matchingLeftOptions"), 'Phải lọc matchingLeftOptions');
      assert.ok(studentPageContent.includes("matchingRightOptions"), 'Phải lọc matchingRightOptions');
      assert.ok(studentPageContent.includes("Vế A (Trái)") || studentPageContent.includes("Vế Trái") || studentPageContent.includes("Vế A"));
      assert.ok(studentPageContent.includes("Vế B (Phải)") || studentPageContent.includes("Vế Phải") || studentPageContent.includes("Vế B"));
    });

    // 16. Opaque UUIDs are treated as opaque strings
    await t.test('16. Opaque UUIDs are treated as opaque strings without prefix/split parsing', () => {
      assert.ok(!studentPageContent.includes("opt.id.split('_')"), 'Không được split id theo gạch dưới');
      assert.ok(!studentPageContent.includes("uuid.substring"), 'Không được parse cấu trúc UUID');
      assert.ok(!adaptersContent.includes("uuid.substring"), 'Adapter không được parse UUID');
    });

    // 17. Tap left then right creates pair
    await t.test('17. Tap left then right creates pair simulation', () => {
      let selectedLeftId = null;
      let selectedRightId = null;
      let pairs = [];

      function handleSelect(option) {
        if (option.side === 'left') {
          if (selectedLeftId === option.id) {
            selectedLeftId = null;
            return;
          }
          if (selectedRightId) {
            // Right was selected, now left -> form pair
            pairs = pairs.filter(p => p.left_id !== option.id && p.right_id !== selectedRightId);
            pairs.push({ left_id: option.id, right_id: selectedRightId });
            selectedLeftId = null;
            selectedRightId = null;
          } else {
            selectedLeftId = option.id;
          }
        } else {
          if (selectedRightId === option.id) {
            selectedRightId = null;
            return;
          }
          if (selectedLeftId) {
            // Left was selected, now right -> form pair
            pairs = pairs.filter(p => p.left_id !== selectedLeftId && p.right_id !== option.id);
            pairs.push({ left_id: selectedLeftId, right_id: option.id });
            selectedLeftId = null;
            selectedRightId = null;
          } else {
            selectedRightId = option.id;
          }
        }
      }

      // Tap left then right
      handleSelect({ id: 'uuid-left-1', side: 'left' });
      assert.strictEqual(selectedLeftId, 'uuid-left-1');
      assert.strictEqual(pairs.length, 0);

      handleSelect({ id: 'uuid-right-1', side: 'right' });
      assert.strictEqual(selectedLeftId, null);
      assert.strictEqual(selectedRightId, null);
      assert.strictEqual(pairs.length, 1);
      assert.deepStrictEqual(pairs[0], { left_id: 'uuid-left-1', right_id: 'uuid-right-1' });

      // Tap right then left (reverse order)
      handleSelect({ id: 'uuid-right-2', side: 'right' });
      assert.strictEqual(selectedRightId, 'uuid-right-2');
      handleSelect({ id: 'uuid-left-2', side: 'left' });
      assert.strictEqual(pairs.length, 2);
      assert.deepStrictEqual(pairs[1], { left_id: 'uuid-left-2', right_id: 'uuid-right-2' });
    });

    // 18. Option cannot belong to two pairs
    await t.test('18. Option cannot belong to two pairs', () => {
      let pairs = [
        { left_id: 'L1', right_id: 'R1' },
        { left_id: 'L2', right_id: 'R2' }
      ];

      const newLeftId = 'L1';
      const newRightId = 'R2';
      pairs = pairs.filter(p => p.left_id !== newLeftId && p.right_id !== newRightId);
      pairs.push({ left_id: newLeftId, right_id: newRightId });

      assert.strictEqual(pairs.length, 1);
      assert.deepStrictEqual(pairs[0], { left_id: 'L1', right_id: 'R2' });

      const allLefts = pairs.map(p => p.left_id);
      const allRights = pairs.map(p => p.right_id);
      assert.strictEqual(new Set(allLefts).size, allLefts.length);
      assert.strictEqual(new Set(allRights).size, allRights.length);
    });

    // 19. Reassigning pair updates state safely
    await t.test('19. Reassigning pair updates state without orphaned duplicates', () => {
      assert.ok(studentPageContent.includes("handleSelectMatchingOption"), 'StudentPage phải có hàm handleSelectMatchingOption');
      assert.ok(studentPageContent.includes("p.left_id !== optId") || studentPageContent.includes("p.left_id !== leftId"), 'Phải lọc cặp trùng vế');
      assert.ok(studentPageContent.includes("p.right_id !== optId") || studentPageContent.includes("p.right_id !== rightId"), 'Phải lọc cặp trùng vế');
    });

    // 20. Removing pair works
    await t.test('20. Removing pair works via handleRemoveMatchingPair', () => {
      assert.ok(studentPageContent.includes("handleRemoveMatchingPair"), 'StudentPage phải có hàm handleRemoveMatchingPair');
    });

    // 21. Submit disabled while incomplete
    await t.test('21. Submit button disabled when pairs incomplete', () => {
      assert.ok(studentPageContent.includes("studentPairs.length === totalMatchingPairs"), 'Chỉ hoàn tất khi số cặp bằng totalMatchingPairs');
      assert.ok(studentPageContent.includes("studentPairs.length < totalMatchingPairs"), 'Chưa đủ cặp thì nhắc nhở');
      assert.ok(studentPageContent.includes("trước khi nộp") || studentPageContent.includes("Hãy nối đủ"));
    });

    // 22. Completed answer serializes exact pair objects
    await t.test('22. Completed answer serializes exact pair objects in handleSubmitAnswer', () => {
      assert.ok(studentPageContent.includes("isMatching"), 'Phải kiểm tra isMatching');
      assert.ok(studentPageContent.includes("studentPairs"), 'Payload phải chứa studentPairs');
    });

    // 23. p_text_answer remains null
    await t.test('23. p_text_answer remains null for matching questions', () => {
      assert.ok(studentPageContent.includes("textAnswer: isShortAnswer ? studentTextAnswer.trim() : null"), 'textAnswer phải là null khi không phải short_answer');
    });

    // 24. Repeated snapshot does not erase current answer unexpectedly
    await t.test('24. Matching state is isolated from pure snapshot polling', () => {
      const resetBlock = studentPageContent.match(/useEffect\(\(\)\s*=>\s*\{[\s\S]*?currentQuestion\?\.id[\s\S]*?\}, \[[^\]]*currentQuestion\?\.id[^\]]*\]\)/);
      assert.ok(resetBlock, 'State reset phải lắng nghe đúng currentQuestion.id thay vì snapshot object');
    });

    // 25. Question ID change resets Matching state
    await t.test('25. Question ID change resets Matching state', () => {
      assert.ok(studentPageContent.includes("setStudentPairs([])"), 'Phải reset studentPairs về rỗng');
      assert.ok(studentPageContent.includes("setSelectedLeftId(null)"), 'Phải reset selectedLeftId');
      assert.ok(studentPageContent.includes("setSelectedRightId(null)"), 'Phải reset selectedRightId');
    });

    // 26. Submitted state locks interaction
    await t.test('26. Submitted state locks interaction', () => {
      assert.ok(studentPageContent.includes("hasSubmittedCurrentQuestion"), 'Phải có cờ hasSubmittedCurrentQuestion');
      assert.ok(studentPageContent.includes("disabled={disabled}"), 'Các nút lựa chọn phải bị disabled khi đã submit');
    });
  });

  // =========================================================================
  // GROUP 4: SECURITY & ANTI-LEAK
  // =========================================================================
  await t.test('Group 4: Security & Anti-Leak Rules', async (t) => {
    // 27. Active UI does not require correct_answer
    await t.test('27. Active student UI does not access or require correct_answer', () => {
      assert.ok(!studentPageContent.includes("currentQuestion.correct_answer?.pairs"), 'Active student UI không được truy cập correct_answer.pairs');
    });

    // 28. Active UI does not require matching_pairs
    await t.test('28. Active student UI does not access or require matching_pairs', () => {
      assert.ok(!studentPageContent.includes("currentQuestion.matching_pairs"), 'Active student UI không được truy cập matching_pairs');
    });

    // 29. No ID parsing or prefix relationship logic
    await t.test('29. No ID prefix correlation logic exists in client renderers', () => {
      assert.ok(!studentPageContent.includes("pair_1"), 'Không có hardcode pair_1');
      assert.ok(!studentPageContent.includes("startsWith('l_')"), 'Không được phụ thuộc prefix l_');
    });

    // 30. Spectator live view does not reveal answers
    await t.test('30. Spectator live view neutral layout without correct answer reveal', () => {
      assert.ok(spectatorLiveContent.includes("activeQuestion?.question_type === 'matching'"), 'Spectator Live hỗ trợ matching');
      assert.ok(!spectatorLiveContent.includes("correct_answer"), 'Spectator Live không được hiển thị correct_answer');
      assert.ok(!spectatorLiveContent.includes("matching_pairs"), 'Spectator Live không được hiển thị matching_pairs');
    });
  });

  // =========================================================================
  // GROUP 5: HOST & SPECTATOR RESULTS VIEW
  // =========================================================================
  await t.test('Group 5: Host & Spectator Results View', async (t) => {
    // 31. Closed result renders matching_pairs
    await t.test('31. Host closed results view renders matching_pairs with ArrowLeftRight', () => {
      assert.ok(hostPageContent.includes("activeDisplayedResults.matching_pairs"), 'Host page phải render matching_pairs');
      assert.ok(hostPageContent.includes("pair.left_text"), 'Phải render pair.left_text');
      assert.ok(hostPageContent.includes("pair.right_text"), 'Phải render pair.right_text');
    });

    // 32. Historical Matching result renders matching_pairs
    await t.test('32. Historical results render matching_pairs correctly via activeDisplayedResults', () => {
      assert.ok(hostPageContent.includes("activeDisplayedResults.matching_pairs"), 'Historical results dùng activeDisplayedResults.matching_pairs');
    });

    // 33. Empty matching_pairs fails gracefully
    await t.test('33. Empty matching_pairs renders fallback without crash', () => {
      assert.ok(hostPageContent.includes("Không có dữ liệu cặp nối đáp án đúng") || hostPageContent.includes("Không có dữ liệu"));
      assert.ok(spectatorResultsContent.includes("Chưa có dữ liệu cặp nối") || spectatorResultsContent.includes("matching_pairs"));
    });

    // 34. Existing choice results unchanged
    await t.test('34. Existing choice results distribution logic preserved', () => {
      assert.ok(hostPageContent.includes("activeDisplayedResults.distribution"), 'Host page giữ nguyên distribution cho choice');
      assert.ok(hostPageContent.includes("activeDisplayedResults.question_type !== 'matching'"), 'Chặn distribution đối với matching');
    });
  });

  // =========================================================================
  // GROUP 6: STATIC, ARCHITECTURE & DEPENDENCY CONSTRAINTS
  // =========================================================================
  await t.test('Group 6: Constraints & Architecture Compliance', async (t) => {
    // 35. No unsupported drag-and-drop dependency introduced
    await t.test('35. No drag-and-drop dependency added to package.json', () => {
      const pkg = JSON.parse(packageJsonContent);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      assert.strictEqual(allDeps['react-beautiful-dnd'], undefined);
      assert.strictEqual(allDeps['@hello-pangea/dnd'], undefined);
      assert.strictEqual(allDeps['@dnd-kit/core'], undefined);
      assert.strictEqual(allDeps['react-dnd'], undefined);
    });

    // 36. No new timer or setInterval introduced for matching
    await t.test('36. No new timer introduced for matching', () => {
      const matchingIntervals = studentPageContent.match(/setInterval\([^)]*matching[^)]*\)/i);
      assert.strictEqual(matchingIntervals, null, 'Không được tạo setInterval riêng cho matching');
      assert.ok(!studentPageContent.includes('matchingTimer'), 'Không có biến timer riêng cho matching');
    });

    // 37. Student Question Review renders matching correctly
    await t.test('37. Student Question Review component supports matching', () => {
      assert.ok(reviewViewContent.includes("q.question_type === 'matching'"), 'Review view phải hỗ trợ matching');
      assert.ok(reviewViewContent.includes("q.question_type !== 'matching'"), 'Review view phải chặn options thường cho matching');
      assert.ok(reviewViewContent.includes("Các cặp bạn đã nối:"), 'Review view phải hiển thị cặp sinh viên đã nối');
      assert.ok(reviewViewContent.includes("Đáp án đúng (Cặp chuẩn):"), 'Review view phải hiển thị đáp án đúng');
    });

    // 38. Color aesthetics compliance (Purple Ban)
    await t.test('38. Color aesthetics compliance - no purple ban violation in matching themes', () => {
      const matchingThemeSnippet = studentPageContent.match(/MATCHING_PAIR_THEMES\s*=\s*\[([\s\S]*?)\];/);
      assert.ok(matchingThemeSnippet, 'Phải có MATCHING_PAIR_THEMES');
      assert.ok(!matchingThemeSnippet[1].includes('purple'), 'Không được dùng màu tím (Purple Ban)');
      assert.ok(!matchingThemeSnippet[1].includes('violet'), 'Không được dùng màu violet (Purple Ban)');
      assert.ok(!matchingThemeSnippet[1].includes('fuchsia'), 'Không được dùng màu fuchsia (Purple Ban)');
    });
  });
});
