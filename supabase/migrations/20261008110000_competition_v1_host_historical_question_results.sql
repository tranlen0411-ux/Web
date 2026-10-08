-- ============================================================
-- COMPETITION V1 R12 — HOST HISTORICAL QUESTION RESULTS & SNAPSHOTS
-- Migration: Additive table and RPCs for Host/Admin to review closed questions by question_order.
--
-- Security Invariants:
-- - Private helpers: SECURITY DEFINER, search_path = ''
-- - Public wrappers: SECURITY INVOKER, search_path = ''
-- - Direct table read/write revoked from PUBLIC, anon, authenticated
-- - Direct execute of private snapshot helper revoked from PUBLIC, anon, authenticated
-- - Host ownership or Admin profile role strictly enforced in all caller helpers
-- - Immutable per-question result snapshots (competition_question_result_snapshots)
-- - Never expose answer/correct result for a question that is still open/active
-- - Fail-closed on unauthorized, missing question, active question, or missing historical snapshot
-- - Returns authoritative total_questions via metadata & result RPCs
-- - Zero PII returned (No user_id, email, guest_token_hash, raw tokens)
-- - Zero raw student answer rows returned (Server-side aggregation only)
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ------------------------------------------------------------
-- 1. TABLE: competition_question_result_snapshots
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.competition_question_result_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.competition_sessions(id) ON DELETE RESTRICT,
    question_id UUID NOT NULL,
    question_order INTEGER NOT NULL,
    closed_at TIMESTAMPTZ NOT NULL,
    total_eligible INTEGER NOT NULL,
    submitted_count INTEGER NOT NULL,
    unanswered_count INTEGER NOT NULL,
    correct_count INTEGER NOT NULL,
    incorrect_count INTEGER NOT NULL,
    correct_percentage NUMERIC(5, 1) NOT NULL,
    distribution JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT unique_competition_snapshot_session_question UNIQUE (session_id, question_id),
    CONSTRAINT unique_competition_snapshot_session_order UNIQUE (session_id, question_order),
    CONSTRAINT fk_competition_snapshot_question FOREIGN KEY (session_id, question_id)
        REFERENCES public.competition_questions(session_id, id) ON DELETE RESTRICT,
    CONSTRAINT check_snapshot_counts CHECK (
        total_eligible >= 0 AND
        submitted_count >= 0 AND
        unanswered_count >= 0 AND
        correct_count >= 0 AND
        incorrect_count >= 0
    )
);

ALTER TABLE public.competition_question_result_snapshots ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_competition_snapshots_session_order
    ON public.competition_question_result_snapshots(session_id, question_order);


