// src/services/examIntegrityCoordinator.js
// Exam Builder V1 - Phase 3D Frontend Integrity Coordinator
// Manages attempt transitions, manual-stop tombstone persistence, and ensures exactly
// one active ExamIntegritySession at a time.

import { createExamIntegritySession, isValidAttemptId } from './examIntegritySession.js';

export function createExamIntegrityCoordinator() {
  let currentAttemptId = null; // Canonical lowercase valid UUID or null
  let manualStoppedAttemptId = null; // Canonical lowercase valid UUID of manually stopped attempt
  let currentSession = null;

  const sync = (options = {}) => {
    const {
      attemptId,
      enabled = true,
      getAccessToken,
      onResult,
      onError,
      targetDocument,
      targetWindow,
      sessionFactory = createExamIntegritySession,
    } = options;

    const isEnabled = Boolean(enabled);
    const rawAttemptId = typeof attemptId === 'string' ? attemptId.trim() : null;
    const isValid = isValidAttemptId(rawAttemptId);
    const canonicalAttemptId = isValid ? rawAttemptId.toLowerCase() : null;

    // 1. Attempt Transition Guard:
    if (isValid) {
      if (canonicalAttemptId !== currentAttemptId) {
        if (currentSession) {
          currentSession.teardown();
          currentSession = null;
        }
        currentAttemptId = canonicalAttemptId;
      }
      // Clear tombstone ONLY when a DIFFERENT valid attempt is supplied
      if (manualStoppedAttemptId && canonicalAttemptId !== manualStoppedAttemptId) {
        manualStoppedAttemptId = null;
      }
    } else {
      // Invalid / null / empty attempt: tear down active session, set currentAttemptId = null,
      // but PRESERVE manualStoppedAttemptId!
      if (currentSession) {
        currentSession.teardown();
        currentSession = null;
      }
      currentAttemptId = null;
      return { active: false };
    }

    // 2. Invalidation & Tombstone Guard:
    // If disabled or attempt has been manually stopped (tombstone active)
    if (!isEnabled || manualStoppedAttemptId === canonicalAttemptId) {
      if (currentSession) {
        currentSession.teardown();
        currentSession = null;
      }
      return { active: false };
    }

    // 3. Existing Session Delegate Update (no teardown / no queue recreation)
    if (currentSession) {
      currentSession.updateCallbacks({ onResult, onError });
      currentSession.updateTokenResolver(getAccessToken);
      return { active: currentSession.isActive() };
    }

    // 4. Fresh Session Creation (Guaranteed exactly one active session)
    currentSession = sessionFactory({
      attemptId: canonicalAttemptId,
      getAccessToken,
      onResult,
      onError,
      targetDocument,
      targetWindow,
    });

    const started = currentSession.start();
    if (!started) {
      currentSession = null;
      return { active: false };
    }

    return { active: currentSession.isActive() };
  };

  const stopIntegrity = () => {
    // Only store tombstone if currentAttemptId is a valid canonical UUID
    if (currentAttemptId && isValidAttemptId(currentAttemptId)) {
      manualStoppedAttemptId = currentAttemptId.toLowerCase();
    }

    if (currentSession) {
      currentSession.stop({ manual: true });
      currentSession = null;
    }

    return { active: false };
  };

  const teardown = () => {
    if (currentSession) {
      currentSession.teardown();
      currentSession = null;
    }
  };

  const isActive = () => {
    return Boolean(currentSession && currentSession.isActive());
  };

  const getManualStoppedAttemptId = () => manualStoppedAttemptId;
  const getCurrentAttemptId = () => currentAttemptId;
  const getCurrentSession = () => currentSession;

  return {
    sync,
    stopIntegrity,
    teardown,
    isActive,
    getManualStoppedAttemptId,
    getCurrentAttemptId,
    getCurrentSession,
  };
}
