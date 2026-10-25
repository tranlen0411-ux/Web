// tests/admin_notification_compose.test.mjs
// Unit tests cho Admin Compose & Save Draft (Notifications V1 R3-D2A)
// Kiểm tra AdminCreateNotificationModal, 3 phạm vi (Toàn trường, Theo khối, Theo lớp),
// All-or-Nothing, khóa cứng publishNow = false, chống double-submit, và Mock Service execution.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const modalSource = fs.readFileSync(
  'src/components/dashboard/notifications/AdminCreateNotificationModal.jsx',
  'utf8'
);
const adminTabSource = fs.readFileSync(
  'src/components/dashboard/notifications/AdminNotificationManagementTab.jsx',
  'utf8'
);
const teacherDashboardSource = fs.readFileSync('src/pages/TeacherDashboard.jsx', 'utf8');

test('=== NOTIFICATIONS V1 R3-D2A: ADMIN COMPOSE & SAVE DRAFT SUITE ===', async (t) => {
  // =========================================================================
  // SUITE 1: TÍCH HỢP NÚT SOẠN THÔNG BÁO VÀO TAB QUẢN TRỊ ADMIN
  // =========================================================================
  await t.test('Suite 1: Nút Soạn thông báo và tích hợp modal vào AdminNotificationManagementTab', () => {
    // 1.1. Import AdminCreateNotificationModal
    assert.ok(
      adminTabSource.includes("import { AdminCreateNotificationModal } from './AdminCreateNotificationModal.jsx'"),
      'AdminNotificationManagementTab phải import AdminCreateNotificationModal'
    );

    // 1.2. Nút Soạn thông báo tồn tại và mở modal
    assert.ok(
      adminTabSource.includes('setIsCreateModalOpen(true)'),
      'Nút Soạn thông báo phải kích hoạt setIsCreateModalOpen(true)'
    );
    assert.ok(
      adminTabSource.includes('Soạn thông báo'),
      'Phải có text nút "Soạn thông báo"'
    );

    // 1.3. Render modal kèm đầy đủ props
    assert.match(
      adminTabSource,
      /<AdminCreateNotificationModal[\s\S]*?isOpen=\{isCreateModalOpen\}[\s\S]*?onClose=\{[\s\S]*?\}[\s\S]*?classes=\{classes\}[\s\S]*?onDraftCreated=\{handleDraftCreated\}/,
      'Phải render AdminCreateNotificationModal với isOpen, onClose, classes và onDraftCreated'
    );

    // 1.4. Đóng modal và reset khi logout hoặc chuyển role
    assert.match(
      adminTabSource,
      /if\s*\(!user\s*\|\|\s*profile\?\.role\s*!==\s*['"]admin['"]\)\s*\{[\s\S]*?setIsCreateModalOpen\(false\);/,
      'Phải đóng modal khi user đăng xuất hoặc không phải admin'
    );
  });

  // =========================================================================
  // SUITE 2: HỢP ĐỒNG 3 PHẠM VI NGƯỜI NHẬN (TOÀN TRƯỜNG, THEO KHỐI, THEO LỚP)
  // =========================================================================
  await t.test('Suite 2: Hỗ trợ 3 phạm vi gửi (all, grade, classes) và xóa dữ liệu thừa khi chuyển đổi', () => {
    // 2.1. Hỗ trợ 3 loại targetType
    assert.ok(modalSource.includes("handleScopeTypeChange('all')"), 'Hỗ trợ phạm vi Toàn trường (all)');
    assert.ok(modalSource.includes("handleScopeTypeChange('grade')"), 'Hỗ trợ phạm vi Theo khối (grade)');
    assert.ok(modalSource.includes("handleScopeTypeChange('classes')"), 'Hỗ trợ phạm vi Theo lớp (classes)');

    // 2.2. Khi chọn 'all': Không truyền gradeLevel hoặc targetClassIds
    assert.match(
      modalSource,
      /if\s*\(targetType\s*===\s*['"]all['"]\)\s*\{[\s\S]*?payloadTargetType\s*=\s*['"]all['"];[\s\S]*?payloadGradeLevel\s*=\s*null;[\s\S]*?payloadClassIds\s*=\s*\[\];/,
      'Khi targetType="all", payloadGradeLevel phải là null và payloadClassIds là []'
    );

    // 2.3. Khi chọn 'grade': Chỉ chấp nhận khối từ 1 đến 5 theo hợp đồng backend
    assert.match(
      modalSource,
      /VALID_GRADE_LEVELS\s*=\s*\[1,\s*2,\s*3,\s*4,\s*5\]/,
      'Khối lớp hợp lệ phải là [1, 2, 3, 4, 5]'
    );
    assert.match(
      modalSource,
      /if\s*\(!VALID_GRADE_LEVELS\.includes\(g\)\)\s*\{[\s\S]*?setErrorMessage\([\s\S]*?Khối lớp[\s\S]*?\);[\s\S]*?return;/,
      'Phải từ chối khối lớp ngoài phạm vi 1 đến 5'
    );
    assert.match(
      modalSource,
      /payloadTargetType\s*=\s*['"]grade['"];[\s\S]*?payloadGradeLevel\s*=\s*g;[\s\S]*?payloadClassIds\s*=\s*\[\];/,
      'Khi targetType="grade", payloadClassIds phải là []'
    );

    // 2.4. Khi chọn 'classes': Yêu cầu chọn ít nhất 1 lớp và payloadGradeLevel là null
    assert.match(
      modalSource,
      /if\s*\(selectedClassIds\.length\s*===\s*0\)\s*\{[\s\S]*?setErrorMessage\([\s\S]*?ít nhất một lớp[\s\S]*?\);[\s\S]*?return;/,
      'Phải báo lỗi khi chọn scope classes mà danh sách lớp rỗng'
    );
    assert.match(
      modalSource,
      /payloadTargetType\s*=\s*['"]classes['"];[\s\S]*?payloadGradeLevel\s*=\s*null;[\s\S]*?payloadClassIds\s*=\s*selectedClassIds;/,
      'Khi targetType="classes", payloadGradeLevel phải là null'
    );

    // 2.5. Hàm handleScopeTypeChange dọn sạch dữ liệu không liên quan
    assert.match(
      modalSource,
      /if\s*\(newType\s*===\s*['"]all['"]\)\s*\{[\s\S]*?setTargetGradeLevel\(null\);[\s\S]*?setSelectedClassIds\(\[\]\);/,
      'handleScopeTypeChange("all") phải reset gradeLevel và selectedClassIds'
    );
    assert.match(
      modalSource,
      /else\s+if\s*\(newType\s*===\s*['"]grade['"]\)\s*\{[\s\S]*?setSelectedClassIds\(\[\]\);/,
      'handleScopeTypeChange("grade") phải reset selectedClassIds'
    );
    assert.match(
      modalSource,
      /else\s+if\s*\(newType\s*===\s*['"]classes['"]\)\s*\{[\s\S]*?setTargetGradeLevel\(null\);/,
      'handleScopeTypeChange("classes") phải reset targetGradeLevel'
    );
  });

  // =========================================================================
  // SUITE 3: NGUYÊN TẮC ALL-OR-NOTHING KHI CHỌN LỚP
  // =========================================================================
  await t.test('Suite 3: Nguyên tắc All-or-Nothing khi có bất kỳ lớp nào không hợp lệ', () => {
    // 3.1. Kiểm tra đối chiếu toàn bộ selectedClassIds với validClasses
    assert.match(
      modalSource,
      /const\s+validClassIdSet\s*=\s*new\s+Set\(validClasses\.map\([\s\S]*?\)\);/,
      'Phải tạo Set chứa danh sách ID lớp hợp lệ để kiểm tra nhanh'
    );
    assert.match(
      modalSource,
      /const\s+hasInvalidClass\s*=\s*selectedClassIds\.some\(\(id\)\s*=>\s*!validClassIdSet\.has\(id\)\);/,
      'Phải kiểm tra xem có bất kỳ lớp nào không nằm trong validClassIdSet không'
    );

    // 3.2. Nếu phát hiện lớp không hợp lệ, lập tức dừng toàn bộ (không lọc âm thầm)
    assert.match(
      modalSource,
      /if\s*\(hasInvalidClass\)\s*\{[\s\S]*?isSubmittingRef\.current\s*=\s*false;[\s\S]*?setErrorMessage\([\s\S]*?All-or-Nothing[\s\S]*?\);[\s\S]*?return;/,
      'Phải từ chối toàn bộ thao tác theo nguyên tắc All-or-Nothing nếu có lớp không hợp lệ'
    );

    // 3.3. Chặn chọn phạm vi lớp khi danh sách lớp chưa tải xong hoặc rỗng
    assert.match(
      modalSource,
      /if\s*\(validClasses\.length\s*===\s*0\)\s*\{[\s\S]*?setErrorMessage\([\s\S]*?Hệ thống chưa tải được danh sách lớp[\s\S]*?\);[\s\S]*?return;/,
      'Không cho phép xác nhận phạm vi lớp khi danh sách lớp rỗng'
    );
  });

  // =========================================================================
  // SUITE 4: KHÓA CỨNG PUBLISH_NOW = FALSE & CHỐNG DOUBLE-SUBMIT
  // =========================================================================
  await t.test('Suite 4: publishNow khóa cứng bằng false, chống double-submit và không tự retry', () => {
    // 4.1. publishNow = false khóa cứng trong lệnh gọi createNotification
    assert.match(
      modalSource,
      /publishNow:\s*false/,
      'Lệnh gọi createNotification phải có publishNow: false khóa cứng'
    );

    // 4.2. Tuyệt đối KHÔNG có nút Gửi ngay hoặc Xuất bản trong modal
    assert.ok(!modalSource.includes('Gửi ngay'), 'Modal tuyệt đối không có nút Gửi ngay');
    assert.ok(!modalSource.includes('Xuất bản ngay'), 'Modal tuyệt đối không có nút Xuất bản ngay');
    assert.ok(modalSource.includes('Lưu bản nháp'), 'Modal phải có nút Lưu bản nháp');

    // 4.3. Tuyệt đối KHÔNG gọi publishNotification, recallNotification hoặc deleteDraftNotification
    assert.ok(!modalSource.includes('publishNotification'), 'Không được gọi publishNotification');
    assert.ok(!modalSource.includes('recallNotification'), 'Không được gọi recallNotification');
    assert.ok(!modalSource.includes('deleteDraftNotification'), 'Không được gọi deleteDraftNotification');

    // 4.4. Chống double-submit đồng bộ bằng ref và React state
    assert.ok(
      modalSource.includes('isSubmittingRef.current = true'),
      'Phải bật cờ đồng bộ isSubmittingRef.current = true trước khi gọi API'
    );
    assert.ok(
      modalSource.includes('if (isSubmittingRef.current) return'),
      'Phải chặn ngay nếu isSubmittingRef.current đã bật'
    );
    assert.ok(
      modalSource.includes('if (isSaving) return'),
      'Phải chặn ngay nếu state isSaving đang true'
    );

    // 4.5. Không tự động retry khi lỗi
    assert.ok(!modalSource.includes('setTimeout(handleSaveDraft'), 'Tuyệt đối không tự động retry khi gặp lỗi');
  });

  // =========================================================================
  // SUITE 5: PHÂN QUYỀN ADMIN & CÁCH LY PHIÊN (AUTH ISOLATION)
  // =========================================================================
  await t.test('Suite 5: Bảo vệ vai trò admin, cách ly phiên và chống rò rỉ khi logout', () => {
    // 5.1. Chỉ Admin mới được submit
    assert.match(
      modalSource,
      /if\s*\(!user\s*\|\|\s*profile\?\.role\s*!==\s*['"]admin['"]\)\s*\{[\s\S]*?Quyền truy cập bị từ chối[\s\S]*?return;/,
      'Chỉ Admin đăng nhập hợp lệ mới được thực hiện lưu bản nháp'
    );

    // 5.2. Chống race-condition từ phản hồi cũ khi đổi user
    assert.ok(
      modalSource.includes('currentUserIdRef.current !== activeUserId'),
      'Phải đối chiếu currentUserIdRef với activeUserId khi có phản hồi RPC'
    );

    // 5.3. Giữ nguyên nội dung soạn thảo khi gặp lỗi mạng/timeout
    assert.match(
      modalSource,
      /if\s*\(!res\.ok\)\s*\{[\s\S]*?setErrorMessage\(/,
      'Khi API lỗi, chỉ hiển thị errorMessage mà không xóa title hoặc content'
    );

    // 5.4. Đóng modal khi user đăng xuất
    assert.match(
      modalSource,
      /if\s*\(!user\s*&&\s*isOpen\)\s*\{[\s\S]*?onClose\(\);/,
      'Khi user logout trong lúc modal mở, modal phải tự đóng'
    );
  });

  // =========================================================================
  // SUITE 6: MOCK SERVICE TEST - XÁC THỰC LỆNH GỌI CREATENOTIFICATION
  // =========================================================================
  await t.test('Suite 6: Mock service kiểm thử logic tạo bản nháp 3 phạm vi qua notificationClient', async () => {
    const { createNotification } = await import('../src/services/notificationClient.js');

    // Test 6.1: Admin tạo bản nháp Toàn trường (targetType = 'all')
    let calledRpc = null;
    let passedPayload = null;
    const mockClientAll = {
      rpc: async (fnName, payload) => {
        calledRpc = fnName;
        passedPayload = payload;
        return { data: 'notif-uuid-admin-all-123', error: null };
      }
    };

    const resAll = await createNotification(
      {
        title: 'Thông báo tựu trường',
        content: 'Chào mừng năm học mới toàn thể giáo viên và học sinh.',
        priority: 'urgent',
        category: 'general',
        targetType: 'all',
        targetGradeLevel: null,
        targetClassIds: [],
        publishNow: false
      },
      mockClientAll
    );

    assert.equal(resAll.ok, true, 'createNotification Toàn trường phải thành công');
    assert.equal(calledRpc, 'rpc_create_notification');
    assert.equal(passedPayload.p_target_type, 'all');
    assert.equal(passedPayload.p_target_grade_level, null);
    assert.deepEqual(passedPayload.p_target_class_ids, []);
    assert.equal(passedPayload.p_publish_now, false, 'publish_now bắt buộc false');

    // Test 6.2: Admin tạo bản nháp Theo Khối (targetType = 'grade')
    let passedGradePayload = null;
    const mockClientGrade = {
      rpc: async (fnName, payload) => {
        passedGradePayload = payload;
        return { data: 'notif-uuid-admin-grade-456', error: null };
      }
    };

    const resGrade = await createNotification(
      {
        title: 'Họp phụ huynh Khối 3',
        content: 'Kế hoạch tổ chức họp phụ huynh khối 3.',
        priority: 'high',
        category: 'general',
        targetType: 'grade',
        targetGradeLevel: 3,
        targetClassIds: [],
        publishNow: false
      },
      mockClientGrade
    );

    assert.equal(resGrade.ok, true, 'createNotification Theo khối phải thành công');
    assert.equal(passedGradePayload.p_target_type, 'grade');
    assert.equal(passedGradePayload.p_target_grade_level, 3);
    assert.deepEqual(passedGradePayload.p_target_class_ids, []);
    assert.equal(passedGradePayload.p_publish_now, false);

    // Test 6.3: Admin tạo bản nháp Theo Danh sách Lớp (targetType = 'classes')
    let passedClassesPayload = null;
    const mockClientClasses = {
      rpc: async (fnName, payload) => {
        passedClassesPayload = payload;
        return { data: 'notif-uuid-admin-classes-789', error: null };
      }
    };

    const classIds = ['class-uuid-1a', 'class-uuid-2b'];
    const resClasses = await createNotification(
      {
        title: 'Thông báo lớp 1A và 2B',
        content: 'Hoạt động trải nghiệm sáng tạo.',
        priority: 'normal',
        category: 'general',
        targetType: 'classes',
        targetGradeLevel: null,
        targetClassIds: classIds,
        publishNow: false
      },
      mockClientClasses
    );

    assert.equal(resClasses.ok, true, 'createNotification Theo lớp phải thành công');
    assert.equal(passedClassesPayload.p_target_type, 'classes');
    assert.equal(passedClassesPayload.p_target_grade_level, null);
    assert.deepEqual(passedClassesPayload.p_target_class_ids, classIds);
    assert.equal(passedClassesPayload.p_publish_now, false);
  });

  // =========================================================================
  // SUITE 7: BẢO TOÀN TÍNH TOÀN VẸN CỦA MODULE GIÁO VIÊN & HỌC SINH
  // =========================================================================
  await t.test('Suite 7: Không làm ảnh hưởng TeacherDashboard hoặc Học sinh', () => {
    // 7.1. TeacherDashboard vẫn dùng CreateNotificationModal của giáo viên
    assert.ok(
      !teacherDashboardSource.includes('AdminCreateNotificationModal'),
      'TeacherDashboard tuyệt đối không chứa AdminCreateNotificationModal'
    );
  });

  // =========================================================================
  // SUITE 8: CATEGORY & RECIPIENT SCOPE CONTRACT AUDIT
  // =========================================================================
  await t.test('Suite 8: Rà soát Category Contract và tính chính xác của nhãn phạm vi', () => {
    // 8.1. Admin Category chỉ sử dụng các giá trị hợp lệ theo backend constraint chk_notifications_category
    assert.ok(modalSource.includes('value="general"'), 'Hỗ trợ category general');
    assert.ok(modalSource.includes('value="system"'), 'Hỗ trợ category system');
    assert.ok(modalSource.includes('value="exam"'), 'Hỗ trợ category exam');
    assert.ok(modalSource.includes('value="exercise"'), 'Hỗ trợ category exercise');
    assert.ok(modalSource.includes('value="material"'), 'Hỗ trợ category material');
    assert.ok(!modalSource.includes('value="assignment"'), 'Tuyệt đối không chứa category assignment');

    // 8.2. Nhãn phạm vi người nhận toàn trường khớp chính xác với SQL trigger (chỉ student và teacher active, loại trừ caller)
    assert.ok(
      modalSource.includes('Tất cả Giáo viên & Học sinh'),
      'Mô tả toàn trường phải nêu rõ đối tượng nhận gồm Giáo viên và Học sinh theo SQL'
    );

    // 8.3. Không suy đoán số lượng người nhận
    assert.ok(
      !modalSource.includes('tổng số người nhận:') && !modalSource.includes('ước tính người nhận:'),
      'Không suy đoán tổng số người nhận khi chưa có API xác minh'
    );
  });
});
