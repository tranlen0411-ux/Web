// supabase/functions/exam-management-api/validation.ts
// Strict Validation & Sanitization for Exam Builder Management BFF

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isValidUUID(val: unknown): val is string {
  return typeof val === 'string' && UUID_REGEX.test(val.trim());
}

export function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

export function isValidIsoTimestamp(val: unknown): boolean {
  if (val === null || val === undefined) return true;
  if (typeof val !== 'string') return false;
  const parsed = Date.parse(val);
  return !isNaN(parsed);
}

export interface CreateTestPayload {
  title: string;
  subject: string;
  grade_level: number;
  description?: string | null;
}

export function validateCreateTestPayload(raw: unknown): {
  valid: boolean;
  data?: CreateTestPayload;
  errorCode?: string;
  errorMessage?: string;
} {
  if (!isPlainObject(raw)) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Dữ liệu yêu cầu phải là một JSON object.' };
  }

  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title) {
    return { valid: false, errorCode: 'INVALID_TITLE', errorMessage: 'Tiêu đề đề thi không được để trống.' };
  }

  const subject = typeof raw.subject === 'string' ? raw.subject.trim() : '';
  if (!subject) {
    return { valid: false, errorCode: 'INVALID_SUBJECT', errorMessage: 'Môn học không được để trống.' };
  }

  const gradeLevel = Number(raw.grade_level);
  if (!Number.isInteger(gradeLevel) || gradeLevel < 1 || gradeLevel > 12) {
    return { valid: false, errorCode: 'INVALID_GRADE_LEVEL', errorMessage: 'Khối lớp phải từ 1 đến 12.' };
  }

  const description = typeof raw.description === 'string' ? raw.description.trim() : null;

  return {
    valid: true,
    data: {
      title,
      subject,
      grade_level: gradeLevel,
      description,
    },
  };
}

export interface SaveDraftPayload {
  version_id: string;
  title: string;
  subject: string;
  grade_level: number;
  description?: string | null;
  duration_minutes?: number | null;
  starts_at?: string | null;
  last_start_at?: string | null;
  due_date?: string | null;
  max_attempts?: number;
  reward_stars?: number;
  shuffle_questions?: boolean;
  shuffle_options?: boolean;
  tab_switch_policy?: 'OFF' | 'WARN_ONLY' | 'WARN_AND_LOG';
  show_score_after_submit?: boolean;
  show_correct_answers?: boolean;
  questions: Array<Record<string, unknown>>;
}

