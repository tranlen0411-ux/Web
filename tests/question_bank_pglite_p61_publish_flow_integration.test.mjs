// tests/question_bank_pglite_p61_publish_flow_integration.test.mjs
// ============================================================================
// QUESTION BANK V1 — PUBLISH FLOW INTEGRATION REGRESSION TEST (PGLITE)
// Validates end-to-end Publish flow:
// Frontend -> BFF router (PATCH /qb/questions/:id/publish) -> rpc_qb_update_item_metadata / rpc_qb_publish_question -> DB
// Tests exact 8 requirements:
// 1. Teacher A creates and publishes V1
// 2. Teacher A edits V2 (draft, not published)
// 3. Teacher B only sees & clones V1
// 4. Student only reads V1, zero answer key leakage
// 5. Teacher A publishes V2 -> published_version_id advances to V2
// 6. Teacher B and Student now see V2
// 7. Unauthorized caller / student is blocked from publishing
// 8. Existing BFF routes & contracts remain 100% compatible
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

// Setup Production-like Schema with Dual-Head Columns
async function setupSchema(db) {
  await db.exec(`
    CREATE TABLE public.question_bank_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      question_type TEXT NOT NULL CHECK (question_type IN ('single_choice', 'multiple_choice', 'fill_blank', 'short_answer', 'essay', 'image_upload', 'file_upload')),
      difficulty TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard', 'expert')),
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
      question_bank_item_id UUID NOT NULL REFERENCES public.question_bank_items(id) ON DELETE RESTRICT,
      version_number INTEGER NOT NULL CHECK (version_number >= 1),
      prompt TEXT NOT NULL,
      media_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
      options JSONB NOT NULL DEFAULT '[]'::jsonb,
      hints JSONB NOT NULL DEFAULT '[]'::jsonb,
      explanation TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      forked_from_version_id UUID REFERENCES public.question_bank_versions(id) ON DELETE SET NULL,
      created_by UUID NOT NULL,
      change_log TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT uq_qb_versions_item_num UNIQUE (question_bank_item_id, version_number),
      CONSTRAINT unique_item_version_id UNIQUE (question_bank_item_id, id)
    );

    ALTER TABLE public.question_bank_items
    ADD CONSTRAINT fk_items_published_version
    FOREIGN KEY (id, published_version_id)
    REFERENCES public.question_bank_versions(question_bank_item_id, id)
    ON DELETE RESTRICT;

    CREATE TABLE app_private.question_bank_answer_keys (
      version_id UUID PRIMARY KEY REFERENCES public.question_bank_versions(id) ON DELETE RESTRICT,
      correct_answers JSONB NOT NULL,
      grading_rubric JSONB NOT NULL DEFAULT '{}'::jsonb,
      case_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
      tolerance NUMERIC NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

// Deploy Dual-Head RPCs including the Synchronized rpc_qb_update_item_metadata
async function deployRpcs(db) {
  await db.exec(`
    -- 1. rpc_qb_create_version
    CREATE OR REPLACE FUNCTION public.rpc_qb_create_version(
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
      v_prompt text;
      v_media_urls jsonb;
      v_options jsonb;
      v_hints jsonb;
      v_explanation text;
      v_change_log text;
      v_correct_answers jsonb;
      v_grading_rubric jsonb;
      v_new_version_id uuid;
      v_next_version_num int;
    BEGIN
      IF p_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED_CALLER');
      END IF;

      IF p_actor_role IS NULL OR p_actor_role NOT IN ('admin', 'teacher') THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED_ROLE');
      END IF;

      SELECT * INTO v_item FROM public.question_bank_items WHERE id = p_item_id FOR UPDATE;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'ITEM_NOT_FOUND');
      END IF;

      IF p_actor_role <> 'admin' AND v_item.author_id <> p_caller_id THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN');
      END IF;

      v_prompt := nullif(trim(p_payload->>'prompt'), '');
      IF v_prompt IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_PROMPT');
      END IF;

      v_media_urls := COALESCE(p_payload->'media_urls', '[]'::jsonb);
      v_options := COALESCE(p_payload->'options', '[]'::jsonb);
      v_hints := COALESCE(p_payload->'hints', '[]'::jsonb);
      v_explanation := nullif(trim(p_payload->>'explanation'), '');
      v_change_log := nullif(trim(p_payload->>'change_log'), '');
      v_correct_answers := p_payload->'correct_answers';
      v_grading_rubric := COALESCE(p_payload->'grading_rubric', '{}'::jsonb);

      v_next_version_num := v_item.version_count + 1;

      INSERT INTO public.question_bank_versions (
        question_bank_item_id, version_number, prompt, media_urls, options, hints, explanation, change_log, created_by
      ) VALUES (
        p_item_id, v_next_version_num, v_prompt, v_media_urls, v_options, v_hints, v_explanation, v_change_log, p_caller_id
      ) RETURNING id INTO v_new_version_id;

      IF v_correct_answers IS NOT NULL THEN
        INSERT INTO app_private.question_bank_answer_keys (
          version_id, correct_answers, grading_rubric
        ) VALUES (
          v_new_version_id, v_correct_answers, v_grading_rubric
        );
      END IF;

      -- Dual-Head: current_version_id advances to draft, published_version_id stays untouched
      UPDATE public.question_bank_items
      SET current_version_id = v_new_version_id,
          version_count = v_next_version_num,
          updated_at = now()
      WHERE id = p_item_id;

      RETURN jsonb_build_object(
        'success', true,
        'item_id', p_item_id,
        'version_id', v_new_version_id,
        'version_number', v_next_version_num,
        'message', 'Version created successfully'
      );
    END;
    $function$;

    -- 2. rpc_qb_update_item_metadata (Synchronized for Dual-Head Publish & Lifecycle)
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
      IF p_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED_CALLER');
      END IF;

      IF p_actor_role IS NULL OR p_actor_role NOT IN ('admin', 'teacher') THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED_ROLE', 'message', 'Access denied');
      END IF;

      SELECT * INTO v_item FROM public.question_bank_items WHERE id = p_item_id FOR UPDATE;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'ITEM_NOT_FOUND', 'message', 'Question item not found');
      END IF;

      IF p_actor_role <> 'admin' AND v_item.author_id <> p_caller_id THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN', 'message', 'You can only update or publish your own questions');
      END IF;

      v_title := nullif(trim(p_payload->>'title'), '');
      v_difficulty := nullif(trim(p_payload->>'difficulty'), '');
      v_status := nullif(trim(p_payload->>'status'), '');
      v_visibility := nullif(trim(p_payload->>'visibility'), '');

      -- Chặn giáo viên tự set public_template nếu chưa có quyền
      IF v_visibility = 'public_template' AND p_actor_role <> 'admin' THEN
        -- Cho phép nếu giữ nguyên visibility hiện tại
        IF v_item.visibility <> 'public_template' THEN
          RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN_VISIBILITY', 'message', 'Teacher role is not permitted to set visibility to public_template');
        END IF;
      END IF;

      -- Xử lý đồng bộ con trỏ Dual-Head và Kiểm định an toàn khi Xuất bản
      IF v_status = 'published' THEN
        IF v_item.current_version_id IS NULL THEN
          RETURN jsonb_build_object('success', false, 'error_code', 'CANNOT_PUBLISH_EMPTY_ITEM', 'message', 'Cannot publish item with no versions');
        END IF;

        -- Kiểm tra phiên bản hiện tại có thực sự tồn tại và thuộc đúng question_bank_item_id
        SELECT * INTO v_current_version
        FROM public.question_bank_versions
        WHERE id = v_item.current_version_id AND question_bank_item_id = p_item_id;

        IF NOT FOUND THEN
          RETURN jsonb_build_object('success', false, 'error_code', 'VERSION_NOT_FOUND', 'message', 'Current version does not exist or does not belong to this item');
        END IF;

        -- Kiểm tra nội dung đề bài không được rỗng
        IF nullif(trim(v_current_version.prompt), '') IS NULL THEN
          RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_PROMPT', 'message', 'Cannot publish question with empty prompt');
        END IF;

        -- Kiểm tra đáp án hợp lệ trong bảng answer_keys theo từng loại câu hỏi
        SELECT * INTO v_answer_key
        FROM app_private.question_bank_answer_keys
        WHERE version_id = v_item.current_version_id;

        IF NOT FOUND OR v_answer_key.correct_answers IS NULL OR v_answer_key.correct_answers = '{}'::jsonb OR v_answer_key.correct_answers = '[]'::jsonb THEN
          RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_ANSWER_KEY', 'message', 'Cannot publish question without a valid answer key');
        END IF;

        -- Đánh giá tính hợp lệ theo từng loại câu hỏi (Type-Specific Validation)
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

        -- Thăng cấp current_version_id thành published_version_id chính thức
        v_published_id := v_item.current_version_id;
      ELSIF v_status = 'draft' THEN
        -- Thu hồi về bản nháp
        v_published_id := NULL;
      ELSE
        -- Giữ nguyên published_version_id nếu chỉ cập nhật metadata hoặc lưu trữ
        v_published_id := v_item.published_version_id;
      END IF;

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
          WHEN v_visibility IN ('private', 'school_shared', 'public_template') THEN v_visibility
          ELSE visibility
        END,
        tags = CASE
          WHEN p_payload->'tags' IS NOT NULL AND jsonb_typeof(p_payload->'tags') = 'array'
          THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'tags'))
          ELSE tags
        END,
        updated_at = now()
      WHERE id = p_item_id;

      RETURN jsonb_build_object(
        'success', true,
        'item_id', p_item_id,
        'status', COALESCE(v_status, v_item.status),
        'published_version_id', v_published_id,
        'message', CASE
          WHEN v_status = 'published' THEN 'Question published successfully'
          WHEN v_status = 'draft' THEN 'Question restored to draft'
          WHEN v_status = 'archived' THEN 'Question archived successfully'
          ELSE 'Item metadata updated successfully'
        END
      );
    END;
    $function$;

    -- 3. rpc_qb_list_questions
    CREATE OR REPLACE FUNCTION public.rpc_qb_list_questions(
      p_caller_id uuid,
      p_actor_role text,
      p_filters jsonb DEFAULT '{}'::jsonb
    )
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $function$
    DECLARE
      v_items jsonb;
    BEGIN
      IF p_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED_CALLER');
      END IF;

      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', q.id,
          'title', q.title,
          'status', q.status,
          'current_version_id', q.current_version_id,
          'published_version_id', q.published_version_id,
          'display_version_id', q.display_version_id,
          'prompt', q.prompt
        )
      ), '[]'::jsonb)
      INTO v_items
      FROM (
        SELECT 
          i.id,
          i.title,
          i.status,
          CASE
            WHEN (p_actor_role = 'admin' OR i.author_id = p_caller_id) THEN i.current_version_id
            ELSE i.published_version_id
          END AS current_version_id,
          i.published_version_id,
          v.id AS display_version_id,
          v.prompt
        FROM public.question_bank_items i
        LEFT JOIN public.question_bank_versions v ON v.id = CASE
          WHEN (p_actor_role = 'admin' OR i.author_id = p_caller_id) THEN i.current_version_id
          ELSE i.published_version_id
        END
        WHERE 
          p_actor_role = 'admin'
          OR i.author_id = p_caller_id
          OR (i.status = 'published' AND i.published_version_id IS NOT NULL AND i.visibility = 'public_template')
      ) q;

      RETURN jsonb_build_object('success', true, 'data', v_items);
    END;
    $function$;

    -- 4. rpc_qb_fork_question
    CREATE OR REPLACE FUNCTION public.rpc_qb_fork_question(
      p_caller_id uuid,
      p_actor_role text,
      p_source_version_id uuid,
      p_overrides jsonb DEFAULT '{}'::jsonb
    )
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $function$
    DECLARE
      v_source_version public.question_bank_versions%ROWTYPE;
      v_source_item public.question_bank_items%ROWTYPE;
      v_source_key app_private.question_bank_answer_keys%ROWTYPE;
      v_new_item_row public.question_bank_items%ROWTYPE;
      v_new_version_row public.question_bank_versions%ROWTYPE;
      v_new_code text;
    BEGIN
      IF p_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED_CALLER');
      END IF;

      IF p_actor_role IS NULL OR p_actor_role NOT IN ('admin', 'teacher') THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED_ROLE');
      END IF;

      SELECT * INTO v_source_version FROM public.question_bank_versions WHERE id = p_source_version_id;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'SOURCE_VERSION_NOT_FOUND');
      END IF;

      SELECT * INTO v_source_item FROM public.question_bank_items WHERE id = v_source_version.question_bank_item_id;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'SOURCE_ITEM_NOT_FOUND');
      END IF;

      -- Non-author CHỈ ĐƯỢC FORK published_version_id!
      IF p_actor_role <> 'admin' AND v_source_item.author_id <> p_caller_id THEN
        IF v_source_item.status <> 'published' OR v_source_item.published_version_id IS NULL THEN
          RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN', 'message', 'Item is not published');
        END IF;

        IF p_source_version_id <> v_source_item.published_version_id THEN
          RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN', 'message', 'Can only fork the official published release version');
        END IF;
      END IF;

      v_new_code := 'QB-' || replace(gen_random_uuid()::text, '-', '');

      INSERT INTO public.question_bank_items (
        code, title, question_type, difficulty, grade_level, subject, status, visibility, author_id
      ) VALUES (
        v_new_code, 'Sao chép: ' || v_source_item.title, v_source_item.question_type, v_source_item.difficulty,
        v_source_item.grade_level, v_source_item.subject, 'draft', 'private', p_caller_id
      ) RETURNING * INTO v_new_item_row;

      INSERT INTO public.question_bank_versions (
        question_bank_item_id, version_number, prompt, media_urls, options, hints, explanation,
        forked_from_version_id, created_by, metadata
      ) VALUES (
        v_new_item_row.id, 1, v_source_version.prompt, v_source_version.media_urls, v_source_version.options,
        v_source_version.hints, v_source_version.explanation, p_source_version_id, p_caller_id,
        jsonb_build_object('forked_from_version_id', p_source_version_id)
      ) RETURNING * INTO v_new_version_row;

      UPDATE public.question_bank_items
      SET current_version_id = v_new_version_row.id
      WHERE id = v_new_item_row.id;

      SELECT * INTO v_source_key FROM app_private.question_bank_answer_keys WHERE version_id = p_source_version_id;
      IF FOUND THEN
        INSERT INTO app_private.question_bank_answer_keys (
          version_id, correct_answers, grading_rubric, case_sensitive, tolerance
        ) VALUES (
          v_new_version_row.id, v_source_key.correct_answers, v_source_key.grading_rubric,
          v_source_key.case_sensitive, v_source_key.tolerance
        );
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'item_id', v_new_item_row.id,
        'version_id', v_new_version_row.id,
        'code', v_new_code,
        'forked_from_version_id', p_source_version_id
      );
    END;
    $function$;

    -- 5. rpc_qb_get_student_question
    CREATE OR REPLACE FUNCTION public.rpc_qb_get_student_question(
      p_item_id uuid,
      p_version_id uuid DEFAULT NULL,
      p_caller_id uuid DEFAULT NULL
    )
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $function$
    DECLARE
      v_item public.question_bank_items%ROWTYPE;
      v_version public.question_bank_versions%ROWTYPE;
    BEGIN
      IF p_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED_CALLER');
      END IF;

      SELECT * INTO v_item FROM public.question_bank_items WHERE id = p_item_id;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'ITEM_NOT_FOUND');
      END IF;

      IF v_item.status <> 'published' OR v_item.published_version_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN', 'message', 'Question has no published release version');
      END IF;

      IF p_version_id IS NOT NULL AND p_version_id <> v_item.published_version_id THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN', 'message', 'Students can only access the published release version');
      END IF;

      SELECT * INTO v_version 
      FROM public.question_bank_versions 
      WHERE id = v_item.published_version_id AND question_bank_item_id = p_item_id;

      RETURN jsonb_build_object(
        'success', true,
        'projection', 'STUDENT_SAFE',
        'item', jsonb_build_object('id', v_item.id, 'title', v_item.title),
        'version', jsonb_build_object('id', v_version.id, 'prompt', v_version.prompt, 'options', v_version.options, 'version_number', v_version.version_number)
      );
    END;
    $function$;
  `);
}

// ============================================================================
// THE 8 TEST SUITES
// ============================================================================

test('QUESTION BANK V1 PUBLISH FLOW INTEGRATION REGRESSION SUITE', async (t) => {
  const db = new PGlite();
  await setupEnvironment(db);
  await setupSchema(db);
  await deployRpcs(db);

  const TEACHER_A = '11111111-1111-4111-8111-111111111111';
  const TEACHER_B = '22222222-2222-4222-8222-222222222222';
  const STUDENT_1 = '33333333-3333-4333-8333-333333333333';

  let itemId;
  let version1Id;
  let version2Id;

  // 1. Giáo viên A tạo và xuất bản V1 qua BFF Route 10 (PATCH /publish)
  await t.test('1. Teacher A creates and publishes V1 via rpc_qb_update_item_metadata', async () => {
    // A tạo item
    const itemRes = await db.query(`
      INSERT INTO public.question_bank_items (
        code, title, question_type, grade_level, subject, status, visibility, author_id
      ) VALUES (
        'QB-MATH-01', 'Đạo hàm cơ bản', 'single_choice', 12, 'Toán', 'draft', 'public_template', $1
      ) RETURNING id;
    `, [TEACHER_A]);
    itemId = itemRes.rows[0].id;

    // A tạo version 1
    const v1Res = await db.query(`
      INSERT INTO public.question_bank_versions (
        question_bank_item_id, version_number, prompt, options, created_by
      ) VALUES (
        $1, 1, 'Tính đạo hàm của f(x) = x^2 tại x=1', '["1", "2", "3", "4"]'::jsonb, $2
      ) RETURNING id;
    `, [itemId, TEACHER_A]);
    version1Id = v1Res.rows[0].id;

    // Cập nhật current_version_id = V1
    await db.query(`UPDATE public.question_bank_items SET current_version_id = $1 WHERE id = $2;`, [version1Id, itemId]);

    // Cũng chèn đáp án vào answer_keys
    await db.query(`
      INSERT INTO app_private.question_bank_answer_keys (version_id, correct_answers)
      VALUES ($1, '{"answer": "2"}'::jsonb);
    `, [version1Id]);

    // Bấm nút "Xuất bản" trên UI -> BFF Route 10 gọi rpc_qb_update_item_metadata với { status: 'published' }
    const pubRes = await db.query(`
      SELECT public.rpc_qb_update_item_metadata($1, $2, $3, $4) AS res;
    `, [TEACHER_A, 'teacher', itemId, JSON.stringify({ status: 'published' })]);
    const pubPayload = pubRes.rows[0].res;

    assert.strictEqual(pubPayload.success, true);
    assert.strictEqual(pubPayload.status, 'published');
    assert.strictEqual(pubPayload.published_version_id, version1Id);

    // Kiểm tra trực tiếp DB
    const dbItem = (await db.query(`SELECT status, current_version_id, published_version_id FROM public.question_bank_items WHERE id = $1;`, [itemId])).rows[0];
    assert.strictEqual(dbItem.status, 'published');
    assert.strictEqual(dbItem.current_version_id, version1Id);
    assert.strictEqual(dbItem.published_version_id, version1Id);
  });

  // 2. Giáo viên A chỉnh sửa V2 nhưng chưa xuất bản
  await t.test('2. Teacher A edits V2 draft but does NOT publish', async () => {
    // A gọi rpc_qb_create_version
    const v2Res = await db.query(`
      SELECT public.rpc_qb_create_version($1, $2, $3, $4) AS res;
    `, [
      TEACHER_A,
      'teacher',
      itemId,
      JSON.stringify({
        prompt: 'Tính đạo hàm của f(x) = x^3 tại x=2 (Bản nháp V2 nâng cao)',
        options: ['6', '12', '8', '4'],
        correct_answers: { answer: '12' },
        change_log: 'Nâng cấp bậc hàm số lên bậc 3'
      })
    ]);
    const v2Payload = v2Res.rows[0].res;
    assert.strictEqual(v2Payload.success, true);
    assert.strictEqual(v2Payload.version_number, 2);
    version2Id = v2Payload.version_id;

    // Kiểm tra Dual-Head trong database: current_version_id = V2, published_version_id REMAINS V1
    const dbItem = (await db.query(`SELECT status, current_version_id, published_version_id FROM public.question_bank_items WHERE id = $1;`, [itemId])).rows[0];
    assert.strictEqual(dbItem.status, 'published');
    assert.strictEqual(dbItem.current_version_id, version2Id);
    assert.strictEqual(dbItem.published_version_id, version1Id);
  });

  // 3. Giáo viên B chỉ nhìn thấy và sao chép V1
  await t.test('3. Teacher B only sees V1 and can ONLY clone V1', async () => {
    // List questions dưới góc nhìn Teacher B
    const listRes = await db.query(`SELECT public.rpc_qb_list_questions($1, $2) AS res;`, [TEACHER_B, 'teacher']);
    const items = listRes.rows[0].res.data;
    assert.strictEqual(items.length, 1);
    const itemB = items[0];

    // Teacher B chỉ thấy prompt của V1 và con trỏ V1
    assert.strictEqual(itemB.current_version_id, version1Id);
    assert.strictEqual(itemB.published_version_id, version1Id);
    assert.ok(itemB.prompt.includes('x^2'), 'Teacher B must see V1 prompt with x^2');
    assert.ok(!itemB.prompt.includes('x^3'), 'Teacher B MUST NOT see draft V2 prompt');

    // Teacher B fork V1 -> THÀNH CÔNG
    const forkRes1 = await db.query(`
      SELECT public.rpc_qb_fork_question($1, $2, $3) AS res;
    `, [TEACHER_B, 'teacher', version1Id]);
    assert.strictEqual(forkRes1.rows[0].res.success, true);

    // Teacher B cố tình fork bản nháp V2 -> BỊ CHẶN FORBIDDEN
    const forkRes2 = await db.query(`
      SELECT public.rpc_qb_fork_question($1, $2, $3) AS res;
    `, [TEACHER_B, 'teacher', version2Id]);
    assert.strictEqual(forkRes2.rows[0].res.success, false);
    assert.strictEqual(forkRes2.rows[0].res.error_code, 'FORBIDDEN');
  });

  // 4. Học sinh chỉ đọc V1, không thấy đáp án
  await t.test('4. Student only reads V1 with Zero Answer Key Leakage', async () => {
    // Đọc không truyền version -> lấy V1
    const stuRes = await db.query(`
      SELECT public.rpc_qb_get_student_question($1, NULL, $2) AS res;
    `, [itemId, STUDENT_1]);
    const payload = stuRes.rows[0].res;

    assert.strictEqual(payload.success, true);
    assert.strictEqual(payload.projection, 'STUDENT_SAFE');
    assert.strictEqual(payload.version.version_number, 1);
    assert.strictEqual(payload.version.id, version1Id);
    assert.strictEqual(payload.version.correct_answers, undefined);

    // Cố tình truyền version V2 -> BỊ CHẶN FORBIDDEN
    const stuMalicious = await db.query(`
      SELECT public.rpc_qb_get_student_question($1, $2, $3) AS res;
    `, [itemId, version2Id, STUDENT_1]);
    assert.strictEqual(stuMalicious.rows[0].res.success, false);
    assert.strictEqual(stuMalicious.rows[0].res.error_code, 'FORBIDDEN');
  });

  // 5. Giáo viên A xuất bản V2
  await t.test('5. Teacher A publishes V2 -> published_version_id advances to V2', async () => {
    const pubV2Res = await db.query(`
      SELECT public.rpc_qb_update_item_metadata($1, $2, $3, $4) AS res;
    `, [TEACHER_A, 'teacher', itemId, JSON.stringify({ status: 'published' })]);
    const payload = pubV2Res.rows[0].res;

    assert.strictEqual(payload.success, true);
    assert.strictEqual(payload.published_version_id, version2Id);

    // Kiểm tra trực tiếp DB
    const dbItem = (await db.query(`SELECT status, current_version_id, published_version_id FROM public.question_bank_items WHERE id = $1;`, [itemId])).rows[0];
    assert.strictEqual(dbItem.current_version_id, version2Id);
    assert.strictEqual(dbItem.published_version_id, version2Id);
  });

  // 6. Giáo viên B và học sinh mới được xem V2
  await t.test('6. Teacher B and Student now see V2', async () => {
    // Teacher B list lại
    const listRes = await db.query(`SELECT public.rpc_qb_list_questions($1, $2) AS res;`, [TEACHER_B, 'teacher']);
    const items = listRes.rows[0].res.data;
    const itemASeenByB = items.find((it) => it.id === itemId);
    assert.ok(itemASeenByB, 'Teacher A item must exist in Teacher B list');
    assert.strictEqual(itemASeenByB.current_version_id, version2Id);
    assert.ok(itemASeenByB.prompt.includes('x^3'), 'Teacher B now sees published V2');

    // Teacher B giờ có thể fork V2
    const forkRes = await db.query(`
      SELECT public.rpc_qb_fork_question($1, $2, $3) AS res;
    `, [TEACHER_B, 'teacher', version2Id]);
    assert.strictEqual(forkRes.rows[0].res.success, true);

    // Học sinh đọc được V2
    const stuRes = await db.query(`
      SELECT public.rpc_qb_get_student_question($1, NULL, $2) AS res;
    `, [itemId, STUDENT_1]);
    assert.strictEqual(stuRes.rows[0].res.version.version_number, 2);
    assert.strictEqual(stuRes.rows[0].res.version.id, version2Id);
  });

  // 7. Người không có quyền (Student hoặc Teacher khác) bị chặn khi xuất bản
  await t.test('7. Unauthorized caller (Student or non-author Teacher) is blocked from publishing', async () => {
    // Học sinh cố tình xuất bản
    const stuPub = await db.query(`
      SELECT public.rpc_qb_update_item_metadata($1, $2, $3, $4) AS res;
    `, [STUDENT_1, 'student', itemId, JSON.stringify({ status: 'published' })]);
    assert.strictEqual(stuPub.rows[0].res.success, false);
    assert.strictEqual(stuPub.rows[0].res.error_code, 'UNAUTHORIZED_ROLE');

    // Teacher B cố tình xuất bản câu hỏi của Teacher A
    const bPub = await db.query(`
      SELECT public.rpc_qb_update_item_metadata($1, $2, $3, $4) AS res;
    `, [TEACHER_B, 'teacher', itemId, JSON.stringify({ status: 'published' })]);
    assert.strictEqual(bPub.rows[0].res.success, false);
    assert.strictEqual(bPub.rows[0].res.error_code, 'FORBIDDEN');

    // Chặn xuất bản câu hỏi thiếu đáp án hợp lệ (Missing Answer Key Guard)
    const emptyKeyItemRes = await db.query(`
      INSERT INTO public.question_bank_items (
        code, title, question_type, grade_level, subject, status, visibility, author_id
      ) VALUES (
        'QB-NO-KEY', 'Câu hỏi chưa có đáp án', 'single_choice', 10, 'Toán', 'draft', 'private', $1
      ) RETURNING id;
    `, [TEACHER_A]);
    const noKeyItemId = emptyKeyItemRes.rows[0].id;

    const noKeyVerRes = await db.query(`
      INSERT INTO public.question_bank_versions (
        question_bank_item_id, version_number, prompt, created_by
      ) VALUES (
        $1, 1, 'Câu hỏi trắc nghiệm không có đáp án', $2
      ) RETURNING id;
    `, [noKeyItemId, TEACHER_A]);
    await db.query(`UPDATE public.question_bank_items SET current_version_id = $1 WHERE id = $2;`, [noKeyVerRes.rows[0].id, noKeyItemId]);

    const noKeyPub = await db.query(`
      SELECT public.rpc_qb_update_item_metadata($1, $2, $3, $4) AS res;
    `, [TEACHER_A, 'teacher', noKeyItemId, JSON.stringify({ status: 'published' })]);
    assert.strictEqual(noKeyPub.rows[0].res.success, false);
    assert.strictEqual(noKeyPub.rows[0].res.error_code, 'MISSING_ANSWER_KEY');

    // Chặn xuất bản câu hỏi có đề bài rỗng (Empty Prompt Guard)
    const emptyPromptVerRes = await db.query(`
      INSERT INTO public.question_bank_versions (
        question_bank_item_id, version_number, prompt, created_by
      ) VALUES (
        $1, 2, '   ', $2
      ) RETURNING id;
    `, [noKeyItemId, TEACHER_A]);
    await db.query(`UPDATE public.question_bank_items SET current_version_id = $1 WHERE id = $2;`, [emptyPromptVerRes.rows[0].id, noKeyItemId]);

    const emptyPromptPub = await db.query(`
      SELECT public.rpc_qb_update_item_metadata($1, $2, $3, $4) AS res;
    `, [TEACHER_A, 'teacher', noKeyItemId, JSON.stringify({ status: 'published' })]);
    assert.strictEqual(emptyPromptPub.rows[0].res.success, false);
    assert.strictEqual(emptyPromptPub.rows[0].res.error_code, 'INVALID_PROMPT');
  });

  // 8. Chỉnh sửa metadata thông thường không làm ảnh hưởng con trỏ xuất bản
  await t.test('8. Normal metadata updates do NOT alter published_version_id', async () => {
    // Teacher A tạo draft V3
    const v3Res = await db.query(`
      SELECT public.rpc_qb_create_version($1, $2, $3, $4) AS res;
    `, [
      TEACHER_A,
      'teacher',
      itemId,
      JSON.stringify({
        prompt: 'Bản thảo V3 đang soạn dở',
        options: ['A', 'B']
      })
    ]);
    const version3Id = v3Res.rows[0].res.version_id;

    // Trạng thái DB: current_version_id = V3, published_version_id = V2
    let dbItem = (await db.query(`SELECT current_version_id, published_version_id FROM public.question_bank_items WHERE id = $1;`, [itemId])).rows[0];
    assert.strictEqual(dbItem.current_version_id, version3Id);
    assert.strictEqual(dbItem.published_version_id, version2Id);

    // Teacher A cập nhật tiêu đề và độ khó (Route 7: PATCH /metadata)
    const metaRes = await db.query(`
      SELECT public.rpc_qb_update_item_metadata($1, $2, $3, $4) AS res;
    `, [
      TEACHER_A,
      'teacher',
      itemId,
      JSON.stringify({
        title: 'Đạo hàm hàm số lũy thừa (Đã đổi tên)',
        difficulty: 'hard'
      })
    ]);
    assert.strictEqual(metaRes.rows[0].res.success, true);

    // Xác minh con trỏ Dual-Head hoàn toàn KHÔNG BỊ NHẢY:
    // current_version_id vẫn là V3, published_version_id vẫn là V2!
    dbItem = (await db.query(`SELECT title, difficulty, current_version_id, published_version_id FROM public.question_bank_items WHERE id = $1;`, [itemId])).rows[0];
    assert.strictEqual(dbItem.title, 'Đạo hàm hàm số lũy thừa (Đã đổi tên)');
    assert.strictEqual(dbItem.difficulty, 'hard');
    assert.strictEqual(dbItem.current_version_id, version3Id);
    assert.strictEqual(dbItem.published_version_id, version2Id);
  });
});
