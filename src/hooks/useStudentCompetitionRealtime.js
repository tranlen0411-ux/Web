import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getCapabilityToken,
  createCompetitionChannel,
  removeCompetitionChannel,
  getSessionSnapshot,
  getActiveQuestionSnapshot,
  getLeaderboardSnapshot,
} from '../services/competitionClient.js';

/**
 * Hook for managing Student Competition Realtime connection and Authoritative State.
 *
 * Architecture & Security Invariants:
 * - Obtains capability token strictly in memory via Edge Function (zero web storage persistence).
 * - Connects to isolated private channel: competition:session:<session_id>
 * - Presence payload adheres strictly to: { p_id: participantId, st: 'active' }
 * - Broadcast SELECT only, zero client Broadcast send, zero Postgres Changes.
 * - Authoritative State Polling: Uses safe 2000ms polling for authoritative state while waiting / in_progress / paused.
 * - Active Question Fetch: Uses sanitized competition_get_active_question_snapshot RPC (zero direct table query).
 * - Pauses polling when tab is hidden (document.hidden), immediately refreshes on visibility resume.
 * - Stops all polling and cleans up Realtime channel on terminal states (finished, cancelled) and on unmount.
 * - Stable Callbacks: refreshAuthoritativeState is 100% stable per sessionId/participantId (Zero dependency on currentQuestion).
 * - Channel Churn Prevention: Question updates or status polls never recreate the Realtime channel.
 *
 * @param {Object} params
 * @param {string|null} params.sessionId - Session UUID
 * @param {string|null} params.participantId - Verified participant UUID
 * @param {boolean} [params.enabled=true] - Whether realtime connection is active
 * @returns {Object} { connectionStatus, sessionData, currentQuestion, leaderboard, error, refreshAuthoritativeState }
 */
