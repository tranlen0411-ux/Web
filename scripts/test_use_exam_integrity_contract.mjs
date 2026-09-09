// scripts/test_use_exam_integrity_contract.mjs
// Phase 3D Static Thin-Hook Wrapper Contract & Pure Sanitizer Unit Tests (19 Tests: 59..65, 84..95)
// Classified as STATIC_HOOK_WRAPPER / PRODUCTION_SANITIZER

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeIntegrityResult, sanitizeIntegrityError } from '../src/hooks/useExamIntegrity.js';

let testIndex = 58;
function pass(desc) {
  testIndex++;
  console.log(`✅ [${String(testIndex).padStart(2, '0')}] PASS: ${desc}`);
}

const hookPath = path.resolve('src/hooks/useExamIntegrity.js');
const hookSource = fs.readFileSync(hookPath, 'utf8');

console.log('====================================================');
console.log('EXAM BUILDER V1 - PHASE 3D STATIC HOOK CONTRACT TESTS');
console.log('====================================================\n');

// 59 imports production session/coordinator
{
  assert.equal(
    hookSource.includes("from '../services/examIntegrityCoordinator.js'"),
    true,
    'Hook must import createExamIntegrityCoordinator'
  );
  pass('59 hook imports production coordinator module');
}

// 60 does not directly attach duplicate DOM listeners
{
  assert.equal(hookSource.includes('.addEventListener('), false);
  assert.equal(hookSource.includes('.removeEventListener('), false);
  pass('60 hook does not directly attach duplicate DOM listeners');
}

// 61 does not cache token
{
  assert.equal(hookSource.includes('localStorage'), false);
  assert.equal(hookSource.includes('sessionStorage'), false);
  assert.equal(hookSource.includes('setToken'), false);
  assert.equal(hookSource.includes('tokenState'), false);
  pass('61 hook does not cache token in state or storage');
}

// 62 exposes stopIntegrity
{
  assert.equal(hookSource.includes('stopIntegrity,'), true);
  pass('62 hook exports stopIntegrity callback in return object');
}

// 63 exposes safe state only
{
  assert.equal(hookSource.includes('isIntegrityActive,'), true);
  assert.equal(hookSource.includes('lastIntegrityResult,'), true);
  assert.equal(hookSource.includes('lastIntegrityError,'), true);
  assert.equal(hookSource.includes('rawResponse'), false);
  assert.equal(hookSource.includes('sql'), false);
  pass('63 hook exports safe state only (isIntegrityActive, lastIntegrityResult, lastIntegrityError)');
}

// 64 cleanup delegates teardown
{
  assert.equal(hookSource.includes('coordinator.teardown()'), true);
  pass('64 hook cleanup effect delegates teardown to coordinator');
}

// 65 no unsupported source
{
  const forbiddenSources = ['fullscreenchange', 'beforeunload', 'unload', 'pagehide', 'pageshow'];
  for (const src of forbiddenSources) {
    assert.equal(
      hookSource.includes(src),
      false,
      `Hook must not reference forbidden source '${src}'`
    );
  }
  pass('65 hook contains no unsupported or forbidden browser sources');
}

// 84 raw_err_not_forwarded_to_onIntegrityError
{
  assert.equal(hookSource.includes('onErrorRef.current(safeError,'), true);
  assert.equal(hookSource.includes('onErrorRef.current(rawErr,'), false);
  pass('84 raw_err is not forwarded to parent onError callback');
}

// 85 safe_error_forwarded_to_parent_callback
{
  const rawInput = {
    type: 'failed_http',
    safeHttpStatus: 404,
    safeErrorCode: 'ATTEMPT_NOT_FOUND',
    rawMessage: 'Secret SQL syntax error',
    secretToken: 'Bearer 123',
  };
  const sanitized = sanitizeIntegrityError(rawInput);
  assert.deepEqual(sanitized, {
    type: 'failed_http',
    safeHttpStatus: 404,
    safeErrorCode: 'ATTEMPT_NOT_FOUND',
  });
  assert.equal('rawMessage' in sanitized, false);
  assert.equal('secretToken' in sanitized, false);
  pass('85 safe_error is sanitized and forwarded with only type, status, code');
}

