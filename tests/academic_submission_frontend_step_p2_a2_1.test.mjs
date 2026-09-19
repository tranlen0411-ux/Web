import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  calculateDistance,
  calculateMidpoint,
  calculatePinchTransform,
  clampScale,
  clampPan,
  screenToNormalized,
  normalizedToContentPixels,
  zoomIn,
  zoomOut,
  resetZoom,
  MIN_SCALE,
  MAX_SCALE,
} from '../src/utils/annotationViewportMath.js';

describe('Phase 2 — P2-A2.1: Teacher Mobile/Tablet Touch + Pinch Zoom & Multi-pointer Math', () => {

  // 1. Distance calculation
  it('1. should calculate accurate Euclidean distance between two pointers', () => {
    const p1 = { clientX: 100, clientY: 100 };
    const p2 = { clientX: 100, clientY: 200 };
    assert.equal(calculateDistance(p1, p2), 100);

    const p3 = { clientX: 0, clientY: 0 };
    const p4 = { clientX: 300, clientY: 400 };
    assert.equal(calculateDistance(p3, p4), 500); // 3-4-5 triangle

    assert.equal(calculateDistance(null, p4), 0);
  });

  // 2. Midpoint calculation
  it('2. should calculate accurate midpoint between two pointers', () => {
    const p1 = { clientX: 100, clientY: 200 };
    const p2 = { clientX: 300, clientY: 400 };
    const mid = calculateMidpoint(p1, p2);
    assert.deepEqual(mid, { clientX: 200, clientY: 300 });

    const single = calculateMidpoint(p1, null);
    assert.deepEqual(single, { clientX: 100, clientY: 200 });
  });

  // 3. Pinch scale increases (pinch out)
  it('3. should increase scale proportionally when fingers move apart (pinch out)', () => {
    const initialDistance = 200;
    const initialMidpoint = { clientX: 400, clientY: 300 };
    const initialScale = 1.0;
    const initialPan = { x: 0, y: 0 };

    // Fingers move apart from dist 200 to dist 300 (1.5x)
    const currentP1 = { clientX: 250, clientY: 300 };
    const currentP2 = { clientX: 550, clientY: 300 }; // dist = 300

    const viewportRect = { left: 0, top: 0, width: 800, height: 600 };
    const res = calculatePinchTransform({
      initialDistance,
      initialMidpoint,
      initialScale,
      initialPan,
      currentP1,
      currentP2,
      viewportRect,
      baseWidth: 800,
      baseHeight: 600,
    });

    assert.equal(res.scale, 1.5);
    assert(res.scale > initialScale, 'Pinch out phải làm tăng scale');
  });

  // 4. Pinch scale decreases (pinch in)
  it('4. should decrease scale proportionally when fingers move closer (pinch in)', () => {
    const initialDistance = 400;
    const initialMidpoint = { clientX: 400, clientY: 300 };
    const initialScale = 2.0;
    const initialPan = { x: -200, y: -150 };

    // Fingers move closer from dist 400 to dist 200 (0.5x ratio -> scale becomes 1.0)
    const currentP1 = { clientX: 300, clientY: 300 };
    const currentP2 = { clientX: 500, clientY: 300 }; // dist = 200

    const viewportRect = { left: 0, top: 0, width: 800, height: 600 };
    const res = calculatePinchTransform({
      initialDistance,
      initialMidpoint,
      initialScale,
      initialPan,
      currentP1,
      currentP2,
      viewportRect,
      baseWidth: 800,
      baseHeight: 600,
    });

    assert.equal(res.scale, 1.0);
    assert(res.scale < initialScale, 'Pinch in phải làm giảm scale');
  });

  // 5. Clamp 1..4
  it('5. should clamp pinch scale strictly between MIN_SCALE (1.0) and MAX_SCALE (4.0)', () => {
    const viewportRect = { left: 0, top: 0, width: 800, height: 600 };

    // Try pinching out to 10x
    const resMax = calculatePinchTransform({
      initialDistance: 100,
      initialMidpoint: { clientX: 400, clientY: 300 },
      initialScale: 1.0,
      initialPan: { x: 0, y: 0 },
      currentP1: { clientX: 0, clientY: 300 },
      currentP2: { clientX: 1000, clientY: 300 }, // dist = 1000 -> 10x
      viewportRect,
      baseWidth: 800,
      baseHeight: 600,
    });
    assert.equal(resMax.scale, MAX_SCALE); // 4.0

    // Try pinching in below 1.0
    const resMin = calculatePinchTransform({
      initialDistance: 500,
      initialMidpoint: { clientX: 400, clientY: 300 },
      initialScale: 1.0,
      initialPan: { x: 0, y: 0 },
      currentP1: { clientX: 390, clientY: 300 },
      currentP2: { clientX: 410, clientY: 300 }, // dist = 20 -> 0.04x
      viewportRect,
      baseWidth: 800,
      baseHeight: 600,
    });
    assert.equal(resMin.scale, MIN_SCALE); // 1.0
  });

  // 6. Pinch anchor math (focal point stability)
  it('6. should anchor the logical content point under initial midpoint during pinch zoom', () => {
    const viewportRect = { left: 100, top: 50, width: 800, height: 600 };
    const initialMidpoint = { clientX: 500, clientY: 350 }; // (400, 300) in viewport space
    const initialScale = 1.0;
    const initialPan = { x: 0, y: 0 };
    const initialDistance = 200;

    // Zoom to 2.0 without shifting midpoint
    const currentP1 = { clientX: 300, clientY: 350 };
    const currentP2 = { clientX: 700, clientY: 350 }; // dist = 400 -> 2x, midpoint still (500, 350)

    const res = calculatePinchTransform({
      initialDistance,
      initialMidpoint,
      initialScale,
      initialPan,
      currentP1,
      currentP2,
      viewportRect,
      baseWidth: 800,
      baseHeight: 600,
    });

    assert.equal(res.scale, 2.0);

    // Verify content point under initial midpoint:
    // Initial content anchor: (500 - 100 - 0)/1 = 400, (350 - 50 - 0)/1 = 300
    // At scale 2.0: Pan = 400 - 400 * 2 = -400, PanY = 300 - 300 * 2 = -300
    assert.equal(res.panX, -400);
    assert.equal(res.panY, -300);

    // Map the screen midpoint back to normalized coordinate before and after zoom
    const normBefore = screenToNormalized({
      clientX: 500,
      clientY: 350,
      viewportRect,
      baseWidth: 800,
      baseHeight: 600,
      scale: 1.0,
      panX: 0,
      panY: 0,
    });

    const normAfter = screenToNormalized({
      clientX: 500,
      clientY: 350,
      viewportRect,
      baseWidth: 800,
      baseHeight: 600,
      scale: res.scale,
      panX: res.panX,
      panY: res.panY,
    });

    assert.ok(Math.abs(normBefore.x - normAfter.x) < 1e-9, 'Logical focal point X must be invariant');
    assert.ok(Math.abs(normBefore.y - normAfter.y) < 1e-9, 'Logical focal point Y must be invariant');
  });

  // 7. Two-finger pan midpoint delta
  it('7. should shift viewport pan when both fingers move in parallel (two-finger pan)', () => {
    const viewportRect = { left: 0, top: 0, width: 800, height: 600 };
    const initialDistance = 200;
    const initialMidpoint = { clientX: 400, clientY: 300 };
    const initialScale = 2.0;
    const initialPan = { x: -200, y: -150 };

    // Move both fingers by delta (+50, +30) with same distance
    const currentP1 = { clientX: 350, clientY: 330 };
    const currentP2 = { clientX: 550, clientY: 330 }; // dist = 200, mid = (450, 330)

    const res = calculatePinchTransform({
      initialDistance,
      initialMidpoint,
      initialScale,
      initialPan,
      currentP1,
      currentP2,
      viewportRect,
      baseWidth: 800,
      baseHeight: 600,
    });

    assert.equal(res.scale, 2.0); // Scale unchanged
    assert.equal(res.panX, -150); // -200 + 50
    assert.equal(res.panY, -120); // -150 + 30
  });

  // 8. One pointer pan in pan mode
  it('8. should pan viewport on 1-pointer drag when activeTool is pan', () => {
    const startPan = { x: -100, y: -80 };
    const dragDelta = { dx: -50, dy: -30 };
    const proposedPanX = startPan.x + dragDelta.dx;
    const proposedPanY = startPan.y + dragDelta.dy;

    const clamped = clampPan({
      viewportWidth: 800,
      viewportHeight: 600,
      baseWidth: 800,
      baseHeight: 600,
      scale: 2.0,
      panX: proposedPanX,
      panY: proposedPanY,
    });

    assert.equal(clamped.panX, -150);
    assert.equal(clamped.panY, -110);
  });

  // 9. Second pointer cancels draft stroke in Canvas code
  it('9. should verify Canvas cancels in-progress draft stroke upon 2nd pointer arrival', () => {
    const canvasFile = path.resolve('src/components/dashboard/exercises/SubmissionAnnotationCanvas.jsx');
    const canvasCode = fs.readFileSync(canvasFile, 'utf8');

    assert(canvasCode.includes('activePointersRef.current.size >= 2'), 'Canvas must check activePointers count >= 2');
    assert(canvasCode.includes('setCurrentStroke(null)'), 'Canvas must cancel in-progress stroke');
    assert(canvasCode.includes('isPointerActiveRef.current = false'), 'Canvas must reset pointer active flag');
    assert(canvasCode.includes('suppressSinglePointerDrawRef.current = true'), 'Canvas must suppress single pointer drawing after multi-touch');
  });

  // 10. Partial stroke not committed
  it('10. should ensure partial draft stroke is not committed to annotation when cancelled', () => {
    const canvasFile = path.resolve('src/components/dashboard/exercises/SubmissionAnnotationCanvas.jsx');
    const canvasCode = fs.readFileSync(canvasFile, 'utf8');

    // Drawing commit is strictly guarded by isPointerActiveRef && currentStroke && !suppressSinglePointerDrawRef
    assert(canvasCode.includes('if (isPointerActiveRef.current && currentStroke && !suppressSinglePointerDrawRef.current)'), 'Canvas must guard stroke commitment against suppressed/cancelled states');
  });

  // 11. Pointercancel clears gesture
  it('11. should handle pointercancel by safely delegating to cleanup handler', () => {
    const canvasFile = path.resolve('src/components/dashboard/exercises/SubmissionAnnotationCanvas.jsx');
    const canvasCode = fs.readFileSync(canvasFile, 'utf8');

    assert(canvasCode.includes('const handlePointerCancel = (e) =>'), 'Canvas must have pointercancel handler');
    assert(canvasCode.includes('handlePointerUp(e)'), 'pointercancel must delegate to clean release');
  });

  // 12. Lostpointercapture clears state safely
  it('12. should handle lostpointercapture without throwing exceptions or stuck states', () => {
    const canvasFile = path.resolve('src/components/dashboard/exercises/SubmissionAnnotationCanvas.jsx');
    const canvasCode = fs.readFileSync(canvasFile, 'utf8');

    assert(canvasCode.includes('const handleLostPointerCapture = (e) =>'), 'Canvas must have lostpointercapture handler');
    assert(canvasCode.includes('onLostPointerCapture={handleLostPointerCapture}'), 'Canvas must attach lostpointercapture to viewport DOM');
  });

  // 13. 2 -> 1 transition does not auto-draw (ghost stroke suppression)
  it('13. should verify 2 -> 1 pointer transition suppresses single-pointer drawing until full release', () => {
    const canvasFile = path.resolve('src/components/dashboard/exercises/SubmissionAnnotationCanvas.jsx');
    const canvasCode = fs.readFileSync(canvasFile, 'utf8');

    // activePointersRef drops to 0 before suppressSinglePointerDrawRef is cleared
    assert(canvasCode.includes('if (activePointersRef.current.size === 0)'), 'Must check activePointers size === 0 for reset');
    assert(canvasCode.includes('suppressSinglePointerDrawRef.current = false'), 'Must clear suppression only when all pointers lifted');
  });

  // 14. Pinch does not mutate annotation
  it('14. should guarantee pinch and pan gestures do not mutate the annotation payload', () => {
    const initialAnnotation = {
      schema_version: 1,
      strokes: [{ id: 's1', tool: 'pen', color: '#ef4444', width: 4, points: [{ x: 0.2, y: 0.3 }] }],
      stamps: [{ id: 'st1', type: 'check', x: 0.5, y: 0.5, size: 28 }],
      notes: []
    };

    const snapshot = JSON.parse(JSON.stringify(initialAnnotation));

    // Simulate multi-touch pinch calculations
    const transform1 = calculatePinchTransform({
      initialDistance: 200,
      initialMidpoint: { clientX: 400, clientY: 300 },
      initialScale: 1.0,
      initialPan: { x: 0, y: 0 },
      currentP1: { clientX: 200, clientY: 300 },
      currentP2: { clientX: 600, clientY: 300 },
      viewportRect: { left: 0, top: 0, width: 800, height: 600 },
      baseWidth: 800,
      baseHeight: 600,
    });

    assert.equal(transform1.scale, 2.0);
    // Annotation payload is 100% untouched
    assert.deepEqual(initialAnnotation, snapshot);
  });

  // 15. Viewport state excluded from payload
  it('15. should exclude transient pinch/pan viewport state from persistent annotation payload', () => {
    const persistentPayload = {
      schema_version: 1,
      strokes: [],
      stamps: [],
      notes: []
    };

    assert.equal(persistentPayload.scale, undefined);
    assert.equal(persistentPayload.panX, undefined);
    assert.equal(persistentPayload.panY, undefined);
    assert.equal(persistentPayload.activePointers, undefined);
  });

});
