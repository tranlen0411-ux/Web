import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

export async function runAdminClassManagementTestSuite() {
  console.log('=== KHỞI TẠO TEST SUITE: QUẢN TRỊ XẾP/CHUYỂN LỚP VÀ PHÂN CÔNG GIÁO VIÊN ===\n');

  const db = new PGlite();

  // 1. Tạo các roles PostgreSQL trước để kiểm thử phân quyền REVOKE/GRANT thực tế
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
      SELECT current_setting('request.jwt.claim.sub', true)::UUID;
    $$;

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
      ('${class2AId}', 'Lớp 2A', 'LOP2A', 2, NULL);
  `);

  const setAuth = async (userId) => {
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '${userId}', false);`);
  };

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

  console.log('=== TIẾN HÀNH KIỂM THỬ CÁC TÌNH HUỐNG (TEST CASES) ===\n');

  // TEST 1: Admin xếp học sinh chưa có lớp vào Lớp 1A
  await setAuth(adminId);
  let res = await db.query(`SELECT public.assign_student_to_class('${student1Id}', '${class1AId}', 'Xếp đầu năm') AS r;`);
  let result = res.rows[0].r;
  assert(result.success === true && result.status === 'ASSIGNED_SUCCESSFULLY', 'Admin xếp học sinh 1 vào Lớp 1A thành công');

  // Kiểm tra bảng class_members và lịch sử append-only
  let cmCheck = await db.query(`SELECT is_active, is_primary FROM public.class_members WHERE student_id = '${student1Id}' AND class_id = '${class1AId}';`);
  assert(cmCheck.rows[0].is_active === true && cmCheck.rows[0].is_primary === true, 'Bản ghi class_members có is_active = true');

  let historyCheck = await db.query(`SELECT action, change_reason, created_at FROM public.class_membership_history WHERE student_id = '${student1Id}' AND class_id = '${class1AId}';`);
  assert(historyCheck.rows.length === 1 && historyCheck.rows[0].action === 'ASSIGN', 'Lịch sử append-only ghi nhận hành động ASSIGN (INSERT ONLY)');

  // TEST 2: Idempotent khi xếp lại cùng Lớp 1A
  res = await db.query(`SELECT public.assign_student_to_class('${student1Id}', '${class1AId}') AS r;`);
  assert(res.rows[0].r.success === true && res.rows[0].r.status === 'ALREADY_ASSIGNED', 'Xếp lại trùng lớp trả về ALREADY_ASSIGNED');

  // TEST 3: Xếp học sinh đang có lớp sang lớp khác bằng assign -> Báo lỗi TRANSFER_REQUIRED
  res = await db.query(`SELECT public.assign_student_to_class('${student1Id}', '${class1BId}') AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'TRANSFER_REQUIRED', 'Xếp học sinh đang có lớp sang lớp khác báo TRANSFER_REQUIRED');

  // TEST 4: Chuyển lớp với p_from_class_id = NULL -> Từ chối SOURCE_CLASS_REQUIRED
  res = await db.query(`SELECT public.transfer_student_class('${student1Id}', NULL, '${class1BId}', 'Thiếu lớp nguồn') AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'SOURCE_CLASS_REQUIRED', 'Chuyển lớp với p_from_class_id = NULL bị từ chối SOURCE_CLASS_REQUIRED');

  // TEST 5: Chuyển lớp với lớp nguồn không tồn tại -> Từ chối SOURCE_CLASS_NOT_FOUND
  const nonExistentClassId = '99999999-9999-9999-9999-999999999991';
  res = await db.query(`SELECT public.transfer_student_class('${student1Id}', '${nonExistentClassId}', '${class1BId}', 'Nguồn ảo') AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'SOURCE_CLASS_NOT_FOUND', 'Chuyển lớp với lớp nguồn ảo bị từ chối SOURCE_CLASS_NOT_FOUND');

  // TEST 6: Chuyển lớp với lớp nguồn sai khác lớp hiện tại -> Báo SOURCE_CLASS_MISMATCH
  res = await db.query(`SELECT public.transfer_student_class('${student1Id}', '${class2AId}', '${class1BId}', 'Chuyển nhầm nguồn') AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'SOURCE_CLASS_MISMATCH', 'Chuyển lớp với lớp nguồn sai bị chặn SOURCE_CLASS_MISMATCH');

  // TEST 7: Chuyển lớp đúng lớp nguồn (1A -> 1B)
  res = await db.query(`SELECT public.transfer_student_class('${student1Id}', '${class1AId}', '${class1BId}', 'Chuyển sang 1B') AS r;`);
  assert(res.rows[0].r.success === true && res.rows[0].r.status === 'TRANSFERRED_SUCCESSFULLY', 'Chuyển lớp 1A sang 1B thành công');

  let m1A = await db.query(`SELECT is_active FROM public.class_members WHERE student_id = '${student1Id}' AND class_id = '${class1AId}';`);
  let m1B = await db.query(`SELECT is_active FROM public.class_members WHERE student_id = '${student1Id}' AND class_id = '${class1BId}';`);
  assert(m1A.rows[0].is_active === false && m1B.rows[0].is_active === true, 'Lớp 1A inactive và Lớp 1B active');

  // TEST 8: Chuyển quay lại lớp cũ (1B -> 1A)
  res = await db.query(`SELECT public.transfer_student_class('${student1Id}', '${class1BId}', '${class1AId}', 'Quay lại 1A') AS r;`);
  assert(res.rows[0].r.success === true && res.rows[0].r.status === 'TRANSFERRED_SUCCESSFULLY', 'Chuyển quay lại Lớp 1A thành công');

  // TEST 9: Gỡ học sinh khỏi lớp (Remove từ 1A)
  res = await db.query(`SELECT public.remove_student_from_class('${student1Id}', '${class1AId}', 'Gỡ khỏi lớp') AS r;`);
  assert(res.rows[0].r.success === true && res.rows[0].r.status === 'REMOVED_SUCCESSFULLY', 'Gỡ học sinh khỏi lớp thành công');

  let activeCount = await db.query(`SELECT COUNT(*) as cnt FROM public.class_members WHERE student_id = '${student1Id}' AND is_active = true;`);
  assert(parseInt(activeCount.rows[0].cnt) === 0, 'Sau khi gỡ, học sinh có 0 membership active');

  // TEST 10: Kiểm tra TOÀN BỘ chuỗi lịch sử append-only: 1A -> 1B -> 1A -> REMOVE (Đúng 6 sự kiện riêng biệt)
  let allEvents = await db.query(`
    SELECT action, class_id, change_reason
    FROM public.class_membership_history
    WHERE student_id = '${student1Id}'
    ORDER BY created_at ASC;
  `);
  assert(allEvents.rows.length === 6, 'Chuỗi 1A -> 1B -> 1A -> REMOVE tạo đúng 6 events append-only');
  assert(allEvents.rows[0].action === 'ASSIGN' && allEvents.rows[0].class_id === class1AId, 'Event 1: ASSIGN 1A');
  assert(allEvents.rows[1].action === 'TRANSFER_OUT' && allEvents.rows[1].class_id === class1AId, 'Event 2: TRANSFER_OUT 1A');
  assert(allEvents.rows[2].action === 'TRANSFER_IN' && allEvents.rows[2].class_id === class1BId, 'Event 3: TRANSFER_IN 1B');
  assert(allEvents.rows[3].action === 'TRANSFER_OUT' && allEvents.rows[3].class_id === class1BId, 'Event 4: TRANSFER_OUT 1B');
  assert(allEvents.rows[4].action === 'TRANSFER_IN' && allEvents.rows[4].class_id === class1AId, 'Event 5: TRANSFER_IN 1A');
  assert(allEvents.rows[5].action === 'REMOVE' && allEvents.rows[5].class_id === class1AId, 'Event 6: REMOVE 1A');

  // TEST 11: Kiểm tra CHECK constraint trên action của class_membership_history
  let checkConstraintError = false;
  try {
    await db.exec(`
      INSERT INTO public.class_membership_history (student_id, class_id, action)
      VALUES ('${student1Id}', '${class1AId}', 'INVALID_ACTION_TYPE');
    `);
  } catch (e) {
    checkConstraintError = true;
  }
  assert(checkConstraintError === true, 'CHECK constraint chặn hành động action không hợp lệ vào lịch sử');

  // TEST 12: Gỡ lại lớp đã inactive -> ALREADY_INACTIVE
  res = await db.query(`SELECT public.remove_student_from_class('${student1Id}', '${class1AId}') AS r;`);
  assert(res.rows[0].r.success === true && res.rows[0].r.status === 'ALREADY_INACTIVE', 'Gỡ lại lớp đã inactive trả về ALREADY_INACTIVE');

  // TEST 13: Bảo mật: Chặn ghi trực tiếp (Direct Client Writes) bằng SET ROLE authenticated
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
      INSERT INTO public.class_membership_history (student_id, class_id, action) VALUES ('${student2Id}', '${class1AId}', 'ASSIGN');
    `);
  } catch (e) {
    directHistoryInsertBlocked = true;
  } finally {
    await db.exec(`RESET ROLE;`);
  }
  assert(directHistoryInsertBlocked === true, 'SET ROLE authenticated: Trực tiếp INSERT class_membership_history bị PostgreSQL chặn');

  // TEST 14: Bảo mật: Role anon bị từ chối gọi RPC
  let anonRpcBlocked = false;
  try {
    await db.exec(`
      SET ROLE anon;
      SELECT public.assign_student_to_class('${student2Id}', '${class1AId}');
    `);
  } catch (e) {
    anonRpcBlocked = true;
  } finally {
    await db.exec(`RESET ROLE;`);
  }
  assert(anonRpcBlocked === true, 'SET ROLE anon: Gọi RPC quản trị bị PostgreSQL chặn (Permission Denied)');

  // TEST 15: Bảo mật: Học sinh gọi RPC quản trị -> FORBIDDEN
  await setAuth(student1Id);
  res = await db.query(`SELECT public.assign_student_to_class('${student2Id}', '${class1AId}') AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'FORBIDDEN', 'Học sinh gọi assign_student_to_class bị từ chối FORBIDDEN');

  res = await db.query(`SELECT public.transfer_student_class('${student2Id}', '${class1AId}', '${class1BId}') AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'FORBIDDEN', 'Học sinh gọi transfer_student_class bị từ chối FORBIDDEN');

  res = await db.query(`SELECT public.remove_student_from_class('${student2Id}', '${class1AId}') AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'FORBIDDEN', 'Học sinh gọi remove_student_from_class bị từ chối FORBIDDEN');

  res = await db.query(`SELECT public.assign_teacher_to_classes('${teacher1Id}', ARRAY['${class1AId}'::UUID]) AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'FORBIDDEN', 'Học sinh gọi assign_teacher_to_classes bị từ chối FORBIDDEN');

  res = await db.query(`SELECT public.remove_teacher_from_class('${teacher1Id}', '${class1AId}') AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'FORBIDDEN', 'Học sinh gọi remove_teacher_from_class bị từ chối FORBIDDEN');

  // TEST 16: Bảo mật: Giáo viên gọi RPC quản trị -> FORBIDDEN
  await setAuth(teacher1Id);
  res = await db.query(`SELECT public.assign_student_to_class('${student2Id}', '${class1AId}') AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'FORBIDDEN', 'Giáo viên gọi assign_student_to_class bị từ chối FORBIDDEN');

  res = await db.query(`SELECT public.transfer_student_class('${student2Id}', '${class1AId}', '${class1BId}') AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'FORBIDDEN', 'Giáo viên gọi transfer_student_class bị từ chối FORBIDDEN');

  res = await db.query(`SELECT public.remove_student_from_class('${student2Id}', '${class1AId}') AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'FORBIDDEN', 'Giáo viên gọi remove_student_from_class bị từ chối FORBIDDEN');

  res = await db.query(`SELECT public.assign_teacher_to_classes('${teacher1Id}', ARRAY['${class1AId}'::UUID]) AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'FORBIDDEN', 'Giáo viên gọi assign_teacher_to_classes bị từ chối FORBIDDEN');

  res = await db.query(`SELECT public.remove_teacher_from_class('${teacher1Id}', '${class1AId}') AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'FORBIDDEN', 'Giáo viên gọi remove_teacher_from_class bị từ chối FORBIDDEN');

  // TEST 17: Bảo mật: Admin bị khóa (is_disabled = true) -> FORBIDDEN
  await setAuth(disabledAdminId);
  res = await db.query(`SELECT public.assign_student_to_class('${student2Id}', '${class1AId}') AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'FORBIDDEN', 'Admin bị khóa bị từ chối FORBIDDEN');

  // TEST 18: Phân công giáo viên nhiều lớp dạng Atomic Sync
  await setAuth(adminId);
  res = await db.query(`SELECT public.assign_teacher_to_classes('${teacher1Id}', ARRAY['${class1AId}'::UUID, '${class1BId}'::UUID]) AS r;`);
  assert(res.rows[0].r.success === true && res.rows[0].r.status === 'SYNCED_SUCCESSFULLY', 'Phân công Cô Mai phụ trách 2 lớp 1A và 1B thành công');

  let cCheck = await db.query(`SELECT id, teacher_id FROM public.classes WHERE id IN ('${class1AId}', '${class1BId}');`);
  assert(cCheck.rows.every(r => r.teacher_id === teacher1Id), 'Cả 2 lớp 1A và 1B đều do Cô Mai phụ trách');

  // TEST 19: Đồng bộ lại danh sách lớp (giữ 1A, bỏ 1B, thêm 2A) -> 1 RPC duy nhất
  res = await db.query(`SELECT public.assign_teacher_to_classes('${teacher1Id}', ARRAY['${class1AId}'::UUID, '${class2AId}'::UUID]) AS r;`);
  assert(res.rows[0].r.success === true && res.rows[0].r.status === 'SYNCED_SUCCESSFULLY', 'Đồng bộ lại danh sách lớp cho Cô Mai thành công');

  let c1B = await db.query(`SELECT teacher_id FROM public.classes WHERE id = '${class1BId}';`);
  let c2A = await db.query(`SELECT teacher_id FROM public.classes WHERE id = '${class2AId}';`);
  assert(c1B.rows[0].teacher_id === null, 'Lớp 1B tự động gỡ phân công');
  assert(c2A.rows[0].teacher_id === teacher1Id, 'Lớp 2A tự động gán cho Cô Mai');

  // TEST 20: Gỡ toàn bộ lớp của giáo viên bằng mảng rỗng []
  res = await db.query(`SELECT public.assign_teacher_to_classes('${teacher1Id}', ARRAY[]::UUID[]) AS r;`);
  assert(res.rows[0].r.success === true && res.rows[0].r.status === 'SYNCED_SUCCESSFULLY', 'Gỡ toàn bộ lớp của Cô Mai bằng mảng rỗng thành công');

  let cAll = await db.query(`SELECT COUNT(*) as cnt FROM public.classes WHERE teacher_id = '${teacher1Id}';`);
  assert(parseInt(cAll.rows[0].cnt) === 0, 'Cô Mai hiện không phụ trách lớp nào');

  // TEST 21: Phân công có 1 class_id không hợp lệ -> Rollback toàn bộ
  const fakeClassId = '99999999-9999-9999-9999-999999999999';
  res = await db.query(`SELECT public.assign_teacher_to_classes('${teacher1Id}', ARRAY['${class1AId}'::UUID, '${fakeClassId}'::UUID]) AS r;`);
  assert(res.rows[0].r.success === false && res.rows[0].r.status === 'INVALID_CLASSES', 'Class ID không hợp lệ làm rollback toàn bộ thao tác');

  let c1ANotAssigned = await db.query(`SELECT teacher_id FROM public.classes WHERE id = '${class1AId}';`);
  assert(c1ANotAssigned.rows[0].teacher_id === null, 'Lớp 1A không bị gán nhầm nhờ rollback nguyên tử');

  // TEST 22: Gỡ giáo viên đơn lẻ (remove_teacher_from_class)
  await db.query(`SELECT public.assign_teacher_to_classes('${teacher2Id}', ARRAY['${class1AId}'::UUID]);`);
  res = await db.query(`SELECT public.remove_teacher_from_class('${teacher2Id}', '${class1AId}') AS r;`);
  assert(res.rows[0].r.success === true && res.rows[0].r.status === 'REMOVED_SUCCESSFULLY', 'Gỡ Thầy Hùng khỏi lớp 1A thành công');

  let c1AFinal = await db.query(`SELECT teacher_id, name FROM public.classes WHERE id = '${class1AId}';`);
  assert(c1AFinal.rows[0].teacher_id === null && c1AFinal.rows[0].name === 'Lớp 1A', 'Lớp 1A có teacher_id = NULL và lớp vẫn tồn tại 100%');

  // TEST 23: Helper teacher_owns_class và teacher_manages_student kiểm tra role và trạng thái khóa
  await db.query(`SELECT public.assign_teacher_to_classes('${teacher1Id}', ARRAY['${class1AId}'::UUID]);`);
  await db.query(`SELECT public.assign_student_to_class('${student1Id}', '${class1AId}');`);

  await setAuth(teacher1Id);
  let ownsClass = await db.query(`SELECT app_private.teacher_owns_class('${class1AId}') AS r;`);
  let managesStudent = await db.query(`SELECT app_private.teacher_manages_student('${student1Id}') AS r;`);
  assert(ownsClass.rows[0].r === true && managesStudent.rows[0].r === true, 'Cô Mai sở hữu Lớp 1A và quản lý Học sinh 1');

  // Khi giáo viên bị khóa tài khoản -> mất quyền ngay lập tức
  await db.exec(`UPDATE public.profiles SET is_disabled = true WHERE id = '${teacher1Id}';`);
  ownsClass = await db.query(`SELECT app_private.teacher_owns_class('${class1AId}') AS r;`);
  managesStudent = await db.query(`SELECT app_private.teacher_manages_student('${student1Id}') AS r;`);
  assert(ownsClass.rows[0].r === false && managesStudent.rows[0].r === false, 'Giáo viên bị khóa tài khoản mất toàn bộ quyền sở hữu và quản lý');
  await db.exec(`UPDATE public.profiles SET is_disabled = false WHERE id = '${teacher1Id}';`);

  // TEST 24: Học sinh đã chuyển khỏi lớp không còn quyền truy cập
  await setAuth(adminId);
  await db.query(`SELECT public.transfer_student_class('${student1Id}', '${class1AId}', '${class1BId}');`);
  await setAuth(student1Id);
  let inClass1A = await db.query(`SELECT app_private.student_in_class('${class1AId}') AS r;`);
  let inClass1B = await db.query(`SELECT app_private.student_in_class('${class1BId}') AS r;`);
  assert(inClass1A.rows[0].r === false && inClass1B.rows[0].r === true, 'Học sinh chỉ có quyền trong Lớp 1B mới, bị tước quyền trong Lớp 1A cũ');

  // TEST 25: Bảo toàn lịch sử học tập (tiến độ game, sao, xu)
  await setAuth(adminId);
  await db.exec(`
    INSERT INTO public.student_progress (student_id, score, stars_earned) VALUES ('${student1Id}', 100, 20);
  `);
  await db.query(`SELECT public.remove_student_from_class('${student1Id}', '${class1BId}');`);

  let progressCheck = await db.query(`SELECT COUNT(*) as cnt FROM public.student_progress WHERE student_id = '${student1Id}';`);
  let profileCheck = await db.query(`SELECT total_stars, total_coins FROM public.profiles WHERE id = '${student1Id}';`);
  assert(parseInt(progressCheck.rows[0].cnt) === 1, 'Bản ghi student_progress được bảo toàn 100% sau khi gỡ lớp');
  assert(profileCheck.rows[0].total_stars === 50 && profileCheck.rows[0].total_coins === 25, 'Sao và Xu của học sinh được bảo toàn trọn vẹn');

  // TEST 26: Kiểm thử Concurrent Assignment Requests (Mô phỏng hai yêu cầu đồng thời)
  await setAuth(adminId);
  // Reset trạng thái student2
  await db.query(`SELECT public.remove_student_from_class('${student2Id}', '${class1AId}');`);
  await db.query(`SELECT public.remove_student_from_class('${student2Id}', '${class1BId}');`);

  // Gọi đồng thời 2 lệnh assign vào 2 lớp khác nhau
  const [resConcurrent1, resConcurrent2] = await Promise.all([
    db.query(`SELECT public.assign_student_to_class('${student2Id}', '${class1AId}', 'Assign 1A concurrent') AS r;`),
    db.query(`SELECT public.assign_student_to_class('${student2Id}', '${class1BId}', 'Assign 1B concurrent') AS r;`)
  ]);

  const outcome1 = resConcurrent1.rows[0].r;
  const outcome2 = resConcurrent2.rows[0].r;

  // Kiểm tra chỉ có duy nhất 1 lớp active
  let activeStudent2 = await db.query(`SELECT class_id, is_active FROM public.class_members WHERE student_id = '${student2Id}' AND is_active = true;`);
  assert(activeStudent2.rows.length === 1, 'Concurrent assignment: Kết quả cuối cùng duy nhất 1 membership active');
  assert(
    (outcome1.success === true && outcome2.status === 'TRANSFER_REQUIRED') ||
    (outcome2.success === true && outcome1.status === 'TRANSFER_REQUIRED'),
    'Concurrent assignment: 1 yêu cầu thành công và 1 yêu cầu bị từ chối TRANSFER_REQUIRED (nguyên tử)'
  );

  console.log(`\n🎉 TẤT CẢ ${passedTests}/${totalTests} TESTS (UPGRADE MIGRATION) ĐÃ PASS XUẤT SẮC!`);
}

export async function runFreshMigrationTest() {
  console.log('\n=== KIỂM THỬ FRESH MIGRATION TRÊN DATABASE TRẮNG ===\n');

  const db = new PGlite();
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
      SELECT current_setting('request.jwt.claim.sub', true)::UUID;
    $$;

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
    await runAdminClassManagementTestSuite();
    await runFreshMigrationTest();
    console.log('\n🏆 TOÀN BỘ TEST SUITE (UPGRADE & FRESH MIGRATION) ĐÃ HOÀN TẤT THÀNH CÔNG RỰC RỠ!');
  })().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
}
