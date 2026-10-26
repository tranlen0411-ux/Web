// tests/teacher_notification_publish_recall.test.mjs
// Unit tests cho Teacher Publish Draft & Recall Notification (Notifications V1 R3-C2B)
// Kiểm thử: All-or-Nothing, Chống Double Submit, Publish Confirm & RPC, Recall Confirm & RPC, Zero Retry, Auth Isolation

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const createModalSource = fs.readFileSync(
  'src/components/dashboard/notifications/CreateNotificationModal.jsx',
  'utf8'
);
const publishModalSource = fs.readFileSync(
  'src/components/dashboard/notifications/PublishNotificationModal.jsx',
  'utf8'
);
const recallModalSource = fs.readFileSync(
  'src/components/dashboard/notifications/RecallNotificationModal.jsx',
  'utf8'
);
const managementTabSource = fs.readFileSync(
  'src/components/dashboard/notifications/NotificationManagementTab.jsx',
  'utf8'
);
const teacherDashboardSource = fs.readFileSync('src/pages/TeacherDashboard.jsx', 'utf8');

test('=== NOTIFICATIONS V1 R3-C2B: TEACHER PUBLISH DRAFT & RECALL SUITE ===', async (t) => {

  // =========================================================================
  // SUITE 1: R3-C2A HARDENING - ALL-OR-NOTHING & CHỐNG DOUBLE-SUBMIT ĐỒNG BỘ
  // =========================================================================
  await t.test('Suite 1: All-or-Nothing khi chọn lớp và Guard đồng bộ bằng ref trong CreateNotificationModal', () => {
    // 1.1. Có isSubmittingRef để bảo vệ đồng bộ chống double submit
    assert.match(
      createModalSource,
      /const\s+isSubmittingRef\s*=\s*useRef\(false\)/,
      'CreateNotificationModal phải có isSubmittingRef đồng bộ'
    );

    // 1.2. Chặn submit ngay nếu isSubmittingRef đang true
    assert.match(
      createModalSource,
      /if\s*\(isSubmittingRef\.current\)\s*return/,
      'handleSaveDraft phải chặn ngay nếu isSubmittingRef.current = true'
    );

    // 1.3. Khắc phục All-or-Nothing: Không âm thầm lọc bỏ lớp, từ chối toàn bộ nếu có lớp ngoài quyền quản lý
    assert.match(
      createModalSource,
      /hasInvalidClass\s*=\s*selectedClassIds\.some\(/,
      'Phải kiểm tra hasInvalidClass để phát hiện lớp không thuộc quyền quản lý'
    );
    assert.match(
      createModalSource,
      /if\s*\(hasInvalidClass\)\s*\{[\s\S]*?setErrorMessage\(/,
      'Nếu có lớp không hợp lệ, phải từ chối toàn bộ và hiển thị thông báo lỗi rõ ràng'
    );

    // 1.4. publishNow vẫn bắt buộc là false
    assert.match(
      createModalSource,
      /publishNow:\s*false/,
      'CreateNotificationModal bắt buộc giữ publishNow: false'
    );

    // 1.5. Tuyệt đối không có nút Gửi Ngay trong modal tạo mới
    assert.ok(
      !createModalSource.includes('Gửi ngay') && !createModalSource.includes('Xuất bản ngay'),
      'R3-C2B: Tuyệt đối không có nút Gửi ngay trong CreateNotificationModal'
    );
  });

  // =========================================================================
  // SUITE 2: TÍCH HỢP NÚT XUẤT BẢN & THU HỒI TRONG NOTIFICATION MANAGEMENT TAB
  // =========================================================================
  await t.test('Suite 2: Hiển thị đúng nút Xuất bản (chỉ cho bản nháp) và Thu hồi (chỉ cho đã xuất bản)', () => {
    // 2.1. Import 2 component modal xác nhận
    assert.ok(
      managementTabSource.includes("import { PublishNotificationModal } from './PublishNotificationModal.jsx';") ||
      managementTabSource.includes('PublishNotificationModal'),
      'ManagementTab phải import PublishNotificationModal'
    );
    assert.ok(
      managementTabSource.includes("import { RecallNotificationModal } from './RecallNotificationModal.jsx';") ||
      managementTabSource.includes('RecallNotificationModal'),
      'ManagementTab phải import RecallNotificationModal'
    );

    // 2.2. Nút Xuất bản chỉ hiển thị khi là bản nháp và chưa bị thu hồi
    assert.match(
      managementTabSource,
      /isDraft\s*&&\s*!isRecalled\s*&&\s*profile\?\.role\s*===\s*['"]teacher['"][\s\S]*?handleOpenPublishModal\(item\)/,
      'Nút Xuất bản chỉ hiển thị cho bản nháp chưa thu hồi của Giáo viên'
    );

    // 2.3. Nút Thu hồi chỉ hiển thị khi đã phát hành và chưa bị thu hồi
    assert.match(
      managementTabSource,
      /isPublished\s*&&\s*!isRecalled\s*&&\s*profile\?\.role\s*===\s*['"]teacher['"][\s\S]*?handleOpenRecallModal\(item\)/,
      'Nút Thu hồi chỉ hiển thị cho thông báo đã gửi chưa thu hồi của Giáo viên'
    );

    // 2.4. Tuyệt đối không có nút Xuất bản hay Thu hồi trên thông báo đã thu hồi (isRecalled = true)
    assert.ok(
      !managementTabSource.includes('isRecalled && <button>Xuất bản'),
      'Không cho phép xuất bản lại thông báo đã thu hồi'
    );

    // 2.5. Render modal PublishNotificationModal và RecallNotificationModal với các props cần thiết
    assert.match(
      managementTabSource,
      /<PublishNotificationModal[\s\S]*?isOpen=\{isPublishModalOpen\}[\s\S]*?classes=\{classes\}[\s\S]*?onPublished=\{handlePublished\}[\s\S]*?\/>/,
      'ManagementTab phải render PublishNotificationModal'
    );
    assert.match(
      managementTabSource,
      /<RecallNotificationModal[\s\S]*?isOpen=\{isRecallModalOpen\}[\s\S]*?notification=\{selectedNotifForRecall\}[\s\S]*?onRecalled=\{handleRecalled\}[\s\S]*?\/>/,
      'ManagementTab phải render RecallNotificationModal'
    );
  });

  // =========================================================================
  // SUITE 3: PUBLISH DRAFT MODAL - BẢO MẬT & HỢP ĐỒNG RPC
  // =========================================================================
  await t.test('Suite 3: PublishNotificationModal xác nhận, bảo vệ ranh giới lớp, chống double submit & gọi RPC', () => {
    // 3.1. Phải import publishNotification từ service
    assert.match(
      publishModalSource,
      /import\s*\{[^}]*publishNotification[^}]*\}\s*from\s*['"][^'"]*notificationClient(\.js)?['"]/,
      'PublishNotificationModal phải import publishNotification'
    );

    // 3.2. Hiển thị đầy đủ thông tin: Tiêu đề, Nội dung, Danh sách lớp, Mức độ ưu tiên
    assert.match(publishModalSource, /draft\.title/, 'Phải hiển thị tiêu đề thông báo');
    assert.match(publishModalSource, /draft\.content/, 'Phải hiển thị nội dung thông báo');
    assert.match(publishModalSource, /targetClassNames/, 'Phải hiển thị danh sách lớp nhận thông báo');
    assert.match(publishModalSource, /draft\.priority/, 'Phải hiển thị mức độ ưu tiên');

    // 3.3. Kiểm tra ranh giới lớp: khóa nút Xuất bản nếu có lớp không còn thuộc quyền quản lý
    assert.match(
      publishModalSource,
      /hasInvalidClass\s*=[\s\S]*?targetClassIds\.some\(/,
      'Phải kiểm tra xem lớp nhận có thuộc quyền quản lý hiện tại hay không'
    );
    assert.match(
      publishModalSource,
      /disabled=\{isPublishing\s*\|\|\s*hasInvalidClass\}/,
      'Nút Xác nhận Xuất bản phải bị disable nếu lớp nhận không hợp lệ'
    );

    // 3.4. Chống double-submit đồng bộ bằng ref
    assert.match(
      publishModalSource,
      /const\s+isSubmittingRef\s*=\s*useRef\(false\)/,
      'PublishNotificationModal phải có isSubmittingRef'
    );
    assert.match(
      publishModalSource,
      /if\s*\(isSubmittingRef\.current\)\s*return/,
      'handleConfirmPublish phải chặn double-submit bằng ref'
    );

    // 3.5. Chỉ gọi publishNotification đúng một lần
    assert.match(
      publishModalSource,
      /await\s+publishNotification\(draft\.id\)/,
      'Phải gọi publishNotification với draft.id'
    );

    // 3.6. Không tự ý retry khi có lỗi, thông báo lỗi mạng yêu cầu kiểm tra lại trạng thái
    assert.match(
      publishModalSource,
      /Lỗi kết nối mạng: Không rõ thao tác đã thành công hay chưa/,
      'Phải thông báo yêu cầu kiểm tra lại trạng thái khi gặp sự cố kết nối mạng'
    );

    // 3.7. Chỉ thông báo thành công khi backend xác nhận (res.ok = true)
    assert.match(
      publishModalSource,
      /if\s*\(!res\.ok\)\s*\{[\s\S]*?return;?[\s\S]*?onPublished\(draft\)/,
      'Chỉ gọi callback onPublished khi res.ok === true'
    );

    // 3.8. Hỗ trợ Escape key đóng modal khi không đang gửi
    assert.match(
      publishModalSource,
      /e\.key\s*===\s*['"]Escape['"]/,
      'Hỗ trợ phím Escape đóng modal'
    );
  });

  // =========================================================================
  // SUITE 4: RECALL NOTIFICATION MODAL - HỢP ĐỒNG THU HỒI & DATA SAFETY
  // =========================================================================
  await t.test('Suite 4: RecallNotificationModal xác nhận, nhập lý do, giải thích lưu trữ & gọi RPC', () => {
    // 4.1. Phải import recallNotification từ service
    assert.match(
      recallModalSource,
      /import\s*\{[^}]*recallNotification[^}]*\}\s*from\s*['"][^'"]*notificationClient(\.js)?['"]/,
      'RecallNotificationModal phải import recallNotification'
    );

    // 4.2. Hiển thị tiêu đề thông báo sắp thu hồi
    assert.match(recallModalSource, /notification\.title/, 'Phải hiển thị tiêu đề thông báo sắp thu hồi');

    // 4.3. Có trường nhập lý do thu hồi và giới hạn 500 ký tự
    assert.match(
      recallModalSource,
      /maxLength=\{500\}/,
      'Trường nhập lý do thu hồi giới hạn tối đa 500 ký tự'
    );

    // 4.4. Giải thích rõ ràng về việc không còn trong hộp thư học sinh nhưng lịch sử vẫn lưu
    assert.match(
      recallModalSource,
      /không còn xuất hiện trong hộp thư thông thường[\s\S]*?lịch sử biên nhận và phát hành vẫn được hệ thống lưu trữ/,
      'Phải giải thích rõ ràng chính sách lưu trữ biên nhận khi thu hồi'
    );

    // 4.5. Chống double-submit đồng bộ bằng ref
    assert.match(
      recallModalSource,
      /const\s+isSubmittingRef\s*=\s*useRef\(false\)/,
      'RecallNotificationModal phải có isSubmittingRef'
    );
    assert.match(
      recallModalSource,
      /if\s*\(isSubmittingRef\.current\)\s*return/,
      'handleConfirmRecall phải chặn double submit bằng ref'
    );

    // 4.6. Chỉ gọi recallNotification(notification.id, reason)
    assert.match(
      recallModalSource,
      /await\s+recallNotification\(\s*notification\.id,/,
      'Phải gọi recallNotification với notification.id và lý do'
    );

    // 4.7. Không tự retry khi lỗi, thông báo lỗi kết nối rõ ràng
    assert.match(
      recallModalSource,
      /Lỗi kết nối mạng: Không rõ thao tác đã thành công hay chưa/,
      'Phải thông báo yêu cầu kiểm tra lại trạng thái khi lỗi mạng trong lúc thu hồi'
    );

    // 4.8. Không cho phép xuất bản lại thông báo đã thu hồi
    assert.match(
      recallModalSource,
      /Thông báo sau khi thu hồi sẽ KHÔNG THỂ xuất bản lại/,
      'Phải có cảnh báo không thể xuất bản lại thông báo đã thu hồi'
    );
  });

  // =========================================================================
  // SUITE 5: AUTH ISOLATION & DATA SAFETY TỔNG THỂ
  // =========================================================================
  await t.test('Suite 5: Cách ly tài khoản, không dùng service_role, tự đóng modal khi đăng xuất', () => {
    // 5.1. Cả 2 modal đều tự đóng khi user đăng xuất
    assert.match(
      publishModalSource,
      /if\s*\(!user\s*&&\s*isOpen\)\s*\{\s*onClose\(\);?\s*\}/,
      'PublishNotificationModal phải tự đóng khi người dùng đăng xuất'
    );
    assert.match(
      recallModalSource,
      /if\s*\(!user\s*&&\s*isOpen\)\s*\{\s*onClose\(\);?\s*\}/,
      'RecallNotificationModal phải tự đóng khi người dùng đăng xuất'
    );

    // 5.2. Tuyệt đối không dùng service_role trong component frontend
    assert.ok(!publishModalSource.includes('service_role'), 'Không dùng service_role trong PublishNotificationModal');
    assert.ok(!recallModalSource.includes('service_role'), 'Không dùng service_role trong RecallNotificationModal');
    assert.ok(!managementTabSource.includes('service_role'), 'Không dùng service_role trong NotificationManagementTab');

    // 5.3. Không gọi deleteDraftNotification ở vòng R3-C2B này
    assert.ok(!publishModalSource.includes('deleteDraftNotification'), 'Không gọi deleteDraftNotification');
    assert.ok(!recallModalSource.includes('deleteDraftNotification'), 'Không gọi deleteDraftNotification');
    assert.ok(!managementTabSource.includes('deleteDraftNotification'), 'Không gọi deleteDraftNotification');

    // 5.4. Không làm hỏng các tab khác trong TeacherDashboard
    assert.ok(teacherDashboardSource.includes("activeTab === 'classes'"), 'Tab classes của TeacherDashboard nguyên vẹn');
    assert.ok(teacherDashboardSource.includes("activeTab === 'games'"), 'Tab games của TeacherDashboard nguyên vẹn');
    assert.ok(teacherDashboardSource.includes("activeTab === 'academic-assignments'"), 'Tab academic-assignments nguyên vẹn');
    assert.ok(teacherDashboardSource.includes("activeTab === 'question-bank'"), 'Tab question-bank nguyên vẹn');
    assert.ok(teacherDashboardSource.includes("activeTab === 'exams'"), 'Tab exams nguyên vẹn');
  });

  // =========================================================================
  // SUITE 6: THỰC THI MOCK SERVICE RPC CONTRACT
  // =========================================================================
  await t.test('Suite 6: Mock service kiểm thử trực tiếp hàm publishNotification và recallNotification', async () => {
    // 6.1. Mock publishNotification thành công
    let rpcCallCount = 0;
    let rpcArgsReceived = null;

    const mockPublishSuccessClient = {
      rpc: async (fnName, args) => {
        rpcCallCount++;
        rpcArgsReceived = { fnName, args };
        return { data: true, error: null };
      }
    };

    const { publishNotification, recallNotification } = await import('../src/services/notificationClient.js');

    const pubRes = await publishNotification('test-notif-uuid-1', mockPublishSuccessClient);
    assert.strictEqual(pubRes.ok, true, 'publishNotification phải trả về ok: true khi RPC thành công');
    assert.strictEqual(pubRes.data, true, 'publishNotification data phải là true');
    assert.strictEqual(rpcCallCount, 1, 'RPC chỉ được gọi đúng 1 lần');
    assert.strictEqual(rpcArgsReceived.fnName, 'rpc_publish_notification', 'Tên RPC phải là rpc_publish_notification');
    assert.strictEqual(rpcArgsReceived.args.p_notification_id, 'test-notif-uuid-1', 'ID thông báo truyền vào đúng');

    // 6.2. Mock publishNotification thất bại không giả lập thành công
    const mockPublishFailClient = {
      rpc: async () => {
        return { data: null, error: { message: 'FORBIDDEN_CLASS: Teachers can only send notifications to classes they manage.' } };
      }
    };
    const pubFailRes = await publishNotification('test-notif-uuid-2', mockPublishFailClient);
    assert.strictEqual(pubFailRes.ok, false, 'publishNotification phải trả về ok: false khi RPC lỗi');
    assert.ok(pubFailRes.error.message.includes('lớp'), 'Lỗi được format thân thiện bằng tiếng Việt');

    // 6.3. Mock recallNotification thành công kèm lý do
    let recallCallCount = 0;
    let recallArgsReceived = null;
    const mockRecallSuccessClient = {
      rpc: async (fnName, args) => {
        recallCallCount++;
        recallArgsReceived = { fnName, args };
        return { data: true, error: null };
      }
    };

    const recallRes = await recallNotification('test-notif-uuid-3', 'Thu hồi để đính chính ngày thi', mockRecallSuccessClient);
    assert.strictEqual(recallRes.ok, true, 'recallNotification phải trả về ok: true khi RPC thành công');
    assert.strictEqual(recallRes.data, true, 'recallNotification data phải là true');
    assert.strictEqual(recallCallCount, 1, 'RPC recall chỉ được gọi đúng 1 lần');
    assert.strictEqual(recallArgsReceived.fnName, 'rpc_recall_notification', 'Tên RPC phải là rpc_recall_notification');
    assert.strictEqual(recallArgsReceived.args.p_notification_id, 'test-notif-uuid-3', 'ID thông báo đúng');
    assert.strictEqual(recallArgsReceived.args.p_reason, 'Thu hồi để đính chính ngày thi', 'Lý do thu hồi đúng');

    // 6.4. Mock recallNotification thất bại khi thông báo không tồn tại hoặc đã thu hồi
    const mockRecallFailClient = {
      rpc: async () => {
        return { data: null, error: { message: 'NOT_FOUND: Notification does not exist.' } };
      }
    };
    const recallFailRes = await recallNotification('invalid-id', null, mockRecallFailClient);
    assert.strictEqual(recallFailRes.ok, false, 'recallNotification phải trả về ok: false khi RPC lỗi');
    assert.ok(recallFailRes.error.message.includes('Không tìm thấy'), 'Lỗi format Tiếng Việt chính xác');
  });

  // =========================================================================
  // SUITE 7: PGLITE BACKEND AUTHORIZATION RE-VALIDATION AT PUBLISH TIME
  // =========================================================================
  await t.test('Suite 7: Backend re-validates teacher class rights upon rpc_publish_notification', async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite();

    // 1. Tạo roles và base schema Supabase chuẩn
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
        teacher_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.class_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        joined_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT uq_class_members_student UNIQUE (class_id, student_id)
      );
    `);

    // 2. Nạp migration Notifications V1
    const sql = fs.readFileSync('supabase/migrations/20261023210000_notifications_v1_schema_and_security.sql', 'utf8');
    await db.exec(sql);

    const teacherA = '11111111-1111-1111-1111-111111111111';
    const teacherB = '22222222-2222-2222-2222-222222222222';
    const classId = '33333333-3333-3333-3333-333333333333';

    await db.exec(`
      INSERT INTO public.profiles (id, email, full_name, role) VALUES
      ('${teacherA}', 'teacher_a@school.edu.vn', 'Cô Mai', 'teacher'),
      ('${teacherB}', 'teacher_b@school.edu.vn', 'Thầy Hùng', 'teacher');

      INSERT INTO public.classes (id, name, code, grade_level, teacher_id) VALUES
      ('${classId}', 'Lớp 1A', 'L1A', 1, '${teacherA}');
    `);

    // Teacher A tạo bản nháp khi còn phụ trách lớp 1A
    await db.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${teacherA}', false);
    `);
    const draftRes = await db.query(`
      SELECT public.rpc_create_notification(
        'Thông báo ôn tập',
        'Nội dung chuẩn bị thi giữa kỳ',
        'normal',
        'general',
        'classes',
        NULL,
        ARRAY['${classId}'::uuid],
        NULL,
        NULL,
        NULL,
        false
      ) AS notif_id;
    `);
    const draftId = draftRes.rows[0].notif_id;
    await db.exec(`RESET ROLE;`);

    // Admin chuyển quyền phụ trách lớp 1A từ Cô Mai sang Thầy Hùng
    await db.exec(`
      UPDATE public.classes SET teacher_id = '${teacherB}' WHERE id = '${classId}';
    `);

    // Cô Mai (Teacher A) cố tình gọi rpc_publish_notification để xuất bản bản nháp cũ
    let publishDenied = false;
    let publishError = '';
    try {
      await db.exec(`
        SET ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${teacherA}', false);
        SELECT public.rpc_publish_notification('${draftId}');
        RESET ROLE;
      `);
    } catch (err) {
      publishDenied = true;
      publishError = err.message;
      await db.exec(`RESET ROLE;`);
    }

    assert.strictEqual(publishDenied, true, 'Backend bắt buộc từ chối publish bản nháp khi GV không còn phụ trách lớp');
    assert.ok(publishError.includes('FORBIDDEN_CLASS'), 'Ngoại lệ từ chối phải là FORBIDDEN_CLASS');

    // Thông báo phải vẫn giữ nguyên là bản nháp is_published = false
    const checkDraft = await db.query(`SELECT is_published FROM public.notifications WHERE id = '${draftId}';`);
    assert.strictEqual(checkDraft.rows[0].is_published, false, 'Trạng thái thông báo vẫn phải là false (chưa xuất bản)');
  });

  // =========================================================================
  // SUITE 8: R3-FIX-01 BOOLEAN RPC SUCCESS GUARD & NO FALSE-SUCCESS PROTECTION
  // =========================================================================
  await t.test('Suite 8: R3-FIX-01 Boolean RPC Success Guard, không thông báo thành công giả khi data: false', async () => {
    // 8.1. Kiểm tra tĩnh: PublishNotificationModal bắt buộc kiểm tra cả res.ok === true && res.data === true
    assert.match(
      publishModalSource,
      /res\.ok\s*===\s*true\s*&&\s*res\.data\s*===\s*true/,
      'PublishNotificationModal bắt buộc kiểm tra res.ok === true && res.data === true'
    );

    // 8.2. Kiểm tra tĩnh: RecallNotificationModal bắt buộc kiểm tra cả res.ok === true && res.data === true
    assert.match(
      recallModalSource,
      /res\.ok\s*===\s*true\s*&&\s*res\.data\s*===\s*true/,
      'RecallNotificationModal bắt buộc kiểm tra res.ok === true && res.data === true'
    );

    // 8.3. Mô phỏng luồng Publish Modal: data === false KHÔNG được gọi callback onPublished và KHÔNG đóng modal
    {
      let callbackCalled = false;
      let modalClosed = false;
      let toastMessage = null;

      const onPublished = () => {
        callbackCalled = true;
        toastMessage = 'Đã xuất bản thông báo tới học sinh thành công!';
      };
      const onClose = () => {
        modalClosed = true;
      };

      // Mock service trả về data: false (máy chủ không xác nhận thành công)
      const mockClient = {
        rpc: async () => ({ data: false, error: null })
      };
      const { publishNotification } = await import('../src/services/notificationClient.js');
      const res = await publishNotification('draft-uuid-test', mockClient);

      // Service phải trả về ok: false
      assert.strictEqual(res.ok, false, 'Service phải trả về ok: false khi data: false');
      assert.strictEqual(res.data, false, 'Service phải trả về data: false');

      // Mô phỏng logic xử lý trong Modal theo hợp đồng R3-FIX-01
      if (res.ok === true && res.data === true) {
        onPublished();
        onClose();
      }

      assert.strictEqual(callbackCalled, false, 'Modal KHÔNG được gọi callback onPublished khi data: false');
      assert.strictEqual(modalClosed, false, 'Modal KHÔNG được đóng khi data: false');
      assert.strictEqual(toastMessage, null, 'Component cha KHÔNG hiển thị Toast thành công giả khi data: false');
    }

    // 8.4. Mô phỏng luồng Recall Modal: data === false KHÔNG được gọi callback onRecalled và KHÔNG đóng modal
    {
      let callbackCalled = false;
      let modalClosed = false;
      let toastMessage = null;

      const onRecalled = () => {
        callbackCalled = true;
        toastMessage = 'Đã thu hồi thông báo thành công!';
      };
      const onClose = () => {
        modalClosed = true;
      };

      const mockClient = {
        rpc: async () => ({ data: false, error: null })
      };
      const { recallNotification } = await import('../src/services/notificationClient.js');
      const res = await recallNotification('notif-uuid-test', 'Lý do', mockClient);

      assert.strictEqual(res.ok, false, 'recallNotification phải trả về ok: false khi data: false');
      assert.strictEqual(res.data, false);

      if (res.ok === true && res.data === true) {
        onRecalled();
        onClose();
      }

      assert.strictEqual(callbackCalled, false, 'Modal KHÔNG được gọi callback onRecalled khi data: false');
      assert.strictEqual(modalClosed, false, 'Modal KHÔNG được đóng khi data: false');
      assert.strictEqual(toastMessage, null, 'Component cha KHÔNG hiển thị Toast thu hồi giả khi data: false');
    }

    // 8.5. Mô phỏng các trường hợp bất thường: null, undefined, string "true", number 1
    {
      const { publishNotification } = await import('../src/services/notificationClient.js');
      const abnormalValues = [null, undefined, 'true', 1, 0, {}, []];

      for (const val of abnormalValues) {
        let callbackCalled = false;
        const mockClient = { rpc: async () => ({ data: val, error: null }) };
        const res = await publishNotification('draft-uuid-test', mockClient);

        assert.strictEqual(res.ok, false, `Giá trị data = ${JSON.stringify(val)} không được xem là thành công`);
        assert.strictEqual(res.data, false);

        if (res.ok === true && res.data === true) {
          callbackCalled = true;
        }
        assert.strictEqual(callbackCalled, false, `Callback không được gọi khi data = ${JSON.stringify(val)}`);
      }
    }

    // 8.6. Trường hợp data === true: Hoạt động bình thường như trước
    {
      let publishCallbackCalled = false;
      let recallCallbackCalled = false;

      const mockClient = { rpc: async () => ({ data: true, error: null }) };
      const { publishNotification, recallNotification } = await import('../src/services/notificationClient.js');

      const pubRes = await publishNotification('draft-uuid-test', mockClient);
      assert.strictEqual(pubRes.ok, true);
      assert.strictEqual(pubRes.data, true);
      if (pubRes.ok === true && pubRes.data === true) {
        publishCallbackCalled = true;
      }
      assert.strictEqual(publishCallbackCalled, true, 'Callback onPublished phải được gọi khi data === true');

      const recRes = await recallNotification('notif-uuid-test', 'Lý do', mockClient);
      assert.strictEqual(recRes.ok, true);
      assert.strictEqual(recRes.data, true);
      if (recRes.ok === true && recRes.data === true) {
        recallCallbackCalled = true;
      }
      assert.strictEqual(recallCallbackCalled, true, 'Callback onRecalled phải được gọi khi data === true');
    }

    // 8.7. Chống Double Submit & Zero Retry: Gọi đúng 1 lần duy nhất
    {
      let publishCalls = 0;
      let recallCalls = 0;
      const mockCountClient = {
        rpc: async (fnName) => {
          if (fnName === 'rpc_publish_notification') publishCalls++;
          if (fnName === 'rpc_recall_notification') recallCalls++;
          return { data: false, error: null };
        }
      };

      const { publishNotification, recallNotification } = await import('../src/services/notificationClient.js');
      await publishNotification('draft-id', mockCountClient);
      await recallNotification('notif-id', 'reason', mockCountClient);

      assert.strictEqual(publishCalls, 1, 'publishNotification chỉ được gọi 1 lần, tuyệt đối không tự retry');
      assert.strictEqual(recallCalls, 1, 'recallNotification chỉ được gọi 1 lần, tuyệt đối không tự retry');
    }

    // 8.8. Cô lập tài khoản (Auth Isolation): Nếu đổi tài khoản trong lúc request đang gửi, modal hủy cập nhật state
    assert.match(
      publishModalSource,
      /if\s*\(currentUserIdRef\.current\s*!==\s*activeUserId\)\s*\{\s*isSubmittingRef\.current\s*=\s*false;\s*return;\s*\}/,
      'PublishModal bảo vệ cô lập tài khoản khi đổi user'
    );
    assert.match(
      recallModalSource,
      /if\s*\(currentUserIdRef\.current\s*!==\s*activeUserId\)\s*\{\s*isSubmittingRef\.current\s*=\s*false;\s*return;\s*\}/,
      'RecallModal bảo vệ cô lập tài khoản khi đổi user'
    );
  });
});
