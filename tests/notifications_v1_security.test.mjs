import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

export async function runNotificationsSecurityTestSuite() {
  console.log('=== KHỞI TẠO TEST SUITE: NOTIFICATIONS V1 SECURITY AUDIT & PRE-STAGING GATE ===\n');

  const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', '20261023210000_notifications_v1_schema_and_security.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');

  async function setupBaseSchema(db) {
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
      CREATE SCHEMA IF NOT EXISTS app_private;

      CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
      $$;

      -- Schema khớp chính xác baseline HỌC VUI
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
        teacher_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Lưu ý: class_members không có cột role; học sinh được liên kết qua student_id và is_active
      CREATE TABLE IF NOT EXISTS public.class_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(class_id, student_id)
      );

      -- Mo phong schema app_private va ham apply_student_rewards nhu tren Staging thuc te
      REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;
      GRANT USAGE ON SCHEMA app_private TO service_role;

      CREATE OR REPLACE FUNCTION app_private.apply_student_rewards(p_student_id UUID, p_stars INT, p_coins INT)
      RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
      BEGIN
        UPDATE public.profiles
        SET total_stars = COALESCE(total_stars, 0) + GREATEST(0, p_stars),
            total_coins = COALESCE(total_coins, 0) + GREATEST(0, p_coins),
            updated_at = NOW()
        WHERE id = p_student_id;
      END;
      $$;
      GRANT EXECUTE ON FUNCTION app_private.apply_student_rewards(UUID, INT, INT) TO PUBLIC;

      GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
      GRANT ALL ON ALL FUNCTIONS IN SCHEMA public, auth TO anon, authenticated, service_role;
    `);
  }

  const db = new PGlite();
  await setupBaseSchema(db);

  console.log('⏳ [Setup] Thực thi migration Notifications V1...');
  await db.exec(migrationSql);
  console.log('✅ [Setup] Migration Notifications V1 thực thi thành công trên engine PGlite.\n');

  // Khởi tạo các tài khoản đa vai trò
  const adminId = '11111111-1111-1111-1111-111111111111';
  const teacher1Id = '22222222-2222-2222-2222-222222222221'; // GV Lớp 1A (Khối 1)
  const teacher2Id = '22222222-2222-2222-2222-222222222222'; // GV Lớp 2A (Khối 2)
  const teacherFormerId = '22222222-2222-2222-2222-222222222223'; // GV sau này bị đổi role sang student
  const student1Id = '33333333-3333-3333-3333-333333333331'; // Học sinh active Lớp 1A (Khối 1)
  const studentFormerId = '33333333-3333-3333-3333-333333333339'; // Học sinh inactive Lớp 1A (is_active = false)
  const student2Id = '33333333-3333-3333-3333-333333333332'; // Học sinh active Lớp 2A (Khối 2)
  const parentId = '55555555-5555-5555-5555-555555555555'; // Phụ huynh
  const disabledTeacherId = '22222222-2222-2222-2222-222222222299'; // GV bị khóa tài khoản

  await db.exec(`
    INSERT INTO public.profiles (id, email, full_name, role, grade_level, is_disabled) VALUES
      ('${adminId}', 'admin@school.edu.vn', 'Admin Tổng', 'admin', NULL, false),
      ('${teacher1Id}', 'teacher1@school.edu.vn', 'Cô Mai (GV 1A)', 'teacher', 1, false),
      ('${teacher2Id}', 'teacher2@school.edu.vn', 'Thầy Tuấn (GV 2A)', 'teacher', 2, false),
      ('${teacherFormerId}', 'former_teacher@school.edu.vn', 'Thầy Nam (Sắp chuyển role)', 'teacher', 1, false),
      ('${student1Id}', 'student1@school.edu.vn', 'Em An (Active 1A)', 'student', 1, false),
      ('${studentFormerId}', 'former1@school.edu.vn', 'Em Cũ (Inactive 1A)', 'student', 1, false),
      ('${student2Id}', 'student2@school.edu.vn', 'Em Bình (Active 2A)', 'student', 2, false),
      ('${parentId}', 'parent@family.vn', 'Phụ huynh Bé An', 'parent', NULL, false),
      ('${disabledTeacherId}', 'disabled_gv@school.edu.vn', 'GV Bị Khóa', 'teacher', 1, true);
  `);

  const class1AId = '44444444-4444-4444-4444-444444444441';
  const class2AId = '44444444-4444-4444-4444-444444444442';
  const classFormerId = '44444444-4444-4444-4444-444444444443';

  await db.exec(`
    INSERT INTO public.classes (id, name, code, grade_level, teacher_id) VALUES
      ('${class1AId}', 'Lớp 1A', 'L1A01', 1, '${teacher1Id}'),
      ('${class2AId}', 'Lớp 2A', 'L2A01', 2, '${teacher2Id}'),
      ('${classFormerId}', 'Lớp 1C', 'L1C01', 1, '${teacherFormerId}');

    INSERT INTO public.class_members (class_id, student_id, is_active) VALUES
      ('${class1AId}', '${student1Id}', true),
      ('${class1AId}', '${studentFormerId}', false),
      ('${class2AId}', '${student2Id}', true),
      ('${classFormerId}', '${student1Id}', true);
  `);

  console.log('✅ [Setup] Khởi tạo dữ liệu đa vai trò thành công.\n');

  let totalTestsRun = 0;

  // ==========================================================================
  // NHÓM 1: CÚ PHÁP VÀ RÀNG BUỘC CƠ SỞ DỮ LIỆU (SYNTAX & SCHEMA CONSTRAINTS)
  // ==========================================================================
  console.log('--- NHÓM 1: CÚ PHÁP VÀ RÀNG BUỘC CƠ SỞ DỮ LIỆU (SCHEMA CONSTRAINTS) ---');

  console.log('⏳ Test 1.1: Xác minh target_type = individual đã bị loại bỏ khỏi schema V1...');
  let individualDenied = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${adminId}', false);
      INSERT INTO public.notifications (sender_id, title, content, target_type)
      VALUES ('${adminId}', 'Test Individual', 'Nội dung', 'individual');
      RESET ROLE;
    `);
  } catch (err) {
    individualDenied = true;
    await db.exec(`RESET ROLE;`);
    assert(err.message.includes('chk_notifications_target_type') || err.message.includes('INVALID_TARGET_TYPE') || err.message.includes('violates check constraint'));
  }
  assert.strictEqual(individualDenied, true, 'Giá trị individual phải bị chặn bởi Check Constraint');
  totalTestsRun++;
  console.log('✅ Test 1.1 PASS: Đã loại bỏ hoàn toàn individual khỏi schema V1.');

  console.log('⏳ Test 1.2: Xác minh ràng buộc chk_notifications_target_scope cho target_type = grade...');
  let invalidGradeDenied = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${adminId}', false);
      INSERT INTO public.notifications (sender_id, title, content, target_type, target_grade_level)
      VALUES ('${adminId}', 'Test Grade 6', 'Nội dung', 'grade', 6);
      RESET ROLE;
    `);
  } catch (err) {
    invalidGradeDenied = true;
    await db.exec(`RESET ROLE;`);
    assert(err.message.includes('chk_notifications_target_scope') || err.message.includes('INVALID_GRADE_LEVEL') || err.message.includes('violates check constraint'));
  }
  assert.strictEqual(invalidGradeDenied, true, 'Khối ngoài 1-5 phải bị chặn');
  totalTestsRun++;
  console.log('✅ Test 1.2 PASS: Ràng buộc target_type = grade (1-5) hoạt động chính xác.');

  // ==========================================================================
  // NHÓM 2: ZERO-TRUST VALIDATION TRÊN HELPER KIỂM TRA LỚP
  // Không tin vào p_is_admin hay p_sender_id. Quyền xác thực từ auth.uid() & profiles.
  // ==========================================================================
  console.log('\n--- NHÓM 2: ZERO-TRUST HELPER KIỂM TRA LỚP ---');

  console.log('⏳ Test 2.1: Giáo viên 1 gọi helper với lớp của GV 2 -> Bị ném ngoại lệ FORBIDDEN_CLASS...');
  let gvForeignClassDenied = false;
  try {
    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '${teacher1Id}', false);
      SELECT notifications_private.fn_notifications_validate_and_dedup_classes(ARRAY['${class2AId}'::uuid]);
    `);
  } catch (err) {
    gvForeignClassDenied = true;
    assert(err.message.includes('FORBIDDEN_CLASS'));
  }
  assert.strictEqual(gvForeignClassDenied, true, 'GV gửi lớp người khác phải bị chặn bởi Zero-Trust helper');
  totalTestsRun++;
  console.log('✅ Test 2.1 PASS: Helper tự xác thực danh tính từ auth.uid() và chặn quyền chéo lớp.');

  console.log('⏳ Test 2.2: Admin gọi helper với danh sách nhiều lớp -> Tự động xác thực quyền admin và lọc trùng...');
  await db.exec(`
    SELECT set_config('request.jwt.claim.sub', '${adminId}', false);
  `);
  const adminDedupRes = await db.query(`
    SELECT notifications_private.fn_notifications_validate_and_dedup_classes(
      ARRAY['${class1AId}'::uuid, '${class2AId}'::uuid, '${class1AId}'::uuid]
    ) AS deduped;
  `);
  assert.strictEqual(adminDedupRes.rows[0].deduped.length, 2, 'Admin gửi nhiều lớp thành công và tự lọc trùng');
  totalTestsRun++;
  console.log('✅ Test 2.2 PASS: Admin được phép gửi liên lớp hợp lệ.');

  // ==========================================================================
  // NHÓM 3: SNAPSHOT ĐỐI TƯỢNG VÀ PHẠM VI (CLASS ACTIVE, GRADE, ALL, EXCLUDE PARENT)
  // ==========================================================================
  console.log('\n--- NHÓM 3: SNAPSHOT ĐỐI TƯỢNG VÀ PHẠM VI (CLASS ACTIVE, GRADE, ALL) ---');

  console.log('⏳ Test 3.1: Snapshot theo lớp chỉ lấy class_members.is_active = TRUE và role = student...');
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${teacher1Id}', false);
  `);
  const createClassNotif = await db.query(`
    SELECT public.rpc_create_notification(
      'Bài tập Lớp 1A',
      'Làm bài trang 5',
      'normal',
      'exercise',
      'classes',
      NULL,
      ARRAY['${class1AId}'::uuid],
      NULL,
      NULL,
      NULL,
      true
    ) AS notif_id;
  `);
  const notifClassId = createClassNotif.rows[0].notif_id;
  await db.exec(`RESET ROLE;`);

  const recipientsClass = await db.query(`
    SELECT recipient_id FROM public.notification_recipients WHERE notification_id = '${notifClassId}';
  `);
  const recipientIdsClass = recipientsClass.rows.map(r => r.recipient_id);
  assert.strictEqual(recipientIdsClass.includes(student1Id), true, 'Học sinh An (is_active = true) phải nhận được');
  assert.strictEqual(recipientIdsClass.includes(studentFormerId), false, 'Học sinh Cũ (is_active = false) KHÔNG được nhận');
  assert.strictEqual(recipientIdsClass.includes(parentId), false, 'Phụ huynh KHÔNG được nằm trong danh sách người nhận');
  totalTestsRun++;
  console.log('✅ Test 3.1 PASS: Snapshot theo lớp chỉ nhận đúng học sinh is_active = true và role = student.');

  console.log('⏳ Test 3.2: Admin phát hành thông báo theo khối 1 -> Học sinh Khối 1 nhận đúng, Khối 2 KHÔNG nhận...');
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${adminId}', false);
  `);
  const createGradeNotif = await db.query(`
    SELECT public.rpc_create_notification(
      'Thông báo Khối 1',
      'Toàn bộ học sinh khối 1 mang bảng con',
      'high',
      'general',
      'grade',
      1,
      '{}',
      NULL,
      NULL,
      NULL,
      true
    ) AS notif_id;
  `);
  const notifGradeId = createGradeNotif.rows[0].notif_id;
  await db.exec(`RESET ROLE;`);

  // Kiểm tra bảng snapshot recipients
  const recipientsGrade = await db.query(`
    SELECT recipient_id FROM public.notification_recipients WHERE notification_id = '${notifGradeId}';
  `);
  const recipientIdsGrade = recipientsGrade.rows.map(r => r.recipient_id);
  assert.strictEqual(recipientIdsGrade.includes(student1Id), true, 'Học sinh Khối 1 (Em An) nhận đúng thông báo');
  assert.strictEqual(recipientIdsGrade.includes(studentFormerId), false, 'Học sinh Cũ Khối 1 (inactive) KHÔNG nhận');
  assert.strictEqual(recipientIdsGrade.includes(student2Id), false, 'Học sinh Khối 2 (Em Bình) TUYỆT ĐỐI KHÔNG nhận thông báo Khối 1');

  // Kiểm tra RPC đọc thông báo từ góc độ từng học sinh
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${student1Id}', false);
  `);
  const student1List = await db.query(`SELECT * FROM public.rpc_get_my_notifications();`);
  assert(student1List.rows.some(n => n.id === notifGradeId), 'Học sinh Khối 1 đọc được thông báo khối 1 qua RPC');

  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${student2Id}', false);`);
  const student2List = await db.query(`SELECT * FROM public.rpc_get_my_notifications();`);
  assert.strictEqual(student2List.rows.some(n => n.id === notifGradeId), false, 'Học sinh Khối 2 KHÔNG thấy thông báo Khối 1 trong danh sách của mình');
  await db.exec(`RESET ROLE;`);

  totalTestsRun++;
  console.log('✅ Test 3.2 PASS: Admin gửi theo khối lọc đúng học sinh Khối 1, cô lập hoàn toàn Khối 2.');

  console.log('⏳ Test 3.3: Thông báo toàn trường (target_type = all) giới hạn đúng student và teacher, LOẠI TRỪ phụ huynh...');
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${adminId}', false);
  `);
  const createAllNotif = await db.query(`
    SELECT public.rpc_create_notification(
      'Lễ Khai Giảng',
      'Toàn trường tập trung tại sân lễ',
      'urgent',
      'general',
      'all',
      NULL,
      '{}',
      NULL,
      NULL,
      NULL,
      true
    ) AS notif_id;
  `);
  const notifAllId = createAllNotif.rows[0].notif_id;
  await db.exec(`RESET ROLE;`);

  const recipientsAll = await db.query(`
    SELECT nr.recipient_id, p.role
    FROM public.notification_recipients nr
    JOIN public.profiles p ON p.id = nr.recipient_id
    WHERE nr.notification_id = '${notifAllId}';
  `);
  const allRoles = recipientsAll.rows.map(r => r.role);
  assert(allRoles.includes('student'), 'Học sinh phải nhận được');
  assert(allRoles.includes('teacher'), 'Giáo viên phải nhận được');
  assert.strictEqual(allRoles.includes('parent'), false, 'Phụ huynh TUYỆT ĐỐI KHÔNG nhận được thông báo toàn trường');
  assert.strictEqual(recipientsAll.rows.some(r => r.recipient_id === adminId), false, 'Người gửi (Admin) được loại trừ khỏi danh sách nhận');
  totalTestsRun++;
  console.log('✅ Test 3.3 PASS: Thông báo toàn trường lọc đúng học sinh và giáo viên, loại trừ tuyệt đối phụ huynh.');

  // ==========================================================================
  // NHÓM 4: CHỐNG XUẤT BẢN / XUẤT BẢN LẠI THÔNG BÁO ĐÃ THU HỒI
  // ==========================================================================
  console.log('\n--- NHÓM 4: CHỐNG XUẤT BẢN LẠI THÔNG BÁO ĐÃ THU HỒI ---');

  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${teacher1Id}', false);
  `);
  const createNotif1 = await db.query(`
    SELECT public.rpc_create_notification(
      'Thông báo thu hồi test',
      'Nội dung chuẩn bị thu hồi',
      'normal',
      'general',
      'classes',
      NULL,
      ARRAY['${class1AId}'::uuid],
      NULL,
      NULL,
      NULL,
      true
    ) AS notif_id;
  `);
  const notifRecallId = createNotif1.rows[0].notif_id;
  await db.query(`SELECT public.rpc_recall_notification('${notifRecallId}', 'Lý do thu hồi kiểm thử');`);
  await db.exec(`RESET ROLE;`);

  console.log('⏳ Test 4.1: Gọi rpc_publish_notification trên thông báo đã thu hồi -> Bị chặn...');
  let recallRepublishRpcDenied = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${teacher1Id}', false);
      SELECT public.rpc_publish_notification('${notifRecallId}');
      RESET ROLE;
    `);
  } catch (err) {
    recallRepublishRpcDenied = true;
    await db.exec(`RESET ROLE;`);
    assert(err.message.includes('FORBIDDEN_PUBLISH_RECALLED'));
  }
  assert.strictEqual(recallRepublishRpcDenied, true, 'RPC publish thông báo đã thu hồi phải bị từ chối');
  totalTestsRun++;
  console.log('✅ Test 4.1 PASS: RPC chặn đứng xuất bản lại thông báo đã thu hồi.');

  console.log('⏳ Test 4.2: Direct SQL UPDATE is_published = true trên thông báo đã thu hồi -> Bị Trigger chặn...');
  let recallRepublishDirectDenied = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${adminId}', false);
      UPDATE public.notifications
      SET is_published = true
      WHERE id = '${notifRecallId}';
      RESET ROLE;
    `);
  } catch (err) {
    recallRepublishDirectDenied = true;
    await db.exec(`RESET ROLE;`);
    assert(err.message.includes('FORBIDDEN_PUBLISH_RECALLED'));
  }
  assert.strictEqual(recallRepublishDirectDenied, true, 'Trigger chặn đứng xuất bản lại thông báo đã thu hồi');
  totalTestsRun++;
  console.log('✅ Test 4.2 PASS: Trigger cơ sở dữ liệu khóa cứng trạng thái đã thu hồi.');

  // ==========================================================================
  // NHÓM 5: KIỂM CHỨNG CHẶT CHẼ RPC_MARK_NOTIFICATION_AS_READ
  // ==========================================================================
  console.log('\n--- NHÓM 5: XÁC THỰC NGHIỆP VỤ ĐÁNH DẤU ĐÃ ĐỌC ---');

  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${teacher1Id}', false);
  `);
  const createDraftRes = await db.query(`
    SELECT public.rpc_create_notification(
      'Tin nháp chưa gửi',
      'Chưa xuất bản',
      'normal',
      'general',
      'classes',
      NULL,
      ARRAY['${class1AId}'::uuid],
      NULL,
      NULL,
      NULL,
      false
    ) AS notif_id;
  `);
  const draftOnlyId = createDraftRes.rows[0].notif_id;
  await db.exec(`RESET ROLE;`);

  console.log('⏳ Test 5.1: Đánh dấu đọc thông báo CHƯA XUẤT BẢN -> Bị ném lỗi FORBIDDEN_NOT_PUBLISHED...');
  let readDraftDenied = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${student1Id}', false);
      SELECT public.rpc_mark_notification_as_read('${draftOnlyId}');
      RESET ROLE;
    `);
  } catch (err) {
    readDraftDenied = true;
    await db.exec(`RESET ROLE;`);
    assert(err.message.includes('FORBIDDEN_NOT_PUBLISHED'));
  }
  assert.strictEqual(readDraftDenied, true, 'Đánh dấu đọc thông báo chưa xuất bản phải bị chặn');
  totalTestsRun++;
  console.log('✅ Test 5.1 PASS: Không thể đánh dấu đọc thông báo bản nháp.');

  console.log('⏳ Test 5.2: Đánh dấu đọc thông báo ĐÃ BỊ THU HỒI -> Bị ném lỗi FORBIDDEN_RECALLED...');
  let readRecalledDenied = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${student1Id}', false);
      SELECT public.rpc_mark_notification_as_read('${notifRecallId}');
      RESET ROLE;
    `);
  } catch (err) {
    readRecalledDenied = true;
    await db.exec(`RESET ROLE;`);
    assert(err.message.includes('FORBIDDEN_RECALLED'));
  }
  assert.strictEqual(readRecalledDenied, true, 'Đánh dấu đọc thông báo đã thu hồi phải bị chặn');
  totalTestsRun++;
  console.log('✅ Test 5.2 PASS: Không thể đánh dấu đọc thông báo đã bị thu hồi.');

  console.log('⏳ Test 5.3: Học sinh Lớp 2A (không phải người nhận) cố tình đánh dấu đọc -> Bị ném lỗi FORBIDDEN_NOT_RECIPIENT...');
  let notRecipientDenied = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${student2Id}', false);
      SELECT public.rpc_mark_notification_as_read('${notifClassId}');
      RESET ROLE;
    `);
  } catch (err) {
    notRecipientDenied = true;
    await db.exec(`RESET ROLE;`);
    assert(err.message.includes('FORBIDDEN_NOT_RECIPIENT'));
  }
  assert.strictEqual(notRecipientDenied, true, 'Người không nhận thông báo phải bị từ chối');
  totalTestsRun++;
  console.log('✅ Test 5.3 PASS: Chỉ đúng người nhận mới được đánh dấu đã đọc.');

  console.log('⏳ Test 5.4: Học sinh An (đúng người nhận) đánh dấu đọc -> Thành công và sinh read_at = NOW()...');
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${student1Id}', false);
    SELECT public.rpc_mark_notification_as_read('${notifClassId}');
    RESET ROLE;
  `);
  const student1ReadState = await db.query(`
    SELECT is_read, read_at FROM public.notification_recipients
    WHERE notification_id = '${notifClassId}' AND recipient_id = '${student1Id}';
  `);
  assert.strictEqual(student1ReadState.rows[0].is_read, true);
  assert.notStrictEqual(student1ReadState.rows[0].read_at, null);
  totalTestsRun++;
  console.log('✅ Test 5.4 PASS: Đúng người nhận đánh dấu đọc thành công.');

  // ==========================================================================
  // NHÓM 6: NHẤT QUÁN RLS VÀ DIRECT UPDATE BỎ QUA RPC
  // ==========================================================================
  console.log('\n--- NHÓM 6: NHẤT QUÁN RLS VÀ DIRECT UPDATE BỎ QUA RPC ---');

  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${teacher1Id}', false);
  `);
  const createDirectRes = await db.query(`
    SELECT public.rpc_create_notification(
      'Test Direct Publish',
      'Nội dung direct',
      'normal',
      'general',
      'classes',
      NULL,
      ARRAY['${class1AId}'::uuid],
      NULL,
      NULL,
      NULL,
      false
    ) AS notif_id;
  `);
  const directNotifId = createDirectRes.rows[0].notif_id;

  console.log('⏳ Test 6.1: Giáo viên chạy direct UPDATE xuất bản (bỏ qua RPC)...');
  await db.query(`
    UPDATE public.notifications
    SET is_published = true,
        published_at = '2000-01-01 00:00:00+00' -- Cố tình gửi timestamp giả
    WHERE id = '${directNotifId}';
  `);
  await db.exec(`RESET ROLE;`);

  const directPubCheck = await db.query(`
    SELECT is_published, published_at FROM public.notifications WHERE id = '${directNotifId}';
  `);
  assert.strictEqual(directPubCheck.rows[0].is_published, true);
  assert.notStrictEqual(new Date(directPubCheck.rows[0].published_at).getFullYear(), 2000, 'Server phải ép published_at = NOW()');

  const directSnapshotCheck = await db.query(`
    SELECT recipient_id FROM public.notification_recipients WHERE notification_id = '${directNotifId}';
  `);
  assert(directSnapshotCheck.rows.length >= 1, 'Trigger after_save phải tự động snapshot kể cả khi gọi direct UPDATE');
  totalTestsRun++;
  console.log('✅ Test 6.1 PASS: Direct UPDATE xuất bản tuân thủ đầy đủ server timestamp và snapshot trigger.');

  console.log('⏳ Test 6.2: Direct UPDATE cố tình chuyển is_published từ true về false -> Bị chặn...');
  let directUnpublishDenied = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${teacher1Id}', false);
      UPDATE public.notifications
      SET is_published = false
      WHERE id = '${directNotifId}';
      RESET ROLE;
    `);
  } catch (err) {
    directUnpublishDenied = true;
    await db.exec(`RESET ROLE;`);
    assert(err.message.includes('FORBIDDEN_UNPUBLISH'));
  }
  assert.strictEqual(directUnpublishDenied, true, 'Direct unpublish phải bị chặn');
  totalTestsRun++;
  console.log('✅ Test 6.2 PASS: Chặn direct unpublish qua SQL.');

  console.log('⏳ Test 6.3: Direct UPDATE cố tình thay đổi sender_id -> Bị chặn...');
  let directSenderChangeDenied = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${adminId}', false);
      UPDATE public.notifications
      SET sender_id = '${adminId}'
      WHERE id = '${directNotifId}';
      RESET ROLE;
    `);
  } catch (err) {
    directSenderChangeDenied = true;
    await db.exec(`RESET ROLE;`);
    assert(err.message.includes('FORBIDDEN_IMMUTABLE_FIELD'));
  }
  assert.strictEqual(directSenderChangeDenied, true, 'Direct đổi sender_id phải bị chặn');
  totalTestsRun++;
  console.log('✅ Test 6.3 PASS: Bảo vệ sender_id bất biến tuyệt đối qua direct SQL.');

  console.log('⏳ Test 6.4: Cấm tuyệt đối direct INSERT/UPDATE/DELETE vào notification_classes...');
  let notifClassesDirectDenied = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${teacher1Id}', false);
      INSERT INTO public.notification_classes (notification_id, class_id)
      VALUES ('${directNotifId}', '${class2AId}');
      RESET ROLE;
    `);
  } catch (err) {
    notifClassesDirectDenied = true;
    await db.exec(`RESET ROLE;`);
    assert(err.message.includes('permission denied for table notification_classes') || err.message.includes('42501'));
  }
  assert.strictEqual(notifClassesDirectDenied, true, 'Direct INSERT vào notification_classes phải bị chặn');
  totalTestsRun++;
  console.log('✅ Test 6.4 PASS: Bảng notification_classes được bảo vệ hoàn toàn khỏi thao tác trực tiếp của client.');

  console.log('⏳ Test 6.5: Direct UPDATE cố tình sửa title/content trên thông báo đã xuất bản -> Bị chặn...');
  let updatePublishedContentDenied = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${teacher1Id}', false);
      UPDATE public.notifications
      SET title = 'Tiêu đề đã bị sửa lén'
      WHERE id = '${directNotifId}';
      RESET ROLE;
    `);
  } catch (err) {
    updatePublishedContentDenied = true;
    await db.exec(`RESET ROLE;`);
    assert(err.message.includes('FORBIDDEN_MODIFICATION_PUBLISHED'));
  }
  assert.strictEqual(updatePublishedContentDenied, true, 'Direct sửa title tin đã xuất bản phải bị từ chối');
  totalTestsRun++;
  console.log('✅ Test 6.5 PASS: Khóa cứng bất biến trường title trên thông báo đã xuất bản.');

  console.log('⏳ Test 6.6: Direct UPDATE cố tình sửa priority/links trên thông báo đã xuất bản -> Bị chặn...');
  let updatePublishedLinksDenied = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${adminId}', false);
      UPDATE public.notifications
      SET priority = 'urgent',
          link_url = 'https://malicious-link.com'
      WHERE id = '${directNotifId}';
      RESET ROLE;
    `);
  } catch (err) {
    updatePublishedLinksDenied = true;
    await db.exec(`RESET ROLE;`);
    assert(err.message.includes('FORBIDDEN_MODIFICATION_PUBLISHED'));
  }
  assert.strictEqual(updatePublishedLinksDenied, true, 'Direct sửa priority/link_url tin đã xuất bản phải bị từ chối');
  totalTestsRun++;
  console.log('✅ Test 6.6 PASS: Khóa cứng bất biến các trường priority và link_url trên thông báo đã xuất bản.');

  console.log('⏳ Test 6.7: Admin chạy direct UPDATE cố tình set sender_id = NULL khi profile còn tồn tại -> Bị chặn...');
  let setNullSenderDenied = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${adminId}', false);
      UPDATE public.notifications
      SET sender_id = NULL
      WHERE id = '${directNotifId}';
      RESET ROLE;
    `);
  } catch (err) {
    setNullSenderDenied = true;
    await db.exec(`RESET ROLE;`);
    assert(err.message.includes('FORBIDDEN_IMMUTABLE_FIELD'));
  }
  assert.strictEqual(setNullSenderDenied, true, 'Admin direct UPDATE set sender_id = NULL khi profile tồn tại phải bị chặn');
  totalTestsRun++;
  console.log('✅ Test 6.7 PASS: Chặn Admin/User tự ý xóa sender_id khi tài khoản người gửi vẫn còn trong profiles.');

  console.log('⏳ Test 6.8: Cố tình set sender_id = NULL kèm payload sửa trường khác -> Bị chặn hoặc không thay đổi...');
  let exploitSenderNullDenied = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${adminId}', false);
      UPDATE public.notifications
      SET sender_id = NULL,
          title = 'Payload sửa lén'
      WHERE id = '${directNotifId}';
      RESET ROLE;
    `);
  } catch (err) {
    exploitSenderNullDenied = true;
    await db.exec(`RESET ROLE;`);
    assert(err.message.includes('FORBIDDEN_IMMUTABLE_FIELD'));
  }
  assert.strictEqual(exploitSenderNullDenied, true, 'Khai thác gán sender_id = NULL để sửa trường khác phải bị chặn');
  totalTestsRun++;
  console.log('✅ Test 6.8 PASS: Ngăn chặn triệt để hành vi lợi dụng nhánh gán sender_id = NULL để sửa đổi bất biến.');

  console.log('⏳ Test 6.9: Kiểm thử cố tình sửa thông báo đã xuất bản qua RPC / Stored Function -> Trigger chặn đứng...');
  // Giả lập Stored Procedure/RPC cố tình UPDATE thông báo đã xuất bản
  await db.exec(`
    CREATE OR REPLACE FUNCTION public.test_rpc_attempt_update_published(p_id UUID, p_new_content TEXT)
    RETURNS VOID AS $$
    BEGIN
      UPDATE public.notifications SET content = p_new_content WHERE id = p_id;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;
  `);
  let rpcUpdatePublishedDenied = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${teacher1Id}', false);
      SELECT public.test_rpc_attempt_update_published('${directNotifId}', 'Nội dung hack qua RPC');
      RESET ROLE;
    `);
  } catch (err) {
    rpcUpdatePublishedDenied = true;
    await db.exec(`RESET ROLE;`);
    assert(err.message.includes('FORBIDDEN_MODIFICATION_PUBLISHED'));
  }
  assert.strictEqual(rpcUpdatePublishedDenied, true, 'Sửa thông báo đã xuất bản qua RPC phải bị Trigger chặn đứng');
  await db.exec(`DROP FUNCTION IF EXISTS public.test_rpc_attempt_update_published(UUID, TEXT);`);

  // Kiểm tra quy trình chuẩn: Muốn sửa tin đã phát -> Thu hồi tin cũ và tạo tin mới
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${teacher1Id}', false);
    SELECT public.rpc_recall_notification('${directNotifId}', 'Cần cập nhật thông tin chính xác hơn');
  `);
  const createCorrectedRes = await db.query(`
    SELECT public.rpc_create_notification(
      'Test Direct Publish (Đã đính chính)',
      'Nội dung chính xác mới',
      'normal',
      'general',
      'classes',
      NULL,
      ARRAY['${class1AId}'::uuid],
      NULL,
      NULL,
      NULL,
      true
    ) AS notif_id;
  `);
  const correctedNotifId = createCorrectedRes.rows[0].notif_id;
  await db.exec(`RESET ROLE;`);

  const oldRecalledCheck = await db.query(`SELECT is_recalled, recall_reason FROM public.notifications WHERE id = '${directNotifId}';`);
  assert.strictEqual(oldRecalledCheck.rows[0].is_recalled, true);
  assert.strictEqual(oldRecalledCheck.rows[0].recall_reason, 'Cần cập nhật thông tin chính xác hơn');

  const newCorrectedCheck = await db.query(`SELECT is_published, title FROM public.notifications WHERE id = '${correctedNotifId}';`);
  assert.strictEqual(newCorrectedCheck.rows[0].is_published, true);
  assert.strictEqual(newCorrectedCheck.rows[0].title, 'Test Direct Publish (Đã đính chính)');
  totalTestsRun++;
  console.log('✅ Test 6.9 PASS: Cố tình sửa qua RPC bị chặn; quy trình thu hồi và tạo tin mới hoạt động chuẩn xác.');

  // ==========================================================================
  // NHÓM 7: KIỂM SOÁT TÀI KHOẢN BỊ KHÓA & ROLE ANON (FAIL-CLOSED)
  // ==========================================================================
  console.log('\n--- NHÓM 7: KIỂM SOÁT TÀI KHOẢN BỊ KHÓA & ROLE ANON (FAIL-CLOSED) ---');

  console.log('⏳ Test 7.1: Tài khoản bị khóa (is_disabled = true) cố tình SELECT thông báo -> 0 rows (Fail-closed)...');
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${disabledTeacherId}', false);
  `);
  const disabledSelect = await db.query(`SELECT * FROM public.notifications;`);
  assert.strictEqual(disabledSelect.rows.length, 0, 'Tài khoản bị khóa không được đọc thông báo');
  await db.exec(`RESET ROLE;`);
  totalTestsRun++;
  console.log('✅ Test 7.1 PASS: Tài khoản bị khóa bị cô lập hoàn toàn (Fail-closed).');

  console.log('⏳ Test 7.2: Role anon cố tình gọi RPC -> Bị chặn Permission Denied...');
  let anonRpcDenied = false;
  try {
    await db.exec(`
      SET ROLE anon;
      SELECT set_config('request.jwt.claim.sub', '', false);
      SELECT public.rpc_get_unread_notification_count();
      RESET ROLE;
    `);
  } catch (err) {
    anonRpcDenied = true;
    await db.exec(`RESET ROLE;`);
    assert(err.message.includes('permission denied') || err.message.includes('42501'));
  }
  assert.strictEqual(anonRpcDenied, true, 'Role anon bị từ chối gọi RPC');
  totalTestsRun++;
  console.log('✅ Test 7.2 PASS: Thu hồi quyền RPC khỏi role anon thành công.');

  // ==========================================================================
  // NHÓM 8: KIỂM TRA CHUYỂN ĐỔI VAI TRÒ (DEMOTION) & BẢO VỆ LỊCH SỬ THÔNG BÁO
  // ==========================================================================
  console.log('\n--- NHÓM 8: QUYỀN THỰC THI THEO VAI TRÒ HIỆN TẠI & BẢO TOÀN LỊCH SỬ ---');

  console.log('⏳ Test 8.1: Giáo viên bị đổi role thành student -> Không thể publish thông báo cũ qua RPC...');
  // Thầy Nam tạo bản nháp khi còn là Giáo viên
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${teacherFormerId}', false);
  `);
  const createFormerDraft = await db.query(`
    SELECT public.rpc_create_notification(
      'Thông báo của GV sắp đổi role',
      'Nội dung thông báo nháp',
      'normal',
      'general',
      'classes',
      NULL,
      ARRAY['${classFormerId}'::uuid],
      NULL,
      NULL,
      NULL,
      false
    ) AS notif_id;
  `);
  const formerDraftId = createFormerDraft.rows[0].notif_id;
  await db.exec(`RESET ROLE;`);

  // Admin chuyển role của Thầy Nam từ 'teacher' sang 'student'
  await db.exec(`UPDATE public.profiles SET role = 'student' WHERE id = '${teacherFormerId}';`);

  // Thầy Nam (nay mang role student) cố tình gọi rpc_publish_notification
  let demotedPublishRpcDenied = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${teacherFormerId}', false);
      SELECT public.rpc_publish_notification('${formerDraftId}');
      RESET ROLE;
    `);
  } catch (err) {
    demotedPublishRpcDenied = true;
    await db.exec(`RESET ROLE;`);
    assert(err.message.includes('FORBIDDEN_ROLE'));
  }
  assert.strictEqual(demotedPublishRpcDenied, true, 'Người bị giáng xuống student không thể publish qua RPC');
  totalTestsRun++;
  console.log('✅ Test 8.1 PASS: Tài khoản từng là GV nay mang role student bị chặn publish qua RPC.');

  console.log('⏳ Test 8.2: Giáo viên bị đổi role thành student -> Không thể direct UPDATE xuất bản...');
  let demotedDirectUpdateDenied = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${teacherFormerId}', false);
      UPDATE public.notifications
      SET is_published = true
      WHERE id = '${formerDraftId}';
      RESET ROLE;
    `);
  } catch (err) {
    demotedDirectUpdateDenied = true;
    await db.exec(`RESET ROLE;`);
    assert(err.message.includes('FORBIDDEN_ROLE') || err.message.includes('permission denied'));
  }
  // Nếu RLS chặn êm (0 rows updated), kiểm tra is_published vẫn là false
  const formerDraftCheck = await db.query(`SELECT is_published FROM public.notifications WHERE id = '${formerDraftId}';`);
  assert.strictEqual(formerDraftCheck.rows[0].is_published, false, 'Thông báo nháp không được phép xuất bản khi người tạo đã bị chuyển role');
  totalTestsRun++;
  console.log('✅ Test 8.2 PASS: Tài khoản bị đổi role bị chặn direct UPDATE xuất bản.');

  console.log('⏳ Test 8.3: Giáo viên bị đổi role thành student -> Không thể recall thông báo qua RPC...');
  // Admin xuất bản thông báo hộ
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${adminId}', false);
    SELECT public.rpc_publish_notification('${formerDraftId}');
    RESET ROLE;
  `);

  // Thầy Nam (role student) cố tình gọi recall
  let demotedRecallRpcDenied = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${teacherFormerId}', false);
      SELECT public.rpc_recall_notification('${formerDraftId}', 'Thu hồi trái phép');
      RESET ROLE;
    `);
  } catch (err) {
    demotedRecallRpcDenied = true;
    await db.exec(`RESET ROLE;`);
    assert(err.message.includes('FORBIDDEN_ROLE'));
  }
  assert.strictEqual(demotedRecallRpcDenied, true, 'Người bị giáng xuống student không thể recall qua RPC');
  totalTestsRun++;
  console.log('✅ Test 8.3 PASS: Tài khoản từng là GV nay mang role student bị chặn recall qua RPC.');

  // ==========================================================================
  // NHÓM 9: XÁC MINH HÀNH VI VÔ HIỆU HÓA HOẶC XÓA TÀI KHOẢN NGƯỜI GỬI
  // ==========================================================================
  console.log('\n--- NHÓM 9: BẢO TOÀN LỊCH SỬ KHI NGƯỜI GỬI BỊ VÔ HIỆU HÓA HOẶC XÓA ---');

  console.log('⏳ Test 9.1: Người gửi bị vô hiệu hóa (is_disabled = true) -> Học sinh vẫn xem được thông báo bình thường...');
  // Vô hiệu hóa Cô Mai (teacher1)
  await db.exec(`UPDATE public.profiles SET is_disabled = true WHERE id = '${teacher1Id}';`);

  // Học sinh An (student1) kiểm tra danh sách thông báo
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${student1Id}', false);
  `);
  const studentNotificationsAfterDisable = await db.query(`SELECT * FROM public.rpc_get_my_notifications();`);
  await db.exec(`RESET ROLE;`);

  assert(
    studentNotificationsAfterDisable.rows.some(n => n.id === notifClassId),
    'Học sinh vẫn xem được thông báo đã nhận kể cả khi giáo viên gửi bị vô hiệu hóa'
  );
  // Khôi phục trạng thái cho teacher1
  await db.exec(`UPDATE public.profiles SET is_disabled = false WHERE id = '${teacher1Id}';`);
  totalTestsRun++;
  console.log('✅ Test 9.1 PASS: Thông báo của người gửi bị vô hiệu hóa vẫn bảo toàn toàn vẹn cho học sinh.');

  console.log('⏳ Test 9.2: Xóa tài khoản người gửi -> Thông báo bảo toàn, sender_id thành NULL, sender_name_snapshot giữ nguyên...');
  // Tạo tài khoản giáo viên tạm thời
  const tempTeacherId = '22222222-2222-2222-2222-222222222288';
  const tempClassId = '44444444-4444-4444-4444-444444444488';
  await db.exec(`
    INSERT INTO public.profiles (id, email, full_name, role, is_disabled)
    VALUES ('${tempTeacherId}', 'temp_teacher@school.edu.vn', 'Thầy Hùng (Tạm thời)', 'teacher', false);

    INSERT INTO public.classes (id, name, code, grade_level, teacher_id)
    VALUES ('${tempClassId}', 'Lớp Tạm', 'LTAM01', 1, '${tempTeacherId}');

    INSERT INTO public.class_members (class_id, student_id, is_active)
    VALUES ('${tempClassId}', '${student1Id}', true);
  `);

  // Giáo viên tạm tạo và xuất bản thông báo
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${tempTeacherId}', false);
  `);
  const createTempNotifRes = await db.query(`
    SELECT public.rpc_create_notification(
      'Thông báo lớp tạm',
      'Nội dung trước khi xóa tài khoản',
      'normal',
      'general',
      'classes',
      NULL,
      ARRAY['${tempClassId}'::uuid],
      NULL,
      NULL,
      NULL,
      true
    ) AS notif_id;
  `);
  const tempNotifId = createTempNotifRes.rows[0].notif_id;
  await db.exec(`RESET ROLE;`);

  // Thực hiện XÓA VẬT LÝ tài khoản tempTeacherId khỏi bảng public.profiles
  await db.exec(`DELETE FROM public.profiles WHERE id = '${tempTeacherId}';`);

  // Kiểm tra thông báo có bị mất (CASCADE) không:
  const checkTempNotif = await db.query(`
    SELECT id, sender_id, sender_name_snapshot FROM public.notifications WHERE id = '${tempNotifId}';
  `);
  assert.strictEqual(checkTempNotif.rows.length, 1, 'Thông báo KHÔNG bị xóa theo (không bị CASCADE)');
  assert.strictEqual(checkTempNotif.rows[0].sender_id, null, 'sender_id được gán thành NULL theo chuẩn ON DELETE SET NULL');
  assert.strictEqual(checkTempNotif.rows[0].sender_name_snapshot, 'Thầy Hùng (Tạm thời)', 'sender_name_snapshot giữ nguyên tên tác giả ban đầu');

  // Học sinh kiểm tra danh sách: vẫn hiển thị tên người gửi lịch sử
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${student1Id}', false);
  `);
  const studentListAfterSenderDeleted = await db.query(`SELECT * FROM public.rpc_get_my_notifications();`);
  await db.exec(`RESET ROLE;`);

  const deletedSenderNotif = studentListAfterSenderDeleted.rows.find(n => n.id === tempNotifId);
  assert(deletedSenderNotif, 'Học sinh vẫn tìm thấy thông báo');
  assert.strictEqual(deletedSenderNotif.sender_name, 'Thầy Hùng (Tạm thời)', 'Tên người gửi fallback chính xác về sender_name_snapshot');
  totalTestsRun++;
  console.log('✅ Test 9.2 PASS: Xóa người gửi bảo toàn 100% lịch sử thông báo và snapshot tên tác giả.');

  console.log('⏳ Test 9.3: Giáo viên đổi tên trong profile -> rpc_get_my_notifications vẫn ưu tiên snapshot tên cũ...');
  // Giáo viên Cô Mai đổi tên profile
  await db.exec(`UPDATE public.profiles SET full_name = 'Cô Mai - Hiệu Trưởng' WHERE id = '${teacher1Id}';`);

  // Học sinh kiểm tra thông báo notifClassId (do Cô Mai tạo trước khi đổi tên)
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${student1Id}', false);
  `);
  const notifsAfterTeacherRename = await db.query(`SELECT * FROM public.rpc_get_my_notifications();`);
  await db.exec(`RESET ROLE;`);

  const notifFromRenamedTeacher = notifsAfterTeacherRename.rows.find(n => n.id === notifClassId);
  assert(notifFromRenamedTeacher, 'Học sinh vẫn nhận được thông báo');
  assert.strictEqual(
    notifFromRenamedTeacher.sender_name,
    'Cô Mai (GV 1A)',
    'sender_name phải bảo toàn giá trị snapshot lịch sử ban đầu, KHÔNG bị đổi thành tên profile mới'
  );

  // Khôi phục tên ban đầu cho Cô Mai
  await db.exec(`UPDATE public.profiles SET full_name = 'Cô Mai (GV 1A)' WHERE id = '${teacher1Id}';`);
  totalTestsRun++;
  console.log('✅ Test 9.3 PASS: Tên người gửi bảo toàn đúng snapshot lịch sử khi giáo viên đổi tên.');

  console.log('⏳ Test 9.4: Cố tình gán lại sender_id sau khi đã bị NULL do xóa tài khoản -> Bị chặn...');
  let reassignNullSenderDenied = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${adminId}', false);
      UPDATE public.notifications
      SET sender_id = '${adminId}'
      WHERE id = '${tempNotifId}';
      RESET ROLE;
    `);
  } catch (err) {
    reassignNullSenderDenied = true;
    await db.exec(`RESET ROLE;`);
    assert(err.message.includes('FORBIDDEN_IMMUTABLE_FIELD'));
  }
  assert.strictEqual(reassignNullSenderDenied, true, 'Không được phép gán lại sender_id sau khi đã thành NULL');
  totalTestsRun++;
  console.log('✅ Test 9.4 PASS: sender_id đã NULL bị khóa bất biến vĩnh viễn, không thể gán lại ID mới.');

  // ==========================================================================
  // NHÓM 10: RÀ SOÁT QUYỀN SECURITY DEFINER VÀ USAGE TRÊN SCHEMA NOTIFICATIONS_PRIVATE
  // ==========================================================================
  console.log('\n--- NHÓM 10: RÀ SOÁT QUYỀN SECURITY DEFINER & SCHEMA NOTIFICATIONS_PRIVATE ---');

  console.log('⏳ Test 10.1: Kiểm tra quyền thực thi hàm nội bộ notifications_private (Least Privilege)...');
  const internalPrivRes = await db.query(`
    SELECT
      has_function_privilege('authenticated', 'notifications_private.fn_notifications_validate_and_dedup_classes(uuid[])', 'execute') AS can_exec_validate,
      has_function_privilege('authenticated', 'notifications_private.fn_notifications_get_caller_profile()', 'execute') AS can_exec_profile,
      has_function_privilege('authenticated', 'notifications_private.fn_notifications_is_admin()', 'execute') AS can_exec_is_admin,
      has_function_privilege('authenticated', 'notifications_private.fn_notifications_is_active_teacher()', 'execute') AS can_exec_is_teacher;
  `);
  assert.strictEqual(internalPrivRes.rows[0].can_exec_validate, false, 'Authenticated KHÔNG được gọi trực tiếp helper validate');
  assert.strictEqual(internalPrivRes.rows[0].can_exec_profile, false, 'Authenticated KHÔNG được gọi trực tiếp get_caller_profile');
  assert.strictEqual(internalPrivRes.rows[0].can_exec_is_admin, true, 'Authenticated được phép gọi hàm RLS is_admin');
  assert.strictEqual(internalPrivRes.rows[0].can_exec_is_teacher, true, 'Authenticated được phép gọi hàm RLS is_active_teacher');
  totalTestsRun++;
  console.log('✅ Test 10.1 PASS: Các hàm nghiệp vụ nội bộ notifications_private được thu hồi hoàn toàn khỏi authenticated.');

  // ==========================================================================
  // NHÓM 11: MÔ HÌNH BẢO TOÀN LỊCH SỬ KHI XÓA HỌC SINH (RECIPIENT_ID ON DELETE CASCADE)
  // ==========================================================================
  console.log('\n--- NHÓM 11: CHÍNH SÁCH DỮ LIỆU KHI HỌC SINH NGHỈ HỌC HOẶC BỊ XÓA ---');

  const studentTempId = '33333333-3333-3333-3333-333333333388';
  await db.exec(`
    INSERT INTO public.profiles (id, email, full_name, role, grade_level, is_disabled)
    VALUES ('${studentTempId}', 'student_temp@school.edu.vn', 'Học sinh Tạm (Thôi học)', 'student', 1, false);

    INSERT INTO public.class_members (class_id, student_id, is_active)
    VALUES ('${class1AId}', '${studentTempId}', true);
  `);

  // Tạo và phát hành thông báo cho Lớp 1A
  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${teacher1Id}', false);
  `);
  const createStudentTestNotif = await db.query(`
    SELECT public.rpc_create_notification(
      'Thông báo kiểm tra học sinh',
      'Nội dung kiểm tra xóa học sinh',
      'normal',
      'general',
      'classes',
      NULL,
      ARRAY['${class1AId}'::uuid],
      NULL,
      NULL,
      NULL,
      true
    ) AS notif_id;
  `);
  const studentTestNotifId = createStudentTestNotif.rows[0].notif_id;
  await db.exec(`RESET ROLE;`);

  console.log('⏳ Test 11.1: Quản lý học sinh nghỉ học/chuyển trường (Soft Deactivation) -> Lịch sử nhận tin được BẢO TOÀN...');
  // Theo chính sách nghiệp vụ, khi học sinh nghỉ học: set is_disabled = true và class_members.is_active = false
  await db.exec(`
    UPDATE public.profiles SET is_disabled = true WHERE id = '${studentTempId}';
    UPDATE public.class_members SET is_active = false WHERE class_id = '${class1AId}' AND student_id = '${studentTempId}';
  `);

  const recipientCheckSoft = await db.query(`
    SELECT * FROM public.notification_recipients
    WHERE notification_id = '${studentTestNotifId}' AND recipient_id = '${studentTempId}';
  `);
  assert.strictEqual(recipientCheckSoft.rows.length, 1, 'Bản ghi notification_recipients vẫn tồn tại nguyên vẹn');
  totalTestsRun++;
  console.log('✅ Test 11.1 PASS: Soft deactivation bảo toàn 100% lịch sử phát hành tin nhắn của học sinh.');

  console.log('⏳ Test 11.2: Hard Delete tài khoản học sinh -> notification_recipients bị CASCADE (Right to be Forgotten), thông báo cha nguyên vẹn...');
  // Thực hiện XÓA VẬT LÝ profile học sinh khỏi DB
  await db.exec(`DELETE FROM public.profiles WHERE id = '${studentTempId}';`);

  // Kiểm tra bảng notification_recipients: Bản ghi của học sinh đó bị CASCADE xóa
  const recipientCheckHard = await db.query(`
    SELECT * FROM public.notification_recipients WHERE recipient_id = '${studentTempId}';
  `);
  assert.strictEqual(recipientCheckHard.rows.length, 0, 'Bản ghi recipient bị xóa theo đúng ON DELETE CASCADE');

  // Kiểm tra thông báo cha và các học sinh khác: Vẫn tồn tại bình thường
  const notifParentCheck = await db.query(`SELECT id FROM public.notifications WHERE id = '${studentTestNotifId}';`);
  assert.strictEqual(notifParentCheck.rows.length, 1, 'Thông báo cha vẫn tồn tại nguyên vẹn');

  const otherRecipientsCheck = await db.query(`
    SELECT recipient_id FROM public.notification_recipients WHERE notification_id = '${studentTestNotifId}';
  `);
  assert(otherRecipientsCheck.rows.some(r => r.recipient_id === student1Id), 'Các học sinh khác trong lớp vẫn còn đầy đủ biên nhận');
  totalTestsRun++;
  console.log('✅ Test 11.2 PASS: Hard Delete xóa sạch biên nhận cá nhân theo chuẩn GDPR/quyền riêng tư, không làm hỏng dữ liệu chung.');

  // ==========================================================================
  // NHÓM 12: BẢO VỆ BỨC TƯỜNG LỬA APP_PRIVATE & CHỐNG HACK SAO/COIN QUA NOTIFICATIONS
  // ==========================================================================
  console.log('\n--- NHÓM 12: BẢO VỆ BỨC TƯỜNG LỬA APP_PRIVATE & TEST ÂM REWARDS ---');

  console.log('⏳ Test 12.1: Xác nhận authenticated TUYỆT ĐỐI KHÔNG CÓ quyền USAGE trên app_private...');
  const appPrivateUsageRes = await db.query(`
    SELECT has_schema_privilege('authenticated', 'app_private', 'USAGE') AS can_usage;
  `);
  assert.strictEqual(
    appPrivateUsageRes.rows[0].can_usage,
    false,
    'Role authenticated TUYỆT ĐỐI KHÔNG ĐƯỢC có quyền USAGE trên schema app_private'
  );
  totalTestsRun++;
  console.log('✅ Test 12.1 PASS: Bức tường lửa schema app_private được giữ nguyên vẹn 100%.');

  console.log('⏳ Test 12.2: Học sinh (authenticated) cố tình gọi trực tiếp app_private.apply_student_rewards -> Bị chặn...');
  let exploitRewardsDenied = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${student1Id}', false);
      SELECT app_private.apply_student_rewards('${student1Id}', 9999, 9999);
      RESET ROLE;
    `);
  } catch (err) {
    exploitRewardsDenied = true;
    await db.exec(`RESET ROLE;`);
    assert(err.message.includes('permission denied for schema app_private') || err.message.includes('42501'));
  }
  assert.strictEqual(exploitRewardsDenied, true, 'Học sinh gọi trực tiếp apply_student_rewards phải bị từ chối truy cập schema');
  totalTestsRun++;
  console.log('✅ Test 12.2 PASS: Chặn đứng hoàn toàn việc học sinh gọi trực tiếp app_private.apply_student_rewards.');

  console.log('⏳ Test 12.3: Xác nhận số sao và xu của học sinh không bị thay đổi sau nỗ lực tấn công...');
  const studentBalanceCheck = await db.query(`
    SELECT total_stars, total_coins FROM public.profiles WHERE id = '${student1Id}';
  `);
  assert.strictEqual(studentBalanceCheck.rows[0].total_stars, 0, 'total_stars phải giữ nguyên bằng 0');
  assert.strictEqual(studentBalanceCheck.rows[0].total_coins, 0, 'total_coins phải giữ nguyên bằng 0');
  totalTestsRun++;
  console.log('✅ Test 12.3 PASS: Số dư sao và xu của học sinh hoàn toàn được bảo vệ toàn vẹn.');

  console.log('⏳ Test 12.4: Role anon (chưa đăng nhập) cố tình gọi hàm trong notifications_private -> Bị chặn...');
  let anonPrivateSchemaDenied = false;
  try {
    await db.exec(`
      SET ROLE anon;
      SELECT set_config('request.jwt.claim.sub', '', false);
      SELECT notifications_private.fn_notifications_is_admin();
      RESET ROLE;
    `);
  } catch (err) {
    anonPrivateSchemaDenied = true;
    await db.exec(`RESET ROLE;`);
    assert(err.message.includes('permission denied for schema notifications_private') || err.message.includes('42501'));
  }
  assert.strictEqual(anonPrivateSchemaDenied, true, 'Role anon không có USAGE trên notifications_private');
  totalTestsRun++;
  console.log('✅ Test 12.4 PASS: Role anon bị chặn hoàn toàn khỏi schema notifications_private.');

  console.log(`\n======================================================================`);
  console.log(`✅ TẤT CẢ ${totalTestsRun}/${totalTestsRun} TEST CASES PRE-STAGING GATE ĐÃ CHẠY VÀ VƯỢT QUA 100%`);
  console.log(`======================================================================\n`);
}

runNotificationsSecurityTestSuite().catch((err) => {
  console.error('\n❌ PRE-STAGING GATE TEST FAILED:\n', err);
  process.exit(1);
});
