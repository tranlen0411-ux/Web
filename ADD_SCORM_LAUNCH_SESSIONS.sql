-- ====================================================================
-- MIGRATION: ADD SCORM LAUNCH SESSIONS & AUTHORIZED GATEWAY (PHASE 2B-1 FINAL LEAST PRIVILEGE)
-- Quản lý phiên khởi chạy SCORM ngắn hạn (Session TTL 10 phút Server-side)
-- Token Entropy: Sinh chuẩn 32 CSPRNG Random Bytes = 256 bits entropy qua pgcrypto extensions.gen_random_bytes(32)
-- Token Hashing: Băm SHA-256 qua pgcrypto extensions.digest(..., 'sha256')
-- Hỗ trợ đầy đủ Fresh Install và Upgrade Path từ phiên bản 2B-1 cũ
-- RPC-Only Table Contract: Khóa 100% Direct Table Access từ Browser (Anon & Authenticated)
-- Loại bỏ hoàn toàn legacy columns (public_share_token) và legacy broad RPCs
-- Dynamic Recheck cho Public Sessions khi Material Visibility thay đổi
-- ====================================================================

BEGIN;

-- 0. KÍCH HOẠT EXTENSION PGCRYPTO TRONG SCHEMA EXTENSIONS (BẮT BUỘC - SECURITY CRITICAL)
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


-- 1. TẠO HOẶC NÂNG CẤP BẢNG PUBLIC.SCORM_LAUNCH_SESSIONS
CREATE TABLE IF NOT EXISTS public.scorm_launch_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.scorm_packages(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES public.learning_materials(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  access_mode TEXT NOT NULL DEFAULT 'authenticated',
  session_token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_accessed_at TIMESTAMPTZ
);

-- 2. SCHEMA UPGRADE PATH CHO DATABASE ĐÃ TỒN TẠI TỪ BẢN CŨ
-- A. Thêm cột access_mode nếu chưa có và backfill an toàn
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'scorm_launch_sessions' 
      AND column_name = 'access_mode'
  ) THEN
    ALTER TABLE public.scorm_launch_sessions ADD COLUMN access_mode TEXT;
    
    UPDATE public.scorm_launch_sessions
    SET access_mode = CASE 
      WHEN user_id IS NOT NULL THEN 'authenticated' 
      ELSE 'public' 
    END
    WHERE access_mode IS NULL;

    ALTER TABLE public.scorm_launch_sessions ALTER COLUMN access_mode SET NOT NULL;
    ALTER TABLE public.scorm_launch_sessions ALTER COLUMN access_mode SET DEFAULT 'authenticated';
  END IF;
END $$;

-- B. Xóa bỏ cột legacy public_share_token nếu tồn tại
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'scorm_launch_sessions' 
      AND column_name = 'public_share_token'
  ) THEN
    ALTER TABLE public.scorm_launch_sessions DROP COLUMN public_share_token;
  END IF;
END $$;

-- C. Ràng buộc kiểm tra access_mode (Named Scoped Constraint - Idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'scorm_launch_sessions_access_mode_check' 
      AND conrelid = 'public.scorm_launch_sessions'::regclass
  ) THEN
    ALTER TABLE public.scorm_launch_sessions DROP CONSTRAINT scorm_launch_sessions_access_mode_check;
  END IF;

  ALTER TABLE public.scorm_launch_sessions 
    ADD CONSTRAINT scorm_launch_sessions_access_mode_check 
    CHECK (access_mode IN ('authenticated', 'public'));
END $$;

-- Tạo Index tối ưu tra cứu token hash và kiểm tra hạn dùng
CREATE INDEX IF NOT EXISTS idx_scorm_launch_sessions_token_hash ON public.scorm_launch_sessions(session_token_hash);
CREATE INDEX IF NOT EXISTS idx_scorm_launch_sessions_expires ON public.scorm_launch_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_scorm_launch_sessions_material ON public.scorm_launch_sessions(material_id);
CREATE INDEX IF NOT EXISTS idx_scorm_launch_sessions_user ON public.scorm_launch_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_scorm_launch_sessions_package ON public.scorm_launch_sessions(package_id);
CREATE INDEX IF NOT EXISTS idx_scorm_launch_sessions_access_mode ON public.scorm_launch_sessions(access_mode);


