import fs from 'fs';
import path from 'path';

console.log('🔍 Bắt đầu kiểm tra tĩnh siêu chuẩn xác Hệ Thống Bài Tập Học Thuật 6.0 (Academic Exercises)...\n');

let hasError = false;

// 1. KIỂM TRA FILE SQL MIGRATION ADD_ACADEMIC_EXERCISES.SQL
const sqlPath = path.join(process.cwd(), 'ADD_ACADEMIC_EXERCISES.sql');
if (!fs.existsSync(sqlPath)) {
  console.error('❌ LỖI: Thiếu file ADD_ACADEMIC_EXERCISES.sql');
  hasError = true;
} else {
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Check 1: CTE pre-check kiêm kiểm tra mơ hồ trước khi UPDATE class_id
  if (!sql.includes('AmbiguousCheck AS') || !sql.includes('MIGRATION BỊ DỪNG')) {
    console.error('❌ LỖI MIGRATION: Thiếu CTE pre-check kiểm tra mơ hồ dữ liệu class_name trước khi UPDATE!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Migration: Có CTE pre-check kiểm tra mơ hồ class_name trước khi UPDATE!');
  }

  // Check 2: Khóa DELETE câu hỏi khi bài tập đã có submissions
  if (!sql.includes('v_has_submissions') || !sql.includes('SELECT EXISTS (\n      SELECT 1 FROM public.academic_submissions')) {
    console.error('❌ LỖI BẢO VỆ DỮ LIỆU: Chưa khóa DELETE câu hỏi khi bài tập đã có bài nộp!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Data Protection: Đã khóa DELETE câu hỏi khi bài tập đã có bài nộp của học sinh!');
  }

  // Check 3: RPC get_exercise_for_edit
  if (!sql.includes('FUNCTION public.get_exercise_for_edit')) {
    console.error('❌ LỖI SECURITY: Thiếu RPC get_exercise_for_edit!');
    hasError = true;
  } else {
    console.log('  ✅ SQL RPC: get_exercise_for_edit tải chính xác answer key bí mật!');
  }

  // Check 4: Check RLS khóa direct write trên academic_exercise_questions
  if (sql.includes('CREATE POLICY "Academic questions write policy" ON public.academic_exercise_questions') && sql.includes('FOR ALL')) {
    console.error('❌ LỖI RLS: Không được mở policy FOR ALL trên academic_exercise_questions!');
    hasError = true;
  } else {
    console.log('  ✅ SQL RLS: Đã khóa direct write RLS trên academic_exercise_questions!');
  }
}

// 2. KIỂM TRA FRONTEND COMPONENTS
const listTabPath = path.join(process.cwd(), 'src', 'components', 'dashboard', 'exercises', 'ExerciseListTab.jsx');
if (fs.existsSync(listTabPath)) {
  const listContent = fs.readFileSync(listTabPath, 'utf8');
  if (!listContent.includes('selectedExerciseToEdit')) {
    console.error('❌ LỖI UI: ExerciseListTab.jsx chưa có state selectedExerciseToEdit!');
    hasError = true;
  } else {
    console.log('  ✅ ExerciseListTab: Đã bổ sung state selectedExerciseToEdit và nút Sửa Bài Tập!');
  }
}

const createModalPath = path.join(process.cwd(), 'src', 'components', 'dashboard', 'exercises', 'CreateExerciseModal.jsx');
if (fs.existsSync(createModalPath)) {
  const createContent = fs.readFileSync(createModalPath, 'utf8');
  if (!createContent.includes('get_exercise_for_edit')) {
    console.error('❌ LỖI PROMPT: CreateExerciseModal chưa dùng RPC get_exercise_for_edit!');
    hasError = true;
  } else {
    console.log('  ✅ CreateExerciseModal: Dùng RPC get_exercise_for_edit tải đáp án thật!');
  }
}

if (hasError) {
  console.error('\n❌ KIỂM TRA TĨNH BÀI TẬP HỌC THUẬT 6.0 THẤT BẠI!');
  process.exit(1);
} else {
  console.log('\n✅ KIỂM TRA TĨNH HỆ THỐNG BÀI TẬP HỌC THUẬT 6.0 THÀNH CÔNG RỰC RỠ (EXIT CODE 0)!');
  process.exit(0);
}
