// src/utils/competitionQuestionAdapters.js
// Adapter utilities for Competition V1 R14 Question Sources (Manual, Question Bank, Excel)

import * as XLSX from 'xlsx';

// Authoritative frontend maximum competition questions per session
export const MAX_COMPETITION_QUESTIONS = 20;

/**
 * Normalizes an option string or object into a canonical Competition option: { id: string, text: string }
 */
export function normalizeOption(opt, index) {
  const optId = `opt_${index + 1}`;
  if (typeof opt === 'string') {
    return { id: optId, text: opt.trim() };
  }
  if (opt && typeof opt === 'object') {
    const text = typeof opt.text === 'string'
      ? opt.text.trim()
      : (typeof opt.prompt === 'string'
        ? opt.prompt.trim()
        : String(opt.value || opt.content || '').trim());
    return { id: optId, text };
  }
  return { id: optId, text: String(opt || '').trim() };
}

/**
 * Resolves a raw target string/number/object to an option ID from canonical options list.
 */
export function resolveTargetToOptionId(target, canonicalOptions = []) {
  if (target === null || target === undefined || String(target).trim() === '') {
    return null;
  }
  const targetStr = String(target).trim();

  // 1. Match by _originalId (e.g. 'opt_uuid_a', 'opt_1')
  const matchByOrig = canonicalOptions.find(o => o._originalId && o._originalId.toLowerCase() === targetStr.toLowerCase());
  if (matchByOrig) return matchByOrig.id;

  // 2. Match by letter A, B, C, D, E, F...
  const upperTarget = targetStr.toUpperCase();
  if (['A', 'B', 'C', 'D', 'E', 'F'].includes(upperTarget)) {
    const letterIdx = upperTarget.charCodeAt(0) - 65;
    if (letterIdx >= 0 && letterIdx < canonicalOptions.length) {
      return canonicalOptions[letterIdx].id;
    }
  }

  // 3. Match by canonical ID (opt_1, opt_2, ...)
  if (/^opt_\d+$/i.test(targetStr)) {
    const matchOpt = canonicalOptions.find(o => o.id.toLowerCase() === targetStr.toLowerCase());
    if (matchOpt) return matchOpt.id;
  }

  // 4. Match by option text (case-insensitive)
  const matchText = canonicalOptions.find(o => o.text.toLowerCase() === targetStr.toLowerCase());
  if (matchText) return matchText.id;

  // 5. Match by 1-based numerical index
  const numIdx = parseInt(targetStr, 10);
  if (!isNaN(numIdx) && numIdx >= 1 && numIdx <= canonicalOptions.length && String(numIdx) === targetStr) {
    return canonicalOptions[numIdx - 1].id;
  }

  return null;
}

/**
 * Normalizes Question Bank item/version/authoring detail to canonical Competition question format.
 * Supports full authoring detail from getQuestionAuthoringDetail ({ item, version, answer_key })
 * as well as list summary items.
 * Supports: single_choice, multiple_choice.
 *
 * @param {Object} input - Question Bank item object or authoring detail object
 * @param {number} [order=1] - Sequential question order
 * @returns {Object} Canonical Competition Question
 */
