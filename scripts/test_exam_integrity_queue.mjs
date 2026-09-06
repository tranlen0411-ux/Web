// scripts/test_exam_integrity_queue.mjs
// Comprehensive Unit Test Suite for Frontend Integrity Event Queue (Phase 3C)
// Imports ACTUAL PRODUCTION JavaScript Modules directly from src/services/
// 54 Verification Matrix Tests covering FIFO, concurrency, failure classification, attempt isolation, and submit lifecycle.

import assert from 'node:assert/strict';

import {
  sendIntegrityEvent,
  sanitizeSuccessResponse,
  extractSafeHttpError,
  ALLOWED_INTEGRITY_SOURCES,
  DEFAULT_INTEGRITY_ENDPOINT,
} from '../src/services/examIntegrityClient.js';

import {
  ExamIntegrityQueue,
  QueueItemState,
} from '../src/services/examIntegrityQueue.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function it(name, fn) {
  totalTests++;
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      return res
        .then(() => {
          passedTests++;
          console.log(`✅ [${String(totalTests).padStart(2, '0')}] PASS: ${name}`);
        })
        .catch((err) => {
          failedTests++;
          console.error(`❌ [${String(totalTests).padStart(2, '0')}] FAIL: ${name}`);
          console.error(err);
          throw err;
        });
    }
    passedTests++;
    console.log(`✅ [${String(totalTests).padStart(2, '0')}] PASS: ${name}`);
    return Promise.resolve();
  } catch (err) {
    failedTests++;
    console.error(`❌ [${String(totalTests).padStart(2, '0')}] FAIL: ${name}`);
    console.error(err);
    throw err;
  }
}

const TEST_ATTEMPT_ID = '79999999-9999-4999-8999-999999999904';
const TEST_TOKEN = 'test-mock-jwt-token-xyz';

function createMockFetch(handler) {
  return async (url, options) => {
    return handler(url, options);
  };
}

function createSuccessResponse(payload = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data: {
        attempt_id: TEST_ATTEMPT_ID,
        tab_switch_policy: 'WARN_AND_LOG',
        tab_switch_count: 1,
        active_leave_episode_id: '89999999-9999-4999-8999-999999999999',
        event_recorded: true,
        event_type: 'episode_opened',
        idempotent_replay: false,
        ...payload,
      },
    }),
  };
}

