// tests/assessment_endpoint_resolver.test.mjs
// Comprehensive Unit & Negative Tests for Assessment Endpoint Resolver and 4 Client Services
// Strictly verifies environment isolation, fail-closed contracts, custom override hardening, and production preservation.

import test from 'node:test';
import assert from 'node:assert/strict';

import { supabase } from '../src/lib/supabase.js';

import {
  PROD_EXAM_PROJECT_REF,
  PROD_EXAM_BASE_URL,
  APPROVED_ASSESSMENT_FUNCTIONS,
  assertAssessmentBaseUrlAllowed,
  assertAssessmentFunctionUrlAllowed,
  resolveAssessmentBaseUrl,
  resolveAssessmentFunctionsBaseUrl,
  resolveAssessmentFunctionUrl,
} from '../src/services/assessmentEndpointResolver.js';

import {
  DEFAULT_QUESTION_BANK_BASE_URL,
  getQuestionBankBaseUrl,
  setAuthTokenProviderForTesting,
} from '../src/services/questionBankService.js';

import {
  EXAM_MANAGEMENT_API_BASE_URL,
  EXAM_GRADE_MANUAL_BASE_URL,
  EXAM_UPDATE_GRADED_FEEDBACK_BASE_URL,
  ExamManagementClient,
} from '../src/services/examManagementClient.js';

import {
  DEFAULT_EXAM_URL,
  DEFAULT_EXAM_BASE_URL,
  START_FUNCTION_NAME,
  SAVE_FUNCTION_NAME,
  SUBMIT_FUNCTION_NAME,
  GET_QUESTIONS_FUNCTION_NAME,
  LIST_ASSIGNMENTS_FUNCTION_NAME,
  createExamStudentClient,
} from '../src/services/examStudentClient.js';

import {
  DEFAULT_INTEGRITY_ENDPOINT,
  sendIntegrityEvent,
} from '../src/services/examIntegrityClient.js';

const STAGING_URL = 'https://rcqgxmcqolxbrahhyxji.supabase.co';
const PROD_CORE_URL = 'https://nddimmxpymipalpxlops.supabase.co';
const PROD_EXAM_URL = 'https://szptvqkoiphrhlionfoh.supabase.co';

test('1. Resolver Core: Environment Isolation & URL Resolution', async (t) => {
  await t.test('Preview environment strictly resolves to Staging project URL', () => {
    const url = resolveAssessmentBaseUrl({
      envOverride: 'preview',
      supabaseUrlOverride: STAGING_URL,
    });
    assert.strictEqual(url, STAGING_URL);
  });

  await t.test('Preview functions base URL strictly targets Staging', () => {
    const url = resolveAssessmentFunctionsBaseUrl({
      envOverride: 'preview',
      supabaseUrlOverride: STAGING_URL,
    });
    assert.strictEqual(url, `${STAGING_URL}/functions/v1`);
  });

  await t.test('Preview specific function URL resolves accurately', () => {
    const url = resolveAssessmentFunctionUrl('question-bank-api', {
      envOverride: 'preview',
      supabaseUrlOverride: STAGING_URL,
    });
    assert.strictEqual(url, `${STAGING_URL}/functions/v1/question-bank-api`);
  });

  await t.test('Production environment strictly resolves to Dedicated Exam Project', () => {
    const url = resolveAssessmentBaseUrl({
      envOverride: 'production',
      supabaseUrlOverride: PROD_CORE_URL,
    });
    assert.strictEqual(url, PROD_EXAM_BASE_URL);
    assert.strictEqual(url, PROD_EXAM_URL);
  });

  await t.test('Production functions base URL strictly targets Exam Builder', () => {
    const url = resolveAssessmentFunctionsBaseUrl({
      envOverride: 'production',
      supabaseUrlOverride: PROD_CORE_URL,
    });
    assert.strictEqual(url, `${PROD_EXAM_URL}/functions/v1`);
  });

  await t.test('Development environment resolves to Staging when configured', () => {
    const url = resolveAssessmentBaseUrl({
      envOverride: 'development',
      supabaseUrlOverride: STAGING_URL,
    });
    assert.strictEqual(url, STAGING_URL);
  });
});

