// scripts/test_exam_integrity_lifecycle.mjs
// Phase 3D Production Lifecycle Adapter Unit Test Suite (15 Tests)
// Directly imports and executes src/services/examIntegrityLifecycle.js in Node.js

import assert from 'node:assert/strict';
import { createIntegrityLifecycle } from '../src/services/examIntegrityLifecycle.js';

let testIndex = 0;
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

class MockQueue {
  constructor() {
    this.enqueued = [];
  }
  enqueue(source) {
    this.enqueued.push(source);
    return true;
  }
}

console.log('====================================================');
console.log('EXAM BUILDER V1 - PHASE 3D LIFECYCLE ADAPTER TESTS');
console.log('====================================================\n');

// 01: attach visibility once
{
  const mockDoc = new MockEventTarget();
  const mockWin = new MockEventTarget();
  const queue = new MockQueue();
  const lifecycle = createIntegrityLifecycle({ queue, targetDocument: mockDoc, targetWindow: mockWin });

  lifecycle.attach();
  lifecycle.attach(); // idempotent
  assert.equal(mockDoc.listenerCount('visibilitychange'), 1);
  pass('01 attach visibility listener exactly once');
}

// 02: attach blur once
{
  const mockDoc = new MockEventTarget();
  const mockWin = new MockEventTarget();
  const queue = new MockQueue();
  const lifecycle = createIntegrityLifecycle({ queue, targetDocument: mockDoc, targetWindow: mockWin });

  lifecycle.attach();
  lifecycle.attach();
  assert.equal(mockWin.listenerCount('blur'), 1);
  pass('02 attach blur listener exactly once');
}

// 03: attach focus once
{
  const mockDoc = new MockEventTarget();
  const mockWin = new MockEventTarget();
  const queue = new MockQueue();
  const lifecycle = createIntegrityLifecycle({ queue, targetDocument: mockDoc, targetWindow: mockWin });

  lifecycle.attach();
  lifecycle.attach();
  assert.equal(mockWin.listenerCount('focus'), 1);
  pass('03 attach focus listener exactly once');
}

// 04: hidden mapping
{
  const mockDoc = new MockEventTarget();
  mockDoc.visibilityState = 'hidden';
  const mockWin = new MockEventTarget();
  const queue = new MockQueue();
  const lifecycle = createIntegrityLifecycle({ queue, targetDocument: mockDoc, targetWindow: mockWin });

  lifecycle.attach();
  mockDoc.emit('visibilitychange');
  assert.deepEqual(queue.enqueued, ['page_hidden']);
  pass('04 hidden maps to page_hidden');
}

// 05: visible mapping
{
  const mockDoc = new MockEventTarget();
  mockDoc.visibilityState = 'visible';
  const mockWin = new MockEventTarget();
  const queue = new MockQueue();
  const lifecycle = createIntegrityLifecycle({ queue, targetDocument: mockDoc, targetWindow: mockWin });

  lifecycle.attach();
  mockDoc.emit('visibilitychange');
  assert.deepEqual(queue.enqueued, ['page_visible']);
  pass('05 visible maps to page_visible');
}

// 06: blur mapping
{
  const mockDoc = new MockEventTarget();
  const mockWin = new MockEventTarget();
  const queue = new MockQueue();
  const lifecycle = createIntegrityLifecycle({ queue, targetDocument: mockDoc, targetWindow: mockWin });

  lifecycle.attach();
  mockWin.emit('blur');
  assert.deepEqual(queue.enqueued, ['window_blur']);
  pass('06 blur maps to window_blur');
}

// 07: focus mapping
{
  const mockDoc = new MockEventTarget();
  const mockWin = new MockEventTarget();
  const queue = new MockQueue();
  const lifecycle = createIntegrityLifecycle({ queue, targetDocument: mockDoc, targetWindow: mockWin });

  lifecycle.attach();
  mockWin.emit('focus');
  assert.deepEqual(queue.enqueued, ['window_focus']);
  pass('07 focus maps to window_focus');
}

// 08: no debounce
{
  const mockDoc = new MockEventTarget();
  const mockWin = new MockEventTarget();
  const queue = new MockQueue();
  const lifecycle = createIntegrityLifecycle({ queue, targetDocument: mockDoc, targetWindow: mockWin });

  lifecycle.attach();
  mockWin.emit('blur');
  // Immediately enqueued synchronously without timers
  assert.equal(queue.enqueued.length, 1);
  assert.equal(queue.enqueued[0], 'window_blur');
  pass('08 no debounce (immediate synchronous enqueue)');
}

