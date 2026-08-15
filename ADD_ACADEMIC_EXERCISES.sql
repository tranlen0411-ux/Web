-- ============================================================================
-- MIGRATION CSDL HỆ THỐNG BÀI TẬP HỌC THUẬT (ACADEMIC EXERCISES) - PHIÊN BẢN 5.0 HOÀN HẢO
-- 1. ADVISORY TRANSACTION LOCK CHỐNG RACE CONDITION NỘP BÀI ĐỒNG THỜI
-- 2. ALTER TABLE CHUYỂN CỘT CLASS_NAME SANG CLASS_ID UUID VỚI LOGIC ÁNH XẠ ĐA ĐIỀU KIỆN
-- 3. DROP CỘT CLASS_NAME SAU KHI ÁNH XẠ THÀNH CÔNG VÀ NÂNG CONSTRAINT CHUẨN
-- 4. BẢO VỆ NGUYÊN TỬ VÀ KHÓA GHI TRỰC TIẾP CÂU HỎI PUBLIC.ACADEMIC_EXERCISE_QUESTIONS
-- 5. REWARD_APPLIED_AT BẤT BIẾN KHÔNG CỘNG LẶP SAO VÀ KIỂM TRA ĐIỀU KIỆN XEM ĐÁP ÁN NGHIÊM NGẶT
-- ============================================================================

BEGIN;

-- 1. SCHEMA PRIVACY APP_PRIVATE
CREATE SCHEMA IF NOT EXISTS app_private;

-- 2. BẢNG PUBLIC.ACADEMIC_EXERCISES
CREATE TABLE IF NOT EXISTS public.academic_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  grade_level INT NOT NULL DEFAULT 1 CHECK (grade_level BETWEEN 1 AND 5),
  subject TEXT NOT NULL DEFAULT 'Toán',
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT,
  exercise_type TEXT NOT NULL DEFAULT 'mixed' CHECK (exercise_type IN ('single_choice', 'multiple_choice', 'fill_blank', 'short_answer', 'essay', 'image_upload', 'file_upload', 'mixed')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed', 'archived')),
  due_date TIMESTAMPTZ,
  max_attempts INT DEFAULT 1 CHECK (max_attempts >= 1),
  reward_stars INT DEFAULT 10 CHECK (reward_stars >= 0),
  show_score_after_submit BOOLEAN DEFAULT TRUE,
  show_correct_answers BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- MIGRATION NÂNG CẤP CỘT CLASS_ID THAM CHIẾU PUBLIC.CLASSES(ID)
ALTER TABLE public.academic_exercises ADD COLUMN IF NOT EXISTS class_id UUID REFERENCES public.classes(id) ON DELETE CASCADE;
ALTER TABLE public.academic_exercises ADD COLUMN IF NOT EXISTS is_global BOOLEAN DEFAULT FALSE;

-- BLOCK MIGRATION DỮ LIỆU CLASS_NAME NÂNG CAO ĐỐI CHIẾU THÊM GRADE_LEVEL VÀ TEACHER_ID
DO $$
DECLARE
  v_unmapped_count INT := 0;
  v_ambiguous_count INT := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'academic_exercises' AND column_name = 'class_name'
  ) THEN
    
    -- 1. Ánh xạ dữ liệu class_name sang class_id dựa trên cả name, grade_level và teacher_id
    UPDATE public.academic_exercises e
    SET class_id = c.id
    FROM public.classes c
    WHERE e.class_id IS NULL 
      AND e.class_name = c.name 
      AND (e.grade_level = c.grade_level OR e.grade_level IS NULL)
      AND (e.teacher_id = c.teacher_id OR e.teacher_id IS NULL);

    -- 2. Kiểm tra các bản ghi chưa ánh xạ được mà không phải is_global
    SELECT COUNT(*) INTO v_unmapped_count 
    FROM public.academic_exercises 
    WHERE class_id IS NULL AND is_global IS NOT TRUE AND class_name IS NOT NULL;

    -- 3. Kiểm tra xem có class_name nào khớp với nhiều hơn 1 lớp không
    SELECT COUNT(*) INTO v_ambiguous_count
    FROM (
      SELECT e.id
      FROM public.academic_exercises e
      JOIN public.classes c ON e.class_name = c.name
      WHERE e.class_id IS NULL AND e.is_global IS NOT TRUE
      GROUP BY e.id
      HAVING COUNT(c.id) > 1
    ) amb;

    IF v_ambiguous_count > 0 THEN
      RAISE EXCEPTION 'MIGRATION THẤT BẠI: Có % bản ghi bài tập có class_name khớp với nhiều hơn 1 lớp học mơ hồ. Vui lòng xử lý thủ công trước khi chuyển đổi!', v_ambiguous_count;
    END IF;

    IF v_unmapped_count = 0 THEN
      -- Khi 100% dữ liệu hợp lệ mới drop cột class_name
      ALTER TABLE public.academic_exercises DROP COLUMN IF EXISTS class_name;
    ELSE
      ALTER TABLE public.academic_exercises ALTER COLUMN class_name DROP NOT NULL;
    END IF;
  END IF;
END $$;

