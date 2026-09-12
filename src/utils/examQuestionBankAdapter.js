// src/utils/examQuestionBankAdapter.js
// Utility chuyển đổi câu hỏi từ Question Bank sang cấu trúc chuẩn (Canonical Schema) của Exam V1

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
 * Chuyển đổi danh sách options của Question Bank sang canonical options schema của Exam V1 [{ key: 'A', text: '...' }, ...]
 * @param {Array<string|Object>} rawOptions 
 * @returns {Array<{ key: string, text: string, originalId?: string }>}
 */
export function mapOptionsToCanonical(rawOptions) {
  if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
    return [];
  }

  return rawOptions.map((opt, idx) => {
    const key = String.fromCharCode(65 + idx); // 0 -> 'A', 1 -> 'B', 2 -> 'C', 3 -> 'D'...
    if (typeof opt === 'string') {
      return { key, text: opt.trim(), originalId: `opt_${idx + 1}` };
    }
    if (opt && typeof opt === 'object') {
      const text = typeof opt.text === 'string' ? opt.text.trim() : String(opt.text ?? '').trim();
      const originalId = opt.id ? String(opt.id).trim() : (opt.key ? String(opt.key).trim() : `opt_${idx + 1}`);
      return { key, text, originalId };
    }
    return { key, text: String(opt ?? '').trim(), originalId: `opt_${idx + 1}` };
  });
}

/**
 * Ánh xạ đáp án đúng từ Question Bank answer key sang Exam V1 answer key
 * @param {string} examType 
 * @param {Array<{ key: string, text: string, originalId?: string }>} canonicalOptions 
 * @param {Object} qbAnswerKey { correct_answers, correct_option_id, correct_option_ids, correct_text, accepted_texts, ... }
 * @returns {Object|null} { correct_answer: string|string[], accepted_answers?: string[] } | null
 */
export function mapAnswerKeyToCanonical(examType, canonicalOptions, qbAnswerKey) {
  if (!qbAnswerKey || typeof qbAnswerKey !== 'object') {
    if (['essay', 'image_upload', 'file_upload'].includes(examType)) {
      return null;
    }
    // Trả về default cho các dạng có đáp án nếu có options
    if (examType === 'single_choice' && canonicalOptions.length > 0) {
      return { correct_answer: canonicalOptions[0].key };
    }
    if (examType === 'multiple_choice' && canonicalOptions.length > 0) {
      return { correct_answer: [canonicalOptions[0].key] };
    }
    return null;
  }

  // Trích xuất raw correct_answers từ cấu trúc app_private.question_bank_answer_keys hoặc format client
  const correctObj = qbAnswerKey.correct_answers || qbAnswerKey;

  if (examType === 'single_choice') {
    const rawTarget = correctObj.correct_option_id || correctObj.correct_answer || correctObj.correct_option;
    if (rawTarget !== undefined && rawTarget !== null && String(rawTarget).trim() !== '') {
      const targetStr = String(rawTarget).trim();
      // 1. Khớp theo originalId (ví dụ 'opt_1' -> 'A')
      const matchByOrig = canonicalOptions.find(o => o.originalId && o.originalId.toLowerCase() === targetStr.toLowerCase());
      if (matchByOrig) return { correct_answer: matchByOrig.key };

      // 2. Khớp theo key (ví dụ 'A' -> 'A')
      const matchByKey = canonicalOptions.find(o => o.key.toUpperCase() === targetStr.toUpperCase());
      if (matchByKey) return { correct_answer: matchByKey.key };

      // 3. Khớp theo text
      const matchByText = canonicalOptions.find(o => o.text.toLowerCase() === targetStr.toLowerCase());
      if (matchByText) return { correct_answer: matchByText.key };

      // 4. Khớp theo số thứ tự (ví dụ 1 -> 'A')
      const num = parseInt(targetStr, 10);
      if (!isNaN(num) && num >= 1 && num <= canonicalOptions.length) {
        return { correct_answer: canonicalOptions[num - 1].key };
      }
    }
    return { correct_answer: canonicalOptions[0]?.key || 'A' };
  }

  if (examType === 'multiple_choice') {
    const rawList = correctObj.correct_option_ids || correctObj.correct_answers || correctObj.correct_answer;
    let targets = [];
    if (Array.isArray(rawList)) {
      targets = rawList.map(s => String(s).trim()).filter(Boolean);
    } else if (typeof rawList === 'string' && rawList.trim()) {
      targets = rawList.split(/[,;|]/).map(s => s.trim()).filter(Boolean);
    }

    const matchedKeys = [];
    for (const target of targets) {
      // Match by originalId
      const matchByOrig = canonicalOptions.find(o => o.originalId && o.originalId.toLowerCase() === target.toLowerCase());
      if (matchByOrig && !matchedKeys.includes(matchByOrig.key)) {
        matchedKeys.push(matchByOrig.key);
        continue;
      }
      // Match by key
      const matchByKey = canonicalOptions.find(o => o.key.toUpperCase() === target.toUpperCase());
      if (matchByKey && !matchedKeys.includes(matchByKey.key)) {
        matchedKeys.push(matchByKey.key);
        continue;
      }
      // Match by text
      const matchByText = canonicalOptions.find(o => o.text.toLowerCase() === target.toLowerCase());
      if (matchByText && !matchedKeys.includes(matchByText.key)) {
        matchedKeys.push(matchByText.key);
        continue;
      }
    }

    if (matchedKeys.length === 0 && canonicalOptions.length > 0) {
      matchedKeys.push(canonicalOptions[0].key);
    }

    return { correct_answer: matchedKeys };
  }

  if (examType === 'fill_blank' || examType === 'short_answer') {
    const rawCorrect = correctObj.correct_text !== undefined ? correctObj.correct_text : (correctObj.correct_answer || '');
    const accepted = Array.isArray(correctObj.accepted_texts)
      ? correctObj.accepted_texts.map(String)
      : (Array.isArray(correctObj.accepted_answers) ? correctObj.accepted_answers.map(String) : []);

    return {
      correct_answer: String(rawCorrect || '').trim(),
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
    throw new Error('Dữ liệu câu hỏi từ Question Bank không hợp lệ.');
  }

  const rawType = qbVersion.question_type || qbItem.question_type || 'single_choice';
  const examType = mapQuestionType(rawType);
  const prompt = String(qbVersion.prompt || qbItem.prompt || '').trim();

  let canonicalOptions = [];
  if (['single_choice', 'multiple_choice'].includes(examType)) {
    canonicalOptions = mapOptionsToCanonical(qbVersion.options || qbItem.options || []);
    if (canonicalOptions.length < 2) {
      // Bổ sung tối thiểu 2 phương án nếu thiếu để đảm bảo schema hợp lệ
      canonicalOptions = [
        { key: 'A', text: 'Lựa chọn 1' },
        { key: 'B', text: 'Lựa chọn 2' },
        { key: 'C', text: 'Lựa chọn 3' },
        { key: 'D', text: 'Lựa chọn 4' },
      ];
    }
  }

  const canonicalAnswerKey = mapAnswerKeyToCanonical(examType, canonicalOptions, qbAnswerKey);

  // Tạo đối tượng snapshot độc lập
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
    prompt: prompt,
    points: 1,
    options_json: canonicalOptions.map(o => ({ key: o.key, text: o.text })),
    answer_key: canonicalAnswerKey,
    source_question_bank_item_id: qbItem.id || null,
    source_question_bank_version_id: qbVersion.id || null,
  };
}
