-- ============================================================
-- COMPETITION V1 R7 — HOST QUESTION DIFFICULTY & ACCURACY ANALYTICS
-- Migration 12: Additive aggregate analytics RPC for finished sessions.
--
-- Security Invariants:
-- - Private helper: SECURITY DEFINER, search_path = ''
-- - Public wrapper: SECURITY INVOKER, search_path = ''
-- - Host ownership or Admin profile role strictly enforced
-- - Session status strictly gated to 'finished'
-- - Option A semantics: Final session roster denominator
-- - Zero PII returned (No user_id, email, display_name, guest_token_hash)
-- - Zero raw student answer rows returned (Server-side aggregation only)
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ------------------------------------------------------------
-- 1. PRIVATE HELPER: competition_host_get_question_analytics_internal
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.competition_host_get_question_analytics_internal(
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
    v_final_roster_count INT := 0;
    v_total_questions INT := 0;
    v_total_answered INT := 0;
    v_total_correct INT := 0;
    v_total_unanswered INT := 0;
    v_overall_accuracy NUMERIC(5, 2) := 0.00;
    v_questions JSONB := '[]'::jsonb;
BEGIN
    -- 1. Input Validation
    IF p_session_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_ID',
            'message', 'ID phòng thi không được để trống.'
        );
    END IF;

    -- 2. Authorization Check 1: Require Authenticated Identity
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'UNAUTHENTICATED',
            'message', 'Yêu cầu đăng nhập để xem phân tích câu hỏi.'
        );
    END IF;

    -- 3. Load Session Record
    SELECT id, host_id, title, room_code, status, mode
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

    -- 4. Authorization Check 2: Host Ownership or Admin Profile Role
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
            'error_code', 'FORBIDDEN',
            'message', 'Bạn không có quyền xem dữ liệu phân tích của phòng thi này.'
        );
    END IF;

    -- 5. Session Status Gate: Finished sessions only
    IF v_session.status <> 'finished' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_NOT_FINISHED',
            'message', 'Báo cáo phân tích chỉ khả dụng sau khi phòng thi đã hoàn thành.'
        );
    END IF;

    -- 6. Compute Final Roster Count (Excluding kicked participants)
    SELECT COUNT(*)::int
    INTO v_final_roster_count
    FROM public.competition_participants
    WHERE session_id = p_session_id
      AND status <> 'kicked';

    -- 7. Compute Per-Question Analytics and Option Distributions (Set-Based CTE)
    WITH question_base AS (
        SELECT 
            q.id AS question_id,
            q.question_order,
            q.question_type,
            q.question_text,
            q.options,
            q.correct_answer,
            q.points,
            q.time_limit_seconds,
            COUNT(a.id)::int AS answered_count,
            COUNT(a.id) FILTER (WHERE a.is_correct IS TRUE)::int AS correct_count,
            COUNT(a.id) FILTER (WHERE a.is_correct IS FALSE)::int AS incorrect_count,
            COALESCE(ROUND(AVG(a.points_awarded)::numeric, 2), 0.00) AS average_points,
            COALESCE(ROUND(AVG(a.time_taken_ms)::numeric), 0) AS average_response_time_ms
        FROM public.competition_questions q
        LEFT JOIN public.competition_answers a 
            ON a.session_id = p_session_id 
           AND a.question_id = q.id
           AND a.participant_id IN (
               SELECT id FROM public.competition_participants 
               WHERE session_id = p_session_id AND status <> 'kicked'
           )
        WHERE q.session_id = p_session_id
        GROUP BY q.id, q.question_order, q.question_type, q.question_text, q.options, q.correct_answer, q.points, q.time_limit_seconds
        ORDER BY q.question_order ASC
    ),
    question_analytics AS (
        SELECT 
            qb.question_id,
            qb.question_order,
            qb.question_type,
            qb.question_text,
            qb.points,
            qb.time_limit_seconds,
            v_final_roster_count AS final_roster_count,
            qb.answered_count,
            GREATEST(v_final_roster_count - qb.answered_count, 0)::int AS unanswered_count,
            qb.correct_count,
            qb.incorrect_count,
            CASE 
                WHEN v_final_roster_count > 0 
                THEN ROUND((qb.correct_count::numeric * 100.0 / v_final_roster_count::numeric), 2)
                ELSE 0.00 
            END AS accuracy_percent,
            qb.average_points,
            qb.average_response_time_ms,
            CASE 
                WHEN qb.question_type IN ('single_choice', 'true_false', 'multiple_choice') THEN (
                    SELECT COALESCE(pg_catalog.jsonb_agg(
                        pg_catalog.jsonb_build_object(
                            'option_id', opt->>'id',
                            'option_text', opt->>'text',
                            'selection_count', COALESCE(opt_stats.cnt, 0),
                            'selection_percent', CASE 
                                WHEN qb.answered_count > 0 
                                THEN ROUND((COALESCE(opt_stats.cnt, 0)::numeric * 100.0 / qb.answered_count::numeric), 2)
                                ELSE 0.00
                            END,
                            'is_correct', CASE 
                                WHEN qb.question_type IN ('single_choice', 'true_false') THEN
                                    (opt->>'id') = (qb.correct_answer->>'option_id')
                                WHEN qb.question_type = 'multiple_choice' THEN
                                    (qb.correct_answer->'option_ids') ? (opt->>'id')
                                ELSE false
                            END,
                            'is_correct_option', CASE 
                                WHEN qb.question_type IN ('single_choice', 'true_false') THEN
                                    (opt->>'id') = (qb.correct_answer->>'option_id')
                                WHEN qb.question_type = 'multiple_choice' THEN
                                    (qb.correct_answer->'option_ids') ? (opt->>'id')
                                ELSE false
                            END
                        ) ORDER BY opt_idx
                    ), '[]'::jsonb)
                    FROM pg_catalog.jsonb_array_elements(qb.options) WITH ORDINALITY AS opt_arr(opt, opt_idx)
                    LEFT JOIN (
                        SELECT 
                            elem.val AS opt_id,
                            COUNT(*)::int AS cnt
                        FROM public.competition_answers ca
                        JOIN public.competition_participants cp 
                            ON cp.id = ca.participant_id AND cp.status <> 'kicked'
                        CROSS JOIN LATERAL pg_catalog.jsonb_array_elements_text(ca.selected_option_ids) AS elem(val)
                        WHERE ca.session_id = p_session_id
                          AND ca.question_id = qb.question_id
                        GROUP BY elem.val
                    ) opt_stats ON opt_stats.opt_id = (opt->>'id')
                )
                ELSE '[]'::jsonb
            END AS option_distribution
        FROM question_base qb
    )
    SELECT 
        COALESCE(pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
                'question_id', qa.question_id,
                'question_order', qa.question_order,
                'question_type', qa.question_type,
                'question_text', qa.question_text,
                'points', qa.points,
                'time_limit_seconds', qa.time_limit_seconds,
                'final_roster_count', qa.final_roster_count,
                'answered_count', qa.answered_count,
                'unanswered_count', qa.unanswered_count,
                'correct_count', qa.correct_count,
                'incorrect_count', qa.incorrect_count,
                'accuracy_percent', qa.accuracy_percent,
                'average_points', qa.average_points,
                'average_response_time_ms', qa.average_response_time_ms,
                'option_distribution', qa.option_distribution
            ) ORDER BY qa.question_order ASC
        ), '[]'::jsonb),
        COUNT(*)::int,
        COALESCE(SUM(qa.answered_count), 0)::int,
        COALESCE(SUM(qa.correct_count), 0)::int,
        COALESCE(SUM(qa.unanswered_count), 0)::int
    INTO 
        v_questions,
        v_total_questions,
        v_total_answered,
        v_total_correct,
        v_total_unanswered
    FROM question_analytics qa;

    -- 8. Compute Overall Summary Accuracy
    IF (v_final_roster_count * v_total_questions) > 0 THEN
        v_overall_accuracy := ROUND((v_total_correct::numeric * 100.0 / (v_final_roster_count * v_total_questions)::numeric), 2);
    ELSE
        v_overall_accuracy := 0.00;
    END IF;

    -- 9. Return Structured Aggregate Payload (Zero PII, Zero Raw Answers)
    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'session_id', v_session.id,
        'room_code', v_session.room_code,
        'title', v_session.title,
        'mode', v_session.mode,
        'summary', pg_catalog.jsonb_build_object(
            'total_questions', v_total_questions,
            'final_roster_count', v_final_roster_count,
            'total_answered_instances', v_total_answered,
            'total_correct_instances', v_total_correct,
            'total_unanswered_instances', v_total_unanswered,
            'overall_accuracy_percent', v_overall_accuracy
        ),
        'questions', v_questions
    );
END;
$$;

-- ------------------------------------------------------------
-- 2. PUBLIC SECURITY INVOKER WRAPPER: competition_host_get_question_analytics
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.competition_host_get_question_analytics(
    p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RETURN private.competition_host_get_question_analytics_internal(p_session_id);
END;
$$;

-- ------------------------------------------------------------
-- 3. PERMISSIONS & GRANTS
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION private.competition_host_get_question_analytics_internal(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.competition_host_get_question_analytics_internal(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION private.competition_host_get_question_analytics_internal(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.competition_host_get_question_analytics(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.competition_host_get_question_analytics(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.competition_host_get_question_analytics(UUID) TO authenticated;

COMMIT;
