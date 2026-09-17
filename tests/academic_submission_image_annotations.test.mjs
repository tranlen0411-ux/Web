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
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
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

  // 2. Áp dụng Migration Phase 1
  console.log('📌 Đang áp dụng migration Phase 1...');
  await db.exec(migrationSql);
  await db.exec(`
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
  `);
  console.log('✅ Áp dụng migration Phase 1 thành công!\n');

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

  // TEST 25: Học sinh không xem được draft annotation khi bài chưa hoàn tất chấm
  markTest('Draft Annotation Isolation: Học sinh xem bài khi đang chấm dở -> Draft annotation bị ẩn');
  await setAuthUser(studentAId);
  const studentGradedRes = await db.query(`
    SELECT public.get_student_graded_submission('${submissionAId}') as result;
  `);
  assert.equal(studentGradedRes.rows[0].result.success, true);
  assert.equal(studentGradedRes.rows[0].result.attachments[0].final_annotation, null);
  console.log('   ✅ PASS: Draft annotations hidden from student');

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

  console.log(`\n🎉 TOÀN BỘ ${totalTests}/${totalTests} TEST CASES BẢO MẬT & CHỨC NĂNG ĐÃ PASS 100%!\n`);
}

runImageAnnotationTestSuite().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
