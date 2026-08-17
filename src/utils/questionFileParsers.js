import * as XLSX from 'xlsx';
import * as mammoth from 'mammoth';

/**
 * LÀM SẠCH VÀ CHUẨN HÓA VĂN BẢN (BẢO VỆ CHỐNG FORMULA INJECTION VÀ XSS)
 */
export const sanitizeText = (val) => {
  if (val === null || val === undefined) return '';
  let str = String(val).trim();

  // Strip HTML tags
  str = str.replace(/<[^>]*>?/gm, '');

  // Strip formula injection characters =, +, @, - if at beginning of cell (except numbers like -5)
  if (str.startsWith('=') || str.startsWith('+') || str.startsWith('@')) {
    str = str.substring(1).trim();
  }

  return str;
};

/**
 * CHUẨN HÓA CỘT TIÊU ĐỀ BẢNG EXCEL
 */
const normalizeHeader = (header) => {
  if (!header) return '';
  const clean = sanitizeText(header).toLowerCase().replace(/[\s\-_]+/g, '');
  if (clean.includes('loai') || clean === 'type') return 'type';
  if (clean.includes('cauhoi') || clean.includes('debai') || clean === 'question' || clean === 'prompt') return 'question';
  if (clean.includes('luachona') || clean === 'optiona' || clean === 'a') return 'option_a';
  if (clean.includes('luachonb') || clean === 'optionb' || clean === 'b') return 'option_b';
  if (clean.includes('luachonc') || clean === 'optionc' || clean === 'c') return 'option_c';
  if (clean.includes('luachond') || clean === 'optiond' || clean === 'd') return 'option_d';
  if (clean.includes('dapan') || clean === 'correctanswer' || clean === 'answer') return 'correct_answer';
  if (clean.includes('thamkhao') || clean.includes('goiy') || clean === 'referenceanswer') return 'reference_answer';
  if (clean.includes('diem') || clean === 'points' || clean === 'point') return 'points';
  return clean;
};

/**
 * CHUẨN HÓA LOẠI CÂU HỎI
 */
const normalizeType = (typeStr) => {
  if (!typeStr) return null;
  const clean = sanitizeText(typeStr).toLowerCase().replace(/[\s\-_]+/g, '');
  if (clean.includes('tracnghiem') || clean.includes('single') || clean.includes('mcq') || clean === 'choice') return 'single_choice';
  if (clean.includes('dienkhuyet') || clean.includes('dientu') || clean.includes('blank') || clean === 'fill') return 'fill_blank';
  if (clean.includes('tuluan') || clean === 'essay' || clean === 'text') return 'essay';
  return null;
};

/**
 * HÀM CHUẨN HÓA CÂU HỎI DUY NHẤT DÙNG CHUNG CẢ CHUỖI DATA
 * (Excel Row -> State -> Preview -> Validation -> RPC Payload)
 */
