-- ============================================================================
-- SQL MIGRATION: THÊM CỘT STUDENT_CODE VÀ BẢNG MÃ PIN BẢO MẬT CHO HỌC SINH
-- ============================================================================

-- 1. Bật Extension pgcrypto để mã hóa Hashed PIN 1 chiều
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Thêm cột student_code chính thức vào bảng public.profiles (nếu chưa có)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS student_code TEXT UNIQUE;

-- 3. Cập nhật mã học sinh mẫu chính thức vào CSDL
UPDATE public.profiles SET student_code = 'HS101' WHERE email = 'hs_nam@hoclapvui.edu.vn';
UPDATE public.profiles SET student_code = 'HS202' WHERE email = 'hs_an@hoclapvui.edu.vn';
UPDATE public.profiles SET student_code = 'HS303' WHERE email = 'hs_duc@hoclapvui.edu.vn';
UPDATE public.profiles SET student_code = 'HS404' WHERE email = 'hs_bao@hoclapvui.edu.vn';
UPDATE public.profiles SET student_code = 'HS505' WHERE email = 'hs_mai@hoclapvui.edu.vn';

-- 4. Tạo Schema app_private bảo mật (Không thể truy cập trực tiếp từ REST API)
CREATE SCHEMA IF NOT EXISTS app_private;

-- 5. Tạo bảng lưu trữ Hashed PIN của Học sinh trong app_private
CREATE TABLE IF NOT EXISTS app_private.student_login_credentials (
  student_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  pin_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Chặn hoàn toàn quyền truy cập trực tiếp từ client (anon, authenticated)
REVOKE ALL ON TABLE app_private.student_login_credentials FROM PUBLIC, anon, authenticated;

-- 7. Hàm RPC Đặt / Reset Mã PIN Học Sinh (Phân quyền: Admin hoặc Giáo viên sở hữu lớp học)
CREATE OR REPLACE FUNCTION app_private.set_student_pin(
  p_student_id UUID,
  p_pin TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_is_my_student BOOLEAN;
BEGIN
  v_caller_id := (SELECT auth.uid());
  
  -- Lấy vai trò của caller
  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;

  -- Kiểm tra độ dài PIN tối thiểu 4 ký tự
  IF p_pin IS NULL OR length(trim(p_pin)) < 4 THEN
    RAISE EXCEPTION 'Mã PIN phải có độ dài tối thiểu 4 ký tự.';
  END IF;

  -- Kiểm tra phân quyền: Nếu caller không phải Admin, phải là Giáo viên quản lý lớp của học sinh này
  IF v_caller_role != 'admin' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.classes c
      JOIN public.class_members cm ON c.id = cm.class_id
      WHERE c.teacher_id = v_caller_id AND cm.student_id = p_student_id
    ) INTO v_is_my_student;

    IF NOT v_is_my_student THEN
      RAISE EXCEPTION 'Từ chối truy cập: Giáo viên chỉ được phép đặt/reset PIN cho học sinh thuộc lớp của mình.';
    END IF;
  END IF;

  -- Hash 1 chiều mã PIN bằng pgcrypto blowfish gen_salt('bf')
  INSERT INTO app_private.student_login_credentials (student_id, pin_hash, updated_at)
  VALUES (
    p_student_id,
    crypt(trim(p_pin), gen_salt('bf')),
    NOW()
  )
  ON CONFLICT (student_id) DO UPDATE
  SET pin_hash = EXCLUDED.pin_hash,
      updated_at = NOW();

  RETURN TRUE;
END;
$$;

-- 8. Hàm RPC Xác Minh Mã PIN Học Sinh Server-side (Nghiêm ngặt, KHÔNG fallback)
CREATE OR REPLACE FUNCTION app_private.verify_student_pin(
  p_student_id UUID,
  p_pin TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pin_hash TEXT;
BEGIN
  SELECT pin_hash INTO v_pin_hash
  FROM app_private.student_login_credentials
  WHERE student_id = p_student_id;

  -- Nếu học sinh chưa được thiết lập PIN trong CSDL -> Từ chối xác thực (KHÔNG fallback)
  IF v_pin_hash IS NULL THEN
    RETURN FALSE;
  END IF;

  -- So sánh PIN hash bằng crypt 1 chiều
  RETURN (v_pin_hash = crypt(trim(p_pin), v_pin_hash));
END;
$$;

-- 9. Phân quyền thực thi RPC
GRANT EXECUTE ON FUNCTION app_private.set_student_pin(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.verify_student_pin(UUID, TEXT) TO anon, authenticated, service_role;

-- 10. Khởi tạo mã PIN '1234' đã được hash cho các học sinh mẫu (HS101 - HS505)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.profiles WHERE role = 'student' LOOP
    PERFORM app_private.set_student_pin(r.id, '1234');
  END LOOP;
END $$;
