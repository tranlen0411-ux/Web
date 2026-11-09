-- Migration: 20261109140000_question_bank_list_questions_persistent_tri_state_origin.sql
-- Description:
--   Hiệu chỉnh rpc_qb_list_questions với Hợp đồng Nguồn gốc 3 Trạng thái (Tri-State Origin Contract):
--     1. origin_status: 'original' | 'clone' | 'unknown'
--     2. forked_from_version_id: UUID (khi clone) hoặc NULL (khi original/unknown)
--   Bảo vệ an toàn tuyệt đối phép ép kiểu UUID (UUID Cast Safety):
--     - Dùng nested CASE kiểm tra jsonb_typeof = 'string' và regex UUID chuẩn 36 ký tự.
--     - Không phụ thuộc vào thứ tự thực thi AND trong PostgreSQL.
--   Bảo đảm chính sách nguồn gốc lịch sử (Legacy Provenance Policy):
--     - LEFT JOIN v1 (phiên bản khởi nguyên version_number = 1) qua unique_qb_version_number index.
--     - Khôi phục chính xác nguồn gốc bản sao ngay cả khi đã sửa qua nhiều phiên bản (V2, V3...).
--     - Xác thực Fail-Closed: Thiếu Version 1 hoặc metadata bị hỏng/mâu thuẫn -> 'unknown'.
--     - Chỉ trả về 'original' khi cả metadata, v1 và v đều xác nhận không có dấu vết fork.

