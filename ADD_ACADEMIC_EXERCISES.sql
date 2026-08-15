-- ============================================================================
-- FILE MIGRATION CSDL HỆ THỐNG BÀI TẬP HỌC THUẬT (ACADEMIC EXERCISES)
-- TÁCH HOÀN TOÀN ĐÁP ÁN TRẮC NGHIỆM SANG SCHEMA PRIVACY APP_PRIVATE
-- QUẢN LÝ BÀI TẬP 8 DẠNG CÂU HỎI, TỰ CHẤM TRẮC NGHIỆM VÀ GIÁO VIÊN CHẤM TỰ LUẬN
-- ============================================================================

BEGIN;

-- 1. TẠO PRIVATE SCHEMA ĐỂ BẢO VỆ ĐÁP ÁN BÍ MẬT KHÔNG BỊ HỌC SINH SELECT
CREATE SCHEMA IF NOT EXISTS app_private;

-- 2. BẢNG QUẢN LÝ BÀI TẬP HỌC THUẬT (PUBLIC.ACADEMIC_EXERCISES)
CREATE TABLE IF NOT EXISTS public.academic_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  class_name TEXT NOT NULL, -- Ví dụ: "Lớp 1A", "Lớp 2B" hoặc "ALL"
  grade_level INT NOT NULL DEFAULT 1,
  subject TEXT NOT NULL DEFAULT 'Toán',
  title TEXT NOT NULL,
  description TEXT,
  exercise_type TEXT NOT NULL DEFAULT 'mixed', -- single_choice, multiple_choice, fill_blank, short_answer, essay, image_upload, file_upload, mixed
  status TEXT NOT NULL DEFAULT 'draft', -- draft, published, closed, archived
  due_date TIMESTAMPTZ,
  max_attempts INT DEFAULT 1,
  reward_stars INT DEFAULT 10,
  show_score_after_submit BOOLEAN DEFAULT TRUE,
  show_correct_answers BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. BẢNG CÂU HỎI BÀI TẬP (PUBLIC.ACADEMIC_EXERCISE_QUESTIONS) - CHỈ CHỨA CÂU HỎI & CÁC LỰA CHỌN CÔNG KHAI
CREATE TABLE IF NOT EXISTS public.academic_exercise_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id UUID NOT NULL REFERENCES public.academic_exercises(id) ON DELETE CASCADE,
  question_number INT NOT NULL,
  question_type TEXT NOT NULL, -- single_choice, multiple_choice, fill_blank, short_answer, essay, image_upload, file_upload
  prompt TEXT NOT NULL,
  options_json JSONB DEFAULT '[]'::jsonb, -- Danh sách các lựa chọn trắc nghiệm (không chứa cờ đáp án đúng)
  points INT DEFAULT 10,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. BẢNG BÍ MẬT LƯU ĐÁP ÁN ĐÚNG TRONG SCHEMA PRIVATE (APP_PRIVATE.ACADEMIC_ANSWER_KEYS)
CREATE TABLE IF NOT EXISTS app_private.academic_answer_keys (
  question_id UUID PRIMARY KEY REFERENCES public.academic_exercise_questions(id) ON DELETE CASCADE,
  correct_answer JSONB NOT NULL, -- Đáp án đúng: "A", ["A", "C"], "15", "con mèo"
  accepted_answers JSONB DEFAULT '[]'::jsonb, -- Danh sách các từ chấp nhận được cho điền từ/trả lời ngắn
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
  attempt_number INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'submitted', -- draft, submitted, pending_manual_grade, graded, revision_requested
  objective_score INT DEFAULT 0,
  manual_score INT DEFAULT 0,
  total_score INT DEFAULT 0,
  max_score INT DEFAULT 100,
  teacher_feedback TEXT,
  revision_notes TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  graded_at TIMESTAMPTZ,
  graded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reward_stars_awarded INT DEFAULT 0,
  reward_applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. BẢNG CÂU TRẢ LỜI CHI TIẾT CỦA BÀI NỘP (PUBLIC.ACADEMIC_SUBMISSION_ANSWERS)
CREATE TABLE IF NOT EXISTS public.academic_submission_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES public.academic_submissions(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.academic_exercise_questions(id) ON DELETE CASCADE,
  student_answer_json JSONB, -- Câu trả lời của học sinh
  file_url TEXT, -- Đường dẫn file PDF/DOCX/Ảnh nộp
  points_earned INT DEFAULT 0,
  is_correct BOOLEAN DEFAULT FALSE,
  teacher_comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- PHÂN QUYỀN VÀ BẢO MẬT RLS (ROW LEVEL SECURITY)
-- ============================================================================

-- BẬT RLS CHO CÁC BẢNG PUBLIC
ALTER TABLE public.academic_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_exercise_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_submission_answers ENABLE ROW LEVEL SECURITY;

-- KHÓA HOÀN TOÀN BẢNG APP_PRIVATE NÓI KHÔNG VỚI CHẶN HỌC SINH/ANON SELECT ĐÁP ÁN
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM PUBLIC, anon, authenticated;

-- RLS POLICIES CHO PUBLIC.ACADEMIC_EXERCISES
CREATE POLICY "Academic exercises select policy" ON public.academic_exercises
FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  OR (teacher_id = auth.uid())
  OR (
    status = 'published' AND EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND (class_name = academic_exercises.class_name OR academic_exercises.class_name = 'ALL')
    )
  )
);

