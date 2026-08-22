-- ============================================================================
-- MIGRATION: ADD_DYNAMIC_SUBJECTS_TO_CLOSE_RANKING_PERIOD.sql
-- MỤC TIÊU: NÂNG CẤP RPC close_ranking_period ĐỂ SNAPSHOT MỌI MÔN HỌC ĐỘNG PHÁT SINH TRONG KỲ
-- VÀ ĐỒNG BỘ CHUẨN HÓA MÔN HỌC (CASE/WHITESPACE NORMALIZATION) GIỮA BẢNG XẾP HẠNG ACTIVE VÀ CLOSED
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. RPC CLOSE_RANKING_PERIOD (SNAPSHOT TOÀN BỘ MÔN HỌC ĐỘNG)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.close_ranking_period(p_period_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := (SELECT auth.uid());
  v_period RECORD;
  v_subj TEXT;
  v_subjects TEXT[];
BEGIN
  SELECT * INTO v_period FROM public.ranking_periods WHERE id = p_period_id FOR UPDATE;
  IF v_period.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'NOT_FOUND', 'message', 'Không tìm thấy kỳ xếp hạng.');
  END IF;

  IF NOT app_private.can_manage_class(v_period.class_id) THEN
    RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN', 'message', 'Từ chối: Bạn không có quyền đóng kỳ xếp hạng này.');
  END IF;

  IF v_period.status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_STATUS', 'message', 'Chỉ có thể đóng kỳ ở trạng thái ACTIVE.');
  END IF;

  -- 1. SNAPSHOT GAME RESULTS (SUBJECT = 'ALL') - NỬA MỞ [start_at, end_at)
  -- ĐỒNG BỘ GAME CLOSED SNAPSHOT VỚI GAME ACTIVE BASELINE SEMANTICS HIỆN TẠI
  WITH progress_stats AS (
    SELECT 
      sp.student_id,
      COALESCE(SUM(sp.stars_earned), 0) AS earned_stars,
      COUNT(DISTINCT sp.id) AS completed_count
    FROM public.student_progress sp
    WHERE sp.completed_at >= v_period.start_at 
      AND sp.completed_at < v_period.end_at
      AND NOT EXISTS (
        SELECT 1 FROM public.student_score_baselines b
        WHERE b.student_id = sp.student_id
          AND b.class_id = v_period.class_id
          AND b.revoked_at IS NULL
          AND b.scope IN ('game', 'both')
          AND (
            (b.effective_until IS NULL AND sp.completed_at < b.effective_from)
            OR (b.effective_until IS NOT NULL AND sp.completed_at >= b.effective_from AND sp.completed_at < b.effective_until)
          )
      )
    GROUP BY sp.student_id
  ),
  adjustment_stats AS (
    SELECT 
      adj.student_id,
      COALESCE(SUM(adj.delta_stars), 0) AS adj_stars
    FROM public.ranking_period_adjustments adj
    WHERE adj.period_id = p_period_id
    GROUP BY adj.student_id
  ),
  student_totals AS (
    SELECT 
      cm.student_id,
      COALESCE(ps.earned_stars, 0) + COALESCE(ads.adj_stars, 0) AS period_stars,
      COALESCE(ps.completed_count, 0) AS completed_count
    FROM public.class_members cm
    LEFT JOIN progress_stats ps ON ps.student_id = cm.student_id
    LEFT JOIN adjustment_stats ads ON ads.student_id = cm.student_id
    WHERE cm.class_id = v_period.class_id
  ),
  game_ranked AS (
    SELECT 
      student_id,
      period_stars,
      completed_count,
      DENSE_RANK() OVER (ORDER BY period_stars DESC, completed_count DESC) AS game_rank
    FROM student_totals
  )
  INSERT INTO public.ranking_period_results (
    period_id, class_id, student_id, subject, game_stars, game_rank, game_completed_count, snapshot_at
  )
  SELECT 
    p_period_id, v_period.class_id, gr.student_id, 'ALL', gr.period_stars, gr.game_rank, gr.completed_count, NOW()
  FROM game_ranked gr
  ON CONFLICT (period_id, student_id, subject) DO UPDATE SET
    game_stars = EXCLUDED.game_stars,
    game_rank = EXCLUDED.game_rank,
    game_completed_count = EXCLUDED.game_completed_count,
    snapshot_at = NOW();

  -- 2. TRÍCH XUẤT DANH SÁCH MÔN HỌC ĐỘNG (CHUẨN HÓA VÀ DEDUPLICATE CASE-INSENSITIVE)
  WITH subject_candidates AS (
    SELECT 
      LOWER(TRIM(e.subject)) AS subject_key,
      TRIM(e.subject) AS trimmed_subject,
      COUNT(*) AS freq,
      CASE WHEN TRIM(e.subject) <> UPPER(TRIM(e.subject)) THEN 1 ELSE 0 END AS has_lower,
      CASE WHEN LEFT(TRIM(e.subject), 1) = UPPER(LEFT(TRIM(e.subject), 1)) THEN 1 ELSE 0 END AS starts_upper
    FROM public.academic_exercise_assignments a
    JOIN public.academic_exercises e ON e.id = a.exercise_id
    WHERE a.class_id = v_period.class_id
      AND a.counts_toward_ranking IS TRUE
      AND e.status = 'published'
      AND a.assigned_at >= v_period.start_at
      AND a.assigned_at < v_period.end_at
      AND e.subject IS NOT NULL
      AND TRIM(e.subject) <> ''
      AND LOWER(TRIM(e.subject)) <> 'all'
    GROUP BY LOWER(TRIM(e.subject)), TRIM(e.subject)
  ),
  ranked_candidates AS (
    SELECT 
      subject_key,
      trimmed_subject,
      ROW_NUMBER() OVER (
        PARTITION BY subject_key
        ORDER BY has_lower DESC, starts_upper DESC, freq DESC, trimmed_subject ASC
      ) AS rn
    FROM subject_candidates
  ),
  normalized_subjects AS (
    SELECT 
      subject_key,
      trimmed_subject AS display_subject
    FROM ranked_candidates
    WHERE rn = 1
  )
  SELECT ARRAY['ALL'] || COALESCE(array_agg(display_subject ORDER BY display_subject ASC), ARRAY[]::TEXT[])
  INTO v_subjects
  FROM normalized_subjects;

  -- Dọn dẹp snapshot cũ không còn trong danh sách môn học kỳ này (phòng ngừa stale subjects khi re-close)
  DELETE FROM public.ranking_period_results
  WHERE period_id = p_period_id
    AND subject <> ALL(v_subjects);

  -- 3. SNAPSHOT ACADEMIC RESULTS ĐỒNG NHẤT 100% VỚI GET_ACADEMIC_PERIOD_LEADERBOARD
  FOREACH v_subj IN ARRAY v_subjects LOOP
    WITH valid_assignments AS (
      SELECT
        a.exercise_id,
        e.title,
        e.subject,
        a.assigned_at,
        GREATEST(1.0, COALESCE(
          (SELECT SUM(points) FROM public.academic_exercise_questions q WHERE q.exercise_id = e.id),
          (SELECT MAX(max_score) FROM public.academic_submissions s WHERE s.exercise_id = e.id),
          10.0
        ))::NUMERIC AS exercise_max_score
      FROM public.academic_exercise_assignments a
      JOIN public.academic_exercises e ON e.id = a.exercise_id
      WHERE a.class_id = v_period.class_id
        AND a.counts_toward_ranking IS TRUE
        AND e.status = 'published'
        AND a.assigned_at >= v_period.start_at
        AND a.assigned_at < v_period.end_at
        AND (
          v_subj = 'ALL'
          OR LOWER(TRIM(e.subject)) = LOWER(TRIM(v_subj))
        )
    ),
    students_in_class AS (
      SELECT DISTINCT ON (cm.student_id)
        cm.student_id,
        p.full_name,
        p.avatar_url,
        p.student_code
      FROM public.class_members cm
      JOIN public.profiles p ON p.id = cm.student_id
      WHERE cm.class_id = v_period.class_id AND p.role = 'student'
    ),
    student_valid_assignments AS (
      SELECT
        sc.student_id,
        va.exercise_id,
        va.exercise_max_score
      FROM students_in_class sc
      CROSS JOIN valid_assignments va
      WHERE NOT EXISTS (
        SELECT 1 FROM public.student_score_baselines b
        WHERE b.student_id = sc.student_id
          AND b.class_id = v_period.class_id
          AND b.revoked_at IS NULL
          AND b.scope IN ('academic', 'both')
          AND (
            (b.effective_until IS NULL AND va.assigned_at < b.effective_from)
            OR (b.effective_until IS NOT NULL AND va.assigned_at >= b.effective_from AND va.assigned_at < b.effective_until)
          )
      )
    ),
    student_denominators AS (
      SELECT
        sc.student_id,
        COUNT(sva.exercise_id)::INT AS total_valid_count,
        COALESCE(SUM(sva.exercise_max_score), 0)::NUMERIC AS class_max_score
      FROM students_in_class sc
      LEFT JOIN student_valid_assignments sva ON sva.student_id = sc.student_id
      GROUP BY sc.student_id
    ),
    valid_submissions AS (
      SELECT
        s.student_id,
        s.exercise_id,
        s.total_score,
        s.objective_score,
        va.exercise_max_score,
        LEAST(va.exercise_max_score, GREATEST(0.0, COALESCE(s.total_score, s.objective_score, 0.0)))::NUMERIC AS bounded_score
      FROM public.academic_submissions s
      JOIN valid_assignments va ON va.exercise_id = s.exercise_id
      JOIN student_valid_assignments sva ON sva.student_id = s.student_id AND sva.exercise_id = s.exercise_id
      WHERE s.submitted_at >= v_period.start_at
        AND s.submitted_at < v_period.end_at
        AND (
          s.status = 'graded'
          OR (
            s.status = 'submitted'
            AND s.objective_score IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM public.academic_exercise_questions q
              WHERE q.exercise_id = s.exercise_id AND q.question_type IN ('essay', 'file_upload', 'image_upload')
            )
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.student_score_baselines b
          WHERE b.student_id = s.student_id
            AND b.class_id = v_period.class_id
            AND b.revoked_at IS NULL
            AND b.scope IN ('academic', 'both')
            AND (
              (b.effective_until IS NULL AND s.submitted_at < b.effective_from)
              OR (b.effective_until IS NOT NULL AND s.submitted_at >= b.effective_from AND s.submitted_at < b.effective_until)
            )
        )
    ),
    student_best_per_exercise AS (
      SELECT
        vs.student_id,
        vs.exercise_id,
        MAX(vs.bounded_score) AS max_earned_score,
        MAX(vs.exercise_max_score) AS exercise_max_score,
        MAX(ROUND((vs.bounded_score / vs.exercise_max_score * 100.0)::numeric, 1)) AS single_ex_pct
      FROM valid_submissions vs
      GROUP BY vs.student_id, vs.exercise_id
    ),
    student_stats AS (
      SELECT
        sc.student_id,
        COALESCE(SUM(sbpe.max_earned_score), 0)::NUMERIC AS total_earned_score,
        COUNT(sbpe.exercise_id)::INT AS completed_count,
        sd.total_valid_count,
        sd.class_max_score,
        CASE
          WHEN sd.class_max_score > 0 THEN
            LEAST(100.0, ROUND((COALESCE(SUM(sbpe.max_earned_score), 0) / sd.class_max_score * 100.0)::numeric, 1))
          ELSE 0.0
        END AS academic_score_pct,
        CASE
          WHEN sd.total_valid_count > 0 THEN
            LEAST(100.0, ROUND((COUNT(sbpe.exercise_id)::numeric / sd.total_valid_count::numeric * 100.0)::numeric, 1))
          ELSE 0.0
        END AS completion_rate_pct,
        CASE
          WHEN COUNT(sbpe.exercise_id) > 0 THEN
            ROUND(AVG(sbpe.single_ex_pct)::numeric, 1)
          ELSE 0.0
        END AS avg_score_pct
      FROM students_in_class sc
      JOIN student_denominators sd ON sd.student_id = sc.student_id
      LEFT JOIN student_best_per_exercise sbpe ON sbpe.student_id = sc.student_id
      GROUP BY sc.student_id, sd.total_valid_count, sd.class_max_score
    ),
    academic_ranked AS (
      SELECT
        ss.*,
        DENSE_RANK() OVER (
          ORDER BY
            ss.academic_score_pct DESC,
            ss.completion_rate_pct DESC,
            ss.completed_count DESC,
            ss.avg_score_pct DESC
        ) AS rank_pos
      FROM student_stats ss
    )
    INSERT INTO public.ranking_period_results (
      period_id, class_id, student_id, subject, academic_score_pct, academic_rank, academic_completed_count, academic_assigned_count, completion_rate_pct, avg_score_pct, total_earned_score, class_max_score, snapshot_at
    )
    SELECT
      p_period_id, v_period.class_id, ar.student_id, v_subj, ar.academic_score_pct, ar.rank_pos, ar.completed_count, ar.total_valid_count, ar.completion_rate_pct, ar.avg_score_pct, ar.total_earned_score, ar.class_max_score, NOW()
    FROM academic_ranked ar
    ON CONFLICT (period_id, student_id, subject) DO UPDATE SET
      academic_score_pct = EXCLUDED.academic_score_pct,
      academic_rank = EXCLUDED.academic_rank,
      academic_completed_count = EXCLUDED.academic_completed_count,
      academic_assigned_count = EXCLUDED.academic_assigned_count,
      completion_rate_pct = EXCLUDED.completion_rate_pct,
      avg_score_pct = EXCLUDED.avg_score_pct,
      total_earned_score = EXCLUDED.total_earned_score,
      class_max_score = EXCLUDED.class_max_score,
      snapshot_at = NOW();
  END LOOP;

  -- 4. CẬP NHẬT TRẠNG THÁI CLOSED
  UPDATE public.ranking_periods SET
    status = 'CLOSED',
    closed_at = NOW(),
    closed_by = v_uid
  WHERE id = p_period_id;

  RETURN jsonb_build_object('success', true, 'status', 'CLOSED', 'message', 'Đã đóng kỳ xếp hạng và lưu snapshot tổng kết thành công.');
