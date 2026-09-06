// scripts/test_exam_integrity_coordinator.mjs
// Phase 3D Production Coordinator Unit Test Suite (18 Tests: 66..83)
// Directly imports and executes src/services/examIntegrityCoordinator.js in Node.js

import assert from 'node:assert/strict';
import { createExamIntegrityCoordinator } from '../src/services/examIntegrityCoordinator.js';
import { createExamIntegritySession, isValidAttemptId } from '../src/services/examIntegritySession.js';
import { sendIntegrityEvent } from '../src/services/examIntegrityClient.js';

let testIndex = 65;
function pass(desc) {
  testIndex++;
  console.log(`✅ [${String(testIndex).padStart(2, '0')}] PASS: ${desc}`);
}

class MockEventTarget {
  constructor() {
    this.listeners = new Map();
  }
  addEventListener(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(handler);
  }
  removeEventListener(event, handler) {
    if (this.listeners.has(event)) {
      const filtered = this.listeners.get(event).filter((h) => h !== handler);
      this.listeners.set(event, filtered);
    }
  }
  emit(event) {
    const list = this.listeners.get(event) || [];
    for (const fn of list) {
      fn();
    }
  }
  listenerCount(event) {
    return (this.listeners.get(event) || []).length;
  }
}

class ControlledMockQueue {
  constructor(options) {
    this.options = options;
    this.isStarted = false;
    this.isStopped = false;
    this.enqueued = [];
  }
  start() {
    this.isStarted = true;
    return true;
  }
  stop() {
    this.isStopped = true;
  }
  enqueue(source) {
    if (this.isStopped) return false;
    this.enqueued.push(source);
    return true;
  }
  getStatus() {
    return { isStopped: this.isStopped, isStarted: this.isStarted };
  }
}

const ATTEMPT_A = 'c0ffee00-1234-4567-89ab-cdef01234567';
const ATTEMPT_B = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

console.log('====================================================');
console.log('EXAM BUILDER V1 - PHASE 3D COORDINATOR TESTS (66..83)');
console.log('====================================================\n');

// 66 manual_stop_tombstone_survives_session_disposal
{
  const coordinator = createExamIntegrityCoordinator();
  coordinator.sync({
    attemptId: ATTEMPT_A,
    enabled: true,
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
  });
  assert.equal(coordinator.isActive(), true);

  coordinator.stopIntegrity();
  assert.equal(coordinator.isActive(), false);
  assert.equal(coordinator.getCurrentSession(), null);
  assert.equal(coordinator.getManualStoppedAttemptId(), ATTEMPT_A);
  pass('66 manual_stop_tombstone_survives_session_disposal');
}

// 67 manual_stop_same_attempt_enabled_toggle_no_restart
{
  const coordinator = createExamIntegrityCoordinator();
  coordinator.sync({
    attemptId: ATTEMPT_A,
    enabled: true,
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
  });
  coordinator.stopIntegrity();

  // Toggle enabled false -> true for same attempt
  coordinator.sync({ attemptId: ATTEMPT_A, enabled: false });
  const result = coordinator.sync({
    attemptId: ATTEMPT_A,
    enabled: true,
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
  });

  assert.equal(result.active, false);
  assert.equal(coordinator.isActive(), false);
  assert.equal(coordinator.getCurrentSession(), null);
  pass('67 manual_stop_same_attempt_enabled_toggle_no_restart');
}

// 68 attempt_change_clears_old_manual_stop_block
{
  const coordinator = createExamIntegrityCoordinator();
  coordinator.sync({
    attemptId: ATTEMPT_A,
    enabled: true,
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
  });
  coordinator.stopIntegrity();

  // Switch to Attempt B
  const resultB = coordinator.sync({
    attemptId: ATTEMPT_B,
    enabled: true,
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
  });

  assert.equal(resultB.active, true);
  assert.equal(coordinator.isActive(), true);
  assert.equal(coordinator.getManualStoppedAttemptId(), null);
  assert.equal(coordinator.getCurrentAttemptId(), ATTEMPT_B);
  pass('68 attempt_change_clears_old_manual_stop_block');
}

