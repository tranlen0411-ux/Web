-- ============================================================================
-- SQL MIGRATION: QUẢN TRỊ ADMIN XẾP/CHUYỂN LỚP HỌC SINH VÀ PHÂN CÔNG GIÁO VIÊN
-- BẢO MẬT ADMIN-ONLY, TRANSACTIONAL, ROW-LOCKING, PRESERVE HISTORY
-- ============================================================================

BEGIN;

-- 1. CHO PHÉP CLASSES.TEACHER_ID NULLABLE VÀ THAY FK CASCADE BẰNG SET NULL
ALTER TABLE public.classes ALTER COLUMN teacher_id DROP NOT NULL;

DO $$
DECLARE
  v_con_name text;
BEGIN
  SELECT conname INTO v_con_name
  FROM pg_constraint
  WHERE conrelid = 'public.classes'::regclass
    AND confrelid = 'public.profiles'::regclass
    AND contype = 'f'
  LIMIT 1;

  IF v_con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.classes DROP CONSTRAINT %I', v_con_name);
  END IF;
END $$;

ALTER TABLE public.classes
ADD CONSTRAINT classes_teacher_id_fkey
FOREIGN KEY (teacher_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 2. MỞ RỘNG PUBLIC.CLASS_MEMBERS VỚI CÁC TRƯỜNG LỊCH SỬ & QUẢN TRỊ
ALTER TABLE public.class_members ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.class_members ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.class_members ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.class_members ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE public.class_members ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.class_members ADD COLUMN IF NOT EXISTS ended_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.class_members ADD COLUMN IF NOT EXISTS change_reason TEXT DEFAULT NULL;

-- 3. KIỂM TRA DỮ LIỆU CŨ TRƯỚC KHI TẠO UNIQUE INDEX (FAIL-CLOSED)
DO $$
DECLARE
  v_ambiguous_count INT;
BEGIN
  SELECT COUNT(*) INTO v_ambiguous_count
  FROM (
    SELECT student_id
    FROM public.class_members
    WHERE is_active = true
    GROUP BY student_id
    HAVING COUNT(*) > 1
  ) t;

  IF v_ambiguous_count > 0 THEN
    RAISE EXCEPTION 'Phát hiện % học sinh có nhiều hơn 1 membership active. Dừng migration để bảo vệ tính toàn vẹn!', v_ambiguous_count;
  END IF;
END $$;

-- 4. TẠO INDEX VÀ PARTIAL UNIQUE INDEX ĐẢM BẢO DUY NHẤT 1 LỚP ACTIVE CHO MỖI HỌC SINH
CREATE UNIQUE INDEX IF NOT EXISTS idx_class_members_active_student
ON public.class_members (student_id)
WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_class_members_student_id_active
ON public.class_members (student_id)
WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_class_members_class_id_active
ON public.class_members (class_id)
WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_classes_teacher_id
ON public.classes (teacher_id);

-- 5. CẬP NHẬT APP_PRIVATE HELPER FUNCTIONS ĐỂ CHỈ TÍNH MEMBERSHIP ACTIVE
CREATE OR REPLACE FUNCTION app_private.is_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid())
      AND role = 'admin'
      AND COALESCE(is_disabled, false) = false
  );
$$;

CREATE OR REPLACE FUNCTION app_private.is_teacher()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid())
      AND role = 'teacher'
      AND COALESCE(is_disabled, false) = false
  );
$$;

