-- ============================================================================
-- SQL MIGRATION BẢO MẬT CẤP ENTERPRISE: BẢNG IDEMPOTENCY THEO BATCH_ID VÀ CLAIM_TOKEN
-- CHẤP NHẬN BATCH_ID + CLAIM_TOKEN TRONG RPC VÀ SANITIZE MỘT LẦN DÙNG SERVICE_ROLE
-- ============================================================================

BEGIN;

-- 1. BẢNG APP_PRIVATE LƯU TRỮ IDEMPOTENCY LOGS THEO BATCH_ID VÀ CLAIM_TOKEN
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

-- 2. HÀM RPC CLAIM IDEMPOTENCY NGUYÊN TỬ (TRẢ VỀ CẢ BATCH_ID VÀ CLAIM_TOKEN)
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
  -- 1. Lấy admin_id duy nhất từ JWT đã được Supabase xác minh
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

  -- 3. Insert claim mới theo cặp (admin_id, idempotency_key)
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
    RETURN jsonb_build_object(
      'status', 'CLAIMED', 
      'batch_id', v_rec.id, 
      'claim_token', v_new_claim_token
    );
  END IF;

  IF v_rec.payload_fingerprint <> p_payload_fingerprint THEN
    RETURN jsonb_build_object('status', 'PAYLOAD_MISMATCH', 'message', 'Mã Idempotency Key này đã được sử dụng cho một danh sách học sinh khác.');
  END IF;

  IF v_rec.status = 'COMPLETED' THEN
    -- Ghi nhận Request lặp -> Thêm cờ replayed: true và credentialsAvailable: false
    RETURN jsonb_build_object(
      'status', 'COMPLETED', 
      'batch_id', v_rec.id,
      'replayed', true,
      'credentialsAvailable', false,
      'response_data', v_rec.response_data
    );
  
  ELSIF v_rec.status = 'PROCESSING' THEN
    IF NOW() < v_rec.lease_expires_at THEN
      RETURN jsonb_build_object('status', 'PROCESSING_LEASE_ACTIVE', 'message', 'Yêu cầu batch này đang được hệ thống xử lý, vui lòng chờ.');
    ELSE
      -- Khóa hoàn toàn reclaim tự động khi batch Production bị dở dang để bảo vệ toàn vẹn dữ liệu
      UPDATE app_private.batch_idempotency_logs
      SET status = 'FAILED', failed_at = NOW(), updated_at = NOW()
      WHERE id = v_rec.id;

      RETURN jsonb_build_object('status', 'LEASE_EXPIRED_REQUIRES_ADMIN_REVIEW', 'message', 'Batch trước đó bị đứt đoạn dở dang. Đã đánh dấu FAILED để Admin xác minh.');
    END IF;

  ELSIF v_rec.status = 'FAILED' THEN
    RETURN jsonb_build_object('status', 'BATCH_FAILED_REQUIRES_ADMIN_REVIEW', 'message', 'Batch này đã bị thất bại ở lần chạy trước. Yêu cầu tạo IdempotencyKey mới.');
  END IF;

  RETURN jsonb_build_object('status', 'ERROR', 'message', 'Không thể xác định trạng thái idempotency.');
END;
$$;

