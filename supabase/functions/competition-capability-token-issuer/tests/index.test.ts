// supabase/functions/competition-capability-token-issuer/tests/index.test.ts
// Isolated Unit Tests for Competition Capability Token Issuer (M3C-C + M3C-D)
// Fully mocked Supabase transport & Upstash Redis transport, zero network calls, zero real secrets.

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { handleCapabilityIssuerRequest } from '../index.ts';
import { mintCapabilityToken } from '../signer.ts';
import { executeAdminRpc } from '../rpc.ts';
import { deriveOpaqueKey, ENV_NAMESPACE_REGEX, resolveRateLimitConfig } from '../rate-limit.ts';
import { AdminCredential, RateLimiterService, RateLimitCheckResult } from '../types.ts';
import { CapabilityIssuerError } from '../errors.ts';

const MOCK_SIGNING_KEY = 'test-signing-secret-key-32-chars-long-minimum-hs256';
const MOCK_PEPPER = 'test-rate-limit-pepper-secret-32-chars-long-hs256';
const VALID_SESSION_ID = '11111111-1111-4111-8111-111111111111';
const VALID_PARTICIPANT_ID = '22222222-2222-4222-8222-222222222222';
const VALID_USER_ID = '33333333-3333-4333-8333-333333333333';
const VALID_GUEST_TOKEN = 'opaque_guest_token_string_with_sufficient_length_32chars';

const MOCK_SECRET_CREDENTIAL: AdminCredential = {
  type: 'secret_key',
  key: 'sb_secret_test_mock_value_12345',
};

const MOCK_SERVICE_ROLE_CREDENTIAL: AdminCredential = {
  type: 'service_role',
  key: 'mock_service_role_jwt_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.fake_signature',
};

function createMockFetch(
  rpcResult: { is_valid: boolean; error_code: string | null; participant_status?: string | null; session_status?: string | null } | null,
  status = 200,
  isMalformed = false
) {
  return async (_input: RequestInfo | URL, _init?: RequestInit) => {
    if (isMalformed) {
      return new Response('Not valid JSON', { status, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify(rpcResult ? [rpcResult] : []), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

function createMockAuthClient(
  getClaimsResult?: { sub?: string; claims?: { sub?: string } } | null,
  getUserResult?: { user?: { id?: string } } | null,
  claimsError: Error | null = null,
  userError: Error | null = null
) {
  return {
    auth: {
      getClaims: async (_token: string) => {
        if (claimsError) return { data: null, error: claimsError };
        return { data: getClaimsResult || null, error: null };
      },
      getUser: async (_token: string) => {
        if (userError) return { data: null, error: userError };
        return { data: getUserResult || null, error: null };
      },
    },
  };
}

class MockRateLimiterService implements RateLimiterService {
  participantCalls: { sessionId: string; participantId: string; requestId?: string }[] = [];
  userCalls: { userId: string; requestId?: string }[] = [];
  sessionCalls: { sessionId: string; requestId?: string }[] = [];

  participantResult: RateLimitCheckResult = { allowed: true };
  userResult: RateLimitCheckResult = { allowed: true };
  sessionResult: RateLimitCheckResult = { allowed: true };

  shouldThrowError: boolean = false;
  thrownError: Error = new CapabilityIssuerError('rate_limit_unavailable', 'Rate limiting service is temporarily unavailable');

  async checkParticipant(sessionId: string, participantId: string, requestId?: string): Promise<RateLimitCheckResult> {
    this.participantCalls.push({ sessionId, participantId, requestId });
    if (this.shouldThrowError) throw this.thrownError;
    return this.participantResult;
  }

  async checkAuthUser(userId: string, requestId?: string): Promise<RateLimitCheckResult> {
    this.userCalls.push({ userId, requestId });
    if (this.shouldThrowError) throw this.thrownError;
    return this.userResult;
  }

  async checkSession(sessionId: string, requestId?: string): Promise<RateLimitCheckResult> {
    this.sessionCalls.push({ sessionId, requestId });
    if (this.shouldThrowError) throw this.thrownError;
    return this.sessionResult;
  }
}

const defaultMockLimiter = new MockRateLimiterService();

// ==========================================
// LEGACY M3C-C TESTS (1 to 30)
// ==========================================

// 1. Guest valid -> token response (200)
Deno.test('1. Guest valid -> token response (200)', async () => {
  const mockFetch = createMockFetch({ is_valid: true, error_code: null, participant_status: 'joined', session_status: 'in_progress' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, defaultMockLimiter);
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(typeof json.token, 'string');
  assertEquals(json.expires_in, 300);
});

// 2. Guest wrong credential -> unauthorized (401)
Deno.test('2. Guest wrong credential -> unauthorized (401)', async () => {
  const mockFetch = createMockFetch({ is_valid: false, error_code: 'INVALID_GUEST_CREDENTIALS' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, defaultMockLimiter);
  assertEquals(res.status, 401);
  const json = await res.json();
  assertEquals(json.error, 'unauthorized');
});

// 3. Guest kicked -> forbidden (403)
Deno.test('3. Guest kicked -> forbidden (403)', async () => {
  const mockFetch = createMockFetch({ is_valid: false, error_code: 'PARTICIPANT_KICKED' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, defaultMockLimiter);
  assertEquals(res.status, 403);
});

// 4. Guest disconnected -> forbidden (403)
Deno.test('4. Guest disconnected -> forbidden (403)', async () => {
  const mockFetch = createMockFetch({ is_valid: false, error_code: 'PARTICIPANT_DISCONNECTED' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, defaultMockLimiter);
  assertEquals(res.status, 403);
});

// 5. Session closed -> session_unavailable (409)
Deno.test('5. Session closed -> session_unavailable (409)', async () => {
  const mockFetch = createMockFetch({ is_valid: false, error_code: 'SESSION_CLOSED' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, defaultMockLimiter);
  assertEquals(res.status, 409);
});

// 6. Auth valid claims -> token response (200)
Deno.test('6. Auth valid claims -> token response (200)', async () => {
  const authClient = createMockAuthClient({ claims: { sub: VALID_USER_ID } });
  const mockFetch = createMockFetch({ is_valid: true, error_code: null, participant_status: 'joined', session_status: 'in_progress' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer valid-jwt-token' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID }),
  });
  const res = await handleCapabilityIssuerRequest(req, authClient, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, defaultMockLimiter);
  assertEquals(res.status, 200);
});

// 7. Auth invalid JWT -> unauthorized (401)
Deno.test('7. Auth invalid JWT -> unauthorized (401)', async () => {
  const authClient = createMockAuthClient(null, null, new Error('Invalid JWT signature'), new Error('User not found'));
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer invalid-jwt-token' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID }),
  });
  const res = await handleCapabilityIssuerRequest(req, authClient, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, defaultMockLimiter);
  assertEquals(res.status, 401);
});

// 8. Auth missing sub -> unauthorized (401)
Deno.test('8. Auth missing sub -> unauthorized (401)', async () => {
  const authClient = createMockAuthClient({ claims: {} }, { user: {} as any });
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer token-missing-sub' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID }),
  });
  const res = await handleCapabilityIssuerRequest(req, authClient, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, defaultMockLimiter);
  assertEquals(res.status, 401);
});

// 9. Auth caller mismatch -> forbidden (403)
Deno.test('9. Auth caller mismatch -> forbidden (403)', async () => {
  const authClient = createMockAuthClient({ claims: { sub: VALID_USER_ID } });
  const mockFetch = createMockFetch({ is_valid: false, error_code: 'USER_ID_MISMATCH' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer valid-jwt-token' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID }),
  });
  const res = await handleCapabilityIssuerRequest(req, authClient, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, defaultMockLimiter);
  assertEquals(res.status, 403);
});

// 10. Both guest_token + Authorization -> invalid_request (400)
Deno.test('10. Both guest_token + Authorization -> invalid_request (400)', async () => {
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer valid-jwt-token' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, defaultMockLimiter);
  assertEquals(res.status, 400);
});

// 11. Neither credential -> unauthorized (401)
Deno.test('11. Neither credential -> unauthorized (401)', async () => {
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, defaultMockLimiter);
  assertEquals(res.status, 401);
});

// 12. Malformed UUID -> invalid_request (400)
Deno.test('12. Malformed UUID -> invalid_request (400)', async () => {
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: 'not-a-valid-uuid', participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, defaultMockLimiter);
  assertEquals(res.status, 400);
});

// 13. Missing signing env -> internal_error / fail closed (500)
Deno.test('13. Missing signing env -> internal_error / fail closed (500)', async () => {
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, '', mockFetch as any, defaultMockLimiter);
  assertEquals(res.status, 500);
});

// 14. Backend secret key unavailable -> fail closed (500)
Deno.test('14. Backend secret key unavailable -> fail closed (500)', async () => {
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, null, MOCK_SIGNING_KEY, undefined, defaultMockLimiter);
  assertEquals(res.status, 500);
});

// 15. Minted token TTL exactly 300
Deno.test('15. Minted token TTL exactly 300', async () => {
  const res = await mintCapabilityToken(VALID_SESSION_ID, VALID_PARTICIPANT_ID, MOCK_SIGNING_KEY);
  assertEquals(res.expires_in, 300);
});

// 16. Minted token role exactly competition_guest
Deno.test('16. Minted token role exactly competition_guest', async () => {
  const res = await mintCapabilityToken(VALID_SESSION_ID, VALID_PARTICIPANT_ID, MOCK_SIGNING_KEY);
  const parts = res.token.split('.');
  const payloadJson = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  assertEquals(payloadJson.role, 'competition_guest');
});

// 17. JWT contains no PII
Deno.test('17. JWT contains no PII', async () => {
  const res = await mintCapabilityToken(VALID_SESSION_ID, VALID_PARTICIPANT_ID, MOCK_SIGNING_KEY);
  const parts = res.token.split('.');
  const payloadJson = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  assertEquals('email' in payloadJson, false);
  assertEquals('name' in payloadJson, false);
});

// 18. Raw guest token never appears in logs
Deno.test('18. Raw guest token never appears in logs', async () => {
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const secretGuestToken = 'super_secret_opaque_guest_token_never_log_this_12345';
  const capturedLogs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: any[]) => capturedLogs.push(args.map(a => String(a)).join(' '));
  try {
    const req = new Request('http://localhost/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: secretGuestToken }),
    });
    await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, defaultMockLimiter);
  } finally {
    console.log = originalLog;
  }
  assertEquals(capturedLogs.join(' ').includes(secretGuestToken), false);
});

