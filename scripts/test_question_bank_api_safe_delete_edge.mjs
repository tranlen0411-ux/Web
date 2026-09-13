// scripts/test_question_bank_api_safe_delete_edge.mjs
// Test Suite for Question Bank Safe Delete Edge Function & Client Service

import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteQuestion } from '../src/services/questionBankService.js';
import { corsHeaders, mapSafeDeleteQuestionSuccess, normalizeRpcError } from '../supabase/functions/question-bank-api/errors.ts';
import { isValidUUID } from '../supabase/functions/question-bank-api/validation.ts';

test('Question Bank Safe Delete BFF & Client Service Suite', async (t) => {
  await t.test('1. CORS: Access-Control-Allow-Methods includes DELETE', () => {
    assert.ok(corsHeaders['Access-Control-Allow-Methods'].includes('DELETE'), 'CORS must permit DELETE');
    assert.ok(corsHeaders['Access-Control-Allow-Methods'].includes('GET'));
    assert.ok(corsHeaders['Access-Control-Allow-Methods'].includes('POST'));
    assert.ok(corsHeaders['Access-Control-Allow-Methods'].includes('PATCH'));
    assert.ok(corsHeaders['Access-Control-Allow-Methods'].includes('OPTIONS'));
  });

  await t.test('2. Error & Success Mappers: mapSafeDeleteQuestionSuccess projection', () => {
    // Valid deleted response
    const validDeleted = {
      success: true,
      action: 'deleted',
      item_id: '00000000-0000-0000-0000-000000000001',
      message: 'Câu hỏi đã được xóa vĩnh viễn.'
    };
    const mapped1 = mapSafeDeleteQuestionSuccess(validDeleted);
    assert.equal(mapped1.ok, true);
    assert.equal(mapped1.data.action, 'deleted');
    assert.equal(mapped1.data.item_id, '00000000-0000-0000-0000-000000000001');

    // Valid archived response
    const validArchived = {
      success: true,
      action: 'archived',
      item_id: '00000000-0000-0000-0000-000000000002',
      archived_at: '2026-09-13T10:00:00Z',
      message: 'Câu hỏi đã được chuyển vào lưu trữ an toàn.'
    };
    const mapped2 = mapSafeDeleteQuestionSuccess(validArchived);
    assert.equal(mapped2.ok, true);
    assert.equal(mapped2.data.action, 'archived');
    assert.equal(mapped2.data.archived_at, '2026-09-13T10:00:00Z');

    // Valid already_archived response
    const validAlready = {
      success: true,
      action: 'already_archived',
      item_id: '00000000-0000-0000-0000-000000000003',
      message: 'Câu hỏi đã ở trạng thái lưu trữ từ trước.'
    };
    const mapped3 = mapSafeDeleteQuestionSuccess(validAlready);
    assert.equal(mapped3.ok, true);
    assert.equal(mapped3.data.action, 'already_archived');

    // Invalid payload projection fails closed
    const invalidPayload = {
      success: true,
      action: 'invalid_action_unknown',
      item_id: 'bad-uuid'
    };
    const mapped4 = mapSafeDeleteQuestionSuccess(invalidPayload);
    assert.equal(mapped4.ok, false);
  });

  await t.test('3. RPC Error Normalization for Delete/Archive', () => {
    // 404 on ITEM_NOT_FOUND
    const err404 = normalizeRpcError(null, { success: false, error_code: 'ITEM_NOT_FOUND' });
    assert.equal(err404.status, 404);
    assert.equal(err404.errorCode, 'NOT_FOUND');

    // 403 on FORBIDDEN
    const err403 = normalizeRpcError(null, { success: false, error_code: 'FORBIDDEN' });
    assert.equal(err403.status, 403);
    assert.equal(err403.errorCode, 'FORBIDDEN');

    // 401 on UNAUTHORIZED_CALLER
    const err401 = normalizeRpcError(null, { success: false, error_code: 'UNAUTHORIZED_CALLER' });
    assert.equal(err401.status, 401);
    assert.equal(err401.errorCode, 'UNAUTHORIZED');
  });

  await t.test('4. Route Matching Regex and UUID validation for DELETE', () => {
    const validUrl1 = '/functions/v1/question-bank-api/qb/questions/00000000-0000-0000-0000-000000000001';
    const match1 = validUrl1.match(/\/qb\/questions\/([^\/]+)$/);
    assert.ok(match1);
    assert.equal(match1[1], '00000000-0000-0000-0000-000000000001');
    assert.equal(isValidUUID(match1[1]), true);

    const invalidUrl = '/functions/v1/question-bank-api/qb/questions/not-a-uuid';
    const match2 = invalidUrl.match(/\/qb\/questions\/([^\/]+)$/);
    assert.ok(match2);
    assert.equal(match2[1], 'not-a-uuid');
    assert.equal(isValidUUID(match2[1]), false);

    const subPathUrl = '/functions/v1/question-bank-api/qb/questions/00000000-0000-0000-0000-000000000001/versions';
    const match3 = subPathUrl.match(/\/qb\/questions\/([^\/]+)$/);
    assert.equal(match3, null, 'Subpaths should not match delete route');
  });

  await t.test('5. Frontend Service: deleteQuestion input validation', async () => {
    await assert.rejects(
      async () => {
        await deleteQuestion(null);
      },
      (err) => err.errorCode === 'INVALID_INPUT' && err.status === 400
    );

    await assert.rejects(
      async () => {
        await deleteQuestion(12345);
      },
      (err) => err.errorCode === 'INVALID_INPUT' && err.status === 400
    );
  });
});
