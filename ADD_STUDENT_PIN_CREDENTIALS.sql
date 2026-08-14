-- ============================================================================
-- SQL SCHEMA MIGRATION: BẢNG BẢO MẬT & HÀM XÁC MINH MÃ PIN HỌC SINH
-- ============================================================================

-- 1. Bật Extension pgcrypto trong schema extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 2. Thêm cột student_code chính thức vào bảng public.profiles (nếu chưa có)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS student_code TEXT UNIQUE;

-- 3. Tạo Schema app_private bảo mật (Không thể truy cập trực tiếp từ REST API)
CREATE SCHEMA IF NOT EXISTS app_private;

-- 4. Tạo bảng lưu trữ Hashed PIN của Học sinh trong app_private
CREATE TABLE IF NOT EXISTS app_private.student_login_credentials (
  student_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  pin_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Chặn hoàn toàn quyền truy cập trực tiếp từ client (PUBLIC, anon, authenticated)
REVOKE ALL ON TABLE app_private.student_login_credentials FROM PUBLIC, anon, authenticated;

-- 6. HÀM PUBLIC SECURITY DEFINER: set_student_pin (Dành cho Admin & Giáo viên authenticated)
-- Đặt / Reset Mã PIN Học Sinh với kiểm tra phân quyền chặt chẽ
CREATE OR REPLACE FUNCTION public.set_student_pin(
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
  v_target_role TEXT;
  v_is_my_student BOOLEAN;
BEGIN
  -- 1. Xác thực caller phải là user đã authenticated
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- 2. Lấy vai trò của caller từ public.profiles
  SELECT role INTO v_caller_role
  FROM public.profiles
  WHERE id = v_caller_id;

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'teacher') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- 3. Xác nhận target user tồn tại và có vai trò 'student'
  SELECT role INTO v_target_role
  FROM public.profiles
  WHERE id = p_student_id;

  IF v_target_role IS NULL OR v_target_role != 'student' THEN
    RAISE EXCEPTION 'Mục tiêu không phải là tài khoản học sinh.';
  END IF;

  -- 4. Nếu caller là Giáo viên: Phải sở hữu lớp học mà học sinh này tham gia
  IF v_caller_role = 'teacher' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.classes c
      JOIN public.class_members cm ON c.id = cm.class_id
      WHERE c.teacher_id = v_caller_id AND cm.student_id = p_student_id
    ) INTO v_is_my_student;

    IF NOT v_is_my_student THEN
      RAISE EXCEPTION 'Từ chối truy cập: Giáo viên chỉ được phép đặt PIN cho học sinh thuộc lớp của mình.';
    END IF;
  END IF;

  -- 5. Kiểm tra độ dài PIN tối thiểu 4 ký tự
  IF p_pin IS NULL OR length(trim(p_pin)) < 4 THEN
    RAISE EXCEPTION 'Mã PIN phải có độ dài tối thiểu 4 ký tự.';
  END IF;

  -- 6. Hash mã PIN 1 chiều bằng extensions.crypt & extensions.gen_salt
  INSERT INTO app_private.student_login_credentials (student_id, pin_hash, updated_at)
  VALUES (
    p_student_id,
    extensions.crypt(trim(p_pin), extensions.gen_salt('bf')),
    NOW()
  )
  ON CONFLICT (student_id) DO UPDATE
  SET pin_hash = EXCLUDED.pin_hash,
      updated_at = NOW();

  RETURN TRUE;
END;
$$;

-- Phân quyền cho public.set_student_pin (Chỉ GRANT cho authenticated)
REVOKE ALL ON FUNCTION public.set_student_pin(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_student_pin(UUID, TEXT) TO authenticated;

-- 7. HÀM PUBLIC SECURITY DEFINER: verify_student_pin (Dành cho service_role từ Edge Function)
-- Xác minh mã PIN học sinh server-side (Chặt chẽ, KHÔNG fallback)
CREATE OR REPLACE FUNCTION public.verify_student_pin(
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

  -- Nếu chưa có PIN hash -> Từ chối (Trả FALSE, KHÔNG fallback)
  IF v_pin_hash IS NULL THEN
    RETURN FALSE;
  END IF;

  -- So sánh PIN hash bằng extensions.crypt
  RETURN (v_pin_hash = extensions.crypt(trim(p_pin), v_pin_hash));
END;
$$;

-- Phân quyền cho public.verify_student_pin (Chỉ GRANT cho service_role)
REVOKE ALL ON FUNCTION public.verify_student_pin(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_student_pin(UUID, TEXT) TO service_role;
