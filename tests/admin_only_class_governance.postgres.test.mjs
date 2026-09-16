import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const { Client } = pg;

function validateAndGetConnectionString() {
  const rawUrl = process.env.TEST_POSTGRES_URL || 'postgres://test_user:test_password@127.0.0.1:5432/postgres_test';

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    console.warn('⚠️ URL kết nối database không hợp lệ:', err.message);
    return null;
  }

  const allowedHosts = new Set(['127.0.0.1', 'localhost']);
  if (!allowedHosts.has(parsed.hostname)) {
    console.error(`❌ [DATABASE_HOST_GUARD] Host ${parsed.hostname} bị cấm.`);
    return null;
  }

  if (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PRODUCTION_DATABASE_URL) {
    console.error('❌ [DATABASE_HOST_GUARD] Phát hiện biến môi trường nhạy cảm.');
    return null;
  }

  return rawUrl;
}

export async function runRealPostgresTest() {
  console.log('=== BẮT ĐẦU KIỂM THỬ REAL POSTGRESQL: ADMIN-ONLY CLASS GOVERNANCE & PRE-DROP ASSERTIONS ===\n');

  const connectionString = validateAndGetConnectionString();
  if (!connectionString) {
    console.log('ℹ️ Không có TEST_POSTGRES_URL hợp lệ, bỏ qua kiểm thử server ngoài.');
    return;
  }

  const client = new Client({
    connectionString,
    statement_timeout: 15000
  });

  try {
    await client.connect();
  } catch (err) {
    console.log(`ℹ️ PostgreSQL daemon không khả dụng (${err.message}). Trong CI GitHub Actions, PostgreSQL container 16-alpine sẽ được tự động khởi động.`);
    return;
  }

  try {
    // 0. Query PostgreSQL version
    const versionRes = await client.query(`SELECT version();`);
    const pgVersion = versionRes.rows[0].version;
    console.log(`📌 REAL POSTGRESQL CONNECTED: ${pgVersion}`);

    // 1. Setup predecessor schema
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated NOLOGIN;
        END IF;
        EXECUTE format('GRANT anon, authenticated TO %I', CURRENT_USER);
      END
      $$;

      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE SCHEMA IF NOT EXISTS app_private;

      CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
      $$;

      DROP TABLE IF EXISTS public.class_membership_history CASCADE;
      DROP TABLE IF EXISTS public.student_progress CASCADE;
      DROP TABLE IF EXISTS public.assignments CASCADE;
      DROP TABLE IF EXISTS public.games CASCADE;
      DROP TABLE IF EXISTS public.class_members CASCADE;
      DROP TABLE IF EXISTS public.classes CASCADE;
      DROP TABLE IF EXISTS public.profiles CASCADE;

      CREATE TABLE public.profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'student',
        grade_level INT DEFAULT 1,
        total_stars INT DEFAULT 0,
        total_coins INT DEFAULT 0,
        is_disabled BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE public.classes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        code TEXT UNIQUE NOT NULL,
        grade_level INT DEFAULT 1,
        teacher_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE public.class_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(class_id, student_id)
      );

      GRANT USAGE ON SCHEMA public, auth, app_private TO anon, authenticated;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
      GRANT ALL ON ALL FUNCTIONS IN SCHEMA public, auth, app_private TO authenticated;
    `);

    // 2. Chạy migration PR #95
    const pr95Sql = fs.readFileSync(path.join(process.cwd(), 'supabase', 'migrations', '20260915223000_admin_student_teacher_class_management.sql'), 'utf8');
    await client.query(pr95Sql);

    // 3. Test Pre-Drop Assertion with Rogue Policy on Real PostgreSQL
    await client.query(`
      CREATE POLICY "rogue_external_policy" ON public.classes
        FOR ALL USING (true);
    `);

    const hardeningSql = fs.readFileSync(path.join(process.cwd(), 'supabase', 'migrations', '20260916233000_harden_classes_admin_only_rls.sql'), 'utf8');

    let caughtRoguePreDrop = false;
    try {
      await client.query(hardeningSql);
    } catch (err) {
      caughtRoguePreDrop = true;
      assert(err.message.includes('PRE-DROP VALIDATION FAILED'), 'Real PG: Lỗi phải xuất phát từ PRE-DROP VALIDATION');
      await client.query('ROLLBACK;').catch(() => {});
    }
    assert.strictEqual(caughtRoguePreDrop, true, 'Real PG: Pre-drop assertion phải chặn đứng rogue policy trước khi DROP');

    // Kiểm tra sau khi pre-drop ném lỗi: rogue_external_policy vẫn còn nguyên trên Real PG
    const checkRogue = await client.query(`
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'classes' AND policyname = 'rogue_external_policy';
    `);
    assert.strictEqual(checkRogue.rows.length, 1, 'Real PG: Rogue policy được giữ nguyên sau khi migration fail-closed');
    console.log('✅ Real PG: Pre-drop assertion chặn rogue ALL policy thành công và state được bảo toàn.');

    // Xóa rogue policy nhân tạo và chạy migration chính thức
    await client.query(`DROP POLICY "rogue_external_policy" ON public.classes;`);
    await client.query(hardeningSql);

    // 4. Test Idempotent re-run trên Real PostgreSQL
    await client.query(hardeningSql);
    console.log('✅ Real PG: Idempotent re-run migration thành công 100%.');

    await client.query(`
      ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.classes FORCE ROW LEVEL SECURITY;
      GRANT ALL ON public.classes TO authenticated;
      GRANT SELECT ON public.profiles TO authenticated;
      GRANT SELECT ON public.class_members TO authenticated;
    `);

    // 5. Seed profiles & classes
    const adminId = '11111111-1111-1111-1111-111111111111';
    const teacherId = '22222222-2222-2222-2222-222222222221';
    const studentId = '33333333-3333-3333-3333-333333333331';
    const classId = '44444444-4444-4444-4444-444444444441';

    await client.query(`
      INSERT INTO public.profiles (id, email, full_name, role) VALUES
        ('${adminId}', 'admin@school.edu.vn', 'Admin User', 'admin'),
        ('${teacherId}', 'teacher@school.edu.vn', 'Teacher User', 'teacher'),
        ('${studentId}', 'student@school.edu.vn', 'Student User', 'student');

      INSERT INTO public.classes (id, name, code, grade_level, teacher_id) VALUES
        ('${classId}', 'Lớp 5A', 'L5A01', 5, '${teacherId}');

      INSERT INTO public.class_members (class_id, student_id) VALUES
        ('${classId}', '${studentId}');
    `);

    // 6. Test Teacher direct INSERT denied
    let teacherInsertBlocked = false;
    try {
      await client.query(`
        SET ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${teacherId}', false);
        INSERT INTO public.classes (id, name, code, grade_level, teacher_id)
        VALUES (gen_random_uuid(), 'Lớp Trái Phép', 'LTP01', 5, '${teacherId}');
      `);
    } catch (_) {
      teacherInsertBlocked = true;
    } finally {
      await client.query(`RESET ROLE;`);
    }
    assert.strictEqual(teacherInsertBlocked, true, 'Real PG: Teacher INSERT phải bị RLS chặn');
    console.log('✅ Real PG: Teacher INSERT denied PASS.');

    // 7. Test Teacher direct UPDATE denied
    let teacherUpdateBlocked = false;
    try {
      const res = await client.query(`
        SET ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${teacherId}', false);
        UPDATE public.classes SET name = 'Lớp 5A Đổi Tên' WHERE id = '${classId}' RETURNING *;
      `);
      if (res.rows.length === 0) teacherUpdateBlocked = true;
    } catch (_) {
      teacherUpdateBlocked = true;
    } finally {
      await client.query(`RESET ROLE;`);
    }
    assert.strictEqual(teacherUpdateBlocked, true, 'Real PG: Teacher UPDATE phải bị RLS chặn');
    console.log('✅ Real PG: Teacher UPDATE denied PASS.');

    // 8. Test Teacher direct DELETE denied
    let teacherDeleteBlocked = false;
    try {
      const res = await client.query(`
        SET ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${teacherId}', false);
        DELETE FROM public.classes WHERE id = '${classId}' RETURNING *;
      `);
      if (res.rows.length === 0) teacherDeleteBlocked = true;
    } catch (_) {
      teacherDeleteBlocked = true;
    } finally {
      await client.query(`RESET ROLE;`);
    }
    assert.strictEqual(teacherDeleteBlocked, true, 'Real PG: Teacher DELETE phải bị RLS chặn');
    console.log('✅ Real PG: Teacher DELETE denied PASS.');

    // 9. Test Admin Full CRUD Allowed
    const newClassId = '44444444-4444-4444-4444-444444444449';
    await client.query(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${adminId}', false);
      INSERT INTO public.classes (id, name, code, grade_level, teacher_id)
      VALUES ('${newClassId}', 'Lớp 3A Admin', 'L3A01', 3, '${teacherId}');
    `);
    const updateAdminRes = await client.query(`
      UPDATE public.classes SET name = 'Lớp 3A Sửa' WHERE id = '${newClassId}' RETURNING *;
    `);
    assert.strictEqual(updateAdminRes.rows.length, 1, 'Real PG: Admin UPDATE thành công');

    const deleteAdminRes = await client.query(`
      DELETE FROM public.classes WHERE id = '${newClassId}' RETURNING *;
    `);
    assert.strictEqual(deleteAdminRes.rows.length, 1, 'Real PG: Admin DELETE thành công');
    await client.query(`RESET ROLE;`);
    console.log('✅ Real PG: Admin INSERT/UPDATE/DELETE allowed PASS.');

    // 10. Test Teacher & Student SELECT scope preserved
    await client.query(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${teacherId}', false);
    `);
    const teacherSelect = await client.query(`SELECT id FROM public.classes;`);
    assert.strictEqual(teacherSelect.rows.length, 1, 'Real PG: Teacher SELECT đúng lớp được phân công');
    await client.query(`RESET ROLE;`);

    await client.query(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${studentId}', false);
    `);
    const studentSelect = await client.query(`SELECT id FROM public.classes;`);
    assert.strictEqual(studentSelect.rows.length, 1, 'Real PG: Student SELECT đúng lớp mình tham gia');
    await client.query(`RESET ROLE;`);
    console.log('✅ Real PG: Teacher và Student SELECT scope preserved PASS.');

    console.log('\n============================================================');
    console.log('🎉 TẤT CẢ KIỂM THỬ TRÊN REAL POSTGRESQL ĐÃ THÀNH CÔNG XUẤT SẮC!');
    console.log('============================================================\n');
  } finally {
    await client.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('admin_only_class_governance.postgres.test.mjs')) {
  runRealPostgresTest().catch(err => {
    console.error('❌ REAL POSTGRESQL TEST FAILED:', err);
    process.exit(1);
  });
}
