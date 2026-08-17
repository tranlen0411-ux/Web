-- ============================================================================
-- MIGRATION: BẢNG XẾP HẠNG HỌC THUẬT THEO LỚP & BẢNG XẾP HẠNG TRÒ CHƠI BẢO MẬT
-- KHẮC PHỤC TRIỆT ĐỂ OVERLOAD RPC, THỦ THUẬT DỮ LIỆU VÀ PHÂN QUYỀN TRÊN CS-DL
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

-- 1. BỔ SUNG CỜ COUNTS_TOWARD_RANKING VÀO BẢNG GIAO BÀI (DEFAULT TRUE)
ALTER TABLE public.academic_exercise_assignments 
ADD COLUMN IF NOT EXISTS counts_toward_ranking BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. DROP HÀM CŨ 2 THAM SỐ ĐỂ TRÁNH LỖI OVERLOAD MO HƠ (PGRST203)
DROP FUNCTION IF EXISTS public.assign_exercise_to_classes(UUID, UUID[]);
DROP FUNCTION IF EXISTS public.assign_exercise_to_classes(UUID, UUID[], BOOLEAN);

-- 3. CẬP NHẬT RPC GIAO BÀI TẬP 3 THAM SỐ (KHÔNG DÙNG DEFAULT ĐỂ TRÁNH TRÙNG LẶP)
CREATE OR REPLACE FUNCTION public.assign_exercise_to_classes(
  p_exercise_id UUID,
  p_class_ids UUID[],
  p_counts_toward_ranking BOOLEAN
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

-- 4. RPC SECURITY DEFINER: BẢNG XẾP HẠNG HỌC THUẬT THEO LỚP (SIẾT KIỂM THỬ SUBMISSION CHƯA CHẤM & NÂNG CẤP ĐTB %)
DROP FUNCTION IF EXISTS public.get_academic_class_leaderboard(UUID, TEXT, TEXT);

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
  v_leaderboard_json JSONB;
BEGIN
  -- 1. Đăng nhập & Check Role nghiêm ngặt
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'teacher', 'student') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bạn không có quyền truy cập Bảng xếp hạng Học thuật.');
  END IF;

  -- 2. Kiểm tra lớp tồn tại
  SELECT * INTO v_class_record FROM public.classes WHERE id = p_class_id;
  IF v_class_record.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lớp học không tồn tại.');
  END IF;

  -- 3. Phân quyền kiểm tra lớp
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

  -- 4. Danh sách bài giao hợp lệ cho lớp
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
      p.avatar_url
    FROM public.class_members cm
    JOIN public.profiles p ON p.id = cm.student_id
    WHERE cm.class_id = p_class_id AND p.role = 'student'
  ),
  -- CHỈ TÍNH BÀI ĐÃ CHẤM (GRADED) HOẶC BÀI TỰ ĐỘNG CHẤM HOÀN TẤT (SUBMITTED KHÔNG CÓ TỰ LUẬN)
  valid_submissions AS (
    SELECT 
      s.student_id,
      s.exercise_id,
      s.total_score,
      s.objective_score,
      va.exercise_max_score,
      -- Giới hạn điểm earned trong [0, exercise_max_score]
      LEAST(va.exercise_max_score, GREATEST(0.0, COALESCE(s.total_score, s.objective_score, 0.0)))::NUMERIC AS bounded_score
    FROM public.academic_submissions s
    JOIN valid_assignments va ON va.exercise_id = s.exercise_id
    WHERE (
      s.status = 'graded'
      OR (
        s.status = 'submitted' 
        AND s.objective_score IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.academic_exercise_questions q 
          WHERE q.exercise_id = s.exercise_id AND q.question_type = 'essay'
        )
      )
    )
  ),
  -- Lấy kết quả tốt nhất của mỗi học sinh cho từng bài
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
  -- Thống kê tổng hợp điểm và Điểm Trung Bình (%) từng bài
  student_stats AS (
    SELECT 
      sc.student_id,
      sc.full_name,
      sc.avatar_url,
      COALESCE(SUM(sbpe.max_earned_score), 0)::NUMERIC AS total_earned_score,
      COUNT(sbpe.exercise_id)::INT AS completed_count,
      ct.valid_count AS total_valid_count,
      ct.total_max_score AS class_max_score,
      CASE 
        WHEN ct.total_max_score > 0 THEN
          LEAST(100.0, ROUND((COALESCE(SUM(sbpe.max_earned_score), 0) / ct.total_max_score * 100.0)::numeric, 1))
        ELSE 0
      END AS academic_score_pct,
      CASE 
        WHEN ct.valid_count > 0 THEN
          LEAST(100.0, ROUND((COUNT(sbpe.exercise_id)::numeric / ct.valid_count::numeric * 100.0)::numeric, 1))
        ELSE 0
      END AS completion_rate_pct,
      -- Điểm trung bình tính theo trung bình CÁC PHẦN TRĂM % CỦA TỪNG BÀI ĐÃ LÀM (TIÊU CHÍ PHỤ)
      CASE 
        WHEN COUNT(sbpe.exercise_id) > 0 THEN
          ROUND(AVG(sbpe.single_ex_pct)::numeric, 1)
        ELSE 0
      END AS avg_score_pct
    FROM students_in_class sc
    CROSS JOIN class_totals ct
    LEFT JOIN student_best_scores_per_ex: student_best_per_exercise sbpe ON sbpe.student_id = sc.student_id
    GROUP BY sc.student_id, sc.full_name, sc.avatar_url, ct.valid_count, ct.total_max_score
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
            'avg_score', r.avg_score_pct
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

REVOKE ALL ON FUNCTION public.get_academic_class_leaderboard(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_academic_class_leaderboard(UUID, TEXT, TEXT) TO authenticated;

-- 5. RPC SECURITY DEFINER: LẤY BẢNG XẾP HẠNG TRÒ CHƠI CÓ KIỂM TRA PHÂN QUYỀN CHẶT CHẼ TRÊN POSTGRES
DROP FUNCTION IF EXISTS public.get_game_leaderboard(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.get_game_leaderboard(
  p_grade_filter TEXT DEFAULT 'ALL',
  p_class_id TEXT DEFAULT 'ALL_IN_GRADE'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_caller_grade INT;
  v_caller_class_id UUID;
  v_target_grade TEXT := p_grade_filter;
  v_target_class TEXT := p_class_id;
  v_result_json JSONB;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role, grade_level INTO v_caller_role, v_caller_grade FROM public.profiles WHERE id = v_caller_id;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'teacher', 'student') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bạn không có quyền xem Bảng xếp hạng Trò chơi.');
  END IF;

  -- Lấy class_id chính thức của caller từ class_members nếu có
  SELECT cm.class_id INTO v_caller_class_id 
  FROM public.class_members cm 
  WHERE cm.student_id = v_caller_id 
  LIMIT 1;

  -- XỬ LÝ PHÂN QUYỀN HỌC SINH: ÉP XEM DỮ LIỆU ĐÚNG QUYỀN
  IF v_caller_role = 'student' THEN
    -- Học sinh không được xem Toàn trường, ép về khối của học sinh
    IF v_caller_grade IS NOT NULL THEN
      v_target_grade := v_caller_grade::text;
    END IF;

    -- Học sinh chỉ được xem ALL_IN_GRADE hoặc Lớp của chính mình (v_caller_class_id)
    IF v_target_class <> 'ALL_IN_GRADE' AND (v_caller_class_id IS NULL OR v_target_class <> v_caller_class_id::text) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Học sinh chỉ được xem xếp hạng toàn khối hoặc lớp của mình.');
    END IF;

  -- XỬ LÝ PHÂN QUYỀN GIÁO VIÊN: KIỂM TRA LỚP PHỤ TRÁCH
  ELSIF v_caller_role = 'teacher' THEN
    IF v_target_class <> 'ALL_IN_GRADE' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.classes c 
        WHERE c.id::text = v_target_class AND c.teacher_id = v_caller_id
      ) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Giáo viên chỉ có quyền xem lớp do mình phụ trách.');
      END IF;
    END IF;
  END IF;

  -- QUERY LẤY DANH SÁCH HỌC SINH VÀ LỚP HỌC (LOẠI BỎ TRÙNG LẶP DO MULTIPLE CLASS_MEMBERS)
  WITH unique_student_classes AS (
    SELECT DISTINCT ON (cm.student_id)
      cm.student_id,
      c.id AS class_id,
      c.name AS class_name,
      c.grade_level AS class_grade
    FROM public.class_members cm
    JOIN public.classes c ON c.id = cm.class_id
    ORDER BY cm.student_id, cm.joined_at DESC
  ),
  filtered_students AS (
    SELECT 
      p.id AS student_id,
      p.full_name,
      p.avatar_url,
      COALESCE(p.total_stars, 0) AS total_stars,
      COALESCE(p.total_coins, 0) AS total_coins,
      COALESCE(usc.class_grade, p.grade_level, 1) AS grade_level,
      usc.class_name
    FROM public.profiles p
    LEFT JOIN unique_student_classes usc ON usc.student_id = p.id
    WHERE p.role = 'student'
      AND (
        v_target_class <> 'ALL_IN_GRADE' AND usc.class_id::text = v_target_class
        OR (
          v_target_class = 'ALL_IN_GRADE' AND (
            v_target_grade = 'ALL'
            OR COALESCE(usc.class_grade, p.grade_level) = v_target_grade::int
          )
        )
      )
    ORDER BY COALESCE(p.total_stars, 0) DESC, COALESCE(p.total_coins, 0) DESC
    LIMIT 50
  )
  SELECT jsonb_build_object(
    'success', true,
    'grade_filter', v_target_grade,
    'class_filter', v_target_class,
    'leaderboard', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'student_id', fs.student_id,
          'full_name', fs.full_name,
          'avatar_url', fs.avatar_url,
          'total_stars', fs.total_stars,
          'total_coins', fs.total_coins,
          'grade_level', fs.grade_level,
          'class_name', fs.class_name
        )
      ),
      '[]'::jsonb
    )
  ) INTO v_result_json
  FROM filtered_students fs;

  RETURN v_result_json;
END;
$$;

-- SIẾT BẢO MẬT RPC LẤY BẢNG XẾP HẠNG TRÒ CHƠI
REVOKE ALL ON FUNCTION public.get_game_leaderboard(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_game_leaderboard(TEXT, TEXT) TO authenticated;

COMMIT;

-- 6. NẠP LẠI SCHEMA CACHE TRÊN SUPABASE POSTGREST
NOTIFY pgrst, 'reload schema';