export function normalizeQuestionBankItemToCompetitionQuestion(input, order = 1) {
  if (!input || typeof input !== 'object') {
    throw new Error('Dữ liệu câu hỏi từ Ngân hàng không hợp lệ (đối tượng rỗng).');
  }

  // Extract nested sub-objects if input is from getQuestionAuthoringDetail ({ item, version, answer_key })
  const itemObj = input.item && typeof input.item === 'object' ? input.item : input;
  const versionObj = input.version && typeof input.version === 'object'
    ? input.version
    : (input.authoring_version || itemObj.authoring_version || {});
  const answerKeyObj = input.answer_key && typeof input.answer_key === 'object'
    ? input.answer_key
    : (input.correct_answer_key || itemObj.answer_key || itemObj.correct_answer_key || {});

  // Question Type Check (R15A supports single_choice and multiple_choice)
  const rawType = versionObj.question_type || itemObj.question_type || input.question_type || input.type || 'single_choice';
  if (rawType !== 'single_choice' && rawType !== 'multiple_choice') {
    throw new Error(`Loại câu hỏi "${rawType}" chưa được hỗ trợ trong Đấu trường (chỉ hỗ trợ Trắc nghiệm 1 đáp án hoặc Trắc nghiệm nhiều đáp án).`);
  }
  const canonicalType = rawType;

  // Extract Question Text / Prompt
  const promptText = (
    versionObj.prompt ||
    itemObj.prompt ||
    itemObj.question_text ||
    itemObj.title ||
    input.prompt ||
    input.question_text ||
    input.title ||
    ''
  ).trim();

  if (!promptText) {
    throw new Error('Nội dung câu hỏi không được để trống.');
  }

  // Extract Options
  let rawOptions = [];
  if (Array.isArray(versionObj.options) && versionObj.options.length > 0) {
    rawOptions = versionObj.options;
  } else if (Array.isArray(itemObj.options) && itemObj.options.length > 0) {
    rawOptions = itemObj.options;
  } else if (Array.isArray(versionObj.options_json) && versionObj.options_json.length > 0) {
    rawOptions = versionObj.options_json;
  } else if (Array.isArray(itemObj.options_json) && itemObj.options_json.length > 0) {
    rawOptions = itemObj.options_json;
  } else if (Array.isArray(input.options) && input.options.length > 0) {
    rawOptions = input.options;
  } else if (Array.isArray(input.options_json) && input.options_json.length > 0) {
    rawOptions = input.options_json;
  }

  if (!rawOptions || rawOptions.length < 2) {
    throw new Error('Câu hỏi trắc nghiệm yêu cầu ít nhất 2 phương án lựa chọn.');
  }

  // Build Canonical Options: [ { id: 'opt_1', text: '...' }, { id: 'opt_2', text: '...' }, ... ]
  const canonicalOptions = [];
  for (let i = 0; i < rawOptions.length; i++) {
    const rawOpt = rawOptions[i];
    const norm = normalizeOption(rawOpt, i);
    if (!norm.text) {
      throw new Error(`Phương án lựa chọn thứ ${i + 1} có nội dung trống.`);
    }
    const originalId = (rawOpt && typeof rawOpt === 'object' && rawOpt.id) ? String(rawOpt.id).trim() : null;
    canonicalOptions.push({
      id: norm.id,
      text: norm.text,
      ...(originalId ? { _originalId: originalId } : {})
    });
  }

  // Resolve Correct Answer Option ID(s)
  let resolvedOptionId = null;
  let resolvedOptionIds = [];

  if (canonicalType === 'single_choice') {
    let target = answerKeyObj.correct_option_id || itemObj.correct_option_id || versionObj.correct_option_id || input.correct_option_id || null;
    if (target === null || target === undefined) {
      const ca = answerKeyObj.correct_answers !== undefined
        ? answerKeyObj.correct_answers
        : (answerKeyObj.correct_answer !== undefined
          ? answerKeyObj.correct_answer
          : (itemObj.correct_answer || versionObj.correct_answer || input.correct_answer || null));

      if (Array.isArray(ca)) {
        target = ca[0];
      } else if (ca && typeof ca === 'object') {
        target = ca.correct_option_id || ca.correct_answer || ca.correct_option || ca.option_id || ca.key || null;
      } else if (typeof ca === 'string' || typeof ca === 'number') {
        target = ca;
      }
    }

    if (target === null || target === undefined || String(target).trim() === '') {
      throw new Error('Câu hỏi thiếu thông tin đáp án đúng.');
    }

    resolvedOptionId = resolveTargetToOptionId(target, canonicalOptions);
    if (!resolvedOptionId) {
      throw new Error(`Không thể ánh xạ đáp án đúng "${String(target).trim()}" vào danh sách các phương án lựa chọn.`);
    }
  } else {
    // multiple_choice
    let rawTargets = [];
    if (Array.isArray(answerKeyObj.correct_option_ids) && answerKeyObj.correct_option_ids.length > 0) {
      rawTargets = answerKeyObj.correct_option_ids;
    } else if (Array.isArray(answerKeyObj.correct_answers) && answerKeyObj.correct_answers.length > 0) {
      rawTargets = answerKeyObj.correct_answers;
    } else if (Array.isArray(itemObj.correct_option_ids) && itemObj.correct_option_ids.length > 0) {
      rawTargets = itemObj.correct_option_ids;
    } else if (Array.isArray(versionObj.correct_option_ids) && versionObj.correct_option_ids.length > 0) {
      rawTargets = versionObj.correct_option_ids;
    } else if (Array.isArray(input.correct_option_ids) && input.correct_option_ids.length > 0) {
      rawTargets = input.correct_option_ids;
    } else {
      const fallbackCa = answerKeyObj.correct_answer || itemObj.correct_answer || versionObj.correct_answer || input.correct_answer;
      if (Array.isArray(fallbackCa)) {
        rawTargets = fallbackCa;
      } else if (typeof fallbackCa === 'string' || typeof fallbackCa === 'number') {
        rawTargets = String(fallbackCa).split(/[;,]/).map(s => s.trim()).filter(Boolean);
      }
    }

    if (!rawTargets || rawTargets.length === 0) {
      throw new Error('Câu hỏi trắc nghiệm nhiều đáp án thiếu thông tin đáp án đúng.');
    }

    const resolvedSet = new Set();
    for (const rawTarget of rawTargets) {
      const optId = resolveTargetToOptionId(rawTarget, canonicalOptions);
      if (!optId) {
        throw new Error(`Không thể ánh xạ đáp án đúng "${String(rawTarget).trim()}" vào danh sách các phương án lựa chọn.`);
      }
      resolvedSet.add(optId);
    }

    // Preserve deterministic ordering matching canonicalOptions
    resolvedOptionIds = canonicalOptions
      .map(o => o.id)
      .filter(id => resolvedSet.has(id));

    if (resolvedOptionIds.length === 0) {
      throw new Error('Câu hỏi trắc nghiệm nhiều đáp án phải có ít nhất 1 đáp án đúng.');
    }
  }

  // Clean canonical options (remove temporary _originalId)
  const cleanOptions = canonicalOptions.map(o => ({
    id: o.id,
    text: o.text
  }));

  // Points & Time Limit
  const rawPoints = input.points || versionObj.points || itemObj.points;
  const points = parseFloat(rawPoints) > 0 ? parseFloat(rawPoints) : 10.00;

  const rawTime = input.time_limit_seconds || versionObj.time_limit_seconds || itemObj.time_limit_seconds;
  const timeLimit = (parseInt(rawTime, 10) >= 5 && parseInt(rawTime, 10) <= 600)
    ? parseInt(rawTime, 10)
    : 30;

  const explanation = (versionObj.explanation || itemObj.explanation || input.explanation || '').trim() || null;
  const sourceBankId = itemObj.id || input.id || null;

  return {
    question_order: order,
    question_text: promptText,
    question_type: canonicalType,
    points,
    time_limit_seconds: timeLimit,
    options: cleanOptions,
    correct_answer: canonicalType === 'multiple_choice'
      ? { option_ids: resolvedOptionIds }
      : { option_id: resolvedOptionId },
    explanation,
    _sourceBankId: sourceBankId
  };
}

