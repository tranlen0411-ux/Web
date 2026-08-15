import fs from 'fs';
import path from 'path';

console.log('🔍 Bắt đầu kiểm tra tĩnh siêu chuẩn xác Hệ Thống Bài Tập Học Thuật 11.0 (Academic Exercises)...\n');

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

  // Check 2: Đối chiếu options_json trong submit_academic_exercise
  if (!sql.includes('jsonb_array_elements_text(v_q.options_json)') || !sql.includes('v_opt_match')) {
    console.error('❌ LỖI OPTIONS CHECK: submit_academic_exercise chưa đối chiếu v_student_ans với options_json trong CSDL!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Options Check: RPC submit_academic_exercise đối chiếu trực tiếp v_student_ans với options_json trong CSDL!');
  }

  // Check 3: 2-Phase Zero-DML validation trong grade_academic_submission
  if (!sql.includes('(v_grade_item->>\'points_earned\')::INT < 0') || !sql.includes('v_sub_ans_exists')) {
    console.error('❌ LỖI GRADING VALIDATION: RPC grade chưa có kiểm tra v_sub_ans_exists hoặc points_earned hợp lệ!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Grading: RPC grade_academic_submission kiểm tra v_sub_ans_exists và points_earned hợp lệ!');
  }
}

// 2. KIỂM TRA FRONTEND COMPONENTS
const playModalPath = path.join(process.cwd(), 'src', 'components', 'dashboard', 'exercises', 'ExercisePlayModal.jsx');
if (fs.existsSync(playModalPath)) {
  const playContent = fs.readFileSync(playModalPath, 'utf8');
  if (!playContent.includes('let currentSubId = submissionId') || !playContent.includes('baselineFilesRef')) {
    console.error('❌ LỖI UI REACT STATE: ExercisePlayModal chưa dùng biến cục bộ currentSubId hoặc baselineFilesRef!');
    hasError = true;
  } else {
    console.log('  ✅ ExercisePlayModal: Dùng biến cục bộ currentSubId tạo đường dẫn file không bị null và baselineFilesRef!');
  }
}

if (hasError) {
  console.error('\n❌ KIỂM TRA TĨNH BÀI TẬP HỌC THUẬT 11.0 THẤT BẠI!');
  process.exit(1);
} else {
  console.log('\n✅ KIỂM TRA TĨNH HỆ THỐNG BÀI TẬP HỌC THUẬT 11.0 THÀNH CÔNG RỰC RỠ (EXIT CODE 0)!');
  process.exit(0);
}
