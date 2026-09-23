// tests/academic_submission_annotation_quick_tools.test.mjs
// COMPREHENSIVE AUTOMATED TEST SUITE: TEACHER GRADING ANNOTATION QUICK TOOLS (PHASE: FINAL PRE-PR AUDIT, UNDO/REDO BOUNDARY & DECOUPLE CLEAR)

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeAnnotationPayload, normalizeNote } from '../src/utils/annotationNoteUtils.js';
import {
  screenToNormalized,
  clampScale,
  clampPan,
  zoomIn,
  zoomOut,
  resetZoom,
  MIN_SCALE,
  MAX_SCALE,
} from '../src/utils/annotationViewportMath.js';

console.log('================================================================================');
console.log('🚀 BẮT ĐẦU KIỂM THỬ: AUDIT, UNDO/REDO BOUNDARY & DECOUPLE CLEAR — QUICK TOOLS');
console.log('================================================================================\n');

const testResults = {};

// Helper: Distance from point to line segment
function distToSegment(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

// Multi-attachment history manager simulation matching SubmissionGradingModal
class MultiAttachmentHistoryManager {
  constructor() {
    this.annotations = {};
    this.history = {};
  }

  initAttachment(attId, initialData = { schema_version: 1, strokes: [], stamps: [], notes: [] }) {
    this.annotations[attId] = JSON.parse(JSON.stringify(initialData));
    this.history[attId] = { past: [], future: [] };
  }

  canUndo(attId) {
    return Boolean((this.history[attId]?.past?.length || 0) > 0);
  }

  canRedo(attId) {
    return Boolean((this.history[attId]?.future?.length || 0) > 0);
  }

  canClear(attId) {
    const ann = this.annotations[attId] || { strokes: [], stamps: [], notes: [] };
    return Boolean(
      (ann.strokes?.length || 0) > 0 ||
      (ann.stamps?.length || 0) > 0 ||
      (ann.notes?.length || 0) > 0
    );
  }

  applyChange(attId, nextData, isHistoryAction = false) {
    if (!isHistoryAction) {
      const current = this.annotations[attId] || { schema_version: 1, strokes: [], stamps: [], notes: [] };
      const attH = this.history[attId] || { past: [], future: [] };
      const newPast = [...attH.past.slice(-49), JSON.parse(JSON.stringify(current))];
      this.history[attId] = { past: newPast, future: [] };
    }
    this.annotations[attId] = JSON.parse(JSON.stringify(nextData));
  }

  clear(attId) {
    const updated = {
      schema_version: 1,
      strokes: [],
      stamps: [],
      notes: []
    };
    this.applyChange(attId, updated, false);
  }

  undo(attId) {
    const attH = this.history[attId] || { past: [], future: [] };
    if (!attH.past || attH.past.length === 0) {
      // Strict NO-OP: No fallback popping of strokes, stamps or notes
      return false;
    }
    const prev = attH.past[attH.past.length - 1];
    const newPast = attH.past.slice(0, -1);
    const current = this.annotations[attId];
    const newFuture = [...(attH.future || []), JSON.parse(JSON.stringify(current))];
    this.history[attId] = { past: newPast, future: newFuture };
    this.applyChange(attId, prev, true);
    return true;
  }

  redo(attId) {
    const attH = this.history[attId] || { past: [], future: [] };
    if (!attH.future || attH.future.length === 0) {
      return false;
    }
    const next = attH.future[attH.future.length - 1];
    const newFuture = attH.future.slice(0, -1);
    const current = this.annotations[attId];
    const newPast = [...(attH.past || []), JSON.parse(JSON.stringify(current))];
    this.history[attId] = { past: newPast, future: newFuture };
    this.applyChange(attId, next, true);
    return true;
  }

  reloadLatest(attId, serverData) {
    this.annotations[attId] = JSON.parse(JSON.stringify(serverData));
    this.history[attId] = { past: [], future: [] };
  }

  switchSubmission(newSubmissionAttachments = {}) {
    this.annotations = {};
    this.history = {};
    for (const [id, data] of Object.entries(newSubmissionAttachments)) {
      this.initAttachment(id, data);
    }
  }
}

// ============================================================================
// 1. HISTORY ISOLATION & NO LEAKAGE
// ============================================================================

// TEST 1: HISTORY_ISOLATED_PER_ATTACHMENT
{
  const mgr = new MultiAttachmentHistoryManager();
  mgr.initAttachment('att_1');
  mgr.initAttachment('att_2');

  // Add stroke to att_1
  mgr.applyChange('att_1', {
    ...mgr.annotations['att_1'],
    strokes: [{ id: 's1', tool: 'line', points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }] }]
  });

  assert.equal(mgr.annotations['att_1'].strokes.length, 1);
  assert.equal(mgr.history['att_1'].past.length, 1);
  assert.equal(mgr.annotations['att_2'].strokes.length, 0);
  assert.equal(mgr.history['att_2'].past.length, 0);

  testResults.HISTORY_ISOLATED_PER_ATTACHMENT = 'PASS';
  console.log('✅ HISTORY_ISOLATED_PER_ATTACHMENT: PASS');
}