CREATE POLICY "Academic exercises insert/update/delete policy" ON public.academic_exercises
FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  OR (teacher_id = auth.uid())
);

-- RLS POLICIES CHO PUBLIC.ACADEMIC_EXERCISE_QUESTIONS
CREATE POLICY "Academic questions select policy" ON public.academic_exercise_questions
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.academic_exercises e 
    WHERE e.id = exercise_id AND (
      EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
      OR e.teacher_id = auth.uid()
      OR (e.status = 'published')
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
    )
  )
);

-- RLS POLICIES CHO PUBLIC.ACADEMIC_SUBMISSIONS
CREATE POLICY "Academic submissions select policy" ON public.academic_submissions
FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  OR (student_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.academic_exercises e 
    WHERE e.id = exercise_id AND (e.teacher_id = auth.uid())
  )
);

CREATE POLICY "Academic submissions insert/update policy" ON public.academic_submissions
FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  OR (student_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.academic_exercises e 
    WHERE e.id = exercise_id AND (e.teacher_id = auth.uid())
  )
);

-- RLS POLICIES CHO PUBLIC.ACADEMIC_SUBMISSION_ANSWERS
CREATE POLICY "Academic submission answers select policy" ON public.academic_submission_answers
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.academic_submissions s 
    WHERE s.id = submission_id AND (
      EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
      OR s.student_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.academic_exercises e WHERE e.id = s.exercise_id AND e.teacher_id = auth.uid())
    )
  )
);

CREATE POLICY "Academic submission answers write policy" ON public.academic_submission_answers
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.academic_submissions s 
    WHERE s.id = submission_id AND (
      EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
      OR s.student_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.academic_exercises e WHERE e.id = s.exercise_id AND e.teacher_id = auth.uid())
    )
  )
);

-- ============================================================================
-- CÁC RPC SECURITY DEFINER AN TOÀN ĐỂ THỰC THI CHẤM ĐIỂM & QUẢN LÝ ĐÁP ÁN PRIVATE
-- ============================================================================

