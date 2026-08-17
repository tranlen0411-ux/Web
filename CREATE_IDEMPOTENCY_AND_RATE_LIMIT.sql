-- ============================================================================
-- SQL MIGRATION BẢO MẬT CẤP ENTERPRISE: BẢNG IDEMPOTENCY THEO BATCH_ID VÀ CLAIM_TOKEN
-- + TIẾN ĐỘ DÒNG CÓ SHA-256 UNIQUE(BATCH_ID, ROW_KEY), TRẠNG THÁI BÀN GIAO CREDENTIALS
-- VÀ HÀM CONFIRM_CREDENTIALS_DELIVERY CÙNG SECURE PIN RESET
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
  credentials_delivery_status TEXT NOT NULL DEFAULT 'PENDING_DELIVERY' CHECK (credentials_delivery_status IN ('PENDING_DELIVERY', 'DELIVERED')),
  download_initiated_at TIMESTAMPTZ,
  credentials_confirmed_at TIMESTAMPTZ,
  credentials_delivered_at TIMESTAMPTZ,
  processing_started_at TIMESTAMPTZ DEFAULT NOW(),
  lease_expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '5 minutes'),
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  response_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_admin_idempotency UNIQUE (admin_id, idempotency_key)
);

ALTER TABLE app_private.batch_idempotency_logs
  ADD COLUMN IF NOT EXISTS claim_token UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS payload_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PROCESSING',
  ADD COLUMN IF NOT EXISTS credentials_delivery_status TEXT NOT NULL DEFAULT 'PENDING_DELIVERY',
  ADD COLUMN IF NOT EXISTS download_initiated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS credentials_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS credentials_delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '5 minutes'),
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS response_data JSONB,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS uq_batch_admin_idempotency
ON app_private.batch_idempotency_logs(admin_id, idempotency_key);

REVOKE ALL ON TABLE app_private.batch_idempotency_logs FROM PUBLIC, anon, authenticated;

-- 2. BẢNG TIẾN ĐỘ TỪNG DÒNG VỚI UNIQUE(BATCH_ID, ROW_KEY) BẰNG SHA-256
CREATE TABLE IF NOT EXISTS app_private.batch_student_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES app_private.batch_idempotency_logs(id) ON DELETE CASCADE,
  row_key TEXT NOT NULL,
  stt INT NOT NULL,
  full_name TEXT NOT NULL,
  student_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  student_code TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'SKIPPED')),
  credentials_delivery_status TEXT NOT NULL DEFAULT 'PENDING_DELIVERY' CHECK (credentials_delivery_status IN ('PENDING_DELIVERY', 'DELIVERED')),
  credentials_delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_batch_row_key UNIQUE (batch_id, row_key)
);

REVOKE ALL ON TABLE app_private.batch_student_rows FROM PUBLIC, anon, authenticated;

