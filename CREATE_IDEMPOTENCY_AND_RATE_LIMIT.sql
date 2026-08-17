-- ============================================================================
-- SQL MIGRATION BẢO MẬT BỀN VỮNG: BẢNG & RPC IDEMPOTENCY CÓ LEASE EXPIRY
-- + RATE LIMITING NGUYÊN TỬ VỚI ROW-LEVEL LOCKING & SECURITY DEFINER CHẶT CHẼ
-- ============================================================================

BEGIN;

-- 1. BẢNG BẢO MẬT BÁO CÁO IDEMPOTENCY CÓ LEASE TRONG APP_PRIVATE
CREATE SCHEMA IF NOT EXISTS app_private;

CREATE TABLE IF NOT EXISTS app_private.batch_idempotency_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  payload_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED')),
  processing_started_at TIMESTAMPTZ DEFAULT NOW(),
  lease_expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '2 minutes'),
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  response_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_admin_idempotency UNIQUE (admin_id, idempotency_key)
);

REVOKE ALL ON TABLE app_private.batch_idempotency_logs FROM PUBLIC, anon, authenticated;

-- 2. HÀM RPC CLAIM BATCH IDEMPOTENCY NGUYÊN TỬ CÓ LEASE EXPIRY
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
  v_rec RECORD;
BEGIN
  -- 1. Xác thực caller từ auth.uid()
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('status', 'UNAUTHORIZED', 'message', 'Chưa đăng nhập.');
  END IF;

  -- 2. Xác minh vai trò Admin của caller
  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('status', 'FORBIDDEN', 'message', 'Từ chối truy cập: Chỉ Admin mới được thực hiện.');
  END IF;

  IF p_idempotency_key IS NULL OR p_idempotency_key = '' THEN
    RETURN jsonb_build_object('status', 'INVALID_KEY', 'message', 'Thiếu idempotencyKey.');
  END IF;

  -- 3. Khóa dòng với FOR UPDATE nguyên tử (Row-Level Locking)
  SELECT * INTO v_rec
  FROM app_private.batch_idempotency_logs
  WHERE admin_id = v_caller_id AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    -- Nếu key trùng nhưng fingerprint payload khác nhau -> Từ chối
    IF v_rec.payload_fingerprint <> p_payload_fingerprint THEN
      RETURN jsonb_build_object('status', 'PAYLOAD_MISMATCH', 'message', 'Mã Idempotency Key này đã được sử dụng cho một danh sách học sinh khác.');
    END IF;

    IF v_rec.status = 'COMPLETED' THEN
      RETURN jsonb_build_object('status', 'COMPLETED', 'response_data', v_rec.response_data);
    
    ELSIF v_rec.status = 'PROCESSING' THEN
      -- Nếu đang PROCESSING nhưng lease chưa hết hạn -> Chặn lặp
      IF NOW() < v_rec.lease_expires_at THEN
        RETURN jsonb_build_object('status', 'PROCESSING_LEASE_ACTIVE', 'message', 'Yêu cầu batch này đang được hệ thống xử lý, vui lòng chờ.');
      ELSE
        -- Lease đã hết hạn (Edge function bị crash) -> Cho phép Reclaim gia hạn lease mới
        UPDATE app_private.batch_idempotency_logs
        SET processing_started_at = NOW(),
            lease_expires_at = NOW() + INTERVAL '2 minutes',
            updated_at = NOW()
        WHERE id = v_rec.id;
        RETURN jsonb_build_object('status', 'CLAIMED_LEASE_RENEWED');
      END IF;

    ELSIF v_rec.status = 'FAILED' THEN
      -- Nếu lần trước FAILED -> Cho phép retry và cập nhật PROCESSING
      UPDATE app_private.batch_idempotency_logs
      SET status = 'PROCESSING',
          processing_started_at = NOW(),
          lease_expires_at = NOW() + INTERVAL '2 minutes',
          failed_at = NULL,
          updated_at = NOW()
      WHERE id = v_rec.id;
      RETURN jsonb_build_object('status', 'CLAIMED_RETRY');
    END IF;
  END IF;

  -- Chưa từng có key -> Atomically Insert status = PROCESSING
  INSERT INTO app_private.batch_idempotency_logs (
    admin_id, idempotency_key, payload_fingerprint, status, processing_started_at, lease_expires_at
  ) VALUES (
    v_caller_id, p_idempotency_key, p_payload_fingerprint, 'PROCESSING', NOW(), NOW() + INTERVAL '2 minutes'
  ) ON CONFLICT (admin_id, idempotency_key) DO NOTHING;

  RETURN jsonb_build_object('status', 'CLAIMED');
