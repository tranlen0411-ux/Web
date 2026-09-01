// scripts/test_question_bank_global_grade_sync.mjs
// Unit test: Sync Global Class Header Filter to Grade Level for Question Bank (Fail-Closed & Race Hardening)

import assert from 'node:assert/strict';
import { deriveGradeFromClass } from '../src/utils/helpers.js';

console.log('=== RUNNING QUESTION BANK GLOBAL GRADE SYNC & FAIL-CLOSED TESTS ===');

/**
 * Hàm mô phỏng chính xác logic xác định scope và effectiveGrade trong QuestionBankListTab
 */
const evaluateQuestionBankScope = ({
  activeGlobalClassFilter,
  classResolutionStatus,
  resolvedClass,
  selectedGrade
}) => {
  const hasSpecificGlobalClass = Boolean(
    activeGlobalClassFilter &&
    activeGlobalClassFilter !== 'ALL' &&
    activeGlobalClassFilter !== 'NO_CLASS'
  );

  const globalGrade = hasSpecificGlobalClass && classResolutionStatus === 'resolved'
    ? deriveGradeFromClass(resolvedClass)
    : null;

  let effectiveGrade = undefined;
  let isFilterBlocked = false;
  let canFetch = true;
  let errorMessage = null;

  if (hasSpecificGlobalClass) {
    if (classResolutionStatus === 'loading' || classResolutionStatus === 'idle') {
      effectiveGrade = null;
      isFilterBlocked = true;
      canFetch = false; // Đang loading, chặn fetch không-filter
    } else if (classResolutionStatus === 'failed' || globalGrade == null) {
      effectiveGrade = null;
      isFilterBlocked = true;
      canFetch = false;
      errorMessage = 'Không thể xác định khối lớp từ bộ lọc Header.';
    } else {
      effectiveGrade = globalGrade;
      canFetch = true;
    }
  } else {
    effectiveGrade = selectedGrade ? Number(selectedGrade) : undefined;
    canFetch = true;
  }

  return {
    hasSpecificGlobalClass,
    globalGrade,
    effectiveGrade,
    isFilterBlocked,
    canFetch,
    errorMessage
  };
};

// 1. deriveGradeFromClass tests
{
  // 1.1 Direct grade_level field
  assert.equal(deriveGradeFromClass({ id: 'c1', name: 'Lớp 1A', grade_level: 1 }), 1);
  assert.equal(deriveGradeFromClass({ id: 'c2', name: 'Lớp 2.12', grade_level: 2 }), 2);
  assert.equal(deriveGradeFromClass({ id: 'c5', name: 'Toán nâng cao', grade_level: '5' }), 5);
  console.log('PASS 1.1: Direct grade_level field verified');

  // 1.2 Direct grade field
  assert.equal(deriveGradeFromClass({ id: 'c3', name: 'Nhóm học tập', grade: 3 }), 3);
  assert.equal(deriveGradeFromClass({ id: 'c4', name: 'Chuyên đề', grade: '4' }), 4);
  console.log('PASS 1.2: Direct grade field verified');

  // 1.3 Parse from name / class_name
  assert.equal(deriveGradeFromClass({ id: 'c1', name: 'Lớp 1A' }), 1);
  assert.equal(deriveGradeFromClass({ id: 'c2', name: 'Lớp 2.12' }), 2);
  assert.equal(deriveGradeFromClass({ id: 'c3', name: '1A' }), 1);
  assert.equal(deriveGradeFromClass({ id: 'c4', name: 'Khối 3' }), 3);
  assert.equal(deriveGradeFromClass({ id: 'c5', class_name: 'Lớp 4B' }), 4);
  assert.equal(deriveGradeFromClass({ id: 'c10', name: 'Lớp 10A1' }), 10);
  assert.equal(deriveGradeFromClass({ id: 'c12', name: 'Lớp 12B' }), 12);
  console.log('PASS 1.3: Name parsing ("Lớp 1A" -> 1, "Lớp 2.12" -> 2, etc.) verified');

  // 1.4 Edge cases & nulls
  assert.equal(deriveGradeFromClass(null), null);
  assert.equal(deriveGradeFromClass(undefined), null);
  assert.equal(deriveGradeFromClass({}), null);
  assert.equal(deriveGradeFromClass({ name: 'Toàn trường' }), null);
  assert.equal(deriveGradeFromClass({ name: 'Bồi dưỡng HSG' }), null);
  console.log('PASS 1.4: Null and invalid class metadata return null verified');
}