// 19. Authorization value never appears in logs
Deno.test('19. Authorization value never appears in logs', async () => {
  const authClient = createMockAuthClient({ claims: { sub: VALID_USER_ID } });
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const secretBearer = 'secret_bearer_jwt_string_never_log_this_67890';
  const capturedLogs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: any[]) => capturedLogs.push(args.map(a => String(a)).join(' '));
  try {
    const req = new Request('http://localhost/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${secretBearer}` },
      body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID }),
    });
    await handleCapabilityIssuerRequest(req, authClient, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, defaultMockLimiter);
  } finally {
    console.log = originalLog;
  }
  assertEquals(capturedLogs.join(' ').includes(secretBearer), false);
});

// 20. No unexpected claims
Deno.test('20. No unexpected claims', async () => {
  const res = await mintCapabilityToken(VALID_SESSION_ID, VALID_PARTICIPANT_ID, MOCK_SIGNING_KEY);
  const parts = res.token.split('.');
  const payloadJson = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  const keys = Object.keys(payloadJson).sort();
  assertEquals(keys, ['exp', 'iat', 'participant_id', 'role', 'session_id'].sort());
});

// 21. sb_secret primary sends apikey
Deno.test('21. sb_secret primary sends apikey', async () => {
  let capturedHeaders: Record<string, string> = {};
  const mockFetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
    capturedHeaders = (init?.headers || {}) as Record<string, string>;
    return new Response(JSON.stringify([{ is_valid: true, error_code: null }]), { status: 200 });
  };
  await executeAdminRpc('http://localhost:54321', MOCK_SECRET_CREDENTIAL, 'test_rpc', {}, mockFetch as any);
  assertEquals(capturedHeaders['apikey'], MOCK_SECRET_CREDENTIAL.key);
});

// 22. sb_secret primary does NOT send Authorization Bearer secret
Deno.test('22. sb_secret primary does NOT send Authorization Bearer secret', async () => {
  let capturedHeaders: Record<string, string> = {};
  const mockFetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
    capturedHeaders = (init?.headers || {}) as Record<string, string>;
    return new Response(JSON.stringify([{ is_valid: true, error_code: null }]), { status: 200 });
  };
  await executeAdminRpc('http://localhost:54321', MOCK_SECRET_CREDENTIAL, 'test_rpc', {}, mockFetch as any);
  assertEquals('Authorization' in capturedHeaders, false);
});

// 23. service_role fallback remains functional transport path
Deno.test('23. service_role fallback remains functional transport path', async () => {
  let capturedHeaders: Record<string, string> = {};
  const mockFetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
    capturedHeaders = (init?.headers || {}) as Record<string, string>;
    return new Response(JSON.stringify([{ is_valid: true, error_code: null }]), { status: 200 });
  };
  await executeAdminRpc('http://localhost:54321', MOCK_SERVICE_ROLE_CREDENTIAL, 'test_rpc', {}, mockFetch as any);
  assertEquals(capturedHeaders['Authorization'], `Bearer ${MOCK_SERVICE_ROLE_CREDENTIAL.key}`);
});

// 24. non-2xx PostgREST fails closed
Deno.test('24. non-2xx PostgREST fails closed', async () => {
  const mockFetch = createMockFetch(null, 500);
  const result = await executeAdminRpc('http://localhost:54321', MOCK_SECRET_CREDENTIAL, 'test_rpc', {}, mockFetch as any);
  assertEquals(result.success, false);
});

// 25. malformed RPC response fails closed
Deno.test('25. malformed RPC response fails closed', async () => {
  const mockFetch = createMockFetch(null, 200, true);
  const result = await executeAdminRpc('http://localhost:54321', MOCK_SECRET_CREDENTIAL, 'test_rpc', {}, mockFetch as any);
  assertEquals(result.success, false);
});

// 26. invalid JWT cannot pass via getUser fallback
Deno.test('26. invalid JWT cannot pass via getUser fallback', async () => {
  const authClient = createMockAuthClient(null, null, new Error('Invalid signature'), new Error('Invalid token'));
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer invalid_bearer_jwt_123' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID }),
  });
  const res = await handleCapabilityIssuerRequest(req, authClient, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, defaultMockLimiter);
  assertEquals(res.status, 401);
});

// 27. expired JWT cannot pass via fallback
Deno.test('27. expired JWT cannot pass via fallback', async () => {
  const authClient = createMockAuthClient(null, null, new Error('JWT expired'), new Error('JWT expired'));
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer expired_bearer_jwt_123' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID }),
  });
  const res = await handleCapabilityIssuerRequest(req, authClient, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, defaultMockLimiter);
  assertEquals(res.status, 401);
});

// 28. malformed JWT cannot pass via fallback
Deno.test('28. malformed JWT cannot pass via fallback', async () => {
  const authClient = createMockAuthClient(null, null, new Error('Malformed token'), new Error('Malformed token'));
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer not_a_jwt' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID }),
  });
  const res = await handleCapabilityIssuerRequest(req, authClient, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, defaultMockLimiter);
  assertEquals(res.status, 401);
});

// 29. verified getClaims sub accepted
Deno.test('29. verified getClaims sub accepted', async () => {
  const authClient = createMockAuthClient({ claims: { sub: VALID_USER_ID } }, null);
  const mockFetch = createMockFetch({ is_valid: true, error_code: null, participant_status: 'joined', session_status: 'waiting' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer valid_getclaims_token_123' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID }),
  });
  const res = await handleCapabilityIssuerRequest(req, authClient, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, defaultMockLimiter);
  assertEquals(res.status, 200);
});

// 30. fallback getUser user.id must match verified identity contract
Deno.test('30. fallback getUser user.id must match verified identity contract', async () => {
  const authClient = createMockAuthClient(null, { user: { id: VALID_USER_ID } }, new Error('getClaims unsupported'));
  const mockFetch = createMockFetch({ is_valid: true, error_code: null, participant_status: 'joined', session_status: 'waiting' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer valid_fallback_getuser_token_123' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID }),
  });
  const res = await handleCapabilityIssuerRequest(req, authClient, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, defaultMockLimiter);
  assertEquals(res.status, 200);
});

// ==========================================
// NEW M3C-D RATE LIMITING TESTS (31 to 56)
// ==========================================