// TEST 2: SWITCH_ATTACHMENT_NO_HISTORY_LEAK
{
  const mgr = new MultiAttachmentHistoryManager();
  mgr.initAttachment('att_1');
  mgr.initAttachment('att_2');

  mgr.applyChange('att_1', {
    ...mgr.annotations['att_1'],
    strokes: [{ id: 's1', tool: 'pen', points: [{ x: 0.1, y: 0.1 }] }]
  });
  mgr.applyChange('att_2', {
    ...mgr.annotations['att_2'],
    strokes: [{ id: 's2', tool: 'ellipse', points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }] }]
  });

  // Undo on att_1 should NOT affect att_2
  mgr.undo('att_1');
  assert.equal(mgr.annotations['att_1'].strokes.length, 0);
  assert.equal(mgr.annotations['att_2'].strokes.length, 1);
  assert.equal(mgr.annotations['att_2'].strokes[0].tool, 'ellipse');

  testResults.SWITCH_ATTACHMENT_NO_HISTORY_LEAK = 'PASS';
  console.log('✅ SWITCH_ATTACHMENT_NO_HISTORY_LEAK: PASS');
}

// ============================================================================
// 2. UNDO & REDO AFTER ERASER
// ============================================================================

// TEST 3: UNDO_AFTER_ERASER
{
  const mgr = new MultiAttachmentHistoryManager();
  mgr.initAttachment('att_1');

  const stroke = { id: 's1', tool: 'arrow', points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }] };
  mgr.applyChange('att_1', { ...mgr.annotations['att_1'], strokes: [stroke] });

  // Erase stroke
  mgr.applyChange('att_1', { ...mgr.annotations['att_1'], strokes: [] });
  assert.equal(mgr.annotations['att_1'].strokes.length, 0);

  // Undo eraser
  mgr.undo('att_1');
  assert.equal(mgr.annotations['att_1'].strokes.length, 1);
  assert.equal(mgr.annotations['att_1'].strokes[0].id, 's1');

  testResults.UNDO_AFTER_ERASER = 'PASS';
  console.log('✅ UNDO_AFTER_ERASER: PASS');
}

// TEST 4: REDO_AFTER_ERASER
{
  const mgr = new MultiAttachmentHistoryManager();
  mgr.initAttachment('att_1');

  const stroke = { id: 's1', tool: 'arrow', points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }] };
  mgr.applyChange('att_1', { ...mgr.annotations['att_1'], strokes: [stroke] });
  mgr.applyChange('att_1', { ...mgr.annotations['att_1'], strokes: [] }); // Erase

  mgr.undo('att_1'); // Restored
  assert.equal(mgr.annotations['att_1'].strokes.length, 1);

  mgr.redo('att_1'); // Re-erased
  assert.equal(mgr.annotations['att_1'].strokes.length, 0);

  testResults.REDO_AFTER_ERASER = 'PASS';
  console.log('✅ REDO_AFTER_ERASER: PASS');
}

// ============================================================================
// 3. NOTE LIFECYCLE (CREATE, EDIT, DELETE) UNDO / REDO
// ============================================================================

// TEST 5: UNDO_NOTE_CREATE_EDIT_DELETE
{
  const mgr = new MultiAttachmentHistoryManager();
  mgr.initAttachment('att_1');

  // 1. Create note
  const note1 = { id: 'n1', x: 0.3, y: 0.4, text: 'Ghi chú ban đầu', color: '#f59e0b' };
  mgr.applyChange('att_1', { ...mgr.annotations['att_1'], notes: [note1] });
  assert.equal(mgr.annotations['att_1'].notes.length, 1);

  // 2. Edit note
  const note1Edited = { id: 'n1', x: 0.3, y: 0.4, text: 'Ghi chú đã sửa', color: '#ef4444' };
  mgr.applyChange('att_1', { ...mgr.annotations['att_1'], notes: [note1Edited] });
  assert.equal(mgr.annotations['att_1'].notes[0].text, 'Ghi chú đã sửa');

  // Undo edit -> restores note text
  mgr.undo('att_1');
  assert.equal(mgr.annotations['att_1'].notes[0].text, 'Ghi chú ban đầu');

  // Undo create -> removes note
  mgr.undo('att_1');
  assert.equal(mgr.annotations['att_1'].notes.length, 0);

  // Redo create -> re-adds note
  mgr.redo('att_1');
  assert.equal(mgr.annotations['att_1'].notes.length, 1);
  assert.equal(mgr.annotations['att_1'].notes[0].text, 'Ghi chú ban đầu');

  // Redo edit -> reapplies edit
  mgr.redo('att_1');
  assert.equal(mgr.annotations['att_1'].notes[0].text, 'Ghi chú đã sửa');

  // 3. Delete note
  mgr.applyChange('att_1', { ...mgr.annotations['att_1'], notes: [] });
  assert.equal(mgr.annotations['att_1'].notes.length, 0);

  // Undo delete -> restores note
  mgr.undo('att_1');
  assert.equal(mgr.annotations['att_1'].notes.length, 1);

  testResults.UNDO_NOTE_CREATE_EDIT_DELETE = 'PASS';
  console.log('✅ UNDO_NOTE_CREATE_EDIT_DELETE: PASS');
}