-- 2.1 BẢNG LƯU TRỮ CREDENTIALS MẬT KHẨU PIN HỌC SINH
CREATE TABLE IF NOT EXISTS app_private.student_login_credentials (
  student_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  pin_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

REVOKE ALL ON TABLE app_private.student_login_credentials FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_student_pin_service(p_student_id UUID, p_pin TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_pin IS NULL OR trim(p_pin) !~ '^[0-9]{4,6}$' THEN RETURN FALSE; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_student_id AND role='student') THEN RETURN FALSE; END IF;
  INSERT INTO app_private.student_login_credentials(student_id,pin_hash,updated_at)
  VALUES(p_student_id, extensions.crypt(trim(p_pin),extensions.gen_salt('bf')),NOW())
  ON CONFLICT(student_id) DO UPDATE SET pin_hash=EXCLUDED.pin_hash,updated_at=NOW();
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.set_student_pin_service(UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_student_pin_service(UUID,TEXT) TO service_role;

-- 3. HÀM RPC CLAIM IDEMPOTENCY NGUYÊN TỬ (TRẢ VỀ BATCH_ID VÀ CLAIM_TOKEN)
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
  -- Lấy admin_id duy nhất từ JWT xác minh
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('status', 'UNAUTHORIZED', 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('status', 'FORBIDDEN', 'message', 'Từ chối truy cập: Chỉ Admin mới được thực hiện.');
  END IF;

  IF p_idempotency_key IS NULL OR p_idempotency_key = '' THEN
    RETURN jsonb_build_object('status', 'INVALID_KEY', 'message', 'Thiếu idempotencyKey.');
  END IF;

  v_new_claim_token := gen_random_uuid();

  INSERT INTO app_private.batch_idempotency_logs (
    admin_id, idempotency_key, claim_token, payload_fingerprint, status, processing_started_at, lease_expires_at
  ) VALUES (
    v_caller_id, p_idempotency_key, v_new_claim_token, p_payload_fingerprint, 'PROCESSING', NOW(), NOW() + INTERVAL '5 minutes'
  ) ON CONFLICT (admin_id, idempotency_key) DO NOTHING;

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
    IF v_rec.credentials_delivery_status = 'DELIVERED' THEN
      RETURN jsonb_build_object(
        'status', 'COMPLETED', 
        'batch_id', v_rec.id,
        'replayed', true,
        'credentialsAvailable', false,
        'requiresPinReset', false,
        'response_data', v_rec.response_data
      );
    ELSE
      -- ĐÃ COMPLETED NHƯNG BÀN GIAO CHƯA XÁC NHẬN -> YÊU CẦU RESET PIN BẢO MẬT
      RETURN jsonb_build_object(
        'status', 'COMPLETED_PENDING_DELIVERY', 
        'batch_id', v_rec.id,
        'replayed', true,
        'credentialsAvailable', false,
        'requiresPinReset', true,
        'message', 'Tài khoản đã tạo nhưng Admin chưa tải CSV mật khẩu. Cần thực hiện cấp lại PIN bảo mật.',
        'response_data', v_rec.response_data
      );
    END IF;

  ELSIF v_rec.status = 'PROCESSING' THEN
    IF NOW() < v_rec.lease_expires_at THEN
      RETURN jsonb_build_object('status', 'PROCESSING_LEASE_ACTIVE', 'message', 'Yêu cầu batch này đang được hệ thống xử lý, vui lòng chờ.');
    ELSE
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

-- 4. RPC CONFIRM CREDENTIALS DELIVERY (XÁC NHẬN ĐÃ TẢI FILE CSV TỪ FRONTEND)
CREATE OR REPLACE FUNCTION public.initiate_credentials_download(p_batch_id UUID)
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
  SET download_initiated_at = COALESCE(download_initiated_at, NOW()),
      updated_at = NOW()
  WHERE id = p_batch_id
    AND admin_id = v_caller_id
    AND status = 'COMPLETED';

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.initiate_credentials_download(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.initiate_credentials_download(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_credentials_delivery(p_batch_id UUID)
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
  SET credentials_delivery_status = 'DELIVERED',
      credentials_delivered_at = COALESCE(credentials_delivered_at, NOW()),
      credentials_confirmed_at = COALESCE(credentials_confirmed_at, NOW()),
      updated_at = NOW()
  WHERE id = p_batch_id
    AND admin_id = v_caller_id
    AND status = 'COMPLETED'
    AND download_initiated_at IS NOT NULL
    AND credentials_delivery_status = 'PENDING_DELIVERY';

  IF FOUND THEN
    UPDATE app_private.batch_student_rows
    SET credentials_delivery_status = 'DELIVERED',
        credentials_delivered_at = NOW(),
        updated_at = NOW()
    WHERE batch_id = p_batch_id;
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_credentials_delivery(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_credentials_delivery(UUID) TO authenticated;

-- 5. RPC HEARTBEAT DÙNG SERVICE_ROLE
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

-- 6. RPC COMPLETE BATCH DÙNG SERVICE_ROLE (WHITELIST SANITIZATION)
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

  IF p_response_data ? 'results' AND jsonb_typeof(p_response_data->'results') = 'array' THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'stt', elem->'stt',
        'fullName', elem->'fullName',
        'status', elem->'status',
        'studentCode', COALESCE(elem->'studentCode', to_jsonb('-'::text)),
        'studentId', COALESCE(elem->'studentId', to_jsonb('-'::text)),
        'note', COALESCE(elem->'note', to_jsonb(''::text))
      )
    ), '[]'::jsonb)
    INTO v_sanitized_results
    FROM jsonb_array_elements(p_response_data->'results') AS elem;
  END IF;

  v_sanitized_response := jsonb_build_object(
    'success', COALESCE(p_response_data->'success', 'true'::jsonb),
    'dryRun', COALESCE(p_response_data->'dryRun', 'false'::jsonb),
    'message', COALESCE(p_response_data->'message', to_jsonb(''::text)),
    'className', COALESCE(p_response_data->'className', to_jsonb(''::text)),
    'classCode', COALESCE(p_response_data->'classCode', to_jsonb(''::text)),
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

CREATE OR REPLACE FUNCTION public.fail_batch_idempotency(
  p_batch_id UUID,
  p_claim_token UUID
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE app_private.batch_idempotency_logs
  SET status = 'FAILED', failed_at = NOW(), updated_at = NOW()
  WHERE id = p_batch_id AND claim_token = p_claim_token
    AND status = 'PROCESSING' AND NOW() < lease_expires_at;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.fail_batch_idempotency(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_batch_idempotency(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_student_row(
  p_batch_id UUID, p_claim_token UUID, p_row_key TEXT, p_stt INT, p_full_name TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row app_private.batch_student_rows%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app_private.batch_idempotency_logs
    WHERE id = p_batch_id AND claim_token = p_claim_token
      AND status = 'PROCESSING' AND NOW() < lease_expires_at
  ) THEN RETURN jsonb_build_object('claimed', false, 'reason', 'LEASE_INVALID'); END IF;

  INSERT INTO app_private.batch_student_rows(batch_id,row_key,stt,full_name,status)
  VALUES(p_batch_id,p_row_key,p_stt,p_full_name,'PROCESSING')
  ON CONFLICT(batch_id,row_key) DO UPDATE
    SET status='PROCESSING', updated_at=NOW()
    WHERE app_private.batch_student_rows.status IN ('PENDING','FAILED')
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    SELECT * INTO v_row FROM app_private.batch_student_rows
    WHERE batch_id=p_batch_id AND row_key=p_row_key;
    RETURN jsonb_build_object('claimed', false, 'status', v_row.status,
      'student_id', v_row.student_id, 'student_code', v_row.student_code);
  END IF;
  RETURN jsonb_build_object('claimed', true, 'row_id', v_row.id);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_student_row(UUID,UUID,TEXT,INT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_student_row(UUID,UUID,TEXT,INT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_student_row(
  p_batch_id UUID, p_claim_token UUID, p_row_key TEXT,
  p_student_id UUID, p_student_code TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_private.batch_idempotency_logs
    WHERE id=p_batch_id AND claim_token=p_claim_token AND status='PROCESSING'
      AND NOW()<lease_expires_at) THEN RETURN FALSE; END IF;
  UPDATE app_private.batch_student_rows
  SET status='COMPLETED', student_id=p_student_id, student_code=p_student_code, updated_at=NOW()
  WHERE batch_id=p_batch_id AND row_key=p_row_key AND status='PROCESSING';
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_student_row(UUID,UUID,TEXT,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_student_row(UUID,UUID,TEXT,UUID,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.fail_student_row(
  p_batch_id UUID, p_claim_token UUID, p_row_key TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_private.batch_idempotency_logs
    WHERE id=p_batch_id AND claim_token=p_claim_token AND status='PROCESSING'
      AND NOW()<lease_expires_at) THEN RETURN FALSE; END IF;
  UPDATE app_private.batch_student_rows SET status='FAILED', updated_at=NOW()
  WHERE batch_id=p_batch_id AND row_key=p_row_key AND status='PROCESSING';
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.fail_student_row(UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fail_student_row(UUID,UUID,TEXT) TO service_role;

-- 7. BẢNG BỀN VỮNG LƯU TRỮ RATE LIMIT ĐĂNG NHẬP PIN
CREATE TABLE IF NOT EXISTS app_private.login_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier TEXT NOT NULL UNIQUE,
  failed_attempts INT DEFAULT 0,
  blocked_until TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ DEFAULT NOW()
);

REVOKE ALL ON TABLE app_private.login_rate_limits FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS app_private.student_pin_reset_logs(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), admin_id UUID NOT NULL REFERENCES public.profiles(id),
  student_id UUID NOT NULL REFERENCES public.profiles(id), reset_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
REVOKE ALL ON TABLE app_private.student_pin_reset_logs FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.claim_student_pin_reset(p_admin_id UUID,p_student_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_admin_count INT; v_student_count INT;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_admin_id AND role='admin') THEN RETURN FALSE; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_student_id AND role='student' AND COALESCE(is_disabled,false)=false) THEN RETURN FALSE; END IF;
  SELECT COUNT(*) INTO v_admin_count FROM app_private.student_pin_reset_logs WHERE admin_id=p_admin_id AND reset_at>NOW()-INTERVAL '5 minutes';
  SELECT COUNT(*) INTO v_student_count FROM app_private.student_pin_reset_logs WHERE student_id=p_student_id AND reset_at>NOW()-INTERVAL '5 minutes';
  IF v_admin_count>=15 OR v_student_count>=3 THEN RETURN FALSE; END IF;
  INSERT INTO app_private.student_pin_reset_logs(admin_id,student_id) VALUES(p_admin_id,p_student_id);
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_student_pin_reset(UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_student_pin_reset(UUID,UUID) TO service_role;

-- 8. RPC VERIFY PIN NGUYÊN TỬ VỚI UPSERT TRƯỚC VÀ LOCKING CÓ THỨ TỰ SẮP XẾP (ORDER BY ASC FOR UPDATE)
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

-- 9. KIỂM TRA & TẠO CHÍNH THỨC UNIQUE INDEX TRÊN PUBLIC.PROFILES.STUDENT_CODE
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
