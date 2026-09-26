-- ============================================================
-- TEST / EXAM BUILDER V1
-- PHASE 1.1 SCHEMA PATCH: GRADING STATUS AMENDMENT
-- TARGET_PROJECT_REF: szptvqkoiphrhlionfoh
-- FORBIDDEN_CORE_REF: nddimmxpymipalpxlops
-- ============================================================
-- PURPOSE:
-- Add 'pending_auto' to public.exam_attempt_answers.grading_status
-- to represent saved student draft answers for auto-graded questions
-- prior to server-side submission/grading.
--
-- SEMANTICS:
-- - pending_auto   : AUTO question answer saved in draft attempt, not yet auto-graded
-- - auto_graded    : AUTO question answer graded server-side upon attempt submission
-- - pending_manual : MANUAL question answer waiting for teacher manual grading
-- - manual_graded  : MANUAL question answer graded by teacher
-- ============================================================

BEGIN;

-- Conservative timeout protections
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ------------------------------------------------------------
-- ALTER TABLE: public.exam_attempt_answers
-- ------------------------------------------------------------
ALTER TABLE public.exam_attempt_answers
    DROP CONSTRAINT exam_attempt_answers_grading_status_check;

ALTER TABLE public.exam_attempt_answers
    ADD CONSTRAINT exam_attempt_answers_grading_status_check
    CHECK (
        grading_status IN (
            'pending_auto',
            'auto_graded',
            'pending_manual',
            'manual_graded'
        )
    );

COMMIT;