CREATE OR REPLACE FUNCTION public.rpc_qb_list_questions(p_caller_id uuid, p_actor_role text, p_filters jsonb DEFAULT '{}'::jsonb)
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

  -- 6. Lấy danh sách bản ghi và đóng gói JSON (Khử mơ hồ cột, chuẩn hóa bí danh và nguồn gốc 3 trạng thái)
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
      'origin_status', i.origin_status,
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

      -- A. Xác định origin_status ('original' | 'clone' | 'unknown')
      CASE 
        -- 1. Metadata có key fork nhưng sai định dạng (không phải UUID chuẩn) -> UNKNOWN (Fail-Closed)
        WHEN (i.metadata ? 'forked_from_version_id') 
             AND (
               jsonb_typeof(i.metadata->'forked_from_version_id') <> 'string'
               OR NOT (i.metadata->>'forked_from_version_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
             )
          THEN 'unknown'

        -- 2. Metadata có UUID hợp lệ nhưng version 1 hoặc current version có UUID khác (Mâu thuẫn) -> UNKNOWN
        WHEN (i.metadata ? 'forked_from_version_id')
             AND (
               (v1.forked_from_version_id IS NOT NULL AND v1.forked_from_version_id <> (
                 CASE WHEN jsonb_typeof(i.metadata->'forked_from_version_id') = 'string' THEN
                   CASE WHEN i.metadata->>'forked_from_version_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
                     (i.metadata->>'forked_from_version_id')::uuid
                   ELSE NULL END
                 ELSE NULL END
               ))
               OR 
               (v.forked_from_version_id IS NOT NULL AND v.forked_from_version_id <> (
                 CASE WHEN jsonb_typeof(i.metadata->'forked_from_version_id') = 'string' THEN
                   CASE WHEN i.metadata->>'forked_from_version_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
                     (i.metadata->>'forked_from_version_id')::uuid
                   ELSE NULL END
                 ELSE NULL END
               ))
             )
          THEN 'unknown'

        -- 3. Metadata có UUID hợp lệ -> CLONE (Bền vững qua mọi phiên bản v1, v2, v3...)
        WHEN (i.metadata ? 'forked_from_version_id')
             AND jsonb_typeof(i.metadata->'forked_from_version_id') = 'string'
             AND (i.metadata->>'forked_from_version_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
          THEN 'clone'

        -- 4. Metadata không có key fork:
        --    Kiểm tra mâu thuẫn giữa v1 và v (nếu cả 2 đều có nhưng khác nhau) -> UNKNOWN
        WHEN NOT (COALESCE(i.metadata, '{}'::jsonb) ? 'forked_from_version_id')
             AND v1.forked_from_version_id IS NOT NULL AND v.forked_from_version_id IS NOT NULL AND v1.forked_from_version_id <> v.forked_from_version_id
          THEN 'unknown'

        --    Nếu v1 hoặc v có fork UUID -> Legacy Clone
        WHEN NOT (COALESCE(i.metadata, '{}'::jsonb) ? 'forked_from_version_id')
             AND (v1.forked_from_version_id IS NOT NULL OR v.forked_from_version_id IS NOT NULL)
          THEN 'clone'

        --    Nếu bản ghi phiên bản 1 bị thiếu hoàn toàn trong DB -> UNKNOWN (Fail-Closed)
        WHEN NOT (COALESCE(i.metadata, '{}'::jsonb) ? 'forked_from_version_id')
             AND v1.id IS NULL
          THEN 'unknown'

        --    Nếu Version 1 tồn tại, cả v1 và v đều có fork = NULL -> ORIGINAL
        WHEN NOT (COALESCE(i.metadata, '{}'::jsonb) ? 'forked_from_version_id')
             AND v1.id IS NOT NULL AND v1.forked_from_version_id IS NULL AND v.forked_from_version_id IS NULL
          THEN 'original'

        ELSE 'unknown'
      END AS origin_status,

      -- B. Xác định forked_from_version_id (UUID hợp lệ khi clone, NULL khi original hoặc unknown)
      CASE 
        -- 1. Metadata có key fork nhưng sai định dạng -> NULL
        WHEN (i.metadata ? 'forked_from_version_id') 
             AND (
               jsonb_typeof(i.metadata->'forked_from_version_id') <> 'string'
               OR NOT (i.metadata->>'forked_from_version_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
             )
          THEN NULL

        -- 2. Mâu thuẫn -> NULL
        WHEN (i.metadata ? 'forked_from_version_id')
             AND (
               (v1.forked_from_version_id IS NOT NULL AND v1.forked_from_version_id <> (
                 CASE WHEN jsonb_typeof(i.metadata->'forked_from_version_id') = 'string' THEN
                   CASE WHEN i.metadata->>'forked_from_version_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
                     (i.metadata->>'forked_from_version_id')::uuid
                   ELSE NULL END
                 ELSE NULL END
               ))
               OR 
               (v.forked_from_version_id IS NOT NULL AND v.forked_from_version_id <> (
                 CASE WHEN jsonb_typeof(i.metadata->'forked_from_version_id') = 'string' THEN
                   CASE WHEN i.metadata->>'forked_from_version_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
                     (i.metadata->>'forked_from_version_id')::uuid
                   ELSE NULL END
                 ELSE NULL END
               ))
             )
          THEN NULL

        -- 3. Metadata có UUID hợp lệ -> Trả về UUID với nested CASE an toàn tuyệt đối
        WHEN (i.metadata ? 'forked_from_version_id')
             AND jsonb_typeof(i.metadata->'forked_from_version_id') = 'string'
             AND (i.metadata->>'forked_from_version_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
          THEN (
            CASE WHEN jsonb_typeof(i.metadata->'forked_from_version_id') = 'string' THEN
              CASE WHEN i.metadata->>'forked_from_version_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
                (i.metadata->>'forked_from_version_id')::uuid
              ELSE NULL END
            ELSE NULL END
          )

        -- 4. Legacy clone (Mâu thuẫn v1 vs v) -> NULL
        WHEN NOT (COALESCE(i.metadata, '{}'::jsonb) ? 'forked_from_version_id')
             AND v1.forked_from_version_id IS NOT NULL AND v.forked_from_version_id IS NOT NULL AND v1.forked_from_version_id <> v.forked_from_version_id
          THEN NULL

        -- 5. Legacy clone -> lấy v1 hoặc v
        WHEN NOT (COALESCE(i.metadata, '{}'::jsonb) ? 'forked_from_version_id')
             AND (v1.forked_from_version_id IS NOT NULL OR v.forked_from_version_id IS NOT NULL)
          THEN COALESCE(v1.forked_from_version_id, v.forked_from_version_id)

        ELSE NULL
      END AS forked_from_version_id
    FROM public.question_bank_items i
    LEFT JOIN public.question_bank_versions v ON i.current_version_id = v.id
    LEFT JOIN public.question_bank_versions v1 ON (i.id = v1.question_bank_item_id AND v1.version_number = 1)
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

ALTER FUNCTION public.rpc_qb_list_questions(uuid, text, jsonb) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.rpc_qb_list_questions(uuid, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_qb_list_questions(uuid, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_qb_list_questions(uuid, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_qb_list_questions(uuid, text, jsonb) TO service_role;
