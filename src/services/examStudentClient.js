async function getDefaultSupabaseClient() {
  try {
    const mod = await import('../lib/supabase.js');
    return mod.supabase;
  } catch (_) {
    return null;
  }
}

export const DEFAULT_EXAM_URL = 'https://szptvqkoiphrhlionfoh.supabase.co';
export const DEFAULT_EXAM_BASE_URL = `${DEFAULT_EXAM_URL}/functions/v1`;

export const START_FUNCTION_NAME = 'exam-start-attempt';
export const SAVE_FUNCTION_NAME = 'exam-save-answer';
export const SUBMIT_FUNCTION_NAME = 'exam-submit-attempt';
export const GET_QUESTIONS_FUNCTION_NAME = 'exam-get-attempt-questions';
export const LIST_ASSIGNMENTS_FUNCTION_NAME = 'exam-list-student-assignments';

export const ALLOWED_QUESTION_TYPES = Object.freeze([
  'single_choice',
  'multiple_choice',
  'fill_blank',
  'short_answer',
  'essay',
  'image_upload',
  'file_upload',
]);
const ALLOWED_QUESTION_TYPES_SET = new Set(ALLOWED_QUESTION_TYPES);

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(val) {
  return typeof val === 'string' && UUID_REGEX.test(val.trim());
}

export function generateProvisionalAttemptId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Pure JS RFC4122 v4 UUID fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Finite allowlist of safe student application and BFF error codes
const SAFE_STUDENT_ERROR_CODES = Object.freeze(
  new Set([
    'AUTH_REQUIRED',
    'INVALID_TOKEN',
    'FORBIDDEN_ROLE',
    'ACCOUNT_DISABLED',
    'INVALID_INPUT',
    'INVALID_REQUEST_FIELD',
    'ATTEMPT_NOT_FOUND',
    'CLASS_ACCESS_DENIED',
    'ERR_REQUIRED_PARAMS',
    'ERR_VERSION_NOT_PUBLISHED',
    'ERR_EXAM_NOT_STARTED',
    'ERR_EXAM_CLOSED',
    'ERR_EXAM_ARCHIVED',
    'ERR_ATTEMPT_EXPIRED',
    'ERR_ATTEMPT_ALREADY_FINALIZED',
    'ERR_ATTEMPT_ALREADY_GRADED',
    'ERR_OPTIMISTIC_LOCK_CONFLICT',
    'ERR_INVALID_ANSWER_PAYLOAD',
    'ERR_INVALID_OPTION_KEY',
    'ERR_FILE_URL_NOT_ALLOWED',
    'ERR_ANSWER_PAYLOAD_NOT_ALLOWED',
    'ERR_FILE_URL_REQUIRED',
    'ERR_EXAM_UPLOAD_NOT_READY',
    'ERR_UNKNOWN_QUESTION_TYPE',
    'ERR_QUESTION_VERSION_MISMATCH',
    'ERR_IDEMPOTENCY_CONFLICT',
    'ERR_DUPLICATE_OPTION_KEYS',
    'ERR_INVALID_TOTAL_POINTS',
    'INVALID_RESPONSE_PAYLOAD',
    'ATTEMPT_NOT_STARTED',
    'INVALID_VERSION_STATE',
    'INTERNAL_ERROR',
  ])
);

// Strict finite allowlist of approved public question-fetch error codes ONLY
export const SAFE_GET_ATTEMPT_QUESTIONS_ERROR_CODES = Object.freeze(
  new Set([
    'AUTH_REQUIRED',
    'INVALID_TOKEN',
    'FORBIDDEN_ROLE',
    'ACCOUNT_DISABLED',
    'INVALID_INPUT',
    'INVALID_REQUEST_FIELD',
    'ATTEMPT_NOT_FOUND',
    'CLASS_ACCESS_DENIED',
    'ERR_ATTEMPT_ALREADY_FINALIZED',
    'ERR_ATTEMPT_EXPIRED',
    'INTERNAL_ERROR',
  ])
);

/**
 * Validates strictly 16 approved start response projection fields inside { success: true, data: {...} } envelope (Fail-Closed).
 */
