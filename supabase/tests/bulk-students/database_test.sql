-- ============================================================================
-- DATABASE TESTS DÀNH CHO CI RUNNER SUPABASE LOCAL
-- KIỂM TRA FOREIGN KEYS, UNIQUE INDEX VÀ PHÂN QUYỀN RPC
-- ============================================================================

BEGIN;

-- 1. KIỂM TRA FOREIGN KEY CASCADE TRÊN APP_PRIVATE.STUDENT_LOGIN_CREDENTIALS
DO $$
DECLARE
  v_rule TEXT;
BEGIN
  SELECT UPPER(rc.delete_rule) INTO v_rule
  FROM information_schema.table_constraints AS tc
  JOIN information_schema.referential_constraints AS rc 
    ON tc.constraint_name = rc.constraint_name 
   AND tc.constraint_schema = rc.constraint_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'app_private' 
    AND tc.table_name = 'student_login_credentials'
  LIMIT 1;

  IF v_rule IS DISTINCT FROM 'CASCADE' THEN
    RAISE EXCEPTION 'DATABASE TEST FAILED: student_login_credentials.student_id thiếu ON DELETE CASCADE (đọc được: %)!', v_rule;
  END IF;
  RAISE NOTICE 'TEST PASS: student_login_credentials.student_id có ON DELETE CASCADE.';
END $$;

-- 2. KIỂM TRA FOREIGN KEY CASCADE TRÊN PUBLIC.CLASS_MEMBERS
DO $$
DECLARE
  v_rule TEXT;
BEGIN
  SELECT UPPER(rc.delete_rule) INTO v_rule
  FROM information_schema.table_constraints AS tc
  JOIN information_schema.referential_constraints AS rc 
    ON tc.constraint_name = rc.constraint_name 
   AND tc.constraint_schema = rc.constraint_schema
  JOIN information_schema.key_column_usage AS kcu 
    ON tc.constraint_name = kcu.constraint_name 
   AND tc.constraint_schema = kcu.constraint_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public' 
    AND tc.table_name = 'class_members' 
    AND kcu.column_name = 'student_id'
  LIMIT 1;

  IF v_rule IS DISTINCT FROM 'CASCADE' THEN
    RAISE EXCEPTION 'DATABASE TEST FAILED: class_members.student_id thiếu ON DELETE CASCADE (đọc được: %)!', v_rule;
  END IF;
  RAISE NOTICE 'TEST PASS: class_members.student_id có ON DELETE CASCADE.';
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