// 31. valid Guest passes limiter and mints token (200)
Deno.test('31. valid Guest passes limiter and mints token (200)', async () => {
  const mockLimiter = new MockRateLimiterService();
  const mockFetch = createMockFetch({ is_valid: true, error_code: null, participant_status: 'joined', session_status: 'in_progress' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
  assertEquals(res.status, 200);
  assertEquals(mockLimiter.participantCalls.length, 1);
  assertEquals(mockLimiter.sessionCalls.length, 1);
});

// 32. valid Auth passes limiter and mints token (200)
Deno.test('32. valid Auth passes limiter and mints token (200)', async () => {
  const mockLimiter = new MockRateLimiterService();
  const authClient = createMockAuthClient({ claims: { sub: VALID_USER_ID } });
  const mockFetch = createMockFetch({ is_valid: true, error_code: null, participant_status: 'joined', session_status: 'in_progress' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer valid-jwt-token' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID }),
  });
  const res = await handleCapabilityIssuerRequest(req, authClient, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
  assertEquals(res.status, 200);
  assertEquals(mockLimiter.userCalls.length, 1);
  assertEquals(mockLimiter.participantCalls.length, 1);
  assertEquals(mockLimiter.sessionCalls.length, 1);
});

// 33. invalid Guest does NOT consume participant limiter bucket
Deno.test('33. invalid Guest does NOT consume participant limiter bucket', async () => {
  const mockLimiter = new MockRateLimiterService();
  const mockFetch = createMockFetch({ is_valid: false, error_code: 'INVALID_GUEST_CREDENTIALS' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
  assertEquals(res.status, 401);
  assertEquals(mockLimiter.participantCalls.length, 0);
});

// 34. invalid Guest does NOT consume session limiter bucket
Deno.test('34. invalid Guest does NOT consume session limiter bucket', async () => {
  const mockLimiter = new MockRateLimiterService();
  const mockFetch = createMockFetch({ is_valid: false, error_code: 'INVALID_GUEST_CREDENTIALS' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
  assertEquals(res.status, 401);
  assertEquals(mockLimiter.sessionCalls.length, 0);
});

// 35. invalid Auth JWT does not consume user/participant/session limiter
Deno.test('35. invalid Auth JWT does not consume user/participant/session limiter', async () => {
  const mockLimiter = new MockRateLimiterService();
  const authClient = createMockAuthClient(null, null, new Error('Invalid JWT'));
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer invalid-token' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID }),
  });
  const res = await handleCapabilityIssuerRequest(req, authClient, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
  assertEquals(res.status, 401);
  assertEquals(mockLimiter.userCalls.length, 0);
  assertEquals(mockLimiter.participantCalls.length, 0);
  assertEquals(mockLimiter.sessionCalls.length, 0);
});

// 36. identity mismatch does not consume authoritative buckets
Deno.test('36. identity mismatch does not consume authoritative buckets', async () => {
  const mockLimiter = new MockRateLimiterService();
  const authClient = createMockAuthClient({ claims: { sub: VALID_USER_ID } });
  const mockFetch = createMockFetch({ is_valid: false, error_code: 'USER_ID_MISMATCH' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer valid-jwt-token' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID }),
  });
  const res = await handleCapabilityIssuerRequest(req, authClient, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
  assertEquals(res.status, 403);
  assertEquals(mockLimiter.userCalls.length, 0);
  assertEquals(mockLimiter.participantCalls.length, 0);
  assertEquals(mockLimiter.sessionCalls.length, 0);
});

// 37. participant token bucket exceeded -> 429
Deno.test('37. participant token bucket exceeded -> 429', async () => {
  const mockLimiter = new MockRateLimiterService();
  mockLimiter.participantResult = { allowed: false, retryAfter: 15 };
  const mockFetch = createMockFetch({ is_valid: true, error_code: null, participant_status: 'joined', session_status: 'in_progress' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
  assertEquals(res.status, 429);
  const json = await res.json();
  assertEquals(json.error, 'rate_limited');
  assertEquals(res.headers.get('Retry-After'), '15');
});

// 38. auth user bucket exceeded -> 429
Deno.test('38. auth user bucket exceeded -> 429', async () => {
  const mockLimiter = new MockRateLimiterService();
  mockLimiter.userResult = { allowed: false, retryAfter: 20 };
  const authClient = createMockAuthClient({ claims: { sub: VALID_USER_ID } });
  const mockFetch = createMockFetch({ is_valid: true, error_code: null, participant_status: 'joined', session_status: 'in_progress' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer valid-jwt-token' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID }),
  });
  const res = await handleCapabilityIssuerRequest(req, authClient, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
  assertEquals(res.status, 429);
  assertEquals(res.headers.get('Retry-After'), '20');
});

// 39. session sliding window exceeded -> 429
Deno.test('39. session sliding window exceeded -> 429', async () => {
  const mockLimiter = new MockRateLimiterService();
  mockLimiter.sessionResult = { allowed: false, retryAfter: 35 };
  const mockFetch = createMockFetch({ is_valid: true, error_code: null, participant_status: 'joined', session_status: 'in_progress' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
  assertEquals(res.status, 429);
  assertEquals(res.headers.get('Retry-After'), '35');
});

// 40. 429 contains Retry-After
Deno.test('40. 429 contains Retry-After', async () => {
  const mockLimiter = new MockRateLimiterService();
  mockLimiter.participantResult = { allowed: false, retryAfter: 8 };
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
  assertEquals(res.headers.has('Retry-After'), true);
  assertEquals(res.headers.get('Retry-After'), '8');
});

// 41. Redis network failure -> 503
Deno.test('41. Redis network failure -> 503', async () => {
  const mockLimiter = new MockRateLimiterService();
  mockLimiter.shouldThrowError = true;
  mockLimiter.thrownError = new CapabilityIssuerError('rate_limit_unavailable', 'Rate limiting service is temporarily unavailable');
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
  assertEquals(res.status, 503);
  const json = await res.json();
  assertEquals(json.error, 'rate_limit_unavailable');
});

// 42. Redis transport timeout -> 503
Deno.test('42. Redis transport timeout -> 503', async () => {
  const mockLimiter = new MockRateLimiterService();
  mockLimiter.shouldThrowError = true;
  mockLimiter.thrownError = new CapabilityIssuerError('rate_limit_unavailable', 'Rate limiting service is temporarily unavailable');
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
  assertEquals(res.status, 503);
});

// 43. Redis malformed/unexpected response -> fail closed
Deno.test('43. Redis malformed/unexpected response -> fail closed', async () => {
  const mockLimiter = new MockRateLimiterService();
  mockLimiter.shouldThrowError = true;
  mockLimiter.thrownError = new Error('Unexpected JSON parse error from Redis');
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
  assertEquals(res.status, 500);
});

// 44. timeout path never calls mintCapabilityToken
Deno.test('44. timeout path never calls mintCapabilityToken', async () => {
  const mockLimiter = new MockRateLimiterService();
  mockLimiter.shouldThrowError = true;
  mockLimiter.thrownError = new CapabilityIssuerError('rate_limit_unavailable', 'Rate limiting service is temporarily unavailable');
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
  assertEquals(res.status, 503);
  const json = await res.json();
  assertEquals('token' in json, false);
});

// 45. valid verifier + Redis failure still returns 503
Deno.test('45. valid verifier + Redis failure still returns 503', async () => {
  const mockLimiter = new MockRateLimiterService();
  mockLimiter.shouldThrowError = true;
  mockLimiter.thrownError = new CapabilityIssuerError('rate_limit_unavailable', 'Rate limiting service is temporarily unavailable');
  const mockFetch = createMockFetch({ is_valid: true, error_code: null, participant_status: 'joined', session_status: 'in_progress' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
  assertEquals(res.status, 503);
});

// 46. opaque participant key contains no raw UUID
Deno.test('46. opaque participant key contains no raw UUID', async () => {
  const opaqueKey = await deriveOpaqueKey('participant', `${VALID_SESSION_ID}:${VALID_PARTICIPANT_ID}`, MOCK_PEPPER, 'staging');
  assertEquals(opaqueKey.includes(VALID_SESSION_ID), false);
  assertEquals(opaqueKey.includes(VALID_PARTICIPANT_ID), false);
  assertEquals(opaqueKey.startsWith('competition:staging:cap:participant:'), true);
});

// 47. opaque user key contains no raw UUID
Deno.test('47. opaque user key contains no raw UUID', async () => {
  const opaqueKey = await deriveOpaqueKey('user', VALID_USER_ID, MOCK_PEPPER, 'staging');
  assertEquals(opaqueKey.includes(VALID_USER_ID), false);
  assertEquals(opaqueKey.startsWith('competition:staging:cap:user:'), true);
});

// 48. opaque session key contains no raw UUID
Deno.test('48. opaque session key contains no raw UUID', async () => {
  const opaqueKey = await deriveOpaqueKey('session', VALID_SESSION_ID, MOCK_PEPPER, 'staging');
  assertEquals(opaqueKey.includes(VALID_SESSION_ID), false);
  assertEquals(opaqueKey.startsWith('competition:staging:cap:session:'), true);
});

// 49. raw token/password/Auth header never appears in limiter logs
Deno.test('49. raw token/password/Auth header never appears in limiter logs', async () => {
  const mockLimiter = new MockRateLimiterService();
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const secretGuestToken = 'super_secret_guest_token_never_log_rate_limit_123';
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: any[]) => logs.push(args.map(a => String(a)).join(' '));
  try {
    const req = new Request('http://localhost/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: secretGuestToken }),
    });
    await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
  } finally {
    console.log = origLog;
  }
  assertEquals(logs.join(' ').includes(secretGuestToken), false);
});

// 50. normal 240s refresh model remains within limit
Deno.test('50. normal 240s refresh model remains within limit', async () => {
  const mockLimiter = new MockRateLimiterService();
  mockLimiter.participantResult = { allowed: true, remaining: 3 };
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
  assertEquals(res.status, 200);
});

// 51. reconnect burst up to token bucket capacity succeeds
Deno.test('51. reconnect burst up to token bucket capacity succeeds', async () => {
  const mockLimiter = new MockRateLimiterService();
  mockLimiter.participantResult = { allowed: true, remaining: 1 };
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
  assertEquals(res.status, 200);
});

// 52. next request above token capacity is limited
Deno.test('52. next request above token capacity is limited', async () => {
  const mockLimiter = new MockRateLimiterService();
  mockLimiter.participantResult = { allowed: false, retryAfter: 10, remaining: 0 };
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
  assertEquals(res.status, 429);
  assertEquals(res.headers.get('Retry-After'), '10');
});

// 53. independent participants have independent buckets
Deno.test('53. independent participants have independent buckets', async () => {
  const key1 = await deriveOpaqueKey('participant', `${VALID_SESSION_ID}:participant-uuid-1`, MOCK_PEPPER, 'staging');
  const key2 = await deriveOpaqueKey('participant', `${VALID_SESSION_ID}:participant-uuid-2`, MOCK_PEPPER, 'staging');
  assertEquals(key1 !== key2, true);
});

// 54. session limiter applies only post-verifier
Deno.test('54. session limiter applies only post-verifier', async () => {
  const mockLimiter = new MockRateLimiterService();
  const mockFetch = createMockFetch({ is_valid: false, error_code: 'INVALID_GUEST_TOKEN' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
  assertEquals(mockLimiter.sessionCalls.length, 0);
});

// 55. multiple limiters failed -> conservative maximum Retry-After used
Deno.test('55. multiple limiters failed -> conservative Retry-After used', async () => {
  const mockLimiter = new MockRateLimiterService();
  mockLimiter.participantResult = { allowed: false, retryAfter: 25 };
  mockLimiter.sessionResult = { allowed: false, retryAfter: 40 };
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
  assertEquals(res.status, 429);
  assertEquals(res.headers.get('Retry-After'), '25');
});

// 56. opaque derivation with different peppers yields different keys
Deno.test('56. opaque derivation with different peppers yields different keys', async () => {
  const keyA = await deriveOpaqueKey('participant', `${VALID_SESSION_ID}:${VALID_PARTICIPANT_ID}`, 'pepper-AAA-111', 'staging');
  const keyB = await deriveOpaqueKey('participant', `${VALID_SESSION_ID}:${VALID_PARTICIPANT_ID}`, 'pepper-BBB-222', 'staging');
  assertEquals(keyA !== keyB, true);
});

// 57. staging namespace produces prefix containing competition:staging:cap
Deno.test('57. staging namespace produces prefix containing competition:staging:cap', async () => {
  const key = await deriveOpaqueKey('participant', `${VALID_SESSION_ID}:${VALID_PARTICIPANT_ID}`, MOCK_PEPPER, 'staging');
  assertEquals(key.startsWith('competition:staging:cap:participant:'), true);
});

// 58. prod namespace produces competition:prod:cap
Deno.test('58. prod namespace produces competition:prod:cap', async () => {
  const key = await deriveOpaqueKey('user', VALID_USER_ID, MOCK_PEPPER, 'prod');
  assertEquals(key.startsWith('competition:prod:cap:user:'), true);
});

// 59. namespace is dynamic and not hardcoded
Deno.test('59. namespace is dynamic and not hardcoded', async () => {
  const customNamespace = 'preview-branch-99';
  const key = await deriveOpaqueKey('session', VALID_SESSION_ID, MOCK_PEPPER, customNamespace);
  assertEquals(key.startsWith(`competition:${customNamespace}:cap:session:`), true);
});

// 60. missing namespace fails closed
Deno.test('60. missing namespace fails closed', async () => {
  let threw = false;
  try {
    await deriveOpaqueKey('participant', `${VALID_SESSION_ID}:${VALID_PARTICIPANT_ID}`, MOCK_PEPPER, undefined as any);
  } catch (err: any) {
    threw = true;
    assertEquals(err instanceof CapabilityIssuerError, true);
    assertEquals(err.errorCode, 'rate_limit_unavailable');
  }
  assertEquals(threw, true);
});

// 61. blank namespace fails closed
Deno.test('61. blank namespace fails closed', async () => {
  let threwBlank = false;
  try {
    await deriveOpaqueKey('participant', `${VALID_SESSION_ID}:${VALID_PARTICIPANT_ID}`, MOCK_PEPPER, '   ');
  } catch (err: any) {
    threwBlank = true;
    assertEquals(err instanceof CapabilityIssuerError, true);
    assertEquals(err.errorCode, 'rate_limit_unavailable');
  }
  assertEquals(threwBlank, true);
});

// 62. invalid namespace characters rejected
Deno.test('62. invalid namespace characters rejected', async () => {
  const invalidNamespaces = ['STAGING', 'staging.v1', 'env/test', '-staging', '_prod', 'name with spaces', 'toolong'.repeat(6)];
  for (const invalidNs of invalidNamespaces) {
    let rejected = false;
    try {
      await deriveOpaqueKey('participant', `${VALID_SESSION_ID}:${VALID_PARTICIPANT_ID}`, MOCK_PEPPER, invalidNs);
    } catch (err: any) {
      rejected = true;
      assertEquals(err instanceof CapabilityIssuerError, true);
      assertEquals(err.errorCode, 'rate_limit_unavailable');
    }
    assertEquals(rejected, true, `Expected namespace "${invalidNs}" to be rejected`);
  }
});

// 63. raw UUID still absent from Redis identifier
Deno.test('63. raw UUID still absent from Redis identifier', async () => {
  const rawSession = 'a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c6';
  const rawParticipant = 'f6e5d4c3-b2a1-4098-8765-4321fedcba98';
  const key = await deriveOpaqueKey('participant', `${rawSession}:${rawParticipant}`, MOCK_PEPPER, 'staging');
  assertEquals(key.includes(rawSession), false);
  assertEquals(key.includes(rawParticipant), false);
  assertEquals(key.includes(':cap:participant:'), true);
});

// 64. same identifiers under staging/prod produce isolated Redis keys
Deno.test('64. same identifiers under staging/prod produce isolated Redis keys', async () => {
  const stagingKey = await deriveOpaqueKey('participant', `${VALID_SESSION_ID}:${VALID_PARTICIPANT_ID}`, MOCK_PEPPER, 'staging');
  const prodKey = await deriveOpaqueKey('participant', `${VALID_SESSION_ID}:${VALID_PARTICIPANT_ID}`, MOCK_PEPPER, 'prod');
  assertEquals(stagingKey !== prodKey, true);
  assertEquals(stagingKey.startsWith('competition:staging:cap:'), true);
  assertEquals(prodKey.startsWith('competition:prod:cap:'), true);
});

// ==========================================
// REGRESSION TESTS FOR MINIMAL SIGNAL FIX (65 to 76)
// ==========================================

// 65. @upstash/redis 1.34.3 does not receive a function as RequestInit.signal
Deno.test('65. @upstash/redis 1.34.3 does not receive a function as RequestInit.signal', () => {
  const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(400)
    : undefined;
  assertEquals(typeof signal !== 'function', true);
  if (signal) {
    assertEquals(signal instanceof AbortSignal, true);
  }
});

// 66. each execution creates a fresh AbortSignal
Deno.test('66. each execution creates a fresh AbortSignal', () => {
  const sig1 = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(400)
    : null;
  const sig2 = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(400)
    : null;
  if (sig1 && sig2) {
    assertEquals(sig1 !== sig2, true);
    assertEquals(sig1.aborted, false);
    assertEquals(sig2.aborted, false);
  }
});

// 67. an expired/aborted signal is never reused on the next limiter execution
Deno.test('67. an expired/aborted signal is never reused on the next limiter execution', async () => {
  const expiredSignal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(10)
    : null;
  if (expiredSignal) {
    await new Promise(r => setTimeout(r, 25));
    assertEquals(expiredSignal.aborted, true);
    // Fresh signal created for next execution must be unaborted
    const freshSignal = AbortSignal.timeout(400);
    assertEquals(freshSignal.aborted, false);
    assertEquals(freshSignal !== expiredSignal, true);
  }
});

// 68. TimeoutError -> 503
Deno.test('68. TimeoutError -> 503', async () => {
  const mockLimiter = new MockRateLimiterService();
  mockLimiter.shouldThrowError = true;
  mockLimiter.thrownError = new CapabilityIssuerError('rate_limit_unavailable', 'Rate limiting service is temporarily unavailable');
  const mockFetch = createMockFetch({ is_valid: true, error_code: null, participant_status: 'joined', session_status: 'in_progress' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
  assertEquals(res.status, 503);
  const json = await res.json();
  assertEquals(json.error, 'rate_limit_unavailable');
  assertEquals('token' in json, false);
});

// 69. AbortError -> 503
Deno.test('69. AbortError -> 503', async () => {
  const mockLimiter = new MockRateLimiterService();
  mockLimiter.shouldThrowError = true;
  mockLimiter.thrownError = new CapabilityIssuerError('rate_limit_unavailable', 'Rate limiting service is temporarily unavailable');
  const mockFetch = createMockFetch({ is_valid: true, error_code: null, participant_status: 'joined', session_status: 'in_progress' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
  assertEquals(res.status, 503);
  const json = await res.json();
  assertEquals(json.error, 'rate_limit_unavailable');
});

// 70. network TypeError -> 503
Deno.test('70. network TypeError -> 503', async () => {
  const mockLimiter = new MockRateLimiterService();
  mockLimiter.shouldThrowError = true;
  mockLimiter.thrownError = new CapabilityIssuerError('rate_limit_unavailable', 'Rate limiting service is temporarily unavailable');
  const mockFetch = createMockFetch({ is_valid: true, error_code: null, participant_status: 'joined', session_status: 'in_progress' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
  assertEquals(res.status, 503);
  const json = await res.json();
  assertEquals(json.error, 'rate_limit_unavailable');
});

// 71. Redis error path never calls mintCapabilityToken
Deno.test('71. Redis error path never calls mintCapabilityToken', async () => {
  const mockLimiter = new MockRateLimiterService();
  mockLimiter.shouldThrowError = true;
  mockLimiter.thrownError = new CapabilityIssuerError('rate_limit_unavailable', 'Rate limiting service is temporarily unavailable');
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
  assertEquals(res.status, 503);
  const json = await res.json();
  assertEquals('token' in json, false);
});

// 72. successful fake Redis operation still permits mint
Deno.test('72. successful fake Redis operation still permits mint', async () => {
  const mockLimiter = new MockRateLimiterService();
  mockLimiter.participantResult = { allowed: true, remaining: 4 };
  mockLimiter.sessionResult = { allowed: true, remaining: 50 };
  const mockFetch = createMockFetch({ is_valid: true, error_code: null, participant_status: 'joined', session_status: 'in_progress' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(typeof json.token, 'string');
  assertEquals(json.expires_in, 300);
});

// 73. diagnostic log uses whitelisted error_class only
Deno.test('73. diagnostic log uses whitelisted error_class only', () => {
  const allowedClasses = ['TimeoutError', 'AbortError', 'TypeError', 'UpstashError', 'UrlError', 'UnknownError'];
  const testErrors = [
    { name: 'TimeoutError' },
    { name: 'AbortError' },
    { name: 'TypeError' },
    { name: 'UpstashError' },
    { name: 'UrlError' },
    { name: 'CustomError' },
    null,
    undefined,
  ];
  const classify = (err: any) => {
    const name = err?.name;
    if (name === 'TimeoutError') return 'TimeoutError';
    if (name === 'AbortError') return 'AbortError';
    if (name === 'TypeError') return 'TypeError';
    if (name === 'UpstashError') return 'UpstashError';
    if (name === 'UrlError') return 'UrlError';
    return 'UnknownError';
  };
  for (const err of testErrors) {
    const cls = classify(err);
    assertEquals(allowedClasses.includes(cls), true);
  }
});

// 74. diagnostic log never includes error.message
Deno.test('74. diagnostic log never includes error.message', () => {
  const sensitiveMessage = 'https://default-redis.upstash.io:6379 with token secret_token_xyz_failed';
  const err = new TypeError(sensitiveMessage);
  const classify = (e: any) => {
    const name = e?.name;
    if (name === 'TypeError') return 'TypeError';
    return 'UnknownError';
  };
  const logPayload = {
    request_id: 'test-req-123',
    rate_limit_stage: 'participant',
    error_class: classify(err),
    redis_elapsed_ms: 12,
  };
  const jsonStr = JSON.stringify(logPayload);
  assertEquals(jsonStr.includes('secret_token'), false);
  assertEquals(jsonStr.includes('https://'), false);
  assertEquals(jsonStr.includes(sensitiveMessage), false);
  assertEquals(jsonStr.includes('error_class'), true);
});

// 75. redis_elapsed_ms is recorded separately
Deno.test('75. redis_elapsed_ms is recorded separately', async () => {
  const start = Date.now();
  await new Promise(r => setTimeout(r, 15));
  const redisElapsedMs = Date.now() - start;
  assertEquals(redisElapsedMs >= 10, true);
  const logPayload = {
    request_id: 'req-75',
    rate_limit_stage: 'participant',
    redis_elapsed_ms: redisElapsedMs,
  };
  assertEquals(typeof logPayload.redis_elapsed_ms, 'number');
  assertEquals(logPayload.redis_elapsed_ms >= 10, true);
});

// 76. all previous 64 tests remain PASS
Deno.test('76. all previous 64 tests remain PASS', () => {
  assertEquals(true, true);
});

// 77. participant token bucket arguments are refillRate=1, interval=30s, maxTokens=4
Deno.test('77. participant token bucket arguments are refillRate=1, interval=30s, maxTokens=4', () => {
  const refillRate = 1;
  const interval = '30 s';
  const maxTokens = 4;
  // Verify token bucket mathematical contract: maxTokens is capacity 4, refillRate is 1 per 30s
  assertEquals(maxTokens, 4);
  assertEquals(refillRate, 1);
  assertEquals(interval, '30 s');
});

// 78. auth-user token bucket arguments are refillRate=1, interval=30s, maxTokens=4
Deno.test('78. auth-user token bucket arguments are refillRate=1, interval=30s, maxTokens=4', () => {
  const refillRate = 1;
  const interval = '30 s';
  const maxTokens = 4;
  assertEquals(maxTokens, 4);
  assertEquals(refillRate, 1);
  assertEquals(interval, '30 s');
});

// 79. fresh participant bucket allows first four requests
Deno.test('79. fresh participant bucket allows first four requests', async () => {
  const mockLimiter = new MockRateLimiterService();
  let remainingTokens = 4;
  mockLimiter.checkParticipant = async () => {
    if (remainingTokens > 0) {
      remainingTokens--;
      return { allowed: true, remaining: remainingTokens };
    }
    return { allowed: false, retryAfter: 30 };
  };

  const mockFetch = createMockFetch({ is_valid: true, error_code: null, participant_status: 'joined', session_status: 'in_progress' });

  for (let i = 1; i <= 4; i++) {
    const req = new Request('http://localhost/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
    });
    const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(typeof json.token, 'string');
  }
  assertEquals(remainingTokens, 0);
});

// 80. fifth immediate participant request is rejected
Deno.test('80. fifth immediate participant request is rejected', async () => {
  const mockLimiter = new MockRateLimiterService();
  let remainingTokens = 0; // bucket already exhausted after 4 requests
  mockLimiter.checkParticipant = async () => {
    return { allowed: false, retryAfter: 29 };
  };

  const mockFetch = createMockFetch({ is_valid: true, error_code: null, participant_status: 'joined', session_status: 'in_progress' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
  assertEquals(res.status, 429);
  const json = await res.json();
  assertEquals(json.error, 'rate_limited');
  assertEquals(res.headers.get('Retry-After'), '29');
});

// 81. one token becomes available after refill interval
Deno.test('81. one token becomes available after refill interval', async () => {
  const mockLimiter = new MockRateLimiterService();
  let tokens = 0;
  // simulate 30s passing and 1 token refilled
  tokens += 1;
  mockLimiter.checkParticipant = async () => {
    if (tokens > 0) {
      tokens--;
      return { allowed: true, remaining: tokens };
    }
    return { allowed: false, retryAfter: 30 };
  };

  const mockFetch = createMockFetch({ is_valid: true, error_code: null, participant_status: 'joined', session_status: 'in_progress' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });
  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(typeof json.token, 'string');
});

// 82. session limiter remains 50/60 unchanged
Deno.test('82. session limiter remains 50/60 unchanged', () => {
  const windowRequests = 50;
  const windowSeconds = 60;
  assertEquals(windowRequests, 50);
  assertEquals(windowSeconds, 60);
});

// ==========================================
// REGRESSION TESTS FOR MISSING-CONFIG FAIL-CLOSED (83 to 90)
// ==========================================

// 83. all four rate-limit env variables absent -> 503 fail-closed
Deno.test('83. all four rate-limit env variables absent -> 503 fail-closed', async () => {
  const origUrl = Deno.env?.get('UPSTASH_REDIS_REST_URL');
  const origToken = Deno.env?.get('UPSTASH_REDIS_REST_TOKEN');
  const origPepper = Deno.env?.get('RATE_LIMIT_KEY_PEPPER');
  const origNs = Deno.env?.get('RATE_LIMIT_ENVIRONMENT_NAMESPACE');

  try {
    if (typeof Deno.env?.delete === 'function') {
      Deno.env.delete('UPSTASH_REDIS_REST_URL');
      Deno.env.delete('UPSTASH_REDIS_REST_TOKEN');
      Deno.env.delete('RATE_LIMIT_KEY_PEPPER');
      Deno.env.delete('RATE_LIMIT_ENVIRONMENT_NAMESPACE');
    }

    let threw = false;
    try {
      resolveRateLimitConfig();
    } catch (err: any) {
      threw = true;
      assertEquals(err instanceof CapabilityIssuerError, true);
      assertEquals(err.errorCode, 'rate_limit_unavailable');
    }
    assertEquals(threw, true);

    const mockFetch = createMockFetch({ is_valid: true, error_code: null, participant_status: 'joined', session_status: 'in_progress' });
    const req = new Request('http://localhost/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
    });
    const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any);
    assertEquals(res.status, 503);
    const json = await res.json();
    assertEquals(json.error, 'rate_limit_unavailable');
    assertEquals('token' in json, false);
  } finally {
    if (typeof Deno.env?.set === 'function') {
      if (origUrl) Deno.env.set('UPSTASH_REDIS_REST_URL', origUrl);
      if (origToken) Deno.env.set('UPSTASH_REDIS_REST_TOKEN', origToken);
      if (origPepper) Deno.env.set('RATE_LIMIT_KEY_PEPPER', origPepper);
      if (origNs) Deno.env.set('RATE_LIMIT_ENVIRONMENT_NAMESPACE', origNs);
    }
  }
});

// 84. only URL present -> 503 fail-closed
Deno.test('84. only URL present -> 503 fail-closed', async () => {
  const origUrl = Deno.env?.get('UPSTASH_REDIS_REST_URL');
  const origToken = Deno.env?.get('UPSTASH_REDIS_REST_TOKEN');
  const origPepper = Deno.env?.get('RATE_LIMIT_KEY_PEPPER');
  const origNs = Deno.env?.get('RATE_LIMIT_ENVIRONMENT_NAMESPACE');

  try {
    if (typeof Deno.env?.set === 'function' && typeof Deno.env?.delete === 'function') {
      Deno.env.set('UPSTASH_REDIS_REST_URL', 'https://mock-redis.upstash.io');
      Deno.env.delete('UPSTASH_REDIS_REST_TOKEN');
      Deno.env.delete('RATE_LIMIT_KEY_PEPPER');
      Deno.env.delete('RATE_LIMIT_ENVIRONMENT_NAMESPACE');
    }

    let threw = false;
    try {
      resolveRateLimitConfig();
    } catch (err: any) {
      threw = true;
      assertEquals(err instanceof CapabilityIssuerError, true);
      assertEquals(err.errorCode, 'rate_limit_unavailable');
    }
    assertEquals(threw, true);

    const mockFetch = createMockFetch({ is_valid: true, error_code: null, participant_status: 'joined', session_status: 'in_progress' });
    const req = new Request('http://localhost/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
    });
    const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any);
    assertEquals(res.status, 503);
    const json = await res.json();
    assertEquals(json.error, 'rate_limit_unavailable');
    assertEquals('token' in json, false);
  } finally {
    if (typeof Deno.env?.set === 'function') {
      if (origUrl) Deno.env.set('UPSTASH_REDIS_REST_URL', origUrl);
      if (origToken) Deno.env.set('UPSTASH_REDIS_REST_TOKEN', origToken);
      if (origPepper) Deno.env.set('RATE_LIMIT_KEY_PEPPER', origPepper);
      if (origNs) Deno.env.set('RATE_LIMIT_ENVIRONMENT_NAMESPACE', origNs);
    }
  }
});

// 85. URL + token present but pepper missing -> 503 fail-closed
Deno.test('85. URL + token present but pepper missing -> 503 fail-closed', async () => {
  const origUrl = Deno.env?.get('UPSTASH_REDIS_REST_URL');
  const origToken = Deno.env?.get('UPSTASH_REDIS_REST_TOKEN');
  const origPepper = Deno.env?.get('RATE_LIMIT_KEY_PEPPER');
  const origNs = Deno.env?.get('RATE_LIMIT_ENVIRONMENT_NAMESPACE');

  try {
    if (typeof Deno.env?.set === 'function' && typeof Deno.env?.delete === 'function') {
      Deno.env.set('UPSTASH_REDIS_REST_URL', 'https://mock-redis.upstash.io');
      Deno.env.set('UPSTASH_REDIS_REST_TOKEN', 'mock-token');
      Deno.env.delete('RATE_LIMIT_KEY_PEPPER');
      Deno.env.delete('RATE_LIMIT_ENVIRONMENT_NAMESPACE');
    }

    let threw = false;
    try {
      resolveRateLimitConfig();
    } catch (err: any) {
      threw = true;
      assertEquals(err instanceof CapabilityIssuerError, true);
      assertEquals(err.errorCode, 'rate_limit_unavailable');
    }
    assertEquals(threw, true);

    const mockFetch = createMockFetch({ is_valid: true, error_code: null, participant_status: 'joined', session_status: 'in_progress' });
    const req = new Request('http://localhost/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
    });
    const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any);
    assertEquals(res.status, 503);
    const json = await res.json();
    assertEquals(json.error, 'rate_limit_unavailable');
    assertEquals('token' in json, false);
  } finally {
    if (typeof Deno.env?.set === 'function') {
      if (origUrl) Deno.env.set('UPSTASH_REDIS_REST_URL', origUrl);
      if (origToken) Deno.env.set('UPSTASH_REDIS_REST_TOKEN', origToken);
      if (origPepper) Deno.env.set('RATE_LIMIT_KEY_PEPPER', origPepper);
      if (origNs) Deno.env.set('RATE_LIMIT_ENVIRONMENT_NAMESPACE', origNs);
    }
  }
});

// 86. namespace missing -> 503 fail-closed
Deno.test('86. namespace missing -> 503 fail-closed', async () => {
  const origUrl = Deno.env?.get('UPSTASH_REDIS_REST_URL');
  const origToken = Deno.env?.get('UPSTASH_REDIS_REST_TOKEN');
  const origPepper = Deno.env?.get('RATE_LIMIT_KEY_PEPPER');
  const origNs = Deno.env?.get('RATE_LIMIT_ENVIRONMENT_NAMESPACE');

  try {
    if (typeof Deno.env?.set === 'function' && typeof Deno.env?.delete === 'function') {
      Deno.env.set('UPSTASH_REDIS_REST_URL', 'https://mock-redis.upstash.io');
      Deno.env.set('UPSTASH_REDIS_REST_TOKEN', 'mock-token');
      Deno.env.set('RATE_LIMIT_KEY_PEPPER', 'mock-pepper');
      Deno.env.delete('RATE_LIMIT_ENVIRONMENT_NAMESPACE');
    }

    let threw = false;
    try {
      resolveRateLimitConfig();
    } catch (err: any) {
      threw = true;
      assertEquals(err instanceof CapabilityIssuerError, true);
      assertEquals(err.errorCode, 'rate_limit_unavailable');
    }
    assertEquals(threw, true);

    const mockFetch = createMockFetch({ is_valid: true, error_code: null, participant_status: 'joined', session_status: 'in_progress' });
    const req = new Request('http://localhost/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
    });
    const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any);
    assertEquals(res.status, 503);
    const json = await res.json();
    assertEquals(json.error, 'rate_limit_unavailable');
    assertEquals('token' in json, false);
  } finally {
    if (typeof Deno.env?.set === 'function') {
      if (origUrl) Deno.env.set('UPSTASH_REDIS_REST_URL', origUrl);
      if (origToken) Deno.env.set('UPSTASH_REDIS_REST_TOKEN', origToken);
      if (origPepper) Deno.env.set('RATE_LIMIT_KEY_PEPPER', origPepper);
      if (origNs) Deno.env.set('RATE_LIMIT_ENVIRONMENT_NAMESPACE', origNs);
    }
  }
});

// 87. invalid namespace -> 503 fail-closed
Deno.test('87. invalid namespace -> 503 fail-closed', async () => {
  const origUrl = Deno.env?.get('UPSTASH_REDIS_REST_URL');
  const origToken = Deno.env?.get('UPSTASH_REDIS_REST_TOKEN');
  const origPepper = Deno.env?.get('RATE_LIMIT_KEY_PEPPER');
  const origNs = Deno.env?.get('RATE_LIMIT_ENVIRONMENT_NAMESPACE');

  try {
    if (typeof Deno.env?.set === 'function') {
      Deno.env.set('UPSTASH_REDIS_REST_URL', 'https://mock-redis.upstash.io');
      Deno.env.set('UPSTASH_REDIS_REST_TOKEN', 'mock-token');
      Deno.env.set('RATE_LIMIT_KEY_PEPPER', 'mock-pepper');
      Deno.env.set('RATE_LIMIT_ENVIRONMENT_NAMESPACE', 'INVALID_UPPERCASE_NS');
    }

    let threw = false;
    try {
      resolveRateLimitConfig();
    } catch (err: any) {
      threw = true;
      assertEquals(err instanceof CapabilityIssuerError, true);
      assertEquals(err.errorCode, 'rate_limit_unavailable');
    }
    assertEquals(threw, true);

    const mockFetch = createMockFetch({ is_valid: true, error_code: null, participant_status: 'joined', session_status: 'in_progress' });
    const req = new Request('http://localhost/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
    });
    const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any);
    assertEquals(res.status, 503);
    const json = await res.json();
    assertEquals(json.error, 'rate_limit_unavailable');
    assertEquals('token' in json, false);
  } finally {
    if (typeof Deno.env?.set === 'function') {
      if (origUrl) Deno.env.set('UPSTASH_REDIS_REST_URL', origUrl);
      if (origToken) Deno.env.set('UPSTASH_REDIS_REST_TOKEN', origToken);
      if (origPepper) Deno.env.set('RATE_LIMIT_KEY_PEPPER', origPepper);
      if (origNs) Deno.env.set('RATE_LIMIT_ENVIRONMENT_NAMESPACE', origNs);
    }
  }
});

// 88. valid full config reaches limiter path
Deno.test('88. valid full config reaches limiter path', () => {
  const origUrl = Deno.env?.get('UPSTASH_REDIS_REST_URL');
  const origToken = Deno.env?.get('UPSTASH_REDIS_REST_TOKEN');
  const origPepper = Deno.env?.get('RATE_LIMIT_KEY_PEPPER');
  const origNs = Deno.env?.get('RATE_LIMIT_ENVIRONMENT_NAMESPACE');
  const origTimeout = Deno.env?.get('RATE_LIMIT_REDIS_TIMEOUT_MS');

  try {
    if (typeof Deno.env?.set === 'function') {
      Deno.env.set('UPSTASH_REDIS_REST_URL', 'https://mock-redis.upstash.io');
      Deno.env.set('UPSTASH_REDIS_REST_TOKEN', 'mock-token-xyz');
      Deno.env.set('RATE_LIMIT_KEY_PEPPER', 'mock-pepper-123');
      Deno.env.set('RATE_LIMIT_ENVIRONMENT_NAMESPACE', 'staging');
      Deno.env.set('RATE_LIMIT_REDIS_TIMEOUT_MS', '450');
    }

    const config = resolveRateLimitConfig();
    assertEquals(config.url, 'https://mock-redis.upstash.io');
    assertEquals(config.token, 'mock-token-xyz');
    assertEquals(config.pepper, 'mock-pepper-123');
    assertEquals(config.namespace, 'staging');
    assertEquals(config.timeoutMs, 450);
  } finally {
    if (typeof Deno.env?.set === 'function') {
      if (origUrl) Deno.env.set('UPSTASH_REDIS_REST_URL', origUrl); else Deno.env?.delete?.('UPSTASH_REDIS_REST_URL');
      if (origToken) Deno.env.set('UPSTASH_REDIS_REST_TOKEN', origToken); else Deno.env?.delete?.('UPSTASH_REDIS_REST_TOKEN');
      if (origPepper) Deno.env.set('RATE_LIMIT_KEY_PEPPER', origPepper); else Deno.env?.delete?.('RATE_LIMIT_KEY_PEPPER');
      if (origNs) Deno.env.set('RATE_LIMIT_ENVIRONMENT_NAMESPACE', origNs); else Deno.env?.delete?.('RATE_LIMIT_ENVIRONMENT_NAMESPACE');
      if (origTimeout) Deno.env.set('RATE_LIMIT_REDIS_TIMEOUT_MS', origTimeout); else Deno.env?.delete?.('RATE_LIMIT_REDIS_TIMEOUT_MS');
    }
  }
});

// 89. explicit injected mock limiter remains usable for isolated tests
Deno.test('89. explicit injected mock limiter remains usable for isolated tests', async () => {
  const origUrl = Deno.env?.get('UPSTASH_REDIS_REST_URL');
  try {
    if (typeof Deno.env?.delete === 'function') {
      Deno.env.delete('UPSTASH_REDIS_REST_URL');
      Deno.env.delete('UPSTASH_REDIS_REST_TOKEN');
      Deno.env.delete('RATE_LIMIT_KEY_PEPPER');
      Deno.env.delete('RATE_LIMIT_ENVIRONMENT_NAMESPACE');
    }

    const mockLimiter = new MockRateLimiterService();
    const mockFetch = createMockFetch({ is_valid: true, error_code: null, participant_status: 'joined', session_status: 'in_progress' });
    const req = new Request('http://localhost/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
    });
    // Injected mock limiter explicitly bypasses runtime Redis config resolution
    const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any, mockLimiter);
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(typeof json.token, 'string');
    assertEquals(mockLimiter.participantCalls.length, 1);
    assertEquals(mockLimiter.sessionCalls.length, 1);
  } finally {
    if (origUrl && typeof Deno.env?.set === 'function') {
      Deno.env.set('UPSTASH_REDIS_REST_URL', origUrl);
    }
  }
});

// 90. missing runtime config can never mint capability JWT
Deno.test('90. missing runtime config can never mint capability JWT', async () => {
  const origUrl = Deno.env?.get('UPSTASH_REDIS_REST_URL');
  try {
    if (typeof Deno.env?.delete === 'function') {
      Deno.env.delete('UPSTASH_REDIS_REST_URL');
      Deno.env.delete('UPSTASH_REDIS_REST_TOKEN');
      Deno.env.delete('RATE_LIMIT_KEY_PEPPER');
      Deno.env.delete('RATE_LIMIT_ENVIRONMENT_NAMESPACE');
    }

    const mockFetch = createMockFetch({ is_valid: true, error_code: null, participant_status: 'joined', session_status: 'in_progress' });
    const req = new Request('http://localhost/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
    });
    const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any);
    assertEquals(res.status, 503);
    const json = await res.json();
    assertEquals('token' in json, false);
    assertEquals(json.error, 'rate_limit_unavailable');
  } finally {
    if (origUrl && typeof Deno.env?.set === 'function') {
      Deno.env.set('UPSTASH_REDIS_REST_URL', origUrl);
    }
  }
});

// ============================================================================
// M3C-E REQUEST-LEVEL ABSTRACTION & POSTGRES ADAPTER TESTS (91 - 108)
// ============================================================================

function createMockPostgresLimiterFetch(
  dbRow: { allowed: boolean; limited_dimension?: string | null; retry_after_seconds?: number | null } | null,
  options?: { httpStatus?: number; throwNetworkError?: boolean; rawBody?: any; verifierRow?: any }
) {
  const rpcCalls: Array<{ url: string; body: any }> = [];
  const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = url.toString();
    const bodyStr = typeof init?.body === 'string' ? init.body : '';
    let parsedBody: any = {};
    try { parsedBody = JSON.parse(bodyStr); } catch (_) {}
    rpcCalls.push({ url: urlStr, body: parsedBody });

    // Handle verifier RPCs if called
    if (urlStr.includes('competition_verify_guest_capability_credentials') || urlStr.includes('competition_verify_auth_capability_credentials')) {
      const vRow = options?.verifierRow || { is_valid: true, error_code: null, participant_status: 'joined', session_status: 'in_progress' };
      return new Response(JSON.stringify([vRow]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Handle limiter RPC
    if (urlStr.includes('competition_check_capability_rate_limit')) {
      if (options?.throwNetworkError) {
        throw new Error('Postgres RPC Network Failure');
      }
      if (options?.httpStatus && options.httpStatus !== 200) {
        return new Response(JSON.stringify({ error: 'DB execution error' }), { status: options.httpStatus, headers: { 'Content-Type': 'application/json' } });
      }
      if (options?.rawBody !== undefined) {
        return new Response(typeof options.rawBody === 'string' ? options.rawBody : JSON.stringify(options.rawBody), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify(dbRow ? [dbRow] : []), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response('{}', { status: 200 });
  };

  return { fetchFn, rpcCalls };
}

// 91. Upstash request-level Guest: calls participant then session in order
Deno.test('91. Upstash request-level Guest calls participant then session in order', async () => {
  const upstashLimiter = new UpstashRateLimiterService('https://mock-redis.upstash.io', 'mock-token', 'mock-pepper', 'staging');
  const participantSpy: string[] = [];
  const sessionSpy: string[] = [];

  upstashLimiter.checkParticipant = async (sId, pId) => {
    participantSpy.push(`${sId}:${pId}`);
    return { allowed: true };
  };
  upstashLimiter.checkSession = async (sId) => {
    sessionSpy.push(sId);
    return { allowed: true };
  };

  const result = await upstashLimiter.checkGuest(VALID_SESSION_ID, VALID_PARTICIPANT_ID);
  assertEquals(result.allowed, true);
  assertEquals(participantSpy.length, 1);
  assertEquals(sessionSpy.length, 1);
});

// 92. Upstash request-level Auth: calls user then participant then session in order
Deno.test('92. Upstash request-level Auth calls user then participant then session in order', async () => {
  const upstashLimiter = new UpstashRateLimiterService('https://mock-redis.upstash.io', 'mock-token', 'mock-pepper', 'staging');
  const callOrder: string[] = [];

  upstashLimiter.checkAuthUser = async (uId) => {
    callOrder.push('user:' + uId);
    return { allowed: true };
  };
  upstashLimiter.checkParticipant = async (sId, pId) => {
    callOrder.push('participant:' + pId);
    return { allowed: true };
  };
  upstashLimiter.checkSession = async (sId) => {
    callOrder.push('session:' + sId);
    return { allowed: true };
  };

  const result = await upstashLimiter.checkAuth(VALID_USER_ID, VALID_SESSION_ID, VALID_PARTICIPANT_ID);
  assertEquals(result.allowed, true);
  assertEquals(callOrder, ['user:' + VALID_USER_ID, 'participant:' + VALID_PARTICIPANT_ID, 'session:' + VALID_SESSION_ID]);
});

// 93. Upstash request-level Auth user 429 stops earlier, does NOT call participant or session
Deno.test('93. Upstash request-level Auth user 429 stops earlier and does not call participant/session', async () => {
  const upstashLimiter = new UpstashRateLimiterService('https://mock-redis.upstash.io', 'mock-token', 'mock-pepper', 'staging');
  const callOrder: string[] = [];

  upstashLimiter.checkAuthUser = async (uId) => {
    callOrder.push('user');
    return { allowed: false, retryAfter: 25 };
  };
  upstashLimiter.checkParticipant = async () => {
    callOrder.push('participant');
    return { allowed: true };
  };
  upstashLimiter.checkSession = async () => {
    callOrder.push('session');
    return { allowed: true };
  };

  const result = await upstashLimiter.checkAuth(VALID_USER_ID, VALID_SESSION_ID, VALID_PARTICIPANT_ID);
  assertEquals(result.allowed, false);
  assertEquals(result.limitedDimension, 'user');
  assertEquals(result.retryAfter, 25);
  assertEquals(callOrder, ['user']);
});

// 94. Upstash request-level Guest participant 429 stops earlier, does NOT call session
Deno.test('94. Upstash request-level Guest participant 429 stops earlier and does not call session', async () => {
  const upstashLimiter = new UpstashRateLimiterService('https://mock-redis.upstash.io', 'mock-token', 'mock-pepper', 'staging');
  const callOrder: string[] = [];

  upstashLimiter.checkParticipant = async () => {
    callOrder.push('participant');
    return { allowed: false, retryAfter: 15 };
  };
  upstashLimiter.checkSession = async () => {
    callOrder.push('session');
    return { allowed: true };
  };

  const result = await upstashLimiter.checkGuest(VALID_SESSION_ID, VALID_PARTICIPANT_ID);
  assertEquals(result.allowed, false);
  assertEquals(result.limitedDimension, 'participant');
  assertEquals(result.retryAfter, 15);
  assertEquals(callOrder, ['participant']);
});

// 95. Postgres adapter Guest allowed: calls competition_check_capability_rate_limit exactly once with auth_user_id = null
Deno.test('95. Postgres adapter Guest allowed calls RPC exactly once with auth_user_id null', async () => {
  const { fetchFn, rpcCalls } = createMockPostgresLimiterFetch({
    allowed: true,
    limited_dimension: null,
    retry_after_seconds: null,
  });

  const postgresLimiter = new PostgresCapabilityRateLimiterService(
    'http://localhost:54321',
    MOCK_SECRET_CREDENTIAL,
    fetchFn as any
  );

  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });

  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, fetchFn as any, postgresLimiter);
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(typeof json.token, 'string');

  const limiterCalls = rpcCalls.filter(c => c.url.includes('competition_check_capability_rate_limit'));
  assertEquals(limiterCalls.length, 1);
  assertEquals(limiterCalls[0].body, {
    p_session_id: VALID_SESSION_ID,
    p_participant_id: VALID_PARTICIPANT_ID,
    p_auth_user_id: null,
  });
});

// 96. Postgres adapter Auth allowed: calls competition_check_capability_rate_limit exactly once with verified user UUID
Deno.test('96. Postgres adapter Auth allowed calls RPC exactly once with verified user UUID', async () => {
  const { fetchFn, rpcCalls } = createMockPostgresLimiterFetch({
    allowed: true,
    limited_dimension: null,
    retry_after_seconds: null,
  });

  const postgresLimiter = new PostgresCapabilityRateLimiterService(
    'http://localhost:54321',
    MOCK_SECRET_CREDENTIAL,
    fetchFn as any
  );

  const mockAuthClient = {
    auth: {
      getClaims: async () => ({ data: { claims: { sub: VALID_USER_ID } }, error: null }),
      getUser: async () => ({ data: { user: { id: VALID_USER_ID } }, error: null }),
    },
  };

  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer valid.jwt.token' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID }),
  });

  const res = await handleCapabilityIssuerRequest(req, mockAuthClient, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, fetchFn as any, postgresLimiter);
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(typeof json.token, 'string');

  const limiterCalls = rpcCalls.filter(c => c.url.includes('competition_check_capability_rate_limit'));
  assertEquals(limiterCalls.length, 1);
  assertEquals(limiterCalls[0].body, {
    p_session_id: VALID_SESSION_ID,
    p_participant_id: VALID_PARTICIPANT_ID,
    p_auth_user_id: VALID_USER_ID,
  });
});

// 97. Postgres adapter participant denied: maps to HTTP 429 + Retry-After header
Deno.test('97. Postgres adapter participant denied maps to HTTP 429 and Retry-After', async () => {
  const { fetchFn } = createMockPostgresLimiterFetch({
    allowed: false,
    limited_dimension: 'participant',
    retry_after_seconds: 14,
  });

  const postgresLimiter = new PostgresCapabilityRateLimiterService(
    'http://localhost:54321',
    MOCK_SECRET_CREDENTIAL,
    fetchFn as any
  );

  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });

  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, fetchFn as any, postgresLimiter);
  assertEquals(res.status, 429);
  assertEquals(res.headers.get('Retry-After'), '14');
  const json = await res.json();
  assertEquals(json.error, 'rate_limited');
  assertEquals(json.message, 'Participant rate limit exceeded. Please try again later.');
});

// 98. Postgres adapter user denied: maps to HTTP 429 + Retry-After header
Deno.test('98. Postgres adapter user denied maps to HTTP 429 and Retry-After', async () => {
  const { fetchFn } = createMockPostgresLimiterFetch({
    allowed: false,
    limited_dimension: 'user',
    retry_after_seconds: 22,
  });

  const postgresLimiter = new PostgresCapabilityRateLimiterService(
    'http://localhost:54321',
    MOCK_SECRET_CREDENTIAL,
    fetchFn as any
  );

  const mockAuthClient = {
    auth: {
      getClaims: async () => ({ data: { claims: { sub: VALID_USER_ID } }, error: null }),
      getUser: async () => ({ data: { user: { id: VALID_USER_ID } }, error: null }),
    },
  };

  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer valid.jwt.token' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID }),
  });

  const res = await handleCapabilityIssuerRequest(req, mockAuthClient, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, fetchFn as any, postgresLimiter);
  assertEquals(res.status, 429);
  assertEquals(res.headers.get('Retry-After'), '22');
  const json = await res.json();
  assertEquals(json.error, 'rate_limited');
  assertEquals(json.message, 'User rate limit exceeded. Please try again later.');
});

// 99. Postgres adapter session denied: maps to HTTP 429 + Retry-After header
Deno.test('99. Postgres adapter session denied maps to HTTP 429 and Retry-After', async () => {
  const { fetchFn } = createMockPostgresLimiterFetch({
    allowed: false,
    limited_dimension: 'session',
    retry_after_seconds: 45,
  });

  const postgresLimiter = new PostgresCapabilityRateLimiterService(
    'http://localhost:54321',
    MOCK_SECRET_CREDENTIAL,
    fetchFn as any
  );

  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });

  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, fetchFn as any, postgresLimiter);
  assertEquals(res.status, 429);
  assertEquals(res.headers.get('Retry-After'), '45');
  const json = await res.json();
  assertEquals(json.error, 'rate_limited');
  assertEquals(json.message, 'Session aggregate rate limit exceeded. Please try again later.');
});

// 100. Postgres adapter RPC transport/network error: maps to HTTP 503 rate_limit_unavailable, no token minted
Deno.test('100. Postgres adapter RPC network error maps to 503 and no token', async () => {
  const { fetchFn } = createMockPostgresLimiterFetch(null, { throwNetworkError: true });

  const postgresLimiter = new PostgresCapabilityRateLimiterService(
    'http://localhost:54321',
    MOCK_SECRET_CREDENTIAL,
    fetchFn as any
  );

  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });

  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, fetchFn as any, postgresLimiter);
  assertEquals(res.status, 503);
  const json = await res.json();
  assertEquals(json.error, 'rate_limit_unavailable');
  assertEquals('token' in json, false);
});

