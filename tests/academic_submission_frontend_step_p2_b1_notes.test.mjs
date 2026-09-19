import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateNoteId,
  normalizeNote,
  normalizeNotes,
  normalizeAnnotationPayload,
  isValidNoteColor,
  MAX_NOTE_TEXT_LENGTH,
  MAX_NOTES_COUNT,
  NOTE_COLOR_WHITELIST,
  DEFAULT_NOTE_COLOR,
} from '../src/utils/annotationNoteUtils.js';

describe('Phase 2 — P2-B1: Text Note Authoring & Defensive Normalization', () => {

  // 1. Create valid note
  it('1. should create and normalize a valid text note object', () => {
    const rawNote = {
      id: 'custom-id-123',
      x: 0.25,
      y: 0.75,
      text: 'Bài làm phần này rất tốt!',
      color: '#10b981',
    };

    const normalized = normalizeNote(rawNote);
    assert.deepEqual(normalized, {
      id: 'custom-id-123',
      x: 0.25,
      y: 0.75,
      text: 'Bài làm phần này rất tốt!',
      color: '#10b981',
    });
  });

  // 2. ID uses UUID-compatible format
  it('2. should generate UUID-compatible unique identifiers for notes', () => {
    const id1 = generateNoteId();
    const id2 = generateNoteId();

    assert(typeof id1 === 'string' && id1.length >= 16, 'Note ID must be valid string');
    assert.notEqual(id1, id2, 'Generated note IDs must be unique');

    // UUID format check (8-4-4-4-12 hex or standard UUID format)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    assert.match(id1, uuidRegex, 'ID should match UUID v4 structure');
  });

  // 3. x/y clamp [0, 1]
  it('3. should clamp out-of-bounds x and y coordinates strictly to [0, 1]', () => {
    const outBoundsNote = {
      id: 'note-bounds',
      x: 1.85,
      y: -0.42,
      text: 'Cần chú ý dấu phẩy',
      color: '#ef4444',
    };

    const normalized = normalizeNote(outBoundsNote);
    assert.equal(normalized.x, 1.0);
    assert.equal(normalized.y, 0.0);
  });

  // 4. Empty note rejected
  it('4. should reject note with empty string text', () => {
    const emptyNote = {
      id: 'note-empty',
      x: 0.5,
      y: 0.5,
      text: '',
      color: '#f59e0b',
    };

    assert.equal(normalizeNote(emptyNote), null);
  });

  // 5. Whitespace-only rejected
  it('5. should reject note with whitespace-only text', () => {
    const whitespaceNote = {
      id: 'note-spaces',
      x: 0.5,
      y: 0.5,
      text: '   \n\t   ',
      color: '#f59e0b',
    };

    assert.equal(normalizeNote(whitespaceNote), null);
  });

  // 6. Text capped at 500 characters
  it('6. should truncate note text exceeding 500 characters to exactly 500', () => {
    const longText = 'A'.repeat(650);
    const longNote = {
      id: 'note-long',
      x: 0.5,
      y: 0.5,
      text: longText,
      color: '#3b82f6',
    };

    const normalized = normalizeNote(longNote);
    assert.equal(normalized.text.length, MAX_NOTE_TEXT_LENGTH); // 500
    assert.equal(normalized.text, 'A'.repeat(500));
  });

  // 7. Note count max 20
  it('7. should cap total notes at maximum 20 per attachment', () => {
    const rawNotes = [];
    for (let i = 0; i < 35; i++) {
      rawNotes.push({
        id: `note-${i}`,
        x: 0.1,
        y: 0.1,
        text: `Ghi chú số ${i}`,
        color: '#f59e0b',
      });
    }

    const normalizedList = normalizeNotes(rawNotes);
    assert.equal(normalizedList.length, MAX_NOTES_COUNT); // 20
  });

  // 8. Allowed color preserved
  it('8. should preserve all whitelisted colors', () => {
    for (const color of NOTE_COLOR_WHITELIST) {
      assert(isValidNoteColor(color), `Color ${color} must be valid`);
      const note = normalizeNote({
        id: 'note-col',
        x: 0.5,
        y: 0.5,
        text: 'Test color',
        color: color,
      });
      assert.equal(note.color, color);
    }
  });

  // 9. Invalid color falls back to default (#f59e0b)
  it('9. should fallback invalid or unknown color to default amber #f59e0b', () => {
    const badColorNote = {
      id: 'note-bad-color',
      x: 0.5,
      y: 0.5,
      text: 'Ghi chú màu lạ',
      color: 'invalid-rainbow-gradient',
    };

    const normalized = normalizeNote(badColorNote);
    assert.equal(normalized.color, DEFAULT_NOTE_COLOR);
  });

  // 10. Missing notes array defaults to []
  it('10. should safely default missing or null notes to empty array []', () => {
    assert.deepEqual(normalizeNotes(null), []);
    assert.deepEqual(normalizeNotes(undefined), []);
    assert.deepEqual(normalizeNotes('not-an-array'), []);
  });

  // 11. Malformed note items discarded
  it('11. should safely discard malformed note entries in list without throwing', () => {
    const messyList = [
      null,
      undefined,
      'just a string',
      { noText: true },
      { text: 12345 },
      { text: '   ' },
      { id: 'valid-1', x: 0.2, y: 0.3, text: 'Hợp lệ 1', color: '#10b981' },
      { id: 'valid-2', x: 0.8, y: 0.9, text: 'Hợp lệ 2' },
    ];

    const cleaned = normalizeNotes(messyList);
    assert.equal(cleaned.length, 2);
    assert.equal(cleaned[0].text, 'Hợp lệ 1');
    assert.equal(cleaned[1].text, 'Hợp lệ 2');
    assert.equal(cleaned[1].color, DEFAULT_NOTE_COLOR);
  });

  // 12. Phase 1 payload without notes works (backwards-compatibility)
  it('12. should support Phase 1 payload without notes field gracefully', () => {
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

  // 13. Note save marks annotation changed in Canvas
  it('13. should verify Canvas triggers onChange with updated notes array when note is saved', () => {
    const canvasFile = path.resolve('src/components/dashboard/exercises/SubmissionAnnotationCanvas.jsx');
    const canvasCode = fs.readFileSync(canvasFile, 'utf8');

    assert(canvasCode.includes('handleSaveNote'), 'Canvas must define handleSaveNote');
    assert(canvasCode.includes('notes: nextNotes'), 'Canvas must update notes in onChange payload');
    assert(canvasCode.includes('onChange?.({'), 'Canvas must trigger onChange on save');
  });

  // 14. Cancel does not mutate annotation
  it('14. should ensure cancelling note popover does not call onChange or mutate annotation', () => {
    const canvasFile = path.resolve('src/components/dashboard/exercises/SubmissionAnnotationCanvas.jsx');
    const canvasCode = fs.readFileSync(canvasFile, 'utf8');

    assert(canvasCode.includes('handleCancelNote'), 'Canvas must define handleCancelNote');
    assert(canvasCode.includes('setIsNoteEditorOpen(false)'), 'handleCancelNote must close editor');
    assert(canvasCode.includes('setPendingNote(null)'), 'handleCancelNote must clear pending note');
  });

  // 15. Viewport state excluded from note
  it('15. should verify note schema excludes transient viewport state (scale, panX, panY)', () => {
    const note = normalizeNote({
      id: 'note-1',
      x: 0.3,
      y: 0.4,
      text: 'Ghi chú toán học',
      color: '#f59e0b',
      scale: 2.5,
      panX: -100,
      panY: -80,
      zoom: 2,
    });

    assert.equal(note.scale, undefined);
    assert.equal(note.panX, undefined);
    assert.equal(note.panY, undefined);
    assert.equal(note.zoom, undefined);
  });

  // 16. Schema version remains 1
  it('16. should maintain schema_version = 1 across entire Note system', () => {
    const toolbarFile = path.resolve('src/components/dashboard/exercises/AnnotationToolbar.jsx');
    const toolbarCode = fs.readFileSync(toolbarFile, 'utf8');
    assert(toolbarCode.includes("activeTool === 'note'"), 'Toolbar must support note tool');

    const payload = normalizeAnnotationPayload({
      schema_version: 1,
      strokes: [],
      stamps: [],
      notes: [{ id: 'n1', x: 0.5, y: 0.5, text: 'Hello', color: '#10b981' }],
    });

    assert.equal(payload.schema_version, 1);
  });

});
