import { useState, useEffect, useRef, useCallback } from 'react';
import { getSessionSnapshot, getSessionParticipants } from '../services/competitionClient.js';

export const POLLING_WAITING_MS = 3000;
export const POLLING_ACTIVE_MS = 2000;

/**
 * Custom React Hook for Host Competition Polling (Phase F2 Hardened).
 *
 * Guaranteed Invariants:
 * - fetchSessionData callback is 100% stable per sessionId (Zero dependency on snapshot identity)
 * - Zero fetch loops on state updates
 * - 3000ms cadence while WAITING (Lobby)
 * - 2000ms cadence while IN_PROGRESS / PAUSED
 * - Stops completely when status is FINISHED or CANCELLED
 * - Pauses polling when document.hidden === true, resumes with 1 immediate fetch + 1 scheduled timer
 * - Non-overlapping async requests (protected by isFetchingRef)
 * - manual refreshNow() triggers immediate fetch and seamlessly resumes polling schedule
 * - Safe unmount cleanup preventing stale async updates
 */
export function useHostCompetitionPolling(sessionId, initialStatus = 'waiting') {
  const [snapshot, setSnapshot] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const status = snapshot?.status || initialStatus;
  const isTerminal = status === 'finished' || status === 'cancelled';

  // Refs for stable execution without re-triggering effects
  const isFetchingRef = useRef(false);
  const timerRef = useRef(null);
  const isMountedRef = useRef(true);
  const snapshotRef = useRef(snapshot);
  const hasSnapshotRef = useRef(false);

  // Synchronize snapshot ref
  useEffect(() => {
    snapshotRef.current = snapshot;
    if (snapshot) {
      hasSnapshotRef.current = true;
    }
  }, [snapshot]);

  // Stable fetch callback (Depends strictly on sessionId, NOT on snapshot object identity)
  const fetchSessionData = useCallback(async (isManualRefresh = false) => {
    if (!sessionId || isFetchingRef.current || !isMountedRef.current) return;

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
        snapshotRef.current = snapRes.data;
        hasSnapshotRef.current = true;
        setSnapshot(snapRes.data);
        setError(null);
      } else if (!snapRes.success && !hasSnapshotRef.current) {
        // Only set error if no previous valid snapshot exists
        setError(snapRes.message || 'Không thể tải thông tin phòng thi.');
      }

      if (partRes.success && Array.isArray(partRes.data)) {
        setParticipants(partRes.data);
      }
    } catch (err) {
      if (isMountedRef.current && !hasSnapshotRef.current) {
        setError(err.message || 'Lỗi mạng khi cập nhật dữ liệu phòng thi.');
      }
    } finally {
      isFetchingRef.current = false;
      if (isMountedRef.current && isManualRefresh) {
        setIsLoading(false);
      }
    }
  }, [sessionId]);

  // Scheduler helper to schedule next poll based on current status
  const scheduleNextPoll = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!isMountedRef.current || !sessionId) return;

    const currentStatus = snapshotRef.current?.status || initialStatus;
    const isTerm = currentStatus === 'finished' || currentStatus === 'cancelled';

    if (isTerm || (typeof document !== 'undefined' && document.hidden)) {
      return;
    }

    let intervalMs = POLLING_WAITING_MS;
    if (currentStatus === 'in_progress' || currentStatus === 'paused') {
      intervalMs = POLLING_ACTIVE_MS;
    }

    timerRef.current = setTimeout(async () => {
      if (!isMountedRef.current) return;
      await fetchSessionData(false);
      scheduleNextPoll();
    }, intervalMs);
  }, [sessionId, initialStatus, fetchSessionData]);

  // Public manual refresh function: Immediate fetch + seamless continuation of polling
  const refreshNow = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await fetchSessionData(true);
    scheduleNextPoll();
  }, [fetchSessionData, scheduleNextPoll]);

  // Public manual setSnapshot helper
  const setSnapshotPublic = useCallback((newSnap) => {
    snapshotRef.current = newSnap;
    if (newSnap) hasSnapshotRef.current = true;
    setSnapshot(newSnap);
  }, []);

  // Main Polling & Visibility Lifecycle Effect
  useEffect(() => {
    isMountedRef.current = true;

    if (!sessionId || isTerminal) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    // Initial fetch on mount or status change, followed by scheduled polling
    fetchSessionData(false).then(() => {
      if (isMountedRef.current && !isTerminal) {
        scheduleNextPoll();
      }
    });

    // Handle Tab Visibility
    const handleVisibilityChange = () => {
      if (typeof document === 'undefined') return;
      if (document.hidden) {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      } else {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        fetchSessionData(false).then(() => {
          if (isMountedRef.current && !isTerminal) {
            scheduleNextPoll();
          }
        });
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [sessionId, status, isTerminal, fetchSessionData, scheduleNextPoll]);

  // Unmount Safety Effect
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return {
    snapshot,
    participants,
    isLoading,
    error,
    refreshNow,
    setSnapshot: setSnapshotPublic,
  };
}
