async function getDefaultSupabaseClient() {
  try {
    const mod = await import('../lib/supabase.js');
    return mod.supabase;
  } catch (_) {
    return null;
  }
}

export const START_FUNCTION_NAME = 'exam-start-attempt';
export const SAVE_FUNCTION_NAME = 'exam-save-answer';
export const SUBMIT_FUNCTION_NAME = 'exam-submit-attempt';
export const GET_QUESTIONS_FUNCTION_NAME = 'exam-get-attempt-questions';

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
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  constructor(options = {}) {
    const { invokeFunction, supabaseClient } = options;
    this.#supabaseClient = supabaseClient || null;

    if (typeof invokeFunction === 'function') {
      this.#invokeFunction = invokeFunction;
    } else if (supabaseClient?.functions?.invoke) {
      this.#invokeFunction = async (fnName, { body }) => {
        return await supabaseClient.functions.invoke(fnName, { body });
      };
    } else {
      this.#invokeFunction = async (fnName, { body }) => {
        const client = this.#supabaseClient || (await getDefaultSupabaseClient());
        if (client?.functions?.invoke) {
          return await client.functions.invoke(fnName, { body });
        }
        throw new Error('No Supabase functions invoke transport available.');
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
}

export function createExamStudentClient(options = {}) {
  return new ExamStudentClient(options);
}
