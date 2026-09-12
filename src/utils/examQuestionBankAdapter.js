// src/utils/examQuestionBankAdapter.js
// Utility chuyển đổi câu hỏi từ Question Bank sang cấu trúc chuẩn (Canonical Schema) của Exam V1
// Tuân thủ nghiêm ngặt: KHÔNG bịa đáp án, KHÔNG sinh phương án giả mạo, Fail-closed nếu dữ liệu không hợp lệ.

/**
 * Ánh xạ loại câu hỏi từ Question Bank sang Exam V1
 * @param {string} qbType 
 * @returns {string} examType
 */
export function mapQuestionType(qbType) {
  const normalized = String(qbType || '').trim().toLowerCase();
  switch (normalized) {
    case 'single_choice':
    case 'choice':
    case 'trac_nghiem':
      return 'single_choice';
    case 'multiple_choice':
      return 'multiple_choice';
    case 'fill_blank':
    case 'dien_khuyet':
      return 'fill_blank';
    case 'short_answer':
    case 'tra_loi_ngan':
      return 'short_answer';
    case 'essay':
    case 'tu_luan':
      return 'essay';
    case 'image_upload':
      return 'image_upload';
    case 'file_upload':
      return 'file_upload';
    default:
      return 'single_choice';
  }
}

/**
 * Chuyển đổi danh sách options của Question Bank sang canonical options schema [{ key: 'A', text: '...' }, ...]
 * BẮT BUỘC:
 * - Ít nhất 2 phương án hợp lệ.
 * - Nội dung mỗi phương án không được rỗng / khoảng trắng.
 * - Không trùng lặp nội dung hoặc mã định danh.
 * - KHÔNG tự tạo phương án giả mạo nếu thiếu.
 * @param {Array<string|Object>} rawOptions 
 * @returns {Array<{ key: string, text: string, originalId?: string }>}
 */
export function mapOptionsToCanonical(rawOptions) {
  if (!Array.isArray(rawOptions) || rawOptions.length < 2) {
    const err = new Error('Câu hỏi trắc nghiệm phải có ít nhất 2 phương án lựa chọn.');
    err.code = 'ERR_QB_OPTIONS_INVALID';
    throw err;
  }

  const seenTexts = new Set();
  const seenOriginalIds = new Set();

  return rawOptions.map((opt, idx) => {
    const key = String.fromCharCode(65 + idx); // 0 -> 'A', 1 -> 'B', 2 -> 'C'...

    let text = '';
    let originalId = `opt_${idx + 1}`;

    if (typeof opt === 'string') {
      text = opt.trim();
    } else if (opt && typeof opt === 'object') {
      text = typeof opt.text === 'string' ? opt.text.trim() : String(opt.text ?? '').trim();
      if (opt.id) {
        originalId = String(opt.id).trim();
      } else if (opt.key) {
        originalId = String(opt.key).trim();
      }
    } else {
      const err = new Error(`Phương án lựa chọn thứ ${idx + 1} không hợp lệ.`);
      err.code = 'ERR_QB_OPTIONS_INVALID';
      throw err;
    }

    if (!text || text.length === 0) {
      const err = new Error(`Nội dung phương án lựa chọn ${key} không được để trống.`);
      err.code = 'ERR_QB_OPTIONS_INVALID';
      throw err;
    }

    const textLower = text.toLowerCase();
    if (seenTexts.has(textLower)) {
      const err = new Error(`Phương án lựa chọn bị trùng lặp nội dung: "${text}".`);
      err.code = 'ERR_QB_OPTIONS_INVALID';
      throw err;
    }
    seenTexts.add(textLower);

    if (originalId) {
      const idLower = originalId.toLowerCase();
      if (seenOriginalIds.has(idLower)) {
        const err = new Error(`Trùng lặp mã phương án gốc: "${originalId}".`);
        err.code = 'ERR_QB_OPTIONS_INVALID';
        throw err;
      }
      seenOriginalIds.add(idLower);
    }

    return { key, text, originalId };
  });
}