export const normalizeImportedQuestion = (q, idx = 0) => {
  if (!q) return null;

  const qNum = q.question_number || (idx + 1);
  const qType = q.question_type || q.type || 'single_choice';
  const rowInfo = q.source_row ? ` (dòng Excel ${q.source_row})` : '';
  const qPrefix = `Câu ${qNum}${rowInfo}`;

  const promptText = String(q.prompt || q.question || '').trim();
  const pts = parseFloat(q.points) || 1;

  if (['single_choice', 'multiple_choice'].includes(qType)) {
    // 1. Chuẩn hóa options_json
    const rawOpts = Array.isArray(q.options)
      ? q.options
      : (Array.isArray(q.options_json) ? q.options_json : []);

    const normOpts = rawOpts
      .map(o => String(o === null || o === undefined ? '' : o).trim())
      .filter(o => o.length > 0);

    // 2. Chuẩn hóa correct_answer
    let rawCorrect = q.correct_answer;
    if (rawCorrect === undefined || rawCorrect === null) {
      if (q.correct_answer_key && q.correct_answer_key.correct_answer) {
        rawCorrect = q.correct_answer_key.correct_answer;
      }
    }

    let resolvedCorrect = '';
    let mappingError = null;

    if (qType === 'single_choice') {
      const strCorrect = String(rawCorrect || '').trim();
      const upperCorrect = strCorrect.toUpperCase();

      if (['A', 'B', 'C', 'D'].includes(upperCorrect) && normOpts.length >= 2) {
        // a) Dạng chữ cái A/B/C/D
        const letterIdx = upperCorrect.charCodeAt(0) - 65;
        if (letterIdx < normOpts.length) {
          resolvedCorrect = normOpts[letterIdx];
        } else {
          mappingError = `${qPrefix}: không ánh xạ được đáp án ${upperCorrect} vào danh sách ${normOpts.length} lựa chọn.`;
        }
      } else if (['1', '2', '3', '4'].includes(strCorrect) && normOpts.length >= 2 && !normOpts.includes(strCorrect)) {
        // b) Dạng số thứ tự 1/2/3/4 (chỉ dùng khi đáp án không phải là chuỗi trùng với nội dung lựa chọn)
        const numIdx = parseInt(strCorrect, 10) - 1;
        if (numIdx < normOpts.length) {
          resolvedCorrect = normOpts[numIdx];
        } else {
          mappingError = `${qPrefix}: không ánh xạ được đáp án chỉ số ${strCorrect} vào options.`;
        }
      } else {
        // c) Nguyên văn nội dung đáp án (ví dụ: "8" hoặc "Hình tam giác")
        const matchOpt = normOpts.find(o => o.toLowerCase() === strCorrect.toLowerCase());
        if (matchOpt) {
          resolvedCorrect = matchOpt;
        } else if (strCorrect) {
          resolvedCorrect = strCorrect;
        }
      }
    } else if (qType === 'multiple_choice') {
      if (Array.isArray(rawCorrect)) {
        resolvedCorrect = rawCorrect.map(a => String(a).trim()).filter(Boolean);
      } else {
        resolvedCorrect = [String(rawCorrect || '').trim()].filter(Boolean);
      }
    }

    const correctAnswerKey = {
      correct_answer: resolvedCorrect,
      accepted_answers: Array.isArray(resolvedCorrect) ? resolvedCorrect : [resolvedCorrect],
      case_sensitive: false
    };

    return {
      id: q.id || undefined,
      question_number: qNum,
      question_type: qType,
      prompt: promptText,
      options: normOpts,
      options_json: normOpts,
      correct_answer: resolvedCorrect,
      correct_answer_key: correctAnswerKey,
      points: pts,
      source_row: q.source_row || null,
      mapping_error: mappingError
    };

  } else if (['fill_blank', 'short_answer'].includes(qType)) {
    let rawCorrect = String(q.correct_answer || (q.correct_answer_key?.correct_answer) || '').trim();

    const correctAnswerKey = {
      correct_answer: rawCorrect,
      accepted_answers: [rawCorrect],
      case_sensitive: false
    };

    return {
      id: q.id || undefined,
      question_number: qNum,
      question_type: qType,
      prompt: promptText,
      options: [],
      options_json: [],
      correct_answer: rawCorrect,
      correct_answer_key: correctAnswerKey,
      points: pts,
      source_row: q.source_row || null
    };

  } else {
    // essay
    const refAnswer = String(q.reference_answer || q.correct_answer || (q.correct_answer_key?.correct_answer) || '').trim();

    const correctAnswerKey = {
      correct_answer: refAnswer || 'Xem hướng dẫn chấm của giáo viên',
      accepted_answers: [refAnswer || 'Xem hướng dẫn chấm của giáo viên'],
      case_sensitive: false
    };

    return {
      id: q.id || undefined,
      question_number: qNum,
      question_type: 'essay',
      prompt: promptText,
      options: [],
      options_json: [],
      correct_answer: refAnswer || 'Xem hướng dẫn chấm của giáo viên',
      reference_answer: refAnswer || 'Xem hướng dẫn chấm của giáo viên',
      correct_answer_key: correctAnswerKey,
      points: pts,
      source_row: q.source_row || null
    };
  }
};

/**
 * TÊN HÀM BẢO TỒN COMPATIBILITY HỖ TRỢ NORMALIZE OPTIONS
 */
