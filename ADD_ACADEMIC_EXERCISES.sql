-- ============================================================================
-- MIGRATION CSDL HỆ THỐNG BÀI TẬP HỌC THUẬT (ACADEMIC EXERCISES) - PHIÊN BẢN 15.8 STRICT CONVALIDATED FAIL-CLOSED & CLAIM PREVIOUS STATUS
-- 1. KIỂM TRA STATUS IS NULL HOẶC KHÔNG HỢP LỆ VÀ KÍCH HOẠT THẤT BẠI FAIL-CLOSED
-- 2. XÁC MINH CẬP NHẬT CONSTRAINT THÀNH CÔNG VỚI CONVALIDATED = TRUE VÀ ATTNOTNULL = TRUE
-- 3. NÂNG CẤP RPC CLAIM_EXERCISE_FILE_CLEANUP_JOB TRẢ VỀ PREVIOUS_STATUS CHO EDGE FUNCTION PHÂN BIỆT NHÁNH XỬ LÝ
-- 4. BỐ TRÍ DÀNH RIÊNG QUYỀN WORKER VÀ ADMIN TRÊN CÁC RPC SECURITY DEFINER CHUẨN XÁC
-- ============================================================================

BEGIN;

-- 1. SCHEMA PRIVACY APP_PRIVATE
CREATE SCHEMA IF NOT EXISTS app_private;

-- DROP FUNCTION IF EXISTS VỚI MỌI CHỮ KÝ RPC CŨ VÀ MỚI MÀ KHÔNG GỌI REVOKE TRƯỚC ĐÓ
DROP FUNCTION IF EXISTS public.claim_exercise_file_cleanup_job(UUID);
DROP FUNCTION IF EXISTS public.claim_exercise_file_cleanup_job(UUID, UUID);
DROP FUNCTION IF EXISTS public.finish_exercise_file_cleanup_job(UUID, INT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.finish_exercise_file_cleanup_job(UUID, INT, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.reconcile_exercise_file_cleanup_job(UUID, INT, UUID);
DROP FUNCTION IF EXISTS public.admin_retry_pending_cleanup_jobs(INT);
DROP FUNCTION IF EXISTS public.reset_cleanup_jobs_for_retry(INT);
DROP FUNCTION IF EXISTS public.delete_unreferenced_submission_files(TEXT[]);

-- 2. BẢNG HÀNG ĐỢI CLEANUP FILE BẢO MẬT
CREATE TABLE IF NOT EXISTS public.exercise_file_cleanup_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT NOT NULL DEFAULT 'exercise-submissions',
  file_path TEXT NOT NULL UNIQUE,
  requested_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- KHOẢNG KIỂM TRA DỮ LIỆU STATUS HIỆN CÓ VÀ CẬP NHẬT CONSTRAINT FAIL-CLOSED (STRICT CONVALIDATED & ATTNOTNULL)
DO $$
DECLARE
  v_invalid_count INT := 0;
  v_invalid_statuses JSONB := '[]'::jsonb;
  v_is_validated BOOLEAN := FALSE;
  v_is_not_null BOOLEAN := FALSE;
BEGIN
  SELECT COUNT(*), jsonb_agg(DISTINCT status)
  INTO v_invalid_count, v_invalid_statuses
  FROM public.exercise_file_cleanup_jobs
  WHERE status IS NULL
     OR status NOT IN ('pending', 'processing', 'deleted', 'still_referenced', 'failed', 'permanent_failed', 'storage_deleted_job_update_failed', 'reconciliation_pending');

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'MIGRATION BỊ DỪNG FAIL-CLOSED: Phát hiện % bản ghi có status NULL hoặc không hợp lệ: %', v_invalid_count, v_invalid_statuses;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public' AND t.relname = 'exercise_file_cleanup_jobs' AND c.conname = 'exercise_file_cleanup_jobs_status_check'
  ) THEN
    ALTER TABLE public.exercise_file_cleanup_jobs DROP CONSTRAINT exercise_file_cleanup_jobs_status_check;
  END IF;

  ALTER TABLE public.exercise_file_cleanup_jobs
  ADD CONSTRAINT exercise_file_cleanup_jobs_status_check
  CHECK (status IN ('pending', 'processing', 'deleted', 'still_referenced', 'failed', 'permanent_failed', 'storage_deleted_job_update_failed', 'reconciliation_pending'));

  SELECT c.convalidated INTO v_is_validated
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public' AND t.relname = 'exercise_file_cleanup_jobs' AND c.conname = 'exercise_file_cleanup_jobs_status_check';

  SELECT a.attnotnull INTO v_is_not_null
  FROM pg_attribute a
  JOIN pg_class t ON a.attrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public' AND t.relname = 'exercise_file_cleanup_jobs' AND a.attname = 'status';

  IF v_is_validated IS NOT TRUE OR v_is_not_null IS NOT TRUE THEN
    RAISE EXCEPTION 'MIGRATION BỊ DỪNG FAIL-CLOSED: Constraint status_check không được convalidated=true hoặc cột status không phải NOT NULL.';
  END IF;
END $$;

-- 3. BẢNG PUBLIC.ACADEMIC_EXERCISES
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
  max_attempts INT DEFAULT 1 CHECK (max_attempts BETWEEN 1 AND 100),
  reward_stars INT DEFAULT 10 CHECK (reward_stars BETWEEN 0 AND 1000),
  show_score_after_submit BOOLEAN DEFAULT TRUE,
  show_correct_answers BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- MIGRATION NÂNG CẤP CỘT CLASS_ID THAM CHIẾU PUBLIC.CLASSES(ID)
ALTER TABLE public.academic_exercises ADD COLUMN IF NOT EXISTS class_id UUID REFERENCES public.classes(id) ON DELETE CASCADE;
ALTER TABLE public.academic_exercises ADD COLUMN IF NOT EXISTS is_global BOOLEAN DEFAULT FALSE;

-- UNIFIED CANDIDATE CTE PRE-CHECK MIGRATION
DO $$
DECLARE
  v_ambiguous_json JSONB;
  v_unmapped_json JSONB;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'academic_exercises' AND column_name = 'class_name'
  ) THEN
    
    WITH ClassCandidates AS (
      SELECT 
        e.id AS exercise_id,
        e.title,
        e.class_name,
        e.is_global,
        COUNT(c.id) AS matched_count,
        jsonb_agg(jsonb_build_object('class_id', c.id, 'class_name', c.name, 'teacher_id', c.teacher_id)) FILTER (WHERE c.id IS NOT NULL) AS candidates
      FROM public.academic_exercises e
      LEFT JOIN public.classes c ON 
        e.class_name = c.name
        AND (e.grade_level IS NULL OR e.grade_level = c.grade_level)
        AND (e.teacher_id IS NULL OR e.teacher_id = c.teacher_id)
      WHERE e.class_id IS NULL AND e.is_global IS NOT TRUE
      GROUP BY e.id, e.title, e.class_name, e.is_global
    )
    SELECT 
      jsonb_agg(jsonb_build_object('exercise_id', exercise_id, 'title', title, 'class_name', class_name, 'matched_count', matched_count, 'candidates', candidates)) FILTER (WHERE matched_count > 1),
      jsonb_agg(jsonb_build_object('exercise_id', exercise_id, 'title', title, 'class_name', class_name)) FILTER (WHERE matched_count = 0)
    INTO v_ambiguous_json, v_unmapped_json
    FROM ClassCandidates;

    IF v_ambiguous_json IS NOT NULL AND jsonb_array_length(v_ambiguous_json) > 0 THEN
      RAISE EXCEPTION 'MIGRATION BỊ DỪNG: Phát hiện danh sách bài tập khớp với nhiều hơn 1 Lớp học mơ hồ: %', v_ambiguous_json;
    END IF;

    IF v_unmapped_json IS NOT NULL AND jsonb_array_length(v_unmapped_json) > 0 THEN
      RAISE EXCEPTION 'MIGRATION BỊ DỪNG: Phát hiện các bài tập không tìm thấy Lớp học tương ứng: %', v_unmapped_json;
    END IF;

    UPDATE public.academic_exercises e
    SET class_id = c.id
    FROM public.classes c
    WHERE e.class_id IS NULL 
      AND e.class_name = c.name 
      AND (e.grade_level IS NULL OR e.grade_level = c.grade_level)
      AND (e.teacher_id IS NULL OR e.teacher_id = c.teacher_id);

    IF NOT EXISTS (
      SELECT 1 FROM public.academic_exercises 
      WHERE class_id IS NULL AND is_global IS NOT TRUE
    ) THEN
      ALTER TABLE public.academic_exercises DROP COLUMN IF EXISTS class_name;
    END IF;

  END IF;
