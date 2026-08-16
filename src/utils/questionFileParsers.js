import * as XLSX from 'xlsx';
import mammoth from 'mammoth';

/**
 * An toàn dữ liệu: Loại bỏ ký tự điều khiển, cắt khoảng trắng và ngăn ngừa CSV/Formula Injection
 */
export const sanitizeText = (val) => {
  if (val === null || val === undefined) return '';
  let str = String(val).trim();
  // Ngăn chặn Formula Injection nếu ô bắt đầu bằng dấu nguy hiểm (=, +, -, @)
  if (/^[=+\-@]/.test(str)) {
    // Nếu chỉ là số âm bình thường (ví dụ: -5) thì giữ nguyên, nếu là công thức hàm thì loại bỏ dấu mở đầu
    if (!/^-?\d+(\.\d+)?$/.test(str)) {
      str = str.replace(/^[=+\-@]+/, '').trim();
    }
  }
  // Loại bỏ tag HTML
  str = str.replace(/<[^>]*>?/gm, '');
  return str;
};

/**
 * Chuẩn hóa tên cột (Header mapping) không phân biệt hoa thường và dấu tiếng Việt
 */
const normalizeHeader = (header) => {
  if (!header) return '';
  const clean = String(header).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Bỏ dấu tiếng Việt
    .replace(/[^a-z0-9]/g, '_');
  
  if (['type', 'loai_cau', 'loai_cau_hoi', 'dang_cau'].includes(clean)) return 'type';
  if (['question', 'cau_hoi', 'noi_dung', 'noi_dung_cau_hoi', 'de_bai'].includes(clean)) return 'question';
  if (['option_a', 'lua_chon_a', 'dap_an_a', 'a'].includes(clean)) return 'option_a';
  if (['option_b', 'lua_chon_b', 'dap_an_b', 'b'].includes(clean)) return 'option_b';
  if (['option_c', 'lua_chon_c', 'dap_an_c', 'c'].includes(clean)) return 'option_c';
  if (['option_d', 'lua_chon_d', 'dap_an_d', 'd'].includes(clean)) return 'option_d';
  if (['correct_answer', 'dap_an_dung', 'dap_an', 'key'].includes(clean)) return 'correct_answer';
  if (['reference_answer', 'dap_an_tham_khao', 'huong_dan_giai', 'goi_y'].includes(clean)) return 'reference_answer';
  if (['points', 'diem', 'diem_so', 'thang_diem'].includes(clean)) return 'points';

  return clean;
};

/**
 * Chuẩn hóa loại câu hỏi
 */
const normalizeType = (typeStr) => {
  const clean = String(typeStr || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_]/g, '_');

  if (['single_choice', 'trac_nghiem', 'trac_nghiem_1_dap_an', 'mcq', 'tn'].includes(clean)) {
    return 'single_choice';
  }
  if (['fill_blank', 'dien_khuyet', 'dien_tu', 'dien_so', 'dien_vao_cho_trong'].includes(clean)) {
    return 'fill_blank';
  }
  if (['essay', 'tu_luan', 'tra_loi_ngan', 'short_answer'].includes(clean)) {
    return 'essay';
  }
  return null;
};

/**
 * PARSER EXCEL (.XLSX / .CSV)
 * Đọc trực tiếp ArrayBuffer từ trình duyệt mà không tải lên server
 */
