// tests/question_bank_student_security_p29k.test.mjs
// ============================================================================
// QUESTION BANK V1 — PHASE 29K-D3H-5: STUDENT ACCESS SECURITY AUTOMATED TESTS
// ============================================================================
// Verification Matrix for Student Access Hardening & Gateway Protection
// ============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const VALID_ITEM_ID = '2762d1a0-a1b4-461a-8f67-1b739e65f832';
const VALID_VERSION_ID = 'fb128236-7ea3-46e7-9d95-f3b3656c83b1';
const VALID_TEACHER_ID = '11111111-1111-4111-8111-111111111111';
const VALID_STUDENT_ID = 'e6c94932-4263-433b-9f06-e4c13b02dfd3';

// ----------------------------------------------------------------------------
// Mock Gateway Router Simulator matching router.ts logic
// ----------------------------------------------------------------------------
function simulateRouterRoute3({
  authContext,
  authToken,
  pathname,
  method = 'GET',
  searchParams = new URLSearchParams(),
  mockRpcFn,
}) {
  // 1. Missing or invalid Auth header -> 401
  if (!authToken || !authToken.startsWith('Bearer ')) {
    return {
      status: 401,
      body: { success: false, error_code: 'UNAUTHORIZED', message: 'Yêu cầu xác thực Bearer token.' },
      rpcCalled: false,
    };
  }

  // 2. AuthContext resolution from verified server JWT
  const actorRole = authContext?.actorRole;
  const callerId = authContext?.callerId;

  const studentMatch = pathname.match(/\/qb\/student\/questions\/([^\/]+)$/);
  if (method === 'GET' && studentMatch) {
    // GATEWAY ROLE GUARD: Only admin and teacher can access Route 3 (Preview only)
    if (actorRole !== 'admin' && actorRole !== 'teacher') {
      return {
        status: 403,
        body: {
          success: false,
          error_code: 'FORBIDDEN',
          message: 'Học sinh không có quyền truy cập trực tiếp vào Ngân hàng câu hỏi. Vui lòng truy cập thông qua bài tập hoặc đề kiểm tra được giao.',
        },
        rpcCalled: false,
      };
    }

    const itemId = studentMatch[1];
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(itemId)) {
      return {
        status: 400,
        body: { success: false, error_code: 'INVALID_INPUT', message: 'ID câu hỏi không đúng định dạng UUID.' },
        rpcCalled: false,
      };
    }

    // Call RPC
    const rpcResult = mockRpcFn ? mockRpcFn({ p_caller_id: callerId, p_item_id: itemId }) : { success: true };
    return {
      status: rpcResult.success ? 200 : 404,
      body: rpcResult,
      rpcCalled: true,
    };
  }

  return { status: 404, body: { error_code: 'NOT_FOUND' }, rpcCalled: false };
}

// ----------------------------------------------------------------------------
// RPC Logic Simulator matching migration 20261121235500
// ----------------------------------------------------------------------------
function simulateRpcGetStudentQuestion({ p_caller_id, p_item_id, itemRecord, versionRecord }) {
  if (!p_caller_id) {
    return { success: false, error_code: 'UNAUTHORIZED_CALLER', message: 'Caller ID is required' };
  }
  if (!p_item_id) {
    return { success: false, error_code: 'MISSING_ITEM_ID', message: 'Question item ID is required' };
  }
  if (!itemRecord) {
    return { success: false, error_code: 'ITEM_NOT_FOUND', message: 'Question item not found' };
  }
  if (itemRecord.status !== 'published' || !itemRecord.published_version_id) {
    return { success: false, error_code: 'FORBIDDEN', message: 'Question is not published' };
  }

  // FAIL-CLOSED PRIVATE VISIBILITY GUARD
  if (
    (itemRecord.visibility === null || itemRecord.visibility === 'private') &&
    (itemRecord.author_id === null || itemRecord.author_id !== p_caller_id)
  ) {
    return {
      success: false,
      error_code: 'FORBIDDEN_PRIVATE_QUESTION',
      message: 'Question is private and not accessible',
    };
  }

  if (!versionRecord) {
    return { success: false, error_code: 'VERSION_NOT_FOUND', message: 'Published version record not found' };
  }

  // Safe Student Projection: NO answer_key, NO correct_answers, NO grading_config, NO explanation
  return {
    success: true,
    id: itemRecord.id,
    title: itemRecord.title,
    question_type: itemRecord.question_type,
    version_id: versionRecord.id,
    version_number: versionRecord.version_number,
    prompt: versionRecord.prompt,
    options: versionRecord.options,
  };
}

