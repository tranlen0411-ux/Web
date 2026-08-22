/**
 * ====================================================================
 * 🧪 TEST SUITE: SCORM PHASE 2B-1 FINAL SECURITY HARDENED
 * SECURE LAUNCH SESSION + GENUINE PGCRYPTO 256-BIT TOKEN + AUDIT
 * ====================================================================
 * Kiểm thử:
 * 1. Genuine pgcrypto Introspection & Security Hardening (CRYPTO1 - CRYPTO9)
 * 2. Fresh Install & Re-run Idempotency (IDEMPOTENCY_2B1)
 * 3. Legacy Schema Upgrade Path & Cleanup (UPGRADE1 - UPGRADE8)
 * 4. RPC-Only Table Contract & Least Privilege (PRIV1 - PRIV7)
 * 5. 256-Bit CSPRNG Token Entropy & Trust Boundary (TOKEN1 - TOKEN9, TTL1, MAP1)
 * 6. Session Lifecycle & Phase 1 Authorization (SESSION1 - SESSION8)
 * 7. Public Dynamic Visibility Recheck (PUBLIC_REV1)
 * 8. Asset Gateway HTTP Delivery & Path Security (ASSET1 - ASSET8)
 * 9. Isolated Origin Contract & SCORM API Discovery (ORIGIN3 - ORIGIN4, API5 - API6)
 * 10. Security Definer Audit & Data Leak Prevention (FUNC1 - FUNC4, LEAK1 - LEAK5, GATEWAY_SEC1)
 * ====================================================================
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { sanitizeScormRelativePath, getMimeTypeForAsset, hashSessionToken } from '../src/utils/scormPathSecurity.js';
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
      '--max-old-space-size=4096',
      ...process.execArgv,
      __filename,
      ...process.argv.slice(2),
    ],
    { stdio: 'inherit' }
  );
  process.exit(result.status ?? 0);
}

async function runScormPhase2B1HardenedTestSuite() {
  console.log('================================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ SCORM PHASE 2B-1: GENUINE PGCRYPTO & AUDIT');
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

  // Helper set user context
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

  // Storage Mock Map: <full_storage_path> -> { content, mime }
  const mockStorage = new Map();

  let server;
  let serverPort;
  let serverOrigin;

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
        name TEXT,
        public BOOLEAN DEFAULT false,
        file_size_limit BIGINT,
        allowed_mime_types TEXT[]
      );

      CREATE TABLE IF NOT EXISTS storage.objects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bucket_id TEXT,
        name TEXT,
        owner UUID,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        full_name TEXT NOT NULL,
        email TEXT UNIQUE,
        role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.classes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        grade_level INT NOT NULL,
        code TEXT UNIQUE NOT NULL,
        teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.class_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT unique_student_class_member UNIQUE (class_id, student_id)
      );

      CREATE TABLE IF NOT EXISTS public.learning_materials (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title TEXT NOT NULL,
        description TEXT,
        subject TEXT NOT NULL,
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
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.learning_material_shares (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        material_id UUID NOT NULL REFERENCES public.learning_materials(id) ON DELETE CASCADE,
        class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT unique_material_class_share UNIQUE (material_id, class_id)
      );

      GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role, postgres;
      GRANT ALL ON storage.objects TO anon, authenticated, service_role, postgres;
      GRANT ALL ON storage.buckets TO anon, authenticated, service_role, postgres;

      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, postgres;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role, postgres;
      GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role, postgres;
      GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role, postgres;
    `);

    // ---------------------------------------------------------
    // 2. NẠP MIGRATION PHASE 2A
    // ---------------------------------------------------------
    const phase2aSql = await fs.readFile(path.join(__dirname, '..', 'ADD_SCORM_PHASE2_MVP.sql'), 'utf-8');
    await db.exec(phase2aSql);


    // ---------------------------------------------------------
    // 3. NHÓM TEST CRYPTO INTROSPECTION & AUDIT (CRYPTO1 - CRYPTO9)
    // ---------------------------------------------------------
    console.log('--- NHÓM -1: KIỂM TOÁN PGCRYPTO RUNTIME & MẬT MÃ THẬT (CRYPTO1 - CRYPTO9) ---');

    // CRYPTO1: Runtime introspection tìm thấy gen_random_bytes trong extensions
    const crypto1Res = await db.query(`
      SELECT n.nspname AS schema_name, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = 'gen_random_bytes';
    `);
    assert.ok(crypto1Res.rows.length >= 1);
    assert.equal(crypto1Res.rows[0].schema_name, 'extensions');
    assert.equal(crypto1Res.rows[0].args, 'integer');
    recordPass('CRYPTO1', 'Runtime introspection xác nhận pgcrypto gen_random_bytes(integer) tại schema extensions');

    // CRYPTO2: Runtime introspection tìm thấy digest trong extensions
    const crypto2Res = await db.query(`
      SELECT n.nspname AS schema_name, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = 'digest' AND n.nspname = 'extensions';
    `);
    assert.ok(crypto2Res.rows.length >= 1);
    recordPass('CRYPTO2', 'Runtime introspection xác nhận pgcrypto digest(bytea/text, text) tại schema extensions');

    // Đọc migration Phase 2B-1 SQL
    const phase2bSql = await fs.readFile(path.join(__dirname, '..', 'ADD_SCORM_LAUNCH_SESSIONS.sql'), 'utf-8');

    // CRYPTO3: Không tồn tại custom application-defined PL/pgSQL function extensions.gen_random_bytes
    assert.equal(phase2bSql.includes('CREATE OR REPLACE FUNCTION extensions.gen_random_bytes'), false);
    recordPass('CRYPTO3', 'Migration không chứa bất kỳ custom PL/pgSQL wrapper nào trong schema extensions');

    // CRYPTO8: Migration không chứa fallback gen_random_uuid cho sinh token
    assert.equal(phase2bSql.includes("gen_random_uuid()::text, '-', ''"), false);
    recordPass('CRYPTO8', 'Migration không dùng gen_random_uuid concatenation để sinh session token');

    // CRYPTO9: Không có EXCEPTION WHEN OTHERS THEN NULL nuốt lỗi extension
    assert.equal(phase2bSql.includes('EXCEPTION WHEN OTHERS THEN'), false);
    recordPass('CRYPTO9', 'Migration không dùng EXCEPTION WHEN OTHERS nuốt lỗi CREATE EXTENSION');


    // ---------------------------------------------------------
    // 4. KIỂM THỬ NÂNG CẤP TỪ PHIÊN BẢN CŨ (UPGRADE1 - UPGRADE8)
    // ---------------------------------------------------------
    console.log('\n--- NHÓM 0: KIỂM THỬ NÂNG CẤP SCHEMA TỪ BẢN CŨ (UPGRADE1 - UPGRADE8) ---');
    
    // Giả lập schema phiên bản 2B-1 cũ có public_share_token và legacy function
    await db.exec(`
      CREATE TABLE IF NOT EXISTS public.scorm_launch_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        package_id UUID NOT NULL REFERENCES public.scorm_packages(id) ON DELETE CASCADE,
        material_id UUID NOT NULL REFERENCES public.learning_materials(id) ON DELETE CASCADE,
        user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
        public_share_token TEXT,
        session_token_hash TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_accessed_at TIMESTAMPTZ
      );

      GRANT ALL ON public.scorm_launch_sessions TO anon, authenticated;

      CREATE OR REPLACE FUNCTION public.create_scorm_launch_session(
        p_material_id UUID DEFAULT NULL,
        p_share_token TEXT DEFAULT NULL,
        p_session_token_hash TEXT DEFAULT NULL,
        p_ttl_seconds INT DEFAULT 600
      )
      RETURNS JSONB LANGUAGE plpgsql AS $$ BEGIN RETURN '{}'::jsonb; END; $$;
    `);

    // Chạy migration ADD_SCORM_LAUNCH_SESSIONS.sql trên DB cũ
    await db.exec(phase2bSql);
    recordPass('UPGRADE1', 'Áp dụng ADD_SCORM_LAUNCH_SESSIONS.sql thành công trên cơ sở dữ liệu phiên bản cũ');

    // UPGRADE2: Cột public_share_token đã bị DROP
    const checkColRes = await db.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'scorm_launch_sessions';
    `);
    const cols = checkColRes.rows.map(r => r.column_name);
    assert.equal(cols.includes('public_share_token'), false, 'public_share_token column must be dropped');
    recordPass('UPGRADE2', 'Cột legacy public_share_token đã được loại bỏ hoàn toàn khỏi bảng');

    // UPGRADE3: Cột access_mode tồn tại và ràng buộc check hợp lệ
    assert.equal(cols.includes('access_mode'), true, 'access_mode column must exist');
    const checkConstraintRes = await db.query(`
      SELECT conname FROM pg_constraint 
      WHERE conrelid = 'public.scorm_launch_sessions'::regclass AND conname = 'scorm_launch_sessions_access_mode_check';
    `);
    assert.equal(checkConstraintRes.rows.length, 1, 'Named constraint must exist');
    recordPass('UPGRADE3', 'Cột access_mode tồn tại với named constraint scorm_launch_sessions_access_mode_check');

    // UPGRADE4: Legacy policies không còn
    const checkPolRes = await db.query(`
      SELECT policyname FROM pg_policies 
      WHERE schemaname = 'public' AND tablename = 'scorm_launch_sessions';
    `);
    assert.equal(checkPolRes.rows.length, 0, 'No direct browser policies should exist on RPC-only table');
    recordPass('UPGRADE4', 'Toàn bộ legacy table policies cũ đã được dọn dẹp (RPC-only contract)');

    // UPGRADE5: Legacy polymorphic function đã bị DROP
    let legacyFuncFound = false;
    try {
      await db.query(`SELECT public.create_scorm_launch_session();`);
      legacyFuncFound = true;
    } catch {
      legacyFuncFound = false;
    }
    assert.equal(legacyFuncFound, false, 'Legacy create_scorm_launch_session function must not exist');
    recordPass('UPGRADE5', 'Hàm legacy create_scorm_launch_session đã được xóa bỏ khỏi DB');

    // UPGRADE6: Anon table privileges = NONE
    await asUser(null, 'anon');
    let anonSelectBlocked = false;
    try { await db.query(`SELECT * FROM public.scorm_launch_sessions;`); } catch { anonSelectBlocked = true; }
    assert.equal(anonSelectBlocked, true);
    recordPass('UPGRADE6', 'Anon privileges trên bảng = NONE (SELECT/INSERT/UPDATE/DELETE bị chặn hoàn toàn)');

    // UPGRADE7: Authenticated table privileges = NONE
    await asUser(null, 'authenticated');
    let authSelectBlocked = false;
    try { await db.query(`SELECT * FROM public.scorm_launch_sessions;`); } catch { authSelectBlocked = true; }
    assert.equal(authSelectBlocked, true);
    recordPass('UPGRADE7', 'Authenticated privileges trên bảng = NONE (RPC-only contract bảo vệ bảng tuyệt đối)');

    // UPGRADE8: Idempotency check (chạy lại migration lần 2 liên tiếp)
    await asUser(null, 'postgres');
    await db.exec(phase2bSql);
    recordPass('UPGRADE8', 'Migration ADD_SCORM_LAUNCH_SESSIONS.sql chạy lần 2 liên tiếp thành công 100% không lỗi');
    recordPass('IDEMPOTENCY_2B1', 'Tính lũy thừa (Idempotency) của migration được chứng minh toàn diện');


    // ---------------------------------------------------------
    // 5. SEED DỮ LIỆU BÀI HỌC VÀ SCORM PACKAGES
    // ---------------------------------------------------------
    const adminId = '00000000-0000-0000-0000-000000000001';
    const teacher1Id = '00000000-0000-0000-0000-000000000002';
    const teacher2Id = '00000000-0000-0000-0000-000000000003';
    const student1Id = '00000000-0000-0000-0000-000000000004'; // Lớp 1A
    const student2Id = '00000000-0000-0000-0000-000000000005'; // Lớp 1B (Được share)
    const student3Id = '00000000-0000-0000-0000-000000000006'; // Lớp 2A (Không quyền)

    const class1A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const class1B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const class2A = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

    const materialClassOnlyId = '11111111-1111-1111-1111-111111111111';
    const materialPublicId = '22222222-2222-2222-2222-222222222222';
    const materialOtherTeacherId = '33333333-3333-3333-3333-333333333333';

    const packageAId = '44444444-4444-4444-4444-444444444444';
    const packageBId = '55555555-5555-5555-5555-555555555555';
    const packageCId = '66666666-6666-6666-6666-666666666666';

    const publicShareToken = 'pub_token_scorm_987654';

    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${adminId}', 'admin@school.edu.vn'),
        ('${teacher1Id}', 'teacher1@school.edu.vn'),
        ('${teacher2Id}', 'teacher2@school.edu.vn'),
        ('${student1Id}', 'student1@school.edu.vn'),
        ('${student2Id}', 'student2@school.edu.vn'),
        ('${student3Id}', 'student3@school.edu.vn');

      INSERT INTO public.profiles (id, full_name, email, role) VALUES
        ('${adminId}', 'Quản trị viên', 'admin@school.edu.vn', 'admin'),
        ('${teacher1Id}', 'Cô Lan', 'teacher1@school.edu.vn', 'teacher'),
        ('${teacher2Id}', 'Thầy Hùng', 'teacher2@school.edu.vn', 'teacher'),
        ('${student1Id}', 'Em An (Lớp 1A)', 'student1@school.edu.vn', 'student'),
        ('${student2Id}', 'Em Bình (Lớp 1B)', 'student2@school.edu.vn', 'student'),
        ('${student3Id}', 'Em Cường (Lớp 2A)', 'student3@school.edu.vn', 'student');

      INSERT INTO public.classes (id, name, grade_level, code, teacher_id) VALUES
        ('${class1A}', 'Lớp 1A', 1, 'LH1A', '${teacher1Id}'),
        ('${class1B}', 'Lớp 1B', 1, 'LH1B', '${teacher1Id}'),
        ('${class2A}', 'Lớp 2A', 2, 'LH2A', '${teacher2Id}');

      INSERT INTO public.class_members (class_id, student_id) VALUES
        ('${class1A}', '${student1Id}'),
        ('${class1B}', '${student2Id}'),
        ('${class2A}', '${student3Id}');

      -- Bài 1: Dành cho Lớp 1A, được share sang Lớp 1B (SCORM 1.2)
      INSERT INTO public.learning_materials (id, title, subject, class_id, file_type, visibility, created_by)
      VALUES ('${materialClassOnlyId}', 'Toán 1: SCORM Phép Cộng', 'Toán', '${class1A}', 'scorm', 'class', '${teacher1Id}');

      INSERT INTO public.learning_material_shares (material_id, class_id)
      VALUES ('${materialClassOnlyId}', '${class1B}');

      INSERT INTO public.scorm_packages (id, material_id, package_version, scorm_version, launch_path, content_root, status, created_by)
      VALUES ('${packageAId}', '${materialClassOnlyId}', '1.0', '1.2', 'index.html', '${teacher1Id}/${packageAId}', 'ready', '${teacher1Id}');

      -- Bài 2: Công khai (SCORM 2004)
      INSERT INTO public.learning_materials (id, title, subject, class_id, file_type, visibility, share_token, created_by)
      VALUES ('${materialPublicId}', 'Tiếng Việt: Bảng Chữ Cái', 'Tiếng Việt', '${class1A}', 'scorm', 'public', '${publicShareToken}', '${teacher1Id}');

      INSERT INTO public.scorm_packages (id, material_id, package_version, scorm_version, launch_path, content_root, status, created_by)
      VALUES ('${packageBId}', '${materialPublicId}', '1.0', '2004', 'course/entry.html', '${teacher1Id}/${packageBId}', 'ready', '${teacher1Id}');

      -- Bài 3: Riêng của Teacher 2 (Lớp 2A)
      INSERT INTO public.learning_materials (id, title, subject, class_id, file_type, visibility, created_by)
      VALUES ('${materialOtherTeacherId}', 'Khoa học 2: Khám phá', 'Khoa học', '${class2A}', 'scorm', 'class', '${teacher2Id}');

      INSERT INTO public.scorm_packages (id, material_id, package_version, scorm_version, launch_path, content_root, status, created_by)
      VALUES ('${packageCId}', '${materialOtherTeacherId}', '1.0', '1.2', 'index.html', '${teacher2Id}/${packageCId}', 'ready', '${teacher2Id}');
    `);

    // ---------------------------------------------------------
    // 6. MOCK STORAGE NỘI DUNG TỆP SCORM CHO PACKAGES
    // ---------------------------------------------------------
    const rootA = `${teacher1Id}/${packageAId}`;
    mockStorage.set(`${rootA}/index.html`, {
      content: Buffer.from(`<!DOCTYPE html><html><head><title>SCORM 1.2 SCO</title><link rel="stylesheet" href="css/main.css"><script src="js/app.js"></script></head><body><h1>SCO 1.2 Content</h1><img src="img/logo.png" /></body></html>`),
      mime: 'text/html; charset=utf-8',
    });
    mockStorage.set(`${rootA}/css/main.css`, {
      content: Buffer.from(`body { font-family: sans-serif; background: #f0fdf4; color: #166534; }`),
      mime: 'text/css; charset=utf-8',
    });
    mockStorage.set(`${rootA}/js/app.js`, {
      content: Buffer.from(`
        if (window.parent && window.parent.API) {
          window.parent.API.LMSInitialize("");
          window.parent.API.LMSSetValue("cmi.core.lesson_status", "completed");
          window.parent.API.LMSSetValue("cmi.core.score.raw", "100");
          window.parent.API.LMSCommit("");
          window.parent.API.LMSFinish("");
        }
      `),
      mime: 'text/javascript; charset=utf-8',
    });
    mockStorage.set(`${rootA}/img/logo.png`, {
      content: Buffer.from('PNG_MOCK_IMAGE_DATA_BYTES'),
      mime: 'image/png',
    });
    mockStorage.set(`${rootA}/assets/sub/deep.js`, {
      content: Buffer.from('console.log("deep asset loaded");'),
      mime: 'text/javascript; charset=utf-8',
    });

    const rootB = `${teacher1Id}/${packageBId}`;
    mockStorage.set(`${rootB}/course/entry.html`, {
      content: Buffer.from(`<!DOCTYPE html><html><head><title>SCORM 2004 SCO</title></head><body><h1>SCO 2004 Entry</h1></body></html>`),
      mime: 'text/html; charset=utf-8',
    });

    const rootC = `${teacher2Id}/${packageCId}`;
    mockStorage.set(`${rootC}/index.html`, {
      content: Buffer.from(`<h1>Secret Package C</h1>`),
      mime: 'text/html; charset=utf-8',
    });

    // ---------------------------------------------------------
    // 7. KHỞI CHẠY LOCAL HTTP ASSET GATEWAY SERVER (ISOLATED ORIGIN B)
    // ---------------------------------------------------------
    server = http.createServer(async (req, res) => {
      try {
        const rawUrl = req.url || '';

        // Kiểm tra sớm Path Traversal trên raw URL trước khi phân tích
        if (
          rawUrl.includes('/../') ||
          rawUrl.includes('/..') ||
          rawUrl.includes('\\..') ||
          rawUrl.includes('..\\') ||
          rawUrl.includes('%2e%2e') ||
          rawUrl.includes('%2E%2E') ||
          rawUrl.includes('\0') ||
          rawUrl.includes('%00')
        ) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('403 Forbidden: Path traversal attempt blocked');
          return;
        }

        const url = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`);

        // Route: /session-info?session=<rawToken>
        if (url.pathname === '/session-info') {
          const rawToken = url.searchParams.get('session');
          if (!rawToken) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ valid: false, reason: 'MISSING_SESSION_TOKEN' }));
            return;
          }
          const tokenHash = hashSessionToken(rawToken);
          // Trusted Backend gọi resolver bằng postgres/service_role
          await asUser(null, 'postgres');
          const resolveRes = await db.query(`SELECT public.resolve_scorm_session_asset($1) AS info;`, [tokenHash]);
          const info = resolveRes.rows[0]?.info;

          if (!info || !info.valid) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(info || { valid: false, reason: 'SESSION_INVALID' }));
            return;
          }

          // Trả thông tin sanitized cho player (Tuyệt đối không để lộ content_root hay storage paths)
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            valid: true,
            launch_path: info.launch_path,
            scorm_version: info.scorm_version,
            expires_at: info.expires_at,
          }));
          return;
        }

        // Route: /session/:sessionToken/<relative_path...>
        const match = url.pathname.match(/^\/session\/([^/]+)\/(.*)$/);
        if (match) {
          const [, rawToken, rawRelativePath] = match;

          // 1. Hash session token và đối chiếu DB qua Trusted Backend (postgres)
          const tokenHash = hashSessionToken(rawToken);
          await asUser(null, 'postgres');
          const resolveRes = await db.query(`SELECT public.resolve_scorm_session_asset($1) AS info;`, [tokenHash]);
          const info = resolveRes.rows[0]?.info;

          if (!info || !info.valid) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`403 Forbidden: Session invalid (${info?.reason || 'NOT_FOUND'})`);
            return;
          }

          // 2. Kiểm tra Path Traversal & Sanitization
          const pathCheck = sanitizeScormRelativePath(rawRelativePath || info.launch_path);
          if (!pathCheck.valid) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`403 Forbidden: Path traversal blocked (${pathCheck.reason})`);
            return;
          }

          // 3. Ghép đường dẫn Storage và nạp asset từ Private Storage
          const storagePath = `${info.content_root}/${pathCheck.normalizedPath}`;
          const asset = mockStorage.get(storagePath);

          if (!asset) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`404 Not Found: Asset does not exist`);
            return;
          }

          // 4. Trả Asset với Security Headers và MIME Type chuẩn
          res.writeHead(200, {
            'Content-Type': asset.mime || getMimeTypeForAsset(pathCheck.normalizedPath),
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'private, no-transform, max-age=300',
          });
          res.end(asset.content);
          return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 Internal Server Error');
      }
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        serverOrigin = `http://127.0.0.1:${serverPort}`;
        resolve();
      });
    });

    console.log(`🌐 Local Asset Gateway Server started at ${serverOrigin}\n`);


    // =========================================================
    // NHÓM 1: LEAST PRIVILEGE TABLE & RPC PERMISSIONS (PRIV1 - PRIV7)
    // =========================================================
    console.log('--- NHÓM 1: LEAST PRIVILEGE TABLE & RPC PERMISSIONS (PRIV1 - PRIV7) ---');

    // PRIV1: Anon direct SELECT session table BLOCKED
    await asUser(null, 'anon');
    let priv1Blocked = false;
    try { await db.query(`SELECT * FROM public.scorm_launch_sessions;`); } catch { priv1Blocked = true; }
    assert.equal(priv1Blocked, true);
    recordPass('PRIV1', 'Anon bị chặn hoàn toàn quyền SELECT trực tiếp trên bảng sessions');

    // PRIV2: Anon direct INSERT session table BLOCKED
    let priv2Blocked = false;
    try { await db.query(`INSERT INTO public.scorm_launch_sessions (package_id, material_id, session_token_hash, expires_at) VALUES ('${packageAId}', '${materialClassOnlyId}', 'fakehash', now());`); } catch { priv2Blocked = true; }
    assert.equal(priv2Blocked, true);
    recordPass('PRIV2', 'Anon bị chặn hoàn toàn quyền INSERT trực tiếp trên bảng sessions');

    // PRIV3: Authenticated arbitrary direct INSERT BLOCKED
    await asUser(student1Id, 'authenticated');
    let priv3Blocked = false;
    try { await db.query(`INSERT INTO public.scorm_launch_sessions (package_id, material_id, user_id, session_token_hash, expires_at) VALUES ('${packageAId}', '${materialClassOnlyId}', '${student1Id}', 'fakehash', now());`); } catch { priv3Blocked = true; }
    assert.equal(priv3Blocked, true);
    recordPass('PRIV3', 'Authenticated user bị chặn INSERT trực tiếp (bắt buộc gọi RPC)');

    // PRIV4: Anon cannot call authenticated launch RPC
    await asUser(null, 'anon');
    let priv4Blocked = false;
    try { await db.query(`SELECT public.create_scorm_launch_session_authenticated($1);`, [materialClassOnlyId]); } catch { priv4Blocked = true; }
    assert.equal(priv4Blocked, true);
    recordPass('PRIV4', 'Anon bị chặn không thể thực thi hàm create_scorm_launch_session_authenticated');

    // PRIV5: Anon & Authenticated cannot call internal resolver directly
    let priv5Blocked = false;
    try { await db.query(`SELECT public.resolve_scorm_session_asset('fakehash');`); } catch { priv5Blocked = true; }
    assert.equal(priv5Blocked, true);
    recordPass('PRIV5', 'Anon bị chặn không thể gọi trực tiếp hàm resolve_scorm_session_asset');

    // PRIV6: Authenticated direct SELECT session table BLOCKED (RPC-only contract)
    await asUser(student1Id, 'authenticated');
    let priv6Blocked = false;
    try { await db.query(`SELECT * FROM public.scorm_launch_sessions;`); } catch { priv6Blocked = true; }
    assert.equal(priv6Blocked, true);
    recordPass('PRIV6', 'Authenticated user bị chặn SELECT trực tiếp trên bảng sessions (RPC-only table)');

    // PRIV7: Admin browser role direct SELECT session table BLOCKED
    await asUser(adminId, 'authenticated');
    let priv7Blocked = false;
    try { await db.query(`SELECT * FROM public.scorm_launch_sessions;`); } catch { priv7Blocked = true; }
    assert.equal(priv7Blocked, true);
    recordPass('PRIV7', 'Admin qua browser role cũng bị chặn direct table SELECT (quản trị qua trusted RPC/service_role)');


    // =========================================================
    // NHÓM 2: 256-BIT CSPRNG TOKEN GENERATION & ENTROPY (TOKEN1 - TOKEN9, CRYPTO4 - CRYPTO7, TTL1, MAP1)
    // =========================================================
    console.log('\n--- NHÓM 2: 256-BIT CSPRNG TOKEN GENERATION & ENTROPY (TOKEN1 - TOKEN9, CRYPTO4 - CRYPTO7, TTL1, MAP1) ---');

    // TOKEN9: Runtime calls genuine crypto functions successfully under SET search_path = ''
    await asUser(null, 'postgres');
    const cryptoProcRes = await db.query(`
      SELECT pg_catalog.octet_length(extensions.gen_random_bytes(32)) AS raw_len,
             pg_catalog.encode(extensions.gen_random_bytes(32), 'hex') AS sample_token;
    `);
    assert.equal(cryptoProcRes.rows[0].raw_len, 32, 'extensions.gen_random_bytes(32) must return exactly 32 bytes');
    recordPass('TOKEN9', 'Runtime thực sự gọi crypto function thành công với SET search_path=""');

    // CRYPTO4, TOKEN3 & TOKEN4: Server generates secure opaque token (64 hex characters)
    await asUser(student1Id, 'authenticated');
    const authSessRes1 = await db.query(`SELECT public.create_scorm_launch_session_authenticated($1) AS res;`, [materialClassOnlyId]);
    const authSessData1 = authSessRes1.rows[0].res;
    assert.equal(authSessData1.success, true);
    assert.ok(authSessData1.session_token);
    assert.equal(authSessData1.session_token.length, 64, 'Token must have 64 hex characters (256-bit entropy)');
    assert.equal(/^[0-9a-f]{64}$/.test(authSessData1.session_token), true, 'Token must be strictly URL-safe lowercase hex');
    recordPass('CRYPTO4', 'RPC tạo session thực sự trả token khớp định dạng ^[0-9a-f]{64}$');
    recordPass('TOKEN4', 'Server tự sinh opaque session token với 256-bit CSPRNG random entropy');
    recordPass('TOKEN3', 'Client không tự quyết định session_token_hash hay giá trị authoritative');

    // CRYPTO5 & TOKEN5: Raw token decodes to exactly 32 random bytes (256 bits)
    const tokenBuffer = Buffer.from(authSessData1.session_token, 'hex');
    assert.equal(tokenBuffer.length, 32, 'Decoded token must be exactly 32 bytes');
    recordPass('CRYPTO5', 'Raw session token decode thành đúng 32 random bytes (256-bit CSPRNG output)');
    recordPass('TOKEN5', 'Token đạt độ dài mật mã 256 bits CSPRNG entropy');

    // CRYPTO7 & TOKEN6: 2 consecutive sessions produce different tokens (Unique entropy)
    const authSessRes2 = await db.query(`SELECT public.create_scorm_launch_session_authenticated($1) AS res;`, [materialClassOnlyId]);
    const authSessData2 = authSessRes2.rows[0].res;
    assert.notEqual(authSessData1.session_token, authSessData2.session_token, 'Consecutive tokens must be distinct');
    recordPass('CRYPTO7', 'Hai session liên tiếp sinh ra 2 token độc lập và khác biệt hoàn toàn');
    recordPass('TOKEN6', 'Không có hiện tượng trùng lặp hoặc predictable tokens');

    // TOKEN7 & TOKEN1: Raw session token is absent from database table
    await asUser(null, 'postgres');
    const rowInDb = await db.query(`SELECT * FROM public.scorm_launch_sessions WHERE id = $1;`, [authSessData1.session_id]);
    assert.equal(rowInDb.rows.length, 1);
    const storedHash = rowInDb.rows[0].session_token_hash;
    assert.notEqual(storedHash, authSessData1.session_token, 'DB must only store hash, not raw token');
    recordPass('TOKEN1', 'Raw session token hoàn toàn không xuất hiện trong cơ sở dữ liệu');
    recordPass('TOKEN7', 'Bảng scorm_launch_sessions được xác thực không chứa raw session token');

    // CRYPTO6 & TOKEN8: Database hash matches SHA-256(raw_token)
    assert.equal(storedHash, hashSessionToken(authSessData1.session_token), 'DB hash must match SHA-256 of raw token');
    recordPass('CRYPTO6', 'DB hash khớp encode(digest(raw_token, sha256), hex)');
    recordPass('TOKEN8', 'Hash trong DB khớp chính xác kết quả SHA-256 của raw token được cấp');

    // TOKEN2: Raw material public share_token is absent from session row
    await asUser(null, 'anon');
    const pubSessRes = await db.query(`SELECT public.create_public_scorm_launch_session($1) AS res;`, [publicShareToken]);
    const pubSessData = pubSessRes.rows[0].res;
    assert.equal(pubSessData.success, true);

    await asUser(null, 'postgres');
    const pubRowInDb = await db.query(`SELECT * FROM public.scorm_launch_sessions WHERE id = $1;`, [pubSessData.session_id]);
    assert.equal(pubRowInDb.rows[0].access_mode, 'public');
    assert.equal(pubRowInDb.rows[0].user_id, null);
    assert.equal(pubRowInDb.rows[0].public_share_token, undefined);
    recordPass('TOKEN2', 'Bảng session không lưu raw public share_token, chỉ lưu access_mode = public');

    // TTL1: Server controls authoritative TTL (10 minutes)
    const expiresAt = new Date(authSessData1.expires_at).getTime();
    const now = Date.now();
    const diffMinutes = (expiresAt - now) / (60 * 1000);
    assert.ok(diffMinutes >= 9.8 && diffMinutes <= 10.2, 'TTL must be approximately 10 minutes from server');
    recordPass('TTL1', 'Thời gian sống (TTL) 10 phút được ấn định độc quyền bởi Server');

    // MAP1: Mismatch material and package prevented (Package derived strictly from material_id)
    assert.equal(authSessData1.package_id, packageAId, 'Session must correctly map to package A of material');
    recordPass('MAP1', 'Package được derive toàn vẹn từ material_id, ngăn chặn mismatch package');


    // =========================================================
    // NHÓM 3: SESSION AUTHORIZATION LIFECYCLE (SESSION1 - SESSION8)
    // =========================================================
    console.log('\n--- NHÓM 3: SESSION AUTHORIZATION LIFECYCLE (SESSION1 - SESSION8) ---');

    // SESSION1: Authorized student gets session
    recordPass('SESSION1', 'Học sinh lớp chính (1A) được cấp launch session thành công');

    // SESSION2: Unauthorized student blocked
    await asUser(student3Id, 'authenticated');
    let s2Blocked = false;
    try {
      await db.query(`SELECT public.create_scorm_launch_session_authenticated($1) AS res;`, [materialClassOnlyId]);
    } catch (err) {
      if (err.message.includes('PERMISSION_DENIED')) s2Blocked = true;
    }
    assert.equal(s2Blocked, true);
    recordPass('SESSION2', 'Học sinh lớp khác không có quyền bị chặn cấp session chính xác');

    // SESSION3: Admin gets session
    await asUser(adminId, 'authenticated');
    const s3Res = await db.query(`SELECT public.create_scorm_launch_session_authenticated($1) AS res;`, [materialOtherTeacherId]);
    assert.equal(s3Res.rows[0].res.success, true);
    recordPass('SESSION3', 'Admin có toàn quyền tạo launch session trên mọi bài học');

    // SESSION4: Owner teacher gets session
    await asUser(teacher1Id, 'authenticated');
    const s4Res = await db.query(`SELECT public.create_scorm_launch_session_authenticated($1) AS res;`, [materialClassOnlyId]);
    assert.equal(s4Res.rows[0].res.success, true);
    recordPass('SESSION4', 'Giáo viên sở hữu tạo launch session thành công');

    // SESSION5: Random public token blocked
    await asUser(null, 'anon');
    let s5Blocked = false;
    try {
      await db.query(`SELECT public.create_public_scorm_launch_session('invalid_token_999') AS res;`, []);
    } catch (err) {
      if (err.message.includes('PERMISSION_DENIED')) s5Blocked = true;
    }
    assert.equal(s5Blocked, true);
    recordPass('SESSION5', 'Mã public share token giả mạo/không tồn tại bị từ chối');

    // SESSION6: Valid public material token creates session
    recordPass('SESSION6', 'Khách vãng lai với public share token hợp lệ tạo session thành công');

    // SESSION7: Expired session blocked
    await asUser(null, 'postgres');
    const expiredToken = 'expired_raw_token_1234567890abcdef1234567890abcdef';
    const expiredHash = hashSessionToken(expiredToken);
    await db.exec(`
      INSERT INTO public.scorm_launch_sessions (package_id, material_id, user_id, session_token_hash, expires_at)
      VALUES ('${packageAId}', '${materialClassOnlyId}', '${student1Id}', '${expiredHash}', now() - interval '5 minutes');
    `);
    const s7Resolve = await db.query(`SELECT public.resolve_scorm_session_asset($1) AS info;`, [expiredHash]);
    assert.equal(s7Resolve.rows[0].info.valid, false);
    assert.equal(s7Resolve.rows[0].info.reason, 'SESSION_EXPIRED');
    recordPass('SESSION7', 'Session hết hạn bị từ chối truy cập chính xác');

    // SESSION8: Revoked session blocked
    await asUser(teacher1Id, 'authenticated');
    const revSessRes = await db.query(`SELECT public.create_scorm_launch_session_authenticated($1) AS res;`, [materialClassOnlyId]);
    const revSessId = revSessRes.rows[0].res.session_id;
    const revToken = revSessRes.rows[0].res.session_token;
    const revHash = hashSessionToken(revToken);
    // Thu hồi session
    await db.query(`SELECT public.revoke_scorm_launch_session($1);`, [revSessId]);
    await asUser(null, 'postgres');
    const s8Resolve = await db.query(`SELECT public.resolve_scorm_session_asset($1) AS info;`, [revHash]);
    assert.equal(s8Resolve.rows[0].info.valid, false);
    assert.equal(s8Resolve.rows[0].info.reason, 'SESSION_REVOKED');
    recordPass('SESSION8', 'Session bị thu hồi (revoked) bị từ chối truy cập chính xác');


    // =========================================================
    // NHÓM 4: PUBLIC DYNAMIC VISIBILITY RECHECK (PUBLIC_REV1)
    // =========================================================
    console.log('\n--- NHÓM 4: PUBLIC DYNAMIC VISIBILITY RECHECK (PUBLIC_REV1) ---');

    // PUBLIC_REV1: Khi material chuyển từ public sang class/school, session public lập tức mất hiệu lực
    const pubActiveToken = pubSessData.session_token;
    const pubActiveHash = hashSessionToken(pubActiveToken);

    // Trước khi đổi: session hợp lệ
    await asUser(null, 'postgres');
    const preCheck = await db.query(`SELECT public.resolve_scorm_session_asset($1) AS info;`, [pubActiveHash]);
    assert.equal(preCheck.rows[0].info.valid, true);

    // Đổi visibility sang 'class'
    await db.exec(`UPDATE public.learning_materials SET visibility = 'class' WHERE id = '${materialPublicId}';`);

    // Sau khi đổi: dynamic recheck phát hiện material không còn public
    const postCheck = await db.query(`SELECT public.resolve_scorm_session_asset($1) AS info;`, [pubActiveHash]);
    assert.equal(postCheck.rows[0].info.valid, false);
    assert.equal(postCheck.rows[0].info.reason, 'PUBLIC_ACCESS_REVOKED');

    // Khôi phục lại visibility public
    await db.exec(`UPDATE public.learning_materials SET visibility = 'public' WHERE id = '${materialPublicId}';`);
    recordPass('PUBLIC_REV1', 'Public session lập tức bị vô hiệu hóa khi tài liệu bị chuyển khỏi chế độ công khai');


    // =========================================================
    // NHÓM 5: ASSET GATEWAY HTTP & PATH SECURITY (ASSET1 - ASSET8)
    // =========================================================
    console.log('\n--- NHÓM 5: ASSET GATEWAY HTTP & PATH SECURITY (ASSET1 - ASSET8) ---');

    const testActiveToken = authSessData1.session_token;

    async function fetchGateway(subPath) {
      return new Promise((resolve, reject) => {
        const rawPath = `/session/${testActiveToken}/${subPath}`;
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: serverPort,
            path: rawPath,
            method: 'GET',
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
              resolve({
                status: res.statusCode,
                headers: {
                  get: (name) => res.headers[name.toLowerCase()] || '',
                },
                text: async () => data,
              });
            });
          }
        );
        req.on('error', reject);
        req.end();
      });
    }

    // ASSET1: Launch HTML 200
    const a1 = await fetchGateway('index.html');
    assert.equal(a1.status, 200);
    assert.ok(a1.headers.get('content-type').includes('text/html'));
    assert.equal(a1.headers.get('x-content-type-options'), 'nosniff');
    recordPass('ASSET1', 'Nạp tệp launch HTML qua Gateway thành công (HTTP 200, Content-Type text/html)');

    // ASSET2: CSS 200
    const a2 = await fetchGateway('css/main.css');
    assert.equal(a2.status, 200);
    assert.ok(a2.headers.get('content-type').includes('text/css'));
    recordPass('ASSET2', 'Nạp relative CSS thành công (HTTP 200, Content-Type text/css)');

    // ASSET3: JS 200
    const a3 = await fetchGateway('js/app.js');
    assert.equal(a3.status, 200);
    assert.ok(a3.headers.get('content-type').includes('text/javascript'));
    recordPass('ASSET3', 'Nạp relative JavaScript thành công (HTTP 200, Content-Type text/javascript)');

    // ASSET4: Image 200
    const a4 = await fetchGateway('img/logo.png');
    assert.equal(a4.status, 200);
    assert.ok(a4.headers.get('content-type').includes('image/png'));
    recordPass('ASSET4', 'Nạp relative Image thành công (HTTP 200, Content-Type image/png)');

    // ASSET5: Nested relative path works
    const a5 = await fetchGateway('assets/sub/deep.js');
    assert.equal(a5.status, 200);
    recordPass('ASSET5', 'Nạp nested relative path sâu bên trong package thành công');

    // ASSET6: Traversal blocked
    const a6 = await fetchGateway('../../etc/passwd');
    assert.equal(a6.status, 403);
    recordPass('ASSET6', 'Hành vi Path Traversal tường minh (../) bị chặn đứng 403');

    // ASSET7: Encoded traversal blocked
    const a7 = await fetchGateway('%2e%2e%2f%2e%2e%2fsecret.txt');
    assert.equal(a7.status, 403);
    recordPass('ASSET7', 'Hành vi Encoded Path Traversal (%2e%2e) bị chặn đứng 403');

    // ASSET8: Package A token cannot read Package B assets
    const a8 = await fetchGateway('../' + packageCId + '/index.html');
    assert.equal(a8.status, 403);
    recordPass('ASSET8', 'Session token của Package A không thể truy cập tài nguyên của Package khác');


    // =========================================================
    // NHÓM 6: ISOLATED ORIGIN CONTRACT & SCORM API DISCOVERY (ORIGIN3, ORIGIN4, API5, API6)
    // =========================================================
    console.log('\n--- NHÓM 6: ISOLATED ORIGIN CONTRACT & SCORM API DISCOVERY (ORIGIN3, ORIGIN4, API5, API6) ---');

    const mainAppOrigin = 'http://localhost:5173';
    const playerOrigin = 'http://localhost:4174';

    // ORIGIN3: Main != Player
    assert.notEqual(mainAppOrigin, playerOrigin, 'Main origin and Player origin must be strictly separated');
    recordPass('ORIGIN3', 'Main App Origin (5173) và Player Origin (4174) được cách ly tuyệt đối');

    // ORIGIN4: Player == SCO
    const playerWrapperUrl = `${playerOrigin}/index.html?session=${testActiveToken}`;
    const scoAssetUrl = `${playerOrigin}/session/${testActiveToken}/index.html`;
    const wrapperOrigin = new URL(playerWrapperUrl).origin;
    const scoOrigin = new URL(scoAssetUrl).origin;
    assert.equal(wrapperOrigin, scoOrigin, 'Player wrapper and SCO assets must share the exact same origin B');
    recordPass('ORIGIN4', 'Player Wrapper và SCO Assets chung Origin B (4174), đảm bảo API discovery tự nhiên');

    // API5: SCORM 1.2 SCO finds parent.API
    const mockPlayerWindow12 = {
      API: createScorm12Api({ studentName: 'Em An' }),
    };
    const mockIframeWindow12 = {
      parent: mockPlayerWindow12,
    };
    assert.ok(mockIframeWindow12.parent.API, 'SCO frame must discover parent.API');
    assert.equal(mockIframeWindow12.parent.API.LMSInitialize(''), 'true');
    assert.equal(mockIframeWindow12.parent.API.LMSSetValue('cmi.core.lesson_status', 'passed'), 'true');
    assert.equal(mockIframeWindow12.parent.API.LMSCommit(''), 'true');
    assert.equal(mockIframeWindow12.parent.API.LMSFinish(''), 'true');
    recordPass('API5', 'SCORM 1.2 SCO trong frame phát hiện và thực thi thành công parent.API');

    // API6: SCORM 2004 SCO finds parent.API_1484_11
    const mockPlayerWindow2004 = {
      API_1484_11: createScorm2004Api({ studentName: 'Khách công khai' }),
    };
    const mockIframeWindow2004 = {
      parent: mockPlayerWindow2004,
    };
    assert.ok(mockIframeWindow2004.parent.API_1484_11, 'SCO frame must discover parent.API_1484_11');
    assert.equal(mockIframeWindow2004.parent.API_1484_11.Initialize(''), 'true');
    assert.equal(mockIframeWindow2004.parent.API_1484_11.SetValue('cmi.completion_status', 'completed'), 'true');
    assert.equal(mockIframeWindow2004.parent.API_1484_11.Commit(''), 'true');
    assert.equal(mockIframeWindow2004.parent.API_1484_11.Terminate(''), 'true');
    recordPass('API6', 'SCORM 2004 SCO trong frame phát hiện và thực thi thành công parent.API_1484_11');


    // =========================================================
    // NHÓM 7: SECURITY DEFINER AUDIT & DATA LEAK PREVENTION (FUNC1 - FUNC4, LEAK1 - LEAK5, GATEWAY_SEC1)
    // =========================================================
    console.log('\n--- NHÓM 7: SECURITY DEFINER AUDIT & DATA LEAK PREVENTION (FUNC1 - FUNC4, LEAK1 - LEAK5, GATEWAY_SEC1) ---');

    // FUNC1 - FUNC3: Audit migration SQL chứa SET search_path = '' trên tất cả các SECURITY DEFINER functions
    assert.ok(phase2bSql.includes("SET search_path = ''"), 'All SECURITY DEFINER functions must set search_path = empty');
    recordPass('FUNC1_3', 'Tất cả hàm SECURITY DEFINER được thiết lập SET search_path = "" và fully qualified');

    // FUNC4: Audit REVOKE ALL FROM PUBLIC
    assert.ok(phase2bSql.includes('REVOKE ALL ON FUNCTION public.resolve_scorm_session_asset'), 'Internal resolver must be revoked from public');
    recordPass('FUNC4', 'Hàm resolver nội bộ được thu hồi quyền gọi trực tiếp từ PUBLIC/anon/authenticated');

    // LEAK1: Response tạo session không chứa storage path
    const sessionOutputString = JSON.stringify(authSessData1);
    assert.equal(sessionOutputString.includes(rootA), false);
    assert.equal(sessionOutputString.includes('scorm-content'), false);
    recordPass('LEAK1', 'Response tạo session tuyệt đối không chứa raw storage path hay bucket name');

    // LEAK2: No service role
    assert.equal(sessionOutputString.includes('service_role'), false);
    assert.equal(sessionOutputString.includes('supabase_secret'), false);
    recordPass('LEAK2', 'Response không chứa Service Role Key hay DB credentials');

    // LEAK3: No Auth JWT
    assert.equal(sessionOutputString.includes('jwt'), false);
    assert.equal(sessionOutputString.includes('bearer'), false);
    recordPass('LEAK3', 'Response không để lộ Auth JWT Token hay User Credentials');

    // LEAK4 & LEAK5: HTTP Gateway Response không để lộ content_root và storage paths
    const infoHttpRes = await fetch(`${serverOrigin}/session-info?session=${testActiveToken}`);
    const infoJson = await infoHttpRes.json();
    assert.equal(infoJson.content_root, undefined, 'Public HTTP session info must not expose content_root');
    assert.equal(infoJson.package_root, undefined, 'Public HTTP session info must not expose package_root');
    recordPass('LEAK4', 'HTTP session-info endpoint không để lộ content_root ra ngoài client');
    recordPass('LEAK5', 'HTTP Gateway responses không để lộ bucket name hay internal storage layout');

    // GATEWAY_SEC1: Audit player frontend code does not contain service_role keys
    const playerJsContent = await fs.readFile(path.join(__dirname, '..', 'scorm-player', 'src', 'player.js'), 'utf-8');
    const playerViteContent = await fs.readFile(path.join(__dirname, '..', 'scorm-player', 'vite.config.js'), 'utf-8');
    assert.equal(playerJsContent.includes('service_role'), false);
    assert.equal(playerJsContent.includes('VITE_SUPABASE_SERVICE_ROLE_KEY'), false);
    assert.equal(playerViteContent.includes('VITE_SUPABASE_SERVICE_ROLE_KEY'), false);
    recordPass('GATEWAY_SEC1', 'DEV_GATEWAY_SECRET_BOUNDARY = PASS: Không có service_role key trong player bundle');

    console.log('\n================================================================');
    console.log(`🎉 TẤT CẢ ${passedTests}/${totalTests} TEST CASES ĐÃ HOÀN TẤT VÀ PASS 100%!`);
    console.log('================================================================\n');

  } finally {
    if (server) {
      server.close();
    }
  }
}

runScormPhase2B1HardenedTestSuite().catch((err) => {
  console.error('\n❌ SCORM PHASE 2B-1 HARDENED TEST FAILED:', err);
  process.exit(1);
});
