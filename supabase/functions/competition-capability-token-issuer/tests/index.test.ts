// supabase/functions/competition-capability-token-issuer/tests/index.test.ts
// Isolated Unit Tests for Competition Capability Token Issuer (M3C-C)
// Fully mocked Supabase transport, zero network calls, zero real secrets.

import { assertEquals, assertStrictEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { handleCapabilityIssuerRequest } from '../index.ts';
import { mintCapabilityToken } from '../signer.ts';
import { executeAdminRpc } from '../rpc.ts';
import { AdminCredential } from '../types.ts';

const MOCK_SIGNING_KEY = 'test-signing-secret-key-32-chars-long-minimum-hs256';
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

function createMockFetch(rpcResult: { is_valid: boolean; error_code: string | null; participant_status?: string | null; session_status?: string | null } | null, status = 200, isMalformed = false) {
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

function createMockAuthClient(getClaimsResult?: { sub?: string; claims?: { sub?: string } } | null, getUserResult?: { user?: { id?: string } } | null, claimsError: Error | null = null, userError: Error | null = null) {
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

// 1. Guest valid -> token response (200)
Deno.test('1. Guest valid -> token response (200)', async () => {
  const mockFetch = createMockFetch({ is_valid: true, error_code: null, participant_status: 'joined', session_status: 'in_progress' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: VALID_SESSION_ID,
      participant_id: VALID_PARTICIPANT_ID,
      guest_token: VALID_GUEST_TOKEN,
    }),
  });

  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any);
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(typeof json.token, 'string');
  assertEquals(json.expires_in, 300);
  assertEquals(typeof json.expires_at, 'number');
});

// 2. Guest wrong credential -> unauthorized (401)
Deno.test('2. Guest wrong credential -> unauthorized (401)', async () => {
  const mockFetch = createMockFetch({ is_valid: false, error_code: 'INVALID_GUEST_CREDENTIALS' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: VALID_SESSION_ID,
      participant_id: VALID_PARTICIPANT_ID,
      guest_token: VALID_GUEST_TOKEN,
    }),
  });

  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any);
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
    body: JSON.stringify({
      session_id: VALID_SESSION_ID,
      participant_id: VALID_PARTICIPANT_ID,
      guest_token: VALID_GUEST_TOKEN,
    }),
  });

  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any);
  assertEquals(res.status, 403);
  const json = await res.json();
  assertEquals(json.error, 'forbidden');
});

// 4. Guest disconnected -> forbidden (403)
Deno.test('4. Guest disconnected -> forbidden (403)', async () => {
  const mockFetch = createMockFetch({ is_valid: false, error_code: 'PARTICIPANT_DISCONNECTED' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: VALID_SESSION_ID,
      participant_id: VALID_PARTICIPANT_ID,
      guest_token: VALID_GUEST_TOKEN,
    }),
  });

  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any);
  assertEquals(res.status, 403);
  const json = await res.json();
  assertEquals(json.error, 'forbidden');
});

// 5. Session closed -> session_unavailable (409)
Deno.test('5. Session closed -> session_unavailable (409)', async () => {
  const mockFetch = createMockFetch({ is_valid: false, error_code: 'SESSION_CLOSED' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: VALID_SESSION_ID,
      participant_id: VALID_PARTICIPANT_ID,
      guest_token: VALID_GUEST_TOKEN,
    }),
  });

  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any);
  assertEquals(res.status, 409);
  const json = await res.json();
  assertEquals(json.error, 'session_unavailable');
});

// 6. Auth valid claims -> token response (200)
Deno.test('6. Auth valid claims -> token response (200)', async () => {
  const authClient = createMockAuthClient({ claims: { sub: VALID_USER_ID } });
  const mockFetch = createMockFetch({ is_valid: true, error_code: null, participant_status: 'joined', session_status: 'in_progress' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer valid-jwt-token',
    },
    body: JSON.stringify({
      session_id: VALID_SESSION_ID,
      participant_id: VALID_PARTICIPANT_ID,
    }),
  });

  const res = await handleCapabilityIssuerRequest(req, authClient, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any);
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(typeof json.token, 'string');
  assertEquals(json.expires_in, 300);
});

