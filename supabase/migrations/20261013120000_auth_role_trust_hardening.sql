-- ============================================================================
-- MIGRATION: AUTH ROLE TRUST HARDENING
-- Mục tiêu: Ngăn chặn triệt để lỗ hổng leo thang đặc quyền (Privilege Escalation)
-- qua raw_user_meta_data khi người dùng tự đăng ký (Self-Registration).
--
-- Nguyên tắc thiết kế:
-- 1. BẢO VỆ MẶC ĐỊNH (Fail-Closed Default):
--    Mọi người dùng tự đăng ký thông thường (qua client supabase.auth.signUp)
--    CHỈ ĐƯỢC NHẬN vai trò 'student' (Học sinh).
-- 2. KHÔNG TIN TƯỞNG CLIENT METADATA:
--    Tuyệt đối KHÔNG đọc quyền hạn (role) từ raw_user_meta_data.
-- 3. NGUỒN QUẢN TRỊ TIN CẬY (Trusted Source):
--    Chỉ cho phép cấp role 'teacher' hoặc 'admin' tại thời điểm tạo tài khoản
--    NẾU VÀ CHỈ NẾU role được chỉ định trong raw_app_meta_data (chỉ có Admin /
--    Service Role mới có quyền ghi vào trường này).
-- 4. BẢO TOÀN TÀI KHOẢN HIỆN CÓ (Preserve Existing Roles):
--    ON CONFLICT (id) DO UPDATE SET TUYỆT ĐỐI KHÔNG cập nhật đè vai trò 'role'
--    của các tài khoản đã có sẵn trong public.profiles, tránh nguy cơ giáng chức
--    ngoài ý muốn của Giáo viên / Admin khi cập nhật hồ sơ hoặc re-trigger.
-- 5. BẢO TOÀN CÁC LUỒNG QUẢN TRỊ HIỆN HÀNH:
--    Các Edge Function và RPC quản trị (admin-create-user, admin-bulk-create-students)
--    chạy với Service Role Key hoặc kiểm tra callerProfile.role = 'admin' vẫn hoạt động 100%.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_full_name TEXT;
  v_avatar_url TEXT;
  v_grade_level INT;
  v_assigned_role TEXT;
  v_app_role TEXT;
BEGIN
  -- 1. Trích xuất họ tên hiển thị (cho phép lấy từ user_metadata hoặc cắt từ email)
  v_full_name := pg_catalog.btrim(COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    pg_catalog.split_part(NEW.email, '@', 1)
  ));
  IF v_full_name = '' THEN
    v_full_name := pg_catalog.split_part(NEW.email, '@', 1);
  END IF;

  -- 2. Ảnh đại diện mặc định
  v_avatar_url := COALESCE(
    NEW.raw_user_meta_data->>'avatar_url',
    'https://api.dicebear.com/7.x/bottts/svg?seed=' || NEW.id::text
  );

  -- 3. Khối lớp (mặc định khối 1, kiểm tra giới hạn 1 - 12)
  BEGIN
    v_grade_level := (NEW.raw_user_meta_data->>'grade_level')::INT;
  EXCEPTION WHEN OTHERS THEN
    v_grade_level := 1;
  END;

  IF v_grade_level IS NULL OR v_grade_level < 1 OR v_grade_level > 12 THEN
    v_grade_level := 1;
  END IF;

  -- 4. XÁC ĐỊNH VAI TRÒ (ROLE TRUST ENFORCEMENT)
  -- MẶC ĐỊNH AN TOÀN TUYỆT ĐỐI CHO TỰ ĐĂNG KÝ: 'student'
  v_assigned_role := 'student';

  -- CHỈ TIN TƯỞNG NGUỒN QUẢN TRỊ (raw_app_meta_data do Admin / Service Role quản lý):
  -- Khách client KHÔNG THỂ ghi vào raw_app_meta_data qua supabase.auth.signUp()
  v_app_role := pg_catalog.lower(pg_catalog.btrim(COALESCE(NEW.raw_app_meta_data->>'role', '')));
  IF v_app_role IN ('teacher', 'admin', 'student') THEN
    v_assigned_role := v_app_role;
  END IF;

  -- 5. CHÈN HOẶC BẢO TOÀN HỒ SƠ TRONG PUBLIC.PROFILES
  -- Nếu xung đột ID (tài khoản đã tồn tại), TUYỆT ĐỐI KHÔNG ghi đè cột role!
  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    role,
    avatar_url,
    grade_level,
    total_stars,
    total_coins,
    is_disabled,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    v_full_name,
    v_assigned_role,
    v_avatar_url,
    v_grade_level,
    0,
    0,
    FALSE,
    pg_catalog.now(),
    pg_catalog.now()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    updated_at = pg_catalog.now();
    -- CHÚ Ý: Cột 'role' KHÔNG bị ghi đè tại đây để bảo vệ tài khoản đã cấp quyền!

  RETURN NEW;
END;
$$;

-- Đảm bảo trigger on_auth_user_created gắn chặt với hàm an toàn mới
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

COMMENT ON FUNCTION public.handle_new_user() IS 
'Trigger an toàn tự động khởi tạo hồ sơ người dùng. Khóa cứng vai trò student cho mọi lượt tự đăng ký; chỉ tin cậy vai trò từ raw_app_meta_data của Quản trị viên.';