export function validateStartResponse(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.success !== true) {
    return null;
  }
  if (!raw.data || typeof raw.data !== 'object' || Array.isArray(raw.data)) {
    return null;
  }
  const payload = raw.data;

  if (
    !isValidUuid(payload.attempt_id) ||
    !isValidUuid(payload.assignment_id) ||
    !isValidUuid(payload.exam_version_id) ||
    !isValidUuid(payload.student_id) ||
    typeof payload.attempt_number !== 'number' ||
    !Number.isInteger(payload.attempt_number) ||
    payload.attempt_number < 1 ||
    typeof payload.status !== 'string' ||
    !payload.status.trim() ||
    typeof payload.attempt_started_at !== 'string' ||
    !payload.attempt_started_at.trim() ||
    (payload.expires_at !== null && typeof payload.expires_at !== 'string') ||
    typeof payload.max_score !== 'number' ||
    Number.isNaN(payload.max_score) ||
    payload.max_score < 0 ||
    !payload.question_order ||
    typeof payload.question_order !== 'object' ||
    !payload.option_orders ||
    typeof payload.option_orders !== 'object' ||
    typeof payload.attempt_version !== 'number' ||
    !Number.isInteger(payload.attempt_version) ||
    payload.attempt_version < 1 ||
    typeof payload.resumed_existing !== 'boolean' ||
    typeof payload.idempotent_replay !== 'boolean' ||
    typeof payload.expired !== 'boolean' ||
    typeof payload.already_finalized !== 'boolean'
  ) {
    return null;
  }

  return {
    attempt_id: payload.attempt_id.trim().toLowerCase(),
    assignment_id: payload.assignment_id.trim().toLowerCase(),
    exam_version_id: payload.exam_version_id.trim().toLowerCase(),
    student_id: payload.student_id.trim().toLowerCase(),
    attempt_number: payload.attempt_number,
    status: payload.status.trim(),
    attempt_started_at: payload.attempt_started_at,
    expires_at: payload.expires_at,
    max_score: payload.max_score,
    question_order: payload.question_order,
    option_orders: payload.option_orders,
    attempt_version: payload.attempt_version,
    resumed_existing: payload.resumed_existing,
    idempotent_replay: payload.idempotent_replay,
    expired: payload.expired,
    already_finalized: payload.already_finalized,
  };
}

/**
 * Validates strictly 4 approved save response projection fields inside { success: true, data: {...} } envelope (Fail-Closed).
 */
export function validateSaveResponse(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.success !== true) {
    return null;
  }
  if (!raw.data || typeof raw.data !== 'object' || Array.isArray(raw.data)) {
    return null;
  }
  const payload = raw.data;

  if (
    !isValidUuid(payload.attempt_id) ||
    !isValidUuid(payload.exam_question_id) ||
    typeof payload.grading_status !== 'string' ||
    !payload.grading_status.trim() ||
    typeof payload.attempt_version !== 'number' ||
    !Number.isInteger(payload.attempt_version) ||
    payload.attempt_version < 1
  ) {
    return null;
  }

  return {
    attempt_id: payload.attempt_id.trim().toLowerCase(),
    exam_question_id: payload.exam_question_id.trim().toLowerCase(),
    grading_status: payload.grading_status.trim(),
    attempt_version: payload.attempt_version,
  };
}

/**
 * Validates strictly 18 approved submit response projection fields inside { success: true, data: {...} } envelope (Fail-Closed).
 */
