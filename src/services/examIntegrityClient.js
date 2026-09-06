// src/services/examIntegrityClient.js
// Exam Builder V1 - Phase 3C Frontend Integrity Event HTTP Transport Helper
// Strictly implements single-request dispatch, token resolution at send time, and failure classification.

export const ALLOWED_INTEGRITY_SOURCES = Object.freeze(
  new Set(['page_hidden', 'page_visible', 'window_blur', 'window_focus'])
);

export const DEFAULT_INTEGRITY_ENDPOINT =
  'https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/exam-record-integrity-event';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SAFE_SUCCESS_FIELDS = Object.freeze([
  'attempt_id',
  'tab_switch_policy',
  'tab_switch_count',
  'active_leave_episode_id',
  'event_recorded',
  'event_type',
  'idempotent_replay',
]);

/**
 * Sanitizes server response to strictly 7 allowed safe projection fields.
 */
export function sanitizeSuccessResponse(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const payload = raw.data && typeof raw.data === 'object' ? raw.data : raw;

  return {
    attempt_id: typeof payload.attempt_id === 'string' ? payload.attempt_id : '',
    tab_switch_policy: typeof payload.tab_switch_policy === 'string' ? payload.tab_switch_policy : '',
    tab_switch_count: typeof payload.tab_switch_count === 'number' ? payload.tab_switch_count : 0,
    active_leave_episode_id:
      typeof payload.active_leave_episode_id === 'string' ? payload.active_leave_episode_id : null,
    event_recorded: Boolean(payload.event_recorded),
    event_type: typeof payload.event_type === 'string' ? payload.event_type : null,
    idempotent_replay: Boolean(payload.idempotent_replay),
  };
}

/**
 * Extracts sanitized error code and status from HTTP response.
 * Never leaks raw response bodies, SQL statements, or headers.
 */
export async function extractSafeHttpError(response) {
  const status = response.status || 500;
  let safeErrorCode = `HTTP_${status}`;

  try {
    const json = await response.json();
    if (json && typeof json === 'object') {
      if (typeof json.error_code === 'string' && json.error_code.trim()) {
        safeErrorCode = json.error_code.trim();
      } else if (typeof json.errorCode === 'string' && json.errorCode.trim()) {
        safeErrorCode = json.errorCode.trim();
      }
    }
  } catch (_) {
    // Non-JSON or unparseable response body: fallback to HTTP_${status}
  }

  return {
    safeHttpStatus: status,
    safeErrorCode,
  };
}

/**
 * Sends a single integrity event via HTTP POST to the Exam BFF endpoint.
 *
 * @param {Object} options
 * @param {string} options.attemptId
 * @param {string} options.source
 * @param {string} options.clientTimestamp
 * @param {Function} options.getAccessToken - Function returning current CORE JWT access token
 * @param {Function} [options.fetchImpl] - Optional custom fetch implementation (for test mocking)
 * @param {string} [options.endpoint] - Optional custom endpoint URL
 * @returns {Promise<Object>} Result object with status classification:
 *   - succeeded: { ok: true, type: 'succeeded', safeHttpStatus: 200, data }
 *   - failed_pre_dispatch: { ok: false, type: 'failed_pre_dispatch', error: { code, message } }
 *   - failed_ambiguous: { ok: false, type: 'failed_ambiguous', error: { code, message } }
 *   - failed_http: { ok: false, type: 'failed_http', safeHttpStatus, safeErrorCode }
 */
