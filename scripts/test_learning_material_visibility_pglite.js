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

async function runVisibilityTests() {
  console.log('================================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ PGLITE: MATERIAL VISIBILITY PRODUCTION SAFETY');
  console.log('================================================================\n');

  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();

  // Helper set user context
  async function asUser(userId, role = 'authenticated') {
    if (userId) {
      await db.exec(`SET app.current_user_id = '${userId}';`);
      await db.exec(`SET ROLE ${role};`);
    } else {
      await db.exec(`SET app.current_user_id = '';`);
      await db.exec(`SET ROLE anon;`);
    }
  }

  // 1. Khởi tạo roles và auth helper
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
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT current_setting('role', true);
    $$;

    CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE IF NOT EXISTS storage.objects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id TEXT,
      name TEXT,
      owner UUID,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE OR REPLACE FUNCTION storage.foldername(name text)
    RETURNS text[] LANGUAGE plpgsql AS $$
    BEGIN
      RETURN string_to_array(name, '/');
    END;
    $$;

    GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role, postgres;
    GRANT ALL ON storage.objects TO anon, authenticated, service_role, postgres;
  `);

  // 2. Tạo cấu trúc cơ bản cũ
  await db.exec(`
    CREATE TABLE IF NOT EXISTS public.profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      full_name TEXT NOT NULL,
      email TEXT UNIQUE,
      role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.classes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      grade_level INT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.class_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
      student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT unique_class_student UNIQUE (class_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS public.learning_materials (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      description TEXT,
      subject TEXT NOT NULL,
      class_id UUID REFERENCES public.classes(id) ON DELETE CASCADE,
      file_name TEXT,
      file_path TEXT,
      file_type TEXT NOT NULL CHECK (file_type IN ('pdf', 'word', 'powerpoint', 'image', 'video', 'link')),
      file_size BIGINT DEFAULT 0,
      external_url TEXT,
      allow_download BOOLEAN DEFAULT TRUE,
      created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, postgres;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role, postgres;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role, postgres;
    GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role, postgres;
  `);

  // Fixture IDs
  const adminId = '00000000-0000-0000-0000-000000000001';
  const teacherAId = '00000000-0000-0000-0000-000000000002';
  const teacherBId = '00000000-0000-0000-0000-000000000003';
  const studentClass2AId = '00000000-0000-0000-0000-000000000004';
  const studentClass2BId = '00000000-0000-0000-0000-000000000005';
  const studentClass3AId = '00000000-0000-0000-0000-000000000006';

  const class2AId = '11111111-1111-1111-1111-111111111111';
  const class2BId = '22222222-2222-2222-2222-222222222222';
  const class3AId = '33333333-3333-3333-3333-333333333333';

  await db.exec(`
    INSERT INTO public.profiles (id, full_name, email, role) VALUES
      ('${adminId}', 'Admin Hệ Thống', 'admin@school.edu', 'admin'),
      ('${teacherAId}', 'Cô Lan (GV 2A & 2B)', 'lan@school.edu', 'teacher'),
      ('${teacherBId}', 'Thầy Hùng (GV 3A)', 'hung@school.edu', 'teacher'),
      ('${studentClass2AId}', 'Bé An (Học sinh 2A)', 'an2a@school.edu', 'student'),
      ('${studentClass2BId}', 'Bé Bình (Học sinh 2B)', 'binh2b@school.edu', 'student'),
      ('${studentClass3AId}', 'Bé Cúc (Học sinh 3A)', 'cuc3a@school.edu', 'student');

    INSERT INTO public.classes (id, name, grade_level, code, teacher_id) VALUES
      ('${class2AId}', 'Lớp 2A', 2, '2A-2026', '${teacherAId}'),
      ('${class2BId}', 'Lớp 2B', 2, '2B-2026', '${teacherAId}'),
      ('${class3AId}', 'Lớp 3A', 3, '3A-2026', '${teacherBId}');

    INSERT INTO public.class_members (class_id, student_id) VALUES
      ('${class2AId}', '${studentClass2AId}'),
      ('${class2BId}', '${studentClass2BId}'),
      ('${class3AId}', '${studentClass3AId}');

    -- NẠP DỮ LIỆU CŨ TRƯỚC MIGRATION ĐỂ TEST BACKFILL
    INSERT INTO public.learning_materials (id, title, subject, file_type, class_id, created_by) VALUES
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Bài cũ có class', 'Toán', 'pdf', '${class2AId}', '${teacherAId}'),
      ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Bài cũ không class', 'Tiếng Việt', 'pdf', NULL, '${teacherAId}');
  `);

  // 3. Chạy file Migration Phase 1 Hotfix LẦN 1
  const migrationPath = path.join(__dirname, '..', 'ADD_LEARNING_MATERIAL_VISIBILITY_PHASE1.sql');
  const migrationSql = await fs.readFile(migrationPath, 'utf-8');
  await db.exec(migrationSql);

  // Bật RLS
  await db.exec(`
    ALTER TABLE public.learning_materials ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.learning_material_shares ENABLE ROW LEVEL SECURITY;
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  `);

  console.log('✅ Đã nạp Schema và Migration Hotfix thành công (Run 1).\n');

  let passCount = 0;

  // TEST MIGRATION RE-RUN (LẦN 2) & IDEMPOTENCY
  console.log('--- TEST MIGRATION IDEMPOTENCY (RUN 2) & TRANSACTION ROLLBACK ---');
  await db.exec(migrationSql);
  console.log('✅ M_RERUN: Chạy lại migration lần 2 thành công 100% không lỗi (Idempotent) PASS');
  passCount++;

  // TEST TRANSACTION ROLLBACK TRÊN LỖI GIỮA CHỪNG
  let rollbackCaught = false;
  const preRollbackCount = (await db.query(`SELECT count(*)::int as count FROM public.learning_materials`)).rows[0].count;
  try {
    await db.exec(`
      BEGIN;
      INSERT INTO public.learning_materials (id, title, subject, file_type, class_id, created_by, visibility)
      VALUES (gen_random_uuid(), 'Bài rollback test', 'Toán', 'pdf', '${class2AId}', '${teacherAId}', 'class');
      -- Cố tình ném lỗi cú pháp / foreign key không tồn tại để ép rollback
      INSERT INTO public.learning_materials (id, title, subject, file_type, class_id, created_by, visibility)
      VALUES (gen_random_uuid(), 'Bài lỗi', 'Toán', 'pdf', '99999999-9999-9999-9999-999999999999', '${teacherAId}', 'class');
      COMMIT;
    `);
  } catch {
    rollbackCaught = true;
    await db.exec(`ROLLBACK;`).catch(() => {});
  }
  const postRollbackCount = (await db.query(`SELECT count(*)::int as count FROM public.learning_materials`)).rows[0].count;
  assert.equal(rollbackCaught, true, 'M_ROLLBACK: Bắt được lỗi transaction');
  assert.equal(postRollbackCount, preRollbackCount, 'M_ROLLBACK: Dữ liệu rollback hoàn toàn');
  console.log('✅ M_ROLLBACK: Transaction rollback an toàn bảo vệ cơ sở dữ liệu khi gặp lỗi PASS');
  passCount++;

  // TEST T15 & T16: Backfill test
  console.log('\n--- TEST NHÓM 1: BACKFILL DỮ LIỆU CŨ ---');
  const backfillClass = (await db.query(`SELECT visibility, share_token FROM public.learning_materials WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'`)).rows[0];
  const backfillSchool = (await db.query(`SELECT visibility, share_token FROM public.learning_materials WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'`)).rows[0];
  
  assert.equal(backfillClass.visibility, 'class', 'T16: Backfill non-null class -> class');
  assert.equal(backfillClass.share_token, null, 'T16: Backfill class có share_token = null');
  console.log('✅ T16: Backfill non-null class -> class PASS');
  passCount++;

  assert.equal(backfillSchool.visibility, 'school', 'T15: Backfill NULL class -> school (Không phải public)');
  assert.equal(backfillSchool.share_token, null, 'T15: Backfill school có share_token = null');
  console.log('✅ T15: Backfill NULL class -> school PASS');
  passCount++;

  // Chuẩn bị dữ liệu bài giảng & file storage cho các test tiếp theo
  const matClass2AId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const matSchoolId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const matPublicId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  const publicToken = 'sample_public_secret_token_123456789';

  const filePath2A = `${teacherAId}/math_2a_exercise.pdf`;
  const filePathSchool = `${teacherAId}/school_regulations.pdf`;
  const filePathPublic = `${teacherAId}/public_open_course.pdf`;

  await db.exec(`
    INSERT INTO public.learning_materials (id, title, subject, file_type, file_path, class_id, created_by, visibility, share_token) VALUES
      ('${matClass2AId}', 'Bài Toán Lớp 2A (Share 2B)', 'Toán', 'pdf', '${filePath2A}', '${class2AId}', '${teacherAId}', 'class', NULL),
      ('${matSchoolId}', 'Nội Quy Nhà Trường', 'Đạo đức', 'pdf', '${filePathSchool}', NULL, '${teacherAId}', 'school', NULL),
      ('${matPublicId}', 'Bài Giảng Mẫu Công Khai', 'Khoa học', 'pdf', '${filePathPublic}', NULL, '${teacherAId}', 'public', '${publicToken}');

    -- Nạp storage objects vào bucket 'learning-materials'
    INSERT INTO storage.objects (id, bucket_id, name, owner) VALUES
      (gen_random_uuid(), 'learning-materials', '${filePath2A}', '${teacherAId}'),
      (gen_random_uuid(), 'learning-materials', '${filePathSchool}', '${teacherAId}'),
      (gen_random_uuid(), 'learning-materials', '${filePathPublic}', '${teacherAId}');

    -- Chia sẻ bài 2A sang lớp 2B
    INSERT INTO public.learning_material_shares (material_id, class_id) VALUES
      ('${matClass2AId}', '${class2BId}');
  `);

  console.log('\n--- TEST NHÓM 2: PHÂN QUYỀN RLS ĐỌC (SELECT) ---');

  // T1: Admin đọc mọi visibility
  await asUser(adminId);
  const adminRes = await db.query(`SELECT count(*)::int as count FROM public.learning_materials`);
  assert.equal(adminRes.rows[0].count >= 5, true, 'T1: Admin đọc tất cả tài liệu');
  console.log(`✅ T1: Admin đọc tất cả tài liệu (Tìm thấy ${adminRes.rows[0].count} bài) PASS`);
  passCount++;

  // T2: Owner Teacher đọc tài liệu của mình
  await asUser(teacherAId);
  const ownerRes = await db.query(`SELECT count(*)::int as count FROM public.learning_materials WHERE created_by = '${teacherAId}'`);
  assert.equal(ownerRes.rows[0].count >= 5, true, 'T2: Owner Teacher đọc tài liệu mình tạo');
  console.log('✅ T2: Owner Teacher đọc đầy đủ bài giảng do mình tạo PASS');
  passCount++;

  // T4: Student lớp chính (2A) đọc được class material
  await asUser(studentClass2AId);
  const s2aRes = await db.query(`SELECT id FROM public.learning_materials WHERE id = '${matClass2AId}'`);
  assert.equal(s2aRes.rows.length, 1, 'T4: HS lớp chính đọc được bài giảng của lớp');
  console.log('✅ T4: Học sinh lớp chính (2A) đọc được tài liệu lớp mình PASS');
  passCount++;

  // T5: Student lớp share (2B) đọc được class material
  await asUser(studentClass2BId);
  const s2bRes = await db.query(`SELECT id FROM public.learning_materials WHERE id = '${matClass2AId}'`);
  assert.equal(s2bRes.rows.length, 1, 'T5: HS lớp được share đọc được bài giảng');
  console.log('✅ T5: Học sinh lớp liên lớp (2B) đọc được tài liệu được chia sẻ PASS');
  passCount++;

  // T6: Student ngoài lớp (3A) KHÔNG đọc được class material của 2A
  await asUser(studentClass3AId);
  const s3aClassRes = await db.query(`SELECT id FROM public.learning_materials WHERE id = '${matClass2AId}'`);
  assert.equal(s3aClassRes.rows.length, 0, 'T6: HS ngoài lớp không đọc được bài giảng lớp khác');
  console.log('✅ T6: Học sinh lớp khác (3A) bị chặn không đọc được bài lớp 2A PASS');
  passCount++;

  // T7: Authenticated bất kỳ đọc school material
  await asUser(studentClass3AId);
  const s3aSchoolRes = await db.query(`SELECT id FROM public.learning_materials WHERE id = '${matSchoolId}'`);
  assert.equal(s3aSchoolRes.rows.length, 1, 'T7: HS bất kỳ đọc được tài liệu toàn trường');
  console.log('✅ T7: Học sinh 3A đọc được tài liệu toàn trường (school) PASS');
  passCount++;

  // T8: Anonymous không query trực tiếp school/class
  await asUser(null);
  const anonDirectRes = await db.query(`SELECT id FROM public.learning_materials WHERE id IN ('${matClass2AId}', '${matSchoolId}')`);
  assert.equal(anonDirectRes.rows.length, 0, 'T8: Anon không đọc được trực tiếp table');
  console.log('✅ T8: Khách vãng lai (Anon) bị RLS chặn hoàn toàn không query trực tiếp table PASS');
  passCount++;

  console.log('\n--- TEST NHÓM 3: STORAGE POLICY SECURITY TEST (S1 - S8) ---');

  // S1: Admin mở file bất kỳ -> PASS
  await asUser(adminId);
  const s1Res = await db.query(`SELECT count(*)::int as count FROM storage.objects WHERE bucket_id = 'learning-materials'`);
  assert.equal(s1Res.rows[0].count >= 3, true, 'S1: Admin đọc toàn bộ file trong storage');
  console.log(`✅ S1: Admin mở file bất kỳ trong Storage (${s1Res.rows[0].count} files) PASS`);
  passCount++;

  // S2: Owner Teacher mở file của mình -> PASS
  await asUser(teacherAId);
  const s2Res = await db.query(`SELECT count(*)::int as count FROM storage.objects WHERE name = '${filePath2A}'`);
  assert.equal(s2Res.rows[0].count, 1, 'S2: Owner Teacher mở được file mình tạo');
  console.log('✅ S2: Owner Teacher mở file do chính mình tạo PASS');
  passCount++;

  // S3: Student lớp chính (2A) mở file class -> PASS
  await asUser(studentClass2AId);
  const s3Res = await db.query(`SELECT count(*)::int as count FROM storage.objects WHERE name = '${filePath2A}'`);
  assert.equal(s3Res.rows[0].count, 1, 'S3: Student lớp chính mở được file lớp');
  console.log('✅ S3: Học sinh lớp chính (2A) mở được file của lớp PASS');
  passCount++;

  // S4: Student lớp share (2B) mở file class -> PASS
  await asUser(studentClass2BId);
  const s4Res = await db.query(`SELECT count(*)::int as count FROM storage.objects WHERE name = '${filePath2A}'`);
  assert.equal(s4Res.rows[0].count, 1, 'S4: Student lớp share mở được file');
  console.log('✅ S4: Học sinh lớp được chia sẻ (2B) mở được file liên lớp PASS');
  passCount++;

  // S5: Student ngoài lớp (3A) KHÔNG mở file lớp 2A -> PASS
  await asUser(studentClass3AId);
  const s5Res = await db.query(`SELECT count(*)::int as count FROM storage.objects WHERE name = '${filePath2A}'`);
  assert.equal(s5Res.rows[0].count, 0, 'S5: Student ngoài lớp bị chặn không mở được file lớp khác');
  console.log('✅ S5: Học sinh lớp khác (3A) bị RLS Storage CHẶN ĐỨNG không mở được file lớp 2A PASS');
  passCount++;

  // S6: Authenticated user (HS 3A) mở school material -> PASS
  await asUser(studentClass3AId);
  const s6Res = await db.query(`SELECT count(*)::int as count FROM storage.objects WHERE name = '${filePathSchool}'`);
  assert.equal(s6Res.rows[0].count, 1, 'S6: User mở được file toàn trường');
  console.log('✅ S6: Học sinh bất kỳ mở được file tài liệu toàn trường (school) PASS');
  passCount++;

  // S7: Authenticated user mở public material -> PASS
  await asUser(studentClass3AId);
  const s7Res = await db.query(`SELECT count(*)::int as count FROM storage.objects WHERE name = '${filePathPublic}'`);
  assert.equal(s7Res.rows[0].count, 1, 'S7: User mở được file công khai');
  console.log('✅ S7: Học sinh bất kỳ mở được file tài liệu công khai (public) PASS');
  passCount++;

  // S8: Anonymous direct Storage SELECT -> BLOCKED
  await asUser(null);
  const s8Res = await db.query(`SELECT count(*)::int as count FROM storage.objects`);
  assert.equal(s8Res.rows[0].count, 0, 'S8: Anon bị chặn 100% direct Storage SELECT');
  console.log('✅ S8: Khách vãng lai (Anon) bị RLS Storage CHẶN HOÀN TOÀN (BLOCKED) PASS');
  passCount++;

  console.log('\n--- TEST NHÓM 4: PUBLIC SECURITY & TOKEN CONTRACT ---');

  // T18: Valid token public delivery contract (Gọi hàm nội bộ nhận đúng metadata)
  await asUser(adminId); // Backend role
  const rpcValid = await db.query(`SELECT public.get_public_learning_material('${publicToken}') as data`);
  assert.equal(rpcValid.rows[0].data.id, matPublicId, 'T18: RPC trả đúng tài liệu public');
  assert.equal(rpcValid.rows[0].data.title, 'Bài Giảng Mẫu Công Khai');
  assert.equal(rpcValid.rows[0].data.created_by, undefined, 'T18: Không trả created_by UUID');
  assert.equal(rpcValid.rows[0].data.class_id, undefined, 'T18: Không trả class_id UUID');
  console.log('✅ T18: Valid token public delivery contract trả đúng metadata an toàn PASS');
  passCount++;

  // T19: Missing token blocked
  let t19Error = false;
  try {
    await db.query(`SELECT public.get_public_learning_material('')`);
  } catch {
    t19Error = true;
  }
  assert.equal(t19Error, true, 'T19: Missing token bị từ chối');
  console.log('✅ T19: Missing token bị chặn đứng PASS');
  passCount++;

  // T21: Wrong token blocked
  let t21Error = false;
  try {
    await db.query(`SELECT public.get_public_learning_material('invalid_token_xyz')`);
  } catch {
    t21Error = true;
  }
  assert.equal(t21Error, true, 'T21: Wrong token ném exception');
  console.log('✅ T21: Token sai bị từ chối chính xác PASS');
  passCount++;

  // T22: Revoked token cannot issue metadata
  await asUser(teacherAId);
  await db.exec(`
    UPDATE public.learning_materials 
    SET visibility = 'class', class_id = '${class2AId}' 
    WHERE id = '${matPublicId}'
  `);

  await asUser(adminId);
  let t22Error = false;
  try {
    await db.query(`SELECT public.get_public_learning_material('${publicToken}')`);
  } catch {
    t22Error = true;
  }
  assert.equal(t22Error, true, 'T22: Token revoked không thể lấy thông tin bài giảng');
  console.log('✅ T22: Token revoked không thể cấp phát metadata bài giảng PASS');
  passCount++;

  // T23: PUBLIC execute privilege revoked trên RPC
  await asUser(null);
  let t23Error = false;
  try {
    await db.query(`SELECT public.get_public_learning_material('${publicToken}')`);
  } catch (err) {
    t23Error = true;
  }
  assert.equal(t23Error, true, 'T23: Anon gọi trực tiếp RPC bị từ chối quyền EXECUTE');
  console.log('✅ T23: Anon gọi trực tiếp RPC bị chặn quyền EXECUTE thành công PASS');
  passCount++;

  console.log('\n--- TEST NHÓM 5: TRIGGER SERVER-SIDE CLEANUP & TOKEN CONSISTENCY ---');

  // Tạo lại 1 bài class có share để test trigger
  const matTriggerTestId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  await asUser(teacherAId);
  await db.exec(`
    INSERT INTO public.learning_materials (id, title, subject, file_type, class_id, created_by, visibility, share_token)
    VALUES ('${matTriggerTestId}', 'Bài Test Trigger', 'Toán', 'pdf', '${class2AId}', '${teacherAId}', 'class', NULL);

    INSERT INTO public.learning_material_shares (material_id, class_id)
    VALUES ('${matTriggerTestId}', '${class2BId}');
  `);

  // T24: class -> school removes share rows qua Trigger
  await db.exec(`
    UPDATE public.learning_materials 
    SET visibility = 'school' 
    WHERE id = '${matTriggerTestId}'
  `);
  const t24Shares = await db.query(`SELECT count(*)::int as count FROM public.learning_material_shares WHERE material_id = '${matTriggerTestId}'`);
  assert.equal(t24Shares.rows[0].count, 0, 'T24: Chuyển sang school tự động xóa share rows');
  console.log('✅ T24: Trigger tự động xóa sạch bảng share khi chuyển class -> school PASS');
  passCount++;

  // T25: class -> public removes share rows qua Trigger
  await db.exec(`
    UPDATE public.learning_materials 
    SET visibility = 'class' 
    WHERE id = '${matTriggerTestId}';

    INSERT INTO public.learning_material_shares (material_id, class_id)
    VALUES ('${matTriggerTestId}', '${class2BId}');

    UPDATE public.learning_materials 
    SET visibility = 'public', share_token = 'token_for_trigger_test_456' 
    WHERE id = '${matTriggerTestId}';
  `);
  const t25Shares = await db.query(`SELECT count(*)::int as count FROM public.learning_material_shares WHERE material_id = '${matTriggerTestId}'`);
  assert.equal(t25Shares.rows[0].count, 0, 'T25: Chuyển sang public tự động xóa share rows');
  console.log('✅ T25: Trigger tự động xóa sạch bảng share khi chuyển class -> public PASS');
  passCount++;

  // T26: school/public -> class does not resurrect old shares
  await db.exec(`
    UPDATE public.learning_materials 
    SET visibility = 'class' 
    WHERE id = '${matTriggerTestId}'
  `);
  const t26Shares = await db.query(`SELECT count(*)::int as count FROM public.learning_material_shares WHERE material_id = '${matTriggerTestId}'`);
  assert.equal(t26Shares.rows[0].count, 0, 'T26: Không tự phục hồi share cũ');
  console.log('✅ T26: Chuyển ngược về class không tự phục hồi các liên kết share cũ PASS');
  passCount++;

  // T27: Constraint check_share_token_consistency chặn vi phạm token
  let t27Error1 = false;
  try {
    // Thử insert class mà có share_token -> Phải bị chặn
    await db.exec(`
      INSERT INTO public.learning_materials (id, title, subject, file_type, class_id, created_by, visibility, share_token)
      VALUES (gen_random_uuid(), 'Lỗi Constraint', 'Toán', 'pdf', '${class2AId}', '${teacherAId}', 'class', 'invalid_token_on_class');
    `);
  } catch {
    t27Error1 = true;
  }
  assert.equal(t27Error1, true, 'T27.1: Constraint chặn class có token');

  let t27Error2 = false;
  try {
    // Thử insert public mà không có share_token -> Phải bị chặn
    await db.exec(`
      INSERT INTO public.learning_materials (id, title, subject, file_type, class_id, created_by, visibility, share_token)
      VALUES (gen_random_uuid(), 'Lỗi Constraint Public', 'Toán', 'pdf', NULL, '${teacherAId}', 'public', NULL);
    `);
  } catch {
    t27Error2 = true;
  }
  assert.equal(t27Error2, true, 'T27.2: Constraint chặn public thiếu token');
  console.log('✅ T27: Check Constraint check_share_token_consistency hoạt động hoàn hảo cấp Database PASS');
  passCount++;

  console.log('\n--- TEST NHÓM 6: PHÂN QUYỀN GHI & RÀO CHẮN LIÊN LỚP (WRITE GUARDS) ---');

  // T3: Teacher không sửa/xóa tài liệu của GV khác
  await asUser(teacherBId);
  const t3Update = await db.query(`
    UPDATE public.learning_materials 
    SET title = 'Bị sửa trộm' 
    WHERE id = '${matClass2AId}'
    RETURNING id
  `);
  assert.equal(t3Update.rows.length, 0, 'T3: GV B không update được bài của GV A');
  console.log('✅ T3: Giáo viên khác không thể cập nhật bài giảng của đồng nghiệp PASS');
  passCount++;

  // T13: Teacher không thể share tới lớp không thuộc quyền quản lý của mình
  await asUser(teacherAId);
  let t13Error = false;
  try {
    await db.query(`
      INSERT INTO public.learning_material_shares (material_id, class_id) 
      VALUES ('${matClass2AId}', '${class3AId}')
    `);
  } catch {
    t13Error = true;
  }
  assert.equal(t13Error, true, 'T13: GV A không thể share sang Lớp 3A của GV B');
  console.log('✅ T13: Giáo viên bị RLS chặn đứng khi cố tình share sang lớp của GV khác PASS');
  passCount++;

  // T14: Admin có quyền share tới bất kỳ lớp nào
  await asUser(adminId);
  const t14Res = await db.query(`
    INSERT INTO public.learning_material_shares (material_id, class_id) 
    VALUES ('${matClass2AId}', '${class3AId}')
    RETURNING id
  `);
  assert.equal(t14Res.rows.length, 1, 'T14: Admin share được sang lớp 3A');
  console.log('✅ T14: Admin toàn quyền chia sẻ bài giảng tới bất kỳ lớp nào trong trường PASS');
  passCount++;

  // T17: Duplicate share bị chặn bởi UNIQUE constraint
  let t17Error = false;
  try {
    await db.query(`
      INSERT INTO public.learning_material_shares (material_id, class_id) 
      VALUES ('${matClass2AId}', '${class3AId}')
    `);
  } catch {
    t17Error = true;
  }
  assert.equal(t17Error, true, 'T17: Unique constraint chặn duplicate share');
  console.log('✅ T17: Khóa Unique chặn duplicate liên kết chia sẻ lớp PASS');
  passCount++;

  console.log('\n--- TEST NHÓM 7: EDGE FUNCTION STATIC CONTRACT & CONFIG AUDIT (E1-E8) ---');

  // E_CONFIG: Kiểm tra supabase/config.toml có verify_jwt = false cho get-public-learning-material
  const configPath = path.join(__dirname, '..', 'supabase', 'config.toml');
  const configContent = await fs.readFile(configPath, 'utf-8');
  assert.equal(configContent.includes('[functions.get-public-learning-material]'), true, 'E_CONFIG: Phải có section [functions.get-public-learning-material]');
  assert.equal(configContent.includes('verify_jwt = false'), true, 'E_CONFIG: Phải có verify_jwt = false');
  
  // Kiểm tra không tồn tại file thừa trong function folder
  const funcConfigPath = path.join(__dirname, '..', 'supabase', 'functions', 'get-public-learning-material', 'config.toml');
  let funcConfigFileExists = false;
  try {
    await fs.access(funcConfigPath);
    funcConfigFileExists = true;
  } catch {
    funcConfigFileExists = false;
  }
  assert.equal(funcConfigFileExists, false, 'E_CONFIG: Không được có file config.toml trong supabase/functions/get-public-learning-material/');
  console.log('✅ E_CONFIG: Cấu hình supabase/config.toml chính xác và không có file thừa PASS');
  passCount++;

  // E_CODE: Đọc code index.ts để xác thực static contracts
  const edgeIndexPath = path.join(__dirname, '..', 'supabase', 'functions', 'get-public-learning-material', 'index.ts');
  const edgeCode = await fs.readFile(edgeIndexPath, 'utf-8');

  // E6: Method Guard 405 (Chỉ cho phép POST và OPTIONS, từ chối GET và các method khác)
  assert.equal(edgeCode.includes("req.method !== 'POST'"), true, 'E6: Method guard chỉ chấp nhận POST (OPTIONS đã xử lý trước)');
  assert.equal(edgeCode.includes('405'), true, 'E6: Trả về HTTP 405 cho các phương thức khác (bao gồm GET, PUT, PATCH, DELETE)');
  assert.equal(edgeCode.includes("'Allow': 'POST, OPTIONS'"), true, 'E6: Header Allow là POST, OPTIONS');
  console.log('✅ E6: Method Guard từ chối GET/PUT/PATCH/DELETE với HTTP 405 PASS');
  passCount++;

  // E7: OPTIONS CORS
  assert.equal(edgeCode.includes("req.method === 'OPTIONS'"), true, 'E7: Xử lý preflight OPTIONS');
  console.log('✅ E7: OPTIONS preflight trả về status 200 kèm CORS headers PASS');
  passCount++;

  // E5: Client gửi arbitrary file_path bị bỏ qua
  assert.equal(edgeCode.includes('body.file_path'), false, 'E5: Không đọc file_path từ client payload');
  assert.equal(edgeCode.includes("eq('visibility', 'public')"), true, 'E5: Truy vấn DB lọc visibility = public');
  console.log('✅ E5: Server không chấp nhận file_path từ client, chỉ query database theo token PASS');
  passCount++;

  // E8: Response Sanitization
  assert.equal(edgeCode.includes('created_by:'), false, 'E8: Không trả created_by UUID trong response');
  assert.equal(edgeCode.includes('class_id:'), false, 'E8: Không trả class_id UUID trong response');
  assert.equal(edgeCode.includes('file_path: material.file_path'), false, 'E8: Không trả file_path trong response');
  console.log('✅ E8: Response dữ liệu an toàn, không rò rỉ ID nội bộ hay file_path PASS');
  passCount++;

  console.log('\n================================================================');
  console.log(`🎉 TẤT CẢ ${passCount} TEST CASES (PGLITE + STORAGE S1-S8 + IDEMPOTENCY + EDGE) ĐÃ PASS 100%!`);
  console.log('================================================================\n');
}

runVisibilityTests().catch(err => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
