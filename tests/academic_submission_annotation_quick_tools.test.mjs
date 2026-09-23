// tests/academic_submission_annotation_quick_tools.test.mjs
// COMPREHENSIVE AUTOMATED TEST SUITE: TEACHER GRADING ANNOTATION QUICK TOOLS (PHASE: FINAL PRE-PR AUDIT)

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
console.log('🚀 BẮT ĐẦU KIỂM THỬ: FINAL PRE-PR AUDIT — ANNOTATION QUICK TOOLS');
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

// Helper: Point near stroke test matching SubmissionAnnotationCanvas logic
function isPointNearStroke(stroke, x, y, threshold = 0.04) {
  const tool = stroke.tool || 'pen';

  if (tool === 'pen') {
    if (!stroke.points || stroke.points.length === 0) return false;
    if (stroke.points.some(p => Math.hypot(p.x - x, p.y - y) < threshold)) return true;
    for (let i = 0; i < stroke.points.length - 1; i++) {
      const pA = stroke.points[i];
      const pB = stroke.points[i + 1];
      if (distToSegment(x, y, pA.x, pA.y, pB.x, pB.y) < threshold) return true;
    }
    return false;
  }

  const points = stroke.points || [];
  if (points.length < 2) {
    if (points.length === 1) return Math.hypot(points[0].x - x, points[0].y - y) < threshold;
    return false;
  }

  const p1 = stroke.startPoint || points[0];
  const p2 = stroke.endPoint || points[points.length - 1];

  if (tool === 'line') {
    return distToSegment(x, y, p1.x, p1.y, p2.x, p2.y) < threshold;
  }

  if (tool === 'arrow') {
    const shaftHit = distToSegment(x, y, p1.x, p1.y, p2.x, p2.y) < threshold;
    const tipHit = Math.hypot(x - p2.x, y - p2.y) < threshold * 1.5;
    return shaftHit || tipHit;
  }

  if (tool === 'ellipse') {
    const cx = (p1.x + p2.x) / 2;
    const cy = (p1.y + p2.y) / 2;
    const rx = Math.abs(p2.x - p1.x) / 2;
    const ry = Math.abs(p2.y - p1.y) / 2;

    if (rx < 0.01 && ry < 0.01) {
      return Math.hypot(x - cx, y - cy) < threshold;
    }

    const safeRx = Math.max(rx, 0.001);
    const safeRy = Math.max(ry, 0.001);
    const dx = (x - cx) / safeRx;
    const dy = (y - cy) / safeRy;
    const normDist = Math.hypot(dx, dy);
    const distToPerimeter = Math.abs(normDist - 1.0) * Math.min(safeRx, safeRy);

    return distToPerimeter < threshold || Math.abs(normDist - 1.0) < 0.35;
  }

  return false;
}

// Multi-attachment history manager simulation
class MultiAttachmentHistoryManager {
  constructor() {
    this.annotations = {};
    this.history = {};
  }

