// supabase/functions/question-bank-api/router.test.ts
// Question Bank User-Facing BFF REST Router In-Memory Unit Tests V1 (56 Tests Suite)

import {
  assertEquals,
  assertStrictEquals,
} from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  handleQuestionBankRequest,
  RouterDependencies,
} from './router.ts';
import {
  CallerAuthClient,
  ProfileQueryClient,
  InjectedAuthDependencies,
  RpcClient,
  UserFacingQuestionBankRpc,
} from './authMiddleware.ts';

// ----------------------------------------------------------------------------
// Test Fixtures & Constants
// ----------------------------------------------------------------------------

const VALID_ITEM_ID = '00000000-0000-0000-0000-000000000001';
const VALID_VERSION_ID = '00000000-0000-0000-0000-000000000002';
const VALID_USER_ID = '11111111-1111-1111-1111-111111111111';
const VALID_STUDENT_ID = '22222222-2222-2222-2222-222222222222';

// ----------------------------------------------------------------------------
// Local Type Guards & Helpers
// ----------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

// Narrowly scoped helper để ép kiểu fixture dị tật cho Dependency Fail-Closed Tests (RT-53, RT-54)
function asMalformedRouterDependencies(value: unknown): RouterDependencies {
  return value as unknown as RouterDependencies;
}

function createTestRequest(
  url: string,
  options: {
    method?: string;
    authHeader?: string;
    body?: string | Record<string, unknown>;
  } = {}
): Request {
  const headers = new Headers();
  if (options.authHeader !== undefined) {
    headers.set('Authorization', options.authHeader);
  } else {
    // Mặc định gắn header auth hợp lệ cho test
    headers.set('Authorization', 'Bearer valid-token-test');
  }

  const method = options.method || 'GET';
  let bodyContent: string | undefined;

  if (options.body !== undefined) {
    if (typeof options.body === 'string') {
      bodyContent = options.body;
    } else {
      bodyContent = JSON.stringify(options.body);
      headers.set('Content-Type', 'application/json');
    }
  }

  return new Request(url, {
    method,
    headers,
    body: bodyContent,
  });
}

// ----------------------------------------------------------------------------
// Typed Mock Factories
// ----------------------------------------------------------------------------

interface MockRpcCall {
  name: UserFacingQuestionBankRpc;
  args: Record<string, unknown>;
}

type MockRpcResult = {
  data: unknown;
  error: unknown;
};

function createMockRpcClient(config: {
  data?: unknown;
  error?: unknown;
  handler?: (name: UserFacingQuestionBankRpc, args: Record<string, unknown>) => MockRpcResult;
} = {}) {
  const calls: MockRpcCall[] = [];

  const client: RpcClient = {
    async rpc(name: UserFacingQuestionBankRpc, args: Record<string, unknown>): Promise<MockRpcResult> {
      calls.push({ name, args });
      if (config.handler) {
        return config.handler(name, args);
      }
      return {
        data: config.data !== undefined ? config.data : null,
        error: config.error !== undefined ? config.error : null,
      };
    },
  };

  return { client, calls };
}

