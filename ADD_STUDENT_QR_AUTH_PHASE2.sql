-- ============================================================================
-- SQL SCHEMA MIGRATION: HỆ THỐNG XÁC THỰC MÃ QR AN TOÀN CHO HỌC SINH (PHASE 2)
-- Tệp tin: ADD_STUDENT_QR_AUTH_PHASE2.sql (DRAFT ONLY - DO NOT RUN DIRECTLY)
-- Mô hình: QR Opaque Identifier (Server-generated) + Mã PIN hiện có
-- ============================================================================

-- 1. Bật Extension pgcrypto trong schema extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 2. Đảm bảo Schema bảo mật app_private tồn tại
CREATE SCHEMA IF NOT EXISTS app_private;

-- 3. Tạo bảng lưu trữ lịch sử & định danh mã QR của Học sinh (Audit Trail)
CREATE TABLE IF NOT EXISTS app_private.student_qr_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  qr_id_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'superseded')),
  card_version INT NOT NULL DEFAULT 1,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issued_by UUID NOT NULL REFERENCES public.profiles(id),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES public.profiles(id),
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Chặn toàn bộ quyền truy cập trực tiếp từ client (PUBLIC, anon, authenticated)
REVOKE ALL ON TABLE app_private.student_qr_cards FROM PUBLIC, anon, authenticated;

-- 5. Ràng buộc TỐI ĐA 1 MÃ QR 'active' DUY NHẤT cho mỗi học sinh (Partial Unique Index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_qr_one_active
ON app_private.student_qr_cards (student_id)
WHERE status = 'active';

-- 6. Index tối ưu tìm kiếm theo Hash cho luồng đăng nhập nhanh
CREATE INDEX IF NOT EXISTS idx_student_qr_hash_active
ON app_private.student_qr_cards (qr_id_hash)
WHERE status = 'active';

-- ============================================================================
-- 7. HÀM RPC: generate_student_qr_card (Phát hành / Cấp lại mã QR an toàn)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.generate_student_qr_card(
  p_student_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_target_role TEXT;
  v_is_my_student BOOLEAN;
  v_current_active_id UUID;
  v_latest_version INT;
  v_new_version INT;
  v_raw_token TEXT;
  v_hash TEXT;
  v_new_card_id UUID;
BEGIN
  -- 1. Xác thực caller từ token JWT
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- 2. Kiểm tra vai trò của caller từ public.profiles
  SELECT role INTO v_caller_role
  FROM public.profiles
  WHERE id = v_caller_id;

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'teacher') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- 3. Khóa hàng học sinh mục tiêu trong public.profiles để tuần tự hóa chống Race Condition
  SELECT role INTO v_target_role
  FROM public.profiles
  WHERE id = p_student_id
  FOR UPDATE;

  IF v_target_role IS NULL OR v_target_role != 'student' THEN
    RAISE EXCEPTION 'Mục tiêu không phải là tài khoản học sinh.';
  END IF;

  -- 4. Nếu caller là Giáo viên: Bắt buộc sở hữu lớp mà học sinh tham gia
  IF v_caller_role = 'teacher' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.classes c
      JOIN public.class_members cm ON c.id = cm.class_id
      WHERE c.teacher_id = v_caller_id AND cm.student_id = p_student_id
    ) INTO v_is_my_student;

    IF NOT v_is_my_student THEN
      RAISE EXCEPTION 'Từ chối truy cập: Giáo viên chỉ được phép cấp mã QR cho học sinh thuộc lớp mình.';
    END IF;
  END IF;

  -- 5. Thu hồi thẻ active hiện tại (nếu có) để chuẩn bị Reissue nguyên tử
  SELECT id INTO v_current_active_id
  FROM app_private.student_qr_cards
  WHERE student_id = p_student_id AND status = 'active'
  FOR UPDATE;

  IF v_current_active_id IS NOT NULL THEN
    UPDATE app_private.student_qr_cards
    SET status = 'superseded',
        revoked_at = NOW(),
        revoked_by = v_caller_id
    WHERE id = v_current_active_id;
  END IF;

  -- 6. Tính version mới nhất
  SELECT COALESCE(MAX(card_version), 0) INTO v_latest_version
  FROM app_private.student_qr_cards
  WHERE student_id = p_student_id;

  v_new_version := v_latest_version + 1;

  -- 7. Sinh chuỗi ngẫu nhiên CSPRNG 32 bytes (256-bit) từ Server (64 hex ký tự sau tiền tố qr_sec_)
  v_raw_token := 'qr_sec_' || encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := encode(extensions.digest(v_raw_token, 'sha256'), 'hex');

  -- 8. Lưu hash vào bảng app_private
  INSERT INTO app_private.student_qr_cards (
    student_id,
    qr_id_hash,
    status,
    card_version,
    issued_at,
    issued_by
  ) VALUES (
    p_student_id,
    v_hash,
    'active',
    v_new_version,
    NOW(),
    v_caller_id
  )
  RETURNING id INTO v_new_card_id;

  -- 9. Trả về raw_token duy nhất 1 lần để render/in thẻ
  RETURN jsonb_build_object(
    'success', true,
    'card_id', v_new_card_id,
    'student_id', p_student_id,
    'raw_qr_id', v_raw_token,
    'card_version', v_new_version,
    'issued_at', NOW()
  );
