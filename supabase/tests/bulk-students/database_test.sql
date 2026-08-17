-- ============================================================================
-- DATABASE TESTS DÀNH CHO CI RUNNER SUPABASE LOCAL
-- KIỂM TRA PHÂN QUYỀN VÀ THỰC TẾ FUNCTIONAL CASCADE DELETION BẢO MẬT
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
  
  DELETE FROM public.profiles WHERE id = v_dummy_id;

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

  DELETE FROM public.profiles WHERE id = v_dummy_student_id;

  SELECT COUNT(*) INTO v_count 
  FROM public.class_members 
  WHERE student_id = v_dummy_student_id;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'DATABASE TEST FAILED: class_members không tự động xóa theo CASCADE!';
  END IF;

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

-- 4. KIỂM TRA PHÂN QUYỀN EXECUTE CHO TOÀN BỘ 12 RPCS NGUYÊN TỬ
DO $$
DECLARE
  v_server_rpcs TEXT[] := ARRAY[
    'set_student_pin_service',
    'heartbeat_batch_idempotency',
    'complete_batch_idempotency',
    'fail_batch_idempotency',
    'claim_student_row',
    'complete_student_row',
    'fail_student_row',
    'claim_student_pin_reset',
    'verify_student_pin_rate_limited'
  ];
  v_all_rpcs TEXT[] := ARRAY[
    'set_student_pin_service',
    'claim_batch_idempotency',
    'heartbeat_batch_idempotency',
    'complete_batch_idempotency',
    'fail_batch_idempotency',
    'claim_student_row',
    'complete_student_row',
    'fail_student_row',
    'claim_student_pin_reset',
    'verify_student_pin_rate_limited',
    'initiate_credentials_download',
    'confirm_credentials_delivery'
  ];
  r TEXT;
BEGIN
  -- 4a. Tất cả 12 RPCs KHÔNG được cấp quyền EXECUTE cho anon hoặc PUBLIC
  FOREACH r IN ARRAY v_all_rpcs LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.routine_privileges
      WHERE routine_name = r 
        AND grantee IN ('PUBLIC', 'anon')
    ) THEN
      RAISE EXCEPTION 'DATABASE TEST FAILED: RPC % bị rò rỉ quyền EXECUTE cho anon hoặc PUBLIC!', r;
    END IF;
  END LOOP;

  -- 4b. Các RPCs server-role KHÔNG được cấp quyền EXECUTE cho authenticated
  FOREACH r IN ARRAY v_server_rpcs LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.routine_privileges
      WHERE routine_name = r 
        AND grantee = 'authenticated'
    ) THEN
      RAISE EXCEPTION 'DATABASE TEST FAILED: Server-role RPC % bị rò rỉ quyền EXECUTE cho authenticated!', r;
    END IF;
  END LOOP;

  RAISE NOTICE 'TEST PASS: Tất cả 12 RPCs nguyên tử đều được bảo mật phân quyền chính xác.';
END $$;

COMMIT;
