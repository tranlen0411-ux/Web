// src/services/examIntegrityQueue.js
// Exam Builder V1 - Phase 3C Frontend Integrity Event Queue
// Implements In-Memory Serialized FIFO Queue, Max 1 In-Flight, State-Based Terminal Handling,
// Attempt Isolation, and Sanitized Bounded Diagnostics.

import { sendIntegrityEvent as defaultSendIntegrityEvent } from './examIntegrityClient.js';

export const QueueItemState = Object.freeze({
  QUEUED: 'queued',
  SENDING: 'sending',
  SUCCEEDED: 'succeeded',
  FAILED_PRE_DISPATCH: 'failed_pre_dispatch',
  FAILED_AMBIGUOUS: 'failed_ambiguous',
  FAILED_HTTP: 'failed_http',
  DROPPED_STALE: 'dropped_stale',
});

const DEFAULT_MAX_DIAGNOSTICS = 50;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_POLICIES = new Set(['WARN_AND_LOG', 'WARN_ONLY', 'OFF']);
const ALLOWED_EVENT_TYPES = new Set(['episode_opened', 'episode_closed', 'focus_loss_auxiliary']);
const HTTP_FALLBACK_REGEX = /^HTTP_[1-5][0-9]{2}$/;

// Module-private unexported const Set containing exactly 24 approved reachable/local error codes.
const APPROVED_SAFE_ERROR_CODES = new Set([
  'INVALID_ATTEMPT_ID',
  'INVALID_EVENT_SOURCE',
  'INVALID_TIMESTAMP',
  'MISSING_TOKEN_RESOLVER',
  'TOKEN_RESOLUTION_ERROR',
  'AUTH_REQUIRED',
  'FETCH_UNAVAILABLE',
  'NETWORK_ERROR',
  'UNEXPECTED_DISPATCH_ERROR',
  'INVALID_JSON_RESPONSE',
  'INVALID_RESPONSE_PAYLOAD',
  'INVALID_TOKEN',
  'FORBIDDEN_ROLE',
  'ACCOUNT_DISABLED',
  'METHOD_NOT_ALLOWED',
  'UNSUPPORTED_MEDIA_TYPE',
  'INVALID_INPUT',
  'INVALID_REQUEST_FIELD',
  'ERR_INVALID_EVENT_SOURCE',
  'ATTEMPT_NOT_FOUND',
  'ERR_ATTEMPT_ALREADY_FINALIZED',
  'ERR_ATTEMPT_EXPIRED',
  'ERR_INVALID_TAB_SWITCH_POLICY',
  'INTERNAL_ERROR',
]);

/**
 * Strictly revalidates success data payload against the 7-field contract.
 */
function validateSuccessData(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  if (typeof payload.attempt_id !== 'string' || !UUID_REGEX.test(payload.attempt_id.trim())) {
    return null;
  }
  if (typeof payload.tab_switch_policy !== 'string' || !ALLOWED_POLICIES.has(payload.tab_switch_policy)) {
    return null;
  }
  if (
    typeof payload.tab_switch_count !== 'number' ||
    !Number.isInteger(payload.tab_switch_count) ||
    payload.tab_switch_count < 0 ||
    !Number.isFinite(payload.tab_switch_count)
  ) {
    return null;
  }
  if (
    payload.active_leave_episode_id !== null &&
    typeof payload.active_leave_episode_id !== 'string'
  ) {
    return null;
  }
  if (typeof payload.event_recorded !== 'boolean') {
    return null;
  }
  if (
    payload.event_type !== null &&
    (typeof payload.event_type !== 'string' || !ALLOWED_EVENT_TYPES.has(payload.event_type))
  ) {
    return null;
  }
  if (typeof payload.idempotent_replay !== 'boolean') {
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
 * Sanitizes dispatcher error response into minimal flat error shape.
 * Never leaks raw messages, stacks, headers, or tokens.
 */
function sanitizeQueueError(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      type: QueueItemState.FAILED_AMBIGUOUS,
      safeErrorCode: 'UNEXPECTED_DISPATCH_ERROR',
    };
  }

  if (raw.type === QueueItemState.FAILED_HTTP) {
    let status = raw.safeHttpStatus;
    if (typeof status !== 'number' || !Number.isInteger(status) || status < 100 || status > 599) {
      status = 500;
    }

    let codeCandidate = '';
    if (typeof raw.safeErrorCode === 'string' && raw.safeErrorCode.trim()) {
      codeCandidate = raw.safeErrorCode.trim();
    } else if (typeof raw.error?.code === 'string' && raw.error.code.trim()) {
      codeCandidate = raw.error.code.trim();
    }

    let safeErrorCode = '';
    if (APPROVED_SAFE_ERROR_CODES.has(codeCandidate)) {
      safeErrorCode = codeCandidate;
    } else if (HTTP_FALLBACK_REGEX.test(codeCandidate) && parseInt(codeCandidate.slice(5), 10) === status) {
      safeErrorCode = codeCandidate;
    } else {
      safeErrorCode = `HTTP_${status}`;
    }

    return {
      ok: false,
      type: QueueItemState.FAILED_HTTP,
      safeHttpStatus: status,
      safeErrorCode,
    };
  }

  if (raw.type === QueueItemState.FAILED_PRE_DISPATCH || raw.type === QueueItemState.FAILED_AMBIGUOUS) {
    let codeCandidate = '';
    if (typeof raw.safeErrorCode === 'string' && raw.safeErrorCode.trim()) {
      codeCandidate = raw.safeErrorCode.trim();
    } else if (typeof raw.error?.code === 'string' && raw.error.code.trim()) {
      codeCandidate = raw.error.code.trim();
    }

    const safeErrorCode = APPROVED_SAFE_ERROR_CODES.has(codeCandidate)
      ? codeCandidate
      : 'UNEXPECTED_DISPATCH_ERROR';

    return {
      ok: false,
      type: raw.type,
      safeErrorCode,
    };
  }

  return {
    ok: false,
    type: QueueItemState.FAILED_AMBIGUOUS,
    safeErrorCode: 'UNEXPECTED_DISPATCH_ERROR',
  };
}

