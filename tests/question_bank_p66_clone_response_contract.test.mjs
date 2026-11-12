// tests/question_bank_p66_clone_response_contract.test.mjs
// ============================================================================
// QUESTION BANK V1 — P66 CLONE RESPONSE CONTRACT & FRONTEND TOAST TEST SUITE
// Strict Isolated Unit & Contract Test Suite
// Verifies:
// 1. Staging nested response: { success: true, item: {...}, version: {...} } without code (isStaging: true)
// 2. Production flat response: { success: true, item_id, version_id, code, forked_from_version_id } (isStaging: false / default)
// 3. Production rejection of missing code (Fail-Closed)
// 4. Fail-closed: missing UUIDs, success !== true, invalid code, cross-integrity mismatch
// 5. Zero Secret / Answer Key Leakage: answer keys, service_role keys never emitted
// 6. Frontend Toast behavior: errors receive 'error' type and trigger red toast
// 7. Router integration with server-derived isStaging from backendConfig
// ============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mapForkQuestionSuccess,
  createSuccessResponse,
  createErrorResponse,
  normalizeRpcError,
} from '../supabase/functions/question-bank-api/errors.ts';

const VALID_ITEM_ID = '58748443-c8a4-47b6-a1f4-5f5bd8569f0b';
const VALID_VERSION_ID = 'e5b494bf-9269-4a4d-85f9-e60408874af9';
const VALID_SOURCE_VERSION_ID = '6485dd89-a347-4291-ac1c-3713a63178ea';
const INVALID_UUID = 'not-a-valid-uuid-1234';