// 86 non_http_error_does_not_default_status_500
{
  const preDispatchErr = {
    type: 'failed_pre_dispatch',
    error: { code: 'INVALID_ATTEMPT_ID', message: 'invalid' },
  };
  const sanitizedPre = sanitizeIntegrityError(preDispatchErr);
  assert.equal(sanitizedPre.safeHttpStatus, null);
  assert.equal(sanitizedPre.safeErrorCode, 'INVALID_ATTEMPT_ID');

  const ambiguousErr = {
    type: 'failed_ambiguous',
    error: { code: 'NETWORK_ERROR', message: 'timeout' },
  };
  const sanitizedAmbiguous = sanitizeIntegrityError(ambiguousErr);
  assert.equal(sanitizedAmbiguous.safeHttpStatus, null);
  assert.equal(sanitizedAmbiguous.safeErrorCode, 'NETWORK_ERROR');
  pass('86 non_http_error (pre_dispatch, ambiguous) does not default status to 500 (sets null)');
}

// 87 safe_result_projection_exactly_7_fields
{
  const rawSuccess = {
    attempt_id: 'c0ffee00-1234-4567-89ab-cdef01234567',
    tab_switch_policy: 'WARN_AND_LOG',
    tab_switch_count: 1,
    active_leave_episode_id: null,
    event_recorded: true,
    event_type: 'episode_opened',
    idempotent_replay: false,
    extraUnsafeField: 'should_be_stripped',
    callerId: 'user_123',
  };
  const sanitized = sanitizeIntegrityResult(rawSuccess);
  const keys = Object.keys(sanitized).sort();
  assert.deepEqual(keys, [
    'active_leave_episode_id',
    'attempt_id',
    'event_recorded',
    'event_type',
    'idempotent_replay',
    'tab_switch_count',
    'tab_switch_policy',
  ]);
  assert.equal(Object.keys(sanitized).length, 7);
  pass('87 safe_result projection contains exactly 7 approved fields');
}

// 88 unexpected_success_field_not_forwarded_by_contract
{
  const rawWithExtraneous = {
    attempt_id: 'c0ffee00-1234-4567-89ab-cdef01234567',
    tab_switch_policy: 'WARN_AND_LOG',
    tab_switch_count: 0,
    active_leave_episode_id: null,
    event_recorded: false,
    event_type: null,
    idempotent_replay: true,
    episode_opened: true, // invented field
    episode_closed: false, // invented field
    userToken: 'token',
  };
  const sanitized = sanitizeIntegrityResult(rawWithExtraneous);
  assert.equal('episode_opened' in sanitized, false);
  assert.equal('episode_closed' in sanitized, false);
  assert.equal('userToken' in sanitized, false);
  pass('88 unexpected success fields (including episode_opened/closed as keys) are stripped');
}

// 89 malformed_success_missing_attempt_id_returns_null
{
  const missingAttempt = {
    tab_switch_policy: 'WARN_AND_LOG',
    tab_switch_count: 1,
    active_leave_episode_id: null,
    event_recorded: true,
    event_type: 'episode_opened',
    idempotent_replay: false,
  };
  assert.equal(sanitizeIntegrityResult(missingAttempt), null);

  const emptyAttempt = {
    attempt_id: '',
    tab_switch_policy: 'WARN_AND_LOG',
    tab_switch_count: 1,
    active_leave_episode_id: null,
    event_recorded: true,
    event_type: 'episode_opened',
    idempotent_replay: false,
  };
  assert.equal(sanitizeIntegrityResult(emptyAttempt), null);
  pass('89 malformed_success_missing_attempt_id_returns_null');
}

