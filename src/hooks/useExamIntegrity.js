// src/hooks/useExamIntegrity.js
// Exam Builder V1 - Phase 3D Frontend Integrity React Hook Adapter
// Ultra-thin React wrapper delegating 100% of lifecycle, tombstone, and queue coordination
// to examIntegrityCoordinator.js and examIntegritySession.js.

import { useEffect, useRef, useState, useCallback } from 'react';
import { createExamIntegrityCoordinator } from '../services/examIntegrityCoordinator.js';
import { isValidAttemptId } from '../services/examIntegritySession.js';

export function canonicalizeAttemptId(id) {
  if (typeof id === 'string' && isValidAttemptId(id.trim())) {
    return id.trim().toLowerCase();
  }
  return null;
}

export function shouldResetIntegrityState(previousAttemptId, currentAttemptId) {
  const prevCanonical = canonicalizeAttemptId(previousAttemptId);
  const currCanonical = canonicalizeAttemptId(currentAttemptId);
  return prevCanonical !== currCanonical;
}

const ALLOWED_POLICIES = new Set(['OFF', 'WARN_ONLY', 'WARN_AND_LOG']);

/**
 * Validates and sanitizes incoming raw result against strict approved schema.
 * Returns exactly 7 fields if valid; returns null if any field is invalid or missing.
 */
export function sanitizeIntegrityResult(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const payload = raw.data && typeof raw.data === 'object' ? raw.data : raw;

  if (
    typeof payload.attempt_id !== 'string' ||
    !payload.attempt_id.trim() ||
    typeof payload.tab_switch_policy !== 'string' ||
    !ALLOWED_POLICIES.has(payload.tab_switch_policy) ||
    !Number.isInteger(payload.tab_switch_count) ||
    payload.tab_switch_count < 0 ||
    (typeof payload.active_leave_episode_id !== 'string' && payload.active_leave_episode_id !== null) ||
    typeof payload.event_recorded !== 'boolean' ||
    (typeof payload.event_type !== 'string' && payload.event_type !== null) ||
    typeof payload.idempotent_replay !== 'boolean'
  ) {
    return null;
  }

  return {
    attempt_id: payload.attempt_id.trim(),
    tab_switch_policy: payload.tab_switch_policy,
    tab_switch_count: payload.tab_switch_count,
    active_leave_episode_id: payload.active_leave_episode_id,
    event_recorded: payload.event_recorded,
    event_type: payload.event_type,
    idempotent_replay: payload.idempotent_replay,
  };
}

/**
 * Sanitizes incoming raw error to safe sanitized properties.
 * Never leaks raw response bodies, headers, SQL, or token material.
 * Does not fabricate HTTP 500 when no real HTTP status exists.
 */
export function sanitizeIntegrityError(err) {
  const type = typeof err?.type === 'string' ? err.type : 'failed_unknown';
  const safeHttpStatus = typeof err?.safeHttpStatus === 'number' ? err.safeHttpStatus : null;

  let safeErrorCode = 'UNKNOWN_ERROR';
  if (typeof err?.safeErrorCode === 'string' && err.safeErrorCode.trim()) {
    safeErrorCode = err.safeErrorCode.trim();
  } else if (typeof err?.error?.code === 'string' && err.error.code.trim()) {
    safeErrorCode = err.error.code.trim();
  } else if (safeHttpStatus !== null) {
    safeErrorCode = `HTTP_${safeHttpStatus}`;
  }

  return {
    type,
    safeHttpStatus,
    safeErrorCode,
  };
}

export function useExamIntegrity({
  attemptId,
  enabled = true,
  getAccessToken,
  onIntegrityResult,
  onIntegrityError,
  targetDocument,
  targetWindow,
  coordinatorFactory = () => createExamIntegrityCoordinator(),
} = {}) {
  const coordinatorRef = useRef(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = coordinatorFactory();
  }

  const lastCanonicalAttemptIdRef = useRef(canonicalizeAttemptId(attemptId));

  const [isIntegrityActive, setIsIntegrityActive] = useState(false);
  const [lastIntegrityResult, setLastIntegrityResult] = useState(null);
  const [lastIntegrityError, setLastIntegrityError] = useState(null);

  const onResultRef = useRef(onIntegrityResult);
  const onErrorRef = useRef(onIntegrityError);
  const getAccessTokenRef = useRef(getAccessToken);

  onResultRef.current = onIntegrityResult;
  onErrorRef.current = onIntegrityError;
  getAccessTokenRef.current = getAccessToken;

  const handleResult = useCallback((rawResult, meta) => {
    const safeResult = sanitizeIntegrityResult(rawResult);
    setLastIntegrityResult(safeResult);
    if (safeResult !== null && typeof onResultRef.current === 'function') {
      try {
        onResultRef.current(safeResult, meta);
      } catch (_) {
        // Guard against UI callback errors
      }
    }
  }, []);

  const handleError = useCallback((rawErr, meta) => {
    const safeError = sanitizeIntegrityError(rawErr);
    setLastIntegrityError(safeError);
    if (typeof onErrorRef.current === 'function') {
      try {
        onErrorRef.current(safeError, meta);
      } catch (_) {
        // Guard against UI callback errors
      }
    }
  }, []);

  const stopIntegrity = useCallback(() => {
    if (coordinatorRef.current) {
      coordinatorRef.current.stopIntegrity();
      setIsIntegrityActive(false);
    }
  }, []);

  useEffect(() => {
    const coordinator = coordinatorRef.current;
    if (!coordinator) {
      return;
    }

    const canonicalAttemptId = canonicalizeAttemptId(attemptId);
    if (canonicalAttemptId !== lastCanonicalAttemptIdRef.current) {
      setLastIntegrityResult(null);
      setLastIntegrityError(null);
      lastCanonicalAttemptIdRef.current = canonicalAttemptId;
    }

    const { active } = coordinator.sync({
      attemptId,
      enabled,
      getAccessToken: () => {
        if (typeof getAccessTokenRef.current === 'function') {
          return getAccessTokenRef.current();
        }
        return null;
      },
      onResult: handleResult,
      onError: handleError,
      targetDocument,
      targetWindow,
    });

    setIsIntegrityActive(active);

    return () => {
      coordinator.teardown();
      setIsIntegrityActive(false);
    };
  }, [attemptId, enabled, handleResult, handleError, targetDocument, targetWindow]);

  return {
    stopIntegrity,
    isIntegrityActive,
    lastIntegrityResult,
    lastIntegrityError,
  };
}