// 7. Auth invalid JWT -> unauthorized (401)
Deno.test('7. Auth invalid JWT -> unauthorized (401)', async () => {
  const authClient = createMockAuthClient(null, null, new Error('Invalid JWT signature'), new Error('User not found'));
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer invalid-jwt-token',
    },
    body: JSON.stringify({
      session_id: VALID_SESSION_ID,
      participant_id: VALID_PARTICIPANT_ID,
    }),
  });

  const res = await handleCapabilityIssuerRequest(req, authClient, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any);
  assertEquals(res.status, 401);
  const json = await res.json();
  assertEquals(json.error, 'unauthorized');
});

// 8. Auth missing sub -> unauthorized (401)
Deno.test('8. Auth missing sub -> unauthorized (401)', async () => {
  const authClient = createMockAuthClient({ claims: {} }, { user: {} as any });
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer token-missing-sub',
    },
    body: JSON.stringify({
      session_id: VALID_SESSION_ID,
      participant_id: VALID_PARTICIPANT_ID,
    }),
  });

  const res = await handleCapabilityIssuerRequest(req, authClient, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any);
  assertEquals(res.status, 401);
  const json = await res.json();
  assertEquals(json.error, 'unauthorized');
});

// 9. Auth caller mismatch -> forbidden (403)
Deno.test('9. Auth caller mismatch -> forbidden (403)', async () => {
  const authClient = createMockAuthClient({ claims: { sub: VALID_USER_ID } });
  const mockFetch = createMockFetch({ is_valid: false, error_code: 'USER_ID_MISMATCH' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer valid-jwt-token',
    },
    body: JSON.stringify({
      session_id: VALID_SESSION_ID,
      participant_id: VALID_PARTICIPANT_ID,
    }),
  });

  const res = await handleCapabilityIssuerRequest(req, authClient, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any);
  assertEquals(res.status, 403);
  const json = await res.json();
  assertEquals(json.error, 'forbidden');
});

// 10. Both guest_token + Authorization -> invalid_request (400)
Deno.test('10. Both guest_token + Authorization -> invalid_request (400)', async () => {
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer valid-jwt-token',
    },
    body: JSON.stringify({
      session_id: VALID_SESSION_ID,
      participant_id: VALID_PARTICIPANT_ID,
      guest_token: VALID_GUEST_TOKEN,
    }),
  });

  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any);
  assertEquals(res.status, 400);
  const json = await res.json();
  assertEquals(json.error, 'invalid_request');
});

// 11. Neither credential -> unauthorized (401)
Deno.test('11. Neither credential -> unauthorized (401)', async () => {
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: VALID_SESSION_ID,
      participant_id: VALID_PARTICIPANT_ID,
    }),
  });

  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any);
  assertEquals(res.status, 401);
  const json = await res.json();
  assertEquals(json.error, 'unauthorized');
});

// 12. Malformed UUID -> invalid_request (400)
Deno.test('12. Malformed UUID -> invalid_request (400)', async () => {
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: 'not-a-valid-uuid',
      participant_id: VALID_PARTICIPANT_ID,
      guest_token: VALID_GUEST_TOKEN,
    }),
  });

  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any);
  assertEquals(res.status, 400);
  const json = await res.json();
  assertEquals(json.error, 'invalid_request');
});

// 13. Missing signing env -> internal_error / fail closed (500)
Deno.test('13. Missing signing env -> internal_error / fail closed (500)', async () => {
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: VALID_SESSION_ID,
      participant_id: VALID_PARTICIPANT_ID,
      guest_token: VALID_GUEST_TOKEN,
    }),
  });

  const res = await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, '', mockFetch as any);
  assertEquals(res.status, 500);
  const json = await res.json();
  assertEquals(json.error, 'internal_error');
});

