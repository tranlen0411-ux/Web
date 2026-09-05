// src/utils/questionBankAdapters.js
// Adapter chuẩn hóa dữ liệu từ các nguồn (Form, Excel/Word, Bài tập học thuật) sang Question Bank Contract V2A

/**
 * Chuẩn hóa chuỗi prompt để phục vụ kiểm tra trùng lặp
 * @param {string} prompt
 * @returns {string}
 */
export const normalizePromptForDuplicateCheck = (prompt) => {
  if (!prompt || typeof prompt !== 'string') return '';
  return prompt
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
};

/**
 * Tạo khóa định danh duy nhất phục vụ so khớp trùng lặp chính xác (Exact Normalized Duplicate Key)
 * Bao gồm: normalized prompt, question_type, subject, grade_level, visibility
 * Tuyệt đối KHÔNG dùng: difficulty, metadata, imported_at, title, answer_key
 * Nếu thiếu bất kỳ trường bắt buộc nào -> trả về null (fail-closed)
 *
 * @param {Object} question
 * @returns {string|null}
 */
export const buildQuestionDuplicateKey = (question) => {
  if (!question || typeof question !== 'object') return null;

  const rawPrompt = question.prompt || (typeof question.version?.prompt === 'string' ? question.version.prompt : '');
  const normalizedPrompt = normalizePromptForDuplicateCheck(rawPrompt);
  if (!normalizedPrompt) return null;

  if (!question.question_type || typeof question.question_type !== 'string') return null;
  const normalizedType = question.question_type.trim().toLowerCase();
  if (!normalizedType) return null;

  if (!question.subject || typeof question.subject !== 'string') return null;
  const normalizedSubject = question.subject.trim().toLowerCase();
  if (!normalizedSubject) return null;

  const rawGrade = question.grade_level;
  if (rawGrade === undefined || rawGrade === null || String(rawGrade).trim() === '') return null;
  const normalizedGrade = Number(rawGrade);
  if (isNaN(normalizedGrade)) return null;

  if (!question.visibility || typeof question.visibility !== 'string') return null;
  const normalizedVisibility = question.visibility.trim().toLowerCase();
  if (!normalizedVisibility) return null;

  return [
    normalizedPrompt,
    normalizedType,
    normalizedSubject,
    normalizedGrade,
    normalizedVisibility
  ].join('||');
};

/**
 * Tạo khóa định danh cho câu hỏi đã lưu lấy từ danh sách (List questions API / rpc_qb_list_questions)
 * API trả về prompt_snippet = left(prompt, 150) thay vì prompt đầy đủ.
 * Yêu cầu bắt buộc: question_type, subject, grade_level, visibility, prompt_snippet
 * Nếu thiếu bất kỳ trường nào -> trả về null (fail-closed)
 *
 * @param {Object} item
 * @returns {string|null}
 */
export const buildExistingListDuplicateKey = (item) => {
  if (!item || typeof item !== 'object') return null;

  const rawSnippet = item.prompt_snippet !== undefined && item.prompt_snippet !== null
    ? String(item.prompt_snippet)
    : (typeof item.version?.prompt_snippet === 'string' ? item.version.prompt_snippet : '');
  const normalizedSnippet = normalizePromptForDuplicateCheck(rawSnippet);
  if (!normalizedSnippet) return null;

  if (!item.question_type || typeof item.question_type !== 'string') return null;
  const normalizedType = item.question_type.trim().toLowerCase();
  if (!normalizedType) return null;

  if (!item.subject || typeof item.subject !== 'string') return null;
  const normalizedSubject = item.subject.trim().toLowerCase();
  if (!normalizedSubject) return null;

  const rawGrade = item.grade_level;
  if (rawGrade === undefined || rawGrade === null || String(rawGrade).trim() === '') return null;
  const normalizedGrade = Number(rawGrade);
  if (isNaN(normalizedGrade)) return null;

  if (!item.visibility || typeof item.visibility !== 'string') return null;
  const normalizedVisibility = item.visibility.trim().toLowerCase();
  if (!normalizedVisibility) return null;

  return [
    normalizedSnippet,
    normalizedType,
    normalizedSubject,
    normalizedGrade,
    normalizedVisibility
  ].join('||');
};

