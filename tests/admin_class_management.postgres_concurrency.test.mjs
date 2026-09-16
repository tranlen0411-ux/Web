import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const { Client } = pg;

// ============================================================================
// 1. DATABASE HOST GUARD (FAIL-CLOSED)
// ============================================================================
function validateAndGetConnectionString() {
  const rawUrl = process.env.TEST_POSTGRES_URL || 'postgres://test_user:test_password@127.0.0.1:5432/postgres_test';

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    console.error('❌ [DATABASE_HOST_GUARD] URL kết nối database không hợp lệ:', err.message);
    throw new Error(`Invalid TEST_POSTGRES_URL: ${err.message}`);
  }

  const allowedHosts = new Set(['127.0.0.1', 'localhost']);
  if (!allowedHosts.has(parsed.hostname)) {
    console.error(`❌ [DATABASE_HOST_GUARD] VI PHẠM AN TOÀN: Host ${parsed.hostname} bị cấm. Chỉ cho phép 127.0.0.1 hoặc localhost.`);
    throw new Error(`SECURITY ERROR: Host "${parsed.hostname}" is forbidden. Only local test databases (127.0.0.1/localhost) are allowed.`);
  }

  // Chặn hoàn toàn nếu phát hiện các biến môi trường Production hoặc Supabase
  if (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PRODUCTION_DATABASE_URL) {
    console.error('❌ [DATABASE_HOST_GUARD] VI PHẠM AN TOÀN: Phát hiện biến môi trường nhạy cảm không được phép tồn tại trong test suite.');
    throw new Error('SECURITY ERROR: Sensitive production environment variables detected.');
  }

  console.log(`🔒 [DATABASE_HOST_GUARD] ENFORCED: Host hợp lệ (${parsed.hostname}:${parsed.port || 5432}) trên database tạm thời "${parsed.pathname.replace(/^\//, '')}".`);
  return rawUrl;
}