export class ExamIntegrityQueue {
  #attemptId;
  #sendIntegrityEvent;
  #getAccessToken;
  #onResult;
  #onError;
  #maxDiagnostics;
  #fetchImpl;
  #endpoint;

  #nextSeq = 1;
  #queue = [];
  #isSending = false;
  #isStopped = false;
  #diagnosticHistory = [];

  /**
   * @param {Object} options
   * @param {string} options.attemptId - Required UUID of the exam attempt
   * @param {Function} [options.getAccessToken] - Function returning current CORE JWT
   * @param {Function} [options.sendIntegrityEvent] - Transport dispatcher override (defaults to examIntegrityClient)
   * @param {Function} [options.onResult] - Callback on successful 200 response
   * @param {Function} [options.onError] - Callback on error (pre-dispatch, ambiguous, or http)
   * @param {number} [options.maxDiagnosticHistory=50] - Maximum diagnostic ring buffer size
   * @param {Function} [options.fetchImpl] - Optional custom fetch implementation
   * @param {string} [options.endpoint] - Optional custom endpoint URL
   */
  constructor(options = {}) {
    const {
      attemptId,
      getAccessToken,
      sendIntegrityEvent = defaultSendIntegrityEvent,
      onResult,
      onError,
      maxDiagnosticHistory = DEFAULT_MAX_DIAGNOSTICS,
      fetchImpl,
      endpoint,
    } = options;

    if (!attemptId || typeof attemptId !== 'string') {
      throw new Error('ExamIntegrityQueue requires a valid attemptId string.');
    }

    let normalizedMaxDiags = DEFAULT_MAX_DIAGNOSTICS;
    const rawNum = Number(maxDiagnosticHistory);
    if (Number.isFinite(rawNum)) {
      normalizedMaxDiags = Math.min(50, Math.max(1, Math.floor(rawNum)));
    }

    this.#attemptId = attemptId;
    this.#getAccessToken = typeof getAccessToken === 'function' ? getAccessToken : async () => null;
    this.#sendIntegrityEvent = sendIntegrityEvent;
    this.#onResult = typeof onResult === 'function' ? onResult : null;
    this.#onError = typeof onError === 'function' ? onError : null;
    this.#maxDiagnostics = normalizedMaxDiags;
    this.#fetchImpl = fetchImpl;
    this.#endpoint = endpoint;
  }

  /**
   * Starts or confirms active queue state.
   */
  start() {
    if (this.#isStopped) {
      return false;
    }
    this.#processQueue();
    return true;
  }

  /**
   * Enqueues an integrity event for serialized FIFO dispatch.
   *
   * @param {string} source - 'page_hidden' | 'page_visible' | 'window_blur' | 'window_focus'
   * @returns {boolean} True if successfully queued; false if queue is stopped.
   */
  enqueue(source) {
    if (this.#isStopped) {
      return false;
    }

    const clientTimestamp = new Date().toISOString();
    const item = {
      seq: this.#nextSeq++,
      attemptId: this.#attemptId,
      source,
      clientTimestamp,
      state: QueueItemState.QUEUED,
    };

    this.#queue.push(item);
    this.#processQueue();
    return true;
  }