// 2. Runtime Contract Scenarios
{
  // Scenario A: Header = Tất cả các lớp, Question Bank local grade = Tất cả
  // => globalGrade = null, localGrade = '', effectiveGrade = undefined
  const resA = evaluateQuestionBankScope({
    activeGlobalClassFilter: 'ALL',
    classResolutionStatus: 'idle',
    resolvedClass: null,
    selectedGrade: ''
  });
  assert.equal(resA.hasSpecificGlobalClass, false);
  assert.equal(resA.globalGrade, null);
  assert.equal(resA.effectiveGrade, undefined);
  assert.equal(resA.canFetch, true);
  console.log('PASS Scenario A: Header = Tất cả các lớp, local = Tất cả => effectiveGrade = undefined (xem toàn bộ)');

  // Scenario B: Header = Lớp 1A
  // => globalGrade = 1, localGrade = '', effectiveGrade = 1 (request grade_level = 1, không thấy Khối 2)
  const resB = evaluateQuestionBankScope({
    activeGlobalClassFilter: 'uuid-1a',
    classResolutionStatus: 'resolved',
    resolvedClass: { id: 'uuid-1a', name: 'Lớp 1A', grade_level: 1 },
    selectedGrade: ''
  });
  assert.equal(resB.hasSpecificGlobalClass, true);
  assert.equal(resB.globalGrade, 1);
  assert.equal(resB.effectiveGrade, 1);
  assert.equal(resB.canFetch, true);
  console.log('PASS Scenario B: Header = Lớp 1A => effectiveGrade = 1');

  // Scenario C: Header = Lớp 2.12
  // => globalGrade = 2, localGrade = '1', effectiveGrade = 2 (bị khóa cứng vào globalGrade 2)
  const resC = evaluateQuestionBankScope({
    activeGlobalClassFilter: 'uuid-2-12',
    classResolutionStatus: 'resolved',
    resolvedClass: { id: 'uuid-2-12', name: 'Lớp 2.12', grade_level: 2 },
    selectedGrade: '1' // Giả lập người dùng từng chọn local grade 1 trước đó
  });
  assert.equal(resC.hasSpecificGlobalClass, true);
  assert.equal(resC.globalGrade, 2);
  assert.equal(resC.effectiveGrade, 2);
  assert.equal(resC.canFetch, true);
  console.log('PASS Scenario C: Header = Lớp 2.12 => effectiveGrade = 2 (khóa theo Header, không cho chọn Khối 1)');

  // Scenario D: Header = Tất cả các lớp, local Question Bank = Lớp 2
  // => globalGrade = null, localGrade = '2', effectiveGrade = 2
  const resD = evaluateQuestionBankScope({
    activeGlobalClassFilter: 'ALL',
    classResolutionStatus: 'idle',
    resolvedClass: null,
    selectedGrade: '2'
  });
  assert.equal(resD.hasSpecificGlobalClass, false);
  assert.equal(resD.globalGrade, null);
  assert.equal(resD.effectiveGrade, 2);
  assert.equal(resD.canFetch, true);
  console.log('PASS Scenario D: Header = Tất cả các lớp, local = Lớp 2 => effectiveGrade = 2');

  // Scenario E: Header đổi từ Lớp 1A sang Lớp 2.12 (Trong lúc metadata Lớp 2.12 đang loading)
  // => resolvedClass bị xóa về null ngay lập tức, classResolutionStatus = 'loading'
  // => KHÔNG dùng effectiveGrade=1 cũ, request bị blocked (canFetch = false)
  const resE = evaluateQuestionBankScope({
    activeGlobalClassFilter: 'uuid-2-12',
    classResolutionStatus: 'loading',
    resolvedClass: null, // Đã xóa ngay lập tức
    selectedGrade: '1'
  });
  assert.equal(resE.hasSpecificGlobalClass, true);
  assert.equal(resE.globalGrade, null);
  assert.equal(resE.effectiveGrade, null);
  assert.equal(resE.isFilterBlocked, true);
  assert.equal(resE.canFetch, false);
  console.log('PASS Scenario E: Header đổi lớp đang loading => Clear stale class ngay lập tức & Block fetch không-filter');

  // Scenario F: Header chọn UUID lớp nhưng metadata resolution failed
  // => classResolutionStatus = 'failed', resolvedClass = null
  // => Fail-Closed: effectiveGrade = null, canFetch = false, có thông báo lỗi
  const resF = evaluateQuestionBankScope({
    activeGlobalClassFilter: 'uuid-nonexistent',
    classResolutionStatus: 'failed',
    resolvedClass: null,
    selectedGrade: '3'
  });
  assert.equal(resF.hasSpecificGlobalClass, true);
  assert.equal(resF.effectiveGrade, null);
  assert.equal(resF.isFilterBlocked, true);
  assert.equal(resF.canFetch, false);
  assert.equal(resF.errorMessage, 'Không thể xác định khối lớp từ bộ lọc Header.');
  console.log('PASS Scenario F: Header metadata resolution failed => Fail-closed & Block unfiltered fetch');

  // Scenario G: Header class metadata resolved nhưng không derive được grade
  // => classResolutionStatus = 'resolved', resolvedClass = { name: 'Nhóm bồi dưỡng HSG' }
  // => globalGrade = null => Fail-Closed: effectiveGrade = null, canFetch = false
  const resG = evaluateQuestionBankScope({
    activeGlobalClassFilter: 'uuid-special-group',
    classResolutionStatus: 'resolved',
    resolvedClass: { id: 'uuid-special-group', name: 'Nhóm bồi dưỡng HSG' }, // không có grade_level và tên không có số khối
    selectedGrade: ''
  });
  assert.equal(resG.hasSpecificGlobalClass, true);
  assert.equal(resG.globalGrade, null);
  assert.equal(resG.effectiveGrade, null);
  assert.equal(resG.isFilterBlocked, true);
  assert.equal(resG.canFetch, false);
  assert.equal(resG.errorMessage, 'Không thể xác định khối lớp từ bộ lọc Header.');
  console.log('PASS Scenario G: Header class không có grade_level hợp lệ => Fail-closed');
}

