// src/services/examIntegrityLifecycle.js
// Exam Builder V1 - Phase 3D Frontend Integrity DOM Lifecycle Adapter
// Strictly manages 1:1 event binding for visibilitychange, blur, and focus.
// Zero debounce, zero throttle, zero synthetic mount events, idempotent attach/detach.

export function createIntegrityLifecycle(options = {}) {
  const {
    queue,
    targetDocument = globalThis.document,
    targetWindow = globalThis.window,
  } = options;

  if (!queue || typeof queue.enqueue !== 'function') {
    throw new Error('createIntegrityLifecycle requires a valid queue with an enqueue method.');
  }

  let isAttachedState = false;

  const handleVisibilityChange = () => {
    if (!isAttachedState || !targetDocument) {
      return;
    }
    const state = targetDocument.visibilityState;
    if (state === 'hidden') {
      queue.enqueue('page_hidden');
    } else if (state === 'visible') {
      queue.enqueue('page_visible');
    }
  };

  const handleBlur = () => {
    if (!isAttachedState) {
      return;
    }
    queue.enqueue('window_blur');
  };

  const handleFocus = () => {
    if (!isAttachedState) {
      return;
    }
    queue.enqueue('window_focus');
  };

  const attach = () => {
    if (isAttachedState) {
      return; // Idempotent
    }
    isAttachedState = true;

    if (targetDocument && typeof targetDocument.addEventListener === 'function') {
      targetDocument.addEventListener('visibilitychange', handleVisibilityChange);
    }
    if (targetWindow && typeof targetWindow.addEventListener === 'function') {
      targetWindow.addEventListener('blur', handleBlur);
      targetWindow.addEventListener('focus', handleFocus);
    }
  };

  const detach = () => {
    if (!isAttachedState) {
      return; // Idempotent
    }
    isAttachedState = false;

    if (targetDocument && typeof targetDocument.removeEventListener === 'function') {
      targetDocument.removeEventListener('visibilitychange', handleVisibilityChange);
    }
    if (targetWindow && typeof targetWindow.removeEventListener === 'function') {
      targetWindow.removeEventListener('blur', handleBlur);
      targetWindow.removeEventListener('focus', handleFocus);
    }
  };

  const isAttached = () => isAttachedState;

  return {
    attach,
    detach,
    isAttached,
  };
}
