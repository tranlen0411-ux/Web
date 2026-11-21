import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('PGlite PostgreSQL In-Memory Runtime Migration Validation', async (t) => {
  let PGlite;
  try {
    const pgliteModule = await import('@electric-sql/pglite');
    PGlite = pgliteModule.PGlite;
  } catch (err) {
    t.skip(`PGlite not available: ${err.message}`);
    return;
  }

  const db = new PGlite();

  await t.test('1. Initialize isolated PostgreSQL schema baseline', async () => {
    await db.exec(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'postgres') THEN
          CREATE ROLE postgres;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
          CREATE ROLE service_role;
        END IF;
      END
      $$;

      CREATE TABLE IF NOT EXISTS public.question_bank_items (
        id UUID PRIMARY KEY,
        title TEXT,
        difficulty TEXT,
        tags TEXT[],
        grade_level INT,
        subject TEXT,
        status TEXT,
        visibility TEXT,
        author_id UUID,
        version_count INT,
        current_version_id UUID,
        metadata JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        question_type TEXT
      );

      CREATE TABLE IF NOT EXISTS public.question_bank_versions (
        id UUID PRIMARY KEY,
        question_bank_item_id UUID,
        version_number INT,
        prompt TEXT,
        question_type TEXT,
        forked_from_version_id UUID,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS unique_qb_version_number 
        ON public.question_bank_versions(question_bank_item_id, version_number);
    `);
  });

  await t.test('2. Execute migration SQL file on isolated PostgreSQL engine', async () => {
    const migrationPath = path.resolve(
      __dirname,
      '../supabase/migrations/20261109140000_question_bank_list_questions_persistent_tri_state_origin.sql'
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');

    // Executing full DDL on real PostgreSQL parser/engine
    await db.exec(sql);

    // Verify function exists in pg_proc
    const checkRes = await db.query(`
      SELECT proname, prosecdef 
      FROM pg_proc 
      WHERE proname = 'rpc_qb_list_questions';
    `);
    assert.equal(checkRes.rows.length, 1, 'Function rpc_qb_list_questions must exist in pg_proc');
    assert.equal(checkRes.rows[0].prosecdef, true, 'Function must be SECURITY DEFINER');
  });

  await t.test('3. Test function execution on mock items with Tri-State origin resolution', async () => {
    const itemOrigId = '8f1d022f-1111-4444-8888-000000000001';
    const verOrigId = '8f1d022f-1111-4444-8888-000000000002';

    const itemCloneId = 'd0285eed-2222-4444-8888-000000000001';
    const verClone1Id = 'd0285eed-2222-4444-8888-000000000002';
    const verClone2Id = 'd0285eed-2222-4444-8888-000000000003';
    const sourceForkId = 'ae2b0712-67cc-4f08-85dc-b68b6b69f1ab';

    const callerId = '11111111-1111-4111-8111-111111111111';

    // Insert 1 original question
    await db.query(`
      INSERT INTO public.question_bank_items (id, title, status, visibility, author_id, version_count, current_version_id, metadata)
      VALUES ($1::uuid, 'Original Math Question', 'published', 'public', $2::uuid, 1, $3::uuid, '{}'::jsonb);
    `, [itemOrigId, callerId, verOrigId]);

    await db.query(`
      INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, forked_from_version_id)
      VALUES ($1::uuid, $2::uuid, 1, 'What is 2 + 2?', NULL);
    `, [verOrigId, itemOrigId]);

    // Insert 1 clone question edited to Version 2 (where v2.forked_from_version_id is NULL)
    await db.query(`
      INSERT INTO public.question_bank_items (id, title, status, visibility, author_id, version_count, current_version_id, metadata)
      VALUES ($1::uuid, 'Cloned Question (Edited to V2)', 'published', 'private', $2::uuid, 2, $3::uuid, jsonb_build_object('forked_from_version_id', $4::text));
    `, [itemCloneId, callerId, verClone2Id, sourceForkId]);

    await db.query(`
      INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, forked_from_version_id)
      VALUES ($1::uuid, $2::uuid, 1, 'Prompt V1', $3::uuid);
    `, [verClone1Id, itemCloneId, sourceForkId]);

    await db.query(`
      INSERT INTO public.question_bank_versions (id, question_bank_item_id, version_number, prompt, forked_from_version_id)
      VALUES ($1::uuid, $2::uuid, 2, 'Prompt V2 (Edited)', NULL);
    `, [verClone2Id, itemCloneId]);

    // Invoke rpc_qb_list_questions
    const callRes = await db.query(`
      SELECT public.rpc_qb_list_questions($1::uuid, 'admin', '{}'::jsonb) as res;
    `, [callerId]);

    const result = callRes.rows[0].res;
    assert.equal(result.success, true, 'RPC must succeed');
    assert.equal(result.total_count, 2, 'Total count must be 2');

    const origItem = result.items.find(i => i.id === itemOrigId);
    const cloneItem = result.items.find(i => i.id === itemCloneId);

    assert.ok(origItem, 'Original item must be present');
    assert.equal(origItem.origin_status, 'original', 'Original item must have origin_status = "original"');
    assert.equal(origItem.forked_from_version_id, null, 'Original item must have forked_from_version_id = null');

    assert.ok(cloneItem, 'Clone item must be present');
    assert.equal(cloneItem.origin_status, 'clone', 'Clone item must have origin_status = "clone"');
    assert.equal(cloneItem.forked_from_version_id, sourceForkId, 'Clone item must recover forked UUID even on Version 2');
  });
});
