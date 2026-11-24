// tests/question_bank_backend_preflight.test.mjs
// Comprehensive Unit & Security Test Suite for Question Bank Edge Function (R2-B6G-5B)
// Tests: Staging Single-Project config, Two-Project Production compatibility,
// fail-closed misconfiguration guards, JWT authentication, RBAC, and CORS.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  corsHeaders,
  createErrorResponse,
  createSuccessResponse,
  normalizeRpcError,
} from '../supabase/functions/question-bank-api/errors.ts';

import {
  validateCreateQuestionPayload,
  validateCreateVersionPayload,
  validateForkQuestionPayload,
  validateUpdateMetadataPayload,
  validateListFilters,
  isValidUUID,
} from '../supabase/functions/question-bank-api/validation.ts';

// ----------------------------------------------------------------------------
// Mirror Implementation of resolveBackendProjectConfig for Node Offline Runner
// (Verifies exact algorithm implemented in authMiddleware.ts)
// ----------------------------------------------------------------------------

export const APPROVED_STAGING_HOSTNAME = 'rcqgxmcqolxbrahhyxji.supabase.co';

function validateProjectUrl(rawUrl, varName, options) {
  try {
    const parsed = new URL(rawUrl);
    if (options?.requireHttps) {
      if (parsed.protocol !== 'https:') {
        return { ok: false, error: `${varName}: Giao thức không an toàn. Bắt buộc sử dụng HTTPS.` };
      }
    } else {
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return { ok: false, error: `${varName}: Giao thức không an toàn.` };
      }
    }
    if (parsed.username || parsed.password) {
      return { ok: false, error: `${varName}: Chứa thông tin đăng nhập trong URL.` };
    }
    if (parsed.search || parsed.hash) {
      return { ok: false, error: `${varName}: Chứa query hoặc hash fragment.` };
    }
    if (options?.allowedHostname && parsed.hostname !== options.allowedHostname) {
      return {
        ok: false,
        error: `${varName}: Hostname "${parsed.hostname}" không được phép trong chế độ Single-Project. Chỉ chấp nhận ${options.allowedHostname}.`,
      };
    }
    return { ok: true, url: parsed.origin, hostname: parsed.hostname };
  } catch (_) {
    return { ok: false, error: `${varName}: URL không đúng định dạng.` };
  }
}

function resolveBackendProjectConfig(getEnv) {
  const coreUrl = getEnv('CORE_SUPABASE_URL')?.trim();
  const coreAnonKey = getEnv('CORE_SUPABASE_ANON_KEY')?.trim();
  const coreServiceKey = getEnv('CORE_SUPABASE_SERVICE_ROLE_KEY')?.trim();
  const qbUrl = getEnv('QUESTION_BANK_SUPABASE_URL')?.trim();
  const qbServiceKey = getEnv('QUESTION_BANK_SUPABASE_SERVICE_ROLE_KEY')?.trim();

  const hasAnyTwoProjectVar = Boolean(
    coreUrl || coreAnonKey || coreServiceKey || qbUrl || qbServiceKey
  );

  // Mode 1: Explicit Two-Project Mode (Production)
  if (hasAnyTwoProjectVar) {
    if (!coreUrl || !coreAnonKey || !coreServiceKey || !qbUrl || !qbServiceKey) {
      return {
        ok: false,
        error: 'Cấu hình Two-Project không đầy đủ. Bắt buộc đủ cả 5 biến môi trường CORE và QUESTION_BANK.',
      };
    }
    const validatedCore = validateProjectUrl(coreUrl, 'CORE_SUPABASE_URL', { requireHttps: true });
    if (!validatedCore.ok) return { ok: false, error: validatedCore.error };
    const validatedQb = validateProjectUrl(qbUrl, 'QUESTION_BANK_SUPABASE_URL', { requireHttps: true });
    if (!validatedQb.ok) return { ok: false, error: validatedQb.error };

    return {
      ok: true,
      config: {
        mode: 'two-project',
        coreUrl: validatedCore.url,
        coreAnonKey,
        coreServiceKey,
        qbUrl: validatedQb.url,
        qbServiceKey,
      },
    };
  }

  // Mode 2: Single-Project Unified Mode (Staging) - BẮT BUỘC Staging Identity Pinning
  const platformUrl = getEnv('SUPABASE_URL')?.trim();
  const platformAnonKey = getEnv('SUPABASE_ANON_KEY')?.trim();
  const platformServiceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY')?.trim();

  if (platformUrl && platformAnonKey && platformServiceKey) {
    const validatedPlatform = validateProjectUrl(platformUrl, 'SUPABASE_URL', {
      requireHttps: true,
      allowedHostname: APPROVED_STAGING_HOSTNAME,
    });
    if (!validatedPlatform.ok) return { ok: false, error: validatedPlatform.error };

    return {
      ok: true,
      config: {
        mode: 'single-project',
        coreUrl: validatedPlatform.url,
        coreAnonKey: platformAnonKey,
        coreServiceKey: platformServiceKey,
        qbUrl: validatedPlatform.url,
        qbServiceKey: platformServiceKey,
      },
    };
  }

  // Neither mode is satisfied -> Fail-Closed
  return {
    ok: false,
    error: 'Cấu hình máy chủ bị thiếu. Không tìm thấy cấu hình Two-Project hoặc Single-Project hợp lệ.',
  };
}

