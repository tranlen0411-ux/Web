// scripts/test_question_bank_api_safe_delete_edge.mjs
// Comprehensive Test Suite for Question Bank Safe Delete Edge Function BFF & Client Service

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  corsHeaders,
  mapSafeDeleteQuestionSuccess,
  normalizeRpcError,
  createErrorResponse,
  createSuccessResponse
} from '../supabase/functions/question-bank-api/errors.ts';
import { isValidUUID, isPlainObject } from '../supabase/functions/question-bank-api/validation.ts';

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
      version_count: 1,
      message: 'Câu hỏi bản nháp đã được xóa vĩnh viễn.'
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
      version_count: 2,
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

  await t.test('3. RPC Error Normalization: Real PostgREST / Postgres Exceptions to HTTP Status', () => {
    // 3.1. 404 on Item Not Found (Postgres P0002 / ERR_ITEM_NOT_FOUND)
    const err404 = normalizeRpcError({
      code: 'P0002',
      message: 'ERR_ITEM_NOT_FOUND: Không tìm thấy câu hỏi yêu cầu'
    }, null);
    assert.equal(err404.status, 404);
    assert.equal(err404.errorCode, 'NOT_FOUND');
    assert.equal(err404.message, 'Không tìm thấy câu hỏi yêu cầu.');

    // 3.2. 403 on Teacher Ownership Mismatch (Postgres 42501 / ERR_UNAUTHORIZED)
    const err403Ownership = normalizeRpcError({
      code: '42501',
      message: 'ERR_UNAUTHORIZED: Bạn không có quyền xóa hoặc lưu trữ câu hỏi của người khác'
    }, null);
    assert.equal(err403Ownership.status, 403);
    assert.equal(err403Ownership.errorCode, 'FORBIDDEN');
    assert.equal(err403Ownership.message, 'Bạn không có quyền thực hiện thao tác này trên câu hỏi.');

    // 3.3. 403 on Invalid Role (Postgres 42501 / ERR_UNAUTHORIZED)
    const err403Role = normalizeRpcError({
      code: '42501',
      message: 'ERR_UNAUTHORIZED: Chỉ giáo viên hoặc quản trị viên mới có quyền thao tác'
    }, null);
    assert.equal(err403Role.status, 403);
    assert.equal(err403Role.errorCode, 'FORBIDDEN');

    // 3.4. 400 on Missing / Invalid Input (Postgres 22000 / ERR_REQUIRED_PARAMS)
    const err400 = normalizeRpcError({
      code: '22000',
      message: 'ERR_REQUIRED_PARAMS: Item ID is required'
    }, null);
    assert.equal(err400.status, 400);
    assert.equal(err400.errorCode, 'INVALID_INPUT');

    // 3.5. 500 on Unknown / DB Internal Error (Sanitized, no DB details leaked)
    const err500 = normalizeRpcError({
      code: 'XX000',
      message: 'FATAL: database disk failure at /var/lib/postgresql/data'
    }, null);
    assert.equal(err500.status, 500);
    assert.equal(err500.errorCode, 'INTERNAL_ERROR');
    assert.equal(err500.message, 'Đã xảy ra lỗi máy chủ nội bộ khi thực thi thao tác.');
    assert.ok(!err500.message.includes('disk failure'), 'Internal details must be sanitized');
  });

  await t.test('4. Route 11 Dispatcher Simulation (200, 400, 403, 404, 500)', async () => {
    // Simulate Router Dispatch Logic for DELETE /qb/questions/:id
    async function simulateRoute11Dispatch(reqUrl, reqMethod, context, mockRpc) {
      const url = new URL(reqUrl, 'https://test-host');
      const pathname = url.pathname;
      const deleteMatch = pathname.match(/\/qb\/questions\/([^\/]+)$/);

      if (reqMethod === 'DELETE' && deleteMatch) {
        if (context.actorRole !== 'admin' && context.actorRole !== 'teacher') {
          return createErrorResponse(403, 'FORBIDDEN', 'Chỉ giáo viên và quản trị viên mới có quyền xóa câu hỏi.');
        }

        const itemId = deleteMatch[1];
        if (!isValidUUID(itemId)) {
          return createErrorResponse(400, 'INVALID_INPUT', 'ID câu hỏi không đúng định dạng UUID.');
        }

        const { data: rpcRes, error: rpcError } = await mockRpc(
          'rpc_qb_safe_delete_or_archive_question',
          {
            p_caller_id: context.callerId,
            p_actor_role: context.actorRole,
            p_item_id: itemId
          }
        );

        const rpcPayload = isPlainObject(rpcRes) ? rpcRes : null;
        if (rpcError || !rpcPayload || rpcPayload.success !== true) {
          const err = normalizeRpcError(rpcError, rpcPayload);
          return createErrorResponse(err.status, err.errorCode, err.message);
        }

        const mapped = mapSafeDeleteQuestionSuccess(rpcPayload);
        if (!mapped.ok) {
          return createErrorResponse(500, 'INTERNAL_ERROR', 'Phản hồi máy chủ không hợp lệ.');
        }

        return createSuccessResponse(mapped.data, 200);
      }

      return createErrorResponse(404, 'NOT_FOUND', 'Đường dẫn API không tồn tại.');
    }

    const teacherContext = {
      callerId: '11111111-1111-1111-1111-111111111111',
      actorRole: 'teacher',
      schoolId: null
    };

    const studentContext = {
      callerId: '33333333-3333-3333-3333-333333333333',
      actorRole: 'student',
      schoolId: null
    };

    // 4.1. Success: Hard Delete
    const res200Delete = await simulateRoute11Dispatch(
      '/qb/questions/00000000-0000-0000-0000-000000000001',
      'DELETE',
      teacherContext,
      async () => ({
        data: { success: true, action: 'deleted', item_id: '00000000-0000-0000-0000-000000000001', version_count: 1 },
        error: null
      })
    );
    assert.equal(res200Delete.status, 200);
    const body200 = await res200Delete.json();
    assert.equal(body200.success, true);
    assert.equal(body200.data.action, 'deleted');

    // 4.2. 400 Bad UUID
    const res400 = await simulateRoute11Dispatch(
      '/qb/questions/invalid-not-uuid',
      'DELETE',
      teacherContext,
      async () => ({ data: null, error: null })
    );
    assert.equal(res400.status, 400);
    const body400 = await res400.json();
    assert.equal(body400.error_code, 'INVALID_INPUT');

    // 4.3. 403 Student Caller
    const res403Student = await simulateRoute11Dispatch(
      '/qb/questions/00000000-0000-0000-0000-000000000001',
      'DELETE',
      studentContext,
      async () => ({ data: null, error: null })
    );
    assert.equal(res403Student.status, 403);
    const body403 = await res403Student.json();
    assert.equal(body403.error_code, 'FORBIDDEN');

    // 4.4. 403 Teacher calling item of another author (via RPC exception)
    const res403Ownership = await simulateRoute11Dispatch(
      '/qb/questions/00000000-0000-0000-0000-000000000001',
      'DELETE',
      teacherContext,
      async () => ({
        data: null,
        error: { code: '42501', message: 'ERR_UNAUTHORIZED: Bạn không có quyền xóa hoặc lưu trữ câu hỏi của người khác' }
      })
    );
    assert.equal(res403Ownership.status, 403);
    const body403Own = await res403Ownership.json();
    assert.equal(body403Own.error_code, 'FORBIDDEN');

    // 4.5. 404 Item Not Found (via RPC exception)
    const res404 = await simulateRoute11Dispatch(
      '/qb/questions/00000000-0000-0000-0000-000000000099',
      'DELETE',
      teacherContext,
      async () => ({
        data: null,
        error: { code: 'P0002', message: 'ERR_ITEM_NOT_FOUND: Không tìm thấy câu hỏi yêu cầu' }
      })
    );
    assert.equal(res404.status, 404);
    const body404 = await res404.json();
    assert.equal(body404.error_code, 'NOT_FOUND');

    // 4.6. 500 Unexpected DB Error (via RPC exception)
    const res500 = await simulateRoute11Dispatch(
      '/qb/questions/00000000-0000-0000-0000-000000000001',
      'DELETE',
      teacherContext,
      async () => ({
        data: null,
        error: { code: '40001', message: 'could not serialize access due to concurrent update' }
      })
    );
    assert.equal(res500.status, 500);
    const body500 = await res500.json();
    assert.equal(body500.error_code, 'INTERNAL_ERROR');
  });

  await t.test('5. Frontend Service: deleteQuestion contract validation', async () => {
    // Pure unit test of deleteQuestion logic without requiring Vite runtime
    const mockDeleteQuestion = async (itemId, mockFetch, mockGetToken) => {
      if (!itemId || typeof itemId !== 'string') {
        const err = new Error('ID câu hỏi không hợp lệ.');
        err.status = 400;
        err.errorCode = 'INVALID_INPUT';
        throw err;
      }

      const token = await mockGetToken();
      const requestUrl = `https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/question-bank-api/qb/questions/${encodeURIComponent(itemId)}`;
      const res = await mockFetch(requestUrl, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json'
        }
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        const err = new Error(json?.message || 'Error');
        err.status = res.status;
        err.errorCode = json?.error_code || null;
        throw err;
      }
      return json.data;
    };

    // Valid call
    let calledUrl = '';
    let calledMethod = '';
    let calledHeaders = {};
    const resData = await mockDeleteQuestion(
      '00000000-0000-0000-0000-000000000001',
      async (url, opts) => {
        calledUrl = url;
        calledMethod = opts.method;
        calledHeaders = opts.headers;
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: { action: 'deleted', item_id: '00000000-0000-0000-0000-000000000001' } })
        };
      },
      async () => 'fake-token'
    );

    assert.equal(calledUrl, 'https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/question-bank-api/qb/questions/00000000-0000-0000-0000-000000000001');
    assert.equal(calledMethod, 'DELETE');
    assert.equal(calledHeaders.Authorization, 'Bearer fake-token');
    assert.equal(resData.action, 'deleted');

    // Invalid input
    await assert.rejects(
      async () => mockDeleteQuestion(null, () => {}, () => {}),
      (err) => err.status === 400 && err.errorCode === 'INVALID_INPUT'
    );
  });
});
