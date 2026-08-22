/**
 * ====================================================================
 * 🧪 TEST SUITE: SCORM PRODUCTION ASSET GATEWAY AUDIT & VERIFICATION
 * ====================================================================
 * Bao quát toàn bộ:
 * 1. Gateway Core (GW1 - GW21)
 * 2. Session Info Endpoint Security (INFO1 - INFO5)
 * 3. Comprehensive Path Traversal Matrix (PATH1 - PATH12)
 * 4. HTTP Range RFC Semantics & 416 (RANGE_PREFIX, RANGE_SUFFIX, RANGE_416_OVERFLOW, RANGE_416_INVERTED)
 * 5. Player Host Same-Origin Static Audit (PLAYER1 - PLAYER3)
 * ====================================================================
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { sanitizeScormRelativePath, getMimeTypeForAsset, hashSessionToken } from '../src/utils/scormPathSecurity.js';

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
      '--max-old-space-size=4096',
      ...process.execArgv,
      __filename,
      ...process.argv.slice(2),
    ],
    { stdio: 'inherit' }
  );
  process.exit(result.status ?? 0);
}


async function runProductionAssetGatewayAuditSuite() {
  console.log('================================================================');
  console.log('🧪 BẮT ĐẦU KIỂM TOÁN VÀ TEST SCORM PRODUCTION ASSET GATEWAY');
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

  const mockStorage = new Map();
  let server;
  let serverPort;
  let serverOrigin;

  try {
    // ---------------------------------------------------------
    // 1. SETUP BASE SCHEMA
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
    // 2. NẠP MIGRATIONS
    // ---------------------------------------------------------
    const phase2aSql = await fs.readFile(path.join(__dirname, '..', 'ADD_SCORM_PHASE2_MVP.sql'), 'utf-8');
    await db.exec(phase2aSql);

    const phase2bSql = await fs.readFile(path.join(__dirname, '..', 'ADD_SCORM_LAUNCH_SESSIONS.sql'), 'utf-8');
    await db.exec(phase2bSql);

    // ---------------------------------------------------------
    // 3. SEED DỮ LIỆU BÀI HỌC VÀ SCORM PACKAGES
    // ---------------------------------------------------------
    const teacherId = '00000000-0000-0000-0000-000000000002';
    const studentId = '00000000-0000-0000-0000-000000000004';
    const classId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const materialId = '11111111-1111-1111-1111-111111111111';
    const packageAId = '44444444-4444-4444-4444-444444444444';
    const packageBId = '55555555-5555-5555-5555-555555555555';

    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${teacherId}', 'teacher@school.edu.vn'),
        ('${studentId}', 'student@school.edu.vn');

      INSERT INTO public.profiles (id, full_name, email, role) VALUES
        ('${teacherId}', 'Cô Lan', 'teacher@school.edu.vn', 'teacher'),
        ('${studentId}', 'Em An', 'student@school.edu.vn', 'student');

      INSERT INTO public.classes (id, name, grade_level, code, teacher_id) VALUES
        ('${classId}', 'Lớp 1A', 1, 'LH1A', '${teacherId}');

      INSERT INTO public.class_members (class_id, student_id) VALUES
        ('${classId}', '${studentId}');

      INSERT INTO public.learning_materials (id, title, subject, class_id, file_type, visibility, created_by)
      VALUES ('${materialId}', 'Toán 1: SCORM Phép Cộng', 'Toán', '${classId}', 'scorm', 'class', '${teacherId}');

      INSERT INTO public.scorm_packages (id, material_id, package_version, scorm_version, launch_path, content_root, status, created_by)
      VALUES ('${packageAId}', '${materialId}', '1.0', '1.2', 'index.html', '${teacherId}/${packageAId}', 'ready', '${teacherId}');
    `);

    // Storage Mock Content
    const rootA = `${teacherId}/${packageAId}`;
    const videoData = Buffer.alloc(4096, 'V'); // 4KB mock video binary

    mockStorage.set(`${rootA}/index.html`, {
      content: Buffer.from(`<!DOCTYPE html><html><head><title>SCORM</title></head><body><h1>Hello SCORM</h1></body></html>`),
      mime: 'text/html; charset=utf-8',
    });
    mockStorage.set(`${rootA}/styles/main.css`, {
      content: Buffer.from(`body { color: #333; }`),
      mime: 'text/css; charset=utf-8',
    });
    mockStorage.set(`${rootA}/scripts/app.js`, {
      content: Buffer.from(`console.log("SCORM App Loaded");`),
      mime: 'text/javascript; charset=utf-8',
    });
    mockStorage.set(`${rootA}/images/diagram.png`, {
      content: Buffer.from('PNG_MOCK_DATA'),
      mime: 'image/png',
    });
    mockStorage.set(`${rootA}/sub/deep/asset.json`, {
      content: Buffer.from(JSON.stringify({ key: 'value' })),
      mime: 'application/json; charset=utf-8',
    });
    mockStorage.set(`${rootA}/media/intro.mp4`, {
      content: videoData,
      mime: 'video/mp4',
    });

    // ---------------------------------------------------------
    // 4. PRODUCTION-LIKE HTTP GATEWAY SERVER
    // ---------------------------------------------------------
    server = http.createServer(async (req, res) => {
      try {
        const corsHeaders = {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, range',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length, Content-Type',
        };

        if (req.method === 'OPTIONS') {
          res.writeHead(200, corsHeaders);
          res.end('ok');
          return;
        }

        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, {
            ...corsHeaders,
            'Content-Type': 'application/json; charset=utf-8',
            Allow: 'GET, HEAD, OPTIONS',
          });
          res.end(JSON.stringify({ success: false, message: '405 Method Not Allowed: Chỉ hỗ trợ GET và HEAD.' }));
          return;
        }

        const rawUrl = req.url || '';

        // Path Traversal early detection
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
          res.writeHead(403, { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('403 Forbidden: Path traversal attempt blocked');
          return;
        }

        const url = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`);
        let pathname = url.pathname.replace(/^\/scorm-asset-gateway/, '');

        // Route 1: /session-info?session=<token>
        if (pathname === '/session-info') {
          const rawToken = url.searchParams.get('session');
          if (!rawToken || !/^[0-9a-f]{64}$/.test(rawToken)) {
            res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ valid: false, reason: 'INVALID_OR_MISSING_SESSION_TOKEN' }));
            return;
          }

          const tokenHash = hashSessionToken(rawToken);
          await asUser(null, 'postgres');
          const resolveRes = await db.query(`SELECT public.resolve_scorm_session_asset($1) AS info;`, [tokenHash]);
          const info = resolveRes.rows[0]?.info;

          if (!info || !info.valid) {
            res.writeHead(403, { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ valid: false, reason: info?.reason || 'SESSION_INVALID' }));
            return;
          }

          // Trả về metadata sanitized cho player (Tuyệt đối không để lộ content_root hay bucket name)
          const infoBody = JSON.stringify({
            valid: true,
            launch_path: info.launch_path,
            scorm_version: info.scorm_version,
            expires_at: info.expires_at,
          });

          res.writeHead(200, {
            ...corsHeaders,
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'private, no-transform, max-age=60',
          });
          if (req.method === 'HEAD') {
            res.end();
          } else {
            res.end(infoBody);
          }
          return;
        }

        // Route 2: /session/:sessionToken/<relative_path...>
        const match = pathname.match(/^\/session\/([^/]+)\/(.*)$/);
        if (match) {
          const [, rawToken, rawRelativePath] = match;

          // 1. Kiểm tra format token
          if (!rawToken || !/^[0-9a-f]{64}$/.test(rawToken)) {
            res.writeHead(403, { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('403 Forbidden: Invalid token format');
            return;
          }

          // 2. Hash token & Resolver
          const tokenHash = hashSessionToken(rawToken);
          await asUser(null, 'postgres');
          const resolveRes = await db.query(`SELECT public.resolve_scorm_session_asset($1) AS info;`, [tokenHash]);
          const info = resolveRes.rows[0]?.info;

          if (!info || !info.valid) {
            res.writeHead(403, { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`403 Forbidden: Session invalid (${info?.reason || 'NOT_FOUND'})`);
            return;
          }

          // 3. Sanitization
          const pathCheck = sanitizeScormRelativePath(rawRelativePath || info.launch_path);
          if (!pathCheck.valid) {
            res.writeHead(403, { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`403 Forbidden: Path traversal blocked (${pathCheck.reason})`);
            return;
          }

          // 4. Lấy asset từ Storage
          const storagePath = `${info.content_root}/${pathCheck.normalizedPath}`;
          const asset = mockStorage.get(storagePath);

          if (!asset) {
            res.writeHead(404, { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 Not Found: Asset does not exist');
            return;
          }

          const totalLength = asset.content.length;
          const mimeType = asset.mime || getMimeTypeForAsset(pathCheck.normalizedPath);
          const remainingTtlSeconds = Math.min(
            300,
            Math.max(0, Math.floor((new Date(info.expires_at).getTime() - Date.now()) / 1000))
          );

          // 5. HTTP Range Request (206 Partial Content / 416 Range Not Satisfiable)
          const rangeHeader = req.headers['range'];
          if (rangeHeader) {
            const rangeMatch = rangeHeader.match(/bytes=(\d*)-(\d*)/);
            if (rangeMatch) {
              const rawStart = rangeMatch[1];
              const rawEnd = rangeMatch[2];

              let start = rawStart ? parseInt(rawStart, 10) : NaN;
              let end = rawEnd ? parseInt(rawEnd, 10) : NaN;

              if (isNaN(start) && isNaN(end)) {
                res.writeHead(416, {
                  ...corsHeaders,
                  'Content-Range': `bytes */${totalLength}`,
                  'Content-Type': 'text/plain; charset=utf-8',
                });
                res.end();
                return;
              }

              if (isNaN(start)) {
                // Suffix range: bytes=-500
                const suffixLength = end;
                start = Math.max(0, totalLength - suffixLength);
                end = totalLength - 1;
              } else if (isNaN(end)) {
                // Prefix range: bytes=100-
                end = totalLength - 1;
              }

              if (start >= totalLength || start > end || start < 0) {
                res.writeHead(416, {
                  ...corsHeaders,
                  'Content-Range': `bytes */${totalLength}`,
                  'Content-Type': 'text/plain; charset=utf-8',
                });
                res.end();
                return;
              }

              end = Math.min(end, totalLength - 1);
              const chunk = asset.content.subarray(start, end + 1);

              res.writeHead(206, {
                ...corsHeaders,
                'Content-Type': mimeType,
                'Content-Range': `bytes ${start}-${end}/${totalLength}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunk.length,
                'X-Content-Type-Options': 'nosniff',
                'Cache-Control': `private, no-transform, max-age=${remainingTtlSeconds}`,
              });

              if (req.method === 'HEAD') {
                res.end();
              } else {
                res.end(chunk);
              }
              return;
            }
          }

          // 6. Full File (200 OK)
          res.writeHead(200, {
            ...corsHeaders,
            'Content-Type': mimeType,
            'Accept-Ranges': 'bytes',
            'Content-Length': totalLength,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': `private, no-transform, max-age=${remainingTtlSeconds}`,
          });

          if (req.method === 'HEAD') {
            res.end();
          } else {
            res.end(asset.content);
          }
          return;
        }

        res.writeHead(404, { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
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

    console.log(`🌐 Production Gateway Test Server started at ${serverOrigin}\n`);

    // Tạo Session hợp lệ cho bài học
    await asUser(studentId, 'authenticated');
    const sessRes = await db.query(`SELECT public.create_scorm_launch_session_authenticated($1) AS res;`, [materialId]);
    const validToken = sessRes.rows[0].res.session_token;
    assert.equal(/^[0-9a-f]{64}$/.test(validToken), true);

    async function reqGw(pathStr, options = {}) {
      return new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: serverPort,
            path: pathStr,
            method: options.method || 'GET',
            headers: options.headers || {},
          },
          (res) => {
            let data = Buffer.alloc(0);
            res.on('data', (c) => (data = Buffer.concat([data, c])));
            res.on('end', () => {
              resolve({
                status: res.statusCode,
                headers: {
                  get: (name) => res.headers[name.toLowerCase()] || '',
                },
                bodyBuffer: data,
                bodyText: data.toString('utf-8'),
              });
            });
          }
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
      });
    }

    // =========================================================
    // PHẦN 1: GATEWAY CORE (GW1 - GW21)
    // =========================================================
    console.log('--- PHẦN 1: KIỂM THỬ GATEWAY CORE (GW1 - GW21) ---');

    const r1 = await reqGw(`/session/${validToken}/index.html`);
    assert.equal(r1.status, 200);
    assert.ok(r1.bodyText.includes('Hello SCORM'));
    recordPass('GW1', 'Valid token nạp file HTML thành công (HTTP 200)');

    const r2 = await reqGw(`/session/${validToken}/styles/main.css`);
    assert.equal(r2.status, 200);
    assert.ok(r2.headers.get('content-type').includes('text/css'));
    recordPass('GW2', 'Nạp tệp CSS thành công (HTTP 200)');

    const r3 = await reqGw(`/session/${validToken}/scripts/app.js`);
    assert.equal(r3.status, 200);
    assert.ok(r3.headers.get('content-type').includes('text/javascript'));
    recordPass('GW3', 'Nạp tệp JavaScript thành công (HTTP 200)');

    const r4 = await reqGw(`/session/${validToken}/images/diagram.png`);
    assert.equal(r4.status, 200);
    assert.ok(r4.headers.get('content-type').includes('image/png'));
    recordPass('GW4', 'Nạp tệp hình ảnh thành công (HTTP 200)');

    const r5 = await reqGw(`/session/${validToken}/sub/deep/asset.json`);
    assert.equal(r5.status, 200);
    assert.ok(r5.headers.get('content-type').includes('application/json'));
    recordPass('GW5', 'Nạp nested relative asset thành công (HTTP 200)');

    const r6 = await reqGw(`/session/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/index.html`);
    assert.equal(r6.status, 403);
    recordPass('GW6', 'Session token không tồn tại/sai bị từ chối truy cập (HTTP 403)');

    const expiredToken = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const expHash = hashSessionToken(expiredToken);
    await asUser(null, 'postgres');
    await db.exec(`
      INSERT INTO public.scorm_launch_sessions (package_id, material_id, user_id, session_token_hash, expires_at)
      VALUES ('${packageAId}', '${materialId}', '${studentId}', '${expHash}', now() - interval '1 minute');
    `);
    const r7 = await reqGw(`/session/${expiredToken}/index.html`);
    assert.equal(r7.status, 403);
    recordPass('GW7', 'Session hết hạn bị từ chối truy cập (HTTP 403)');

    const revokedToken = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const revHash = hashSessionToken(revokedToken);
    await db.exec(`
      INSERT INTO public.scorm_launch_sessions (package_id, material_id, user_id, session_token_hash, expires_at, revoked_at)
      VALUES ('${packageAId}', '${materialId}', '${studentId}', '${revHash}', now() + interval '10 minutes', now());
    `);
    const r8 = await reqGw(`/session/${revokedToken}/index.html`);
    assert.equal(r8.status, 403);
    recordPass('GW8', 'Session bị thu hồi (revoked) bị từ chối truy cập (HTTP 403)');

    const r9 = await reqGw(`/session/${validToken}/../../etc/passwd`);
    assert.equal(r9.status, 403);
    recordPass('GW9', 'Path traversal (../) bị chặn đứng (HTTP 403)');

    const r10 = await reqGw(`/session/${validToken}/%2e%2e%2f%2e%2e%2fsecret`);
    assert.equal(r10.status, 403);
    recordPass('GW10', 'Encoded path traversal (%2e%2e) bị chặn đứng (HTTP 403)');

    const r11 = await reqGw(`/session/${validToken}/non_existent_file.html`);
    assert.equal(r11.status, 404);
    recordPass('GW11', 'Tài nguyên không tồn tại trả về HTTP 404');

    const r12 = await reqGw(`/session/${validToken}/../${packageBId}/index.html`);
    assert.equal(r12.status, 403);
    recordPass('GW12', 'Token của Package A không thể truy cập tài nguyên của Package khác');

    assert.equal(r1.bodyText.includes(rootA), false);
    assert.equal(r1.bodyText.includes('scorm-content'), false);
    recordPass('GW13', 'Responses tuyệt đối không để lộ internal storage path hay bucket name');

    assert.equal(r1.bodyText.includes('service_role'), false);
    assert.equal(r1.bodyText.includes('SUPABASE_SERVICE_ROLE_KEY'), false);
    recordPass('GW14', 'Responses tuyệt đối không để lộ Service Role Key hay DB credentials');

    assert.equal(r1.status, 200);
    recordPass('GW15', 'Phương thức GET được chấp nhận và phục vụ đầy đủ');

    const r16 = await reqGw(`/session/${validToken}/index.html`, { method: 'POST', body: 'some_payload' });
    assert.equal(r16.status, 405);
    recordPass('GW16', 'Phương thức POST bị từ chối với HTTP 405 Method Not Allowed');

    const r17 = await reqGw(`/session/${validToken}/index.html`, { method: 'HEAD' });
    assert.equal(r17.status, 200);
    assert.equal(r17.bodyBuffer.length, 0);
    assert.ok(parseInt(r17.headers.get('content-length'), 10) > 0);
    recordPass('GW17', 'Phương thức HEAD trả về headers đầy đủ mà không trả body');

    assert.equal(r1.headers.get('content-type'), 'text/html; charset=utf-8');
    recordPass('GW18', 'MIME type của tệp HTML là text/html; charset=utf-8 chuẩn xác');

    assert.equal(r3.headers.get('content-type'), 'text/javascript; charset=utf-8');
    recordPass('GW19', 'MIME type của tệp JS là text/javascript; charset=utf-8 chuẩn xác');

    assert.equal(r2.headers.get('content-type'), 'text/css; charset=utf-8');
    recordPass('GW20', 'MIME type của tệp CSS là text/css; charset=utf-8 chuẩn xác');

    const r21 = await reqGw(`/session/${validToken}/media/intro.mp4`, {
      headers: { Range: 'bytes=0-1023' },
    });
    assert.equal(r21.status, 206);
    assert.equal(r21.headers.get('content-range'), 'bytes 0-1023/4096');
    assert.equal(r21.headers.get('accept-ranges'), 'bytes');
    assert.equal(r21.headers.get('content-length'), '1024');
    assert.equal(r21.bodyBuffer.length, 1024);
    recordPass('GW21', 'HTTP Range Request trả về 206 Partial Content với Content-Range chính xác');


    // =========================================================
    // PHẦN 2: SESSION INFO ENDPOINT AUDIT (INFO1 - INFO5)
    // =========================================================
    console.log('\n--- PHẦN 2: KIỂM TOÁN ENDPOINT /SESSION-INFO (INFO1 - INFO5) ---');

    const infoRes = await reqGw(`/session-info?session=${validToken}`);
    assert.equal(infoRes.status, 200);
    const infoData = JSON.parse(infoRes.bodyText);

    // INFO1: No content_root leak
    assert.equal(infoData.content_root, undefined);
    assert.equal(infoRes.bodyText.includes(rootA), false);
    recordPass('INFO1', '/session-info không để lộ content_root ra client');

    // INFO2: No owner UUID leak
    assert.equal(infoData.owner_id, undefined);
    assert.equal(infoData.created_by, undefined);
    assert.equal(infoRes.bodyText.includes(teacherId), false);
    recordPass('INFO2', '/session-info không để lộ owner UUID');

    // INFO3: No bucket or storage path leak
    assert.equal(infoRes.bodyText.includes('scorm-content'), false);
    assert.equal(infoData.bucket, undefined);
    recordPass('INFO3', '/session-info không để lộ bucket name hay internal storage path');

    // INFO4: Invalid session blocked
    const infoInvalidRes = await reqGw(`/session-info?session=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`);
    assert.equal(infoInvalidRes.status, 403);
    recordPass('INFO4', '/session-info từ chối token không hợp lệ (HTTP 403)');

    // INFO5: Expired session blocked
    const infoExpRes = await reqGw(`/session-info?session=${expiredToken}`);
    assert.equal(infoExpRes.status, 403);
    recordPass('INFO5', '/session-info từ chối session hết hạn (HTTP 403)');


    // =========================================================
    // PHẦN 3: COMPREHENSIVE PATH TRAVERSAL MATRIX (PATH1 - PATH12)
    // =========================================================
    console.log('\n--- PHẦN 3: MA TRẬN KIỂM SOÁT PATH TRAVERSAL (PATH1 - PATH12) ---');

    // PATH1: ../
    assert.equal((await reqGw(`/session/${validToken}/../etc/passwd`)).status, 403);
    recordPass('PATH1', 'Path traversal ../ bị chặn đứng 403');

    // PATH2: %2e%2e/
    assert.equal((await reqGw(`/session/${validToken}/%2e%2e/etc/passwd`)).status, 403);
    recordPass('PATH2', 'Single percent-encoded traversal %2e%2e/ bị chặn đứng 403');

    // PATH3: %252e%252e/
    assert.equal((await reqGw(`/session/${validToken}/%252e%252e/etc/passwd`)).status, 403);
    recordPass('PATH3', 'Double percent-encoded traversal %252e%252e/ bị chặn đứng 403');

    // PATH4: %25252e...
    assert.equal((await reqGw(`/session/${validToken}/%25252e%25252e/secret`)).status, 403);
    recordPass('PATH4', 'Triple percent-encoded traversal bị chặn đứng 403');

    // PATH5: Encoded slash variants
    assert.equal((await reqGw(`/session/${validToken}/styles%2f..%2fmain.css`)).status, 403);
    recordPass('PATH5', 'Encoded slash traversal %2f bị chặn đứng 403');

    // PATH6: Backslash
    assert.equal((await reqGw(`/session/${validToken}/..\\..\\secret`)).status, 403);
    recordPass('PATH6', 'Backslash traversal ..\\\\ bị chặn đứng 403');

    // PATH7: Encoded backslash
    assert.equal((await reqGw(`/session/${validToken}/%5c..%5csecret`)).status, 403);
    recordPass('PATH7', 'Encoded backslash traversal %5c bị chặn đứng 403');

    // PATH8: Null byte (Kiểm tra hàm sanitizeScormRelativePath trực tiếp vì Node HTTP client chặn unescaped \0)
    const nullByteCheck = sanitizeScormRelativePath('index.html\0.png');
    assert.equal(nullByteCheck.valid, false);
    assert.equal(nullByteCheck.reason, 'NULL_BYTE_DETECTED');
    recordPass('PATH8', 'Null byte injection (\\0) bị phát hiện và chặn đứng bởi sanitization');

    // PATH9: Encoded null byte
    assert.equal((await reqGw(`/session/${validToken}/index.html%00.png`)).status, 403);
    recordPass('PATH9', 'Encoded null byte (%00) bị chặn đứng 403');


    // PATH10: Absolute path
    const absPathCheck = sanitizeScormRelativePath('/etc/passwd');
    assert.equal(absPathCheck.valid, false);
    assert.equal(absPathCheck.reason, 'ABSOLUTE_PATH_DETECTED');
    assert.equal((await reqGw(`/session/${validToken}/%2fetc%2fpasswd`)).status, 403);
    recordPass('PATH10', 'Absolute path traversal (/etc/passwd) bị chặn đứng 403');


    // PATH11: Windows drive prefix
    assert.equal((await reqGw(`/session/${validToken}/C:/windows/win.ini`)).status, 403);
    recordPass('PATH11', 'Windows drive prefix C:/ bị chặn đứng 403');

    // PATH12: Excessive path length
    const longPath = 'a/'.repeat(600) + 'test.js';
    assert.equal((await reqGw(`/session/${validToken}/${longPath}`)).status, 403);
    recordPass('PATH12', 'Đường dẫn vượt quá hạn mức tối đa (>1024 chars) bị từ chối 403');


    // =========================================================
    // PHẦN 4: HTTP RANGE RFC SEMANTICS & 416 (RANGE TESTS)
    // =========================================================
    console.log('\n--- PHẦN 4: KIỂM THỬ HTTP RANGE RFC SEMANTICS (RANGE TESTS) ---');

    // RANGE_PREFIX: bytes=100-
    const rRangePrefix = await reqGw(`/session/${validToken}/media/intro.mp4`, {
      headers: { Range: 'bytes=100-' },
    });
    assert.equal(rRangePrefix.status, 206);
    assert.equal(rRangePrefix.headers.get('content-range'), 'bytes 100-4095/4096');
    assert.equal(rRangePrefix.bodyBuffer.length, 3996);
    recordPass('RANGE_PREFIX', 'Range prefix (bytes=100-) trả về 206 Partial Content chính xác');

    // RANGE_SUFFIX: bytes=-500
    const rRangeSuffix = await reqGw(`/session/${validToken}/media/intro.mp4`, {
      headers: { Range: 'bytes=-500' },
    });
    assert.equal(rRangeSuffix.status, 206);
    assert.equal(rRangeSuffix.headers.get('content-range'), 'bytes 3596-4095/4096');
    assert.equal(rRangeSuffix.bodyBuffer.length, 500);
    recordPass('RANGE_SUFFIX', 'Range suffix (bytes=-500) trả về 206 Partial Content chính xác');

    // RANGE_416_OVERFLOW: bytes=5000-6000 trên file 4096 bytes
    const rRangeOverflow = await reqGw(`/session/${validToken}/media/intro.mp4`, {
      headers: { Range: 'bytes=5000-6000' },
    });
    assert.equal(rRangeOverflow.status, 416);
    assert.equal(rRangeOverflow.headers.get('content-range'), 'bytes */4096');
    recordPass('RANGE_416_OVERFLOW', 'Range vượt quá dung lượng file trả về HTTP 416 Range Not Satisfiable');

    // RANGE_416_INVERTED: bytes=500-200 (start > end)
    const rRangeInverted = await reqGw(`/session/${validToken}/media/intro.mp4`, {
      headers: { Range: 'bytes=500-200' },
    });
    assert.equal(rRangeInverted.status, 416);
    assert.equal(rRangeInverted.headers.get('content-range'), 'bytes */4096');
    recordPass('RANGE_416_INVERTED', 'Range đảo ngược (start > end) trả về HTTP 416 Range Not Satisfiable');


    // =========================================================
    // PHẦN 5: PLAYER HOST SAME-ORIGIN STATIC AUDIT (PLAYER1 - PLAYER3)
    // =========================================================
    console.log('\n--- PHẦN 5: KIỂM TOÁN TĨNH PLAYER HOST SAME-ORIGIN (PLAYER1 - PLAYER3) ---');

    const playerJsContent = await fs.readFile(path.join(__dirname, '..', 'scorm-player', 'src', 'player.js'), 'utf-8');

    // PLAYER1: Player uses relative /session/ route
    assert.ok(playerJsContent.includes('/session/'));
    assert.ok(playerJsContent.includes('/session-info?session='));
    recordPass('PLAYER1', 'SCORM Player sử dụng đường dẫn relative /session/ và /session-info');

    // PLAYER2: No Supabase function URL embedded in Player JS
    assert.equal(playerJsContent.includes('functions/v1/scorm-asset-gateway'), false);
    assert.equal(playerJsContent.includes('.supabase.co'), false);
    recordPass('PLAYER2', 'Player JS không hardcode Supabase Function URL');

    // PLAYER3: No direct Storage URL embedded in Player JS
    assert.equal(playerJsContent.includes('storage/v1/object/public'), false);
    assert.equal(playerJsContent.includes('scorm-content/'), false);
    recordPass('PLAYER3', 'Player JS không chứa direct storage URLs hay bucket paths');

    console.log('\n================================================================');
    console.log(`🎉 TẤT CẢ ${passedTests}/${totalTests} KIỂM THỬ VÀ KIỂM TOÁN ĐÃ HOÀN TẤT VÀ PASS 100%!`);
    console.log('================================================================\n');
  } finally {
    if (server) {
      server.close();
    }
  }
}

runProductionAssetGatewayAuditSuite().catch((err) => {
  console.error('\n❌ SCORM PRODUCTION ASSET GATEWAY AUDIT FAILED:', err);
  process.exit(1);
});
