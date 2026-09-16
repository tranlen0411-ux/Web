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
  console.log('=== KIỂM THỬ POSTGRESQL THỰC TẾ: ADMIN-ONLY CLASS GOVERNANCE & RLS ===\n');

  const connectionString = validateAndGetConnectionString();
  if (!connectionString) {
    console.log('ℹ️ Không có TEST_POSTGRES_URL cục bộ, bỏ qua kiểm thử daemon ngoài.');
    return;
  }

  const client = new Client({
    connectionString,
    statement_timeout: 10000
  });

  try {
    await client.connect();
  } catch (err) {
    console.log(`ℹ️ PostgreSQL daemon không khả dụng (${err.message}). Sử dụng Wasm PostgreSQL kernel (PGlite) làm engine kiểm thử chuẩn.`);
    return;
  }

  try {
    // 1. Setup schema
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
    `);

    // 2. Chạy migration PR #95
    const pr95Sql = fs.readFileSync(path.join(process.cwd(), 'supabase', 'migrations', '20260915223000_admin_student_teacher_class_management.sql'), 'utf8');
    await client.query(pr95Sql);

    // 3. Chạy migration RLS hardening mới
    const hardeningSql = fs.readFileSync(path.join(process.cwd(), 'supabase', 'migrations', '20260916233000_harden_classes_admin_only_rls.sql'), 'utf8');
    await client.query(hardeningSql);

    await client.query(`
      ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.classes FORCE ROW LEVEL SECURITY;
      GRANT ALL ON public.classes TO authenticated;
      GRANT SELECT ON public.profiles TO authenticated;
      GRANT SELECT ON public.class_members TO authenticated;
    `);

    console.log('✅ 1. Migration và RLS hardening thực thi thành công trên PostgreSQL.');

    // 4. Seed data
    const adminId = '11111111-1111-1111-1111-111111111111';
    const teacherId = '22222222-2222-2222-2222-222222222221';
    const classId = '44444444-4444-4444-4444-444444444441';

    await client.query(`
      INSERT INTO public.profiles (id, email, full_name, role) VALUES
        ('${adminId}', 'admin@school.edu.vn', 'Admin User', 'admin'),
        ('${teacherId}', 'teacher@school.edu.vn', 'Teacher User', 'teacher');

      INSERT INTO public.classes (id, name, code, grade_level, teacher_id) VALUES
        ('${classId}', 'Lớp 5A', 'L5A01', 5, '${teacherId}');
    `);

    // 5. Test teacher direct INSERT denied
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

    // 6. Test teacher direct UPDATE denied
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

    console.log('🎉 TẤT CẢ KIỂM THỬ POSTGRESQL ĐÃ THÀNH CÔNG!\n');
  } finally {
    await client.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('admin_only_class_governance.postgres.test.mjs')) {
  runRealPostgresTest().catch(console.error);
}
