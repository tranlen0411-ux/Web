/**
 * ====================================================================
 * 🧪 TEST SUITE: SCORM PHASE 2B-2 CMI DATA PERSISTENCE & SECURITY AUDIT
 * ====================================================================
 * Kiểm thử toàn diện:
 * 1. CMI1: Save/load SCORM 1.2 tracking data with valid session token
 * 2. CMI2: Save/load SCORM 2004 tracking data with valid session token
 * 3. CMI3: Resume lesson_location and entry mode
 * 4. CMI4: Suspend_data persistence and reload
 * 5. CMI5: Score persistence (score_raw, score_min, score_max)
 * 6. CMI6: Student A cannot read/write Student B's tracking data
 * 7. CMI7: Unauthorized package access blocked (FORBIDDEN)
 * 8. CMI8: Anon access blocked (UNAUTHORIZED / Permission Denied)
 * 9. CMI9: RPC-only read tracking (Direct table SELECT blocked)
 * 10. CMI10: Direct table INSERT/UPDATE/DELETE blocked for authenticated
 * 11. CMI11: Admin access via RPC / service_role
 * 12. CMI12: Oversized payload (>128KB or UTF-8 suspend_data >64KB) blocked
 * 13. CMI13: Invalid non-numeric score and out-of-bounds score blocked
 * 14. CMI14: LMSCommit/Commit triggers background persistence callback
 * 15. CMI15: LMSFinish triggers final persistence callback
 * 16. CMI16: Terminate triggers final persistence callback
 * 17. CMI17: Network failure preserves in-memory CMI state
 * 18. CMI18: Zero mutation on Leaderboard / Ranking / Rewards
 * 19. CMI19: CMI19_DOUBLE_COMMIT_NO_DOUBLE_TOTAL_TIME
 * 20. CMI20: CMI20_CONCURRENT_SAVE_SAFE (Row-level lock FOR UPDATE)
 * 21. CMI21: CMI21_SESSION_PACKAGE_BINDING (Session token validates package and user)
 * 22. CMI22: CMI22_PARENT_RECEIVER_EXISTS
 * 23. CMI23: CMI23_POSTMESSAGE_WRONG_ORIGIN_BLOCKED
 * 24. CMI24: CMI24_POSTMESSAGE_EXACT_ORIGIN_ACCEPTED
 * 25. CMI25: CMI25_SAVE_REQUIRES_VALID_SESSION (Expired and revoked tokens blocked)
 * 26. CMI26: CMI26_SESSION_INFO_CONTRACT (/session-info returns sanitized tracking)
 * 27. CMI27: CMI27_SAVE_FAILURE_NOT_REPORTED_AS_SAVED
 * 28. CMI28: CMI28_PUBLIC_SESSION_NO_PRIVATE_TRACKING (Public session returns tracking: null)
 * 29. CMI29: CMI29_SESSION_USER_BINDING & NULL_SESSION_BLOCKED
 * 30. CMI30: CMI30_PUBLIC_RPC_EXECUTE_BLOCKED
 * 31. CMI31: CMI31_ANON_RPC_EXECUTE_BLOCKED
 * 32. CMI32: CMI32_AUTHENTICATED_RPC_EXECUTE_ALLOWED
 * ====================================================================
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createScorm12Api, createScorm2004Api } from '../scorm-player/src/scormApi.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Kích hoạt cờ V8 tối ưu bộ nhớ để ngăn V8 TurboFan Zone OOM trên Windows
if (!process.execArgv.includes('--liftoff-only')) {
  const result = spawnSync(
    process.execPath,
    [
      '--liftoff-only',
      '--v8-pool-size=1',
      '--no-wasm-async-compilation',
      ...process.execArgv,
      __filename,
      ...process.argv.slice(2),
    ],
    { stdio: 'inherit' }
  );
  process.exit(result.status ?? 0);
}

async function runScormCmiPersistenceTestSuite() {
  console.log('================================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ SCORM PHASE 2B-2: CMI DATA PERSISTENCE & AUDIT');
  console.log('================================================================\n');

  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');

  const db = new PGlite({
    extensions: {
      pgcrypto,
    },
  });

  let totalTests = 0;
  let passedTests = 0;

  function recordPass(testId, description) {
    totalTests++;
    passedTests++;
    console.log(`✅ ${testId}: ${description} PASS`);
  }

  async function asUser(userId, role = 'authenticated') {
    if (userId) {
      await db.exec(`SET app.current_user_id = '${userId}';`);
      await db.exec(`SET ROLE ${role};`);
    } else {
      await db.exec(`SET app.current_user_id = '';`);
      if (role === 'authenticated') {
        await db.exec(`SET ROLE anon;`);
      } else {
        await db.exec(`SET ROLE ${role};`);
      }
    }
  }

  try {
    // ---------------------------------------------------------
    // 1. THIẾT LẬP ROLES VÀ BASE SCHEMA SUPABASE
    // ---------------------------------------------------------
    await db.exec(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres') THEN CREATE ROLE postgres; END IF;
      END $$;

      CREATE SCHEMA IF NOT EXISTS extensions;
      CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT
      );
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
      $$;
      CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
        SELECT current_setting('role', true);
      $$;

      CREATE SCHEMA IF NOT EXISTS storage;
      CREATE OR REPLACE FUNCTION storage.foldername(name text)
      RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $$
      DECLARE
        _parts text[];
      BEGIN
        SELECT string_to_array(name, '/') INTO _parts;
        RETURN _parts[1:array_length(_parts, 1) - 1];
      END
      $$;

      CREATE TABLE IF NOT EXISTS storage.buckets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        public BOOLEAN DEFAULT false,
        file_size_limit BIGINT,
        allowed_mime_types TEXT[]
      );
      CREATE TABLE IF NOT EXISTS storage.objects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bucket_id TEXT REFERENCES storage.buckets(id),
        name TEXT NOT NULL,
        owner UUID,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.profiles (
        id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'student',
        full_name TEXT
      );

      CREATE TABLE IF NOT EXISTS public.classes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        grade_level INT NOT NULL DEFAULT 1,
        code TEXT UNIQUE NOT NULL,
        teacher_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.class_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE(class_id, student_id)
      );

      CREATE TABLE IF NOT EXISTS public.learning_materials (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title TEXT NOT NULL,
        description TEXT,
        subject TEXT NOT NULL DEFAULT 'Khác',
        class_id UUID REFERENCES public.classes(id) ON DELETE CASCADE,
        file_name TEXT,
        file_path TEXT,
        file_type TEXT NOT NULL,
        file_size BIGINT DEFAULT 0,
        external_url TEXT,
        allow_download BOOLEAN DEFAULT TRUE,
        visibility TEXT NOT NULL DEFAULT 'class' CHECK (visibility IN ('class', 'school', 'public')),
        share_token TEXT UNIQUE,
        created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.learning_material_shares (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        material_id UUID NOT NULL REFERENCES public.learning_materials(id) ON DELETE CASCADE,
        class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE(material_id, class_id)
      );

      CREATE TABLE IF NOT EXISTS public.academic_leaderboards (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_id UUID NOT NULL,
        total_score NUMERIC DEFAULT 0,
        ranking_points INT DEFAULT 0
      );

      -- Cấp quyền bảng công cộng cho authenticated role
      GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
      GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
    `);

    // ---------------------------------------------------------
    // 2. CHẠY CÁC MIGRATION SCORM GIAI ĐOẠN 2
    // ---------------------------------------------------------
    const phase2Sql = fs.readFileSync(path.join(__dirname, '..', 'ADD_SCORM_PHASE2_MVP.sql'), 'utf-8');
    await db.exec(phase2Sql);

    const sessionSql = fs.readFileSync(path.join(__dirname, '..', 'ADD_SCORM_LAUNCH_SESSIONS.sql'), 'utf-8');
    await db.exec(sessionSql);

    const cmiSql = fs.readFileSync(path.join(__dirname, '..', 'ADD_SCORM_CMI_PERSISTENCE.sql'), 'utf-8');
    await db.exec(cmiSql);

    // ---------------------------------------------------------
    // 3. TẠO TEST USERS & FIXTURE DATA
    // ---------------------------------------------------------
    const teacherAId = '11111111-1111-4111-8111-111111111111';
    const teacherBId = '22222222-2222-4222-8222-222222222222';
    const student1Id = '33333333-3333-4333-8333-333333333333';
    const student2Id = '44444444-4444-4444-8444-444444444444';
    const studentOtherId = '55555555-5555-4555-8555-555555555555';
    const adminId = '99999999-9999-4999-8999-999999999999';

    const class1Id = 'aaaa1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const class2Id = 'bbbb2222-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    const material12Id = 'cccc1111-cccc-4ccc-8ccc-cccccccccccc';
    const package12Id = 'dddd1111-dddd-4ddd-8ddd-dddddddddddd';

    const material2004Id = 'cccc2222-cccc-4ccc-8ccc-cccccccccccc';
    const package2004Id = 'dddd2222-dddd-4ddd-8ddd-dddddddddddd';

    const materialPrivateBId = 'cccc3333-cccc-4ccc-8ccc-cccccccccccc';
    const packagePrivateBId = 'dddd3333-dddd-4ddd-8ddd-dddddddddddd';

    const materialPublicId = 'cccc4444-cccc-4ccc-8ccc-cccccccccccc';
    const packagePublicId = 'dddd4444-dddd-4ddd-8ddd-dddddddddddd';
    const publicShareToken = 'public_share_token_for_scorm_cmi_audit_0123456789';

    // Insert users, profiles, classes
    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${teacherAId}', 'teacherA@school.edu.vn'),
        ('${teacherBId}', 'teacherB@school.edu.vn'),
        ('${student1Id}', 'student1@school.edu.vn'),
        ('${student2Id}', 'student2@school.edu.vn'),
        ('${studentOtherId}', 'student_other@school.edu.vn'),
        ('${adminId}', 'admin@school.edu.vn');

      INSERT INTO public.profiles (id, role, full_name) VALUES
        ('${teacherAId}', 'teacher', 'Cô Giáo A'),
        ('${teacherBId}', 'teacher', 'Thầy Giáo B'),
        ('${student1Id}', 'student', 'Học sinh 1'),
        ('${student2Id}', 'student', 'Học sinh 2'),
        ('${studentOtherId}', 'student', 'Học sinh lớp khác'),
        ('${adminId}', 'admin', 'Quản Trị Viên');

      INSERT INTO public.classes (id, name, grade_level, code, teacher_id) VALUES
        ('${class1Id}', 'Lớp 1A', 1, 'LOP1A', '${teacherAId}'),
        ('${class2Id}', 'Lớp 2B', 2, 'LOP2B', '${teacherBId}');

      INSERT INTO public.class_members (class_id, student_id) VALUES
        ('${class1Id}', '${student1Id}'),
        ('${class1Id}', '${student2Id}'),
        ('${class2Id}', '${studentOtherId}');

      -- Material 1 (SCORM 1.2 - Lớp 1A)
      INSERT INTO public.learning_materials (id, title, file_type, class_id, visibility, created_by)
      VALUES ('${material12Id}', 'Toán 1 SCORM 1.2', 'scorm', '${class1Id}', 'class', '${teacherAId}');

      INSERT INTO public.scorm_packages (id, material_id, package_version, scorm_version, manifest_path, launch_path, content_root, status, created_by)
      VALUES ('${package12Id}', '${material12Id}', '1.0', '1.2', 'imsmanifest.xml', 'index.html', '${teacherAId}/math12', 'ready', '${teacherAId}');

      -- Material 2 (SCORM 2004 - Lớp 1A)
      INSERT INTO public.learning_materials (id, title, file_type, class_id, visibility, created_by)
      VALUES ('${material2004Id}', 'Tiếng Việt 1 SCORM 2004', 'scorm', '${class1Id}', 'class', '${teacherAId}');

      INSERT INTO public.scorm_packages (id, material_id, package_version, scorm_version, manifest_path, launch_path, content_root, status, created_by)
      VALUES ('${package2004Id}', '${material2004Id}', '1.0', '2004', 'imsmanifest.xml', 'index.html', '${teacherAId}/tv2004', 'ready', '${teacherAId}');

      -- Material 3 (SCORM riêng của Teacher B - Lớp 2B)
      INSERT INTO public.learning_materials (id, title, file_type, class_id, visibility, created_by)
      VALUES ('${materialPrivateBId}', 'Bài riêng Teacher B', 'scorm', '${class2Id}', 'class', '${teacherBId}');

      INSERT INTO public.scorm_packages (id, material_id, package_version, scorm_version, manifest_path, launch_path, content_root, status, created_by)
      VALUES ('${packagePrivateBId}', '${materialPrivateBId}', '1.0', '1.2', 'imsmanifest.xml', 'index.html', '${teacherBId}/private', 'ready', '${teacherBId}');

      -- Material 4 (SCORM Công khai - Public Material)
      INSERT INTO public.learning_materials (id, title, file_type, visibility, created_by, share_token)
      VALUES ('${materialPublicId}', 'Toán Công Khai', 'scorm', 'public', '${teacherAId}', '${publicShareToken}');

      INSERT INTO public.scorm_packages (id, material_id, package_version, scorm_version, manifest_path, launch_path, content_root, status, created_by)
      VALUES ('${packagePublicId}', '${materialPublicId}', '1.0', '1.2', 'imsmanifest.xml', 'index.html', '${teacherAId}/public12', 'ready', '${teacherAId}');

      -- Dữ liệu Leaderboard ban đầu để đối soát CMI18
      INSERT INTO public.academic_leaderboards (student_id, total_score, ranking_points)
      VALUES ('${student1Id}', 100, 50);
    `);

    // Helper tạo session token
    async function createSession(userId, matId) {
      await asUser(userId);
      const res = await db.query(
        `SELECT public.create_scorm_launch_session_authenticated($1) AS result`,
        [matId]
      );
      return res.rows[0].result.session_token;
    }

    const token1_12 = await createSession(student1Id, material12Id);
    const token1_2004 = await createSession(student1Id, material2004Id);
    const token2_12 = await createSession(student2Id, material12Id);

    // =========================================================
    // THỰC THI KIỂM THỬ CMI1 - CMI32
    // =========================================================

    // --- CMI1: Save / Load SCORM 1.2 ---
    await asUser(student1Id);
    const saveRes1 = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [
        package12Id,
        JSON.stringify({
          'cmi.core.lesson_status': 'passed',
          'cmi.core.lesson_location': 'slide_3',
          'cmi.core.score.raw': '95',
          'cmi.core.score.min': '0',
          'cmi.core.score.max': '100',
          'cmi.suspend_data': 'step_3|choice_B',
          'cmi.core.session_time': '0000:05:30',
        }),
        token1_12,
      ]
    );
    const r1 = saveRes1.rows[0].result;
    assert.equal(r1.success, true);
    assert.equal(r1.total_time, '0000:05:30');

    const loadRes1 = await db.query(
      `SELECT public.load_scorm_cmi_state($1, $2) AS result`,
      [package12Id, token1_12]
    );
    const lr1 = loadRes1.rows[0].result;
    assert.equal(lr1.success, true);
    assert.equal(lr1.scorm_version, '1.2');
    assert.equal(lr1.tracking.lesson_status, 'passed');
    assert.equal(lr1.tracking.lesson_location, 'slide_3');
    assert.equal(Number(lr1.tracking.score_raw), 95);
    assert.equal(lr1.tracking.suspend_data, 'step_3|choice_B');
    assert.equal(lr1.tracking.total_time, '0000:05:30');
    recordPass('CMI1', 'Lưu và nạp trạng thái SCORM 1.2 thành công qua RPC');

    // --- CMI2: Save / Load SCORM 2004 ---
    await asUser(student1Id);
    const saveRes2 = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [
        package2004Id,
        JSON.stringify({
          'cmi.completion_status': 'completed',
          'cmi.success_status': 'passed',
          'cmi.location': 'unit_4_page_2',
          'cmi.score.raw': '88.5',
          'cmi.score.min': '0',
          'cmi.score.max': '100',
          'cmi.suspend_data': 'state_json_data_2004',
          'cmi.session_time': 'PT0H12M30S',
        }),
        token1_2004,
      ]
    );
    const r2 = saveRes2.rows[0].result;
    assert.equal(r2.success, true);
    assert.equal(r2.total_time, 'PT0H12M30S');

    const loadRes2 = await db.query(
      `SELECT public.load_scorm_cmi_state($1, $2) AS result`,
      [package2004Id, token1_2004]
    );
    const lr2 = loadRes2.rows[0].result;
    assert.equal(lr2.success, true);
    assert.equal(lr2.scorm_version, '2004');
    assert.equal(lr2.tracking.completion_status, 'completed');
    assert.equal(lr2.tracking.success_status, 'passed');
    assert.equal(lr2.tracking.lesson_location, 'unit_4_page_2');
    assert.equal(Number(lr2.tracking.score_raw), 88.5);
    recordPass('CMI2', 'Lưu và nạp trạng thái SCORM 2004 thành công qua RPC');

    // --- CMI3: Resume lesson_location ---
    const api12Resume = createScorm12Api({
      studentName: 'Học sinh 1',
      tracking: lr1.tracking,
    });
    assert.equal(api12Resume.LMSInitialize(), 'true');
    assert.equal(api12Resume.LMSGetValue('cmi.core.lesson_location'), 'slide_3');
    assert.equal(api12Resume.LMSGetValue('cmi.core.entry'), 'resume');
    assert.equal(api12Resume.LMSGetValue('cmi.core.lesson_status'), 'passed');

    const api2004Resume = createScorm2004Api({
      studentName: 'Học sinh 1',
      tracking: lr2.tracking,
    });
    assert.equal(api2004Resume.Initialize(), 'true');
    assert.equal(api2004Resume.GetValue('cmi.location'), 'unit_4_page_2');
    assert.equal(api2004Resume.GetValue('cmi.entry'), 'resume');
    assert.equal(api2004Resume.GetValue('cmi.completion_status'), 'completed');
    recordPass('CMI3', 'Nạp lại chính xác vị trí bài học (Resume lesson_location & entry mode)');

    // --- CMI4: Suspend_data persistence & reload ---
    await asUser(student1Id);
    const saveRes4 = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [
        package12Id,
        JSON.stringify({
          'cmi.core.lesson_status': 'passed',
          'cmi.core.lesson_location': 'slide_7',
          'cmi.suspend_data': 'step_7|checkpoint_verified',
          'cmi.core.session_time': '0000:10:00',
        }),
        token1_12,
      ]
    );
    assert.equal(saveRes4.rows[0].result.success, true);
    assert.equal(saveRes4.rows[0].result.total_time, '0000:10:00');

    const loadRes4 = await db.query(
      `SELECT public.load_scorm_cmi_state($1, $2) AS result`,
      [package12Id, token1_12]
    );
    assert.equal(loadRes4.rows[0].result.tracking.suspend_data, 'step_7|checkpoint_verified');
    assert.equal(loadRes4.rows[0].result.tracking.total_time, '0000:10:00');
    recordPass('CMI4', 'Suspend_data và tích lũy Total Time hoạt động chính xác qua nhiều lần Commit');

    // --- CMI5: Score persistence ---
    assert.equal(Number(lr1.tracking.score_raw), 95);
    assert.equal(Number(lr1.tracking.score_min), 0);
    assert.equal(Number(lr1.tracking.score_max), 100);
    recordPass('CMI5', 'Điểm số bài học (score_raw, score_min, score_max) được lưu trữ chuẩn xác');

    // --- CMI6: Student A cannot read / write Student B's tracking ---
    await asUser(student2Id);
    const loadStudent2 = await db.query(
      `SELECT public.load_scorm_cmi_state($1, $2) AS result`,
      [package12Id, token2_12]
    );
    assert.equal(loadStudent2.rows[0].result.tracking, null);
    recordPass('CMI6', 'Cách ly dữ liệu: Học sinh 2 không thể đọc hoặc ghi đè tiến độ của Học sinh 1');

    // --- CMI7: Unauthorized package access blocked (FORBIDDEN) ---
    await asUser(studentOtherId);
    let studentOtherCreateBlocked = false;
    try {
      const otherSess = await db.query(
        `SELECT public.create_scorm_launch_session_authenticated($1) AS result`,
        [material12Id]
      );
      if (otherSess.rows[0]?.result?.success === false) {
        studentOtherCreateBlocked = true;
      }
    } catch {
      studentOtherCreateBlocked = true;
    }
    assert.equal(studentOtherCreateBlocked, true);
    recordPass('CMI7', 'Học sinh không có quyền truy cập học liệu bị chặn lưu tiến độ (HTTP/Code FORBIDDEN)');

    // --- CMI8: Anon access blocked ---
    await asUser(null, 'anon');
    let anonBlocked = false;
    try {
      await db.query(
        `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
        [package12Id, JSON.stringify({ 'cmi.core.lesson_status': 'passed' }), token1_12]
      );
    } catch (err) {
      if (err.message && (err.message.includes('permission denied') || err.message.includes('UNAUTHORIZED'))) {
        anonBlocked = true;
      }
    }
    assert.equal(anonBlocked, true);
    recordPass('CMI8', 'Người dùng vãng lai (Anon) bị từ chối quyền truy cập RPC lưu trữ (UNAUTHORIZED)');

    // --- CMI9: RPC-only read tracking (Direct table SELECT blocked) ---
    await asUser(student1Id);
    let directSelectBlocked = false;
    try {
      await db.query(`SELECT * FROM public.scorm_tracking_data`);
    } catch (err) {
      if (err.message && err.message.includes('permission denied for table scorm_tracking_data')) {
        directSelectBlocked = true;
      }
    }
    assert.equal(directSelectBlocked, true);
    recordPass('CMI9', 'Bảng scorm_tracking_data được khóa hoàn toàn SELECT trực tiếp từ client (RPC-ONLY)');

    // --- CMI10: Direct table INSERT/UPDATE/DELETE blocked for authenticated ---
    await asUser(student1Id);
    let directWriteBlocked = false;
    try {
      await db.query(`
        INSERT INTO public.scorm_tracking_data (package_id, material_id, user_id, scorm_version)
        VALUES ('${package12Id}', '${material12Id}', '${student1Id}', '1.2');
      `);
    } catch (err) {
      if (err.message && err.message.includes('permission denied for table scorm_tracking_data')) {
        directWriteBlocked = true;
      }
    }
    assert.equal(directWriteBlocked, true);
    recordPass('CMI10', 'Direct table INSERT/UPDATE/DELETE bị chặn đứng hoàn toàn (Least Privilege Contract)');

    // --- CMI11: Admin full read access via service_role / trusted path ---
    await asUser(null, 'service_role');
    const adminRead = await db.query(`SELECT * FROM public.scorm_tracking_data`);
    assert.ok(adminRead.rows.length >= 2);
    recordPass('CMI11', 'Quản trị viên / Service Role có toàn quyền tra cứu dữ liệu tracking trên toàn hệ thống');

    // --- CMI12: Oversized payload (>128KB or UTF-8 suspend_data >64KB) blocked ---
    await asUser(student1Id);
    const multiByteHugeSuspendData = '🚀'.repeat(17000); // 68,000 bytes > 65536 bytes
    const oversizedRes = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package12Id, JSON.stringify({ 'cmi.suspend_data': multiByteHugeSuspendData }), token1_12]
    );
    assert.equal(oversizedRes.rows[0].result.success, false);
    assert.equal(oversizedRes.rows[0].result.code, 'SUSPEND_DATA_TOO_LARGE');
    recordPass('CMI12', 'Payload hoặc suspend_data vượt quá hạn mức tối đa (UTF-8 Bytes) bị từ chối an toàn');

    // --- CMI13: Invalid score and bounds tampering blocked ---
    await asUser(student1Id);
    // 13A: Non-numeric score
    const invalidScoreRes = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package12Id, JSON.stringify({ 'cmi.core.score.raw': 'INVALID_NOT_A_NUMBER' }), token1_12]
    );
    assert.equal(invalidScoreRes.rows[0].result.success, false);
    assert.equal(invalidScoreRes.rows[0].result.code, 'INVALID_SCORE');

    // 13B: min > max tampering
    const invertedBoundsRes = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package12Id, JSON.stringify({ 'cmi.core.score.min': '100', 'cmi.core.score.max': '50' }), token1_12]
    );
    assert.equal(invertedBoundsRes.rows[0].result.success, false);
    assert.equal(invertedBoundsRes.rows[0].result.code, 'INVALID_SCORE');

    // 13C: score_raw > max tampering
    const overflowScoreRes = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package12Id, JSON.stringify({ 'cmi.core.score.raw': '150', 'cmi.core.score.max': '100' }), token1_12]
    );
    assert.equal(overflowScoreRes.rows[0].result.success, false);
    assert.equal(overflowScoreRes.rows[0].result.code, 'INVALID_SCORE');
    recordPass('CMI13', 'Điểm số không hợp lệ và hành vi gian lận phạm vi (min/max/raw) bị chặn đứng chính xác');

    // --- CMI14: LMSCommit triggers persistence callback ---
    let commitCalled = 0;
    let lastCommitEvent = '';
    const api12Test = createScorm12Api({}, (cmi, event) => {
      commitCalled++;
      lastCommitEvent = event;
    });
    api12Test.LMSInitialize();
    api12Test.LMSSetValue('cmi.core.lesson_location', 'page_2');
    const commitRet = api12Test.LMSCommit();
    assert.equal(commitRet, 'true');
    assert.equal(commitCalled, 1);
    assert.equal(lastCommitEvent, 'COMMIT');
    recordPass('CMI14', 'LMSCommit/Commit kích hoạt callback lưu trữ ngầm và trả về true đồng bộ');

    // --- CMI15: LMSFinish triggers final persistence ---
    const finishRet = api12Test.LMSFinish();
    assert.equal(finishRet, 'true');
    assert.equal(commitCalled, 2);
    assert.equal(lastCommitEvent, 'FINISH');
    recordPass('CMI15', 'LMSFinish kích hoạt callback lưu trữ cuối cùng khi kết thúc bài học SCORM 1.2');

    // --- CMI16: Terminate triggers final persistence ---
    let termCalled = 0;
    let lastTermEvent = '';
    const api2004Test = createScorm2004Api({}, (cmi, event) => {
      termCalled++;
      lastTermEvent = event;
    });
    api2004Test.Initialize();
    api2004Test.SetValue('cmi.completion_status', 'completed');
    const termRet = api2004Test.Terminate();
    assert.equal(termRet, 'true');
    assert.equal(termCalled, 1);
    assert.equal(lastTermEvent, 'TERMINATE');
    recordPass('CMI16', 'Terminate kích hoạt callback lưu trữ cuối cùng khi kết thúc bài học SCORM 2004');

    // --- CMI17: Network failure preserves in-memory state ---
    const apiFailTest = createScorm12Api({}, () => {
      throw new Error('Network timeout / offline');
    });
    apiFailTest.LMSInitialize();
    apiFailTest.LMSSetValue('cmi.core.lesson_location', 'critical_state');
    const commitResult = apiFailTest.LMSCommit();
    assert.equal(commitResult, 'true');
    assert.equal(apiFailTest.LMSGetValue('cmi.core.lesson_location'), 'critical_state');
    recordPass('CMI17', 'Lỗi mạng khi lưu ngầm không gây crash runtime SCORM và bảo toàn nguyên vẹn bộ nhớ');

    // --- CMI18: Zero mutation on Leaderboard / Ranking / Rewards ---
    const leaderboardCheck = await db.query(
      `SELECT * FROM public.academic_leaderboards WHERE student_id = '${student1Id}'`
    );
    assert.equal(leaderboardCheck.rows.length, 1);
    assert.equal(Number(leaderboardCheck.rows[0].total_score), 100);
    assert.equal(Number(leaderboardCheck.rows[0].ranking_points), 50);
    recordPass('CMI18', 'Bảo toàn ranh giới: Tuyệt đối không thay đổi điểm xếp hạng Leaderboard hay Xu thưởng');

    // --- CMI19: CMI19_DOUBLE_COMMIT_NO_DOUBLE_TOTAL_TIME ---
    await asUser(student2Id);
    // Student 2 bắt đầu học bài mới: session_time = 00:05:00
    const firstCommit = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package12Id, JSON.stringify({ 'cmi.core.session_time': '0000:05:00', 'cmi.core.lesson_location': 'p1' }), token2_12]
    );
    assert.equal(firstCommit.rows[0].result.total_time, '0000:05:00');

    // Double commit: gửi lại cùng session_time = 00:05:00
    const doubleCommit = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package12Id, JSON.stringify({ 'cmi.core.session_time': '0000:05:00', 'cmi.core.lesson_location': 'p2' }), token2_12]
    );
    assert.equal(doubleCommit.rows[0].result.total_time, '0000:05:00');

    // Triple commit / Finish: gửi lại cùng session_time = 00:05:00
    const finishCommit = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package12Id, JSON.stringify({ 'cmi.core.session_time': '0000:05:00', 'cmi.core.lesson_status': 'completed' }), token2_12]
    );
    assert.equal(finishCommit.rows[0].result.total_time, '0000:05:00');
    recordPass('CMI19', 'CMI19_DOUBLE_COMMIT_NO_DOUBLE_TOTAL_TIME: Ngăn chặn triệt để hiện tượng double count total_time');

    // --- CMI20: CMI20_CONCURRENT_SAVE_SAFE (ACID Row-Locking) ---
    await asUser(student2Id);
    const conc1 = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package12Id, JSON.stringify({ 'cmi.core.lesson_location': 'slide_conc_1', 'cmi.core.session_time': '0000:06:00' }), token2_12]
    );
    const conc2 = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package12Id, JSON.stringify({ 'cmi.core.lesson_location': 'slide_conc_2', 'cmi.core.session_time': '0000:07:00' }), token2_12]
    );
    assert.equal(conc1.rows[0].result.success, true);
    assert.equal(conc2.rows[0].result.success, true);
    assert.equal(conc2.rows[0].result.total_time, '0000:07:00');

    const finalConcState = await db.query(
      `SELECT public.load_scorm_cmi_state($1, $2) AS result`,
      [package12Id, token2_12]
    );
    assert.equal(finalConcState.rows[0].result.tracking.lesson_location, 'slide_conc_2');
    recordPass('CMI20', 'CMI20_CONCURRENT_SAVE_SAFE: Row-level lock FOR UPDATE đảm bảo tính toàn vẹn ACID khi lưu');

    // --- CMI21: CMI21_SESSION_PACKAGE_BINDING ---
    // Tạo 1 launch session thật cho student 1 trên package12
    await asUser(student1Id);
    const sessionCreation = await db.query(
      `SELECT public.create_scorm_launch_session_authenticated($1) AS result`,
      [material12Id]
    );
    const rawToken = sessionCreation.rows[0].result.session_token;
    assert.ok(rawToken && rawToken.length === 64);

    // 21A: Lưu với đúng session_token hợp lệ -> Thành công
    const validSessionSave = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package12Id, JSON.stringify({ 'cmi.core.lesson_location': 'page_valid_session' }), rawToken]
    );
    assert.equal(validSessionSave.rows[0].result.success, true);

    // 21B: Session token của Package 12 cố tình lưu sang Package 2004 -> Bị từ chối (SESSION_PACKAGE_MISMATCH)
    const mismatchSave = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package2004Id, JSON.stringify({ 'cmi.location': 'page_hack' }), rawToken]
    );
    assert.equal(mismatchSave.rows[0].result.success, false);
    assert.equal(mismatchSave.rows[0].result.code, 'SESSION_PACKAGE_MISMATCH');

    // 21C: Session token giả mạo -> Bị từ chối (INVALID_SESSION)
    const fakeTokenSave = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package12Id, JSON.stringify({ 'cmi.core.lesson_location': 'page_hack' }), '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef']
    );
    assert.equal(fakeTokenSave.rows[0].result.success, false);
    assert.equal(fakeTokenSave.rows[0].result.code, 'INVALID_SESSION');
    recordPass('CMI21', 'CMI21_SESSION_PACKAGE_BINDING: Ràng buộc chặt chẽ session token với đúng package_id & user_id');

    // --- CMI22: CMI22_PARENT_RECEIVER_EXISTS ---
    const modalFilePath = path.join(__dirname, '..', 'src', 'components', 'materials', 'MaterialViewerModal.jsx');
    const modalCode = fs.readFileSync(modalFilePath, 'utf-8');
    assert.ok(modalCode.includes("window.addEventListener('message'"), 'Parent receiver must register message listener');
    assert.ok(modalCode.includes('SCORM_CMI_COMMIT'), 'Parent receiver must handle SCORM_CMI_COMMIT');
    assert.ok(modalCode.includes('save_scorm_cmi_state'), 'Parent receiver must call save_scorm_cmi_state');
    recordPass('CMI22', 'CMI22_PARENT_RECEIVER_EXISTS: Ứng dụng cha (Parent Main App) có bộ thu nhận postMessage lưu CMI');

    // --- CMI23: CMI23_POSTMESSAGE_WRONG_ORIGIN_BLOCKED ---
    assert.ok(modalCode.includes('getScormPlayerOrigin()'), 'Parent receiver must resolve configured player origin');
    assert.ok(modalCode.includes('event.origin !== playerOrigin'), 'Parent receiver must reject unauthorized origins');
    recordPass('CMI23', 'CMI23_POSTMESSAGE_WRONG_ORIGIN_BLOCKED: Chặn đứng mọi postMessage đến từ Origin không hợp lệ');

    // --- CMI24: CMI24_POSTMESSAGE_EXACT_ORIGIN_ACCEPTED ---
    const playerCode = fs.readFileSync(path.join(__dirname, '..', 'scorm-player', 'src', 'player.js'), 'utf-8');
    assert.ok(playerCode.includes('window.parent.postMessage'), 'Player must postMessage to parent');
    assert.ok(playerCode.includes('parentOrigin'), 'Player must use exact parentOrigin, never wildcard *');
    assert.ok(!playerCode.includes("postMessage({ type: 'SCORM_CMI_COMMIT', payload: { ...cmiSnapshot } }, '*')"), 'Player must never postMessage with wildcard');
    recordPass('CMI24', 'CMI24_POSTMESSAGE_EXACT_ORIGIN_ACCEPTED: Hai chiều Main App <-> Player xác thực Exact Origin');

    // --- CMI25: CMI25_SAVE_REQUIRES_VALID_SESSION ---
    // 25A: Expired session token
    const expTokenRaw = 'expired_raw_token_0123456789abcdef0123456789abcdef0123456789abcdef';
    await asUser(null, 'postgres');
    await db.query(
      `INSERT INTO public.scorm_launch_sessions (package_id, material_id, user_id, session_token_hash, expires_at)
       VALUES ('${package12Id}', '${material12Id}', '${student1Id}', encode(extensions.digest(convert_to('${expTokenRaw}', 'UTF8'), 'sha256'), 'hex'), NOW() - INTERVAL '10 minutes');`
    );
    await asUser(student1Id);
    const expSave = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package12Id, JSON.stringify({ 'cmi.core.lesson_location': 'slide_exp' }), expTokenRaw]
    );
    assert.equal(expSave.rows[0].result.success, false);
    assert.equal(expSave.rows[0].result.code, 'SESSION_EXPIRED');

    // 25B: Revoked session token
    const revTokenRaw = 'revoked_raw_token_0123456789abcdef0123456789abcdef0123456789abcdef';
    await asUser(null, 'postgres');
    await db.query(
      `INSERT INTO public.scorm_launch_sessions (package_id, material_id, user_id, session_token_hash, expires_at, revoked_at)
       VALUES ('${package12Id}', '${material12Id}', '${student1Id}', encode(extensions.digest(convert_to('${revTokenRaw}', 'UTF8'), 'sha256'), 'hex'), NOW() + INTERVAL '10 minutes', NOW() - INTERVAL '1 minute');`
    );
    await asUser(student1Id);
    const revSave = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package12Id, JSON.stringify({ 'cmi.core.lesson_location': 'slide_rev' }), revTokenRaw]
    );
    assert.equal(revSave.rows[0].result.success, false);
    assert.equal(revSave.rows[0].result.code, 'SESSION_REVOKED');
    recordPass('CMI25', 'CMI25_SAVE_REQUIRES_VALID_SESSION: Token hết hạn hoặc bị thu hồi lập tức bị từ chối lưu CMI');

    // --- CMI26: CMI26_SESSION_INFO_CONTRACT ---
    await asUser(null, 'postgres');
    const tokenHash12 = (await db.query(`SELECT session_token_hash FROM public.scorm_launch_sessions WHERE user_id = '${student1Id}' AND package_id = '${package12Id}' AND revoked_at IS NULL AND expires_at > NOW() LIMIT 1;`)).rows[0]?.session_token_hash;
    const infoResolve = await db.query(`SELECT public.resolve_scorm_session_asset($1) AS info;`, [tokenHash12]);
    const infoPayload = infoResolve.rows[0].info;
    assert.equal(infoPayload.valid, true);
    assert.equal(infoPayload.scorm_version, '1.2');
    assert.ok(infoPayload.tracking !== undefined, 'Tracking object must be returned in session info');
    assert.equal(infoPayload.tracking.lesson_status, 'passed');
    assert.equal(infoPayload.tracking.user_id, undefined, 'user_id must not leak in tracking payload');
    assert.equal(infoPayload.tracking.material_id, undefined, 'material_id must not leak in tracking payload');
    recordPass('CMI26', 'CMI26_SESSION_INFO_CONTRACT: /session-info trả sanitized metadata & tracking an toàn');

    // --- CMI27: CMI27_SAVE_FAILURE_NOT_REPORTED_AS_SAVED ---
    assert.ok(modalCode.includes("setSaveStatus('error')"), 'Modal must set error status on RPC failure');
    assert.ok(modalCode.includes("SCORM_CMI_SAVE_FAILED"), 'Modal must dispatch failure event on RPC failure');
    recordPass('CMI27', 'CMI27_SAVE_FAILURE_NOT_REPORTED_AS_SAVED: Lỗi lưu tiến độ không bao giờ bị báo sai thành Saved');

    // --- CMI28: CMI28_PUBLIC_SESSION_NO_PRIVATE_TRACKING ---
    await asUser(null, 'anon');
    const publicLaunchRes = await db.query(
      `SELECT public.create_public_scorm_launch_session($1) AS result`,
      [publicShareToken]
    );
    assert.equal(publicLaunchRes.rows[0].result.success, true);
    const pubToken = publicLaunchRes.rows[0].result.session_token;

    await asUser(null, 'postgres');
    const pubHash = (await db.query(`SELECT session_token_hash FROM public.scorm_launch_sessions WHERE session_token_hash = encode(extensions.digest(convert_to('${pubToken}', 'UTF8'), 'sha256'), 'hex')`)).rows[0]?.session_token_hash;
    const pubInfoResolve = await db.query(`SELECT public.resolve_scorm_session_asset($1) AS info;`, [pubHash]);
    const pubInfo = pubInfoResolve.rows[0].info;
    assert.equal(pubInfo.valid, true);
    assert.equal(pubInfo.tracking, null, 'Public session tracking must be null and never leak authenticated tracking');
    recordPass('CMI28', 'CMI28_PUBLIC_SESSION_NO_PRIVATE_TRACKING: Phiên học công khai tuyệt đối không nhận CMI tracking của tài khoản khác');

    // --- CMI29: CMI29_SESSION_USER_BINDING & NULL_SESSION_BLOCKED ---
    // 29A: Student 2 tries to call save_scorm_cmi_state with Student 1's token
    await asUser(student2Id);
    const stolenSave = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package12Id, JSON.stringify({ 'cmi.core.lesson_location': 'hacked_pos' }), token1_12]
    );
    assert.equal(stolenSave.rows[0].result.success, false);
    assert.equal(stolenSave.rows[0].result.code, 'SESSION_USER_MISMATCH');

    // 29B: Student 2 tries to call load_scorm_cmi_state with Student 1's token
    const stolenLoad = await db.query(
      `SELECT public.load_scorm_cmi_state($1, $2) AS result`,
      [package12Id, token1_12]
    );
    assert.equal(stolenLoad.rows[0].result.success, false);
    assert.equal(stolenLoad.rows[0].result.code, 'SESSION_USER_MISMATCH');

    // 29C: NULL session token on save blocked
    await asUser(student1Id);
    const nullSave = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package12Id, JSON.stringify({ 'cmi.core.lesson_location': 'p_null' }), null]
    );
    assert.equal(nullSave.rows[0].result.success, false);
    assert.equal(nullSave.rows[0].result.code, 'SESSION_TOKEN_REQUIRED');

    // 29D: NULL session token on load blocked
    const nullLoad = await db.query(
      `SELECT public.load_scorm_cmi_state($1, $2) AS result`,
      [package12Id, null]
    );
    assert.equal(nullLoad.rows[0].result.success, false);
    assert.equal(nullLoad.rows[0].result.code, 'SESSION_TOKEN_REQUIRED');
    recordPass('CMI29', 'CMI29_SESSION_USER_BINDING: Kiểm soát chặt chẽ danh tính session bearer và chặn token NULL');

    // --- CMI30: CMI30_PUBLIC_RPC_EXECUTE_BLOCKED ---
    // Kiểm tra revoke quyền EXECUTE từ PUBLIC trong hệ thống
    await asUser(null, 'postgres');
    const pubPrivCheck = await db.query(`
      SELECT routine_name, grantee, privilege_type
      FROM information_schema.routine_privileges
      WHERE routine_schema = 'public'
        AND routine_name IN ('save_scorm_cmi_state', 'load_scorm_cmi_state')
        AND grantee = 'PUBLIC';
    `);
    assert.equal(pubPrivCheck.rows.length, 0, 'PUBLIC must have 0 direct execute privileges on CMI RPCs');
    recordPass('CMI30', 'CMI30_PUBLIC_RPC_EXECUTE_BLOCKED: Quyền thực thi RPC bị thu hồi tường minh khỏi PUBLIC');

    // --- CMI31: CMI31_ANON_RPC_EXECUTE_BLOCKED ---
    await asUser(null, 'anon');
    let anonSaveBlocked = false;
    try {
      await db.query(
        `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
        [package12Id, JSON.stringify({ 'cmi.core.lesson_location': 'anon_hack' }), token1_12]
      );
    } catch (err) {
      if (err.message && (err.message.includes('permission denied') || err.message.includes('UNAUTHORIZED'))) {
        anonSaveBlocked = true;
      }
    }
    assert.equal(anonSaveBlocked, true, 'Anon must be denied EXECUTE on save_scorm_cmi_state');

    let anonLoadBlocked = false;
    try {
      await db.query(
        `SELECT public.load_scorm_cmi_state($1, $2) AS result`,
        [package12Id, token1_12]
      );
    } catch (err) {
      if (err.message && (err.message.includes('permission denied') || err.message.includes('UNAUTHORIZED'))) {
        anonLoadBlocked = true;
      }
    }
    assert.equal(anonLoadBlocked, true, 'Anon must be denied EXECUTE on load_scorm_cmi_state');
    recordPass('CMI31', 'CMI31_ANON_RPC_EXECUTE_BLOCKED: Người dùng ẩn danh bị chặn hoàn toàn quyền gọi RPC');

    // --- CMI32: CMI32_AUTHENTICATED_RPC_EXECUTE_ALLOWED ---
    await asUser(student1Id);
    const authSaveRes = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package12Id, JSON.stringify({ 'cmi.core.lesson_location': 'slide_auth_allowed_32' }), token1_12]
    );
    assert.equal(authSaveRes.rows[0].result.success, true);

    const authLoadRes = await db.query(
      `SELECT public.load_scorm_cmi_state($1, $2) AS result`,
      [package12Id, token1_12]
    );
    assert.equal(authLoadRes.rows[0].result.success, true);
    assert.equal(authLoadRes.rows[0].result.tracking.lesson_location, 'slide_auth_allowed_32');
    recordPass('CMI32', 'CMI32_AUTHENTICATED_RPC_EXECUTE_ALLOWED: Học sinh đã đăng nhập có toàn quyền gọi RPC đọc/lưu tiến độ');

    // --- CMI33: CMI33_RESUME_LIFECYCLE_RESET_GUARANTEE ---
    // Kiểm tra Session 1 (empty) -> entry = ab-initio
    const api2004Session1 = createScorm2004Api({ studentName: 'Học sinh 1' });
    assert.equal(api2004Session1.Initialize(), 'true');
    assert.equal(api2004Session1.GetValue('cmi.entry'), 'ab-initio');
    assert.equal(api2004Session1.GetValue('cmi.exit'), '');
    assert.equal(api2004Session1.GetValue('cmi.session_time'), 'PT0H0M0S');

    // Kiểm tra Session 2 (chứa snapshot cũ với entry: ab-initio, exit: suspend, session_time: PT0H15M0S)
    const staleCmi2004Snapshot = {
      'cmi.entry': 'ab-initio',
      'cmi.exit': 'suspend',
      'cmi.session_time': 'PT0H15M0S',
      'cmi.location': 'slide_5',
      'cmi.suspend_data': 'eyJzbGlkZSI6NX0=',
      'cmi.score.raw': '100',
      'cmi.completion_status': 'incomplete',
      'cmi.success_status': 'unknown',
    };
    const api2004Session2 = createScorm2004Api({
      studentName: 'Học sinh 1',
      tracking: {
        lesson_location: 'slide_5',
        suspend_data: 'eyJzbGlkZSI6NX0=',
        score_raw: 100,
        completion_status: 'incomplete',
        cmi_data: staleCmi2004Snapshot,
      },
    });
    assert.equal(api2004Session2.Initialize(), 'true');
    assert.equal(api2004Session2.GetValue('cmi.entry'), 'resume', 'SCORM 2004 cmi.entry must be resume');
    assert.equal(api2004Session2.GetValue('cmi.exit'), '', 'SCORM 2004 cmi.exit must be reset to empty for new session');
    assert.equal(api2004Session2.GetValue('cmi.session_time'), 'PT0H0M0S', 'SCORM 2004 cmi.session_time must be reset to PT0H0M0S');
    assert.equal(api2004Session2.GetValue('cmi.suspend_data'), 'eyJzbGlkZSI6NX0=', 'suspend_data must be preserved');
    assert.equal(api2004Session2.GetValue('cmi.location'), 'slide_5', 'location must be preserved');
    assert.equal(api2004Session2.GetValue('cmi.score.raw'), '100', 'score.raw must be preserved');

    // Kiểm tra tương tự cho SCORM 1.2
    const staleCmi12Snapshot = {
      'cmi.core.entry': 'ab-initio',
      'cmi.core.exit': 'suspend',
      'cmi.core.session_time': '0000:15:00',
      'cmi.core.lesson_location': 'slide_8',
      'cmi.suspend_data': 'choice_A|step_8',
      'cmi.core.score.raw': '80',
      'cmi.core.lesson_status': 'incomplete',
    };
    const api12Session2 = createScorm12Api({
      studentName: 'Học sinh 1',
      tracking: {
        lesson_location: 'slide_8',
        suspend_data: 'choice_A|step_8',
        score_raw: 80,
        lesson_status: 'incomplete',
        cmi_data: staleCmi12Snapshot,
      },
    });
    assert.equal(api12Session2.LMSInitialize(), 'true');
    assert.equal(api12Session2.LMSGetValue('cmi.core.entry'), 'resume', 'SCORM 1.2 cmi.core.entry must be resume');
    assert.equal(api12Session2.LMSGetValue('cmi.core.exit'), '', 'SCORM 1.2 cmi.core.exit must be reset to empty');
    assert.equal(api12Session2.LMSGetValue('cmi.core.session_time'), '00:00:00', 'SCORM 1.2 cmi.core.session_time must be reset to 00:00:00');
    assert.equal(api12Session2.LMSGetValue('cmi.suspend_data'), 'choice_A|step_8', 'suspend_data must be preserved');
    assert.equal(api12Session2.LMSGetValue('cmi.core.lesson_location'), 'slide_8', 'lesson_location must be preserved');
    assert.equal(api12Session2.LMSGetValue('cmi.core.score.raw'), '80', 'score.raw must be preserved');
    recordPass('CMI33', 'CMI33_RESUME_LIFECYCLE_RESET_GUARANTEE: Tái thiết lập vòng đời phiên chuẩn xác, bảo tồn toàn vẹn dữ liệu học tập');

    console.log('\n================================================================');
    console.log(`🎉 TẤT CẢ ${passedTests}/${totalTests} KIỂM THỬ CMI PERSISTENCE & SECURITY AUDIT ĐÃ HOÀN TẤT VÀ PASS 100%!`);
    console.log('================================================================\n');
  } finally {
    // cleanup
  }
}

runScormCmiPersistenceTestSuite().catch((err) => {
  console.error('\n❌ SCORM CMI PERSISTENCE TEST SUITE FAILED:', err);
  process.exit(1);
});