// 69 same_attempt_rerender_after_manual_stop_no_session_created
{
  let sessionCreations = 0;
  const coordinator = createExamIntegrityCoordinator();
  const customSessionFactory = (opts) => {
    sessionCreations++;
    return {
      start: () => true,
      stop: () => {},
      teardown: () => {},
      isActive: () => true,
      updateCallbacks: () => {},
      updateTokenResolver: () => {},
    };
  };

  coordinator.sync({
    attemptId: ATTEMPT_A,
    enabled: true,
    sessionFactory: customSessionFactory,
  });
  assert.equal(sessionCreations, 1);

  coordinator.stopIntegrity();

  // Simulate multiple React re-renders with same props
  coordinator.sync({ attemptId: ATTEMPT_A, enabled: true, sessionFactory: customSessionFactory });
  coordinator.sync({ attemptId: ATTEMPT_A, enabled: true, sessionFactory: customSessionFactory });

  assert.equal(sessionCreations, 1);
  assert.equal(coordinator.isActive(), false);
  pass('69 same_attempt_rerender_after_manual_stop_no_session_created');
}

// 70 token_resolver_update_used_by_existing_queue
{
  let capturedQueueOpts = null;
  const coordinator = createExamIntegrityCoordinator();
  const mockDoc = new MockEventTarget();
  const mockWin = new MockEventTarget();

  coordinator.sync({
    attemptId: ATTEMPT_A,
    enabled: true,
    getAccessToken: () => 'token-1',
    targetDocument: mockDoc,
    targetWindow: mockWin,
    sessionFactory: (opts) => {
      opts.queueFactory = (qOpts) => {
        capturedQueueOpts = qOpts;
        return new ControlledMockQueue(qOpts);
      };
      return createExamIntegritySession(opts);
    },
  });

  assert.equal(await capturedQueueOpts.getAccessToken(), 'token-1');

  // Re-sync with updated token resolver
  coordinator.sync({
    attemptId: ATTEMPT_A,
    enabled: true,
    getAccessToken: () => 'token-2-updated',
    targetDocument: mockDoc,
    targetWindow: mockWin,
  });

  // Existing queue's wrapper resolves latest token
  assert.equal(await capturedQueueOpts.getAccessToken(), 'token-2-updated');
  pass('70 token_resolver_update_used_by_existing_queue');
}

// 71 callback_result_update_used_by_existing_queue
{
  let capturedQueueOpts = null;
  let receivedResult = null;
  const coordinator = createExamIntegrityCoordinator();
  const mockDoc = new MockEventTarget();
  const mockWin = new MockEventTarget();

  coordinator.sync({
    attemptId: ATTEMPT_A,
    enabled: true,
    onResult: (data) => {
      receivedResult = `first:${data.event_type}`;
    },
    targetDocument: mockDoc,
    targetWindow: mockWin,
    sessionFactory: (opts) => {
      opts.queueFactory = (qOpts) => {
        capturedQueueOpts = qOpts;
        return new ControlledMockQueue(qOpts);
      };
      return createExamIntegritySession(opts);
    },
  });

  // Update callback
  coordinator.sync({
    attemptId: ATTEMPT_A,
    enabled: true,
    onResult: (data) => {
      receivedResult = `second:${data.event_type}`;
    },
    targetDocument: mockDoc,
    targetWindow: mockWin,
  });

  capturedQueueOpts.onResult({ event_type: 'episode_opened' });
  assert.equal(receivedResult, 'second:episode_opened');
  pass('71 callback_result_update_used_by_existing_queue');
}