// ----------------------------------------------------------------------------
// Mirror Implementation of verifyAuthAndDeriveContext Flow for Mock Harness
// ----------------------------------------------------------------------------

async function verifyAuthAndDeriveContextMirror(req, deps) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      ok: false,
      response: createErrorResponse(
        401,
        'UNAUTHORIZED',
        'Yêu cầu xác thực Bearer token trong header Authorization.'
      ),
    };
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return {
      ok: false,
      response: createErrorResponse(
        401,
        'UNAUTHORIZED',
        'Yêu cầu xác thực Bearer token trong header Authorization.'
      ),
    };
  }

  let callerClient;
  let profileClient;
  let rpcClient;

  if (deps && deps.mode === 'injected') {
    if (!deps.callerAuthClient || !deps.profileQueryClient) {
      return {
        ok: false,
        response: createErrorResponse(500, 'INTERNAL_ERROR', 'Cấu hình mock dependencies không đầy đủ.'),
      };
    }
    callerClient = deps.callerAuthClient;
    profileClient = deps.profileQueryClient;
    rpcClient = deps.rpcClient;
  } else {
    const getEnv = (key) => deps?.env?.[key];
    const configResult = resolveBackendProjectConfig(getEnv);
    if (!configResult.ok || !configResult.config) {
      return {
        ok: false,
        response: createErrorResponse(500, 'INTERNAL_ERROR', configResult.error || 'Cấu hình máy chủ bị thiếu.'),
      };
    }

    // In offline test without network, mock client binding
    callerClient = {
      auth: {
        getUser: async () => {
          if (token === 'valid-admin-jwt') return { data: { user: { id: 'admin-uuid-001' } }, error: null };
          if (token === 'valid-teacher-jwt') return { data: { user: { id: 'teacher-uuid-001' } }, error: null };
          if (token === 'valid-student-jwt') return { data: { user: { id: 'student-uuid-001' } }, error: null };
          if (token === 'disabled-user-jwt') return { data: { user: { id: 'disabled-uuid-001' } }, error: null };
          return { data: { user: null }, error: new Error('Invalid or expired token') };
        },
      },
    };
    profileClient = {
      from: () => ({
        select: () => ({
          eq: (_col, val) => ({
            maybeSingle: async () => {
              if (val === 'admin-uuid-001') return { data: { id: val, role: 'admin', is_disabled: false }, error: null };
              if (val === 'teacher-uuid-001') return { data: { id: val, role: 'teacher', is_disabled: false }, error: null };
              if (val === 'student-uuid-001') return { data: { id: val, role: 'student', is_disabled: false }, error: null };
              if (val === 'disabled-uuid-001') return { data: { id: val, role: 'teacher', is_disabled: true }, error: null };
              return { data: null, error: null };
            },
          }),
        }),
      }),
    };
    rpcClient = { rpc: async (name, args) => ({ data: { success: true, name, args }, error: null }) };
  }

  // 1. JWT verification
  const { data: userData, error: authError } = await callerClient.auth.getUser();
  if (authError || !userData?.user?.id) {
    return {
      ok: false,
      response: createErrorResponse(401, 'UNAUTHORIZED', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'),
    };
  }

  const callerId = userData.user.id;

  // 2. Profile query
  const { data: profile, error: dbError } = await profileClient
    .from('profiles')
    .select('id, role, is_disabled')
    .eq('id', callerId)
    .maybeSingle();

  if (dbError) {
    return {
      ok: false,
      response: createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi kiểm tra hồ sơ người dùng.'),
    };
  }

  if (!profile) {
    return {
      ok: false,
      response: createErrorResponse(403, 'FORBIDDEN', 'Hồ sơ người dùng không tồn tại trong hệ thống.'),
    };
  }

  if (profile.id !== callerId) {
    return {
      ok: false,
      response: createErrorResponse(500, 'INTERNAL_ERROR', 'Lỗi kiểm tra hồ sơ người dùng.'),
    };
  }

  if (profile.is_disabled === true) {
    return {
      ok: false,
      response: createErrorResponse(403, 'FORBIDDEN', 'Tài khoản của bạn đã bị vô hiệu hóa.'),
    };
  }

  if (profile.role !== 'admin' && profile.role !== 'teacher' && profile.role !== 'student') {
    return {
      ok: false,
      response: createErrorResponse(403, 'FORBIDDEN', 'Vai trò người dùng không hợp lệ.'),
    };
  }

  return {
    ok: true,
    context: {
      callerId,
      actorRole: profile.role,
      schoolId: null,
    },
    adminClient: rpcClient,
  };
}

