-- ============================================================================
-- MIGRATION: BẢNG XẾP HẠNG HỌC THUẬT THEO TỪNG LỚP (ACADEMIC CLASS LEADERBOARD)
-- TÁCH BIỆT HOÀN TOÀN VỚI BẢNG XẾP HẠNG TRÒ CHƠI (SAO/XU)
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

-- 1. BỔ SUNG CỜ COUNTS_TOWARD_RANKING VÀO BẢNG GIAO BÀI (DEFAULT TRUE)
ALTER TABLE public.academic_exercise_assignments 
ADD COLUMN IF NOT EXISTS counts_toward_ranking BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. CẬP NHẬT RPC GIAO BÀI TẬP BỔ SUNG THAM SỐ P_COUNTS_TOWARD_RANKING
CREATE OR REPLACE FUNCTION public.assign_exercise_to_classes(
  p_exercise_id UUID,
  p_class_ids UUID[],
  p_counts_toward_ranking BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_ex RECORD;
  v_class_id UUID;
  v_class_record RECORD;
  v_first_assigned_class_id UUID := NULL;
  v_assigned_names TEXT[] := ARRAY[]::TEXT[];
  v_failed_names TEXT[] := ARRAY[]::TEXT[];
  v_unique_class_ids UUID[];
  v_ranking_flag BOOLEAN := COALESCE(p_counts_toward_ranking, TRUE);
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'teacher') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bạn không có quyền giao bài tập.');
  END IF;

  SELECT * INTO v_ex FROM public.academic_exercises WHERE id = p_exercise_id;
  IF v_ex.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bài tập không tồn tại.');
  END IF;

  IF v_caller_role <> 'admin' AND v_ex.teacher_id IS DISTINCT FROM v_caller_id THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bạn không có quyền quản lý bài tập này.');
  END IF;

  IF p_class_ids IS NULL OR array_length(p_class_ids, 1) = 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Vui lòng chọn ít nhất 1 Lớp học để giao bài.');
  END IF;

  SELECT ARRAY(SELECT DISTINCT unnest(p_class_ids)) INTO v_unique_class_ids;

  FOREACH v_class_id IN ARRAY v_unique_class_ids
  LOOP
    SELECT * INTO v_class_record FROM public.classes WHERE id = v_class_id;
    IF v_class_record.id IS NULL THEN
      v_failed_names := array_append(v_failed_names, 'ID: ' || v_class_id::text || ' (Không tồn tại)');
      CONTINUE;
    END IF;

    IF v_caller_role <> 'admin' AND v_class_record.teacher_id IS DISTINCT FROM v_caller_id THEN
      v_failed_names := array_append(v_failed_names, v_class_record.name);
      CONTINUE;
    END IF;

    INSERT INTO public.academic_exercise_assignments (
      exercise_id, class_id, assigned_by, assigned_at, due_date, counts_toward_ranking
    ) VALUES (
      p_exercise_id, v_class_id, v_caller_id, NOW(), v_ex.due_date, v_ranking_flag
    )
    ON CONFLICT (exercise_id, class_id) DO UPDATE SET
      assigned_by = EXCLUDED.assigned_by,
      assigned_at = NOW(),
      due_date = EXCLUDED.due_date,
      counts_toward_ranking = EXCLUDED.counts_toward_ranking;

    IF v_first_assigned_class_id IS NULL THEN
      v_first_assigned_class_id := v_class_id;
    END IF;

    v_assigned_names := array_append(v_assigned_names, v_class_record.name);
  END LOOP;

  IF array_length(v_assigned_names, 1) > 0 THEN
    UPDATE public.academic_exercises
    SET status = 'published',
        class_id = COALESCE(class_id, v_first_assigned_class_id),
        updated_at = NOW()
    WHERE id = p_exercise_id;

    RETURN jsonb_build_object(
      'success', true,
      'assigned_classes', to_jsonb(v_assigned_names),
      'failed_classes', to_jsonb(v_failed_names),
      'message', 'Đã xuất bản và giao bài tập thành công.'
    );
  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'failed_classes', to_jsonb(v_failed_names),
      'message', 'Không thể giao bài tập. Bạn không có quyền giao bài hoặc các lớp chọn không hợp lệ.'
    );
  END IF;