// 72 callback_error_update_used_by_existing_queue
{
  let capturedQueueOpts = null;
  let receivedError = null;
  const coordinator = createExamIntegrityCoordinator();
  const mockDoc = new MockEventTarget();
  const mockWin = new MockEventTarget();

  coordinator.sync({
    attemptId: ATTEMPT_A,
    enabled: true,
    onError: (err) => {
      receivedError = `first:${err.type}`;
    },
    targetDocument: mockDoc,
    targetWindow: mockWin,
    sessionFactory: (opts) => {
      opts.queueFactory = (qOpts) => {
        capturedQueueOpts = qOpts;
        return new ControlledMockQueue(qOpts);
      };
      return createExamIntegritySession(opts);
    },
  });

  // Update error callback
  coordinator.sync({
    attemptId: ATTEMPT_A,
    enabled: true,
    onError: (err) => {
      receivedError = `second:${err.type}`;
    },
    targetDocument: mockDoc,
    targetWindow: mockWin,
  });

  capturedQueueOpts.onError({ type: 'failed_ambiguous' });
  assert.equal(receivedError, 'second:failed_ambiguous');
  pass('72 callback_error_update_used_by_existing_queue');
}

// 73 stale_late_result_does_not_call_new_callback
{
  let oldQueueOpts = null;
  let newCallbackCalled = false;
  const coordinator = createExamIntegrityCoordinator();
  const mockDoc = new MockEventTarget();
  const mockWin = new MockEventTarget();

  coordinator.sync({
    attemptId: ATTEMPT_A,
    enabled: true,
    targetDocument: mockDoc,
    targetWindow: mockWin,
    sessionFactory: (opts) => {
      opts.queueFactory = (qOpts) => {
        oldQueueOpts = qOpts;
        return new ControlledMockQueue(qOpts);
      };
      return createExamIntegritySession(opts);
    },
  });

  // Stop session A
  coordinator.stopIntegrity();

  // Setup fresh session B with new callback
  coordinator.sync({
    attemptId: ATTEMPT_B,
    enabled: true,
    onResult: () => {
      newCallbackCalled = true;
    },
    targetDocument: mockDoc,
    targetWindow: mockWin,
  });

  // Late callback from old queue A fires
  oldQueueOpts.onResult({ event_recorded: true });
  assert.equal(newCallbackCalled, false);
  pass('73 stale_late_result_does_not_call_new_callback');
}

// 74 stale_late_error_does_not_call_new_error_callback
{
  let oldQueueOpts = null;
  let newErrorCalled = false;
  const coordinator = createExamIntegrityCoordinator();
  const mockDoc = new MockEventTarget();
  const mockWin = new MockEventTarget();

  coordinator.sync({
    attemptId: ATTEMPT_A,
    enabled: true,
    targetDocument: mockDoc,
    targetWindow: mockWin,
    sessionFactory: (opts) => {
      opts.queueFactory = (qOpts) => {
        oldQueueOpts = qOpts;
        return new ControlledMockQueue(qOpts);
      };
      return createExamIntegritySession(opts);
    },
  });

  coordinator.stopIntegrity();

  coordinator.sync({
    attemptId: ATTEMPT_B,
    enabled: true,
    onError: () => {
      newErrorCalled = true;
    },
    targetDocument: mockDoc,
    targetWindow: mockWin,
  });

  // Late error from old queue A fires
  oldQueueOpts.onError({ type: 'failed_http' });
  assert.equal(newErrorCalled, false);
  pass('74 stale_late_error_does_not_call_new_error_callback');
}

