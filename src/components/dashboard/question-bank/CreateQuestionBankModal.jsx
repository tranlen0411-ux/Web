import React, { useState } from 'react';
import {
  X,
  Plus,
  Trash2,
  Save,
  FileText,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  Lock,
  Globe,
  Layers,
  Sparkles
} from 'lucide-react';
import { createQuestion } from '../../../services/questionBankService';
import { toQuestionBankPayload } from '../../../utils/questionBankAdapters';

export const CreateQuestionBankModal = ({ isOpen, onClose, onSuccess, role = 'teacher' }) => {
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('Toán');
  const [gradeLevel, setGradeLevel] = useState('1');
  const [difficulty, setDifficulty] = useState('medium');
  const [visibility, setVisibility] = useState('private');
  const [questionType, setQuestionType] = useState('single_choice');
  const [prompt, setPrompt] = useState('');
  const [explanation, setExplanation] = useState('');
  const [tags, setTags] = useState('');

  // Options for single_choice / multiple_choice
  const [options, setOptions] = useState([
    { id: 'opt_1', text: '' },
    { id: 'opt_2', text: '' },
    { id: 'opt_3', text: '' },
    { id: 'opt_4', text: '' }
  ]);
  const [correctOptionId, setCorrectOptionId] = useState('opt_1');
  const [correctOptionIds, setCorrectOptionIds] = useState(['opt_1']);

  // Answers for fill_blank / short_answer
  const [fillBlankAnswer, setFillBlankAnswer] = useState('');
  const [shortAnswer, setShortAnswer] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleAddOption = () => {
    if (options.length >= 8) return;
    const newId = `opt_${options.length + 1}`;
    setOptions([...options, { id: newId, text: '' }]);
  };

  const handleRemoveOption = (indexToRemove) => {
    if (options.length <= 2) return;
    const updated = options.filter((_, idx) => idx !== indexToRemove).map((opt, idx) => ({
      id: `opt_${idx + 1}`,
      text: opt.text
    }));
    setOptions(updated);
    if (!updated.some(o => o.id === correctOptionId)) {
      setCorrectOptionId(updated[0]?.id || 'opt_1');
    }
    setCorrectOptionIds(prev => prev.filter(id => updated.some(o => o.id === id)));
  };

  const handleOptionTextChange = (index, val) => {
    const updated = [...options];
    updated[index].text = val;
    setOptions(updated);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    setErrorMsg('');

    if (!prompt.trim()) {
      setErrorMsg('Vui lòng nhập nội dung câu hỏi (prompt).');
      return;
    }

    try {
      setIsSubmitting(true);

      let questionInput = {
        title: title.trim() || undefined,
        prompt: prompt.trim(),
        subject,
        grade_level: gradeLevel ? Number(gradeLevel) : null,
        difficulty,
        visibility: role === 'admin' ? visibility : 'private',
        question_type: questionType,
        explanation: explanation.trim() || undefined,
        tags: tags.trim() || undefined
      };

      if (questionType === 'single_choice') {
        const validOptions = options.map(o => o.text.trim());
        if (validOptions.some(t => !t)) {
          throw new Error('Vui lòng nhập đầy đủ nội dung cho các lựa chọn đáp án.');
        }
        questionInput.options = options;
        questionInput.correct_answer = correctOptionId;
      } else if (questionType === 'multiple_choice') {
        const validOptions = options.map(o => o.text.trim());
        if (validOptions.some(t => !t)) {
          throw new Error('Vui lòng nhập đầy đủ nội dung cho các lựa chọn đáp án.');
        }
        if (correctOptionIds.length === 0) {
          throw new Error('Vui lòng chọn ít nhất một đáp án đúng.');
        }
        questionInput.options = options;
        questionInput.correct_answers = correctOptionIds;
      } else if (questionType === 'fill_blank') {
        if (!fillBlankAnswer.trim()) {
          throw new Error('Vui lòng nhập đáp án đúng cho câu điền khuyết.');
        }
        questionInput.correct_answers = fillBlankAnswer.split(';').map(s => s.trim()).filter(Boolean);
      } else if (questionType === 'short_answer') {
        if (!shortAnswer.trim()) {
          throw new Error('Vui lòng nhập đáp án đúng cho câu trả lời ngắn.');
        }
        questionInput.correct_answers = shortAnswer.split(';').map(s => s.trim()).filter(Boolean);
      } else if (questionType === 'essay') {
        // essay plain object
      }

      const payload = toQuestionBankPayload(questionInput, {
        role,
        defaultSubject: subject,
        defaultGrade: gradeLevel,
        defaultDifficulty: difficulty,
        defaultVisibility: role === 'admin' ? visibility : 'private',
        metadata: {
          created_via: 'manual_authoring_modal'
        }
      });

      await createQuestion(payload);

      if (typeof onSuccess === 'function') {
        onSuccess('Tạo câu hỏi mới trong Ngân hàng câu hỏi thành công!');
      }
      onClose();
    } catch (err) {
      console.error('Lỗi khi tạo câu hỏi:', err);
      setErrorMsg(err.message || 'Không thể tạo câu hỏi. Vui lòng thử lại.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-2xl rounded-3xl border-4 border-amber-300 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* HEADER */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-amber-100 bg-amber-50/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-100 text-indigo-700 rounded-2xl border border-indigo-200">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-slate-800">Soạn Câu Hỏi Mới</h2>
              <p className="text-xs text-slate-500 font-bold">Thêm câu hỏi chuẩn hóa vào Ngân hàng câu hỏi V2A</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-2 hover:bg-slate-200 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* BODY */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border-2 border-rose-200 text-rose-800 rounded-2xl text-xs font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* HÀNG 1: DẠNG CÂU HỎI & MÔN HỌC */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-black text-slate-700 mb-1">
                Dạng Câu Hỏi <span className="text-rose-500">*</span>:
              </label>
              <select
                value={questionType}
                onChange={(e) => setQuestionType(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              >
                <option value="single_choice">Trắc nghiệm một đáp án</option>
                <option value="multiple_choice">Trắc nghiệm nhiều đáp án</option>
                <option value="fill_blank">Điền khuyết</option>
                <option value="short_answer">Trả lời ngắn</option>
                <option value="essay">Tự luận</option>
                <option value="image_upload" disabled>Tải ảnh (Sắp hỗ trợ)</option>
                <option value="file_upload" disabled>Tải tệp (Sắp hỗ trợ)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-black text-slate-700 mb-1">
                Môn Học <span className="text-rose-500">*</span>:
              </label>
              <select
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              >
                <option value="Toán">Toán</option>
                <option value="Tiếng Việt">Tiếng Việt</option>
                <option value="Tiếng Anh">Tiếng Anh</option>
                <option value="Khoa học">Khoa học</option>
                <option value="Lịch sử & Địa lý">Lịch sử & Địa lý</option>
                <option value="Tin học">Tin học</option>
                <option value="Đạo đức">Đạo đức</option>
                <option value="Tự nhiên & Xã hội">Tự nhiên & Xã hội</option>
              </select>
            </div>
          </div>

          {/* HÀNG 2: KHỐI LỚP, ĐỘ KHÓ, QUYỀN HIỂN THỊ */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-black text-slate-700 mb-1">Khối Lớp:</label>
              <select
                value={gradeLevel}
                onChange={(e) => setGradeLevel(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              >
                <option value="1">Lớp 1</option>
                <option value="2">Lớp 2</option>
                <option value="3">Lớp 3</option>
                <option value="4">Lớp 4</option>
                <option value="5">Lớp 5</option>
                <option value="6">Lớp 6</option>
                <option value="7">Lớp 7</option>
                <option value="8">Lớp 8</option>
                <option value="9">Lớp 9</option>
                <option value="10">Lớp 10</option>
                <option value="11">Lớp 11</option>
                <option value="12">Lớp 12</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-black text-slate-700 mb-1">Độ Khó:</label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              >
                <option value="easy">Nhận biết (Easy)</option>
                <option value="medium">Thông hiểu (Medium)</option>
                <option value="hard">Vận dụng (Hard)</option>
                <option value="expert">Vận dụng cao (Expert)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-black text-slate-700 mb-1">Phạm Vi:</label>
              {role === 'admin' ? (
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                >
                  <option value="private">🔒 Cá nhân (Private)</option>
                  <option value="public_template">🌐 Mẫu công khai (Public Template)</option>
                </select>
              ) : (
                <div className="p-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-slate-500" />
                  Kho riêng (Private)
                </div>
              )}
            </div>
          </div>

          <div className="p-2.5 bg-amber-50/70 border border-amber-200 rounded-xl text-[11px] font-bold text-amber-800">
            ℹ️ Chia sẻ trong trường (school_shared) sẽ được bổ sung sau khi hoàn thiện xác minh đơn vị/trường.
          </div>

          {/* TIÊU ĐỀ (TÙY CHỌN) */}
          <div>
            <label className="block text-xs font-black text-slate-700 mb-1">
              Tiêu Đề Câu Hỏi (Tùy chọn):
            </label>
            <input
              type="text"
              placeholder="Nhập tiêu đề hoặc tóm tắt ngắn cho câu hỏi..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
          </div>

          {/* NỘI DUNG CÂU HỎI (PROMPT) */}
          <div>
            <label className="block text-xs font-black text-slate-700 mb-1">
              Nội Dung Câu Hỏi (Prompt) <span className="text-rose-500">*</span>:
            </label>
            <textarea
              rows={3}
              placeholder="Nhập nội dung đề bài câu hỏi..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
          </div>

          {/* CHI TIẾT ĐÁP ÁN THEO TỪNG DẠNG CÂU */}
          {questionType === 'single_choice' && (
            <div className="space-y-2 p-4 bg-slate-50 rounded-2xl border border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-black text-slate-700">Các Lựa Chọn (Chọn 1 đáp án đúng):</span>
                {options.length < 8 && (
                  <button
                    type="button"
                    onClick={handleAddOption}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-black flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Thêm lựa chọn
                  </button>
                )}
              </div>

              {options.map((opt, idx) => (
                <div key={opt.id} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="singleChoiceCorrect"
                    checked={correctOptionId === opt.id}
                    onChange={() => setCorrectOptionId(opt.id)}
                    className="w-4 h-4 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                  <span className="text-xs font-black text-slate-500 w-5">{String.fromCharCode(65 + idx)}.</span>
                  <input
                    type="text"
                    value={opt.text}
                    onChange={(e) => handleOptionTextChange(idx, e.target.value)}
                    placeholder={`Lựa chọn ${String.fromCharCode(65 + idx)}...`}
                    className="flex-1 p-2 bg-white border border-slate-300 rounded-xl text-xs font-semibold focus:border-indigo-500"
                  />
                  {options.length > 2 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveOption(idx)}
                      className="p-1.5 text-slate-400 hover:text-rose-500 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {questionType === 'multiple_choice' && (
            <div className="space-y-2 p-4 bg-slate-50 rounded-2xl border border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-black text-slate-700">Các Lựa Chọn (Đánh dấu các đáp án đúng):</span>
                {options.length < 8 && (
                  <button
                    type="button"
                    onClick={handleAddOption}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-black flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Thêm lựa chọn
                  </button>
                )}
              </div>

              {options.map((opt, idx) => {
                const isChecked = correctOptionIds.includes(opt.id);
                return (
                  <div key={opt.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setCorrectOptionIds([...correctOptionIds, opt.id]);
                        } else {
                          setCorrectOptionIds(correctOptionIds.filter(id => id !== opt.id));
                        }
                      }}
                      className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 cursor-pointer"
                    />
                    <span className="text-xs font-black text-slate-500 w-5">{String.fromCharCode(65 + idx)}.</span>
                    <input
                      type="text"
                      value={opt.text}
                      onChange={(e) => handleOptionTextChange(idx, e.target.value)}
                      placeholder={`Lựa chọn ${String.fromCharCode(65 + idx)}...`}
                      className="flex-1 p-2 bg-white border border-slate-300 rounded-xl text-xs font-semibold focus:border-indigo-500"
                    />
                    {options.length > 2 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveOption(idx)}
                        className="p-1.5 text-slate-400 hover:text-rose-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {questionType === 'fill_blank' && (
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
              <label className="block text-xs font-black text-slate-700">
                Đáp Án Điền Khuyết <span className="text-rose-500">*</span>:
              </label>
              <input
                type="text"
                placeholder="Ví dụ: Hà Nội (Nếu có nhiều đáp án chấp nhận, phân tách bằng dấu chấm phẩy ;)"
                value={fillBlankAnswer}
                onChange={(e) => setFillBlankAnswer(e.target.value)}
                className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-xs font-semibold focus:border-indigo-500"
              />
              <p className="text-[11px] text-slate-400">
                * Học sinh cần điền chính xác cụm từ này để được tính điểm.
              </p>
            </div>
          )}

          {questionType === 'short_answer' && (
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
              <label className="block text-xs font-black text-slate-700">
                Đáp Án Trả Lời Ngắn <span className="text-rose-500">*</span>:
              </label>
              <input
                type="text"
                placeholder="Nhập câu trả lời ngắn chuẩn xác..."
                value={shortAnswer}
                onChange={(e) => setShortAnswer(e.target.value)}
                className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-xs font-semibold focus:border-indigo-500"
              />
            </div>
          )}

          {questionType === 'essay' && (
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
              <label className="block text-xs font-black text-slate-700">
                Gợi Ý / Tiêu Chí Chấm Tự Luận:
              </label>
              <textarea
                rows={2}
                placeholder="Nhập tiêu chí hoặc đáp án mẫu tham khảo cho giáo viên khi chấm..."
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
                className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-xs font-semibold focus:border-indigo-500"
              />
            </div>
          )}

          {/* LỜI GIẢI / GIẢI THÍCH (CHO TRẮC NGHIỆM/ĐIỀN KHUYẾT) */}
          {questionType !== 'essay' && (
            <div>
              <label className="block text-xs font-black text-slate-700 mb-1">
                Lời Giải Chi Tiết / Hướng Dẫn:
              </label>
              <textarea
                rows={2}
                placeholder="Nhập giải thích vì sao đáp án đúng..."
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>
          )}

          {/* THẺ TAGS */}
          <div>
            <label className="block text-xs font-black text-slate-700 mb-1">
              Thẻ Phân Loại (Tags, cách nhau bởi dấu phẩy):
            </label>
            <input
              type="text"
              placeholder="Ví dụ: phep_cong, hinh_hoc, danh_tu"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
          </div>

          {/* FOOTER NÚT LƯU */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black rounded-xl transition-colors"
            >
              Hủy Bỏ
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black rounded-xl transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {isSubmitting ? 'Đang Lưu...' : 'Lưu Vào Ngân Hàng'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateQuestionBankModal;
