// src/services/assessmentEndpointResolver.js
// Environment-Aware Endpoint Resolver & URL Security Guard for Question Bank & Exam Builder BFF Services
// Strictly enforces environment isolation, fail-closed security, and prevents cross-project JWT pollution.

import {
  detectEnvironment,
  extractProjectRef,
  supabaseUrl,
  STAGING_PROJECT_REF,
  PROD_PROJECT_REF,
} from '../lib/supabase.js';

export const PROD_EXAM_PROJECT_REF = 'szptvqkoiphrhlionfoh';
export const PROD_EXAM_BASE_URL = 'https://szptvqkoiphrhlionfoh.supabase.co';

export const APPROVED_ASSESSMENT_FUNCTIONS = Object.freeze(
  new Set([
    'question-bank-api',
    'exam-management-api',
    'exam-grade-manual-attempt',
    'exam-update-graded-feedback',
    'exam-record-integrity-event',
    'exam-start-attempt',
    'exam-save-answer',
    'exam-submit-attempt',
    'exam-get-attempt-questions',
    'exam-list-student-assignments',
    'exam-get-student-attempt-result',
  ])
);

/**
 * Validates any Assessment Base URL (e.g., https://<ref>.supabase.co) using standard URL parser.
 * Strictly enforces environment isolation and blocks foreign/spoofed/insecure endpoints.
 *
 * @param {string} rawUrl
 * @param {Object} [options]
 * @param {string} [options.envOverride] For isolated testing
 * @returns {string} Sanitized base URL (e.g. 'https://rcqgxmcqolxbrahhyxji.supabase.co')
 */
export function assertAssessmentBaseUrlAllowed(rawUrl, options = {}) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('[Assessment Security Guard] Base URL must be a non-empty string.');
  }

  const trimmed = rawUrl.trim();
  if (trimmed.includes('"') || trimmed.includes("'")) {
    throw new Error('[Assessment Security Guard] URL contains forbidden quotes.');
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('[Assessment Security Guard] Invalid or malformed URL syntax.');
  }

  // 1. Strict Protocol: HTTPS only
  if (parsed.protocol !== 'https:') {
    throw new Error(`[Assessment Security Guard] Insecure protocol "${parsed.protocol}". Only HTTPS is allowed.`);
  }

  // 2. Strict Credentials Ban: No username or password
  if (parsed.username || parsed.password) {
    throw new Error('[Assessment Security Guard] URL with embedded credentials is strictly forbidden.');
  }

  // 3. Strict Port Ban: Only default 443 (or empty)
  if (parsed.port && parsed.port !== '443') {
    throw new Error(`[Assessment Security Guard] Custom port "${parsed.port}" is forbidden.`);
  }

  // 4. Strict Base Path & Query/Hash Ban
  if (parsed.search || parsed.hash) {
    throw new Error('[Assessment Security Guard] Base URL cannot contain search query or hash fragment.');
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error(`[Assessment Security Guard] Base URL cannot contain path segments: "${parsed.pathname}".`);
  }

  // 5. Hostname parsing: Must strictly match <project-ref>.supabase.co
  const match = parsed.hostname.match(/^([a-z0-9]+)\.supabase\.co$/i);
  if (!match) {
    throw new Error(`[Assessment Security Guard] Unrecognized or spoofed hostname: "${parsed.hostname}". Must match strictly <ref>.supabase.co.`);
  }
  const detectedRef = match[1].toLowerCase();

  // 6. Environment Enforcement
  const env = options.envOverride || detectEnvironment();

  if (env === 'preview') {
    if (detectedRef !== STAGING_PROJECT_REF) {
      throw new Error(`[Assessment Security Guard] Preview environment strictly requires Staging ref (${STAGING_PROJECT_REF}). Detected: ${detectedRef}.`);
    }
  } else if (env === 'production') {
    if (detectedRef === PROD_PROJECT_REF || detectedRef === STAGING_PROJECT_REF) {
      throw new Error(`[Assessment Security Guard] Production assessment endpoint cannot point to Core Prod (${PROD_PROJECT_REF}) or Staging (${STAGING_PROJECT_REF}).`);
    }
    if (detectedRef !== PROD_EXAM_PROJECT_REF) {
      throw new Error(`[Assessment Security Guard] Production assessment endpoint must be ${PROD_EXAM_PROJECT_REF}. Detected: ${detectedRef}.`);
    }
  } else if (env === 'development') {
    if (detectedRef === PROD_PROJECT_REF || detectedRef === PROD_EXAM_PROJECT_REF) {
      throw new Error(`[Assessment Security Guard] Development cannot connect to Production projects (${detectedRef}).`);
    }
    if (detectedRef !== STAGING_PROJECT_REF) {
      throw new Error(`[Assessment Security Guard] Development environment must use Staging ref (${STAGING_PROJECT_REF}). Detected: ${detectedRef}.`);
    }
  } else {
    // Unknown environment
    if (typeof window !== 'undefined') {
      throw new Error(`[Assessment Security Guard] Unknown or unverified browser environment (${env}). Fail-closed.`);
    }
    // In Node offline test harness without window, allow approved refs
    if (detectedRef !== PROD_EXAM_PROJECT_REF && detectedRef !== STAGING_PROJECT_REF) {
      throw new Error(`[Assessment Security Guard] Unknown environment must strictly use approved ref. Detected: ${detectedRef}.`);
    }
  }

  return `https://${parsed.hostname}`;
}

