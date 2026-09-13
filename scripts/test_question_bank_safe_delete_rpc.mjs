// scripts/test_question_bank_safe_delete_rpc.mjs
// Comprehensive PGlite Test Suite for rpc_qb_safe_delete_or_archive_question & Immutability Trigger

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const migration1File = path.join(
  rootDir,
  'supabase/migrations/20260913095123_question_bank_safe_delete_or_archive.sql'
);
const migration2File = path.join(
  rootDir,
  'supabase/migrations/20260913103735_fix_qb_draft_hard_delete_trigger.sql'
);
const migration1Sql = fs.readFileSync(migration1File, 'utf8');
const migration2Sql = fs.readFileSync(migration2File, 'utf8');

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

  // 3. Apply Initial Safe-Delete RPC Migration
  await db.exec(migration1Sql);

  // 4. Create Production Trigger Fixture on app_private.question_bank_answer_keys
  await db.exec(`
    CREATE OR REPLACE FUNCTION app_private.fn_prevent_answer_key_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'ANSWER_KEY_IMMUTABILITY_VIOLATION: Answer keys bound to immutable versions cannot be modified. UPDATE is strictly prohibited.' USING ERRCODE = '55000';
      ELSIF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'ANSWER_KEY_IMMUTABILITY_VIOLATION: Answer keys bound to immutable versions cannot be deleted directly. DELETE is strictly prohibited.' USING ERRCODE = '55000';
      END IF;
      RETURN NULL;
    END;
    $$;

    DROP TRIGGER IF EXISTS trg_enforce_answer_key_immutability ON app_private.question_bank_answer_keys;
    CREATE TRIGGER trg_enforce_answer_key_immutability
    BEFORE DELETE OR UPDATE ON app_private.question_bank_answer_keys
    FOR EACH ROW EXECUTE FUNCTION app_private.fn_prevent_answer_key_mutation();
  `);

  // 5. Apply Supplementary Migration (Fixing Trigger & RPC with transaction-local context)
  await db.exec(migration2Sql);

  return db;
}