export function validateSubmitResponse(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.success !== true) {
    return null;
  }
  if (!raw.data || typeof raw.data !== 'object' || Array.isArray(raw.data)) {
    return null;
  }
  const payload = raw.data;

  if (
    !isValidUuid(payload.attempt_id) ||
    !isValidUuid(payload.assignment_id) ||
    !isValidUuid(payload.exam_version_id) ||
    !isValidUuid(payload.student_id) ||
    typeof payload.attempt_number !== 'number' ||
    !Number.isInteger(payload.attempt_number) ||
    payload.attempt_number < 1 ||
    typeof payload.status !== 'string' ||
    !payload.status.trim() ||
    typeof payload.attempt_started_at !== 'string' ||
    !payload.attempt_started_at.trim() ||
    (payload.expires_at !== null && typeof payload.expires_at !== 'string') ||
    typeof payload.submitted_at !== 'string' ||
    !payload.submitted_at.trim() ||
    (payload.objective_score !== null && typeof payload.objective_score !== 'number') ||
    (payload.manual_score !== null && typeof payload.manual_score !== 'number') ||
    (payload.total_score !== null && typeof payload.total_score !== 'number') ||
    typeof payload.max_score !== 'number' ||
    Number.isNaN(payload.max_score) ||
    typeof payload.reward_stars_awarded !== 'number' ||
    (payload.graded_at !== null && typeof payload.graded_at !== 'string') ||
    (payload.graded_by !== null && (typeof payload.graded_by !== 'string' || !isValidUuid(payload.graded_by))) ||
    typeof payload.version !== 'number' ||
    !Number.isInteger(payload.version) ||
    payload.version < 1 ||
    typeof payload.idempotent_replay !== 'boolean'
  ) {
    return null;
  }

  return {
    attempt_id: payload.attempt_id.trim().toLowerCase(),
    assignment_id: payload.assignment_id.trim().toLowerCase(),
    exam_version_id: payload.exam_version_id.trim().toLowerCase(),
    student_id: payload.student_id.trim().toLowerCase(),
    attempt_number: payload.attempt_number,
    status: payload.status.trim(),
    attempt_started_at: payload.attempt_started_at,
    expires_at: payload.expires_at,
    submitted_at: payload.submitted_at,
    objective_score: payload.objective_score,
    manual_score: payload.manual_score,
    total_score: payload.total_score,
    max_score: payload.max_score,
    reward_stars_awarded: payload.reward_stars_awarded,
    graded_at: payload.graded_at,
    graded_by: payload.graded_by ? payload.graded_by.trim().toLowerCase() : null,
    version: payload.version,
    idempotent_replay: payload.idempotent_replay,
  };
}

/**
 * Validates strictly 4 approved get attempt questions response projection fields inside { success: true, data: {...} } envelope (Fail-Closed).
 * Rejects bare data projection, non-draft status, unknown question types, invalid UUIDs, non-positive points, or malformed options.
 */
export function validateGetAttemptQuestionsResponse(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.success !== true) {
    return null;
  }
  if (!raw.data || typeof raw.data !== 'object' || Array.isArray(raw.data)) {
    return null;
  }
  const payload = raw.data;

  if (
    !isValidUuid(payload.attempt_id) ||
    !isValidUuid(payload.exam_version_id) ||
    typeof payload.status !== 'string' ||
    payload.status.trim() !== 'draft' ||
    !Array.isArray(payload.questions)
  ) {
    return null;
  }

  const sanitizedQuestions = [];
  for (const q of payload.questions) {
    if (!q || typeof q !== 'object' || Array.isArray(q)) {
      return null;
    }
    if (
      !isValidUuid(q.id) ||
      typeof q.question_type !== 'string' ||
      !ALLOWED_QUESTION_TYPES_SET.has(q.question_type.trim()) ||
      typeof q.prompt !== 'string' ||
      typeof q.points !== 'number' ||
      !Number.isFinite(q.points) ||
      Number.isNaN(q.points) ||
      q.points <= 0 ||
      !Array.isArray(q.options)
    ) {
      return null;
    }

    const sanitizedOptions = [];
    for (const opt of q.options) {
      if (!opt || typeof opt !== 'object' || Array.isArray(opt)) {
        return null;
      }
      if (typeof opt.key !== 'string' || !opt.key.trim() || typeof opt.text !== 'string') {
        return null;
      }
      sanitizedOptions.push({
        key: opt.key.trim(),
        text: opt.text,
      });
    }

    sanitizedQuestions.push({
      id: q.id.trim().toLowerCase(),
      question_type: q.question_type.trim(),
      prompt: q.prompt,
      points: q.points,
      options: sanitizedOptions,
    });
  }

  return {
    attempt_id: payload.attempt_id.trim().toLowerCase(),
    exam_version_id: payload.exam_version_id.trim().toLowerCase(),
    status: payload.status.trim(),
    questions: sanitizedQuestions,
  };
}

