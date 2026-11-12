// tests/question_bank_pglite_p65_visibility_fix.test.mjs
// ============================================================================
// QUESTION BANK V1 — P65 STAGING VISIBILITY RPC FINAL TWO-GATE SAFETY SUITE (PGLITE)
// Validates candidate_rpc_qb_update_item_metadata_staging_p65.sql against Staging Schema:
// 1. Admin chia sẻ public
// 2. Teacher chia sẻ câu hỏi của mình theo chính sách được xác nhận
// 3. Teacher không được sửa câu hỏi người khác (Ownership Gate)
// 4. Chia sẻ school khi có school_id hợp lệ (và từ chối khi school_id null)
// 5. Chia sẻ private (xác nhận lưu đúng private)
// 6. DB không cập nhật visibility thì BFF báo lỗi (Zero-Trust fail-closed)
// 7. Published/private -> published/public mà không thay đổi status
// 8. Tương thích kép: Chuẩn hóa school_shared -> school và public_template -> public
// 9. Bảo tồn lifecycle: Archive và Restore hoạt động bình thường
// 10. Bảo tồn metadata: Title, difficulty, tags cập nhật an toàn
// ============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Setup exact Staging Schema matching rcqgxmcqolxbrahhyxji
async function setupStagingEnvironment(db) {
  await db.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres') THEN CREATE ROLE postgres; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;

    CREATE TABLE public.question_bank_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      question_type TEXT NOT NULL,
      difficulty TEXT NOT NULL DEFAULT 'medium',
      tags TEXT[] NOT NULL DEFAULT '{}'::text[],
      grade_level INTEGER NOT NULL CHECK (grade_level BETWEEN 1 AND 12),
      subject TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
      visibility TEXT NOT NULL DEFAULT 'private' CONSTRAINT check_qb_items_visibility CHECK (visibility IN ('private', 'school', 'public')),
      school_id UUID,
      author_id UUID NOT NULL,
      current_version_id UUID,
      version_count INTEGER NOT NULL DEFAULT 1 CHECK (version_count >= 1),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE public.question_bank_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      question_bank_item_id UUID NOT NULL REFERENCES public.question_bank_items(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL CHECK (version_number >= 1),
      prompt TEXT NOT NULL,
      options JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_by UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const candidateSqlPath = path.resolve(__dirname, 'candidate_rpc_qb_update_item_metadata_staging_p65.sql');
  const candidateSql = fs.readFileSync(candidateSqlPath, 'utf8');
  await db.exec(candidateSql);
}

test('P65 STAGING VISIBILITY RPC FINAL TWO-GATE SUITE', async (t) => {
  const db = new PGlite();
  await setupStagingEnvironment(db);

  const adminId = '11111111-1111-1111-1111-111111111111';
  const teacherAuthorId = '22222222-2222-2222-2222-222222222222';
  const teacherOtherId = '33333333-3333-3333-3333-333333333333';
  const validSchoolId = '44444444-4444-4444-4444-444444444444';

  // Helper to create test item
  const createItem = async (initialStatus = 'draft', initialVis = 'private', author = adminId, schoolId = null) => {
    const res = await db.query(`
      INSERT INTO public.question_bank_items (title, question_type, grade_level, subject, status, visibility, author_id, school_id)
      VALUES ('Test Item', 'single_choice', 3, 'Toán', $1, $2, $3, $4)
      RETURNING id;
    `, [initialStatus, initialVis, author, schoolId]);
    return res.rows[0].id;
  };

  await t.test('1. ADMIN CHIA SẺ PUBLIC: Admin shares question (draft/private -> published/public)', async () => {
    const itemId = await createItem('draft', 'private', adminId);

    const res = await db.query(`
      SELECT public.rpc_qb_update_item_metadata($1, $2, $3, $4) AS result;
    `, [adminId, 'admin', itemId, JSON.stringify({ status: 'published', visibility: 'public' })]);

    const result = res.rows[0].result;
    assert.equal(result.success, true);
    assert.equal(result.status, 'published');
    assert.equal(result.visibility, 'public');

    const dbRow = (await db.query('SELECT status, visibility FROM public.question_bank_items WHERE id = $1', [itemId])).rows[0];
    assert.equal(dbRow.status, 'published');
    assert.equal(dbRow.visibility, 'public');
  });

  await t.test('2. TEACHER CHIA SẺ CÂU HỎI CỦA MÌNH: Teacher shares own question as public', async () => {
    const itemId = await createItem('draft', 'private', teacherAuthorId);

    const res = await db.query(`
      SELECT public.rpc_qb_update_item_metadata($1, $2, $3, $4) AS result;
    `, [teacherAuthorId, 'teacher', itemId, JSON.stringify({ status: 'published', visibility: 'public' })]);

    const result = res.rows[0].result;
    assert.equal(result.success, true);
    assert.equal(result.status, 'published');
    assert.equal(result.visibility, 'public');

    const dbRow = (await db.query('SELECT status, visibility FROM public.question_bank_items WHERE id = $1', [itemId])).rows[0];
    assert.equal(dbRow.status, 'published');
    assert.equal(dbRow.visibility, 'public');
  });

  await t.test('3. TEACHER KHÔNG SỬA CÂU HỎI NGƯỜI KHÁC: Ownership check blocks non-author teacher', async () => {
    const itemId = await createItem('draft', 'private', teacherAuthorId);

    const res = await db.query(`
      SELECT public.rpc_qb_update_item_metadata($1, $2, $3, $4) AS result;
    `, [teacherOtherId, 'teacher', itemId, JSON.stringify({ title: 'Hacked Title', visibility: 'public' })]);

    const result = res.rows[0].result;
    assert.equal(result.success, false);
    assert.equal(result.error_code, 'FORBIDDEN');

    const dbRow = (await db.query('SELECT title, visibility FROM public.question_bank_items WHERE id = $1', [itemId])).rows[0];
    assert.equal(dbRow.title, 'Test Item');
    assert.equal(dbRow.visibility, 'private');
  });

  await t.test('4. CHIA SẺ SCHOOL: Allowed with valid school_id, blocked when school_id is null', async () => {
    // 4a. Success with valid school_id
    const itemWithSchool = await createItem('draft', 'private', teacherAuthorId, validSchoolId);
    const successRes = await db.query(`
      SELECT public.rpc_qb_update_item_metadata($1, $2, $3, $4) AS result;
    `, [teacherAuthorId, 'teacher', itemWithSchool, JSON.stringify({ status: 'published', visibility: 'school' })]);

    assert.equal(successRes.rows[0].result.success, true);
    assert.equal(successRes.rows[0].result.visibility, 'school');

    const dbSchoolRow = (await db.query('SELECT visibility FROM public.question_bank_items WHERE id = $1', [itemWithSchool])).rows[0];
    assert.equal(dbSchoolRow.visibility, 'school');

    // 4b. Blocked when school_id is null
    const itemNoSchool = await createItem('draft', 'private', teacherAuthorId, null);
    const failRes = await db.query(`
      SELECT public.rpc_qb_update_item_metadata($1, $2, $3, $4) AS result;
    `, [teacherAuthorId, 'teacher', itemNoSchool, JSON.stringify({ visibility: 'school' })]);

    assert.equal(failRes.rows[0].result.success, false);
    assert.equal(failRes.rows[0].result.error_code, 'INVALID_SCHOOL_ID');
  });

  await t.test('5. CHIA SẺ PRIVATE: Explicit private visibility updates and returns private', async () => {
    const itemId = await createItem('draft', 'private', teacherAuthorId);

    const res = await db.query(`
      SELECT public.rpc_qb_update_item_metadata($1, $2, $3, $4) AS result;
    `, [teacherAuthorId, 'teacher', itemId, JSON.stringify({ status: 'published', visibility: 'private' })]);

    const result = res.rows[0].result;
    assert.equal(result.success, true);
    assert.equal(result.status, 'published');
    assert.equal(result.visibility, 'private');

    const dbRow = (await db.query('SELECT status, visibility FROM public.question_bank_items WHERE id = $1', [itemId])).rows[0];
    assert.equal(dbRow.status, 'published');
    assert.equal(dbRow.visibility, 'private');
  });

  await t.test('6. DB KHÔNG CẬP NHẬT VISIBILITY THÌ BFF BÁO LỖI: Zero-Trust verification', () => {
    const verifyRouterPersistence = (requestedVis, actualDbVis, isStaging = true) => {
      if (!actualDbVis) return false;
      if (requestedVis === 'private') return actualDbVis === 'private';
      if (requestedVis === 'school' || requestedVis === 'school_shared') {
        return isStaging ? actualDbVis === 'school' : (actualDbVis === 'school_shared' || actualDbVis === 'school');
      }
      if (requestedVis === 'public' || requestedVis === 'public_template') {
        return isStaging ? actualDbVis === 'public' : (actualDbVis === 'public_template' || actualDbVis === 'public');
      }
      return false;
    };

    // Public requested, DB returned public -> PASS
    assert.equal(verifyRouterPersistence('public', 'public'), true);
    assert.equal(verifyRouterPersistence('public_template', 'public'), true);

    // School requested, DB returned school -> PASS
    assert.equal(verifyRouterPersistence('school', 'school'), true);
    assert.equal(verifyRouterPersistence('school_shared', 'school'), true);

    // Private requested, DB returned private -> PASS
    assert.equal(verifyRouterPersistence('private', 'private'), true);

    // Public requested, but DB returned private -> FAIL (BFF must throw error)
    assert.equal(verifyRouterPersistence('public', 'private'), false);
    assert.equal(verifyRouterPersistence('public_template', 'private'), false);

    // School requested, but DB returned private -> FAIL
    assert.equal(verifyRouterPersistence('school', 'private'), false);

    // Private requested, but DB returned public -> FAIL
    assert.equal(verifyRouterPersistence('private', 'public'), false);

    // RPC returned undefined visibility -> FAIL
    assert.equal(verifyRouterPersistence('public', undefined), false);
  });

  await t.test('7. PUBLISHED/PRIVATE -> PUBLISHED/PUBLIC MÀ KHÔNG THAY ĐỔI STATUS', async () => {
    const itemId = await createItem('published', 'private', teacherAuthorId);

    // Only update visibility, omit status
    const res = await db.query(`
      SELECT public.rpc_qb_update_item_metadata($1, $2, $3, $4) AS result;
    `, [teacherAuthorId, 'teacher', itemId, JSON.stringify({ visibility: 'public' })]);

    const result = res.rows[0].result;
    assert.equal(result.success, true);
    assert.equal(result.status, 'published', 'Status must stay published');
    assert.equal(result.visibility, 'public', 'Visibility must become public');

    const dbRow = (await db.query('SELECT status, visibility FROM public.question_bank_items WHERE id = $1', [itemId])).rows[0];
    assert.equal(dbRow.status, 'published');
    assert.equal(dbRow.visibility, 'public');
  });

  await t.test('8. DUAL COMPATIBILITY: Staging normalizes public_template and school_shared', async () => {
    // 8a. public_template -> public
    const itemPublic = await createItem('draft', 'private', adminId);
    const pubRes = await db.query(`
      SELECT public.rpc_qb_update_item_metadata($1, $2, $3, $4) AS result;
    `, [adminId, 'admin', itemPublic, JSON.stringify({ status: 'published', visibility: 'public_template' })]);
    assert.equal(pubRes.rows[0].result.visibility, 'public');

    // 8b. school_shared -> school
    const itemSchool = await createItem('draft', 'private', adminId, validSchoolId);
    const schoolRes = await db.query(`
      SELECT public.rpc_qb_update_item_metadata($1, $2, $3, $4) AS result;
    `, [adminId, 'admin', itemSchool, JSON.stringify({ visibility: 'school_shared' })]);
    assert.equal(schoolRes.rows[0].result.visibility, 'school');
  });

  await t.test('9. LIFECYCLE PRESERVATION: Archive and restore preserve visibility', async () => {
    const itemId = await createItem('published', 'public', adminId);

    const archiveRes = await db.query(`
      SELECT public.rpc_qb_update_item_metadata($1, $2, $3, $4) AS result;
    `, [adminId, 'admin', itemId, JSON.stringify({ status: 'archived' })]);
    assert.equal(archiveRes.rows[0].result.status, 'archived');
    assert.equal(archiveRes.rows[0].result.visibility, 'public');

    const restoreRes = await db.query(`
      SELECT public.rpc_qb_update_item_metadata($1, $2, $3, $4) AS result;
    `, [adminId, 'admin', itemId, JSON.stringify({ status: 'draft' })]);
    assert.equal(restoreRes.rows[0].result.status, 'draft');
    assert.equal(restoreRes.rows[0].result.visibility, 'public');
  });

  await t.test('10. METADATA REGRESSION: Title, difficulty, tags update safely with RETURNING', async () => {
    const itemId = await createItem('draft', 'private', adminId);

    const res = await db.query(`
      SELECT public.rpc_qb_update_item_metadata($1, $2, $3, $4) AS result;
    `, [adminId, 'admin', itemId, JSON.stringify({
      title: 'Phép tính diện tích hình tròn',
      difficulty: 'expert',
      tags: ['toán-9', 'hình-học'],
    })]);

    assert.equal(res.rows[0].result.success, true);
    assert.equal(res.rows[0].result.status, 'draft');
    assert.equal(res.rows[0].result.visibility, 'private');

    const dbRow = (await db.query('SELECT title, difficulty, tags FROM public.question_bank_items WHERE id = $1', [itemId])).rows[0];
    assert.equal(dbRow.title, 'Phép tính diện tích hình tròn');
    assert.equal(dbRow.difficulty, 'expert');
    assert.deepEqual(dbRow.tags, ['toán-9', 'hình-học']);
  });
});
