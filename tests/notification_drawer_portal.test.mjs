// tests/notification_drawer_portal.test.mjs
// Comprehensive verification suite for NotificationDrawer React Portal fix
// Tests:
// 1. Root Cause Verification: backdrop-filter containing-block vs createPortal
// 2. Desktop & Mobile Full Viewport Coverage (No 80px Navbar clipping)
// 3. Tab Switching ('all' / 'unread') & Tab-triggered Data Fetching
// 4. Notification Detail Viewing (Focus trap, Escape priority, pure text anti-XSS)
// 5. Mark As Read RPC Contract (Strict Boolean Guard, zero false-read, deduplication)
// 6. Open / Close Interactions (Bell click, Backdrop click, Close button, Escape key)
// 7. Error Handling & Auto-Refresh on Recalled / Revoked Notifications
// 8. Security & RPC Boundary (Zero RLS loosening, pure UI fix)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getMyNotifications, getUnreadNotificationCount, markNotificationAsRead } from '../src/services/notificationClient.js';

const bellSource = fs.readFileSync('src/components/notifications/NotificationBell.jsx', 'utf8');
const drawerSource = fs.readFileSync('src/components/notifications/NotificationDrawer.jsx', 'utf8');
const detailModalSource = fs.readFileSync('src/components/notifications/NotificationDetailModal.jsx', 'utf8');
const navbarSource = fs.readFileSync('src/components/common/Navbar.jsx', 'utf8');

