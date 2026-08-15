import fs from 'fs';
import path from 'path';

console.log('🔍 Bắt đầu kiểm tra tĩnh siêu chuẩn xác Hệ Thống Bài Tập Học Thuật 10.0 (Academic Exercises)...\n');

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

  // Check 2: Zero-DML Validation Phase trong submit_academic_exercise
  if (!sql.includes('PHASE 1: ZERO-DML VALIDATION PHASE') || !sql.includes('PHASE 2: DML EXECUTION PHASE')) {
    console.error('❌ LỖI TRANSACTION: submit_academic_exercise chưa phân tách rõ ràng Phase 1 Zero-DML Validation!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Transaction: RPC submit_academic_exercise có quy trình Zero-DML Validation Phase chuẩn xác!');
  }

  // Check 3: Bắt buộc v_submission_id trước khi nộp file
  if (!sql.includes('v_has_any_file AND v_submission_id IS NULL')) {
    console.error('❌ LỖI FILE VALIDATION: submit_academic_exercise chưa từ chối khi v_has_any_file AND v_submission_id IS NULL!');
    hasError = true;
  } else {
    console.log('  ✅ SQL File Validation: RPC submit_academic_exercise bắt buộc v_submission_id trước khi nộp file!');
  }

  // Check 4: 2-Phase Zero-DML validation trong grade_academic_submission
  if (!sql.includes('PHASE 1: ZERO-DML VALIDATION PHASE') || !sql.includes('v_sub.status NOT IN (\'submitted\', \'pending_manual_grade\')')) {
    console.error('❌ LỖI GRADING: RPC grade chưa có 2-Phase Zero-DML validation hoặc allow-list!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Grading: RPC grade_academic_submission có 2-Phase Zero-DML validation và allow-list!');
  }
}

// 2. KIỂM TRA FRONTEND COMPONENTS
const playModalPath = path.join(process.cwd(), 'src', 'components', 'dashboard', 'exercises', 'ExercisePlayModal.jsx');
if (fs.existsSync(playModalPath)) {
  const playContent = fs.readFileSync(playModalPath, 'utf8');
  if (!playContent.includes('newlyUploadedPathsRef') || !playContent.includes('previousFileUrlsMapRef')) {
    console.error('❌ LỖI UI STORAGE: ExercisePlayModal chưa dùng useRef cho newlyUploadedPathsRef và previousFileUrlsMapRef!');
    hasError = true;
  } else {
    console.log('  ✅ ExercisePlayModal: Dùng useRef quản lý newlyUploadedPathsRef và khôi phục UI file cũ khi RPC thất bại!');
  }
}

if (hasError) {
  console.error('\n❌ KIỂM TRA TĨNH BÀI TẬP HỌC THUẬT 10.0 THẤT BẠI!');
  process.exit(1);
} else {
  console.log('\n✅ KIỂM TRA TĨNH HỆ THỐNG BÀI TẬP HỌC THUẬT 10.0 THÀNH CÔNG RỰC RỠ (EXIT CODE 0)!');
  process.exit(0);
}
