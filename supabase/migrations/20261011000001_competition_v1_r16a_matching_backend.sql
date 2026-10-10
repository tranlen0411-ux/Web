-- ============================================================================
-- MIGRATION: 20261011000001_competition_v1_r16a_matching_backend.sql
-- PURPOSE: Competition V1 R16-A Matching Question Type Backend Contract
--
-- INVARIANTS ENFORCED:
-- 1. Updates check_competition_question_type constraint to allow 'matching'.
-- 2. Preserves canonical options shape as JSON array of objects with id, side, text.
-- 3. Server-side validation for Matching in public.competition_host_create_session:
--    - 2 to 6 pairs (equal left & right counts).
--    - Unique IDs across both sides.
--    - Canonical correct_answer with pairs array linking left_id to right_id.
-- 4. Authoritative submission validation & scoring in private.competition_submit_answer_internal:
--    - Full credit only (exact set equality, order insensitive).
--    - Strict fail-closed validation for unknown, duplicate, or mismatched IDs.
-- 5. Preserves existing selected_option_ids JSONB column in competition_answers.
-- 6. Sanitized matching pairs distribution in private.competition_snapshot_question_result_internal.
-- 7. Host results contract (both live closed and historical by order) exposes matching_pairs only after reveal gate.
-- 8. Zero public RPC signature changes.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. UPDATE CHECK CONSTRAINT ON competition_questions
-- ------------------------------------------------------------
ALTER TABLE public.competition_questions
    DROP CONSTRAINT IF EXISTS check_competition_question_type;

ALTER TABLE public.competition_questions
    ADD CONSTRAINT check_competition_question_type
    CHECK (question_type IN ('single_choice', 'multiple_choice', 'true_false', 'short_answer', 'matching'));


