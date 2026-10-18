-- =========================================================================
-- COMPETITION V1 R19: LIVE MUSIC SYNC DURING COMPETITION
-- Target: Allow Host to update audio configuration during 'in_progress'
--         and 'paused' competition sessions, while retaining strict Host
--         ownership check, row lock, payload validation, and rejection of
--         terminal sessions ('finished', 'cancelled').
--
-- Invariants:
--   1. Zero modification to historical migration 20261015000001
--   2. Preserves immutable validate_competition_audio_config validator
--   3. Strictly enforces Host ownership (auth.uid() = host_id)
--   4. Row lock FOR UPDATE prevents race conditions
--   5. Allows waiting, in_progress, and paused session statuses
--   6. Strictly rejects finished and cancelled sessions
--   7. Zero direct client writes (REVOKE ALL; authenticated RPC only)
-- =========================================================================

BEGIN;

-- Conservative timeouts
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- -------------------------------------------------------------------------
-- RPC CẬP NHẬT CẤU HÌNH ÂM THANH PHÒNG THI (HỖ TRỢ THAY ĐỔI KHI ĐANG THI)
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
    -- 1. Caller Authentication
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

    -- 2. Validate Audio Config
    v_is_valid := public.validate_competition_audio_config(p_audio_config);
    IF NOT v_is_valid THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_AUDIO_CONFIG',
            'message', 'Cấu hình âm thanh không hợp lệ hoặc chứa giá trị ngoài danh mục cho phép.'
        );
    END IF;

    -- 3. Lock Session Row FOR UPDATE
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

    -- 4. Host Authorization Check: Strictly verify Host ownership
    IF v_session.host_id <> v_caller_id THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'FORBIDDEN',
            'message', 'Chỉ chủ phòng thi mới được phép thay đổi cấu hình âm thanh.'
        );
    END IF;

    -- 5. Status Check: Allow waiting, in_progress, and paused. Strictly reject finished or cancelled.
    IF v_session.status NOT IN ('waiting', 'in_progress', 'paused') THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_STATE',
            'message', 'Chỉ có thể thay đổi cấu hình âm thanh khi phòng thi đang ở trạng thái chờ, đang diễn ra hoặc tạm dừng.'
        );
    END IF;

    -- 6. Atomic Upsert
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
-- PHÂN QUYỀN THỰC THI RPC
-- -------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.competition_host_set_audio_config(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.competition_host_set_audio_config(UUID, JSONB) TO authenticated;

COMMIT;
