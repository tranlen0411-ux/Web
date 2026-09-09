// supabase/functions/exam-list-student-assignments/validation.ts
// Strict Request Validation & Forbidden Field Injection Shield for List Student Assignments

import type { ErrorCode } from '../_shared/examErrors.ts';

export const FORBIDDEN_FIELDS = new Set([
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
  'assignment_id',
  'exam_version_id',
]);

export const ALLOWED_FIELDS = new Set<string>([]);

export interface ValidationResult {
  valid: boolean;
  errorCode?: ErrorCode;
  errorMessage?: string;
}

export function validateListStudentAssignmentsPayload(
  body: unknown,
  _options?: { callerId?: string }
): ValidationResult {
  if (body === undefined || body === null) {
    return { valid: true };
  }

  if (typeof body !== 'object' || Array.isArray(body)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Dữ liệu yêu cầu phải là một JSON object.',
    };
  }

  const raw = body as Record<string, unknown>;
  const keys = Object.keys(raw);

  // Kiểm tra các trường đặc quyền bị cấm từ client
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

  return { valid: true };
}