// 14. Backend secret key unavailable -> fail closed (500)
Deno.test('14. Backend secret key unavailable -> fail closed (500)', async () => {
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: VALID_SESSION_ID,
      participant_id: VALID_PARTICIPANT_ID,
      guest_token: VALID_GUEST_TOKEN,
    }),
  });

  const res = await handleCapabilityIssuerRequest(req, undefined, null, MOCK_SIGNING_KEY);
  assertEquals(res.status, 500);
  const json = await res.json();
  assertEquals(json.error, 'internal_error');
});

// 15. Minted token TTL exactly 300
Deno.test('15. Minted token TTL exactly 300', async () => {
  const beforeSec = Math.floor(Date.now() / 1000);
  const res = await mintCapabilityToken(VALID_SESSION_ID, VALID_PARTICIPANT_ID, MOCK_SIGNING_KEY);
  const afterSec = Math.floor(Date.now() / 1000);

  assertEquals(res.expires_in, 300);
  assertEquals(res.expires_at >= beforeSec + 300, true);
  assertEquals(res.expires_at <= afterSec + 300, true);
});

// 16. Minted token role exactly competition_guest
Deno.test('16. Minted token role exactly competition_guest', async () => {
  const res = await mintCapabilityToken(VALID_SESSION_ID, VALID_PARTICIPANT_ID, MOCK_SIGNING_KEY);
  const parts = res.token.split('.');
  assertEquals(parts.length, 3);
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
  assertEquals('display_name' in payloadJson, false);
  assertEquals('student_name' in payloadJson, false);
  assertEquals('user_metadata' in payloadJson, false);
  assertEquals('app_metadata' in payloadJson, false);
  assertEquals('guest_token' in payloadJson, false);
  assertEquals('guest_token_hash' in payloadJson, false);
});

// 18. Raw guest token never appears in logs
Deno.test('18. Raw guest token never appears in logs', async () => {
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const secretGuestToken = 'super_secret_opaque_guest_token_never_log_this_12345';
  
  const capturedLogs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: any[]) => {
    capturedLogs.push(args.map(a => String(a)).join(' '));
  };

  try {
    const req = new Request('http://localhost/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: VALID_SESSION_ID,
        participant_id: VALID_PARTICIPANT_ID,
        guest_token: secretGuestToken,
      }),
    });

    await handleCapabilityIssuerRequest(req, undefined, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any);
  } finally {
    console.log = originalLog;
  }

  const allLogs = capturedLogs.join(' ');
  assertEquals(allLogs.includes(secretGuestToken), false);
});

// 19. Authorization value never appears in logs
Deno.test('19. Authorization value never appears in logs', async () => {
  const authClient = createMockAuthClient({ claims: { sub: VALID_USER_ID } });
  const mockFetch = createMockFetch({ is_valid: true, error_code: null });
  const secretBearer = 'secret_bearer_jwt_string_never_log_this_67890';
  
  const capturedLogs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: any[]) => {
    capturedLogs.push(args.map(a => String(a)).join(' '));
  };

  try {
    const req = new Request('http://localhost/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secretBearer}`,
      },
      body: JSON.stringify({
        session_id: VALID_SESSION_ID,
        participant_id: VALID_PARTICIPANT_ID,
      }),
    });

    await handleCapabilityIssuerRequest(req, authClient, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any);
  } finally {
    console.log = originalLog;
  }

  const allLogs = capturedLogs.join(' ');
  assertEquals(allLogs.includes(secretBearer), false);
});

