-- ============================================================================
-- PREFLIGHT READ-ONLY CHECK: PREFLIGHT_ACADEMIC_DECIMAL_GRADING.sql
-- MỤC TIÊU:
-- 1. Kiểm tra trạng thái schema, kiểu dữ liệu hiện tại trước khi chạy migration.
-- 2. Kiểm tra dung lượng dòng (row count), phân bố giá trị điểm và ràng buộc.
-- 3. Xác minh chữ ký RPC hiện tại.
-- TUYỆT ĐỐI KHÔNG SỬA ĐỔI DỮ LIỆU HOẶC SCHEMA (100% READ-ONLY).
-- ============================================================================

-- ============================================================================
-- MASTER UNIFIED PREFLIGHT QUERY (CHẠY 1 LẦN RA TOÀN BỘ 6 NHÓM A - F)
-- ============================================================================

SELECT json_build_object(
  'A_data_types', (
    SELECT json_agg(t) FROM (
      SELECT
        table_name,
        column_name,
        data_type,
        udt_name,
        numeric_precision,
        numeric_scale,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'academic_submission_answers' AND column_name = 'points_earned')
          OR (table_name = 'academic_submissions' AND column_name IN ('manual_score', 'total_score', 'objective_score', 'max_score'))
          OR (table_name = 'academic_exercise_questions' AND column_name = 'points')
        )
      ORDER BY table_name, column_name
    ) t
  ),
  'B_row_counts', (
    SELECT json_agg(t) FROM (
      SELECT
        'academic_submissions' AS table_name,
        COUNT(*) AS total_rows,
        COUNT(manual_score) AS non_null_manual_scores,
        COUNT(total_score) AS non_null_total_scores
      FROM public.academic_submissions
      UNION ALL
      SELECT
        'academic_submission_answers' AS table_name,
        COUNT(*) AS total_rows,
        COUNT(points_earned) AS non_null_manual_scores,
        COUNT(points_earned) AS non_null_total_scores
      FROM public.academic_submission_answers
    ) t
  ),
  'C_score_stats', (
    SELECT json_agg(t) FROM (
      SELECT
        'academic_submission_answers.points_earned' AS metric,
        MIN(points_earned) AS min_val,
        MAX(points_earned) AS max_val,
        ROUND(AVG(points_earned), 2) AS avg_val,
        COUNT(*) FILTER (WHERE points_earned IS NULL) AS null_count
      FROM public.academic_submission_answers
      UNION ALL
      SELECT
        'academic_submissions.manual_score' AS metric,
        MIN(manual_score) AS min_val,
        MAX(manual_score) AS max_val,
        ROUND(AVG(manual_score), 2) AS avg_val,
        COUNT(*) FILTER (WHERE manual_score IS NULL) AS null_count
      FROM public.academic_submissions
      UNION ALL
      SELECT
        'academic_submissions.total_score' AS metric,
        MIN(total_score) AS min_val,
        MAX(total_score) AS max_val,
        ROUND(AVG(total_score), 2) AS avg_val,
        COUNT(*) FILTER (WHERE total_score IS NULL) AS null_count
      FROM public.academic_submissions
    ) t
  ),
  'D_constraints', (
    SELECT json_agg(t) FROM (
      SELECT
        tc.table_name,
        tc.constraint_name,
        tc.constraint_type,
        cc.check_clause
      FROM information_schema.table_constraints tc
      LEFT JOIN information_schema.check_constraints cc
        ON tc.constraint_name = cc.constraint_name
        AND tc.constraint_schema = cc.constraint_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name IN ('academic_submissions', 'academic_submission_answers')
      ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name
    ) t
  ),
  'E_indexes', (
    SELECT json_agg(t) FROM (
      SELECT
        tablename,
        indexname,
        indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('academic_submissions', 'academic_submission_answers')
        AND (indexdef ILIKE '%points_earned%' OR indexdef ILIKE '%manual_score%' OR indexdef ILIKE '%total_score%')
    ) t
  ),
  'F_rpc_signature', (
    SELECT json_agg(t) FROM (
      SELECT
        p.proname AS function_name,
        pg_get_function_arguments(p.oid) AS arguments,
        pg_get_function_result(p.oid) AS return_type,
        p.prosecdef AS is_security_definer,
        p.proconfig AS config_search_path
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'grade_academic_submission'
    ) t
  )
) AS preflight_production_report;