END $$;

-- CONSTRAINT BẢO ĐẢM IS_GLOBAL BÀI TẬP
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

-- 4. BẢNG CÂU HỎI PUBLIC.ACADEMIC_EXERCISE_QUESTIONS
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

-- 5. BẢNG ĐÁP ÁN BÍ MẬT APP_PRIVATE.ACADEMIC_ANSWER_KEYS
CREATE TABLE IF NOT EXISTS app_private.academic_answer_keys (
  question_id UUID PRIMARY KEY REFERENCES public.academic_exercise_questions(id) ON DELETE CASCADE,
  correct_answer JSONB NOT NULL,
  accepted_answers JSONB DEFAULT '[]'::jsonb,
  case_sensitive BOOLEAN DEFAULT FALSE,
  grading_config JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. BẢNG BÀI NỘP PUBLIC.ACADEMIC_SUBMISSIONS
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

-- 7. BẢNG CÂU TRẢ LỜI PUBLIC.ACADEMIC_SUBMISSION_ANSWERS
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

-- STORAGE BUCKET PRIVATE EXERCISE-SUBMISSIONS
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

-- RLS ON PUBLIC TABLES
ALTER TABLE public.academic_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_exercise_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_submission_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercise_file_cleanup_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Academic exercises select policy" ON public.academic_exercises;
DROP POLICY IF EXISTS "Academic questions select policy" ON public.academic_exercise_questions;
DROP POLICY IF EXISTS "Academic submissions select policy" ON public.academic_submissions;
DROP POLICY IF EXISTS "Academic submission answers select policy" ON public.academic_submission_answers;
DROP POLICY IF EXISTS "Exercise file cleanup jobs select policy" ON public.exercise_file_cleanup_jobs;

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

CREATE POLICY "Academic submissions select policy" ON public.academic_submissions
FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  OR student_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.academic_exercises e 
    JOIN public.classes c ON c.id = e.class_id
    WHERE e.id = s.exercise_id AND (e.teacher_id = auth.uid() OR c.teacher_id = auth.uid())
  )
);

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

CREATE POLICY "Exercise file cleanup jobs select policy" ON public.exercise_file_cleanup_jobs
FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  OR requested_by = auth.uid()
);

-- STORAGE POLICIES
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

-- 1. RPC QUEUE_FILE_CLEANUP CHUẨN HÓA VỚI RESET BIẾN VÒNG LẶP VÀ RETURNING
CREATE OR REPLACE FUNCTION public.queue_file_cleanup(
  p_paths TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_path TEXT;
  v_raw_path TEXT;
  v_jobs JSONB := '[]'::jsonb;
  v_rejected TEXT[] := ARRAY[]::TEXT[];
  v_processing TEXT[] := ARRAY[]::TEXT[];
  v_inserted_id UUID;
  v_inserted_path TEXT;
  v_dedup_paths TEXT[] := ARRAY[]::TEXT[];
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;

  IF p_paths IS NULL OR array_length(p_paths, 1) = 0 THEN
    RETURN jsonb_build_object('success', true, 'jobs', '[]'::jsonb, 'rejected', '[]'::jsonb, 'already_processing', '[]'::jsonb);
  END IF;

  IF array_length(p_paths, 1) > 50 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Vượt quá giới hạn tối đa 50 đường dẫn file mỗi lần yêu cầu.');
  END IF;

  -- Chuẩn hóa và loại bỏ trùng lặp
  FOREACH v_raw_path IN ARRAY p_paths
  LOOP
    IF v_raw_path IS NOT NULL THEN
      v_path := trim(v_raw_path);
      IF length(v_path) > 0 AND NOT (v_path = ANY(v_dedup_paths)) THEN
        v_dedup_paths := array_append(v_dedup_paths, v_path);
      END IF;
    END IF;
  END LOOP;

  FOREACH v_path IN ARRAY v_dedup_paths
  LOOP
    -- RESET BẮT BỘC BIẾN RETURNING Ở ĐẦU MỖI VÒNG LẶP
    v_inserted_id := NULL;
    v_inserted_path := NULL;

    -- Kiểm tra path hợp lệ
    IF v_path IS NULL OR length(v_path) = 0 OR length(v_path) > 500 OR v_path LIKE '/%' OR v_path LIKE '%..%' THEN
      v_rejected := array_append(v_rejected, v_path);
      CONTINUE;
    END IF;

    IF v_caller_role != 'admin' AND NOT (v_path LIKE v_caller_id::text || '/%') THEN
      v_rejected := array_append(v_rejected, v_path);
      CONTINUE;
    END IF;

    -- Thực hiện INSERT / UPDATE với RETURNING ID thực tế khi không ở trạng thái processing
    INSERT INTO public.exercise_file_cleanup_jobs (
      bucket_id, file_path, requested_by, status, attempts, last_error, processed_at
    ) VALUES (
      'exercise-submissions', v_path, v_caller_id, 'pending', 0, NULL, NULL
    )
    ON CONFLICT (file_path) DO UPDATE SET
      requested_by = EXCLUDED.requested_by,
      status = 'pending',
      last_error = NULL,
      processed_at = NULL,
      created_at = NOW()
    WHERE public.exercise_file_cleanup_jobs.status != 'processing'
    RETURNING id, file_path INTO v_inserted_id, v_inserted_path;

    IF v_inserted_id IS NOT NULL THEN
      v_jobs := v_jobs || jsonb_build_array(jsonb_build_object('id', v_inserted_id, 'file_path', v_inserted_path));
    ELSE
      v_processing := array_append(v_processing, v_path);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'jobs', v_jobs,
    'rejected', to_jsonb(v_rejected),
    'already_processing', to_jsonb(v_processing)
  );
END;
$$;