-- CONSTRAINT BẢO ĐẢM VỀ CLASS_ID VÀ IS_GLOBAL
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public' AND t.relname = 'academic_exercises' AND c.conname = 'check_academic_exercises_class_global'
  ) THEN
    ALTER TABLE public.academic_exercises
    ADD CONSTRAINT check_academic_exercises_class_global
    CHECK ( (is_global IS TRUE) OR (class_id IS NOT NULL) );
  END IF;
END $$;

-- 3. BẢNG CÂU HỎI PUBLIC.ACADEMIC_EXERCISE_QUESTIONS
CREATE TABLE IF NOT EXISTS public.academic_exercise_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id UUID NOT NULL REFERENCES public.academic_exercises(id) ON DELETE CASCADE,
  question_number INT NOT NULL CHECK (question_number >= 1),
  question_type TEXT NOT NULL CHECK (question_type IN ('single_choice', 'multiple_choice', 'fill_blank', 'short_answer', 'essay', 'image_upload', 'file_upload')),
  prompt TEXT NOT NULL CHECK (length(trim(prompt)) > 0),
  options_json JSONB DEFAULT '[]'::jsonb,
  points INT DEFAULT 10 CHECK (points > 0),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. BẢNG ĐÁP ÁN BÍ MẬT APP_PRIVATE.ACADEMIC_ANSWER_KEYS
CREATE TABLE IF NOT EXISTS app_private.academic_answer_keys (
  question_id UUID PRIMARY KEY REFERENCES public.academic_exercise_questions(id) ON DELETE CASCADE,
  correct_answer JSONB NOT NULL,
  accepted_answers JSONB DEFAULT '[]'::jsonb,
  case_sensitive BOOLEAN DEFAULT FALSE,
  grading_config JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. BẢNG BÀI NỘP PUBLIC.ACADEMIC_SUBMISSIONS
CREATE TABLE IF NOT EXISTS public.academic_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id UUID NOT NULL REFERENCES public.academic_exercises(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  attempt_number INT NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft', 'submitted', 'pending_manual_grade', 'graded', 'revision_requested')),
  objective_score INT DEFAULT 0 CHECK (objective_score >= 0),
  manual_score INT DEFAULT 0 CHECK (manual_score >= 0),
  total_score INT DEFAULT 0 CHECK (total_score >= 0),
  max_score INT DEFAULT 100 CHECK (max_score > 0),
  teacher_feedback TEXT,
  revision_notes TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  graded_at TIMESTAMPTZ,
  graded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reward_stars_awarded INT DEFAULT 0 CHECK (reward_stars_awarded >= 0),
  reward_applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public' AND t.relname = 'academic_submissions' AND c.conname = 'academic_submissions_exercise_student_attempt_key'
  ) THEN
    ALTER TABLE public.academic_submissions 
    ADD CONSTRAINT academic_submissions_exercise_student_attempt_key UNIQUE (exercise_id, student_id, attempt_number);
  END IF;
END $$;

-- 6. BẢNG CÂU TRẢ LỜI PUBLIC.ACADEMIC_SUBMISSION_ANSWERS
CREATE TABLE IF NOT EXISTS public.academic_submission_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES public.academic_submissions(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.academic_exercise_questions(id) ON DELETE CASCADE,
  student_answer_json JSONB,
  file_url TEXT,
  points_earned INT DEFAULT 0 CHECK (points_earned >= 0),
  is_correct BOOLEAN DEFAULT FALSE,
  teacher_comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public' AND t.relname = 'academic_submission_answers' AND c.conname = 'academic_submission_answers_sub_q_key'
  ) THEN
    ALTER TABLE public.academic_submission_answers 
    ADD CONSTRAINT academic_submission_answers_sub_q_key UNIQUE (submission_id, question_id);
  END IF;
END $$;

REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- STORAGE BUCKET PRIVATE EXERCISE-SUBMISSIONS
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'exercise-submissions',
  'exercise-submissions',
  false,
  10485760,
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp',
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY[
    'image/jpeg', 'image/png', 'image/webp',
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];

-- ============================================================================
-- CLEAN DROP TẤT CẢ POLICY CŨ & BẢO VỆ RLS CHUẨN ĐÚNG NGUYÊN TẮC
-- ============================================================================
ALTER TABLE public.academic_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_exercise_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_submission_answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Academic exercises select policy" ON public.academic_exercises;
DROP POLICY IF EXISTS "Academic exercises write policy" ON public.academic_exercises;
DROP POLICY IF EXISTS "Academic exercises insert policy" ON public.academic_exercises;
DROP POLICY IF EXISTS "Academic exercises update policy" ON public.academic_exercises;
DROP POLICY IF EXISTS "Academic exercises update/delete policy" ON public.academic_exercises;
DROP POLICY IF EXISTS "Academic exercises insert/update/delete policy" ON public.academic_exercises;

DROP POLICY IF EXISTS "Academic questions select policy" ON public.academic_exercise_questions;
DROP POLICY IF EXISTS "Academic questions write policy" ON public.academic_exercise_questions;
DROP POLICY IF EXISTS "Academic questions insert/update/delete policy" ON public.academic_exercise_questions;

DROP POLICY IF EXISTS "Academic submissions select policy" ON public.academic_submissions;
DROP POLICY IF EXISTS "Academic submissions write policy" ON public.academic_submissions;
DROP POLICY IF EXISTS "Academic submissions insert/update policy" ON public.academic_submissions;

DROP POLICY IF EXISTS "Academic submission answers select policy" ON public.academic_submission_answers;
DROP POLICY IF EXISTS "Academic submission answers write policy" ON public.academic_submission_answers;

-- 1. ACADEMIC_EXERCISES RLS
CREATE POLICY "Academic exercises select policy" ON public.academic_exercises
FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  OR teacher_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.classes c WHERE c.id = class_id AND c.teacher_id = auth.uid())
  OR (
    status = 'published' AND (
      is_global = true
      OR EXISTS (
        SELECT 1 FROM public.class_members cm 
        WHERE cm.class_id = academic_exercises.class_id AND cm.student_id = auth.uid()
      )
    )
  )
);

