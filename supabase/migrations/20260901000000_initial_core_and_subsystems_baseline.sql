-- ============================================================================
-- BASELINE MIGRATION: CORE TABLES & SUBSYSTEM FOUNDATION
-- TIMESTAMP: 20260901000000 (Before Exam Builder & Question Bank migrations)
-- PROVIDES: profiles, classes, class_members, learning_materials, scorm_packages,
--           scorm_launch_sessions, question_bank_items, question_bank_versions,
--           academic_exercises, academic_exercise_questions, academic_submissions,
--           academic_submission_answers, exercise_file_cleanup_jobs,
--           app_private schemas and credentials tables for local fresh boot.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS app_private;

-- 1. BẢNG PROFILES (Hồ sơ người dùng)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('admin', 'teacher', 'student', 'parent')),
  avatar_url TEXT DEFAULT 'https://api.dicebear.com/7.x/bottts/svg?seed=Pikachu',
  grade_level INT DEFAULT 1 CHECK (grade_level BETWEEN 1 AND 12),
  total_stars INT DEFAULT 0,
  total_coins INT DEFAULT 0,
  student_code TEXT,
  is_disabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. BẢNG CLASSES (Lớp học)
CREATE TABLE IF NOT EXISTS public.classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  grade_level INT NOT NULL CHECK (grade_level BETWEEN 1 AND 12),
  code TEXT UNIQUE NOT NULL,
  teacher_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. BẢNG CLASS_MEMBERS (Danh sách thành viên lớp)
CREATE TABLE IF NOT EXISTS public.class_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_class_student UNIQUE (class_id, student_id)
);

-- 4. BẢNG QUESTION_BANK_ITEMS (Ngân hàng câu hỏi)
CREATE TABLE IF NOT EXISTS public.question_bank_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50),
  title TEXT NOT NULL,
  question_type VARCHAR(30) NOT NULL DEFAULT 'single_choice',
  subject VARCHAR(100) NOT NULL DEFAULT 'Toán',
  grade_level INT NOT NULL DEFAULT 5 CHECK (grade_level BETWEEN 1 AND 12),
  difficulty VARCHAR(20) NOT NULL DEFAULT 'easy',
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  visibility VARCHAR(30) NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'school', 'public')),
  school_id UUID NULL,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  current_version_id UUID NULL,
  version_count INT NOT NULL DEFAULT 1,
  tags TEXT[] NULL DEFAULT '{}'::TEXT[],
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. BẢNG QUESTION_BANK_VERSIONS (Phiên bản câu hỏi ngân hàng)
CREATE TABLE IF NOT EXISTS public.question_bank_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_bank_item_id UUID NOT NULL REFERENCES public.question_bank_items(id) ON DELETE CASCADE,
  version_number INT NOT NULL DEFAULT 1,
  prompt TEXT NOT NULL,
  prompt_media JSONB DEFAULT '[]'::jsonb,
  question_type TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  solution_explanation TEXT,
  rubric JSONB,
  metadata JSONB DEFAULT '{}'::jsonb,
  change_log TEXT,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  forked_from_version_id UUID NULL REFERENCES public.question_bank_versions(id) ON DELETE SET NULL,
  CONSTRAINT unique_qb_version_number UNIQUE (question_bank_item_id, version_number)
);

-- 6. BẢNG APP_PRIVATE.QUESTION_BANK_ANSWER_KEYS
CREATE TABLE IF NOT EXISTS app_private.question_bank_answer_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id UUID NOT NULL UNIQUE REFERENCES public.question_bank_versions(id) ON DELETE CASCADE,
  correct_answers JSONB NOT NULL,
  scoring_guide TEXT,
  grading_config JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Circular Reference Constraint (current_version_id -> question_bank_versions)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_qb_items_current_version'
  ) THEN
    ALTER TABLE public.question_bank_items
      ADD CONSTRAINT fk_qb_items_current_version
      FOREIGN KEY (current_version_id)
      REFERENCES public.question_bank_versions(id)
      ON DELETE SET NULL
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

-- 7. BẢNG LEARNING_MATERIALS & SCORM CONTAINERS
CREATE TABLE IF NOT EXISTS public.learning_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  material_type TEXT NOT NULL,
  file_url TEXT,
  grade_level INT NOT NULL DEFAULT 1 CHECK (grade_level BETWEEN 1 AND 12),
  subject TEXT NOT NULL DEFAULT 'Toán',
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'class', 'private')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.scorm_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID NOT NULL REFERENCES public.learning_materials(id) ON DELETE CASCADE,
  scorm_version TEXT NOT NULL CHECK (scorm_version IN ('1.2', '2004')),
  entry_point TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('processing', 'ready', 'failed')),
  manifest_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.scorm_launch_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.scorm_packages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. BẢNG ACADEMIC EXERCISES & SUBMISSIONS
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

CREATE TABLE IF NOT EXISTS public.academic_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  class_id UUID REFERENCES public.classes(id) ON DELETE CASCADE,
  is_global BOOLEAN DEFAULT FALSE,
  grade_level INT NOT NULL DEFAULT 1 CHECK (grade_level BETWEEN 1 AND 12),
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

CREATE TABLE IF NOT EXISTS public.academic_exercise_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id UUID NOT NULL REFERENCES public.academic_exercises(id) ON DELETE CASCADE,
  question_number INT NOT NULL CHECK (question_number >= 1),
  question_type TEXT NOT NULL CHECK (question_type IN ('single_choice', 'multiple_choice', 'fill_blank', 'short_answer', 'essay', 'image_upload', 'file_upload')),
  prompt TEXT NOT NULL,
  options_json JSONB DEFAULT '[]'::jsonb,
  points INT DEFAULT 10 CHECK (points > 0),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.academic_exercise_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id UUID NOT NULL REFERENCES public.academic_exercises(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  due_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_exercise_class UNIQUE (exercise_id, class_id)
);

CREATE TABLE IF NOT EXISTS app_private.academic_answer_keys (
  question_id UUID PRIMARY KEY REFERENCES public.academic_exercise_questions(id) ON DELETE CASCADE,
  correct_answer JSONB NOT NULL,
  accepted_answers JSONB DEFAULT '[]'::jsonb,
  case_sensitive BOOLEAN DEFAULT FALSE,
  grading_config JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.academic_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id UUID NOT NULL REFERENCES public.academic_exercises(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  attempt_number INT NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft', 'submitted', 'pending_manual_grade', 'graded', 'revision_requested')),
  objective_score NUMERIC DEFAULT 0 CHECK (objective_score >= 0),
  manual_score NUMERIC DEFAULT 0 CHECK (manual_score >= 0),
  total_score NUMERIC DEFAULT 0 CHECK (total_score >= 0),
  max_score NUMERIC DEFAULT 100 CHECK (max_score > 0),
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

CREATE TABLE IF NOT EXISTS public.academic_submission_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES public.academic_submissions(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.academic_exercise_questions(id) ON DELETE CASCADE,
  student_answer_json JSONB,
  file_url TEXT,
  points_earned NUMERIC DEFAULT 0 CHECK (points_earned >= 0),
  is_correct BOOLEAN DEFAULT FALSE,
  teacher_comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. BẢNG APP_PRIVATE CREDENTIALS & PIN RESET LOGS
CREATE TABLE IF NOT EXISTS app_private.student_login_credentials (
  student_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  pin_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_private.student_pin_reset_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES public.profiles(id),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reset_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
