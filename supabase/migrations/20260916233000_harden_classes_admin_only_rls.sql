-- ============================================================================
-- SQL MIGRATION: SIẾT CHẶT QUYỀN GHI PUBLIC.CLASSES DÀNH RIÊNG CHO QUẢN TRỊ VIÊN (ADMIN-ONLY)
-- TIỀN KIỂM PRE-DROP ASSERTION: CHẶN VÀ TỪ CHỐI UNKNOWN/ROGUE POLICY TRƯỚC KHI THỰC HIỆN DROP
-- CHỈ CHẤP NHẬN 2 TRẠNG THÁI: PRODUCTION CŨ ĐÃ AUDIT HOẶC IDEMPOTENT ĐÃ MIGRATE
-- HẬU ĐIỀU KIỆN FAIL-CLOSED KIỂM TRA ĐA TẦNG: EXACT COUNT, WHITELIST, ZERO ALL, NORMALIZED PREDICATES
-- ============================================================================

BEGIN;

-- 1. TIỀN ĐIỀU KIỆN PRE-DROP ASSERTION (FAIL-CLOSED TRƯỚC MỌI THAO TÁC DROP)
DO $$
DECLARE
  v_initial_all_count INT;
  v_unknown_policy_count INT;
  v_initial_total_count INT;
  v_unwhitelisted_names TEXT;
BEGIN
  -- 1.1. Cấm tuyệt đối policy có cmd = ALL hoặc cmd = * trước khi DROP
  SELECT COUNT(*) INTO v_initial_all_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'classes'
    AND cmd IN ('ALL', '*');

  IF v_initial_all_count > 0 THEN
    RAISE EXCEPTION 'PRE-DROP VALIDATION FAILED: Phát hiện % rogue policy có cmd=ALL trên public.classes trước khi drop! Từ chối drop âm thầm.', v_initial_all_count;
  END IF;

  -- 1.2. Whitelist tiền kiểm: Chỉ chấp nhận các policy thuộc tập Production cũ đã audit hoặc tập Idempotent mới
  SELECT COUNT(*), string_agg(policyname, ', ')
  INTO v_unknown_policy_count, v_unwhitelisted_names
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'classes'
    AND policyname NOT IN (
      -- Set A (Old Audited Production): 'classes_delete', 'Teachers create classes', 'classes_insert', 'classes_select', 'classes_update'
      -- Set B (Idempotent 4 policies): 'classes_select', 'classes_insert', 'classes_update', 'classes_delete'
      'classes_delete',
      'Teachers create classes',
      'classes_insert',
      'classes_update',
      'classes_select'
    );

  IF v_unknown_policy_count > 0 THEN
    RAISE EXCEPTION 'PRE-DROP VALIDATION FAILED: Phát hiện % policy lạ/chưa được đánh giá (%) trên public.classes trước khi drop! Hủy thao tác để bảo toàn trạng thái.',
      v_unknown_policy_count, v_unwhitelisted_names;
  END IF;

  -- 1.3. Kiểm tra số lượng policy đầu vào phải <= 5 (Set A hoặc Set B)
  SELECT COUNT(*) INTO v_initial_total_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'classes';

  IF v_initial_total_count > 5 THEN
    RAISE EXCEPTION 'PRE-DROP VALIDATION FAILED: Số lượng policy ban đầu vượt quá ngưỡng an toàn (thực tế: % policies)!', v_initial_total_count;
  END IF;
END $$;

-- 2. DROP CHÍNH XÁC CÁC POLICIES ĐÃ BIẾT TRONG WHITELIST (KHÔNG DROP ÂM THẦM DỮ LIỆU LẠ)
DROP POLICY IF EXISTS "Teachers create classes" ON public.classes;
DROP POLICY IF EXISTS "classes_delete" ON public.classes;
DROP POLICY IF EXISTS "classes_insert" ON public.classes;
DROP POLICY IF EXISTS "classes_update" ON public.classes;
DROP POLICY IF EXISTS "classes_select" ON public.classes;

-- 3. TẠO CHÍNH XÁC 3 POLICIES MUTATION DÀNH RIÊNG CHO ADMIN (FAIL-CLOSED)
CREATE POLICY "classes_insert" ON public.classes
  FOR INSERT TO public
  WITH CHECK (app_private.is_admin());

CREATE POLICY "classes_update" ON public.classes
  FOR UPDATE TO public
  USING (app_private.is_admin())
  WITH CHECK (app_private.is_admin());

CREATE POLICY "classes_delete" ON public.classes
  FOR DELETE TO public
  USING (app_private.is_admin());

-- 4. BẢO TOÀN VÀ ĐẢM BẢO CHÍNH XÁC 1 POLICY SELECT CHO ADMIN, GIÁO VIÊN PHỤ TRÁCH VÀ HỌC SINH TRONG LỚP
CREATE POLICY "classes_select" ON public.classes
  FOR SELECT TO public
  USING (
    app_private.is_admin()
    OR (teacher_id = (SELECT auth.uid()))
    OR app_private.student_in_class(id)
  );

-- 5. HẬU KIỂM FAIL-CLOSED TOÀN DIỆN (POSTCONDITION ASSERTION BLOCK)
DO $$
DECLARE
  v_total_policies INT;
  v_all_policies INT;
  v_select_policies INT;
  v_insert_policies INT;
  v_update_policies INT;
  v_delete_policies INT;
  v_invalid_named_policies INT;
  v_insert_qual TEXT;
  v_insert_check TEXT;
  v_update_qual TEXT;
  v_update_check TEXT;
  v_delete_qual TEXT;
  v_delete_check TEXT;
  v_select_qual TEXT;
  v_rogue_mutation_policies INT;