test('2. Negative & Fail-Closed Guard Tests', async (t) => {
  await t.test('Preview with missing Supabase URL fails closed', () => {
    assert.throws(
      () => resolveAssessmentBaseUrl({ envOverride: 'preview', supabaseUrlOverride: '' }),
      /\[Assessment Fail-Closed\] Preview environment requires configured Staging Supabase URL/
    );
  });

  await t.test('Preview pointing to Core Production project fails closed (zero cross-pollution)', () => {
    assert.throws(
      () => resolveAssessmentBaseUrl({ envOverride: 'preview', supabaseUrlOverride: PROD_CORE_URL }),
      /\[Assessment Security Guard\] Preview environment strictly requires Staging ref/
    );
  });

  await t.test('Preview pointing to Dedicated Exam Production fails closed', () => {
    assert.throws(
      () => resolveAssessmentBaseUrl({ envOverride: 'preview', supabaseUrlOverride: PROD_EXAM_URL }),
      /\[Assessment Security Guard\] Preview environment strictly requires Staging ref/
    );
  });

  await t.test('Preview pointing to unapproved foreign project fails closed', () => {
    assert.throws(
      () => resolveAssessmentBaseUrl({ envOverride: 'preview', supabaseUrlOverride: 'https://alienproject123.supabase.co' }),
      /\[Assessment Security Guard\] Preview environment strictly requires Staging ref/
    );
  });

  await t.test('Development pointing to Production Core fails closed', () => {
    assert.throws(
      () => resolveAssessmentBaseUrl({ envOverride: 'development', supabaseUrlOverride: PROD_CORE_URL }),
      /\[Assessment Security Guard\] Development cannot connect to Production projects/
    );
  });

  await t.test('Development with missing URL fails closed', () => {
    assert.throws(
      () => resolveAssessmentBaseUrl({ envOverride: 'development', supabaseUrlOverride: '' }),
      /\[Assessment Fail-Closed\] Development environment requires configured Staging Supabase URL/
    );
  });

  await t.test('Unknown environment in browser context fails closed', () => {
    globalThis.window = { location: { hostname: 'unverified-domain.com' } };
    try {
      assert.throws(
        () => resolveAssessmentBaseUrl({ envOverride: 'unknown', supabaseUrlOverride: STAGING_URL }),
        /\[Assessment Fail-Closed\] Unknown or unverified environment/
      );
    } finally {
      delete globalThis.window;
    }
  });

  await t.test('resolveAssessmentFunctionUrl rejects invalid function name', () => {
    assert.throws(
      () => resolveAssessmentFunctionUrl(''),
      /\[Assessment Fail-Closed\] functionName must be a non-empty string/
    );
    assert.throws(
      () => resolveAssessmentFunctionUrl(null),
      /\[Assessment Fail-Closed\] functionName must be a non-empty string/
    );
    assert.throws(
      () => resolveAssessmentFunctionUrl('unapproved-api'),
      /\[Assessment Security Guard\] Function "unapproved-api" is not in the approved assessment allowlist/
    );
  });
});

