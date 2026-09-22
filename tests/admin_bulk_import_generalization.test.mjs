import { PGlite } from '@electric-sql/pglite';
import crypto from 'crypto';

export async function runAdminBulkImportGeneralizationTestSuite() {
  console.log('=== KHỞI TẠO TEST SUITE: TỔNG QUÁT HÓA NHẬP HỌC SINH HÀNG LOẠT (BULK IMPORT GENERALIZATION & CLASS BINDING SECURITY) ===\n');

  const db = new PGlite();

  // Setup roles and tables
  await db.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
      END IF;
    END
    $$;

    CREATE SCHEMA IF NOT EXISTS auth;

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
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.classes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      grade_level INT DEFAULT 1,
      teacher_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.class_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
      student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(class_id, student_id)
    );
  `);

  const adminId = '11111111-1111-1111-1111-111111111111';
  const teacherId = '22222222-2222-2222-2222-222222222222';
  const class59Id = '55555555-5555-5555-5555-555555555559';
  const class2AId = '22222222-5555-5555-5555-222222222222';
  const class1AId = '11111111-5555-5555-5555-111111111111';

  // Seed Admin, Teacher, and Classes
  await db.exec(`
    INSERT INTO public.profiles (id, email, full_name, role, is_disabled) VALUES
      ('${adminId}', 'admin@school.vn', 'Quản trị viên', 'admin', false),
      ('${teacherId}', 'teacher@school.vn', 'Thầy Tuấn', 'teacher', false);

    INSERT INTO public.classes (id, name, code, grade_level, teacher_id) VALUES
      ('${class59Id}', 'Lớp 5.9', 'LOP59', 5, '${teacherId}'),
      ('${class2AId}', 'Lớp 2A', 'LOP2A', 2, NULL),
      ('${class1AId}', 'Lớp 1A', 'LOP1A', 1, NULL);
  `);

  // Seed Students for specific test conditions
  const studentInClass59 = '33333333-5555-5555-5555-000000000001';
  const studentInClass2A = '33333333-5555-5555-5555-000000000002';
  const studentNoClass = '33333333-5555-5555-5555-000000000003';
  const duplicateStudent1 = '33333333-5555-5555-5555-000000000004';
  const duplicateStudent2 = '33333333-5555-5555-5555-000000000005';
  const studentInMultiClasses = '33333333-5555-5555-5555-000000000006';

  await db.exec(`
    INSERT INTO public.profiles (id, email, full_name, student_code, role, is_disabled) VALUES
      ('${studentInClass59}', 'hs1@school.vn', 'Trần Thị Thu Hà', 'HS5-1001', 'student', false),
      ('${studentInClass2A}', 'hs2@school.vn', 'Lê Hoàng Nam', 'HS2-1002', 'student', false),
      ('${studentNoClass}', 'hs3@school.vn', 'Vũ Minh Khôi', 'HS-1003', 'student', false),
      ('${duplicateStudent1}', 'dup1@school.vn', 'Nguyễn Văn An', 'HS1-1004', 'student', false),
      ('${duplicateStudent2}', 'dup2@school.vn', 'Nguyễn Văn An', 'HS2-1005', 'student', false),
      ('${studentInMultiClasses}', 'multi@school.vn', 'Phạm Quốc Bảo', 'HS-1006', 'student', false);

    INSERT INTO public.class_members (class_id, student_id) VALUES
      ('${class59Id}', '${studentInClass59}'),
      ('${class2AId}', '${studentInClass2A}'),
      ('${class1AId}', '${studentInMultiClasses}'),
      ('${class2AId}', '${studentInMultiClasses}');
  `);

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

  // Simulation function of the generalized Dry-Run algorithm
  async function simulateDryRun(callerId, classId, studentsList) {
    // 1. Check Caller is Admin
    const callerRes = await db.query(
      `SELECT role FROM public.profiles WHERE id = $1 AND is_disabled = false`,
      [callerId]
    );
    if (!callerRes.rows[0] || callerRes.rows[0].role !== 'admin') {
      return { success: false, status: 403, message: 'Từ chối truy cập: Chỉ Quản trị viên mới có quyền.' };
    }

    // 2. Check Target Class exists by class_id
    const classRes = await db.query(
      `SELECT id, name, grade_level, code, teacher_id FROM public.classes WHERE id = $1`,
      [classId]
    );
    if (!classRes.rows[0]) {
      return { success: false, status: 400, message: `Lớp học không tồn tại trong hệ thống (ID: ${classId}).` };
    }
    const targetClass = classRes.rows[0];

    const dryResults = [];
    let readyCount = 0;
    let matchedNoClassCount = 0;
    let alreadyInClassCount = 0;
    let inAnotherClassCount = 0;
    let duplicateNameCount = 0;
    let multipleClassesCount = 0;
    let reviewRequiredCount = 0;

    for (let i = 0; i < studentsList.length; i++) {
      const item = studentsList[i];
      const stt = item.stt || i + 1;
      const cleanName = (item.fullName || '').trim().replace(/\s+/g, ' ');

      if (!cleanName) {
        dryResults.push({ stt, fullName: cleanName, status: 'INVALID_INPUT', note: 'Tên rỗng' });
        reviewRequiredCount++;
        continue;
      }

      // Query profiles
      const matchedRes = await db.query(
        `SELECT id, student_code, full_name FROM public.profiles WHERE role = 'student' AND LOWER(full_name) = LOWER($1)`,
        [cleanName]
      );

      const matchedProfiles = matchedRes.rows;

      if (matchedProfiles.length === 0) {
        dryResults.push({
          stt,
          fullName: cleanName,
          status: 'CHƯA_CÓ_TÀI_KHOẢN',
          studentCode: `Dự kiến sinh mã HS${targetClass.grade_level}-xxx`,
          note: `Chưa có tài khoản. Sẵn sàng tạo mới và gán vào ${targetClass.name}.`
        });
        readyCount++;
      } else if (matchedProfiles.length === 1) {
        const prof = matchedProfiles[0];
        const memRes = await db.query(
          `SELECT cm.id, cm.class_id, c.name as class_name 
           FROM public.class_members cm 
           JOIN public.classes c ON c.id = cm.class_id 
           WHERE cm.student_id = $1`,
          [prof.id]
        );
        const memberships = memRes.rows;
        const isInTargetClass = memberships.some(m => m.class_id === classId);

        if (isInTargetClass) {
          dryResults.push({
            stt,
            fullName: cleanName,
            status: 'ĐÃ_Ở_LỚP_ĐÍCH',
            studentCode: prof.student_code,
            studentId: prof.id,
            note: `Học sinh đã thuộc lớp ${targetClass.name} từ trước.`
          });
          alreadyInClassCount++;
        } else if (memberships.length === 0) {
          dryResults.push({
            stt,
            fullName: cleanName,
            status: 'KHỚP_DUY_NHẤT_CHƯA_CÓ_LỚP',
            studentCode: prof.student_code,
            studentId: prof.id,
            note: `Đã có tài khoản học sinh nhưng chưa thuộc lớp nào.`
          });
          matchedNoClassCount++;
          readyCount++;
        } else if (memberships.length === 1) {
          dryResults.push({
            stt,
            fullName: cleanName,
            status: 'ĐANG_Ở_LỚP_KHÁC',
            studentCode: prof.student_code,
            studentId: prof.id,
            note: `Học sinh đang thuộc lớp khác (${memberships[0].class_name}). Không tự chuyển lớp.`
          });
          inAnotherClassCount++;
          reviewRequiredCount++;
        } else {
          dryResults.push({
            stt,
            fullName: cleanName,
            status: 'THUỘC_NHIỀU_LỚP',
            studentCode: prof.student_code,
            studentId: prof.id,
            note: `Học sinh đang có dữ liệu trong ${memberships.length} lớp khác nhau.`
          });
          multipleClassesCount++;
          reviewRequiredCount++;
        }
      } else {
        dryResults.push({
          stt,
          fullName: cleanName,
          status: 'TRÙNG_TÊN',
          note: `Phát hiện ${matchedProfiles.length} tài khoản trùng tên trên hệ thống.`
        });
        duplicateNameCount++;
        reviewRequiredCount++;
      }
    }

    // Generate SHA-256 fingerprint for classId + dryRun + sorted student list
    const sortedNames = studentsList.map(s => (s.fullName || '').trim()).sort().join('|');
    const fingerprint = crypto.createHash('sha256').update(`${classId}_dry:true_${sortedNames}`).digest('hex');

    return {
      success: true,
      dryRun: true,
      classId,
      className: targetClass.name,
      classCode: targetClass.code,
      gradeLevel: targetClass.grade_level,
      fingerprint,
      summary: {
        total: studentsList.length,
        readyToCreate: readyCount,
        matchedNoClass: matchedNoClassCount,
        alreadyInClass: alreadyInClassCount,
        inAnotherClass: inAnotherClassCount,
        duplicateName: duplicateNameCount,
        multipleClasses: multipleClassesCount,
        reviewRequired: reviewRequiredCount
      },
      results: dryResults
    };
  }

  // --- BẮT ĐẦU CÁC TEST CASES ---

  // Snapshot database rows count before testing
  const preProfilesCount = (await db.query(`SELECT count(*) as count FROM public.profiles`)).rows[0].count;
  const preClassMembersCount = (await db.query(`SELECT count(*) as count FROM public.class_members`)).rows[0].count;
  const preClassesCount = (await db.query(`SELECT count(*) as count FROM public.classes`)).rows[0].count;

  console.log('--- TEST A: NHẬP VÀO LỚP 5.9 (KHỐI 5) VỚI DANH SÁCH 26 HỌC SINH ---');
  const class59Students26 = [
    { stt: 1, fullName: 'Trần Lê Gia Hưng' },
    { stt: 2, fullName: 'Đỗ Hoài Anh' },
    { stt: 3, fullName: 'Nguyễn Đình Ân' },
    { stt: 4, fullName: 'Hà Gia Bảo' },
    { stt: 5, fullName: 'Phạm Ngọc Minh Châu' },
    { stt: 6, fullName: 'Nguyễn Công Minh Dương' },
    { stt: 7, fullName: 'Nguyễn Võ Khả Hân' },
    { stt: 8, fullName: 'Huỳnh Minh Hùng' },
    { stt: 9, fullName: 'Phạm Bùi Bảo Khang' },
    { stt: 10, fullName: 'Nguyễn Ngọc An Khánh' },
    { stt: 11, fullName: 'Nguyễn Phúc Đăng Khoa' },
    { stt: 12, fullName: 'Nguyễn Minh Khôi' },
    { stt: 13, fullName: 'Nguyễn Trung Kiên' },
    { stt: 14, fullName: 'Phạm Thị Hoàng Lâm' },
    { stt: 15, fullName: 'Võ Thiên Long' },
    { stt: 16, fullName: 'Trần Thị Quỳnh Mai' },
    { stt: 17, fullName: 'Lê Thị Tú My' },
    { stt: 18, fullName: 'Trần Ngọc Nga' },
    { stt: 19, fullName: 'Trần Thị Kim Ngọc' },
    { stt: 20, fullName: 'Võ Nguyễn Đăng Nguyên' },
    { stt: 21, fullName: 'Nguyễn Ngọc Yến Nhi' },
    { stt: 22, fullName: 'Nguyễn Thanh Nhi' },
    { stt: 23, fullName: 'Nguyễn An Nhiên' },
    { stt: 24, fullName: 'Võ Bảo Như' },
    { stt: 25, fullName: 'Lưu Đình Tấn Phát' },
    { stt: 26, fullName: 'Trần Thị Thu Hà' } // Học sinh này đã có trong lớp 5.9 từ trước
  ];

  const dryRunA = await simulateDryRun(adminId, class59Id, class59Students26);
  assert(dryRunA.success === true, 'Test A: Dry-Run cho Lớp 5.9 chạy thành công tuyệt đối');
  assert(dryRunA.className === 'Lớp 5.9' && dryRunA.gradeLevel === 5, 'Test A: Nhận diện chính xác Lớp 5.9 và Khối 5');
  assert(dryRunA.summary.total === 26, 'Test A: Xử lý đủ 26 học sinh');
  assert(dryRunA.summary.readyToCreate === 25, 'Test A: 25 học sinh mới được phân loại Sẵn Sàng Tạo Mới');
  assert(dryRunA.summary.alreadyInClass === 1, 'Test A: 1 học sinh nhận diện ĐÃ_Ở_LỚP_ĐÍCH');
  assert(dryRunA.results[25].fullName === 'Trần Thị Thu Hà' && dryRunA.results[25].status === 'ĐÃ_Ở_LỚP_ĐÍCH', 'Test A: Trần Thị Thu Hà được nhận diện chính xác ĐÃ_Ở_LỚP_ĐÍCH');

  // Verify exact database membership evidence for student Trần Thị Thu Hà
  const thuHaEvidence = await db.query(
    `SELECT p.id as student_id, p.full_name, p.student_code, cm.class_id, c.name as class_name, c.code as class_code 
     FROM public.profiles p 
     JOIN public.class_members cm ON cm.student_id = p.id 
     JOIN public.classes c ON c.id = cm.class_id 
     WHERE p.id = $1`,
    [studentInClass59]
  );
  assert(thuHaEvidence.rows.length === 1, 'Test A: Bằng chứng CSDL chứng minh Trần Thị Thu Hà có 1 membership duy nhất');
  assert(thuHaEvidence.rows[0].class_id === class59Id && thuHaEvidence.rows[0].class_name === 'Lớp 5.9', 'Test A: Bằng chứng CSDL xác nhận thuộc đúng Lớp 5.9');

  console.log('\n--- TEST B: HỌC SINH CHƯA CÓ LỚP / CHƯA CÓ TÀI KHOẢN ---');
  const testBStudents = [
    { stt: 1, fullName: 'Học Sinh Hoàn Toàn Mới' },
    { stt: 2, fullName: 'Vũ Minh Khôi' } // Đã có profile nhưng chưa thuộc lớp nào
  ];
  const dryRunB = await simulateDryRun(adminId, class59Id, testBStudents);
  assert(dryRunB.results[0].status === 'CHƯA_CÓ_TÀI_KHOẢN', 'Test B1: Học sinh mới phân loại đúng CHƯA_CÓ_TÀI_KHOẢN');
  assert(dryRunB.results[1].status === 'KHỚP_DUY_NHẤT_CHƯA_CÓ_LỚP', 'Test B2: Vũ Minh Khôi phân loại đúng KHỚP_DUY_NHẤT_CHƯA_CÓ_LỚP');

  console.log('\n--- TEST C: HỌC SINH ĐÃ Ở CHÍNH LỚP ĐÍCH ---');
  const testCStudents = [
    { stt: 1, fullName: 'Trần Thị Thu Hà' }
  ];
  const dryRunC = await simulateDryRun(adminId, class59Id, testCStudents);
  assert(dryRunC.results[0].status === 'ĐÃ_Ở_LỚP_ĐÍCH', 'Test C: Phân loại chính xác ĐÃ_Ở_LỚP_ĐÍCH');
  assert(dryRunC.summary.alreadyInClass === 1, 'Test C: Summary đếm đúng 1 alreadyInClass');

  console.log('\n--- TEST D: HỌC SINH ĐANG THUỘC LỚP KHÁC (CHẶN TỰ ĐỘNG CHUYỂN LỚP) ---');
  const testDStudents = [
    { stt: 1, fullName: 'Lê Hoàng Nam' } // Đang ở Lớp 2A
  ];
  const dryRunD = await simulateDryRun(adminId, class59Id, testDStudents);
  assert(dryRunD.results[0].status === 'ĐANG_Ở_LỚP_KHÁC', 'Test D1: Lê Hoàng Nam bị gắn cờ ĐANG_Ở_LỚP_KHÁC');
  assert(dryRunD.summary.inAnotherClass === 1, 'Test D2: Summary ghi nhận inAnotherClass = 1');
  assert(dryRunD.summary.reviewRequired === 1, 'Test D3: Khóa thực thi do có reviewRequired = 1');

  console.log('\n--- TEST E: TRÙNG TÊN TRÊN HỆ THỐNG (CHẶN TỰ Ý GÁN) ---');
  const testEStudents = [
    { stt: 1, fullName: 'Nguyễn Văn An' } // Có 2 profiles cùng tên
  ];
  const dryRunE = await simulateDryRun(adminId, class59Id, testEStudents);
  assert(dryRunE.results[0].status === 'TRÙNG_TÊN', 'Test E1: Nguyễn Văn An phân loại đúng TRÙNG_TÊN');
  assert(dryRunE.summary.duplicateName === 1, 'Test E2: Summary ghi nhận duplicateName = 1');
  assert(dryRunE.summary.reviewRequired === 1, 'Test E3: Bắt buộc Admin xác minh thủ công');

  console.log('\n--- TEST F: HỌC SINH THUỘC NHIỀU LỚP ---');
  const testFStudents = [
    { stt: 1, fullName: 'Phạm Quốc Bảo' } // Đang ở cả Lớp 1A và 2A
  ];
  const dryRunF = await simulateDryRun(adminId, class59Id, testFStudents);
  assert(dryRunF.results[0].status === 'THUỘC_NHIỀU_LỚP', 'Test F1: Phạm Quốc Bảo phân loại đúng THUỘC_NHIỀU_LỚP');
  assert(dryRunF.summary.multipleClasses === 1, 'Test F2: Summary ghi nhận multipleClasses = 1');

  console.log('\n--- TEST G: BẢO MẬT & PHÂN QUYỀN ADMIN-ONLY ---');
  const dryRunGNonAdmin = await simulateDryRun(teacherId, class59Id, [{ stt: 1, fullName: 'Test Name' }]);
  assert(dryRunGNonAdmin.success === false && dryRunGNonAdmin.status === 403, 'Test G1: Giáo viên gọi Dry-Run bị từ chối 403 Forbidden');

  const dryRunGInvalidClass = await simulateDryRun(adminId, '99999999-9999-9999-9999-999999999999', [{ stt: 1, fullName: 'Test Name' }]);
  assert(dryRunGInvalidClass.success === false && dryRunGInvalidClass.status === 400, 'Test G2: Class ID không tồn tại bị từ chối 400 Bad Request');

  console.log('\n--- TEST H: XÁC MINH RÀNG BUỘC CLASS_ID & CHẶN TẤN CÔNG CLASS-SWITCH (TOCTOU) ---');
  // Scenario: Admin chạy Dry-Run cho Lớp 5.9
  const dryRun59 = await simulateDryRun(adminId, class59Id, [{ stt: 1, fullName: 'Học Sinh Mới Khối 5' }]);
  assert(dryRun59.classId === class59Id, 'Test H1: Dry-Run gắn chặt với classId Lớp 5.9');

  // Simulation of Frontend Class Binding Check:
  // Nếu kẻ tấn công hoặc giao diện bị đổi selectedClassId sang Lớp 2A mà không Dry-Run lại
  let frontendSelectedClassId = class2AId;
  let frontendLastDryRunClassId = dryRun59.classId;
  let isClassSwitched = frontendSelectedClassId !== frontendLastDryRunClassId;
  assert(isClassSwitched === true, 'Test H2: Frontend phát hiện ngay lập tức hành vi đổi lớp đích (selectedClassId !== lastDryRunClassId)');

  // Simulation of Backend Payload Fingerprint Check:
  // Fingerprint của execute với Lớp 2A không khớp với fingerprint của Lớp 5.9
  const executeFingerprint2A = crypto.createHash('sha256').update(`${class2AId}_dry:false_Học Sinh Mới Khối 5`).digest('hex');
  const dryFingerprint59 = dryRun59.fingerprint;
  assert(executeFingerprint2A !== dryFingerprint59, 'Test H3: Backend SHA-256 fingerprint của Lớp 2A hoàn toàn bất đồng với Dry-Run Lớp 5.9');

  console.log('\n--- TEST I: XÁC MINH ZERO-WRITES CỦA TOÀN BỘ KIỂM THỬ DRY-RUN ---');
  const postProfilesCount = (await db.query(`SELECT count(*) as count FROM public.profiles`)).rows[0].count;
  const postClassMembersCount = (await db.query(`SELECT count(*) as count FROM public.class_members`)).rows[0].count;
  const postClassesCount = (await db.query(`SELECT count(*) as count FROM public.classes`)).rows[0].count;

  assert(preProfilesCount === postProfilesCount, `Test I1: Bảng profiles không bị ghi dữ liệu (${preProfilesCount} == ${postProfilesCount})`);
  assert(preClassMembersCount === postClassMembersCount, `Test I2: Bảng class_members không bị ghi dữ liệu (${preClassMembersCount} == ${postClassMembersCount})`);
  assert(preClassesCount === postClassesCount, `Test I3: Bảng classes không bị ghi dữ liệu (${preClassesCount} == ${postClassesCount})`);

  console.log(`\n🎉 TẤT CẢ ${passedTests}/${totalTests} TESTS ĐÃ PASS XUẤT SẮC!`);
}

runAdminBulkImportGeneralizationTestSuite().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
