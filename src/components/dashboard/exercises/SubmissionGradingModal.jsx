import React, { useState, useEffect } from 'react';
import { X, CheckCircle2, RotateCcw, Save, FileText, AlertCircle, Loader2, Star, Eye } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { formatClassLabel } from '../../../utils/helpers';

export const SubmissionGradingModal = ({ exercise, onClose }) => {
  const [submissions, setSubmissions] = useState([]);
  const [selectedSub, setSelectedSub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [signedUrlsMap, setSignedUrlsMap] = useState({});

  const [manualGrades, setManualGrades] = useState({});
  const [feedback, setFeedback] = useState('');
  const [requestRevision, setRequestRevision] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetchSubmissions();
  }, [exercise.id]);

  const fetchSubmissions = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('academic_submissions')
        .select('*, profiles!student_id(full_name, avatar_url), academic_submission_answers(*, academic_exercise_questions(*))')
        .eq('exercise_id', exercise.id)
        .order('submitted_at', { ascending: false });

      if (!error && data) {
        setSubmissions(data);
        if (data.length > 0) {
          const currentUpdated = selectedSub ? data.find(s => s.id === selectedSub.id) : null;
          selectSubmissionForGrading(currentUpdated || data[0]);
        }
      }
    } catch (err) {
      console.error('Fetch submissions error:', err);
    } finally {
      setLoading(false);
    }
  };

  const selectSubmissionForGrading = async (sub) => {
    setSelectedSub(sub);
    setFeedback(sub.teacher_feedback || '');
    setRequestRevision(sub.status === 'revision_requested');
    const grades = {};
    const signedMap = {};

    if (sub.academic_submission_answers) {
      for (const a of sub.academic_submission_answers) {
        grades[a.question_id] = {
          points_earned: a.points_earned ?? 0,
          teacher_comment: a.teacher_comment || ''
        };

        if (a.file_url) {
          try {
            const { data: signedData } = await supabase.storage
              .from('exercise-submissions')
              .createSignedUrl(a.file_url, 900);
            if (signedData?.signedUrl) {
              signedMap[a.question_id] = signedData.signedUrl;
            }
          } catch (e) {
            console.error('Signed URL error:', e);
          }
        }
      }
    }

    setManualGrades(grades);
    setSignedUrlsMap(signedMap);
  };

  const handleSaveGrade = async () => {
    if (!selectedSub) return;
    setIsSubmitting(true);
    setMsg('');

    try {
      // 1. Rà soát giới hạn điểm từng câu hỏi tự luận / nộp file: 0 <= points_earned <= question.points
      for (const ans of selectedSub.academic_submission_answers || []) {
        const q = ans.academic_exercise_questions;
        if (['essay', 'image_upload', 'file_upload'].includes(q?.question_type)) {
          const rawVal = manualGrades[ans.question_id]?.points_earned;
          const numVal = Number(rawVal ?? 0);
          const maxPoints = q?.points ?? 10;
          if (isNaN(numVal) || numVal < 0 || numVal > maxPoints) {
            setMsg(`⚠️ Điểm chấm cho câu "${q?.prompt ? (q.prompt.slice(0, 30) + '...') : ''}" không hợp lệ (Phải từ 0 đến ${maxPoints} điểm).`);
            setIsSubmitting(false);
            return;
          }
        }
      }

      // 2. Chuyển đổi an toàn sang số thập phân, bảo toàn 0.5, 1.5, không làm tròn xuống bằng parseInt
      const gradesArray = Object.keys(manualGrades).map(qId => {
        const rawPoints = Number(manualGrades[qId]?.points_earned ?? 0);
        return {
          question_id: qId,
          points_earned: Number.isFinite(rawPoints) ? rawPoints : 0,
          teacher_comment: manualGrades[qId]?.teacher_comment || ''
        };
      });

      const { data, error } = await supabase.rpc('grade_academic_submission', {
        p_submission_id: selectedSub.id,
        p_manual_grades: gradesArray,
        p_teacher_feedback: feedback,
        p_request_revision: requestRevision
      });

      if (error || !data?.success) {
        setMsg(error?.message || data?.message || 'Lỗi khi lưu kết quả chấm bài.');
      } else {
        setMsg('✅ Đã lưu điểm và nhận xét thành công!');
        await fetchSubmissions();
        onClose?.();
      }
    } catch (err) {
      console.error('Grade submission error:', err);
      setMsg(err.message || 'Lỗi hệ thống khi chấm bài.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const canGrade = selectedSub && ['submitted', 'pending_manual_grade'].includes(selectedSub.status);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-4xl rounded-3xl border-4 border-amber-300 shadow-2xl p-6 sm:p-8 animate-fadeIn max-h-[90vh] flex flex-col">
        
        {/* HEADER - KHÔNG CÒN DÙNG EXERCISE.CLASS_NAME */}
        <div className="flex items-center justify-between pb-4 border-b-2 border-amber-100 shrink-0">
          <div>
            <span className="px-2.5 py-0.5 bg-amber-100 text-amber-900 font-black text-xs rounded-lg">
              {exercise.classes?.name ? formatClassLabel(exercise.classes.name) : (exercise.is_global ? 'Toàn trường' : 'Lớp học')} - Môn {exercise.subject}
            </span>
            <h2 className="text-xl font-black text-slate-800 mt-1">Quản Lý & Chấm Bài: {exercise.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* BODY */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 py-4 overflow-y-auto flex-1">
          
          {/* DANH SÁCH HỌC SINH NỘP BÀI */}
          <div className="md:col-span-1 border-r border-slate-200 pr-3 space-y-2">
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">
              Danh sách nộp bài ({submissions.length})
            </h3>
            {loading ? (
              <div className="text-xs font-bold text-slate-400">Đang tải...</div>
            ) : submissions.length === 0 ? (
              <div className="text-xs font-bold text-slate-400 py-4">Chưa có học sinh nộp bài.</div>
            ) : (
              submissions.map(sub => (
                <button
                  key={sub.id}
                  onClick={() => selectSubmissionForGrading(sub)}
                  className={`w-full p-3 rounded-2xl border text-left transition-all flex items-center justify-between ${
                    selectedSub?.id === sub.id
                      ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
                      : 'bg-white text-slate-800 border-slate-200 hover:bg-amber-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-amber-200 flex items-center justify-center font-black text-xs text-amber-900 shrink-0">
                      {sub.profiles?.full_name?.charAt(0) || 'H'}
                    </div>
                    <div className="min-w-0">
                      <p className="font-black text-xs truncate">{sub.profiles?.full_name || 'Học sinh'}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className={`px-1.5 py-0.5 text-[9px] font-black rounded ${
                          sub.status === 'graded'
                            ? selectedSub?.id === sub.id ? 'bg-emerald-200 text-emerald-950' : 'bg-emerald-100 text-emerald-800'
                            : sub.status === 'revision_requested'
                            ? selectedSub?.id === sub.id ? 'bg-rose-200 text-rose-950' : 'bg-rose-100 text-rose-800'
                            : selectedSub?.id === sub.id ? 'bg-amber-200 text-amber-950' : 'bg-amber-100 text-amber-900'
                        }`}>
                          {sub.status === 'graded' ? 'Đã chấm' : sub.status === 'revision_requested' ? 'Cần làm lại' : 'Chờ chấm'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <span className="font-black text-xs shrink-0">{sub.total_score ?? 0}đ</span>
                </button>
              ))
            )}
          </div>

          {/* CHẤM BÀI CHI TIẾT */}
          <div className="md:col-span-2 space-y-4">
            {selectedSub ? (
              <>
                {msg && (
                  <div className="p-3 bg-amber-50 border border-amber-300 text-amber-900 rounded-xl text-xs font-bold">
                    {msg}
                  </div>
                )}

                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex items-center justify-between">
                  <div>
                    <h4 className="font-black text-sm text-slate-800">{selectedSub.profiles?.full_name}</h4>
                    <p className="text-xs font-bold text-slate-500">
                      Nộp lúc: {new Date(selectedSub.submitted_at).toLocaleString('vi-VN')}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-black text-amber-600">
                      {selectedSub.total_score ?? 0} / {selectedSub.max_score} điểm
                    </span>
                  </div>
                </div>

                {/* DANH SÁCH CÂU HỎI VÀ BÀI LÀM */}
                <div className="space-y-3">
                  {(selectedSub.academic_submission_answers || []).map((ans, idx) => {
                    const q = ans.academic_exercise_questions;
                    const isSubjective = ['essay', 'image_upload', 'file_upload'].includes(q?.question_type);

                    return (
                      <div key={ans.id} className="bg-white p-4 rounded-2xl border border-slate-200 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-black text-xs text-slate-800">
                            Câu {idx + 1} [{q?.question_type}]: {q?.prompt}
                          </span>
                          <span className="text-xs font-bold text-sky-600">
                            Tối đa {q?.points} điểm
                          </span>
                        </div>

                        <div className="bg-slate-50 p-2.5 rounded-xl text-xs font-bold text-slate-700">
                          <strong>Bài làm:</strong> {JSON.stringify(ans.student_answer_json || 'Chưa có văn bản')}
                        </div>

                        {/* HIỂN THỊ SIGNED URL 15 PHÚT MỞ FILE PRIVATE CHO GIÁO VIÊN */}
                        {ans.file_url && (
                          <div className="p-2.5 bg-sky-50 border border-sky-200 rounded-xl text-xs flex items-center justify-between">
                            <span className="font-bold text-sky-900 truncate max-w-[240px]">
                              📁 File bài làm nộp: {ans.file_url}
                            </span>
                            {signedUrlsMap[ans.question_id] ? (
                              <a
                                href={signedUrlsMap[ans.question_id]}
                                target="_blank"
                                rel="noreferrer"
                                className="px-3 py-1 bg-sky-600 hover:bg-sky-700 text-white font-black text-[11px] rounded-lg flex items-center gap-1 shadow-sm"
                              >
                                <Eye className="w-3.5 h-3.5" /> Mở Xem File Private (Signed URL)
                              </a>
                            ) : (
                              <span className="text-[11px] text-slate-400">Đang tạo link bảo mật...</span>
                            )}
                          </div>
                        )}

                        {/* CHỈ CHO PHÉP NHẬP ĐIỂM THỦ CÔNG KHI LÀ CÂU TỰ LUẬN / NỘP FILE */}
                        {isSubjective ? (
                          <div className="flex items-center gap-2 pt-1">
                            <label className="text-[11px] font-black text-slate-600">Điểm tự luận:</label>
                            <input
                              type="number"
                              step="any"
                              min="0"
                              max={q?.points || 10}
                              disabled={!canGrade}
                              value={manualGrades[ans.question_id]?.points_earned ?? ans.points_earned}
                              onChange={(e) => {
                                const val = e.target.value;
                                setManualGrades(prev => ({
                                  ...prev,
                                  [ans.question_id]: {
                                    ...prev[ans.question_id],
                                    points_earned: val
                                  }
                                }));
                              }}
                              className="w-20 px-2 py-1 bg-white border border-slate-300 rounded-lg text-xs font-bold disabled:bg-slate-100 disabled:text-slate-500"
                            />
                          </div>
                        ) : (
                          <div className="text-[11px] font-extrabold text-slate-500">
                            🤖 Điểm tự động chấm trắc nghiệm: {ans.points_earned} điểm {ans.is_correct ? '✅ (Đúng)' : '❌ (Sai)'}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* NHẬN XÉT CỦA GIÁO VIÊN */}
                <div className="space-y-2">
                  <label className="block text-xs font-black text-slate-800">Nhận Xét Của Giáo Viên:</label>
                  <textarea
                    rows="2"
                    placeholder="Nhập nhận xét khen ngợi hoặc động viên bé..."
                    value={feedback}
                    disabled={!canGrade}
                    onChange={(e) => setFeedback(e.target.value)}
                    className="w-full px-3.5 py-2 bg-white border-2 border-amber-200 rounded-xl text-xs font-bold text-slate-800 disabled:bg-slate-100 disabled:text-slate-500"
                  ></textarea>

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="checkbox"
                      id="revisionReq"
                      checked={requestRevision}
                      disabled={!canGrade}
                      onChange={(e) => setRequestRevision(e.target.checked)}
                      className="w-4 h-4 text-amber-500 rounded disabled:opacity-50"
                    />
                    <label htmlFor="revisionReq" className="text-xs font-bold text-rose-700">
                      Yêu cầu học sinh sửa và làm lại bài tập này
                    </label>
                  </div>
                </div>

                {/* NÚT HOÀN TẤT */}
                <div className="pt-2 flex justify-end">
                  {canGrade ? (
                    <button
                      onClick={handleSaveGrade}
                      disabled={isSubmitting}
                      className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-md flex items-center gap-1.5 disabled:opacity-50 transition-all active:translate-y-0.5"
                    >
                      {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      {isSubmitting ? 'Đang Lưu...' : 'Hoàn Tất Chấm Bài'}
                    </button>
                  ) : (
                    <button
                      disabled={true}
                      className="px-6 py-2.5 bg-slate-200 text-slate-500 font-black text-xs rounded-xl cursor-not-allowed flex items-center gap-1.5 shadow-none"
                    >
                      <CheckCircle2 className="w-4 h-4 text-slate-400" />
                      {selectedSub?.status === 'graded' ? 'Đã Chấm Hoàn Tất' : 'Đã Yêu Cầu Làm Lại'}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="p-8 text-center text-xs font-bold text-slate-400">Chọn một bài nộp ở cột bên trái để bắt đầu chấm điểm.</div>
            )}
          </div>

        </div>

      </div>
    </div>
  );
};