-- 2. RPC CLAIM_EXERCISE_FILE_CLEANUP_JOB DÀNH RIÊNG CHO SERVICE_ROLE TRẢ VỀ PREVIOUS_STATUS
CREATE OR REPLACE FUNCTION public.claim_exercise_file_cleanup_job(
  p_job_id UUID,
  p_requesting_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_role TEXT;
  v_job RECORD;
BEGIN
  -- CHỈ SERVICE_ROLE MỚI ĐƯỢC PHÉP GỌI RPC NÀY (FAIL-CLOSED JWT ROLE CHECK)
  IF COALESCE(auth.jwt()->>'role', '') != 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'unauthorized_role', 'message', 'Lỗi: RPC này chỉ dành riêng cho service_role.');
  END IF;

  IF p_requesting_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'missing_user_id', 'message', 'Lỗi: Thiếu ID người dùng yêu cầu.');
  END IF;

  SELECT role INTO v_user_role FROM public.profiles WHERE id = p_requesting_user_id;
  IF v_user_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'missing_profile', 'message', 'Lỗi: Profile người dùng không tồn tại.');
  END IF;

  WITH candidate AS (
    SELECT id, status AS prev_status
    FROM public.exercise_file_cleanup_jobs
    WHERE id = p_job_id
      AND bucket_id = 'exercise-submissions'
      AND attempts < 5
      AND (
        v_user_role = 'admin' OR requested_by = p_requesting_user_id
      )
      AND (
        status IN ('pending', 'failed', 'reconciliation_pending')
        OR (status = 'processing' AND (processed_at IS NULL OR processed_at < NOW() - INTERVAL '15 minutes'))
      )
    FOR UPDATE
  ),
  claimed AS (
    UPDATE public.exercise_file_cleanup_jobs j
    SET
      status = 'processing',
      attempts = j.attempts + 1,
      last_error = NULL,
      processed_at = NOW()
    FROM candidate c
    WHERE j.id = c.id
    RETURNING j.*, c.prev_status AS previous_status
  )
  SELECT * INTO v_job FROM claimed;

  IF v_job.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'job', to_jsonb(v_job),
      'previous_status', v_job.previous_status
    );
  END IF;

  -- NẾU UPDATE TRẢ 0 DÒNG -> PHÂN LOẠI CHI TIẾT TỪ CSDL
  SELECT * INTO v_job FROM public.exercise_file_cleanup_jobs WHERE id = p_job_id;
  IF v_job.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'missing_job', 'message', 'Job không tồn tại.');
  END IF;

  IF v_job.bucket_id != 'exercise-submissions' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_bucket', 'message', 'Bucket không hợp lệ.');
  END IF;

  IF v_user_role != 'admin' AND v_job.requested_by != p_requesting_user_id THEN
    RETURN jsonb_build_object('success', false, 'reason', 'unauthorized_owner', 'message', 'Không có quyền xử lý job này.');
  END IF;

  IF v_job.attempts >= 5 THEN
    UPDATE public.exercise_file_cleanup_jobs
    SET status = 'permanent_failed', last_error = 'Max retries (5) exceeded'
    WHERE id = p_job_id;
    RETURN jsonb_build_object('success', false, 'reason', 'permanent_failed_max_retries', 'message', 'Job đã vượt quá số lần thử tối đa (5).');
  END IF;

  IF v_job.status = 'processing' AND (v_job.processed_at IS NOT NULL AND v_job.processed_at >= NOW() - INTERVAL '15 minutes') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_claimed', 'message', 'Job đang được worker khác xử lý.');
  END IF;

  RETURN jsonb_build_object('success', false, 'reason', 'not_claimable', 'message', 'Trạng thái job không thể claim.');
END;
$$;


-- 3. RPC FINISH_EXERCISE_FILE_CLEANUP_JOB DÀNH RIÊNG CHO SERVICE_ROLE
CREATE OR REPLACE FUNCTION public.finish_exercise_file_cleanup_job(
  p_job_id UUID,
  p_expected_attempt INT,
  p_status TEXT,
  p_last_error TEXT,
  p_requesting_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_role TEXT;
  v_updated_rows INT;
  v_job RECORD;
BEGIN
  -- CHỈ SERVICE_ROLE MỚI ĐƯỢC PHÉP GỌI RPC NÀY
  IF COALESCE(auth.jwt()->>'role', '') != 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'unauthorized_role', 'message', 'Lỗi: RPC này chỉ dành riêng cho service_role.');
  END IF;

  IF p_requesting_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'missing_user_id', 'message', 'Lỗi: Thiếu ID người dùng yêu cầu.');
  END IF;

  SELECT role INTO v_user_role FROM public.profiles WHERE id = p_requesting_user_id;
  IF v_user_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'missing_profile', 'message', 'Lỗi: Profile người dùng không tồn tại.');
  END IF;

  IF p_status NOT IN ('deleted', 'still_referenced', 'failed', 'permanent_failed', 'storage_deleted_job_update_failed', 'reconciliation_pending') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_status', 'message', 'Trạng thái đích không hợp lệ.');
  END IF;

  UPDATE public.exercise_file_cleanup_jobs
  SET
    status = p_status,
    last_error = p_last_error,
    processed_at = NOW()
  WHERE id = p_job_id
    AND status = 'processing'
    AND attempts = p_expected_attempt
    AND (
      v_user_role = 'admin'
      OR requested_by = p_requesting_user_id
    );

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
  IF v_updated_rows = 1 THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  -- NẾU UPDATE TRẢ 0 DÒNG -> KIỂM TRA IDEMPOTENT XEM ĐÃ DELETED TỪ TRƯỚC CHƯA
  SELECT * INTO v_job FROM public.exercise_file_cleanup_jobs WHERE id = p_job_id;
  IF v_job.id IS NOT NULL AND v_job.status = 'deleted' THEN
    RETURN jsonb_build_object('success', true, 'already_finished', true, 'status', 'deleted');
  END IF;

  RETURN jsonb_build_object('success', false, 'reason', 'finish_update_zero_rows', 'message', 'Cập nhật hoàn tất job thất bại (0 dòng khớp).');
END;
$$;


-- 4. RPC RECONCILE_EXERCISE_FILE_CLEANUP_JOB XỬ LÝ ĐỐI SOÁT NGUYÊN TỬ IDEMPOTENT
CREATE OR REPLACE FUNCTION public.reconcile_exercise_file_cleanup_job(
  p_job_id UUID,
  p_expected_attempt INT,
  p_requesting_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job RECORD;
  v_user_role TEXT;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') != 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'unauthorized_role', 'message', 'Lỗi: RPC chỉ dành riêng cho service_role.');
  END IF;

  IF p_requesting_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'missing_user_id', 'message', 'Thiếu ID người dùng.');
  END IF;

  SELECT role INTO v_user_role FROM public.profiles WHERE id = p_requesting_user_id;
  IF v_user_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'missing_profile', 'message', 'Profile không tồn tại.');
  END IF;

  SELECT * INTO v_job FROM public.exercise_file_cleanup_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'missing_job', 'message', 'Job không tồn tại.');
  END IF;

  IF v_user_role != 'admin' AND v_job.requested_by != p_requesting_user_id THEN
    RETURN jsonb_build_object('success', false, 'reason', 'unauthorized_owner', 'message', 'Không có quyền đối soát.');
  END IF;

  -- Nếu trạng thái đã là deleted -> Trả về đối soát thành công idempotent
  IF v_job.status = 'deleted' THEN
    RETURN jsonb_build_object('success', true, 'already_finished', true, 'status', 'deleted');
  END IF;

  -- Nếu attempt không phù hợp và status không phải deleted -> Báo stale worker attempt
  IF v_job.attempts != p_expected_attempt THEN
    RETURN jsonb_build_object('success', false, 'reason', 'stale_worker_attempt', 'message', 'Lượt thử worker đã bị thay thế bởi lượt mới.');
  END IF;

  RETURN jsonb_build_object('success', true, 'already_finished', false, 'status', v_job.status, 'attempts', v_job.attempts);
END;
$$;


-- 5. RPC RESET_CLEANUP_JOBS_FOR_RETRY PHÂN LOẠI RECONCILIATION_PENDING VỚI CTE FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION public.reset_cleanup_jobs_for_retry(
  p_limit INT DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_jobs JSONB := '[]'::jsonb;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NOT NULL THEN
    SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  END IF;

  IF COALESCE(auth.jwt()->>'role', '') != 'service_role' AND COALESCE(v_caller_role, '') != 'admin' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn không có quyền thực thi chức năng này.');
  END IF;

  WITH candidates AS (
    SELECT id, status AS prev_status
    FROM public.exercise_file_cleanup_jobs
    WHERE status IN ('failed', 'storage_deleted_job_update_failed')
       OR (status = 'processing' AND (processed_at IS NULL OR processed_at < NOW() - INTERVAL '15 minutes'))
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
  ),
  updated AS (
    UPDATE public.exercise_file_cleanup_jobs j
    SET 
      status = CASE 
        WHEN c.prev_status = 'storage_deleted_job_update_failed' THEN 'reconciliation_pending'
        ELSE 'pending'
      END,
      processed_at = NULL,
      last_error = NULL
    FROM candidates c
    WHERE j.id = c.id
    RETURNING j.id, j.file_path, c.prev_status AS previous_status, j.status AS new_status
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'file_path', file_path,
    'previous_status', previous_status,
    'new_status', new_status
  )), '[]'::jsonb)
  INTO v_jobs
  FROM updated;

  RETURN jsonb_build_object('success', true, 'jobs', v_jobs, 'reset_count', jsonb_array_length(v_jobs));
END;
$$;