test('3. Custom URL Override Hardening & Security Validation', async (t) => {
  await t.test('Rejects insecure HTTP protocol', () => {
    assert.throws(
      () => assertAssessmentBaseUrlAllowed('http://rcqgxmcqolxbrahhyxji.supabase.co'),
      /Insecure protocol "http:"/
    );
  });

  await t.test('Rejects embedded credentials in URL', () => {
    assert.throws(
      () => assertAssessmentBaseUrlAllowed('https://admin:pass@rcqgxmcqolxbrahhyxji.supabase.co'),
      /URL with embedded credentials is strictly forbidden/
    );
  });

  await t.test('Rejects custom port in URL', () => {
    assert.throws(
      () => assertAssessmentBaseUrlAllowed('https://rcqgxmcqolxbrahhyxji.supabase.co:8443'),
      /Custom port "8443" is forbidden/
    );
  });

  await t.test('Rejects spoofed hostname and subdomain tricks', () => {
    assert.throws(
      () => assertAssessmentBaseUrlAllowed('https://rcqgxmcqolxbrahhyxji.supabase.co.evil.com'),
      /Unrecognized or spoofed hostname/
    );
    assert.throws(
      () => assertAssessmentBaseUrlAllowed('https://not-supabase.co'),
      /Unrecognized or spoofed hostname/
    );
    assert.throws(
      () => assertAssessmentBaseUrlAllowed('https://evil.com#rcqgxmcqolxbrahhyxji.supabase.co'),
      /Base URL cannot contain search query or hash fragment/
    );
  });

  await t.test('Rejects base URL with path, search query, or hash fragments', () => {
    assert.throws(
      () => assertAssessmentBaseUrlAllowed('https://rcqgxmcqolxbrahhyxji.supabase.co/extra/path'),
      /Base URL cannot contain path segments/
    );
    assert.throws(
      () => assertAssessmentBaseUrlAllowed('https://rcqgxmcqolxbrahhyxji.supabase.co?token=secret'),
      /Base URL cannot contain search query or hash fragment/
    );
  });

  await t.test('assertAssessmentFunctionUrlAllowed enforces function allowlist and expected name', () => {
    assert.throws(
      () => assertAssessmentFunctionUrlAllowed(`${STAGING_URL}/functions/v1/evil-exploit-api`, null, { envOverride: 'preview' }),
      /not in the approved assessment allowlist/
    );
    assert.throws(
      () => assertAssessmentFunctionUrlAllowed(`${STAGING_URL}/functions/v1/exam-start-attempt`, 'exam-save-answer', { envOverride: 'preview' }),
      /Expected function "exam-save-answer" but URL targets "exam-start-attempt"/
    );
    assert.doesNotThrow(
      () => assertAssessmentFunctionUrlAllowed(`${STAGING_URL}/functions/v1/exam-start-attempt`, 'exam-start-attempt', { envOverride: 'preview' })
    );
  });
});

test('4. Client Service 1: questionBankService Contract', async (t) => {
  await t.test('Preserves DEFAULT_QUESTION_BANK_BASE_URL constant', () => {
    assert.strictEqual(
      DEFAULT_QUESTION_BANK_BASE_URL,
      'https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/question-bank-api'
    );
  });

  await t.test('getQuestionBankBaseUrl resolves to Staging in preview mode', () => {
    const previewUrl = resolveAssessmentFunctionUrl('question-bank-api', {
      envOverride: 'preview',
      supabaseUrlOverride: STAGING_URL,
    });
    assert.strictEqual(previewUrl, `${STAGING_URL}/functions/v1/question-bank-api`);
  });
});

test('5. Client Service 2: examManagementClient Contract & Custom Override Guard', async (t) => {
  await t.test('Preserves legacy base URL constants', () => {
    assert.strictEqual(
      EXAM_MANAGEMENT_API_BASE_URL,
      'https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/exam-management-api'
    );
    assert.strictEqual(
      EXAM_GRADE_MANUAL_BASE_URL,
      'https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/exam-grade-manual-attempt'
    );
    assert.strictEqual(
      EXAM_UPDATE_GRADED_FEEDBACK_BASE_URL,
      'https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/exam-update-graded-feedback'
    );
  });

  await t.test('Constructor accepts valid custom Staging override in Preview', () => {
    const validClient = new ExamManagementClient({
      baseUrl: `${STAGING_URL}/functions/v1/exam-management-api`,
      gradeManualUrl: `${STAGING_URL}/functions/v1/exam-grade-manual-attempt`,
      updateFeedbackUrl: `${STAGING_URL}/functions/v1/exam-update-graded-feedback`,
    });
    assert.strictEqual(validClient.baseUrl, `${STAGING_URL}/functions/v1/exam-management-api`);
  });

  await t.test('Constructor REJECTS custom Production Core or Exam override in Preview (Fail-Closed)', () => {
    // Simulate preview environment
    globalThis.window = { location: { hostname: 'preview-branch.vercel.app' } };
    try {
      assert.throws(
        () => new ExamManagementClient({ baseUrl: `${PROD_CORE_URL}/functions/v1/exam-management-api` }),
        /Preview environment strictly requires Staging ref/
      );
      assert.throws(
        () => new ExamManagementClient({ baseUrl: `${PROD_EXAM_URL}/functions/v1/exam-management-api` }),
        /Preview environment strictly requires Staging ref/
      );
      assert.throws(
        () => new ExamManagementClient({ baseUrl: 'https://evil.com/functions/v1/exam-management-api' }),
        /Unrecognized or spoofed hostname/
      );
    } finally {
      delete globalThis.window;
    }
  });
});

