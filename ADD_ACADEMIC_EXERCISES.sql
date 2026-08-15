-- ============================================================================
-- MIGRATION CSDL HỆ THỐNG BÀI TẬP HỌC THUẬT (ACADEMIC EXERCISES) - PHIÊN BẢN 3.0 AN TOÀN TUYỆT ĐỐI
-- 1. CHỐNG RACE CONDITION BẰNG ADVISORY TRANSACTION LOCK (PG_ADVISORY_XACT_LOCK)
-- 2. LOẠI BỎ CỘT CLASS_NAME, CHUẨN HÓA CLASS_ID UUID KHÓA NGOẠI DÙNG ALTER TABLE MIGRATION AN TOÀN
-- 3. BẢO VỆ ĐÁP ÁN TRẮC NGHIỆM TẠI SCHEMA PRIVATE APP_PRIVATE VÀ BUCKET PRIVATE EXERCISE-SUBMISSIONS
-- 4. KHÓA DIRECT WRITE CHỐNG HỌC SINH TỰ SỬA ĐIỂM, XOÁ VÀ CỘNG SAO LẦN 2
-- ============================================================================

BEGIN;

-- 1. KHỞI TẠO SCHEMA PRIVACY APP_PRIVATE NẾU CHƯA CÓ
CREATE SCHEMA IF NOT EXISTS app_private;

-- 2. MIGRATION BẢNG ACADEMIC_EXERCISES VỚI ALTER TABLE AN TOÀN TỪ PHIÊN BẢN CŨ
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

-- Bổ sung các cột mới nếu chạy từ phiên bản cũ
ALTER TABLE public.academic_exercises ADD COLUMN IF NOT EXISTS class_id UUID REFERENCES public.classes(id) ON DELETE CASCADE;
ALTER TABLE public.academic_exercises ADD COLUMN IF NOT EXISTS is_global BOOLEAN DEFAULT FALSE;

-- 3. BẢNG CÂU HỎI BÀI TẬP (PUBLIC.ACADEMIC_EXERCISE_QUESTIONS)
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

-- 4. BẢNG LƯU ĐÁP ÁN BÍ MẬT BẢO VỆ TRONG SCHEMA PRIVACY (APP_PRIVATE.ACADEMIC_ANSWER_KEYS)
CREATE TABLE IF NOT EXISTS app_private.academic_answer_keys (
  question_id UUID PRIMARY KEY REFERENCES public.academic_exercise_questions(id) ON DELETE CASCADE,
  correct_answer JSONB NOT NULL,
  accepted_answers JSONB DEFAULT '[]'::jsonb,
  case_sensitive BOOLEAN DEFAULT FALSE,
  grading_config JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. BẢNG BÀI NỘP CỦA HỌC SINH (PUBLIC.ACADEMIC_SUBMISSIONS)
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

-- Constraint UNIQUE khóa đúng bảng public.academic_submissions
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

-- 6. BẢNG CÂU TRẢ LỜI CHI TIẾT (PUBLIC.ACADEMIC_SUBMISSION_ANSWERS)
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

-- ============================================================================
-- REVOKE QUYỀN TRUY CẬP TRỰC TIẾP SCHEMA PRIVACY APP_PRIVATE
-- ============================================================================
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- CẤU HÌNH BUCKET STORAGE PRIVATE EXERCISE-SUBMISSIONS
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
-- MIGRATION XÓA SẠCH TẤT CẢ CÁC POLICY CŨ (BAO GỒM CÁC TÊN DANGEROUS NGUY HIỂM)
-- ============================================================================
ALTER TABLE public.academic_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_exercise_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_submission_answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Academic exercises select policy" ON public.academic_exercises;
DROP POLICY IF EXISTS "Academic exercises write policy" ON public.academic_exercises;
DROP POLICY IF EXISTS "Academic exercises insert/update/delete policy" ON public.academic_exercises;

DROP POLICY IF EXISTS "Academic questions select policy" ON public.academic_exercise_questions;
DROP POLICY IF EXISTS "Academic questions write policy" ON public.academic_exercise_questions;

DROP POLICY IF EXISTS "Academic submissions select policy" ON public.academic_submissions;
DROP POLICY IF EXISTS "Academic submissions write policy" ON public.academic_submissions;
DROP POLICY IF EXISTS "Academic submissions insert/update policy" ON public.academic_submissions;

DROP POLICY IF EXISTS "Academic submission answers select policy" ON public.academic_submission_answers;
DROP POLICY IF EXISTS "Academic submission answers write policy" ON public.academic_submission_answers;

-- 1. RLS FOR ACADEMIC_EXERCISES
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

CREATE POLICY "Academic exercises update/delete policy" ON public.academic_exercises
FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  OR (
    teacher_id = auth.uid() 
    AND EXISTS (SELECT 1 FROM public.classes c WHERE c.id = class_id AND c.teacher_id = auth.uid())
  )
);

