import { createClient } from '@supabase/supabase-js';
import { supabase, supabaseUrl, supabaseAnonKey } from '../lib/supabase.js';

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
 * - Dedicated Realtime client (Isolated from application shared Supabase client)
 * - Private Realtime Channel only (topic: competition:session:<session_id>)
 * - Broadcast SELECT only, Zero client Broadcast INSERT
 */

/**
 * DEDICATED COMPETITION REALTIME CLIENT
 * Isolates custom capability token authorization from the application's shared Supabase singleton.
 *
 * Invariants:
 * - Uses public/anon key only (Zero service_role key)
 * - Zero auth persistence (persistSession: false, autoRefreshToken: false)
 * - setAuth() applied strictly to this instance, never mutating shared supabase.realtime
 */
export const competitionRealtimeClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

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
 * IMPORTANT:
 * - participantId must be the verified Competition participant ID (from public.competition_participants).
 * - Host cannot mint a capability token unless Host has an explicit participant record.
 * - F2 Host must NOT depend on participant capability tokens unless a separate proven host path exists.
 *
 * @param {Object} params
 * @param {string} params.sessionId - UUID of the session
 * @param {string} params.participantId - UUID of the verified participant
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
      if (cached.token) {
        competitionRealtimeClient.realtime.setAuth(cached.token);
      }
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

    // Apply token to dedicated Competition Realtime client
    competitionRealtimeClient.realtime.setAuth(data.token);

    // Clear previous refresh timer if exists
    if (inMemoryTokenCache.has(cacheKey)) {
      const old = inMemoryTokenCache.get(cacheKey);
      if (old.timerId) clearTimeout(old.timerId);
    }

    // Schedule auto-refresh 60 seconds before expiration
    const refreshDelayMs = Math.max(1000, (expiresAt - nowSeconds - 60) * 1000);
    const timerId = setTimeout(() => {
      getCapabilityToken({ sessionId, participantId, guestToken, forceRefresh: true })
        .then((res) => {
          if (res?.success && res.token) {
            competitionRealtimeClient.realtime.setAuth(res.token);
          }
        })
        .catch(() => {
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
 * @param {string} params.participantId - UUID of the verified participant
 * @param {string} [params.capabilityToken] - Optional capability token to setAuth on dedicated client
 * @param {Object} [params.presence] - Optional presence payload to track
 * @param {Function} [params.onBroadcast] - Optional callback for broadcast events
 * @param {Function} [params.onPresenceSync] - Optional callback for presence sync
 * @returns {RealtimeChannel} Supabase channel instance on dedicated Realtime client
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

  // If capability token is provided, apply it strictly to the dedicated Competition Realtime client
  if (capabilityToken) {
    competitionRealtimeClient.realtime.setAuth(capabilityToken);
  }

  const topic = getCompetitionTopic(sessionId);
  const channel = competitionRealtimeClient.channel(topic, {
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

  // Default presence payload adheres to established minimal Competition contract: { p_id: participantId, st: 'active' }
  const defaultPresence = participantId ? { p_id: participantId, st: 'active' } : null;
  const presencePayload = presence !== undefined && presence !== null ? presence : defaultPresence;

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED' && presencePayload) {
      channel.track(presencePayload);
    }
  });

  return channel;
}

/**
 * Unsubscribes and cleans up a Realtime competition channel on dedicated client.
 * Optionally clears capability token state from in-memory cache.
 */
export async function removeCompetitionChannel(channel, sessionId = null, participantId = null) {
  if (sessionId && participantId) {
    clearCapabilityToken(sessionId, participantId);
  }
  if (!channel) return;
  try {
    await competitionRealtimeClient.removeChannel(channel);
  } catch (_err) {
    // Ignore cleanup errors
  }
}

// ============================================================================
// 3. HOST RPC & SNAPSHOT METHODS (F2 HOST FOUNDATION)
// ============================================================================
/**
 * Host Strategy & Proven Backend Integration Boundaries:
 *
 * Safely Supported NOW:
 * 1. Host RPCs (competition_host_create_session, competition_host_start_session, etc.)
 *    authenticated via standard Supabase user JWT (admin / teacher role).
 * 2. getSessionSnapshot: Direct RLS SELECT on public.competition_sessions.
 * 3. getSessionParticipants: Direct Host RLS SELECT on public.competition_participants.
 * 4. getLeaderboardSnapshot: RPC public.competition_get_leaderboard_snapshot.
 *
 * Realtime Authorization Boundary:
 * - Current M3B Realtime policy is designed for participants with a valid row in competition_participants.
 * - Host Realtime private topic authorization is NOT PROVEN by current backend without a participant row.
 * - Therefore, F2 Host UI must use polling / snapshot refresh until a separately reviewed
 *   Host Realtime authorization path is proven and deployed.
 */

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
  reviewEnabled = false,
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
      p_review_enabled: reviewEnabled,
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

/**
 * Host: Manually closes the active question ahead of natural timer expiry.
 * RPC: public.competition_host_close_question
 */
export async function hostCloseQuestion(sessionId) {
  if (!sessionId) {
    return { success: false, error_code: 'INVALID_SESSION_ID', message: 'ID phòng thi không được để trống.' };
  }
  try {
    const { data, error } = await supabase.rpc('competition_host_close_question', {
      p_session_id: sessionId,
    });

    if (error) return normalizeResponse(null, error.message);
    return normalizeResponse(data, 'Không thể đóng câu hỏi.');
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

/**
 * Student: Reads authoritative question review after session finished (if review_enabled).
 * RPC: public.competition_student_get_review
 */
export async function studentGetReview({
  sessionId,
  participantId,
}) {
  if (!sessionId || !participantId) {
    return { success: false, error_code: 'INVALID_PARAMS', message: 'Thiếu sessionId hoặc participantId hợp lệ.' };
  }
  try {
    const { data, error } = await supabase.rpc('competition_student_get_review', {
      p_session_id: sessionId,
      p_participant_id: participantId,
    });

    if (error) return normalizeResponse(null, error.message);
    return normalizeResponse(data, 'Không thể tải dữ liệu xem lại bài thi.');
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
    const { data, error, status } = await supabase
      .from('competition_sessions')
      .select('id, room_code, title, description, mode, status, max_participants, current_question_index, current_question_id, question_deadline, review_enabled, started_at, ended_at')
      .eq('id', sessionId)
      .maybeSingle();

    if (error) {
      const isAuthOrNotFound = error.code === 'PGRST116' || error.code === '42501' || status === 401 || status === 403 || status === 404;
      return {
        success: false,
        error_code: isAuthOrNotFound ? 'FORBIDDEN_OR_NOT_FOUND' : (error.code || 'DB_ERROR'),
        message: error.message,
        status: status || (error.code === '42501' ? 403 : undefined)
      };
    }
    if (!data) return { success: false, error_code: 'NOT_FOUND', message: 'Phòng thi không tồn tại.', status: 404 };
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

/**
 * Reads sanitized active question snapshot for a competition session.
 * RPC: public.competition_get_active_question_snapshot
 *
 * Security:
 * - Never selects from public.competition_questions directly
 * - Excludes correct_answer and explanation
 * - Server strictly controls active question derivation from session.current_question_id
 */
export async function getActiveQuestionSnapshot({
  sessionId,
  participantId = null,
  guestToken = null,
}) {
  if (!sessionId) {
    return { success: false, error_code: 'INVALID_SESSION_ID', message: 'ID phòng thi không được để trống.' };
  }
  try {
    const { data, error } = await supabase.rpc('competition_get_active_question_snapshot', {
      p_session_id: sessionId,
      p_participant_id: participantId,
      p_guest_token: guestToken,
    });

    if (error) return normalizeResponse(null, error.message);
    return normalizeResponse(data, 'Không thể lấy thông tin câu hỏi hiện tại.');
  } catch (err) {
    return { success: false, error_code: 'CLIENT_EXCEPTION', message: err.message };
  }
}

/**
 * Reads sanitized real-time current-question submission statistics for Host.
 * RPC: public.competition_host_get_submission_stats
 *
 * Security:
 * - Never queries public.competition_answers directly from client
 * - Excludes answer choices, is_correct, points, time_taken, user_id, guest_token_hash
 * - Server strictly derives current_question_id from session state
 */
export async function getHostSubmissionStats(sessionId) {
  if (!sessionId) {
    return { success: false, error_code: 'INVALID_SESSION_ID', message: 'ID phòng thi không được để trống.' };
  }
  try {
    const { data, error } = await supabase.rpc('competition_host_get_submission_stats', {
      p_session_id: sessionId,
    });

    if (error) return normalizeResponse(null, error.message);
    return normalizeResponse(data, 'Không thể lấy thống kê nộp bài của phòng thi.');
  } catch (err) {
    return { success: false, error_code: 'CLIENT_EXCEPTION', message: err.message };
  }
}

/**
 * Reads sanitized authoritative question results and answer distribution for Host.
 * RPC: public.competition_host_get_question_results
 *
 * Security:
 * - Never queries public.competition_answers directly from client
 * - Gated server-side: accessible only after question_deadline passes
 * - Excludes participant-level answer records, user_id, guest_token_hash
 * - Server strictly derives current_question_id from session state
 */
export async function getHostQuestionResults(sessionId) {
  if (!sessionId) {
    return { success: false, error_code: 'INVALID_SESSION_ID', message: 'ID phòng thi không được để trống.' };
  }
  try {
    const { data, error } = await supabase.rpc('competition_host_get_question_results', {
      p_session_id: sessionId,
    });

    if (error) return normalizeResponse(null, error.message);
    return normalizeResponse(data, 'Không thể lấy kết quả câu hỏi.');
  } catch (err) {
    return { success: false, error_code: 'CLIENT_EXCEPTION', message: err.message };
  }
}

/**
 * Reads sanitized historical or closed question results and answer distribution for Host by question order.
 * RPC: public.competition_host_get_question_result_by_order
 *
 * Security:
 * - Never queries public.competition_answers directly from client
 * - Gated server-side: accessible only for closed/past questions or finished sessions
 * - Excludes participant-level answer records, user_id, guest_token_hash
 * - Authenticated Host or Admin only
 */
export async function getHostQuestionResultByOrder({
  sessionId,
  questionOrder,
}) {
  if (!sessionId) {
    return { success: false, error_code: 'INVALID_SESSION_ID', message: 'ID phòng thi không được để trống.' };
  }
  const numericOrder = typeof questionOrder === 'number' ? questionOrder : parseInt(questionOrder, 10);
  if (isNaN(numericOrder) || numericOrder < 1) {
    return { success: false, error_code: 'INVALID_QUESTION_ORDER', message: 'Thứ tự câu hỏi không hợp lệ.' };
  }
  try {
    const { data, error } = await supabase.rpc('competition_host_get_question_result_by_order', {
      p_session_id: sessionId,
      p_question_order: numericOrder,
    });

    if (error) return normalizeResponse(null, error.message);
    return normalizeResponse(data, 'Không thể lấy kết quả câu hỏi.');
  } catch (err) {
    return { success: false, error_code: 'CLIENT_EXCEPTION', message: err.message };
  }
}


/**
 * Reads sanitized aggregate question difficulty & accuracy analytics for Host.
 * RPC: public.competition_host_get_question_analytics
 *
 * Security & Data Minimization:
 * - Gated server-side: accessible only by session Host or Admin after session status = 'finished'
 * - Server-side aggregation only (zero raw student answer rows, zero PII)
 * - Uses Option A Final Session Roster semantics
 */
export async function getHostQuestionAnalytics(sessionId) {
  if (!isValidSessionUUID(sessionId)) {
    return { success: false, error_code: 'INVALID_SESSION_ID', message: 'ID phòng thi không hợp lệ.' };
  }
  try {
    const { data, error } = await supabase.rpc('competition_host_get_question_analytics', {
      p_session_id: sessionId,
    });

    if (error) return normalizeResponse(null, error.message);
    return normalizeResponse(data, 'Không thể lấy dữ liệu phân tích câu hỏi.');
  } catch (err) {
    return { success: false, error_code: 'CLIENT_EXCEPTION', message: err.message };
  }
}

// ============================================================================
// 6. STUDENT STORAGE KEYS & VALIDATION HELPERS (R4 PERSISTENCE CONTRACT)
// ============================================================================

export const STUDENT_SESSION_STORAGE_KEY = 'competition_student_session_id';
export const STUDENT_PARTICIPANT_STORAGE_KEY = 'competition_student_participant_id';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidSessionUUID(value) {
  if (!value || typeof value !== 'string') return false;
  return UUID_REGEX.test(value.trim());
}

export function isStudentAuthOrPermanentError(errorCode, status) {
  if (!errorCode && !status) return false;
  const code = String(errorCode).toUpperCase();

  if (
    status === 401 ||
    status === 403 ||
    status === 404 ||
    code === 'PGRST116' ||
    code === '42501' ||
    code === 'FORBIDDEN_OR_NOT_FOUND' ||
    code === 'NOT_FOUND' ||
    code === 'SESSION_NOT_FOUND' ||
    code === 'PARTICIPANT_NOT_FOUND' ||
    code === 'PARTICIPANT_KICKED' ||
    code === 'UNAUTHORIZED' ||
    code === 'FORBIDDEN' ||
    code === 'ROLE_NOT_ALLOWED' ||
    code === 'SESSION_NOT_JOINABLE' ||
    code.includes('PERMISSION') ||
    code.includes('NOT_FOUND')
  ) {
    return true;
  }
  return false;
}