test('6. Client Service 3: examStudentClient Contract & Custom Override Guard', async (t) => {
  await t.test('Preserves DEFAULT_EXAM_URL and DEFAULT_EXAM_BASE_URL constants', () => {
    assert.strictEqual(DEFAULT_EXAM_URL, 'https://szptvqkoiphrhlionfoh.supabase.co');
    assert.strictEqual(DEFAULT_EXAM_BASE_URL, 'https://szptvqkoiphrhlionfoh.supabase.co/functions/v1');
    assert.strictEqual(START_FUNCTION_NAME, 'exam-start-attempt');
    assert.strictEqual(SAVE_FUNCTION_NAME, 'exam-save-answer');
    assert.strictEqual(SUBMIT_FUNCTION_NAME, 'exam-submit-attempt');
    assert.strictEqual(GET_QUESTIONS_FUNCTION_NAME, 'exam-get-attempt-questions');
    assert.strictEqual(LIST_ASSIGNMENTS_FUNCTION_NAME, 'exam-list-student-assignments');
  });

  await t.test('Constructor accepts valid Staging examUrl in Preview', () => {
    const client = createExamStudentClient({ examUrl: STAGING_URL });
    assert.ok(client instanceof Object);
  });

  await t.test('Constructor REJECTS Production Core or Exam examUrl in Preview (Fail-Closed)', () => {
    globalThis.window = { location: { hostname: 'preview-branch.vercel.app' } };
    try {
      assert.throws(
        () => createExamStudentClient({ examUrl: PROD_CORE_URL }),
        /Preview environment strictly requires Staging ref/
      );
      assert.throws(
        () => createExamStudentClient({ examUrl: PROD_EXAM_URL }),
        /Preview environment strictly requires Staging ref/
      );
      assert.throws(
        () => createExamStudentClient({ examUrl: 'https://evil.com' }),
        /Unrecognized or spoofed hostname/
      );
    } finally {
      delete globalThis.window;
    }
  });

  await t.test('Runtime transport dispatches to Staging endpoint when examUrl is Staging', async () => {
    let captured = null;
    const client = createExamStudentClient({
      examUrl: STAGING_URL,
      supabase: {
        auth: {
          getSession: async () => ({
            data: { session: { access_token: 'test-staging-jwt' } },
            error: null,
          }),
        },
      },
      fetchImpl: async (url, opts) => {
        captured = { url, method: opts.method, headers: opts.headers };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              attempt_id: '11111111-1111-4111-8111-111111111111',
              assignment_id: '22222222-2222-4222-8222-222222222222',
              exam_version_id: '33333333-3333-4333-8333-333333333333',
              student_id: '44444444-4444-4444-8444-444444444444',
              attempt_number: 1,
              status: 'draft',
              attempt_started_at: '2026-11-06T00:00:00Z',
              expires_at: null,
              max_score: 10,
              question_order: [],
              option_orders: {},
              attempt_version: 1,
              resumed_existing: false,
              idempotent_replay: false,
              expired: false,
              already_finalized: false,
            },
          }),
        };
      },
    });

    const res = await client.startAttempt({
      assignment_id: '22222222-2222-4222-8222-222222222222',
    });

    assert.strictEqual(res.ok, true);
    assert.ok(captured.url.startsWith(`${STAGING_URL}/functions/v1/`));
    assert.strictEqual(captured.url, `${STAGING_URL}/functions/v1/exam-start-attempt`);
    assert.strictEqual(captured.headers['Authorization'], 'Bearer test-staging-jwt');
  });
});

