/**
 * src/utils/annotationNoteUtils.js
 * Pure utilities for Text Note Schema, Validation, and Defensive Normalization (Phase 2 - P2-B1)
 */

export const MAX_NOTE_TEXT_LENGTH = 500;
export const MAX_NOTES_COUNT = 20;

export const NOTE_COLOR_WHITELIST = [
  '#ef4444', // Red
  '#3b82f6', // Blue
  '#10b981', // Green
  '#f59e0b', // Amber / Yellow (Default)
  '#64748b', // Slate / Gray
];

export const DEFAULT_NOTE_COLOR = '#f59e0b';

/**
 * Generate a standard UUID for a note element
 * @returns {string}
 */
export function generateNoteId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Validate whether a color is in the note color whitelist
 * @param {string} color
 * @returns {boolean}
 */
export function isValidNoteColor(color) {
  return typeof color === 'string' && NOTE_COLOR_WHITELIST.includes(color);
}

/**
 * Clamp a number strictly to [min, max], returning fallback if not finite
 * @param {*} val
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampCoord(val, min = 0, max = 1, fallback = 0) {
  const num = typeof val === 'number' ? val : parseFloat(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

/**
 * Normalize and validate a single note item
 * Returns null if the note is fundamentally invalid or empty.
 * 
 * @param {Object} rawNote
 * @returns {{ id: string, x: number, y: number, text: string, color: string } | null}
 */
export function normalizeNote(rawNote) {
  if (!rawNote || typeof rawNote !== 'object') return null;

  // 1. Text validation (plain text only, trimmed, non-empty, max 500 chars)
  if (typeof rawNote.text !== 'string') return null;
  const trimmed = rawNote.text.trim();
  if (trimmed.length === 0) return null;
  const sanitizedText = trimmed.slice(0, MAX_NOTE_TEXT_LENGTH);

  // 2. ID validation
  const id = typeof rawNote.id === 'string' && rawNote.id.trim().length > 0
    ? rawNote.id.trim()
    : generateNoteId();

  // 3. Coordinate validation (clamped to [0, 1])
  const x = clampCoord(rawNote.x, 0, 1, 0.5);
  const y = clampCoord(rawNote.y, 0, 1, 0.5);

  // 4. Color validation (whitelisted only)
  const color = isValidNoteColor(rawNote.color) ? rawNote.color : DEFAULT_NOTE_COLOR;

  return {
    id,
    x,
    y,
    text: sanitizedText,
    color,
  };
}

/**
 * Normalize an array of notes, discarding invalid entries and capping at MAX_NOTES_COUNT (20)
 * @param {Array} rawNotes
 * @returns {Array<{ id: string, x: number, y: number, text: string, color: string }>}
 */
export function normalizeNotes(rawNotes) {
  if (!Array.isArray(rawNotes)) return [];

  const valid = [];
  for (const item of rawNotes) {
    if (valid.length >= MAX_NOTES_COUNT) break;
    const normalized = normalizeNote(item);
    if (normalized) {
      valid.push(normalized);
    }
  }
  return valid;
}

/**
 * Defensive Normalization for entire Annotation Payload
 * Supports Phase 1 payload backwards-compatibility and sanitizes notes array.
 * 
 * @param {Object} rawPayload
 * @returns {{ schema_version: number, strokes: Array, stamps: Array, notes: Array }}
 */
export function normalizeAnnotationPayload(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return {
      schema_version: 1,
      strokes: [],
      stamps: [],
      notes: [],
    };
  }

  return {
    schema_version: rawPayload.schema_version === 1 ? 1 : 1,
    strokes: Array.isArray(rawPayload.strokes) ? [...rawPayload.strokes] : [],
    stamps: Array.isArray(rawPayload.stamps) ? [...rawPayload.stamps] : [],
    notes: normalizeNotes(rawPayload.notes),
  };
}

/**
 * Update an existing note in the notes array by its ID
 * Preserves the original note's id, x, y coordinates while updating text and color.
 * If validation fails or noteId is not found, returns original array.
 * 
 * @param {Array} notes
 * @param {string} noteId
 * @param {{ text: string, color?: string }} updateFields
 * @returns {Array}
 */
export function updateNoteInList(notes, noteId, updateFields) {
  if (!Array.isArray(notes) || !noteId || !updateFields) return notes || [];
  
  const existingIndex = notes.findIndex(n => n && n.id === noteId);
  if (existingIndex === -1) return notes;

  const originalNote = notes[existingIndex];
  const validated = normalizeNote({
    id: originalNote.id,
    x: originalNote.x,
    y: originalNote.y,
    text: updateFields.text,
    color: updateFields.color || originalNote.color,
  });

  if (!validated) return notes;

  const nextNotes = [...notes];
  nextNotes[existingIndex] = validated;
  return nextNotes;
}

/**
 * Remove a note from the notes array by its ID
 * 
 * @param {Array} notes
 * @param {string} noteId
 * @returns {Array}
 */
export function removeNoteFromList(notes, noteId) {
  if (!Array.isArray(notes) || !noteId) return notes || [];
  return notes.filter(n => n && n.id !== noteId);
}