-- 1. RPC LƯU BÀI TẬP, CÂU HỎI VÀ ĐÁP ÁN BÍ MẬT (DÀNH CHO GIÁO VIÊN / ADMIN)
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
  v_user_id UUID;
  v_user_role TEXT;
  v_exercise_id UUID;
  v_q RECORD;
  v_q_id UUID;
  v_q_json JSONB;
  v_key_json JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_user_role FROM public.profiles WHERE id = v_user_id;

  -- Kiểm tra quyền Admin / Giáo viên
  IF v_user_role NOT IN ('admin', 'teacher') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Không có quyền tạo bài tập.');
  END IF;

  -- Tạo hoặc cập nhật Bài tập
  IF (p_exercise->>'id') IS NOT NULL AND (p_exercise->>'id') != '' THEN
    v_exercise_id := (p_exercise->>'id')::UUID;
    UPDATE public.academic_exercises
    SET
      title = p_exercise->>'title',
      description = p_exercise->>'description',
      class_name = p_exercise->>'class_name',
      grade_level = (p_exercise->>'grade_level')::INT,
      subject = p_exercise->>'subject',
      exercise_type = COALESCE(p_exercise->>'exercise_type', 'mixed'),
      status = COALESCE(p_exercise->>'status', 'draft'),
      due_date = CASE WHEN (p_exercise->>'due_date') IS NOT NULL AND (p_exercise->>'due_date') != '' THEN (p_exercise->>'due_date')::TIMESTAMPTZ ELSE NULL END,
      max_attempts = COALESCE((p_exercise->>'max_attempts')::INT, 1),
      reward_stars = COALESCE((p_exercise->>'reward_stars')::INT, 10),
      show_score_after_submit = COALESCE((p_exercise->>'show_score_after_submit')::BOOLEAN, TRUE),
      show_correct_answers = COALESCE((p_exercise->>'show_correct_answers')::BOOLEAN, FALSE),
      updated_at = NOW()
    WHERE id = v_exercise_id AND (v_user_role = 'admin' OR teacher_id = v_user_id);
  ELSE
    INSERT INTO public.academic_exercises (
      teacher_id, class_name, grade_level, subject, title, description, exercise_type, status, due_date, max_attempts, reward_stars, show_score_after_submit, show_correct_answers
    ) VALUES (
      v_user_id,
      p_exercise->>'class_name',
      COALESCE((p_exercise->>'grade_level')::INT, 1),
      COALESCE(p_exercise->>'subject', 'Toán'),
      p_exercise->>'title',
      p_exercise->>'description',
      COALESCE(p_exercise->>'exercise_type', 'mixed'),
      COALESCE(p_exercise->>'status', 'draft'),
      CASE WHEN (p_exercise->>'due_date') IS NOT NULL AND (p_exercise->>'due_date') != '' THEN (p_exercise->>'due_date')::TIMESTAMPTZ ELSE NULL END,
      COALESCE((p_exercise->>'max_attempts')::INT, 1),
      COALESCE((p_exercise->>'reward_stars')::INT, 10),
      COALESCE((p_exercise->>'show_score_after_submit')::BOOLEAN, TRUE),
      COALESCE((p_exercise->>'show_correct_answers')::BOOLEAN, FALSE)
    ) RETURNING id INTO v_exercise_id;
  END IF;

  -- Xóa câu hỏi cũ và đáp án cũ để nạp lại mảng mới
  DELETE FROM public.academic_exercise_questions WHERE exercise_id = v_exercise_id;

  -- Nạp từng câu hỏi và đáp án bí mật sang app_private.academic_answer_keys
  FOR v_q_json IN SELECT * FROM jsonb_array_elements(p_questions)
  LOOP
    INSERT INTO public.academic_exercise_questions (
      exercise_id, question_number, question_type, prompt, options_json, points
    ) VALUES (
      v_exercise_id,
      COALESCE((v_q_json->>'question_number')::INT, 1),
      v_q_json->>'question_type',
      v_q_json->>'prompt',
      COALESCE(v_q_json->'options_json', '[]'::jsonb),
      COALESCE((v_q_json->>'points')::INT, 10)
    ) RETURNING id INTO v_q_id;

    -- Lưu đáp án bí mật vào app_private.academic_answer_keys nếu có
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

  RETURN jsonb_build_object('success', true, 'exercise_id', v_exercise_id, 'message', 'Lưu bài tập và đáp án an toàn thành công.');
END;
$$;