export function useStudentCompetitionRealtime({
  sessionId,
  participantId,
  guestToken = null,
  enabled = true,
}) {
  const [connectionStatus, setConnectionStatus] = useState('disconnected'); // 'disconnected' | 'connecting' | 'connected' | 'error'
  const [sessionData, setSessionData] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [error, setError] = useState(null);

  const channelRef = useRef(null);
  const pollTimerRef = useRef(null);
  const isPollingRef = useRef(false);
  const isMountedRef = useRef(true);
  const isTerminalRef = useRef(false);
  const currentQuestionRef = useRef(currentQuestion);
  const sessionDataRef = useRef(sessionData);

  useEffect(() => {
    currentQuestionRef.current = currentQuestion;
  }, [currentQuestion]);

  useEffect(() => {
    sessionDataRef.current = sessionData;
  }, [sessionData]);

  // Stable Final Leaderboard Refresh Callback (Permits retry on finished sessions without realtime channel)
  const refreshFinalLeaderboard = useCallback(async () => {
    if (!sessionId || !participantId || !isMountedRef.current) {
      return { success: false, message: 'Thiếu thông tin phiên thi.' };
    }

    try {
      const lbRes = await getLeaderboardSnapshot({
        sessionId,
        participantId,
        guestToken,
      });

      if (!isMountedRef.current) {
        return { success: false };
      }

      if (lbRes.success && Array.isArray(lbRes.data?.leaderboard)) {
        setLeaderboard(lbRes.data.leaderboard);
        setError(null);
        return { success: true, data: lbRes.data };
      }

      setError(lbRes.message || 'Không thể tải bảng xếp hạng chung cuộc.');
      return {
        success: false,
        error_code: lbRes.error_code,
        status: lbRes.status,
        message: lbRes.message,
      };
    } catch (err) {
      if (isMountedRef.current) {
        setError(err.message || 'Lỗi mạng khi tải bảng xếp hạng chung cuộc.');
      }
      return {
        success: false,
        error_code: 'CLIENT_EXCEPTION',
        message: err.message,
      };
    }
  }, [sessionId, participantId, guestToken]);

  // Stable Authoritative State Refresh Callback (Depends strictly on sessionId & participantId)
  const refreshAuthoritativeState = useCallback(async () => {
    if (!sessionId || isPollingRef.current || !isMountedRef.current || isTerminalRef.current) return;
    isPollingRef.current = true;

    try {
      // 1. Fetch Session Snapshot
      const sessionRes = await getSessionSnapshot(sessionId);
      if (!isMountedRef.current) return;

      if (!sessionRes.success) {
        setError(sessionRes.message || 'Không thể lấy thông tin phòng thi.');
        return;
      }

      const session = sessionRes.data;
      sessionDataRef.current = session;
      setSessionData(session);

      const isTerminal = session.status === 'finished' || session.status === 'cancelled';
      if (isTerminal) {
        isTerminalRef.current = true;
        // Stop polling interval immediately
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
        // Cleanup realtime channel on terminal state
        if (channelRef.current) {
          removeCompetitionChannel(channelRef.current, sessionId, participantId);
          channelRef.current = null;
        }
        setConnectionStatus('disconnected');
      }

      // 2. Fetch Active Sanitized Question via RPC
      if (session.status === 'in_progress' || session.status === 'paused') {
        const qRes = await getActiveQuestionSnapshot({ sessionId, participantId, guestToken });
        if (isMountedRef.current && qRes.success) {
          const activeQ = qRes.data?.question || null;
          currentQuestionRef.current = activeQ;
          setCurrentQuestion(activeQ);
        }
      } else if (session.status === 'waiting' || isTerminal) {
        currentQuestionRef.current = null;
        setCurrentQuestion(null);
      }

      // 3. Fetch Leaderboard Snapshot if session is finished
      if (session.status === 'finished') {
        await refreshFinalLeaderboard();
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(err.message || 'Lỗi khi cập nhật trạng thái phòng thi.');
      }
    } finally {
      isPollingRef.current = false;
    }
  }, [sessionId, participantId, guestToken, refreshFinalLeaderboard]);

  // Main Realtime & Polling Lifecycle Effect
  useEffect(() => {
    isMountedRef.current = true;
    isTerminalRef.current = false;

    if (!sessionId || !participantId || !enabled) {
      setConnectionStatus('disconnected');
      return;
    }

    let activeChannel = null;
    let isCancelled = false;

    async function initRealtime() {
      try {
        setConnectionStatus('connecting');

        // 1. Fetch authoritative state FIRST (handles terminal states without needing realtime capability)
        await refreshAuthoritativeState();

        if (isCancelled || isTerminalRef.current || !isMountedRef.current) {
          return;
        }

        // 2. Only active sessions need realtime capability token (in-memory only)
        const tokenRes = await getCapabilityToken({ sessionId, participantId, guestToken });
        if (isCancelled || isTerminalRef.current || !isMountedRef.current) return;

        if (!tokenRes.success || !tokenRes.token) {
          setConnectionStatus('error');
          setError(tokenRes.error || 'Không thể xác thực kết nối Realtime.');
          return;
        }

        // 3. Create private Realtime channel with presence contract: { p_id: participantId, st: 'active' }
        activeChannel = createCompetitionChannel({
          sessionId,
          participantId,
          capabilityToken: tokenRes.token,
          presence: { p_id: participantId, st: 'active' },
          onBroadcast: (payload) => {
            // If server emits broadcast in future, trigger authoritative refresh
            if (payload?.event && !isTerminalRef.current) {
              refreshAuthoritativeState();
            }
          },
        });

        if (isCancelled || isTerminalRef.current || !isMountedRef.current) {
          if (activeChannel) {
            removeCompetitionChannel(activeChannel, sessionId, participantId);
          }
          return;
        }

        channelRef.current = activeChannel;
        setConnectionStatus('connected');
      } catch (err) {
        if (!isCancelled && !isTerminalRef.current && isMountedRef.current) {
          setConnectionStatus('error');
          setError(err.message || 'Lỗi khởi tạo kết nối phòng thi.');
        }
      }
    }

    initRealtime();

    // 3. Setup Authoritative State Polling (2000ms cadence while active)
    const pollInterval = setInterval(() => {
      if (document.hidden) return; // Pause polling when tab is hidden
      if (isTerminalRef.current) return; // Stop polling on terminal states
      refreshAuthoritativeState();
    }, 2000);
    pollTimerRef.current = pollInterval;

    // 4. Tab Visibility Listener (Instant refresh on tab focus)
    const handleVisibilityChange = () => {
      if (!document.hidden && !isTerminalRef.current) {
        refreshAuthoritativeState();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup on unmount / session or participant change
    return () => {
      isCancelled = true;
      isMountedRef.current = false;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (channelRef.current) {
        removeCompetitionChannel(channelRef.current, sessionId, participantId);
        channelRef.current = null;
      } else if (activeChannel) {
        removeCompetitionChannel(activeChannel, sessionId, participantId);
      }
    };
  }, [sessionId, participantId, guestToken, enabled, refreshAuthoritativeState]);

  return {
    connectionStatus,
    sessionData,
    currentQuestion,
    leaderboard,
    error,
    refreshAuthoritativeState,
    refreshFinalLeaderboard,
  };
}
