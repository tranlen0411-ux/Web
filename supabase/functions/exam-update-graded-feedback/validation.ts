// supabase/functions/exam-update-graded-feedback/validation.ts
// Strict Payload Validation and Allowlists for Exam Graded Feedback Update BFF V1

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
  'points_earned',
  'score',
  'objective_score',
  'manual_score',
  'total_score',
  'max_score',
  'is_correct',
  'grading_status',
  'status',
]);

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  'attempt_id',
  'expected_version',
  'teacher_feedback',
  'question_comments',
]);

const ALLOWED_QUESTION_COMMENT_KEYS = new Set([
  'exam_question_id',
  'teacher_comment',
]);

export interface ValidatedQuestionCommentEntry {
  exam_question_id: string;
  teacher_comment: string | null;
}

export interface ValidatedFeedbackPayload {
  attempt_id: string;
  expected_version: number;
  teacher_feedback: string | null;
  question_comments: ValidatedQuestionCommentEntry[];
}

export interface ValidationResult {
  valid: boolean;
  errorCode?: 'INVALID_INPUT' | 'INVALID_REQUEST_FIELD';
  errorMessage?: string;
  sanitizedData?: ValidatedFeedbackPayload;
}

export function isValidUUID(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateUpdateFeedbackPayload(body: unknown): ValidationResult {
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

  const expVer = body.expected_version;
  if (
    typeof expVer !== 'number' ||
    !Number.isInteger(expVer) ||
    expVer < 1 ||
    expVer > 1000000
  ) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Trường expected_version phải là số nguyên dương hợp lệ.',
    };
  }

  // 5. Kiểm tra teacher_feedback
  let sanitizedTeacherFeedback: string | null = null;
  if ('teacher_feedback' in body && body.teacher_feedback !== null && body.teacher_feedback !== undefined) {
    if (typeof body.teacher_feedback !== 'string') {
      return {
        valid: false,
        errorCode: 'INVALID_INPUT',
        errorMessage: 'Trường teacher_feedback phải là một chuỗi văn bản hoặc null.',
      };
    }
    const trimmed = body.teacher_feedback.trim();
    if (trimmed.length > 5000) {
      return {
        valid: false,
        errorCode: 'INVALID_INPUT',
        errorMessage: 'Nhận xét tổng thể không được vượt quá 5000 ký tự.',
      };
    }
    sanitizedTeacherFeedback = trimmed.length > 0 ? trimmed : null;
  }

  // 6. Kiểm tra question_comments (Tùy chọn, mặc định rỗng)
  const sanitizedQuestionComments: ValidatedQuestionCommentEntry[] = [];
  if ('question_comments' in body && body.question_comments !== null && body.question_comments !== undefined) {
    if (!Array.isArray(body.question_comments)) {
      return {
        valid: false,
        errorCode: 'INVALID_INPUT',
        errorMessage: 'Trường question_comments phải là một mảng JSON.',
      };
    }

    const seenQuestionIds = new Set<string>();

    for (let i = 0; i < body.question_comments.length; i++) {
      const entry = body.question_comments[i];
      if (!isPlainObject(entry)) {
        return {
          valid: false,
          errorCode: 'INVALID_INPUT',
          errorMessage: `Mục nhận xét câu hỏi số ${i + 1} phải là một JSON object.`,
        };
      }

      // Check forbidden fields
      for (const key of Object.keys(entry)) {
        const normalizedKey = key.toLowerCase().trim();
        if (FORBIDDEN_INJECTION_FIELDS.has(normalizedKey)) {
          return {
            valid: false,
            errorCode: 'INVALID_REQUEST_FIELD',
            errorMessage: `Trường '${key}' bị cấm trong mục nhận xét câu hỏi số ${i + 1}.`,
          };
        }
      }

      // Check allowed keys
      for (const key of Object.keys(entry)) {
        if (!ALLOWED_QUESTION_COMMENT_KEYS.has(key)) {
          return {
            valid: false,
            errorCode: 'INVALID_REQUEST_FIELD',
            errorMessage: `Trường '${key}' không được phép trong mục nhận xét câu hỏi số ${i + 1}.`,
          };
        }
      }

      // exam_question_id
      if (!('exam_question_id' in entry) || !isValidUUID(entry.exam_question_id)) {
        return {
          valid: false,
          errorCode: 'INVALID_INPUT',
          errorMessage: `Trường exam_question_id ở mục số ${i + 1} phải là một UUID hợp lệ.`,
        };
      }

      const qId = entry.exam_question_id;
      if (seenQuestionIds.has(qId)) {
        return {
          valid: false,
          errorCode: 'INVALID_INPUT',
          errorMessage: `Câu hỏi '${qId}' bị trùng lặp trong danh sách nhận xét.`,
        };
      }
      seenQuestionIds.add(qId);

      // teacher_comment
      let commentStr: string | null = null;
      if ('teacher_comment' in entry && entry.teacher_comment !== null && entry.teacher_comment !== undefined) {
        if (typeof entry.teacher_comment !== 'string') {
          return {
            valid: false,
            errorCode: 'INVALID_INPUT',
            errorMessage: `Nhận xét cho câu hỏi số ${i + 1} phải là một chuỗi văn bản hoặc null.`,
          };
        }
        const trimmedComment = entry.teacher_comment.trim();
        if (trimmedComment.length > 2000) {
          return {
            valid: false,
            errorCode: 'INVALID_INPUT',
            errorMessage: `Nhận xét câu hỏi số ${i + 1} không được vượt quá 2000 ký tự.`,
          };
        }
        commentStr = trimmedComment.length > 0 ? trimmedComment : null;
      }

      sanitizedQuestionComments.push({
        exam_question_id: qId,
        teacher_comment: commentStr,
      });
    }
  }

  return {
    valid: true,
    sanitizedData: {
      attempt_id: body.attempt_id,
      expected_version: expVer,
      teacher_feedback: sanitizedTeacherFeedback,
      question_comments: sanitizedQuestionComments,
    },
  };
}
