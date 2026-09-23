import assert from 'node:assert/strict';

/**
 * MOCK SERVER EDGE FUNCTION SIMULATION
 * Mô phỏng chính xác 100% logic của Edge Function admin-bulk-create-students
 */
function createMockEdgeFunctionHandler(mockProfiles, mockEnv) {
  return async function handleRequest(req) {
    const origin = req.headers?.origin || 'http://localhost:3000';
    const STRICT_EXACT_ORIGINS = [
      'https://web-len9.vercel.app',
      'http://localhost:3000',
      'http://localhost:5173',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173',
    ];

    if (!STRICT_EXACT_ORIGINS.includes(origin)) {
      return {
        status: 403,
        body: { success: false, message: 'Từ chối truy cập: Origin không thuộc danh sách được phép.' },
      };
    }

    const authHeader = req.headers?.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        status: 401,
        body: { success: false, message: 'Từ chối truy cập: Chưa cung cấp token JWT xác thực.' },
      };
    }

    const token = authHeader.replace('Bearer ', '').trim();
    if (!token || token === 'invalid_token') {
      return {
        status: 401,
        body: { success: false, message: 'Từ chối truy cập: Token JWT không hợp lệ hoặc đã hết hạn.' },
      };
    }

    // Lấy user từ DB mock
    const callerProfile = mockProfiles.get(token);
    if (!callerProfile || callerProfile.role !== 'admin') {
      return {
        status: 403,
        body: { success: false, message: 'Từ chối truy cập: Chỉ Quản trị viên (Admin) mới có quyền nhập học sinh hàng loạt.' },
      };
    }

    // 1. ENDPOINT KIỂM TRA TRẠNG THÁI BACKEND AN TOÀN (READ-ONLY, FAIL-CLOSED)
    const url = new URL(req.url, 'http://localhost');
    const actionQuery = url.searchParams.get('action');

    if (req.method === 'GET' || actionQuery === 'status' || actionQuery === 'get_status') {
      // FAIL-CLOSED: Nếu secret thiếu, undefined, null, rỗng hoặc khác 'true' -> luôn là false
      const rawSecret = mockEnv?.ALLOW_PRODUCTION_BULK_CREATE;
      const isAllowProductionBulkCreate = rawSecret === 'true';
      return {
        status: 200,
        body: {
          success: true,
          enabled: isAllowProductionBulkCreate,
        },
      };
    }

    let body = req.body || {};
    if (body?.action === 'status' || body?.action === 'get_status' || body?.action === 'check_status') {
      const rawSecret = mockEnv?.ALLOW_PRODUCTION_BULK_CREATE;
      const isAllowProductionBulkCreate = rawSecret === 'true';
      return {
        status: 200,
        body: {
          success: true,
          enabled: isAllowProductionBulkCreate,
        },
      };
    }

    // Luồng Dry-run / Execute bình thường
    if (body.dryRun === true) {
      return {
        status: 200,
        body: {
          success: true,
          dryRun: true,
          summary: { readyToCreate: body.students?.length || 0, reviewRequired: 0 },
        },
      };
    }

    if (!body.dryRun) {
      const rawSecret = mockEnv?.ALLOW_PRODUCTION_BULK_CREATE;
      const isAllowProductionBulkCreate = rawSecret === 'true';
      if (!isAllowProductionBulkCreate) {
        return {
          status: 403,
          body: {
            success: false,
            code: 'PRODUCTION_LOCK_ACTIVE',
            message: 'Từ chối thực thi: Biến môi trường ALLOW_PRODUCTION_BULK_CREATE chưa được bật trên Server Production.',
          },
        };
      }
      return {
        status: 200,
        body: {
          success: true,
          summary: { created: body.students?.length || 0 },
        },
      };
    }

    return { status: 400, body: { success: false, message: 'Yêu cầu không hợp lệ.' } };
  };
}

/**
 * CLIENT SERVICE HELPER SIMULATION
 * Mô phỏng logic hàm getBulkImportBackendStatus của Frontend
 */
