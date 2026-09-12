// supabase/functions/exam-get-student-attempt-result/validation.ts
// Strict Request Validation & Forbidden Field Injection Shield for Student Attempt Result Read (Phase B2 - Student Result View V1)

import type { ErrorCode } from '../_shared/examErrors.ts';

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  'status',
  'is_correct',
  'answer_key',
  'correct_answer',
]);

export const ALLOWED_FIELDS = new Set(['attempt_id']);

export interface SanitizedGetStudentAttemptResultPayload {
  attempt_id: string;
}

export interface ValidationResult {
  valid: boolean;
  sanitizedData?: SanitizedGetStudentAttemptResultPayload;
  errorCode?: ErrorCode | string;
  errorMessage?: string;
}

export function validateGetStudentAttemptResultPayload(
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
        errorMessage: `Trường không xác định: '${k}'.`,
      };
    }
  }

  // 2. Validate attempt_id
  const rawAttemptId = raw.attempt_id;
  if (!rawAttemptId || typeof rawAttemptId !== 'string') {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Thiếu mã lượt làm bài (attempt_id).',
    };
  }

  const trimmedAttemptId = rawAttemptId.trim().toLowerCase();
  if (!UUID_REGEX.test(trimmedAttemptId)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Mã lượt làm bài (attempt_id) không đúng định dạng UUID.',
    };
  }

  return {
    valid: true,
    sanitizedData: {
      attempt_id: trimmedAttemptId,
    },
  };
}
