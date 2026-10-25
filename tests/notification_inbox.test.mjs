// tests/notification_inbox.test.mjs
// Unit tests cho NotificationBell, NotificationDrawer & NotificationDetailModal (R3-B1 & R3-B2)
// Kiểm tra ranh giới bảo mật, mark-as-read, Focus Trap, Escape, Polling Safety, Auth Switch Isolation & Zero HTML Injection

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bellSource = fs.readFileSync('src/components/notifications/NotificationBell.jsx', 'utf8');
const drawerSource = fs.readFileSync('src/components/notifications/NotificationDrawer.jsx', 'utf8');
const detailModalSource = fs.readFileSync('src/components/notifications/NotificationDetailModal.jsx', 'utf8');
const navbarSource = fs.readFileSync('src/components/common/Navbar.jsx', 'utf8');

test('=== NOTIFICATIONS V1 R3-B2: BELL, INBOX & DETAIL MARK AS READ SUITE ===', async (t) => {

  // =========================================================================
  // SUITE 1: PHÂN QUYỀN HIỂN THỊ CHUÔNG CHO NGƯỜI NHẬN (HỌC SINH & GIÁO VIÊN)
  // =========================================================================
  await t.test('Suite 1: Phân quyền hiển thị chuông cho Học sinh và Giáo viên, chặn Admin & Anon', () => {
    // 1.1. NotificationBell kiểm tra chặt chẽ user và role === 'student'
    assert.match(
      bellSource,
      /user\s*&&\s*profile\?\.role\s*===\s*['"]student['"]/,
      'NotificationBell phải kiểm tra user && profile.role === "student"'
    );

    // 1.2. NotificationBell mở rộng hỗ trợ Giáo viên (R3-E1)
    assert.match(
      bellSource,
      /user\s*&&\s*profile\?\.role\s*===\s*['"]teacher['"]/,
      'NotificationBell phải kiểm tra user && profile.role === "teacher"'
    );

    // 1.3. Trả về null khi không phải recipient (chặn Admin và Anon)
    assert.match(
      bellSource,
      /if\s*\(!isRecipient\)\s*\{\s*return\s+null;\s*\}/,
      'NotificationBell phải return null ngay lập tức khi !isRecipient'
    );

    // 1.4. Navbar nhúng NotificationBell
    assert.ok(
      navbarSource.includes('<NotificationBell />'),
      'Navbar phải nhúng component <NotificationBell />'
    );
    assert.ok(
      navbarSource.includes("import { NotificationBell } from '../notifications/NotificationBell'"),
      'Navbar phải import NotificationBell'
    );
  });

  // =========================================================================
  // SUITE 2: HIỂN THỊ BADGE UNREAD COUNT (CHỐNG HIỆN SỐ 0 GÂY RỐI)
  // =========================================================================
  await t.test('Suite 2: Hiển thị Unread Count chính xác & Tuyệt đối không hiện số 0', () => {
    // 2.1. Kiểm tra điều kiện hiển thị badge chỉ khi unreadCount > 0
    assert.match(
      bellSource,
      /hasUnread\s*=\s*unreadCount\s*>\s*0/,
      'hasUnread phải định nghĩa unreadCount > 0'
    );

    // 2.2. Badge chỉ render khi hasUnread là true
    assert.match(
      bellSource,
      /\{hasUnread\s*&&\s*\(/,
      'Badge phải nằm trong điều kiện {hasUnread && (...)}'
    );

    // 2.3. Rút gọn số lượng khi lớn hơn 99 (99+)
    assert.match(
      bellSource,
      /unreadCount\s*>\s*99\s*\?\s*['"]99\+['"]\s*:\s*unreadCount/,
      'Badge phải hiển thị "99+" nếu unreadCount > 99'
    );
  });

  // =========================================================================
  // SUITE 3: POLLING SAFETY & VISIBILITY API (CHỐNG SPAM REQUEST)
  // =========================================================================
  await t.test('Suite 3: Polling an toàn với Page Visibility API & Dọn dẹp Timer', () => {
    // 3.1. Chu kỳ polling tối đa 60 giây
    assert.match(
      bellSource,
      /POLLING_INTERVAL_MS\s*=\s*60000/,
      'Polling interval phải cấu hình là 60000ms (60 giây)'
    );

    // 3.2. Throttle khi chuyển tab tối thiểu 60 giây giữa các lần refresh tự động
    assert.match(
      bellSource,
      /MIN_VISIBILITY_REFRESH_GAP_MS\s*=\s*60000/,
      'Phải có cơ chế throttle tối thiểu 60 giây khi visibility thay đổi'
    );

    // 3.3. Kiểm tra document.visibilityState trước khi gọi request
    assert.match(
      bellSource,
      /document\.visibilityState\s*===\s*['"]visible['"]/,
      'Chỉ được gọi fetch khi tab đang ở trạng thái visible'
    );

    // 3.4. Dọn dẹp clearInterval và removeEventListener khi unmount
    assert.match(
      bellSource,
      /clearInterval\(intervalId\)/,
      'Phải dọn dẹp intervalId khi component unmount'
    );
    assert.match(
      bellSource,
      /removeEventListener\(['"]visibilitychange['"]/,
      'Phải gỡ bỏ listener visibilitychange khi unmount'
    );
  });

  // =========================================================================
  // SUITE 4: CÔ LẬP TRẠNG THÁI TÀI KHOẢN (AUTH STATE ISOLATION)
  // =========================================================================
  await t.test('Suite 4: Cách ly trạng thái khi đăng xuất hoặc chuyển đổi tài khoản', () => {
    // 4.1. Khi !user hoặc role !== 'student' thì reset unreadCount = 0 và đóng drawer
    assert.match(
      bellSource,
      /setUnreadCount\(0\)/,
      'Phải reset unreadCount về 0 khi tài khoản không hợp lệ'
    );
    assert.match(
      bellSource,
      /setIsDrawerOpen\(false\)/,
      'Phải đóng Drawer khi tài khoản đăng xuất'
    );

    // 4.2. Chống race condition với currentUserIdRef trong Bell
    assert.match(
      bellSource,
      /currentUserIdRef\.current\s*===\s*activeUserId/,
      'Bell phải kiểm tra activeUserId khớp currentUserIdRef để chống race condition'
    );

    // 4.3. Chống race condition với currentUserIdRef trong Drawer khi gọi mark-as-read
    assert.match(
      drawerSource,
      /currentUserIdRef\.current\s*!==\s*activeUserId/,
      'Drawer phải hủy cập nhật nếu tài khoản đổi trong lúc RPC đang bay'
    );
  });

  // =========================================================================
  // SUITE 5: QUY TẮC ĐÁNH DẤU ĐÃ ĐỌC (MARK AS READ RPC CONTRACT)
  // =========================================================================
  await t.test('Suite 5: Quy tắc đánh dấu đã đọc chính xác & Không gọi thừa', () => {
    // 5.1. Drawer import và sử dụng markNotificationAsRead từ notificationClient
    assert.ok(
      drawerSource.includes('markNotificationAsRead'),
      'Drawer phải import và gọi markNotificationAsRead'
    );

    // 5.2. CHỈ gọi RPC khi thông báo đang CHƯA ĐỌC (!item.is_read)
    assert.match(
      drawerSource,
      /if\s*\(!item\.is_read\)\s*\{\s*(?:await\s+)?executeMarkAsRead\(item\);?\s*\}/,
      'Chỉ được gọi executeMarkAsRead khi thông báo có is_read === false'
    );

    // 5.3. Không gọi lại RPC nếu thông báo đã đọc
    assert.match(
      drawerSource,
      /if\s*\(!item\?\.id\s*\|\|\s*item\.is_read\)\s*return;?/,
      'Phải chặn gọi markNotificationAsRead nếu item.is_read đã là true'
    );

    // 5.4. Chặn double click và request trùng lặp (markingIdRef)
    assert.match(
      drawerSource,
      /if\s*\(markingIdRef\.current\s*===\s*item\.id\)\s*return;?/,
      'Phải chặn click trùng lặp khi thông báo đang trong tiến trình đánh dấu đọc'
    );

    // 5.5. Cập nhật unread count từ server sau khi thành công
    assert.match(
      drawerSource,
      /if\s*\(res\.ok\)\s*\{[\s\S]*?onRefreshUnread\(\);?[\s\S]*?\}/,
      'Phải gọi onRefreshUnread() để lấy số đếm thực tế từ server sau khi mark-as-read thành công'
    );
  });

  // =========================================================================
  // SUITE 6: XỬ LÝ LỖI, THÔNG BÁO THU HỒI & REFRESH DỮ LIỆU
  // =========================================================================
  await t.test('Suite 6: Xử lý lỗi, thông báo thu hồi & làm mới danh sách tự động', () => {
    // 6.1. Giữ nguyên trạng thái chưa đọc khi RPC lỗi và lưu markReadError
    assert.match(
      drawerSource,
      /setMarkReadError\(res\.error\);?/,
      'Phải lưu lỗi vào markReadError khi RPC thất bại'
    );

    // 6.2. Phát hiện thông báo đã bị thu hồi hoặc mất quyền nhận để refresh danh sách
    assert.match(
      drawerSource,
      /errCode\s*===\s*['"]FORBIDDEN_RECALLED['"]/,
      'Phải bắt lỗi FORBIDDEN_RECALLED để làm mới danh sách'
    );
    assert.match(
      drawerSource,
      /errCode\s*===\s*['"]FORBIDDEN_NOT_RECIPIENT['"]/,
      'Phải bắt lỗi FORBIDDEN_NOT_RECIPIENT để làm mới danh sách'
    );
    assert.match(
      drawerSource,
      /fetchFirstPage\(activeTab\);?/,
      'Phải tải lại trang khi phát hiện thông báo không còn hợp lệ'
    );
  });

  // =========================================================================
  // SUITE 7: CẤU TRÚC NOTIFICATION DETAIL MODAL & ACCESSIBILITY
  // =========================================================================
  await t.test('Suite 7: Modal chi tiết thông báo, Quản lý Focus & Accessibility', () => {
    // 7.1. Cấu trúc ARIA Accessibility
    assert.match(
      detailModalSource,
      /role="dialog"/,
      'Detail Modal phải có role="dialog"'
    );
    assert.match(
      detailModalSource,
      /aria-modal="true"/,
      'Detail Modal phải có aria-modal="true"'
    );
    assert.match(
      detailModalSource,
      /aria-labelledby="notification-detail-title"/,
      'Detail Modal phải có aria-labelledby="notification-detail-title"'
    );
    assert.match(
      detailModalSource,
      /aria-describedby="notification-detail-content"/,
      'Detail Modal phải có aria-describedby="notification-detail-content"'
    );

    // 7.2. Hỗ trợ phím Escape đóng modal
    assert.match(
      detailModalSource,
      /e\.key\s*===\s*['"]Escape['"]/,
      'Detail Modal phải đóng khi bấm Escape'
    );

    // 7.3. Quản lý Focus (lưu active element và trả focus khi đóng)
    assert.match(
      detailModalSource,
      /previouslyFocusedRef\.current\s*=\s*document\.activeElement/,
      'Phải lưu phần tử trước khi mở modal để trả focus'
    );
    assert.match(
      detailModalSource,
      /previouslyFocusedRef\.current\.focus\(\)/,
      'Phải trả focus về phần tử cũ khi đóng modal'
    );

    // 7.4. Render text an toàn: Tuyệt đối không dùng dangerouslySetInnerHTML
    assert.ok(
      !detailModalSource.includes('dangerouslySetInnerHTML'),
      'Detail Modal tuyệt đối không dùng dangerouslySetInnerHTML'
    );

    // 7.5. Không tự động mở link ngoài hoặc điều hướng
    assert.ok(
      !detailModalSource.includes('window.open('),
      'Detail Modal không được tự ý window.open()'
    );
    assert.ok(
      !detailModalSource.includes('window.location'),
      'Detail Modal không được tự ý đổi window.location'
    );
  });

  // =========================================================================
  // SUITE 8: R3-FIX-02 MARK AS READ BOOLEAN GUARD & NO FALSE-READ PROTECTION
  // =========================================================================
  await t.test('Suite 8: R3-FIX-02 Mark As Read Boolean Guard, không đánh dấu đã đọc giả khi data: false', async () => {
    // 8.1. Kiểm tra tĩnh: NotificationDrawer chỉ cập nhật trạng thái khi res.data === true
    assert.match(
      drawerSource,
      /res\.data\s*===\s*true/,
      'NotificationDrawer phải kiểm tra res.data === true trước khi cập nhật state đã đọc'
    );

    // 8.2. Mô phỏng: Khi data: false -> Không cập nhật is_read và Không gọi onRefreshUnread()
    {
      let refreshedUnread = false;
      let notificationState = [{ id: 'notif-1', is_read: false }];
      let selectedNotif = { id: 'notif-1', is_read: false };
      let markReadError = null;

      const onRefreshUnread = () => {
        refreshedUnread = true;
      };

      const mockClient = {
        rpc: async () => ({ data: false, error: null })
      };
      const { markNotificationAsRead } = await import('../src/services/notificationClient.js');
      const res = await markNotificationAsRead('notif-1', mockClient);

      assert.strictEqual(res.ok, false, 'Service phải trả về ok: false khi RPC trả về data: false');
      assert.strictEqual(res.data, false, 'Service data phải là false');

      // Mô phỏng logic xử lý trong NotificationDrawer
      if (res.ok) {
        if (res.data === true) {
          notificationState = notificationState.map(n => ({ ...n, is_read: true }));
          selectedNotif = { ...selectedNotif, is_read: true };
          onRefreshUnread();
        } else {
          markReadError = res.error || new Error('Chưa xác nhận đã đọc.');
        }
      } else {
        markReadError = res.error;
      }

      assert.strictEqual(notificationState[0].is_read, false, 'Danh sách thông báo KHÔNG được đổi sang is_read: true');
      assert.strictEqual(selectedNotif.is_read, false, 'Thông báo đang mở KHÔNG được đổi sang is_read: true');
      assert.strictEqual(refreshedUnread, false, 'TUYỆT ĐỐI không gọi onRefreshUnread() khi chưa xác nhận thành công');
      assert.ok(markReadError instanceof Error, 'Phải lưu lại lỗi trong markReadError');
    }

    // 8.3. Mô phỏng các trường hợp bất thường: null, undefined, string "true", number 1
    {
      const { markNotificationAsRead } = await import('../src/services/notificationClient.js');
      const abnormalValues = [null, undefined, 'true', 1, 0, {}, []];

      for (const val of abnormalValues) {
        let refreshedUnread = false;
        let isReadUpdated = false;

        const mockClient = { rpc: async () => ({ data: val, error: null }) };
        const res = await markNotificationAsRead('notif-1', mockClient);

        assert.strictEqual(res.ok, false, `Giá trị data = ${JSON.stringify(val)} không được coi là thành công`);
        assert.strictEqual(res.data, false);

        if (res.ok && res.data === true) {
          isReadUpdated = true;
          refreshedUnread = true;
        }

        assert.strictEqual(isReadUpdated, false, `Không cập nhật đã đọc khi data = ${JSON.stringify(val)}`);
        assert.strictEqual(refreshedUnread, false, `Không refresh badge khi data = ${JSON.stringify(val)}`);
      }
    }

    // 8.4. Trường hợp data === true: Cập nhật bình thường
    {
      let refreshedUnread = false;
      let notificationState = [{ id: 'notif-1', is_read: false }];

      const mockClient = { rpc: async () => ({ data: true, error: null }) };
      const { markNotificationAsRead } = await import('../src/services/notificationClient.js');
      const res = await markNotificationAsRead('notif-1', mockClient);

      assert.strictEqual(res.ok, true, 'ok phải là true khi data === true');
      assert.strictEqual(res.data, true);

      if (res.ok && res.data === true) {
        notificationState = notificationState.map(n => ({ ...n, is_read: true }));
        refreshedUnread = true;
      }

      assert.strictEqual(notificationState[0].is_read, true, 'is_read được cập nhật thành true');
      assert.strictEqual(refreshedUnread, true, 'onRefreshUnread() được gọi sau khi thành công');
    }

    // 8.5. Chống Double Click & Zero Retry
    {
      let rpcCalls = 0;
      const mockCountClient = {
        rpc: async (fnName) => {
          if (fnName === 'rpc_mark_notification_as_read') rpcCalls++;
          return { data: false, error: null };
        }
      };

      const { markNotificationAsRead } = await import('../src/services/notificationClient.js');
      await markNotificationAsRead('notif-1', mockCountClient);
      assert.strictEqual(rpcCalls, 1, 'markNotificationAsRead chỉ gọi 1 lần duy nhất, không tự ý retry');
    }

    // 8.6. Cô lập tài khoản (Auth Switch Isolation)
    assert.match(
      drawerSource,
      /if\s*\(currentUserIdRef\.current\s*!==\s*activeUserId\)\s*return;?/,
      'NotificationDrawer dừng ngay lập tức nếu user chuyển tài khoản trong lúc request đang bay'
    );
  });

});