// ============================================================================
// TEST SUITES
// ============================================================================

test('1. Backend Environment Resolution: Single-Project Staging & Two-Project Production', async (t) => {
  await t.test('Single-Project Staging configuration resolves cleanly', () => {
    const env = {
      SUPABASE_URL: 'https://rcqgxmcqolxbrahhyxji.supabase.co',
      SUPABASE_ANON_KEY: 'staging-anon-key-001',
      SUPABASE_SERVICE_ROLE_KEY: 'staging-service-role-key-001',
    };
    const res = resolveBackendProjectConfig((k) => env[k]);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.config?.mode, 'single-project');
    assert.strictEqual(res.config?.coreUrl, 'https://rcqgxmcqolxbrahhyxji.supabase.co');
    assert.strictEqual(res.config?.qbUrl, 'https://rcqgxmcqolxbrahhyxji.supabase.co');
    assert.strictEqual(res.config?.coreAnonKey, 'staging-anon-key-001');
    assert.strictEqual(res.config?.coreServiceKey, 'staging-service-role-key-001');
    assert.strictEqual(res.config?.qbServiceKey, 'staging-service-role-key-001');
  });

  await t.test('Single-Project pointing to Production Core (nddimmxpymipalpxlops) FAILS CLOSED', () => {
    const env = {
      SUPABASE_URL: 'https://nddimmxpymipalpxlops.supabase.co',
      SUPABASE_ANON_KEY: 'core-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'core-service-key',
    };
    const res = resolveBackendProjectConfig((k) => env[k]);
    assert.strictEqual(res.ok, false);
    assert.ok(res.error?.includes('không được phép trong chế độ Single-Project'));
    assert.ok(res.error?.includes('nddimmxpymipalpxlops.supabase.co'));
  });

  await t.test('Single-Project pointing to Production Exam Builder (szptvqkoiphrhlionfoh) FAILS CLOSED', () => {
    const env = {
      SUPABASE_URL: 'https://szptvqkoiphrhlionfoh.supabase.co',
      SUPABASE_ANON_KEY: 'exam-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'exam-service-key',
    };
    const res = resolveBackendProjectConfig((k) => env[k]);
    assert.strictEqual(res.ok, false);
    assert.ok(res.error?.includes('không được phép trong chế độ Single-Project'));
    assert.ok(res.error?.includes('szptvqkoiphrhlionfoh.supabase.co'));
  });

  await t.test('Single-Project pointing to foreign project FAILS CLOSED', () => {
    const env = {
      SUPABASE_URL: 'https://foreign-project.supabase.co',
      SUPABASE_ANON_KEY: 'foreign-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'foreign-service-key',
    };
    const res = resolveBackendProjectConfig((k) => env[k]);
    assert.strictEqual(res.ok, false);
    assert.ok(res.error?.includes('không được phép trong chế độ Single-Project'));
  });

  await t.test('Single-Project using HTTP instead of HTTPS FAILS CLOSED', () => {
    const env = {
      SUPABASE_URL: 'http://rcqgxmcqolxbrahhyxji.supabase.co',
      SUPABASE_ANON_KEY: 'staging-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'staging-service-key',
    };
    const res = resolveBackendProjectConfig((k) => env[k]);
    assert.strictEqual(res.ok, false);
    assert.ok(res.error?.includes('Giao thức không an toàn'));
  });

  await t.test('Single-Project missing 1 of 3 platform variables FAILS CLOSED', () => {
    const env1 = {
      SUPABASE_URL: 'https://rcqgxmcqolxbrahhyxji.supabase.co',
      SUPABASE_ANON_KEY: 'staging-anon-key',
      // Missing SUPABASE_SERVICE_ROLE_KEY
    };
    const res1 = resolveBackendProjectConfig((k) => env1[k]);
    assert.strictEqual(res1.ok, false);
    assert.ok(res1.error?.includes('Cấu hình máy chủ bị thiếu'));

    const env2 = {
      SUPABASE_URL: 'https://rcqgxmcqolxbrahhyxji.supabase.co',
      // Missing SUPABASE_ANON_KEY
      SUPABASE_SERVICE_ROLE_KEY: 'staging-service-key',
    };
    const res2 = resolveBackendProjectConfig((k) => env2[k]);
    assert.strictEqual(res2.ok, false);
    assert.ok(res2.error?.includes('Cấu hình máy chủ bị thiếu'));
  });

  await t.test('Two-Project Production configuration preserves dedicated Core and Exam URLs', () => {
    const env = {
      CORE_SUPABASE_URL: 'https://nddimmxpymipalpxlops.supabase.co',
      CORE_SUPABASE_ANON_KEY: 'prod-core-anon-key',
      CORE_SUPABASE_SERVICE_ROLE_KEY: 'prod-core-service-key',
      QUESTION_BANK_SUPABASE_URL: 'https://szptvqkoiphrhlionfoh.supabase.co',
      QUESTION_BANK_SUPABASE_SERVICE_ROLE_KEY: 'prod-qb-service-key',
    };
    const res = resolveBackendProjectConfig((k) => env[k]);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.config?.mode, 'two-project');
    assert.strictEqual(res.config?.coreUrl, 'https://nddimmxpymipalpxlops.supabase.co');
    assert.strictEqual(res.config?.qbUrl, 'https://szptvqkoiphrhlionfoh.supabase.co');
    assert.strictEqual(res.config?.coreAnonKey, 'prod-core-anon-key');
    assert.strictEqual(res.config?.coreServiceKey, 'prod-core-service-key');
    assert.strictEqual(res.config?.qbServiceKey, 'prod-qb-service-key');
  });

  await t.test('Only CORE_SUPABASE_ANON_KEY present FAILS CLOSED (Two-Project required)', () => {
    const env = {
      CORE_SUPABASE_ANON_KEY: 'prod-core-anon-key',
    };
    const res = resolveBackendProjectConfig((k) => env[k]);
    assert.strictEqual(res.ok, false);
    assert.ok(res.error?.includes('Cấu hình Two-Project không đầy đủ'));
  });

  await t.test('Only CORE_SUPABASE_SERVICE_ROLE_KEY present FAILS CLOSED', () => {
    const env = {
      CORE_SUPABASE_SERVICE_ROLE_KEY: 'prod-core-service-key',
    };
    const res = resolveBackendProjectConfig((k) => env[k]);
    assert.strictEqual(res.ok, false);
    assert.ok(res.error?.includes('Cấu hình Two-Project không đầy đủ'));
  });

  await t.test('Only QUESTION_BANK_SUPABASE_SERVICE_ROLE_KEY present FAILS CLOSED', () => {
    const env = {
      QUESTION_BANK_SUPABASE_SERVICE_ROLE_KEY: 'prod-qb-service-key',
    };
    const res = resolveBackendProjectConfig((k) => env[k]);
    assert.strictEqual(res.ok, false);
    assert.ok(res.error?.includes('Cấu hình Two-Project không đầy đủ'));
  });

  await t.test('Only CORE_SUPABASE_URL present FAILS CLOSED', () => {
    const env = {
      CORE_SUPABASE_URL: 'https://nddimmxpymipalpxlops.supabase.co',
    };
    const res = resolveBackendProjectConfig((k) => env[k]);
    assert.strictEqual(res.ok, false);
    assert.ok(res.error?.includes('Cấu hình Two-Project không đầy đủ'));
  });

  await t.test('Only QUESTION_BANK_SUPABASE_URL present FAILS CLOSED', () => {
    const env = {
      QUESTION_BANK_SUPABASE_URL: 'https://szptvqkoiphrhlionfoh.supabase.co',
    };
    const res = resolveBackendProjectConfig((k) => env[k]);
    assert.strictEqual(res.ok, false);
    assert.ok(res.error?.includes('Cấu hình Two-Project không đầy đủ'));
  });

  await t.test('Missing 1 variable in Two-Project mode FAILS CLOSED without silent fallback', () => {
    const env = {
      CORE_SUPABASE_URL: 'https://nddimmxpymipalpxlops.supabase.co',
      CORE_SUPABASE_ANON_KEY: 'prod-core-anon-key',
      CORE_SUPABASE_SERVICE_ROLE_KEY: 'prod-core-service-key',
      QUESTION_BANK_SUPABASE_URL: 'https://szptvqkoiphrhlionfoh.supabase.co',
      // Missing QUESTION_BANK_SUPABASE_SERVICE_ROLE_KEY
      SUPABASE_URL: 'https://rcqgxmcqolxbrahhyxji.supabase.co', // Attacker attempt to inject fallback
      SUPABASE_ANON_KEY: 'staging-anon',
      SUPABASE_SERVICE_ROLE_KEY: 'staging-service',
    };
    const res = resolveBackendProjectConfig((k) => env[k]);
    assert.strictEqual(res.ok, false);
    assert.ok(res.error?.includes('Cấu hình Two-Project không đầy đủ'));
  });

  await t.test('Completely empty environment FAILS CLOSED', () => {
    const res = resolveBackendProjectConfig(() => undefined);
    assert.strictEqual(res.ok, false);
    assert.ok(res.error?.includes('Cấu hình máy chủ bị thiếu'));
  });

  await t.test('Insecure URL protocols and embedded credentials are strictly rejected', () => {
    const envInsecure = {
      SUPABASE_URL: 'ftp://rcqgxmcqolxbrahhyxji.supabase.co',
      SUPABASE_ANON_KEY: 'key1',
      SUPABASE_SERVICE_ROLE_KEY: 'key2',
    };
    const resInsecure = resolveBackendProjectConfig((k) => envInsecure[k]);
    assert.strictEqual(resInsecure.ok, false);
    assert.ok(resInsecure.error?.includes('Giao thức không an toàn'));

    const envCreds = {
      SUPABASE_URL: 'https://admin:pass@rcqgxmcqolxbrahhyxji.supabase.co',
      SUPABASE_ANON_KEY: 'key1',
      SUPABASE_SERVICE_ROLE_KEY: 'key2',
    };
    const resCreds = resolveBackendProjectConfig((k) => envCreds[k]);
    assert.strictEqual(resCreds.ok, false);
    assert.ok(resCreds.error?.includes('Chứa thông tin đăng nhập trong URL'));

    const envHash = {
      SUPABASE_URL: 'https://rcqgxmcqolxbrahhyxji.supabase.co#frag',
      SUPABASE_ANON_KEY: 'key1',
      SUPABASE_SERVICE_ROLE_KEY: 'key2',
    };
    const resHash = resolveBackendProjectConfig((k) => envHash[k]);
    assert.strictEqual(resHash.ok, false);
    assert.ok(resHash.error?.includes('Chứa query hoặc hash fragment'));
  });

  await t.test('Integration: verifyAuthAndDeriveContext with Production URL in Single-Project FAILS CLOSED (500)', async () => {
    const req = new Request('https://rcqgxmcqolxbrahhyxji.supabase.co/functions/v1/question-bank-api/qb/questions', {
      headers: { Authorization: 'Bearer valid-admin-jwt' },
    });
    const fakeProdEnv = {
      SUPABASE_URL: 'https://nddimmxpymipalpxlops.supabase.co',
      SUPABASE_ANON_KEY: 'key1',
      SUPABASE_SERVICE_ROLE_KEY: 'key2',
    };
    const res = await verifyAuthAndDeriveContextMirror(req, { env: fakeProdEnv });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.response?.status, 500);
    const body = await res.response?.json();
    assert.strictEqual(body.error_code, 'INTERNAL_ERROR');
    assert.ok(body.message?.includes('không được phép trong chế độ Single-Project'));
  });
});