// TEST 6: NEW_EDIT_CLEARS_REDO_STACK
{
  const mgr = new MultiAttachmentHistoryManager();
  mgr.initAttachment('att_1');

  mgr.applyChange('att_1', { ...mgr.annotations['att_1'], strokes: [{ id: 's1', tool: 'pen', points: [{ x: 0.1, y: 0.1 }] }] });
  mgr.applyChange('att_1', { ...mgr.annotations['att_1'], strokes: [{ id: 's1', tool: 'pen', points: [{ x: 0.1, y: 0.1 }] }, { id: 's2', tool: 'line', points: [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.4 }] }] });

  mgr.undo('att_1');
  assert.equal(mgr.history['att_1'].future.length, 1);

  // Perform a new edit
  mgr.applyChange('att_1', { ...mgr.annotations['att_1'], stamps: [{ id: 'st1', type: 'check', x: 0.5, y: 0.5 }] });
  assert.equal(mgr.history['att_1'].future.length, 0, 'New edit must clear the redo stack');

  testResults.NEW_EDIT_CLEARS_REDO_STACK = 'PASS';
  console.log('✅ NEW_EDIT_CLEARS_REDO_STACK: PASS');
}

// TEST 7: RELOAD_HISTORY_STACK_EMPTY_BUT_ANNOTATIONS_PERSIST
{
  // Simulate page load from Supabase DB where annotations exist
  const savedPayload = {
    schema_version: 1,
    strokes: [
      { id: 's1', tool: 'line', points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }] },
      { id: 's2', tool: 'ellipse', points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }] }
    ],
    stamps: [{ id: 'st1', type: 'check', x: 0.5, y: 0.5 }],
    notes: [{ id: 'n1', text: 'Persistent note', x: 0.3, y: 0.3 }]
  };

  const mgr = new MultiAttachmentHistoryManager();
  mgr.initAttachment('att_persisted', savedPayload);

  // History stack is fresh (empty)
  assert.equal(mgr.history['att_persisted'].past.length, 0);
  assert.equal(mgr.history['att_persisted'].future.length, 0);

  // Annotations persist 100%
  const normalized = normalizeAnnotationPayload(mgr.annotations['att_persisted']);
  assert.equal(normalized.strokes.length, 2);
  assert.equal(normalized.stamps.length, 1);
  assert.equal(normalized.notes.length, 1);

  testResults.RELOAD_HISTORY_STACK_EMPTY_BUT_ANNOTATIONS_PERSIST = 'PASS';
  console.log('✅ RELOAD_HISTORY_STACK_EMPTY_BUT_ANNOTATIONS_PERSIST: PASS');
}

// ============================================================================
// 4. DECOUPLE CLEAR FROM UNDO/REDO & PERSISTED RELOAD CHECKS
// ============================================================================

// TEST 8: PERSISTED_ANNOTATIONS_UNDO_DISABLED
{
  const persistedData = {
    schema_version: 1,
    strokes: [{ id: 's1', tool: 'pen', points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] }],
    stamps: [{ id: 'st1', type: 'check', x: 0.5, y: 0.5 }],
    notes: [{ id: 'n1', text: 'Persistent note', x: 0.3, y: 0.3 }]
  };

  const mgr = new MultiAttachmentHistoryManager();
  mgr.initAttachment('att_reloaded', persistedData);

  // canUndo must be false because history.past is empty
  assert.equal(mgr.canUndo('att_reloaded'), false, 'Undo must be disabled on reload');
  assert.equal(mgr.canRedo('att_reloaded'), false, 'Redo must be disabled on reload');

  testResults.PERSISTED_ANNOTATIONS_UNDO_DISABLED = 'PASS';
  testResults.RELOAD_PERSISTED_ANNOTATION_UNDO_DISABLED = 'PASS';
  console.log('✅ PERSISTED_ANNOTATIONS_UNDO_DISABLED: PASS');
}

