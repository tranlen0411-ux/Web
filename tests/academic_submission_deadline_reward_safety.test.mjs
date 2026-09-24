// tests/academic_submission_deadline_reward_safety.test.mjs
// PGLITE AUTOMATED REGRESSION SUITE: MULTI-ATTEMPT DEADLINE & REWARD SAFETY

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

export async function runDeadlineRewardSafetyTestSuite() {
  console.log('================================================================================');
  console.log('🚀 BẮT ĐẦU KIỂM THỬ PGLITE: DEADLINE RESUBMISSION & REWARD SAFETY (10 GATES)');
  console.log('================================================================================\n');

  const migrationFiles = [
    '20260918000001_academic_submission_image_annotations_phase1.sql',
    '20260918000002_fix_finalize_grading_rpc.sql',
    '20260919000003_harden_finalize_annotation_attachment_validation.sql',
    '20260919000004_harden_student_graded_submission_status.sql',
    '20260924000001_multi_attempt_resubmission_safety.sql',
    '20260924000002_multi_attempt_deadline_reward_safety.sql'
  ];

  const db = new PGlite();

  // 1. Khởi tạo roles và schema nền tảng
  await db.exec(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;

    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
    $$;

    CREATE SCHEMA IF NOT EXISTS app_private;
    CREATE SCHEMA IF NOT EXISTS storage;

    CREATE TABLE IF NOT EXISTS public.profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      full_name TEXT NOT NULL,
      email TEXT UNIQUE,
      role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin', 'parent')),
      grade_level INT DEFAULT 1,
      total_stars INT DEFAULT 0,
      total_coins INT DEFAULT 0,
      student_code TEXT,
      avatar_url TEXT,
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
      status TEXT NOT NULL DEFAULT 'published',
      reward_stars INT DEFAULT 10,
      due_date TIMESTAMPTZ,
      is_global BOOLEAN DEFAULT FALSE,
      max_attempts INT DEFAULT 1,
      teacher_id UUID REFERENCES public.profiles(id),
      class_id UUID REFERENCES public.classes(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.academic_exercise_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      exercise_id UUID NOT NULL REFERENCES public.academic_exercises(id) ON DELETE CASCADE,
      class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      counts_toward_ranking BOOLEAN DEFAULT TRUE,
      CONSTRAINT unique_assignment UNIQUE (exercise_id, class_id)
    );

    CREATE TABLE IF NOT EXISTS public.academic_exercise_questions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      exercise_id UUID NOT NULL REFERENCES public.academic_exercises(id) ON DELETE CASCADE,
      question_number INT NOT NULL,
      question_type TEXT NOT NULL,
      prompt TEXT NOT NULL,
      points NUMERIC(6,2) NOT NULL DEFAULT 1.00,
      options_json JSONB NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS app_private.academic_answer_keys (
      question_id UUID PRIMARY KEY REFERENCES public.academic_exercise_questions(id),
      correct_answer JSONB,
      accepted_answers JSONB,
      case_sensitive BOOLEAN DEFAULT FALSE
    );

    CREATE TABLE IF NOT EXISTS public.academic_submissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      exercise_id UUID NOT NULL REFERENCES public.academic_exercises(id) ON DELETE CASCADE,
      student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      attempt_number INT NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft',
      objective_score NUMERIC(8,2) DEFAULT 0,
      manual_score NUMERIC(8,2) DEFAULT 0,
      total_score NUMERIC(8,2) DEFAULT 0,
      max_score NUMERIC(8,2) DEFAULT 10,
      teacher_feedback TEXT,
      submitted_at TIMESTAMPTZ,
      graded_at TIMESTAMPTZ,
      graded_by UUID REFERENCES public.profiles(id),
      reward_stars_awarded INT DEFAULT 0,
      reward_applied_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT academic_submissions_exercise_student_attempt_key UNIQUE (exercise_id, student_id, attempt_number)
    );

    CREATE TABLE IF NOT EXISTS public.academic_submission_answers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      submission_id UUID NOT NULL REFERENCES public.academic_submissions(id) ON DELETE CASCADE,
      question_id UUID NOT NULL REFERENCES public.academic_exercise_questions(id) ON DELETE CASCADE,
      student_answer_json JSONB NULL,
      file_url TEXT NULL,
      points_earned NUMERIC(8,2) DEFAULT 0,
      is_correct BOOLEAN DEFAULT NULL,
      teacher_comment TEXT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS storage.objects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id TEXT NOT NULL,
      name TEXT NOT NULL,
      owner UUID,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      metadata JSONB
    );
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    ALTER TABLE storage.objects FORCE ROW LEVEL SECURITY;

    CREATE OR REPLACE FUNCTION storage.foldername(name text)
    RETURNS text[]
    LANGUAGE plpgsql
    AS $$
    DECLARE
      parts text[];
    BEGIN
      parts := string_to_array(name, '/');
      IF array_length(parts, 1) > 1 THEN
        RETURN parts[1:array_length(parts, 1) - 1];
      ELSE
        RETURN ARRAY[]::text[];
      END IF;
    END;
    $$;

    CREATE OR REPLACE FUNCTION app_private.is_admin() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
      SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
    $$;

    CREATE OR REPLACE FUNCTION app_private.is_teacher() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
      SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'teacher');
    $$;

    CREATE OR REPLACE FUNCTION app_private.teacher_owns_class(p_class_id UUID) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
      SELECT EXISTS (SELECT 1 FROM public.classes WHERE id = p_class_id AND teacher_id = auth.uid());
    $$;
  `);

  // 2. Chạy lần lượt các migrations
  for (const mFile of migrationFiles) {
    const mPath = path.join(process.cwd(), 'supabase', 'migrations', mFile);
    const mSql = fs.readFileSync(mPath, 'utf8');
    await db.exec(mSql);
    console.log(`- Loaded migration: ${mFile}`);
  }
  console.log('✅ Đã nạp thành công 6 migrations (bao gồm 20260924000002)');

  // 3. Chuẩn bị Fixtures
  const teacherId = '11111111-1111-4111-a111-111111111111';
  const student1Id = '22222222-2222-4222-a222-222222222222';
  const student2Id = '33333333-3333-4333-a333-333333333333';
  const classId = '44444444-4444-4444-a444-444444444444';

  await db.exec(`
    INSERT INTO public.profiles (id, full_name, email, role, total_stars) VALUES
      ('${teacherId}', 'Cô Giáo Thảo', 'teacher@school.edu.vn', 'teacher', 0),
      ('${student1Id}', 'Em Học Sinh 1', 'student1@school.edu.vn', 'student', 0),
      ('${student2Id}', 'Em Học Sinh 2', 'student2@school.edu.vn', 'student', 0);

    INSERT INTO public.classes (id, name, code, grade_level, teacher_id) VALUES
      ('${classId}', 'Lớp 1A', 'CLASS-1A', 1, '${teacherId}');

    INSERT INTO public.class_members (class_id, student_id) VALUES
      ('${classId}', '${student1Id}'),
      ('${classId}', '${student2Id}');
  `);

  // Exercise 1: Past due date (Hết hạn lúc 2 giờ trước), 10 stars, max_attempts = 1
  const ex1Id = '55555555-5555-4555-a555-555555555555';
  await db.exec(`
    INSERT INTO public.academic_exercises (
      id, title, grade_level, subject, status, reward_stars, max_attempts, due_date, class_id, teacher_id
    ) VALUES (
      '${ex1Id}', 'Bài Toán Có Hạn Nộp', 1, 'Toán', 'published', 10, 1, NOW() - INTERVAL '2 hours', '${classId}', '${teacherId}'
    );

    INSERT INTO public.academic_exercise_assignments (exercise_id, class_id) VALUES ('${ex1Id}', '${classId}');

    INSERT INTO public.academic_exercise_questions (id, exercise_id, question_number, question_type, prompt, points, options_json) VALUES
      ('10101010-1010-4010-a010-101010101010', '${ex1Id}', 1, 'single_choice', '1 + 1 = ?', 5, '["2", "3", "4"]'::jsonb),
      ('20202020-2020-4020-a020-202020202020', '${ex1Id}', 2, 'single_choice', '2 + 2 = ?', 5, '["3", "4", "5"]'::jsonb);

    INSERT INTO app_private.academic_answer_keys (question_id, correct_answer) VALUES
      ('10101010-1010-4010-a010-101010101010', '"2"'::jsonb),
      ('20202020-2020-4020-a020-202020202020', '"4"'::jsonb);
  `);

  // Exercise 2: Active (Chưa hết hạn), 10 stars, max_attempts = 2
  const ex2Id = '66666666-6666-4666-a666-666666666666';
  await db.exec(`
    INSERT INTO public.academic_exercises (
      id, title, grade_level, subject, status, reward_stars, max_attempts, due_date, class_id, teacher_id
    ) VALUES (
      '${ex2Id}', 'Bài Toán Tiếng Việt', 1, 'Tiếng Việt', 'published', 10, 2, NOW() + INTERVAL '2 days', '${classId}', '${teacherId}'
    );

    INSERT INTO public.academic_exercise_assignments (exercise_id, class_id) VALUES ('${ex2Id}', '${classId}');

    INSERT INTO public.academic_exercise_questions (id, exercise_id, question_number, question_type, prompt, points, options_json) VALUES
      ('30303030-3030-4030-a030-303030303030', '${ex2Id}', 1, 'single_choice', 'Chọn chữ A', 10, '["A", "B", "C"]'::jsonb);

    INSERT INTO app_private.academic_answer_keys (question_id, correct_answer) VALUES
      ('30303030-3030-4030-a030-303030303030', '"A"'::jsonb);
  `);

  // ===========================================================================
  // GATE 1: NORMAL ATTEMPT AFTER DUE DATE IS BLOCKED
  // ===========================================================================
  console.log('--- GATE 1: NORMAL_ATTEMPT_AFTER_DUE_DATE_BLOCKED ---');
  await db.exec(`SET app.current_user_id = '${student1Id}';`);
  const g1Res = await db.query(`SELECT public.create_or_get_submission_draft('${ex1Id}'::uuid) as r;`);
  const g1 = g1Res.rows[0].r;
  assert.equal(g1.success, false, 'Tạo nháp bài đã quá hạn phải bị từ chối');
  assert.match(g1.message, /quá hạn/i, 'Thông báo phải nêu rõ đã quá hạn');
  console.log('✅ GATE 1 PASS: Học sinh không thể tạo draft mới khi bài tập đã quá hạn');

  // ===========================================================================
  // GATE 2: REVISION_REQUESTED AFTER DUE DATE CAN CREATE DRAFT
  // ===========================================================================
  console.log('\n--- GATE 2: REVISION_AFTER_DUE_DATE_CAN_CREATE_DRAFT ---');
  // Giả lập Student 1 đã từng nộp Attempt 1 trước đó và GV yêu cầu làm lại
  const sub1Ex1Id = '77777777-7777-4777-a777-777777777777';
  await db.exec(`
    INSERT INTO public.academic_submissions (
      id, exercise_id, student_id, attempt_number, status, total_score, objective_score, max_score, teacher_feedback
    ) VALUES (
      '${sub1Ex1Id}', '${ex1Id}', '${student1Id}', 1, 'revision_requested', 5, 5, 10, 'Em làm lại câu 2 nhé!'
    );
  `);

  // Student 1 tạo draft cho Attempt 2
  await db.exec(`SET app.current_user_id = '${student1Id}';`);
  const g2Res = await db.query(`SELECT public.create_or_get_submission_draft('${ex1Id}'::uuid) as r;`);
  const g2 = g2Res.rows[0].r;
  assert.equal(g2.success, true, 'Draft phải được tạo thành công cho revision_requested dù đã qua due_date');
  assert.equal(g2.attempt_number, 2, 'Attempt number phải là 2');
  assert.notEqual(g2.submission_id, sub1Ex1Id, 'Submission ID phải mới');
  const sub2Ex1Id = g2.submission_id;
  console.log('✅ GATE 2 PASS: Học sinh có revision_requested được phép tạo draft Attempt 2 sau due_date');

  // ===========================================================================
  // GATE 3: REVISION_AFTER_DUE_DATE_CAN_SUBMIT
  // ===========================================================================
  console.log('\n--- GATE 3: REVISION_AFTER_DUE_DATE_CAN_SUBMIT ---');
  const answersSub2 = [
    { question_id: '10101010-1010-4010-a010-101010101010', answer: '2', file_url: null },
    { question_id: '20202020-2020-4020-a020-202020202020', answer: '4', file_url: null }
  ];
  await db.exec(`SET app.current_user_id = '${student1Id}';`);
  const g3Res = await db.query(`
    SELECT public.submit_academic_exercise('${ex1Id}'::uuid, '${JSON.stringify(answersSub2)}'::jsonb, false) as r;
  `);
  const g3 = g3Res.rows[0].r;
  assert.equal(g3.success, true, 'Nộp bài Attempt 2 sau due_date thành công');
  assert.equal(g3.attempt_number, 2);
  assert.equal(g3.status, 'graded');
  assert.equal(g3.objective_score, 10);
  console.log('✅ GATE 3 PASS: Học sinh nộp thành công Attempt 2 sau due_date và được tự động chấm');

  // ===========================================================================
  // GATE 4: OTHER_STATUS_AFTER_DUE_DATE_BLOCKED
  // ===========================================================================
  console.log('\n--- GATE 4: OTHER_STATUS_AFTER_DUE_DATE_BLOCKED ---');
  // Sau khi Attempt 2 đã nộp và đạt status = 'graded', thử tạo tiếp Attempt 3 sau due_date
  const g4Res = await db.query(`SELECT public.create_or_get_submission_draft('${ex1Id}'::uuid) as r;`);
  const g4 = g4Res.rows[0].r;
  assert.equal(g4.success, false, 'Không được tạo attempt mới khi status gần nhất là graded sau due_date');
  console.log('✅ GATE 4 PASS: Trạng thái graded sau due_date bị chặn không cho tạo draft tiếp');

  // ===========================================================================
  // GATE 5: REVISION_ONLY_OWN_STUDENT_EXERCISE (Bảo vệ cô lập giữa các học sinh)
  // ===========================================================================
  console.log('\n--- GATE 5: REVISION_ONLY_OWN_STUDENT_EXERCISE ---');
  // Student 2 không có bài làm nào trước đó, thử tạo draft cho Exercise 1 đã hết hạn
  await db.exec(`SET app.current_user_id = '${student2Id}';`);
  const g5Res = await db.query(`SELECT public.create_or_get_submission_draft('${ex1Id}'::uuid) as r;`);
  const g5 = g5Res.rows[0].r;
  assert.equal(g5.success, false, 'Student 2 không được thừa hưởng revision của Student 1');
  console.log('✅ GATE 5 PASS: Revision bypass due_date hoàn toàn cô lập theo đúng student_id');

  // ===========================================================================
  // GATE 6: REVISION_REQUESTED_ATTEMPT_1_NO_STARS & ATTEMPT_2_GRADED_AWARDS_ONCE
  // ===========================================================================
  console.log('\n--- GATE 6: REVISION_REQUESTED_ATTEMPT_1_NO_STARS & ATTEMPT_2_AWARDS_ONCE ---');
  // Xem lại Student 1 ở Exercise 1: Attempt 1 là revision_requested (chưa cộng sao), Attempt 2 graded (cộng sao lần đầu)
  const p1Res = await db.query(`SELECT total_stars FROM public.profiles WHERE id = '${student1Id}';`);
  assert.equal(p1Res.rows[0].total_stars, 10, 'Student 1 phải nhận đúng 10 sao sau khi hoàn thành Attempt 2');
  console.log('✅ GATE 6 PASS: Attempt 1 (revision_requested) không có sao, Attempt 2 (graded) nhận đúng 10 sao');

  // ===========================================================================
  // GATE 7: ATTEMPT_1_GRADED_AWARDS_STARS_ONCE
  // ===========================================================================
  console.log('\n--- GATE 7: ATTEMPT_1_GRADED_AWARDS_STARS_ONCE ---');
  // Sử dụng Exercise 2 (chưa hết hạn, max_attempts = 2): Student 1 làm Attempt 1 được 10/10
  await db.exec(`SET app.current_user_id = '${student1Id}';`);
  const draftEx2Att1 = await db.query(`SELECT public.create_or_get_submission_draft('${ex2Id}'::uuid) as r;`);
  const ansEx2 = [{ question_id: '30303030-3030-4030-a030-303030303030', answer: 'A', file_url: null }];
  
  const submitEx2Att1 = await db.query(`
    SELECT public.submit_academic_exercise('${ex2Id}'::uuid, '${JSON.stringify(ansEx2)}'::jsonb, false) as r;
  `);
  assert.equal(submitEx2Att1.rows[0].r.success, true);
  assert.equal(submitEx2Att1.rows[0].r.status, 'graded');
  assert.equal(submitEx2Att1.rows[0].r.reward_stars_awarded, 10);

  const p1AfterEx2Att1 = await db.query(`SELECT total_stars FROM public.profiles WHERE id = '${student1Id}';`);
  assert.equal(p1AfterEx2Att1.rows[0].total_stars, 20, 'Tổng sao phải là 10 (Ex1) + 10 (Ex2 Att1) = 20');
  console.log('✅ GATE 7 PASS: Attempt 1 của Exercise 2 cộng đúng 10 sao');

  // ===========================================================================
  // GATE 8: ATTEMPT_2_GRADED_SAME_EXERCISE_NO_DUPLICATE_STARS
  // ===========================================================================
  console.log('\n--- GATE 8: ATTEMPT_2_GRADED_SAME_EXERCISE_NO_DUPLICATE_STARS ---');
  // Vì Exercise 2 có max_attempts = 2, Student 1 làm lại Attempt 2
  const draftEx2Att2 = await db.query(`SELECT public.create_or_get_submission_draft('${ex2Id}'::uuid) as r;`);
  assert.equal(draftEx2Att2.rows[0].r.success, true);
  assert.equal(draftEx2Att2.rows[0].r.attempt_number, 2);

  const submitEx2Att2 = await db.query(`
    SELECT public.submit_academic_exercise('${ex2Id}'::uuid, '${JSON.stringify(ansEx2)}'::jsonb, false) as r;
  `);
  const subEx2Att2Result = submitEx2Att2.rows[0].r;
  assert.equal(subEx2Att2Result.success, true);
  assert.equal(subEx2Att2Result.status, 'graded');
  assert.equal(subEx2Att2Result.reward_stars_awarded, 0, 'Attempt 2 KHÔNG được thưởng thêm sao');

  const p1AfterEx2Att2 = await db.query(`SELECT total_stars FROM public.profiles WHERE id = '${student1Id}';`);
  assert.equal(p1AfterEx2Att2.rows[0].total_stars, 20, 'Tổng sao VẪN PHẢI LÀ 20, TUYỆT ĐỐI KHÔNG TĂNG LÊN 30');
  console.log('✅ GATE 8 PASS: Attempt 2 của cùng 1 bài tập chấm graded thành công nhưng KHÔNG bị nhân đôi sao');

  // ===========================================================================
  // GATE 9: TEACHER FINAL GRADING ANNOTATION REWARD GUARD
  // ===========================================================================
  console.log('\n--- GATE 9: TEACHER FINAL GRADING ANNOTATION REWARD GUARD ---');
  // Tạo Exercise 3 có câu tự luận để kiểm tra finalize_academic_submission_grading_with_annotations
  const ex3Id = '88888888-8888-4888-a888-888888888888';
  const qEssayId = '99999999-9999-4999-a999-999999999999';
  await db.exec(`
    INSERT INTO public.academic_exercises (
      id, title, grade_level, subject, status, reward_stars, max_attempts, due_date, class_id, teacher_id
    ) VALUES (
      '${ex3Id}', 'Bài Vẽ Tự Luận', 1, 'Mỹ Thuật', 'published', 10, 2, NOW() + INTERVAL '1 day', '${classId}', '${teacherId}'
    );
    INSERT INTO public.academic_exercise_assignments (exercise_id, class_id) VALUES ('${ex3Id}', '${classId}');
    INSERT INTO public.academic_exercise_questions (id, exercise_id, question_number, question_type, prompt, points) VALUES
      ('${qEssayId}', '${ex3Id}', 1, 'essay', 'Viết đoạn văn ngắn', 10);
  `);

  // Student 1 nộp Attempt 1 -> pending_manual_grade
  await db.exec(`SET app.current_user_id = '${student1Id}';`);
  const draftEx3Att1 = await db.query(`SELECT public.create_or_get_submission_draft('${ex3Id}'::uuid) as r;`);
  const sub3Att1Id = draftEx3Att1.rows[0].r.submission_id;
  const ansEx3 = [{ question_id: qEssayId, answer: 'Bài làm văn của em', file_url: null }];
  await db.query(`SELECT public.submit_academic_exercise('${ex3Id}'::uuid, '${JSON.stringify(ansEx3)}'::jsonb, false);`);

  // Teacher chấm Attempt 1 -> 10 điểm -> graded -> nhận 10 sao
  await db.exec(`SET app.current_user_id = '${teacherId}';`);
  const manualGrades1 = [{ question_id: qEssayId, points_earned: 10, teacher_comment: 'Tốt' }];
  const grade1Res = await db.query(`
    SELECT public.finalize_academic_submission_grading_with_annotations(
      '${sub3Att1Id}'::uuid, '${JSON.stringify(manualGrades1)}'::jsonb, '[]'::jsonb, 'Bài viết xuất sắc', false
    ) as r;
  `);
  assert.equal(grade1Res.rows[0].r.reward_stars_awarded, 10);

  const p1AfterEx3Att1 = await db.query(`SELECT total_stars FROM public.profiles WHERE id = '${student1Id}';`);
  assert.equal(p1AfterEx3Att1.rows[0].total_stars, 30, 'Tổng sao tăng lên 30 (Ex1: 10 + Ex2: 10 + Ex3 Att1: 10)');

  // Student 1 làm lại Attempt 2 của Exercise 3
  await db.exec(`SET app.current_user_id = '${student1Id}';`);
  const draftEx3Att2 = await db.query(`SELECT public.create_or_get_submission_draft('${ex3Id}'::uuid) as r;`);
  const sub3Att2Id = draftEx3Att2.rows[0].r.submission_id;
  await db.query(`SELECT public.submit_academic_exercise('${ex3Id}'::uuid, '${JSON.stringify(ansEx3)}'::jsonb, false);`);

  // Teacher chấm Attempt 2 -> 10 điểm -> graded
  await db.exec(`SET app.current_user_id = '${teacherId}';`);
  const grade2Res = await db.query(`
    SELECT public.finalize_academic_submission_grading_with_annotations(
      '${sub3Att2Id}'::uuid, '${JSON.stringify(manualGrades1)}'::jsonb, '[]'::jsonb, 'Vẫn xuất sắc', false
    ) as r;
  `);
  assert.equal(grade2Res.rows[0].r.reward_stars_awarded, 0, 'GV chấm Attempt 2 không được phát thêm sao');

  const p1AfterEx3Att2 = await db.query(`SELECT total_stars FROM public.profiles WHERE id = '${student1Id}';`);
  assert.equal(p1AfterEx3Att2.rows[0].total_stars, 30, 'Tổng sao VẪN PHẢI LÀ 30, KHÔNG ĐƯỢC TĂNG');
  console.log('✅ GATE 9 PASS: finalize_academic_submission_grading_with_annotations bảo vệ chống cộng sao trùng lặp');

  // ===========================================================================
  // GATE 10: DIFFERENT_EXERCISE_CAN_AWARD_STARS_NORMALLY
  // ===========================================================================
  console.log('\n--- GATE 10: DIFFERENT_EXERCISE_CAN_AWARD_STARS_NORMALLY ---');
  // Student 2 làm Exercise 2 lần đầu tiên
  await db.exec(`SET app.current_user_id = '${student2Id}';`);
  const draftS2Ex2 = await db.query(`SELECT public.create_or_get_submission_draft('${ex2Id}'::uuid) as r;`);
  const submitS2Ex2 = await db.query(`
    SELECT public.submit_academic_exercise('${ex2Id}'::uuid, '${JSON.stringify(ansEx2)}'::jsonb, false) as r;
  `);
  assert.equal(submitS2Ex2.rows[0].r.reward_stars_awarded, 10);
  const p2Res = await db.query(`SELECT total_stars FROM public.profiles WHERE id = '${student2Id}';`);
  assert.equal(p2Res.rows[0].total_stars, 10, 'Student 2 nhận 10 sao bình thường cho Exercise 2');
  console.log('✅ GATE 10 PASS: Bài tập khác / học sinh khác nhận sao độc lập bình thường');

  // ===========================================================================
  // GATE 11: CONCURRENT_REWARD_SAME_STUDENT_EXERCISE_SINGLE_WINNER
  // ===========================================================================
  console.log('\n--- GATE 11: CONCURRENT_REWARD_SAME_STUDENT_EXERCISE_SINGLE_WINNER ---');
  // Tạo Exercise 4 với 1 câu tự luận
  const ex4Id = '44444444-1111-4444-a444-444444444444';
  const q4Id = '44444444-2222-4444-a444-444444444444';
  await db.exec(`
    INSERT INTO public.academic_exercises (
      id, title, grade_level, subject, status, reward_stars, max_attempts, due_date, class_id, teacher_id
    ) VALUES (
      '${ex4Id}', 'Bài Kiểm Tra Đồng Thời', 1, 'Toán', 'published', 15, 2, NOW() + INTERVAL '1 day', '${classId}', '${teacherId}'
    );
    INSERT INTO public.academic_exercise_assignments (exercise_id, class_id) VALUES ('${ex4Id}', '${classId}');
    INSERT INTO public.academic_exercise_questions (id, exercise_id, question_number, question_type, prompt, points) VALUES
      ('${q4Id}', '${ex4Id}', 1, 'essay', 'Giải toán đồng thời', 10);
  `);

  // Tạo 2 submissions cho cùng student2Id + ex4Id (Attempt 1 và Attempt 2) đều ở status pending_manual_grade
  const sub4Att1Id = '44444444-3333-4444-a444-444444444441';
  const sub4Att2Id = '44444444-3333-4444-a444-444444444442';
  await db.exec(`
    INSERT INTO public.academic_submissions (
      id, exercise_id, student_id, attempt_number, status, total_score, objective_score, max_score
    ) VALUES 
      ('${sub4Att1Id}', '${ex4Id}', '${student2Id}', 1, 'pending_manual_grade', 0, 0, 10),
      ('${sub4Att2Id}', '${ex4Id}', '${student2Id}', 2, 'pending_manual_grade', 0, 0, 10);
    INSERT INTO public.academic_submission_answers (submission_id, question_id, student_answer_json, points_earned) VALUES
      ('${sub4Att1Id}', '${q4Id}', '"Lời giải 1"'::jsonb, 0),
      ('${sub4Att2Id}', '${q4Id}', '"Lời giải 2"'::jsonb, 0);
  `);

  const p2StarsBefore = (await db.query(`SELECT total_stars FROM public.profiles WHERE id = '${student2Id}';`)).rows[0].total_stars;

  // Giáo viên chấm cả Attempt 1 và Attempt 2 (giả lập serialization qua advisory lock)
  await db.exec(`SET app.current_user_id = '${teacherId}';`);
  const manualGradesConcurrent = [{ question_id: q4Id, points_earned: 10, teacher_comment: 'Xuất sắc' }];

  const resGradeAtt1 = await db.query(`
    SELECT public.finalize_academic_submission_grading_with_annotations(
      '${sub4Att1Id}'::uuid, '${JSON.stringify(manualGradesConcurrent)}'::jsonb, '[]'::jsonb, 'Chấm att1', false
    ) as r;
  `);

  const resGradeAtt2 = await db.query(`
    SELECT public.finalize_academic_submission_grading_with_annotations(
      '${sub4Att2Id}'::uuid, '${JSON.stringify(manualGradesConcurrent)}'::jsonb, '[]'::jsonb, 'Chấm att2', false
    ) as r;
  `);

  // Kiểm tra 3 điều kiện bắt buộc:
  // 1. both grading operations may complete (cả 2 đều success và graded)
  assert.equal(resGradeAtt1.rows[0].r.success, true, 'Chấm Attempt 1 phải thành công');
  assert.equal(resGradeAtt2.rows[0].r.success, true, 'Chấm Attempt 2 phải thành công');

  // 2. Exactly one winner nhận sao
  const starsAwarded1 = resGradeAtt1.rows[0].r.reward_stars_awarded;
  const starsAwarded2 = resGradeAtt2.rows[0].r.reward_stars_awarded;
  assert.equal(starsAwarded1 + starsAwarded2, 15, 'Chỉ duy nhất 1 lần nhận trọn 15 sao');
  assert.ok((starsAwarded1 === 15 && starsAwarded2 === 0) || (starsAwarded1 === 0 && starsAwarded2 === 15));

  // 3. rewards applied rows = 1
  const rewardRows = await db.query(`
    SELECT COUNT(*) as c FROM public.academic_submissions 
    WHERE exercise_id = '${ex4Id}' AND student_id = '${student2Id}' AND reward_applied_at IS NOT NULL;
  `);
  assert.equal(Number(rewardRows.rows[0].c), 1, 'Chỉ đúng 1 dòng submission được ghi nhận reward_applied_at');

  // 4. profiles.total_stars increment = exactly once
  const p2StarsAfter = (await db.query(`SELECT total_stars FROM public.profiles WHERE id = '${student2Id}';`)).rows[0].total_stars;
  assert.equal(p2StarsAfter, p2StarsBefore + 15, 'Tổng sao của học sinh chỉ được cộng đúng 1 lần 15 sao');

  console.log('✅ GATE 11 PASS: CONCURRENT_REWARD_SAME_STUDENT_EXERCISE_SINGLE_WINNER (Single Winner, exactly 1 reward row, exactly once profile star increment)');

  console.log('\n================================================================================');
  console.log('🎉 TOÀN BỘ 11 GATES VỀ DEADLINE & REWARD CONCURRENCY SAFETY ĐỀU PASS 100%');
  console.log('================================================================================\n');
}

runDeadlineRewardSafetyTestSuite().catch(err => {
  console.error('❌ REGRESSION TEST FAILED:', err);
  process.exit(1);
});