/**
 * Tạo khóa định danh tương thích danh sách cho câu hỏi ứng viên (candidate imported question).
 * Chỉ tạo khóa khi prompt gốc có độ dài <= 150 ký tự (do list API chỉ trả về tối đa 150 ký tự).
 * Nếu raw prompt > 150 ký tự -> trả về null (fail-safe để tránh so khớp sai do cắt chuỗi).
 *
 * @param {Object} question
 * @param {Object} effectiveOverrides
 * @returns {string|null}
 */
export const buildCandidateListDuplicateKey = (question, effectiveOverrides = {}) => {
  if (!question || typeof question !== 'object') return null;

  const rawPrompt = effectiveOverrides.prompt !== undefined
    ? effectiveOverrides.prompt
    : (question.prompt || (typeof question.version?.prompt === 'string' ? question.version.prompt : ''));

  if (!rawPrompt || typeof rawPrompt !== 'string') return null;
  if (rawPrompt.length > 150) return null;

  const normalizedPrompt = normalizePromptForDuplicateCheck(rawPrompt);
  if (!normalizedPrompt) return null;

  const rawType = effectiveOverrides.question_type !== undefined
    ? effectiveOverrides.question_type
    : question.question_type;
  if (!rawType || typeof rawType !== 'string') return null;
  const normalizedType = rawType.trim().toLowerCase();
  if (!normalizedType) return null;

  const rawSubject = effectiveOverrides.subject !== undefined
    ? effectiveOverrides.subject
    : question.subject;
  if (!rawSubject || typeof rawSubject !== 'string') return null;
  const normalizedSubject = rawSubject.trim().toLowerCase();
  if (!normalizedSubject) return null;

  const rawGrade = effectiveOverrides.grade_level !== undefined
    ? effectiveOverrides.grade_level
    : question.grade_level;
  if (rawGrade === undefined || rawGrade === null || String(rawGrade).trim() === '') return null;
  const normalizedGrade = Number(rawGrade);
  if (isNaN(normalizedGrade)) return null;

  const rawVisibility = effectiveOverrides.visibility !== undefined
    ? effectiveOverrides.visibility
    : question.visibility;
  if (!rawVisibility || typeof rawVisibility !== 'string') return null;
  const normalizedVisibility = rawVisibility.trim().toLowerCase();
  if (!normalizedVisibility) return null;

  return [
    normalizedPrompt,
    normalizedType,
    normalizedSubject,
    normalizedGrade,
    normalizedVisibility
  ].join('||');
};

/**
 * Kiểm tra các câu hỏi bị trùng lặp trong cùng một danh sách file tải lên
 * @param {Array} questions
 * @returns {Set<number>} Tập hợp các index bị trùng lặp trong file
 */
export const findDuplicatesInQuestionList = (questions) => {
  const seen = new Map();
  const duplicateIndexes = new Set();

  (questions || []).forEach((q, idx) => {
    const rawPrompt = q?.prompt || (typeof q?.version?.prompt === 'string' ? q.version.prompt : '');
    const norm = normalizePromptForDuplicateCheck(rawPrompt);
    if (!norm) return;
    if (seen.has(norm)) {
      duplicateIndexes.add(idx);
    } else {
      seen.set(norm, idx);
    }
  });

  return duplicateIndexes;
};

/**
 * Tìm tập hợp index của các candidate questions đã tồn tại trong Question Bank
 * So khớp dựa trên list contract (prompt_snippet <= 150 ký tự)
 *
 * @param {Array<Object>} candidateQuestions Danh sách câu hỏi ứng viên từ file import
 * @param {Array<Object>} existingQuestions Danh sách câu hỏi đã lưu lấy từ BFF listQuestions
 * @param {Object} batchDefaults { subject, grade_level, visibility }
 * @param {string} role 'teacher' | 'admin'
 * @returns {Set<number>} Set các index của candidateQuestions bị trùng với existing bank
 */