  /**
   * Stops the queue, dropping all pending unsent items.
   * In-flight requests settle naturally without triggering UI callbacks.
   */
  stop() {
    if (this.#isStopped) {
      return; // Idempotent
    }
    this.#isStopped = true;

    // Drop all queued, unsent events
    while (this.#queue.length > 0) {
      const pending = this.#queue.shift();
      pending.state = QueueItemState.DROPPED_STALE;
      this.#recordDiagnostic({
        seq: pending.seq,
        source: pending.source,
        capturedAt: pending.clientTimestamp,
        terminalState: QueueItemState.DROPPED_STALE,
      });
    }
  }

  /**
   * Returns a sanitized copy of diagnostic entries, ordered by sequence.
   * Contains strictly no secret/token/session material.
   */
  getDiagnostics() {
    return this.#diagnosticHistory
      .map((entry) => ({ ...entry }))
      .sort((a, b) => a.seq - b.seq);
  }

  /**
   * Returns current internal queue snapshot (for diagnostics/testing).
   */
  getStatus() {
    return {
      attemptId: this.#attemptId,
      isStopped: this.#isStopped,
      inFlight: this.#isSending,
      queuedCount: this.#queue.length,
      diagnosticCount: this.#diagnosticHistory.length,
    };
  }

  #recordDiagnostic(entry) {
    const sanitized = {
      seq: entry.seq,
      source: entry.source,
      capturedAt: entry.capturedAt,
      terminalState: entry.terminalState,
    };

    if (typeof entry.safeHttpStatus === 'number') {
      sanitized.safeHttpStatus = entry.safeHttpStatus;
    }
    if (typeof entry.safeErrorCode === 'string') {
      sanitized.safeErrorCode = entry.safeErrorCode;
    }

    this.#diagnosticHistory.push(sanitized);
    if (this.#diagnosticHistory.length > this.#maxDiagnostics) {
      this.#diagnosticHistory.shift();
    }
  }

  async #processQueue() {
    if (this.#isStopped || this.#isSending || this.#queue.length === 0) {
      return;
    }

    this.#isSending = true;
    const currentItem = this.#queue.shift();
    currentItem.state = QueueItemState.SENDING;

    let rawResult;
    try {
      rawResult = await this.#sendIntegrityEvent({
        attemptId: currentItem.attemptId,
        source: currentItem.source,
        clientTimestamp: currentItem.clientTimestamp,
        getAccessToken: this.#getAccessToken,
        fetchImpl: this.#fetchImpl,
        endpoint: this.#endpoint,
      });
    } catch (_) {
      // Fallback in case custom sendIntegrityEvent throws unexpectedly
      rawResult = {
        ok: false,
        type: QueueItemState.FAILED_AMBIGUOUS,
        safeErrorCode: 'UNEXPECTED_DISPATCH_ERROR',
      };
    }

    let finalResult;
    if (rawResult && rawResult.ok === true && rawResult.type === QueueItemState.SUCCEEDED) {
      // Queue independently revalidates success data payload (Fail-Closed)
      const validatedData = validateSuccessData(rawResult.data);
      if (validatedData) {
        finalResult = {
          ok: true,
          type: QueueItemState.SUCCEEDED,
          safeHttpStatus: 200,
          data: validatedData,
        };
      } else {
        finalResult = {
          ok: false,
          type: QueueItemState.FAILED_HTTP,
          safeHttpStatus: 200,
          safeErrorCode: 'INVALID_RESPONSE_PAYLOAD',
        };
      }
    } else {
      finalResult = sanitizeQueueError(rawResult);
    }

    const terminalState = finalResult.type;
    currentItem.state = terminalState;

    this.#recordDiagnostic({
      seq: currentItem.seq,
      source: currentItem.source,
      capturedAt: currentItem.clientTimestamp,
      terminalState,
      safeHttpStatus: finalResult.safeHttpStatus,
      safeErrorCode: finalResult.safeErrorCode,
    });

    // If queue was stopped during in-flight network dispatch:
    // Settle quietly; DO NOT invoke UI callbacks; DO NOT restart worker.
    if (this.#isStopped) {
      this.#isSending = false;
      return;
    }

    // Invoke user callbacks
    if (finalResult.ok) {
      if (this.#onResult) {
        try {
          this.#onResult(finalResult.data, {
            seq: currentItem.seq,
            source: currentItem.source,
          });
        } catch (_) {
          // Guard against UI callback errors
        }
      }
    } else {
      if (this.#onError) {
        try {
          this.#onError(finalResult, {
            seq: currentItem.seq,
            source: currentItem.source,
          });
        } catch (_) {
          // Guard against UI callback errors
        }
      }
    }

    this.#isSending = false;

    // Continue FIFO worker loop for next item
    this.#processQueue();
  }
}

