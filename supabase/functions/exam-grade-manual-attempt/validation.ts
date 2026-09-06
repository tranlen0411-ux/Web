// supabase/functions/exam-grade-manual-attempt/validation.ts
// Strict Payload Validation and Allowlists for Exam Builder Manual Grading BFF V1

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const FORBIDDEN_INJECTION_FIELDS = new Set([
  'caller_id',
  'p_caller_id',
  'role',
  'actor_role',
  'class_id',
  'is_admin',
  'student_id',
  'service_role',
  'service_role_key',
]);

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  'attempt_id',
  'manual_grades',
  'teacher_feedback',
  'expected_version',
]);

const ALLOWED_MANUAL_GRADE_KEYS = new Set([
  'exam_question_id',
  'points_earned',
  'teacher_comment',
]);

export interface ValidatedManualGradeEntry {
  exam_question_id: string;
  points_earned: number;
  teacher_comment: string | null;
}

export interface ValidatedGradingPayload {
  attempt_id: string;
  expected_version: number;
  manual_grades: ValidatedManualGradeEntry[];
  teacher_feedback: string | null;
}

export interface ValidationResult {
  valid: boolean;
  errorCode?: 'INVALID_INPUT' | 'INVALID_REQUEST_FIELD';
  errorMessage?: string;
  sanitizedData?: ValidatedGradingPayload;
}

export function isValidUUID(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateManualGradingPayload(body: unknown): ValidationResult {
  if (!isPlainObject(body)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Dữ liệu yêu cầu phải là một JSON object hợp lệ.',
    };
  }

  // 1. Kiểm tra các trường tiêm nhiễm bảo mật bị cấm (Fail-Closed)
  for (const key of Object.keys(body)) {
    const normalizedKey = key.toLowerCase().trim();
    if (FORBIDDEN_INJECTION_FIELDS.has(normalizedKey)) {
      return {
        valid: false,
        errorCode: 'INVALID_REQUEST_FIELD',
        errorMessage: `Trường '${key}' bị cấm trong payload yêu cầu bảo mật.`,
      };
    }
  }

  // 2. Kiểm tra danh sách khóa cho phép cấp cao nhất (Strict Allowlist)
  for (const key of Object.keys(body)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      return {
        valid: false,
        errorCode: 'INVALID_REQUEST_FIELD',
        errorMessage: `Trường '${key}' không nằm trong danh sách cho phép.`,
      };
    }
  }

  // 3. Kiểm tra attempt_id
  if (!('attempt_id' in body) || !isValidUUID(body.attempt_id)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Trường attempt_id là bắt buộc và phải là một UUID hợp lệ.',
    };
  }

  // 4. Kiểm tra expected_version
  if (!('expected_version' in body)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Trường expected_version là bắt buộc.',
    };
  }

  const expectedVersion = body.expected_version;
  if (
    typeof expectedVersion !== 'number' ||
    !Number.isInteger(expectedVersion) ||
    expectedVersion < 1
  ) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Trường expected_version phải là số nguyên dương >= 1.',
    };
  }

  // 5. Kiểm tra manual_grades
  if (!('manual_grades' in body) || !Array.isArray(body.manual_grades)) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Trường manual_grades phải là một mảng JSON.',
    };
  }

  const manualGradesArray = body.manual_grades;
  const validatedGrades: ValidatedManualGradeEntry[] = [];

  for (let i = 0; i < manualGradesArray.length; i++) {
    const entry = manualGradesArray[i];
    if (!isPlainObject(entry)) {
      return {
        valid: false,
        errorCode: 'INVALID_INPUT',
        errorMessage: `Phần tử manual_grades[${i}] phải là một object.`,
      };
    }

    // Kiểm tra forbidden security fields trong entry
    for (const k of Object.keys(entry)) {
      const normK = k.toLowerCase().trim();
      if (FORBIDDEN_INJECTION_FIELDS.has(normK)) {
        return {
          valid: false,
          errorCode: 'INVALID_REQUEST_FIELD',
          errorMessage: `Trường '${k}' trong manual_grades[${i}] bị cấm.`,
        };
      }
      if (!ALLOWED_MANUAL_GRADE_KEYS.has(k)) {
        return {
          valid: false,
          errorCode: 'INVALID_REQUEST_FIELD',
          errorMessage: `Trường '${k}' trong manual_grades[${i}] không hợp lệ.`,
        };
      }
    }

    // exam_question_id
    if (!('exam_question_id' in entry) || !isValidUUID(entry.exam_question_id)) {
      return {
        valid: false,
        errorCode: 'INVALID_INPUT',
        errorMessage: `Trường exam_question_id trong manual_grades[${i}] phải là một UUID hợp lệ.`,
      };
    }

    // points_earned
    if (!('points_earned' in entry) || typeof entry.points_earned !== 'number') {
      return {
        valid: false,
        errorCode: 'INVALID_INPUT',
        errorMessage: `Trường points_earned trong manual_grades[${i}] phải là số.`,
      };
    }

    const pts = entry.points_earned;
    if (!Number.isFinite(pts) || pts < 0) {
      return {
        valid: false,
        errorCode: 'INVALID_INPUT',
        errorMessage: `Trường points_earned trong manual_grades[${i}] phải là số không âm hữu hạn.`,
      };
    }

    // Kiểm tra tối đa 2 chữ số thập phân
    const ptsStr = String(pts);
    if (ptsStr.includes('.') && ptsStr.split('.')[1].length > 2) {
      return {
        valid: false,
        errorCode: 'INVALID_INPUT',
        errorMessage: `Trường points_earned trong manual_grades[${i}] chỉ được tối đa 2 chữ số thập phân.`,
      };
    }

    // teacher_comment
    let teacherComment: string | null = null;
    if ('teacher_comment' in entry) {
      if (entry.teacher_comment !== null && typeof entry.teacher_comment !== 'string') {
        return {
          valid: false,
          errorCode: 'INVALID_INPUT',
          errorMessage: `Trường teacher_comment trong manual_grades[${i}] phải là chuỗi hoặc null.`,
        };
      }
      teacherComment = entry.teacher_comment;
    }

    validatedGrades.push({
      exam_question_id: entry.exam_question_id as string,
      points_earned: pts,
      teacher_comment: teacherComment,
    });
  }

  // 6. Kiểm tra teacher_feedback
  let teacherFeedback: string | null = null;
  if ('teacher_feedback' in body) {
    if (body.teacher_feedback !== null && typeof body.teacher_feedback !== 'string') {
      return {
        valid: false,
        errorCode: 'INVALID_INPUT',
        errorMessage: 'Trường teacher_feedback phải là chuỗi hoặc null.',
      };
    }
    teacherFeedback = body.teacher_feedback;
  }

  return {
    valid: true,
    sanitizedData: {
      attempt_id: body.attempt_id as string,
      expected_version: expectedVersion,
      manual_grades: validatedGrades,
      teacher_feedback: teacherFeedback,
    },
  };
}
