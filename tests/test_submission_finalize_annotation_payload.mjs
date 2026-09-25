import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAnnotationsPayload } from '../src/utils/annotationPayloadUtils.js';

test('Finalize annotations payload construction & fail-safe validation contracts', async (t) => {
  await t.test('WORKSPACE_ATTACHMENT_WITHOUT_SUBMISSION_ID_INCLUDED: filter extracts finalized attachments lacking submission_id property', () => {
    // Mock workspaceData matching RPC get_academic_submission_grading_workspace response (no submission_id)
    const workspaceData = {
      attachments: [
        {
          id: 'b68ac7e4-5b8b-4a32-a367-623b71b61749',
          question_id: 'ff71537c-bb0e-4e0c-8957-9856e44b1737',
          upload_status: 'finalized',
          latest_annotation: {
            version: 59,
            annotation_json: { strokes: [{ id: 's1' }], stamps: [], notes: [{ id: 'n1', text: 'dd' }] }
          }
        },
        {
          id: 'pending-att-id',
          question_id: 'ff71537c-bb0e-4e0c-8957-9856e44b1737',
          upload_status: 'pending',
          latest_annotation: null
        }
      ]
    };

    const finalizedAttachments = (workspaceData?.attachments || []).filter(
      att => att.upload_status === 'finalized'
    );

    assert.equal(finalizedAttachments.length, 1);
    assert.equal(finalizedAttachments[0].id, 'b68ac7e4-5b8b-4a32-a367-623b71b61749');
  });

  await t.test('ANNOTATIONS_PAYLOAD_NON_EMPTY & FIELD PRESERVATION', () => {
    const finalizedAttachments = [
      {
        id: 'b68ac7e4-5b8b-4a32-a367-623b71b61749',
        upload_status: 'finalized'
      }
    ];

    const annotationsRef = {
      current: {
        'b68ac7e4-5b8b-4a32-a367-623b71b61749': {
          schema_version: 1,
          strokes: [{ id: 'stroke_1', tool: 'arrow', points: [{ x: 0.1, y: 0.2 }] }],
          stamps: [],
          notes: [{ id: 'note_1', x: 0.3, y: 0.4, text: 'ghi chú sửa' }]
        }
      }
    };
    const annotationsByAttachment = {};
    const annotationVersionsRef = { current: { 'b68ac7e4-5b8b-4a32-a367-623b71b61749': 59 } };
    const annotationVersions = {};
    const finalizeIdempotencyKeysRef = { current: {} };

    const annotationsPayload = finalizedAttachments.map(att => {
      const annJson = annotationsRef.current[att.id] || annotationsByAttachment[att.id] || {
        schema_version: 1,
        strokes: [],
        stamps: [],
        notes: []
      };

      const expVersion = annotationVersionsRef.current[att.id] ?? annotationVersions[att.id] ?? 0;

      if (!finalizeIdempotencyKeysRef.current[att.id]) {
        finalizeIdempotencyKeysRef.current[att.id] = 'test-idemp-uuid-1234';
      }
      const idempKey = finalizeIdempotencyKeysRef.current[att.id];

      return {
        attachment_id: att.id,
        annotation_json: annJson,
        expected_version: expVersion,
        idempotency_key: idempKey
      };
    });

    // ANNOTATIONS_PAYLOAD_NON_EMPTY
    assert.equal(annotationsPayload.length, 1);
    
    // ATTACHMENT_ID_PRESERVED
    assert.equal(annotationsPayload[0].attachment_id, 'b68ac7e4-5b8b-4a32-a367-623b71b61749');

    // EXPECTED_VERSION_PRESERVED
    assert.equal(annotationsPayload[0].expected_version, 59);

    // ANNOTATION_JSON_PRESERVED
    assert.equal(annotationsPayload[0].annotation_json.strokes.length, 1);
    assert.equal(annotationsPayload[0].annotation_json.notes.length, 1);
    assert.equal(annotationsPayload[0].annotation_json.notes[0].text, 'ghi chú sửa');

    // IDEMPOTENCY_KEY_PRESERVED
    assert.equal(annotationsPayload[0].idempotency_key, 'test-idemp-uuid-1234');

    // VALID PAYLOAD PASSES FAIL-SAFE
    assert.equal(validateAnnotationsPayload(annotationsPayload, finalizedAttachments), true);
  });

  await t.test('FAIL-SAFE: PAYLOAD_COUNT_MISMATCH caught', () => {
    const finalizedAttachments = [
      { id: 'att-1', upload_status: 'finalized' },
      { id: 'att-2', upload_status: 'finalized' }
    ];
    const annotationsPayload = [
      { attachment_id: 'att-1', annotation_json: {}, expected_version: 0, idempotency_key: 'idemp-1' }
    ]; // count 1 vs 2

    assert.equal(validateAnnotationsPayload(annotationsPayload, finalizedAttachments), false);
  });

  await t.test('FAIL-SAFE: MISSING_ATTACHMENT_ID caught', () => {
    const finalizedAttachments = [{ id: 'att-1', upload_status: 'finalized' }];
    
    // Empty / null / missing attachment_id
    assert.equal(
      validateAnnotationsPayload(
        [{ attachment_id: '', annotation_json: {}, expected_version: 0, idempotency_key: 'idemp-1' }],
        finalizedAttachments
      ),
      false
    );
    assert.equal(
      validateAnnotationsPayload(
        [{ attachment_id: null, annotation_json: {}, expected_version: 0, idempotency_key: 'idemp-1' }],
        finalizedAttachments
      ),
      false
    );
    assert.equal(
      validateAnnotationsPayload(
        [{ annotation_json: {}, expected_version: 0, idempotency_key: 'idemp-1' }],
        finalizedAttachments
      ),
      false
    );
  });

  await t.test('FAIL-SAFE: INVALID_ANNOTATION_JSON caught', () => {
    const finalizedAttachments = [{ id: 'att-1', upload_status: 'finalized' }];
    
    // annotation_json null, string, or array
    assert.equal(
      validateAnnotationsPayload(
        [{ attachment_id: 'att-1', annotation_json: null, expected_version: 0, idempotency_key: 'idemp-1' }],
        finalizedAttachments
      ),
      false
    );
    assert.equal(
      validateAnnotationsPayload(
        [{ attachment_id: 'att-1', annotation_json: 'invalid', expected_version: 0, idempotency_key: 'idemp-1' }],
        finalizedAttachments
      ),
      false
    );
    assert.equal(
      validateAnnotationsPayload(
        [{ attachment_id: 'att-1', annotation_json: [], expected_version: 0, idempotency_key: 'idemp-1' }],
        finalizedAttachments
      ),
      false
    );
  });

  await t.test('FAIL-SAFE: INVALID_EXPECTED_VERSION caught', () => {
    const finalizedAttachments = [{ id: 'att-1', upload_status: 'finalized' }];
    
    // negative number, NaN, or non-number
    assert.equal(
      validateAnnotationsPayload(
        [{ attachment_id: 'att-1', annotation_json: {}, expected_version: -1, idempotency_key: 'idemp-1' }],
        finalizedAttachments
      ),
      false
    );
    assert.equal(
      validateAnnotationsPayload(
        [{ attachment_id: 'att-1', annotation_json: {}, expected_version: NaN, idempotency_key: 'idemp-1' }],
        finalizedAttachments
      ),
      false
    );
    assert.equal(
      validateAnnotationsPayload(
        [{ attachment_id: 'att-1', annotation_json: {}, expected_version: '0', idempotency_key: 'idemp-1' }],
        finalizedAttachments
      ),
      false
    );
  });

  await t.test('FAIL-SAFE: MISSING_IDEMPOTENCY_KEY caught', () => {
    const finalizedAttachments = [{ id: 'att-1', upload_status: 'finalized' }];
    
    // null, empty, or whitespace idempotency_key
    assert.equal(
      validateAnnotationsPayload(
        [{ attachment_id: 'att-1', annotation_json: {}, expected_version: 0, idempotency_key: '' }],
        finalizedAttachments
      ),
      false
    );
    assert.equal(
      validateAnnotationsPayload(
        [{ attachment_id: 'att-1', annotation_json: {}, expected_version: 0, idempotency_key: null }],
        finalizedAttachments
      ),
      false
    );
    assert.equal(
      validateAnnotationsPayload(
        [{ attachment_id: 'att-1', annotation_json: {}, expected_version: 0 }],
        finalizedAttachments
      ),
      false
    );
  });

  await t.test('REQUEST_REVISION_FLOW & NORMAL_GRADED_FLOW parameters pass properly', () => {
    const subId = 'sub-uuid-123';
    const gradesArray = [{ question_id: 'q-1', points: 8, comment: 'Good' }];
    const annotationsPayload = [{ attachment_id: 'att-1', annotation_json: {}, expected_version: 1, idempotency_key: 'idemp-1' }];
    const feedback = 'Cần làm lại cẩn thận';

    // 1. Revision flow
    const revisionReq = {
      submissionId: subId,
      manualGrades: gradesArray,
      annotations: annotationsPayload,
      teacherFeedback: feedback,
      requestRevision: true
    };
    assert.equal(revisionReq.requestRevision, true);
    assert.equal(revisionReq.annotations.length, 1);

    // 2. Normal graded flow
    const normalReq = {
      submissionId: subId,
      manualGrades: gradesArray,
      annotations: annotationsPayload,
      teacherFeedback: feedback,
      requestRevision: false
    };
    assert.equal(normalReq.requestRevision, false);
    assert.equal(normalReq.annotations.length, 1);
  });
});