-- ------------------------------------------------------------
-- 2. UPDATE: public.competition_host_create_session (9 ARGS CANONICAL)
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
    
    -- Matching specific checking variables
    v_opt_side TEXT;
    v_opt_text TEXT;
    v_left_ids TEXT[];
    v_right_ids TEXT[];
    v_all_opt_ids TEXT[];
    v_left_count INT;
    v_right_count INT;
    v_pair_elem JSONB;
    v_pair_left_id TEXT;
    v_pair_right_id TEXT;
    v_pair_left_ids_seen TEXT[];
    v_pair_right_ids_seen TEXT[];

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
        IF v_q_type NOT IN ('single_choice', 'multiple_choice', 'true_false', 'short_answer', 'matching') THEN
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

            WHEN 'matching' THEN
                -- 1. options must be a JSON array
                IF NOT (v_q_elem ? 'options') 
                   OR pg_catalog.jsonb_typeof(v_q_elem->'options') <> 'array' THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                        'message', 'Câu hỏi nối từ yêu cầu danh sách lựa chọn hợp lệ dạng JSON array.'
                    );
                END IF;

                v_left_ids := ARRAY[]::TEXT[];
                v_right_ids := ARRAY[]::TEXT[];
                v_all_opt_ids := ARRAY[]::TEXT[];

                -- 2. Validate each option object (id, side, text)
                FOR v_opt_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(v_q_elem->'options')
                LOOP
                    IF pg_catalog.jsonb_typeof(v_opt_elem) <> 'object' 
                       OR NOT (v_opt_elem ? 'id') 
                       OR NOT (v_opt_elem ? 'side') 
                       OR NOT (v_opt_elem ? 'text') THEN
                        RETURN pg_catalog.jsonb_build_object(
                            'success', false,
                            'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                            'message', 'Mỗi lựa chọn nối từ phải chứa id, side và text.'
                        );
                    END IF;

                    v_opt_id := pg_catalog.btrim(COALESCE(v_opt_elem->>'id', ''));
                    v_opt_side := pg_catalog.btrim(COALESCE(v_opt_elem->>'side', ''));
                    v_opt_text := pg_catalog.btrim(COALESCE(v_opt_elem->>'text', ''));

                    IF v_opt_id = '' OR v_opt_text = '' THEN
                        RETURN pg_catalog.jsonb_build_object(
                            'success', false,
                            'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                            'message', 'Định danh id và nội dung text của lựa chọn nối từ không được để trống.'
                        );
                    END IF;

                    IF v_opt_side NOT IN ('left', 'right') THEN
                        RETURN pg_catalog.jsonb_build_object(
                            'success', false,
                            'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                            'message', 'Thuộc tính side của lựa chọn nối từ chỉ được là left hoặc right.'
                        );
                    END IF;

                    -- IDs unique across BOTH sides
                    IF v_opt_id = ANY(v_all_opt_ids) THEN
                        RETURN pg_catalog.jsonb_build_object(
                            'success', false,
                            'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                            'message', 'Định danh lựa chọn bị trùng lặp trong câu hỏi nối từ.'
                        );
                    END IF;

                    v_all_opt_ids := pg_catalog.array_append(v_all_opt_ids, v_opt_id);

                    IF v_opt_side = 'left' THEN
                        v_left_ids := pg_catalog.array_append(v_left_ids, v_opt_id);
                    ELSE
                        v_right_ids := pg_catalog.array_append(v_right_ids, v_opt_id);
                    END IF;
                END LOOP;

                v_left_count := pg_catalog.cardinality(v_left_ids);
                v_right_count := pg_catalog.cardinality(v_right_ids);

                -- Min 2, Max 6, Left count equals Right count
                IF v_left_count < 2 OR v_left_count > 6 
                   OR v_right_count < 2 OR v_right_count > 6 
                   OR v_left_count <> v_right_count THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                        'message', 'Số lượng mục nối mỗi bên phải từ 2 đến 6 và số lượng hai bên phải bằng nhau.'
                    );
                END IF;

                -- 3. Validate correct_answer shape: {"pairs": [...]}
                IF NOT (v_q_elem ? 'correct_answer')
                   OR pg_catalog.jsonb_typeof(v_q_elem->'correct_answer') <> 'object'
                   OR NOT (v_q_elem->'correct_answer' ? 'pairs')
                   OR pg_catalog.jsonb_typeof(v_q_elem->'correct_answer'->'pairs') <> 'array'
                   OR pg_catalog.jsonb_array_length(v_q_elem->'correct_answer'->'pairs') <> v_left_count THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                        'message', 'Đáp án đúng câu hỏi nối từ không hợp lệ theo chuẩn canonical.'
                    );
                END IF;

                v_pair_left_ids_seen := ARRAY[]::TEXT[];
                v_pair_right_ids_seen := ARRAY[]::TEXT[];

                FOR v_pair_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(v_q_elem->'correct_answer'->'pairs')
                LOOP
                    IF pg_catalog.jsonb_typeof(v_pair_elem) <> 'object'
                       OR NOT (v_pair_elem ? 'left_id')
                       OR NOT (v_pair_elem ? 'right_id') THEN
                        RETURN pg_catalog.jsonb_build_object(
                            'success', false,
                            'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                            'message', 'Cặp nối đáp án đúng phải chứa left_id và right_id.'
                        );
                    END IF;

                    v_pair_left_id := pg_catalog.btrim(COALESCE(v_pair_elem->>'left_id', ''));
                    v_pair_right_id := pg_catalog.btrim(COALESCE(v_pair_elem->>'right_id', ''));

                    IF v_pair_left_id = '' OR v_pair_right_id = '' THEN
                        RETURN pg_catalog.jsonb_build_object(
                            'success', false,
                            'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                            'message', 'ID trong cặp nối đáp án đúng không được để trống.'
                        );
                    END IF;

                    -- left_id exists and side=left
                    IF NOT (v_pair_left_id = ANY(v_left_ids)) THEN
                        RETURN pg_catalog.jsonb_build_object(
                            'success', false,
                            'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                            'message', 'left_id trong đáp án đúng không tồn tại ở vế trái.'
                        );
                    END IF;

                    -- right_id exists and side=right
                    IF NOT (v_pair_right_id = ANY(v_right_ids)) THEN
                        RETURN pg_catalog.jsonb_build_object(
                            'success', false,
                            'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                            'message', 'right_id trong đáp án đúng không tồn tại ở vế phải.'
                        );
                    END IF;

                    -- every left_id used exactly once
                    IF v_pair_left_id = ANY(v_pair_left_ids_seen) THEN
                        RETURN pg_catalog.jsonb_build_object(
                            'success', false,
                            'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                            'message', 'Mỗi mục vế trái chỉ được nối chính xác một lần trong đáp án đúng.'
                        );
                    END IF;

                    -- every right_id used exactly once
                    IF v_pair_right_id = ANY(v_pair_right_ids_seen) THEN
                        RETURN pg_catalog.jsonb_build_object(
                            'success', false,
                            'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                            'message', 'Mỗi mục vế phải chỉ được nối chính xác một lần trong đáp án đúng.'
                        );
                    END IF;

                    v_pair_left_ids_seen := pg_catalog.array_append(v_pair_left_ids_seen, v_pair_left_id);
                    v_pair_right_ids_seen := pg_catalog.array_append(v_pair_right_ids_seen, v_pair_right_id);
                END LOOP;
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
                score,
                created_at
            ) VALUES (
                v_session_id,
                v_team_name,
                v_team_color,
                0,
                pg_catalog.now()
            );
        END LOOP;
    END IF;

    -- 10. Return Structured Success Response
    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'session_id', v_session_id,
        'room_code', v_room_code,
        'title', v_title,
        'mode', v_mode,
        'max_participants', v_max_participants,
        'question_count', v_q_count,
        'reward_enabled', COALESCE(p_reward_enabled, false),
        'review_enabled', COALESCE(p_review_enabled, false)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.competition_host_create_session(
    TEXT, TEXT, TEXT, INT, JSONB, JSONB, BOOLEAN, JSONB, BOOLEAN
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.competition_host_create_session(
    TEXT, TEXT, TEXT, INT, JSONB, JSONB, BOOLEAN, JSONB, BOOLEAN
) TO authenticated;


-- ------------------------------------------------------------
-- 3. UPDATE: private.competition_submit_answer_internal
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.competition_submit_answer_internal(
    p_session_id UUID,
    p_question_id UUID,
    p_participant_id UUID DEFAULT NULL,
    p_guest_token TEXT DEFAULT NULL,
    p_selected_option_ids JSONB DEFAULT '[]'::jsonb,
    p_text_answer TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_guest_token_hash VARCHAR(64);
    v_participant RECORD;
    v_session RECORD;
    v_question RECORD;
    v_score RECORD;
    v_existing_answer_id UUID;
    v_answer_id UUID;
    v_derived_start TIMESTAMPTZ;
    v_time_limit_ms BIGINT;
    v_time_taken_ms BIGINT;
    v_is_correct BOOLEAN := false;
    v_points_awarded NUMERIC(6, 2) := 0.00;
    v_correct_increment INT := 0;
    v_diag_constraint TEXT;
    
    -- Option checking variables
    v_opt_val TEXT;
    v_opt_exists BOOLEAN;
    v_student_opt TEXT;
    v_correct_target TEXT;
    v_student_arr TEXT[];
    v_correct_arr TEXT[];
    v_norm_student_text TEXT;
    v_accepted_text TEXT;

    -- Matching submission checking variables
    v_expected_pair_count INT;
    v_valid_left_ids TEXT[];
    v_valid_right_ids TEXT[];
    v_sub_left_ids_seen TEXT[];
    v_sub_right_ids_seen TEXT[];
    v_pair_elem JSONB;
    v_sub_left_id TEXT;
    v_sub_right_id TEXT;
BEGIN
    -- 1. Input Validation: IDs
    IF p_session_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_ID',
            'message', 'ID phòng thi không được để trống.'
        );
    END IF;

    IF p_question_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_QUESTION_ID',
            'message', 'ID câu hỏi không được để trống.'
        );
    END IF;

    -- 2. Stage 1: Identity Resolution (Authenticated vs Guest Read-Only Precheck)
    v_user_id := auth.uid();
    IF v_user_id IS NOT NULL THEN
        -- Check caller profile role: only students participate
        IF NOT EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = v_user_id AND role = 'student'
        ) THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'ROLE_NOT_ALLOWED',
                'message', 'Chỉ tài khoản học sinh mới được phép nộp câu trả lời.'
            );
        END IF;

        -- Resolve participant record read-only precheck
        SELECT id, session_id, user_id, is_guest, status
        INTO v_participant
        FROM public.competition_participants
        WHERE session_id = p_session_id
          AND user_id = v_user_id
          AND is_guest = false;

        IF v_participant.id IS NULL THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'PARTICIPANT_NOT_FOUND',
                'message', 'Không tìm thấy thông tin thí sinh trong phòng thi này.'
            );
        END IF;
    ELSE
        -- Guest caller validation
        IF p_participant_id IS NULL OR p_guest_token IS NULL OR pg_catalog.length(pg_catalog.btrim(p_guest_token)) < 32 THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'INVALID_GUEST_CREDENTIALS',
                'message', 'Thiếu thông tin xác thực khách hoặc token không đủ độ dài hợp lệ (yêu cầu tối thiểu 32 ký tự).'
            );
        END IF;

        v_guest_token_hash := pg_catalog.encode(
            extensions.digest(pg_catalog.convert_to(pg_catalog.btrim(p_guest_token), 'UTF8'), 'sha256'),
            'hex'
        );

        SELECT id, session_id, user_id, is_guest, status
        INTO v_participant
        FROM public.competition_participants
        WHERE id = p_participant_id
          AND session_id = p_session_id
          AND is_guest = true
          AND guest_token_hash = v_guest_token_hash;

        IF v_participant.id IS NULL THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'INVALID_GUEST_CREDENTIALS',
                'message', 'Thông tin xác thực khách không hợp lệ cho phòng thi này.'
            );
        END IF;
    END IF;

    IF v_participant.status = 'kicked' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'PARTICIPANT_KICKED',
            'message', 'Bạn đã bị xóa khỏi phòng thi này.'
        );
    END IF;

    -- 3. Stage 2: Deterministic Locking Hierarchy (sessions -> participants -> scores -> answers)
    -- Step A: Lock Session Row FOR UPDATE (Serializes pause, question transition, finish)
    SELECT id, room_code, status, current_question_index, current_question_id, question_deadline, paused_remaining_ms
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

    -- Validate Session State
    IF v_session.status = 'waiting' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_NOT_IN_PROGRESS',
            'message', 'Phòng thi chưa bắt đầu.'
        );
    ELSIF v_session.status = 'paused' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_PAUSED',
            'message', 'Phòng thi đang tạm dừng.'
        );
    ELSIF v_session.status IN ('finished', 'cancelled') THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_CLOSED',
            'message', 'Phòng thi đã kết thúc hoặc đã bị hủy.'
        );
    ELSIF v_session.status <> 'in_progress' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_NOT_IN_PROGRESS',
            'message', 'Trạng thái phòng thi không hợp lệ để nộp bài.'
        );
    END IF;

    -- Validate Active Question
    IF v_session.current_question_id IS DISTINCT FROM p_question_id THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'QUESTION_NOT_ACTIVE',
            'message', 'Câu hỏi này không phải là câu hỏi đang diễn ra.'
        );
    END IF;

    -- Validate Server Deadline (Hardened with clock_timestamp >= question_deadline)
    IF v_session.question_deadline IS NULL OR pg_catalog.clock_timestamp() >= v_session.question_deadline THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'ANSWER_TOO_LATE',
            'message', 'Đã hết thời gian trả lời cho câu hỏi này.'
        );
    END IF;

    -- Step B: Load Question with Composite FK (session_id, id)
    SELECT id, session_id, question_order, question_text, question_type, options, correct_answer, points, time_limit_seconds
    INTO v_question
    FROM public.competition_questions
    WHERE session_id = p_session_id AND id = p_question_id;

    IF v_question.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'QUESTION_NOT_FOUND',
            'message', 'Không tìm thấy câu hỏi trong phòng thi này.'
        );
    END IF;

    -- Step C: Lock Participant Row FOR UPDATE & Re-check Identity on Locked Row
    SELECT id, session_id, user_id, guest_token_hash, is_guest, status
    INTO v_participant
    FROM public.competition_participants
    WHERE id = v_participant.id AND session_id = p_session_id
    FOR UPDATE;

    IF v_participant.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'PARTICIPANT_NOT_FOUND',
            'message', 'Không tìm thấy thông tin thí sinh trong phòng thi này.'
        );
    END IF;

    -- Strict identity verification under lock
    IF v_user_id IS NOT NULL THEN
        IF v_participant.user_id IS DISTINCT FROM v_user_id OR v_participant.is_guest IS TRUE THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'PARTICIPANT_NOT_FOUND',
                'message', 'Thông tin thí sinh không khớp với phiên đăng nhập.'
            );
        END IF;
    ELSE
        IF v_participant.guest_token_hash IS DISTINCT FROM v_guest_token_hash OR v_participant.is_guest IS FALSE THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'INVALID_GUEST_CREDENTIALS',
                'message', 'Xác thực khách thất bại dưới khóa hàng.'
            );
        END IF;
    END IF;

    IF v_participant.status = 'kicked' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'PARTICIPANT_KICKED',
            'message', 'Bạn đã bị xóa khỏi phòng thi này.'
        );
    END IF;

    -- Step D: Lock Score Row FOR UPDATE (Serializes duplicate submissions from same participant, fail-closed)
    SELECT id, session_id, participant_id, total_score, correct_count, total_response_time_ms, rank
    INTO v_score
    FROM public.competition_scores
    WHERE session_id = v_session.id AND participant_id = v_participant.id
    FOR UPDATE;

    IF v_score.id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'SCORE_RECORD_MISSING',
            'message', 'Không tìm thấy bản ghi điểm của thí sinh trong phòng thi này.'
        );
    END IF;

    -- Step E: Check Duplicate Answer under Score Lock (First Write Wins)
    SELECT id INTO v_existing_answer_id
    FROM public.competition_answers
    WHERE session_id = p_session_id
      AND question_id = p_question_id
      AND participant_id = v_participant.id;

    IF v_existing_answer_id IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'ALREADY_ANSWERED',
            'message', 'Bạn đã nộp câu trả lời cho câu hỏi này.'
        );
    END IF;

    -- 4. Server-Authoritative Time Calculation
    v_time_limit_ms := (v_question.time_limit_seconds * 1000)::BIGINT;
    v_derived_start := v_session.question_deadline - (v_question.time_limit_seconds * interval '1 second');
    v_time_taken_ms := GREATEST(0::BIGINT, LEAST(v_time_limit_ms, pg_catalog.round(EXTRACT(EPOCH FROM (pg_catalog.now() - v_derived_start)) * 1000)::BIGINT));

    -- 5. Payload Validation & Server-Side Correctness Calculation (Canonical Format Enforcement)
    CASE v_question.question_type
        WHEN 'single_choice', 'true_false' THEN
            -- Fail-closed on missing/malformed options data
            IF v_question.options IS NULL 
               OR pg_catalog.jsonb_typeof(v_question.options) <> 'array'
               OR pg_catalog.jsonb_array_length(v_question.options) = 0 THEN
                RETURN pg_catalog.jsonb_build_object(
                    'success', false,
                    'error_code', 'MALFORMED_QUESTION_SNAPSHOT',
                    'message', 'Cấu hình danh sách lựa chọn của câu hỏi không hợp lệ.'
                );
            END IF;

            -- Validate canonical correct_answer shape: {"option_id": "..."}
            IF v_question.correct_answer IS NULL 
               OR pg_catalog.jsonb_typeof(v_question.correct_answer) <> 'object'
               OR NOT (v_question.correct_answer ? 'option_id')
               OR v_question.correct_answer->>'option_id' IS NULL
               OR pg_catalog.btrim(v_question.correct_answer->>'option_id') = '' THEN
                RETURN pg_catalog.jsonb_build_object(
                    'success', false,
                    'error_code', 'MALFORMED_QUESTION_SNAPSHOT',
                    'message', 'Cấu hình đáp án đúng của câu hỏi không hợp lệ theo chuẩn canonical.'
                );
            END IF;

            v_correct_target := v_question.correct_answer->>'option_id';

            -- Validate that selected_option_ids is JSON array with exactly 1 element
            IF p_selected_option_ids IS NULL 
               OR pg_catalog.jsonb_typeof(p_selected_option_ids) <> 'array'
               OR pg_catalog.jsonb_array_length(p_selected_option_ids) <> 1 THEN
                RETURN pg_catalog.jsonb_build_object(
                    'success', false,
                    'error_code', 'INVALID_ANSWER_PAYLOAD',
                    'message', 'Câu hỏi một lựa chọn yêu cầu chọn chính xác 1 đáp án.'
                );
            END IF;

            v_student_opt := p_selected_option_ids #>> '{0}';
            IF v_student_opt IS NULL OR pg_catalog.btrim(v_student_opt) = '' THEN
                RETURN pg_catalog.jsonb_build_object(
                    'success', false,
                    'error_code', 'INVALID_ANSWER_PAYLOAD',
                    'message', 'Đáp án chọn không được để trống.'
                );
            END IF;

            -- Validate option exists in question options (canonical option object with "id")
            SELECT EXISTS (
                SELECT 1 FROM pg_catalog.jsonb_array_elements(v_question.options) opt
                WHERE pg_catalog.jsonb_typeof(opt) = 'object' AND opt->>'id' = v_student_opt
            ) INTO v_opt_exists;

            IF NOT v_opt_exists THEN
                RETURN pg_catalog.jsonb_build_object(
                    'success', false,
                    'error_code', 'INVALID_OPTION_SELECTED',
                    'message', 'Đáp án được chọn không tồn tại trong danh sách lựa chọn của câu hỏi.'
                );
            END IF;

            -- Evaluate correctness
            IF v_student_opt = v_correct_target THEN
                v_is_correct := true;
            END IF;

        WHEN 'multiple_choice' THEN
            -- Fail-closed on missing/malformed options data
            IF v_question.options IS NULL 
               OR pg_catalog.jsonb_typeof(v_question.options) <> 'array'
               OR pg_catalog.jsonb_array_length(v_question.options) = 0 THEN
                RETURN pg_catalog.jsonb_build_object(
                    'success', false,
                    'error_code', 'MALFORMED_QUESTION_SNAPSHOT',
                    'message', 'Cấu hình danh sách lựa chọn của câu hỏi không hợp lệ.'
                );
            END IF;

            -- Validate canonical correct_answer shape: {"option_ids": ["...", "..."]}
            IF v_question.correct_answer IS NULL 
               OR pg_catalog.jsonb_typeof(v_question.correct_answer) <> 'object'
               OR NOT (v_question.correct_answer ? 'option_ids')
               OR pg_catalog.jsonb_typeof(v_question.correct_answer->'option_ids') <> 'array'
               OR pg_catalog.jsonb_array_length(v_question.correct_answer->'option_ids') = 0 THEN
                RETURN pg_catalog.jsonb_build_object(
                    'success', false,
                    'error_code', 'MALFORMED_QUESTION_SNAPSHOT',
                    'message', 'Cấu hình danh sách đáp án đúng của câu hỏi không hợp lệ theo chuẩn canonical.'
                );
            END IF;

            -- Validate that selected_option_ids is JSON array with >= 1 element
            IF p_selected_option_ids IS NULL 
               OR pg_catalog.jsonb_typeof(p_selected_option_ids) <> 'array'
               OR pg_catalog.jsonb_array_length(p_selected_option_ids) < 1 THEN
                RETURN pg_catalog.jsonb_build_object(
                    'success', false,
                    'error_code', 'INVALID_ANSWER_PAYLOAD',
                    'message', 'Câu hỏi nhiều lựa chọn yêu cầu chọn ít nhất 1 đáp án.'
                );
            END IF;

            -- Check each selected option exists in question options (canonical option object with "id")
            FOR v_opt_val IN SELECT * FROM pg_catalog.jsonb_array_elements_text(p_selected_option_ids)
            LOOP
                SELECT EXISTS (
                    SELECT 1 FROM pg_catalog.jsonb_array_elements(v_question.options) opt
                    WHERE pg_catalog.jsonb_typeof(opt) = 'object' AND opt->>'id' = v_opt_val
                ) INTO v_opt_exists;

                IF NOT v_opt_exists THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'INVALID_OPTION_SELECTED',
                        'message', 'Một trong các đáp án được chọn không tồn tại trong danh sách lựa chọn.'
                    );
                END IF;
            END LOOP;

            -- Evaluate set equality (canonical sorted unique array comparison)
            SELECT COALESCE(pg_catalog.array_agg(DISTINCT elem ORDER BY elem), ARRAY[]::TEXT[])
            INTO v_student_arr
            FROM pg_catalog.jsonb_array_elements_text(p_selected_option_ids) AS elem;

            SELECT COALESCE(pg_catalog.array_agg(DISTINCT elem ORDER BY elem), ARRAY[]::TEXT[])
            INTO v_correct_arr
            FROM pg_catalog.jsonb_array_elements_text(v_question.correct_answer->'option_ids') AS elem;

            IF v_student_arr = v_correct_arr AND pg_catalog.cardinality(v_student_arr) = pg_catalog.cardinality(v_correct_arr) THEN
                v_is_correct := true;
            END IF;

        WHEN 'short_answer' THEN
            -- Validate canonical correct_answer shape: {"accepted_answers": ["...", "..."]}
            IF v_question.correct_answer IS NULL 
               OR pg_catalog.jsonb_typeof(v_question.correct_answer) <> 'object'
               OR NOT (v_question.correct_answer ? 'accepted_answers')
               OR pg_catalog.jsonb_typeof(v_question.correct_answer->'accepted_answers') <> 'array'
               OR pg_catalog.jsonb_array_length(v_question.correct_answer->'accepted_answers') = 0 THEN
                RETURN pg_catalog.jsonb_build_object(
                    'success', false,
                    'error_code', 'MALFORMED_QUESTION_SNAPSHOT',
                    'message', 'Cấu hình đáp án đúng của câu hỏi không hợp lệ theo chuẩn canonical.'
                );
            END IF;

            v_norm_student_text := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_text_answer, '')));
            IF v_norm_student_text <> '' THEN
                FOR v_accepted_text IN SELECT * FROM pg_catalog.jsonb_array_elements_text(v_question.correct_answer->'accepted_answers')
                LOOP
                    IF v_norm_student_text = pg_catalog.lower(pg_catalog.btrim(v_accepted_text)) THEN
                        v_is_correct := true;
                        EXIT;
                    END IF;
                END LOOP;
            END IF;

        WHEN 'matching' THEN
            -- Fail-closed on missing/malformed options data or canonical correct_answer
            IF v_question.options IS NULL 
               OR pg_catalog.jsonb_typeof(v_question.options) <> 'array'
               OR v_question.correct_answer IS NULL
               OR pg_catalog.jsonb_typeof(v_question.correct_answer) <> 'object'
               OR NOT (v_question.correct_answer ? 'pairs')
               OR pg_catalog.jsonb_typeof(v_question.correct_answer->'pairs') <> 'array' THEN
                RETURN pg_catalog.jsonb_build_object(
                    'success', false,
                    'error_code', 'MALFORMED_QUESTION_SNAPSHOT',
                    'message', 'Cấu hình câu hỏi nối từ không hợp lệ theo chuẩn canonical.'
                );
            END IF;

            v_expected_pair_count := pg_catalog.jsonb_array_length(v_question.correct_answer->'pairs');

            -- 1. payload JSON type = array
            -- 2. exact pair count equals canonical correct pair count
            IF p_selected_option_ids IS NULL 
               OR pg_catalog.jsonb_typeof(p_selected_option_ids) <> 'array'
               OR pg_catalog.jsonb_array_length(p_selected_option_ids) <> v_expected_pair_count THEN
                RETURN pg_catalog.jsonb_build_object(
                    'success', false,
                    'error_code', 'INVALID_ANSWER_PAYLOAD',
                    'message', 'Cấu trúc bài làm nối từ không hợp lệ hoặc thiếu/thừa cặp nối.'
                );
            END IF;

            -- Collect valid left and right IDs from question options
            SELECT 
                COALESCE(pg_catalog.array_agg(opt->>'id') FILTER (WHERE opt->>'side' = 'left'), ARRAY[]::TEXT[]),
                COALESCE(pg_catalog.array_agg(opt->>'id') FILTER (WHERE opt->>'side' = 'right'), ARRAY[]::TEXT[])
            INTO v_valid_left_ids, v_valid_right_ids
            FROM pg_catalog.jsonb_array_elements(v_question.options) AS opt
            WHERE pg_catalog.jsonb_typeof(opt) = 'object' 
              AND opt ? 'id' 
              AND opt ? 'side';

            v_sub_left_ids_seen := ARRAY[]::TEXT[];
            v_sub_right_ids_seen := ARRAY[]::TEXT[];

            FOR v_pair_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_selected_option_ids)
            LOOP
                -- 3. each element = object
                -- 4. left_id exists
                -- 5. right_id exists
                IF pg_catalog.jsonb_typeof(v_pair_elem) <> 'object' 
                   OR NOT (v_pair_elem ? 'left_id') 
                   OR NOT (v_pair_elem ? 'right_id') THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'INVALID_ANSWER_PAYLOAD',
                        'message', 'Mỗi cặp nối phải là đối tượng chứa left_id và right_id.'
                    );
                END IF;

                v_sub_left_id := pg_catalog.btrim(COALESCE(v_pair_elem->>'left_id', ''));
                v_sub_right_id := pg_catalog.btrim(COALESCE(v_pair_elem->>'right_id', ''));

                IF v_sub_left_id = '' OR v_sub_right_id = '' THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'INVALID_ANSWER_PAYLOAD',
                        'message', 'ID trong cặp nối không được để trống.'
                    );
                END IF;

                -- 6. every left ID exists in question options with side left
                IF NOT (v_sub_left_id = ANY(v_valid_left_ids)) THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'INVALID_OPTION_SELECTED',
                        'message', 'Mục vế trái không tồn tại trong danh sách câu hỏi.'
                    );
                END IF;

                -- 7. every right ID exists in question options with side right
                IF NOT (v_sub_right_id = ANY(v_valid_right_ids)) THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'INVALID_OPTION_SELECTED',
                        'message', 'Mục vế phải không tồn tại trong danh sách câu hỏi.'
                    );
                END IF;

                -- 8. no duplicated left ID
                IF v_sub_left_id = ANY(v_sub_left_ids_seen) THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'INVALID_ANSWER_PAYLOAD',
                        'message', 'Mục vế trái bị lặp lại trong bài nộp.'
                    );
                END IF;

                -- 9. no duplicated right ID
                IF v_sub_right_id = ANY(v_sub_right_ids_seen) THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'INVALID_ANSWER_PAYLOAD',
                        'message', 'Mục vế phải bị lặp lại trong bài nộp.'
                    );
                END IF;

                v_sub_left_ids_seen := pg_catalog.array_append(v_sub_left_ids_seen, v_sub_left_id);
                v_sub_right_ids_seen := pg_catalog.array_append(v_sub_right_ids_seen, v_sub_right_id);
            END LOOP;

            -- Authoritative Scoring: Set Equality (Order Insensitive, Full Credit Only)
            SELECT NOT EXISTS (
                SELECT 1 
                FROM pg_catalog.jsonb_array_elements(v_question.correct_answer->'pairs') cp
                WHERE NOT EXISTS (
                    SELECT 1 
                    FROM pg_catalog.jsonb_array_elements(p_selected_option_ids) sp
                    WHERE sp->>'left_id' = cp->>'left_id'
                      AND sp->>'right_id' = cp->>'right_id'
                )
            ) INTO v_is_correct;

        ELSE
            RETURN pg_catalog.jsonb_build_object(
                'success', false,
                'error_code', 'UNSUPPORTED_QUESTION_TYPE',
                'message', 'Loại câu hỏi không được hỗ trợ.'
            );
    END CASE;

    -- 6. Server-Side Score Calculation (FULL CREDIT ONLY)
    IF v_is_correct THEN
        v_points_awarded := v_question.points;
        v_correct_increment := 1;
    ELSE
        v_points_awarded := 0.00;
        v_correct_increment := 0;
    END IF;

    -- 7. Step F: Insert Answer Record
    BEGIN
        INSERT INTO public.competition_answers (
            session_id,
            question_id,
            participant_id,
            selected_option_ids,
            text_answer,
            is_correct,
            points_awarded,
            time_taken_ms,
            submitted_at,
            created_at
        ) VALUES (
            v_session.id,
            v_question.id,
            v_participant.id,
            COALESCE(p_selected_option_ids, '[]'::jsonb),
            CASE WHEN v_question.question_type = 'matching' THEN NULL ELSE p_text_answer END,
            v_is_correct,
            v_points_awarded,
            v_time_taken_ms,
            pg_catalog.now(),
            pg_catalog.now()
        ) RETURNING id INTO v_answer_id;
    EXCEPTION
        WHEN unique_violation THEN
            GET STACKED DIAGNOSTICS v_diag_constraint = CONSTRAINT_NAME;
            IF v_diag_constraint = 'unique_competition_answer_attempt' THEN
                RETURN pg_catalog.jsonb_build_object(
                    'success', false,
                    'error_code', 'ALREADY_ANSWERED',
                    'message', 'Bạn đã nộp câu trả lời cho câu hỏi này.'
                );
            ELSE
                RAISE;
            END IF;
    END;

    -- 8. Step G: Update Competition Score Row
    UPDATE public.competition_scores
    SET total_score = total_score + v_points_awarded,
        correct_count = correct_count + v_correct_increment,
        total_response_time_ms = total_response_time_ms + v_time_taken_ms,
        updated_at = pg_catalog.now()
    WHERE id = v_score.id
    RETURNING id, session_id, participant_id, total_score, correct_count, total_response_time_ms, rank
    INTO v_score;

    -- Update participant presence
    UPDATE public.competition_participants
    SET last_seen_at = pg_catalog.now(),
        status = CASE WHEN status = 'disconnected' THEN 'active' ELSE status END
    WHERE id = v_participant.id;

    -- 9. Return Structured Success Response
    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'answer_id', v_answer_id,
        'is_correct', v_is_correct,
        'points_awarded', v_points_awarded,
        'time_taken_ms', v_time_taken_ms,
        'current_score', v_score.total_score,
        'correct_count', v_score.correct_count,
        'total_response_time_ms', v_score.total_response_time_ms
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION private.competition_submit_answer_internal(UUID, UUID, UUID, TEXT, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.competition_submit_answer_internal(UUID, UUID, UUID, TEXT, JSONB, TEXT) TO authenticated, anon;


-- ------------------------------------------------------------
-- 4. UPDATE: private.competition_snapshot_question_result_internal
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

    -- Compute distribution based on question type
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

    ELSIF v_question.question_type = 'matching' THEN
        -- R16-A Matching Sanitized Pairs Distribution
        IF v_question.correct_answer IS NOT NULL 
           AND v_question.correct_answer ? 'pairs' 
           AND pg_catalog.jsonb_typeof(v_question.correct_answer->'pairs') = 'array' THEN
            WITH pairs_raw AS (
                SELECT
                    p->>'left_id' AS left_id,
                    p->>'right_id' AS right_id,
                    p_ord
                FROM pg_catalog.jsonb_array_elements(v_question.correct_answer->'pairs') WITH ORDINALITY AS t(p, p_ord)
            ),
            opts_raw AS (
                SELECT
                    opt->>'id' AS opt_id,
                    opt->>'text' AS opt_text
                FROM pg_catalog.jsonb_array_elements(COALESCE(v_question.options, '[]'::jsonb)) AS opt
                WHERE pg_catalog.jsonb_typeof(opt) = 'object'
            )
            SELECT COALESCE(
                pg_catalog.jsonb_agg(
                    pg_catalog.jsonb_build_object(
                        'left_id', pr.left_id,
                        'left_text', COALESCE(ol.opt_text, ''),
                        'right_id', pr.right_id,
                        'right_text', COALESCE(oright.opt_text, '')
                    )
                    ORDER BY pr.p_ord ASC
                ),
                '[]'::jsonb
            )
            INTO v_distribution
            FROM pairs_raw pr
            LEFT JOIN opts_raw ol ON ol.opt_id = pr.left_id
            LEFT JOIN opts_raw oright ON oright.opt_id = pr.right_id;
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

REVOKE EXECUTE ON FUNCTION private.competition_snapshot_question_result_internal(UUID, UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.competition_snapshot_question_result_internal(UUID, UUID, TIMESTAMPTZ) FROM anon;
REVOKE EXECUTE ON FUNCTION private.competition_snapshot_question_result_internal(UUID, UUID, TIMESTAMPTZ) FROM authenticated;


-- ------------------------------------------------------------
-- 5. UPDATE: private.competition_host_get_question_results_internal
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
        'total_eligible', (v_snapshot_res->>'total_eligible')::INT,
        'submitted_count', (v_snapshot_res->>'submitted_count')::INT,
        'unanswered_count', (v_snapshot_res->>'unanswered_count')::INT,
        'correct_count', (v_snapshot_res->>'correct_count')::INT,
        'incorrect_count', (v_snapshot_res->>'incorrect_count')::INT,
        'correct_percentage', (v_snapshot_res->>'correct_percentage')::NUMERIC,
        'distribution', v_snapshot_res->'distribution',
        'total_questions', v_total_questions
    ) || CASE 
        WHEN v_question.question_type = 'matching' THEN 
            pg_catalog.jsonb_build_object('matching_pairs', v_snapshot_res->'distribution')
        ELSE '{}'::jsonb 
    END;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.competition_host_get_question_results_internal(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.competition_host_get_question_results_internal(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION private.competition_host_get_question_results_internal(UUID) TO authenticated;

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

REVOKE EXECUTE ON FUNCTION public.competition_host_get_question_results(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.competition_host_get_question_results(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.competition_host_get_question_results(UUID) TO authenticated;


-- ------------------------------------------------------------
-- 6. UPDATE: private.competition_host_get_question_result_by_order_internal
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
    v_snapshot RECORD;
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
            'message', 'Thứ tự câu hỏi phải là số nguyên dương hợp lệ.'
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
    ) || CASE 
        WHEN v_question.question_type = 'matching' THEN 
            pg_catalog.jsonb_build_object('matching_pairs', v_snapshot.distribution)
        ELSE '{}'::jsonb 
    END;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.competition_host_get_question_result_by_order_internal(UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.competition_host_get_question_result_by_order_internal(UUID, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION private.competition_host_get_question_result_by_order_internal(UUID, INTEGER) TO authenticated;

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

REVOKE EXECUTE ON FUNCTION public.competition_host_get_question_result_by_order(UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.competition_host_get_question_result_by_order(UUID, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.competition_host_get_question_result_by_order(UUID, INTEGER) TO authenticated;