CREATE OR REPLACE FUNCTION app_private.teacher_owns_class(p_class_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.classes
    WHERE id = p_class_id
      AND teacher_id = (SELECT auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION app_private.student_in_class(p_class_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.class_members
    WHERE class_id = p_class_id
      AND student_id = (SELECT auth.uid())
      AND is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION app_private.teacher_manages_student(p_student_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.classes c
    JOIN public.class_members cm ON c.id = cm.class_id
    WHERE c.teacher_id = (SELECT auth.uid())
      AND cm.student_id = p_student_id
      AND cm.is_active = true
  );
$$;

-- 6. SIẾT CHẶT RLS TRÊN BẢNG PUBLIC.CLASS_MEMBERS
DROP POLICY IF EXISTS "class_members_select" ON public.class_members;
DROP POLICY IF EXISTS "class_members_insert" ON public.class_members;
DROP POLICY IF EXISTS "class_members_update" ON public.class_members;
DROP POLICY IF EXISTS "class_members_delete" ON public.class_members;

CREATE POLICY "class_members_select" ON public.class_members FOR SELECT USING (
  app_private.is_admin()
  OR (student_id = (SELECT auth.uid()) AND is_active = true)
  OR (app_private.teacher_owns_class(class_id) AND is_active = true)
);

CREATE POLICY "class_members_insert" ON public.class_members FOR INSERT WITH CHECK (
  app_private.is_admin()
);

CREATE POLICY "class_members_update" ON public.class_members FOR UPDATE USING (
  app_private.is_admin()
) WITH CHECK (
  app_private.is_admin()
);

CREATE POLICY "class_members_delete" ON public.class_members FOR DELETE USING (
  app_private.is_admin()
);

-- 7. VÔ HIỆU HÓA HÀM TỰ GIA NHẬP LỚP (JOIN_CLASS_BY_CODE)
CREATE OR REPLACE FUNCTION public.join_class_by_code(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN jsonb_build_object(
    'success', false,
    'status', 'DISABLED',
    'message', 'Tính năng tự gia nhập lớp bằng mã đã được chuyển sang quản trị tập trung. Vui lòng liên hệ Quản trị viên để được xếp lớp.'
  );
END;
$$;

-- ============================================================================
-- 8. CÁC HÀM RPC QUẢN TRỊ ADMIN (SECURITY DEFINER, ATOMIC, ROW-LOCKING)
-- ============================================================================

-- RPC 1: ADMIN XẾP HỌC SINH VÀO LỚP
CREATE OR REPLACE FUNCTION public.assign_student_to_class(
  p_student_id UUID,
  p_class_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_caller_disabled BOOLEAN;
  v_target_student RECORD;
  v_target_class RECORD;
  v_active_membership RECORD;
  v_existing_class_record RECORD;
BEGIN
  -- 1. Xác minh Admin
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'UNAUTHORIZED', 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role, COALESCE(is_disabled, false) INTO v_caller_role, v_caller_disabled
  FROM public.profiles WHERE id = v_caller_id;

  IF v_caller_role IS DISTINCT FROM 'admin' OR v_caller_disabled IS TRUE THEN
    RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN', 'message', 'Chỉ Quản trị viên mới có quyền xếp lớp.');
  END IF;

  -- 2. Kiểm tra Học sinh tồn tại, role student, không bị khóa
  SELECT id, full_name, role, COALESCE(is_disabled, false) AS is_disabled
  INTO v_target_student
  FROM public.profiles WHERE id = p_student_id;

  IF v_target_student.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'STUDENT_NOT_FOUND', 'message', 'Tài khoản học sinh không tồn tại.');
  END IF;

  IF v_target_student.role IS DISTINCT FROM 'student' THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_ROLE', 'message', 'Tài khoản được chọn không phải là Học sinh.');
  END IF;

  IF v_target_student.is_disabled IS TRUE THEN
    RETURN jsonb_build_object('success', false, 'status', 'ACCOUNT_DISABLED', 'message', 'Tài khoản học sinh hiện đang bị khóa.');
  END IF;

  -- 3. Kiểm tra Lớp học tồn tại
  SELECT id, name, grade_level INTO v_target_class
  FROM public.classes WHERE id = p_class_id;

  IF v_target_class.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'CLASS_NOT_FOUND', 'message', 'Lớp học không tồn tại.');
  END IF;

  -- 4. Khóa dòng kiểm tra membership active hiện tại của học sinh
  SELECT id, class_id, is_active INTO v_active_membership
  FROM public.class_members
  WHERE student_id = p_student_id AND is_active = true
  FOR UPDATE;

  -- Nếu đã active đúng lớp này -> Idempotent
  IF v_active_membership.class_id = p_class_id THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', 'ALREADY_ASSIGNED',
      'message', format('Học sinh đã thuộc lớp %s từ trước.', v_target_class.name),
      'class_id', p_class_id,
      'class_name', v_target_class.name
    );
  END IF;

  -- Nếu đang active ở lớp khác -> Báo lỗi TRANSFER_REQUIRED
  IF v_active_membership.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'TRANSFER_REQUIRED',
      'message', 'Học sinh hiện đang thuộc lớp khác. Vui lòng sử dụng tính năng Chuyển lớp.',
      'current_class_id', v_active_membership.class_id
    );
  END IF;

  -- 5. Kiểm tra xem đã từng có bản ghi membership (inactive) cho cặp (class_id, student_id) này chưa
  SELECT id INTO v_existing_class_record
  FROM public.class_members
  WHERE student_id = p_student_id AND class_id = p_class_id
  FOR UPDATE;

  IF v_existing_class_record.id IS NOT NULL THEN
    -- Kích hoạt lại bản ghi cũ
    UPDATE public.class_members
    SET is_active = true,
        is_primary = true,
        started_at = now(),
        ended_at = NULL,
        assigned_by = v_caller_id,
        ended_by = NULL,
        change_reason = p_reason
    WHERE id = v_existing_class_record.id;
  ELSE
    -- Tạo bản ghi mới
    INSERT INTO public.class_members (
      class_id, student_id, is_active, is_primary, started_at, assigned_by, change_reason
    ) VALUES (
      p_class_id, p_student_id, true, true, now(), v_caller_id, p_reason
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'ASSIGNED_SUCCESSFULLY',
    'message', format('Đã xếp học sinh %s vào lớp %s thành công.', v_target_student.full_name, v_target_class.name),
    'student_id', p_student_id,
    'class_id', p_class_id,
    'class_name', v_target_class.name
  );
END;
$$;

-- RPC 2: ADMIN CHUYỂN LỚP CHO HỌC SINH
CREATE OR REPLACE FUNCTION public.transfer_student_class(
  p_student_id UUID,
  p_from_class_id UUID,
  p_to_class_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_caller_disabled BOOLEAN;
  v_target_student RECORD;
  v_from_class RECORD;
  v_to_class RECORD;
  v_target_class_record RECORD;
BEGIN
  -- 1. Xác minh Admin
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'UNAUTHORIZED', 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role, COALESCE(is_disabled, false) INTO v_caller_role, v_caller_disabled
  FROM public.profiles WHERE id = v_caller_id;

  IF v_caller_role IS DISTINCT FROM 'admin' OR v_caller_disabled IS TRUE THEN
    RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN', 'message', 'Chỉ Quản trị viên mới có quyền chuyển lớp.');
  END IF;

  -- 2. Kiểm tra lớp nguồn và đích phải khác nhau
  IF p_from_class_id = p_to_class_id THEN
    RETURN jsonb_build_object('success', false, 'status', 'SAME_CLASS', 'message', 'Lớp chuyển đến phải khác lớp hiện tại.');
  END IF;

  -- 3. Kiểm tra Học sinh tồn tại
  SELECT id, full_name, role, COALESCE(is_disabled, false) AS is_disabled
  INTO v_target_student
  FROM public.profiles WHERE id = p_student_id;

  IF v_target_student.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'STUDENT_NOT_FOUND', 'message', 'Học sinh không tồn tại.');
  END IF;

  IF v_target_student.role IS DISTINCT FROM 'student' THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_ROLE', 'message', 'Tài khoản không phải là Học sinh.');
  END IF;

  -- 4. Kiểm tra Lớp nguồn & Lớp đích
  IF p_from_class_id IS NOT NULL THEN
    SELECT id, name INTO v_from_class FROM public.classes WHERE id = p_from_class_id;
  END IF;

  SELECT id, name INTO v_to_class FROM public.classes WHERE id = p_to_class_id;
  IF v_to_class.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'CLASS_NOT_FOUND', 'message', 'Lớp học đích không tồn tại.');
  END IF;

  -- 5. Khóa và đóng tất cả membership active hiện tại của học sinh
  UPDATE public.class_members
  SET is_active = false,
      is_primary = false,
      ended_at = now(),
      ended_by = v_caller_id,
      change_reason = COALESCE(p_reason, 'Chuyển sang lớp ' || v_to_class.name)
  WHERE student_id = p_student_id AND is_active = true;

  -- 6. Tạo hoặc kích hoạt lại membership ở lớp đích
  SELECT id INTO v_target_class_record
  FROM public.class_members
  WHERE student_id = p_student_id AND class_id = p_to_class_id
  FOR UPDATE;

  IF v_target_class_record.id IS NOT NULL THEN
    UPDATE public.class_members
    SET is_active = true,
        is_primary = true,
        started_at = now(),
        ended_at = NULL,
        assigned_by = v_caller_id,
        ended_by = NULL,
        change_reason = p_reason
    WHERE id = v_target_class_record.id;
  ELSE
    INSERT INTO public.class_members (
      class_id, student_id, is_active, is_primary, started_at, assigned_by, change_reason
    ) VALUES (
      p_to_class_id, p_student_id, true, true, now(), v_caller_id, p_reason
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'TRANSFERRED_SUCCESSFULLY',
    'message', format('Đã chuyển học sinh %s sang lớp %s thành công.', v_target_student.full_name, v_to_class.name),
    'student_id', p_student_id,
    'from_class_id', p_from_class_id,
    'to_class_id', p_to_class_id,
    'to_class_name', v_to_class.name
  );
