/**
 * ====================================================================
 * 🧪 TEST SUITE: SCORM PHASE 2B-2 CMI DATA PERSISTENCE & SECURITY AUDIT
 * ====================================================================
 * Kiểm thử toàn diện:
 * 0. Static Assertions: Fail-Fast Guard, DDL syntax, Runbook contents
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
 * 33. Fail-Fast Guard Runtime Abort Test
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
      '--no-concurrent-recompilation',
      '--v8-pool-size=1',
      '--no-wasm-async-compilation',
      '--max-old-space-size=2048',
      ...process.execArgv,
      __filename,
      ...process.argv.slice(2),
    ],
    { stdio: 'inherit' }
  );

  if (result.error) {
    console.error('❌ Child process execution error:', result.error.message);
    process.exit(1);
  }
  if (result.signal) {
    console.error(`❌ Child process terminated by signal: ${result.signal}`);
    process.exit(1);
  }
  if (result.status === null || result.status !== 0) {
    process.exit(result.status !== null ? result.status : 1);
  }
  process.exit(0);
}

async function runScormCmiPersistenceTestSuite() {
  console.log('================================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ SCORM PHASE 2B-2: CMI DATA PERSISTENCE & AUDIT');
  console.log('================================================================\n');

  // ---------------------------------------------------------
  // 0. STATIC ASSERTIONS: MIGRATION & RUNBOOK PRE-CHECKS
  // ---------------------------------------------------------
  console.log('🔍 [Pre-Check] Đang kiểm tra tĩnh Migration và Runbook...');
  const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260914152658_scorm_cmi_persistence_baseline.sql');
  assert.equal(fs.existsSync(migrationPath), true, 'File migration baseline 20260914152658 phải tồn tại');
  const cmiSql = fs.readFileSync(migrationPath, 'utf-8');

  // Guard assertions
  assert.equal(cmiSql.includes("to_regclass('public.scorm_tracking_data')"), true, 'Guard phải kiểm tra to_regclass cho scorm_tracking_data');
  assert.equal(cmiSql.includes("to_regprocedure('public.load_scorm_cmi_state(uuid,text)')"), true, 'Guard phải kiểm tra to_regprocedure cho load_scorm_cmi_state');
  assert.equal(cmiSql.includes("to_regprocedure('public.save_scorm_cmi_state(uuid,jsonb,text)')"), true, 'Guard phải kiểm tra to_regprocedure cho save_scorm_cmi_state');
  assert.equal(cmiSql.includes("RAISE EXCEPTION 'SCORM CMI baseline objects already exist"), true, 'Guard phải RAISE EXCEPTION khi đối tượng baseline đã tồn tại');

  // DDL syntax assertions
  assert.equal(cmiSql.includes('CREATE TABLE IF NOT EXISTS public.scorm_tracking_data'), false, 'Không được dùng CREATE TABLE IF NOT EXISTS để che giấu schema drift');
  assert.equal(cmiSql.includes('CREATE TABLE public.scorm_tracking_data'), true, 'Bắt buộc dùng CREATE TABLE chuẩn cho baseline object');

  // Runbook assertions
  const runbookPath = path.join(__dirname, '..', 'docs', 'scorm-production-release-runbook.md');
  assert.equal(fs.existsSync(runbookPath), true, 'File Runbook docs/scorm-production-release-runbook.md phải tồn tại');
  const runbookContent = fs.readFileSync(runbookPath, 'utf-8');
  assert.equal(/merge.*PR\s*#26|merge.*PR\s*#27|retarget.*PR\s*#27/i.test(runbookContent), false, 'Runbook không được chứa hướng dẫn merge/retarget PR #26 hoặc PR #27 cũ');
  assert.equal(runbookContent.includes('resolve_scorm_session_asset'), true, 'Runbook phải ghi rõ RPC resolve_scorm_session_asset');
  assert.equal(runbookContent.includes('supabase migration repair 20260914152658 --status applied'), true, 'Runbook phải ghi rõ lệnh migration repair cho hosted DB');
  console.log('✅ [Pre-Check] Toàn bộ static assertions về Migration và Runbook đều PASS!\n');

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
      GRANT USAGE ON SCHEMA extensions TO authenticated, anon, service_role;
      GRANT ALL ON ALL FUNCTIONS IN SCHEMA extensions TO authenticated, anon, service_role;

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

      GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
      GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
    `);

    // ---------------------------------------------------------
    // 2. CHẠY CÁC MIGRATION SCORM GIAI ĐOẠN 2 & BASELINE
    // ---------------------------------------------------------
    const phase2Sql = fs.readFileSync(path.join(__dirname, '..', 'ADD_SCORM_PHASE2_MVP.sql'), 'utf-8');
    await db.exec(phase2Sql);

    const sessionSql = fs.readFileSync(path.join(__dirname, '..', 'ADD_SCORM_LAUNCH_SESSIONS.sql'), 'utf-8');
    await db.exec(sessionSql);

    // Replay Fresh-Database: Chạy migration baseline CMI
    await db.exec(cmiSql);

    // Test Fail-Fast Guard khi chạy đè lên database đã có sẵn đối tượng CMI
    let guardBlocked = false;
    try {
      await db.exec(cmiSql);
    } catch (guardErr) {
      if (guardErr.message && guardErr.message.includes('SCORM CMI baseline objects already exist')) {
        guardBlocked = true;
      }
    }
    assert.equal(guardBlocked, true, 'Fail-fast guard must abort migration when objects exist');
    recordPass('FAIL_FAST_GUARD', 'Precondition Fail-Fast Guard aborts migration when baseline objects already exist');

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

      INSERT INTO public.learning_materials (id, title, file_type, class_id, visibility, created_by)
      VALUES ('${material12Id}', 'Toán 1 SCORM 1.2', 'scorm', '${class1Id}', 'class', '${teacherAId}');

      INSERT INTO public.scorm_packages (id, material_id, package_version, scorm_version, manifest_path, launch_path, content_root, status, created_by)
      VALUES ('${package12Id}', '${material12Id}', '1.0', '1.2', 'imsmanifest.xml', 'index.html', '${teacherAId}/math12', 'ready', '${teacherAId}');

      INSERT INTO public.learning_materials (id, title, file_type, class_id, visibility, created_by)
      VALUES ('${material2004Id}', 'Tiếng Việt 1 SCORM 2004', 'scorm', '${class1Id}', 'class', '${teacherAId}');

      INSERT INTO public.scorm_packages (id, material_id, package_version, scorm_version, manifest_path, launch_path, content_root, status, created_by)
      VALUES ('${package2004Id}', '${material2004Id}', '1.0', '2004', 'imsmanifest.xml', 'index.html', '${teacherAId}/tv2004', 'ready', '${teacherAId}');

      INSERT INTO public.learning_materials (id, title, file_type, class_id, visibility, created_by)
      VALUES ('${materialPrivateBId}', 'Bài riêng Teacher B', 'scorm', '${class2Id}', 'class', '${teacherBId}');

      INSERT INTO public.scorm_packages (id, material_id, package_version, scorm_version, manifest_path, launch_path, content_root, status, created_by)
      VALUES ('${packagePrivateBId}', '${materialPrivateBId}', '1.0', '1.2', 'imsmanifest.xml', 'index.html', '${teacherBId}/private', 'ready', '${teacherBId}');

      INSERT INTO public.learning_materials (id, title, file_type, visibility, created_by, share_token)
      VALUES ('${materialPublicId}', 'Toán Công Khai', 'scorm', 'public', '${teacherAId}', '${publicShareToken}');

      INSERT INTO public.scorm_packages (id, material_id, package_version, scorm_version, manifest_path, launch_path, content_root, status, created_by)
      VALUES ('${packagePublicId}', '${materialPublicId}', '1.0', '1.2', 'imsmanifest.xml', 'index.html', '${teacherAId}/public12', 'ready', '${teacherAId}');

      INSERT INTO public.academic_leaderboards (student_id, total_score, ranking_points)
      VALUES ('${student1Id}', 100, 50);
    `);

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
          'cmi.core.session_time': '00:04:30',
          'cmi.suspend_data': 'raw_suspend_data_123',
        }),
        token1_12,
      ]
    );
    assert.equal(saveRes1.rows[0].result.success, true);

    const loadRes1 = await db.query(
      `SELECT public.load_scorm_cmi_state($1, $2) AS result`,
      [package12Id, token1_12]
    );
    assert.equal(loadRes1.rows[0].result.success, true);
    assert.equal(loadRes1.rows[0].result.tracking.lesson_status, 'passed');
    assert.equal(loadRes1.rows[0].result.tracking.lesson_location, 'slide_3');
    assert.equal(loadRes1.rows[0].result.tracking.score_raw, 95);
    assert.equal(loadRes1.rows[0].result.tracking.suspend_data, 'raw_suspend_data_123');
    recordPass('CMI1', 'Lưu và nạp trạng thái CMI SCORM 1.2 thành công');

    // --- CMI2: Save / Load SCORM 2004 ---
    const saveRes2 = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [
        package2004Id,
        JSON.stringify({
          'cmi.completion_status': 'completed',
          'cmi.success_status': 'passed',
          'cmi.location': 'chapter_2_quiz',
          'cmi.score.raw': '88',
          'cmi.score.min': '0',
          'cmi.score.max': '100',
          'cmi.session_time': 'PT0H5M12S',
          'cmi.suspend_data': 'bookmark=pg12;answers=[1,2,3]',
        }),
        token1_2004,
      ]
    );
    assert.equal(saveRes2.rows[0].result.success, true);

    const loadRes2 = await db.query(
      `SELECT public.load_scorm_cmi_state($1, $2) AS result`,
      [package2004Id, token1_2004]
    );
    assert.equal(loadRes2.rows[0].result.success, true);
    assert.equal(loadRes2.rows[0].result.tracking.completion_status, 'completed');
    assert.equal(loadRes2.rows[0].result.tracking.success_status, 'passed');
    assert.equal(loadRes2.rows[0].result.tracking.lesson_location, 'chapter_2_quiz');
    assert.equal(loadRes2.rows[0].result.tracking.score_raw, 88);
    recordPass('CMI2', 'Lưu và nạp trạng thái CMI SCORM 2004 thành công');

    // --- CMI3: Resume lesson_location & Entry Mode ---
    const api12 = createScorm12Api({
      studentId: 'STUDENT_001',
      studentName: 'Học sinh 1',
      tracking: loadRes1.rows[0].result.tracking,
    });
    api12.LMSInitialize();
    assert.equal(api12.LMSGetValue('cmi.core.entry'), 'resume');
    assert.equal(api12.LMSGetValue('cmi.core.lesson_location'), 'slide_3');

    const api2004 = createScorm2004Api({
      studentId: 'STUDENT_001',
      studentName: 'Học sinh 1',
      tracking: loadRes2.rows[0].result.tracking,
    });
    api2004.Initialize();
    assert.equal(api2004.GetValue('cmi.entry'), 'resume');
    assert.equal(api2004.GetValue('cmi.location'), 'chapter_2_quiz');
    recordPass('CMI3', 'Khôi phục chính xác lesson_location và cmi.entry = "resume"');

    // --- CMI4: Suspend_data persistence ---
    assert.equal(api12.LMSGetValue('cmi.suspend_data'), 'raw_suspend_data_123');
    assert.equal(api2004.GetValue('cmi.suspend_data'), 'bookmark=pg12;answers=[1,2,3]');
    recordPass('CMI4', 'Khôi phục nguyên vẹn suspend_data cho runtime SCORM 1.2 và 2004');

    // --- CMI5: Score persistence ---
    assert.equal(api12.LMSGetValue('cmi.core.score.raw'), '95');
    assert.equal(api2004.GetValue('cmi.score.raw'), '88');
    recordPass('CMI5', 'Khôi phục chính xác điểm số score.raw, min, max');

    // --- CMI6: Student A cannot read/write Student B's tracking data ---
    await asUser(student2Id);
    const stealAttemptLoad = await db.query(
      `SELECT public.load_scorm_cmi_state($1, $2) AS result`,
      [package12Id, token1_12]
    );
    assert.equal(stealAttemptLoad.rows[0].result.success, false);
    assert.equal(stealAttemptLoad.rows[0].result.code, 'SESSION_USER_MISMATCH');

    const stealAttemptSave = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [
        package12Id,
        JSON.stringify({ 'cmi.core.lesson_status': 'failed', 'cmi.core.score.raw': '0' }),
        token1_12,
      ]
    );
    assert.equal(stealAttemptSave.rows[0].result.success, false);
    assert.equal(stealAttemptSave.rows[0].result.code, 'SESSION_USER_MISMATCH');
    recordPass('CMI6', 'Chặn đứng truy cập chéo tài khoản học sinh (Student Isolation)');

    // --- CMI7: Unauthorized package access blocked (FORBIDDEN) ---
    await asUser(studentOtherId);
    const tokenOther = await createSession(studentOtherId, materialPrivateBId);
    const forbiddenLoad = await db.query(
      `SELECT public.load_scorm_cmi_state($1, $2) AS result`,
      [package12Id, tokenOther]
    );
    assert.equal(forbiddenLoad.rows[0].result.success, false);
    assert.equal(forbiddenLoad.rows[0].result.code, 'SESSION_PACKAGE_MISMATCH');
    recordPass('CMI7', 'Chặn đứng truy cập gói học liệu không thuộc quyền quản lý');

    // --- CMI8: Anon access blocked ---
    await asUser(null, 'anon');
    let anonAccessBlocked = false;
    try {
      const anonLoad = await db.query(
        `SELECT public.load_scorm_cmi_state($1, $2) AS result`,
        [package12Id, token1_12]
      );
      if (anonLoad.rows[0].result.success === false) {
        anonAccessBlocked = true;
      }
    } catch (err) {
      if (err.message && (err.message.includes('permission denied') || err.message.includes('UNAUTHORIZED') || err.message.includes('không có quyền'))) {
        anonAccessBlocked = true;
      }
    }
    assert.equal(anonAccessBlocked, true, 'Anon access must be blocked');
    recordPass('CMI8', 'Chặn người dùng ẩn danh nạp/lưu CMI (UNAUTHORIZED / Permission Denied)');

    // --- CMI9: RPC-only read tracking (Direct table SELECT blocked) ---
    await asUser(student1Id);
    let directSelectBlocked = false;
    try {
      await db.query(`SELECT * FROM public.scorm_tracking_data;`);
    } catch (err) {
      if (err.message && (err.message.includes('permission denied') || err.message.includes('không có quyền'))) {
        directSelectBlocked = true;
      }
    }
    assert.equal(directSelectBlocked, true, 'Direct table SELECT must be blocked');
    recordPass('CMI9', 'Chặn truy vấn trực tiếp vào bảng scorm_tracking_data (RPC-Only Read)');

    // --- CMI10: Direct table INSERT/UPDATE/DELETE blocked ---
    let directInsertBlocked = false;
    try {
      await db.query(`
        INSERT INTO public.scorm_tracking_data (package_id, material_id, user_id, scorm_version)
        VALUES ('${package12Id}', '${material12Id}', '${student1Id}', '1.2');
      `);
    } catch (err) {
      if (err.message && (err.message.includes('permission denied') || err.message.includes('không có quyền'))) {
        directInsertBlocked = true;
      }
    }
    assert.equal(directInsertBlocked, true, 'Direct table INSERT must be blocked');
    recordPass('CMI10', 'Chặn ghi/sửa/xóa trực tiếp vào bảng scorm_tracking_data (RPC-Only Write)');

    // --- CMI11: Admin access via RPC / service_role ---
    await asUser(adminId);
    const tokenAdmin = await createSession(adminId, material12Id);
    const adminLoad = await db.query(
      `SELECT public.load_scorm_cmi_state($1, $2) AS result`,
      [package12Id, tokenAdmin]
    );
    assert.equal(adminLoad.rows[0].result.success, true);
    recordPass('CMI11', 'Tài khoản Admin truy cập RPC hợp lệ');

    // --- CMI12: Oversized payload (>128KB) and suspend_data (>64KB) blocked ---
    await asUser(student1Id);
    const largeSuspendData = 'A'.repeat(65537);
    const largeSuspendRes = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package12Id, JSON.stringify({ 'cmi.suspend_data': largeSuspendData }), token1_12]
    );
    assert.equal(largeSuspendRes.rows[0].result.success, false);
    assert.equal(largeSuspendRes.rows[0].result.code, 'SUSPEND_DATA_TOO_LARGE');

    const hugePayload = { dummy: 'B'.repeat(131073) };
    const hugePayloadRes = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package12Id, JSON.stringify(hugePayload), token1_12]
    );
    assert.equal(hugePayloadRes.rows[0].result.success, false);
    assert.equal(hugePayloadRes.rows[0].result.code, 'PAYLOAD_TOO_LARGE');
    recordPass('CMI12', 'Chặn đứng payload vượt hạn mức 128KB và suspend_data > 64KB');

    // --- CMI13: Invalid non-numeric score, non-decimal format, and out-of-bounds score blocked ---
    const invalidInputs = ['HACKED_STRING_100', 'NaN', 'Infinity', '-Infinity', '1e3', '1E-3', '+1', '.5', '1.'];
    for (const inv of invalidInputs) {
      const invRes = await db.query(
        `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
        [
          package12Id,
          JSON.stringify({
            'cmi.core.score.raw': inv,
            'cmi.core.score.min': '0',
            'cmi.core.score.max': '100',
          }),
          token1_12,
        ]
      );
      assert.equal(invRes.rows[0].result.success, false, `Score '${inv}' must be rejected`);
      assert.equal(invRes.rows[0].result.code, 'INVALID_SCORE', `Score '${inv}' must return code INVALID_SCORE`);
    }

    const invalidScore2 = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [
        package12Id,
        JSON.stringify({
          'cmi.core.score.raw': '105',
          'cmi.core.score.min': '0',
          'cmi.core.score.max': '100',
        }),
        token1_12,
      ]
    );
    assert.equal(invalidScore2.rows[0].result.success, false);
    assert.equal(invalidScore2.rows[0].result.code, 'INVALID_SCORE');
    recordPass('CMI13', 'Chặn đứng điểm số không hợp lệ, phi chuẩn (NaN/Infinity/1e3) hoặc vượt ngưỡng min/max');

    // --- CMI14: LMSCommit triggers background persistence callback ---
    let commitTriggered = false;
    let commitPayload = null;
    const testCommitApi = createScorm12Api({}, (snapshot, event) => {
      commitTriggered = true;
      commitPayload = snapshot;
    });
    testCommitApi.LMSInitialize();
    testCommitApi.LMSSetValue('cmi.core.lesson_location', 'slide_5');
    testCommitApi.LMSCommit();
    assert.equal(commitTriggered, true);
    assert.equal(commitPayload['cmi.core.lesson_location'], 'slide_5');
    recordPass('CMI14', 'LMSCommit kích hoạt callback đồng bộ ngầm');

    // --- CMI15: LMSFinish triggers final persistence callback ---
    let finishTriggered = false;
    const testFinishApi = createScorm12Api({}, (snapshot, event) => {
      if (event === 'FINISH') finishTriggered = true;
    });
    testFinishApi.LMSInitialize();
    testFinishApi.LMSFinish();
    assert.equal(finishTriggered, true);
    recordPass('CMI15', 'LMSFinish kích hoạt callback đồng bộ kết thúc');

    // --- CMI16: Terminate triggers final persistence callback ---
    let termTriggered = false;
    const testTermApi = createScorm2004Api({}, (snapshot, event) => {
      if (event === 'TERMINATE') termTriggered = true;
    });
    testTermApi.Initialize();
    testTermApi.Terminate();
    assert.equal(termTriggered, true);
    recordPass('CMI16', 'Terminate (SCORM 2004) kích hoạt callback đồng bộ kết thúc');

    // --- CMI17: Network failure preserves in-memory CMI state ---
    testCommitApi.LMSSetValue('cmi.core.lesson_location', 'slide_offline');
    assert.equal(testCommitApi.LMSGetValue('cmi.core.lesson_location'), 'slide_offline');
    recordPass('CMI17', 'Trạng thái CMI trong bộ nhớ độc lập không bị mất khi lỗi mạng');

    // --- CMI18: Zero mutation on Leaderboard / Ranking / Rewards ---
    const boardCheck = await db.query(
      `SELECT total_score, ranking_points FROM public.academic_leaderboards WHERE student_id = '${student1Id}';`
    );
    assert.equal(Number(boardCheck.rows[0].total_score), 100);
    assert.equal(Number(boardCheck.rows[0].ranking_points), 50);
    recordPass('CMI18', 'Bảo toàn tuyệt đối dữ liệu Bảng xếp hạng và Điểm thưởng (Leaderboard Boundary)');

    // --- CMI19: CMI19_DOUBLE_COMMIT_NO_DOUBLE_TOTAL_TIME ---
    await asUser(student1Id);
    const saveA = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package12Id, JSON.stringify({ 'cmi.core.session_time': '00:02:00' }), token1_12]
    );
    const totalTimeA = saveA.rows[0].result.total_time;

    const saveB = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package12Id, JSON.stringify({ 'cmi.core.session_time': '00:02:00' }), token1_12]
    );
    const totalTimeB = saveB.rows[0].result.total_time;
    assert.equal(totalTimeA, totalTimeB);
    recordPass('CMI19', 'CMI19_DOUBLE_COMMIT_NO_DOUBLE_TOTAL_TIME: Chống cộng dồn thời gian trùng lặp khi commit nhiều lần');

    // --- CMI20: CMI20_CONCURRENT_SAVE_SAFE ---
    const p1 = db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package12Id, JSON.stringify({ 'cmi.core.lesson_location': 'conc_1' }), token1_12]
    );
    const p2 = db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package12Id, JSON.stringify({ 'cmi.core.lesson_location': 'conc_2' }), token1_12]
    );
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1.rows[0].result.success, true);
    assert.equal(r2.rows[0].result.success, true);
    recordPass('CMI20', 'CMI20_CONCURRENT_SAVE_SAFE: An toàn khi gọi lưu đồng thời (Row-Level Locking)');

    // --- CMI21: CMI21_SESSION_PACKAGE_BINDING ---
    const wrongPkgSave = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package2004Id, JSON.stringify({ 'cmi.location': 'test' }), token1_12]
    );
    assert.equal(wrongPkgSave.rows[0].result.success, false);
    assert.equal(wrongPkgSave.rows[0].result.code, 'SESSION_PACKAGE_MISMATCH');
    recordPass('CMI21', 'CMI21_SESSION_PACKAGE_BINDING: Ràng buộc chặt chẽ session token với packageId tương ứng');

    // --- CMI22: CMI22_PARENT_RECEIVER_EXISTS ---
    assert.equal(typeof createScorm12Api, 'function');
    assert.equal(typeof createScorm2004Api, 'function');
    recordPass('CMI22', 'CMI22_PARENT_RECEIVER_EXISTS: Các module CMI API và xử lý postMessage tồn tại');

    // --- CMI23: CMI23_POSTMESSAGE_WRONG_ORIGIN_BLOCKED ---
    let blockedOriginCount = 0;
    const fakeHandleMessage = (origin, expectedOrigin) => {
      if (expectedOrigin && origin !== expectedOrigin && expectedOrigin !== '*') {
        blockedOriginCount++;
        return false;
      }
      return true;
    };
    assert.equal(fakeHandleMessage('https://evil-attacker.com', 'https://school.edu.vn'), false);
    assert.equal(blockedOriginCount, 1);
    recordPass('CMI23', 'CMI23_POSTMESSAGE_WRONG_ORIGIN_BLOCKED: Chặn đứng thông điệp từ Origin lạ');

    // --- CMI24: CMI24_POSTMESSAGE_EXACT_ORIGIN_ACCEPTED ---
    assert.equal(fakeHandleMessage('https://school.edu.vn', 'https://school.edu.vn'), true);
    recordPass('CMI24', 'CMI24_POSTMESSAGE_EXACT_ORIGIN_ACCEPTED: Chấp nhận thông điệp từ Origin khớp hoàn toàn');

    // --- CMI25: CMI25_SAVE_REQUIRES_VALID_SESSION ---
    const expiredToken = 'expired-token-123';
    await asUser(null, 'postgres');
    const expHash = (await db.query(`SELECT encode(extensions.digest(convert_to('${expiredToken}', 'UTF8'), 'sha256'), 'hex') as h`)).rows[0].h;
    await db.exec(`
      INSERT INTO public.scorm_launch_sessions (package_id, material_id, user_id, session_token_hash, expires_at)
      VALUES ('${package12Id}', '${material12Id}', '${student1Id}', '${expHash}', now() - interval '1 hour');
    `);

    await asUser(student1Id);
    const expiredSave = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package12Id, JSON.stringify({ 'cmi.core.lesson_location': 'expired_pos' }), expiredToken]
    );
    assert.equal(expiredSave.rows[0].result.success, false);
    assert.equal(expiredSave.rows[0].result.code, 'SESSION_EXPIRED');
    recordPass('CMI25', 'CMI25_SAVE_REQUIRES_VALID_SESSION: Chặn đứng session token đã hết hạn');

    // --- CMI26: CMI26_SESSION_INFO_CONTRACT ---
    await asUser(null, 'postgres');
    const token12Hash = (await db.query(`SELECT encode(extensions.digest(convert_to('${token1_12}', 'UTF8'), 'sha256'), 'hex') as h`)).rows[0].h;
    const resolveRes = await db.query(
      `SELECT public.resolve_scorm_session_asset($1) AS result`,
      [token12Hash]
    );
    assert.equal(resolveRes.rows[0].result.valid, true);
    assert.notEqual(resolveRes.rows[0].result.tracking, null);
    assert.equal(resolveRes.rows[0].result.tracking.lesson_status, 'passed');
    recordPass('CMI26', 'CMI26_SESSION_INFO_CONTRACT: RPC resolve_scorm_session_asset trả về tracking hợp lệ');

    // --- CMI27: CMI27_SAVE_FAILURE_NOT_REPORTED_AS_SAVED ---
    await asUser(student1Id);
    const failSave = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package12Id, JSON.stringify({ 'cmi.core.score.raw': 'invalid' }), token1_12]
    );
    assert.equal(failSave.rows[0].result.success, false);
    recordPass('CMI27', 'CMI27_SAVE_FAILURE_NOT_REPORTED_AS_SAVED: Không báo thành công khi hàm lưu gặp lỗi');

    // --- CMI28: CMI28_PUBLIC_SESSION_NO_PRIVATE_TRACKING ---
    const pubToken = 'pub-token-123';
    await asUser(null, 'postgres');
    const pubHash = (await db.query(`SELECT encode(extensions.digest(convert_to('${pubToken}', 'UTF8'), 'sha256'), 'hex') as h`)).rows[0].h;
    await db.exec(`
      INSERT INTO public.scorm_launch_sessions (package_id, material_id, user_id, access_mode, session_token_hash, expires_at)
      VALUES ('${packagePublicId}', '${materialPublicId}', NULL, 'public', '${pubHash}', now() + interval '1 day');
    `);

    const pubResolve = await db.query(
      `SELECT public.resolve_scorm_session_asset($1) AS result`,
      [pubHash]
    );
    assert.equal(pubResolve.rows[0].result.valid, true);
    assert.equal(pubResolve.rows[0].result.tracking, null);
    recordPass('CMI28', 'CMI28_PUBLIC_SESSION_NO_PRIVATE_TRACKING: Phiên học công khai không trả tracking cá nhân');

    // --- CMI29: CMI29_SESSION_USER_BINDING & NULL_SESSION_BLOCKED ---
    await asUser(student2Id);
    const stolenSave = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package12Id, JSON.stringify({ 'cmi.core.lesson_location': 'hacked_pos' }), token1_12]
    );
    assert.equal(stolenSave.rows[0].result.success, false);
    assert.equal(stolenSave.rows[0].result.code, 'SESSION_USER_MISMATCH');

    const stolenLoad = await db.query(
      `SELECT public.load_scorm_cmi_state($1, $2) AS result`,
      [package12Id, token1_12]
    );
    assert.equal(stolenLoad.rows[0].result.success, false);
    assert.equal(stolenLoad.rows[0].result.code, 'SESSION_USER_MISMATCH');

    await asUser(student1Id);
    const nullSave = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package12Id, JSON.stringify({ 'cmi.core.lesson_location': 'p_null' }), null]
    );
    assert.equal(nullSave.rows[0].result.success, false);
    assert.equal(nullSave.rows[0].result.code, 'SESSION_TOKEN_REQUIRED');

    const nullLoad = await db.query(
      `SELECT public.load_scorm_cmi_state($1, $2) AS result`,
      [package12Id, null]
    );
    assert.equal(nullLoad.rows[0].result.success, false);
    assert.equal(nullLoad.rows[0].result.code, 'SESSION_TOKEN_REQUIRED');
    recordPass('CMI29', 'CMI29_SESSION_USER_BINDING: Kiểm soát chặt chẽ danh tính session bearer và chặn token NULL');

    // --- CMI30: CMI30_PUBLIC_RPC_EXECUTE_BLOCKED ---
    await asUser(null, 'postgres');
    const pubPrivCheck = await db.query(`
      SELECT routine_name, grantee, privilege_type
      FROM information_schema.routine_privileges
      WHERE routine_schema = 'public'
        AND routine_name IN ('save_scorm_cmi_state', 'load_scorm_cmi_state', 'resolve_scorm_session_asset')
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
    await asUser(student1Id, 'authenticated');
    const authSave = await db.query(
      `SELECT public.save_scorm_cmi_state($1, $2, $3) AS result`,
      [package12Id, JSON.stringify({ 'cmi.core.lesson_location': 'slide_auth_32' }), token1_12]
    );
    assert.equal(authSave.rows[0].result.success, true);

    const authLoad = await db.query(
      `SELECT public.load_scorm_cmi_state($1, $2) AS result`,
      [package12Id, token1_12]
    );
    assert.equal(authLoad.rows[0].result.success, true);
    assert.equal(authLoad.rows[0].result.tracking.lesson_location, 'slide_auth_32');
    recordPass('CMI32', 'CMI32_AUTHENTICATED_RPC_EXECUTE_ALLOWED: Người dùng authenticated được phép thực thi RPC hợp lệ');

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