function createMockAuthDeps(config: {
  userId?: string;
  role?: 'admin' | 'teacher' | 'student';
  isDisabled?: boolean;
  getUserError?: unknown;
  profileError?: unknown;
  nullProfile?: boolean;
} = {}) {
  const userId = config.userId || VALID_USER_ID;
  const role = config.role || 'teacher';
  const isDisabled = config.isDisabled || false;

  let getUserCalls = 0;
  let maybeSingleCalls = 0;

  const callerAuthClient: CallerAuthClient = {
    auth: {
      async getUser() {
        getUserCalls++;
        if (config.getUserError) {
          return { data: { user: null }, error: config.getUserError };
        }
        return {
          data: { user: { id: userId } },
          error: null,
        };
      },
    },
  };

  const profileQueryClient: ProfileQueryClient = {
    from(_table: 'profiles') {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _val: string) {
              return {
                async maybeSingle() {
                  maybeSingleCalls++;
                  if (config.profileError) {
                    return { data: null, error: config.profileError };
                  }
                  if (config.nullProfile) {
                    return { data: null, error: null };
                  }
                  return {
                    data: {
                      id: userId,
                      role,
                      is_disabled: isDisabled,
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  const authDeps: InjectedAuthDependencies = {
    mode: 'injected',
    callerAuthClient,
    profileQueryClient,
  };

  return {
    authDeps,
    spies: {
      get getUserCalls() {
        return getUserCalls;
      },
      get maybeSingleCalls() {
        return maybeSingleCalls;
      },
    },
  };
}

function createRouterDeps(
  authDeps: InjectedAuthDependencies,
  rpcClient: RpcClient
): RouterDependencies {
  return {
    mode: 'injected',
    authDeps,
    rpcClient,
  };
}

// ----------------------------------------------------------------------------
// Assertion Helpers
// ----------------------------------------------------------------------------

async function assertErrorResponse(
  res: Response,
  expectedStatus: number,
  expectedErrorCode: string,
  expectedErrorMessage: string,
  forbiddenSubstrings?: string[]
): Promise<void> {
  assertStrictEquals(res.status, expectedStatus);
  assertStrictEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
  assertStrictEquals(res.headers.get('Content-Type'), 'application/json');

  const json: unknown = await res.json();
  if (!isRecord(json)) {
    throw new Error('Expected response body to be a plain object');
  }
  assertStrictEquals(json.success, false);
  assertStrictEquals(json.error_code, expectedErrorCode);
  assertStrictEquals(json.message, expectedErrorMessage);

  if (forbiddenSubstrings && forbiddenSubstrings.length > 0) {
    const rawText = JSON.stringify(json);
    for (const forbidden of forbiddenSubstrings) {
      if (rawText.toLowerCase().includes(forbidden.toLowerCase())) {
        throw new Error(`Public response leaked raw sensitive substring: "${forbidden}"`);
      }
    }
  }
}

async function assertSuccessResponse<T = Record<string, unknown>>(
  res: Response,
  expectedStatus: number,
  validator?: (data: T) => void
): Promise<T> {
  assertStrictEquals(res.status, expectedStatus);
  assertStrictEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
  assertStrictEquals(res.headers.get('Content-Type'), 'application/json');

  const json: unknown = await res.json();
  if (!isRecord(json)) {
    throw new Error('Expected response body to be a plain object');
  }
  assertStrictEquals(json.success, true);
  if (!('data' in json)) {
    throw new Error('Expected success envelope to contain data field');
  }
  const data = json.data as T;
  if (validator) {
    validator(data);
  }
  return data;
}

// ============================================================================
// Group A: Routing, HTTP Methods, Preflight & 404 Boundaries (7 Tests: RT-01 — RT-07)
// ============================================================================

Deno.test('RT-01 - OPTIONS Preflight Request -> 200 OK with CORS', async () => {
  const req = new Request('https://example.test/qb/questions', { method: 'OPTIONS' });
  const res = await handleQuestionBankRequest(req);

  assertStrictEquals(res.status, 200);
  assertStrictEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
  const bodyText = await res.text();
  assertStrictEquals(bodyText, 'ok');
});

Deno.test('RT-02 - Route không tồn tại -> 404 NOT_FOUND', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/unknown_endpoint');
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(res, 404, 'NOT_FOUND', 'Đường dẫn API không tồn tại.');
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-03 - Method không được hỗ trợ (DELETE /qb/questions) -> 404 NOT_FOUND', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/questions', { method: 'DELETE' });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(res, 404, 'NOT_FOUND', 'Đường dẫn API không tồn tại.');
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-04 - Trailing slash URL (/qb/questions/) normalizes to list route -> 200 OK', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient({
    data: { success: true, total_count: 0, page: 1, page_size: 20, items: [] },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/questions/');
  const res = await handleQuestionBankRequest(req, deps);

  await assertSuccessResponse(res, 200);
  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_list_questions');
});

Deno.test('RT-05 - ID câu hỏi không phải UUID (/qb/questions/bad-id/versions) -> 400 INVALID_INPUT', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/questions/not-a-valid-uuid/versions', {
    method: 'POST',
    body: { prompt: 'Valid Prompt', answer_key: { correct: 'A' } },
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(res, 400, 'INVALID_INPUT', 'ID câu hỏi không đúng định dạng UUID.');
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-06 - ID học sinh không phải UUID (/qb/student/questions/bad-id) -> 400 INVALID_INPUT', async () => {
  const mockAuth = createMockAuthDeps({ role: 'student', userId: VALID_STUDENT_ID });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/student/questions/123-bad-uuid');
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(res, 400, 'INVALID_INPUT', 'ID câu hỏi không đúng định dạng UUID.');
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-07 - VersionId nguồn không phải UUID (/qb/versions/bad-id/fork) -> 400 INVALID_INPUT', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/versions/invalid-uuid-format/fork', {
    method: 'POST',
    body: {},
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    400,
    'INVALID_INPUT',
    'ID phiên bản nguồn (versionId) không đúng định dạng UUID.'
  );
  assertStrictEquals(mockRpc.calls.length, 0);
});

// ============================================================================
// Group B: Auth Context, Role Enforcement & Identity Propagation (8 Tests: RT-08 — RT-15)
// ============================================================================

Deno.test('RT-08 - Thiếu Header Authorization -> 401 UNAUTHORIZED', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = new Request('https://example.test/qb/questions', { method: 'GET' });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    401,
    'UNAUTHORIZED',
    'Yêu cầu xác thực Bearer token trong header Authorization.'
  );
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-09 - Tài khoản bị vô hiệu hóa (is_disabled: true) -> 403 FORBIDDEN', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher', isDisabled: true });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/questions');
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(res, 403, 'FORBIDDEN', 'Tài khoản của bạn đã bị vô hiệu hóa.');
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-10 - Học sinh cố tạo câu hỏi (POST /qb/questions) -> 403 FORBIDDEN', async () => {
  const mockAuth = createMockAuthDeps({ role: 'student', userId: VALID_STUDENT_ID });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/questions', {
    method: 'POST',
    body: {
      title: 'Math Question',
      subject: 'Math',
      grade_level: 10,
      prompt: 'Calculate 1+1',
      answer_key: { value: 2 },
    },
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    403,
    'FORBIDDEN',
    'Chỉ giáo viên hoặc quản trị viên mới có quyền tạo câu hỏi.'
  );
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-11 - Học sinh cố xem authoring detail (GET /qb/authoring/questions/:id) -> 403 FORBIDDEN', async () => {
  const mockAuth = createMockAuthDeps({ role: 'student', userId: VALID_STUDENT_ID });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/authoring/questions/${VALID_ITEM_ID}`);
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    403,
    'FORBIDDEN',
    'Học sinh không có quyền xem chi tiết soạn thảo câu hỏi.'
  );
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-12 - Học sinh cố xem danh sách câu hỏi (GET /qb/questions) -> 403 FORBIDDEN', async () => {
  const mockAuth = createMockAuthDeps({ role: 'student', userId: VALID_STUDENT_ID });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/questions');
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    403,
    'FORBIDDEN',
    'Chỉ giáo viên và quản trị viên mới có quyền duyệt danh sách ngân hàng câu hỏi.'
  );
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-13 - Học sinh cố fork câu hỏi (POST /qb/versions/:id/fork) -> 403 FORBIDDEN', async () => {
  const mockAuth = createMockAuthDeps({ role: 'student', userId: VALID_STUDENT_ID });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/versions/${VALID_VERSION_ID}/fork`, {
    method: 'POST',
    body: {},
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    403,
    'FORBIDDEN',
    'Chỉ giáo viên và quản trị viên mới có quyền sao chép câu hỏi.'
  );
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-14 - Học sinh cố sửa metadata (PATCH /qb/questions/:id/metadata) -> 403 FORBIDDEN', async () => {
  const mockAuth = createMockAuthDeps({ role: 'student', userId: VALID_STUDENT_ID });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/questions/${VALID_ITEM_ID}/metadata`, {
    method: 'PATCH',
    body: { title: 'Updated Title' },
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    403,
    'FORBIDDEN',
    'Chỉ giáo viên và quản trị viên mới có quyền cập nhật metadata.'
  );
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-15 - Lan truyền Trusted Identity: p_caller_id & p_actor_role chỉ lấy từ Auth Context', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher', userId: VALID_USER_ID });
  const mockRpc = createMockRpcClient({
    data: {
      success: true,
      item_id: VALID_ITEM_ID,
      version_id: VALID_VERSION_ID,
      code: 'Q-001',
      version_number: 1,
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/questions', {
    method: 'POST',
    body: {
      title: 'Valid Question Title',
      subject: 'Physics',
      grade_level: 11,
      prompt: 'State Newton First Law',
      answer_key: { correct_option: 'Inertia' },
    },
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertSuccessResponse(res, 201);
  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_create_question');
  assertStrictEquals(mockRpc.calls[0].args.p_caller_id, VALID_USER_ID);
  assertStrictEquals(mockRpc.calls[0].args.p_actor_role, 'teacher');
});

// ============================================================================
// Group C: Validation, Body Payloads & Query Sanitization (9 Tests: RT-16 — RT-24)
// ============================================================================

Deno.test('RT-16 - Body JSON cú pháp hỏng (POST /qb/questions) -> 400 INVALID_INPUT', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/questions', {
    method: 'POST',
    body: '{ invalid_json_syntax: true, ',
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(res, 400, 'INVALID_INPUT', 'JSON body không hợp lệ.');
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-17 - Payload thiếu trường prompt bắt buộc -> 400 INVALID_INPUT', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/questions', {
    method: 'POST',
    body: {
      title: 'Incomplete Question',
      subject: 'Math',
      grade_level: 10,
      answer_key: { val: 1 },
    },
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    400,
    'INVALID_INPUT',
    'Nội dung đề bài (prompt) không được để trống.'
  );
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-18A - Injection trường cấm server_grading trong payload -> 400 INVALID_REQUEST_FIELD', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/questions', {
    method: 'POST',
    body: {
      title: 'Valid Title',
      subject: 'Math',
      grade_level: 10,
      prompt: 'Prompt text',
      answer_key: { val: 1 },
      server_grading: { secret: 'bypass' },
    },
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    400,
    'INVALID_REQUEST_FIELD',
    'Trường dữ liệu bị cấm: server_grading'
  );
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-18B - Gửi trường không nằm trong allowlist (id) -> 400 INVALID_REQUEST_FIELD', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/questions', {
    method: 'POST',
    body: {
      title: 'Valid Title',
      subject: 'Math',
      grade_level: 10,
      prompt: 'Prompt text',
      answer_key: { val: 1 },
      id: VALID_ITEM_ID,
    },
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    400,
    'INVALID_REQUEST_FIELD',
    'Trường không nằm trong danh sách cho phép: id'
  );
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-19 - Query param lạ ngoài allowlist (GET /qb/student/questions/:id) -> 400 INVALID_REQUEST_FIELD', async () => {
  const mockAuth = createMockAuthDeps({ role: 'student', userId: VALID_STUDENT_ID });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(
    `https://example.test/qb/student/questions/${VALID_ITEM_ID}?unknown_filter=true`
  );
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    400,
    'INVALID_REQUEST_FIELD',
    'Tham số query không hợp lệ: unknown_filter'
  );
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-20 - version_id trong query không phải UUID -> 400 INVALID_INPUT', async () => {
  const mockAuth = createMockAuthDeps({ role: 'student', userId: VALID_STUDENT_ID });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(
    `https://example.test/qb/student/questions/${VALID_ITEM_ID}?version_id=not-a-uuid`
  );
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    400,
    'INVALID_INPUT',
    'Tham số version_id không đúng định dạng UUID.'
  );
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-21 - page_size > 100 trong danh sách câu hỏi -> 400 INVALID_INPUT', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/questions?page_size=150');
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    400,
    'INVALID_INPUT',
    'Tham số page_size phải nằm trong khoảng từ 1 đến 100.'
  );
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-22 - Query param lạ ngoài allowlist trong danh sách -> 400 INVALID_REQUEST_FIELD', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/questions?malicious_filter=true');
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    400,
    'INVALID_REQUEST_FIELD',
    'Tham số query không hợp lệ: malicious_filter'
  );
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-23 - Body update metadata rỗng (PATCH /qb/questions/:id/metadata) -> 400 INVALID_INPUT', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/questions/${VALID_ITEM_ID}/metadata`, {
    method: 'PATCH',
    body: {},
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    400,
    'INVALID_INPUT',
    'Phải cập nhật ít nhất một trường thông tin metadata.'
  );
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-24 - Injection trường cấm p_caller_id trong tạo version -> 400 INVALID_REQUEST_FIELD', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/questions/${VALID_ITEM_ID}/versions`, {
    method: 'POST',
    body: {
      prompt: 'New Version Prompt',
      answer_key: { answer: 'B' },
      p_caller_id: 'injected-user',
    },
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    400,
    'INVALID_REQUEST_FIELD',
    'Trường dữ liệu bị cấm: p_caller_id'
  );
  assertStrictEquals(mockRpc.calls.length, 0);
});