-- 2. RLS FOR ACADEMIC_EXERCISE_QUESTIONS
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

CREATE POLICY "Academic questions write policy" ON public.academic_exercise_questions
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.academic_exercises e 
    WHERE e.id = exercise_id AND (
      EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
      OR e.teacher_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.classes c WHERE c.id = e.class_id AND c.teacher_id = auth.uid())
    )
  )
);

-- 3. RLS FOR ACADEMIC_SUBMISSIONS (SELECT ONLY DÀNH CHO HỌC SINH; KHÔNG CHO GHI TRỰC TIẾP)
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

-- 4. RLS FOR ACADEMIC_SUBMISSION_ANSWERS
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

-- 5. STORAGE RLS FOR EXERCISE-SUBMISSIONS
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
      AND s.status IN ('draft', 'submitted', 'revision_requested')
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
-- CÁC RPC DEFINER NGUYÊN TỬ VỚI ADVISORY LOCK VÀ CHỐNG RACE CONDITION
-- ============================================================================

-- HELPER RPC: TẠO BẢN NHÁP SỚM CHO HỌC SINH ĐỂ UPLOAD FILE AN TOÀN VÀO BUCKET
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

  SELECT * INTO v_ex FROM public.academic_exercises WHERE id = p_exercise_id;
  IF v_ex.id IS NULL OR v_ex.status != 'published' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bài tập không tồn tại hoặc không mở.');
  END IF;

  -- Kiểm tra xem đã có draft chưa
  SELECT id INTO v_sub_id 
  FROM public.academic_submissions 
  WHERE exercise_id = p_exercise_id AND student_id = v_student_id AND status IN ('draft', 'revision_requested')
  ORDER BY attempt_number DESC LIMIT 1;

  IF v_sub_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'submission_id', v_sub_id);
  END IF;

  -- Đếm số lượt đã nộp chính thức
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


-- 1. RPC LƯU BÀI TẬP VÀ ĐÁP ÁN BÍ MẬT (SAVE_EXERCISE_WITH_QUESTIONS_AND_KEYS)
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

  -- RÀO CHẮN: BÀI IS_GLOBAL CHỈ DÀNH CHO ADMIN
  IF v_is_global AND v_caller_role != 'admin' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Chỉ Admin mới có quyền tạo bài tập chung toàn trường (is_global).');
  END IF;

  -- Validate class_id
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

  -- Validate title
  IF (p_exercise->>'title') IS NULL OR length(trim(p_exercise->>'title')) = 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Tiêu đề bài tập không được để trống.');
  END IF;

  -- UPDATE HOẶC INSERT BÀI TẬP
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

  -- NGUYÊN TỬ: XÓA VÀ TẠO LẠI CÂU HỎI KHI NGƯỜI GỌI SỞ HỮU BÀI TẬP
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


