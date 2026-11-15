-- tests/candidate_unified_dual_head_release_v1_p70q.sql
-- ============================================================================
-- CANDIDATE UNIFIED MIGRATION: QUESTION BANK V1 DUAL-HEAD RELEASE (P70Q)
-- Synthesized from:
--   1. P70O Dual-Head Foundation (DDL, Constraints, Backfill Gate, Timeouts)
--   2. P70P Forward Recovery (Strict Fail-Closed, Zero Draft Leakage Isolation)
--   3. P70Q-2D Publish Concurrency Guard (Strict expected_version_id, 5-Param RPC)
-- Target Database: Exam Builder Production (szptvqkoiphrhlionfoh)
-- Policy: Single Atomic Transaction, ON DELETE RESTRICT, Zero Exposure Window
-- Audit Status: P70Q Candidate Release Packaging (Controlled Local Draft)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. TIMEOUT HARDENING & FAIL-CLOSED SAFETY GATES
-- ----------------------------------------------------------------------------
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '3s' THEN
    RAISE EXCEPTION 'SAFETY GATE FAILED: lock_timeout was not set to 3s (actual: %)', current_setting('lock_timeout');
  END IF;
  IF current_setting('statement_timeout') <> '15s' THEN
    RAISE EXCEPTION 'SAFETY GATE FAILED: statement_timeout was not set to 15s (actual: %)', current_setting('statement_timeout');
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. DDL SCHEMA ENHANCEMENTS
-- ----------------------------------------------------------------------------

-- 1.1 Khắc phục lỗi SQLSTATE 42830 bằng Unique Constraint trên bảng versions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_item_version_id'
  ) THEN
    ALTER TABLE public.question_bank_versions
      ADD CONSTRAINT unique_item_version_id UNIQUE (question_bank_item_id, id);
  END IF;
END $$;

-- 1.2 Thêm cột con trỏ phiên bản công bố (Published Release Head)
ALTER TABLE public.question_bank_items
  ADD COLUMN IF NOT EXISTS published_version_id UUID NULL;

-- 1.3 Tạo Composite Foreign Key bảo vệ tính toàn vẹn cùng-item với ON DELETE RESTRICT
-- (Ngăn chặn lỗi SQLSTATE 23502 và bảo vệ lịch sử thi cử bất biến)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_items_published_version'
  ) THEN
    ALTER TABLE public.question_bank_items
      ADD CONSTRAINT fk_items_published_version
      FOREIGN KEY (id, published_version_id)
      REFERENCES public.question_bank_versions(question_bank_item_id, id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- 1.4 Hàng rào an toàn cho Backfill: Dừng ngay nếu phát hiện câu hỏi published có nhiều version mơ hồ
DO $$
DECLARE
  v_ambiguous_count integer;
BEGIN
  SELECT COUNT(*) INTO v_ambiguous_count
  FROM public.question_bank_items i
  JOIN (
    SELECT question_bank_item_id, COUNT(*) as cnt
    FROM public.question_bank_versions
    GROUP BY question_bank_item_id
  ) v ON v.question_bank_item_id = i.id
  WHERE i.status = 'published' AND v.cnt > 1 AND i.published_version_id IS NULL;

  IF v_ambiguous_count > 0 THEN
    RAISE EXCEPTION 'MIGRATION_HALTED: Phát hiện % câu hỏi published có nhiều hơn 1 phiên bản chưa xác định được bản công bố. Cần kiểm tra thủ công trước khi backfill.', v_ambiguous_count;
  END IF;
END $$;

-- 1.5 Backfill an toàn tuyệt đối cho các câu hỏi đang published có đúng 1 version
UPDATE public.question_bank_items i
SET published_version_id = i.current_version_id
FROM (
  SELECT question_bank_item_id, COUNT(*) as cnt
  FROM public.question_bank_versions
  GROUP BY question_bank_item_id
) v
WHERE i.id = v.question_bank_item_id
  AND i.status = 'published'
  AND v.cnt = 1
  AND i.published_version_id IS NULL;

-- 1.6 Ràng buộc bảo vệ trạng thái: Draft tuyệt đối không có published_version_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_draft_no_published_version'
  ) THEN
    ALTER TABLE public.question_bank_items
      ADD CONSTRAINT chk_draft_no_published_version
      CHECK (status <> 'draft' OR published_version_id IS NULL);
  END IF;