// ============================================================================
// Group D: RPC Success End-to-End Contracts (7 Tests: RT-25 — RT-31)
// ============================================================================

Deno.test('RT-25 - RPC1 rpc_qb_create_question thành công -> 201 CREATED', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher', userId: VALID_USER_ID });
  const mockRpc = createMockRpcClient({
    data: {
      success: true,
      item_id: VALID_ITEM_ID,
      version_id: VALID_VERSION_ID,
      code: 'Q-TEST-001',
      version_number: 1,
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/questions', {
    method: 'POST',
    body: {
      title: 'Algebra 1',
      subject: 'Math',
      grade_level: 9,
      prompt: 'Solve 2x = 4',
      answer_key: { x: 2 },
    },
  });
  const res = await handleQuestionBankRequest(req, deps);

  const data = await assertSuccessResponse<{ item_id: string; version_id: string; code: string; version_number: number }>(
    res,
    201
  );
  assertStrictEquals(data.item_id, VALID_ITEM_ID);
  assertStrictEquals(data.version_id, VALID_VERSION_ID);
  assertStrictEquals(data.code, 'Q-TEST-001');
  assertStrictEquals(data.version_number, 1);

  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_create_question');
  assertStrictEquals(mockRpc.calls[0].args.p_caller_id, VALID_USER_ID);
  assertStrictEquals(mockRpc.calls[0].args.p_actor_role, 'teacher');
});

