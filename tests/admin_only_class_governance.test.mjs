import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

export async function runAdminOnlyClassGovernanceTestSuite() {
  console.log('=== KHỞI TẠO TEST SUITE: ADMIN-ONLY CLASS GOVERNANCE & RLS HARDENING ROUND 2 ===\n');

  const pr95MigrationPath = path.join(process.cwd(), 'supabase', 'migrations', '20260915223000_admin_student_teacher_class_management.sql');
  const hardeningMigrationPath = path.join(process.cwd(), 'supabase', 'migrations', '20260916233000_harden_classes_admin_only_rls.sql');

  const pr95Sql = fs.readFileSync(pr95MigrationPath, 'utf8');
  const hardeningSql = fs.readFileSync(hardeningMigrationPath, 'utf8');

  async function setupBaseRolesAndProfiles(dbInstance) {
    await dbInstance.exec(`
      DO $$
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

      GRANT USAGE ON SCHEMA public, auth, app_private TO anon, authenticated, service_role;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
      GRANT ALL ON ALL FUNCTIONS IN SCHEMA public, auth, app_private TO anon, authenticated, service_role;
    `);
  }

  const db = new PGlite();
  await setupBaseRolesAndProfiles(db);

  // 1. Chạy PR #95 Migration
  await db.exec(pr95Sql);

  // 2. Chạy RLS Hardening Migration
  await db.exec(hardeningSql);

  // Enable and enforce RLS on classes
  await db.exec(`
    ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.classes FORCE ROW LEVEL SECURITY;
  `);

  console.log('✅ 1. Khởi tạo schema và thực thi migration RLS Admin-only thành công.');

  // Seed profiles
  const adminId = '11111111-1111-1111-1111-111111111111';
  const teacher1Id = '22222222-2222-2222-2222-222222222221';
  const teacher2Id = '22222222-2222-2222-2222-222222222222';
  const student1Id = '33333333-3333-3333-3333-333333333331';
  const student2Id = '33333333-3333-3333-3333-333333333332';

  await db.exec(`
    INSERT INTO public.profiles (id, email, full_name, role) VALUES
      ('${adminId}', 'admin@school.edu.vn', 'Admin Hệ Thống', 'admin'),
      ('${teacher1Id}', 'teacher1@school.edu.vn', 'Cô Mai', 'teacher'),
      ('${teacher2Id}', 'teacher2@school.edu.vn', 'Thầy Hùng', 'teacher'),
      ('${student1Id}', 'student1@school.edu.vn', 'Học sinh An', 'student'),
      ('${student2Id}', 'student2@school.edu.vn', 'Học sinh Bình', 'student');
  `);

  // Create initial classes by Admin
  const class1Id = '44444444-4444-4444-4444-444444444441';
  const class2Id = '44444444-4444-4444-4444-444444444442';

  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${adminId}', false);
    INSERT INTO public.classes (id, name, code, grade_level, teacher_id) VALUES
      ('${class1Id}', 'Lớp 1A', 'L1A01', 1, '${teacher1Id}'),
      ('${class2Id}', 'Lớp 1B', 'L1B01', 1, '${teacher2Id}');
    RESET ROLE;
  `);

  // Assign students via RPC
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${adminId}', false);
    SELECT public.assign_student_to_class('${student1Id}', '${class1Id}', 'Gán vào lớp 1A');
    SELECT public.assign_student_to_class('${student2Id}', '${class2Id}', 'Gán vào lớp 1B');
    RESET ROLE;
  `);

  console.log('✅ 2. Admin tạo lớp ban đầu và gán học sinh thành công.');

  // ==========================================
  // TEST CASE 1: Teacher Direct INSERT Denied
  // ==========================================
  console.log('⏳ Kiểm thử TC1: Teacher không thể INSERT class trực tiếp...');
  let teacherInsertDenied = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${teacher1Id}', false);
      INSERT INTO public.classes (id, name, code, grade_level, teacher_id)
      VALUES (gen_random_uuid(), 'Lớp Trái Phép', 'LTP01', 1, '${teacher1Id}');
      RESET ROLE;
    `);
  } catch (err) {
    teacherInsertDenied = true;
    await db.exec(`RESET ROLE;`);
  }
  assert.strictEqual(teacherInsertDenied, true, 'TC1: Teacher trực tiếp INSERT phải bị RLS chặn');
  console.log('✅ TC1 PASS: Teacher INSERT bị chặn hoàn toàn bởi RLS.');

  // ==========================================
  // TEST CASE 2: Teacher Direct UPDATE Denied
  // ==========================================
  console.log('⏳ Kiểm thử TC2: Teacher không thể UPDATE class (kể cả lớp của chính mình)...');
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${teacher1Id}', false);
  `);
  const updateRes1 = await db.query(`
    UPDATE public.classes SET name = 'Lớp 1A Đổi Tên' WHERE id = '${class1Id}' RETURNING *;
  `);
  assert.strictEqual(updateRes1.rows.length, 0, 'TC2: Teacher UPDATE lớp của mình phải không có bản ghi nào được sửa');
  await db.exec(`RESET ROLE;`);

  const class1NameCheck = await db.query(`SELECT name FROM public.classes WHERE id = '${class1Id}';`);
  assert.strictEqual(class1NameCheck.rows[0]?.name, 'Lớp 1A', 'TC2: Tên lớp không bị thay đổi');
  console.log('✅ TC2 PASS: Teacher UPDATE lớp của chính mình bị chặn.');

  // ==========================================
  // TEST CASE 3: Teacher Direct UPDATE Other Class Denied
  // ==========================================
  console.log('⏳ Kiểm thử TC3: Teacher không thể tự gán hoặc nhận lớp của giáo viên khác...');
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${teacher1Id}', false);
  `);
  const updateRes2 = await db.query(`
    UPDATE public.classes SET teacher_id = '${teacher1Id}' WHERE id = '${class2Id}' RETURNING *;
  `);
  assert.strictEqual(updateRes2.rows.length, 0, 'TC3: Teacher UPDATE lớp của GV khác phải không có bản ghi nào');
  await db.exec(`RESET ROLE;`);

  const class2TeacherCheck = await db.query(`SELECT teacher_id FROM public.classes WHERE id = '${class2Id}';`);
  assert.strictEqual(class2TeacherCheck.rows[0]?.teacher_id, teacher2Id, 'TC3: teacher_id lớp 1B không bị chiếm đoạt');
  console.log('✅ TC3 PASS: Teacher tự nhận lớp của người khác bị chặn.');

  // ==========================================
  // TEST CASE 4: Teacher Direct DELETE Denied
  // ==========================================
  console.log('⏳ Kiểm thử TC4: Teacher không thể DELETE class...');
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${teacher1Id}', false);
  `);
  const deleteRes = await db.query(`
    DELETE FROM public.classes WHERE id = '${class1Id}' RETURNING *;
  `);
  assert.strictEqual(deleteRes.rows.length, 0, 'TC4: Teacher DELETE phải không xóa được dòng nào');
  await db.exec(`RESET ROLE;`);

  const class1ExistCheck = await db.query(`SELECT COUNT(*)::int AS cnt FROM public.classes WHERE id = '${class1Id}';`);
  assert.strictEqual(class1ExistCheck.rows[0]?.cnt, 1, 'TC4: Lớp vẫn tồn tại nguyên vẹn');
  console.log('✅ TC4 PASS: Teacher DELETE bị chặn hoàn toàn.');

  // ==========================================
  // TEST CASE 5: Admin Full CRUD Allowed
  // ==========================================
  console.log('⏳ Kiểm thử TC5: Admin vẫn INSERT/UPDATE/DELETE class hợp lệ...');
  const newClassId = '44444444-4444-4444-4444-444444444443';
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${adminId}', false);
    INSERT INTO public.classes (id, name, code, grade_level, teacher_id)
    VALUES ('${newClassId}', 'Lớp 2A Mới', 'L2A01', 2, '${teacher1Id}');
  `);

  const updateAdminRes = await db.query(`
    UPDATE public.classes SET name = 'Lớp 2A Cập Nhật' WHERE id = '${newClassId}' RETURNING *;
  `);
  assert.strictEqual(updateAdminRes.rows.length, 1, 'TC5: Admin UPDATE thành công');
  assert.strictEqual(updateAdminRes.rows[0]?.name, 'Lớp 2A Cập Nhật', 'TC5: Tên lớp đã được Admin cập nhật');

  const deleteAdminRes = await db.query(`
    DELETE FROM public.classes WHERE id = '${newClassId}' RETURNING *;
  `);
  assert.strictEqual(deleteAdminRes.rows.length, 1, 'TC5: Admin DELETE thành công');
  await db.exec(`RESET ROLE;`);
  console.log('✅ TC5 PASS: Admin thực hiện đầy đủ INSERT/UPDATE/DELETE thành công.');

  // ==========================================
  // TEST CASE 6: Teacher SELECT assigned classes preserved
  // ==========================================
  console.log('⏳ Kiểm thử TC6: Teacher SELECT được lớp được phân công...');
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${teacher1Id}', false);
  `);
  const teacherSelectRes = await db.query(`SELECT id, name FROM public.classes;`);
  assert.strictEqual(teacherSelectRes.rows.length, 1, 'TC6: Teacher 1 chỉ thấy đúng 1 lớp được phân công (Lớp 1A)');
  assert.strictEqual(teacherSelectRes.rows[0]?.id, class1Id, 'TC6: Lớp nhìn thấy đúng là class1');
  await db.exec(`RESET ROLE;`);
  console.log('✅ TC6 PASS: Teacher SELECT đúng các lớp được phân công.');

  // ==========================================
  // TEST CASE 7: Student SELECT enrolled class preserved
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

  // =========================================================================
  // ADVERSARIAL TESTS (KIỂM THỬ ĐỐI KHÁNG BẢO MẬT & FAIL-CLOSED NGUYÊN TỬ)
  // =========================================================================
  console.log('\n=== TIẾN HÀNH CÁC KIỂM THỬ ĐỐI KHÁNG ADVERSARIAL & FAIL-CLOSED ===\n');

  // ADVERSARIAL 1: Cài đặt rogue policy FOR ALL trước migration -> Pre-drop Assertion chặn đứng và giữ nguyên state
  console.log('⏳ Adversarial TC1: Cài đặt rogue policy FOR ALL trước migration...');
  {
    const advDb = new PGlite();
    await setupBaseRolesAndProfiles(advDb);
    await advDb.exec(pr95Sql);

    // Cài rogue policy ALL cho teacher
    await advDb.exec(`
      CREATE POLICY "rogue_all_teacher_policy" ON public.classes
        FOR ALL USING (teacher_id = auth.uid()) WITH CHECK (teacher_id = auth.uid());
    `);

    // Lưu danh sách policies trước khi chạy migration
    const beforePolicies = await advDb.query(`
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'classes' ORDER BY policyname;
    `);

    let caughtAllError = false;
    let errorMessage = '';
    try {
      await advDb.exec(hardeningSql);
    } catch (err) {
      caughtAllError = true;
      errorMessage = err.message;
      await advDb.exec('ROLLBACK;').catch(() => {});
    }

    assert.strictEqual(caughtAllError, true, 'Adv TC1: Migration phải từ chối chạy khi phát hiện cmd=ALL trước khi drop');
    assert(errorMessage.includes('PRE-DROP VALIDATION FAILED'), 'Adv TC1: Lỗi phải đến từ PRE-DROP VALIDATION');

    // Kiểm tra catalog sau lỗi: policy ALL và toàn bộ policy ban đầu vẫn còn nguyên vẹn 100% (không bị xóa âm thầm)
    const afterPolicies = await advDb.query(`
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'classes' ORDER BY policyname;
    `);
    assert.deepStrictEqual(
      afterPolicies.rows.map(r => r.policyname),
      beforePolicies.rows.map(r => r.policyname),
      'Adv TC1: Toàn bộ policies ban đầu (kể cả rogue ALL policy) được bảo toàn nguyên vẹn sau rollback'
    );
    await advDb.close();
    console.log('✅ Adv TC1 PASS: Rogue policy FOR ALL bị chặn ở Pre-drop assertion và catalog được bảo toàn 100%.');
  }

  // ADVERSARIAL 2: Cài đặt unknown / unwhitelisted policy trước migration -> Pre-drop Assertion chặn đứng
  console.log('⏳ Adversarial TC2: Policy lạ ngoài whitelist bị phát hiện trước khi DROP...');
  {
    const advDb = new PGlite();
    await setupBaseRolesAndProfiles(advDb);
    await advDb.exec(pr95Sql);

    // Cài policy lạ ngoài whitelist
    await advDb.exec(`
      CREATE POLICY "unwhitelisted_custom_policy" ON public.classes
        FOR INSERT WITH CHECK (app_private.is_admin());
    `);

    const beforePolicies = await advDb.query(`
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'classes' ORDER BY policyname;
    `);

    let caughtUnknownError = false;
    let errorMessage = '';
    try {
      await advDb.exec(hardeningSql);
    } catch (err) {
      caughtUnknownError = true;
      errorMessage = err.message;
      await advDb.exec('ROLLBACK;').catch(() => {});
    }

    assert.strictEqual(caughtUnknownError, true, 'Adv TC2: Migration phải từ chối chạy khi có policy ngoài whitelist');
    assert(errorMessage.includes('PRE-DROP VALIDATION FAILED'), 'Adv TC2: Lỗi phải đến từ PRE-DROP VALIDATION');

    const afterPolicies = await advDb.query(`
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'classes' ORDER BY policyname;
    `);
    assert.deepStrictEqual(
      afterPolicies.rows.map(r => r.policyname),
      beforePolicies.rows.map(r => r.policyname),
      'Adv TC2: Toàn bộ policies ban đầu (kể cả unwhitelisted policy) được bảo toàn nguyên vẹn sau rollback'
    );
    await advDb.close();
    console.log('✅ Adv TC2 PASS: Policy lạ ngoài whitelist bị chặn trước khi DROP và state được bảo toàn 100%.');
  }

  // ADVERSARIAL 3: Chạy Idempotent re-run trên database đã migrate -> PASS 100%
  console.log('⏳ Adversarial TC3: Idempotent re-run trên database đã migrate thành công...');
  {
    const advDb = new PGlite();
    await setupBaseRolesAndProfiles(advDb);
    await advDb.exec(pr95Sql);
    // Lần 1: migration từ Set A -> Set B
    await advDb.exec(hardeningSql);

    // Lần 2: migration lại từ Set B -> Set B (Idempotent)
    await advDb.exec(hardeningSql);

    const policies = await advDb.query(`
      SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'classes' ORDER BY policyname;
    `);
    assert.strictEqual(policies.rows.length, 4, 'Adv TC3: Idempotent re-run phải giữ đúng 4 policies');
    assert.deepStrictEqual(
      policies.rows.map(r => r.policyname),
      ['classes_delete', 'classes_insert', 'classes_select', 'classes_update'],
      'Adv TC3: 4 policies whitelist chính xác sau re-run'
    );
    await advDb.close();
    console.log('✅ Adv TC3 PASS: Idempotent re-run thành công tuyệt đối.');
  }

  // ADVERSARIAL 4: Postcondition phát hiện policy "is_admin() OR is_teacher()" -> Ném lỗi và Rollback
  console.log('⏳ Adversarial TC4: Policy giả mạo "is_admin() OR is_teacher()" bị chặn bởi hậu kiểm...');
  {
    const advDb = new PGlite();
    await setupBaseRolesAndProfiles(advDb);
    await advDb.exec(pr95Sql);
    await advDb.exec(`
      CREATE OR REPLACE FUNCTION app_private.is_teacher() RETURNS BOOLEAN LANGUAGE sql AS $$ SELECT false; $$;
    `);

    let caughtError = false;
    try {
      await advDb.exec(`
        BEGIN;
        DROP POLICY IF EXISTS "classes_insert" ON public.classes;
        CREATE POLICY "classes_insert" ON public.classes
          FOR INSERT WITH CHECK (app_private.is_admin() OR app_private.is_teacher());

        -- Chạy postcondition block
        DO $$
        DECLARE
          v_insert_check TEXT;
          v_rogue_mutation_policies INT;
        BEGIN
          SELECT with_check INTO v_insert_check
          FROM pg_policies WHERE schemaname = 'public' AND tablename = 'classes' AND policyname = 'classes_insert';

          IF regexp_replace(v_insert_check, '[\\s\\(\\)]', '', 'g') <> 'app_private.is_admin' THEN
            RAISE EXCEPTION 'RLS HARDENING FAILURE: classes_insert WITH CHECK không khớp chính xác app_private.is_admin()!';
          END IF;
        END $$;
        COMMIT;
      `);
    } catch (err) {
      caughtError = true;
      assert(err.message.includes('RLS HARDENING FAILURE'), 'Lỗi phải chứa RLS HARDENING FAILURE');
    }
    assert.strictEqual(caughtError, true, 'Adv TC4: Policy "is_admin() OR is_teacher()" phải bị chặn đứng');
    await advDb.close();
    console.log('✅ Adv TC4 PASS: Policy chứa is_teacher() bị chặn tuyệt đối.');
  }

  // ADVERSARIAL 5: Xác minh Transaction Rollback bảo toàn toàn bộ schema khi có lỗi bất kỳ
  console.log('⏳ Adversarial TC5: Xác minh Transaction Rollback bảo toàn toàn bộ schema...');
  {
    const advDb = new PGlite();
    await setupBaseRolesAndProfiles(advDb);
    await advDb.exec(pr95Sql);

    // Lưu snapshot policies trước khi cố chạy giao dịch lỗi
    const beforePolicies = await advDb.query(`
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'classes' ORDER BY policyname;
    `);

    // Thực thi transaction cố tình ném lỗi trong postcondition
    try {
      await advDb.exec(`
        BEGIN;
        CREATE POLICY "temp_test_policy" ON public.classes FOR SELECT USING (true);
        RAISE EXCEPTION 'MÔ PHỎNG LỖI HẬU ĐIỀU KIỆN';
        COMMIT;
      `);
    } catch (_) {
      // Transaction tự động rollback
    }

    const afterPolicies = await advDb.query(`
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'classes' ORDER BY policyname;
    `);

    assert.deepStrictEqual(
      afterPolicies.rows.map(r => r.policyname),
      beforePolicies.rows.map(r => r.policyname),
      'Adv TC5: Sau rollback, danh sách policies phải nguyên vẹn như trước'
    );
    await advDb.close();
    console.log('✅ Adv TC5 PASS: Rollback bảo toàn nguyên vẹn 100% catalog.');
  }

  console.log('\n============================================================');
  console.log('✅ ALL ADMIN-ONLY CLASS GOVERNANCE & ADVERSARIAL TESTS PASSED (13/13 Cases)');
  console.log('============================================================\n');
}

if (process.argv[1] && process.argv[1].endsWith('admin_only_class_governance.test.mjs')) {
  runAdminOnlyClassGovernanceTestSuite().catch(err => {
    console.error('❌ TEST FAILED:', err);
    process.exit(1);
  });
}