// 09: no throttle
{
  const mockDoc = new MockEventTarget();
  const mockWin = new MockEventTarget();
  const queue = new MockQueue();
  const lifecycle = createIntegrityLifecycle({ queue, targetDocument: mockDoc, targetWindow: mockWin });

  lifecycle.attach();
  mockWin.emit('blur');
  mockWin.emit('blur');
  mockWin.emit('blur');
  assert.deepEqual(queue.enqueued, ['window_blur', 'window_blur', 'window_blur']);
  pass('09 no throttle (repeated events all preserved)');
}

// 10: fast blur-focus preserves both
{
  const mockDoc = new MockEventTarget();
  const mockWin = new MockEventTarget();
  const queue = new MockQueue();
  const lifecycle = createIntegrityLifecycle({ queue, targetDocument: mockDoc, targetWindow: mockWin });

  lifecycle.attach();
  mockWin.emit('blur');
  mockWin.emit('focus');
  assert.deepEqual(queue.enqueued, ['window_blur', 'window_focus']);
  pass('10 fast blur-focus preserves both in exact order');
}

// 11: no synthetic mount
{
  const mockDoc = new MockEventTarget();
  mockDoc.visibilityState = 'visible';
  const mockWin = new MockEventTarget();
  const queue = new MockQueue();
  const lifecycle = createIntegrityLifecycle({ queue, targetDocument: mockDoc, targetWindow: mockWin });

  lifecycle.attach();
  assert.equal(queue.enqueued.length, 0);
  pass('11 no synthetic mount event emitted on attach');
}

// 12: detach all
{
  const mockDoc = new MockEventTarget();
  mockDoc.visibilityState = 'hidden';
  const mockWin = new MockEventTarget();
  const queue = new MockQueue();
  const lifecycle = createIntegrityLifecycle({ queue, targetDocument: mockDoc, targetWindow: mockWin });

  lifecycle.attach();
  assert.equal(lifecycle.isAttached(), true);
  lifecycle.detach();
  assert.equal(lifecycle.isAttached(), false);

  mockDoc.emit('visibilitychange');
  mockWin.emit('blur');
  mockWin.emit('focus');

  assert.equal(queue.enqueued.length, 0);
  assert.equal(mockDoc.listenerCount('visibilitychange'), 0);
  assert.equal(mockWin.listenerCount('blur'), 0);
  assert.equal(mockWin.listenerCount('focus'), 0);
  pass('12 detach removes all listeners and suppresses subsequent events');
}

// 13: detach idempotent
{
  const mockDoc = new MockEventTarget();
  const mockWin = new MockEventTarget();
  const queue = new MockQueue();
  const lifecycle = createIntegrityLifecycle({ queue, targetDocument: mockDoc, targetWindow: mockWin });

  lifecycle.attach();
  lifecycle.detach();
  lifecycle.detach(); // duplicate detach is safe
  assert.equal(lifecycle.isAttached(), false);
  pass('13 detach is idempotent');
}

// 14: no fullscreen
{
  const mockDoc = new MockEventTarget();
  const mockWin = new MockEventTarget();
  const queue = new MockQueue();
  const lifecycle = createIntegrityLifecycle({ queue, targetDocument: mockDoc, targetWindow: mockWin });

  lifecycle.attach();
  assert.equal(mockDoc.listenerCount('fullscreenchange'), 0);
  assert.equal(mockWin.listenerCount('fullscreenchange'), 0);
  pass('14 no fullscreenchange listener registered');
}

// 15: no online/offline
{
  const mockDoc = new MockEventTarget();
  const mockWin = new MockEventTarget();
  const queue = new MockQueue();
  const lifecycle = createIntegrityLifecycle({ queue, targetDocument: mockDoc, targetWindow: mockWin });

  lifecycle.attach();
  assert.equal(mockWin.listenerCount('online'), 0);
  assert.equal(mockWin.listenerCount('offline'), 0);
  pass('15 no online/offline listener registered');
}

console.log('\n====================================================');
console.log(`TOTAL LIFECYCLE TESTS: ${testIndex} | ALL PASSED`);
console.log('====================================================');