/**
 * Normalizes an imported Excel row into canonical Competition question format.
 * Supports: single_choice, multiple_choice.
 *
 * @param {Object} row - Parsed Excel row object
 * @param {number} [order=1] - Sequential question order
 * @returns {Object} Canonical Competition Question
 */
export function normalizeImportedQuestionToCompetitionQuestion(row, order = 1) {
  if (!row || typeof row !== 'object') {
    throw new Error('Dữ liệu dòng Excel không hợp lệ.');
  }

  // Enforce single_choice or multiple_choice for Competition
  const rawType = row.question_type || row.type || 'single_choice';
  if (rawType !== 'single_choice' && rawType !== 'multiple_choice') {
    throw new Error(`Loại câu hỏi "${rawType}" chưa được hỗ trợ trong Đấu trường (R14 hiện chỉ hỗ trợ Trắc nghiệm 1 đáp án hoặc Trắc nghiệm nhiều đáp án).`);
  }
  const canonicalType = rawType;

  const prompt = (row.question_text || row.question || row.prompt || row.debai || '').trim();
  if (!prompt) {
    throw new Error('Nội dung câu hỏi không được để trống.');
  }

  // Collect option texts
  const optionTexts = [];
  if (row.option_a !== undefined && String(row.option_a).trim()) optionTexts.push(String(row.option_a).trim());
  if (row.option_b !== undefined && String(row.option_b).trim()) optionTexts.push(String(row.option_b).trim());
  if (row.option_c !== undefined && String(row.option_c).trim()) optionTexts.push(String(row.option_c).trim());
  if (row.option_d !== undefined && String(row.option_d).trim()) optionTexts.push(String(row.option_d).trim());

  // Fallback to options / options_json array if options were passed as array
  if (optionTexts.length === 0) {
    const rawOpts = Array.isArray(row.options) ? row.options : (Array.isArray(row.options_json) ? row.options_json : []);
    for (const opt of rawOpts) {
      const text = typeof opt === 'string' ? opt.trim() : (opt?.text ? String(opt.text).trim() : String(opt || '').trim());
      if (text) optionTexts.push(text);
    }
  }

  if (optionTexts.length < 2) {
    throw new Error('Câu hỏi phải có ít nhất 2 phương án lựa chọn (Đáp án A và Đáp án B).');
  }

  const canonicalOptions = optionTexts.map((text, idx) => ({
    id: `opt_${idx + 1}`,
    text
  }));

  // Resolve correct answer
  const rawCorrect = row.correct_answer || row.correct_answer_key?.correct_answer || row.dapan || row.answer;
  if (rawCorrect === undefined || rawCorrect === null || String(rawCorrect).trim() === '') {
    throw new Error('Thiếu đáp án đúng.');
  }

  let resolvedOptionId = null;
  let resolvedOptionIds = [];

  if (canonicalType === 'single_choice') {
    resolvedOptionId = resolveTargetToOptionId(rawCorrect, canonicalOptions);
    if (!resolvedOptionId) {
      throw new Error(`Đáp án đúng "${String(rawCorrect).trim()}" không khớp với bất kỳ phương án nào (A, B, C, D hoặc nội dung lựa chọn).`);
    }
  } else {
    // multiple_choice
    let rawTargets = [];
    if (Array.isArray(rawCorrect)) {
      rawTargets = rawCorrect;
    } else {
      rawTargets = String(rawCorrect).split(/[;,]/).map(s => s.trim()).filter(Boolean);
    }

    if (rawTargets.length === 0) {
      throw new Error('Thiếu đáp án đúng.');
    }

    const resolvedSet = new Set();
    for (const target of rawTargets) {
      const optId = resolveTargetToOptionId(target, canonicalOptions);
      if (!optId) {
        throw new Error(`Đáp án đúng "${String(target).trim()}" không khớp với bất kỳ phương án nào (A, B, C, D hoặc nội dung lựa chọn).`);
      }
      resolvedSet.add(optId);
    }

    resolvedOptionIds = canonicalOptions
      .map(o => o.id)
      .filter(id => resolvedSet.has(id));

    if (resolvedOptionIds.length === 0) {
      throw new Error('Câu hỏi trắc nghiệm nhiều đáp án phải có ít nhất 1 đáp án đúng.');
    }
  }

  const points = parseFloat(row.points) > 0 ? parseFloat(row.points) : 10.00;
  
  const rawTime = row.time_limit_seconds !== undefined ? row.time_limit_seconds : row.time;
  let timeLimit = 30;
  if (rawTime !== undefined && rawTime !== null && String(rawTime).trim() !== '') {
    const parsedTime = parseInt(rawTime, 10);
    if (!isNaN(parsedTime) && parsedTime >= 5 && parsedTime <= 600) {
      timeLimit = parsedTime;
    }
  }

  return {
    question_order: order,
    question_text: prompt,
    question_type: canonicalType,
    points,
    time_limit_seconds: timeLimit,
    options: canonicalOptions,
    correct_answer: canonicalType === 'multiple_choice'
      ? { option_ids: resolvedOptionIds }
      : { option_id: resolvedOptionId },
    explanation: row.explanation ? String(row.explanation).trim() : null
  };
}