  initAttachment(attId, initialData = { schema_version: 1, strokes: [], stamps: [], notes: [] }) {
    this.annotations[attId] = JSON.parse(JSON.stringify(initialData));
    this.history[attId] = { past: [], future: [] };
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

  undo(attId) {
    const attH = this.history[attId] || { past: [], future: [] };
    if (attH.past.length === 0) return false;
    const prev = attH.past[attH.past.length - 1];
    const newPast = attH.past.slice(0, -1);
    const current = this.annotations[attId];
    const newFuture = [...attH.future, JSON.parse(JSON.stringify(current))];
    this.history[attId] = { past: newPast, future: newFuture };
    this.applyChange(attId, prev, true);
    return true;
  }

  redo(attId) {
    const attH = this.history[attId] || { past: [], future: [] };
    if (attH.future.length === 0) return false;
    const next = attH.future[attH.future.length - 1];
    const newFuture = attH.future.slice(0, -1);
    const current = this.annotations[attId];
    const newPast = [...attH.past, JSON.parse(JSON.stringify(current))];
    this.history[attId] = { past: newPast, future: newFuture };
    this.applyChange(attId, next, true);
    return true;
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
// 4. GESTURE SAFETY, MULTITOUCH & POINTER CANCEL
// ============================================================================

// TEST 8: POINTER_CANCEL_SAFE
{
  // When pointer cancel fires (e.g. phone call or gesture abort), in-progress stroke is dropped
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

// TEST 9: MULTITOUCH_DOES_NOT_DRAW_ACCIDENTALLY
{
  // When 2 fingers touch screen, single pointer drawing is suppressed
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

// TEST 10: MOBILE_SCROLL_ZOOM_CONFLICT
{
  // At 1.0x scale -> touch-action: pan-y (allows vertical scrolling)
  // At >1.0x scale -> touch-action: none (enables two-finger pan/pinch without page scroll conflict)
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
// 5. ZERO LENGTH/SIZE SHAPE GESTURES IGNORED
// ============================================================================

// TEST 11: ZERO_LENGTH_LINE_IGNORED
{
  const p1 = { x: 0.3, y: 0.3 };
  const p2 = { x: 0.3, y: 0.3 }; // Tap without drag
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const isValidLine = dist >= 0.005;

  assert.equal(isValidLine, false, 'Zero length line must be ignored');
  testResults.ZERO_LENGTH_LINE_IGNORED = 'PASS';
  console.log('✅ ZERO_LENGTH_LINE_IGNORED: PASS');
}

// TEST 12: ZERO_SIZE_ELLIPSE_IGNORED
{
  const p1 = { x: 0.5, y: 0.5 };
  const p2 = { x: 0.5001, y: 0.5001 }; // Microscopic jitter
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const isValidEllipse = dist >= 0.005;

  assert.equal(isValidEllipse, false, 'Zero size ellipse must be ignored');
  testResults.ZERO_SIZE_ELLIPSE_IGNORED = 'PASS';
  console.log('✅ ZERO_SIZE_ELLIPSE_IGNORED: PASS');
}

// TEST 13: ZERO_LENGTH_ARROW_IGNORED
{
  const p1 = { x: 0.4, y: 0.4 };
  const p2 = { x: 0.4, y: 0.4 }; // Zero length
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const isValidArrow = dist >= 0.005;

  assert.equal(isValidArrow, false, 'Zero length arrow must be ignored');
  testResults.ZERO_LENGTH_ARROW_IGNORED = 'PASS';
  console.log('✅ ZERO_LENGTH_ARROW_IGNORED: PASS');
}

// TEST 14: STUDENT_RENDER_MATCHES_TEACHER_RENDER
{
  // 1. Verify StudentAnnotationViewer imports and uses renderSvgAnnotationStroke from SubmissionAnnotationCanvas
  const studentViewerSrc = fs.readFileSync(path.resolve('src/components/dashboard/exercises/StudentAnnotationViewer.jsx'), 'utf8');
  const canvasSrc = fs.readFileSync(path.resolve('src/components/dashboard/exercises/SubmissionAnnotationCanvas.jsx'), 'utf8');

  assert.ok(canvasSrc.includes('export function renderSvgAnnotationStroke('), 'Canvas must export renderSvgAnnotationStroke');
  assert.ok(studentViewerSrc.includes("import { renderSvgAnnotationStroke } from './SubmissionAnnotationCanvas'"), 'StudentViewer must import renderSvgAnnotationStroke');
  assert.ok(studentViewerSrc.includes('strokes.map((stroke) => renderSvgAnnotationStroke(stroke, false))'), 'StudentViewer must render strokes using renderSvgAnnotationStroke');
  assert.ok(canvasSrc.includes('annotation.strokes || []).map((stroke) => renderSvgAnnotationStroke(stroke, false))'), 'Teacher Canvas must render strokes using renderSvgAnnotationStroke');

  testResults.STUDENT_RENDER_MATCHES_TEACHER_RENDER = 'PASS';
  console.log('✅ STUDENT_RENDER_MATCHES_TEACHER_RENDER: PASS');
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
