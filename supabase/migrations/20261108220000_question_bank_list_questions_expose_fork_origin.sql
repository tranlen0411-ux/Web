-- Migration: 20261108220000_question_bank_list_questions_expose_fork_origin.sql
-- Description:
--   Bổ sung trường forked_from_version_id từ phiên bản hiện hành (public.question_bank_versions)
--   vào danh sách trả về của rpc_qb_list_questions nhằm phục vụ hiển thị nhãn "Câu gốc" / "Bản sao" trên UI.
-- Target: Supabase PostgreSQL (Staging rcqgxmcqolxbrahhyxji)
-- An toàn:
--   - Giữ nguyên 100% chữ ký hàm, tham số, kiểu trả về (jsonb).
--   - Giữ nguyên SECURITY DEFINER và search_path ('pg_catalog', 'public', 'pg_temp').
--   - Giữ nguyên toàn bộ cơ chế phòng thủ Fail-Closed (JWT role service_role, phân quyền Admin/Teacher).
--   - Giữ nguyên toàn bộ logic đếm tổng (v_total_count), bộ lọc nghiệp vụ và phân trang.
--   - Quyền EXECUTE chỉ cấp cho service_role và postgres.

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
  v_search text;
  v_subject text;
  v_grade_level integer;
  v_difficulty text;
  v_question_type text;
  v_status text;
  v_only_my_questions boolean;
  v_page integer;
  v_page_size integer;
  v_limit integer;
  v_offset integer;
  v_total_count integer;
  v_items jsonb;
