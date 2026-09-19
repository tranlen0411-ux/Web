// tests/academic_submission_image_annotations.test.mjs
// PGLITE AUTOMATED SECURITY & FUNCTIONAL TEST SUITE FOR MULTI-IMAGE SUBMISSION & ANNOTATIONS (PHASE 1)

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

export async function runImageAnnotationTestSuite() {
  console.log('================================================================================');
  console.log('🚀 BẮT ĐẦU KIỂM THỬ PGLITE: MULTI-IMAGE SUBMISSION & ANNOTATIONS (PHASE 1 SECURITY)');
  console.log('================================================================================\n');

  const migrationPath = path.join(
    process.cwd(),
    'supabase',
    'migrations',
    '20260918000001_academic_submission_image_annotations_phase1.sql'
  );
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');

  const migration2Path = path.join(
    process.cwd(),
    'supabase',
    'migrations',
    '20260918000002_fix_finalize_grading_rpc.sql'
  );
  const migration2Sql = fs.readFileSync(migration2Path, 'utf8');

  const migration3Path = path.join(
    process.cwd(),
    'supabase',
    'migrations',
    '20260919000003_harden_finalize_annotation_attachment_validation.sql'
  );
  const migration3Sql = fs.readFileSync(migration3Path, 'utf8');

  const migration4Path = path.join(
    process.cwd(),
    'supabase',
    'migrations',
    '20260919000004_harden_student_graded_submission_status.sql'
  );
  const migration4Sql = fs.readFileSync(migration4Path, 'utf8');

  const db = new PGlite();

  // 1. Khởi tạo roles và schema nền tảng (mô phỏng Postgres / Supabase)
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
      reward_applied_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
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

    CREATE OR REPLACE FUNCTION app_private.student_in_class(p_class_id UUID) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
      SELECT EXISTS (SELECT 1 FROM public.class_members WHERE class_id = p_class_id AND student_id = auth.uid());
    $$;

    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT USAGE ON SCHEMA app_private TO anon, authenticated, service_role;
    GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA storage TO anon, authenticated, service_role;
    GRANT ALL ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
    GRANT ALL ON ALL FUNCTIONS IN SCHEMA app_private TO anon, authenticated, service_role;
    GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
  `);

  // 2. Áp dụng Migration Phase 1 & Hotfix Phase 1
  console.log('📌 Đang áp dụng migration Phase 1...');
  await db.exec(migrationSql);
  console.log('📌 Đang áp dụng hotfix migration 2...');
  await db.exec(migration2Sql);
  console.log('📌 Đang áp dụng hotfix migration 3 (harden attachment validation)...');
  await db.exec(migration3Sql);
  console.log('📌 Đang áp dụng hotfix migration 4 (harden student graded submission status gate)...');
  await db.exec(migration4Sql);
  await db.exec(`
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
  `);
  console.log('✅ Áp dụng migrations thành công!\n');

  // 3. Chuẩn bị Mock Data
  const adminId = '11111111-1111-1111-1111-111111111111';
  const teacherAId = '22222222-2222-2222-2222-222222222222';
  const teacherBId = '33333333-3333-3333-3333-333333333333';
  const studentAId = '44444444-4444-4444-4444-444444444444';
  const studentBId = '55555555-5555-5555-5555-555555555555';

  const classAId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const classBId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  const exerciseAId = 'ee111111-1111-1111-1111-111111111111';
  const question1Id = 'cc111111-1111-1111-1111-111111111111'; // trắc nghiệm
  const question2Id = 'cc222222-2222-2222-2222-222222222222'; // tự luận / nộp ảnh

  const submissionAId = 'dd111111-1111-1111-1111-111111111111';

  await db.exec(`
    INSERT INTO public.profiles (id, full_name, email, role) VALUES
      ('${adminId}', 'Quản Trị Viên', 'admin@school.edu.vn', 'admin'),
      ('${teacherAId}', 'Cô Giáo Lớp A', 'teacherA@school.edu.vn', 'teacher'),
      ('${teacherBId}', 'Thầy Giáo Lớp B', 'teacherB@school.edu.vn', 'teacher'),
      ('${studentAId}', 'Học Sinh A (Lớp A)', 'studentA@school.edu.vn', 'student'),
      ('${studentBId}', 'Học Sinh B (Lớp B)', 'studentB@school.edu.vn', 'student');

    INSERT INTO public.classes (id, name, code, grade_level, teacher_id) VALUES
      ('${classAId}', 'Lớp 1A', 'L1A', 1, '${teacherAId}'),
      ('${classBId}', 'Lớp 1B', 'L1B', 1, '${teacherBId}');

    INSERT INTO public.class_members (class_id, student_id) VALUES
      ('${classAId}', '${studentAId}'),
      ('${classBId}', '${studentBId}');

    INSERT INTO public.academic_exercises (id, title, description, grade_level, subject, reward_stars, teacher_id, class_id) VALUES
      ('${exerciseAId}', 'Bài tập Toán Lớp 1A', 'Bài tập vẽ và tính toán', 1, 'Toán', 10, '${teacherAId}', '${classAId}');

    INSERT INTO public.academic_exercise_assignments (exercise_id, class_id) VALUES
      ('${exerciseAId}', '${classAId}');

    INSERT INTO public.academic_exercise_questions (id, exercise_id, question_number, question_type, prompt, points) VALUES
      ('${question1Id}', '${exerciseAId}', 1, 'single_choice', '1 + 1 = ?', 5.00),
      ('${question2Id}', '${exerciseAId}', 2, 'image_upload', 'Vẽ hình vuông và chụp ảnh bài làm', 5.00);

    INSERT INTO public.academic_submissions (id, exercise_id, student_id, attempt_number, status, objective_score, max_score) VALUES
      ('${submissionAId}', '${exerciseAId}', '${studentAId}', 1, 'draft', 5.00, 10.00);

    INSERT INTO public.academic_submission_answers (submission_id, question_id, points_earned, is_correct) VALUES
      ('${submissionAId}', '${question1Id}', 5.00, true),
      ('${submissionAId}', '${question2Id}', 0.00, false);
  `);

  function setAuthUser(userId, role = 'authenticated') {
    if (userId) {
      return db.exec(`SET ROLE ${role}; SET app.current_user_id = '${userId}';`);
    } else {
      return db.exec(`SET ROLE anon; SET app.current_user_id = '';`);
    }
  }

  let totalTests = 0;
  function markTest(testName) {
    totalTests++;
    console.log(`🧪 Test ${totalTests}: ${testName}`);
  }

  // ============================================================================
  // NHÓM 1: KIỂM TRA PREPARE ATTACHMENT & BẢO MẬT KHỞI TẠO
  // ============================================================================

  // TEST 1: Anonymous / Unauthenticated bị từ chối
  markTest('Anonymous & Unauthenticated gọi RPC prepare attachment -> Bị từ chối');
  await setAuthUser(null, 'anon');
  try {
    await db.query(`
      SELECT public.prepare_academic_submission_attachment(
        '${submissionAId}', '${question2Id}', 'bai1.png', 'image/png', 102400, 0
      ) as result;
    `);
    assert.fail('Should have thrown permission denied for anon role');
  } catch (err) {
    assert.match(err.message, /permission denied/i);
  }

  // Khi authenticated nhưng không có auth.uid()
  await db.exec(`SET ROLE authenticated; SET app.current_user_id = '';`);
  const noUidRes = await db.query(`
    SELECT public.prepare_academic_submission_attachment(
      '${submissionAId}', '${question2Id}', 'bai1.png', 'image/png', 102400, 0
    ) as result;
  `);
  assert.equal(noUidRes.rows[0].result.success, false);
  assert.equal(noUidRes.rows[0].result.error, 'UNAUTHORIZED');
  console.log('   ✅ PASS: Anonymous and unauthenticated rejected');

  // TEST 2: Học sinh B cố tình tạo attachment cho bài nộp của Học sinh A (IDOR/BOLA)
  markTest('Học sinh B tấn công IDOR bài nộp của Học sinh A -> Bị chặn');
  await setAuthUser(studentBId);
  const idorRes = await db.query(`
    SELECT public.prepare_academic_submission_attachment(
      '${submissionAId}', '${question2Id}', 'bai_hack.png', 'image/png', 102400, 0
    ) as result;
  `);
  assert.equal(idorRes.rows[0].result.success, false);
  assert.equal(idorRes.rows[0].result.error, 'FORBIDDEN');
  console.log('   ✅ PASS: IDOR attempt blocked');

  // TEST 3: MIME không hợp lệ và file quá 10 MiB bị từ chối
  markTest('Upload file quá 10MB hoặc MIME không hợp lệ (SVG/PDF) -> Bị từ chối');
  await setAuthUser(studentAId);
  const badMimeRes = await db.query(`
    SELECT public.prepare_academic_submission_attachment(
      '${submissionAId}', '${question2Id}', 'malicious.svg', 'image/svg+xml', 1024, 0
    ) as result;
  `);
  assert.equal(badMimeRes.rows[0].result.success, false);
  assert.equal(badMimeRes.rows[0].result.error, 'INVALID_MIME_TYPE');

  const bigFileRes = await db.query(`
    SELECT public.prepare_academic_submission_attachment(
      '${submissionAId}', '${question2Id}', 'huge.jpg', 'image/jpeg', 15000000, 0
    ) as result;
  `);
  assert.equal(bigFileRes.rows[0].result.success, false);
  assert.equal(bigFileRes.rows[0].result.error, 'INVALID_FILE_SIZE');
  console.log('   ✅ PASS: MIME & Size checks strictly enforced');

  // TEST 4: Happy path học sinh A upload 2 ảnh cho câu 2 (Nhiều ảnh 1 submission)
  markTest('Học sinh A prepare thành công nhiều ảnh (1-N attachments)');
  const att1Res = await db.query(`
    SELECT public.prepare_academic_submission_attachment(
      '${submissionAId}', '${question2Id}', 'trang1.png', 'image/png', 500000, 0
    ) as result;
  `);
  assert.equal(att1Res.rows[0].result.success, true);
  const attachment1Id = att1Res.rows[0].result.attachment_id;
  const storagePath1 = att1Res.rows[0].result.storage_path;
  assert.ok(storagePath1.includes(`students/${studentAId}/submissions/${submissionAId}`));

  const att2Res = await db.query(`
    SELECT public.prepare_academic_submission_attachment(
      '${submissionAId}', '${question2Id}', 'trang2.jpg', 'image/jpeg', 700000, 1
    ) as result;
  `);
  assert.equal(att2Res.rows[0].result.success, true);
  const attachment2Id = att2Res.rows[0].result.attachment_id;
  const storagePath2 = att2Res.rows[0].result.storage_path;
  console.log('   ✅ PASS: 2 attachments prepared');

  // ============================================================================
  // NHÓM 2: FIX 2 — XÁC MINH STORAGE OBJECT KHI FINALIZE
  // ============================================================================

  // TEST 5: Finalize khi object chưa tồn tại trong storage.objects -> Bị từ chối
  markTest('FIX 2: Finalize khi Storage object không tồn tại -> Rejected (STORAGE_OBJECT_NOT_FOUND)');
  const noObjRes = await db.query(`
    SELECT public.finalize_academic_submission_attachment('${attachment1Id}', 1920, 1080) as result;
  `);
  assert.equal(noObjRes.rows[0].result.success, false);
  assert.equal(noObjRes.rows[0].result.error, 'STORAGE_OBJECT_NOT_FOUND');
  console.log('   ✅ PASS: Missing storage object rejected');

  async function insertMockStorageObject(bucket, name, owner, metadata) {
    await db.exec(`SET ROLE postgres;`);
    await db.query(`
      INSERT INTO storage.objects (bucket_id, name, owner, metadata)
      VALUES ('${bucket}', '${name}', '${owner}', '${JSON.stringify(metadata)}'::jsonb);
    `);
    await setAuthUser(studentAId);
  }

  async function deleteMockStorageObject(name, bucket = 'exercise-submissions') {
    await db.exec(`SET ROLE postgres;`);
    await db.query(`DELETE FROM storage.objects WHERE bucket_id = '${bucket}' AND name = '${name}';`);
    await setAuthUser(studentAId);
  }

  // TEST 6: Finalize khi object sai bucket -> Bị từ chối
  markTest('FIX 2: Storage object sai bucket (ví dụ avatars thay vì exercise-submissions) -> Rejected');
  await insertMockStorageObject('avatars', storagePath1, studentAId, { size: 500000, mimetype: 'image/png' });
  const wrongBucketRes = await db.query(`
    SELECT public.finalize_academic_submission_attachment('${attachment1Id}', 1920, 1080) as result;
  `);
  assert.equal(wrongBucketRes.rows[0].result.success, false);
  assert.equal(wrongBucketRes.rows[0].result.error, 'STORAGE_OBJECT_NOT_FOUND');
  await deleteMockStorageObject(storagePath1, 'avatars');
  console.log('   ✅ PASS: Wrong bucket rejected');

  // TEST 7: Finalize khi object sai path -> Bị từ chối
  markTest('FIX 2: Storage object sai storage path -> Rejected');
  const wrongPath = `students/${studentAId}/submissions/${submissionAId}/other_path.png`;
  await insertMockStorageObject('exercise-submissions', wrongPath, studentAId, { size: 500000, mimetype: 'image/png' });
  const wrongPathRes = await db.query(`
    SELECT public.finalize_academic_submission_attachment('${attachment1Id}', 1920, 1080) as result;
  `);
  assert.equal(wrongPathRes.rows[0].result.success, false);
  assert.equal(wrongPathRes.rows[0].result.error, 'STORAGE_OBJECT_NOT_FOUND');
  await deleteMockStorageObject(wrongPath);
  console.log('   ✅ PASS: Wrong path rejected');

  // TEST 8: Storage metadata size vượt 10 MiB -> Bị từ chối
  markTest('FIX 2: Storage metadata size vượt quá 10 MiB -> Rejected (INVALID_FILE_SIZE)');
  await insertMockStorageObject('exercise-submissions', storagePath1, studentAId, { size: 15000000, mimetype: 'image/png' });
  const overSizeRes = await db.query(`
    SELECT public.finalize_academic_submission_attachment('${attachment1Id}', 1920, 1080) as result;
  `);
  assert.equal(overSizeRes.rows[0].result.success, false);
  assert.equal(overSizeRes.rows[0].result.error, 'INVALID_FILE_SIZE');
  await deleteMockStorageObject(storagePath1);
  console.log('   ✅ PASS: Oversized metadata size rejected');

  // TEST 9: Storage metadata size không khớp giá trị khai báo -> Bị từ chối
  markTest('FIX 2: Storage metadata size không khớp khai báo (khai báo 500000, storage 400000) -> Rejected (FILE_SIZE_MISMATCH)');
  await insertMockStorageObject('exercise-submissions', storagePath1, studentAId, { size: 400000, mimetype: 'image/png' });
  const mismatchSizeRes = await db.query(`
    SELECT public.finalize_academic_submission_attachment('${attachment1Id}', 1920, 1080) as result;
  `);
  assert.equal(mismatchSizeRes.rows[0].result.success, false);
  assert.equal(mismatchSizeRes.rows[0].result.error, 'FILE_SIZE_MISMATCH');
  await deleteMockStorageObject(storagePath1);
  console.log('   ✅ PASS: Size mismatch rejected');

  // TEST 10: Storage metadata MIME không hợp lệ (ví dụ application/pdf) -> Bị từ chối
  markTest('FIX 2: Storage metadata MIME không hợp lệ (application/pdf) -> Rejected (INVALID_MIME_TYPE)');
  await insertMockStorageObject('exercise-submissions', storagePath1, studentAId, { size: 500000, mimetype: 'application/pdf' });
  const invalidMimeRes = await db.query(`
    SELECT public.finalize_academic_submission_attachment('${attachment1Id}', 1920, 1080) as result;
  `);
  assert.equal(invalidMimeRes.rows[0].result.success, false);
  assert.equal(invalidMimeRes.rows[0].result.error, 'INVALID_MIME_TYPE');
  await deleteMockStorageObject(storagePath1);
  console.log('   ✅ PASS: Invalid metadata MIME rejected');

  // TEST 11: Storage metadata MIME không khớp bản ghi khai báo (khai báo PNG nhưng storage là JPEG) -> Bị từ chối
  markTest('FIX 2: Storage metadata MIME không khớp khai báo (khai báo PNG, storage JPEG) -> Rejected (MIME_TYPE_MISMATCH)');
  await insertMockStorageObject('exercise-submissions', storagePath1, studentAId, { size: 500000, mimetype: 'image/jpeg' });
  const mismatchMimeRes = await db.query(`
    SELECT public.finalize_academic_submission_attachment('${attachment1Id}', 1920, 1080) as result;
  `);
  assert.equal(mismatchMimeRes.rows[0].result.success, false);
  assert.equal(mismatchMimeRes.rows[0].result.error, 'MIME_TYPE_MISMATCH');
  await deleteMockStorageObject(storagePath1);
  console.log('   ✅ PASS: MIME mismatch rejected');

  // TEST 12: Học sinh khác cố finalize attachment của Học sinh A -> Bị từ chối (BOLA/IDOR)
  markTest('FIX 2: Học sinh B gọi finalize trên attachment của Học sinh A -> Rejected (FORBIDDEN)');
  await setAuthUser(studentBId);
  const crossFinalizeRes = await db.query(`
    SELECT public.finalize_academic_submission_attachment('${attachment1Id}', 1920, 1080) as result;
  `);
  assert.equal(crossFinalizeRes.rows[0].result.success, false);
  assert.equal(crossFinalizeRes.rows[0].result.error, 'FORBIDDEN');
  console.log('   ✅ PASS: Cross-student finalize blocked');

  // TEST 13: Object hợp lệ -> Finalize thành công
  markTest('FIX 2: Storage object và metadata hợp lệ -> Finalized thành công');
  await insertMockStorageObject('exercise-submissions', storagePath1, studentAId, { size: 500000, mimetype: 'image/png' });
  await insertMockStorageObject('exercise-submissions', storagePath2, studentAId, { size: 700000, mimetype: 'image/jpeg' });

  const fin1Res = await db.query(`SELECT public.finalize_academic_submission_attachment('${attachment1Id}', 1920, 1080) as result;`);
  assert.equal(fin1Res.rows[0].result.success, true);
  assert.equal(fin1Res.rows[0].result.status, 'finalized');
  assert.equal(fin1Res.rows[0].result.deduplicated, false);

  const fin2Res = await db.query(`SELECT public.finalize_academic_submission_attachment('${attachment2Id}', 1920, 1080) as result;`);
  assert.equal(fin2Res.rows[0].result.success, true);
  assert.equal(fin2Res.rows[0].result.status, 'finalized');
  console.log('   ✅ PASS: Both valid attachments finalized');

  // TEST 14: Gọi finalize lần 2 -> Idempotent thành công
  markTest('FIX 2: Gọi finalize lần 2 trên attachment đã finalized -> Idempotent (deduplicated: true)');
  const doubleFinRes = await db.query(`SELECT public.finalize_academic_submission_attachment('${attachment1Id}', 1920, 1080) as result;`);
  assert.equal(doubleFinRes.rows[0].result.success, true);
  assert.equal(doubleFinRes.rows[0].result.deduplicated, true);
  assert.equal(doubleFinRes.rows[0].result.status, 'finalized');
  console.log('   ✅ PASS: Idempotent double finalize verified');

  // Học sinh submit bài làm
  await db.exec(`UPDATE public.academic_submissions SET status = 'submitted', submitted_at = NOW() WHERE id = '${submissionAId}';`);

  // TEST 15: Học sinh không thể upload thêm ảnh sau khi đã submit bài (Immutability)
  markTest('Immutability: Sau khi nộp bài không thể prepare/thêm ảnh mới');
  const lockedRes = await db.query(`
    SELECT public.prepare_academic_submission_attachment(
      '${submissionAId}', '${question2Id}', 'trang3.png', 'image/png', 500000, 2
    ) as result;
  `);
  assert.equal(lockedRes.rows[0].result.success, false);
  assert.equal(lockedRes.rows[0].result.error, 'SUBMISSION_LOCKED');
  console.log('   ✅ PASS: Immutable after submission');

  // ============================================================================
  // NHÓM 3: FIX 1 — THU HỒI QUYỀN GIÁO VIÊN CŨ KHI THAY ĐỔI PHỤ TRÁCH LỚP
  // ============================================================================

  // TEST 16: Giáo viên A phụ trách lớp A tạo draft annotation thành công
  markTest('FIX 1: Giáo viên A (đang phụ trách Lớp A) tạo Draft Annotation version 1 -> Allowed');
  await setAuthUser(teacherAId);
  const idemp1 = '66666666-6666-6666-6666-666666666661';
  const draft1Res = await db.query(`
    SELECT public.save_academic_submission_annotation_draft(
      '${attachment1Id}',
      '{"strokes": [{"type": "pen", "color": "#ff0000", "points": [0.1, 0.2, 0.3, 0.4]}]}'::jsonb,
      0,
      '${idemp1}'
    ) as result;
  `);
  assert.equal(draft1Res.rows[0].result.success, true);
  assert.equal(draft1Res.rows[0].result.version, 1);
  assert.equal(draft1Res.rows[0].result.status, 'draft');
  console.log('   ✅ PASS: Teacher A created draft annotation v1');

  // BÂY GIỜ: GỠ GIÁO VIÊN A KHỎI LỚP A (CHUYỂN QUYỀN PHỤ TRÁCH LỚP A SANG GIÁO VIÊN B)
  console.log('\n🔄 [CHUYỂN QUYỀN LỚP]: Gỡ Giáo viên A khỏi Lớp A -> Giáo viên B phụ trách Lớp A...');
  await db.exec(`
    UPDATE public.classes SET teacher_id = '${teacherBId}' WHERE id = '${classAId}';
    UPDATE public.academic_exercises SET teacher_id = '${teacherBId}' WHERE id = '${exerciseAId}';
  `);

  // TEST 17: Giáo viên A (cũ) query trực tiếp bảng annotation_versions -> Bị RLS chặn (0 rows)
  markTest('FIX 1: Giáo viên A (cũ) query trực tiếp bảng annotation_versions -> DENIED (0 rows qua RLS)');
  await setAuthUser(teacherAId);
  const staleTeacherDirectQuery = await db.query(`
    SELECT * FROM public.academic_submission_annotation_versions
    WHERE attachment_id = '${attachment1Id}';
  `);
  assert.equal(staleTeacherDirectQuery.rows.length, 0);
  console.log('   ✅ PASS: Direct SELECT RLS returned 0 rows for stale teacher');

  // TEST 18: Giáo viên A (cũ) gọi workspace RPC -> Bị từ chối
  markTest('FIX 1: Giáo viên A (cũ) gọi get_academic_submission_grading_workspace -> Rejected (FORBIDDEN)');
  const staleWorkspaceRes = await db.query(`
    SELECT public.get_academic_submission_grading_workspace('${submissionAId}') as result;
  `);
  assert.equal(staleWorkspaceRes.rows[0].result.success, false);
  assert.equal(staleWorkspaceRes.rows[0].result.error, 'FORBIDDEN');
  console.log('   ✅ PASS: Stale teacher blocked from workspace RPC');

  // TEST 19: Giáo viên A (cũ) tạo version mới -> Bị từ chối
  markTest('FIX 1: Giáo viên A (cũ) gọi save_academic_submission_annotation_draft -> Rejected (FORBIDDEN)');
  const idempStale = '66666666-6666-6666-6666-666666666662';
  const staleSaveRes = await db.query(`
    SELECT public.save_academic_submission_annotation_draft(
      '${attachment1Id}',
      '{"strokes": []}'::jsonb,
      1,
      '${idempStale}'
    ) as result;
  `);
  assert.equal(staleSaveRes.rows[0].result.success, false);
  assert.equal(staleSaveRes.rows[0].result.error, 'FORBIDDEN');
  console.log('   ✅ PASS: Stale teacher blocked from saving annotation');

  // TEST 20: Giáo viên A (cũ) gọi finalize grading -> Bị từ chối
  markTest('FIX 1: Giáo viên A (cũ) gọi finalize_academic_submission_grading -> Rejected (FORBIDDEN)');
  const staleFinalizeRes = await db.query(`
    SELECT public.finalize_academic_submission_grading_with_annotations(
      '${submissionAId}',
      '[{"question_id": "${question2Id}", "points_earned": 5.0}]'::jsonb,
      '[]'::jsonb,
      'Nhận xét trái phép',
      false
    ) as result;
  `);
  assert.equal(staleFinalizeRes.rows[0].result.success, false);
  assert.equal(staleFinalizeRes.rows[0].result.error, 'FORBIDDEN');
  console.log('   ✅ PASS: Stale teacher blocked from finalizing grading');

  // TEST 21: Giáo viên B (đang phụ trách lớp A) -> Được phép truy cập và chấm bài
  markTest('FIX 1: Giáo viên B (hiện đang phụ trách Lớp A) mở Workspace & lưu Draft -> ALLOWED');
  await setAuthUser(teacherBId);
  const teacherBWorkspace = await db.query(`
    SELECT public.get_academic_submission_grading_workspace('${submissionAId}') as result;
  `);
  assert.equal(teacherBWorkspace.rows[0].result.success, true);
  assert.equal(teacherBWorkspace.rows[0].result.attachments.length, 2);

  const idempTeacherB = '66666666-6666-6666-6666-666666666663';
  const teacherBDraft = await db.query(`
    SELECT public.save_academic_submission_annotation_draft(
      '${attachment1Id}',
      '{"strokes": [{"type": "highlighter", "color": "#ffff00", "points": [0.2, 0.3, 0.5, 0.6]}]}'::jsonb,
      1,
      '${idempTeacherB}'
    ) as result;
  `);
  assert.equal(teacherBDraft.rows[0].result.success, true);
  assert.equal(teacherBDraft.rows[0].result.version, 2);
  console.log('   ✅ PASS: Current class teacher B granted access');

  // TEST 22: Admin -> Được phép truy cập toàn hệ thống
  markTest('FIX 1: Admin truy cập Workspace và lưu Draft -> ALLOWED');
  await setAuthUser(adminId);
  const adminWorkspace = await db.query(`
    SELECT public.get_academic_submission_grading_workspace('${submissionAId}') as result;
  `);
  assert.equal(adminWorkspace.rows[0].result.success, true);
  console.log('   ✅ PASS: Admin global access verified');

  // ============================================================================
  // NHÓM 4: OCC CONFLICT, DEDUPLICATION, VÀ CHẤM BÀI HOÀN TẤT
  // ============================================================================

  // TEST 23: Optimistic Concurrency Control (OCC) Version Conflict check
  markTest('OCC Version Conflict: Gửi expected_version sai -> Rejected (VERSION_CONFLICT)');
  await setAuthUser(teacherBId);
  const conflictRes = await db.query(`
    SELECT public.save_academic_submission_annotation_draft(
      '${attachment1Id}',
      '{"strokes": []}'::jsonb,
      1,
      '66666666-6666-6666-6666-666666666664'
    ) as result;
  `);
  assert.equal(conflictRes.rows[0].result.success, false);
  assert.equal(conflictRes.rows[0].result.error, 'VERSION_CONFLICT');
  console.log('   ✅ PASS: OCC Version conflict caught');

  // TEST 24: Idempotency Key Deduplication
  markTest('Idempotency Key: Gửi lại cùng idempotency key -> Trả về bản ghi hiện có (deduplicated: true)');
  const retryDraft = await db.query(`
    SELECT public.save_academic_submission_annotation_draft(
      '${attachment1Id}',
      '{"strokes": []}'::jsonb,
      2,
      '${idempTeacherB}'
    ) as result;
  `);
  assert.equal(retryDraft.rows[0].result.success, true);
  assert.equal(retryDraft.rows[0].result.deduplicated, true);
  assert.equal(retryDraft.rows[0].result.version, 2);
  console.log('   ✅ PASS: Idempotent draft save verified');

  // TEST 25: Học sinh không thể xem bài khi chưa chấm xong (SUBMISSION_NOT_GRADED); Giáo viên phụ trách vẫn xem được và draft annotation bị ẩn
  markTest('Draft Isolation & Fix 000004 Gate: Học sinh xem bài khi status = "submitted" -> SUBMISSION_NOT_GRADED; Giáo viên xem được và draft annotation bị ẩn');
  await setAuthUser(studentAId);
  const studentGradedRes = await db.query(`
    SELECT public.get_student_graded_submission('${submissionAId}') as result;
  `);
  assert.equal(studentGradedRes.rows[0].result.success, false);
  assert.equal(studentGradedRes.rows[0].result.error, 'SUBMISSION_NOT_GRADED');
  assert.equal(studentGradedRes.rows[0].result.message, 'Bài làm chưa được chấm hoàn tất.');

  await setAuthUser(teacherBId);
  const teacherGradedRes = await db.query(`
    SELECT public.get_student_graded_submission('${submissionAId}') as result;
  `);
  assert.equal(teacherGradedRes.rows[0].result.success, true);
  assert.equal(teacherGradedRes.rows[0].result.attachments[0].final_annotation, null);
  console.log('   ✅ PASS: Student blocked before grading, teacher allowed and draft annotations hidden');

  // TEST 26: Giáo viên B hoàn tất chấm bài (Finalize grading with annotations)
  markTest('Finalize Grading: Lưu điểm tự luận, annotation final và tính thưởng sao chính xác');
  await setAuthUser(teacherBId);
  const finalizeRes = await db.query(`
    SELECT public.finalize_academic_submission_grading_with_annotations(
      '${submissionAId}',
      '[{"question_id": "${question2Id}", "points_earned": 5.0, "teacher_comment": "Vẽ rất đẹp, bài làm chuẩn xác!"}]'::jsonb,
      '[{"attachment_id": "${attachment1Id}", "expected_version": 2, "annotation_json": {"strokes": [{"type": "stamp", "stamp_type": "check", "x": 0.5, "y": 0.5}]}}]'::jsonb,
      'Thầy khen ngợi bé hoàn thành xuất sắc!',
      false
    ) as result;
  `);
  assert.equal(finalizeRes.rows[0].result.success, true);
  assert.equal(finalizeRes.rows[0].result.status, 'graded');
  assert.equal(Number(finalizeRes.rows[0].result.total_score), 10.0);
  assert.equal(Number(finalizeRes.rows[0].result.reward_stars_awarded), 10);
  console.log('   ✅ PASS: Finalize grading & reward stars succeeded');

  // TEST 27: Học sinh A xem kết quả sau khi đã chấm hoàn tất
  markTest('Graded Submission View: Học sinh thấy Final annotation và nhận xét của giáo viên');
  await setAuthUser(studentAId);
  const finalStudentRes = await db.query(`
    SELECT public.get_student_graded_submission('${submissionAId}') as result;
  `);
  assert.equal(finalStudentRes.rows[0].result.success, true);
  assert.equal(finalStudentRes.rows[0].result.submission.status, 'graded');
  assert.equal(Number(finalStudentRes.rows[0].result.submission.total_score), 10);
  assert.ok(finalStudentRes.rows[0].result.attachments[0].final_annotation !== null);
  assert.equal(finalStudentRes.rows[0].result.attachments[0].final_annotation.annotation_json.strokes[0].stamp_type, 'check');
  console.log('   ✅ PASS: Student sees final graded annotations');

  // TEST 28: Học sinh B cố xem kết quả bài của Học sinh A -> Bị chặn
  markTest('Cross-Student Access: Học sinh B cố xem bài đã chấm của Học sinh A -> Rejected (FORBIDDEN)');
  await setAuthUser(studentBId);
  const crossStudentRes = await db.query(`
    SELECT public.get_student_graded_submission('${submissionAId}') as result;
  `);
  assert.equal(crossStudentRes.rows[0].result.success, false);
  assert.equal(crossStudentRes.rows[0].result.error, 'FORBIDDEN');
  console.log('   ✅ PASS: Cross student access blocked');

  // ============================================================================
  // NHÓM 5: STORAGE RLS POLICIES & INSERT PERMISSION INTEGRITY
  // ============================================================================

  // Tạo thêm 1 bài nộp draft mới của Học sinh A để kiểm tra upload draft
  const draftSubmissionId = 'dd222222-2222-2222-2222-222222222222';
  await db.exec(`
    INSERT INTO public.academic_submissions (id, exercise_id, student_id, attempt_number, status, objective_score, max_score) VALUES
      ('${draftSubmissionId}', '${exerciseAId}', '${studentAId}', 2, 'draft', 0, 10.00);
  `);

  async function tryStorageInsert(name, bucket = 'exercise-submissions') {
    try {
      await db.query(`
        INSERT INTO storage.objects (bucket_id, name, owner)
        VALUES ('${bucket}', '${name}', auth.uid());
      `);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // TEST 29: Xác nhận chỉ còn đúng 1 policy INSERT trên storage.objects cho exercise-submissions
  markTest('Storage Policy Uniqueness: Chỉ tồn tại đúng 1 INSERT policy duy nhất (Exercise submissions student insert policy)');
  const insertPolicies = await db.query(`
    SELECT polname
    FROM pg_policy
    WHERE polrelid = 'storage.objects'::regclass
      AND polcmd = 'a'
      AND (polname LIKE '%Exercise submissions%' OR polname LIKE '%exercise%');
  `);
  assert.equal(insertPolicies.rows.length, 1);
  assert.equal(insertPolicies.rows[0].polname, 'Exercise submissions student insert policy');
  console.log('   ✅ PASS: Exactly 1 unique INSERT policy exists (no dual permissive policies)');

  // TEST 30: Legacy upload với bài nộp trạng thái draft -> ALLOW
  markTest('Legacy Path Draft: Học sinh A upload file hợp lệ vào bài nộp draft ({uid}/{submission_id}/file.png) -> ALLOW');
  await setAuthUser(studentAId);
  const legDraft = await tryStorageInsert(`${studentAId}/${draftSubmissionId}/legacy_draft.png`);
  assert.equal(legDraft.success, true);
  console.log('   ✅ PASS: Legacy path upload on draft allowed');

  // TEST 31: Legacy upload với bài nộp trạng thái submitted/graded -> DENY
  markTest('Legacy Path Graded: Học sinh A upload file vào bài nộp đã graded/submitted -> DENIED by RLS');
  await setAuthUser(studentAId);
  const legGraded = await tryStorageInsert(`${studentAId}/${submissionAId}/legacy_graded.png`);
  assert.equal(legGraded.success, false);
  console.log('   ✅ PASS: Legacy path upload on graded/submitted submission blocked');

  // TEST 32: Legacy upload chứa extension nguy hiểm (.svg, .exe, .html, .js, .sh, .bat) -> DENY
  markTest('Legacy Path Dangerous Ext: Upload .svg, .exe, .html, .js, .sh, .bat trên legacy path -> DENIED');
  await setAuthUser(studentAId);
  const legSvg = await tryStorageInsert(`${studentAId}/${draftSubmissionId}/bad.svg`);
  const legExe = await tryStorageInsert(`${studentAId}/${draftSubmissionId}/bad.exe`);
  const legHtml = await tryStorageInsert(`${studentAId}/${draftSubmissionId}/bad.html`);
  const legJs = await tryStorageInsert(`${studentAId}/${draftSubmissionId}/bad.js`);
  const legSh = await tryStorageInsert(`${studentAId}/${draftSubmissionId}/bad.sh`);
  const legBat = await tryStorageInsert(`${studentAId}/${draftSubmissionId}/bad.bat`);
  assert.equal(legSvg.success, false);
  assert.equal(legExe.success, false);
  assert.equal(legHtml.success, false);
  assert.equal(legJs.success, false);
  assert.equal(legSh.success, false);
  assert.equal(legBat.success, false);
  console.log('   ✅ PASS: Dangerous extensions on legacy path strictly blocked');

  // TEST 33: New path upload với bài nộp trạng thái draft -> ALLOW
  markTest('New Path Draft: Học sinh A upload attachment hợp lệ (students/{uid}/submissions/{sub_id}/attachments/{att_id}/original.png) -> ALLOW');
  await setAuthUser(studentAId);
  const newDraft = await tryStorageInsert(`students/${studentAId}/submissions/${draftSubmissionId}/attachments/att-1111/original.png`);
  assert.equal(newDraft.success, true);
  console.log('   ✅ PASS: New attachment path upload on draft allowed');

  // TEST 34: New path upload với bài nộp trạng thái graded/submitted -> DENY
  markTest('New Path Graded: Học sinh A upload attachment vào bài nộp đã graded/submitted -> DENIED by RLS');
  await setAuthUser(studentAId);
  const newGraded = await tryStorageInsert(`students/${studentAId}/submissions/${submissionAId}/attachments/att-2222/original.png`);
  assert.equal(newGraded.success, false);
  console.log('   ✅ PASS: New attachment path upload on graded submission blocked');

  // TEST 35: New path upload chứa extension nguy hiểm -> DENY
  markTest('New Path Dangerous Ext: Upload .svg, .exe, .bat trên new path -> DENIED');
  await setAuthUser(studentAId);
  const newSvg = await tryStorageInsert(`students/${studentAId}/submissions/${draftSubmissionId}/attachments/att-3333/original.svg`);
  const newExe = await tryStorageInsert(`students/${studentAId}/submissions/${draftSubmissionId}/attachments/att-4444/original.exe`);
  assert.equal(newSvg.success, false);
  assert.equal(newExe.success, false);
  console.log('   ✅ PASS: Dangerous extensions on new path strictly blocked');

  // TEST 36: Cross-student upload (Legacy Path) -> DENY
  markTest('Cross-Student Legacy: Học sinh B cố upload vào folder của Học sinh A -> DENIED by RLS');
  await setAuthUser(studentBId);
  const crossLeg = await tryStorageInsert(`${studentAId}/${draftSubmissionId}/hacked.png`);
  assert.equal(crossLeg.success, false);
  console.log('   ✅ PASS: Cross-student legacy upload blocked');

  // TEST 37: Cross-student upload (New Path) -> DENY
  markTest('Cross-Student New Path: Học sinh B cố upload vào students/{studentAId}/submissions/{draftSubmissionId}/... -> DENIED by RLS');
  await setAuthUser(studentBId);
  const crossNew = await tryStorageInsert(`students/${studentAId}/submissions/${draftSubmissionId}/attachments/att-5555/original.png`);
  assert.equal(crossNew.success, false);
  console.log('   ✅ PASS: Cross-student new path upload blocked');

  // TEST 38: Không có permissive broadening (Upload vào folder bất kỳ không gắn với submission thật) -> DENY
  markTest('No Permissive Broadening: Upload vào folder tùy ý không gắn submission hợp lệ -> DENIED');
  await setAuthUser(studentAId);
  const randomFolder = await tryStorageInsert(`students/${studentAId}/random_directory/hack.png`);
  const nonExistentSub = await tryStorageInsert(`students/${studentAId}/submissions/99999999-9999-9999-9999-999999999999/attachments/att-6666/original.png`);
  assert.equal(randomFolder.success, false);
  assert.equal(nonExistentSub.success, false);
  console.log('   ✅ PASS: Permissive broadening prevented (unattached uploads blocked)');

  // TEST 39: Regression Test: academic_submission_answers không có updated_at, finalize grading vẫn cập nhật điểm & comment chính xác
  markTest('Regression Contract: academic_submission_answers KHÔNG có updated_at, finalize grading vẫn cập nhật points & comment thành công');
  const answersCols = await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'academic_submission_answers';
  `);
  const colNames = answersCols.rows.map(r => r.column_name);
  assert.equal(colNames.includes('updated_at'), false, 'academic_submission_answers MUST NOT contain updated_at');

  const checkAnswerRow = await db.query(`
    SELECT points_earned, teacher_comment
    FROM public.academic_submission_answers
    WHERE submission_id = '${submissionAId}' AND question_id = '${question2Id}';
  `);
  assert.equal(checkAnswerRow.rows.length, 1);
  assert.equal(Number(checkAnswerRow.rows[0].points_earned), 5.0);
  assert.equal(checkAnswerRow.rows[0].teacher_comment, 'Vẽ rất đẹp, bài làm chuẩn xác!');
  console.log('   ✅ PASS: Regression test passed (academic_submission_answers schema & RPC finalize contract verified)');

  // ============================================================================
  // NHÓM 6: SECURITY HOTFIX 000003 — ATTACHMENT VALIDATION & IDEMPOTENCY HARDENING
  // ============================================================================
  console.log('\n================================================================================');
  console.log('🛡️ NHÓM 6: KIỂM THỬ BẢO MẬT VÀ REGRESSION CHO HOTFIX MIGRATION 000003');
  console.log('================================================================================\n');

  const subSec1Id = 'dd333333-3333-3333-3333-333333333331';
  const subSec2Id = 'dd333333-3333-3333-3333-333333333332';
  const attFinal1Id = 'aa111111-1111-1111-1111-111111111111';
  const attFinal2Id = 'aa222222-2222-2222-2222-222222222222';
  const attPendingId = 'aa333333-3333-3333-3333-333333333333';
  const attOtherSubId = 'aa444444-4444-4444-4444-444444444444';

  await db.exec('SET ROLE postgres; SET app.current_user_id = \'\';');
  await db.exec(`
    INSERT INTO public.academic_submissions (id, exercise_id, student_id, attempt_number, status, objective_score, max_score) VALUES
      ('${subSec1Id}', '${exerciseAId}', '${studentAId}', 3, 'submitted', 4.00, 10.00),
      ('${subSec2Id}', '${exerciseAId}', '${studentBId}', 1, 'submitted', 2.00, 10.00);

    INSERT INTO public.academic_submission_answers (submission_id, question_id, points_earned) VALUES
      ('${subSec1Id}', '${question2Id}', 0),
      ('${subSec2Id}', '${question2Id}', 0);

    INSERT INTO public.academic_submission_attachments (
      id, submission_id, question_id, student_id, original_file_name, byte_size, mime_type, storage_bucket, storage_path, upload_status, sort_order, created_by
    ) VALUES
      ('${attFinal1Id}', '${subSec1Id}', '${question2Id}', '${studentAId}', 'page1.png', 50000, 'image/png', 'exercise-submissions', 'students/${studentAId}/submissions/${subSec1Id}/attachments/${attFinal1Id}/original.png', 'finalized', 0, '${studentAId}'),
      ('${attFinal2Id}', '${subSec1Id}', '${question2Id}', '${studentAId}', 'page2.png', 60000, 'image/png', 'exercise-submissions', 'students/${studentAId}/submissions/${subSec1Id}/attachments/${attFinal2Id}/original.png', 'finalized', 1, '${studentAId}'),
      ('${attPendingId}', '${subSec1Id}', '${question2Id}', '${studentAId}', 'page3.png', 70000, 'image/png', 'exercise-submissions', 'students/${studentAId}/submissions/${subSec1Id}/attachments/${attPendingId}/original.png', 'pending', 2, '${studentAId}'),
      ('${attOtherSubId}', '${subSec2Id}', '${question2Id}', '${studentBId}', 'other.png', 80000, 'image/png', 'exercise-submissions', 'students/${studentBId}/submissions/${subSec2Id}/attachments/${attOtherSubId}/original.png', 'finalized', 0, '${studentBId}');
  `);

  // TEST 40: (Case B) Cross-submission attachment mismatch -> FAIL ATTACHMENT_MISMATCH
  markTest('Security 000003 [Case B]: Cross-submission attachment mismatch bị chặn (ATTACHMENT_MISMATCH)');
  await setAuthUser(teacherBId);
  const mismatchRes = await db.query(`
    SELECT public.finalize_academic_submission_grading_with_annotations(
      '${subSec1Id}',
      '[{"question_id": "${question2Id}", "points_earned": 3.0}]'::jsonb,
      '[{"attachment_id": "${attOtherSubId}", "expected_version": 0, "annotation_json": {"strokes": []}}]'::jsonb,
      'Feedback test',
      false
    ) as result;
  `);
  assert.equal(mismatchRes.rows[0].result.success, false);
  assert.equal(mismatchRes.rows[0].result.error, 'ATTACHMENT_MISMATCH');
  console.log('   ✅ PASS: Cross-submission attachment injection strictly blocked');

  // TEST 41: (Case C) Pending attachment in payload -> FAIL ATTACHMENT_NOT_FINALIZED
  markTest('Security 000003 [Case C]: Annotation trên attachment trạng thái pending bị từ chối (ATTACHMENT_NOT_FINALIZED)');
  const pendingRes = await db.query(`
    SELECT public.finalize_academic_submission_grading_with_annotations(
      '${subSec1Id}',
      '[{"question_id": "${question2Id}", "points_earned": 3.0}]'::jsonb,
      '[{"attachment_id": "${attPendingId}", "expected_version": 0, "annotation_json": {"strokes": []}}]'::jsonb,
      'Feedback test',
      false
    ) as result;
  `);
  assert.equal(pendingRes.rows[0].result.success, false);
  assert.equal(pendingRes.rows[0].result.error, 'ATTACHMENT_NOT_FINALIZED');
  console.log('   ✅ PASS: Pending attachment rejected during finalization');

  // TEST 42: (Case D) Nonexistent attachment in payload -> FAIL ATTACHMENT_NOT_FOUND
  markTest('Security 000003 [Case D]: Annotation trên attachment không tồn tại bị từ chối (ATTACHMENT_NOT_FOUND)');
  const notFoundRes = await db.query(`
    SELECT public.finalize_academic_submission_grading_with_annotations(
      '${subSec1Id}',
      '[{"question_id": "${question2Id}", "points_earned": 3.0}]'::jsonb,
      '[{"attachment_id": "99999999-9999-9999-9999-999999999999", "expected_version": 0, "annotation_json": {"strokes": []}}]'::jsonb,
      'Feedback test',
      false
    ) as result;
  `);
  assert.equal(notFoundRes.rows[0].result.success, false);
  assert.equal(notFoundRes.rows[0].result.error, 'ATTACHMENT_NOT_FOUND');
  console.log('   ✅ PASS: Nonexistent attachment rejected');

  // TEST 43: (Case E) Duplicate attachment_id in same payload -> FAIL DUPLICATE_ATTACHMENT
  markTest('Security 000003 [Case E]: Trùng lặp attachment_id trong cùng payload bị từ chối (DUPLICATE_ATTACHMENT)');
  const dupAttRes = await db.query(`
    SELECT public.finalize_academic_submission_grading_with_annotations(
      '${subSec1Id}',
      '[{"question_id": "${question2Id}", "points_earned": 3.0}]'::jsonb,
      '[
        {"attachment_id": "${attFinal1Id}", "expected_version": 0, "annotation_json": {"strokes": []}},
        {"attachment_id": "${attFinal1Id}", "expected_version": 0, "annotation_json": {"strokes": []}}
      ]'::jsonb,
      'Feedback test',
      false
    ) as result;
  `);
  assert.equal(dupAttRes.rows[0].result.success, false);
  assert.equal(dupAttRes.rows[0].result.error, 'DUPLICATE_ATTACHMENT');
  console.log('   ✅ PASS: Duplicate attachment in same payload caught');

  // TEST 44: (Case F) Duplicate idempotency_key across different items in payload -> FAIL DUPLICATE_IDEMPOTENCY_KEY
  markTest('Security 000003 [Case F]: Trùng lặp idempotency_key giữa 2 items khác nhau trong payload (DUPLICATE_IDEMPOTENCY_KEY)');
  const dupKeyRes = await db.query(`
    SELECT public.finalize_academic_submission_grading_with_annotations(
      '${subSec1Id}',
      '[{"question_id": "${question2Id}", "points_earned": 3.0}]'::jsonb,
      '[
        {"attachment_id": "${attFinal1Id}", "idempotency_key": "77777777-7777-7777-7777-777777777771", "expected_version": 0, "annotation_json": {"strokes": []}},
        {"attachment_id": "${attFinal2Id}", "idempotency_key": "77777777-7777-7777-7777-777777777771", "expected_version": 0, "annotation_json": {"strokes": []}}
      ]'::jsonb,
      'Feedback test',
      false
    ) as result;
  `);
  assert.equal(dupKeyRes.rows[0].result.success, false);
  assert.equal(dupKeyRes.rows[0].result.error, 'DUPLICATE_IDEMPOTENCY_KEY');
  console.log('   ✅ PASS: Duplicate idempotency_key in payload caught');

  // TEST 45: (Case G) Existing idempotency key tied to another attachment -> FAIL IDEMPOTENCY_KEY_MISMATCH
  markTest('Security 000003 [Case G]: Idempotency key đã gắn với attachment khác trong DB -> Rejected (IDEMPOTENCY_KEY_MISMATCH)');
  const keyReuseMismatch = '77777777-7777-7777-7777-777777777772';
  await db.exec('SET ROLE postgres; SET app.current_user_id = \'\';');
  await db.exec(`
    INSERT INTO public.academic_submission_annotation_versions (
      submission_id, attachment_id, teacher_id, version, status, schema_version, annotation_json, idempotency_key
    ) VALUES (
      '${subSec2Id}', '${attOtherSubId}', '${teacherBId}', 1, 'final', 1, '{"strokes":[]}'::jsonb, '${keyReuseMismatch}'
    );
  `);
  await setAuthUser(teacherBId);
  const mismatchKeyRes = await db.query(`
    SELECT public.finalize_academic_submission_grading_with_annotations(
      '${subSec1Id}',
      '[{"question_id": "${question2Id}", "points_earned": 3.0}]'::jsonb,
      '[{"attachment_id": "${attFinal1Id}", "idempotency_key": "${keyReuseMismatch}", "expected_version": 0, "annotation_json": {"strokes": []}}]'::jsonb,
      'Feedback test',
      false
    ) as result;
  `);
  assert.equal(mismatchKeyRes.rows[0].result.success, false);
  assert.equal(mismatchKeyRes.rows[0].result.error, 'IDEMPOTENCY_KEY_MISMATCH');
  console.log('   ✅ PASS: Idempotency key reuse across different attachments strictly blocked');

  // TEST 46: (Case I) Annotation payload > 512KiB -> FAIL PAYLOAD_TOO_LARGE
  markTest('Security 000003 [Case I]: Dung lượng annotation_json > 512KiB bị từ chối (PAYLOAD_TOO_LARGE)');
  const largeAnnotationJson = { strokes: [], largeData: 'A'.repeat(530000) };
  const largePayloadRes = await db.query(`
    SELECT public.finalize_academic_submission_grading_with_annotations(
      '${subSec1Id}',
      '[{"question_id": "${question2Id}", "points_earned": 3.0}]'::jsonb,
      $1::jsonb,
      'Feedback test',
      false
    ) as result;
  `, [JSON.stringify([{ attachment_id: attFinal1Id, expected_version: 0, annotation_json: largeAnnotationJson }])]);
  assert.equal(largePayloadRes.rows[0].result.success, false);
  assert.equal(largePayloadRes.rows[0].result.error, 'PAYLOAD_TOO_LARGE');
  console.log('   ✅ PASS: Payload exceeding 512KiB limit rejected');

  // TEST 47: (Case A & H) Valid finalized attachment & Safe Idempotent Retry
  markTest('Security 000003 [Case A & H]: Chấm bài thành công và retry an toàn với cùng idempotency key (deduplication)');
  const validKey1 = '77777777-7777-7777-7777-777777777773';
  const validKey2 = '77777777-7777-7777-7777-777777777774';
  const validAnnPayload = [
    { attachment_id: attFinal1Id, idempotency_key: validKey1, expected_version: 0, annotation_json: { strokes: [{ tool: 'pen' }] } },
    { attachment_id: attFinal2Id, idempotency_key: validKey2, expected_version: 0, annotation_json: { strokes: [{ tool: 'stamp' }] } }
  ];

  // Lần 1: Chấm thành công
  const finSec1Res = await db.query(`
    SELECT public.finalize_academic_submission_grading_with_annotations(
      '${subSec1Id}',
      '[{"question_id": "${question2Id}", "points_earned": 4.0, "teacher_comment": "Làm bài rất tốt"}]'::jsonb,
      $1::jsonb,
      'Nhận xét chung',
      false
    ) as result;
  `, [JSON.stringify(validAnnPayload)]);
  assert.equal(finSec1Res.rows[0].result.success, true);
  assert.equal(finSec1Res.rows[0].result.status, 'graded');
  assert.equal(Number(finSec1Res.rows[0].result.total_score), 8.0); // 4 objective + 4 manual

  // Lần 2: Retry với cùng payload (cùng idempotency keys) -> Không xung đột, deduplicated
  const retrySec1Res = await db.query(`
    SELECT public.finalize_academic_submission_grading_with_annotations(
      '${subSec1Id}',
      '[{"question_id": "${question2Id}", "points_earned": 4.0, "teacher_comment": "Làm bài rất tốt"}]'::jsonb,
      $1::jsonb,
      'Nhận xét chung',
      false
    ) as result;
  `, [JSON.stringify(validAnnPayload)]);
  assert.equal(retrySec1Res.rows[0].result.success, true);
  console.log('   ✅ PASS: Valid attachment grading & safe idempotent retry verified');

  // TEST 48: (Case J & K) Normal grading without annotations & Reward stars
  markTest('Security 000003 [Case J & K]: Chấm bài bình thường không annotation, tính điểm & thưởng sao chính xác');
  const subNormalId = 'dd333333-3333-3333-3333-333333333339';
  await db.exec('SET ROLE postgres; SET app.current_user_id = \'\';');
  await db.exec(`
    INSERT INTO public.academic_submissions (id, exercise_id, student_id, attempt_number, status, objective_score, max_score) VALUES
      ('${subNormalId}', '${exerciseAId}', '${studentAId}', 4, 'submitted', 2.00, 10.00);
    INSERT INTO public.academic_submission_answers (submission_id, question_id, points_earned) VALUES
      ('${subNormalId}', '${question2Id}', 0);
  `);
  await setAuthUser(teacherBId);
  const starsBefore = (await db.query(`SELECT total_stars FROM public.profiles WHERE id = '${studentAId}'`)).rows[0].total_stars;

  const normalGradingRes = await db.query(`
    SELECT public.finalize_academic_submission_grading_with_annotations(
      '${subNormalId}',
      '[{"question_id": "${question2Id}", "points_earned": 4.0}]'::jsonb,
      '[]'::jsonb,
      'Chấm không kèm annotation',
      false
    ) as result;
  `);
  assert.equal(normalGradingRes.rows[0].result.success, true);
  assert.equal(Number(normalGradingRes.rows[0].result.total_score), 6.0);
  assert.equal(Number(normalGradingRes.rows[0].result.reward_stars_awarded), 6); // 10 * (6/10) = 6 sao

  const starsAfter = (await db.query(`SELECT total_stars FROM public.profiles WHERE id = '${studentAId}'`)).rows[0].total_stars;
  assert.equal(Number(starsAfter), Number(starsBefore) + 6);
  console.log('   ✅ PASS: Normal grading & reward stars calculation verified');

  // TEST 49: (Case L) Revision Requested behavior
  markTest('Security 000003 [Case L]: Yêu cầu làm lại (revision_requested) chuyển đúng status và không trao sao');
  const subRevId = 'dd333333-3333-3333-3333-333333333338';
  await db.exec('SET ROLE postgres; SET app.current_user_id = \'\';');
  await db.exec(`
    INSERT INTO public.academic_submissions (id, exercise_id, student_id, attempt_number, status, objective_score, max_score) VALUES
      ('${subRevId}', '${exerciseAId}', '${studentAId}', 5, 'submitted', 1.00, 10.00);
    INSERT INTO public.academic_submission_answers (submission_id, question_id, points_earned) VALUES
      ('${subRevId}', '${question2Id}', 0);
  `);
  await setAuthUser(teacherBId);
  const revRes = await db.query(`
    SELECT public.finalize_academic_submission_grading_with_annotations(
      '${subRevId}',
      '[{"question_id": "${question2Id}", "points_earned": 1.0}]'::jsonb,
      '[]'::jsonb,
      'Yêu cầu con làm lại bài',
      true
    ) as result;
  `);
  assert.equal(revRes.rows[0].result.success, true);
  assert.equal(revRes.rows[0].result.status, 'revision_requested');
  assert.equal(Number(revRes.rows[0].result.reward_stars_awarded), 0);
  console.log('   ✅ PASS: Revision requested behavior verified (status=revision_requested, 0 stars awarded)');

  // TEST 50: (Case D) Missing idempotency key single item -> PASS & exactly one final version inserted
  markTest('Security 000003 [Case D]: Payload không truyền idempotency_key (single item) -> Thành công và tạo 1 version final');
  const subMissingKey1Id = 'dd555555-5555-5555-5555-555555555551';
  const attMissingKey1Id = 'aa555555-5555-5555-5555-555555555551';
  await db.exec('SET ROLE postgres; SET app.current_user_id = \'\';');
  await db.exec(`
    INSERT INTO public.academic_submissions (id, exercise_id, student_id, attempt_number, status, objective_score, max_score) VALUES
      ('${subMissingKey1Id}', '${exerciseAId}', '${studentAId}', 6, 'submitted', 3.00, 10.00);
    INSERT INTO public.academic_submission_answers (submission_id, question_id, points_earned) VALUES
      ('${subMissingKey1Id}', '${question2Id}', 0);
    INSERT INTO public.academic_submission_attachments (
      id, submission_id, question_id, student_id, original_file_name, byte_size, mime_type, storage_bucket, storage_path, upload_status, sort_order, created_by
    ) VALUES
      ('${attMissingKey1Id}', '${subMissingKey1Id}', '${question2Id}', '${studentAId}', 'missing1.png', 50000, 'image/png', 'exercise-submissions', 'students/${studentAId}/submissions/${subMissingKey1Id}/attachments/${attMissingKey1Id}/original.png', 'finalized', 0, '${studentAId}');
  `);
  await setAuthUser(teacherBId);
  const finMissing1Res = await db.query(`
    SELECT public.finalize_academic_submission_grading_with_annotations(
      '${subMissingKey1Id}',
      '[{"question_id": "${question2Id}", "points_earned": 4.0}]'::jsonb,
      '[{"attachment_id": "${attMissingKey1Id}", "expected_version": 0, "annotation_json": {"strokes": []}}]'::jsonb,
      'Feedback missing key 1',
      false
    ) as result;
  `);
  assert.equal(finMissing1Res.rows[0].result.success, true);
  const checkMissingVer1 = await db.query(`
    SELECT * FROM public.academic_submission_annotation_versions WHERE attachment_id = '${attMissingKey1Id}';
  `);
  assert.equal(checkMissingVer1.rows.length, 1);
  assert.ok(checkMissingVer1.rows[0].idempotency_key !== null);
  console.log('   ✅ PASS: Missing key single item successfully inserted with auto-generated UUID in PASS 2');

  // TEST 51: (Case E) Missing key on two different attachments -> PASS & each receives distinct DB idempotency key
  markTest('Security 000003 [Case E]: Payload không truyền idempotency_key trên 2 attachments -> Thành công và nhận 2 UUID khác nhau');
  const subMissingKey2Id = 'dd555555-5555-5555-5555-555555555552';
  const attMissingKey2AId = 'aa555555-5555-5555-5555-555555555552';
  const attMissingKey2BId = 'aa555555-5555-5555-5555-555555555553';
  await db.exec('SET ROLE postgres; SET app.current_user_id = \'\';');
  await db.exec(`
    INSERT INTO public.academic_submissions (id, exercise_id, student_id, attempt_number, status, objective_score, max_score) VALUES
      ('${subMissingKey2Id}', '${exerciseAId}', '${studentAId}', 7, 'submitted', 2.00, 10.00);
    INSERT INTO public.academic_submission_answers (submission_id, question_id, points_earned) VALUES
      ('${subMissingKey2Id}', '${question2Id}', 0);
    INSERT INTO public.academic_submission_attachments (
      id, submission_id, question_id, student_id, original_file_name, byte_size, mime_type, storage_bucket, storage_path, upload_status, sort_order, created_by
    ) VALUES
      ('${attMissingKey2AId}', '${subMissingKey2Id}', '${question2Id}', '${studentAId}', 'multi1.png', 50000, 'image/png', 'exercise-submissions', 'students/${studentAId}/submissions/${subMissingKey2Id}/attachments/${attMissingKey2AId}/original.png', 'finalized', 0, '${studentAId}'),
      ('${attMissingKey2BId}', '${subMissingKey2Id}', '${question2Id}', '${studentAId}', 'multi2.png', 60000, 'image/png', 'exercise-submissions', 'students/${studentAId}/submissions/${subMissingKey2Id}/attachments/${attMissingKey2BId}/original.png', 'finalized', 1, '${studentAId}');
  `);
  await setAuthUser(teacherBId);
  const finMissing2Res = await db.query(`
    SELECT public.finalize_academic_submission_grading_with_annotations(
      '${subMissingKey2Id}',
      '[{"question_id": "${question2Id}", "points_earned": 4.0}]'::jsonb,
      '[
        {"attachment_id": "${attMissingKey2AId}", "expected_version": 0, "annotation_json": {"strokes": []}},
        {"attachment_id": "${attMissingKey2BId}", "expected_version": 0, "annotation_json": {"strokes": []}}
      ]'::jsonb,
      'Feedback multi missing key',
      false
    ) as result;
  `);
  assert.equal(finMissing2Res.rows[0].result.success, true);
  const checkMissingVer2 = await db.query(`
    SELECT attachment_id, idempotency_key FROM public.academic_submission_annotation_versions
    WHERE submission_id = '${subMissingKey2Id}' ORDER BY created_at ASC;
  `);
  assert.equal(checkMissingVer2.rows.length, 2);
  assert.notEqual(checkMissingVer2.rows[0].idempotency_key, checkMissingVer2.rows[1].idempotency_key);
  console.log('   ✅ PASS: Missing key on multi-attachment generated distinct idempotency keys per item');

  // TEST 52: (Case G) Malformed expected_version string ("not_a_number") -> FAIL INVALID_EXPECTED_VERSION
  markTest('Security 000003 [Case G]: expected_version dạng chuỗi không hợp lệ ("not_a_number") -> Rejected (INVALID_EXPECTED_VERSION)');
  const badExpVerRes = await db.query(`
    SELECT public.finalize_academic_submission_grading_with_annotations(
      '${subMissingKey1Id}',
      '[{"question_id": "${question2Id}", "points_earned": 4.0}]'::jsonb,
      '[{"attachment_id": "${attMissingKey1Id}", "expected_version": "not_a_number", "annotation_json": {"strokes": []}}]'::jsonb,
      'Feedback bad expected_version',
      false
    ) as result;
  `);
  assert.equal(badExpVerRes.rows[0].result.success, false);
  assert.equal(badExpVerRes.rows[0].result.error, 'INVALID_EXPECTED_VERSION');
  console.log('   ✅ PASS: Malformed string expected_version rejected with structured error');

  // TEST 53: (Case G) Malformed expected_version float ("3.14") -> FAIL INVALID_EXPECTED_VERSION
  markTest('Security 000003 [Case G]: expected_version dạng số thực ("3.14") -> Rejected (INVALID_EXPECTED_VERSION)');
  const floatExpVerRes = await db.query(`
    SELECT public.finalize_academic_submission_grading_with_annotations(
      '${subMissingKey1Id}',
      '[{"question_id": "${question2Id}", "points_earned": 4.0}]'::jsonb,
      '[{"attachment_id": "${attMissingKey1Id}", "expected_version": "3.14", "annotation_json": {"strokes": []}}]'::jsonb,
      'Feedback float expected_version',
      false
    ) as result;
  `);
  assert.equal(floatExpVerRes.rows[0].result.success, false);
  assert.equal(floatExpVerRes.rows[0].result.error, 'INVALID_EXPECTED_VERSION');
  console.log('   ✅ PASS: Float expected_version rejected with structured error');

  // TEST 54: (Case H) Missing / null expected_version -> Bypasses OCC conflict check
  markTest('Security 000003 [Case H]: Không truyền expected_version hoặc truyền null -> Chấm điểm thành công không OCC check');
  const nullExpVerRes = await db.query(`
    SELECT public.finalize_academic_submission_grading_with_annotations(
      '${subMissingKey1Id}',
      '[{"question_id": "${question2Id}", "points_earned": 4.0}]'::jsonb,
      '[{"attachment_id": "${attMissingKey1Id}", "annotation_json": {"strokes": []}}]'::jsonb,
      'Feedback null expected_version',
      false
    ) as result;
  `);
  assert.equal(nullExpVerRes.rows[0].result.success, true);
  console.log('   ✅ PASS: Omitted expected_version handled safely without OCC conflict');

  // TEST 55: (Case F) Static Contract Assertion: PASS 1 không sinh gen_random_uuid()
  markTest('Security 000003 [Case F]: Static Contract: Xác minh PASS 1 hoàn toàn không gọi gen_random_uuid()');
  const migration3Content = fs.readFileSync(migration3Path, 'utf8');
  const pass1Section = migration3Content.split('-- PASS 1: PRE-VALIDATION LOOP')[1].split('-- PASS 2: EXECUTION / INSERTION LOOP')[0];
  const pass2Section = migration3Content.split('-- PASS 2: EXECUTION / INSERTION LOOP')[1];
  assert.equal(pass1Section.includes('gen_random_uuid()'), false, 'PASS 1 must NOT generate random UUID');
  assert.equal(pass2Section.includes('gen_random_uuid()'), true, 'PASS 2 must generate random UUID only if missing');
  console.log('   ✅ PASS: Static contract verified (PASS 1 purely validates, PASS 2 generates UUID on-demand)');

  // ============================================================================
  // NHÓM 7: SECURITY HOTFIX 000004 — STUDENT GRADED SUBMISSION STATUS GATE & CONTRACT TESTS
  // ============================================================================
  console.log('\n================================================================================');
  console.log('🛡️ NHÓM 7: SECURITY HOTFIX 000004 — STUDENT GRADED SUBMISSION STATUS GATE');
  console.log('================================================================================\n');

  // Chuẩn bị Mock Submissions cho các trạng thái của Student A
  const gateSubDraftId = '77777777-0001-0000-0000-000000000001';
  const gateSubSubmittedId = '77777777-0002-0000-0000-000000000002';
  const gateSubPendingId = '77777777-0003-0000-0000-000000000003';
  const gateSubGradedId = '77777777-0004-0000-0000-000000000004';
  const gateSubRevisionId = '77777777-0005-0000-0000-000000000005';

  await db.exec('SET ROLE postgres; SET app.current_user_id = \'\';');

  await db.exec(`
    INSERT INTO public.academic_submissions (id, exercise_id, student_id, attempt_number, status, objective_score, manual_score, total_score, max_score, teacher_feedback, submitted_at, graded_at) VALUES
      ('${gateSubDraftId}', '${exerciseAId}', '${studentAId}', 10, 'draft', 0, 0, 0, 10.00, NULL, NULL, NULL),
      ('${gateSubSubmittedId}', '${exerciseAId}', '${studentAId}', 11, 'submitted', 5.0, 0, 5.0, 10.00, NULL, NOW(), NULL),
      ('${gateSubPendingId}', '${exerciseAId}', '${studentAId}', 12, 'pending_manual_grade', 5.0, 0, 5.0, 10.00, NULL, NOW(), NULL),
      ('${gateSubGradedId}', '${exerciseAId}', '${studentAId}', 13, 'graded', 5.0, 4.5, 9.5, 10.00, 'Bài làm rất tốt', NOW() - INTERVAL '1 hour', NOW()),
      ('${gateSubRevisionId}', '${exerciseAId}', '${studentAId}', 14, 'revision_requested', 4.0, 2.0, 6.0, 10.00, 'Cần vẽ lại hình 1', NOW() - INTERVAL '2 hours', NOW());

    -- Answers for gateSubGradedId
    INSERT INTO public.academic_submission_answers (id, submission_id, question_id, student_answer_json, points_earned, is_correct, teacher_comment) VALUES
      (gen_random_uuid(), '${gateSubGradedId}', '${question1Id}', '{"selected_option": "A"}'::jsonb, 5.0, true, 'Đúng'),
      (gen_random_uuid(), '${gateSubGradedId}', '${question2Id}', '{"text": "Lời giải tự luận"}'::jsonb, 4.5, true, 'Tốt');
  `);

  // Chuẩn bị Attachments cho gateSubGradedId:
  // 1. finalized attachment có final annotation
  // 2. finalized attachment chỉ có draft annotation (không có final)
  // 3. pending attachment (chưa finalized)
  const gateAttFinalWithFinalAnnId = '88888888-0001-0000-0000-000000000001';
  const gateAttFinalWithDraftAnnId = '88888888-0002-0000-0000-000000000002';
  const gateAttPendingUploadId = '88888888-0003-0000-0000-000000000003';

  await db.exec(`
    INSERT INTO public.academic_submission_attachments (
      id, submission_id, question_id, student_id, storage_bucket, storage_path, original_file_name,
      mime_type, byte_size, width, height, sort_order, upload_status, created_by
    ) VALUES
      ('${gateAttFinalWithFinalAnnId}', '${gateSubGradedId}', '${question2Id}', '${studentAId}', 'exercise-submissions', 'test/final_ann.png', 'final_ann.png', 'image/png', 100000, 1920, 1080, 0, 'finalized', '${studentAId}'),
      ('${gateAttFinalWithDraftAnnId}', '${gateSubGradedId}', '${question2Id}', '${studentAId}', 'exercise-submissions', 'test/draft_ann.png', 'draft_ann.png', 'image/png', 100000, 1920, 1080, 1, 'finalized', '${studentAId}'),
      ('${gateAttPendingUploadId}', '${gateSubGradedId}', '${question2Id}', '${studentAId}', 'exercise-submissions', 'test/pending.png', 'pending.png', 'image/png', 100000, 1920, 1080, 2, 'pending', '${studentAId}');

    -- Annotation cho gateAttFinalWithFinalAnnId: version 1 draft, version 2 final
    INSERT INTO public.academic_submission_annotation_versions (
      id, submission_id, attachment_id, version, schema_version, status, annotation_json, teacher_id, idempotency_key
    ) VALUES
      (gen_random_uuid(), '${gateSubGradedId}', '${gateAttFinalWithFinalAnnId}', 1, 1, 'draft', '{"strokes": [{"type": "draft_stroke"}]}'::jsonb, '${teacherBId}', '99999999-0001-0000-0000-000000000001'),
      (gen_random_uuid(), '${gateSubGradedId}', '${gateAttFinalWithFinalAnnId}', 2, 1, 'final', '{"strokes": [{"type": "final_stamp"}]}'::jsonb, '${teacherBId}', '99999999-0002-0000-0000-000000000002');

    -- Annotation cho gateAttFinalWithDraftAnnId: chỉ có version 1 draft
    INSERT INTO public.academic_submission_annotation_versions (
      id, submission_id, attachment_id, version, schema_version, status, annotation_json, teacher_id, idempotency_key
    ) VALUES
      (gen_random_uuid(), '${gateSubGradedId}', '${gateAttFinalWithDraftAnnId}', 1, 1, 'draft', '{"strokes": [{"type": "draft_only"}]}'::jsonb, '${teacherBId}', '99999999-0003-0000-0000-000000000003');
  `);

  // TEST 56: (Case A) Student own draft -> SUBMISSION_NOT_GRADED
  markTest('Gate 000004 [Case A]: Học sinh chính chủ xem bài status "draft" -> Rejected (SUBMISSION_NOT_GRADED)');
  await setAuthUser(studentAId);
  const gateDraftRes = await db.query(`SELECT public.get_student_graded_submission('${gateSubDraftId}') as result;`);
  assert.equal(gateDraftRes.rows[0].result.success, false);
  assert.equal(gateDraftRes.rows[0].result.error, 'SUBMISSION_NOT_GRADED');
  assert.equal(gateDraftRes.rows[0].result.message, 'Bài làm chưa được chấm hoàn tất.');
  console.log('   ✅ PASS: Student own draft access blocked');

  // TEST 57: (Case B) Student own submitted -> SUBMISSION_NOT_GRADED
  markTest('Gate 000004 [Case B]: Học sinh chính chủ xem bài status "submitted" -> Rejected (SUBMISSION_NOT_GRADED)');
  await setAuthUser(studentAId);
  const gateSubRes = await db.query(`SELECT public.get_student_graded_submission('${gateSubSubmittedId}') as result;`);
  assert.equal(gateSubRes.rows[0].result.success, false);
  assert.equal(gateSubRes.rows[0].result.error, 'SUBMISSION_NOT_GRADED');
  assert.equal(gateSubRes.rows[0].result.message, 'Bài làm chưa được chấm hoàn tất.');
  console.log('   ✅ PASS: Student own submitted access blocked');

  // TEST 58: (Case C) Student own pending_manual_grade -> SUBMISSION_NOT_GRADED
  markTest('Gate 000004 [Case C]: Học sinh chính chủ xem bài status "pending_manual_grade" -> Rejected (SUBMISSION_NOT_GRADED)');
  await setAuthUser(studentAId);
  const gatePendRes = await db.query(`SELECT public.get_student_graded_submission('${gateSubPendingId}') as result;`);
  assert.equal(gatePendRes.rows[0].result.success, false);
  assert.equal(gatePendRes.rows[0].result.error, 'SUBMISSION_NOT_GRADED');
  assert.equal(gatePendRes.rows[0].result.message, 'Bài làm chưa được chấm hoàn tất.');
  console.log('   ✅ PASS: Student own pending_manual_grade access blocked');

  // TEST 59: (Case D) Student own graded -> success: true
  markTest('Gate 000004 [Case D]: Học sinh chính chủ xem bài status "graded" -> ALLOWED (success: true)');
  await setAuthUser(studentAId);
  const gateGradedRes = await db.query(`SELECT public.get_student_graded_submission('${gateSubGradedId}') as result;`);
  assert.equal(gateGradedRes.rows[0].result.success, true);
  assert.equal(gateGradedRes.rows[0].result.submission.status, 'graded');
  console.log('   ✅ PASS: Student own graded access allowed');

  // TEST 60: (Case E) Student own revision_requested -> success: true
  markTest('Gate 000004 [Case E]: Học sinh chính chủ xem bài status "revision_requested" -> ALLOWED (success: true)');
  await setAuthUser(studentAId);
  const gateRevRes = await db.query(`SELECT public.get_student_graded_submission('${gateSubRevisionId}') as result;`);
  assert.equal(gateRevRes.rows[0].result.success, true);
  assert.equal(gateRevRes.rows[0].result.submission.status, 'revision_requested');
  console.log('   ✅ PASS: Student own revision_requested access allowed');

  // TEST 61: (Case F) Student other submission -> FORBIDDEN
  markTest('Gate 000004 [Case F]: Học sinh B xem bài graded của Học sinh A -> Rejected (FORBIDDEN)');
  await setAuthUser(studentBId);
  const gateCrossRes = await db.query(`SELECT public.get_student_graded_submission('${gateSubGradedId}') as result;`);
  assert.equal(gateCrossRes.rows[0].result.success, false);
  assert.equal(gateCrossRes.rows[0].result.error, 'FORBIDDEN');
  console.log('   ✅ PASS: Cross-student graded access rejected with FORBIDDEN');

  // TEST 62: (Case G) Teacher owns class + submitted -> success: true
  markTest('Gate 000004 [Case G]: Giáo viên phụ trách lớp xem bài status "submitted" -> ALLOWED (Bypasses student gate)');
  await setAuthUser(teacherBId);
  const gateTeachSubRes = await db.query(`SELECT public.get_student_graded_submission('${gateSubSubmittedId}') as result;`);
  assert.equal(gateTeachSubRes.rows[0].result.success, true);
  assert.equal(gateTeachSubRes.rows[0].result.submission.status, 'submitted');
  console.log('   ✅ PASS: Teacher can access submitted submission');

  // TEST 63: (Case H) Teacher owns class + pending_manual_grade -> success: true
  markTest('Gate 000004 [Case H]: Giáo viên phụ trách lớp xem bài status "pending_manual_grade" -> ALLOWED (Bypasses student gate)');
  await setAuthUser(teacherBId);
  const gateTeachPendRes = await db.query(`SELECT public.get_student_graded_submission('${gateSubPendingId}') as result;`);
  assert.equal(gateTeachPendRes.rows[0].result.success, true);
  assert.equal(gateTeachPendRes.rows[0].result.submission.status, 'pending_manual_grade');
  console.log('   ✅ PASS: Teacher can access pending_manual_grade submission');

  // TEST 64: (Case I) Admin + submitted -> success: true
  markTest('Gate 000004 [Case I]: Admin xem bài status "submitted" -> ALLOWED (Bypasses student gate)');
  await setAuthUser(adminId);
  const gateAdminSubRes = await db.query(`SELECT public.get_student_graded_submission('${gateSubSubmittedId}') as result;`);
  assert.equal(gateAdminSubRes.rows[0].result.success, true);
  assert.equal(gateAdminSubRes.rows[0].result.submission.status, 'submitted');
  console.log('   ✅ PASS: Admin can access submitted submission');

  // TEST 65: (Case J) Draft annotation exists -> final_annotation is null
  markTest('Gate 000004 [Case J]: Attachment chỉ có draft annotation -> final_annotation là null trong response');
  await setAuthUser(studentAId);
  const gradedPayload = gateGradedRes.rows[0].result;
  const draftOnlyAtt = gradedPayload.attachments.find(a => a.id === gateAttFinalWithDraftAnnId);
  assert.ok(draftOnlyAtt, 'Attachment with draft-only annotation must be present');
  assert.equal(draftOnlyAtt.final_annotation, null);
  console.log('   ✅ PASS: Draft-only annotation hidden as final_annotation = null');

  // TEST 66: (Case K) Final annotation exists -> returned
  markTest('Gate 000004 [Case K]: Attachment có final annotation -> final_annotation được trả về chính xác (version 2)');
  const finalAnnAtt = gradedPayload.attachments.find(a => a.id === gateAttFinalWithFinalAnnId);
  assert.ok(finalAnnAtt, 'Attachment with final annotation must be present');
  assert.ok(finalAnnAtt.final_annotation !== null, 'final_annotation must not be null');
  assert.equal(finalAnnAtt.final_annotation.version, 2);
  assert.equal(finalAnnAtt.final_annotation.annotation_json.strokes[0].type, 'final_stamp');
  console.log('   ✅ PASS: Final annotation returned with full details');

  // TEST 67: (Case L) Pending attachment exists -> not returned
  markTest('Gate 000004 [Case L]: Attachment có upload_status = "pending" -> Không xuất hiện trong danh sách attachments');
  const pendingAtt = gradedPayload.attachments.find(a => a.id === gateAttPendingUploadId);
  assert.equal(pendingAtt, undefined, 'Pending attachment must NOT be returned');
  assert.equal(gradedPayload.attachments.length, 2, 'Only 2 finalized attachments must be returned');
  console.log('   ✅ PASS: Unfinalized pending attachments hidden from response');

  // TEST 68: (Case M / Contract Test) Xác minh Response Contract JSON shape
  markTest('Gate 000004 [Case M]: Response Contract Shape Verification (Không đổi contract frontend Step E)');
  const topKeys = Object.keys(gradedPayload).sort();
  assert.deepEqual(topKeys, ['answers', 'attachments', 'questions', 'submission', 'success'].sort());

  const sub = gradedPayload.submission;
  assert.ok(sub.id, 'submission.id required');
  assert.ok(sub.exercise_id, 'submission.exercise_id required');
  assert.equal(sub.status, 'graded');
  assert.notEqual(sub.objective_score, undefined);
  assert.notEqual(sub.manual_score, undefined);
  assert.notEqual(sub.total_score, undefined);
  assert.notEqual(sub.max_score, undefined);
  assert.notEqual(sub.teacher_feedback, undefined);
  assert.notEqual(sub.submitted_at, undefined);
  assert.notEqual(sub.graded_at, undefined);
  assert.ok(sub.exercise, 'submission.exercise required');
  assert.equal(sub.exercise.id, exerciseAId);

  assert.ok(Array.isArray(gradedPayload.questions), 'questions must be array');
  assert.ok(gradedPayload.questions.length > 0, 'questions must not be empty');
  const q1 = gradedPayload.questions[0];
  assert.ok(q1.id && q1.question_number !== undefined && q1.question_type && q1.prompt && q1.points !== undefined);

  assert.ok(Array.isArray(gradedPayload.answers), 'answers must be array');
  assert.ok(gradedPayload.answers.length > 0, 'answers must not be empty');
  const ans1 = gradedPayload.answers[0];
  assert.ok(ans1.id && ans1.question_id && ans1.points_earned !== undefined);

  assert.ok(Array.isArray(gradedPayload.attachments), 'attachments must be array');
  const att1 = gradedPayload.attachments[0];
  assert.ok(att1.id && att1.question_id && att1.storage_bucket && att1.storage_path && att1.original_file_name);
  assert.ok(att1.mime_type && att1.byte_size !== undefined && att1.width !== undefined && att1.height !== undefined);

  console.log('   ✅ PASS: Complete Response Contract Shape strictly verified');

  console.log(`\n🎉 TOÀN BỘ ${totalTests}/${totalTests} TEST CASES BẢO MẬT & CHỨC NĂNG ĐÃ PASS 100%!\n`);
}

runImageAnnotationTestSuite().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