/**
 * Ánh xạ đáp án đúng từ Question Bank answer key sang Exam V1 answer key
 * BẮT BUỘC:
 * - Auto-gradable types (single_choice, multiple_choice, fill_blank, short_answer) PHẢI có đáp án hợp lệ.
 * - KHÔNG tự ý ngầm định 'A' hay phương án đầu tiên khi thiếu hoặc không khớp.
 * - Trả về null cho câu hỏi tự luận essay / upload.
 * @param {string} examType 
 * @param {Array<{ key: string, text: string, originalId?: string }>} canonicalOptions 
 * @param {Object} qbAnswerKey { correct_answers, correct_option_id, correct_option_ids, correct_text, accepted_texts, ... }
 * @returns {Object|null} { correct_answer: string|string[], accepted_answers?: string[] } | null
 */
export function mapAnswerKeyToCanonical(examType, canonicalOptions, qbAnswerKey) {
  if (['essay', 'image_upload', 'file_upload'].includes(examType)) {
    return null;
  }

  if (!qbAnswerKey || typeof qbAnswerKey !== 'object') {
    const err = new Error(`Câu hỏi loại ${examType} thiếu cấu hình đáp án trong ngân hàng câu hỏi.`);
    err.code = 'ERR_QB_ANSWER_KEY_INVALID';
    throw err;
  }

  const correctObj = qbAnswerKey.correct_answers || qbAnswerKey;

  if (examType === 'single_choice') {
    const rawTarget = correctObj.correct_option_id ?? correctObj.correct_answer ?? correctObj.correct_option;
    if (rawTarget === undefined || rawTarget === null || String(rawTarget).trim() === '') {
      const err = new Error('Câu hỏi trắc nghiệm thiếu đáp án đúng.');
      err.code = 'ERR_QB_ANSWER_KEY_INVALID';
      throw err;
    }

    const targetStr = String(rawTarget).trim();

    // 1. Khớp theo originalId (ví dụ 'opt_1' -> 'A')
    const matchByOrig = canonicalOptions.find(o => o.originalId && o.originalId.toLowerCase() === targetStr.toLowerCase());
    if (matchByOrig) return { correct_answer: matchByOrig.key };

    // 2. Khớp theo key (ví dụ 'A' -> 'A')
    const matchByKey = canonicalOptions.find(o => o.key.toUpperCase() === targetStr.toUpperCase());
    if (matchByKey) return { correct_answer: matchByKey.key };

    // 3. Khớp theo text chính xác
    const matchByText = canonicalOptions.find(o => o.text.toLowerCase() === targetStr.toLowerCase());
    if (matchByText) return { correct_answer: matchByText.key };

    // 4. Khớp theo số thứ tự (ví dụ 1 -> 'A')
    const num = parseInt(targetStr, 10);
    if (!isNaN(num) && num >= 1 && num <= canonicalOptions.length) {
      return { correct_answer: canonicalOptions[num - 1].key };
    }

    // Không khớp với bất kỳ phương án nào => FAIL CLOSED
    const err = new Error(`Đáp án đúng "${targetStr}" không khớp với bất kỳ phương án lựa chọn nào.`);
    err.code = 'ERR_QB_ANSWER_KEY_INVALID';
    throw err;
  }

  if (examType === 'multiple_choice') {
    const rawList = correctObj.correct_option_ids ?? correctObj.correct_answers ?? correctObj.correct_answer;
    let targets = [];
    if (Array.isArray(rawList)) {
      targets = rawList.map(s => String(s).trim()).filter(Boolean);
    } else if (typeof rawList === 'string' && rawList.trim()) {
      targets = rawList.split(/[,;|]/).map(s => s.trim()).filter(Boolean);
    }

    if (targets.length === 0) {
      const err = new Error('Câu hỏi trắc nghiệm nhiều đáp án thiếu danh sách đáp án đúng.');
      err.code = 'ERR_QB_ANSWER_KEY_INVALID';
      throw err;
    }

    const matchedKeys = [];
    for (const target of targets) {
      const matchByOrig = canonicalOptions.find(o => o.originalId && o.originalId.toLowerCase() === target.toLowerCase());
      if (matchByOrig) {
        if (!matchedKeys.includes(matchByOrig.key)) matchedKeys.push(matchByOrig.key);
        continue;
      }
      const matchByKey = canonicalOptions.find(o => o.key.toUpperCase() === target.toUpperCase());
      if (matchByKey) {
        if (!matchedKeys.includes(matchByKey.key)) matchedKeys.push(matchByKey.key);
        continue;
      }
      const matchByText = canonicalOptions.find(o => o.text.toLowerCase() === target.toLowerCase());
      if (matchByText) {
        if (!matchedKeys.includes(matchByText.key)) matchedKeys.push(matchByText.key);
        continue;
      }

      // Có ít nhất một target không khớp => FAIL CLOSED
      const err = new Error(`Đáp án đúng "${target}" không khớp với phương án lựa chọn nào.`);
      err.code = 'ERR_QB_ANSWER_KEY_INVALID';
      throw err;
    }

    if (matchedKeys.length === 0) {
      const err = new Error('Không tìm thấy đáp án đúng hợp lệ cho câu hỏi trắc nghiệm nhiều đáp án.');
      err.code = 'ERR_QB_ANSWER_KEY_INVALID';
      throw err;
    }

    return { correct_answer: matchedKeys.sort() };
  }

  if (examType === 'fill_blank' || examType === 'short_answer') {
    const rawCorrect = correctObj.correct_text !== undefined ? correctObj.correct_text : (correctObj.correct_answer || '');
    const correctStr = String(rawCorrect || '').trim();

    if (!correctStr) {
      const err = new Error('Câu hỏi điền khuyết / trả lời ngắn thiếu nội dung đáp án đúng.');
      err.code = 'ERR_QB_ANSWER_KEY_INVALID';
      throw err;
    }

    const accepted = Array.isArray(correctObj.accepted_texts)
      ? correctObj.accepted_texts.map(s => String(s).trim())
      : (Array.isArray(correctObj.accepted_answers) ? correctObj.accepted_answers.map(s => String(s).trim()) : []);

    return {
      correct_answer: correctStr,
      accepted_answers: accepted.filter(Boolean),
    };
  }

  return null;
}

