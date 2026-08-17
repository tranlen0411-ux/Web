-- ============================================================================
-- SQL MIGRATION: QUẢN TRỊ ADMIN PHÂN CÔNG GIÁO VIÊN CHO LỚP HỌC (REVISED)
-- KHÔNG ALTER SCHEMA PRODUCTION (TẬP TRUNG CHÍNH XÁC VÀO CLASSES.TEACHER_ID)
-- BỎ TÍNH NĂNG HỦY PHÂN CÔNG (KHÔNG CHO PHÉP P_TEACHER_ID IS NULL)
-- KHÔNG CẬP NHẬT CỘT UPDATED_AT (VÌ PRODUCTION CHƯA CÓ CỘT NÀY)
-- TUYỆT ĐỐI KHÔNG THAY ĐỔI DỮ LIỆU HỌC SINH HAY CLASS_MEMBERS
-- ============================================================================

BEGIN;

-- 1. TẠO HÀM RPC QUẢN TRỊ ADMIN PHÂN CÔNG GIÁO VIÊN CHO LỚP
CREATE OR REPLACE FUNCTION public.admin_assign_teacher_to_class(
  p_class_id UUID,
  p_teacher_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_caller_disabled BOOLEAN;
  v_target_class RECORD;
  v_teacher_profile RECORD;
BEGIN
  -- A. XÁC MINH NGƯỜI GỌI LÀ ADMIN HỢP LỆ VÀ KHÔNG BỊ VÔ HIỆU HÓA
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false, 
      'status', 'UNAUTHORIZED', 
      'message', 'Từ chối truy cập: Chưa đăng nhập.'
    );
  END IF;

  SELECT role, COALESCE(is_disabled, false)
  INTO v_caller_role, v_caller_disabled
  FROM public.profiles
  WHERE id = v_caller_id;

  IF v_caller_role IS DISTINCT FROM 'admin' OR v_caller_disabled IS TRUE THEN
    RETURN jsonb_build_object(
      'success', false, 
      'status', 'FORBIDDEN', 
      'message', 'Từ chối truy cập: Chỉ Quản trị viên (Admin) mới có quyền phân công giáo viên.'
    );
  END IF;

  -- B. NẾU P_TEACHER_ID LÀ NULL -> TỪ CHỐI (VÌ MỖI LỚP LUÔN CẦN BẮT BUỘC CÓ 1 GIÁO VIÊN PHỤ TRÁCH)
  IF p_teacher_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'INVALID_TEACHER',
      'message', 'Từ chối: ID giáo viên không được để trống (Mỗi lớp luôn cần 1 giáo viên phụ trách).'
    );
  END IF;

  -- C. KIỂM TRA LỚP HỌC TỒN TẠI
  SELECT id, name, code, grade_level, teacher_id
  INTO v_target_class
  FROM public.classes
  WHERE id = p_class_id;

  IF v_target_class.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false, 
      'status', 'CLASS_NOT_FOUND', 
      'message', 'Lớp học không tồn tại trong hệ thống.'
    );
  END IF;

  -- D. KIỂM TRA HỒ SƠ GIÁO VIÊN HỢP LỆ (BẮT BUỘC TỒN TẠI, ROLE = TEACHER VÀ KHÔNG BỊ VÔ HIỆU HÓA)
  SELECT id, full_name, role, COALESCE(is_disabled, false) AS is_disabled
  INTO v_teacher_profile
  FROM public.profiles
  WHERE id = p_teacher_id;

  IF v_teacher_profile.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false, 
      'status', 'INVALID_TEACHER', 
      'message', 'Tài khoản giáo viên không tồn tại.'
    );
  END IF;

  IF v_teacher_profile.role IS DISTINCT FROM 'teacher' THEN
    RETURN jsonb_build_object(
      'success', false, 
      'status', 'INVALID_TEACHER', 
      'message', 'Từ chối: Tài khoản được chọn không phải là Giáo viên (Role không phải teacher).'
    );
  END IF;

  IF v_teacher_profile.is_disabled IS TRUE THEN
    RETURN jsonb_build_object(
      'success', false, 
      'status', 'INVALID_TEACHER', 
      'message', 'Tài khoản giáo viên hiện đang bị khóa/vô hiệu hóa.'
    );
  END IF;

  -- E. KIỂM TRA IDEMPOTENT (LỚP ĐÃ ĐƯỢC GÁN ĐÚNG GIÁO VIÊN NÀY TỪ TRƯỚC)
  IF (v_target_class.teacher_id IS NOT DISTINCT FROM p_teacher_id) THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', 'ALREADY_ASSIGNED',
      'message', 'Lớp học đã được phân công đúng giáo viên này từ trước.',
      'class_id', v_target_class.id,
      'teacher_id', p_teacher_id
    );
  END IF;

  -- F. CẬP NHẬT CHÍNH XÁC DUY NHẤT CỘT PUBLIC.CLASSES.TEACHER_ID (KHÔNG SET UPDATED_AT)
  UPDATE public.classes
  SET teacher_id = p_teacher_id
  WHERE id = p_class_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'ASSIGNED_SUCCESSFULLY',
    'message', 'Đã phân công giáo viên phụ trách lớp thành công.',
    'class_id', v_target_class.id,
    'class_name', v_target_class.name,
    'new_teacher_id', p_teacher_id,
    'new_teacher_name', v_teacher_profile.full_name
  );
END;
$$;

-- 2. THU HỒI VÀ CẤP QUYỀN THỰC THI AN TOÀN
REVOKE ALL ON FUNCTION public.admin_assign_teacher_to_class(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_teacher_to_class(UUID, UUID) TO authenticated;

COMMIT;
