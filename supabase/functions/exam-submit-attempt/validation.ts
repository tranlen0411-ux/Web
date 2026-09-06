// supabase/functions/exam-submit-attempt/validation.ts
// Strict Request Validation & Forbidden Field Injection Shield for Submit Attempt

import { ErrorCode } from '../_shared/examErrors.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FORBIDDEN_FIELDS = new Set([
  'student_id',
  'caller_id',
  'p_caller_id',
  'p_student_id',
  'role',
  'class_id',
  'assignment_id',
  'status',
  'objective_score',
  'manual_score',
  'total_score',
  'reward_stars_awarded',
  'service_role',
  'service_role_key',
]);

const ALLOWED_FIELDS = new Set(['attempt_id', 'expected_version']);

export interface SanitizedSubmitAttemptPayload {
  attempt_id: string;
  expected_version: number;
}

export interface ValidationResult {
  valid: boolean;
  sanitizedData?: SanitizedSubmitAttemptPayload;
  errorCode?: ErrorCode;
  errorMessage?: string;
}

export function validateSubmitAttemptPayload(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Dữ liệu yêu cầu phải là một JSON object.',
    };
  }

  const raw = body as Record<string, unknown>;
  const keys = Object.keys(raw);

  // 1. Kiểm tra trường đặc quyền / bị cấm
  for (const k of keys) {
    if (FORBIDDEN_FIELDS.has(k)) {
      return {
        valid: false,
        errorCode: 'INVALID_REQUEST_FIELD',
        errorMessage: `Trường '${k}' không được phép truyền từ phía client.`,
      };
    }
    if (!ALLOWED_FIELDS.has(k)) {
      return {
        valid: false,
        errorCode: 'INVALID_REQUEST_FIELD',
        errorMessage: `Trường '${k}' không nằm trong danh sách cho phép.`,
      };
    }
  }

  // 2. Validate attempt_id
  if (typeof raw.attempt_id !== 'string' || !UUID_REGEX.test(raw.attempt_id)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Mã lượt làm bài attempt_id không hợp lệ (phải là UUID chuẩn).',
    };
  }

  // 3. Validate expected_version (Bắt buộc là số nguyên >= 1)
  if (
    raw.expected_version === undefined ||
    raw.expected_version === null ||
    typeof raw.expected_version !== 'number' ||
    !Number.isInteger(raw.expected_version) ||
    raw.expected_version < 1
  ) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Phiên bản kỳ vọng expected_version bắt buộc là số nguyên >= 1.',
    };
  }

  return {
    valid: true,
    sanitizedData: {
      attempt_id: raw.attempt_id.toLowerCase(),
      expected_version: raw.expected_version,
    },
  };
}
