/**
 * Validate annotations payload structure and parity with finalized attachments
 * @param {Array} annotationsPayload
 * @param {Array} finalizedAttachments
 * @returns {boolean}
 */
export function validateAnnotationsPayload(annotationsPayload, finalizedAttachments) {
  if (!Array.isArray(annotationsPayload) || !Array.isArray(finalizedAttachments)) {
    return false;
  }
  if (annotationsPayload.length !== finalizedAttachments.length) {
    return false;
  }
  return annotationsPayload.every(
    item =>
      item &&
      typeof item === 'object' &&
      typeof item.attachment_id === 'string' &&
      item.attachment_id.trim().length > 0 &&
      typeof item.annotation_json === 'object' &&
      item.annotation_json !== null &&
      !Array.isArray(item.annotation_json) &&
      typeof item.expected_version === 'number' &&
      !Number.isNaN(item.expected_version) &&
      item.expected_version >= 0 &&
      typeof item.idempotency_key === 'string' &&
      item.idempotency_key.trim().length > 0
  );
}