export function validateListStudentAssignmentsResponse(data) {
  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data) ||
    data.success !== true ||
    !data.data ||
    typeof data.data !== 'object' ||
    Array.isArray(data.data) ||
    !Array.isArray(data.data.assignments)
  ) {
    return null;
  }

  // Strict root shape: only success and data
  const rootKeys = Object.keys(data);
  for (const k of rootKeys) {
    if (k !== 'success' && k !== 'data') return null;
  }
  // Strict data shape: only assignments
  const dataKeys = Object.keys(data.data);
  for (const k of dataKeys) {
    if (k !== 'assignments') return null;
  }

  const sanitizedAssignments = [];
  const APPROVED_ATTEMPT_STATUSES = new Set([
    'draft',
    'submitted',
    'pending_manual_grade',
    'graded',
  ]);

  for (const item of data.data.assignments) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }

    // id: valid UUID
    if (!isValidUuid(item.id)) return null;

    // exam_version_id: valid UUID
    if (!isValidUuid(item.exam_version_id)) return null;

    // title: non-empty string
    if (typeof item.title !== 'string' || !item.title.trim()) return null;

    // description: string OR null
    if (item.description !== null && typeof item.description !== 'string') return null;

    // subject: non-empty string
    if (typeof item.subject !== 'string' || !item.subject.trim()) return null;

    // grade_level: integer 1..12
    if (
      typeof item.grade_level !== 'number' ||
      !Number.isInteger(item.grade_level) ||
      item.grade_level < 1 ||
      item.grade_level > 12
    ) {
      return null;
    }

    // assigned_at: non-empty string
    if (typeof item.assigned_at !== 'string' || !item.assigned_at.trim()) return null;

    // opens_at: string OR null
    if (item.opens_at !== null && item.opens_at !== undefined && (typeof item.opens_at !== 'string' || !item.opens_at.trim())) {
      return null;
    }

    // last_start_at: string OR null
    if (item.last_start_at !== null && item.last_start_at !== undefined && (typeof item.last_start_at !== 'string' || !item.last_start_at.trim())) {
      return null;
    }

    // closes_at: string OR null
    if (item.closes_at !== null && item.closes_at !== undefined && (typeof item.closes_at !== 'string' || !item.closes_at.trim())) {
      return null;
    }

    // duration_minutes: integer > 0 OR null
    if (
      item.duration_minutes !== null &&
      item.duration_minutes !== undefined &&
      (typeof item.duration_minutes !== 'number' ||
        !Number.isInteger(item.duration_minutes) ||
        item.duration_minutes <= 0)
    ) {
      return null;
    }

    // total_points: finite number >= 0
    if (
      typeof item.total_points !== 'number' ||
      !Number.isFinite(item.total_points) ||
      Number.isNaN(item.total_points) ||
      item.total_points < 0
    ) {
      return null;
    }

    // reward_stars: integer >= 0
    if (
      typeof item.reward_stars !== 'number' ||
      !Number.isInteger(item.reward_stars) ||
      item.reward_stars < 0
    ) {
      return null;
    }

    // attempt_started_at: string OR null
    if (item.attempt_started_at !== null && item.attempt_started_at !== undefined && (typeof item.attempt_started_at !== 'string' || !item.attempt_started_at.trim())) {
      return null;
    }

    // attempt_expires_at: string OR null
    if (item.attempt_expires_at !== null && item.attempt_expires_at !== undefined && (typeof item.attempt_expires_at !== 'string' || !item.attempt_expires_at.trim())) {
      return null;
    }

    // attempt_status & attempt_id cross-field invariants
    if (item.attempt_status === null || item.attempt_status === undefined) {
      if (item.attempt_id !== null && item.attempt_id !== undefined) return null;
      if (item.latest_score !== null && item.latest_score !== undefined) return null;
      if (item.max_score !== null && item.max_score !== undefined) return null;
    } else if (
      typeof item.attempt_status === 'string' &&
      APPROVED_ATTEMPT_STATUSES.has(item.attempt_status)
    ) {
      if (!isValidUuid(item.attempt_id)) return null;
      if (
        typeof item.max_score !== 'number' ||
        !Number.isFinite(item.max_score) ||
        Number.isNaN(item.max_score) ||
        item.max_score <= 0
      ) {
        return null;
      }

      if (item.attempt_status !== 'graded') {
        if (item.latest_score !== null && item.latest_score !== undefined) return null;
      } else {
        // status === 'graded'
        if (item.latest_score !== null && item.latest_score !== undefined) {
          if (
            typeof item.latest_score !== 'number' ||
            !Number.isFinite(item.latest_score) ||
            Number.isNaN(item.latest_score) ||
            item.latest_score < 0 ||
            item.latest_score > item.max_score
          ) {
            return null;
          }
        }
      }
    } else {
      // Invalid status value or type
      return null;
    }

    sanitizedAssignments.push({
      id: item.id.trim().toLowerCase(),
      exam_version_id: item.exam_version_id.trim().toLowerCase(),
      title: item.title.trim(),
      description: item.description !== null && item.description !== undefined ? item.description : null,
      subject: item.subject.trim(),
      grade_level: item.grade_level,
      assigned_at: item.assigned_at.trim(),
      opens_at: item.opens_at ? item.opens_at.trim() : null,
      last_start_at: item.last_start_at ? item.last_start_at.trim() : null,
      closes_at: item.closes_at ? item.closes_at.trim() : null,
      duration_minutes: item.duration_minutes !== null && item.duration_minutes !== undefined ? item.duration_minutes : null,
      total_points: item.total_points,
      reward_stars: item.reward_stars,
      attempt_status: item.attempt_status || null,
      attempt_id: item.attempt_id ? item.attempt_id.trim().toLowerCase() : null,
      attempt_started_at: item.attempt_started_at ? item.attempt_started_at.trim() : null,
      attempt_expires_at: item.attempt_expires_at ? item.attempt_expires_at.trim() : null,
      latest_score: item.latest_score !== null && item.latest_score !== undefined ? item.latest_score : null,
      max_score: item.max_score !== null && item.max_score !== undefined ? item.max_score : null,
    });
  }

  return {
    assignments: sanitizedAssignments,
  };
}

