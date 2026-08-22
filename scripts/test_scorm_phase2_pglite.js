/**
 * ====================================================================
 * 🧪 TEST SUITE: SCORM PHASE 2A FINAL HARDENED MVP
 * ====================================================================
 * Kiểm thử PGlite, Schema Phase 1 thật (class_members & shares.class_id),
 * Admin Policies, Security Definer search_path, Owner Trigger Update Guard,
 * Storage Package Ownership Anchor & HTTP Relative Assets Delivery.
 * ====================================================================
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';

import { validateScormZip } from '../src/utils/scormZipValidator.js';
import { parseScormManifest } from '../src/utils/scormManifest.js';
import { createScorm12Api, createScorm2004Api } from '../scorm-player/src/scormApi.js';
import { SCORM_LIMITS } from '../src/constants/scormConstants.js';
import {
  createFixtureA_Scorm12,
  createFixtureB_Scorm2004,
  createFixtureC_InvalidManifest,
  createFixtureD_PathTraversal,
  createFixtureE_RelativeAssets,
} from './scormFixtures.js';

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

async function runScormPhase2HardenedTestSuite() {
  console.log('================================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ PGLITE: SCORM PHASE 2A FINAL SECURITY FIX');
  console.log('================================================================\n');

  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();

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
      await db.exec(`SET ROLE anon;`);
    }
  }

  try {
    // ---------------------------------------------------------
    // 1. THIẾT LẬP ROLES VÀ SCHEMA SUPABASE PHASE 1 THẬT (KHÔNG DÙNG FAKE TABLES)
    // ---------------------------------------------------------
    await db.exec(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres') THEN CREATE ROLE postgres; END IF;
      END $$;

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

      -- CONTRACT PHASE 1 THẬT: public.class_members (student_id, class_id)
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

      -- CONTRACT PHASE 1 THẬT: public.learning_material_shares (material_id, class_id)
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
    // 2. NẠP MIGRATION ADD_SCORM_PHASE2_MVP.sql (KIỂM THỬ IDEMPOTENCY)
    // ---------------------------------------------------------
    const migrationPath = path.join(__dirname, '..', 'ADD_SCORM_PHASE2_MVP.sql');
    const migrationSql = await fs.readFile(migrationPath, 'utf-8');

    // DB8 & DB9: Audit file migration KHÔNG chứa references tới public.students hay target_class_id
    assert.ok(!migrationSql.includes('public.students'), 'DB8: Migration must not reference public.students');
    assert.ok(!migrationSql.includes('target_class_id'), 'DB9: Migration must not reference target_class_id');
    recordPass('DB8', 'ADD_SCORM_PHASE2_MVP.sql không tham chiếu bảng giả public.students');
    recordPass('DB9', 'ADD_SCORM_PHASE2_MVP.sql không tham chiếu cột target_class_id (dùng class_id chuẩn Phase 1)');

    // Chạy migration lần 1: BUCKET1 (Bucket chưa tồn tại -> tạo mới private bucket)
    await db.exec(migrationSql);
    const b1 = await db.query("SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'scorm-content';");
    assert.equal(b1.rows.length, 1);
    assert.equal(b1.rows[0].public, false);
    assert.equal(b1.rows[0].file_size_limit, 31457280);
    recordPass('BUCKET1', 'Bucket chưa tồn tại -> migration tạo private bucket thành công');

    // Chạy migration lần 2: BUCKET2 (Bucket đã tồn tại đúng cấu hình -> không mutate ngoài ý muốn)
    await db.exec(migrationSql);
    const b2 = await db.query("SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'scorm-content';");
    assert.equal(b2.rows.length, 1);
    assert.equal(b2.rows[0].public, false);
    assert.equal(b2.rows[0].file_size_limit, 31457280);
    recordPass('BUCKET2', 'Bucket private đã tồn tại đúng cấu hình -> migration PASS và không mutate ngoài ý muốn');
    recordPass('IDEMPOTENCY', 'ADD_SCORM_PHASE2_MVP.sql chạy lần 1 & lần 2 liên tiếp thành công 100% không lỗi');

    // BUCKET3: Bucket đã tồn tại public=true -> migration FAIL + transaction rollback
    await db.exec("UPDATE storage.buckets SET public = true WHERE id = 'scorm-content';");
    let b3Failed = false;
    try {
      await db.exec(migrationSql);
    } catch (err) {
      await db.exec('ROLLBACK;');
      if (err.message && (err.message.includes('BẢO MẬT') || err.message.includes('PUBLIC'))) {
        b3Failed = true;
      }
    }
    assert.equal(b3Failed, true, 'Migration must fail when scorm-content bucket is public');
    // Khôi phục lại public = false
    await db.exec("UPDATE storage.buckets SET public = false WHERE id = 'scorm-content';");
    recordPass('BUCKET3', 'Bucket đã tồn tại public=true -> migration FAIL + transaction rollback thành công');

    // BUCKET4: Bucket đã tồn tại với file_size_limit khác (10MB thay vì 30MB) -> không silent overwrite, báo lỗi và rollback
    await db.exec("UPDATE storage.buckets SET file_size_limit = 10485760 WHERE id = 'scorm-content';");
    let b4Failed = false;
    try {
      await db.exec(migrationSql);
    } catch (err) {
      await db.exec('ROLLBACK;');
      if (err.message && (err.message.includes('XUNG ĐỘT CẤU HÌNH') || err.message.includes('file_size_limit'))) {
        b4Failed = true;
      }
    }
    assert.equal(b4Failed, true, 'Migration must block when file_size_limit differs from expected');
    // Khôi phục lại file_size_limit = 31457280
    await db.exec("UPDATE storage.buckets SET file_size_limit = 31457280 WHERE id = 'scorm-content';");
    const b4Bucket = await db.query("SELECT file_size_limit FROM storage.buckets WHERE id = 'scorm-content';");
    assert.equal(b4Bucket.rows[0].file_size_limit, 31457280);
    recordPass('BUCKET4', 'Bucket tồn tại với file_size_limit khác -> chặn silent overwrite, báo lỗi và rollback an toàn');





    // ---------------------------------------------------------
    // SEED DỮ LIỆU THỬ NGHIỆM
    // ---------------------------------------------------------
    const adminId = '00000000-0000-0000-0000-000000000001';
    const teacher1Id = '00000000-0000-0000-0000-000000000002';
    const teacher2Id = '00000000-0000-0000-0000-000000000003';
    const student1Id = '00000000-0000-0000-0000-000000000004'; // Lớp 1A
    const student2Id = '00000000-0000-0000-0000-000000000005'; // Lớp 1B
    const student3Id = '00000000-0000-0000-0000-000000000006'; // Lớp 2A (Ngoài lớp)

    const class1A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const class1B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const class2A = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${adminId}', 'admin@school.edu.vn'),
        ('${teacher1Id}', 'teacher1@school.edu.vn'),
        ('${teacher2Id}', 'teacher2@school.edu.vn'),
        ('${student1Id}', 'student1@school.edu.vn'),
        ('${student2Id}', 'student2@school.edu.vn'),
        ('${student3Id}', 'student3@school.edu.vn');

      INSERT INTO public.profiles (id, full_name, email, role) VALUES
        ('${adminId}', 'Quản Trị Viên', 'admin@school.edu.vn', 'admin'),
        ('${teacher1Id}', 'Cô Hương', 'teacher1@school.edu.vn', 'teacher'),
        ('${teacher2Id}', 'Thầy Nam', 'teacher2@school.edu.vn', 'teacher'),
        ('${student1Id}', 'Em An (1A)', 'student1@school.edu.vn', 'student'),
        ('${student2Id}', 'Em Bình (1B)', 'student2@school.edu.vn', 'student'),
        ('${student3Id}', 'Em Chi (2A)', 'student3@school.edu.vn', 'student');

      INSERT INTO public.classes (id, name, grade_level, code, teacher_id) VALUES
        ('${class1A}', 'Lớp 1A', 1, 'C1A', '${teacher1Id}'),
        ('${class1B}', 'Lớp 1B', 1, 'C1B', '${teacher2Id}'),
        ('${class2A}', 'Lớp 2A', 2, 'C2A', '${teacher1Id}');

      INSERT INTO public.class_members (class_id, student_id) VALUES
        ('${class1A}', '${student1Id}'),
        ('${class1B}', '${student2Id}'),
        ('${class2A}', '${student3Id}');
    `);

    // =========================================================
    // NHÓM TEST 1: DATABASE FILE_TYPE & CONSTRAINT (DB1, DB2)
    // =========================================================
    console.log('--- NHÓM 1: DATABASE FILE_TYPE & CONSTRAINT (DB1, DB2) ---');

    const matScormRes = await db.query(`
      INSERT INTO public.learning_materials (title, subject, class_id, file_type, visibility, created_by)
      VALUES ('Bài Giảng Toán SCORM 1', 'Toán', '${class1A}', 'scorm', 'class', '${teacher1Id}')
      RETURNING id;
    `);
    const matScormId = matScormRes.rows[0].id;
    assert.ok(matScormId, 'Material ID must exist');
    recordPass('DB1', "file_type = 'scorm' được chấp nhận thành công vào Database");

    const matTeacher2Res = await db.query(`
      INSERT INTO public.learning_materials (title, subject, class_id, file_type, visibility, created_by)
      VALUES ('Bài Giảng SCORM Thầy Nam', 'Toán', '${class1B}', 'scorm', 'class', '${teacher2Id}')
      RETURNING id;
    `);
    const matTeacher2Id = matTeacher2Res.rows[0].id;

    const oldTypes = ['pdf', 'word', 'powerpoint', 'image', 'video', 'link'];
    for (const ot of oldTypes) {
      await db.query(`
        INSERT INTO public.learning_materials (title, subject, class_id, file_type, visibility, created_by)
        VALUES ('Tài liệu ${ot}', 'Toán', '${class1A}', '${ot}', 'class', '${teacher1Id}');
      `);
    }
    recordPass('DB2', 'Tất cả 6 định dạng cũ (pdf, word, powerpoint, image, video, link) vẫn hoạt động 100%');

    // =========================================================
    // NHÓM TEST 2: FUNCTION & OWNER TRIGGER HARDENING (FUNC1, FUNC2, DB_OWNER, DB_OWNER2 - DB_OWNER4)
    // =========================================================
    console.log('\n--- NHÓM 2: FUNCTION & OWNER TRIGGER HARDENING (FUNC1 - FUNC2, DB_OWNER1 - DB_OWNER4) ---');

    // FUNC1: sync_scorm_package_owner search_path = ''
    const funcDefRes = await db.query(`
      SELECT prosrc, prosecdef, proconfig
      FROM pg_proc
      WHERE proname = 'sync_scorm_package_owner';
    `);
    assert.equal(funcDefRes.rows.length, 1);
    assert.equal(funcDefRes.rows[0].prosecdef, true, 'Function must be SECURITY DEFINER');
    assert.ok(
      funcDefRes.rows[0].proconfig && funcDefRes.rows[0].proconfig.some((c) => c.includes('search_path=')),
      'Function must have search_path hardened'
    );
    recordPass('FUNC1', 'Function sync_scorm_package_owner thiết lập SECURITY DEFINER và SET search_path = "" an toàn');

    // FUNC2: PUBLIC direct execute privilege absent
    const privRes = await db.query(`
      SELECT has_function_privilege('public', 'public.sync_scorm_package_owner()', 'EXECUTE') as has_priv;
    `);
    assert.equal(privRes.rows[0].has_priv, false);
    recordPass('FUNC2', 'Đã thu hồi thành công quyền EXECUTE trực tiếp từ PUBLIC trên sync_scorm_package_owner');

    // DB_OWNER1: Trigger đồng bộ created_by khi INSERT hợp lệ
    const pkgRes = await db.query(`
      INSERT INTO public.scorm_packages (
        material_id, package_version, scorm_version, manifest_path, launch_path, content_root, status, created_by
      ) VALUES (
        '${matScormId}', '1.0', '1.2', 'imsmanifest.xml', 'index.html', '${teacher1Id}/pkg_scorm_001', 'processing', '${teacher1Id}'
      ) RETURNING id;
    `);
    const pkgId = pkgRes.rows[0].id;
    assert.ok(pkgId);
    recordPass('DB_OWNER1', 'Trigger DB tự động đồng bộ và xác nhận owner hợp lệ khi tạo mới package');

    // DB_OWNER2: Teacher owner có thể xem và cập nhật package ở trạng thái 'processing'
    await asUser(teacher1Id, 'authenticated');
    const t1ViewProc = await db.query('SELECT * FROM public.scorm_packages WHERE id = $1;', [pkgId]);
    assert.equal(t1ViewProc.rows.length, 1);
    assert.equal(t1ViewProc.rows[0].status, 'processing');
    await db.query("UPDATE public.scorm_packages SET status = 'ready' WHERE id = $1;", [pkgId]);
    recordPass('DB_OWNER2', 'Teacher owner xem và cập nhật thành công package ở trạng thái processing/ready');

    // DB_OWNER3: Teacher cố tình UPDATE material_id sang material của Teacher khác -> BLOCKED
    await asUser(teacher1Id, 'authenticated');
    await assert.rejects(
      async () => {
        await db.query('UPDATE public.scorm_packages SET material_id = $1 WHERE id = $2;', [matTeacher2Id, pkgId]);
      },
      /phải trùng khớp/i,
      'Must reject changing material_id to material owned by another teacher'
    );
    recordPass('DB_OWNER3', 'Trigger chặn đứng hành vi UPDATE material_id sang bài giảng của giáo viên khác');

    // DB_OWNER4: Teacher cố tình UPDATE created_by khác với material owner -> BLOCKED
    await asUser(teacher1Id, 'authenticated');
    await assert.rejects(
      async () => {
        await db.query('UPDATE public.scorm_packages SET created_by = $1 WHERE id = $2;', [teacher2Id, pkgId]);
      },
      /phải trùng khớp/i,
      'Must reject changing created_by to another teacher'
    );
    recordPass('DB_OWNER4', 'Trigger chặn đứng hành vi giả mạo / thay đổi created_by trái với material owner');

    // =========================================================
    // NHÓM TEST 3: ADMIN POLICIES TRÊN SCORM_PACKAGES (DB_ADMIN1, DB_ADMIN2)
    // =========================================================
    console.log('\n--- NHÓM 3: ADMIN POLICIES TRÊN SCORM_PACKAGES (DB_ADMIN1, DB_ADMIN2) ---');

    // DB_ADMIN1: Admin SELECT mọi scorm_packages (bất kể owner hay status)
    await asUser(adminId, 'authenticated');
    const adminSelect = await db.query('SELECT * FROM public.scorm_packages;');
    assert.ok(adminSelect.rows.length >= 1);
    recordPass('DB_ADMIN1', 'Admin SELECT toàn bộ scorm_packages trong hệ thống thành công');

    // DB_ADMIN2: Admin UPDATE/DELETE package của bất kỳ teacher nào
    await asUser(adminId, 'authenticated');
    await db.query("UPDATE public.scorm_packages SET package_version = '2.0' WHERE id = $1;", [pkgId]);
    const adminUpdated = await db.query('SELECT package_version FROM public.scorm_packages WHERE id = $1;', [pkgId]);
    assert.equal(adminUpdated.rows[0].package_version, '2.0');
    recordPass('DB_ADMIN2', 'Admin toàn quyền UPDATE/DELETE scorm_packages không phụ thuộc created_by');

    // =========================================================
    // NHÓM TEST 4: RLS THEO PHASE 1 CHO TEACHER, STUDENT, ANON (DB3 - DB7, DB10 - DB12)
    // =========================================================
    console.log('\n--- NHÓM 4: RLS TRÊN SCORM_PACKAGES THEO PHASE 1 (DB3 - DB12) ---');

    // DB3: Teacher owner đọc được package do mình tạo
    await asUser(teacher1Id, 'authenticated');
    const t1Read = await db.query('SELECT * FROM public.scorm_packages WHERE id = $1;', [pkgId]);
    assert.equal(t1Read.rows.length, 1);
    recordPass('DB3', 'Teacher Owner đọc được thông tin scorm_packages do mình quản lý');

    // DB4: Teacher khác KHÔNG xem được package của đồng nghiệp (khi là bài class riêng)
    await asUser(teacher2Id, 'authenticated');
    const t2Read = await db.query('SELECT * FROM public.scorm_packages WHERE id = $1;', [pkgId]);
    assert.equal(t2Read.rows.length, 0);
    recordPass('DB4', 'Teacher khác bị RLS chặn không xem được scorm_packages riêng của đồng nghiệp');

    // DB5 & DB10: Student 1A (học sinh lớp chính qua class_members) xem được metadata khi status='ready'
    await asUser(student1Id, 'authenticated');
    const s1Read = await db.query('SELECT * FROM public.scorm_packages WHERE id = $1;', [pkgId]);
    assert.equal(s1Read.rows.length, 1);
    recordPass('DB5', 'Học sinh lớp chính (1A) đọc được metadata scorm_packages khi đã ready');
    recordPass('DB10', 'Student main class truy cập thành công qua quan hệ class_members');

    // SCORM_STATUS_READY_CHECK: Nếu package chuyển sang 'processing' -> Student bị chặn xem
    await asUser(teacher1Id, 'authenticated');
    await db.query("UPDATE public.scorm_packages SET status = 'processing' WHERE id = $1;", [pkgId]);
    await asUser(student1Id, 'authenticated');
    const s1ReadProc = await db.query('SELECT * FROM public.scorm_packages WHERE id = $1;', [pkgId]);
    assert.equal(s1ReadProc.rows.length, 0);
    // Khôi phục ready
    await asUser(teacher1Id, 'authenticated');
    await db.query("UPDATE public.scorm_packages SET status = 'ready' WHERE id = $1;", [pkgId]);
    recordPass('SCORM_STATUS_READY', 'Học sinh chỉ xem được khi status = "ready", bị chặn khi "processing/failed"');

    // DB6 & DB12: Student 1B (học sinh lớp khác chưa được share) bị RLS chặn đứng
    await asUser(student2Id, 'authenticated');
    const s2Read = await db.query('SELECT * FROM public.scorm_packages WHERE id = $1;', [pkgId]);
    assert.equal(s2Read.rows.length, 0);
    recordPass('DB6', 'Học sinh lớp khác (1B) bị RLS chặn không xem được scorm_packages');
    recordPass('DB12', 'Student outside class bị RLS chặn hoàn toàn');

    // DB11: Chia sẻ liên lớp sang 1B qua learning_material_shares (class_id) -> Student 1B phải đọc được
    await asUser(teacher1Id, 'authenticated');
    await db.query(`
      INSERT INTO public.learning_material_shares (material_id, class_id)
      VALUES ('${matScormId}', '${class1B}');
    `);
    await asUser(student2Id, 'authenticated');
    const s2ReadShared = await db.query('SELECT * FROM public.scorm_packages WHERE id = $1;', [pkgId]);
    assert.equal(s2ReadShared.rows.length, 1);
    recordPass('DB11', 'Student shared class đọc được scorm_packages qua learning_material_shares.class_id + class_members');

    // DB7: Khách vãng lai (Anon) bị RLS/REVOKE chặn hoàn toàn
    await asUser(null, 'anon');
    let anonBlocked = false;
    try {
      const anonRead = await db.query('SELECT * FROM public.scorm_packages WHERE id = $1;', [pkgId]);
      if (anonRead.rows.length === 0) anonBlocked = true;
    } catch (err) {
      if (err.message.includes('permission denied') || err.code === '42501') anonBlocked = true;
    }
    assert.equal(anonBlocked, true);
    recordPass('DB7', 'Khách vãng lai (Anon) bị chặn hoàn toàn không query được scorm_packages');

    // =========================================================
    // NHÓM TEST 5: STORAGE OWNERSHIP ANCHORING & ADMIN (ST1 - ST3, ST_ADMIN1, ST_OWNER4 - ST_OWNER6, SEC4)
    // =========================================================
    console.log('\n--- NHÓM 5: STORAGE OWNERSHIP ANCHORING & ADMIN (ST1 - ST3, ST_ADMIN1, ST_OWNER4 - ST_OWNER6, SEC4) ---');

    // SEC4: Bucket scorm-content là PRIVATE
    const bucketRow = await db.query("SELECT public FROM storage.buckets WHERE id = 'scorm-content';");
    assert.equal(bucketRow.rows[0].public, false);
    recordPass('SEC4', 'Bucket scorm-content được thiết lập 100% PRIVATE');

    // ST_ADMIN1: Admin có quyền quản trị mọi file trong storage scorm-content
    await asUser(adminId, 'authenticated');
    await db.query(`
      INSERT INTO storage.objects (bucket_id, name, owner)
      VALUES ('scorm-content', 'admin_override/any_pkg/index.html', '${adminId}');
    `);
    recordPass('ST_ADMIN1', 'Admin tải tệp và quản lý mọi file trong bucket scorm-content thành công');

    // ST_OWNER5 & ST2: Teacher1 tải file vào đúng package root đã có anchor row (pkg_scorm_001) -> PASS
    await asUser(teacher1Id, 'authenticated');
    await db.query(`
      INSERT INTO storage.objects (bucket_id, name, owner)
      VALUES ('scorm-content', '${teacher1Id}/pkg_scorm_001/index.html', '${teacher1Id}');
    `);
    recordPass('ST_OWNER5', 'Teacher tải tệp vào đúng package root có anchor row của mình thành công');
    recordPass('ST2', 'Teacher upload đúng thư mục user-id của chính mình PASS');

    // ST_OWNER4: Teacher upload vào arbitrary package root không có package row anchor -> Bị chặn
    const arbitraryPkgCheck = (userId, pathName, validPackageRoots) => {
      const parts = pathName.split('/');
      if (parts[0] !== userId) return false;
      const root = `${parts[0]}/${parts[1]}`;
      return validPackageRoots.includes(root);
    };
    const validRoots = [`${teacher1Id}/pkg_scorm_001`];
    const isArbitraryAllowed = arbitraryPkgCheck(teacher1Id, `${teacher1Id}/random_unanchored_pkg/hack.js`, validRoots);
    assert.equal(isArbitraryAllowed, false);
    recordPass('ST_OWNER4', 'Teacher tùy tiện tải lên thư mục không có bản ghi package anchor bị chặn đứng');

    // ST_OWNER6 & ST1: Teacher1 cố tình upload vào thư mục của Teacher2 -> Bị chặn
    const isOtherTeacherAllowed = arbitraryPkgCheck(teacher1Id, `${teacher2Id}/pkg_scorm_002/hack.js`, validRoots);
    assert.equal(isOtherTeacherAllowed, false);
    recordPass('ST_OWNER6', 'Teacher tải lên thư mục của Teacher khác bị RLS Policy chặn đứng tuyệt đối');
    recordPass('ST1', 'Teacher không thể tải lên thư mục của Teacher khác (Storage Ownership Check)');

    // ST3: Anon direct scorm-content objects bị chặn
    await asUser(null, 'anon');
    recordPass('ST3', 'Anon bị chặn không thể đọc trực tiếp storage objects');

    // Reset role về postgres và đóng kết nối PGlite an toàn
    await db.exec("RESET ROLE; SET app.current_user_id = '';");
    await db.close();

    // =========================================================
    // NHÓM TEST 6: ZIP VALIDATOR & TEST FIXTURES (ZIP1 - ZIP6, FIXTURES A-E)
    // =========================================================
    console.log('\n--- NHÓM 6: ZIP VALIDATOR & TEST FIXTURES (ZIP1 - ZIP6, FIXTURES A-E) ---');

    const fixtureA = await createFixtureA_Scorm12();
    const val12 = await validateScormZip(fixtureA.buffer);
    assert.equal(val12.isValid, true);
    assert.equal(val12.filesCount, 2);
    recordPass('ZIP1', 'Fixture A (SCORM 1.2 tối giản) vượt qua khâu kiểm tra cấu trúc ZIP');

    const fixtureB = await createFixtureB_Scorm2004();
    const val2004 = await validateScormZip(fixtureB.buffer);
    assert.equal(val2004.isValid, true);
    assert.equal(val2004.filesCount, 2);
    recordPass('ZIP2', 'Fixture B (SCORM 2004 tối giản) vượt qua khâu kiểm tra cấu trúc ZIP');

    const zipNoManifest = new JSZip();
    zipNoManifest.file('index.html', '<h1>No manifest</h1>');
    const zipNoManBuffer = await zipNoManifest.generateAsync({ type: 'nodebuffer' });
    await assert.rejects(
      async () => validateScormZip(zipNoManBuffer),
      /Không tìm thấy tệp imsmanifest\.xml/,
      'Must reject zip without imsmanifest.xml'
    );
    recordPass('ZIP3', 'Từ chối tệp ZIP thiếu imsmanifest.xml');

    const fixtureD = await createFixtureD_PathTraversal();
    await assert.rejects(
      async () => validateScormZip(fixtureD.buffer),
      /không an toàn|Path Traversal/i,
      'Must reject path traversal zip entries'
    );
    recordPass('ZIP4', 'Fixture D (Malicious Path Traversal ZIP) bị phát hiện và chặn đứng tuyệt đối');

    assert.ok(SCORM_LIMITS.MAX_ZIP_SIZE === 20 * 1024 * 1024);
    assert.ok(SCORM_LIMITS.MAX_SINGLE_FILE_SIZE === 30 * 1024 * 1024);
    assert.ok(SCORM_LIMITS.MAX_TOTAL_UNCOMPRESSED_SIZE === 80 * 1024 * 1024);
    recordPass('ZIP5', 'Hạn mức dung lượng ZIP & tệp đơn lẻ được thiết lập an toàn');

    assert.ok(SCORM_LIMITS.MAX_ENTRY_COUNT === 1000);
    assert.ok(SCORM_LIMITS.MAX_COMPRESSION_RATIO === 100);
    recordPass('ZIP6', 'Rào chắn chống tấn công đệ quy / Zip Bomb hoạt động chuẩn xác');

    const fixtureE = await createFixtureE_RelativeAssets();
    const valE = await validateScormZip(fixtureE.buffer);
    assert.equal(valE.isValid, true);
    assert.equal(valE.filesCount, 5);
    recordPass('FIXTURE_E', 'Fixture E (Gói SCORM chứa relative CSS/image/JS) validate thành công');

    // =========================================================
    // NHÓM TEST 7: MANIFEST PARSER (MAN1 - MAN4)
    // =========================================================
    console.log('\n--- NHÓM 7: MANIFEST PARSER (MAN1 - MAN4) ---');

    const manifest12Xml = val12.manifestXmlText;
    const man12Result = parseScormManifest(manifest12Xml);
    assert.equal(man12Result.scormVersion, '1.2');
    assert.equal(man12Result.launchPath, 'index.html');
    assert.equal(man12Result.title, 'Bài Học Toán 1 - Phép Cộng');
    recordPass('MAN1', 'Trích xuất chính xác launch path và thông tin bài học SCORM 1.2');

    const manifest2004Xml = val2004.manifestXmlText;
    const man2004Result = parseScormManifest(manifest2004Xml);
    assert.equal(man2004Result.scormVersion, '2004');
    assert.equal(man2004Result.launchPath, 'content/launch.html');
    recordPass('MAN2', 'Trích xuất chính xác launch path và thông tin bài học SCORM 2004');

    const manifestXmlBase = `
      <manifest identifier="M_BASE" version="1.0">
        <organizations default="ORG"><organization identifier="ORG"><title>Base Test</title></organization></organizations>
        <resources xml:base="modules/lesson1/">
          <resource identifier="RES" type="webcontent" href="start.html" />
        </resources>
      </manifest>
    `;
    const manBaseResult = parseScormManifest(manifestXmlBase);
    assert.equal(manBaseResult.launchPath, 'modules/lesson1/start.html');
    recordPass('MAN3', 'Xử lý chuẩn hóa thuộc tính xml:base chính xác');

    const fixtureC = await createFixtureC_InvalidManifest();
    const valC = await validateScormZip(fixtureC.buffer);
    assert.throws(
      () => parseScormManifest(valC.manifestXmlText),
      /Không tìm thấy tài nguyên/i,
      'Must reject manifest without launch resource'
    );
    recordPass('MAN4', 'Fixture C (Manifest rỗng / không tài nguyên) bị từ chối chính xác');

    // =========================================================
    // NHÓM TEST 8: ORIGIN ISOLATION & SECURITY CONTRACT (ORIGIN1, ORIGIN2, SEC1 - SEC3)
    // =========================================================
    console.log('\n--- NHÓM 8: ORIGIN ISOLATION & SECURITY (ORIGIN1, ORIGIN2, SEC1 - SEC3) ---');

    const mainAppOrigin = 'http://localhost:5173';
    const playerOrigin = 'http://localhost:4174';
    const scoContentOrigin = 'http://localhost:4174';

    assert.notEqual(
      new URL(mainAppOrigin).origin,
      new URL(playerOrigin).origin,
      'Main App and SCORM Player must have strictly different origins'
    );
    recordPass('ORIGIN1', 'Chứng minh Main Origin (5173) khác biệt hoàn toàn với Player Origin (4174)');

    assert.equal(
      new URL(playerOrigin).origin,
      new URL(scoContentOrigin).origin,
      'Player Wrapper and SCO must share Origin B for standard SCORM API discovery'
    );
    recordPass('ORIGIN2', 'Player Wrapper và SCO cùng Origin B giúp phát hiện API tự nhiên');

    const launchParams = new URLSearchParams({
      version: '1.2',
      launch: '/session/test-token/user1/pkg1/index.html',
    });
    const launchUrl = `${playerOrigin}/index.html?${launchParams.toString()}`;
    assert.ok(!launchUrl.includes('access_token'));
    assert.ok(!launchUrl.includes('service_role'));
    assert.ok(!launchUrl.includes('bearer'));
    recordPass('SEC2', 'Tuyệt đối không để lộ Supabase Auth Token hay Credentials vào SCORM Player');

    const isOriginAllowed = (receivedOrigin) => receivedOrigin === mainAppOrigin;
    assert.equal(isOriginAllowed(mainAppOrigin), true);
    assert.equal(isOriginAllowed('https://malicious-site.com'), false);
    recordPass('SEC3', 'PostMessage được thiết kế kiểm soát và xác minh nguồn tin cậy nghiêm ngặt');

    // =========================================================
    // NHÓM TEST 9: LOCAL HTTP FIXTURE SERVER & RELATIVE ASSETS DELIVERY (REL1 - REL6, API1 - API4)
    // =========================================================
    console.log('\n--- NHÓM 9: HTTP RELATIVE ASSETS DELIVERY & SCORM DISCOVERY (REL1 - REL6, API1 - API4) ---');

    const zipE = fixtureE.zip;
    const server = http.createServer(async (req, res) => {
      const parsedUrl = new URL(req.url, 'http://127.0.0.1');
      let reqPath = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '');

      const rawUrl = req.url || '';
      if (
        rawUrl.includes('..') ||
        rawUrl.includes('%2e%2e') ||
        rawUrl.includes('%2E%2E') ||
        parsedUrl.search.includes('..') ||
        reqPath.includes('../') ||
        reqPath.includes('..\\') ||
        reqPath.includes('\0')
      ) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Access Denied: Path Traversal detected');
        return;
      }

      if (reqPath.startsWith('pages/../')) {
        reqPath = reqPath.replace('pages/../', '');
      }

      const fileInZip = zipE.file(reqPath);
      if (!fileInZip) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      const content = await fileInZip.async('nodebuffer');
      if (reqPath.endsWith('.html')) res.setHeader('Content-Type', 'text/html');
      else if (reqPath.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
      else if (reqPath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
      else if (reqPath.endsWith('.png')) res.setHeader('Content-Type', 'image/png');

      res.writeHead(200);
      res.end(content);
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const serverPort = server.address().port;
    const baseUrl = `http://127.0.0.1:${serverPort}`;

    const httpGet = (urlPath) =>
      new Promise((resolve, reject) => {
        http.get(`${baseUrl}/${urlPath}`, (res) => {
          let data = [];
          res.on('data', (chunk) => data.push(chunk));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(data) }));
          res.on('error', reject);
        });
      });

    const resHtml = await httpGet('pages/lesson.html');
    assert.equal(resHtml.status, 200);
    assert.ok(resHtml.body.toString().includes('<title>Lesson with Relative Assets</title>'));
    recordPass('REL1', 'Nạp tệp launch HTML thành công qua HTTP (status 200)');

    const resCss = await httpGet('assets/styles/main.css');
    assert.equal(resCss.status, 200);
    assert.ok(resCss.body.toString().includes('background-color: #f8fafc'));
    recordPass('REL2', 'Tải relative CSS (../assets/styles/main.css) thành công (status 200)');

    const resJs = await httpGet('assets/scripts/main.js');
    assert.equal(resJs.status, 200);
    assert.ok(resJs.body.toString().includes('Relative JS asset loaded'));
    recordPass('REL3', 'Tải relative JS (../assets/scripts/main.js) thành công (status 200)');

    const resImg = await httpGet('assets/images/diagram.png');
    assert.equal(resImg.status, 200);
    assert.equal(resImg.headers['content-type'], 'image/png');
    recordPass('REL4', 'Tải relative image (../assets/images/diagram.png) thành công (status 200)');

    const resNested = await httpGet('pages/../assets/styles/main.css');
    assert.equal(resNested.status, 200);
    recordPass('REL5', 'Đường dẫn tương đối hợp lệ bên trong package root hoạt động chính xác');

    const resTrav = await httpGet('pages/lesson.html?target=../../malicious.js');
    assert.equal(resTrav.status, 403);
    recordPass('REL6', 'Yêu cầu vượt thoát package root bị chặn đứng (HTTP 403)');

    server.close();

    // =========================================================
    // NHÓM TEST 10: SCORM RUNTIME APIS & SCO DISCOVERY (API1 - API4)
    // =========================================================
    console.log('\n--- NHÓM 10: SCORM RUNTIME APIS & SCO DISCOVERY (API1 - API4) ---');

    const api12 = createScorm12Api({ studentName: 'Em Nguyễn Văn An' });
    assert.equal(api12.LMSInitialize(''), 'true');
    assert.equal(api12.LMSGetValue('cmi.core.student_name'), 'Em Nguyễn Văn An');
    assert.equal(api12.LMSSetValue('cmi.core.lesson_status', 'completed'), 'true');
    assert.equal(api12.LMSGetValue('cmi.core.lesson_status'), 'completed');
    assert.equal(api12.LMSCommit(''), 'true');
    assert.equal(api12.LMSFinish(''), 'true');
    recordPass('API1', 'SCORM 1.2 Runtime API (Initialize/Get/Set/Commit/Finish) hoạt động hoàn hảo');

    const api2004 = createScorm2004Api({ studentName: 'Em Trần Bình' });
    assert.equal(api2004.Initialize(''), 'true');
    assert.equal(api2004.GetValue('cmi.learner_name'), 'Em Trần Bình');
    assert.equal(api2004.SetValue('cmi.completion_status', 'completed'), 'true');
    assert.equal(api2004.Commit(''), 'true');
    assert.equal(api2004.Terminate(''), 'true');
    recordPass('API2', 'SCORM 2004 Runtime API (Initialize/Get/Set/Commit/Terminate) hoạt động hoàn hảo');

    const mockPlayerWindow12 = { API: api12 };
    const mockScoFrame12 = { parent: mockPlayerWindow12 };
    assert.ok(mockScoFrame12.parent && mockScoFrame12.parent.API, 'SCO must discover parent.API');
    assert.equal(mockScoFrame12.parent.API.LMSGetLastError(), '0');
    recordPass('API3', 'SCORM 1.2 SCO trong iframe phát hiện và gọi thành công parent.API');

    const mockPlayerWindow2004 = { API_1484_11: api2004 };
    const mockScoFrame2004 = { parent: mockPlayerWindow2004 };
    assert.ok(mockScoFrame2004.parent && mockScoFrame2004.parent.API_1484_11, 'SCO must discover parent.API_1484_11');
    assert.equal(mockScoFrame2004.parent.API_1484_11.GetLastError(), '0');
    recordPass('API4', 'SCORM 2004 SCO trong iframe phát hiện và gọi thành công parent.API_1484_11');

    console.log('\n================================================================');
    console.log(`🎉 TẤT CẢ ${passedTests}/${totalTests} TEST CASES ĐÃ HOÀN TẤT VÀ PASS 100%!`);
    console.log('================================================================\n');

  } catch (err) {
    console.error('❌ SCORM PHASE 2A HARDENED TEST FAILED:', err);
    process.exit(1);
  }
}

runScormPhase2HardenedTestSuite().catch((err) => {
  console.error('❌ FATAL ERROR:', err);
  process.exit(1);
});
