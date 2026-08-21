-- ============================================================================
-- SQL MIGRATION: THIẾT LẬP MỐC XUẤT PHÁT MỚI / RESET ĐIỂM XẾP HẠNG (CUTOFF BASELINE V1 - REVISED)
-- 1. TẠO BẢNG PUBLIC.STUDENT_SCORE_BASELINES (FK CREATED_BY NULLABLE ON DELETE SET NULL)
-- 2. TẠO CÁC RPC PREVIEW, APPLY VÀ REVOKE (UNDO) VỚI STRICT VALIDATION CHO P_STUDENT_IDS
-- 3. CẬP NHẬT BẢNG XẾP HẠNG HỌC THUẬT: TÍNH DENOMINATOR (MẪU SỐ) CHUẨN XÁC THEO TỪNG HỌC SINH
-- 4. CẬP NHẬT BẢNG XẾP HẠNG TRÒ CHƠI: ÁP DỤNG BASELINE ĐỒNG NHẤT TRÊN CẢ CLASS, GRADE VÀ ALL
-- TUYỆT ĐỐI KHÔNG XÓA DỮ LIỆU GỐC, KHÔNG SỬA SNAPSHOT KỲ CLOSED
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

-- 1. BẢNG MỐC XUẤT PHÁT MỚI / RESET ĐIỂM (STUDENT_SCORE_BASELINES)
CREATE TABLE IF NOT EXISTS public.student_score_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('game', 'academic', 'both')),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ,
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT chk_baseline_range CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE INDEX IF NOT EXISTS idx_baselines_student_class_active
ON public.student_score_baselines(student_id, class_id, scope, effective_from)
WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_baselines_class_active
ON public.student_score_baselines(class_id, created_at DESC)
WHERE revoked_at IS NULL;

-- BẬT RLS VÀ PHÂN QUYỀN
ALTER TABLE public.student_score_baselines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.student_score_baselines FROM PUBLIC, anon;
GRANT SELECT ON public.student_score_baselines TO authenticated;
GRANT ALL ON public.student_score_baselines TO service_role, postgres;

DROP POLICY IF EXISTS "Student baselines select policy" ON public.student_score_baselines;
CREATE POLICY "Student baselines select policy" ON public.student_score_baselines
FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  OR EXISTS (SELECT 1 FROM public.classes c WHERE c.id = class_id AND c.teacher_id = auth.uid())
  OR student_id = auth.uid()
);

