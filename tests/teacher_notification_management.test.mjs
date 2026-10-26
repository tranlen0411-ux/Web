// tests/teacher_notification_management.test.mjs
// Unit tests cho Teacher Notification Management Tab (R3-C1 - READ ONLY UI)
// Kiểm tra ranh giới bảo mật, lọc trạng thái Draft/Published/Recalled, Pagination, Auth Isolation & Zero Mutation

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const managementTabSource = fs.readFileSync(
  'src/components/dashboard/notifications/NotificationManagementTab.jsx',
  'utf8'
);
const teacherDashboardSource = fs.readFileSync('src/pages/TeacherDashboard.jsx', 'utf8');

test('=== NOTIFICATIONS V1 R3-C1: TEACHER NOTIFICATION MANAGEMENT SUITE ===', async (t) => {

  // =========================================================================
  // SUITE 1: TÍCH HỢP TAB THÔNG BÁO VÀO TEACHER DASHBOARD
  // =========================================================================
  await t.test('Suite 1: Tích hợp Tab Thông Báo Lớp Học và đồng bộ URL query param', () => {
    // 1.1. Import component NotificationManagementTab
    assert.ok(
      teacherDashboardSource.includes("import { NotificationManagementTab } from '../components/dashboard/notifications/NotificationManagementTab'"),
      'TeacherDashboard phải import NotificationManagementTab'
    );

    // 1.2. Hỗ trợ query param ?tab=notifications trong activeTab khởi tạo
    assert.match(
      teacherDashboardSource,
      /if\s*\(tabParam\s*===\s*['"]notifications['"]\)\s*return\s*['"]notifications['"]/,
      'activeTab phải khởi tạo đúng khi tabParam === "notifications"'
    );

    // 1.3. Đồng bộ query param trong useEffect
    assert.match(
      teacherDashboardSource,
      /tab\s*===\s*['"]notifications['"]/,
      'useEffect phải kiểm tra tab === "notifications" để set activeTab'
    );

    // 1.4. Nút tab "Thông Báo Lớp Học" tồn tại và gắn setSearchParams({ tab: 'notifications' })
    assert.match(
      teacherDashboardSource,
      /setSearchParams\(\{\s*tab:\s*['"]notifications['"]\s*\}\s*,\s*\{\s*replace:\s*true\s*\}\)/,
      'Nút tab phải đồng bộ query param tab=notifications khi click'
    );

    // 1.5. Render NotificationManagementTab khi activeTab === 'notifications'
    assert.match(
      teacherDashboardSource,
      /\{activeTab\s*===\s*['"]notifications['"]\s*&&\s*\(\s*<NotificationManagementTab\s+role="teacher"/,
      'Phải render NotificationManagementTab khi activeTab là notifications'
    );

    // 1.6. Bảo toàn các tab cũ (classes, games, academic-assignments, question-bank, exams)
    assert.ok(teacherDashboardSource.includes("activeTab === 'classes'"), 'Tab classes phải giữ nguyên');
    assert.ok(teacherDashboardSource.includes("activeTab === 'games'"), 'Tab games phải giữ nguyên');
    assert.ok(teacherDashboardSource.includes("activeTab === 'academic-assignments'"), 'Tab academic-assignments phải giữ nguyên');
    assert.ok(teacherDashboardSource.includes("activeTab === 'question-bank'"), 'Tab question-bank phải giữ nguyên');
    assert.ok(teacherDashboardSource.includes("activeTab === 'exams'"), 'Tab exams phải giữ nguyên');
  });

  // =========================================================================
  // SUITE 2: CHỈ SỬ DỤNG API ĐỌC & TUYỆT ĐỐI KHÔNG GỌI MUTATION (READ ONLY)
  // =========================================================================
  await t.test('Suite 2: R3-C1 Thực thi READ-ONLY tuyệt đối, không gọi hàm ghi dữ liệu', () => {
    // 2.1. Phải import và gọi getSentNotifications
    assert.ok(
      managementTabSource.includes('getSentNotifications'),
      'ManagementTab phải sử dụng getSentNotifications từ service'
    );

    // 2.2. Tuyệt đối KHÔNG gọi createNotification
    assert.ok(
      !managementTabSource.includes('createNotification'),
      'R3-C1: Tuyệt đối không được gọi createNotification'
    );

    // 2.3. Tuyệt đối KHÔNG gọi publishNotification
    assert.ok(
      !managementTabSource.includes('publishNotification'),
      'R3-C1: Tuyệt đối không được gọi publishNotification'
    );

    // 2.4. Tuyệt đối KHÔNG gọi recallNotification
    assert.ok(
      !managementTabSource.includes('recallNotification'),
      'R3-C1: Tuyệt đối không được gọi recallNotification'
    );

    // 2.5. Tuyệt đối KHÔNG gọi deleteDraftNotification
    assert.ok(
      !managementTabSource.includes('deleteDraftNotification'),
      'R3-C1: Tuyệt đối không được gọi deleteDraftNotification'
    );

    // 2.6. Tuyệt đối KHÔNG tự tạo Supabase client mới
    assert.ok(
      !managementTabSource.includes('createClient('),
      'Tuyệt đối không tự ý tạo createClient mới'
    );
  });

  // =========================================================================
  // SUITE 3: PHÂN BIỆT 3 TRẠNG THÁI VÀ BỘ LỌC DRAFT / PUBLISHED / RECALLED
  // =========================================================================
  await t.test('Suite 3: Phân biệt chính xác 3 trạng thái và bộ lọc tương ứng', () => {
    // 3.1. Phân biệt trạng thái Bản nháp (is_published === false)
    assert.match(
      managementTabSource,
      /isDraft\s*=\s*!item\.is_published/,
      'Bản nháp phải được xác định qua !item.is_published'
    );

    // 3.2. Phân biệt trạng thái Đã thu hồi (item.is_recalled === true)
    assert.match(
      managementTabSource,
      /isRecalled\s*=\s*Boolean\(item\.is_recalled\)/,
      'Đã thu hồi phải được xác định qua item.is_recalled'
    );

    // 3.3. Phân biệt trạng thái Đã phát hành (item.is_published && !isRecalled)
    assert.match(
      managementTabSource,
      /isPublished\s*=\s*item\.is_published\s*&&\s*!isRecalled/,
      'Đã phát hành phải là is_published && !isRecalled'
    );

    // 3.4. Có 4 nút lọc trạng thái: all, published, draft, recalled
    assert.ok(managementTabSource.includes("handleFilterChange('all')"), 'Có bộ lọc tất cả');
    assert.ok(managementTabSource.includes("handleFilterChange('published')"), 'Có bộ lọc đã gửi');
    assert.ok(managementTabSource.includes("handleFilterChange('draft')"), 'Có bộ lọc bản nháp');
    assert.ok(managementTabSource.includes("handleFilterChange('recalled')"), 'Có bộ lọc đã thu hồi');

    // 3.5. Khi đổi filter, reset currentPage về 1
    assert.match(
      managementTabSource,
      /const\s+handleFilterChange\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?setCurrentPage\(1\);?[\s\S]*?\}/,
      'Khi đổi bộ lọc trạng thái phải reset currentPage về 1'
    );
  });

  // =========================================================================
  // SUITE 4: PHÂN TRANG (PAGINATION) VÀ THỨ TỰ ỔN ĐỊNH
  // =========================================================================
  await t.test('Suite 4: Cấu hình phân trang 20 bản ghi mỗi lượt & Thứ tự ổn định', () => {
    // 4.1. PAGE_SIZE = 20
    assert.match(
      managementTabSource,
      /PAGE_SIZE\s*=\s*20/,
      'Kích thước phân trang phải là 20 bản ghi'
    );

    // 4.2. Tính toán offset từ currentPage
    assert.match(
      managementTabSource,
      /offset\s*=\s*\(pageToLoad\s*-\s*1\)\s*\*\s*PAGE_SIZE/,
      'Offset phân trang phải tính từ (currentPage - 1) * PAGE_SIZE'
    );

    // 4.3. Có nút Trang trước và Trang sau có disable an toàn
    assert.match(
      managementTabSource,
      /disabled=\{currentPage\s*<=\s*1/,
      'Nút trang trước phải disable khi currentPage <= 1'
    );
    assert.match(
      managementTabSource,
      /disabled=\{currentPage\s*>=\s*totalPages/,
      'Nút trang sau phải disable khi currentPage >= totalPages'
    );
  });

  // =========================================================================
  // SUITE 5: AUTH ISOLATION & AN TOÀN DỮ LIỆU
  // =========================================================================
  await t.test('Suite 5: Bảo vệ vai trò, cách ly tài khoản khi đăng xuất / chuyển user', () => {
    // 5.1. Chỉ tải dữ liệu khi role là teacher hoặc admin
    assert.match(
      managementTabSource,
      /profile\?\.role\s*!==\s*['"]teacher['"]\s*&&\s*profile\?\.role\s*!==\s*['"]admin['"]/,
      'Chỉ cho phép role teacher hoặc admin tải dữ liệu quản lý'
    );

    // 5.2. Chặn Stale Response qua currentRequestId và currentUserIdRef
    assert.match(
      managementTabSource,
      /currentRequestId\s*!==\s*activeRequestIdRef\.current/,
      'Phải chặn kết quả của request cũ ghi đè request mới'
    );
    assert.match(
      managementTabSource,
      /currentUserIdRef\.current\s*!==\s*activeUserId/,
      'Phải chặn dữ liệu tài khoản cũ ghi đè tài khoản mới khi đổi user'
    );

    // 5.3. Reset toàn bộ state khi đăng xuất (!user)
    assert.match(
      managementTabSource,
      /if\s*\(!user\)\s*\{\s*setNotifications\(\[\]\);\s*setTotalCount\(0\);/,
      'Phải reset toàn bộ danh sách khi người dùng đăng xuất'
    );

    // 5.4. Chống XSS: Tuyệt đối không dùng dangerouslySetInnerHTML
    assert.ok(
      !managementTabSource.includes('dangerouslySetInnerHTML'),
      'ManagementTab tuyệt đối không dùng dangerouslySetInnerHTML'
    );
  });

});