-- 6. GET_EXERCISE_FOR_EDIT
CREATE OR REPLACE FUNCTION public.get_exercise_for_edit(
  p_exercise_id UUID
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
  v_questions JSONB := '[]'::jsonb;
  v_sub_count INT := 0;
  v_has_sub BOOLEAN := FALSE;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;

  SELECT * INTO v_ex FROM public.academic_exercises WHERE id = p_exercise_id;
  IF v_ex.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Bài tập không tồn tại.');
  END IF;

  IF v_caller_role != 'admin' AND v_ex.teacher_id != v_caller_id THEN
    IF NOT EXISTS (SELECT 1 FROM public.classes WHERE id = v_ex.class_id AND teacher_id = v_caller_id) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Bạn không có quyền chỉnh sửa bài tập này.');
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_sub_count FROM public.academic_submissions WHERE exercise_id = p_exercise_id;
  IF v_sub_count > 0 THEN
    v_has_sub := TRUE;
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'id', q.id,
    'question_number', q.question_number,
    'question_type', q.question_type,
    'prompt', q.prompt,
    'options_json', q.options_json,
    'points', q.points,
    'correct_answer_key', jsonb_build_object(
      'correct_answer', k.correct_answer,
      'accepted_answers', k.accepted_answers,
      'case_sensitive', k.case_sensitive
    )
  ) ORDER BY q.question_number ASC) INTO v_questions
  FROM public.academic_exercise_questions q
  LEFT JOIN app_private.academic_answer_keys k ON k.question_id = q.id
  WHERE q.exercise_id = p_exercise_id;

  RETURN jsonb_build_object(
    'success', true,
    'exercise', to_jsonb(v_ex),
    'has_submissions', v_has_sub,
    'submission_count', v_sub_count,
    'questions', COALESCE(v_questions, '[]'::jsonb)
  );
END;
$$;


-- 7. CREATE_OR_GET_SUBMISSION_DRAFT
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


-- 8. SAVE_EXERCISE_WITH_QUESTIONS_AND_KEYS VỚI VALIDATION TOÀN DIỆN MỌI TRƯỜNG VÀ DÙNG BIẾN TYPED
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
  v_exercise_id UUID := NULL;
  v_class_id UUID := NULL;
  v_class_teacher UUID;
  v_existing_ex RECORD;
  v_q_json JSONB;
  v_q_id UUID;
  v_key_json JSONB;
  v_has_submissions BOOLEAN := FALSE;
  v_existing_questions_json JSONB;
  v_incoming_questions_json JSONB;
  v_new_status TEXT;
  v_q_type TEXT;
  v_q_num_seen INT[] := ARRAY[]::INT[];
  v_q_num INT;
  v_opts_arr JSONB;
  v_correct_ans JSONB;
  v_opt_item TEXT;
  v_opt_match BOOLEAN;
  v_distinct_opts INT;
  v_num_val NUMERIC;
  
  -- BIẾN TYPED ĐÃ PARSE VÀ VALIDATE CHUẨN XÁC
  v_valid_grade_level INT := 1;
  v_valid_max_attempts INT := 1;
  v_valid_reward_stars INT := 10;
  v_valid_is_global BOOLEAN := FALSE;
  v_valid_due_date TIMESTAMPTZ := NULL;
  v_valid_show_score BOOLEAN := TRUE;
  v_valid_show_answers BOOLEAN := FALSE;
  v_valid_points INT := 10;
