// src/components/dashboard/exams/examDraftUtils.js
// Utility helpers for Exam Builder V1 Draft Management, Question Bank Integration & Serialization

function generateUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Kiểm tra xem danh sách câu hỏi hiện tại có phải là câu hỏi demo mặc định ("1 + 1 = ?") chưa qua chỉnh sửa hay không.
 * @param {Array} questions - Danh sách câu hỏi hiện tại trong state
 * @param {boolean} isNewExam - Cờ xác định có đang tạo mới đề thi từ đầu hay không
 * @returns {boolean} true nếu là câu hỏi demo nguyên bản, false nếu đã được chỉnh sửa hoặc có nhiều câu hỏi
 */
export function isUntouchedDemoQuestion(questions, isNewExam = true) {
  if (!isNewExam || !Array.isArray(questions) || questions.length !== 1) {
    return false;
  }
  const q = questions[0];
  if (!q) return false;

  const matchesPrompt = (q.prompt || '').trim() === '1 + 1 = ?';
  const matchesType = q.question_type === 'single_choice';
  const matchesPoints = Number(q.points) === 1;
  const matchesOptions =
    Array.isArray(q.options_json) &&
    q.options_json.length === 4 &&
    q.options_json[0]?.text === '1' &&
    q.options_json[1]?.text === '2' &&
    q.options_json[2]?.text === '3' &&
    q.options_json[3]?.text === '4' &&
    q.options_json[0]?.key === 'A' &&
    q.options_json[1]?.key === 'B' &&
    q.options_json[2]?.key === 'C' &&
    q.options_json[3]?.key === 'D';
  const matchesAnswer = q.answer_key?.correct_answer === 'B';
  const hasNoQbSource = !q.source_question_bank_item_id && !q.source_question_bank_version_id;

  return matchesPrompt && matchesType && matchesPoints && matchesOptions && matchesAnswer && hasNoQbSource;
}

/**
 * Kiểm tra tính hợp lệ của danh sách câu hỏi bản nháp đề thi (Shared Pure Validator)
 * @param {Array} questions - Danh sách câu hỏi cần kiểm tra
 * @returns {{ valid: boolean, message?: string, questionIndex?: number }}
 */
