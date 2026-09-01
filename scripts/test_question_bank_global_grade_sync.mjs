// scripts/test_question_bank_global_grade_sync.mjs
// Unit test: Sync Global Class Header Filter to Grade Level for Question Bank

import assert from 'node:assert/strict';
import { deriveGradeFromClass } from '../src/utils/helpers.js';

console.log('=== RUNNING QUESTION BANK GLOBAL GRADE SYNC UNIT TESTS ===');

// Helper to calculate effectiveGrade matching QuestionBankListTab logic
const computeEffectiveGrade = (globalGrade, selectedGrade) => {
  return globalGrade != null
    ? globalGrade
    : (selectedGrade ? Number(selectedGrade) : undefined);
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
  const classA = null;
  const globalGradeA = deriveGradeFromClass(classA);
  const selectedGradeA = '';
  const effectiveGradeA = computeEffectiveGrade(globalGradeA, selectedGradeA);
  assert.equal(globalGradeA, null);
  assert.equal(effectiveGradeA, undefined);
  console.log('PASS Scenario A: Header = Tất cả các lớp, local = Tất cả => effectiveGrade = undefined (xem toàn bộ)');

  // Scenario B: Header = Lớp 1A
  // => globalGrade = 1, localGrade = '', effectiveGrade = 1 (request grade_level = 1, không thấy Khối 2)
  const classB = { id: 'uuid-1a', name: 'Lớp 1A', grade_level: 1 };
  const globalGradeB = deriveGradeFromClass(classB);
  const selectedGradeB = '';
  const effectiveGradeB = computeEffectiveGrade(globalGradeB, selectedGradeB);
  assert.equal(globalGradeB, 1);
  assert.equal(effectiveGradeB, 1);
  console.log('PASS Scenario B: Header = Lớp 1A => effectiveGrade = 1');

  // Scenario C: Header = Lớp 2.12
  // => globalGrade = 2, localGrade = '1', effectiveGrade = 2 (bị khóa cứng vào globalGrade 2)
  const classC = { id: 'uuid-2-12', name: 'Lớp 2.12', grade_level: 2 };
  const globalGradeC = deriveGradeFromClass(classC);
  const selectedGradeC = '1'; // Giả lập người dùng từng chọn local grade 1 trước đó
  const effectiveGradeC = computeEffectiveGrade(globalGradeC, selectedGradeC);
  assert.equal(globalGradeC, 2);
  assert.equal(effectiveGradeC, 2); // Khóa vào 2, không cho vượt ra ngoài
  console.log('PASS Scenario C: Header = Lớp 2.12 => effectiveGrade = 2 (khóa theo Header, không cho chọn Khối 1)');

  // Scenario D: Header = Tất cả các lớp, local Question Bank = Lớp 2
  // => globalGrade = null, localGrade = '2', effectiveGrade = 2
  const classD = null;
  const globalGradeD = deriveGradeFromClass(classD);
  const selectedGradeD = '2';
  const effectiveGradeD = computeEffectiveGrade(globalGradeD, selectedGradeD);
  assert.equal(globalGradeD, null);
  assert.equal(effectiveGradeD, 2);
  console.log('PASS Scenario D: Header = Tất cả các lớp, local = Lớp 2 => effectiveGrade = 2');
}

console.log('=== ALL QUESTION BANK GLOBAL GRADE SYNC TESTS PASSED! ===');
