-- ============================================================================
-- Migration: 20261121235500_qb_student_access_hardening.sql
-- Module: Question Bank Dual-Head V1 - Defense-in-Depth Student Access Hardening
-- Purpose: Bổ sung chốt chặn bảo mật phân quyền chiều sâu cho rpc_qb_get_student_question
--          Ngăn chặn học sinh đọc câu hỏi riêng tư (visibility = 'private')
--          Giữ nguyên 100% signature, return contract, và phân quyền tối thiểu
-- ============================================================================

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
  v_virtual_code text;
BEGIN
  -- 1. Chốt chặn danh tính: p_caller_id bắt buộc từ JWT máy chủ (Fail-closed)
  IF p_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED_CALLER', 'message', 'Caller ID is required');
  END IF;

  -- 2. Chốt chặn tham số: p_item_id bắt buộc
  IF p_item_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_ITEM_ID', 'message', 'Question item ID is required');
  END IF;

  -- 3. Đọc dữ liệu câu hỏi từ question_bank_items
  SELECT * INTO v_item 
  FROM public.question_bank_items 
  WHERE id = p_item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ITEM_NOT_FOUND', 'message', 'Question item not found');
  END IF;

  -- 4. Học sinh CHỈ ĐƯỢC PHÉP đọc câu hỏi published và CÓ published_version_id
  IF v_item.status <> 'published' OR v_item.published_version_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN', 'message', 'Question is not published');
  END IF;

  -- 5. BẢO MẬT CHIỀU SÂU: Chặn đọc câu hỏi riêng tư nếu không phải tác giả tạo ra nó
  -- Xử lý fail-closed an toàn cho cả trường hợp visibility hoặc author_id bị NULL
  IF (v_item.visibility IS NULL OR v_item.visibility = 'private') AND (v_item.author_id IS NULL OR v_item.author_id <> p_caller_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN_PRIVATE_QUESTION', 'message', 'Question is private and not accessible');
  END IF;

  -- 6. Chặn tuyệt đối rò rỉ phiên bản nháp V2: Luôn phục vụ đúng published_version_id
  v_target_version_id := v_item.published_version_id;

  IF p_version_id IS NOT NULL AND p_version_id <> v_item.published_version_id THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN_VERSION', 'message', 'Requested version is not accessible');
  END IF;

  -- 7. Đọc phiên bản nội dung tương ứng
  SELECT * INTO v_version 
  FROM public.question_bank_versions 
  WHERE id = v_target_version_id AND question_bank_item_id = p_item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VERSION_NOT_FOUND', 'message', 'Published version record not found');
  END IF;

  v_virtual_code := 'QB-' || upper(substr(replace(v_item.id::text, '-', ''), 1, 12));

  -- 8. Trả về cấu trúc an toàn: KHÔNG có đáp án đúng, KHÔNG có grading_config/rubric, KHÔNG có solution_explanation
  RETURN jsonb_build_object(
    'success', true,
    'id', v_item.id,
    'code', v_virtual_code,
    'title', v_item.title,
    'question_type', v_item.question_type,
    'version_id', v_version.id,
    'version_number', v_version.version_number,
    'prompt', v_version.prompt,
    'prompt_media', v_version.prompt_media,
    'media_urls', v_version.prompt_media,
    'options', v_version.options
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

-- Duy trì phân quyền tối thiểu nghiêm ngặt (Least Privilege): Chỉ cho phép service_role và postgres
REVOKE ALL ON FUNCTION public.rpc_qb_get_student_question(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_qb_get_student_question(uuid, uuid, uuid) TO service_role;

