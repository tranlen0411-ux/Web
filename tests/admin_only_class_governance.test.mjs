import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';

async function setupBaseRolesAndProfiles(db) {
  await db.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
      END IF;
    END
    $$;

    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS app_private;

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
    $$;

    CREATE TABLE IF NOT EXISTS public.profiles (
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

    CREATE TABLE IF NOT EXISTS public.classes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      grade_level INT DEFAULT 1,
      teacher_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.class_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
      student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(class_id, student_id)
    );
  `);
}

export async function runAdminOnlyClassGovernanceTestSuite() {
  console.log('=== KHỞI TẠO TEST SUITE: ADMIN-ONLY CLASS GOVERNANCE & RLS HARDENING ===\n');

  const db = new PGlite();

  // 1. Setup base schema
  await setupBaseRolesAndProfiles(db);

  // 2. Run PR #95 base migration
  const pr95MigrationPath = path.join(process.cwd(), 'supabase', 'migrations', '20260915223000_admin_student_teacher_class_management.sql');
  const pr95Sql = fs.readFileSync(pr95MigrationPath, 'utf8');
  await db.exec(pr95Sql);

  // 3. Run new hardening migration
  const hardeningMigrationPath = path.join(process.cwd(), 'supabase', 'migrations', '20260916233000_harden_classes_admin_only_rls.sql');
  const hardeningSql = fs.readFileSync(hardeningMigrationPath, 'utf8');
  await db.exec(hardeningSql);

  // 4. Enable RLS and grant privileges
  await db.exec(`
    ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.classes FORCE ROW LEVEL SECURITY;
    GRANT ALL ON public.classes TO authenticated;
    GRANT SELECT ON public.profiles TO authenticated;
    GRANT SELECT ON public.class_members TO authenticated;
  `);

  console.log('✅ 1. Khởi tạo schema và thực thi migration RLS Admin-only thành công.');

  // 5. Seed test data
  const adminId = '11111111-1111-1111-1111-111111111111';
  const teacher1Id = '22222222-2222-2222-2222-222222222221';
  const teacher2Id = '22222222-2222-2222-2222-222222222222';
  const student1Id = '33333333-3333-3333-3333-333333333331';
  const student2Id = '33333333-3333-3333-3333-333333333332';

  await db.exec(`
    INSERT INTO public.profiles (id, email, full_name, role) VALUES
      ('${adminId}', 'admin@school.edu.vn', 'Quản Trị Viên', 'admin'),
      ('${teacher1Id}', 'teacher1@school.edu.vn', 'Thầy Nguyễn Văn A', 'teacher'),
      ('${teacher2Id}', 'teacher2@school.edu.vn', 'Cô Trần Thị B', 'teacher'),
      ('${student1Id}', 'student1@school.edu.vn', 'Em Học Sinh 1', 'student'),
      ('${student2Id}', 'student2@school.edu.vn', 'Em Học Sinh 2', 'student');
  `);

  const class1Id = '44444444-4444-4444-4444-444444444441';
  const class2Id = '44444444-4444-4444-4444-444444444442';

  // Seed initial classes & members as superuser
  await db.exec(`
    INSERT INTO public.classes (id, name, code, grade_level, teacher_id) VALUES
      ('${class1Id}', 'Lớp 5A', 'L5A01', 5, '${teacher1Id}'),
      ('${class2Id}', 'Lớp 5B', 'L5B01', 5, '${teacher2Id}');

    INSERT INTO public.class_members (class_id, student_id) VALUES
      ('${class1Id}', '${student1Id}'),
      ('${class2Id}', '${student2Id}');
  `);

  console.log('✅ 2. Admin tạo lớp ban đầu và gán học sinh thành công.');

  // ==========================================
  // TEST CASE 1: Teacher CANNOT direct INSERT class
  // ==========================================
  console.log('⏳ Kiểm thử TC1: Teacher không thể INSERT class trực tiếp...');
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${teacher1Id}', false);
  `);
  let teacherInsertBlocked = false;
  try {
    await db.exec(`
      INSERT INTO public.classes (id, name, code, grade_level, teacher_id)
      VALUES (gen_random_uuid(), 'Lớp Trái Phép', 'LTP01', 5, '${teacher1Id}');
    `);
  } catch (err) {
    teacherInsertBlocked = true;
  } finally {
    await db.exec(`RESET ROLE;`);
  }
  assert.strictEqual(teacherInsertBlocked, true, 'TC1: Teacher INSERT class trực tiếp phải bị RLS chặn');
  console.log('✅ TC1 PASS: Teacher INSERT bị chặn hoàn toàn bởi RLS.');

  // ==========================================
  // TEST CASE 2: Teacher CANNOT UPDATE class (even their own class)
  // ==========================================
  console.log('⏳ Kiểm thử TC2: Teacher không thể UPDATE class (kể cả lớp của chính mình)...');
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${teacher1Id}', false);
  `);
  let teacherUpdateOwnBlocked = false;
  try {
    const res = await db.query(`UPDATE public.classes SET name = 'Lớp 5A Đổi Tên' WHERE id = '${class1Id}' RETURNING *;`);
    if (res.rows.length === 0) {
      teacherUpdateOwnBlocked = true;
    }
  } catch (err) {
    teacherUpdateOwnBlocked = true;
  } finally {
    await db.exec(`RESET ROLE;`);
  }
  assert.strictEqual(teacherUpdateOwnBlocked, true, 'TC2: Teacher UPDATE lớp của mình phải bị RLS chặn hoặc 0 rows updated');
  console.log('✅ TC2 PASS: Teacher UPDATE lớp của chính mình bị chặn.');

  // ==========================================
  // TEST CASE 3: Teacher CANNOT take over another teacher's class
  // ==========================================
  console.log('⏳ Kiểm thử TC3: Teacher không thể tự gán hoặc nhận lớp của giáo viên khác...');
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${teacher1Id}', false);
  `);
  let teacherTakeoverBlocked = false;
  try {
    const res = await db.query(`UPDATE public.classes SET teacher_id = '${teacher1Id}' WHERE id = '${class2Id}' RETURNING *;`);
    if (res.rows.length === 0) {
      teacherTakeoverBlocked = true;
    }
  } catch (err) {
    teacherTakeoverBlocked = true;
  } finally {
    await db.exec(`RESET ROLE;`);
  }
  assert.strictEqual(teacherTakeoverBlocked, true, 'TC3: Teacher tự nhận lớp khác phải bị chặn');
  console.log('✅ TC3 PASS: Teacher tự nhận lớp của người khác bị chặn.');

  // ==========================================
  // TEST CASE 4: Teacher CANNOT DELETE class
  // ==========================================
  console.log('⏳ Kiểm thử TC4: Teacher không thể DELETE class...');
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${teacher1Id}', false);
  `);
  let teacherDeleteBlocked = false;
  try {
    const res = await db.query(`DELETE FROM public.classes WHERE id = '${class1Id}' RETURNING *;`);
    if (res.rows.length === 0) {
      teacherDeleteBlocked = true;
    }
  } catch (err) {
    teacherDeleteBlocked = true;
  } finally {
    await db.exec(`RESET ROLE;`);
  }
  assert.strictEqual(teacherDeleteBlocked, true, 'TC4: Teacher DELETE class phải bị RLS chặn');
  console.log('✅ TC4 PASS: Teacher DELETE bị chặn hoàn toàn.');

  // ==========================================
  // TEST CASE 5: Admin CAN INSERT/UPDATE/DELETE class
  // ==========================================
  console.log('⏳ Kiểm thử TC5: Admin vẫn INSERT/UPDATE/DELETE class hợp lệ...');
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${adminId}', false);
  `);
  const adminNewClassId = '44444444-4444-4444-4444-444444444443';
  await db.exec(`
    INSERT INTO public.classes (id, name, code, grade_level, teacher_id)
    VALUES ('${adminNewClassId}', 'Lớp 5C Admin Tạo', 'L5C01', 5, '${teacher1Id}');
  `);
  const updateRes = await db.query(`
    UPDATE public.classes SET name = 'Lớp 5C Đã Sửa' WHERE id = '${adminNewClassId}' RETURNING name;
  `);
  assert.strictEqual(updateRes.rows[0]?.name, 'Lớp 5C Đã Sửa', 'TC5: Admin update class thành công');

  await db.exec(`DELETE FROM public.classes WHERE id = '${adminNewClassId}';`);
  const checkDeleted = await db.query(`SELECT COUNT(*)::int AS cnt FROM public.classes WHERE id = '${adminNewClassId}';`);
  assert.strictEqual(checkDeleted.rows[0]?.cnt, 0, 'TC5: Admin delete class thành công');
  await db.exec(`RESET ROLE;`);
  console.log('✅ TC5 PASS: Admin thực hiện đầy đủ INSERT/UPDATE/DELETE thành công.');

  // ==========================================
  // TEST CASE 6: Teacher CAN SELECT assigned classes
  // ==========================================
  console.log('⏳ Kiểm thử TC6: Teacher SELECT được lớp được phân công...');
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${teacher1Id}', false);
  `);
  const teacherSelectRes = await db.query(`SELECT id, name FROM public.classes;`);
  assert.strictEqual(teacherSelectRes.rows.length, 1, 'TC6: Teacher chỉ thấy lớp được phân công cho mình');
  assert.strictEqual(teacherSelectRes.rows[0]?.id, class1Id, 'TC6: Lớp nhìn thấy đúng là class1');
  await db.exec(`RESET ROLE;`);
  console.log('✅ TC6 PASS: Teacher SELECT đúng các lớp được phân công.');

  // ==========================================
  // TEST CASE 7: Student CAN SELECT enrolled class
  // ==========================================
  console.log('⏳ Kiểm thử TC7: Student SELECT được lớp mình tham gia...');
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${student1Id}', false);
  `);
  const studentSelectRes = await db.query(`SELECT id, name FROM public.classes;`);
  assert.strictEqual(studentSelectRes.rows.length, 1, 'TC7: Student chỉ thấy lớp mình đang học');
  assert.strictEqual(studentSelectRes.rows[0]?.id, class1Id, 'TC7: Lớp nhìn thấy đúng là class1');
  await db.exec(`RESET ROLE;`);
  console.log('✅ TC7 PASS: Student SELECT đúng lớp của mình.');

  // ==========================================
  // TEST CASE 8: Unassign Teacher via RPC preserves student data
  // ==========================================
  console.log('⏳ Kiểm thử TC8: Gỡ giáo viên qua RPC remove_teacher_from_class bảo toàn dữ liệu học sinh...');
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${adminId}', false);
  `);
  const unassignRes = await db.query(`
    SELECT public.remove_teacher_from_class('${teacher1Id}', '${class1Id}') AS result;
  `);
  const unassignData = unassignRes.rows[0]?.result;
  assert.strictEqual(unassignData.success, true, 'TC8: remove_teacher_from_class thành công');

  const class1Check = await db.query(`SELECT teacher_id FROM public.classes WHERE id = '${class1Id}';`);
  assert.strictEqual(class1Check.rows[0]?.teacher_id, null, 'TC8: teacher_id của lớp chuyển thành NULL');

  const membersCheck = await db.query(`SELECT student_id FROM public.class_members WHERE class_id = '${class1Id}';`);
  assert.strictEqual(membersCheck.rows.length, 1, 'TC8: Học sinh trong lớp vẫn còn nguyên vẹn 100%');
  assert.strictEqual(membersCheck.rows[0]?.student_id, student1Id, 'TC8: student1 vẫn thuộc lớp');
  await db.exec(`RESET ROLE;`);
  console.log('✅ TC8 PASS: Gỡ giáo viên bảo toàn dữ liệu học sinh.');

  await db.close();
  console.log('\n============================================================');
  console.log('✅ ALL ADMIN-ONLY CLASS GOVERNANCE TESTS PASSED (8/8 Cases)');
  console.log('============================================================\n');
}

if (process.argv[1] && process.argv[1].endsWith('admin_only_class_governance.test.mjs')) {
  runAdminOnlyClassGovernanceTestSuite().catch(err => {
    console.error('❌ TEST FAILED:', err);
    process.exit(1);
  });
}