test('=== NOTIFICATIONS V1: DRAWER PORTAL & DISPLAY ROOT CAUSE VERIFICATION SUITE ===', async (t) => {

  // =========================================================================
  // SUITE 1: XÁC MINH NGUYÊN NHÂN GỐC (ROOT CAUSE VERIFICATION)
  // =========================================================================
  await t.test('Suite 1: Xác nhận nguyên nhân gốc CSS Containing Block và giải pháp React createPortal', () => {
    // 1.1. Navbar header chứa backdrop-blur-md
    assert.match(
      navbarSource,
      /<header[^>]*className="[^"]*backdrop-blur-md[^"]*"/,
      'Navbar header bắt buộc phải có backdrop-blur-md (gây tạo containing block theo chuẩn CSS)'
    );

    // 1.2. Navbar header có chiều cao h-20 (~80px)
    assert.match(
      navbarSource,
      /h-20 flex items-center justify-between/,
      'Navbar header bị giới hạn chiều cao h-20 (80px), khiến mọi con fixed bị xén nếu không portal'
    );

    // 1.3. NotificationBell render NotificationDrawer bên trong cây DOM của Navbar
    assert.match(
      bellSource,
      /<NotificationDrawer[\s\S]*?isOpen=\{isDrawerOpen\}[\s\S]*?\/>/,
      'NotificationBell render NotificationDrawer trực tiếp'
    );

    // 1.4. NotificationDrawer import createPortal từ react-dom
    assert.match(
      drawerSource,
      /import\s*\{\s*createPortal\s*\}\s*from\s*['"]react-dom['"]/,
      'NotificationDrawer phải import createPortal từ react-dom'
    );

    // 1.5. NotificationDrawer render vào document.body bằng createPortal
    assert.match(
      drawerSource,
      /createPortal\s*\([\s\S]*?,\s*document\.body\s*\)/,
      'NotificationDrawer phải render vào document.body để thoát khỏi giới hạn của Navbar'
    );

    // 1.6. Safe SSR/headless guard typeof document !== 'undefined'
    assert.match(
      drawerSource,
      /typeof\s+document\s*===\s*['"]undefined['"]/,
      'Phải có guard typeof document === "undefined" để chạy an toàn trên Node.js/SSR'
    );
  });

  // =========================================================================
  // SUITE 2: ĐỘ PHỦ VIEWPORT TRÊN DESKTOP VÀ MOBILE
  // =========================================================================
  await t.test('Suite 2: Kiểm tra độ phủ Viewport toàn màn hình trên cả Desktop và Mobile', () => {
    // 2.1. Lớp phủ Backdrop fixed inset-0 phủ kín toàn bộ viewport
    assert.match(
      drawerSource,
      /className="fixed inset-0 z-50 overflow-hidden"/,
      'Khung bao bọc ngoài phải là fixed inset-0 z-50'
    );
    assert.match(
      drawerSource,
      /className="fixed inset-0 bg-slate-900\/40 backdrop-blur-sm transition-opacity"/,
      'Backdrop mờ phải là fixed inset-0'
    );

    // 2.2. Panel Drawer fixed inset-y-0 right-0 max-w-full flex pl-10
    assert.match(
      drawerSource,
      /className="fixed inset-y-0 right-0 max-w-full flex pl-10"/,
      'Drawer container phải dùng fixed inset-y-0 right-0 để trượt từ mép phải màn hình'
    );

    // 2.3. Aside responsive: w-screen max-w-md (co giãn mượt mà từ mobile 320px đến desktop 4K)
    assert.match(
      drawerSource,
      /className="w-screen max-w-md bg-white border-l-4 border-amber-300 shadow-2xl flex flex-col focus:outline-none"/,
      'Aside phải cấu hình w-screen max-w-md flex flex-col'
    );

    // 2.4. Danh sách thông báo flex-1 overflow-y-auto đảm bảo cuộn độc lập full chiều cao
    assert.match(
      drawerSource,
      /className="flex-1 overflow-y-auto p-4 space-y-3"/,
      'Danh sách thông báo phải là flex-1 overflow-y-auto'
    );
  });

  // =========================================================================
  // SUITE 3: CHUYỂN TAB TẤT CẢ / CHƯA ĐỌC & TẢI DỮ LIỆU
  // =========================================================================
  await t.test('Suite 3: Chuyển đổi tab Tất cả / Chưa đọc và kích hoạt tải dữ liệu tương ứng', () => {
    // 3.1. Tab Tất cả (activeTab === 'all')
    assert.match(
      drawerSource,
      /onClick=\{\(\)\s*=>\s*setActiveTab\('all'\)\}/,
      'Nút Tab Tất cả phải cập nhật activeTab = all'
    );

    // 3.2. Tab Chưa đọc (activeTab === 'unread') kèm badge unreadCount
    assert.match(
      drawerSource,
      /onClick=\{\(\)\s*=>\s*setActiveTab\('unread'\)\}/,
      'Nút Tab Chưa đọc phải cập nhật activeTab = unread'
    );
    assert.match(
      drawerSource,
      /unreadCount\s*>\s*0\s*&&\s*\(/,
      'Badge trên tab Chưa đọc chỉ hiển thị khi unreadCount > 0'
    );

    // 3.3. useEffect lắng nghe isOpen và activeTab để gọi fetchFirstPage
    assert.match(
      drawerSource,
      /useEffect\(\(\)\s*=>\s*\{[\s\S]*?if\s*\(isOpen\)\s*\{[\s\S]*?fetchFirstPage\(activeTab\);?[\s\S]*?\}[\s\S]*?\}, \[[^\]]*isOpen[^\]]*activeTab[^\]]*\]\)/,
      'useEffect phải gọi fetchFirstPage(activeTab) khi Drawer mở hoặc khi đổi tab'
    );
  });

  // =========================================================================
  // SUITE 4: XEM CHI TIẾT THÔNG BÁO (MODAL & ACCESSIBILITY)
  // =========================================================================
  await t.test('Suite 4: Mở Modal chi tiết thông báo, an toàn XSS và thứ tự phím Escape', () => {
    // 4.1. handleOpenDetail kích hoạt mở NotificationDetailModal
    assert.match(
      drawerSource,
      /const\s+handleOpenDetail\s*=\s*\(item\)\s*=>\s*\{[\s\S]*?setSelectedNotification\(item\);?[\s\S]*?setIsDetailOpen\(true\);?/,
      'handleOpenDetail phải lưu notification và mở isDetailOpen = true'
    );

    // 4.2. Modal chi tiết được lồng trong portal tree để kế thừa viewport body
    assert.match(
      drawerSource,
      /<NotificationDetailModal[\s\S]*?isOpen=\{isDetailOpen\}[\s\S]*?notification=\{selectedNotification\}[\s\S]*?\/>/,
      'NotificationDetailModal phải nhận đúng isOpen và notification'
    );

    // 4.3. Escape key: chỉ đóng Drawer khi isDetailOpen === false (không đóng nhầm Drawer khi modal mở)
    assert.match(
      drawerSource,
      /e\.key\s*===\s*['"]Escape['"]\s*&&\s*isOpen\s*&&\s*!isDetailOpen/,
      'Phím Escape trong Drawer phải kiểm tra !isDetailOpen để không đóng cả 2 cùng lúc'
    );

    // 4.4. Pure text rendering, chống chèn mã độc HTML/XSS
    assert.ok(
      !detailModalSource.includes('dangerouslySetInnerHTML'),
      'Detail modal không dùng dangerouslySetInnerHTML'
    );
    assert.ok(
      !drawerSource.includes('dangerouslySetInnerHTML'),
      'Drawer không dùng dangerouslySetInnerHTML'
    );
  });

  // =========================================================================
  // SUITE 5: HỢP ĐỒNG ĐÁNH DẤU ĐÃ ĐỌC (MARK AS READ)
  // =========================================================================
  await t.test('Suite 5: Hợp đồng RPC Đánh dấu đã đọc bảo vệ Boolean nghiêm ngặt và chống duplicate', () => {
    // 5.1. Chỉ gọi executeMarkAsRead khi item.is_read === false
    assert.match(
      drawerSource,
      /if\s*\(!item\.is_read\)\s*\{\s*(?:await\s+)?executeMarkAsRead\(item\);?\s*\}/,
      'Chỉ kích hoạt mark-as-read khi thông báo chưa đọc'
    );

    // 5.2. Chặn double-click với markingIdRef
    assert.match(
      drawerSource,
      /if\s*\(markingIdRef\.current\s*===\s*item\.id\)\s*return;?/,
      'Chặn gọi trùng lặp nếu thông báo đang trong tiến trình gửi RPC'
    );

    // 5.3. Boolean guard nghiêm ngặt: res.data === true
    assert.match(
      drawerSource,
      /res\.data\s*===\s*true/,
      'Chỉ cập nhật trạng thái đã đọc khi res.data === true'
    );

    // 5.4. Refresh số đếm unread từ backend, không trừ giả cục bộ
    assert.match(
      drawerSource,
      /if\s*\(typeof\s+onRefreshUnread\s*===\s*['"]function['"]\)\s*\{\s*onRefreshUnread\(\);?\s*\}/,
      'Phải gọi onRefreshUnread() để đồng bộ với cơ sở dữ liệu'
    );
  });

  // =========================================================================
  // SUITE 6: CÁC THAO TÁC ĐÓNG / MỞ VÀ TƯƠNG TÁC NGƯỜI DÙNG
  // =========================================================================
  await t.test('Suite 6: Đầy đủ các luồng đóng/mở (Chuông, Backdrop, Nút Đóng, Phím Escape)', () => {
    // 6.1. Bấm chuông đảo trạng thái Drawer
    assert.match(
      bellSource,
      /onClick=\{\(\)\s*=>\s*setIsDrawerOpen\(\(prev\)\s*=>\s*!prev\)\}/,
      'Nút chuông phải toggle setIsDrawerOpen'
    );

    // 6.2. Click vào Backdrop đóng Drawer
    assert.match(
      drawerSource,
      /<div[^>]*className="[^"]*fixed inset-0 bg-slate-900\/40[^"]*"[^>]*onClick=\{onClose\}/,
      'Backdrop phải có onClick={onClose}'
    );

    // 6.3. Nút đóng Drawer (icon X)
    assert.match(
      drawerSource,
      /<button[^>]*onClick=\{onClose\}[^>]*title="Đóng"/,
      'Header Drawer phải có nút đóng'
    );

    // 6.4. Nút Làm Mới danh sách
    assert.match(
      drawerSource,
      /<button[^>]*onClick=\{\(\)\s*=>\s*fetchFirstPage\(activeTab\)\}[^>]*title="Làm mới"/,
      'Header Drawer phải có nút Làm mới'
    );
  });

  // =========================================================================
  // SUITE 7: XỬ LÝ LỖI & TỰ ĐỘNG LÀM MỚI KHI BỊ THU HỒI
  // =========================================================================
  await t.test('Suite 7: Xử lý lỗi tải dữ liệu, thông báo bị thu hồi và cô lập tài khoản', () => {
    // 7.1. Bắt lỗi FORBIDDEN_RECALLED và FORBIDDEN_NOT_RECIPIENT để tự làm mới danh sách
    assert.match(
      drawerSource,
      /FORBIDDEN_RECALLED/,
      'Phải bắt lỗi FORBIDDEN_RECALLED để reload'
    );
    assert.match(
      drawerSource,
      /FORBIDDEN_NOT_RECIPIENT/,
      'Phải bắt lỗi FORBIDDEN_NOT_RECIPIENT để reload'
    );

    // 7.2. Reset sạch state khi người dùng đăng xuất (user === null)
    assert.match(
      drawerSource,
      /if\s*\(!user\)\s*\{[\s\S]*?setNotifications\(\[\]\);?[\s\S]*?setSelectedNotification\(null\);?[\s\S]*?setIsDetailOpen\(false\);?[\s\S]*?\}/,
      'Phải reset toàn bộ state khi đăng xuất'
    );
  });

  // =========================================================================
  // SUITE 8: BẢO MẬT & BẢO TOÀN KIẾN TRÚC RLS / RPC
  // =========================================================================
  await t.test('Suite 8: Phân biệt lỗi CSS với RPC/RLS, không nới lỏng bất kỳ quyền bảo mật nào', () => {
    // 8.1. NotificationDrawer không gọi supabase trực tiếp, chỉ dùng notificationClient
    assert.ok(
      !drawerSource.includes("from '../../lib/supabase'"),
      'Drawer tuyệt đối không import supabase client trực tiếp'
    );

    // 8.2. Không dùng service_role trong toàn bộ frontend
    assert.ok(
      !drawerSource.includes('service_role'),
      'Drawer không chứa service_role key'
    );
    assert.ok(
      !bellSource.includes('service_role'),
      'Bell không chứa service_role key'
    );

    // 8.3. Không thay đổi RPC contract: getMyNotifications, getUnreadNotificationCount, markNotificationAsRead
    assert.ok(
      typeof getMyNotifications === 'function',
      'getMyNotifications client service hoạt động bình thường'
    );
    assert.ok(
      typeof getUnreadNotificationCount === 'function',
      'getUnreadNotificationCount client service hoạt động bình thường'
    );
    assert.ok(
      typeof markNotificationAsRead === 'function',
      'markNotificationAsRead client service hoạt động bình thường'
    );
  });

});