-- 2. RPC NỘP BÀI TẬP (SUBMIT_ACADEMIC_EXERCISE) - KHÓA ADVISORY TRANSACTION VÀ BẢO VỆ CHẮC CHẮN
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
BEGIN
  v_student_id := auth.uid();
  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Chưa đăng nhập.');
  END IF;

  -- 1. BẮT BỤC KIỂM TRA ROLE = STUDENT
  SELECT role INTO v_role FROM public.profiles WHERE id = v_student_id;
  IF v_role != 'student' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Chỉ tài khoản Học sinh mới được phép nộp bài tập tích sao.');
  END IF;

  -- 2. VALIDATE P_ANSWERS LÀ MẢNG JSONB
  IF jsonb_typeof(p_answers) != 'array' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Cấu trúc câu trả lời không hợp lệ.');
  END IF;

  -- 3. KHÓA TRANSACTION ADVISORY LOCK CHỐNG RACE CONDITION VƯỢT MAX_ATTEMPTS
  PERFORM pg_advisory_xact_lock(hashtext('academic_sub_' || p_exercise_id::text || '_' || v_student_id::text));

  -- 4. Lấy thông tin bài tập
  SELECT * INTO v_ex FROM public.academic_exercises WHERE id = p_exercise_id;
  IF v_ex.id IS NULL OR v_ex.status != 'published' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bài tập không tồn tại hoặc chưa xuất bản.');
  END IF;

  IF v_ex.due_date IS NOT NULL AND NOW() > v_ex.due_date THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Đã quá hạn nộp bài tập này.');
  END IF;

  -- Kiểm tra tư cách lớp học
  IF v_ex.is_global IS NOT TRUE THEN
    SELECT EXISTS (
      SELECT 1 FROM public.class_members WHERE class_id = v_ex.class_id AND student_id = v_student_id
    ) INTO v_is_member;

    IF NOT v_is_member THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bé không thuộc lớp học được giao bài tập này.');
    END IF;
  END IF;

  -- 5. XỬ LÝ DRAFT HIỆN CÓ NẾU CÓ ĐỂ TRÁNH TRÙNG LƯỢT HOẶC XUNG ĐỘT UNIQUE
  SELECT id, attempt_number INTO v_submission_id, v_attempt_num
  FROM public.academic_submissions
  WHERE exercise_id = p_exercise_id AND student_id = v_student_id AND status IN ('draft', 'revision_requested')
  ORDER BY attempt_number DESC LIMIT 1;

  IF v_submission_id IS NULL THEN
    -- Đếm số lượt đã nộp chính thức
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

  -- Xóa các câu trả lời cũ của submission này để nạp lại
  DELETE FROM public.academic_submission_answers WHERE submission_id = v_submission_id;

  -- 6. DUYỆT QUA CÂU HỎI THUỘC ĐÚNG BÀI TẬP VÀ TỰ ĐỘNG CHẤM
  FOR v_q IN SELECT * FROM public.academic_exercise_questions WHERE exercise_id = p_exercise_id ORDER BY question_number ASC
  LOOP
    v_max_score := v_max_score + COALESCE(v_q.points, 10);
    
    SELECT value INTO v_ans_item 
    FROM jsonb_array_elements(p_answers) 
    WHERE (value->>'question_id')::UUID = v_q.id;

    v_student_ans := v_ans_item->'answer';
    v_file_url := v_ans_item->>'file_url';

    -- VALIDATE FILE_URL: KHÔNG NHẬN PATH TÙY Ý CLIENT KHÔNG KHỚP SUBMISSION_ID
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

  -- 7. CẬP NHẬT ĐIỂM SỐ VÀ SAO THƯỞNG TỶ LỆ
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
    reward_stars_awarded = CASE WHEN v_status = 'graded' THEN v_reward_stars ELSE 0 END,
    reward_applied_at = CASE WHEN v_status = 'graded' AND v_reward_stars > 0 THEN NOW() ELSE NULL END
  WHERE id = v_submission_id;

  IF v_status = 'graded' AND v_reward_stars > 0 THEN
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
    'reward_stars_awarded', CASE WHEN v_status = 'graded' THEN v_reward_stars ELSE 0 END,
    'message', CASE WHEN p_is_draft THEN 'Đã lưu bản nháp thành công!' WHEN v_status = 'graded' THEN 'Nộp bài và tự động chấm điểm thành công!' ELSE 'Đã nộp bài thành công! Bài tập đang chờ Giáo viên chấm tự luận.' END
  );
END;
$$;


-- 3. RPC GIÁO VIÊN CHẤM BÀI (GRADE_ACADEMIC_SUBMISSION)
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

  SELECT * INTO v_ex FROM public.academic_exercises WHERE id = v_sub.exercise_id;

  IF v_role != 'admin' AND v_ex.teacher_id != v_teacher_id THEN
    IF NOT EXISTS (SELECT 1 FROM public.classes WHERE id = v_ex.class_id AND teacher_id = v_teacher_id) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn không có quyền chấm bài nộp này.');
    END IF;
  END IF;

  -- CHỈ CHẤM ĐIỂM THỦ CÔNG CHO CÂU TỰ LUẬN / NỘP FILE (KHÔNG GHI ĐÈ ĐIỂM CÂU KHÁCH QUAN TỰ ĐỘNG)
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

        v_total_manual := v_total_manual + v_item_points;
      END IF;
    END LOOP;
  END IF;

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
    reward_stars_awarded = COALESCE(reward_stars_awarded, 0) + v_stars_to_award,
    reward_applied_at = CASE WHEN v_stars_to_award > 0 THEN NOW() ELSE reward_applied_at END
  WHERE id = p_submission_id;

  IF v_stars_to_award > 0 THEN
    UPDATE public.profiles
    SET total_stars = COALESCE(total_stars, 0) + v_stars_to_award
    WHERE id = v_sub.student_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', v_new_status,
    'total_score', v_final_total,
    'stars_awarded', v_stars_to_award,
    'message', CASE WHEN p_request_revision THEN 'Đã yêu cầu học sinh làm lại bài.' ELSE 'Đã lưu điểm và nhận xét thành công!' END
  );
END;
$$;


-- 4. RPC BẢO MẬT: XEM ĐÁP ÁN ĐÚNG CHỈ SAU KHI NỘP VÀ ĐƯỢC CHẮC CHẮN CHO PHÉP
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
  IF v_ex.show_correct_answers IS NOT TRUE OR v_sub.status NOT IN ('submitted', 'pending_manual_grade', 'graded') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bài tập này chưa mở hiển thị đáp án đúng.');
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'question_id', q.id,
    'correct_answer', k.correct_answer,
    'accepted_answers', k.accepted_answers
  )) INTO v_res
  FROM public.academic_exercise_questions q
  JOIN app_private.academic_answer_keys k ON k.question_id = q.id
  WHERE q.exercise_id = v_ex.id;

  RETURN jsonb_build_object('success', true, 'answers', v_res);
END;
$$;

-- REVOKE VÀ GRANT PERMISSIONS RPC
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
