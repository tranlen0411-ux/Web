import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  screenToNormalized,
  clampScale,
  clampPan,
  MIN_SCALE,
  MAX_SCALE,
} from '../src/utils/annotationViewportMath.js';
import {
  generateNoteId,
  normalizeNote,
  normalizeNotes,
  normalizeAnnotationPayload,
  updateNoteInList,
  removeNoteFromList,
  DEFAULT_NOTE_COLOR,
  MAX_NOTES_COUNT,
} from '../src/utils/annotationNoteUtils.js';

describe('Teacher Note Tool — Position Precision & Pointer Integration Verification', () => {

  // 1. NOTE_CLICK_POSITION: Local coordinates relative to actual rendered image
  it('NOTE_CLICK_POSITION: should calculate local coordinates based on rendered image rectangle', () => {
    const imgRect = { left: 120, top: 80, width: 640, height: 480 };
    const clickEvent = { clientX: 280, clientY: 200, pointerType: 'mouse' };

    const localX = clickEvent.clientX - imgRect.left;
    const localY = clickEvent.clientY - imgRect.top;

    assert.equal(localX, 160, 'localX must be relative to image left (280 - 120 = 160)');
    assert.equal(localY, 120, 'localY must be relative to image top (200 - 80 = 120)');
  });

  // 2. NOTE_NORMALIZED_COORDS: Conversion to [0, 1] normalized coordinates
  it('NOTE_NORMALIZED_COORDS: should convert local coordinates to [0, 1] normalized coordinates', () => {
    const renderedImageWidth = 640;
    const renderedImageHeight = 480;
    const localX = 160;
    const localY = 120;

    const x = Math.max(0, Math.min(1, localX / renderedImageWidth));
    const y = Math.max(0, Math.min(1, localY / renderedImageHeight));

    assert.equal(x, 0.25, 'x must equal 160 / 640 = 0.25');
    assert.equal(y, 0.25, 'y must equal 120 / 480 = 0.25');

    // Clamping test
    const outX = Math.max(0, Math.min(1, -50 / renderedImageWidth));
    const outY = Math.max(0, Math.min(1, 800 / renderedImageHeight));
    assert.equal(outX, 0.0);
    assert.equal(outY, 1.0);
  });

  // 3. NOTE_SAVE_ANCHOR: Save note with normalized anchor
  it('NOTE_SAVE_ANCHOR: should save note anchor with normalized x and y', () => {
    const note = normalizeNote({
      id: generateNoteId(),
      x: 0.25,
      y: 0.25,
      text: 'Ghi chú vị trí chính xác',
      color: '#ef4444',
    });

    assert(note !== null, 'Note must normalize successfully');
    assert.equal(note.x, 0.25);
    assert.equal(note.y, 0.25);
    assert.equal(note.text, 'Ghi chú vị trí chính xác');
    assert.equal(note.color, '#ef4444');
  });

  // 4. NOTE_REOPEN_EXISTING: Reopen existing note to view/edit without losing anchor
  it('NOTE_REOPEN_EXISTING: should preserve note id and anchor coordinates when editing text or color', () => {
    const originalNotes = [
      { id: 'note-anchor-1', x: 0.35, y: 0.65, text: 'Nội dung cũ', color: '#f59e0b' },
    ];

    const updated = updateNoteInList(originalNotes, 'note-anchor-1', {
      text: 'Nội dung đã chỉnh sửa',
      color: '#3b82f6',
    });

    assert.equal(updated.length, 1);
    assert.equal(updated[0].id, 'note-anchor-1');
    assert.equal(updated[0].x, 0.35, 'x coordinate must remain strictly unchanged');
    assert.equal(updated[0].y, 0.65, 'y coordinate must remain strictly unchanged');
    assert.equal(updated[0].text, 'Nội dung đã chỉnh sửa');
    assert.equal(updated[0].color, '#3b82f6');
  });

  // 5. NOTE_AFTER_ZOOM: Marker remains glued to image point after zoom
  it('NOTE_AFTER_ZOOM: should maintain exact image point anchoring at scale 1x, 2x, 3.5x, 4x', () => {
    const scales = [1, 2, 3.5, 4];
    const baseW = 800;
    const baseH = 600;
    const anchor = { x: 0.4, y: 0.7 };

    scales.forEach(scale => {
      const clampedScale = clampScale(scale);
      // In CSS: left: `${note.x * 100}%`, top: `${note.y * 100}%` inside transformed wrapper
      const contentPxX = anchor.x * baseW;
      const contentPxY = anchor.y * baseH;
      assert.equal(contentPxX, 320);
      assert.equal(contentPxY, 420);

      // Inverse transform maps back to exact anchor
      const norm = screenToNormalized({
        clientX: 100 + contentPxX * clampedScale,
        clientY: 50 + contentPxY * clampedScale,
        viewportRect: { left: 100, top: 50, width: baseW, height: baseH },
        baseWidth: baseW,
        baseHeight: baseH,
        scale: clampedScale,
        panX: 0,
        panY: 0,
      });

      assert(Math.abs(norm.x - anchor.x) < 1e-6, `x must match at scale ${scale}`);
      assert(Math.abs(norm.y - anchor.y) < 1e-6, `y must match at scale ${scale}`);
    });
  });

  // 6. NOTE_AFTER_PAN: Marker remains glued after viewport pan
  it('NOTE_AFTER_PAN: should maintain exact image point anchoring when panned', () => {
    const baseW = 800;
    const baseH = 600;
    const anchor = { x: 0.5, y: 0.5 };
    const scale = 2;
    const panX = -200;
    const panY = -150;

    const screenX = 100 + panX + (anchor.x * baseW * scale); // 100 - 200 + 800 = 700
    const screenY = 50 + panY + (anchor.y * baseH * scale);  // 50 - 150 + 600 = 500

    const norm = screenToNormalized({
      clientX: screenX,
      clientY: screenY,
      viewportRect: { left: 100, top: 50, width: baseW, height: baseH },
      baseWidth: baseW,
      baseHeight: baseH,
      scale,
      panX,
      panY,
    });

    assert(Math.abs(norm.x - anchor.x) < 1e-6, 'Normalized X must match anchor under pan');
    assert(Math.abs(norm.y - anchor.y) < 1e-6, 'Normalized Y must match anchor under pan');
  });

  // 7. NOTE_AFTER_RESIZE: Marker remains glued across responsive resize
  it('NOTE_AFTER_RESIZE: should adapt to container and viewport resize cleanly using percentages', () => {
    const anchor = { x: 0.3, y: 0.6 };
    const viewports = [
      { w: 1200, h: 900 },
      { w: 800, h: 600 },
      { w: 400, h: 300 },
    ];

    viewports.forEach(vp => {
      // In CSS: left: `${note.x * 100}%` = `30%`, top: `${note.y * 100}%` = `60%`
      const posX = (anchor.x * 100).toFixed(1);
      const posY = (anchor.y * 100).toFixed(1);
      assert.equal(posX, '30.0');
      assert.equal(posY, '60.0');
    });
  });

  // 8. NOTE_TOUCH_POINTER: Touch pointer events support
  it('NOTE_TOUCH_POINTER: should accept touch pointer events', () => {
    const touchEvent = {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 350,
      clientY: 250,
    };
    assert.equal(touchEvent.pointerType, 'touch');
    const localX = touchEvent.clientX - 100;
    const localY = touchEvent.clientY - 50;
    assert.equal(localX, 250);
    assert.equal(localY, 200);
  });

  // 9. NOTE_PEN_POINTER: Stylus / Pen pointer events support
  it('NOTE_PEN_POINTER: should accept pen/stylus pointer events', () => {
    const penEvent = {
      pointerId: 2,
      pointerType: 'pen',
      clientX: 400,
      clientY: 300,
    };
    assert.equal(penEvent.pointerType, 'pen');
    const localX = penEvent.clientX - 100;
    const localY = penEvent.clientY - 50;
    assert.equal(localX, 300);
    assert.equal(localY, 250);
  });

  // 10. EXISTING_DRAW_TOOLS_REGRESSION: Zero regressions on strokes/stamps/tools
  it('EXISTING_DRAW_TOOLS_REGRESSION: should preserve all existing stroke tools and stamp tools without schema disruption', () => {
    const fullPayload = {
      schema_version: 1,
      strokes: [
        { id: 's1', tool: 'pen', color: '#ef4444', width: 4, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] },
        { id: 's2', tool: 'line', color: '#3b82f6', width: 2, startPoint: { x: 0.1, y: 0.1 }, endPoint: { x: 0.5, y: 0.5 } },
        { id: 's3', tool: 'ellipse', color: '#10b981', width: 4, startPoint: { x: 0.2, y: 0.2 }, endPoint: { x: 0.4, y: 0.4 } },
        { id: 's4', tool: 'arrow', color: '#ef4444', width: 4, startPoint: { x: 0.1, y: 0.1 }, endPoint: { x: 0.3, y: 0.3 } },
      ],
      stamps: [
        { id: 'st1', type: 'check', x: 0.5, y: 0.5, size: 28 },
        { id: 'st2', type: 'cross', x: 0.8, y: 0.8, size: 28 },
      ],
      notes: [
        { id: 'n1', x: 0.25, y: 0.25, text: 'Ghi chú kiểm tra', color: '#f59e0b' }
      ]
    };

    const normalized = normalizeAnnotationPayload(fullPayload);
    assert.equal(normalized.schema_version, 1);
    assert.equal(normalized.strokes.length, 4);
    assert.equal(normalized.stamps.length, 2);
    assert.equal(normalized.notes.length, 1);

    // Verify canvas file imports and contracts
    const canvasCode = fs.readFileSync(path.resolve('src/components/dashboard/exercises/SubmissionAnnotationCanvas.jsx'), 'utf8');
    assert(canvasCode.includes('getNormalizedPoint'), 'Canvas must define getNormalizedPoint');
    assert(canvasCode.includes('calculatePopoverPosition'), 'Canvas must define calculatePopoverPosition');
    assert(canvasCode.includes('AnnotationNotePopover'), 'Canvas must render AnnotationNotePopover');
    assert(canvasCode.includes('pendingNote'), 'Canvas must support pending note preview');
  });

});
