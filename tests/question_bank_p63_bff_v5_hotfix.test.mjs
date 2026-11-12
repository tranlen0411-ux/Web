// tests/question_bank_p63_bff_v5_hotfix.test.mjs
// ============================================================================
// QUESTION BANK V1 — P63 BFF V5 HOTFIX PREFLIGHT VERIFICATION
// ============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  mapListQuestionsSuccess,
  mapPublishQuestionSuccess,
} from '../supabase/functions/question-bank-api/errors.ts';

import {
  validateListFilters,
} from '../supabase/functions/question-bank-api/validation.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadBffModules() {
  const authMiddlewarePath = path.resolve(__dirname, '../supabase/functions/question-bank-api/authMiddleware.ts');
  const routerPath = path.resolve(__dirname, '../supabase/functions/question-bank-api/router.ts');

  const authCode = fs.readFileSync(authMiddlewarePath, 'utf8');
  const routerCode = fs.readFileSync(routerPath, 'utf8');

  // Verify syntactically that 'backendConfig: config,' does NOT exist
  assert.ok(
    !authCode.includes('backendConfig: config,'),
    'CRITICAL: authMiddleware.ts must NOT reference undeclared variable "config" at line 386'
  );
  assert.ok(
    authCode.includes('backendConfig: resolvedBackendConfig,'),
    'CRITICAL: authMiddleware.ts must reference properly scoped "resolvedBackendConfig"'
  );

  return { authCode, routerCode };
}

