// src/utils/competitionQuestionAdapters.js
// Adapter utilities for Competition V1 R14 Question Sources (Manual, Question Bank, Excel)

import * as XLSX from 'xlsx';

/**
 * Normalizes an option string or object into a canonical Competition option: { id: string, text: string }
 */
export function normalizeOption(opt, index) {
  const optId = `opt_${index + 1}`;
  if (typeof opt === 'string') {
    return { id: optId, text: opt.trim() };
  }
  if (opt && typeof opt === 'object') {
    const text = typeof opt.text === 'string' ? opt.text.trim() : (typeof opt.prompt === 'string' ? opt.prompt.trim() : String(opt.value || opt.content || '').trim());
    return { id: optId, text };
  }
  return { id: optId, text: String(opt || '').trim() };
}

/**
 * Normalizes Question Bank item/version/authoring detail to canonical Competition question format.
 * Returns null or throws if malformed or unsupported.
 *
 * @param {Object} item - Question Bank item object
 * @param {number} [order=1] - Sequential question order
 * @returns {Object} Canonical Competition Question
 */
export function normalizeQuestionBankItemToCompetitionQuestion(item, order = 1) {
  if (!item || typeof item !== 'object') {
    throw new Error('Dữ liệu câu hỏi từ Ngân hàng không hợp lệ (đối tượng rỗng).');
  }

  // Question Type Check (R14 Phase 1: single_choice only)
  const rawType = item.question_type || item.type || item.authoring_version?.question_type || 'single_choice';
  if (rawType !== 'single_choice') {
    throw new Error(`Loại câu hỏi "${rawType}" chưa được hỗ trợ trong Đấu trường R14 (chỉ hỗ trợ Trắc nghiệm 1 đáp án).`);
  }

  // Extract Question Text / Prompt
  const promptText = (item.prompt || item.question_text || item.title || item.authoring_version?.prompt || '').trim();
  if (!promptText) {
    throw new Error('Nội dung câu hỏi không được để trống.');
  }

  // Extract Options
  let rawOptions = [];
  if (Array.isArray(item.options)) {
    rawOptions = item.options;
  } else if (Array.isArray(item.authoring_version?.options)) {
    rawOptions = item.authoring_version.options;
  } else if (Array.isArray(item.options_json)) {
    rawOptions = item.options_json;
  }

  if (!rawOptions || rawOptions.length < 2) {
    throw new Error('Câu hỏi trắc nghiệm yêu cầu ít nhất 2 phương án lựa chọn.');
  }

  // Build Canonical Options: [ { id: 'opt_1', text: '...' }, { id: 'opt_2', text: '...' }, ... ]
  const canonicalOptions = [];
  for (let i = 0; i < rawOptions.length; i++) {
    const norm = normalizeOption(rawOptions[i], i);
    if (!norm.text) {
      throw new Error(`Phương án lựa chọn thứ ${i + 1} có nội dung trống.`);
    }
    canonicalOptions.push(norm);
  }

  // Resolve Correct Answer Option ID
  let target = null;
  const ak = item.correct_answer || item.answer_key || item.correct_answer_key || item.authoring_version?.correct_answer || item.authoring_version?.answer_key;
  if (typeof ak === 'string') {
    target = ak.trim();
  } else if (ak && typeof ak === 'object') {
    target = ak.option_id || ak.correct_option_id || ak.correct_answer || ak.key || null;
  }

  if (target === null || target === undefined || String(target).trim() === '') {
    throw new Error('Câu hỏi thiếu thông tin đáp án đúng.');
  }

  const targetStr = String(target).trim();
  let resolvedOptionId = null;

  // 1. Match by original key / id (e.g. 'A', 'B', 'C', 'D' or 'opt_1', 'opt_2')
  const upperTarget = targetStr.toUpperCase();
  if (['A', 'B', 'C', 'D', 'E', 'F'].includes(upperTarget)) {
    const letterIdx = upperTarget.charCodeAt(0) - 65;
    if (letterIdx >= 0 && letterIdx < canonicalOptions.length) {
      resolvedOptionId = canonicalOptions[letterIdx].id;
    }
  } else if (/^opt_\d+$/i.test(targetStr)) {
    const matchOpt = canonicalOptions.find(o => o.id.toLowerCase() === targetStr.toLowerCase());
    if (matchOpt) {
      resolvedOptionId = matchOpt.id;
    }
  }

  // 2. Match by option text
  if (!resolvedOptionId) {
    const matchByText = canonicalOptions.find(o => o.text.toLowerCase() === targetStr.toLowerCase());
    if (matchByText) {
      resolvedOptionId = matchByText.id;
    }
  }

  // 3. Match by 1-based index (e.g. '1', '2', '3', '4')
  if (!resolvedOptionId) {
    const numIdx = parseInt(targetStr, 10);
    if (!isNaN(numIdx) && numIdx >= 1 && numIdx <= canonicalOptions.length) {
      resolvedOptionId = canonicalOptions[numIdx - 1].id;
    }
  }

  if (!resolvedOptionId) {
    throw new Error(`Không thể ánh xạ đáp án đúng "${targetStr}" vào danh sách các phương án lựa chọn.`);
  }

  // Points & Time Limit
  const points = parseFloat(item.points) > 0 ? parseFloat(item.points) : 10.00;
  const timeLimit = (parseInt(item.time_limit_seconds, 10) >= 5 && parseInt(item.time_limit_seconds, 10) <= 600)
    ? parseInt(item.time_limit_seconds, 10)
    : 30;

  return {
    question_order: order,
    question_text: promptText,
    question_type: 'single_choice',
    points,
    time_limit_seconds: timeLimit,
    options: canonicalOptions,
    correct_answer: { option_id: resolvedOptionId },
    explanation: item.explanation ? String(item.explanation).trim() : null,
    _sourceBankId: item.id || null
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
  const rawCorrect = row.correct_answer || row.dapan || row.answer;
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
  const timeLimit = (parseInt(row.time_limit_seconds || row.time, 10) >= 5 && parseInt(row.time_limit_seconds || row.time, 10) <= 600)
    ? parseInt(row.time_limit_seconds || row.time, 10)
    : 30;

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

  // Check by normalized question text
  const candPrompt = String(candidate.question_text || '').trim().toLowerCase();
  for (const existing of existingList) {
    const exPrompt = String(existing.question_text || '').trim().toLowerCase();
    if (candPrompt === exPrompt && candPrompt.length > 0) {
      return true;
    }
  }

  return false;
}

/**
 * Generates and triggers download of Excel template for Competition.
 */
export function downloadCompetitionExcelTemplate() {
  const headers = [
    'Nội dung câu hỏi',
    'Đáp án A',
    'Đáp án B',
    'Đáp án C',
    'Đáp án D',
    'Đáp án đúng',
    'Điểm',
    'Thời gian (giây)'
  ];

  const sampleRows = [
    [
      'Thủ đô của Việt Nam là thành phố nào?',
      'Hà Nội',
      'TP. Hồ Chí Minh',
      'Đà Nẵng',
      'Cần Thơ',
      'A',
      10,
      30
    ],
    [
      'Kết quả của phép tính 25 + 75 là bao nhiêu?',
      '90',
      '100',
      '110',
      '120',
      'B',
      10,
      30
    ],
    [
      'Hình vuông có mấy cạnh bằng nhau?',
      '2 cạnh',
      '3 cạnh',
      '4 cạnh',
      '5 cạnh',
      'C',
      10,
      30
    ]
  ];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleRows]);

  // Set column widths
  ws['!cols'] = [
    { wch: 45 }, // Nội dung
    { wch: 20 }, // A
    { wch: 20 }, // B
    { wch: 20 }, // C
    { wch: 20 }, // D
    { wch: 15 }, // Đáp án đúng
    { wch: 10 }, // Điểm
    { wch: 18 }  // Thời gian
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'CauHoiDauTruong');

  const filename = 'Mau_Nhap_Cau_Hoi_Dau_Truong.xlsx';
  XLSX.writeFile(wb, filename);
}