CREATE POLICY "Academic exercises insert policy" ON public.academic_exercises
FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  OR (
    teacher_id = auth.uid() 
    AND is_global IS NOT TRUE
    AND EXISTS (SELECT 1 FROM public.classes c WHERE c.id = class_id AND c.teacher_id = auth.uid())
  )
);

CREATE POLICY "Academic exercises update policy" ON public.academic_exercises
FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  OR (
    teacher_id = auth.uid() 
    AND EXISTS (SELECT 1 FROM public.classes c WHERE c.id = class_id AND c.teacher_id = auth.uid())
  )
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  OR (
    teacher_id = auth.uid()
    AND is_global IS NOT TRUE
    AND EXISTS (SELECT 1 FROM public.classes c WHERE c.id = class_id AND c.teacher_id = auth.uid())
  )
);

-- 2. ACADEMIC_EXERCISE_QUESTIONS RLS (CHỈ CHO SELECT; KHÓA GHI TRỰC TIẾP QUA RLS, PHẢI QUA RPC SECURITY DEFINER)
CREATE POLICY "Academic questions select policy" ON public.academic_exercise_questions
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.academic_exercises e 
    WHERE e.id = exercise_id AND (
      EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
      OR e.teacher_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.classes c WHERE c.id = e.class_id AND c.teacher_id = auth.uid())
      OR (
        e.status = 'published' AND (
          e.is_global = true 
          OR EXISTS (
            SELECT 1 FROM public.class_members cm 
            WHERE cm.class_id = e.class_id AND cm.student_id = auth.uid()
          )
        )
      )
    )
  )
);

-- 3. ACADEMIC_SUBMISSIONS RLS (CHỈ SELECT)
CREATE POLICY "Academic submissions select policy" ON public.academic_submissions
FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  OR student_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.academic_exercises e 
    JOIN public.classes c ON c.id = e.class_id
    WHERE e.id = exercise_id AND (e.teacher_id = auth.uid() OR c.teacher_id = auth.uid())
  )
);

-- 4. ACADEMIC_SUBMISSION_ANSWERS RLS (CHỈ SELECT)
CREATE POLICY "Academic submission answers select policy" ON public.academic_submission_answers
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.academic_submissions s
    WHERE s.id = submission_id AND (
      EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
      OR s.student_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.academic_exercises e 
        JOIN public.classes c ON c.id = e.class_id
        WHERE e.id = s.exercise_id AND (e.teacher_id = auth.uid() OR c.teacher_id = auth.uid())
      )
    )
  )
);

-- 5. STORAGE RLS
DROP POLICY IF EXISTS "Exercise submissions student insert policy" ON storage.objects;
DROP POLICY IF EXISTS "Exercise submissions select policy" ON storage.objects;

CREATE POLICY "Exercise submissions student insert policy" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'exercise-submissions'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM public.academic_submissions s
    WHERE s.id::text = (storage.foldername(name))[2]
      AND s.student_id = auth.uid()
      AND s.status IN ('draft', 'revision_requested')
  )
  AND (
    name NOT ILIKE '%.svg' AND name NOT ILIKE '%.exe' AND name NOT ILIKE '%.html'
    AND name NOT ILIKE '%.js' AND name NOT ILIKE '%.sh' AND name NOT ILIKE '%.bat'
  )
);

CREATE POLICY "Exercise submissions select policy" ON storage.objects
FOR SELECT USING (
  bucket_id = 'exercise-submissions' AND (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR (storage.foldername(name))[1] = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.academic_submissions s
      JOIN public.academic_exercises e ON e.id = s.exercise_id
      JOIN public.classes c ON c.id = e.class_id
      WHERE s.id::text = (storage.foldername(name))[2]
        AND (e.teacher_id = auth.uid() OR c.teacher_id = auth.uid())
    )
  )
);

-- ============================================================================
-- CÁC RPC SECURITY DEFINER
-- ============================================================================

