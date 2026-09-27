-- ============================================================
-- COMPETITION V1 BASELINE SCHEMA (MIGRATION 1)
-- SCOPE: 9 Modular Tables, Constraints, Indexes & Baseline RLS
-- NO BUSINESS RPC / NO REALTIME PUBLICATION / NO REWARD SIDE EFFECTS
-- ============================================================

BEGIN;

-- Conservative timeout protections
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ------------------------------------------------------------
-- 1. COMPETITION CUSTOM GROUPS
-- ------------------------------------------------------------
-- Allows teachers to organize custom student cohorts for competitions.
-- ON DELETE CASCADE on owner_id ensures custom cohorts are cleaned up if teacher profile is removed.
CREATE TABLE public.competition_custom_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT unique_teacher_custom_group_name UNIQUE (owner_id, name)
);

-- ------------------------------------------------------------
-- 2. COMPETITION CUSTOM GROUP MEMBERS
-- ------------------------------------------------------------
-- Maps students to custom groups.
-- ON DELETE CASCADE on both group_id and student_id removes associations cleanly.
CREATE TABLE public.competition_custom_group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES public.competition_custom_groups(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT unique_group_student_member UNIQUE (group_id, student_id)
);

-- ------------------------------------------------------------
-- 3. COMPETITION SESSIONS
-- ------------------------------------------------------------
-- Main live competition session container.
-- ON DELETE RESTRICT on host_id preserves audit trail and prevents accidental deletion of historical sessions.
-- Note: Room code uniqueness is enforced via partial unique index to allow code reuse after session completion/cancellation.
CREATE TABLE public.competition_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    room_code VARCHAR(10) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NULL,
    mode VARCHAR(20) NOT NULL DEFAULT 'individual',
    status VARCHAR(20) NOT NULL DEFAULT 'waiting',
    max_participants INT NOT NULL DEFAULT 100,
    current_question_index INT NOT NULL DEFAULT 0,
    current_question_id UUID NULL,
    question_deadline TIMESTAMPTZ NULL,
    paused_remaining_ms BIGINT DEFAULT NULL,
    reward_enabled BOOLEAN NOT NULL DEFAULT false,
    reward_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    reward_status VARCHAR(20) NOT NULL DEFAULT 'not_applicable',
    started_at TIMESTAMPTZ NULL,
    ended_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT check_competition_session_mode CHECK (mode IN ('individual', 'team')),
    CONSTRAINT check_competition_session_status CHECK (status IN ('waiting', 'in_progress', 'paused', 'finished', 'cancelled')),
    CONSTRAINT check_competition_session_max_participants CHECK (max_participants BETWEEN 1 AND 1000),
    CONSTRAINT check_competition_session_question_index CHECK (current_question_index >= 0),
    CONSTRAINT check_competition_session_paused_remaining CHECK (paused_remaining_ms IS NULL OR paused_remaining_ms >= 0),
    CONSTRAINT check_competition_session_reward_status CHECK (reward_status IN ('not_applicable', 'pending', 'processing', 'completed', 'failed'))
);

-- ------------------------------------------------------------
-- 4. COMPETITION TEAMS
-- ------------------------------------------------------------
-- Teams configured for team-mode sessions.
-- ON DELETE RESTRICT on session_id ensures session team structure is preserved with session history.
CREATE TABLE public.competition_teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.competition_sessions(id) ON DELETE RESTRICT,
    team_name VARCHAR(100) NOT NULL,
    team_color VARCHAR(30) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT unique_competition_session_team_name UNIQUE (session_id, team_name)
);

-- ------------------------------------------------------------
-- 5. COMPETITION QUESTIONS (IMMUTABLE SNAPSHOT MODEL)
-- ------------------------------------------------------------
-- Independent snapshot of questions for a session.
-- Contains private correct_answer evaluated server-side by RPC in Migration 2.
-- ON DELETE RESTRICT on session_id preserves historical questions associated with past sessions.
-- Composite UNIQUE (session_id, id) enables composite relational integrity on answers.
CREATE TABLE public.competition_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.competition_sessions(id) ON DELETE RESTRICT,
    question_order INT NOT NULL,
    question_text TEXT NOT NULL,
    question_type VARCHAR(30) NOT NULL DEFAULT 'single_choice',
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    correct_answer JSONB NOT NULL,
    points NUMERIC(6, 2) NOT NULL DEFAULT 10.00,
    time_limit_seconds INT NOT NULL DEFAULT 30,
    explanation TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT unique_competition_session_question_order UNIQUE (session_id, question_order),
    CONSTRAINT unique_competition_question_session_id UNIQUE (session_id, id),
    CONSTRAINT check_competition_question_order CHECK (question_order >= 1),
    CONSTRAINT check_competition_question_type CHECK (question_type IN ('single_choice', 'multiple_choice', 'true_false', 'short_answer')),
    CONSTRAINT check_competition_question_points CHECK (points >= 0.00),
    CONSTRAINT check_competition_question_time_limit CHECK (time_limit_seconds BETWEEN 5 AND 600)
);

