-- ============================================================
-- TEST / EXAM BUILDER V1
-- REVIEW-ONLY MIGRATION DRAFT (HARDENING V3)
-- TARGET_PROJECT_REF: szptvqkoiphrhlionfoh
-- FORBIDDEN_CORE_REF: nddimmxpymipalpxlops
-- DO NOT EXECUTE WITHOUT EXPLICIT APPROVAL
-- ============================================================
-- EXPECTED_TARGET_PROJECT_REF=szptvqkoiphrhlionfoh
-- CORE_MUST_REMAIN_UNCHANGED=YES
--
-- PREFLIGHT VERIFICATION NOTICE:
-- 1. This migration script is designed to run EXCLUSIVELY on the NEW Supabase Project (szptvqkoiphrhlionfoh).
-- 2. It must NEVER be executed against the Academic Core Project (nddimmxpymipalpxlops).
-- 3. Project ref must be verified OUTSIDE SQL from Supabase dashboard / project URL / CLI / environment.
--    SQL cannot reliably infer Supabase project_ref (e.g. current_database() returns generic 'postgres').
-- 4. All tables in this file use strict Row Level Security (RLS) with no public/authenticated browser access policies.
--    All DML/access is handled via the Exam BFF Edge Function (service_role / SECURITY DEFINER RPCs).
-- ============================================================

BEGIN;

-- Conservative timeout protections
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ------------------------------------------------------------
-- 0. PRIVATE SCHEMA FOR ANSWER KEYS
-- ------------------------------------------------------------
-- CREATE SCHEMA IF NOT EXISTS is permitted as app_private is shared across subsystems.
CREATE SCHEMA IF NOT EXISTS app_private;

-- ------------------------------------------------------------
-- 1. EXAM TESTS (Logical Container)
-- ------------------------------------------------------------
-- exam_tests is a logical container for exam versions.
-- It tracks container lifecycle (active / archived) and points to the currently active published version.
CREATE TABLE public.exam_tests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id UUID NOT NULL,
    title VARCHAR(255) NOT NULL,
    subject VARCHAR(100) NOT NULL,
    grade_level INT NOT NULL CHECK (grade_level BETWEEN 1 AND 12),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    current_version_id UUID NULL,
    archived_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 2. EXAM VERSIONS (Immutable Version Snapshot)
-- ------------------------------------------------------------
-- exam_versions is the single source of truth for test publication status and settings.
-- status: 'draft' -> 'published' -> 'superseded' -> 'archived'
-- Lifecycle Invariant:
--   - draft: published_at IS NULL
--   - published: published_at IS NOT NULL
--   - superseded: published_at IS NOT NULL
--   - archived: may be an archived draft (published_at IS NULL) or an archived published version (published_at IS NOT NULL)
-- ON DELETE RESTRICT guarantees published and historical versions cannot be accidentally cascaded if test is referenced.
CREATE TABLE public.exam_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id UUID NOT NULL REFERENCES public.exam_tests(id) ON DELETE RESTRICT,
    version_number INT NOT NULL CHECK (version_number >= 1),
    title VARCHAR(255) NOT NULL,
    description TEXT NULL,
    subject VARCHAR(100) NOT NULL,
    grade_level INT NOT NULL CHECK (grade_level BETWEEN 1 AND 12),
    duration_minutes INT NULL CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 300),
    starts_at TIMESTAMPTZ NULL,
    due_date TIMESTAMPTZ NULL,
    max_attempts INT NOT NULL DEFAULT 1 CHECK (max_attempts BETWEEN 1 AND 100),
    reward_stars INT NOT NULL DEFAULT 0 CHECK (reward_stars BETWEEN 0 AND 1000),
    shuffle_questions BOOLEAN NOT NULL DEFAULT FALSE,
    shuffle_options BOOLEAN NOT NULL DEFAULT FALSE,
    tab_switch_policy VARCHAR(20) NOT NULL DEFAULT 'WARN_AND_LOG' CHECK (tab_switch_policy IN ('OFF', 'WARN_ONLY', 'WARN_AND_LOG')),
    show_score_after_submit BOOLEAN NOT NULL DEFAULT TRUE,
    show_correct_answers BOOLEAN NOT NULL DEFAULT FALSE,
    total_points NUMERIC(6, 2) NOT NULL DEFAULT 0.00 CHECK (total_points >= 0.00),
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'superseded', 'archived')),
    published_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT unique_exam_version_id UNIQUE (exam_id, id),
    CONSTRAINT unique_exam_version_number UNIQUE (exam_id, version_number),
    CONSTRAINT check_version_lifecycle CHECK (
        (status = 'draft' AND published_at IS NULL) OR 
        (status IN ('published', 'superseded') AND published_at IS NOT NULL) OR 
        (status = 'archived')
    )
);

