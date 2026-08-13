-- ====================================================================
-- MIGRATION: BỔ SUNG CỘT PARENT_ACCESS_CODE CHO BẢNG PUBLIC.PROFILES (AUTH-04)
-- Nguồn sinh mã: Cryptographically Secure Random (pgcrypto gen_random_bytes)
-- ====================================================================

-- 1. Bổ sung cột parent_access_code (Mã tra cứu phụ huynh ngẫu nhiên bảo mật, UNIQUE)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS parent_access_code TEXT UNIQUE;

-- 2. Hàm sinh mã ngẫu nhiên bảo mật không trùng lặp (Dạng: PAR-XXXXXXXX)
CREATE OR REPLACE FUNCTION app_private.generate_random_parent_code()
RETURNS TEXT AS $$
DECLARE
  v_code TEXT;
  v_exists BOOLEAN;
BEGIN
  LOOP
    -- Sinh 8 ký tự Hex ngẫu nhiên bảo mật bằng pgcrypto gen_random_bytes(4)
    v_code := 'PAR-' || UPPER(encode(gen_random_bytes(4), 'hex'));
    
    -- Kiểm tra mã có bị trùng trong public.profiles hay không
    SELECT EXISTS (
      SELECT 1 FROM public.profiles WHERE parent_access_code = v_code
    ) INTO v_exists;
    
    IF NOT v_exists THEN
      RETURN v_code;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Cập nhật mã ngẫu nhiên bảo mật cho các học sinh chưa có mã (Không ghi đè mã đã có)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.profiles WHERE role = 'student' AND (parent_access_code IS NULL OR parent_access_code = '') LOOP
    UPDATE public.profiles
    SET parent_access_code = app_private.generate_random_parent_code()
    WHERE id = r.id;
  END LOOP;
END $$;

-- 4. Tạo Index để tăng tốc độ tìm kiếm theo parent_access_code
CREATE INDEX IF NOT EXISTS idx_profiles_parent_access_code ON public.profiles(parent_access_code);