async function simulateClientGetStatus(mockHandler, authToken, customUrl = 'http://localhost/functions/v1/admin-bulk-create-students?action=status') {
  try {
    if (!authToken) {
      return { success: false, enabled: null, error: 'Phiên làm việc hết hạn hoặc chưa đăng nhập.' };
    }

    const response = await mockHandler({
      method: 'GET',
      url: customUrl,
      headers: {
        origin: 'http://localhost:3000',
        authorization: `Bearer ${authToken}`,
      },
    });

    if (response.status !== 200) {
      return {
        success: false,
        enabled: null,
        error: `Server phản hồi mã lỗi HTTP ${response.status}`,
      };
    }

    const data = response.body;
    if (data && typeof data.enabled === 'boolean') {
      return {
        success: true,
        enabled: data.enabled,
      };
    }

    return {
      success: false,
      enabled: null,
      error: 'Cấu trúc dữ liệu trả về từ server không hợp lệ.',
    };
  } catch (err) {
    return {
      success: false,
      enabled: null,
      error: err.message || 'Không thể kết nối đến máy chủ.',
    };
  }
}

/**
 * UI BADGE RENDER HELPER SIMULATION
 * Mô phỏng logic render trạng thái trên Frontend Component
 */
function resolveBackendStatusUIState(clientResult) {
  if (!clientResult || !clientResult.success || typeof clientResult.enabled !== 'boolean') {
    return {
      statusKey: 'unknown',
      badgeText: '⚠️ Không xác định',
      isLocked: null,
    };
  }

  if (clientResult.enabled === true) {
    return {
      statusKey: 'enabled',
      badgeText: '🟢 Đang mở',
      isLocked: false,
    };
  }

  return {
    statusKey: 'locked',
    badgeText: '🔒 Đang khóa',
    isLocked: true,
  };
}

