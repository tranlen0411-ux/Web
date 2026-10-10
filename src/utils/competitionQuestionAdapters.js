// src/utils/competitionQuestionAdapters.js
// Adapter utilities for Competition V1 R14 Question Sources (Manual, Question Bank, Excel)

import * as XLSX from 'xlsx';

// Authoritative frontend maximum competition questions per session
export const MAX_COMPETITION_QUESTIONS = 20;

/**
 * Generates a client-safe temporary unique ID for matching options.
 */
export function generateMatchingTempId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'm_opt_' + Math.random().toString(36).slice(2, 11) + '_' + Date.now().toString(36);
}

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
 * Normalizes an array or delimited string of accepted answers into a canonical deduplicated list.
 * Rules:
 * - Trims each answer
 * - Discards empty strings
 * - Deduplicates case-insensitively (lower(btrim())) preserving first seen original casing
 * - Preserves deterministic ordering
 */
export function normalizeAcceptedAnswers(input) {
  let rawList = [];
  if (Array.isArray(input)) {
    rawList = input;
  } else if (typeof input === 'string') {
    rawList = input.split(';').map(s => s.trim());
  } else if (input !== null && input !== undefined) {
    rawList = [String(input).trim()];
  }

  const seenNormalized = new Set();
  const result = [];

  for (const item of rawList) {
    if (typeof item !== 'string' && typeof item !== 'number') {
      continue;
    }
    const trimmed = String(item).trim();
    if (!trimmed) continue;

    const normKey = trimmed.toLowerCase();
    if (!seenNormalized.has(normKey)) {
      seenNormalized.add(normKey);
      result.push(trimmed);
    }
  }

  return result;
}

/**
 * Normalizes Question Bank item/version/authoring detail to canonical Competition question format.
 * Supports full authoring detail from getQuestionAuthoringDetail ({ item, version, answer_key })
 * as well as list summary items.
 * Supports: single_choice, multiple_choice, fill_blank.
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

  // Question Type Check (R15B supports single_choice, multiple_choice, and fill_blank)
  const rawType = versionObj.question_type || itemObj.question_type || input.question_type || input.type || 'single_choice';
  if (rawType !== 'single_choice' && rawType !== 'multiple_choice' && rawType !== 'fill_blank' && rawType !== 'short_answer') {
    throw new Error(`Loại câu hỏi "${rawType}" chưa được hỗ trợ trong Đấu trường (chỉ hỗ trợ Trắc nghiệm 1 đáp án, Trắc nghiệm nhiều đáp án hoặc Điền vào chỗ trống).`);
  }
  // Canonical backend type: fill_blank -> short_answer
  const canonicalType = (rawType === 'fill_blank' || rawType === 'short_answer') ? 'short_answer' : rawType;

  // Extract Question Text / Prompt
  const promptText = (
    versionObj.prompt ||
    versionObj.question_text ||
    versionObj.title ||
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

  // Points & Time Limit
  const rawPoints = input.points || versionObj.points || itemObj.points;
  const points = parseFloat(rawPoints) > 0 ? parseFloat(rawPoints) : 10.00;

  const rawTime = input.time_limit_seconds || versionObj.time_limit_seconds || itemObj.time_limit_seconds;
  const timeLimit = (parseInt(rawTime, 10) >= 5 && parseInt(rawTime, 10) <= 600)
    ? parseInt(rawTime, 10)
    : 30;

  const explanation = (versionObj.explanation || itemObj.explanation || input.explanation || '').trim() || null;
  const sourceBankId = itemObj.id || input.id || null;

  // Handle canonical short_answer (fill_blank)
  if (canonicalType === 'short_answer') {
    const rawAnswers = answerKeyObj.correct_answers !== undefined
      ? answerKeyObj.correct_answers
      : (answerKeyObj.accepted_answers !== undefined
        ? answerKeyObj.accepted_answers
        : (answerKeyObj.correct_answer !== undefined
          ? answerKeyObj.correct_answer
          : (itemObj.correct_answers || itemObj.accepted_answers || itemObj.correct_answer || versionObj.correct_answers || versionObj.accepted_answers || versionObj.correct_answer || input.correct_answers || input.accepted_answers || input.correct_answer || [])));

    const acceptedAnswers = normalizeAcceptedAnswers(rawAnswers);
    if (acceptedAnswers.length === 0) {
      throw new Error('Câu hỏi điền vào chỗ trống từ Ngân hàng phải có ít nhất 1 đáp án đúng được chấp nhận.');
    }

    return {
      question_order: order,
      question_text: promptText,
      question_type: 'short_answer',
      points,
      time_limit_seconds: timeLimit,
      options: [],
      correct_answer: {
        accepted_answers: acceptedAnswers
      },
      explanation,
      _sourceBankId: sourceBankId
    };
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
 * Supports: single_choice, multiple_choice, fill_blank.
 *
 * @param {Object} row - Parsed Excel row object
 * @param {number} [order=1] - Sequential question order
 * @returns {Object} Canonical Competition Question
 */
