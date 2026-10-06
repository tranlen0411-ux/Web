-- ============================================================
-- COMPETITION V1 POST-SESSION QUESTION REVIEW MODE (MIGRATION 11)
-- SCOPE:
-- 1. ADD COLUMN review_enabled to public.competition_sessions (DEFAULT false)
-- 2. DROP old 8-arg public.competition_host_create_session overload
-- 3. CREATE canonical 9-arg public.competition_host_create_session with p_review_enabled
-- 4. ACL Hardening on canonical 9-arg host create function
-- 5. CREATE private.competition_student_get_review_internal (Self-Secured SECURITY DEFINER)
-- 6. CREATE public.competition_student_get_review (SECURITY INVOKER)
-- 7. ACL Hardening on review functions (Revoke PUBLIC/anon, Grant authenticated)
-- ============================================================

BEGIN;

-- Conservative timeout protections
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ------------------------------------------------------------
-- 1. ADD COLUMN: review_enabled on public.competition_sessions
-- ------------------------------------------------------------
ALTER TABLE public.competition_sessions
    ADD COLUMN review_enabled BOOLEAN NOT NULL DEFAULT false;

-- ------------------------------------------------------------
-- 2. DROP OLD 8-ARG HOST CREATE FUNCTION TO PREVENT OVERLOAD
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.competition_host_create_session(
    TEXT, TEXT, TEXT, INT, JSONB, JSONB, BOOLEAN, JSONB
);

