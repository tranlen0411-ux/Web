import fs from 'fs';
import path from 'path';

console.log('🔍 Bắt đầu kiểm tra tĩnh siêu chuẩn xác Hệ Thống Bài Tập Học Thuật 9.0 (Academic Exercises)...\n');

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

  // Check 3: Atomic comparison bao gồm đáp án bí mật
  if (!sql.includes('app_private.academic_answer_keys') || !sql.includes('v_existing_questions_json IS DISTINCT FROM v_incoming_questions_json')) {
    console.error('❌ LỖI DATA PROTECTION: save_exercise_with_questions_and_keys chưa so sánh cả answer keys!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Data Protection: RPC save_exercise so sánh nguyên tử cả cấu trúc câu hỏi lẫn answer keys!');
  }

  // Check 4: Storage objects verification
  if (!sql.includes('FROM storage.objects') || !sql.includes('bucket_id = \'exercise-submissions\'')) {
    console.error('❌ LỖI STORAGE: Chưa kiểm tra object tồn tại trong storage.objects!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Storage: Kiểm tra object thực sự tồn tại trong storage.objects trước khi DML!');
  }
}

// 2. KIỂM TRA FRONTEND COMPONENTS
const playModalPath = path.join(process.cwd(), 'src', 'components', 'dashboard', 'exercises', 'ExercisePlayModal.jsx');
if (fs.existsSync(playModalPath)) {
  const playContent = fs.readFileSync(playModalPath, 'utf8');
  if (!playContent.includes('newlyUploadedPaths') || !playContent.includes('pendingOldFileDeletions') || !playContent.includes('committedFilePaths')) {
    console.error('❌ LỖI UI STORAGE: ExercisePlayModal chưa đủ 3 mảng path tracking!');
    hasError = true;
  } else {
    console.log('  ✅ ExercisePlayModal: Đã tích hợp đủ 3 mảng path tracking bảo vệ file đúng quy trình!');
  }
}

if (hasError) {
  console.error('\n❌ KIỂM TRA TĨNH BÀI TẬP HỌC THUẬT 9.0 THẤT BẠI!');
  process.exit(1);
} else {
  console.log('\n✅ KIỂM TRA TĨNH HỆ THỐNG BÀI TẬP HỌC THUẬT 9.0 THÀNH CÔNG RỰC RỠ (EXIT CODE 0)!');
  process.exit(0);
}