-- ------------------------------------------------------------
-- CIRCULAR FK: exam_tests.current_version_id -> exam_versions(exam_id, id)
-- ------------------------------------------------------------
-- Composite FK guarantees that current_version_id belongs to the exact same exam container.
-- ON DELETE RESTRICT prevents accidental physical deletion of published versions.
ALTER TABLE public.exam_tests 
    ADD CONSTRAINT fk_exam_tests_current_version 
    FOREIGN KEY (id, current_version_id) 
    REFERENCES public.exam_versions(exam_id, id) 
    ON DELETE RESTRICT 
    DEFERRABLE INITIALLY DEFERRED;

-- ------------------------------------------------------------
-- 3. EXAM QUESTIONS (Versioned Question Snapshots)
-- ------------------------------------------------------------
CREATE TABLE public.exam_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_version_id UUID NOT NULL REFERENCES public.exam_versions(id) ON DELETE CASCADE,
    question_number INT NOT NULL CHECK (question_number >= 1),
    question_type VARCHAR(30) NOT NULL CHECK (
        question_type IN ('single_choice', 'multiple_choice', 'fill_blank', 'short_answer', 'essay', 'image_upload', 'file_upload')
    ),
    prompt TEXT NOT NULL,
    options_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    points NUMERIC(6, 2) NOT NULL DEFAULT 1.00 CHECK (points > 0.00),
    source_question_bank_item_id UUID NULL,
    source_question_bank_version_id UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT unique_exam_question_id UNIQUE (exam_version_id, id),
    CONSTRAINT unique_exam_question_number UNIQUE (exam_version_id, question_number)
);

-- ------------------------------------------------------------
-- 4. PRIVATE ANSWER KEYS (app_private.exam_answer_keys)
-- ------------------------------------------------------------
-- Isolated in app_private schema to strictly prevent client-side answer key exposure.
-- Only auto-graded question types have rows here. Essay and file uploads have NO rows.
CREATE TABLE app_private.exam_answer_keys (
    question_id UUID PRIMARY KEY REFERENCES public.exam_questions(id) ON DELETE CASCADE,
    correct_answer JSONB NOT NULL,
    accepted_answers JSONB NULL,
    case_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
    grading_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 5. EXAM ASSIGNMENTS (Class Assignments on NEW Project)
-- ------------------------------------------------------------
-- Binds an immutable exam_version to a class_id from CORE.
-- No cross-database FK is created; class_id is validated via BFF coreReader.
CREATE TABLE public.exam_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_version_id UUID NOT NULL REFERENCES public.exam_versions(id) ON DELETE RESTRICT,
    class_id UUID NOT NULL,
    assigned_by UUID NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    due_date TIMESTAMPTZ NULL,
    counts_toward_ranking BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT unique_exam_assignment_class UNIQUE (exam_version_id, class_id),
    CONSTRAINT unique_exam_assignment_version UNIQUE (id, exam_version_id)
);

-- ------------------------------------------------------------
-- 6. EXAM ATTEMPTS (Student Exam Submissions)
-- ------------------------------------------------------------
CREATE TABLE public.exam_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id UUID NOT NULL,
    exam_version_id UUID NOT NULL,
    student_id UUID NOT NULL,
    attempt_number INT NOT NULL DEFAULT 1 CHECK (attempt_number BETWEEN 1 AND 100),
    status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (
        status IN ('draft', 'submitted', 'pending_manual_grade', 'graded')
    ),
    attempt_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NULL,
    submitted_at TIMESTAMPTZ NULL,
    objective_score NUMERIC(6, 2) NULL CHECK (objective_score >= 0.00),
    manual_score NUMERIC(6, 2) NULL CHECK (manual_score >= 0.00),
    total_score NUMERIC(6, 2) NULL CHECK (total_score >= 0.00),
    max_score NUMERIC(6, 2) NOT NULL CHECK (max_score > 0.00),
    question_order JSONB NOT NULL DEFAULT '[]'::jsonb,
    option_orders JSONB NOT NULL DEFAULT '{}'::jsonb,
    teacher_feedback TEXT NULL,
    graded_at TIMESTAMPTZ NULL,
    graded_by UUID NULL,
    reward_stars_awarded INT NOT NULL DEFAULT 0 CHECK (reward_stars_awarded BETWEEN 0 AND 1000),
    tab_switch_count INT NOT NULL DEFAULT 0 CHECK (tab_switch_count >= 0),
    active_leave_episode_id UUID NULL,
    version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Composite FK guarantees attempt references the exact same exam_version as the assignment
    CONSTRAINT fk_exam_attempts_assignment 
        FOREIGN KEY (assignment_id, exam_version_id) 
        REFERENCES public.exam_assignments(id, exam_version_id) 
        ON DELETE RESTRICT,
    
    -- Constraints
    CONSTRAINT unique_exam_attempt_version UNIQUE (exam_version_id, id),
    CONSTRAINT unique_exam_attempt_number UNIQUE (assignment_id, student_id, attempt_number)
);

