-- ============================================================================
-- SQL MIGRATION: BẢNG DRY_RUN_RECEIPTS VÀ HÀM RPC KIỂM SOÁT SERVER-SIDE RECEIPT BINDING
-- FINAL CRASH/ROW-LEVEL RECOVERY GATE: LEASE TIMEOUT + FAIL-CLOSED RECOVERY + STRICT STATE TRANSITIONS
-- ============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS app_private;

-- 1. BẢNG APP_PRIVATE LƯU TRỮ DRY-RUN RECEIPTS (PHIẾU CHỨNG THỰC XEM TRƯỚC)
CREATE TABLE IF NOT EXISTS app_private.dry_run_receipts (
  token UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  canonical_fingerprint TEXT NOT NULL,
  review_required_count INT NOT NULL DEFAULT 0,
  total_students INT NOT NULL DEFAULT 0,
  ready_to_create_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'EXECUTING', 'CONSUMED', 'FAILED')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes'),
  executing_expires_at TIMESTAMPTZ, -- Hạn chót của khóa Lease khi ở trạng thái EXECUTING
  consumed_at TIMESTAMPTZ,
  consumed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT check_receipt_counts CHECK (
    review_required_count >= 0 AND 
    total_students >= 0 AND 
    ready_to_create_count >= 0 AND 
    ready_to_create_count <= total_students
  )
);

CREATE INDEX IF NOT EXISTS idx_dry_run_receipts_admin_class 
ON app_private.dry_run_receipts(admin_id, class_id, status);

CREATE INDEX IF NOT EXISTS idx_dry_run_receipts_expires 
ON app_private.dry_run_receipts(expires_at) 
WHERE status = 'COMPLETED';

CREATE INDEX IF NOT EXISTS idx_dry_run_receipts_executing_lease 
ON app_private.dry_run_receipts(executing_expires_at) 
WHERE status = 'EXECUTING';

-- THU HỒI TOÀN BỘ QUYỀN TRUY CẬP TRỰC TIẾP BẢNG TỪ PUBLIC, ANON VÀ AUTHENTICATED
REVOKE ALL ON TABLE app_private.dry_run_receipts FROM PUBLIC, anon, authenticated;