export const findExistingQuestionDuplicateIndices = (
  candidateQuestions = [],
  existingQuestions = [],
  batchDefaults = {},
  role = 'teacher'
) => {
  const existingKeySet = new Set();

  (existingQuestions || []).forEach((eq) => {
    const key = buildExistingListDuplicateKey(eq);
    if (key) {
      existingKeySet.add(key);
    }
  });

  const duplicateIndices = new Set();

  (candidateQuestions || []).forEach((q, idx) => {
    const effectiveSubject = q?.subject || batchDefaults?.subject || '';
    const effectiveGrade = q?.grade_level !== undefined && q?.grade_level !== null && String(q?.grade_level).trim() !== ''
      ? q.grade_level
      : (batchDefaults?.grade_level !== undefined && batchDefaults?.grade_level !== null ? batchDefaults.grade_level : batchDefaults?.grade);
    const effectiveVisibility = role === 'admin'
      ? (batchDefaults?.visibility || 'private')
      : 'private';
    const effectiveType = q?.question_type;
    const effectivePrompt = q?.prompt || (typeof q?.version?.prompt === 'string' ? q.version.prompt : '');

    const effectiveQ = {
      ...q,
      prompt: effectivePrompt,
      question_type: effectiveType,
      subject: effectiveSubject,
      grade_level: effectiveGrade,
      visibility: effectiveVisibility
    };

    const candidateKey = buildCandidateListDuplicateKey(effectiveQ);
    if (candidateKey && existingKeySet.has(candidateKey)) {
      duplicateIndices.add(idx);
    }
  });

  return duplicateIndices;
};

/**
 * Chuyển đổi danh sách options dạng chuỗi hoặc object sang cấu trúc stable IDs
 * @param {Array<string|Object>} rawOptions
 * @returns {Array<{ id: string, text: string }>}
 */
export const normalizeOptionsToStableIds = (rawOptions) => {
  if (!Array.isArray(rawOptions)) return [];

  return rawOptions.map((opt, idx) => {
    const stableId = `opt_${idx + 1}`;
    if (typeof opt === 'string') {
      return { id: stableId, text: opt.trim() };
    }
    if (opt && typeof opt === 'object') {
      return {
        id: opt.id && typeof opt.id === 'string' && opt.id.trim() !== '' ? opt.id.trim() : stableId,
        text: typeof opt.text === 'string' ? opt.text.trim() : String(opt.text || '').trim()
      };
    }
    return { id: stableId, text: String(opt || '').trim() };
  });
};

/**
 * Tạo answer_key chuẩn cho dạng single_choice
 * @param {Array<{ id: string, text: string }>} options
 * @param {string|number} rawCorrectAnswer
 * @returns {{ correct_option_id: string }}
 */
export const buildSingleChoiceAnswerKey = (options, rawCorrectAnswer) => {
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error('Dạng trắc nghiệm một đáp án yêu cầu danh sách các lựa chọn.');
  }

  if (rawCorrectAnswer === undefined || rawCorrectAnswer === null || String(rawCorrectAnswer).trim() === '') {
    throw new Error('Chưa chọn đáp án đúng cho câu hỏi trắc nghiệm một đáp án.');
  }

  const rawStr = String(rawCorrectAnswer).trim();

  // 1. Kiểm tra nếu rawStr khớp trực tiếp với option ID
  const directMatch = options.find((o) => o.id === rawStr);
  if (directMatch) {
    return { correct_option_id: directMatch.id };
  }

  // 2. Kiểm tra nếu rawStr khớp với text của option
  const textMatch = options.find(
    (o) => o.text.toLowerCase() === rawStr.toLowerCase()
  );
  if (textMatch) {
    return { correct_option_id: textMatch.id };
  }

  // 3. Kiểm tra nếu rawStr là chữ cái A, B, C, D... hoặc chỉ số 1, 2, 3, 4
  const letterMatch = rawStr.toUpperCase().match(/^([A-Z])$/);
  if (letterMatch) {
    const letterIdx = letterMatch[1].charCodeAt(0) - 65; // A -> 0, B -> 1
    if (letterIdx >= 0 && letterIdx < options.length) {
      return { correct_option_id: options[letterIdx].id };
    }
  }

  const numIdx = parseInt(rawStr, 10);
  if (!isNaN(numIdx) && numIdx >= 1 && numIdx <= options.length) {
    return { correct_option_id: options[numIdx - 1].id };
  }

  throw new Error(`Không thể xác định đáp án đúng "${rawStr}" trong các lựa chọn có sẵn.`);
};

/**
 * Tạo answer_key chuẩn cho dạng multiple_choice (FAIL-CLOSED)
 * @param {Array<{ id: string, text: string }>} options
 * @param {Array<string>|string} rawCorrectAnswers
 * @returns {{ correct_option_ids: string[] }}
 */
