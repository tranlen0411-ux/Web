import { supabase, supabaseUrl } from '../lib/supabase.js';

/**
 * COMPETITION CLIENT SERVICE (Competition V1)
 *
 * Provides typed, fail-safe client methods for Host and Student competition workflows.
 * Integrates directly with Supabase RPCs and the competition-capability-token-issuer Edge Function.
 *
 * Security Invariants:
 * - Zero service_role key usage (Client-safe only)
 * - Zero hardcoded secrets / signing keys
 * - In-memory token storage only (Zero browser web storage persistence)
 * - Private Realtime Channel only (topic: competition:session:<session_id>)
 * - Broadcast SELECT only, Zero client Broadcast INSERT
 */

// In-memory cache for short-lived HMAC capability tokens: Map<key, { token, expiresAt, timerId }>
const inMemoryTokenCache = new Map();

/**
 * Helper to generate cache key for in-memory token storage
 */
function getTokenCacheKey(sessionId, participantId) {
  return `${sessionId}:${participantId}`;
}

/**
 * Helper to safely decode JWT expiry from payload (without external libraries)
 */
function parseJwtExp(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const decoded = JSON.parse(jsonPayload);
    return typeof decoded.exp === 'number' ? decoded.exp : null;
  } catch (_err) {
    return null;
  }
}

/**
 * Normalize RPC and HTTP responses to standard shape:
 * { success: boolean, data?: any, error_code?: string, message?: string }
 */
function normalizeResponse(res, defaultError = 'Lỗi không xác định khi thực hiện thao tác.') {
  if (!res) {
    return { success: false, error_code: 'EMPTY_RESPONSE', message: defaultError };
  }
  if (res.success === false) {
    return {
      success: false,
      error_code: res.error_code || 'RPC_ERROR',
      message: res.message || defaultError,
    };
  }
  return {
    success: true,
    data: res,
  };
}

// ============================================================================
// 1. CAPABILITY TOKEN LIFECYCLE (IN-MEMORY ONLY)
// ============================================================================

/**
 * Fetches a short-lived capability token from Edge Function.
 * Stores token strictly in memory and schedules auto-refresh before expiry (exp - 60s).
 *
 * @param {Object} params
 * @param {string} params.sessionId - UUID of the session
 * @param {string} params.participantId - UUID of the participant (or host)
 * @param {string} [params.guestToken] - Optional guest token (min 32 chars) for guest flow
 * @param {boolean} [params.forceRefresh=false] - Force fresh token fetch ignoring memory cache
 * @returns {Promise<{ success: boolean, token?: string, expires_at?: number, error?: string }>}
 */
export async function getCapabilityToken({ sessionId, participantId, guestToken = null, forceRefresh = false }) {
  if (!sessionId || !participantId) {
    return { success: false, error: 'Thiếu sessionId hoặc participantId hợp lệ.' };
  }

  const cacheKey = getTokenCacheKey(sessionId, participantId);
  const nowSeconds = Math.floor(Date.now() / 1000);

  // Check valid in-memory cached token (must have at least 30s remaining)
  if (!forceRefresh && inMemoryTokenCache.has(cacheKey)) {
    const cached = inMemoryTokenCache.get(cacheKey);
    if (cached.expiresAt && cached.expiresAt - nowSeconds > 30) {
      return { success: true, token: cached.token, expires_at: cached.expiresAt };
    }
  }

  try {
    const isGuest = Boolean(guestToken && typeof guestToken === 'string');
    const headers = { 'Content-Type': 'application/json' };
    const body = {
      session_id: sessionId,
      participant_id: participantId,
    };

    if (isGuest) {
      body.guest_token = guestToken;
    } else {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) {
        return { success: false, error: 'Chưa đăng nhập hoặc phiên làm việc hết hạn.' };
      }
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }

    const response = await fetch(
      `${supabaseUrl}/functions/v1/competition-capability-token-issuer`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }
    );

    const data = await response.json();
    if (!response.ok || !data.token) {
      return {
        success: false,
        error: data.message || `Lỗi cấp token năng lực: HTTP ${response.status}`,
      };
    }

    const expiresAt = data.expires_at || parseJwtExp(data.token) || (nowSeconds + 300);

    // Clear previous refresh timer if exists
    if (inMemoryTokenCache.has(cacheKey)) {
      const old = inMemoryTokenCache.get(cacheKey);
      if (old.timerId) clearTimeout(old.timerId);
    }

    // Schedule auto-refresh 60 seconds before expiration
    const refreshDelayMs = Math.max(1000, (expiresAt - nowSeconds - 60) * 1000);
    const timerId = setTimeout(() => {
      getCapabilityToken({ sessionId, participantId, guestToken, forceRefresh: true }).catch(() => {
        // Silent failure in background refresh; caller will fetch on demand if needed
      });
    }, refreshDelayMs);

    inMemoryTokenCache.set(cacheKey, {
      token: data.token,
      expiresAt,
      timerId,
    });

    return {
      success: true,
      token: data.token,
      expires_at: expiresAt,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || 'Không thể kết nối đến dịch vụ cấp token năng lực.',
    };
  }
}