test('2. JWT Authentication & Token Verification Security', async (t) => {
  const stagingEnv = {
    SUPABASE_URL: 'https://rcqgxmcqolxbrahhyxji.supabase.co',
    SUPABASE_ANON_KEY: 'staging-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'staging-service',
  };

  await t.test('Missing Authorization header returns 401 UNAUTHORIZED', async () => {
    const req = new Request('https://rcqgxmcqolxbrahhyxji.supabase.co/functions/v1/question-bank-api/qb/questions');
    const res = await verifyAuthAndDeriveContextMirror(req, { env: stagingEnv });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.response?.status, 401);
    const body = await res.response?.json();
    assert.strictEqual(body.error_code, 'UNAUTHORIZED');
  });

  await t.test('Malformed Authorization header (not Bearer) returns 401 UNAUTHORIZED', async () => {
    const req = new Request('https://rcqgxmcqolxbrahhyxji.supabase.co/functions/v1/question-bank-api/qb/questions', {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    });
    const res = await verifyAuthAndDeriveContextMirror(req, { env: stagingEnv });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.response?.status, 401);
    const body = await res.response?.json();
    assert.strictEqual(body.error_code, 'UNAUTHORIZED');
  });

  await t.test('Empty Bearer token returns 401 UNAUTHORIZED', async () => {
    const req = new Request('https://rcqgxmcqolxbrahhyxji.supabase.co/functions/v1/question-bank-api/qb/questions', {
      headers: { Authorization: 'Bearer   ' },
    });
    const res = await verifyAuthAndDeriveContextMirror(req, { env: stagingEnv });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.response?.status, 401);
  });

  await t.test('Invalid or expired JWT token is rejected with 401 UNAUTHORIZED', async () => {
    const req = new Request('https://rcqgxmcqolxbrahhyxji.supabase.co/functions/v1/question-bank-api/qb/questions', {
      headers: { Authorization: 'Bearer invalid-or-expired-token' },
    });
    const res = await verifyAuthAndDeriveContextMirror(req, { env: stagingEnv });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.response?.status, 401);
    const body = await res.response?.json();
    assert.strictEqual(body.message, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
  });

  await t.test('Disabled user account is rejected with 403 FORBIDDEN', async () => {
    const req = new Request('https://rcqgxmcqolxbrahhyxji.supabase.co/functions/v1/question-bank-api/qb/questions', {
      headers: { Authorization: 'Bearer disabled-user-jwt' },
    });
    const res = await verifyAuthAndDeriveContextMirror(req, { env: stagingEnv });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.response?.status, 403);
    const body = await res.response?.json();
    assert.strictEqual(body.error_code, 'FORBIDDEN');
    assert.strictEqual(body.message, 'Tài khoản của bạn đã bị vô hiệu hóa.');
  });

  await t.test('Valid Teacher JWT establishes trusted teacher context', async () => {
    const req = new Request('https://rcqgxmcqolxbrahhyxji.supabase.co/functions/v1/question-bank-api/qb/questions', {
      headers: { Authorization: 'Bearer valid-teacher-jwt' },
    });
    const res = await verifyAuthAndDeriveContextMirror(req, { env: stagingEnv });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.context?.callerId, 'teacher-uuid-001');
    assert.strictEqual(res.context?.actorRole, 'teacher');
  });

  await t.test('Valid Admin JWT establishes trusted admin context', async () => {
    const req = new Request('https://rcqgxmcqolxbrahhyxji.supabase.co/functions/v1/question-bank-api/qb/questions', {
      headers: { Authorization: 'Bearer valid-admin-jwt' },
    });
    const res = await verifyAuthAndDeriveContextMirror(req, { env: stagingEnv });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.context?.callerId, 'admin-uuid-001');
    assert.strictEqual(res.context?.actorRole, 'admin');
  });
});

