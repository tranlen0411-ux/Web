-- ============================================================================
-- FIXTURE DATABASE TỐI THIỂU NẠP VÀO SUPABASE LOCAL (CI RUNNER ONLY)
-- KHÔNG CHỨA BẤT KỲ DỮ LIỆU THẬT NÀO TỪ PRODUCTION
-- ============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS app_private;

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

CREATE TABLE IF NOT EXISTS app_private.student_login_credentials (
  student_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  pin_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_private.student_pin_reset_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES public.profiles(id),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reset_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE app_private.student_pin_reset_logs ADD COLUMN IF NOT EXISTS reset_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Lớp 2.12 Test Local
INSERT INTO public.classes (id, name, grade_level, code)
VALUES ('99999999-9999-9999-9999-999999999999', 'Lớp 2.12', 2, 'LOP212-3A5818')
ON CONFLICT (code) DO NOTHING;

COMMIT;
