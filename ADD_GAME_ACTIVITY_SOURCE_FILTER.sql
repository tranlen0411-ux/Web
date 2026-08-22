-- ============================================================================
-- MIGRATION: ADD_GAME_ACTIVITY_SOURCE_FILTER.sql
-- MỤC TIÊU: BỔ SUNG THAM SỐ P_SOURCE ('ALL', 'LIBRARY', 'ASSIGNED') VÀO CÁC RPC BẢNG XẾP HẠNG TRÒ CHƠI
-- ĐẶC ĐIỂM: BACKWARD-COMPATIBLE (DEFAULT 'ALL'), BẢO VỆ SNAPSHOT CLOSED PERIOD, KHÔNG THAY ĐỔI SCHEMA
-- ============================================================================

BEGIN;

-- 1. CẬP NHẬT RPC public.get_game_leaderboard
DROP FUNCTION IF EXISTS public.get_game_leaderboard(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.get_game_leaderboard(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.get_game_leaderboard(
  p_grade_filter TEXT DEFAULT 'ALL',
  p_class_id TEXT DEFAULT 'ALL_IN_GRADE',
  p_source TEXT DEFAULT 'ALL'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_caller_class_id UUID;
  v_caller_grade INT;
  v_requested_grade_int INT := NULL;
  v_requested_class_uuid UUID := NULL;
  v_target_class_record RECORD;
  v_normalized_source TEXT := 'ALL';
  v_result_json JSONB;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'teacher', 'student') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bạn không có quyền xem Bảng xếp hạng Trò chơi.');
  END IF;

  -- Chuẩn hóa tham số nguồn hoạt động (Mở rộng cho LIBRARY, ASSIGNED, EVENT, CHALLENGE sau này)
  IF p_source IS NOT NULL AND p_source IN ('ALL', 'LIBRARY', 'ASSIGNED') THEN
    v_normalized_source := p_source;
  ELSE
    v_normalized_source := 'ALL';
  END IF;

  IF p_grade_filter <> 'ALL' THEN
    BEGIN
      v_requested_grade_int := p_grade_filter::INT;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'message', 'Tham số Khối lớp không hợp lệ.');
    END;
  END IF;

  IF p_grade_filter = 'ALL' AND v_caller_role <> 'admin' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chỉ Quản trị viên mới được phép xem Bảng xếp hạng Toàn trường.');
  END IF;

  IF p_class_id <> 'ALL_IN_GRADE' THEN
    BEGIN
      v_requested_class_uuid := p_class_id::UUID;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'message', 'Tham số Lớp học không hợp lệ.');
    END;

    SELECT * INTO v_target_class_record FROM public.classes WHERE id = v_requested_class_uuid;
    IF v_target_class_record.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lớp học không tồn tại.');
    END IF;

    IF v_requested_grade_int IS NOT NULL AND v_target_class_record.grade_level <> v_requested_grade_int THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lớp được chọn không thuộc Khối đã lọc.');
    END IF;

    v_requested_grade_int := v_target_class_record.grade_level;
  END IF;

  IF v_caller_role = 'student' THEN
    SELECT cm.class_id, c.grade_level INTO v_caller_class_id, v_caller_grade
    FROM public.class_members cm
    JOIN public.classes c ON c.id = cm.class_id
    WHERE cm.student_id = v_caller_id
    ORDER BY cm.joined_at DESC
    LIMIT 1;

    IF v_caller_class_id IS NULL OR v_caller_grade IS NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Tài khoản học sinh chưa được phân lớp.');
    END IF;

    v_requested_grade_int := v_caller_grade;

    IF v_requested_class_uuid IS NOT NULL AND v_requested_class_uuid <> v_caller_class_id THEN
      RETURN jsonb_build_object('success', false, 'message', 'Học sinh chỉ được xem Bảng xếp hạng của lớp mình.');
    END IF;

  ELSIF v_caller_role = 'teacher' THEN
    IF v_requested_class_uuid IS NOT NULL THEN
      IF v_target_class_record.teacher_id IS DISTINCT FROM v_caller_id THEN
        RETURN jsonb_build_object('success', false, 'message', 'Giáo viên chỉ có quyền xem lớp do mình phụ trách.');
      END IF;
    ELSE
      IF NOT EXISTS (
        SELECT 1 FROM public.classes c
        WHERE c.teacher_id = v_caller_id AND c.grade_level = v_requested_grade_int
      ) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Giáo viên chỉ có quyền xem Khối có lớp do mình phụ trách.');
      END IF;
    END IF;
  END IF;

  WITH current_student_classes AS (
    SELECT DISTINCT ON (cm.student_id)
      cm.student_id,
      c.id AS class_id,
      c.name AS class_name,
      c.grade_level AS class_grade
    FROM public.class_members cm
    JOIN public.classes c ON c.id = cm.class_id
    ORDER BY cm.student_id, cm.joined_at DESC
  ),
  valid_game_students AS (
    SELECT
      p.id AS student_id,
      p.full_name,
      p.avatar_url,
      -- ÁP DỤNG LỌC NGUỒN HOẠT ĐỘNG VÀ BASELINE ĐỒNG NHẤT
      CASE
        WHEN EXISTS (
          SELECT 1 FROM public.student_score_baselines b
          WHERE b.student_id = p.id
            AND b.class_id = csc.class_id
            AND b.revoked_at IS NULL
            AND b.scope IN ('game', 'both')
        ) THEN (
          SELECT COALESCE(SUM(sp.stars_earned), 0)
          FROM public.student_progress sp
          WHERE sp.student_id = p.id
            AND (
              v_normalized_source = 'ALL'
              OR (v_normalized_source = 'LIBRARY' AND sp.assignment_id IS NULL)
              OR (v_normalized_source = 'ASSIGNED' AND sp.assignment_id IS NOT NULL)
            )
            AND NOT EXISTS (
              SELECT 1 FROM public.student_score_baselines b
              WHERE b.student_id = p.id
                AND b.class_id = csc.class_id
                AND b.revoked_at IS NULL
                AND b.scope IN ('game', 'both')
                AND (
                  (b.effective_until IS NULL AND sp.completed_at < b.effective_from)
                  OR (b.effective_until IS NOT NULL AND sp.completed_at >= b.effective_from AND sp.completed_at < b.effective_until)
                )
            )
        )
        WHEN v_normalized_source <> 'ALL' THEN (
          SELECT COALESCE(SUM(sp.stars_earned), 0)
          FROM public.student_progress sp
          WHERE sp.student_id = p.id
            AND (
              (v_normalized_source = 'LIBRARY' AND sp.assignment_id IS NULL)
              OR (v_normalized_source = 'ASSIGNED' AND sp.assignment_id IS NOT NULL)
            )
        )
        ELSE COALESCE(p.total_stars, 0)
      END AS total_stars,
      -- TÍNH TOÁN COINS TƯƠNG ỨNG
      CASE
        WHEN EXISTS (
          SELECT 1 FROM public.student_score_baselines b
          WHERE b.student_id = p.id
            AND b.class_id = csc.class_id
            AND b.revoked_at IS NULL
            AND b.scope IN ('game', 'both')
        ) THEN 0
        WHEN v_normalized_source <> 'ALL' THEN 0
        ELSE COALESCE(p.total_coins, 0)
      END AS total_coins,
      csc.class_grade AS grade_level,
      csc.class_name
    FROM public.profiles p
    JOIN current_student_classes csc ON csc.student_id = p.id
    WHERE p.role = 'student'
      AND (
        v_requested_class_uuid IS NOT NULL AND csc.class_id = v_requested_class_uuid
        OR (
          v_requested_class_uuid IS NULL AND (
            v_requested_grade_int IS NULL
            OR csc.class_grade = v_requested_grade_int
          )
        )
      )
  ),
  ranked_game_students AS (
    SELECT
      vgs.*,
      DENSE_RANK() OVER (
        ORDER BY vgs.total_stars DESC, vgs.total_coins DESC
      ) AS rank_pos,
      COUNT(*) OVER (
        PARTITION BY vgs.total_stars, vgs.total_coins
      ) AS tie_count
    FROM valid_game_students vgs
  )
  SELECT jsonb_build_object(
    'success', true,
    'grade_filter', COALESCE(v_requested_grade_int::text, 'ALL'),
    'class_filter', COALESCE(v_requested_class_uuid::text, 'ALL_IN_GRADE'),
    'source_filter', v_normalized_source,
    'leaderboard', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'rank', r.rank_pos,
          'is_tied', (r.tie_count > 1),
          'student_id', r.student_id,
          'full_name', r.full_name,
          'avatar_url', r.avatar_url,
          'total_stars', r.total_stars,
          'total_coins', r.total_coins,
          'grade_level', r.grade_level,
          'class_name', r.class_name
        )
        ORDER BY r.rank_pos ASC, r.full_name ASC, r.student_id ASC
      ),
      '[]'::jsonb
    )
  ) INTO v_result_json
  FROM (
    SELECT * FROM ranked_game_students
    ORDER BY rank_pos ASC, full_name ASC, student_id ASC
    LIMIT 50
  ) r;

  RETURN v_result_json;
