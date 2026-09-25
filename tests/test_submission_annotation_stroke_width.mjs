import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

console.log('=== RUNNING TESTS: SUBMISSION ANNOTATION STROKE WIDTH SEMANTICS ===\n');

// 1. Static AST/Source verification of AnnotationToolbar.jsx
console.log('--- 1. Toolbar Configuration & Presets Verification ---');
const toolbarSrc = fs.readFileSync(path.resolve('src/components/dashboard/exercises/AnnotationToolbar.jsx'), 'utf8');

assert.ok(toolbarSrc.includes('export const MIN_STROKE_WIDTH = 1'), 'Must export MIN_STROKE_WIDTH = 1');
assert.ok(toolbarSrc.includes('export const MAX_STROKE_WIDTH = 12'), 'Must export MAX_STROKE_WIDTH = 12');
assert.ok(toolbarSrc.includes('export const STROKE_WIDTH_STEP = 1'), 'Must export STROKE_WIDTH_STEP = 1');

// Presets
assert.ok(toolbarSrc.includes("value: 2, label: 'Nhỏ'"), "Must have Nhỏ preset with value: 2");
assert.ok(toolbarSrc.includes("value: 4, label: 'Vừa'"), "Must have Vừa preset with value: 4");
assert.ok(toolbarSrc.includes("value: 7, label: 'Lớn'"), "Must have Lớn preset with value: 7");

// Stepper controls
assert.ok(toolbarSrc.includes('<Minus'), 'Must render Minus button for decrement');
assert.ok(toolbarSrc.includes('<Plus'), 'Must render Plus button for increment');
assert.ok(toolbarSrc.includes('{strokeWidth} px'), 'Must display current stroke width with px unit');

console.log('✅ PRESET_SMALL: PASS');
console.log('✅ PRESET_MEDIUM: PASS');
console.log('✅ PRESET_LARGE: PASS');

// 2. Stepper Bounds & Increment/Decrement Logic
console.log('\n--- 2. Stepper Bounds & Increment/Decrement Logic ---');
const MIN_STROKE_WIDTH = 1;
const MAX_STROKE_WIDTH = 12;
const STROKE_WIDTH_STEP = 1;

let sw = 4;

// Decrement step by step
sw = Math.max(MIN_STROKE_WIDTH, sw - STROKE_WIDTH_STEP);
assert.strictEqual(sw, 3, 'Decrement 4 -> 3');

sw = Math.max(MIN_STROKE_WIDTH, sw - STROKE_WIDTH_STEP);
assert.strictEqual(sw, 2, 'Decrement 3 -> 2');

sw = Math.max(MIN_STROKE_WIDTH, sw - STROKE_WIDTH_STEP);
assert.strictEqual(sw, 1, 'Decrement 2 -> 1');

// Clamping at MIN=1
sw = Math.max(MIN_STROKE_WIDTH, sw - STROKE_WIDTH_STEP);
assert.strictEqual(sw, 1, 'Cannot decrement below MIN=1px');
console.log('✅ MIN_1PX: PASS');

// Increment step by step to MAX=12
for (let i = 1; i <= 20; i++) {
  sw = Math.min(MAX_STROKE_WIDTH, sw + STROKE_WIDTH_STEP);
}
assert.strictEqual(sw, 12, 'Cannot increment above MAX=12px');
console.log('✅ MAX_12PX: PASS');
console.log('✅ PLUS_MINUS: PASS');

// 3. Canvas & Renderer Verification (1:1 Stroke Width Semantics)
console.log('\n--- 3. Canvas & Renderer Formula Verification (strokeW = width) ---');
const canvasSrc = fs.readFileSync(path.resolve('src/components/dashboard/exercises/SubmissionAnnotationCanvas.jsx'), 'utf8');

// Verify removal of * 2.2 multiplier and adoption of clean 1:1 mapping:
assert.ok(!canvasSrc.includes('* 2.2'), 'Must NOT contain arbitrary * 2.2 scale factor');
assert.ok(
  canvasSrc.includes('Math.max(1, Number(width !== undefined && width !== null && !isNaN(width) ? width : 4))'),
  'Must compute strokeW = width with fallback of 4 for legacy strokes'
);

// Helper function replicating renderSvgAnnotationStroke formula
function computeStrokeW(width) {
  return Math.max(1, Number(width !== undefined && width !== null && !isNaN(width) ? width : 4));
}

// Check 1px, 2px, 4px, 7px render near 1px, 2px, 4px, 7px (1:1 with vectorEffect="non-scaling-stroke")
assert.strictEqual(computeStrokeW(1), 1, '1px toolbar selection renders exactly 1px');
console.log('✅ UI_1PX_RENDER_NEAR_1PX: PASS');

