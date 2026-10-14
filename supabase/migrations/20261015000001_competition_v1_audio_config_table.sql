-- =========================================================================
-- COMPETITION V1 AUDIO R19 CONFIGURATION & SECURITY HARDENING
-- Target: Dedicated audio configuration table with strict catalog grants,
--         session-bound RLS, and immutable 5-field JSONB validation.
--
-- Invariants:
--   1. Zero modification to public.competition_sessions table schema
--   2. Zero modification to sessions_host_all RLS policy (Preserves 7 Host RPCs)
--   3. Zero modification to public.competition_host_create_session (9 args)
--   4. Zero direct client writes (REVOKE ALL; SELECT only)
--   5. Atomic RPC with row lock and waiting-status guard
-- =========================================================================

-- Conservative timeouts
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- -------------------------------------------------------------------------
-- 1. HÀM KIỂM TRA HỢP LỆ CẤU HÌNH ÂM THANH (IMMUTABLE VALIDATOR)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_competition_audio_config(p_cfg JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    v_key_count INT;
    v_mode TEXT;
    v_selection_mode TEXT;
    v_theme_id TEXT;
    v_lobby_track TEXT;
    v_question_track TEXT;
    v_theme_type TEXT;
    v_lobby_type TEXT;
    v_question_type TEXT;
BEGIN
    -- 1. Từ chối nếu NULL hoặc không phải JSON object
    IF p_cfg IS NULL OR pg_catalog.jsonb_typeof(p_cfg) <> 'object' THEN
        RETURN FALSE;
    END IF;

    -- 2. Chặn khóa lạ: Bắt buộc đúng 5 trường chuẩn của V2
    SELECT count(*) INTO v_key_count FROM pg_catalog.jsonb_object_keys(p_cfg);
    IF v_key_count <> 5 THEN
        RETURN FALSE;
    END IF;

    -- 3. Từ chối nếu thiếu bất kỳ trường bắt buộc nào
    IF NOT (
        p_cfg ? 'mode' AND
        p_cfg ? 'selection_mode' AND
        p_cfg ? 'theme_id' AND
        p_cfg ? 'custom_lobby_track_id' AND
        p_cfg ? 'custom_question_track_id'
    ) THEN
        RETURN FALSE;
    END IF;

    -- 4. mode và selection_mode bắt buộc phải là kiểu chuỗi (string)
    IF pg_catalog.jsonb_typeof(p_cfg->'mode') <> 'string'
       OR pg_catalog.jsonb_typeof(p_cfg->'selection_mode') <> 'string' THEN
        RETURN FALSE;
    END IF;

    v_mode := p_cfg->>'mode';
    v_selection_mode := p_cfg->>'selection_mode';
    v_theme_type := pg_catalog.jsonb_typeof(p_cfg->'theme_id');
    v_lobby_type := pg_catalog.jsonb_typeof(p_cfg->'custom_lobby_track_id');
    v_question_type := pg_catalog.jsonb_typeof(p_cfg->'custom_question_track_id');

    -- 5. Kiểm tra chế độ tổ chức thi đấu
    IF v_mode NOT IN ('in_class', 'online') THEN
        RETURN FALSE;
    END IF;

    -- 6. Kiểm tra theo selection_mode (Hợp đồng V2)
    IF v_selection_mode = 'theme' THEN
        -- Ở chế độ theme: Hai track custom BẮT BUỘC phải là null
        IF v_lobby_type <> 'null' OR v_question_type <> 'null' THEN
            RETURN FALSE;
        END IF;

        -- theme_id bắt buộc là chuỗi nằm trong 9 theme chuẩn
        IF v_theme_type <> 'string' THEN
            RETURN FALSE;
        END IF;

        v_theme_id := p_cfg->>'theme_id';
        IF v_theme_id NOT IN (
            'none',
            'classroom_chill',
            'heroic_orchestral',
            'light_gameshow',
            'calm_focus',
            'bright_classroom',
            'scorm_inspired_calm',
            'scorm_inspired_bright',
            'scorm_inspired_focus'
        ) THEN
            RETURN FALSE;
        END IF;

    ELSIF v_selection_mode = 'custom' THEN
        -- Ở chế độ custom: Hai track BẮT BUỘC là chuỗi trong danh mục 5 bản giao hưởng
        IF v_lobby_type <> 'string' OR v_question_type <> 'string' THEN
            RETURN FALSE;
        END IF;

        v_lobby_track := p_cfg->>'custom_lobby_track_id';
        v_question_track := p_cfg->>'custom_question_track_id';

        IF v_lobby_track NOT IN ('km_at_launch', 'sb_titan', 'sb_ignis', 'sb_the_fury', 'sb_terminus') THEN
            RETURN FALSE;
        END IF;

        IF v_question_track NOT IN ('km_at_launch', 'sb_titan', 'sb_ignis', 'sb_the_fury', 'sb_terminus') THEN
            RETURN FALSE;
        END IF;

        -- theme_id chuẩn hóa là 'none' hoặc thuộc whitelist (hoặc null)
        IF v_theme_type = 'string' THEN
            v_theme_id := p_cfg->>'theme_id';
            IF v_theme_id NOT IN ('none', 'classroom_chill', 'heroic_orchestral', 'light_gameshow', 'calm_focus', 'bright_classroom', 'scorm_inspired_calm', 'scorm_inspired_bright', 'scorm_inspired_focus') THEN
                RETURN FALSE;
            END IF;
        ELSIF v_theme_type <> 'null' THEN
            RETURN FALSE;
        END IF;

    ELSE
        RETURN FALSE;
    END IF;

    RETURN TRUE;
END;
$$;

-- -------------------------------------------------------------------------
-- 2. TẠO BẢNG RIÊNG LƯU CẤU HÌNH ÂM THANH
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.competition_session_audio_configs (
    session_id UUID PRIMARY KEY REFERENCES public.competition_sessions(id) ON DELETE CASCADE,
    config JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT check_competition_session_audio_config CHECK (public.validate_competition_audio_config(config))
);

CREATE INDEX IF NOT EXISTS idx_competition_session_audio_configs_session_id
    ON public.competition_session_audio_configs (session_id);

-- -------------------------------------------------------------------------
-- 3. PHÂN QUYỀN CATALOG & CHÍNH SÁCH RLS (ZERO DIRECT CLIENT WRITE)
-- -------------------------------------------------------------------------
-- Thu hồi toàn bộ quyền thao tác trực tiếp từ client PostgREST
REVOKE ALL ON TABLE public.competition_session_audio_configs FROM PUBLIC, anon, authenticated;

-- Cấp quyền SELECT cho người tham gia và khán giả xem cấu hình
GRANT SELECT ON TABLE public.competition_session_audio_configs TO authenticated, anon;

-- Kích hoạt RLS
ALTER TABLE public.competition_session_audio_configs ENABLE ROW LEVEL SECURITY;

-- Chính sách SELECT ràng buộc quyền xem phiên thi
DROP POLICY IF EXISTS session_audio_configs_authenticated_select ON public.competition_session_audio_configs;
CREATE POLICY session_audio_configs_authenticated_select
    ON public.competition_session_audio_configs
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.competition_sessions s
            WHERE s.id = session_id
              AND (s.host_id = auth.uid() OR s.status IN ('waiting', 'in_progress', 'paused', 'finished'))
        )
    );

