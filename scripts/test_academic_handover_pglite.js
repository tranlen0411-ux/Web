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

async function runHardenedHandoverTests() {
  console.log('================================================================');
  console.log('🚀 BẮT ĐẦU KIỂM THỬ PGLITE: TOÀN BỘ 16/16 HARDENED HANDOVER TESTS');
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

  // 3. Helper Functions (Chuẩn FINAL_MIGRATION.sql)
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

  // 4. Nạp Migration mới FIX_ACADEMIC_CLASS_HANDOVER_PERMISSIONS.sql và UPDATE_STORAGE_HANDOVER_POLICIES.sql
  const migrationPath = path.resolve(__dirname, '../FIX_ACADEMIC_CLASS_HANDOVER_PERMISSIONS.sql');
  const migrationSql = await fs.readFile(migrationPath, 'utf-8');
  await db.exec(migrationSql);
  console.log('✅ Đã nạp thành công migration FIX_ACADEMIC_CLASS_HANDOVER_PERMISSIONS.sql vào PGlite.');

  const storageMigrationPath = path.resolve(__dirname, '../UPDATE_STORAGE_HANDOVER_POLICIES.sql');
  const storageMigrationSql = await fs.readFile(storageMigrationPath, 'utf-8');
  await db.exec(storageMigrationSql);
  console.log('✅ Đã nạp thành công migration UPDATE_STORAGE_HANDOVER_POLICIES.sql vào PGlite.');

  // 5. Khởi tạo Fixture dữ liệu:
  const adminId = '11111111-1111-1111-1111-111111111111';
  const hoaId = '22222222-2222-2222-2222-222222222222';      // Cô Hoa (Creator / Cựu GV Lớp 1A)
  const lenId = '33333333-3333-3333-3333-333333333333';      // Thầy Lên (GV mới Lớp 1A)
  const hungId = '33333333-3333-3333-3333-333333333334';     // Thầy Hùng (GV Lớp 1B)
  const hs101Id = '44444444-4444-4444-4444-444444444444';    // HS101 (Ban đầu ở 1A)
  const hs102Id = '44444444-4444-4444-4444-444444444445';    // HS102 (Ở 1B)
  const class1AId = '55555555-5555-5555-5555-555555555555';  // Lớp 1A
  const class1BId = '55555555-5555-5555-5555-555555555556';  // Lớp 1B
  const exerciseId = '66666666-6666-6666-6666-666666666666'; // Bài "Ôn tập Toán cuối tuần 1A" do Cô Hoa tạo
  const q1Id = '77777777-7777-7777-7777-777777777771';
  const q2EssayId = '77777777-7777-7777-7777-777777777772';
  const submission101Id = '88888888-8888-8888-8888-888888888888';
  const submission102Id = '88888888-8888-8888-8888-888888888889';

  const origAssignedAt = '2026-08-01 08:00:00+07';

  await db.exec(`
    INSERT INTO public.profiles (id, full_name, email, role, total_stars) VALUES
    ('${adminId}', 'Quản Trị Viên', 'admin@truonghoc.edu.vn', 'admin', 0),
    ('${hoaId}', 'Cô Nguyễn Thị Hoa', 'hoa.nguyen@truonghoc.edu.vn', 'teacher', 0),
    ('${lenId}', 'Thầy Trần Văn Lên', 'len.tran@truonghoc.edu.vn', 'teacher', 0),
    ('${hungId}', 'Thầy Lê Văn Hùng', 'hung.le@truonghoc.edu.vn', 'teacher', 0),
    ('${hs101Id}', 'Học Sinh 101', 'hs101@truonghoc.edu.vn', 'student', 20),
    ('${hs102Id}', 'Học Sinh 102', 'hs102@truonghoc.edu.vn', 'student', 10);

    INSERT INTO public.classes (id, name, code, grade_level, teacher_id) VALUES
    ('${class1AId}', '1A', 'LOP1A2026', 1, '${hoaId}'),
    ('${class1BId}', '1B', 'LOP1B2026', 1, '${hungId}');

    INSERT INTO public.class_members (class_id, student_id) VALUES
    ('${class1AId}', '${hs101Id}'),
    ('${class1BId}', '${hs102Id}');

    -- Cô Hoa tạo bài Ôn toán
    INSERT INTO public.academic_exercises (id, title, description, grade_level, subject, exercise_type, status, reward_stars, teacher_id, class_id) VALUES
    ('${exerciseId}', 'Ôn tập Toán cuối tuần 1A', 'Bài tập ôn phép cộng và tự luận', 1, 'Toán', 'mixed', 'published', 15, '${hoaId}', '${class1AId}');

    INSERT INTO public.academic_exercise_questions (id, exercise_id, question_number, question_type, prompt, points) VALUES
    ('${q1Id}', '${exerciseId}', 1, 'single_choice', '3 + 4 = ?', 5),
    ('${q2EssayId}', '${exerciseId}', 2, 'essay', 'Giải thích cách tính 7 + 8', 5);

    -- Lượt giao bài ban đầu cho Lớp 1A với timestamp cố định
    INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_by, assigned_at) VALUES
    ('${exerciseId}', '${class1AId}', '${hoaId}', TIMESTAMPTZ '${origAssignedAt}');

    -- HS101 nộp bài (Câu 1 trắc nghiệm đúng 5đ, Câu 2 tự luận chờ chấm)
    INSERT INTO public.academic_submissions (id, exercise_id, student_id, attempt_number, status, objective_score, total_score, max_score) VALUES
    ('${submission101Id}', '${exerciseId}', '${hs101Id}', 1, 'pending_manual_grade', 5, 5, 10);

    INSERT INTO public.academic_submission_answers (submission_id, question_id, student_answer_json, file_url, is_correct, points_earned) VALUES
    ('${submission101Id}', '${q1Id}', '"7"'::jsonb, null, true, 5),
    ('${submission101Id}', '${q2EssayId}', '"7 + 8 = 15"'::jsonb, '${hs101Id}/${submission101Id}/essay_file.png', null, 0);

    -- Storage object mô phỏng file bài làm của HS101
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES
    ('exercise-submissions', '${hs101Id}/${submission101Id}/essay_file.png', '${hs101Id}');

    -- Phân quyền cho authenticated role để kiểm thử RLS chuẩn PostgREST
    GRANT USAGE ON SCHEMA public, app_private, storage, auth TO authenticated;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
    GRANT ALL ON ALL TABLES IN SCHEMA storage TO authenticated;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
    GRANT ALL ON ALL ROUTINES IN SCHEMA public TO authenticated;
    GRANT ALL ON ALL ROUTINES IN SCHEMA app_private TO authenticated;
  `);

  console.log('✅ Đã khởi tạo dữ liệu ban đầu: Cô Hoa chủ nhiệm Lớp 1A, HS101 nộp bài Ôn toán.');

  // BÀN GIAO LỚP 1A TỪ CÔ HOA SANG THẦY LÊN
  console.log('\n--- 🔄 THỰC HIỆN BÀN GIAO LỚP 1A TỪ CÔ HOA SANG THẦY LÊN ---');
  await db.exec(`UPDATE public.classes SET teacher_id = '${lenId}' WHERE id = '${class1AId}';`);
  console.log('✅ Đã cập nhật classes.teacher_id của Lớp 1A = Thầy Trần Văn Lên.');

  const setAuth = async (userId) => {
    if (userId) {
      await db.exec(`
        SET ROLE authenticated;
        SELECT set_config('app.current_user_id', '${userId}', false);
      `);
    } else {
      await db.exec(`
        SET ROLE postgres;
        SELECT set_config('app.current_user_id', '', false);
      `);
    }
  };

  // TEST 1: Thầy Lên (GV mới) SELECT bài tập Ôn toán qua RLS
  await setAuth(lenId);
  const exRowsLen = await db.query(`SELECT * FROM public.academic_exercises WHERE id = '${exerciseId}';`);
  assert.strictEqual(exRowsLen.rows.length, 1);
  console.log('✅ TEST 1 (PASS): Thầy Lên SELECT thành công bài "Ôn tập Toán cuối tuần 1A" do phụ trách Lớp 1A.');

  // TEST 2: Thầy Lên (GV mới) SELECT bài nộp của HS101 qua RLS
  await setAuth(lenId);
  const subRowsLen = await db.query(`SELECT * FROM public.academic_submissions WHERE id = '${submission101Id}';`);
  assert.strictEqual(subRowsLen.rows.length, 1);
  console.log('✅ TEST 2 (PASS): Thầy Lên SELECT thành công bài nộp của HS101.');

  // TEST 3: Thầy Lên gọi RPC chấm bài HS101
  await setAuth(lenId);
  const gradeRes = await db.query(`
    SELECT public.grade_academic_submission(
      '${submission101Id}'::uuid,
      '[{"question_id":"${q2EssayId}","points_earned":5,"teacher_comment":"Tốt!"}]'::jsonb,
      'Thầy Lên khen ngợi',
      false
    ) as result;
  `);
  const gradeJson = gradeRes.rows[0].result;
  assert.strictEqual(gradeJson.success, true);
  assert.strictEqual(gradeJson.status, 'graded');
  assert.strictEqual(gradeJson.total_score, 10);
  assert.strictEqual(gradeJson.stars_awarded, 15);
  console.log('✅ TEST 3 (PASS): Thầy Lên chấm điểm thành công cho HS101! Điểm 10/10, Thưởng +15 sao.');

  // TEST 4: Thầy Lên giao bài tập vào Lớp 1A qua RPC
  await setAuth(lenId);
  const assignRes = await db.query(`
    SELECT public.assign_exercise_to_classes(
      '${exerciseId}'::uuid,
      ARRAY['${class1AId}'::uuid],
      true
    ) as result;
  `);
  assert.strictEqual(assignRes.rows[0].result.success, true);
  console.log('✅ TEST 4 (PASS): Thầy Lên giao bài tập vào Lớp 1A thành công.');

  // TEST 5: Cô Hoa (GV cũ) bị CHẶN khi chấm bài Lớp 1A
  await setAuth(hoaId);
  await db.exec(`UPDATE public.academic_submissions SET status = 'pending_manual_grade', reward_applied_at = NULL WHERE id = '${submission101Id}';`);
  const hoaGradeRes = await db.query(`
    SELECT public.grade_academic_submission(
      '${submission101Id}'::uuid,
      '[{"question_id":"${q2EssayId}","points_earned":4,"teacher_comment":"Thử chấm"}]'::jsonb,
      'Nhận xét GV cũ',
      false
    ) as result;
  `);
  assert.strictEqual(hoaGradeRes.rows[0].result.success, false);
  console.log('✅ TEST 5 (PASS): Cô Hoa (GV cũ) bị CHẶN HOÀN TOÀN khi cố chấm bài của Lớp 1A.');

  // TEST 6: Cô Hoa (GV cũ) bị CHẶN khi giao bài cho Lớp 1A
  await setAuth(hoaId);
  const hoaAssignRes = await db.query(`
    SELECT public.assign_exercise_to_classes(
      '${exerciseId}'::uuid,
      ARRAY['${class1AId}'::uuid],
      true
    ) as result;
  `);
  assert.strictEqual(hoaAssignRes.rows[0].result.success, false);
  console.log('✅ TEST 6 (PASS): Cô Hoa (GV cũ) bị CHẶN HOÀN TOÀN khi cố giao bài cho Lớp 1A.');

  // TEST 7: Bảo toàn tác giả gốc (teacher_id) của bài Ôn toán
  const rawEx = await db.query(`SELECT teacher_id FROM public.academic_exercises WHERE id = '${exerciseId}';`);
  assert.strictEqual(rawEx.rows[0].teacher_id, hoaId);
  console.log('✅ TEST 7 (PASS): Tác giả gốc (teacher_id) của bài Ôn toán vẫn giữ nguyên là Cô Hoa để phục vụ Audit.');

  // TEST 8: Học sinh HS101 vẫn xem được bài tập và bài nộp
  await setAuth(hs101Id);
  const hsExRows = await db.query(`SELECT * FROM public.academic_exercises WHERE id = '${exerciseId}';`);
  const hsSubRows = await db.query(`SELECT * FROM public.academic_submissions WHERE id = '${submission101Id}';`);
  assert.strictEqual(hsExRows.rows.length, 1);
  assert.strictEqual(hsSubRows.rows.length, 1);
  console.log('✅ TEST 8 (PASS): Học sinh HS101 vẫn xem được bài tập và bài nộp của mình.');

  // TEST 9: Admin có đầy đủ quyền kiểm soát
  await setAuth(adminId);
  const adminEx = await db.query(`SELECT * FROM public.academic_exercises WHERE id = '${exerciseId}';`);
  const adminSub = await db.query(`SELECT * FROM public.academic_submissions WHERE id = '${submission101Id}';`);
  assert.strictEqual(adminEx.rows.length, 1);
  assert.strictEqual(adminSub.rows.length, 1);
  console.log('✅ TEST 9 (PASS): Quản Trị Viên (Admin) có đầy đủ toàn quyền kiểm soát.');

  // =========================================================================
  // HARDENED TEST CASES 10 - 16
  // =========================================================================

  // TEST 10: Creator cũ (Cô Hoa) thấy bài gốc nhưng KHÔNG THẤY assignment Lớp 1A qua RLS
  await setAuth(hoaId);
  const hoaExCheck = await db.query(`SELECT * FROM public.academic_exercises WHERE id = '${exerciseId}';`);
  const hoaAssignCheck = await db.query(`SELECT * FROM public.academic_exercise_assignments WHERE exercise_id = '${exerciseId}' AND class_id = '${class1AId}';`);
  assert.strictEqual(hoaExCheck.rows.length, 1, 'Cô Hoa phải thấy bài gốc trong kho');
  assert.strictEqual(hoaAssignCheck.rows.length, 0, 'Cô Hoa KHÔNG ĐƯỢC thấy assignment của Lớp 1A');
  console.log('✅ TEST 10 (PASS): Creator cũ thấy bài gốc nhưng BỊ CHẶN RLS khi SELECT assignment của Lớp 1A.');

  // TEST 11: HS chuyển lớp không làm GV mới tự động có quyền chấm bài nộp lịch sử của lớp cũ
  // Chuyển HS101 sang Lớp 1B (do Thầy Hùng quản lý)
  await setAuth(null);
  await db.exec(`
    DELETE FROM public.class_members WHERE student_id = '${hs101Id}';
    INSERT INTO public.class_members (class_id, student_id) VALUES ('${class1BId}', '${hs101Id}');
  `);
  // Thầy Hùng (GV mới của HS101 ở 1B) thử chấm submission lịch sử của bài tập 1A
  await setAuth(hungId);
  const hungGradeRes = await db.query(`
    SELECT public.grade_academic_submission(
      '${submission101Id}'::uuid,
      '[{"question_id":"${q2EssayId}","points_earned":5,"teacher_comment":"GV lớp mới chấm lén"}]'::jsonb,
      'Nhận xét từ Thầy Hùng',
      false
    ) as result;
  `);
  assert.strictEqual(hungGradeRes.rows[0].result.success, false, 'Thầy Hùng không được phép chấm submission của bài tập Lớp 1A');
  console.log('✅ TEST 11 (PASS): HS chuyển lớp sang 1B không làm Thầy Hùng tự động có quyền chấm bài nộp lịch sử của Lớp 1A.');

  // Chuyển HS101 trở lại Lớp 1A để phục vụ các test tiếp theo
  await setAuth(null);
  await db.exec(`
    DELETE FROM public.class_members WHERE student_id = '${hs101Id}';
    INSERT INTO public.class_members (class_id, student_id) VALUES ('${class1AId}', '${hs101Id}');
  `);

  // TEST 12: Giao lại cùng exercise/class không phá assigned_at và assigned_by
  await setAuth(lenId);
  const reAssignRes = await db.query(`
    SELECT public.assign_exercise_to_classes(
      '${exerciseId}'::uuid,
      ARRAY['${class1AId}'::uuid],
      true
    ) as result;
  `);
  assert.strictEqual(reAssignRes.rows[0].result.success, true);
  const assignAudit = await db.query(`SELECT assigned_by, assigned_at FROM public.academic_exercise_assignments WHERE exercise_id = '${exerciseId}' AND class_id = '${class1AId}';`);
  assert.strictEqual(assignAudit.rows[0].assigned_by, hoaId, 'assigned_by ban đầu (Cô Hoa) phải giữ nguyên');
  const actualAssignedAt = new Date(assignAudit.rows[0].assigned_at).toISOString();
  const expectedAssignedAt = new Date(origAssignedAt).toISOString();
  assert.strictEqual(actualAssignedAt, expectedAssignedAt, 'assigned_at ban đầu phải giữ nguyên 100%');
  console.log('✅ TEST 12 (PASS): Giao lại cùng exercise/class KHÔNG reset assigned_at và assigned_by (Bảo toàn Audit 100%).');

  // TEST 13: Exercise giao nhiều lớp (1A và 1B) -> Quyền submission KHÔNG BỊ MỞ CHÉO
  // Giao bài tập cho cả Lớp 1B
  await setAuth(null);
  await db.exec(`
    INSERT INTO public.academic_exercise_assignments (exercise_id, class_id, assigned_by, assigned_at)
    VALUES ('${exerciseId}', '${class1BId}', '${hungId}', NOW())
    ON CONFLICT DO NOTHING;

    INSERT INTO public.academic_submissions (id, exercise_id, student_id, attempt_number, status, objective_score, total_score, max_score)
    VALUES ('${submission102Id}', '${exerciseId}', '${hs102Id}', 1, 'pending_manual_grade', 5, 5, 10)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.academic_submission_answers (submission_id, question_id, student_answer_json, points_earned)
    VALUES ('${submission102Id}', '${q2EssayId}', '"Bài làm của HS102"'::jsonb, 0)
    ON CONFLICT DO NOTHING;
  `);

  // Thầy Lên (GV 1A) kiểm tra: thấy HS101, KHÔNG thấy HS102
  await setAuth(lenId);
  const lenSub101 = await db.query(`SELECT * FROM public.academic_submissions WHERE id = '${submission101Id}';`);
  const lenSub102 = await db.query(`SELECT * FROM public.academic_submissions WHERE id = '${submission102Id}';`);
  assert.strictEqual(lenSub101.rows.length, 1, 'Thầy Lên phải thấy bài nộp của HS101 (Lớp 1A)');
  assert.strictEqual(lenSub102.rows.length, 0, 'Thầy Lên KHÔNG ĐƯỢC thấy bài nộp của HS102 (Lớp 1B)');

  // Thầy Hùng (GV 1B) kiểm tra: thấy HS102, KHÔNG thấy HS101
  await setAuth(hungId);
  const hungSub101 = await db.query(`SELECT * FROM public.academic_submissions WHERE id = '${submission101Id}';`);
  const hungSub102 = await db.query(`SELECT * FROM public.academic_submissions WHERE id = '${submission102Id}';`);
  assert.strictEqual(hungSub101.rows.length, 0, 'Thầy Hùng KHÔNG ĐƯỢC thấy bài nộp của HS101 (Lớp 1A)');
  assert.strictEqual(hungSub102.rows.length, 1, 'Thầy Hùng phải thấy bài nộp của HS102 (Lớp 1B)');
  console.log('✅ TEST 13 (PASS): Exercise giao nhiều lớp (1A & 1B) -> Quyền submission cách ly tuyệt đối, không rò rỉ chéo.');

  // TEST 14: Creator không quản lý lớp (Cô Hoa) KHÔNG THỂ UPDATE trực tiếp submission qua RLS
  await setAuth(hoaId);
  const directUpdateRes = await db.query(`
    UPDATE public.academic_submissions
    SET teacher_feedback = 'Cô Hoa sửa lén trực tiếp'
    WHERE id = '${submission101Id}'
    RETURNING id;
  `);
  assert.strictEqual(directUpdateRes.rows.length, 0, 'Cô Hoa không được phép update trực tiếp submission');
  console.log('✅ TEST 14 (PASS): Creator không quản lý lớp (Cô Hoa) KHÔNG THỂ UPDATE trực tiếp bảng academic_submissions qua RLS.');

  // TEST 15: Storage file submission: GV không quản lý lớp KHÔNG ĐỌC ĐƯỢC
  await setAuth(hoaId);
  const hoaStorageCheck = await db.query(`SELECT * FROM storage.objects WHERE bucket_id = 'exercise-submissions' AND name = '${hs101Id}/${submission101Id}/essay_file.png';`);
  assert.strictEqual(hoaStorageCheck.rows.length, 0, 'Cô Hoa không được đọc file submission của Lớp 1A');

  await setAuth(lenId);
  const lenStorageCheck = await db.query(`SELECT * FROM storage.objects WHERE bucket_id = 'exercise-submissions' AND name = '${hs101Id}/${submission101Id}/essay_file.png';`);
  assert.strictEqual(lenStorageCheck.rows.length, 1, 'Thầy Lên (GV hiện tại của 1A) phải đọc được file');
  console.log('✅ TEST 15 (PASS): Storage file submission bảo mật cấp độ lớp: GV không phụ trách lớp bị chặn đọc file private.');

  // TEST 16: Idempotent Reward & Existing Scoring: Chấm lại bài đã graded không cộng đúp sao thưởng
  await setAuth(null);
  // Reset điểm sao HS101 về 20
  await db.exec(`UPDATE public.profiles SET total_stars = 20 WHERE id = '${hs101Id}';`);
  await db.exec(`UPDATE public.academic_submissions SET status = 'pending_manual_grade', reward_applied_at = NULL WHERE id = '${submission101Id}';`);

  await setAuth(lenId);

  // Chấm lần 1: cộng +15 sao -> total_stars = 35
  await db.query(`
    SELECT public.grade_academic_submission(
      '${submission101Id}'::uuid,
      '[{"question_id":"${q2EssayId}","points_earned":5,"teacher_comment":"Chấm lần 1"}]'::jsonb,
      'Lần 1',
      false
    );
  `);
  let stars1 = (await db.query(`SELECT total_stars FROM public.profiles WHERE id = '${hs101Id}';`)).rows[0].total_stars;
  assert.strictEqual(stars1, 35, 'Sau lần chấm 1, tổng sao phải là 35');

  // TEST 16: Strict Workflow Contract: Chấm lần 1 trao thưởng, cố chấm lại khi đã 'graded' bị CHẶN theo contract cũ
  const grade2Res = await db.query(`
    SELECT public.grade_academic_submission(
      '${submission101Id}'::uuid,
      '[{"question_id":"${q2EssayId}","points_earned":5,"teacher_comment":"Chấm lần 2 chỉnh nhận xét"}]'::jsonb,
      'Lần 2 nhận xét bổ sung',
      false
    ) as result;
  `);
  const grade2Json = typeof grade2Res.rows[0].result === 'string' ? JSON.parse(grade2Res.rows[0].result) : grade2Res.rows[0].result;
  assert.strictEqual(grade2Json.success, false, 'Cố chấm lại submission đã graded phải bị từ chối theo contract workflow');
  assert.match(grade2Json.message, /Chỉ được chấm bài nộp ở trạng thái submitted hoặc pending_manual_grade/);
  let stars2 = (await db.query(`SELECT total_stars FROM public.profiles WHERE id = '${hs101Id}';`)).rows[0].total_stars;
  assert.strictEqual(stars2, 35, 'Tổng sao của HS vẫn bảo toàn 35, không bị cộng đúp hay thất thoát');
  console.log('✅ TEST 16 (PASS): Workflow contract được bảo toàn 100%: Chặn chấm lại bài đã graded, bảo đảm toàn vẹn điểm thưởng.');

  await db.close();

  console.log('\n================================================================');
  console.log('🎉 TẤT CẢ 16/16 TEST CASES ĐỀU PASS 100%! HỆ THỐNG ĐÃ ĐƯỢC HARDENING TOÀN DIỆN.');
  console.log('================================================================\n');
}

runHardenedHandoverTests().catch(err => {
  console.error('\n❌ TEST RUN FAILED:', err);
  process.exit(1);
});
