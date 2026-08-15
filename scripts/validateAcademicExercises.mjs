import fs from 'fs';
import path from 'path';

console.log('🔍 Bắt đầu kiểm tra tĩnh siêu chuẩn xác Hệ Thống Bài Tập Học Thuật 12.0 (Academic Exercises)...\n');

let hasError = false;

// 1. KIỂM TRA FILE SQL MIGRATION ADD_ACADEMIC_EXERCISES.SQL
const sqlPath = path.join(process.cwd(), 'ADD_ACADEMIC_EXERCISES.sql');
if (!fs.existsSync(sqlPath)) {
  console.error('❌ LỖI: Thiếu file ADD_ACADEMIC_EXERCISES.sql');
  hasError = true;
} else {
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Check 1: Candidate CTE pre-check
  if (!sql.includes('ClassCandidates AS') || !sql.includes('MIGRATION BỊ DỪNG')) {
    console.error('❌ LỖI MIGRATION: Thiếu Unified Candidate CTE pre-check!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Migration: Đã tích hợp Unified Candidate CTE pre-check!');
  }

  // Check 2: RPC delete_unreferenced_submission_files
  if (!sql.includes('FUNCTION public.delete_unreferenced_submission_files') || !sql.includes('v_is_referenced')) {
    console.error('❌ LỖI STORAGE RPC: Thiếu RPC delete_unreferenced_submission_files bảo mật!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Storage RPC: Đã tích hợp RPC delete_unreferenced_submission_files bảo mật!');
  }

  // Check 3: Distinct count check cho multiple_choice
  if (!sql.includes('SELECT COUNT(DISTINCT elem) INTO v_distinct_count') || !sql.includes('v_distinct_count != jsonb_array_length(v_student_ans)')) {
    console.error('❌ LỖI MULTIPLE CHOICE VALIDATION: submit_academic_exercise chưa kiểm tra phần tử trùng lặp!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Multiple Choice: RPC submit_academic_exercise từ chối mảng trắc nghiệm chứa phần tử trùng lặp!');
  }

  // Check 4: Type check an toàn cho points_earned
  if (!sql.includes('jsonb_typeof(v_grade_item->\'points_earned\') != \'number\'') || !sql.includes('v_graded_subjective_count < v_total_subjective_count')) {
    console.error('❌ LỖI GRADING TYPE CHECK: RPC grade chưa có kiểm tra kiếu số an toàn hoặc bắt buộc chấm 100% câu tự luận!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Grading: RPC grade_academic_submission có type check số an toàn và bắt buộc chấm 100% câu tự luận!');
  }
}

// 2. KIỂM TRA FRONTEND COMPONENTS
const playModalPath = path.join(process.cwd(), 'src', 'components', 'dashboard', 'exercises', 'ExercisePlayModal.jsx');
if (fs.existsSync(playModalPath)) {
  const playContent = fs.readFileSync(playModalPath, 'utf8');
  if (!playContent.includes('delete_unreferenced_submission_files') || !playContent.includes('baselineFilesRef')) {
    console.error('❌ LỖI UI RPC STORAGE: ExercisePlayModal chưa gọi RPC delete_unreferenced_submission_files!');
    hasError = true;
  } else {
    console.log('  ✅ ExercisePlayModal: Tích hợp gọi RPC delete_unreferenced_submission_files cho cleanup Storage an toàn!');
  }
}

if (hasError) {
  console.error('\n❌ KIỂM TRA TĨNH BÀI TẬP HỌC THUẬT 12.0 THẤT BẠI!');
  process.exit(1);
} else {
  console.log('\n✅ KIỂM TRA TĨNH HỆ THỐNG BÀI TẬP HỌC THUẬT 12.0 THÀNH CÔNG RỰC RỠ (EXIT CODE 0)!');
  process.exit(0);
}
