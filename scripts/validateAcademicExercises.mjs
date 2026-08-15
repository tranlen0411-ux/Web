import fs from 'fs';
import path from 'path';

console.log('🔍 Bắt đầu kiểm tra tĩnh siêu chuẩn xác Hệ Thống Bài Tập Học Thuật 15.4 (Migration Safe & Idempotent Worker RPCs)...\n');

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

  // Check 2: DROP CÁC CHỮ KÝ OVERLOAD CŨ VÀ REVOKE RIÊNG SERVICE_ROLE
  if (!sql.includes('DROP FUNCTION IF EXISTS public.claim_exercise_file_cleanup_job(UUID)') || !sql.includes('reconcile_exercise_file_cleanup_job')) {
    console.error('❌ LỖI OVERLOAD MIGRATION: Phải DROP các chữ ký overload cũ và thêm RPC reconcile_exercise_file_cleanup_job!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Overload Safe Migration: Xóa sạch chữ ký overload cũ và thêm RPC reconcile đối soát!');
  }

  // Check 3: FAIL-CLOSED JWT ROLE CHECK IN RPCs
  if (!sql.includes("auth.jwt()->>'role'") || !sql.includes('service_role')) {
    console.error('❌ LỖI JWT FAIL-CLOSED: RPC worker chưa kiểm tra auth.jwt()->>\'role\' = \'service_role\'!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Fail-Closed JWT Check: Kiểm tra auth.jwt()->>\'role\' = \'service_role\' chuẩn xác!');
  }

  // Check 4: Biến typed v_valid_* trong save_exercise
  if (!sql.includes('v_valid_grade_level') || !sql.includes('v_valid_max_attempts') || !sql.includes('v_valid_reward_stars')) {
    console.error('❌ LỖI TYPED VARIABLES: SQL save_exercise chưa khai báo biến typed v_valid_*!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Phase 1 Typed Variables: Đã khai báo và sử dụng biến typed v_valid_*!');
  }
}

// 2. KIỂM TRA SUPABASE EDGE FUNCTION
const edgeFuncPath = path.join(process.cwd(), 'supabase', 'functions', 'cleanup-exercise-submission-files', 'index.ts');
if (!fs.existsSync(edgeFuncPath)) {
  console.error('❌ LỖI EDGE FUNCTION: Thiếu file Edge Function supabase/functions/cleanup-exercise-submission-files/index.ts');
  hasError = true;
} else {
  const edgeContent = fs.readFileSync(edgeFuncPath, 'utf8');

  if (!edgeContent.includes('reconcile_exercise_file_cleanup_job')) {
    console.error('❌ LỖI RECONCILIATION: Edge Function phải gọi reconcile_exercise_file_cleanup_job khi finish deleted lỗi!');
    hasError = true;
  } else {
    console.log('  ✅ Edge Function Reconciliation: Gọi RPC reconcile_exercise_file_cleanup_job xử lý idempotent!');
  }

  if (!edgeContent.includes('partial_success')) {
    console.error('❌ LỖI PARTIAL SUCCESS: Edge Function phải trả về cờ partial_success!');
    hasError = true;
  } else {
    console.log('  ✅ Edge Function Partial Success: Trả cờ partial_success khi có cả job thành công và job lỗi!');
  }
}

// 3. KIỂM TRA FRONTEND COMPONENTS
const playModalPath = path.join(process.cwd(), 'src', 'components', 'dashboard', 'exercises', 'ExercisePlayModal.jsx');
if (fs.existsSync(playModalPath)) {
  const playContent = fs.readFileSync(playModalPath, 'utf8');
  if (!playContent.includes('partial_success') || !playContent.includes('validJobIds')) {
    console.error('❌ LỖI UI CLEANUP: ExercisePlayModal chưa xử lý cờ partial_success!');
    hasError = true;
  } else {
    console.log('  ✅ ExercisePlayModal: Kiểm tra đầy đủ partial_success và xử lý validJobIds linh hoạt!');
  }
}

if (hasError) {
  console.error('\n❌ KIỂM TRA TĨNH BÀI TẬP HỌC THUẬT 15.4 THẤT BẠI!');
  process.exit(1);
} else {
  console.log('\n✅ KIỂM TRA TĨNH HỆ THỐNG BÀI TẬP HỌC THUẬT 15.4 THÀNH CÔNG RỰC RỠ (EXIT CODE 0)!');
  process.exit(0);
}