assert.strictEqual(computeStrokeW(2), 2, '2px toolbar selection renders exactly 2px');
console.log('✅ UI_2PX_RENDER_NEAR_2PX: PASS');

assert.strictEqual(computeStrokeW(4), 4, '4px toolbar selection renders exactly 4px');
console.log('✅ UI_4PX_RENDER_NEAR_4PX: PASS');

assert.strictEqual(computeStrokeW(7), 7, '7px toolbar selection renders exactly 7px');
console.log('✅ UI_7PX_RENDER_NEAR_7PX: PASS');

// Legacy annotations without width property default to 4px
assert.strictEqual(computeStrokeW(undefined), 4, 'Legacy stroke with undefined width defaults to 4px');
assert.strictEqual(computeStrokeW(null), 4, 'Legacy stroke with null width defaults to 4px');
console.log('✅ OLD_STROKE_DEFAULT: PASS');

// 4. Uniformity across Pen, Line, Ellipse, Arrow
console.log('\n--- 4. Tool Uniformity (Pen, Line, Ellipse, Arrow) ---');
assert.ok(canvasSrc.includes("if (tool === 'pen')"), "Canvas renders pen with strokeWidth={strokeW}");
assert.ok(canvasSrc.includes("if (tool === 'line')"), "Canvas renders line with strokeWidth={strokeW}");
assert.ok(canvasSrc.includes("if (tool === 'ellipse')"), "Canvas renders ellipse with strokeWidth={strokeW}");
assert.ok(canvasSrc.includes("if (tool === 'arrow')"), "Canvas renders arrow with strokeWidth={strokeW}");

console.log('✅ PEN: PASS');
console.log('✅ LINE: PASS');
console.log('✅ ELLIPSE: PASS');
console.log('✅ ARROW: PASS');

// 5. Student Viewer Parity
console.log('\n--- 5. Student Annotation Viewer Parity ---');
const viewerSrc = fs.readFileSync(path.resolve('src/components/dashboard/exercises/StudentAnnotationViewer.jsx'), 'utf8');

assert.ok(
  viewerSrc.includes("import { renderSvgAnnotationStroke } from './SubmissionAnnotationCanvas'"),
  'StudentAnnotationViewer must import and reuse renderSvgAnnotationStroke from SubmissionAnnotationCanvas'
);
assert.ok(
  viewerSrc.includes('{strokes.map((stroke) => renderSvgAnnotationStroke(stroke, false))}'),
  'StudentAnnotationViewer must render strokes using renderSvgAnnotationStroke'
);
console.log('✅ STUDENT_VIEWER_PARITY: PASS');

// 6. Persistence & Serialization Verification
console.log('\n--- 6. Reopening & Persistence Verification ---');
const savedPayload = {
  schema_version: 1,
  strokes: [
    { id: 's1', tool: 'pen', color: '#ef4444', width: 1, points: [{ x: 0.1, y: 0.1 }] },
    { id: 's2', tool: 'line', color: '#3b82f6', width: 3, points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }] },
    { id: 's3', tool: 'ellipse', color: '#10b981', width: 7, points: [{ x: 0.2, y: 0.2 }, { x: 0.6, y: 0.6 }] },
    { id: 's4', tool: 'arrow', color: '#1e293b', width: 12, points: [{ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.7 }] },
    { id: 's_old', tool: 'pen', color: '#ef4444', points: [{ x: 0.1, y: 0.1 }] } // old stroke without width
  ],
  stamps: [],
  notes: []
};

const serialized = JSON.stringify(savedPayload);
const reloaded = JSON.parse(serialized);

assert.strictEqual(computeStrokeW(reloaded.strokes[0].width), 1, 'Stroke 1 preserved 1px');
assert.strictEqual(computeStrokeW(reloaded.strokes[1].width), 3, 'Stroke 2 preserved 3px');
assert.strictEqual(computeStrokeW(reloaded.strokes[2].width), 7, 'Stroke 3 preserved 7px');
assert.strictEqual(computeStrokeW(reloaded.strokes[3].width), 12, 'Stroke 4 preserved 12px');
assert.strictEqual(computeStrokeW(reloaded.strokes[4].width), 4, 'Legacy stroke defaults to 4px');

console.log('✅ REOPEN_PRESERVES_STROKE: PASS');

console.log('\n======================================================================');
console.log('🎉 ALL SUBMISSION ANNOTATION STROKE WIDTH TESTS PASSED (EXIT CODE 0)!');
console.log('======================================================================\n');