BEGIN
  -- 5.1. Kiểm tra tổng số lượng policies trên public.classes phải chính xác bằng 4
  SELECT COUNT(*) INTO v_total_policies
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'classes';

  IF v_total_policies <> 4 THEN
    RAISE EXCEPTION 'RLS HARDENING FAILURE: public.classes phải có chính xác 4 policies (thực tế có % policies)!', v_total_policies;
  END IF;

  -- 5.2. Kiểm tra cấm tuyệt đối policy với cmd = ALL hoặc cmd = *
  SELECT COUNT(*) INTO v_all_policies
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'classes'
    AND cmd IN ('ALL', '*');

  IF v_all_policies > 0 THEN
    RAISE EXCEPTION 'RLS HARDENING FAILURE: Phát hiện % policy có cmd = ALL trên public.classes! Cấm tuyệt đối!', v_all_policies;
  END IF;

  -- 5.3. Kiểm tra phân bổ số lượng từng command: đúng 1 SELECT, 1 INSERT, 1 UPDATE, 1 DELETE
  SELECT COUNT(*) INTO v_select_policies FROM pg_policies WHERE schemaname = 'public' AND tablename = 'classes' AND cmd = 'SELECT';
  SELECT COUNT(*) INTO v_insert_policies FROM pg_policies WHERE schemaname = 'public' AND tablename = 'classes' AND cmd = 'INSERT';
  SELECT COUNT(*) INTO v_update_policies FROM pg_policies WHERE schemaname = 'public' AND tablename = 'classes' AND cmd = 'UPDATE';
  SELECT COUNT(*) INTO v_delete_policies FROM pg_policies WHERE schemaname = 'public' AND tablename = 'classes' AND cmd = 'DELETE';

  IF v_select_policies <> 1 OR v_insert_policies <> 1 OR v_update_policies <> 1 OR v_delete_policies <> 1 THEN
    RAISE EXCEPTION 'RLS HARDENING FAILURE: Phân bổ command không hợp lệ (SELECT: %, INSERT: %, UPDATE: %, DELETE: %)!',
      v_select_policies, v_insert_policies, v_update_policies, v_delete_policies;
  END IF;

  -- 5.4. Whitelist tên policies: chỉ chấp nhận 4 tên chuẩn
  SELECT COUNT(*) INTO v_invalid_named_policies
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'classes'
    AND policyname NOT IN ('classes_select', 'classes_insert', 'classes_update', 'classes_delete');

  IF v_invalid_named_policies > 0 THEN
    RAISE EXCEPTION 'RLS HARDENING FAILURE: Phát hiện % policy không nằm trong whitelist tên chuẩn trên public.classes!', v_invalid_named_policies;
  END IF;

  -- 5.5. Kiểm tra Normalized Predicates chính xác 100% cho từng policy
  SELECT qual, with_check INTO v_insert_qual, v_insert_check
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'classes' AND policyname = 'classes_insert';

  IF v_insert_qual IS NOT NULL OR regexp_replace(v_insert_check, '[\s\(\)]', '', 'g') <> 'app_private.is_admin' THEN
    RAISE EXCEPTION 'RLS HARDENING FAILURE: classes_insert WITH CHECK không khớp chính xác app_private.is_admin()! (Check: %)', v_insert_check;
  END IF;

  SELECT qual, with_check INTO v_update_qual, v_update_check
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'classes' AND policyname = 'classes_update';

  IF regexp_replace(v_update_qual, '[\s\(\)]', '', 'g') <> 'app_private.is_admin'
     OR regexp_replace(v_update_check, '[\s\(\)]', '', 'g') <> 'app_private.is_admin' THEN
    RAISE EXCEPTION 'RLS HARDENING FAILURE: classes_update USING/WITH CHECK không khớp chính xác app_private.is_admin()! (Qual: %, Check: %)', v_update_qual, v_update_check;
  END IF;

  SELECT qual, with_check INTO v_delete_qual, v_delete_check
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'classes' AND policyname = 'classes_delete';

  IF regexp_replace(v_delete_qual, '[\s\(\)]', '', 'g') <> 'app_private.is_admin' OR v_delete_check IS NOT NULL THEN
    RAISE EXCEPTION 'RLS HARDENING FAILURE: classes_delete USING không khớp chính xác app_private.is_admin()! (Qual: %)', v_delete_qual;
  END IF;

  SELECT qual INTO v_select_qual
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'classes' AND policyname = 'classes_select';

  IF v_select_qual NOT LIKE '%app_private.is_admin%'
     OR v_select_qual NOT LIKE '%teacher_id%'
     OR v_select_qual NOT LIKE '%student_in_class%' THEN
    RAISE EXCEPTION 'RLS HARDENING FAILURE: classes_select không đủ 3 điều kiện (Admin, Teacher, Student)! (Qual: %)', v_select_qual;
  END IF;

  -- 5.6. Quét chống lọt nhánh non-admin: Cấm tuyệt đối mutation policy chứa từ khóa phi-admin
  SELECT COUNT(*) INTO v_rogue_mutation_policies
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'classes'
    AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    AND (
      COALESCE(qual, '') ~* '(is_teacher|teacher_id|auth\.uid|profiles|\mOR\M)'
      OR COALESCE(with_check, '') ~* '(is_teacher|teacher_id|auth\.uid|profiles|\mOR\M)'
    );

  IF v_rogue_mutation_policies > 0 THEN
    RAISE EXCEPTION 'RLS HARDENING FAILURE: Phát hiện % mutation policy chứa điều kiện non-admin trái phép trên public.classes!', v_rogue_mutation_policies;
  END IF;
END $$;

COMMIT;