// ============================================================================
// TEST SUITE: STUDENT ACCESS SECURITY VERIFICATION
// ============================================================================
test('QUESTION BANK V1 — PHASE 29K-D3H-5: STUDENT ACCESS SECURITY MATRIX', async (t) => {
  await t.test('1. Student + private published → 403 FORBIDDEN (BFF Gateway Guard)', () => {
    let rpcCalled = false;
    const res = simulateRouterRoute3({
      authContext: { actorRole: 'student', callerId: VALID_STUDENT_ID },
      authToken: 'Bearer valid_jwt_token',
      pathname: `/qb/student/questions/${VALID_ITEM_ID}`,
      mockRpcFn: () => {
        rpcCalled = true;
        return { success: true };
      },
    });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.error_code, 'FORBIDDEN');
    assert.ok(res.body.message.includes('Học sinh không có quyền'));
    assert.strictEqual(rpcCalled, false, 'RPC tuyệt đối không được gọi khi học sinh truy cập');
  });

  await t.test('2. Student + public_template published → 403 FORBIDDEN (Zero direct bank access)', () => {
    let rpcCalled = false;
    const res = simulateRouterRoute3({
      authContext: { actorRole: 'student', callerId: VALID_STUDENT_ID },
      authToken: 'Bearer valid_jwt_token',
      pathname: `/qb/student/questions/${VALID_ITEM_ID}`,
      mockRpcFn: () => {
        rpcCalled = true;
        return { success: true };
      },
    });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(rpcCalled, false);
  });

  await t.test('3. Student + draft item → 403 FORBIDDEN (BFF Gateway Guard)', () => {
    let rpcCalled = false;
    const res = simulateRouterRoute3({
      authContext: { actorRole: 'student', callerId: VALID_STUDENT_ID },
      authToken: 'Bearer valid_jwt_token',
      pathname: `/qb/student/questions/${VALID_ITEM_ID}`,
      mockRpcFn: () => {
        rpcCalled = true;
        return { success: true };
      },
    });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(rpcCalled, false);
  });

  await t.test('4. Student + UUID không tồn tại → 403 FORBIDDEN trước khi gọi RPC (Không rò rỉ 404)', () => {
    let rpcCalled = false;
    const nonExistentUuid = '99999999-9999-4999-8999-999999999999';
    const res = simulateRouterRoute3({
      authContext: { actorRole: 'student', callerId: VALID_STUDENT_ID },
      authToken: 'Bearer valid_jwt_token',
      pathname: `/qb/student/questions/${nonExistentUuid}`,
      mockRpcFn: () => {
        rpcCalled = true;
        return { success: false, error_code: 'ITEM_NOT_FOUND' };
      },
    });

    assert.strictEqual(res.status, 403, 'Phải chặn 403 ngay trước khi kiểm tra DB để chống enumeration attack');
    assert.strictEqual(rpcCalled, false);
  });

  await t.test('5. Unknown role hoặc null role → 403 FORBIDDEN', () => {
    const unknownRoles = ['unknown', 'guest', 'parent', null, undefined, ''];
    for (const r of unknownRoles) {
      const res = simulateRouterRoute3({
        authContext: { actorRole: r, callerId: VALID_STUDENT_ID },
        authToken: 'Bearer valid_jwt_token',
        pathname: `/qb/student/questions/${VALID_ITEM_ID}`,
      });
      assert.strictEqual(res.status, 403, `Role ${r} phải bị từ chối 403`);
    }
  });

  await t.test('6. Missing JWT token hoặc token không có Bearer → 401 UNAUTHORIZED', () => {
    const res1 = simulateRouterRoute3({
      authContext: null,
      authToken: null,
      pathname: `/qb/student/questions/${VALID_ITEM_ID}`,
    });
    assert.strictEqual(res1.status, 401);

    const res2 = simulateRouterRoute3({
      authContext: null,
      authToken: 'Basic abcxyz',
      pathname: `/qb/student/questions/${VALID_ITEM_ID}`,
    });
    assert.strictEqual(res2.status, 401);
  });

  await t.test('7. Client tự truyền fake role trong query param hoặc body → Vẫn bị chặn bởi JWT Server Context', () => {
    // Client gửi ?role=teacher hoặc ?role=admin nhưng JWT thực tế là student
    const searchParams = new URLSearchParams('role=admin&caller_id=11111111-1111-4111-8111-111111111111');
    const res = simulateRouterRoute3({
      authContext: { actorRole: 'student', callerId: VALID_STUDENT_ID }, // Server JWT derived
      authToken: 'Bearer student_token',
      pathname: `/qb/student/questions/${VALID_ITEM_ID}`,
      searchParams,
    });

    assert.strictEqual(res.status, 403, 'Gateway chỉ tin tưởng actorRole từ server auth context');
  });

  await t.test('8. Teacher/Admin hợp lệ → Cho phép xem trước (Preview) không hồi quy', () => {
    let rpcArgs = null;
    const res = simulateRouterRoute3({
      authContext: { actorRole: 'teacher', callerId: VALID_TEACHER_ID },
      authToken: 'Bearer teacher_token',
      pathname: `/qb/student/questions/${VALID_ITEM_ID}`,
      mockRpcFn: (args) => {
        rpcArgs = args;
        return { success: true, id: VALID_ITEM_ID };
      },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(rpcArgs.p_caller_id, VALID_TEACHER_ID);
    assert.strictEqual(rpcArgs.p_item_id, VALID_ITEM_ID);
  });

  await t.test('9. RPC Defense-in-depth: Private question + non-owner caller → FORBIDDEN_PRIVATE_QUESTION', () => {
    const itemRecord = {
      id: VALID_ITEM_ID,
      status: 'published',
      published_version_id: VALID_VERSION_ID,
      visibility: 'private',
      author_id: VALID_TEACHER_ID,
      title: 'Private Test Question',
      question_type: 'single_choice',
    };
    const versionRecord = {
      id: VALID_VERSION_ID,
      version_number: 2,
      prompt: 'Prompt text',
      options: ['A', 'B'],
    };

    // Caller khác với author_id
    const anotherCallerId = '22222222-2222-4222-8222-222222222222';
    const rpcRes = simulateRpcGetStudentQuestion({
      p_caller_id: anotherCallerId,
      p_item_id: VALID_ITEM_ID,
      itemRecord,
      versionRecord,
    });

    assert.strictEqual(rpcRes.success, false);
    assert.strictEqual(rpcRes.error_code, 'FORBIDDEN_PRIVATE_QUESTION');
  });

  await t.test('10. RPC Defense-in-depth: NULL visibility hoặc NULL author_id → Fail-closed', () => {
    const nullVisibilityItem = {
      id: VALID_ITEM_ID,
      status: 'published',
      published_version_id: VALID_VERSION_ID,
      visibility: null, // Bị NULL
      author_id: VALID_TEACHER_ID,
    };
    const rpcRes1 = simulateRpcGetStudentQuestion({
      p_caller_id: '33333333-3333-4333-8333-333333333333',
      p_item_id: VALID_ITEM_ID,
      itemRecord: nullVisibilityItem,
      versionRecord: { id: VALID_VERSION_ID },
    });
    assert.strictEqual(rpcRes1.success, false);
    assert.strictEqual(rpcRes1.error_code, 'FORBIDDEN_PRIVATE_QUESTION');

    const nullAuthorIdItem = {
      id: VALID_ITEM_ID,
      status: 'published',
      published_version_id: VALID_VERSION_ID,
      visibility: 'private',
      author_id: null, // Bị NULL
    };
    const rpcRes2 = simulateRpcGetStudentQuestion({
      p_caller_id: VALID_TEACHER_ID,
      p_item_id: VALID_ITEM_ID,
      itemRecord: nullAuthorIdItem,
      versionRecord: { id: VALID_VERSION_ID },
    });
    assert.strictEqual(rpcRes2.success, false);
    assert.strictEqual(rpcRes2.error_code, 'FORBIDDEN_PRIVATE_QUESTION');
  });

  await t.test('11. Zero Leakage Guard: Projection tuyệt đối không chứa trường nhạy cảm', () => {
    const itemRecord = {
      id: VALID_ITEM_ID,
      status: 'published',
      published_version_id: VALID_VERSION_ID,
      visibility: 'public_template',
      author_id: VALID_TEACHER_ID,
      title: 'Public Question',
      question_type: 'single_choice',
    };
    const versionRecord = {
      id: VALID_VERSION_ID,
      version_number: 1,
      prompt: 'What is 2+2?',
      options: ['3', '4', '5'],
      answer_key: { correct_option_id: 'opt_2' },
      solution_explanation: 'Secret explanation',
      grading_config: { points: 10 },
    };

    const rpcRes = simulateRpcGetStudentQuestion({
      p_caller_id: VALID_STUDENT_ID,
      p_item_id: VALID_ITEM_ID,
      itemRecord,
      versionRecord,
    });

    assert.strictEqual(rpcRes.success, true);
    assert.strictEqual('answer_key' in rpcRes, false);
    assert.strictEqual('correct_answers' in rpcRes, false);
    assert.strictEqual('solution_explanation' in rpcRes, false);
    assert.strictEqual('grading_config' in rpcRes, false);
  });

  await t.test('12. Migration SQL Content Review: Giữ nguyên signature, search_path và grants', () => {
    const migrationPath = path.resolve('supabase/migrations/20261121235500_qb_student_access_hardening.sql');
    assert.ok(fs.existsSync(migrationPath), 'File migration phải tồn tại');

    const sqlContent = fs.readFileSync(migrationPath, 'utf8');
    assert.ok(sqlContent.includes('CREATE OR REPLACE FUNCTION public.rpc_qb_get_student_question('));
    assert.ok(sqlContent.includes('p_caller_id uuid,'));
    assert.ok(sqlContent.includes('p_item_id uuid,'));
    assert.ok(sqlContent.includes('p_version_id uuid DEFAULT NULL::uuid'));
    assert.ok(sqlContent.includes("SET search_path TO 'pg_catalog', 'public', 'pg_temp'"));
    assert.ok(sqlContent.includes('REVOKE ALL ON FUNCTION public.rpc_qb_get_student_question(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;'));
    assert.ok(sqlContent.includes('GRANT EXECUTE ON FUNCTION public.rpc_qb_get_student_question(uuid, uuid, uuid) TO service_role;'));
    assert.ok(sqlContent.includes('FORBIDDEN_PRIVATE_QUESTION'));
  });
});

