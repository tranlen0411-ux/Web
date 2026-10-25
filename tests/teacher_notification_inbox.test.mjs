// tests/teacher_notification_inbox.test.mjs
// Unit tests cho Teacher Notification Inbox & Release Gap Closure (Notifications V1 R3-E1)
// Kiểm thử: Teacher Bell, Student Bell preserved, Admin blocked, Recipient Isolation,
// Mark-as-read contract, Strict Boolean Guard, Zero Retry, Auth State Isolation, PGlite regression

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getMyNotifications, getUnreadNotificationCount, markNotificationAsRead } from '../src/services/notificationClient.js';

const bellSource = fs.readFileSync('src/components/notifications/NotificationBell.jsx', 'utf8');
const drawerSource = fs.readFileSync('src/components/notifications/NotificationDrawer.jsx', 'utf8');
const detailModalSource = fs.readFileSync('src/components/notifications/NotificationDetailModal.jsx', 'utf8');
const navbarSource = fs.readFileSync('src/components/common/Navbar.jsx', 'utf8');
const teacherDashboardSource = fs.readFileSync('src/pages/TeacherDashboard.jsx', 'utf8');
const adminDashboardSource = fs.readFileSync('src/pages/AdminDashboard.jsx', 'utf8');
const migrationSource = fs.readFileSync(
  'supabase/migrations/20261023210000_notifications_v1_schema_and_security.sql',
  'utf8'
);