END $$;

-- 1.7 Tạo Index tối ưu hóa truy vấn cho danh sách câu hỏi xuất bản
CREATE INDEX IF NOT EXISTS idx_qb_items_published_version 
ON public.question_bank_items(published_version_id) 
WHERE published_version_id IS NOT NULL;



-- ----------------------------------------------------------------------------
-- 2. FULL 6-RPC SUITE (DUAL-HEAD + ZERO DRAFT LEAKAGE + CONCURRENCY GUARD)
-- ----------------------------------------------------------------------------

-- 2.1 RPC: rpc_qb_create_version
-- Dual-Head: Chỉ cập nhật con trỏ soạn thảo current_version_id, bảo tồn con trỏ xuất bản published_version_id
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
  v_next_version_number integer;
  v_new_version_id uuid;
  v_prompt text;
  v_media_urls jsonb;
  v_options jsonb;
  v_hints jsonb;
  v_explanation text;
  v_metadata jsonb;
  v_answer_key jsonb;
  v_change_log text;
BEGIN
  IF p_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED_CALLER', 'message', 'Caller ID is required');
  END IF;

  IF p_actor_role IS NULL OR p_actor_role NOT IN ('admin', 'teacher') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED_ROLE', 'message', 'Access denied');
  END IF;

  SELECT * INTO v_item 
  FROM public.question_bank_items 
  WHERE id = p_item_id 
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ITEM_NOT_FOUND', 'message', 'Question item not found');
  END IF;

  IF p_actor_role <> 'admin' AND v_item.author_id <> p_caller_id THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN', 'message', 'You can only create versions for your own questions');
  END IF;

  v_prompt := nullif(trim(p_payload->>'prompt'), '');
  IF v_prompt IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_PROMPT', 'message', 'Prompt is required');
  END IF;

  v_media_urls := COALESCE(p_payload->'media_urls', '[]'::jsonb);
  v_options := COALESCE(p_payload->'options', '[]'::jsonb);
  v_hints := COALESCE(p_payload->'hints', '[]'::jsonb);
  v_explanation := nullif(trim(p_payload->>'explanation'), '');
  v_metadata := COALESCE(p_payload->'metadata', '{}'::jsonb);
  v_change_log := nullif(trim(p_payload->>'change_log'), '');

  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next_version_number
  FROM public.question_bank_versions
  WHERE question_bank_item_id = p_item_id;

  INSERT INTO public.question_bank_versions (
    question_bank_item_id,
    version_number,
    prompt,
    media_urls,
    options,
    hints,
    explanation,
    metadata,
    created_by,
    change_log,
    created_at
  ) VALUES (
    p_item_id,
    v_next_version_number,
    v_prompt,
    v_media_urls,
    v_options,
    v_hints,
    v_explanation,
    v_metadata,
    p_caller_id,
    v_change_log,
    now()
  ) RETURNING id INTO v_new_version_id;

  v_answer_key := p_payload->'answer_key';
  IF v_answer_key IS NOT NULL AND v_answer_key <> 'null'::jsonb AND v_answer_key <> '{}'::jsonb THEN
    INSERT INTO app_private.question_bank_answer_keys (
      version_id,
      correct_answers,
      grading_rubric,
      case_sensitive,
      tolerance,
      created_at
    ) VALUES (
      v_new_version_id,
      COALESCE(v_answer_key->'correct_answers', v_answer_key),
      COALESCE(v_answer_key->'grading_rubric', '{}'::jsonb),
      COALESCE((v_answer_key->>'case_sensitive')::boolean, false),
      COALESCE((v_answer_key->>'tolerance')::numeric, 0),
      now()
    );
  END IF;

  -- Dual-Head: Chỉ cập nhật con trỏ soạn thảo current_version_id, bảo tồn con trỏ xuất bản published_version_id
  UPDATE public.question_bank_items
  SET 
    current_version_id = v_new_version_id,
    version_count = v_next_version_number,
    updated_at = now()
  WHERE id = p_item_id;

  RETURN jsonb_build_object(
    'success', true,
    'item_id', p_item_id,
    'version_id', v_new_version_id,
    'version_number', v_next_version_number,
    'current_version_id', v_new_version_id,
    'published_version_id', v_item.published_version_id,
    'message', 'New version created successfully'
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'DATABASE_ERROR',
      'message', 'An internal database error occurred while creating a new version'
    );
