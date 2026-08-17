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
 * HÀM CHUẨN HÓA NGUYÊN MẪU LỰA CHỌN (OPTIONS) DUY NHẤT DÙNG CHUNG
 * - Ưu tiên q.options nếu là Array
 * - Nếu không có thì lấy q.options_json nếu là Array
 * - Trim từng lựa chọn
 * - Loại bỏ null, undefined và chuỗi rỗng
 * - Với single_choice/multiple_choice trả về mảng chuỗi đã làm sạch
 * - Với fill_blank và essay trả về mảng rỗng []
 */
export const normalizeQuestionOptions = (q) => {
  if (!q) return [];
  const qType = q.question_type || q.type;

  // Với fill_blank và essay trả về mảng rỗng []
  if (!['single_choice', 'multiple_choice'].includes(qType)) {
    return [];
  }

  const rawOpts = Array.isArray(q.options)
    ? q.options
    : (Array.isArray(q.options_json) ? q.options_json : []);

  return rawOpts
    .map(o => String(o === null || o === undefined ? '' : o).trim())
    .filter(o => o.length > 0);
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

      // Xử lý theo từng loại câu
      if (normalizedType === 'single_choice') {
        const optA = (rowObj.option_a || '').trim();
        const optB = (rowObj.option_b || '').trim();
        const optC = (rowObj.option_c || '').trim();
        const optD = (rowObj.option_d || '').trim();

        const rawOptions = [optA, optB, optC, optD].map(o => String(o || '').trim()).filter(o => o.length > 0);
        if (rawOptions.length < 2) {
          errors.push({ row: rowNumber, message: `Câu ${parsedQuestions.length + 1} – dòng Excel ${rowNumber}: câu trắc nghiệm chỉ có ${rawOptions.length} lựa chọn; cần ít nhất 2 lựa chọn.` });
          continue;
        }

        const optionsMap = {
          'A': optA,
          'B': optB,
          'C': optC,
          'D': optD
        };

        const rawCorrect = (rowObj.correct_answer || '').trim();
        if (!rawCorrect) {
          errors.push({ row: rowNumber, message: 'Câu trắc nghiệm bắt buộc phải có đáp án đúng (correct_answer).' });
          continue;
        }

        let resolvedCorrectAnswer = '';
        const upperCorrect = rawCorrect.toUpperCase();

        // TH1: Người dùng nhập dạng chữ cái 'A', 'B', 'C', 'D'
        if (['A', 'B', 'C', 'D'].includes(upperCorrect)) {
          resolvedCorrectAnswer = optionsMap[upperCorrect];
          if (!resolvedCorrectAnswer) {
            errors.push({ row: rowNumber, message: `Đáp án đúng là "${upperCorrect}" nhưng Lựa chọn ${upperCorrect} lại bị để trống.` });
            continue;
          }
        } else {
          // TH2: Người dùng nhập nguyên văn nội dung đáp án
          const matchOpt = rawOptions.find(o => o.toLowerCase() === rawCorrect.toLowerCase());
          if (matchOpt) {
            resolvedCorrectAnswer = matchOpt;
          } else {
            errors.push({
              row: rowNumber,
              message: `Đáp án đúng "${rawCorrect}" không khớp với bất kỳ lựa chọn nào trong [${rawOptions.join(', ')}].`
            });
            continue;
          }
        }

        const qObj = {
          question_type: 'single_choice',
          prompt: questionText,
          options: rawOptions,
          options_json: rawOptions,
          correct_answer: resolvedCorrectAnswer,
          points: points,
          source_row: rowNumber
        };

        // STAGE A LOG (Safe metadata without answer keys)
        console.log('[EXERCISE_FLOW_METADATA]', {
          stage: 'PARSER_EXCEL',
          question_index: parsedQuestions.length + 1,
          source_row: rowNumber,
          question_type: 'single_choice',
          is_options_array: Array.isArray(rawOptions),
          options_count: rawOptions.length,
          is_options_json_array: Array.isArray(rawOptions),
          options_json_count: rawOptions.length
        });

        parsedQuestions.push(qObj);

      } else if (normalizedType === 'fill_blank') {
        const rawCorrect = (rowObj.correct_answer || rowObj.reference_answer || '').trim();
        if (!rawCorrect) {
          errors.push({ row: rowNumber, message: 'Câu điền khuyết bắt buộc phải có đáp án đúng (correct_answer).' });
          continue;
        }

        const qObj = {
          question_type: 'fill_blank',
          prompt: questionText,
          options: [],
          options_json: [],
          correct_answer: rawCorrect,
          points: points,
          source_row: rowNumber
        };

        console.log('[EXERCISE_FLOW_METADATA]', {
          stage: 'PARSER_EXCEL',
          question_index: parsedQuestions.length + 1,
          source_row: rowNumber,
          question_type: 'fill_blank',
          is_options_array: true,
          options_count: 0,
          is_options_json_array: true,
          options_json_count: 0
        });

        parsedQuestions.push(qObj);

      } else if (normalizedType === 'essay') {
        const refAnswer = (rowObj.reference_answer || rowObj.correct_answer || '').trim();

        const qObj = {
          question_type: 'essay',
          prompt: questionText,
          options: [],
          options_json: [],
          correct_answer: refAnswer || 'Xem hướng dẫn chấm của giáo viên',
          points: points,
          source_row: rowNumber
        };

        console.log('[EXERCISE_FLOW_METADATA]', {
          stage: 'PARSER_EXCEL',
          question_index: parsedQuestions.length + 1,
          source_row: rowNumber,
          question_type: 'essay',
          is_options_array: true,
          options_count: 0,
          is_options_json_array: true,
          options_json_count: 0
        });

        parsedQuestions.push(qObj);
      }
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

      const optionsMap = {};

      block.lines.forEach(line => {
        const clean = line.trim();
        const lower = clean.toLowerCase();

        if (lower.startsWith('câu hỏi:') || lower.startsWith('cau hoi:') || lower.startsWith('đề bài:')) {
          questionPrompt = clean.replace(/^(câu hỏi|cau hoi|đề bài):\s*/i, '').trim();
        } else if (/^[A-D]\.\s*/i.test(clean)) {
          const letter = clean.charAt(0).toUpperCase();
          const optText = clean.replace(/^[A-D]\.\s*/i, '').trim();
          if (optText) {
            optionsMap[letter] = optText;
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

      if (block.type === 'single_choice') {
        const validOptions = rawOptions.map(o => String(o || '').trim()).filter(Boolean);
        if (validOptions.length < 2) {
          errors.push({ row: blockNum, message: `Khối câu ${blockNum} (Trắc nghiệm) phải có ít nhất 2 lựa chọn (A. ... và B. ...).` });
          return;
        }
        if (!correctAnswer) {
          errors.push({ row: blockNum, message: `Khối câu ${blockNum} (Trắc nghiệm) thiếu "Đáp án: ..."` });
          return;
        }

        let resolvedCorrect = '';
        const upperAns = correctAnswer.toUpperCase();
        if (['A', 'B', 'C', 'D'].includes(upperAns) && optionsMap[upperAns]) {
          resolvedCorrect = optionsMap[upperAns];
        } else {
          const matched = validOptions.find(o => o.toLowerCase() === correctAnswer.toLowerCase());
          if (matched) {
            resolvedCorrect = matched;
          } else {
            errors.push({ row: blockNum, message: `Đáp án "${correctAnswer}" không khớp với các lựa chọn A, B, C, D trong câu ${blockNum}.` });
            return;
          }
        }

        parsedQuestions.push({
          question_type: 'single_choice',
          prompt: questionPrompt,
          options: validOptions,
          options_json: validOptions,
          correct_answer: resolvedCorrect,
          points: points,
          source_row: null
        });

      } else if (block.type === 'fill_blank') {
        if (!correctAnswer) {
          errors.push({ row: blockNum, message: `Khối câu ${blockNum} (Điền khuyết) thiếu "Đáp án: ..."` });
          return;
        }

        parsedQuestions.push({
          question_type: 'fill_blank',
          prompt: questionPrompt,
          options: [],
          options_json: [],
          correct_answer: correctAnswer,
          points: points,
          source_row: null
        });

      } else if (block.type === 'essay') {
        parsedQuestions.push({
          question_type: 'essay',
          prompt: questionPrompt,
          options: [],
          options_json: [],
          correct_answer: referenceAnswer || 'Xem hướng dẫn chấm của giáo viên',
          points: points,
          source_row: null
        });
      }
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

  questionsList.forEach((q, idx) => {
    const qNum = idx + 1;
    const rowInfo = q.source_row ? ` – dòng Excel ${q.source_row}` : '';
    const qPrefix = `Câu ${qNum}${rowInfo}`;

    const validOptions = normalizeQuestionOptions(q);

    console.log('[EXERCISE_FLOW_METADATA]', {
      stage: 'VALIDATION_CHECK',
      question_index: qNum,
      source_row: q.source_row || null,
      question_type: q.question_type,
      is_options_array: Array.isArray(validOptions),
      options_count: validOptions.length,
      is_options_json_array: Array.isArray(validOptions),
      options_json_count: validOptions.length
    });

    // 1. Đề bài không được rỗng
    if (!q.prompt || !String(q.prompt).trim()) {
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
      if (validOptions.length < 2) {
        errors.push({
          index: idx,
          question_number: qNum,
          source_row: q.source_row || null,
          question_type: q.question_type,
          field: 'options',
          message: `${qPrefix}: options_json chỉ có ${validOptions.length} lựa chọn; cần ít nhất 2 lựa chọn.`
        });
      }

      if (q.question_type === 'single_choice') {
        const trimmedCorrect = String(q.correct_answer || '').trim();
        if (!trimmedCorrect) {
          errors.push({
            index: idx,
            question_number: qNum,
            source_row: q.source_row || null,
            question_type: q.question_type,
            field: 'correct_answer',
            message: `${qPrefix}: Chưa chọn hoặc thiếu đáp án đúng cho câu trắc nghiệm.`
          });
        } else if (validOptions.length >= 2) {
          const match = validOptions.some(opt => opt.toLowerCase() === trimmedCorrect.toLowerCase());
          if (!match) {
            errors.push({
              index: idx,
              question_number: qNum,
              source_row: q.source_row || null,
              question_type: q.question_type,
              field: 'correct_answer',
              message: `${qPrefix}: Đáp án đúng '${trimmedCorrect}' không thuộc danh sách lựa chọn [${validOptions.join(', ')}].`
            });
          }
        }
      }
    } else if (['fill_blank', 'short_answer'].includes(q.question_type)) {
      // 3. Câu điền khuyết / trả lời ngắn: KHÔNG áp dụng điều kiện ít nhất 2 lựa chọn
      const trimmedCorrect = String(q.correct_answer || '').trim();
      if (!trimmedCorrect) {
        errors.push({
          index: idx,
          question_number: qNum,
          source_row: q.source_row || null,
          question_type: q.question_type,
          field: 'correct_answer',
          message: `${qPrefix}: Chưa nhập đáp án đúng.`
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