/**
 * Clears in-memory capability token and cancels auto-refresh timer.
 */
export function clearCapabilityToken(sessionId, participantId) {
  const cacheKey = getTokenCacheKey(sessionId, participantId);
  if (inMemoryTokenCache.has(cacheKey)) {
    const entry = inMemoryTokenCache.get(cacheKey);
    if (entry.timerId) clearTimeout(entry.timerId);
    inMemoryTokenCache.delete(cacheKey);
  }
}

// ============================================================================
// 2. REALTIME CHANNEL WIRING (PRIVATE TOPIC ONLY)
// ============================================================================

/**
 * Helper to construct the strictly enforced Realtime private topic
 */
export function getCompetitionTopic(sessionId) {
  return `competition:session:${sessionId}`;
}

/**
 * Creates and connects a private Supabase Realtime channel for a competition session.
 *
 * @param {Object} params
 * @param {string} params.sessionId - UUID of the session
 * @param {string} params.participantId - UUID of the participant
 * @param {string} [params.capabilityToken] - Optional capability token to setAuth
 * @param {Object} [params.presence] - Optional presence payload to track
 * @param {Function} [params.onBroadcast] - Optional callback for broadcast events
 * @param {Function} [params.onPresenceSync] - Optional callback for presence sync
 * @returns {RealtimeChannel} Supabase channel instance
 */
export function createCompetitionChannel({
  sessionId,
  participantId,
  capabilityToken = null,
  presence = null,
  onBroadcast = null,
  onPresenceSync = null,
}) {
  if (!sessionId) {
    throw new Error('sessionId is required to create a competition channel.');
  }

  // If capability token is provided, apply it to realtime connection
  if (capabilityToken) {
    supabase.realtime.setAuth(capabilityToken);
  }

  const topic = getCompetitionTopic(sessionId);
  const channel = supabase.channel(topic, {
    config: {
      private: true,
      presence: participantId ? { key: participantId } : undefined,
    },
  });

  if (onBroadcast) {
    channel.on('broadcast', { event: '*' }, (payload) => {
      onBroadcast(payload);
    });
  }

  if (onPresenceSync) {
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      onPresenceSync(state);
    });
  }

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED' && presence) {
      channel.track(presence);
    }
  });

  return channel;
}

/**
 * Unsubscribes and cleans up a Realtime competition channel.
 */
export async function removeCompetitionChannel(channel) {
  if (!channel) return;
  try {
    await supabase.removeChannel(channel);
  } catch (_err) {
    // Ignore cleanup errors
  }
}

// ============================================================================
// 3. HOST RPC CLIENT METHODS
// ============================================================================

/**
 * Host: Creates a new competition session.
 * RPC: public.competition_host_create_session
 */
