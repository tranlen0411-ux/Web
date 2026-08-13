-- ====================================================================
-- MIGRATION: BỔ SUNG CỘT PARENT_ACCESS_CODE CHO BẢNG PUBLIC.PROFILES (AUTH-04)
-- ====================================================================

-- 1. Bổ sung cột parent_access_code (Mã tra cứu phụ huynh riêng biệt, không trùng lặp)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS parent_access_code TEXT UNIQUE;

-- 2. Sinh mã tra cứu phụ huynh ngẫu nhiên, khó đoán cho tất cả học sinh hiện tại (Dạng: PAR-XXXXXX)
UPDATE public.profiles
SET parent_access_code = 'PAR-' || UPPER(SUBSTRING(MD5(id::text || 'parent_salt_2026_security') FROM 1 FOR 6))
WHERE role = 'student' AND (parent_access_code IS NULL OR parent_access_code = '');

-- 3. Tạo Index để truy vấn nhanh theo parent_access_code
CREATE INDEX IF NOT EXISTS idx_profiles_parent_access_code ON public.profiles(parent_access_code);
