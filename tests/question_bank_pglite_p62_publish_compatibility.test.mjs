// tests/question_bank_pglite_p62_publish_compatibility.test.mjs
// ============================================================================
// QUESTION BANK V1 — STAGING PUBLISH MINIMAL COMPATIBILITY REGRESSION TEST (PGLITE)
// Validates end-to-end publish compatibility across both Staging and Production:
// 1. Xuất bản private trên cả Staging và Production
// 2. Xuất bản chia sẻ trên Staging (khớp với constraint CHECK (visibility IN ('private', 'school', 'public')))
// 3. Xuất bản public_template trên Production (khớp với constraint CHECK (visibility IN ('private', 'school_shared', 'public_template')))
// 4. Kiểm tra tính nguyên tử (Atomic Update): lỗi validate/RPC không làm thay đổi trạng thái dở dang
// 5. Phân quyền chặt chẽ Admin/Teacher/Student (Student & non-author blocked)
// 6. Bảo vệ đáp án tuyệt đối: Học sinh chỉ xem câu hỏi công bố, zero answer key leakage
// ============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

// Setup Supabase standard roles and schemas
async function setupEnvironment(db) {
  await db.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres') THEN CREATE ROLE postgres; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN CREATE ROLE authenticator; END IF;
    END $$;
    GRANT anon TO authenticator;
    GRANT authenticated TO authenticator;
    GRANT service_role TO authenticator;
    CREATE SCHEMA IF NOT EXISTS app_private;
  `);
}

// Setup Exact Staging Schema (rcqgxmcqolxbrahhyxji)
async function setupStagingSchema(db) {
  await db.exec(`
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
      published_version_id UUID,
      version_count INTEGER NOT NULL DEFAULT 1 CHECK (version_count >= 1),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE public.question_bank_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      question_bank_item_id UUID NOT NULL REFERENCES public.question_bank_items(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL CHECK (version_number >= 1),
      prompt TEXT NOT NULL,
      prompt_media JSONB NOT NULL DEFAULT '[]'::jsonb,
      question_type TEXT NOT NULL,
      options JSONB NOT NULL DEFAULT '[]'::jsonb,
      solution_explanation TEXT,
      rubric JSONB,
      forked_from_version_id UUID,
      created_by UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE app_private.question_bank_answer_keys (
      version_id UUID PRIMARY KEY REFERENCES public.question_bank_versions(id) ON DELETE CASCADE,
      correct_answers JSONB NOT NULL,
      grading_config JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

// Setup Production Dual-Head Schema (szptvqkoiphrhlionfoh)
async function setupProductionSchema(db) {
  await db.exec(`
    CREATE TABLE public.question_bank_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code TEXT UNIQUE,
      title TEXT NOT NULL,
      question_type TEXT NOT NULL,
      difficulty TEXT NOT NULL DEFAULT 'medium',
      tags TEXT[] NOT NULL DEFAULT '{}'::text[],
      grade_level INTEGER NOT NULL CHECK (grade_level BETWEEN 1 AND 12),
      subject TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
      visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'school_shared', 'public_template')),
      school_id UUID,
      author_id UUID NOT NULL,
      current_version_id UUID,
      published_version_id UUID,
      version_count INTEGER NOT NULL DEFAULT 1 CHECK (version_count >= 1),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT chk_draft_no_published_version CHECK (status <> 'draft' OR published_version_id IS NULL)
    );

    CREATE TABLE public.question_bank_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      question_bank_item_id UUID NOT NULL REFERENCES public.question_bank_items(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL CHECK (version_number >= 1),
      prompt TEXT NOT NULL,
      prompt_media JSONB NOT NULL DEFAULT '[]'::jsonb,
      question_type TEXT NOT NULL,
      options JSONB NOT NULL DEFAULT '[]'::jsonb,
      solution_explanation TEXT,
      rubric JSONB,
      forked_from_version_id UUID,
      created_by UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE app_private.question_bank_answer_keys (
      version_id UUID PRIMARY KEY REFERENCES public.question_bank_versions(id) ON DELETE CASCADE,
      correct_answers JSONB NOT NULL,
      grading_config JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

// Deploy Compatible rpc_qb_update_item_metadata
async function deployCompatibleRpcs(db) {
  await db.exec(`
    CREATE OR REPLACE FUNCTION public.rpc_qb_update_item_metadata(
      p_caller_id uuid,
      p_actor_role text,
      p_item_id uuid,
      p_payload jsonb
    )
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $function$
    DECLARE
      v_item public.question_bank_items%ROWTYPE;
      v_current_version public.question_bank_versions%ROWTYPE;
      v_answer_key app_private.question_bank_answer_keys%ROWTYPE;
      v_title text;
      v_difficulty text;
      v_status text;
      v_visibility text;
      v_published_id uuid;
    BEGIN
      -- 1. Actor role validation: Admin or Teacher
      IF p_actor_role IS NULL OR p_actor_role NOT IN ('admin', 'teacher') THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED_ROLE', 'message', 'Access denied');
      END IF;

      -- 2. Caller ID required
      IF p_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED_CALLER', 'message', 'Caller ID is required');
      END IF;

      -- 3. Lock & read item
      SELECT * INTO v_item
      FROM public.question_bank_items
      WHERE id = p_item_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'ITEM_NOT_FOUND', 'message', 'Question item not found');
      END IF;

      -- 4. Author / Admin ACL
      IF p_actor_role <> 'admin' AND v_item.author_id <> p_caller_id THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN', 'message', 'You can only update your own questions');
      END IF;

      v_title := nullif(trim(p_payload->>'title'), '');
      v_difficulty := nullif(trim(p_payload->>'difficulty'), '');
      v_status := nullif(trim(p_payload->>'status'), '');
      v_visibility := nullif(trim(p_payload->>'visibility'), '');

      -- 5. Visibility constraints
      IF v_visibility = 'school_shared' AND v_item.school_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_SCHOOL_ID', 'message', 'Cannot set school_shared on item without an associated school_id');
      END IF;

      -- 6. Status transitions
      IF v_status IS NOT NULL AND v_status <> v_item.status THEN
        IF (v_item.status = 'draft' AND v_status IN ('published', 'archived'))
           OR (v_item.status = 'published' AND v_status = 'archived')
           OR (v_item.status = 'archived' AND v_status = 'draft') THEN
          NULL;
        ELSE
          RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_STATUS_TRANSITION', 'message', 'Invalid status transition');
        END IF;
      END IF;

      -- 7. Verification for Publishing
      IF v_status = 'published' THEN
        IF v_item.current_version_id IS NULL THEN
          RETURN jsonb_build_object('success', false, 'error_code', 'NO_VERSION_AVAILABLE', 'message', 'Cannot publish question without a valid version');
        END IF;

        SELECT * INTO v_current_version
        FROM public.question_bank_versions
        WHERE id = v_item.current_version_id AND question_bank_item_id = v_item.id;

        IF NOT FOUND THEN
          RETURN jsonb_build_object('success', false, 'error_code', 'VERSION_NOT_FOUND', 'message', 'Current version does not exist or does not belong to this item');
        END IF;

        IF nullif(trim(v_current_version.prompt), '') IS NULL THEN
          RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_PROMPT', 'message', 'Cannot publish question with empty prompt');
        END IF;

        SELECT * INTO v_answer_key
        FROM app_private.question_bank_answer_keys
        WHERE version_id = v_item.current_version_id;

        IF NOT FOUND OR v_answer_key.correct_answers IS NULL OR v_answer_key.correct_answers = '{}'::jsonb OR v_answer_key.correct_answers = '[]'::jsonb THEN
          RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_ANSWER_KEY', 'message', 'Cannot publish question without a valid answer key');
        END IF;

        IF v_item.question_type = 'single_choice' THEN
          IF nullif(trim(v_answer_key.correct_answers->>'answer'), '') IS NULL
             AND (jsonb_typeof(v_answer_key.correct_answers->'answers') <> 'array' 
                  OR jsonb_array_length(v_answer_key.correct_answers->'answers') = 0) THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_ANSWER_KEY', 'message', 'Single choice question requires a valid single answer');
          END IF;
        ELSIF v_item.question_type = 'multiple_choice' THEN
          IF jsonb_typeof(v_answer_key.correct_answers->'answers') <> 'array' 
             OR jsonb_array_length(v_answer_key.correct_answers->'answers') = 0 THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_ANSWER_KEY', 'message', 'Multiple choice question requires at least one correct answer');
          END IF;
        END IF;

        v_published_id := v_item.current_version_id;
      ELSIF v_status = 'draft' THEN
        v_published_id := NULL;
      ELSE
        v_published_id := v_item.published_version_id;
      END IF;

      -- 8. Atomic Update
      UPDATE public.question_bank_items
      SET
        title = COALESCE(v_title, title),
        difficulty = CASE
          WHEN v_difficulty IN ('easy', 'medium', 'hard', 'expert') THEN v_difficulty
          ELSE difficulty
        END,
        status = CASE
          WHEN v_status IN ('draft', 'published', 'archived') THEN v_status
          ELSE status
        END,
        published_version_id = v_published_id,
        visibility = CASE
          WHEN v_visibility IN ('private', 'school_shared', 'public_template', 'public', 'school') THEN v_visibility
          ELSE visibility
        END,
        updated_at = now()
      WHERE id = p_item_id;

      RETURN jsonb_build_object(
        'success', true,
        'item_id', p_item_id,
        'status', COALESCE(v_status, v_item.status),
        'published_version_id', v_published_id,
        'message', 'Question metadata updated successfully'
      );
    EXCEPTION
      WHEN OTHERS THEN
        RETURN jsonb_build_object(
          'success', false,
          'error_code', 'DATABASE_ERROR',
          'message', SQLERRM
        );
    END;
    $function$;

    CREATE OR REPLACE FUNCTION public.rpc_qb_get_student_question(
      p_caller_id uuid,
      p_item_id uuid,
      p_version_id uuid DEFAULT NULL::uuid
    )
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $function$
    DECLARE
      v_item public.question_bank_items%ROWTYPE;
      v_version public.question_bank_versions%ROWTYPE;
      v_target_version_id uuid;
    BEGIN
      SELECT * INTO v_item FROM public.question_bank_items WHERE id = p_item_id;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'ITEM_NOT_FOUND', 'message', 'Item not found');
      END IF;

      IF v_item.status <> 'published' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'QUESTION_NOT_PUBLISHED', 'message', 'Question is not published');
      END IF;

      v_target_version_id := COALESCE(p_version_id, v_item.published_version_id, v_item.current_version_id);
      SELECT * INTO v_version FROM public.question_bank_versions WHERE id = v_target_version_id AND question_bank_item_id = p_item_id;

      IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'VERSION_NOT_FOUND', 'message', 'Version not found');
      END IF;

      -- Student view: ZERO answer keys
      RETURN jsonb_build_object(
        'success', true,
        'item_id', v_item.id,
        'version_id', v_version.id,
        'prompt', v_version.prompt,
        'options', v_version.options,
        'question_type', v_version.question_type
      );
    END;
    $function$;
  `);
}

const TEACHER_A = '11111111-1111-4111-8111-111111111111';
const TEACHER_B = '22222222-2222-4222-8222-222222222222';
const ADMIN_USER = '33333333-3333-4333-8333-333333333333';
const STUDENT_USER = '44444444-4444-4444-8444-444444444444';

// ============================================================================
// TEST SUITE: STAGING SCHEMA COMPATIBILITY & REPRODUCIBILITY
// ============================================================================
test('QUESTION BANK V1 — STAGING PUBLISH COMPATIBILITY (PGLITE)', async (t) => {

  await t.test('1. STAGING PARITY: Reproduce Live Error when passing public_template without mapping', async () => {
    const db = new PGlite();
    await setupEnvironment(db);
    await setupStagingSchema(db); // CHECK (visibility IN ('private', 'school', 'public'))
    await deployCompatibleRpcs(db);

    // Create draft item on Staging
    const itemRes = await db.query(`
      INSERT INTO public.question_bank_items (
        title, question_type, grade_level, subject, author_id, status, visibility
      ) VALUES ('Smoke Question', 'single_choice', 5, 'Toán', $1, 'draft', 'private')
      RETURNING id;
    `, [ADMIN_USER]);
    const itemId = itemRes.rows[0].id;

    const verRes = await db.query(`
      INSERT INTO public.question_bank_versions (
        question_bank_item_id, version_number, prompt, question_type, created_by
      ) VALUES ($1, 1, '2 + 3 = ?', 'single_choice', $2)
      RETURNING id;
    `, [itemId, ADMIN_USER]);
    const verId = verRes.rows[0].id;

    await db.query(`UPDATE public.question_bank_items SET current_version_id = $1 WHERE id = $2;`, [verId, itemId]);
    await db.query(`
      INSERT INTO app_private.question_bank_answer_keys (version_id, correct_answers)
      VALUES ($1, '{"answer": "5"}');
    `, [verId]);

    // Thao tác gửi trực tiếp 'public_template' lên Staging sẽ bị ràng buộc check_qb_items_visibility chặn đứng!
    const unmappedRes = await db.query(`
      SELECT public.rpc_qb_update_item_metadata($1, $2, $3, $4) AS res;
    `, [
      ADMIN_USER,
      'admin',
      itemId,
      JSON.stringify({ status: 'published', visibility: 'public_template' })
    ]);

    assert.strictEqual(unmappedRes.rows[0].res.success, false);
    assert.strictEqual(unmappedRes.rows[0].res.error_code, 'DATABASE_ERROR');
    assert.match(unmappedRes.rows[0].res.message, /check_qb_items_visibility/i);

    // Đảm bảo item vẫn là draft, không bị biến đổi dở dang
    const checkItem = (await db.query(`SELECT status, visibility FROM public.question_bank_items WHERE id = $1;`, [itemId])).rows[0];
    assert.strictEqual(checkItem.status, 'draft');
    assert.strictEqual(checkItem.visibility, 'private');
  });

  await t.test('2. STAGING PARITY: Publishing with mapped "public" visibility succeeds atomically', async () => {
    const db = new PGlite();
    await setupEnvironment(db);
    await setupStagingSchema(db);
    await deployCompatibleRpcs(db);

    const itemRes = await db.query(`
      INSERT INTO public.question_bank_items (
        title, question_type, grade_level, subject, author_id, status, visibility
      ) VALUES ('[SMOKE-TEST] Phép cộng đơn giản', 'single_choice', 5, 'Toán', $1, 'draft', 'private')
      RETURNING id;
    `, [ADMIN_USER]);
    const itemId = itemRes.rows[0].id;

    const verRes = await db.query(`
      INSERT INTO public.question_bank_versions (
        question_bank_item_id, version_number, prompt, question_type, created_by
      ) VALUES ($1, 1, '2 + 3 = ?', 'single_choice', $2)
      RETURNING id;
    `, [itemId, ADMIN_USER]);
    const verId = verRes.rows[0].id;

    await db.query(`UPDATE public.question_bank_items SET current_version_id = $1 WHERE id = $2;`, [verId, itemId]);
    await db.query(`
      INSERT INTO app_private.question_bank_answer_keys (version_id, correct_answers)
      VALUES ($1, '{"answer": "5"}');
    `, [verId]);

    // Backend Staging Adapter maps 'public_template' -> 'public'
    const publishRes = await db.query(`
      SELECT public.rpc_qb_update_item_metadata($1, $2, $3, $4) AS res;
    `, [
      ADMIN_USER,
      'admin',
      itemId,
      JSON.stringify({ status: 'published', visibility: 'public' })
    ]);

    assert.strictEqual(publishRes.rows[0].res.success, true);
    assert.strictEqual(publishRes.rows[0].res.status, 'published');

    // Kiểm tra database: status = 'published', visibility = 'public'
    const updatedItem = (await db.query(`SELECT status, visibility, published_version_id FROM public.question_bank_items WHERE id = $1;`, [itemId])).rows[0];
    assert.strictEqual(updatedItem.status, 'published');
    assert.strictEqual(updatedItem.visibility, 'public');
    assert.strictEqual(updatedItem.published_version_id, verId);
  });

  await t.test('3. STAGING PARITY: Publishing in private mode succeeds on Staging', async () => {
    const db = new PGlite();
    await setupEnvironment(db);
    await setupStagingSchema(db);
    await deployCompatibleRpcs(db);

    const itemRes = await db.query(`
      INSERT INTO public.question_bank_items (
        title, question_type, grade_level, subject, author_id, status, visibility
      ) VALUES ('Private Question', 'single_choice', 5, 'Toán', $1, 'draft', 'private')
      RETURNING id;
    `, [TEACHER_A]);
    const itemId = itemRes.rows[0].id;

    const verRes = await db.query(`
      INSERT INTO public.question_bank_versions (
        question_bank_item_id, version_number, prompt, question_type, created_by
      ) VALUES ($1, 1, '7 * 8 = ?', 'single_choice', $2)
      RETURNING id;
    `, [itemId, TEACHER_A]);
    const verId = verRes.rows[0].id;

    await db.query(`UPDATE public.question_bank_items SET current_version_id = $1 WHERE id = $2;`, [verId, itemId]);
    await db.query(`
      INSERT INTO app_private.question_bank_answer_keys (version_id, correct_answers)
      VALUES ($1, '{"answer": "56"}');
    `, [verId]);

    const publishRes = await db.query(`
      SELECT public.rpc_qb_update_item_metadata($1, $2, $3, $4) AS res;
    `, [
      TEACHER_A,
      'teacher',
      itemId,
      JSON.stringify({ status: 'published', visibility: 'private' })
    ]);

    assert.strictEqual(publishRes.rows[0].res.success, true);
    const updated = (await db.query(`SELECT status, visibility FROM public.question_bank_items WHERE id = $1;`, [itemId])).rows[0];
    assert.strictEqual(updated.status, 'published');
    assert.strictEqual(updated.visibility, 'private');
  });

  await t.test('4. PRODUCTION DUAL-HEAD: Publishing with public_template succeeds on Production schema', async () => {
    const db = new PGlite();
    await setupEnvironment(db);
    await setupProductionSchema(db); // CHECK (visibility IN ('private', 'school_shared', 'public_template'))
    await deployCompatibleRpcs(db);

    const itemRes = await db.query(`
      INSERT INTO public.question_bank_items (
        code, title, question_type, grade_level, subject, author_id, status, visibility
      ) VALUES ('PROD-01', 'Tích phân hàm phân thức', 'multiple_choice', 12, 'Toán', $1, 'draft', 'private')
      RETURNING id;
    `, [TEACHER_A]);
    const itemId = itemRes.rows[0].id;

    const verRes = await db.query(`
      INSERT INTO public.question_bank_versions (
        question_bank_item_id, version_number, prompt, question_type, created_by
      ) VALUES ($1, 1, 'Chọn các mệnh đề đúng', 'multiple_choice', $2)
      RETURNING id;
    `, [itemId, TEACHER_A]);
    const verId = verRes.rows[0].id;

    await db.query(`UPDATE public.question_bank_items SET current_version_id = $1 WHERE id = $2;`, [verId, itemId]);
    await db.query(`
      INSERT INTO app_private.question_bank_answer_keys (version_id, correct_answers)
      VALUES ($1, '{"answers": ["A", "C"]}');
    `, [verId]);

    // On Production, 'public_template' is accepted directly
    const pubRes = await db.query(`
      SELECT public.rpc_qb_update_item_metadata($1, $2, $3, $4) AS res;
    `, [
      TEACHER_A,
      'teacher',
      itemId,
      JSON.stringify({ status: 'published', visibility: 'public_template' })
    ]);

    assert.strictEqual(pubRes.rows[0].res.success, true);
    const item = (await db.query(`SELECT status, visibility, published_version_id FROM public.question_bank_items WHERE id = $1;`, [itemId])).rows[0];
    assert.strictEqual(item.status, 'published');
    assert.strictEqual(item.visibility, 'public_template');
    assert.strictEqual(item.published_version_id, verId);
  });

  await t.test('5. ATOMIC CONTAINMENT: Publish failure rolls back completely, zero partial mutation', async () => {
    const db = new PGlite();
    await setupEnvironment(db);
    await setupProductionSchema(db);
    await deployCompatibleRpcs(db);

    // Tạo câu hỏi thiếu đáp án
    const itemRes = await db.query(`
      INSERT INTO public.question_bank_items (
        code, title, question_type, grade_level, subject, author_id, status, visibility
      ) VALUES ('NO-ANS-01', 'Câu hỏi chưa có đáp án', 'single_choice', 10, 'Toán', $1, 'draft', 'private')
      RETURNING id;
    `, [TEACHER_A]);
    const itemId = itemRes.rows[0].id;

    const verRes = await db.query(`
      INSERT INTO public.question_bank_versions (
        question_bank_item_id, version_number, prompt, question_type, created_by
      ) VALUES ($1, 1, 'Chưa có đáp án', 'single_choice', $2)
      RETURNING id;
    `, [itemId, TEACHER_A]);
    const verId = verRes.rows[0].id;

    await db.query(`UPDATE public.question_bank_items SET current_version_id = $1 WHERE id = $2;`, [verId, itemId]);
    // Không insert vào app_private.question_bank_answer_keys!

    // Thử publish và yêu cầu visibility = 'public_template'
    const failRes = await db.query(`
      SELECT public.rpc_qb_update_item_metadata($1, $2, $3, $4) AS res;
    `, [
      TEACHER_A,
      'teacher',
      itemId,
      JSON.stringify({ status: 'published', visibility: 'public_template' })
    ]);

    assert.strictEqual(failRes.rows[0].res.success, false);
    assert.strictEqual(failRes.rows[0].res.error_code, 'MISSING_ANSWER_KEY');

    // Kiểm tra trạng thái: status vẫn là 'draft', visibility vẫn là 'private', published_version_id vẫn NULL
    const check = (await db.query(`SELECT status, visibility, published_version_id FROM public.question_bank_items WHERE id = $1;`, [itemId])).rows[0];
    assert.strictEqual(check.status, 'draft');
    assert.strictEqual(check.visibility, 'private');
    assert.strictEqual(check.published_version_id, null);
  });

  await t.test('6. ACL & SECURITY GATE: Non-author teacher and Student are blocked from publishing', async () => {
    const db = new PGlite();
    await setupEnvironment(db);
    await setupProductionSchema(db);
    await deployCompatibleRpcs(db);

    const itemRes = await db.query(`
      INSERT INTO public.question_bank_items (
        code, title, question_type, grade_level, subject, author_id, status, visibility
      ) VALUES ('SEC-01', 'Câu hỏi của Teacher A', 'single_choice', 10, 'Toán', $1, 'draft', 'private')
      RETURNING id;
    `, [TEACHER_A]);
    const itemId = itemRes.rows[0].id;

    const verRes = await db.query(`
      INSERT INTO public.question_bank_versions (
        question_bank_item_id, version_number, prompt, question_type, created_by
      ) VALUES ($1, 1, 'Đề bảo mật', 'single_choice', $2)
      RETURNING id;
    `, [itemId, TEACHER_A]);
    const verId = verRes.rows[0].id;

    await db.query(`UPDATE public.question_bank_items SET current_version_id = $1 WHERE id = $2;`, [verId, itemId]);
    await db.query(`
      INSERT INTO app_private.question_bank_answer_keys (version_id, correct_answers)
      VALUES ($1, '{"answer": "B"}');
    `, [verId]);

    // Student thử publish -> Bị chặn
    const studentAttempt = await db.query(`
      SELECT public.rpc_qb_update_item_metadata($1, $2, $3, $4) AS res;
    `, [
      STUDENT_USER,
      'student',
      itemId,
      JSON.stringify({ status: 'published' })
    ]);
    assert.strictEqual(studentAttempt.rows[0].res.success, false);
    assert.strictEqual(studentAttempt.rows[0].res.error_code, 'UNAUTHORIZED_ROLE');

    // Teacher B thử publish câu của Teacher A -> Bị chặn
    const teacherBAttempt = await db.query(`
      SELECT public.rpc_qb_update_item_metadata($1, $2, $3, $4) AS res;
    `, [
      TEACHER_B,
      'teacher',
      itemId,
      JSON.stringify({ status: 'published' })
    ]);
    assert.strictEqual(teacherBAttempt.rows[0].res.success, false);
    assert.strictEqual(teacherBAttempt.rows[0].res.error_code, 'FORBIDDEN');

    // Admin publish -> Được phép
    const adminAttempt = await db.query(`
      SELECT public.rpc_qb_update_item_metadata($1, $2, $3, $4) AS res;
    `, [
      ADMIN_USER,
      'admin',
      itemId,
      JSON.stringify({ status: 'published', visibility: 'public_template' })
    ]);
    assert.strictEqual(adminAttempt.rows[0].res.success, true);
    assert.strictEqual(adminAttempt.rows[0].res.status, 'published');
  });

  await t.test('7. ZERO ANSWER KEY LEAKAGE: Student only reads prompt & options, zero answer key leakage', async () => {
    const db = new PGlite();
    await setupEnvironment(db);
    await setupProductionSchema(db);
    await deployCompatibleRpcs(db);

    const itemRes = await db.query(`
      INSERT INTO public.question_bank_items (
        code, title, question_type, grade_level, subject, author_id, status, visibility
      ) VALUES ('LEAK-01', 'Câu hỏi trắc nghiệm', 'single_choice', 10, 'Toán', $1, 'draft', 'private')
      RETURNING id;
    `, [TEACHER_A]);
    const itemId = itemRes.rows[0].id;

    const verRes = await db.query(`
      INSERT INTO public.question_bank_versions (
        question_bank_item_id, version_number, prompt, options, question_type, created_by
      ) VALUES ($1, 1, 'Hàm số f(x) đồng biến trên khoảng nào?', '[{"key":"A","text":"(0; 1)"},{"key":"B","text":"(1; 2)"}]'::jsonb, 'single_choice', $2)
      RETURNING id;
    `, [itemId, TEACHER_A]);
    const verId = verRes.rows[0].id;

    await db.query(`UPDATE public.question_bank_items SET current_version_id = $1 WHERE id = $2;`, [verId, itemId]);
    await db.query(`
      INSERT INTO app_private.question_bank_answer_keys (version_id, correct_answers)
      VALUES ($1, '{"answer": "A", "secret_salt": "SUPER_SECRET"}');
    `, [verId]);

    // Xuất bản câu hỏi
    await db.query(`
      SELECT public.rpc_qb_update_item_metadata($1, $2, $3, $4) AS res;
    `, [
      TEACHER_A,
      'teacher',
      itemId,
      JSON.stringify({ status: 'published', visibility: 'public_template' })
    ]);

    // Student đọc câu hỏi
    const studentRead = await db.query(`
      SELECT public.rpc_qb_get_student_question($1, $2) AS res;
    `, [STUDENT_USER, itemId]);

    const readPayload = studentRead.rows[0].res;
    assert.strictEqual(readPayload.success, true);
    assert.strictEqual(readPayload.prompt, 'Hàm số f(x) đồng biến trên khoảng nào?');
    assert.ok(readPayload.options);
    assert.strictEqual(readPayload.correct_answers, undefined);
    assert.strictEqual(readPayload.answer, undefined);
    assert.strictEqual(readPayload.secret_salt, undefined);
  });
});