export const normalizeQuestionOptions = (q) => {
  const norm = normalizeImportedQuestion(q);
  return norm ? norm.options_json : [];
};

/**
 * PARSER FILE EXCEL (.XLSX, .CSV)
 */
export const parseExcelQuestions = async (arrayBuffer, fileName = '') => {
  const errors = [];
  const warnings = [];
  const parsedQuestions = [];

  try {
    const lowerName = fileName.toLowerCase();
    if (lowerName.endsWith('.xlsm')) {
      return {
        success: false,
        questions: [],
        errors: [{ row: 0, message: 'Định dạng .xlsm chứa macro không được hỗ trợ vì lý do an toàn. Vui lòng chuyển sang .xlsx hoặc .csv.' }],
        warnings: []
      };
    }

    // 1. Đọc workbook từ ArrayBuffer
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      return {
        success: false,
        questions: [],
        errors: [{ row: 0, message: 'Tệp Excel không chứa sheet dữ liệu nào.' }],
        warnings: []
      };
    }

    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

    // 2. Kiểm tra dữ liệu không rỗng
    if (!rawData || rawData.length < 2) {
      return {
        success: false,
        questions: [],
        errors: [{ row: 0, message: 'Tệp Excel rỗng hoặc không có dữ liệu câu hỏi (cần ít nhất 1 dòng tiêu đề và 1 dòng câu hỏi).' }],
        warnings: []
      };
    }

    // 3. Xử lý Header row
    const rawHeaders = rawData[0];
    const normalizedHeaders = rawHeaders.map(h => normalizeHeader(h));

    const requiredColumns = ['type', 'question'];
    const missingCols = requiredColumns.filter(col => !normalizedHeaders.includes(col));
    if (missingCols.length > 0) {
      return {
        success: false,
        questions: [],
        errors: [{ row: 1, message: `Thiếu các cột bắt buộc: ${missingCols.join(', ')}. Vui lòng tải file mẫu để xem định dạng chuẩn.` }],
        warnings: []
      };
    }

    // 4. Giới hạn số câu tối đa (100 câu)
    const MAX_QUESTIONS = 100;
    const rowsToProcess = rawData.slice(1);
    if (rowsToProcess.length > MAX_QUESTIONS) {
      warnings.push(`Tệp có ${rowsToProcess.length} dòng, hệ thống chỉ xử lý tối đa ${MAX_QUESTIONS} câu hỏi đầu tiên.`);
    }

    const seenPrompts = new Set();

    // 5. Duyệt từng dòng dữ liệu
    for (let rIdx = 0; rIdx < Math.min(rowsToProcess.length, MAX_QUESTIONS); rIdx++) {
      const rowNumber = rIdx + 2; // Dòng 1 là tiêu đề
      const rowData = rowsToProcess[rIdx];

      // Bỏ qua dòng trống hoàn toàn
      if (!rowData || rowData.every(c => String(c).trim() === '')) {
        continue;
      }

      // Tạo object dữ liệu theo header
      const rowObj = {};
      normalizedHeaders.forEach((key, colIdx) => {
        if (key) {
          rowObj[key] = sanitizeText(rowData[colIdx]);
        }
      });

      const questionText = rowObj.question;
      const typeRaw = rowObj.type;
      const pointsRaw = rowObj.points;

      // Kiểm tra câu hỏi không trống
      if (!questionText) {
        errors.push({ row: rowNumber, message: 'Nội dung câu hỏi không được để trống.' });
        continue;
      }

      // Kiểm tra trùng lặp dòng trong file
      const dedupeKey = `${typeRaw}:::${questionText.toLowerCase()}`;
      if (seenPrompts.has(dedupeKey)) {
        errors.push({ row: rowNumber, message: `Câu hỏi bị trùng lặp: "${questionText.substring(0, 40)}..."` });
        continue;
      }
      seenPrompts.add(dedupeKey);

      // Kiểm tra loại câu hợp lệ
      const normalizedType = normalizeType(typeRaw);
      if (!normalizedType) {
        errors.push({
          row: rowNumber,
          message: `Loại câu "${typeRaw}" không hợp lệ. Chỉ chấp nhận: single_choice (trắc nghiệm), fill_blank (điền từ), essay (tự luận).`
        });
        continue;
      }

      // Kiểm tra điểm số
      let points = 1;
      if (pointsRaw !== undefined && pointsRaw !== '') {
        const parsedPoints = parseFloat(pointsRaw);
        if (isNaN(parsedPoints) || parsedPoints <= 0) {
          errors.push({ row: rowNumber, message: `Điểm số "${pointsRaw}" không hợp lệ (phải là số lớn hơn 0).` });
          continue;
        }
        points = Math.round(parsedPoints * 10) / 10;
      }

      // Xử lý theo từng loại câu qua normalizeImportedQuestion
      const rawOptionsList = [rowObj.option_a, rowObj.option_b, rowObj.option_c, rowObj.option_d]
        .map(o => String(o || '').trim())
        .filter(Boolean);

      const rawQ = {
        question_number: parsedQuestions.length + 1,
        question_type: normalizedType,
        prompt: questionText,
        options: rawOptionsList,
        correct_answer: rowObj.correct_answer || rowObj.reference_answer || '',
        reference_answer: rowObj.reference_answer || '',
        points: points,
        source_row: rowNumber
      };

      const normQ = normalizeImportedQuestion(rawQ, parsedQuestions.length);

      if (normQ.mapping_error) {
        errors.push({ row: rowNumber, message: normQ.mapping_error });
        continue;
      }

      if (normalizedType === 'single_choice') {
        if (normQ.options_json.length < 2) {
          errors.push({ row: rowNumber, message: `Câu ${normQ.question_number} (dòng Excel ${rowNumber}): câu trắc nghiệm chỉ có ${normQ.options_json.length} lựa chọn; cần ít nhất 2 lựa chọn.` });
          continue;
        }
        if (!normQ.correct_answer_key?.correct_answer) {
          errors.push({ row: rowNumber, message: `Câu ${normQ.question_number} (dòng Excel ${rowNumber}): chưa nhập hoặc không ánh xạ được đáp án đúng.` });
          continue;
        }
        const match = normQ.options_json.some(o => o.toLowerCase() === String(normQ.correct_answer_key.correct_answer).toLowerCase());
        if (!match) {
          errors.push({ row: rowNumber, message: `Câu ${normQ.question_number} (dòng Excel ${rowNumber}): đáp án đúng "${normQ.correct_answer_key.correct_answer}" không khớp với bất kỳ lựa chọn nào trong [${normQ.options_json.join(', ')}].` });
          continue;
        }
      } else if (normalizedType === 'fill_blank') {
        if (!normQ.correct_answer_key?.correct_answer) {
          errors.push({ row: rowNumber, message: `Câu ${normQ.question_number} (dòng Excel ${rowNumber}): câu điền khuyết bắt buộc phải có đáp án đúng.` });
          continue;
        }
      }

      // STAGE A LOG (Safe metadata without answer keys)
      console.log('[EXERCISE_FLOW_METADATA]', {
        stage: 'PARSER_EXCEL',
        question_index: normQ.question_number,
        source_row: rowNumber,
        question_type: normalizedType,
        is_options_array: Array.isArray(normQ.options_json),
        options_count: normQ.options_json.length,
        has_correct_answer_key: !!normQ.correct_answer_key,
        has_correct_answer: !!normQ.correct_answer_key?.correct_answer
      });

      parsedQuestions.push(normQ);
    }

    if (parsedQuestions.length === 0 && errors.length === 0) {
      errors.push({ row: 0, message: 'Không tìm thấy câu hỏi hợp lệ nào trong tệp.' });
    }

    return {
      success: errors.length === 0,
      questions: parsedQuestions,
      errors: errors,
      warnings: warnings
    };

  } catch (err) {
    console.error('parseExcelQuestions error:', err);
    return {
      success: false,
      questions: [],
      errors: [{ row: 0, message: `Lỗi đọc tệp Excel: ${err.message}` }],
      warnings: []
    };
  }
};