END;
$$;

-- RPC 3: ADMIN GỠ HỌC SINH KHỎI LỚP
CREATE OR REPLACE FUNCTION public.remove_student_from_class(
  p_student_id UUID,
  p_class_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_caller_disabled BOOLEAN;
  v_target_student RECORD;
  v_target_class RECORD;
  v_membership RECORD;
BEGIN
  -- 1. Xác minh Admin
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'UNAUTHORIZED', 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role, COALESCE(is_disabled, false) INTO v_caller_role, v_caller_disabled
  FROM public.profiles WHERE id = v_caller_id;

  IF v_caller_role IS DISTINCT FROM 'admin' OR v_caller_disabled IS TRUE THEN
    RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN', 'message', 'Chỉ Quản trị viên mới có quyền gỡ học sinh khỏi lớp.');
  END IF;

  -- 2. Kiểm tra Học sinh & Lớp
  SELECT id, full_name INTO v_target_student FROM public.profiles WHERE id = p_student_id;
  SELECT id, name INTO v_target_class FROM public.classes WHERE id = p_class_id;

  -- 3. Khóa và kiểm tra membership
  SELECT id, is_active INTO v_membership
  FROM public.class_members
  WHERE student_id = p_student_id AND class_id = p_class_id
  FOR UPDATE;

  IF v_membership.id IS NULL OR v_membership.is_active IS FALSE THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', 'ALREADY_INACTIVE',
      'message', 'Học sinh hiện không thuộc lớp này hoặc đã được gỡ trước đó.'
    );
  END IF;

  -- 4. Chuyển sang inactive (Không xóa dòng để giữ lịch sử)
  UPDATE public.class_members
  SET is_active = false,
      is_primary = false,
      ended_at = now(),
      ended_by = v_caller_id,
      change_reason = COALESCE(p_reason, 'Admin gỡ khỏi lớp')
  WHERE id = v_membership.id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'REMOVED_SUCCESSFULLY',
    'message', format('Đã gỡ học sinh %s khỏi lớp %s thành công.', COALESCE(v_target_student.full_name, 'học sinh'), COALESCE(v_target_class.name, '')),
    'student_id', p_student_id,
    'class_id', p_class_id
  );