export function normalizeImportedQuestionToCompetitionQuestion(row, order = 1) {
  if (!row || typeof row !== 'object') {
    throw new Error('Dữ liệu dòng Excel không hợp lệ.');
  }

  // Enforce single_choice, multiple_choice, or fill_blank for Competition
  const rawType = row.question_type || row.type || 'single_choice';
  if (rawType !== 'single_choice' && rawType !== 'multiple_choice' && rawType !== 'fill_blank' && rawType !== 'short_answer') {
    throw new Error(`Loại câu hỏi "${rawType}" chưa được hỗ trợ trong Đấu trường (chỉ hỗ trợ Trắc nghiệm 1 đáp án, Trắc nghiệm nhiều đáp án hoặc Điền vào chỗ trống).`);
  }
  const canonicalType = (rawType === 'fill_blank' || rawType === 'short_answer') ? 'short_answer' : rawType;

  const prompt = (row.question_text || row.question || row.prompt || row.debai || '').trim();
  if (!prompt) {
    throw new Error('Nội dung câu hỏi không được để trống.');
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

  const explanation = row.explanation ? String(row.explanation).trim() : null;

  // Handle canonical short_answer (fill_blank)
  if (canonicalType === 'short_answer') {
    const rawCorrect = row.correct_answer !== undefined && row.correct_answer !== null
      ? row.correct_answer
      : (row.correct_answers !== undefined && row.correct_answers !== null
        ? row.correct_answers
        : (row.correct_answer_key?.accepted_answers || row.correct_answer_key?.correct_answer || row.dapan || row.answer));

    if (rawCorrect === undefined || rawCorrect === null || String(rawCorrect).trim() === '') {
      throw new Error('Thiếu đáp án đúng cho câu hỏi điền vào chỗ trống.');
    }

    const acceptedAnswers = normalizeAcceptedAnswers(rawCorrect);
    if (acceptedAnswers.length === 0) {
      throw new Error('Câu hỏi điền vào chỗ trống phải có ít nhất 1 đáp án đúng.');
    }

    return {
      question_order: order,
      question_text: prompt,
      question_type: 'short_answer',
      points,
      time_limit_seconds: timeLimit,
      options: [],
      correct_answer: {
        accepted_answers: acceptedAnswers
      },
      explanation
    };
  }

  // Collect option texts for choice-based questions
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
    explanation
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
 * Canonical backend types allowed: single_choice, multiple_choice, short_answer.
 * Strips internal metadata (e.g. _sourceBankId, _sourceType) before sending.
 * Translates fill_blank source type to canonical short_answer.
 * Fails closed on unsupported types or malformed answers.
 */
export function sanitizeQuestionsForCreation(questions = []) {
  if (!Array.isArray(questions)) return [];
  if (questions.length > MAX_COMPETITION_QUESTIONS) {
    throw new Error(`Số lượng câu hỏi (${questions.length}) vượt quá giới hạn tối đa ${MAX_COMPETITION_QUESTIONS} câu.`);
  }
  return questions.map((q, idx) => {
    let qType = q.question_type;
    if (qType === 'fill_blank') {
      qType = 'short_answer';
    }

    if (qType !== 'single_choice' && qType !== 'multiple_choice' && qType !== 'short_answer' && qType !== 'matching') {
      throw new Error(`Loại câu hỏi "${qType}" không được hỗ trợ trong Đấu trường (chỉ chấp nhận single_choice, multiple_choice, short_answer hoặc matching).`);
    }

    const questionText = String(q.question_text || '').trim();
    if (!questionText) {
      throw new Error(`Câu hỏi ${idx + 1} có nội dung trống.`);
    }

    const points = parseFloat(q.points) > 0 ? parseFloat(q.points) : 10.00;
    const timeLimit = (parseInt(q.time_limit_seconds, 10) >= 5 && parseInt(q.time_limit_seconds, 10) <= 600)
      ? parseInt(q.time_limit_seconds, 10)
      : 30;

    // Handle canonical short_answer
    if (qType === 'short_answer') {
      const rawAnswers = q.correct_answer?.accepted_answers !== undefined
        ? q.correct_answer.accepted_answers
        : (q.correct_answers !== undefined
          ? q.correct_answers
          : (q.accepted_answers !== undefined ? q.accepted_answers : q.correct_answer));

      const acceptedAnswers = normalizeAcceptedAnswers(rawAnswers);
      if (acceptedAnswers.length === 0) {
        throw new Error(`Câu hỏi ${idx + 1} (điền vào chỗ trống) phải có ít nhất 1 đáp án đúng.`);
      }

      return {
        question_order: idx + 1,
        question_text: questionText,
        question_type: 'short_answer',
        points,
        time_limit_seconds: timeLimit,
        options: [],
        correct_answer: {
          accepted_answers: acceptedAnswers
        },
        ...(q.explanation ? { explanation: String(q.explanation).trim() } : {})
      };
    }

    // Handle canonical matching (2 to 6 pairs, equal left & right, bijective correct mapping)
    if (qType === 'matching') {
      let rawOptions = Array.isArray(q.options) ? q.options : [];
      let rawPairs = Array.isArray(q.correct_answer?.pairs) ? q.correct_answer.pairs : [];

      if (rawOptions.length === 0 && Array.isArray(q.matching_pairs) && q.matching_pairs.length > 0) {
        rawOptions = [];
        rawPairs = [];
        q.matching_pairs.forEach((mp) => {
          const lId = generateMatchingTempId();
          const rId = generateMatchingTempId();
          rawOptions.push({ id: lId, side: 'left', text: String(mp.left_text || '').trim() });
          rawOptions.push({ id: rId, side: 'right', text: String(mp.right_text || '').trim() });
          rawPairs.push({ left_id: lId, right_id: rId });
        });
      }

      const leftOptions = [];
      const rightOptions = [];
      const allOptionIds = new Set();

      for (let i = 0; i < rawOptions.length; i++) {
        const opt = rawOptions[i];
        if (!opt || typeof opt !== 'object') {
          throw new Error(`Lựa chọn thứ ${i + 1} của câu hỏi ${idx + 1} không hợp lệ.`);
        }
        const optId = String(opt.id || '').trim();
        const side = String(opt.side || '').trim();
        const text = String(opt.text || '').trim();

        if (!optId) {
          throw new Error(`Lựa chọn thứ ${i + 1} của câu hỏi ${idx + 1} thiếu định danh ID.`);
        }
        if (!text) {
          throw new Error(`Nội dung lựa chọn thứ ${i + 1} của câu hỏi ${idx + 1} không được để trống.`);
        }
        if (side !== 'left' && side !== 'right') {
          throw new Error(`Thuộc tính vế (side) của lựa chọn thứ ${i + 1} câu hỏi ${idx + 1} phải là 'left' hoặc 'right'.`);
        }
        if (allOptionIds.has(optId)) {
          throw new Error(`Định danh ID "${optId}" bị trùng lặp trong câu hỏi ${idx + 1}.`);
        }
        allOptionIds.add(optId);

        const cleanOpt = { id: optId, side, text };
        if (side === 'left') {
          leftOptions.push(cleanOpt);
        } else {
          rightOptions.push(cleanOpt);
        }
      }

      if (leftOptions.length < 2 || leftOptions.length > 6 || rightOptions.length < 2 || rightOptions.length > 6 || leftOptions.length !== rightOptions.length) {
        throw new Error(`Câu hỏi ${idx + 1} (nối cặp) phải có từ 2 đến 6 cặp và số lượng hai vế phải bằng nhau.`);
      }

      const pairs = Array.isArray(rawPairs) && rawPairs.length > 0 ? rawPairs : (Array.isArray(q.correct_answer?.pairs) ? q.correct_answer.pairs : []);
      if (pairs.length !== leftOptions.length) {
        throw new Error(`Số lượng cặp nối đáp án đúng (${pairs.length}) không khớp với số lượng mục (${leftOptions.length}) trong câu hỏi ${idx + 1}.`);
      }

      const validLeftIds = new Set(leftOptions.map(o => o.id));
      const validRightIds = new Set(rightOptions.map(o => o.id));
      const seenLeft = new Set();
      const seenRight = new Set();
      const sanitizedPairs = [];

      for (let pIdx = 0; pIdx < pairs.length; pIdx++) {
        const pair = pairs[pIdx];
        if (!pair || typeof pair !== 'object') {
          throw new Error(`Cặp nối thứ ${pIdx + 1} của câu hỏi ${idx + 1} không hợp lệ.`);
        }
        const leftId = String(pair.left_id || '').trim();
        const rightId = String(pair.right_id || '').trim();

        if (!leftId || !rightId) {
          throw new Error(`Cặp nối thứ ${pIdx + 1} của câu hỏi ${idx + 1} thiếu ID vế trái hoặc vế phải.`);
        }
        if (!validLeftIds.has(leftId)) {
          throw new Error(`ID vế trái "${leftId}" trong cặp nối ${pIdx + 1} không tồn tại ở vế trái câu hỏi ${idx + 1}.`);
        }
        if (!validRightIds.has(rightId)) {
          throw new Error(`ID vế phải "${rightId}" trong cặp nối ${pIdx + 1} không tồn tại ở vế phải câu hỏi ${idx + 1}.`);
        }
        if (seenLeft.has(leftId)) {
          throw new Error(`Vế trái "${leftId}" bị ghép nối nhiều lần trong câu hỏi ${idx + 1}.`);
        }
        if (seenRight.has(rightId)) {
          throw new Error(`Vế phải "${rightId}" bị ghép nối nhiều lần trong câu hỏi ${idx + 1}.`);
        }
        seenLeft.add(leftId);
        seenRight.add(rightId);

        sanitizedPairs.push({ left_id: leftId, right_id: rightId });
      }

      return {
        question_order: idx + 1,
        question_text: questionText,
        question_type: 'matching',
        points,
        time_limit_seconds: timeLimit,
        options: [...leftOptions, ...rightOptions],
        correct_answer: {
          pairs: sanitizedPairs
        },
        ...(q.explanation ? { explanation: String(q.explanation).trim() } : {})
      };
    }

    // Choice-based questions
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
      question_text: questionText,
      question_type: qType,
      points,
      time_limit_seconds: timeLimit,
      options,
      correct_answer: correctAnswer,
      ...(q.explanation ? { explanation: String(q.explanation).trim() } : {})
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
 * Includes single_choice, multiple_choice, and fill_blank examples.
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
      'fill_blank',
      'Thủ đô của Việt Nam là thành phố nào? (Nhập đáp án; nếu có nhiều đáp án tương đương thì cách nhau bằng dấu chấm phẩy ;)',
      '',
      '',
      '',
      '',
      'Hà Nội;Ha Noi;Hanoi',
      10,
      30
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
    { wch: 20 }, // correct_answer
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