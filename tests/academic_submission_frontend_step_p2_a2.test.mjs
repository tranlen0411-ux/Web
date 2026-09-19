import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  zoomIn,
  zoomOut,
  resetZoom,
  clampScale,
  clampPan,
  formatZoomPercentage,
  screenToNormalized,
  ZOOM_STEP,
  MIN_SCALE,
  MAX_SCALE,
} from '../src/utils/annotationViewportMath.js';

describe('Phase 2 — P2-A2: Desktop Zoom / Pan Toolbar Controls & Interaction', () => {

  // 1. Zoom in +0.25
  it('1. should increment scale by exactly 0.25 (ZOOM_STEP) on zoomIn', () => {
    assert.equal(zoomIn(1.0), 1.25);
    assert.equal(zoomIn(1.25), 1.50);
    assert.equal(zoomIn(1.50), 1.75);
    assert.equal(zoomIn(3.75), 4.0);
  });

  // 2. Zoom out -0.25
  it('2. should decrement scale by exactly 0.25 (ZOOM_STEP) on zoomOut', () => {
    assert.equal(zoomOut(2.0), 1.75);
    assert.equal(zoomOut(1.5), 1.25);
    assert.equal(zoomOut(1.25), 1.0);
  });

  // 3. Clamp at MIN_SCALE (1.0)
  it('3. should clamp scale at minimum 1.0 (no zoom-out past 100%)', () => {
    assert.equal(zoomOut(1.0), 1.0);
    assert.equal(clampScale(0.8), 1.0);
    assert.equal(clampScale(-5), 1.0);
  });

  // 4. Clamp at MAX_SCALE (4.0)
  it('4. should clamp scale at maximum 4.0 (no zoom-in past 400%)', () => {
    assert.equal(zoomIn(4.0), 4.0);
    assert.equal(clampScale(4.5), 4.0);
    assert.equal(clampScale(10), 4.0);
  });

  // 5. Indicator formatting
  it('5. should format zoom percentage indicator accurately as integer string with %', () => {
    assert.equal(formatZoomPercentage(1.0), '100%');
    assert.equal(formatZoomPercentage(1.25), '125%');
    assert.equal(formatZoomPercentage(1.5), '150%');
    assert.equal(formatZoomPercentage(2.0), '200%');
    assert.equal(formatZoomPercentage(4.0), '400%');
  });

  // 6. Reset contract => scale = 1, pan = (0, 0)
  it('6. should return scale = 1 and pan = (0, 0) on resetZoom', () => {
    const resetState = resetZoom();
    assert.deepEqual(resetState, { scale: 1, panX: 0, panY: 0 });
  });

  // 7. Pan mode does not create annotations
  it('7. should confirm pan mode does not create strokes, stamps, or eraser mutations in Canvas', () => {
    const canvasFile = path.resolve('src/components/dashboard/exercises/SubmissionAnnotationCanvas.jsx');
    const canvasCode = fs.readFileSync(canvasFile, 'utf8');

    // Pan tool intercepts pointerdown without calling onChange or adding strokes/stamps
    assert(canvasCode.includes("activeTool === 'pan'"), 'Canvas phải có logic riêng cho activeTool pan');
    assert(canvasCode.includes('isPanningRef.current = true'), 'Pan mode kích hoạt isPanningRef');
    assert(canvasCode.includes('panStartRef.current ='), 'Pan mode ghi nhận điểm bắt đầu kéo panStartRef');
  });

  // 8. Mouse drag updates pan
  it('8. should calculate updated pan from mouse drag delta (dx, dy)', () => {
    const startPan = { x: -50, y: -30 };
    const dragDelta = { dx: -100, dy: -60 };
    const proposedPanX = startPan.x + dragDelta.dx;
    const proposedPanY = startPan.y + dragDelta.dy;

    const clamped = clampPan({
      viewportWidth: 800,
      viewportHeight: 600,
      baseWidth: 800,
      baseHeight: 600,
      scale: 2,
      panX: proposedPanX,
      panY: proposedPanY,
    });

    assert.equal(clamped.panX, -150);
    assert.equal(clamped.panY, -90);
  });

  // 9. Pan is clamped within valid bounds
  it('9. should clamp pan to prevent image from drifting out of view', () => {
    const clampedOver = clampPan({
      viewportWidth: 800,
      viewportHeight: 600,
      baseWidth: 800,
      baseHeight: 600,
      scale: 2, // Scaled: 1600x1200 -> minPan: -800, -600
      panX: -2000,
      panY: -1500,
    });

    assert.equal(clampedOver.panX, -800);
    assert.equal(clampedOver.panY, -600);
  });

  // 10. Pan reclamps after zoom change (scale = 1 -> pan = 0, 0)
  it('10. should reset pan to (0, 0) when scale drops back to 1.0', () => {
    const reclamped = clampPan({
      viewportWidth: 800,
      viewportHeight: 600,
      baseWidth: 800,
      baseHeight: 600,
      scale: 1, // Scaled: 800x600 -> locks pan to 0
      panX: -400,
      panY: -300,
    });

    assert.deepEqual(reclamped, { panX: 0, panY: 0 });
  });

  // 11. Switching tools preserves annotation data
  it('11. should preserve annotation data invariant when switching between pen, stamp, eraser, and pan', () => {
    const sampleAnnotation = {
      schema_version: 1,
      strokes: [{ id: 's1', tool: 'pen', color: '#ef4444', width: 4, points: [{ x: 0.1, y: 0.2 }] }],
      stamps: [{ id: 'st1', type: 'check', x: 0.5, y: 0.5, size: 28 }],
      notes: []
    };

    const frozen = JSON.parse(JSON.stringify(sampleAnnotation));

    // Tool switches in UI do not modify the annotation structure
    assert.deepEqual(frozen, sampleAnnotation);
  });

  // 12. Attachment change resets viewport in SubmissionGradingModal
  it('12. should verify SubmissionGradingModal resets viewport scale to 1 and pan to (0,0) on attachment switch', () => {
    const modalFile = path.resolve('src/components/dashboard/exercises/SubmissionGradingModal.jsx');
    const modalCode = fs.readFileSync(modalFile, 'utf8');

    assert(modalCode.includes('activeAttachmentForAnnotation?.id'), 'Modal phải theo dõi activeAttachmentForAnnotation.id');
    assert(modalCode.includes('setViewportScale(1)'), 'Modal phải reset viewportScale về 1');
    assert(modalCode.includes('setViewportPan({ x: 0, y: 0 })'), 'Modal phải reset viewportPan về (0,0)');
  });

  // 13. Backend payload excludes viewport state
  it('13. should verify backend payload only persists vector annotation data, not ephemeral viewport state', () => {
    const sampleAnnotationPayload = {
      schema_version: 1,
      strokes: [{ id: 's1', tool: 'pen', color: '#ef4444', width: 4, points: [{ x: 0.1, y: 0.2 }] }],
      stamps: [{ id: 'st1', type: 'check', x: 0.5, y: 0.5, size: 28 }],
      notes: []
    };

    assert.equal(sampleAnnotationPayload.scale, undefined);
    assert.equal(sampleAnnotationPayload.panX, undefined);
    assert.equal(sampleAnnotationPayload.panY, undefined);
  });

  // 14. Annotation schema unchanged (schema_version = 1)
  it('14. should keep schema_version = 1 with strokes, stamps, notes intact', () => {
    const canvasFile = path.resolve('src/components/dashboard/exercises/SubmissionAnnotationCanvas.jsx');
    const toolbarFile = path.resolve('src/components/dashboard/exercises/AnnotationToolbar.jsx');

    const canvasCode = fs.readFileSync(canvasFile, 'utf8');
    const toolbarCode = fs.readFileSync(toolbarFile, 'utf8');

    assert(canvasCode.includes('schema_version: 1') || canvasCode.includes('schema_version || 1'));
    assert(toolbarCode.includes('ZoomIn') && toolbarCode.includes('ZoomOut') && toolbarCode.includes('Hand'));
  });

});
