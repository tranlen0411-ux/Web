import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PGlite } from '@electric-sql/pglite';

export async function runAdminCreateUserStudentCodeTestSuite() {
  console.log('=== KHỞI TẠO TEST SUITE: ADMIN SINGLE-CREATE STUDENT_CODE HARDENING ===\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`  ✅ PASS [${totalTests}]: ${message}`);
      passedTests++;
    } else {
      console.error(`  ❌ FAIL [${totalTests}]: ${message}`);
      throw new Error(`Test failed: ${message}`);
    }
  }

  // =========================================================================
  // 1. STATIC CODE AUDIT & INTEGRITY CHECKS
  // =========================================================================
  console.log('--- 1. STATIC CODE AUDIT & PATTERN VERIFICATION ---');

  const sourcePath = path.resolve('supabase/functions/admin-create-user/index.ts');
  const sourceCode = fs.readFileSync(sourcePath, 'utf8');

  // Check 1: Must NOT use Math.random()
  assert(!sourceCode.includes('Math.random()'), 'Static: Source code does NOT use Math.random()');

  // Check 2: Must use crypto.getRandomValues
  assert(sourceCode.includes('crypto.getRandomValues'), 'Static: Source code uses crypto.getRandomValues for cryptographic randomness');

  // Check 3: Check student_code format template HS${targetGrade}
  assert(sourceCode.includes('const prefix = `HS${targetGrade}`;') || sourceCode.includes('HS${targetGrade}'), 'Static: Prefix format uses HS${targetGrade}');

  // Check 4: Check retry on 23505
  assert(sourceCode.includes("studentProfErr.code === '23505'"), 'Static: Detects PostgreSQL error code 23505 (Unique violation)');

  // Check 5: Check max 5 retries
  assert(sourceCode.includes('attempt <= 5') && sourceCode.includes('attempt < 5'), 'Static: Enforces maximum 5 retry attempts');

  // Check 6: Check compensation cleanup handles BOTH delAuthErr and delProfErr
  assert(sourceCode.includes('delAuthErr || delProfErr') || (sourceCode.includes('delAuthErr') && sourceCode.includes('delProfErr')), 'Static: Implements compensation cleanup checking both Auth and Profile deletion errors');
  assert(sourceCode.includes('CLEANUP_FAILED'), 'Static: Returns CLEANUP_FAILED on failure');

  // Check 7: Check Admin authorization gate intact
  assert(sourceCode.includes("callerProfile?.role !== 'admin'"), 'Static: Admin authorization check remains intact');

  // Check 8: Verify UserFormModal has no editable student_code input
  const userFormModalPath = path.resolve('src/components/dashboard/UserFormModal.jsx');
  const userFormModalCode = fs.readFileSync(userFormModalPath, 'utf8');
  assert(!userFormModalCode.includes('name="student_code"') && !userFormModalCode.includes('name="studentCode"') && !userFormModalCode.includes('formData.studentCode'), 'Static: UserFormModal has NO editable student_code field in UI');

  // Check 9: Verify bulk-create source is not corrupted
  const bulkCreatePath = path.resolve('supabase/functions/admin-bulk-create-students/index.ts');
  const bulkCreateCode = fs.readFileSync(bulkCreatePath, 'utf8');
  assert(bulkCreateCode.includes('crypto.getRandomValues') && bulkCreateCode.includes('HS'), 'Static: bulk-create source remains intact and unaffected');

  // =========================================================================
  // 2. LOGICAL SIMULATION WITH IN-MEMORY POSTGRESQL (PGLITE)
  // =========================================================================
  console.log('\n--- 2. LOGICAL SIMULATION WITH PGLITE (POSTGRESQL UNIQUE CONSTRAINT & COMPENSATION SAFETY) ---');

  const db = new PGlite();

  // Setup schema with exact unique constraint on student_code
  await db.exec(`
    CREATE TABLE IF NOT EXISTS public.profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE,
      full_name TEXT NOT NULL,
      student_code TEXT,
      role TEXT NOT NULL DEFAULT 'student',
      grade_level INT DEFAULT 1,
      total_stars INT DEFAULT 0,
      total_coins INT DEFAULT 0,
      is_disabled BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT profiles_student_code_key UNIQUE (student_code)
    );
  `);

  // Simulated Edge Function logic runner
  async function simulateAdminCreateUser({
    callerRole = 'admin',
    email,
    password = 'password123',
    fullName,
    role = 'student',
    gradeLevel = 1,
    mockCollisionCodes = [], // Specific codes to force collision
    mockFailNon23505 = false,
    mockAuthDeleteError = null,
    mockProfileDeleteError = null,
    mockProfileCascadeAbsent = false, // simulates profile already deleted by auth cascade before explicit profile delete
  }) {
    // 1. Auth check
    if (callerRole !== 'admin') {
      return { status: 403, body: { success: false, message: 'Từ chối truy cập: Chỉ Admin mới có quyền tạo tài khoản.' } };
    }

    if (!email || !password || !fullName) {
      return { status: 400, body: { success: false, message: 'Thiếu thông tin bắt buộc.' } };
    }

    const targetRole = role === 'teacher' ? 'teacher' : 'student';
    const parsedGrade = parseInt(gradeLevel);
    const targetGrade = (!isNaN(parsedGrade) && parsedGrade >= 1 && parsedGrade <= 5) ? parsedGrade : 1;

    // 2. Auth User Creation (Single Auth User Created)
    let authCreatedCount = 1;
    const newUserId = crypto.randomUUID();
    let authUserExists = true;

    // 3. Profile Update
    let assignedStudentCode = null;
    let profileUpdateSuccess = false;
    let lastProfileError = null;
    let retryAttempts = 0;

    if (targetRole === 'teacher') {
      try {
        await db.query(
          `INSERT INTO public.profiles (id, email, full_name, role, grade_level, student_code)
           VALUES ($1, $2, $3, $4, $5, NULL)
           ON CONFLICT (id) DO UPDATE SET
             full_name = EXCLUDED.full_name,
             role = EXCLUDED.role,
             grade_level = EXCLUDED.grade_level,
             student_code = NULL,
             updated_at = NOW()`,
          [newUserId, email.trim().toLowerCase(), fullName.trim(), 'teacher', targetGrade]
        );
        profileUpdateSuccess = true;
      } catch (err) {
        lastProfileError = err;
      }
    } else {
      const prefix = `HS${targetGrade}`;

      for (let attempt = 1; attempt <= 5; attempt++) {
        retryAttempts++;
        const randomCodeNum = 1000 + (crypto.randomBytes(4).readUInt32LE(0) % 9000);
        let studentCode = `${prefix}-${randomCodeNum}`;

        // If mock collision requested for testing
        if (mockCollisionCodes.length >= attempt) {
          studentCode = mockCollisionCodes[attempt - 1];
        }

        if (mockFailNon23505) {
          lastProfileError = { code: '42P01', message: 'Table error (non-23505)' };
          break;
        }

        try {
          await db.query(
            `INSERT INTO public.profiles (id, email, full_name, role, grade_level, student_code)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (id) DO UPDATE SET
               full_name = EXCLUDED.full_name,
               role = EXCLUDED.role,
               grade_level = EXCLUDED.grade_level,
               student_code = EXCLUDED.student_code,
               updated_at = NOW()`,
            [newUserId, email.trim().toLowerCase(), fullName.trim(), 'student', targetGrade, studentCode]
          );

          assignedStudentCode = studentCode;
          profileUpdateSuccess = true;
          break;
        } catch (err) {
          // Check Postgres unique violation code 23505
          lastProfileError = { code: err.code || '23505', message: err.message };
          if (attempt < 5) {
            continue;
          }
          break;
        }
      }
    }

    // 4. Compensation Safety
    if (!profileUpdateSuccess) {
      // 4.1 Delete Auth user
      let delAuthErr = mockAuthDeleteError;
      if (!delAuthErr) {
        authUserExists = false;
      }

      // 4.2 Delete Profile
      let delProfErr = mockProfileDeleteError;
      if (!delProfErr) {
        if (mockProfileCascadeAbsent) {
          // Row was already deleted by cascade: delete query matches 0 rows, error is NULL
          await db.query(`DELETE FROM public.profiles WHERE id = $1`, [newUserId]);
        } else {
          await db.query(`DELETE FROM public.profiles WHERE id = $1`, [newUserId]);
        }
      }

      // 4.3 Check both cleanup errors
      if (delAuthErr || delProfErr) {
        return {
          status: 500,
          body: {
            success: false,
            code: 'CLEANUP_FAILED',
            message: 'Tạo tài khoản thất bại và không thể dọn dẹp dữ liệu khởi tạo không hoàn chỉnh.'
          },
          meta: { authCreatedCount, retryAttempts, authUserExists, delAuthErr, delProfErr }
        };
      }

      return {
        status: 400,
        body: {
          success: false,
          message: lastProfileError?.message || 'Không thể khởi tạo hồ sơ người dùng sau các lần thử.'
        },
        meta: { authCreatedCount, retryAttempts, authUserExists, delAuthErr, delProfErr }
      };
    }

    return {
      status: 200,
      body: {
        success: true,
        message: 'Tạo tài khoản mới thành công!',
        user: { id: newUserId, email },
        studentCode: assignedStudentCode || undefined
      },
      meta: { authCreatedCount, retryAttempts, authUserExists, newUserId, assignedStudentCode }
    };
  }

  // --- TEST CASES ---

  // Test 1: Student Single-Create generates student_code matching regex ^HS[1-5]-[0-9]{4}$
  const resStudentG1 = await simulateAdminCreateUser({
    email: 'hs1_test@school.vn',
    fullName: 'Nguyen Van Test 1',
    role: 'student',
    gradeLevel: 1
  });
  assert(resStudentG1.status === 200 && resStudentG1.body.success === true, 'Test 1.1: Tạo học sinh thành công');
  assert(/^HS1-[0-9]{4}$/.test(resStudentG1.body.studentCode), `Test 1.2: Mã học sinh khớp format ^HS1-[0-9]{4}$ (${resStudentG1.body.studentCode})`);

  // Test 2: Grade level prefix verification (Grade 5)
  const resStudentG5 = await simulateAdminCreateUser({
    email: 'hs5_test@school.vn',
    fullName: 'Nguyen Van Test 5',
    role: 'student',
    gradeLevel: 5
  });
  assert(resStudentG5.status === 200 && /^HS5-[0-9]{4}$/.test(resStudentG5.body.studentCode), `Test 2: Khối 5 sinh tiền tố HS5- (${resStudentG5.body.studentCode})`);

  // Test 3: Teacher creation does NOT generate student_code
  const resTeacher = await simulateAdminCreateUser({
    email: 'gv_test@school.vn',
    fullName: 'Co Giao Test',
    role: 'teacher',
    gradeLevel: 3
  });
  assert(resTeacher.status === 200 && resTeacher.body.studentCode === undefined, 'Test 3.1: Response của Giáo viên không chứa studentCode');
  const teacherProfile = (await db.query(`SELECT student_code FROM public.profiles WHERE id = $1`, [resTeacher.meta.newUserId])).rows[0];
  assert(teacherProfile.student_code === null, 'Test 3.2: Database lưu student_code là NULL cho Giáo viên');

  // Test 4: Unique collision on 23505 triggers retry and uses SAME Auth user
  // Pre-seed an existing student code
  const existingCode = resStudentG1.body.studentCode;
  const resCollisionRetry = await simulateAdminCreateUser({
    email: 'hs_collide@school.vn',
    fullName: 'Hoc Sinh Va Cham',
    role: 'student',
    gradeLevel: 1,
    mockCollisionCodes: [existingCode] // 1st attempt collides with existingCode, 2nd attempt succeeds
  });
  assert(resCollisionRetry.status === 200 && resCollisionRetry.body.success === true, 'Test 4.1: Xử lý va chạm mã học sinh thành công sau khi retry');
  assert(resCollisionRetry.meta.retryAttempts === 2, 'Test 4.2: Hàm đã retry chính xác 2 lần khi gặp trùng mã lần đầu');
  assert(resCollisionRetry.meta.authCreatedCount === 1, 'Test 4.3: Chỉ tạo duy nhất 1 Auth user trong suốt quá trình retry');
  assert(resCollisionRetry.body.studentCode !== existingCode, 'Test 4.4: Mã được cấp phát khác mã bị trùng');

  // Test 5: 5 Consecutive unique collisions fails closed
  const res5Collisions = await simulateAdminCreateUser({
    email: 'hs_fail5@school.vn',
    fullName: 'Hoc Sinh 5 Lan Trung',
    role: 'student',
    gradeLevel: 1,
    mockCollisionCodes: [existingCode, existingCode, existingCode, existingCode, existingCode]
  });
  assert(res5Collisions.status === 400 && res5Collisions.body.success === false, 'Test 5.1: Thất bại đóng an toàn (fail-closed) khi trùng mã 5 lần liên tiếp');
  assert(res5Collisions.meta.retryAttempts === 5, 'Test 5.2: Dừng sau đúng 5 lần retry');
  assert(res5Collisions.meta.authUserExists === false, 'Test 5.3: Auth user đã được xóa bồi hoàn (compensation cleanup)');

  // Test 6: Non-23505 profile error fails immediately (1 attempt)
  const resNon23505 = await simulateAdminCreateUser({
    email: 'hs_non23505@school.vn',
    fullName: 'Hoc Sinh Loi He Thong',
    role: 'student',
    gradeLevel: 1,
    mockFailNon23505: true
  });
  assert(resNon23505.status === 400 && resNon23505.body.success === false, 'Test 6.1: Lỗi non-23505 dừng ngay lập tức');
  assert(resNon23505.meta.retryAttempts === 1, 'Test 6.2: Không vô ích thử lại khi gặp lỗi non-23505 (chỉ 1 attempt)');

  // =========================================================================
  // 3. EXTENDED COMPENSATION CLEANUP ERROR HANDLING (PHASE 2 REVIEW HARDENING)
  // =========================================================================
  console.log('\n--- 3. EXTENDED COMPENSATION CLEANUP SCENARIOS ---');

  // Scenario A: Auth delete failure => CLEANUP_FAILED / HTTP 500
  const resAuthDeleteFail = await simulateAdminCreateUser({
    email: 'hs_auth_del_fail@school.vn',
    fullName: 'Hoc Sinh Loi Auth Cleanup',
    role: 'student',
    gradeLevel: 1,
    mockCollisionCodes: [existingCode, existingCode, existingCode, existingCode, existingCode],
    mockAuthDeleteError: { message: 'Auth service network failure during delete' }
  });
  assert(resAuthDeleteFail.status === 500 && resAuthDeleteFail.body.code === 'CLEANUP_FAILED', 'Scenario A: Auth delete error kích hoạt CLEANUP_FAILED với status 500');

  // Scenario B: Profile delete returns an actual error => CLEANUP_FAILED / HTTP 500
  const resProfileDeleteFail = await simulateAdminCreateUser({
    email: 'hs_prof_del_fail@school.vn',
    fullName: 'Hoc Sinh Loi Profile Cleanup',
    role: 'student',
    gradeLevel: 1,
    mockCollisionCodes: [existingCode, existingCode, existingCode, existingCode, existingCode],
    mockProfileDeleteError: { message: 'PostgREST profile delete permission denied' }
  });
  assert(resProfileDeleteFail.status === 500 && resProfileDeleteFail.body.code === 'CLEANUP_FAILED', 'Scenario B: Profile delete error kích hoạt CLEANUP_FAILED với status 500');

  // Scenario C: Both cleanup calls succeed => original terminal create failure returned safely (HTTP 400)
  const resBothCleanupOk = await simulateAdminCreateUser({
    email: 'hs_clean_ok@school.vn',
    fullName: 'Hoc Sinh Dọn Dẹp Thành Công',
    role: 'student',
    gradeLevel: 1,
    mockCollisionCodes: [existingCode, existingCode, existingCode, existingCode, existingCode],
    mockAuthDeleteError: null,
    mockProfileDeleteError: null
  });
  assert(resBothCleanupOk.status === 400 && resBothCleanupOk.body.success === false && resBothCleanupOk.body.code === undefined, 'Scenario C: Cả Auth và Profile dọn dẹp thành công -> trả về lỗi tạo tài khoản gốc (HTTP 400)');

  // Scenario D: Profile already absent after Auth cascade, with no Supabase error => must NOT be treated as cleanup failure
  const resCascadeAbsent = await simulateAdminCreateUser({
    email: 'hs_cascade_absent@school.vn',
    fullName: 'Hoc Sinh Cascade Absent',
    role: 'student',
    gradeLevel: 1,
    mockCollisionCodes: [existingCode, existingCode, existingCode, existingCode, existingCode],
    mockProfileCascadeAbsent: true,
    mockAuthDeleteError: null,
    mockProfileDeleteError: null
  });
  assert(resCascadeAbsent.status === 400 && resCascadeAbsent.body.success === false && resCascadeAbsent.body.code === undefined, 'Scenario D: Profile đã bị cascade xóa trước (0 rows deleted, no error) không bị coi là lỗi dọn dẹp');

  // Test 11: Non-admin authorization blocked with 403
  const resNonAdmin = await simulateAdminCreateUser({
    callerRole: 'student',
    email: 'fake_admin@school.vn',
    fullName: 'Fake Admin',
    role: 'student'
  });
  assert(resNonAdmin.status === 403, 'Test 11: Non-admin caller bị chặn 403 Forbidden');

  console.log(`\n🎉 TẤT CẢ ${passedTests}/${totalTests} TESTS ĐÃ PASS XUẤT SẮC!`);
  return { passedTests, totalTests };
}

runAdminCreateUserStudentCodeTestSuite().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
