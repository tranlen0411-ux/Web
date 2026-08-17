-- ============================================================================
-- DATABASE TESTS DÀNH CHO CI RUNNER SUPABASE LOCAL
-- KIỂM TRA THỰC TẾ FUNCTIONAL CASCADE DELETION, UNIQUE INDEX VÀ PHÂN QUYỀN RPC
-- ============================================================================

BEGIN;

-- 1. KIỂM TRA FUNCTIONAL ON DELETE CASCADE TRÊN APP_PRIVATE.STUDENT_LOGIN_CREDENTIALS
DO $$
DECLARE
  v_dummy_id UUID := gen_random_uuid();
  v_count INT;
BEGIN
  INSERT INTO public.profiles (id, full_name, role) 
  VALUES (v_dummy_id, 'Cascade Test User 1', 'student');

  INSERT INTO app_private.student_login_credentials (student_id, pin_hash) 
  VALUES (v_dummy_id, 'hash_test_123');
  
  -- Thực hiện xóa profile cha
  DELETE FROM public.profiles WHERE id = v_dummy_id;

  -- Kiểm tra xem dữ liệu trong student_login_credentials có bị tự động xóa theo CASCADE hay không
  SELECT COUNT(*) INTO v_count 
  FROM app_private.student_login_credentials 
  WHERE student_id = v_dummy_id;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'DATABASE TEST FAILED: student_login_credentials không tự động xóa theo CASCADE!';
  END IF;
  RAISE NOTICE 'TEST PASS: student_login_credentials ON DELETE CASCADE hoạt động thực tế.';
END $$;

-- 2. KIỂM TRA FUNCTIONAL ON DELETE CASCADE TRÊN PUBLIC.CLASS_MEMBERS
DO $$
DECLARE
  v_dummy_class_id UUID := gen_random_uuid();
  v_dummy_student_id UUID := gen_random_uuid();
  v_count INT;
BEGIN
  INSERT INTO public.profiles (id, full_name, role) 
  VALUES (v_dummy_student_id, 'Cascade Test Student 2', 'student');

  INSERT INTO public.classes (id, name, grade_level, code) 
  VALUES (v_dummy_class_id, 'Lớp Test Cascade', 2, 'TEST-CASCADE-01');

  INSERT INTO public.class_members (class_id, student_id) 
  VALUES (v_dummy_class_id, v_dummy_student_id);

  -- Xóa student profile
  DELETE FROM public.profiles WHERE id = v_dummy_student_id;

  SELECT COUNT(*) INTO v_count 
  FROM public.class_members 
  WHERE student_id = v_dummy_student_id;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'DATABASE TEST FAILED: class_members không tự động xóa theo CASCADE!';
  END IF;

  -- Dọn dẹp lớp test
  DELETE FROM public.classes WHERE id = v_dummy_class_id;

  RAISE NOTICE 'TEST PASS: class_members ON DELETE CASCADE hoạt động thực tế.';
END $$;

-- 3. KIỂM TRA UNIQUE INDEX CỦA PUBLIC.PROFILES.STUDENT_CODE
DO $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'profiles' AND indexname = 'idx_profiles_student_code_unique'
  ) INTO v_exists;

  IF NOT v_exists THEN
    RAISE EXCEPTION 'DATABASE TEST FAILED: Thiếu UNIQUE INDEX idx_profiles_student_code_unique trên profiles.student_code!';
  END IF;
  RAISE NOTICE 'TEST PASS: idx_profiles_student_code_unique tồn tại.';
END $$;

-- 4. KIỂM TRA RPC SET_STUDENT_PIN CHỈ CÓ SERVICE_ROLE MỚI ĐƯỢC EXECUTE
DO $$
DECLARE
  v_anon_grant BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'public' 
      AND routine_name = 'set_student_pin' 
      AND grantee IN ('PUBLIC', 'anon', 'authenticated')
  ) INTO v_anon_grant;

  IF v_anon_grant THEN
    RAISE EXCEPTION 'DATABASE TEST FAILED: set_student_pin bị rò rỉ quyền EXECUTE cho anon/authenticated/PUBLIC!';
  END IF;
  RAISE NOTICE 'TEST PASS: set_student_pin bảo mật chỉ cấp cho service_role.';
END $$;

COMMIT;