/**
 * Sanitizes errors from transport or server into safe application error objects.
 * Never leaks raw exception messages, tokens, headers, or DB internals.
 */
export function sanitizeClientError(err, responseData = null) {
  let safeHttpStatus = null;
  let candidateCode = null;

  if (responseData && typeof responseData === 'object' && !Array.isArray(responseData)) {
    if (typeof responseData.safeHttpStatus === 'number' && Number.isInteger(responseData.safeHttpStatus) && responseData.safeHttpStatus >= 100 && responseData.safeHttpStatus <= 599) {
      safeHttpStatus = responseData.safeHttpStatus;
    }
    if (typeof responseData.safeErrorCode === 'string') {
      candidateCode = responseData.safeErrorCode.trim();
    } else if (typeof responseData.error?.code === 'string') {
      candidateCode = responseData.error.code.trim();
    }
  }

  if (err && typeof err === 'object') {
    if (typeof err.status === 'number' && Number.isInteger(err.status) && err.status >= 100 && err.status <= 599) {
      safeHttpStatus = err.status;
    }
    if (typeof err.context?.status === 'number' && Number.isInteger(err.context.status) && err.context.status >= 100 && err.context.status <= 599) {
      safeHttpStatus = err.context.status;
    }
    if (typeof err.code === 'string' && err.code.trim()) {
      candidateCode = candidateCode || err.code.trim();
    }
  }

  let safeErrorCode = 'INTERNAL_ERROR';
  if (candidateCode && SAFE_STUDENT_ERROR_CODES.has(candidateCode)) {
    safeErrorCode = candidateCode;
  } else if (candidateCode && /^HTTP_[1-5][0-9]{2}$/.test(candidateCode)) {
    safeErrorCode = candidateCode;
  } else if (safeHttpStatus !== null) {
    safeErrorCode = `HTTP_${safeHttpStatus}`;
  }

  return {
    ok: false,
    type: safeHttpStatus ? 'failed_http' : 'failed_client',
    ...(safeHttpStatus !== null ? { safeHttpStatus } : {}),
    safeErrorCode,
  };
}