-- 3. KHÓA DIRECT TABLE ACCESS (RPC-ONLY CONTRACT)
-- Bật RLS và dọn dẹp các policies cũ
ALTER TABLE public.scorm_launch_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scorm_launch_sessions_admin_all" ON public.scorm_launch_sessions;
DROP POLICY IF EXISTS "scorm_launch_sessions_owner_select" ON public.scorm_launch_sessions;
DROP POLICY IF EXISTS "scorm_launch_sessions_user_select" ON public.scorm_launch_sessions;

-- Thu hồi TOÀN BỘ quyền truy cập trực tiếp trên bảng từ PUBLIC, anon, authenticated
-- Không cấp bất kỳ quyền SELECT/INSERT/UPDATE/DELETE nào cho client roles
REVOKE ALL ON public.scorm_launch_sessions FROM PUBLIC;
REVOKE ALL ON public.scorm_launch_sessions FROM anon;
REVOKE ALL ON public.scorm_launch_sessions FROM authenticated;

-- Chỉ cấp quyền cho backend / service_role / postgres
GRANT ALL ON public.scorm_launch_sessions TO service_role, postgres;


-- 4. DỌN DẸP LEGACY RPC FUNCTIONS (SIGNATURE CLEANUP)
DROP FUNCTION IF EXISTS public.create_scorm_launch_session(UUID, TEXT, TEXT, INT);
DROP FUNCTION IF EXISTS public.create_scorm_launch_session(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.create_scorm_launch_session(UUID, TEXT);
DROP FUNCTION IF EXISTS public.create_scorm_launch_session(UUID);
DROP FUNCTION IF EXISTS public.create_scorm_launch_session();


-- 5. FUNCTION TẠO SESSION CHO AUTHENTICATED USER (32 CSPRNG Random Bytes = 256 bits entropy & TTL 10 phút)
CREATE OR REPLACE FUNCTION public.create_scorm_launch_session_authenticated(
  p_material_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_material RECORD;
  v_package RECORD;
  v_session_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_has_permission BOOLEAN := FALSE;
  v_user_role TEXT;
  v_raw_token TEXT;
  v_token_hash TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Yêu cầu đăng nhập để tạo phiên học.';
  END IF;

  IF p_material_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: material_id không được để trống.';
  END IF;

  -- 1. Lấy thông tin tài liệu
  SELECT id, title, visibility, class_id, created_by
  INTO v_material
  FROM public.learning_materials
  WHERE id = p_material_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Không tìm thấy tài liệu học tập.';
  END IF;

  -- 2. Lấy role của user
  SELECT role INTO v_user_role
  FROM public.profiles
  WHERE id = v_user_id;

  -- 3. Kiểm tra phân quyền truy cập theo chuẩn Phase 1:
  IF v_user_role = 'admin' THEN
    v_has_permission := TRUE;
  ELSIF v_material.created_by = v_user_id THEN
    v_has_permission := TRUE;
  ELSIF v_material.visibility IN ('public', 'school') THEN
    v_has_permission := TRUE;
  ELSIF v_material.visibility = 'class' THEN
    IF EXISTS (
      SELECT 1 FROM public.class_members cm
      WHERE cm.class_id = v_material.class_id AND cm.student_id = v_user_id
    ) THEN
      v_has_permission := TRUE;
    ELSIF EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.id = v_material.class_id AND c.teacher_id = v_user_id
    ) THEN
      v_has_permission := TRUE;
    ELSIF EXISTS (
      SELECT 1 FROM public.learning_material_shares lms
      JOIN public.class_members cm ON cm.class_id = lms.class_id
      WHERE lms.material_id = v_material.id AND cm.student_id = v_user_id
    ) THEN
      v_has_permission := TRUE;
    ELSIF EXISTS (
      SELECT 1 FROM public.learning_material_shares lms
      JOIN public.classes c ON c.id = lms.class_id
      WHERE lms.material_id = v_material.id AND c.teacher_id = v_user_id
    ) THEN
      v_has_permission := TRUE;
    END IF;
  END IF;

  IF NOT v_has_permission THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Bạn không có quyền truy cập bài học này.';
  END IF;

  -- 4. Derive package từ material (Bắt buộc status = 'ready')
  SELECT id, material_id, package_version, scorm_version, launch_path, content_root, status
  INTO v_package
  FROM public.scorm_packages
  WHERE material_id = v_material.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Tài liệu này chưa được cấu hình gói SCORM.';
  END IF;

  IF v_package.status <> 'ready' THEN
    RAISE EXCEPTION 'PACKAGE_NOT_READY: Gói SCORM đang trong trạng thái % (chưa sẵn sàng).', v_package.status;
  END IF;

  -- 5. Server tự sinh 32 CSPRNG random bytes (256-bit entropy) và encode thành 64 hex chars qua pgcrypto
  v_raw_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_raw_token, 'UTF8'), 'sha256'), 'hex');
  v_expires_at := pg_catalog.now() + interval '10 minutes';

  -- 6. Lưu session (chỉ lưu token hash, không lưu raw token)
  INSERT INTO public.scorm_launch_sessions (
    package_id,
    material_id,
    user_id,
    access_mode,
    session_token_hash,
    expires_at,
    created_at
  )
  VALUES (
    v_package.id,
    v_material.id,
    v_user_id,
    'authenticated',
    v_token_hash,
    v_expires_at,
    pg_catalog.now()
  )
  RETURNING id INTO v_session_id;

  -- 7. Trả về raw token một lần duy nhất cho caller hợp lệ
  RETURN json_build_object(
    'success', true,
    'session_id', v_session_id,
    'session_token', v_raw_token,
    'package_id', v_package.id,
    'scorm_version', v_package.scorm_version,
    'launch_path', v_package.launch_path,
    'expires_at', v_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_scorm_launch_session_authenticated(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_scorm_launch_session_authenticated(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_scorm_launch_session_authenticated(UUID) TO authenticated;


-- 6. FUNCTION TẠO PUBLIC SCORM LAUNCH SESSION (Anon / Khách vãng lai)
CREATE OR REPLACE FUNCTION public.create_public_scorm_launch_session(
  p_share_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_material RECORD;
  v_package RECORD;
  v_session_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_raw_token TEXT;
  v_token_hash TEXT;
BEGIN
  IF p_share_token IS NULL OR trim(p_share_token) = '' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Mã chia sẻ công khai không được để trống.';
  END IF;

  -- 1. Tìm tài liệu theo share_token và visibility = 'public'
  SELECT id, title, visibility, class_id, created_by
  INTO v_material
  FROM public.learning_materials
  WHERE share_token = p_share_token
    AND visibility = 'public';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Mã chia sẻ không hợp lệ hoặc bài học không ở chế độ công khai.';
  END IF;

  -- 2. Derive package
  SELECT id, material_id, package_version, scorm_version, launch_path, content_root, status
  INTO v_package
  FROM public.scorm_packages
  WHERE material_id = v_material.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Tài liệu này chưa được cấu hình gói SCORM.';
  END IF;

  IF v_package.status <> 'ready' THEN
    RAISE EXCEPTION 'PACKAGE_NOT_READY: Gói SCORM chưa sẵn sàng để học công khai.';
  END IF;

  -- 3. Server sinh 32 CSPRNG random bytes (256-bit entropy) và encode thành 64 hex chars qua pgcrypto
  v_raw_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_raw_token, 'UTF8'), 'sha256'), 'hex');
  v_expires_at := pg_catalog.now() + interval '10 minutes';

  -- 4. Lưu session (user_id = NULL, access_mode = 'public')
  INSERT INTO public.scorm_launch_sessions (
    package_id,
    material_id,
    user_id,
    access_mode,
    session_token_hash,
    expires_at,
    created_at
  )
  VALUES (
    v_package.id,
    v_material.id,
    NULL,
    'public',
    v_token_hash,
    v_expires_at,
    pg_catalog.now()
  )
  RETURNING id INTO v_session_id;

  -- 5. Trả về sanitized response
  RETURN json_build_object(
    'success', true,
    'session_id', v_session_id,
    'session_token', v_raw_token,
    'package_id', v_package.id,
    'scorm_version', v_package.scorm_version,
    'launch_path', v_package.launch_path,
    'expires_at', v_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_public_scorm_launch_session(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_public_scorm_launch_session(TEXT) TO anon, authenticated;


-- 7. FUNCTION RESOLVE ASSET CHO TRUSTED GATEWAY (Dynamic Visibility Recheck)
CREATE OR REPLACE FUNCTION public.resolve_scorm_session_asset(
  p_session_token_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session RECORD;
  v_package RECORD;
  v_material_visibility TEXT;
BEGIN
  IF p_session_token_hash IS NULL OR trim(p_session_token_hash) = '' THEN
    RETURN json_build_object('valid', false, 'reason', 'EMPTY_TOKEN_HASH');
  END IF;

  -- 1. Tra cứu session
  SELECT id, package_id, material_id, user_id, access_mode, expires_at, revoked_at
  INTO v_session
  FROM public.scorm_launch_sessions
  WHERE session_token_hash = p_session_token_hash;

  IF NOT FOUND THEN
    RETURN json_build_object('valid', false, 'reason', 'SESSION_NOT_FOUND');
  END IF;

  -- 2. Kiểm tra thu hồi (Revocation)
  IF v_session.revoked_at IS NOT NULL THEN
    RETURN json_build_object('valid', false, 'reason', 'SESSION_REVOKED');
  END IF;

  -- 3. Kiểm tra hết hạn (Expiration)
  IF v_session.expires_at <= pg_catalog.now() THEN
    RETURN json_build_object('valid', false, 'reason', 'SESSION_EXPIRED');
  END IF;

  -- 4. Defense-in-depth: Dynamic Recheck cho Public Session khi Visibility thay đổi
  IF v_session.access_mode = 'public' THEN
    SELECT visibility INTO v_material_visibility
    FROM public.learning_materials
    WHERE id = v_session.material_id;

    IF v_material_visibility IS DISTINCT FROM 'public' THEN
      RETURN json_build_object('valid', false, 'reason', 'PUBLIC_ACCESS_REVOKED');
    END IF;
  END IF;

  -- 5. Lấy thông tin package
  SELECT id, material_id, scorm_version, launch_path, content_root, status
  INTO v_package
  FROM public.scorm_packages
  WHERE id = v_session.package_id;

  IF NOT FOUND THEN
    RETURN json_build_object('valid', false, 'reason', 'PACKAGE_NOT_FOUND');
  END IF;

  IF v_package.status <> 'ready' THEN
    RETURN json_build_object('valid', false, 'reason', 'PACKAGE_NOT_READY');
  END IF;

  -- 6. Cập nhật last_accessed_at
  UPDATE public.scorm_launch_sessions
  SET last_accessed_at = pg_catalog.now()
  WHERE id = v_session.id;

  -- 7. Trả về metadata nội bộ cho Trusted Gateway backend
  RETURN json_build_object(
    'valid', true,
    'session_id', v_session.id,
    'package_id', v_package.id,
    'content_root', v_package.content_root,
    'launch_path', v_package.launch_path,
    'scorm_version', v_package.scorm_version,
    'expires_at', v_session.expires_at
  );
END;
$$;

-- Resolver chỉ dành riêng cho Trusted Gateway (service_role, postgres)
REVOKE ALL ON FUNCTION public.resolve_scorm_session_asset(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_scorm_session_asset(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_scorm_session_asset(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_scorm_session_asset(TEXT) TO service_role, postgres;


-- 8. FUNCTION THU HỒI SESSION (REVOCATION)
CREATE OR REPLACE FUNCTION public.revoke_scorm_launch_session(
  p_session_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_session RECORD;
  v_is_admin BOOLEAN := FALSE;
  v_is_owner BOOLEAN := FALSE;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Cần đăng nhập để thu hồi phiên khởi chạy.';
  END IF;

  SELECT s.id, s.user_id, lm.created_by
  INTO v_session
  FROM public.scorm_launch_sessions s
  JOIN public.learning_materials lm ON lm.id = s.material_id
  WHERE s.id = p_session_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Kiểm tra quyền: Admin, Owner của tài liệu, hoặc chính User tạo session
  SELECT (role = 'admin') INTO v_is_admin FROM public.profiles WHERE id = v_user_id;
  v_is_owner := (v_session.created_by = v_user_id);

  IF v_is_admin OR v_is_owner OR (v_session.user_id = v_user_id) THEN
    UPDATE public.scorm_launch_sessions
    SET revoked_at = pg_catalog.now()
    WHERE id = p_session_id;
    RETURN TRUE;
  ELSE
    RAISE EXCEPTION 'PERMISSION_DENIED: Bạn không có quyền thu hồi phiên này.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_scorm_launch_session(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_scorm_launch_session(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.revoke_scorm_launch_session(UUID) TO authenticated, service_role, postgres;

COMMIT;
