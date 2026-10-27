// tests/notification_individual_scope.test.mjs
// Bộ kiểm thử tự động Đợt A: Individual Notifications Scope & Client Contract Audit
// Kiểm tra hợp đồng API, bảo mật RPC, cấu trúc SQL migration, tính tương thích ngược và giao diện client

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('--- BẮT ĐẦU TEST NOTIFICATIONS V1 - ĐỢT A: INDIVIDUAL NOTIFICATIONS ---');

let passedTests = 0;
let totalTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
    process.exitCode = 1;
  }
}

async function runAll() {
  // =========================================================================
  // TEST SUITE 1: TÍNH TOÀN VẸN VÀ TƯƠNG THÍCH CỦA MIGRATION SQL ĐỢT A
  // =========================================================================
  const migrationPath = path.join(
    rootDir,
    'supabase',
    'migrations',
    '20261028000001_notifications_v1_individual_recipients.sql'
  );

  await runTest('1.1. Migration file Đợt A tồn tại và có kích thước hợp lệ', () => {
    assert.ok(fs.existsSync(migrationPath), 'File migration SQL Đợt A không tồn tại');
    const stat = fs.statSync(migrationPath);
    assert.ok(stat.size > 2000, `Kích thước migration quá nhỏ (${stat.size} bytes)`);
  });

  const migrationSql = fs.readFileSync(migrationPath, 'utf8');

  await runTest('1.2. Schema migration bổ sung cột target_student_id & target_student_name_snapshot', () => {
    assert.ok(
      migrationSql.includes('ADD COLUMN IF NOT EXISTS target_student_id UUID'),
      'Thiếu ADD COLUMN target_student_id'
    );
    assert.ok(
      migrationSql.includes('REFERENCES public.profiles(id) ON DELETE SET NULL'),
      'target_student_id phải có REFERENCES public.profiles(id) ON DELETE SET NULL'
    );
    assert.ok(
      migrationSql.includes('ADD COLUMN IF NOT EXISTS target_student_name_snapshot TEXT'),
      'Thiếu ADD COLUMN target_student_name_snapshot'
    );
  });

  await runTest('1.3. Cập nhật CHECK constraints cho phép individual target_type và ràng buộc mục tiêu', () => {
    assert.ok(
      migrationSql.includes("chk_notifications_target_type"),
      'Thiếu cập nhật constraint chk_notifications_target_type'
    );
    assert.ok(
      migrationSql.includes("'individual'"),
      "chk_notifications_target_type phải hỗ trợ giá trị 'individual'"
    );
    assert.ok(
      migrationSql.includes("chk_notifications_target_scope"),
      'Thiếu cập nhật constraint chk_notifications_target_scope'
    );
    // Kiểm tra nới lỏng an toàn khi xóa tài khoản học sinh đã publish
    assert.ok(
      migrationSql.includes("(is_published = TRUE AND target_student_id IS NULL)"),
      'chk_notifications_target_scope phải cho phép target_student_id IS NULL khi đã published (bảo toàn lịch sử khi xóa học sinh)'
    );
  });

  await runTest('1.4. Bảo vệ rủi ro Race Condition: FOR SHARE OF c, cm khi validate quyền Giáo viên', () => {
    assert.ok(
      migrationSql.includes('fn_notifications_validate_target_student'),
      'Thiếu hàm notifications_private.fn_notifications_validate_target_student'
    );
    assert.ok(
      migrationSql.includes('FOR SHARE OF c, cm'),
      'Thiếu khóa giao dịch FOR SHARE OF c, cm chống race condition khi học sinh chuyển lớp hoặc giáo viên bị đổi phân công lúc publish'
    );
  });

  await runTest('1.5. Bảo vệ 2 tầng quyền hạn (Dual-Gate): BEFORE INSERT và BEFORE UPDATE lúc Publish', () => {
    assert.ok(
      migrationSql.includes('fn_notifications_before_insert'),
      'Trigger BEFORE INSERT phải được cập nhật'
    );
    assert.ok(
      migrationSql.includes('fn_notifications_protect_lifecycle'),
      'Trigger BEFORE UPDATE lifecycle phải được cập nhật'
    );
    assert.ok(
      migrationSql.includes('OLD.is_published = FALSE AND NEW.is_published = TRUE'),
      'Trigger lifecycle phải kiểm tra validate target student khi chuyển từ nháp sang xuất bản'
    );
  });

  await runTest('1.6. Xử lý xóa học sinh (ON DELETE SET NULL) không bị trigger lifecycle chặn oan', () => {
    assert.ok(
      migrationSql.includes('OLD.target_student_id IS NOT NULL AND NEW.target_student_id IS NULL'),
      'Trigger lifecycle phải có nhánh ngoại lệ cho phép FK SET NULL khi profile học sinh bị xóa'
    );
    assert.ok(
      migrationSql.includes('EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.target_student_id)'),
      'Trigger lifecycle phải kiểm tra student profile thực sự không còn tồn tại trước khi cho phép SET NULL'
    );
  });

  await runTest('1.7. Snapshot người nhận Đợt A: Đúng 1 bản ghi recipient, không insert notification_classes', () => {
    assert.ok(
      migrationSql.includes("NEW.target_type = 'individual'"),
      'Trigger sau lưu phải có nhánh xử lý riêng cho individual'
    );
    assert.ok(
      migrationSql.includes('INSERT INTO public.notification_recipients'),
      'Phải insert vào notification_recipients'
    );
    assert.ok(
      migrationSql.includes('NEW.target_student_id'),
      'Recipient phải là NEW.target_student_id'
    );
  });

  await runTest('1.8. Bảo toàn nguyên vẹn RPC cũ rpc_create_notification (Zero Regression)', () => {
    assert.ok(
      !migrationSql.includes('DROP FUNCTION IF EXISTS public.rpc_create_notification'),
      'CẤM DROP rpc_create_notification cũ'
    );
    assert.ok(
      !migrationSql.includes('CREATE OR REPLACE FUNCTION public.rpc_create_notification('),
      'CẤM ghi đè rpc_create_notification cũ để tránh lỗi PostgREST Ambiguous overload'
    );
  });

  await runTest('1.9. RPC mới rpc_create_individual_notification có chữ ký và bảo mật chuẩn', () => {
    assert.ok(
      migrationSql.includes('FUNCTION public.rpc_create_individual_notification('),
      'Thiếu tạo mới hàm public.rpc_create_individual_notification'
    );
    assert.ok(
      migrationSql.includes('p_target_student_id UUID'),
      'rpc_create_individual_notification phải nhận p_target_student_id UUID'
    );
    assert.ok(
      migrationSql.includes('SECURITY DEFINER'),
      'rpc_create_individual_notification phải là SECURITY DEFINER'
    );
    assert.ok(
      migrationSql.includes('SET search_path = public, notifications_private, pg_temp'),
      'rpc_create_individual_notification phải có SET search_path an toàn'
    );
    assert.ok(
      migrationSql.includes('REVOKE ALL ON FUNCTION public.rpc_create_individual_notification'),
      'Phải siết quyền REVOKE ALL FROM PUBLIC trên rpc_create_individual_notification'
    );
    assert.ok(
      migrationSql.includes('GRANT EXECUTE ON FUNCTION public.rpc_create_individual_notification(TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN) TO authenticated'),
      'Phải GRANT EXECUTE cho authenticated'
    );
  });

  await runTest('1.10. RPC tìm kiếm học sinh rpc_search_students_for_notification có kiểm soát quyền từ backend', () => {
    assert.ok(
      migrationSql.includes('FUNCTION public.rpc_search_students_for_notification('),
      'Thiếu hàm public.rpc_search_students_for_notification'
    );
    assert.ok(
      migrationSql.includes("v_caller.user_role = 'teacher'"),
      'rpc_search_students_for_notification phải kiểm tra vai trò teacher'
    );
    assert.ok(
      migrationSql.includes('c.teacher_id = v_caller.user_id'),
      'Giáo viên chỉ được tìm thấy học sinh trong lớp mình quản lý'
    );
    assert.ok(
      migrationSql.includes("v_caller.user_role = 'admin'"),
      'Admin được tìm kiếm toàn trường'
    );
    assert.ok(
      migrationSql.includes('REVOKE ALL ON FUNCTION public.rpc_search_students_for_notification'),
      'Phải siết quyền REVOKE ALL FROM PUBLIC trên rpc_search_students_for_notification'
    );
  });

  // =========================================================================
  // TEST SUITE 2: CLIENT CONTRACT (src/services/notificationClient.js)
  // =========================================================================
  const client = await import('../src/services/notificationClient.js');

  await runTest('2.1. Client module export đầy đủ các hàm cũ và mới', () => {
    assert.equal(typeof client.createNotification, 'function', 'createNotification phải là function');
    assert.equal(typeof client.createIndividualNotification, 'function', 'createIndividualNotification phải là function');
    assert.equal(typeof client.searchStudentsForNotification, 'function', 'searchStudentsForNotification phải là function');
    assert.equal(typeof client.publishNotification, 'function', 'publishNotification phải là function');
    assert.equal(typeof client.recallNotification, 'function', 'recallNotification phải là function');
    assert.equal(typeof client.getSentNotifications, 'function', 'getSentNotifications phải là function');
  });

  await runTest('2.2. createIndividualNotification chặn tham số không hợp lệ (Fail-Closed)', async () => {
    // Thiếu tiêu đề
    const res1 = await client.createIndividualNotification({
      title: '',
      content: 'Nội dung',
      targetStudentId: '11111111-1111-1111-1111-111111111111'
    });
    assert.equal(res1.ok, false);
    assert.equal(res1.error.code, 'MISSING_TITLE_OR_CONTENT');

    // Thiếu nội dung
    const res2 = await client.createIndividualNotification({
      title: 'Tiêu đề',
      content: '',
      targetStudentId: '11111111-1111-1111-1111-111111111111'
    });
    assert.equal(res2.ok, false);
    assert.equal(res2.error.code, 'MISSING_TITLE_OR_CONTENT');

    // Thiếu targetStudentId
    const res3 = await client.createIndividualNotification({
      title: 'Tiêu đề',
      content: 'Nội dung',
      targetStudentId: ''
    });
    assert.equal(res3.ok, false);
    assert.equal(res3.error.code, 'INVALID_TARGET');

    // targetStudentId không phải UUID hợp lệ
    const res4 = await client.createIndividualNotification({
      title: 'Tiêu đề',
      content: 'Nội dung',
      targetStudentId: 'not-a-uuid'
    });
    assert.equal(res4.ok, false);
    assert.equal(res4.error.code, 'INVALID_TARGET');
  });

  await runTest('2.3. createIndividualNotification gọi đúng RPC rpc_create_individual_notification với payload chuẩn', async () => {
    let calledRpcName = null;
    let calledPayload = null;

    const mockClient = {
      rpc: async (fnName, params) => {
        calledRpcName = fnName;
        calledPayload = params;
        return { data: 'mock-notif-uuid-1234', error: null };
      }
    };

    const studentId = '22222222-2222-2222-2222-222222222222';
    const res = await client.createIndividualNotification(
      {
        title: 'Thông báo cá nhân kiểm thử',
        content: 'Nội dung thông báo gửi riêng học sinh',
        priority: 'high',
        category: 'exercise',
        targetStudentId: studentId,
        publishNow: false
      },
      mockClient
    );

    assert.equal(res.ok, true);
    assert.equal(res.data, 'mock-notif-uuid-1234');
    assert.equal(calledRpcName, 'rpc_create_individual_notification');
    assert.equal(calledPayload.p_title, 'Thông báo cá nhân kiểm thử');
    assert.equal(calledPayload.p_content, 'Nội dung thông báo gửi riêng học sinh');
    assert.equal(calledPayload.p_priority, 'high');
    assert.equal(calledPayload.p_category, 'exercise');
    assert.equal(calledPayload.p_target_student_id, studentId);
    assert.equal(calledPayload.p_publish_now, false);
  });

  await runTest('2.4. searchStudentsForNotification gọi đúng RPC v2 rpc_search_students_for_notification_v2 và chuẩn hóa id = student_id', async () => {
    let calledRpcName = null;
    let calledPayload = null;

    const mockClient = {
      rpc: async (fnName, params) => {
        calledRpcName = fnName;
        calledPayload = params;
        return {
          data: [
            {
              student_id: '33333333-3333-3333-3333-333333333333',
              full_name: 'Nguyễn Văn Em',
              student_code: 'HS001',
              class_name: 'Lớp 1A',
              grade_level: 1
            },
            {
              student_id: 'not-a-valid-uuid',
              full_name: 'Dữ liệu rác'
            }
          ],
          error: null
        };
      }
    };

    const res = await client.searchStudentsForNotification(
      {
        query: 'Nguyễn',
        gradeLevel: 1,
        classId: '44444444-4444-4444-4444-444444444444',
        limit: 5,
        offset: 0
      },
      mockClient
    );

    assert.equal(res.ok, true);
    assert.equal(res.data.length, 1, 'Phải lọc bỏ bản ghi không có UUID hợp lệ');
    assert.equal(res.data[0].student_code, 'HS001');
    assert.equal(res.data[0].student_id, '33333333-3333-3333-3333-333333333333');
    assert.equal(res.data[0].id, '33333333-3333-3333-3333-333333333333', 'Phải chuẩn hóa id = student_id');
    assert.equal(calledRpcName, 'rpc_search_students_for_notification_v2');
    assert.equal(calledPayload.p_search, 'Nguyễn');
    assert.equal(calledPayload.p_grade_level, 1);
    assert.equal(calledPayload.p_class_id, '44444444-4444-4444-4444-444444444444');
    assert.equal(calledPayload.p_limit, 5);
    assert.equal(calledPayload.p_offset, 0);
  });

  await runTest('2.5. searchStudentsForNotification không nuốt lỗi PostgREST và trả về fail-closed', async () => {
    const mockPostgrestErrorClient = {
      rpc: async () => ({
        data: null,
        error: {
          code: 'PGRST202',
          message: 'Could not find the function public.rpc_search_students_for_notification_v2 in the schema cache',
          details: 'Searched for function...',
          hint: 'Perhaps you meant...'
        }
      })
    };

    const res = await client.searchStudentsForNotification({ query: 'Test' }, mockPostgrestErrorClient);
    assert.equal(res.ok, false);
    assert.ok(res.error);
    assert.ok(res.error.message.includes('PGRST202') || res.error.message.includes('Could not find') || res.error.message.length > 0);
  });

  // =========================================================================
  // TEST SUITE 3: KIỂM TRA TÍNH TOÀN VẸN CỦA FRONTEND COMPONENTS
  // =========================================================================
  await runTest('3.1. CreateNotificationModal.jsx hỗ trợ chế độ individual', () => {
    const teacherModalContent = fs.readFileSync(
      path.join(rootDir, 'src', 'components', 'dashboard', 'notifications', 'CreateNotificationModal.jsx'),
      'utf8'
    );
    assert.ok(teacherModalContent.includes("targetMode === 'individual'"), 'CreateNotificationModal phải có state targetMode individual');
    assert.ok(teacherModalContent.includes('createIndividualNotification'), 'CreateNotificationModal phải gọi createIndividualNotification');
    assert.ok(teacherModalContent.includes('searchStudentsForNotification'), 'CreateNotificationModal phải gọi searchStudentsForNotification');
    assert.ok(teacherModalContent.includes('Đổi học sinh'), 'CreateNotificationModal phải có nút Đổi học sinh');
  });

  await runTest('3.2. AdminCreateNotificationModal.jsx hỗ trợ tab phạm vi individual', () => {
    const adminModalContent = fs.readFileSync(
      path.join(rootDir, 'src', 'components', 'dashboard', 'notifications', 'AdminCreateNotificationModal.jsx'),
      'utf8'
    );
    assert.ok(adminModalContent.includes("targetType === 'individual'"), 'AdminCreateNotificationModal phải có tab individual');
    assert.ok(adminModalContent.includes('createIndividualNotification'), 'AdminCreateNotificationModal phải gọi createIndividualNotification');
    assert.ok(adminModalContent.includes('searchStudentsForNotification'), 'AdminCreateNotificationModal phải gọi searchStudentsForNotification');
    assert.ok(adminModalContent.includes('Cá nhân HS'), 'AdminCreateNotificationModal phải có nhãn nút Cá nhân HS');
  });

  await runTest('3.3. NotificationManagementTab & AdminNotificationManagementTab hiển thị đúng nhãn individual', () => {
    const teacherTab = fs.readFileSync(
      path.join(rootDir, 'src', 'components', 'dashboard', 'notifications', 'NotificationManagementTab.jsx'),
      'utf8'
    );
    const adminTab = fs.readFileSync(
      path.join(rootDir, 'src', 'components', 'dashboard', 'notifications', 'AdminNotificationManagementTab.jsx'),
      'utf8'
    );
    assert.ok(teacherTab.includes("item.target_type === 'individual'"), 'NotificationManagementTab phải render label cho individual');
    assert.ok(adminTab.includes("item.target_type === 'individual'"), 'AdminNotificationManagementTab phải render label cho individual');
  });

  await runTest('3.4. PublishNotificationModal & AdminPublishNotificationModal không chặn oan thông báo individual', () => {
    const teacherPublish = fs.readFileSync(
      path.join(rootDir, 'src', 'components', 'dashboard', 'notifications', 'PublishNotificationModal.jsx'),
      'utf8'
    );
    const adminPublish = fs.readFileSync(
      path.join(rootDir, 'src', 'components', 'dashboard', 'notifications', 'AdminPublishNotificationModal.jsx'),
      'utf8'
    );
    assert.ok(teacherPublish.includes("draft.target_type === 'individual'"), 'PublishNotificationModal phải kiểm tra isIndividual');
    assert.ok(adminPublish.includes("targetType === 'individual'"), 'AdminPublishNotificationModal phải hiển thị card cho individual');
  });

  await runTest('3.5. PublishNotificationModal hiển thị câu cảnh báo tương ứng với target_type (individual vs classes)', () => {
    const teacherPublish = fs.readFileSync(
      path.join(rootDir, 'src', 'components', 'dashboard', 'notifications', 'PublishNotificationModal.jsx'),
      'utf8'
    );
    assert.ok(
      teacherPublish.includes('Sau khi xuất bản, chỉ học sinh đã chọn sẽ nhận được thông báo này.'),
      'PublishNotificationModal phải có câu cảnh báo cho individual: Sau khi xuất bản, chỉ học sinh đã chọn sẽ nhận được thông báo này.'
    );
    assert.ok(
      teacherPublish.includes('Sau khi xuất bản, toàn bộ học sinh trong các lớp trên sẽ nhận được thông báo ngay lập tức.'),
      'PublishNotificationModal phải giữ câu cảnh báo cho classes: Sau khi xuất bản, toàn bộ học sinh trong các lớp trên sẽ nhận được thông báo ngay lập tức.'
    );
  });

  console.log('--------------------------------------------------------------------');
  console.log(`KẾT QUẢ KIỂM THỬ ĐỢT A: ${passedTests}/${totalTests} TESTS PASS`);
  if (passedTests === totalTests) {
    console.log('>>> TOÀN BỘ KIỂM THỬ LOCAL ĐỢT A HOÀN TOÀN THÀNH CÔNG! <<<');
  } else {
    console.error('>>> CÓ TEST KHÔNG ĐẠT YÊU CẦU! <<<');
    process.exit(1);
  }
}

await runAll();