// 90 malformed_success_string_count_returns_null
{
  const stringCount = {
    attempt_id: 'c0ffee00-1234-4567-89ab-cdef01234567',
    tab_switch_policy: 'WARN_AND_LOG',
    tab_switch_count: '1', // String instead of integer
    active_leave_episode_id: null,
    event_recorded: true,
    event_type: 'episode_opened',
    idempotent_replay: false,
  };
  assert.equal(sanitizeIntegrityResult(stringCount), null);

  const negativeCount = {
    attempt_id: 'c0ffee00-1234-4567-89ab-cdef01234567',
    tab_switch_policy: 'WARN_AND_LOG',
    tab_switch_count: -1, // Negative integer
    active_leave_episode_id: null,
    event_recorded: true,
    event_type: 'episode_opened',
    idempotent_replay: false,
  };
  assert.equal(sanitizeIntegrityResult(negativeCount), null);
  pass('90 malformed_success_string_count_returns_null');
}

// 91 malformed_success_string_false_boolean_returns_null
{
  const stringBool = {
    attempt_id: 'c0ffee00-1234-4567-89ab-cdef01234567',
    tab_switch_policy: 'WARN_AND_LOG',
    tab_switch_count: 0,
    active_leave_episode_id: null,
    event_recorded: 'false', // String instead of boolean
    event_type: null,
    idempotent_replay: false,
  };
  assert.equal(sanitizeIntegrityResult(stringBool), null);
  pass('91 malformed_success_string_false_boolean_returns_null');
}

// 92 malformed_success_invalid_policy_returns_null
{
  const invalidPolicy = {
    attempt_id: 'c0ffee00-1234-4567-89ab-cdef01234567',
    tab_switch_policy: 'STRICT_BLOCK', // Not in OFF | WARN_ONLY | WARN_AND_LOG
    tab_switch_count: 0,
    active_leave_episode_id: null,
    event_recorded: true,
    event_type: null,
    idempotent_replay: false,
  };
  assert.equal(sanitizeIntegrityResult(invalidPolicy), null);
  pass('92 malformed_success_invalid_policy_returns_null');
}

// 93 valid_success_preserves_exact_7_fields
{
  const validPayload = {
    attempt_id: 'c0ffee00-1234-4567-89ab-cdef01234567',
    tab_switch_policy: 'WARN_ONLY',
    tab_switch_count: 3,
    active_leave_episode_id: 'ep-123',
    event_recorded: true,
    event_type: 'episode_closed',
    idempotent_replay: true,
  };
  const result = sanitizeIntegrityResult(validPayload);
  assert.deepEqual(result, validPayload);
  assert.equal(Object.keys(result).length, 7);
  pass('93 valid_success_preserves_exact_7_fields');
}

// 94 invalid_success_not_forwarded_to_parent_callback_contract
{
  // Verify in hook source that handleResult checks safeResult !== null before calling onResult
  assert.equal(
    hookSource.includes('if (safeResult !== null && typeof onResultRef.current ==='),
    true,
    'Hook must check safeResult !== null before calling onResult'
  );
  pass('94 invalid_success_not_forwarded_to_parent_callback_contract');
}

// 95 failed_http_without_status_does_not_fabricate_500
{
  const failedHttpNoStatus = {
    type: 'failed_http',
    // safeHttpStatus omitted
    safeErrorCode: 'ERR_ATTEMPT_EXPIRED',
  };
  const res = sanitizeIntegrityError(failedHttpNoStatus);
  assert.equal(res.safeHttpStatus, null);
  assert.equal(res.safeErrorCode, 'ERR_ATTEMPT_EXPIRED');
  pass('95 failed_http_without_status_does_not_fabricate_500');
}

console.log('\n====================================================');
console.log(`TOTAL STATIC HOOK & SANITIZER TESTS: ${testIndex - 58} | ALL PASSED`);
console.log('====================================================');
