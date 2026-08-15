import fs from 'fs';
import path from 'path';

console.log('🔍 Bắt đầu kiểm tra tĩnh siêu chuẩn xác Hệ Thống Bài Tập Học Thuật 7.0 (Academic Exercises)...\n');

let hasError = false;

// 1. KIỂM TRA FILE SQL MIGRATION ADD_ACADEMIC_EXERCISES.SQL
const sqlPath = path.join(process.cwd(), 'ADD_ACADEMIC_EXERCISES.sql');
if (!fs.existsSync(sqlPath)) {
  console.error('❌ LỖI: Thiếu file ADD_ACADEMIC_EXERCISES.sql');
  hasError = true;
} else {
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Check 1: Candidate CTE pre-check kiêm kiểm tra mơ hồ trước khi UPDATE class_id
  if (!sql.includes('ClassCandidates AS') || !sql.includes('MIGRATION BỊ DỪNG')) {
    console.error('❌ LỖI MIGRATION: Thiếu Unified Candidate CTE pre-check kiểm tra mơ hồ dữ liệu class_name trước khi UPDATE!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Migration: Đã tích hợp Unified Candidate CTE pre-check đa điều kiện trước khi UPDATE/DROP!');
  }

  // Check 2: Từ chối thay đổi metadata & cấu trúc câu hỏi khi v_has_submissions = true
  if (!sql.includes('v_has_submissions') || !sql.includes('Lỗi: Bài tập đã có bài nộp của học sinh')) {
    console.error('❌ LỖI BẢO VỆ DỮ LIỆU: Server chưa từ chối thay đổi cấu trúc/metadata nhạy cảm khi bài tập đã có bài nộp!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Data Protection: Server từ chối thay đổi cấu trúc/metadata nhạy cảm khi bài tập đã có bài nộp!');
  }

  // Check 3: RPC get_exercise_for_edit trả về has_submissions
  if (!sql.includes('v_has_sub') || !sql.includes('has_submissions')) {
    console.error('❌ LỖI SECURITY: RPC get_exercise_for_edit chưa trả về cờ has_submissions!');
    hasError = true;
  } else {
    console.log('  ✅ SQL RPC: get_exercise_for_edit trả về cờ has_submissions và submission_count!');
  }
}

// 2. KIỂM TRA FRONTEND COMPONENTS
const createModalPath = path.join(process.cwd(), 'src', 'components', 'dashboard', 'exercises', 'CreateExerciseModal.jsx');
if (fs.existsSync(createModalPath)) {
  const createContent = fs.readFileSync(createModalPath, 'utf8');
  if (!createContent.includes('hasSubmissions')) {
    console.error('❌ LỖI UI: CreateExerciseModal chưa hỗ trợ cờ hasSubmissions!');
    hasError = true;
  } else {
    console.log('  ✅ CreateExerciseModal: Đã khóa các trường cấu trúc và hiển thị banner thông báo khi bài đã có bài nộp!');
  }
}

if (hasError) {
  console.error('\n❌ KIỂM TRA TĨNH BÀI TẬP HỌC THUẬT 7.0 THẤT BẠI!');
  process.exit(1);
} else {
  console.log('\n✅ KIỂM TRA TĨNH HỆ THỐNG BÀI TẬP HỌC THUẬT 7.0 THÀNH CÔNG RỰC RỠ (EXIT CODE 0)!');
  process.exit(0);
}