-- 1. CREATE_OR_GET_SUBMISSION_DRAFT
CREATE OR REPLACE FUNCTION public.create_or_get_submission_draft(
  p_exercise_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_student_id UUID;
  v_role TEXT;
  v_ex RECORD;
  v_is_member BOOLEAN := FALSE;
  v_sub_id UUID;
  v_existing_attempts INT := 0;
BEGIN
  v_student_id := auth.uid();
  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_student_id;
  IF v_role != 'student' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chỉ học sinh mới có thể tạo bản nháp bài làm.');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('academic_sub_' || p_exercise_id::text || '_' || v_student_id::text));

  SELECT * INTO v_ex FROM public.academic_exercises WHERE id = p_exercise_id;
  IF v_ex.id IS NULL OR v_ex.status != 'published' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bài tập không tồn tại hoặc chưa xuất bản.');
  END IF;

  IF v_ex.due_date IS NOT NULL AND NOW() > v_ex.due_date THEN
    RETURN jsonb_build_object('success', false, 'message', 'Đã quá hạn làm bài tập này.');
  END IF;

  IF v_ex.is_global IS NOT TRUE THEN
    SELECT EXISTS (
      SELECT 1 FROM public.class_members WHERE class_id = v_ex.class_id AND student_id = v_student_id
    ) INTO v_is_member;

    IF NOT v_is_member THEN
      RETURN jsonb_build_object('success', false, 'message', 'Bé không thuộc lớp học được giao bài tập này.');
    END IF;
  END IF;

  SELECT id INTO v_sub_id 
  FROM public.academic_submissions 
  WHERE exercise_id = p_exercise_id AND student_id = v_student_id AND status IN ('draft', 'revision_requested')
  ORDER BY attempt_number DESC LIMIT 1;

  IF v_sub_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'submission_id', v_sub_id);
  END IF;

  SELECT COUNT(*) INTO v_existing_attempts 
  FROM public.academic_submissions 
  WHERE exercise_id = p_exercise_id AND student_id = v_student_id AND status != 'draft';

  IF v_existing_attempts >= COALESCE(v_ex.max_attempts, 1) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bé đã hết số lượt nộp bài cho phép.');
  END IF;

  INSERT INTO public.academic_submissions (
    exercise_id, student_id, attempt_number, status, max_score
  ) VALUES (
    p_exercise_id, v_student_id, v_existing_attempts + 1, 'draft', 100
  ) RETURNING id INTO v_sub_id;

  RETURN jsonb_build_object('success', true, 'submission_id', v_sub_id);
END;
$$;


