-- ====================================================================
-- MIGRATION AN TOÀN CAO BẰNG CRYPTOGRAPHIC ENTROPY 96-BIT (AUTH-04)
-- Nguồn sinh mã: pgcrypto gen_random_bytes(12) -> 24 ký tự Hex ngẫu nhiên
-- ====================================================================

-- 1. Bổ sung cột parent_access_code (UNIQUE tự động tạo Unique Index)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS parent_access_code TEXT UNIQUE;

-- 2. Thực thi cấp mã tra cứu phụ huynh ngẫu nhiên bảo mật 96-bit cho các học sinh chưa có mã
DO $$
DECLARE
  r RECORD;
  v_code TEXT;
  v_exists BOOLEAN;
BEGIN
  FOR r IN SELECT id FROM public.profiles WHERE role = 'student' AND (parent_access_code IS NULL OR parent_access_code = '') LOOP
    LOOP
      -- Sinh mã dạng: PAR- + 24 ký tự Hex ngẫu nhiên bảo mật (96-bit entropy)
      v_code := 'PAR-' || UPPER(encode(gen_random_bytes(12), 'hex'));
      
      -- Kiểm tra trùng lặp trong public.profiles
      SELECT EXISTS (
        SELECT 1 FROM public.profiles WHERE parent_access_code = v_code
      ) INTO v_exists;
      
      IF NOT v_exists THEN
        UPDATE public.profiles
        SET parent_access_code = v_code
        WHERE id = r.id;
        EXIT;
      END IF;
    END LOOP;
  END LOOP;
END $$;
