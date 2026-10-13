-- ============================================================================
-- SECURE ROLLBACK SCRIPT: AUTH ROLE TRUST HARDENING
-- Mục đích: Kế hoạch khôi phục vận hành khẩn cấp (Emergency Operational Recovery)
--           cho bản vá P0 Auth Role Trust Hardening.
--
-- NGUYÊN TẮC BẢO MẬT BẮT BUỘC:
-- 1. TUYỆT ĐỐI KHÔNG KHÔI PHỤC ĐỌC ROLE TỪ raw_user_meta_data:
--    Mọi tài khoản tự đăng ký vẫn nhận role = 'student'.
-- 2. CHỐNG NGHẼN ĐĂNG KÝ DO grade_level:
--    Bắt lỗi chuyển đổi kiểu dữ liệu grade_level; tự động fallback về 1 nếu thiếu,
--    sai định dạng hoặc ngoài phạm vi [1-12].
-- 3. BẢO TOÀN TÀI KHOẢN VÀ ĐẶC QUYỀN HIỆN CÓ:
--    ON CONFLICT (id) DO UPDATE không ghi đè cột role hoặc các trường nhạy cảm.
-- 4. KHÔNG THAY ĐỔI / RECREATE TRIGGER:
--    Sử dụng CREATE OR REPLACE FUNCTION để giữ nguyên liên kết trigger hiện hữu
--    trên bảng auth.users.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = '' 
AS $$
DECLARE
  v_grade INT;
BEGIN
  -- Khối bảo vệ an toàn: Ngăn chặn lỗi định dạng grade_level làm nghẽn đăng ký
  BEGIN
    v_grade := (NEW.raw_user_meta_data->>'grade_level')::INT;
  EXCEPTION WHEN OTHERS THEN
    v_grade := 1;
  END;

  IF v_grade IS NULL OR v_grade < 1 OR v_grade > 12 THEN
    v_grade := 1;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, grade_level)
  VALUES (
    NEW.id,
    NEW.email,
    pg_catalog.btrim(COALESCE(NEW.raw_user_meta_data->>'full_name', pg_catalog.split_part(NEW.email, '@', 1))),
    'student', -- TUYỆT ĐỐI KHÔNG KHÔI PHỤC ĐỌC TỪ USER_METADATA
    v_grade
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    updated_at = pg_catalog.now();

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS 
'Trigger Secure Rollback khôi phục vận hành an toàn. Khóa cứng role = student và bảo vệ an toàn định dạng grade_level.';
