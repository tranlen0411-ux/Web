-- ====================================================================
-- 📦 MIGRATION: ADD_SCORM_CMI_PERSISTENCE.sql (SECURITY HARDENED)
-- ====================================================================
-- Mục đích: Cung cấp bảng lưu trữ RPC-ONLY và các RPC an toàn cho trạng thái
-- học tập SCORM 1.2 & 2004 (CMI Data Persistence - Phase 2B-2).
-- Ranh giới an ninh:
-- 1. RPC-ONLY table: Direct table INSERT/UPDATE/DELETE/SELECT bị khóa hoàn toàn.
-- 2. Chống Score Tampering: Validate min <= raw <= max, chặn NaN/Infinity/text.
-- 3. Chống Double Total Time: Ngăn chặn cộng dồn session_time trùng lặp khi double commit.
-- 4. Chống Concurrent Race: Row-level locking (FOR UPDATE) ngăn lost update.
-- 5. Session-Package Binding: Xác thực ràng buộc session token với package/user.
-- 6. Payload Limit: 128KB JSON payload & 64KB UTF-8 suspend_data.
-- 7. Leaderboard Boundary: Tuyệt đối không can thiệp Leaderboard / Xu thưởng.
-- ====================================================================

-- 1. BẢNG SCORM_TRACKING_DATA
CREATE TABLE IF NOT EXISTS public.scorm_tracking_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.scorm_packages(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES public.learning_materials(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scorm_version TEXT NOT NULL CHECK (scorm_version IN ('1.2', '2004')),

  -- Trạng thái hoàn thành & kết quả
  lesson_status TEXT,        -- SCORM 1.2: 'passed', 'completed', 'failed', 'incomplete', 'browsed', 'not attempted'
  completion_status TEXT,    -- SCORM 2004: 'completed', 'incomplete', 'not attempted', 'unknown'
  success_status TEXT,       -- SCORM 2004: 'passed', 'failed', 'unknown'

  -- Điểm dừng & Dữ liệu bài học
  lesson_location TEXT,
  suspend_data TEXT,

  -- Điểm số (Numeric)
  score_raw NUMERIC,
  score_min NUMERIC,
  score_max NUMERIC,

  -- Thời gian & Session Tracking
  session_time TEXT,
  total_time TEXT,
  last_session_token_hash TEXT,
  last_session_seconds NUMERIC DEFAULT 0,

  -- Bản sao toàn diện mô hình dữ liệu CMI
  cmi_data JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_scorm_tracking_user_package UNIQUE (user_id, package_id)
);

-- Chỉ mục tối ưu truy vấn
CREATE INDEX IF NOT EXISTS idx_scorm_tracking_user_package ON public.scorm_tracking_data(user_id, package_id);
CREATE INDEX IF NOT EXISTS idx_scorm_tracking_material_user ON public.scorm_tracking_data(material_id, user_id);

-- 2. KHÓA DIRECT TABLE ACCESS (RPC-ONLY CONTRACT)
-- Bật RLS
ALTER TABLE public.scorm_tracking_data ENABLE ROW LEVEL SECURITY;

-- Dọn dẹp policies cũ nếu có
DROP POLICY IF EXISTS "scorm_tracking_student_select" ON public.scorm_tracking_data;
DROP POLICY IF EXISTS "scorm_tracking_student_insert" ON public.scorm_tracking_data;
DROP POLICY IF EXISTS "scorm_tracking_student_update" ON public.scorm_tracking_data;
DROP POLICY IF EXISTS "scorm_tracking_teacher_select" ON public.scorm_tracking_data;
DROP POLICY IF EXISTS "scorm_tracking_admin_all" ON public.scorm_tracking_data;
DROP POLICY IF EXISTS "scorm_tracking_service_role_all" ON public.scorm_tracking_data;

-- Thu hồi TOÀN BỘ quyền truy cập trực tiếp từ client roles (PUBLIC, anon, authenticated)
REVOKE ALL ON TABLE public.scorm_tracking_data FROM PUBLIC;
REVOKE ALL ON TABLE public.scorm_tracking_data FROM anon;
REVOKE ALL ON TABLE public.scorm_tracking_data FROM authenticated;

-- Chỉ cấp quyền cho backend / service_role / postgres
GRANT ALL ON TABLE public.scorm_tracking_data TO service_role, postgres;

CREATE POLICY "scorm_tracking_service_role_all" ON public.scorm_tracking_data
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ====================================================================
-- 3. HÀM TIỆN ÍCH TÍNH TOÁN THỜI GIAN SCORM (DURATION ACCUMULATOR)
-- ====================================================================

-- Chuyển đổi chuỗi thời gian SCORM 1.2 (HHHH:MM:SS hoặc HH:MM:SS) sang giây
CREATE OR REPLACE FUNCTION public._scorm12_time_to_seconds(p_time TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_parts TEXT[];
  v_h NUMERIC := 0;
  v_m NUMERIC := 0;
  v_s NUMERIC := 0;
BEGIN
  IF p_time IS NULL OR trim(p_time) = '' THEN
    RETURN 0;
  END IF;

  v_parts := string_to_array(trim(p_time), ':');
  IF array_length(v_parts, 1) = 3 THEN
    v_h := COALESCE(v_parts[1]::numeric, 0);
    v_m := COALESCE(v_parts[2]::numeric, 0);
    v_s := COALESCE(v_parts[3]::numeric, 0);
    RETURN (v_h * 3600) + (v_m * 60) + v_s;
  ELSIF array_length(v_parts, 1) = 2 THEN
    v_m := COALESCE(v_parts[1]::numeric, 0);
    v_s := COALESCE(v_parts[2]::numeric, 0);
    RETURN (v_m * 60) + v_s;
  END IF;

  RETURN 0;
EXCEPTION
  WHEN OTHERS THEN
    RETURN 0;
END;
$$;

-- Chuyển đổi giây sang chuỗi SCORM 1.2 (HHHH:MM:SS)
CREATE OR REPLACE FUNCTION public._seconds_to_scorm12_time(p_seconds NUMERIC)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_total_sec BIGINT;
  v_h BIGINT;
  v_m BIGINT;
  v_s BIGINT;
BEGIN
  IF p_seconds IS NULL OR p_seconds <= 0 THEN
    RETURN '0000:00:00';
  END IF;

  v_total_sec := floor(p_seconds)::bigint;
  v_h := v_total_sec / 3600;
  v_m := (v_total_sec % 3600) / 60;
  v_s := v_total_sec % 60;

  RETURN lpad(v_h::text, 4, '0') || ':' || lpad(v_m::text, 2, '0') || ':' || lpad(v_s::text, 2, '0');
END;
$$;

-- Chuyển đổi chuỗi thời gian SCORM 2004 (ISO 8601 Duration e.g. PT1H23M45S) sang giây
CREATE OR REPLACE FUNCTION public._scorm2004_time_to_seconds(p_iso TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_text TEXT;
  v_h NUMERIC := 0;
  v_m NUMERIC := 0;
  v_s NUMERIC := 0;
  v_match TEXT[];
BEGIN
  IF p_iso IS NULL OR trim(p_iso) = '' THEN
    RETURN 0;
  END IF;

  v_text := upper(trim(p_iso));
  IF NOT v_text LIKE 'PT%' THEN
    RETURN 0;
  END IF;

  -- Regex trích xuất Hours
  v_match := regexp_matches(v_text, '([0-9]+(?:\.[0-9]+)?)H');
  IF v_match IS NOT NULL AND array_length(v_match, 1) >= 1 THEN
    v_h := v_match[1]::numeric;
  END IF;

  -- Regex trích xuất Minutes
  v_match := regexp_matches(v_text, '([0-9]+(?:\.[0-9]+)?)M');
  IF v_match IS NOT NULL AND array_length(v_match, 1) >= 1 THEN
    v_m := v_match[1]::numeric;
  END IF;

  -- Regex trích xuất Seconds
  v_match := regexp_matches(v_text, '([0-9]+(?:\.[0-9]+)?)S');
  IF v_match IS NOT NULL AND array_length(v_match, 1) >= 1 THEN
    v_s := v_match[1]::numeric;
  END IF;

  RETURN (v_h * 3600) + (v_m * 60) + v_s;
EXCEPTION
  WHEN OTHERS THEN
    RETURN 0;
END;
$$;

-- Chuyển đổi giây sang chuỗi SCORM 2004 (PT#H#M#S)
CREATE OR REPLACE FUNCTION public._seconds_to_scorm2004_time(p_seconds NUMERIC)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_total_sec BIGINT;
  v_h BIGINT;
  v_m BIGINT;
  v_s BIGINT;
BEGIN
  IF p_seconds IS NULL OR p_seconds <= 0 THEN
    RETURN 'PT0H0M0S';
  END IF;

  v_total_sec := floor(p_seconds)::bigint;
  v_h := v_total_sec / 3600;
  v_m := (v_total_sec % 3600) / 60;
  v_s := v_total_sec % 60;

  RETURN 'PT' || v_h::text || 'H' || v_m::text || 'M' || v_s::text || 'S';
END;
$$;

-- ====================================================================
-- 4. RPC LOAD TRẠNG THÁI HỌC TẬP (LOAD_SCORM_CMI_STATE)
-- ====================================================================

DROP FUNCTION IF EXISTS public.load_scorm_cmi_state(UUID);
DROP FUNCTION IF EXISTS public.load_scorm_cmi_state(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.load_scorm_cmi_state(
  p_package_id UUID,
  p_session_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_role TEXT;
  v_package RECORD;
  v_has_access BOOLEAN := FALSE;
  v_tracking RECORD;
  v_session RECORD;
  v_token_hash TEXT;
BEGIN
  -- 1. Xác thực người dùng
  v_user_id := (SELECT auth.uid());
  IF v_user_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', false,
      'code', 'UNAUTHORIZED',
      'message', 'Yêu cầu đăng nhập để nạp trạng thái học tập.'
    );
  END IF;

  -- 2. Kiểm tra bắt buộc Session Token
  IF p_session_token IS NULL OR pg_catalog.btrim(p_session_token) = '' THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', false,
      'code', 'SESSION_TOKEN_REQUIRED',
      'message', 'Yêu cầu session token hợp lệ để nạp trạng thái học tập.'
    );
  END IF;

  -- 3. Kiểm tra package tồn tại và ở trạng thái ready
  SELECT p.id, p.material_id, p.scorm_version, p.status, lm.created_by, lm.class_id, lm.visibility
  INTO v_package
  FROM public.scorm_packages p
  JOIN public.learning_materials lm ON lm.id = p.material_id
  WHERE p.id = p_package_id;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', false,
      'code', 'PACKAGE_NOT_FOUND',
      'message', 'Gói học liệu SCORM không tồn tại.'
    );
  END IF;

  IF v_package.status <> 'ready' THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', false,
      'code', 'PACKAGE_NOT_READY',
      'message', 'Gói học liệu SCORM chưa sẵn sàng để học.'
    );
  END IF;

  -- 4. Xác thực Launch Session Binding
  v_token_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.btrim(p_session_token), 'UTF8'), 'sha256'), 'hex');
  SELECT * INTO v_session
  FROM public.scorm_launch_sessions
  WHERE session_token_hash = v_token_hash;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'INVALID_SESSION', 'message', 'Phiên học không tồn tại.');
  END IF;

  IF v_session.package_id <> p_package_id THEN
    RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'SESSION_PACKAGE_MISMATCH', 'message', 'Phiên học không khớp với gói SCORM yêu cầu.');
  END IF;

  IF v_session.user_id IS DISTINCT FROM v_user_id THEN
    RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'SESSION_USER_MISMATCH', 'message', 'Phiên học không thuộc về tài khoản này.');
  END IF;

  IF v_session.revoked_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'SESSION_REVOKED', 'message', 'Phiên học đã bị thu hồi.');
  END IF;

  IF v_session.expires_at <= pg_catalog.now() THEN
    RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'SESSION_EXPIRED', 'message', 'Phiên học đã hết hạn.');
  END IF;

  -- 5. Kiểm tra phân quyền truy cập học liệu của user
  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;

  IF v_role = 'admin' OR v_package.created_by = v_user_id THEN
    v_has_access := TRUE;
  ELSIF v_package.visibility IN ('public', 'school') THEN
    v_has_access := TRUE;
  ELSIF v_package.visibility = 'class' THEN
    -- Học sinh thuộc lớp chính
    IF v_package.class_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.class_members
        WHERE class_id = v_package.class_id AND student_id = v_user_id
      ) THEN
        v_has_access := TRUE;
      ELSIF EXISTS (
        SELECT 1 FROM public.classes c
        WHERE c.id = v_package.class_id AND c.teacher_id = v_user_id
      ) THEN
        v_has_access := TRUE;
      END IF;
    END IF;

    -- Học sinh / Giáo viên thuộc lớp được chia sẻ
    IF NOT v_has_access THEN
      IF EXISTS (
        SELECT 1 FROM public.learning_material_shares lms
        JOIN public.class_members cm ON cm.class_id = lms.class_id
        WHERE lms.material_id = v_package.material_id AND cm.student_id = v_user_id
      ) THEN
        v_has_access := TRUE;
      ELSIF EXISTS (
        SELECT 1 FROM public.learning_material_shares lms
        JOIN public.classes c ON c.id = lms.class_id
        WHERE lms.material_id = v_package.material_id AND c.teacher_id = v_user_id
      ) THEN
        v_has_access := TRUE;
      END IF;
    END IF;
  END IF;

  IF NOT v_has_access THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', false,
      'code', 'FORBIDDEN',
      'message', 'Bạn không có quyền truy cập học liệu này.'
    );
  END IF;

  -- 6. Truy vấn bản ghi tracking của user
  SELECT *
  INTO v_tracking
  FROM public.scorm_tracking_data
  WHERE user_id = v_user_id AND package_id = p_package_id;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', true,
      'tracking', NULL,
      'scorm_version', v_package.scorm_version
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'scorm_version', v_tracking.scorm_version,
    'tracking', pg_catalog.jsonb_build_object(
      'lesson_status', v_tracking.lesson_status,
      'completion_status', v_tracking.completion_status,
      'success_status', v_tracking.success_status,
      'lesson_location', v_tracking.lesson_location,
      'suspend_data', v_tracking.suspend_data,
      'score_raw', v_tracking.score_raw,
      'score_min', v_tracking.score_min,
      'score_max', v_tracking.score_max,
      'session_time', v_tracking.session_time,
      'total_time', v_tracking.total_time,
      'cmi_data', v_tracking.cmi_data,
      'updated_at', v_tracking.updated_at
    )
  );
