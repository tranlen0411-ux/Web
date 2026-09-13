// scripts/test_question_bank_safe_delete_rpc.mjs
// Comprehensive PGlite Test Suite for rpc_qb_safe_delete_or_archive_question

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const migrationFile = path.join(
  rootDir,
  'supabase/migrations/20260913095123_question_bank_safe_delete_or_archive.sql'
);
const rpcSql = fs.readFileSync(migrationFile, 'utf8');

async function setupTestDb() {
  const db = new PGlite();

  // 1. Roles
  await db.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role;
      END IF;
    END $$;
  `);

  // 2. Base Schemas & Tables for Question Bank & Exam Builder
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS app_private;

    -- Question Bank Tables
    CREATE TABLE IF NOT EXISTS public.question_bank_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code VARCHAR(50),
      title TEXT NOT NULL,
      question_type VARCHAR(30) NOT NULL DEFAULT 'single_choice',
      subject VARCHAR(100) NOT NULL DEFAULT 'Toán',
      grade_level INT NOT NULL DEFAULT 5,
      difficulty VARCHAR(20) NOT NULL DEFAULT 'easy',
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      visibility VARCHAR(30) NOT NULL DEFAULT 'private',
      school_id UUID NULL,
      author_id UUID NOT NULL,
      current_version_id UUID NULL,
      version_count INT NOT NULL DEFAULT 1,
      tags TEXT[] NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.question_bank_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      question_bank_item_id UUID NOT NULL REFERENCES public.question_bank_items(id) ON DELETE CASCADE,
      version_number INT NOT NULL DEFAULT 1,
      prompt TEXT NOT NULL,
      options JSONB NOT NULL DEFAULT '[]'::jsonb,
      forked_from_version_id UUID NULL,
      change_log TEXT NULL,
      created_by UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS app_private.question_bank_answer_keys (
      version_id UUID PRIMARY KEY REFERENCES public.question_bank_versions(id) ON DELETE CASCADE,
      correct_answers JSONB NOT NULL,
      grading_config JSONB NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Exam Builder Questions (for Exam Lineage Check)
    CREATE TABLE IF NOT EXISTS public.exam_questions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      exam_version_id UUID NOT NULL,
      question_number INT NOT NULL DEFAULT 1,
      question_type VARCHAR(30) NOT NULL DEFAULT 'single_choice',
      prompt TEXT NOT NULL,
      options_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      points NUMERIC(6, 2) NOT NULL DEFAULT 1.00,
      source_question_bank_item_id UUID NULL,
      source_question_bank_version_id UUID NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Circular FK on items
    ALTER TABLE public.question_bank_items
      ADD CONSTRAINT fk_qb_items_current_version
      FOREIGN KEY (current_version_id)
      REFERENCES public.question_bank_versions(id)
      ON DELETE RESTRICT
      DEFERRABLE INITIALLY DEFERRED;
  `);

  // 3. Apply Safe-Delete RPC Migration
  await db.exec(rpcSql);

  return db;
}