export async function hostCreateSession({
  title,
  description = null,
  mode = 'individual',
  maxParticipants = 100,
  questions = [],
  teams = [],
  rewardEnabled = false,
  rewardConfig = {},
}) {
  try {
    const { data, error } = await supabase.rpc('competition_host_create_session', {
      p_title: title,
      p_description: description,
      p_mode: mode,
      p_max_participants: maxParticipants,
      p_questions: questions,
      p_teams: teams,
      p_reward_enabled: rewardEnabled,
      p_reward_config: rewardConfig,
    });

    if (error) return normalizeResponse(null, error.message);
    return normalizeResponse(data, 'Không thể tạo phòng thi.');
  } catch (err) {
    return { success: false, error_code: 'CLIENT_EXCEPTION', message: err.message };
  }
}

/**
 * Host: Starts the session and activates Question #1.
 * RPC: public.competition_host_start_session
 */
export async function hostStartSession(sessionId) {
  try {
    const { data, error } = await supabase.rpc('competition_host_start_session', {
      p_session_id: sessionId,
    });

    if (error) return normalizeResponse(null, error.message);
    return normalizeResponse(data, 'Không thể bắt đầu phòng thi.');
  } catch (err) {
    return { success: false, error_code: 'CLIENT_EXCEPTION', message: err.message };
  }
}

/**
 * Host: Advances to the next question in the session.
 * RPC: public.competition_host_next_question
 */
export async function hostNextQuestion(sessionId) {
  try {
    const { data, error } = await supabase.rpc('competition_host_next_question', {
      p_session_id: sessionId,
    });

    if (error) return normalizeResponse(null, error.message);
    return normalizeResponse(data, 'Không thể chuyển câu hỏi.');
  } catch (err) {
    return { success: false, error_code: 'CLIENT_EXCEPTION', message: err.message };
  }
}

/**
 * Host: Pauses the active question countdown.
 * RPC: public.competition_host_pause_session
 */
export async function hostPauseSession(sessionId) {
  try {
    const { data, error } = await supabase.rpc('competition_host_pause_session', {
      p_session_id: sessionId,
    });

    if (error) return normalizeResponse(null, error.message);
    return normalizeResponse(data, 'Không thể tạm dừng phòng thi.');
  } catch (err) {
    return { success: false, error_code: 'CLIENT_EXCEPTION', message: err.message };
  }
}

/**
 * Host: Resumes the paused question countdown.
 * RPC: public.competition_host_resume_session
 */
export async function hostResumeSession(sessionId) {
  try {
    const { data, error } = await supabase.rpc('competition_host_resume_session', {
      p_session_id: sessionId,
    });

    if (error) return normalizeResponse(null, error.message);
    return normalizeResponse(data, 'Không thể tiếp tục phòng thi.');
  } catch (err) {
    return { success: false, error_code: 'CLIENT_EXCEPTION', message: err.message };
  }
}

/**
 * Host: Cancels the competition session.
 * RPC: public.competition_host_cancel_session
 */
export async function hostCancelSession(sessionId) {
  try {
    const { data, error } = await supabase.rpc('competition_host_cancel_session', {
      p_session_id: sessionId,
    });

    if (error) return normalizeResponse(null, error.message);
    return normalizeResponse(data, 'Không thể hủy phòng thi.');
  } catch (err) {
    return { success: false, error_code: 'CLIENT_EXCEPTION', message: err.message };
  }
}

/**
 * Host: Finalizes the session and computes final ranks.
 * RPC: public.competition_host_finish_session
 */
export async function hostFinishSession(sessionId) {
  try {
    const { data, error } = await supabase.rpc('competition_host_finish_session', {
      p_session_id: sessionId,
    });

    if (error) return normalizeResponse(null, error.message);
    return normalizeResponse(data, 'Không thể kết thúc phòng thi.');
  } catch (err) {
    return { success: false, error_code: 'CLIENT_EXCEPTION', message: err.message };
  }
}

// ============================================================================
// 4. STUDENT RPC CLIENT METHODS
// ============================================================================

/**
 * Student/Guest: Joins a competition session using room code.
 * RPC: public.competition_join_session
 */
