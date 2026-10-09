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
 * Normalizes Question Bank item/version/authoring detail to canonical Competition question format.
 * Supports full authoring detail from getQuestionAuthoringDetail ({ item, version, answer_key })
 * as well as list summary items.
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

  // Question Type Check (R14 Phase 1: single_choice only)
  const rawType = versionObj.question_type || itemObj.question_type || input.question_type || input.type || 'single_choice';
  if (rawType !== 'single_choice') {
    throw new Error(`Loại câu hỏi "${rawType}" chưa được hỗ trợ trong Đấu trường R14 (chỉ hỗ trợ Trắc nghiệm 1 đáp án).`);
  }

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

  // Resolve Correct Answer Option ID
  let target = null;
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

  if (target === null || target === undefined || String(target).trim() === '') {
    throw new Error('Câu hỏi thiếu thông tin đáp án đúng.');
  }

  const targetStr = String(target).trim();
  let resolvedOptionId = null;

  // 1. Match by _originalId (e.g. 'opt_uuid_a', 'opt_1')
  const matchByOrig = canonicalOptions.find(o => o._originalId && o._originalId.toLowerCase() === targetStr.toLowerCase());
  if (matchByOrig) {
    resolvedOptionId = matchByOrig.id;
  }

  // 2. Match by letter A, B, C, D...
  if (!resolvedOptionId) {
    const upperTarget = targetStr.toUpperCase();
    if (['A', 'B', 'C', 'D', 'E', 'F'].includes(upperTarget)) {
      const letterIdx = upperTarget.charCodeAt(0) - 65;
      if (letterIdx >= 0 && letterIdx < canonicalOptions.length) {
        resolvedOptionId = canonicalOptions[letterIdx].id;
      }
    }
  }

  // 3. Match by canonical ID (opt_1, opt_2, ...)
  if (!resolvedOptionId && /^opt_\d+$/i.test(targetStr)) {
    const matchOpt = canonicalOptions.find(o => o.id.toLowerCase() === targetStr.toLowerCase());
    if (matchOpt) {
      resolvedOptionId = matchOpt.id;
    }
  }

  // 4. Match by option text (case-insensitive)
  if (!resolvedOptionId) {
    const matchText = canonicalOptions.find(o => o.text.toLowerCase() === targetStr.toLowerCase());
    if (matchText) {
      resolvedOptionId = matchText.id;
    }
  }

  // 5. Match by 1-based numerical index
  if (!resolvedOptionId) {
    const numIdx = parseInt(targetStr, 10);
    if (!isNaN(numIdx) && numIdx >= 1 && numIdx <= canonicalOptions.length) {
      resolvedOptionId = canonicalOptions[numIdx - 1].id;
    }
  }

  if (!resolvedOptionId) {
    throw new Error(`Không thể ánh xạ đáp án đúng "${targetStr}" vào danh sách các phương án lựa chọn.`);
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
    question_type: 'single_choice',
    points,
    time_limit_seconds: timeLimit,
    options: cleanOptions,
    correct_answer: { option_id: resolvedOptionId },
    explanation,
    _sourceBankId: sourceBankId
  };
}

/**
 * Normalizes an imported Excel row into canonical Competition question format.
 *
 * @param {Object} row - Parsed Excel row object
 * @param {number} [order=1] - Sequential question order
 * @returns {Object} Canonical Competition Question
 */
export function normalizeImportedQuestionToCompetitionQuestion(row, order = 1) {
  if (!row || typeof row !== 'object') {
    throw new Error('Dữ liệu dòng Excel không hợp lệ.');
  }

  // Enforce single_choice for Competition Phase 1
  const rawType = row.question_type || row.type || 'single_choice';
  if (rawType !== 'single_choice') {
    throw new Error('R14 hiện chỉ hỗ trợ Trắc nghiệm 1 đáp án.');
  }

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

  const correctStr = String(rawCorrect).trim();
  const upper = correctStr.toUpperCase();
  let resolvedOptionId = null;

  // Check letter A/B/C/D
  if (['A', 'B', 'C', 'D', 'E', 'F'].includes(upper)) {
    const letterIdx = upper.charCodeAt(0) - 65;
    if (letterIdx >= 0 && letterIdx < canonicalOptions.length) {
      resolvedOptionId = canonicalOptions[letterIdx].id;
    }
  } else if (/^opt_\d+$/i.test(correctStr)) {
    const matchOpt = canonicalOptions.find(o => o.id.toLowerCase() === correctStr.toLowerCase());
    if (matchOpt) resolvedOptionId = matchOpt.id;
  }

  // Check matching option text
  if (!resolvedOptionId) {
    const matchText = canonicalOptions.find(o => o.text.toLowerCase() === correctStr.toLowerCase());
    if (matchText) resolvedOptionId = matchText.id;
  }

  // Check index 1/2/3/4
  if (!resolvedOptionId) {
    const numIdx = parseInt(correctStr, 10);
    if (!isNaN(numIdx) && numIdx >= 1 && numIdx <= canonicalOptions.length) {
      resolvedOptionId = canonicalOptions[numIdx - 1].id;
    }
  }

  if (!resolvedOptionId) {
    throw new Error(`Đáp án đúng "${correctStr}" không khớp với bất kỳ phương án nào (A, B, C, D hoặc nội dung lựa chọn).`);
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
    question_type: 'single_choice',
    points,
    time_limit_seconds: timeLimit,
    options: canonicalOptions,
    correct_answer: { option_id: resolvedOptionId },
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
 * Ensures zero internal metadata (like _sourceBankId) is transmitted.
 */
export function sanitizeQuestionsForCreation(questions = []) {
  if (!Array.isArray(questions)) return [];
  return questions.map((q, idx) => ({
    question_order: idx + 1,
    question_text: String(q.question_text || '').trim(),
    question_type: 'single_choice',
    points: parseFloat(q.points) || 10.00,
    time_limit_seconds: parseInt(q.time_limit_seconds, 10) || 30,
    options: (Array.isArray(q.options) ? q.options : []).map(opt => ({
      id: String(opt.id),
      text: String(opt.text || '').trim()
    })),
    correct_answer: {
      option_id: String(q.correct_answer?.option_id || 'opt_1')
    }
  }));
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
      'single_choice',
      'Kết quả của phép tính 25 + 75 là bao nhiêu?',
      '90',
      '100',
      '110',
      '120',
      'B',
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