export const buildMultipleChoiceAnswerKey = (options, rawCorrectAnswers) => {
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error('Dạng trắc nghiệm nhiều đáp án yêu cầu danh sách các lựa chọn.');
  }

  let answersArr = [];
  if (Array.isArray(rawCorrectAnswers)) {
    answersArr = rawCorrectAnswers.map((s) => String(s).trim()).filter(Boolean);
  } else if (typeof rawCorrectAnswers === 'string') {
    answersArr = rawCorrectAnswers.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
  }

  if (answersArr.length === 0) {
    throw new Error('Dạng trắc nghiệm nhiều đáp án yêu cầu chọn ít nhất 1 đáp án đúng.');
  }

  const correctIds = [];
  for (const ans of answersArr) {
    const ansStr = String(ans).trim();
    let matchedId = null;

    // 1. Direct ID match
    const directMatch = options.find((o) => o.id === ansStr);
    if (directMatch) {
      matchedId = directMatch.id;
    } else {
      // 2. Text match
      const textMatch = options.find((o) => o.text.toLowerCase() === ansStr.toLowerCase());
      if (textMatch) {
        matchedId = textMatch.id;
      } else {
        // 3. Letter match A, B, C...
        const letterMatch = ansStr.toUpperCase().match(/^([A-Z])$/);
        if (letterMatch) {
          const idx = letterMatch[1].charCodeAt(0) - 65;
          if (idx >= 0 && idx < options.length) {
            matchedId = options[idx].id;
          }
        }
      }
    }

    if (!matchedId) {
      throw new Error(`Không thể ánh xạ đáp án đúng "${ansStr}" sang lựa chọn hợp lệ nào trong danh sách.`);
    }

    if (!correctIds.includes(matchedId)) {
      correctIds.push(matchedId);
    }
  }

  if (correctIds.length === 0) {
    throw new Error('Không thể ánh xạ danh sách đáp án đúng sang mã lựa chọn.');
  }

  return { correct_option_ids: correctIds };
};

/**
 * Chuyển đổi dữ liệu câu hỏi bất kỳ sang Question Bank Payload hợp lệ
 * @param {Object} input
 * @param {Object} contextOptions { role: 'teacher'|'admin', defaultSubject, defaultGrade, defaultDifficulty, defaultVisibility, metadata }
 * @returns {Object} Compliant Question Bank create payload
 */