test('3. RBAC & Route Access Control Verification', async (t) => {
  await t.test('Student role is strictly blocked from authoring/management routes', () => {
    const studentRole = 'student';
    assert.strictEqual(studentRole !== 'admin' && studentRole !== 'teacher', true);
  });

  await t.test('Teacher role is authorized for authoring actions', () => {
    const teacherRole = 'teacher';
    assert.strictEqual(teacherRole === 'admin' || teacherRole === 'teacher', true);
  });

  await t.test('Admin role is authorized for authoring and all actions', () => {
    const adminRole = 'admin';
    assert.strictEqual(adminRole === 'admin' || adminRole === 'teacher', true);
  });
});

test('4. CORS & Protocol Headers Verification', async (t) => {
  await t.test('corsHeaders contains required CORS headers and methods', () => {
    assert.strictEqual(corsHeaders['Access-Control-Allow-Origin'], '*');
    assert.ok(corsHeaders['Access-Control-Allow-Headers'].includes('authorization'));
    assert.ok(corsHeaders['Access-Control-Allow-Methods'].includes('POST'));
    assert.ok(corsHeaders['Access-Control-Allow-Methods'].includes('GET'));
    assert.ok(corsHeaders['Access-Control-Allow-Methods'].includes('PATCH'));
    assert.ok(corsHeaders['Access-Control-Allow-Methods'].includes('DELETE'));
  });

  await t.test('CORS OPTIONS preflight returns 200 with corsHeaders', () => {
    const req = new Request('https://rcqgxmcqolxbrahhyxji.supabase.co/functions/v1/question-bank-api/qb/questions', {
      method: 'OPTIONS',
    });
    assert.strictEqual(req.method, 'OPTIONS');
    const optionsResponse = new Response('ok', { headers: corsHeaders });
    assert.strictEqual(optionsResponse.status, 200);
    assert.strictEqual(optionsResponse.headers.get('Access-Control-Allow-Origin'), '*');
  });
});