/**
 * Scoped error sanitizer for getAttemptQuestions endpoint.
 * Projects ONLY approved question-fetch codes:
 *   AUTH_REQUIRED, INVALID_TOKEN, FORBIDDEN_ROLE, ACCOUNT_DISABLED,
 *   INVALID_INPUT, INVALID_REQUEST_FIELD, ATTEMPT_NOT_FOUND,
 *   CLASS_ACCESS_DENIED, ERR_ATTEMPT_ALREADY_FINALIZED,
 *   ERR_ATTEMPT_EXPIRED, INTERNAL_ERROR
 *
 * Unapproved or arbitrary provider codes map to safe HTTP_<status> or INTERNAL_ERROR fallback.
 */
export function sanitizeGetAttemptQuestionsError(err, responseData = null) {
  let safeHttpStatus = null;
  let candidateCode = null;

  if (responseData && typeof responseData === 'object' && !Array.isArray(responseData)) {
    if (
      typeof responseData.safeHttpStatus === 'number' &&
      Number.isInteger(responseData.safeHttpStatus) &&
      responseData.safeHttpStatus >= 100 &&
      responseData.safeHttpStatus <= 599
    ) {
      safeHttpStatus = responseData.safeHttpStatus;
    }
    if (typeof responseData.safeErrorCode === 'string') {
      candidateCode = responseData.safeErrorCode.trim();
    } else if (typeof responseData.error_code === 'string') {
      candidateCode = responseData.error_code.trim();
    } else if (typeof responseData.error?.code === 'string') {
      candidateCode = responseData.error.code.trim();
    }
  }

  if (err && typeof err === 'object') {
    if (
      typeof err.status === 'number' &&
      Number.isInteger(err.status) &&
      err.status >= 100 &&
      err.status <= 599
    ) {
      safeHttpStatus = err.status;
    }
    if (
      typeof err.context?.status === 'number' &&
      Number.isInteger(err.context.status) &&
      err.context.status >= 100 &&
      err.context.status <= 599
    ) {
      safeHttpStatus = err.context.status;
    }
    if (typeof err.code === 'string' && err.code.trim()) {
      candidateCode = candidateCode || err.code.trim();
    }
  }

  let safeErrorCode = 'INTERNAL_ERROR';
  if (candidateCode && SAFE_GET_ATTEMPT_QUESTIONS_ERROR_CODES.has(candidateCode)) {
    safeErrorCode = candidateCode;
  } else if (candidateCode && /^HTTP_[1-5][0-9]{2}$/.test(candidateCode)) {
    safeErrorCode = candidateCode;
  } else if (safeHttpStatus !== null) {
    safeErrorCode = `HTTP_${safeHttpStatus}`;
  }

  return {
    ok: false,
    type: safeHttpStatus ? 'failed_http' : 'failed_client',
    ...(safeHttpStatus !== null ? { safeHttpStatus } : {}),
    safeErrorCode,
  };
}

export class ExamStudentClient {
  #invokeFunction;
  #supabaseClient;
  #getAccessToken;
  #examUrl;
  #fetchImpl;