-- Partial unique index guarantees at most one active draft attempt per assignment/student
CREATE UNIQUE INDEX unique_active_draft_attempt 
    ON public.exam_attempts (assignment_id, student_id) 
    WHERE status = 'draft';

-- ------------------------------------------------------------
-- 7. EXAM ATTEMPT ANSWERS (Student Question Answers)
-- ------------------------------------------------------------
CREATE TABLE public.exam_attempt_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_version_id UUID NOT NULL,
    attempt_id UUID NOT NULL,
    exam_question_id UUID NOT NULL,
    student_answer_json JSONB NULL,
    file_url TEXT NULL,
    points_earned NUMERIC(6, 2) NULL CHECK (points_earned >= 0.00),
    is_correct BOOLEAN NULL,
    grading_status VARCHAR(30) NOT NULL CHECK (
        grading_status IN ('auto_graded', 'pending_manual', 'manual_graded')
    ),
    teacher_comment TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Composite FKs enforce version isolation across attempt and question
    CONSTRAINT fk_attempt_answers_attempt 
        FOREIGN KEY (exam_version_id, attempt_id) 
        REFERENCES public.exam_attempts(exam_version_id, id) 
        ON DELETE CASCADE,
    CONSTRAINT fk_attempt_answers_question 
        FOREIGN KEY (exam_version_id, exam_question_id) 
        REFERENCES public.exam_questions(exam_version_id, id) 
        ON DELETE CASCADE,
    CONSTRAINT unique_attempt_question UNIQUE (attempt_id, exam_question_id)
);

-- ------------------------------------------------------------
-- 8. EXAM AUDIT EVENTS (Leave Episode & Integrity Monitoring)
-- ------------------------------------------------------------
CREATE TABLE public.exam_audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL REFERENCES public.exam_attempts(id) ON DELETE CASCADE,
    episode_id UUID NULL,
    event_type VARCHAR(30) NOT NULL CHECK (
        event_type IN ('episode_opened', 'episode_closed', 'focus_loss_auxiliary')
    ),
    signal_source VARCHAR(30) NOT NULL CHECK (
        signal_source IN ('page_hidden', 'page_visible', 'window_focus', 'window_blur')
    ),
    client_timestamp TIMESTAMPTZ NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Event/Signal Pair DB Invariants:
    -- - episode_opened requires signal_source = 'page_hidden' and episode_id IS NOT NULL
    -- - episode_closed requires signal_source IN ('page_visible', 'window_focus') and episode_id IS NOT NULL
    -- - focus_loss_auxiliary requires signal_source = 'window_blur' (episode_id may be NULL or non-NULL)
    CONSTRAINT check_audit_event_signal_invariants CHECK (
        (event_type = 'episode_opened' AND signal_source = 'page_hidden' AND episode_id IS NOT NULL) OR
        (event_type = 'episode_closed' AND signal_source IN ('page_visible', 'window_focus') AND episode_id IS NOT NULL) OR
        (event_type = 'focus_loss_auxiliary' AND signal_source = 'window_blur')
    ),

    -- Constraints: Idempotency for retries on the exact same episode and event type
    CONSTRAINT unique_attempt_episode_event UNIQUE (attempt_id, episode_id, event_type)
);

-- ------------------------------------------------------------
-- INDEXES (Only non-redundant, justified query-plan indexes)
-- ------------------------------------------------------------
-- NOTE: The following indexes were omitted/removed as they are already covered by leading columns of UNIQUE constraints:
--   - (exam_version_id, question_number) -> covered by unique_exam_question_number
--   - (exam_version_id) on exam_assignments -> covered by unique_exam_assignment_class(exam_version_id, class_id)
--   - (assignment_id, student_id) on exam_attempts -> covered by unique_exam_attempt_number(assignment_id, student_id, attempt_number)
--   - (attempt_id) on exam_attempt_answers -> covered by unique_attempt_question(attempt_id, exam_question_id)