END;
$$;

-- SIẾT BẢO MẬT RPC GIAO BÀI
REVOKE ALL ON FUNCTION public.assign_exercise_to_classes(UUID, UUID[], BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_exercise_to_classes(UUID, UUID[], BOOLEAN) TO authenticated;

-- 3. RPC SECURITY DEFINER: TÍNH BẢNG XẾP HẠNG HỌC THUẬT THEO LỚP CHUẨN XÁC
CREATE OR REPLACE FUNCTION public.get_academic_class_leaderboard(
  p_class_id UUID,
  p_time_range TEXT DEFAULT 'ALL',
  p_subject TEXT DEFAULT 'ALL'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_class_record RECORD;
  v_total_valid_exercises INT := 0;
  v_total_class_max_score NUMERIC := 0;
  v_leaderboard_json JSONB;
BEGIN
  -- 1. Đăng nhập check
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  IF v_caller_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Không tìm thấy hồ sơ người dùng.');
  END IF;

  -- 2. Kiểm tra lớp tồn tại
  SELECT * INTO v_class_record FROM public.classes WHERE id = p_class_id;
  IF v_class_record.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lớp học không tồn tại.');
  END IF;

  -- 3. Kiểm tra phân quyền truy cập lớp học
  IF v_caller_role = 'student' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.class_members 
      WHERE class_id = p_class_id AND student_id = v_caller_id
    ) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Bạn chỉ có quyền xem Bảng xếp hạng của lớp mình đang tham gia.');
    END IF;
  ELSIF v_caller_role = 'teacher' THEN
    IF v_class_record.teacher_id IS DISTINCT FROM v_caller_id THEN
      RETURN jsonb_build_object('success', false, 'message', 'Bạn chỉ có quyền xem Bảng xếp hạng của lớp do mình phụ trách.');
    END IF;
  END IF;

  -- 4. Tính toán danh sách các bài tập hợp lệ được giao cho lớp
  WITH valid_assignments AS (
    SELECT 
      a.exercise_id,
      e.title,
      e.subject,
      a.assigned_at,
      -- Điểm tối đa bài tập: lấy từ tổng điểm các câu hỏi hoặc max_score của submissions
      COALESCE(
        (SELECT SUM(points) FROM public.academic_exercise_questions q WHERE q.exercise_id = e.id),
        (SELECT MAX(max_score) FROM public.academic_submissions s WHERE s.exercise_id = e.id),
        10
      ) AS exercise_max_score
    FROM public.academic_exercise_assignments a
    JOIN public.academic_exercises e ON e.id = a.exercise_id
    WHERE a.class_id = p_class_id
      AND a.counts_toward_ranking IS TRUE
      AND e.status = 'published'
      AND (
        p_subject = 'ALL' 
        OR LOWER(e.subject) = LOWER(p_subject)
      )
      AND (
        p_time_range = 'ALL'
        OR (p_time_range = 'MONTH' AND a.assigned_at >= date_trunc('month', NOW()))
        OR (p_time_range = 'SEMESTER' AND a.assigned_at >= (NOW() - INTERVAL '5 months'))
      )
  ),
  -- Tổng điểm tối đa toàn bộ bài giao cho lớp
  class_totals AS (
    SELECT 
      COUNT(*)::INT AS valid_count,
      COALESCE(SUM(exercise_max_score), 0)::NUMERIC AS total_max_score
    FROM valid_assignments
  ),
  -- Học sinh trong lớp
  students_in_class AS (
    SELECT 
      cm.student_id,
      p.full_name,
      p.avatar_url
    FROM public.class_members cm
    JOIN public.profiles p ON p.id = cm.student_id
    WHERE cm.class_id = p_class_id
  ),
  -- Điểm tốt nhất của từng học sinh ở các bài hợp lệ (chỉ lấy điểm cao nhất MAX(total_score) mỗi bài)
  student_best_scores AS (
    SELECT 
      s.student_id,
      s.exercise_id,
      MAX(COALESCE(s.total_score, s.objective_score, 0)) AS max_earned_score
    FROM public.academic_submissions s
    JOIN valid_assignments va ON va.exercise_id = s.exercise_id
    WHERE s.status IN ('graded', 'submitted')
    GROUP BY s.student_id, s.exercise_id
  ),
  -- Thống kê tổng hợp từng học sinh
  student_stats AS (
    SELECT 
      sc.student_id,
      sc.full_name,
      sc.avatar_url,
      COALESCE(SUM(sbs.max_earned_score), 0)::NUMERIC AS total_earned_score,
      COUNT(sbs.exercise_id)::INT AS completed_count,
      ct.valid_count AS total_valid_count,
      ct.total_max_score AS class_max_score,
      -- Điểm xếp hạng học thuật (%) = (Tổng điểm đạt được / Tổng điểm tối đa bài giao cho lớp) * 100
      CASE 
        WHEN ct.total_max_score > 0 THEN
          LEAST(100.0, ROUND((COALESCE(SUM(sbs.max_earned_score), 0) / ct.total_max_score * 100.0)::numeric, 1))
        ELSE 0
      END AS academic_score_pct,
      -- Tỷ lệ hoàn thành (%)
      CASE 
        WHEN ct.valid_count > 0 THEN
          LEAST(100.0, ROUND((COUNT(sbs.exercise_id)::numeric / ct.valid_count::numeric * 100.0)::numeric, 1))
        ELSE 0
      END AS completion_rate_pct,
      -- Điểm trung bình các bài đã làm
      CASE 
        WHEN COUNT(sbs.exercise_id) > 0 THEN
          ROUND((SUM(sbs.max_earned_score) / COUNT(sbs.exercise_id)::numeric)::numeric, 1)
        ELSE 0
      END AS avg_score
    FROM students_in_class sc
    CROSS JOIN class_totals ct
    LEFT JOIN student_best_scores sbs ON sbs.student_id = sc.student_id
    GROUP BY sc.student_id, sc.full_name, sc.avatar_url, ct.valid_count, ct.total_max_score
  ),
  -- Xếp hạng theo tiêu chí chính và tiêu chí phụ
  ranked_students AS (
    SELECT 
      ss.*,
      DENSE_RANK() OVER (
        ORDER BY 
          ss.academic_score_pct DESC,
          ss.completion_rate_pct DESC,
          ss.completed_count DESC,
          ss.avg_score DESC
      ) AS rank_pos,
      COUNT(*) OVER (
        PARTITION BY 
          ss.academic_score_pct,
          ss.completion_rate_pct,
          ss.completed_count,
          ss.avg_score
      ) AS tie_count
    FROM student_stats ss
  )
  SELECT 
    jsonb_build_object(
      'success', true,
      'class_info', jsonb_build_object(
        'class_id', v_class_record.id,
        'class_name', v_class_record.name,
        'grade_level', v_class_record.grade_level
      ),
      'total_valid_exercises', (SELECT valid_count FROM class_totals),
      'total_class_max_score', (SELECT total_max_score FROM class_totals),
      'leaderboard', COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'rank', r.rank_pos,
            'is_tied', (r.tie_count > 1),
            'student_id', r.student_id,
            'full_name', r.full_name,
            'avatar_url', r.avatar_url,
            'academic_score_pct', r.academic_score_pct,
            'total_earned_score', r.total_earned_score,
            'completed_count', r.completed_count,
            'total_valid_count', r.total_valid_count,
            'completion_rate_pct', r.completion_rate_pct,
            'avg_score', r.avg_score
          )
          ORDER BY r.rank_pos ASC, r.full_name ASC
        ),
        '[]'::jsonb
      )
    ) INTO v_leaderboard_json
  FROM ranked_students r;

  RETURN v_leaderboard_json;
END;
$$;

-- SIẾT BẢO MẬT RPC LẤY BẢNG XẾP HẠNG HỌC THUẬT
REVOKE ALL ON FUNCTION public.get_academic_class_leaderboard(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_academic_class_leaderboard(UUID, TEXT, TEXT) TO authenticated;

COMMIT;

-- 4. NẠP LẠI SCHEMA CACHE TRÊN SUPABASE POSTGREST
NOTIFY pgrst, 'reload schema';