export function validateSaveDraftPayload(raw: unknown): {
  valid: boolean;
  data?: SaveDraftPayload;
  errorCode?: string;
  errorMessage?: string;
} {
  if (!isPlainObject(raw)) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Dữ liệu yêu cầu phải là một JSON object.' };
  }

  if (!isValidUUID(raw.version_id)) {
    return { valid: false, errorCode: 'INVALID_VERSION_ID', errorMessage: 'Mã phiên bản version_id không hợp lệ.' };
  }

  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title) {
    return { valid: false, errorCode: 'INVALID_TITLE', errorMessage: 'Tiêu đề đề thi không được để trống.' };
  }

  const subject = typeof raw.subject === 'string' ? raw.subject.trim() : '';
  if (!subject) {
    return { valid: false, errorCode: 'INVALID_SUBJECT', errorMessage: 'Môn học không được để trống.' };
  }

  const gradeLevel = Number(raw.grade_level);
  if (!Number.isInteger(gradeLevel) || gradeLevel < 1 || gradeLevel > 12) {
    return { valid: false, errorCode: 'INVALID_GRADE_LEVEL', errorMessage: 'Khối lớp phải từ 1 đến 12.' };
  }

  let durationMinutes: number | null = null;
  if (raw.duration_minutes !== undefined && raw.duration_minutes !== null) {
    const dur = Number(raw.duration_minutes);
    if (!Number.isInteger(dur) || dur < 1 || dur > 300) {
      return { valid: false, errorCode: 'INVALID_DURATION', errorMessage: 'Thời lượng làm bài phải từ 1 đến 300 phút.' };
    }
    durationMinutes = dur;
  }

  const startsAt = raw.starts_at ? String(raw.starts_at).trim() : null;
  if (startsAt && !isValidIsoTimestamp(startsAt)) {
    return { valid: false, errorCode: 'INVALID_STARTS_AT', errorMessage: 'Thời gian mở đề (starts_at) không đúng định dạng.' };
  }

  const lastStartAt = raw.last_start_at ? String(raw.last_start_at).trim() : null;
  if (lastStartAt && !isValidIsoTimestamp(lastStartAt)) {
    return { valid: false, errorCode: 'INVALID_LAST_START_AT', errorMessage: 'Hạn chót vào làm bài (last_start_at) không đúng định dạng.' };
  }

  const dueDate = raw.due_date ? String(raw.due_date).trim() : null;
  if (dueDate && !isValidIsoTimestamp(dueDate)) {
    return { valid: false, errorCode: 'INVALID_DUE_DATE', errorMessage: 'Hạn nộp bài cưỡng chế (due_date) không đúng định dạng.' };
  }

  // Cross-field schedule checks
  if (startsAt && lastStartAt && new Date(lastStartAt).getTime() < new Date(startsAt).getTime()) {
    return { valid: false, errorCode: 'INVALID_SCHEDULE', errorMessage: 'Hạn chót vào làm bài không thể sớm hơn thời gian mở đề.' };
  }

  if (lastStartAt && dueDate && new Date(lastStartAt).getTime() > new Date(dueDate).getTime()) {
    return { valid: false, errorCode: 'INVALID_SCHEDULE', errorMessage: 'Hạn chót vào làm bài không thể muộn hơn hạn nộp bài cưỡng chế.' };
  }

  const maxAttempts = raw.max_attempts !== undefined ? Number(raw.max_attempts) : 1;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) {
    return { valid: false, errorCode: 'INVALID_MAX_ATTEMPTS', errorMessage: 'Số lượt làm tối đa phải từ 1 đến 100.' };
  }

  const rewardStars = raw.reward_stars !== undefined ? Number(raw.reward_stars) : 0;
  if (!Number.isInteger(rewardStars) || rewardStars < 0 || rewardStars > 1000) {
    return { valid: false, errorCode: 'INVALID_REWARD_STARS', errorMessage: 'Sao thưởng phải từ 0 đến 1000.' };
  }

  const tabPolicy = raw.tab_switch_policy === 'OFF' || raw.tab_switch_policy === 'WARN_ONLY' || raw.tab_switch_policy === 'WARN_AND_LOG'
    ? raw.tab_switch_policy
    : 'WARN_AND_LOG';

  if (!Array.isArray(raw.questions)) {
    return { valid: false, errorCode: 'INVALID_QUESTIONS', errorMessage: 'Danh sách câu hỏi questions phải là một mảng.' };
  }

  // Validate question items
  const validQuestions: Array<Record<string, unknown>> = [];
  const seenNumbers = new Set<number>();
  const seenIds = new Set<string>();

  for (let i = 0; i < raw.questions.length; i++) {
    const q = raw.questions[i];
    if (!isPlainObject(q)) {
      return { valid: false, errorCode: 'INVALID_QUESTION_ITEM', errorMessage: `Câu hỏi số ${i + 1} không đúng định dạng.` };
    }

    const qId = typeof q.id === 'string' && isValidUUID(q.id) ? q.id : null;
    if (!qId) {
      return { valid: false, errorCode: 'INVALID_QUESTION_ID', errorMessage: `Câu hỏi số ${i + 1} thiếu ID UUID hợp lệ.` };
    }
    if (seenIds.has(qId)) {
      return { valid: false, errorCode: 'DUPLICATE_QUESTION_ID', errorMessage: `Trùng lặp ID câu hỏi: ${qId}` };
    }
    seenIds.add(qId);

    const qNum = Number(q.question_number);
    if (!Number.isInteger(qNum) || qNum < 1) {
      return { valid: false, errorCode: 'INVALID_QUESTION_NUMBER', errorMessage: `Số thứ tự câu hỏi ${i + 1} không hợp lệ.` };
    }
    if (seenNumbers.has(qNum)) {
      return { valid: false, errorCode: 'DUPLICATE_QUESTION_NUMBER', errorMessage: `Trùng lặp số thứ tự câu hỏi: ${qNum}` };
    }
    seenNumbers.add(qNum);

    const qType = typeof q.question_type === 'string' ? q.question_type : '';
    const allowedTypes = ['single_choice', 'multiple_choice', 'fill_blank', 'short_answer', 'essay', 'image_upload', 'file_upload'];
    if (!allowedTypes.includes(qType)) {
      return { valid: false, errorCode: 'INVALID_QUESTION_TYPE', errorMessage: `Loại câu hỏi không hợp lệ: ${qType}` };
    }

    const prompt = typeof q.prompt === 'string' ? q.prompt.trim() : '';
    if (!prompt) {
      return { valid: false, errorCode: 'INVALID_PROMPT', errorMessage: `Nội dung câu hỏi ${qNum} không được để trống.` };
    }

    const points = Number(q.points);
    if (isNaN(points) || points <= 0) {
      return { valid: false, errorCode: 'INVALID_POINTS', errorMessage: `Điểm số câu ${qNum} phải lớn hơn 0.` };
    }

    let validatedOptionsJson: Array<{ key: string; text: string }> = [];
    let validatedAnswerKey: Record<string, unknown> | null = null;

    if (qType === 'single_choice' || qType === 'multiple_choice') {
      const rawOpts = q.options_json ?? q.options;
      if (!Array.isArray(rawOpts) || rawOpts.length < 2) {
        return {
          valid: false,
          errorCode: 'INVALID_OPTION_SCHEMA',
          errorMessage: `Câu hỏi trắc nghiệm ${qNum} phải có ít nhất 2 lựa chọn dạng mảng đối tượng {key, text}.`,
        };
      }

      const seenOptionKeys = new Set<string>();
      for (let oIdx = 0; oIdx < rawOpts.length; oIdx++) {
        const opt = rawOpts[oIdx];
        if (!isPlainObject(opt)) {
          return {
            valid: false,
            errorCode: 'INVALID_OPTION_SCHEMA',
            errorMessage: `Phương án ${oIdx + 1} của câu ${qNum} phải là đối tượng có thuộc tính 'key' và 'text'.`,
          };
        }

        const optKey = typeof opt.key === 'string' ? opt.key.trim() : '';
        if (!optKey) {
          return {
            valid: false,
            errorCode: 'INVALID_OPTION_SCHEMA',
            errorMessage: `Thuộc tính 'key' của phương án ${oIdx + 1} câu ${qNum} không được để trống.`,
          };
        }

        if (seenOptionKeys.has(optKey)) {
          return {
            valid: false,
            errorCode: 'DUPLICATE_OPTION_KEY',
            errorMessage: `Trùng lặp key '${optKey}' trong các phương án của câu ${qNum}.`,
          };
        }
        seenOptionKeys.add(optKey);

        if (typeof opt.text !== 'string') {
          return {
            valid: false,
            errorCode: 'INVALID_OPTION_SCHEMA',
            errorMessage: `Nội dung phương án '${optKey}' của câu ${qNum} phải là chuỗi văn bản (string).`,
          };
        }

        const trimmedText = opt.text.trim();
        if (!trimmedText) {
          return {
            valid: false,
            errorCode: 'INVALID_OPTION_SCHEMA',
            errorMessage: `Nội dung phương án '${optKey}' của câu ${qNum} không được để trống hoặc chỉ chứa khoảng trắng.`,
          };
        }

        validatedOptionsJson.push({
          key: optKey,
          text: trimmedText,
        });
      }

      // Validate answer_key for choice questions
      const rawAnsKey = q.answer_key ?? q.correct_answer_key ?? (q.correct_answer !== undefined ? { correct_answer: q.correct_answer } : null);
      if (!isPlainObject(rawAnsKey)) {
        return {
          valid: false,
          errorCode: 'INVALID_ANSWER_KEY',
          errorMessage: `Câu hỏi ${qNum} phải có cấu hình đáp án đúng (answer_key).`,
        };
      }

      if (qType === 'single_choice') {
        const correctAns = typeof rawAnsKey.correct_answer === 'string' ? rawAnsKey.correct_answer.trim() : '';
        if (!correctAns || !seenOptionKeys.has(correctAns)) {
          return {
            valid: false,
            errorCode: 'INVALID_ANSWER_KEY',
            errorMessage: `Đáp án đúng của câu ${qNum} ('${correctAns}') phải là một key hợp lệ tồn tại trong options_json.`,
          };
        }
        validatedAnswerKey = { correct_answer: correctAns };
      } else if (qType === 'multiple_choice') {
        const correctList = Array.isArray(rawAnsKey.correct_answer)
          ? rawAnsKey.correct_answer
          : (typeof rawAnsKey.correct_answer === 'string' ? [rawAnsKey.correct_answer] : []);

        if (correctList.length === 0) {
          return {
            valid: false,
            errorCode: 'INVALID_ANSWER_KEY',
            errorMessage: `Câu hỏi ${qNum} phải có ít nhất 1 đáp án đúng.`,
          };
        }
        for (const k of correctList) {
          if (typeof k !== 'string' || !seenOptionKeys.has(k.trim())) {
            return {
              valid: false,
              errorCode: 'INVALID_ANSWER_KEY',
              errorMessage: `Đáp án đúng '${k}' của câu ${qNum} không tồn tại trong options_json.`,
            };
          }
        }
        validatedAnswerKey = { correct_answer: correctList.map((k: string) => k.trim()) };
      }
    } else if (qType === 'fill_blank' || qType === 'short_answer') {
      validatedOptionsJson = [];
      const rawAnsKey = q.answer_key ?? q.correct_answer_key ?? (q.correct_answer !== undefined ? { correct_answer: q.correct_answer } : null);
      if (!isPlainObject(rawAnsKey) || rawAnsKey.correct_answer === undefined || rawAnsKey.correct_answer === null || String(rawAnsKey.correct_answer).trim() === '') {
        return {
          valid: false,
          errorCode: 'INVALID_ANSWER_KEY',
          errorMessage: `Câu hỏi ${qNum} phải có đáp án đúng.`,
        };
      }
      validatedAnswerKey = { correct_answer: String(rawAnsKey.correct_answer).trim() };
    } else {
      // essay, image_upload, file_upload
      validatedOptionsJson = [];
      validatedAnswerKey = null; // No objective answer key
    }

    validQuestions.push({
      id: qId,
      question_number: qNum,
      question_type: qType,
      prompt,
      points,
      options_json: validatedOptionsJson,
      source_question_bank_item_id: isValidUUID(q.source_question_bank_item_id) ? q.source_question_bank_item_id : null,
      source_question_bank_version_id: isValidUUID(q.source_question_bank_version_id) ? q.source_question_bank_version_id : null,
      answer_key: validatedAnswerKey,
    });
  }

  return {
    valid: true,
    data: {
      version_id: raw.version_id,
      title,
      subject,
      grade_level: gradeLevel,
      description: typeof raw.description === 'string' ? raw.description.trim() : null,
      duration_minutes: durationMinutes,
      starts_at: startsAt,
      last_start_at: lastStartAt,
      due_date: dueDate,
      max_attempts: maxAttempts,
      reward_stars: rewardStars,
      shuffle_questions: Boolean(raw.shuffle_questions),
      shuffle_options: Boolean(raw.shuffle_options),
      tab_switch_policy: tabPolicy,
      show_score_after_submit: raw.show_score_after_submit !== undefined ? Boolean(raw.show_score_after_submit) : true,
      show_correct_answers: Boolean(raw.show_correct_answers),
      questions: validQuestions,
    },
  };
}