END;
$$;

REVOKE ALL ON FUNCTION public.get_game_leaderboard(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_game_leaderboard(TEXT, TEXT, TEXT) TO authenticated;


-- 2. CẬP NHẬT RPC public.get_game_period_leaderboard
DROP FUNCTION IF EXISTS public.get_game_period_leaderboard(UUID);
DROP FUNCTION IF EXISTS public.get_game_period_leaderboard(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.get_game_period_leaderboard(
  p_period_id UUID,
  p_source TEXT DEFAULT 'ALL'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_period RECORD;
  v_normalized_source TEXT := 'ALL';
  v_res JSONB;
BEGIN
  SELECT * INTO v_period FROM public.ranking_periods WHERE id = p_period_id;
  IF v_period.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'NOT_FOUND', 'message', 'Không tìm thấy kỳ xếp hạng.');
  END IF;

  IF NOT app_private.can_read_class(v_period.class_id) THEN
    RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN', 'message', 'Từ chối: Bạn không thuộc lớp này.');
  END IF;

  -- Chuẩn hóa tham số nguồn hoạt động
  IF p_source IS NOT NULL AND p_source IN ('ALL', 'LIBRARY', 'ASSIGNED') THEN
    v_normalized_source := p_source;
  ELSE
    v_normalized_source := 'ALL';
  END IF;

  -- NẾU KỲ ĐÃ CLOSED -> ĐỌC TỪ SNAPSHOT RESULTS (BẤT BIẾN - BẢO TOÀN LỊCH SỬ KỲ ĐÃ CHỐT)
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

  -- NẾU KỲ DRAFT / ACTIVE -> TÍNH ĐỘNG CÓ ÁP DỤNG LỌC NGUỒN VÀ BASELINE
  WITH valid_progress AS (
    SELECT
      sp.student_id,
      sp.stars_earned,
      sp.id
    FROM public.student_progress sp
    WHERE sp.completed_at >= v_period.start_at
      AND sp.completed_at < v_period.end_at
      AND (
        v_normalized_source = 'ALL'
        OR (v_normalized_source = 'LIBRARY' AND sp.assignment_id IS NULL)
        OR (v_normalized_source = 'ASSIGNED' AND sp.assignment_id IS NOT NULL)
      )
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
  ),
  progress_stats AS (
    SELECT
      vp.student_id,
      COALESCE(SUM(vp.stars_earned), 0) AS earned_stars,
      COUNT(DISTINCT vp.id) AS completed_count
    FROM valid_progress vp
    GROUP BY vp.student_id
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

REVOKE ALL ON FUNCTION public.get_game_period_leaderboard(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_game_period_leaderboard(UUID, TEXT) TO authenticated;

COMMIT;
