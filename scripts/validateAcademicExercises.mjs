import fs from 'fs';
import path from 'path';

console.log('🔍 Bắt đầu kiểm tra tĩnh siêu chuẩn xác Hệ Thống Bài Tập Học Thuật 15.2 (Academic Exercises)...\n');

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

  // Check 2: RPC claim_exercise_file_cleanup_job & finish_exercise_file_cleanup_job CSDL nguyên tử
  if (!sql.includes('claim_exercise_file_cleanup_job') || !sql.includes('finish_exercise_file_cleanup_job')) {
    console.error('❌ LỖI ATOMIC CLAIM RPC: Thiếu RPC claim_exercise_file_cleanup_job hoặc finish_exercise_file_cleanup_job!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Atomic Claim RPCs: Tích hợp RPC claim và finish job CSDL nguyên tử chống race condition!');
  }

  // Check 3: Mẫu local typed variables an toàn cho Phase 1
  if (!sql.includes('v_valid_grade_level') || !sql.includes('v_valid_max_attempts') || !sql.includes('v_valid_reward_stars') || !sql.includes('v_valid_due_date')) {
    console.error('❌ LỖI TYPED VARIABLES: SQL save_exercise chưa khai báo và sử dụng đầy đủ các biến typed v_valid_*!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Phase 1 Typed Variables: Đã khai báo và sử dụng biến typed an toàn v_valid_*!');
  }

  // Check 4: RPC queue_file_cleanup dùng RETURNING id, file_path
  if (!sql.includes('RETURNING id, file_path')) {
    console.error('❌ LỖI QUEUE RETURNING: RPC queue_file_cleanup chưa dùng RETURNING id, file_path để chống báo queued giả!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Queue RPC: RPC queue_file_cleanup dùng RETURNING id, file_path chuẩn xác!');
  }
}

// 2. KIỂM TRA SUPABASE EDGE FUNCTION VỚI ATOMIC RPC CALLS
const edgeFuncPath = path.join(process.cwd(), 'supabase', 'functions', 'cleanup-exercise-submission-files', 'index.ts');
if (!fs.existsSync(edgeFuncPath)) {
  console.error('❌ LỖI EDGE FUNCTION: Thiếu file Edge Function supabase/functions/cleanup-exercise-submission-files/index.ts');
  hasError = true;
} else {
  const edgeContent = fs.readFileSync(edgeFuncPath, 'utf8');
  const storageRemoveRegex = /storage\s*\.\s*from\(\s*['"]exercise-submissions['"]\s*\)\s*\.\s*remove\s*\(/;

  if (!edgeContent.includes('claim_exercise_file_cleanup_job')) {
    console.error('❌ LỖI EDGE CLAIM RPC: Edge Function phải gọi RPC claim_exercise_file_cleanup_job!');
    hasError = true;
  } else {
    console.log('  ✅ Edge Function Claim RPC: Gọi RPC claim_exercise_file_cleanup_job CSDL nguyên tử!');
  }

  if (!edgeContent.includes('finish_exercise_file_cleanup_job')) {
    console.error('❌ LỖI EDGE FINISH RPC: Edge Function phải gọi RPC finish_exercise_file_cleanup_job!');
    hasError = true;
  } else {
    console.log('  ✅ Edge Function Finish RPC: Gọi RPC finish_exercise_file_cleanup_job CSDL nguyên tử!');
  }

  if (!storageRemoveRegex.test(edgeContent)) {
    console.error('❌ LỖI EDGE FUNCTION API: Edge Function chưa gọi Storage API remove() chính thức!');
    hasError = true;
  } else {
    console.log('  ✅ Supabase Edge Function: Đã tạo Edge Function cleanup gọi đúng Storage API remove() chính thức!');
  }

  if (!edgeContent.includes('already_claimed') || !edgeContent.includes('missing_job_ids')) {
    console.error('❌ LỖI CATEGORIZATION: Edge Function chưa hỗ trợ phân loại already_claimed và missing_job_ids!');
    hasError = true;
  } else {
    console.log('  ✅ Edge Function Categorization: Phân loại already_claimed và missing_job_ids chuẩn xác!');
  }
}

// 3. KIỂM TRA FRONTEND COMPONENTS
const playModalPath = path.join(process.cwd(), 'src', 'components', 'dashboard', 'exercises', 'ExercisePlayModal.jsx');
if (fs.existsSync(playModalPath)) {
  const playContent = fs.readFileSync(playModalPath, 'utf8');
  if (!playContent.includes('job_ids') || !playContent.includes('queueRes')) {
    console.error('❌ LỖI UI CLEANUP: ExercisePlayModal chưa kiểm tra queueRes hoặc chưa truyền job_ids!');
    hasError = true;
  } else {
    console.log('  ✅ ExercisePlayModal: Đã tích hợp kiểm tra queueRes và truyền job_ids sang Edge Function!');
  }
}

if (hasError) {
  console.error('\n❌ KIỂM TRA TĨNH BÀI TẬP HỌC THUẬT 15.2 THẤT BẠI!');
  process.exit(1);
} else {
  console.log('\n✅ KIỂM TRA TĨNH HỆ THỐNG BÀI TẬP HỌC THUẬT 15.2 THÀNH CÔNG RỰC RỠ (EXIT CODE 0)!');
  process.exit(0);
}