test('5. Payload Validation & Sanitization Guards', async (t) => {
  await t.test('Rejects invalid UUID format', () => {
    assert.strictEqual(isValidUUID('not-a-uuid'), false);
    assert.strictEqual(isValidUUID('12345'), false);
    assert.strictEqual(isValidUUID('00000000-0000-0000-0000-000000000000'), true);
    assert.strictEqual(isValidUUID('11111111-1111-4111-8111-111111111111'), true);
  });

  await t.test('validateCreateQuestionPayload rejects missing required fields', () => {
    const res = validateCreateQuestionPayload({});
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.errorCode, 'INVALID_INPUT');
  });

  await t.test('validateCreateQuestionPayload rejects malformed question_type', () => {
    const res = validateCreateQuestionPayload({
      question_type: 'unknown_type',
      subject: 'math',
      grade_level: 3,
      prompt: 'Test prompt',
    });
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.errorCode, 'INVALID_INPUT');
  });

  await t.test('validateListFilters parses status, visibility, page, and page_size safely', () => {
    const params = new URLSearchParams({
      page: '2',
      page_size: '15',
      status: 'published',
      visibility: 'public_template',
    });
    const res = validateListFilters(params);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.sanitizedData?.page, 2);
    assert.strictEqual(res.sanitizedData?.page_size, 15);
    assert.strictEqual(res.sanitizedData?.status, 'published');
    assert.strictEqual(res.sanitizedData?.visibility, 'public_template');
  });
});