DROP POLICY IF EXISTS session_audio_configs_anon_select ON public.competition_session_audio_configs;
CREATE POLICY session_audio_configs_anon_select
    ON public.competition_session_audio_configs
    FOR SELECT
    TO anon
    USING (
        EXISTS (
            SELECT 1 FROM public.competition_sessions s
            WHERE s.id = session_id
              AND s.status IN ('waiting', 'in_progress', 'paused', 'finished')
        )
    );

-- -------------------------------------------------------------------------
-- 4. RPC THIẾT LẬP CẤU HÌNH ÂM THANH DUY NHẤT (SECURITY DEFINER)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.competition_host_set_audio_config(
    p_session_id UUID,
    p_audio_config JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_session RECORD;
    v_is_valid BOOLEAN;
BEGIN
    -- 4.1. Caller Authentication
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'UNAUTHORIZED',
            'message', 'Yêu cầu đăng nhập để cấu hình âm thanh phòng thi.'
        );
    END IF;

    IF p_session_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_ID',
            'message', 'ID phòng thi không được để trống.'
        );
    END IF;

    -- 4.2. Validate Audio Config
    v_is_valid := public.validate_competition_audio_config(p_audio_config);
    IF NOT v_is_valid THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_AUDIO_CONFIG',
            'message', 'Cấu hình âm thanh không hợp lệ hoặc chứa giá trị ngoài danh mục cho phép.'
        );
    END IF;

    -- 4.3. Lock Session Row FOR UPDATE
    SELECT id, host_id, status
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

    -- 4.4. Host Authorization Check
    IF v_session.host_id <> v_caller_id THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'FORBIDDEN',
            'message', 'Chỉ chủ phòng thi mới được phép thay đổi cấu hình âm thanh.'
        );
    END IF;

    -- 4.5. Status Check: Only allowed in waiting status
    IF v_session.status <> 'waiting' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_STATE',
            'message', 'Chỉ có thể thay đổi cấu hình âm thanh khi phòng thi đang ở sảnh chờ.'
        );
    END IF;

    -- 4.6. Atomic Upsert
    INSERT INTO public.competition_session_audio_configs (
        session_id,
        config,
        created_at,
        updated_at
    ) VALUES (
        p_session_id,
        p_audio_config,
        pg_catalog.now(),
        pg_catalog.now()
    )
    ON CONFLICT (session_id) DO UPDATE
    SET config = EXCLUDED.config,
        updated_at = pg_catalog.now();

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'session_id', p_session_id,
        'audio_config', p_audio_config
    );
END;
$$;

-- -------------------------------------------------------------------------
-- 5. PHÂN QUYỀN THỰC THI RPC
-- -------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.competition_host_set_audio_config(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.competition_host_set_audio_config(UUID, JSONB) TO authenticated;
