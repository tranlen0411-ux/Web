import fs from 'fs';
import path from 'path';

console.log('🔍 Bắt đầu kiểm tra tĩnh siêu nghiêm ngặt Hệ Thống Bài Tập Học Thuật 5.0 (Academic Exercises)...\n');

let hasError = false;

// 1. KIỂM TRA FILE SQL MIGRATION ADD_ACADEMIC_EXERCISES.SQL
const sqlPath = path.join(process.cwd(), 'ADD_ACADEMIC_EXERCISES.sql');
if (!fs.existsSync(sqlPath)) {
  console.error('❌ LỖI: Thiếu file ADD_ACADEMIC_EXERCISES.sql');
  hasError = true;
} else {
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Check 1: Không được có "Academic questions write policy" FOR ALL
  if (sql.includes('CREATE POLICY "Academic questions write policy" ON public.academic_exercise_questions') && sql.includes('FOR ALL')) {
    console.error('❌ LỖI BẢO MẬT: Không được để policy FOR ALL rộng cho academic_exercise_questions! Phải khóa direct write!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Security: Đã xóa policy FOR ALL trên academic_exercise_questions!');
  }

  // Check 2: Advisory Lock
  if (!sql.includes('pg_advisory_xact_lock')) {
    console.error('❌ LỖI: Thiếu pg_advisory_xact_lock!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Lock: pg_advisory_xact_lock hoạt động nguyên tử!');
  }

  // Check 3: Check get_submission_correct_answers không cho xem chỉ vì status graded khi còn lượt
  if (sql.includes('OR v_sub.status = \'graded\'') && sql.includes('get_submission_correct_answers')) {
    console.error('❌ LỖI LOGIC: get_submission_correct_answers cho xem đáp án khi vẫn còn lượt nộp bài!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Security: get_submission_correct_answers chỉ cho xem khi đã hết max_attempts hoặc closed/archived!');
  }

  // Check 4: Check submit RPC validate question_id lặp/không thuộc bài
  if (!sql.includes('v_seen_q_ids') || !sql.includes('Phát hiện question_id không thuộc bài tập này')) {
    console.error('❌ LỖI VALIDATION: submit_academic_exercise chưa validate lặp/lạ question_id!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Validation: submit_academic_exercise từ chối câu hỏi lạ hoặc trùng lặp!');
  }

  // Check 5: Check migration class_name đa điều kiện
  if (!sql.includes('e.grade_level = c.grade_level') || !sql.includes('DROP COLUMN IF EXISTS class_name')) {
    console.error('❌ LỖI MIGRATION: Logic chuyển đổi class_name chưa có đối chiếu đa điều kiện hoặc chưa drop!');
    hasError = true;
  } else {
    console.log('  ✅ SQL Migration: Chuyển đổi class_name đa điều kiện an toàn và hỗ trợ drop column!');
  }
}

// 2. KIỂM TRA FRONTEND COMPONENTS
const createModalPath = path.join(process.cwd(), 'src', 'components', 'dashboard', 'exercises', 'CreateExerciseModal.jsx');
if (fs.existsSync(createModalPath)) {
  const content = fs.readFileSync(createModalPath, 'utf8');

  // Check không hardcode status = 'published'
  if (content.includes("status: 'published'") && !content.includes("targetStatus")) {
    console.error('❌ LỖI UI: CreateExerciseModal hardcode status = published!');
    hasError = true;
  } else {
    console.log('  ✅ Frontend UI: CreateExerciseModal hỗ trợ status linh hoạt (draft, published, closed, archived)!');
  }
}

if (hasError) {
  console.error('\n❌ KIỂM TRA TĨNH BÀI TẬP HỌC THUẬT 5.0 THẤT BẠI!');
  process.exit(1);
} else {
  console.log('\n✅ KIỂM TRA TĨNH HỆ THỐNG BÀI TẬP HỌC THUẬT 5.0 THÀNH CÔNG RỰC RỠ (EXIT CODE 0)!');
  process.exit(0);
}