BEGIN
  -- 1. Chốt bảo vệ nguồn gọi Fail-Closed (Defense-in-depth)
  -- A. Ngữ cảnh kết nối qua PostgREST (session_user = 'authenticator'):
  --    Bắt buộc JWT role phải là 'service_role'.
  --    Mọi trường hợp role bị thiếu, NULL, chuỗi rỗng, 'anon', 'authenticated' hoặc giá trị lạ
  --    đều bị từ chối lập tức (Fail-Closed tuyệt đối).
  IF session_user = 'authenticator' THEN
    IF COALESCE(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
      ''
    ) <> 'service_role' THEN
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'FORBIDDEN',
        'message', 'Direct RPC invocation is restricted to service_role'
      );
    END IF;
  END IF;

  -- B. Ngữ cảnh thiết lập GUC giả lập hoặc môi trường kiểm thử:
  --    Nếu tồn tại biến phiên JWT, role bên trong BẮT BUỘC phải là 'service_role'.
  --    Nếu claim role bị thiếu, NULL, rỗng hoặc khác 'service_role' -> REJECT lập tức!
  IF (
    nullif(current_setting('request.jwt.claim.role', true), '') IS NOT NULL
    OR nullif(current_setting('request.jwt.claims', true), '') IS NOT NULL
  ) THEN
    IF COALESCE(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
      ''
    ) <> 'service_role' THEN
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'FORBIDDEN',
        'message', 'Direct RPC invocation is restricted to service_role'
      );
    END IF;
  END IF;

  -- 2. Xác thực tham số bắt buộc (Fail-closed)
  IF p_caller_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'UNAUTHORIZED_CALLER',
      'message', 'Caller ID is required'
    );
  END IF;

  IF p_actor_role IS NULL OR p_actor_role NOT IN ('admin', 'teacher') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'UNAUTHORIZED_ROLE',
      'message', 'Access denied'
    );
  END IF;

  -- 3. Trích xuất bộ lọc nghiệp vụ
  v_search := p_filters->>'search';
  v_subject := p_filters->>'subject';
  v_grade_level := (p_filters->>'grade_level')::integer;
  v_difficulty := p_filters->>'difficulty';
  v_question_type := p_filters->>'question_type';
  v_status := p_filters->>'status';
  v_only_my_questions := COALESCE((p_filters->>'only_my_questions')::boolean, false);

  -- 4. Xử lý phân trang chuẩn hóa (Hỗ trợ cả page/page_size và limit/offset)
  -- Trích xuất page (mặc định 1, tối thiểu 1)
  v_page := COALESCE((p_filters->>'page')::integer, 1);
  IF v_page < 1 THEN
    v_page := 1;
  END IF;

  -- Trích xuất page_size / limit (mặc định 20, trong dải 1..100)
  IF p_filters ? 'page_size' THEN
    v_page_size := COALESCE((p_filters->>'page_size')::integer, 20);
  ELSIF p_filters ? 'limit' THEN
    v_page_size := COALESCE((p_filters->>'limit')::integer, 20);
  ELSE
    v_page_size := 20;
  END IF;

  IF v_page_size < 1 THEN
    v_page_size := 1;
  ELSIF v_page_size > 100 THEN
    v_page_size := 100;
  END IF;

  -- Tính toán limit và offset cho truy vấn SQL
  IF p_filters ? 'offset' AND NOT (p_filters ? 'page') THEN
    v_offset := GREATEST(COALESCE((p_filters->>'offset')::integer, 0), 0);
    v_limit := v_page_size;
    v_page := (v_offset / v_page_size) + 1;
  ELSE
    v_limit := v_page_size;
    v_offset := (v_page - 1) * v_page_size;
  END IF;

  -- 5. Đếm tổng số bản ghi thỏa mãn điều kiện và phân quyền dữ liệu
  SELECT count(*)
  INTO v_total_count
  FROM public.question_bank_items i
  LEFT JOIN public.question_bank_versions v ON i.current_version_id = v.id
  WHERE (v_only_my_questions = false OR i.author_id = p_caller_id)
    AND (
      p_actor_role = 'admin' 
      OR i.author_id = p_caller_id 
      OR i.status = 'published'
    )
    AND (
      (v_status IS NOT NULL AND v_status <> '' AND i.status = v_status)
      OR
      ((v_status IS NULL OR v_status = '') AND i.status <> 'archived')
    )
    AND (v_subject IS NULL OR v_subject = '' OR i.subject = v_subject)
    AND (v_grade_level IS NULL OR i.grade_level = v_grade_level)
    AND (v_difficulty IS NULL OR v_difficulty = '' OR i.difficulty = v_difficulty)
    AND (v_question_type IS NULL OR v_question_type = '' OR v.question_type = v_question_type)
    AND (v_search IS NULL OR v_search = '' OR i.title ILIKE '%' || v_search || '%' OR v.prompt ILIKE '%' || v_search || '%');

  -- 6. Lấy danh sách bản ghi và đóng gói JSON (Khử mơ hồ cột và chuẩn hóa bí danh)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', i.id,
      'title', i.title,
      'difficulty', i.difficulty,
      'tags', i.tags,
      'grade_level', i.grade_level,
      'subject', i.subject,
      'status', i.status,
      'visibility', i.visibility,
      'author_id', i.author_id,
      'version_count', i.version_count,
      'current_version_id', i.current_version_id,
      'created_at', i.created_at,
      'updated_at', i.updated_at,
      'prompt', i.prompt,
      'question_type', i.question_type,
      'forked_from_version_id', i.forked_from_version_id
    )
  ), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT 
      i.id,
      i.title,
      i.difficulty,
      i.tags,
      i.grade_level,
      i.subject,
      i.status,
      i.visibility,
      i.author_id,
      i.version_count,
      i.current_version_id,
      i.created_at,
      i.updated_at,
      v.prompt,
      COALESCE(v.question_type, i.question_type) AS question_type,
      v.forked_from_version_id
    FROM public.question_bank_items i
    LEFT JOIN public.question_bank_versions v ON i.current_version_id = v.id
    WHERE (v_only_my_questions = false OR i.author_id = p_caller_id)
      AND (
        p_actor_role = 'admin' 
        OR i.author_id = p_caller_id 
        OR i.status = 'published'
      )
      AND (
        (v_status IS NOT NULL AND v_status <> '' AND i.status = v_status)
        OR
        ((v_status IS NULL OR v_status = '') AND i.status <> 'archived')
      )
      AND (v_subject IS NULL OR v_subject = '' OR i.subject = v_subject)
      AND (v_grade_level IS NULL OR i.grade_level = v_grade_level)
      AND (v_difficulty IS NULL OR v_difficulty = '' OR i.difficulty = v_difficulty)
      AND (v_question_type IS NULL OR v_question_type = '' OR v.question_type = v_question_type)
      AND (v_search IS NULL OR v_search = '' OR i.title ILIKE '%' || v_search || '%' OR v.prompt ILIKE '%' || v_search || '%')
    ORDER BY i.created_at DESC
    LIMIT v_limit OFFSET v_offset
  ) i;

  -- 7. Trả về kết quả tuân thủ đúng hợp đồng mapListQuestionsSuccess
  RETURN jsonb_build_object(
    'success', true,
    'total_count', v_total_count,
    'page', v_page,
    'page_size', v_page_size,
    'items', v_items
  );
END;
$function$;

-- 8. Thiết lập quyền sở hữu và quyền thực thi an ninh tường minh
ALTER FUNCTION public.rpc_qb_list_questions(uuid, text, jsonb) OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.rpc_qb_list_questions(uuid, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_qb_list_questions(uuid, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_qb_list_questions(uuid, text, jsonb) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_qb_list_questions(uuid, text, jsonb) TO service_role;