/**
 * PARSER WORD (.DOCX) THEO CẤU TRÚC CHUẨN
 */
export const parseWordQuestions = async (arrayBuffer, fileName = '') => {
  const errors = [];
  const warnings = [];
  const parsedQuestions = [];

  try {
    const lowerName = fileName.toLowerCase();
    if (lowerName.endsWith('.doc')) {
      return {
        success: false,
        questions: [],
        errors: [{ row: 0, message: 'Định dạng .doc cũ không được hỗ trợ. Vui lòng lưu file sang định dạng .docx mới.' }],
        warnings: []
      };
    }

    // 1. Trích xuất text thuần từ .docx bằng mammoth
    const result = await mammoth.extractRawText({ arrayBuffer });
    const rawText = result.value || '';

    if (!rawText.trim()) {
      return {
        success: false,
        questions: [],
        errors: [{ row: 0, message: 'Tệp Word rỗng hoặc không chứa nội dung văn bản.' }],
        warnings: []
      };
    }

    // 2. Tách thành từng khối câu hỏi theo thẻ [TRẮC NGHIỆM], [ĐIỀN KHUYẾT], [TỰ LUẬN]
    const lines = rawText.split(/\r?\n/).map(l => sanitizeText(l)).filter(l => l.length > 0);

    const blocks = [];
    let currentBlock = null;

    lines.forEach((line, lineIdx) => {
      const upperLine = line.toUpperCase();
      if (upperLine.includes('[TRẮC NGHIỆM]') || upperLine.includes('[TRAC NGHIEM]')) {
        if (currentBlock) blocks.push(currentBlock);
        currentBlock = { type: 'single_choice', lines: [], startLine: lineIdx + 1 };
      } else if (upperLine.includes('[ĐIỀN KHUYẾT]') || upperLine.includes('[DIEN KHUYES]') || upperLine.includes('[ĐIỀN TỪ]')) {
        if (currentBlock) blocks.push(currentBlock);
        currentBlock = { type: 'fill_blank', lines: [], startLine: lineIdx + 1 };
      } else if (upperLine.includes('[TỰ LUẬN]') || upperLine.includes('[TU LUAN]')) {
        if (currentBlock) blocks.push(currentBlock);
        currentBlock = { type: 'essay', lines: [], startLine: lineIdx + 1 };
      } else if (currentBlock) {
        currentBlock.lines.push(line);
      }
    });

    if (currentBlock) {
      blocks.push(currentBlock);
    }

    if (blocks.length === 0) {
      return {
        success: false,
        questions: [],
        errors: [{
          row: 1,
          message: 'Không tìm thấy cấu trúc câu hỏi chuẩn nào. Mỗi câu hỏi trong file Word phải bắt đầu bằng thẻ [TRẮC NGHIỆM], [ĐIỀN KHUYẾT], hoặc [TỰ LUẬN]. Vui lòng tải file mẫu Word.'
        }],
        warnings: []
      };
    }

    const seenPrompts = new Set();

    // 3. Phân tích từng khối câu hỏi
    blocks.forEach((block, bIdx) => {
      const blockNum = bIdx + 1;
      let questionPrompt = '';
      const rawOptions = [];
      let correctAnswer = '';
      let referenceAnswer = '';
      let points = 1;

      block.lines.forEach(line => {
        const clean = line.trim();
        const lower = clean.toLowerCase();

        if (lower.startsWith('câu hỏi:') || lower.startsWith('cau hoi:') || lower.startsWith('đề bài:')) {
          questionPrompt = clean.replace(/^(câu hỏi|cau hoi|đề bài):\s*/i, '').trim();
        } else if (/^[A-D]\.\s*/i.test(clean)) {
          const optText = clean.replace(/^[A-D]\.\s*/i, '').trim();
          if (optText) {
            rawOptions.push(optText);
          }
        } else if (lower.startsWith('đáp án:') || lower.startsWith('dap an:')) {
          correctAnswer = clean.replace(/^(đáp án|dap an):\s*/i, '').trim();
        } else if (lower.startsWith('đáp án tham khảo:') || lower.startsWith('dap an tham khao:') || lower.startsWith('gợi ý:')) {
          referenceAnswer = clean.replace(/^(đáp án tham khảo|dap an tham khao|gợi ý):\s*/i, '').trim();
        } else if (lower.startsWith('điểm:') || lower.startsWith('diem:')) {
          const pStr = clean.replace(/^(điểm|diem):\s*/i, '').trim();
          const pVal = parseFloat(pStr);
          if (!isNaN(pVal) && pVal > 0) {
            points = Math.round(pVal * 10) / 10;
          }
        } else if (!questionPrompt && clean.length > 0) {
          questionPrompt = clean;
        }
      });

      if (!questionPrompt) {
        errors.push({ row: blockNum, message: `Khối câu hỏi số ${blockNum} thiếu nội dung "Câu hỏi: ..."` });
        return;
      }

      const dedupeKey = `${block.type}:::${questionPrompt.toLowerCase()}`;
      if (seenPrompts.has(dedupeKey)) {
        errors.push({ row: blockNum, message: `Khối câu hỏi số ${blockNum} bị trùng lặp nội dung.` });
        return;
      }
      seenPrompts.add(dedupeKey);

      const normQ = normalizeImportedQuestion({
        question_number: blockNum,
        question_type: block.type,
        prompt: questionPrompt,
        options: rawOptions,
        correct_answer: correctAnswer || referenceAnswer,
        reference_answer: referenceAnswer,
        points: points,
        source_row: null
      }, bIdx);

      if (normQ.mapping_error) {
        errors.push({ row: blockNum, message: normQ.mapping_error });
        return;
      }

      if (block.type === 'single_choice') {
        if (normQ.options_json.length < 2) {
          errors.push({ row: blockNum, message: `Khối câu ${blockNum} (Trắc nghiệm) phải có ít nhất 2 lựa chọn (A. ... và B. ...).` });
          return;
        }
        if (!normQ.correct_answer_key?.correct_answer) {
          errors.push({ row: blockNum, message: `Khối câu ${blockNum} (Trắc nghiệm) thiếu "Đáp án: ..."` });
          return;
        }
      }

      parsedQuestions.push(normQ);
    });

    return {
      success: errors.length === 0,
      questions: parsedQuestions,
      errors: errors,
      warnings: warnings
    };

  } catch (err) {
    console.error('parseWordQuestions error:', err);
    return {
      success: false,
      questions: [],
      errors: [{ row: 0, message: `Lỗi khi xử lý file Word: ${err.message}` }],
      warnings: []
    };
  }
};