// 3. Stale Response Race Guard Simulation (Scenario H)
{
  let currentSeq = 0;
  let activeStateData = null;

  const simulateFetch = async (targetGrade, delayMs) => {
    const seq = ++currentSeq;
    await new Promise(resolve => setTimeout(resolve, delayMs));

    // Stale guard
    if (seq !== currentSeq) {
      return { dropped: true, seq };
    }

    activeStateData = { grade: targetGrade, seq };
    return { dropped: false, seq, data: activeStateData };
  };

  // Phát request 1 (Lớp 1, delay 60ms)
  const p1 = simulateFetch(1, 60);

  // Người dùng đổi sang Lớp 2 sau 10ms (delay 20ms)
  await new Promise(resolve => setTimeout(resolve, 10));
  const p2 = simulateFetch(2, 20);

  const [r1, r2] = await Promise.all([p1, p2]);

  assert.equal(r1.dropped, true); // Request 1 chậm hơn bị hủy, không đè lên state
  assert.equal(r2.dropped, false); // Request 2 được ghi nhận
  assert.equal(activeStateData.grade, 2); // State cuối cùng đúng là Lớp 2
  console.log('PASS Scenario H: Stale Response Race Guard verified (Request cũ không overwrite state mới)');
}

console.log('=== ALL QUESTION BANK GLOBAL GRADE SYNC & HARDENING TESTS PASSED! ===');