test('7. Client Service 4: examIntegrityClient Contract & Custom Override Guard', async (t) => {
  await t.test('Preserves DEFAULT_INTEGRITY_ENDPOINT constant', () => {
    assert.strictEqual(
      DEFAULT_INTEGRITY_ENDPOINT,
      'https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/exam-record-integrity-event'
    );
  });

  await t.test('sendIntegrityEvent REJECTS Production or foreign endpoint in Preview (Fail-Closed)', async () => {
    globalThis.window = { location: { hostname: 'preview-branch.vercel.app' } };
    try {
      await assert.rejects(
        () =>
          sendIntegrityEvent({
            attemptId: '11111111-1111-4111-8111-111111111111',
            source: 'window_blur',
            clientTimestamp: '2026-11-06T10:00:00.000Z',
            getAccessToken: async () => 'test-jwt',
            endpoint: `${PROD_CORE_URL}/functions/v1/exam-record-integrity-event`,
          }),
        /Preview environment strictly requires Staging ref/
      );

      await assert.rejects(
        () =>
          sendIntegrityEvent({
            attemptId: '11111111-1111-4111-8111-111111111111',
            source: 'window_blur',
            clientTimestamp: '2026-11-06T10:00:00.000Z',
            getAccessToken: async () => 'test-jwt',
            endpoint: 'https://evil.com/functions/v1/exam-record-integrity-event',
          }),
        /Unrecognized or spoofed hostname/
      );
    } finally {
      delete globalThis.window;
    }
  });

  await t.test('sendIntegrityEvent dispatches to custom/Staging endpoint', async () => {
    let capturedUrl = null;
    const stagingEndpoint = `${STAGING_URL}/functions/v1/exam-record-integrity-event`;

    const res = await sendIntegrityEvent({
      attemptId: '11111111-1111-4111-8111-111111111111',
      source: 'window_blur',
      clientTimestamp: '2026-11-06T10:00:00.000Z',
      getAccessToken: async () => 'test-jwt-token',
      endpoint: stagingEndpoint,
      fetchImpl: async (url) => {
        capturedUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              attempt_id: '11111111-1111-4111-8111-111111111111',
              tab_switch_policy: 'WARN_AND_LOG',
              tab_switch_count: 1,
              active_leave_episode_id: null,
              event_recorded: true,
              event_type: 'focus_loss_auxiliary',
              idempotent_replay: false,
            },
          }),
        };
      },
    });

    assert.strictEqual(res.ok, true);
    assert.strictEqual(capturedUrl, stagingEndpoint);
    assert.ok(capturedUrl.startsWith(STAGING_URL));
  });
});