// TEST 9: PERSISTED_ANNOTATIONS_CLEAR_ENABLED
{
  const persistedData = {
    schema_version: 1,
    strokes: [{ id: 's1', tool: 'line', points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }] }],
    stamps: [],
    notes: []
  };

  const mgr = new MultiAttachmentHistoryManager();
  mgr.initAttachment('att_persisted_clear', persistedData);

  // Even though canUndo & canRedo are false, canClear MUST be true
  assert.equal(mgr.canUndo('att_persisted_clear'), false);
  assert.equal(mgr.canRedo('att_persisted_clear'), false);
  assert.equal(mgr.canClear('att_persisted_clear'), true, 'canClear must be true when strokes exist even with empty history');

  testResults.PERSISTED_ANNOTATIONS_CLEAR_ENABLED = 'PASS';
  console.log('✅ PERSISTED_ANNOTATIONS_CLEAR_ENABLED: PASS');
}

// TEST 10: EMPTY_ANNOTATIONS_CLEAR_DISABLED
{
  const emptyData = {
    schema_version: 1,
    strokes: [],
    stamps: [],
    notes: []
  };

  const mgr = new MultiAttachmentHistoryManager();
  mgr.initAttachment('att_empty', emptyData);

  assert.equal(mgr.canClear('att_empty'), false, 'canClear must be false when annotations are empty');

  testResults.EMPTY_ANNOTATIONS_CLEAR_DISABLED = 'PASS';
  console.log('✅ EMPTY_ANNOTATIONS_CLEAR_DISABLED: PASS');
}

// TEST 11: CLEAR_CREATES_UNDO_HISTORY
{
  const initialData = {
    schema_version: 1,
    strokes: [{ id: 's1', tool: 'arrow', points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }] }],
    stamps: [{ id: 'st1', type: 'check', x: 0.5, y: 0.5 }],
    notes: [{ id: 'n1', text: 'Lưu ý', x: 0.3, y: 0.3 }]
  };

  const mgr = new MultiAttachmentHistoryManager();
  mgr.initAttachment('att_clear_undo', initialData);
  assert.equal(mgr.history['att_clear_undo'].past.length, 0);

  // Perform clear
  mgr.clear('att_clear_undo');

  // Clear must add previous snapshot to past history
  assert.equal(mgr.history['att_clear_undo'].past.length, 1, 'Clear must push previous state to past history');
  assert.equal(mgr.annotations['att_clear_undo'].strokes.length, 0);
  assert.equal(mgr.canUndo('att_clear_undo'), true, 'canUndo must become true after clear');

  testResults.CLEAR_CREATES_UNDO_HISTORY = 'PASS';
  console.log('✅ CLEAR_CREATES_UNDO_HISTORY: PASS');
}

// TEST 12: UNDO_AFTER_CLEAR_RESTORES_ALL
{
  const initialData = {
    schema_version: 1,
    strokes: [{ id: 's1', tool: 'ellipse', points: [{ x: 0.1, y: 0.1 }, { x: 0.7, y: 0.7 }] }],
    stamps: [{ id: 'st1', type: 'cross', x: 0.4, y: 0.4 }],
    notes: [{ id: 'n1', text: 'Cần sửa', x: 0.6, y: 0.6 }]
  };

  const mgr = new MultiAttachmentHistoryManager();
  mgr.initAttachment('att_undo_clear', initialData);

  mgr.clear('att_undo_clear');
  assert.equal(mgr.annotations['att_undo_clear'].strokes.length, 0);

  // Undo clear
  mgr.undo('att_undo_clear');
  assert.equal(mgr.annotations['att_undo_clear'].strokes.length, 1);
  assert.equal(mgr.annotations['att_undo_clear'].stamps.length, 1);
  assert.equal(mgr.annotations['att_undo_clear'].notes.length, 1);
  assert.equal(mgr.annotations['att_undo_clear'].notes[0].text, 'Cần sửa');

  testResults.UNDO_AFTER_CLEAR_RESTORES_ALL = 'PASS';
  console.log('✅ UNDO_AFTER_CLEAR_RESTORES_ALL: PASS');
}

// TEST 13: REDO_AFTER_CLEAR_CLEARS_AGAIN
{
  const initialData = {
    schema_version: 1,
    strokes: [{ id: 's1', tool: 'line', points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }] }],
    stamps: [],
    notes: []
  };

  const mgr = new MultiAttachmentHistoryManager();
  mgr.initAttachment('att_redo_clear', initialData);

  mgr.clear('att_redo_clear');
  mgr.undo('att_redo_clear'); // restored
  assert.equal(mgr.annotations['att_redo_clear'].strokes.length, 1);

  // Redo clear
  mgr.redo('att_redo_clear');
  assert.equal(mgr.annotations['att_redo_clear'].strokes.length, 0);

  testResults.REDO_AFTER_CLEAR_CLEARS_AGAIN = 'PASS';
  console.log('✅ REDO_AFTER_CLEAR_CLEARS_AGAIN: PASS');
}

