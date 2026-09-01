import React, { useState, useEffect } from 'react';
import {
  X,
  Layers,
  Save,
  AlertCircle,
  CheckCircle2,
  Lock,
  Globe,
  RefreshCw,
  HelpCircle,
  FileText
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { createQuestion } from '../../../services/questionBankService';
import {
  toQuestionBankPayload,
  findDuplicatesInQuestionList
} from '../../../utils/questionBankAdapters';

export const SaveExerciseQuestionsModal = ({
  isOpen,
  onClose,
  onSuccess,
  exercise,
  role = 'teacher'
}) => {
  const [questions, setQuestions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const [selectedIndices, setSelectedIndices] = useState(new Set());

  // Batch Config
  const [batchSubject, setBatchSubject] = useState(exercise?.subject || 'Toán');
  const [batchGrade, setBatchGrade] = useState(exercise?.classes?.grade_level ? String(exercise.classes.grade_level) : '1');
  const [batchDifficulty, setBatchDifficulty] = useState('medium');
  const [batchVisibility, setBatchVisibility] = useState('private');

  const [isSaving, setIsSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);

  useEffect(() => {
    if (isOpen && exercise?.id) {
      fetchExerciseQuestions();
      setBatchSubject(exercise.subject || 'Toán');
      setBatchGrade(exercise.classes?.grade_level ? String(exercise.classes.grade_level) : '1');
    }
  }, [isOpen, exercise?.id]);

  const fetchExerciseQuestions = async () => {
    setIsLoading(true);
    setErrorMsg('');
    try {
      const { data, error } = await supabase
        .from('academic_exercise_questions')
        .select('*')
        .eq('exercise_id', exercise.id)
        .order('question_number');

      if (error) throw error;

      const items = data || [];
      setQuestions(items);
      setSelectedIndices(new Set(items.map((_, idx) => idx)));
    } catch (err) {
      console.error('Lỗi khi tải câu hỏi bài tập:', err);
      setErrorMsg(err.message || 'Không thể tải danh sách câu hỏi của bài tập này.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen || !exercise) return null;

  const handleToggleSelectAll = () => {
    if (selectedIndices.size === questions.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(questions.map((_, idx) => idx)));
    }
  };

  const handleToggleIndex = (idx) => {
    const next = new Set(selectedIndices);
    if (next.has(idx)) {
      next.delete(idx);
    } else {
      next.add(idx);
    }
    setSelectedIndices(next);
  };

  const handleSaveToBank = async () => {
    if (selectedIndices.size === 0 || isSaving) return;

    setIsSaving(true);
    setErrorMsg('');
    setSavedCount(0);

    const questionsToSave = questions
      .map((q, idx) => ({ q, idx }))
      .filter(({ idx }) => selectedIndices.has(idx));

    let successCount = 0;
    let failCount = 0;

    const concurrency = 2;
    for (let i = 0; i < questionsToSave.length; i += concurrency) {
      const chunk = questionsToSave.slice(i, i + concurrency);
      await Promise.all(
        chunk.map(async ({ q }) => {
          try {
            const payload = toQuestionBankPayload(
              {
                title: q.prompt ? (q.prompt.length > 80 ? q.prompt.slice(0, 77) + '...' : q.prompt) : `Câu hỏi bài ${exercise.title}`,
                prompt: q.prompt,
                question_type: q.question_type,
                options: q.options_json || q.options || [],
                correct_answer: q.correct_answer,
                correct_answers: q.correct_answer_key?.accepted_answers || (q.correct_answer ? [q.correct_answer] : []),
                subject: batchSubject,
                grade_level: batchGrade ? Number(batchGrade) : null,
                difficulty: batchDifficulty,
                visibility: role === 'admin' ? batchVisibility : 'private',
                explanation: q.explanation
              },
              {
                role,
                defaultSubject: batchSubject,
                defaultGrade: batchGrade,
                defaultDifficulty: batchDifficulty,
                defaultVisibility: role === 'admin' ? batchVisibility : 'private',
                metadata: {
                  source: 'academic_exercise',
                  source_question_id: q.id || undefined,
                  source_exercise_id: exercise.id || undefined,
                  imported_at: new Date().toISOString()
                }
              }
            );

            await createQuestion(payload);
            successCount++;
          } catch (err) {
            console.error('Lỗi khi lưu câu hỏi bài tập vào Question Bank:', err);
            failCount++;
          } finally {
            setSavedCount((prev) => prev + 1);
          }
        })
      );
    }

    setIsSaving(false);

    if (successCount > 0) {
      if (typeof onSuccess === 'function') {
        onSuccess(`Đã lưu ${successCount} câu hỏi từ bài tập vào Ngân hàng câu hỏi thành công!`);
      }
      onClose();
    } else {
      setErrorMsg('Không thể lưu câu hỏi vào Ngân hàng. Vui lòng kiểm tra lại kết nối.');
    }
  };

  const duplicates = findDuplicatesInQuestionList(questions);

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
              <h2 className="text-base sm:text-lg font-black text-slate-800">Lưu Vào Ngân Hàng Câu Hỏi</h2>
              <p className="text-xs text-slate-500 font-bold">Sao chép câu hỏi từ bài tập: <span className="text-slate-800">{exercise.title}</span></p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSaving}
            className="p-2 hover:bg-slate-200 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* BODY */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border-2 border-rose-200 text-rose-800 rounded-2xl text-xs font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {isLoading ? (
            <div className="py-12 text-center">
              <RefreshCw className="w-6 h-6 text-indigo-600 animate-spin mx-auto mb-2" />
              <p className="text-xs font-bold text-slate-600">Đang tải danh sách câu hỏi của bài tập...</p>
            </div>
          ) : questions.length === 0 ? (
            <div className="py-8 text-center bg-slate-50 rounded-2xl border border-slate-200">
              <FileText className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-xs font-bold text-slate-600">Bài tập này chưa có câu hỏi nào để lưu.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* CONFIG GRID */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-bold text-slate-700">
                <div>
                  <label className="block text-[11px] font-black text-slate-500 mb-1">Môn học</label>
                  <select
                    value={batchSubject}
                    onChange={(e) => setBatchSubject(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs focus:border-indigo-500"
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

                <div>
                  <label className="block text-[11px] font-black text-slate-500 mb-1">Khối lớp</label>
                  <select
                    value={batchGrade}
                    onChange={(e) => setBatchGrade(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs focus:border-indigo-500"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((g) => (
                      <option key={g} value={g}>Lớp {g}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-black text-slate-500 mb-1">Độ khó</label>
                  <select
                    value={batchDifficulty}
                    onChange={(e) => setBatchDifficulty(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs focus:border-indigo-500"
                  >
                    <option value="easy">Nhận biết (Easy)</option>
                    <option value="medium">Thông hiểu (Medium)</option>
                    <option value="hard">Vận dụng (Hard)</option>
                    <option value="expert">Vận dụng cao (Expert)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-black text-slate-500 mb-1">Phạm vi</label>
                  {role === 'admin' ? (
                    <select
                      value={batchVisibility}
                      onChange={(e) => setBatchVisibility(e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs focus:border-indigo-500"
                    >
                      <option value="private">🔒 Cá nhân</option>
                      <option value="public_template">🌐 Mẫu công khai</option>
                    </select>
                  ) : (
                    <div className="py-1.5 px-2 bg-slate-100 rounded-xl text-xs font-bold text-slate-600 flex items-center gap-1">
                      <Lock className="w-3.5 h-3.5" /> Cá nhân
                    </div>
                  )}
                </div>
              </div>

              {/* LIST QUESTIONS PREVIEW */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-black text-slate-700">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedIndices.size === questions.length && questions.length > 0}
                      onChange={handleToggleSelectAll}
                      className="w-4 h-4 text-indigo-600 rounded"
                    />
                    <span>Chọn tất cả ({selectedIndices.size}/{questions.length} câu)</span>
                  </label>
                </div>

                <div className="border border-slate-200 rounded-2xl overflow-hidden max-h-60 overflow-y-auto custom-scrollbar">
                  <div className="divide-y divide-slate-100">
                    {questions.map((q, idx) => {
                      const isSelected = selectedIndices.has(idx);
                      const isDuplicate = duplicates.has(idx);

                      return (
                        <div
                          key={q.id || idx}
                          onClick={() => handleToggleIndex(idx)}
                          className={`p-3 flex items-start gap-3 cursor-pointer hover:bg-slate-50 transition-colors ${
                            isSelected ? 'bg-indigo-50/20' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            className="w-4 h-4 text-indigo-600 rounded mt-0.5 cursor-pointer"
                          />
                          <div className="flex-1 min-w-0 text-xs">
                            <div className="font-bold text-slate-900 line-clamp-2">
                              <span className="text-slate-400 font-mono mr-1">Câu {idx + 1}:</span>
                              {q.prompt}
                            </div>
                            <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500 font-medium">
                              <span className="px-1.5 py-0.2 rounded bg-slate-100 font-bold">{q.question_type}</span>
                              {isDuplicate && (
                                <span className="text-amber-600 font-bold">⚠️ Trùng nội dung với câu khác trong bài</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="p-3 bg-indigo-50/60 border border-indigo-200 rounded-xl text-[11px] font-bold text-indigo-900">
                💡 Lưu ý: Thao tác này chỉ sao chép các câu hỏi vào Ngân hàng câu hỏi của Thầy/Cô. Bài tập gốc vẫn giữ nguyên hoàn toàn.
              </div>
            </div>
          )}

          {/* FOOTER */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black rounded-xl"
            >
              Đóng
            </button>
            <button
              type="button"
              onClick={handleSaveToBank}
              disabled={selectedIndices.size === 0 || isSaving || isLoading}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black rounded-xl transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              {isSaving ? `Đang lưu (${savedCount}/${selectedIndices.size})...` : `Lưu ${selectedIndices.size} Câu Vào Ngân Hàng`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SaveExerciseQuestionsModal;
