-- ============================================================
-- COMPETITION V1 R12 — HOST HISTORICAL QUESTION RESULTS RPC
-- Migration: Additive RPC for Host/Admin to review closed questions by question_order.
--
-- Security Invariants:
-- - Private helper: SECURITY DEFINER, search_path = ''
-- - Public wrapper: SECURITY INVOKER, search_path = ''
-- - Host ownership or Admin profile role strictly enforced
-- - Never expose answer/correct result for a question that is still open/active
-- - Accessible only when:
--     A) question_order < session.current_question_index
--     OR B) question_order = session.current_question_index AND question_deadline IS NOT NULL AND clock_timestamp() >= question_deadline
--     OR C) session.status = 'finished'
-- - Fail-closed on unauthorized, missing question, or active question
-- - Returns authoritative total_questions (COUNT(*) FROM competition_questions WHERE session_id = p_session_id)
-- - Zero PII returned (No user_id, email, guest_token_hash, raw tokens)
-- - Zero raw student answer rows returned (Server-side aggregation only)
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ------------------------------------------------------------
-- 1. PRIVATE HELPER: competition_host_get_question_result_by_order_internal
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
    v_is_authorized BOOLEAN := false;
    v_is_readable BOOLEAN := false;
    v_total_questions INT := 0;
    v_total_eligible INT := 0;
    v_submitted_count INT := 0;
    v_unanswered_count INT := 0;
    v_correct_count INT := 0;
    v_incorrect_count INT := 0;
    v_correct_percentage NUMERIC(5, 1) := 0.0;
    v_distribution JSONB := '[]'::jsonb;
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

    -- 4. Check Ownership or Admin Role from public.profiles
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

    -- Fail-closed on invalid / cancelled session states
    IF v_session.status NOT IN ('in_progress', 'paused', 'finished') THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'QUESTION_STILL_ACTIVE',
            'message', 'Phòng thi không ở trạng thái thi đấu hoặc đã hoàn thành.'
        );
    END IF;

    -- 5. Load Question Record by exact question_order
    SELECT id, session_id, question_order, question_type, question_text, options, correct_answer, points
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
    -- Historical result is readable only when:
    -- A) question_order < session.current_question_index
    -- OR B) question_order = session.current_question_index AND question_deadline IS NOT NULL AND clock_timestamp() >= question_deadline
    -- OR C) session.status = 'finished'
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

    -- 7. Count Authoritative Total Questions
    SELECT pg_catalog.count(*)::INT
    INTO v_total_questions
    FROM public.competition_questions
    WHERE session_id = p_session_id;

    -- 8. Count Eligible Population & Answer Aggregates
    SELECT pg_catalog.count(*)::INT
    INTO v_total_eligible
    FROM public.competition_participants
    WHERE session_id = p_session_id
      AND status <> 'kicked';

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
    WHERE a.session_id = p_session_id
      AND a.question_id = v_question.id;

    v_unanswered_count := GREATEST(v_total_eligible - v_submitted_count, 0);

    IF v_submitted_count > 0 THEN
        v_correct_percentage := pg_catalog.round((v_correct_count::NUMERIC * 100.0) / v_submitted_count::NUMERIC, 1);
    ELSE
        v_correct_percentage := 0.0;
    END IF;

    -- 9. Compute Distribution
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
                    WHERE a.session_id = p_session_id
                      AND a.question_id = v_question.id
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
        -- short_answer or unsupported: empty distribution
        v_distribution := '[]'::jsonb;
    END IF;

    -- 10. Return Sanitized Result Shape with Authoritative total_questions
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
        'total_eligible', v_total_eligible,
        'submitted_count', v_submitted_count,
        'unanswered_count', v_unanswered_count,
        'correct_count', v_correct_count,
        'incorrect_count', v_incorrect_count,
        'correct_percentage', v_correct_percentage,
        'distribution', v_distribution,
        'total_questions', v_total_questions
    );
END;
$$;


-- ------------------------------------------------------------
-- 2. PUBLIC SECURITY INVOKER WRAPPER: competition_host_get_question_result_by_order
-- ------------------------------------------------------------
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
-- 3. PERMISSIONS & ROLE GRANTS
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION private.competition_host_get_question_result_by_order_internal(UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.competition_host_get_question_result_by_order_internal(UUID, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION private.competition_host_get_question_result_by_order_internal(UUID, INTEGER) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.competition_host_get_question_result_by_order(UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.competition_host_get_question_result_by_order(UUID, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.competition_host_get_question_result_by_order(UUID, INTEGER) TO authenticated;

COMMIT;
