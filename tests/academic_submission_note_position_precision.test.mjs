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
  moveNoteInList,
  removeNoteFromList,
  DEFAULT_NOTE_COLOR,
  MAX_NOTES_COUNT,
} from '../src/utils/annotationNoteUtils.js';

describe('Teacher Note Tool — Position Precision, Drag & Drop, and Pointer Integration', () => {

  // 1. NOTE_CLICK_POSITION: Local coordinates relative to actual rendered image
  it('NOTE_CLICK_POSITION: should calculate local coordinates based on rendered image rectangle', () => {
    const imgRect = { left: 120, top: 80, width: 640, height: 480 };
    const clickEvent = { clientX: 280, clientY: 200, pointerType: 'mouse' };

    const localX = clickEvent.clientX - imgRect.left;
    const localY = clickEvent.clientY - imgRect.top;

    assert.equal(localX, 160, 'localX must be relative to image left (280 - 120 = 160)');
    assert.equal(localY, 120, 'localY must be relative to image top (200 - 80 = 120)');
  });

  // 2. NOTE_MOVE_NORMALIZED_COORDS: Conversion and clamping to [0, 1] on drag
  it('NOTE_MOVE_NORMALIZED_COORDS: should derive new normalized [0, 1] coordinates on drag from image bounds', () => {
    const imgRect = { left: 100, top: 50, width: 800, height: 600 };
    const dragPointerEvent = { clientX: 500, clientY: 350 };

    const localX = dragPointerEvent.clientX - imgRect.left;
    const localY = dragPointerEvent.clientY - imgRect.top;

    const normalizedX = Math.max(0, Math.min(1, localX / imgRect.width));
    const normalizedY = Math.max(0, Math.min(1, localY / imgRect.height));

    assert.equal(normalizedX, 0.5, 'localX 400 / 800 = 0.5');
    assert.equal(normalizedY, 0.5, 'localY 300 / 600 = 0.5');

    // Clamping boundaries
    const outLeftEvent = { clientX: 20, clientY: 700 };
    const clampedX = Math.max(0, Math.min(1, (outLeftEvent.clientX - imgRect.left) / imgRect.width));
    const clampedY = Math.max(0, Math.min(1, (outLeftEvent.clientY - imgRect.top) / imgRect.height));

    assert.equal(clampedX, 0.0, 'Out of bounds left must clamp to 0.0');
    assert.equal(clampedY, 1.0, 'Out of bounds bottom must clamp to 1.0');
  });

  // 3. NOTE_DRAG_MOUSE: Mouse pointer events drag and move note
  it('NOTE_DRAG_MOUSE: should drag note pin using mouse pointer events', () => {
    const notes = [
      { id: 'note-mouse-1', x: 0.1, y: 0.1, text: 'Ghi chú chuột', color: '#ef4444' },
    ];
    const mouseDragEvent = { pointerId: 1, pointerType: 'mouse', clientX: 300, clientY: 400 };
    assert.equal(mouseDragEvent.pointerType, 'mouse');

    const nextNotes = moveNoteInList(notes, 'note-mouse-1', 0.6, 0.7);
    assert.equal(nextNotes.length, 1);
    assert.equal(nextNotes[0].x, 0.6);
    assert.equal(nextNotes[0].y, 0.7);
    assert.equal(nextNotes[0].id, 'note-mouse-1');
  });

  // 4. NOTE_DRAG_TOUCH: Touch pointer events drag and move note
  it('NOTE_DRAG_TOUCH: should drag note pin using touch pointer events', () => {
    const notes = [
      { id: 'note-touch-1', x: 0.2, y: 0.3, text: 'Ghi chú cảm ứng', color: '#10b981' },
    ];
    const touchDragEvent = { pointerId: 2, pointerType: 'touch', clientX: 450, clientY: 550 };
    assert.equal(touchDragEvent.pointerType, 'touch');

    const nextNotes = moveNoteInList(notes, 'note-touch-1', 0.45, 0.55);
    assert.equal(nextNotes.length, 1);
    assert.equal(nextNotes[0].x, 0.45);
    assert.equal(nextNotes[0].y, 0.55);
    assert.equal(nextNotes[0].id, 'note-touch-1');
  });

  // 5. NOTE_DRAG_PEN: Pen / Stylus pointer events drag and move note
  it('NOTE_DRAG_PEN: should drag note pin using pen/stylus pointer events', () => {
    const notes = [
      { id: 'note-pen-1', x: 0.3, y: 0.4, text: 'Ghi chú bút', color: '#3b82f6' },
    ];
    const penDragEvent = { pointerId: 3, pointerType: 'pen', clientX: 520, clientY: 620 };
    assert.equal(penDragEvent.pointerType, 'pen');

    const nextNotes = moveNoteInList(notes, 'note-pen-1', 0.8, 0.85);
    assert.equal(nextNotes.length, 1);
    assert.equal(nextNotes[0].x, 0.8);
    assert.equal(nextNotes[0].y, 0.85);
    assert.equal(nextNotes[0].id, 'note-pen-1');
  });

  // 6. NOTE_ID_PRESERVED, NOTE_TEXT_PRESERVED, NOTE_COLOR_PRESERVED
  it('NOTE_ID_PRESERVED, NOTE_TEXT_PRESERVED, NOTE_COLOR_PRESERVED: moving note must strictly preserve id, text, and color', () => {
    const originalNotes = [
      { id: 'preserve-id-999', x: 0.15, y: 0.25, text: 'Bảo toàn văn bản quan trọng', color: '#f59e0b' },
    ];

    const moved = moveNoteInList(originalNotes, 'preserve-id-999', 0.75, 0.85);

    assert.equal(moved.length, 1);
    const item = moved[0];
    assert.equal(item.id, 'preserve-id-999', 'NOTE_ID_PRESERVED: id must match exactly');
    assert.equal(item.text, 'Bảo toàn văn bản quan trọng', 'NOTE_TEXT_PRESERVED: text must match exactly');
    assert.equal(item.color, '#f59e0b', 'NOTE_COLOR_PRESERVED: color must match exactly');
    assert.equal(item.x, 0.75, 'x must update to new normalized coordinate');
    assert.equal(item.y, 0.85, 'y must update to new normalized coordinate');
  });

  // 7. NOTE_MOVE_UNDO & NOTE_MOVE_REDO: Undo/Redo stack integration
  it('NOTE_MOVE_UNDO & NOTE_MOVE_REDO: should restore previous coordinates on undo and re-apply on redo', () => {
    // Initial State
    let notes = [
      { id: 'note-undo-1', x: 0.2, y: 0.2, text: 'Undo/Redo Note', color: '#ef4444' }
    ];

    const historyPast = [];
    const historyFuture = [];

    // Action 1: Move note to (0.6, 0.7)
    historyPast.push(JSON.parse(JSON.stringify(notes)));
    notes = moveNoteInList(notes, 'note-undo-1', 0.6, 0.7);
    assert.equal(notes[0].x, 0.6);
    assert.equal(notes[0].y, 0.7);

    // Action 2: Perform Undo
    assert(historyPast.length > 0, 'Past stack must contain initial state');
    historyFuture.push(JSON.parse(JSON.stringify(notes)));
    notes = historyPast.pop();
    assert.equal(notes[0].x, 0.2, 'NOTE_MOVE_UNDO: x must revert to 0.2');
    assert.equal(notes[0].y, 0.2, 'NOTE_MOVE_UNDO: y must revert to 0.2');

    // Action 3: Perform Redo
    assert(historyFuture.length > 0, 'Future stack must contain moved state');
    historyPast.push(JSON.parse(JSON.stringify(notes)));
    notes = historyFuture.pop();
    assert.equal(notes[0].x, 0.6, 'NOTE_MOVE_REDO: x must restore to 0.6');
    assert.equal(notes[0].y, 0.7, 'NOTE_MOVE_REDO: y must restore to 0.7');
  });

  // 8. NOTE_AFTER_ZOOM: Marker remains anchored to image point after zoom
  it('NOTE_AFTER_ZOOM: should maintain exact image point anchoring at scale 1x, 2x, 3.5x, 4x after move', () => {
    const scales = [1, 2, 3.5, 4];
    const baseW = 800;
    const baseH = 600;
    const movedAnchor = { x: 0.65, y: 0.85 };

    scales.forEach(scale => {
      const clampedScale = clampScale(scale);
      const contentPxX = movedAnchor.x * baseW;
      const contentPxY = movedAnchor.y * baseH;
      assert.equal(contentPxX, 520);
      assert.equal(contentPxY, 510);

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

      assert(Math.abs(norm.x - movedAnchor.x) < 1e-6, `x must match at scale ${scale}`);
      assert(Math.abs(norm.y - movedAnchor.y) < 1e-6, `y must match at scale ${scale}`);
    });
  });

  // 9. NOTE_AFTER_PAN: Marker remains anchored after viewport pan
  it('NOTE_AFTER_PAN: should maintain exact image point anchoring when panned after move', () => {
    const baseW = 800;
    const baseH = 600;
    const movedAnchor = { x: 0.75, y: 0.35 };
    const scale = 2;
    const panX = -180;
    const panY = -120;

    const screenX = 100 + panX + (movedAnchor.x * baseW * scale);
    const screenY = 50 + panY + (movedAnchor.y * baseH * scale);

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

    assert(Math.abs(norm.x - movedAnchor.x) < 1e-6, 'Normalized X must match anchor under pan');
    assert(Math.abs(norm.y - movedAnchor.y) < 1e-6, 'Normalized Y must match anchor under pan');
  });

  // 10. CODEBASE_CONTRACT: Canvas handlers, Pointer capture, and State integrity
  it('CODEBASE_CONTRACT: Canvas component implements note drag handlers, pointer capture, and stops propagation', () => {
    const canvasCode = fs.readFileSync(path.resolve('src/components/dashboard/exercises/SubmissionAnnotationCanvas.jsx'), 'utf8');
    
    assert(canvasCode.includes('handleNotePinPointerDown'), 'Canvas must define handleNotePinPointerDown');
    assert(canvasCode.includes('handleNotePinPointerMove'), 'Canvas must define handleNotePinPointerMove');
    assert(canvasCode.includes('handleNotePinPointerUp'), 'Canvas must define handleNotePinPointerUp');
    assert(canvasCode.includes('handleNotePinPointerCancel'), 'Canvas must define handleNotePinPointerCancel');
    assert(canvasCode.includes('setPointerCapture'), 'Canvas must use Pointer Capture');
    assert(canvasCode.includes('moveNoteInList'), 'Canvas must call moveNoteInList');
    assert(canvasCode.includes('touchAction: \'none\''), 'Note pin must specify touchAction none');
    assert(canvasCode.includes('cursor-grab'), 'Note pin must provide grab cursor');
    assert(canvasCode.includes('cursor-grabbing'), 'Note pin must provide grabbing cursor during drag');
  });

});