END;
$$;

REVOKE ALL ON FUNCTION public.claim_batch_idempotency(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_batch_idempotency(TEXT, TEXT) TO authenticated;

-- 3. HÀM RPC HOÀN TẤT BATCH IDEMPOTENCY NGUYÊN TỬ
CREATE OR REPLACE FUNCTION public.complete_batch_idempotency(
  p_idempotency_key TEXT,
  p_response_data JSONB,
  p_is_success BOOLEAN DEFAULT TRUE
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

  IF p_is_success THEN
    UPDATE app_private.batch_idempotency_logs
    SET status = 'COMPLETED',
        completed_at = NOW(),
        response_data = p_response_data,
        updated_at = NOW()
    WHERE admin_id = v_caller_id AND idempotency_key = p_idempotency_key;
  ELSE
    UPDATE app_private.batch_idempotency_logs
    SET status = 'FAILED',
        failed_at = NOW(),
        updated_at = NOW()
    WHERE admin_id = v_caller_id AND idempotency_key = p_idempotency_key;
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_batch_idempotency(TEXT, JSONB, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_batch_idempotency(TEXT, JSONB, BOOLEAN) TO authenticated;

-- 4. BẢNG BỀN VỮNG LƯU TRỮ RATE LIMIT ĐĂNG NHẬP PIN TRONG SCHEMAS APP_PRIVATE
CREATE TABLE IF NOT EXISTS app_private.login_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier TEXT NOT NULL UNIQUE, -- E.g. 'code:HS201' OR 'ip:<hash>'
  failed_attempts INT DEFAULT 0,
  blocked_until TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ DEFAULT NOW()
);

REVOKE ALL ON TABLE app_private.login_rate_limits FROM PUBLIC, anon, authenticated;

-- 5. RPC VERIFY PIN NGUYÊN TỬ VỚI ROW-LEVEL LOCKING & LOCKING TIẾN TRÌNH KHÓA
CREATE OR REPLACE FUNCTION public.verify_student_pin_rate_limited(
  p_student_id UUID,
  p_pin TEXT,
  p_code_identifier TEXT,
  p_ip_identifier TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pin_hash TEXT;
  v_code_rec RECORD;
  v_ip_rec RECORD;
  v_is_valid BOOLEAN := FALSE;
  v_lock_minutes INT;
BEGIN
  -- A. Kiểm tra và khóa hàng cho Code Identifier
  IF p_code_identifier IS NOT NULL AND p_code_identifier <> '' THEN
    SELECT * INTO v_code_rec
    FROM app_private.login_rate_limits
    WHERE identifier = p_code_identifier
    FOR UPDATE;

    IF FOUND AND v_code_rec.blocked_until IS NOT NULL AND NOW() < v_code_rec.blocked_until THEN
      RETURN jsonb_build_object('success', false, 'reason', 'BLOCKED');
    END IF;
  END IF;

  -- B. Kiểm tra và khóa hàng cho IP Identifier
  IF p_ip_identifier IS NOT NULL AND p_ip_identifier <> '' THEN
    SELECT * INTO v_ip_rec
    FROM app_private.login_rate_limits
    WHERE identifier = p_ip_identifier
    FOR UPDATE;

    IF FOUND AND v_ip_rec.blocked_until IS NOT NULL AND NOW() < v_ip_rec.blocked_until THEN
      RETURN jsonb_build_object('success', false, 'reason', 'BLOCKED');
    END IF;
  END IF;

  -- C. Xác minh PIN Hash trong app_private.student_login_credentials
  SELECT pin_hash INTO v_pin_hash
  FROM app_private.student_login_credentials
  WHERE student_id = p_student_id;

  IF v_pin_hash IS NOT NULL THEN
    v_is_valid := (v_pin_hash = extensions.crypt(trim(p_pin), v_pin_hash));
  END IF;

  -- D. Cập nhật Rate Limit nguyên tử cho cả Code và IP Identifiers
  IF v_is_valid THEN
    -- ĐÚNG PIN -> Reset số lần sai của cả Code & IP về 0
    IF p_code_identifier IS NOT NULL AND p_code_identifier <> '' THEN
      INSERT INTO app_private.login_rate_limits (identifier, failed_attempts, blocked_until, last_attempt_at)
      VALUES (p_code_identifier, 0, NULL, NOW())
      ON CONFLICT (identifier) DO UPDATE SET failed_attempts = 0, blocked_until = NULL, last_attempt_at = NOW();
    END IF;

    IF p_ip_identifier IS NOT NULL AND p_ip_identifier <> '' THEN
      INSERT INTO app_private.login_rate_limits (identifier, failed_attempts, blocked_until, last_attempt_at)
      VALUES (p_ip_identifier, 0, NULL, NOW())
      ON CONFLICT (identifier) DO UPDATE SET failed_attempts = 0, blocked_until = NULL, last_attempt_at = NOW();
    END IF;

    RETURN jsonb_build_object('success', true);
  ELSE
    -- SAI PIN -> Tăng số lần sai của cả Code & IP và áp dụng Exponential Backoff
    IF p_code_identifier IS NOT NULL AND p_code_identifier <> '' THEN
      INSERT INTO app_private.login_rate_limits (identifier, failed_attempts, blocked_until, last_attempt_at)
      VALUES (p_code_identifier, 1, NULL, NOW())
      ON CONFLICT (identifier) DO UPDATE 
      SET failed_attempts = app_private.login_rate_limits.failed_attempts + 1, last_attempt_at = NOW();

      SELECT failed_attempts INTO v_lock_minutes FROM app_private.login_rate_limits WHERE identifier = p_code_identifier;
      IF v_lock_minutes >= 10 THEN
        UPDATE app_private.login_rate_limits SET blocked_until = NOW() + INTERVAL '30 minutes' WHERE identifier = p_code_identifier;
      ELSIF v_lock_minutes >= 5 THEN
        UPDATE app_private.login_rate_limits SET blocked_until = NOW() + INTERVAL '5 minutes' WHERE identifier = p_code_identifier;
      END IF;
    END IF;

    IF p_ip_identifier IS NOT NULL AND p_ip_identifier <> '' THEN
      INSERT INTO app_private.login_rate_limits (identifier, failed_attempts, blocked_until, last_attempt_at)
      VALUES (p_ip_identifier, 1, NULL, NOW())
      ON CONFLICT (identifier) DO UPDATE 
      SET failed_attempts = app_private.login_rate_limits.failed_attempts + 1, last_attempt_at = NOW();

      SELECT failed_attempts INTO v_lock_minutes FROM app_private.login_rate_limits WHERE identifier = p_ip_identifier;
      IF v_lock_minutes >= 10 THEN
        UPDATE app_private.login_rate_limits SET blocked_until = NOW() + INTERVAL '30 minutes' WHERE identifier = p_ip_identifier;
      ELSIF v_lock_minutes >= 5 THEN
        UPDATE app_private.login_rate_limits SET blocked_until = NOW() + INTERVAL '5 minutes' WHERE identifier = p_ip_identifier;
      END IF;
    END IF;

    RETURN jsonb_build_object('success', false, 'reason', 'INVALID_PIN');
  END IF;
END;
$$;

-- CHỈ CHẮC CHẮN SERVICE_ROLE ĐƯỢC EXECUTE HÀM VERIFY RATE LIMITED
REVOKE ALL ON FUNCTION public.verify_student_pin_rate_limited(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_student_pin_rate_limited(UUID, TEXT, TEXT, TEXT) TO service_role;

-- 6. KIỂM TRA VÀ TẠO CHÍNH THỨC UNIQUE INDEX TRÊN PUBLIC.PROFILES.STUDENT_CODE
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
    RAISE EXCEPTION 'TRANSACTION ROLLBACK: Phát hiện % student_code bị trùng lặp trong database! Cần dọn dẹp dữ liệu trùng trước khi áp UNIQUE constraint.', v_duplicate_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_student_code_unique 
ON public.profiles(student_code) 
WHERE student_code IS NOT NULL AND student_code <> '';

COMMIT;
