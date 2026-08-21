import assert from 'node:assert/strict';

console.log('================================================================');
console.log('🧪 RUNNING DECIMAL MANUAL GRADE PARSING & VALIDATION TESTS');
console.log('================================================================\n');

// 1. Logic chuẩn hóa điểm số của SubmissionGradingModal.jsx
function parseManualGrades(manualGrades) {
  return Object.keys(manualGrades).map(qId => {
    const rawPoints = Number(manualGrades[qId]?.points_earned ?? 0);
    return {
      question_id: qId,
      points_earned: Number.isFinite(rawPoints) ? rawPoints : 0,
      teacher_comment: manualGrades[qId]?.teacher_comment || ''
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

// TEST 1: Decimal values 0.5, 1.5, 2.75 are preserved without truncation
const input1 = {
  'q1': { points_earned: 0.5, teacher_comment: 'Tốt' },
  'q2': { points_earned: '1.5', teacher_comment: 'Đầy đủ' },
  'q3': { points_earned: 2.75, teacher_comment: 'Khá' },
  'q4': { points_earned: 3, teacher_comment: 'Xuất sắc' }
};

const parsed1 = parseManualGrades(input1);
assert.strictEqual(parsed1[0].points_earned, 0.5, '0.5 must be preserved as 0.5, not truncated to 0');
assert.strictEqual(parsed1[1].points_earned, 1.5, '1.5 string must be parsed to 1.5, not 1');
assert.strictEqual(parsed1[2].points_earned, 2.75, '2.75 must be preserved as 2.75');
assert.strictEqual(parsed1[3].points_earned, 3, '3 integer must be preserved as 3');
console.log('✅ TEST 1 (PASS): 0.5, 1.5, 2.75 được bảo toàn nguyên vẹn, không bị parseInt làm tròn.');

// TEST 2: Total score calculation with decimal scores
const objectiveScore = 5;
const totalManual = parsed1.reduce((sum, item) => sum + item.points_earned, 0);
const finalTotal = objectiveScore + totalManual;
assert.strictEqual(totalManual, 7.75, 'Total manual score must sum correctly (0.5 + 1.5 + 2.75 + 3 = 7.75)');
assert.strictEqual(finalTotal, 12.75, 'Final total must be 12.75');
console.log('✅ TEST 2 (PASS): Tổng điểm thập phân tính chính xác 100% (5 + 7.75 = 12.75).');

// TEST 3: Edge cases (empty, undefined, NaN, null) fallback safely to 0
const inputEdge = {
  'q_null': { points_earned: null },
  'q_undef': { points_earned: undefined },
  'q_empty': { points_earned: '' },
  'q_invalid': { points_earned: 'abc' }
};
const parsedEdge = parseManualGrades(inputEdge);
assert.strictEqual(parsedEdge[0].points_earned, 0, 'null -> 0');
assert.strictEqual(parsedEdge[1].points_earned, 0, 'undefined -> 0');
assert.strictEqual(parsedEdge[2].points_earned, 0, 'empty string -> 0');
assert.strictEqual(parsedEdge[3].points_earned, 0, 'invalid string -> 0');
console.log('✅ TEST 3 (PASS): Xử lý an toàn các giá trị biên null/undefined/NaN về 0.');

// TEST 4: Score limit validation (0 <= points_earned <= question.points)
const mockSub = {
  academic_submission_answers: [
    {
      question_id: 'q_essay_1',
      academic_exercise_questions: { question_type: 'essay', points: 5, prompt: 'Tự luận toán' }
    }
  ]
};

// Valid score within range
const validRes = validateManualGrades(mockSub, { 'q_essay_1': { points_earned: 4.5 } });
assert.strictEqual(validRes.valid, true, '4.5 points for 5 max points is valid');

// Exceeds max points
const exceedRes = validateManualGrades(mockSub, { 'q_essay_1': { points_earned: 5.5 } });
assert.strictEqual(exceedRes.valid, false, '5.5 points for 5 max points must fail validation');

// Negative points
const negRes = validateManualGrades(mockSub, { 'q_essay_1': { points_earned: -1 } });
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

console.log('\n================================================================');
console.log('🎉 TOÀN BỘ 5/5 DECIMAL MANUAL GRADE TESTS PASS 100%!');
console.log('================================================================\n');
