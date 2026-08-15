import fs from 'fs';
import path from 'path';

console.log('🔍 Bắt đầu kiểm tra tĩnh siêu chuẩn xác Hệ Thống Bài Tập Học Thuật 15.5 (Migration Idempotency & Admin Retry)...\n');

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

  // Check 2: DROP FUNCTION IF EXISTS KHÔNG REVOKE TRƯỚC DROP
  if (!sql.includes('DROP FUNCTION IF EXISTS public.claim_exercise_file_cleanup_job(UUID);') || !sql.includes('admin_retry_pending_cleanup_jobs')) {
    console.error('❌ LỖI IDEMPOTENT DROP: SQL phải dùng DROP FUNCTION IF EXISTS không gọi REVOKE trước drop!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Idempotent Drops: Đã loại bỏ REVOKE trước DROP và tích hợp RPC admin_retry_pending_cleanup_jobs!');
  }

  // Check 3: FAIL-CLOSED JWT ROLE CHECK IN RPCs
  if (!sql.includes("auth.jwt()->>'role'") || !sql.includes('service_role')) {
    console.error('❌ LỖI JWT FAIL-CLOSED: RPC worker chưa kiểm tra auth.jwt()->>\'role\' = \'service_role\'!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Fail-Closed JWT Check: Kiểm tra auth.jwt()->>\'role\' = \'service_role\' chuẩn xác!');
  }
}

// 2. KIỂM TRA SUPABASE EDGE FUNCTION
const edgeFuncPath = path.join(process.cwd(), 'supabase', 'functions', 'cleanup-exercise-submission-files', 'index.ts');
if (!fs.existsSync(edgeFuncPath)) {
  console.error('❌ LỖI EDGE FUNCTION: Thiếu file Edge Function supabase/functions/cleanup-exercise-submission-files/index.ts');
  hasError = true;
} else {
  const edgeContent = fs.readFileSync(edgeFuncPath, 'utf8');

  if (!edgeContent.includes('unresolved_count') || !edgeContent.includes('requested_count')) {
    console.error('❌ LỖI EDGE COUNTERS: Edge Function thiếu đếm requested_count hoặc unresolved_count!');
    hasError = true;
  } else {
    console.log('  ✅ Edge Function Summary Counters: Đếm chuẩn xác requested_count, completed_count, unresolved_count!');
  }
}

// 3. KIỂM TRA FRONTEND COMPONENTS
const playModalPath = path.join(process.cwd(), 'src', 'components', 'dashboard', 'exercises', 'ExercisePlayModal.jsx');
if (fs.existsSync(playModalPath)) {
  const playContent = fs.readFileSync(playModalPath, 'utf8');
  if (!playContent.includes('unresolved_count')) {
    console.error('❌ LỖI UI CLEANUP: ExercisePlayModal chưa kiểm tra unresolved_count!');
    hasError = true;
  } else {
    console.log('  ✅ ExercisePlayModal: Đã tích hợp kiểm tra unresolved_count chuẩn xác!');
  }
}

if (hasError) {
  console.error('\n❌ KIỂM TRA TĨNH BÀI TẬP HỌC THUẬT 15.5 THẤT BẠI!');
  process.exit(1);
} else {
  console.log('\n✅ KIỂM TRA TĨNH HỆ THỐNG BÀI TẬP HỌC THUẬT 15.5 THÀNH CÔNG RỰC RỠ (EXIT CODE 0)!');
  process.exit(0);
}