CREATE INDEX idx_exam_versions_exam_status ON public.exam_versions(exam_id, status);
CREATE INDEX idx_exam_assignments_class ON public.exam_assignments(class_id);
CREATE INDEX idx_exam_attempts_student_status ON public.exam_attempts(student_id, status);
CREATE INDEX idx_exam_audit_events_attempt_created ON public.exam_audit_events(attempt_id, created_at ASC);

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY (RLS) - FAIL-CLOSED DESIGN
-- ------------------------------------------------------------
-- Enable RLS on all public exam tables.
-- No browser-facing policies (anon / authenticated) are added.
-- Access is restricted entirely to the Exam BFF Edge Function (service_role) and SECURITY DEFINER RPCs.
ALTER TABLE public.exam_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_attempt_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_audit_events ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- PRIVILEGES & SECURITY REVOCATION (FAIL-CLOSED)
-- ------------------------------------------------------------
-- Revoke all direct table DML from anon, authenticated, and public roles
REVOKE ALL ON TABLE public.exam_tests FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.exam_versions FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.exam_questions FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.exam_assignments FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.exam_attempts FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.exam_attempt_answers FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.exam_audit_events FROM anon, authenticated, public;

-- Revoke all access to private answer keys table
REVOKE ALL ON TABLE app_private.exam_answer_keys FROM anon, authenticated, public;
-- NOTE: Schema-wide REVOKE ON SCHEMA app_private is intentionally omitted here
-- to prevent breaking existing shared Question Bank tables pending a read-only ACL baseline.

-- ------------------------------------------------------------
-- BUSINESS INVARIANTS & FUTURE RPC RULES (DOCUMENTATION ONLY)
-- ------------------------------------------------------------
-- NOTE: No RPCs are created in this DDL migration file.
--
-- 1. Publish Invariant (Future rpc_exam_publish_version):
--    - Rejects publish if exam has zero questions OR total_points <= 0.
--    - Draft exam_versions.total_points may remain 0.00 prior to publish.
--    - Calculates total_points = COALESCE(SUM(points), 0) from exam_questions.
--    - Atomically sets status = 'published', published_at = NOW().
--    - Updates exam_tests.current_version_id = version.id.
--    - Supersedes previously published version (status = 'superseded').
--
-- 2. Assignment Invariant (Future rpc_exam_create_assignment):
--    - Only versions with status = 'published' can be assigned to classes.
--
-- 3. Due Date & Effective Expiry Resolution Invariant (Future rpc_exam_start_attempt):
--    - Effective Close Time = earliest non-null of (exam_versions.due_date, exam_assignments.due_date).
--      * If neither is set, effective close time is NULL (no deadline).
--      * If both are set, effective close time is LEAST(exam_versions.due_date, exam_assignments.due_date).
--    - Effective Expiry Time = earliest non-null of:
--      * (attempt_started_at + (duration_minutes || ' minutes')::interval) [if duration_minutes IS NOT NULL]
--      * Effective Close Time [if Effective Close Time IS NOT NULL]
--      * If both are NULL (untimed exam with no due date), expires_at is set to NULL.
--    - max_score snapshot is copied from exam_versions.total_points (must be > 0).
--    - question_order and option_orders are shuffled and stored as JSONB.
--
-- 4. Leave Episode Invariant (Future rpc_exam_record_audit_event):
--    - INSERT INTO exam_audit_events ... ON CONFLICT (attempt_id, episode_id, event_type) DO NOTHING.
--    - tab_switch_count incremented and active_leave_episode_id set ONLY if episode_opened insert succeeded.
--    - Historical episode replay causes no duplicate increment.
--    - Tab-switch monitoring is an informational integrity aid (WARN_AND_LOG); no automatic submit/failure.
--
-- 5. Exam Test Container Archive Semantics:
--    - exam_tests.status = 'archived' disables:
--      * Creation of new draft versions.
--      * Creation of new class assignments.
--      * Initiation of new student attempts (if product policy requires).
--    - Archiving the logical exam_tests container does NOT automatically mutate the current published exam_version to 'archived'.
--    - exam_tests.current_version_id remains pointing to the last published version for historical and audit integrity.
--    - Pre-existing assignments and student attempts remain unchanged.

COMMIT;