export async function sendIntegrityEvent({
  attemptId,
  source,
  clientTimestamp,
  getAccessToken,
  fetchImpl,
  endpoint = DEFAULT_INTEGRITY_ENDPOINT,
}) {
  // 1. Synchronous Pre-Dispatch Validation
  if (!attemptId || typeof attemptId !== 'string' || !UUID_REGEX.test(attemptId)) {
    return {
      ok: false,
      type: 'failed_pre_dispatch',
      error: {
        code: 'INVALID_ATTEMPT_ID',
        message: 'Mã lượt thi attemptId không hợp lệ (phải là UUID chuẩn).',
      },
    };
  }

  if (!source || typeof source !== 'string' || !ALLOWED_INTEGRITY_SOURCES.has(source)) {
    return {
      ok: false,
      type: 'failed_pre_dispatch',
      error: {
        code: 'INVALID_EVENT_SOURCE',
        message: `Nguồn sự kiện '${source}' không hợp lệ.`,
      },
    };
  }

  if (!clientTimestamp || typeof clientTimestamp !== 'string' || Number.isNaN(Date.parse(clientTimestamp))) {
    return {
      ok: false,
      type: 'failed_pre_dispatch',
      error: {
        code: 'INVALID_TIMESTAMP',
        message: 'Thời gian clientTimestamp không hợp lệ (phải là chuẩn ISO-8601).',
      },
    };
  }

  if (typeof getAccessToken !== 'function') {
    return {
      ok: false,
      type: 'failed_pre_dispatch',
      error: {
        code: 'MISSING_TOKEN_RESOLVER',
        message: 'Hàm lấy token xác thực getAccessToken không được cung cấp.',
      },
    };
  }

  // 2. Resolve token dynamically at dispatch time
  let token = null;
  try {
    token = await getAccessToken();
  } catch (err) {
    return {
      ok: false,
      type: 'failed_pre_dispatch',
      error: {
        code: 'TOKEN_RESOLUTION_ERROR',
        message: err?.message || 'Không thể lấy token xác thực phiên đăng nhập.',
      },
    };
  }

  if (!token || typeof token !== 'string' || !token.trim()) {
    return {
      ok: false,
      type: 'failed_pre_dispatch',
      error: {
        code: 'AUTH_REQUIRED',
        message: 'Không tìm thấy token xác thực hợp lệ.',
      },
    };
  }

  // 3. Construct exact payload (NO sequence, student_id, caller_id, or extraneous fields)
  const payload = {
    attempt_id: attemptId.toLowerCase(),
    source,
    client_timestamp: clientTimestamp,
  };

  const headers = {
    Authorization: `Bearer ${token.trim()}`,
    'Content-Type': 'application/json',
  };

  const executeFetch = fetchImpl || globalThis.fetch;
  if (typeof executeFetch !== 'function') {
    return {
      ok: false,
      type: 'failed_pre_dispatch',
      error: {
        code: 'FETCH_UNAVAILABLE',
        message: 'Trình duyệt không hỗ trợ Fetch API.',
      },
    };
  }

  // 4. Execute Network Request (Protected with failure classification)
  let response;
  try {
    response = await executeFetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // Network error, TypeError, AbortError, or socket reset after dispatch
    return {
      ok: false,
      type: 'failed_ambiguous',
      error: {
        code: 'NETWORK_ERROR',
        message: err?.message || 'Lỗi mạng không xác định khi gửi sự kiện giám thị.',
      },
    };
  }

  // 5. Handle HTTP Response
  if (!response.ok) {
    const { safeHttpStatus, safeErrorCode } = await extractSafeHttpError(response);
    return {
      ok: false,
      type: 'failed_http',
      safeHttpStatus,
      safeErrorCode,
    };
  }

  // 6. Handle HTTP 200 Success
  let rawJson;
  try {
    rawJson = await response.json();
  } catch (_) {
    return {
      ok: false,
      type: 'failed_http',
      safeHttpStatus: response.status,
      safeErrorCode: 'INVALID_JSON_RESPONSE',
    };
  }

  const sanitizedData = sanitizeSuccessResponse(rawJson);
  if (!sanitizedData) {
    return {
      ok: false,
      type: 'failed_http',
      safeHttpStatus: response.status,
      safeErrorCode: 'INVALID_RESPONSE_PAYLOAD',
    };
  }

  return {
    ok: true,
    type: 'succeeded',
    safeHttpStatus: 200,
    data: sanitizedData,
  };
}
