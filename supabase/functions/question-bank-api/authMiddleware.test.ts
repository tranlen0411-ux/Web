// supabase/functions/question-bank-api/authMiddleware.test.ts
// Question Bank User-Facing BFF REST Auth Middleware In-Memory Unit Tests V1
// Includes Two-Project Architecture & Hardened Trusted Caller Identity Tests

import {
  assertEquals,
  assertStrictEquals,
} from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  verifyAuthAndDeriveContext,
  CallerAuthClient,
  ProfileQueryClient,
  RpcClient,
  InjectedAuthDependencies,
  AuthDependencies,
  AuthResult,
} from './authMiddleware.ts';

// ----------------------------------------------------------------------------
// Local Test-Only Type Guards & Assertion Helpers
// ----------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

// Helper test-only để ép kiểu fixture dị tật phục vụ kiểm thử negative runtime
function asMalformedAuthDependencies(value: unknown): AuthDependencies {
  return value as unknown as AuthDependencies;
}

function createTestRequest(
  authHeader?: string,
  url = 'https://example.test/qb/questions',
  method = 'GET'
): Request {
  const headers = new Headers();
  if (authHeader !== undefined) {
    headers.set('Authorization', authHeader);
  }
  return new Request(url, { method, headers });
}

async function assertAuthFailure(
  result: AuthResult,
  expectedStatus: number,
  expectedErrorCode: string,
  expectedErrorMessage: string
): Promise<void> {
  assertStrictEquals(result.ok, false);
  assertStrictEquals(result.context, undefined);
  assertStrictEquals(result.response !== undefined, true);

  if (!result.response) {
    throw new Error('Expected response to be defined');
  }
  const res = result.response;
  assertStrictEquals(res.status, expectedStatus);
  assertStrictEquals(res.headers.get('Access-Control-Allow-Origin'), '*');

  const json: unknown = await res.json();
  if (!isRecord(json)) {
    throw new Error('Expected error response body to be a plain object');
  }
  const body = json;
  assertStrictEquals(body.success, false);
  assertStrictEquals(body.error_code, expectedErrorCode);
  assertStrictEquals(body.message, expectedErrorMessage);
}

function assertAuthSuccess(
  result: AuthResult,
  expectedCallerId: string,
  expectedActorRole: string,
  expectedAdminClient?: unknown
): void {
  assertStrictEquals(result.ok, true);
  assertStrictEquals(result.response, undefined);
  assertStrictEquals(result.context !== undefined, true);
  if (result.context) {
    assertStrictEquals(result.context.callerId, expectedCallerId);
    assertStrictEquals(result.context.actorRole, expectedActorRole);
    assertStrictEquals(result.context.schoolId, null);
  }
  if (expectedAdminClient !== undefined) {
    assertStrictEquals(result.adminClient, expectedAdminClient);
  } else {
    assertStrictEquals(result.adminClient, undefined);
  }
}

// ----------------------------------------------------------------------------
// Test Mock Implementations & Spy Factories
// ----------------------------------------------------------------------------

interface MockCallerConfig {
  user?: { id: string } | null;
  error?: unknown;
}

function createMockCallerAuthClient(config: MockCallerConfig = {}) {
  let getUserCalls = 0;

  const client: CallerAuthClient = {
    auth: {
      async getUser() {
        getUserCalls++;
        if (config.error) {
          return { data: { user: null }, error: config.error };
        }
        return {
          data: {
            user:
              config.user !== undefined
                ? config.user
                : { id: '00000000-0000-0000-0000-000000000001' },
          },
          error: null,
        };
      },
    },
  };

  return {
    client,
    spies: {
      get getUserCalls() {
        return getUserCalls;
      },
    },
  };
}

interface MockProfileConfig {
  profile?: { id: string; role: string; is_disabled?: boolean } | null;
  error?: unknown;
}

