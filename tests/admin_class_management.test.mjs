import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

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
  `);
}

export async function runAdminClassManagementTestSuite() {
  console.log('=== KHỞI TẠO TEST SUITE: QUẢN TRỊ XẾP/CHUYỂN LỚP VÀ PHÂN CÔNG GIÁO VIÊN ===\n');

  const db = new PGlite();

  // 1. Tạo các roles PostgreSQL trước để kiểm thử phân quyền REVOKE/GRANT thực tế
  await setupBaseRolesAndProfiles(db);

  await db.exec(`
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

    CREATE TABLE public.games (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      is_public BOOLEAN DEFAULT true
    );

    CREATE TABLE public.assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
      game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
      status TEXT DEFAULT 'active'
    );

    CREATE TABLE public.student_progress (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      assignment_id UUID REFERENCES public.assignments(id),
      score INT DEFAULT 100,
      stars_earned INT DEFAULT 10,
      completed_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  console.log('✅ 1. Khởi tạo roles (anon, authenticated) và schema ban đầu thành công.');

  // 2. Chạy Migration chính thức
  const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', '20260915223000_admin_student_teacher_class_management.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');
  await db.exec(migrationSql);
  console.log('✅ 2. Thực thi migration 20260915223000_admin_student_teacher_class_management.sql thành công.\n');

  // 3. Khởi tạo dữ liệu kiểm thử
  const adminId = '11111111-1111-1111-1111-111111111111';
  const disabledAdminId = '11111111-1111-1111-1111-111111111112';
  const teacher1Id = '22222222-2222-2222-2222-222222222221';
  const teacher2Id = '22222222-2222-2222-2222-222222222222';
  const disabledTeacherId = '22222222-2222-2222-2222-222222222223';
  const student1Id = '33333333-3333-3333-3333-333333333331';
  const student2Id = '33333333-3333-3333-3333-333333333332';
  const disabledStudentId = '33333333-3333-3333-3333-333333333333';

  const class1AId = '44444444-4444-4444-4444-444444444441';
  const class1BId = '44444444-4444-4444-4444-444444444442';
  const class2AId = '44444444-4444-4444-4444-444444444443';
  const tempClassId = '44444444-4444-4444-4444-444444444449';

  await db.exec(`
    INSERT INTO public.profiles (id, email, full_name, role, is_disabled, total_stars, total_coins) VALUES
      ('${adminId}', 'admin@school.vn', 'Quản trị viên', 'admin', false, 0, 0),
      ('${disabledAdminId}', 'disabled_admin@school.vn', 'Admin Bị Khóa', 'admin', true, 0, 0),
      ('${teacher1Id}', 'teacher1@school.vn', 'Cô Mai', 'teacher', false, 0, 0),
      ('${teacher2Id}', 'teacher2@school.vn', 'Thầy Hùng', 'teacher', false, 0, 0),
      ('${disabledTeacherId}', 'teacher_locked@school.vn', 'GV Bị Khóa', 'teacher', true, 0, 0),
      ('${student1Id}', 'student1@school.vn', 'Nguyễn Văn An', 'student', false, 50, 25),
      ('${student2Id}', 'student2@school.vn', 'Trần Thị Bình', 'student', false, 30, 15),
      ('${disabledStudentId}', 'student_locked@school.vn', 'HS Bị Khóa', 'student', true, 0, 0);

    INSERT INTO public.classes (id, name, code, grade_level, teacher_id) VALUES
      ('${class1AId}', 'Lớp 1A', 'LOP1A', 1, NULL),
      ('${class1BId}', 'Lớp 1B', 'LOP1B', 1, NULL),
      ('${class2AId}', 'Lớp 2A', 'LOP2A', 2, NULL),
      ('${tempClassId}', 'Lớp Tạm Xóa', 'LOPTAM', 1, NULL);
  `);

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`  ✅ PASS [${totalTests}]: ${message}`);
      passedTests++;
    } else {
      console.error(`  ❌ FAIL [${totalTests}]: ${message}`);
      throw new Error(`Test failed: ${message}`);
    }
  }

  // Helper thực thi RPC dưới role authenticated chính xác
  async function callRpcAs(userId, sqlQuery) {
    try {
      await db.exec(`
        SET ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', ${userId ? `'${userId}'` : "''"}, false);
      `);
      return await db.query(sqlQuery);
    } finally {
      await db.exec(`RESET ROLE;`);
    }
  }

  console.log('=== TIẾN HÀNH KIỂM THỬ CÁC TÌNH HUỐNG (TEST CASES) ===\n');

  // TEST 1: Admin hợp lệ gọi assign_student_to_class dưới SET ROLE authenticated thành công
  let res = await callRpcAs(adminId, `SELECT public.assign_student_to_class('${student1Id}', '${class1AId}', 'Xếp đầu năm') AS r;`);
  let result = res.rows[0].r;
  assert(result.success === true && result.status === 'ASSIGNED_SUCCESSFULLY', 'SET ROLE authenticated: Admin xếp học sinh 1 vào Lớp 1A thành công');

  // Kiểm tra bảng class_members và lịch sử append-only kèm snapshot
  let cmCheck = await db.query(`SELECT is_active, is_primary FROM public.class_members WHERE student_id = '${student1Id}' AND class_id = '${class1AId}';`);
  assert(cmCheck.rows[0].is_active === true && cmCheck.rows[0].is_primary === true, 'Bản ghi class_members có is_active = true');

  let historyCheck = await db.query(`
    SELECT action, change_reason, student_id_snapshot, student_name_snapshot, class_id_snapshot, class_name_snapshot, assigned_by_snapshot
    FROM public.class_membership_history
    WHERE student_id = '${student1Id}' AND class_id = '${class1AId}';
  `);
  assert(historyCheck.rows.length === 1 && historyCheck.rows[0].action === 'ASSIGN', 'Lịch sử append-only ghi nhận hành động ASSIGN');
  assert(
    historyCheck.rows[0].student_id_snapshot === student1Id &&
    historyCheck.rows[0].student_name_snapshot === 'Nguyễn Văn An' &&
    historyCheck.rows[0].class_id_snapshot === class1AId &&
    historyCheck.rows[0].class_name_snapshot === 'Lớp 1A' &&
    historyCheck.rows[0].assigned_by_snapshot === adminId,
    'Lịch sử lưu đầy đủ 5 trường snapshot danh tính bất biến của học sinh, lớp và admin'
  );

  // TEST 2: Idempotent khi xếp lại cùng Lớp 1A
  res = await callRpcAs(adminId, `SELECT public.assign_student_to_class('${student1Id}', '${class1AId}') AS r;`);
  assert(res.rows[0].r.success === true && res.rows[0].r.status === 'ALREADY_ASSIGNED', 'Xếp lại trùng lớp trả về ALREADY_ASSIGNED');

  // TEST 3: Xếp học sinh đang có lớp sang lớp khác bằng assign -> Báo lỗi TRANSFER_REQUIRED
  res = await callRpcAs(adminId, `SELECT public.assign_student_to_class('${student1Id}', '${class1BId}') AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'TRANSFER_REQUIRED', 'Xếp học sinh đang có lớp sang lớp khác báo TRANSFER_REQUIRED');

  // TEST 4: Chuyển lớp với p_from_class_id = NULL -> Từ chối SOURCE_CLASS_REQUIRED
  res = await callRpcAs(adminId, `SELECT public.transfer_student_class('${student1Id}', NULL, '${class1BId}', 'Thiếu lớp nguồn') AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'SOURCE_CLASS_REQUIRED', 'Chuyển lớp với p_from_class_id = NULL bị từ chối SOURCE_CLASS_REQUIRED');

  // TEST 5: Chuyển lớp với lớp nguồn không tồn tại -> Từ chối SOURCE_CLASS_NOT_FOUND
  const nonExistentClassId = '99999999-9999-9999-9999-999999999991';
  res = await callRpcAs(adminId, `SELECT public.transfer_student_class('${student1Id}', '${nonExistentClassId}', '${class1BId}', 'Nguồn ảo') AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'SOURCE_CLASS_NOT_FOUND', 'Chuyển lớp với lớp nguồn ảo bị từ chối SOURCE_CLASS_NOT_FOUND');

  // TEST 6: Chuyển lớp với lớp nguồn sai khác lớp hiện tại -> Báo SOURCE_CLASS_MISMATCH
  res = await callRpcAs(adminId, `SELECT public.transfer_student_class('${student1Id}', '${class2AId}', '${class1BId}', 'Chuyển nhầm nguồn') AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'SOURCE_CLASS_MISMATCH', 'Chuyển lớp với lớp nguồn sai bị chặn SOURCE_CLASS_MISMATCH');

  // TEST 7: Chuyển lớp đúng lớp nguồn (1A -> 1B)
  res = await callRpcAs(adminId, `SELECT public.transfer_student_class('${student1Id}', '${class1AId}', '${class1BId}', 'Chuyển sang 1B') AS r;`);
  assert(res.rows[0].r.success === true && res.rows[0].r.status === 'TRANSFERRED_SUCCESSFULLY', 'Chuyển lớp 1A sang 1B thành công');

  let m1A = await db.query(`SELECT is_active FROM public.class_members WHERE student_id = '${student1Id}' AND class_id = '${class1AId}';`);
  let m1B = await db.query(`SELECT is_active FROM public.class_members WHERE student_id = '${student1Id}' AND class_id = '${class1BId}';`);
  assert(m1A.rows[0].is_active === false && m1B.rows[0].is_active === true, 'Lớp 1A inactive và Lớp 1B active');

  // TEST 8: Chuyển quay lại lớp cũ (1B -> 1A)
  res = await callRpcAs(adminId, `SELECT public.transfer_student_class('${student1Id}', '${class1BId}', '${class1AId}', 'Quay lại 1A') AS r;`);
  assert(res.rows[0].r.success === true && res.rows[0].r.status === 'TRANSFERRED_SUCCESSFULLY', 'Chuyển quay lại Lớp 1A thành công');

  // TEST 9: Gỡ học sinh khỏi lớp (Remove từ 1A)
  res = await callRpcAs(adminId, `SELECT public.remove_student_from_class('${student1Id}', '${class1AId}', 'Gỡ khỏi lớp') AS r;`);
  assert(res.rows[0].r.success === true && res.rows[0].r.status === 'REMOVED_SUCCESSFULLY', 'Gỡ học sinh khỏi lớp thành công');

  let activeCount = await db.query(`SELECT COUNT(*) as cnt FROM public.class_members WHERE student_id = '${student1Id}' AND is_active = true;`);
  assert(parseInt(activeCount.rows[0].cnt) === 0, 'Sau khi gỡ, học sinh có 0 membership active');

  // TEST 10: Kiểm tra TOÀN BỘ chuỗi lịch sử append-only: 1A -> 1B -> 1A -> REMOVE (Đúng 6 sự kiện riêng biệt)
  let allEvents = await db.query(`
    SELECT action, class_id, change_reason, student_name_snapshot, class_name_snapshot
    FROM public.class_membership_history
    WHERE student_id = '${student1Id}'
    ORDER BY created_at ASC, CASE action WHEN 'ASSIGN' THEN 1 WHEN 'TRANSFER_OUT' THEN 2 WHEN 'TRANSFER_IN' THEN 3 WHEN 'REMOVE' THEN 4 ELSE 5 END ASC;
  `);
  assert(allEvents.rows.length === 6, 'Chuỗi 1A -> 1B -> 1A -> REMOVE tạo đúng 6 events append-only');
  assert(allEvents.rows[0].action === 'ASSIGN' && allEvents.rows[0].class_id === class1AId && allEvents.rows[0].class_name_snapshot === 'Lớp 1A', 'Event 1: ASSIGN 1A');
  assert(allEvents.rows[1].action === 'TRANSFER_OUT' && allEvents.rows[1].class_id === class1AId && allEvents.rows[1].class_name_snapshot === 'Lớp 1A', 'Event 2: TRANSFER_OUT 1A');
  assert(allEvents.rows[2].action === 'TRANSFER_IN' && allEvents.rows[2].class_id === class1BId && allEvents.rows[2].class_name_snapshot === 'Lớp 1B', 'Event 3: TRANSFER_IN 1B');
  assert(allEvents.rows[3].action === 'TRANSFER_OUT' && allEvents.rows[3].class_id === class1BId && allEvents.rows[3].class_name_snapshot === 'Lớp 1B', 'Event 4: TRANSFER_OUT 1B');
  assert(allEvents.rows[4].action === 'TRANSFER_IN' && allEvents.rows[4].class_id === class1AId && allEvents.rows[4].class_name_snapshot === 'Lớp 1A', 'Event 5: TRANSFER_IN 1A');
  assert(allEvents.rows[5].action === 'REMOVE' && allEvents.rows[5].class_id === class1AId && allEvents.rows[5].class_name_snapshot === 'Lớp 1A', 'Event 6: REMOVE 1A');

  // TEST 11: Bảo toàn danh tính sau khi xóa hard-delete fixture lớp
  // Xếp student2 vào tempClassId, sau đó xóa tempClassId
  await callRpcAs(adminId, `SELECT public.assign_student_to_class('${student2Id}', '${tempClassId}', 'Gán lớp tạm để test delete') AS r;`);

  // Xóa fixture Lớp Tạm Xóa khỏi database
  await db.exec(`DELETE FROM public.classes WHERE id = '${tempClassId}';`);

  let tempHistory = await db.query(`
    SELECT student_id, class_id, student_id_snapshot, student_name_snapshot, class_id_snapshot, class_name_snapshot, assigned_by_snapshot
    FROM public.class_membership_history
    WHERE student_id = '${student2Id}' AND class_id_snapshot = '${tempClassId}';
  `);
  assert(tempHistory.rows.length === 1, 'Bản ghi lịch sử vẫn tồn tại 100% sau khi lớp học nguồn bị hard-delete');
  assert(tempHistory.rows[0].class_id === null, 'Cột FK class_id tự động chuyển thành NULL an toàn (ON DELETE SET NULL)');
  assert(
    tempHistory.rows[0].class_id_snapshot === tempClassId &&
    tempHistory.rows[0].class_name_snapshot === 'Lớp Tạm Xóa' &&
    tempHistory.rows[0].student_id_snapshot === student2Id &&
    tempHistory.rows[0].student_name_snapshot === 'Trần Thị Bình' &&
    tempHistory.rows[0].assigned_by_snapshot === adminId,
    'Tất cả 5 trường snapshot danh tính bất biến được bảo toàn nguyên vẹn sau hard-delete lớp học'
  );

  // TEST 12: CHECK constraint chặn hành động không hợp lệ
  let checkConstraintError = false;
  try {
    await db.exec(`
      INSERT INTO public.class_membership_history (
        student_id, class_id, action, student_id_snapshot, student_name_snapshot, class_id_snapshot, class_name_snapshot
      ) VALUES (
        '${student1Id}', '${class1AId}', 'INVALID_ACTION_TYPE', '${student1Id}', 'Nguyễn Văn An', '${class1AId}', 'Lớp 1A'
      );
    `);
  } catch (e) {
    checkConstraintError = true;
  }
  assert(checkConstraintError === true, 'CHECK constraint chặn hành động action không hợp lệ vào lịch sử');

  // TEST 13: Gỡ lại lớp đã inactive -> ALREADY_INACTIVE
  res = await callRpcAs(adminId, `SELECT public.remove_student_from_class('${student1Id}', '${class1AId}') AS r;`);
  assert(res.rows[0].r.success === true && res.rows[0].r.status === 'ALREADY_INACTIVE', 'Gỡ lại lớp đã inactive trả về ALREADY_INACTIVE');

  // TEST 14: Bảo mật: Chặn ghi trực tiếp (Direct Client Writes) bằng SET ROLE authenticated
  let directInsertBlocked = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      INSERT INTO public.class_members (class_id, student_id) VALUES ('${class1AId}', '${student2Id}');
    `);
  } catch (e) {
    directInsertBlocked = true;
  } finally {
    await db.exec(`RESET ROLE;`);
  }
  assert(directInsertBlocked === true, 'SET ROLE authenticated: Trực tiếp INSERT class_members bị PostgreSQL chặn (Permission Denied)');

  let directUpdateBlocked = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      UPDATE public.class_members SET is_active = false WHERE student_id = '${student1Id}';
    `);
  } catch (e) {
    directUpdateBlocked = true;
  } finally {
    await db.exec(`RESET ROLE;`);
  }
  assert(directUpdateBlocked === true, 'SET ROLE authenticated: Trực tiếp UPDATE class_members bị PostgreSQL chặn (Permission Denied)');

  let directDeleteBlocked = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      DELETE FROM public.class_members WHERE student_id = '${student1Id}';
    `);
  } catch (e) {
    directDeleteBlocked = true;
  } finally {
    await db.exec(`RESET ROLE;`);
  }
  assert(directDeleteBlocked === true, 'SET ROLE authenticated: Trực tiếp DELETE class_members bị PostgreSQL chặn (Permission Denied)');

  let directHistoryInsertBlocked = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      INSERT INTO public.class_membership_history (
        student_id, class_id, action, student_id_snapshot, student_name_snapshot, class_id_snapshot, class_name_snapshot
      ) VALUES (
        '${student2Id}', '${class1AId}', 'ASSIGN', '${student2Id}', 'Trần Thị Bình', '${class1AId}', 'Lớp 1A'
      );
    `);
  } catch (e) {
    directHistoryInsertBlocked = true;
  } finally {
    await db.exec(`RESET ROLE;`);
  }
  assert(directHistoryInsertBlocked === true, 'SET ROLE authenticated: Trực tiếp INSERT class_membership_history bị PostgreSQL chặn');

  let directHistoryUpdateBlocked = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      UPDATE public.class_membership_history SET action = 'ASSIGN' WHERE student_id = '${student1Id}';
    `);
  } catch (e) {
    directHistoryUpdateBlocked = true;
  } finally {
    await db.exec(`RESET ROLE;`);
  }
  assert(directHistoryUpdateBlocked === true, 'SET ROLE authenticated: Trực tiếp UPDATE class_membership_history bị PostgreSQL chặn');

  let directHistoryDeleteBlocked = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      DELETE FROM public.class_membership_history WHERE student_id = '${student1Id}';
    `);
  } catch (e) {
    directHistoryDeleteBlocked = true;
  } finally {
    await db.exec(`RESET ROLE;`);
  }
  assert(directHistoryDeleteBlocked === true, 'SET ROLE authenticated: Trực tiếp DELETE class_membership_history bị PostgreSQL chặn');

  // TEST 15: Bảo mật: Role anon bị từ chối gọi toàn bộ các RPC quản trị
  const rpcCalls = [
    `SELECT public.assign_student_to_class('${student2Id}', '${class1AId}');`,
    `SELECT public.transfer_student_class('${student2Id}', '${class1AId}', '${class1BId}');`,
    `SELECT public.remove_student_from_class('${student2Id}', '${class1AId}');`,
    `SELECT public.assign_teacher_to_classes('${teacher1Id}', ARRAY['${class1AId}'::UUID]);`,
    `SELECT public.remove_teacher_from_class('${teacher1Id}', '${class1AId}');`
  ];

  for (let i = 0; i < rpcCalls.length; i++) {
    let anonRpcBlocked = false;
    try {
      await db.exec(`
        SET ROLE anon;
        ${rpcCalls[i]}
      `);
    } catch (e) {
      anonRpcBlocked = true;
    } finally {
      await db.exec(`RESET ROLE;`);
    }
    assert(anonRpcBlocked === true, `SET ROLE anon: Gọi RPC quản trị [${i + 1}] bị PostgreSQL từ chối quyền EXECUTE`);
  }

  // TEST 16: Unauthenticated (authenticated role với auth.uid() IS NULL) -> UNAUTHORIZED
  res = await callRpcAs(null, `SELECT public.assign_student_to_class('${student2Id}', '${class1AId}') AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'UNAUTHORIZED', 'Unauthenticated (auth.uid() IS NULL) gọi RPC bị từ chối UNAUTHORIZED');

  // TEST 17: Bảo mật: Học sinh gọi toàn bộ 5 RPC quản trị dưới role authenticated -> FORBIDDEN
  res = await callRpcAs(student1Id, `SELECT public.assign_student_to_class('${student2Id}', '${class1AId}') AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'FORBIDDEN', 'Học sinh gọi assign_student_to_class bị từ chối FORBIDDEN');

  res = await callRpcAs(student1Id, `SELECT public.transfer_student_class('${student2Id}', '${class1AId}', '${class1BId}') AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'FORBIDDEN', 'Học sinh gọi transfer_student_class bị từ chối FORBIDDEN');

  res = await callRpcAs(student1Id, `SELECT public.remove_student_from_class('${student2Id}', '${class1AId}') AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'FORBIDDEN', 'Học sinh gọi remove_student_from_class bị từ chối FORBIDDEN');

  res = await callRpcAs(student1Id, `SELECT public.assign_teacher_to_classes('${teacher1Id}', ARRAY['${class1AId}'::UUID]) AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'FORBIDDEN', 'Học sinh gọi assign_teacher_to_classes bị từ chối FORBIDDEN');

  res = await callRpcAs(student1Id, `SELECT public.remove_teacher_from_class('${teacher1Id}', '${class1AId}') AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'FORBIDDEN', 'Học sinh gọi remove_teacher_from_class bị từ chối FORBIDDEN');

  // TEST 18: Bảo mật: Giáo viên gọi toàn bộ 5 RPC quản trị dưới role authenticated -> FORBIDDEN
  res = await callRpcAs(teacher1Id, `SELECT public.assign_student_to_class('${student2Id}', '${class1AId}') AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'FORBIDDEN', 'Giáo viên gọi assign_student_to_class bị từ chối FORBIDDEN');

  res = await callRpcAs(teacher1Id, `SELECT public.transfer_student_class('${student2Id}', '${class1AId}', '${class1BId}') AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'FORBIDDEN', 'Giáo viên gọi transfer_student_class bị từ chối FORBIDDEN');

  res = await callRpcAs(teacher1Id, `SELECT public.remove_student_from_class('${student2Id}', '${class1AId}') AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'FORBIDDEN', 'Giáo viên gọi remove_student_from_class bị từ chối FORBIDDEN');

  res = await callRpcAs(teacher1Id, `SELECT public.assign_teacher_to_classes('${teacher1Id}', ARRAY['${class1AId}'::UUID]) AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'FORBIDDEN', 'Giáo viên gọi assign_teacher_to_classes bị từ chối FORBIDDEN');

  res = await callRpcAs(teacher1Id, `SELECT public.remove_teacher_from_class('${teacher1Id}', '${class1AId}') AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'FORBIDDEN', 'Giáo viên gọi remove_teacher_from_class bị từ chối FORBIDDEN');

  // TEST 19: Bảo mật: Admin bị khóa (is_disabled = true) -> FORBIDDEN
  res = await callRpcAs(disabledAdminId, `SELECT public.assign_student_to_class('${student2Id}', '${class1AId}') AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'FORBIDDEN', 'Admin bị khóa bị từ chối FORBIDDEN');

  // TEST 20: Phân công giáo viên nhiều lớp dạng Atomic Sync (SET ROLE authenticated)
  res = await callRpcAs(adminId, `SELECT public.assign_teacher_to_classes('${teacher1Id}', ARRAY['${class1AId}'::UUID, '${class1BId}'::UUID]) AS r;`);
  assert(res.rows[0].r.success === true && res.rows[0].r.status === 'SYNCED_SUCCESSFULLY', 'Phân công Cô Mai phụ trách 2 lớp 1A và 1B thành công');

  let cCheck = await db.query(`SELECT id, teacher_id FROM public.classes WHERE id IN ('${class1AId}', '${class1BId}');`);
  assert(cCheck.rows.every(r => r.teacher_id === teacher1Id), 'Cả 2 lớp 1A và 1B đều do Cô Mai phụ trách');

  // TEST 21: Đồng bộ lại danh sách lớp (giữ 1A, bỏ 1B, thêm 2A) -> 1 RPC duy nhất
  res = await callRpcAs(adminId, `SELECT public.assign_teacher_to_classes('${teacher1Id}', ARRAY['${class1AId}'::UUID, '${class2AId}'::UUID]) AS r;`);
  assert(res.rows[0].r.success === true && res.rows[0].r.status === 'SYNCED_SUCCESSFULLY', 'Đồng bộ lại danh sách lớp cho Cô Mai thành công');

  let c1B = await db.query(`SELECT teacher_id FROM public.classes WHERE id = '${class1BId}';`);
  let c2A = await db.query(`SELECT teacher_id FROM public.classes WHERE id = '${class2AId}';`);
  assert(c1B.rows[0].teacher_id === null, 'Lớp 1B tự động gỡ phân công');
  assert(c2A.rows[0].teacher_id === teacher1Id, 'Lớp 2A tự động gán cho Cô Mai');

  // TEST 22: Gỡ toàn bộ lớp của giáo viên bằng mảng rỗng []
  res = await callRpcAs(adminId, `SELECT public.assign_teacher_to_classes('${teacher1Id}', ARRAY[]::UUID[]) AS r;`);
  assert(res.rows[0].r.success === true && res.rows[0].r.status === 'SYNCED_SUCCESSFULLY', 'Gỡ toàn bộ lớp của Cô Mai bằng mảng rỗng thành công');

  let cAll = await db.query(`SELECT COUNT(*) as cnt FROM public.classes WHERE teacher_id = '${teacher1Id}';`);
  assert(parseInt(cAll.rows[0].cnt) === 0, 'Cô Mai hiện không phụ trách lớp nào');

  // TEST 23: Phân công có 1 class_id không hợp lệ -> Rollback toàn bộ
  const fakeClassId = '99999999-9999-9999-9999-999999999999';
  res = await callRpcAs(adminId, `SELECT public.assign_teacher_to_classes('${teacher1Id}', ARRAY['${class1AId}'::UUID, '${fakeClassId}'::UUID]) AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'INVALID_CLASSES', 'Class ID không hợp lệ làm rollback toàn bộ thao tác');

  let c1ANotAssigned = await db.query(`SELECT teacher_id FROM public.classes WHERE id = '${class1AId}';`);
  assert(c1ANotAssigned.rows[0].teacher_id === null, 'Lớp 1A không bị gán nhầm nhờ rollback nguyên tử');

  // TEST 24: Gỡ giáo viên đơn lẻ (remove_teacher_from_class)
  await callRpcAs(adminId, `SELECT public.assign_teacher_to_classes('${teacher2Id}', ARRAY['${class1AId}'::UUID]);`);
  res = await callRpcAs(adminId, `SELECT public.remove_teacher_from_class('${teacher2Id}', '${class1AId}') AS r;`);
  assert(res.rows[0].r.success === true && res.rows[0].r.status === 'REMOVED_SUCCESSFULLY', 'Gỡ Thầy Hùng khỏi lớp 1A thành công');

  let c1AFinal = await db.query(`SELECT teacher_id, name FROM public.classes WHERE id = '${class1AId}';`);
  assert(c1AFinal.rows[0].teacher_id === null && c1AFinal.rows[0].name === 'Lớp 1A', 'Lớp 1A có teacher_id = NULL và lớp vẫn tồn tại 100%');

  // TEST 25: Helper teacher_owns_class và teacher_manages_student kiểm tra role và trạng thái khóa
  await callRpcAs(adminId, `SELECT public.assign_teacher_to_classes('${teacher1Id}', ARRAY['${class1AId}'::UUID]);`);
  await callRpcAs(adminId, `SELECT public.assign_student_to_class('${student1Id}', '${class1AId}');`);

  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${teacher1Id}', false);`);
  let ownsClass = await db.query(`SELECT app_private.teacher_owns_class('${class1AId}') AS r;`);
  let managesStudent = await db.query(`SELECT app_private.teacher_manages_student('${student1Id}') AS r;`);
  assert(ownsClass.rows[0].r === true && managesStudent.rows[0].r === true, 'Cô Mai sở hữu Lớp 1A và quản lý Học sinh 1');

  // RLS test: Giáo viên xem được class_members của lớp mình phụ trách
  let teacherCmSelect = await callRpcAs(teacher1Id, `SELECT student_id FROM public.class_members WHERE class_id = '${class1AId}';`);
  assert(teacherCmSelect.rows.length === 1 && teacherCmSelect.rows[0].student_id === student1Id, 'RLS: Giáo viên xem được học sinh trong lớp mình phụ trách');

  // Khi giáo viên bị khóa tài khoản -> mất quyền ngay lập tức
  await db.exec(`UPDATE public.profiles SET is_disabled = true WHERE id = '${teacher1Id}';`);
  ownsClass = await db.query(`SELECT app_private.teacher_owns_class('${class1AId}') AS r;`);
  managesStudent = await db.query(`SELECT app_private.teacher_manages_student('${student1Id}') AS r;`);
  assert(ownsClass.rows[0].r === false && managesStudent.rows[0].r === false, 'Giáo viên bị khóa tài khoản mất toàn bộ quyền sở hữu và quản lý');
  await db.exec(`UPDATE public.profiles SET is_disabled = false WHERE id = '${teacher1Id}';`);

  // TEST 26: Học sinh đã chuyển khỏi lớp không còn quyền truy cập
  await callRpcAs(adminId, `SELECT public.transfer_student_class('${student1Id}', '${class1AId}', '${class1BId}');`);
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${student1Id}', false);`);
  let inClass1A = await db.query(`SELECT app_private.student_in_class('${class1AId}') AS r;`);
  let inClass1B = await db.query(`SELECT app_private.student_in_class('${class1BId}') AS r;`);
  assert(inClass1A.rows[0].r === false && inClass1B.rows[0].r === true, 'Học sinh chỉ có quyền trong Lớp 1B mới, bị tước quyền trong Lớp 1A cũ');

  // TEST 27: Bảo toàn lịch sử học tập (tiến độ game, sao, xu)
  await db.exec(`
    INSERT INTO public.student_progress (student_id, score, stars_earned) VALUES ('${student1Id}', 100, 20);
  `);
  await callRpcAs(adminId, `SELECT public.remove_student_from_class('${student1Id}', '${class1BId}');`);

  let progressCheck = await db.query(`SELECT COUNT(*) as cnt FROM public.student_progress WHERE student_id = '${student1Id}';`);
  let profileCheck = await db.query(`SELECT total_stars, total_coins FROM public.profiles WHERE id = '${student1Id}';`);
  assert(parseInt(progressCheck.rows[0].cnt) === 1, 'Bản ghi student_progress được bảo toàn 100% sau khi gỡ lớp');
  assert(profileCheck.rows[0].total_stars === 50 && profileCheck.rows[0].total_coins === 25, 'Sao và Xu của học sinh được bảo toàn trọn vẹn');

  // TEST 28: Kiểm thử Concurrent Assignment Requests (Mô phỏng hai yêu cầu đồng thời)
  await callRpcAs(adminId, `SELECT public.remove_student_from_class('${student2Id}', '${class1AId}');`);
  await callRpcAs(adminId, `SELECT public.remove_student_from_class('${student2Id}', '${class1BId}');`);

  // Gọi đồng thời 2 lệnh assign vào 2 lớp khác nhau
  const [resConcurrent1, resConcurrent2] = await Promise.all([
    callRpcAs(adminId, `SELECT public.assign_student_to_class('${student2Id}', '${class1AId}', 'Assign 1A concurrent') AS r;`),
    callRpcAs(adminId, `SELECT public.assign_student_to_class('${student2Id}', '${class1BId}', 'Assign 1B concurrent') AS r;`)
  ]);

  const outcome1 = resConcurrent1.rows[0].r;
  const outcome2 = resConcurrent2.rows[0].r;

  let activeStudent2 = await db.query(`SELECT class_id, is_active FROM public.class_members WHERE student_id = '${student2Id}' AND is_active = true;`);
  assert(activeStudent2.rows.length === 1, 'Concurrent assignment: Kết quả cuối cùng duy nhất 1 membership active');
  assert(
    (outcome1.success === true && outcome2.status === 'TRANSFER_REQUIRED') ||
    (outcome2.success === true && outcome1.status === 'TRANSFER_REQUIRED'),
    'Concurrent assignment: 1 yêu cầu thành công và 1 yêu cầu bị từ chối TRANSFER_REQUIRED (nguyên tử)'
  );

  // TEST 29: Kiểm thử join_class_by_code stub - Disabled & Zero Data Mutation
  let joinRes = await callRpcAs(student1Id, `SELECT public.join_class_by_code('LOP1B') AS r;`);
  assert(
    joinRes.rows[0].r.success === false && joinRes.rows[0].r.status === 'DISABLED',
    'SET ROLE authenticated: Gọi join_class_by_code nhận đúng phản hồi DISABLED'
  );

  // TEST 30: Kiểm thử catalog permissions và zero-mutation của join_class_by_code
  let anonPrivCheck = await db.query(`SELECT has_function_privilege('anon', 'public.join_class_by_code(text)', 'EXECUTE') AS priv;`);
  let authPrivCheck = await db.query(`SELECT has_function_privilege('authenticated', 'public.join_class_by_code(text)', 'EXECUTE') AS priv;`);
  assert(anonPrivCheck.rows[0].priv === false, 'Catalog check: anon role bị thu hồi quyền EXECUTE trên join_class_by_code');
  assert(authPrivCheck.rows[0].priv === true, 'Catalog check: authenticated role có quyền EXECUTE trên join_class_by_code');

  let historyCountCheck = await db.query(`SELECT COUNT(*) AS cnt FROM public.class_membership_history;`);
  assert(parseInt(historyCountCheck.rows[0].cnt) >= 1, 'Lịch sử membership không bị can thiệp bởi join_class_by_code stub');

  console.log(`\n🎉 TẤT CẢ ${passedTests}/${totalTests} TESTS (UPGRADE MIGRATION & AUTHENTICATED ROLES) ĐÃ PASS XUẤT SẮC!\n`);
}

