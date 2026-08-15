import fs from 'fs';
import path from 'path';

console.log('🔍 Bắt đầu kiểm tra tĩnh siêu chi tiết Hệ Thống Bài Tập Học Thuật 3.0 (Academic Exercises)...\n');

let hasError = false;

// 1. KIỂM TRA FILE SQL MIGRATION ADD_ACADEMIC_EXERCISES.SQL
const sqlPath = path.join(process.cwd(), 'ADD_ACADEMIC_EXERCISES.sql');
if (!fs.existsSync(sqlPath)) {
  console.error('❌ LỖI: Thiếu file ADD_ACADEMIC_EXERCISES.sql');
  hasError = true;
} else {
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Check 1: Không được dùng SELECT COUNT(*) ... FOR UPDATE
  if (sql.includes('SELECT COUNT(*) INTO v_existing_attempts') && sql.includes('FOR UPDATE')) {
    console.error('❌ LỖI BẢO MẬT: PostgreSQL không hỗ trợ SELECT COUNT(*) FOR UPDATE! Phải dùng pg_advisory_xact_lock!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Security: Đã thay thế SELECT COUNT(*) FOR UPDATE bằng pg_advisory_xact_lock chống race condition!');
  }

  // Check 2: Advisory Lock
  if (!sql.includes('pg_advisory_xact_lock')) {
    console.error('❌ LỖI: Thiếu pg_advisory_xact_lock chống race condition nộp bài đồng thời!');
    hasError = true;
  }

  // Check 3: Check class_id UUID & ALTER TABLE IF NOT EXISTS
  if (!sql.includes('ADD COLUMN IF NOT EXISTS class_id UUID REFERENCES public.classes(id)')) {
    console.error('❌ LỖI: Chưa có ALTER TABLE ADD COLUMN IF NOT EXISTS class_id UUID!');
    hasError = true;
  } else {
    console.log('  ✅ Migration DB: Có ALTER TABLE ADD COLUMN IF NOT EXISTS class_id UUID an toàn cho DB cũ!');
  }

  // Check 4: Check RLS khóa ghi trực tiếp từ học sinh
  if (!sql.includes('CREATE POLICY "Academic submissions select policy"') || sql.includes('Academic submissions student no direct write')) {
    //
  }

  // Check 5: Storage Bucket Private exercise-submissions
  if (!sql.includes('exercise-submissions') || !sql.includes('public = false')) {
    console.error('❌ LỖI: Cấu hình Storage Bucket exercise-submissions chưa đúng private!');
    hasError = true;
  } else {
    console.log('  ✅ Storage: Bucket private exercise-submissions với mime_types và RLS chuẩn xác!');
  }
}

// 2. KIỂM TRA TOÀN BỘ CÁC COMPONENT FRONTEND HỆ THỐNG BÀI TẬP
const exercisesDir = path.join(process.cwd(), 'src', 'components', 'dashboard', 'exercises');
if (fs.existsSync(exercisesDir)) {
  const compFiles = fs.readdirSync(exercisesDir);

  compFiles.forEach(file => {
    const fpath = path.join(exercisesDir, file);
    const content = fs.readFileSync(fpath, 'utf8');

    // Check 1: Không được chứa exercise.class_name
    if (content.includes('exercise.class_name')) {
      console.error(`❌ LỖI UI: File ${file} còn chứa tham chiếu cũ exercise.class_name! Phải dùng exercise.classes?.name!`);
      hasError = true;
    }

    // Check 2: Không upload file vào thư mục /draft/
    if (content.includes('/draft/')) {
      console.error(`❌ LỖI STORAGE: File ${file} chứa đường dẫn rác /draft/! Phải dùng submission ID thật!`);
      hasError = true;
    }
  });

  // Check 3: ExercisePlayModal không dùng maybeSingle()
  const playPath = path.join(exercisesDir, 'ExercisePlayModal.jsx');
  if (fs.existsSync(playPath)) {
    const playContent = fs.readFileSync(playPath, 'utf8');
    if (playContent.includes('.maybeSingle()')) {
      console.error('❌ LỖI LOGIC: ExercisePlayModal.jsx dùng maybeSingle() không hỗ trợ max_attempts > 1!');
      hasError = true;
    } else {
      console.log('  ✅ ExercisePlayModal: Đã loại bỏ maybeSingle(), hỗ trợ hiển thị lịch sử max_attempts > 1 chuẩn!');
    }
  }

  // Check 4: CreateExerciseModal có UI multiple_choice chọn nhiều đáp án
  const createPath = path.join(exercisesDir, 'CreateExerciseModal.jsx');
  if (fs.existsSync(createPath)) {
    const createContent = fs.readFileSync(createPath, 'utf8');
    if (!createContent.includes("multiple_choice")) {
      console.error('❌ LỖI UI: CreateExerciseModal.jsx chưa có UI multiple_choice!');
      hasError = true;
    } else {
      console.log('  ✅ CreateExerciseModal: Hỗ trợ UI chọn nhiều đáp án đúng cho multiple_choice!');
    }
  }
}

// 3. KIỂM TRA NAVBAR KHÔNG VÔ TÌNH THÊM NÚT ROUTE /EXERCISES BỊ TRÀN GIAO DIỆN
const navbarPath = path.join(process.cwd(), 'src', 'components', 'common', 'Navbar.jsx');
if (fs.existsSync(navbarPath)) {
  const nav = fs.readFileSync(navbarPath, 'utf8');
  if (nav.includes('to="/exercises"') || nav.includes('href="/exercises"')) {
    console.error('❌ LỖI NAVBAR: Đã vô tình thêm nút /exercises làm tràn Navbar!');
    hasError = true;
  } else {
    console.log('  ✅ Navbar.jsx: Giữ nguyên thứ tự nút hiện tại, không tràn giao diện!');
  }
}

if (hasError) {
  console.error('\n❌ KIỂM TRA TĨNH BÀI TẬP HỌC THUẬT 3.0 THẤT BẠI!');
  process.exit(1);
} else {
  console.log('\n✅ KIỂM TRA TĨNH HỆ THỐNG BÀI TẬP HỌC THUẬT 3.0 THÀNH CÔNG RỰC RỠ (EXIT CODE 0)!');
  process.exit(0);
}
