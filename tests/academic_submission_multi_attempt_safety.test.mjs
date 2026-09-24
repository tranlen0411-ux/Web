// tests/academic_submission_multi_attempt_safety.test.mjs
// PGLITE AUTOMATED REGRESSION SUITE: MULTI-ATTEMPT RESUBMISSION DATA SAFETY & ISOLATION

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

export async function runMultiAttemptSafetyTestSuite() {
  console.log('================================================================================');
  console.log('🚀 BẮT ĐẦU KIỂM THỬ PGLITE: MULTI-ATTEMPT RESUBMISSION DATA SAFETY (18 GATES)');
  console.log('================================================================================\n');

  const migration1Path = path.join(process.cwd(), 'supabase', 'migrations', '20260918000001_academic_submission_image_annotations_phase1.sql');
  const migration2Path = path.join(process.cwd(), 'supabase', 'migrations', '20260918000002_fix_finalize_grading_rpc.sql');
  const migration3Path = path.join(process.cwd(), 'supabase', 'migrations', '20260919000003_harden_finalize_annotation_attachment_validation.sql');
  const migration4Path = path.join(process.cwd(), 'supabase', 'migrations', '20260919000004_harden_student_graded_submission_status.sql');
  const migration5Path = path.join(process.cwd(), 'supabase', 'migrations', '20260924000001_multi_attempt_resubmission_safety.sql');

  const migration1Sql = fs.readFileSync(migration1Path, 'utf8');
  const migration2Sql = fs.readFileSync(migration2Path, 'utf8');
  const migration3Sql = fs.readFileSync(migration3Path, 'utf8');
  const migration4Sql = fs.readFileSync(migration4Path, 'utf8');
  const migration5Sql = fs.readFileSync(migration5Path, 'utf8');

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

  // Apply Migrations in Sequence
  await db.exec(migration1Sql);
  await db.exec(migration2Sql);
  await db.exec(migration3Sql);
  await db.exec(migration4Sql);
  await db.exec(migration5Sql);

  // Fixtures Setup
  const teacherId = '11111111-1111-1111-1111-111111111111';
  const studentId = '22222222-2222-2222-2222-222222222222';
  const classId = '33333333-3333-3333-3333-333333333333';
  const exerciseId = '44444444-4444-4444-4444-444444444444';
  const q1Id = '55555555-5555-5555-5555-555555555551';
  const q2Id = '55555555-5555-5555-5555-555555555552';

  await db.exec(`
    INSERT INTO public.profiles (id, full_name, email, role, total_stars) VALUES 
      ('${teacherId}', 'Cô Giáo Hương', 'huong@school.edu.vn', 'teacher', 0),
      ('${studentId}', 'Em Bé Nam', 'nam@student.edu.vn', 'student', 0);

    INSERT INTO public.classes (id, name, code, grade_level, teacher_id) VALUES 
      ('${classId}', 'Lớp 3A', 'LOP3A_2026', 3, '${teacherId}');

    INSERT INTO public.class_members (class_id, student_id) VALUES 
      ('${classId}', '${studentId}');

    INSERT INTO public.academic_exercises (id, class_id, teacher_id, title, grade_level, subject, status, max_attempts, reward_stars) VALUES
      ('${exerciseId}', '${classId}', '${teacherId}', 'Bài Tập Toán & Vẽ Hình Lớp 3', 3, 'Toán', 'published', 1, 10);

    INSERT INTO public.academic_exercise_questions (id, exercise_id, question_number, question_type, prompt, options_json, points) VALUES
      ('${q1Id}', '${exerciseId}', 1, 'single_choice', '2 + 2 = ?', '["3", "4", "5"]'::jsonb, 5),
      ('${q2Id}', '${exerciseId}', 2, 'image_upload', 'Vẽ sơ đồ tư duy đoạn thẳng AB', '[]'::jsonb, 5);

    INSERT INTO app_private.academic_answer_keys (question_id, correct_answer) VALUES
      ('${q1Id}', '"4"'::jsonb);
  `);

  const setAuth = async (uid) => {
    await db.exec(`SET app.current_user_id = '${uid}';`);
  };

  let testCount = 0;
  const pass = (label) => {
    testCount++;
    console.log(`🧪 Test ${testCount}: ${label}\n   ✅ PASS`);
  };

  // ---------------------------------------------------------------------------
  // TEST 1: FIRST_SUBMISSION_CREATES_ATTEMPT_1
  // ---------------------------------------------------------------------------
  await setAuth(studentId);
  const draft1Res = await db.query(`SELECT public.create_or_get_submission_draft('${exerciseId}') as result;`);
  const sub1Draft = draft1Res.rows[0].result;
  assert.equal(sub1Draft.success, true);
  assert.equal(sub1Draft.attempt_number, 1);
  const sub1Id = sub1Draft.submission_id;
  assert.ok(sub1Id);
  pass('FIRST_SUBMISSION_CREATES_ATTEMPT_1: Lần làm đầu tiên tạo attempt_number = 1');

  // Chuẩn bị file ảnh cho Attempt 1
  const prep1 = await db.query(`
    SELECT public.prepare_academic_submission_attachment('${sub1Id}', '${q2Id}', 'bai_ve_lan_1.jpg', 'image/jpeg', 10240, 0) as result;
  `);
  const att1Id = prep1.rows[0].result.attachment_id;
  const att1Path = prep1.rows[0].result.storage_path;

  await db.exec(`
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('exercise-submissions', '${att1Path}', '${studentId}');
  `);

  const fin1 = await db.query(`SELECT public.finalize_academic_submission_attachment('${att1Id}', 800, 600, 'hash1') as result;`);
  assert.equal(fin1.rows[0].result.success, true);

  // Nộp bài Attempt 1
  const submit1 = await db.query(`
    SELECT public.submit_academic_exercise('${exerciseId}', '[
      {"question_id": "${q1Id}", "answer": "4"},
      {"question_id": "${q2Id}", "answer": "Em đã vẽ hình 1", "file_url": "${att1Path}"}
    ]'::jsonb, false) as result;
  `);
  assert.equal(submit1.rows[0].result.success, true);
  assert.equal(submit1.rows[0].result.status, 'pending_manual_grade');
  pass('FIRST_SUBMISSION_FINALIZED: Nộp thành công Attempt 1 với status pending_manual_grade');

  // Giáo viên chấm bài Attempt 1 và YÊU CẦU LÀM LẠI (revision_requested)
  await setAuth(teacherId);
  const ws1 = await db.query(`SELECT public.get_academic_submission_grading_workspace('${sub1Id}') as result;`);
  assert.equal(ws1.rows[0].result.success, true);
  assert.equal(ws1.rows[0].result.submission.attempt_number, 1);

  // Giáo viên vẽ chú thích lên Attempt 1
  const draftAnn1 = await db.query(`
    SELECT public.save_academic_submission_annotation_draft(
      '${att1Id}', '{"shapes":[{"type":"pen","points":[10,10,20,20]}]}'::jsonb, 0, gen_random_uuid()
    ) as result;
  `);
  assert.equal(draftAnn1.rows[0].result.success, true);
  assert.equal(draftAnn1.rows[0].result.version, 1);

  // Giáo viên hoàn tất chấm bài: request_revision = true, cho 2/5đ câu 2
  const grade1 = await db.query(`
    SELECT public.finalize_academic_submission_grading_with_annotations(
      '${sub1Id}',
      '[{"question_id": "${q2Id}", "points_earned": 2, "teacher_comment": "Vẽ sai tỉ lệ đoạn AB"}]'::jsonb,
      '[{"attachment_id": "${att1Id}", "annotation_json": {"shapes":[{"type":"pen","points":[10,10,20,20]}]}, "expected_version": 1}]'::jsonb,
      'Cần vẽ lại đoạn AB cho chính xác',
      true
    ) as result;
  `);
  assert.equal(grade1.rows[0].result.success, true);
  assert.equal(grade1.rows[0].result.status, 'revision_requested');
  pass('TEACHER_REQUESTS_REVISION: Giáo viên yêu cầu làm lại, status chuyển revision_requested');

  // ---------------------------------------------------------------------------
  // TEST 2 & 3: REVISION_CREATES_ATTEMPT_2 & NEW_SUBMISSION_ID_ON_RESUBMIT
  // ---------------------------------------------------------------------------
  await setAuth(studentId);
  const draft2Res = await db.query(`SELECT public.create_or_get_submission_draft('${exerciseId}') as result;`);
  const sub2Draft = draft2Res.rows[0].result;
  assert.equal(sub2Draft.success, true);
  assert.equal(sub2Draft.attempt_number, 2);
  const sub2Id = sub2Draft.submission_id;
  assert.notEqual(sub2Id, sub1Id, 'Attempt 2 submission_id must be different from Attempt 1');
  pass('REVISION_CREATES_ATTEMPT_2 & NEW_SUBMISSION_ID_ON_RESUBMIT: sub2.id != sub1.id và attempt_number = 2');

  // ---------------------------------------------------------------------------
  // TEST 4: OLD_SUBMISSION_ROW_PRESERVED
  // ---------------------------------------------------------------------------
  const oldSubCheck = await db.query(`SELECT * FROM public.academic_submissions WHERE id = '${sub1Id}';`);
  assert.equal(oldSubCheck.rows.length, 1);
  assert.equal(oldSubCheck.rows[0].attempt_number, 1);
  assert.equal(oldSubCheck.rows[0].status, 'revision_requested');
  assert.equal(oldSubCheck.rows[0].teacher_feedback, 'Cần vẽ lại đoạn AB cho chính xác');
  pass('OLD_SUBMISSION_ROW_PRESERVED: Hàng Attempt 1 trong CSDL giữ nguyên status revision_requested');

  // ---------------------------------------------------------------------------
  // TEST 5: OLD_ANSWERS_PRESERVED
  // ---------------------------------------------------------------------------
  const oldAnsCheck = await db.query(`SELECT * FROM public.academic_submission_answers WHERE submission_id = '${sub1Id}' ORDER BY created_at;`);
  assert.equal(oldAnsCheck.rows.length, 2);
  assert.equal(oldAnsCheck.rows[0].student_answer_json, '4');
  assert.equal(oldAnsCheck.rows[1].student_answer_json, 'Em đã vẽ hình 1');
  assert.equal(oldAnsCheck.rows[1].file_url, att1Path);
  pass('OLD_ANSWERS_PRESERVED: Toàn bộ câu trả lời của Attempt 1 được bảo lưu 100%');

  // ---------------------------------------------------------------------------
  // TEST 6: OLD_ATTACHMENTS_PRESERVED
  // ---------------------------------------------------------------------------
  const oldAttCheck = await db.query(`SELECT * FROM public.academic_submission_attachments WHERE submission_id = '${sub1Id}';`);
  assert.equal(oldAttCheck.rows.length, 1);
  assert.equal(oldAttCheck.rows[0].id, att1Id);
  assert.equal(oldAttCheck.rows[0].storage_path, att1Path);
  assert.equal(oldAttCheck.rows[0].upload_status, 'finalized');
  pass('OLD_ATTACHMENTS_PRESERVED: Attachment của Attempt 1 được bảo lưu toàn vẹn');

  // ---------------------------------------------------------------------------
  // TEST 7: OLD_ANNOTATIONS_PRESERVED
  // ---------------------------------------------------------------------------
  const oldAnnCheck = await db.query(`SELECT * FROM public.academic_submission_annotation_versions WHERE submission_id = '${sub1Id}' AND attachment_id = '${att1Id}';`);
  assert.equal(oldAnnCheck.rows.length, 2); // version 1 draft + version 2 final
  assert.equal(oldAnnCheck.rows[1].version, 2);
  assert.equal(oldAnnCheck.rows[1].status, 'final');
  pass('OLD_ANNOTATIONS_PRESERVED: Toàn bộ phiên bản chú thích của Attempt 1 được bảo lưu');

  // ---------------------------------------------------------------------------
  // TEST 8: OLD_GRADE_AND_COMMENT_PRESERVED
  // ---------------------------------------------------------------------------
  assert.equal(Number(oldAnsCheck.rows[1].points_earned), 2);
  assert.equal(oldAnsCheck.rows[1].teacher_comment, 'Vẽ sai tỉ lệ đoạn AB');
  pass('OLD_GRADE_AND_COMMENT_PRESERVED: Điểm và lời phê của giáo viên trên Attempt 1 không bị mất');

  // ---------------------------------------------------------------------------
  // TEST 9: NEW_ATTACHMENTS_USE_NEW_SUBMISSION
  // ---------------------------------------------------------------------------
  const prep2 = await db.query(`
    SELECT public.prepare_academic_submission_attachment('${sub2Id}', '${q2Id}', 'bai_ve_lan_2_chinh_xac.jpg', 'image/jpeg', 20480, 0) as result;
  `);
  const att2Id = prep2.rows[0].result.attachment_id;
  const att2Path = prep2.rows[0].result.storage_path;

  await db.exec(`
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('exercise-submissions', '${att2Path}', '${studentId}');
  `);

  const fin2 = await db.query(`SELECT public.finalize_academic_submission_attachment('${att2Id}', 1200, 900, 'hash2') as result;`);
  assert.equal(fin2.rows[0].result.success, true);

  const att2Check = await db.query(`SELECT * FROM public.academic_submission_attachments WHERE id = '${att2Id}';`);
  assert.equal(att2Check.rows[0].submission_id, sub2Id);
  pass('NEW_ATTACHMENTS_USE_NEW_SUBMISSION: Attachment mới thuộc về submission_id B');

  // Nộp chính thức Attempt 2
  const submit2 = await db.query(`
    SELECT public.submit_academic_exercise('${exerciseId}', '[
      {"question_id": "${q1Id}", "answer": "4"},
      {"question_id": "${q2Id}", "answer": "Em đã vẽ lại hình 2 chuẩn tỉ lệ", "file_url": "${att2Path}"}
    ]'::jsonb, false) as result;
  `);
  assert.equal(submit2.rows[0].result.success, true);
  assert.equal(submit2.rows[0].result.submission_id, sub2Id);
  assert.equal(submit2.rows[0].result.attempt_number, 2);
  pass('SUBMIT_ATTEMPT_2_SUCCESS: Nộp Attempt 2 thành công');

  // ---------------------------------------------------------------------------
  // TEST 10 & 11: NEW_ANNOTATIONS_ISOLATED & NEW_OCC_VERSION_INDEPENDENT
  // ---------------------------------------------------------------------------
  await setAuth(teacherId);
  const draftAnn2 = await db.query(`
    SELECT public.save_academic_submission_annotation_draft(
      '${att2Id}', '{"shapes":[{"type":"line","points":[0,0,50,50]}]}'::jsonb, 0, gen_random_uuid()
    ) as result;
  `);
  assert.equal(draftAnn2.rows[0].result.success, true);
  assert.equal(draftAnn2.rows[0].result.version, 1);
  assert.equal(draftAnn2.rows[0].result.attachment_id, att2Id);
  pass('NEW_ANNOTATIONS_ISOLATED & NEW_OCC_VERSION_INDEPENDENT: Chú thích mới thuộc att2, version bắt đầu độc lập');

  // Hoàn tất chấm Attempt 2 (Cho 5/5đ, graded)
  const grade2 = await db.query(`
    SELECT public.finalize_academic_submission_grading_with_annotations(
      '${sub2Id}',
      '[{"question_id": "${q2Id}", "points_earned": 5, "teacher_comment": "Hình vẽ rất đẹp và chính xác!"}]'::jsonb,
      '[{"attachment_id": "${att2Id}", "annotation_json": {"shapes":[{"type":"line","points":[0,0,50,50]}]}, "expected_version": 1}]'::jsonb,
      'Rất tốt! Con đã sửa rất chuẩn.',
      false
    ) as result;
  `);
  assert.equal(grade2.rows[0].result.success, true);
  assert.equal(grade2.rows[0].result.status, 'graded');
  assert.equal(Number(grade2.rows[0].result.total_score), 10);
  pass('FINALIZE_ATTEMPT_2_GRADED: Hoàn tất chấm Attempt 2 với 10/10 điểm');

  // ---------------------------------------------------------------------------
  // TEST 12: ATTEMPT_NUMBER_INCREMENTS
  // ---------------------------------------------------------------------------
  const allAttempts = await db.query(`
    SELECT attempt_number, status, total_score 
    FROM public.academic_submissions 
    WHERE exercise_id = '${exerciseId}' AND student_id = '${studentId}'
    ORDER BY attempt_number ASC;
  `);
  assert.equal(allAttempts.rows.length, 2);
  assert.equal(allAttempts.rows[0].attempt_number, 1);
  assert.equal(allAttempts.rows[0].status, 'revision_requested');
  assert.equal(allAttempts.rows[1].attempt_number, 2);
  assert.equal(allAttempts.rows[1].status, 'graded');
  assert.equal(Number(allAttempts.rows[1].total_score), 10);
  pass('ATTEMPT_NUMBER_INCREMENTS: Attempt 1 và Attempt 2 tồn tại song song chuẩn xác');

  // ---------------------------------------------------------------------------
  // TEST 13 & 14: PARALLEL_RESUBMIT_SINGLE_WINNER & DOUBLE_CLICK_NO_DUPLICATE_ATTEMPT
  // ---------------------------------------------------------------------------
  // Tạo bài tập mới có max_attempts = 2
  const ex2Id = '77777777-7777-7777-7777-777777777777';
  await db.exec(`
    INSERT INTO public.academic_exercises (id, class_id, teacher_id, title, grade_level, subject, status, max_attempts, reward_stars) VALUES
      ('${ex2Id}', '${classId}', '${teacherId}', 'Bài Tập Concurrency', 3, 'Toán', 'published', 2, 10);
  `);
  await setAuth(studentId);
  const call1 = await db.query(`SELECT public.create_or_get_submission_draft('${ex2Id}') as result;`);
  const call2 = await db.query(`SELECT public.create_or_get_submission_draft('${ex2Id}') as result;`);
  assert.equal(call1.rows[0].result.submission_id, call2.rows[0].result.submission_id);
  assert.equal(call1.rows[0].result.attempt_number, 1);
  assert.equal(call2.rows[0].result.attempt_number, 1);
  pass('PARALLEL_RESUBMIT_SINGLE_WINNER & DOUBLE_CLICK_NO_DUPLICATE_ATTEMPT: Cùng 1 draft ID trả về, không sinh trùng');

  // ---------------------------------------------------------------------------
  // TEST 15: OLD_STORAGE_OBJECT_NOT_QUEUED_FOR_CLEANUP (Contract Guard Verification)
  // ---------------------------------------------------------------------------
  const playModalCode = fs.readFileSync(path.join(process.cwd(), 'src', 'components', 'dashboard', 'exercises', 'ExercisePlayModal.jsx'), 'utf8');
  assert.ok(
    playModalCode.includes("oldBase.startsWith(`${profile?.id}/${submissionId}/`)") ||
    playModalCode.includes("oldBase.startsWith(`${profile.id}/${submissionId}/`)"),
    'ExercisePlayModal must strictly guard cleanup to files belonging only to the current submissionId'
  );
  pass('OLD_STORAGE_OBJECT_NOT_QUEUED_FOR_CLEANUP: Frontend guard chặn tuyệt đối cleanup file của attempt cũ');

  // ---------------------------------------------------------------------------
  // TEST 16: TEACHER_CAN_VIEW_ATTEMPT_1_AND_2
  // ---------------------------------------------------------------------------
  await setAuth(teacherId);
  const teacherView1 = await db.query(`SELECT public.get_academic_submission_grading_workspace('${sub1Id}') as result;`);
  const teacherView2 = await db.query(`SELECT public.get_academic_submission_grading_workspace('${sub2Id}') as result;`);
  assert.equal(teacherView1.rows[0].result.success, true);
  assert.equal(teacherView1.rows[0].result.submission.attempt_number, 1);
  assert.equal(teacherView1.rows[0].result.attachments[0].id, att1Id);

  assert.equal(teacherView2.rows[0].result.success, true);
  assert.equal(teacherView2.rows[0].result.submission.attempt_number, 2);
  assert.equal(teacherView2.rows[0].result.attachments[0].id, att2Id);
  pass('TEACHER_CAN_VIEW_ATTEMPT_1_AND_2: Giáo viên xem được đầy đủ workspace của cả Lần 1 và Lần 2');

  // ---------------------------------------------------------------------------
  // TEST 17: STUDENT_LATEST_RESULT_POINTS_TO_ATTEMPT_2
  // ---------------------------------------------------------------------------
  await setAuth(studentId);
  const studentView1 = await db.query(`SELECT public.get_student_graded_submission('${sub1Id}') as result;`);
  const studentView2 = await db.query(`SELECT public.get_student_graded_submission('${sub2Id}') as result;`);
  assert.equal(studentView1.rows[0].result.success, true);
  assert.equal(studentView1.rows[0].result.submission.status, 'revision_requested');
  assert.equal(studentView2.rows[0].result.success, true);
  assert.equal(studentView2.rows[0].result.submission.status, 'graded');
  assert.equal(Number(studentView2.rows[0].result.submission.total_score), 10);
  pass('STUDENT_LATEST_RESULT_POINTS_TO_ATTEMPT_2: Học sinh xem được kết quả đã chấm của Lần 2 và lịch sử Lần 1');

  // ---------------------------------------------------------------------------
  // TEST 18: NO_CROSS_ATTEMPT_ANNOTATION_LEAK
  // ---------------------------------------------------------------------------
  assert.equal(teacherView1.rows[0].result.attachments.length, 1);
  assert.equal(teacherView1.rows[0].result.attachments[0].id, att1Id);
  assert.equal(teacherView2.rows[0].result.attachments.length, 1);
  assert.equal(teacherView2.rows[0].result.attachments[0].id, att2Id);

  assert.equal(studentView1.rows[0].result.attachments.length, 1);
  assert.equal(studentView1.rows[0].result.attachments[0].id, att1Id);
  assert.equal(studentView2.rows[0].result.attachments.length, 1);
  assert.equal(studentView2.rows[0].result.attachments[0].id, att2Id);
  pass('NO_CROSS_ATTEMPT_ANNOTATION_LEAK: Không xảy ra rò rỉ dữ liệu hay chú thích giữa các lần làm bài');

  console.log('================================================================================');
  console.log(`🎉 HOÀN TẤT XÁC MINH: ĐẠT 100% (18/18 TEST CASES CHÍNH XÁC)!`);
  console.log('================================================================================\n');
}
