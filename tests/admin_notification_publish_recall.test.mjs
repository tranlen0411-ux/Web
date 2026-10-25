// tests/admin_notification_publish_recall.test.mjs
// Unit tests cho Admin Publish Draft & Recall Notification (Notifications V1 R3-D2B)
// Kiểm thử: Ma trận thẩm quyền Admin, Classes Completeness Guard (Fail-Closed),
// Xác nhận 3 phạm vi (all, grade, classes), Chống Double-Submit, Strict Boolean Guard, Zero Retry, Auth Isolation

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { publishNotification, recallNotification, getNotificationById } from '../src/services/notificationClient.js';

const adminTabSource = fs.readFileSync(
  'src/components/dashboard/notifications/AdminNotificationManagementTab.jsx',
  'utf8'
);
const adminCreateModalSource = fs.readFileSync(
  'src/components/dashboard/notifications/AdminCreateNotificationModal.jsx',
  'utf8'
);
const adminPublishModalSource = fs.readFileSync(
  'src/components/dashboard/notifications/AdminPublishNotificationModal.jsx',
  'utf8'
);
const adminRecallModalSource = fs.readFileSync(
  'src/components/dashboard/notifications/AdminRecallNotificationModal.jsx',
  'utf8'
);
const adminDashboardSource = fs.readFileSync('src/pages/AdminDashboard.jsx', 'utf8');
const teacherDashboardSource = fs.readFileSync('src/pages/TeacherDashboard.jsx', 'utf8');
const migrationSource = fs.readFileSync(
  'supabase/migrations/20261023210000_notifications_v1_schema_and_security.sql',
  'utf8'
);

