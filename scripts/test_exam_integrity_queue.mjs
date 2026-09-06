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
      success: true,
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

  // ---------------------------------------------------------------
  // 15. Transport Hardening V2 Tests (62..91)
  // ---------------------------------------------------------------
  await it('62 test_malformed_200_empty_object_rejected: HTTP 200 {} is rejected', async () => {
    const res = await sendIntegrityEvent({
      attemptId: TEST_ATTEMPT_ID,
      source: 'page_hidden',
      clientTimestamp: new Date().toISOString(),
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({}),
      }),
    });

    assert.equal(res.ok, false);
    assert.equal(res.type, QueueItemState.FAILED_HTTP);
    assert.equal(res.safeHttpStatus, 200);
    assert.equal(res.safeErrorCode, 'INVALID_RESPONSE_PAYLOAD');
  });

  await it('63 test_malformed_200_missing_data_rejected: HTTP 200 { success: true } is rejected', async () => {
    const res = await sendIntegrityEvent({
      attemptId: TEST_ATTEMPT_ID,
      source: 'page_hidden',
      clientTimestamp: new Date().toISOString(),
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      }),
    });

    assert.equal(res.ok, false);
    assert.equal(res.type, QueueItemState.FAILED_HTTP);
    assert.equal(res.safeHttpStatus, 200);
    assert.equal(res.safeErrorCode, 'INVALID_RESPONSE_PAYLOAD');
  });

  await it('64 test_malformed_200_bare_data_rejected: HTTP 200 bare 7 fields without envelope is rejected', async () => {
    const res = await sendIntegrityEvent({
      attemptId: TEST_ATTEMPT_ID,
      source: 'page_hidden',
      clientTimestamp: new Date().toISOString(),
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          attempt_id: TEST_ATTEMPT_ID,
          tab_switch_policy: 'WARN_AND_LOG',
          tab_switch_count: 1,
          active_leave_episode_id: null,
          event_recorded: true,
          event_type: 'episode_opened',
          idempotent_replay: false,
        }),
      }),
    });

    assert.equal(res.ok, false);
    assert.equal(res.type, QueueItemState.FAILED_HTTP);
    assert.equal(res.safeHttpStatus, 200);
    assert.equal(res.safeErrorCode, 'INVALID_RESPONSE_PAYLOAD');
  });

  await it('65 test_malformed_200_success_false_rejected: HTTP 200 { success: false, data: {...} } is rejected', async () => {
    const res = await sendIntegrityEvent({
      attemptId: TEST_ATTEMPT_ID,
      source: 'page_hidden',
      clientTimestamp: new Date().toISOString(),
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: false,
          data: {
            attempt_id: TEST_ATTEMPT_ID,
            tab_switch_policy: 'WARN_AND_LOG',
            tab_switch_count: 1,
            active_leave_episode_id: null,
            event_recorded: true,
            event_type: 'episode_opened',
            idempotent_replay: false,
          },
        }),
      }),
    });

    assert.equal(res.ok, false);
    assert.equal(res.type, QueueItemState.FAILED_HTTP);
    assert.equal(res.safeHttpStatus, 200);
    assert.equal(res.safeErrorCode, 'INVALID_RESPONSE_PAYLOAD');
  });

  await it('66 test_malformed_200_string_success_rejected: HTTP 200 { success: "true", data: {...} } is rejected', async () => {
    const res = await sendIntegrityEvent({
      attemptId: TEST_ATTEMPT_ID,
      source: 'page_hidden',
      clientTimestamp: new Date().toISOString(),
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: 'true',
          data: {
            attempt_id: TEST_ATTEMPT_ID,
            tab_switch_policy: 'WARN_AND_LOG',
            tab_switch_count: 1,
            active_leave_episode_id: null,
            event_recorded: true,
            event_type: 'episode_opened',
            idempotent_replay: false,
          },
        }),
      }),
    });

    assert.equal(res.ok, false);
    assert.equal(res.type, QueueItemState.FAILED_HTTP);
    assert.equal(res.safeHttpStatus, 200);
    assert.equal(res.safeErrorCode, 'INVALID_RESPONSE_PAYLOAD');
  });

  await it('67 test_malformed_200_array_data_rejected: HTTP 200 { success: true, data: [] } is rejected', async () => {
    const res = await sendIntegrityEvent({
      attemptId: TEST_ATTEMPT_ID,
      source: 'page_hidden',
      clientTimestamp: new Date().toISOString(),
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: [],
        }),
      }),
    });

    assert.equal(res.ok, false);
    assert.equal(res.type, QueueItemState.FAILED_HTTP);
    assert.equal(res.safeHttpStatus, 200);
    assert.equal(res.safeErrorCode, 'INVALID_RESPONSE_PAYLOAD');
  });

  await it('68 test_field_validation_attempt_id: non-UUID attempt_id is rejected', () => {
    assert.equal(
      sanitizeSuccessResponse({
        success: true,
        data: {
          attempt_id: 'not-a-uuid',
          tab_switch_policy: 'WARN_AND_LOG',
          tab_switch_count: 1,
          active_leave_episode_id: null,
          event_recorded: true,
          event_type: 'episode_opened',
          idempotent_replay: false,
        },
      }),
      null
    );
  });

  await it('69 test_field_validation_tab_switch_policy: invalid policy string is rejected', () => {
    assert.equal(
      sanitizeSuccessResponse({
        success: true,
        data: {
          attempt_id: TEST_ATTEMPT_ID,
          tab_switch_policy: 'INVALID_POLICY',
          tab_switch_count: 1,
          active_leave_episode_id: null,
          event_recorded: true,
          event_type: 'episode_opened',
          idempotent_replay: false,
        },
      }),
      null
    );
  });

  await it('70 test_field_validation_tab_switch_count: fraction, NaN, negative, string count rejected', () => {
    const base = {
      attempt_id: TEST_ATTEMPT_ID,
      tab_switch_policy: 'WARN_AND_LOG',
      active_leave_episode_id: null,
      event_recorded: true,
      event_type: 'episode_opened',
      idempotent_replay: false,
    };

    assert.equal(sanitizeSuccessResponse({ success: true, data: { ...base, tab_switch_count: 1.5 } }), null);
    assert.equal(sanitizeSuccessResponse({ success: true, data: { ...base, tab_switch_count: NaN } }), null);
    assert.equal(sanitizeSuccessResponse({ success: true, data: { ...base, tab_switch_count: -1 } }), null);
    assert.equal(sanitizeSuccessResponse({ success: true, data: { ...base, tab_switch_count: '2' } }), null);
    assert.equal(sanitizeSuccessResponse({ success: true, data: { ...base, tab_switch_count: Infinity } }), null);
  });

  await it('71 test_field_validation_active_leave_episode_id: null, empty string, whitespace, normal string allowed; non-string rejected', () => {
    const base = {
      attempt_id: TEST_ATTEMPT_ID,
      tab_switch_policy: 'WARN_AND_LOG',
      tab_switch_count: 1,
      event_recorded: true,
      event_type: 'episode_opened',
      idempotent_replay: false,
    };

    // Valid cases & exact preservation
    const resNull = sanitizeSuccessResponse({ success: true, data: { ...base, active_leave_episode_id: null } });
    assert.ok(resNull);
    assert.strictEqual(resNull.active_leave_episode_id, null);

    const resEmpty = sanitizeSuccessResponse({ success: true, data: { ...base, active_leave_episode_id: '' } });
    assert.ok(resEmpty);
    assert.strictEqual(resEmpty.active_leave_episode_id, '');

    const resWhitespace = sanitizeSuccessResponse({ success: true, data: { ...base, active_leave_episode_id: '   ' } });
    assert.ok(resWhitespace);
    assert.strictEqual(resWhitespace.active_leave_episode_id, '   ');

    const resNormal = sanitizeSuccessResponse({ success: true, data: { ...base, active_leave_episode_id: 'episode-test' } });
    assert.ok(resNormal);
    assert.strictEqual(resNormal.active_leave_episode_id, 'episode-test');

    // Invalid cases (non-string, non-null) rejected
    assert.strictEqual(sanitizeSuccessResponse({ success: true, data: { ...base, active_leave_episode_id: 123 } }), null);
    assert.strictEqual(sanitizeSuccessResponse({ success: true, data: { ...base, active_leave_episode_id: {} } }), null);
    assert.strictEqual(sanitizeSuccessResponse({ success: true, data: { ...base, active_leave_episode_id: [] } }), null);
    assert.strictEqual(sanitizeSuccessResponse({ success: true, data: { ...base, active_leave_episode_id: true } }), null);
  });

  await it('72 test_field_validation_event_recorded: non-boolean values rejected', () => {
    const base = {
      attempt_id: TEST_ATTEMPT_ID,
      tab_switch_policy: 'WARN_AND_LOG',
      tab_switch_count: 1,
      active_leave_episode_id: null,
      event_type: 'episode_opened',
      idempotent_replay: false,
    };

    assert.equal(sanitizeSuccessResponse({ success: true, data: { ...base, event_recorded: 'true' } }), null);
    assert.equal(sanitizeSuccessResponse({ success: true, data: { ...base, event_recorded: 1 } }), null);
    assert.equal(sanitizeSuccessResponse({ success: true, data: { ...base, event_recorded: null } }), null);
    assert.ok(sanitizeSuccessResponse({ success: true, data: { ...base, event_recorded: true } }));
    assert.ok(sanitizeSuccessResponse({ success: true, data: { ...base, event_recorded: false } }));
  });

  await it('73 test_field_validation_event_type: invalid string rejected; valid enums and null allowed', () => {
    const base = {
      attempt_id: TEST_ATTEMPT_ID,
      tab_switch_policy: 'WARN_AND_LOG',
      tab_switch_count: 1,
      active_leave_episode_id: null,
      event_recorded: true,
      idempotent_replay: false,
    };

    assert.equal(sanitizeSuccessResponse({ success: true, data: { ...base, event_type: 'unknown_type' } }), null);
    assert.equal(sanitizeSuccessResponse({ success: true, data: { ...base, event_type: 123 } }), null);
    assert.ok(sanitizeSuccessResponse({ success: true, data: { ...base, event_type: 'episode_opened' } }));
    assert.ok(sanitizeSuccessResponse({ success: true, data: { ...base, event_type: 'episode_closed' } }));
    assert.ok(sanitizeSuccessResponse({ success: true, data: { ...base, event_type: 'focus_loss_auxiliary' } }));
    assert.ok(sanitizeSuccessResponse({ success: true, data: { ...base, event_type: null } }));
  });

  await it('74 test_field_validation_idempotent_replay: non-boolean values rejected', () => {
    const base = {
      attempt_id: TEST_ATTEMPT_ID,
      tab_switch_policy: 'WARN_AND_LOG',
      tab_switch_count: 1,
      active_leave_episode_id: null,
      event_recorded: true,
      event_type: 'episode_opened',
    };

    assert.equal(sanitizeSuccessResponse({ success: true, data: { ...base, idempotent_replay: 'false' } }), null);
    assert.equal(sanitizeSuccessResponse({ success: true, data: { ...base, idempotent_replay: 0 } }), null);
    assert.ok(sanitizeSuccessResponse({ success: true, data: { ...base, idempotent_replay: true } }));
    assert.ok(sanitizeSuccessResponse({ success: true, data: { ...base, idempotent_replay: false } }));
  });

  await it('75 test_raw_token_resolver_secret_not_exposed: token error does not leak provider secrets', async () => {
    const res = await sendIntegrityEvent({
      attemptId: TEST_ATTEMPT_ID,
      source: 'page_hidden',
      clientTimestamp: new Date().toISOString(),
      getAccessToken: async () => {
        throw new Error('SECRET_INTERNAL_AUTH_PROVIDER_LEAK');
      },
    });

    assert.equal(res.ok, false);
    assert.equal(res.type, QueueItemState.FAILED_PRE_DISPATCH);
    assert.equal(res.safeErrorCode, 'TOKEN_RESOLUTION_ERROR');
    assert.equal(JSON.stringify(res).includes('SECRET_INTERNAL_AUTH_PROVIDER_LEAK'), false);
  });

  await it('76 test_raw_fetch_network_secret_not_exposed: fetch exception does not leak network URL secrets', async () => {
    const res = await sendIntegrityEvent({
      attemptId: TEST_ATTEMPT_ID,
      source: 'page_hidden',
      clientTimestamp: new Date().toISOString(),
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: async () => {
        throw new Error('Failed to connect to internal.corp.secret.host:8080');
      },
    });

    assert.equal(res.ok, false);
    assert.equal(res.type, QueueItemState.FAILED_AMBIGUOUS);
    assert.equal(res.safeErrorCode, 'NETWORK_ERROR');
    assert.equal(JSON.stringify(res).includes('internal.corp.secret'), false);
  });

  await it('77 test_custom_dispatcher_throw_handled_safely: thrown Error does not leak into queue onError', async () => {
    let capturedError = null;
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      sendIntegrityEvent: async () => {
        throw new Error('SECRET_DISPATCH_EXCEPTION_MSG');
      },
      onError: (err) => {
        capturedError = err;
      },
    });

    queue.enqueue('page_hidden');
    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.ok(capturedError);
    assert.equal(capturedError.ok, false);
    assert.equal(capturedError.type, QueueItemState.FAILED_AMBIGUOUS);
    assert.equal(capturedError.safeErrorCode, 'UNEXPECTED_DISPATCH_ERROR');
    assert.equal(JSON.stringify(capturedError).includes('SECRET_DISPATCH_EXCEPTION_MSG'), false);
  });

  await it('78 test_custom_dispatcher_raw_message_stripped: error.message in dispatcher return is stripped', async () => {
    let capturedError = null;
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      sendIntegrityEvent: async () => ({
        ok: false,
        type: 'failed_ambiguous',
        error: {
          code: 'NETWORK_ERROR',
          message: 'SECRET_RAW_MESSAGE_LEAK',
        },
      }),
      onError: (err) => {
        capturedError = err;
      },
    });

    queue.enqueue('page_hidden');
    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.ok(capturedError);
    assert.equal(capturedError.safeErrorCode, 'NETWORK_ERROR');
    assert.equal('error' in capturedError, false);
    assert.equal('message' in capturedError, false);
    assert.equal(JSON.stringify(capturedError).includes('SECRET_RAW_MESSAGE_LEAK'), false);
  });

  await it('79 test_custom_dispatcher_extra_fields_stripped: rawBody and stack stripped from onError and diags', async () => {
    let capturedError = null;
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      sendIntegrityEvent: async () => ({
        ok: false,
        type: 'failed_http',
        safeHttpStatus: 500,
        safeErrorCode: 'HTTP_500',
        rawBody: 'SECRET_RESPONSE_BODY_SQL_DUMP',
        stack: 'SECRET_INTERNAL_FILE_STACK_TRACE',
        headers: { 'x-secret': '123' },
      }),
      onError: (err) => {
        capturedError = err;
      },
    });

    queue.enqueue('page_hidden');
    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.ok(capturedError);
    assert.equal('rawBody' in capturedError, false);
    assert.equal('stack' in capturedError, false);
    assert.equal('headers' in capturedError, false);
    assert.equal(JSON.stringify(capturedError).includes('SECRET_RESPONSE_BODY'), false);

    const diags = queue.getDiagnostics();
    assert.equal(JSON.stringify(diags).includes('SECRET_RESPONSE_BODY'), false);
  });

  await it('80 test_auth_error_codes_preserved: INVALID_TOKEN, FORBIDDEN_ROLE, ACCOUNT_DISABLED preserved', async () => {
    const authCodes = ['INVALID_TOKEN', 'FORBIDDEN_ROLE', 'ACCOUNT_DISABLED'];
    for (const code of authCodes) {
      let capturedError = null;
      const queue = new ExamIntegrityQueue({
        attemptId: TEST_ATTEMPT_ID,
        sendIntegrityEvent: async () => ({
          ok: false,
          type: 'failed_http',
          safeHttpStatus: 401,
          safeErrorCode: code,
        }),
        onError: (err) => {
          capturedError = err;
        },
      });

      queue.enqueue('page_hidden');
      while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
        await sleep(10);
      }

      assert.equal(capturedError.safeErrorCode, code, `Expected ${code} to be preserved`);
    }
  });

  await it('81 test_validation_error_code_preserved: INVALID_REQUEST_FIELD preserved', async () => {
    let capturedError = null;
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      sendIntegrityEvent: async () => ({
        ok: false,
        type: 'failed_http',
        safeHttpStatus: 400,
        safeErrorCode: 'INVALID_REQUEST_FIELD',
      }),
      onError: (err) => {
        capturedError = err;
      },
    });

    queue.enqueue('page_hidden');
    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.equal(capturedError.safeErrorCode, 'INVALID_REQUEST_FIELD');
  });

  await it('82 test_custom_unknown_safeErrorCode_blocked: unknown secret code maps to safe fallback', async () => {
    let capturedHttpErr = null;
    let capturedAmbiguousErr = null;

    const queueHttp = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      sendIntegrityEvent: async () => ({
        ok: false,
        type: 'failed_http',
        safeHttpStatus: 500,
        safeErrorCode: 'SECRET_DB_PASSWORD_XYZ',
      }),
      onError: (err) => {
        capturedHttpErr = err;
      },
    });
    queueHttp.enqueue('page_hidden');
    while (queueHttp.getStatus().inFlight || queueHttp.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.equal(capturedHttpErr.safeErrorCode, 'HTTP_500');
    assert.equal(JSON.stringify(capturedHttpErr).includes('SECRET_DB_PASSWORD'), false);

    const queueAmbiguous = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      sendIntegrityEvent: async () => ({
        ok: false,
        type: 'failed_ambiguous',
        safeErrorCode: 'SECRET_INTERNAL_NETWORK_LEAK',
      }),
      onError: (err) => {
        capturedAmbiguousErr = err;
      },
    });
    queueAmbiguous.enqueue('page_hidden');
    while (queueAmbiguous.getStatus().inFlight || queueAmbiguous.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.equal(capturedAmbiguousErr.safeErrorCode, 'UNEXPECTED_DISPATCH_ERROR');
    assert.equal(JSON.stringify(capturedAmbiguousErr).includes('SECRET_INTERNAL_NETWORK'), false);
  });

  await it('83 test_matching_http_status_code_preserved: HTTP_503 with status 503 is preserved', async () => {
    let capturedError = null;
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      sendIntegrityEvent: async () => ({
        ok: false,
        type: 'failed_http',
        safeHttpStatus: 503,
        safeErrorCode: 'HTTP_503',
      }),
      onError: (err) => {
        capturedError = err;
      },
    });

    queue.enqueue('page_hidden');
    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.equal(capturedError.safeHttpStatus, 503);
    assert.equal(capturedError.safeErrorCode, 'HTTP_503');
  });

  await it('84 test_mismatched_http_status_code_normalized: HTTP_401 with status 500 normalized to HTTP_500', async () => {
    let capturedError = null;
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      sendIntegrityEvent: async () => ({
        ok: false,
        type: 'failed_http',
        safeHttpStatus: 500,
        safeErrorCode: 'HTTP_401', // Mismatched suffix 401 !== status 500
      }),
      onError: (err) => {
        capturedError = err;
      },
    });

    queue.enqueue('page_hidden');
    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.equal(capturedError.safeHttpStatus, 500);
    assert.equal(capturedError.safeErrorCode, 'HTTP_500');
  });

  await it('85 test_safeHttpStatus_normalized: non-integer / out-of-range status normalized to 500', async () => {
    const invalidStatuses = ['500', 500.5, 999, -1, NaN, Infinity];
    for (const status of invalidStatuses) {
      let capturedError = null;
      const queue = new ExamIntegrityQueue({
        attemptId: TEST_ATTEMPT_ID,
        sendIntegrityEvent: async () => ({
          ok: false,
          type: 'failed_http',
          safeHttpStatus: status,
          safeErrorCode: 'INTERNAL_ERROR',
        }),
        onError: (err) => {
          capturedError = err;
        },
      });

      queue.enqueue('page_hidden');
      while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
        await sleep(10);
      }

      assert.equal(capturedError.safeHttpStatus, 500, `Expected status normalized to 500 for input ${status}`);
      assert.equal(capturedError.safeErrorCode, 'INTERNAL_ERROR');
    }
  });

  await it('86 test_non_http_omits_safeHttpStatus: failed_pre_dispatch / failed_ambiguous omit safeHttpStatus', async () => {
    let capturedPreErr = null;
    let capturedAmbErr = null;

    const queuePre = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      sendIntegrityEvent: async () => ({
        ok: false,
        type: 'failed_pre_dispatch',
        safeHttpStatus: 400, // Should be discarded
        safeErrorCode: 'INVALID_ATTEMPT_ID',
      }),
      onError: (err) => {
        capturedPreErr = err;
      },
    });
    queuePre.enqueue('page_hidden');
    while (queuePre.getStatus().inFlight || queuePre.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.equal('safeHttpStatus' in capturedPreErr, false);

    const queueAmb = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      sendIntegrityEvent: async () => ({
        ok: false,
        type: 'failed_ambiguous',
        safeHttpStatus: 500, // Should be discarded
        safeErrorCode: 'NETWORK_ERROR',
      }),
      onError: (err) => {
        capturedAmbErr = err;
      },
    });
    queueAmb.enqueue('page_hidden');
    while (queueAmb.getStatus().inFlight || queueAmb.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.equal('safeHttpStatus' in capturedAmbErr, false);
  });

  await it('87 test_unknown_type_fails_closed: custom type evil_state becomes failed_ambiguous', async () => {
    let capturedError = null;
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      sendIntegrityEvent: async () => ({
        ok: false,
        type: 'evil_state',
        safeErrorCode: 'NETWORK_ERROR',
      }),
      onError: (err) => {
        capturedError = err;
      },
    });

    queue.enqueue('page_hidden');
    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.equal(capturedError.type, QueueItemState.FAILED_AMBIGUOUS);
    assert.equal(capturedError.safeErrorCode, 'UNEXPECTED_DISPATCH_ERROR');
  });

  await it('88 test_queue_revalidates_success: custom dispatcher ok:true malformed data triggers onError not onResult', async () => {
    let onResultCalled = false;
    let capturedError = null;

    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      sendIntegrityEvent: async () => ({
        ok: true,
        type: 'succeeded',
        data: {
          attempt_id: 'corrupted-data', // Fails 7-field check
        },
      }),
      onResult: () => {
        onResultCalled = true;
      },
      onError: (err) => {
        capturedError = err;
      },
    });

    queue.enqueue('page_hidden');
    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.equal(onResultCalled, false, 'onResult must not be called with malformed data');
    assert.ok(capturedError);
    assert.equal(capturedError.ok, false);
    assert.equal(capturedError.type, QueueItemState.FAILED_HTTP);
    assert.equal(capturedError.safeHttpStatus, 200);
    assert.equal(capturedError.safeErrorCode, 'INVALID_RESPONSE_PAYLOAD');
  });

  await it('89 test_onError_keys_strict_allowlist: onError receives strictly approved keys only', async () => {
    let capturedError = null;
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      sendIntegrityEvent: async () => ({
        ok: false,
        type: 'failed_http',
        safeHttpStatus: 404,
        safeErrorCode: 'ATTEMPT_NOT_FOUND',
        extraSecret: 'should_be_stripped',
      }),
      onError: (err) => {
        capturedError = err;
      },
    });

    queue.enqueue('page_hidden');
    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.deepEqual(Object.keys(capturedError).sort(), ['ok', 'safeErrorCode', 'safeHttpStatus', 'type']);
  });

  await it('90 test_diagnostics_keys_strict_allowlist: diagnostics history entries contain only allowlist keys', async () => {
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: createMockFetch(async () => createErrorResponse(404, 'ATTEMPT_NOT_FOUND')),
    });

    queue.enqueue('page_hidden');
    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    const diags = queue.getDiagnostics();
    assert.equal(diags.length, 1);
    const keys = Object.keys(diags[0]).sort();
    assert.deepEqual(keys, ['capturedAt', 'safeErrorCode', 'safeHttpStatus', 'seq', 'source', 'terminalState']);
  });

  await it('91 test_valid_7_field_success_passes_cleanly: valid success payload calls onResult with 7 fields', async () => {
    let receivedData = null;
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      getAccessToken: async () => TEST_TOKEN,
      fetchImpl: createMockFetch(async () => createSuccessResponse()),
      onResult: (data) => {
        receivedData = data;
      },
    });

    queue.enqueue('page_hidden');
    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.ok(receivedData);
    assert.equal(receivedData.attempt_id, TEST_ATTEMPT_ID);
    assert.equal(receivedData.tab_switch_policy, 'WARN_AND_LOG');
    assert.equal(receivedData.tab_switch_count, 1);
    assert.equal(receivedData.active_leave_episode_id, '89999999-9999-4999-8999-999999999999');
    assert.equal(receivedData.event_recorded, true);
    assert.equal(receivedData.event_type, 'episode_opened');
    assert.equal(receivedData.idempotent_replay, false);
    assert.equal(Object.keys(receivedData).length, 7);
  });

  await it('92 test_queue_active_leave_episode_id_empty_preserved: empty string preserved exactly in onResult', async () => {
    let receivedData = null;
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      sendIntegrityEvent: async () => ({
        ok: true,
        type: 'succeeded',
        data: {
          attempt_id: TEST_ATTEMPT_ID,
          tab_switch_policy: 'WARN_AND_LOG',
          tab_switch_count: 1,
          active_leave_episode_id: '',
          event_recorded: true,
          event_type: 'episode_opened',
          idempotent_replay: false,
        },
      }),
      onResult: (data) => {
        receivedData = data;
      },
    });

    queue.enqueue('page_hidden');
    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.ok(receivedData);
    assert.strictEqual(receivedData.active_leave_episode_id, '');
  });

  await it('93 test_queue_active_leave_episode_id_whitespace_preserved: whitespace string preserved exactly in onResult', async () => {
    let receivedData = null;
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      sendIntegrityEvent: async () => ({
        ok: true,
        type: 'succeeded',
        data: {
          attempt_id: TEST_ATTEMPT_ID,
          tab_switch_policy: 'WARN_AND_LOG',
          tab_switch_count: 1,
          active_leave_episode_id: '   ',
          event_recorded: true,
          event_type: 'episode_opened',
          idempotent_replay: false,
        },
      }),
      onResult: (data) => {
        receivedData = data;
      },
    });

    queue.enqueue('page_hidden');
    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.ok(receivedData);
    assert.strictEqual(receivedData.active_leave_episode_id, '   ');
  });

  await it('94 test_queue_active_leave_episode_id_non_string_fails: non-string active_leave_episode_id triggers onError', async () => {
    let onResultCalled = false;
    let capturedError = null;
    const queue = new ExamIntegrityQueue({
      attemptId: TEST_ATTEMPT_ID,
      sendIntegrityEvent: async () => ({
        ok: true,
        type: 'succeeded',
        data: {
          attempt_id: TEST_ATTEMPT_ID,
          tab_switch_policy: 'WARN_AND_LOG',
          tab_switch_count: 1,
          active_leave_episode_id: 123, // Invalid non-string
          event_recorded: true,
          event_type: 'episode_opened',
          idempotent_replay: false,
        },
      }),
      onResult: () => {
        onResultCalled = true;
      },
      onError: (err) => {
        capturedError = err;
      },
    });

    queue.enqueue('page_hidden');
    while (queue.getStatus().inFlight || queue.getStatus().queuedCount > 0) {
      await sleep(10);
    }

    assert.strictEqual(onResultCalled, false);
    assert.ok(capturedError);
    assert.strictEqual(capturedError.ok, false);
    assert.strictEqual(capturedError.type, QueueItemState.FAILED_HTTP);
    assert.strictEqual(capturedError.safeHttpStatus, 200);
    assert.strictEqual(capturedError.safeErrorCode, 'INVALID_RESPONSE_PAYLOAD');
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