/**
 * Reindexes questions array to ensure contiguous 1..N question_order.
 */
export function reindexCompetitionQuestions(questions = []) {
  if (!Array.isArray(questions)) return [];
  return questions.map((q, idx) => ({
    ...q,
    question_order: idx + 1
  }));
}

/**
 * Sanitizes questions array before sending to hostCreateSession RPC payload.
 * Preserves canonical types: single_choice and multiple_choice.
 * Fails closed on unsupported types or malformed answers.
 * Ensures zero internal metadata (like _sourceBankId) is transmitted.
 */
export function sanitizeQuestionsForCreation(questions = []) {
  if (!Array.isArray(questions)) return [];
  if (questions.length > MAX_COMPETITION_QUESTIONS) {
    throw new Error(`Số lượng câu hỏi (${questions.length}) vượt quá giới hạn tối đa ${MAX_COMPETITION_QUESTIONS} câu.`);
  }
  return questions.map((q, idx) => {
    const qType = q.question_type;
    if (qType !== 'single_choice' && qType !== 'multiple_choice') {
      throw new Error(`Loại câu hỏi "${qType}" không được hỗ trợ trong Đấu trường (chỉ chấp nhận single_choice hoặc multiple_choice).`);
    }

    const options = (Array.isArray(q.options) ? q.options : []).map(opt => ({
      id: String(opt.id),
      text: String(opt.text || '').trim()
    }));

    if (options.length < 2) {
      throw new Error(`Câu hỏi ${idx + 1} phải có ít nhất 2 phương án lựa chọn.`);
    }

    const validOptionIds = new Set(options.map(o => o.id));

    let correctAnswer;
    if (qType === 'multiple_choice') {
      const rawIds = Array.isArray(q.correct_answer?.option_ids) ? q.correct_answer.option_ids : [];
      const optionIds = Array.from(new Set(rawIds.map(id => String(id).trim()).filter(Boolean)));
      if (optionIds.length === 0) {
        throw new Error(`Câu hỏi ${idx + 1} (trắc nghiệm nhiều đáp án) thiếu đáp án đúng.`);
      }
      for (const optId of optionIds) {
        if (!validOptionIds.has(optId)) {
          throw new Error(`Câu hỏi ${idx + 1} chứa đáp án đúng không nằm trong danh sách lựa chọn: "${optId}".`);
        }
      }
      correctAnswer = { option_ids: optionIds };
    } else {
      const optionId = String(q.correct_answer?.option_id || '').trim();
      if (!optionId) {
        throw new Error(`Câu hỏi ${idx + 1} (trắc nghiệm 1 đáp án) thiếu đáp án đúng.`);
      }
      if (!validOptionIds.has(optionId)) {
        throw new Error(`Câu hỏi ${idx + 1} chứa đáp án đúng không nằm trong danh sách lựa chọn: "${optionId}".`);
      }
      correctAnswer = { option_id: optionId };
    }

    return {
      question_order: idx + 1,
      question_text: String(q.question_text || '').trim(),
      question_type: qType,
      points: parseFloat(q.points) || 10.00,
      time_limit_seconds: parseInt(q.time_limit_seconds, 10) || 30,
      options,
      correct_answer: correctAnswer
    };
  });
}