-- ------------------------------------------------------------
-- 2. PRIVATE HELPER: competition_snapshot_question_result_internal
-- Strictly Internal: No direct client execution grant
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.competition_snapshot_question_result_internal(
    p_session_id UUID,
    p_question_id UUID,
    p_closed_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_question RECORD;
    v_total_eligible INT := 0;
    v_submitted_count INT := 0;
    v_unanswered_count INT := 0;
    v_correct_count INT := 0;
    v_incorrect_count INT := 0;
    v_correct_percentage NUMERIC(5, 1) := 0.0;
    v_distribution JSONB := '[]'::jsonb;
    v_snapshot RECORD;
BEGIN
    -- Check if snapshot already exists (Idempotent safe read)
    SELECT * INTO v_snapshot
    FROM public.competition_question_result_snapshots
    WHERE session_id = p_session_id AND question_id = p_question_id;

    IF v_snapshot.id IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'session_id', v_snapshot.session_id,
            'question_id', v_snapshot.question_id,
            'question_order', v_snapshot.question_order,
            'closed_at', v_snapshot.closed_at,
            'total_eligible', v_snapshot.total_eligible,
            'submitted_count', v_snapshot.submitted_count,
            'unanswered_count', v_snapshot.unanswered_count,
            'correct_count', v_snapshot.correct_count,
            'incorrect_count', v_snapshot.incorrect_count,
            'correct_percentage', v_snapshot.correct_percentage,
            'distribution', v_snapshot.distribution
        );
    END IF;

    -- Load question info
    SELECT id, session_id, question_order, question_type, question_text, options, correct_answer, points
    INTO v_question
    FROM public.competition_questions
    WHERE session_id = p_session_id AND id = p_question_id;

    IF v_question.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'QUESTION_NOT_FOUND',
            'message', 'Không tìm thấy thông tin câu hỏi.'
        );
    END IF;

    -- Compute aggregates based strictly on eligibility at closed_at
    -- Invariant: status <> 'kicked' AND joined_at <= p_closed_at
    SELECT pg_catalog.count(*)::INT
    INTO v_total_eligible
    FROM public.competition_participants
    WHERE session_id = p_session_id
      AND status <> 'kicked'
      AND joined_at <= p_closed_at;

    SELECT
        pg_catalog.count(a.id)::INT,
        pg_catalog.count(a.id) FILTER (WHERE a.is_correct = true)::INT,
        pg_catalog.count(a.id) FILTER (WHERE a.is_correct = false)::INT
    INTO
        v_submitted_count,
        v_correct_count,
        v_incorrect_count
    FROM public.competition_answers a
    INNER JOIN public.competition_participants p
        ON p.id = a.participant_id
       AND p.session_id = p_session_id
       AND p.status <> 'kicked'
       AND p.joined_at <= p_closed_at
    WHERE a.session_id = p_session_id
      AND a.question_id = p_question_id;

    v_unanswered_count := GREATEST(v_total_eligible - v_submitted_count, 0);

    IF v_submitted_count > 0 THEN
        v_correct_percentage := pg_catalog.round((v_correct_count::NUMERIC * 100.0) / v_submitted_count::NUMERIC, 1);
    ELSE
        v_correct_percentage := 0.0;
    END IF;

    -- Compute distribution
    IF v_question.question_type IN ('single_choice', 'true_false', 'multiple_choice') THEN
        IF v_question.options IS NOT NULL AND pg_catalog.jsonb_typeof(v_question.options) = 'array' AND pg_catalog.jsonb_array_length(v_question.options) > 0 THEN
            WITH opt_rows AS (
                SELECT
                    opt->>'id' AS option_id,
                    opt->>'text' AS option_text,
                    opt_ordinality
                FROM pg_catalog.jsonb_array_elements(v_question.options) WITH ORDINALITY AS t(opt, opt_ordinality)
            ),
            opt_counts AS (
                SELECT
                    o.option_id,
                    o.option_text,
                    o.opt_ordinality,
                    pg_catalog.count(a.id)::INT AS selection_count,
                    CASE
                        WHEN v_question.question_type = 'multiple_choice' THEN
                            (v_question.correct_answer->'option_ids' @> pg_catalog.jsonb_build_array(o.option_id))
                        ELSE
                            (v_question.correct_answer->>'option_id' = o.option_id)
                    END AS is_correct_option
                FROM opt_rows o
                LEFT JOIN (
                    SELECT a.id, a.selected_option_ids
                    FROM public.competition_answers a
                    INNER JOIN public.competition_participants p
                        ON p.id = a.participant_id
                       AND p.session_id = p_session_id
                       AND p.status <> 'kicked'
                       AND p.joined_at <= p_closed_at
                    WHERE a.session_id = p_session_id
                      AND a.question_id = p_question_id
                ) a ON EXISTS (
                    SELECT 1
                    FROM pg_catalog.jsonb_array_elements_text(
                        COALESCE(a.selected_option_ids, '[]'::jsonb)
                    ) AS chosen(option_id)
                    WHERE chosen.option_id = o.option_id
                )
                GROUP BY o.option_id, o.option_text, o.opt_ordinality
            )
            SELECT COALESCE(
                pg_catalog.jsonb_agg(
                    pg_catalog.jsonb_build_object(
                        'option_id', option_id,
                        'option_text', option_text,
                        'selection_count', selection_count,
                        'selection_percentage', CASE
                            WHEN v_submitted_count > 0 THEN
                                pg_catalog.round((selection_count::NUMERIC * 100.0) / v_submitted_count::NUMERIC, 1)
                            ELSE 0.0
                        END,
                        'is_correct_option', is_correct_option
                    )
                    ORDER BY opt_ordinality ASC
                ),
                '[]'::jsonb
            )
            INTO v_distribution
            FROM opt_counts;
        ELSE
            v_distribution := '[]'::jsonb;
        END IF;
    ELSE
        v_distribution := '[]'::jsonb;
    END IF;

    -- Persist immutable snapshot idempotently
    INSERT INTO public.competition_question_result_snapshots (
        session_id,
        question_id,
        question_order,
        closed_at,
        total_eligible,
        submitted_count,
        unanswered_count,
        correct_count,
        incorrect_count,
        correct_percentage,
        distribution,
        created_at
    ) VALUES (
        p_session_id,
        p_question_id,
        v_question.question_order,
        p_closed_at,
        v_total_eligible,
        v_submitted_count,
        v_unanswered_count,
        v_correct_count,
        v_incorrect_count,
        v_correct_percentage,
        v_distribution,
        pg_catalog.now()
    )
    ON CONFLICT (session_id, question_id) DO NOTHING;

    -- Concurrency/Idempotency hardening: Always re-select the persisted snapshot row from table
    SELECT * INTO v_snapshot
    FROM public.competition_question_result_snapshots
    WHERE session_id = p_session_id AND question_id = p_question_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'session_id', v_snapshot.session_id,
        'question_id', v_snapshot.question_id,
        'question_order', v_snapshot.question_order,
        'closed_at', v_snapshot.closed_at,
        'total_eligible', v_snapshot.total_eligible,
        'submitted_count', v_snapshot.submitted_count,
        'unanswered_count', v_snapshot.unanswered_count,
        'correct_count', v_snapshot.correct_count,
        'incorrect_count', v_snapshot.incorrect_count,
        'correct_percentage', v_snapshot.correct_percentage,
        'distribution', v_snapshot.distribution
    );
