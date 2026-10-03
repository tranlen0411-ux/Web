import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getCapabilityToken,
  createCompetitionChannel,
  removeCompetitionChannel,
  getSessionSnapshot,
  getQuestionSnapshot,
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
 * - Authoritative State Polling: Since backend broadcast events are not yet attached to DB triggers,
 *   uses safe 2000ms polling for authoritative state while waiting / in_progress / paused.
 * - Pauses polling when tab is hidden (document.hidden), immediately refreshes on visibility resume.
 * - Stops all polling and cleans up Realtime channel on terminal states (finished, cancelled) and on unmount.
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
  const lastQuestionIdRef = useRef(null);

  // Authoritative State Refresh Callback
  const refreshAuthoritativeState = useCallback(async () => {
    if (!sessionId || isPollingRef.current) return;
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
      setSessionData(session);

      // 2. Fetch Active Question if in_progress and question ID available
      if (session.status === 'in_progress' && session.current_question_id) {
        if (session.current_question_id !== lastQuestionIdRef.current || !currentQuestion) {
          lastQuestionIdRef.current = session.current_question_id;
          const qRes = await getQuestionSnapshot(session.current_question_id);
          if (isMountedRef.current && qRes.success) {
            setCurrentQuestion(qRes.data);
          }
        }
      } else if (session.status === 'waiting') {
        setCurrentQuestion(null);
        lastQuestionIdRef.current = null;
      }

      // 3. Fetch Leaderboard Snapshot if session is finished
      if (session.status === 'finished') {
        const lbRes = await getLeaderboardSnapshot({ sessionId, participantId });
        if (isMountedRef.current && lbRes.success && Array.isArray(lbRes.data?.leaderboard)) {
          setLeaderboard(lbRes.data.leaderboard);
        }
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(err.message || 'Lỗi khi cập nhật trạng thái phòng thi.');
      }
    } finally {
      isPollingRef.current = false;
    }
  }, [sessionId, participantId, currentQuestion]);

  // Main Realtime & Polling Lifecycle
  useEffect(() => {
    isMountedRef.current = true;

    if (!sessionId || !participantId || !enabled) {
      setConnectionStatus('disconnected');
      return;
    }

    let activeChannel = null;
    let isCancelled = false;

    async function initRealtime() {
      try {
        setConnectionStatus('connecting');

        // 1. Obtain capability token (in-memory only)
        const tokenRes = await getCapabilityToken({ sessionId, participantId });
        if (isCancelled) return;

        if (!tokenRes.success || !tokenRes.token) {
          setConnectionStatus('error');
          setError(tokenRes.error || 'Không thể xác thực kết nối Realtime.');
          return;
        }

        // 2. Create private Realtime channel with presence contract: { p_id: participantId, st: 'active' }
        activeChannel = createCompetitionChannel({
          sessionId,
          participantId,
          capabilityToken: tokenRes.token,
          presence: { p_id: participantId, st: 'active' },
          onBroadcast: (payload) => {
            // If server emits broadcast in future, trigger authoritative refresh
            if (payload?.event) {
              refreshAuthoritativeState();
            }
          },
        });

        channelRef.current = activeChannel;
        setConnectionStatus('connected');

        // Initial authoritative state fetch
        await refreshAuthoritativeState();
      } catch (err) {
        if (!isCancelled) {
          setConnectionStatus('error');
          setError(err.message || 'Lỗi khởi tạo kết nối phòng thi.');
        }
      }
    }

    initRealtime();

    // 3. Setup Authoritative State Polling (2000ms cadence while active)
    const pollInterval = setInterval(() => {
      if (document.hidden) return; // Pause polling when tab is hidden
      if (sessionData?.status === 'finished' || sessionData?.status === 'cancelled') {
        return; // Stop polling on terminal states
      }
      refreshAuthoritativeState();
    }, 2000);
    pollTimerRef.current = pollInterval;

    // 4. Tab Visibility Listener (Instant refresh on tab focus)
    const handleVisibilityChange = () => {
      if (!document.hidden && (!sessionData || !['finished', 'cancelled'].includes(sessionData.status))) {
        refreshAuthoritativeState();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup on unmount / session change
    return () => {
      isCancelled = true;
      isMountedRef.current = false;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (activeChannel) {
        removeCompetitionChannel(activeChannel, sessionId, participantId);
        channelRef.current = null;
      }
    };
  }, [sessionId, participantId, enabled, refreshAuthoritativeState, sessionData?.status]);

  return {
    connectionStatus,
    sessionData,
    currentQuestion,
    leaderboard,
    error,
    refreshAuthoritativeState,
  };
}
