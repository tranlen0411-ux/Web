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

    let result;
    try {
      result = await this.#sendIntegrityEvent({
        attemptId: currentItem.attemptId,
        source: currentItem.source,
        clientTimestamp: currentItem.clientTimestamp,
        getAccessToken: this.#getAccessToken,
        fetchImpl: this.#fetchImpl,
        endpoint: this.#endpoint,
      });
    } catch (unexpectedError) {
      // Fallback in case custom sendIntegrityEvent throws unexpectedly
      result = {
        ok: false,
        type: QueueItemState.FAILED_AMBIGUOUS,
        error: {
          code: 'UNEXPECTED_DISPATCH_ERROR',
          message: unexpectedError?.message || 'Lỗi xử lý ngoài dự kiến.',
        },
      };
    }

    const terminalState = result?.type || (result?.ok ? QueueItemState.SUCCEEDED : QueueItemState.FAILED_AMBIGUOUS);
    currentItem.state = terminalState;

    this.#recordDiagnostic({
      seq: currentItem.seq,
      source: currentItem.source,
      capturedAt: currentItem.clientTimestamp,
      terminalState,
      safeHttpStatus: result?.safeHttpStatus,
      safeErrorCode: result?.safeErrorCode || result?.error?.code,
    });

    // If queue was stopped during in-flight network dispatch:
    // Settle quietly; DO NOT invoke UI callbacks; DO NOT restart worker.
    if (this.#isStopped) {
      this.#isSending = false;
      return;
    }

    // Invoke user callbacks
    if (result?.ok) {
      if (this.#onResult) {
        try {
          this.#onResult(result.data, {
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
          this.#onError(result, {
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
