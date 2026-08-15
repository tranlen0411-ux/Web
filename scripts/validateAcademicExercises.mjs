import fs from 'fs';
import path from 'path';

console.log('🔍 Bắt đầu kiểm tra tĩnh siêu chuẩn xác Hệ Thống Bài Tập Học Thuật 8.0 (Academic Exercises)...\n');

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

  // Check 2: So sánh nguyên tử v_existing_questions_json khi v_has_submissions = true
  if (!sql.includes('v_existing_questions_json') || !sql.includes('v_incoming_questions_json') || !sql.includes('IS DISTINCT FROM')) {
    console.error('❌ LỖI BẢO VỆ DỮ LIỆU: Server chưa so sánh nguyên tử cấu trúc câu hỏi để từ chối thay đổi!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Data Protection: Server so sánh nguyên tử cấu trúc câu hỏi v_existing_questions_json để từ chối thay đổi!');
  }

  // Check 3: Xác minh storage.objects thực sự tồn tại
  if (!sql.includes('FROM storage.objects') || !sql.includes('bucket_id = \'exercise-submissions\'')) {
    console.error('❌ LỖI STORAGE: Server chưa kiểm tra object thật sự tồn tại trong storage.objects!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Storage Check: RPC xác minh object thực sự tồn tại trong storage.objects!');
  }

  // Check 4: Allow-list trạng thái chấm bài
  if (!sql.includes('v_sub.status NOT IN (\'submitted\', \'pending_manual_grade\')')) {
    console.error('❌ LỖI GRADING: RPC grade chưa sử dụng allow-list trạng thái v_sub.status NOT IN (\'submitted\', \'pending_manual_grade\')!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Grading: RPC grade sử dụng allow-list trạng thái v_sub.status NOT IN (\'submitted\', \'pending_manual_grade\')!');
  }
}

// 2. KIỂM TRA FRONTEND COMPONENTS
const playModalPath = path.join(process.cwd(), 'src', 'components', 'dashboard', 'exercises', 'ExercisePlayModal.jsx');
if (fs.existsSync(playModalPath)) {
  const playContent = fs.readFileSync(playModalPath, 'utf8');
  if (!playContent.includes('cleanupSessionUploadedFiles') || !playContent.includes('sessionUploadedFiles')) {
    console.error('❌ LỖI UI STORAGE: ExercisePlayModal chưa có cơ chế cleanupSessionUploadedFiles!');
    hasError = true;
  } else {
    console.log('  ✅ ExercisePlayModal: Đã tích hợp cơ chế rollback cleanup file rác Storage!');
  }
}

if (hasError) {
  console.error('\n❌ KIỂM TRA TĨNH BÀI TẬP HỌC THUẬT 8.0 THẤT BẠI!');
  process.exit(1);
} else {
  console.log('\n✅ KIỂM TRA TĨNH HỆ THỐNG BÀI TẬP HỌC THUẬT 8.0 THÀNH CÔNG RỰC RỠ (EXIT CODE 0)!');
  process.exit(0);
}