-- Add circular FK from competition_sessions.current_question_id to competition_questions.id
-- ON DELETE SET NULL allows question pointer clearing without blocking session container.
ALTER TABLE public.competition_sessions
    ADD CONSTRAINT fk_competition_sessions_current_question
    FOREIGN KEY (current_question_id)
    REFERENCES public.competition_questions(id)
    ON DELETE SET NULL;

-- ------------------------------------------------------------
-- 6. COMPETITION PARTICIPANTS
-- ------------------------------------------------------------
-- Stores participants (authenticated students or guest players).
-- ON DELETE RESTRICT on session_id protects participant rosters from unhandled cascading deletes.
-- ON DELETE SET NULL on user_id preserves participant scoreboard entry if student profile is removed.
-- ON DELETE SET NULL on team_id unassigns participant if a team is deleted.
-- Composite UNIQUE (session_id, id) guarantees strict cross-session relational integrity for answers and scores.
CREATE TABLE public.competition_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.competition_sessions(id) ON DELETE RESTRICT,
    user_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    guest_token_hash VARCHAR(64) NULL,
    display_name VARCHAR(100) NOT NULL,
    avatar_url TEXT NULL,
    team_id UUID NULL REFERENCES public.competition_teams(id) ON DELETE SET NULL,
    is_guest BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(20) NOT NULL DEFAULT 'joined',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT unique_competition_participant_session_id UNIQUE (session_id, id),
    CONSTRAINT check_competition_participant_status CHECK (status IN ('joined', 'active', 'disconnected', 'kicked', 'submitted')),
    CONSTRAINT check_competition_participant_identity CHECK (
        (NOT is_guest AND user_id IS NOT NULL AND guest_token_hash IS NULL) OR
        (is_guest AND guest_token_hash IS NOT NULL AND user_id IS NULL)
    )
);

-- Partial unique indexes to strictly enforce single membership per session
CREATE UNIQUE INDEX unique_competition_participant_user 
    ON public.competition_participants (session_id, user_id) 
    WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX unique_competition_participant_guest 
    ON public.competition_participants (session_id, guest_token_hash) 
    WHERE guest_token_hash IS NOT NULL;

