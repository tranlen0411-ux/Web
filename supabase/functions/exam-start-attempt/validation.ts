// supabase/functions/exam-start-attempt/validation.ts
// Strict Request Validation & Forbidden Field Injection Shield for Start Attempt

import { ErrorCode } from '../_shared/examErrors.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FORBIDDEN_FIELDS = new Set([
  'student_id',
  'caller_id',
  'p_caller_id',
  'p_student_id',
  'role',
  'class_id',
  'is_admin',
  'teacher_id',
  'service_role',
  'service_role_key',
]);

const ALLOWED_FIELDS = new Set(['assignment_id', 'attempt_id']);

export interface SanitizedStartAttemptPayload {
  assignment_id: string;
  attempt_id: string;
}

export interface ValidationResult {
  valid: boolean;
  sanitizedData?: SanitizedStartAttemptPayload;
  errorCode?: ErrorCode;
  errorMessage?: string;
}

export function validateStartAttemptPayload(body: unknown): ValidationResult {
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

  // 2. Validate assignment_id
  if (typeof raw.assignment_id !== 'string' || !UUID_REGEX.test(raw.assignment_id)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Mã bài giao assignment_id không hợp lệ (phải là UUID chuẩn).',
    };
  }

  // 3. Validate attempt_id
  if (typeof raw.attempt_id !== 'string' || !UUID_REGEX.test(raw.attempt_id)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Mã lượt làm bài attempt_id không hợp lệ (phải là UUID chuẩn).',
    };
  }

  return {
    valid: true,
    sanitizedData: {
      assignment_id: raw.assignment_id.toLowerCase(),
      attempt_id: raw.attempt_id.toLowerCase(),
    },
  };
}