END;
$function$;

-- 2.2 RPC: rpc_qb_list_questions
-- Strict Fail-Closed & Zero Draft Leakage: Người ngoài CHỈ nhận bản xuất bản, bảo vệ bản nháp
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
  v_page integer;
  v_page_size integer;
  v_offset integer;
  v_total_count integer;
  v_subject text;
  v_grade_level integer;
  v_status text;
  v_visibility text;
  v_search text;
  v_items jsonb;
BEGIN
  IF p_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED_CALLER', 'message', 'Caller ID is required');
  END IF;

  IF p_actor_role IS NULL OR p_actor_role NOT IN ('admin', 'teacher', 'student') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED_ROLE', 'message', 'Access denied');
  END IF;

  v_page := GREATEST(COALESCE((p_filters->>'page')::integer, 1), 1);
  v_page_size := LEAST(GREATEST(COALESCE((p_filters->>'page_size')::integer, 20), 1), 100);
  v_offset := (v_page - 1) * v_page_size;

  v_subject := nullif(trim(p_filters->>'subject'), '');
  v_grade_level := (p_filters->>'grade_level')::integer;
  v_status := nullif(trim(p_filters->>'status'), '');
  v_visibility := nullif(trim(p_filters->>'visibility'), '');
  v_search := nullif(trim(p_filters->>'search'), '');

  -- Đếm tổng số: Người ngoài BẮT BUỘC phải có status = 'published' AND published_version_id IS NOT NULL
  SELECT count(*) INTO v_total_count
  FROM public.question_bank_items item
  WHERE (
    p_actor_role = 'admin'
    OR item.author_id = p_caller_id
    OR (
      item.status = 'published'
      AND item.published_version_id IS NOT NULL
      AND (
        item.visibility = 'public_template'
        OR (item.visibility = 'school_shared' AND item.school_id IS NOT NULL)
      )
    )
  )
  AND (v_subject IS NULL OR item.subject = v_subject)
  AND (v_grade_level IS NULL OR item.grade_level = v_grade_level)
  AND (v_status IS NULL OR item.status = v_status)
  AND (
    v_visibility IS NULL 
    OR item.visibility = v_visibility
    OR (v_visibility = 'public' AND item.visibility = 'public_template')
    OR (v_visibility = 'school' AND item.visibility = 'school_shared')
  )
  AND (v_search IS NULL OR item.title ILIKE '%' || v_search || '%');

  SELECT COALESCE(jsonb_agg(item_record), '[]'::jsonb) INTO v_items
  FROM (
    SELECT 
      item.id,
      item.code,
      item.title,
      item.question_type,
      item.subject,
      item.grade_level,
      item.difficulty,
      item.status,
      item.visibility,
      item.school_id,
      item.author_id,
      item.current_version_id,
      item.published_version_id,
      item.version_count,
      item.tags,
      item.created_at,
      item.updated_at,
      -- STRICT FAIL-CLOSED: Người ngoài CHỈ nhận published_version_id (tuyệt đối KHÔNG fallback sang current_version_id)
      CASE 
        WHEN p_actor_role = 'admin' OR item.author_id = p_caller_id THEN item.current_version_id
        ELSE item.published_version_id
      END AS display_version_id,
      CASE 
        WHEN p_actor_role = 'admin' OR item.author_id = p_caller_id THEN v_cur.prompt
        ELSE v_pub.prompt
      END AS prompt,
      CASE 
        WHEN p_actor_role = 'admin' OR item.author_id = p_caller_id THEN v_cur.media_urls
        ELSE v_pub.media_urls
      END AS media_urls,
      CASE 
        WHEN p_actor_role = 'admin' OR item.author_id = p_caller_id THEN v_cur.options
        ELSE v_pub.options
      END AS options,
      CASE 
        WHEN p_actor_role = 'admin' OR item.author_id = p_caller_id THEN v_cur.hints
        ELSE v_pub.hints
      END AS hints,
      CASE 
        WHEN p_actor_role = 'admin' OR item.author_id = p_caller_id THEN v_cur.explanation
        ELSE v_pub.explanation
      END AS explanation,
      CASE 
        WHEN v_cur.forked_from_version_id IS NOT NULL 
             OR (item.tags IS NOT NULL AND 'clone' = ANY(item.tags))
             OR (item.title ILIKE '%(Bản sao)%') THEN true
        ELSE false
      END AS is_clone,
      CASE 
        WHEN v_cur.forked_from_version_id IS NOT NULL 
             OR (item.tags IS NOT NULL AND 'clone' = ANY(item.tags))
             OR (item.title ILIKE '%(Bản sao)%') THEN 'clone'
        ELSE 'original'
      END AS origin_status,
      v_cur.forked_from_version_id AS forked_from_version_id
    FROM public.question_bank_items item
    LEFT JOIN public.question_bank_versions v_cur 
      ON v_cur.id = item.current_version_id AND v_cur.question_bank_item_id = item.id
    LEFT JOIN public.question_bank_versions v_pub 
      ON v_pub.id = item.published_version_id AND v_pub.question_bank_item_id = item.id
    WHERE (
      p_actor_role = 'admin'
      OR item.author_id = p_caller_id
      OR (
        item.status = 'published'
        AND item.published_version_id IS NOT NULL
        AND (
          item.visibility = 'public_template'
          OR (item.visibility = 'school_shared' AND item.school_id IS NOT NULL)
        )
      )
    )
    AND (v_subject IS NULL OR item.subject = v_subject)
    AND (v_grade_level IS NULL OR item.grade_level = v_grade_level)
    AND (v_status IS NULL OR item.status = v_status)
    AND (
      v_visibility IS NULL 
      OR item.visibility = v_visibility
      OR (v_visibility = 'public' AND item.visibility = 'public_template')
      OR (v_visibility = 'school' AND item.visibility = 'school_shared')
    )
    AND (v_search IS NULL OR item.title ILIKE '%' || v_search || '%')
    ORDER BY item.created_at DESC
    LIMIT v_page_size
    OFFSET v_offset
  ) item_record;

  RETURN jsonb_build_object(
    'success', true,
    'items', v_items,
    'total', v_total_count,
    'page', v_page,
    'page_size', v_page_size
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'DATABASE_ERROR',
      'message', 'An internal database error occurred while listing questions'
    );
