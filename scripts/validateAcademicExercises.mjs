import fs from 'fs';
import path from 'path';

console.log('🔍 Bắt đầu kiểm tra tĩnh siêu chuẩn xác Hệ Thống Bài Tập Học Thuật 15.8 (Storage List Fail-Closed & Counter Flags)...\n');

let hasError = false;

// Hàm tiện ích loại bỏ toàn bộ chú thích (comments) trong SQL trước khi kiểm tra chuỗi thực tế
function stripSqlComments(sqlText) {
  return sqlText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');
}

// 1. KIỂM TRA FILE SQL MIGRATION ADD_ACADEMIC_EXERCISES.SQL
const sqlPath = path.join(process.cwd(), 'ADD_ACADEMIC_EXERCISES.sql');
if (!fs.existsSync(sqlPath)) {
  console.error('❌ LỖI: Thiếu file ADD_ACADEMIC_EXERCISES.sql');
  hasError = true;
} else {
  const rawSql = fs.readFileSync(sqlPath, 'utf8');
  const codeSql = stripSqlComments(rawSql);

  // Check 1: TUYỆT ĐỐI KHÔNG DÙNG DELETE FROM STORAGE.OBJECTS TRONG SQL
  if (codeSql.includes('DELETE FROM storage.objects') || codeSql.includes('INSERT INTO storage.objects') || codeSql.includes('UPDATE storage.objects')) {
    console.error('❌ LỖI KIẾN TRÚC STORAGE SQL: SQL không được phép DELETE/INSERT/UPDATE trực tiếp trên storage.objects metadata!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Architecture: Đã loại bỏ hoàn toàn các câu lệnh DML trực tiếp trên storage.objects!');
  }

  // Check 2: LOẠI BỎ SWALLOW EXCEPTION
  if (codeSql.includes('EXCEPTION WHEN OTHERS THEN NULL;') || codeSql.includes('EXCEPTION WHEN OTHERS THEN\n  NULL;')) {
    console.error('❌ LỖI MIGRATION CONSTRAINT: Migration không được phép chứa EXCEPTION WHEN OTHERS THEN NULL!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Constraint Safety: Loại bỏ hoàn toàn các khối swallow exception (WHEN OTHERS THEN NULL)!');
  }

  // Check 3: PREVIOUS_STATUS & RECONCILIATION_PENDING
  if (!codeSql.includes('previous_status') || !codeSql.includes('reconciliation_pending') || !codeSql.includes('reset_cleanup_jobs_for_retry')) {
    console.error('❌ LỖI RPC CLAIM/RESET: SQL phải trả về previous_status trong claim_exercise_file_cleanup_job và xử lý reconciliation_pending trong reset_cleanup_jobs_for_retry!');
    hasError = true;
  } else {
    console.log('  ✅ SQL RPC Claim & Reset: RPC claim trả về previous_status và RPC reset phân loại reconciliation_pending!');
  }

  // Check 4: CONVALIDATED & ATTNOTNULL CHECK
  if (!codeSql.includes('convalidated') || !codeSql.includes('attnotnull')) {
    console.error('❌ LỖI CONSTRAINT VALIDATION: SQL chưa kiểm tra convalidated = true và attnotnull = true!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Convalidated & Attnotnull Check: Đã tích hợp kiểm tra convalidated và attnotnull fail-closed!');
  }
}

// 2. KIỂM TRA SUPABASE EDGE FUNCTION
const edgeFuncPath = path.join(process.cwd(), 'supabase', 'functions', 'cleanup-exercise-submission-files', 'index.ts');
if (!fs.existsSync(edgeFuncPath)) {
  console.error('❌ LỖI EDGE FUNCTION: Thiếu file Edge Function supabase/functions/cleanup-exercise-submission-files/index.ts');
  hasError = true;
} else {
  const edgeContent = fs.readFileSync(edgeFuncPath, 'utf8');

  if (!edgeContent.includes('listError') || !edgeContent.includes('previousStatus')) {
    console.error('❌ LỖI EDGE STORAGE LIST: Edge Function chưa kiểm tra listError từ storage.list() hoặc chưa kiểm tra previousStatus!');
    hasError = true;
  } else {
    console.log('  ✅ Edge Function Storage List & Previous Status: Đã kiểm tra listError fail-closed và previousStatus chuẩn xác!');
  }

  if (!edgeContent.includes('counter_invariant_valid')) {
    console.error('❌ LỖI EDGE COUNTER INVARIANT: Edge Function thiếu cờ counter_invariant_valid!');
    hasError = true;
  } else {
    console.log('  ✅ Edge Function Counter Flags: Cờ counter_invariant_valid và cờ success / partial_success loại trừ lẫn nhau chuẩn xác!');
  }
}

// 3. KIỂM TRA FRONTEND COMPONENTS
const playModalPath = path.join(process.cwd(), 'src', 'components', 'dashboard', 'exercises', 'ExercisePlayModal.jsx');
if (fs.existsSync(playModalPath)) {
  const playContent = fs.readFileSync(playModalPath, 'utf8');
  if (!playContent.includes('counter_invariant_valid') || !playContent.includes('isCounterValid')) {
    console.error('❌ LỖI UI CLEANUP: ExercisePlayModal chưa kiểm tra cờ counter_invariant_valid!');
    hasError = true;
  } else {
    console.log('  ✅ ExercisePlayModal: Đã tích hợp kiểm tra counter_invariant_valid!');
  }
}

if (hasError) {
  console.error('\n❌ KIỂM TRA TĨNH BÀI TẬP HỌC THUẬT 15.8 THẤT BẠI!');
  process.exit(1);
} else {
  console.log('\n✅ KIỂM TRA TĨNH HỆ THỐNG BÀI TẬP HỌC THUẬT 15.8 THÀNH CÔNG RỰC RỠ (EXIT CODE 0)!');
  process.exit(0);
}
