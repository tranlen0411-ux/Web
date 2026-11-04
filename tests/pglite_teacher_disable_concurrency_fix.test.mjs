import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

export async function runPgLiteFixValidation() {
  console.log('=============================================================================');
  console.log('KIỂM THỬ POSTGRESQL ENGINE: MIGRATION 20261028000002 CONCURRENCY HARDENING');
  console.log('MỤC TIÊU: XÁC MINH CƠ CHẾ KHÓA VÀ BẢO TOÀN TÍNH NĂNG SAU KHI VÁ CONCURRENCY');
  console.log('=============================================================================\n');

  const baseMigrationPath = path.join(process.cwd(), 'supabase', 'migrations', '20261023210000_notifications_v1_schema_and_security.sql');
  const r1MigrationPath = path.join(process.cwd(), 'supabase', 'migrations', '20261028000001_notifications_v1_individual_recipients.sql');
  const fixMigrationPath = path.join(process.cwd(), 'supabase', 'migrations', '20261028000002_notifications_v1_teacher_disable_concurrency_fix.sql');

  const baseMigrationSql = fs.readFileSync(baseMigrationPath, 'utf8');
  const r1MigrationSql = fs.readFileSync(r1MigrationPath, 'utf8');
  const fixMigrationSql = fs.readFileSync(fixMigrationPath, 'utf8');

  const db = new PGlite();

  // Khởi tạo roles và auth mock
  await db.exec(`
    DO \$\$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role;
      END IF;
    END
    \$\$;

    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS app_private;

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS \$\$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
    \$\$;

    CREATE TABLE IF NOT EXISTS public.profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      student_code TEXT UNIQUE,
      grade_level INT DEFAULT 1,
      total_stars INT DEFAULT 0,
      total_coins INT DEFAULT 0,
      is_disabled BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.classes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      grade_level INT DEFAULT 1,
      teacher_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.class_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
      student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (class_id, student_id)
    );
  `);

  // 1. Nạp tuần tự cả 3 migration
  console.log('1. Nạp Migration 20261023210000 (Notifications V1 Base)...');
  await db.exec(baseMigrationSql);
  console.log('2. Nạp Migration 20261028000001 (Individual Recipients R1)...');
  await db.exec(r1MigrationSql);
  console.log('3. Nạp Migration 20261028000002 (Concurrency Hardening Fix)...');
  await db.exec(fixMigrationSql);
  console.log('   => Toàn bộ 3 migration được nạp hoàn tất không có lỗi cú pháp!\n');

  // Khởi tạo fixture test
  const adminId = '11111111-1111-1111-1111-111111111111';
  const teacherId = '22222222-2222-2222-2222-222222222221';
  const studentId = '33333333-3333-3333-3333-333333333331';
  const classId = '44444444-4444-4444-4444-444444444441';

  await db.exec(`
    INSERT INTO public.profiles (id, email, full_name, role) VALUES
      ('${adminId}', 'admin@test.invalid', 'Admin Test', 'admin'),
      ('${teacherId}', 'teacher1@test.invalid', 'Teacher 1', 'teacher'),
      ('${studentId}', 'student1@test.invalid', 'Student 1', 'student');

    INSERT INTO public.classes (id, name, code, grade_level, teacher_id) VALUES
      ('${classId}', 'Lớp 1A', 'CLS1A', 1, '${teacherId}');

    INSERT INTO public.class_members (class_id, student_id, is_active) VALUES
      ('${classId}', '${studentId}', TRUE);
  `);

  // Helper set session
  async function asUser(userId) {
    await db.exec(`SET request.jwt.claim.sub = '${userId}';`);
  }

  // TEST 1: Teacher tạo draft thành công
  console.log('--- TEST 1: Teacher tạo draft thông báo cá nhân ---');
  await asUser(teacherId);
  const draftRes = await db.query(`
    SELECT public.rpc_create_individual_notification(
      'Tiêu đề test',
      'Nội dung test',
      '${studentId}',
      'normal',
      'general',
      NULL, NULL, NULL,
      FALSE
    ) AS res;
  `);
  const notifId = draftRes.rows[0].res.notification_id;
  assert.ok(notifId, 'Phải có notifId');
  console.log('✅ TEST 1 PASS: Draft created:', notifId);

  // TEST 2: Teacher xuất bản khi profile bình thường (is_disabled = false)
  console.log('\n--- TEST 2: Teacher xuất bản khi bình thường ---');
  const pubRes = await db.query(`
    SELECT public.rpc_publish_notification('${notifId}') AS res;
  `);
  assert.strictEqual(pubRes.rows[0].res, true);
  console.log('✅ TEST 2 PASS: Teacher publish thành công khi tài khoản active.');

  // TEST 3: Thử tạo draft thứ 2, sau đó disable teacher rồi publish
  console.log('\n--- TEST 3: Chặn xuất bản khi Teacher bị vô hiệu hóa (is_disabled = true) ---');
  await asUser(teacherId);
  const draftRes2 = await db.query(`
    SELECT public.rpc_create_individual_notification(
      'Tiêu đề test 2',
      'Nội dung test 2',
      '${studentId}',
      'normal',
      'general',
      NULL, NULL, NULL,
      FALSE
    ) AS res;
  `);
  const notifId2 = draftRes2.rows[0].res.notification_id;

  // Admin vô hiệu hóa Teacher
  await db.exec(`UPDATE public.profiles SET is_disabled = TRUE WHERE id = '${teacherId}';`);

  // Teacher thử publish
  let publishErr = null;
  try {
    await asUser(teacherId);
    await db.query(`SELECT public.rpc_publish_notification('${notifId2}');`);
  } catch (err) {
    publishErr = err;
  }
  assert.ok(publishErr, 'Phải có lỗi khi giáo viên bị disabled');
  assert.ok(
    publishErr.message.includes('FORBIDDEN_ACCOUNT_DISABLED'),
    'Lỗi phải là FORBIDDEN_ACCOUNT_DISABLED, thực tế: ' + publishErr.message
  );
  console.log('✅ TEST 3 PASS: Bị chặn với lỗi:', publishErr.message);

  // TEST 4: Thử bypass qua direct UPDATE
  console.log('\n--- TEST 4: Thử bypass qua direct UPDATE public.notifications ---');
  let directUpdateErr = null;
  try {
    await asUser(teacherId);
    await db.query(`UPDATE public.notifications SET is_published = TRUE WHERE id = '${notifId2}';`);
  } catch (err) {
    directUpdateErr = err;
  }
  assert.ok(directUpdateErr, 'Direct UPDATE cũng phải bị trigger lifecycle chặn');
  assert.ok(
    directUpdateErr.message.includes('FORBIDDEN_ACCOUNT_DISABLED'),
    'Lỗi phải là FORBIDDEN_ACCOUNT_DISABLED, thực tế: ' + directUpdateErr.message
  );
  console.log('✅ TEST 4 PASS: Direct UPDATE bị trigger chặn với lỗi:', directUpdateErr.message);

  // TEST 5: Phục hồi teacher và publish thành công
  console.log('\n--- TEST 5: Phục hồi teacher (is_disabled = false) và publish thành công ---');
  await db.exec(`UPDATE public.profiles SET is_disabled = FALSE WHERE id = '${teacherId}';`);
  await asUser(teacherId);
  const pubRes2 = await db.query(`SELECT public.rpc_publish_notification('${notifId2}') AS res;`);
  assert.strictEqual(pubRes2.rows[0].res, true);
  console.log('✅ TEST 5 PASS: Xuất bản thành công sau khi phục hồi!');

  console.log('\n=============================================================================');
  console.log('🎉 100% CÁC BÀI TEST PGLITE CHO MIGRATION FIX CONCURRENCY ĐÃ VƯỢT QUA!');
  console.log('=============================================================================\n');
}

runPgLiteFixValidation().catch(err => {
  console.error('Test thất bại:', err);
  process.exit(1);
});
