-- ============================================================================
-- SQL MIGRATION BẢO MẬT CẤP ENTERPRISE: BẢNG & RPC IDEMPOTENCY CÓ CLAIM TOKEN VÀ LEASE
-- + RATE LIMIT NGUYÊN TỬ NÂNG CAO (UPSERT + ROW-LEVEL LOCKING ORDER BY ASC FOR UPDATE)
-- ============================================================================

BEGIN;

-- 1. BẢNG APP_PRIVATE LƯU TRỮ IDEMPOTENCY LOGS CÓ CLAIM TOKEN VÀ LEASE
CREATE SCHEMA IF NOT EXISTS app_private;

CREATE TABLE IF NOT EXISTS app_private.batch_idempotency_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  claim_token UUID NOT NULL DEFAULT gen_random_uuid(),
  payload_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED')),
  processing_started_at TIMESTAMPTZ DEFAULT NOW(),
  lease_expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '5 minutes'),
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  response_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_admin_idempotency UNIQUE (admin_id, idempotency_key)
);

REVOKE ALL ON TABLE app_private.batch_idempotency_logs FROM PUBLIC, anon, authenticated;

-- 2. HÀM RPC CLAIM IDEMPOTENCY NGUYÊN TỬ (FAIL-CLOSED VỚI CLAIM TOKEN & LEASE)
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
  v_new_claim_token UUID;
BEGIN
  -- 1. Xác thực caller từ auth.uid()
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('status', 'UNAUTHORIZED', 'message', 'Chưa đăng nhập.');
  END IF;

  -- 2. Phân quyền Admin
  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('status', 'FORBIDDEN', 'message', 'Từ chối truy cập: Chỉ Admin mới được thực hiện.');
  END IF;

  IF p_idempotency_key IS NULL OR p_idempotency_key = '' THEN
    RETURN jsonb_build_object('status', 'INVALID_KEY', 'message', 'Thiếu idempotencyKey.');
  END IF;

  v_new_claim_token := gen_random_uuid();

  -- 3. Atomically Insert claim mới
  INSERT INTO app_private.batch_idempotency_logs (
    admin_id, idempotency_key, claim_token, payload_fingerprint, status, processing_started_at, lease_expires_at
  ) VALUES (
    v_caller_id, p_idempotency_key, v_new_claim_token, p_payload_fingerprint, 'PROCESSING', NOW(), NOW() + INTERVAL '5 minutes'
  ) ON CONFLICT (admin_id, idempotency_key) DO NOTHING;

  -- 4. Khóa hàng bằng FOR UPDATE để kiểm tra trạng thái và lease
  SELECT * INTO v_rec
  FROM app_private.batch_idempotency_logs
  WHERE admin_id = v_caller_id AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF v_rec.claim_token = v_new_claim_token AND v_rec.status = 'PROCESSING' THEN
    RETURN jsonb_build_object('status', 'CLAIMED', 'claim_token', v_new_claim_token);
  END IF;

  IF v_rec.payload_fingerprint <> p_payload_fingerprint THEN
    RETURN jsonb_build_object('status', 'PAYLOAD_MISMATCH', 'message', 'Mã Idempotency Key này đã được sử dụng cho một danh sách học sinh khác.');
  END IF;

  IF v_rec.status = 'COMPLETED' THEN
    RETURN jsonb_build_object('status', 'COMPLETED', 'response_data', v_rec.response_data);
  
  ELSIF v_rec.status = 'PROCESSING' THEN
    IF NOW() < v_rec.lease_expires_at THEN
      RETURN jsonb_build_object('status', 'PROCESSING_LEASE_ACTIVE', 'message', 'Yêu cầu batch này đang được hệ thống xử lý, vui lòng chờ.');
    ELSE
      -- Lease đã hết hạn (Edge function timeout/crash) -> Reclaim an toàn với claim_token mới
      UPDATE app_private.batch_idempotency_logs
      SET claim_token = v_new_claim_token,
          processing_started_at = NOW(),
          lease_expires_at = NOW() + INTERVAL '5 minutes',
          updated_at = NOW()
      WHERE id = v_rec.id;

      RETURN jsonb_build_object('status', 'CLAIMED_LEASE_RENEWED', 'claim_token', v_new_claim_token);
    END IF;

  ELSIF v_rec.status = 'FAILED' THEN
    UPDATE app_private.batch_idempotency_logs
    SET status = 'PROCESSING',
        claim_token = v_new_claim_token,
        processing_started_at = NOW(),
        lease_expires_at = NOW() + INTERVAL '5 minutes',
        failed_at = NULL,
        updated_at = NOW()
    WHERE id = v_rec.id;

    RETURN jsonb_build_object('status', 'CLAIMED_RETRY', 'claim_token', v_new_claim_token);
  END IF;

  RETURN jsonb_build_object('status', 'ERROR', 'message', 'Không thể xác định trạng thái idempotency.');
