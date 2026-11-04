-- ============================================================================
-- MIGRATION: 20261028000003_notifications_v1_search_contract_v2.sql
-- DESCRIPTION: Notifications V1 R3 - Search Contract Repair (Additive Migration)
-- ADDITIVE RPC: public.rpc_search_students_for_notification_v2
--
-- QUY TẮC BẢO TOÀN KIẾN TRÚC:
-- 1. KHÔNG sửa đổi, DROP hoặc thay đổi chữ ký của RPC rpc_search_students_for_notification cũ.
-- 2. KHÔNG tạo overload cùng tên gây xung đột PostgREST schema cache.
-- 3. Tạo RPC v2 độc lập với đầy đủ tham số p_search, p_class_id, p_grade_level, p_limit, p_offset.
-- 4. Loại bỏ trùng lặp học sinh khi học sinh tham gia nhiều lớp bằng ROW_NUMBER() deterministic.
-- 5. Bảo toàn tuyệt đối quyền sở hữu lớp của Giáo viên (c.teacher_id = v_caller.user_id).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_search_students_for_notification_v2(
  p_search TEXT DEFAULT '',
  p_class_id UUID DEFAULT NULL,
  p_grade_level INT DEFAULT NULL,
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
) RETURNS TABLE (
  student_id UUID,
  full_name TEXT,
  student_code TEXT,
  class_name TEXT,
  grade_level INT
) AS $$
DECLARE
  v_caller RECORD;
  v_clean_search TEXT := trim(COALESCE(p_search, ''));
  v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
  v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  -- 1. Xác thực phiên gọi qua helper bảo mật nội bộ
  SELECT * INTO v_caller FROM notifications_private.fn_notifications_get_caller_profile();

  IF v_caller.user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated.';
  END IF;

  IF v_caller.is_disabled = TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN_ACCOUNT_DISABLED: Account is disabled.';
  END IF;

  IF v_caller.user_role NOT IN ('admin', 'teacher') THEN
    RAISE EXCEPTION 'FORBIDDEN_ROLE: Only admins and teachers can search students for notifications.';
  END IF;

  -- 2. Phân nhánh GIÁO VIÊN: Chỉ tìm thấy học sinh trong các lớp giáo viên đang trực tiếp phụ trách
  IF v_caller.user_role = 'teacher' THEN
    RETURN QUERY
    WITH ranked_students AS (
      SELECT
        p.id AS student_id,
        p.full_name,
        p.student_code,
        c.name AS class_name,
        c.grade_level,
        ROW_NUMBER() OVER (
          PARTITION BY p.id
          ORDER BY
            CASE WHEN p_class_id IS NOT NULL AND c.id = p_class_id THEN 0 ELSE 1 END,
            CASE WHEN cm.is_primary = TRUE THEN 0 ELSE 1 END,
            c.grade_level ASC,
            c.name ASC,
            cm.joined_at ASC
        ) AS rn
      FROM public.class_members cm
      JOIN public.classes c ON c.id = cm.class_id
      JOIN public.profiles p ON p.id = cm.student_id
      WHERE c.teacher_id = v_caller.user_id
        AND cm.is_active = TRUE
        AND p.role = 'student'
        AND p.is_disabled = FALSE
        AND (p_class_id IS NULL OR c.id = p_class_id)
        AND (p_grade_level IS NULL OR c.grade_level = p_grade_level)
        AND (
          v_clean_search = '' OR
          p.full_name ILIKE '%' || v_clean_search || '%' OR
          p.student_code ILIKE '%' || v_clean_search || '%'
        )
    )
    SELECT
      rs.student_id,
      rs.full_name,
      rs.student_code,
      rs.class_name,
      rs.grade_level
    FROM ranked_students rs
    WHERE rs.rn = 1
    ORDER BY rs.grade_level ASC, rs.class_name ASC, rs.full_name ASC, rs.student_id ASC
    LIMIT v_limit OFFSET v_offset;

  -- 3. Phân nhánh ADMIN: Tìm kiếm học sinh trên phạm vi toàn trường (có thể lọc theo lớp / khối)
  ELSIF v_caller.user_role = 'admin' THEN
    RETURN QUERY
    WITH ranked_students AS (
      SELECT
        p.id AS student_id,
        p.full_name,
        p.student_code,
        c.name AS class_name,
        c.grade_level,
        ROW_NUMBER() OVER (
          PARTITION BY p.id
          ORDER BY
            CASE WHEN p_class_id IS NOT NULL AND c.id = p_class_id THEN 0 ELSE 1 END,
            CASE WHEN cm.is_primary = TRUE THEN 0 ELSE 1 END,
            COALESCE(c.grade_level, 999) ASC,
            COALESCE(c.name, '') ASC
        ) AS rn
      FROM public.profiles p
      LEFT JOIN public.class_members cm ON cm.student_id = p.id AND cm.is_active = TRUE
      LEFT JOIN public.classes c ON c.id = cm.class_id
      WHERE p.role = 'student'
        AND p.is_disabled = FALSE
        AND (p_class_id IS NULL OR c.id = p_class_id)
        AND (p_grade_level IS NULL OR c.grade_level = p_grade_level)
        AND (
          v_clean_search = '' OR
          p.full_name ILIKE '%' || v_clean_search || '%' OR
          p.student_code ILIKE '%' || v_clean_search || '%'
        )
    )
    SELECT
      rs.student_id,
      rs.full_name,
      rs.student_code,
      rs.class_name,
      rs.grade_level
    FROM ranked_students rs
    WHERE rs.rn = 1
    ORDER BY rs.full_name ASC, rs.student_id ASC
    LIMIT v_limit OFFSET v_offset;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, notifications_private, pg_temp;

-- 4. Phân quyền thực thi: Thu hồi khỏi PUBLIC/anon, chỉ cấp cho authenticated và service_role
REVOKE ALL ON FUNCTION public.rpc_search_students_for_notification_v2(TEXT, UUID, INT, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_search_students_for_notification_v2(TEXT, UUID, INT, INT, INT) TO authenticated, service_role;