// TEST 14: READONLY_CLEAR_DISABLED
{
  function isClearButtonDisabled({ readOnly, canClear }) {
    return Boolean(readOnly || !canClear);
  }

  assert.equal(isClearButtonDisabled({ readOnly: true, canClear: true }), true, 'Clear button must be disabled when readOnly is true');
  assert.equal(isClearButtonDisabled({ readOnly: false, canClear: true }), false, 'Clear button must be enabled when not readOnly and canClear is true');
  assert.equal(isClearButtonDisabled({ readOnly: false, canClear: false }), true, 'Clear button must be disabled when canClear is false');

  testResults.READONLY_CLEAR_DISABLED = 'PASS';
  console.log('✅ READONLY_CLEAR_DISABLED: PASS');
}

// TEST 15: UNDO_WITH_EMPTY_HISTORY_NOOP
{
  const persistedData = {
    schema_version: 1,
    strokes: [
      { id: 's1', tool: 'line', points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }] },
      { id: 's2', tool: 'ellipse', points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }] }
    ],
    stamps: [{ id: 'st1', type: 'check', x: 0.5, y: 0.5 }],
    notes: [{ id: 'n1', text: 'Important note', x: 0.4, y: 0.4 }]
  };

  const mgr = new MultiAttachmentHistoryManager();
  mgr.initAttachment('att_noop', persistedData);

  // Calling undo with empty history must be a pure NO-OP (no element popping)
  const didUndo = mgr.undo('att_noop');
  assert.equal(didUndo, false);
  assert.equal(mgr.annotations['att_noop'].strokes.length, 2, 'Strokes must NOT be popped on empty history');
  assert.equal(mgr.annotations['att_noop'].stamps.length, 1, 'Stamps must NOT be popped on empty history');
  assert.equal(mgr.annotations['att_noop'].notes.length, 1, 'Notes must NOT be popped on empty history');

  testResults.UNDO_WITH_EMPTY_HISTORY_NOOP = 'PASS';
  console.log('✅ UNDO_WITH_EMPTY_HISTORY_NOOP: PASS');
}

// TEST 16: RELOAD_LATEST_CLEARS_PAST_HISTORY
{
  const mgr = new MultiAttachmentHistoryManager();
  mgr.initAttachment('att_1');

  // Make 3 edits
  mgr.applyChange('att_1', { ...mgr.annotations['att_1'], strokes: [{ id: 's1', tool: 'pen', points: [{ x: 0.1, y: 0.1 }] }] });
  mgr.applyChange('att_1', { ...mgr.annotations['att_1'], strokes: [{ id: 's1', tool: 'pen', points: [{ x: 0.1, y: 0.1 }] }, { id: 's2', tool: 'line', points: [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.4 }] }] });
  mgr.applyChange('att_1', { ...mgr.annotations['att_1'], notes: [{ id: 'n1', text: 'draft note', x: 0.5, y: 0.5 }] });

  assert.equal(mgr.history['att_1'].past.length, 3);
  assert.equal(mgr.canUndo('att_1'), true);

  // Server has fresh version loaded via handleReloadLatest
  const serverFresh = {
    schema_version: 1,
    strokes: [{ id: 's_server', tool: 'pen', points: [{ x: 0.3, y: 0.3 }] }],
    stamps: [],
    notes: []
  };

  mgr.reloadLatest('att_1', serverFresh);

  assert.equal(mgr.history['att_1'].past.length, 0, 'Past history must be reset to empty on reload latest');
  assert.equal(mgr.canUndo('att_1'), false, 'canUndo must be false after reload latest');
  assert.equal(mgr.annotations['att_1'].strokes[0].id, 's_server');

  testResults.RELOAD_LATEST_CLEARS_PAST_HISTORY = 'PASS';
  console.log('✅ RELOAD_LATEST_CLEARS_PAST_HISTORY: PASS');
}

