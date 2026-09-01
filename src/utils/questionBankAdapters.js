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
 * Kiểm tra các câu hỏi bị trùng lặp trong cùng một danh sách
 * @param {Array} questions
 * @returns {Set<number>} Tập hợp các index bị trùng lặp
 */
export const findDuplicatesInQuestionList = (questions) => {
  const seen = new Map();
  const duplicateIndexes = new Set();

  (questions || []).forEach((q, idx) => {
    const norm = normalizePromptForDuplicateCheck(q?.prompt || q?.title || '');
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
 * Tạo answer_key chuẩn cho dạng multiple_choice
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
    answersArr = rawCorrectAnswers;
  } else if (typeof rawCorrectAnswers === 'string') {
    answersArr = rawCorrectAnswers.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
  }

  if (answersArr.length === 0) {
    throw new Error('Dạng trắc nghiệm nhiều đáp án yêu cầu chọn ít nhất 1 đáp án đúng.');
  }

  const correctIds = [];
  for (const ans of answersArr) {
    const ansStr = String(ans).trim();
    // Direct ID match
    const directMatch = options.find((o) => o.id === ansStr);
    if (directMatch) {
      if (!correctIds.includes(directMatch.id)) correctIds.push(directMatch.id);
      continue;
    }
    // Text match
    const textMatch = options.find((o) => o.text.toLowerCase() === ansStr.toLowerCase());
    if (textMatch) {
      if (!correctIds.includes(textMatch.id)) correctIds.push(textMatch.id);
      continue;
    }
    // Letter match A, B, C...
    const letterMatch = ansStr.toUpperCase().match(/^([A-Z])$/);
    if (letterMatch) {
      const idx = letterMatch[1].charCodeAt(0) - 65;
      if (idx >= 0 && idx < options.length) {
        if (!correctIds.includes(options[idx].id)) correctIds.push(options[idx].id);
        continue;
      }
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
    options: options && options.length > 0 ? options : null,
    answer_key: answerKey,
    hints: Array.isArray(input.hints) ? input.hints.map(String) : null,
    explanation: input.explanation ? String(input.explanation).trim() : null,
    tags: Array.isArray(input.tags) ? input.tags.map(String) : (typeof input.tags === 'string' ? input.tags.split(',').map(s => s.trim()).filter(Boolean) : null),
    media_urls: Array.isArray(input.media_urls) ? input.media_urls.map(String) : null,
    metadata
  };

  // Xóa sạch các trường cấm nếu tình cờ lọt vào
  delete payload.caller_id;
  delete payload.actor_role;
  delete payload.school_id;
  delete payload.server_grading;
  delete payload.service_role;

  return payload;
};

export default {
  toQuestionBankPayload,
  normalizePromptForDuplicateCheck,
  findDuplicatesInQuestionList,
  normalizeOptionsToStableIds,
  buildSingleChoiceAnswerKey,
  buildMultipleChoiceAnswerKey
};