END;
$$;


-- ------------------------------------------------------------
-- 3. UPDATED HELPER: competition_host_close_question_internal (Materializes Snapshot)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.competition_host_close_question_internal(
    p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_session RECORD;
    v_is_authorized BOOLEAN := false;
    v_close_time TIMESTAMPTZ;
BEGIN
    -- 1. Input Validation
    IF p_session_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_ID',
            'message', 'ID phòng thi không được để trống.'
        );
    END IF;

    -- 2. Authorization Check
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'UNAUTHORIZED_ACCESS',
            'message', 'Yêu cầu đăng nhập để thực hiện thao tác này.'
        );
    END IF;

    -- 3. Load and Lock Session Row
    SELECT id, host_id, status, current_question_index, current_question_id, question_deadline
    INTO v_session
    FROM public.competition_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF v_session.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_NOT_FOUND',
            'message', 'Phòng thi không tồn tại.'
        );
    END IF;

    -- 4. Check Authorization: Host or Admin
    IF v_session.host_id = v_caller_id THEN
        v_is_authorized := true;
    ELSE
        SELECT role INTO v_caller_role
        FROM public.profiles
        WHERE id = v_caller_id;

        IF v_caller_role = 'admin' THEN
            v_is_authorized := true;
        END IF;
    END IF;

    IF NOT v_is_authorized THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'UNAUTHORIZED_ACCESS',
            'message', 'Bạn không có quyền đóng câu hỏi trong phòng thi này.'
        );
    END IF;

    -- 5. Validate State: in_progress only
    IF v_session.status <> 'in_progress' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_NOT_IN_PROGRESS',
            'message', 'Phòng thi không ở trạng thái thi đấu.'
        );
    END IF;

    -- 6. Validate Active Question
    IF v_session.current_question_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'QUESTION_NOT_ACTIVE',
            'message', 'Không có câu hỏi đang diễn ra.'
        );
    END IF;

    -- 7. Idempotent check: If already closed, ensure snapshot is materialized
    IF v_session.question_deadline IS NOT NULL AND pg_catalog.clock_timestamp() >= v_session.question_deadline THEN
        PERFORM private.competition_snapshot_question_result_internal(
            v_session.id,
            v_session.current_question_id,
            v_session.question_deadline
        );

        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'session_id', v_session.id,
            'session_status', v_session.status,
            'question_id', v_session.current_question_id,
            'question_index', v_session.current_question_index,
            'question_closed', true,
            'closed_at', v_session.question_deadline
        );
    END IF;

    -- 8. Close active question and materialize snapshot
    v_close_time := pg_catalog.clock_timestamp();

    UPDATE public.competition_sessions
    SET question_deadline = v_close_time,
        paused_remaining_ms = NULL,
        updated_at = v_close_time
    WHERE id = v_session.id;

    PERFORM private.competition_snapshot_question_result_internal(
        v_session.id,
        v_session.current_question_id,
        v_close_time
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'session_id', v_session.id,
        'session_status', v_session.status,
        'question_id', v_session.current_question_id,
        'question_index', v_session.current_question_index,
        'question_closed', true,
        'closed_at', v_close_time
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.competition_host_close_question(
    p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RETURN private.competition_host_close_question_internal(p_session_id);
END;
$$;


-- ------------------------------------------------------------
-- 4. UPDATED HELPER: competition_host_next_question (Materializes Snapshot Before Transition)
-- Refactored to private SECURITY DEFINER + public SECURITY INVOKER
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.competition_host_next_question_internal(
    p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_session RECORD;
    v_is_authorized BOOLEAN := false;
    v_next_order INT;
    v_next_question RECORD;
    v_transition_time TIMESTAMPTZ;
    v_deadline TIMESTAMPTZ;
BEGIN
    -- 1. Caller Authentication Check
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'UNAUTHORIZED',
            'message', 'Yêu cầu đăng nhập để chuyển câu hỏi.'
        );
    END IF;

    IF p_session_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_ID',
            'message', 'ID phòng thi không được để trống.'
        );
    END IF;

    -- 2. Lock Session Row FOR UPDATE
    SELECT id, host_id, status, current_question_index, current_question_id, question_deadline
    INTO v_session
    FROM public.competition_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF v_session.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_NOT_FOUND',
            'message', 'Phòng thi không tồn tại.'
        );
    END IF;

    -- 3. Authorization Check: Host or Admin
    IF v_session.host_id = v_caller_id THEN
        v_is_authorized := true;
    ELSE
        SELECT role INTO v_caller_role
        FROM public.profiles
        WHERE id = v_caller_id;

        IF v_caller_role = 'admin' THEN
            v_is_authorized := true;
        END IF;
    END IF;

    IF NOT v_is_authorized THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'NOT_SESSION_HOST',
            'message', 'Chỉ người tạo phòng thi (host) hoặc quản trị viên mới có quyền chuyển câu hỏi.'
        );
    END IF;

    -- 4. State Check
    IF v_session.status <> 'in_progress' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_STATE',
            'message', 'Phòng thi phải ở trạng thái đang diễn ra (in_progress) để chuyển câu hỏi.'
        );
    END IF;

    -- 5. Materialize snapshot for CURRENT question before moving to NEXT
    IF v_session.current_question_id IS NOT NULL THEN
        PERFORM private.competition_snapshot_question_result_internal(
            v_session.id,
            v_session.current_question_id,
            COALESCE(v_session.question_deadline, pg_catalog.clock_timestamp())
        );
    END IF;

    -- 6. Load Next Question (current_question_index + 1)
    v_next_order := v_session.current_question_index + 1;

    SELECT id, question_order, question_text, question_type, options, points, time_limit_seconds
    INTO v_next_question
    FROM public.competition_questions
    WHERE session_id = p_session_id AND question_order = v_next_order;

    IF v_next_question.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'NO_MORE_QUESTIONS',
            'message', 'Đã là câu hỏi cuối cùng của phòng thi.'
        );
    END IF;

    -- 7. Transition Timing Captured AFTER Row Lock
    v_transition_time := pg_catalog.clock_timestamp();
    v_deadline := v_transition_time + (v_next_question.time_limit_seconds * interval '1 second');

    -- 8. Update Session State
    UPDATE public.competition_sessions
    SET current_question_index = v_next_order,
        current_question_id = v_next_question.id,
        question_deadline = v_deadline,
        paused_remaining_ms = NULL,
        updated_at = v_transition_time
    WHERE id = p_session_id;

    -- 9. Return Sanitized Success Payload
    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'session_id', p_session_id,
        'status', 'in_progress',
        'current_question_index', v_next_order,
        'current_question_id', v_next_question.id,
        'question_deadline', v_deadline,
        'current_question', pg_catalog.jsonb_build_object(
            'id', v_next_question.id,
            'question_order', v_next_question.question_order,
            'question_text', v_next_question.question_text,
            'question_type', v_next_question.question_type,
            'options', v_next_question.options,
            'points', v_next_question.points,
            'time_limit_seconds', v_next_question.time_limit_seconds
        )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.competition_host_next_question(
    p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RETURN private.competition_host_next_question_internal(p_session_id);
END;
$$;


-- ------------------------------------------------------------
-- 5. UPDATED HELPER: competition_finish_session_internal (Persists Snapshot Before Finish)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.competition_finish_session_internal(
    p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_session RECORD;
    v_is_authorized BOOLEAN := false;
    v_ended_at TIMESTAMPTZ;
BEGIN
    -- 1. Input Validation
    IF p_session_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_ID',
            'message', 'ID phòng thi không được để trống.'
        );
    END IF;

    -- 2. Caller Authentication Check
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'UNAUTHORIZED',
            'message', 'Yêu cầu đăng nhập để kết thúc phòng thi.'
        );
    END IF;

    -- 3. Lock Session Row FOR UPDATE
    SELECT id, host_id, status, current_question_id, question_deadline
    INTO v_session
    FROM public.competition_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF v_session.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_NOT_FOUND',
            'message', 'Phòng thi không tồn tại.'
        );
    END IF;

    -- 4. Check Authorization: Host or Admin
    IF v_session.host_id = v_caller_id THEN
        v_is_authorized := true;
    ELSE
        SELECT role INTO v_caller_role
        FROM public.profiles
        WHERE id = v_caller_id;

        IF v_caller_role = 'admin' THEN
            v_is_authorized := true;
        END IF;
    END IF;

    IF NOT v_is_authorized THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'NOT_SESSION_HOST',
            'message', 'Chỉ người tạo phòng thi (host) hoặc quản trị viên mới có quyền kết thúc phòng thi.'
        );
    END IF;

    -- 5. State Check
    IF v_session.status = 'finished' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_ALREADY_FINISHED',
            'message', 'Phòng thi đã được kết thúc trước đó.'
        );
    ELSIF v_session.status = 'cancelled' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_CANCELLED',
            'message', 'Phòng thi đã bị hủy, không thể kết thúc.'
        );
    ELSIF v_session.status NOT IN ('waiting', 'in_progress', 'paused') THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_STATUS',
            'message', 'Trạng thái phòng thi không hợp lệ để kết thúc.'
        );
    END IF;

    -- Materialize snapshot for active question before closing session
    IF v_session.current_question_id IS NOT NULL THEN
        PERFORM private.competition_snapshot_question_result_internal(
            v_session.id,
            v_session.current_question_id,
            COALESCE(v_session.question_deadline, pg_catalog.clock_timestamp())
        );
    END IF;

    -- 6. Atomic Final Rank Calculation and Persistence
    WITH ranked AS (
        SELECT id,
               RANK() OVER (
                   ORDER BY total_score DESC,
                            correct_count DESC,
                            total_response_time_ms ASC
               )::INTEGER AS calc_rank
        FROM public.competition_scores
        WHERE session_id = v_session.id
    )
    UPDATE public.competition_scores s
    SET rank = r.calc_rank,
        updated_at = pg_catalog.now()
    FROM ranked r
    WHERE s.id = r.id;

    -- 7. Update Session State to Finished and Clean Active Timers
    v_ended_at := pg_catalog.now();
    UPDATE public.competition_sessions
    SET status = 'finished',
        ended_at = v_ended_at,
        current_question_id = NULL,
        question_deadline = NULL,
        paused_remaining_ms = NULL,
        updated_at = v_ended_at
    WHERE id = v_session.id;

    -- 8. Return Structured Success Response
    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'session_id', v_session.id,
        'status', 'finished',
        'ended_at', v_ended_at
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.competition_host_finish_session(
    p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RETURN private.competition_finish_session_internal(p_session_id);
END;
$$;


-- ------------------------------------------------------------
-- 6. UPDATED HELPER: competition_host_get_question_results_internal
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.competition_host_get_question_results_internal(
    p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_session RECORD;
    v_question RECORD;
    v_is_authorized BOOLEAN := false;
    v_snapshot_res JSONB;
    v_total_questions INT := 0;
BEGIN
    -- 1. Input Validation
    IF p_session_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_ID',
            'message', 'ID phòng thi không được để trống.'
        );
    END IF;

    -- 2. Authorization Check
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'UNAUTHORIZED_ACCESS',
            'message', 'Yêu cầu đăng nhập để xem kết quả câu hỏi.'
        );
    END IF;

    -- 3. Load Session Record
    SELECT id, host_id, status, current_question_index, current_question_id, question_deadline
    INTO v_session
    FROM public.competition_sessions
    WHERE id = p_session_id;

    IF v_session.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_NOT_FOUND',
            'message', 'Phòng thi không tồn tại.'
        );
    END IF;

    -- 4. Check Ownership or Admin Role
    IF v_session.host_id = v_caller_id THEN
        v_is_authorized := true;
    ELSE
        SELECT role INTO v_caller_role
        FROM public.profiles
        WHERE id = v_caller_id;

        IF v_caller_role = 'admin' THEN
            v_is_authorized := true;
        END IF;
    END IF;

    IF NOT v_is_authorized THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'UNAUTHORIZED_ACCESS',
            'message', 'Bạn không có quyền xem kết quả câu hỏi của phòng thi này.'
        );
    END IF;

    -- 5. Result Reveal Gate
    IF v_session.status <> 'in_progress' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'QUESTION_STILL_ACTIVE',
            'message', 'Phòng thi không ở trạng thái thi đấu hoặc đang tạm dừng.'
        );
    END IF;

    IF v_session.current_question_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'QUESTION_NOT_ACTIVE',
            'message', 'Không có câu hỏi đang diễn ra.'
        );
    END IF;

    IF v_session.question_deadline IS NULL OR pg_catalog.clock_timestamp() < v_session.question_deadline THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'QUESTION_STILL_ACTIVE',
            'message', 'Câu hỏi vẫn đang diễn ra, chưa đến thời điểm mở kết quả.'
        );
    END IF;

    -- 6. Load Current Question Info
    SELECT id, session_id, question_order, question_type, question_text, options, correct_answer, points
    INTO v_question
    FROM public.competition_questions
    WHERE session_id = p_session_id
      AND id = v_session.current_question_id;

    IF v_question.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'QUESTION_NOT_FOUND',
            'message', 'Không tìm thấy thông tin câu hỏi hiện tại.'
        );
    END IF;

    -- 7. Materialize snapshot for current question
    v_snapshot_res := private.competition_snapshot_question_result_internal(
        v_session.id,
        v_session.current_question_id,
        v_session.question_deadline
    );

    -- 8. Count Authoritative Total Questions
    SELECT pg_catalog.count(*)::INT
    INTO v_total_questions
    FROM public.competition_questions
    WHERE session_id = p_session_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'session_id', v_session.id,
        'session_status', v_session.status,
        'question_closed', true,
        'question_id', v_question.id,
        'question_order', v_question.question_order,
        'question_type', v_question.question_type,
        'question_text', v_question.question_text,
        'points', v_question.points,
        'total_eligible', (v_snapshot_res->>'total_eligible')::INT,
        'submitted_count', (v_snapshot_res->>'submitted_count')::INT,
        'unanswered_count', (v_snapshot_res->>'unanswered_count')::INT,
        'correct_count', (v_snapshot_res->>'correct_count')::INT,
        'incorrect_count', (v_snapshot_res->>'incorrect_count')::INT,
        'correct_percentage', (v_snapshot_res->>'correct_percentage')::NUMERIC,
        'distribution', v_snapshot_res->'distribution',
        'total_questions', v_total_questions
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.competition_host_get_question_results(
    p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RETURN private.competition_host_get_question_results_internal(p_session_id);
END;
$$;


-- ------------------------------------------------------------
-- 7. NEW RPC: competition_host_get_session_metadata (BLOCKER 1)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.competition_host_get_session_metadata_internal(
    p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_session RECORD;
    v_is_authorized BOOLEAN := false;
    v_total_questions INT := 0;
BEGIN
    -- 1. Input Validation
    IF p_session_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_ID',
            'message', 'ID phòng thi không được để trống.'
        );
    END IF;

    -- 2. Caller Authentication Check
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'UNAUTHORIZED_ACCESS',
            'message', 'Yêu cầu đăng nhập để xem thông tin phòng thi.'
        );
    END IF;

    -- 3. Load Session
    SELECT id, host_id, status, current_question_index, current_question_id
    INTO v_session
    FROM public.competition_sessions
    WHERE id = p_session_id;

    IF v_session.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_NOT_FOUND',
            'message', 'Phòng thi không tồn tại.'
        );
    END IF;

    -- 4. Check Authorization: Host or Admin only
    IF v_session.host_id = v_caller_id THEN
        v_is_authorized := true;
    ELSE
        SELECT role INTO v_caller_role
        FROM public.profiles
        WHERE id = v_caller_id;

        IF v_caller_role = 'admin' THEN
            v_is_authorized := true;
        END IF;
    END IF;

    IF NOT v_is_authorized THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'UNAUTHORIZED_ACCESS',
            'message', 'Bạn không có quyền xem thông tin phòng thi này.'
        );
    END IF;

    -- 5. Count Authoritative Total Questions
    SELECT pg_catalog.count(*)::INT
    INTO v_total_questions
    FROM public.competition_questions
    WHERE session_id = p_session_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'session_id', v_session.id,
        'status', v_session.status,
        'current_question_index', v_session.current_question_index,
        'current_question_id', v_session.current_question_id,
        'total_questions', v_total_questions
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.competition_host_get_session_metadata(
    p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RETURN private.competition_host_get_session_metadata_internal(p_session_id);
END;
$$;


-- ------------------------------------------------------------
-- 8. NEW RPC: competition_host_get_question_result_by_order (BLOCKER 2 - Immutable Snapshots)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.competition_host_get_question_result_by_order_internal(
    p_session_id UUID,
    p_question_order INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_session RECORD;
    v_question RECORD;
    v_snapshot RECORD;
    v_is_authorized BOOLEAN := false;
    v_is_readable BOOLEAN := false;
    v_total_questions INT := 0;
BEGIN
    -- 1. Input Validation
    IF p_session_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_ID',
            'message', 'ID phòng thi không được để trống.'
        );
    END IF;

    IF p_question_order IS NULL OR p_question_order < 1 THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_QUESTION_ORDER',
            'message', 'Thứ tự câu hỏi không hợp lệ (yêu cầu số nguyên >= 1).'
        );
    END IF;

    -- 2. Authorization Check: Require Authenticated Identity
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'UNAUTHORIZED_ACCESS',
            'message', 'Yêu cầu đăng nhập để xem kết quả câu hỏi.'
        );
    END IF;

    -- 3. Load Session Record
    SELECT id, host_id, status, current_question_index, current_question_id, question_deadline
    INTO v_session
    FROM public.competition_sessions
    WHERE id = p_session_id;

    IF v_session.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_NOT_FOUND',
            'message', 'Phòng thi không tồn tại.'
        );
    END IF;

    -- 4. Check Ownership or Admin Role
    IF v_session.host_id = v_caller_id THEN
        v_is_authorized := true;
    ELSE
        SELECT role INTO v_caller_role
        FROM public.profiles
        WHERE id = v_caller_id;

        IF v_caller_role = 'admin' THEN
            v_is_authorized := true;
        END IF;
    END IF;

    IF NOT v_is_authorized THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'UNAUTHORIZED_ACCESS',
            'message', 'Bạn không có quyền xem kết quả câu hỏi của phòng thi này.'
        );
    END IF;

    -- Fail-closed on invalid session states
    IF v_session.status NOT IN ('in_progress', 'paused', 'finished') THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'QUESTION_STILL_ACTIVE',
            'message', 'Phòng thi không ở trạng thái thi đấu hoặc đã hoàn thành.'
        );
    END IF;

    -- 5. Load Question Record by exact question_order
    SELECT id, session_id, question_order, question_type, question_text, options, points
    INTO v_question
    FROM public.competition_questions
    WHERE session_id = p_session_id
      AND question_order = p_question_order;

    IF v_question.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'QUESTION_NOT_FOUND',
            'message', 'Không tìm thấy thông tin câu hỏi yêu cầu trong phòng thi.'
        );
    END IF;

    -- 6. Critical Result Visibility Gate
    -- A) session is finished
    -- OR B) question_order < current_question_index
    -- OR C) question_order = current_question_index AND deadline passed
    IF v_session.status = 'finished' THEN
        v_is_readable := true;
    ELSIF v_session.current_question_index IS NOT NULL AND p_question_order < v_session.current_question_index THEN
        v_is_readable := true;
    ELSIF v_session.current_question_index IS NOT NULL
          AND p_question_order = v_session.current_question_index
          AND v_session.question_deadline IS NOT NULL
          AND pg_catalog.clock_timestamp() >= v_session.question_deadline THEN
        v_is_readable := true;
    END IF;

    IF NOT v_is_readable THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'QUESTION_STILL_ACTIVE',
            'message', 'Câu hỏi vẫn đang diễn ra, chưa đến thời điểm mở kết quả.'
        );
    END IF;

    -- 7. Load Immutable Snapshot
    SELECT * INTO v_snapshot
    FROM public.competition_question_result_snapshots
    WHERE session_id = p_session_id AND question_id = v_question.id;

    -- If snapshot missing and this is the active closed question, materialize on demand
    IF v_snapshot.id IS NULL AND v_session.current_question_id = v_question.id AND v_session.question_deadline IS NOT NULL THEN
        PERFORM private.competition_snapshot_question_result_internal(
            v_session.id,
            v_question.id,
            v_session.question_deadline
        );

        SELECT * INTO v_snapshot
        FROM public.competition_question_result_snapshots
        WHERE session_id = p_session_id AND question_id = v_question.id;
    END IF;

    -- If historical snapshot still missing (e.g. legacy session), fail honestly without fabricating data
    IF v_snapshot.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'HISTORICAL_SNAPSHOT_NOT_AVAILABLE',
            'message', 'Không tìm thấy bản chụp kết quả lịch sử cho câu hỏi này.'
        );
    END IF;

    -- 8. Count Authoritative Total Questions
    SELECT pg_catalog.count(*)::INT
    INTO v_total_questions
    FROM public.competition_questions
    WHERE session_id = p_session_id;

    -- 9. Return Sanitized Result Shape with Authoritative total_questions
    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'session_id', v_session.id,
        'session_status', v_session.status,
        'question_closed', true,
        'question_id', v_question.id,
        'question_order', v_question.question_order,
        'question_type', v_question.question_type,
        'question_text', v_question.question_text,
        'points', v_question.points,
        'total_eligible', v_snapshot.total_eligible,
        'submitted_count', v_snapshot.submitted_count,
        'unanswered_count', v_snapshot.unanswered_count,
        'correct_count', v_snapshot.correct_count,
        'incorrect_count', v_snapshot.incorrect_count,
        'correct_percentage', v_snapshot.correct_percentage,
        'distribution', v_snapshot.distribution,
        'total_questions', v_total_questions
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.competition_host_get_question_result_by_order(
    p_session_id UUID,
    p_question_order INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RETURN private.competition_host_get_question_result_by_order_internal(
        p_session_id,
        p_question_order
    );
END;
$$;


-- ------------------------------------------------------------
-- 9. PERMISSIONS & ROLE GRANTS
-- ------------------------------------------------------------

-- Strict Lock Down: Table Direct Access Revoked
REVOKE ALL ON TABLE public.competition_question_result_snapshots FROM PUBLIC;
REVOKE ALL ON TABLE public.competition_question_result_snapshots FROM anon;
REVOKE ALL ON TABLE public.competition_question_result_snapshots FROM authenticated;

-- Strict Lock Down: Private Snapshot Helper (No direct client execution)
REVOKE EXECUTE ON FUNCTION private.competition_snapshot_question_result_internal(UUID, UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.competition_snapshot_question_result_internal(UUID, UUID, TIMESTAMPTZ) FROM anon;
REVOKE EXECUTE ON FUNCTION private.competition_snapshot_question_result_internal(UUID, UUID, TIMESTAMPTZ) FROM authenticated;

-- Host Close Question Helpers
REVOKE EXECUTE ON FUNCTION private.competition_host_close_question_internal(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.competition_host_close_question_internal(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION private.competition_host_close_question_internal(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.competition_host_close_question(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.competition_host_close_question(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.competition_host_close_question(UUID) TO authenticated;

-- Host Next Question Helpers
REVOKE EXECUTE ON FUNCTION private.competition_host_next_question_internal(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.competition_host_next_question_internal(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION private.competition_host_next_question_internal(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.competition_host_next_question(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.competition_host_next_question(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.competition_host_next_question(UUID) TO authenticated;

-- Finish Session Helpers
REVOKE EXECUTE ON FUNCTION private.competition_finish_session_internal(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.competition_finish_session_internal(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION private.competition_finish_session_internal(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.competition_host_finish_session(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.competition_host_finish_session(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.competition_host_finish_session(UUID) TO authenticated;

-- Host Results Helpers
REVOKE EXECUTE ON FUNCTION private.competition_host_get_question_results_internal(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.competition_host_get_question_results_internal(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION private.competition_host_get_question_results_internal(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.competition_host_get_question_results(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.competition_host_get_question_results(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.competition_host_get_question_results(UUID) TO authenticated;

-- Host Session Metadata Helpers
REVOKE EXECUTE ON FUNCTION private.competition_host_get_session_metadata_internal(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.competition_host_get_session_metadata_internal(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION private.competition_host_get_session_metadata_internal(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.competition_host_get_session_metadata(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.competition_host_get_session_metadata(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.competition_host_get_session_metadata(UUID) TO authenticated;

-- Host Historical Result by Order Helpers
REVOKE EXECUTE ON FUNCTION private.competition_host_get_question_result_by_order_internal(UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.competition_host_get_question_result_by_order_internal(UUID, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION private.competition_host_get_question_result_by_order_internal(UUID, INTEGER) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.competition_host_get_question_result_by_order(UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.competition_host_get_question_result_by_order(UUID, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.competition_host_get_question_result_by_order(UUID, INTEGER) TO authenticated;

COMMIT;
