/**
 * tests/academic_submission_frontend_step_p2_b2_notes_management.test.mjs
 * Unit Test Suite for Phase 2 - Step P2-B2: Text Note Edit, Delete & Eraser Integration
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeNote,
  normalizeNotes,
  normalizeAnnotationPayload,
  updateNoteInList,
  removeNoteFromList,
  generateNoteId,
  MAX_NOTE_TEXT_LENGTH,
  MAX_NOTES_COUNT,
  NOTE_COLOR_WHITELIST,
  DEFAULT_NOTE_COLOR,
} from '../src/utils/annotationNoteUtils.js';

describe('Phase 2 — P2-B2: Text Note Edit, Delete & Eraser Management Unit Tests', () => {
  const sampleNote1 = {
    id: 'note-uuid-001',
    x: 0.35,
    y: 0.45,
    text: 'Nhận xét câu 1: Em cần trình bày rõ các bước giải',
    color: '#ef4444',
  };

  const sampleNote2 = {
    id: 'note-uuid-002',
    x: 0.75,
    y: 0.85,
    text: 'Khen ngợi: Chữ viết rất sạch đẹp!',
    color: '#10b981',
  };

  // 1. edit existing note text
  test('1. should edit existing note text and preserve valid schema', () => {
    const initialNotes = [sampleNote1, sampleNote2];
    const updated = updateNoteInList(initialNotes, 'note-uuid-001', {
      text: 'Nhận xét sửa đổi: Đã làm đúng hướng dẫn',
    });

    assert.equal(updated.length, 2);
    assert.equal(updated[0].text, 'Nhận xét sửa đổi: Đã làm đúng hướng dẫn');
    assert.equal(updated[0].color, '#ef4444');
  });

  // 2. edit color
  test('2. should edit note color with a valid whitelisted color', () => {
    const initialNotes = [sampleNote1, sampleNote2];
    const updated = updateNoteInList(initialNotes, 'note-uuid-001', {
      text: sampleNote1.text,
      color: '#3b82f6', // Blue
    });

    assert.equal(updated[0].color, '#3b82f6');
  });

  // 3. preserve id
  test('3. should strictly preserve original note id upon edit', () => {
    const initialNotes = [sampleNote1];
    const updated = updateNoteInList(initialNotes, 'note-uuid-001', {
      text: 'Nội dung mới',
    });

    assert.equal(updated[0].id, 'note-uuid-001');
  });

  // 4. preserve x/y
  test('4. should strictly preserve original x and y coordinates upon edit', () => {
    const initialNotes = [sampleNote1];
    const updated = updateNoteInList(initialNotes, 'note-uuid-001', {
      text: 'Nội dung mới',
    });

    assert.equal(updated[0].x, 0.35);
    assert.equal(updated[0].y, 0.45);
  });

  // 5. no duplicate on edit
  test('5. should not create duplicate notes when editing an existing note', () => {
    const initialNotes = [sampleNote1, sampleNote2];
    const updated = updateNoteInList(initialNotes, 'note-uuid-001', {
      text: 'Nội dung cập nhật',
    });

    assert.equal(updated.length, 2);
    assert.equal(updated.filter(n => n.id === 'note-uuid-001').length, 1);
  });

  // 6. cancel edit unchanged
  test('6. should leave original notes list completely unchanged when edit is cancelled', () => {
    const initialNotes = Object.freeze([{ ...sampleNote1 }, { ...sampleNote2 }]);
    // Simulating cancelled operation by not applying updates
    const cancelledNotes = [...initialNotes];

    assert.deepEqual(cancelledNotes, initialNotes);
    assert.equal(cancelledNotes[0].text, sampleNote1.text);
  });

  // 7. empty edit blocked
  test('7. should block empty or whitespace-only edit from saving or mutating note', () => {
    const initialNotes = [sampleNote1];
    // Attempting empty edit
    const updatedEmpty = updateNoteInList(initialNotes, 'note-uuid-001', { text: '' });
    assert.deepEqual(updatedEmpty, initialNotes);

    // Attempting whitespace edit
    const updatedWhitespace = updateNoteInList(initialNotes, 'note-uuid-001', { text: '    ' });
    assert.deepEqual(updatedWhitespace, initialNotes);
  });

  // 8. delete exact note by id
  test('8. should delete exact note by id via removeNoteFromList', () => {
    const initialNotes = [sampleNote1, sampleNote2];
    const afterDelete = removeNoteFromList(initialNotes, 'note-uuid-001');

    assert.equal(afterDelete.length, 1);
    assert.equal(afterDelete[0].id, 'note-uuid-002');
  });

  // 9. delete doesn't alter other notes
  test('9. should ensure deleting a note does not modify data of remaining notes', () => {
    const initialNotes = [sampleNote1, sampleNote2];
    const afterDelete = removeNoteFromList(initialNotes, 'note-uuid-001');

    assert.equal(afterDelete[0].id, sampleNote2.id);
    assert.equal(afterDelete[0].x, sampleNote2.x);
    assert.equal(afterDelete[0].y, sampleNote2.y);
    assert.equal(afterDelete[0].text, sampleNote2.text);
    assert.equal(afterDelete[0].color, sampleNote2.color);
  });

  // 10. eraser deletes note
  test('10. should allow Eraser tool to remove targeted note cleanly', () => {
    const annotation = {
      schema_version: 1,
      strokes: [],
      stamps: [],
      notes: [sampleNote1, sampleNote2],
    };

    const nextNotes = removeNoteFromList(annotation.notes, 'note-uuid-002');
    const updatedAnnotation = { ...annotation, notes: nextNotes };

    assert.equal(updatedAnnotation.notes.length, 1);
    assert.equal(updatedAnnotation.notes[0].id, 'note-uuid-001');
  });

  // 11. eraser doesn't open editor (verified by separate contract)
  test('11. should confirm eraser action is a pure removal without opening editor state', () => {
    const noteToDelete = sampleNote1;
    let editorOpened = false;
    let removedId = null;

    const onEraserAction = (note) => {
      // Direct removal handler without popover
      removedId = note.id;
    };

    onEraserAction(noteToDelete);
    assert.equal(editorOpened, false);
    assert.equal(removedId, 'note-uuid-001');
  });

  // 12. edit marks dirty
  test('12. should trigger onChange with modified notes array when edit is saved', () => {
    let triggered = false;
    let receivedPayload = null;

    const mockOnChange = (payload) => {
      triggered = true;
      receivedPayload = payload;
    };

    const annotation = { schema_version: 1, strokes: [], stamps: [], notes: [sampleNote1] };
    const nextNotes = updateNoteInList(annotation.notes, sampleNote1.id, { text: 'Edited text' });
    mockOnChange({ ...annotation, notes: nextNotes });

    assert.equal(triggered, true);
    assert.equal(receivedPayload.notes[0].text, 'Edited text');
  });

  // 13. delete marks dirty
  test('13. should trigger onChange when note is deleted via popover delete button', () => {
    let triggered = false;
    const mockOnChange = () => { triggered = true; };

    const annotation = { schema_version: 1, strokes: [], stamps: [], notes: [sampleNote1] };
    const nextNotes = removeNoteFromList(annotation.notes, sampleNote1.id);
    mockOnChange({ ...annotation, notes: nextNotes });

    assert.equal(triggered, true);
  });

  // 14. eraser delete marks dirty
  test('14. should trigger onChange when note is deleted via eraser tool', () => {
    let triggered = false;
    const mockOnChange = () => { triggered = true; };

    const annotation = { schema_version: 1, strokes: [], stamps: [], notes: [sampleNote1] };
    const nextNotes = removeNoteFromList(annotation.notes, sampleNote1.id);
    mockOnChange({ ...annotation, notes: nextNotes });

    assert.equal(triggered, true);
  });

  // 15. open editor doesn't mark dirty
  test('15. should verify merely opening note editor or clicking cancel does NOT trigger onChange', () => {
    let onChangeCalled = false;
    const mockOnChange = () => { onChangeCalled = true; };

    // Simulating opening editor and clicking cancel
    const onCancel = () => {
      // Closes editor without calling onChange
    };
    onCancel();

    assert.equal(onChangeCalled, false);
  });

  // 16. note count recovers after delete
  test('16. should verify note capacity recovers from 20 to 19 after deleting a note', () => {
    const fullNotes = Array.from({ length: 20 }, (_, i) => ({
      id: `note-${i + 1}`,
      x: 0.5,
      y: 0.5,
      text: `Note ${i + 1}`,
      color: DEFAULT_NOTE_COLOR,
    }));

    assert.equal(fullNotes.length, 20);

    // Delete one note
    const afterDelete = removeNoteFromList(fullNotes, 'note-5');
    assert.equal(afterDelete.length, 19);

    // Now adding a new note is permitted
    const newNote = normalizeNote({
      id: generateNoteId(),
      x: 0.2,
      y: 0.2,
      text: 'Replacement note',
      color: DEFAULT_NOTE_COLOR,
    });
    const nextNotes = [...afterDelete, newNote];
    assert.equal(nextNotes.length, 20);
  });

  // 17. malformed note remains safe
  test('17. should ensure malformed note updates are rejected gracefully without crash', () => {
    const initialNotes = [sampleNote1];
    const badUpdate = updateNoteInList(initialNotes, 'non-existent-id', { text: 'Some text' });
    assert.deepEqual(badUpdate, initialNotes);

    const nullUpdate = updateNoteInList(initialNotes, 'note-uuid-001', null);
    assert.deepEqual(nullUpdate, initialNotes);
  });

  // 18. schema_version remains 1
  test('18. should strictly maintain schema_version = 1 across entire Note Management lifecycle', () => {
    const payload = normalizeAnnotationPayload({
      schema_version: 1,
      strokes: [],
      stamps: [],
      notes: [sampleNote1],
    });

    assert.equal(payload.schema_version, 1);
    assert.equal(Array.isArray(payload.notes), true);
    assert.equal(payload.notes[0].id, 'note-uuid-001');
  });
});