test('Question Bank Safe Delete RPC Test Suite', async (t) => {
  const db = await setupTestDb();

  const teacher1 = '11111111-1111-1111-1111-111111111111';
  const teacher2 = '22222222-2222-2222-2222-222222222222';
  const adminUser = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  await t.test('1. Security: Search path and grants verification', async () => {
    const fnDef = await db.query(`
      SELECT p.prosecdef, p.proconfig
      FROM pg_proc p
      WHERE p.proname = 'rpc_qb_safe_delete_or_archive_question';
    `);
    assert.equal(fnDef.rows.length, 1);
    assert.equal(fnDef.rows[0].prosecdef, true, 'Function must be SECURITY DEFINER');
    assert.ok(
      fnDef.rows[0].proconfig &&
        (fnDef.rows[0].proconfig.includes('search_path=""') || fnDef.rows[0].proconfig.includes('search_path=')),
      'search_path must be empty'
    );

    const grants = await db.query(`
      SELECT grantee, privilege_type
      FROM information_schema.routine_privileges
      WHERE routine_name = 'rpc_qb_safe_delete_or_archive_question';
    `);
    const serviceRoleGrant = grants.rows.some(
      (g) => g.grantee === 'service_role' && g.privilege_type === 'EXECUTE'
    );
    const publicGrant = grants.rows.some(
      (g) => (g.grantee === 'PUBLIC' || g.grantee === 'anon' || g.grantee === 'authenticated') && g.privilege_type === 'EXECUTE'
    );
    assert.equal(serviceRoleGrant, true, 'service_role must have EXECUTE');
    assert.equal(publicGrant, false, 'PUBLIC/anon/authenticated must NOT have EXECUTE');
  });

  await t.test('2. Hard-Delete: Clean draft with exactly 1 actual version is hard-deleted', async () => {
    const itemId = '00000000-0000-0000-0000-000000000001';
    const versionId = '00000000-0000-0000-0000-000000000011';

    // Seed draft item with 1 version and answer key
    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Câu hỏi nháp 1', $2, 'draft', 1);`, [itemId, teacher1]);
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, created_by) VALUES ($1, $2, 1, 'Tính 1 + 1', $3);`, [versionId, itemId, teacher1]);
    await db.query(`UPDATE public.question_bank_items SET current_version_id = $1 WHERE id = $2;`, [versionId, itemId]);
    await db.query(`INSERT INTO app_private.question_bank_answer_keys (version_id, correct_answers) VALUES ($1, '{"answer": "2"}'::jsonb);`, [versionId]);

    // Call RPC as owner teacher
    const res = await db.query(`
      SELECT public.rpc_qb_safe_delete_or_archive_question($1, 'teacher', $2) AS result;
    `, [teacher1, itemId]);

    const result = res.rows[0].result;
    assert.equal(result.success, true);
    assert.equal(result.action, 'deleted');
    assert.equal(result.item_id, itemId);
    assert.equal(result.version_count, 1);

    // Verify item deleted
    const checkItem = await db.query(`SELECT COUNT(*) FROM public.question_bank_items WHERE id = $1;`, [itemId]);
    assert.equal(Number(checkItem.rows[0].count), 0);

    // Verify version deleted
    const checkVer = await db.query(`SELECT COUNT(*) FROM public.question_bank_versions WHERE id = $1;`, [versionId]);
    assert.equal(Number(checkVer.rows[0].count), 0);

    // Verify answer key deleted
    const checkKey = await db.query(`SELECT COUNT(*) FROM app_private.question_bank_answer_keys WHERE version_id = $1;`, [versionId]);
    assert.equal(Number(checkKey.rows[0].count), 0);
  });

  await t.test('3. Zero-Version Fail-Closed: Draft with 0 actual version records is archived, NEVER hard-deleted', async () => {
    const itemId = '00000000-0000-0000-0000-000000000000';

    // Seed draft item with 0 versions (data inconsistency / orphan draft container)
    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Câu hỏi nháp 0 version', $2, 'draft', 0);`, [itemId, teacher1]);

    const res = await db.query(`
      SELECT public.rpc_qb_safe_delete_or_archive_question($1, 'teacher', $2) AS result;
    `, [teacher1, itemId]);

    const result = res.rows[0].result;
    assert.equal(result.success, true);
    assert.equal(result.action, 'archived', 'Zero version draft must fail-closed to archive');
    assert.equal(result.version_count, 0);

    // Verify item still exists with status archived
    const checkItem = await db.query(`SELECT status FROM public.question_bank_items WHERE id = $1;`, [itemId]);
    assert.equal(checkItem.rows[0].status, 'archived');
  });

  await t.test('4. Archive: Published question is archived (Soft Delete)', async () => {
    const itemId = '00000000-0000-0000-0000-000000000002';
    const versionId = '00000000-0000-0000-0000-000000000021';

    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Câu hỏi xuất bản 2', $2, 'published', 1);`, [itemId, teacher1]);
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, created_by) VALUES ($1, $2, 1, 'Tính 2 + 2', $3);`, [versionId, itemId, teacher1]);
    await db.query(`UPDATE public.question_bank_items SET current_version_id = $1 WHERE id = $2;`, [versionId, itemId]);
    await db.query(`INSERT INTO app_private.question_bank_answer_keys (version_id, correct_answers) VALUES ($1, '{"answer": "4"}'::jsonb);`, [versionId]);

    const res = await db.query(`
      SELECT public.rpc_qb_safe_delete_or_archive_question($1, 'teacher', $2) AS result;
    `, [teacher1, itemId]);

    const result = res.rows[0].result;
    assert.equal(result.success, true);
    assert.equal(result.action, 'archived');
    assert.equal(result.item_id, itemId);

    // Verify item still exists with status archived
    const checkItem = await db.query(`SELECT status FROM public.question_bank_items WHERE id = $1;`, [itemId]);
    assert.equal(checkItem.rows[0].status, 'archived');

    // Verify versions and answer keys preserved 100%
    const checkVer = await db.query(`SELECT COUNT(*) FROM public.question_bank_versions WHERE id = $1;`, [versionId]);
    assert.equal(Number(checkVer.rows[0].count), 1);
  });

  await t.test('5. Archive: Draft with multiple versions (version_count > 1) is archived', async () => {
    const itemId = '00000000-0000-0000-0000-000000000003';
    const v1 = '00000000-0000-0000-0000-000000000031';
    const v2 = '00000000-0000-0000-0000-000000000032';

    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Câu hỏi nhiều version', $2, 'draft', 2);`, [itemId, teacher1]);
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, created_by) VALUES ($1, $2, 1, 'Prompt V1', $3);`, [v1, itemId, teacher1]);
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, created_by) VALUES ($1, $2, 2, 'Prompt V2', $3);`, [v2, itemId, teacher1]);
    await db.query(`UPDATE public.question_bank_items SET current_version_id = $1 WHERE id = $2;`, [v2, itemId]);

    const res = await db.query(`
      SELECT public.rpc_qb_safe_delete_or_archive_question($1, 'teacher', $2) AS result;
    `, [teacher1, itemId]);

    const result = res.rows[0].result;
    assert.equal(result.success, true);
    assert.equal(result.action, 'archived');
    assert.equal(result.version_count, 2);

    const checkItem = await db.query(`SELECT status FROM public.question_bank_items WHERE id = $1;`, [itemId]);
    assert.equal(checkItem.rows[0].status, 'archived');
  });

  await t.test('6. Archive: Draft with Exam Builder Lineage is archived', async () => {
    const itemId = '00000000-0000-0000-0000-000000000004';
    const versionId = '00000000-0000-0000-0000-000000000041';
    const examVersionId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Câu hỏi có exam lineage', $2, 'draft', 1);`, [itemId, teacher1]);
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, created_by) VALUES ($1, $2, 1, 'Prompt Exam Used', $3);`, [versionId, itemId, teacher1]);
    await db.query(`UPDATE public.question_bank_items SET current_version_id = $1 WHERE id = $2;`, [versionId, itemId]);
    await db.query(`INSERT INTO public.exam_questions (exam_version_id, question_number, prompt, source_question_bank_item_id, source_question_bank_version_id) VALUES ($1, 1, 'Exam Question Prompt', $2, $3);`, [examVersionId, itemId, versionId]);

    const res = await db.query(`
      SELECT public.rpc_qb_safe_delete_or_archive_question($1, 'teacher', $2) AS result;
    `, [teacher1, itemId]);

    const result = res.rows[0].result;
    assert.equal(result.success, true);
    assert.equal(result.action, 'archived');

    const checkItem = await db.query(`SELECT status FROM public.question_bank_items WHERE id = $1;`, [itemId]);
    assert.equal(checkItem.rows[0].status, 'archived');
  });

  await t.test('7. Archive: Draft with Fork Lineage is archived', async () => {
    const sourceItemId = '00000000-0000-0000-0000-000000000005';
    const sourceVersionId = '00000000-0000-0000-0000-000000000051';
    const forkedItemId = '00000000-0000-0000-0000-000000000006';
    const forkedVersionId = '00000000-0000-0000-0000-000000000061';

    // Source draft
    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Câu hỏi nguồn', $2, 'draft', 1);`, [sourceItemId, teacher1]);
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, created_by) VALUES ($1, $2, 1, 'Prompt Source', $3);`, [sourceVersionId, sourceItemId, teacher1]);
    await db.query(`UPDATE public.question_bank_items SET current_version_id = $1 WHERE id = $2;`, [sourceVersionId, sourceItemId]);

    // Forked question pointing to sourceVersionId
    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Câu hỏi được fork', $2, 'draft', 1);`, [forkedItemId, teacher2]);
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, forked_from_version_id, created_by) VALUES ($1, $2, 1, 'Prompt Forked', $3, $4);`, [forkedVersionId, forkedItemId, sourceVersionId, teacher2]);
    await db.query(`UPDATE public.question_bank_items SET current_version_id = $1 WHERE id = $2;`, [forkedVersionId, forkedItemId]);

    // Deleting source item must be archived because forked item references it
    const res = await db.query(`
      SELECT public.rpc_qb_safe_delete_or_archive_question($1, 'teacher', $2) AS result;
    `, [teacher1, sourceItemId]);

    const result = res.rows[0].result;
    assert.equal(result.success, true);
    assert.equal(result.action, 'archived');
  });

  await t.test('8. Idempotency: Already archived question returns already_archived', async () => {
    const itemId = '00000000-0000-0000-0000-000000000007';
    const versionId = '00000000-0000-0000-0000-000000000071';

    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Câu hỏi đã lưu trữ sẵn', $2, 'archived', 1);`, [itemId, teacher1]);
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, created_by) VALUES ($1, $2, 1, 'Prompt Archived', $3);`, [versionId, itemId, teacher1]);
    await db.query(`UPDATE public.question_bank_items SET current_version_id = $1 WHERE id = $2;`, [versionId, itemId]);

    const res = await db.query(`
      SELECT public.rpc_qb_safe_delete_or_archive_question($1, 'teacher', $2) AS result;
    `, [teacher1, itemId]);

    const result = res.rows[0].result;
    assert.equal(result.success, true);
    assert.equal(result.action, 'already_archived');
  });

  await t.test('9. Ownership: Teacher cannot delete someone else question (Forbidden 42501)', async () => {
    const itemId = '00000000-0000-0000-0000-000000000008';
    const versionId = '00000000-0000-0000-0000-000000000081';

    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Câu hỏi của Teacher 2', $2, 'draft', 1);`, [itemId, teacher2]);
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, created_by) VALUES ($1, $2, 1, 'Prompt T2', $3);`, [versionId, itemId, teacher2]);
    await db.query(`UPDATE public.question_bank_items SET current_version_id = $1 WHERE id = $2;`, [versionId, itemId]);

    // Teacher 1 attempts to delete Teacher 2's question
    await assert.rejects(
      async () => {
        await db.query(`
          SELECT public.rpc_qb_safe_delete_or_archive_question($1, 'teacher', $2);
        `, [teacher1, itemId]);
      },
      (err) => {
        return err.message.includes('ERR_UNAUTHORIZED') || err.message.includes('quyền');
      }
    );
  });

  await t.test('10. Not Found: Deleting non-existent question throws P0002 / ERR_ITEM_NOT_FOUND', async () => {
    const nonExistentId = '00000000-0000-0000-0000-000000000099';
    await assert.rejects(
      async () => {
        await db.query(`
          SELECT public.rpc_qb_safe_delete_or_archive_question($1, 'teacher', $2);
        `, [teacher1, nonExistentId]);
      },
      (err) => {
        return err.message.includes('ERR_ITEM_NOT_FOUND') || err.message.includes('Không tìm thấy');
      }
    );
  });

  await t.test('11. Role check: Student role is rejected (Forbidden 42501)', async () => {
    const itemId = '00000000-0000-0000-0000-000000000008';
    await assert.rejects(
      async () => {
        await db.query(`
          SELECT public.rpc_qb_safe_delete_or_archive_question($1, 'student', $2);
        `, [teacher1, itemId]);
      },
      (err) => {
        return err.message.includes('ERR_UNAUTHORIZED');
      }
    );
  });

  await t.test('12. Admin: Admin can delete clean draft of any teacher', async () => {
    const itemId = '00000000-0000-0000-0000-000000000009';
    const versionId = '00000000-0000-0000-0000-000000000091';

    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Câu hỏi nháp của T2 xóa bởi Admin', $2, 'draft', 1);`, [itemId, teacher2]);
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, created_by) VALUES ($1, $2, 1, 'Prompt T2 Draft', $3);`, [versionId, itemId, teacher2]);
    await db.query(`UPDATE public.question_bank_items SET current_version_id = $1 WHERE id = $2;`, [versionId, itemId]);

    const res = await db.query(`
      SELECT public.rpc_qb_safe_delete_or_archive_question($1, 'admin', $2) AS result;
    `, [adminUser, itemId]);

    const result = res.rows[0].result;
    assert.equal(result.success, true);
    assert.equal(result.action, 'deleted');

    const checkItem = await db.query(`SELECT COUNT(*) FROM public.question_bank_items WHERE id = $1;`, [itemId]);
    assert.equal(Number(checkItem.rows[0].count), 0);
  });
});
