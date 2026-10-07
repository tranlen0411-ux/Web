-- ============================================================================
-- Migration: 20261007180000_fix_admin_update_profile_signature.sql
-- Description: Align public.admin_update_profile with canonical 6-argument signature (including p_full_name).
-- Removes stale 5-argument overload and updates PostgREST schema cache.
-- ============================================================================

-- 1. Explicitly drop the stale 5-argument overload
DROP FUNCTION IF EXISTS public.admin_update_profile(UUID, TEXT, INT, INT, INT);

-- 2. Create canonical 6-argument RPC matching repo source of truth (FINAL_MIGRATION.sql)
CREATE OR REPLACE FUNCTION public.admin_update_profile(
  p_target_user_id UUID,
  p_full_name TEXT DEFAULT NULL,
  p_role TEXT DEFAULT NULL,
  p_grade_level INT DEFAULT NULL,
  p_total_stars INT DEFAULT NULL,
  p_total_coins INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
BEGIN
  -- Verify authentication
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  -- Verify admin role authorization
  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Từ chối truy cập: Chỉ Quản trị viên mới có quyền thực hiện.');
  END IF;

  -- Validate role
  IF p_role IS NOT NULL AND p_role NOT IN ('student', 'teacher', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Vai trò (role) không hợp lệ. Chỉ chấp nhận: student, teacher, admin.');
  END IF;

  -- Validate grade_level (1 to 12)
  IF p_grade_level IS NOT NULL AND (p_grade_level < 1 OR p_grade_level > 12) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Khối lớp (grade_level) phải từ 1 đến 12.');
  END IF;

  -- Validate total_stars (non-negative)
  IF p_total_stars IS NOT NULL AND p_total_stars < 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Tổng số Sao (total_stars) không được âm.');
  END IF;

  -- Validate total_coins (non-negative)
  IF p_total_coins IS NOT NULL AND p_total_coins < 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Tổng số Xu (total_coins) không được âm.');
  END IF;

  -- Apply updates to profile
  UPDATE public.profiles
  SET full_name = COALESCE(NULLIF(TRIM(p_full_name), ''), full_name),
      role = COALESCE(p_role, role),
      grade_level = COALESCE(p_grade_level, grade_level),
      total_stars = COALESCE(p_total_stars, total_stars),
      total_coins = COALESCE(p_total_coins, total_coins),
      updated_at = NOW()
  WHERE id = p_target_user_id;

  RETURN jsonb_build_object('success', true, 'message', 'Cập nhật tài khoản thành công.');
END;
$$;

-- 3. Function privileges (revoke anon, grant authenticated)
REVOKE ALL ON FUNCTION public.admin_update_profile(UUID, TEXT, TEXT, INT, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_profile(UUID, TEXT, TEXT, INT, INT, INT) TO authenticated;

-- 4. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
