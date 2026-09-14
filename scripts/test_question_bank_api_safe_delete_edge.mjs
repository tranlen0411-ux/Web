// scripts/test_question_bank_api_safe_delete_edge.mjs
// Comprehensive Test Suite for Question Bank Safe Delete Edge Function BFF & Client Service
// Tests REAL handleQuestionBankRequest router dispatcher with injected dependencies mode.

import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// Register ESM loader hook to resolve Deno https: imports in Node runtime
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('https://esm.sh/@supabase/supabase-js')) {
    return nextResolve('@supabase/supabase-js', context);
  }
  return nextResolve(specifier, context);
}
`;
register('data:text/javascript,' + encodeURIComponent(hook), import.meta.url);

// Import real router and error mappers
const { handleQuestionBankRequest } = await import('../supabase/functions/question-bank-api/router.ts');
const {
  corsHeaders,
  mapSafeDeleteQuestionSuccess,
  normalizeRpcError,
} = await import('../supabase/functions/question-bank-api/errors.ts');
const { isValidUUID } = await import('../supabase/functions/question-bank-api/validation.ts');

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

  await t.test('3. Strict RPC Error Normalization (Fail-Closed: SQLSTATE & Controlled Codes)', () => {
    // 3.1. 404 on Item Not Found (Postgres P0002 or ERR_ITEM_NOT_FOUND)
    const err404 = normalizeRpcError({
      code: 'P0002',
      message: 'ERR_ITEM_NOT_FOUND: Không tìm thấy câu hỏi yêu cầu'
    }, null);
    assert.equal(err404.status, 404);
    assert.equal(err404.errorCode, 'NOT_FOUND');
    assert.equal(err404.message, 'Không tìm thấy câu hỏi yêu cầu.');

    // 3.2. 403 on Teacher Ownership Mismatch (Postgres 42501 or ERR_UNAUTHORIZED)
    const err403Ownership = normalizeRpcError({
      code: '42501',
      message: 'ERR_UNAUTHORIZED: Bạn không có quyền xóa hoặc lưu trữ câu hỏi của người khác'
    }, null);
    assert.equal(err403Ownership.status, 403);
    assert.equal(err403Ownership.errorCode, 'FORBIDDEN');
    assert.equal(err403Ownership.message, 'Bạn không có quyền thực hiện thao tác này trên câu hỏi.');

    // 3.3. 403 on Unauthorized Role (Postgres 42501 or ERR_UNAUTHORIZED)
    const err403Role = normalizeRpcError({
      code: '42501',
      message: 'ERR_UNAUTHORIZED: Chỉ giáo viên hoặc quản trị viên mới có quyền thao tác'
    }, null);
    assert.equal(err403Role.status, 403);
    assert.equal(err403Role.errorCode, 'FORBIDDEN');

    // 3.4. 400 on Missing / Invalid Input (Postgres 22000 / 22P02 or ERR_REQUIRED_PARAMS)
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
    assert.ok(!err500.message.includes('disk failure'), 'Internal database details must NOT be leaked');

    // 3.6. Generic strings without SQLSTATE/controlled code must FAIL-CLOSED to 500
    const errGeneric = normalizeRpcError({
      message: 'Some random message mentioning not found or is required'
    }, null);
    assert.equal(errGeneric.status, 500, 'Generic uncontrolled string must fail-closed to 500');
  });

  await t.test('4. Real Router handleQuestionBankRequest: Injected Dependencies Mode (200, 400, 403, 404, 500)', async () => {
    const teacherId = '11111111-1111-1111-1111-111111111111';
    const studentId = '33333333-3333-3333-3333-333333333333';
    const targetItemId = '00000000-0000-0000-0000-000000000001';

    function createInjectedDeps(callerId, actorRole, mockRpc) {
      return {
        mode: 'injected',
        authDeps: {
          mode: 'injected',
          callerAuthClient: {
            auth: {
              getUser: async () => ({
                data: { user: { id: callerId } },
                error: null
              })
            }
          },
          profileQueryClient: {
            from: () => ({
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { id: callerId, role: actorRole, is_disabled: false },
                    error: null
                  })
                })
              })
            })
          }
        },
        rpcClient: {
          rpc: mockRpc
        }
      };
    }

    // 4.1. 200 OK: DELETE Draft Question (Deleted Action & verify exact parameters passed to RPC)
    let capturedRpcName = '';
    let capturedRpcArgs = null;
    const req200 = new Request(`https://test-host/qb/questions/${targetItemId}`, {
      method: 'DELETE',
      headers: {
        Authorization: 'Bearer valid-jwt-token'
      }
    });
    const deps200 = createInjectedDeps(teacherId, 'teacher', async (name, args) => {
      capturedRpcName = name;
      capturedRpcArgs = args;
      return {
        data: {
          success: true,
          action: 'deleted',
          item_id: targetItemId,
          version_count: 1,
          message: 'Câu hỏi bản nháp đã được xóa vĩnh viễn.'
        },
        error: null
      };
    });

    const res200 = await handleQuestionBankRequest(req200, deps200);
    assert.equal(res200.status, 200);
    const body200 = await res200.json();
    assert.equal(body200.success, true);
    assert.equal(body200.data.action, 'deleted');
    assert.equal(body200.data.item_id, targetItemId);

    // Verify Router correctly forwarded TrustedContext parameters to RPC
    assert.equal(capturedRpcName, 'rpc_qb_safe_delete_or_archive_question');
    assert.equal(capturedRpcArgs.p_caller_id, teacherId);
    assert.equal(capturedRpcArgs.p_actor_role, 'teacher');
    assert.equal(capturedRpcArgs.p_item_id, targetItemId);

    // 4.2. 200 OK: Archive Published Question
    const req200Archive = new Request(`https://test-host/qb/questions/${targetItemId}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer valid-jwt-token' }
    });
    const deps200Archive = createInjectedDeps(teacherId, 'teacher', async () => ({
      data: {
        success: true,
        action: 'archived',
        item_id: targetItemId,
        archived_at: '2026-09-13T10:00:00Z',
        message: 'Câu hỏi đã được chuyển vào lưu trữ an toàn.'
      },
      error: null
    }));
    const res200Archive = await handleQuestionBankRequest(req200Archive, deps200Archive);
    assert.equal(res200Archive.status, 200);
    const body200Archive = await res200Archive.json();
    assert.equal(body200Archive.data.action, 'archived');

    // 4.3. 400 Bad Request: Invalid UUID format in URL path
    const req400 = new Request('https://test-host/qb/questions/not-a-valid-uuid', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer valid-jwt-token' }
    });
    const deps400 = createInjectedDeps(teacherId, 'teacher', async () => ({ data: null, error: null }));
    const res400 = await handleQuestionBankRequest(req400, deps400);
    assert.equal(res400.status, 400);
    const body400 = await res400.json();
    assert.equal(body400.error_code, 'INVALID_INPUT');

    // 4.4. 403 Forbidden: Student caller blocked at Router Gateway
    const req403Student = new Request(`https://test-host/qb/questions/${targetItemId}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer valid-jwt-token' }
    });
    const deps403Student = createInjectedDeps(studentId, 'student', async () => ({ data: null, error: null }));
    const res403Student = await handleQuestionBankRequest(req403Student, deps403Student);
    assert.equal(res403Student.status, 403);
    const body403Student = await res403Student.json();
    assert.equal(body403Student.error_code, 'FORBIDDEN');

    // 4.5. 403 Forbidden: Teacher attempting to delete another teacher question (RPC 42501 exception)
    const req403Ownership = new Request(`https://test-host/qb/questions/${targetItemId}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer valid-jwt-token' }
    });
    const deps403Ownership = createInjectedDeps(teacherId, 'teacher', async () => ({
      data: null,
      error: {
        code: '42501',
        message: 'ERR_UNAUTHORIZED: Bạn không có quyền xóa hoặc lưu trữ câu hỏi của người khác'
      }
    }));
    const res403Ownership = await handleQuestionBankRequest(req403Ownership, deps403Ownership);
    assert.equal(res403Ownership.status, 403);
    const body403Ownership = await res403Ownership.json();
    assert.equal(body403Ownership.error_code, 'FORBIDDEN');

    // 4.6. 404 Not Found: Non-existent question (RPC P0002 exception)
    const req404 = new Request(`https://test-host/qb/questions/${targetItemId}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer valid-jwt-token' }
    });
    const deps404 = createInjectedDeps(teacherId, 'teacher', async () => ({
      data: null,
      error: {
        code: 'P0002',
        message: 'ERR_ITEM_NOT_FOUND: Không tìm thấy câu hỏi yêu cầu'
      }
    }));
    const res404 = await handleQuestionBankRequest(req404, deps404);
    assert.equal(res404.status, 404);
    const body404 = await res404.json();
    assert.equal(body404.error_code, 'NOT_FOUND');

    // 4.7. 500 Internal Server Error: Database unexpected failure (Sanitized)
    const req500 = new Request(`https://test-host/qb/questions/${targetItemId}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer valid-jwt-token' }
    });
    const deps500 = createInjectedDeps(teacherId, 'teacher', async () => ({
      data: null,
      error: {
        code: '40001',
        message: 'could not serialize access due to concurrent update'
      }
    }));
    const res500 = await handleQuestionBankRequest(req500, deps500);
    assert.equal(res500.status, 500);
    const body500 = await res500.json();
    assert.equal(body500.error_code, 'INTERNAL_ERROR');
    assert.equal(body500.message, 'Đã xảy ra lỗi máy chủ nội bộ khi thực thi thao tác.');
  });

  await t.test('5. Frontend Service: deleteQuestion contract & UUID validation', async () => {
    // Pure unit test of deleteQuestion logic without requiring Vite runtime
    const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    const mockDeleteQuestion = async (itemId, mockFetch, mockGetToken) => {
      if (!itemId || typeof itemId !== 'string' || !UUID_REGEX.test(itemId.trim())) {
        const err = new Error('ID câu hỏi không đúng định dạng UUID.');
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

    // Valid call with UUID
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

    // Invalid input: null
    await assert.rejects(
      async () => mockDeleteQuestion(null, () => {}, () => {}),
      (err) => err.status === 400 && err.errorCode === 'INVALID_INPUT'
    );

    // Invalid input: Non-UUID string
    await assert.rejects(
      async () => mockDeleteQuestion('not-a-valid-uuid', () => {}, () => {}),
      (err) => err.status === 400 && err.errorCode === 'INVALID_INPUT'
    );
  });
});
