-- ============================================================================
-- SQL MIGRATION: SIẾT CHẶT QUYỀN GHI PUBLIC.CLASSES DÀNH RIÊNG CHO QUẢN TRỊ VIÊN (ADMIN-ONLY)
-- LOẠI BỎ TOÀN BỘ POLICIES MUTATION CỦA GIÁO VIÊN, BẢO TOÀN SELECT CHO GIÁO VIÊN & HỌC SINH
-- HẬU ĐIỀU KIỆN FAIL-CLOSED KIỂM TRA ĐA LỚP: EXACT COUNT, WHITELIST, ZERO ALL, NORMALIZED PREDICATES
-- ============================================================================

BEGIN;

-- 1. DROP TẤT CẢ CÁC POLICIES HIỆN CÓ TRÊN PUBLIC.CLASSES ĐỂ ĐẢM BẢO CATALOG SẠCH HOÀN TOÀN
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'classes'
  ) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.classes', r.policyname);
  END LOOP;
END $$;

-- 2. TẠO CHÍNH XÁC 3 POLICIES MUTATION DÀNH RIÊNG CHO ADMIN (FAIL-CLOSED)
CREATE POLICY "classes_insert" ON public.classes
  FOR INSERT
  WITH CHECK (app_private.is_admin());

CREATE POLICY "classes_update" ON public.classes
  FOR UPDATE
  USING (app_private.is_admin())
  WITH CHECK (app_private.is_admin());

CREATE POLICY "classes_delete" ON public.classes
  FOR DELETE
  USING (app_private.is_admin());

-- 3. BẢO TOÀN VÀ ĐẢM BẢO CHÍNH XÁC 1 POLICY SELECT CHO PHÉP ADMIN, GIÁO VIÊN PHỤ TRÁCH VÀ HỌC SINH TRONG LỚP
CREATE POLICY "classes_select" ON public.classes
  FOR SELECT
  USING (
    app_private.is_admin()
    OR (teacher_id = (SELECT auth.uid()))
    OR app_private.student_in_class(id)
  );

-- 4. HẬU KIỂM FAIL-CLOSED TOÀN DIỆN (POSTCONDITION ASSERTION BLOCK)
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
  -- 4.1. Kiểm tra tổng số lượng policies trên public.classes phải chính xác bằng 4
  SELECT COUNT(*) INTO v_total_policies
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'classes';

  IF v_total_policies <> 4 THEN
    RAISE EXCEPTION 'RLS HARDENING FAILURE: public.classes phải có chính xác 4 policies (thực tế có % policies)!', v_total_policies;
  END IF;

  -- 4.2. Kiểm tra cấm tuyệt đối policy với cmd = ALL hoặc cmd = *
  SELECT COUNT(*) INTO v_all_policies
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'classes'
    AND cmd IN ('ALL', '*');

  IF v_all_policies > 0 THEN
    RAISE EXCEPTION 'RLS HARDENING FAILURE: Phát hiện % policy có cmd = ALL trên public.classes! Cấm tuyệt đối!', v_all_policies;
  END IF;

  -- 4.3. Kiểm tra phân bổ số lượng từng command: đúng 1 SELECT, 1 INSERT, 1 UPDATE, 1 DELETE
  SELECT COUNT(*) INTO v_select_policies FROM pg_policies WHERE schemaname = 'public' AND tablename = 'classes' AND cmd = 'SELECT';
  SELECT COUNT(*) INTO v_insert_policies FROM pg_policies WHERE schemaname = 'public' AND tablename = 'classes' AND cmd = 'INSERT';
  SELECT COUNT(*) INTO v_update_policies FROM pg_policies WHERE schemaname = 'public' AND tablename = 'classes' AND cmd = 'UPDATE';
  SELECT COUNT(*) INTO v_delete_policies FROM pg_policies WHERE schemaname = 'public' AND tablename = 'classes' AND cmd = 'DELETE';

  IF v_select_policies <> 1 OR v_insert_policies <> 1 OR v_update_policies <> 1 OR v_delete_policies <> 1 THEN
    RAISE EXCEPTION 'RLS HARDENING FAILURE: Phân bổ command không hợp lệ (SELECT: %, INSERT: %, UPDATE: %, DELETE: %)!',
      v_select_policies, v_insert_policies, v_update_policies, v_delete_policies;
  END IF;

  -- 4.4. Whitelist tên policies: chỉ chấp nhận 4 tên chuẩn
  SELECT COUNT(*) INTO v_invalid_named_policies
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'classes'
    AND policyname NOT IN ('classes_select', 'classes_insert', 'classes_update', 'classes_delete');

  IF v_invalid_named_policies > 0 THEN
    RAISE EXCEPTION 'RLS HARDENING FAILURE: Phát hiện % policy không nằm trong whitelist tên chuẩn trên public.classes!', v_invalid_named_policies;
  END IF;

  -- 4.5. Kiểm tra Normalized Predicates chính xác 100% cho từng policy
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

  -- 4.6. Quét chống lọt nhánh non-admin: Cấm tuyệt đối mutation policy chứa từ khóa phi-admin
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
