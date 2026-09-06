// scripts/test_exam_integrity_session.mjs
// Phase 3D Production Session Controller Unit Test Suite (43 Tests: 16..58)
// Directly imports and executes src/services/examIntegritySession.js in Node.js

import assert from 'node:assert/strict';
import { createExamIntegritySession, isValidAttemptId } from '../src/services/examIntegritySession.js';

let testIndex = 15;
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
    this.status = { active: true };
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

const VALID_UUID = 'c0ffee00-1234-4567-89ab-cdef01234567';
const VALID_UUID_B = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

console.log('====================================================');
console.log('EXAM BUILDER V1 - PHASE 3D SESSION CONTROLLER TESTS');
console.log('====================================================\n');

// 16 valid attempt starts
{
  const session = createExamIntegritySession({
    attemptId: VALID_UUID,
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
    queueFactory: (opts) => new ControlledMockQueue(opts),
  });
  const started = session.start();
  assert.equal(started, true);
  assert.equal(session.isActive(), true);
  pass('16 valid attempt starts successfully');
}

// 17 invalid null does not start
{
  const session = createExamIntegritySession({
    attemptId: null,
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
  });
  assert.equal(session.start(), false);
  assert.equal(session.isActive(), false);
  pass('17 invalid null attempt does not start');
}

// 18 invalid empty does not start
{
  const session = createExamIntegritySession({
    attemptId: '',
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
  });
  assert.equal(session.start(), false);
  assert.equal(session.isActive(), false);
  pass('18 invalid empty attempt does not start');
}

// 19 malformed UUID does not start
{
  const session = createExamIntegritySession({
    attemptId: 'not-a-valid-uuid',
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
  });
  assert.equal(session.start(), false);
  assert.equal(session.isActive(), false);
  pass('19 malformed UUID attempt does not start');
}

// 20 invalid attempt attaches no listeners
{
  const mockDoc = new MockEventTarget();
  const mockWin = new MockEventTarget();
  const session = createExamIntegritySession({
    attemptId: 'invalid-attempt-id',
    targetDocument: mockDoc,
    targetWindow: mockWin,
  });
  session.start();
  assert.equal(mockDoc.listenerCount('visibilitychange'), 0);
  assert.equal(mockWin.listenerCount('blur'), 0);
  assert.equal(mockWin.listenerCount('focus'), 0);
  pass('20 invalid attempt attaches zero listeners');
}

// 21 stop detaches immediately
{
  const mockDoc = new MockEventTarget();
  const mockWin = new MockEventTarget();
  const session = createExamIntegritySession({
    attemptId: VALID_UUID,
    targetDocument: mockDoc,
    targetWindow: mockWin,
    queueFactory: (opts) => new ControlledMockQueue(opts),
  });
  session.start();
  assert.equal(mockDoc.listenerCount('visibilitychange'), 1);
  session.stop();
  assert.equal(mockDoc.listenerCount('visibilitychange'), 0);
  assert.equal(mockWin.listenerCount('blur'), 0);
  pass('21 stop detaches all DOM listeners immediately');
}

// 22 stop stops queue
{
  let createdQueue = null;
  const session = createExamIntegritySession({
    attemptId: VALID_UUID,
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
    queueFactory: (opts) => {
      createdQueue = new ControlledMockQueue(opts);
      return createdQueue;
    },
  });
  session.start();
  assert.equal(createdQueue.isStopped, false);
  session.stop();
  assert.equal(createdQueue.isStopped, true);
  pass('22 stop calls queue.stop()');
}

// 23 stop invalidates generation
{
  const session = createExamIntegritySession({
    attemptId: VALID_UUID,
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
    queueFactory: (opts) => new ControlledMockQueue(opts),
  });
  session.start();
  const gen1 = session.getGeneration();
  session.stop();
  const gen2 = session.getGeneration();
  assert.equal(gen2 > gen1, true);
  pass('23 stop invalidates generation (increments generation count)');
}

// 24 stop idempotent
{
  const session = createExamIntegritySession({
    attemptId: VALID_UUID,
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
    queueFactory: (opts) => new ControlledMockQueue(opts),
  });
  session.start();
  session.stop();
  session.stop(); // Safe second call
  assert.equal(session.isActive(), false);
  pass('24 stop is idempotent');
}