END;
$function$;

-- 2.3 RPC: rpc_qb_fork_question
-- Strict Fail-Closed: Người ngoài CHỈ được sao chép bản công bố chính thức
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
  v_src_version public.question_bank_versions%ROWTYPE;
  v_src_item public.question_bank_items%ROWTYPE;
  v_src_answer_key app_private.question_bank_answer_keys%ROWTYPE;
  v_new_item_id uuid;
  v_new_version_id uuid;
  v_new_code text;
  v_new_title text;
  v_prefix text;
BEGIN
  IF p_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED_CALLER', 'message', 'Caller ID is required');
  END IF;

  IF p_actor_role IS NULL OR p_actor_role NOT IN ('admin', 'teacher') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED_ROLE', 'message', 'Access denied');
  END IF;

  SELECT * INTO v_src_version 
  FROM public.question_bank_versions 
  WHERE id = p_source_version_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VERSION_NOT_FOUND', 'message', 'Source question version not found');
  END IF;

  SELECT * INTO v_src_item 
  FROM public.question_bank_items 
  WHERE id = v_src_version.question_bank_item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ITEM_NOT_FOUND', 'message', 'Source question item not found');
  END IF;

  -- STRICT FAIL-CLOSED: Người ngoài BẮT BUỘC item phải published, published_version_id KHÔNG NULL và ĐÚNG BẰNG p_source_version_id
  IF p_actor_role <> 'admin' AND v_src_item.author_id <> p_caller_id THEN
    IF v_src_item.status <> 'published' 
       OR v_src_item.published_version_id IS NULL 
       OR v_src_item.published_version_id <> p_source_version_id THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN', 'message', 'You can only fork published official versions');
    END IF;

    IF v_src_item.visibility = 'private' THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN', 'message', 'Cannot fork private question');
    END IF;
  END IF;

  v_prefix := 'QB-' || to_char(now(), 'YYMMDD') || '-';
  v_new_code := v_prefix || upper(substr(md5(gen_random_uuid()::text), 1, 6));

  v_new_title := COALESCE(
    nullif(trim(p_overrides->>'title'), ''),
    v_src_item.title || ' (Bản sao)'
  );

  INSERT INTO public.question_bank_items (
    code,
    title,
    question_type,
    subject,
    grade_level,
    difficulty,
    status,
    visibility,
    school_id,
    author_id,
    version_count,
    tags,
    created_at,
    updated_at
  ) VALUES (
    v_new_code,
    v_new_title,
    v_src_item.question_type,
    v_src_item.subject,
    v_src_item.grade_level,
    COALESCE(nullif(trim(p_overrides->>'difficulty'), ''), v_src_item.difficulty),
    'draft',
    'private',
    v_src_item.school_id,
    p_caller_id,
    1,
    ARRAY['clone']::text[],
    now(),
    now()
  ) RETURNING id INTO v_new_item_id;

  INSERT INTO public.question_bank_versions (
    question_bank_item_id,
    version_number,
    prompt,
    media_urls,
    options,
    hints,
    explanation,
    metadata,
    forked_from_version_id,
    created_by,
    created_at
  ) VALUES (
    v_new_item_id,
    1,
    v_src_version.prompt,
    v_src_version.media_urls,
    v_src_version.options,
    v_src_version.hints,
    v_src_version.explanation,
    jsonb_build_object('forked_from_item_id', v_src_item.id, 'forked_from_version_id', p_source_version_id),
    p_source_version_id,
    p_caller_id,
    now()
  ) RETURNING id INTO v_new_version_id;

  UPDATE public.question_bank_items
  SET current_version_id = v_new_version_id
  WHERE id = v_new_item_id;

  SELECT * INTO v_src_answer_key 
  FROM app_private.question_bank_answer_keys 
  WHERE version_id = p_source_version_id;

  IF FOUND THEN
    INSERT INTO app_private.question_bank_answer_keys (
      version_id,
      correct_answers,
      grading_rubric,
      case_sensitive,
      tolerance,
      created_at
    ) VALUES (
      v_new_version_id,
      v_src_answer_key.correct_answers,
      v_src_answer_key.grading_rubric,
      v_src_answer_key.case_sensitive,
      v_src_answer_key.tolerance,
      now()
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'item_id', v_new_item_id,
    'version_id', v_new_version_id,
    'code', v_new_code,
    'forked_from_version_id', p_source_version_id,
    'message', 'Question forked successfully'
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'DATABASE_ERROR',
      'message', 'An internal database error occurred while forking question'
    );
