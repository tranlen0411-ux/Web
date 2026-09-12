// src/components/dashboard/exams/examOptionUtils.js
// Utility helpers for Exam Builder choice option schema normalization and option deletion re-indexing

/**
 * Deletes an option at `deleteIndex` from single_choice options, reindexes remaining keys to A, B, C...,
 * and remaps correct_answer so that it continues pointing to the exact same remaining option content.
 * If the selected correct option itself was deleted, falls back to the first remaining option (key 'A').
 *
 * @param {Array<{key: string, text: string}>} options
 * @param {string} correctKey
 * @param {number} deleteIndex
 * @returns {{ options: Array<{key: string, text: string}>, correctKey: string }}
 */
export function deleteSingleChoiceOption(options, correctKey, deleteIndex) {
  if (!Array.isArray(options) || options.length <= 2) {
    return { options: options || [], correctKey: correctKey || 'A' };
  }

  // 1. Identify which option was selected as correct by index in old array
  const oldCorrectIndex = options.findIndex((opt, idx) => {
    const key = typeof opt === 'object' && opt !== null ? opt.key : String.fromCharCode(65 + idx);
    return key === correctKey;
  });

  // 2. Remove the option at deleteIndex
  const remaining = options.filter((_, idx) => idx !== deleteIndex);

  // 3. Re-index remaining options to sequential keys 'A', 'B', 'C', ...
  const reindexed = remaining.map((item, i) => ({
    key: String.fromCharCode(65 + i),
    text: typeof item === 'object' && item !== null ? item.text : String(item ?? ''),
  }));

  // 4. Remap correct_answer
  let newCorrectKey;
  if (oldCorrectIndex === -1 || oldCorrectIndex === deleteIndex) {
    // Selected correct option was deleted or not found: fallback to first remaining option
    newCorrectKey = reindexed[0].key;
  } else {
    // Option survived: remap to new key of the same remaining option
    const newCorrectIndex = oldCorrectIndex > deleteIndex ? oldCorrectIndex - 1 : oldCorrectIndex;
    newCorrectKey = reindexed[newCorrectIndex].key;
  }

  return {
    options: reindexed,
    correctKey: newCorrectKey,
  };
}
