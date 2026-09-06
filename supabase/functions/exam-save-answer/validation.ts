// supabase/functions/exam-save-answer/validation.ts
// Strict Request Validation & Forbidden Field Injection Shield for Save Answer
// Temporary Upload Feature Gate: Rejects file_url != null with ERR_EXAM_UPLOAD_NOT_READY

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
  'grading_status',
  'points_earned',
  'is_correct',
  'teacher_comment',
  'service_role',
  'service_role_key',
]);

const ALLOWED_FIELDS = new Set([
  'attempt_id',
  'exam_question_id',
  'student_answer_json',
  'file_url',
  'expected_version',
]);

export interface SanitizedSaveAnswerPayload {
  attempt_id: string;
  exam_question_id: string;
  student_answer_json: unknown;
  file_url: null;
  expected_version: number;
}

export interface ValidationContext {
  callerId?: string;
}

export interface ValidationResult {
  valid: boolean;
  sanitizedData?: SanitizedSaveAnswerPayload;
  errorCode?: ErrorCode;
  errorMessage?: string;
}

export function validateSaveAnswerPayload(
  body: unknown,
  context?: ValidationContext
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

  // 3. Validate exam_question_id
  if (typeof raw.exam_question_id !== 'string' || !UUID_REGEX.test(raw.exam_question_id)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Mã câu hỏi exam_question_id không hợp lệ (phải là UUID chuẩn).',
    };
  }

  // 4. Validate expected_version (Bắt buộc là số nguyên >= 1)
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

  // 5. Temporary Upload Feature Gate: Chặn tất cả yêu cầu có file_url != null
  if (raw.file_url !== undefined && raw.file_url !== null) {
    return {
      valid: false,
      errorCode: 'ERR_EXAM_UPLOAD_NOT_READY',
      errorMessage: 'Chức năng nộp tệp cho bài thi chưa được kích hoạt.',
    };
  }

  // 6. student_answer_json
  const sanitizedStudentAnswerJson = raw.student_answer_json !== undefined ? raw.student_answer_json : null;

  return {
    valid: true,
    sanitizedData: {
      attempt_id: raw.attempt_id.toLowerCase(),
      exam_question_id: raw.exam_question_id.toLowerCase(),
      student_answer_json: sanitizedStudentAnswerJson,
      file_url: null,
      expected_version: raw.expected_version,
    },
  };
}
