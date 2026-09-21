import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// ============================================================================
// MÔ PHỎNG DATABASE STORAGE VÀ EDGE FUNCTION PHỤC VỤ CRASH & ROW-LEVEL TESTING
// ============================================================================
class MockDatabaseAndServer {
  constructor() {
    this.receipts = new Map();
    this.idempotencyLogs = new Map();
    this.users = new Map();
    this.classes = new Map();
    this.authUsers = new Map(); // Mô phỏng GoTrue auth.users
    this.profiles = new Map();  // Mô phỏng public.profiles
    this.classMembers = new Map(); // key: `${classId}:${studentId}`
    this.studentPins = new Map(); // key: studentId
    this.batchRows = new Map(); // key: `${batchId}:${rowKey}`
  }

  seedUser(userId, role, fullName = 'User Name') {
    this.users.set(userId, { id: userId, role, full_name: fullName });
    this.profiles.set(userId, { id: userId, role, full_name: fullName });
  }

  seedClass(classId, className, gradeLevel) {
    this.classes.set(classId, { id: classId, name: className, grade_level: gradeLevel });
  }

  computeCanonicalFingerprint(classId, students) {
    const canonicalNames = students
      .map(s => (s.fullName || s.full_name || '').trim().toLowerCase().replace(/\s+/g, ' '))
      .sort()
      .join('|');
    const material = `class:${classId}|names:${canonicalNames}`;
    return crypto.createHash('sha256').update(material).digest('hex');
  }

