// tests/admin_notification_management.test.mjs
// Unit tests cho Admin Notification Management Tab (Notifications V1 R3-D1 - READ ONLY UI)
// Kiểm tra tích hợp AdminDashboard, đồng bộ URL ?tab=notifications, READ ONLY tuyệt đối,
// ranh giới bảo mật quyền Admin, bộ lọc trạng thái, phân trang tất định, và bảo toàn toàn vẹn hệ thống.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const adminDashboardSource = fs.readFileSync('src/pages/AdminDashboard.jsx', 'utf8');
const adminTabSource = fs.readFileSync(
  'src/components/dashboard/notifications/AdminNotificationManagementTab.jsx',
  'utf8'
);
const notificationClientSource = fs.readFileSync('src/services/notificationClient.js', 'utf8');
const teacherDashboardSource = fs.readFileSync('src/pages/TeacherDashboard.jsx', 'utf8');

test('=== NOTIFICATIONS V1 R3-D1: ADMIN NOTIFICATION MANAGEMENT READ-ONLY SUITE ===', async (t) => {
  // =========================================================================
  // SUITE 1: TÍCH HỢP TAB QUẢN LÝ THÔNG BÁO VÀO ADMIN DASHBOARD & ĐỒNG BỘ URL
  // =========================================================================
  await t.test('Suite 1: Tích hợp Tab Quản Lý Thông Báo và đồng bộ URL query ?tab=notifications', () => {
    // 1.1. AdminDashboard import AdminNotificationManagementTab
    assert.ok(
      adminDashboardSource.includes("import { AdminNotificationManagementTab } from '../components/dashboard/notifications/AdminNotificationManagementTab'"),
      'AdminDashboard phải import AdminNotificationManagementTab'
    );

    // 1.2. AdminDashboard import Bell icon từ lucide-react
    assert.match(
      adminDashboardSource,
      /import\s*\{[\s\S]*?Bell[\s\S]*?\}\s*from\s*['"]lucide-react['"]/,
      'AdminDashboard phải import icon Bell từ lucide-react'
    );

    // 1.3. Nhận diện tabParam === 'notifications' khi khởi tạo activeAdminTab
    assert.ok(
      adminDashboardSource.includes("tabParam === 'notifications'"),
      'activeAdminTab phải nhận diện tabParam === "notifications" khi khởi tạo'
    );

    // 1.4. Lắng nghe searchParams để đồng bộ tab notifications vào activeAdminTab
    assert.match(
      adminDashboardSource,
      /tab\s*===\s*['"]notifications['"]/,
      'useEffect searchParams phải lắng nghe tab === "notifications"'
    );

    // 1.5. Nút chuyển tab Quản Lý Thông Báo tồn tại và đồng bộ URL ?tab=notifications
    assert.match(
      adminDashboardSource,
      /setActiveAdminTab\(['"]notifications['"]\)/,
      'Nút tab phải kích hoạt setActiveAdminTab("notifications")'
    );
    assert.match(
      adminDashboardSource,
      /setSearchParams\(\{\s*tab:\s*['"]notifications['"]\s*\}\s*,\s*\{\s*replace:\s*true\s*\}\)/,
      'Nút tab phải cập nhật query param tab=notifications khi click'
    );

    // 1.6. Render AdminNotificationManagementTab khi activeAdminTab === 'notifications'
    assert.match(
      adminDashboardSource,
      /\{activeAdminTab\s*===\s*['"]notifications['"]\s*&&\s*\(\s*<div[\s\S]*?>\s*<AdminNotificationManagementTab\s+classes=\{classesListState\}[\s\S]*?\/>/,
      'Phải render AdminNotificationManagementTab kèm classes prop khi activeAdminTab là notifications'
    );

    // 1.7. Bảo toàn toàn vẹn tất cả các tab quản trị cũ của AdminDashboard
    assert.ok(adminDashboardSource.includes("activeAdminTab === 'users'"), 'Tab users phải được bảo toàn');
    assert.ok(adminDashboardSource.includes("activeAdminTab === 'games'"), 'Tab games phải được bảo toàn');
    assert.ok(adminDashboardSource.includes("activeAdminTab === 'exercises'"), 'Tab exercises phải được bảo toàn');
    assert.ok(adminDashboardSource.includes("activeAdminTab === 'question-bank'"), 'Tab question-bank phải được bảo toàn');
    assert.ok(adminDashboardSource.includes("activeAdminTab === 'exams'"), 'Tab exams phải được bảo toàn');
  });

  // =========================================================================
  // SUITE 2: THỰC THI READ-ONLY TUYỆT ĐỐI & ZERO MUTATION TRÊN GIAO DIỆN ADMIN
  // =========================================================================
  await t.test('Suite 2: R3-D1 Thực thi READ-ONLY tuyệt đối, không có bất kỳ thao tác ghi dữ liệu', () => {
    // 2.1. Phải sử dụng hàm getSentNotifications từ notificationClient
    assert.ok(
      adminTabSource.includes('getSentNotifications'),
      'AdminNotificationManagementTab phải sử dụng getSentNotifications'
    );

    // 2.2. Tuyệt đối KHÔNG import hoặc gọi createNotification
    assert.ok(
      !adminTabSource.includes('createNotification'),
      'R3-D1: Tuyệt đối không được import hoặc gọi createNotification'
    );

    // 2.3. Tuyệt đối KHÔNG import hoặc gọi publishNotification
    assert.ok(
      !adminTabSource.includes('publishNotification'),
      'R3-D1: Tuyệt đối không được import hoặc gọi publishNotification'
    );

    // 2.4. Tuyệt đối KHÔNG import hoặc gọi recallNotification
    assert.ok(
      !adminTabSource.includes('recallNotification'),
      'R3-D1: Tuyệt đối không được import hoặc gọi recallNotification'
    );

    // 2.5. Tuyệt đối KHÔNG import hoặc gọi deleteDraftNotification
    assert.ok(
      !adminTabSource.includes('deleteDraftNotification'),
      'R3-D1: Tuyệt đối không được import hoặc gọi deleteDraftNotification'
    );

    // 2.6. Tuyệt đối KHÔNG trực tiếp gọi các phương thức ghi/sửa database
    assert.ok(!adminTabSource.includes('.insert('), 'Không được thực hiện insert trực tiếp');
    assert.ok(!adminTabSource.includes('.update('), 'Không được thực hiện update trực tiếp');
    assert.ok(!adminTabSource.includes('.delete('), 'Không được thực hiện delete trực tiếp');
    assert.ok(!adminTabSource.includes('.upsert('), 'Không được thực hiện upsert trực tiếp');

    // 2.7. Tuyệt đối KHÔNG tự tạo Supabase client mới
    assert.ok(
      !adminTabSource.includes('createClient('),
      'Tuyệt đối không được tự khởi tạo createClient mới'
    );

    // 2.8. Không nhúng modal soạn tin của Giáo viên hoặc các modal xuất bản / thu hồi của giáo viên
    assert.ok(!adminTabSource.includes("from './CreateNotificationModal'") && !adminTabSource.includes('<CreateNotificationModal'), 'Không nhúng CreateNotificationModal của giáo viên');
    assert.ok(!adminTabSource.includes("from './PublishNotificationModal'") && !adminTabSource.includes('<PublishNotificationModal'), 'Không nhúng PublishNotificationModal của giáo viên');
    assert.ok(!adminTabSource.includes("from './RecallNotificationModal'") && !adminTabSource.includes('<RecallNotificationModal'), 'Không nhúng RecallNotificationModal của giáo viên');
  });

  // =========================================================================
  // SUITE 3: BẢO VỆ PHÂN QUYỀN ADMIN, CÁCH LY PHIÊN & CHỐNG STALE RESPONSE
  // =========================================================================
  await t.test('Suite 3: Bảo vệ phân quyền Admin, cách ly tài khoản và chặn race condition', () => {
    // 3.1. Kiểm tra vai trò admin từ AuthContext
    assert.match(
      adminTabSource,
      /profile\?\.role\s*!==\s*['"]admin['"]/,
      'Phải kiểm tra profile.role !== "admin" để từ chối truy cập trái phép'
    );

    // 3.2. Hiển thị UI từ chối quyền truy cập khi không phải admin
    assert.ok(
      adminTabSource.includes('Quyền truy cập bị từ chối'),
      'Phải có giao diện thông báo Quyền truy cập bị từ chối'
    );

    // 3.3. Xóa dữ liệu khỏi state khi user đăng xuất hoặc không phải admin
    assert.match(
      adminTabSource,
      /if\s*\(!user\s*\|\|\s*profile\?\.role\s*!==\s*['"]admin['"]\)\s*\{[\s\S]*?setNotifications\(\[\]\);[\s\S]*?setTotalCount\(0\);/,
      'Phải reset notifications và totalCount khi user đăng xuất hoặc role không phải admin'
    );

    // 3.4. Có cơ chế chặn stale response (Race Condition guard)
    assert.ok(
      adminTabSource.includes('activeRequestIdRef') || adminTabSource.includes('currentRequestId'),
      'Phải có requestId ref để bỏ qua stale response từ request cũ'
    );
    assert.ok(
      adminTabSource.includes('currentUserIdRef') || adminTabSource.includes('activeUserId'),
      'Phải kiểm tra đối chiếu user ID khi phản hồi trả về để tránh lộ dữ liệu chéo giữa các phiên'
    );

    // 3.5. Không phụ thuộc vào Global Class Filter để giới hạn phạm vi quản trị toàn trường
    assert.ok(
      !adminTabSource.includes('globalClassFilter'),
      'AdminNotificationManagementTab không được phụ thuộc globalClassFilter làm hạn chế dữ liệu toàn trường'
    );
  });

  // =========================================================================
  // SUITE 4: BỘ LỌC TRẠNG THÁI (STATUS FILTERS) & GIAO DIỆN ĐẦY ĐỦ TRẠNG THÁI
  // =========================================================================
  await t.test('Suite 4: Hỗ trợ 4 bộ lọc trạng thái, loading skeleton, empty state, error & retry', () => {
    // 4.1. Khởi tạo statusFilter mặc định là 'all'
    assert.match(
      adminTabSource,
      /useState\(['"]all['"]\)/,
      'statusFilter mặc định phải là "all"'
    );

    // 4.2. Hỗ trợ đủ 4 bộ lọc: all, published, draft, recalled
    assert.ok(adminTabSource.includes("handleFilterChange('all')"), 'Hỗ trợ nút lọc Tất cả');
    assert.ok(adminTabSource.includes("handleFilterChange('published')"), 'Hỗ trợ nút lọc Đã gửi');
    assert.ok(adminTabSource.includes("handleFilterChange('draft')"), 'Hỗ trợ nút lọc Bản nháp');
    assert.ok(adminTabSource.includes("handleFilterChange('recalled')"), 'Hỗ trợ nút lọc Đã thu hồi');

    // 4.3. Khi đổi bộ lọc phải reset về trang 1
    assert.match(
      adminTabSource,
      /const\s+handleFilterChange\s*=\s*\([\s\S]*?\)\s*=>\s*\{[\s\S]*?setCurrentPage\(1\);/,
      'Khi đổi filter phải setCurrentPage(1)'
    );

    // 4.4. Có skeleton loading khi đang tải
    assert.ok(
      adminTabSource.includes('animate-pulse'),
      'Phải có skeleton với animate-pulse khi đang tải'
    );

    // 4.5. Empty state tương ứng từng filter, không dùng dữ liệu giả
    assert.ok(adminTabSource.includes('Không có bản nháp nào trong hệ thống'), 'Empty state bản nháp');
    assert.ok(adminTabSource.includes('Chưa có thông báo nào được phát hành'), 'Empty state đã phát hành');
    assert.ok(adminTabSource.includes('Không có thông báo nào bị thu hồi'), 'Empty state đã thu hồi');

    // 4.6. Có Error banner và nút Thử lại (Retry)
    assert.ok(adminTabSource.includes('Thử lại'), 'Phải có nút Thử lại khi gặp lỗi');
  });

  // =========================================================================
  // SUITE 5: PHÂN TRANG 20 BẢN GHI & SẮP XẾP TẤT ĐỊNH (PAGINATION HARDENING)
  // =========================================================================
  await t.test('Suite 5: Phân trang 20 bản ghi, sắp xếp tất định created_at DESC, id DESC', () => {
    // 5.1. PAGE_SIZE = 20
    assert.match(
      adminTabSource,
      /PAGE_SIZE\s*=\s*20/,
      'PAGE_SIZE phải là 20'
    );

    // 5.2. Chữ ký và logic trong notificationClient.js: order created_at DESC và id DESC
    assert.match(
      notificationClientSource,
      /\.order\(['"]created_at['"],\s*\{\s*ascending:\s*false\s*\}\)\s*\.order\(['"]id['"],\s*\{\s*ascending:\s*false\s*\}\)/,
      'getSentNotifications phải sắp xếp created_at DESC và bổ sung id DESC để đảm bảo thứ tự tất định'
    );

    // 5.3. Nút phân trang có aria-label cho accessibility
    assert.ok(adminTabSource.includes('aria-label="Trang trước"'), 'Nút trang trước có aria-label');
    assert.ok(adminTabSource.includes('aria-label="Trang sau"'), 'Nút trang sau có aria-label');
  });

  // =========================================================================
  // SUITE 6: HIỂN THỊ ĐẦY ĐỦ THÔNG TIN THÔNG BÁO QUẢN TRỊ
  // =========================================================================
  await t.test('Suite 6: Hiển thị đầy đủ tiêu đề, nội dung, người tạo snapshot, phạm vi, trạng thái & lý do thu hồi', () => {
    // 6.1. Tiêu đề và nội dung
    assert.ok(adminTabSource.includes('{item.title}'), 'Hiển thị tiêu đề thông báo');
    assert.ok(adminTabSource.includes('{item.content}'), 'Hiển thị nội dung tóm tắt');

    // 6.2. Người tạo thông báo từ sender_name_snapshot
    assert.ok(
      adminTabSource.includes('item.sender_name_snapshot'),
      'Phải hiển thị người tạo qua sender_name_snapshot an toàn'
    );

    // 6.3. Mức độ ưu tiên
    assert.ok(adminTabSource.includes("item.priority === 'urgent'"), 'Nhận diện ưu tiên khẩn cấp');
    assert.ok(adminTabSource.includes("item.priority === 'high'"), 'Nhận diện ưu tiên quan trọng');

    // 6.4. Phạm vi gửi: toàn trường / khối / lớp
    assert.ok(
      adminTabSource.includes('renderTargetScopeLabel'),
      'Phải có hàm renderTargetScopeLabel diễn giải phạm vi gửi'
    );
    assert.ok(adminTabSource.includes('Toàn trường'), 'Hỗ trợ hiển thị nhãn Toàn trường');
    assert.ok(adminTabSource.includes('Khối'), 'Hỗ trợ hiển thị nhãn Khối');

    // 6.5. Trạng thái và lý do thu hồi
    assert.ok(adminTabSource.includes('item.is_recalled'), 'Hiển thị trạng thái đã thu hồi');
    assert.ok(adminTabSource.includes('item.recall_reason'), 'Hiển thị lý do thu hồi nếu có');

    // 6.6. Chưa hiển thị số học sinh đã đọc (chưa có API tổng hợp an toàn)
    assert.ok(
      !adminTabSource.includes('read_count') && !adminTabSource.includes('student_read_count'),
      'Chưa hiển thị thống kê số học sinh đã đọc khi chưa có API xác minh'
    );
  });

  // =========================================================================
  // SUITE 7: BẢO TOÀN TÍNH TOÀN VẸN CỦA CÁC MODULE KHÁC & BOOLEAN GUARDS
  // =========================================================================
  await t.test('Suite 7: Bảo toàn TeacherDashboard, Student Inbox & Boolean RPC Guards', () => {
    // 7.1. TeacherDashboard vẫn giữ nguyên tab của giáo viên
    assert.ok(
      teacherDashboardSource.includes('NotificationManagementTab'),
      'TeacherDashboard vẫn dùng NotificationManagementTab'
    );
    assert.ok(
      !teacherDashboardSource.includes('AdminNotificationManagementTab'),
      'TeacherDashboard tuyệt đối không chứa AdminNotificationManagementTab'
    );

    // 7.2. R3-FIX-01: publishNotification và recallNotification vẫn có Boolean Success Guard
    assert.match(
      notificationClientSource,
      /export\s+async\s+function\s+publishNotification[\s\S]*?if\s*\(data\s*===\s*true\)\s*\{\s*return\s*\{\s*ok:\s*true,\s*data:\s*true\s*\};\s*\}/,
      'publishNotification phải có data === true guard'
    );
    assert.match(
      notificationClientSource,
      /export\s+async\s+function\s+recallNotification[\s\S]*?if\s*\(data\s*===\s*true\)\s*\{\s*return\s*\{\s*ok:\s*true,\s*data:\s*true\s*\};\s*\}/,
      'recallNotification phải có data === true guard'
    );

    // 7.3. R3-FIX-02: markNotificationAsRead vẫn có Boolean Success Guard
    assert.match(
      notificationClientSource,
      /export\s+async\s+function\s+markNotificationAsRead[\s\S]*?if\s*\(data\s*===\s*true\)\s*\{\s*return\s*\{\s*ok:\s*true,\s*data:\s*true\s*\};\s*\}/,
      'markNotificationAsRead phải có data === true guard'
    );
  });
});
