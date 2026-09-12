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
 * Chuẩn hóa danh sách câu hỏi sang Canonical Payload phục vụ lưu bản nháp đề thi
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
      answerKey = {
        correct_answer: String(q.answer_key?.correct_answer || canonicalOptions[0]?.key || 'A').trim(),
      };
    } else if (q.question_type === 'multiple_choice') {
      const rawAns = q.answer_key?.correct_answer;
      const ansArray = Array.isArray(rawAns) ? rawAns : [String(rawAns || 'A')];
      answerKey = {
        correct_answer: ansArray.map((a) => String(a).trim()),
      };
    } else if (['fill_blank', 'short_answer'].includes(q.question_type)) {
      answerKey = {
        correct_answer: String(q.answer_key?.correct_answer || '').trim(),
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
