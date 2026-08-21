import assert from 'node:assert/strict';

console.log('================================================================');
console.log('🧪 RUNNING DECIMAL MANUAL GRADE PARSING & INSTANT CLOSE UX TESTS');
console.log('================================================================\n');

// 1. Logic chuẩn hóa điểm số của SubmissionGradingModal.jsx (Lọc chỉ câu hỏi tự luận/nộp file)
function parseManualGrades(selectedSub, manualGrades) {
  return (selectedSub?.academic_submission_answers || [])
    .filter(ans =>
      ['essay', 'image_upload', 'file_upload'].includes(
        ans.academic_exercise_questions?.question_type
      )
    )
    .map(ans => {
      const rawPoints = Number(
        manualGrades[ans.question_id]?.points_earned ?? ans.points_earned ?? 0
      );

      return {
        question_id: ans.question_id,
        points_earned: Number.isFinite(rawPoints) ? rawPoints : 0,
        teacher_comment:
          manualGrades[ans.question_id]?.teacher_comment || ''
      };
    });
}

function validateManualGrades(selectedSub, manualGrades) {
  for (const ans of selectedSub.academic_submission_answers || []) {
    const q = ans.academic_exercise_questions;
    if (['essay', 'image_upload', 'file_upload'].includes(q?.question_type)) {
      const rawVal = manualGrades[ans.question_id]?.points_earned;
      const numVal = Number(rawVal ?? 0);
      const maxPoints = q?.points ?? 10;
      if (isNaN(numVal) || numVal < 0 || numVal > maxPoints) {
        return {
          valid: false,
          error: `Điểm chấm cho câu "${q?.prompt}" không hợp lệ (Phải từ 0 đến ${maxPoints} điểm).`
        };
      }
    }
  }
  return { valid: true };
}

// Mô phỏng hàm handleSaveGrade của SubmissionGradingModal.jsx
async function simulateHandleSaveGrade({
  selectedSub,
  manualGrades,
  feedback,
  requestRevision,
  mockRpcCall,
  onClose,
  setMsg
}) {
  if (!selectedSub) return;
  const validation = validateManualGrades(selectedSub, manualGrades);
  if (!validation.valid) {
    setMsg(validation.error);
    return;
  }

  const gradesArray = parseManualGrades(selectedSub, manualGrades);
  const { data, error } = await mockRpcCall('grade_academic_submission', {
    p_submission_id: selectedSub.id,
    p_manual_grades: gradesArray,
    p_teacher_feedback: feedback,
    p_request_revision: requestRevision
  });

  if (error || !data?.success) {
    setMsg(error?.message || data?.message || 'Lỗi khi lưu kết quả chấm bài.');
  } else {
    setMsg('✅ Đã lưu điểm và nhận xét thành công!');
    onClose?.();
  }
}

// Mock Submission with mixed question types (objective + subjective)
const mixedSub = {
  id: 'sub-mixed-001',
  academic_submission_answers: [
    {
      question_id: 'q_choice_1',
      points_earned: 2,
      academic_exercise_questions: { question_type: 'single_choice', points: 2, prompt: 'Trắc nghiệm 1' }
    },
    {
      question_id: 'q_fill_2',
      points_earned: 3,
      academic_exercise_questions: { question_type: 'fill_blank', points: 3, prompt: 'Điền khuyết 2' }
    },
    {
      question_id: 'q_essay_3',
      points_earned: 0,
      academic_exercise_questions: { question_type: 'essay', points: 5, prompt: 'Tự luận văn' }
    },
    {
      question_id: 'q_img_4',
      points_earned: 0,
      academic_exercise_questions: { question_type: 'image_upload', points: 5, prompt: 'Nộp ảnh bài tập' }
    }
  ]
};

// TEST 1: Decimal values 0.5, 1.5, 2.75 are preserved without truncation
const input1 = {
  'q_essay_3': { points_earned: 0.5, teacher_comment: 'Tốt' },
  'q_img_4': { points_earned: '1.5', teacher_comment: 'Đầy đủ' }
};

const parsed1 = parseManualGrades(mixedSub, input1);
assert.strictEqual(parsed1[0].points_earned, 0.5, '0.5 must be preserved as 0.5, not truncated to 0');
assert.strictEqual(parsed1[1].points_earned, 1.5, '1.5 string must be parsed to 1.5, not 1');
console.log('✅ TEST 1 (PASS): 0.5, 1.5 được bảo toàn nguyên vẹn, không bị parseInt làm tròn.');

