// scripts/test_app_private_answer_keys_rls.mjs
// Test suite for enabling fail-closed RLS on app_private.question_bank_answer_keys and app_private.exam_answer_keys

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Read new migration file
const migrationFile = path.join(
  rootDir,
  'supabase/migrations/20260914024128_enable_app_private_answer_keys_rls.sql'
);
const migrationSql = fs.readFileSync(migrationFile, 'utf8');

// Base migrations needed
const MIGRATIONS = [
  'supabase/migrations/20260905000001_exam_builder_v1_phase1_schema.sql',
  'supabase/migrations/20260905000002_exam_builder_v1_phase1_1_grading_status.sql',
  'supabase/migrations/20260905000003_exam_builder_v1_phase2a_authoring_rpcs.sql',
  'supabase/migrations/20260913095123_question_bank_safe_delete_or_archive.sql',
  'supabase/migrations/20260913103735_fix_qb_draft_hard_delete_trigger.sql',
  'supabase/migrations/20260914005505_complete_qb_safe_delete_version_trigger_and_exam_fks.sql'
];

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
    CREATE SCHEMA IF NOT EXISTS app_private;
  `);

  // 2. Base QB Tables
  await db.exec(`
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

    ALTER TABLE public.question_bank_items
      DROP CONSTRAINT IF EXISTS fk_qb_items_current_version;
    ALTER TABLE public.question_bank_items
      ADD CONSTRAINT fk_qb_items_current_version
      FOREIGN KEY (current_version_id)
      REFERENCES public.question_bank_versions(id)
      ON DELETE RESTRICT
      DEFERRABLE INITIALLY DEFERRED;
  `);

  // 3. Load migration files
  for (const relPath of MIGRATIONS) {
    const fullPath = path.resolve(rootDir, relPath);
    const sql = fs.readFileSync(fullPath, 'utf8');
    await db.exec(sql);
  }

  return db;
}

test('Security PR: Fail-Closed RLS on app_private Answer Key Tables Suite', async (t) => {
  await t.test('1. Migration Static Analysis: Exact Scope & Fail-Closed Boundaries', () => {
    const trimmed = migrationSql.trim();
    assert.match(trimmed, /ALTER\s+TABLE\s+app_private\.question_bank_answer_keys\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY;/i);
    assert.match(trimmed, /ALTER\s+TABLE\s+app_private\.exam_answer_keys\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY;/i);

    // Assert NO FORCE ROW LEVEL SECURITY
    assert.doesNotMatch(trimmed, /FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
    // Assert NO CREATE POLICY
    assert.doesNotMatch(trimmed, /CREATE\s+POLICY/i);
    // Assert NO GRANT/REVOKE
    assert.doesNotMatch(trimmed, /GRANT\s+/i);
    assert.doesNotMatch(trimmed, /REVOKE\s+/i);
    // Assert NO DML
    assert.doesNotMatch(trimmed, /INSERT\s+INTO/i);
    assert.doesNotMatch(trimmed, /UPDATE\s+/i);
    assert.doesNotMatch(trimmed, /DELETE\s+FROM/i);
    assert.doesNotMatch(trimmed, /TRUNCATE\s+/i);
  });

  await t.test('2. Catalog Verification before & after applying migration', async () => {
    const db = await setupTestDb();

    // Check before: relrowsecurity is false
    const beforeRls = await db.query(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app_private'
        AND c.relname IN ('question_bank_answer_keys', 'exam_answer_keys');
    `);
    assert.equal(beforeRls.rows.length, 2);
    assert.equal(beforeRls.rows[0].relrowsecurity, false);
    assert.equal(beforeRls.rows[1].relrowsecurity, false);

    // Apply migration
    await db.exec(migrationSql);

    // Check after: relrowsecurity is true, relforcerowsecurity is false
    const afterRls = await db.query(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app_private'
        AND c.relname IN ('question_bank_answer_keys', 'exam_answer_keys')
      ORDER BY c.relname;
    `);
    assert.equal(afterRls.rows.length, 2);
    for (const row of afterRls.rows) {
      assert.equal(row.relrowsecurity, true, `Table ${row.relname} must have relrowsecurity = true`);
      assert.equal(row.relforcerowsecurity, false, `Table ${row.relname} must have relforcerowsecurity = false`);
    }

    // Policy count remains 0
    const policies = await db.query(`
      SELECT schemaname, tablename, policyname
      FROM pg_policies
      WHERE schemaname = 'app_private'
        AND tablename IN ('question_bank_answer_keys', 'exam_answer_keys');
    `);
    assert.equal(policies.rows.length, 0, 'Zero policies should exist on fail-closed private answer tables');
  });

  await t.test('3. SECURITY DEFINER RPCs continue functioning with RLS enabled', async () => {
    const db = await setupTestDb();
    await db.exec(migrationSql);

    const teacherId = '11111111-1111-1111-1111-111111111111';
    const examId = '33333333-3333-3333-3333-333333333333';
    const versionId = '44444444-4444-4444-4444-444444444444';
    const questionId = '55555555-5555-5555-5555-555555555555';

    // 3.1 Test Exam Create Test RPC
    const createExamRes = await db.query(`
      SELECT public.rpc_exam_create_test(
        $1::uuid,
        $2::uuid,
        $3::uuid,
        'Đề thi Toán 10'::varchar,
        'Toán'::varchar,
        10::int,
        'Mô tả'::text,
        false::boolean
      ) as res;
    `, [teacherId, examId, versionId]);
    assert.equal(createExamRes.rows[0].res.status, 'draft');

    // 3.2 Test Exam Save Draft RPC writes to app_private.exam_answer_keys
    const questionsPayload = [
      {
        id: questionId,
        question_number: 1,
        question_type: 'single_choice',
        prompt: '1 + 1 = ?',
        options: [
          { id: 'opt-a', content: '2' },
          { id: 'opt-b', content: '3' }
        ],
        points: 1.0,
        answer_key: {
          correct_answer: { selected_option_id: 'opt-a' }
        }
      }
    ];

    const saveResult = await db.query(`
      SELECT public.rpc_exam_save_draft_version(
        p_caller_id => $1::uuid,
        p_version_id => $2::uuid,
        p_title => 'Đề thi Toán 10 Cập nhật'::varchar,
        p_subject => 'Toán'::varchar,
        p_grade_level => 10::int,
        p_description => 'Mô tả'::text,
        p_questions => $3::jsonb
      ) as res;
    `, [teacherId, versionId, JSON.stringify(questionsPayload)]);

    const saveRes = saveResult.rows[0].res;
    assert.equal(saveRes.status, 'draft', 'rpc_exam_save_draft_version should succeed with RLS enabled');

    // Verify answer key was inserted into app_private.exam_answer_keys
    const examKeyRows = await db.query(`
      SELECT COUNT(*)::int as cnt FROM app_private.exam_answer_keys;
    `);
    assert.equal(examKeyRows.rows[0].cnt, 1, 'Exam answer key inserted via SECURITY DEFINER');

    // 3.3 Test Question Bank Safe Delete RPC hard-deletes clean draft with answer key
    // Create QB draft
    const qbItemRes = await db.query(`
      INSERT INTO public.question_bank_items (title, author_id, status, version_count)
      VALUES ('Draft Question RLS', $1::uuid, 'draft', 1)
      RETURNING id;
    `, [teacherId]);
    const qbItemId = qbItemRes.rows[0].id;

    const qbVerRes = await db.query(`
      INSERT INTO public.question_bank_versions (question_bank_item_id, version_number, prompt, options, created_by)
      VALUES ($1::uuid, 1, 'Prompt RLS', '[]'::jsonb, $2::uuid)
      RETURNING id;
    `, [qbItemId, teacherId]);
    const qbVerId = qbVerRes.rows[0].id;

    await db.query(`
      UPDATE public.question_bank_items SET current_version_id = $1::uuid WHERE id = $2::uuid;
    `, [qbVerId, qbItemId]);

    await db.query(`
      INSERT INTO app_private.question_bank_answer_keys (version_id, correct_answers)
      VALUES ($1::uuid, '{"correct_option_ids": ["opt-a"]}'::jsonb);
    `, [qbVerId]);

    // Verify key exists before safe delete
    const qbKeyBefore = await db.query(`
      SELECT COUNT(*)::int as cnt FROM app_private.question_bank_answer_keys WHERE version_id = $1::uuid;
    `, [qbVerId]);
    assert.equal(qbKeyBefore.rows[0].cnt, 1);

    // Call safe-delete RPC
    const delResult = await db.query(`
      SELECT rpc_qb_safe_delete_or_archive_question($1::uuid, $2::text, $3::uuid) as res;
    `, [teacherId, 'teacher', qbItemId]);

    const delRes = delResult.rows[0].res;
    assert.equal(delRes.success, true, 'Safe delete RPC should succeed');
    assert.equal(delRes.action, 'deleted', 'Draft question should be hard-deleted');

    // Verify key was hard-deleted from app_private.question_bank_answer_keys
    const qbKeyAfter = await db.query(`
      SELECT COUNT(*)::int as cnt FROM app_private.question_bank_answer_keys WHERE version_id = $1::uuid;
    `, [qbVerId]);
    assert.equal(qbKeyAfter.rows[0].cnt, 0, 'Answer key should be cleanly deleted');
  });
});
