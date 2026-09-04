-- docs/QUESTION_BANK_LIST_VERSIONS_RPC.sql
-- QUESTION BANK VERSION HISTORY V2.1: List Versions RPC
-- Target Database: szptvqkoiphrhlionfoh (Supabase NEW)
-- DO NOT EXECUTE DIRECTLY WITHOUT PREFLIGHT VERIFICATION (PHASE 1 - CODE ONLY)

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_qb_list_versions(
  p_caller_id uuid,
  p_actor_role text,
  p_item_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_item public.question_bank_items%ROWTYPE;
  v_versions jsonb;
  v_count integer;
BEGIN
  -- 1. Fail-closed caller guard
  IF p_caller_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'UNAUTHORIZED_CALLER',
      'message', 'Caller ID is required'
    );
  END IF;

  -- 2. Phân quyền vai trò: Chỉ Admin hoặc Teacher
  IF p_actor_role IS NULL
     OR p_actor_role NOT IN ('admin', 'teacher')
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'UNAUTHORIZED_ROLE',
      'message', 'Access denied'
    );
  END IF;

  -- 3. Fail-closed item guard
  IF p_item_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'INVALID_INPUT',
      'message', 'Item ID is required'
    );
  END IF;

  -- 4. Kiểm tra tồn tại của item câu hỏi
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

  -- 4. Phân quyền sở hữu: Admin hoặc chính tác giả câu hỏi (Null-safe)
  IF p_actor_role <> 'admin'
     AND (
       v_item.author_id IS NULL
       OR v_item.author_id <> p_caller_id
     )
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'FORBIDDEN',
      'message', 'You can only view version history of your own questions'
    );
  END IF;

  -- 5. Trích xuất danh sách phiên bản tóm tắt (TUYỆT ĐỐI KHÔNG chứa prompt, options, answer_key, hints, explanation, metadata)
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', v.id,
          'version_number', v.version_number,
          'created_by', v.created_by,
          'created_at', v.created_at,
          'change_log', v.change_log,
          'forked_from_version_id', v.forked_from_version_id,
          'is_current', (v.id = v_item.current_version_id)
        )
        ORDER BY v.version_number DESC
      ),
      '[]'::jsonb
    ),
    COUNT(*)
  INTO v_versions, v_count
  FROM public.question_bank_versions v
  WHERE v.question_bank_item_id = p_item_id;

  RETURN jsonb_build_object(
    'success', true,
    'item_id', v_item.id,
    'current_version_id', v_item.current_version_id,
    'total_versions', v_count,
    'versions', v_versions
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'DATABASE_ERROR',
      'message', 'An internal database error occurred while fetching version history'
    );
END;
$function$;

ALTER FUNCTION public.rpc_qb_list_versions(UUID, TEXT, UUID)
OWNER TO postgres;

REVOKE ALL ON FUNCTION
public.rpc_qb_list_versions(UUID, TEXT, UUID)
FROM PUBLIC;

REVOKE ALL ON FUNCTION
public.rpc_qb_list_versions(UUID, TEXT, UUID)
FROM anon;

REVOKE ALL ON FUNCTION
public.rpc_qb_list_versions(UUID, TEXT, UUID)
FROM authenticated;

GRANT EXECUTE ON FUNCTION
public.rpc_qb_list_versions(UUID, TEXT, UUID)
TO postgres;

GRANT EXECUTE ON FUNCTION
public.rpc_qb_list_versions(UUID, TEXT, UUID)
TO service_role;

COMMIT;