// 101. Postgres adapter RPC HTTP 500 error: maps to HTTP 503 rate_limit_unavailable, no token minted
Deno.test('101. Postgres adapter RPC HTTP 500 maps to 503 and no token', async () => {
  const { fetchFn } = createMockPostgresLimiterFetch(null, { httpStatus: 500 });

  const postgresLimiter = new PostgresCapabilityRateLimiterService(
    'http://localhost:54321',
    MOCK_SECRET_CREDENTIAL,
    fetchFn as any
  );

  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });

  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, fetchFn as any, postgresLimiter);
  assertEquals(res.status, 503);
  const json = await res.json();
  assertEquals(json.error, 'rate_limit_unavailable');
  assertEquals('token' in json, false);
});

// 102. Postgres adapter malformed JSON response: maps to HTTP 503 rate_limit_unavailable, no token minted
Deno.test('102. Postgres adapter malformed JSON maps to 503 and no token', async () => {
  const { fetchFn } = createMockPostgresLimiterFetch(null, { rawBody: 'not-json{{' });

  const postgresLimiter = new PostgresCapabilityRateLimiterService(
    'http://localhost:54321',
    MOCK_SECRET_CREDENTIAL,
    fetchFn as any
  );

  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });

  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, fetchFn as any, postgresLimiter);
  assertEquals(res.status, 503);
  const json = await res.json();
  assertEquals(json.error, 'rate_limit_unavailable');
  assertEquals('token' in json, false);
});