export interface PublishPayload {
  version_id: string;
}

export function validatePublishPayload(raw: unknown): {
  valid: boolean;
  data?: PublishPayload;
  errorCode?: string;
  errorMessage?: string;
} {
  if (!isPlainObject(raw) || !isValidUUID(raw.version_id)) {
    return { valid: false, errorCode: 'INVALID_VERSION_ID', errorMessage: 'version_id không hợp lệ.' };
  }
  return { valid: true, data: { version_id: raw.version_id } };
}

export interface CreateAssignmentPayload {
  assignment_id?: string;
  exam_version_id: string;
  class_id: string;
  due_date?: string | null;
  starts_at?: string | null;
  last_start_at?: string | null;
  counts_toward_ranking?: boolean;
}

export function validateCreateAssignmentPayload(raw: unknown): {
  valid: boolean;
  data?: CreateAssignmentPayload;
  errorCode?: string;
  errorMessage?: string;
} {
  if (!isPlainObject(raw)) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Dữ liệu yêu cầu phải là JSON object.' };
  }

  if (!isValidUUID(raw.exam_version_id)) {
    return { valid: false, errorCode: 'INVALID_VERSION_ID', errorMessage: 'exam_version_id không hợp lệ.' };
  }

  if (!isValidUUID(raw.class_id)) {
    return { valid: false, errorCode: 'INVALID_CLASS_ID', errorMessage: 'class_id không hợp lệ.' };
  }

  const assignmentId = isValidUUID(raw.assignment_id) ? raw.assignment_id : undefined;
  const startsAt = raw.starts_at ? String(raw.starts_at).trim() : null;
  const lastStartAt = raw.last_start_at ? String(raw.last_start_at).trim() : null;
  const dueDate = raw.due_date ? String(raw.due_date).trim() : null;

  if (startsAt && !isValidIsoTimestamp(startsAt)) {
    return { valid: false, errorCode: 'INVALID_STARTS_AT', errorMessage: 'Thời gian mở đề không đúng định dạng.' };
  }
  if (lastStartAt && !isValidIsoTimestamp(lastStartAt)) {
    return { valid: false, errorCode: 'INVALID_LAST_START_AT', errorMessage: 'Hạn chót vào làm không đúng định dạng.' };
  }
  if (dueDate && !isValidIsoTimestamp(dueDate)) {
    return { valid: false, errorCode: 'INVALID_DUE_DATE', errorMessage: 'Hạn nộp bài không đúng định dạng.' };
  }

  if (startsAt && lastStartAt && new Date(lastStartAt).getTime() < new Date(startsAt).getTime()) {
    return { valid: false, errorCode: 'INVALID_SCHEDULE', errorMessage: 'Hạn chót vào làm bài không thể sớm hơn thời gian mở đề.' };
  }

  return {
    valid: true,
    data: {
      assignment_id: assignmentId,
      exam_version_id: raw.exam_version_id,
      class_id: raw.class_id,
      starts_at: startsAt,
      last_start_at: lastStartAt,
      due_date: dueDate,
      counts_toward_ranking: raw.counts_toward_ranking !== undefined ? Boolean(raw.counts_toward_ranking) : true,
    },
  };
}