END;
$$;

-- ====================================================================
-- 5. RPC LƯU TRẠNG THÁI HỌC TẬP (SAVE_SCORM_CMI_STATE)
-- ====================================================================

DROP FUNCTION IF EXISTS public.save_scorm_cmi_state(UUID, JSONB);
DROP FUNCTION IF EXISTS public.save_scorm_cmi_state(UUID, JSONB, TEXT);

CREATE OR REPLACE FUNCTION public.save_scorm_cmi_state(
  p_package_id UUID,
  p_cmi_payload JSONB,
  p_session_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_role TEXT;
  v_package RECORD;
  v_has_access BOOLEAN := FALSE;
  v_existing RECORD;
  v_session RECORD;
  v_token_hash TEXT;

  v_scorm_version TEXT;
  v_lesson_status TEXT;
  v_completion_status TEXT;
  v_success_status TEXT;
  v_lesson_location TEXT;
  v_suspend_data TEXT;
  v_score_raw NUMERIC;
  v_score_min NUMERIC;
  v_score_max NUMERIC;
  v_session_time TEXT;
  v_total_time TEXT;

  v_raw_str TEXT;
  v_min_str TEXT;
  v_max_str TEXT;

  v_cur_total_sec NUMERIC := 0;
  v_session_sec NUMERIC := 0;
  v_last_session_sec NUMERIC := 0;
  v_new_total_sec NUMERIC := 0;
  v_updated_at TIMESTAMPTZ;
BEGIN
  -- 1. Xác thực người dùng (Auth Check)
  v_user_id := (SELECT auth.uid());
  IF v_user_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', false,
      'code', 'UNAUTHORIZED',
      'message', 'Yêu cầu đăng nhập để lưu trạng thái học tập.'
    );
  END IF;

  -- 2. Kiểm tra bắt buộc Session Token
  IF p_session_token IS NULL OR pg_catalog.btrim(p_session_token) = '' THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', false,
      'code', 'SESSION_TOKEN_REQUIRED',
      'message', 'Yêu cầu session token hợp lệ để lưu trạng thái học tập.'
    );
  END IF;

  -- 3. Kiểm tra Payload Size Limits (UTF-8 Byte Length)
  IF p_cmi_payload IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'INVALID_PAYLOAD', 'message', 'Payload CMI không được rỗng.');
  END IF;

  -- Giới hạn toàn bộ JSON payload: 128KB (131072 bytes)
  IF pg_catalog.octet_length(p_cmi_payload::text) > 131072 THEN
    RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'PAYLOAD_TOO_LARGE', 'message', 'Payload CMI vượt quá hạn mức tối đa (128KB).');
  END IF;

  -- Giới hạn suspend_data: 64KB (65536 bytes UTF-8)
  v_suspend_data := p_cmi_payload->>'cmi.suspend_data';
  IF v_suspend_data IS NOT NULL AND pg_catalog.octet_length(v_suspend_data) > 65536 THEN
    RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'SUSPEND_DATA_TOO_LARGE', 'message', 'Dữ liệu suspend_data vượt quá hạn mức 64KB.');
  END IF;

  -- 4. Kiểm tra package tồn tại và trạng thái ready
  SELECT p.id, p.material_id, p.scorm_version, p.status, lm.created_by, lm.class_id, lm.visibility
  INTO v_package
  FROM public.scorm_packages p
  JOIN public.learning_materials lm ON lm.id = p.material_id
  WHERE p.id = p_package_id;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'PACKAGE_NOT_FOUND', 'message', 'Gói học liệu SCORM không tồn tại.');
  END IF;

  IF v_package.status <> 'ready' THEN
    RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'PACKAGE_NOT_READY', 'message', 'Gói học liệu chưa sẵn sàng.');
  END IF;

  v_scorm_version := v_package.scorm_version;

  -- 5. Xác thực Launch Session Binding
  v_token_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.btrim(p_session_token), 'UTF8'), 'sha256'), 'hex');
  SELECT * INTO v_session
  FROM public.scorm_launch_sessions
  WHERE session_token_hash = v_token_hash;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'INVALID_SESSION', 'message', 'Phiên học không tồn tại.');
  END IF;

  IF v_session.package_id <> p_package_id THEN
    RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'SESSION_PACKAGE_MISMATCH', 'message', 'Phiên học không khớp với gói SCORM yêu cầu.');
  END IF;

  IF v_session.user_id IS DISTINCT FROM v_user_id THEN
    RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'SESSION_USER_MISMATCH', 'message', 'Phiên học không thuộc về tài khoản này.');
  END IF;

  IF v_session.revoked_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'SESSION_REVOKED', 'message', 'Phiên học đã bị thu hồi.');
  END IF;

  IF v_session.expires_at <= pg_catalog.now() THEN
    RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'SESSION_EXPIRED', 'message', 'Phiên học đã hết hạn.');
  END IF;

  -- 6. Kiểm tra phân quyền truy cập
  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;

  IF v_role = 'admin' OR v_package.created_by = v_user_id THEN
    v_has_access := TRUE;
  ELSIF v_package.visibility IN ('public', 'school') THEN
    v_has_access := TRUE;
  ELSIF v_package.visibility = 'class' THEN
    IF v_package.class_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.class_members
        WHERE class_id = v_package.class_id AND student_id = v_user_id
      ) THEN
        v_has_access := TRUE;
      ELSIF EXISTS (
        SELECT 1 FROM public.classes c
        WHERE c.id = v_package.class_id AND c.teacher_id = v_user_id
      ) THEN
        v_has_access := TRUE;
      END IF;
    END IF;

    IF NOT v_has_access THEN
      IF EXISTS (
        SELECT 1 FROM public.learning_material_shares lms
        JOIN public.class_members cm ON cm.class_id = lms.class_id
        WHERE lms.material_id = v_package.material_id AND cm.student_id = v_user_id
      ) THEN
        v_has_access := TRUE;
      ELSIF EXISTS (
        SELECT 1 FROM public.learning_material_shares lms
        JOIN public.classes c ON c.id = lms.class_id
        WHERE lms.material_id = v_package.material_id AND c.teacher_id = v_user_id
      ) THEN
        v_has_access := TRUE;
      END IF;
    END IF;
  END IF;

  IF NOT v_has_access THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'message', 'Bạn không có quyền lưu trạng thái học liệu này.');
  END IF;

  -- 6. Trích xuất & Validate CMI fields theo phiên bản SCORM
  IF v_scorm_version = '1.2' THEN
    v_lesson_status := p_cmi_payload->>'cmi.core.lesson_status';
    v_lesson_location := p_cmi_payload->>'cmi.core.lesson_location';
    v_session_time := p_cmi_payload->>'cmi.core.session_time';

    v_raw_str := p_cmi_payload->>'cmi.core.score.raw';
    v_min_str := p_cmi_payload->>'cmi.core.score.min';
    v_max_str := p_cmi_payload->>'cmi.core.score.max';
  ELSE -- SCORM 2004
    v_completion_status := p_cmi_payload->>'cmi.completion_status';
    v_success_status := p_cmi_payload->>'cmi.success_status';
    v_lesson_location := p_cmi_payload->>'cmi.location';
    v_session_time := p_cmi_payload->>'cmi.session_time';

    v_raw_str := p_cmi_payload->>'cmi.score.raw';
    v_min_str := p_cmi_payload->>'cmi.score.min';
    v_max_str := p_cmi_payload->>'cmi.score.max';
  END IF;

  -- 7. Validate Điểm số (Score Validation & Anti-Tampering)
  IF v_raw_str IS NOT NULL AND trim(v_raw_str) <> '' THEN
    IF NOT (trim(v_raw_str) ~ '^-?[0-9]+(\.[0-9]+)?$') THEN
      RETURN jsonb_build_object('success', false, 'code', 'INVALID_SCORE', 'message', 'score.raw không đúng định dạng số hợp lệ.');
    END IF;
    v_score_raw := trim(v_raw_str)::numeric;
  END IF;

  IF v_min_str IS NOT NULL AND trim(v_min_str) <> '' THEN
    IF NOT (trim(v_min_str) ~ '^-?[0-9]+(\.[0-9]+)?$') THEN
      RETURN jsonb_build_object('success', false, 'code', 'INVALID_SCORE', 'message', 'score.min không đúng định dạng số hợp lệ.');
    END IF;
    v_score_min := trim(v_min_str)::numeric;
  END IF;

  IF v_max_str IS NOT NULL AND trim(v_max_str) <> '' THEN
    IF NOT (trim(v_max_str) ~ '^-?[0-9]+(\.[0-9]+)?$') THEN
      RETURN jsonb_build_object('success', false, 'code', 'INVALID_SCORE', 'message', 'score.max không đúng định dạng số hợp lệ.');
    END IF;
    v_score_max := trim(v_max_str)::numeric;
  END IF;

  -- Kiểm tra logic phạm vi điểm: min <= raw <= max
  IF v_score_min IS NOT NULL AND v_score_max IS NOT NULL AND v_score_min > v_score_max THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_SCORE', 'message', 'score.min không được lớn hơn score.max.');
  END IF;

  IF v_score_raw IS NOT NULL THEN
    IF v_score_min IS NOT NULL AND v_score_raw < v_score_min THEN
      RETURN jsonb_build_object('success', false, 'code', 'INVALID_SCORE', 'message', 'score.raw không được nhỏ hơn score.min.');
    END IF;
    IF v_score_max IS NOT NULL AND v_score_raw > v_score_max THEN
      RETURN jsonb_build_object('success', false, 'code', 'INVALID_SCORE', 'message', 'score.raw không được lớn hơn score.max.');
    END IF;
  END IF;

  -- 8. Row Locking (FOR UPDATE) ngăn Concurrent Race & Tích lũy Total Time chống Double Count
  SELECT * INTO v_existing
  FROM public.scorm_tracking_data
  WHERE user_id = v_user_id AND package_id = p_package_id
  FOR UPDATE;

  IF v_scorm_version = '1.2' THEN
    v_session_sec := public._scorm12_time_to_seconds(v_session_time);
    IF v_existing.id IS NOT NULL THEN
      v_cur_total_sec := public._scorm12_time_to_seconds(v_existing.total_time);
      v_last_session_sec := COALESCE(v_existing.last_session_seconds, 0);

      -- Kiểm tra session token hash hoặc snapshot session_time
      IF v_token_hash IS NOT NULL AND v_existing.last_session_token_hash = v_token_hash THEN
        -- Cùng 1 session: thay thế phần session đóng góp trước đó bằng session_sec mới (tránh double count)
        v_new_total_sec := (v_cur_total_sec - v_last_session_sec) + v_session_sec;
      ELSIF v_token_hash IS NULL AND v_existing.session_time = v_session_time THEN
        -- Cùng payload / double commit không truyền token: giữ nguyên total_time
        v_new_total_sec := v_cur_total_sec;
      ELSIF v_token_hash IS NULL AND v_session_sec >= v_last_session_sec AND v_last_session_sec > 0 THEN
        -- Session tiến triển tăng dần
        v_new_total_sec := (v_cur_total_sec - v_last_session_sec) + v_session_sec;
      ELSE
        -- Phiên học mới bắt đầu
        v_new_total_sec := v_cur_total_sec + v_session_sec;
      END IF;
    ELSE
      v_new_total_sec := v_session_sec;
    END IF;
    v_total_time := public._seconds_to_scorm12_time(v_new_total_sec);

  ELSE -- SCORM 2004
    v_session_sec := public._scorm2004_time_to_seconds(v_session_time);
    IF v_existing.id IS NOT NULL THEN
      v_cur_total_sec := public._scorm2004_time_to_seconds(v_existing.total_time);
      v_last_session_sec := COALESCE(v_existing.last_session_seconds, 0);

      IF v_token_hash IS NOT NULL AND v_existing.last_session_token_hash = v_token_hash THEN
        v_new_total_sec := (v_cur_total_sec - v_last_session_sec) + v_session_sec;
      ELSIF v_token_hash IS NULL AND v_existing.session_time = v_session_time THEN
        v_new_total_sec := v_cur_total_sec;
      ELSIF v_token_hash IS NULL AND v_session_sec >= v_last_session_sec AND v_last_session_sec > 0 THEN
        v_new_total_sec := (v_cur_total_sec - v_last_session_sec) + v_session_sec;
      ELSE
        v_new_total_sec := v_cur_total_sec + v_session_sec;
      END IF;
    ELSE
      v_new_total_sec := v_session_sec;
    END IF;
    v_total_time := public._seconds_to_scorm2004_time(v_new_total_sec);
  END IF;

  v_updated_at := pg_catalog.now();

  -- 9. Lưu / Cập nhật bản ghi vào cơ sở dữ liệu (Upsert)
  INSERT INTO public.scorm_tracking_data (
    package_id,
    material_id,
    user_id,
    scorm_version,
    lesson_status,
    completion_status,
    success_status,
    lesson_location,
    suspend_data,
    score_raw,
    score_min,
    score_max,
    session_time,
    total_time,
    last_session_token_hash,
    last_session_seconds,
    cmi_data,
    updated_at
  )
  VALUES (
    p_package_id,
    v_package.material_id,
    v_user_id,
    v_scorm_version,
    v_lesson_status,
    v_completion_status,
    v_success_status,
    v_lesson_location,
    v_suspend_data,
    v_score_raw,
    v_score_min,
    v_score_max,
    v_session_time,
    v_total_time,
    v_token_hash,
    v_session_sec,
    p_cmi_payload,
    v_updated_at
  )
  ON CONFLICT (user_id, package_id)
  DO UPDATE SET
    lesson_status = COALESCE(EXCLUDED.lesson_status, scorm_tracking_data.lesson_status),
    completion_status = COALESCE(EXCLUDED.completion_status, scorm_tracking_data.completion_status),
    success_status = COALESCE(EXCLUDED.success_status, scorm_tracking_data.success_status),
    lesson_location = COALESCE(EXCLUDED.lesson_location, scorm_tracking_data.lesson_location),
    suspend_data = COALESCE(EXCLUDED.suspend_data, scorm_tracking_data.suspend_data),
    score_raw = COALESCE(EXCLUDED.score_raw, scorm_tracking_data.score_raw),
    score_min = COALESCE(EXCLUDED.score_min, scorm_tracking_data.score_min),
    score_max = COALESCE(EXCLUDED.score_max, scorm_tracking_data.score_max),
    session_time = EXCLUDED.session_time,
    total_time = EXCLUDED.total_time,
    last_session_token_hash = COALESCE(EXCLUDED.last_session_token_hash, scorm_tracking_data.last_session_token_hash),
    last_session_seconds = EXCLUDED.last_session_seconds,
    cmi_data = EXCLUDED.cmi_data,
    updated_at = v_updated_at;

  RETURN jsonb_build_object(
    'success', true,
    'package_id', p_package_id,
    'total_time', v_total_time,
    'updated_at', v_updated_at
  );