-- ------------------------------------------------------------
-- 3. CREATE CANONICAL 9-ARG HOST CREATE FUNCTION
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.competition_host_create_session(
    p_title TEXT,
    p_description TEXT DEFAULT NULL,
    p_mode TEXT DEFAULT 'individual',
    p_max_participants INT DEFAULT 100,
    p_questions JSONB DEFAULT '[]'::jsonb,
    p_teams JSONB DEFAULT '[]'::jsonb,
    p_reward_enabled BOOLEAN DEFAULT false,
    p_reward_config JSONB DEFAULT '{}'::jsonb,
    p_review_enabled BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_role TEXT;
    v_title VARCHAR(255);
    v_mode VARCHAR(20);
    v_max_participants INT;
    v_q_count INT;
    v_session_id UUID;
    v_room_code VARCHAR(10);
    v_alphabet TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    v_rand_idx INT;
    v_code_attempt INT := 0;
    v_code_found BOOLEAN := false;
    v_seen_orders INT[] := ARRAY[]::INT[];
    
    -- Question iteration variables
    v_q_elem JSONB;
    v_q_order INT;
    v_q_text TEXT;
    v_q_type VARCHAR(30);
    v_q_options JSONB;
    v_q_correct JSONB;
    v_q_points NUMERIC(6, 2);
    v_q_time_limit INT;
    v_q_explanation TEXT;
    
    -- Option checking variables
    v_opt_elem JSONB;
    v_opt_id TEXT;
    v_opt_ids_seen TEXT[];
    v_target_opt_id TEXT;
    
    -- Team iteration variables
    v_team_elem JSONB;
    v_team_name VARCHAR(100);
    v_team_color VARCHAR(30);
BEGIN
    -- 1. Caller Authentication Check
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'UNAUTHORIZED',
            'message', 'Yêu cầu đăng nhập để tạo phòng thi.'
        );
    END IF;

    -- 2. Authorization: Profile Role Check (Teacher or Admin only)
    SELECT role INTO v_role
    FROM public.profiles
    WHERE id = v_caller_id;

    IF v_role IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'PROFILE_NOT_FOUND',
            'message', 'Không tìm thấy hồ sơ người dùng.'
        );
    END IF;

    IF v_role NOT IN ('teacher', 'admin') THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'ROLE_NOT_ALLOWED',
            'message', 'Chỉ tài khoản giáo viên hoặc quản trị viên mới được phép tạo phòng thi.'
        );
    END IF;

    -- 3. Title & Basic Parameters Validation
    v_title := pg_catalog.btrim(COALESCE(p_title, ''));
    IF v_title = '' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_TITLE',
            'message', 'Tiêu đề phòng thi không được để trống.'
        );
    END IF;

    v_mode := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_mode, 'individual')));
    IF v_mode NOT IN ('individual', 'team') THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_MODE',
            'message', 'Chế độ phòng thi không hợp lệ (yêu cầu individual hoặc team).'
        );
    END IF;

    v_max_participants := COALESCE(p_max_participants, 100);
    IF v_max_participants < 1 OR v_max_participants > 1000 THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_MAX_PARTICIPANTS',
            'message', 'Số lượng người tham gia tối đa phải nằm trong khoảng từ 1 đến 1000.'
        );
    END IF;

    -- 4. Question Sequence & Canonical Format Pre-validation
    IF p_questions IS NULL 
       OR pg_catalog.jsonb_typeof(p_questions) <> 'array' 
       OR pg_catalog.jsonb_array_length(p_questions) = 0 THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'NO_QUESTIONS',
            'message', 'Phòng thi yêu cầu ít nhất một câu hỏi.'
        );
    END IF;

    v_q_count := pg_catalog.jsonb_array_length(p_questions);

    FOR v_q_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_questions)
    LOOP
        IF pg_catalog.jsonb_typeof(v_q_elem) <> 'object' THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                'message', 'Cấu trúc câu hỏi phải là một đối tượng JSON hợp lệ.'
            );
        END IF;

        -- Extract and validate question_order (integer, 1..N contiguous)
        IF NOT (v_q_elem ? 'question_order') 
           OR pg_catalog.jsonb_typeof(v_q_elem->'question_order') <> 'number' THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'INVALID_QUESTION_SEQUENCE',
                'message', 'Thứ tự câu hỏi (question_order) không hợp lệ.'
            );
        END IF;

        v_q_order := (v_q_elem->>'question_order')::INT;
        IF v_q_order < 1 OR v_q_order > v_q_count THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'INVALID_QUESTION_SEQUENCE',
                'message', 'Thứ tự câu hỏi phải là dãy liên tục từ 1 đến tổng số câu hỏi.'
            );
        END IF;

        IF v_q_order = ANY(v_seen_orders) THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'INVALID_QUESTION_SEQUENCE',
                'message', 'Thứ tự câu hỏi bị trùng lặp.'
            );
        END IF;
        v_seen_orders := pg_catalog.array_append(v_seen_orders, v_q_order);

        -- Validate question_text
        v_q_text := pg_catalog.btrim(COALESCE(v_q_elem->>'question_text', ''));
        IF v_q_text = '' THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                'message', 'Nội dung câu hỏi không được để trống.'
            );
        END IF;

        -- Validate question_type
        v_q_type := pg_catalog.btrim(COALESCE(v_q_elem->>'question_type', 'single_choice'));
        IF v_q_type NOT IN ('single_choice', 'multiple_choice', 'true_false', 'short_answer') THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                'message', 'Loại câu hỏi không được hỗ trợ.'
            );
        END IF;

        -- Validate points and time_limit
        v_q_points := COALESCE((v_q_elem->>'points')::NUMERIC, 10.00);
        IF v_q_points < 0.00 THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                'message', 'Điểm số của câu hỏi không được âm.'
            );
        END IF;

        v_q_time_limit := COALESCE((v_q_elem->>'time_limit_seconds')::INT, 30);
        IF v_q_time_limit < 5 OR v_q_time_limit > 600 THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                'message', 'Thời gian làm bài mỗi câu phải từ 5 đến 600 giây.'
            );
        END IF;

        -- Canonical Options & Correct Answer Validation
        CASE v_q_type
            WHEN 'single_choice' THEN
                IF NOT (v_q_elem ? 'options') 
                   OR pg_catalog.jsonb_typeof(v_q_elem->'options') <> 'array' 
                   OR pg_catalog.jsonb_array_length(v_q_elem->'options') < 2 THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                        'message', 'Câu hỏi một lựa chọn yêu cầu ít nhất 2 phương án.'
                    );
                END IF;

                IF NOT (v_q_elem ? 'correct_answer')
                   OR pg_catalog.jsonb_typeof(v_q_elem->'correct_answer') <> 'object'
                   OR NOT (v_q_elem->'correct_answer' ? 'option_id')
                   OR v_q_elem->'correct_answer'->>'option_id' IS NULL
                   OR pg_catalog.btrim(v_q_elem->'correct_answer'->>'option_id') = '' THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                        'message', 'Đáp án đúng câu hỏi một lựa chọn không hợp lệ theo chuẩn canonical.'
                    );
                END IF;

                v_target_opt_id := v_q_elem->'correct_answer'->>'option_id';
                v_opt_ids_seen := ARRAY[]::TEXT[];
                FOR v_opt_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(v_q_elem->'options')
                LOOP
                    IF pg_catalog.jsonb_typeof(v_opt_elem) <> 'object' 
                       OR NOT (v_opt_elem ? 'id') 
                       OR pg_catalog.btrim(COALESCE(v_opt_elem->>'id', '')) = '' THEN
                        RETURN pg_catalog.jsonb_build_object(
                            'success', false,
                            'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                            'message', 'Mỗi lựa chọn phải có định danh id hợp lệ.'
                        );
                    END IF;
                    v_opt_ids_seen := pg_catalog.array_append(v_opt_ids_seen, v_opt_elem->>'id');
                END LOOP;

                IF NOT (v_target_opt_id = ANY(v_opt_ids_seen)) THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                        'message', 'Đáp án đúng không tồn tại trong danh sách lựa chọn.'
                    );
                END IF;

            WHEN 'multiple_choice' THEN
                IF NOT (v_q_elem ? 'options') 
                   OR pg_catalog.jsonb_typeof(v_q_elem->'options') <> 'array' 
                   OR pg_catalog.jsonb_array_length(v_q_elem->'options') < 2 THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                        'message', 'Câu hỏi nhiều lựa chọn yêu cầu ít nhất 2 phương án.'
                    );
                END IF;

                IF NOT (v_q_elem ? 'correct_answer')
                   OR pg_catalog.jsonb_typeof(v_q_elem->'correct_answer') <> 'object'
                   OR NOT (v_q_elem->'correct_answer' ? 'option_ids')
                   OR pg_catalog.jsonb_typeof(v_q_elem->'correct_answer'->'option_ids') <> 'array'
                   OR pg_catalog.jsonb_array_length(v_q_elem->'correct_answer'->'option_ids') < 1 THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                        'message', 'Đáp án đúng câu hỏi nhiều lựa chọn không hợp lệ theo chuẩn canonical.'
                    );
                END IF;

                v_opt_ids_seen := ARRAY[]::TEXT[];
                FOR v_opt_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(v_q_elem->'options')
                LOOP
                    IF pg_catalog.jsonb_typeof(v_opt_elem) <> 'object' 
                       OR NOT (v_opt_elem ? 'id') 
                       OR pg_catalog.btrim(COALESCE(v_opt_elem->>'id', '')) = '' THEN
                        RETURN pg_catalog.jsonb_build_object(
                            'success', false,
                            'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                            'message', 'Mỗi lựa chọn phải có định danh id hợp lệ.'
                        );
                    END IF;
                    v_opt_ids_seen := pg_catalog.array_append(v_opt_ids_seen, v_opt_elem->>'id');
                END LOOP;

                FOR v_opt_id IN SELECT * FROM pg_catalog.jsonb_array_elements_text(v_q_elem->'correct_answer'->'option_ids')
                LOOP
                    IF NOT (v_opt_id = ANY(v_opt_ids_seen)) THEN
                        RETURN pg_catalog.jsonb_build_object(
                            'success', false,
                            'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                            'message', 'Một trong các đáp án đúng không tồn tại trong danh sách lựa chọn.'
                        );
                    END IF;
                END LOOP;

            WHEN 'true_false' THEN
                IF NOT (v_q_elem ? 'options') 
                   OR pg_catalog.jsonb_typeof(v_q_elem->'options') <> 'array' 
                   OR pg_catalog.jsonb_array_length(v_q_elem->'options') <> 2 THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                        'message', 'Câu hỏi đúng/sai yêu cầu chính xác 2 lựa chọn.'
                    );
                END IF;

                IF NOT (v_q_elem ? 'correct_answer')
                   OR pg_catalog.jsonb_typeof(v_q_elem->'correct_answer') <> 'object'
                   OR NOT (v_q_elem->'correct_answer' ? 'option_id')
                   OR v_q_elem->'correct_answer'->>'option_id' NOT IN ('true', 'false') THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                        'message', 'Đáp án đúng câu hỏi đúng/sai phải là true hoặc false.'
                    );
                END IF;

            WHEN 'short_answer' THEN
                IF NOT (v_q_elem ? 'correct_answer')
                   OR pg_catalog.jsonb_typeof(v_q_elem->'correct_answer') <> 'object'
                   OR NOT (v_q_elem->'correct_answer' ? 'accepted_answers')
                   OR pg_catalog.jsonb_typeof(v_q_elem->'correct_answer'->'accepted_answers') <> 'array'
                   OR pg_catalog.jsonb_array_length(v_q_elem->'correct_answer'->'accepted_answers') < 1 THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                        'message', 'Đáp án đúng câu hỏi trả lời ngắn yêu cầu ít nhất một đáp án được chấp nhận.'
                    );
                END IF;
        END CASE;
    END LOOP;

    -- Verify no gaps in question order (must have all 1..v_q_count)
    IF pg_catalog.cardinality(v_seen_orders) <> v_q_count THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_QUESTION_SEQUENCE',
            'message', 'Dãy thứ tự câu hỏi bị ngắt quãng.'
        );
    END IF;

    -- 5. Team validation if mode = team
    IF v_mode = 'team' THEN
        IF p_teams IS NOT NULL AND pg_catalog.jsonb_typeof(p_teams) = 'array' THEN
            FOR v_team_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_teams)
            LOOP
                IF pg_catalog.jsonb_typeof(v_team_elem) <> 'object' 
                   OR NOT (v_team_elem ? 'team_name') 
                   OR pg_catalog.btrim(COALESCE(v_team_elem->>'team_name', '')) = '' THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'MALFORMED_TEAM_PAYLOAD',
                        'message', 'Thông tin đội thi không hợp lệ.'
                    );
                END IF;
            END LOOP;
        END IF;
    END IF;

    -- 6. Server-side Room Code Generation with Bounded Retry
    WHILE v_code_attempt < 10 AND NOT v_code_found LOOP
        v_code_attempt := v_code_attempt + 1;
        v_room_code := '';
        FOR i IN 1..6 LOOP
            v_rand_idx := 1 + (pg_catalog.floor(random() * 32)::INT);
            v_room_code := v_room_code || pg_catalog.substr(v_alphabet, v_rand_idx, 1);
        END LOOP;

        IF NOT EXISTS (
            SELECT 1 FROM public.competition_sessions
            WHERE room_code = v_room_code AND status IN ('waiting', 'in_progress', 'paused')
        ) THEN
            v_code_found := true;
        END IF;
    END LOOP;

    IF NOT v_code_found THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'ROOM_CODE_GENERATION_FAILED',
            'message', 'Không thể khởi tạo mã phòng thi ngẫu nhiên. Vui lòng thử lại.'
        );
    END IF;

    -- 7. Atomic Insert of Session Row
    BEGIN
        INSERT INTO public.competition_sessions (
            host_id,
            room_code,
            title,
            description,
            mode,
            status,
            max_participants,
            current_question_index,
            current_question_id,
            question_deadline,
            paused_remaining_ms,
            reward_enabled,
            reward_config,
            reward_status,
            review_enabled,
            started_at,
            ended_at,
            created_at,
            updated_at
        ) VALUES (
            v_caller_id,
            v_room_code,
            v_title,
            NULLIF(pg_catalog.btrim(COALESCE(p_description, '')), ''),
            v_mode,
            'waiting',
            v_max_participants,
            0,
            NULL,
            NULL,
            NULL,
            COALESCE(p_reward_enabled, false),
            COALESCE(p_reward_config, '{}'::jsonb),
            'not_applicable',
            COALESCE(p_review_enabled, false),
            NULL,
            NULL,
            pg_catalog.now(),
            pg_catalog.now()
        ) RETURNING id INTO v_session_id;
    EXCEPTION
        WHEN unique_violation THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'ROOM_CODE_GENERATION_FAILED',
                'message', 'Mã phòng thi bị trùng lặp trong phiên đồng thời. Vui lòng thử lại.'
            );
    END;

    -- 8. Atomic Insert of Questions
    FOR v_q_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_questions)
    LOOP
        v_q_order := (v_q_elem->>'question_order')::INT;
        v_q_text := pg_catalog.btrim(v_q_elem->>'question_text');
        v_q_type := pg_catalog.btrim(COALESCE(v_q_elem->>'question_type', 'single_choice'));
        v_q_options := COALESCE(v_q_elem->'options', '[]'::jsonb);
        v_q_correct := v_q_elem->'correct_answer';
        v_q_points := COALESCE((v_q_elem->>'points')::NUMERIC, 10.00);
        v_q_time_limit := COALESCE((v_q_elem->>'time_limit_seconds')::INT, 30);
        v_q_explanation := NULLIF(pg_catalog.btrim(COALESCE(v_q_elem->>'explanation', '')), '');

        INSERT INTO public.competition_questions (
            session_id,
            question_order,
            question_text,
            question_type,
            options,
            correct_answer,
            points,
            time_limit_seconds,
            explanation,
            created_at
        ) VALUES (
            v_session_id,
            v_q_order,
            v_q_text,
            v_q_type,
            v_q_options,
            v_q_correct,
            v_q_points,
            v_q_time_limit,
            v_q_explanation,
            pg_catalog.now()
        );
    END LOOP;

    -- 9. Atomic Insert of Teams (if mode = team)
    IF v_mode = 'team' AND p_teams IS NOT NULL AND pg_catalog.jsonb_typeof(p_teams) = 'array' THEN
        FOR v_team_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_teams)
        LOOP
            v_team_name := pg_catalog.btrim(v_team_elem->>'team_name');
            v_team_color := NULLIF(pg_catalog.btrim(COALESCE(v_team_elem->>'team_color', '')), '');

            INSERT INTO public.competition_teams (
                session_id,
                team_name,
                team_color,
                created_at
            ) VALUES (
                v_session_id,
                v_team_name,
                v_team_color,
                pg_catalog.now()
            );
        END LOOP;
    END IF;

    -- 10. Return Structured Sanitized Success Payload
    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'session', pg_catalog.jsonb_build_object(
            'id', v_session_id,
            'host_id', v_caller_id,
            'room_code', v_room_code,
            'title', v_title,
            'description', NULLIF(pg_catalog.btrim(COALESCE(p_description, '')), ''),
            'mode', v_mode,
            'status', 'waiting',
            'max_participants', v_max_participants,
            'current_question_index', 0,
            'question_count', v_q_count,
            'reward_enabled', COALESCE(p_reward_enabled, false),
            'review_enabled', COALESCE(p_review_enabled, false),
            'created_at', pg_catalog.now()
        )
    );