export const toQuestionBankPayload = (input = {}, contextOptions = {}) => {
  if (!input || typeof input !== 'object') {
    throw new Error('Dữ liệu câu hỏi đầu vào không hợp lệ.');
  }

  const rawPrompt = String(input.prompt || input.content || input.title || '').trim();
  if (!rawPrompt) {
    throw new Error('Nội dung câu hỏi (prompt) không được để trống.');
  }

  // 1. Tiêu đề (Title)
  let title = String(input.title || '').trim();
  if (!title) {
    title = rawPrompt.length > 80 ? rawPrompt.slice(0, 77) + '...' : rawPrompt;
  }

  // 2. Dạng câu hỏi (Question Type)
  let qType = String(input.question_type || input.type || 'single_choice').toLowerCase().trim();
  if (qType === 'multiple_choice' && input.is_single_choice === true) {
    qType = 'single_choice';
  }
  // Map legacy type names
  if (qType === 'choice' || qType === 'trac_nghiem') qType = 'single_choice';
  if (qType === 'dien_khuyet') qType = 'fill_blank';
  if (qType === 'tu_luan') qType = 'essay';
  if (qType === 'tra_loi_ngan') qType = 'short_answer';

  const validTypes = [
    'single_choice',
    'multiple_choice',
    'fill_blank',
    'short_answer',
    'essay',
    'image_upload',
    'file_upload'
  ];

  if (!validTypes.includes(qType)) {
    throw new Error(`Dạng câu hỏi "${qType}" không được hỗ trợ trong Question Bank.`);
  }

  if (qType === 'image_upload' || qType === 'file_upload') {
    throw new Error('Dạng câu hỏi tải ảnh/tệp sẽ được hỗ trợ ở phiên bản tiếp theo.');
  }

  // 3. Môn học & Khối lớp & Độ khó
  const subject = String(input.subject || contextOptions.defaultSubject || 'Toán').trim();
  let gradeLevel = input.grade_level !== undefined && input.grade_level !== null ? Number(input.grade_level) : (contextOptions.defaultGrade ? Number(contextOptions.defaultGrade) : null);
  if (gradeLevel !== null && (isNaN(gradeLevel) || gradeLevel < 1 || gradeLevel > 12)) {
    gradeLevel = null;
  }

  let difficulty = String(input.difficulty || contextOptions.defaultDifficulty || 'medium').toLowerCase().trim();
  if (!['easy', 'medium', 'hard', 'expert'].includes(difficulty)) {
    difficulty = 'medium';
  }

  // 4. Quyền hiển thị (Visibility)
  let visibility = String(input.visibility || contextOptions.defaultVisibility || 'private').toLowerCase().trim();
  const userRole = contextOptions.role || 'teacher';

  if (userRole === 'teacher') {
    // Giáo viên BẮT BUỘC chỉ được tạo câu hỏi private trong V2A
    visibility = 'private';
  } else if (userRole === 'admin') {
    if (visibility !== 'public_template' && visibility !== 'private') {
      visibility = 'private';
    }
  } else {
    visibility = 'private';
  }

  // Tuyệt đối chặn school_shared ở V2A
  if (visibility === 'school_shared') {
    visibility = 'private';
  }

  // 5. Chuẩn hóa Options & Answer Key theo contract
  let options = null;
  let answerKey = {};

  if (qType === 'single_choice') {
    const rawOpts = input.options || input.options_json || [];
    options = normalizeOptionsToStableIds(rawOpts);
    const rawAnswer = input.correct_answer !== undefined ? input.correct_answer : (input.answer_key?.correct_option_id || input.correct_answer_key?.correct_answer);
    answerKey = buildSingleChoiceAnswerKey(options, rawAnswer);
  } else if (qType === 'multiple_choice') {
    const rawOpts = input.options || input.options_json || [];
    options = normalizeOptionsToStableIds(rawOpts);
    const rawAnswers = input.correct_answers || input.correct_answers_json || input.answer_key?.correct_option_ids || input.correct_answer_key?.accepted_answers || input.correct_answer;
    answerKey = buildMultipleChoiceAnswerKey(options, rawAnswers);
  } else if (qType === 'fill_blank') {
    let answers = [];
    if (Array.isArray(input.correct_answers)) {
      answers = input.correct_answers.map((a) => String(a).trim()).filter(Boolean);
    } else if (input.correct_answer_key?.accepted_answers && Array.isArray(input.correct_answer_key.accepted_answers)) {
      answers = input.correct_answer_key.accepted_answers.map((a) => String(a).trim()).filter(Boolean);
    } else if (input.correct_answer !== undefined && String(input.correct_answer).trim() !== '') {
      answers = [String(input.correct_answer).trim()];
    } else if (input.answer_key?.correct_answers && Array.isArray(input.answer_key.correct_answers)) {
      answers = input.answer_key.correct_answers.map((a) => String(a).trim()).filter(Boolean);
    }

    if (answers.length === 0) {
      throw new Error('Dạng điền khuyết yêu cầu ít nhất 1 đáp án chuẩn.');
    }
    answerKey = { correct_answers: answers };
  } else if (qType === 'short_answer') {
    let answers = [];
    if (Array.isArray(input.correct_answers)) {
      answers = input.correct_answers.map((a) => String(a).trim()).filter(Boolean);
    } else if (input.correct_answer !== undefined && String(input.correct_answer).trim() !== '') {
      answers = [String(input.correct_answer).trim()];
    } else if (input.answer_key?.correct_answers && Array.isArray(input.answer_key.correct_answers)) {
      answers = input.answer_key.correct_answers.map((a) => String(a).trim()).filter(Boolean);
    }
    if (answers.length === 0) {
      throw new Error('Dạng trả lời ngắn yêu cầu ít nhất 1 đáp án chuẩn.');
    }
    answerKey = { correct_answers: answers };
  } else if (qType === 'essay') {
    // Essay: BFF yêu cầu answer_key là plain object {}, rubric đặt trong explanation/metadata
    answerKey = {};
  }

  // 6. Metadata nguồn truy vết
  const metadata = {
    ...(input.metadata || {}),
    ...(contextOptions.metadata || {}),
    adapted_at: new Date().toISOString()
  };

  // 7. Hoàn thiện Payload (TUYỆT ĐỐI KHÔNG CHỨA CÁC TRƯỜNG CẤM)
  const payload = {
    title,
    question_type: qType,
    subject,
    grade_level: gradeLevel,
    difficulty,
    visibility,
    prompt: rawPrompt,
    options: options && options.length > 0 ? options : [],
    answer_key: answerKey,
    hints: Array.isArray(input.hints) ? input.hints.map(String) : [],
    explanation: input.explanation ? String(input.explanation).trim() : null,
    tags: Array.isArray(input.tags)
      ? input.tags.map(String)
      : typeof input.tags === 'string'
        ? input.tags.split(',').map(s => s.trim()).filter(Boolean)
        : [],
    media_urls: Array.isArray(input.media_urls) ? input.media_urls.map(String) : [],
    metadata
  };

  // Xóa sạch các trường cấm nếu tình cờ lọt vào
  delete payload.caller_id;
  delete payload.actor_role;
  delete payload.school_id;
  delete payload.server_grading;
  delete payload['service_role'];

  return payload;
};