test('=== NOTIFICATIONS V1 R3-D2B: ADMIN PUBLISH & RECALL WITH SAFETY GATES SUITE ===', async (t) => {

  // =========================================================================
  // SUITE 1: TÍCH HỢP NÚT XUẤT BẢN & THU HỒI TRONG ADMIN NOTIFICATION MANAGEMENT TAB
  // =========================================================================
  await t.test('Suite 1: Nút Xuất bản & Thu hồi và Tích hợp Modals trong AdminNotificationManagementTab', () => {
    // 1.1. Import 2 component modal xác nhận Admin
    assert.ok(
      adminTabSource.includes("import { AdminPublishNotificationModal } from './AdminPublishNotificationModal.jsx';") ||
      adminTabSource.includes('AdminPublishNotificationModal'),
      'AdminNotificationManagementTab phải import AdminPublishNotificationModal'
    );
    assert.ok(
      adminTabSource.includes("import { AdminRecallNotificationModal } from './AdminRecallNotificationModal.jsx';") ||
      adminTabSource.includes('AdminRecallNotificationModal'),
      'AdminNotificationManagementTab phải import AdminRecallNotificationModal'
    );

    // 1.2. Nút Xuất bản chỉ hiển thị khi là bản nháp và chưa bị thu hồi
    assert.match(
      adminTabSource,
      /isDraft\s*&&\s*!isRecalled\s*&&[\s\S]*?setPublishModalItem\(item\)[\s\S]*?Xuất bản/,
      'Nút Xuất bản chỉ hiển thị cho bản nháp chưa xuất bản và chưa thu hồi'
    );

    // 1.3. Nút Thu hồi chỉ hiển thị khi đã phát hành và chưa bị thu hồi
    assert.match(
      adminTabSource,
      /isPublished\s*&&\s*!isRecalled\s*&&[\s\S]*?setRecallModalItem\(item\)[\s\S]*?Thu hồi/,
      'Nút Thu hồi chỉ hiển thị cho thông báo đã xuất bản và chưa thu hồi'
    );

    // 1.4. Nút Xuất bản và Thu hồi đều bắt buộc yêu cầu !isRecalled
    assert.match(
      adminTabSource,
      /isDraft\s*&&\s*!isRecalled\s*&&/,
      'Nút Xuất bản bắt buộc kiểm tra !isRecalled'
    );
    assert.match(
      adminTabSource,
      /isPublished\s*&&\s*!isRecalled\s*&&/,
      'Nút Thu hồi bắt buộc kiểm tra !isRecalled'
    );

    // 1.5. Render modal AdminPublishNotificationModal và AdminRecallNotificationModal với các props cần thiết
    assert.match(
      adminTabSource,
      /<AdminPublishNotificationModal[\s\S]*?isOpen=\{Boolean\(publishModalItem\)\}[\s\S]*?classes=\{classes\}[\s\S]*?isClassesComplete=\{isClassesComplete\}[\s\S]*?onPublished=\{handlePublished\}[\s\S]*?\/>/,
      'AdminTab phải render AdminPublishNotificationModal kèm isClassesComplete và onPublished'
    );
    assert.match(
      adminTabSource,
      /<AdminRecallNotificationModal[\s\S]*?isOpen=\{Boolean\(recallModalItem\)\}[\s\S]*?notification=\{recallModalItem\}[\s\S]*?classes=\{classes\}[\s\S]*?onRecalled=\{handleRecalled\}[\s\S]*?\/>/,
      'AdminTab phải render AdminRecallNotificationModal kèm onRecalled'
    );
  });

  // =========================================================================
  // SUITE 2: ADMIN CLASSES COMPLETENESS GUARD (FAIL-CLOSED)
  // =========================================================================
  await t.test('Suite 2: Admin Classes Completeness Guard (Fail-Closed) trong AdminDashboard & Create Modal', () => {
    // 2.1. AdminDashboard tính toán isClassesComplete dựa trên đầy đủ điều kiện fail-closed
    assert.match(
      adminDashboardSource,
      /isClassesComplete=\{[\s\S]*?!loading[\s\S]*?!classesError[\s\S]*?Array\.isArray\(classesListState\)[\s\S]*?classesListState\.length\s*===\s*stats\.classes[\s\S]*?\}/,
      'AdminDashboard phải truyền isClassesComplete với điều kiện !loading, !classesError và khớp số lượng stats.classes'
    );

    // 2.2. AdminNotificationManagementTab nhận isClassesComplete và truyền cho Create Modal
    assert.match(
      adminTabSource,
      /isClassesComplete\s*=\s*false/,
      'AdminNotificationManagementTab phải nhận prop isClassesComplete mặc định false'
    );
    assert.match(
      adminTabSource,
      /<AdminCreateNotificationModal[\s\S]*?isClassesComplete=\{isClassesComplete\}[\s\S]*?\/>/,
      'AdminNotificationManagementTab phải truyền isClassesComplete cho AdminCreateNotificationModal'
    );

    // 2.3. AdminCreateNotificationModal nhận prop isClassesComplete
    assert.match(
      adminCreateModalSource,
      /isClassesComplete\s*=\s*false/,
      'AdminCreateNotificationModal phải nhận prop isClassesComplete mặc định false'
    );

    // 2.4. Chặn chọn tất cả lớp khi isClassesComplete = false
    assert.match(
      adminCreateModalSource,
      /if\s*\(!isClassesComplete\)\s*\{[\s\S]*?setErrorMessage\(/,
      'handleSelectAllClasses phải chặn và báo lỗi nếu isClassesComplete = false'
    );

    // 2.5. Chặn lưu bản nháp theo lớp khi isClassesComplete = false
    assert.match(
      adminCreateModalSource,
      /if\s*\(!isClassesComplete\)\s*\{[\s\S]*?setErrorMessage\(['"]Không thể tạo thông báo theo lớp: Dữ liệu danh sách lớp chưa được tải đầy đủ/,
      'handleSaveDraft phải chặn lưu theo lớp nếu isClassesComplete = false'
    );

    // 2.6. Hiển thị banner cảnh báo an toàn khi isClassesComplete = false trong bộ chọn lớp
    assert.match(
      adminCreateModalSource,
      /!isClassesComplete\s*&&[\s\S]*?Dữ liệu danh sách lớp chưa được tải đầy đủ/,
      'AdminCreateNotificationModal phải hiển thị cảnh báo an toàn khi danh sách lớp chưa hoàn chỉnh'
    );
  });

  // =========================================================================
  // SUITE 3: ADMIN PUBLISH CONFIRMATION & DIỄN ĐẠT PHẠM VI NGƯỜI NHẬN
  // =========================================================================
  await t.test('Suite 3: AdminPublishNotificationModal xác nhận phạm vi người nhận & diễn đạt chuẩn xác', () => {
    // 3.1. Diễn đạt đúng phạm vi Toàn trường ('all')
    assert.ok(
      adminPublishModalSource.includes('Thông báo sẽ được gửi tới Giáo viên và Học sinh đang hoạt động trên toàn trường.'),
      'Phạm vi "all" phải diễn đạt chính xác: Thông báo sẽ được gửi tới Giáo viên và Học sinh đang hoạt động trên toàn trường.'
    );

    // 3.2. Diễn đạt đúng phạm vi Theo khối ('grade')
    assert.ok(
      adminPublishModalSource.includes('Chỉ gửi tới Học sinh thuộc khối đã chọn; Giáo viên không nhận thông báo này.'),
      'Phạm vi "grade" phải ghi rõ: Chỉ gửi tới Học sinh thuộc khối đã chọn; Giáo viên không nhận thông báo này.'
    );

    // 3.3. Diễn đạt đúng phạm vi Theo lớp ('classes')
    assert.ok(
      adminPublishModalSource.includes('Chỉ gửi tới Học sinh thuộc các lớp được chọn; Giáo viên không nhận thông báo này.'),
      'Phạm vi "classes" phải ghi rõ: Chỉ gửi tới Học sinh thuộc các lớp được chọn; Giáo viên không nhận thông báo này.'
    );

    // 3.4. Không hiển thị số lượng người nhận suy đoán
    assert.ok(
      !adminPublishModalSource.includes('Ước tính') && !adminPublishModalSource.includes('Dự kiến người nhận'),
      'Tuyệt đối không suy đoán số lượng người nhận trong giao diện Admin'
    );

    // 3.5. Hiển thị đầy đủ Tiêu đề, Nội dung, Chuyên mục, Mức độ ưu tiên
    assert.match(adminPublishModalSource, /activeNotif\.title/, 'Phải hiển thị tiêu đề thông báo');
    assert.match(adminPublishModalSource, /activeNotif\.content/, 'Phải hiển thị nội dung thông báo');
    assert.match(adminPublishModalSource, /currentCategory/, 'Phải hiển thị chuyên mục thông báo');
    assert.match(adminPublishModalSource, /currentPriority/, 'Phải hiển thị mức độ ưu tiên');

    // 3.6. Fail-closed: Khóa nút xác nhận khi phạm vi lớp không đầy đủ hoặc có lớp không xác định
    assert.match(
      adminPublishModalSource,
      /isClassesBlocked\s*=\s*isClassesScope\s*&&/,
      'Phải có cờ isClassesBlocked kiểm tra toàn vẹn danh sách lớp'
    );
    assert.match(
      adminPublishModalSource,
      /disabled=\{isPublishing\s*\|\|\s*isAlreadyRecalled\s*\|\|\s*isAlreadyPublished\s*\|\|\s*isClassesBlocked\}/,
      'Nút Xác nhận xuất bản phải bị vô hiệu hóa khi isClassesBlocked hoặc đã thu hồi/xuất bản'
    );

    // 3.7. Truy vấn đọc an toàn getNotificationById để đối chiếu trước khi xuất bản
    assert.match(
      adminPublishModalSource,
      /getNotificationById\(notification\.id\)/,
      'AdminPublishNotificationModal phải gọi getNotificationById để đối chiếu dữ liệu mới nhất'
    );
  });

  // =========================================================================
  // SUITE 4: ADMIN RECALL NOTIFICATION MODAL
  // =========================================================================
  await t.test('Suite 4: AdminRecallNotificationModal xác nhận thu hồi, nhập lý do & cảnh báo nghiệp vụ', () => {
    // 4.1. Hiển thị tiêu đề, phạm vi thông báo và người tạo
    assert.match(adminRecallModalSource, /activeNotif\.title/, 'Phải hiển thị tiêu đề thông báo cần thu hồi');
    assert.match(adminRecallModalSource, /renderScopeSummary/, 'Phải hiển thị tóm tắt phạm vi thông báo');
    assert.match(adminRecallModalSource, /activeNotif\.sender_name_snapshot/, 'Phải hiển thị người tạo thông báo');

    // 4.2. Cảnh báo không thể hoàn tác và không xóa lịch sử
    assert.ok(
      adminRecallModalSource.includes(
        'Hành động này sẽ ngừng hiển thị thông báo đối với tất cả người nhận. Lịch sử thông báo vẫn được lưu trữ trong hệ thống và không thể hoàn tác.'
      ),
      'Phải có cảnh báo rõ ràng về việc ngừng hiển thị nhưng bảo toàn lịch sử và không thể hoàn tác'
    );

    // 4.3. Textarea nhập lý do thu hồi (giới hạn 500 ký tự)
    assert.match(
      adminRecallModalSource,
      /<textarea[\s\S]*?maxLength=\{500\}/,
      'Phải có textarea nhập lý do thu hồi với maxLength 500 ký tự'
    );
    assert.match(
      adminRecallModalSource,
      /<textarea[\s\S]*?value=\{recallReason\}/,
      'Textarea phải bind value với recallReason'
    );

    // 4.4. Chặn thu hồi nếu thông báo chưa xuất bản hoặc đã thu hồi
    assert.match(
      adminRecallModalSource,
      /disabled=\{isRecalling\s*\|\|\s*isAlreadyRecalled\s*\|\|\s*isNotPublished\s*\|\|\s*recallReason\.length\s*>\s*500\}/,
      'Nút Xác nhận thu hồi phải bị disable nếu chưa xuất bản hoặc đã thu hồi'
    );

    // 4.5. Truy vấn đọc an toàn getNotificationById để đối chiếu
    assert.match(
      adminRecallModalSource,
      /getNotificationById\(notification\.id\)/,
      'AdminRecallNotificationModal phải gọi getNotificationById để đối chiếu dữ liệu mới nhất'
    );
  });

  // =========================================================================
  // SUITE 5: STRICT BOOLEAN RPC GUARD, CHỐNG DOUBLE-SUBMIT & KHÔNG RETRY
  // =========================================================================
  await t.test('Suite 5: Strict Boolean RPC Guard, Chống Double-Submit & Zero Automatic Retry', () => {
    // 5.1. Chống double-submit đồng bộ bằng ref trong AdminPublishNotificationModal
    assert.match(
      adminPublishModalSource,
      /const\s+isSubmittingRef\s*=\s*useRef\(false\)/,
      'AdminPublishNotificationModal phải có isSubmittingRef đồng bộ'
    );
    assert.match(
      adminPublishModalSource,
      /if\s*\(isPublishing\)\s*return;\s*if\s*\(isSubmittingRef\.current\)\s*return;/,
      'handleConfirmPublish phải chặn ngay nếu isSubmittingRef.current = true'
    );

    // 5.2. Strict Boolean guard trong AdminPublishNotificationModal
    assert.match(
      adminPublishModalSource,
      /if\s*\(res\.ok\s*===\s*true\s*&&\s*res\.data\s*===\s*true\)/,
      'AdminPublishNotificationModal bắt buộc kiểm tra res.ok === true && res.data === true'
    );

    // 5.3. Chống double-submit đồng bộ bằng ref trong AdminRecallNotificationModal
    assert.match(
      adminRecallModalSource,
      /const\s+isSubmittingRef\s*=\s*useRef\(false\)/,
      'AdminRecallNotificationModal phải có isSubmittingRef đồng bộ'
    );
    assert.match(
      adminRecallModalSource,
      /if\s*\(isRecalling\)\s*return;\s*if\s*\(isSubmittingRef\.current\)\s*return;/,
      'handleConfirmRecall phải chặn ngay nếu isSubmittingRef.current = true'
    );

    // 5.4. Strict Boolean guard trong AdminRecallNotificationModal
    assert.match(
      adminRecallModalSource,
      /if\s*\(res\.ok\s*===\s*true\s*&&\s*res\.data\s*===\s*true\)/,
      'AdminRecallNotificationModal bắt buộc kiểm tra res.ok === true && res.data === true'
    );

    // 5.5. Thông điệp trung lập khi gặp lỗi mạng không rõ trạng thái (cả 2 modal)
    const expectedNetworkMsg = 'Lỗi kết nối mạng: Không rõ thao tác đã thành công hay chưa. Vui lòng kiểm tra lại danh sách hoặc tải lại trang trước khi thử tiếp.';
    assert.ok(
      adminPublishModalSource.includes(expectedNetworkMsg),
      'Publish Modal phải có thông điệp trung lập khi gặp lỗi mạng'
    );
    assert.ok(
      adminRecallModalSource.includes(expectedNetworkMsg),
      'Recall Modal phải có thông điệp trung lập khi gặp lỗi mạng'
    );

    // 5.6. Không tự ý retry RPC trong code
    assert.ok(!adminPublishModalSource.includes('retry(') && !adminPublishModalSource.includes('setInterval'), 'Không tự retry Publish RPC');
    assert.ok(!adminRecallModalSource.includes('retry(') && !adminRecallModalSource.includes('setInterval'), 'Không tự retry Recall RPC');
  });

  // =========================================================================
  // SUITE 6: CÁCH LY PHIÊN TÀI KHOẢN, PHÂN QUYỀN ADMIN & BẢO TOÀN GIÁO VIÊN
  // =========================================================================
  await t.test('Suite 6: Cách ly tài khoản, kiểm tra vai trò admin & bảo toàn TeacherDashboard', () => {
    // 6.1. AdminPublishNotificationModal kiểm tra vai trò admin
    assert.match(
      adminPublishModalSource,
      /if\s*\(!user\s*\|\|\s*profile\?\.role\s*!==\s*['"]admin['"]\)/,
      'AdminPublishNotificationModal phải từ chối nếu không phải role admin'
    );

    // 6.2. AdminRecallNotificationModal kiểm tra vai trò admin
    assert.match(
      adminRecallModalSource,
      /if\s*\(!user\s*\|\|\s*profile\?\.role\s*!==\s*['"]admin['"]\)/,
      'AdminRecallNotificationModal phải từ chối nếu không phải role admin'
    );

    // 6.3. Tự đóng modal khi logout hoặc chuyển tài khoản
    assert.match(
      adminPublishModalSource,
      /if\s*\(!user\s*&&\s*isOpen\)\s*\{\s*onClose\(\);\s*\}/,
      'AdminPublishNotificationModal phải tự đóng khi user đăng xuất'
    );
    assert.match(
      adminRecallModalSource,
      /if\s*\(!user\s*&&\s*isOpen\)\s*\{\s*onClose\(\);\s*\}/,
      'AdminRecallNotificationModal phải tự đóng khi user đăng xuất'
    );

    // 6.4. TeacherDashboard không bị ảnh hưởng và không chứa Admin Modals
    assert.ok(
      !teacherDashboardSource.includes('AdminPublishNotificationModal') &&
      !teacherDashboardSource.includes('AdminRecallNotificationModal'),
      'TeacherDashboard tuyệt đối không chứa Admin Publish hoặc Recall Modals'
    );

    // 6.5. AdminNotificationManagementTab không gọi trực tiếp deleteDraftNotification
    assert.ok(
      !adminTabSource.includes('deleteDraftNotification'),
      'AdminNotificationManagementTab không được gọi deleteDraftNotification trong lượt này'
    );
  });

  // =========================================================================
  // SUITE 7: MA TRẬN THẨM QUYỀN BACKEND RPC & TRIGGER SCOPE AUDIT
  // =========================================================================
  await t.test('Suite 7: Đối chiếu ma trận thẩm quyền Admin Publish & Recall từ Database Migration', () => {
    // 7.1. rpc_publish_notification: Admin có toàn quyền xuất bản mọi bản nháp (kể cả do Teacher tạo)
    assert.match(
      migrationSource,
      /IF\s+v_caller\.user_role\s*=\s*'admin'\s+THEN\s+NULL;/,
      'Migration rpc_publish_notification: Admin có toàn quyền xuất bản (v_caller.user_role = admin THEN NULL)'
    );

    // 7.2. rpc_publish_notification: Chặn xuất bản thông báo đã thu hồi
    assert.match(
      migrationSource,
      /IF\s+v_notif\.is_recalled\s*=\s*TRUE\s+THEN[\s\S]*?FORBIDDEN_PUBLISH_RECALLED/,
      'Migration rpc_publish_notification: Chặn xuất bản thông báo đã thu hồi (FORBIDDEN_PUBLISH_RECALLED)'
    );

    // 7.3. rpc_recall_notification: Admin có toàn quyền thu hồi mọi thông báo (kể cả do Teacher tạo)
    assert.match(
      migrationSource,
      /IF\s+v_caller\.user_role\s*=\s*'admin'\s+THEN\s+NULL;/,
      'Migration rpc_recall_notification: Admin có toàn quyền thu hồi (v_caller.user_role = admin THEN NULL)'
    );

    // 7.4. Trigger fn_notifications_after_save:
    // Scope 'all' -> student + teacher active
    assert.match(
      migrationSource,
      /target_type\s*=\s*'all'[\s\S]*?role\s+IN\s+\('student',\s*'teacher'\)/,
      'Migration fn_notifications_after_save: Scope all gửi tới role student và teacher'
    );

    // Scope 'grade' -> chỉ student active
    assert.match(
      migrationSource,
      /target_type\s*=\s*'grade'[\s\S]*?role\s*=\s*'student'/,
      'Migration fn_notifications_after_save: Scope grade CHỈ gửi tới role student'
    );

    // Scope 'classes' -> chỉ student active trong các lớp
    assert.match(
      migrationSource,
      /target_type\s*=\s*'classes'[\s\S]*?role\s*=\s*'student'/,
      'Migration fn_notifications_after_save: Scope classes CHỈ gửi tới role student'
    );
  });

  // =========================================================================
  // SUITE 8: MOCK SERVICE TESTING CHO PUBLISH, RECALL & STRICT BOOLEAN GUARDS
  // =========================================================================
  await t.test('Suite 8: Mock Service kiểm thử publishNotification, recallNotification & getNotificationById', async () => {
    // 8.1. publishNotification: Thành công khi RPC trả về true
    const mockSuccessClient = {
      rpc: async (fn, params) => {
        if (fn === 'rpc_publish_notification' && params.p_notification_id === 'valid-uuid') {
          return { data: true, error: null };
        }
        if (fn === 'rpc_recall_notification' && params.p_notification_id === 'valid-uuid') {
          return { data: true, error: null };
        }
        return { data: null, error: new Error('Unknown rpc') };
      }
    };

    const pubRes = await publishNotification('valid-uuid', mockSuccessClient);
    assert.strictEqual(pubRes.ok, true, 'publishNotification phải trả ok: true khi rpc trả true');
    assert.strictEqual(pubRes.data, true, 'publishNotification phải trả data: true khi rpc trả true');

    const recRes = await recallNotification('valid-uuid', 'Lý do kiểm thử', mockSuccessClient);
    assert.strictEqual(recRes.ok, true, 'recallNotification phải trả ok: true khi rpc trả true');
    assert.strictEqual(recRes.data, true, 'recallNotification phải trả data: true khi rpc trả true');

    // 8.2. publishNotification: Thất bại khi RPC trả về false (R3-FIX-01 Guard)
    const mockFalseClient = {
      rpc: async () => ({ data: false, error: null })
    };

    const falsePubRes = await publishNotification('valid-uuid', mockFalseClient);
    assert.strictEqual(falsePubRes.ok, false, 'publishNotification phải trả ok: false khi RPC trả data: false');
    assert.strictEqual(falsePubRes.data, false, 'publishNotification phải trả data: false khi RPC trả data: false');

    const falseRecRes = await recallNotification('valid-uuid', 'Lý do', mockFalseClient);
    assert.strictEqual(falseRecRes.ok, false, 'recallNotification phải trả ok: false khi RPC trả data: false');
    assert.strictEqual(falseRecRes.data, false, 'recallNotification phải trả data: false khi RPC trả data: false');

    // 8.3. getNotificationById: Truy vấn đọc an toàn hoạt động chính xác
    const mockReadClient = {
      from: (table) => {
        assert.strictEqual(table, 'notifications');
        return {
          select: () => ({
            eq: (col, val) => {
              assert.strictEqual(col, 'id');
              assert.strictEqual(val, 'notif-123');
              return {
                maybeSingle: async () => ({
                  data: {
                    id: 'notif-123',
                    title: 'Thông báo toàn trường',
                    content: 'Nội dung thông báo',
                    target_type: 'all',
                    is_published: false,
                    is_recalled: false
                  },
                  error: null
                })
              };
            }
          })
        };
      }
    };

    const readRes = await getNotificationById('notif-123', mockReadClient);
    assert.strictEqual(readRes.ok, true, 'getNotificationById phải trả ok: true');
    assert.strictEqual(readRes.data.title, 'Thông báo toàn trường', 'getNotificationById phải trả đúng dữ liệu');
  });
});