export function validateDraftQuestions(questions = []) {
  if (!Array.isArray(questions)) {
    return { valid: false, message: 'Danh sách câu hỏi không hợp lệ.' };
  }

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const qNum = i + 1;

    if (!q || typeof q !== 'object') {
      return { valid: false, message: `Câu hỏi số ${qNum} không hợp lệ.`, questionIndex: i };
    }

    const prompt = (q.prompt || '').trim();
    if (!prompt) {
      return { valid: false, message: `Vui lòng nhập nội dung câu hỏi số ${qNum}.`, questionIndex: i };
    }

    const qType = q.question_type || 'single_choice';

    if (qType === 'single_choice') {
      const rawOpts = q.options_json;
      if (!Array.isArray(rawOpts) || rawOpts.length < 2) {
        return {
          valid: false,
          message: `Câu hỏi số ${qNum} (Trắc nghiệm 1 đáp án) phải có ít nhất 2 lựa chọn đáp án.`,
          questionIndex: i,
        };
      }

      const optionKeys = [];
      for (let oi = 0; oi < rawOpts.length; oi++) {
        const opt = rawOpts[oi];
        const optText = typeof opt === 'object' && opt !== null ? String(opt.text ?? '') : String(opt ?? '');
        if (!optText.trim()) {
          return {
            valid: false,
            message: `Vui lòng nhập nội dung cho lựa chọn ${oi + 1} của câu hỏi số ${qNum}.`,
            questionIndex: i,
          };
        }
        const optKey = typeof opt === 'object' && opt !== null && opt.key ? String(opt.key).trim() : String.fromCharCode(65 + oi);
        optionKeys.push(optKey);
      }

      const correctAns = q.answer_key?.correct_answer;
      if (correctAns === undefined || correctAns === null || String(correctAns).trim() === '') {
        return {
          valid: false,
          message: `Vui lòng chọn đáp án đúng cho câu hỏi số ${qNum}.`,
          questionIndex: i,
        };
      }

      const strAns = String(correctAns).trim();
      if (!optionKeys.includes(strAns)) {
        return {
          valid: false,
          message: `Vui lòng chọn đáp án đúng cho câu hỏi số ${qNum}.`,
          questionIndex: i,
        };
      }
    } else if (qType === 'multiple_choice') {
      const rawOpts = q.options_json;
      if (!Array.isArray(rawOpts) || rawOpts.length < 2) {
        return {
          valid: false,
          message: `Câu hỏi số ${qNum} (Trắc nghiệm nhiều đáp án) phải có ít nhất 2 lựa chọn đáp án.`,
          questionIndex: i,
        };
      }

      const optionKeys = [];
      for (let oi = 0; oi < rawOpts.length; oi++) {
        const opt = rawOpts[oi];
        const optText = typeof opt === 'object' && opt !== null ? String(opt.text ?? '') : String(opt ?? '');
        if (!optText.trim()) {
          return {
            valid: false,
            message: `Vui lòng nhập nội dung cho lựa chọn ${oi + 1} của câu hỏi số ${qNum}.`,
            questionIndex: i,
          };
        }
        const optKey = typeof opt === 'object' && opt !== null && opt.key ? String(opt.key).trim() : String.fromCharCode(65 + oi);
        optionKeys.push(optKey);
      }

      const correctAns = q.answer_key?.correct_answer;
      const ansList = Array.isArray(correctAns)
        ? correctAns.map((a) => String(a).trim()).filter(Boolean)
        : (correctAns !== undefined && correctAns !== null && String(correctAns).trim() !== '' ? [String(correctAns).trim()] : []);

      if (ansList.length === 0) {
        return {
          valid: false,
          message: `Vui lòng chọn ít nhất một đáp án đúng cho câu hỏi số ${qNum}.`,
          questionIndex: i,
        };
      }

      for (const ans of ansList) {
        if (!optionKeys.includes(ans)) {
          return {
            valid: false,
            message: `Vui lòng chọn ít nhất một đáp án đúng cho câu hỏi số ${qNum}.`,
            questionIndex: i,
          };
        }
      }
    } else if (['fill_blank', 'short_answer'].includes(qType)) {
      const correctAns = q.answer_key?.correct_answer;
      if (correctAns === undefined || correctAns === null || String(correctAns).trim() === '') {
        return {
          valid: false,
          message: `Vui lòng cấu hình đáp án đúng cho câu hỏi số ${qNum}.`,
          questionIndex: i,
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Chuẩn hóa danh sách câu hỏi sang Canonical Payload phục vụ lưu bản nháp đề thi
 * Tuyệt đối KHÔNG tự động bịa đáp án A hay fallback khi chưa chọn đáp án
 * Bảo tồn nguyên vẹn các trường audit nguồn: source_question_bank_item_id, source_question_bank_version_id
 * @param {Array} questions - Mảng câu hỏi từ state
 * @returns {Array} Mảng câu hỏi chuẩn hóa
 */
export function buildSaveDraftQuestionsPayload(questions = []) {
  if (!Array.isArray(questions)) return [];

  return questions.map((q, idx) => {
    let canonicalOptions = [];
    if (['single_choice', 'multiple_choice'].includes(q.question_type)) {
      canonicalOptions = (Array.isArray(q.options_json) ? q.options_json : []).map((opt, oIdx) => {
        if (typeof opt === 'object' && opt !== null && opt.key) {
          return { key: String(opt.key).trim(), text: String(opt.text ?? '').trim() };
        }
        return { key: String.fromCharCode(65 + oIdx), text: String(opt ?? '').trim() };
      });
    }

    let answerKey = null;
    if (q.question_type === 'single_choice') {
      const rawAns = q.answer_key?.correct_answer;
      const cleanAns = rawAns !== undefined && rawAns !== null ? String(rawAns).trim() : '';
      answerKey = {
        correct_answer: cleanAns || null,
      };
    } else if (q.question_type === 'multiple_choice') {
      const rawAns = q.answer_key?.correct_answer;
      const ansArray = Array.isArray(rawAns)
        ? rawAns.map((a) => String(a).trim()).filter(Boolean)
        : (rawAns !== undefined && rawAns !== null && String(rawAns).trim() !== '' ? [String(rawAns).trim()] : []);
      answerKey = {
        correct_answer: ansArray,
      };
    } else if (['fill_blank', 'short_answer'].includes(q.question_type)) {
      const rawAns = q.answer_key?.correct_answer;
      const cleanAns = rawAns !== undefined && rawAns !== null ? String(rawAns).trim() : '';
      answerKey = {
        correct_answer: cleanAns,
      };
    }

    return {
      id: q.id || generateUuid(),
      question_number: idx + 1,
      question_type: q.question_type,
      prompt: (q.prompt || '').trim(),
      points: Number(q.points) || 1,
      options_json: canonicalOptions,
      answer_key: answerKey,
      source_question_bank_item_id: q.source_question_bank_item_id || null,
      source_question_bank_version_id: q.source_question_bank_version_id || null,
    };
  });
}
