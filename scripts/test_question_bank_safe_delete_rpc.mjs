// scripts/test_question_bank_safe_delete_rpc.mjs
// Comprehensive PGlite Test Suite for rpc_qb_safe_delete_or_archive_question,
// Version & Answer-Key Immutability Triggers, and Exam Builder Foreign Keys.

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
const migration3File = path.join(
  rootDir,
  'supabase/migrations/20260914005505_complete_qb_safe_delete_version_trigger_and_exam_fks.sql'
);
const examRpcFile = path.join(
  rootDir,
  'supabase/migrations/20260905000003_exam_builder_v1_phase2a_authoring_rpcs.sql'
);

const migration1Sql = fs.readFileSync(migration1File, 'utf8');
const migration2Sql = fs.readFileSync(migration2File, 'utf8');
const migration3Sql = fs.readFileSync(migration3File, 'utf8');
const examRpcSql = fs.readFileSync(examRpcFile, 'utf8');

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
      question_bank_item_id UUID NOT NULL REFERENCES public.question_bank_items(id) ON DELETE RESTRICT,
      version_number INT NOT NULL DEFAULT 1,
      prompt TEXT NOT NULL,
      options JSONB NOT NULL DEFAULT '[]'::jsonb,
      forked_from_version_id UUID NULL REFERENCES public.question_bank_versions(id) ON DELETE SET NULL,
      change_log TEXT NULL,
      created_by UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS app_private.question_bank_answer_keys (
      version_id UUID PRIMARY KEY REFERENCES public.question_bank_versions(id) ON DELETE RESTRICT,
      correct_answers JSONB NOT NULL,
      grading_config JSONB NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Exam Builder Tables (for Exam Lineage & Save Draft RPC)
    CREATE TABLE IF NOT EXISTS public.exam_tests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      author_id UUID NOT NULL,
      title VARCHAR(255) NOT NULL,
      subject VARCHAR(100) NOT NULL,
      grade_level INT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      current_version_id UUID NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.exam_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      exam_id UUID NOT NULL REFERENCES public.exam_tests(id) ON DELETE CASCADE,
      version_number INT NOT NULL DEFAULT 1,
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      title VARCHAR(255) NOT NULL,
      description TEXT NULL,
      subject VARCHAR(100) NOT NULL,
      grade_level INT NOT NULL,
      duration_minutes INT NULL,
      starts_at TIMESTAMPTZ NULL,
      due_date TIMESTAMPTZ NULL,
      max_attempts INT NOT NULL DEFAULT 1,
      reward_stars INT NOT NULL DEFAULT 0,
      shuffle_questions BOOLEAN NOT NULL DEFAULT FALSE,
      shuffle_options BOOLEAN NOT NULL DEFAULT FALSE,
      tab_switch_policy VARCHAR(20) NOT NULL DEFAULT 'OFF',
      show_score_after_submit BOOLEAN NOT NULL DEFAULT TRUE,
      show_correct_answers BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.exam_questions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      exam_version_id UUID NOT NULL REFERENCES public.exam_versions(id) ON DELETE CASCADE,
      question_number INT NOT NULL DEFAULT 1,
      question_type VARCHAR(30) NOT NULL DEFAULT 'single_choice',
      prompt TEXT NOT NULL,
      options_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      points NUMERIC(6, 2) NOT NULL DEFAULT 1.00,
      source_question_bank_item_id UUID NULL,
      source_question_bank_version_id UUID NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS app_private.exam_answer_keys (
      question_id UUID PRIMARY KEY REFERENCES public.exam_questions(id) ON DELETE CASCADE,
      correct_answer JSONB NULL,
      accepted_answers JSONB NULL,
      case_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
      grading_config JSONB NULL DEFAULT '{}'::jsonb,
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

  // 3. Initial baseline trigger definitions
  await db.exec(`
    CREATE OR REPLACE FUNCTION public.fn_prevent_question_bank_version_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'VERSION_IMMUTABILITY_VIOLATION: question_bank_versions rows are immutable (append-only). UPDATE is strictly prohibited.' USING ERRCODE = '55000';
      ELSIF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'VERSION_IMMUTABILITY_VIOLATION: question_bank_versions rows are immutable audit logs. DELETE is strictly prohibited.' USING ERRCODE = '55000';
      END IF;
      RETURN NULL;
    END;
    $$;

    DROP TRIGGER IF EXISTS trg_enforce_question_bank_version_immutability ON public.question_bank_versions;
    CREATE TRIGGER trg_enforce_question_bank_version_immutability
    BEFORE DELETE OR UPDATE ON public.question_bank_versions
    FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_question_bank_version_mutation();

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

  // 4. Apply Migration 1 (Safe Delete RPC initial)
  await db.exec(migration1Sql);

  // 5. Apply Migration 2 (Fix Answer Key trigger & RPC context)
  await db.exec(migration2Sql);

  // 6. Apply Migration 3 (Fix Version trigger context & Exam Foreign Keys)
  await db.exec(migration3Sql);

  // 7. Apply Exam Authoring RPCs
  await db.exec(examRpcSql);

  return db;
}

test('PR #80: Question Bank Safe Delete RPC, Immutability Triggers & FK Comprehensive Suite', async (t) => {
  const db = await setupTestDb();

  const teacher1 = '11111111-1111-1111-1111-111111111111';
  const teacher2 = '22222222-2222-2222-2222-222222222222';
  const adminUser = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  await t.test('1. Security: Search path, grants and security definer verification for RPC and Triggers', async () => {
    // Check RPC
    const rpcInfo = await db.query(`
      SELECT p.prosecdef, p.proconfig
      FROM pg_proc p
      WHERE p.proname = 'rpc_qb_safe_delete_or_archive_question';
    `);
    assert.equal(rpcInfo.rows.length, 1);
    assert.equal(rpcInfo.rows[0].prosecdef, true, 'RPC must be SECURITY DEFINER');
    assert.ok(
      rpcInfo.rows[0].proconfig &&
        (rpcInfo.rows[0].proconfig.includes('search_path=""') || rpcInfo.rows[0].proconfig.includes('search_path=')),
      'RPC search_path must be empty'
    );

    // Check Answer Key Trigger Function
    const akTrgInfo = await db.query(`
      SELECT p.prosecdef, p.proconfig, r.rolname AS owner_name
      FROM pg_proc p
      JOIN pg_roles r ON r.oid = p.proowner
      WHERE p.proname = 'fn_prevent_answer_key_mutation';
    `);
    assert.equal(akTrgInfo.rows.length, 1);
    assert.equal(akTrgInfo.rows[0].prosecdef, true, 'Answer Key trigger fn must be SECURITY DEFINER');
    assert.equal(akTrgInfo.rows[0].owner_name, 'postgres', 'Answer Key trigger fn owner must be postgres');

    // Check Version Trigger Function
    const verTrgInfo = await db.query(`
      SELECT p.prosecdef, p.proconfig, r.rolname AS owner_name
      FROM pg_proc p
      JOIN pg_roles r ON r.oid = p.proowner
      WHERE p.proname = 'fn_prevent_question_bank_version_mutation';
    `);
    assert.equal(verTrgInfo.rows.length, 1);
    assert.equal(verTrgInfo.rows[0].prosecdef, true, 'Version trigger fn must be SECURITY DEFINER');
    assert.equal(verTrgInfo.rows[0].owner_name, 'postgres', 'Version trigger fn owner must be postgres');
    assert.ok(
      verTrgInfo.rows[0].proconfig &&
        (verTrgInfo.rows[0].proconfig.includes('search_path=""') || verTrgInfo.rows[0].proconfig.includes('search_path=')),
      'Version trigger fn search_path must be empty'
    );

    // Check Trigger Privileges (REVOKED from PUBLIC, anon, authenticated, service_role)
    const verGrants = await db.query(`
      SELECT grantee, privilege_type
      FROM information_schema.routine_privileges
      WHERE routine_schema = 'public' AND routine_name = 'fn_prevent_question_bank_version_mutation';
    `);
    assert.equal(verGrants.rows.some((g) => g.grantee === 'PUBLIC'), false, 'Version trigger fn must NOT be granted to PUBLIC');
    assert.equal(verGrants.rows.some((g) => g.grantee === 'anon'), false, 'Version trigger fn must NOT be granted to anon');
    assert.equal(verGrants.rows.some((g) => g.grantee === 'authenticated'), false, 'Version trigger fn must NOT be granted to authenticated');
    assert.equal(verGrants.rows.some((g) => g.grantee === 'service_role'), false, 'Version trigger fn must NOT be granted to service_role');

    // Check RPC Privileges (Granted ONLY to service_role)
    const rpcGrants = await db.query(`
      SELECT grantee, privilege_type
      FROM information_schema.routine_privileges
      WHERE routine_name = 'rpc_qb_safe_delete_or_archive_question';
    `);
    assert.equal(
      rpcGrants.rows.some((g) => g.grantee === 'service_role' && g.privilege_type === 'EXECUTE'),
      true,
      'service_role must have EXECUTE on RPC'
    );
    assert.equal(
      rpcGrants.rows.some((g) => (g.grantee === 'PUBLIC' || g.grantee === 'anon' || g.grantee === 'authenticated') && g.privilege_type === 'EXECUTE'),
      false,
      'PUBLIC/anon/authenticated must NOT have EXECUTE on RPC'
    );
  });

  await t.test('2. Immutability: Direct UPDATE on question_bank_versions is strictly blocked (55000)', async () => {
    const itemId = '00000000-0000-0000-0000-000000000010';
    const verId = '00000000-0000-0000-0000-000000000101';

    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Item Update Test', $2, 'draft', 1);`, [itemId, teacher1]);
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, created_by) VALUES ($1, $2, 1, 'Prompt V1', $3);`, [verId, itemId, teacher1]);

    await assert.rejects(
      async () => {
        await db.query(`UPDATE public.question_bank_versions SET prompt = 'Modified Prompt' WHERE id = $1;`, [verId]);
      },
      (err) => err.code === '55000' && err.message.includes('VERSION_IMMUTABILITY_VIOLATION'),
      'Direct UPDATE on question_bank_versions must fail with SQLSTATE 55000'
    );
  });

  await t.test('3. Immutability: Direct DELETE on question_bank_versions without context is strictly blocked (55000)', async () => {
    const itemId = '00000000-0000-0000-0000-000000000011';
    const verId = '00000000-0000-0000-0000-000000000111';

    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Item Direct Del Ver', $2, 'draft', 1);`, [itemId, teacher1]);
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, created_by) VALUES ($1, $2, 1, 'Prompt V1', $3);`, [verId, itemId, teacher1]);

    await assert.rejects(
      async () => {
        await db.query(`DELETE FROM public.question_bank_versions WHERE id = $1;`, [verId]);
      },
      (err) => err.code === '55000' && err.message.includes('VERSION_IMMUTABILITY_VIOLATION'),
      'Direct DELETE on question_bank_versions without context must fail with SQLSTATE 55000'
    );
  });

  await t.test('4. Immutability: Fake, empty, mismatched item, or invalid UUID context is strictly blocked (55000)', async () => {
    const itemId = '00000000-0000-0000-0000-000000000012';
    const verId = '00000000-0000-0000-0000-000000000121';
    const otherItemId = '00000000-0000-0000-0000-000000000099';

    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Item Fake Ctx', $2, 'draft', 1);`, [itemId, teacher1]);
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, created_by) VALUES ($1, $2, 1, 'Prompt', $3);`, [verId, itemId, teacher1]);

    // Test with invalid UUID context string
    await assert.rejects(
      async () => {
        await db.query(`SELECT set_config('app_private.qb_hard_delete_item_id', 'not-a-valid-uuid', true);`);
        await db.query(`DELETE FROM public.question_bank_versions WHERE id = $1;`, [verId]);
      },
      (err) => err.code === '55000' && err.message.includes('VERSION_IMMUTABILITY_VIOLATION')
    );

    // Test with mismatched item ID in context
    await assert.rejects(
      async () => {
        await db.query(`SELECT set_config('app_private.qb_hard_delete_item_id', $1, true);`, [otherItemId]);
        await db.query(`DELETE FROM public.question_bank_versions WHERE id = $1;`, [verId]);
      },
      (err) => err.code === '55000' && err.message.includes('VERSION_IMMUTABILITY_VIOLATION')
    );

    // Clear context
    await db.query(`SELECT set_config('app_private.qb_hard_delete_item_id', '', true);`);
  });

  await t.test('5. Immutability: Direct UPDATE and DELETE on answer keys remain strictly blocked (55000)', async () => {
    const itemId = '00000000-0000-0000-0000-000000000013';
    const verId = '00000000-0000-0000-0000-000000000131';

    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Item AK Test', $2, 'draft', 1);`, [itemId, teacher1]);
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, created_by) VALUES ($1, $2, 1, 'Prompt', $3);`, [verId, itemId, teacher1]);
    await db.query(`INSERT INTO app_private.question_bank_answer_keys (version_id, correct_answers) VALUES ($1, '{"answer": "A"}'::jsonb);`, [verId]);

    await assert.rejects(
      async () => {
        await db.query(`UPDATE app_private.question_bank_answer_keys SET correct_answers = '{"answer": "B"}'::jsonb WHERE version_id = $1;`, [verId]);
      },
      (err) => err.code === '55000' && err.message.includes('ANSWER_KEY_IMMUTABILITY_VIOLATION')
    );

    await assert.rejects(
      async () => {
        await db.query(`DELETE FROM app_private.question_bank_answer_keys WHERE version_id = $1;`, [verId]);
      },
      (err) => err.code === '55000' && err.message.includes('ANSWER_KEY_IMMUTABILITY_VIOLATION')
    );
  });

  await t.test('6. Hard-Delete: Clean draft via RPC deletes Item, Version, and Answer Key', async () => {
    const itemId = '00000000-0000-0000-0000-000000000001';
    const verId = '00000000-0000-0000-0000-000000000011';

    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Clean Draft 1', $2, 'draft', 1);`, [itemId, teacher1]);
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, created_by) VALUES ($1, $2, 1, 'Tính 1 + 1', $3);`, [verId, itemId, teacher1]);
    await db.query(`UPDATE public.question_bank_items SET current_version_id = $1 WHERE id = $2;`, [verId, itemId]);
    await db.query(`INSERT INTO app_private.question_bank_answer_keys (version_id, correct_answers) VALUES ($1, '{"answer": "2"}'::jsonb);`, [verId]);

    const res = await db.query(`
      SELECT public.rpc_qb_safe_delete_or_archive_question($1, 'teacher', $2) AS result;
    `, [teacher1, itemId]);

    const result = res.rows[0].result;
    assert.equal(result.success, true);
    assert.equal(result.action, 'deleted');
    assert.equal(result.item_id, itemId);
    assert.equal(result.version_count, 1);

    // Verify item, version, and answer key are all deleted
    const itemCheck = await db.query(`SELECT COUNT(*) FROM public.question_bank_items WHERE id = $1;`, [itemId]);
    assert.equal(Number(itemCheck.rows[0].count), 0);

    const verCheck = await db.query(`SELECT COUNT(*) FROM public.question_bank_versions WHERE id = $1;`, [verId]);
    assert.equal(Number(verCheck.rows[0].count), 0);

    const akCheck = await db.query(`SELECT COUNT(*) FROM app_private.question_bank_answer_keys WHERE version_id = $1;`, [verId]);
    assert.equal(Number(akCheck.rows[0].count), 0);
  });

  await t.test('7. Archive: Published item is archived, NEVER hard-deleted', async () => {
    const itemId = '00000000-0000-0000-0000-000000000002';
    const verId = '00000000-0000-0000-0000-000000000021';

    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Published Question', $2, 'published', 1);`, [itemId, teacher1]);
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, created_by) VALUES ($1, $2, 1, 'Tính 2 + 2', $3);`, [verId, itemId, teacher1]);
    await db.query(`UPDATE public.question_bank_items SET current_version_id = $1 WHERE id = $2;`, [verId, itemId]);
    await db.query(`INSERT INTO app_private.question_bank_answer_keys (version_id, correct_answers) VALUES ($1, '{"answer": "4"}'::jsonb);`, [verId]);

    const res = await db.query(`
      SELECT public.rpc_qb_safe_delete_or_archive_question($1, 'teacher', $2) AS result;
    `, [teacher1, itemId]);

    const result = res.rows[0].result;
    assert.equal(result.success, true);
    assert.equal(result.action, 'archived');

    const itemCheck = await db.query(`SELECT status FROM public.question_bank_items WHERE id = $1;`, [itemId]);
    assert.equal(itemCheck.rows[0].status, 'archived');

    const verCheck = await db.query(`SELECT COUNT(*) FROM public.question_bank_versions WHERE id = $1;`, [verId]);
    assert.equal(Number(verCheck.rows[0].count), 1);
  });

  await t.test('8. Archive: Multi-version item is archived, NEVER hard-deleted', async () => {
    const itemId = '00000000-0000-0000-0000-000000000003';
    const v1 = '00000000-0000-0000-0000-000000000031';
    const v2 = '00000000-0000-0000-0000-000000000032';

    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Multi-ver Draft', $2, 'draft', 2);`, [itemId, teacher1]);
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

    const itemCheck = await db.query(`SELECT status FROM public.question_bank_items WHERE id = $1;`, [itemId]);
    assert.equal(itemCheck.rows[0].status, 'archived');
  });

  await t.test('9. Lineage Protection: Item/Version referenced in Exam Builder is archived, NEVER hard-deleted', async () => {
    const examTestId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    const examVerId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1';
    const itemId = '00000000-0000-0000-0000-000000000004';
    const verId = '00000000-0000-0000-0000-000000000041';
    const examQId = '00000000-0000-0000-0000-00000000004e';

    await db.query(`INSERT INTO public.exam_tests (id, author_id, title, subject, grade_level) VALUES ($1, $2, 'Exam Test', 'Toán', 5);`, [examTestId, teacher1]);
    await db.query(`INSERT INTO public.exam_versions (id, exam_id, title, subject, grade_level) VALUES ($1, $2, 'Exam Ver', 'Toán', 5);`, [examVerId, examTestId]);

    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Exam Ref Draft', $2, 'draft', 1);`, [itemId, teacher1]);
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, created_by) VALUES ($1, $2, 1, 'Prompt', $3);`, [verId, itemId, teacher1]);
    await db.query(`UPDATE public.question_bank_items SET current_version_id = $1 WHERE id = $2;`, [verId, itemId]);
    await db.query(`INSERT INTO app_private.question_bank_answer_keys (version_id, correct_answers) VALUES ($1, '{"answer": "K"}'::jsonb);`, [verId]);

    // Reference in exam_questions with both item and version references
    await db.query(`
      INSERT INTO public.exam_questions (id, exam_version_id, question_number, prompt, source_question_bank_item_id, source_question_bank_version_id)
      VALUES ($1, $2, 1, 'Prompt in Exam', $3, $4);
    `, [examQId, examVerId, itemId, verId]);

    const res = await db.query(`
      SELECT public.rpc_qb_safe_delete_or_archive_question($1, 'teacher', $2) AS result;
    `, [teacher1, itemId]);

    const result = res.rows[0].result;
    assert.equal(result.success, true);
    assert.equal(result.action, 'archived');

    const itemCheck = await db.query(`SELECT status FROM public.question_bank_items WHERE id = $1;`, [itemId]);
    assert.equal(itemCheck.rows[0].status, 'archived');
  });

  await t.test('10. Lineage Protection: Item/Version with Fork lineage is archived, NEVER hard-deleted', async () => {
    const parentItemId = '00000000-0000-0000-0000-000000000005';
    const parentVerId = '00000000-0000-0000-0000-000000000051';
    const childItemId = '00000000-0000-0000-0000-000000000006';
    const childVerId = '00000000-0000-0000-0000-000000000061';

    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Parent Draft', $2, 'draft', 1);`, [parentItemId, teacher1]);
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, created_by) VALUES ($1, $2, 1, 'Parent Prompt', $3);`, [parentVerId, parentItemId, teacher1]);
    await db.query(`UPDATE public.question_bank_items SET current_version_id = $1 WHERE id = $2;`, [parentVerId, parentItemId]);

    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Child Draft', $2, 'draft', 1);`, [childItemId, teacher2]);
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, created_by, forked_from_version_id) VALUES ($1, $2, 1, 'Child Prompt', $3, $4);`, [childVerId, childItemId, teacher2, parentVerId]);

    const res = await db.query(`
      SELECT public.rpc_qb_safe_delete_or_archive_question($1, 'teacher', $2) AS result;
    `, [teacher1, parentItemId]);

    const result = res.rows[0].result;
    assert.equal(result.success, true);
    assert.equal(result.action, 'archived');
  });

  await t.test('11. Foreign Key: Insert exam_questions with non-existent item ID fails with 23503', async () => {
    const examVerId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1';
    const fakeItemId = 'ffffffff-0000-0000-0000-000000000001';

    await assert.rejects(
      async () => {
        await db.query(`
          INSERT INTO public.exam_questions (id, exam_version_id, question_number, prompt, source_question_bank_item_id)
          VALUES (gen_random_uuid(), $1, 2, 'Bad FK Item', $2);
        `, [examVerId, fakeItemId]);
      },
      (err) => err.code === '23503' && err.message.includes('fk_exam_questions_source_qb_item'),
      'Foreign key constraint on source_question_bank_item_id must reject non-existent item with 23503'
    );
  });

  await t.test('12. Foreign Key: Insert exam_questions with non-existent version ID fails with 23503', async () => {
    const examVerId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1';
    const fakeVerId = 'ffffffff-0000-0000-0000-000000000002';

    await assert.rejects(
      async () => {
        await db.query(`
          INSERT INTO public.exam_questions (id, exam_version_id, question_number, prompt, source_question_bank_version_id)
          VALUES (gen_random_uuid(), $1, 3, 'Bad FK Ver', $2);
        `, [examVerId, fakeVerId]);
      },
      (err) => err.code === '23503' && err.message.includes('fk_exam_questions_source_qb_version'),
      'Foreign key constraint on source_question_bank_version_id must reject non-existent version with 23503'
    );
  });

  await t.test('13. Foreign Key & Partial Indexes: Metadata, columns, targets, and fail-closed validation', async () => {
    // 13.1 Verify Foreign Keys
    const constraints = await db.query(`
      SELECT
        c.conname,
        c.conrelid::regclass::text AS source_table,
        c.confrelid::regclass::text AS target_table,
        c.contype,
        c.convalidated,
        c.confdeltype,
        a.attname AS source_column,
        fa.attname AS target_column
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
      JOIN pg_attribute fa ON fa.attrelid = c.confrelid AND fa.attnum = ANY(c.confkey)
      WHERE c.conname IN ('fk_exam_questions_source_qb_item', 'fk_exam_questions_source_qb_version');
    `);

    assert.equal(constraints.rows.length, 2, 'Both FK constraints must exist');

    const itemFk = constraints.rows.find((c) => c.conname === 'fk_exam_questions_source_qb_item');
    assert.ok(itemFk, 'fk_exam_questions_source_qb_item must exist');
    assert.equal(itemFk.source_table, 'exam_questions');
    assert.equal(itemFk.target_table, 'question_bank_items');
    assert.equal(itemFk.source_column, 'source_question_bank_item_id');
    assert.equal(itemFk.target_column, 'id');
    assert.equal(itemFk.convalidated, true, 'Item FK constraint must be validated');
    assert.equal(itemFk.confdeltype, 'r', 'Item FK ON DELETE must be RESTRICT (r)');

    const verFk = constraints.rows.find((c) => c.conname === 'fk_exam_questions_source_qb_version');
    assert.ok(verFk, 'fk_exam_questions_source_qb_version must exist');
    assert.equal(verFk.source_table, 'exam_questions');
    assert.equal(verFk.target_table, 'question_bank_versions');
    assert.equal(verFk.source_column, 'source_question_bank_version_id');
    assert.equal(verFk.target_column, 'id');
    assert.equal(verFk.convalidated, true, 'Version FK constraint must be validated');
    assert.equal(verFk.confdeltype, 'r', 'Version FK ON DELETE must be RESTRICT (r)');

    // 13.2 Verify Partial Indexes
    const indexes = await db.query(`
      SELECT indexname, tablename, indexdef
      FROM pg_indexes
      WHERE tablename = 'exam_questions' AND indexname IN ('idx_exam_questions_source_qb_item', 'idx_exam_questions_source_qb_version');
    `);

    assert.equal(indexes.rows.length, 2, 'Both partial indexes must exist on exam_questions');

    const itemIdx = indexes.rows.find((i) => i.indexname === 'idx_exam_questions_source_qb_item');
    assert.ok(itemIdx, 'idx_exam_questions_source_qb_item must exist');
    assert.ok(itemIdx.indexdef.includes('source_question_bank_item_id'), 'Index must index source_question_bank_item_id');
    assert.ok(itemIdx.indexdef.includes('WHERE (source_question_bank_item_id IS NOT NULL)') || itemIdx.indexdef.includes('WHERE source_question_bank_item_id IS NOT NULL'), 'Index must have partial WHERE predicate');

    const verIdx = indexes.rows.find((i) => i.indexname === 'idx_exam_questions_source_qb_version');
    assert.ok(verIdx, 'idx_exam_questions_source_qb_version must exist');
    assert.ok(verIdx.indexdef.includes('source_question_bank_version_id'), 'Index must index source_question_bank_version_id');
    assert.ok(verIdx.indexdef.includes('WHERE (source_question_bank_version_id IS NOT NULL)') || verIdx.indexdef.includes('WHERE source_question_bank_version_id IS NOT NULL'), 'Index must have partial WHERE predicate');

    // 13.3 Verify Migration SQL Static Structure (Fail-closed: No name-only DO blocks, no IF NOT EXISTS swallowing)
    assert.equal(migration3Sql.includes('DO $$'), false, 'Migration must NOT use DO block with name-only check');
    assert.equal(migration3Sql.includes('IF NOT EXISTS'), false, 'Migration must NOT use IF NOT EXISTS for constraints');

    // 13.4 Verify Fail-Closed Behavior on Schema Drift (Duplicate constraint raises error 42710)
    await assert.rejects(
      async () => {
        await db.query(`
          ALTER TABLE public.exam_questions
            ADD CONSTRAINT fk_exam_questions_source_qb_item
            FOREIGN KEY (source_question_bank_item_id)
            REFERENCES public.question_bank_items(id)
            ON DELETE RESTRICT;
        `);
      },
      (err) => err.code === '42710',
      'Direct DDL must fail immediately with 42710 on schema drift instead of swallowing errors'
    );
  });

  await t.test('14. Foreign Key: Prevents deleting parent QB item when exam reference exists (23001 / 23503)', async () => {
    const examVerId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1';
    const itemId = '00000000-0000-0000-0000-000000000050';

    // Create item without versions
    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Item FK Direct Test', $2, 'draft', 0);`, [itemId, teacher1]);

    // Exam questions directly references the item
    await db.query(`
      INSERT INTO public.exam_questions (id, exam_version_id, question_number, prompt, source_question_bank_item_id)
      VALUES (gen_random_uuid(), $1, 10, 'Exam Question with Item FK', $2);
    `, [examVerId, itemId]);

    // Attempt direct delete on parent item - blocked by fk_exam_questions_source_qb_item
    await assert.rejects(
      async () => {
        await db.query(`DELETE FROM public.question_bank_items WHERE id = $1;`, [itemId]);
      },
      (err) => (err.code === '23001' || err.code === '23503') && err.message.includes('fk_exam_questions_source_qb_item'),
      'Foreign Key must block direct DELETE on question_bank_items when referenced by exam_questions'
    );
  });

  await t.test('15. Exam Builder Integration: rpc_exam_save_draft_version functions with valid QB provenance', async () => {
    const examTestId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2';
    const examVerId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee3';
    const qbItemId = '00000000-0000-0000-0000-000000000060';
    const qbVerId = '00000000-0000-0000-0000-000000000601';

    await db.query(`INSERT INTO public.exam_tests (id, author_id, title, subject, grade_level) VALUES ($1, $2, 'Exam Authoring Test', 'Toán', 5);`, [examTestId, teacher1]);
    await db.query(`INSERT INTO public.exam_versions (id, exam_id, title, subject, grade_level) VALUES ($1, $2, 'Draft Version 1', 'Toán', 5);`, [examVerId, examTestId]);

    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'QB Item for Save Draft', $2, 'published', 1);`, [qbItemId, teacher1]);
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, created_by) VALUES ($1, $2, 1, 'Tính 5 x 5', $3);`, [qbVerId, qbItemId, teacher1]);

    const payload = JSON.stringify([
      {
        id: '11111111-0000-0000-0000-000000000001',
        question_number: 1,
        question_type: 'single_choice',
        prompt: 'Tính 5 x 5 = ?',
        points: 2.0,
        options_json: [{ id: 'A', text: '25' }, { id: 'B', text: '20' }],
        source_question_bank_item_id: qbItemId,
        source_question_bank_version_id: qbVerId,
        answer_key: {
          correct_answer: ['A']
        }
      }
    ]);

    const res = await db.query(`
      SELECT public.rpc_exam_save_draft_version(
        p_caller_id := $1,
        p_version_id := $2,
        p_title := 'Updated Draft Title',
        p_description := 'Description',
        p_subject := 'Toán',
        p_grade_level := 5,
        p_duration_minutes := 45,
        p_starts_at := NULL,
        p_due_date := NULL,
        p_max_attempts := 1,
        p_reward_stars := 10,
        p_shuffle_questions := FALSE,
        p_shuffle_options := FALSE,
        p_tab_switch_policy := 'OFF',
        p_show_score_after_submit := TRUE,
        p_show_correct_answers := FALSE,
        p_questions := $3::jsonb,
        p_is_admin := FALSE
      ) AS result;
    `, [teacher1, examVerId, payload]);

    assert.equal(res.rows[0].result.status, 'draft');
    assert.equal(res.rows[0].result.version_id, examVerId);

    const checkSaved = await db.query(`
      SELECT source_question_bank_item_id, source_question_bank_version_id
      FROM public.exam_questions
      WHERE exam_version_id = $1;
    `, [examVerId]);

    assert.equal(checkSaved.rows.length, 1);
    assert.equal(checkSaved.rows[0].source_question_bank_item_id, qbItemId);
    assert.equal(checkSaved.rows[0].source_question_bank_version_id, qbVerId);
  });

  await t.test('16. Triggers Status: Triggers remain ENABLED/ACTIVE', async () => {
    const triggers = await db.query(`
      SELECT
        c.relname,
        t.tgname,
        t.tgenabled
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      WHERE t.tgname IN ('trg_enforce_question_bank_version_immutability', 'trg_enforce_answer_key_immutability');
    `);

    assert.equal(triggers.rows.length, 2);
    for (const row of triggers.rows) {
      assert.equal(row.tgenabled, 'O', `Trigger ${row.tgname} must be active (enabled = 'O')`);
    }
  });

  await t.test('17. Authorization & Validation: Roles and error handling', async () => {
    // Non-owner teacher rejected
    const itemId = '00000000-0000-0000-0000-000000000077';
    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Auth test item', $2, 'draft', 1);`, [itemId, teacher1]);

    await assert.rejects(
      async () => {
        await db.query(`SELECT public.rpc_qb_safe_delete_or_archive_question($1, 'teacher', $2);`, [teacher2, itemId]);
      },
      (err) => err.code === '42501' && err.message.includes('ERR_UNAUTHORIZED')
    );

    // Student role rejected
    await assert.rejects(
      async () => {
        await db.query(`SELECT public.rpc_qb_safe_delete_or_archive_question($1, 'student', $2);`, [teacher1, itemId]);
      },
      (err) => err.code === '42501' && err.message.includes('ERR_UNAUTHORIZED')
    );

    // Non-existent item throws P0002
    await assert.rejects(
      async () => {
        await db.query(`SELECT public.rpc_qb_safe_delete_or_archive_question($1, 'teacher', $2);`, [teacher1, 'ffffffff-ffff-ffff-ffff-ffffffffffff']);
      },
      (err) => err.code === 'P0002' && err.message.includes('ERR_ITEM_NOT_FOUND')
    );
  });

  await t.test('18. Atomicity & Rollback: Failure during transaction rolls back completely', async () => {
    const itemId = '00000000-0000-0000-0000-000000000088';
    const verId = '00000000-0000-0000-0000-000000000081';

    await db.query(`INSERT INTO public.question_bank_items (id, title, author_id, status, version_count) VALUES ($1, 'Item Rollback', $2, 'draft', 1);`, [itemId, teacher1]);
    await db.query(`INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, created_by) VALUES ($1, $2, 1, 'Prompt', $3);`, [verId, itemId, teacher1]);
    await db.query(`INSERT INTO app_private.question_bank_answer_keys (version_id, correct_answers) VALUES ($1, '{"answer": "X"}'::jsonb);`, [verId]);

    await assert.rejects(
      async () => {
        await db.query(`
          BEGIN;
          SELECT public.rpc_qb_safe_delete_or_archive_question('${teacher1}', 'teacher', '${itemId}');
          SELECT 1/0;
          COMMIT;
        `);
      }
    );

    const checkItem = await db.query(`SELECT id FROM public.question_bank_items WHERE id = $1;`, [itemId]);
    assert.equal(checkItem.rows.length, 1, 'Item must remain intact after transaction rollback');
  });
});