/**
 * VALIDATE DANH SÁCH CÂU HỎI TRÊN GIAO DIỆN
 * Trả về danh sách đầy đủ các lỗi chi tiết (bao gồm vị trí Dòng Excel & Câu số X)
 */
export const getQuestionValidationErrors = (questionsList, hasSubmissions = false) => {
  if (!questionsList || !Array.isArray(questionsList) || hasSubmissions) return [];
  const errors = [];

  questionsList.forEach((rawQ, idx) => {
    const q = normalizeImportedQuestion(rawQ, idx);
    const qNum = q.question_number;
    const rowInfo = q.source_row ? ` (dòng Excel ${q.source_row})` : '';
    const qPrefix = `Câu ${qNum}${rowInfo}`;

    if (q.mapping_error) {
      errors.push({
        index: idx,
        question_number: qNum,
        source_row: q.source_row || null,
        question_type: q.question_type,
        field: 'correct_answer',
        message: q.mapping_error
      });
      return;
    }

    // 1. Đề bài không được rỗng
    if (!q.prompt) {
      errors.push({
        index: idx,
        question_number: qNum,
        source_row: q.source_row || null,
        question_type: q.question_type,
        field: 'prompt',
        message: `${qPrefix}: Nội dung đề bài không được để trống.`
      });
      return;
    }

    // 2. Kiểm tra câu trắc nghiệm (single_choice / multiple_choice)
    if (['single_choice', 'multiple_choice'].includes(q.question_type)) {
      if (q.options_json.length < 2) {
        errors.push({
          index: idx,
          question_number: qNum,
          source_row: q.source_row || null,
          question_type: q.question_type,
          field: 'options',
          message: `${qPrefix}: options_json chỉ có ${q.options_json.length} lựa chọn; cần ít nhất 2 lựa chọn.`
        });
      }

      if (q.question_type === 'single_choice') {
        const correctVal = q.correct_answer_key?.correct_answer;
        if (!correctVal) {
          errors.push({
            index: idx,
            question_number: qNum,
            source_row: q.source_row || null,
            question_type: q.question_type,
            field: 'correct_answer',
            message: `${qPrefix}: Thiếu đáp án đúng correct_answer_key cho câu hỏi trắc nghiệm.`
          });
        } else if (q.options_json.length >= 2) {
          const match = q.options_json.some(opt => opt.toLowerCase() === String(correctVal).toLowerCase());
          if (!match) {
            errors.push({
              index: idx,
              question_number: qNum,
              source_row: q.source_row || null,
              question_type: q.question_type,
              field: 'correct_answer',
              message: `${qPrefix}: Đáp án đúng '${correctVal}' không thuộc danh sách lựa chọn [${q.options_json.join(', ')}].`
            });
          }
        }
      }
    } else if (['fill_blank', 'short_answer'].includes(q.question_type)) {
      // 3. Câu điền khuyết / trả lời ngắn
      const correctVal = q.correct_answer_key?.correct_answer;
      if (!correctVal) {
        errors.push({
          index: idx,
          question_number: qNum,
          source_row: q.source_row || null,
          question_type: q.question_type,
          field: 'correct_answer',
          message: `${qPrefix}: Thiếu đáp án đúng hợp lệ cho câu hỏi điền đáp án / trả lời ngắn.`
        });
      }
    }

    // 4. Kiểm tra điểm số
    const pts = parseFloat(q.points);
    if (isNaN(pts) || pts <= 0) {
      errors.push({
        index: idx,
        question_number: qNum,
        source_row: q.source_row || null,
        question_type: q.question_type,
        field: 'points',
        message: `${qPrefix}: Điểm số phải lớn hơn 0.`
      });
    }
  });

  return errors;
};