REVOKE ALL ON FUNCTION public.claim_batch_idempotency(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_batch_idempotency(TEXT, TEXT) TO authenticated;

-- 3. HÀM RPC HEARTBEAT DÙNG SERVICE_ROLE (XÁC MINH CHÍNH XÁC CẢ BATCH_ID VÀ CLAIM_TOKEN)
CREATE OR REPLACE FUNCTION public.heartbeat_batch_idempotency(
  p_batch_id UUID,
  p_claim_token UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_batch_id IS NULL OR p_claim_token IS NULL THEN RETURN FALSE; END IF;

  UPDATE app_private.batch_idempotency_logs
  SET lease_expires_at = NOW() + INTERVAL '3 minutes',
      updated_at = NOW()
  WHERE id = p_batch_id 
    AND claim_token = p_claim_token 
    AND status = 'PROCESSING'
    AND NOW() < lease_expires_at;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.heartbeat_batch_idempotency(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_batch_idempotency(UUID, UUID) TO service_role;

-- 4. HÀM RPC HOÀN TẤT BATCH DÙNG SERVICE_ROLE (NHẬN BATCH_ID, CLAIM_TOKEN VÀ SANITIZE)
CREATE OR REPLACE FUNCTION public.complete_batch_idempotency(
  p_batch_id UUID,
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
  v_sanitized_results JSONB := '[]'::jsonb;
  v_sanitized_response JSONB;
BEGIN
  IF p_batch_id IS NULL OR p_claim_token IS NULL THEN RETURN FALSE; END IF;

  -- BẮT BUỘC SANITIZE BẰNG WHITELIST 100%: KHÔNG LƯU MÃ PIN VÀO CSDL LOGS
  IF p_response_data ? 'results' AND jsonb_typeof(p_response_data->'results') = 'array' THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'stt', elem->'stt',
        'fullName', elem->'fullName',
        'status', elem->'status',
        'studentCode', COALESCE(elem->'studentCode', '-'::jsonb),
        'studentId', COALESCE(elem->'studentId', '-'::jsonb),
        'note', COALESCE(elem->'note', ''::jsonb)
      )
    ), '[]'::jsonb)
    INTO v_sanitized_results
    FROM jsonb_array_elements(p_response_data->'results') AS elem;
  END IF;

  v_sanitized_response := jsonb_build_object(
    'success', COALESCE(p_response_data->'success', 'true'::jsonb),
    'dryRun', COALESCE(p_response_data->'dryRun', 'false'::jsonb),
    'message', COALESCE(p_response_data->'message', ''::jsonb),
    'className', COALESCE(p_response_data->'className', ''::jsonb),
    'classCode', COALESCE(p_response_data->'classCode', ''::jsonb),
    'summary', COALESCE(p_response_data->'summary', '{}'::jsonb),
    'results', v_sanitized_results
  );

  IF p_is_success THEN
    UPDATE app_private.batch_idempotency_logs
    SET status = 'COMPLETED',
        completed_at = NOW(),
        response_data = v_sanitized_response,
        updated_at = NOW()
    WHERE id = p_batch_id 
      AND claim_token = p_claim_token
      AND status = 'PROCESSING'
      AND NOW() < lease_expires_at;
  ELSE
    UPDATE app_private.batch_idempotency_logs
    SET status = 'FAILED',
        failed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_batch_id 
      AND claim_token = p_claim_token
      AND status = 'PROCESSING';
  END IF;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_batch_idempotency(UUID, UUID, JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_batch_idempotency(UUID, UUID, JSONB, BOOLEAN) TO service_role;

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

  IF v_is_blocked THEN
    RETURN jsonb_build_object('success', false, 'reason', 'BLOCKED');
  END IF;

  SELECT id, email INTO v_student_id, v_email
  FROM public.profiles
  WHERE student_code = v_clean_code AND role = 'student';

  IF v_student_id IS NOT NULL THEN
    SELECT pin_hash INTO v_pin_hash
    FROM app_private.student_login_credentials
    WHERE student_id = v_student_id;

    IF v_pin_hash IS NOT NULL THEN
      v_is_valid := (v_pin_hash = extensions.crypt(trim(p_pin), v_pin_hash));
    END IF;
  END IF;

  IF v_is_valid THEN
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
    UPDATE app_private.login_rate_limits 
    SET failed_attempts = failed_attempts + 1, last_attempt_at = NOW()
    WHERE identifier IN (v_code_identifier, p_ip_identifier);

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

REVOKE ALL ON FUNCTION public.verify_student_pin_rate_limited(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_student_pin_rate_limited(TEXT, TEXT, TEXT) TO service_role;

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
    RAISE EXCEPTION 'MIGRATION STOPPED: Phát hiện % mã student_code bị trùng trong database!', v_duplicate_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_student_code_unique 
ON public.profiles(student_code) 
WHERE student_code IS NOT NULL AND student_code <> '';

COMMIT;
