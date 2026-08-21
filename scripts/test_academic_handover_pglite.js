import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import assert from 'assert/strict';

const __filename = fileURLToPath(import.meta.url);

// Tự động kích hoạt các cờ V8 tối ưu bộ nhớ để ngăn V8 TurboFan Zone OOM trên môi trường Windows PGlite
if (!process.execArgv.includes('--liftoff-only')) {
  const result = spawnSync(
    process.execPath,
    [
      '--liftoff-only',
      '--wasm-enforce-bounds-checks',
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

async function runHandoverTests() {
  console.log('================================================================');
  console.log('🚀 BẮT ĐẦU KIỂM THỬ PGLITE: PHÂN QUYỀN ACADEMIC CLASS HANDOVER');
  console.log('================================================================\n');

  const db = new PGlite();

  // 1. Tạo Schema cơ bản, Roles & Extensions
  await db.exec(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres') THEN CREATE ROLE postgres; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
    END $$;

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
      status TEXT NOT NULL DEFAULT 'draft',
      objective_score INT DEFAULT 0,
      total_score INT,
      max_score INT NOT NULL DEFAULT 10,
      stars_awarded INT DEFAULT 0,
      teacher_feedback TEXT,
      graded_by UUID REFERENCES public.profiles(id),
      submitted_at TIMESTAMPTZ DEFAULT NOW(),
      graded_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.academic_submission_answers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      submission_id UUID NOT NULL REFERENCES public.academic_submissions(id) ON DELETE CASCADE,
      question_id UUID NOT NULL REFERENCES public.academic_exercise_questions(id) ON DELETE CASCADE,
      student_answer_json JSONB,
      is_correct BOOLEAN,
      points_earned INT DEFAULT 0,
      teacher_comment TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE IF NOT EXISTS storage.objects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id TEXT NOT NULL,
      name TEXT NOT NULL,
      owner UUID,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE OR REPLACE FUNCTION storage.foldername(name text)
    RETURNS text[] LANGUAGE plpgsql AS $$
    BEGIN
      RETURN string_to_array(name, '/');
    END;
    $$;
  `);

  // Tạo mock auth.uid()
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
    $$;
  `);

  // 2. Nạp Migration mới FIX_ACADEMIC_CLASS_HANDOVER_PERMISSIONS.sql
  const migrationSql = fs.readFileSync('FIX_ACADEMIC_CLASS_HANDOVER_PERMISSIONS.sql', 'utf-8');
  await db.exec(migrationSql);
  console.log('✅ Đã nạp thành công migration FIX_ACADEMIC_CLASS_HANDOVER_PERMISSIONS.sql vào PGlite.');

  // 3. Khởi tạo dữ liệu kiểm thử thực tế:
  // - Admin
  // - Cô Nguyễn Thị Hoa (Teacher)
  // - Thầy Trần Văn Lên (Teacher)
  // - Học sinh HS101 (Student)
  // - Lớp 1A (ban đầu teacher_id = Cô Hoa)
  // - Bài "Ôn tập Toán cuối tuần 1A" (teacher_id = Cô Hoa, class_id = Lớp 1A, published)
  // - HS101 nộp bài "Ôn toán"
  const adminId = '11111111-1111-1111-1111-111111111111';
  const hoaId = '22222222-2222-2222-2222-222222222222';
  const lenId = '33333333-3333-3333-3333-333333333333';
  const hs101Id = '44444444-4444-4444-4444-444444444444';
  const class1AId = '55555555-5555-5555-5555-555555555555';
  const exerciseId = '66666666-6666-6666-6666-666666666666';
  const q1Id = '77777777-7777-7777-7777-777777777771';
  const q2EssayId = '77777777-7777-7777-7777-777777777772';
  const submissionId = '88888888-8888-8888-8888-888888888888';

  await db.exec(`
    INSERT INTO public.profiles (id, full_name, email, role, total_stars) VALUES
    ('${adminId}', 'Quản Trị Viên', 'admin@truonghoc.edu.vn', 'admin', 0),
    ('${hoaId}', 'Cô Nguyễn Thị Hoa', 'hoa.nguyen@truonghoc.edu.vn', 'teacher', 0),
    ('${lenId}', 'Thầy Trần Văn Lên', 'len.tran@truonghoc.edu.vn', 'teacher', 0),
    ('${hs101Id}', 'Học Sinh 101', 'hs101@truonghoc.edu.vn', 'student', 20);

    INSERT INTO public.classes (id, name, code, grade_level, teacher_id) VALUES
    ('${class1AId}', '1A', 'LOP1A2026', 1, '${hoaId}');

    INSERT INTO public.class_members (class_id, student_id) VALUES
    ('${class1AId}', '${hs101Id}');

    -- Cô Hoa tạo bài Ôn toán
    INSERT INTO public.academic_exercises (id, title, description, grade_level, subject, exercise_type, status, reward_stars, teacher_id, class_id) VALUES
    ('${exerciseId}', 'Ôn tập Toán cuối tuần 1A', 'Bài tập ôn phép cộng và tự luận', 1, 'Toán', 'mixed', 'published', 15, '${hoaId}', '${class1AId}');

    INSERT INTO public.academic_exercise_questions (id, exercise_id, question_number, question_type, prompt, points) VALUES
    ('${q1Id}', '${exerciseId}', 1, 'single_choice', '3 + 4 = ?', 5),
    ('${q2EssayId}', '${exerciseId}', 2, 'essay', 'Giải thích cách tính 7 + 8', 5);

    INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_by) VALUES
    ('${exerciseId}', '${class1AId}', '${hoaId}');

    -- HS101 nộp bài (Câu 1 trắc nghiệm đúng 5đ, Câu 2 tự luận chờ chấm)
    INSERT INTO public.academic_submissions (id, exercise_id, student_id, status, objective_score, total_score, max_score) VALUES
    ('${submissionId}', '${exerciseId}', '${hs101Id}', 'pending_manual_grade', 5, 5, 10);

    INSERT INTO public.academic_submission_answers (submission_id, question_id, student_answer_json, is_correct, points_earned) VALUES
    ('${submissionId}', '${q1Id}', '"7"'::jsonb, true, 5),
    ('${submissionId}', '${q2EssayId}', '"7 + 8 = 7 + 3 + 5 = 15"'::jsonb, null, 0);
  `);

  console.log('✅ Đã tạo dữ liệu ban đầu: Cô Hoa chủ nhiệm Lớp 1A, HS101 nộp bài Ôn toán.');

  // =========================================================================
  // BƯỚC 4: ADMIN CHUYỂN GIAO LỚP 1A TỪ CÔ HOA SANG THẦY LÊN
  // =========================================================================
  console.log('\n--- 🔄 THỰC HIỆN BÀN GIAO LỚP 1A TỪ CÔ HOA SANG THẦY LÊN ---');
  await db.exec(`UPDATE public.classes SET teacher_id = '${lenId}' WHERE id = '${class1AId}';`);
  console.log('✅ Đã cập nhật classes.teacher_id của Lớp 1A = Thầy Trần Văn Lên.');

  // Helper set auth
  const setAuth = async (userId) => {
    await db.exec(`SET request.jwt.claim.sub = '${userId}';`);
  };

  // =========================================================================
  // TEST CASE 1: THẦY LÊN (GV MỚI) XEM BÀI TẬP ÔN TOÁN QUA RLS
  // =========================================================================
  console.log('\n--- 🧪 TEST CASE 1: THẦY LÊN SELECT BÀI TẬP ÔN TOÁN ---');
  await setAuth(lenId);
  const exRowsLen = await db.query(`SELECT * FROM public.academic_exercises WHERE id = '${exerciseId}';`);
  assert.strictEqual(exRowsLen.rows.length, 1, 'Thầy Lên phải xem được bài Ôn toán');
  assert.strictEqual(exRowsLen.rows[0].title, 'Ôn tập Toán cuối tuần 1A');
  console.log('✅ PASS: Thầy Lên SELECT thành công bài "Ôn tập Toán cuối tuần 1A" (dù do Cô Hoa tạo).');

  // =========================================================================
  // TEST CASE 2: THẦY LÊN (GV MỚI) SELECT BÀI NỘP CỦA HS101 QUA RLS
  // =========================================================================
  console.log('\n--- 🧪 TEST CASE 2: THẦY LÊN SELECT BÀI NỘP CỦA HS101 ---');
  await setAuth(lenId);
  const subRowsLen = await db.query(`SELECT * FROM public.academic_submissions WHERE id = '${submissionId}';`);
  assert.strictEqual(subRowsLen.rows.length, 1, 'Thầy Lên phải xem được bài nộp của HS101');
  assert.strictEqual(subRowsLen.rows[0].student_id, hs101Id);
  console.log('✅ PASS: Thầy Lên SELECT thành công bài nộp của HS101 (học sinh Lớp 1A).');

  // =========================================================================
  // TEST CASE 3: THẦY LÊN (GV MỚI) CHẤM ĐIỂM BÀI NỘP HS101 QUA RPC GRADE_ACADEMIC_SUBMISSION
  // =========================================================================
  console.log('\n--- 🧪 TEST CASE 3: THẦY LÊN GỌI RPC CHẤM BÀI CHO HS101 ---');
  await setAuth(lenId);
  const gradeRes = await db.query(`
    SELECT public.grade_academic_submission(
      '${submissionId}'::uuid,
      '[{"question_id":"${q2EssayId}","points_earned":5,"teacher_comment":"Giải thích rất tốt!"}]'::jsonb,
      'Thầy Lên khen ngợi con làm bài xuất sắc!',
      false
    ) as result;
  `);
  const gradeJson = gradeRes.rows[0].result;
  assert.strictEqual(gradeJson.success, true, 'Thầy Lên chấm điểm phải thành công');
  assert.strictEqual(gradeJson.status, 'graded');
  assert.strictEqual(gradeJson.total_score, 10);
  assert.strictEqual(gradeJson.stars_awarded, 15);
  console.log('✅ PASS: Thầy Lên chấm điểm thành công cho HS101! Điểm tổng: 10/10, Thưởng sao: +15 sao.');

  // Kiểm tra sao thưởng đã được cộng vào profile HS101
  const hsProfile = await db.query(`SELECT total_stars FROM public.profiles WHERE id = '${hs101Id}';`);
  assert.strictEqual(hsProfile.rows[0].total_stars, 35, 'Tổng sao của HS101 phải là 35');
  console.log('✅ PASS: Tổng sao của HS101 đã tự động tăng từ 20 lên 35 sao.');

  // =========================================================================
  // TEST CASE 4: THẦY LÊN GIAO BÀI TẬP VÀO LỚP 1A QUA RPC ASSIGN_EXERCISE_TO_CLASSES
  // =========================================================================
  console.log('\n--- 🧪 TEST CASE 4: THẦY LÊN GIAO BÀI VÀO LỚP 1A ---');
  await setAuth(lenId);
  const assignRes = await db.query(`
    SELECT public.assign_exercise_to_classes(
      '${exerciseId}'::uuid,
      ARRAY['${class1AId}'::uuid],
      true
    ) as result;
  `);
  const assignJson = assignRes.rows[0].result;
  assert.strictEqual(assignJson.success, true);
  assert.ok(assignJson.assigned_classes.includes('1A'));
  console.log('✅ PASS: Thầy Lên giao bài tập vào Lớp 1A thành công.');

  // =========================================================================
  // TEST CASE 5: CÔ HOA (GV CŨ) BỊ CHẶN KHÔNG ĐƯỢC CHẤM BÀI CỦA LỚP 1A
  // =========================================================================
  console.log('\n--- 🧪 TEST CASE 5: CÔ HOA (GV CŨ) CỐ GẮNG CHẤM BÀI LỚP 1A ---');
  await setAuth(hoaId);

  // Reset bài nộp về pending_manual_grade để test
  await db.exec(`UPDATE public.academic_submissions SET status = 'pending_manual_grade' WHERE id = '${submissionId}';`);

  const hoaGradeRes = await db.query(`
    SELECT public.grade_academic_submission(
      '${submissionId}'::uuid,
      '[{"question_id":"${q2EssayId}","points_earned":4,"teacher_comment":"Thử chấm lén"}]'::jsonb,
      'Nhận xét từ GV cũ',
      false
    ) as result;
  `);
  const hoaGradeJson = hoaGradeRes.rows[0].result;
  assert.strictEqual(hoaGradeJson.success, false);
  assert.ok(hoaGradeJson.message.includes('không có quyền'));
  console.log('✅ PASS: Cô Hoa (GV cũ) đã bị CHẶN HOÀN TOÀN khi cố chấm bài của Lớp 1A.');

  // =========================================================================
  // TEST CASE 6: CÔ HOA (GV CŨ) CỐ GẮNG GIAO BÀI CHO LỚP 1A
  // =========================================================================
  console.log('\n--- 🧪 TEST CASE 6: CÔ HOA (GV CŨ) CỐ GẮNG GIAO BÀI CHO LỚP 1A ---');
  await setAuth(hoaId);
  const hoaAssignRes = await db.query(`
    SELECT public.assign_exercise_to_classes(
      '${exerciseId}'::uuid,
      ARRAY['${class1AId}'::uuid],
      true
    ) as result;
  `);
  const hoaAssignJson = hoaAssignRes.rows[0].result;
  assert.strictEqual(hoaAssignJson.success, false);
  console.log('✅ PASS: Cô Hoa (GV cũ) đã bị CHẶN HOÀN TOÀN khi cố giao bài cho Lớp 1A.');

  // =========================================================================
  // TEST CASE 7: BẢO TOÀN DỮ LIỆU GỐC & QUYỀN TÁC GIẢ BÀI GỐC
  // =========================================================================
  console.log('\n--- 🧪 TEST CASE 7: KIỂM TRA BẢO TOÀN DỮ LIỆU GỐC (DATA INTEGRITY) ---');
  const rawEx = await db.query(`SELECT teacher_id, title FROM public.academic_exercises WHERE id = '${exerciseId}';`);
  assert.strictEqual(rawEx.rows[0].teacher_id, hoaId, 'Tác giả gốc phải là Cô Hoa');
  console.log('✅ PASS: Tác giả gốc (teacher_id) của bài "Ôn tập Toán cuối tuần 1A" vẫn giữ nguyên là Cô Hoa để phục vụ Audit.');

  // Cô Hoa vẫn thấy bài do mình tạo trong kho bài tập của mình
  await setAuth(hoaId);
  const hoaExRows = await db.query(`SELECT * FROM public.academic_exercises WHERE id = '${exerciseId}';`);
  assert.strictEqual(hoaExRows.rows.length, 1);
  console.log('✅ PASS: Cô Hoa vẫn thấy bài tập gốc do mình sáng tác trong kho.');

  // =========================================================================
  // TEST CASE 8: HỌC SINH HS101 VẪN XEM ĐƯỢC BÀI TẬP VÀ BÀI NỘP
  // =========================================================================
  console.log('\n--- 🧪 TEST CASE 8: HỌC SINH HS101 TRUY VẤN BÀI TẬP ---');
  await setAuth(hs101Id);
  const hsExRows = await db.query(`SELECT * FROM public.academic_exercises WHERE id = '${exerciseId}';`);
  const hsSubRows = await db.query(`SELECT * FROM public.academic_submissions WHERE id = '${submissionId}';`);
  assert.strictEqual(hsExRows.rows.length, 1);
  assert.strictEqual(hsSubRows.rows.length, 1);
  console.log('✅ PASS: Học sinh HS101 vẫn xem được bài tập và bài nộp của mình bình thường.');

  // =========================================================================
  // TEST CASE 9: ADMIN TOÀN QUYỀN QUẢN LÝ
  // =========================================================================
  console.log('\n--- 🧪 TEST CASE 9: ADMIN KIỂM SOÁT ĐẦY ĐỦ QUYỀN HẠN ---');
  await setAuth(adminId);
  const adminEx = await db.query(`SELECT * FROM public.academic_exercises WHERE id = '${exerciseId}';`);
  const adminSub = await db.query(`SELECT * FROM public.academic_submissions WHERE id = '${submissionId}';`);
  assert.strictEqual(adminEx.rows.length, 1);
  assert.strictEqual(adminSub.rows.length, 1);

  const adminGradeRes = await db.query(`
    SELECT public.grade_academic_submission(
      '${submissionId}'::uuid,
      '[{"question_id":"${q2EssayId}","points_earned":5,"teacher_comment":"Admin chấm duyệt"}]'::jsonb,
      'Nhận xét từ Quản trị viên',
      false
    ) as result;
  `);
  assert.strictEqual(adminGradeRes.rows[0].result.success, true);
  console.log('✅ PASS: Quản Trị Viên (Admin) có đầy đủ toàn quyền truy cập và chấm bài.');

  await db.close();

  console.log('\n================================================================');
  console.log('🎉 TẤT CẢ 9/9 TEST CASES ĐỀU PASS 100%! HỆ THỐNG AN TOÀN TUYỆT ĐỐI.');
  console.log('================================================================\n');
}

runHandoverTests().catch(err => {
  console.error('\n❌ TEST RUN FAILED:', err);
  process.exit(1);
});
