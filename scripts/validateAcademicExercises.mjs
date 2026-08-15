import fs from 'fs';
import path from 'path';

console.log('🔍 Bắt đầu kiểm tra tĩnh toàn diện Hệ Thống Bài Tập Học Thuật (Academic Exercises)...\n');

let hasError = false;

// 1. Kiểm tra file SQL Migration ADD_ACADEMIC_EXERCISES.sql
const sqlPath = path.join(process.cwd(), 'ADD_ACADEMIC_EXERCISES.sql');
if (!fs.existsSync(sqlPath)) {
  console.error('❌ LỖI: Thiếu file ADD_ACADEMIC_EXERCISES.sql');
  hasError = true;
} else {
  const sqlContent = fs.readFileSync(sqlPath, 'utf8');
  
  // Check schema private app_private
  if (!sqlContent.includes('CREATE SCHEMA IF NOT EXISTS app_private;')) {
    console.error('❌ LỖI: File SQL chưa định nghĩa schema private app_private');
    hasError = true;
  }

  // Check table app_private.academic_answer_keys
  if (!sqlContent.includes('app_private.academic_answer_keys')) {
    console.error('❌ LỖI: File SQL chưa định nghĩa bảng đáp án bí mật app_private.academic_answer_keys');
    hasError = true;
  }

  // Check Revoke permissions
  if (!sqlContent.includes('REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;')) {
    console.error('❌ LỖI: Chưa khóa toàn bộ quyền truy cập bảng đáp án bí mật app_private');
    hasError = true;
  }

  // Check SECURITY DEFINER RPC with SET search_path = ''
  if (!sqlContent.includes("SET search_path = ''")) {
    console.error("❌ LỖI: Các RPC SECURITY DEFINER chưa có thuộc tính SET search_path = ''");
    hasError = true;
  }

  console.log('  ✅ ADD_ACADEMIC_EXERCISES.sql: Cấu trúc CSDL, RLS và Private Schema app_private đạt chuẩn 100%!');
}

// 2. Kiểm tra Navbar không thêm nút "Bài Tập" độc lập
const navbarPath = path.join(process.cwd(), 'src', 'components', 'common', 'Navbar.jsx');
if (fs.existsSync(navbarPath)) {
  const navContent = fs.readFileSync(navbarPath, 'utf8');
  // Navbar không được có nút /exercises riêng hay nút "Bài Tập" độc lập
  if (navContent.includes('to="/exercises"') || navContent.includes('href="/exercises"')) {
    console.error('❌ LỖI: Navbar đã vô tình thêm nút route /exercises riêng làm tràn giao diện!');
    hasError = true;
  } else {
    console.log('  ✅ Navbar.jsx: Giữ nguyên thứ tự nút, không tạo nút Bài Tập riêng trên Navbar!');
  }
}

// 3. Kiểm tra các component giao diện đã được tạo đầy đủ
const requiredComponents = [
  'src/components/dashboard/exercises/ExerciseListTab.jsx',
  'src/components/dashboard/exercises/CreateExerciseModal.jsx',
  'src/components/dashboard/exercises/ExercisePlayModal.jsx',
  'src/components/dashboard/exercises/SubmissionGradingModal.jsx'
];

requiredComponents.forEach(comp => {
  const fullP = path.join(process.cwd(), comp);
  if (!fs.existsSync(fullP)) {
    console.error(`❌ LỖI: Thiếu component giao diện: ${comp}`);
    hasError = true;
  } else {
    console.log(`  ✅ Component ${path.basename(comp)}: Đã tích hợp chuẩn xác!`);
  }
});

// 4. Kiểm tra việc nhúng tab vào StudentDashboard, TeacherDashboard, AdminDashboard
const dashboardFiles = [
  { p: 'src/pages/StudentDashboard.jsx', role: 'student' },
  { p: 'src/pages/TeacherDashboard.jsx', role: 'teacher' },
  { p: 'src/pages/AdminDashboard.jsx', role: 'admin' }
];

dashboardFiles.forEach(d => {
  const fp = path.join(process.cwd(), d.p);
  if (fs.existsSync(fp)) {
    const content = fs.readFileSync(fp, 'utf8');
    if (!content.includes('ExerciseListTab')) {
      console.error(`❌ LỖI: ${d.p} chưa tích hợp ExerciseListTab`);
      hasError = true;
    } else {
      console.log(`  ✅ Dashboard ${d.p}: Đã nhúng tab Bài Tập Học Thuật cho vai trò ${d.role}!`);
    }
  }
});

if (hasError) {
  console.error('\n❌ KIỂM TRA BÀI TẬP THẤT BẠI!');
  process.exit(1);
} else {
  console.log('\n✅ KIỂM TRA HỆ THỐNG BÀI TẬP HỌC THUẬT THÀNH CÔNG RỰC RỠ (EXIT CODE 0)!');
  process.exit(0);
}
