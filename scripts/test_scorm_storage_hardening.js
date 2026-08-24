/**
 * ====================================================================
 * 🧪 STATIC & PGLITE SECURITY CONTRACT TESTS:
 * SCORM STORAGE HARDENING MIGRATION (ADD_SCORM_STORAGE_HARDENING.sql)
 * ====================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

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
      ...process.argv.slice(2)
    ],
    { stdio: 'inherit' }
  );
  process.exit(result.status ?? 0);
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('🧪 SCORM G6 STORAGE HARDENING: CONTRACT & SECURITY TEST SUITE');
  console.log('================================================================\n');

  const migrationFilePath = path.resolve(__dirname, '../ADD_SCORM_STORAGE_HARDENING.sql');
  assert.ok(fs.existsSync(migrationFilePath), 'File ADD_SCORM_STORAGE_HARDENING.sql must exist');
  const sqlContent = fs.readFileSync(migrationFilePath, 'utf8');

  let passedTests = 0;
  function pass(name, detail = '') {
    passedTests++;
    console.log(`  ✅ [PASS] ${name}${detail ? ` -> ${detail}` : ''}`);
  }

  // ==================================================================
  // PHẦN 1: STATIC ANALYSIS CỦA MIGRATION FILE
  // ==================================================================
  console.log('--- 1. STATIC CODE & POLICY SCOPE AUDIT ---');

  // Kiểm tra không sửa SELECT hay UPDATE policy
  assert.ok(
    !sqlContent.includes('learning_materials_storage_select'),
    'Static Audit: Migration MUST NOT touch learning_materials_storage_select'
  );
  pass('SELECT Policy Untouched', 'learning_materials_storage_select is NOT present in migration');

  assert.ok(
    !sqlContent.includes('learning_materials_storage_update'),
    'Static Audit: Migration MUST NOT touch learning_materials_storage_update'
  );
  pass('UPDATE Policy Untouched', 'learning_materials_storage_update is NOT present in migration');

  // Kiểm tra chứa cả 2 policy thay thế: INSERT và DELETE
  assert.ok(
    sqlContent.includes('DROP POLICY IF EXISTS "learning_materials_storage_insert" ON storage.objects;') &&
    sqlContent.includes('CREATE POLICY "learning_materials_storage_insert"'),
    'Static Audit: Migration must replace learning_materials_storage_insert'
  );
  pass('INSERT Policy Defined', 'learning_materials_storage_insert properly replaced');

  assert.ok(
    sqlContent.includes('DROP POLICY IF EXISTS "learning_materials_storage_delete" ON storage.objects;') &&
    sqlContent.includes('CREATE POLICY "learning_materials_storage_delete"'),
    'Static Audit: Migration must replace learning_materials_storage_delete'
  );
  pass('DELETE Policy Defined', 'learning_materials_storage_delete properly replaced');

  // Kiểm tra Transaction Block (BEGIN ... COMMIT)
  assert.ok(
    /^\s*BEGIN;/m.test(sqlContent) && /COMMIT;\s*$/m.test(sqlContent),
    'Static Audit: Migration must be wrapped in atomic BEGIN ... COMMIT transaction'
  );
  pass('Transaction Wrapped', 'BEGIN ... COMMIT block verified');


  // ==================================================================
  // PHẦN 2: PGLITE IN-MEMORY POSTGRES CONTRACT & IDEMPOTENCY VERIFICATION
  // ==================================================================
  console.log('\n--- 2. IN-MEMORY PGLITE BEHAVIORAL & RLS TESTING ---');

  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();

  // Khởi tạo schema mock một lần duy nhất
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
    END;
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
      bucket_id TEXT REFERENCES storage.buckets(id),
      name TEXT NOT NULL,
      owner UUID,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE SCHEMA IF NOT EXISTS public;

    CREATE TABLE IF NOT EXISTS public.profiles (
      id UUID PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'student')),
      full_name TEXT
    );

    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

    GRANT USAGE ON SCHEMA auth, storage, public TO anon, authenticated, service_role, postgres;
    GRANT ALL ON ALL TABLES IN SCHEMA storage TO anon, authenticated, service_role, postgres;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role, postgres;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA storage TO anon, authenticated, service_role, postgres;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role, postgres;

    -- SELECT policy cơ sở trong Staging Base Schema (không thay đổi)
    CREATE POLICY "learning_materials_storage_select"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
      bucket_id = 'learning-materials'
      AND (
        (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
        OR (storage.foldername(name))[1] = auth.uid()::text
        OR (
          (storage.foldername(name))[1] = 'scorm-zips'
          AND (storage.foldername(name))[2] = auth.uid()::text
        )
      )
    );
  `);

  async function resetStorage() {
    try {
      await db.exec('ROLLBACK;');
    } catch {
      // ignore
    }
    await db.exec(`
      SET ROLE postgres;
      SET app.current_user_id = '';
      DELETE FROM storage.objects;
      DELETE FROM storage.buckets;
    `);
  }

  // A. TEST: BUCKET MISSING FAILS CLEARLY
  {
    await resetStorage();
    let errorCaught = false;
    try {
      await db.exec(sqlContent);
    } catch (err) {
      errorCaught = true;
      assert.ok(
        err.message.includes('Bucket "learning-materials" không tồn tại'),
        `Expected clear error message, got: ${err.message}`
      );
    }
    assert.ok(errorCaught, 'Migration must throw when learning-materials bucket is missing');
    pass('Missing Bucket Guard', 'Throws clear exception when bucket does not exist');
  }

  // B. TEST: BUCKET WITH NULL allowed_mime_types REMAINS NULL
  {
    await resetStorage();
    await db.exec(`
      INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES ('learning-materials', 'learning-materials', false, 52428800, NULL);
    `);

    await db.exec(sqlContent);

    const res = await db.query(`SELECT allowed_mime_types, public, file_size_limit FROM storage.buckets WHERE id = 'learning-materials'`);
    assert.strictEqual(res.rows[0].allowed_mime_types, null, 'allowed_mime_types must remain NULL when already NULL');
    assert.strictEqual(res.rows[0].public, false, 'public setting preserved');
    assert.strictEqual(Number(res.rows[0].file_size_limit), 52428800, 'file_size_limit preserved');
    pass('NULL MIME Bucket', 'allowed_mime_types remains NULL, public & file_size_limit unchanged');
  }

  // C. TEST: MIME NORMALIZATION & IDEMPOTENCY
  {
    await resetStorage();
    await db.exec(`
      INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES ('learning-materials', 'learning-materials', false, 52428800, ARRAY['application/pdf', 'application/msword', 'image/png']);
    `);

    // Run 1
    await db.exec(sqlContent);
    const res1 = await db.query(`SELECT allowed_mime_types FROM storage.buckets WHERE id = 'learning-materials'`);
    assert.deepStrictEqual(
      res1.rows[0].allowed_mime_types,
      ['application/pdf', 'application/msword', 'image/png', 'application/zip'],
      'application/zip must be appended without disturbing existing order'
    );
    pass('MIME List Appended', 'application/zip added once at the end');

    // Run 2 (Idempotency)
    await db.exec(sqlContent);
    const res2 = await db.query(`SELECT allowed_mime_types FROM storage.buckets WHERE id = 'learning-materials'`);
    assert.deepStrictEqual(
      res2.rows[0].allowed_mime_types,
      ['application/pdf', 'application/msword', 'image/png', 'application/zip'],
      'Second run must be a no-op (idempotent)'
    );
    pass('MIME Idempotent Verification', 'Second execution leaves array intact with 4 elements');
  }

  // D. TEST: RLS PERMISSIONS CONTRACT (Teacher, Student, Admin, Cross-User)
  {
    await resetStorage();

    await db.exec(`
      DELETE FROM public.profiles;

      INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES ('learning-materials', 'learning-materials', false, 52428800, ARRAY['application/pdf', 'application/zip']);

      INSERT INTO public.profiles (id, role, full_name) VALUES
        ('11111111-1111-1111-1111-111111111111', 'admin', 'Admin User'),
        ('22222222-2222-2222-2222-222222222222', 'teacher', 'Teacher 1'),
        ('33333333-3333-3333-3333-333333333333', 'teacher', 'Teacher 2'),
        ('44444444-4444-4444-4444-444444444444', 'student', 'Student 1');
    `);

    // Áp dụng migration
    await db.exec(sqlContent);

    const adminId = '11111111-1111-1111-1111-111111111111';
    const teacher1Id = '22222222-2222-2222-2222-222222222222';
    const teacher2Id = '33333333-3333-3333-3333-333333333333';
    const student1Id = '44444444-4444-4444-4444-444444444444';

    async function asUser(userId, role = 'authenticated') {
      if (userId) {
        await db.exec(`SET app.current_user_id = '${userId}';`);
        await db.exec(`SET ROLE ${role};`);
      } else {
        await db.exec(`SET app.current_user_id = '';`);
        await db.exec(`SET ROLE postgres;`);
      }
    }

    async function canInsert(userId, filePath) {
      await asUser(userId);
      try {
        await db.exec(`
          INSERT INTO storage.objects (bucket_id, name, owner)
          VALUES ('learning-materials', '${filePath}', '${userId}');
        `);
        return true;
      } catch (err) {
        return false;
      }
    }

    async function canDelete(userId, filePath) {
      await asUser(userId);
      const res = await db.query(`
        DELETE FROM storage.objects
        WHERE bucket_id = 'learning-materials' AND name = '${filePath}'
        RETURNING id;
      `);
      return res.rows.length > 0;
    }

    // --- TEST D1: TEACHER PERMISSIONS ---
    console.log('\n  >> Testing Teacher scenarios:');

    // 1. Teacher: <uid>/normal.pdf = ALLOW
    const t1NormalInsert = await canInsert(teacher1Id, `${teacher1Id}/lesson_plan.pdf`);
    assert.strictEqual(t1NormalInsert, true, 'Teacher must be allowed to upload <uid>/normal.pdf');
    pass('Teacher Normal Upload', `${teacher1Id}/lesson_plan.pdf -> ALLOW`);

    // 2. Teacher: scorm-zips/<uid>/package.zip = ALLOW
    const t1ScormZipInsert = await canInsert(teacher1Id, `scorm-zips/${teacher1Id}/math_package.zip`);
    assert.strictEqual(t1ScormZipInsert, true, 'Teacher must be allowed to upload scorm-zips/<uid>/package.zip');
    pass('Teacher SCORM ZIP Upload', `scorm-zips/${teacher1Id}/math_package.zip -> ALLOW`);

    // 3. Teacher: scorm-zips/<other-uid>/package.zip = DENY
    const t1CrossUidInsert = await canInsert(teacher1Id, `scorm-zips/${teacher2Id}/hacked_package.zip`);
    assert.strictEqual(t1CrossUidInsert, false, 'Teacher must NOT be allowed to upload into other teacher zip folder');
    pass('Teacher Cross-User Zip Upload', `scorm-zips/${teacher2Id}/... -> DENY`);

    // 4. Teacher: scorm-zips/package.zip = DENY (no uid subdirectory)
    const t1RootZipInsert = await canInsert(teacher1Id, `scorm-zips/root_package.zip`);
    assert.strictEqual(t1RootZipInsert, false, 'Teacher must NOT be allowed to upload directly into scorm-zips/ without <uid>');
    pass('Teacher Root Zip Upload', `scorm-zips/root_package.zip -> DENY`);

    // 5. Teacher: other-prefix/<uid>/package.zip = DENY
    const t1OtherPrefixInsert = await canInsert(teacher1Id, `other-prefix/${teacher1Id}/package.zip`);
    assert.strictEqual(t1OtherPrefixInsert, false, 'Teacher must NOT be allowed to upload into unrecognized prefixes');
    pass('Teacher Unknown Prefix Upload', `other-prefix/${teacher1Id}/package.zip -> DENY`);

    // 6. Teacher Deletes
    const t1DeleteNormal = await canDelete(teacher1Id, `${teacher1Id}/lesson_plan.pdf`);
    assert.strictEqual(t1DeleteNormal, true, 'Teacher can delete own normal file');
    pass('Teacher Delete Own Normal File', `${teacher1Id}/lesson_plan.pdf -> ALLOW`);

    const t1DeleteScormZip = await canDelete(teacher1Id, `scorm-zips/${teacher1Id}/math_package.zip`);
    assert.strictEqual(t1DeleteScormZip, true, 'Teacher can delete own scorm zip file');
    pass('Teacher Delete Own SCORM Zip', `scorm-zips/${teacher1Id}/math_package.zip -> ALLOW`);

    // Re-seed teacher 2's zip file directly as superuser/postgres
    await asUser(null);
    await db.exec(`
      INSERT INTO storage.objects (bucket_id, name, owner)
      VALUES ('learning-materials', 'scorm-zips/${teacher2Id}/teacher2_pack.zip', '${teacher2Id}');
    `);

    // Teacher 1 tries to delete Teacher 2's zip file
    const t1DeleteT2Zip = await canDelete(teacher1Id, `scorm-zips/${teacher2Id}/teacher2_pack.zip`);
    assert.strictEqual(t1DeleteT2Zip, false, 'Teacher 1 CANNOT delete Teacher 2 zip file');
    pass('Teacher Cross-User Delete', `scorm-zips/${teacher2Id}/... -> DENY`);


    // --- TEST D2: STUDENT PERMISSIONS ---
    console.log('\n  >> Testing Student scenarios:');

    // 1. Student normal upload = DENY
    const s1NormalInsert = await canInsert(student1Id, `${student1Id}/essay.pdf`);
    assert.strictEqual(s1NormalInsert, false, 'Student normal upload must be DENIED');
    pass('Student Normal Upload', `${student1Id}/essay.pdf -> DENY`);

    // 2. Student SCORM ZIP upload = DENY
    const s1ScormZipInsert = await canInsert(student1Id, `scorm-zips/${student1Id}/game.zip`);
    assert.strictEqual(s1ScormZipInsert, false, 'Student SCORM ZIP upload must be DENIED');
    pass('Student SCORM ZIP Upload', `scorm-zips/${student1Id}/game.zip -> DENY`);

    // 3. Student Delete = DENY
    const s1Delete = await canDelete(student1Id, `scorm-zips/${teacher2Id}/teacher2_pack.zip`);
    assert.strictEqual(s1Delete, false, 'Student Delete must be DENIED');
    pass('Student Delete', `storage objects deletion -> DENY`);


    // --- TEST D3: ADMIN PERMISSIONS ---
    console.log('\n  >> Testing Admin scenarios:');

    // 1. Admin normal upload for any path = ALLOW
    const adminUploadNormal = await canInsert(adminId, `${teacher1Id}/admin_override.pdf`);
    assert.strictEqual(adminUploadNormal, true, 'Admin can upload to any path');
    pass('Admin Normal Upload', `${teacher1Id}/admin_override.pdf -> ALLOW`);

    // 2. Admin scorm zip upload for any teacher = ALLOW
    const adminUploadScorm = await canInsert(adminId, `scorm-zips/${teacher2Id}/admin_scorm.zip`);
    assert.strictEqual(adminUploadScorm, true, 'Admin can upload to any SCORM zip path');
    pass('Admin SCORM ZIP Upload', `scorm-zips/${teacher2Id}/admin_scorm.zip -> ALLOW`);

    // 3. Admin delete any file = ALLOW
    const adminDelete = await canDelete(adminId, `scorm-zips/${teacher2Id}/teacher2_pack.zip`);
    assert.strictEqual(adminDelete, true, 'Admin can delete any file');
    pass('Admin Delete', `scorm-zips/${teacher2Id}/teacher2_pack.zip -> ALLOW`);
  }

  console.log('\n================================================================');
  console.log(`🎉 ALL ${passedTests} CONTRACT AND BEHAVIORAL TESTS PASSED!`);
  console.log('================================================================\n');
}

runTestSuite().catch((err) => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