export interface ListExamAttemptsParams {
  exam_id?: string;
  version_id?: string;
  class_id?: string;
}

export function validateListExamAttemptsParams(params: {
  exam_id?: string | null;
  version_id?: string | null;
  class_id?: string | null;
}): {
  valid: boolean;
  data?: ListExamAttemptsParams;
  errorCode?: string;
  errorMessage?: string;
} {
  const examId = params.exam_id ? params.exam_id.trim() : undefined;
  const versionId = params.version_id ? params.version_id.trim() : undefined;
  const classId = params.class_id ? params.class_id.trim() : undefined;

  if (!examId && !versionId) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Yêu cầu tham số exam_id hoặc version_id để tải danh sách bài làm.',
    };
  }

  if (examId && !isValidUUID(examId)) {
    return {
      valid: false,
      errorCode: 'INVALID_EXAM_ID',
      errorMessage: 'Mã exam_id không phải UUID hợp lệ.',
    };
  }

  if (versionId && !isValidUUID(versionId)) {
    return {
      valid: false,
      errorCode: 'INVALID_VERSION_ID',
      errorMessage: 'Mã version_id không phải UUID hợp lệ.',
    };
  }

  if (classId && !isValidUUID(classId)) {
    return {
      valid: false,
      errorCode: 'INVALID_CLASS_ID',
      errorMessage: 'Mã class_id không phải UUID hợp lệ.',
    };
  }

  return {
    valid: true,
    data: {
      exam_id: examId,
      version_id: versionId,
      class_id: classId,
    },
  };
}