-- 2. RPC NỘP BÀI TẬP VÀ TỰ ĐỘNG CHẤM TRẮC NGHIỆM SERVER-SIDE
CREATE OR REPLACE FUNCTION public.submit_academic_exercise(
  p_exercise_id UUID,
  p_answers JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_student_id UUID;
  v_ex RECORD;
  v_existing_attempts INT;
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
  v_reward_stars INT := 0;
BEGIN
  v_student_id := auth.uid();
  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  -- 1. Lấy thông tin bài tập
  SELECT * INTO v_ex FROM public.academic_exercises WHERE id = p_exercise_id;
  IF v_ex.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bài tập không tồn tại.');
  END IF;

  IF v_ex.status != 'published' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bài tập này hiện không mở nộp bài.');
  END IF;

  -- 2. Kiểm tra số lượt nộp max_attempts
  SELECT COUNT(*) INTO v_existing_attempts 
  FROM public.academic_submissions 
  WHERE exercise_id = p_exercise_id AND student_id = v_student_id AND status != 'draft';

  IF v_existing_attempts >= COALESCE(v_ex.max_attempts, 1) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bé đã dùng hết số lượt nộp bài cho phép.');
  END IF;

  -- 3. Tạo bản ghi Submission mới
  INSERT INTO public.academic_submissions (
    exercise_id, student_id, attempt_number, status, max_score
  ) VALUES (
    p_exercise_id, v_student_id, v_existing_attempts + 1, 'submitted', 100
  ) RETURNING id INTO v_submission_id;

  -- 4. Duyệt qua từng câu hỏi của bài tập để tự động chấm trắc nghiệm
  FOR v_q IN SELECT * FROM public.academic_exercise_questions WHERE exercise_id = p_exercise_id ORDER BY question_number ASC
  LOOP
    v_max_score := v_max_score + COALESCE(v_q.points, 10);
    
    -- Lấy câu trả lời của học sinh từ p_answers
    SELECT value INTO v_ans_item FROM jsonb_array_elements(p_answers) WHERE (value->>'question_id')::UUID = v_q.id;
    v_student_ans := v_ans_item->'answer';
    v_file_url := v_ans_item->>'file_url';

    v_is_correct := FALSE;
    v_points_earned := 0;

    -- Nếu là dạng câu hỏi trắc nghiệm / điền từ tự chấm
    IF v_q.question_type IN ('single_choice', 'multiple_choice', 'fill_blank') THEN
      SELECT * INTO v_key FROM app_private.academic_answer_keys WHERE question_id = v_q.id;

      IF v_key.question_id IS NOT NULL THEN
        IF v_q.question_type = 'single_choice' THEN
          IF (v_student_ans#>>'{}') = (v_key.correct_answer#>>'{}') THEN
            v_is_correct := TRUE;
          END IF;
        ELSIF v_q.question_type = 'multiple_choice' THEN
          -- Kiểm tra mảng đáp án không phụ thuộc thứ tự
          IF (SELECT jsonb_agg(elem ORDER BY elem) FROM jsonb_array_elements_text(v_student_ans) elem) =
             (SELECT jsonb_agg(elem ORDER BY elem) FROM jsonb_array_elements_text(v_key.correct_answer) elem) THEN
            v_is_correct := TRUE;
          END IF;
        ELSIF v_q.question_type = 'fill_blank' THEN
          IF v_key.case_sensitive THEN
            IF LOWER(TRIM(v_student_ans#>>'{}')) = LOWER(TRIM(v_key.correct_answer#>>'{}')) THEN
              v_is_correct := TRUE;
            END IF;
          ELSE
            IF LOWER(TRIM(v_student_ans#>>'{}')) = LOWER(TRIM(v_key.correct_answer#>>'{}')) THEN
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
      -- Là dạng câu tự luận / nộp file -> Cần Giáo viên chấm thủ công
      v_has_subjective := TRUE;
    END IF;

    -- Lưu chi tiết câu trả lời vào public.academic_submission_answers
    INSERT INTO public.academic_submission_answers (
      submission_id, question_id, student_answer_json, file_url, points_earned, is_correct
    ) VALUES (
      v_submission_id, v_q.id, v_student_ans, v_file_url, v_points_earned, v_is_correct
    );
  END LOOP;

  -- 5. Đánh giá trạng thái bài nộp
  IF v_has_subjective THEN
    v_status := 'pending_manual_grade';
  ELSE
    v_status := 'graded';
    v_reward_stars := COALESCE(v_ex.reward_stars, 10);
  END IF;

  -- Cập nhật tổng điểm bài nộp
  UPDATE public.academic_submissions
  SET
    status = v_status,
    objective_score = v_obj_score,
    total_score = v_obj_score,
    max_score = GREATEST(v_max_score, 10),
    graded_at = CASE WHEN v_status = 'graded' THEN NOW() ELSE NULL END,
    reward_stars_awarded = CASE WHEN v_status = 'graded' THEN v_reward_stars ELSE 0 END,
    reward_applied_at = CASE WHEN v_status = 'graded' THEN NOW() ELSE NULL END
  WHERE id = v_submission_id;

  -- Nếu bài hoàn toàn tự động đã graded -> Cộng sao vào profile học sinh server-side
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
    'message', CASE WHEN v_status = 'graded' THEN 'Nộp bài và tự động chấm điểm thành công!' ELSE 'Đã nộp bài thành công! Bài làm đang chờ Giáo viên chấm phần tự luận.' END
  );
END;
$$;


-- 3. RPC GIÁO VIÊN CHẤM ĐIỂM THỦ CÔNG & DUYỆT BÀI NỘP (CỘNG SAO AN TOÀN)
CREATE OR REPLACE FUNCTION public.grade_academic_submission(
  p_submission_id UUID,
  p_manual_grades JSONB, -- Mảng [{question_id, points_earned, teacher_comment}]
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
  v_total_manual INT := 0;
  v_new_status TEXT;
  v_stars_to_award INT := 0;
BEGIN
  v_teacher_id := auth.uid();
  IF v_teacher_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_teacher_id;

  -- 1. Lấy thông tin submission
  SELECT * INTO v_sub FROM public.academic_submissions WHERE id = p_submission_id;
  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bài nộp không tồn tại.');
  END IF;

  SELECT * INTO v_ex FROM public.academic_exercises WHERE id = v_sub.exercise_id;

  -- Kiểm tra quyền Giáo viên / Admin
  IF v_role != 'admin' AND (v_ex.teacher_id != v_teacher_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Không có quyền chấm bài nộp này.');
  END IF;

  -- 2. Cập nhật điểm thủ công cho từng câu hỏi
  IF p_manual_grades IS NOT NULL AND jsonb_array_length(p_manual_grades) > 0 THEN
    FOR v_grade_item IN SELECT * FROM jsonb_array_elements(p_manual_grades)
    LOOP
      UPDATE public.academic_submission_answers
      SET
        points_earned = (v_grade_item->>'points_earned')::INT,
        teacher_comment = v_grade_item->>'teacher_comment'
      WHERE submission_id = p_submission_id AND question_id = (v_grade_item->>'question_id')::UUID;

      v_total_manual := v_total_manual + COALESCE((v_grade_item->>'points_earned')::INT, 0);
    END LOOP;
  ELSE
    SELECT COALESCE(SUM(points_earned), 0) INTO v_total_manual 
    FROM public.academic_submission_answers 
    WHERE submission_id = p_submission_id;
  END IF;

  -- 3. Xác định trạng thái mới
  IF p_request_revision THEN
    v_new_status := 'revision_requested';
  ELSE
    v_new_status := 'graded';
  END IF;

  -- Kiểm tra cộng sao lần đầu khi chuyển sang graded
  IF v_new_status = 'graded' AND v_sub.reward_applied_at IS NULL THEN
    v_stars_to_award := COALESCE(v_ex.reward_stars, 10);
  END IF;

  -- 4. Cập nhật bài nộp
  UPDATE public.academic_submissions
  SET
    status = v_new_status,
    manual_score = v_total_manual,
    total_score = COALESCE(objective_score, 0) + v_total_manual,
    teacher_feedback = p_teacher_feedback,
    graded_at = NOW(),
    graded_by = v_teacher_id,
    reward_stars_awarded = COALESCE(reward_stars_awarded, 0) + v_stars_to_award,
    reward_applied_at = CASE WHEN v_stars_to_award > 0 THEN NOW() ELSE reward_applied_at END
  WHERE id = p_submission_id;

  -- 5. Cộng sao vào profile học sinh nếu vừa hoàn tất chấm lần đầu
  IF v_stars_to_award > 0 THEN
    UPDATE public.profiles
    SET total_stars = COALESCE(total_stars, 0) + v_stars_to_award
    WHERE id = v_sub.student_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', v_new_status,
    'total_score', COALESCE(v_sub.objective_score, 0) + v_total_manual,
    'stars_awarded', v_stars_to_award,
    'message', CASE WHEN p_request_revision THEN 'Đã gửi yêu cầu học sinh làm lại bài.' ELSE 'Đã lưu điểm và nhận xét bài nộp thành công!' END
  );
END;
$$;

COMMIT;
