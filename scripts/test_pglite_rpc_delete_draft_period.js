import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Kích hoạt cờ --liftoff-only trước khi nạp WASM để ngăn V8 TurboFan Zone OOM trên máy 4GB RAM
if (!process.execArgv.includes('--liftoff-only')) {
  const result = spawnSync(
    process.execPath,
    ['--liftoff-only', ...process.execArgv, __filename, ...process.argv.slice(2)],
    { stdio: 'inherit' }
  );
  process.exit(result.status ?? 0);
}

async function setupDatabase(PGlite) {
  const db = new PGlite();

  // 1. Roles & auth schema
  await db.exec(`
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

    CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
    $$;

    CREATE SCHEMA IF NOT EXISTS app_private;

    CREATE OR REPLACE FUNCTION app_private.can_manage_class(p_class_id uuid)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $$
    DECLARE
      v_uid UUID := (SELECT auth.uid());
      v_role TEXT;
      v_disabled BOOLEAN;
    BEGIN
      IF v_uid IS NULL THEN RETURN FALSE; END IF;
      SELECT role, COALESCE(is_disabled, false) INTO v_role, v_disabled FROM public.profiles WHERE id = v_uid;
      IF v_disabled IS TRUE THEN RETURN FALSE; END IF;
      IF v_role = 'admin' THEN RETURN TRUE; END IF;
      IF v_role = 'teacher' THEN
        RETURN EXISTS (SELECT 1 FROM public.classes WHERE id = p_class_id AND teacher_id = v_uid);
      END IF;
      RETURN FALSE;
    END;
    $$;
  `);

  // 2. DDL tables
  await db.exec(`
    CREATE TABLE IF NOT EXISTS public.profiles (
      id UUID PRIMARY KEY,
      role TEXT,
      full_name TEXT,
      is_disabled BOOLEAN DEFAULT FALSE
    );

    CREATE TABLE IF NOT EXISTS public.classes (
      id UUID PRIMARY KEY,
      name TEXT,
      teacher_id UUID
    );

    CREATE TABLE IF NOT EXISTS public.ranking_periods (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      class_id UUID REFERENCES public.classes(id),
      name TEXT NOT NULL,
      period_type TEXT NOT NULL,
      start_at TIMESTAMPTZ NOT NULL,
      end_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      created_by UUID REFERENCES public.profiles(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      closed_by UUID,
      closed_at TIMESTAMPTZ
    );
  `);

  // 3. Load migration SQL from DELETE_DRAFT_RANKING_PERIOD.sql
  const sqlPath = path.resolve(__dirname, '../DELETE_DRAFT_RANKING_PERIOD.sql');
  const sqlContent = await fs.readFile(sqlPath, 'utf8');
  await db.exec(sqlContent);

  return db;
}

