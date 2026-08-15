import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Save, FileText, AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';

export const CreateExerciseModal = ({ isOpen, onClose }) => {
  const { profile } = useAuth();

  const [classesList, setClassesList] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [isGlobal, setIsGlobal] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [gradeLevel, setGradeLevel] = useState(1);
  const [subject, setSubject] = useState('Toán');
  const [exerciseType, setExerciseType] = useState('mixed');
  const [rewardStars, setRewardStars] = useState(10);
  const [dueDate, setDueDate] = useState('');
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [showScoreAfterSubmit, setShowScoreAfterSubmit] = useState(true);
  const [showCorrectAnswers, setShowCorrectAnswers] = useState(false);

  const [questions, setQuestions] = useState([
    {
      id: 1,
      question_number: 1,
      question_type: 'single_choice',
      prompt: '3 + 4 = ?',
      options: ['5', '6', '7', '8'],
      correct_answer: '7',
      points: 10
    }
  ]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    fetchTeacherClasses();
  }, [profile?.id]);

  const fetchTeacherClasses = async () => {
    try {
      let query = supabase.from('classes').select('id, name, grade_level');
      if (profile?.role === 'teacher') {
        query = query.eq('teacher_id', profile.id);
      }
      const { data } = await query.order('grade_level');
      if (data && data.length > 0) {
        setClassesList(data);
        setSelectedClassId(data[0].id);
      }
    } catch (err) {
      console.error('Fetch classes error:', err);
    }
  };

  if (!isOpen) return null;

  const handleAddQuestion = () => {
    setQuestions(prev => [
      ...prev,
      {
        id: prev.length + 1,
        question_number: prev.length + 1,
        question_type: 'single_choice',
        prompt: '',
        options: ['Lựa chọn A', 'Lựa chọn B', 'Lựa chọn C', 'Lựa chọn D'],
        correct_answer: 'Lựa chọn A',
        points: 10
      }
    ]);
  };

  const handleRemoveQuestion = (idx) => {
    if (questions.length <= 1) return;
    setQuestions(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMsg('Vui lòng nhập tiêu đề bài tập.');
      return;
    }

    if (!selectedClassId && !isGlobal) {
      setErrorMsg('Vui lòng chọn Lớp học phụ trách bài tập.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const exercisePayload = {
        title: title.trim(),
        description: description.trim(),
        class_id: selectedClassId || null,
        is_global: isGlobal,
        grade_level: parseInt(gradeLevel),
        subject,
        exercise_type: exerciseType,
        status: 'published',
        due_date: dueDate || null,
        max_attempts: parseInt(maxAttempts),
        reward_stars: parseInt(rewardStars),
        show_score_after_submit: showScoreAfterSubmit,
        show_correct_answers: showCorrectAnswers
      };

      const questionsPayload = questions.map((q, idx) => ({
        question_number: idx + 1,
        question_type: q.question_type,
        prompt: q.prompt.trim(),
        options_json: q.options || [],
        points: parseInt(q.points || 10),
        correct_answer_key: {
          correct_answer: q.correct_answer,
          accepted_answers: Array.isArray(q.correct_answer) ? q.correct_answer : [q.correct_answer],
          case_sensitive: false
        }
      }));

      const { data, error } = await supabase.rpc('save_exercise_with_questions_and_keys', {
        p_exercise: exercisePayload,
        p_questions: questionsPayload
      });

      if (error || !data?.success) {
        setErrorMsg(error?.message || data?.message || 'Lỗi khi tạo bài tập.');
      } else {
        onClose();
      }
    } catch (err) {
      console.error('Create exercise exception:', err);
      setErrorMsg(err.message || 'Lỗi hệ thống khi lưu bài tập.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-3xl rounded-3xl border-4 border-amber-300 shadow-2xl p-6 sm:p-8 animate-fadeIn max-h-[90vh] flex flex-col">
        
        {/* HEADER */}
        <div className="flex items-center justify-between pb-4 border-b-2 border-amber-100 shrink-0">
          <div className="flex items-center gap-2">
            <FileText className="w-6 h-6 text-amber-500" />
            <h2 className="text-xl font-black text-slate-800">Tạo Bài Tập Học Thuật Mới</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* FORM */}
        <form onSubmit={handleSubmit} className="space-y-6 overflow-y-auto py-4 pr-1 flex-1">
          
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-300 text-rose-800 rounded-xl text-xs font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-amber-50/60 p-4 rounded-2xl border border-amber-200">
            <div className="sm:col-span-2">
              <label className="block text-xs font-black text-amber-950 mb-1">Tiêu Đề Bài Tập *</label>
              <input
                type="text"
                required
                placeholder="Ví dụ: Ôn tập Toán & Tiếng Việt Khối 1"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3.5 py-2 bg-white border-2 border-amber-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-black text-amber-950 mb-1">Gán Cho Lớp Học *</label>
              <select
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
                disabled={isGlobal}
                className="w-full px-3.5 py-2 bg-white border-2 border-amber-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-amber-500"
              >
                {classesList.map(c => (
                  <option key={c.id} value={c.id}>
                    🏫 Lớp {c.name} (Khối {c.grade_level})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-black text-amber-950 mb-1">Môn Học</label>
              <select
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full px-3.5 py-2 bg-white border-2 border-amber-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-amber-500"
              >
                <option value="Toán">Toán</option>
                <option value="Tiếng Việt">Tiếng Việt</option>
                <option value="Tự nhiên & Xã hội">Tự nhiên & Xã hội</option>
              </select>
            </div>

            {profile?.role === 'admin' && (
              <div className="sm:col-span-2 flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="isGlobalCheck"
                  checked={isGlobal}
                  onChange={(e) => setIsGlobal(e.target.checked)}
                  className="w-4 h-4 text-amber-500 rounded"
                />
                <label htmlFor="isGlobalCheck" className="text-xs font-black text-amber-900">
                  🌐 Bài tập chung toàn trường (is_global - Chỉ Admin tạo)
                </label>
              </div>
            )}

            <div>
              <label className="block text-xs font-black text-amber-950 mb-1">Sao Thưởng Hoàn Thành</label>
              <input
                type="number"
                min="0"
                max="100"
                value={rewardStars}
                onChange={(e) => setRewardStars(e.target.value)}
                className="w-full px-3.5 py-2 bg-white border-2 border-amber-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-black text-amber-950 mb-1">Hạn Hoàn Thành</label>
              <input
                type="datetime-local"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3.5 py-2 bg-white border-2 border-amber-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-black text-amber-950 mb-1">Hướng Dẫn Làm Bài</label>
              <textarea
                rows="2"
                placeholder="Nhập hướng dẫn chi tiết cho các bé..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3.5 py-2 bg-white border-2 border-amber-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-amber-500"
              ></textarea>
            </div>
          </div>

          {/* CÂU HỎI & ĐÁP ÁN NGUYÊN BẢN */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-800">Danh Sách Câu Hỏi ({questions.length} câu)</h3>
              <button
                type="button"
                onClick={handleAddQuestion}
                className="px-3 py-1.5 bg-sky-100 text-sky-900 hover:bg-sky-200 font-extrabold text-xs rounded-xl border border-sky-300 flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Thêm Câu Hỏi
              </button>
            </div>

            {questions.map((q, idx) => (
              <div key={idx} className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="px-2.5 py-0.5 bg-slate-800 text-white font-black text-xs rounded-lg">
                    Câu {idx + 1}
                  </span>
                  <div className="flex items-center gap-2">
                    <select
                      value={q.question_type}
                      onChange={(e) => {
                        const val = e.target.value;
                        setQuestions(prev => prev.map((item, i) => {
                          if (i === idx) {
                            let initCorrect = 'Lựa chọn A';
                            if (val === 'multiple_choice') initCorrect = ['Lựa chọn A'];
                            return { ...item, question_type: val, correct_answer: initCorrect };
                          }
                          return item;
                        }));
                      }}
                      className="px-2 py-1 bg-white border border-slate-300 rounded-lg text-xs font-bold"
                    >
                      <option value="single_choice">Trắc nghiệm 1 đáp án</option>
                      <option value="multiple_choice">Trắc nghiệm nhiều đáp án</option>
                      <option value="fill_blank">Điền từ / điền số</option>
                      <option value="short_answer">Trả lời ngắn</option>
                      <option value="essay">Tự luận</option>
                      <option value="image_upload">Nộp Ảnh bài làm</option>
                      <option value="file_upload">Nộp File PDF/DOCX</option>
                    </select>
                    
                    {questions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveQuestion(idx)}
                        className="p-1 text-rose-600 hover:bg-rose-50 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <input
                    type="text"
                    required
                    placeholder="Nhập nội dung câu hỏi..."
                    value={q.prompt}
                    onChange={(e) => {
                      const val = e.target.value;
                      setQuestions(prev => prev.map((item, i) => i === idx ? { ...item, prompt: val } : item));
                    }}
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-bold"
                  />
                </div>

                {/* 1. TRẮC NGHIỆM 1 ĐÁP ÁN */}
                {q.question_type === 'single_choice' && (
                  <div className="grid grid-cols-2 gap-2">
                    {q.options.map((opt, oIdx) => (
                      <div key={oIdx} className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={opt}
                          onChange={(e) => {
                            const val = e.target.value;
                            setQuestions(prev => prev.map((item, i) => {
                              if (i === idx) {
                                const newOpts = [...item.options];
                                newOpts[oIdx] = val;
                                return { ...item, options: newOpts };
                              }
                              return item;
                            }));
                          }}
                          className="w-full px-2.5 py-1 bg-white border border-slate-300 rounded-lg text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setQuestions(prev => prev.map((item, i) => i === idx ? { ...item, correct_answer: opt } : item));
                          }}
                          className={`px-2 py-1 text-[11px] font-bold rounded-lg ${q.correct_answer === opt ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'}`}
                        >
                          {q.correct_answer === opt ? 'Đúng' : 'Chọn'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* 2. TRẮC NGHIỆM NHIỀU ĐÁP ÁN (MULTIPLE CHOICE UI CHỌN NƠI ĐÁNH DẤU MULTIPLE CORRECT ANSWERS) */}
                {q.question_type === 'multiple_choice' && (
                  <div className="space-y-2">
                    <label className="block text-[11px] font-bold text-slate-600">Đánh dấu các đáp án đúng (Mảng JSON):</label>
                    <div className="grid grid-cols-2 gap-2">
                      {q.options.map((opt, oIdx) => {
                        const currentCorrectArr = Array.isArray(q.correct_answer) ? q.correct_answer : [];
                        const isChecked = currentCorrectArr.includes(opt);

                        return (
                          <div key={oIdx} className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={opt}
                              onChange={(e) => {
                                const val = e.target.value;
                                setQuestions(prev => prev.map((item, i) => {
                                  if (i === idx) {
                                    const newOpts = [...item.options];
                                    newOpts[oIdx] = val;
                                    return { ...item, options: newOpts };
                                  }
                                  return item;
                                }));
                              }}
                              className="w-full px-2.5 py-1 bg-white border border-slate-300 rounded-lg text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                let newArr;
                                if (isChecked) {
                                  newArr = currentCorrectArr.filter(x => x !== opt);
                                } else {
                                  newArr = [...currentCorrectArr, opt];
                                }
                                setQuestions(prev => prev.map((item, i) => i === idx ? { ...item, correct_answer: newArr } : item));
                              }}
                              className={`px-2 py-1 text-[11px] font-bold rounded-lg ${isChecked ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'}`}
                            >
                              {isChecked ? '✓ Đúng' : 'Chọn'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 3 & 4. ĐIỀN TỪ / TRẢ LỜI NGẮN */}
                {(q.question_type === 'fill_blank' || q.question_type === 'short_answer') && (
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-0.5">Đáp án đúng tự động chấm:</label>
                    <input
                      type="text"
                      placeholder="Nhập từ hoặc số đúng..."
                      value={q.correct_answer}
                      onChange={(e) => {
                        const val = e.target.value;
                        setQuestions(prev => prev.map((item, i) => i === idx ? { ...item, correct_answer: val } : item));
                      }}
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-bold"
                    />
                  </div>
                )}

              </div>
            ))}
          </div>

          {/* BUTTONS */}
          <div className="pt-4 border-t border-slate-200 flex justify-end gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs rounded-xl shadow-md flex items-center gap-1.5 disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {isSubmitting ? 'Đang Xuất Bản...' : 'Xuất Bản Bài Tập'}
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