// 75 session_client_uuid_validation_parity
{
  const uuidFixtures = [
    { input: 'c0ffee00-1234-4567-89ab-cdef01234567', expected: true, label: 'valid v4 lowercase' },
    { input: 'C0FFEE00-1234-4567-89AB-CDEF01234567', expected: true, label: 'valid uppercase' },
    { input: '123e4567-e89b-12d3-a456-426614174000', expected: true, label: 'valid v1' },
    { input: '123e4567-e89b-22d3-a456-426614174000', expected: true, label: 'valid v2' },
    { input: '123e4567-e89b-32d3-a456-426614174000', expected: true, label: 'valid v3' },
    { input: '123e4567-e89b-52d3-a456-426614174000', expected: true, label: 'valid v5' },
    { input: '123e4567-e89b-02d3-a456-426614174000', expected: false, label: 'bad version 0' },
    { input: '123e4567-e89b-62d3-a456-426614174000', expected: false, label: 'bad version 6' },
    { input: '123e4567-e89b-42d3-0456-426614174000', expected: false, label: 'bad variant 0' },
    { input: '123e4567-e89b-42d3-c456-426614174000', expected: false, label: 'bad variant c' },
    { input: '123e4567-e89b-12d3-a456', expected: false, label: 'too short' },
    { input: '123e4567-e89b-12d3-a456-4266141740001234', expected: false, label: 'too long' },
    { input: '123e4567-e89b-12d3-a456-42661417400g', expected: false, label: 'non-hex' },
    { input: '', expected: false, label: 'empty' },
    { input: null, expected: false, label: 'null' },
    { input: undefined, expected: false, label: 'undefined' },
  ];

  for (const f of uuidFixtures) {
    const sessionRes = isValidAttemptId(f.input);
    assert.equal(
      sessionRes,
      f.expected,
      `Session UUID validation mismatch on fixture "${f.label}": input=${f.input}`
    );

    // Run client pre-dispatch validation on same fixture
    const clientRes = await sendIntegrityEvent({
      attemptId: f.input,
      source: 'page_hidden',
      clientTimestamp: new Date().toISOString(),
      getAccessToken: () => 'token',
      fetchImpl: () => Promise.resolve({ ok: true, json: () => ({}) }),
    });

    if (f.expected) {
      assert.notEqual(
        clientRes?.error?.code,
        'INVALID_ATTEMPT_ID',
        `Client should accept valid UUID "${f.label}"`
      );
    } else {
      assert.equal(
        clientRes?.error?.code,
        'INVALID_ATTEMPT_ID',
        `Client should reject invalid UUID "${f.label}"`
      );
    }
  }

  pass('75 session_client_uuid_validation_parity verified across all 16 UUID fixtures');
}

// 76 manual_stop_then_null_preserves_tombstone
{
  const coordinator = createExamIntegrityCoordinator();
  coordinator.sync({ attemptId: ATTEMPT_A, enabled: true, targetDocument: new MockEventTarget(), targetWindow: new MockEventTarget() });
  coordinator.stopIntegrity();
  assert.equal(coordinator.getManualStoppedAttemptId(), ATTEMPT_A);

  coordinator.sync({ attemptId: null, enabled: true });
  assert.equal(coordinator.getManualStoppedAttemptId(), ATTEMPT_A);

  const res = coordinator.sync({ attemptId: ATTEMPT_A, enabled: true });
  assert.equal(res.active, false);
  pass('76 manual_stop_then_null_preserves_tombstone');
}

// 77 manual_stop_then_undefined_preserves_tombstone
{
  const coordinator = createExamIntegrityCoordinator();
  coordinator.sync({ attemptId: ATTEMPT_A, enabled: true, targetDocument: new MockEventTarget(), targetWindow: new MockEventTarget() });
  coordinator.stopIntegrity();

  coordinator.sync({ attemptId: undefined, enabled: true });
  assert.equal(coordinator.getManualStoppedAttemptId(), ATTEMPT_A);

  const res = coordinator.sync({ attemptId: ATTEMPT_A, enabled: true });
  assert.equal(res.active, false);
  pass('77 manual_stop_then_undefined_preserves_tombstone');
}

