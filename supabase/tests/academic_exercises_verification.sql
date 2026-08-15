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
  IF to_regprocedure('public.claim_exercise_file_cleanup_job(uuid,uuid)') IS NULL
     OR to_regprocedure('public.finish_exercise_file_cleanup_job(uuid,integer,text,text,uuid)') IS NULL
     OR to_regprocedure('public.reconcile_exercise_file_cleanup_job(uuid,integer,uuid)') IS NULL
     OR to_regprocedure('public.reset_cleanup_jobs_for_retry(integer)') IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: Một hoặc nhiều RPC signature hiện hành bị thiếu OID (to_regprocedure IS NULL)!';
  END IF;

  FOR v_proc_oid IN
    SELECT t.oid FROM (
      VALUES
        (to_regprocedure('public.claim_exercise_file_cleanup_job(uuid,uuid)')),
        (to_regprocedure('public.finish_exercise_file_cleanup_job(uuid,integer,text,text,uuid)')),
        (to_regprocedure('public.reconcile_exercise_file_cleanup_job(uuid,integer,uuid)')),
        (to_regprocedure('public.reset_cleanup_jobs_for_retry(integer)'))
    ) AS t(oid) WHERE t.oid IS NOT NULL
  LOOP
    DECLARE
      v_sig TEXT;
      v_secdef BOOLEAN;
      v_cfg TEXT[];
      v_has_empty_sp BOOLEAN := FALSE;
      v_has_unsafe_sp BOOLEAN := FALSE;
    BEGIN
      SELECT p.oid::regprocedure::text, p.prosecdef, p.proconfig
      INTO v_sig, v_secdef, v_cfg
      FROM pg_proc p WHERE p.oid = v_proc_oid;

      IF v_secdef IS NOT TRUE THEN
        RAISE EXCEPTION 'ASSERTION FAILED: RPC OID % (signature: %) chưa được thiết lập SECURITY DEFINER (prosecdef = %, proconfig = %)',
          v_proc_oid, v_sig, v_secdef, v_cfg;
      END IF;

      IF v_cfg IS NULL THEN
        RAISE EXCEPTION 'ASSERTION FAILED: RPC OID % (signature: %) thiếu cấu hình search_path rỗng (prosecdef = %, proconfig = NULL)',
          v_proc_oid, v_sig, v_secdef;
      END IF;

      SELECT
        EXISTS (SELECT 1 FROM unnest(v_cfg) elem WHERE elem IN ('search_path=""', 'search_path=')),
        EXISTS (SELECT 1 FROM unnest(v_cfg) elem WHERE elem LIKE 'search_path=%' AND elem NOT IN ('search_path=""', 'search_path='))
      INTO v_has_empty_sp, v_has_unsafe_sp;

      IF v_has_empty_sp IS NOT TRUE OR v_has_unsafe_sp IS TRUE THEN
        RAISE EXCEPTION 'ASSERTION FAILED: RPC OID % (signature: %) có search_path không an toàn hoặc không rỗng! (prosecdef = %, proconfig = %)',
          v_proc_oid, v_sig, v_secdef, v_cfg;
      END IF;
    END;
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

  -- Test C1: RPC claim từ chối caller không có role service_role (reason = unauthorized_role)
  PERFORM set_config(
    'request.jwt.claims',
    '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001"}',
    true
  );
  v_claim_res := public.claim_exercise_file_cleanup_job(gen_random_uuid(), gen_random_uuid());
  IF (v_claim_res->>'success')::BOOLEAN IS TRUE OR (v_claim_res->>'reason') != 'unauthorized_role' THEN
    RAISE EXCEPTION 'FAIL-CLOSED TEST C1 FAILED: RPC claim từ chối caller non-service_role không trả về reason = unauthorized_role (Nhận được: %)', v_claim_res;
  ELSE
    RAISE NOTICE '  ✅ Fail-closed Test C1 Passed: RPC claim từ chối caller non-service_role với reason = unauthorized_role!';
  END IF;

  -- Test C2: RPC claim với caller service_role nhưng user_id NULL (reason = missing_user_id)
  PERFORM set_config(
    'request.jwt.claims',
    '{"role":"service_role","sub":"00000000-0000-0000-0000-000000000001"}',
    true
  );
  v_claim_res := public.claim_exercise_file_cleanup_job(gen_random_uuid(), NULL);
  IF (v_claim_res->>'success')::BOOLEAN IS TRUE OR (v_claim_res->>'reason') != 'missing_user_id' THEN
    RAISE EXCEPTION 'FAIL-CLOSED TEST C2 FAILED: RPC claim với user_id NULL không trả về reason = missing_user_id (Nhận được: %)', v_claim_res;
  ELSE
    RAISE NOTICE '  ✅ Fail-closed Test C2 Passed: RPC claim từ chối user_id NULL với reason = missing_user_id!';
  END IF;

  RAISE NOTICE '✅ ALL POST-MIGRATION ASSERTIONS & FAIL-CLOSED TESTS PASSED 100%%!';
END $$;