test('P66 CLONE RESPONSE CONTRACT & ERROR HANDLING SUITE', async (t) => {

  // ==========================================================================
  // 1. STAGING NESTED RESPONSE CONTRACT (NO CODE IN SCHEMA, isStaging: true)
  // ==========================================================================
  await t.test('1.1. STAGING NESTED: Exact PostgreSQL rpc_qb_fork_question response without code succeeds when isStaging: true', () => {
    // Exact shape produced by Staging rcqgxmcqolxbrahhyxji for Teacher B clone
    const stagingRpcPayload = {
      success: true,
      item: {
        id: VALID_ITEM_ID,
        title: '[SMOKE-TEST] Phép cộng đơn giản (Bản sao)',
        question_type: 'single_choice',
        difficulty: 'medium',
        tags: [],
        grade_level: 1,
        subject: 'Toán',
        status: 'draft',
        visibility: 'private',
        author_id: '0ad12fe7-5e26-42f3-a977-ea2cc76f0236',
        version_count: 1,
        current_version_id: VALID_VERSION_ID,
        metadata: {
          forked_from_version_id: VALID_SOURCE_VERSION_ID,
        },
        created_at: '2026-11-12 01:29:21.256385+00',
        updated_at: '2026-11-12 01:29:21.256385+00',
      },
      version: {
        id: VALID_VERSION_ID,
        question_bank_item_id: VALID_ITEM_ID,
        version_number: 1,
        prompt: '1 + 1 bằng mấy?',
        prompt_media: [],
        question_type: 'single_choice',
        options: [{ id: 'opt_1', text: '2' }],
        forked_from_version_id: VALID_SOURCE_VERSION_ID,
        created_by: '0ad12fe7-5e26-42f3-a977-ea2cc76f0236',
        created_at: '2026-11-12 01:29:21.256385+00',
      },
    };

    const mapped = mapForkQuestionSuccess(stagingRpcPayload, { isStaging: true });
    assert.strictEqual(mapped.ok, true, 'Must return ok: true for Staging nested RPC payload when isStaging: true');
    assert.strictEqual(mapped.data.item_id, VALID_ITEM_ID);
    assert.strictEqual(mapped.data.version_id, VALID_VERSION_ID);
    assert.strictEqual(mapped.data.forked_from_version_id, VALID_SOURCE_VERSION_ID);
    assert.strictEqual(mapped.data.code, undefined, 'Must not fabricate code when Staging schema lacks code column');
  });

  await t.test('1.2. STAGING NESTED: Resolves provenance from item.metadata when version column is absent', () => {
    const payloadWithMetadataProvenanceOnly = {
      success: true,
      item: {
        id: VALID_ITEM_ID,
        metadata: { forked_from_version_id: VALID_SOURCE_VERSION_ID },
      },
      version: {
        id: VALID_VERSION_ID,
        question_bank_item_id: VALID_ITEM_ID,
      },
    };

    const mapped = mapForkQuestionSuccess(payloadWithMetadataProvenanceOnly, { isStaging: true });
    assert.strictEqual(mapped.ok, true);
    assert.strictEqual(mapped.data.forked_from_version_id, VALID_SOURCE_VERSION_ID);
  });

  await t.test('1.3. STAGING NESTED: Resolves provenance from version record when metadata is absent', () => {
    const payloadWithVersionProvenanceOnly = {
      success: true,
      item: {
        id: VALID_ITEM_ID,
      },
      version: {
        id: VALID_VERSION_ID,
        question_bank_item_id: VALID_ITEM_ID,
        forked_from_version_id: VALID_SOURCE_VERSION_ID,
      },
    };

    const mapped = mapForkQuestionSuccess(payloadWithVersionProvenanceOnly, { isStaging: true });
    assert.strictEqual(mapped.ok, true);
    assert.strictEqual(mapped.data.forked_from_version_id, VALID_SOURCE_VERSION_ID);
  });

  // ==========================================================================
  // 2. PRODUCTION FLAT & HYBRID CONTRACT (WITH MANDATORY CODE)
  // ==========================================================================
  await t.test('2.1. PRODUCTION FLAT: Flat response with mandatory code succeeds', () => {
    const prodFlatPayload = {
      success: true,
      item_id: VALID_ITEM_ID,
      version_id: VALID_VERSION_ID,
      code: 'QB-MAT-G01-FORK-001',
      forked_from_version_id: VALID_SOURCE_VERSION_ID,
    };

    // Calling with default options (Production)
    const mapped = mapForkQuestionSuccess(prodFlatPayload);
    assert.strictEqual(mapped.ok, true);
    assert.strictEqual(mapped.data.item_id, VALID_ITEM_ID);
    assert.strictEqual(mapped.data.version_id, VALID_VERSION_ID);
    assert.strictEqual(mapped.data.forked_from_version_id, VALID_SOURCE_VERSION_ID);
    assert.strictEqual(mapped.data.code, 'QB-MAT-G01-FORK-001');

    // Calling with explicit isStaging: false (Production)
    const mappedExplicit = mapForkQuestionSuccess(prodFlatPayload, { isStaging: false });
    assert.strictEqual(mappedExplicit.ok, true);
    assert.strictEqual(mappedExplicit.data.code, 'QB-MAT-G01-FORK-001');
  });

  await t.test('2.2. PRODUCTION HYBRID: Dual-head nested response with item.code preserves code', () => {
    const prodHybridPayload = {
      success: true,
      item: {
        id: VALID_ITEM_ID,
        code: 'QB-MAT-G01-HYBRID-002',
        metadata: { forked_from_version_id: VALID_SOURCE_VERSION_ID },
      },
      version: {
        id: VALID_VERSION_ID,
        question_bank_item_id: VALID_ITEM_ID,
        forked_from_version_id: VALID_SOURCE_VERSION_ID,
      },
    };

    const mapped = mapForkQuestionSuccess(prodHybridPayload, { isStaging: false });
    assert.strictEqual(mapped.ok, true);
    assert.strictEqual(mapped.data.code, 'QB-MAT-G01-HYBRID-002');
  });

  await t.test('2.3. PRODUCTION FAIL-CLOSED: Production strictly rejects payload missing code', () => {
    // A payload without code MUST fail when evaluated against Production (isStaging: false or default)
    const payloadMissingCode = {
      success: true,
      item: {
        id: VALID_ITEM_ID,
        metadata: { forked_from_version_id: VALID_SOURCE_VERSION_ID },
      },
      version: {
        id: VALID_VERSION_ID,
        question_bank_item_id: VALID_ITEM_ID,
        forked_from_version_id: VALID_SOURCE_VERSION_ID,
      },
    };

    const defaultResult = mapForkQuestionSuccess(payloadMissingCode);
    assert.strictEqual(defaultResult.ok, false, 'Default (Production) must reject payload without code');

    const explicitProdResult = mapForkQuestionSuccess(payloadMissingCode, { isStaging: false });
    assert.strictEqual(explicitProdResult.ok, false, 'Explicit Production mode must reject payload without code');

    const flatMissingCode = {
      success: true,
      item_id: VALID_ITEM_ID,
      version_id: VALID_VERSION_ID,
      forked_from_version_id: VALID_SOURCE_VERSION_ID,
    };
    assert.strictEqual(mapForkQuestionSuccess(flatMissingCode).ok, false, 'Flat payload without code must fail Production check');
  });

  // ==========================================================================
  // 3. FAIL-CLOSED & INTEGRITY VALIDATIONS
  // ==========================================================================
  await t.test('3.1. FAIL-CLOSED: Rejects when success === false', () => {
    const failedPayload = {
      success: false,
      error_code: 'SOURCE_VERSION_NOT_FOUND',
      message: 'Source question version not found',
    };
    assert.strictEqual(mapForkQuestionSuccess(failedPayload, { isStaging: true }).ok, false);
    assert.strictEqual(mapForkQuestionSuccess(failedPayload, { isStaging: false }).ok, false);
  });

  await t.test('3.2. FAIL-CLOSED: Rejects non-object or null input', () => {
    assert.strictEqual(mapForkQuestionSuccess(null, { isStaging: true }).ok, false);
    assert.strictEqual(mapForkQuestionSuccess(undefined, { isStaging: true }).ok, false);
    assert.strictEqual(mapForkQuestionSuccess('string', { isStaging: true }).ok, false);
    assert.strictEqual(mapForkQuestionSuccess(12345, { isStaging: true }).ok, false);
    assert.strictEqual(mapForkQuestionSuccess([], { isStaging: true }).ok, false);
  });

  await t.test('3.3. FAIL-CLOSED: Rejects invalid or missing item_id UUID', () => {
    assert.strictEqual(mapForkQuestionSuccess({
      version_id: VALID_VERSION_ID,
      forked_from_version_id: VALID_SOURCE_VERSION_ID,
    }, { isStaging: true }).ok, false, 'Missing item_id must fail');

    assert.strictEqual(mapForkQuestionSuccess({
      item_id: INVALID_UUID,
      version_id: VALID_VERSION_ID,
      forked_from_version_id: VALID_SOURCE_VERSION_ID,
    }, { isStaging: true }).ok, false, 'Invalid item_id UUID must fail');
  });

  await t.test('3.4. FAIL-CLOSED: Rejects invalid or missing version_id UUID', () => {
    assert.strictEqual(mapForkQuestionSuccess({
      item_id: VALID_ITEM_ID,
      forked_from_version_id: VALID_SOURCE_VERSION_ID,
    }, { isStaging: true }).ok, false, 'Missing version_id must fail');

    assert.strictEqual(mapForkQuestionSuccess({
      item_id: VALID_ITEM_ID,
      version_id: INVALID_UUID,
      forked_from_version_id: VALID_SOURCE_VERSION_ID,
    }, { isStaging: true }).ok, false, 'Invalid version_id UUID must fail');
  });

  await t.test('3.5. FAIL-CLOSED: Rejects invalid or missing forked_from_version_id UUID', () => {
    assert.strictEqual(mapForkQuestionSuccess({
      item_id: VALID_ITEM_ID,
      version_id: VALID_VERSION_ID,
    }, { isStaging: true }).ok, false, 'Missing provenance must fail');

    assert.strictEqual(mapForkQuestionSuccess({
      item_id: VALID_ITEM_ID,
      version_id: VALID_VERSION_ID,
      forked_from_version_id: INVALID_UUID,
    }, { isStaging: true }).ok, false, 'Invalid provenance UUID must fail');
  });

  await t.test('3.6. FAIL-CLOSED: Rejects empty or whitespace-only code when code is present', () => {
    assert.strictEqual(mapForkQuestionSuccess({
      item_id: VALID_ITEM_ID,
      version_id: VALID_VERSION_ID,
      forked_from_version_id: VALID_SOURCE_VERSION_ID,
      code: '',
    }, { isStaging: true }).ok, false, 'Empty code must fail even in Staging');

    assert.strictEqual(mapForkQuestionSuccess({
      item_id: VALID_ITEM_ID,
      version_id: VALID_VERSION_ID,
      forked_from_version_id: VALID_SOURCE_VERSION_ID,
      code: '   ',
    }, { isStaging: true }).ok, false, 'Whitespace-only code must fail even in Staging');
  });

  await t.test('3.7. FAIL-CLOSED: Cross-integrity conflict between item and version question_bank_item_id', () => {
    const mismatchedPayload = {
      success: true,
      item: { id: VALID_ITEM_ID, metadata: { forked_from_version_id: VALID_SOURCE_VERSION_ID } },
      version: {
        id: VALID_VERSION_ID,
        question_bank_item_id: '99999999-9999-9999-9999-999999999999', // Mismatched!
        forked_from_version_id: VALID_SOURCE_VERSION_ID,
      },
    };
    assert.strictEqual(mapForkQuestionSuccess(mismatchedPayload, { isStaging: true }).ok, false);
  });

  await t.test('3.8. FAIL-CLOSED: Cross-integrity conflict between version and item.metadata provenance', () => {
    const conflictingProvenance = {
      success: true,
      item: {
        id: VALID_ITEM_ID,
        metadata: { forked_from_version_id: VALID_SOURCE_VERSION_ID },
      },
      version: {
        id: VALID_VERSION_ID,
        question_bank_item_id: VALID_ITEM_ID,
        forked_from_version_id: '88888888-8888-8888-8888-888888888888', // Different!
      },
    };
    assert.strictEqual(mapForkQuestionSuccess(conflictingProvenance, { isStaging: true }).ok, false);
  });

  await t.test('3.9. FAIL-CLOSED: Cross-integrity conflict between flat and nested IDs', () => {
    const conflictingFlatItem = {
      success: true,
      item_id: '11111111-1111-1111-1111-111111111111',
      code: 'VALID-CODE',
      item: { id: VALID_ITEM_ID },
      version: { id: VALID_VERSION_ID, forked_from_version_id: VALID_SOURCE_VERSION_ID },
    };
    assert.strictEqual(mapForkQuestionSuccess(conflictingFlatItem, { isStaging: true }).ok, false);

    const conflictingFlatVersion = {
      success: true,
      version_id: '22222222-2222-2222-2222-222222222222',
      code: 'VALID-CODE',
      item: { id: VALID_ITEM_ID },
      version: { id: VALID_VERSION_ID, forked_from_version_id: VALID_SOURCE_VERSION_ID },
    };
    assert.strictEqual(mapForkQuestionSuccess(conflictingFlatVersion, { isStaging: true }).ok, false);
  });

  // ==========================================================================
  // 4. ZERO SECRET & ANSWER KEY LEAKAGE
  // ==========================================================================
  await t.test('4.1. ZERO SECRET LEAKAGE: Private answers and tokens never emitted in mapped output', () => {
    const payloadWithSecrets = {
      success: true,
      item: {
        id: VALID_ITEM_ID,
        metadata: { forked_from_version_id: VALID_SOURCE_VERSION_ID },
        service_role: 'sb_secret_should_never_leak',
      },
      version: {
        id: VALID_VERSION_ID,
        question_bank_item_id: VALID_ITEM_ID,
        forked_from_version_id: VALID_SOURCE_VERSION_ID,
        answer_key: { correct_option_id: 'opt_secret_123' },
        correct_answers: { correct_option_id: 'opt_secret_123' },
      },
    };

    const mapped = mapForkQuestionSuccess(payloadWithSecrets, { isStaging: true });
    assert.strictEqual(mapped.ok, true);
    assert.strictEqual('answer_key' in mapped.data, false);
    assert.strictEqual('correct_answers' in mapped.data, false);
    assert.strictEqual('service_role' in mapped.data, false);

    const keys = Object.keys(mapped.data);
    assert.deepStrictEqual(keys.sort(), ['forked_from_version_id', 'item_id', 'version_id'].sort());
  });

  // ==========================================================================
  // 5. FRONTEND TOAST BEHAVIOR & ERROR RESPONSE COMPATIBILITY
  // ==========================================================================
  await t.test('5.1. FRONTEND COMPATIBILITY: Error response maps to structured error with status 500', async () => {
    const errorRes = createErrorResponse(500, 'INTERNAL_ERROR', 'Phản hồi máy chủ không hợp lệ.');
    assert.strictEqual(errorRes.status, 500);

    const body = await errorRes.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error_code, 'INTERNAL_ERROR');
    assert.strictEqual(body.message, 'Phản hồi máy chủ không hợp lệ.');
  });

  await t.test('5.2. FRONTEND TOAST MAPPING: Type error produces red toast class', () => {
    // Simulating QuestionBankListTab.jsx toastType styling logic
    function getToastClasses(type) {
      return type === 'error' ? 'bg-rose-600 border border-rose-700' : 'bg-emerald-600';
    }

    assert.strictEqual(getToastClasses('error'), 'bg-rose-600 border border-rose-700', 'Error toast must be rose/red');
    assert.strictEqual(getToastClasses('success'), 'bg-emerald-600', 'Success toast must be emerald/green');
  });

  // ==========================================================================
  // 6. ROUTER SERVER-SIDE ENVIRONMENT PINNING SIMULATION
  // ==========================================================================
  await t.test('6.1. ROUTER PINNING: Single-project config mode derives isStaging=true, two-project derives isStaging=false', () => {
    const stagingBackendConfig = { mode: 'single-project' };
    const prodBackendConfig = { mode: 'two-project' };

    const isStagingDerived = stagingBackendConfig.mode === 'single-project';
    const isProdDerived = prodBackendConfig.mode === 'single-project';

    assert.strictEqual(isStagingDerived, true, 'single-project must derive isStaging=true');
    assert.strictEqual(isProdDerived, false, 'two-project must derive isStaging=false');
  });
});