-- ============================================================================
-- 2. RPC PREVIEW_SCORE_BASELINE_RESET (XEM TRƯỚC TÁC ĐỘNG - READ-ONLY - STRICT VALIDATION)
-- ============================================================================
DROP FUNCTION IF EXISTS public.preview_score_baseline_reset(UUID, UUID[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.preview_score_baseline_reset(
  p_class_id UUID,
  p_student_ids UUID[],
  p_scope TEXT,
  p_effective_from TIMESTAMPTZ,
  p_effective_until TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_target_class RECORD;
  v_valid_student_ids UUID[];
  v_raw_student_count INT;
  v_matched_student_count INT;
  v_invalid_ids UUID[];
  v_scope_clean TEXT;
  v_from TIMESTAMPTZ;
  v_until TIMESTAMPTZ;
  v_affected_game_count INT := 0;
  v_affected_game_stars INT := 0;
  v_affected_sub_count INT := 0;
  v_students_data JSONB;
BEGIN
  -- 1. Kiểm tra xác thực
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'UNAUTHORIZED', 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'teacher') THEN
    RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN', 'message', 'Bạn không có quyền thực hiện thao tác này.');
  END IF;

  -- 2. Kiểm tra lớp học
  SELECT * INTO v_target_class FROM public.classes WHERE id = p_class_id;
  IF v_target_class.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'CLASS_NOT_FOUND', 'message', 'Lớp học không tồn tại.');
  END IF;

  IF v_caller_role <> 'admin' AND v_target_class.teacher_id IS DISTINCT FROM v_caller_id THEN
    RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN', 'message', 'Bạn chỉ có quyền quản lý lớp do mình phụ trách.');
  END IF;

  -- 3. Chuẩn hóa & kiểm tra Scope
  v_scope_clean := LOWER(TRIM(p_scope));
  IF v_scope_clean NOT IN ('game', 'academic', 'both') THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_SCOPE', 'message', 'Phạm vi reset không hợp lệ (chỉ chấp nhận: game, academic, both).');
  END IF;

  -- 4. Kiểm tra mốc thời gian
  v_from := p_effective_from;
  v_until := p_effective_until;
  IF v_from IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_DATES', 'message', 'Thời điểm bắt đầu (effective_from) không được để trống.');
  END IF;

  IF v_until IS NOT NULL AND v_until <= v_from THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_DATES', 'message', 'Thời điểm kết thúc (effective_until) phải sau thời điểm bắt đầu.');
  END IF;

  -- 5. STRICT VALIDATION CHO P_STUDENT_IDS
  IF p_student_ids IS NULL OR array_length(p_student_ids, 1) = 0 THEN
    -- Chọn toàn bộ học sinh trong lớp
    SELECT ARRAY_AGG(cm.student_id)
    INTO v_valid_student_ids
    FROM public.class_members cm
    JOIN public.profiles p ON p.id = cm.student_id
    WHERE cm.class_id = p_class_id AND p.role = 'student';
  ELSE
    -- Khi truyền mảng ID cụ thể: BẮT BUỘC TẤT CẢ PHẢI TỒN TẠI, ROLE = STUDENT VÀ THUỘC LỚP
    v_raw_student_count := (SELECT COUNT(DISTINCT uid) FROM unnest(p_student_ids) AS uid);

    SELECT ARRAY_AGG(cm.student_id)
    INTO v_valid_student_ids
    FROM public.class_members cm
    JOIN public.profiles p ON p.id = cm.student_id
    WHERE cm.class_id = p_class_id
      AND cm.student_id = ANY(p_student_ids)
      AND p.role = 'student';

    v_matched_student_count := COALESCE(array_length(v_valid_student_ids, 1), 0);

    IF v_matched_student_count <> v_raw_student_count THEN
      SELECT ARRAY_AGG(uid)
      INTO v_invalid_ids
      FROM unnest(p_student_ids) AS uid
      WHERE uid NOT IN (
        SELECT cm.student_id
        FROM public.class_members cm
        JOIN public.profiles p ON p.id = cm.student_id
        WHERE cm.class_id = p_class_id AND p.role = 'student'
      );

      RETURN jsonb_build_object(
        'success', false,
        'status', 'INVALID_STUDENT_IDS',
        'message', format('Thất bại: Phát hiện %s ID học sinh không hợp lệ hoặc không thuộc lớp này: %s', array_length(v_invalid_ids, 1), array_to_string(v_invalid_ids, ', '))
      );
    END IF;
  END IF;

  IF v_valid_student_ids IS NULL OR array_length(v_valid_student_ids, 1) = 0 THEN
    RETURN jsonb_build_object('success', false, 'status', 'NO_STUDENTS', 'message', 'Không tìm thấy học sinh hợp lệ nào thuộc lớp này.');
  END IF;

  -- 6. Tính toán phạm vi tác động (Read-only Preview)
  -- Game impact:
  IF v_scope_clean IN ('game', 'both') THEN
    IF v_until IS NULL THEN
      SELECT COUNT(*), COALESCE(SUM(sp.stars_earned), 0)
      INTO v_affected_game_count, v_affected_game_stars
      FROM public.student_progress sp
      WHERE sp.student_id = ANY(v_valid_student_ids)
        AND sp.completed_at < v_from;
    ELSE
      SELECT COUNT(*), COALESCE(SUM(sp.stars_earned), 0)
      INTO v_affected_game_count, v_affected_game_stars
      FROM public.student_progress sp
      WHERE sp.student_id = ANY(v_valid_student_ids)
        AND sp.completed_at >= v_from AND sp.completed_at < v_until;
    END IF;
  END IF;

  -- Academic impact:
  IF v_scope_clean IN ('academic', 'both') THEN
    IF v_until IS NULL THEN
      SELECT COUNT(*)
      INTO v_affected_sub_count
      FROM public.academic_submissions s
      JOIN public.academic_exercise_assignments a ON a.exercise_id = s.exercise_id AND a.class_id = p_class_id
      WHERE s.student_id = ANY(v_valid_student_ids)
        AND s.submitted_at < v_from;
    ELSE
      SELECT COUNT(*)
      INTO v_affected_sub_count
      FROM public.academic_submissions s
      JOIN public.academic_exercise_assignments a ON a.exercise_id = s.exercise_id AND a.class_id = p_class_id
      WHERE s.student_id = ANY(v_valid_student_ids)
        AND s.submitted_at >= v_from AND s.submitted_at < v_until;
    END IF;
  END IF;

  -- Tóm tắt danh sách học sinh
  SELECT jsonb_agg(
    jsonb_build_object(
      'student_id', p.id,
      'full_name', p.full_name,
      'avatar_url', p.avatar_url
    ) ORDER BY p.full_name ASC
  ) INTO v_students_data
  FROM public.profiles p
  WHERE p.id = ANY(v_valid_student_ids);

  RETURN jsonb_build_object(
    'success', true,
    'class_id', p_class_id,
    'class_name', v_target_class.name,
    'scope', v_scope_clean,
    'effective_from', v_from,
    'effective_until', v_until,
    'is_cutoff', (v_until IS NULL),
    'student_count', array_length(v_valid_student_ids, 1),
    'affected_games_count', v_affected_game_count,
    'affected_game_stars', v_affected_game_stars,
    'affected_submissions_count', v_affected_sub_count,
    'students', COALESCE(v_students_data, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.preview_score_baseline_reset(UUID, UUID[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_score_baseline_reset(UUID, UUID[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ============================================================================
-- 3. RPC ADMIN_TEACHER_SET_SCORE_BASELINE (ÁP DỤNG MỐC XUẤT PHÁT MỚI - STRICT VALIDATION)
-- ============================================================================
DROP FUNCTION IF EXISTS public.admin_teacher_set_score_baseline(UUID, UUID[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT);

CREATE OR REPLACE FUNCTION public.admin_teacher_set_score_baseline(
  p_class_id UUID,
  p_student_ids UUID[],
  p_scope TEXT,
  p_effective_from TIMESTAMPTZ,
  p_effective_until TIMESTAMPTZ DEFAULT NULL,
  p_reason TEXT DEFAULT 'Thiết lập mốc xếp hạng mới'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_target_class RECORD;
  v_valid_student_ids UUID[];
  v_raw_student_count INT;
  v_matched_student_count INT;
  v_invalid_ids UUID[];
  v_scope_clean TEXT;
  v_from TIMESTAMPTZ;
  v_until TIMESTAMPTZ;
  v_reason_clean TEXT;
  v_st_id UUID;
  v_created_ids UUID[] := ARRAY[]::UUID[];
  v_new_id UUID;
BEGIN
  -- 1. Kiểm tra xác thực
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'UNAUTHORIZED', 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'teacher') THEN
    RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN', 'message', 'Bạn không có quyền thực hiện thao tác này.');
  END IF;

  -- 2. Kiểm tra lớp học
  SELECT * INTO v_target_class FROM public.classes WHERE id = p_class_id;
  IF v_target_class.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'CLASS_NOT_FOUND', 'message', 'Lớp học không tồn tại.');
  END IF;

  IF v_caller_role <> 'admin' AND v_target_class.teacher_id IS DISTINCT FROM v_caller_id THEN
    RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN', 'message', 'Bạn chỉ có quyền quản lý lớp do mình phụ trách.');
  END IF;

  -- 3. Chuẩn hóa & kiểm tra Scope
  v_scope_clean := LOWER(TRIM(p_scope));
  IF v_scope_clean NOT IN ('game', 'academic', 'both') THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_SCOPE', 'message', 'Phạm vi reset không hợp lệ (chỉ chấp nhận: game, academic, both).');
  END IF;

  -- 4. Chuẩn hóa & kiểm tra lý do (Reason)
  v_reason_clean := TRIM(p_reason);
  IF v_reason_clean IS NULL OR length(v_reason_clean) = 0 THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_REASON', 'message', 'Vui lòng cung cấp lý do thiết lập mốc xuất phát mới.');
  END IF;

  -- 5. Kiểm tra mốc thời gian
  v_from := p_effective_from;
  v_until := p_effective_until;
  IF v_from IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_DATES', 'message', 'Thời điểm bắt đầu (effective_from) không được để trống.');
  END IF;

  IF v_until IS NOT NULL AND v_until <= v_from THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_DATES', 'message', 'Thời điểm kết thúc (effective_until) phải sau thời điểm bắt đầu.');
  END IF;

  -- 6. STRICT VALIDATION CHO P_STUDENT_IDS
  IF p_student_ids IS NULL OR array_length(p_student_ids, 1) = 0 THEN
    SELECT ARRAY_AGG(cm.student_id)
    INTO v_valid_student_ids
    FROM public.class_members cm
    JOIN public.profiles p ON p.id = cm.student_id
    WHERE cm.class_id = p_class_id AND p.role = 'student';
  ELSE
    v_raw_student_count := (SELECT COUNT(DISTINCT uid) FROM unnest(p_student_ids) AS uid);

    SELECT ARRAY_AGG(cm.student_id)
    INTO v_valid_student_ids
    FROM public.class_members cm
    JOIN public.profiles p ON p.id = cm.student_id
    WHERE cm.class_id = p_class_id
      AND cm.student_id = ANY(p_student_ids)
      AND p.role = 'student';

    v_matched_student_count := COALESCE(array_length(v_valid_student_ids, 1), 0);

    -- NẾU CÓ BẤT KỲ ID NÀO KHÔNG HỢP LỆ -> REJECT TOÀN BỘ, 0 BASELINES ĐƯỢC TẠO
    IF v_matched_student_count <> v_raw_student_count THEN
      SELECT ARRAY_AGG(uid)
      INTO v_invalid_ids
      FROM unnest(p_student_ids) AS uid
      WHERE uid NOT IN (
        SELECT cm.student_id
        FROM public.class_members cm
        JOIN public.profiles p ON p.id = cm.student_id
        WHERE cm.class_id = p_class_id AND p.role = 'student'
      );

      RETURN jsonb_build_object(
        'success', false,
        'status', 'INVALID_STUDENT_IDS',
        'message', format('Thao tác bị hủy: Phát hiện %s ID học sinh không hợp lệ hoặc không thuộc lớp này: %s', array_length(v_invalid_ids, 1), array_to_string(v_invalid_ids, ', '))
      );
    END IF;
  END IF;

  IF v_valid_student_ids IS NULL OR array_length(v_valid_student_ids, 1) = 0 THEN
    RETURN jsonb_build_object('success', false, 'status', 'NO_STUDENTS', 'message', 'Không tìm thấy học sinh hợp lệ nào thuộc lớp này.');
  END IF;

  -- 7. Lưu mốc baseline trong transaction nguyên tử
  FOREACH v_st_id IN ARRAY v_valid_student_ids
  LOOP
    -- Thu hồi các baseline cũ cùng scope (hoặc subset scope) của học sinh trong lớp này
    UPDATE public.student_score_baselines
    SET revoked_at = NOW(),
        revoked_by = v_caller_id
    WHERE student_id = v_st_id
      AND class_id = p_class_id
      AND revoked_at IS NULL
      AND (
        scope = v_scope_clean
        OR v_scope_clean = 'both'
        OR (v_scope_clean IN ('game', 'academic') AND scope = 'both')
      );

    INSERT INTO public.student_score_baselines (
      student_id, class_id, scope, effective_from, effective_until, reason, created_by, created_at
    ) VALUES (
      v_st_id, p_class_id, v_scope_clean, v_from, v_until, v_reason_clean, v_caller_id, NOW()
    ) RETURNING id INTO v_new_id;

    v_created_ids := array_append(v_created_ids, v_new_id);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'SUCCESS',
    'class_id', p_class_id,
    'scope', v_scope_clean,
    'effective_from', v_from,
    'effective_until', v_until,
    'created_count', array_length(v_created_ids, 1),
    'baseline_ids', to_jsonb(v_created_ids),
    'message', format('Đã thiết lập mốc xuất phát mới thành công cho %s học sinh lớp %s.', array_length(v_created_ids, 1), v_target_class.name)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_teacher_set_score_baseline(UUID, UUID[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_teacher_set_score_baseline(UUID, UUID[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO authenticated;

-- ============================================================================
-- 4. RPC ADMIN_TEACHER_REVOKE_SCORE_BASELINE (HOÀN TÁC / UNDO MỐC XUẤT PHÁT)
-- ============================================================================
DROP FUNCTION IF EXISTS public.admin_teacher_revoke_score_baseline(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.admin_teacher_revoke_score_baseline(
  p_baseline_id UUID,
  p_reason TEXT DEFAULT 'Hủy mốc xuất phát, khôi phục điểm cũ'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_target_baseline RECORD;
  v_target_class RECORD;
BEGIN
  -- 1. Kiểm tra xác thực
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'UNAUTHORIZED', 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'teacher') THEN
    RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN', 'message', 'Bạn không có quyền thực hiện thao tác này.');
  END IF;

  -- 2. Kiểm tra bản ghi baseline
  SELECT * INTO v_target_baseline FROM public.student_score_baselines WHERE id = p_baseline_id;
  IF v_target_baseline.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'BASELINE_NOT_FOUND', 'message', 'Bản ghi mốc xuất phát không tồn tại.');
  END IF;

  IF v_target_baseline.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'ALREADY_REVOKED', 'message', 'Mốc xuất phát này đã được thu hồi trước đó.');
  END IF;

  -- 3. Kiểm tra phân quyền lớp
  SELECT * INTO v_target_class FROM public.classes WHERE id = v_target_baseline.class_id;
  IF v_target_class.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'CLASS_NOT_FOUND', 'message', 'Lớp học liên quan không tồn tại.');
  END IF;

  IF v_caller_role <> 'admin' AND v_target_class.teacher_id IS DISTINCT FROM v_caller_id THEN
    RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN', 'message', 'Bạn không có quyền thu hồi mốc xuất phát của lớp này.');
  END IF;

  -- 4. Thu hồi mềm (Soft revoke, KHÔNG XÓA DỮ LIỆU)
  UPDATE public.student_score_baselines
  SET revoked_at = NOW(),
      revoked_by = v_caller_id
  WHERE id = p_baseline_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'REVOKED',
    'baseline_id', p_baseline_id,
    'message', 'Đã hủy mốc xuất phát thành công. Điểm số trước đó đã được phục hồi trên Bảng xếp hạng.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_teacher_revoke_score_baseline(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_teacher_revoke_score_baseline(UUID, TEXT) TO authenticated;

-- ============================================================================
-- 5. RPC GET_CLASS_SCORE_BASELINES (LẤY DANH SÁCH MỐC ĐANG HOẠT ĐỘNG CỦA LỚP)
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_class_score_baselines(UUID);

CREATE OR REPLACE FUNCTION public.get_class_score_baselines(
  p_class_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_target_class RECORD;
  v_baselines_json JSONB;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'UNAUTHORIZED', 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'teacher') THEN
    RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN', 'message', 'Bạn không có quyền truy cập.');
  END IF;

  SELECT * INTO v_target_class FROM public.classes WHERE id = p_class_id;
  IF v_target_class.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'CLASS_NOT_FOUND', 'message', 'Lớp học không tồn tại.');
  END IF;

  IF v_caller_role <> 'admin' AND v_target_class.teacher_id IS DISTINCT FROM v_caller_id THEN
    RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN', 'message', 'Bạn chỉ có quyền xem lớp do mình phụ trách.');
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', b.id,
      'student_id', b.student_id,
      'student_name', p.full_name,
      'student_avatar', p.avatar_url,
      'class_id', b.class_id,
      'scope', b.scope,
      'effective_from', b.effective_from,
      'effective_until', b.effective_until,
      'reason', b.reason,
      'created_at', b.created_at,
      'creator_name', creator.full_name,
      'is_active', (b.revoked_at IS NULL),
      'revoked_at', b.revoked_at
    ) ORDER BY b.created_at DESC
  ) INTO v_baselines_json
  FROM public.student_score_baselines b
  JOIN public.profiles p ON p.id = b.student_id
  LEFT JOIN public.profiles creator ON creator.id = b.created_by
  WHERE b.class_id = p_class_id AND b.revoked_at IS NULL;

  RETURN jsonb_build_object(
    'success', true,
    'class_id', p_class_id,
    'baselines', COALESCE(v_baselines_json, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_class_score_baselines(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_class_score_baselines(UUID) TO authenticated;

-- ============================================================================
-- 6. CẬP NHẬT CÁC RPC BẢNG XẾP HẠNG TRÒ CHƠI (TÍCH HỢP BASELINE ĐỒNG NHẤT TRÊN CLASS, GRADE, ALL)
-- ============================================================================

-- A. GET_GAME_LEADERBOARD
DROP FUNCTION IF EXISTS public.get_game_leaderboard(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.get_game_leaderboard(
  p_grade_filter TEXT DEFAULT 'ALL',
  p_class_id TEXT DEFAULT 'ALL_IN_GRADE'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_caller_class_id UUID;
  v_caller_grade INT;
  v_requested_grade_int INT := NULL;
  v_requested_class_uuid UUID := NULL;
  v_target_class_record RECORD;
  v_result_json JSONB;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'teacher', 'student') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bạn không có quyền xem Bảng xếp hạng Trò chơi.');
  END IF;

  IF p_grade_filter <> 'ALL' THEN
    BEGIN
      v_requested_grade_int := p_grade_filter::INT;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'message', 'Tham số Khối lớp không hợp lệ.');
    END;
  END IF;

  IF p_grade_filter = 'ALL' AND v_caller_role <> 'admin' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chỉ Quản trị viên mới được phép xem Bảng xếp hạng Toàn trường.');
  END IF;

  IF p_class_id <> 'ALL_IN_GRADE' THEN
    BEGIN
      v_requested_class_uuid := p_class_id::UUID;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'message', 'Tham số Lớp học không hợp lệ.');
    END;

    SELECT * INTO v_target_class_record FROM public.classes WHERE id = v_requested_class_uuid;
    IF v_target_class_record.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lớp học không tồn tại.');
    END IF;

    IF v_requested_grade_int IS NOT NULL AND v_target_class_record.grade_level <> v_requested_grade_int THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lớp được chọn không thuộc Khối đã lọc.');
    END IF;

    v_requested_grade_int := v_target_class_record.grade_level;
  END IF;

  IF v_caller_role = 'student' THEN
    SELECT cm.class_id, c.grade_level INTO v_caller_class_id, v_caller_grade
    FROM public.class_members cm
    JOIN public.classes c ON c.id = cm.class_id
    WHERE cm.student_id = v_caller_id
    ORDER BY cm.joined_at DESC
    LIMIT 1;

    IF v_caller_class_id IS NULL OR v_caller_grade IS NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Tài khoản học sinh chưa được phân lớp.');
    END IF;

    v_requested_grade_int := v_caller_grade;

    IF v_requested_class_uuid IS NOT NULL AND v_requested_class_uuid <> v_caller_class_id THEN
      RETURN jsonb_build_object('success', false, 'message', 'Học sinh chỉ được xem Bảng xếp hạng của lớp mình.');
    END IF;

  ELSIF v_caller_role = 'teacher' THEN
    IF v_requested_class_uuid IS NOT NULL THEN
      IF v_target_class_record.teacher_id IS DISTINCT FROM v_caller_id THEN
        RETURN jsonb_build_object('success', false, 'message', 'Giáo viên chỉ có quyền xem lớp do mình phụ trách.');
      END IF;
    ELSE
      IF NOT EXISTS (
        SELECT 1 FROM public.classes c
        WHERE c.teacher_id = v_caller_id AND c.grade_level = v_requested_grade_int
      ) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Giáo viên chỉ có quyền xem Khối có lớp do mình phụ trách.');
      END IF;
    END IF;
  END IF;

  WITH current_student_classes AS (
    SELECT DISTINCT ON (cm.student_id)
      cm.student_id,
      c.id AS class_id,
      c.name AS class_name,
      c.grade_level AS class_grade
    FROM public.class_members cm
    JOIN public.classes c ON c.id = cm.class_id
    ORDER BY cm.student_id, cm.joined_at DESC
  ),
  valid_game_students AS (
    SELECT
      p.id AS student_id,
      p.full_name,
      p.avatar_url,
      -- ÁP DỤNG BASELINE ĐỒNG NHẤT KỂ CẢ KHI XEM THEO CLASS, THEO GRADE HOẶC TOÀN TRƯỜNG
      CASE
        WHEN EXISTS (
          SELECT 1 FROM public.student_score_baselines b
          WHERE b.student_id = p.id
            AND b.class_id = csc.class_id
            AND b.revoked_at IS NULL
            AND b.scope IN ('game', 'both')
        ) THEN (
          SELECT COALESCE(SUM(sp.stars_earned), 0)
          FROM public.student_progress sp
          WHERE sp.student_id = p.id
            AND NOT EXISTS (
              SELECT 1 FROM public.student_score_baselines b
              WHERE b.student_id = p.id
                AND b.class_id = csc.class_id
                AND b.revoked_at IS NULL
                AND b.scope IN ('game', 'both')
                AND (
                  (b.effective_until IS NULL AND sp.completed_at < b.effective_from)
                  OR (b.effective_until IS NOT NULL AND sp.completed_at >= b.effective_from AND sp.completed_at < b.effective_until)
                )
            )
        )
        ELSE COALESCE(p.total_stars, 0)
      END AS total_stars,
      -- KHÔNG ĐỂ COINS LỊCH SỬ CŨ LÀM SAI LỆCH THỨ HẠNG HÒA ĐIỂM (TIE-BREAK) CỦA ĐỢT THI ĐUA MỚI
      CASE
        WHEN EXISTS (
          SELECT 1 FROM public.student_score_baselines b
          WHERE b.student_id = p.id
            AND b.class_id = csc.class_id
            AND b.revoked_at IS NULL
            AND b.scope IN ('game', 'both')
        ) THEN 0
        ELSE COALESCE(p.total_coins, 0)
      END AS total_coins,
      csc.class_grade AS grade_level,
      csc.class_name
    FROM public.profiles p
    JOIN current_student_classes csc ON csc.student_id = p.id
    WHERE p.role = 'student'
      AND (
        v_requested_class_uuid IS NOT NULL AND csc.class_id = v_requested_class_uuid
        OR (
          v_requested_class_uuid IS NULL AND (
            v_requested_grade_int IS NULL
            OR csc.class_grade = v_requested_grade_int
          )
        )
      )
  ),
  ranked_game_students AS (
    SELECT
      vgs.*,
      DENSE_RANK() OVER (
        ORDER BY vgs.total_stars DESC, vgs.total_coins DESC
      ) AS rank_pos,
      COUNT(*) OVER (
        PARTITION BY vgs.total_stars, vgs.total_coins
      ) AS tie_count
    FROM valid_game_students vgs
  )
  SELECT jsonb_build_object(
    'success', true,
    'grade_filter', COALESCE(v_requested_grade_int::text, 'ALL'),
    'class_filter', COALESCE(v_requested_class_uuid::text, 'ALL_IN_GRADE'),
    'leaderboard', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'rank', r.rank_pos,
          'is_tied', (r.tie_count > 1),
          'student_id', r.student_id,
          'full_name', r.full_name,
          'avatar_url', r.avatar_url,
          'total_stars', r.total_stars,
          'total_coins', r.total_coins,
          'grade_level', r.grade_level,
          'class_name', r.class_name
        )
        ORDER BY r.rank_pos ASC, r.full_name ASC, r.student_id ASC
      ),
      '[]'::jsonb
    )
  ) INTO v_result_json
  FROM (
    SELECT * FROM ranked_game_students
    ORDER BY rank_pos ASC, full_name ASC, student_id ASC
    LIMIT 50
  ) r;

  RETURN v_result_json;
END;
$$;

REVOKE ALL ON FUNCTION public.get_game_leaderboard(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_game_leaderboard(TEXT, TEXT) TO authenticated;

-- B. GET_GAME_PERIOD_LEADERBOARD
DROP FUNCTION IF EXISTS public.get_game_period_leaderboard(UUID);

CREATE OR REPLACE FUNCTION public.get_game_period_leaderboard(
  p_period_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_period RECORD;
  v_res JSONB;
BEGIN
  SELECT * INTO v_period FROM public.ranking_periods WHERE id = p_period_id;
  IF v_period.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'NOT_FOUND', 'message', 'Không tìm thấy kỳ xếp hạng.');
  END IF;

  IF NOT app_private.can_read_class(v_period.class_id) THEN
    RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN', 'message', 'Từ chối: Bạn không thuộc lớp này.');
  END IF;

  -- NẾU KỲ ĐÃ CLOSED -> ĐỌC TỪ SNAPSHOT RESULTS (BẤT BIẾN)
  IF v_period.status = 'CLOSED' THEN
    WITH ranked_snapshot AS (
      SELECT
        r.student_id,
        p.full_name,
        p.avatar_url,
        p.student_code,
        r.game_stars AS period_stars,
        r.game_completed_count AS completed_count,
        COALESCE(p.total_stars, 0) AS total_stars,
        DENSE_RANK() OVER (ORDER BY r.game_stars DESC, r.game_completed_count DESC) AS calc_rank,
        COUNT(*) OVER (PARTITION BY r.game_stars, r.game_completed_count) AS tie_count
      FROM public.ranking_period_results r
      JOIN public.profiles p ON p.id = r.student_id
      WHERE r.period_id = p_period_id AND r.subject = 'ALL'
    )
    SELECT jsonb_agg(
      jsonb_build_object(
        'rank', calc_rank,
        'is_tied', (tie_count > 1),
        'student_id', student_id,
        'full_name', full_name,
        'avatar_url', avatar_url,
        'student_code', student_code,
        'period_stars', period_stars,
        'completed_count', completed_count,
        'total_stars', total_stars
      ) ORDER BY calc_rank ASC, full_name ASC
    ) INTO v_res FROM ranked_snapshot;

    RETURN COALESCE(v_res, '[]'::jsonb);
  END IF;

  -- NẾU KỲ DRAFT / ACTIVE -> TÍNH ĐỘNG CÓ ÁP DỤNG BASELINE
  WITH valid_progress AS (
    SELECT
      sp.student_id,
      sp.stars_earned,
      sp.id
    FROM public.student_progress sp
    WHERE sp.completed_at >= v_period.start_at
      AND sp.completed_at < v_period.end_at
      AND NOT EXISTS (
        SELECT 1 FROM public.student_score_baselines b
        WHERE b.student_id = sp.student_id
          AND b.class_id = v_period.class_id
          AND b.revoked_at IS NULL
          AND b.scope IN ('game', 'both')
          AND (
            (b.effective_until IS NULL AND sp.completed_at < b.effective_from)
            OR (b.effective_until IS NOT NULL AND sp.completed_at >= b.effective_from AND sp.completed_at < b.effective_until)
          )
      )
  ),
  progress_stats AS (
    SELECT
      vp.student_id,
      COALESCE(SUM(vp.stars_earned), 0) AS earned_stars,
      COUNT(DISTINCT vp.id) AS completed_count
    FROM valid_progress vp
    GROUP BY vp.student_id
  ),
  adjustment_stats AS (
    SELECT
      adj.student_id,
      COALESCE(SUM(adj.delta_stars), 0) AS adj_stars
    FROM public.ranking_period_adjustments adj
    WHERE adj.period_id = p_period_id
    GROUP BY adj.student_id
  ),
  student_totals AS (
    SELECT
      cm.student_id,
      p.full_name,
      p.avatar_url,
      p.student_code,
      COALESCE(p.total_stars, 0) AS total_stars,
      COALESCE(ps.earned_stars, 0) + COALESCE(ads.adj_stars, 0) AS period_stars,
      COALESCE(ps.completed_count, 0) AS completed_count
    FROM public.class_members cm
    JOIN public.profiles p ON p.id = cm.student_id
    LEFT JOIN progress_stats ps ON ps.student_id = cm.student_id
    LEFT JOIN adjustment_stats ads ON ads.student_id = cm.student_id
    WHERE cm.class_id = v_period.class_id
  ),
  ranked AS (
    SELECT
      *,
      DENSE_RANK() OVER (ORDER BY period_stars DESC, completed_count DESC) AS rank,
      COUNT(*) OVER (PARTITION BY period_stars, completed_count) AS tie_count
    FROM student_totals
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'rank', rank,
      'is_tied', (tie_count > 1),
      'student_id', student_id,
      'full_name', full_name,
      'avatar_url', avatar_url,
      'student_code', student_code,
      'period_stars', period_stars,
      'completed_count', completed_count,
      'total_stars', total_stars
    ) ORDER BY rank ASC, full_name ASC
  ) INTO v_res FROM ranked;

  RETURN COALESCE(v_res, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.get_game_period_leaderboard(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_game_period_leaderboard(UUID) TO authenticated;

-- ============================================================================
-- 7. CẬP NHẬT CÁC RPC BẢNG XẾP HẠNG HỌC THUẬT (MẪU SỐ DENOMINATOR TÍNH THEO TỪNG HỌC SINH)
-- ============================================================================

-- A. GET_ACADEMIC_CLASS_LEADERBOARD
DROP FUNCTION IF EXISTS public.get_academic_class_leaderboard(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.get_academic_class_leaderboard(
  p_class_id UUID,
  p_time_range TEXT DEFAULT 'ALL',
  p_subject TEXT DEFAULT 'ALL'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_class_record RECORD;
  v_leaderboard_json JSONB;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'teacher', 'student') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bạn không có quyền truy cập Bảng xếp hạng Học thuật.');
  END IF;

  SELECT * INTO v_class_record FROM public.classes WHERE id = p_class_id;
  IF v_class_record.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lớp học không tồn tại.');
  END IF;

  IF v_caller_role = 'student' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.class_members
      WHERE class_id = p_class_id AND student_id = v_caller_id
    ) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Bạn chỉ có quyền xem Bảng xếp hạng của lớp mình đang tham gia.');
    END IF;
  ELSIF v_caller_role = 'teacher' THEN
    IF v_class_record.teacher_id IS DISTINCT FROM v_caller_id THEN
      RETURN jsonb_build_object('success', false, 'message', 'Bạn chỉ có quyền xem Bảng xếp hạng của lớp do mình phụ trách.');
    END IF;
  END IF;

  -- 1. Lấy tất cả bài giao hợp lệ cho lớp trong time range
  WITH valid_assignments AS (
    SELECT
      a.exercise_id,
      e.title,
      e.subject,
      a.assigned_at,
      GREATEST(1.0, COALESCE(
        (SELECT SUM(points) FROM public.academic_exercise_questions q WHERE q.exercise_id = e.id),
        (SELECT MAX(max_score) FROM public.academic_submissions s WHERE s.exercise_id = e.id),
        10.0
      ))::NUMERIC AS exercise_max_score
    FROM public.academic_exercise_assignments a
    JOIN public.academic_exercises e ON e.id = a.exercise_id
    WHERE a.class_id = p_class_id
      AND a.counts_toward_ranking IS TRUE
      AND e.status = 'published'
      AND (
        p_subject = 'ALL'
        OR LOWER(e.subject) = LOWER(p_subject)
      )
      AND (
        p_time_range = 'ALL'
        OR (p_time_range = 'WEEK' AND a.assigned_at >= date_trunc('week', NOW()))
        OR (p_time_range = 'MONTH' AND a.assigned_at >= date_trunc('month', NOW()))
        OR (p_time_range IN ('SEMESTER', 'HK1') AND a.assigned_at >= TIMESTAMPTZ '2026-09-01 00:00:00+07' AND a.assigned_at < TIMESTAMPTZ '2027-01-10 00:00:00+07')
        OR (p_time_range = 'HK2' AND a.assigned_at >= TIMESTAMPTZ '2027-01-10 00:00:00+07' AND a.assigned_at < TIMESTAMPTZ '2027-06-01 00:00:00+07')
        OR (p_time_range = 'FULL_YEAR' AND a.assigned_at >= TIMESTAMPTZ '2026-09-01 00:00:00+07' AND a.assigned_at < TIMESTAMPTZ '2027-06-01 00:00:00+07')
      )
  ),
  students_in_class AS (
    SELECT DISTINCT ON (cm.student_id)
      cm.student_id,
      p.full_name,
      p.avatar_url
    FROM public.class_members cm
    JOIN public.profiles p ON p.id = cm.student_id
    WHERE cm.class_id = p_class_id AND p.role = 'student'
  ),
  -- 2. TÍNH MẪU SỐ (DENOMINATOR) RIÊNG CHO TỪNG HỌC SINH THEO BASELINE CỦA EM ĐÓ
  student_valid_assignments AS (
    SELECT
      sc.student_id,
      va.exercise_id,
      va.exercise_max_score
    FROM students_in_class sc
    CROSS JOIN valid_assignments va
    WHERE NOT EXISTS (
      SELECT 1 FROM public.student_score_baselines b
      WHERE b.student_id = sc.student_id
        AND b.class_id = p_class_id
        AND b.revoked_at IS NULL
        AND b.scope IN ('academic', 'both')
        AND (
          (b.effective_until IS NULL AND va.assigned_at < b.effective_from)
          OR (b.effective_until IS NOT NULL AND va.assigned_at >= b.effective_from AND va.assigned_at < b.effective_until)
        )
    )
  ),
  student_denominators AS (
    SELECT
      sc.student_id,
      COUNT(sva.exercise_id)::INT AS total_valid_count,
      COALESCE(SUM(sva.exercise_max_score), 0)::NUMERIC AS class_max_score
    FROM students_in_class sc
    LEFT JOIN student_valid_assignments sva ON sva.student_id = sc.student_id
    GROUP BY sc.student_id
  ),
  -- 3. TÍNH TỬ SỐ (NUMERATOR) BÀI NỘP HỢP LỆ THEO BASELINE CỦA TỪNG HỌC SINH
  valid_submissions AS (
    SELECT
      s.student_id,
      s.exercise_id,
      s.total_score,
      s.objective_score,
      va.exercise_max_score,
      LEAST(va.exercise_max_score, GREATEST(0.0, COALESCE(s.total_score, s.objective_score, 0.0)))::NUMERIC AS bounded_score
    FROM public.academic_submissions s
    JOIN valid_assignments va ON va.exercise_id = s.exercise_id
    JOIN student_valid_assignments sva ON sva.student_id = s.student_id AND sva.exercise_id = s.exercise_id
    WHERE (
      s.status = 'graded'
      OR (
        s.status = 'submitted'
        AND s.objective_score IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.academic_exercise_questions q
          WHERE q.exercise_id = s.exercise_id AND q.question_type = 'essay'
        )
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.student_score_baselines b
      WHERE b.student_id = s.student_id
        AND b.class_id = p_class_id
        AND b.revoked_at IS NULL
        AND b.scope IN ('academic', 'both')
        AND (
          (b.effective_until IS NULL AND s.submitted_at < b.effective_from)
          OR (b.effective_until IS NOT NULL AND s.submitted_at >= b.effective_from AND s.submitted_at < b.effective_until)
        )
    )
  ),
  student_best_per_exercise AS (
    SELECT
      vs.student_id,
      vs.exercise_id,
      MAX(vs.bounded_score) AS max_earned_score,
      MAX(vs.exercise_max_score) AS exercise_max_score,
      MAX(ROUND((vs.bounded_score / vs.exercise_max_score * 100.0)::numeric, 1)) AS single_ex_pct
    FROM valid_submissions vs
    GROUP BY vs.student_id, vs.exercise_id
  ),
  student_stats AS (
    SELECT
      sc.student_id,
      sc.full_name,
      sc.avatar_url,
      COALESCE(SUM(sbpe.max_earned_score), 0)::NUMERIC AS total_earned_score,
      COUNT(sbpe.exercise_id)::INT AS completed_count,
      sd.total_valid_count,
      sd.class_max_score,
      CASE
        WHEN sd.class_max_score > 0 THEN
          LEAST(100.0, ROUND((COALESCE(SUM(sbpe.max_earned_score), 0) / sd.class_max_score * 100.0)::numeric, 1))
        ELSE 0.0
      END AS academic_score_pct,
      CASE
        WHEN sd.total_valid_count > 0 THEN
          LEAST(100.0, ROUND((COUNT(sbpe.exercise_id)::numeric / sd.total_valid_count::numeric * 100.0)::numeric, 1))
        ELSE 0.0
      END AS completion_rate_pct,
      CASE
        WHEN COUNT(sbpe.exercise_id) > 0 THEN
          ROUND(AVG(sbpe.single_ex_pct)::numeric, 1)
        ELSE 0.0
      END AS avg_score_pct
    FROM students_in_class sc
    JOIN student_denominators sd ON sd.student_id = sc.student_id
    LEFT JOIN student_best_per_exercise sbpe ON sbpe.student_id = sc.student_id
    GROUP BY sc.student_id, sc.full_name, sc.avatar_url, sd.total_valid_count, sd.class_max_score
  ),
  ranked_students AS (
    SELECT
      ss.*,
      DENSE_RANK() OVER (
        ORDER BY
          ss.academic_score_pct DESC,
          ss.completion_rate_pct DESC,
          ss.completed_count DESC,
          ss.avg_score_pct DESC
      ) AS rank_pos,
      COUNT(*) OVER (
        PARTITION BY
          ss.academic_score_pct,
          ss.completion_rate_pct,
          ss.completed_count,
          ss.avg_score_pct
      ) AS tie_count
    FROM student_stats ss
  )
  SELECT
    jsonb_build_object(
      'success', true,
      'class_info', jsonb_build_object(
        'class_id', v_class_record.id,
        'class_name', v_class_record.name,
        'grade_level', v_class_record.grade_level
      ),
      'time_range', p_time_range,
      'subject', p_subject,
      'total_valid_exercises', (SELECT COUNT(*)::INT FROM valid_assignments),
      'total_class_max_score', (SELECT COALESCE(SUM(exercise_max_score), 0)::NUMERIC FROM valid_assignments),
      'leaderboard', COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'rank', r.rank_pos,
            'is_tied', (r.tie_count > 1),
            'student_id', r.student_id,
            'full_name', r.full_name,
            'avatar_url', r.avatar_url,
            'academic_score_pct', r.academic_score_pct,
            'total_earned_score', r.total_earned_score,
            'completed_count', r.completed_count,
            'total_valid_count', r.total_valid_count,
            'completion_rate_pct', r.completion_rate_pct,
            'avg_score', r.avg_score_pct
          )
          ORDER BY r.rank_pos ASC, r.full_name ASC
        ),
        '[]'::jsonb
      )
    ) INTO v_leaderboard_json
  FROM ranked_students r;

  RETURN v_leaderboard_json;
END;
$$;

REVOKE ALL ON FUNCTION public.get_academic_class_leaderboard(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_academic_class_leaderboard(UUID, TEXT, TEXT) TO authenticated;

-- B. GET_ACADEMIC_PERIOD_LEADERBOARD
DROP FUNCTION IF EXISTS public.get_academic_period_leaderboard(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.get_academic_period_leaderboard(
  p_period_id UUID,
  p_subject TEXT DEFAULT 'ALL'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_period RECORD;
  v_res JSONB;
BEGIN
  SELECT * INTO v_period FROM public.ranking_periods WHERE id = p_period_id;
  IF v_period.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'NOT_FOUND', 'message', 'Không tìm thấy kỳ xếp hạng.');
  END IF;

  IF NOT app_private.can_read_class(v_period.class_id) THEN
    RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN', 'message', 'Từ chối: Bạn không thuộc lớp này.');
  END IF;

  -- NẾU KỲ ĐÃ CLOSED -> ĐỌC TỪ SNAPSHOT RESULTS THEO MÔN (BẤT BIẾN)
  IF v_period.status = 'CLOSED' THEN
    WITH ranked_snapshot AS (
      SELECT
        r.student_id,
        p.full_name,
        p.avatar_url,
        p.student_code,
        r.academic_score_pct,
        r.total_earned_score,
        r.academic_completed_count AS completed_count,
        r.academic_assigned_count AS total_valid_count,
        r.completion_rate_pct,
        r.avg_score_pct AS avg_score,
        DENSE_RANK() OVER (
          ORDER BY
            r.academic_score_pct DESC,
            r.completion_rate_pct DESC,
            r.academic_completed_count DESC,
            r.avg_score_pct DESC
        ) AS calc_rank,
        COUNT(*) OVER (
          PARTITION BY
            r.academic_score_pct,
            r.completion_rate_pct,
            r.academic_completed_count,
            r.avg_score_pct
        ) AS tie_count
      FROM public.ranking_period_results r
      JOIN public.profiles p ON p.id = r.student_id
      WHERE r.period_id = p_period_id AND r.subject = COALESCE(NULLIF(p_subject, ''), 'ALL')
    )
    SELECT jsonb_agg(
      jsonb_build_object(
        'rank', calc_rank,
        'is_tied', (tie_count > 1),
        'student_id', student_id,
        'full_name', full_name,
        'avatar_url', avatar_url,
        'student_code', student_code,
        'academic_score_pct', academic_score_pct,
        'total_earned_score', total_earned_score,
        'completed_count', completed_count,
        'total_valid_count', total_valid_count,
        'completion_rate_pct', completion_rate_pct,
        'avg_score', avg_score
      ) ORDER BY calc_rank ASC, full_name ASC
    ) INTO v_res FROM ranked_snapshot;

    RETURN COALESCE(v_res, '[]'::jsonb);
  END IF;

  -- NẾU DRAFT / ACTIVE -> TÍNH ĐỘNG VỚI MẪU SỐ DENOMINATOR RIÊNG TỪNG HỌC SINH THEO BASELINE
  WITH valid_assignments AS (
    SELECT
      a.exercise_id,
      e.title,
      e.subject,
      a.assigned_at,
      GREATEST(1.0, COALESCE(
        (SELECT SUM(points) FROM public.academic_exercise_questions q WHERE q.exercise_id = e.id),
        (SELECT MAX(max_score) FROM public.academic_submissions s WHERE s.exercise_id = e.id),
        10.0
      ))::NUMERIC AS exercise_max_score
    FROM public.academic_exercise_assignments a
    JOIN public.academic_exercises e ON e.id = a.exercise_id
    WHERE a.class_id = v_period.class_id
      AND a.counts_toward_ranking IS TRUE
      AND e.status = 'published'
      AND a.assigned_at >= v_period.start_at
      AND a.assigned_at < v_period.end_at
      AND (
        p_subject = 'ALL'
        OR p_subject IS NULL
        OR TRIM(p_subject) = ''
        OR LOWER(e.subject) = LOWER(p_subject)
      )
  ),
  students_in_class AS (
    SELECT DISTINCT ON (cm.student_id)
      cm.student_id,
      p.full_name,
      p.avatar_url,
      p.student_code
    FROM public.class_members cm
    JOIN public.profiles p ON p.id = cm.student_id
    WHERE cm.class_id = v_period.class_id AND p.role = 'student'
  ),
  -- MẪU SỐ RIÊNG TỪNG HỌC SINH
  student_valid_assignments AS (
    SELECT
      sc.student_id,
      va.exercise_id,
      va.exercise_max_score
    FROM students_in_class sc
    CROSS JOIN valid_assignments va
    WHERE NOT EXISTS (
      SELECT 1 FROM public.student_score_baselines b
      WHERE b.student_id = sc.student_id
        AND b.class_id = v_period.class_id
        AND b.revoked_at IS NULL
        AND b.scope IN ('academic', 'both')
        AND (
          (b.effective_until IS NULL AND va.assigned_at < b.effective_from)
          OR (b.effective_until IS NOT NULL AND va.assigned_at >= b.effective_from AND va.assigned_at < b.effective_until)
        )
    )
  ),
  student_denominators AS (
    SELECT
      sc.student_id,
      COUNT(sva.exercise_id)::INT AS total_valid_count,
      COALESCE(SUM(sva.exercise_max_score), 0)::NUMERIC AS class_max_score
    FROM students_in_class sc
    LEFT JOIN student_valid_assignments sva ON sva.student_id = sc.student_id
    GROUP BY sc.student_id
  ),
  valid_submissions AS (
    SELECT
      s.student_id,
      s.exercise_id,
      s.total_score,
      s.objective_score,
      va.exercise_max_score,
      LEAST(va.exercise_max_score, GREATEST(0.0, COALESCE(s.total_score, s.objective_score, 0.0)))::NUMERIC AS bounded_score
    FROM public.academic_submissions s
    JOIN valid_assignments va ON va.exercise_id = s.exercise_id
    JOIN student_valid_assignments sva ON sva.student_id = s.student_id AND sva.exercise_id = s.exercise_id
    WHERE s.submitted_at >= v_period.start_at
      AND s.submitted_at < v_period.end_at
      AND (
        s.status = 'graded'
        OR (
          s.status = 'submitted'
          AND s.objective_score IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.academic_exercise_questions q
            WHERE q.exercise_id = s.exercise_id AND q.question_type IN ('essay', 'file_upload', 'image_upload')
          )
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.student_score_baselines b
        WHERE b.student_id = s.student_id
          AND b.class_id = v_period.class_id
          AND b.revoked_at IS NULL
          AND b.scope IN ('academic', 'both')
          AND (
            (b.effective_until IS NULL AND s.submitted_at < b.effective_from)
            OR (b.effective_until IS NOT NULL AND s.submitted_at >= b.effective_from AND s.submitted_at < b.effective_until)
          )
      )
  ),
  student_best_per_exercise AS (
    SELECT
      vs.student_id,
      vs.exercise_id,
      MAX(vs.bounded_score) AS max_earned_score,
      MAX(vs.exercise_max_score) AS exercise_max_score,
      MAX(ROUND((vs.bounded_score / vs.exercise_max_score * 100.0)::numeric, 1)) AS single_ex_pct
    FROM valid_submissions vs
    GROUP BY vs.student_id, vs.exercise_id
  ),
  student_stats AS (
    SELECT
      sc.student_id,
      sc.full_name,
      sc.avatar_url,
      sc.student_code,
      COALESCE(SUM(sbpe.max_earned_score), 0)::NUMERIC AS total_earned_score,
      COUNT(sbpe.exercise_id)::INT AS completed_count,
      sd.total_valid_count,
      sd.class_max_score,
      CASE
        WHEN sd.class_max_score > 0 THEN
          LEAST(100.0, ROUND((COALESCE(SUM(sbpe.max_earned_score), 0) / sd.class_max_score * 100.0)::numeric, 1))
        ELSE 0.0
      END AS academic_score_pct,
      CASE
        WHEN sd.total_valid_count > 0 THEN
          LEAST(100.0, ROUND((COUNT(sbpe.exercise_id)::numeric / sd.total_valid_count::numeric * 100.0)::numeric, 1))
        ELSE 0.0
      END AS completion_rate_pct,
      CASE
        WHEN COUNT(sbpe.exercise_id) > 0 THEN
          ROUND(AVG(sbpe.single_ex_pct)::numeric, 1)
        ELSE 0.0
      END AS avg_score_pct
    FROM students_in_class sc
    JOIN student_denominators sd ON sd.student_id = sc.student_id
    LEFT JOIN student_best_per_exercise sbpe ON sbpe.student_id = sc.student_id
    GROUP BY sc.student_id, sc.full_name, sc.avatar_url, sc.student_code, sd.total_valid_count, sd.class_max_score
  ),
  ranked_students AS (
    SELECT
      ss.*,
      DENSE_RANK() OVER (
        ORDER BY
          ss.academic_score_pct DESC,
          ss.completion_rate_pct DESC,
          ss.completed_count DESC,
          ss.avg_score_pct DESC
      ) AS rank_pos,
      COUNT(*) OVER (
        PARTITION BY
          ss.academic_score_pct,
          ss.completion_rate_pct,
          ss.completed_count,
          ss.avg_score_pct
      ) AS tie_count
    FROM student_stats ss
  )
  SELECT jsonb_build_object(
    'success', true,
    'period_id', p_period_id,
    'subject', p_subject,
    'total_valid_exercises', (SELECT COUNT(*)::INT FROM valid_assignments),
    'total_class_max_score', (SELECT COALESCE(SUM(exercise_max_score), 0)::NUMERIC FROM valid_assignments),
    'leaderboard', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'rank', r.rank_pos,
          'is_tied', (r.tie_count > 1),
          'student_id', r.student_id,
          'full_name', r.full_name,
          'avatar_url', r.avatar_url,
          'student_code', r.student_code,
          'academic_score_pct', r.academic_score_pct,
          'total_earned_score', r.total_earned_score,
          'completed_count', r.completed_count,
          'total_valid_count', r.total_valid_count,
          'completion_rate_pct', r.completion_rate_pct,
          'avg_score', r.avg_score_pct
        )
        ORDER BY r.rank_pos ASC, r.full_name ASC
      ),
      '[]'::jsonb
    )
  ) INTO v_res
  FROM ranked_students r;

  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.get_academic_period_leaderboard(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_academic_period_leaderboard(UUID, TEXT) TO authenticated;

COMMIT;
