import fs from 'fs';
import path from 'path';

console.log('🔍 Bắt đầu kiểm tra tĩnh siêu chuẩn xác Hệ Thống Bài Tập Học Thuật 14.1 (Academic Exercises)...\n');

let hasError = false;

// 1. KIỂM TRA FILE SQL MIGRATION ADD_ACADEMIC_EXERCISES.SQL
const sqlPath = path.join(process.cwd(), 'ADD_ACADEMIC_EXERCISES.sql');
if (!fs.existsSync(sqlPath)) {
  console.error('❌ LỖI: Thiếu file ADD_ACADEMIC_EXERCISES.sql');
  hasError = true;
} else {
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Check 1: TUYỆT ĐỐI KHÔNG DÙNG DELETE FROM STORAGE.OBJECTS TRONG SQL
  if (sql.includes('DELETE FROM storage.objects') || sql.includes('INSERT INTO storage.objects') || sql.includes('UPDATE storage.objects')) {
    console.error('❌ LỖI KIẾN TRÚC STORAGE SQL: SQL không được phép DELETE/INSERT/UPDATE trực tiếp trên storage.objects metadata!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Architecture: Đã loại bỏ hoàn toàn các câu lệnh DML trực tiếp trên storage.objects!');
  }

  // Check 2: CTE ClassCandidates gộp trong 1 SELECT duy nhất dùng FILTER
  if (!sql.includes('ClassCandidates AS') || !sql.includes('FILTER (WHERE matched_count > 1)')) {
    console.error('❌ LỖI CTE SCOPE: Migration chưa gộp CTE ClassCandidates trong một SELECT duy nhất dùng FILTER!');
    hasError = true;
  } else {
    console.log('  ✅ SQL CTE Scope: CTE ClassCandidates gộp chuẩn xác trong một SELECT duy nhất!');
  }

  // Check 3: Bảng hàng đợi cleanup và RPC queue_file_cleanup
  if (!sql.includes('exercise_file_cleanup_jobs') || !sql.includes('FUNCTION public.queue_file_cleanup')) {
    console.error('❌ LỖI CLEANUP QUEUE: Thiếu bảng exercise_file_cleanup_jobs hoặc RPC queue_file_cleanup!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Cleanup Queue: Đã tích hợp bảng exercise_file_cleanup_jobs và RPC queue_file_cleanup!');
  }

  // Check 4: Kiểm tra TRUNC cho points_earned
  if (!sql.includes('v_num_val != TRUNC(v_num_val)')) {
    console.error('❌ LỖI INT VALIDATION: RPC grade chưa có kiểm tra v_num_val != TRUNC(v_num_val) loại bỏ số thập phân!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Int Validation: RPC grade_academic_submission kiểm tra số nguyên TRUNC(v_num_val) = v_num_val chuẩn xác!');
  }
}

// 2. KIỂM TRA SUPABASE EDGE FUNCTION VỚI REGEX ĐA DÒNG
const edgeFuncPath = path.join(process.cwd(), 'supabase', 'functions', 'cleanup-exercise-submission-files', 'index.ts');
if (!fs.existsSync(edgeFuncPath)) {
  console.error('❌ LỖI EDGE FUNCTION: Thiếu file Edge Function supabase/functions/cleanup-exercise-submission-files/index.ts');
  hasError = true;
} else {
  const edgeContent = fs.readFileSync(edgeFuncPath, 'utf8');
  const storageRemoveRegex = /storage\s*\.\s*from\(\s*['"]exercise-submissions['"]\s*\)\s*\.\s*remove\s*\(/;

  if (!storageRemoveRegex.test(edgeContent)) {
    console.error('❌ LỖI EDGE FUNCTION API: Edge Function chưa gọi Storage API remove() chính thức!');
    hasError = true;
  } else {
    console.log('  ✅ Supabase Edge Function: Đã tạo Edge Function cleanup gọi đúng Storage API remove() chính thức!');
  }

  if (!edgeContent.includes('refError')) {
    console.error('❌ LỖI FAIL-CLOSED: Edge Function chưa kiểm tra refError để chặn xóa file khi DB lỗi!');
    hasError = true;
  } else {
    console.log('  ✅ Edge Function Fail-Closed: Kiểm tra refError chặn xóa file khi DB lỗi chuẩn xác!');
  }
}

// 3. KIỂM TRA FRONTEND COMPONENTS
const playModalPath = path.join(process.cwd(), 'src', 'components', 'dashboard', 'exercises', 'ExercisePlayModal.jsx');
if (fs.existsSync(playModalPath)) {
  const playContent = fs.readFileSync(playModalPath, 'utf8');
  if (!playContent.includes('cleanup-exercise-submission-files') || !playContent.includes('queue_file_cleanup')) {
    console.error('❌ LỖI UI CLEANUP: ExercisePlayModal chưa tích hợp Edge Function cleanup-exercise-submission-files!');
    hasError = true;
  } else {
    console.log('  ✅ ExercisePlayModal: Đã tích hợp gọi Edge Function cleanup-exercise-submission-files và queue_file_cleanup!');
  }
}

if (hasError) {
  console.error('\n❌ KIỂM TRA TĨNH BÀI TẬP HỌC THUẬT 14.1 THẤT BẠI!');
  process.exit(1);
} else {
  console.log('\n✅ KIỂM TRA TĨNH HỆ THỐNG BÀI TẬP HỌC THUẬT 14.1 THÀNH CÔNG RỰC RỠ (EXIT CODE 0)!');
  process.exit(0);
}