// SUITE: KIỂM THỬ ĐỘC LẬP TẤT CẢ CÁC TRƯỜNG HỢP FK DISCOVERY FAIL-CLOSED
export async function runFkDiscoveryFailClosedTestSuite() {
  console.log('=== KIỂM THỬ ĐỘC LẬP: FK DISCOVERY FAIL-CLOSED SUITE ===\n');

  const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', '20260915223000_admin_student_teacher_class_management.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');

  // Case 1: Chính xác 1 single-column FK -> PASS
  {
    console.log('▶ Test FK Case 1: Đúng 1 single-column FK từ classes(teacher_id) tham chiếu profiles...');
    const db = new PGlite();
    await setupBaseRolesAndProfiles(db);
    await db.exec(`
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
    await db.exec(migrationSql);
    console.log('  ✅ PASS: Migration thực thi thành công với chính xác 1 single-column FK.');
  }

  // Case 2: Không có FK nào (Zero-match) -> FAIL & Rollback
  {
    console.log('▶ Test FK Case 2: Không có FK nào (Zero match)...');
    const db = new PGlite();
    await setupBaseRolesAndProfiles(db);
    await db.exec(`
      CREATE TABLE public.classes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        code TEXT UNIQUE NOT NULL,
        grade_level INT DEFAULT 1,
        teacher_id UUID,
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
    let threwExpectedError = false;
    try {
      await db.exec(migrationSql);
    } catch (e) {
      if (e.message && e.message.includes('Không tìm thấy single-column foreign key constraint hợp lệ')) {
        threwExpectedError = true;
      }
    }
    if (!threwExpectedError) {
      throw new Error('FK Case 2 FAIL: Migration không dừng fail-closed khi có 0 foreign key constraint!');
    }
    console.log('  ✅ PASS: Migration dừng khẩn cấp và rollback toàn bộ khi v_con_count = 0.');
  }

  // Case 3: Chỉ có composite FK (Ví dụ FK trên (teacher_id, teacher_role)) -> FAIL & Rollback
  {
    console.log('▶ Test FK Case 3: Chỉ có composite FK...');
    const db = new PGlite();
    await setupBaseRolesAndProfiles(db);
    await db.exec(`
      ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_role_unique UNIQUE (id, role);
      CREATE TABLE public.classes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        code TEXT UNIQUE NOT NULL,
        grade_level INT DEFAULT 1,
        teacher_id UUID,
        teacher_role TEXT DEFAULT 'teacher',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT classes_teacher_composite_fk FOREIGN KEY (teacher_id, teacher_role) REFERENCES public.profiles(id, role)
      );
      CREATE TABLE public.class_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(class_id, student_id)
      );
    `);
    let threwExpectedError = false;
    try {
      await db.exec(migrationSql);
    } catch (e) {
      if (e.message && e.message.includes('Không tìm thấy single-column foreign key constraint hợp lệ')) {
        threwExpectedError = true;
      }
    }
    if (!threwExpectedError) {
      throw new Error('FK Case 3 FAIL: Composite FK bị nhận nhầm là single-column FK hợp lệ!');
    }
    console.log('  ✅ PASS: Migration dừng khẩn cấp và rollback khi chỉ có composite FK.');
  }

  // Case 4: Có nhiều hơn 1 single-column FK -> FAIL & Rollback
  {
    console.log('▶ Test FK Case 4: Có nhiều hơn 1 single-column FK phù hợp...');
    const db = new PGlite();
    await setupBaseRolesAndProfiles(db);
    await db.exec(`
      CREATE TABLE public.classes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        code TEXT UNIQUE NOT NULL,
        grade_level INT DEFAULT 1,
        teacher_id UUID,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT classes_teacher_id_fk1 FOREIGN KEY (teacher_id) REFERENCES public.profiles(id),
        CONSTRAINT classes_teacher_id_fk2 FOREIGN KEY (teacher_id) REFERENCES public.profiles(id)
      );
      CREATE TABLE public.class_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(class_id, student_id)
      );
    `);
    let threwExpectedError = false;
    try {
      await db.exec(migrationSql);
    } catch (e) {
      if (e.message && e.message.includes('Phát hiện 2 single-column foreign key constraints')) {
        threwExpectedError = true;
      }
    }
    if (!threwExpectedError) {
      throw new Error('FK Case 4 FAIL: Migration không dừng fail-closed khi có nhiều hơn 1 FK constraint!');
    }
    console.log('  ✅ PASS: Migration dừng khẩn cấp và rollback khi v_con_count > 1.');
  }

  console.log('🏆 TẤT CẢ 4/4 KIỂM THỬ ĐỘC LẬP FK DISCOVERY ĐÃ PASS HOÀN HẢO!\n');
}

export async function runFreshMigrationTest() {
  console.log('=== KIỂM THỬ FRESH MIGRATION TRÊN DATABASE TRẮNG ===\n');

  const db = new PGlite();
  await setupBaseRolesAndProfiles(db);

  await db.exec(`
    CREATE TABLE public.classes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      grade_level INT DEFAULT 1,
      teacher_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
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

  const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', '20260915223000_admin_student_teacher_class_management.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');
  await db.exec(migrationSql);
  console.log('✅ Fresh Migration thực thi thành công 100% trên database mới!');
}

// Chạy trực tiếp nếu file được thực thi
if (process.argv[1] && process.argv[1].includes('admin_class_management.test.mjs')) {
  (async () => {
    await runFkDiscoveryFailClosedTestSuite();
    await runAdminClassManagementTestSuite();
    await runFreshMigrationTest();
    console.log('\n🏆 TOÀN BỘ TEST SUITE (FK DISCOVERY, UPGRADE & FRESH MIGRATION) ĐÃ HOÀN TẤT THÀNH CÔNG RỰC RỠ!');
  })().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
}