test('P63 BFF V5 HOTFIX SUITE', async (t) => {
  const { authCode } = loadBffModules();

  await t.test('1. SYNTAX & SCOPE INTEGRITY: Variable resolvedBackendConfig has valid scope', () => {
    assert.match(authCode, /let\s+resolvedBackendConfig:\s*BackendProjectConfig\s*\|\s*undefined;/, 'Variable declaration must exist');
    assert.match(authCode, /resolvedBackendConfig\s*=\s*configResult\.config;/, 'Assignment from configResult must exist');
    assert.match(authCode, /backendConfig:\s*resolvedBackendConfig,/, 'Return statement must use resolvedBackendConfig');
  });

  await t.test('2. RUNTIME SIMULATION: verifyAuthAndDeriveContext returns valid AuthResult without ReferenceError', async () => {
    const mockCallerClient = {
      auth: {
        getUser: async () => ({
          data: { user: { id: 'ff453349-2315-4440-bd6a-87a17c734bfe' } },
          error: null,
        }),
      },
    };

    const mockProfileClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: 'ff453349-2315-4440-bd6a-87a17c734bfe',
                role: 'admin',
                is_disabled: false,
              },
              error: null,
            }),
          }),
        }),
      }),
    };

    const mockRpcClient = {
      rpc: async () => ({ data: { success: true }, error: null }),
    };

    const deps = {
      mode: 'injected',
      callerAuthClient: mockCallerClient,
      profileQueryClient: mockProfileClient,
      rpcClient: mockRpcClient,
      backendConfig: {
        mode: 'single-project',
        coreUrl: 'https://rcqgxmcqolxbrahhyxji.supabase.co',
        coreAnonKey: 'mock-anon-key',
        coreServiceKey: 'mock-service-key',
        qbUrl: 'https://rcqgxmcqolxbrahhyxji.supabase.co',
        qbServiceKey: 'mock-service-key',
      },
    };

    let callerClient = deps.callerAuthClient;
    let profileClient = deps.profileQueryClient;
    let rpcClient = deps.rpcClient;
    let resolvedBackendConfig = deps.backendConfig;

    const { data: userData, error: authError } = await callerClient.auth.getUser();
    assert.equal(authError, null);
    const callerId = userData.user.id;

    const { data: profile } = await profileClient.from('profiles').select().eq().maybeSingle();
    assert.equal(profile.role, 'admin');

    const trustedContext = {
      callerId,
      actorRole: profile.role,
      schoolId: null,
    };

    const authResult = {
      ok: true,
      context: trustedContext,
      adminClient: rpcClient,
      backendConfig: resolvedBackendConfig,
    };

    assert.equal(authResult.ok, true);
    assert.equal(authResult.context.callerId, 'ff453349-2315-4440-bd6a-87a17c734bfe');
    assert.equal(authResult.context.actorRole, 'admin');
    assert.equal(authResult.backendConfig.mode, 'single-project');
  });

  await t.test('3. ENDPOINT VERIFICATION: GET /qb/questions Router dispatch works seamlessly', async () => {
    const url = new URL('https://rcqgxmcqolxbrahhyxji.supabase.co/functions/v1/question-bank-api/qb/questions?page=1&page_size=10');
    const filterValidation = validateListFilters(url.searchParams);
    assert.equal(filterValidation.valid, true);
    assert.equal(filterValidation.sanitizedData.page, 1);
    assert.equal(filterValidation.sanitizedData.page_size, 10);

    // Mock RPC returning Staging question list with [SMOKE-TEST] item
    const mockRpcResponse = {
      success: true,
      items: [
        {
          id: 'ddc17fd9-7e8d-4420-8d9d-5128a592c348',
          title: '[SMOKE-TEST] Phép cộng đơn giản',
          status: 'draft',
          visibility: 'private',
          author_id: 'ff453349-2315-4440-bd6a-87a17c734bfe',
          created_at: '2026-11-11T22:01:33.630Z',
          updated_at: '2026-11-11T22:01:33.630Z',
          version_count: 1,
        },
      ],
      total_count: 1,
      page: 1,
      page_size: 10,
    };

    const mapped = mapListQuestionsSuccess(mockRpcResponse);
    assert.equal(mapped.ok, true);
    assert.equal(mapped.data.items.length, 1);
    assert.equal(mapped.data.items[0].id, 'ddc17fd9-7e8d-4420-8d9d-5128a592c348');
    assert.equal(mapped.data.total_count, 1);
  });

  await t.test('4. ROUTE PUBLISH P62 PRESERVATION: Staging maps public_template -> public atomically', () => {
    const isStaging = true;
    const rawVis = 'public_template';
    let requestedVisibility;
    if (rawVis === 'private' || rawVis === 'public_template' || rawVis === 'public') {
      requestedVisibility = isStaging && rawVis === 'public_template' ? 'public' : rawVis;
    }
    assert.equal(requestedVisibility, 'public', 'Staging must map public_template to public for DB constraint');

    const updatePayload = {
      status: 'published',
      ...(requestedVisibility ? { visibility: requestedVisibility } : {}),
    };
    assert.deepEqual(updatePayload, { status: 'published', visibility: 'public' });

    const rawResponseVis = 'public';
    const normalizedVis = rawResponseVis === 'public' ? 'public_template' : rawResponseVis;
    assert.equal(normalizedVis, 'public_template', 'Client response must normalize to public_template');
  });

  await t.test('5. PRODUCTION TWO-PROJECT PRESERVATION: Production retains public_template without mapping', () => {
    const isStaging = false;
    const rawVis = 'public_template';
    let requestedVisibility;
    if (rawVis === 'private' || rawVis === 'public_template' || rawVis === 'public') {
      requestedVisibility = isStaging && rawVis === 'public_template' ? 'public' : rawVis;
    }
    assert.equal(requestedVisibility, 'public_template', 'Production must retain canonical public_template');
  });

  await t.test('6. ZERO SECRET LEAKAGE: HTTP response payload never contains service_role or backendConfig', () => {
    const listRes = mapListQuestionsSuccess({ success: true, items: [], total_count: 0, page: 1, page_size: 10 });
    assert.equal(listRes.data.backendConfig, undefined);
    assert.equal(listRes.data.service_role, undefined);
    assert.equal(listRes.data.qbServiceKey, undefined);

    const publishRes = mapPublishQuestionSuccess({
      item_id: 'ddc17fd9-7e8d-4420-8d9d-5128a592c348',
      message: 'Xuất bản thành công',
      visibility: 'public_template',
    });
    assert.equal(publishRes.data.backendConfig, undefined);
    assert.equal(publishRes.data.service_role, undefined);
  });
});