END;
$function$;

-- 2.4 RPC: rpc_qb_get_student_question
-- Strict Fail-Closed: Học sinh CHỈ được đọc bản công bố, triệt tiêu đáp án và giải thích
CREATE OR REPLACE FUNCTION public.rpc_qb_get_student_question(
  p_caller_id uuid,
  p_item_id uuid,
  p_version_id uuid DEFAULT NULL
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
  IF p_item_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_QUESTION_ID', 'message', 'Question ID is required');
  END IF;

  SELECT * INTO v_item 
  FROM public.question_bank_items 
  WHERE id = p_item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'QUESTION_NOT_FOUND', 'message', 'Question not found');
  END IF;

  -- STRICT FAIL-CLOSED: Câu hỏi phải published VÀ published_version_id KHÔNG ĐƯỢC NULL
  IF v_item.status <> 'published' OR v_item.published_version_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'QUESTION_NOT_PUBLISHED', 'message', 'Question is not published');
  END IF;

  -- Nếu chỉ định version, version đó BẮT BUỘC phải khớp chính xác published_version_id
  IF p_version_id IS NOT NULL AND p_version_id <> v_item.published_version_id THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN_VERSION', 'message', 'Access to unreleased question version is denied');
  END IF;

  v_target_version_id := v_item.published_version_id;

  SELECT * INTO v_version 
  FROM public.question_bank_versions 
  WHERE id = v_target_version_id AND question_bank_item_id = p_item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VERSION_NOT_FOUND', 'message', 'Published version record not found');
  END IF;

  -- Trả về dữ liệu an toàn cho Học sinh: KHÔNG có đáp án đúng, KHÔNG có grading_rubric, KHÔNG có explanation
  RETURN jsonb_build_object(
    'success', true,
    'id', v_item.id,
    'code', v_item.code,
    'title', v_item.title,
    'question_type', v_item.question_type,
    'version_id', v_version.id,
    'version_number', v_version.version_number,
    'prompt', v_version.prompt,
    'media_urls', v_version.media_urls,
    'options', v_version.options,
    'hints', v_version.hints
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'DATABASE_ERROR',
      'message', 'An internal database error occurred while fetching student question'
    );