Deno.test('RT-26 - RPC2 rpc_qb_create_version thành công -> 201 CREATED', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher', userId: VALID_USER_ID });
  const mockRpc = createMockRpcClient({
    data: {
      success: true,
      item_id: VALID_ITEM_ID,
      version_id: VALID_VERSION_ID,
      version_number: 2,
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/questions/${VALID_ITEM_ID}/versions`, {
    method: 'POST',
    body: {
      prompt: 'Solve 3x = 9',
      answer_key: { x: 3 },
    },
  });
  const res = await handleQuestionBankRequest(req, deps);

  const data = await assertSuccessResponse<{ item_id: string; version_id: string; version_number: number }>(
    res,
    201
  );
  assertStrictEquals(data.item_id, VALID_ITEM_ID);
  assertStrictEquals(data.version_id, VALID_VERSION_ID);
  assertStrictEquals(data.version_number, 2);

  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_create_version');
  assertStrictEquals(mockRpc.calls[0].args.p_item_id, VALID_ITEM_ID);
});

Deno.test('RT-27 - RPC3 rpc_qb_get_student_question thành công (Projection STUDENT_SAFE) -> 200 OK', async () => {
  const mockAuth = createMockAuthDeps({ role: 'student', userId: VALID_STUDENT_ID });
  const mockRpc = createMockRpcClient({
    data: {
      success: true,
      projection: 'STUDENT_SAFE',
      item: { id: VALID_ITEM_ID, title: 'Student Safe Question', subject: 'History' },
      version: { id: VALID_VERSION_ID, prompt: 'When was 1945?' },
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/student/questions/${VALID_ITEM_ID}`);
  const res = await handleQuestionBankRequest(req, deps);

  const data = await assertSuccessResponse<{ projection: string; item: Record<string, unknown>; version: Record<string, unknown> }>(
    res,
    200
  );
  assertStrictEquals(data.projection, 'STUDENT_SAFE');
  assertEquals(data.item.id, VALID_ITEM_ID);
  assertEquals(data.version.id, VALID_VERSION_ID);

  // Security Check: Khẳng định đáp án và server_grading tuyệt đối không có trong response
  assertStrictEquals('answer_key' in data, false);
  assertStrictEquals('correct_answer' in data, false);
  assertStrictEquals('server_grading' in data, false);

  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_get_student_question');
});

Deno.test('RT-28 - RPC4 rpc_qb_get_authoring_detail thành công (Projection AUTHORING_SAFE) -> 200 OK', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher', userId: VALID_USER_ID });
  const mockRpc = createMockRpcClient({
    data: {
      success: true,
      projection: 'AUTHORING_SAFE',
      item: { id: VALID_ITEM_ID, title: 'Teacher Detail' },
      version: { id: VALID_VERSION_ID, prompt: 'Teacher Prompt' },
      answer_key: { correct_answer: 'Detailed Key' },
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/authoring/questions/${VALID_ITEM_ID}`);
  const res = await handleQuestionBankRequest(req, deps);

  const data = await assertSuccessResponse<{ projection: string; answer_key: Record<string, unknown> }>(
    res,
    200
  );
  assertStrictEquals(data.projection, 'AUTHORING_SAFE');
  assertEquals(data.answer_key.correct_answer, 'Detailed Key');

  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_get_authoring_detail');
});

Deno.test('RT-29 - RPC5 rpc_qb_list_questions thành công -> 200 OK', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher', userId: VALID_USER_ID });
  const mockRpc = createMockRpcClient({
    data: {
      success: true,
      total_count: 1,
      page: 1,
      page_size: 20,
      items: [{ id: VALID_ITEM_ID, title: 'Item 1' }],
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/questions?page=1&page_size=20');
  const res = await handleQuestionBankRequest(req, deps);

  const data = await assertSuccessResponse<{ total_count: number; items: unknown[] }>(
    res,
    200
  );
  assertStrictEquals(data.total_count, 1);
  assertStrictEquals(data.items.length, 1);

  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_list_questions');
});

Deno.test('RT-30 - RPC6 rpc_qb_fork_question thành công -> 201 CREATED', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher', userId: VALID_USER_ID });
  const mockRpc = createMockRpcClient({
    data: {
      success: true,
      item_id: VALID_ITEM_ID,
      version_id: VALID_VERSION_ID,
      code: 'Q-FORKED-001',
      forked_from_version_id: VALID_VERSION_ID,
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/versions/${VALID_VERSION_ID}/fork`, {
    method: 'POST',
    body: { title: 'Forked Question Title' },
  });
  const res = await handleQuestionBankRequest(req, deps);

  const data = await assertSuccessResponse<{ item_id: string; forked_from_version_id: string }>(
    res,
    201
  );
  assertStrictEquals(data.item_id, VALID_ITEM_ID);
  assertStrictEquals(data.forked_from_version_id, VALID_VERSION_ID);

  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_fork_question');
});

Deno.test('RT-31 - RPC7 rpc_qb_update_item_metadata thành công -> 200 OK', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher', userId: VALID_USER_ID });
  const mockRpc = createMockRpcClient({
    data: {
      success: true,
      item_id: VALID_ITEM_ID,
      message: 'Item metadata updated successfully',
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/questions/${VALID_ITEM_ID}/metadata`, {
    method: 'PATCH',
    body: { title: 'New Valid Title' },
  });
  const res = await handleQuestionBankRequest(req, deps);

  const data = await assertSuccessResponse<{ item_id: string; message: string }>(
    res,
    200
  );
  assertStrictEquals(data.item_id, VALID_ITEM_ID);
  assertStrictEquals(data.message, 'Item metadata updated successfully');

  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_update_item_metadata');
  assertEquals(mockRpc.calls[0].args.p_payload, { title: 'New Valid Title' });
  assertStrictEquals('p_updates' in mockRpc.calls[0].args, false);
});

// ============================================================================
// Group E: Business Errors, Status Mapping & Leakage Assertions (7 Tests: RT-32 — RT-38)
// ============================================================================

Deno.test('RT-32 - RPC1 trả FORBIDDEN_VISIBILITY -> 403 FORBIDDEN_VISIBILITY', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient({
    data: { success: false, error_code: 'FORBIDDEN_VISIBILITY' },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/questions', {
    method: 'POST',
    body: { title: 'T', subject: 'S', grade_level: 10, prompt: 'P', answer_key: { a: 1 } },
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    403,
    'FORBIDDEN_VISIBILITY',
    'Chỉ quản trị viên mới có quyền thiết lập trạng thái chia sẻ mẫu công khai.'
  );
  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_create_question');
});

Deno.test('RT-33 - RPC2 trả ITEM_NOT_FOUND -> 404 NOT_FOUND', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient({
    data: { success: false, error_code: 'ITEM_NOT_FOUND' },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/questions/${VALID_ITEM_ID}/versions`, {
    method: 'POST',
    body: { prompt: 'P', answer_key: { a: 1 } },
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    404,
    'NOT_FOUND',
    'Không tìm thấy câu hỏi yêu cầu.'
  );
  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_create_version');
});

Deno.test('RT-34 - RPC3 trả ITEM_NOT_FOUND -> 404 NOT_FOUND', async () => {
  const mockAuth = createMockAuthDeps({ role: 'student', userId: VALID_STUDENT_ID });
  const mockRpc = createMockRpcClient({
    data: { success: false, error_code: 'ITEM_NOT_FOUND' },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/student/questions/${VALID_ITEM_ID}`);
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    404,
    'NOT_FOUND',
    'Không tìm thấy câu hỏi yêu cầu.'
  );
  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_get_student_question');
});

Deno.test('RT-35 - RPC4 trả FORBIDDEN -> 403 FORBIDDEN', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient({
    data: { success: false, error_code: 'FORBIDDEN' },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/authoring/questions/${VALID_ITEM_ID}`);
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    403,
    'FORBIDDEN',
    'Bạn không có quyền thực hiện thao tác này trên câu hỏi.'
  );
  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_get_authoring_detail');
});

Deno.test('RT-36 - RPC6 trả SOURCE_VERSION_NOT_FOUND -> 404 NOT_FOUND', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient({
    data: { success: false, error_code: 'SOURCE_VERSION_NOT_FOUND' },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/versions/${VALID_VERSION_ID}/fork`, {
    method: 'POST',
    body: {},
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    404,
    'NOT_FOUND',
    'Không tìm thấy phiên bản câu hỏi nguồn để sao chép.'
  );
  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_fork_question');
});

Deno.test('RT-37 - RPC7 trả UNAUTHORIZED_ROLE -> 403 FORBIDDEN', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient({
    data: { success: false, error_code: 'UNAUTHORIZED_ROLE' },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/questions/${VALID_ITEM_ID}/metadata`, {
    method: 'PATCH',
    body: { title: 'New Title' },
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    403,
    'FORBIDDEN',
    'Bạn không có quyền thực hiện thao tác này trên câu hỏi.'
  );
  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_update_item_metadata');
});

Deno.test('RT-38 - RPC1 trả DATABASE_ERROR -> 500 INTERNAL_ERROR (Khẳng định không rò rỉ SQL thô)', async () => {
  const rawSqlLeak = 'pg_catalog.query error: relation question_bank_items corrupted in postgres';
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient({
    data: {
      success: false,
      error_code: 'DATABASE_ERROR',
      message: rawSqlLeak,
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/questions', {
    method: 'POST',
    body: { title: 'T', subject: 'S', grade_level: 10, prompt: 'P', answer_key: { a: 1 } },
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    500,
    'INTERNAL_ERROR',
    'Đã xảy ra lỗi máy chủ nội bộ.',
    ['pg_catalog', 'relation question_bank_items corrupted', 'postgres']
  );
  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_create_question');
});

// ============================================================================
// Group F: Malformed RPC Responses for ALL 7 Mappers + Transport Error (8 Tests: RT-39 — RT-46)
// ============================================================================

Deno.test('RT-39 - RPC1 trả response dị tật (thiếu item_id) -> Fail-closed 500 INTERNAL_ERROR', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient({
    data: {
      success: true,
      version_id: VALID_VERSION_ID,
      code: 'Q-001',
      version_number: 1,
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/questions', {
    method: 'POST',
    body: { title: 'T', subject: 'S', grade_level: 10, prompt: 'P', answer_key: { a: 1 } },
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(res, 500, 'INTERNAL_ERROR', 'Phản hồi máy chủ không hợp lệ.');
  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_create_question');
});

Deno.test('RT-40 - RPC2 trả version_number âm -> Fail-closed 500 INTERNAL_ERROR', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient({
    data: {
      success: true,
      item_id: VALID_ITEM_ID,
      version_id: VALID_VERSION_ID,
      version_number: -5,
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/questions/${VALID_ITEM_ID}/versions`, {
    method: 'POST',
    body: { prompt: 'P', answer_key: { a: 1 } },
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(res, 500, 'INTERNAL_ERROR', 'Phản hồi máy chủ không hợp lệ.');
  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_create_version');
});

Deno.test('RT-41 - RPC3 trả sai projection (AUTHORING_SAFE thay vì STUDENT_SAFE) -> Fail-closed 500', async () => {
  const mockAuth = createMockAuthDeps({ role: 'student', userId: VALID_STUDENT_ID });
  const mockRpc = createMockRpcClient({
    data: {
      success: true,
      projection: 'AUTHORING_SAFE',
      item: { id: VALID_ITEM_ID },
      version: { id: VALID_VERSION_ID },
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/student/questions/${VALID_ITEM_ID}`);
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(res, 500, 'INTERNAL_ERROR', 'Phản hồi máy chủ không hợp lệ.');
  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_get_student_question');
});

Deno.test('RT-42 - RPC4 trả answer_key dạng string thay vì object -> Fail-closed 500 INTERNAL_ERROR', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient({
    data: {
      success: true,
      projection: 'AUTHORING_SAFE',
      item: { id: VALID_ITEM_ID },
      version: { id: VALID_VERSION_ID },
      answer_key: 'malformed string instead of record',
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/authoring/questions/${VALID_ITEM_ID}`);
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(res, 500, 'INTERNAL_ERROR', 'Phản hồi máy chủ không hợp lệ.');
  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_get_authoring_detail');
});

Deno.test('RT-43 - RPC5 trả total_count âm -> Fail-closed 500 INTERNAL_ERROR', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient({
    data: {
      success: true,
      total_count: -1,
      page: 1,
      page_size: 20,
      items: [],
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/questions');
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(res, 500, 'INTERNAL_ERROR', 'Phản hồi máy chủ không hợp lệ.');
  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_list_questions');
});

Deno.test('RT-44 - RPC6 thiếu forked_from_version_id -> Fail-closed 500 INTERNAL_ERROR', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient({
    data: {
      success: true,
      item_id: VALID_ITEM_ID,
      version_id: VALID_VERSION_ID,
      code: 'Q-FORK-001',
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/versions/${VALID_VERSION_ID}/fork`, {
    method: 'POST',
    body: {},
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(res, 500, 'INTERNAL_ERROR', 'Phản hồi máy chủ không hợp lệ.');
  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_fork_question');
});

Deno.test('RT-45 - RPC7 trả item_id không phải UUID -> Fail-closed 500 INTERNAL_ERROR', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient({
    data: {
      success: true,
      item_id: 'bad-uuid',
      message: 'Updated',
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/questions/${VALID_ITEM_ID}/metadata`, {
    method: 'PATCH',
    body: { title: 'Updated' },
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(res, 500, 'INTERNAL_ERROR', 'Phản hồi máy chủ không hợp lệ.');
  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_update_item_metadata');
});

Deno.test('RT-46 - RPC Transport Error (Network Timeout) -> 500 INTERNAL_ERROR (Khẳng định không lộ stack)', async () => {
  const rawTransportDetail = 'TCP timeout connection dropped at 10.0.0.1:5432 internal socket stack';
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient({
    error: new Error(rawTransportDetail),
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/questions', {
    method: 'POST',
    body: { title: 'T', subject: 'S', grade_level: 10, prompt: 'P', answer_key: { a: 1 } },
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    500,
    'INTERNAL_ERROR',
    'Đã xảy ra lỗi máy chủ nội bộ khi thực thi thao tác.',
    ['TCP timeout', '10.0.0.1:5432', 'socket stack']
  );
  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_create_question');
});

// ============================================================================
// Group G: Security Invariants, School Isolation, Fork Paths & DI Guards (9 Tests: RT-47 — RT-54)
// ============================================================================

Deno.test('RT-47 - Tạo câu hỏi với visibility: school_shared -> 409 SCHOOL_CONTEXT_NOT_AVAILABLE', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/questions', {
    method: 'POST',
    body: {
      title: 'T',
      subject: 'S',
      grade_level: 10,
      prompt: 'P',
      answer_key: { a: 1 },
      visibility: 'school_shared',
    },
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    409,
    'SCHOOL_CONTEXT_NOT_AVAILABLE',
    'Tính năng chia sẻ cấp trường (school_shared) chưa được hỗ trợ trong phiên bản này.'
  );
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-48 - Gửi caller_id=hacker trong body -> 400 INVALID_REQUEST_FIELD (Chặn giả mạo danh tính)', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher', userId: VALID_USER_ID });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/questions', {
    method: 'POST',
    body: {
      title: 'T',
      subject: 'S',
      grade_level: 10,
      prompt: 'P',
      answer_key: { a: 1 },
      caller_id: 'attacker-injected-id',
    },
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    400,
    'INVALID_REQUEST_FIELD',
    'Trường dữ liệu bị cấm: caller_id'
  );
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-49 - Lọc danh sách với visibility=school_shared -> 409 SCHOOL_CONTEXT_NOT_AVAILABLE', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/questions?visibility=school_shared');
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    409,
    'SCHOOL_CONTEXT_NOT_AVAILABLE',
    'Lọc danh sách school_shared chưa được hỗ trợ ở phiên bản này.'
  );
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-50 - Fork câu hỏi với visibility: school_shared -> 409 SCHOOL_CONTEXT_NOT_AVAILABLE', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/versions/${VALID_VERSION_ID}/fork`, {
    method: 'POST',
    body: { visibility: 'school_shared' },
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    409,
    'SCHOOL_CONTEXT_NOT_AVAILABLE',
    'Tính năng chia sẻ cấp trường (school_shared) chưa được hỗ trợ.'
  );
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-51 - Sửa metadata với visibility: school_shared -> 409 SCHOOL_CONTEXT_NOT_AVAILABLE', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/questions/${VALID_ITEM_ID}/metadata`, {
    method: 'PATCH',
    body: { visibility: 'school_shared' },
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    409,
    'SCHOOL_CONTEXT_NOT_AVAILABLE',
    'Không thể chuyển sang trạng thái chia sẻ trường học (school_shared) ở phiên bản V1.'
  );
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-52A - Fork câu hỏi với empty text body ("") -> 201 CREATED với overrides rỗng', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher', userId: VALID_USER_ID });
  const mockRpc = createMockRpcClient({
    data: {
      success: true,
      item_id: VALID_ITEM_ID,
      version_id: VALID_VERSION_ID,
      code: 'Q-FORK-52A',
      forked_from_version_id: VALID_VERSION_ID,
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/versions/${VALID_VERSION_ID}/fork`, {
    method: 'POST',
    body: '',
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertSuccessResponse(res, 201);
  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_fork_question');
  assertEquals(mockRpc.calls[0].args.p_overrides, {});
});

Deno.test('RT-52B - Fork câu hỏi với explicit JSON rỗng ("{}") -> 201 CREATED với overrides rỗng', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher', userId: VALID_USER_ID });
  const mockRpc = createMockRpcClient({
    data: {
      success: true,
      item_id: VALID_ITEM_ID,
      version_id: VALID_VERSION_ID,
      code: 'Q-FORK-52B',
      forked_from_version_id: VALID_VERSION_ID,
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/versions/${VALID_VERSION_ID}/fork`, {
    method: 'POST',
    body: {},
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertSuccessResponse(res, 201);
  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_fork_question');
  assertEquals(mockRpc.calls[0].args.p_overrides, {});
});

Deno.test('RT-53 - Injected RouterDependencies thiếu rpcClient -> 500 INTERNAL_ERROR (Fail-closed)', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const malformedDeps = asMalformedRouterDependencies({
    mode: 'injected',
    authDeps: mockAuth.authDeps,
  });

  const req = createTestRequest('https://example.test/qb/questions');
  const res = await handleQuestionBankRequest(req, malformedDeps);

  await assertErrorResponse(
    res,
    500,
    'INTERNAL_ERROR',
    'Cấu hình router mock dependencies không đầy đủ.'
  );
});

Deno.test('RT-54 - Injected RouterDependencies thiếu authDeps -> 500 INTERNAL_ERROR (Không fallback production)', async () => {
  const mockRpc = createMockRpcClient();
  const malformedDeps = asMalformedRouterDependencies({
    mode: 'injected',
    rpcClient: mockRpc.client,
  });

  const req = createTestRequest('https://example.test/qb/questions');
  const res = await handleQuestionBankRequest(req, malformedDeps);

  await assertErrorResponse(
    res,
    500,
    'INTERNAL_ERROR',
    'Cấu hình router mock dependencies không đầy đủ.'
  );
  assertStrictEquals(mockRpc.calls.length, 0);
});

// ============================================================================
// Group H: Soft Delete / Archive Question Tests (8 Tests: RT-ARCHIVE-01 — RT-ARCHIVE-08)
// ============================================================================

Deno.test('RT-ARCHIVE-01 - Admin archive câu hỏi bất kỳ thành công -> 200 OK', async () => {
  const mockAuth = createMockAuthDeps({ role: 'admin', userId: VALID_USER_ID });
  const mockRpc = createMockRpcClient({
    data: {
      success: true,
      item_id: VALID_ITEM_ID,
      message: 'Item metadata updated successfully',
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/questions/${VALID_ITEM_ID}/archive`, {
    method: 'PATCH',
  });
  const res = await handleQuestionBankRequest(req, deps);

  const data = await assertSuccessResponse<{ item_id: string; status: string; message: string }>(
    res,
    200
  );
  assertStrictEquals(data.item_id, VALID_ITEM_ID);
  assertStrictEquals(data.status, 'archived');
  assertStrictEquals(data.message, 'Item metadata updated successfully');

  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_update_item_metadata');
  assertStrictEquals(mockRpc.calls[0].args.p_actor_role, 'admin');
  assertStrictEquals(mockRpc.calls[0].args.p_item_id, VALID_ITEM_ID);
  assertEquals(mockRpc.calls[0].args.p_payload, { status: 'archived' });
});

Deno.test('RT-ARCHIVE-02 - Teacher archive câu hỏi của chính mình thành công -> 200 OK', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher', userId: VALID_USER_ID });
  const mockRpc = createMockRpcClient({
    data: {
      success: true,
      item_id: VALID_ITEM_ID,
      message: 'Item metadata updated successfully',
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/questions/${VALID_ITEM_ID}/archive`, {
    method: 'PATCH',
  });
  const res = await handleQuestionBankRequest(req, deps);

  const data = await assertSuccessResponse<{ item_id: string; status: string; message: string }>(
    res,
    200
  );
  assertStrictEquals(data.item_id, VALID_ITEM_ID);
  assertStrictEquals(data.status, 'archived');

  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_update_item_metadata');
  assertStrictEquals(mockRpc.calls[0].args.p_caller_id, VALID_USER_ID);
  assertStrictEquals(mockRpc.calls[0].args.p_actor_role, 'teacher');
  assertEquals(mockRpc.calls[0].args.p_payload, { status: 'archived' });
});

Deno.test('RT-ARCHIVE-03 - Teacher cố archive câu hỏi của giáo viên khác -> 403 FORBIDDEN', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher', userId: VALID_USER_ID });
  const mockRpc = createMockRpcClient({
    data: {
      success: false,
      error_code: 'FORBIDDEN',
      message: 'You can only update your own questions',
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/questions/${VALID_ITEM_ID}/archive`, {
    method: 'PATCH',
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    403,
    'FORBIDDEN',
    'Bạn không có quyền thực hiện thao tác này trên câu hỏi.'
  );

  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_update_item_metadata');
});

Deno.test('RT-ARCHIVE-04 - Student cố archive câu hỏi -> 403 FORBIDDEN (Chặn ngay tại BFF Gateway)', async () => {
  const mockAuth = createMockAuthDeps({ role: 'student', userId: VALID_STUDENT_ID });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/questions/${VALID_ITEM_ID}/archive`, {
    method: 'PATCH',
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    403,
    'FORBIDDEN',
    'Chỉ giáo viên và quản trị viên mới có quyền ẩn câu hỏi.'
  );
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-ARCHIVE-05 - ID câu hỏi không phải UUID (/qb/questions/invalid-id/archive) -> 400 INVALID_INPUT', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/questions/invalid-uuid-format/archive', {
    method: 'PATCH',
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    400,
    'INVALID_INPUT',
    'ID câu hỏi không đúng định dạng UUID.'
  );
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-ARCHIVE-06 - Item không tồn tại (ITEM_NOT_FOUND) -> 404 NOT_FOUND', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient({
    data: {
      success: false,
      error_code: 'ITEM_NOT_FOUND',
      message: 'Question item not found',
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/questions/${VALID_ITEM_ID}/archive`, {
    method: 'PATCH',
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    404,
    'NOT_FOUND',
    'Không tìm thấy câu hỏi yêu cầu.'
  );
  assertStrictEquals(mockRpc.calls.length, 1);
});

Deno.test('RT-ARCHIVE-07 - Câu hỏi đã được archive trước đó (Idempotent Archive) -> 200 OK', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher', userId: VALID_USER_ID });
  const mockRpc = createMockRpcClient({
    data: {
      success: true,
      item_id: VALID_ITEM_ID,
      message: 'Item metadata updated successfully',
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/questions/${VALID_ITEM_ID}/archive`, {
    method: 'PATCH',
  });
  const res = await handleQuestionBankRequest(req, deps);

  const data = await assertSuccessResponse<{ item_id: string; status: string }>(res, 200);
  assertStrictEquals(data.item_id, VALID_ITEM_ID);
  assertStrictEquals(data.status, 'archived');
  assertStrictEquals(mockRpc.calls.length, 1);
});

Deno.test('RT-ARCHIVE-08 - Không dùng hard DELETE (Khẳng định dùng rpc_qb_update_item_metadata PATCH)', async () => {
  const mockAuth = createMockAuthDeps({ role: 'admin', userId: VALID_USER_ID });
  const mockRpc = createMockRpcClient({
    data: {
      success: true,
      item_id: VALID_ITEM_ID,
      message: 'Item metadata updated successfully',
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/questions/${VALID_ITEM_ID}/archive`, {
    method: 'PATCH',
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertSuccessResponse(res, 200);
  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_update_item_metadata');
  assertEquals(mockRpc.calls[0].args.p_payload, { status: 'archived' });
});

Deno.test('RT-ARCHIVE-09 - Default list query (GET /qb/questions) không truyền status -> DB RPC nhận filter mặc định để tự loại archived', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher', userId: VALID_USER_ID });
  const mockRpc = createMockRpcClient({
    data: {
      success: true,
      total_count: 1,
      page: 1,
      page_size: 20,
      items: [{ id: VALID_ITEM_ID, status: 'published', title: 'Active item' }],
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/questions?page=1&page_size=20');
  const res = await handleQuestionBankRequest(req, deps);

  const data = await assertSuccessResponse<{ total_count: number; items: unknown[] }>(res, 200);
  assertStrictEquals(data.total_count, 1);
  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_list_questions');
  assertEquals(mockRpc.calls[0].args.p_filters, { page: 1, page_size: 20 });
});

Deno.test('RT-ARCHIVE-10 - Explicit status=archived query supported in listQuestions -> 200 OK', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher', userId: VALID_USER_ID });
  const mockRpc = createMockRpcClient({
    data: {
      success: true,
      total_count: 1,
      page: 1,
      page_size: 20,
      items: [{ id: VALID_ITEM_ID, status: 'archived', title: 'Archived item' }],
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/questions?status=archived&page=1&page_size=20');
  const res = await handleQuestionBankRequest(req, deps);

  const data = await assertSuccessResponse<{ total_count: number; items: unknown[] }>(res, 200);
  assertStrictEquals(data.total_count, 1);
  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_list_questions');
  assertEquals(mockRpc.calls[0].args.p_filters, {
    status: 'archived',
    page: 1,
    page_size: 20,
  });
});

// ----------------------------------------------------------------------------
// RESTORE TESTS: PATCH /qb/questions/:id/restore -> rpc_qb_update_item_metadata ({ status: 'draft' })
// ----------------------------------------------------------------------------

Deno.test('RT-RESTORE-01 - Admin được phép khôi phục mọi câu hỏi -> 200 OK & status: draft', async () => {
  const mockAuth = createMockAuthDeps({ role: 'admin', userId: VALID_USER_ID });
  const mockRpc = createMockRpcClient({
    data: {
      success: true,
      item_id: VALID_ITEM_ID,
      message: 'Item metadata updated successfully',
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/questions/${VALID_ITEM_ID}/restore`, {
    method: 'PATCH',
  });
  const res = await handleQuestionBankRequest(req, deps);

  const data = await assertSuccessResponse<{ item_id: string; status: string }>(res, 200);
  assertStrictEquals(data.item_id, VALID_ITEM_ID);
  assertStrictEquals(data.status, 'draft');
  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_update_item_metadata');
  assertEquals(mockRpc.calls[0].args.p_payload, { status: 'draft' });
});

Deno.test('RT-RESTORE-02 - Giáo viên được phép khôi phục câu hỏi của chính mình -> 200 OK & status: draft', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher', userId: VALID_USER_ID });
  const mockRpc = createMockRpcClient({
    data: {
      success: true,
      item_id: VALID_ITEM_ID,
      message: 'Item metadata updated successfully',
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/questions/${VALID_ITEM_ID}/restore`, {
    method: 'PATCH',
  });
  const res = await handleQuestionBankRequest(req, deps);

  const data = await assertSuccessResponse<{ item_id: string; status: string }>(res, 200);
  assertStrictEquals(data.item_id, VALID_ITEM_ID);
  assertStrictEquals(data.status, 'draft');
  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_update_item_metadata');
  assertEquals(mockRpc.calls[0].args.p_payload, { status: 'draft' });
});

Deno.test('RT-RESTORE-03 - Giáo viên khôi phục câu hỏi của người khác -> DB RPC trả FORBIDDEN -> 403 FORBIDDEN', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher', userId: VALID_USER_ID });
  const mockRpc = createMockRpcClient({
    data: {
      success: false,
      error_code: 'FORBIDDEN',
      message: 'You are not allowed to modify this item',
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/questions/${VALID_ITEM_ID}/restore`, {
    method: 'PATCH',
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    403,
    'FORBIDDEN',
    'Bạn không có quyền thực hiện thao tác này trên câu hỏi.'
  );
  assertStrictEquals(mockRpc.calls.length, 1);
});

Deno.test('RT-RESTORE-04 - Học sinh (Student) gọi restore -> 403 FORBIDDEN ngay tại BFF', async () => {
  const mockAuth = createMockAuthDeps({ role: 'student', userId: VALID_STUDENT_ID });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/questions/${VALID_ITEM_ID}/restore`, {
    method: 'PATCH',
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    403,
    'FORBIDDEN',
    'Chỉ giáo viên và quản trị viên mới có quyền khôi phục câu hỏi.'
  );
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-RESTORE-05 - ID câu hỏi không đúng định dạng UUID -> 400 INVALID_INPUT', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher', userId: VALID_USER_ID });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest('https://example.test/qb/questions/invalid-uuid-format/restore', {
    method: 'PATCH',
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    400,
    'INVALID_INPUT',
    'ID câu hỏi không đúng định dạng UUID.'
  );
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-RESTORE-06 - Không tìm thấy câu hỏi (ITEM_NOT_FOUND) -> 404 NOT_FOUND', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher' });
  const mockRpc = createMockRpcClient({
    data: {
      success: false,
      error_code: 'ITEM_NOT_FOUND',
      message: 'Question item not found',
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/questions/${VALID_ITEM_ID}/restore`, {
    method: 'PATCH',
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(
    res,
    404,
    'NOT_FOUND',
    'Không tìm thấy câu hỏi yêu cầu.'
  );
  assertStrictEquals(mockRpc.calls.length, 1);
});

Deno.test('RT-RESTORE-07 - Payload RPC truyền đúng { status: \'draft\' } và không đổi visibility/author', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher', userId: VALID_USER_ID });
  const mockRpc = createMockRpcClient({
    data: {
      success: true,
      item_id: VALID_ITEM_ID,
      message: 'Item metadata updated successfully',
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/questions/${VALID_ITEM_ID}/restore`, {
    method: 'PATCH',
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertSuccessResponse(res, 200);
  assertStrictEquals(mockRpc.calls.length, 1);
  assertStrictEquals(mockRpc.calls[0].name, 'rpc_qb_update_item_metadata');
  assertEquals(mockRpc.calls[0].args.p_payload, { status: 'draft' });
  assertStrictEquals(mockRpc.calls[0].args.p_item_id, VALID_ITEM_ID);
});

Deno.test('RT-RESTORE-08 - Method không phải PATCH (POST / GET) -> 404 NOT_FOUND', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher', userId: VALID_USER_ID });
  const mockRpc = createMockRpcClient();
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/questions/${VALID_ITEM_ID}/restore`, {
    method: 'POST',
  });
  const res = await handleQuestionBankRequest(req, deps);

  await assertErrorResponse(res, 404, 'NOT_FOUND', 'Đường dẫn API không tồn tại.');
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('RT-RESTORE-09 - Idempotent restore (câu hỏi đã draft) -> 200 OK', async () => {
  const mockAuth = createMockAuthDeps({ role: 'teacher', userId: VALID_USER_ID });
  const mockRpc = createMockRpcClient({
    data: {
      success: true,
      item_id: VALID_ITEM_ID,
      message: 'Item metadata updated successfully',
    },
  });
  const deps = createRouterDeps(mockAuth.authDeps, mockRpc.client);

  const req = createTestRequest(`https://example.test/qb/questions/${VALID_ITEM_ID}/restore`, {
    method: 'PATCH',
  });
  const res = await handleQuestionBankRequest(req, deps);

  const data = await assertSuccessResponse<{ item_id: string; status: string }>(res, 200);
  assertStrictEquals(data.item_id, VALID_ITEM_ID);
  assertStrictEquals(data.status, 'draft');
  assertStrictEquals(mockRpc.calls.length, 1);
});
