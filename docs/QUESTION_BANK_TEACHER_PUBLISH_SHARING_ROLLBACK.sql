-- docs/QUESTION_BANK_TEACHER_PUBLISH_SHARING_ROLLBACK.sql
-- QUESTION BANK — TEACHER PUBLISH SHARING HOTFIX V1: Rollback Script
-- Target Database: szptvqkoiphrhlionfoh (Supabase NEW)
-- Restores public.rpc_qb_update_item_metadata to Admin-only public_template behavior
-- DO NOT APPLY DIRECTLY WITHOUT PREFLIGHT VERIFICATION

BEGIN;

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
  v_title TEXT;
  v_difficulty TEXT;
  v_status TEXT;
  v_visibility TEXT;
BEGIN
  -- 1. Phân quyền vai trò: Chỉ Admin hoặc Teacher
  IF p_actor_role IS NULL
     OR p_actor_role NOT IN ('admin', 'teacher')
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'UNAUTHORIZED_ROLE',
      'message', 'Access denied'
    );
  END IF;

  -- 2. Fail-closed caller guard
  IF p_caller_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'UNAUTHORIZED_CALLER',
      'message', 'Caller ID is required'
    );
  END IF;

  -- 3. Kiểm tra tồn tại của item câu hỏi
  SELECT *
  INTO v_item
  FROM public.question_bank_items
  WHERE id = p_item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'ITEM_NOT_FOUND',
      'message', 'Question item not found'
    );
  END IF;

  -- 3. Phân quyền sở hữu: Admin hoặc chính tác giả câu hỏi
  IF p_actor_role <> 'admin'
     AND v_item.author_id <> p_caller_id
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'FORBIDDEN',
      'message', 'You can only update your own questions'
    );
  END IF;

  v_title := trim(p_payload->>'title');
  v_difficulty := trim(p_payload->>'difficulty');
  v_status := trim(p_payload->>'status');
  v_visibility := trim(p_payload->>'visibility');

  -- Rollback: Khôi phục chặn Teacher đặt public_template (Admin-only)
  IF v_visibility = 'public_template'
     AND p_actor_role <> 'admin'
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'FORBIDDEN_VISIBILITY',
      'message', 'Teacher role is not permitted to set visibility to public_template'
    );
  END IF;

  IF v_visibility = 'school_shared'
     AND v_item.school_id IS NULL
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'INVALID_SCHOOL_ID',
      'message', 'Cannot set school_shared on item without an associated school_id'
    );
  END IF;

  -- Hardening kiểm soát chuyển đổi trạng thái (status transitions)
  IF v_status IN ('draft', 'published', 'archived')
     AND v_status <> v_item.status
  THEN
    IF (v_item.status = 'draft' AND v_status IN ('published', 'archived'))
       OR (v_item.status = 'published' AND v_status = 'archived')
       OR (v_item.status = 'archived' AND v_status = 'draft')
    THEN
      NULL;
    ELSE
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'INVALID_STATUS_TRANSITION',
        'message', 'Invalid status transition'
      );
    END IF;
  END IF;

  -- Cập nhật metadata
  UPDATE public.question_bank_items
  SET
    title = COALESCE(NULLIF(v_title, ''), title),
    difficulty = CASE
      WHEN v_difficulty IN ('easy', 'medium', 'hard', 'expert')
      THEN v_difficulty
      ELSE difficulty
    END,
    status = CASE
      WHEN v_status IN ('draft', 'published', 'archived')
      THEN v_status
      ELSE status
    END,
    visibility = CASE
      WHEN v_visibility IN ('private', 'school_shared', 'public_template')
      THEN v_visibility
      ELSE visibility
    END,
    tags = CASE
      WHEN p_payload->'tags' IS NOT NULL
       AND jsonb_typeof(p_payload->'tags') = 'array'
      THEN ARRAY(
        SELECT jsonb_array_elements_text(p_payload->'tags')
      )
      ELSE tags
    END,
    updated_at = NOW()
  WHERE id = p_item_id;

  RETURN jsonb_build_object(
    'success', true,
    'item_id', p_item_id,
    'message', 'Item metadata updated successfully'
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

ALTER FUNCTION public.rpc_qb_update_item_metadata(UUID, TEXT, UUID, JSONB)
OWNER TO postgres;

REVOKE ALL ON FUNCTION public.rpc_qb_update_item_metadata(UUID, TEXT, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_qb_update_item_metadata(UUID, TEXT, UUID, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_qb_update_item_metadata(UUID, TEXT, UUID, JSONB) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_qb_update_item_metadata(UUID, TEXT, UUID, JSONB) TO postgres;
GRANT EXECUTE ON FUNCTION public.rpc_qb_update_item_metadata(UUID, TEXT, UUID, JSONB) TO service_role;

COMMIT;