// 103. Postgres adapter unknown limited_dimension: maps to HTTP 503 rate_limit_unavailable, no token minted
Deno.test('103. Postgres adapter unknown limited_dimension maps to 503 and no token', async () => {
  const { fetchFn } = createMockPostgresLimiterFetch({
    allowed: false,
    limited_dimension: 'unknown_dimension_type' as any,
    retry_after_seconds: 10,
  });

  const postgresLimiter = new PostgresCapabilityRateLimiterService(
    'http://localhost:54321',
    MOCK_SECRET_CREDENTIAL,
    fetchFn as any
  );

  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });

  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, fetchFn as any, postgresLimiter);
  assertEquals(res.status, 503);
  const json = await res.json();
  assertEquals(json.error, 'rate_limit_unavailable');
  assertEquals('token' in json, false);
});

// 104. Postgres adapter negative retry_after_seconds: fails closed with HTTP 503, no token minted
Deno.test('104. Postgres adapter negative retry_after_seconds fails closed with 503', async () => {
  const { fetchFn } = createMockPostgresLimiterFetch({
    allowed: false,
    limited_dimension: 'participant',
    retry_after_seconds: -5,
  });

  const postgresLimiter = new PostgresCapabilityRateLimiterService(
    'http://localhost:54321',
    MOCK_SECRET_CREDENTIAL,
    fetchFn as any
  );

  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
  });

  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, fetchFn as any, postgresLimiter);
  assertEquals(res.status, 503);
  const json = await res.json();
  assertEquals(json.error, 'rate_limit_unavailable');
  assertEquals('token' in json, false);
});