END;
$function$;

-- 2.5 RPC: rpc_qb_update_item_metadata
-- Concurrency Guard: Khóa hàng FOR UPDATE và bắt buộc kiểm tra expected_version_id khi xuất bản
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
  v_expected_version_id uuid;
  v_updated_visibility text;
  v_updated_status text;
BEGIN
  IF p_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED_CALLER', 'message', 'Caller ID is required');
  END IF;

  IF p_actor_role IS NULL OR p_actor_role NOT IN ('admin', 'teacher') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED_ROLE', 'message', 'Access denied');
  END IF;

  SELECT * INTO v_item 
  FROM public.question_bank_items 
  WHERE id = p_item_id 
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ITEM_NOT_FOUND', 'message', 'Question item not found');
  END IF;

  -- Ownership Gate: Không ai được sửa câu hỏi của người khác (trừ Admin)
  IF p_actor_role <> 'admin' AND v_item.author_id <> p_caller_id THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN', 'message', 'You can only update or publish your own questions');
  END IF;

  v_title := nullif(trim(p_payload->>'title'), '');
  v_difficulty := nullif(trim(p_payload->>'difficulty'), '');
  v_status := nullif(trim(p_payload->>'status'), '');
  v_visibility := nullif(trim(p_payload->>'visibility'), '');

  -- School visibility requires school_id
  IF (v_visibility IN ('school', 'school_shared')) AND v_item.school_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_SCHOOL_ID', 'message', 'Cannot set school visibility on item without an associated school_id');
  END IF;

  -- Teacher Sharing Policy: Giáo viên ĐƯỢC PHÉP chia sẻ câu hỏi của chính mình làm public_template
  -- Đã xác thực v_item.author_id = p_caller_id ở Ownership Gate phía trên.

  -- Đồng bộ hóa con trỏ Dual-Head và Kiểm định an toàn khi Xuất bản
  IF v_status = 'published' THEN
    -- BẮT BUỘC: expected_version_id để loại trừ xuất bản nhầm phiên bản khi có tương tranh
    IF p_payload->>'expected_version_id' IS NULL OR trim(p_payload->>'expected_version_id') = '' THEN
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'MISSING_EXPECTED_VERSION',
        'message', 'expected_version_id is strictly required when publishing a question'
      );
    END IF;

    BEGIN
      v_expected_version_id := (trim(p_payload->>'expected_version_id'))::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'INVALID_INPUT',
        'message', 'expected_version_id must be a valid UUID format'
      );
    END;

    -- Concurrency Guard: So sánh nguyên tử sau khi khóa hàng FOR UPDATE
    IF v_item.current_version_id IS NULL OR v_item.current_version_id <> v_expected_version_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'CONFLICT',
        'message', 'Current question version does not match expected_version_id. Concurrency conflict detected.'
      );
    END IF;

    IF v_item.current_version_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'CANNOT_PUBLISH_EMPTY_ITEM', 'message', 'Cannot publish item with no versions');
    END IF;

    SELECT * INTO v_current_version
    FROM public.question_bank_versions
    WHERE id = v_item.current_version_id AND question_bank_item_id = p_item_id;

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

    v_published_id := v_item.current_version_id;
  ELSIF v_status = 'draft' THEN
    v_published_id := NULL;
  ELSE
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
      WHEN v_visibility = 'public' THEN 'public_template'
      WHEN v_visibility = 'school' THEN 'school_shared'
      ELSE visibility
    END,
    tags = CASE
      WHEN p_payload->'tags' IS NOT NULL AND jsonb_typeof(p_payload->'tags') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'tags'))
      ELSE tags
    END,
    updated_at = now()
  WHERE id = p_item_id
  RETURNING visibility, status INTO v_updated_visibility, v_updated_status;

  -- Trả về trường visibility và status thực tế được lưu vào database để phục vụ Zero-Trust BFF
  RETURN jsonb_build_object(
    'success', true,
    'item_id', p_item_id,
    'status', v_updated_status,
    'visibility', v_updated_visibility,
    'published_version_id', v_published_id,
    'current_version_id', v_item.current_version_id,
    'message', CASE
      WHEN v_status = 'published' THEN 'Question published successfully'
      WHEN v_status = 'draft' THEN 'Question restored to draft'
      WHEN v_status = 'archived' THEN 'Question archived successfully'
      ELSE 'Item metadata updated successfully'
    END
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'DATABASE_ERROR',
      'message', 'An internal database error occurred while updating item metadata'
    );