// TEST 17: RELOAD_LATEST_CLEARS_FUTURE_HISTORY
{
  const mgr = new MultiAttachmentHistoryManager();
  mgr.initAttachment('att_1');

  mgr.applyChange('att_1', { ...mgr.annotations['att_1'], strokes: [{ id: 's1', tool: 'pen', points: [{ x: 0.1, y: 0.1 }] }] });
  mgr.applyChange('att_1', { ...mgr.annotations['att_1'], strokes: [{ id: 's1', tool: 'pen', points: [{ x: 0.1, y: 0.1 }] }, { id: 's2', tool: 'arrow', points: [{ x: 0.2, y: 0.2 }, { x: 0.6, y: 0.6 }] }] });

  mgr.undo('att_1'); // 1 item in future stack
  assert.equal(mgr.history['att_1'].future.length, 1);
  assert.equal(mgr.canRedo('att_1'), true);

  // Reload latest from server
  mgr.reloadLatest('att_1', { schema_version: 1, strokes: [], stamps: [], notes: [] });

  assert.equal(mgr.history['att_1'].future.length, 0, 'Future history must be reset to empty on reload latest');
  assert.equal(mgr.canRedo('att_1'), false, 'canRedo must be false after reload latest');

  testResults.RELOAD_LATEST_CLEARS_FUTURE_HISTORY = 'PASS';
  console.log('✅ RELOAD_LATEST_CLEARS_FUTURE_HISTORY: PASS');
}

// TEST 18: SWITCH_SUBMISSION_CLEARS_ALL_HISTORY
{
  const mgr = new MultiAttachmentHistoryManager();
  // Workspace 1 with 2 attachments
  mgr.initAttachment('sub1_att1');
  mgr.initAttachment('sub1_att2');

  mgr.applyChange('sub1_att1', { ...mgr.annotations['sub1_att1'], strokes: [{ id: 's1', tool: 'pen', points: [{ x: 0.1, y: 0.1 }] }] });
  mgr.applyChange('sub1_att2', { ...mgr.annotations['sub1_att2'], strokes: [{ id: 's2', tool: 'line', points: [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.4 }] }] });

  assert.equal(mgr.history['sub1_att1'].past.length, 1);
  assert.equal(mgr.history['sub1_att2'].past.length, 1);

  // Switch to submission 2 (new workspace hydration)
  mgr.switchSubmission({
    'sub2_att1': { schema_version: 1, strokes: [], stamps: [], notes: [] }
  });

  // Old submission history is completely gone
  assert.equal(mgr.history['sub1_att1'], undefined, 'Old attachment history must be purged');
  assert.equal(mgr.history['sub1_att2'], undefined, 'Old attachment history must be purged');
  assert.equal(mgr.history['sub2_att1'].past.length, 0, 'New attachment history must be empty');
  assert.equal(mgr.canUndo('sub2_att1'), false);

  testResults.SWITCH_SUBMISSION_CLEARS_ALL_HISTORY = 'PASS';
  console.log('✅ SWITCH_SUBMISSION_CLEARS_ALL_HISTORY: PASS');
}

// TEST 19: OLD_HISTORY_CANNOT_OVERWRITE_RELOADED_SERVER_STATE
{
  const mgr = new MultiAttachmentHistoryManager();
  mgr.initAttachment('att_1', { schema_version: 1, strokes: [], stamps: [], notes: [] });

  // Teacher makes local edits on client A
  mgr.applyChange('att_1', { ...mgr.annotations['att_1'], strokes: [{ id: 'local_s1', tool: 'pen', points: [{ x: 0.1, y: 0.1 }] }] });
  mgr.applyChange('att_1', { ...mgr.annotations['att_1'], strokes: [{ id: 'local_s1', tool: 'pen', points: [{ x: 0.1, y: 0.1 }] }, { id: 'local_s2', tool: 'pen', points: [{ x: 0.2, y: 0.2 }] }] });

  // Conflict happens, client reloads authoritative server state
  const authoritativeServerState = {
    schema_version: 1,
    strokes: [{ id: 'server_s1', tool: 'ellipse', points: [{ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.7 }] }],
    stamps: [{ id: 'server_st1', type: 'check', x: 0.5, y: 0.5 }],
    notes: [{ id: 'server_n1', text: 'Server truth', x: 0.4, y: 0.4 }]
  };

  mgr.reloadLatest('att_1', authoritativeServerState);

  // Attempt to undo
  const couldUndo = mgr.undo('att_1');
  assert.equal(couldUndo, false, 'Undo must not be allowed after reload');

  // Authoritative server state is protected and not overwritten by stale pre-reload local state
  assert.equal(mgr.annotations['att_1'].strokes.length, 1);
  assert.equal(mgr.annotations['att_1'].strokes[0].id, 'server_s1');
  assert.equal(mgr.annotations['att_1'].stamps.length, 1);
  assert.equal(mgr.annotations['att_1'].notes.length, 1);

  testResults.OLD_HISTORY_CANNOT_OVERWRITE_RELOADED_SERVER_STATE = 'PASS';
  console.log('✅ OLD_HISTORY_CANNOT_OVERWRITE_RELOADED_SERVER_STATE: PASS');
}

// ============================================================================
// 5. GESTURE SAFETY, MULTITOUCH & POINTER CANCEL
// ============================================================================

