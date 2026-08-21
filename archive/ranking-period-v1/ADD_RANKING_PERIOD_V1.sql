-- ============================================================================
-- SQL MIGRATION: 🏆 RANKING PERIOD V1 — REVISION 2 (FINAL LOGIC ALIGNMENT)
-- ============================================================================

BEGIN;

-- 1. BẢNG KỲ XẾP HẠNG (RANKING_PERIODS)
CREATE TABLE IF NOT EXISTS public.ranking_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  period_type TEXT NOT NULL CHECK (period_type IN ('WEEK', 'MONTH', 'SEMESTER', 'CUSTOM')),
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'CLOSED', 'ARCHIVED')),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  closed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ,
  CONSTRAINT chk_ranking_period_dates CHECK (end_at > start_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ranking_periods_one_active_per_class 
ON public.ranking_periods (class_id) WHERE (status = 'ACTIVE');

CREATE INDEX IF NOT EXISTS idx_ranking_periods_class_status ON public.ranking_periods(class_id, status);

-- 2. BẢNG ĐIỀU CHỈNH SAO KỲ (RANKING_PERIOD_ADJUSTMENTS)
CREATE TABLE IF NOT EXISTS public.ranking_period_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES public.ranking_periods(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  delta_stars INTEGER NOT NULL CHECK (delta_stars <> 0),
  reason TEXT NOT NULL CHECK (TRIM(reason) <> ''),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reverses_adjustment_id UUID REFERENCES public.ranking_period_adjustments(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_period_adjustments_single_reversal 
ON public.ranking_period_adjustments(reverses_adjustment_id) WHERE (reverses_adjustment_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_period_adjustments_student ON public.ranking_period_adjustments(period_id, student_id);

-- 3. BẢNG NHẬN XẾP HỌC SINH THEO KỲ (RANKING_PERIOD_STUDENT_COMMENTS)
CREATE TABLE IF NOT EXISTS public.ranking_period_student_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES public.ranking_periods(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  teacher_comment TEXT,
  auto_suggestion TEXT,
  auto_summary JSONB,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_period_student_comment UNIQUE(period_id, student_id)
);

-- 4. BẢNG LƯU SNAPSHOT KẾT QUẢ KỲ ĐÃ ĐÓNG (RANKING_PERIOD_RESULTS)
CREATE TABLE IF NOT EXISTS public.ranking_period_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES public.ranking_periods(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  subject TEXT NOT NULL DEFAULT 'ALL',
  game_stars INTEGER DEFAULT 0,
  game_rank INTEGER DEFAULT 0,
  game_completed_count INTEGER DEFAULT 0,
  academic_score_pct NUMERIC(5,1) DEFAULT 0.0,
  academic_rank INTEGER DEFAULT 0,
  academic_completed_count INTEGER DEFAULT 0,
  academic_assigned_count INTEGER DEFAULT 0,
  completion_rate_pct NUMERIC(5,1) DEFAULT 0.0,
  avg_score_pct NUMERIC(5,1) DEFAULT 0.0,
  total_earned_score NUMERIC(7,1) DEFAULT 0.0,
  class_max_score NUMERIC(7,1) DEFAULT 0.0,
  snapshot_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_period_student_subject_result UNIQUE(period_id, student_id, subject)
);

-- BẬT ROW LEVEL SECURITY
ALTER TABLE public.ranking_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ranking_period_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ranking_period_student_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ranking_period_results ENABLE ROW LEVEL SECURITY;

-- POLICIES BẢO MẬT
DROP POLICY IF EXISTS "ranking_periods_select" ON public.ranking_periods;
CREATE POLICY "ranking_periods_select" ON public.ranking_periods FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') OR
  EXISTS (SELECT 1 FROM public.classes WHERE id = class_id AND teacher_id = auth.uid()) OR
  EXISTS (SELECT 1 FROM public.class_members WHERE class_id = ranking_periods.class_id AND student_id = auth.uid())
);

-- HELPER INTERNAL FUNCTIONS TRONG APP_PRIVATE (NỘI BỘ, KHÔNG EXPOSE RA CLIENT)
CREATE OR REPLACE FUNCTION app_private.can_manage_class(p_class_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := (SELECT auth.uid());
  v_role TEXT;
  v_disabled BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN RETURN FALSE; END IF;
  SELECT role, COALESCE(is_disabled, false) INTO v_role, v_disabled FROM public.profiles WHERE id = v_uid;
  IF v_disabled IS TRUE THEN RETURN FALSE; END IF;
  IF v_role = 'admin' THEN RETURN TRUE; END IF;
  IF v_role = 'teacher' THEN
    RETURN EXISTS (SELECT 1 FROM public.classes WHERE id = p_class_id AND teacher_id = v_uid);
  END IF;
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.can_read_class(p_class_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := (SELECT auth.uid());
  v_role TEXT;
  v_disabled BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN RETURN FALSE; END IF;
  SELECT role, COALESCE(is_disabled, false) INTO v_role, v_disabled FROM public.profiles WHERE id = v_uid;
  IF v_disabled IS TRUE THEN RETURN FALSE; END IF;
  IF v_role = 'admin' THEN RETURN TRUE; END IF;
  IF v_role = 'teacher' THEN
    RETURN EXISTS (SELECT 1 FROM public.classes WHERE id = p_class_id AND teacher_id = v_uid);
  END IF;
  IF v_role = 'student' THEN
    RETURN EXISTS (SELECT 1 FROM public.class_members WHERE class_id = p_class_id AND student_id = v_uid);
  END IF;
  RETURN FALSE;
END;
$$;

-- THU HỒI HOÀN TOÀN TRUY CẬP TRỰC TIẾP VÀO APP_PRIVATE HELPER FUNCTIONS
REVOKE ALL ON FUNCTION app_private.can_manage_class(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.can_read_class(UUID) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 5. RPC 1: TẠO KỲ XẾP HẠNG MỚI (CREATE_RANKING_PERIOD)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_ranking_period(
  p_class_id UUID,
  p_name TEXT,
  p_period_type TEXT,
  p_start_at TIMESTAMPTZ,
  p_end_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := (SELECT auth.uid());
  v_new_id UUID;
BEGIN
  IF NOT app_private.can_manage_class(p_class_id) THEN
    RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN', 'message', 'Từ chối: Bạn không có quyền quản lý kỳ xếp hạng cho lớp này.');
  END IF;

  IF p_name IS NULL OR TRIM(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_PARAM', 'message', 'Tên kỳ xếp hạng không được để trống.');
  END IF;

  IF p_period_type NOT IN ('WEEK', 'MONTH', 'SEMESTER', 'CUSTOM') THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_PARAM', 'message', 'Loại kỳ xếp hạng không hợp lệ.');
  END IF;

  IF p_end_at <= p_start_at THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_PARAM', 'message', 'Thời gian kết thúc phải lớn hơn thời gian bắt đầu.');
  END IF;

  INSERT INTO public.ranking_periods (class_id, name, period_type, start_at, end_at, status, created_by)
  VALUES (p_class_id, TRIM(p_name), p_period_type, p_start_at, p_end_at, 'DRAFT', v_uid)
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'CREATED',
    'message', 'Đã tạo kỳ xếp hạng mới ở trạng thái DRAFT.',
    'period_id', v_new_id
  );
END;
$$;

-- ============================================================================
-- 6. RPC 2: KÍCH HOẠT KỲ XẾP HẠNG (ACTIVATE_RANKING_PERIOD)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.activate_ranking_period(p_period_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_period RECORD;
BEGIN
  SELECT * INTO v_period FROM public.ranking_periods WHERE id = p_period_id;
  IF v_period.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'NOT_FOUND', 'message', 'Không tìm thấy kỳ xếp hạng.');
  END IF;

  IF NOT app_private.can_manage_class(v_period.class_id) THEN
    RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN', 'message', 'Từ chối: Bạn không có quyền kích hoạt kỳ xếp hạng này.');
  END IF;

  IF v_period.status <> 'DRAFT' THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_STATUS', 'message', 'Chỉ có thể kích hoạt kỳ ở trạng thái DRAFT.');
  END IF;

  IF EXISTS (SELECT 1 FROM public.ranking_periods WHERE class_id = v_period.class_id AND status = 'ACTIVE') THEN
    RETURN jsonb_build_object('success', false, 'status', 'ACTIVE_EXISTS', 'message', 'Lớp này hiện đã có một kỳ đang KÍCH HOẠT. Vui lòng đóng kỳ cũ trước.');
  END IF;

  UPDATE public.ranking_periods SET status = 'ACTIVE' WHERE id = p_period_id;

  RETURN jsonb_build_object('success', true, 'status', 'ACTIVATED', 'message', 'Đã kích hoạt kỳ xếp hạng thành công.');
END;
$$;

-- ============================================================================
-- 7. RPC 3: ĐÓNG KỲ XẾP HẠNG & SNAPSHOT KẾT QUẢ ATOMIC (CLOSE_RANKING_PERIOD)
-- TÁI SỬ DỤNG CHÍNH XÁC SEMANTICS HỌC THUẬT VÀ KHÔNG DOUBLE COUNT GAME
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
  v_subjects TEXT[] := ARRAY['ALL', 'Toán', 'Tiếng Việt'];
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

  -- 1. SNAPSHOT GAME RESULTS (SUBJECT = 'ALL') - HALF OPEN TIME INTERVAL [start_at, end_at)
  WITH progress_stats AS (
    SELECT 
      sp.student_id,
      COALESCE(SUM(sp.stars_earned), 0) AS earned_stars,
      COUNT(DISTINCT sp.id) AS completed_count
    FROM public.student_progress sp
    WHERE sp.completed_at >= v_period.start_at 
      AND sp.completed_at < v_period.end_at
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

  -- 2. SNAPSHOT ACADEMIC RESULTS KHỚP 100% SEMANTICS get_academic_class_leaderboard (BÀI GRADED HOẶC SUBMITTED KHÔNG CÓ TỰ LUẬN)
  FOREACH v_subj IN ARRAY v_subjects LOOP
    WITH valid_assignments AS (
      SELECT 
        a.exercise_id,
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
        AND (v_subj = 'ALL' OR LOWER(e.subject) = LOWER(v_subj))
    ),
    class_totals AS (
      SELECT 
        COUNT(*)::INT AS valid_count,
        COALESCE(SUM(exercise_max_score), 0)::NUMERIC AS total_max_score
      FROM valid_assignments
    ),
    valid_submissions AS (
      SELECT 
        s.student_id,
        s.exercise_id,
        LEAST(va.exercise_max_score, GREATEST(0.0, COALESCE(s.total_score, s.objective_score, 0.0)))::NUMERIC AS bounded_score,
        va.exercise_max_score
      FROM public.academic_submissions s
      JOIN valid_assignments va ON va.exercise_id = s.exercise_id
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
        cm.student_id,
        COALESCE(SUM(sbpe.max_earned_score), 0)::NUMERIC AS total_earned_score,
        COUNT(sbpe.exercise_id)::INT AS completed_count,
        ct.valid_count AS total_valid_count,
        ct.total_max_score AS class_max_score,
        CASE 
          WHEN ct.total_max_score > 0 THEN
            LEAST(100.0, ROUND((COALESCE(SUM(sbpe.max_earned_score), 0) / ct.total_max_score * 100.0)::numeric, 1))
          ELSE 0.0
        END AS academic_score_pct,
        CASE 
          WHEN ct.valid_count > 0 THEN
            LEAST(100.0, ROUND((COUNT(sbpe.exercise_id)::numeric / ct.valid_count::numeric * 100.0)::numeric, 1))
          ELSE 0.0
        END AS completion_rate_pct,
        CASE 
          WHEN COUNT(sbpe.exercise_id) > 0 THEN
            ROUND(AVG(sbpe.single_ex_pct)::numeric, 1)
          ELSE 0.0
        END AS avg_score_pct
      FROM public.class_members cm
      CROSS JOIN class_totals ct
      LEFT JOIN student_best_per_exercise sbpe ON sbpe.student_id = cm.student_id
      WHERE cm.class_id = v_period.class_id
      GROUP BY cm.student_id, ct.valid_count, ct.total_max_score
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

  -- 3. CẬP NHẬT TRẠNG THÁI CLOSED
  UPDATE public.ranking_periods SET
    status = 'CLOSED',
    closed_at = NOW(),
    closed_by = v_uid
  WHERE id = p_period_id;

  RETURN jsonb_build_object('success', true, 'status', 'CLOSED', 'message', 'Đã đóng kỳ xếp hạng và lưu snapshot tổng kết thành công.');
END;
$$;

-- ============================================================================
-- 8. RPC 4: BẢNG XẾP HẠNG TRÒ CHƠI THEO KỲ (GET_GAME_PERIOD_LEADERBOARD)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_game_period_leaderboard(p_period_id UUID)
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

  -- SERVER-SIDE AUTHORIZATION CHECK
  IF NOT app_private.can_read_class(v_period.class_id) THEN
    RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN', 'message', 'Từ chối: Bạn không thuộc lớp này.');
  END IF;

  -- NẾU KỲ ĐÃ CLOSED -> ĐỌC TỪ SNAPSHOT RESULTS
  IF v_period.status = 'CLOSED' THEN
    WITH ranked_snapshot AS (
      SELECT 
        r.student_id,
        p.full_name,
        p.avatar_url,
        p.student_code,
        r.game_stars AS period_stars,
        r.game_completed_count AS completed_count,
        COALESCE(p.total_stars, 0) AS total_stars,
        DENSE_RANK() OVER (ORDER BY r.game_stars DESC, r.game_completed_count DESC) AS calc_rank,
        COUNT(*) OVER (PARTITION BY r.game_stars, r.game_completed_count) AS tie_count
      FROM public.ranking_period_results r
      JOIN public.profiles p ON p.id = r.student_id
      WHERE r.period_id = p_period_id AND r.subject = 'ALL'
    )
    SELECT jsonb_agg(
      jsonb_build_object(
        'rank', calc_rank,
        'is_tied', (tie_count > 1),
        'student_id', student_id,
        'full_name', full_name,
        'avatar_url', avatar_url,
        'student_code', student_code,
        'period_stars', period_stars,
        'completed_count', completed_count,
        'total_stars', total_stars
      ) ORDER BY calc_rank ASC, full_name ASC
    ) INTO v_res FROM ranked_snapshot;

    RETURN COALESCE(v_res, '[]'::jsonb);
  END IF;

  -- NẾU KỲ DRAFT / ACTIVE -> TÍNH ĐỘNG HỢP NHẤT KHÔNG DOUBLE COUNT
  WITH progress_stats AS (
    SELECT 
      sp.student_id,
      COALESCE(SUM(sp.stars_earned), 0) AS earned_stars,
      COUNT(DISTINCT sp.id) AS completed_count
    FROM public.student_progress sp
    WHERE sp.completed_at >= v_period.start_at 
      AND sp.completed_at < v_period.end_at
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
      p.full_name,
      p.avatar_url,
      p.student_code,
      COALESCE(p.total_stars, 0) AS total_stars,
      COALESCE(ps.earned_stars, 0) + COALESCE(ads.adj_stars, 0) AS period_stars,
      COALESCE(ps.completed_count, 0) AS completed_count
    FROM public.class_members cm
    JOIN public.profiles p ON p.id = cm.student_id
    LEFT JOIN progress_stats ps ON ps.student_id = cm.student_id
    LEFT JOIN adjustment_stats ads ON ads.student_id = cm.student_id
    WHERE cm.class_id = v_period.class_id
  ),
  ranked AS (
    SELECT 
      *,
      DENSE_RANK() OVER (ORDER BY period_stars DESC, completed_count DESC) AS rank,
      COUNT(*) OVER (PARTITION BY period_stars, completed_count) AS tie_count
    FROM student_totals
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'rank', rank,
      'is_tied', (tie_count > 1),
      'student_id', student_id,
      'full_name', full_name,
      'avatar_url', avatar_url,
      'student_code', student_code,
      'period_stars', period_stars,
      'completed_count', completed_count,
      'total_stars', total_stars
    ) ORDER BY rank ASC, full_name ASC
  ) INTO v_res FROM ranked;

  RETURN COALESCE(v_res, '[]'::jsonb);
END;
$$;

-- ============================================================================
-- 9. RPC 5: BẢNG XẾP HẠNG HỌC THUẬT THEO KỲ (GET_ACADEMIC_PERIOD_LEADERBOARD)
-- TÁI SỬ DỤNG CHÍNH XÁC SEMANTICS get_academic_class_leaderboard
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

  -- SERVER-SIDE AUTHORIZATION CHECK
  IF NOT app_private.can_read_class(v_period.class_id) THEN
    RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN', 'message', 'Từ chối: Bạn không thuộc lớp này.');
  END IF;

  -- NẾU KỲ ĐÃ CLOSED -> ĐỌC TỪ SNAPSHOT RESULTS THEO MÔN
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
      WHERE r.period_id = p_period_id AND r.subject = COALESCE(NULLIF(p_subject, ''), 'ALL')
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

  -- NẾU DRAFT / ACTIVE -> TÍNH ĐỘNG CHUẨN SEMANTICS HỌC THUẬT
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
        p_subject = 'ALL' 
        OR p_subject IS NULL 
        OR TRIM(p_subject) = '' 
        OR LOWER(e.subject) = LOWER(p_subject)
      )
  ),
  class_totals AS (
    SELECT 
      COUNT(*)::INT AS valid_count,
      COALESCE(SUM(exercise_max_score), 0)::NUMERIC AS total_max_score
    FROM valid_assignments
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
      ct.valid_count AS total_valid_count,
      ct.total_max_score AS class_max_score,
      CASE 
        WHEN ct.total_max_score > 0 THEN
          LEAST(100.0, ROUND((COALESCE(SUM(sbpe.max_earned_score), 0) / ct.total_max_score * 100.0)::numeric, 1))
        ELSE 0.0
      END AS academic_score_pct,
      CASE 
        WHEN ct.valid_count > 0 THEN
          LEAST(100.0, ROUND((COUNT(sbpe.exercise_id)::numeric / ct.valid_count::numeric * 100.0)::numeric, 1))
        ELSE 0.0
      END AS completion_rate_pct,
      CASE 
        WHEN COUNT(sbpe.exercise_id) > 0 THEN
          ROUND(AVG(sbpe.single_ex_pct)::numeric, 1)
        ELSE 0.0
      END AS avg_score_pct
    FROM students_in_class sc
    CROSS JOIN class_totals ct
    LEFT JOIN student_best_per_exercise sbpe ON sbpe.student_id = sc.student_id
    GROUP BY sc.student_id, sc.full_name, sc.avatar_url, sc.student_code, ct.valid_count, ct.total_max_score
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
  SELECT jsonb_agg(
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
      'completion_rate_pct', r.completion_rate_pct,
      'avg_score', r.avg_score_pct
    ) ORDER BY r.rank_pos ASC, r.full_name ASC
  ) INTO v_res FROM ranked_students r;

  RETURN COALESCE(v_res, '[]'::jsonb);
END;
$$;

-- ============================================================================
-- 10. RPC 6: LƯU NHẬN XẾT HỌC SINH THEO KỲ (SAVE_RANKING_PERIOD_STUDENT_COMMENT)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.save_ranking_period_student_comment(
  p_period_id UUID,
  p_student_id UUID,
  p_teacher_comment TEXT,
  p_auto_suggestion TEXT DEFAULT NULL,
  p_auto_summary JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := (SELECT auth.uid());
  v_period RECORD;
BEGIN
  SELECT * INTO v_period FROM public.ranking_periods WHERE id = p_period_id;
  IF v_period.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'NOT_FOUND', 'message', 'Không tìm thấy kỳ xếp hạng.');
  END IF;

  IF NOT app_private.can_manage_class(v_period.class_id) THEN
    RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN', 'message', 'Từ chối: Bạn không có quyền lưu nhận xét cho học sinh lớp này.');
  END IF;

  -- VALIDATE TARGET STUDENT MEMBERSHIP IN CLASS FOR ALL ROLES
  IF NOT EXISTS (
    SELECT 1 FROM public.class_members cm 
    JOIN public.profiles p ON p.id = cm.student_id 
    WHERE cm.class_id = v_period.class_id AND cm.student_id = p_student_id AND p.role = 'student'
  ) THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_STUDENT', 'message', 'Học sinh mục tiêu không thuộc lớp này.');
  END IF;

  INSERT INTO public.ranking_period_student_comments (
    period_id, student_id, class_id, teacher_comment, auto_suggestion, auto_summary, created_by, updated_by
  ) VALUES (
    p_period_id, p_student_id, v_period.class_id, p_teacher_comment, p_auto_suggestion, p_auto_summary, v_uid, v_uid
  ) ON CONFLICT (period_id, student_id) DO UPDATE SET
    teacher_comment = EXCLUDED.teacher_comment,
    auto_suggestion = COALESCE(EXCLUDED.auto_suggestion, ranking_period_student_comments.auto_suggestion),
    auto_summary = COALESCE(EXCLUDED.auto_summary, ranking_period_student_comments.auto_summary),
    updated_by = v_uid,
    updated_at = NOW();

  RETURN jsonb_build_object('success', true, 'status', 'SAVED', 'message', 'Đã lưu nhận xét học sinh thành công.');
END;
$$;

-- ============================================================================
-- 11. RPC 7 & 8: ĐIỀU CHỈNH SAO XẾP HẠNG (CHỈ CHO PHÉP KHI STATUS = ACTIVE)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.add_ranking_period_adjustment(
  p_period_id UUID,
  p_student_id UUID,
  p_delta_stars INTEGER,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := (SELECT auth.uid());
  v_period RECORD;
  v_adj_id UUID;
BEGIN
  SELECT * INTO v_period FROM public.ranking_periods WHERE id = p_period_id;
  IF v_period.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'NOT_FOUND', 'message', 'Không tìm thấy kỳ xếp hạng.');
  END IF;

  IF NOT app_private.can_manage_class(v_period.class_id) THEN
    RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN', 'message', 'Từ chối: Bạn không có quyền điều chỉnh điểm kỳ này.');
  END IF;

  -- CHỈ CHO PHÉP KHI KỲ ĐANG ACTIVE
  IF v_period.status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('success', false, 'status', 'PERIOD_NOT_ACTIVE', 'message', 'Chỉ có thể điều chỉnh điểm cho kỳ xếp hạng đang KÍCH HOẠT (ACTIVE).');
  END IF;

  IF p_delta_stars IS NULL OR p_delta_stars = 0 THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_PARAM', 'message', 'Số sao điều chỉnh phải khác 0.');
  END IF;

  IF p_reason IS NULL OR TRIM(p_reason) = '' THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_PARAM', 'message', 'Vui lòng cung cấp lý do điều chỉnh.');
  END IF;

  -- VALIDATE TARGET STUDENT MEMBERSHIP IN CLASS
  IF NOT EXISTS (
    SELECT 1 FROM public.class_members cm 
    JOIN public.profiles p ON p.id = cm.student_id 
    WHERE cm.class_id = v_period.class_id AND cm.student_id = p_student_id AND p.role = 'student'
  ) THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_STUDENT', 'message', 'Học sinh mục tiêu không thuộc lớp này.');
  END IF;

  INSERT INTO public.ranking_period_adjustments (
    period_id, class_id, student_id, delta_stars, reason, created_by
  ) VALUES (
    p_period_id, v_period.class_id, p_student_id, p_delta_stars, TRIM(p_reason), v_uid
  ) RETURNING id INTO v_adj_id;

  RETURN jsonb_build_object('success', true, 'status', 'ADJUSTED', 'message', 'Đã lưu điều chỉnh sao kỳ thành công.', 'adjustment_id', v_adj_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_ranking_period_adjustment(
  p_adjustment_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := (SELECT auth.uid());
  v_old_adj RECORD;
  v_period RECORD;
  v_new_adj_id UUID;
BEGIN
  SELECT * INTO v_old_adj FROM public.ranking_period_adjustments WHERE id = p_adjustment_id;
  IF v_old_adj.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'NOT_FOUND', 'message', 'Không tìm thấy bản ghi điều chỉnh.');
  END IF;

  SELECT * INTO v_period FROM public.ranking_periods WHERE id = v_old_adj.period_id;
  IF v_period.status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('success', false, 'status', 'PERIOD_NOT_ACTIVE', 'message', 'Chỉ có thể hoàn tác điều chỉnh trong kỳ đang KÍCH HOẠT (ACTIVE).');
  END IF;

  IF NOT app_private.can_manage_class(v_old_adj.class_id) THEN
    RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN', 'message', 'Từ chối: Bạn không có quyền hoàn tác điều chỉnh này.');
  END IF;

  IF v_old_adj.reverses_adjustment_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'CANNOT_REVERSE_REVERSAL', 'message', 'Không thể hoàn tác một bản ghi hoàn tác.');
  END IF;

  IF EXISTS (SELECT 1 FROM public.ranking_period_adjustments WHERE reverses_adjustment_id = p_adjustment_id) THEN
    RETURN jsonb_build_object('success', false, 'status', 'ALREADY_REVERSED', 'message', 'Bản ghi điều chỉnh này đã được hoàn tác trước đó.');
  END IF;

  IF p_reason IS NULL OR TRIM(p_reason) = '' THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_PARAM', 'message', 'Vui lòng nhập lý do hoàn tác.');
  END IF;

  INSERT INTO public.ranking_period_adjustments (
    period_id, class_id, student_id, delta_stars, reason, created_by, reverses_adjustment_id
  ) VALUES (
    v_old_adj.period_id, v_old_adj.class_id, v_old_adj.student_id, -v_old_adj.delta_stars, 'Hoàn tác: ' || TRIM(p_reason), v_uid, v_old_adj.id
  ) RETURNING id INTO v_new_adj_id;

  RETURN jsonb_build_object('success', true, 'status', 'REVERSED', 'message', 'Đã hoàn tác điều chỉnh thành công.');
END;
$$;

-- ============================================================================
-- 12. RPC 9: LẤY THÔNG TIN TỔNG KẾT HỌC SINH (GET_STUDENT_PERIOD_SUMMARY)
-- BẢO VỆ PHÂN QUYỀN HỌC SINH VÀ VALIDATE TARGET STUDENT MEMBERSHIP TẤT CẢ ROLE
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_student_period_summary(
  p_period_id UUID,
  p_student_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := (SELECT auth.uid());
  v_role TEXT;
  v_period RECORD;
  v_student RECORD;
  v_comment RECORD;
  v_game_stars INT := 0;
  v_game_completed INT := 0;
  v_academic_completed INT := 0;
  v_academic_assigned INT := 0;
  v_academic_avg NUMERIC(5,1) := 0.0;
  v_auto_suggestion TEXT := '';
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;

  SELECT * INTO v_period FROM public.ranking_periods WHERE id = p_period_id;
  IF v_period.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'NOT_FOUND', 'message', 'Không tìm thấy kỳ xếp hạng.');
  END IF;

  -- 1. VALIDATE TARGET STUDENT IS A STUDENT AND BELONGS TO THE CLASS OF THIS PERIOD (ALL ROLES)
  IF NOT EXISTS (
    SELECT 1 FROM public.class_members cm 
    JOIN public.profiles p ON p.id = cm.student_id 
    WHERE cm.class_id = v_period.class_id AND cm.student_id = p_student_id AND p.role = 'student'
  ) THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_STUDENT', 'message', 'Học sinh mục tiêu không thuộc lớp này.');
  END IF;

  -- 2. STUDENT ROLE SECURITY CHECK: STUDENT CAN ONLY READ THEIR OWN SUMMARY
  IF v_role = 'student' THEN
    IF p_student_id <> v_uid THEN
      RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN', 'message', 'Từ chối: Học sinh không được phép xem nhận xét tổng kết của học sinh khác.');
    END IF;
  ELSE
    -- TEACHER / ADMIN SECURITY CHECK
    IF NOT app_private.can_read_class(v_period.class_id) THEN
      RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN', 'message', 'Từ chối: Bạn không có quyền truy cập thông tin lớp này.');
    END IF;
  END IF;

  SELECT full_name, student_code, total_stars FROM public.profiles WHERE id = p_student_id INTO v_student;

  -- NẾU ĐÃ CLOSED -> ĐỌC TỪ SNAPSHOT RESULTS (SUBJECT = 'ALL')
  IF v_period.status = 'CLOSED' THEN
    SELECT 
      game_stars, game_completed_count, academic_completed_count, academic_assigned_count, academic_score_pct
    INTO v_game_stars, v_game_completed, v_academic_completed, v_academic_assigned, v_academic_avg
    FROM public.ranking_period_results
    WHERE period_id = p_period_id AND student_id = p_student_id AND subject = 'ALL';
  ELSE
    -- ĐỌC ĐỘNG GAME KHÔNG DOUBLE COUNT
    WITH progress_stats AS (
      SELECT COALESCE(SUM(stars_earned), 0) AS earned_stars, COUNT(DISTINCT id) AS completed_count
      FROM public.student_progress
      WHERE student_id = p_student_id AND completed_at >= v_period.start_at AND completed_at < v_period.end_at
    ),
    adj_stats AS (
      SELECT COALESCE(SUM(delta_stars), 0) AS adj_stars
      FROM public.ranking_period_adjustments
      WHERE period_id = p_period_id AND student_id = p_student_id
    )
    SELECT (ps.earned_stars + ads.adj_stars), ps.completed_count
    INTO v_game_stars, v_game_completed
    FROM progress_stats ps, adj_stats ads;

    -- ĐỌC ĐỘNG HỌC THUẬT KHỚP CHUẨN SEMANTICS
    WITH valid_assignments AS (
      SELECT 
        a.exercise_id,
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
    ),
    class_totals AS (
      SELECT 
        COUNT(*)::INT AS valid_count,
        COALESCE(SUM(exercise_max_score), 0)::NUMERIC AS total_max_score
      FROM valid_assignments
    ),
    valid_submissions AS (
      SELECT 
        s.student_id,
        s.exercise_id,
        LEAST(va.exercise_max_score, GREATEST(0.0, COALESCE(s.total_score, s.objective_score, 0.0)))::NUMERIC AS bounded_score,
        va.exercise_max_score
      FROM public.academic_submissions s
      JOIN valid_assignments va ON va.exercise_id = s.exercise_id
      WHERE s.student_id = p_student_id
        AND s.submitted_at >= v_period.start_at 
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
    ),
    student_best_per_exercise AS (
      SELECT 
        vs.student_id,
        vs.exercise_id,
        MAX(vs.bounded_score) AS max_earned_score
      FROM valid_submissions vs
      GROUP BY vs.student_id, vs.exercise_id
    )
    SELECT 
      ct.valid_count,
      COUNT(sbpe.exercise_id),
      CASE 
        WHEN ct.total_max_score > 0 THEN
          LEAST(100.0, ROUND((COALESCE(SUM(sbpe.max_earned_score), 0) / ct.total_max_score * 100.0)::numeric, 1))
        ELSE 0.0
      END
    INTO v_academic_assigned, v_academic_completed, v_academic_avg
    FROM class_totals ct
    LEFT JOIN student_best_per_exercise sbpe ON 1=1
    GROUP BY ct.valid_count, ct.total_max_score;
  END IF;

  SELECT * INTO v_comment FROM public.ranking_period_student_comments WHERE period_id = p_period_id AND student_id = p_student_id;

  -- GỢI Ý TỰ ĐỘNG
  v_auto_suggestion := 'Học sinh ' || COALESCE(v_student.full_name, 'Học sinh') || ' trong kỳ ' || v_period.name || ': ';
  IF v_academic_assigned > 0 THEN
    IF (v_academic_completed::numeric / v_academic_assigned::numeric) >= 0.8 THEN
      v_auto_suggestion := v_auto_suggestion || 'Hoàn thành tốt các bài tập được giao (đạt ĐTB ' || v_academic_avg || '%). ';
    ELSE
      v_auto_suggestion := v_auto_suggestion || 'Đã hoàn thành ' || v_academic_completed || '/' || v_academic_assigned || ' bài tập. Cần chú ý hoàn thành các bài còn lại. ';
    END IF;
  ELSE
    v_auto_suggestion := v_auto_suggestion || 'Duy trì tham gia học tập ổn định. ';
  END IF;

  IF v_game_stars > 20 THEN
    v_auto_suggestion := v_auto_suggestion || 'Tích cực tham gia các trò chơi học tập và đạt ' || v_game_stars || ' Sao trong kỳ.';
  ELSIF v_game_stars > 0 THEN
    v_auto_suggestion := v_auto_suggestion || 'Đã đạt ' || v_game_stars || ' Sao trong các trò chơi kỳ này.';
  ELSE
    v_auto_suggestion := v_auto_suggestion || 'Khuyến khích rèn luyện thêm thông qua Kho trò chơi.';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'period_id', p_period_id,
    'student_id', p_student_id,
    'full_name', v_student.full_name,
    'student_code', v_student.student_code,
    'total_accumulated_stars', COALESCE(v_student.total_stars, 0),
    'game_stars', COALESCE(v_game_stars, 0),
    'game_completed_count', COALESCE(v_game_completed, 0),
    'academic_average_percent', COALESCE(v_academic_avg, 0.0),
    'academic_completed_count', COALESCE(v_academic_completed, 0),
    'academic_assigned_count', COALESCE(v_academic_assigned, 0),
    'teacher_comment', v_comment.teacher_comment,
    'auto_suggestion', COALESCE(v_comment.auto_suggestion, v_auto_suggestion)
  );
END;
$$;

-- REVOKE AND GRANT
REVOKE ALL ON FUNCTION public.create_ranking_period(UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_ranking_period(UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

REVOKE ALL ON FUNCTION public.activate_ranking_period(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_ranking_period(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.close_ranking_period(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_ranking_period(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.get_game_period_leaderboard(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_game_period_leaderboard(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.get_academic_period_leaderboard(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_academic_period_leaderboard(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.save_ranking_period_student_comment(UUID, UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_ranking_period_student_comment(UUID, UUID, TEXT, TEXT, JSONB) TO authenticated;

REVOKE ALL ON FUNCTION public.add_ranking_period_adjustment(UUID, UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_ranking_period_adjustment(UUID, UUID, INTEGER, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.reverse_ranking_period_adjustment(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_ranking_period_adjustment(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.get_student_period_summary(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_period_summary(UUID, UUID) TO authenticated;

COMMIT;