END;
$function$;

-- 2.6 ELIMINATE OBSOLETE 4-PARAMETER PUBLISH OVERLOAD
DROP FUNCTION IF EXISTS public.rpc_qb_publish_question(uuid, text, uuid, text);

-- 2.7 RPC: rpc_qb_publish_question (5 PARAMETERS)
-- Concurrency Guard: Kiểm tra expected_version_id, đồng bộ hóa con trỏ xuất bản
CREATE OR REPLACE FUNCTION public.rpc_qb_publish_question(
  p_caller_id uuid,
  p_actor_role text,
  p_item_id uuid,
  p_expected_version_id uuid,
  p_target_visibility text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_item public.question_bank_items%ROWTYPE;
  v_version public.question_bank_versions%ROWTYPE;
  v_answer_key app_private.question_bank_answer_keys%ROWTYPE;
  v_new_visibility text;
  v_updated_visibility text;
  v_updated_status text;
BEGIN
  IF p_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED_CALLER', 'message', 'Caller ID is required');
  END IF;

  IF p_actor_role IS NULL OR p_actor_role NOT IN ('admin', 'teacher') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED_ROLE', 'message', 'Access denied');
  END IF;

  IF p_expected_version_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'MISSING_EXPECTED_VERSION',
      'message', 'p_expected_version_id is strictly required when publishing a question'
    );
  END IF;

  SELECT * INTO v_item 
  FROM public.question_bank_items 
  WHERE id = p_item_id 
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ITEM_NOT_FOUND', 'message', 'Question item not found');
  END IF;

  IF p_actor_role <> 'admin' AND v_item.author_id <> p_caller_id THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN', 'message', 'You can only publish your own questions');
  END IF;

  -- Concurrency Guard: So sánh nguyên tử sau khi khóa hàng FOR UPDATE
  IF v_item.current_version_id IS NULL OR v_item.current_version_id <> p_expected_version_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'CONFLICT',
      'message', 'Current question version does not match expected_version_id. Concurrency conflict detected.'
    );
  END IF;

  IF v_item.current_version_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'CANNOT_PUBLISH_EMPTY_ITEM', 'message', 'Cannot publish question without a valid version');
  END IF;

  SELECT * INTO v_version 
  FROM public.question_bank_versions 
  WHERE id = v_item.current_version_id AND question_bank_item_id = p_item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VERSION_NOT_FOUND', 'message', 'Active version record not found');
  END IF;

  IF nullif(trim(v_version.prompt), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_PROMPT', 'message', 'Cannot publish question with an empty prompt');
  END IF;

  SELECT * INTO v_answer_key 
  FROM app_private.question_bank_answer_keys 
  WHERE version_id = v_item.current_version_id;

  IF NOT FOUND OR v_answer_key.correct_answers IS NULL OR v_answer_key.correct_answers = '{}'::jsonb OR v_answer_key.correct_answers = '[]'::jsonb THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_ANSWER_KEY', 'message', 'Cannot publish question without a valid answer key');
  END IF;

  -- Xác định phạm vi hiển thị
  IF p_target_visibility IS NOT NULL AND trim(p_target_visibility) <> '' THEN
    IF p_target_visibility IN ('private', 'school_shared', 'public_template') THEN
      v_new_visibility := p_target_visibility;
    ELSIF p_target_visibility = 'public' THEN
      v_new_visibility := 'public_template';
    ELSIF p_target_visibility IN ('school', 'school_shared') THEN
      v_new_visibility := 'school_shared';
    ELSE
      RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_VISIBILITY', 'message', 'Invalid visibility value');
    END IF;
  ELSE
    v_new_visibility := v_item.visibility;
  END IF;

  -- Cập nhật đồng bộ Dual-Head: published_version_id = current_version_id
  UPDATE public.question_bank_items
  SET 
    status = 'published',
    published_version_id = v_item.current_version_id,
    visibility = v_new_visibility,
    updated_at = now()
  WHERE id = p_item_id
  RETURNING visibility, status INTO v_updated_visibility, v_updated_status;

  RETURN jsonb_build_object(
    'success', true,
    'item_id', p_item_id,
    'status', v_updated_status,
    'visibility', v_updated_visibility,
    'published_version_id', v_item.current_version_id,
    'message', 'Question published successfully'
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'DATABASE_ERROR',
      'message', 'An internal database error occurred while publishing the question'
    );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3. ACL & PRIVILEGES HARDENING (Only service_role granted execute)
-- ----------------------------------------------------------------------------

ALTER FUNCTION public.rpc_qb_create_version(uuid, text, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.rpc_qb_create_version(uuid, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_qb_create_version(uuid, text, uuid, jsonb) TO service_role;

ALTER FUNCTION public.rpc_qb_list_questions(uuid, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.rpc_qb_list_questions(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_qb_list_questions(uuid, text, jsonb) TO service_role;

ALTER FUNCTION public.rpc_qb_fork_question(uuid, text, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.rpc_qb_fork_question(uuid, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_qb_fork_question(uuid, text, uuid, jsonb) TO service_role;

ALTER FUNCTION public.rpc_qb_get_student_question(uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.rpc_qb_get_student_question(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_qb_get_student_question(uuid, uuid, uuid) TO service_role;

ALTER FUNCTION public.rpc_qb_update_item_metadata(uuid, text, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.rpc_qb_update_item_metadata(uuid, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_qb_update_item_metadata(uuid, text, uuid, jsonb) TO service_role;

ALTER FUNCTION public.rpc_qb_publish_question(uuid, text, uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.rpc_qb_publish_question(uuid, text, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_qb_publish_question(uuid, text, uuid, uuid, text) TO service_role;

COMMIT;
