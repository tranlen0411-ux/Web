// tests/teacher_notification_compose.test.mjs
// Unit tests cho Teacher Compose & Save Draft Modal (Notifications V1 R3-C2A)
// Kiểm tra hợp đồng RPC, giới hạn lớp phụ trách, publish_now=false, chống double-submit, Auth isolation & Accessibility

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const modalSource = fs.readFileSync(
  'src/components/dashboard/notifications/CreateNotificationModal.jsx',
  'utf8'
);
const managementTabSource = fs.readFileSync(
  'src/components/dashboard/notifications/NotificationManagementTab.jsx',
  'utf8'
);
const teacherDashboardSource = fs.readFileSync('src/pages/TeacherDashboard.jsx', 'utf8');

test('=== NOTIFICATIONS V1 R3-C2A: TEACHER COMPOSE & SAVE DRAFT SUITE ===', async (t) => {

  // =========================================================================
  // SUITE 1: TÍCH HỢP GIAO DIỆN & NÚT SOẠN THÔNG BÁO VÀO MANAGEMENT TAB
  // =========================================================================
  await t.test('Suite 1: Tích hợp nút Soạn Thông Báo và Modal vào NotificationManagementTab', () => {
    // 1.1. Import CreateNotificationModal
    assert.ok(
      managementTabSource.includes("import { CreateNotificationModal } from './CreateNotificationModal.jsx';") ||
      managementTabSource.includes('CreateNotificationModal'),
      'NotificationManagementTab phải import CreateNotificationModal'
    );

    // 1.2. Có state mở/đóng modal
    assert.match(
      managementTabSource,
      /const\s*\[isCreateModalOpen,\s*setIsCreateModalOpen\]\s*=\s*useState\(false\)/,
      'NotificationManagementTab phải có state isCreateModalOpen'
    );

    // 1.3. Có nút bấm "Soạn Thông Báo" mở modal
    assert.match(
      managementTabSource,
      /onClick=\{\(\)\s*=>\s*setIsCreateModalOpen\(true\)\}/,
      'Phải có nút bấm kích hoạt setIsCreateModalOpen(true)'
    );

    // 1.4. Render <CreateNotificationModal> với đầy đủ props
    assert.match(
      managementTabSource,
      /<CreateNotificationModal[\s\S]*?isOpen=\{isCreateModalOpen\}[\s\S]*?onClose=\{[\s\S]*?\}[\s\S]*?classes=\{classes\}[\s\S]*?onDraftCreated=\{handleDraftCreated\}[\s\S]*?\/>/,
      'Phải render CreateNotificationModal với isOpen, onClose, classes và onDraftCreated'
    );

    // 1.5. Có Toast thông báo thành công sau khi lưu bản nháp
    assert.match(
      managementTabSource,
      /setToastMessage\(['"]Đã lưu bản nháp thông báo thành công!['"]\)/,
      'Callback onDraftCreated phải hiển thị thông báo đã lưu bản nháp'
    );

    // 1.6. Làm mới danh sách và chuyển trang về 1 sau khi lưu bản nháp
    assert.match(
      managementTabSource,
      /setCurrentPage\(1\);[\s\S]*?fetchSentNotifications\(1,/,
      'Phải làm mới danh sách trang 1 sau khi lưu bản nháp'
    );
  });

  // =========================================================================
  // SUITE 2: HỢP ĐỒNG RPC & GIÁ TRỊ PUBLISH_NOW = FALSE BẮT BUỘC
  // =========================================================================
  await t.test('Suite 2: Hợp đồng RPC, publish_now = false bắt buộc, không có chức năng gửi ngay', () => {
    // 2.1. Phải import createNotification từ notificationClient
    assert.match(
      modalSource,
      /import\s*\{[^}]*createNotification[^}]*\}\s*from\s*['"][^'"]*notificationClient(\.js)?['"]/,
      'Modal phải import createNotification từ notificationClient'
    );

    // 2.2. Payload publishNow bắt buộc là false
    assert.match(
      modalSource,
      /publishNow:\s*false/,
      'Payload RPC createNotification phải có publishNow: false bắt buộc'
    );

    // 2.3. Payload targetType bắt buộc là classes
    assert.match(
      modalSource,
      /targetType:\s*['"]classes['"]/,
      'Payload RPC createNotification phải có targetType: "classes"'
    );

    // 2.4. Tuyệt đối KHÔNG có nút Gửi Ngay / Xuất Bản
    assert.ok(
      !modalSource.includes('Gửi ngay') && !modalSource.includes('Xuất bản ngay'),
      'R3-C2A: Tuyệt đối không có nút Gửi ngay hoặc Xuất bản ngay'
    );

    // 2.5. Tuyệt đối KHÔNG gọi publishNotification
    assert.ok(
      !modalSource.includes('publishNotification'),
      'R3-C2A: Tuyệt đối không được gọi publishNotification'
    );

    // 2.6. Tuyệt đối KHÔNG gọi recallNotification
    assert.ok(
      !modalSource.includes('recallNotification'),
      'R3-C2A: Tuyệt đối không được gọi recallNotification'
    );

    // 2.7. Tuyệt đối KHÔNG gọi deleteDraftNotification
    assert.ok(
      !modalSource.includes('deleteDraftNotification'),
      'R3-C2A: Tuyệt đối không được gọi deleteDraftNotification'
    );
  });

  // =========================================================================
  // SUITE 3: PHẠM VI LỚP HỌC (CLASS BOUNDARY) & KHÔNG GỬI NGOÀI LỚP PHỤ TRÁCH
  // =========================================================================
  await t.test('Suite 3: Phạm vi lớp học thực tế, chỉ gửi lớp phụ trách, không có all/grade', () => {
    // 3.1. Tuyệt đối KHÔNG cho phép chọn 'all' (toàn trường)
    assert.ok(
      !modalSource.includes("targetType: 'all'") && !modalSource.includes('targetType === "all"'),
      'Teacher không được chọn targetType all'
    );

    // 3.2. Tuyệt đối KHÔNG cho phép chọn 'grade' (toàn khối)
    assert.ok(
      !modalSource.includes("targetType: 'grade'") && !modalSource.includes('targetType === "grade"'),
      'Teacher không được chọn targetType grade'
    );

    // 3.3. Hiển thị cảnh báo và vô hiệu hóa nút Lưu nếu không có lớp phân công
    assert.match(
      modalSource,
      /!hasClasses/,
      'Modal phải kiểm tra hasClasses để hiển thị cảnh báo khi chưa có lớp'
    );
    assert.match(
      modalSource,
      /disabled=\{isSaving\s*\|\|\s*!hasClasses\}/,
      'Nút Lưu Bản Nháp phải bị disable nếu chưa có lớp phân công'
    );

    // 3.4. Lọc an toàn ID lớp chỉ nằm trong danh sách classes prop
    assert.match(
      modalSource,
      /const\s+safeSelectedClassIds\s*=\s*selectedClassIds\.filter/,
      'Modal phải lọc selectedClassIds qua whitelist của classes được phân công'
    );

    // 3.5. Bắt buộc chọn ít nhất 1 lớp
    assert.match(
      modalSource,
      /selectedClassIds\.length\s*===\s*0/,
      'Phải kiểm tra và bắt lỗi khi chưa chọn lớp học nào'
    );
  });

  // =========================================================================
  // SUITE 4: VALIDATION ĐẦU VÀO & GIỚI HẠN BACKEND
  // =========================================================================
  await t.test('Suite 4: Kiểm tra tính hợp lệ tiêu đề, nội dung và các trường dữ liệu', () => {
    // 4.1. Validate tiêu đề rỗng sau khi trim
    assert.match(
      modalSource,
      /const\s+trimmedTitle\s*=\s*title\.trim\(\);/,
      'Tiêu đề phải được trim trước khi validate và gửi'
    );
    assert.match(
      modalSource,
      /if\s*\(!trimmedTitle\)/,
      'Phải từ chối khi tiêu đề rỗng'
    );

    // 4.2. Giới hạn độ dài tiêu đề <= 200 ký tự
    assert.match(
      modalSource,
      /trimmedTitle\.length\s*>\s*200/,
      'Tiêu đề không được vượt quá 200 ký tự'
    );

    // 4.3. Validate nội dung rỗng sau khi trim
    assert.match(
      modalSource,
      /const\s+trimmedContent\s*=\s*content\.trim\(\);/,
      'Nội dung phải được trim trước khi validate và gửi'
    );
    assert.match(
      modalSource,
      /if\s*\(!trimmedContent\)/,
      'Phải từ chối khi nội dung rỗng'
    );

    // 4.4. Giới hạn độ dài nội dung <= 5000 ký tự
    assert.match(
      modalSource,
      /trimmedContent\.length\s*>\s*5000/,
      'Nội dung không được vượt quá 5000 ký tự'
    );

    // 4.5. Hỗ trợ 3 mức độ ưu tiên: normal, high, urgent
    assert.ok(modalSource.includes("'normal'"), 'Hỗ trợ priority normal');
    assert.ok(modalSource.includes("'high'"), 'Hỗ trợ priority high');
    assert.ok(modalSource.includes("'urgent'"), 'Hỗ trợ priority urgent');

    // 4.6. Hỗ trợ 3 category hợp lệ theo backend (general, exercise, exam) và TUYỆT ĐỐI KHÔNG chứa assignment
    assert.ok(modalSource.includes('value="general"'), 'Hỗ trợ category general');
    assert.ok(modalSource.includes('value="exercise"'), 'Hỗ trợ category exercise (Bài tập về nhà)');
    assert.ok(modalSource.includes('value="exam"'), 'Hỗ trợ category exam');
    assert.ok(!modalSource.includes('value="assignment"'), 'Tuyệt đối không chứa category assignment trái với backend constraint');
  });

  // =========================================================================
  // SUITE 5: BẢO VỆ CHỐNG DOUBLE-SUBMIT, AUTO-RETRY & BẢO TOÀN DỮ LIỆU
  // =========================================================================
  await t.test('Suite 5: Chống double-submit, không tự ý retry và bảo toàn nội dung khi lỗi', () => {
    // 5.1. Chặn submit khi isSaving = true
    assert.match(
      modalSource,
      /if\s*\(isSaving\)\s*return;?/,
      'Phải thoát ngay nếu isSaving đang true để chống double-submit'
    );

    // 5.2. Nút Lưu Bản Nháp hiển thị spinner khi isSaving
    assert.match(
      modalSource,
      /isSaving\s*\?[\s\S]*?Đang lưu bản nháp/i,
      'Nút lưu phải hiển thị trạng thái đang lưu khi isSaving = true'
    );

    // 5.3. Khi có lỗi từ server, KHÔNG tự động retry và KHÔNG đóng modal
    assert.match(
      modalSource,
      /if\s*\(!res\.ok\)\s*\{[\s\S]*?setIsSaving\(false\);[\s\S]*?setErrorMessage/,
      'Khi lỗi, phải tắt isSaving và đặt errorMessage mà không đóng modal'
    );

    // 5.4. Không xóa tiêu đề và nội dung khi lỗi để Thầy/Cô không mất dữ liệu
    assert.ok(
      !modalSource.includes("if (!res.ok) { setTitle(''); }"),
      'Không được xóa tiêu đề khi RPC trả về lỗi'
    );
  });

  // =========================================================================
  // SUITE 6: AUTH ISOLATION, ROLE GUARD & ACCESSIBILITY
  // =========================================================================
  await t.test('Suite 6: Cách ly tài khoản, kiểm tra vai trò teacher, Escape & Accessibility', () => {
    // 6.1. Kiểm tra vai trò teacher
    assert.match(
      modalSource,
      /profile\?\.role\s*!==\s*['"]teacher['"]/,
      'Modal phải kiểm tra vai trò profile.role === "teacher"'
    );

    // 6.2. Race condition check khi user đổi tài khoản hoặc đăng xuất
    assert.match(
      modalSource,
      /currentUserIdRef\.current\s*!==\s*activeUserId/,
      'Phải kiểm tra currentUserIdRef để tránh race condition khi chuyển đổi tài khoản'
    );

    // 6.3. Tự động đóng modal nếu user đăng xuất
    assert.match(
      modalSource,
      /if\s*\(!user\s*&&\s*isOpen\)\s*\{\s*onClose\(\);?\s*\}/,
      'Modal phải tự đóng nếu người dùng đăng xuất trong khi modal mở'
    );

    // 6.4. Hỗ trợ phím Escape để đóng modal khi không bận lưu
    assert.match(
      modalSource,
      /e\.key\s*===\s*['"]Escape['"]\s*&&\s*isOpen\s*&&\s*!isSaving/,
      'Phải hỗ trợ đóng modal bằng phím Escape'
    );

    // 6.5. Đầy đủ thuộc tính Accessibility: role="dialog", aria-modal="true", aria-labelledby
    assert.ok(modalSource.includes('role="dialog"'), 'Có thuộc tính role="dialog"');
    assert.ok(modalSource.includes('aria-modal="true"'), 'Có thuộc tính aria-modal="true"');
    assert.ok(modalSource.includes('aria-labelledby='), 'Có thuộc tính aria-labelledby');

    // 6.6. TeacherDashboard có role guard ngăn chặn Admin
    assert.match(
      teacherDashboardSource,
      /profile\s*&&\s*profile\.role\s*!==\s*['"]teacher['"]/,
      'TeacherDashboard phải có role guard chặn Admin truy cập trái phép'
    );
  });

});
