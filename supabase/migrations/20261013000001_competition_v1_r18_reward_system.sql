-- ============================================================
-- COMPETITION V1 MIGRATION: REWARD V1 SYSTEM (R18)
-- SCOPE:
--   1. Create public.competition_reward_transactions table & indexes
--   2. Setup strict RLS on competition_reward_transactions
--   3. Create private.competition_apply_rewards_internal(UUID)
--   4. Update public.competition_host_create_session (Sets reward_status = 'pending' when reward_enabled = true)
--   5. Update private.competition_finish_session_internal (Atomically executes rewards before finish)
-- ============================================================

BEGIN;

-- Conservative timeout protections
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ------------------------------------------------------------
-- 1. COMPETITION REWARD TRANSACTIONS TABLE
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.competition_reward_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.competition_sessions(id) ON DELETE RESTRICT,
    participant_id UUID NOT NULL,
    user_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    participant_display_name VARCHAR(100) NOT NULL,
    session_room_code VARCHAR(10) NOT NULL,
    session_title VARCHAR(255) NOT NULL,
    rank INT NOT NULL CHECK (rank >= 1),
    reward_tier VARCHAR(20) NOT NULL CHECK (reward_tier IN ('top1', 'top2', 'top3', 'participation', 'none')),
    stars_awarded INT NOT NULL DEFAULT 0 CHECK (stars_awarded >= 0),
    status VARCHAR(30) NOT NULL CHECK (status IN ('awarded', 'skipped_guest', 'skipped_no_submission', 'not_applicable')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),

    CONSTRAINT uq_competition_reward_session_participant UNIQUE (session_id, participant_id),
    CONSTRAINT fk_competition_reward_participant
        FOREIGN KEY (session_id, participant_id)
        REFERENCES public.competition_participants(session_id, id)
        ON DELETE RESTRICT
);

-- Indexes for performance & audit querying
CREATE INDEX IF NOT EXISTS idx_competition_reward_tx_user_id
    ON public.competition_reward_transactions(user_id)
    WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_competition_reward_tx_session_id
    ON public.competition_reward_transactions(session_id);

-- ------------------------------------------------------------
-- 2. ROW-LEVEL SECURITY FOR REWARD TRANSACTIONS
-- ------------------------------------------------------------
ALTER TABLE public.competition_reward_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "competition_reward_tx_student_select" ON public.competition_reward_transactions;
CREATE POLICY "competition_reward_tx_student_select"
ON public.competition_reward_transactions
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "competition_reward_tx_host_select" ON public.competition_reward_transactions;
CREATE POLICY "competition_reward_tx_host_select"
ON public.competition_reward_transactions
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.competition_sessions s
        WHERE s.id = competition_reward_transactions.session_id
          AND s.host_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "competition_reward_tx_admin_select" ON public.competition_reward_transactions;
CREATE POLICY "competition_reward_tx_admin_select"
ON public.competition_reward_transactions
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'admin'
    )
);

-- Explicitly revoke all privileges from PUBLIC, anon, and authenticated
REVOKE ALL PRIVILEGES ON TABLE public.competition_reward_transactions FROM PUBLIC, anon, authenticated;

-- Explicitly revoke mutation and admin privileges to ensure zero write permissions
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.competition_reward_transactions FROM PUBLIC, anon, authenticated;

-- Grant strictly SELECT only to authenticated users (reads governed strictly by Row Level Security)
GRANT SELECT ON TABLE public.competition_reward_transactions TO authenticated;