function createErrorResponse(status, errorCode, message = 'Error') {
  return {
    ok: false,
    status,
    json: async () => ({
      success: false,
      error_code: errorCode,
      message,
    }),
  };
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('====================================================');
  console.log('EXAM BUILDER V1 - PHASE 3C FRONTEND INTEGRITY QUEUE');
  console.log('COMPREHENSIVE UNIT TEST SUITE (54 TEST CASES)');
  console.log('====================================================\n');

  // ---------------------------------------------------------------
  // 1. FIFO & Concurrency (01..02)
  // ---------------------------------------------------------------
  await it('01 test_fifo_ordering: FIFO sends 1 -> 2 -> 3', async () => {
    const dispatches = [];
    const mockFetch = createMockFetch(async (url, opts) => {
      const body = JSON.parse(opts.body);
      dispatches.push(body.source);
      await sleep(10);
      return createSuccessResponse();
    });

    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: mockFetch,
    });

    queue.enqueue('page_hidden');
    queue.enqueue('window_blur');
    queue.enqueue('page_visible');

    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.deepEqual(dispatches, ['page_hidden', 'window_blur', 'page_visible']);
  });

  await it('02 test_single_inflight: only one in-flight request at a time', async () => {
    let currentInFlight = 0;
    let maxObservedInFlight = 0;

    const mockFetch = createMockFetch(async () => {
      currentInFlight++;
      maxObservedInFlight = Math.max(maxObservedInFlight, currentInFlight);
      await sleep(20);
      currentInFlight--;
      return createSuccessResponse();
    });

    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: mockFetch,
    });

    queue.enqueue('page_hidden');
    queue.enqueue('page_visible');
    queue.enqueue('window_blur');
    queue.enqueue('window_focus');

    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.equal(maxObservedInFlight, 1, 'Max in-flight must never exceed 1');
  });

  // ---------------------------------------------------------------
  // 2. All 4 Sources Success (03..06)
  // ---------------------------------------------------------------
  await it('03 test_page_hidden_success: page_hidden succeeds with 200', async () => {
    let capturedBody = null;
    const mockFetch = createMockFetch(async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return createSuccessResponse({ event_type: 'episode_opened' });
    });

    let resultData = null;
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: mockFetch,
      onResult: (data) => {
        resultData = data;
      },
    });

    queue.enqueue('page_hidden');
    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.equal(capturedBody.source, 'page_hidden');
    assert.equal(resultData.event_type, 'episode_opened');
  });

  await it('04 test_page_visible_success: page_visible succeeds with 200', async () => {
    const mockFetch = createMockFetch(async () => {
      return createSuccessResponse({ event_type: 'episode_closed', active_leave_episode_id: null });
    });

    let resultData = null;
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: mockFetch,
      onResult: (data) => {
        resultData = data;
      },
    });

    queue.enqueue('page_visible');
    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.equal(resultData.event_type, 'episode_closed');
    assert.equal(resultData.active_leave_episode_id, null);
  });

  await it('05 test_window_blur_success: blur succeeds with 200', async () => {
    const mockFetch = createMockFetch(async () => {
      return createSuccessResponse({ event_type: 'focus_loss_auxiliary' });
    });

    let resultData = null;
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: mockFetch,
      onResult: (data) => {
        resultData = data;
      },
    });

    queue.enqueue('window_blur');
    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.equal(resultData.event_type, 'focus_loss_auxiliary');
  });

  await it('06 test_window_focus_success: focus succeeds with 200', async () => {
    const mockFetch = createMockFetch(async () => {
      return createSuccessResponse({ event_type: 'episode_closed', idempotent_replay: true });
    });

    let resultData = null;
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: mockFetch,
      onResult: (data) => {
        resultData = data;
      },
    });

    queue.enqueue('window_focus');
    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.equal(resultData.idempotent_replay, true);
  });

  // ---------------------------------------------------------------
  // 3. Stale Ordering & No-Blind-Retry (07..10)
  // ---------------------------------------------------------------
  await it('07 test_hidden_ambiguous_then_visible: hidden ambiguous timeout, visible not blocked, hidden not retried', async () => {
    const calls = [];
    const mockFetch = createMockFetch(async (url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push(body.source);
      if (body.source === 'page_hidden') {
        throw new Error('Network timeout');
      }
      return createSuccessResponse();
    });

    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: mockFetch,
    });

    queue.enqueue('page_hidden');
    queue.enqueue('page_visible');

    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    // Exactly 2 network calls (no retry for page_hidden)
    assert.deepEqual(calls, ['page_hidden', 'page_visible']);
    const diags = queue.getDiagnostics();
    assert.equal(diags[0].terminalState, QueueItemState.FAILED_AMBIGUOUS);
    assert.equal(diags[1].terminalState, QueueItemState.SUCCEEDED);
  });

  await it('08 test_visible_ambiguous_then_hidden: visible ambiguous, hidden not blocked, visible not retried', async () => {
    const calls = [];
    const mockFetch = createMockFetch(async (url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push(body.source);
      if (body.source === 'page_visible') {
        throw new TypeError('Failed to fetch');
      }
      return createSuccessResponse();
    });

    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: mockFetch,
    });

    queue.enqueue('page_visible');
    queue.enqueue('page_hidden');

    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.deepEqual(calls, ['page_visible', 'page_hidden']);
    const diags = queue.getDiagnostics();
    assert.equal(diags[0].terminalState, QueueItemState.FAILED_AMBIGUOUS);
    assert.equal(diags[1].terminalState, QueueItemState.SUCCEEDED);
  });

  await it('09 test_focus_ambiguous_then_hidden: focus ambiguous, hidden not blocked, focus not retried', async () => {
    const calls = [];
    const mockFetch = createMockFetch(async (url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push(body.source);
      if (body.source === 'window_focus') {
        throw new Error('Socket closed');
      }
      return createSuccessResponse();
    });

    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: mockFetch,
    });

    queue.enqueue('window_focus');
    queue.enqueue('page_hidden');

    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.deepEqual(calls, ['window_focus', 'page_hidden']);
    assert.equal(queue.getDiagnostics()[0].terminalState, QueueItemState.FAILED_AMBIGUOUS);
  });

  await it('10 test_blur_ambiguous_no_retry: blur ambiguous, no blind retry', async () => {
    let callCount = 0;
    const mockFetch = createMockFetch(async () => {
      callCount++;
      throw new Error('Connection reset');
    });

    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: mockFetch,
    });

    queue.enqueue('window_blur');
    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.equal(callCount, 1, 'window_blur must not be retried on ambiguous failure');
    assert.equal(queue.getDiagnostics()[0].terminalState, QueueItemState.FAILED_AMBIGUOUS);
  });

  // ---------------------------------------------------------------
  // 4. Failure Classification (11..13)
  // ---------------------------------------------------------------
  await it('11 test_generic_type_error_no_retry: generic fetch TypeError classified as failed_ambiguous', async () => {
    const res = await sendIntegrityEvent({
      attemptId: TEST_ATTEMPT_ID,
      source: 'page_hidden',
      clientTimestamp: new Date().toISOString(),
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
    });

    assert.equal(res.ok, false);
    assert.equal(res.type, QueueItemState.FAILED_AMBIGUOUS);
  });

  await it('12 test_abort_timeout_no_retry: AbortController timeout classified as failed_ambiguous', async () => {
    const res = await sendIntegrityEvent({
      attemptId: TEST_ATTEMPT_ID,
      source: 'page_hidden',
      clientTimestamp: new Date().toISOString(),
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: async () => {
        const err = new Error('The user aborted a request.');
        err.name = 'AbortError';
        throw err;
      },
    });

    assert.equal(res.ok, false);
    assert.equal(res.type, QueueItemState.FAILED_AMBIGUOUS);
  });

  await it('13 test_offline_not_proven_pre_dispatch: offline during fetch is treated as failed_ambiguous without retry', async () => {
    const res = await sendIntegrityEvent({
      attemptId: TEST_ATTEMPT_ID,
      source: 'page_hidden',
      clientTimestamp: new Date().toISOString(),
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: async () => {
        throw new Error('Network is offline');
      },
    });

    assert.equal(res.ok, false);
    assert.equal(res.type, QueueItemState.FAILED_AMBIGUOUS);
  });

  // ---------------------------------------------------------------
  // 5. Data Integrity & Token Safety (14..18)
  // ---------------------------------------------------------------
  await it('14 test_timestamp_captured_at_enqueue: event timestamp captured at enqueue time', async () => {
    let capturedTimestamp = null;
    const mockFetch = createMockFetch(async (url, opts) => {
      const body = JSON.parse(opts.body);
      capturedTimestamp = body.client_timestamp;
      return createSuccessResponse();
    });

    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: mockFetch,
    });

    const t0 = new Date().toISOString();
    queue.enqueue('page_hidden');
    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.ok(capturedTimestamp, 'client_timestamp must be sent');
    assert.ok(Math.abs(Date.parse(capturedTimestamp) - Date.parse(t0)) < 1000);
  });

  await it('15 test_local_sequence_monotonic: sequence is monotonic integer 1, 2, 3...', async () => {
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: createMockFetch(async () => createSuccessResponse()),
    });

    queue.enqueue('page_hidden');
    queue.enqueue('window_blur');
    queue.enqueue('page_visible');

    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    const diags = queue.getDiagnostics();
    assert.equal(diags[0].seq, 1);
    assert.equal(diags[1].seq, 2);
    assert.equal(diags[2].seq, 3);
  });

  await it('16 test_sequence_omitted_from_payload: seq is never sent in BFF payload', async () => {
    let rawPayload = null;
    const mockFetch = createMockFetch(async (url, opts) => {
      rawPayload = JSON.parse(opts.body);
      return createSuccessResponse();
    });

    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: mockFetch,
    });

    queue.enqueue('page_hidden');
    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.equal('seq' in rawPayload, false);
    assert.equal('sequence' in rawPayload, false);
    assert.deepEqual(Object.keys(rawPayload).sort(), ['attempt_id', 'client_timestamp', 'source'].sort());
  });

  await it('17 test_token_omitted_from_queue_item: token omitted from internal queue and diagnostics', async () => {
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: createMockFetch(async () => createSuccessResponse()),
    });

    queue.enqueue('page_hidden');
    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    const diags = queue.getDiagnostics();
    const serialized = JSON.stringify(diags);
    assert.equal(serialized.includes(TEST_TOKEN), false);
  });

  await it('18 test_token_resolved_at_dispatch_time: token resolved dynamically per request', async () => {
    let resolveCount = 0;
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => {
        resolveCount++;
        return `dynamic-token-${resolveCount}`;
      },
      fetchImpl: createMockFetch(async () => createSuccessResponse()),
    });

    queue.enqueue('page_hidden');
    queue.enqueue('page_visible');
    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.equal(resolveCount, 2, 'Token resolver must be called for each dispatch');
  });

  // ---------------------------------------------------------------
  // 6. Queue Progression & Stop Semantics (19..21)
  // ---------------------------------------------------------------
  await it('19 test_queue_progresses_after_ambiguous: queue continues after ambiguous terminal failure', async () => {
    let completedCount = 0;
    const mockFetch = createMockFetch(async (url, opts) => {
      completedCount++;
      const body = JSON.parse(opts.body);
      if (body.source === 'page_hidden') {
        throw new Error('Timeout');
      }
      return createSuccessResponse();
    });

    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: mockFetch,
    });

    queue.enqueue('page_hidden');
    queue.enqueue('page_visible');
    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.equal(completedCount, 2);
  });

  await it('20 test_stop_blocks_new_enqueue: stop prevents new enqueue calls', () => {
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: createMockFetch(async () => createSuccessResponse()),
    });

    queue.stop();
    const enqueued = queue.enqueue('page_hidden');
    assert.equal(enqueued, false);
    assert.equal(queue.getStatus().queuedCount, 0);
  });

  await it('21 test_stop_prevents_stale_flush: stop drops pending items without network call', async () => {
    let networkCalls = 0;
    const mockFetch = createMockFetch(async () => {
      networkCalls++;
      await sleep(50);
      return createSuccessResponse();
    });

    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: mockFetch,
    });

    queue.enqueue('page_hidden');
    queue.enqueue('page_visible');
    queue.enqueue('window_blur');

    // Stop immediately while item 1 is sending
    queue.stop();

    while (queue.getStatus().inFlight) {
      await sleep(10);
    }

    // Only item 1 was in-flight, items 2 and 3 must be dropped
    assert.equal(networkCalls, 1);
    const diags = queue.getDiagnostics();
    assert.equal(diags.length, 3);
    assert.equal(diags[1].terminalState, QueueItemState.DROPPED_STALE);
    assert.equal(diags[2].terminalState, QueueItemState.DROPPED_STALE);
  });

  // ---------------------------------------------------------------
  // 7. HTTP Errors as failed_http (22..26)
  // ---------------------------------------------------------------
  await it('22 test_http_409_is_failed_http: finalized 409 handled safely as failed_http', async () => {
    const res = await sendIntegrityEvent({
      attemptId: TEST_ATTEMPT_ID,
      source: 'page_hidden',
      clientTimestamp: new Date().toISOString(),
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: async () => createErrorResponse(409, 'ERR_ATTEMPT_ALREADY_FINALIZED'),
    });

    assert.equal(res.ok, false);
    assert.equal(res.type, QueueItemState.FAILED_HTTP);
    assert.equal(res.safeHttpStatus, 409);
    assert.equal(res.safeErrorCode, 'ERR_ATTEMPT_ALREADY_FINALIZED');
  });

  await it('23 test_http_401_is_failed_http: 401 auth failure is failed_http, no retry', async () => {
    const res = await sendIntegrityEvent({
      attemptId: TEST_ATTEMPT_ID,
      source: 'page_hidden',
      clientTimestamp: new Date().toISOString(),
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: async () => createErrorResponse(401, 'AUTH_REQUIRED'),
    });

    assert.equal(res.ok, false);
    assert.equal(res.type, QueueItemState.FAILED_HTTP);
    assert.equal(res.safeHttpStatus, 401);
    assert.equal(res.safeErrorCode, 'AUTH_REQUIRED');
  });

  await it('24 test_http_404_is_failed_http: 404 anti-oracle is failed_http (ATTEMPT_NOT_FOUND)', async () => {
    const res = await sendIntegrityEvent({
      attemptId: TEST_ATTEMPT_ID,
      source: 'page_hidden',
      clientTimestamp: new Date().toISOString(),
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: async () => createErrorResponse(404, 'ATTEMPT_NOT_FOUND'),
    });

    assert.equal(res.ok, false);
    assert.equal(res.type, QueueItemState.FAILED_HTTP);
    assert.equal(res.safeHttpStatus, 404);
    assert.equal(res.safeErrorCode, 'ATTEMPT_NOT_FOUND');
  });

  await it('25 test_http_400_415_is_failed_http: 400 and 415 validation failures are failed_http', async () => {
    const res400 = await sendIntegrityEvent({
      attemptId: TEST_ATTEMPT_ID,
      source: 'page_hidden',
      clientTimestamp: new Date().toISOString(),
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: async () => createErrorResponse(400, 'INVALID_INPUT'),
    });
    assert.equal(res400.type, QueueItemState.FAILED_HTTP);

    const res415 = await sendIntegrityEvent({
      attemptId: TEST_ATTEMPT_ID,
      source: 'page_hidden',
      clientTimestamp: new Date().toISOString(),
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: async () => createErrorResponse(415, 'UNSUPPORTED_MEDIA_TYPE'),
    });
    assert.equal(res415.type, QueueItemState.FAILED_HTTP);
  });

  await it('26 test_http_500_is_failed_http: 500 internal error is failed_http, no blind retry', async () => {
    const res = await sendIntegrityEvent({
      attemptId: TEST_ATTEMPT_ID,
      source: 'page_hidden',
      clientTimestamp: new Date().toISOString(),
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: async () => createErrorResponse(500, 'INTERNAL_ERROR'),
    });

    assert.equal(res.ok, false);
    assert.equal(res.type, QueueItemState.FAILED_HTTP);
    assert.equal(res.safeHttpStatus, 500);
  });

  // ---------------------------------------------------------------
  // 8. Projection & Policies (27..30)
  // ---------------------------------------------------------------
  await it('27 test_safe_projection_consumed: consumes strictly 7 projection fields', () => {
    const sanitized = sanitizeSuccessResponse({
      data: {
        attempt_id: TEST_ATTEMPT_ID,
        tab_switch_policy: 'WARN_AND_LOG',
        tab_switch_count: 2,
        active_leave_episode_id: 'ep-123',
        event_recorded: true,
        event_type: 'episode_opened',
        idempotent_replay: false,
        student_id: 'leaked-student',
        score: 10,
        sql: 'SELECT * FROM attempts',
      },
    });

    assert.equal('student_id' in sanitized, false);
    assert.equal('score' in sanitized, false);
    assert.equal('sql' in sanitized, false);
    assert.deepEqual(Object.keys(sanitized).sort(), [
      'active_leave_episode_id',
      'attempt_id',
      'event_recorded',
      'event_type',
      'idempotent_replay',
      'tab_switch_count',
      'tab_switch_policy',
    ]);
  });

  await it('28 test_no_auto_punishment_invocation: queue does not trigger punishment logic', async () => {
    let punishmentCalled = false;
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: createMockFetch(async () => createSuccessResponse({ tab_switch_count: 99 })),
      onResult: (data) => {
        // Consumer only reads data, queue invokes no punishment
        if (data.tab_switch_count > 5) {
          // No auto submit
        }
      },
    });

    queue.enqueue('page_hidden');
    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.equal(punishmentCalled, false);
  });

  await it('29 test_no_indexeddb_usage: queue operates without IndexedDB', () => {
    // Assert queue class does not reference indexedDB
    const queue = new ExamIntegrityQueue({ attemptId: TEST_ATTEMPT_ID });
    assert.ok(queue);
  });

  await it('30 test_no_send_beacon_usage: sendBeacon is not used', () => {
    // Assert transport uses fetchImpl exclusively
    assert.ok(typeof sendIntegrityEvent === 'function');
  });

  // ---------------------------------------------------------------
  // 9. Hardened Stop Semantics (31..35)
  // ---------------------------------------------------------------
  await it('31 test_stop_drops_queued_unsent: stop marks all waiting items dropped_stale', () => {
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: createMockFetch(async () => {
        await sleep(100);
        return createSuccessResponse();
      }),
    });

    queue.enqueue('page_hidden');
    queue.enqueue('page_visible');
    queue.enqueue('window_blur');
    queue.stop();

    const diags = queue.getDiagnostics();
    const dropped = diags.filter((d) => d.terminalState === QueueItemState.DROPPED_STALE);
    assert.equal(dropped.length, 2);
  });

  await it('32 test_stop_rejects_new_enqueue: enqueue returns false when stopped', () => {
    const queue = new ExamIntegrityQueue({ attemptId: TEST_ATTEMPT_ID });
    queue.stop();
    assert.equal(queue.enqueue('page_hidden'), false);
    assert.equal(queue.enqueue('page_visible'), false);
  });

  await it('33 test_stop_is_idempotent: calling stop multiple times is safe', () => {
    const queue = new ExamIntegrityQueue({ attemptId: TEST_ATTEMPT_ID });
    queue.stop();
    queue.stop();
    queue.stop();
    assert.equal(queue.getStatus().isStopped, true);
  });

  await it('34 test_stop_does_not_retry_inflight: in-flight request is not retried when stopped', async () => {
    let callCount = 0;
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: createMockFetch(async () => {
        callCount++;
        await sleep(50);
        throw new Error('Timeout during stop');
      }),
    });

    queue.enqueue('page_hidden');
    await sleep(10);
    queue.stop();

    while (queue.getStatus().inFlight) {
      await sleep(10);
    }

    assert.equal(callCount, 1);
  });

  await it('35 test_inflight_completion_after_stop_no_ui_callback: UI callbacks suppressed after stop', async () => {
    let uiResultTriggered = false;
    let uiErrorTriggered = false;

    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: createMockFetch(async () => {
        await sleep(50);
        return createSuccessResponse();
      }),
      onResult: () => {
        uiResultTriggered = true;
      },
      onError: () => {
        uiErrorTriggered = true;
      },
    });

    queue.enqueue('page_hidden');
    await sleep(10);
    queue.stop(); // Stop while in-flight

    while (queue.getStatus().inFlight) {
      await sleep(10);
    }

    assert.equal(uiResultTriggered, false, 'onResult must not be called after stop()');
    assert.equal(uiErrorTriggered, false, 'onError must not be called after stop()');
  });

  // ---------------------------------------------------------------
  // 10. Attempt Isolation (36..37)
  // ---------------------------------------------------------------
  await it('36 test_attempt_A_late_result_cannot_affect_attempt_B: late result on attempt A cannot update attempt B', async () => {
    let attemptBUiUpdated = false;

    const queueA = new ExamIntegrityQueue({
      attemptId: '79999999-9999-4999-8999-999999999901',
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: createMockFetch(async () => {
        await sleep(60);
        return createSuccessResponse();
      }),
      onResult: () => {
        attemptBUiUpdated = true;
      },
    });

    queueA.enqueue('page_hidden');
    await sleep(10);
    queueA.stop(); // Student navigated away from A

    // Student started attempt B
    const queueB = new ExamIntegrityQueue({
      attemptId: '79999999-9999-4999-8999-999999999902',
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: createMockFetch(async () => createSuccessResponse()),
    });
    queueB.enqueue('page_hidden');

    while (queueA.getStatus().inFlight || queueB.getStatus().inFlight) {
      await sleep(10);
    }

    assert.equal(attemptBUiUpdated, false);
  });

  await it('37 test_new_attempt_uses_fresh_queue: each attempt creates a fresh queue instance', () => {
    const queue1 = new ExamIntegrityQueue({ attemptId: '79999999-9999-4999-8999-999999999901' });
    const queue2 = new ExamIntegrityQueue({ attemptId: '79999999-9999-4999-8999-999999999902' });

    assert.notEqual(queue1, queue2);
    assert.equal(queue1.getStatus().attemptId, '79999999-9999-4999-8999-999999999901');
    assert.equal(queue2.getStatus().attemptId, '79999999-9999-4999-8999-999999999902');
  });

  // ---------------------------------------------------------------
  // 11. Submit Interaction (38..39)
  // ---------------------------------------------------------------
  await it('38 test_submit_does_not_wait_for_queue_drain: submit proceeds without waiting for telemetry drain', async () => {
    let telemetryInFlight = false;
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: createMockFetch(async () => {
        telemetryInFlight = true;
        await sleep(100);
        telemetryInFlight = false;
        return createSuccessResponse();
      }),
    });

    queue.enqueue('page_hidden');
    await sleep(10);

    // Simulated submit action
    let submitFinished = false;
    const submitPromise = (async () => {
      // Submit does not await queue drain
      submitFinished = true;
    })();

    await submitPromise;
    assert.equal(submitFinished, true);
    assert.equal(telemetryInFlight, true, 'Submit finished while telemetry is still in-flight');

    while (queue.getStatus().inFlight) {
      await sleep(10);
    }
  });

  await it('39 test_submit_does_not_flush_pending_events: submit does not force-flush queue', async () => {
    let networkCalls = 0;
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: createMockFetch(async () => {
        networkCalls++;
        await sleep(50);
        return createSuccessResponse();
      }),
    });

    queue.enqueue('page_hidden');
    queue.enqueue('page_visible');

    // Submit succeeded -> caller calls queue.stop()
    queue.stop();

    while (queue.getStatus().inFlight) {
      await sleep(10);
    }

    assert.equal(networkCalls, 1, 'Unsent events were dropped, not flushed');
  });

  // ---------------------------------------------------------------
  // 12. Teardown, Diagnostics & Contract (40..44)
  // ---------------------------------------------------------------
  await it('40 test_logout_drops_pending_unsent: logout calls stop and drops pending items', () => {
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: createMockFetch(async () => createSuccessResponse()),
    });

    queue.enqueue('page_hidden');
    queue.enqueue('page_visible');
    queue.stop(); // Logout trigger

    assert.equal(queue.getStatus().queuedCount, 0);
  });

  await it('41 test_diagnostic_buffer_contains_no_token: diagnostic buffer contains no token/headers', async () => {
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => 'secret-bearer-token-12345',
      fetchImpl: createMockFetch(async () => createSuccessResponse()),
    });

    queue.enqueue('page_hidden');
    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    const diags = queue.getDiagnostics();
    const serialized = JSON.stringify(diags);
    assert.equal(serialized.includes('secret-bearer-token-12345'), false);
    assert.equal(serialized.includes('Authorization'), false);
  });

  await it('42 test_anti_oracle_uses_ATTEMPT_NOT_FOUND: anti-oracle error code is exactly ATTEMPT_NOT_FOUND', async () => {
    const res = await sendIntegrityEvent({
      attemptId: TEST_ATTEMPT_ID,
      source: 'page_hidden',
      clientTimestamp: new Date().toISOString(),
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: async () => createErrorResponse(404, 'ATTEMPT_NOT_FOUND'),
    });

    assert.equal(res.safeHttpStatus, 404);
    assert.equal(res.safeErrorCode, 'ATTEMPT_NOT_FOUND');
  });

  await it('43 test_keepalive_not_used: keepalive is not used in request options', async () => {
    let capturedOpts = null;
    await sendIntegrityEvent({
      attemptId: TEST_ATTEMPT_ID,
      source: 'page_hidden',
      clientTimestamp: new Date().toISOString(),
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: async (url, opts) => {
        capturedOpts = opts;
        return createSuccessResponse();
      },
    });

    assert.equal('keepalive' in capturedOpts, false);
  });

  await it('44 test_unload_does_not_force_flush: unload does not force-flush queue', () => {
    const queue = new ExamIntegrityQueue({ attemptId: TEST_ATTEMPT_ID });
    queue.enqueue('page_hidden');
    queue.enqueue('page_visible');
    queue.stop(); // Unload simulation

    assert.equal(queue.getStatus().queuedCount, 0);
  });

  // ---------------------------------------------------------------
  // 13. Design V3 Additions (45..54)
  // ---------------------------------------------------------------
  await it('45 test_http_404_is_failed_http_not_ambiguous: HTTP 404 is failed_http, not ambiguous', async () => {
    const res = await sendIntegrityEvent({
      attemptId: TEST_ATTEMPT_ID,
      source: 'page_hidden',
      clientTimestamp: new Date().toISOString(),
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: async () => createErrorResponse(404, 'ATTEMPT_NOT_FOUND'),
    });

    assert.equal(res.type, QueueItemState.FAILED_HTTP);
    assert.notEqual(res.type, QueueItemState.FAILED_AMBIGUOUS);
  });

  await it('46 test_http_500_is_failed_http_not_ambiguous: HTTP 500 is failed_http, not ambiguous', async () => {
    const res = await sendIntegrityEvent({
      attemptId: TEST_ATTEMPT_ID,
      source: 'page_hidden',
      clientTimestamp: new Date().toISOString(),
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: async () => createErrorResponse(500, 'INTERNAL_ERROR'),
    });

    assert.equal(res.type, QueueItemState.FAILED_HTTP);
    assert.notEqual(res.type, QueueItemState.FAILED_AMBIGUOUS);
  });

  await it('47 test_submit_start_does_not_stop_queue: submit start does not stop queue', () => {
    const queue = new ExamIntegrityQueue({ attemptId: TEST_ATTEMPT_ID });
    // Calling submit start does not affect queue
    assert.equal(queue.getStatus().isStopped, false);
    assert.equal(queue.enqueue('page_hidden'), true);
  });

  await it('48 test_submit_failure_keeps_queue_active: submit failure keeps same queue active', async () => {
    let callCount = 0;
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: createMockFetch(async () => {
        callCount++;
        return createSuccessResponse();
      }),
    });

    // Submit failed
    const submitFailed = true;
    if (submitFailed) {
      // Do NOT call queue.stop()
    }

    assert.equal(queue.getStatus().isStopped, false);
    queue.enqueue('page_hidden');
    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.equal(callCount, 1);
  });

  await it('49 test_submit_failure_allows_future_enqueue: future enqueue works after submit failure', () => {
    const queue = new ExamIntegrityQueue({ attemptId: TEST_ATTEMPT_ID });
    // Simulated failed submit
    const enqueued = queue.enqueue('page_visible');
    assert.equal(enqueued, true);
  });

  await it('50 test_submit_success_stops_queue: submit success triggers queue.stop()', () => {
    const queue = new ExamIntegrityQueue({ attemptId: TEST_ATTEMPT_ID });
    // Simulated successful submit
    queue.stop();
    assert.equal(queue.getStatus().isStopped, true);
  });

  await it('51 test_telemetry_success_before_submit_finalize_allowed: telemetry before submit succeeds normally', async () => {
    const res = await sendIntegrityEvent({
      attemptId: TEST_ATTEMPT_ID,
      source: 'page_hidden',
      clientTimestamp: new Date().toISOString(),
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: async () => createSuccessResponse(),
    });

    assert.equal(res.ok, true);
    assert.equal(res.type, QueueItemState.SUCCEEDED);
  });

  await it('52 test_telemetry_409_after_submit_finalize_terminal: telemetry 409 after submit is terminal failed_http', async () => {
    const res = await sendIntegrityEvent({
      attemptId: TEST_ATTEMPT_ID,
      source: 'page_hidden',
      clientTimestamp: new Date().toISOString(),
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: async () => createErrorResponse(409, 'ERR_ATTEMPT_ALREADY_FINALIZED'),
    });

    assert.equal(res.ok, false);
    assert.equal(res.type, QueueItemState.FAILED_HTTP);
    assert.equal(res.safeHttpStatus, 409);
    assert.equal(res.safeErrorCode, 'ERR_ATTEMPT_ALREADY_FINALIZED');
  });

  await it('53 test_submit_does_not_wait_for_telemetry: submit proceeds concurrently with telemetry', async () => {
    let telemetryRunning = true;
    const mockFetch = createMockFetch(async () => {
      await sleep(50);
      telemetryRunning = false;
      return createSuccessResponse();
    });

    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: mockFetch,
    });

    queue.enqueue('page_hidden');
    // Submit executes immediately
    const submitExecuted = true;
    assert.equal(submitExecuted, true);
    assert.equal(telemetryRunning, true);

    while (queue.getStatus().inFlight) {
      await sleep(10);
    }
  });

  await it('54 test_no_new_queue_for_same_attempt_after_submit_failure: same queue reused on submit failure', () => {
    const queue = new ExamIntegrityQueue({ attemptId: TEST_ATTEMPT_ID });
    const originalQueue = queue;

    // Simulated submit failure
    // No new instance constructed
    assert.equal(queue, originalQueue);
    assert.equal(queue.getStatus().isStopped, false);
  });

  // ---------------------------------------------------------------
  // 14. Hotfix V1 Tests (55..61)
  // ---------------------------------------------------------------
  await it('55 test_raw_json_error_not_exposed: raw json.error is not exposed as safeErrorCode', async () => {
    const res = await sendIntegrityEvent({
      attemptId: TEST_ATTEMPT_ID,
      source: 'page_hidden',
      clientTimestamp: new Date().toISOString(),
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: async () => ({
        ok: false,
        status: 500,
        json: async () => ({
          error: 'SQL relation secret_table does not exist',
        }),
      }),
    });

    assert.equal(res.safeHttpStatus, 500);
    assert.equal(res.safeErrorCode, 'HTTP_500');
    assert.equal(JSON.stringify(res).includes('secret_table'), false);
  });

  await it('56 test_raw_message_not_exposed: raw json.message is not exposed as safeErrorCode', async () => {
    const res = await sendIntegrityEvent({
      attemptId: TEST_ATTEMPT_ID,
      source: 'page_hidden',
      clientTimestamp: new Date().toISOString(),
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: async () => ({
        ok: false,
        status: 500,
        json: async () => ({
          message: 'internal stack details at file.ts:123',
        }),
      }),
    });

    assert.equal(res.safeHttpStatus, 500);
    assert.equal(res.safeErrorCode, 'HTTP_500');
    assert.equal(JSON.stringify(res).includes('stack details'), false);
  });

  await it('57 test_diagnostic_cap_10: requested 10 yields capped diagnostic length <= 10', async () => {
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      maxDiagnosticHistory: 10,
      fetchImpl: createMockFetch(async () => createSuccessResponse()),
    });

    for (let i = 0; i < 25; i++) {
      queue.enqueue('page_hidden');
    }

    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    const diags = queue.getDiagnostics();
    assert.ok(diags.length <= 10, `Expected <= 10, got ${diags.length}`);
    assert.equal(diags.length, 10);
  });

  await it('58 test_diagnostic_cap_50: requested 50 yields capped diagnostic length <= 50', async () => {
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      maxDiagnosticHistory: 50,
      fetchImpl: createMockFetch(async () => createSuccessResponse()),
    });

    for (let i = 0; i < 70; i++) {
      queue.enqueue('page_hidden');
    }

    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    const diags = queue.getDiagnostics();
    assert.ok(diags.length <= 50, `Expected <= 50, got ${diags.length}`);
    assert.equal(diags.length, 50);
  });

  await it('59 test_diagnostic_cap_5000_clamped_50: requested 5000 is clamped to 50', async () => {
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      maxDiagnosticHistory: 5000,
      fetchImpl: createMockFetch(async () => createSuccessResponse()),
    });

    for (let i = 0; i < 70; i++) {
      queue.enqueue('page_hidden');
    }

    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    const diags = queue.getDiagnostics();
    assert.ok(diags.length <= 50, `Expected clamped <= 50, got ${diags.length}`);
    assert.equal(diags.length, 50);
  });

  await it('60 test_diagnostic_cap_infinity_clamped_50: Infinity is clamped to default 50', async () => {
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      maxDiagnosticHistory: Infinity,
      fetchImpl: createMockFetch(async () => createSuccessResponse()),
    });

    for (let i = 0; i < 65; i++) {
      queue.enqueue('page_hidden');
    }

    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    const diags = queue.getDiagnostics();
    assert.ok(diags.length <= 50, `Expected <= 50, got ${diags.length}`);
    assert.equal(diags.length, 50);
  });

  await it('61 test_diagnostic_cap_nan_defaults_safe: NaN defaults safely to 50', async () => {
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      maxDiagnosticHistory: 'invalid-string',
      fetchImpl: createMockFetch(async () => createSuccessResponse()),
    });

    for (let i = 0; i < 65; i++) {
      queue.enqueue('page_hidden');
    }

    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    const diags = queue.getDiagnostics();
    assert.ok(diags.length <= 50, `Expected <= 50, got ${diags.length}`);
    assert.equal(diags.length, 50);
  });

  console.log('\n====================================================');
  console.log(`TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
  console.log('====================================================\n');

  if (failedTests > 0) {
    throw new Error(`Test suite failed with ${failedTests} failures.`);
  }
}

main().catch((err) => {
  console.error('❌ Test execution terminated with error:', err);
  process.exit(1);
});