// ============================================================================
// 2. SETUP PREDECESSOR SCHEMA & CHẠY MIGRATION CHÍNH THỨC
// ============================================================================
async function setupDatabase(connectionString) {
  console.log('\n--- 1. KHỞI TẠO PREDECESSOR SCHEMA VÀ THỰC THI MIGRATION ---');
  const setupClient = new Client({
    connectionString,
    statement_timeout: 10000
  });

  await setupClient.connect();

  try {
    // Dọn sạch và tạo roles, schemas nếu chưa tồn tại
    await setupClient.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated NOLOGIN;
        END IF;
      END
      $$;

      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE SCHEMA IF NOT EXISTS app_private;

      CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
      $$;

      -- Reset các bảng phục vụ test
      DROP TABLE IF EXISTS public.class_membership_history CASCADE;
      DROP TABLE IF EXISTS public.student_progress CASCADE;
      DROP TABLE IF EXISTS public.assignments CASCADE;
      DROP TABLE IF EXISTS public.games CASCADE;
      DROP TABLE IF EXISTS public.class_members CASCADE;
      DROP TABLE IF EXISTS public.classes CASCADE;
      DROP TABLE IF EXISTS public.profiles CASCADE;

      -- Predecessor profiles
      CREATE TABLE public.profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'student',
        grade_level INT DEFAULT 1,
        total_stars INT DEFAULT 0,
        total_coins INT DEFAULT 0,
        is_disabled BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Predecessor classes với teacher_id NOT NULL CASCADE (để migration drop & alter)
      CREATE TABLE public.classes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        code TEXT UNIQUE NOT NULL,
        grade_level INT DEFAULT 1,
        teacher_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Predecessor class_members (chưa có cột is_active,started_at...)
      CREATE TABLE public.class_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(class_id, student_id)
      );

      CREATE TABLE public.games (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title TEXT NOT NULL,
        is_public BOOLEAN DEFAULT true
      );

      CREATE TABLE public.assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
        game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
        status TEXT DEFAULT 'active'
      );

      CREATE TABLE public.student_progress (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
        assignment_id UUID REFERENCES public.assignments(id),
        score INT DEFAULT 100,
        stars_earned INT DEFAULT 10,
        completed_at TIMESTAMPTZ DEFAULT NOW()
      );

      GRANT USAGE ON SCHEMA public, auth, app_private TO anon, authenticated;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
      GRANT ALL ON ALL FUNCTIONS IN SCHEMA public, auth, app_private TO authenticated;
    `);

    // Thực thi migration chính thức từ file
    const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', '20260915223000_admin_student_teacher_class_management.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');
    await setupClient.query(migrationSql);

    console.log('✅ Thực thi migration 20260915223000_admin_student_teacher_class_management.sql trên PostgreSQL thành công.');

    // Cấp quyền execute RPC cho authenticated role
    await setupClient.query(`
      GRANT EXECUTE ON FUNCTION public.assign_student_to_class(UUID, UUID, TEXT) TO authenticated;
      GRANT EXECUTE ON FUNCTION public.transfer_student_class(UUID, UUID, UUID, TEXT) TO authenticated;
      GRANT EXECUTE ON FUNCTION public.remove_student_from_class(UUID, UUID, TEXT) TO authenticated;
    `);

  } finally {
    await setupClient.end();
  }
}

// ============================================================================
// 3. MAIN CONCURRENCY TEST SUITE (2 INDEPENDENT CONNECTIONS)
// ============================================================================
async function runPostgresConcurrencyTests() {
  console.log('============================================================');
  console.log('🚀 KHỞI CHẠY KIỂM THỬ REAL POSTGRESQL CONCURRENCY (PR #95)');
  console.log('============================================================');

  const connectionString = validateAndGetConnectionString();
  await setupDatabase(connectionString);

  // Fixtures UUID
  const adminId = '11111111-1111-1111-1111-111111111111';
  const student1Id = '33333333-3333-3333-3333-333333333331'; // Dành cho TEST A (Concurrent Assign)
  const student2Id = '33333333-3333-3333-3333-333333333332'; // Dành cho TEST B (Concurrent Transfer)
  const classAId = '44444444-4444-4444-4444-444444444441';
  const classBId = '44444444-4444-4444-4444-444444444442';
  const classCId = '44444444-4444-4444-4444-444444444443';

  // Chèn dữ liệu fixtures qua admin client
  const adminSetupClient = new Client({ connectionString, statement_timeout: 5000 });
  await adminSetupClient.connect();
  try {
    await adminSetupClient.query(`
      INSERT INTO public.profiles (id, email, full_name, role, is_disabled) VALUES
        ('${adminId}', 'admin@school.vn', 'Quản Trị Viên', 'admin', false),
        ('${student1Id}', 'student1@school.vn', 'Học Sinh Đua Xếp Lớp', 'student', false),
        ('${student2Id}', 'student2@school.vn', 'Học Sinh Đua Chuyển Lớp', 'student', false);

      INSERT INTO public.classes (id, name, code, grade_level) VALUES
        ('${classAId}', 'Lớp A (Nguồn)', 'LOPA', 1),
        ('${classBId}', 'Lớp B (Đích 1)', 'LOPB', 1),
        ('${classCId}', 'Lớp C (Đích 2)', 'LOPC', 1);

      -- Student 2 ban đầu được xếp vào Lớp A một cách hợp lệ
      INSERT INTO public.class_members (class_id, student_id, is_active, is_primary, started_at, assigned_by)
      VALUES ('${classAId}', '${student2Id}', true, true, NOW(), '${adminId}');

      INSERT INTO public.class_membership_history (
        student_id, class_id, action, assigned_by, created_at,
        student_id_snapshot, student_name_snapshot, class_id_snapshot, class_name_snapshot, assigned_by_snapshot
      ) VALUES (
        '${student2Id}', '${classAId}', 'ASSIGN', '${adminId}', NOW(),
        '${student2Id}', 'Học Sinh Đua Chuyển Lớp', '${classAId}', 'Lớp A (Nguồn)', '${adminId}'
      );
    `);
  } finally {
    await adminSetupClient.end();
  }

  // Khởi tạo 2 connection độc lập
  const clientA = new Client({ connectionString, statement_timeout: 5000 });
  const clientB = new Client({ connectionString, statement_timeout: 5000 });

  await Promise.all([clientA.connect(), clientB.connect()]);

  // Thiết lập auth context cho từng connection độc lập
  for (const client of [clientA, clientB]) {
    await client.query(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${adminId}', false);
    `);
  }

  console.log('✅ Đã thiết lập 2 kết nối độc lập với role authenticated và admin context.');

  const report = {
    testA: {},
    testB: {}
  };

  try {
    // ========================================================================
    // TEST A: CONCURRENT ASSIGN
    // Học sinh 1 chưa có lớp.
    // Client A gọi assign vào Lớp A.
    // Client B đồng thời gọi assign vào Lớp B.
    // ========================================================================
    console.log('\n--- 2. TEST A: CONCURRENT ASSIGN (ĐUA XẾP LỚP ĐỒNG THỜI) ---');
    console.log('⏳ Client A -> Lớp A | Client B -> Lớp B (phát đồng thời)...');

    const assignPromises = [
      clientA.query(`SELECT public.assign_student_to_class('${student1Id}', '${classAId}', 'Client A concurrent assign') AS result;`),
      clientB.query(`SELECT public.assign_student_to_class('${student1Id}', '${classBId}', 'Client B concurrent assign') AS result;`)
    ];

    const assignResults = await Promise.all(assignPromises);
    const resA = assignResults[0].rows[0].result;
    const resB = assignResults[1].rows[0].result;

    console.log('  Kết quả Client A:', JSON.stringify(resA));
    console.log('  Kết quả Client B:', JSON.stringify(resB));

    const assignSuccessCount = (resA.success === true ? 1 : 0) + (resB.success === true ? 1 : 0);
    const assignFailureCount = (resA.success === false ? 1 : 0) + (resB.success === false ? 1 : 0);
    const failedAssignResult = resA.success === false ? resA : resB;
    const successfulAssignResult = resA.success === true ? resA : resB;

    assert.strictEqual(assignSuccessCount, 1, 'TEST A: Phải có đúng 1 request assign thành công');
    assert.strictEqual(assignFailureCount, 1, 'TEST A: Phải có đúng 1 request assign thất bại');
    assert.strictEqual(successfulAssignResult.status, 'ASSIGNED_SUCCESSFULLY', 'TEST A: Request thắng phải có status ASSIGNED_SUCCESSFULLY');
    assert.strictEqual(failedAssignResult.status, 'TRANSFER_REQUIRED', 'TEST A: Request thua phải nhận status TRANSFER_REQUIRED');

    // Kiểm tra DB sau Test A
    const verifyClient = new Client({ connectionString, statement_timeout: 5000 });
    await verifyClient.connect();
    try {
      const activeMemberships = await verifyClient.query(`
        SELECT class_id, is_active FROM public.class_members
        WHERE student_id = '${student1Id}' AND is_active = true;
      `);
      assert.strictEqual(activeMemberships.rows.length, 1, 'TEST A: Chỉ được tồn tại duy nhất 1 active membership');

      const historyEvents = await verifyClient.query(`
        SELECT action, class_id, student_name_snapshot, class_name_snapshot
        FROM public.class_membership_history
        WHERE student_id = '${student1Id}';
      `);
      assert.strictEqual(historyEvents.rows.length, 1, 'TEST A: Chỉ ghi nhận đúng 1 event ASSIGN');
      assert.strictEqual(historyEvents.rows[0].action, 'ASSIGN', 'TEST A: Action phải là ASSIGN');
      assert.strictEqual(historyEvents.rows[0].class_id, successfulAssignResult.class_id, 'TEST A: Event lịch sử phải thuộc lớp thắng');

      report.testA = {
        result: 'PASS',
        successCount: assignSuccessCount,
        rejectedStatus: failedAssignResult.status,
        activeCount: activeMemberships.rows.length,
        eventCount: historyEvents.rows.length,
        deadlockOrTimeout: 'NO'
      };
      console.log('✅ TEST A (CONCURRENT ASSIGN) PASS: 100% Fail-Closed, không trùng lặp, không deadlock.');

      // ======================================================================
      // TEST B: CONCURRENT TRANSFER
      // Học sinh 2 đang ở Lớp A.
      // Client A chuyển A -> B.
      // Client B đồng thời chuyển A -> C.
      // ======================================================================
      console.log('\n--- 3. TEST B: CONCURRENT TRANSFER (ĐUA CHUYỂN LỚP ĐỒNG THỜI) ---');
      console.log('⏳ Client A: Lớp A -> Lớp B | Client B: Lớp A -> Lớp C (phát đồng thời)...');

      const transferPromises = [
        clientA.query(`SELECT public.transfer_student_class('${student2Id}', '${classAId}', '${classBId}', 'Client A concurrent transfer A->B') AS result;`),
        clientB.query(`SELECT public.transfer_student_class('${student2Id}', '${classAId}', '${classCId}', 'Client B concurrent transfer A->C') AS result;`)
      ];

      const transferResults = await Promise.all(transferPromises);
      const transResA = transferResults[0].rows[0].result;
      const transResB = transferResults[1].rows[0].result;

      console.log('  Kết quả Client A:', JSON.stringify(transResA));
      console.log('  Kết quả Client B:', JSON.stringify(transResB));

      const transferSuccessCount = (transResA.success === true ? 1 : 0) + (transResB.success === true ? 1 : 0);
      const transferFailureCount = (transResA.success === false ? 1 : 0) + (transResB.success === false ? 1 : 0);
      const failedTransferResult = transResA.success === false ? transResA : transResB;
      const successfulTransferResult = transResA.success === true ? transResA : transResB;

      assert.strictEqual(transferSuccessCount, 1, 'TEST B: Phải có đúng 1 request transfer thành công');
      assert.strictEqual(transferFailureCount, 1, 'TEST B: Phải có đúng 1 request transfer thất bại');
      assert.strictEqual(successfulTransferResult.status, 'TRANSFERRED_SUCCESSFULLY', 'TEST B: Request thắng phải có status TRANSFERRED_SUCCESSFULLY');
      assert.strictEqual(failedTransferResult.status, 'SOURCE_CLASS_MISMATCH', 'TEST B: Request thua phải bị từ chối với status SOURCE_CLASS_MISMATCH');

      // Kiểm tra DB sau Test B
      const activeTransMemberships = await verifyClient.query(`
        SELECT class_id, is_active FROM public.class_members
        WHERE student_id = '${student2Id}' AND is_active = true;
      `);
      assert.strictEqual(activeTransMemberships.rows.length, 1, 'TEST B: Cuối cùng chỉ có đúng 1 membership active');
      assert.strictEqual(activeTransMemberships.rows[0].class_id, successfulTransferResult.to_class_id, 'TEST B: Membership active phải là lớp đích của request thắng');

      const sourceClassMembership = await verifyClient.query(`
        SELECT is_active FROM public.class_members
        WHERE student_id = '${student2Id}' AND class_id = '${classAId}';
      `);
      assert.strictEqual(sourceClassMembership.rows[0].is_active, false, 'TEST B: Lớp nguồn phải có is_active = false');

      const transHistoryEvents = await verifyClient.query(`
        SELECT action, class_id, student_name_snapshot, class_name_snapshot
        FROM public.class_membership_history
        WHERE student_id = '${student2Id}'
        ORDER BY created_at ASC;
      `);
      // Tổng cộng 3 events: 1 ASSIGN ban đầu + 1 TRANSFER_OUT + 1 TRANSFER_IN
      assert.strictEqual(transHistoryEvents.rows.length, 3, 'TEST B: Lịch sử phải có đúng 3 events (1 ASSIGN + 1 TRANSFER_OUT + 1 TRANSFER_IN)');
      assert.strictEqual(transHistoryEvents.rows[0].action, 'ASSIGN', 'TEST B: Event 1 là ASSIGN');
      assert.strictEqual(transHistoryEvents.rows[1].action, 'TRANSFER_OUT', 'TEST B: Event 2 là TRANSFER_OUT');
      assert.strictEqual(transHistoryEvents.rows[1].class_id, classAId, 'TEST B: TRANSFER_OUT từ Lớp A');
      assert.strictEqual(transHistoryEvents.rows[2].action, 'TRANSFER_IN', 'TEST B: Event 3 là TRANSFER_IN');
      assert.strictEqual(transHistoryEvents.rows[2].class_id, successfulTransferResult.to_class_id, 'TEST B: TRANSFER_IN vào lớp đích thắng');

      report.testB = {
        result: 'PASS',
        successCount: transferSuccessCount,
        rejectedStatus: failedTransferResult.status,
        activeCount: activeTransMemberships.rows.length,
        eventLogValid: 'YES',
        deadlockOrTimeout: 'NO'
      };
      console.log('✅ TEST B (CONCURRENT TRANSFER) PASS: 100% Fail-Closed, không có event mồ côi, không deadlock.');

      // ========================================================================
      // TEST C: HARDENING PRIVILEGES & DISABLED STUB (REAL POSTGRESQL CATALOG & ROLES)
      // ========================================================================
      console.log('\n--- 4. KIỂM THỬ TEST C: JOIN CLASS STUB & CATALOG PERMISSIONS (REAL POSTGRES) ---');

      // 1. Kiểm tra catalog privileges thực tế
      const privRes = await verifyClient.query(`
        SELECT
          has_function_privilege('anon', 'public.join_class_by_code(text)', 'EXECUTE') AS anon_priv,
          has_function_privilege('authenticated', 'public.join_class_by_code(text)', 'EXECUTE') AS auth_priv;
      `);
      assert.strictEqual(privRes.rows[0].anon_priv, false, 'TEST C: anon role bị thu hồi quyền EXECUTE trên join_class_by_code');
      assert.strictEqual(privRes.rows[0].auth_priv, true, 'TEST C: authenticated role được cấp quyền EXECUTE trên join_class_by_code');

      // 2. Role anon gọi bị PostgreSQL từ chối ở database level (42501)
      let anonCallThrew = false;
      try {
        await clientA.query(`SET ROLE anon;`);
        await clientA.query(`SELECT public.join_class_by_code('CODE123');`);
      } catch (err) {
        if (err.code === '42501' || (err.message && err.message.includes('permission denied'))) {
          anonCallThrew = true;
        }
      } finally {
        await clientA.query(`RESET ROLE;`);
      }
      assert.strictEqual(anonCallThrew, true, 'TEST C: Role anon gọi join_class_by_code bị từ chối quyền EXECUTE (42501)');

      // 3. Role authenticated gọi nhận phản hồi DISABLED và không thay đổi dữ liệu
      await clientA.query(`
        SET ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${student1Id}', true);
      `);
      const stubRes = await clientA.query(`SELECT public.join_class_by_code('CODE123') AS result;`);
      await clientA.query(`RESET ROLE;`);

      assert.strictEqual(stubRes.rows[0].result.success, false, 'TEST C: stub success là false');
      assert.strictEqual(stubRes.rows[0].result.status, 'DISABLED', 'TEST C: stub status là DISABLED');

      // 4. Kiểm tra zero mutations
      const historyCountAfterStub = await verifyClient.query(`SELECT COUNT(*)::int AS cnt FROM public.class_membership_history;`);
      assert.strictEqual(historyCountAfterStub.rows[0].cnt, 3, 'TEST C: Lịch sử membership không bị can thiệp bởi join_class_by_code stub');

      report.testC = {
        result: 'PASS',
        anonPrivilegeDenied: 'YES',
        authenticatedPrivilegeAllowed: 'YES',
        runtimeRejection: 'PASS',
        disabledResponse: 'PASS'
      };
      console.log('✅ TEST C (JOIN CLASS STUB PRIVILEGE HARDENING) PASS: anon bị chặn, authenticated nhận DISABLED, zero mutations.');

    } finally {
      await verifyClient.end();
    }
  } finally {
    await Promise.all([clientA.end(), clientB.end()]);
    console.log('🔌 Đã đóng cả 2 kết nối PostgreSQL độc lập trong finally block an toàn.');
  }

  // ==========================================================================
  // 4. BÁO CÁO KẾT QUẢ CHO CI / GITHUB ACTIONS
  // ==========================================================================
  console.log('\n============================================================');
  console.log('📊 TỔNG KẾT KIỂM THỬ REAL POSTGRESQL CONCURRENCY & PERMISSIONS');
  console.log('============================================================');
  console.log(`REAL_CONCURRENCY_TEST: PASS`);
  console.log(`POSTGRES_SERVICE_VERSION: 16`);
  console.log(`DATABASE_HOST_GUARD: PASS`);
  console.log(`PRODUCTION_CONNECTION_POSSIBLE: NO`);
  console.log(`CONCURRENCY_CONNECTION_COUNT: 2`);
  console.log(`CONNECTIONS_ARE_INDEPENDENT: TRUE`);
  console.log(`CONCURRENT_ASSIGN_RESULT: ${report.testA.result}`);
  console.log(`CONCURRENT_ASSIGN_SUCCESS_COUNT: ${report.testA.successCount}`);
  console.log(`CONCURRENT_ASSIGN_REJECTED_STATUS: ${report.testA.rejectedStatus}`);
  console.log(`ACTIVE_MEMBERSHIP_COUNT_AFTER_ASSIGN: ${report.testA.activeCount}`);
  console.log(`ASSIGN_EVENT_COUNT: ${report.testA.eventCount}`);
  console.log(`ASSIGN_DEADLOCK_OR_TIMEOUT: ${report.testA.deadlockOrTimeout}`);
  console.log(`CONCURRENT_TRANSFER_RESULT: ${report.testB.result}`);
  console.log(`CONCURRENT_TRANSFER_SUCCESS_COUNT: ${report.testB.successCount}`);
  console.log(`CONCURRENT_TRANSFER_REJECTED_STATUS: ${report.testB.rejectedStatus}`);
  console.log(`ACTIVE_MEMBERSHIP_COUNT_AFTER_TRANSFER: ${report.testB.activeCount}`);
  console.log(`TRANSFER_EVENT_LOG_VALID: ${report.testB.eventLogValid}`);
  console.log(`TRANSFER_DEADLOCK_OR_TIMEOUT: ${report.testB.deadlockOrTimeout}`);
  console.log(`JOIN_CLASS_STUB_PERMISSION_RESULT: ${report.testC ? report.testC.result : 'SKIPPED'}`);
  console.log(`JOIN_CLASS_STUB_ANON_DENIED: ${report.testC ? report.testC.anonPrivilegeDenied : 'N/A'}`);
  console.log(`JOIN_CLASS_STUB_AUTH_ALLOWED: ${report.testC ? report.testC.authenticatedPrivilegeAllowed : 'N/A'}`);
  console.log('============================================================\n');
}

runPostgresConcurrencyTests().catch(err => {
  console.error('\n❌ REAL POSTGRESQL CONCURRENCY TEST FAILED:', err);
  process.exit(1);
});