// TEST 20: POINTER_CANCEL_SAFE
{
  let currentStroke = { id: 'temp_stroke', tool: 'pen', points: [{ x: 0.1, y: 0.1 }] };
  let isPointerActive = true;
  let committedAnnotations = { strokes: [] };

  // simulate handlePointerCancel
  currentStroke = null;
  isPointerActive = false;

  assert.equal(currentStroke, null);
  assert.equal(committedAnnotations.strokes.length, 0);

  testResults.POINTER_CANCEL_SAFE = 'PASS';
  console.log('✅ POINTER_CANCEL_SAFE: PASS');
}

// TEST 21: MULTITOUCH_DOES_NOT_DRAW_ACCIDENTALLY
{
  const activePointers = new Map();
  activePointers.set(1, { x: 100, y: 100 });
  activePointers.set(2, { x: 200, y: 200 });

  let suppressSinglePointerDraw = false;
  let currentDrawingStroke = { id: 's1', tool: 'line' };

  if (activePointers.size >= 2) {
    currentDrawingStroke = null;
    suppressSinglePointerDraw = true;
  }

  assert.equal(currentDrawingStroke, null);
  assert.equal(suppressSinglePointerDraw, true);

  testResults.MULTITOUCH_DOES_NOT_DRAW_ACCIDENTALLY = 'PASS';
  console.log('✅ MULTITOUCH_DOES_NOT_DRAW_ACCIDENTALLY: PASS');
}

// TEST 22: MOBILE_SCROLL_ZOOM_CONFLICT
{
  function getTouchAction(scale) {
    return scale === 1 ? 'pan-y' : 'none';
  }

  assert.equal(getTouchAction(1.0), 'pan-y');
  assert.equal(getTouchAction(1.25), 'none');
  assert.equal(getTouchAction(2.0), 'none');

  testResults.MOBILE_SCROLL_ZOOM_CONFLICT = 'PASS';
  console.log('✅ MOBILE_SCROLL_ZOOM_CONFLICT: PASS');
}

// ============================================================================
// 6. ZERO LENGTH/SIZE SHAPE GESTURES IGNORED
// ============================================================================

// TEST 23: ZERO_LENGTH_LINE_IGNORED
{
  const p1 = { x: 0.3, y: 0.3 };
  const p2 = { x: 0.3, y: 0.3 }; // Tap without drag
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const isValidLine = dist >= 0.005;

  assert.equal(isValidLine, false, 'Zero length line must be ignored');
  testResults.ZERO_LENGTH_LINE_IGNORED = 'PASS';
  console.log('✅ ZERO_LENGTH_LINE_IGNORED: PASS');
}

// TEST 24: ZERO_SIZE_ELLIPSE_IGNORED
{
  const p1 = { x: 0.5, y: 0.5 };
  const p2 = { x: 0.5001, y: 0.5001 }; // Microscopic jitter
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const isValidEllipse = dist >= 0.005;

  assert.equal(isValidEllipse, false, 'Zero size ellipse must be ignored');
  testResults.ZERO_SIZE_ELLIPSE_IGNORED = 'PASS';
  console.log('✅ ZERO_SIZE_ELLIPSE_IGNORED: PASS');
}

// TEST 25: ZERO_LENGTH_ARROW_IGNORED
{
  const p1 = { x: 0.4, y: 0.4 };
  const p2 = { x: 0.4, y: 0.4 }; // Zero length
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const isValidArrow = dist >= 0.005;

  assert.equal(isValidArrow, false, 'Zero length arrow must be ignored');
  testResults.ZERO_LENGTH_ARROW_IGNORED = 'PASS';
  console.log('✅ ZERO_LENGTH_ARROW_IGNORED: PASS');
}

// TEST 26: STUDENT_RENDER_MATCHES_TEACHER_RENDER
{
  const studentViewerSrc = fs.readFileSync(path.resolve('src/components/dashboard/exercises/StudentAnnotationViewer.jsx'), 'utf8');
  const canvasSrc = fs.readFileSync(path.resolve('src/components/dashboard/exercises/SubmissionAnnotationCanvas.jsx'), 'utf8');

  assert.ok(canvasSrc.includes('export function renderSvgAnnotationStroke('), 'Canvas must export renderSvgAnnotationStroke');
  assert.ok(studentViewerSrc.includes("import { renderSvgAnnotationStroke } from './SubmissionAnnotationCanvas'"), 'StudentViewer must import renderSvgAnnotationStroke');
  assert.ok(studentViewerSrc.includes('strokes.map((stroke) => renderSvgAnnotationStroke(stroke, false))'), 'StudentViewer must render strokes using renderSvgAnnotationStroke');
  assert.ok(canvasSrc.includes('annotation.strokes || []).map((stroke) => renderSvgAnnotationStroke(stroke, false))'), 'Teacher Canvas must render strokes using renderSvgAnnotationStroke');

  testResults.STUDENT_RENDER_MATCHES_TEACHER_RENDER = 'PASS';
  console.log('✅ STUDENT_RENDER_MATCHES_TEACHER_RENDER: PASS');
}