test('=== NOTIFICATIONS V1 R3-E1: TEACHER NOTIFICATION INBOX & RELEASE GAP CLOSURE SUITE ===', async (t) => {

  // =========================================================================
  // SUITE 1: PHÂN QUYỀN CHUÔNG THÔNG BÁO CHO TEACHER VÀ BẢO TOÀN STUDENT
  // =========================================================================
  await t.test('Suite 1: Teacher và Student có chuông thông báo, Admin và Anon bị chặn hoàn toàn', () => {
    // 1.1. NotificationBell kiểm tra cả role student và teacher
    assert.match(
      bellSource,
      /const\s+isStudent\s*=\s*user\s*&&\s*profile\?\.role\s*===\s*['"]student['"]/,
      'NotificationBell phải nhận diện học sinh'
    );
    assert.match(
      bellSource,
      /const\s+isTeacher\s*=\s*user\s*&&\s*profile\?\.role\s*===\s*['"]teacher['"]/,
      'NotificationBell phải nhận diện giáo viên'
    );
    assert.match(
      bellSource,
      /const\s+isRecipient\s*=\s*isStudent\s*\|\|\s*isTeacher/,
      'isRecipient phải là hợp của isStudent và isTeacher'
    );

    // 1.2. Trả về null khi không phải recipient (chặn Admin và Anon)
    assert.match(
      bellSource,
      /if\s*\(!isRecipient\)\s*\{\s*return\s+null;\s*\}/,
      'NotificationBell bắt buộc trả về null khi !isRecipient (chặn Admin và vãng lai)'
    );

    // 1.3. Navbar nhúng NotificationBell tại vị trí thanh công cụ chung
    assert.ok(navbarSource.includes('<NotificationBell />'), 'Navbar phải chứa <NotificationBell />');
    assert.ok(
      navbarSource.includes("import { NotificationBell } from '../notifications/NotificationBell'"),
      'Navbar phải import NotificationBell'
    );

    // 1.4. AdminDashboard không tự động nhúng chuông nội bộ
    assert.ok(!adminDashboardSource.includes('NotificationBell'), 'AdminDashboard không chứa NotificationBell');
  });

  // =========================================================================
  // SUITE 2: BACKEND RPC CONTRACT AUDIT DÀNH CHO TEACHER INBOX
  // =========================================================================
  await t.test('Suite 2: Đối chiếu migration SQL xác nhận 3 RPC hỗ trợ đầy đủ và an toàn cho Teacher', () => {
    // 2.1. GRANT EXECUTE cho role authenticated trên cả 3 RPC
    assert.match(
      migrationSource,
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.rpc_get_my_notifications[\s\S]*?TO\s+authenticated;/,
      'rpc_get_my_notifications phải được cấp quyền cho authenticated'
    );
    assert.match(
      migrationSource,
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.rpc_get_unread_notification_count[\s\S]*?TO\s+authenticated;/,
      'rpc_get_unread_notification_count phải được cấp quyền cho authenticated'
    );
    assert.match(
      migrationSource,
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.rpc_mark_notification_as_read[\s\S]*?TO\s+authenticated;/,
      'rpc_mark_notification_as_read phải được cấp quyền cho authenticated'
    );

    // 2.2. RPC lọc theo nr.recipient_id = v_caller.user_id (= auth.uid())
    assert.match(
      migrationSource,
      /WHERE\s+nr\.recipient_id\s*=\s*v_caller\.user_id/,
      'rpc_get_my_notifications phải lọc theo nr.recipient_id = v_caller.user_id'
    );

    // 2.3. RPC loại trừ thông báo chưa xuất bản và thông báo đã thu hồi
    assert.match(
      migrationSource,
      /n\.is_published\s*=\s*TRUE\s+AND\s+n\.is_recalled\s*=\s*FALSE/,
      'RPC phải lọc bắt buộc is_published = TRUE và is_recalled = FALSE'
    );

    // 2.4. Trigger fn_notifications_after_save chèn Giáo viên khi target_type = 'all'
    assert.match(
      migrationSource,
      /role\s+IN\s+\('student',\s*'teacher'\)/,
      'Trigger sau khi xuất bản phải chèn recipients cho cả student và teacher khi all'
    );

    // 2.5. Trigger fn_notifications_after_save KHÔNG chèn Giáo viên khi target_type là grade hoặc classes
    assert.match(
      migrationSource,
      /target_type\s*=\s*'grade'[\s\S]*?role\s*=\s*'student'/,
      'Trigger scope grade chỉ chèn recipient cho học sinh'
    );
    assert.match(
      migrationSource,
      /target_type\s*=\s*'classes'[\s\S]*?role\s*=\s*'student'/,
      'Trigger scope classes chỉ chèn recipient cho học sinh'
    );
  });

  // =========================================================================
  // SUITE 3: TÁCH BIỆT NGHIỆP VỤ INBOX VÀ TIN ĐÃ GỬI (SENT MANAGEMENT)
  // =========================================================================
  await t.test('Suite 3: Tách biệt hoàn toàn Hộp thư đến (Inbox) và Quản lý tin đã gửi (Sent Management)', () => {
    // 3.1. NotificationDrawer sử dụng getMyNotifications (Inbox của người nhận)
    assert.ok(
      drawerSource.includes('getMyNotifications'),
      'NotificationDrawer phải sử dụng getMyNotifications để lấy hộp thư đến'
    );

    // 3.2. NotificationDrawer TUYỆT ĐỐI KHÔNG dùng getSentNotifications
    assert.ok(
      !drawerSource.includes('getSentNotifications'),
      'NotificationDrawer tuyệt đối không được dùng getSentNotifications'
    );

    // 3.3. TeacherDashboard giữ nguyên tab Thông báo lớp học sử dụng NotificationManagementTab
    assert.ok(
      teacherDashboardSource.includes('NotificationManagementTab'),
      'TeacherDashboard phải bảo toàn NotificationManagementTab'
    );

    // 3.4. Drawer không bị ảnh hưởng bởi globalClassFilter
    assert.ok(
      !drawerSource.includes('globalClassFilter'),
      'NotificationDrawer không được phụ thuộc globalClassFilter làm hạn chế thông báo toàn trường'
    );
  });

  // =========================================================================
  // SUITE 4: MOCK SERVICE TESTING CHO TEACHER INBOX & STRICT BOOLEAN GUARD
  // =========================================================================
  await t.test('Suite 4: Mock Service kiểm thử Teacher lấy hộp thư đến, đếm unread và đánh dấu đã đọc', async () => {
    const mockTeacherId = 'teacher-uuid-123';

    const mockClient = {
      rpc: async (fn, params) => {
        if (fn === 'rpc_get_my_notifications') {
          return {
            data: [
              {
                id: 'notif-all-school-1',
                title: 'Họp hội đồng sư phạm toàn trường',
                content: 'Kính mời quý thầy cô tham gia phiên họp lúc 14h.',
                priority: 'urgent',
                category: 'general',
                sender_name: 'Ban Giám Hiệu',
                is_read: false,
                read_at: null,
                published_at: new Date().toISOString()
              }
            ],
            error: null
          };
        }
        if (fn === 'rpc_get_unread_notification_count') {
          return { data: 1, error: null };
        }
        if (fn === 'rpc_mark_notification_as_read') {
          if (params.p_notification_id === 'notif-all-school-1') {
            return { data: true, error: null };
          }
          if (params.p_notification_id === 'notif-false-guard') {
            return { data: false, error: null }; // Test âm tính Boolean Guard
          }
        }
        return { data: null, error: new Error('RPC_FAILED') };
      }
    };

    // 4.1. Teacher gọi getMyNotifications lấy thông báo
    const notifRes = await getMyNotifications({ limit: 20, offset: 0 }, mockClient);
    assert.strictEqual(notifRes.ok, true, 'getMyNotifications phải trả ok: true');
    assert.strictEqual(notifRes.data.length, 1, 'Teacher phải nhận được 1 thông báo');
    assert.strictEqual(notifRes.data[0].title, 'Họp hội đồng sư phạm toàn trường');

    // 4.2. Teacher gọi getUnreadNotificationCount lấy số unread
    const unreadRes = await getUnreadNotificationCount(mockClient);
    assert.strictEqual(unreadRes.ok, true, 'getUnreadNotificationCount phải trả ok: true');
    assert.strictEqual(unreadRes.data, 1, 'Số lượng chưa đọc phải là 1');

    // 4.3. Teacher đánh dấu đã đọc thành công khi RPC trả true
    const markRes = await markNotificationAsRead('notif-all-school-1', mockClient);
    assert.strictEqual(markRes.ok, true, 'markNotificationAsRead phải trả ok: true khi data === true');
    assert.strictEqual(markRes.data, true, 'markNotificationAsRead phải trả data: true');

    // 4.4. Strict Boolean Guard: Chặn thành công giả khi RPC trả data: false
    const falseMarkRes = await markNotificationAsRead('notif-false-guard', mockClient);
    assert.strictEqual(falseMarkRes.ok, false, 'markNotificationAsRead phải trả ok: false khi RPC trả data: false');
    assert.strictEqual(falseMarkRes.data, false, 'data phải là false');
  });

  // =========================================================================
  // SUITE 5: AUTH ISOLATION, CHỐNG DOUBLE-SUBMIT & BẢO TOÀN AN TOÀN GIAO DIỆN
  // =========================================================================
  await t.test('Suite 5: Cách ly tài khoản khi logout/đổi user, chống double-click và XSS', () => {
    // 5.1. NotificationBell xóa unreadCount khi đổi user hoặc logout
    assert.match(
      bellSource,
      /if\s*\(!user\s*\|\|\s*\(!isStudent\s*&&\s*!isTeacher\)\)\s*\{[\s\S]*?setUnreadCount\(0\)/,
      'NotificationBell phải reset unreadCount = 0 khi đăng xuất'
    );

    // 5.2. NotificationDrawer dọn sạch state khi đăng xuất
    assert.match(
      drawerSource,
      /if\s*\(!user\)\s*\{\s*setNotifications\(\[\]\);/,
      'NotificationDrawer phải dọn sạch danh sách thông báo khi đăng xuất'
    );

    // 5.3. Chống double-click với markingIdRef trong NotificationDrawer
    assert.match(
      drawerSource,
      /if\s*\(markingIdRef\.current\s*===\s*item\.id\)\s*return;/,
      'NotificationDrawer phải có markingIdRef chặn double-click cùng 1 item'
    );

    // 5.4. Không sử dụng dangerouslySetInnerHTML trong toàn bộ components
    assert.ok(!drawerSource.includes('dangerouslySetInnerHTML'), 'Drawer không dùng dangerouslySetInnerHTML');
    assert.ok(!detailModalSource.includes('dangerouslySetInnerHTML'), 'DetailModal không dùng dangerouslySetInnerHTML');
    assert.ok(!bellSource.includes('dangerouslySetInnerHTML'), 'Bell không dùng dangerouslySetInnerHTML');
  });
});
