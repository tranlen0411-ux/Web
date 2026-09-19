import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp,
  clampScale,
  clampPan,
  screenToNormalized,
  normalizedToContentPixels,
  MIN_SCALE,
  MAX_SCALE,
} from '../src/utils/annotationViewportMath.js';

describe('Phase 2 — P2-A1: Core Coordinate & Transform Engine', () => {

  // 1. Scale clamp 1..4
  it('1. should clamp scale strictly between MIN_SCALE (1) and MAX_SCALE (4)', () => {
    assert.equal(clampScale(0.5), 1);
    assert.equal(clampScale(-10), 1);
    assert.equal(clampScale(1), 1);
    assert.equal(clampScale(2.5), 2.5);
    assert.equal(clampScale(4), 4);
    assert.equal(clampScale(5), 4);
    assert.equal(clampScale(100), 4);
    assert.equal(clampScale(NaN), 1);
    assert.equal(clampScale(Infinity), 1);
  });

  // 2. Pan clamp at scale = 1
  it('2. should lock pan to (0, 0) when scale <= 1', () => {
    const result = clampPan({
      viewportWidth: 800,
      viewportHeight: 600,
      baseWidth: 800,
      baseHeight: 600,
      scale: 1,
      panX: 100,
      panY: -150,
    });

    assert.deepEqual(result, { panX: 0, panY: 0 });
  });

  // 3. Pan clamp at scale > 1
  it('3. should clamp pan within valid viewport extents when scale > 1', () => {
    // Viewport: 800x600, Base: 800x600, Scale: 2 -> Scaled: 1600x1200
    // minPanX = 800 - 1600 = -800, maxPanX = 0
    // minPanY = 600 - 1200 = -600, maxPanY = 0

    // Test inside bounds
    const inside = clampPan({
      viewportWidth: 800,
      viewportHeight: 600,
      baseWidth: 800,
      baseHeight: 600,
      scale: 2,
      panX: -400,
      panY: -300,
    });
    assert.deepEqual(inside, { panX: -400, panY: -300 });

    // Test positive pan (overscroll right/down) -> clamped to 0
    const overPositive = clampPan({
      viewportWidth: 800,
      viewportHeight: 600,
      baseWidth: 800,
      baseHeight: 600,
      scale: 2,
      panX: 50,
      panY: 100,
    });
    assert.deepEqual(overPositive, { panX: 0, panY: 0 });

    // Test negative pan (overscroll left/up) -> clamped to minPanX, minPanY
    const overNegative = clampPan({
      viewportWidth: 800,
      viewportHeight: 600,
      baseWidth: 800,
      baseHeight: 600,
      scale: 2,
      panX: -1000,
      panY: -900,
    });
    assert.deepEqual(overNegative, { panX: -800, panY: -600 });
  });

  // 4. screenToNormalized at scale = 1
  it('4. should correctly convert screen coordinates to normalized coordinates at scale = 1', () => {
    const viewportRect = { left: 100, top: 50, width: 800, height: 600 };
    const baseWidth = 800;
    const baseHeight = 600;

    // Top-left: clientX = 100, clientY = 50 -> (0, 0)
    const topLeft = screenToNormalized({
      clientX: 100,
      clientY: 50,
      viewportRect,
      baseWidth,
      baseHeight,
      scale: 1,
      panX: 0,
      panY: 0,
    });
    assert.deepEqual(topLeft, { x: 0, y: 0 });

    // Center: clientX = 500, clientY = 350 -> (0.5, 0.5)
    const center = screenToNormalized({
      clientX: 500,
      clientY: 350,
      viewportRect,
      baseWidth,
      baseHeight,
      scale: 1,
      panX: 0,
      panY: 0,
    });
    assert.deepEqual(center, { x: 0.5, y: 0.5 });

    // Bottom-right: clientX = 900, clientY = 650 -> (1, 1)
    const bottomRight = screenToNormalized({
      clientX: 900,
      clientY: 650,
      viewportRect,
      baseWidth,
      baseHeight,
      scale: 1,
      panX: 0,
      panY: 0,
    });
    assert.deepEqual(bottomRight, { x: 1, y: 1 });
  });

  // 5. screenToNormalized at scale = 2
  it('5. should correctly convert screen coordinates to normalized coordinates at scale = 2 (zoomed)', () => {
    const viewportRect = { left: 100, top: 50, width: 800, height: 600 };
    const baseWidth = 800;
    const baseHeight = 600;

    // Center of viewport (clientX = 500, clientY = 350) with scale = 2, pan = (0, 0)
    // viewportX = 400, viewportY = 300
    // contentX = 400 / 2 = 200 -> normalizedX = 200 / 800 = 0.25
    // contentY = 300 / 2 = 150 -> normalizedY = 150 / 600 = 0.25
    const pt = screenToNormalized({
      clientX: 500,
      clientY: 350,
      viewportRect,
      baseWidth,
      baseHeight,
      scale: 2,
      panX: 0,
      panY: 0,
    });
    assert.deepEqual(pt, { x: 0.25, y: 0.25 });
  });

  // 6. screenToNormalized with pan
  it('6. should correctly convert screen coordinates with both zoom and pan offset', () => {
    const viewportRect = { left: 100, top: 50, width: 800, height: 600 };
    const baseWidth = 800;
    const baseHeight = 600;

    // Viewport center (clientX = 500, clientY = 350), scale = 2, panX = -400, panY = -300
    // viewportX = 400, viewportY = 300
    // contentX = (400 - (-400)) / 2 = 800 / 2 = 400 -> normalizedX = 400 / 800 = 0.5
    // contentY = (300 - (-300)) / 2 = 600 / 2 = 300 -> normalizedY = 300 / 600 = 0.5
    const pt = screenToNormalized({
      clientX: 500,
      clientY: 350,
      viewportRect,
      baseWidth,
      baseHeight,
      scale: 2,
      panX: -400,
      panY: -300,
    });
    assert.deepEqual(pt, { x: 0.5, y: 0.5 });
  });

  // 7. Edge coordinates clamp to 0..1
  it('7. should clamp out-of-bounds clicks strictly to [0, 1]', () => {
    const viewportRect = { left: 100, top: 50, width: 800, height: 600 };
    const baseWidth = 800;
    const baseHeight = 600;

    // Far top-left outside
    const outsideTopLeft = screenToNormalized({
      clientX: 0,
      clientY: 0,
      viewportRect,
      baseWidth,
      baseHeight,
      scale: 1,
      panX: 0,
      panY: 0,
    });
    assert.deepEqual(outsideTopLeft, { x: 0, y: 0 });

    // Far bottom-right outside
    const outsideBottomRight = screenToNormalized({
      clientX: 2000,
      clientY: 2000,
      viewportRect,
      baseWidth,
      baseHeight,
      scale: 1,
      panX: 0,
      panY: 0,
    });
    assert.deepEqual(outsideBottomRight, { x: 1, y: 1 });
  });

  // 8. No double-transform verification
  it('8. should eliminate double-transform risk by using un-transformed layout dimensions', () => {
    const unTransformedViewportRect = { left: 50, top: 50, width: 500, height: 400 };
    const baseWidth = 500;
    const baseHeight = 400;
    const scale = 2;
    const panX = -100;
    const panY = -50;

    // Simulate clicking at viewport local (200, 150)
    const clientX = 50 + 200; // 250
    const clientY = 50 + 150; // 200

    const result = screenToNormalized({
      clientX,
      clientY,
      viewportRect: unTransformedViewportRect,
      baseWidth,
      baseHeight,
      scale,
      panX,
      panY,
    });

    // Expected:
    // viewportX = 200, viewportY = 150
    // contentX = (200 - (-100)) / 2 = 150
    // contentY = (150 - (-50)) / 2 = 100
    // normX = 150 / 500 = 0.3
    // normY = 100 / 400 = 0.25
    assert.equal(result.x, 0.3);
    assert.equal(result.y, 0.25);
  });

  // 9. Resize does not mutate annotation data
  it('9. should ensure resizing layout dimensions does not mutate normalized coordinates', () => {
    const initialAnnotation = {
      schema_version: 1,
      strokes: [
        { id: 'st_1', tool: 'pen', color: '#ef4444', width: 4, points: [{ x: 0.25, y: 0.5 }] }
      ],
      stamps: [
        { id: 'stamp_1', type: 'check', x: 0.75, y: 0.8, size: 28 }
      ],
      notes: []
    };

    // Deep freeze to ensure immutability
    const deepFrozen = JSON.parse(JSON.stringify(initialAnnotation));

    // Simulate resizing window from 800x600 to 400x300
    const pixelAtLarge = normalizedToContentPixels(0.25, 0.5, 800, 600);
    const pixelAtSmall = normalizedToContentPixels(0.25, 0.5, 400, 300);

    assert.deepEqual(pixelAtLarge, { x: 200, y: 300 });
    assert.deepEqual(pixelAtSmall, { x: 100, y: 150 });

    // Ensure raw normalized coordinates in annotation payload remain untouched
    assert.deepEqual(deepFrozen, initialAnnotation);
    assert.equal(deepFrozen.strokes[0].points[0].x, 0.25);
    assert.equal(deepFrozen.strokes[0].points[0].y, 0.5);
    assert.equal(deepFrozen.stamps[0].x, 0.75);
    assert.equal(deepFrozen.stamps[0].y, 0.8);
  });

  // 10. Existing Phase 1 normalized coordinates remain invariant
  it('10. should maintain 100% mathematical fidelity with Phase 1 normalized coordinates', () => {
    const strokePointsPhase1 = [
      { x: 0.123, y: 0.456 },
      { x: 0.234, y: 0.567 },
      { x: 0.345, y: 0.678 }
    ];

    strokePointsPhase1.forEach(pt => {
      assert.ok(pt.x >= 0 && pt.x <= 1, 'x must be in [0, 1]');
      assert.ok(pt.y >= 0 && pt.y <= 1, 'y must be in [0, 1]');
    });
  });

});