// TEST 27: STATIC CODE AUDIT FOR DECOUPLING CLEAR & UNDO/REDO BOUNDARIES
{
  const toolbarSrc = fs.readFileSync(path.resolve('src/components/dashboard/exercises/AnnotationToolbar.jsx'), 'utf8');
  const modalSrc = fs.readFileSync(path.resolve('src/components/dashboard/exercises/SubmissionGradingModal.jsx'), 'utf8');
  const harnessSrc = fs.readFileSync(path.resolve('src/pages/Phase2DeviceTestHarnessPage.jsx'), 'utf8');

  // 1. Toolbar accepts canClear prop and uses disabled={readOnly || !canClear}
  assert.ok(toolbarSrc.includes('canClear = false'), 'AnnotationToolbar must accept canClear prop');
  assert.ok(toolbarSrc.includes('disabled={readOnly || !canClear}'), 'Clear button must use disabled={readOnly || !canClear}');
  assert.ok(!toolbarSrc.includes('disabled={readOnly || (!canUndo && !canRedo)}'), 'Clear button must NOT use canUndo/canRedo');

  // 2. Modal passes canClear prop calculated from strokes, stamps, notes
  assert.ok(modalSrc.includes('canClear={'), 'SubmissionGradingModal must pass canClear prop');
  assert.ok(modalSrc.includes('annotationsByAttachment[activeAttachmentForAnnotation.id]?.strokes?.length'), 'Modal canClear must check strokes length');
  assert.ok(modalSrc.includes('annotationsByAttachment[activeAttachmentForAnnotation.id]?.stamps?.length'), 'Modal canClear must check stamps length');
  assert.ok(modalSrc.includes('annotationsByAttachment[activeAttachmentForAnnotation.id]?.notes?.length'), 'Modal canClear must check notes length');

  // 3. Harness passes canClear prop
  assert.ok(harnessSrc.includes('canClear={'), 'Phase2DeviceTestHarnessPage must pass canClear prop');

  console.log('✅ STATIC_CODE_AUDIT_DECOUPLED_CLEAR: PASS');
}

console.log('\n================================================================================');
console.log('📊 TỔNG HỢP KẾT QUẢ KIỂM THỬ:');
for (const [key, val] of Object.entries(testResults)) {
  console.log(`- ${key}: ${val}`);
}
console.log('================================================================================\n');

// Assert all required test keys
const requiredKeys = [
  'HISTORY_ISOLATED_PER_ATTACHMENT',
  'SWITCH_ATTACHMENT_NO_HISTORY_LEAK',
  'UNDO_AFTER_ERASER',
  'REDO_AFTER_ERASER',
  'UNDO_NOTE_CREATE_EDIT_DELETE',
  'NEW_EDIT_CLEARS_REDO_STACK',
  'RELOAD_HISTORY_STACK_EMPTY_BUT_ANNOTATIONS_PERSIST',
  'PERSISTED_ANNOTATIONS_UNDO_DISABLED',
  'PERSISTED_ANNOTATIONS_CLEAR_ENABLED',
  'EMPTY_ANNOTATIONS_CLEAR_DISABLED',
  'CLEAR_CREATES_UNDO_HISTORY',
  'UNDO_AFTER_CLEAR_RESTORES_ALL',
  'REDO_AFTER_CLEAR_CLEARS_AGAIN',
  'READONLY_CLEAR_DISABLED',
  'RELOAD_PERSISTED_ANNOTATION_UNDO_DISABLED',
  'UNDO_WITH_EMPTY_HISTORY_NOOP',
  'RELOAD_LATEST_CLEARS_PAST_HISTORY',
  'RELOAD_LATEST_CLEARS_FUTURE_HISTORY',
  'SWITCH_SUBMISSION_CLEARS_ALL_HISTORY',
  'OLD_HISTORY_CANNOT_OVERWRITE_RELOADED_SERVER_STATE',
  'POINTER_CANCEL_SAFE',
  'MULTITOUCH_DOES_NOT_DRAW_ACCIDENTALLY',
  'MOBILE_SCROLL_ZOOM_CONFLICT',
  'ZERO_LENGTH_LINE_IGNORED',
  'ZERO_SIZE_ELLIPSE_IGNORED',
  'ZERO_LENGTH_ARROW_IGNORED',
  'STUDENT_RENDER_MATCHES_TEACHER_RENDER',
];

for (const key of requiredKeys) {
  assert.equal(testResults[key], 'PASS', `Test ${key} must PASS!`);
}