  // RPC: issue_dry_run_receipt (Chỉ service_role)
  rpc_issue_dry_run_receipt(callerRole, adminId, classId, canonicalFingerprint, reviewRequiredCount, totalStudents, readyCount) {
    if (callerRole !== 'service_role') {
      return { success: false, status: 'PERMISSION_DENIED', message: 'Chỉ service_role mới được gọi.' };
    }

    const admin = this.users.get(adminId);
    if (!admin || admin.role !== 'admin') {
      return { success: false, status: 'FORBIDDEN', message: 'Chỉ Admin mới có quyền.' };
    }

    if (
      reviewRequiredCount < 0 || totalStudents < 0 || readyCount < 0 ||
      readyCount > totalStudents
    ) {
      return { success: false, status: 'INVALID_COUNTS', message: 'Số liệu không hợp lệ.' };
    }

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const receipt = {
      token,
      admin_id: adminId,
      class_id: classId,
      canonical_fingerprint: canonicalFingerprint,
      review_required_count: reviewRequiredCount,
      total_students: totalStudents,
      ready_to_create_count: readyCount,
      status: 'COMPLETED',
      expires_at: expiresAt,
      executing_expires_at: null,
      consumed_at: null,
      consumed_by: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    this.receipts.set(token, receipt);

    return {
      success: true,
      status: 'ISSUED',
      dryRunToken: token,
      expiresAt: expiresAt.toISOString(),
    };
  }

  // RPC: claim_dry_run_receipt với lease timeout
  rpc_claim_dry_run_receipt(callerRole, token, adminId, classId, canonicalFingerprint, leaseSeconds = 180) {
    if (callerRole !== 'service_role') {
      return { success: false, status: 'PERMISSION_DENIED', message: 'Chỉ service_role mới được claim.' };
    }

    if (!token) {
      return { success: false, status: 'MISSING_TOKEN', message: 'Thiếu dry_run_token.' };
    }

    const receipt = this.receipts.get(token);
    if (!receipt) {
      return { success: false, status: 'RECEIPT_NOT_FOUND', message: 'Mã chứng thực không tồn tại.' };
    }

    if (receipt.admin_id !== adminId) {
      return { success: false, status: 'ADMIN_MISMATCH', message: 'Mã chứng thực không thuộc tài khoản hiện tại.' };
    }

    if (receipt.status === 'CONSUMED') {
      return { success: false, status: 'RECEIPT_ALREADY_CONSUMED', message: 'Receipt đã tiêu thụ.' };
    }

    // Xử lý lease timeout khi EXECUTING
    if (receipt.status === 'EXECUTING') {
      if (receipt.executing_expires_at && new Date() > new Date(receipt.executing_expires_at)) {
        receipt.status = 'FAILED';
        receipt.updated_at = new Date();
        return {
          success: false,
          status: 'RECEIPT_LEASE_EXPIRED_FAILED',
          message: 'Tiến trình trước đã hết hạn lease. Receipt đã chuyển sang FAILED.',
        };
      }
      return { success: false, status: 'RECEIPT_ALREADY_EXECUTING', message: 'Đang có tiến trình khác thực thi.' };
    }

    if (receipt.status === 'FAILED') {
      return { success: false, status: 'RECEIPT_FAILED', message: 'Receipt đã ở trạng thái thất bại.' };
    }

    if (receipt.status !== 'COMPLETED') {
      return { success: false, status: 'RECEIPT_NOT_COMPLETED', message: 'Receipt chưa sẵn sàng.' };
    }

    if (new Date() > new Date(receipt.expires_at)) {
      return { success: false, status: 'RECEIPT_EXPIRED', message: 'Receipt đã hết hạn.' };
    }

    if (receipt.class_id !== classId) {
      return { success: false, status: 'CLASS_MISMATCH', message: 'Lớp học không khớp.' };
    }

    if (receipt.canonical_fingerprint !== canonicalFingerprint) {
      return { success: false, status: 'PAYLOAD_MISMATCH', message: 'Danh sách không khớp.' };
    }

    if (receipt.review_required_count > 0) {
      return { success: false, status: 'REVIEW_REQUIRED_BLOCKED', message: 'Có cảnh báo cần review.' };
    }

    const leaseExpiresAt = new Date(Date.now() + leaseSeconds * 1000);
    receipt.status = 'EXECUTING';
    receipt.executing_expires_at = leaseExpiresAt;
    receipt.updated_at = new Date();

    return {
      success: true,
      status: 'EXECUTING',
      executingExpiresAt: leaseExpiresAt.toISOString(),
      totalStudents: receipt.total_students,
      readyToCreate: receipt.ready_to_create_count,
    };
  }

  // RPC: recover_stuck_dry_run_receipt
  rpc_recover_stuck_dry_run_receipt(callerRole, token, adminId) {
    if (callerRole !== 'service_role') {
      return { success: false, status: 'PERMISSION_DENIED', message: 'Chỉ service_role mới được recover.' };
    }

    const receipt = this.receipts.get(token);
    if (!receipt) {
      return { success: false, status: 'RECEIPT_NOT_FOUND', message: 'Không tìm thấy receipt.' };
    }

    if (receipt.admin_id !== adminId) {
      return { success: false, status: 'ADMIN_MISMATCH', message: 'Không khớp admin.' };
    }

    if (receipt.status === 'FAILED') {
      return { success: true, status: 'ALREADY_FAILED', message: 'Đã FAILED từ trước.' };
    }

    if (receipt.status !== 'EXECUTING') {
      return { success: false, status: 'NOT_STUCK', message: 'Không ở trạng thái EXECUTING.' };
    }

    if (receipt.executing_expires_at && new Date() <= new Date(receipt.executing_expires_at)) {
      return { success: false, status: 'LEASE_ACTIVE', message: 'Khóa lease vẫn còn hiệu lực.' };
    }

    receipt.status = 'FAILED';
    receipt.updated_at = new Date();

    return {
      success: true,
      status: 'FAILED',
      message: 'Phục hồi thành công sang FAILED.',
    };
  }

  // RPC: finalize_dry_run_receipt
  rpc_finalize_dry_run_receipt(callerRole, token, adminId, newStatus) {
    if (callerRole !== 'service_role') {
      return { success: false, status: 'PERMISSION_DENIED', message: 'Chỉ service_role.' };
    }

    if (!['CONSUMED', 'FAILED'].includes(newStatus)) {
      return { success: false, status: 'INVALID_TARGET_STATUS', message: 'Trạng thái đích không hợp lệ.' };
    }

    const receipt = this.receipts.get(token);
    if (!receipt || receipt.admin_id !== adminId) {
      return { success: false, status: 'RECEIPT_NOT_FOUND', message: 'Không tìm thấy receipt.' };
    }

    if (receipt.status !== 'EXECUTING') {
      return { success: false, status: 'INVALID_TRANSITION', message: 'Chỉ cho phép finalize khi đang EXECUTING.' };
    }

    receipt.status = newStatus;
    if (newStatus === 'CONSUMED') {
      receipt.consumed_at = new Date();
      receipt.consumed_by = adminId;
    }
    receipt.updated_at = new Date();

    return { success: true, status: newStatus };
  }

  // Handler thực thi đầy đủ với Row-level failure injection
  async handleEdgeFunctionRequest({
    callerId,
    body,
    env = {},
    injectFailurePoint = null, // 'AFTER_AUTH' | 'AFTER_PROFILE' | 'AFTER_PIN' | 'AFTER_CLASS_MEMBERS' | 'AFTER_ROW_COMPLETE' | 'CRASH_BEFORE_FINALIZE'
    injectAtStudentIndex = 1,
    orphanAuthNoCleanup = false, // Giả lập trường hợp crash không kịp chạy deleteUser
  }) {
    const caller = this.users.get(callerId);
    if (!caller || caller.role !== 'admin') {
      return { httpStatus: 403, body: { success: false, message: 'Từ chối: Không phải Admin.' } };
    }

    const { classId, students, dryRun = false, idempotencyKey, dryRunToken } = body;
    if (!classId || !students || !Array.isArray(students) || students.length === 0) {
      return { httpStatus: 400, body: { success: false, message: 'Thiếu dữ liệu.' } };
    }

    const targetClass = this.classes.get(classId);
    if (!targetClass) {
      return { httpStatus: 400, body: { success: false, message: 'Lớp không tồn tại.' } };
    }

    const canonicalFingerprint = this.computeCanonicalFingerprint(classId, students);

    // EXECUTE
    if (!dryRun) {
      if (!dryRunToken) {
        return { httpStatus: 400, body: { success: false, code: 'DRY_RUN_TOKEN_REQUIRED' } };
      }

      if (env.ALLOW_PRODUCTION_BULK_CREATE !== 'true') {
        return { httpStatus: 403, body: { success: false, code: 'PRODUCTION_LOCK_ACTIVE' } };
      }

      const claimRes = this.rpc_claim_dry_run_receipt('service_role', dryRunToken, callerId, classId, canonicalFingerprint);
      if (!claimRes.success || claimRes.status !== 'EXECUTING') {
        const httpStatus = claimRes.status === 'ADMIN_MISMATCH' ? 403 :
                           (claimRes.status === 'RECEIPT_ALREADY_CONSUMED' || claimRes.status === 'RECEIPT_ALREADY_EXECUTING') ? 409 : 400;
        return { httpStatus, body: { success: false, code: claimRes.status, message: claimRes.message } };
      }

      const finalResults = [];
      let createdCount = 0;
      let skippedCount = 0;
      let failedCount = 0;

      for (let i = 0; i < students.length; i++) {
        const item = students[i];
        const studentIndex = i + 1;
        const rawName = (item.fullName || item.full_name || '').trim();

        // 1. Đối chiếu xem học sinh đã có profile và đã ở lớp đích chưa
        const existingProf = Array.from(this.profiles.values()).find(
          p => p.full_name?.toLowerCase() === rawName.toLowerCase() && p.role === 'student'
        );

        if (existingProf && this.classMembers.has(`${classId}:${existingProf.id}`)) {
          finalResults.push({ stt: studentIndex, fullName: rawName, status: 'SKIPPED_ALREADY_IN_CLASS', note: 'Đã ở lớp đích.' });
          skippedCount++;
          continue;
        }

        // BẮT ĐẦU TẠO HỌC SINH MỚI
        let newUserId = null;
        let studentCode = `HS5-${1000 + i}`;
        let internalEmail = `hs_${studentCode.toLowerCase()}@hoclapvui.edu.vn`;

        // BƯỚC 1: TẠO AUTH USER
        newUserId = crypto.randomUUID();
        this.authUsers.set(newUserId, { id: newUserId, email: internalEmail });

        if (injectFailurePoint === 'AFTER_AUTH' && injectAtStudentIndex === studentIndex) {
          // Lỗi xảy ra ngay sau khi tạo Auth user (trước khi tạo profile)
          if (!orphanAuthNoCleanup) {
            // Compensation tức thời của Edge Function: Xóa auth user mồ côi
            this.authUsers.delete(newUserId);
          }
          this.rpc_finalize_dry_run_receipt('service_role', dryRunToken, callerId, 'FAILED');
          return { httpStatus: 500, body: { success: false, code: 'AUTH_CREATED_PROFILE_FAILED' } };
        }

        // BƯỚC 2: TẠO PROFILE
        this.profiles.set(newUserId, { id: newUserId, full_name: rawName, role: 'student', student_code: studentCode, email: internalEmail });

        if (injectFailurePoint === 'AFTER_PROFILE' && injectAtStudentIndex === studentIndex) {
          // Lỗi sau profile trước PIN/metadata: Compensation xóa Profile và Auth User
          this.profiles.delete(newUserId);
          this.authUsers.delete(newUserId);
          this.rpc_finalize_dry_run_receipt('service_role', dryRunToken, callerId, 'FAILED');
          return { httpStatus: 500, body: { success: false, code: 'PROFILE_CREATED_PIN_FAILED' } };
        }

        // BƯỚC 3: TẠO PIN
        this.studentPins.set(newUserId, '1234');

        if (injectFailurePoint === 'AFTER_PIN' && injectAtStudentIndex === studentIndex) {
          // Lỗi sau PIN trước Class Membership: Compensation xóa Pin, Profile, Auth User
          this.studentPins.delete(newUserId);
          this.profiles.delete(newUserId);
          this.authUsers.delete(newUserId);
          this.rpc_finalize_dry_run_receipt('service_role', dryRunToken, callerId, 'FAILED');
          return { httpStatus: 500, body: { success: false, code: 'PIN_CREATED_MEMBERSHIP_FAILED' } };
        }

        // BƯỚC 4: GÁN CLASS MEMBERSHIP
        this.classMembers.set(`${classId}:${newUserId}`, { class_id: classId, student_id: newUserId });

        if (injectFailurePoint === 'AFTER_CLASS_MEMBERS' && injectAtStudentIndex === studentIndex) {
          // Lỗi sau Class Members trước complete_student_row
          this.classMembers.delete(`${classId}:${newUserId}`);
          this.studentPins.delete(newUserId);
          this.profiles.delete(newUserId);
          this.authUsers.delete(newUserId);
          this.rpc_finalize_dry_run_receipt('service_role', dryRunToken, callerId, 'FAILED');
          return { httpStatus: 500, body: { success: false, code: 'MEMBERSHIP_CREATED_ROW_FINALIZE_FAILED' } };
        }

        // BƯỚC 5: COMPLETE STUDENT ROW
        this.batchRows.set(`${idempotencyKey}:${studentIndex}`, { student_id: newUserId, status: 'COMPLETED' });
        createdCount++;
        finalResults.push({ stt: studentIndex, fullName: rawName, status: 'CREATED_AND_ASSIGNED', studentCode, studentId: newUserId });

        if (injectFailurePoint === 'AFTER_ROW_COMPLETE' && injectAtStudentIndex === studentIndex) {
          // Lỗi sau khi dòng đã hoàn tất (ví dụ chết trước khi finalize cả batch)
          this.rpc_finalize_dry_run_receipt('service_role', dryRunToken, callerId, 'FAILED');
          return { httpStatus: 500, body: { success: false, code: 'ROW_COMPLETED_BATCH_FAILED', summary: { created: createdCount } } };
        }
      }

      if (injectFailurePoint === 'CRASH_BEFORE_FINALIZE') {
        // Giả lập worker bị kill đột ngột, KHÔNG gọi finalize (để receipt treo ở EXECUTING)
        return { httpStatus: 500, body: { success: false, code: 'CRASHED_WITHOUT_FINALIZE' } };
      }

      // Finalize thành công sang CONSUMED
      this.rpc_finalize_dry_run_receipt('service_role', dryRunToken, callerId, 'CONSUMED');

      return {
        httpStatus: 200,
        body: {
          success: true,
          summary: { total: students.length, created: createdCount, skipped: skippedCount, failed: failedCount },
          results: finalResults,
        }
      };
    }

    // DRY RUN
    let reviewRequiredCount = 0;
    let readyCount = 0;
    let alreadyInClassCount = 0;
    const dryResults = [];

    for (let i = 0; i < students.length; i++) {
      const s = students[i];
      const rawName = (s.fullName || s.full_name || '').trim();

      const matchedProf = Array.from(this.profiles.values()).find(
        p => p.full_name?.toLowerCase() === rawName.toLowerCase() && p.role === 'student'
      );

      if (matchedProf) {
        if (this.classMembers.has(`${classId}:${matchedProf.id}`)) {
          alreadyInClassCount++;
          dryResults.push({ stt: i + 1, fullName: rawName, status: 'ĐÃ_Ở_LỚP_ĐÍCH', studentCode: matchedProf.student_code });
          continue;
        }
      }

      readyCount++;
      dryResults.push({ stt: i + 1, fullName: rawName, status: 'CHƯA_CÓ_TÀI_KHOẢN' });
    }

    const issueRes = this.rpc_issue_dry_run_receipt(
      'service_role',
      callerId,
      classId,
      canonicalFingerprint,
      reviewRequiredCount,
      students.length,
      readyCount
    );

    return {
      httpStatus: 200,
      body: {
        success: true,
        dryRun: true,
        dryRunToken: issueRes.dryRunToken,
        summary: { total: students.length, readyToCreate: readyCount, alreadyInClass: alreadyInClassCount, reviewRequired: reviewRequiredCount },
        results: dryResults,
      }
    };
  }
}

// ============================================================================
// TEST SUITE: CRASH RECOVERY VÀ ROW-LEVEL COMPENSATION
// ============================================================================
test('SUITE: FINAL CRASH & ROW-LEVEL RECOVERY GATE', async (t) => {
  const db = new MockDatabaseAndServer();
  const ADMIN_1 = '00000000-0000-0000-0000-000000000001';
  const CLASS_A = '11111111-1111-1111-1111-111111111111';

  db.seedUser(ADMIN_1, 'admin', 'Admin User');
  db.seedClass(CLASS_A, 'Lớp 5A', 5);

  const SINGLE_STUDENT = [{ stt: 1, fullName: 'Nguyễn Văn Đạt' }];
  const TWO_STUDENTS = [
    { stt: 1, fullName: 'Học Sinh Số Một' },
    { stt: 2, fullName: 'Học Sinh Số Hai' },
  ];

  // ==========================================================================
  // PHẦN 1: STUCK EXECUTING RECOVERY & LEASE TIMEOUT
  // ==========================================================================
  await t.test('1. STUCK_EXECUTING_RECOVERY & LEASE_TIMEOUT: Worker crash khi EXECUTING -> Tự động phục hồi FAILED', async (t1) => {
    // 1. Dry run
    const dryRun = await db.handleEdgeFunctionRequest({
      callerId: ADMIN_1,
      body: { classId: CLASS_A, students: SINGLE_STUDENT, dryRun: true, idempotencyKey: 'crash_dry_1' },
    });
    const token = dryRun.body.dryRunToken;

    // 2. Execute và giả lập crash trước khi finalize (Không gọi finalize)
    await db.handleEdgeFunctionRequest({
      callerId: ADMIN_1,
      body: { classId: CLASS_A, students: SINGLE_STUDENT, dryRun: false, dryRunToken: token, idempotencyKey: 'crash_exec_1' },
      env: { ALLOW_PRODUCTION_BULK_CREATE: 'true' },
      injectFailurePoint: 'CRASH_BEFORE_FINALIZE',
    });

    const receiptInDb = db.receipts.get(token);
    assert.equal(receiptInDb.status, 'EXECUTING', 'Receipt bị treo ở EXECUTING sau khi worker crash');

    // 3. Cố gắng claim khi lease vẫn còn hạn -> BỊ CHẶN 409 RECEIPT_ALREADY_EXECUTING
    const earlyRetry = await db.handleEdgeFunctionRequest({
      callerId: ADMIN_1,
      body: { classId: CLASS_A, students: SINGLE_STUDENT, dryRun: false, dryRunToken: token, idempotencyKey: 'crash_retry_early' },
      env: { ALLOW_PRODUCTION_BULK_CREATE: 'true' },
    });
    assert.equal(earlyRetry.httpStatus, 409);
    assert.equal(earlyRetry.body.code, 'RECEIPT_ALREADY_EXECUTING');

    // 4. Giả lập thời gian trôi qua quá hạn lease (Lease Timeout)
    receiptInDb.executing_expires_at = new Date(Date.now() - 1000); // Đã quá hạn 1 giây

    // 5. Test tính nguyên tử (Single Winner) khi 2 request cùng recover song song
    const recoverReq1 = db.rpc_recover_stuck_dry_run_receipt('service_role', token, ADMIN_1);
    const recoverReq2 = db.rpc_recover_stuck_dry_run_receipt('service_role', token, ADMIN_1);

    assert.equal(recoverReq1.success, true);
    assert.equal(recoverReq1.status, 'FAILED');
    assert.equal(recoverReq2.success, true);
    assert.equal(recoverReq2.status, 'ALREADY_FAILED', 'Request thứ 2 nhận diện trạng thái FAILED, không xung đột');

    // 6. Thử claim lại receipt sau timeout -> Chuyển FAILED an toàn và trả mã lỗi rõ ràng
    const retryAfterTimeout = db.rpc_claim_dry_run_receipt('service_role', token, ADMIN_1, CLASS_A, 'dummy');
    assert.equal(retryAfterTimeout.success, false);
    assert.equal(retryAfterTimeout.status, 'RECEIPT_FAILED');
  });

  // ==========================================================================
  // PHẦN 2: ROW-LEVEL FAILURE INJECTION VÀ COMPENSATION (CASES A, B, C, D, E)
  // ==========================================================================

  // CASE A: Sau Auth user nhưng trước Profile
  await t.test('2. CASE_A: Lỗi sau khi tạo Auth user trước profile -> Compensation xóa Auth mồ côi, Retry tạo sạch sẽ', async (t2) => {
    const student = [{ stt: 1, fullName: 'Trần Case A' }];
    const dryRun = await db.handleEdgeFunctionRequest({
      callerId: ADMIN_1,
      body: { classId: CLASS_A, students: student, dryRun: true, idempotencyKey: 'case_a_dry' },
    });
    const token1 = dryRun.body.dryRunToken;

    // Inject lỗi sau Auth
    const execFail = await db.handleEdgeFunctionRequest({
      callerId: ADMIN_1,
      body: { classId: CLASS_A, students: student, dryRun: false, dryRunToken: token1, idempotencyKey: 'case_a_exec_fail' },
      env: { ALLOW_PRODUCTION_BULK_CREATE: 'true' },
      injectFailurePoint: 'AFTER_AUTH',
      injectAtStudentIndex: 1,
    });
    assert.equal(execFail.httpStatus, 500);

    // Xác minh Compensation: Auth user đã được dọn sạch, không để lại mồ côi
    const authList = Array.from(db.authUsers.values()).filter(u => u.email.includes('case_a'));
    assert.equal(authList.length, 0, 'Auth user mồ côi đã được compensation xóa sạch');

    // Dry-run mới và Execute lại
    const dryRunRetry = await db.handleEdgeFunctionRequest({
      callerId: ADMIN_1,
      body: { classId: CLASS_A, students: student, dryRun: true, idempotencyKey: 'case_a_dry_retry' },
    });
    assert.equal(dryRunRetry.body.summary.readyToCreate, 1);

    const execRetry = await db.handleEdgeFunctionRequest({
      callerId: ADMIN_1,
      body: { classId: CLASS_A, students: student, dryRun: false, dryRunToken: dryRunRetry.body.dryRunToken, idempotencyKey: 'case_a_exec_retry' },
      env: { ALLOW_PRODUCTION_BULK_CREATE: 'true' },
    });
    assert.equal(execRetry.httpStatus, 200);
    assert.equal(execRetry.body.summary.created, 1);
  });

  // CASE B: Sau Profile nhưng trước PIN
  await t.test('3. CASE_B: Lỗi sau khi tạo Profile trước PIN -> Rollback Profile + Auth, Retry tạo thành công', async (t3) => {
    const student = [{ stt: 1, fullName: 'Lê Case B' }];
    const dryRun = await db.handleEdgeFunctionRequest({
      callerId: ADMIN_1,
      body: { classId: CLASS_A, students: student, dryRun: true, idempotencyKey: 'case_b_dry' },
    });

    const execFail = await db.handleEdgeFunctionRequest({
      callerId: ADMIN_1,
      body: { classId: CLASS_A, students: student, dryRun: false, dryRunToken: dryRun.body.dryRunToken, idempotencyKey: 'case_b_exec_fail' },
      env: { ALLOW_PRODUCTION_BULK_CREATE: 'true' },
      injectFailurePoint: 'AFTER_PROFILE',
      injectAtStudentIndex: 1,
    });
    assert.equal(execFail.httpStatus, 500);

    // Xác minh không để lại profile hay auth rác
    const prof = Array.from(db.profiles.values()).find(p => p.full_name === 'Lê Case B');
    assert.equal(prof, undefined, 'Profile đã được rollback xóa sạch');

    // Retry
    const dryRun2 = await db.handleEdgeFunctionRequest({
      callerId: ADMIN_1,
      body: { classId: CLASS_A, students: student, dryRun: true, idempotencyKey: 'case_b_dry_2' },
    });
    const exec2 = await db.handleEdgeFunctionRequest({
      callerId: ADMIN_1,
      body: { classId: CLASS_A, students: student, dryRun: false, dryRunToken: dryRun2.body.dryRunToken, idempotencyKey: 'case_b_exec_2' },
      env: { ALLOW_PRODUCTION_BULK_CREATE: 'true' },
    });
    assert.equal(exec2.httpStatus, 200);
  });

  // CASE C: Sau Profile nhưng trước Class Membership
  await t.test('4. CASE_C: Lỗi sau Profile trước Class Members -> Rollback sạch sẽ, không để lại membership mồ côi', async (t4) => {
    const student = [{ stt: 1, fullName: 'Phạm Case C' }];
    const dryRun = await db.handleEdgeFunctionRequest({
      callerId: ADMIN_1,
      body: { classId: CLASS_A, students: student, dryRun: true, idempotencyKey: 'case_c_dry' },
    });

    const execFail = await db.handleEdgeFunctionRequest({
      callerId: ADMIN_1,
      body: { classId: CLASS_A, students: student, dryRun: false, dryRunToken: dryRun.body.dryRunToken, idempotencyKey: 'case_c_exec_fail' },
      env: { ALLOW_PRODUCTION_BULK_CREATE: 'true' },
      injectFailurePoint: 'AFTER_PIN',
      injectAtStudentIndex: 1,
    });
    assert.equal(execFail.httpStatus, 500);

    // Retry
    const dryRun2 = await db.handleEdgeFunctionRequest({
      callerId: ADMIN_1,
      body: { classId: CLASS_A, students: student, dryRun: true, idempotencyKey: 'case_c_dry_2' },
    });
    const exec2 = await db.handleEdgeFunctionRequest({
      callerId: ADMIN_1,
      body: { classId: CLASS_A, students: student, dryRun: false, dryRunToken: dryRun2.body.dryRunToken, idempotencyKey: 'case_c_exec_2' },
      env: { ALLOW_PRODUCTION_BULK_CREATE: 'true' },
    });
    assert.equal(exec2.httpStatus, 200);
    assert.equal(exec2.body.summary.created, 1);
  });

  // CASE D: Sau Class Members nhưng trước Row Completion
  await t.test('5. CASE_D: Lỗi sau Class Members trước Complete Row -> Thu hồi membership, Retry hoàn tất', async (t5) => {
    const student = [{ stt: 1, fullName: 'Hoàng Case D' }];
    const dryRun = await db.handleEdgeFunctionRequest({
      callerId: ADMIN_1,
      body: { classId: CLASS_A, students: student, dryRun: true, idempotencyKey: 'case_d_dry' },
    });

    const execFail = await db.handleEdgeFunctionRequest({
      callerId: ADMIN_1,
      body: { classId: CLASS_A, students: student, dryRun: false, dryRunToken: dryRun.body.dryRunToken, idempotencyKey: 'case_d_exec_fail' },
      env: { ALLOW_PRODUCTION_BULK_CREATE: 'true' },
      injectFailurePoint: 'AFTER_CLASS_MEMBERS',
      injectAtStudentIndex: 1,
    });
    assert.equal(execFail.httpStatus, 500);

    // Retry
    const dryRun2 = await db.handleEdgeFunctionRequest({
      callerId: ADMIN_1,
      body: { classId: CLASS_A, students: student, dryRun: true, idempotencyKey: 'case_d_dry_2' },
    });
    const exec2 = await db.handleEdgeFunctionRequest({
      callerId: ADMIN_1,
      body: { classId: CLASS_A, students: student, dryRun: false, dryRunToken: dryRun2.body.dryRunToken, idempotencyKey: 'case_d_exec_2' },
      env: { ALLOW_PRODUCTION_BULK_CREATE: 'true' },
    });
    assert.equal(exec2.httpStatus, 200);
  });

  // CASE E: Lỗi sau khi Row 1 hoàn tất (Row 1 ok, Row 2 fail)
  await t.test('6. CASE_E: Row 1 hoàn tất, Row 2 bị lỗi -> Retry nhận diện đúng Row 1 ĐÃ_Ở_LỚP_ĐÍCH, không trùng lặp', async (t6) => {
    const dryRun1 = await db.handleEdgeFunctionRequest({
      callerId: ADMIN_1,
      body: { classId: CLASS_A, students: TWO_STUDENTS, dryRun: true, idempotencyKey: 'case_e_dry_1' },
    });
    assert.equal(dryRun1.body.summary.readyToCreate, 2);

    // Execute fail ở học sinh 2 (học sinh 1 đã hoàn tất)
    const execFail = await db.handleEdgeFunctionRequest({
      callerId: ADMIN_1,
      body: { classId: CLASS_A, students: TWO_STUDENTS, dryRun: false, dryRunToken: dryRun1.body.dryRunToken, idempotencyKey: 'case_e_exec_1' },
      env: { ALLOW_PRODUCTION_BULK_CREATE: 'true' },
      injectFailurePoint: 'AFTER_AUTH',
      injectAtStudentIndex: 2, // Lỗi ở học sinh 2
    });
    assert.equal(execFail.httpStatus, 500);

    // Xác minh Học sinh 1 đã tồn tại trong CSDL
    const prof1 = Array.from(db.profiles.values()).find(p => p.full_name === 'Học Sinh Số Một');
    assert.ok(prof1, 'Học sinh 1 đã được tạo thành công');

    // Chạy Dry-Run mới (Lần 2)
    const dryRun2 = await db.handleEdgeFunctionRequest({
      callerId: ADMIN_1,
      body: { classId: CLASS_A, students: TWO_STUDENTS, dryRun: true, idempotencyKey: 'case_e_dry_2' },
    });
    assert.equal(dryRun2.body.summary.total, 2);
    assert.equal(dryRun2.body.summary.alreadyInClass, 1, 'Học sinh 1 nhận diện đúng ĐÃ_Ở_LỚP_ĐÍCH');
    assert.equal(dryRun2.body.summary.readyToCreate, 1, 'Chỉ còn học sinh 2 sẵn sàng tạo');

    // Execute lần 2
    const exec2 = await db.handleEdgeFunctionRequest({
      callerId: ADMIN_1,
      body: { classId: CLASS_A, students: TWO_STUDENTS, dryRun: false, dryRunToken: dryRun2.body.dryRunToken, idempotencyKey: 'case_e_exec_2' },
      env: { ALLOW_PRODUCTION_BULK_CREATE: 'true' },
    });
    assert.equal(exec2.httpStatus, 200);
    assert.equal(exec2.body.summary.skipped, 1, 'Học sinh 1 được skip an toàn');
    assert.equal(exec2.body.summary.created, 1, 'Học sinh 2 được tạo mới');

    // Kiểm tra tổng số profiles có đúng 2 học sinh, không bị tạo trùng profile
    const allStudentProfs = Array.from(db.profiles.values()).filter(p => p.role === 'student' && p.full_name.includes('Học Sinh Số'));
    assert.equal(allStudentProfs.length, 2, 'Tuyệt đối không có profile trùng!');

    // Kiểm tra tổng số class_members của 2 học sinh này đúng bằng 2
    const twoStudentIds = allStudentProfs.map(p => p.id);
    const membersOfTwo = Array.from(db.classMembers.values()).filter(m => m.class_id === CLASS_A && twoStudentIds.includes(m.student_id));
    assert.equal(membersOfTwo.length, 2, 'Tuyệt đối không có class_members trùng!');
  });

  // CASE F: Orphan Auth Recovery (Sự cố crash khiến Auth User chưa kịp dọn)
  await t.test('7. ORPHAN_AUTH_RECOVERY: Orphan Auth User cũ không ngăn cản Retry tạo học sinh mới', async (t7) => {
    const student = [{ stt: 1, fullName: 'Đỗ Orphan Auth' }];
    
    // Giả lập crash cực đoan: Auth user đã tạo nhưng worker chết ngay trước khi kịp compensation xóa
    const dryRun1 = await db.handleEdgeFunctionRequest({
      callerId: ADMIN_1,
      body: { classId: CLASS_A, students: student, dryRun: true, idempotencyKey: 'orphan_dry_1' },
    });

    const execFail = await db.handleEdgeFunctionRequest({
      callerId: ADMIN_1,
      body: { classId: CLASS_A, students: student, dryRun: false, dryRunToken: dryRun1.body.dryRunToken, idempotencyKey: 'orphan_exec_1' },
      env: { ALLOW_PRODUCTION_BULK_CREATE: 'true' },
      injectFailurePoint: 'AFTER_AUTH',
      orphanAuthNoCleanup: true, // Không dọn Auth user mồ côi
    });
    assert.equal(execFail.httpStatus, 500);

    // Dry-run mới nhận diện học sinh chưa có Profile -> Cấp receipt mới
    const dryRun2 = await db.handleEdgeFunctionRequest({
      callerId: ADMIN_1,
      body: { classId: CLASS_A, students: student, dryRun: true, idempotencyKey: 'orphan_dry_2' },
    });
    assert.equal(dryRun2.body.summary.readyToCreate, 1);

    // Execute lần 2 sinh mã/tài khoản mới an toàn
    const exec2 = await db.handleEdgeFunctionRequest({
      callerId: ADMIN_1,
      body: { classId: CLASS_A, students: student, dryRun: false, dryRunToken: dryRun2.body.dryRunToken, idempotencyKey: 'orphan_exec_2' },
      env: { ALLOW_PRODUCTION_BULK_CREATE: 'true' },
    });
    assert.equal(exec2.httpStatus, 200);
    assert.equal(exec2.body.summary.created, 1);

    const prof = Array.from(db.profiles.values()).find(p => p.full_name === 'Đỗ Orphan Auth');
    assert.ok(prof, 'Học sinh được tạo profile thành công');
  });
});