export async function studentJoinSession({
  roomCode,
  displayName = null,
  avatarUrl = null,
  teamId = null,
  guestToken = null,
}) {
  try {
    const { data, error } = await supabase.rpc('competition_join_session', {
      p_room_code: roomCode,
      p_display_name: displayName,
      p_avatar_url: avatarUrl,
      p_team_id: teamId,
      p_guest_token: guestToken,
    });

    if (error) return normalizeResponse(null, error.message);
    return normalizeResponse(data, 'Không thể tham gia phòng thi.');
  } catch (err) {
    return { success: false, error_code: 'CLIENT_EXCEPTION', message: err.message };
  }
}

/**
 * Student/Guest: Reconnects/rejoins an existing session.
 * RPC: public.competition_rejoin_session
 */
export async function studentRejoinSession({
  sessionId,
  participantId = null,
  guestToken = null,
}) {
  try {
    const { data, error } = await supabase.rpc('competition_rejoin_session', {
      p_session_id: sessionId,
      p_participant_id: participantId,
      p_guest_token: guestToken,
    });

    if (error) return normalizeResponse(null, error.message);
    return normalizeResponse(data, 'Không thể kết nối lại phòng thi.');
  } catch (err) {
    return { success: false, error_code: 'CLIENT_EXCEPTION', message: err.message };
  }
}

/**
 * Student/Guest: Submits an answer for the active question.
 * RPC: public.competition_submit_answer
 */
export async function studentSubmitAnswer({
  sessionId,
  questionId,
  participantId = null,
  guestToken = null,
  selectedOptionIds = [],
  textAnswer = null,
}) {
  try {
    const { data, error } = await supabase.rpc('competition_submit_answer', {
      p_session_id: sessionId,
      p_question_id: questionId,
      p_participant_id: participantId,
      p_guest_token: guestToken,
      p_selected_option_ids: selectedOptionIds,
      p_text_answer: textAnswer,
    });

    if (error) return normalizeResponse(null, error.message);
    return normalizeResponse(data, 'Không thể nộp câu trả lời.');
  } catch (err) {
    return { success: false, error_code: 'CLIENT_EXCEPTION', message: err.message };
  }
}

// ============================================================================
// 5. SNAPSHOT / READ CLIENT METHODS
// ============================================================================

/**
 * Reads sanitized leaderboard snapshot with calculated ranks.
 * RPC: public.competition_get_leaderboard_snapshot
 */
export async function getLeaderboardSnapshot({
  sessionId,
  participantId = null,
  guestToken = null,
}) {
  try {
    const { data, error } = await supabase.rpc('competition_get_leaderboard_snapshot', {
      p_session_id: sessionId,
      p_participant_id: participantId,
      p_guest_token: guestToken,
    });

    if (error) return normalizeResponse(null, error.message);
    return normalizeResponse(data, 'Không thể lấy bảng xếp hạng.');
  } catch (err) {
    return { success: false, error_code: 'CLIENT_EXCEPTION', message: err.message };
  }
}

/**
 * Reads session snapshot directly via RLS protected SELECT.
 */
export async function getSessionSnapshot(sessionId) {
  try {
    const { data, error } = await supabase
      .from('competition_sessions')
      .select('id, room_code, title, description, mode, status, max_participants, current_question_index, current_question_id, question_deadline, started_at, ended_at')
      .eq('id', sessionId)
      .maybeSingle();

    if (error) return { success: false, error_code: 'DB_ERROR', message: error.message };
    if (!data) return { success: false, error_code: 'NOT_FOUND', message: 'Phòng thi không tồn tại.' };
    return { success: true, data };
  } catch (err) {
    return { success: false, error_code: 'CLIENT_EXCEPTION', message: err.message };
  }
}

/**
 * Reads active participants list for a session (Host view via RLS).
 */
export async function getSessionParticipants(sessionId) {
  try {
    const { data, error } = await supabase
      .from('competition_participants')
      .select('id, session_id, display_name, avatar_url, team_id, is_guest, status, joined_at, last_seen_at')
      .eq('session_id', sessionId)
      .order('joined_at', { ascending: true });

    if (error) return { success: false, error_code: 'DB_ERROR', message: error.message };
    return { success: true, data: data || [] };
  } catch (err) {
    return { success: false, error_code: 'CLIENT_EXCEPTION', message: err.message };
  }
}
