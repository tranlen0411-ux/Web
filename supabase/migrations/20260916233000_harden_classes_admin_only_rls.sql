-- ============================================================================
-- SQL MIGRATION: SIẾT CHẶT QUYỀN GHI PUBLIC.CLASSES DÀNH RIÊNG CHO QUẢN TRỊ VIÊN (ADMIN-ONLY)
-- LOẠI BỎ TOÀN BỘ POLICIES MUTATION CỦA GIÁO VIÊN, BẢO TOÀN SELECT CHO GIÁO VIÊN & HỌC SINH
-- ============================================================================

BEGIN;

-- 1. DROP TẤT CẢ CÁC POLICIES MUTATION CŨ (INSERT / UPDATE / DELETE) TRÊN PUBLIC.CLASSES
DROP POLICY IF EXISTS "Teachers create classes" ON public.classes;
DROP POLICY IF EXISTS "classes_insert" ON public.classes;
DROP POLICY IF EXISTS "classes_update" ON public.classes;
DROP POLICY IF EXISTS "classes_delete" ON public.classes;

-- 2. TẠO POLICIES MUTATION MỚI CHỈ CHO PHÉP ADMIN (FAIL-CLOSED)
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

-- 3. BẢO TOÀN VÀ ĐẢM BẢO POLICY SELECT CHO PHÉP ADMIN, GIÁO VIÊN PHỤ TRÁCH VÀ HỌC SINH TRONG LỚP
DROP POLICY IF EXISTS "classes_select" ON public.classes;
CREATE POLICY "classes_select" ON public.classes
  FOR SELECT
  USING (
    app_private.is_admin()
    OR (teacher_id = (SELECT auth.uid()))
    OR app_private.student_in_class(id)
  );

-- 4. KIỂM TRA TÍNH TOÀN VẸN FAIL-CLOSED: ĐẢM BẢO KHÔNG CÒN BẤT KỲ MUTATION POLICY NÀO CHO PHÉP NON-ADMIN
DO $$
DECLARE
  v_invalid_policy_count INT;
BEGIN
  SELECT COUNT(*) INTO v_invalid_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'classes'
    AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
    AND (
      with_check NOT LIKE '%is_admin%'
      OR (cmd = 'UPDATE' AND qual NOT LIKE '%is_admin%')
      OR (cmd = 'DELETE' AND qual NOT LIKE '%is_admin%')
    );

  IF v_invalid_policy_count > 0 THEN
    RAISE EXCEPTION 'Phát hiện % mutation policies trên public.classes không chứa kiểm tra is_admin(). Dừng fail-closed!', v_invalid_policy_count;
  END IF;
END $$;

COMMIT;