-- ------------------------------------------------------------
-- 7. COMPETITION ANSWERS
-- ------------------------------------------------------------
-- Stores individual question responses.
-- Composite FKs strictly enforce answer.session_id = question.session_id = participant.session_id.
-- Authority timestamps and time_taken_ms validation are server-controlled.
CREATE TABLE public.competition_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.competition_sessions(id) ON DELETE RESTRICT,
    question_id UUID NOT NULL,
    participant_id UUID NOT NULL,
    selected_option_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    text_answer TEXT NULL,
    is_correct BOOLEAN NOT NULL DEFAULT false,
    points_awarded NUMERIC(6, 2) NOT NULL DEFAULT 0.00,
    time_taken_ms BIGINT NOT NULL DEFAULT 0,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_competition_answers_question_session
        FOREIGN KEY (session_id, question_id)
        REFERENCES public.competition_questions(session_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_competition_answers_participant_session
        FOREIGN KEY (session_id, participant_id)
        REFERENCES public.competition_participants(session_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT unique_competition_answer_attempt UNIQUE (session_id, question_id, participant_id),
    CONSTRAINT check_competition_answer_points CHECK (points_awarded >= 0.00),
    CONSTRAINT check_competition_answer_time_taken CHECK (time_taken_ms >= 0)
);

-- ------------------------------------------------------------
-- 8. COMPETITION SCORES
-- ------------------------------------------------------------
-- Realtime aggregated scoreboard per participant.
-- Composite FK strictly enforces score.session_id = participant.session_id.
-- ON DELETE RESTRICT guarantees score history preservation.
-- total_response_time_ms is accumulated upon valid submissions.
CREATE TABLE public.competition_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.competition_sessions(id) ON DELETE RESTRICT,
    participant_id UUID NOT NULL,
    total_score NUMERIC(8, 2) NOT NULL DEFAULT 0.00,
    correct_count INT NOT NULL DEFAULT 0,
    total_response_time_ms BIGINT NOT NULL DEFAULT 0,
    rank INT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_competition_scores_participant_session
        FOREIGN KEY (session_id, participant_id)
        REFERENCES public.competition_participants(session_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT unique_competition_score_participant UNIQUE (session_id, participant_id),
    CONSTRAINT check_competition_score_total CHECK (total_score >= 0.00),
    CONSTRAINT check_competition_score_correct_count CHECK (correct_count >= 0),
    CONSTRAINT check_competition_score_response_time CHECK (total_response_time_ms >= 0),
    CONSTRAINT check_competition_score_rank CHECK (rank IS NULL OR rank >= 1)
);

-- ------------------------------------------------------------
-- 9. COMPETITION JOIN ATTEMPTS
-- ------------------------------------------------------------
-- Audit log for rate limiting and brute force protection.
-- Direct client access is strictly denied.
-- ON DELETE SET NULL on session_id preserves audit record even if session container is removed.
CREATE TABLE public.competition_join_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NULL REFERENCES public.competition_sessions(id) ON DELETE SET NULL,
    room_code VARCHAR(20) NOT NULL,
    ip_address INET NOT NULL,
    attempt_status VARCHAR(30) NOT NULL,
    failure_reason TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT check_competition_join_status CHECK (
        attempt_status IN ('success', 'failed_invalid_code', 'failed_room_full', 'failed_room_inactive', 'failed_rate_limited', 'failed_banned')
    )
);

-- ============================================================
-- PERFORMANCE & SECURITY INDEXES
-- ============================================================

-- 1. Session lookup indexes
CREATE INDEX idx_competition_sessions_host_status 
    ON public.competition_sessions (host_id, status);

-- Partial Unique Index: Only active sessions must have unique room_code (enables room code recycling)
CREATE UNIQUE INDEX unique_competition_session_active_room_code 
    ON public.competition_sessions (room_code) 
    WHERE status IN ('waiting', 'in_progress', 'paused');

-- General room_code index for fast historical lookups
CREATE INDEX idx_competition_sessions_room_code_all 
    ON public.competition_sessions (room_code);

-- 2. Participant lookup indexes
CREATE INDEX idx_competition_participants_session 
    ON public.competition_participants (session_id);

CREATE INDEX idx_competition_participants_team 
    ON public.competition_participants (team_id) 
    WHERE team_id IS NOT NULL;

-- 3. Answers lookup index
CREATE INDEX idx_competition_answers_lookup 
    ON public.competition_answers (session_id, participant_id);

-- 4. Dynamic Leaderboard Composite Index (Deterministic tie-break)
CREATE INDEX idx_competition_scores_leaderboard 
    ON public.competition_scores (
        session_id, 
        total_score DESC, 
        correct_count DESC, 
        total_response_time_ms ASC
    );

-- 5. Join Attempts Rate-Limit Lookup Indexes
CREATE INDEX idx_competition_join_attempts_ip_time 
    ON public.competition_join_attempts (ip_address, created_at DESC);

CREATE INDEX idx_competition_join_attempts_session_ip_time 
    ON public.competition_join_attempts (session_id, ip_address, created_at DESC);

CREATE INDEX idx_competition_join_attempts_room_time 
    ON public.competition_join_attempts (room_code, created_at DESC);

-- ============================================================
-- BASELINE ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Enable RLS across all 9 tables
ALTER TABLE public.competition_custom_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_custom_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_join_attempts ENABLE ROW LEVEL SECURITY;

-- 1. Custom Groups Policies
CREATE POLICY custom_groups_owner_all 
    ON public.competition_custom_groups 
    FOR ALL 
    TO authenticated 
    USING (owner_id = auth.uid()) 
    WITH CHECK (owner_id = auth.uid());