/**
 * Checks if candidate question is already in existing questions list.
 */
export function isDuplicateQuestion(candidate, existingList = []) {
  if (!candidate || !Array.isArray(existingList)) return false;

  // Check by _sourceBankId if available
  if (candidate._sourceBankId) {
    const hasSameId = existingList.some(q => q._sourceBankId && q._sourceBankId === candidate._sourceBankId);
    if (hasSameId) return true;
  }

  // Check by normalized question text (trimmed and lowercased)
  const candPrompt = String(candidate.question_text || candidate.prompt || candidate.title || '').trim().toLowerCase();
  for (const existing of existingList) {
    const exPrompt = String(existing.question_text || existing.prompt || existing.title || '').trim().toLowerCase();
    if (candPrompt === exPrompt && candPrompt.length > 0) {
      return true;
    }
  }

  return false;
}

/**
 * Creates canonical Excel template workbook for Competition.
 * Headers match parseExcelQuestions required contract for 100% round-trip fidelity.
 * Includes both single_choice and multiple_choice examples.
 * Distinct times [25, 45, 60] verify round-trip persistence.
 *
 * @returns {import('xlsx').WorkBook}
 */
export function createCompetitionExcelTemplateWorkbook() {
  const headers = [
    'type',
    'question',
    'option_a',
    'option_b',
    'option_c',
    'option_d',
    'correct_answer',
    'points',
    'time_limit_seconds'
  ];

  const sampleRows = [
    [
      'single_choice',
      'Thủ đô của Việt Nam là thành phố nào?',
      'Hà Nội',
      'TP. Hồ Chí Minh',
      'Đà Nẵng',
      'Cần Thơ',
      'A',
      10,
      25
    ],
    [
      'multiple_choice',
      'Những thành phố nào trực thuộc trung ương của Việt Nam? (Chọn nhiều đáp án, cách nhau bằng dấu chấm phẩy ;)',
      'Hà Nội',
      'Đà Lạt',
      'Đà Nẵng',
      'Nha Trang',
      'A;C',
      10,
      45
    ],
    [
      'single_choice',
      'Hình vuông có mấy cạnh bằng nhau?',
      '2 cạnh',
      '3 cạnh',
      '4 cạnh',
      '5 cạnh',
      'C',
      10,
      60
    ]
  ];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleRows]);

  // Set column widths
  ws['!cols'] = [
    { wch: 15 }, // type
    { wch: 45 }, // question
    { wch: 20 }, // option_a
    { wch: 20 }, // option_b
    { wch: 20 }, // option_c
    { wch: 20 }, // option_d
    { wch: 15 }, // correct_answer
    { wch: 10 }, // points
    { wch: 18 }  // time_limit_seconds
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'CauHoiDauTruong');
  return wb;
}

/**
 * Generates and triggers download of Excel template for Competition.
 */
export function downloadCompetitionExcelTemplate() {
  const wb = createCompetitionExcelTemplateWorkbook();
  const filename = 'Mau_Nhap_Cau_Hoi_Dau_Truong.xlsx';
  XLSX.writeFile(wb, filename);
}