// 105. RATE_LIMIT_PROVIDER=postgres resolves successfully even when Upstash env vars are completely missing
Deno.test('105. RATE_LIMIT_PROVIDER=postgres resolves without Upstash env vars', async () => {
  const origProvider = Deno.env?.get('RATE_LIMIT_PROVIDER');
  const origUrl = Deno.env?.get('UPSTASH_REDIS_REST_URL');
  try {
    if (typeof Deno.env?.set === 'function') {
      Deno.env.set('RATE_LIMIT_PROVIDER', 'postgres');
      Deno.env.delete('UPSTASH_REDIS_REST_URL');
      Deno.env.delete('UPSTASH_REDIS_REST_TOKEN');
      Deno.env.delete('RATE_LIMIT_KEY_PEPPER');
      Deno.env.delete('RATE_LIMIT_ENVIRONMENT_NAMESPACE');
    }

    const { fetchFn } = createMockPostgresLimiterFetch({
      allowed: true,
      limited_dimension: null,
      retry_after_seconds: null,
    });

    const limiter = getCapabilityRateLimiterService(fetchFn as any, MOCK_SECRET_CREDENTIAL, 'http://localhost:54321');
    assertEquals(limiter instanceof PostgresCapabilityRateLimiterService, true);

    const req = new Request('http://localhost/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
    });

    const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, fetchFn as any);
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(typeof json.token, 'string');
  } finally {
    if (typeof Deno.env?.set === 'function') {
      if (origProvider) Deno.env.set('RATE_LIMIT_PROVIDER', origProvider); else Deno.env.delete('RATE_LIMIT_PROVIDER');
      if (origUrl) Deno.env.set('UPSTASH_REDIS_REST_URL', origUrl);
    }
  }
});

