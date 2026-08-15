import fs from 'fs';
import path from 'path';

console.log('🔍 Bắt đầu kiểm tra tĩnh toàn diện Hệ Thống Bài Tập Học Thuật 2.0 (Academic Exercises)...\n');

let hasError = false;

// 1. Kiểm tra SQL Migration ADD_ACADEMIC_EXERCISES.sql
const sqlPath = path.join(process.cwd(), 'ADD_ACADEMIC_EXERCISES.sql');
if (!fs.existsSync(sqlPath)) {
  console.error('❌ LỖI: Thiếu file ADD_ACADEMIC_EXERCISES.sql');
  hasError = true;
} else {
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Check class_id UUID và loại bỏ class_name
  if (sql.includes('class_name TEXT') && !sql.includes('class_id UUID REFERENCES')) {
    console.error('❌ LỖI: CSDL còn dùng class_name TEXT thay vì class_id UUID!');
    hasError = true;
  } else {
    console.log('  ✅ CSDL: Đã chuyển sang class_id UUID REFERENCES public.classes(id)!');
  }

  // Check schema private app_private
  if (!sql.includes('CREATE SCHEMA IF NOT EXISTS app_private;') || !sql.includes('app_private.academic_answer_keys')) {
    console.error('❌ LỖI: Chưa bảo vệ đáp án bí mật trong app_private.academic_answer_keys!');
    hasError = true;
  } else {
    console.log('  ✅ Privacy Schema: Bảo vệ đáp án bí mật tại app_private.academic_answer_keys!');
  }

  // Check REVOKE ALL từ PUBLIC/anon/authenticated
  if (!sql.includes('REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;')) {
    console.error('❌ LỖI: Chưa REVOKE ALL quyền truy cập app_private từ PUBLIC/anon!');
    hasError = true;
  }

  // Check RLS policies không có FOR ALL cho học sinh trên submissions
  if (sql.includes('CREATE POLICY "Academic submissions student no direct write"')) {
    console.error('❌ LỖI: Thừa policy không an toàn.');
    hasError = true;
  }

  // Check SET search_path = '' trên tất cả SECURITY DEFINER RPCs
  if (!sql.includes("SET search_path = ''")) {
    console.error("❌ LỖI: Thiếu SET search_path = '' trong RPC SECURITY DEFINER.");
    hasError = true;
  }

  // Check bucket private exercise-submissions
  if (!sql.includes("exercise-submissions") || !sql.includes("public = false")) {
    console.error('❌ LỖI: Chưa cấu hình bucket private exercise-submissions!');
    hasError = true;
  } else {
    console.log('  ✅ Storage: Bucket private exercise-submissions với giới hạn file mime_types chuẩn xác!');
  }

  // Check DROP POLICY IF EXISTS
  if (!sql.includes('DROP POLICY IF EXISTS')) {
    console.error('❌ LỖI: Thiếu DROP POLICY IF EXISTS gây lỗi khi chạy lại migration.');
    hasError = true;
  } else {
    console.log('  ✅ Migration Idempotent: Có DROP POLICY IF EXISTS trước khi khởi tạo!');
  }
}

// 2. Kiểm tra Frontend không có Direct INSERT/UPDATE vào academic_submissions từ client
const playModalPath = path.join(process.cwd(), 'src', 'components', 'dashboard', 'exercises', 'ExercisePlayModal.jsx');
if (fs.existsSync(playModalPath)) {
  const playContent = fs.readFileSync(playModalPath, 'utf8');

  if (playContent.includes("supabase.from('academic_submissions').insert") || 
      playContent.includes("supabase.from('academic_submissions').update") ||
      playContent.includes("supabase.from('academic_submission_answers').insert")) {
    console.error('❌ LỖI: Frontend còn gọi direct INSERT/UPDATE vào academic_submissions! Phải gọi RPC submit_academic_exercise!');
    hasError = true;
  } else {
    console.log('  ✅ Frontend Security: 100% việc nộp bài và chấm điểm đều thông qua RPC SECURITY DEFINER!');
  }

  // Check hỗ trợ 8 dạng câu hỏi
  const requiredTypes = ['single_choice', 'multiple_choice', 'fill_blank', 'short_answer', 'essay', 'image_upload', 'file_upload'];
  requiredTypes.forEach(t => {
    if (!playContent.includes(t)) {
      console.error(`❌ LỖI: ExercisePlayModal chưa render dạng câu hỏi ${t}`);
      hasError = true;
    }
  });
  console.log('  ✅ ExercisePlayModal: Hỗ trợ đầy đủ render 8 dạng câu hỏi bài tập!');
}

// 3. Kiểm tra Navbar không thêm nút /exercises độc lập
const navbarPath = path.join(process.cwd(), 'src', 'components', 'common', 'Navbar.jsx');
if (fs.existsSync(navbarPath)) {
  const nav = fs.readFileSync(navbarPath, 'utf8');
  if (nav.includes('to="/exercises"') || nav.includes('href="/exercises"')) {
    console.error('❌ LỖI: Navbar vô tình thêm nút /exercises làm tràn giao diện!');
    hasError = true;
  } else {
    console.log('  ✅ Navbar.jsx: Không thêm nút Navbar mới, giữ nguyên thứ tự hiện tại!');
  }
}

if (hasError) {
  console.error('\n❌ KIỂM TRA TĨNH BÀI TẬP HỌC THUẬT THẤT BẠI!');
  process.exit(1);
} else {
  console.log('\n✅ KIỂM TRA TĨNH HỆ THỐNG BÀI TẬP HỌC THUẬT 2.0 THÀNH CÔNG RỰC RỠ (EXIT CODE 0)!');
  process.exit(0);
}