END;
$$;

-- 10. THU HỒI & CẤP QUYỀN RPC CHO AN TOÀN TỐI ĐA
REVOKE ALL ON FUNCTION public.load_scorm_cmi_state(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.load_scorm_cmi_state(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.load_scorm_cmi_state(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.save_scorm_cmi_state(UUID, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_scorm_cmi_state(UUID, JSONB, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_scorm_cmi_state(UUID, JSONB, TEXT) TO authenticated;

-- ====================================================================
-- 11. NÂNG CẤP RESOLVE_SCORM_SESSION_ASSET CHO TRUSTED GATEWAY
-- Trả kèm tracking data (nếu có) mà không để lộ DB identifiers / secrets
-- ====================================================================
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
  v_tracking RECORD;
  v_tracking_json JSONB := NULL;
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

  -- 7. Nạp tracking data nếu session thuộc user xác thực
  IF v_session.user_id IS NOT NULL THEN
    SELECT * INTO v_tracking
    FROM public.scorm_tracking_data
    WHERE user_id = v_session.user_id AND package_id = v_session.package_id;

    IF FOUND THEN
      v_tracking_json := jsonb_build_object(
        'lesson_status', v_tracking.lesson_status,
        'completion_status', v_tracking.completion_status,
        'success_status', v_tracking.success_status,
        'lesson_location', v_tracking.lesson_location,
        'suspend_data', v_tracking.suspend_data,
        'score_raw', v_tracking.score_raw,
        'score_min', v_tracking.score_min,
        'score_max', v_tracking.score_max,
        'session_time', v_tracking.session_time,
        'total_time', v_tracking.total_time,
        'cmi_data', v_tracking.cmi_data,
        'updated_at', v_tracking.updated_at
      );
    END IF;
  END IF;

  -- 8. Trả về metadata nội bộ cho Trusted Gateway backend (bao gồm tracking)
  RETURN json_build_object(
    'valid', true,
    'session_id', v_session.id,
    'package_id', v_package.id,
    'content_root', v_package.content_root,
    'launch_path', v_package.launch_path,
    'scorm_version', v_package.scorm_version,
    'expires_at', v_session.expires_at,
    'tracking', v_tracking_json
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_scorm_session_asset(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_scorm_session_asset(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_scorm_session_asset(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_scorm_session_asset(TEXT) TO service_role, postgres;
