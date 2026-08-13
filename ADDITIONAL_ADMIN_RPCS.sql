BEGIN;

-- 1. BỔ SUNG CỘT IS_DISABLED VÀO PUBLIC.PROFILES NẾU CHƯA TỒN TẠI
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN DEFAULT FALSE;

-- 2. RPC THÊM TÀI KHOẢN MỚI (TẠO AUTH USER + PROFILE ĐỒNG BỘ)
CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_email TEXT,
  p_password TEXT,
  p_full_name TEXT,
  p_role TEXT,
  p_grade_level INT DEFAULT 1
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_new_user_id UUID;
  v_clean_email TEXT;
BEGIN
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Từ chối truy cập: Chỉ Quản trị viên mới có quyền tạo tài khoản.');
  END IF;

  v_clean_email := LOWER(TRIM(p_email));
  IF v_clean_email IS NULL OR v_clean_email = '' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Email không được để trống.');
  END IF;

  IF p_password IS NULL OR LENGTH(p_password) < 6 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Mật khẩu phải từ 6 ký tự trở lên.');
  END IF;

  IF p_role NOT IN ('student', 'teacher') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Vai trò không hợp lệ (Chỉ tạo được Học sinh hoặc Giáo viên).');
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_clean_email) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Email này đã tồn tại trong hệ thống.');
  END IF;

  v_new_user_id := gen_random_uuid();

  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, raw_app_meta_data, role, aud, created_at, updated_at
  ) VALUES (
    v_new_user_id,
    '00000000-0000-0000-0000-000000000000',
    v_clean_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    NOW(),
    jsonb_build_object('full_name', TRIM(p_full_name), 'role', p_role, 'grade_level', p_grade_level),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    'authenticated',
    'authenticated',
    NOW(),
    NOW()
  );

  INSERT INTO public.profiles (id, email, full_name, role, grade_level, total_stars, total_coins, is_disabled, created_at, updated_at)
  VALUES (
    v_new_user_id, v_clean_email, TRIM(p_full_name), p_role, p_grade_level, 0, 0, FALSE, NOW(), NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    grade_level = EXCLUDED.grade_level,
    updated_at = NOW();

  RETURN jsonb_build_object('success', true, 'message', 'Tạo tài khoản thành công!', 'user_id', v_new_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_user(TEXT, TEXT, TEXT, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_user(TEXT, TEXT, TEXT, TEXT, INT) TO authenticated;

-- 3. RPC KHÓA / MỞ KHÓA TÀI KHOẢN (SOFT DELETE AN TOÀN)
CREATE OR REPLACE FUNCTION public.admin_toggle_user_status(
  p_target_user_id UUID,
  p_is_disabled BOOLEAN
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
BEGIN
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  IF v_caller_id = p_target_user_id THEN
    RETURN jsonb_build_object('success', false, 'message', 'Không thể tự khóa tài khoản đang đăng nhập.');
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Từ chối truy cập: Chỉ Quản trị viên mới có quyền thực hiện.');
  END IF;

  UPDATE public.profiles
  SET is_disabled = p_is_disabled,
      updated_at = NOW()
  WHERE id = p_target_user_id;

  IF p_is_disabled THEN
    UPDATE auth.users SET banned_until = '2099-01-01 00:00:00+00' WHERE id = p_target_user_id;
  ELSE
    UPDATE auth.users SET banned_until = NULL WHERE id = p_target_user_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'message', CASE WHEN p_is_disabled THEN 'Đã khóa tài khoản thành công.' ELSE 'Đã mở khóa tài khoản thành công.' END);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_toggle_user_status(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_toggle_user_status(UUID, BOOLEAN) TO authenticated;

-- 4. RPC XÓA VĨNH VIỄN TÀI KHOẢN (CÓ BẢO VỆ NẾU GIÁO VIÊN ĐANG QUẢN LÝ LỚP)
CREATE OR REPLACE FUNCTION public.admin_delete_user(
  p_target_user_id UUID,
  p_reassign_teacher_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_target_role TEXT;
  v_owned_classes_count INT;
BEGIN
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  IF v_caller_id = p_target_user_id THEN
    RETURN jsonb_build_object('success', false, 'message', 'Không thể tự xóa tài khoản đang đăng nhập.');
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Từ chối truy cập: Chỉ Quản trị viên mới có quyền thực hiện.');
  END IF;

  SELECT role INTO v_target_role FROM public.profiles WHERE id = p_target_user_id;
  IF v_target_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Tài khoản không tồn tại.');
  END IF;

  IF v_target_role = 'teacher' THEN
    SELECT COUNT(*) INTO v_owned_classes_count FROM public.classes WHERE teacher_id = p_target_user_id;
    IF v_owned_classes_count > 0 THEN
      IF p_reassign_teacher_id IS NULL THEN
        RETURN jsonb_build_object(
          'success', false, 
          'message', format('Giáo viên này đang quản lý %s lớp học. Hãy chọn Giáo viên mới để chuyển giao lớp hoặc thực hiện Khóa tài khoản.', v_owned_classes_count),
          'requires_reassign', true,
          'owned_classes_count', v_owned_classes_count
        );
      ELSE
        UPDATE public.classes SET teacher_id = p_reassign_teacher_id WHERE teacher_id = p_target_user_id;
      END IF;
    END IF;
  END IF;

  DELETE FROM auth.users WHERE id = p_target_user_id;

  RETURN jsonb_build_object('success', true, 'message', 'Đã xóa tài khoản thành công.');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_user(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID, UUID) TO authenticated;

-- 5. RELOAD REST SCHEMA DÙNG BẢO ĐẢM SUPABASE NHẬN HÀM MỚI NGAY
NOTIFY pgrst, 'reload schema';

COMMIT;