-- ------------------------------------------------------------
-- 3. PRIVATE REWARD APPLICATION HELPER
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.competition_apply_rewards_internal(
    p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_session RECORD;
    v_tx_count INT := 0;
    v_awarded_count INT := 0;
    v_total_stars_awarded INT := 0;
BEGIN
    -- 1. Input check
    IF p_session_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_ID',
            'message', 'ID phòng thi không được để trống.'
        );
    END IF;

    -- 2. Lock session row FOR UPDATE
    SELECT id, room_code, title, reward_enabled, reward_config, reward_status, status
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

    -- 3. Check if rewards are enabled
    IF NOT COALESCE(v_session.reward_enabled, false) THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'applied', false,
            'reason', 'REWARD_NOT_ENABLED',
            'reward_status', v_session.reward_status
        );
    END IF;

    -- 4. Idempotency check: if already completed
    IF v_session.reward_status = 'completed' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'applied', false,
            'reason', 'ALREADY_COMPLETED',
            'reward_status', 'completed'
        );
    END IF;

    -- 5. Strict state guard: Only allow execution when reward_status is strictly 'pending'
    -- If reward_status is anything else ('not_applicable', 'processing', 'failed', etc.), fail-closed without mutating!
    IF v_session.reward_status <> 'pending' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'applied', false,
            'error_code', 'INVALID_REWARD_STATUS',
            'message', 'Trạng thái trao thưởng không hợp lệ để xử lý: ' || COALESCE(v_session.reward_status, 'NULL'),
            'reward_status', v_session.reward_status
        );
    END IF;

    -- Transition state to processing
    UPDATE public.competition_sessions
    SET reward_status = 'processing',
        updated_at = pg_catalog.now()
    WHERE id = p_session_id;


    -- 5. Calculate and materialize rewards into ledger table atomically
    -- Reward Schedule:
    --   Top 1: 15 stars
    --   Top 2: 10 stars
    --   Top 3: 5 stars
    --   Participation (Rank > 3): 2 stars
    -- Eligibility:
    --   - Must have submitted at least 1 answer in competition_answers
    --   - If 0 answers: 0 stars, tier 'none', status 'skipped_no_submission'
    --   - If Guest: 0 stars in profiles, tier based on rank, status 'skipped_guest'
    --   - Authenticated student with >= 1 answer: awarded full tier stars
    WITH participant_eval AS (
        SELECT 
            p.id AS participant_id,
            p.session_id,
            p.user_id,
            p.display_name,
            p.is_guest,
            s.rank,
            EXISTS (
                SELECT 1 
                FROM public.competition_answers a 
                WHERE a.session_id = p_session_id 
                  AND a.participant_id = p.id
            ) AS has_submitted_answer
        FROM public.competition_participants p
        INNER JOIN public.competition_scores s 
            ON s.session_id = p.session_id 
           AND s.participant_id = p.id
        WHERE p.session_id = p_session_id
          AND p.status <> 'kicked'
    ),
    reward_calc AS (
        SELECT 
            pe.participant_id,
            pe.session_id,
            pe.user_id,
            pe.display_name,
            pe.rank,
            CASE
                WHEN NOT pe.has_submitted_answer THEN 'none'
                WHEN pe.rank = 1 THEN 'top1'
                WHEN pe.rank = 2 THEN 'top2'
                WHEN pe.rank = 3 THEN 'top3'
                ELSE 'participation'
            END AS reward_tier,
            CASE
                WHEN NOT pe.has_submitted_answer THEN 0
                WHEN pe.is_guest OR pe.user_id IS NULL THEN 0
                WHEN pe.rank = 1 THEN 15
                WHEN pe.rank = 2 THEN 10
                WHEN pe.rank = 3 THEN 5
                ELSE 2
            END AS stars_awarded,
            CASE
                WHEN NOT pe.has_submitted_answer THEN 'skipped_no_submission'
                WHEN pe.is_guest OR pe.user_id IS NULL THEN 'skipped_guest'
                ELSE 'awarded'
            END AS status
        FROM participant_eval pe
    ),
    inserted_tx AS (
        INSERT INTO public.competition_reward_transactions (
            session_id,
            participant_id,
            user_id,
            participant_display_name,
            session_room_code,
            session_title,
            rank,
            reward_tier,
            stars_awarded,
            status,
            created_at
        )
        SELECT 
            rc.session_id,
            rc.participant_id,
            rc.user_id,
            rc.display_name,
            v_session.room_code,
            v_session.title,
            rc.rank,
            rc.reward_tier,
            rc.stars_awarded,
            rc.status,
            pg_catalog.now()
        FROM reward_calc rc
        ON CONFLICT (session_id, participant_id) DO NOTHING
        RETURNING user_id, stars_awarded, status
    ),
    applied_profiles AS (
        UPDATE public.profiles p
        SET total_stars = COALESCE(p.total_stars, 0) + u.total_stars_to_add,
            updated_at = pg_catalog.now()
        FROM (
            SELECT user_id, pg_catalog.sum(stars_awarded)::INT AS total_stars_to_add
            FROM inserted_tx
            WHERE status = 'awarded' 
              AND stars_awarded > 0 
              AND user_id IS NOT NULL
            GROUP BY user_id
        ) u
        WHERE p.id = u.user_id
        RETURNING p.id, u.total_stars_to_add
    )

    SELECT 
        COUNT(*)::INT,
        COALESCE(SUM(CASE WHEN status = 'awarded' THEN 1 ELSE 0 END), 0)::INT,
        COALESCE(SUM(stars_awarded), 0)::INT
    INTO v_tx_count, v_awarded_count, v_total_stars_awarded
    FROM inserted_tx;

    -- 6. Update session reward_status to completed
    UPDATE public.competition_sessions
    SET reward_status = 'completed',
        updated_at = pg_catalog.now()
    WHERE id = p_session_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'applied', true,
        'reward_status', 'completed',
        'transactions_created', v_tx_count,
        'students_awarded', v_awarded_count,
        'total_stars_awarded', v_total_stars_awarded
    );
