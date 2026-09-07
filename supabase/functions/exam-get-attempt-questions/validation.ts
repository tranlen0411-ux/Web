// supabase/functions/exam-get-attempt-questions/validation.ts
// Strict Request Validation & Forbidden Field Injection Shield for Get Attempt Questions (Phase 3E-B0)

import type { ErrorCode } from '../_shared/examErrors.ts';

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const FORBIDDEN_FIELDS = new Set([
  'student_id',
  'caller_id',
  'p_caller_id',
  'p_student_id',
  'p_attempt_id',
  'assignment_id',
  'exam_version_id',
  'role',
  'class_id',
  'is_admin',
  'teacher_id',
  'service_role',
  'service_role_key',
]);

export const ALLOWED_FIELDS = new Set(['attempt_id']);

export interface SanitizedGetAttemptQuestionsPayload {
  attempt_id: string;
}

export interface ValidationResult {
  valid: boolean;
  sanitizedData?: SanitizedGetAttemptQuestionsPayload;
  errorCode?: ErrorCode;
  errorMessage?: string;
}

export function validateGetAttemptQuestionsPayload(
  body: unknown,
  _options?: { callerId?: string }
): ValidationResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Dữ liệu yêu cầu phải là một JSON object.',
    };
  }

  const raw = body as Record<string, unknown>;
  const keys = Object.keys(raw);

  // 1. Kiểm tra trường đặc quyền / bị cấm / không nằm trong danh sách cho phép
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
  if (typeof raw.attempt_id !== 'string' || !raw.attempt_id.trim()) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Mã lượt làm bài attempt_id là bắt buộc.',
    };
  }

  const trimmedAttemptId = raw.attempt_id.trim();

  if (!UUID_REGEX.test(trimmedAttemptId)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Mã lượt làm bài attempt_id không hợp lệ (phải là UUID chuẩn).',
    };
  }

  return {
    valid: true,
    sanitizedData: {
      attempt_id: trimmedAttemptId.toLowerCase(),
    },
  };
}