-- 2. SAVE_EXERCISE_WITH_QUESTIONS_AND_KEYS
CREATE OR REPLACE FUNCTION public.save_exercise_with_questions_and_keys(
  p_exercise JSONB,
  p_questions JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_exercise_id UUID;
  v_class_id UUID;
  v_class_teacher UUID;
  v_existing_ex RECORD;
  v_q_json JSONB;
  v_q_id UUID;
  v_key_json JSONB;
  v_updated_rows INT;
  v_is_global BOOLEAN := FALSE;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  IF v_caller_role NOT IN ('admin', 'teacher') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn không có quyền quản lý bài tập.');
  END IF;

  v_is_global := COALESCE((p_exercise->>'is_global')::BOOLEAN, FALSE);

  IF v_is_global AND v_caller_role != 'admin' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Chỉ Admin mới có quyền tạo bài tập chung toàn trường (is_global).');
  END IF;

  IF (p_exercise->>'class_id') IS NOT NULL AND (p_exercise->>'class_id') != '' THEN
    v_class_id := (p_exercise->>'class_id')::UUID;
    SELECT teacher_id INTO v_class_teacher FROM public.classes WHERE id = v_class_id;
    IF v_class_teacher IS NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Lớp học được chọn không tồn tại.');
    END IF;

    IF v_caller_role != 'admin' AND v_class_teacher != v_caller_id THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn chỉ được tạo bài tập cho lớp mình phụ trách.');
    END IF;
  ELSE
    IF NOT v_is_global THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bài tập phải gán cho một Lớp học cụ thể.');
    END IF;
  END IF;

  IF (p_exercise->>'title') IS NULL OR length(trim(p_exercise->>'title')) = 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Tiêu đề bài tập không được để trống.');
  END IF;

  IF (p_exercise->>'id') IS NOT NULL AND (p_exercise->>'id') != '' THEN
    v_exercise_id := (p_exercise->>'id')::UUID;

    SELECT * INTO v_existing_ex FROM public.academic_exercises WHERE id = v_exercise_id FOR UPDATE;

    IF v_existing_ex.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bài tập không tồn tại.');
    END IF;

    IF v_caller_role != 'admin' AND v_existing_ex.teacher_id != v_caller_id THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn không sở hữu bài tập này.');
    END IF;

    UPDATE public.academic_exercises
    SET
      title = trim(p_exercise->>'title'),
      description = p_exercise->>'description',
      class_id = v_class_id,
      is_global = v_is_global,
      grade_level = GREATEST(1, LEAST(5, COALESCE((p_exercise->>'grade_level')::INT, 1))),
      subject = COALESCE(p_exercise->>'subject', 'Toán'),
      exercise_type = COALESCE(p_exercise->>'exercise_type', 'mixed'),
      status = COALESCE(p_exercise->>'status', 'draft'),
      due_date = CASE WHEN (p_exercise->>'due_date') IS NOT NULL AND (p_exercise->>'due_date') != '' THEN (p_exercise->>'due_date')::TIMESTAMPTZ ELSE NULL END,
      max_attempts = GREATEST(1, COALESCE((p_exercise->>'max_attempts')::INT, 1)),
      reward_stars = GREATEST(0, COALESCE((p_exercise->>'reward_stars')::INT, 10)),
      show_score_after_submit = COALESCE((p_exercise->>'show_score_after_submit')::BOOLEAN, TRUE),
      show_correct_answers = COALESCE((p_exercise->>'show_correct_answers')::BOOLEAN, FALSE),
      updated_at = NOW()
    WHERE id = v_exercise_id;

    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    IF v_updated_rows != 1 THEN
      RAISE EXCEPTION 'UPDATE bài tập thất bại: Không tác động đúng 1 dòng.';
    END IF;

  ELSE
    INSERT INTO public.academic_exercises (
      teacher_id, class_id, is_global, grade_level, subject, title, description,
      exercise_type, status, due_date, max_attempts, reward_stars,
      show_score_after_submit, show_correct_answers
    ) VALUES (
      v_caller_id,
      v_class_id,
      v_is_global,
      GREATEST(1, LEAST(5, COALESCE((p_exercise->>'grade_level')::INT, 1))),
      COALESCE(p_exercise->>'subject', 'Toán'),
      trim(p_exercise->>'title'),
      p_exercise->>'description',
      COALESCE(p_exercise->>'exercise_type', 'mixed'),
      COALESCE(p_exercise->>'status', 'draft'),
      CASE WHEN (p_exercise->>'due_date') IS NOT NULL AND (p_exercise->>'due_date') != '' THEN (p_exercise->>'due_date')::TIMESTAMPTZ ELSE NULL END,
      GREATEST(1, COALESCE((p_exercise->>'max_attempts')::INT, 1)),
      GREATEST(0, COALESCE((p_exercise->>'reward_stars')::INT, 10)),
      COALESCE((p_exercise->>'show_score_after_submit')::BOOLEAN, TRUE),
      COALESCE((p_exercise->>'show_correct_answers')::BOOLEAN, FALSE)
    ) RETURNING id INTO v_exercise_id;
  END IF;

  DELETE FROM public.academic_exercise_questions WHERE exercise_id = v_exercise_id;

  FOR v_q_json IN SELECT * FROM jsonb_array_elements(p_questions)
  LOOP
    IF (v_q_json->>'prompt') IS NULL OR length(trim(v_q_json->>'prompt')) = 0 THEN
      RAISE EXCEPTION 'Nội dung câu hỏi không được để trống.';
    END IF;

    INSERT INTO public.academic_exercise_questions (
      exercise_id, question_number, question_type, prompt, options_json, points
    ) VALUES (
      v_exercise_id,
      GREATEST(1, COALESCE((v_q_json->>'question_number')::INT, 1)),
      COALESCE(v_q_json->>'question_type', 'single_choice'),
      trim(v_q_json->>'prompt'),
      COALESCE(v_q_json->'options_json', '[]'::jsonb),
      GREATEST(1, COALESCE((v_q_json->>'points')::INT, 10))
    ) RETURNING id INTO v_q_id;

    v_key_json := v_q_json->'correct_answer_key';
    IF v_key_json IS NOT NULL THEN
      INSERT INTO app_private.academic_answer_keys (
        question_id, correct_answer, accepted_answers, case_sensitive
      ) VALUES (
        v_q_id,
        COALESCE(v_key_json->'correct_answer', '""'::jsonb),
        COALESCE(v_key_json->'accepted_answers', '[]'::jsonb),
        COALESCE((v_key_json->>'case_sensitive')::BOOLEAN, FALSE)
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'exercise_id', v_exercise_id, 'message', 'Lưu bài tập thành công!');
END;
$$;


-- 3. SUBMIT_ACADEMIC_EXERCISE VỚI VALIDATE P_ANSWERS NGHIÊM NGẶT
CREATE OR REPLACE FUNCTION public.submit_academic_exercise(
  p_exercise_id UUID,
  p_answers JSONB,
  p_is_draft BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_student_id UUID;
  v_role TEXT;
  v_ex RECORD;
  v_is_member BOOLEAN := FALSE;
  v_existing_attempts INT := 0;
  v_attempt_num INT := 1;
  v_submission_id UUID;
  v_q RECORD;
  v_key RECORD;
  v_ans_item JSONB;
  v_student_ans JSONB;
  v_file_url TEXT;
  v_is_correct BOOLEAN;
  v_points_earned INT;
  v_obj_score INT := 0;
  v_max_score INT := 0;
  v_has_subjective BOOLEAN := FALSE;
  v_status TEXT;
  v_ratio FLOAT := 0.0;
  v_reward_stars INT := 0;
  v_already_applied TIMESTAMPTZ;
  v_seen_q_ids UUID[] := ARRAY[]::UUID[];
  v_curr_q_id UUID;
BEGIN
  v_student_id := auth.uid();
  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_student_id;
  IF v_role != 'student' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Chỉ tài khoản Học sinh mới được phép nộp bài tập tích sao.');
  END IF;

  IF jsonb_typeof(p_answers) != 'array' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Cấu trúc câu trả lời không hợp lệ.');
  END IF;

  -- 1. VALIDATE KHÔNG CÓ QUESTION_ID TRÙNG HOẶC KHÔNG THUỘC BÀI TẬP
  FOR v_ans_item IN SELECT * FROM jsonb_array_elements(p_answers)
  LOOP
    IF (v_ans_item->>'question_id') IS NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Thiếu question_id trong câu trả lời.');
    END IF;

    v_curr_q_id := (v_ans_item->>'question_id')::UUID;

    IF v_curr_q_id = ANY(v_seen_q_ids) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Phát hiện question_id bị gửi trùng lặp.');
    END IF;
    v_seen_q_ids := array_append(v_seen_q_ids, v_curr_q_id);

    IF NOT EXISTS (SELECT 1 FROM public.academic_exercise_questions WHERE id = v_curr_q_id AND exercise_id = p_exercise_id) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Phát hiện question_id không thuộc bài tập này.');
    END IF;
  END LOOP;

  -- ADVISORY TRANSACTION LOCK
  PERFORM pg_advisory_xact_lock(hashtext('academic_sub_' || p_exercise_id::text || '_' || v_student_id::text));

  SELECT * INTO v_ex FROM public.academic_exercises WHERE id = p_exercise_id;
  IF v_ex.id IS NULL OR v_ex.status != 'published' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bài tập không tồn tại hoặc chưa xuất bản.');
  END IF;

  IF v_ex.due_date IS NOT NULL AND NOW() > v_ex.due_date THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Đã quá hạn nộp bài tập này.');
  END IF;

  IF v_ex.is_global IS NOT TRUE THEN
    SELECT EXISTS (
      SELECT 1 FROM public.class_members WHERE class_id = v_ex.class_id AND student_id = v_student_id
    ) INTO v_is_member;

    IF NOT v_is_member THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bé không thuộc lớp học được giao bài tập này.');
    END IF;
  END IF;

  SELECT id, attempt_number, reward_applied_at 
  INTO v_submission_id, v_attempt_num, v_already_applied
  FROM public.academic_submissions
  WHERE exercise_id = p_exercise_id AND student_id = v_student_id AND status IN ('draft', 'revision_requested')
  ORDER BY attempt_number DESC LIMIT 1;

  IF v_submission_id IS NULL THEN
    SELECT COUNT(*) INTO v_existing_attempts
    FROM public.academic_submissions
    WHERE exercise_id = p_exercise_id AND student_id = v_student_id AND status != 'draft';

    IF v_existing_attempts >= COALESCE(v_ex.max_attempts, 1) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bé đã dùng hết số lượt nộp bài cho phép.');
    END IF;

    v_attempt_num := v_existing_attempts + 1;
    v_status := CASE WHEN p_is_draft THEN 'draft' ELSE 'submitted' END;

    INSERT INTO public.academic_submissions (
      exercise_id, student_id, attempt_number, status, max_score
    ) VALUES (
      p_exercise_id, v_student_id, v_attempt_num, v_status, 100
    ) RETURNING id INTO v_submission_id;

  ELSE
    v_status := CASE WHEN p_is_draft THEN 'draft' ELSE 'submitted' END;
    UPDATE public.academic_submissions
    SET status = v_status, updated_at = NOW()
    WHERE id = v_submission_id;
  END IF;

  DELETE FROM public.academic_submission_answers WHERE submission_id = v_submission_id;

  FOR v_q IN SELECT * FROM public.academic_exercise_questions WHERE exercise_id = p_exercise_id ORDER BY question_number ASC
  LOOP
    v_max_score := v_max_score + COALESCE(v_q.points, 10);
    
    SELECT value INTO v_ans_item 
    FROM jsonb_array_elements(p_answers) 
    WHERE (value->>'question_id')::UUID = v_q.id;

    v_student_ans := v_ans_item->'answer';
    v_file_url := v_ans_item->>'file_url';

    IF v_file_url IS NOT NULL AND length(trim(v_file_url)) > 0 THEN
      IF NOT (v_file_url LIKE v_student_id::text || '/' || v_submission_id::text || '/%') THEN
        v_file_url := NULL;
      END IF;
    END IF;

    v_is_correct := FALSE;
    v_points_earned := 0;

    IF v_q.question_type IN ('single_choice', 'multiple_choice', 'fill_blank', 'short_answer') THEN
      SELECT * INTO v_key FROM app_private.academic_answer_keys WHERE question_id = v_q.id;

      IF v_key.question_id IS NOT NULL AND v_student_ans IS NOT NULL THEN
        IF v_q.question_type = 'single_choice' THEN
          IF (v_student_ans#>>'{}') = (v_key.correct_answer#>>'{}') THEN
            v_is_correct := TRUE;
          END IF;

        ELSIF v_q.question_type = 'multiple_choice' THEN
          IF (SELECT jsonb_agg(elem ORDER BY elem) FROM jsonb_array_elements_text(v_student_ans) elem) =
             (SELECT jsonb_agg(elem ORDER BY elem) FROM jsonb_array_elements_text(v_key.correct_answer) elem) THEN
            v_is_correct := TRUE;
          END IF;

        ELSIF v_q.question_type IN ('fill_blank', 'short_answer') THEN
          IF v_key.case_sensitive THEN
            IF TRIM(v_student_ans#>>'{}') = TRIM(v_key.correct_answer#>>'{}')
               OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_key.accepted_answers) acc WHERE TRIM(acc) = TRIM(v_student_ans#>>'{}')) THEN
              v_is_correct := TRUE;
            END IF;
          ELSE
            IF LOWER(TRIM(v_student_ans#>>'{}')) = LOWER(TRIM(v_key.correct_answer#>>'{}'))
               OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_key.accepted_answers) acc WHERE LOWER(TRIM(acc)) = LOWER(TRIM(v_student_ans#>>'{}'))) THEN
              v_is_correct := TRUE;
            END IF;
          END IF;
        END IF;
      END IF;

      IF v_is_correct THEN
        v_points_earned := COALESCE(v_q.points, 10);
        v_obj_score := v_obj_score + v_points_earned;
      END IF;

    ELSE
      v_has_subjective := TRUE;
    END IF;

    INSERT INTO public.academic_submission_answers (
      submission_id, question_id, student_answer_json, file_url, points_earned, is_correct
    ) VALUES (
      v_submission_id, v_q.id, v_student_ans, v_file_url, v_points_earned, v_is_correct
    );
  END LOOP;

  IF NOT p_is_draft THEN
    IF v_has_subjective THEN
      v_status := 'pending_manual_grade';
    ELSE
      v_status := 'graded';
      IF v_max_score > 0 AND v_obj_score > 0 THEN
        v_ratio := (v_obj_score::FLOAT / v_max_score::FLOAT);
        v_reward_stars := FLOOR(COALESCE(v_ex.reward_stars, 10) * v_ratio);
      ELSE
        v_reward_stars := 0;
      END IF;
    END IF;
  END IF;

  UPDATE public.academic_submissions
  SET
    status = v_status,
    objective_score = v_obj_score,
    total_score = v_obj_score,
    max_score = GREATEST(v_max_score, 10),
    submitted_at = CASE WHEN NOT p_is_draft THEN NOW() ELSE submitted_at END,
    graded_at = CASE WHEN v_status = 'graded' THEN NOW() ELSE NULL END,
    reward_stars_awarded = CASE WHEN v_status = 'graded' AND v_already_applied IS NULL THEN v_reward_stars ELSE reward_stars_awarded END,
    reward_applied_at = CASE WHEN v_status = 'graded' AND v_reward_stars > 0 AND v_already_applied IS NULL THEN NOW() ELSE reward_applied_at END
  WHERE id = v_submission_id;

  IF v_status = 'graded' AND v_reward_stars > 0 AND v_already_applied IS NULL THEN
    UPDATE public.profiles
    SET total_stars = COALESCE(total_stars, 0) + v_reward_stars
    WHERE id = v_student_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'submission_id', v_submission_id,
    'status', v_status,
    'objective_score', v_obj_score,
    'max_score', v_max_score,
    'reward_stars_awarded', CASE WHEN v_status = 'graded' AND v_already_applied IS NULL THEN v_reward_stars ELSE 0 END,
    'message', CASE WHEN p_is_draft THEN 'Đã lưu bản nháp thành công!' WHEN v_status = 'graded' THEN 'Nộp bài và tự động chấm điểm thành công!' ELSE 'Đã nộp bài thành công! Bài tập đang chờ Giáo viên chấm tự luận.' END
  );
END;
$$;


-- 4. GRADE_ACADEMIC_SUBMISSION CHỈ CHẤM BÀI SUBMITTED/PENDING_MANUAL_GRADE, TỪ CHỐI DRAFT
CREATE OR REPLACE FUNCTION public.grade_academic_submission(
  p_submission_id UUID,
  p_manual_grades JSONB,
  p_teacher_feedback TEXT,
  p_request_revision BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_teacher_id UUID;
  v_role TEXT;
  v_sub RECORD;
  v_ex RECORD;
  v_grade_item JSONB;
  v_q_type TEXT;
  v_q_points INT;
  v_item_points INT;
  v_total_manual INT := 0;
  v_new_status TEXT;
  v_final_total INT := 0;
  v_ratio FLOAT := 0.0;
  v_stars_to_award INT := 0;
  v_updated_rows INT;
BEGIN
  v_teacher_id := auth.uid();
  IF v_teacher_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_teacher_id;

  SELECT * INTO v_sub FROM public.academic_submissions WHERE id = p_submission_id FOR UPDATE;
  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bài nộp không tồn tại.');
  END IF;

  -- 1. TỪ CHỐI CHẤM BẢN NHÁP (DRAFT)
  IF v_sub.status = 'draft' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Không thể chấm bài nộp ở trạng thái Bản Nháp (draft).');
  END IF;

  SELECT * INTO v_ex FROM public.academic_exercises WHERE id = v_sub.exercise_id;

  IF v_role != 'admin' AND v_ex.teacher_id != v_teacher_id THEN
    IF NOT EXISTS (SELECT 1 FROM public.classes WHERE id = v_ex.class_id AND teacher_id = v_teacher_id) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn không có quyền chấm bài nộp này.');
    END IF;
  END IF;

  IF p_manual_grades IS NOT NULL AND jsonb_array_length(p_manual_grades) > 0 THEN
    FOR v_grade_item IN SELECT * FROM jsonb_array_elements(p_manual_grades)
    LOOP
      SELECT question_type, points INTO v_q_type, v_q_points 
      FROM public.academic_exercise_questions 
      WHERE id = (v_grade_item->>'question_id')::UUID AND exercise_id = v_sub.exercise_id;

      IF v_q_type IN ('essay', 'image_upload', 'file_upload') THEN
        v_item_points := GREATEST(0, LEAST(COALESCE(v_q_points, 10), COALESCE((v_grade_item->>'points_earned')::INT, 0)));

        UPDATE public.academic_submission_answers
        SET
          points_earned = v_item_points,
          teacher_comment = v_grade_item->>'teacher_comment'
        WHERE submission_id = p_submission_id AND question_id = (v_grade_item->>'question_id')::UUID;

        GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
        IF v_updated_rows != 1 THEN
          RAISE EXCEPTION 'Chấm điểm thất bại: Không cập nhật được câu hỏi.';
        END IF;
      END IF;
    END LOOP;
  END IF;

  SELECT COALESCE(SUM(ans.points_earned), 0) INTO v_total_manual
  FROM public.academic_submission_answers ans
  JOIN public.academic_exercise_questions q ON q.id = ans.question_id
  WHERE ans.submission_id = p_submission_id AND q.question_type IN ('essay', 'image_upload', 'file_upload');

  v_final_total := LEAST(COALESCE(v_sub.objective_score, 0) + v_total_manual, COALESCE(v_sub.max_score, 100));

  IF p_request_revision THEN
    v_new_status := 'revision_requested';
  ELSE
    v_new_status := 'graded';
  END IF;

  IF v_new_status = 'graded' AND v_sub.reward_applied_at IS NULL AND v_final_total > 0 THEN
    v_ratio := (v_final_total::FLOAT / COALESCE(v_sub.max_score, 100)::FLOAT);
    v_stars_to_award := FLOOR(COALESCE(v_ex.reward_stars, 10) * v_ratio);
  END IF;

  UPDATE public.academic_submissions
  SET
    status = v_new_status,
    manual_score = v_total_manual,
    total_score = v_final_total,
    teacher_feedback = p_teacher_feedback,
    graded_at = NOW(),
    graded_by = v_teacher_id,
    reward_stars_awarded = CASE WHEN v_sub.reward_applied_at IS NULL THEN v_stars_to_award ELSE reward_stars_awarded END,
    reward_applied_at = CASE WHEN v_stars_to_award > 0 AND v_sub.reward_applied_at IS NULL THEN NOW() ELSE reward_applied_at END
  WHERE id = p_submission_id;

  IF v_stars_to_award > 0 AND v_sub.reward_applied_at IS NULL THEN
    UPDATE public.profiles
    SET total_stars = COALESCE(total_stars, 0) + v_stars_to_award
    WHERE id = v_sub.student_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', v_new_status,
    'total_score', v_final_total,
    'stars_awarded', CASE WHEN v_sub.reward_applied_at IS NULL THEN v_stars_to_award ELSE 0 END,
    'message', CASE WHEN p_request_revision THEN 'Đã yêu cầu học sinh làm lại bài.' ELSE 'Đã lưu điểm và nhận xét thành công!' END
  );
END;
$$;


-- 5. GET_SUBMISSION_CORRECT_ANSWERS CHỈ CHO XEM KHI ĐÃ HẾT LƯỢT HOẶC ĐÃ CLOSED/ARCHIVED
CREATE OR REPLACE FUNCTION public.get_submission_correct_answers(
  p_submission_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_student_id UUID;
  v_sub RECORD;
  v_ex RECORD;
  v_existing_sub_count INT := 0;
  v_res JSONB := '[]'::jsonb;
BEGIN
  v_student_id := auth.uid();
  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT * INTO v_sub FROM public.academic_submissions WHERE id = p_submission_id;
  IF v_sub.id IS NULL OR v_sub.student_id != v_student_id THEN
    RETURN jsonb_build_object('success', false, 'message', 'Không có quyền xem đáp án.');
  END IF;

  SELECT * INTO v_ex FROM public.academic_exercises WHERE id = v_sub.exercise_id;
  IF v_ex.show_correct_answers IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bài tập này không mở hiển thị đáp án đúng.');
  END IF;

  -- 1. CHỈ CHO XEM KHI ĐÃ HẾT SỐ LƯỢT MAX_ATTEMPTS HOẶC BÀI ĐÃ CLOSED/ARCHIVED
  SELECT COUNT(*) INTO v_existing_sub_count 
  FROM public.academic_submissions 
  WHERE exercise_id = v_ex.id AND student_id = v_student_id AND status != 'draft';

  IF v_existing_sub_count < COALESCE(v_ex.max_attempts, 1) AND v_ex.status NOT IN ('closed', 'archived') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bé chưa thể xem đáp án vì vẫn còn lượt nộp bài tiếp theo.');
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'question_id', q.id,
    'correct_answer', k.correct_answer
  )) INTO v_res
  FROM public.academic_exercise_questions q
  JOIN app_private.academic_answer_keys k ON k.question_id = q.id
  WHERE q.exercise_id = v_ex.id;

  RETURN jsonb_build_object('success', true, 'answers', v_res);
END;
$$;

-- GRANT / REVOKE
REVOKE EXECUTE ON FUNCTION public.create_or_get_submission_draft FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.save_exercise_with_questions_and_keys FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.submit_academic_exercise FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.grade_academic_submission FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_submission_correct_answers FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_or_get_submission_draft TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_exercise_with_questions_and_keys TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_academic_exercise TO authenticated;
GRANT EXECUTE ON FUNCTION public.grade_academic_submission TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_submission_correct_answers TO authenticated;

COMMIT;