END;
$$;

-- Protect internal function from public invocation
REVOKE ALL ON FUNCTION private.competition_apply_rewards_internal(UUID) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4. UPDATE: public.competition_host_create_session
--    Fix: reward_status = 'pending' when reward_enabled = true
--    Preserves 100% Matching R16-A validation & Review features
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
    v_reward_status VARCHAR(20);
    
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

                IF v_left_count < 2 OR v_left_count > 6 
                   OR v_right_count < 2 OR v_right_count > 6 
                   OR v_left_count <> v_right_count THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                        'message', 'Số lượng mục nối mỗi bên phải từ 2 đến 6 và số lượng hai bên phải bằng nhau.'
                    );
                END IF;

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

                    IF NOT (v_pair_left_id = ANY(v_left_ids)) THEN
                        RETURN pg_catalog.jsonb_build_object(
                            'success', false,
                            'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                            'message', 'left_id trong đáp án đúng không tồn tại ở vế trái.'
                        );
                    END IF;

                    IF NOT (v_pair_right_id = ANY(v_right_ids)) THEN
                        RETURN pg_catalog.jsonb_build_object(
                            'success', false,
                            'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                            'message', 'right_id trong đáp án đúng không tồn tại ở vế phải.'
                        );
                    END IF;

                    IF v_pair_left_id = ANY(v_pair_left_ids_seen) THEN
                        RETURN pg_catalog.jsonb_build_object(
                            'success', false,
                            'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                            'message', 'Mỗi mục vế trái chỉ được nối chính xác một lần trong đáp án đúng.'
                        );
                    END IF;

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

    -- Verify no gaps in question order
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

    -- Compute correct reward_status based on reward_enabled
    v_reward_status := CASE WHEN COALESCE(p_reward_enabled, false) THEN 'pending' ELSE 'not_applicable' END;

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
            v_reward_status,
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

        -- Canonicalize Matching option IDs to server-generated opaque UUIDs before persist
        IF v_q_type = 'matching' THEN
            DECLARE
                v_opt JSONB;
                v_orig_id TEXT;
                v_side TEXT;
                v_text TEXT;
                v_new_id TEXT;
                v_id_map JSONB := '{}'::jsonb;
                v_new_options JSONB := '[]'::jsonb;
                v_pair JSONB;
                v_orig_left_id TEXT;
                v_orig_right_id TEXT;
                v_new_left_id TEXT;
                v_new_right_id TEXT;
                v_new_pairs JSONB := '[]'::jsonb;
            BEGIN
                FOR v_opt IN SELECT * FROM pg_catalog.jsonb_array_elements(v_q_options)
                LOOP
                    v_orig_id := pg_catalog.btrim(v_opt->>'id');
                    v_side := pg_catalog.lower(pg_catalog.btrim(v_opt->>'side'));
                    v_text := pg_catalog.btrim(v_opt->>'text');
                    v_new_id := pg_catalog.gen_random_uuid()::text;

                    v_id_map := v_id_map || pg_catalog.jsonb_build_object(v_orig_id, v_new_id);

                    v_new_options := v_new_options || pg_catalog.jsonb_build_array(
                        pg_catalog.jsonb_build_object(
                            'id', v_new_id,
                            'side', v_side,
                            'text', v_text
                        )
                    );
                END LOOP;

                FOR v_pair IN SELECT * FROM pg_catalog.jsonb_array_elements(v_q_correct->'pairs')
                LOOP
                    v_orig_left_id := pg_catalog.btrim(v_pair->>'left_id');
                    v_orig_right_id := pg_catalog.btrim(v_pair->>'right_id');

                    v_new_left_id := v_id_map->>v_orig_left_id;
                    v_new_right_id := v_id_map->>v_orig_right_id;

                    IF v_new_left_id IS NULL OR v_new_right_id IS NULL OR v_new_left_id = '' OR v_new_right_id = '' THEN
                        RETURN pg_catalog.jsonb_build_object(
                            'success', false,
                            'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                            'message', 'Lỗi ánh xạ định danh bảo mật cho câu hỏi nối từ.'
                        );
                    END IF;

                    v_new_pairs := v_new_pairs || pg_catalog.jsonb_build_array(
                        pg_catalog.jsonb_build_object(
                            'left_id', v_new_left_id,
                            'right_id', v_new_right_id
                        )
                    );
                END LOOP;

                IF pg_catalog.jsonb_array_length(v_new_pairs) <> pg_catalog.jsonb_array_length(v_q_correct->'pairs') THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'success', false,
                        'error_code', 'MALFORMED_QUESTION_PAYLOAD',
                        'message', 'Số lượng cặp đáp án đúng sau ánh xạ không khớp.'
                    );
                END IF;

                v_q_options := v_new_options;
                v_q_correct := pg_catalog.jsonb_build_object('pairs', v_new_pairs);
            END;
        END IF;

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
        'reward_status', v_reward_status,
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
-- 5. UPDATE: private.competition_finish_session_internal
--    Atomically triggers reward processing before finalizing session
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
    v_reward_res JSONB;
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
    SELECT id, host_id, status, current_question_id, question_deadline, reward_enabled, reward_status
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

    -- 7. Atomic Reward Processing (if reward_enabled and reward_status = 'pending')
    IF COALESCE(v_session.reward_enabled, false) AND v_session.reward_status = 'pending' THEN
        v_reward_res := private.competition_apply_rewards_internal(v_session.id);
        IF (v_reward_res->>'success')::BOOLEAN IS NOT TRUE THEN
            RAISE EXCEPTION 'Lỗi xử lý trao thưởng: %', v_reward_res->>'message';
        END IF;
    END IF;

    -- 8. Update Session State to Finished and Clean Active Timers
    v_ended_at := pg_catalog.now();
    UPDATE public.competition_sessions
    SET status = 'finished',
        ended_at = v_ended_at,
        current_question_id = NULL,
        question_deadline = NULL,
        paused_remaining_ms = NULL,
        updated_at = v_ended_at
    WHERE id = v_session.id;

    -- 9. Return Structured Success Response
    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'session_id', v_session.id,
        'status', 'finished',
        'ended_at', v_ended_at,
        'reward_applied', COALESCE((v_reward_res->>'applied')::BOOLEAN, false)
    );
END;
$$;

REVOKE ALL ON FUNCTION private.competition_finish_session_internal(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.competition_finish_session_internal(UUID) TO authenticated;

COMMIT;