END;
$$;

REVOKE ALL ON FUNCTION public.close_ranking_period(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_ranking_period(UUID) TO authenticated;

-- ============================================================================
-- 2. RPC GET_ACADEMIC_PERIOD_LEADERBOARD (ĐỒNG BỘ CHUẨN HÓA MÔN HỌC ACTIVE & CLOSED)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_academic_period_leaderboard(
  p_period_id UUID,
  p_subject TEXT DEFAULT 'ALL'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_period RECORD;
  v_res JSONB;
BEGIN
  SELECT * INTO v_period FROM public.ranking_periods WHERE id = p_period_id;
  IF v_period.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'NOT_FOUND', 'message', 'Không tìm thấy kỳ xếp hạng.');
  END IF;

  IF NOT app_private.can_read_class(v_period.class_id) THEN
    RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN', 'message', 'Từ chối: Bạn không thuộc lớp này.');
  END IF;

  -- NẾU KỲ ĐÃ CLOSED -> ĐỌC TỪ SNAPSHOT RESULTS THEO MÔN (BẤT BIẾN, CASE-INSENSITIVE & WHITESPACE-TRIMMED)
  IF v_period.status = 'CLOSED' THEN
    WITH ranked_snapshot AS (
      SELECT
        r.student_id,
        p.full_name,
        p.avatar_url,
        p.student_code,
        r.academic_score_pct,
        r.total_earned_score,
        r.academic_completed_count AS completed_count,
        r.academic_assigned_count AS total_valid_count,
        r.completion_rate_pct,
        r.avg_score_pct AS avg_score,
        DENSE_RANK() OVER (
          ORDER BY
            r.academic_score_pct DESC,
            r.completion_rate_pct DESC,
            r.academic_completed_count DESC,
            r.avg_score_pct DESC
        ) AS calc_rank,
        COUNT(*) OVER (
          PARTITION BY
            r.academic_score_pct,
            r.completion_rate_pct,
            r.academic_completed_count,
            r.avg_score_pct
        ) AS tie_count
      FROM public.ranking_period_results r
      JOIN public.profiles p ON p.id = r.student_id
      WHERE r.period_id = p_period_id
        AND (
          CASE
            WHEN p_subject IS NULL OR TRIM(p_subject) = '' OR LOWER(TRIM(p_subject)) = 'all' THEN
              r.subject = 'ALL'
            ELSE
              LOWER(TRIM(r.subject)) = LOWER(TRIM(p_subject))
          END
        )
    )
    SELECT jsonb_agg(
      jsonb_build_object(
        'rank', calc_rank,
        'is_tied', (tie_count > 1),
        'student_id', student_id,
        'full_name', full_name,
        'avatar_url', avatar_url,
        'student_code', student_code,
        'academic_score_pct', academic_score_pct,
        'total_earned_score', total_earned_score,
        'completed_count', completed_count,
        'total_valid_count', total_valid_count,
        'completion_rate_pct', completion_rate_pct,
        'avg_score', avg_score
      ) ORDER BY calc_rank ASC, full_name ASC
    ) INTO v_res FROM ranked_snapshot;

    RETURN COALESCE(v_res, '[]'::jsonb);
  END IF;

  -- NẾU DRAFT / ACTIVE -> TÍNH ĐỘNG VỚI MẪU SỐ DENOMINATOR RIÊNG TỪNG HỌC SINH THEO BASELINE
  WITH valid_assignments AS (
    SELECT
      a.exercise_id,
      e.title,
      e.subject,
      a.assigned_at,
      GREATEST(1.0, COALESCE(
        (SELECT SUM(points) FROM public.academic_exercise_questions q WHERE q.exercise_id = e.id),
        (SELECT MAX(max_score) FROM public.academic_submissions s WHERE s.exercise_id = e.id),
        10.0
      ))::NUMERIC AS exercise_max_score
    FROM public.academic_exercise_assignments a
    JOIN public.academic_exercises e ON e.id = a.exercise_id
    WHERE a.class_id = v_period.class_id
      AND a.counts_toward_ranking IS TRUE
      AND e.status = 'published'
      AND a.assigned_at >= v_period.start_at
      AND a.assigned_at < v_period.end_at
      AND (
        p_subject IS NULL
        OR TRIM(p_subject) = ''
        OR LOWER(TRIM(p_subject)) = 'all'
        OR LOWER(TRIM(e.subject)) = LOWER(TRIM(p_subject))
      )
  ),
  students_in_class AS (
    SELECT DISTINCT ON (cm.student_id)
      cm.student_id,
      p.full_name,
      p.avatar_url,
      p.student_code
    FROM public.class_members cm
    JOIN public.profiles p ON p.id = cm.student_id
    WHERE cm.class_id = v_period.class_id AND p.role = 'student'
  ),
  -- MẪU SỐ RIÊNG TỪNG HỌC SINH
  student_valid_assignments AS (
    SELECT
      sc.student_id,
      va.exercise_id,
      va.exercise_max_score
    FROM students_in_class sc
    CROSS JOIN valid_assignments va
    WHERE NOT EXISTS (
      SELECT 1 FROM public.student_score_baselines b
      WHERE b.student_id = sc.student_id
        AND b.class_id = v_period.class_id
        AND b.revoked_at IS NULL
        AND b.scope IN ('academic', 'both')
        AND (
          (b.effective_until IS NULL AND va.assigned_at < b.effective_from)
          OR (b.effective_until IS NOT NULL AND va.assigned_at >= b.effective_from AND va.assigned_at < b.effective_until)
        )
    )
  ),
  student_denominators AS (
    SELECT
      sc.student_id,
      COUNT(sva.exercise_id)::INT AS total_valid_count,
      COALESCE(SUM(sva.exercise_max_score), 0)::NUMERIC AS class_max_score
    FROM students_in_class sc
    LEFT JOIN student_valid_assignments sva ON sva.student_id = sc.student_id
    GROUP BY sc.student_id
  ),
  valid_submissions AS (
    SELECT
      s.student_id,
      s.exercise_id,
      s.total_score,
      s.objective_score,
      va.exercise_max_score,
      LEAST(va.exercise_max_score, GREATEST(0.0, COALESCE(s.total_score, s.objective_score, 0.0)))::NUMERIC AS bounded_score
    FROM public.academic_submissions s
    JOIN valid_assignments va ON va.exercise_id = s.exercise_id
    JOIN student_valid_assignments sva ON sva.student_id = s.student_id AND sva.exercise_id = s.exercise_id
    WHERE s.submitted_at >= v_period.start_at
      AND s.submitted_at < v_period.end_at
      AND (
        s.status = 'graded'
        OR (
          s.status = 'submitted'
          AND s.objective_score IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.academic_exercise_questions q
            WHERE q.exercise_id = s.exercise_id AND q.question_type IN ('essay', 'file_upload', 'image_upload')
          )
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.student_score_baselines b
        WHERE b.student_id = s.student_id
          AND b.class_id = v_period.class_id
          AND b.revoked_at IS NULL
          AND b.scope IN ('academic', 'both')
          AND (
            (b.effective_until IS NULL AND s.submitted_at < b.effective_from)
            OR (b.effective_until IS NOT NULL AND s.submitted_at >= b.effective_from AND s.submitted_at < b.effective_until)
          )
      )
  ),
  student_best_per_exercise AS (
    SELECT
      vs.student_id,
      vs.exercise_id,
      MAX(vs.bounded_score) AS max_earned_score,
      MAX(vs.exercise_max_score) AS exercise_max_score,
      MAX(ROUND((vs.bounded_score / vs.exercise_max_score * 100.0)::numeric, 1)) AS single_ex_pct
    FROM valid_submissions vs
    GROUP BY vs.student_id, vs.exercise_id
  ),
  student_stats AS (
    SELECT
      sc.student_id,
      sc.full_name,
      sc.avatar_url,
      sc.student_code,
      COALESCE(SUM(sbpe.max_earned_score), 0)::NUMERIC AS total_earned_score,
      COUNT(sbpe.exercise_id)::INT AS completed_count,
      sd.total_valid_count,
      sd.class_max_score,
      CASE
        WHEN sd.class_max_score > 0 THEN
          LEAST(100.0, ROUND((COALESCE(SUM(sbpe.max_earned_score), 0) / sd.class_max_score * 100.0)::numeric, 1))
        ELSE 0.0
      END AS academic_score_pct,
      CASE
        WHEN sd.total_valid_count > 0 THEN
          LEAST(100.0, ROUND((COUNT(sbpe.exercise_id)::numeric / sd.total_valid_count::numeric * 100.0)::numeric, 1))
        ELSE 0.0
      END AS completion_rate_pct,
      CASE
        WHEN COUNT(sbpe.exercise_id) > 0 THEN
          ROUND(AVG(sbpe.single_ex_pct)::numeric, 1)
        ELSE 0.0
      END AS avg_score_pct
    FROM students_in_class sc
    JOIN student_denominators sd ON sd.student_id = sc.student_id
    LEFT JOIN student_best_per_exercise sbpe ON sbpe.student_id = sc.student_id
    GROUP BY sc.student_id, sc.full_name, sc.avatar_url, sc.student_code, sd.total_valid_count, sd.class_max_score
  ),
  ranked_students AS (
    SELECT
      ss.*,
      DENSE_RANK() OVER (
        ORDER BY
          ss.academic_score_pct DESC,
          ss.completion_rate_pct DESC,
          ss.completed_count DESC,
          ss.avg_score_pct DESC
      ) AS rank_pos,
      COUNT(*) OVER (
        PARTITION BY
          ss.academic_score_pct,
          ss.completion_rate_pct,
          ss.completed_count,
          ss.avg_score_pct
      ) AS tie_count
    FROM student_stats ss
  )
  SELECT jsonb_build_object(
    'success', true,
    'period_id', p_period_id,
    'subject', p_subject,
    'total_valid_exercises', (SELECT COUNT(*)::INT FROM valid_assignments),
    'total_class_max_score', (SELECT COALESCE(SUM(exercise_max_score), 0)::NUMERIC FROM valid_assignments),
    'leaderboard', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'rank', r.rank_pos,
          'is_tied', (r.tie_count > 1),
          'student_id', r.student_id,
          'full_name', r.full_name,
          'avatar_url', r.avatar_url,
          'student_code', r.student_code,
          'academic_score_pct', r.academic_score_pct,
          'total_earned_score', r.total_earned_score,
          'completed_count', r.completed_count,
          'total_valid_count', r.total_valid_count,
          'completion_rate_pct', completion_rate_pct,
          'avg_score', r.avg_score_pct
        )
        ORDER BY r.rank_pos ASC, r.full_name ASC
      ),
      '[]'::jsonb
    )
  ) INTO v_res
  FROM ranked_students r;

  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.get_academic_period_leaderboard(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_academic_period_leaderboard(UUID, TEXT) TO authenticated;

COMMIT;