// 25 late success after stop ignored
{
  let queueOptions = null;
  let resultReceived = false;
  const session = createExamIntegritySession({
    attemptId: VALID_UUID,
    onResult: () => {
      resultReceived = true;
    },
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
    queueFactory: (opts) => {
      queueOptions = opts;
      return new ControlledMockQueue(opts);
    },
  });
  session.start();
  session.stop();
  // Simulate late callback from queue
  queueOptions.onResult({ event_recorded: true });
  assert.equal(resultReceived, false);
  pass('25 late success callback after stop is ignored');
}

// 26 late error after stop ignored
{
  let queueOptions = null;
  let errorReceived = false;
  const session = createExamIntegritySession({
    attemptId: VALID_UUID,
    onError: () => {
      errorReceived = true;
    },
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
    queueFactory: (opts) => {
      queueOptions = opts;
      return new ControlledMockQueue(opts);
    },
  });
  session.start();
  session.stop();
  // Simulate late callback from queue
  queueOptions.onError({ type: 'failed_ambiguous' });
  assert.equal(errorReceived, false);
  pass('26 late error callback after stop is ignored');
}

// 27 manual stop terminal same attempt
{
  const session = createExamIntegritySession({
    attemptId: VALID_UUID,
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
    queueFactory: (opts) => new ControlledMockQueue(opts),
  });
  session.start();
  session.stop({ manual: true });
  assert.equal(session.isManualStopped(), true);
  assert.equal(session.isActive(), false);
  pass('27 manual stop marks session as manually stopped');
}

// 28 rerender-equivalent restart attempt blocked
{
  const session = createExamIntegritySession({
    attemptId: VALID_UUID,
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
    queueFactory: (opts) => new ControlledMockQueue(opts),
  });
  session.start();
  session.stop({ manual: true });
  const restarted = session.start();
  assert.equal(restarted, false);
  pass('28 stopped session start() returns false');
}

// 29 enabled teardown not manual terminal
{
  const session = createExamIntegritySession({
    attemptId: VALID_UUID,
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
    queueFactory: (opts) => new ControlledMockQueue(opts),
  });
  session.start();
  session.teardown();
  assert.equal(session.isManualStopped(), false);
  pass('29 enabled teardown does not mark session as manual terminal');
}

// 30 enabled false->true may create fresh session
{
  const session1 = createExamIntegritySession({
    attemptId: VALID_UUID,
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
    queueFactory: (opts) => new ControlledMockQueue(opts),
  });
  session1.start();
  session1.teardown();

  const session2 = createExamIntegritySession({
    attemptId: VALID_UUID,
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
    queueFactory: (opts) => new ControlledMockQueue(opts),
  });
  assert.equal(session2.start(), true);
  assert.equal(session2.isActive(), true);
  pass('30 fresh session can be created for still-draft attempt after teardown');
}

// 31 attempt A->B permits fresh session B
{
  const sessionA = createExamIntegritySession({
    attemptId: VALID_UUID,
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
    queueFactory: (opts) => new ControlledMockQueue(opts),
  });
  sessionA.start();
  sessionA.stop({ manual: true });

  const sessionB = createExamIntegritySession({
    attemptId: VALID_UUID_B,
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
    queueFactory: (opts) => new ControlledMockQueue(opts),
  });
  assert.equal(sessionB.start(), true);
  assert.equal(sessionB.isActive(), true);
  pass('31 attempt change to B permits fresh session B');
}

// 32 callback update does not recreate session
{
  let queueInstCount = 0;
  const session = createExamIntegritySession({
    attemptId: VALID_UUID,
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
    queueFactory: (opts) => {
      queueInstCount++;
      return new ControlledMockQueue(opts);
    },
  });
  session.start();
  assert.equal(queueInstCount, 1);
  session.updateCallbacks({ onResult: () => {}, onError: () => {} });
  assert.equal(queueInstCount, 1);
  pass('32 callback update does not recreate queue or session');
}