  constructor(options = {}) {
    const {
      invokeFunction,
      supabaseClient,
      supabase: supabaseAlias,
      getAccessToken,
      examUrl,
      fetchImpl,
    } = options;

    this.#supabaseClient = supabaseClient || supabaseAlias || null;
    this.#getAccessToken = typeof getAccessToken === 'function' ? getAccessToken : null;
    this.#examUrl =
      typeof examUrl === 'string' && examUrl.trim()
        ? examUrl.trim().replace(/\/$/, '')
        : DEFAULT_EXAM_URL;
    this.#fetchImpl = typeof fetchImpl === 'function' ? fetchImpl : null;

    if (typeof invokeFunction === 'function') {
      this.#invokeFunction = invokeFunction;
    } else {
      this.#invokeFunction = async (fnName, { body } = {}) => {
        let token = null;
        if (this.#getAccessToken) {
          token = await this.#getAccessToken();
        } else {
          const client = this.#supabaseClient || (await getDefaultSupabaseClient());
          if (client?.auth?.getSession) {
            const { data: sessionData, error: sessionError } = await client.auth.getSession();
            if (!sessionError && sessionData?.session?.access_token) {
              token = sessionData.session.access_token;
            }
          }
        }

        if (!token || typeof token !== 'string' || !token.trim()) {
          return {
            data: null,
            error: {
              status: 401,
              code: 'AUTH_REQUIRED',
              message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.',
            },
          };
        }

        const endpoint = `${this.#examUrl}/functions/v1/${fnName}`;
        const executeFetch = this.#fetchImpl || globalThis.fetch;

        if (typeof executeFetch !== 'function') {
          return {
            data: null,
            error: {
              status: 500,
              code: 'FETCH_UNAVAILABLE',
              message: 'Fetch transport unavailable.',
            },
          };
        }

        try {
          const response = await executeFetch(endpoint, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token.trim()}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body || {}),
          });

          let rawJson = null;
          try {
            rawJson = await response.json();
          } catch (_) {
            rawJson = null;
          }

          if (!response.ok) {
            return {
              data: rawJson,
              error: {
                status: response.status,
                code: rawJson?.error?.code || rawJson?.safeErrorCode || `HTTP_${response.status}`,
              },
            };
          }