END;
$$;

-- ------------------------------------------------------------
-- 4. ACL FOR CANONICAL 9-ARG HOST CREATE FUNCTION
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.competition_host_create_session(
    TEXT, TEXT, TEXT, INT, JSONB, JSONB, BOOLEAN, JSONB, BOOLEAN
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.competition_host_create_session(
    TEXT, TEXT, TEXT, INT, JSONB, JSONB, BOOLEAN, JSONB, BOOLEAN
) TO authenticated;

-- ------------------------------------------------------------
-- 5. PRIVATE REVIEW HELPER: competition_student_get_review_internal
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.competition_student_get_review_internal(
    p_session_id UUID,
    p_participant_id UUID
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
    v_participant RECORD;
    v_questions JSONB;
BEGIN
    -- 1. Input Validation
    IF p_session_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_ID',
            'message', 'ID phòng thi không được để trống.'
        );
    END IF;

    IF p_participant_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_PARTICIPANT_ID',
            'message', 'ID thí sinh không được để trống.'
        );
    END IF;

    -- 2. Auth Identity Gate: Require authenticated session
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'UNAUTHORIZED',
            'message', 'Yêu cầu đăng nhập để xem lại bài thi.'
        );
    END IF;

    -- 3. Role Gate: Check profile role (students only)
    SELECT role INTO v_caller_role
    FROM public.profiles
    WHERE id = v_caller_id;

    IF v_caller_role IS NULL OR v_caller_role <> 'student' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'ROLE_NOT_ALLOWED',
            'message', 'Chỉ tài khoản học sinh mới được phép truy xuất xem lại bài làm cá nhân.'
        );
    END IF;

    -- 4. Session Existence & Status Gate
    SELECT id, status, review_enabled
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

    IF v_session.status <> 'finished' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_NOT_FINISHED',
            'message', 'Phòng thi chưa kết thúc, chưa thể xem lại bài thi.'
        );
    END IF;

    -- 5. Review Permission Gate
    IF v_session.review_enabled IS NOT TRUE THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'REVIEW_NOT_ALLOWED',
            'message', 'Giáo viên không mở tính năng xem lại bài làm cho phòng thi này.'
        );
    END IF;

    -- 6. Participant Identity & Session Integrity Gate
    SELECT id, session_id, user_id, is_guest, status
    INTO v_participant
    FROM public.competition_participants
    WHERE id = p_participant_id AND session_id = p_session_id;

    IF v_participant.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'PARTICIPANT_NOT_FOUND',
            'message', 'Không tìm thấy thông tin thí sinh trong phòng thi này.'
        );
    END IF;

    IF v_participant.is_guest IS TRUE OR v_participant.user_id IS DISTINCT FROM v_caller_id THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'PARTICIPANT_NOT_FOUND',
            'message', 'Thông tin thí sinh không khớp với tài khoản đăng nhập.'
        );
    END IF;

    IF v_participant.status = 'kicked' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'PARTICIPANT_KICKED',
            'message', 'Bạn đã bị xóa khỏi phòng thi này.'
        );
    END IF;

    -- 7. Query Questions and Student Answers with Deterministic Ordering (question_order ASC)
    SELECT COALESCE(
        pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
                'question_id', q.id,
                'question_order', q.question_order,
                'question_text', q.question_text,
                'question_type', q.question_type,
                'options', q.options,
                'correct_answer', q.correct_answer,
                'explanation', q.explanation,
                'points', q.points,
                'student_answer', CASE 
                    WHEN a.id IS NOT NULL THEN pg_catalog.jsonb_build_object(
                        'selected_option_ids', a.selected_option_ids,
                        'text_answer', a.text_answer,
                        'is_correct', a.is_correct,
                        'points_awarded', a.points_awarded,
                        'time_taken_ms', a.time_taken_ms,
                        'submitted_at', a.submitted_at
                    )
                    ELSE NULL
                END
            )
            ORDER BY q.question_order ASC
        ),
        '[]'::jsonb
    )
    INTO v_questions
    FROM public.competition_questions q
    LEFT JOIN public.competition_answers a 
        ON a.session_id = q.session_id 
       AND a.question_id = q.id 
       AND a.participant_id = v_participant.id
    WHERE q.session_id = p_session_id;

    -- 8. Return Structured Success Payload
    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'session', pg_catalog.jsonb_build_object(
            'id', v_session.id,
            'review_enabled', v_session.review_enabled
        ),
        'questions', v_questions
    );
END;
$$;

-- ------------------------------------------------------------
-- 6. PUBLIC SECURITY INVOKER WRAPPER: competition_student_get_review
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.competition_student_get_review(
    p_session_id UUID,
    p_participant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RETURN private.competition_student_get_review_internal(
        p_session_id,
        p_participant_id
    );
END;
$$;

-- ------------------------------------------------------------
-- 7. ACL PERMISSIONS FOR REVIEW FUNCTIONS
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION private.competition_student_get_review_internal(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.competition_student_get_review_internal(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.competition_student_get_review(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.competition_student_get_review(UUID, UUID) TO authenticated;

COMMIT;