/**
 * TẢI FILE MẪU EXCEL BẰNG FILE SPREADSHEET CHUẨN
 */
export const downloadExcelTemplate = () => {
  const sampleData = [
    ['type', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer', 'reference_answer', 'points'],
    ['single_choice', 'Phép cộng 3 + 4 có kết quả bằng bao nhiêu?', '6', '7', '8', '9', 'B', '', 1],
    ['single_choice', 'Số nào liền sau số 19?', '18', '20', '21', '22', '20', '', 1],
    ['fill_blank', 'Điền số thích hợp vào chỗ trống: 10 - 4 = ...', '', '', '', '', '6', '', 1],
    ['essay', 'Bé hãy viết 2 phép tính cộng có kết quả bằng 10.', '', '', '', '', '', '5 + 5 = 10, 6 + 4 = 10', 2]
  ];

  const ws = XLSX.utils.aoa_to_sheet(sampleData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Mau_Cau_Hoi');

  XLSX.writeFile(wb, 'Mau_Nhap_Cau_Hoi_Bai_Tap.xlsx');
};

/**
 * TẢI FILE MẪU WORD BẰNG VĂN BẢN ĐỊNH DẠNG CHUẨN
 */
export const downloadWordTemplate = () => {
  const sampleDocText = `[TRẮC NGHIỆM]
Câu hỏi: 3 + 4 = ?
A. 6
B. 7
C. 8
D. 9
Đáp án: B
Điểm: 1

[TRẮC NGHIỆM]
Câu hỏi: Số nào liền sau số 19?
A. 18
B. 20
C. 21
D. 22
Đáp án: 20
Điểm: 1

[ĐIỀN KHUYẾT]
Câu hỏi: Điền số thích hợp vào chỗ trống: 10 - 4 = ...
Đáp án: 6
Điểm: 1

[TỰ LUẬN]
Câu hỏi: Bé hãy viết 2 phép tính cộng có kết quả bằng 10.
Đáp án tham khảo: 5 + 5 = 10, 6 + 4 = 10
Điểm: 2
`;

  const blob = new Blob([sampleDocText], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Mau_Nhap_Cau_Hoi_Word.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