BEGIN
  -- =========================================================================
  -- PHASE 1: ZERO-DML VALIDATION PHASE (PARSE AN TOÀN TOÀN BỘ CÁC TRƯỜNG)
  -- =========================================================================
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  IF v_caller_role NOT IN ('admin', 'teacher') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn không có quyền quản lý bài tập.');
  END IF;

  IF p_exercise IS NULL OR jsonb_typeof(p_exercise) != 'object' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Đối tượng p_exercise phải là một JSON object.');
  END IF;

  IF jsonb_typeof(p_questions) != 'array' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Cấu trúc câu hỏi p_questions phải là một mảng JSON.');
  END IF;

  -- 1. Parse an toàn ID Bài tập (nếu có)
  IF (p_exercise->>'id') IS NOT NULL AND length(trim(p_exercise->>'id')) > 0 THEN
    BEGIN
      v_exercise_id := (p_exercise->>'id')::UUID;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Thẻ id bài tập không đúng định dạng UUID.');
    END;
  END IF;

  -- 2. Parse an toàn status
  v_new_status := COALESCE(p_exercise->>'status', 'draft');
  IF v_new_status NOT IN ('draft', 'published', 'closed', 'archived') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Trạng thái bài tập status không hợp lệ.');
  END IF;

  IF v_new_status = 'published' AND jsonb_array_length(p_questions) = 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bài tập trạng thái Xuất bản (published) phải chứa ít nhất 1 câu hỏi.');
  END IF;

  -- 3. Parse an toàn is_global
  IF (p_exercise->'is_global') IS NOT NULL THEN
    IF jsonb_typeof(p_exercise->'is_global') != 'boolean' THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Thẻ is_global phải là kiểu boolean.');
    END IF;
    v_valid_is_global := (p_exercise->>'is_global')::BOOLEAN;
  END IF;

  IF v_valid_is_global AND v_caller_role != 'admin' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Chỉ Admin mới có quyền tạo bài tập chung toàn trường (is_global).');
  END IF;

  -- 4. Parse an toàn class_id
  IF (p_exercise->>'class_id') IS NOT NULL AND length(trim(p_exercise->>'class_id')) > 0 THEN
    BEGIN
      v_class_id := (p_exercise->>'class_id')::UUID;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Thẻ class_id không đúng định dạng UUID.');
    END;

    SELECT teacher_id INTO v_class_teacher FROM public.classes WHERE id = v_class_id;
    IF v_class_teacher IS NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Lớp học được chọn không tồn tại.');
    END IF;

    IF v_caller_role != 'admin' AND v_class_teacher != v_caller_id THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn chỉ được tạo bài tập cho lớp mình phụ trách.');
    END IF;
  ELSE
    IF NOT v_valid_is_global THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bài tập phải gán cho một Lớp học cụ thể.');
    END IF;
  END IF;

  -- 5. Parse an toàn grade_level (1..5)
  IF (p_exercise->'grade_level') IS NOT NULL THEN
    IF jsonb_typeof(p_exercise->'grade_level') != 'number' THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Khối lớp grade_level phải là một số nguyên.');
    END IF;

    BEGIN
      v_num_val := (p_exercise->>'grade_level')::NUMERIC;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Khối lớp grade_level không đúng định dạng số.');
    END;

    IF v_num_val != TRUNC(v_num_val) OR v_num_val < 1 OR v_num_val > 5 THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Khối lớp grade_level phải là số nguyên từ 1 đến 5.');
    END IF;
    v_valid_grade_level := v_num_val::INT;
  END IF;

  -- 6. Parse an toàn max_attempts (1..100)
  IF (p_exercise->'max_attempts') IS NOT NULL THEN
    IF jsonb_typeof(p_exercise->'max_attempts') != 'number' THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Số lượt làm tối đa max_attempts phải là một số nguyên.');
    END IF;

    BEGIN
      v_num_val := (p_exercise->>'max_attempts')::NUMERIC;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Số lượt làm tối đa max_attempts không đúng định dạng số.');
    END;

    IF v_num_val != TRUNC(v_num_val) OR v_num_val < 1 OR v_num_val > 100 THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Số lượt làm tối đa max_attempts phải là số nguyên từ 1 đến 100.');
    END IF;
    v_valid_max_attempts := v_num_val::INT;
  END IF;

  -- 7. Parse an toàn reward_stars (0..1000)
  IF (p_exercise->'reward_stars') IS NOT NULL THEN
    IF jsonb_typeof(p_exercise->'reward_stars') != 'number' THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Số sao thưởng reward_stars phải là một số nguyên.');
    END IF;

    BEGIN
      v_num_val := (p_exercise->>'reward_stars')::NUMERIC;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Số sao thưởng reward_stars không đúng định dạng số.');
    END;

    IF v_num_val != TRUNC(v_num_val) OR v_num_val < 0 OR v_num_val > 1000 THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Số sao thưởng reward_stars phải là số nguyên từ 0 đến 1000.');
    END IF;
    v_valid_reward_stars := v_num_val::INT;
  END IF;

  -- 8. Parse an toàn due_date ISO Timestamp
  IF (p_exercise->>'due_date') IS NOT NULL AND length(trim(p_exercise->>'due_date')) > 0 THEN
    BEGIN
      v_valid_due_date := (p_exercise->>'due_date')::TIMESTAMPTZ;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Thời gian hạn nộp due_date không đúng định dạng ISO timestamp.');
    END;
  END IF;

  -- 9. Parse an toàn show_score_after_submit & show_correct_answers
  IF (p_exercise->'show_score_after_submit') IS NOT NULL THEN
    IF jsonb_typeof(p_exercise->'show_score_after_submit') != 'boolean' THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Thẻ show_score_after_submit phải là kiểu boolean.');
    END IF;
    v_valid_show_score := (p_exercise->>'show_score_after_submit')::BOOLEAN;
  END IF;

  IF (p_exercise->'show_correct_answers') IS NOT NULL THEN
    IF jsonb_typeof(p_exercise->'show_correct_answers') != 'boolean' THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Thẻ show_correct_answers phải là kiểu boolean.');
    END IF;
    v_valid_show_answers := (p_exercise->>'show_correct_answers')::BOOLEAN;
  END IF;

  -- 10. Parse title, subject, description
  IF (p_exercise->>'title') IS NULL OR length(trim(p_exercise->>'title')) = 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Tiêu đề bài tập không được để trống.');
  END IF;

  IF length(p_exercise->>'title') > 200 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Tiêu đề bài tập không được vượt quá 200 ký tự.');
  END IF;

  -- VALIDATE TOÀN BỘ MẢNG CÂU HỎI TRƯỚC KHI XÓA/SỬA BẤT KỲ DỮ LIỆU NÀO
  FOR v_q_json IN SELECT * FROM jsonb_array_elements(p_questions)
  LOOP
    IF (v_q_json->'question_number') IS NULL OR jsonb_typeof(v_q_json->'question_number') != 'number' THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Thẻ question_number phải là một số nguyên.');
    END IF;

    BEGIN
      v_num_val := (v_q_json->>'question_number')::NUMERIC;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Thẻ question_number không đúng định dạng số.');
    END;

    IF v_num_val != TRUNC(v_num_val) OR v_num_val <= 0 THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Thẻ question_number phải là số nguyên dương.');
    END IF;
    v_q_num := v_num_val::INT;

    IF v_q_num = ANY(v_q_num_seen) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Số thứ tự câu hỏi question_number bị trùng lặp.');
    END IF;
    v_q_num_seen := array_append(v_q_num_seen, v_q_num);

    v_q_type := v_q_json->>'question_type';
    IF v_q_type NOT IN ('single_choice', 'multiple_choice', 'fill_blank', 'short_answer', 'essay', 'image_upload', 'file_upload') THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Dạng câu hỏi question_type không hợp lệ.');
    END IF;

    IF (v_q_json->>'prompt') IS NULL OR length(trim(v_q_json->>'prompt')) = 0 THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Nội dung câu hỏi không được để trống.');
    END IF;

    IF length(v_q_json->>'prompt') > 5000 THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Nội dung câu hỏi không được vượt quá 5.000 ký tự.');
    END IF;

    IF (v_q_json->'points') IS NOT NULL THEN
      IF jsonb_typeof(v_q_json->'points') != 'number' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Điểm câu hỏi points phải là một số nguyên.');
      END IF;

      BEGIN
        v_num_val := (v_q_json->>'points')::NUMERIC;
      EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Điểm câu hỏi points không đúng định dạng số.');
      END;

      IF v_num_val != TRUNC(v_num_val) OR v_num_val <= 0 OR v_num_val > 1000 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Điểm câu hỏi points phải là số nguyên từ 1 đến 1000.');
      END IF;
    END IF;

    v_opts_arr := v_q_json->'options_json';
    IF v_q_type IN ('single_choice', 'multiple_choice') THEN
      IF v_opts_arr IS NULL OR jsonb_typeof(v_opts_arr) != 'array' OR jsonb_array_length(v_opts_arr) < 2 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Câu hỏi trắc nghiệm phải có ít nhất 2 lựa chọn trong options_json.');
      END IF;

      SELECT COUNT(DISTINCT opt) INTO v_distinct_opts FROM jsonb_array_elements_text(v_opts_arr) opt;
      IF v_distinct_opts != jsonb_array_length(v_opts_arr) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Danh sách lựa chọn options_json không được chứa các phần tử trùng lặp.');
      END IF;

      v_key_json := v_q_json->'correct_answer_key';
      IF v_key_json IS NULL OR (v_key_json->'correct_answer') IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Thiếu đáp án đúng correct_answer_key cho câu hỏi trắc nghiệm.');
      END IF;

      v_correct_ans := v_key_json->'correct_answer';

      IF v_q_type = 'single_choice' THEN
        IF jsonb_typeof(v_correct_ans) != 'string' OR length(trim(v_correct_ans#>>'{}')) = 0 THEN
          RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Đáp án đúng cho câu hỏi trắc nghiệm đơn phải là một chuỗi chữ.');
        END IF;

        SELECT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(v_opts_arr) opt WHERE opt = (v_correct_ans#>>'{}')
        ) INTO v_opt_match;
        IF NOT v_opt_match THEN
          RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Đáp án đúng được chọn không thuộc danh sách lựa chọn options_json của câu hỏi.');
        END IF;

      ELSIF v_q_type = 'multiple_choice' THEN
        IF jsonb_typeof(v_correct_ans) != 'array' OR jsonb_array_length(v_correct_ans) = 0 THEN
          RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Đáp án đúng cho câu hỏi trắc nghiệm nhiều lựa chọn phải là một mảng JSON không rỗng.');
        END IF;

        SELECT NOT EXISTS (
          SELECT elem FROM jsonb_array_elements_text(v_correct_ans) elem
          WHERE elem NOT IN (SELECT jsonb_array_elements_text(v_opts_arr))
        ) INTO v_opt_match;
        IF NOT v_opt_match THEN
          RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Phát hiện đáp án đúng không thuộc danh sách lựa chọn options_json của câu hỏi.');
        END IF;
      END IF;
    END IF;

    IF v_q_type IN ('fill_blank', 'short_answer') THEN
      v_key_json := v_q_json->'correct_answer_key';
      IF v_key_json IS NULL OR (v_key_json->'correct_answer') IS NULL OR jsonb_typeof(v_key_json->'correct_answer') != 'string' OR length(trim(v_key_json->'correct_answer'#>>'{}')) = 0 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Thiếu đáp án đúng hợp lệ cho câu hỏi điền đáp án / trả lời ngắn.');
      END IF;
    END IF;

  END LOOP;

  -- =========================================================================
  -- PHASE 2: DML EXECUTION PHASE (CHỈ DÙNG CÁC BIẾN TYPED ĐÃ PARSE CHUẨN XÁC)
  -- =========================================================================
  IF v_exercise_id IS NOT NULL THEN
    SELECT * INTO v_existing_ex FROM public.academic_exercises WHERE id = v_exercise_id FOR UPDATE;

    IF v_existing_ex.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bài tập không tồn tại.');
    END IF;

    IF v_caller_role != 'admin' AND v_existing_ex.teacher_id != v_caller_id THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn không sở hữu bài tập này.');
    END IF;

    -- SERVER-SIDE STATE TRANSITION ALLOW-LIST
    IF v_existing_ex.status = 'draft' AND v_new_status NOT IN ('draft', 'published', 'archived') THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Trạng thái Bản nháp chỉ được chuyển sang Published hoặc Archived.');
    ELSIF v_existing_ex.status = 'published' AND v_new_status NOT IN ('published', 'closed', 'archived', 'draft') THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Trạng thái Published chỉ được chuyển sang Closed, Archived hoặc Draft.');
    ELSIF v_existing_ex.status = 'closed' AND v_new_status NOT IN ('closed', 'published', 'archived') THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Trạng thái Closed chỉ được mở lại Published hoặc Archived.');
    ELSIF v_existing_ex.status = 'archived' AND v_new_status NOT IN ('archived') THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bài tập đã Lưu trữ (archived) không được mở lại qua RPC thông thường.');
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.academic_submissions WHERE exercise_id = v_exercise_id
    ) INTO v_has_submissions;

    IF v_has_submissions THEN
      IF v_existing_ex.status = 'published' AND v_new_status = 'draft' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bài tập đã có bài nộp của học sinh, không thể đưa trở lại trạng thái Bản nháp (draft).');
      END IF;

      -- Lấy danh sách cấu trúc câu hỏi VA ĐÁP ÁN BÍ MẬT CHUẨN HÓA hiện tại từ CSDL
      SELECT jsonb_agg(jsonb_build_object(
        'question_number', q.question_number,
        'question_type', q.question_type,
        'prompt', trim(q.prompt),
        'options_json', q.options_json,
        'points', q.points,
        'correct_answer_key', CASE 
          WHEN q.question_type IN ('essay', 'image_upload', 'file_upload') THEN NULL
          ELSE jsonb_build_object(
            'correct_answer', k.correct_answer,
            'accepted_answers', COALESCE(k.accepted_answers, '[]'::jsonb),
            'case_sensitive', COALESCE(k.case_sensitive, FALSE)
          )
        END
      ) ORDER BY q.question_number ASC) INTO v_existing_questions_json
      FROM public.academic_exercise_questions q 
      LEFT JOIN app_private.academic_answer_keys k ON k.question_id = q.id
      WHERE q.exercise_id = v_exercise_id;

      SELECT jsonb_agg(jsonb_build_object(
        'question_number', (value->>'question_number')::INT,
        'question_type', value->>'question_type',
        'prompt', trim(value->>'prompt'),
        'options_json', COALESCE(value->'options_json', '[]'::jsonb),
        'points', (value->>'points')::INT,
        'correct_answer_key', CASE 
          WHEN value->>'question_type' IN ('essay', 'image_upload', 'file_upload') THEN NULL
          ELSE jsonb_build_object(
            'correct_answer', COALESCE(value->'correct_answer_key'->'correct_answer', '""'::jsonb),
            'accepted_answers', COALESCE(value->'correct_answer_key'->'accepted_answers', '[]'::jsonb),
            'case_sensitive', COALESCE((value->'correct_answer_key'->>'case_sensitive')::BOOLEAN, FALSE)
          )
        END
      ) ORDER BY (value->>'question_number')::INT ASC) INTO v_incoming_questions_json
      FROM jsonb_array_elements(p_questions);

      -- NẾU CLIENT CỐ TÌNH GỬI THAY ĐỔI CẤU TRÚC HOẶC ANSWER KEYS KHI ĐÃ CÓ BÀI NỘP -> TỪ CHỐI VÀ TRẢ LỖI THỰC TẾ
      IF v_existing_questions_json IS DISTINCT FROM v_incoming_questions_json THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bài tập đã có bài nộp của học sinh; không được sửa cấu trúc câu hỏi hoặc đáp án.');
      END IF;

      -- Cập nhật các trường metadata an toàn dùng local typed variables
      UPDATE public.academic_exercises
      SET
        title = trim(p_exercise->>'title'),
        description = p_exercise->>'description',
        status = v_new_status,
        due_date = v_valid_due_date,
        show_score_after_submit = v_valid_show_score,
        show_correct_answers = v_valid_show_answers,
        updated_at = NOW()
      WHERE id = v_exercise_id;

      RETURN jsonb_build_object('success', true, 'exercise_id', v_exercise_id, 'message', 'Đã cập nhật các thông tin an toàn của bài tập!');
    END IF;

    UPDATE public.academic_exercises
    SET
      title = trim(p_exercise->>'title'),
      description = p_exercise->>'description',
      class_id = v_class_id,
      is_global = v_valid_is_global,
      grade_level = v_valid_grade_level,
      subject = COALESCE(p_exercise->>'subject', 'Toán'),
      exercise_type = COALESCE(p_exercise->>'exercise_type', 'mixed'),
      status = v_new_status,
      due_date = v_valid_due_date,
      max_attempts = v_valid_max_attempts,
      reward_stars = v_valid_reward_stars,
      show_score_after_submit = v_valid_show_score,
      show_correct_answers = v_valid_show_answers,
      updated_at = NOW()
    WHERE id = v_exercise_id;

  ELSE
    INSERT INTO public.academic_exercises (
      teacher_id, class_id, is_global, grade_level, subject, title, description,
      exercise_type, status, due_date, max_attempts, reward_stars,
      show_score_after_submit, show_correct_answers
    ) VALUES (
      v_caller_id,
      v_class_id,
      v_valid_is_global,
      v_valid_grade_level,
      COALESCE(p_exercise->>'subject', 'Toán'),
      trim(p_exercise->>'title'),
      p_exercise->>'description',
      COALESCE(p_exercise->>'exercise_type', 'mixed'),
      v_new_status,
      v_valid_due_date,
      v_valid_max_attempts,
      v_valid_reward_stars,
      v_valid_show_score,
      v_valid_show_answers
    ) RETURNING id INTO v_exercise_id;
  END IF;

  DELETE FROM public.academic_exercise_questions WHERE exercise_id = v_exercise_id;

  FOR v_q_json IN SELECT * FROM jsonb_array_elements(p_questions)
  LOOP
    v_q_type := COALESCE(v_q_json->>'question_type', 'single_choice');
    v_valid_points := COALESCE((v_q_json->>'points')::INT, 10);

    INSERT INTO public.academic_exercise_questions (
      exercise_id, question_number, question_type, prompt, options_json, points
    ) VALUES (
      v_exercise_id,
      (v_q_json->>'question_number')::INT,
      v_q_type,
      trim(v_q_json->>'prompt'),
      COALESCE(v_q_json->'options_json', '[]'::jsonb),
      v_valid_points
    ) RETURNING id INTO v_q_id;

    v_key_json := v_q_json->'correct_answer_key';
    IF v_key_json IS NOT NULL AND v_q_type NOT IN ('essay', 'image_upload', 'file_upload') THEN
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


-- 9. SUBMIT_ACADEMIC_EXERCISE
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
  v_file_exists BOOLEAN := FALSE;
  v_total_questions_count INT := 0;
  v_has_any_file BOOLEAN := FALSE;
  v_opt_match BOOLEAN := FALSE;
  v_distinct_count INT := 0;
BEGIN
  -- =========================================================================
  -- PHASE 1: ZERO-DML VALIDATION PHASE (KHÔNG CHẠY LỆNH INSERT/UPDATE/DELETE NÀO)
  -- =========================================================================
  v_student_id := auth.uid();
  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_student_id;
  IF v_role != 'student' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Chỉ tài khoản Học sinh mới được phép nộp bài tập tích sao.');
  END IF;

  IF jsonb_typeof(p_answers) != 'array' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Cấu trúc câu trả lời p_answers phải là một mảng JSON.');
  END IF;

  -- 1.1 Khóa advisory transaction
  PERFORM pg_advisory_xact_lock(hashtext('academic_sub_' || p_exercise_id::text || '_' || v_student_id::text));

  -- 1.2 Đọc bài tập và xác minh trạng thái
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

  -- 1.3 Xác định submission_id nháp hiện có
  SELECT id, attempt_number, reward_applied_at 
  INTO v_submission_id, v_attempt_num, v_already_applied
  FROM public.academic_submissions
  WHERE exercise_id = p_exercise_id AND student_id = v_student_id AND status IN ('draft', 'revision_requested')
  ORDER BY attempt_number DESC LIMIT 1;

  -- 1.4 Kiểm tra sự xuất hiện của file_url trong p_answers
  FOR v_ans_item IN SELECT * FROM jsonb_array_elements(p_answers)
  LOOP
    IF (v_ans_item->>'file_url') IS NOT NULL AND length(trim(v_ans_item->>'file_url')) > 0 THEN
      v_has_any_file := TRUE;
    END IF;
  END LOOP;

  -- NẾU CÓ FILE MÀ V_SUBMISSION_ID KHÔNG TỒN TẠI TỪ BEFORE DRAFT -> TỪ CHỐI NGAY TẠI PHASE 1!
  IF v_has_any_file AND v_submission_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Chưa có bản nháp bài làm (submission_id). Bé cần khởi tạo lượt làm trước khi tải file.');
  END IF;

  IF v_submission_id IS NULL THEN
    SELECT COUNT(*) INTO v_existing_attempts
    FROM public.academic_submissions
    WHERE exercise_id = p_exercise_id AND student_id = v_student_id AND status != 'draft';

    IF v_existing_attempts >= COALESCE(v_ex.max_attempts, 1) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bé đã dùng hết số lượt nộp bài cho phép.');
    END IF;
    v_attempt_num := v_existing_attempts + 1;
  END IF;

  -- 1.5 Thống kê số lượng câu hỏi của bài tập
  SELECT COUNT(*) INTO v_total_questions_count FROM public.academic_exercise_questions WHERE exercise_id = p_exercise_id;

  -- 1.6 Nếu nộp chính thức (p_is_draft = false) -> BẮT BỘC gửi đủ câu hỏi duy nhất
  IF NOT p_is_draft AND jsonb_array_length(p_answers) != v_total_questions_count THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn phải trả lời đầy đủ chính xác tất cả câu hỏi trước khi nộp bài chính thức.');
  END IF;

  -- 1.7 Kiểm tra từng câu trả lời trong p_answers VÀ xác minh file Storage & Options JSON DB
  FOR v_ans_item IN SELECT * FROM jsonb_array_elements(p_answers)
  LOOP
    BEGIN
      v_curr_q_id := (v_ans_item->>'question_id')::UUID;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Thẻ question_id không đúng định dạng UUID.');
    END;

    IF v_curr_q_id = ANY(v_seen_q_ids) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Phát hiện question_id bị gửi trùng lặp.');
    END IF;
    v_seen_q_ids := array_append(v_seen_q_ids, v_curr_q_id);

    SELECT * INTO v_q FROM public.academic_exercise_questions WHERE id = v_curr_q_id AND exercise_id = p_exercise_id;
    IF v_q.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Phát hiện question_id không thuộc bài tập này.');
    END IF;

    v_student_ans := v_ans_item->'answer';
    v_file_url := v_ans_item->>'file_url';

    -- Đánh giá theo loại câu hỏi và ĐỐI CHIẾU THỰC TẾ VỚI OPTIONS_JSON TRONG CSDL
    IF v_q.question_type = 'single_choice' THEN
      IF jsonb_typeof(v_q.options_json) != 'array' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Cấu trúc options_json câu hỏi trắc nghiệm trong CSDL không phải mảng JSON.');
      END IF;

      IF NOT p_is_draft AND (v_student_ans IS NULL OR jsonb_typeof(v_student_ans) = 'null') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn chưa chọn đáp án trắc nghiệm.');
      END IF;
      IF v_student_ans IS NOT NULL AND jsonb_typeof(v_student_ans) != 'string' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Đáp án câu hỏi trắc nghiệm đơn phải là một chuỗi chữ.');
      END IF;
      IF v_student_ans IS NOT NULL AND jsonb_typeof(v_student_ans) = 'string' THEN
        SELECT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(v_q.options_json) opt WHERE opt = (v_student_ans#>>'{}')
        ) INTO v_opt_match;
        IF NOT v_opt_match THEN
          RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Đáp án trắc nghiệm đơn được chọn không thuộc danh sách lựa chọn của câu hỏi.');
        END IF;
      END IF;

    ELSIF v_q.question_type = 'multiple_choice' THEN
      IF jsonb_typeof(v_q.options_json) != 'array' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Cấu trúc options_json câu hỏi trắc nghiệm trong CSDL không phải mảng JSON.');
      END IF;

      IF NOT p_is_draft AND (v_student_ans IS NULL OR jsonb_typeof(v_student_ans) != 'array' OR jsonb_array_length(v_student_ans) = 0) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn chưa chọn đáp án cho câu hỏi trắc nghiệm nhiều lựa chọn.');
      END IF;
      IF v_student_ans IS NOT NULL AND jsonb_typeof(v_student_ans) != 'array' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Đáp án câu hỏi nhiều lựa chọn phải là một mảng JSON.');
      END IF;
      IF v_student_ans IS NOT NULL AND jsonb_typeof(v_student_ans) = 'array' THEN
        SELECT COUNT(DISTINCT elem) INTO v_distinct_count FROM jsonb_array_elements_text(v_student_ans) elem;
        IF v_distinct_count != jsonb_array_length(v_student_ans) THEN
          RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Đáp án câu hỏi trắc nghiệm nhiều lựa chọn không được chứa các phần tử trùng lặp.');
        END IF;

        SELECT NOT EXISTS (
          SELECT elem FROM jsonb_array_elements_text(v_student_ans) elem
          WHERE elem NOT IN (SELECT jsonb_array_elements_text(v_q.options_json))
        ) INTO v_opt_match;
        IF NOT v_opt_match THEN
          RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Phát hiện lựa chọn trong câu trắc nghiệm không thuộc danh sách lựa chọn hợp lệ.');
        END IF;
      END IF;

    ELSIF v_q.question_type IN ('fill_blank', 'short_answer') THEN
      IF v_student_ans IS NOT NULL AND jsonb_typeof(v_student_ans) != 'string' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Câu trả lời ngắn phải là một chuỗi chữ.');
      END IF;
      IF NOT p_is_draft THEN
        IF v_student_ans IS NULL OR jsonb_typeof(v_student_ans) != 'string' OR length(trim(v_student_ans#>>'{}')) = 0 THEN
          RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn chưa nhập câu trả lời điền đáp án.');
        END IF;
      END IF;
      IF v_student_ans IS NOT NULL AND length(v_student_ans#>>'{}') > 2000 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Câu trả lời ngắn vượt quá giới hạn 2.000 ký tự.');
      END IF;

    ELSIF v_q.question_type = 'essay' THEN
      IF v_student_ans IS NOT NULL AND jsonb_typeof(v_student_ans) != 'string' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bài làm tự luận phải là một chuỗi văn bản.');
      END IF;
      IF NOT p_is_draft THEN
        IF v_student_ans IS NULL OR jsonb_typeof(v_student_ans) != 'string' OR length(trim(v_student_ans#>>'{}')) = 0 THEN
          RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn chưa viết bài làm tự luận.');
        END IF;
      END IF;
      IF v_student_ans IS NOT NULL AND length(v_student_ans#>>'{}') > 20000 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bài làm tự luận vượt quá giới hạn 20.000 ký tự.');
      END IF;
    END IF;

    -- Kiểm tra câu hỏi nộp file / ảnh
    IF v_q.question_type IN ('image_upload', 'file_upload') THEN
      IF NOT p_is_draft AND (v_file_url IS NULL OR length(trim(v_file_url)) = 0) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn chưa chọn file hoặc ảnh bài làm để nộp.');
      END IF;

      IF v_file_url IS NOT NULL AND length(trim(v_file_url)) > 0 THEN
        IF v_submission_id IS NULL OR NOT (v_file_url LIKE v_student_id::text || '/' || v_submission_id::text || '/%') THEN
          RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Đường dẫn file nộp không đúng cấu trúc thư mục của học sinh.');
        END IF;

        SELECT EXISTS (
          SELECT 1 FROM storage.objects 
          WHERE bucket_id = 'exercise-submissions' AND name = v_file_url
        ) INTO v_file_exists;

        IF NOT v_file_exists THEN
          RETURN jsonb_build_object('success', false, 'message', 'Lỗi: File bài làm đã khai báo không tồn tại thực tế trên hệ thống Storage.');
        END IF;
      END IF;
    ELSE
      -- Câu hỏi không phải nộp file -> TUYỆT ĐỐI KHÔNG gửi kèm file_url
      IF v_file_url IS NOT NULL AND length(trim(v_file_url)) > 0 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Thẻ file_url chỉ dành riêng cho loại câu hỏi nộp ảnh hoặc file.');
      END IF;
    END IF;

  END LOOP;

  -- =========================================================================
  -- PHASE 2: DML EXECUTION PHASE (CHỈ THỰC THI KHI 100% VALIDATION PHASE THÀNH CÔNG)
  -- =========================================================================
  IF v_submission_id IS NULL THEN
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


-- 10. GRADE_ACADEMIC_SUBMISSION VỚI VALIDATION KIỂU INT CHO POINTS_EARNED DÙNG NUMERIC TRUNC
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
  v_seen_q_ids UUID[] := ARRAY[]::UUID[];
  v_curr_q_id UUID;
  v_sub_ans_exists BOOLEAN := FALSE;
  v_total_subjective_count INT := 0;
  v_graded_subjective_count INT := 0;
  v_num_val NUMERIC;
BEGIN
  -- =========================================================================
  -- PHASE 1: ZERO-DML VALIDATION PHASE (KHÔNG CHẠY LỆNH UPDATE NÀO)
  -- =========================================================================
  v_teacher_id := auth.uid();
  IF v_teacher_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Chưa đăng nhập.');
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_teacher_id;

  SELECT * INTO v_sub FROM public.academic_submissions WHERE id = p_submission_id FOR UPDATE;
  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bài nộp không tồn tại.');
  END IF;

  -- ALLOW-LIST CHỈ CHẤM SUBMITTED HOẶC PENDING_MANUAL_GRADE
  IF v_sub.status NOT IN ('submitted', 'pending_manual_grade') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Chỉ được chấm bài nộp ở trạng thái submitted hoặc pending_manual_grade.');
  END IF;

  SELECT * INTO v_ex FROM public.academic_exercises WHERE id = v_sub.exercise_id;

  IF v_role != 'admin' AND v_ex.teacher_id != v_teacher_id THEN
    IF NOT EXISTS (SELECT 1 FROM public.classes WHERE id = v_ex.class_id AND teacher_id = v_teacher_id) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn không có quyền chấm bài nộp này.');
    END IF;
  END IF;

  IF p_manual_grades IS NOT NULL THEN
    IF jsonb_typeof(p_manual_grades) != 'array' THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Cấu trúc điểm chấm p_manual_grades phải là một mảng JSON.');
    END IF;

    FOR v_grade_item IN SELECT * FROM jsonb_array_elements(p_manual_grades)
    LOOP
      BEGIN
        v_curr_q_id := (v_grade_item->>'question_id')::UUID;
      EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Thẻ question_id không đúng định dạng UUID.');
      END;

      IF v_curr_q_id = ANY(v_seen_q_ids) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Phát hiện question_id bị gửi trùng lặp trong điểm chấm.');
      END IF;
      v_seen_q_ids := array_append(v_seen_q_ids, v_curr_q_id);

      SELECT question_type, points INTO v_q_type, v_q_points 
      FROM public.academic_exercise_questions 
      WHERE id = v_curr_q_id AND exercise_id = v_sub.exercise_id;

      IF v_q_type IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Câu hỏi được chấm không thuộc bài tập này.');
      END IF;

      -- TỪ CHỐI NẾU KHÔNG PHẢI CÂU HỎI TỰ LUẬN HOẶC NỘP FILE
      IF v_q_type NOT IN ('essay', 'image_upload', 'file_upload') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Chỉ được chấm thủ công các câu hỏi tự luận hoặc nộp file.');
      END IF;

      -- XÁC MINH CÂU TRẢ LỜI CÓ TỒN TẠI TRONG BÀI NỘP NÀY KHÔNG
      SELECT EXISTS (
        SELECT 1 FROM public.academic_submission_answers 
        WHERE submission_id = p_submission_id AND question_id = v_curr_q_id
      ) INTO v_sub_ans_exists;

      IF NOT v_sub_ans_exists THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bản ghi câu trả lời không tồn tại trong bài nộp.');
      END IF;

      -- KIỂM TRA ĐIỂM SỐ CHÍNH XÁC KIỂU SỐ NGUYÊN (TRÁNH CÁC SỐ THẬP PHÂN NHƯ 1.5 HOẶC CHUỖI "ABC")
      IF (v_grade_item->'points_earned') IS NULL OR jsonb_typeof(v_grade_item->'points_earned') != 'number' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Điểm chấm points_earned phải là một số nguyên.');
      END IF;

      BEGIN
        v_num_val := (v_grade_item->>'points_earned')::NUMERIC;
      EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Điểm chấm points_earned không đúng định dạng số.');
      END;

      IF v_num_val != TRUNC(v_num_val) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Điểm chấm points_earned phải là số nguyên, không được chứa phần thập phân.');
      END IF;

      v_item_points := v_num_val::INT;
      IF v_item_points < 0 OR v_item_points > COALESCE(v_q_points, 10) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Điểm chấm cho câu hỏi không nằm trong khoảng 0 đến điểm tối đa của câu.');
      END IF;
    END LOOP;
  END IF;

  -- NẾU KHÔNG PHẢI YÊU CẦU LÀM LẠI -> BẮT BỘC XÁC MINH ĐÃ CHẤM ĐỦ 100% CÂU TỰ LUẬN
  IF NOT p_request_revision THEN
    SELECT COUNT(*) INTO v_total_subjective_count
    FROM public.academic_exercise_questions
    WHERE exercise_id = v_sub.exercise_id AND question_type IN ('essay', 'image_upload', 'file_upload');

    IF p_manual_grades IS NOT NULL THEN
      v_graded_subjective_count := jsonb_array_length(p_manual_grades);
    END IF;

    IF v_graded_subjective_count < v_total_subjective_count THEN
      RETURN jsonb_build_object('success', false, 'message', 'Lỗi: Bạn phải chấm đầy đủ điểm cho tất cả câu hỏi tự luận / nộp file trước khi chuyển trạng thái Đã Chấm (graded).');
    END IF;
  END IF;

  -- =========================================================================
  -- PHASE 2: DML EXECUTION PHASE (CHỈ CHẠY KHI PHASE 1 CHUẨN XÁC 100%)
  -- =========================================================================
  IF p_manual_grades IS NOT NULL AND jsonb_array_length(p_manual_grades) > 0 THEN
    FOR v_grade_item IN SELECT * FROM jsonb_array_elements(p_manual_grades)
    LOOP
      SELECT question_type, points INTO v_q_type, v_q_points 
      FROM public.academic_exercise_questions 
      WHERE id = (v_grade_item->>'question_id')::UUID AND exercise_id = v_sub.exercise_id;

      IF v_q_type IN ('essay', 'image_upload', 'file_upload') THEN
        v_item_points := (v_grade_item->>'points_earned')::INT;

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
    SET total_stars = COALESCE(total_stars, 0) + v_reward_stars
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

-- GRANT / REVOKE PERMISSIONS DÀNH RIÊNG CHO SERVICE_ROLE CHO CÁC RPC WORKER NỘI BỘ
REVOKE ALL ON FUNCTION public.queue_file_cleanup FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_exercise_file_cleanup_job(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_exercise_file_cleanup_job(UUID, INT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_exercise_file_cleanup_job(UUID, INT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reset_cleanup_jobs_for_retry(INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_exercise_for_edit FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_or_get_submission_draft FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_exercise_with_questions_and_keys FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_academic_exercise FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.grade_academic_submission FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.claim_exercise_file_cleanup_job(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_exercise_file_cleanup_job(UUID, INT, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_exercise_file_cleanup_job(UUID, INT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_cleanup_jobs_for_retry(INT) TO service_role, authenticated;

GRANT EXECUTE ON FUNCTION public.queue_file_cleanup TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_exercise_for_edit TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_or_get_submission_draft TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_exercise_with_questions_and_keys TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_academic_exercise TO authenticated;
GRANT EXECUTE ON FUNCTION public.grade_academic_submission TO authenticated;

COMMIT;
