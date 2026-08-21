import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Kích hoạt cờ V8 tối ưu bộ nhớ để ngăn V8 TurboFan Zone OOM trên Windows
if (!process.execArgv.includes('--liftoff-only')) {
  const result = spawnSync(
    process.execPath,
    [
      '--liftoff-only',
      '--v8-pool-size=1',
      '--no-wasm-async-compilation',
      ...process.execArgv,
      __filename,
      ...process.argv.slice(2)
    ],
    { stdio: 'inherit' }
  );
  process.exit(result.status ?? 0);
}

async function runDecimalTests() {
  console.log('================================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ PGLITE: DECIMAL MANUAL GRADING RUNTIME SUITE');
  console.log('================================================================\n');

  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();

// 1. Roles & Schemas
await db.exec(`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres') THEN CREATE ROLE postgres; END IF;
  END $$;

  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
  $$;

  CREATE SCHEMA IF NOT EXISTS app_private;
  CREATE SCHEMA IF NOT EXISTS storage;
`);

// 2. DDL Tables
await db.exec(`
  CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    email TEXT UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin', 'parent')),
    total_stars INT DEFAULT 0,
    total_coins INT DEFAULT 0,
    student_code TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS public.classes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    grade_level INT NOT NULL,
    teacher_id UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS public.class_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_class_student UNIQUE (class_id, student_id)
  );

  CREATE TABLE IF NOT EXISTS public.academic_exercises (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    grade_level INT NOT NULL,
    subject TEXT NOT NULL,
    exercise_type TEXT NOT NULL DEFAULT 'mixed',
    status TEXT NOT NULL DEFAULT 'draft',
    reward_stars INT DEFAULT 10,
    due_date TIMESTAMPTZ,
    is_global BOOLEAN DEFAULT FALSE,
    teacher_id UUID REFERENCES public.profiles(id),
    class_id UUID REFERENCES public.classes(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS public.academic_exercise_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exercise_id UUID NOT NULL REFERENCES public.academic_exercises(id) ON DELETE CASCADE,
    question_number INT NOT NULL,
    question_type TEXT NOT NULL,
    prompt TEXT NOT NULL,
    options_json JSONB,
    correct_answer TEXT,
    correct_answer_key JSONB,
    points INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS public.academic_exercise_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exercise_id UUID NOT NULL REFERENCES public.academic_exercises(id) ON DELETE CASCADE,
    class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES public.profiles(id),
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    due_date TIMESTAMPTZ,
    counts_toward_ranking BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_exercise_class UNIQUE (exercise_id, class_id)
  );

  CREATE TABLE IF NOT EXISTS public.academic_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exercise_id UUID NOT NULL REFERENCES public.academic_exercises(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    attempt_number INT NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft',
    objective_score INT DEFAULT 0,
    manual_score INT DEFAULT 0,
    total_score INT,
    max_score INT NOT NULL DEFAULT 10,
    reward_stars_awarded INT DEFAULT 0,
    reward_applied_at TIMESTAMPTZ,
    teacher_feedback TEXT,
    graded_by UUID REFERENCES public.profiles(id),
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    graded_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_exercise_student_attempt UNIQUE (exercise_id, student_id, attempt_number)
  );

  CREATE TABLE IF NOT EXISTS public.academic_submission_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL REFERENCES public.academic_submissions(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES public.academic_exercise_questions(id) ON DELETE CASCADE,
    student_answer_json JSONB,
    file_url TEXT,
    is_correct BOOLEAN,
    points_earned INT DEFAULT 0,
    teacher_comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS storage.objects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id TEXT NOT NULL,
    name TEXT NOT NULL,
    owner UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

  CREATE OR REPLACE FUNCTION storage.foldername(name text)
  RETURNS text[] LANGUAGE plpgsql AS $$
  BEGIN
    RETURN string_to_array(name, '/');
  END;
  $$;
`);

// 3. Helper Functions
await db.exec(`
  CREATE OR REPLACE FUNCTION app_private.is_admin()
  RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin');
  $$;

  CREATE OR REPLACE FUNCTION app_private.is_teacher()
  RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'teacher');
  $$;

  CREATE OR REPLACE FUNCTION app_private.teacher_owns_class(p_class_id UUID)
  RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM public.classes WHERE id = p_class_id AND teacher_id = (SELECT auth.uid()));
  $$;

  CREATE OR REPLACE FUNCTION app_private.student_in_class(p_class_id UUID)
  RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM public.class_members WHERE class_id = p_class_id AND student_id = (SELECT auth.uid()));
  $$;

  CREATE OR REPLACE FUNCTION app_private.teacher_manages_student(p_student_id UUID)
  RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.classes c
      JOIN public.class_members cm ON c.id = cm.class_id
      WHERE c.teacher_id = (SELECT auth.uid()) AND cm.student_id = p_student_id
    );
  $$;
`);

// 4. Nạp Handover Migration trước
const handoverMigrationPath = path.resolve(__dirname, '../FIX_ACADEMIC_CLASS_HANDOVER_PERMISSIONS.sql');
const handoverMigration = await fs.readFile(handoverMigrationPath, 'utf-8');
await db.exec(handoverMigration);

// 5. Nạp dữ liệu cũ (điểm INT) để kiểm tra bảo toàn dữ liệu
const oldTeacherId = '11111111-1111-1111-1111-111111111111';
const oldStudentId = '22222222-2222-2222-2222-222222222222';
const oldClassId = '33333333-3333-3333-3333-333333333333';
const oldExerciseId = '44444444-4444-4444-4444-444444444444';
const oldSubId = '55555555-5555-5555-5555-555555555555';
const oldQId1 = '66666666-6666-6666-6666-666666666661';
const oldQId2 = '66666666-6666-6666-6666-666666666662';

await db.exec(`
  INSERT INTO public.profiles (id, full_name, email, role, total_stars) VALUES
    ('${oldTeacherId}', 'Thầy Giáo Cũ', 'teacher@school.edu', 'teacher', 0),
    ('${oldStudentId}', 'Học Sinh Cũ', 'student@school.edu', 'student', 10);

  INSERT INTO public.classes (id, name, code, grade_level, teacher_id) VALUES
    ('${oldClassId}', 'Lớp 1A', 'CLASS-1A', 1, '${oldTeacherId}');

  INSERT INTO public.class_members (class_id, student_id) VALUES
    ('${oldClassId}', '${oldStudentId}');

  INSERT INTO public.academic_exercises (id, title, grade_level, subject, teacher_id, class_id, reward_stars, status) VALUES
    ('${oldExerciseId}', 'Bài Toán Cũ', 1, 'Toán', '${oldTeacherId}', '${oldClassId}', 10, 'published');

  INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_by) VALUES
    ('${oldExerciseId}', '${oldClassId}', '${oldTeacherId}');

  INSERT INTO public.academic_exercise_questions (id, exercise_id, question_number, question_type, prompt, points) VALUES
    ('${oldQId1}', '${oldExerciseId}', 1, 'single_choice', '1+1=?', 5),
    ('${oldQId2}', '${oldExerciseId}', 2, 'essay', 'Tự luận cũ', 5);

  INSERT INTO public.academic_submissions (id, exercise_id, student_id, attempt_number, status, objective_score, manual_score, total_score, max_score) VALUES
    ('${oldSubId}', '${oldExerciseId}', '${oldStudentId}', 1, 'submitted', 5, 0, 5, 10);

  INSERT INTO public.academic_submission_answers (submission_id, question_id, student_answer_json, points_earned, is_correct) VALUES
    ('${oldSubId}', '${oldQId1}', '{"answer": "2"}'::jsonb, 5, true),
    ('${oldSubId}', '${oldQId2}', '{"answer": "Bài làm cũ"}'::jsonb, 0, false);
`);

console.log('✅ Đã nạp dữ liệu cũ (điểm số nguyên: 0, 5, 10).');

// 6. Nạp MIGRATION DECIMAL MỚI
const decimalMigrationPath = path.resolve(__dirname, '../FIX_ACADEMIC_DECIMAL_MANUAL_GRADING.sql');
const decimalMigration = await fs.readFile(decimalMigrationPath, 'utf-8');
await db.exec(decimalMigration);
console.log('✅ Đã nạp thành công FIX_ACADEMIC_DECIMAL_MANUAL_GRADING.sql vào PGlite.');

// TEST 1: Kiểm tra dữ liệu cũ vẫn bảo toàn nguyên vẹn 100%
const checkOldData = await db.query(`
  SELECT s.objective_score, s.manual_score, s.total_score, a.points_earned
  FROM public.academic_submissions s
  JOIN public.academic_submission_answers a ON a.submission_id = s.id
  WHERE s.id = '${oldSubId}' AND a.question_id = '${oldQId1}';
`);
assert.strictEqual(Number(checkOldData.rows[0].objective_score), 5, 'objective_score cũ phải là 5');
assert.strictEqual(Number(checkOldData.rows[0].total_score), 5, 'total_score cũ phải là 5');
assert.strictEqual(Number(checkOldData.rows[0].points_earned), 5, 'points_earned cũ phải là 5');
console.log('✅ TEST 1 (PASS): Dữ liệu số nguyên cũ (0, 5, 10) được bảo toàn nguyên vẹn.');

// Thiết lập phiên đăng nhập của Thầy Giáo
await db.exec(`SET app.current_user_id = '${oldTeacherId}';`);

// TEST 2: Chấm điểm 0.5 cho câu tự luận -> lưu chính xác 0.50
const res05 = await db.query(`
  SELECT public.grade_academic_submission(
    '${oldSubId}',
    '[{"question_id": "${oldQId2}", "points_earned": 0.5, "teacher_comment": "Cần cố gắng"}]'::jsonb,
    'Nhận xét tốt',
    false
  ) as result;
`);
const result05 = res05.rows[0].result;
assert.strictEqual(result05.success, true, 'Chấm điểm 0.5 phải thành công');
assert.strictEqual(Number(result05.total_score), 5.5, 'Tổng điểm phải là 5 + 0.5 = 5.5');

const checkSub05 = await db.query(`
  SELECT s.manual_score, s.total_score, a.points_earned
  FROM public.academic_submissions s
  JOIN public.academic_submission_answers a ON a.submission_id = s.id
  WHERE s.id = '${oldSubId}' AND a.question_id = '${oldQId2}';
`);
assert.strictEqual(Number(checkSub05.rows[0].points_earned), 0.5, 'points_earned trong DB phải là 0.5');
assert.strictEqual(Number(checkSub05.rows[0].manual_score), 0.5, 'manual_score trong DB phải là 0.5');
assert.strictEqual(Number(checkSub05.rows[0].total_score), 5.5, 'total_score trong DB phải là 5.5');
console.log('✅ TEST 2 (PASS): Chấm điểm 0.5 -> Database lưu chính xác 0.50 và tổng điểm 5.50.');

// Reset bài nộp về pending_manual_grade để test tiếp
await db.exec(`
  UPDATE public.academic_submissions
  SET status = 'pending_manual_grade', reward_applied_at = NULL, reward_stars_awarded = 0
  WHERE id = '${oldSubId}';
`);

// TEST 3: Chấm điểm 2.75
const res15 = await db.query(`
  SELECT public.grade_academic_submission(
    '${oldSubId}',
    '[{"question_id": "${oldQId2}", "points_earned": 2.75, "teacher_comment": "Khá tốt"}]'::jsonb,
    'Tuyệt vời',
    false
  ) as result;
`);
const result15 = res15.rows[0].result;
assert.strictEqual(result15.success, true, 'Chấm điểm 2.75 phải thành công');
assert.strictEqual(Number(result15.total_score), 7.75, 'Tổng điểm phải là 5 + 2.75 = 7.75');
assert.strictEqual(result15.stars_awarded, 7, 'Sao thưởng 10 * (7.75/10) = 7.75 -> FLOOR = 7');
console.log('✅ TEST 3 (PASS): Chấm điểm 2.75 -> Tổng điểm 7.75, tính sao thưởng FLOOR = 7 (số nguyên INT).');

// Reset bài nộp
await db.exec(`
  UPDATE public.academic_submissions
  SET status = 'submitted', reward_applied_at = NULL, reward_stars_awarded = 0
  WHERE id = '${oldSubId}';
`);

// TEST 4: Điểm âm -> REJECT
const resNeg = await db.query(`
  SELECT public.grade_academic_submission(
    '${oldSubId}',
    '[{"question_id": "${oldQId2}", "points_earned": -0.5}]'::jsonb,
    '',
    false
  ) as result;
`);
assert.strictEqual(resNeg.rows[0].result.success, false, 'Điểm âm phải bị từ chối');
assert.strictEqual(resNeg.rows[0].result.message.includes('không hợp lệ'), true);
console.log('✅ TEST 4 (PASS): Điểm âm (-0.5) bị từ chối chính xác.');

// TEST 5: Điểm vượt mức tối đa (max 5 điểm, gửi 5.5) -> REJECT
const resExceed = await db.query(`
  SELECT public.grade_academic_submission(
    '${oldSubId}',
    '[{"question_id": "${oldQId2}", "points_earned": 5.5}]'::jsonb,
    '',
    false
  ) as result;
`);
assert.strictEqual(resExceed.rows[0].result.success, false, 'Điểm vượt max phải bị từ chối');
assert.strictEqual(resExceed.rows[0].result.message.includes('không hợp lệ'), true);
console.log('✅ TEST 5 (PASS): Điểm vượt quá điểm tối đa của câu (5.5 / 5) bị từ chối chính xác.');

// TEST 6: Gửi câu hỏi trắc nghiệm single_choice vào manual payload -> REJECT
const resChoice = await db.query(`
  SELECT public.grade_academic_submission(
    '${oldSubId}',
    '[{"question_id": "${oldQId1}", "points_earned": 3.5}]'::jsonb,
    '',
    false
  ) as result;
`);
assert.strictEqual(resChoice.rows[0].result.success, false, 'Chấm thủ công câu single_choice phải bị từ chối');
assert.strictEqual(resChoice.rows[0].result.message.includes('Chỉ được chấm điểm thủ công cho câu hỏi tự luận'), true);
console.log('✅ TEST 6 (PASS): Câu trắc nghiệm gửi vào manual payload bị từ chối đúng chuẩn.');

// TEST 7: Giáo viên không quản lý lớp -> REJECT
const otherTeacherId = '77777777-7777-7777-7777-777777777777';
await db.exec(`
  INSERT INTO public.profiles (id, full_name, email, role) VALUES ('${otherTeacherId}', 'GV Khác', 'other@school.edu', 'teacher');
  SET app.current_user_id = '${otherTeacherId}';
`);

const resNoPerm = await db.query(`
  SELECT public.grade_academic_submission(
    '${oldSubId}',
    '[{"question_id": "${oldQId2}", "points_earned": 4.5}]'::jsonb,
    '',
    false
  ) as result;
`);
assert.strictEqual(resNoPerm.rows[0].result.success, false, 'GV không phụ trách lớp phải bị từ chối');
assert.strictEqual(resNoPerm.rows[0].result.message.includes('Bạn không có quyền chấm bài nộp này'), true);
console.log('✅ TEST 7 (PASS): Phân quyền Class Ownership chặn GV khác chấm bài thành công 100%.');

// TEST 8: Yêu cầu làm lại bài (revision_requested) với điểm thập phân -> PASS
await db.exec(`SET app.current_user_id = '${oldTeacherId}';`);

const resRevision = await db.query(`
  SELECT public.grade_academic_submission(
    '${oldSubId}',
    '[{"question_id": "${oldQId2}", "points_earned": 1.5, "teacher_comment": "Làm lại bài nhé"}]'::jsonb,
    'Cần bổ sung ý',
    true
  ) as result;
`);
assert.strictEqual(resRevision.rows[0].result.success, true, 'Yêu cầu làm lại bài phải thành công');
assert.strictEqual(resRevision.rows[0].result.status, 'revision_requested', 'Status phải là revision_requested');
console.log('✅ TEST 8 (PASS): Yêu cầu làm lại bài (revision_requested) với điểm 1.5 hoạt động chính xác.');

await db.close();

console.log('\n================================================================');
console.log('🎉 TOÀN BỘ 8/8 PGLITE DECIMAL MANUAL GRADING RUNTIME TESTS PASS 100%!');
console.log('================================================================\n');
}

runDecimalTests().catch(err => {
  console.error('\n❌ TEST RUN FAILED:', err);
  process.exit(1);
});
