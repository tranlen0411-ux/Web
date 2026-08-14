-- ============================================================================
-- SQL MIGRATION: THÊM BẢNG VÀ CHỨC NĂNG QUẢN LÝ MÃ PIN BẢO MẬT CHO HỌC SINH
-- ============================================================================

-- 1. Bật Extension pgcrypto để hash mật khẩu PIN bằng thuật toán Blowfish (crypt)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Tạo Schema app_private bảo mật (Không thể truy cập trực tiếp từ client API)
CREATE SCHEMA IF NOT EXISTS app_private;

-- 3. Tạo bảng lưu trữ Hashed PIN của Học sinh trong app_private
CREATE TABLE IF NOT EXISTS app_private.student_login_credentials (
  student_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  pin_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Chặn hoàn toàn quyền truy cập trực tiếp từ phía client (anon, authenticated)
REVOKE ALL ON TABLE app_private.student_login_credentials FROM PUBLIC, anon, authenticated;

-- 5. Hàm RPC Đặt / Reset Mã PIN Học Sinh (Dành cho Admin & Giáo Viên)
-- Mã PIN được hash 1 chiều bằng pgcrypto crypt(pin, gen_salt('bf'))
CREATE OR REPLACE FUNCTION app_private.set_student_pin(
  p_student_id UUID,
  p_pin TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Kiểm tra độ dài PIN tối thiểu 4 ký tự
  IF p_pin IS NULL OR length(trim(p_pin)) < 4 THEN
    RAISE EXCEPTION 'Mã PIN phải có độ dài tối thiểu 4 ký tự.';
  END IF;

  -- Thêm mới hoặc cập nhật PIN hash
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

-- 6. Hàm RPC Xác Minh Mã PIN Học Sinh Server-side
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

  -- Nếu chưa thiết lập PIN trong CSDL, kiểm tra PIN mặc định '1234'
  IF v_pin_hash IS NULL THEN
    RETURN (trim(p_pin) = '1234');
  END IF;

  -- So sánh PIN hash bằng thuật toán crypt 1 chiều
  RETURN (v_pin_hash = crypt(trim(p_pin), v_pin_hash));
END;
$$;

-- 7. Phân quyền thực thi hàm RPC xác minh cho Edge Function & Admin Client
GRANT EXECUTE ON FUNCTION app_private.set_student_pin(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.verify_student_pin(UUID, TEXT) TO anon, authenticated, service_role;

-- 8. Gán PIN mặc định '1234' cho các học sinh mẫu hiện có trong hệ thống (HS101, HS202, HS303...)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.profiles WHERE role = 'student' LOOP
    PERFORM app_private.set_student_pin(r.id, '1234');
  END LOOP;
END $$;
