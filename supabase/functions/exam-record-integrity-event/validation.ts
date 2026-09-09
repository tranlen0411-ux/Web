// supabase/functions/exam-record-integrity-event/validation.ts
// Strict Request Validation & Forbidden Field Injection Shield for Integrity Event BFF

import type { ErrorCode } from '../_shared/examErrors.ts';

// Standard RFC 4122 UUID Regex (case-insensitive)
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ALLOWED_SOURCES = new Set([
  'page_hidden',
  'page_visible',
  'window_focus',
  'window_blur',
]);

export const FORBIDDEN_FIELDS = new Set([
  'student_id',
  'caller_id',
  'p_caller_id',
  'p_student_id',
  'p_attempt_id',
  'p_source',
  'p_client_timestamp',
  'role',
  'class_id',
  'assignment_id',
  'episode_id',
  'active_leave_episode_id',
  'tab_switch_count',
  'tab_switch_policy',
  'event_type',
  'event_recorded',
  'idempotent_replay',
  'grading_status',
  'points_earned',
  'is_correct',
  'teacher_comment',
  'service_role',
  'service_role_key',
]);

export const ALLOWED_FIELDS = new Set([
  'attempt_id',
  'source',
  'client_timestamp',
]);

export interface SanitizedIntegrityEventPayload {
  attempt_id: string;
  source: 'page_hidden' | 'page_visible' | 'window_focus' | 'window_blur';
  client_timestamp: string | null;
}

export interface ValidationContext {
  callerId?: string;
}

export interface ValidationResult {
  valid: boolean;
  sanitizedData?: SanitizedIntegrityEventPayload;
  errorCode?: ErrorCode;
  errorMessage?: string;
}

// Strict RFC 3339 / ISO 8601 regex requiring full date, 'T', full time, and timezone (Z or ±HH:mm)
export const ISO_TIMESTAMP_REGEX = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/;

export function isValidIsoTimestamp(str: string): boolean {
  const match = ISO_TIMESTAMP_REGEX.exec(str);
  if (!match) return false;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);
  const second = parseInt(match[6], 10);

  // Month range [1..12]
  if (month < 1 || month > 12) return false;

  // Hour range [0..23], Minute range [0..59], Second range [0..59]
  if (hour < 0 || hour > 23) return false;
  if (minute < 0 || minute > 59) return false;
  if (second < 0 || second > 59) return false;

  // Days in month validation (accounting for leap year in February)
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]) return false;

  // Timezone offset range validation
  if (match[8] && match[8] !== 'Z') {
    const offsetHour = parseInt(match[10], 10);
    const offsetMinute = parseInt(match[11], 10);
    if (offsetHour < 0 || offsetHour > 23) return false;
    if (offsetMinute < 0 || offsetMinute > 59) return false;
  }

  // Parseability check
  const parsedDate = Date.parse(str);
  if (Number.isNaN(parsedDate)) return false;

  return true;
}

export function validateIntegrityEventPayload(
  body: unknown,
  _context?: ValidationContext
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

  // 1. Kiểm tra trường đặc quyền / cấm truyền
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

  // 2. Validate attempt_id (Required, UUID)
  if (raw.attempt_id === undefined || raw.attempt_id === null || raw.attempt_id === '') {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Thiếu tham số bắt buộc attempt_id.',
    };
  }

  if (typeof raw.attempt_id !== 'string' || !UUID_REGEX.test(raw.attempt_id)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Mã lượt làm bài attempt_id không hợp lệ (phải là UUID chuẩn).',
    };
  }

  // 3. Validate source (Required, Enum)
  if (raw.source === undefined || raw.source === null || raw.source === '') {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Thiếu tham số bắt buộc source.',
    };
  }

  if (typeof raw.source !== 'string' || !ALLOWED_SOURCES.has(raw.source)) {
    return {
      valid: false,
      errorCode: 'ERR_INVALID_EVENT_SOURCE',
      errorMessage: 'Nguồn sự kiện source không hợp lệ (chỉ chấp nhận: page_hidden, page_visible, window_focus, window_blur).',
    };
  }

  // 4. Validate client_timestamp (Optional, strict RFC3339/ISO-8601 with timezone or null)
  let clientTimestamp: string | null = null;
  if (raw.client_timestamp !== undefined && raw.client_timestamp !== null) {
    if (typeof raw.client_timestamp !== 'string') {
      return {
        valid: false,
        errorCode: 'INVALID_INPUT',
        errorMessage: 'Thời gian client_timestamp phải là chuỗi định dạng ISO-8601 hợp lệ.',
      };
    }

    if (!isValidIsoTimestamp(raw.client_timestamp)) {
      return {
        valid: false,
        errorCode: 'INVALID_INPUT',
        errorMessage: 'Thời gian client_timestamp không đúng định dạng ISO-8601/RFC3339 hợp lệ có múi giờ.',
      };
    }

    clientTimestamp = raw.client_timestamp;
  }

  return {
    valid: true,
    sanitizedData: {
      attempt_id: raw.attempt_id.toLowerCase(),
      source: raw.source as SanitizedIntegrityEventPayload['source'],
      client_timestamp: clientTimestamp,
    },
  };
}

