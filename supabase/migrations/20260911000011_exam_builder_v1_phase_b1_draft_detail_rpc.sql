-- Migration: 20260911000011_exam_builder_v1_phase_b1_draft_detail_rpc.sql
-- Exam Builder V1 Phase B1: Secure Authoring RPC for Reading Draft Exam Questions + Answer Keys
-- Author: Antigravity Super Agent
-- Target DB: NEW Exam Database Only

CREATE OR REPLACE FUNCTION public.rpc_exam_get_draft_questions_with_answers(
    p_caller_id UUID,
    p_version_id UUID,
    p_is_admin BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private
AS $$
DECLARE
    v_ver RECORD;
    v_test RECORD;
    v_questions JSONB;
BEGIN
    -- 1. Validate required input parameters
    IF p_caller_id IS NULL THEN
        RAISE EXCEPTION 'ERR_CALLER_ID_REQUIRED: Caller identity is required' USING ERRCODE = '22000';
    END IF;

    IF p_version_id IS NULL THEN
        RAISE EXCEPTION 'ERR_REQUIRED_PARAMS: version_id is required' USING ERRCODE = '22000';
    END IF;

    -- 2. Load exact exam_version
    SELECT * INTO v_ver
    FROM public.exam_versions
    WHERE id = p_version_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_VERSION_NOT_FOUND: Exam version % does not exist', p_version_id USING ERRCODE = 'P0002';
    END IF;

    -- 3. Load parent exam_test container
    SELECT * INTO v_test
    FROM public.exam_tests
    WHERE id = v_ver.exam_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_EXAM_NOT_FOUND: Parent exam % does not exist', v_ver.exam_id USING ERRCODE = 'P0002';
    END IF;

    -- 4. Check Exam container status
    IF v_test.status <> 'active' THEN
        RAISE EXCEPTION 'ERR_EXAM_ARCHIVED: Exam container % is not active', v_ver.exam_id USING ERRCODE = '22000';
    END IF;

    -- 5. Enforce Draft-Only: This authoring RPC is ONLY for editable drafts
    IF v_ver.status <> 'draft' THEN
        RAISE EXCEPTION 'ERR_VERSION_IMMUTABLE: Cannot read authoring answer keys for non-draft version (status: %)', v_ver.status USING ERRCODE = '22000';
    END IF;

    -- 6. Strict Authorization Check
    IF NOT p_is_admin AND v_test.author_id <> p_caller_id THEN
        RAISE EXCEPTION 'ERR_UNAUTHORIZED: You do not have permission to access draft details for this exam' USING ERRCODE = '42501';
    END IF;

    -- 7. Query Questions with Joined Answer Keys (Safe Explicit Projection)
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', q.id,
                'exam_version_id', q.exam_version_id,
                'question_number', q.question_number,
                'question_type', q.question_type,
                'prompt', q.prompt,
                'options_json', q.options_json,
                'points', q.points,
                'source_question_bank_item_id', q.source_question_bank_item_id,
                'source_question_bank_version_id', q.source_question_bank_version_id,
                'created_at', q.created_at,
                'answer_key', CASE 
                    WHEN k.question_id IS NOT NULL THEN jsonb_build_object(
                        'correct_answer', k.correct_answer,
                        'accepted_answers', k.accepted_answers,
                        'case_sensitive', k.case_sensitive,
                        'grading_config', k.grading_config
                    )
                    ELSE NULL
                END
            ) ORDER BY q.question_number ASC
        ),
        '[]'::jsonb
    ) INTO v_questions
    FROM public.exam_questions q
    LEFT JOIN app_private.exam_answer_keys k ON k.question_id = q.id
    WHERE q.exam_version_id = p_version_id;

    -- 8. Return explicit safe JSON metadata object (Never use raw row_to_json)
    RETURN jsonb_build_object(
        'test', jsonb_build_object(
            'id', v_test.id,
            'author_id', v_test.author_id,
            'title', v_test.title,
            'subject', v_test.subject,
            'grade_level', v_test.grade_level,
            'status', v_test.status,
            'current_version_id', v_test.current_version_id,
            'created_at', v_test.created_at,
            'updated_at', v_test.updated_at
        ),
        'version', jsonb_build_object(
            'id', v_ver.id,
            'exam_id', v_ver.exam_id,
            'version_number', v_ver.version_number,
            'title', v_ver.title,
            'description', v_ver.description,
            'subject', v_ver.subject,
            'grade_level', v_ver.grade_level,
            'duration_minutes', v_ver.duration_minutes,
            'starts_at', v_ver.starts_at,
            'last_start_at', v_ver.last_start_at,
            'due_date', v_ver.due_date,
            'max_attempts', v_ver.max_attempts,
            'reward_stars', v_ver.reward_stars,
            'shuffle_questions', v_ver.shuffle_questions,
            'shuffle_options', v_ver.shuffle_options,
            'tab_switch_policy', v_ver.tab_switch_policy,
            'show_score_after_submit', v_ver.show_score_after_submit,
            'show_correct_answers', v_ver.show_correct_answers,
            'total_points', v_ver.total_points,
            'status', v_ver.status,
            'published_at', v_ver.published_at,
            'created_at', v_ver.created_at
        ),
        'questions', v_questions
    );
END;
$$;

-- Permissions: Restrict execution strictly to service_role
REVOKE ALL ON FUNCTION public.rpc_exam_get_draft_questions_with_answers(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_exam_get_draft_questions_with_answers(UUID, UUID, BOOLEAN) TO service_role;