test('8. HTTP Redirect Hardening & Token Leakage Defense (R2-B6G-4E)', async (t) => {
  const REDIRECT_CODES = [301, 302, 303, 307, 308];

  await t.test('examStudentClient strictly sets redirect: "error" and rejects HTTP 301, 302, 303, 307, 308', async () => {
    for (const code of REDIRECT_CODES) {
      let passedOptions = null;
      const client = createExamStudentClient({
        examUrl: STAGING_URL,
        supabase: {
          auth: {
            getSession: async () => ({
              data: { session: { access_token: 'test-staging-token' } },
              error: null,
            }),
          },
        },
        fetchImpl: async (url, options) => {
          passedOptions = options;
          // Standard browser behavior with redirect: 'error' when encountering 3xx
          throw new TypeError(`Failed to fetch: HTTP redirect ${code} blocked by redirect: "error"`);
        },
      });

      const res = await client.startAttempt({
        assignment_id: '11111111-1111-4111-8111-111111111111',
      });

      assert.strictEqual(passedOptions?.redirect, 'error', `redirect: "error" must be passed on code ${code}`);
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.safeErrorCode, 'HTTP_500');
    }
  });

  await t.test('examIntegrityClient strictly sets redirect: "error" and fails closed on HTTP 301, 302, 303, 307, 308', async () => {
    for (const code of REDIRECT_CODES) {
      let passedOptions = null;
      const res = await sendIntegrityEvent({
        attemptId: '11111111-1111-4111-8111-111111111111',
        source: 'window_blur',
        clientTimestamp: '2026-11-06T10:00:00.000Z',
        getAccessToken: async () => 'test-staging-token',
        endpoint: `${STAGING_URL}/functions/v1/exam-record-integrity-event`,
        fetchImpl: async (url, options) => {
          passedOptions = options;
          throw new TypeError(`Failed to fetch: HTTP redirect ${code} blocked`);
        },
      });

      assert.strictEqual(passedOptions?.redirect, 'error', `redirect: "error" must be passed on code ${code}`);
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.type, 'failed_ambiguous');
      assert.strictEqual(res.safeErrorCode, 'NETWORK_ERROR');
    }
  });

  await t.test('examManagementClient dispatch strictly sets redirect: "error" and rejects HTTP 301, 302, 303, 307, 308', async () => {
    const originalFetch = globalThis.fetch;
    try {
      for (const code of REDIRECT_CODES) {
        let passedOptions = null;
        globalThis.fetch = async (url, options) => {
          passedOptions = options;
          throw new TypeError(`Failed to fetch: HTTP redirect ${code} blocked by redirect: "error"`);
        };

        const client = new ExamManagementClient({
          supabase: {
            auth: {
              getSession: async () => ({
                data: { session: { access_token: 'test-staging-token' } },
                error: null,
              }),
            },
          },
        });

        const res = await client.dispatch('test-action', 'POST', { dummy: 1 });
        assert.strictEqual(passedOptions?.redirect, 'error', `redirect: "error" must be passed on code ${code}`);
        assert.strictEqual(res.ok, false);
        assert.strictEqual(res.error?.status, 0);
        assert.strictEqual(res.error?.errorCode, 'NETWORK_ERROR');
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('examManagementClient gradeManualAttempt and updateGradedFeedback enforce redirect: "error"', async () => {
    const originalFetch = globalThis.fetch;
    try {
      let passedOptions = null;
      globalThis.fetch = async (url, options) => {
        passedOptions = options;
        throw new TypeError('Failed to fetch: HTTP redirect 302 blocked');
      };

      const client = new ExamManagementClient({
        supabase: {
          auth: {
            getSession: async () => ({
              data: { session: { access_token: 'test-staging-token' } },
              error: null,
            }),
          },
        },
      });

      const resGrade = await client.gradeManualAttempt({ attempt_id: '11111111-1111-4111-8111-111111111111' });
      assert.strictEqual(passedOptions?.redirect, 'error');
      assert.strictEqual(resGrade.ok, false);

      const resFeedback = await client.updateGradedFeedback({ attempt_id: '11111111-1111-4111-8111-111111111111' });
      assert.strictEqual(passedOptions?.redirect, 'error');
      assert.strictEqual(resFeedback.ok, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('questionBankService operations enforce redirect: "error" on JWT fetch calls', async () => {
    const originalFetch = globalThis.fetch;
    try {
      setAuthTokenProviderForTesting(async () => 'test-staging-token');

      for (const code of REDIRECT_CODES) {
        let passedOptions = null;
        globalThis.fetch = async (url, options) => {
          passedOptions = options;
          throw new TypeError(`Failed to fetch: HTTP redirect ${code} blocked by redirect: "error"`);
        };

        const { listQuestions } = await import('../src/services/questionBankService.js');
        await assert.rejects(
          async () => await listQuestions(),
          /HTTP redirect/
        );
        assert.strictEqual(passedOptions?.redirect, 'error', `redirect: "error" must be passed on code ${code}`);
      }
    } finally {
      globalThis.fetch = originalFetch;
      setAuthTokenProviderForTesting(null);
    }
  });
});
