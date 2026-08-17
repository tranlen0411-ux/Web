-- ============================================================================
-- FIXTURE DATABASE TỐI THIỂU NẠP VÀO SUPABASE LOCAL (CI RUNNER ONLY)
-- KHÔNG CHỨA BẤT KỲ DỮ LIỆU THẬT NÀO TỪ PRODUCTION
-- ============================================================================

BEGIN;

-- 0. TẠO TÀI KHOẢN MOCK LOCAL TRONG AUTH.USERS ĐỂ GOTRUE AUTH VERIFY JWT THẬT
INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, role, aud, created_at, updated_at)
VALUES 
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'admin_test@local.dev', '$2a$10$abcdefghijklmnopqrstuu', NOW(), 'authenticated', 'authenticated', NOW(), NOW()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'teacher_test@local.dev', '$2a$10$abcdefghijklmnopqrstuu', NOW(), 'authenticated', 'authenticated', NOW(), NOW()),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'hs_test1@local.dev', '$2a$10$abcdefghijklmnopqrstuu', NOW(), 'authenticated', 'authenticated', NOW(), NOW()),
  ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'hs_disabled@local.dev', '$2a$10$abcdefghijklmnopqrstuu', NOW(), 'authenticated', 'authenticated', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- 1. ĐẢM BẢO SCHEMA PUBLIC VÀ CÁC BẢNG CƠ BẢN CẦN THIẾT DÀNH CHO BỘ TEST
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'student', 'parent')),
  grade_level INT,
  student_code TEXT,
  is_disabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  grade_level INT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  teacher_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.class_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_class_student UNIQUE (class_id, student_id)
);

-- 2. DỮ LIỆU MOCK TỐI THIỂU (UUID GIẢ LẬP LOCAL)

-- Admin Test Local
INSERT INTO public.profiles (id, email, full_name, role, grade_level, is_disabled)
VALUES ('11111111-1111-1111-1111-111111111111', 'admin_test@local.dev', 'Quản Trị Viên Test Local', 'admin', NULL, FALSE)
ON CONFLICT (id) DO NOTHING;

-- Teacher Test Local (Cô Lã Nguyễn Diễm Hương)
INSERT INTO public.profiles (id, email, full_name, role, grade_level, is_disabled)
VALUES ('22222222-2222-2222-2222-222222222222', 'teacher_test@local.dev', 'Lã Nguyễn Diễm Hương', 'teacher', 2, FALSE)
ON CONFLICT (id) DO NOTHING;

-- Student Test Local 1 (Học Sinh Bình Thường)
INSERT INTO public.profiles (id, email, full_name, role, grade_level, student_code, is_disabled)
VALUES ('33333333-3333-3333-3333-333333333333', 'hs_test1@local.dev', 'Trần Lê Hoàng An', 'student', 2, 'HS212-0001', FALSE)
ON CONFLICT (id) DO NOTHING;

-- Student Test Local 2 (Học Sinh Bị Vô Hiệu Hóa - Disabled)
INSERT INTO public.profiles (id, email, full_name, role, grade_level, student_code, is_disabled)
VALUES ('44444444-4444-4444-4444-444444444444', 'hs_disabled@local.dev', 'Học Sinh Bị Khóa', 'student', 2, 'HS212-9999', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Lớp 2.12 Test Local
INSERT INTO public.classes (id, name, grade_level, code, teacher_id)
VALUES ('99999999-9999-9999-9999-999999999999', 'Lớp 2.12', 2, 'LOP212-3A5818', '22222222-2222-2222-2222-222222222222')
ON CONFLICT (code) DO NOTHING;

COMMIT;