END;
$$;

REVOKE ALL ON FUNCTION public.claim_batch_idempotency(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_batch_idempotency(TEXT, TEXT) TO authenticated;

-- 3. HÀM RPC HEARTBEAT GIA HẠN LEASE IDEMPOTENCY (CHỈ CHO SERVICE_ROLE / CALLER THẬT KIỂM TRA LEASE)
CREATE OR REPLACE FUNCTION public.heartbeat_batch_idempotency(
  p_idempotency_key TEXT,
  p_claim_token UUID
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
  IF v_caller_id IS NULL THEN RETURN FALSE; END IF;

  UPDATE app_private.batch_idempotency_logs
  SET lease_expires_at = NOW() + INTERVAL '3 minutes',
      updated_at = NOW()
  WHERE admin_id = v_caller_id 
    AND idempotency_key = p_idempotency_key 
    AND claim_token = p_claim_token 
    AND status = 'PROCESSING'
    AND NOW() < lease_expires_at;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.heartbeat_batch_idempotency(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_batch_idempotency(TEXT, UUID) TO service_role;

-- 4. HÀM RPC HOÀN TẤT BATCH IDEMPOTENCY (SANITY CHECK: KHÔNG CHO LƯU PIN/SECRET TRONG RESPONSE_DATA)
CREATE OR REPLACE FUNCTION public.complete_batch_idempotency(
  p_idempotency_key TEXT,
  p_claim_token UUID,
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
  v_sanitized_data JSONB;
BEGIN
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN RETURN FALSE; END IF;

  -- LÀM SẠCH TUYỆT ĐỐI MỌI THÔNG TIN BẢO MẬT (PIN, JWT, EMAIL_PASS) TRƯỚC KHI LƯU VÀO CSDL LOGS
  v_sanitized_data := p_response_data #- '{results}';
  IF p_response_data ? 'results' THEN
    SELECT jsonb_set(
      p_response_data,
      '{results}',
      (
        SELECT COALESCE(jsonb_agg(
          elem - 'pin' - 'password' - 'jwt' - 'token'
        ), '[]'::jsonb)
        FROM jsonb_array_elements(p_response_data->'results') AS elem
      )
    ) INTO v_sanitized_data;
  END IF;

  IF p_is_success THEN
    UPDATE app_private.batch_idempotency_logs
    SET status = 'COMPLETED',
        completed_at = NOW(),
        response_data = v_sanitized_data,
        updated_at = NOW()
    WHERE admin_id = v_caller_id 
      AND idempotency_key = p_idempotency_key 
      AND claim_token = p_claim_token
      AND status = 'PROCESSING'
      AND NOW() < lease_expires_at;
  ELSE
    UPDATE app_private.batch_idempotency_logs
    SET status = 'FAILED',
        failed_at = NOW(),
        updated_at = NOW()
    WHERE admin_id = v_caller_id 
      AND idempotency_key = p_idempotency_key 
      AND claim_token = p_claim_token;
  END IF;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_batch_idempotency(TEXT, UUID, JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_batch_idempotency(TEXT, UUID, JSONB, BOOLEAN) TO service_role;

-- 5. BẢNG BỀN VỮNG LƯU TRỮ RATE LIMIT ĐĂNG NHẬP PIN
CREATE TABLE IF NOT EXISTS app_private.login_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier TEXT NOT NULL UNIQUE,
  failed_attempts INT DEFAULT 0,
  blocked_until TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ DEFAULT NOW()
);

REVOKE ALL ON TABLE app_private.login_rate_limits FROM PUBLIC, anon, authenticated;

-- 6. RPC VERIFY PIN NGUYÊN TỬ VỚI UPSERT TRƯỚC VÀ LOCKING CÓ THỨ TỰ SẮP XẾP (ORDER BY ASC FOR UPDATE)
CREATE OR REPLACE FUNCTION public.verify_student_pin_rate_limited(
  p_student_code TEXT,
  p_pin TEXT,
  p_ip_identifier TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clean_code TEXT;
  v_code_identifier TEXT;
  v_student_id UUID;
  v_email TEXT;
  v_pin_hash TEXT;
  v_is_valid BOOLEAN := FALSE;
  v_rate_rec RECORD;
  v_is_blocked BOOLEAN := FALSE;
BEGIN
  v_clean_code := UPPER(TRIM(p_student_code));
  v_code_identifier := 'code:' || v_clean_code;

  -- 1. ATOMIC UPSERT CẢ 2 IDENTIFIERS VÀO TABLE ĐỂ ĐẢM BẢO DÒNG LUÔN LÔN TỒN TẠI TRƯỚC KHÓA
  IF v_code_identifier IS NOT NULL AND v_code_identifier <> '' THEN
    INSERT INTO app_private.login_rate_limits (identifier, failed_attempts, last_attempt_at)
    VALUES (v_code_identifier, 0, NOW())
    ON CONFLICT (identifier) DO UPDATE SET last_attempt_at = NOW();
  END IF;

  IF p_ip_identifier IS NOT NULL AND p_ip_identifier <> '' THEN
    INSERT INTO app_private.login_rate_limits (identifier, failed_attempts, last_attempt_at)
    VALUES (p_ip_identifier, 0, NOW())
    ON CONFLICT (identifier) DO UPDATE SET last_attempt_at = NOW();
  END IF;

  -- 2. KHÓA DÒNG NGUYÊN TỬ THEO THỨ TỰ SẮP XẾP CỐ ĐỊNH (ORDER BY identifier ASC FOR UPDATE) TRÁNH DEADLOCK
  FOR v_rate_rec IN 
    SELECT * FROM app_private.login_rate_limits
    WHERE identifier IN (v_code_identifier, p_ip_identifier)
    ORDER BY identifier ASC
    FOR UPDATE
  LOOP
    IF v_rate_rec.blocked_until IS NOT NULL AND NOW() < v_rate_rec.blocked_until THEN
      v_is_blocked := TRUE;
    END IF;
  END LOOP;

  -- Nếu 1 trong 2 identifier bị khóa -> Trả về lỗi BLOCKED ngay lập tức
  IF v_is_blocked THEN
    RETURN jsonb_build_object('success', false, 'reason', 'BLOCKED');
  END IF;

  -- 3. TRA CỨU HỌC SINH TỪ SCHEMAS PUBLIC BẰNG SECURITY DEFINER
  SELECT id, email INTO v_student_id, v_email
  FROM public.profiles
  WHERE student_code = v_clean_code AND role = 'student';

  -- 4. XÁC MINH MÃ PIN HASH TRONG SCHEMAS APP_PRIVATE
  IF v_student_id IS NOT NULL THEN
    SELECT pin_hash INTO v_pin_hash
    FROM app_private.student_login_credentials
    WHERE student_id = v_student_id;

    IF v_pin_hash IS NOT NULL THEN
      v_is_valid := (v_pin_hash = extensions.crypt(trim(p_pin), v_pin_hash));
    END IF;
  END IF;

  -- 5. CẬP NHẬT TRẠNG THÁI RATE LIMIT CHO CẢ CODE VÀ IP IDENTIFIERS
  IF v_is_valid THEN
    -- Đúng PIN -> Reset số lần thử sai của code_identifier về 0, giảm IP attempts
    UPDATE app_private.login_rate_limits 
    SET failed_attempts = 0, blocked_until = NULL, last_attempt_at = NOW()
    WHERE identifier = v_code_identifier;

    IF p_ip_identifier IS NOT NULL AND p_ip_identifier <> '' THEN
      UPDATE app_private.login_rate_limits 
      SET failed_attempts = GREATEST(0, failed_attempts - 1), last_attempt_at = NOW()
      WHERE identifier = p_ip_identifier;
    END IF;

    RETURN jsonb_build_object(
      'success', true, 
      'student_id', v_student_id, 
      'email', v_email
    );
  ELSE
    -- Sai PIN HOẶC MÃ CHƯA TỒN TẠI -> Tăng số lần thử sai của cả Code và IP và áp dụng Exponential Backoff
    UPDATE app_private.login_rate_limits 
    SET failed_attempts = failed_attempts + 1, last_attempt_at = NOW()
    WHERE identifier IN (v_code_identifier, p_ip_identifier);

    -- Khóa 5 phút nếu sai >= 5 lần; khóa 30 phút nếu sai >= 10 lần
    UPDATE app_private.login_rate_limits 
    SET blocked_until = NOW() + INTERVAL '30 minutes'
    WHERE identifier IN (v_code_identifier, p_ip_identifier) AND failed_attempts >= 10;

    UPDATE app_private.login_rate_limits 
    SET blocked_until = NOW() + INTERVAL '5 minutes'
    WHERE identifier IN (v_code_identifier, p_ip_identifier) AND failed_attempts >= 5 AND failed_attempts < 10;

    RETURN jsonb_build_object('success', false, 'reason', 'INVALID_CREDENTIALS');
  END IF;
END;
$$;

-- CHỈ GRANT EXECUTE CHO SERVICE_ROLE (EDGE FUNCTION)
REVOKE ALL ON FUNCTION public.verify_student_pin_rate_limited(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_student_pin_rate_limited(TEXT, TEXT, TEXT) TO service_role;

-- 7. KIỂM TRA & TẠO CHÍNH THỨC UNIQUE INDEX TRÊN PUBLIC.PROFILES.STUDENT_CODE
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
    RAISE EXCEPTION 'MIGRATION STOPPED: Phát hiện % mã student_code bị trùng trong database! Cần làm sạch trước khi áp UNIQUE INDEX.', v_duplicate_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_student_code_unique 
ON public.profiles(student_code) 
WHERE student_code IS NOT NULL AND student_code <> '';

COMMIT;