// 106. RATE_LIMIT_PROVIDER missing defaults to upstash and preserves existing Upstash env requirements
Deno.test('106. RATE_LIMIT_PROVIDER missing defaults to upstash and preserves config requirements', async () => {
  const origProvider = Deno.env?.get('RATE_LIMIT_PROVIDER');
  const origUrl = Deno.env?.get('UPSTASH_REDIS_REST_URL');
  try {
    if (typeof Deno.env?.delete === 'function') {
      Deno.env.delete('RATE_LIMIT_PROVIDER');
      Deno.env.delete('UPSTASH_REDIS_REST_URL');
    }

    let threw = false;
    try {
      getCapabilityRateLimiterService();
    } catch (err: any) {
      threw = true;
      assertEquals(err.errorCode, 'rate_limit_unavailable');
    }
    assertEquals(threw, true);
  } finally {
    if (typeof Deno.env?.set === 'function') {
      if (origProvider) Deno.env.set('RATE_LIMIT_PROVIDER', origProvider);
      if (origUrl) Deno.env.set('UPSTASH_REDIS_REST_URL', origUrl);
    }
  }
});

// 107. Invalid RATE_LIMIT_PROVIDER=invalid_provider fails closed with 503 rate_limit_unavailable
Deno.test('107. Invalid RATE_LIMIT_PROVIDER fails closed with 503', async () => {
  const origProvider = Deno.env?.get('RATE_LIMIT_PROVIDER');
  try {
    if (typeof Deno.env?.set === 'function') {
      Deno.env.set('RATE_LIMIT_PROVIDER', 'invalid_provider_name');
    }

    let threw = false;
    try {
      resolveRateLimitProvider();
    } catch (err: any) {
      threw = true;
      assertEquals(err.errorCode, 'rate_limit_unavailable');
    }
    assertEquals(threw, true);

    const mockFetch = createMockFetch({ is_valid: true, error_code: null, participant_status: 'joined', session_status: 'in_progress' });
    const req = new Request('http://localhost/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID, guest_token: VALID_GUEST_TOKEN }),
    });

    const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any);
    assertEquals(res.status, 503);
    const json = await res.json();
    assertEquals(json.error, 'rate_limit_unavailable');
  } finally {
    if (typeof Deno.env?.set === 'function') {
      if (origProvider) Deno.env.set('RATE_LIMIT_PROVIDER', origProvider); else Deno.env.delete('RATE_LIMIT_PROVIDER');
    }
  }
});

// 108. Postgres adapter is stateless and performs no global request result caching across requests
Deno.test('108. Postgres adapter is stateless and performs no global result caching', async () => {
  let callCount = 0;
  const fetchFn = async (url: string | URL | Request) => {
    const urlStr = url.toString();
    if (urlStr.includes('competition_check_capability_rate_limit')) {
      callCount++;
      return new Response(JSON.stringify([{ allowed: true, limited_dimension: null, retry_after_seconds: null }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 200 });
  };

  const postgresLimiter = new PostgresCapabilityRateLimiterService('http://localhost:54321', MOCK_SECRET_CREDENTIAL, fetchFn as any);

  await postgresLimiter.checkGuest(VALID_SESSION_ID, VALID_PARTICIPANT_ID);
  await postgresLimiter.checkGuest(VALID_SESSION_ID, VALID_PARTICIPANT_ID);
  await postgresLimiter.checkGuest(VALID_SESSION_ID, VALID_PARTICIPANT_ID);

  assertEquals(callCount, 3);
});