export const parseExcelQuestions = async (arrayBuffer, fileName = '') => {
  const errors = [];
  const warnings = [];
  const parsedQuestions = [];

  try {
    // 1. Kiểm tra định dạng đuôi file
    const lowerName = fileName.toLowerCase();
    if (lowerName.endsWith('.xlsm')) {
      return {
        success: false,
        questions: [],
        errors: [{ row: 0, message: 'Định dạng .xlsm (có macro) không được hỗ trợ vì lý do an toàn. Vui lòng dùng .xlsx hoặc .csv.' }],
        warnings: []
      };
    }

    // 2. Đọc workbook
    const workbook = XLSX.read(arrayBuffer, { type: 'array', cellFormula: false, cellHTML: false });
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      return {
        success: false,
        questions: [],
        errors: [{ row: 0, message: 'Tệp Excel không chứa trang tính (sheet) nào.' }],
        warnings: []
      };
    }

    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

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
        const optA = rowObj.option_a || '';
        const optB = rowObj.option_b || '';
        const optC = rowObj.option_c || '';
        const optD = rowObj.option_d || '';

        const rawOptions = [optA, optB, optC, optD].filter(Boolean);
        if (rawOptions.length < 2) {
          errors.push({ row: rowNumber, message: 'Câu trắc nghiệm phải có ít nhất 2 lựa chọn (Ví dụ: Lựa chọn A và B).' });
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

        parsedQuestions.push({
          question_type: 'single_choice',
          prompt: questionText,
          options: rawOptions,
          correct_answer: resolvedCorrectAnswer,
          points: points,
          source_row: rowNumber
        });

      } else if (normalizedType === 'fill_blank') {
        const rawCorrect = (rowObj.correct_answer || rowObj.reference_answer || '').trim();
        if (!rawCorrect) {
          errors.push({ row: rowNumber, message: 'Câu điền khuyết bắt buộc phải có đáp án đúng (correct_answer).' });
          continue;
        }

        parsedQuestions.push({
          question_type: 'fill_blank',
          prompt: questionText,
          options: [],
          correct_answer: rawCorrect,
          points: points,
          source_row: rowNumber
        });

      } else if (normalizedType === 'essay') {
        const refAnswer = (rowObj.reference_answer || rowObj.correct_answer || '').trim();

        parsedQuestions.push({
          question_type: 'essay',
          prompt: questionText,
          options: [],
          correct_answer: refAnswer || 'Xem hướng dẫn chấm của giáo viên',
          points: points,
          source_row: rowNumber
        });
      }
    }

    if (parsedQuestions.length === 0 && errors.length === 0) {
      errors.push({ row: 0, message: 'Không tìm thấy câu hỏi hợp lệ nào trong tệp.' });
    }

    return {
      success: errors.length === 0 && parsedQuestions.length > 0,
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
      const options = [];
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
          optionsMap[letter] = optText;
          options.push(optText);
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
          // Nếu dòng đầu tiên không có tiền tố "Câu hỏi:" thì lấy nguyên dòng làm prompt
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
        if (options.length < 2) {
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
          const matched = options.find(o => o.toLowerCase() === correctAnswer.toLowerCase());
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
          options: options,
          correct_answer: resolvedCorrect,
          points: points,
          source_row: blockNum
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
          correct_answer: correctAnswer,
          points: points,
          source_row: blockNum
        });

      } else if (block.type === 'essay') {
        parsedQuestions.push({
          question_type: 'essay',
          prompt: questionPrompt,
          options: [],
          correct_answer: referenceAnswer || correctAnswer || 'Xem hướng dẫn chấm của giáo viên',
          points: points,
          source_row: blockNum
        });
      }
    });

    return {
      success: errors.length === 0 && parsedQuestions.length > 0,
      questions: parsedQuestions,
      errors: errors,
      warnings: warnings
    };

  } catch (err) {
    console.error('parseWordQuestions error:', err);
    return {
      success: false,
      questions: [],
      errors: [{ row: 0, message: `Lỗi đọc tệp Word (.docx): ${err.message}` }],
      warnings: []
    };
  }
};

/**
 * TẠO VÀ TẢI TỆP EXCEL MẪU CHUẨN (.XLSX)
 */
export const downloadExcelTemplate = () => {
  const headers = [
    'type',
    'question',
    'option_a',
    'option_b',
    'option_c',
    'option_d',
    'correct_answer',
    'reference_answer',
    'points'
  ];

  const sampleRows = [
    [
      'single_choice',
      '3 + 4 = ?',
      '6',
      '7',
      '8',
      '9',
      'B',
      '',
      1
    ],
    [
      'single_choice',
      'Số nào liền sau số 19?',
      '18',
      '20',
      '21',
      '22',
      '20',
      '',
      1
    ],
    [
      'fill_blank',
      'Điền số thích hợp vào chỗ trống: 10 - 4 = ...',
      '',
      '',
      '',
      '',
      '6',
      '',
      1
    ],
    [
      'essay',
      'Bé hãy viết 2 phép tính cộng có kết quả bằng 10.',
      '',
      '',
      '',
      '',
      '',
      '5 + 5 = 10, 6 + 4 = 10',
      2
    ]
  ];

  const data = [headers, ...sampleRows];
  const ws = XLSX.utils.aoa_to_sheet(data);

  // Thiết lập độ rộng cột cho đẹp
  ws['!cols'] = [
    { wch: 16 }, // type
    { wch: 45 }, // question
    { wch: 15 }, // option_a
    { wch: 15 }, // option_b
    { wch: 15 }, // option_c
    { wch: 15 }, // option_d
    { wch: 18 }, // correct_answer
    { wch: 30 }, // reference_answer
    { wch: 10 }  // points
  ];

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
