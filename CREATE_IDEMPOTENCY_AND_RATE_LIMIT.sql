-- ============================================================================
-- SQL MIGRATION: BẢNG & RPC IDEMPOTENCY BỀN VỮNG + RATE LIMITING ĐĂNG NHẬP PIN
-- ============================================================================

BEGIN;

-- 1. BẢNG BẢO MẬT BÁO CÁO IDEMPOTENCY HÀNG LOẠT TRONG SCHEMAS APP_PRIVATE
CREATE SCHEMA IF NOT EXISTS app_private;

CREATE TABLE IF NOT EXISTS app_private.batch_idempotency_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  payload_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED')),
  response_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_admin_idempotency UNIQUE (admin_id, idempotency_key)
);

REVOKE ALL ON TABLE app_private.batch_idempotency_logs FROM PUBLIC, anon, authenticated;

-- 2. HÀM RPC CLAIM IDEMPOTENCY AN TOÀN (SECURITY DEFINER DÀNH CHO ADMIN)
CREATE OR REPLACE FUNCTION public.claim_batch_idempotency(
  p_idempotency_key TEXT,
  p_payload_fingerprint TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_existing_rec RECORD;
BEGIN
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('status', 'UNAUTHORIZED', 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('status', 'FORBIDDEN', 'message', 'Từ chối truy cập: Chỉ Quản trị viên mới được thực hiện.');
  END IF;

  IF p_idempotency_key IS NULL OR p_idempotency_key = '' THEN
    RETURN jsonb_build_object('status', 'INVALID_KEY', 'message', 'Thiếu idempotencyKey.');
  END IF;

  -- Kiểm tra sự tồn tại của idempotency key thuộc về Admin caller này
  SELECT * INTO v_existing_rec
  FROM app_private.batch_idempotency_logs
  WHERE admin_id = v_caller_id AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    -- Nếu key đã có nhưng fingerprint payload khác nhau -> Từ chối
    IF v_existing_rec.payload_fingerprint <> p_payload_fingerprint THEN
      RETURN jsonb_build_object('status', 'PAYLOAD_MISMATCH', 'message', 'Mã Idempotency Key này đã được sử dụng cho một danh sách học sinh khác.');
    END IF;

    IF v_existing_rec.status = 'COMPLETED' THEN
      RETURN jsonb_build_object('status', 'COMPLETED', 'response_data', v_existing_rec.response_data);
    ELSIF v_existing_rec.status = 'PROCESSING' THEN
      RETURN jsonb_build_object('status', 'PROCESSING', 'message', 'Yêu cầu batch này đang được hệ thống xử lý, vui lòng không bấm lặp.');
    END IF;
  END IF;

  -- Chưa có key -> Atomically Insert status = PROCESSING
  INSERT INTO app_private.batch_idempotency_logs (admin_id, idempotency_key, payload_fingerprint, status)
  VALUES (v_caller_id, p_idempotency_key, p_payload_fingerprint, 'PROCESSING')
  ON CONFLICT (admin_id, idempotency_key) DO NOTHING;

  RETURN jsonb_build_object('status', 'CLAIMED');
END;
$$;

REVOKE ALL ON FUNCTION public.claim_batch_idempotency(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_batch_idempotency(TEXT, TEXT) TO authenticated;

-- 3. HÀM RPC HOÀN TẤT BATCH IDEMPOTENCY
CREATE OR REPLACE FUNCTION public.complete_batch_idempotency(
  p_idempotency_key TEXT,
  p_response_data JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
BEGIN
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE app_private.batch_idempotency_logs
  SET status = 'COMPLETED',
      response_data = p_response_data,
      updated_at = NOW()
  WHERE admin_id = v_caller_id AND idempotency_key = p_idempotency_key;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_batch_idempotency(TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_batch_idempotency(TEXT, JSONB) TO authenticated;

-- 4. BẢNG BỀN VỮNG LƯU TRỮ RATE LIMIT ĐĂNG NHẬP PIN
CREATE TABLE IF NOT EXISTS app_private.login_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier TEXT NOT NULL UNIQUE, -- mã student_code hoặc IP identifier
  failed_attempts INT DEFAULT 0,
  blocked_until TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ DEFAULT NOW()
);

REVOKE ALL ON TABLE app_private.login_rate_limits FROM PUBLIC, anon, authenticated;

-- 5. NÂNG CẤP RPC VERIFY_STUDENT_PIN VỚI RATE LIMIT BỀN VỮNG & DỰ PHÒNG KHÓA ĐĂNG NHẬP
CREATE OR REPLACE FUNCTION public.verify_student_pin_rate_limited(
  p_student_id UUID,
  p_pin TEXT,
  p_rate_identifier TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pin_hash TEXT;
  v_rate_rec RECORD;
  v_is_valid BOOLEAN;
  v_lock_minutes INT;
BEGIN
  -- 1. Kiểm tra Rate Limit bền vững theo p_rate_identifier trong app_private.login_rate_limits
  IF p_rate_identifier IS NOT NULL AND p_rate_identifier <> '' THEN
    SELECT * INTO v_rate_rec
    FROM app_private.login_rate_limits
    WHERE identifier = p_rate_identifier;

    IF FOUND AND v_rate_rec.blocked_until IS NOT NULL AND NOW() < v_rate_rec.blocked_until THEN
      RETURN FALSE; -- Khóa đăng nhập bền vững
    END IF;
  END IF;

  -- 2. Kiểm tra PIN Hash trong app_private.student_login_credentials
  SELECT pin_hash INTO v_pin_hash
  FROM app_private.student_login_credentials
  WHERE student_id = p_student_id;

  IF v_pin_hash IS NULL THEN
    v_is_valid := FALSE;
  ELSE
    v_is_valid := (v_pin_hash = extensions.crypt(trim(p_pin), v_pin_hash));
  END IF;

  -- 3. Cập nhật trạng thái Rate Limit bền vững
  IF p_rate_identifier IS NOT NULL AND p_rate_identifier <> '' THEN
    IF v_is_valid IS TRUE THEN
      -- Đúng PIN -> Reset số lần sai về 0
      INSERT INTO app_private.login_rate_limits (identifier, failed_attempts, blocked_until, last_attempt_at)
      VALUES (p_rate_identifier, 0, NULL, NOW())
      ON CONFLICT (identifier) DO UPDATE
      SET failed_attempts = 0, blocked_until = NULL, last_attempt_at = NOW();
    ELSE
      -- Sai PIN -> Tăng số lần thử sai
      INSERT INTO app_private.login_rate_limits (identifier, failed_attempts, blocked_until, last_attempt_at)
      VALUES (p_rate_identifier, 1, NULL, NOW())
      ON CONFLICT (identifier) DO UPDATE
      SET failed_attempts = app_private.login_rate_limits.failed_attempts + 1,
          last_attempt_at = NOW();

      SELECT failed_attempts INTO v_lock_minutes
      FROM app_private.login_rate_limits
      WHERE identifier = p_rate_identifier;

      -- Exponential backoff: 5 lần sai -> khóa 5 phút; 10 lần sai -> khóa 30 phút
      IF v_lock_minutes >= 10 THEN
        UPDATE app_private.login_rate_limits 
        SET blocked_until = NOW() + INTERVAL '30 minutes'
        WHERE identifier = p_rate_identifier;
      ELSIF v_lock_minutes >= 5 THEN
        UPDATE app_private.login_rate_limits 
        SET blocked_until = NOW() + INTERVAL '5 minutes'
        WHERE identifier = p_rate_identifier;
      END IF;
    END IF;
  END IF;

  RETURN v_is_valid;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_student_pin_rate_limited(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_student_pin_rate_limited(UUID, TEXT, TEXT) TO service_role;

-- 6. KIỂM TRA & BẢO ĐẢM UNIQUE INDEX TRÊN PUBLIC.PROFILES.STUDENT_CODE
DO $$
DECLARE
  v_duplicate_count INT;
BEGIN
  SELECT COUNT(*) INTO v_duplicate_count
  FROM (
    SELECT student_code FROM public.profiles 
    WHERE student_code IS NOT NULL AND student_code <> ''
    GROUP BY student_code HAVING COUNT(*) > 1
  ) dups;

  IF v_duplicate_count > 0 THEN
    RAISE EXCEPTION 'TRANSACTION ROLLBACK: Phát hiện % mã học sinh (student_code) bị trùng lặp trong database! Cần làm sạch dữ liệu trước.', v_duplicate_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_student_code_unique 
ON public.profiles(student_code) 
WHERE student_code IS NOT NULL AND student_code <> '';

COMMIT;