/**
 * Chuyển đổi một câu hỏi từ Question Bank (Item + Version + Answer Key) thành đối tượng Exam Question snapshot hoàn chỉnh
 * @param {Object} qbItem 
 * @param {Object} qbVersion 
 * @param {Object} [qbAnswerKey] 
 * @param {number} [questionNumber] 
 * @returns {Object} Canonical Exam Question Object
 */
export function convertQbQuestionToExamQuestion(qbItem, qbVersion, qbAnswerKey = null, questionNumber = 1) {
  if (!qbItem || !qbVersion) {
    const err = new Error('Dữ liệu câu hỏi từ Question Bank không hợp lệ.');
    err.code = 'INVALID_INPUT';
    throw err;
  }

  const rawType = qbVersion.question_type || qbItem.question_type || 'single_choice';
  const examType = mapQuestionType(rawType);
  const prompt = String(qbVersion.prompt || qbItem.prompt || '').trim();

  if (!prompt) {
    const err = new Error('Nội dung đề bài câu hỏi không được để trống.');
    err.code = 'ERR_QB_PROMPT_EMPTY';
    throw err;
  }

  let canonicalOptions = [];
  if (['single_choice', 'multiple_choice'].includes(examType)) {
    canonicalOptions = mapOptionsToCanonical(qbVersion.options || qbItem.options || []);
  }

  const canonicalAnswerKey = mapAnswerKeyToCanonical(examType, canonicalOptions, qbAnswerKey);

  const newId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });

  return {
    id: newId,
    question_number: questionNumber,
    question_type: examType,
    prompt,
    points: 1,
    options_json: canonicalOptions.map(o => ({ key: o.key, text: o.text })),
    answer_key: canonicalAnswerKey,
    source_question_bank_item_id: qbItem.id,
    source_question_bank_version_id: qbVersion.id,
  };
}