// 78 manual_stop_then_empty_preserves_tombstone
{
  const coordinator = createExamIntegrityCoordinator();
  coordinator.sync({ attemptId: ATTEMPT_A, enabled: true, targetDocument: new MockEventTarget(), targetWindow: new MockEventTarget() });
  coordinator.stopIntegrity();

  coordinator.sync({ attemptId: '', enabled: true });
  assert.equal(coordinator.getManualStoppedAttemptId(), ATTEMPT_A);

  const res = coordinator.sync({ attemptId: ATTEMPT_A, enabled: true });
  assert.equal(res.active, false);
  pass('78 manual_stop_then_empty_preserves_tombstone');
}

// 79 manual_stop_then_malformed_uuid_preserves_tombstone
{
  const coordinator = createExamIntegrityCoordinator();
  coordinator.sync({ attemptId: ATTEMPT_A, enabled: true, targetDocument: new MockEventTarget(), targetWindow: new MockEventTarget() });
  coordinator.stopIntegrity();

  coordinator.sync({ attemptId: 'not-a-uuid-123', enabled: true });
  assert.equal(coordinator.getManualStoppedAttemptId(), ATTEMPT_A);

  const res = coordinator.sync({ attemptId: ATTEMPT_A, enabled: true });
  assert.equal(res.active, false);
  pass('79 manual_stop_then_malformed_uuid_preserves_tombstone');
}

// 80 manual_stop_lowercase_then_uppercase_same_uuid_blocked
{
  const coordinator = createExamIntegrityCoordinator();
  coordinator.sync({ attemptId: ATTEMPT_A.toLowerCase(), enabled: true, targetDocument: new MockEventTarget(), targetWindow: new MockEventTarget() });
  coordinator.stopIntegrity();

  const resUpper = coordinator.sync({ attemptId: ATTEMPT_A.toUpperCase(), enabled: true, targetDocument: new MockEventTarget(), targetWindow: new MockEventTarget() });
  assert.equal(resUpper.active, false);
  assert.equal(coordinator.isActive(), false);
  pass('80 manual_stop_lowercase_then_uppercase_same_uuid_blocked');
}

// 81 manual_stop_uppercase_then_lowercase_same_uuid_blocked
{
  const coordinator = createExamIntegrityCoordinator();
  coordinator.sync({ attemptId: ATTEMPT_A.toUpperCase(), enabled: true, targetDocument: new MockEventTarget(), targetWindow: new MockEventTarget() });
  coordinator.stopIntegrity();

  const resLower = coordinator.sync({ attemptId: ATTEMPT_A.toLowerCase(), enabled: true, targetDocument: new MockEventTarget(), targetWindow: new MockEventTarget() });
  assert.equal(resLower.active, false);
  assert.equal(coordinator.isActive(), false);
  pass('81 manual_stop_uppercase_then_lowercase_same_uuid_blocked');
}

// 82 manual_stop_then_different_valid_attempt_clears_tombstone
{
  const coordinator = createExamIntegrityCoordinator();
  coordinator.sync({ attemptId: ATTEMPT_A, enabled: true, targetDocument: new MockEventTarget(), targetWindow: new MockEventTarget() });
  coordinator.stopIntegrity();
  assert.equal(coordinator.getManualStoppedAttemptId(), ATTEMPT_A);

  const resB = coordinator.sync({ attemptId: ATTEMPT_B, enabled: true, targetDocument: new MockEventTarget(), targetWindow: new MockEventTarget() });
  assert.equal(resB.active, true);
  assert.equal(coordinator.getManualStoppedAttemptId(), null);
  pass('82 manual_stop_then_different_valid_attempt_clears_tombstone');
}

// 83 invalid_attempt_never_becomes_manual_stop_tombstone
{
  const coordinator = createExamIntegrityCoordinator();
  coordinator.sync({ attemptId: 'invalid-attempt-xyz', enabled: true });
  coordinator.stopIntegrity();
  assert.equal(coordinator.getManualStoppedAttemptId(), null);
  pass('83 invalid_attempt_never_becomes_manual_stop_tombstone');
}

console.log('\n====================================================');
console.log(`TOTAL COORDINATOR TESTS: ${testIndex - 65} | ALL PASSED`);
console.log('====================================================');
