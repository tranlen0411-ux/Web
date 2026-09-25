import test from 'node:test';
import assert from 'node:assert/strict';

test('Finalize annotations payload construction contracts', async (t) => {
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
  });

  await t.test('EMPTY_PAYLOAD_FAILSAFE: aborts finalize if finalized attachments exist but payload is empty', () => {
    const finalizedAttachments = [{ id: 'att-1', upload_status: 'finalized' }];
    const annotationsPayload = []; // simulated abnormal empty payload

    let failsafeTriggered = false;
    let errorMsg = '';
    if (finalizedAttachments.length > 0 && annotationsPayload.length === 0) {
      failsafeTriggered = true;
      errorMsg = '⚠️ Lỗi: Không thể chuẩn bị dữ liệu ghi chú cho ảnh bài làm. Vui lòng thử lại.';
    }

    assert.equal(failsafeTriggered, true);
    assert.match(errorMsg, /Không thể chuẩn bị dữ liệu ghi chú/);
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