export interface GetAttemptDetailParams {
  attempt_id: string;
}

export function validateGetAttemptDetailParams(params: {
  attempt_id?: string | null;
}): {
  valid: boolean;
  data?: GetAttemptDetailParams;
  errorCode?: string;
  errorMessage?: string;
} {
  const attemptId = params.attempt_id ? params.attempt_id.trim() : '';

  if (!attemptId || !isValidUUID(attemptId)) {
    return {
      valid: false,
      errorCode: 'INVALID_ATTEMPT_ID',
      errorMessage: 'Mã attempt_id là bắt buộc và phải là một UUID hợp lệ.',
    };
  }

  return {
    valid: true,
    data: {
      attempt_id: attemptId,
    },
  };
}

export interface ImportQuestionBankPayload {
  version_id: string;
  exam_id?: string | null;
  question_bank_item_ids: string[];
}

export function validateImportQuestionBankPayload(raw: unknown): {
  valid: boolean;
  data?: ImportQuestionBankPayload;
  errorCode?: string;
  errorMessage?: string;
} {
  if (!isPlainObject(raw)) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Dữ liệu yêu cầu phải là một JSON object.' };
  }

  const rawVersionId = (raw as any).version_id;
  if (!rawVersionId || typeof rawVersionId !== 'string' || !isValidUUID(rawVersionId)) {
    return { valid: false, errorCode: 'INVALID_VERSION_ID', errorMessage: 'Mã version_id bắt buộc và phải đúng định dạng UUID.' };
  }
  const versionId = rawVersionId.trim();

  const rawIds = (raw as any).question_bank_item_ids ?? (raw as any).question_bank_ids ?? (raw as any).item_ids;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return { valid: false, errorCode: 'INVALID_QUESTION_BANK_IDS', errorMessage: 'Danh sách question_bank_item_ids không được để trống.' };
  }

  if (rawIds.length > 100) {
    return { valid: false, errorCode: 'INVALID_BATCH_SIZE', errorMessage: 'Không thể nhập quá 100 câu hỏi trong một lần.' };
  }

  const validIds: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rawIds.length; i++) {
    const id = typeof rawIds[i] === 'string' ? rawIds[i].trim() : '';
    if (!isValidUUID(id)) {
      return { valid: false, errorCode: 'INVALID_QUESTION_BANK_ID', errorMessage: `ID câu hỏi thứ ${i + 1} không đúng định dạng UUID.` };
    }
    if (!seen.has(id)) {
      seen.add(id);
      validIds.push(id);
    }
  }

  let examId: string | null = null;
  if ((raw as any).exam_id) {
    if (!isValidUUID((raw as any).exam_id)) {
      return { valid: false, errorCode: 'INVALID_EXAM_ID', errorMessage: 'Mã exam_id không đúng định dạng UUID.' };
    }
    examId = (raw as any).exam_id.trim();
  }

  return {
    valid: true,
    data: {
      version_id: versionId,
      exam_id: examId,
      question_bank_item_ids: validIds,
    },
  };
}

export interface DeleteTestPayload {
  exam_id: string;
}

export function validateDeleteTestPayload(raw: unknown): {
  valid: boolean;
  data?: DeleteTestPayload;
  errorCode?: string;
  errorMessage?: string;
} {
  if (!isPlainObject(raw)) {
    return { valid: false, errorCode: 'INVALID_INPUT', errorMessage: 'Dữ liệu yêu cầu phải là một JSON object.' };
  }

  const rawExamId = (raw as any).exam_id ?? (raw as any).examId ?? (raw as any).id;
  if (!rawExamId || typeof rawExamId !== 'string' || !isValidUUID(rawExamId)) {
    return { valid: false, errorCode: 'INVALID_EXAM_ID', errorMessage: 'Mã exam_id bắt buộc và phải đúng định dạng UUID.' };
  }

  return {
    valid: true,
    data: {
      exam_id: rawExamId.trim(),
    },
  };
}