END;
$$;

-- RPC 4: ADMIN PHÂN CÔNG GIÁO VIÊN CHO NHIỀU LỚP CÙNG LÚC
CREATE OR REPLACE FUNCTION public.assign_teacher_to_classes(
  p_teacher_id UUID,
  p_class_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_caller_disabled BOOLEAN;
  v_teacher_profile RECORD;
  v_unique_class_ids UUID[];
  v_valid_classes_count INT;
BEGIN
  -- 1. Xác minh Admin
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'UNAUTHORIZED', 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role, COALESCE(is_disabled, false) INTO v_caller_role, v_caller_disabled
  FROM public.profiles WHERE id = v_caller_id;

  IF v_caller_role IS DISTINCT FROM 'admin' OR v_caller_disabled IS TRUE THEN
    RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN', 'message', 'Chỉ Quản trị viên mới có quyền phân công giáo viên.');
  END IF;

  -- 2. Lọc danh sách class_ids duy nhất (loại bỏ trùng lặp và null)
  SELECT ARRAY(SELECT DISTINCT cid FROM unnest(p_class_ids) AS cid WHERE cid IS NOT NULL) INTO v_unique_class_ids;

  IF cardinality(v_unique_class_ids) = 0 THEN
    RETURN jsonb_build_object('success', false, 'status', 'EMPTY_CLASS_LIST', 'message', 'Danh sách lớp học không được để trống.');
  END IF;

  -- 3. Kiểm tra Giáo viên nếu p_teacher_id NOT NULL
  IF p_teacher_id IS NOT NULL THEN
    SELECT id, full_name, role, COALESCE(is_disabled, false) AS is_disabled
    INTO v_teacher_profile
    FROM public.profiles WHERE id = p_teacher_id;

    IF v_teacher_profile.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'status', 'TEACHER_NOT_FOUND', 'message', 'Tài khoản giáo viên không tồn tại.');
    END IF;

    IF v_teacher_profile.role IS DISTINCT FROM 'teacher' THEN
      RETURN jsonb_build_object('success', false, 'status', 'INVALID_ROLE', 'message', 'Tài khoản được chọn không phải là Giáo viên.');
    END IF;

    IF v_teacher_profile.is_disabled IS TRUE THEN
      RETURN jsonb_build_object('success', false, 'status', 'ACCOUNT_DISABLED', 'message', 'Tài khoản giáo viên hiện đang bị khóa.');
    END IF;
  END IF;

  -- 4. Xác minh TOÀN BỘ lớp trong mảng phải tồn tại (Atomic validation)
  SELECT COUNT(*) INTO v_valid_classes_count
  FROM public.classes
  WHERE id = ANY(v_unique_class_ids);

  IF v_valid_classes_count <> cardinality(v_unique_class_ids) THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'INVALID_CLASSES',
      'message', 'Một hoặc nhiều mã lớp không tồn tại trong hệ thống. Đã hủy toàn bộ thao tác.'
    );
  END IF;

  -- 5. Khóa dòng và cập nhật teacher_id
  PERFORM id FROM public.classes WHERE id = ANY(v_unique_class_ids) FOR UPDATE;

  UPDATE public.classes
  SET teacher_id = p_teacher_id
  WHERE id = ANY(v_unique_class_ids);

  RETURN jsonb_build_object(
    'success', true,
    'status', 'ASSIGNED_SUCCESSFULLY',
    'message', format('Đã cập nhật phân công cho %s lớp học thành công.', cardinality(v_unique_class_ids)),
    'teacher_id', p_teacher_id,
    'teacher_name', v_teacher_profile.full_name,
    'updated_class_count', cardinality(v_unique_class_ids)
  );