/**
 * Validates a full Function endpoint URL (e.g. https://<ref>.supabase.co/functions/v1/<fn>)
 * Enforces protocol, hostname, credentials ban, and approved function name path.
 *
 * @param {string} rawUrl
 * @param {string} [expectedFunctionName]
 * @param {Object} [options]
 * @returns {string} Sanitized full function endpoint URL
 */
export function assertAssessmentFunctionUrlAllowed(rawUrl, expectedFunctionName = null, options = {}) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('[Assessment Security Guard] Function URL must be a non-empty string.');
  }

  const trimmed = rawUrl.trim();
  if (trimmed.includes('"') || trimmed.includes("'")) {
    throw new Error('[Assessment Security Guard] URL contains forbidden quotes.');
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('[Assessment Security Guard] Invalid or malformed URL syntax.');
  }

  // 1. Validate Base URL portion (protocol, credentials, port, hostname, environment)
  const baseUrl = `https://${parsed.hostname}`;
  assertAssessmentBaseUrlAllowed(baseUrl, options);

  // 2. Disallow search query and hash fragments
  if (parsed.search || parsed.hash) {
    throw new Error('[Assessment Security Guard] Function URL cannot contain search query or hash fragment.');
  }

  // 3. Path must start strictly with /functions/v1/<approved-function>
  const cleanPath = parsed.pathname.replace(/\/+$/, '');
  const pathMatch = cleanPath.match(/^\/functions\/v1\/([a-zA-Z0-9_-]+)$/);
  if (!pathMatch) {
    throw new Error(`[Assessment Security Guard] Invalid function path: "${parsed.pathname}". Must match strictly /functions/v1/<function-name>.`);
  }

  const functionName = pathMatch[1];
  if (!APPROVED_ASSESSMENT_FUNCTIONS.has(functionName)) {
    throw new Error(`[Assessment Security Guard] Function "${functionName}" is not in the approved assessment allowlist.`);
  }

  if (expectedFunctionName && functionName !== expectedFunctionName) {
    throw new Error(`[Assessment Security Guard] Expected function "${expectedFunctionName}" but URL targets "${functionName}".`);
  }

  return `${baseUrl}${cleanPath}`;
}

/**
 * Resolves the Assessment / Exam / Question Bank Base Supabase URL (e.g., https://<ref>.supabase.co)
 * @param {Object} [options]
 * @returns {string} Clean base URL without trailing slash
 */
export function resolveAssessmentBaseUrl(options = {}) {
  const env = options.envOverride || detectEnvironment();
  const rawCurrentUrl = options.supabaseUrlOverride !== undefined ? options.supabaseUrlOverride : supabaseUrl;
  const currentUrl = typeof rawCurrentUrl === 'string' ? rawCurrentUrl.trim().replace(/\/$/, '') : '';

  // 1. Production Environment
  if (env === 'production') {
    const customProdUrl =
      typeof import.meta !== 'undefined' && import.meta?.env?.VITE_EXAM_SUPABASE_URL
        ? String(import.meta.env.VITE_EXAM_SUPABASE_URL).trim().replace(/\/$/, '')
        : '';

    if (customProdUrl) {
      try {
        return assertAssessmentBaseUrlAllowed(customProdUrl, { envOverride: 'production' });
      } catch {
        return PROD_EXAM_BASE_URL;
      }
    }

    return PROD_EXAM_BASE_URL;
  }

  // 2. Preview Environment (Staging)
  if (env === 'preview') {
    if (!currentUrl) {
      throw new Error('[Assessment Fail-Closed] Preview environment requires configured Staging Supabase URL.');
    }
    return assertAssessmentBaseUrlAllowed(currentUrl, { envOverride: 'preview' });
  }

  // 3. Development Environment
  if (env === 'development') {
    if (!currentUrl) {
      throw new Error('[Assessment Fail-Closed] Development environment requires configured Staging Supabase URL.');
    }
    return assertAssessmentBaseUrlAllowed(currentUrl, { envOverride: 'development' });
  }

  // 4. Test / Node Offline runner compatibility
  if (env === 'unknown' && typeof window === 'undefined') {
    return PROD_EXAM_BASE_URL;
  }

  // 5. Unknown or Unverified Environment -> Fail-Closed
  throw new Error(`[Assessment Fail-Closed] Unknown or unverified environment (${env}). Cannot resolve assessment endpoint.`);
}

/**
 * Resolves the Functions v1 base endpoint (e.g., https://<ref>.supabase.co/functions/v1)
 * @param {Object} [options]
 * @returns {string}
 */
export function resolveAssessmentFunctionsBaseUrl(options = {}) {
  const baseUrl = resolveAssessmentBaseUrl(options);
  return `${baseUrl}/functions/v1`;
}

/**
 * Resolves full endpoint for a specific Edge Function
 * @param {string} functionName
 * @param {Object} [options]
 * @returns {string}
 */
export function resolveAssessmentFunctionUrl(functionName, options = {}) {
  if (!functionName || typeof functionName !== 'string') {
    throw new Error('[Assessment Fail-Closed] functionName must be a non-empty string.');
  }
  const cleanFn = functionName.trim().replace(/^\//, '');
  if (!APPROVED_ASSESSMENT_FUNCTIONS.has(cleanFn)) {
    throw new Error(`[Assessment Security Guard] Function "${cleanFn}" is not in the approved assessment allowlist.`);
  }
  return `${resolveAssessmentFunctionsBaseUrl(options)}/${cleanFn}`;
}