CREATE POLICY custom_group_members_owner_all 
    ON public.competition_custom_group_members 
    FOR ALL 
    TO authenticated 
    USING (
        EXISTS (
            SELECT 1 FROM public.competition_custom_groups g 
            WHERE g.id = group_id AND g.owner_id = auth.uid()
        )
    ) 
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.competition_custom_groups g 
            WHERE g.id = group_id AND g.owner_id = auth.uid()
        )
    );

CREATE POLICY custom_group_members_student_select 
    ON public.competition_custom_group_members 
    FOR SELECT 
    TO authenticated 
    USING (student_id = auth.uid());

-- 2. Sessions Policies
CREATE POLICY sessions_host_all 
    ON public.competition_sessions 
    FOR ALL 
    TO authenticated 
    USING (host_id = auth.uid()) 
    WITH CHECK (host_id = auth.uid());

CREATE POLICY sessions_authenticated_select 
    ON public.competition_sessions 
    FOR SELECT 
    TO authenticated 
    USING (host_id = auth.uid() OR status IN ('waiting', 'in_progress', 'paused', 'finished'));

CREATE POLICY sessions_anon_select 
    ON public.competition_sessions 
    FOR SELECT 
    TO anon 
    USING (status IN ('waiting', 'in_progress', 'paused', 'finished'));

-- 3. Teams Policies (Fail-closed baseline: Host manages teams; Player team data served via RPC in Migration 2)
CREATE POLICY teams_host_all 
    ON public.competition_teams 
    FOR ALL 
    TO authenticated 
    USING (
        EXISTS (
            SELECT 1 FROM public.competition_sessions s 
            WHERE s.id = session_id AND s.host_id = auth.uid()
        )
    ) 
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.competition_sessions s 
            WHERE s.id = session_id AND s.host_id = auth.uid()
        )
    );

-- 4. Questions Policies (Protected Snapshot: correct_answer hidden from direct student/guest access)
-- Host has full management access. Students/Guests access sanitized questions via Migration 2 RPC.
CREATE POLICY questions_host_all 
    ON public.competition_questions 
    FOR ALL 
    TO authenticated 
    USING (
        EXISTS (
            SELECT 1 FROM public.competition_sessions s 
            WHERE s.id = session_id AND s.host_id = auth.uid()
        )
    ) 
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.competition_sessions s 
            WHERE s.id = session_id AND s.host_id = auth.uid()
        )
    );

-- 5. Participants Policies (Fail-closed baseline: Host has management view; Student/Guest lobby info served via RPC in Migration 2 to protect guest_token_hash)
CREATE POLICY participants_host_all 
    ON public.competition_participants 
    FOR ALL 
    TO authenticated 
    USING (
        EXISTS (
            SELECT 1 FROM public.competition_sessions s 
            WHERE s.id = session_id AND s.host_id = auth.uid()
        )
    );

-- 6. Answers Policies (Direct Client Mutation Denied; Submissions via Migration 2 RPC)
CREATE POLICY answers_host_select 
    ON public.competition_answers 
    FOR SELECT 
    TO authenticated 
    USING (
        EXISTS (
            SELECT 1 FROM public.competition_sessions s 
            WHERE s.id = session_id AND s.host_id = auth.uid()
        )
    );

CREATE POLICY answers_student_select 
    ON public.competition_answers 
    FOR SELECT 
    TO authenticated 
    USING (
        EXISTS (
            SELECT 1 FROM public.competition_participants p 
            WHERE p.id = participant_id AND p.user_id = auth.uid()
        )
    );

-- 7. Scores Policies (Direct Raw Access Restricted to Host & Admin; Student & Guest access leaderboard strictly via Sanitized RPC in Migration 2)
CREATE POLICY scores_host_select 
    ON public.competition_scores 
    FOR SELECT 
    TO authenticated 
    USING (
        EXISTS (
            SELECT 1 FROM public.competition_sessions s 
            WHERE s.id = session_id AND s.host_id = auth.uid()
        )
    );

CREATE POLICY scores_admin_select 
    ON public.competition_scores 
    FOR SELECT 
    TO authenticated 
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p 
            WHERE p.id = auth.uid() AND p.role = 'admin'
        )
    );

-- 8. Join Attempts Policies (Audit Only: Direct Client SELECT/INSERT Denied)
-- No policies granted to authenticated or anon. Writes handled via SECURITY DEFINER RPC in Migration 2.

COMMIT;