END;
$$;

-- Phân quyền hàm generate
REVOKE ALL ON FUNCTION public.generate_student_qr_card(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_student_qr_card(UUID) TO authenticated;


-- ============================================================================
-- 8. HÀM RPC: revoke_student_qr_card (Thu hồi thẻ QR an toàn có Concurrency Lock)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.revoke_student_qr_card(
  p_student_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_target_role TEXT;
  v_is_my_student BOOLEAN;
  v_active_card_id UUID;
BEGIN
  -- 1. Xác thực caller
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT role INTO v_caller_role
  FROM public.profiles
  WHERE id = v_caller_id;

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'teacher') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- 2. Khóa hàng học sinh trong public.profiles để tuần tự hóa cùng loại lock với generate
  SELECT role INTO v_target_role
  FROM public.profiles
  WHERE id = p_student_id
  FOR UPDATE;

  IF v_target_role IS NULL OR v_target_role != 'student' THEN
    RAISE EXCEPTION 'Mục tiêu không phải là tài khoản học sinh.';
  END IF;

  -- 3. Phân quyền Giáo viên
  IF v_caller_role = 'teacher' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.classes c
      JOIN public.class_members cm ON c.id = cm.class_id
      WHERE c.teacher_id = v_caller_id AND cm.student_id = p_student_id
    ) INTO v_is_my_student;

    IF NOT v_is_my_student THEN
      RAISE EXCEPTION 'Từ chối truy cập: Giáo viên chỉ được phép thu hồi mã QR của học sinh thuộc lớp mình.';
    END IF;
  END IF;

  -- 4. Tìm thẻ active và chuyển sang 'revoked'
  SELECT id INTO v_active_card_id
  FROM app_private.student_qr_cards
  WHERE student_id = p_student_id AND status = 'active'
  FOR UPDATE;

  IF v_active_card_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Học sinh không có thẻ QR nào đang hoạt động.');
  END IF;

  UPDATE app_private.student_qr_cards
  SET status = 'revoked',
      revoked_at = NOW(),
      revoked_by = v_caller_id
  WHERE id = v_active_card_id;

  RETURN jsonb_build_object('success', true, 'message', 'Đã thu hồi thẻ QR thành công.');
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_student_qr_card(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_student_qr_card(UUID) TO authenticated;


-- ============================================================================
-- 9. HÀM RPC: get_student_qr_status (Đọc trạng thái thẻ QR an toàn - Không lộ Token)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_student_qr_status(
  p_student_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_is_my_student BOOLEAN;
  v_rec RECORD;
BEGIN
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT role INTO v_caller_role
  FROM public.profiles
  WHERE id = v_caller_id;

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'teacher') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF v_caller_role = 'teacher' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.classes c
      JOIN public.class_members cm ON c.id = cm.class_id
      WHERE c.teacher_id = v_caller_id AND cm.student_id = p_student_id
    ) INTO v_is_my_student;

    IF NOT v_is_my_student THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  END IF;

  SELECT id, card_version, status, issued_at, last_used_at
  INTO v_rec
  FROM app_private.student_qr_cards
  WHERE student_id = p_student_id AND status = 'active';

  IF v_rec.id IS NULL THEN
    RETURN jsonb_build_object('has_active_qr', false);
  END IF;

  RETURN jsonb_build_object(
    'has_active_qr', true,
    'card_id', v_rec.id,
    'card_version', v_rec.card_version,
    'issued_at', v_rec.issued_at,
    'last_used_at', v_rec.last_used_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_qr_status(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_qr_status(UUID) TO authenticated;


-- ============================================================================
-- 10. HÀM RPC PUBLIC (SERVER-ONLY): verify_student_qr_and_pin_rate_limited
-- Xác thực đăng nhập QR + PIN có Rate Limit chống cạn kiệt bảng (Row Exhaustion Defense)
-- và chống Brute-Force phân tán (Distributed Attack Defense)
-- CHỈ CHO PHÉP service_role THỰC THI (Edge Function)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.verify_student_qr_and_pin_rate_limited(
  p_qr_id_hash TEXT,
  p_pin TEXT,
  p_ip_identifier TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clean_qr_hash TEXT;
  v_clean_pin TEXT;
  v_clean_ip TEXT;
  v_invalid_ip_key TEXT;
  v_ip_qr_key TEXT;
  v_qr_key TEXT;
  v_rate_rec RECORD;
  v_is_blocked BOOLEAN := FALSE;
  v_target_student_id UUID;
  v_target_email TEXT;
  v_target_disabled BOOLEAN;
  v_pin_hash TEXT;
  v_is_valid BOOLEAN := FALSE;
BEGIN
  -- 1. SQL INPUT DEFENSE: Kiểm tra định dạng đầu vào nghiêm ngặt
  -- p_qr_id_hash: chính xác 64 ký tự hex thường (SHA-256)
  -- p_pin: chính xác 4 đến 6 chữ số
  v_clean_qr_hash := LOWER(TRIM(COALESCE(p_qr_id_hash, '')));
  v_clean_pin := TRIM(COALESCE(p_pin, ''));

  IF v_clean_qr_hash !~ '^[0-9a-f]{64}$' OR v_clean_pin !~ '^[0-9]{4,6}$' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'INVALID_CREDENTIALS');
  END IF;

  v_clean_ip := REGEXP_REPLACE(COALESCE(TRIM(p_ip_identifier), 'unknown'), '^ip:', '');
  v_invalid_ip_key := 'invalid_qr_ip:' || v_clean_ip;

  -- 2. Kiểm tra Rate Limit cho IP bị khóa do quét mã QR không tồn tại
  IF v_clean_ip <> 'unknown' THEN
    SELECT blocked_until INTO v_rate_rec
    FROM app_private.login_rate_limits
    WHERE identifier = v_invalid_ip_key;

    IF v_rate_rec.blocked_until IS NOT NULL AND NOW() < v_rate_rec.blocked_until THEN
      RETURN jsonb_build_object('success', false, 'reason', 'BLOCKED');
    END IF;
  END IF;

  -- 3. Tìm thẻ QR đang active theo Hash (Truy vấn trước để phòng chống Row Exhaustion)
  SELECT c.student_id, p.email, p.is_disabled
  INTO v_target_student_id, v_target_email, v_target_disabled
  FROM app_private.student_qr_cards c
  JOIN public.profiles p ON p.id = c.student_id
  WHERE c.qr_id_hash = v_clean_qr_hash AND c.status = 'active';

  -- 4. TRƯỜNG HỢP A: Mã QR KHÔNG TỒN TẠI trên hệ thống
  -- Tuyệt đối KHÔNG tạo row rate-limit theo hash ngẫu nhiên để chống cạn kiệt bảng.
  -- Chỉ cập nhật bucket cố định invalid_qr_ip:<ip_hash> với ngưỡng rộng (25 lần)
  IF v_target_student_id IS NULL THEN
    IF v_clean_ip <> 'unknown' THEN
      INSERT INTO app_private.login_rate_limits (identifier, failed_attempts, last_attempt_at)
      VALUES (v_invalid_ip_key, 1, NOW())
      ON CONFLICT (identifier) DO UPDATE
      SET failed_attempts = app_private.login_rate_limits.failed_attempts + 1,
          last_attempt_at = NOW(),
          blocked_until = CASE
            WHEN app_private.login_rate_limits.failed_attempts + 1 >= 25 THEN NOW() + INTERVAL '15 minutes'
            ELSE NULL
          END;
    END IF;

    RETURN jsonb_build_object('success', false, 'reason', 'INVALID_CREDENTIALS');
  END IF;

  -- 5. TRƯỜNG HỢP B: Mã QR HỢP LỆ & ĐANG ACTIVE
  -- Sử dụng full SHA-256 QR hash trong key:
  -- Bucket 1: ip_qr:<ip_hash>:<full_qr_hash> (chống brute-force từ 1 IP)
  -- Bucket 2: qr:<full_qr_hash> (chống brute-force phân tán từ nhiều IP vào cùng 1 thẻ QR)
  v_ip_qr_key := 'ip_qr:' || v_clean_ip || ':' || v_clean_qr_hash;
  v_qr_key := 'qr:' || v_clean_qr_hash;

  -- Khởi tạo / cập nhật bản ghi rate limit trước khi lock
  IF v_ip_qr_key IS NOT NULL AND v_ip_qr_key <> '' THEN
    INSERT INTO app_private.login_rate_limits (identifier, failed_attempts, last_attempt_at)
    VALUES (v_ip_qr_key, 0, NOW())
    ON CONFLICT (identifier) DO UPDATE SET last_attempt_at = NOW();
  END IF;

  IF v_qr_key IS NOT NULL AND v_qr_key <> '' THEN
    INSERT INTO app_private.login_rate_limits (identifier, failed_attempts, last_attempt_at)
    VALUES (v_qr_key, 0, NOW())
    ON CONFLICT (identifier) DO UPDATE SET last_attempt_at = NOW();
  END IF;

  -- Khóa các hàng rate limit theo thứ tự sắp xếp ASC để tuần tự hóa chống Deadlock
  FOR v_rate_rec IN
    SELECT * FROM app_private.login_rate_limits
    WHERE identifier IN (v_ip_qr_key, v_qr_key)
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

  -- 6. Xác thực mã PIN và trạng thái tài khoản
  IF COALESCE(v_target_disabled, FALSE) = FALSE THEN
    SELECT pin_hash INTO v_pin_hash
    FROM app_private.student_login_credentials
    WHERE student_id = v_target_student_id;

    IF v_pin_hash IS NOT NULL THEN
      v_is_valid := (v_pin_hash = extensions.crypt(v_clean_pin, v_pin_hash));
    END IF;
  END IF;

  -- 7. Xử lý kết quả
  IF v_is_valid THEN
    -- ĐĂNG NHẬP THÀNH CÔNG -> Reset các bucket rate limit & cập nhật last_used_at của thẻ
    UPDATE app_private.login_rate_limits
    SET failed_attempts = 0, blocked_until = NULL, last_attempt_at = NOW()
    WHERE identifier IN (v_ip_qr_key, v_qr_key);

    -- Giảm hoặc xóa cờ invalid_qr_ip nếu có
    UPDATE app_private.login_rate_limits
    SET failed_attempts = GREATEST(0, failed_attempts - 1), last_attempt_at = NOW()
    WHERE identifier = v_invalid_ip_key;

    UPDATE app_private.student_qr_cards
    SET last_used_at = NOW()
    WHERE student_id = v_target_student_id AND status = 'active';

    RETURN jsonb_build_object(
      'success', true,
      'student_id', v_target_student_id,
      'email', v_target_email
    );
  ELSE
    -- ĐĂNG NHẬP THẤT BẠI (Học sinh bị khóa, thiếu PIN hash hoặc PIN sai)
    -- Ghi nhận thất bại vào cả 2 bucket của QR hợp lệ
    UPDATE app_private.login_rate_limits
    SET failed_attempts = failed_attempts + 1, last_attempt_at = NOW()
    WHERE identifier IN (v_ip_qr_key, v_qr_key);

    -- Phân tầng khóa tài khoản: >=10 lần khóa 30 phút, >=5 lần khóa 5 phút
    UPDATE app_private.login_rate_limits
    SET blocked_until = NOW() + INTERVAL '30 minutes'
    WHERE identifier IN (v_ip_qr_key, v_qr_key) AND failed_attempts >= 10;

    UPDATE app_private.login_rate_limits
    SET blocked_until = NOW() + INTERVAL '5 minutes'
    WHERE identifier IN (v_ip_qr_key, v_qr_key) AND failed_attempts >= 5 AND failed_attempts < 10;

    RETURN jsonb_build_object('success', false, 'reason', 'INVALID_CREDENTIALS');
  END IF;
END;
$$;

-- Phân quyền: CHỈ CẤP CHO service_role (Cấm tuyệt đối anon, authenticated, PUBLIC)
REVOKE ALL ON FUNCTION public.verify_student_qr_and_pin_rate_limited(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_student_qr_and_pin_rate_limited(TEXT, TEXT, TEXT) TO service_role;
