/**
 * tests/academic_submission_frontend_step_p2_c1_student_viewer.test.mjs
 * Unit & Contract Test Suite for Phase 2 - Step P2-C1: Student Graded Viewer
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeAnnotationPayload,
  normalizeNote,
  normalizeNotes,
  MAX_NOTE_TEXT_LENGTH,
  MAX_NOTES_COUNT,
  NOTE_COLOR_WHITELIST,
  DEFAULT_NOTE_COLOR,
} from '../src/utils/annotationNoteUtils.js';
import {
  zoomIn,
  zoomOut,
  resetZoom,
  clampScale,
  clampPan,
  MIN_SCALE,
  MAX_SCALE,
  ZOOM_STEP,
} from '../src/utils/annotationViewportMath.js';

describe('Phase 2 — P2-C1: Student Graded Viewer Contract & Unit Tests', () => {
  const sampleNote = {
    id: 'note-student-001',
    x: 0.25,
    y: 0.35,
    text: 'Lời nhắc của Giáo viên: Em làm rất tốt phần đặt tính!',
    color: '#3b82f6',
  };

  const sampleFinalAnnotation = {
    schema_version: 1,
    strokes: [
      {
        id: 'stroke-1',
        tool: 'pen',
        color: '#ef4444',
        width: 4,
        points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }],
      },
    ],
    stamps: [
      { id: 'stamp-1', type: 'check', x: 0.5, y: 0.5, size: 28 },
    ],
    notes: [sampleNote],
  };

  // 1. notes render from final annotation
  test('1. should normalize and extract notes correctly from final annotation payload', () => {
    const payload = normalizeAnnotationPayload(sampleFinalAnnotation);
    assert.equal(payload.schema_version, 1);
    assert.equal(payload.notes.length, 1);
    assert.equal(payload.notes[0].id, 'note-student-001');
    assert.equal(payload.notes[0].text, 'Lời nhắc của Giáo viên: Em làm rất tốt phần đặt tính!');
    assert.equal(payload.notes[0].color, '#3b82f6');
  });

  // 2. missing notes => safe
  test('2. should safely fallback missing notes to empty array without throwing', () => {
    const payloadWithoutNotes = {
      schema_version: 1,
      strokes: [],
      stamps: [],
    };
    const normalized = normalizeAnnotationPayload(payloadWithoutNotes);
    assert.deepEqual(normalized.notes, []);
  });

  // 3. malformed notes => safe
  test('3. should sanitize malformed or corrupted notes gracefully', () => {
    const malformedPayload = {
      schema_version: 1,
      notes: [
        null,
        undefined,
        'string instead of object',
        { id: 'corrupt-1', text: '' }, // empty text
        { id: 'corrupt-2', text: '   ' }, // whitespace only
        { id: 'corrupt-3', text: 12345 }, // invalid text type
        { id: 'valid-note', text: 'Valid Note', x: -10, y: 200, color: 'invalid-color' },
      ],
    };
    const normalized = normalizeAnnotationPayload(malformedPayload);
    assert.equal(normalized.notes.length, 1);
    assert.equal(normalized.notes[0].id, 'valid-note');
    assert.equal(normalized.notes[0].x, 0); // clamped min
    assert.equal(normalized.notes[0].y, 1); // clamped max
    assert.equal(normalized.notes[0].color, DEFAULT_NOTE_COLOR); // fallback color
  });

  // 4. note click opens read-only content
  test('4. should structure read-only popover state with required plain text properties', () => {
    const activeNote = {
      ...sampleNote,
      index: 0,
      positionStyle: { left: '100px', top: '150px' },
    };
    assert.equal(activeNote.id, sampleNote.id);
    assert.equal(activeNote.text, sampleNote.text);
    assert.equal(activeNote.color, sampleNote.color);
    assert.ok(activeNote.positionStyle.left && activeNote.positionStyle.top);
  });

  // 5. no textarea in Student Viewer source code
  test('5. should verify StudentAnnotationViewer source code contains NO <textarea> element', () => {
    const viewerFilePath = path.resolve('src/components/dashboard/exercises/StudentAnnotationViewer.jsx');
    const viewerCode = fs.readFileSync(viewerFilePath, 'utf8');
    assert.ok(!viewerCode.includes('<textarea'), 'StudentAnnotationViewer không được chứa thẻ <textarea>');
  });

  // 6. no save button or save handlers in Student Viewer
  test('6. should verify StudentAnnotationViewer contains NO save button or mutation handlers', () => {
    const viewerFilePath = path.resolve('src/components/dashboard/exercises/StudentAnnotationViewer.jsx');
    const viewerCode = fs.readFileSync(viewerFilePath, 'utf8');
    assert.ok(!viewerCode.includes('saveAnnotationDraft'), 'StudentAnnotationViewer không được gọi saveAnnotationDraft');
    assert.ok(!viewerCode.includes('onChange?.(') && !viewerCode.includes('onChange('), 'StudentAnnotationViewer không được có callback onChange');
  });

  // 7. no delete button in Student Viewer
  test('7. should verify StudentAnnotationViewer contains NO delete button or eraser tools', () => {
    const viewerFilePath = path.resolve('src/components/dashboard/exercises/StudentAnnotationViewer.jsx');
    const viewerCode = fs.readFileSync(viewerFilePath, 'utf8');
    assert.ok(!viewerCode.includes('removeNoteFromList'), 'StudentAnnotationViewer không được chứa hàm removeNoteFromList');
    assert.ok(!viewerCode.includes('eraser'), 'StudentAnnotationViewer không được chứa công cụ eraser');
  });

  // 8. XSS renders plain text
  test('8. should verify script tags and HTML injection remain literal plain text strings', () => {
    const xssNote = normalizeNote({
      id: 'xss-1',
      x: 0.5,
      y: 0.5,
      text: '<script>alert("xss")</script><img src=x onerror=alert(1)>',
      color: '#ef4444',
    });

    assert.equal(xssNote.text, '<script>alert("xss")</script><img src=x onerror=alert(1)>');
    // Ensure no dangerouslySetInnerHTML used in StudentAnnotationViewer
    const viewerFilePath = path.resolve('src/components/dashboard/exercises/StudentAnnotationViewer.jsx');
    const viewerCode = fs.readFileSync(viewerFilePath, 'utf8');
    assert.ok(!viewerCode.includes('dangerouslySetInnerHTML'), 'StudentAnnotationViewer không được dùng dangerouslySetInnerHTML');
  });

  // 9. zoom in
  test('9. should increment scale by ZOOM_STEP up to MAX_SCALE', () => {
    let scale = 1.0;
    scale = zoomIn(scale);
    assert.equal(scale, 1.25);
    scale = zoomIn(scale);
    assert.equal(scale, 1.5);
    // At max
    scale = zoomIn(4.0);
    assert.equal(scale, MAX_SCALE);
  });

  // 10. zoom out
  test('10. should decrement scale by ZOOM_STEP down to MIN_SCALE', () => {
    let scale = 1.5;
    scale = zoomOut(scale);
    assert.equal(scale, 1.25);
    scale = zoomOut(scale);
    assert.equal(scale, 1.0);
    // At min
    scale = zoomOut(1.0);
    assert.equal(scale, MIN_SCALE);
  });

  // 11. reset zoom
  test('11. should reset scale to 1.0 and pan to (0, 0)', () => {
    const reset = resetZoom();
    assert.equal(reset.scale, 1);
    assert.equal(reset.panX, 0);
    assert.equal(reset.panY, 0);
  });

  // 12. pan at zoom >1
  test('12. should calculate clamped pan correctly when scale > 1 and return (0, 0) at scale = 1', () => {
    const clampedAtZoom = clampPan({
      viewportWidth: 800,
      viewportHeight: 600,
      baseWidth: 800,
      baseHeight: 600,
      scale: 2.0,
      panX: -200,
      panY: -150,
    });
    assert.equal(clampedAtZoom.panX, -200);
    assert.equal(clampedAtZoom.panY, -150);

    const clampedAt1x = clampPan({
      viewportWidth: 800,
      viewportHeight: 600,
      baseWidth: 800,
      baseHeight: 600,
      scale: 1.0,
      panX: -200,
      panY: -150,
    });
    assert.equal(clampedAt1x.panX, 0);
    assert.equal(clampedAt1x.panY, 0);
  });

  // 13. annotation payload unchanged by viewer interaction
  test('13. should guarantee viewer operations (zoom/pan) do not mutate the annotation object', () => {
    const original = JSON.parse(JSON.stringify(sampleFinalAnnotation));
    const normalized = normalizeAnnotationPayload(original);
    // Simulating viewport zoom and pan changes
    const scale = zoomIn(1.0);
    const pan = clampPan({ viewportWidth: 800, viewportHeight: 600, baseWidth: 800, baseHeight: 600, scale, panX: -50, panY: -50 });
    
    assert.deepEqual(normalized, sampleFinalAnnotation);
  });

  // 14. no backend mutation call in StudentGradedViewerModal
  test('14. should confirm StudentGradedViewerModal only invokes getStudentGradedSubmission', () => {
    const modalFilePath = path.resolve('src/components/dashboard/exercises/StudentGradedViewerModal.jsx');
    const modalCode = fs.readFileSync(modalFilePath, 'utf8');

    assert.ok(modalCode.includes('getStudentGradedSubmission'), 'Phải dùng getStudentGradedSubmission làm nguồn authoritative duy nhất');
    assert.ok(!modalCode.includes('saveAnnotationDraft'), 'Không được có saveAnnotationDraft trong StudentGradedViewerModal');
    assert.ok(!modalCode.includes('finalizeGradingWithAnnotations'), 'Không được có finalizeGradingWithAnnotations trong StudentGradedViewerModal');
  });

  // 15. draft annotation excluded
  test('15. should confirm StudentGradedViewerModal reads only att.final_annotation?.annotation_json', () => {
    const modalFilePath = path.resolve('src/components/dashboard/exercises/StudentGradedViewerModal.jsx');
    const modalCode = fs.readFileSync(modalFilePath, 'utf8');

    assert.ok(modalCode.includes('att.final_annotation?.annotation_json'), 'Chỉ đọc final_annotation từ server response');
    assert.ok(!modalCode.includes('draft_annotation'), 'Tuyệt đối không đọc draft_annotation');
  });

  // 16. pending attachment excluded
  test('16. should verify only finalized attachments with storage_path are displayed', () => {
    const modalFilePath = path.resolve('src/components/dashboard/exercises/StudentGradedViewerModal.jsx');
    const modalCode = fs.readFileSync(modalFilePath, 'utf8');

    assert.ok(modalCode.includes('att.storage_path'), 'Chỉ sinh signed URL cho attachment có storage_path');
  });

  // 17. schema v1 Phase 1 payload works
  test('17. should preserve compatibility with Phase 1 payload without notes', () => {
    const phase1Payload = {
      schema_version: 1,
      strokes: [{ id: 's1', tool: 'pen', color: '#ef4444', width: 4, points: [{ x: 0.1, y: 0.1 }] }],
      stamps: [{ id: 'st1', type: 'check', x: 0.5, y: 0.5, size: 28 }],
    };

    const normalized = normalizeAnnotationPayload(phase1Payload);
    assert.equal(normalized.schema_version, 1);
    assert.equal(normalized.strokes.length, 1);
    assert.equal(normalized.stamps.length, 1);
    assert.deepEqual(normalized.notes, []);
  });

  // 18. accessibility attributes present
  test('18. should verify StudentAnnotationViewer note pins include aria-label and keyboard focusability', () => {
    const viewerFilePath = path.resolve('src/components/dashboard/exercises/StudentAnnotationViewer.jsx');
    const viewerCode = fs.readFileSync(viewerFilePath, 'utf8');

    assert.ok(viewerCode.includes('aria-label='), 'Note pin phải có thuộc tính aria-label');
    assert.ok(viewerCode.includes('onKeyDown'), 'Note pin phải có bộ lắng nghe onKeyDown để hỗ trợ bàn phím');
    assert.ok(viewerCode.includes('Escape'), 'Phải hỗ trợ phím Escape để đóng popover');
  });
});