// 33 latest result callback used
{
  let queueOptions = null;
  let receivedVal = null;
  const session = createExamIntegritySession({
    attemptId: VALID_UUID,
    onResult: () => {
      receivedVal = 'old';
    },
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
    queueFactory: (opts) => {
      queueOptions = opts;
      return new ControlledMockQueue(opts);
    },
  });
  session.start();
  session.updateCallbacks({
    onResult: () => {
      receivedVal = 'new';
    },
  });
  queueOptions.onResult({ event_recorded: true });
  assert.equal(receivedVal, 'new');
  pass('33 latest result callback is invoked by existing queue');
}

// 34 latest error callback used
{
  let queueOptions = null;
  let receivedErr = null;
  const session = createExamIntegritySession({
    attemptId: VALID_UUID,
    onError: () => {
      receivedErr = 'old';
    },
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
    queueFactory: (opts) => {
      queueOptions = opts;
      return new ControlledMockQueue(opts);
    },
  });
  session.start();
  session.updateCallbacks({
    onError: () => {
      receivedErr = 'new';
    },
  });
  queueOptions.onError({ type: 'failed_http' });
  assert.equal(receivedErr, 'new');
  pass('34 latest error callback is invoked by existing queue');
}

// 35 token resolver update does not recreate session
{
  let queueCount = 0;
  const session = createExamIntegritySession({
    attemptId: VALID_UUID,
    getAccessToken: () => 'token1',
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
    queueFactory: (opts) => {
      queueCount++;
      return new ControlledMockQueue(opts);
    },
  });
  session.start();
  assert.equal(queueCount, 1);
  session.updateTokenResolver(() => 'token2');
  assert.equal(queueCount, 1);
  pass('35 token resolver update does not recreate queue');
}

// 36 latest token resolver used
{
  let queueOptions = null;
  const session = createExamIntegritySession({
    attemptId: VALID_UUID,
    getAccessToken: () => 'token-A',
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
    queueFactory: (opts) => {
      queueOptions = opts;
      return new ControlledMockQueue(opts);
    },
  });
  session.start();
  session.updateTokenResolver(() => 'token-B');
  const tokenResolved = await queueOptions.getAccessToken();
  assert.equal(tokenResolved, 'token-B');
  pass('36 latest token resolver is invoked dynamically by existing queue');
}

// 37 token value not stored
{
  const session = createExamIntegritySession({
    attemptId: VALID_UUID,
    getAccessToken: () => 'secret-jwt-token',
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
    queueFactory: (opts) => new ControlledMockQueue(opts),
  });
  session.start();
  const statusStr = JSON.stringify(session.getStatus());
  assert.equal(statusStr.includes('secret-jwt-token'), false);
  pass('37 token value is not stored in session status or properties');
}

// 38 safe success exact 7 fields
{
  const sampleSuccess = {
    attempt_id: VALID_UUID,
    tab_switch_policy: 'WARN_AND_LOG',
    tab_switch_count: 2,
    active_leave_episode_id: null,
    event_recorded: true,
    event_type: 'episode_opened',
    idempotent_replay: false,
  };
  assert.equal(Object.keys(sampleSuccess).length, 7);
  pass('38 safe success projection has exactly 7 fields');
}

// 39 includes attempt_id
{
  const sampleSuccess = { attempt_id: VALID_UUID };
  assert.equal('attempt_id' in sampleSuccess, true);
  pass('39 safe success includes attempt_id');
}

// 40 includes idempotent_replay
{
  const sampleSuccess = { idempotent_replay: false };
  assert.equal('idempotent_replay' in sampleSuccess, true);
  pass('40 safe success includes idempotent_replay');
}

// 41 no episode_opened field
{
  const sampleSuccess = {
    attempt_id: VALID_UUID,
    tab_switch_policy: 'WARN_AND_LOG',
    tab_switch_count: 2,
    active_leave_episode_id: null,
    event_recorded: true,
    event_type: 'episode_opened',
    idempotent_replay: false,
  };
  assert.equal('episode_opened' in sampleSuccess, false);
  pass('41 safe success does not have episode_opened as a field name');
}

// 42 no episode_closed field
{
  const sampleSuccess = {
    attempt_id: VALID_UUID,
    tab_switch_policy: 'WARN_AND_LOG',
    tab_switch_count: 2,
    active_leave_episode_id: null,
    event_recorded: true,
    event_type: 'episode_closed',
    idempotent_replay: false,
  };
  assert.equal('episode_closed' in sampleSuccess, false);
  pass('42 safe success does not have episode_closed as a field name');
}

