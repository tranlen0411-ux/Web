import React, { useState, useEffect } from 'react';
import { X, Send, Award, CheckCircle2, Clock, FileText, AlertCircle, Loader2, Star, Upload } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';

export const ExercisePlayModal = ({ exercise, onClose }) => {
  const { profile, refreshProfile } = useAuth();

  const [questions, setQuestions] = useState([]);
  const [submission, setSubmission] = useState(null);
  const [answers, setAnswers] = useState({});
  const [fileUrls, setFileUrls] = useState({});
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);

  useEffect(() => {
    fetchQuestionsAndSubmission();
  }, [exercise.id]);

  const fetchQuestionsAndSubmission = async () => {
    setLoading(true);
    try {
      // 1. Lấy danh sách câu hỏi (chỉ chứa câu hỏi công khai, không có đáp án đúng)
      const { data: qData } = await supabase
        .from('academic_exercise_questions')
        .select('*')
        .eq('exercise_id', exercise.id)
        .order('question_number', { ascending: true });

      if (qData) setQuestions(qData);

      // 2. Lấy bản ghi bài nộp của học sinh
      const { data: subData } = await supabase
        .from('academic_submissions')
        .select('*, academic_submission_answers(*)')
        .eq('exercise_id', exercise.id)
        .eq('student_id', profile?.id)
        .maybeSingle();

      if (subData) {
        setSubmission(subData);
        // Nạp các câu trả lời cũ nếu có
        const ansMap = {};
        const fileMap = {};
        if (subData.academic_submission_answers) {
          subData.academic_submission_answers.forEach(a => {
            ansMap[a.question_id] = a.student_answer_json;
            if (a.file_url) fileMap[a.question_id] = a.file_url;
          });
        }
        setAnswers(ansMap);
        setFileUrls(fileMap);
      }
    } catch (err) {
      console.error('Fetch questions error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Nộp bài làm qua RPC submit_academic_exercise
  const handleSubmitExercise = async () => {
    setIsSubmitting(true);
    setSubmitResult(null);

    try {
      const answersPayload = questions.map(q => ({
        question_id: q.id,
        answer: answers[q.id] || null,
        file_url: fileUrls[q.id] || null
      }));

      const { data: rpcRes, error: rpcErr } = await supabase.rpc('submit_academic_exercise', {
        p_exercise_id: exercise.id,
        p_answers: answersPayload
      });

      if (rpcErr || !rpcRes?.success) {
        setSubmitResult({
          success: false,
          message: rpcErr?.message || rpcRes?.message || 'Không thể nộp bài tập.'
        });
      } else {
        setSubmitResult(rpcRes);
        if (refreshProfile) await refreshProfile();
        fetchQuestionsAndSubmission();
      }
    } catch (err) {
      console.error('Submit exercise error:', err);
      setSubmitResult({ success: false, message: err.message || 'Lỗi mạng khi nộp bài.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!exercise) return null;

  const isGraded = submission?.status === 'graded';
  const isSubmitted = submission?.status === 'submitted' || submission?.status === 'pending_manual_grade';

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-3xl rounded-3xl border-4 border-amber-300 shadow-2xl p-6 sm:p-8 animate-fadeIn max-h-[90vh] flex flex-col">
        
        {/* MODAL HEADER */}
        <div className="flex items-center justify-between pb-4 border-b-2 border-amber-100 shrink-0">
          <div>
            <span className="px-2.5 py-0.5 bg-amber-100 text-amber-900 font-black text-xs rounded-lg">
              Môn {exercise.subject} - {exercise.class_name}
            </span>
            <h2 className="text-xl font-black text-slate-800 mt-1">{exercise.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* CONTENT AREA */}
        <div className="overflow-y-auto py-4 space-y-6 flex-1">
          
          {submitResult && (
            <div className={`p-4 rounded-2xl border text-xs font-bold ${submitResult.success ? 'bg-emerald-50 border-emerald-300 text-emerald-900' : 'bg-rose-50 border-rose-300 text-rose-900'}`}>
              <p className="font-black text-sm mb-1">{submitResult.message}</p>
              {submitResult.reward_stars_awarded > 0 && (
                <p className="text-amber-600 font-black mt-1 flex items-center gap-1">
                  🎉 Thưởng +{submitResult.reward_stars_awarded} sao! <Star className="w-4 h-4 fill-amber-400" />
                </p>
              )}
            </div>
          )}

          {/* KẾT QUẢ ĐÃ CHẤM NẾU CÓ */}
          {isGraded && (
            <div className="bg-emerald-50 p-4 rounded-2xl border-2 border-emerald-300 text-emerald-950 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-black text-base flex items-center gap-1.5">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" /> Kết Quả Điểm Số:
                </span>
                <span className="text-2xl font-black text-emerald-600">
                  {submission.total_score} / {submission.max_score}
                </span>
              </div>
              {submission.teacher_feedback && (
                <p className="text-xs font-bold text-slate-700 bg-white p-3 rounded-xl border border-emerald-200">
                  💬 <strong>Nhận xét của Giáo viên:</strong> {submission.teacher_feedback}
                </p>
              )}
            </div>
          )}

          {/* HƯỚNG DẪN BÀI TẬP */}
          <div className="bg-amber-50/80 p-4 rounded-2xl border border-amber-200">
            <h4 className="text-xs font-black text-amber-900 uppercase mb-1">Hướng dẫn làm bài:</h4>
            <p className="text-xs font-bold text-slate-700">{exercise.description || 'Không có mô tả chi tiết.'}</p>
          </div>

          {/* CÂU HỎI */}
          {loading ? (
            <div className="p-8 text-center text-xs font-bold text-slate-400">Đang tải danh sách câu hỏi...</div>
          ) : (
            <div className="space-y-6">
              {questions.map((q, idx) => {
                const isSelected = (opt) => answers[q.id] === opt;

                return (
                  <div key={q.id} className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-black text-xs text-slate-800">
                        Câu {idx + 1}: {q.prompt}
                      </span>
                      <span className="text-[11px] font-bold text-amber-600">
                        {q.points} điểm
                      </span>
                    </div>

                    {/* DẠNG TRẮC NGHIỆM 1 ĐÁP ÁN */}
                    {q.question_type === 'single_choice' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {(q.options_json || []).map((opt, oIdx) => (
                          <button
                            key={oIdx}
                            type="button"
                            disabled={isGraded || isSubmitted}
                            onClick={() => setAnswers(prev => ({ ...prev, [q.id]: opt }))}
                            className={`p-3 rounded-xl font-bold text-xs text-left border-2 transition-all ${
                              isSelected(opt)
                                ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
                                : 'bg-white text-slate-700 border-slate-200 hover:bg-amber-50'
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* DẠNG ĐIỀN TỪ / SỐ */}
                    {q.question_type === 'fill_blank' && (
                      <input
                        type="text"
                        disabled={isGraded || isSubmitted}
                        placeholder="Nhập câu trả lời của bé..."
                        value={answers[q.id] || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setAnswers(prev => ({ ...prev, [q.id]: val }));
                        }}
                        className="w-full px-3.5 py-2 bg-white border-2 border-amber-200 rounded-xl text-xs font-bold text-slate-800"
                      />
                    )}

                    {/* DẠNG TỰ LUẬN */}
                    {q.question_type === 'essay' && (
                      <textarea
                        rows="3"
                        disabled={isGraded || isSubmitted}
                        placeholder="Viết bài làm tự luận của bé tại đây..."
                        value={answers[q.id] || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setAnswers(prev => ({ ...prev, [q.id]: val }));
                        }}
                        className="w-full px-3.5 py-2 bg-white border-2 border-amber-200 rounded-xl text-xs font-bold text-slate-800"
                      ></textarea>
                    )}
                  </div>
                );
              })}
            </div>
          )}

        </div>

        {/* FOOTER ACTION */}
        {!isGraded && !isSubmitted && (
          <div className="pt-4 border-t border-slate-200 flex justify-end gap-2 shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl"
            >
              Hủy
            </button>
            <button
              onClick={handleSubmitExercise}
              disabled={isSubmitting}
              className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs rounded-xl shadow-md flex items-center gap-1.5 disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {isSubmitting ? 'Đang Nộp Bài...' : 'Nộp Bài Tập'}
            </button>
          </div>
        )}

      </div>
    </div>
  );
};