async function runTests() {
  const startTime = Date.now();
  console.log(`\n============================================================`);
  console.log(`▶ CHẠY BỘ KIỂM THỬ PGLITE: delete_draft_ranking_period`);
  console.log(`============================================================\n`);

  const { PGlite } = await import('@electric-sql/pglite');
  const db = await setupDatabase(PGlite);

  const teacherOwnerId = 'a0000000-0000-0000-0000-000000000001';
  const teacherOtherId = 'a0000000-0000-0000-0000-000000000002';
  const adminId        = 'a0000000-0000-0000-0000-000000000003';
  const studentId      = 'b0000000-0000-0000-0000-000000000001';
  const classId        = 'c0000000-0000-0000-0000-000000000001';

  // Seed fixture
  await db.exec(`
    INSERT INTO public.profiles (id, role, full_name) VALUES
      ('${teacherOwnerId}', 'teacher', 'Cô Giáo Chủ Nhiệm Lớp 1A'),
      ('${teacherOtherId}', 'teacher', 'Thầy Giáo Lớp 1B'),
      ('${adminId}', 'admin', 'Quản Trị Viên Hệ Thống'),
      ('${studentId}', 'student', 'Học Sinh Lớp 1A');

    INSERT INTO public.classes (id, name, teacher_id) VALUES
      ('${classId}', 'Lớp 1A', '${teacherOwnerId}');
  `);

  // Helper hàm gọi RPC
  async function callDeleteDraft(periodId, callerId) {
    if (callerId) {
      await db.exec(`SELECT set_config('app.current_user_id', '${callerId}', false);`);
    } else {
      await db.exec(`SELECT set_config('app.current_user_id', '', false);`);
    }
    const res = await db.query(`SELECT public.delete_draft_ranking_period('${periodId}') AS result;`);
    return res.rows[0]?.result;
  }

  // TC 1: NOT_FOUND (ID không tồn tại)
  console.log('⏳ [1/7] Kiểm thử NOT_FOUND (ID không tồn tại)...');
  {
    const nonExistentId = 'f0000000-0000-0000-0000-000000000999';
    const result = await callDeleteDraft(nonExistentId, teacherOwnerId);
    assert.strictEqual(result.success, false, 'TC1: success phải là false');
    assert.strictEqual(result.status, 'NOT_FOUND', 'TC1: status phải là NOT_FOUND');
    console.log('   ✅ TC1 PASS: Trả về NOT_FOUND khi ID không tồn tại');
  }

  // TC 2: Chưa đăng nhập (auth.uid() = NULL)
  console.log('⏳ [2/7] Kiểm thử Chưa đăng nhập (auth.uid() = NULL)...');
  {
    const draftPeriodId = 'd0000000-0000-0000-0000-000000000001';
    await db.exec(`
      INSERT INTO public.ranking_periods (id, class_id, name, period_type, start_at, end_at, status, created_by)
      VALUES ('${draftPeriodId}', '${classId}', 'Kỳ Nháp Test Auth', 'MONTH', NOW(), NOW() + INTERVAL '30 days', 'DRAFT', '${teacherOwnerId}');
    `);
    const result = await callDeleteDraft(draftPeriodId, null);
    assert.strictEqual(result.success, false, 'TC2: success phải là false');
    assert.strictEqual(result.status, 'FORBIDDEN', 'TC2: status phải là FORBIDDEN');

    // Đảm bảo bản ghi vẫn còn
    const check = await db.query(`SELECT COUNT(*)::int AS cnt FROM public.ranking_periods WHERE id = '${draftPeriodId}';`);
    assert.strictEqual(check.rows[0]?.cnt, 1, 'TC2: Bản ghi không được bị xóa');
    console.log('   ✅ TC2 PASS: Trả về FORBIDDEN và không xóa bản ghi khi auth.uid() = NULL');
  }

  // TC 3: User không có quyền (Học sinh & Giáo viên lớp khác)
  console.log('⏳ [3/7] Kiểm thử User không có quyền (Học sinh / Giáo viên lớp khác)...');
  {
    const draftPeriodId = 'd0000000-0000-0000-0000-000000000001';
    // 3a. Học sinh
    const resStudent = await callDeleteDraft(draftPeriodId, studentId);
    assert.strictEqual(resStudent.success, false, 'TC3a: Học sinh phải bị từ chối');
    assert.strictEqual(resStudent.status, 'FORBIDDEN', 'TC3a: status phải là FORBIDDEN');

    // 3b. Giáo viên lớp khác
    const resOtherTeacher = await callDeleteDraft(draftPeriodId, teacherOtherId);
    assert.strictEqual(resOtherTeacher.success, false, 'TC3b: Giáo viên lớp khác phải bị từ chối');
    assert.strictEqual(resOtherTeacher.status, 'FORBIDDEN', 'TC3b: status phải là FORBIDDEN');

    // Đảm bảo bản ghi vẫn còn
    const check = await db.query(`SELECT COUNT(*)::int AS cnt FROM public.ranking_periods WHERE id = '${draftPeriodId}';`);
    assert.strictEqual(check.rows[0]?.cnt, 1, 'TC3: Bản ghi không được bị xóa');
    console.log('   ✅ TC3 PASS: Cả học sinh và giáo viên lớp khác đều bị từ chối FORBIDDEN');
  }

  // TC 4: ACTIVE bị chặn (Tuyệt đối không cho xóa kỳ ACTIVE)
  console.log('⏳ [4/7] Kiểm thử ACTIVE bị chặn (Không thể xóa kỳ đang chạy)...');
  {
    const activePeriodId = 'd0000000-0000-0000-0000-000000000002';
    await db.exec(`
      INSERT INTO public.ranking_periods (id, class_id, name, period_type, start_at, end_at, status, created_by)
      VALUES ('${activePeriodId}', '${classId}', 'Kỳ Đang Chạy Active', 'MONTH', NOW(), NOW() + INTERVAL '30 days', 'ACTIVE', '${teacherOwnerId}');
    `);
    const result = await callDeleteDraft(activePeriodId, teacherOwnerId);
    assert.strictEqual(result.success, false, 'TC4: success phải là false');
    assert.strictEqual(result.status, 'INVALID_STATUS', 'TC4: status phải là INVALID_STATUS');

    // Đảm bảo bản ghi ACTIVE vẫn còn nguyên vẹn
    const check = await db.query(`SELECT status FROM public.ranking_periods WHERE id = '${activePeriodId}';`);
    assert.strictEqual(check.rows[0]?.status, 'ACTIVE', 'TC4: Kỳ ACTIVE phải được bảo toàn nguyên vẹn');
    console.log('   ✅ TC4 PASS: Khóa an toàn chặn xóa kỳ ACTIVE với status INVALID_STATUS');
  }

  // TC 5: CLOSED bị chặn (Tuyệt đối không cho xóa kỳ CLOSED lịch sử)
  console.log('⏳ [5/7] Kiểm thử CLOSED bị chặn (Không thể xóa kỳ đã đóng)...');
  {
    const closedPeriodId = 'd0000000-0000-0000-0000-000000000003';
    await db.exec(`
      INSERT INTO public.ranking_periods (id, class_id, name, period_type, start_at, end_at, status, created_by, closed_at)
      VALUES ('${closedPeriodId}', '${classId}', 'Kỳ Lịch Sử Closed', 'MONTH', NOW() - INTERVAL '60 days', NOW() - INTERVAL '30 days', 'CLOSED', '${teacherOwnerId}', NOW() - INTERVAL '30 days');
    `);
    const result = await callDeleteDraft(closedPeriodId, teacherOwnerId);
    assert.strictEqual(result.success, false, 'TC5: success phải là false');
    assert.strictEqual(result.status, 'INVALID_STATUS', 'TC5: status phải là INVALID_STATUS');

    // Đảm bảo bản ghi CLOSED vẫn còn nguyên vẹn
    const check = await db.query(`SELECT status FROM public.ranking_periods WHERE id = '${closedPeriodId}';`);
    assert.strictEqual(check.rows[0]?.status, 'CLOSED', 'TC5: Kỳ CLOSED phải được bảo toàn nguyên vẹn');
    console.log('   ✅ TC5 PASS: Khóa an toàn chặn xóa kỳ CLOSED với status INVALID_STATUS');
  }

  // TC 6: GV phụ trách xóa DRAFT thành công
  console.log('⏳ [6/7] Kiểm thử GV phụ trách xóa DRAFT thành công...');
  {
    const draftPeriodId = 'd0000000-0000-0000-0000-000000000001';
    const result = await callDeleteDraft(draftPeriodId, teacherOwnerId);
    assert.strictEqual(result.success, true, 'TC6: success phải là true');
    assert.strictEqual(result.status, 'DELETED', 'TC6: status phải là DELETED');

    // Xác nhận bản ghi đã bị xóa khỏi database
    const check = await db.query(`SELECT COUNT(*)::int AS cnt FROM public.ranking_periods WHERE id = '${draftPeriodId}';`);
    assert.strictEqual(check.rows[0]?.cnt, 0, 'TC6: Bản ghi DRAFT phải bị xóa khỏi bảng');
    console.log('   ✅ TC6 PASS: Giáo viên chủ nhiệm xóa thành công bản nháp DRAFT của lớp mình');
  }

  // TC 7: Admin xóa DRAFT thành công
  console.log('⏳ [7/7] Kiểm thử Admin xóa DRAFT thành công...');
  {
    const draftPeriodAdminId = 'd0000000-0000-0000-0000-000000000004';
    await db.exec(`
      INSERT INTO public.ranking_periods (id, class_id, name, period_type, start_at, end_at, status, created_by)
      VALUES ('${draftPeriodAdminId}', '${classId}', 'Kỳ Nháp Admin Xóa', 'MONTH', NOW(), NOW() + INTERVAL '30 days', 'DRAFT', '${teacherOwnerId}');
    `);
    const result = await callDeleteDraft(draftPeriodAdminId, adminId);
    assert.strictEqual(result.success, true, 'TC7: success phải là true');
    assert.strictEqual(result.status, 'DELETED', 'TC7: status phải là DELETED');

    // Xác nhận bản ghi đã bị xóa khỏi database
    const check = await db.query(`SELECT COUNT(*)::int AS cnt FROM public.ranking_periods WHERE id = '${draftPeriodAdminId}';`);
    assert.strictEqual(check.rows[0]?.cnt, 0, 'TC7: Bản ghi DRAFT phải bị xóa bởi Admin');
    console.log('   ✅ TC7 PASS: Admin xóa thành công bản nháp DRAFT');
  }

  await db.close();

  const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n============================================================`);
  console.log(`⏱ Tổng thời gian chạy: ${elapsedSeconds}s`);
  console.log(`✅ DELETE DRAFT RANKING PERIOD PGLITE TEST PASS`);
  console.log(`============================================================\n`);
}

runTests().catch(err => {
  console.error(`\n❌ TEST THẤT BẠI: ${err.message}`);
  process.exit(1);
});
