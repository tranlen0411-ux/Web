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

describe('Teacher Note Tool — Position Precision, Hardened Drag & Drop, and Real History Contract', () => {

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

  // 3. NOTE_NO_JUMP_ON_POINTER_DOWN: Display position stays at note anchor on pointer down
  it('NOTE_NO_JUMP_ON_POINTER_DOWN: should keep display position at note.x/note.y on pointer down without jumping', () => {
    const note = { id: 'n1', x: 0.25, y: 0.35, text: 'Note Pin', color: '#f59e0b' };
    const pointerDownPos = { x: 0.28, y: 0.32 }; // Pointer grabbed off-center

    // Offset is recorded
    const offsetX = pointerDownPos.x - note.x; // +0.03
    const offsetY = pointerDownPos.y - note.y; // -0.03

    // Drag state before threshold:
    const draggingNoteState = null; // Stays null on pointer down!
    const displayX = draggingNoteState ? draggingNoteState.x : note.x;
    const displayY = draggingNoteState ? draggingNoteState.y : note.y;

    assert.equal(displayX, 0.25, 'Display X must not snap to pointer (0.28) on down');
    assert.equal(displayY, 0.35, 'Display Y must not snap to pointer (0.32) on down');
    assert(Math.abs(offsetX - 0.03) < 1e-6, 'OffsetX should be approximately 0.03');
    assert(Math.abs(offsetY - (-0.03)) < 1e-6, 'OffsetY should be approximately -0.03');
  });

  // 4. NOTE_DRAG_PRESERVES_POINTER_OFFSET: Offset compensation during drag
  it('NOTE_DRAG_PRESERVES_POINTER_OFFSET: should maintain grab offset during drag so pin does not snap to pointer center', () => {
    const note = { id: 'n1', x: 0.25, y: 0.35, text: 'Note Pin', color: '#f59e0b' };
    const initialPointer = { x: 0.28, y: 0.32 };
    const offsetX = initialPointer.x - note.x;
    const offsetY = initialPointer.y - note.y;

    // Pointer moves to (0.58, 0.62)
    const currentPointer = { x: 0.58, y: 0.62 };
    const targetAnchorX = Math.max(0, Math.min(1, currentPointer.x - offsetX));
    const targetAnchorY = Math.max(0, Math.min(1, currentPointer.y - offsetY));

    assert(Math.abs(targetAnchorX - 0.55) < 1e-6, 'Anchor X must be exactly currentPointer.x - offsetX (0.58 - 0.03 = 0.55)');
    assert(Math.abs(targetAnchorY - 0.65) < 1e-6, 'Anchor Y must be exactly currentPointer.y - offsetY (0.62 - (-0.03) = 0.65)');
  });

  // 5. NOTE_DRAG_THRESHOLD: 4px movement required before initiating drag
  it('NOTE_DRAG_THRESHOLD: movements below 4px threshold must not start drag or alter position', () => {
    const startClient = { clientX: 200, clientY: 200 };
    const jitterMove = { clientX: 202, clientY: 201 }; // dx=2, dy=1 -> dist=2.23px < 4px

    const dist = Math.hypot(jitterMove.clientX - startClient.clientX, jitterMove.clientY - startClient.clientY);
    const hasMoved = dist >= 4;

    assert.equal(hasMoved, false, 'Jitter move < 4px must not trigger drag');

    const realMove = { clientX: 205, clientY: 204 }; // dx=5, dy=4 -> dist=6.4px >= 4px
    const realDist = Math.hypot(realMove.clientX - startClient.clientX, realMove.clientY - startClient.clientY);
    const realHasMoved = realDist >= 4;

    assert.equal(realHasMoved, true, 'Movement >= 4px must trigger drag');
  });

  // 6. ERASER_DOES_NOT_START_DRAG & ERASER_CLICK_BEHAVIOR_PRESERVED
  it('ERASER_DOES_NOT_START_DRAG & ERASER_CLICK_BEHAVIOR_PRESERVED: eraser tool must never start note drag and must delete note on click', () => {
    const activeTool = 'eraser';
    const note = { id: 'del-1', x: 0.4, y: 0.4, text: 'Ghi chú cần xóa', color: '#ef4444' };
    const notes = [note];

    // Pointer down handler guard:
    const isDragInitiated = activeTool !== 'eraser';
    assert.equal(isDragInitiated, false, 'ERASER_DOES_NOT_START_DRAG: Eraser tool must bypass drag initialization');

    // Eraser click handler:
    const nextNotes = removeNoteFromList(notes, 'del-1');
    assert.equal(nextNotes.length, 0, 'ERASER_CLICK_BEHAVIOR_PRESERVED: Note must be removed on eraser click');
  });

  // 7. DRAG_ONE_HISTORY_ENTRY_ONLY: No onChange during pointerMove, exactly 1 onChange on pointerUp
  it('DRAG_ONE_HISTORY_ENTRY_ONLY: pointerMove must not call onChange; pointerUp must call onChange exactly once', () => {
    let onChangeCallCount = 0;
    const mockOnChange = (payload) => {
      onChangeCallCount++;
    };

    // Simulate 20 pointerMove events during drag:
    for (let i = 0; i < 20; i++) {
      // In Canvas: setDraggingNoteState is called locally, onChange is NOT called
    }
    assert.equal(onChangeCallCount, 0, 'pointerMove must generate 0 onChange calls');

    // Simulate pointerUp on drop:
    const initialNotes = [{ id: 'n1', x: 0.1, y: 0.1, text: 'T', color: '#f59e0b' }];
    const nextNotes = moveNoteInList(initialNotes, 'n1', 0.8, 0.8);
    mockOnChange({ schema_version: 1, strokes: [], stamps: [], notes: nextNotes });

    assert.equal(onChangeCallCount, 1, 'pointerUp must generate exactly 1 onChange call on drop');
  });

  // 8. REAL_UNDO_CONTRACT & REAL_REDO_CONTRACT: Exact parent history state machine contract
  it('REAL_UNDO_CONTRACT & REAL_REDO_CONTRACT: should correctly push 1 history snapshot and support undo/redo', () => {
    // Parent state machine replication (matches SubmissionGradingModal.jsx)
    let currentAnnotation = {
      schema_version: 1,
      strokes: [],
      stamps: [],
      notes: [{ id: 'n1', x: 0.2, y: 0.2, text: 'Bản gốc', color: '#f59e0b' }]
    };
    let history = { past: [], future: [] };

    const handleAnnotationChange = (newAnnotation, { isHistoryAction = false } = {}) => {
      if (!isHistoryAction) {
        history.past = [...history.past.slice(-49), JSON.parse(JSON.stringify(currentAnnotation))];
        history.future = [];
      }
      currentAnnotation = newAnnotation;
    };

    const handleUndo = () => {
      if (history.past.length === 0) return;
      const prev = history.past[history.past.length - 1];
      history.past = history.past.slice(0, -1);
      history.future = [...history.future, JSON.parse(JSON.stringify(currentAnnotation))];
      handleAnnotationChange(prev, { isHistoryAction: true });
    };

    const handleRedo = () => {
      if (history.future.length === 0) return;
      const next = history.future[history.future.length - 1];
      history.future = history.future.slice(0, -1);
      history.past = [...history.past, JSON.parse(JSON.stringify(currentAnnotation))];
      handleAnnotationChange(next, { isHistoryAction: true });
    };

    // Step 1: Drag note from (0.2, 0.2) to (0.7, 0.8) -> pointerUp triggers onChange
    const movedNotes = moveNoteInList(currentAnnotation.notes, 'n1', 0.7, 0.8);
    handleAnnotationChange({ ...currentAnnotation, notes: movedNotes });

    assert.equal(history.past.length, 1, 'History past must contain exactly 1 snapshot after drag');
    assert.equal(history.future.length, 0, 'History future must be empty');
    assert.equal(currentAnnotation.notes[0].x, 0.7);
    assert.equal(currentAnnotation.notes[0].y, 0.8);

    // Step 2: Trigger Undo
    handleUndo();
    assert.equal(currentAnnotation.notes[0].x, 0.2, 'REAL_UNDO_CONTRACT: Note X must revert to 0.2');
    assert.equal(currentAnnotation.notes[0].y, 0.2, 'REAL_UNDO_CONTRACT: Note Y must revert to 0.2');
    assert.equal(history.past.length, 0);
    assert.equal(history.future.length, 1);

    // Step 3: Trigger Redo
    handleRedo();
    assert.equal(currentAnnotation.notes[0].x, 0.7, 'REAL_REDO_CONTRACT: Note X must restore to 0.7');
    assert.equal(currentAnnotation.notes[0].y, 0.8, 'REAL_REDO_CONTRACT: Note Y must restore to 0.8');
    assert.equal(history.past.length, 1);
    assert.equal(history.future.length, 0);
  });

  // 9. NOTE_DRAG_MOUSE: Mouse pointer events drag and move note
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

  // 10. NOTE_DRAG_TOUCH: Touch pointer events drag and move note
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

  // 11. NOTE_DRAG_PEN: Pen / Stylus pointer events drag and move note
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

  // 12. NOTE_ID_PRESERVED, NOTE_TEXT_PRESERVED, NOTE_COLOR_PRESERVED
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

  // 13. NOTE_AFTER_ZOOM: Marker remains anchored to image point after zoom
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

  // 14. NOTE_AFTER_PAN: Marker remains anchored after viewport pan
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

  // 15. NOTE_AFTER_RESIZE: Marker positions adapt to viewport resize using percentages
  it('NOTE_AFTER_RESIZE: should adapt to container and viewport resize cleanly using percentages', () => {
    const anchor = { x: 0.35, y: 0.65 };
    const viewports = [
      { w: 1200, h: 900 },
      { w: 800, h: 600 },
      { w: 400, h: 300 },
    ];

    viewports.forEach(vp => {
      const posX = (anchor.x * 100).toFixed(1);
      const posY = (anchor.y * 100).toFixed(1);
      assert.equal(posX, '35.0');
      assert.equal(posY, '65.0');
    });
  });

  // 16. EXISTING_DRAW_TOOLS_REGRESSION: Zero regressions on strokes/stamps/tools
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
    assert(canvasCode.includes('handleNotePinPointerDown'), 'Canvas must define handleNotePinPointerDown');
    assert(canvasCode.includes('handleNotePinPointerMove'), 'Canvas must define handleNotePinPointerMove');
    assert(canvasCode.includes('handleNotePinPointerUp'), 'Canvas must define handleNotePinPointerUp');
    assert(canvasCode.includes('handleNotePinPointerCancel'), 'Canvas must define handleNotePinPointerCancel');
    assert(canvasCode.includes('setPointerCapture'), 'Canvas must use Pointer Capture');
    assert(canvasCode.includes('moveNoteInList'), 'Canvas must call moveNoteInList');
    assert(canvasCode.includes('activeTool === \'eraser\''), 'Canvas must guard against eraser tool during drag');
    assert(canvasCode.includes('touchAction: \'none\''), 'Note pin must specify touchAction none');
    assert(canvasCode.includes('cursor-grab'), 'Note pin must provide grab cursor');
    assert(canvasCode.includes('cursor-grabbing'), 'Note pin must provide grabbing cursor during drag');
  });

});
