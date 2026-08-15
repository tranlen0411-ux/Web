-- ============================================================================
-- POST-MIGRATION SQL VERIFICATION ASSERTIONS FOR ACADEMIC EXERCISES 15.8
-- ============================================================================

DO $$
DECLARE
  v_convalidated BOOLEAN := FALSE;
  v_attnotnull BOOLEAN := FALSE;
  v_old_overloads INT := 0;
  v_rpc_count INT := 0;
  v_anon_execute_count INT := 0;
BEGIN
  -- 1. Kiểm tra status check constraint tồn tại và convalidated = true
  SELECT c.convalidated INTO v_convalidated
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public' 
    AND t.relname = 'exercise_file_cleanup_jobs' 
    AND c.conname = 'exercise_file_cleanup_jobs_status_check';

  IF v_convalidated IS NOT TRUE THEN
    RAISE EXCEPTION 'ASSERTION FAILED: Constraint exercise_file_cleanup_jobs_status_check không tồn tại hoặc convalidated != true';
  END IF;

  -- 2. Kiểm tra cột status attnotnull = true
  SELECT a.attnotnull INTO v_attnotnull
  FROM pg_attribute a
  JOIN pg_class t ON a.attrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public' 
    AND t.relname = 'exercise_file_cleanup_jobs' 
    AND a.attname = 'status';

  IF v_attnotnull IS NOT TRUE THEN
    RAISE EXCEPTION 'ASSERTION FAILED: Cột status trong bảng exercise_file_cleanup_jobs không phải NOT NULL';
  END IF;

  -- 3. Kiểm tra loại bỏ hoàn toàn các overload RPC cũ (claim(UUID), finish(UUID, INT, TEXT, TEXT))
  SELECT COUNT(*) INTO v_old_overloads
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('claim_exercise_file_cleanup_job', 'finish_exercise_file_cleanup_job')
    AND pg_get_function_identity_arguments(p.oid) NOT LIKE '%,%';

  IF v_old_overloads > 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: Vẫn còn tồn tại % overload RPC worker cũ!', v_old_overloads;
  END IF;

  -- 4. Kiểm tra các RPC worker chỉ cấp quyền EXECUTE cho service_role (không cho anon, authenticated, PUBLIC)
  SELECT COUNT(*) INTO v_anon_execute_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('claim_exercise_file_cleanup_job', 'finish_exercise_file_cleanup_job', 'reconcile_exercise_file_cleanup_job')
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF v_anon_execute_count > 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: RPC worker bị cấp quyền EXECUTE cho anon!';
  END IF;

  -- 5. Kiểm tra RPC SECURITY DEFINER có search_path = ''
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('claim_exercise_file_cleanup_job', 'finish_exercise_file_cleanup_job', 'reconcile_exercise_file_cleanup_job', 'reset_cleanup_jobs_for_retry')
      AND p.prosecdef = true
      AND (p.proconfig IS NULL OR NOT ('search_path=' = ANY(p.proconfig)))
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: RPC SECURITY DEFINER chưa khóa search_path = ''''!';
  END IF;

  RAISE NOTICE '✅ ALL POST-MIGRATION SQL ASSERTIONS PASSED 100%%!';
END $$;
