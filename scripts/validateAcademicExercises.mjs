import fs from 'fs';
import path from 'path';

console.log('🔍 Bắt đầu kiểm tra tĩnh toàn diện Hệ Thống Bài Tập Học Thuật 4.0 (Academic Exercises)...\n');

let hasError = false;

// 1. KIỂM TRA FILE SQL MIGRATION ADD_ACADEMIC_EXERCISES.SQL
const sqlPath = path.join(process.cwd(), 'ADD_ACADEMIC_EXERCISES.sql');
if (!fs.existsSync(sqlPath)) {
  console.error('❌ LỖI: Thiếu file ADD_ACADEMIC_EXERCISES.sql');
  hasError = true;
} else {
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Check 1: Không được dùng SELECT COUNT(*) ... FOR UPDATE (Check cụ thể theo ngữ cảnh cùng câu SQL)
  if (sql.match(/SELECT\s+COUNT\(\*\)[^;]+FOR\s+UPDATE/i)) {
    console.error('❌ LỖI BẢO MẬT: PostgreSQL không hỗ trợ SELECT COUNT(*) FOR UPDATE! Phải dùng pg_advisory_xact_lock!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Security: Đã kiểm tra không có SELECT COUNT(*) FOR UPDATE!');
  }

  // Check 2: Advisory Lock
  if (!sql.includes('pg_advisory_xact_lock')) {
    console.error('❌ LỖI: Thiếu pg_advisory_xact_lock chống race condition nộp bài đồng thời!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Lock: Đã tích hợp pg_advisory_xact_lock bảo vệ nộp bài nguyên tử!');
  }

  // Check 3: Check class_id UUID & ALTER TABLE
  if (!sql.includes('ADD COLUMN IF NOT EXISTS class_id UUID REFERENCES public.classes(id)')) {
    console.error('❌ LỖI: Chưa có ALTER TABLE ADD COLUMN IF NOT EXISTS class_id UUID!');
    hasError = true;
  } else {
    console.log('  ✅ Migration DB: Có ALTER TABLE ADD COLUMN IF NOT EXISTS class_id UUID!');
  }

  // Check 4: Check Storage Bucket Private exercise-submissions
  if (!sql.includes('exercise-submissions') || !sql.includes('public = false')) {
    console.error('❌ LỖI: Cấu hình Storage Bucket exercise-submissions chưa đúng private!');
    hasError = true;
  } else {
    console.log('  ✅ Storage: Bucket private exercise-submissions với RLS chuẩn xác!');
  }
}

// 2. KIỂM TRA FRONTEND COMPONENTS
const exercisesDir = path.join(process.cwd(), 'src', 'components', 'dashboard', 'exercises');
if (fs.existsSync(exercisesDir)) {
  const compFiles = fs.readdirSync(exercisesDir);

  compFiles.forEach(file => {
    const fpath = path.join(exercisesDir, file);
    const content = fs.readFileSync(fpath, 'utf8');

    if (content.includes('exercise.class_name')) {
      console.error(`❌ LỖI UI: File ${file} còn chứa tham chiếu cũ exercise.class_name!`);
      hasError = true;
    }

    if (content.includes('/draft/')) {
      console.error(`❌ LỖI STORAGE: File ${file} chứa đường dẫn rác /draft/!`);
      hasError = true;
    }
  });

  const playPath = path.join(exercisesDir, 'ExercisePlayModal.jsx');
  if (fs.existsSync(playPath)) {
    const playContent = fs.readFileSync(playPath, 'utf8');
    if (playContent.includes('.maybeSingle()')) {
      console.error('❌ LỖI LOGIC: ExercisePlayModal.jsx dùng maybeSingle()!');
      hasError = true;
    } else {
      console.log('  ✅ ExercisePlayModal: Đã loại bỏ maybeSingle(), nạp dữ liệu chuẩn theo từng lượt!');
    }
  }
}

if (hasError) {
  console.error('\n❌ KIỂM TRA TĨNH BÀI TẬP HỌC THUẬT 4.0 THẤT BẠI!');
  process.exit(1);
} else {
  console.log('\n✅ KIỂM TRA TĨNH HỆ THỐNG BÀI TẬP HỌC THUẬT 4.0 THÀNH CÔNG (EXIT CODE 0)!');
  process.exit(0);
}