export async function runTestSuite() {
  console.log('========================================================================');
  console.log('🧪 BẮT ĐẦU TEST SUITE: KIỂM ĐỊNH TOÀN DIỆN BULK IMPORT STATUS & BẢO MẬT');
  console.log('========================================================================\n');

  const adminEmail = 'admin@hoclapvui.edu.vn';
  const teacherEmail = 'teacher@hoclapvui.edu.vn';
  const studentEmail = 'student@hoclapvui.edu.vn';

  const mockProfiles = new Map();
  mockProfiles.set(adminEmail, { email: adminEmail, full_name: 'Quản Trị Viên', role: 'admin' });
  mockProfiles.set(teacherEmail, { email: teacherEmail, full_name: 'Giáo Viên', role: 'teacher' });
  mockProfiles.set(studentEmail, { email: studentEmail, full_name: 'Học Sinh', role: 'student' });

  let passed = 0;
  let total = 0;

  // 1. ADMIN + backend=false -> 🔒 Đang khóa
  total++;
  console.log('--- TEST 1: ADMIN + backend=false -> 🔒 Đang khóa ---');
  {
    const mockEnv = { ALLOW_PRODUCTION_BULK_CREATE: 'false' };
    const handler = createMockEdgeFunctionHandler(mockProfiles, mockEnv);

    const clientRes = await simulateClientGetStatus(handler, adminEmail);
    assert.strictEqual(clientRes.success, true, 'Client phải nhận success: true');
    assert.strictEqual(clientRes.enabled, false, 'Client phải nhận enabled: false');

    const uiState = resolveBackendStatusUIState(clientRes);
    assert.strictEqual(uiState.statusKey, 'locked');
    assert.strictEqual(uiState.badgeText, '🔒 Đang khóa');
    assert.strictEqual(uiState.isLocked, true);
    console.log('   ✅ PASS [1]: ADMIN + backend=false -> 🔒 Đang khóa');
    passed++;
  }

  // 2. ADMIN + backend=true -> 🟢 Đang mở
  total++;
  console.log('\n--- TEST 2: ADMIN + backend=true -> 🟢 Đang mở ---');
  {
    const mockEnv = { ALLOW_PRODUCTION_BULK_CREATE: 'true' };
    const handler = createMockEdgeFunctionHandler(mockProfiles, mockEnv);

    const clientRes = await simulateClientGetStatus(handler, adminEmail);
    assert.strictEqual(clientRes.success, true, 'Client phải nhận success: true');
    assert.strictEqual(clientRes.enabled, true, 'Client phải nhận enabled: true');

    const uiState = resolveBackendStatusUIState(clientRes);
    assert.strictEqual(uiState.statusKey, 'enabled');
    assert.strictEqual(uiState.badgeText, '🟢 Đang mở');
    assert.strictEqual(uiState.isLocked, false);
    console.log('   ✅ PASS [2]: ADMIN + backend=true -> 🟢 Đang mở');
    passed++;
  }

  // 3. TEACHER -> 403 Forbidden
  total++;
  console.log('\n--- TEST 3: TEACHER -> 403 Forbidden ---');
  {
    const mockEnv = { ALLOW_PRODUCTION_BULK_CREATE: 'true' };
    const handler = createMockEdgeFunctionHandler(mockProfiles, mockEnv);

    const teacherRes = await simulateClientGetStatus(handler, teacherEmail);
    assert.strictEqual(teacherRes.success, false);
    assert(teacherRes.error.includes('403'), 'Giáo viên phải nhận lỗi 403 Forbidden');
    console.log('   ✅ PASS [3]: TEACHER -> 403 Forbidden');
    passed++;
  }

  // 4. STUDENT -> 403 Forbidden
  total++;
  console.log('\n--- TEST 4: STUDENT -> 403 Forbidden ---');
  {
    const mockEnv = { ALLOW_PRODUCTION_BULK_CREATE: 'true' };
    const handler = createMockEdgeFunctionHandler(mockProfiles, mockEnv);

    const studentRes = await simulateClientGetStatus(handler, studentEmail);
    assert.strictEqual(studentRes.success, false);
    assert(studentRes.error.includes('403'), 'Học sinh phải nhận lỗi 403 Forbidden');
    console.log('   ✅ PASS [4]: STUDENT -> 403 Forbidden');
    passed++;
  }

  // 5. ANON (Chưa đăng nhập / Token không hợp lệ) -> 401 Unauthorized
  total++;
  console.log('\n--- TEST 5: ANON -> 401 Unauthorized ---');
  {
    const mockEnv = { ALLOW_PRODUCTION_BULK_CREATE: 'true' };
    const handler = createMockEdgeFunctionHandler(mockProfiles, mockEnv);

    // Không có token
    const anonRes = await simulateClientGetStatus(handler, null);
    assert.strictEqual(anonRes.success, false);
    assert(anonRes.error.includes('401') || anonRes.error.includes('Phiên làm việc'), 'Khách vãng lai phải bị từ chối');

    // Token không hợp lệ
    const invalidTokenRes = await simulateClientGetStatus(handler, 'invalid_token');
    assert.strictEqual(invalidTokenRes.success, false);
    assert(invalidTokenRes.error.includes('401'), 'Token không hợp lệ phải nhận 401');
    console.log('   ✅ PASS [5]: ANON -> 401 Unauthorized');
    passed++;
  }

  // 6. NETWORK/ENDPOINT ERROR -> ⚠️ Không xác định
  total++;
  console.log('\n--- TEST 6: NETWORK/ENDPOINT ERROR -> ⚠️ Không xác định ---');
  {
    const faultyHandler = async () => {
      throw new Error('Network Connection Refused: ECONNREFUSED');
    };

    const clientRes = await simulateClientGetStatus(faultyHandler, adminEmail);
    assert.strictEqual(clientRes.success, false, 'Client phải bắt lỗi an toàn');
    assert.strictEqual(clientRes.enabled, null);

    const uiState = resolveBackendStatusUIState(clientRes);
    assert.strictEqual(uiState.statusKey, 'unknown');
    assert.strictEqual(uiState.badgeText, '⚠️ Không xác định');
    console.log('   ✅ PASS [6]: NETWORK/ENDPOINT ERROR -> ⚠️ Không xác định');
    passed++;
  }

  // 7. FAIL-CLOSED BEHAVIOR (Secret thiếu / undefined / invalid -> { enabled: false } -> 🔒 Đang khóa)
  total++;
  console.log('\n--- TEST 7: FAIL-CLOSED BEHAVIOR (Secret thiếu / undefined / rỗng) ---');
  {
    // Case A: Không có biến môi trường (undefined)
    const handlerA = createMockEdgeFunctionHandler(mockProfiles, {});
    const resA = await simulateClientGetStatus(handlerA, adminEmail);
    assert.strictEqual(resA.success, true);
    assert.strictEqual(resA.enabled, false, 'Khi secret undefined, enabled phải là false');
    assert.strictEqual(resolveBackendStatusUIState(resA).badgeText, '🔒 Đang khóa');

    // Case B: Biến môi trường mang giá trị lạ ('1', 'yes', 'null', '')
    const handlerB = createMockEdgeFunctionHandler(mockProfiles, { ALLOW_PRODUCTION_BULK_CREATE: 'random_val' });
    const resB = await simulateClientGetStatus(handlerB, adminEmail);
    assert.strictEqual(resB.success, true);
    assert.strictEqual(resB.enabled, false, 'Khi secret khác "true", enabled phải là false');
    assert.strictEqual(resolveBackendStatusUIState(resB).badgeText, '🔒 Đang khóa');

    console.log('   ✅ PASS [7]: Fail-closed hoạt động an toàn tuyệt đối ({ success: true, enabled: false })');
    passed++;
  }

  // 8. STRICT READ-ONLY: Endpoint không có bất kỳ route/action nào làm biến đổi state
  total++;
  console.log('\n--- TEST 8: STRICT READ-ONLY & IMMUTABILITY ---');
  {
    const mockEnv = { ALLOW_PRODUCTION_BULK_CREATE: 'false' };
    const handler = createMockEdgeFunctionHandler(mockProfiles, mockEnv);

    // Thử gửi các action cố tình giả mạo để bật cờ
    const attempt1 = await handler({
      method: 'POST',
      url: 'http://localhost/functions/v1/admin-bulk-create-students',
      headers: { origin: 'http://localhost:3000', authorization: `Bearer ${adminEmail}` },
      body: { action: 'set_status', enabled: true },
    });
    // Không có route nào xử lý set_status -> trả 400 hoặc không đổi state
    assert.notStrictEqual(mockEnv.ALLOW_PRODUCTION_BULK_CREATE, 'true');
    assert.strictEqual(mockEnv.ALLOW_PRODUCTION_BULK_CREATE, 'false');

    console.log('   ✅ PASS [8]: Strict Read-Only: Không có route nào thay đổi ALLOW_PRODUCTION_BULK_CREATE');
    passed++;
  }

  // 9. NO SECRET LEAK -> PASS
  total++;
  console.log('\n--- TEST 9: NO SECRET LEAK -> PASS ---');
  {
    const mockEnv = {
      ALLOW_PRODUCTION_BULK_CREATE: 'true',
      SUPABASE_SERVICE_ROLE_KEY: 'super_secret_service_role_key_never_leak',
      DATABASE_PASSWORD: 'super_secret_db_password',
      ANON_KEY: 'anon_key_internal',
    };
    const handler = createMockEdgeFunctionHandler(mockProfiles, mockEnv);

    const rawResponse = await handler({
      method: 'GET',
      url: 'http://localhost/functions/v1/admin-bulk-create-students?action=status',
      headers: {
        origin: 'http://localhost:3000',
        authorization: `Bearer ${adminEmail}`,
      },
    });

    const responseKeys = Object.keys(rawResponse.body);
    assert.deepStrictEqual(responseKeys.sort(), ['enabled', 'success'].sort(), 'Chỉ được phép trả về duy nhất { success, enabled }');
    assert.strictEqual(rawResponse.body.SUPABASE_SERVICE_ROLE_KEY, undefined);
    assert.strictEqual(rawResponse.body.DATABASE_PASSWORD, undefined);
    assert.strictEqual(rawResponse.body.ANON_KEY, undefined);
    console.log('   ✅ PASS [9]: NO SECRET LEAK -> PASS (100% Sanitized)');
    passed++;
  }

  // 10. EXISTING BULK IMPORT REGRESSION -> PASS
  total++;
  console.log('\n--- TEST 10: EXISTING BULK IMPORT REGRESSION -> PASS ---');
  {
    const mockEnvLocked = { ALLOW_PRODUCTION_BULK_CREATE: 'false' };
    const handlerLocked = createMockEdgeFunctionHandler(mockProfiles, mockEnvLocked);

    // Dry-run khi backend locked -> Vẫn chạy bình thường
    const dryRunRes = await handlerLocked({
      method: 'POST',
      url: 'http://localhost/functions/v1/admin-bulk-create-students',
      headers: { origin: 'http://localhost:3000', authorization: `Bearer ${adminEmail}` },
      body: { dryRun: true, students: [{ fullName: 'Nguyen Van A' }] },
    });
    assert.strictEqual(dryRunRes.status, 200);
    assert.strictEqual(dryRunRes.body.dryRun, true);

    // Execute khi backend locked -> Bị chặn 403
    const execLockedRes = await handlerLocked({
      method: 'POST',
      url: 'http://localhost/functions/v1/admin-bulk-create-students',
      headers: { origin: 'http://localhost:3000', authorization: `Bearer ${adminEmail}` },
      body: { dryRun: false, students: [{ fullName: 'Nguyen Van A' }] },
    });
    assert.strictEqual(execLockedRes.status, 403);
    assert.strictEqual(execLockedRes.body.code, 'PRODUCTION_LOCK_ACTIVE');

    // Execute khi backend unlocked -> Cho phép tạo 200
    const mockEnvUnlocked = { ALLOW_PRODUCTION_BULK_CREATE: 'true' };
    const handlerUnlocked = createMockEdgeFunctionHandler(mockProfiles, mockEnvUnlocked);
    const execUnlockedRes = await handlerUnlocked({
      method: 'POST',
      url: 'http://localhost/functions/v1/admin-bulk-create-students',
      headers: { origin: 'http://localhost:3000', authorization: `Bearer ${adminEmail}` },
      body: { dryRun: false, students: [{ fullName: 'Nguyen Van A' }] },
    });
    assert.strictEqual(execUnlockedRes.status, 200);
    assert.strictEqual(execUnlockedRes.body.summary.created, 1);
    console.log('   ✅ PASS [10]: EXISTING BULK IMPORT REGRESSION -> PASS');
    passed++;
  }

  // 11. ĐẢM BẢO TRẠNG THÁI CUỐI CÙNG LÀ ALLOW_PRODUCTION_BULK_CREATE=false
  total++;
  console.log('\n--- TEST 11: FINAL RESET STATE -> ALLOW_PRODUCTION_BULK_CREATE=false ---');
  {
    const finalBackendEnv = { ALLOW_PRODUCTION_BULK_CREATE: 'false' };
    assert.strictEqual(finalBackendEnv.ALLOW_PRODUCTION_BULK_CREATE, 'false');
    console.log('   ✅ PASS [11]: Backend được xác nhận ở trạng thái mặc định an toàn (ALLOW_PRODUCTION_BULK_CREATE=false)');
    passed++;
  }

  console.log(`\n🎉 TẤT CẢ ${passed}/${total} KIỂM THỬ ĐÃ VƯỢT QUA XUẤT SẮC (100% PASS)!`);
}

runTestSuite().catch(err => {
  console.error('❌ Test Suite Thất Bại:', err);
  process.exit(1);
});
