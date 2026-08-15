-- ============================================================================
-- POST-MIGRATION SQL VERIFICATION & FAIL-CLOSED ASSERTIONS FOR 15.8
-- ============================================================================

DO $$
DECLARE
  v_proc_oid OID;
  v_convalidated BOOLEAN := FALSE;
  v_attnotnull BOOLEAN := FALSE;
  v_bucket_public BOOLEAN := TRUE;
  v_anon_select_keys BOOLEAN := FALSE;
  v_authenticated_select_keys BOOLEAN := FALSE;
  v_public_select_keys BOOLEAN := FALSE;
  v_claim_res JSONB;
BEGIN
  RAISE NOTICE '🔍 Starting Post-Migration Assertions...';

  -- 1. SECTION IX: PRECISE RPC SIGNATURE CHECKS USING to_regprocedure()
  IF to_regprocedure('public.claim_exercise_file_cleanup_job(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: Overload RPC cũ claim_exercise_file_cleanup_job(uuid) vẫn tồn tại!';
  END IF;

  IF to_regprocedure('public.claim_exercise_file_cleanup_job(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: Chữ ký RPC hiện hành claim_exercise_file_cleanup_job(uuid,uuid) không tồn tại!';
  END IF;

  IF to_regprocedure('public.finish_exercise_file_cleanup_job(uuid,integer,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: Overload RPC cũ finish_exercise_file_cleanup_job(uuid,integer,text,text) vẫn tồn tại!';
  END IF;

  IF to_regprocedure('public.finish_exercise_file_cleanup_job(uuid,integer,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: Chữ ký RPC hiện hành finish_exercise_file_cleanup_job(uuid,integer,text,text,uuid) không tồn tại!';
  END IF;

  IF to_regprocedure('public.reconcile_exercise_file_cleanup_job(uuid,integer,uuid)') IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: Chữ ký RPC reconcile_exercise_file_cleanup_job(uuid,integer,uuid) không tồn tại!';
  END IF;

  IF to_regprocedure('public.reset_cleanup_jobs_for_retry(integer)') IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: Chữ ký RPC reset_cleanup_jobs_for_retry(integer) không tồn tại!';
  END IF;

  -- 2. SECTION X: FULL ROLE PRIVILEGE CHECKS (PUBLIC, anon, authenticated, service_role)
  v_proc_oid := to_regprocedure('public.claim_exercise_file_cleanup_job(uuid,uuid)');
  IF NOT has_function_privilege('service_role', v_proc_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION FAILED: claim_exercise_file_cleanup_job chưa được GRANT EXECUTE cho service_role!';
  END IF;
  IF has_function_privilege('anon', v_proc_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_proc_oid, 'EXECUTE') OR has_function_privilege('public', v_proc_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION FAILED: claim_exercise_file_cleanup_job chưa bị REVOKE khỏi anon, authenticated hoặc public!';
  END IF;

  v_proc_oid := to_regprocedure('public.finish_exercise_file_cleanup_job(uuid,integer,text,text,uuid)');
  IF NOT has_function_privilege('service_role', v_proc_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION FAILED: finish_exercise_file_cleanup_job chưa được GRANT EXECUTE cho service_role!';
  END IF;
  IF has_function_privilege('anon', v_proc_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_proc_oid, 'EXECUTE') OR has_function_privilege('public', v_proc_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION FAILED: finish_exercise_file_cleanup_job chưa bị REVOKE khỏi anon, authenticated hoặc public!';
  END IF;

  v_proc_oid := to_regprocedure('public.reconcile_exercise_file_cleanup_job(uuid,integer,uuid)');
  IF NOT has_function_privilege('service_role', v_proc_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION FAILED: reconcile_exercise_file_cleanup_job chưa được GRANT EXECUTE cho service_role!';
  END IF;
  IF has_function_privilege('anon', v_proc_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_proc_oid, 'EXECUTE') OR has_function_privilege('public', v_proc_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION FAILED: reconcile_exercise_file_cleanup_job chưa bị REVOKE khỏi anon, authenticated hoặc public!';
  END IF;

  v_proc_oid := to_regprocedure('public.reset_cleanup_jobs_for_retry(integer)');
  IF NOT has_function_privilege('service_role', v_proc_oid, 'EXECUTE') OR NOT has_function_privilege('authenticated', v_proc_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION FAILED: reset_cleanup_jobs_for_retry phải được cấp quyền cho service_role và authenticated!';
  END IF;
  IF has_function_privilege('anon', v_proc_oid, 'EXECUTE') OR has_function_privilege('public', v_proc_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION FAILED: reset_cleanup_jobs_for_retry không được cấp cho anon hoặc public!';
  END IF;

  -- 3. SECTION VIII: SECURITY DEFINER & SEARCH_PATH LOCK
  FOR v_proc_oid IN
    SELECT p.oid FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('claim_exercise_file_cleanup_job', 'finish_exercise_file_cleanup_job', 'reconcile_exercise_file_cleanup_job', 'reset_cleanup_jobs_for_retry')
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_proc p WHERE p.oid = v_proc_oid AND (p.prosecdef = false OR p.proconfig IS NULL OR NOT ('search_path=' = ANY(p.proconfig)))
    ) THEN
      RAISE EXCEPTION 'ASSERTION FAILED: RPC OID % chưa được thiết lập SECURITY DEFINER hoặc search_path = ''''!', v_proc_oid;
    END IF;
  END LOOP;

  -- 4. SECTION XI: STORAGE BUCKET & PRIVATE SCHEMA SECURITY
  SELECT public INTO v_bucket_public FROM storage.buckets WHERE id = 'exercise-submissions';
  IF v_bucket_public IS NULL OR v_bucket_public IS TRUE THEN
    RAISE EXCEPTION 'ASSERTION FAILED: Storage bucket exercise-submissions không tồn tại hoặc public != false!';
  END IF;

  SELECT has_table_privilege('anon', 'app_private.academic_answer_keys', 'SELECT') INTO v_anon_select_keys;
  SELECT has_table_privilege('authenticated', 'app_private.academic_answer_keys', 'SELECT') INTO v_authenticated_select_keys;
  SELECT has_table_privilege('public', 'app_private.academic_answer_keys', 'SELECT') INTO v_public_select_keys;
  IF v_anon_select_keys IS TRUE OR v_authenticated_select_keys IS TRUE OR v_public_select_keys IS TRUE THEN
    RAISE EXCEPTION 'ASSERTION FAILED: Bảng đáp án bí mật app_private.academic_answer_keys bị lộ quyền SELECT!';
  END IF;

  SELECT c.convalidated INTO v_convalidated
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND t.relname = 'exercise_file_cleanup_jobs'
    AND c.conname = 'exercise_file_cleanup_jobs_status_check';

  IF v_convalidated IS NOT TRUE THEN
    RAISE EXCEPTION 'ASSERTION FAILED: Constraint status_check chưa được convalidated = true!';
  END IF;

  SELECT a.attnotnull INTO v_attnotnull
  FROM pg_attribute a
  JOIN pg_class t ON a.attrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND t.relname = 'exercise_file_cleanup_jobs'
    AND a.attname = 'status';

  IF v_attnotnull IS NOT TRUE THEN
    RAISE EXCEPTION 'ASSERTION FAILED: Cột status trong bảng exercise_file_cleanup_jobs không phải NOT NULL!';
  END IF;

  -- 5. SECTION XV: FAIL-CLOSED SUB-TRANSACTION TESTS WITH REASON ASSERTIONS
  -- Test A: Insert status IS NULL must fail
  BEGIN
    INSERT INTO public.exercise_file_cleanup_jobs (bucket_id, file_path, requested_by, status)
    VALUES ('exercise-submissions', 'test/null_status_test.png', gen_random_uuid(), NULL);
    RAISE EXCEPTION 'FAIL-CLOSED TEST FAILED: Insert status IS NULL không bị từ chối!';
  EXCEPTION WHEN check_violation OR not_null_violation THEN
    RAISE NOTICE '  ✅ Fail-closed Test A Passed: Insert status IS NULL bị từ chối!';
  END;

  -- Test B: Insert invalid status must fail
  BEGIN
    INSERT INTO public.exercise_file_cleanup_jobs (bucket_id, file_path, requested_by, status)
    VALUES ('exercise-submissions', 'test/invalid_status_test.png', gen_random_uuid(), 'invalid_status_xyz');
    RAISE EXCEPTION 'FAIL-CLOSED TEST FAILED: Insert status không hợp lệ không bị từ chối!';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ✅ Fail-closed Test B Passed: Insert status không hợp lệ bị từ chối!';
  END;

  -- Test C: RPC claim với NULL user_id must return success = false and reason = missing_user_id
  v_claim_res := public.claim_exercise_file_cleanup_job(gen_random_uuid(), NULL);
  IF (v_claim_res->>'success')::BOOLEAN IS TRUE OR (v_claim_res->>'reason') != 'missing_user_id' THEN
    RAISE EXCEPTION 'FAIL-CLOSED TEST FAILED: RPC claim từ chối user_id NULL không trả về reason = missing_user_id (Nhận được: %)', v_claim_res;
  ELSE
    RAISE NOTICE '  ✅ Fail-closed Test C Passed: RPC claim từ chối user_id NULL với reason = missing_user_id!';
  END IF;

  RAISE NOTICE '✅ ALL POST-MIGRATION ASSERTIONS & FAIL-CLOSED TESTS PASSED 100%%!';
END $$;