test('Question Bank Safe Delete RPC & Immutability Trigger Comprehensive Suite', async (t) => {
  const db = await setupTestDb();

  const teacher1 = '11111111-1111-1111-1111-111111111111';
  const teacher2 = '22222222-2222-2222-2222-222222222222';
  const adminUser = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  await t.test('1. Security: Search path, grants and security definer verification', async () => {
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

    const triggerFnDef = await db.query(`
      SELECT p.prosecdef, p.proconfig
      FROM pg_proc p
      WHERE p.proname = 'fn_prevent_answer_key_mutation';
    `);
    assert.equal(triggerFnDef.rows.length, 1);
    assert.equal(triggerFnDef.rows[0].prosecdef, true, 'Trigger function must be SECURITY DEFINER');

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

  await t.test('2. Immutability: Direct UPDATE on answer key is strictly blocked (55000)', async () => {
    const itemId = '00000000-0000-0000-0000-000000000099';
    const versionId = '00000000-0000-0000-0000-000000000991';

    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Item Test Update', $2, 'draft', 1);`, [itemId, teacher1]);
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, created_by) VALUES ($1, $2, 1, 'Prompt', $3);`, [versionId, itemId, teacher1]);
    await db.query(`INSERT INTO app_private.question_bank_answer_keys (version_id, correct_answers) VALUES ($1, '{"answer": "A"}'::jsonb);`, [versionId]);

    await assert.rejects(
      async () => {
        await db.query(`UPDATE app_private.question_bank_answer_keys SET correct_answers = '{"answer": "B"}'::jsonb WHERE version_id = $1;`, [versionId]);
      },
      (err) => {
        return err.code === '55000' && err.message.includes('ANSWER_KEY_IMMUTABILITY_VIOLATION');
      },
      'Direct UPDATE must fail with SQLSTATE 55000'
    );
  });

  await t.test('3. Immutability: Direct DELETE on answer key of published item is strictly blocked (55000)', async () => {
    const itemId = '00000000-0000-0000-0000-000000000098';
    const versionId = '00000000-0000-0000-0000-000000000981';

    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Item Test Published Delete', $2, 'published', 1);`, [itemId, teacher1]);
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, created_by) VALUES ($1, $2, 1, 'Prompt', $3);`, [versionId, itemId, teacher1]);
    await db.query(`INSERT INTO app_private.question_bank_answer_keys (version_id, correct_answers) VALUES ($1, '{"answer": "A"}'::jsonb);`, [versionId]);

    await assert.rejects(
      async () => {
        await db.query(`DELETE FROM app_private.question_bank_answer_keys WHERE version_id = $1;`, [versionId]);
      },
      (err) => {
        return err.code === '55000' && err.message.includes('ANSWER_KEY_IMMUTABILITY_VIOLATION');
      },
      'Direct DELETE of published answer key must fail with SQLSTATE 55000'
    );
  });

  await t.test('4. Immutability: Direct DELETE on answer key of draft without transaction context is strictly blocked (55000)', async () => {
    const itemId = '00000000-0000-0000-0000-000000000097';
    const versionId = '00000000-0000-0000-0000-000000000971';

    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Item Test Draft Direct Delete', $2, 'draft', 1);`, [itemId, teacher1]);
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, created_by) VALUES ($1, $2, 1, 'Prompt', $3);`, [versionId, itemId, teacher1]);
    await db.query(`INSERT INTO app_private.question_bank_answer_keys (version_id, correct_answers) VALUES ($1, '{"answer": "A"}'::jsonb);`, [versionId]);

    await assert.rejects(
      async () => {
        await db.query(`DELETE FROM app_private.question_bank_answer_keys WHERE version_id = $1;`, [versionId]);
      },
      (err) => {
        return err.code === '55000' && err.message.includes('ANSWER_KEY_IMMUTABILITY_VIOLATION');
      },
      'Direct DELETE of draft answer key without context must fail with SQLSTATE 55000'
    );
  });

  await t.test('5. Hard-Delete: Teacher owner hard-deletes clean draft via RPC (Item, Version, Answer Key removed)', async () => {
    const itemId = '00000000-0000-0000-0000-000000000001';
    const versionId = '00000000-0000-0000-0000-000000000011';

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

  await t.test('6. Isolation: Transaction-local context is automatically cleared after transaction', async () => {
    const configCheck = await db.query(`
      SELECT current_setting('app_private.qb_hard_delete_item_id', true) AS ctx;
    `);
    assert.ok(
      configCheck.rows[0].ctx === null || configCheck.rows[0].ctx === '',
      'Context must be null or empty string outside transaction'
    );
  });

  await t.test('7. Fail-Closed: Draft with 0 actual version records is archived, NEVER hard-deleted', async () => {
    const itemId = '00000000-0000-0000-0000-000000000000';

    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Câu hỏi nháp 0 version', $2, 'draft', 0);`, [itemId, teacher1]);

    const res = await db.query(`
      SELECT public.rpc_qb_safe_delete_or_archive_question($1, 'teacher', $2) AS result;
    `, [teacher1, itemId]);

    const result = res.rows[0].result;
    assert.equal(result.success, true);
    assert.equal(result.action, 'archived');
    assert.equal(result.version_count, 0);

    const checkItem = await db.query(`SELECT status FROM public.question_bank_items WHERE id = $1;`, [itemId]);
    assert.equal(checkItem.rows[0].status, 'archived');
  });

  await t.test('8. Lineage Protection: Draft referenced in Exam Builder is archived, NEVER hard-deleted', async () => {
    const itemId = '00000000-0000-0000-0000-000000000004';
    const versionId = '00000000-0000-0000-0000-000000000041';
    const examQuestionId = '00000000-0000-0000-0000-00000000004e';

    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Câu hỏi nháp có trong Đề', $2, 'draft', 1);`, [itemId, teacher1]);
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, created_by) VALUES ($1, $2, 1, 'Prompt exam ref', $3);`, [versionId, itemId, teacher1]);
    await db.query(`UPDATE public.question_bank_items SET current_version_id = $1 WHERE id = $2;`, [versionId, itemId]);
    await db.query(`INSERT INTO app_private.question_bank_answer_keys (version_id, correct_answers) VALUES ($1, '{"answer": "exam_key"}'::jsonb);`, [versionId]);

    // Reference in exam_questions
    await db.query(`
      INSERT INTO public.exam_questions (id, exam_version_id, prompt, source_question_bank_item_id, source_question_bank_version_id)
      VALUES ($1, gen_random_uuid(), 'Prompt in Exam', $2, $3);
    `, [examQuestionId, itemId, versionId]);

    const res = await db.query(`
      SELECT public.rpc_qb_safe_delete_or_archive_question($1, 'teacher', $2) AS result;
    `, [teacher1, itemId]);

    const result = res.rows[0].result;
    assert.equal(result.success, true);
    assert.equal(result.action, 'archived');

    const checkItem = await db.query(`SELECT status FROM public.question_bank_items WHERE id = $1;`, [itemId]);
    assert.equal(checkItem.rows[0].status, 'archived');

    const checkKey = await db.query(`SELECT COUNT(*) FROM app_private.question_bank_answer_keys WHERE version_id = $1;`, [versionId]);
    assert.equal(Number(checkKey.rows[0].count), 1, 'Answer key must be preserved');
  });

  await t.test('9. Lineage Protection: Draft with Fork lineage is archived, NEVER hard-deleted', async () => {
    const parentItemId = '00000000-0000-0000-0000-000000000005';
    const parentVerId = '00000000-0000-0000-0000-000000000051';
    const childItemId = '00000000-0000-0000-0000-000000000006';
    const childVerId = '00000000-0000-0000-0000-000000000061';

    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Parent Draft', $2, 'draft', 1);`, [parentItemId, teacher1]);
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, created_by) VALUES ($1, $2, 1, 'Parent Prompt', $3);`, [parentVerId, parentItemId, teacher1]);
    await db.query(`UPDATE public.question_bank_items SET current_version_id = $1 WHERE id = $2;`, [parentVerId, parentItemId]);
    await db.query(`INSERT INTO app_private.question_bank_answer_keys (version_id, correct_answers) VALUES ($1, '{"answer": "parent"}'::jsonb);`, [parentVerId]);

    // Child item forked from parent
    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Child Item', $2, 'draft', 1);`, [childItemId, teacher2]);
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, created_by, forked_from_version_id) VALUES ($1, $2, 1, 'Forked Prompt', $3, $4);`, [childVerId, childItemId, teacher2, parentVerId]);

    const res = await db.query(`
      SELECT public.rpc_qb_safe_delete_or_archive_question($1, 'teacher', $2) AS result;
    `, [teacher1, parentItemId]);

    const result = res.rows[0].result;
    assert.equal(result.success, true);
    assert.equal(result.action, 'archived');

    const checkParent = await db.query(`SELECT status FROM public.question_bank_items WHERE id = $1;`, [parentItemId]);
    assert.equal(checkParent.rows[0].status, 'archived');
  });

  await t.test('10. Archive: Multi-version draft is archived (version_count > 1)', async () => {
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

  await t.test('11. Archive: Published question is archived, answer key preserved', async () => {
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

    const checkItem = await db.query(`SELECT status FROM public.question_bank_items WHERE id = $1;`, [itemId]);
    assert.equal(checkItem.rows[0].status, 'archived');

    const checkKey = await db.query(`SELECT COUNT(*) FROM app_private.question_bank_answer_keys WHERE version_id = $1;`, [versionId]);
    assert.equal(Number(checkKey.rows[0].count), 1);
  });

  await t.test('12. Idempotency: Already archived question returns action = already_archived', async () => {
    const itemId = '00000000-0000-0000-0000-000000000002';
    const res = await db.query(`
      SELECT public.rpc_qb_safe_delete_or_archive_question($1, 'teacher', $2) AS result;
    `, [teacher1, itemId]);

    const result = res.rows[0].result;
    assert.equal(result.success, true);
    assert.equal(result.action, 'already_archived');
  });

  await t.test('13. Authorization: Non-owner teacher is rejected with 42501', async () => {
    const itemId = '00000000-0000-0000-0000-000000000007';
    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Câu hỏi teacher 1', $2, 'draft', 1);`, [itemId, teacher1]);

    await assert.rejects(
      async () => {
        await db.query(`SELECT public.rpc_qb_safe_delete_or_archive_question($1, 'teacher', $2);`, [teacher2, itemId]);
      },
      (err) => err.code === '42501' && err.message.includes('ERR_UNAUTHORIZED')
    );
  });

  await t.test('14. Authorization: Admin can delete/archive any question', async () => {
    const itemId = '00000000-0000-0000-0000-000000000007';
    const vId = '00000000-0000-0000-0000-000000000071';
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, created_by) VALUES ($1, $2, 1, 'Prompt', $3);`, [vId, itemId, teacher1]);
    await db.query(`UPDATE public.question_bank_items SET current_version_id = $1 WHERE id = $2;`, [vId, itemId]);
    await db.query(`INSERT INTO app_private.question_bank_answer_keys (version_id, correct_answers) VALUES ($1, '{"answer": "A"}'::jsonb);`, [vId]);

    const res = await db.query(`
      SELECT public.rpc_qb_safe_delete_or_archive_question($1, 'admin', $2) AS result;
    `, [adminUser, itemId]);

    const result = res.rows[0].result;
    assert.equal(result.success, true);
    assert.equal(result.action, 'deleted');
  });

  await t.test('15. Role Validation: Student role is rejected with 42501', async () => {
    await assert.rejects(
      async () => {
        await db.query(`SELECT public.rpc_qb_safe_delete_or_archive_question($1, 'student', $2);`, [teacher1, '00000000-0000-0000-0000-000000000001']);
      },
      (err) => err.code === '42501' && err.message.includes('ERR_UNAUTHORIZED')
    );
  });

  await t.test('16. Not Found: Non-existent item throws P0002', async () => {
    await assert.rejects(
      async () => {
        await db.query(`SELECT public.rpc_qb_safe_delete_or_archive_question($1, 'teacher', $2);`, [teacher1, 'ffffffff-ffff-ffff-ffff-ffffffffffff']);
      },
      (err) => err.code === 'P0002' && err.message.includes('ERR_ITEM_NOT_FOUND')
    );
  });

  await t.test('17. Atomicity / Rollback: Error during execution rolls back completely', async () => {
    const itemId = '00000000-0000-0000-0000-000000000088';
    const vId = '00000000-0000-0000-0000-000000000081';

    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Item Rollback', $2, 'draft', 1);`, [itemId, teacher1]);
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, created_by) VALUES ($1, $2, 1, 'Prompt', $3);`, [vId, itemId, teacher1]);
    await db.query(`INSERT INTO app_private.question_bank_answer_keys (version_id, correct_answers) VALUES ($1, '{"answer": "X"}'::jsonb);`, [vId]);

    // Execute in a transaction with an error to ensure atomicity
    await assert.rejects(
      async () => {
        await db.query(`
          BEGIN;
          SELECT public.rpc_qb_safe_delete_or_archive_question('${teacher1}', 'teacher', '${itemId}');
          -- Force intentional error to test rollback
          SELECT 1/0;
          COMMIT;
        `);
      }
    );

    // Verify item still exists after transaction rollback
    const checkItem = await db.query(`SELECT id FROM public.question_bank_items WHERE id = $1;`, [itemId]);
    assert.equal(checkItem.rows.length, 1, 'Item must remain intact after transaction rollback');
  });

  await t.test('18. System Integrity: academic_ranking_entries table is NOT present', async () => {
    const res = await db.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'academic_ranking_entries'
      ) AS present;
    `);
    assert.equal(res.rows[0].present, false, 'academic_ranking_entries must not exist');
  });
});