/**
 * Chuyển đổi một câu hỏi từ Question Bank (với Snapshot Version & Answer Key) sang Academic Exercise Payload
 * @param {Object} item Thông tin item câu hỏi từ Question Bank
 * @param {Object} version Thông tin snapshot version hiện tại của câu hỏi
 * @param {Object} [answerKey] Thông tin đáp án từ authoring detail
 * @param {Object} [options] Các tùy chỉnh bài tập (title, due_date, reward_stars, counts_toward_ranking)
 * @returns {{ exercise: Object, questions: Array }}
 */
export const transformQuestionBankToAcademicExercise = (item, version, answerKey = null, options = {}) => {
  if (!item || typeof item !== 'object') {
    throw new Error('Thông tin câu hỏi Question Bank không hợp lệ.');
  }
  if (!version || typeof version !== 'object') {
    throw new Error('Thông tin phiên bản Question Bank không hợp lệ.');
  }

  const qType = item.question_type || version.question_type || 'single_choice';
  const prompt = version.prompt || item.title || '(Không có nội dung)';
  
  // Trích xuất options_json thành mảng chuỗi
  const rawOpts = Array.isArray(version.options) ? version.options : [];
  const options_json = rawOpts.map((opt) => {
    if (typeof opt === 'string') return opt.trim();
    if (opt && typeof opt === 'object' && typeof opt.text === 'string') return opt.text.trim();
    return String(opt).trim();
  });

  // Map answer key - Strict Fail-Closed (No dangerous fallback)
  let correct_answer_key = null;
  const ca = answerKey?.correct_answers;

  if (qType === 'single_choice') {
    const correctOptId = ca?.correct_option_id || (typeof ca === 'string' ? ca : '');
    if (!correctOptId) {
      throw new Error('Không thể xác định đáp án đúng từ phiên bản Question Bank. Không được phép giao bài.');
    }

    const foundOpt = rawOpts.find((o) => (typeof o === 'object' && o?.id === correctOptId) || o === correctOptId);
    if (!foundOpt) {
      throw new Error('Không thể xác định đáp án đúng từ phiên bản Question Bank. Không được phép giao bài.');
    }

    const correctText = (typeof foundOpt === 'object' ? foundOpt.text : String(foundOpt)).trim();
    if (!correctText || !options_json.includes(correctText)) {
      throw new Error('Đáp án đúng không hợp lệ hoặc không nằm trong danh sách lựa chọn của câu hỏi.');
    }

    correct_answer_key = {
      correct_answer: correctText,
      accepted_answers: [correctText],
      case_sensitive: Boolean(answerKey?.case_sensitive)
    };
  } else if (qType === 'multiple_choice') {
    const correctOptIds = Array.isArray(ca?.correct_option_ids) ? ca.correct_option_ids : (Array.isArray(ca) ? ca : []);
    if (!correctOptIds || correctOptIds.length === 0) {
      throw new Error('Không thể xác định danh sách đáp án đúng từ phiên bản Question Bank. Không được phép giao bài.');
    }

    const resolvedAnswers = [];
    for (const optId of correctOptIds) {
      const found = rawOpts.find((o) => (typeof o === 'object' && o?.id === optId) || o === optId);
      if (!found) {
        throw new Error('Không thể ánh xạ đầy đủ tất cả đáp án đúng của câu hỏi nhiều lựa chọn từ Question Bank.');
      }
      const text = (typeof found === 'object' ? found.text : String(found)).trim();
      if (!text || !options_json.includes(text)) {
        throw new Error('Đáp án đúng không hợp lệ hoặc không nằm trong danh sách lựa chọn.');
      }
      resolvedAnswers.push(text);
    }

    if (resolvedAnswers.length === 0) {
      throw new Error('Không có đáp án đúng hợp lệ cho câu hỏi nhiều lựa chọn.');
    }

    correct_answer_key = {
      correct_answer: resolvedAnswers,
      accepted_answers: resolvedAnswers,
      case_sensitive: Boolean(answerKey?.case_sensitive)
    };
  } else if (qType === 'fill_blank' || qType === 'short_answer') {
    let candidateList = [];
    if (Array.isArray(ca)) {
      candidateList = ca
        .map((value) => String(value || '').trim())
        .filter(Boolean);
    }

    if (candidateList.length === 0) {
      throw new Error('Không thể xác định đáp án đúng cho câu hỏi điền từ / trả lời ngắn từ Question Bank.');
    }

    correct_answer_key = {
      correct_answer: candidateList[0],
      accepted_answers: candidateList,
      case_sensitive: Boolean(answerKey?.case_sensitive)
    };
  } else {
    // essay, image_upload, file_upload
    correct_answer_key = null;
  }

  const questionPayload = {
    question_number: 1,
    question_type: qType,
    prompt: prompt.trim(),
    options_json: options_json,
    options: options_json,
    points: 10,
    correct_answer_key
  };

  const exerciseTitle = options.title?.trim() || item.title?.trim() || prompt.trim().slice(0, 100) || 'Bài tập học thuật';
  const gradeLevel = parseInt(item.grade_level, 10) || 1;
  const subject = item.subject || 'Toán';

  // Safe nullish / finite handling for reward_stars (0 stays 0, missing/invalid -> 10)
  let validRewardStars = 10;
  if (options.reward_stars !== undefined && options.reward_stars !== null && options.reward_stars !== '') {
    const parsed = parseInt(options.reward_stars, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      validRewardStars = parsed;
    }
  }

  const sourceItemId = item.id;
  const sourceVerId = version.id || item.current_version_id;
  const defaultDesc = `Bài tập từ Question Bank: ${item.code || item.id} (Version ${version.version_number || 1}) [source_item_id:${sourceItemId}] [source_version_id:${sourceVerId}]`;
  const exerciseDesc = options.description?.trim()
    ? `${options.description.trim()} [source_item_id:${sourceItemId}] [source_version_id:${sourceVerId}]`
    : defaultDesc;

  // V1 lineage persistence is stored in description metadata tags.
  // source_question_bank_item_id and source_question_bank_version_id are NOT dedicated DB columns in V1.
  // They are included in the frontend exercise payload for compatibility/future use.
  const exercisePayload = {
    title: exerciseTitle,
    description: exerciseDesc,
    grade_level: gradeLevel,
    subject: subject,
    exercise_type: 'mixed',
    status: 'published',
    reward_stars: validRewardStars,
    due_date: options.due_date ? new Date(options.due_date).toISOString() : null,
    max_attempts: 1,
    show_score_after_submit: true,
    show_correct_answers: true,
    is_global: false,
    source_question_bank_item_id: sourceItemId,
    source_question_bank_version_id: sourceVerId
  };

  return {
    exercise: exercisePayload,
    questions: [questionPayload]
  };
};

export default {
  toQuestionBankPayload,
  normalizePromptForDuplicateCheck,
  buildQuestionDuplicateKey,
  buildExistingListDuplicateKey,
  buildCandidateListDuplicateKey,
  findDuplicatesInQuestionList,
  findExistingQuestionDuplicateIndices,
  normalizeOptionsToStableIds,
  buildSingleChoiceAnswerKey,
  buildMultipleChoiceAnswerKey,
  transformQuestionBankToAcademicExercise
};