          return {
            data: rawJson,
            error: null,
          };
        } catch (err) {
          return {
            data: null,
            error: {
              status: 500,
              code: 'NETWORK_ERROR',
              message: err?.message || 'Network transport error',
            },
          };
        }
      };
    }
  }

  async startAttempt(params = {}) {
    const assignment_id = params.assignment_id || params.assignmentId;
    let attempt_id = params.attempt_id || params.attemptId;

    if (!isValidUuid(assignment_id)) {
      return {
        ok: false,
        type: 'failed_pre_dispatch',
        safeErrorCode: 'INVALID_INPUT',
      };
    }

    if (!attempt_id) {
      attempt_id = generateProvisionalAttemptId();
    } else if (!isValidUuid(attempt_id)) {
      return {
        ok: false,
        type: 'failed_pre_dispatch',
        safeErrorCode: 'INVALID_INPUT',
      };
    }

    try {
      const { data, error } = await this.#invokeFunction(START_FUNCTION_NAME, {
        body: {
          assignment_id,
          attempt_id,
        },
      });

      if (error) {
        return sanitizeClientError(error, data);
      }

      const validated = validateStartResponse(data);
      if (!validated) {
        return {
          ok: false,
          type: 'failed_http',
          safeHttpStatus: 200,
          safeErrorCode: 'INVALID_RESPONSE_PAYLOAD',
        };
      }

      return {
        ok: true,
        data: validated,
      };
    } catch (err) {
      return sanitizeClientError(err);
    }
  }

  async saveAnswer(params = {}) {
    const attempt_id = params.attempt_id || params.attemptId;
    const exam_question_id = params.exam_question_id || params.examQuestionId;
    const student_answer_json =
      params.student_answer_json !== undefined ? params.student_answer_json : params.studentAnswerJson;
    const expected_version =
      params.expected_version !== undefined ? params.expected_version : params.expectedVersion;

    // Strict Gating: file_url must remain null in Phase 3E-A
    if (params.file_url !== undefined && params.file_url !== null) {
      return {
        ok: false,
        type: 'failed_pre_dispatch',
        safeErrorCode: 'ERR_EXAM_UPLOAD_NOT_READY',
      };
    }
    if (params.fileUrl !== undefined && params.fileUrl !== null) {
      return {
        ok: false,
        type: 'failed_pre_dispatch',
        safeErrorCode: 'ERR_EXAM_UPLOAD_NOT_READY',
      };
    }

    if (
      !isValidUuid(attempt_id) ||
      !isValidUuid(exam_question_id) ||
      typeof expected_version !== 'number' ||
      !Number.isInteger(expected_version) ||
      expected_version < 1
    ) {
      return {
        ok: false,
        type: 'failed_pre_dispatch',
        safeErrorCode: 'INVALID_INPUT',
      };
    }

    try {
      const { data, error } = await this.#invokeFunction(SAVE_FUNCTION_NAME, {
        body: {
          attempt_id,
          exam_question_id,
          student_answer_json: student_answer_json ?? null,
          file_url: null,
          expected_version,
        },
      });

      if (error) {
        return sanitizeClientError(error, data);
      }

      const validated = validateSaveResponse(data);
      if (!validated) {
        return {
          ok: false,
          type: 'failed_http',
          safeHttpStatus: 200,
          safeErrorCode: 'INVALID_RESPONSE_PAYLOAD',
        };
      }

      return {
        ok: true,
        data: validated,
      };
    } catch (err) {
      return sanitizeClientError(err);
    }
  }

  async submitAttempt(params = {}) {
    const attempt_id = params.attempt_id || params.attemptId;
    const expected_version =
      params.expected_version !== undefined ? params.expected_version : params.expectedVersion;

    if (
      !isValidUuid(attempt_id) ||
      typeof expected_version !== 'number' ||
      !Number.isInteger(expected_version) ||
      expected_version < 1
    ) {
      return {
        ok: false,
        type: 'failed_pre_dispatch',
        safeErrorCode: 'INVALID_INPUT',
      };
    }

    try {
      const { data, error } = await this.#invokeFunction(SUBMIT_FUNCTION_NAME, {
        body: {
          attempt_id,
          expected_version,
        },
      });

      if (error) {
        return sanitizeClientError(error, data);
      }

      const validated = validateSubmitResponse(data);
      if (!validated) {
        return {
          ok: false,
          type: 'failed_http',
          safeHttpStatus: 200,
          safeErrorCode: 'INVALID_RESPONSE_PAYLOAD',
        };
      }

      return {
        ok: true,
        data: validated,
      };
    } catch (err) {
      return sanitizeClientError(err);
    }
  }

  async getAttemptQuestions(params = {}) {
    let attempt_id;
    if (typeof params === 'string') {
      attempt_id = params;
    } else {
      attempt_id = params?.attempt_id || params?.attemptId;
    }

    if (!isValidUuid(attempt_id)) {
      return {
        ok: false,
        type: 'failed_pre_dispatch',
        safeErrorCode: 'INVALID_INPUT',
      };
    }

    const cleanAttemptId = attempt_id.trim().toLowerCase();

    try {
      const { data, error } = await this.#invokeFunction(GET_QUESTIONS_FUNCTION_NAME, {
        body: {
          attempt_id: cleanAttemptId,
        },
      });

      if (error) {
        return sanitizeGetAttemptQuestionsError(error, data);
      }

      const validated = validateGetAttemptQuestionsResponse(data);
      if (!validated) {
        return {
          ok: false,
          type: 'failed_http',
          safeHttpStatus: 200,
          safeErrorCode: 'INVALID_RESPONSE_PAYLOAD',
        };
      }

      return {
        ok: true,
        data: validated,
      };
    } catch (err) {
      return sanitizeGetAttemptQuestionsError(err);
    }
  }

  async listStudentExamAssignments() {
    try {
      const { data, error } = await this.#invokeFunction(LIST_ASSIGNMENTS_FUNCTION_NAME, {
        body: {},
      });

      if (error) {
        return sanitizeClientError(error, data);
      }

      const validated = validateListStudentAssignmentsResponse(data);
      if (!validated) {
        return {
          ok: false,
          type: 'failed_http',
          safeHttpStatus: 200,
          safeErrorCode: 'INVALID_RESPONSE_PAYLOAD',
        };
      }

      return {
        ok: true,
        data: validated,
      };
    } catch (err) {
      return sanitizeClientError(err);
    }
  }
}

export function createExamStudentClient(options = {}) {
  return new ExamStudentClient(options);
}
