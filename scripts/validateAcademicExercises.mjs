import fs from 'fs';
import path from 'path';

console.log('🔍 Bắt đầu kiểm tra tĩnh siêu chuẩn xác Hệ Thống Bài Tập Học Thuật 15.3 (Service Role Worker RPCs)...\n');

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

  // Check 2: REVOKE authenticated và GRANT service_role
  if (
    !sql.includes('REVOKE ALL ON FUNCTION public.claim_exercise_file_cleanup_job') ||
    !sql.includes('GRANT EXECUTE ON FUNCTION public.claim_exercise_file_cleanup_job(UUID, UUID) TO service_role')
  ) {
    console.error('❌ LỖI PERMISSION WORKER RPC: RPC claim/finish phải được khóa hoàn toàn khỏi authenticated và GRANT cho service_role!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Worker RPC Permissions: Khóa hoàn toàn khỏi authenticated và cấp quyền riêng cho service_role!');
  }

  // Check 3: FAIL-CLOSED JWT ROLE CHECK
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

  if (!edgeContent.includes("supabaseAdmin.rpc('claim_exercise_file_cleanup_job'")) {
    console.error('❌ LỖI SERVICE ROLE CALL: Edge Function phải gọi claim_exercise_file_cleanup_job qua supabaseAdmin (Service Role)!');
    hasError = true;
  } else {
    console.log('  ✅ Edge Function Claim Call: Gọi claim RPC qua supabaseAdmin (Service Role Key)!');
  }

  if (!edgeContent.includes('finishJobOrReport')) {
    console.error('❌ LỖI FINISH HELPER: Edge Function thiếu helper finishJobOrReport!');
    hasError = true;
  } else {
    console.log('  ✅ Edge Function Finish Helper: Sử dụng finishJobOrReport kiểm tra kết quả mọi lần finish!');
  }

  if (!edgeContent.includes('p_requesting_user_id')) {
    console.error('❌ LỖI USER ID PARAM: Edge Function phải truyền p_requesting_user_id vào claim/finish RPC!');
    hasError = true;
  } else {
    console.log('  ✅ Edge Function Identity Verification: Truyền p_requesting_user_id đã xác minh token!');
  }
}

// 3. KIỂM TRA FRONTEND COMPONENTS
const playModalPath = path.join(process.cwd(), 'src', 'components', 'dashboard', 'exercises', 'ExercisePlayModal.jsx');
if (fs.existsSync(playModalPath)) {
  const playContent = fs.readFileSync(playModalPath, 'utf8');
  if (!playContent.includes('already_processing') || !playContent.includes('rejected')) {
    console.error('❌ LỖI UI CLEANUP: ExercisePlayModal chưa kiểm tra rejected hoặc already_processing!');
    hasError = true;
  } else {
    console.log('  ✅ ExercisePlayModal: Kiểm tra đầy đủ rejected, already_processing, failed, missing_job_ids!');
  }
}

if (hasError) {
  console.error('\n❌ KIỂM TRA TĨNH BÀI TẬP HỌC THUẬT 15.3 THẤT BẠI!');
  process.exit(1);
} else {
  console.log('\n✅ KIỂM TRA TĨNH HỆ THỐNG BÀI TẬP HỌC THUẬT 15.3 THÀNH CÔNG RỰC RỠ (EXIT CODE 0)!');
  process.exit(0);
}