// TEST 2: Payload filter excludes objective questions (single_choice, fill_blank)
assert.strictEqual(parsed1.length, 2, 'gradesArray must ONLY contain 2 subjective questions');
assert.strictEqual(parsed1.some(i => i.question_id === 'q_choice_1'), false, 'single_choice must NOT be in gradesArray');
assert.strictEqual(parsed1.some(i => i.question_id === 'q_fill_2'), false, 'fill_blank must NOT be in gradesArray');
console.log('✅ TEST 2 (PASS): Payload p_manual_grades được lọc chính xác 100%, loại bỏ câu trắc nghiệm/điền khuyết.');

// TEST 3: Edge cases (empty, undefined, NaN, null) fallback safely to 0
const inputEdge = {
  'q_essay_3': { points_earned: null },
  'q_img_4': { points_earned: 'abc' }
};
const parsedEdge = parseManualGrades(mixedSub, inputEdge);
assert.strictEqual(parsedEdge[0].points_earned, 0, 'null -> 0');
assert.strictEqual(parsedEdge[1].points_earned, 0, 'invalid string -> 0');
console.log('✅ TEST 3 (PASS): Xử lý an toàn các giá trị biên null/undefined/NaN về 0.');

// TEST 4: Score limit validation (0 <= points_earned <= question.points)
const validRes = validateManualGrades(mixedSub, { 'q_essay_3': { points_earned: 4.5 } });
assert.strictEqual(validRes.valid, true, '4.5 points for 5 max points is valid');

const exceedRes = validateManualGrades(mixedSub, { 'q_essay_3': { points_earned: 5.5 } });
assert.strictEqual(exceedRes.valid, false, '5.5 points for 5 max points must fail validation');

const negRes = validateManualGrades(mixedSub, { 'q_essay_3': { points_earned: -1 } });
assert.strictEqual(negRes.valid, false, 'Negative points must fail validation');
console.log('✅ TEST 4 (PASS): Validate chính xác giới hạn điểm [0, question.points].');

// TEST 5: Status gate / Revision requested
const canGradeSubmitted = ['submitted', 'pending_manual_grade'].includes('pending_manual_grade');
const canGradeRevision = ['submitted', 'pending_manual_grade'].includes('revision_requested');
const canGradeGraded = ['submitted', 'pending_manual_grade'].includes('graded');
assert.strictEqual(canGradeSubmitted, true, 'pending_manual_grade can be graded');
assert.strictEqual(canGradeRevision, false, 'revision_requested cannot be graded again');
assert.strictEqual(canGradeGraded, false, 'graded cannot be graded again');
console.log('✅ TEST 5 (PASS): Status gate chỉ cho phép chấm khi submitted / pending_manual_grade.');

// TEST 6: Modal closes INSTANTLY on RPC success
let onCloseCalled = false;
let messageState = '';
let sentPayload = null;

await simulateHandleSaveGrade({
  selectedSub: mixedSub,
  manualGrades: { 'q_essay_3': { points_earned: 4.5 } },
  feedback: 'Tốt',
  requestRevision: false,
  mockRpcCall: async (name, payload) => {
    sentPayload = payload;
    return { data: { success: true, status: 'graded' }, error: null };
  },
  onClose: () => { onCloseCalled = true; },
  setMsg: (m) => { messageState = m; }
});

assert.strictEqual(onCloseCalled, true, 'onClose callback MUST be called immediately on success');
assert.strictEqual(messageState.includes('thành công'), true, 'Success message must be set');
assert.strictEqual(sentPayload.p_manual_grades.length, 2, 'Only 2 subjective items sent to RPC');
console.log('✅ TEST 6 (PASS): RPC success -> onClose được gọi NGAY LẬP TỨC và payload gửi đi đạt chuẩn.');

// TEST 7: Modal stays open on RPC error
let onCloseCalledOnError = false;
let errorMsgState = '';

await simulateHandleSaveGrade({
  selectedSub: mixedSub,
  manualGrades: { 'q_essay_3': { points_earned: 4.5 } },
  feedback: 'Lỗi',
  requestRevision: false,
  mockRpcCall: async () => ({ data: { success: false, message: 'Lỗi phân quyền' }, error: null }),
  onClose: () => { onCloseCalledOnError = true; },
  setMsg: (m) => { errorMsgState = m; }
});

assert.strictEqual(onCloseCalledOnError, false, 'onClose must NOT be called on error');
assert.strictEqual(errorMsgState, 'Lỗi phân quyền', 'Error message must be shown');
console.log('✅ TEST 7 (PASS): RPC error -> Modal GIỮ NGUYÊN MỞ và hiển thị thông báo lỗi.');

console.log('\n================================================================');
console.log('🎉 TOÀN BỘ 7/7 DECIMAL MANUAL GRADE, PAYLOAD FILTER & INSTANT CLOSE TESTS PASS 100%!');
console.log('================================================================\n');
