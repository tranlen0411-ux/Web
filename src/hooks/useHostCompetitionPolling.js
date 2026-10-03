import { useState, useEffect, useRef, useCallback } from 'react';
import { getSessionSnapshot, getSessionParticipants } from '../services/competitionClient.js';

export const POLLING_WAITING_MS = 3000;
export const POLLING_ACTIVE_MS = 2000;

/**
 * Custom React Hook for Host Competition Polling (Phase F2).
 *
 * Implements a resilient, safe polling loop:
 * - 3000ms while WAITING (Lobby)
 * - 2000ms while IN_PROGRESS / PAUSED
 * - Stops completely when FINISHED or CANCELLED
 * - Pauses polling when document.hidden === true, resumes on visibility
 * - Non-overlapping requests with error tolerance
 * - Immediate refresh capability after Host mutations
 */
export function useHostCompetitionPolling(sessionId, initialStatus = 'waiting') {
  const [snapshot, setSnapshot] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const status = snapshot?.status || initialStatus;
  const isTerminal = status === 'finished' || status === 'cancelled';

  // Refs for tracking execution state without triggering re-renders
  const isFetchingRef = useRef(false);
  const timerRef = useRef(null);
  const isMountedRef = useRef(true);

  const fetchSessionData = useCallback(async (isManualRefresh = false) => {
    if (!sessionId || isFetchingRef.current) return;

    isFetchingRef.current = true;
    if (isManualRefresh) {
      setIsLoading(true);
    }

    try {
      const [snapRes, partRes] = await Promise.all([
        getSessionSnapshot(sessionId),
        getSessionParticipants(sessionId),
      ]);

      if (!isMountedRef.current) return;

      if (snapRes.success && snapRes.data) {
        setSnapshot(snapRes.data);
        setError(null);
      } else if (!snapRes.success && !snapshot) {
        // Only set error if we don't already have valid snapshot data
        setError(snapRes.message || 'Không thể tải thông tin phòng thi.');
      }

      if (partRes.success && Array.isArray(partRes.data)) {
        setParticipants(partRes.data);
      }
    } catch (err) {
      if (isMountedRef.current && !snapshot) {
        setError(err.message || 'Lỗi mạng khi cập nhật dữ liệu phòng thi.');
      }
    } finally {
      isFetchingRef.current = false;
      if (isMountedRef.current && isManualRefresh) {
        setIsLoading(false);
      }
    }
  }, [sessionId, snapshot]);

  // Public manual refresh function for Host actions
  const refreshNow = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    await fetchSessionData(true);
  }, [fetchSessionData]);

  // Main Polling Loop
  useEffect(() => {
    isMountedRef.current = true;

    if (!sessionId || isTerminal) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    let intervalMs = POLLING_WAITING_MS;
    if (status === 'in_progress' || status === 'paused') {
      intervalMs = POLLING_ACTIVE_MS;
    }

    const scheduleNextPoll = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (!isMountedRef.current || isTerminal || (typeof document !== 'undefined' && document.hidden)) {
        return;
      }

      timerRef.current = setTimeout(async () => {
        await fetchSessionData(false);
        scheduleNextPoll();
      }, intervalMs);
    };

    // Initial fetch on mount or status change
    fetchSessionData(false).then(() => {
      scheduleNextPoll();
    });

    // Handle Tab Visibility (Pause when hidden, resume when visible)
    const handleVisibilityChange = () => {
      if (typeof document === 'undefined') return;
      if (document.hidden) {
        if (timerRef.current) clearTimeout(timerRef.current);
      } else {
        fetchSessionData(false).then(() => {
          scheduleNextPoll();
        });
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      isMountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [sessionId, status, isTerminal, fetchSessionData]);

  return {
    snapshot,
    participants,
    isLoading,
    error,
    refreshNow,
    setSnapshot,
  };
}