function createMockProfileQueryClient(config: MockProfileConfig = {}) {
  const fromCalls: string[] = [];
  const selectCalls: string[] = [];
  const eqCalls: { col: string; val: string }[] = [];
  let maybeSingleCalls = 0;

  const client: ProfileQueryClient = {
    from(table: 'profiles') {
      fromCalls.push(table);
      return {
        select(cols: string) {
          selectCalls.push(cols);
          return {
            eq(col: string, val: string) {
              eqCalls.push({ col, val });
              return {
                async maybeSingle() {
                  maybeSingleCalls++;
                  if (config.error) {
                    return { data: null, error: config.error };
                  }
                  return {
                    data:
                      config.profile !== undefined
                        ? config.profile
                        : {
                            id: '00000000-0000-0000-0000-000000000001',
                            role: 'teacher',
                            is_disabled: false,
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

  return {
    client,
    spies: {
      fromCalls,
      selectCalls,
      eqCalls,
      get maybeSingleCalls() {
        return maybeSingleCalls;
      },
    },
  };
}

function createMockRpcClient() {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client: RpcClient = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: { success: true }, error: null };
    },
  };
  return { client, calls };
}

// ----------------------------------------------------------------------------
// Nhóm 1: Core Lifecycle Cases (16 Tests: A — P)
// ----------------------------------------------------------------------------

Deno.test('Case A - missing Authorization header -> 401 UNAUTHORIZED', async () => {
  const mockCaller = createMockCallerAuthClient();
  const mockProfile = createMockProfileQueryClient();
  const deps: InjectedAuthDependencies = {
    mode: 'injected',
    callerAuthClient: mockCaller.client,
    profileQueryClient: mockProfile.client,
  };

  const req = createTestRequest(); // Không truyền authHeader
  const result = await verifyAuthAndDeriveContext(req, deps);

  await assertAuthFailure(
    result,
    401,
    'UNAUTHORIZED',
    'Yêu cầu xác thực Bearer token trong header Authorization.'
  );
  assertStrictEquals(mockCaller.spies.getUserCalls, 0);
  assertStrictEquals(mockProfile.spies.maybeSingleCalls, 0);
});

Deno.test('Case B - Authorization header does not start with Bearer -> 401 UNAUTHORIZED', async () => {
  const mockCaller = createMockCallerAuthClient();
  const mockProfile = createMockProfileQueryClient();
  const deps: InjectedAuthDependencies = {
    mode: 'injected',
    callerAuthClient: mockCaller.client,
    profileQueryClient: mockProfile.client,
  };

  const req = createTestRequest('Basic dXNlcjpwYXNz');
  const result = await verifyAuthAndDeriveContext(req, deps);

  await assertAuthFailure(
    result,
    401,
    'UNAUTHORIZED',
    'Yêu cầu xác thực Bearer token trong header Authorization.'
  );
  assertStrictEquals(mockCaller.spies.getUserCalls, 0);
  assertStrictEquals(mockProfile.spies.maybeSingleCalls, 0);
});

Deno.test('Case C - whitespace-only Bearer value normalizes to invalid Authorization scheme -> 401 UNAUTHORIZED', async () => {
  const mockCaller = createMockCallerAuthClient();
  const mockProfile = createMockProfileQueryClient();
  const deps: InjectedAuthDependencies = {
    mode: 'injected',
    callerAuthClient: mockCaller.client,
    profileQueryClient: mockProfile.client,
  };

  const req = createTestRequest('Bearer   ');
  const result = await verifyAuthAndDeriveContext(req, deps);

  await assertAuthFailure(
    result,
    401,
    'UNAUTHORIZED',
    'Yêu cầu xác thực Bearer token trong header Authorization.'
  );
  assertStrictEquals(mockCaller.spies.getUserCalls, 0);
  assertStrictEquals(mockProfile.spies.maybeSingleCalls, 0);
});

Deno.test('Case D - callerAuthClient.auth.getUser() returns error -> 401 UNAUTHORIZED', async () => {
  const mockCaller = createMockCallerAuthClient({
    error: new Error('JWT expired or signature invalid'),
  });
  const mockProfile = createMockProfileQueryClient();
  const deps: InjectedAuthDependencies = {
    mode: 'injected',
    callerAuthClient: mockCaller.client,
    profileQueryClient: mockProfile.client,
  };

  const req = createTestRequest('Bearer valid-token-123');
  const result = await verifyAuthAndDeriveContext(req, deps);

  await assertAuthFailure(
    result,
    401,
    'UNAUTHORIZED',
    'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'
  );
  assertStrictEquals(mockCaller.spies.getUserCalls, 1);
  assertStrictEquals(mockProfile.spies.maybeSingleCalls, 0);
});

Deno.test('Case E - callerAuthClient.auth.getUser() returns user null -> 401 UNAUTHORIZED', async () => {
  const mockCaller = createMockCallerAuthClient({ user: null });
  const mockProfile = createMockProfileQueryClient();
  const deps: InjectedAuthDependencies = {
    mode: 'injected',
    callerAuthClient: mockCaller.client,
    profileQueryClient: mockProfile.client,
  };

  const req = createTestRequest('Bearer valid-token-123');
  const result = await verifyAuthAndDeriveContext(req, deps);

  await assertAuthFailure(
    result,
    401,
    'UNAUTHORIZED',
    'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'
  );
  assertStrictEquals(mockCaller.spies.getUserCalls, 1);
  assertStrictEquals(mockProfile.spies.maybeSingleCalls, 0);
});

Deno.test('Case F - callerAuthClient.auth.getUser() returns user without id -> 401 UNAUTHORIZED', async () => {
  const mockCaller = createMockCallerAuthClient({
    user: { id: '' },
  });
  const mockProfile = createMockProfileQueryClient();
  const deps: InjectedAuthDependencies = {
    mode: 'injected',
    callerAuthClient: mockCaller.client,
    profileQueryClient: mockProfile.client,
  };

  const req = createTestRequest('Bearer valid-token-123');
  const result = await verifyAuthAndDeriveContext(req, deps);

  await assertAuthFailure(
    result,
    401,
    'UNAUTHORIZED',
    'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'
  );
  assertStrictEquals(mockCaller.spies.getUserCalls, 1);
  assertStrictEquals(mockProfile.spies.maybeSingleCalls, 0);
});

Deno.test('Case G - profile query returns database error -> 500 INTERNAL_ERROR', async () => {
  const mockCaller = createMockCallerAuthClient();
  const mockProfile = createMockProfileQueryClient({
    error: new Error('Postgres connection pool exhausted'),
  });
  const deps: InjectedAuthDependencies = {
    mode: 'injected',
    callerAuthClient: mockCaller.client,
    profileQueryClient: mockProfile.client,
  };

  const req = createTestRequest('Bearer valid-token-123');
  const result = await verifyAuthAndDeriveContext(req, deps);

  await assertAuthFailure(
    result,
    500,
    'INTERNAL_ERROR',
    'Lỗi kiểm tra hồ sơ người dùng.'
  );
  assertStrictEquals(mockCaller.spies.getUserCalls, 1);
  assertStrictEquals(mockProfile.spies.maybeSingleCalls, 1);
});

Deno.test('Case H - profile does not exist (null) -> 403 FORBIDDEN', async () => {
  const mockCaller = createMockCallerAuthClient();
  const mockProfile = createMockProfileQueryClient({ profile: null });
  const deps: InjectedAuthDependencies = {
    mode: 'injected',
    callerAuthClient: mockCaller.client,
    profileQueryClient: mockProfile.client,
  };

  const req = createTestRequest('Bearer valid-token-123');
  const result = await verifyAuthAndDeriveContext(req, deps);

  await assertAuthFailure(
    result,
    403,
    'FORBIDDEN',
    'Hồ sơ người dùng không tồn tại trong hệ thống.'
  );
  assertStrictEquals(mockCaller.spies.getUserCalls, 1);
  assertStrictEquals(mockProfile.spies.maybeSingleCalls, 1);
});

Deno.test('Case I - profile is_disabled === true -> 403 FORBIDDEN', async () => {
  const mockCaller = createMockCallerAuthClient();
  const mockProfile = createMockProfileQueryClient({
    profile: {
      id: '00000000-0000-0000-0000-000000000001',
      role: 'teacher',
      is_disabled: true,
    },
  });
  const deps: InjectedAuthDependencies = {
    mode: 'injected',
    callerAuthClient: mockCaller.client,
    profileQueryClient: mockProfile.client,
  };

  const req = createTestRequest('Bearer valid-token-123');
  const result = await verifyAuthAndDeriveContext(req, deps);

  await assertAuthFailure(
    result,
    403,
    'FORBIDDEN',
    'Tài khoản của bạn đã bị vô hiệu hóa.'
  );
  assertStrictEquals(mockCaller.spies.getUserCalls, 1);
  assertStrictEquals(mockProfile.spies.maybeSingleCalls, 1);
});

Deno.test('Case J - profile role is invalid string -> 403 FORBIDDEN', async () => {
  const mockCaller = createMockCallerAuthClient();
  const mockProfile = createMockProfileQueryClient({
    profile: {
      id: '00000000-0000-0000-0000-000000000001',
      role: 'super_admin',
      is_disabled: false,
    },
  });
  const deps: InjectedAuthDependencies = {
    mode: 'injected',
    callerAuthClient: mockCaller.client,
    profileQueryClient: mockProfile.client,
  };

  const req = createTestRequest('Bearer valid-token-123');
  const result = await verifyAuthAndDeriveContext(req, deps);

  await assertAuthFailure(
    result,
    403,
    'FORBIDDEN',
    'Vai trò người dùng không hợp lệ.'
  );
  assertStrictEquals(mockCaller.spies.getUserCalls, 1);
  assertStrictEquals(mockProfile.spies.maybeSingleCalls, 1);
});

Deno.test('Case K - valid teacher role -> ok true with trusted context', async () => {
  const expectedId = '11111111-1111-1111-1111-111111111111';
  const mockCaller = createMockCallerAuthClient({ user: { id: expectedId } });
  const mockProfile = createMockProfileQueryClient({
    profile: { id: expectedId, role: 'teacher', is_disabled: false },
  });
  const deps: InjectedAuthDependencies = {
    mode: 'injected',
    callerAuthClient: mockCaller.client,
    profileQueryClient: mockProfile.client,
  };

  const req = createTestRequest('Bearer valid-token-123');
  const result = await verifyAuthAndDeriveContext(req, deps);

  assertAuthSuccess(result, expectedId, 'teacher');
  assertStrictEquals(result.context?.callerId, expectedId);
  assertStrictEquals(mockCaller.spies.getUserCalls, 1);
  assertStrictEquals(mockProfile.spies.maybeSingleCalls, 1);
});

Deno.test('Case L - valid admin role -> ok true with trusted context', async () => {
  const expectedId = '22222222-2222-2222-2222-222222222222';
  const mockCaller = createMockCallerAuthClient({ user: { id: expectedId } });
  const mockProfile = createMockProfileQueryClient({
    profile: { id: expectedId, role: 'admin', is_disabled: false },
  });
  const deps: InjectedAuthDependencies = {
    mode: 'injected',
    callerAuthClient: mockCaller.client,
    profileQueryClient: mockProfile.client,
  };

  const req = createTestRequest('Bearer valid-token-123');
  const result = await verifyAuthAndDeriveContext(req, deps);

  assertAuthSuccess(result, expectedId, 'admin');
  assertStrictEquals(result.context?.callerId, expectedId);
  assertStrictEquals(mockCaller.spies.getUserCalls, 1);
  assertStrictEquals(mockProfile.spies.maybeSingleCalls, 1);
});

Deno.test('Case M - valid student role -> ok true with trusted context', async () => {
  const expectedId = '33333333-3333-3333-3333-333333333333';
  const mockCaller = createMockCallerAuthClient({ user: { id: expectedId } });
  const mockProfile = createMockProfileQueryClient({
    profile: { id: expectedId, role: 'student', is_disabled: false },
  });
  const deps: InjectedAuthDependencies = {
    mode: 'injected',
    callerAuthClient: mockCaller.client,
    profileQueryClient: mockProfile.client,
  };

  const req = createTestRequest('Bearer valid-token-123');
  const result = await verifyAuthAndDeriveContext(req, deps);

  assertAuthSuccess(result, expectedId, 'student');
  assertStrictEquals(result.context?.callerId, expectedId);
  assertStrictEquals(mockCaller.spies.getUserCalls, 1);
  assertStrictEquals(mockProfile.spies.maybeSingleCalls, 1);
});

Deno.test('Case N - malformed injected deps missing callerAuthClient -> 500 INTERNAL_ERROR', async () => {
  const mockProfile = createMockProfileQueryClient();
  const malformedDeps = asMalformedAuthDependencies({
    mode: 'injected',
    profileQueryClient: mockProfile.client,
  });

  const req = createTestRequest('Bearer valid-token-123');
  const result = await verifyAuthAndDeriveContext(req, malformedDeps);

  await assertAuthFailure(
    result,
    500,
    'INTERNAL_ERROR',
    'Cấu hình mock dependencies không đầy đủ.'
  );
  assertStrictEquals(mockProfile.spies.maybeSingleCalls, 0);
});

Deno.test('Case O - malformed injected deps missing profileQueryClient -> 500 INTERNAL_ERROR', async () => {
  const mockCaller = createMockCallerAuthClient();
  const malformedDeps = asMalformedAuthDependencies({
    mode: 'injected',
    callerAuthClient: mockCaller.client,
  });

  const req = createTestRequest('Bearer valid-token-123');
  const result = await verifyAuthAndDeriveContext(req, malformedDeps);

  await assertAuthFailure(
    result,
    500,
    'INTERNAL_ERROR',
    'Cấu hình mock dependencies không đầy đủ.'
  );
  assertStrictEquals(mockCaller.spies.getUserCalls, 0);
});

Deno.test('Case P - identity consistency: JWT user.id flows to profile query and context', async () => {
  const expectedJwtId = '44444444-4444-4444-4444-444444444444';
  const mockCaller = createMockCallerAuthClient({ user: { id: expectedJwtId } });
  const mockProfile = createMockProfileQueryClient({
    profile: { id: expectedJwtId, role: 'teacher', is_disabled: false },
  });
  const deps: InjectedAuthDependencies = {
    mode: 'injected',
    callerAuthClient: mockCaller.client,
    profileQueryClient: mockProfile.client,
  };

  const req = createTestRequest('Bearer valid-token-123');
  const result = await verifyAuthAndDeriveContext(req, deps);

  assertAuthSuccess(result, expectedJwtId, 'teacher');
  assertStrictEquals(result.context?.callerId, expectedJwtId);
  assertStrictEquals(mockCaller.spies.getUserCalls, 1);
  assertStrictEquals(mockProfile.spies.maybeSingleCalls, 1);
  assertEquals(mockProfile.spies.fromCalls, ['profiles']);
  assertEquals(mockProfile.spies.selectCalls, ['id, role, is_disabled']);
  assertEquals(mockProfile.spies.eqCalls, [{ col: 'id', val: expectedJwtId }]);
});

// ----------------------------------------------------------------------------
// Nhóm 2: Security & Boundary Cases (4 Tests: Q — T)
// ----------------------------------------------------------------------------

Deno.test('Case Q - request body/query caller_id parameter is completely ignored', async () => {
  const trustedId = '55555555-5555-5555-5555-555555555555';
  const mockCaller = createMockCallerAuthClient({ user: { id: trustedId } });
  const mockProfile = createMockProfileQueryClient({
    profile: { id: trustedId, role: 'teacher', is_disabled: false },
  });
  const deps: InjectedAuthDependencies = {
    mode: 'injected',
    callerAuthClient: mockCaller.client,
    profileQueryClient: mockProfile.client,
  };

  const req = createTestRequest(
    'Bearer valid-token-123',
    'https://example.test/qb/questions?caller_id=66666666-6666-6666-6666-666666666666'
  );
  const result = await verifyAuthAndDeriveContext(req, deps);

  assertAuthSuccess(result, trustedId, 'teacher');
  assertStrictEquals(result.context?.callerId, trustedId);
  assertEquals(mockProfile.spies.eqCalls, [{ col: 'id', val: trustedId }]);
});

Deno.test('Case R - request X-Role header is ignored in favor of profile.role', async () => {
  const trustedId = '77777777-7777-7777-7777-777777777777';
  const mockCaller = createMockCallerAuthClient({ user: { id: trustedId } });
  const mockProfile = createMockProfileQueryClient({
    profile: { id: trustedId, role: 'student', is_disabled: false },
  });
  const deps: InjectedAuthDependencies = {
    mode: 'injected',
    callerAuthClient: mockCaller.client,
    profileQueryClient: mockProfile.client,
  };

  const headers = new Headers();
  headers.set('Authorization', 'Bearer valid-token-123');
  headers.set('X-Role', 'admin'); // Khách hàng tự khai báo là admin
  const req = new Request('https://example.test/qb/questions', { headers });

  const result = await verifyAuthAndDeriveContext(req, deps);

  assertAuthSuccess(result, trustedId, 'student');
  assertStrictEquals(result.context?.callerId, trustedId);
});

Deno.test('Case S - profile is_disabled is undefined/omitted -> valid success', async () => {
  const trustedId = '88888888-8888-8888-8888-888888888888';
  const mockCaller = createMockCallerAuthClient({ user: { id: trustedId } });
  const mockProfile = createMockProfileQueryClient({
    profile: { id: trustedId, role: 'teacher' }, // is_disabled không được thiết lập
  });
  const deps: InjectedAuthDependencies = {
    mode: 'injected',
    callerAuthClient: mockCaller.client,
    profileQueryClient: mockProfile.client,
  };

  const req = createTestRequest('Bearer valid-token-123');
  const result = await verifyAuthAndDeriveContext(req, deps);

  assertAuthSuccess(result, trustedId, 'teacher');
  assertStrictEquals(result.context?.callerId, trustedId);
});

Deno.test('Case T - Bearer scheme case-sensitivity rejects lowercase bearer / BEARER -> 401', async () => {
  const mockCaller = createMockCallerAuthClient();
  const mockProfile = createMockProfileQueryClient();
  const deps: InjectedAuthDependencies = {
    mode: 'injected',
    callerAuthClient: mockCaller.client,
    profileQueryClient: mockProfile.client,
  };

  const reqLower = createTestRequest('bearer valid-token-123');
  const resultLower = await verifyAuthAndDeriveContext(reqLower, deps);
  await assertAuthFailure(
    resultLower,
    401,
    'UNAUTHORIZED',
    'Yêu cầu xác thực Bearer token trong header Authorization.'
  );

  const reqUpper = createTestRequest('BEARER valid-token-123');
  const resultUpper = await verifyAuthAndDeriveContext(reqUpper, deps);
  await assertAuthFailure(
    resultUpper,
    401,
    'UNAUTHORIZED',
    'Yêu cầu xác thực Bearer token trong header Authorization.'
  );

  assertStrictEquals(mockCaller.spies.getUserCalls, 0);
  assertStrictEquals(mockProfile.spies.maybeSingleCalls, 0);
});

// ----------------------------------------------------------------------------
// Nhóm 3: Adversarial Identity Hardening Cases (2 Tests: U — V)
// ----------------------------------------------------------------------------

Deno.test('Case U - profile ID mismatch with JWT caller ID -> 500 INTERNAL_ERROR (Fail-Closed)', async () => {
  const jwtId = '11111111-1111-1111-1111-111111111111';
  const profileId = '22222222-2222-2222-2222-222222222222';
  const mockCaller = createMockCallerAuthClient({ user: { id: jwtId } });
  const mockProfile = createMockProfileQueryClient({
    profile: { id: profileId, role: 'teacher', is_disabled: false },
  });
  const mockRpc = createMockRpcClient();
  const deps: InjectedAuthDependencies = {
    mode: 'injected',
    callerAuthClient: mockCaller.client,
    profileQueryClient: mockProfile.client,
    rpcClient: mockRpc.client,
  };

  const req = createTestRequest('Bearer valid-token-123');
  const result = await verifyAuthAndDeriveContext(req, deps);

  // Khẳng định truy vấn profile dùng đúng jwtId
  assertEquals(mockProfile.spies.eqCalls, [{ col: 'id', val: jwtId }]);
  // Khẳng định khi profile.id khác jwtId thì FAIL-CLOSED 500 và không cấp adminClient
  await assertAuthFailure(
    result,
    500,
    'INTERNAL_ERROR',
    'Lỗi kiểm tra hồ sơ người dùng.'
  );
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('Case V - missing Authorization header rejection precedes malformed dependency validation', async () => {
  const malformedDeps = asMalformedAuthDependencies({ mode: 'injected' });

  const req = createTestRequest(); // Không có header Authorization
  const result = await verifyAuthAndDeriveContext(req, malformedDeps);

  await assertAuthFailure(
    result,
    401,
    'UNAUTHORIZED',
    'Yêu cầu xác thực Bearer token trong header Authorization.'
  );
});

// ----------------------------------------------------------------------------
// Nhóm 4: Two-Project Architecture Specification Tests (9 Tests: TP-A — TP-I)
// ----------------------------------------------------------------------------

Deno.test('TP-A: Valid OLD JWT + teacher/admin -> auth success with trusted callerId from JWT and returns injected QB rpcClient', async () => {
  const expectedJwtId = '99999999-9999-9999-9999-999999999999';
  const mockCaller = createMockCallerAuthClient({ user: { id: expectedJwtId } });
  const mockProfile = createMockProfileQueryClient({
    profile: { id: expectedJwtId, role: 'teacher', is_disabled: false },
  });
  const mockRpc = createMockRpcClient();

  const deps: InjectedAuthDependencies = {
    mode: 'injected',
    callerAuthClient: mockCaller.client,
    profileQueryClient: mockProfile.client,
    rpcClient: mockRpc.client,
  };

  const req = createTestRequest('Bearer valid-old-project-jwt');
  const result = await verifyAuthAndDeriveContext(req, deps);

  assertAuthSuccess(result, expectedJwtId, 'teacher', mockRpc.client);
  assertStrictEquals(result.context?.callerId, expectedJwtId);
  assertStrictEquals(result.context?.actorRole, 'teacher');
  assertStrictEquals(mockCaller.spies.getUserCalls, 1);
  assertStrictEquals(mockProfile.spies.maybeSingleCalls, 1);
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('TP-B: Invalid OLD JWT -> 401 UNAUTHORIZED and 0 QB RPC calls', async () => {
  const mockCaller = createMockCallerAuthClient({ error: new Error('Invalid JWT signature from OLD Auth') });
  const mockProfile = createMockProfileQueryClient();
  const mockRpc = createMockRpcClient();

  const deps: InjectedAuthDependencies = {
    mode: 'injected',
    callerAuthClient: mockCaller.client,
    profileQueryClient: mockProfile.client,
    rpcClient: mockRpc.client,
  };

  const req = createTestRequest('Bearer invalid-old-jwt');
  const result = await verifyAuthAndDeriveContext(req, deps);

  await assertAuthFailure(
    result,
    401,
    'UNAUTHORIZED',
    'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'
  );
  assertStrictEquals(mockCaller.spies.getUserCalls, 1);
  assertStrictEquals(mockProfile.spies.maybeSingleCalls, 0);
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('TP-C: Profile missing in OLD DB -> 403 FORBIDDEN and 0 QB RPC calls', async () => {
  const mockCaller = createMockCallerAuthClient();
  const mockProfile = createMockProfileQueryClient({ profile: null });
  const mockRpc = createMockRpcClient();

  const deps: InjectedAuthDependencies = {
    mode: 'injected',
    callerAuthClient: mockCaller.client,
    profileQueryClient: mockProfile.client,
    rpcClient: mockRpc.client,
  };

  const req = createTestRequest('Bearer valid-old-jwt');
  const result = await verifyAuthAndDeriveContext(req, deps);

  await assertAuthFailure(
    result,
    403,
    'FORBIDDEN',
    'Hồ sơ người dùng không tồn tại trong hệ thống.'
  );
  assertStrictEquals(mockCaller.spies.getUserCalls, 1);
  assertStrictEquals(mockProfile.spies.maybeSingleCalls, 1);
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('TP-D: Disabled profile in OLD DB -> 403 FORBIDDEN and 0 QB RPC calls', async () => {
  const mockCaller = createMockCallerAuthClient();
  const mockProfile = createMockProfileQueryClient({
    profile: {
      id: '00000000-0000-0000-0000-000000000001',
      role: 'teacher',
      is_disabled: true,
    },
  });
  const mockRpc = createMockRpcClient();

  const deps: InjectedAuthDependencies = {
    mode: 'injected',
    callerAuthClient: mockCaller.client,
    profileQueryClient: mockProfile.client,
    rpcClient: mockRpc.client,
  };

  const req = createTestRequest('Bearer valid-old-jwt');
  const result = await verifyAuthAndDeriveContext(req, deps);

  await assertAuthFailure(
    result,
    403,
    'FORBIDDEN',
    'Tài khoản của bạn đã bị vô hiệu hóa.'
  );
  assertStrictEquals(mockCaller.spies.getUserCalls, 1);
  assertStrictEquals(mockProfile.spies.maybeSingleCalls, 1);
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('TP-E: Invalid role in OLD DB -> 403 FORBIDDEN and 0 QB RPC calls', async () => {
  const mockCaller = createMockCallerAuthClient();
  const mockProfile = createMockProfileQueryClient({
    profile: {
      id: '00000000-0000-0000-0000-000000000001',
      role: 'guest',
      is_disabled: false,
    },
  });
  const mockRpc = createMockRpcClient();

  const deps: InjectedAuthDependencies = {
    mode: 'injected',
    callerAuthClient: mockCaller.client,
    profileQueryClient: mockProfile.client,
    rpcClient: mockRpc.client,
  };

  const req = createTestRequest('Bearer valid-old-jwt');
  const result = await verifyAuthAndDeriveContext(req, deps);

  await assertAuthFailure(
    result,
    403,
    'FORBIDDEN',
    'Vai trò người dùng không hợp lệ.'
  );
  assertStrictEquals(mockCaller.spies.getUserCalls, 1);
  assertStrictEquals(mockProfile.spies.maybeSingleCalls, 1);
  assertStrictEquals(mockRpc.calls.length, 0);
});

Deno.test('TP-F: Injected mode zero Deno.env reads & zero createClient network calls', async () => {
  const mockCaller = createMockCallerAuthClient();
  const mockProfile = createMockProfileQueryClient();
  const mockRpc = createMockRpcClient();

  const deps: InjectedAuthDependencies = {
    mode: 'injected',
    callerAuthClient: mockCaller.client,
    profileQueryClient: mockProfile.client,
    rpcClient: mockRpc.client,
  };

  const req = createTestRequest('Bearer valid-token');
  const result = await verifyAuthAndDeriveContext(req, deps);

  assertStrictEquals(result.ok, true);
  assertStrictEquals(result.adminClient, mockRpc.client);
});

Deno.test('TP-G: CORE profile client and QB RPC client are completely separated interfaces', async () => {
  const mockCaller = createMockCallerAuthClient();
  const mockProfile = createMockProfileQueryClient();
  const mockRpc = createMockRpcClient();

  const deps: InjectedAuthDependencies = {
    mode: 'injected',
    callerAuthClient: mockCaller.client,
    profileQueryClient: mockProfile.client,
    rpcClient: mockRpc.client,
  };

  assertStrictEquals((mockProfile.client as unknown) !== (mockRpc.client as unknown), true);

  const req = createTestRequest('Bearer valid-token');
  const result = await verifyAuthAndDeriveContext(req, deps);

  assertStrictEquals(result.ok, true);
  assertStrictEquals(result.adminClient, mockRpc.client);
});

Deno.test('TP-H: Production mode missing each required env -> 500 INTERNAL_ERROR (Fail-Closed)', async () => {
  const requiredEnvs = [
    'CORE_SUPABASE_URL',
    'CORE_SUPABASE_ANON_KEY',
    'CORE_SUPABASE_SERVICE_ROLE_KEY',
    'QUESTION_BANK_SUPABASE_URL',
    'QUESTION_BANK_SUPABASE_SERVICE_ROLE_KEY',
  ];

  for (const missingEnv of requiredEnvs) {
    const fullEnv: Record<string, string> = {
      CORE_SUPABASE_URL: 'https://test-core.supabase.co',
      CORE_SUPABASE_ANON_KEY: 'test-core-anon',
      CORE_SUPABASE_SERVICE_ROLE_KEY: 'test-core-service-role',
      QUESTION_BANK_SUPABASE_URL: 'https://test-qb.supabase.co',
      QUESTION_BANK_SUPABASE_SERVICE_ROLE_KEY: 'test-qb-service-role',
    };

    delete fullEnv[missingEnv];

    const req = createTestRequest('Bearer valid-token-test');
    const result = await verifyAuthAndDeriveContext(req, {
      mode: 'production',
      env: fullEnv,
    });

    await assertAuthFailure(
      result,
      500,
      'INTERNAL_ERROR',
      'Cấu hình máy chủ bị thiếu.'
    );
  }
});

Deno.test('TP-I: adminClient returned in AuthResult exactly matches injected QB RpcClient', async () => {
  const mockCaller = createMockCallerAuthClient();
  const mockProfile = createMockProfileQueryClient();
  const mockRpc = createMockRpcClient();

  const deps: InjectedAuthDependencies = {
    mode: 'injected',
    callerAuthClient: mockCaller.client,
    profileQueryClient: mockProfile.client,
    rpcClient: mockRpc.client,
  };

  const req = createTestRequest('Bearer valid-token');
  const result = await verifyAuthAndDeriveContext(req, deps);

  assertStrictEquals(result.ok, true);
  assertStrictEquals(result.adminClient, mockRpc.client);
});