END;
$$;

-- RPC 5: ADMIN GỠ GIÁO VIÊN KHỎI LỚP HỌC
CREATE OR REPLACE FUNCTION public.remove_teacher_from_class(
  p_teacher_id UUID,
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
  v_caller_disabled BOOLEAN;
  v_target_class RECORD;
BEGIN
  -- 1. Xác minh Admin
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'UNAUTHORIZED', 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role, COALESCE(is_disabled, false) INTO v_caller_role, v_caller_disabled
  FROM public.profiles WHERE id = v_caller_id;

  IF v_caller_role IS DISTINCT FROM 'admin' OR v_caller_disabled IS TRUE THEN
    RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN', 'message', 'Chỉ Quản trị viên mới có quyền gỡ giáo viên khỏi lớp.');
  END IF;

  -- 2. Khóa dòng lớp học
  SELECT id, name, teacher_id INTO v_target_class
  FROM public.classes WHERE id = p_class_id
  FOR UPDATE;

  IF v_target_class.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'CLASS_NOT_FOUND', 'message', 'Lớp học không tồn tại.');
  END IF;

  -- Nếu lớp không có giáo viên hoặc không khớp với p_teacher_id -> Idempotent
  IF v_target_class.teacher_id IS NULL OR (p_teacher_id IS NOT NULL AND v_target_class.teacher_id <> p_teacher_id) THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', 'ALREADY_REMOVED',
      'message', 'Lớp học hiện không được phân công cho giáo viên này.'
    );
  END IF;

  -- 3. Cập nhật teacher_id = NULL
  UPDATE public.classes
  SET teacher_id = NULL
  WHERE id = p_class_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'REMOVED_SUCCESSFULLY',
    'message', format('Đã gỡ giáo viên phụ trách khỏi lớp %s thành công.', v_target_class.name),
    'class_id', p_class_id
  );
END;
$$;

-- ============================================================================
-- 9. PHÂN QUYỀN THỰC THI CHO CÁC RPC MỚI
-- ============================================================================
REVOKE ALL ON FUNCTION public.assign_student_to_class(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transfer_student_class(UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_student_from_class(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_teacher_to_classes(UUID, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_teacher_from_class(UUID, UUID) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.assign_student_to_class(UUID, UUID, TEXT) FROM anon;';
    EXECUTE 'REVOKE ALL ON FUNCTION public.transfer_student_class(UUID, UUID, UUID, TEXT) FROM anon;';
    EXECUTE 'REVOKE ALL ON FUNCTION public.remove_student_from_class(UUID, UUID, TEXT) FROM anon;';
    EXECUTE 'REVOKE ALL ON FUNCTION public.assign_teacher_to_classes(UUID, UUID[]) FROM anon;';
    EXECUTE 'REVOKE ALL ON FUNCTION public.remove_teacher_from_class(UUID, UUID) FROM anon;';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.assign_student_to_class(UUID, UUID, TEXT) TO authenticated;';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.transfer_student_class(UUID, UUID, UUID, TEXT) TO authenticated;';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.remove_student_from_class(UUID, UUID, TEXT) TO authenticated;';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.assign_teacher_to_classes(UUID, UUID[]) TO authenticated;';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.remove_teacher_from_class(UUID, UUID) TO authenticated;';
  END IF;
END $$;

COMMIT;
