import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

export async function runPgLiteValidation() {
  console.log('=============================================================================');
  console.log('BẮT ĐẦU KIỂM THỬ RUNTIME POSTGRESQL ENGINE THỰC TẾ (PGLITE ENGINE)');
  console.log('MỤC TIÊU: ĐỐI SOÁT TOÀN DIỆN MIGRATION ĐỢT A - INDIVIDUAL NOTIFICATIONS R1');
  console.log('=============================================================================\n');

  const baseMigrationPath = path.join(process.cwd(), 'supabase', 'migrations', '20261023210000_notifications_v1_schema_and_security.sql');
  const individualMigrationPath = path.join(process.cwd(), 'supabase', 'migrations', '20261028000001_notifications_v1_individual_recipients.sql');

  const baseMigrationSql = fs.readFileSync(baseMigrationPath, 'utf8');
  const individualMigrationSql = fs.readFileSync(individualMigrationPath, 'utf8');

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
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.class_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(class_id, student_id)
      );

      REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;
      GRANT USAGE ON SCHEMA app_private TO service_role;

      GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
      GRANT ALL ON ALL FUNCTIONS IN SCHEMA public, auth TO anon, authenticated, service_role;
    `);
  }

  const db = new PGlite();
  await setupBaseSchema(db);

  console.log('1. Nạp Migration nền Notifications V1...');
  await db.exec(baseMigrationSql);
  console.log('   => Migration nền hoàn tất.');

  console.log('2. Nạp Migration Đợt A - Individual Notifications (R1 Correction)...');
  await db.exec(individualMigrationSql);
  console.log('   => Migration Đợt A nạp thành công trên PostgreSQL engine.\n');

  // Helper set JWT context
  async function asUser(userId, callback) {
    if (userId) {
      await db.exec(`
        SET ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${userId}', false);
      `);
    } else {
      await db.exec(`
        RESET ROLE;
        SELECT set_config('request.jwt.claim.sub', '', false);
      `);
    }
    try {
      return await callback();
    } finally {
      await db.exec(`
        RESET ROLE;
        SELECT set_config('request.jwt.claim.sub', '', false);
      `);
    }
  }

  // -------------------------------------------------------------------------
  // TEST SUITE 1: ĐỐI SOÁT CATALOG (pg_trigger, pg_proc, information_schema)
  // -------------------------------------------------------------------------
  console.log('-----------------------------------------------------------------------------');
  console.log('TEST SUITE 1: ĐỐI SOÁT CATALOG VÀ SCHEMA');
  console.log('-----------------------------------------------------------------------------');

  // 1.1 Kiểm tra trigger gắn đúng function trong schema public
  const triggerRows = (await db.query(`
    SELECT
      t.tgname AS trigger_name,
      c.relname AS table_name,
      n.nspname AS proc_schema,
      p.proname AS proc_name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE c.relname = 'notifications' AND NOT t.tgisinternal
    ORDER BY t.tgname;
  `)).rows;

  console.log('1.1 Kết quả kiểm tra pg_trigger trên bảng public.notifications:');
  for (const trg of triggerRows) {
    console.log(`    - Trigger: ${trg.trigger_name} => Function: ${trg.proc_schema}.${trg.proc_name}()`);
  }

  const beforeInsertTrg = triggerRows.find(r => r.trigger_name === 'trg_notifications_before_insert');
  const protectLifecycleTrg = triggerRows.find(r => r.trigger_name === 'trg_notifications_protect_lifecycle');
  const afterSaveTrg = triggerRows.find(r => r.trigger_name === 'trg_notifications_after_save');

  assert.ok(beforeInsertTrg, 'Trigger trg_notifications_before_insert phải tồn tại');
  assert.equal(beforeInsertTrg.proc_schema, 'public', 'Trigger trg_notifications_before_insert PHẢI gọi function trong schema public');
  assert.equal(beforeInsertTrg.proc_name, 'fn_notifications_before_insert');

  assert.ok(protectLifecycleTrg, 'Trigger trg_notifications_protect_lifecycle phải tồn tại');
  assert.equal(protectLifecycleTrg.proc_schema, 'public', 'Trigger trg_notifications_protect_lifecycle PHẢI gọi function trong schema public');
  assert.equal(protectLifecycleTrg.proc_name, 'fn_notifications_protect_lifecycle');

  assert.ok(afterSaveTrg, 'Trigger trg_notifications_after_save phải tồn tại');
  assert.equal(afterSaveTrg.proc_schema, 'public', 'Trigger trg_notifications_after_save PHẢI gọi function trong schema public');
  assert.equal(afterSaveTrg.proc_name, 'fn_notifications_after_save');
  console.log('    => PASS: 100% trigger gắn đúng function trong schema public!\n');

  // 1.2 Kiểm tra information_schema.columns
  const notifColumns = (await db.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND column_name IN ('target_student_id', 'target_student_name_snapshot')
    ORDER BY column_name;
  `)).rows;

  console.log('1.2 Cột mới trong public.notifications:');
  for (const col of notifColumns) {
    console.log(`    - Cột: ${col.column_name} (${col.data_type}, nullable: ${col.is_nullable})`);
  }
  assert.equal(notifColumns.length, 2, 'Phải có đủ 2 cột target_student_id và target_student_name_snapshot');

  const recipientColumns = (await db.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notification_recipients'
    ORDER BY column_name;
  `)).rows;

  console.log('1.3 Cột trong public.notification_recipients:');
  for (const col of recipientColumns) {
    console.log(`    - Cột: ${col.column_name} (${col.data_type})`);
  }
  const hasRecipientId = recipientColumns.some(c => c.column_name === 'recipient_id');
  const hasUserId = recipientColumns.some(c => c.column_name === 'user_id');
  assert.ok(hasRecipientId, 'Bảng notification_recipients PHẢI dùng cột recipient_id');
  assert.ok(!hasUserId, 'Bảng notification_recipients KHÔNG ĐƯỢC dùng cột user_id');
  console.log('    => PASS: Schema cột chuẩn xác 100%!!\n');

  // -------------------------------------------------------------------------
  // KHỞI TẠO DỮ LIỆU THỬ NGHIỆM
  // -------------------------------------------------------------------------
  const adminId = '11111111-1111-1111-1111-111111111111';
  const teacher1Id = '22222222-2222-2222-2222-222222222221'; // Phụ trách Lớp 1A
  const teacher2Id = '22222222-2222-2222-2222-222222222222'; // Phụ trách Lớp 2A
  const student1Id = '33333333-3333-3333-3333-333333333331'; // Học sinh Lớp 1A
  const student2Id = '33333333-3333-3333-3333-333333333332'; // Học sinh Lớp 2A
  const disabledStudentId = '33333333-3333-3333-3333-333333333333'; // Học sinh bị khóa

  const class1AId = '44444444-4444-4444-4444-444444444441';
  const class2AId = '44444444-4444-4444-4444-444444444442';

  await db.exec(`
    INSERT INTO public.profiles (id, email, full_name, role, student_code, grade_level, is_disabled) VALUES
      ('${adminId}', 'admin@school.edu.vn', 'Quản Trị Viên', 'admin', NULL, NULL, FALSE),
      ('${teacher1Id}', 'teacher1@school.edu.vn', 'Thầy Nguyễn Văn A', 'teacher', NULL, 1, FALSE),
      ('${teacher2Id}', 'teacher2@school.edu.vn', 'Cô Trần Thị B', 'teacher', NULL, 2, FALSE),
      ('${student1Id}', 'student1@school.edu.vn', 'Em Lê Học Sinh 1A', 'student', 'HS1001', 1, FALSE),
      ('${student2Id}', 'student2@school.edu.vn', 'Em Phạm Học Sinh 2A', 'student', 'HS2001', 2, FALSE),
      ('${disabledStudentId}', 'disabled@school.edu.vn', 'Em Học Sinh Bị Khóa', 'student', 'HS9999', 1, TRUE)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.classes (id, name, code, grade_level, teacher_id) VALUES
      ('${class1AId}', 'Lớp 1A', 'LOP1A', 1, '${teacher1Id}'),
      ('${class2AId}', 'Lớp 2A', 'LOP2A', 2, '${teacher2Id}')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.class_members (class_id, student_id, is_active) VALUES
      ('${class1AId}', '${student1Id}', TRUE),
      ('${class2AId}', '${student2Id}', TRUE)
    ON CONFLICT (class_id, student_id) DO NOTHING;
  `);

  console.log('✅ Đã khởi tạo fixture dữ liệu test: 1 Admin, 2 Giáo viên, 3 Học sinh, 2 Lớp học.\n');

  // -------------------------------------------------------------------------
  // TEST SUITE 2: TẠO VÀ XUẤT BẢN THÔNG BÁO RIÊNG (INDIVIDUAL NOTIFICATIONS)
  // -------------------------------------------------------------------------
  console.log('-----------------------------------------------------------------------------');
  console.log('TEST SUITE 2: KIỂM THỬ TẠO DRAFT VÀ XUẤT BẢN THÔNG BÁO RIÊNG');
  console.log('-----------------------------------------------------------------------------');

  // 2.1 Giáo viên 1 tạo draft cho học sinh lớp mình (student1Id) với category 'exercise'
  let notif1Id;
  await asUser(teacher1Id, async () => {
    const res = await db.query(`
      SELECT public.rpc_create_individual_notification(
        p_title := 'Nhắc nhở học tập riêng',
        p_content := 'Em cần hoàn thành bài tập toán hôm nay.',
        p_target_student_id := '${student1Id}',
        p_priority := 'high',
        p_category := 'exercise',
        p_publish_now := FALSE
      ) AS res;
    `);
    const data = res.rows[0].res;
    notif1Id = data.notification_id;
    assert.equal(data.is_published, false, 'Phải tạo ở trạng thái draft');
    console.log('2.1 Teacher 1 tạo draft thành công cho học sinh lớp 1A:', notif1Id);
  });

  // Kiểm tra thông tin trong public.notifications
  const notif1Row = (await db.query(`SELECT * FROM public.notifications WHERE id = '${notif1Id}'`)).rows[0];
  assert.equal(notif1Row.sender_id, teacher1Id);
  assert.equal(notif1Row.sender_name_snapshot, 'Thầy Nguyễn Văn A');
  assert.equal(notif1Row.target_student_id, student1Id);
  assert.equal(notif1Row.target_student_name_snapshot, 'Em Lê Học Sinh 1A');
  assert.equal(notif1Row.is_published, false);
  console.log('    => Snapshot người gửi và người nhận được chụp chính xác khi tạo nháp!');

  // Kiểm tra bảng notification_recipients chưa có bản ghi khi draft
  const rec1Count = (await db.query(`SELECT count(*) AS c FROM public.notification_recipients WHERE notification_id = '${notif1Id}'`)).rows[0].c;
  assert.equal(Number(rec1Count), 0, 'Chưa được có recipient khi còn là draft');

  // 2.2 Teacher 1 cố tạo draft cho học sinh lớp khác (student2Id thuộc lớp 2A) => FAIL-CLOSED
  await asUser(teacher1Id, async () => {
    let errCaught = false;
    try {
      await db.query(`
        SELECT public.rpc_create_individual_notification(
          p_title := 'Lỗi bảo mật',
          p_content := 'Cố tình gửi cho học sinh lớp khác',
          p_target_student_id := '${student2Id}',
          p_priority := 'normal',
          p_category := 'general',
          p_publish_now := FALSE
        );
      `);
    } catch (err) {
      errCaught = true;
      assert.match(err.message, /FORBIDDEN_STUDENT_NOT_IN_TEACHER_CLASSES/);
      console.log('2.2 Teacher 1 tạo cho học sinh lớp 2A bị chặn chính xác:', err.message);
    }
    assert.ok(errCaught, 'Teacher 1 không được phép gửi cho học sinh lớp 2A');
  });

  // 2.3 Teacher 1 cố tạo thông báo cho học sinh bị vô hiệu hóa => FAIL-CLOSED
  await asUser(teacher1Id, async () => {
    let errCaught = false;
    try {
      await db.query(`
        SELECT public.rpc_create_individual_notification(
          p_title := 'Lỗi tài khoản',
          p_content := 'Gửi cho học sinh disabled',
          p_target_student_id := '${disabledStudentId}',
          p_priority := 'normal',
          p_category := 'general',
          p_publish_now := FALSE
        );
      `);
    } catch (err) {
      errCaught = true;
      assert.match(err.message, /FORBIDDEN_STUDENT_DISABLED/);
      console.log('2.3 Gửi cho học sinh bị khóa bị chặn chính xác:', err.message);
    }
    assert.ok(errCaught, 'Không được phép gửi cho học sinh bị khóa');
  });

  // 2.4 Admin tạo draft cho bất kỳ học sinh nào (student2Id) => THÀNH CÔNG
  let adminNotifId;
  await asUser(adminId, async () => {
    const res = await db.query(`
      SELECT public.rpc_create_individual_notification(
        p_title := 'Thông báo học bổng',
        p_content := 'Chúc mừng em nhận học bổng nhà trường.',
        p_target_student_id := '${student2Id}',
        p_priority := 'urgent',
        p_category := 'general',
        p_publish_now := FALSE
      ) AS res;
    `);
    adminNotifId = res.rows[0].res.notification_id;
    console.log('2.4 Admin tạo draft thành công cho học sinh lớp 2A:', adminNotifId);
  });

  // 2.5 Teacher 1 xuất bản thông báo riêng nháp (notif1Id)
  await asUser(teacher1Id, async () => {
    await db.query(`
      SELECT public.rpc_publish_notification('${notif1Id}');
    `);
    console.log('2.5 Teacher 1 xuất bản thông báo nháp thành công!');
  });

  // Kiểm tra bảng notification_recipients sau khi xuất bản
  const pubRecipients = (await db.query(`
    SELECT * FROM public.notification_recipients WHERE notification_id = '${notif1Id}'
  `)).rows;
  assert.equal(pubRecipients.length, 1, 'Phải có ĐÚNG 1 bản ghi trong notification_recipients');
  assert.equal(pubRecipients[0].recipient_id, student1Id, 'recipient_id phải khớp chính xác target_student_id');
  console.log(`    => ĐÚNG 1 recipient: recipient_id = ${pubRecipients[0].recipient_id}`);

  // Kiểm tra bảng notification_classes KHÔNG được có bản ghi nào
  const notifClassCount = (await db.query(`
    SELECT count(*) AS c FROM public.notification_classes WHERE notification_id = '${notif1Id}'
  `)).rows[0].c;
  assert.equal(Number(notifClassCount), 0, 'Thông báo individual không được có bản ghi trong notification_classes');
  console.log('    => PASS: notification_classes rỗng đối với thông báo individual!\n');

  // 2.6 Kiểm tra tạo với p_publish_now = TRUE (Hai bước: INSERT draft -> UPDATE published)
  let instantNotifId;
  await asUser(teacher1Id, async () => {
    const res = await db.query(`
      SELECT public.rpc_create_individual_notification(
        p_title := 'Thông báo hỏa tốc riêng',
        p_content := 'Gửi trực tiếp với p_publish_now = true.',
        p_target_student_id := '${student1Id}',
        p_priority := 'urgent',
        p_category := 'exercise',
        p_publish_now := TRUE
      ) AS res;
    `);
    instantNotifId = res.rows[0].res.notification_id;
    assert.equal(res.rows[0].res.is_published, true);
    console.log('2.6 Tạo thông báo riêng với p_publish_now = TRUE thành công:', instantNotifId);
  });

  const instantRecipients = (await db.query(`
    SELECT * FROM public.notification_recipients WHERE notification_id = '${instantNotifId}'
  `)).rows;
  assert.equal(instantRecipients.length, 1, 'Thông báo gửi ngay phải có đúng 1 recipient');
  assert.equal(instantRecipients[0].recipient_id, student1Id);
  console.log('    => PASS: Cơ chế INSERT draft -> UPDATE publish hoạt động hoàn hảo, không vi phạm FORBIDDEN_DIRECT_PUBLISH!\n');

  // -------------------------------------------------------------------------
  // TEST SUITE 3: DUAL-GATE VALIDATION & TRANSACTION LOCK
  // -------------------------------------------------------------------------
  console.log('-----------------------------------------------------------------------------');
  console.log('TEST SUITE 3: KIỂM THỬ DUAL-GATE VALIDATION KHI HỌC SINH ĐỔI LỚP / BỊ KHÓA');
  console.log('-----------------------------------------------------------------------------');

  // 3.1 Tạo bản nháp khi học sinh còn ở lớp 1A
  let draftToFailId;
  await asUser(teacher1Id, async () => {
    const res = await db.query(`
      SELECT public.rpc_create_individual_notification(
        p_title := 'Thông báo kiểm tra điều kiện publish',
        p_content := 'Nội dung nháp...',
        p_target_student_id := '${student1Id}',
        p_priority := 'normal',
        p_category := 'general',
        p_publish_now := FALSE
      ) AS res;
    `);
    draftToFailId = res.rows[0].res.notification_id;
    console.log('3.1 Teacher 1 tạo nháp thành công cho S1:', draftToFailId);
  });

  // Giả lập học sinh chuyển khỏi lớp 1A (is_active = FALSE)
  await db.exec(`
    UPDATE public.class_members
    SET is_active = FALSE
    WHERE class_id = '${class1AId}' AND student_id = '${student1Id}';
  `);
  console.log('    [Biến cố]: Học sinh S1 chuyển lớp (is_active = FALSE).');

  // Teacher 1 cố xuất bản bản nháp này => Phải bị chặn tại Gate 2 (FOR SHARE lock & validation)
  await asUser(teacher1Id, async () => {
    let errCaught = false;
    try {
      await db.query(`SELECT public.rpc_publish_notification('${draftToFailId}');`);
    } catch (err) {
      errCaught = true;
      assert.match(err.message, /FORBIDDEN_STUDENT_NOT_IN_TEACHER_CLASSES/);
      console.log('3.2 Xuất bản bị chặn an toàn khi học sinh đã chuyển lớp:', err.message);
    }
    assert.ok(errCaught, 'Gate 2 phải chặn xuất bản khi học sinh không còn trong lớp của giáo viên');
  });

  // Khôi phục lại trạng thái học sinh trong lớp 1A
  await db.exec(`
    UPDATE public.class_members
    SET is_active = TRUE
    WHERE class_id = '${class1AId}' AND student_id = '${student1Id}';
  `);
  console.log('    [Khôi phục]: Học sinh S1 trở lại lớp 1A.');

  // Bây giờ Teacher 1 xuất bản lại => Thành công
  await asUser(teacher1Id, async () => {
    await db.query(`SELECT public.rpc_publish_notification('${draftToFailId}');`);
    console.log('3.3 Xuất bản lại thành công sau khi học sinh hợp lệ.');
  });
  console.log('    => PASS: Dual-Gate thẩm định chính xác tại cả 2 thời điểm!\n');

  // -------------------------------------------------------------------------
  // TEST SUITE 4: VÒNG ĐỜI XÓA HỌC SINH (ACCOUNT DELETION & SNAPSHOT INTEGRITY)
  // -------------------------------------------------------------------------
  console.log('-----------------------------------------------------------------------------');
  console.log('TEST SUITE 4: KIỂM THỬ XÓA TÀI KHOẢN HỌC SINH (ACCOUNT DELETION)');
  console.log('-----------------------------------------------------------------------------');

  // Tạo một học sinh chuyên dùng để kiểm thử xóa
  const deleteTestStudentId = '77777777-7777-7777-7777-777777777777';
  await db.exec(`
    INSERT INTO public.profiles (id, email, full_name, role, student_code, grade_level, is_disabled) VALUES
      ('${deleteTestStudentId}', 'delstudent@school.edu.vn', 'Em Trần Thử Xóa', 'student', 'HS7777', 1, FALSE);

    INSERT INTO public.class_members (class_id, student_id, is_active) VALUES
      ('${class1AId}', '${deleteTestStudentId}', TRUE);
  `);

  // Tạo 1 thông báo ĐÃ XUẤT BẢN cho học sinh này
  let pubToDeleteNotifId;
  await asUser(teacher1Id, async () => {
    const res = await db.query(`
      SELECT public.rpc_create_individual_notification(
        p_title := 'Thông báo đã phát hành cho học sinh sắp xóa',
        p_content := 'Nội dung lưu hồ sơ kiểm toán.',
        p_target_student_id := '${deleteTestStudentId}',
        p_priority := 'normal',
        p_category := 'exercise',
        p_publish_now := TRUE
      ) AS res;
    `);
    pubToDeleteNotifId = res.rows[0].res.notification_id;
  });

  // Tạo 1 thông báo ĐÃ THU HỒI cho học sinh này
  let recalledToDeleteNotifId;
  await asUser(teacher1Id, async () => {
    const res = await db.query(`
      SELECT public.rpc_create_individual_notification(
        p_title := 'Thông báo đã thu hồi cho học sinh sắp xóa',
        p_content := 'Nội dung thu hồi.',
        p_target_student_id := '${deleteTestStudentId}',
        p_priority := 'normal',
        p_category := 'general',
        p_publish_now := TRUE
      ) AS res;
    `);
    recalledToDeleteNotifId = res.rows[0].res.notification_id;
    await db.query(`
      SELECT public.rpc_recall_notification('${recalledToDeleteNotifId}', 'Thu hồi do thử nghiệm');
    `);
  });

  // Tạo 1 thông báo DRAFT CHƯA XUẤT BẢN cho học sinh này
  let draftToDeleteNotifId;
  await asUser(teacher1Id, async () => {
    const res = await db.query(`
      SELECT public.rpc_create_individual_notification(
        p_title := 'Thông báo nháp cho học sinh sắp xóa',
        p_content := 'Nội dung nháp chưa gửi.',
        p_target_student_id := '${deleteTestStudentId}',
        p_priority := 'normal',
        p_category := 'general',
        p_publish_now := FALSE
      ) AS res;
    `);
    draftToDeleteNotifId = res.rows[0].res.notification_id;
  });

  console.log('4.1 Thực hiện lệnh xóa vĩnh viễn tài khoản học sinh (DELETE FROM public.profiles)...');
  await db.exec(`
    DELETE FROM public.profiles WHERE id = '${deleteTestStudentId}';
  `);
  console.log('    => Lệnh xóa profile thực thi thành công, không bị nghẽn hay lỗi trigger!');

  // Kiểm tra thông báo ĐÃ XUẤT BẢN:
  const pubAfterDel = (await db.query(`SELECT * FROM public.notifications WHERE id = '${pubToDeleteNotifId}'`)).rows[0];
  assert.equal(pubAfterDel.target_student_id, null, 'FK ON DELETE SET NULL phải gán target_student_id = NULL');
  assert.equal(pubAfterDel.target_student_name_snapshot, 'Em Trần Thử Xóa', 'target_student_name_snapshot phải bảo tồn nguyên vẹn');
  console.log('4.2 Thông báo đã phát hành: target_student_id = NULL, snapshot = "Em Trần Thử Xóa" (BẢO TOÀN KIỂM TOÁN)');

  // Kiểm tra bản ghi trong notification_recipients:
  const recAfterDelCount = (await db.query(`SELECT count(*) AS c FROM public.notification_recipients WHERE notification_id = '${pubToDeleteNotifId}'`)).rows[0].c;
  assert.equal(Number(recAfterDelCount), 0, 'Recipient cascade xóa khi profile học sinh bị xóa');
  console.log('4.3 Recipient được cascade xóa sạch sẽ theo profile.');

  // Kiểm tra thông báo ĐÃ THU HỒI:
  const recalledAfterDel = (await db.query(`SELECT * FROM public.notifications WHERE id = '${recalledToDeleteNotifId}'`)).rows[0];
  assert.equal(recalledAfterDel.target_student_id, null);
  assert.equal(recalledAfterDel.target_student_name_snapshot, 'Em Trần Thử Xóa');
  console.log('4.4 Thông báo đã thu hồi: target_student_id = NULL, snapshot bảo tồn nguyên vẹn.');

  // Kiểm tra thông báo DRAFT:
  const draftAfterDel = (await db.query(`SELECT * FROM public.notifications WHERE id = '${draftToDeleteNotifId}'`)).rows[0];
  assert.equal(draftAfterDel.target_student_id, null);
  // Nếu cố tình xuất bản bản nháp có học sinh đã bị xóa -> Phải bị chặn
  await asUser(teacher1Id, async () => {
    let errCaught = false;
    try {
      await db.query(`SELECT public.rpc_publish_notification('${draftToDeleteNotifId}');`);
    } catch (err) {
      errCaught = true;
      assert.match(err.message, /INVALID_TARGET/);
      console.log('4.5 Bản nháp có học sinh đã bị xóa không thể xuất bản (chặn chính xác):', err.message);
    }
    assert.ok(errCaught, 'Bản nháp mất target_student_id không được phép xuất bản');
  });
  console.log('    => PASS: Vòng đời xóa tài khoản thỏa mãn 100% các tiêu chí an toàn!\n');

  // -------------------------------------------------------------------------
  // TEST SUITE 5: KHÔNG HỒI QUY CÁC THÔNG BÁO CŨ (ALL, GRADE, CLASSES)
  // -------------------------------------------------------------------------
  console.log('-----------------------------------------------------------------------------');
  console.log('TEST SUITE 5: BẢO VỆ TƯƠNG THÍCH NGƯỢC - KHÔNG HỒI QUY ALL, GRADE, CLASSES');
  console.log('-----------------------------------------------------------------------------');

  // 5.1 Admin tạo và xuất bản thông báo ALL qua rpc_create_notification cũ
  let oldAllNotifId;
  await asUser(adminId, async () => {
    const res = await db.query(`
      SELECT public.rpc_create_notification(
        p_title := 'Thông báo toàn trường',
        p_content := 'Khai giảng năm học mới.',
        p_priority := 'urgent',
        p_category := 'general',
        p_target_type := 'all',
        p_target_grade_level := NULL,
        p_target_class_ids := '{}'::UUID[],
        p_publish_now := FALSE
      ) AS res;
    `);
    oldAllNotifId = res.rows[0].res;
    await db.query(`SELECT public.rpc_publish_notification('${oldAllNotifId}');`);
    console.log('5.1 Admin tạo và publish thông báo toàn trường (ALL) thành công:', oldAllNotifId);
  });

  const allRecipients = (await db.query(`
    SELECT count(*) AS c FROM public.notification_recipients WHERE notification_id = '${oldAllNotifId}'
  `)).rows[0].c;
  assert.ok(Number(allRecipients) >= 3, 'Thông báo all phải gửi đến các tài khoản active');
  console.log(`    => Số recipients nhận thông báo ALL: ${allRecipients}`);

  // 5.2 Admin tạo và xuất bản thông báo GRADE qua rpc_create_notification cũ
  let oldGradeNotifId;
  await asUser(adminId, async () => {
    const res = await db.query(`
      SELECT public.rpc_create_notification(
        p_title := 'Thông báo khối 1',
        p_content := 'Kiểm tra định kỳ khối 1.',
        p_priority := 'high',
        p_category := 'exercise',
        p_target_type := 'grade',
        p_target_grade_level := 1,
        p_target_class_ids := '{}'::UUID[],
        p_publish_now := FALSE
      ) AS res;
    `);
    oldGradeNotifId = res.rows[0].res;
    await db.query(`SELECT public.rpc_publish_notification('${oldGradeNotifId}');`);
    console.log('5.2 Admin tạo và publish thông báo khối 1 (GRADE) thành công:', oldGradeNotifId);
  });

  // 5.3 Teacher 1 tạo và xuất bản thông báo CLASSES cho lớp 1A qua rpc_create_notification cũ
  let oldClassNotifId;
  await asUser(teacher1Id, async () => {
    const res = await db.query(`
      SELECT public.rpc_create_notification(
        p_title := 'Thông báo lớp 1A',
        p_content := 'Lịch họp phụ huynh lớp 1A.',
        p_priority := 'normal',
        p_category := 'general',
        p_target_type := 'classes',
        p_target_grade_level := NULL,
        p_target_class_ids := ARRAY['${class1AId}'::UUID],
        p_publish_now := FALSE
      ) AS res;
    `);
    oldClassNotifId = res.rows[0].res;
    await db.query(`SELECT public.rpc_publish_notification('${oldClassNotifId}');`);
    console.log('5.3 Teacher 1 tạo và publish thông báo lớp 1A (CLASSES) thành công:', oldClassNotifId);
  });

  const classRecipients = (await db.query(`
    SELECT * FROM public.notification_recipients WHERE notification_id = '${oldClassNotifId}'
  `)).rows;
  assert.equal(classRecipients.length, 1);
  assert.equal(classRecipients[0].recipient_id, student1Id);
  console.log('    => PASS: Tương thích ngược 100% không hồi quy với all, grade, classes!\n');

  // -------------------------------------------------------------------------
  // TEST SUITE 6: RPC TÌM KIẾM HỌC SINH (RPC_SEARCH_STUDENTS_FOR_NOTIFICATION)
  // -------------------------------------------------------------------------
  console.log('-----------------------------------------------------------------------------');
  console.log('TEST SUITE 6: RPC TÌM KIẾM HỌC SINH MỤC TIÊU VÀ PHÂN QUYỀN TRUY VẤN');
  console.log('-----------------------------------------------------------------------------');

  // 6.1 Teacher 1 tìm kiếm học sinh
  await asUser(teacher1Id, async () => {
    const res = (await db.query(`
      SELECT * FROM public.rpc_search_students_for_notification('', 20, 0);
    `)).rows;
    console.log('6.1 Kết quả tìm kiếm của Teacher 1 (phụ trách Lớp 1A):');
    for (const s of res) {
      console.log(`    - Học sinh: ${s.full_name} (${s.student_code}) - Lớp: ${s.class_name}`);
    }
    assert.equal(res.length, 1, 'Teacher 1 chỉ được nhìn thấy học sinh lớp 1A');
    assert.equal(res[0].student_id, student1Id);
    assert.equal(res[0].student_code, 'HS1001');
    assert.equal(res[0].class_name, 'Lớp 1A');
  });

  // 6.2 Admin tìm kiếm học sinh
  await asUser(adminId, async () => {
    const res = (await db.query(`
      SELECT * FROM public.rpc_search_students_for_notification('', 20, 0);
    `)).rows;
    console.log('6.2 Kết quả tìm kiếm của Admin (toàn trường):');
    for (const s of res) {
      console.log(`    - Học sinh: ${s.full_name} (${s.student_code}) - Lớp: ${s.class_name}`);
    }
    assert.equal(res.length, 2, 'Admin nhìn thấy cả 2 học sinh active (S1 và S2)');
  });

  // 6.3 Tìm kiếm theo mã học sinh 'HS2001'
  await asUser(adminId, async () => {
    const res = (await db.query(`
      SELECT * FROM public.rpc_search_students_for_notification('HS2001', 20, 0);
    `)).rows;
    assert.equal(res.length, 1);
    assert.equal(res[0].student_code, 'HS2001');
    console.log('6.3 Tìm kiếm theo mã student_code thành công:', res[0].student_code);
  });

  // 6.4 Học sinh hoặc người dùng không có quyền gọi search => FAIL-CLOSED
  await asUser(student1Id, async () => {
    let errCaught = false;
    try {
      await db.query(`SELECT * FROM public.rpc_search_students_for_notification('', 20, 0);`);
    } catch (err) {
      errCaught = true;
      assert.match(err.message, /FORBIDDEN_ROLE/);
      console.log('6.4 Học sinh gọi search bị chặn chính xác:', err.message);
    }
    assert.ok(errCaught, 'Học sinh không được gọi rpc_search_students_for_notification');
  });
  console.log('    => PASS: RPC search học sinh bảo mật đa tầng, phân quyền chặt chẽ!\n');

  // -------------------------------------------------------------------------
  // TEST SUITE 7: CHỐNG GIẢ MẠO VÀ CHỐNG TRỰC TIẾP INSERT/UPDATE SAI TRÁI
  // -------------------------------------------------------------------------
  console.log('-----------------------------------------------------------------------------');
  console.log('TEST SUITE 7: CHỐNG SENDER IMPERSONATION & CHỐNG DIRECT PUBLISH BYPASS');
  console.log('-----------------------------------------------------------------------------');

  // 7.1 Cố tình INSERT trực tiếp với is_published = TRUE
  await asUser(teacher1Id, async () => {
    let errCaught = false;
    try {
      await db.query(`
        INSERT INTO public.notifications (
          title, content, target_type, target_student_id, is_published
        ) VALUES (
          'Bypass Test', 'Direct publish', 'individual', '${student1Id}', TRUE
        );
      `);
    } catch (err) {
      errCaught = true;
      assert.match(err.message, /FORBIDDEN_DIRECT_PUBLISH/);
      console.log('7.1 Trực tiếp INSERT is_published = TRUE bị chặn:', err.message);
    }
    assert.ok(errCaught, 'Bắt buộc phải chặn trực tiếp INSERT is_published = TRUE');
  });

  // 7.2 Cố tình khai báo sender_id khác auth.uid() (Sender Impersonation)
  await asUser(teacher1Id, async () => {
    let errCaught = false;
    try {
      await db.query(`
        INSERT INTO public.notifications (
          title, content, target_type, target_student_id, sender_id, is_published
        ) VALUES (
          'Impersonation Test', 'Sender forgery', 'individual', '${student1Id}', '${adminId}', FALSE
        );
      `);
    } catch (err) {
      errCaught = true;
      assert.match(err.message, /FORBIDDEN_SENDER_IMPERSONATION/);
      console.log('7.2 Giả mạo sender_id bị chặn chính xác:', err.message);
    }
    assert.ok(errCaught, 'Bắt buộc phải chặn giả mạo sender_id');
  });

  // 7.3 Khi thông báo đã publish, cố tình UPDATE nội dung hoặc mục tiêu
  await asUser(teacher1Id, async () => {
    let errCaught = false;
    try {
      await db.query(`
        UPDATE public.notifications
        SET title = 'Tiêu đề đã sửa lén'
        WHERE id = '${notif1Id}';
      `);
    } catch (err) {
      errCaught = true;
      assert.match(err.message, /FORBIDDEN_MODIFICATION_PUBLISHED/);
      console.log('7.3 Sửa nội dung thông báo đã xuất bản bị chặn:', err.message);
    }
    assert.ok(errCaught, 'Không được sửa thông báo đã xuất bản');
  });

  // 7.4 Cố tình unpublish (is_published: TRUE -> FALSE)
  await asUser(teacher1Id, async () => {
    let errCaught = false;
    try {
      await db.query(`
        UPDATE public.notifications
        SET is_published = FALSE
        WHERE id = '${notif1Id}';
      `);
    } catch (err) {
      errCaught = true;
      assert.match(err.message, /FORBIDDEN_UNPUBLISH/);
      console.log('7.4 Unpublish bị chặn chính xác:', err.message);
    }
    assert.ok(errCaught, 'Không được unpublish thông báo');
  });

  console.log('    => PASS: Toàn bộ các cơ chế chống giả mạo và bảo vệ vòng đời đều fail-closed an toàn!\n');

  console.log('=============================================================================');
  console.log('KẾT LUẬN: 100% CÁC BÀI TEST RUNTIME TRÊN POSTGRESQL ENGINE THẬT ĐÃ VƯỢT QUA!');
  console.log('=============================================================================');
}

runPgLiteValidation().catch((err) => {
  console.error('\n❌ TEST RUNTIME THẤT BẠI:', err);
  process.exit(1);
});