// 20. No unexpected claims in minted capability JWT
Deno.test('20. No unexpected claims', async () => {
  const res = await mintCapabilityToken(VALID_SESSION_ID, VALID_PARTICIPANT_ID, MOCK_SIGNING_KEY);
  const parts = res.token.split('.');
  const payloadJson = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));

  const keys = Object.keys(payloadJson).sort();
  const expectedKeys = ['exp', 'iat', 'participant_id', 'role', 'session_id'].sort();

  assertEquals(keys, expectedKeys);
  assertEquals(payloadJson.role, 'competition_guest');
  assertEquals(payloadJson.session_id, VALID_SESSION_ID);
  assertEquals(payloadJson.participant_id, VALID_PARTICIPANT_ID);
  assertEquals(payloadJson.exp - payloadJson.iat, 300);
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
  assertEquals('authorization' in capturedHeaders, false);
});

// 23. service_role fallback remains functional transport path
Deno.test('23. service_role fallback remains functional transport path', async () => {
  let capturedHeaders: Record<string, string> = {};
  const mockFetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
    capturedHeaders = (init?.headers || {}) as Record<string, string>;
    return new Response(JSON.stringify([{ is_valid: true, error_code: null }]), { status: 200 });
  };

  await executeAdminRpc('http://localhost:54321', MOCK_SERVICE_ROLE_CREDENTIAL, 'test_rpc', {}, mockFetch as any);
  assertEquals(capturedHeaders['apikey'], MOCK_SERVICE_ROLE_CREDENTIAL.key);
  assertEquals(capturedHeaders['Authorization'], `Bearer ${MOCK_SERVICE_ROLE_CREDENTIAL.key}`);
});

// 24. non-2xx PostgREST fails closed
Deno.test('24. non-2xx PostgREST fails closed', async () => {
  const mockFetch = createMockFetch(null, 500);
  const result = await executeAdminRpc('http://localhost:54321', MOCK_SECRET_CREDENTIAL, 'test_rpc', {}, mockFetch as any);
  assertEquals(result.success, false);
  assertEquals(result.errorCode, 'internal_error');
});

// 25. malformed RPC response fails closed
Deno.test('25. malformed RPC response fails closed', async () => {
  const mockFetch = createMockFetch(null, 200, true);
  const result = await executeAdminRpc('http://localhost:54321', MOCK_SECRET_CREDENTIAL, 'test_rpc', {}, mockFetch as any);
  assertEquals(result.success, false);
  assertEquals(result.errorCode, 'internal_error');
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

  const res = await handleCapabilityIssuerRequest(req, authClient, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any);
  assertEquals(res.status, 401);
  const json = await res.json();
  assertEquals(json.error, 'unauthorized');
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

  const res = await handleCapabilityIssuerRequest(req, authClient, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any);
  assertEquals(res.status, 401);
  const json = await res.json();
  assertEquals(json.error, 'unauthorized');
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

  const res = await handleCapabilityIssuerRequest(req, authClient, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any);
  assertEquals(res.status, 401);
  const json = await res.json();
  assertEquals(json.error, 'unauthorized');
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

  const res = await handleCapabilityIssuerRequest(req, authClient, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any);
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(typeof json.token, 'string');
  assertEquals(json.expires_in, 300);
});

// 30. fallback getUser user.id must match verified identity contract
Deno.test('30. fallback getUser user.id must match verified identity contract', async () => {
  // getClaims throws error, fallback getUser returns valid user object
  const authClient = createMockAuthClient(null, { user: { id: VALID_USER_ID } }, new Error('getClaims unsupported'));
  const mockFetch = createMockFetch({ is_valid: true, error_code: null, participant_status: 'joined', session_status: 'waiting' });
  const req = new Request('http://localhost/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer valid_fallback_getuser_token_123' },
    body: JSON.stringify({ session_id: VALID_SESSION_ID, participant_id: VALID_PARTICIPANT_ID }),
  });

  const res = await handleCapabilityIssuerRequest(req, authClient, MOCK_SECRET_CREDENTIAL, MOCK_SIGNING_KEY, mockFetch as any);
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(typeof json.token, 'string');
  assertEquals(json.expires_in, 300);
});
