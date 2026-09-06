// src/services/examIntegritySession.js
// Exam Builder V1 - Phase 3D Frontend Integrity Single-Attempt Session Controller
// Manages one ExamIntegrityQueue instance, lifecycle binding, stable live delegates,
// and generation-guarded terminal state handling.

import { ExamIntegrityQueue } from './examIntegrityQueue.js';
import { createIntegrityLifecycle } from './examIntegrityLifecycle.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidAttemptId(attemptId) {
  return typeof attemptId === 'string' && UUID_REGEX.test(attemptId.trim());
}

export function createExamIntegritySession(options = {}) {
  const {
    attemptId,
    getAccessToken,
    onResult,
    onError,
    targetDocument = globalThis.document,
    targetWindow = globalThis.window,
    queueFactory = (opts) => new ExamIntegrityQueue(opts),
    lifecycleFactory = (opts) => createIntegrityLifecycle(opts),
  } = options;

  let isStarted = false;
  let isStopped = false;
  let isManualStopped = false;

  let currentGeneration = 1;
  const capturedGeneration = currentGeneration;

  let latestTokenResolver = typeof getAccessToken === 'function' ? getAccessToken : null;
  let latestOnResult = typeof onResult === 'function' ? onResult : null;
  let latestOnError = typeof onError === 'function' ? onError : null;

  let queue = null;
  let lifecycle = null;

  const stableGetAccessToken = async () => {
    if (typeof latestTokenResolver === 'function') {
      return await latestTokenResolver();
    }
    return null;
  };

  const stableOnResult = (data, meta) => {
    if (isStopped || capturedGeneration !== currentGeneration) {
      return; // Generation guard: block late callbacks
    }
    if (typeof latestOnResult === 'function') {
      try {
        latestOnResult(data, meta);
      } catch (_) {
        // Guard against UI callback errors
      }
    }
  };

  const stableOnError = (err, meta) => {
    if (isStopped || capturedGeneration !== currentGeneration) {
      return; // Generation guard: block late callbacks
    }
    if (typeof latestOnError === 'function') {
      try {
        latestOnError(err, meta);
      } catch (_) {
        // Guard against UI callback errors
      }
    }
  };

  const start = () => {
    if (isStopped || isStarted) {
      return false;
    }

    if (!isValidAttemptId(attemptId)) {
      return false; // Fail closed for invalid attempt ID
    }

    isStarted = true;

    // Construct Queue once with stable delegates
    queue = queueFactory({
      attemptId: attemptId.trim().toLowerCase(),
      getAccessToken: stableGetAccessToken,
      onResult: stableOnResult,
      onError: stableOnError,
    });

    // Construct and attach lifecycle
    lifecycle = lifecycleFactory({
      queue,
      targetDocument,
      targetWindow,
    });

    lifecycle.attach();
    queue.start();

    return true;
  };

  const stop = ({ manual = false } = {}) => {
    if (isStopped) {
      return; // Idempotent
    }

    isStopped = true;
    currentGeneration++;

    if (manual) {
      isManualStopped = true;
    }

    if (lifecycle) {
      lifecycle.detach();
    }

    if (queue) {
      queue.stop();
    }
  };

  const teardown = () => {
    stop({ manual: false });
  };

  const isActive = () => {
    return isStarted && !isStopped && Boolean(lifecycle && lifecycle.isAttached());
  };

  const isManualStoppedState = () => isManualStopped;

  const updateCallbacks = (callbacks = {}) => {
    if (typeof callbacks.onResult === 'function' || callbacks.onResult === null) {
      latestOnResult = callbacks.onResult;
    }
    if (typeof callbacks.onError === 'function' || callbacks.onError === null) {
      latestOnError = callbacks.onError;
    }
  };

  const updateTokenResolver = (newResolver) => {
    if (typeof newResolver === 'function' || newResolver === null) {
      latestTokenResolver = newResolver;
    }
  };

  const getAttemptId = () => attemptId;
  const getGeneration = () => currentGeneration;

  const getStatus = () => ({
    attemptId,
    isValid: isValidAttemptId(attemptId),
    isStarted,
    isStopped,
    isManualStopped,
    isActive: isActive(),
    generation: currentGeneration,
  });

  return {
    start,
    stop,
    teardown,
    isActive,
    isManualStopped: isManualStoppedState,
    updateCallbacks,
    updateTokenResolver,
    getAttemptId,
    getGeneration,
    getStatus,
  };
}