-- 2. HÀM RPC PHÁT HÀNH DRY-RUN RECEIPT (CHỈ BACKEND SERVICE_ROLE ĐƯỢC GỌI)
CREATE OR REPLACE FUNCTION public.issue_dry_run_receipt(
  p_admin_id UUID,
  p_class_id UUID,
  p_canonical_fingerprint TEXT,
  p_review_required_count INT,
  p_total_students INT,
  p_ready_to_create_count INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_role TEXT;
  v_token UUID;
  v_expires_at TIMESTAMPTZ;
BEGIN
  IF p_admin_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'UNAUTHORIZED', 'message', 'Thiếu admin_id.');
  END IF;

  SELECT role INTO v_admin_role FROM public.profiles WHERE id = p_admin_id;
  IF v_admin_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN', 'message', 'Từ chối truy cập: Tài khoản không phải Quản trị viên (Admin).');
  END IF;

  IF p_class_id IS NULL OR p_canonical_fingerprint IS NULL OR p_canonical_fingerprint = '' THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_PARAMS', 'message', 'Tham số phát hành receipt không hợp lệ.');
  END IF;

  IF COALESCE(p_review_required_count, 0) < 0 OR 
     COALESCE(p_total_students, 0) < 0 OR 
     COALESCE(p_ready_to_create_count, 0) < 0 OR 
     COALESCE(p_ready_to_create_count, 0) > COALESCE(p_total_students, 0) THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_COUNTS', 'message', 'Số liệu thống kê danh sách không hợp lệ.');
  END IF;

  v_token := gen_random_uuid();
  v_expires_at := NOW() + INTERVAL '15 minutes';

  INSERT INTO app_private.dry_run_receipts (
    token, admin_id, class_id, canonical_fingerprint, review_required_count,
    total_students, ready_to_create_count, status, expires_at, created_at, updated_at
  ) VALUES (
    v_token, p_admin_id, p_class_id, p_canonical_fingerprint, p_review_required_count,
    p_total_students, p_ready_to_create_count, 'COMPLETED', v_expires_at, NOW(), NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'ISSUED',
    'dryRunToken', v_token,
    'expiresAt', v_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_dry_run_receipt(UUID, UUID, TEXT, INT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_dry_run_receipt(UUID, UUID, TEXT, INT, INT, INT) TO service_role;

-- 3. HÀM RPC KHÓA RECEIPT ĐỂ THỰC THI (PHASE 1: CLAIM / LOCK ATOMICALLY KÈM LEASE TIMEOUT)
CREATE OR REPLACE FUNCTION public.claim_dry_run_receipt(
  p_token UUID,
  p_admin_id UUID,
  p_class_id UUID,
  p_canonical_fingerprint TEXT,
  p_lease_duration_seconds INT DEFAULT 180 -- Mặc định lease 3 phút
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rec app_private.dry_run_receipts%ROWTYPE;
  v_lease_expires_at TIMESTAMPTZ;
BEGIN
  IF p_token IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'MISSING_TOKEN', 'message', 'Thiếu dry_run_token bắt buộc.');
  END IF;

  IF p_admin_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'UNAUTHORIZED', 'message', 'Thiếu thông tin xác thực Admin.');
  END IF;

  -- Khóa dòng FOR UPDATE để bảo đảm Single Winner và chống race condition
  SELECT * INTO v_rec
  FROM app_private.dry_run_receipts
  WHERE token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 'RECEIPT_NOT_FOUND', 'message', 'Mã chứng thực xem trước (dry_run_token) không tồn tại.');
  END IF;

  IF v_rec.admin_id <> p_admin_id THEN
    RETURN jsonb_build_object('success', false, 'status', 'ADMIN_MISMATCH', 'message', 'Mã chứng thực xem trước không thuộc về tài khoản Quản trị viên hiện tại.');
  END IF;

  IF v_rec.status = 'CONSUMED' THEN
    RETURN jsonb_build_object('success', false, 'status', 'RECEIPT_ALREADY_CONSUMED', 'message', 'Mã chứng thực xem trước này đã được sử dụng hoàn tất trước đó.');
  END IF;

  -- XỬ LÝ STUCK EXECUTING LEASE RECOVERY (FAIL-CLOSED)
  IF v_rec.status = 'EXECUTING' THEN
    IF v_rec.executing_expires_at IS NOT NULL AND NOW() > v_rec.executing_expires_at THEN
      -- Khóa Lease đã hết hạn do tiến trình cũ bị sập (Crash) ➔ Tự động chuyển fail-closed sang FAILED
      UPDATE app_private.dry_run_receipts
      SET status = 'FAILED',
          updated_at = NOW()
      WHERE token = p_token;

      RETURN jsonb_build_object(
        'success', false, 
        'status', 'RECEIPT_LEASE_EXPIRED_FAILED', 
        'message', 'Tiến trình thực thi trước đó đã quá hạn khóa lease (Stuck Lease Expired); receipt đã được chuyển sang trạng thái FAILED. Vui lòng thực hiện Dry-Run mới.'
      );
    END IF;

    RETURN jsonb_build_object('success', false, 'status', 'RECEIPT_ALREADY_EXECUTING', 'message', 'Mã chứng thực xem trước này đang được một tiến trình khác xử lý.');
  END IF;

  IF v_rec.status = 'FAILED' THEN
    RETURN jsonb_build_object('success', false, 'status', 'RECEIPT_FAILED', 'message', 'Mã chứng thực xem trước đã ở trạng thái thất bại; bắt buộc thực hiện Dry-Run mới.');
  END IF;

  IF v_rec.status <> 'COMPLETED' THEN
    RETURN jsonb_build_object('success', false, 'status', 'RECEIPT_NOT_COMPLETED', 'message', 'Mã chứng thực xem trước không ở trạng thái sẵn sàng thực thi.');
  END IF;

  IF NOW() > v_rec.expires_at THEN
    RETURN jsonb_build_object('success', false, 'status', 'RECEIPT_EXPIRED', 'message', 'Phiên xem trước đã hết hạn. Vui lòng thực hiện kiểm tra trước lại.');
  END IF;

  IF v_rec.class_id <> p_class_id THEN
    RETURN jsonb_build_object('success', false, 'status', 'CLASS_MISMATCH', 'message', 'Lớp học đích không khớp với kết quả kiểm tra trước.');
  END IF;

  IF v_rec.canonical_fingerprint <> p_canonical_fingerprint THEN
    RETURN jsonb_build_object('success', false, 'status', 'PAYLOAD_MISMATCH', 'message', 'Danh sách học sinh không khớp với kết quả kiểm tra trước.');
  END IF;

  IF v_rec.review_required_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'status', 'REVIEW_REQUIRED_BLOCKED', 'message', 'Bản xem trước có cảnh báo cần xem xét thủ công; không được phép thực thi tạo tài khoản.');
  END IF;

  v_lease_expires_at := NOW() + (p_lease_duration_seconds || ' seconds')::INTERVAL;

  -- Cập nhật trạng thái sang EXECUTING nguyên tử kèm hạn chót lease
  UPDATE app_private.dry_run_receipts
  SET status = 'EXECUTING',
      executing_expires_at = v_lease_expires_at,
      updated_at = NOW()
  WHERE token = p_token;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'EXECUTING',
    'executingExpiresAt', v_lease_expires_at,
    'message', 'Đã khóa Dry-Run Receipt để bắt đầu thực thi tạo tài khoản.',
    'totalStudents', v_rec.total_students,
    'readyToCreate', v_rec.ready_to_create_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_dry_run_receipt(UUID, UUID, UUID, TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_dry_run_receipt(UUID, UUID, UUID, TEXT, INT) TO service_role;

-- 4. HÀM RPC PHỤC HỒI RECEIPT BỊ KẸT (RECOVER STUCK EXECUTING RECEIPT - ATOMIC SINGLE WINNER)
CREATE OR REPLACE FUNCTION public.recover_stuck_dry_run_receipt(
  p_token UUID,
  p_admin_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rec app_private.dry_run_receipts%ROWTYPE;
BEGIN
  IF p_token IS NULL OR p_admin_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_PARAMS', 'message', 'Thiếu tham số bắt buộc.');
  END IF;

  SELECT * INTO v_rec
  FROM app_private.dry_run_receipts
  WHERE token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 'RECEIPT_NOT_FOUND', 'message', 'Không tìm thấy receipt.');
  END IF;

  IF v_rec.admin_id <> p_admin_id THEN
    RETURN jsonb_build_object('success', false, 'status', 'ADMIN_MISMATCH', 'message', 'Mã chứng thực không thuộc tài khoản hiện tại.');
  END IF;

  IF v_rec.status = 'FAILED' THEN
    RETURN jsonb_build_object('success', true, 'status', 'ALREADY_FAILED', 'message', 'Receipt đã ở trạng thái FAILED từ trước.');
  END IF;

  IF v_rec.status <> 'EXECUTING' THEN
    RETURN jsonb_build_object('success', false, 'status', 'NOT_STUCK', 'message', 'Receipt không ở trạng thái EXECUTING.');
  END IF;

  IF v_rec.executing_expires_at IS NOT NULL AND NOW() <= v_rec.executing_expires_at THEN
    RETURN jsonb_build_object('success', false, 'status', 'LEASE_ACTIVE', 'message', 'Khóa lease vẫn đang còn hiệu lực; chưa thể phục hồi.');
  END IF;

  -- Chuyển sang FAILED fail-closed (tuyệt đối không chuyển lại COMPLETED)
  UPDATE app_private.dry_run_receipts
  SET status = 'FAILED',
      updated_at = NOW()
  WHERE token = p_token;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'FAILED',
    'message', 'Phục hồi thành công receipt bị kẹt sang trạng thái FAILED. Bắt buộc Admin thực hiện Dry-Run mới.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.recover_stuck_dry_run_receipt(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_stuck_dry_run_receipt(UUID, UUID) TO service_role;

-- 5. HÀM RPC HOÀN TẤT / THẤT BẠI RECEIPT (PHASE 2: FINALIZE)
CREATE OR REPLACE FUNCTION public.finalize_dry_run_receipt(
  p_token UUID,
  p_admin_id UUID,
  p_status TEXT -- 'CONSUMED' | 'FAILED'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rec app_private.dry_run_receipts%ROWTYPE;
BEGIN
  IF p_token IS NULL OR p_admin_id IS NULL OR p_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_PARAMS', 'message', 'Tham số cập nhật receipt không hợp lệ.');
  END IF;

  IF p_status NOT IN ('CONSUMED', 'FAILED') THEN
    RETURN jsonb_build_object(
      'success', false, 
      'status', 'INVALID_TARGET_STATUS', 
      'message', 'Trạng thái đích không hợp lệ. Chỉ cho phép finalize sang CONSUMED hoặc FAILED.'
    );
  END IF;

  SELECT * INTO v_rec
  FROM app_private.dry_run_receipts
  WHERE token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 'RECEIPT_NOT_FOUND', 'message', 'Không tìm thấy receipt cần hoàn tất.');
  END IF;

  IF v_rec.admin_id <> p_admin_id THEN
    RETURN jsonb_build_object('success', false, 'status', 'ADMIN_MISMATCH', 'message', 'Mã chứng thực xem trước không thuộc về tài khoản hiện tại.');
  END IF;

  IF v_rec.status <> 'EXECUTING' THEN
    RETURN jsonb_build_object(
      'success', false, 
      'status', 'INVALID_TRANSITION', 
      'message', 'Chuyển đổi trạng thái không hợp lệ: Receipt đang ở trạng thái ' || v_rec.status || '. Chỉ cho phép finalize khi receipt đang ở trạng thái EXECUTING.'
    );
  END IF;

  UPDATE app_private.dry_run_receipts
  SET status = p_status,
      consumed_at = CASE WHEN p_status = 'CONSUMED' THEN NOW() ELSE consumed_at END,
      consumed_by = CASE WHEN p_status = 'CONSUMED' THEN p_admin_id ELSE consumed_by END,
      updated_at = NOW()
  WHERE token = p_token AND admin_id = p_admin_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', p_status,
    'message', 'Cập nhật trạng thái cuối cùng của Dry-Run Receipt thành công.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_dry_run_receipt(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_dry_run_receipt(UUID, UUID, TEXT) TO service_role;

-- 6. VÔ HIỆU HÓA HOÀN TOÀN LEGACY CONSUME RPC (FAIL-CLOSED)
CREATE OR REPLACE FUNCTION public.consume_dry_run_receipt(
  p_token UUID,
  p_admin_id UUID,
  p_class_id UUID,
  p_canonical_fingerprint TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN jsonb_build_object(
    'success', false,
    'status', 'DEPRECATED_RPC_DISABLED',
    'message', 'Hàm RPC consume_dry_run_receipt đã bị vô hiệu hóa vĩnh viễn. Bắt buộc sử dụng quy trình Two-Phase Execution (claim_dry_run_receipt -> finalize_dry_run_receipt).'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_dry_run_receipt(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