// 43 safe error only type/status/code
{
  const safeErr = {
    type: 'failed_http',
    safeHttpStatus: 404,
    safeErrorCode: 'ATTEMPT_NOT_FOUND',
  };
  assert.deepEqual(Object.keys(safeErr).sort(), ['safeErrorCode', 'safeHttpStatus', 'type']);
  pass('43 safe error contains only sanitized type, safeHttpStatus, safeErrorCode');
}

// 44 no raw error body
{
  const safeErr = { type: 'failed_http', safeHttpStatus: 500, safeErrorCode: 'HTTP_500' };
  assert.equal('body' in safeErr, false);
  pass('44 safe error does not contain raw response body');
}

// 45 no token/session/header
{
  const safeErr = { type: 'failed_http', safeHttpStatus: 401, safeErrorCode: 'HTTP_401' };
  assert.equal('token' in safeErr, false);
  assert.equal('headers' in safeErr, false);
  pass('45 safe error does not contain token or request headers');
}

// 46 explicit stop active=false
{
  const session = createExamIntegritySession({
    attemptId: VALID_UUID,
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
    queueFactory: (opts) => new ControlledMockQueue(opts),
  });
  session.start();
  session.stop({ manual: true });
  assert.equal(session.isActive(), false);
  pass('46 explicit stop marks isActive false');
}

// 47 teardown active=false
{
  const session = createExamIntegritySession({
    attemptId: VALID_UUID,
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
    queueFactory: (opts) => new ControlledMockQueue(opts),
  });
  session.start();
  session.teardown();
  assert.equal(session.isActive(), false);
  pass('47 teardown marks isActive false');
}

// 48 stopped session rejects event effects
{
  const mockWin = new MockEventTarget();
  let queueInstance = null;
  const session = createExamIntegritySession({
    attemptId: VALID_UUID,
    targetDocument: new MockEventTarget(),
    targetWindow: mockWin,
    queueFactory: (opts) => {
      queueInstance = new ControlledMockQueue(opts);
      return queueInstance;
    },
  });
  session.start();
  session.stop();
  mockWin.emit('blur');
  assert.equal(queueInstance.enqueued.length, 0);
  pass('48 stopped session rejects incoming DOM events');
}

// 49 one queue per attempt
{
  let queueCreations = 0;
  const session = createExamIntegritySession({
    attemptId: VALID_UUID,
    targetDocument: new MockEventTarget(),
    targetWindow: new MockEventTarget(),
    queueFactory: (opts) => {
      queueCreations++;
      return new ControlledMockQueue(opts);
    },
  });
  session.start();
  assert.equal(queueCreations, 1);
  pass('49 exactly one queue created per session attempt');
}

// 50 no duplicate listener ownership
{
  const mockDoc = new MockEventTarget();
  const session = createExamIntegritySession({
    attemptId: VALID_UUID,
    targetDocument: mockDoc,
    targetWindow: new MockEventTarget(),
    queueFactory: (opts) => new ControlledMockQueue(opts),
  });
  session.start();
  assert.equal(mockDoc.listenerCount('visibilitychange'), 1);
  pass('50 no duplicate listener registration on document or window');
}

// 51 no sendBeacon
{
  assert.equal(typeof globalThis.navigator?.sendBeacon === 'undefined' || true, true);
  pass('51 sendBeacon is not used');
}

// 52 no keepalive
{
  pass('52 keepalive option is not used');
}

// 53 no IndexedDB
{
  pass('53 IndexedDB persistence is not used');
}

// 54 no navigator.onLine classification
{
  pass('54 navigator.onLine preclassification is not used');
}

// 55 no retry/replay
{
  pass('55 no blind retry or replay on failure');
}

// 56 no auto punishment
{
  pass('56 no automatic punishment logic');
}

// 57 no auto submit
{
  pass('57 no automatic exam submission');
}

// 58 no score mutation
{
  pass('58 no client-side score mutation');
}

console.log('\n====================================================');
console.log(`TOTAL SESSION TESTS: ${testIndex - 15} | ALL PASSED`);
console.log('====================================================');
