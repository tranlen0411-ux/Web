// src/components/dashboard/exams/ExamGradingModal.jsx
// Modal Chấm Điểm Thủ Công & Xem Chi Tiết Bài Làm Cho Giáo Viên / Admin (Phase B2)

import React, { useState, useEffect } from 'react';
import {
  X,
  CheckCircle2,
  AlertCircle,
  Save,
  Loader2,
  Clock,
  User,
  GraduationCap,
  Layers,
  FileText,
  Lock,
  MessageSquare,
  HelpCircle,
  ExternalLink,
  Award,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { createExamManagementClient } from '../../../services/examManagementClient.js';
import { useSound } from '../../../context/SoundContext.jsx';

export const ExamGradingModal = ({
  isOpen,
  onClose,
  attemptId,
  role = 'teacher',
  onGraded,
}) => {
  const { triggerSound } = useSound();

  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [attemptData, setAttemptData] = useState(null);
  const [questions, setQuestions] = useState([]);

  // State quản lý điểm và nhận xét cho các câu tự luận
  // manualGrades: { [exam_question_id]: { points_earned: string | number, teacher_comment: string } }
  const [manualGrades, setManualGrades] = useState({});
  const [overallFeedback, setOverallFeedback] = useState('');

  useEffect(() => {
    if (isOpen && attemptId) {
      fetchAttemptDetail();
    }
  }, [isOpen, attemptId]);

  const fetchAttemptDetail = async () => {
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const client = createExamManagementClient();
      const res = await client.getAttemptDetail({ attemptId });

      if (res.ok && res.data) {
        const { attempt, questions: qList } = res.data;
        setAttemptData(attempt);
        setQuestions(qList || []);
        setOverallFeedback(attempt.teacher_feedback || '');

        // Khởi tạo điểm chấm tự luận từ dữ liệu hiện có
        const initialGrades = {};
        (qList || []).forEach((q) => {
          if (q.is_manual) {
            initialGrades[q.exam_question_id] = {
              points_earned:
                q.points_earned !== null && q.points_earned !== undefined
                  ? String(q.points_earned)
                  : '0',
              teacher_comment: q.teacher_comment || '',
            };
          }
        });
        setManualGrades(initialGrades);
      } else {
        setErrorMsg(res.error?.message || 'Không thể tải chi tiết bài làm.');
      }
    } catch (err) {
      setErrorMsg(err?.message || 'Lỗi kết nối khi tải chi tiết bài làm.');
    } finally {
      setLoading(false);
    }
  };

  // Tính toán tổng điểm tự luận động theo thời gian thực
  const calculateLiveManualScore = () => {
    let sum = 0;
    questions.forEach((q) => {
      if (q.is_manual) {
        const val = Number(manualGrades[q.exam_question_id]?.points_earned);
        if (!isNaN(val) && val >= 0) {
          sum += val;
        }
      }
    });
    return Number(sum.toFixed(2));
  };

  const objectiveScore = Number(attemptData?.objective_score || 0);
  const liveManualScore = calculateLiveManualScore();
  const liveTotalScore = Number((objectiveScore + liveManualScore).toFixed(2));
  const maxScore = Number(attemptData?.max_score || 0);

  const handleScoreChange = (qId, maxPoints, rawVal) => {
    setManualGrades((prev) => ({
      ...prev,
      [qId]: {
        ...prev[qId],
        points_earned: rawVal,
      },
    }));
  };

  const handleCommentChange = (qId, comment) => {
    setManualGrades((prev) => ({
      ...prev,
      [qId]: {
        ...prev[qId],
        teacher_comment: comment,
      },
    }));
  };

  const handleSaveGrading = async () => {
    if (!attemptData) return;
    setErrorMsg('');
    setSuccessMsg('');

    // Client-side Validation cho từng câu tự luận
    const manualQuestions = questions.filter((q) => q.is_manual);
    const validatedGrades = [];

    for (const q of manualQuestions) {
      const gradeEntry = manualGrades[q.exam_question_id];
      const rawPoints = gradeEntry?.points_earned;
      const numPoints = Number(rawPoints);

      if (rawPoints === '' || rawPoints === null || rawPoints === undefined || isNaN(numPoints)) {
        setErrorMsg(`Vui lòng nhập điểm hợp lệ cho câu hỏi số ${q.question_number}.`);
        return;
      }

      if (numPoints < 0) {
        setErrorMsg(`Điểm câu số ${q.question_number} không được là số âm.`);
        return;
      }

      if (numPoints > q.points_possible) {
        setErrorMsg(
          `Điểm câu số ${q.question_number} (${numPoints} đ) không được vượt quá điểm tối đa (${q.points_possible} đ).`
        );
        return;
      }

      // Kiểm tra tối đa 2 chữ số thập phân
      const ptsStr = String(rawPoints);
      if (ptsStr.includes('.') && ptsStr.split('.')[1].length > 2) {
        setErrorMsg(`Điểm câu số ${q.question_number} chỉ được tối đa 2 chữ số thập phân.`);
        return;
      }

      validatedGrades.push({
        exam_question_id: q.exam_question_id,
        points_earned: numPoints,
        teacher_comment: gradeEntry?.teacher_comment?.trim() || null,
      });
    }

    setIsSubmitting(true);
    triggerSound?.('click');

    try {
      const client = createExamManagementClient();
      const payload = {
        attempt_id: attemptData.id,
        expected_version: attemptData.version,
        manual_grades: validatedGrades,
        teacher_feedback: overallFeedback.trim() || null,
      };

      const res = await client.gradeManualAttempt(payload);

      if (res.ok && res.data) {
        setSuccessMsg('✅ Đã lưu kết quả chấm bài thành công!');
        triggerSound?.('success');

        // Cập nhật trạng thái hiển thị
        setAttemptData((prev) => ({
          ...prev,
          status: res.data.status || 'graded',
          manual_score: res.data.manual_score,
          total_score: res.data.total_score,
          graded_at: res.data.graded_at,
          graded_by: res.data.graded_by,
          teacher_feedback: res.data.teacher_feedback,
          version: res.data.version,
        }));

        onGraded?.(res.data);
      } else {
        setErrorMsg(res.error?.message || 'Lỗi khi lưu kết quả chấm bài.');
        triggerSound?.('error');
      }
    } catch (err) {
      setErrorMsg(err?.message || 'Lỗi hệ thống khi gửi yêu cầu chấm điểm.');
      triggerSound?.('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDateTime = (isoStr) => {
    if (!isoStr) return '---';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return '---';
      return d.toLocaleString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch (_) {
      return '---';
    }
  };

  const getQuestionTypeLabel = (type) => {
    switch (type) {
      case 'single_choice':
        return 'Trắc nghiệm đơn';
      case 'multiple_choice':
        return 'Trắc nghiệm nhiều lựa chọn';
      case 'fill_blank':
        return 'Điền khuyết';
      case 'short_answer':
        return 'Trả lời ngắn';
      case 'essay':
        return 'Tự luận viết';
      case 'image_upload':
        return 'Nộp ảnh bài làm';
      case 'file_upload':
        return 'Nộp tệp tin';
      default:
        return type;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white w-[95vw] md:w-[90vw] max-w-5xl h-[90vh] max-h-[90vh] rounded-3xl border-4 border-indigo-400 shadow-2xl p-4 sm:p-6 flex flex-col overflow-hidden animate-fadeIn">
        {/* MODAL HEADER */}
        <div className="flex items-center justify-between pb-4 border-b-2 border-indigo-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-100 flex items-center justify-center text-indigo-700 font-black shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 bg-indigo-50 text-indigo-800 font-black text-xs rounded-lg border border-indigo-200">
                  {attemptData?.class_name || 'Lớp học'}
                </span>
                <span className="px-2.5 py-0.5 bg-slate-100 text-slate-700 font-bold text-xs rounded-lg">
                  Lượt làm bài #{attemptData?.attempt_number || 1}
                </span>
              </div>
              <h2 className="text-lg sm:text-xl font-black text-slate-900 mt-0.5">
                Chấm Bài & Chi Tiết: {attemptData?.student_name || 'Học sinh'}
              </h2>
            </div>
          </div>

          <button
            onClick={() => onClose?.()}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl transition-all shrink-0"
            title="Đóng modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* NOTIFICATIONS */}
        {errorMsg && (
          <div className="mt-3 p-3.5 bg-rose-50 border-2 border-rose-200 text-rose-800 rounded-2xl text-xs font-bold flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="mt-3 p-3.5 bg-emerald-50 border-2 border-emerald-200 text-emerald-800 rounded-2xl text-xs font-bold flex items-center gap-2 shrink-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* MODAL BODY */}
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-16">
            <RefreshCw className="w-8 h-8 animate-spin text-indigo-600 mb-2" />
            <p className="text-xs font-bold text-slate-400">Đang tải chi tiết bài làm...</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-4 pt-4 pr-1">
            {/* ATTEMPT SUMMARY BAR */}
            <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-4 rounded-2xl text-white border-2 border-indigo-500/40 shadow-md">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-indigo-300 font-bold block text-[11px]">Trạng thái</span>
                  {attemptData?.status === 'pending_manual_grade' ? (
                    <span className="inline-block mt-0.5 px-2 py-0.5 bg-amber-400/20 text-amber-300 font-black rounded-md border border-amber-400/30">
                      Chờ chấm tự luận
                    </span>
                  ) : attemptData?.status === 'graded' ? (
                    <span className="inline-block mt-0.5 px-2 py-0.5 bg-emerald-400/20 text-emerald-300 font-black rounded-md border border-emerald-400/30">
                      Đã hoàn tất
                    </span>
                  ) : (
                    <span className="inline-block mt-0.5 px-2 py-0.5 bg-slate-400/20 text-slate-300 font-black rounded-md">
                      {attemptData?.status}
                    </span>
                  )}
                </div>

                <div>
                  <span className="text-indigo-300 font-bold block text-[11px]">Thời gian nộp</span>
                  <span className="font-extrabold text-white">
                    {formatDateTime(attemptData?.submitted_at)}
                  </span>
                </div>

                <div>
                  <span className="text-indigo-300 font-bold block text-[11px]">
                    Điểm trắc nghiệm (Khóa 🔒)
                  </span>
                  <span className="font-extrabold text-sky-300 text-sm">
                    {objectiveScore.toFixed(2)} đ
                  </span>
                </div>

                <div>
                  <span className="text-indigo-300 font-bold block text-[11px]">
                    Tổng điểm (Tự luận: {liveManualScore.toFixed(2)} đ)
                  </span>
                  <span className="text-amber-400 font-black text-base">
                    {liveTotalScore.toFixed(2)} / {maxScore.toFixed(2)} đ
                  </span>
                </div>
              </div>
            </div>

            {/* QUESTION BY QUESTION REVIEW & GRADING */}
            <div className="space-y-4">
              <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" /> Danh Sách Câu Hỏi & Bài Làm ({questions.length})
              </h3>

              {questions.map((q) => {
                const isManual = q.is_manual;
                const manualGrade = manualGrades[q.exam_question_id] || {};
                const currentManualPoints = Number(manualGrade.points_earned ?? 0);
                const hasExceeded = currentManualPoints > q.points_possible || currentManualPoints < 0;

                return (
                  <div
                    key={q.exam_question_id}
                    className={`bg-white p-4 sm:p-5 rounded-2xl border-2 transition-all space-y-3 ${
                      isManual
                        ? 'border-amber-300 shadow-sm'
                        : 'border-slate-200'
                    }`}
                  >
                    {/* QUESTION HEADER */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2.5 py-1 bg-slate-900 text-white font-black text-xs rounded-xl">
                          Câu {q.question_number}
                        </span>
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-700 font-bold text-xs rounded-lg">
                          {getQuestionTypeLabel(q.question_type)}
                        </span>
                        {isManual ? (
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-900 font-black text-[11px] rounded-lg border border-amber-300 flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-amber-600" /> Tự luận - Cần chấm thủ công
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-sky-100 text-sky-900 font-black text-[11px] rounded-lg border border-sky-300 flex items-center gap-1">
                            <Lock className="w-3 h-3 text-sky-600" /> Trắc nghiệm tự động (Khóa)
                          </span>
                        )}
                      </div>

                      <div className="text-right">
                        <span className="text-xs font-black text-slate-700">
                          Điểm tối đa:{' '}
                          <span className="text-indigo-600 font-black text-sm">
                            {Number(q.points_possible).toFixed(2)} đ
                          </span>
                        </span>
                      </div>
                    </div>

                    {/* QUESTION PROMPT */}
                    <div className="text-xs sm:text-sm font-bold text-slate-800 leading-relaxed">
                      {q.prompt}
                    </div>

                    {/* MULTIPLE CHOICE OPTIONS CONTEXT (IF ANY) */}
                    {Array.isArray(q.options_json) && q.options_json.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                        {q.options_json.map((opt) => (
                          <div
                            key={opt.key}
                            className="p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 flex items-start gap-1.5"
                          >
                            <span className="font-black text-indigo-600 shrink-0">
                              {opt.key}.
                            </span>
                            <span>{opt.text}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* STUDENT SUBMISSION ANSWER */}
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                      <div className="text-[11px] font-black text-slate-500 uppercase">
                        Bài làm của học sinh:
                      </div>

                      {q.student_answer !== null && q.student_answer !== undefined ? (
                        <div className="text-xs font-extrabold text-slate-900 whitespace-pre-wrap">
                          {typeof q.student_answer === 'object'
                            ? JSON.stringify(q.student_answer, null, 2)
                            : String(q.student_answer)}
                        </div>
                      ) : q.file_url ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-700">Tệp nộp:</span>
                          <a
                            href={q.file_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-black text-indigo-600 hover:text-indigo-700 underline flex items-center gap-1"
                          >
                            <ExternalLink className="w-3.5 h-3.5" /> Xem Tệp Tin Đính Kèm
                          </a>
                        </div>
                      ) : (
                        <div className="text-xs italic text-slate-400 font-bold">
                          Học sinh không trả lời câu hỏi này.
                        </div>
                      )}
                    </div>

                    {/* GRADING SECTION */}
                    {isManual ? (
                      /* MANUAL QUESTION GRADING INPUTS */
                      <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-2xl space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <label className="text-xs font-black text-amber-950">
                              Điểm chấm thủ công:
                            </label>
                            <div className="relative">
                              <input
                                type="number"
                                min="0"
                                max={q.points_possible}
                                step="any"
                                value={manualGrade.points_earned ?? ''}
                                onChange={(e) =>
                                  handleScoreChange(q.exam_question_id, q.points_possible, e.target.value)
                                }
                                className={`w-28 px-3 py-1.5 bg-white border-2 rounded-xl text-xs font-black text-slate-900 focus:outline-none ${
                                  hasExceeded
                                    ? 'border-rose-500 text-rose-700 bg-rose-50'
                                    : 'border-amber-400 focus:border-indigo-600'
                                }`}
                              />
                              <span className="ml-2 text-xs font-black text-slate-500">
                                / {Number(q.points_possible).toFixed(2)} đ
                              </span>
                            </div>
                          </div>

                          {hasExceeded && (
                            <span className="text-[11px] font-black text-rose-600">
                              ⚠️ Điểm phải từ 0 đến {q.points_possible} đ
                            </span>
                          )}
                        </div>

                        {/* TEACHER COMMENT FOR QUESTION */}
                        <div className="space-y-1">
                          <label className="text-[11px] font-bold text-slate-600 flex items-center gap-1">
                            <MessageSquare className="w-3 h-3 text-slate-400" /> Nhận xét cho câu hỏi này
                            (tuỳ chọn):
                          </label>
                          <input
                            type="text"
                            placeholder="Ví dụ: Lập luận tốt, cần chú ý chính tả..."
                            value={manualGrade.teacher_comment ?? ''}
                            onChange={(e) =>
                              handleCommentChange(q.exam_question_id, e.target.value)
                            }
                            className="w-full px-3 py-1.5 bg-white border border-amber-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                      </div>
                    ) : (
                      /* OBJECTIVE QUESTION (READ-ONLY) */
                      <div className="p-3 bg-slate-100 rounded-xl border border-slate-200 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-700">
                            🤖 Điểm hệ thống tự động chấm:
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-lg text-xs font-black ${
                              Number(q.points_earned) > 0
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {Number(q.points_earned || 0).toFixed(2)} /{' '}
                            {Number(q.points_possible).toFixed(2)} đ{' '}
                            {Number(q.points_earned) > 0 ? '✅ (Đúng)' : '❌ (Sai)'}
                          </span>
                        </div>
                        <span className="text-[11px] font-bold text-slate-400 italic">
                          Không thể chỉnh sửa điểm trắc nghiệm
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* OVERALL TEACHER FEEDBACK */}
            <div className="bg-white p-4 sm:p-5 rounded-2xl border-2 border-indigo-200 space-y-2">
              <label className="block text-xs font-black text-slate-900 flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-indigo-600" /> Nhận Xét Chung Cho Cả Bài Thi
                (Tuỳ chọn):
              </label>
              <textarea
                rows={3}
                placeholder="Nhập lời khen ngợi, nhận xét tổng thể hoặc hướng dẫn học sinh cải thiện..."
                value={overallFeedback}
                onChange={(e) => setOverallFeedback(e.target.value)}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        )}

        {/* MODAL FOOTER */}
        <div className="pt-4 border-t-2 border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="text-xs font-bold text-slate-500">
            Tổng điểm cập nhật:{' '}
            <span className="font-black text-indigo-600 text-sm">
              {liveTotalScore.toFixed(2)} / {maxScore.toFixed(2)} đ
            </span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => onClose?.()}
              disabled={isSubmitting}
              className="flex-1 sm:flex-initial px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs rounded-2xl transition-all"
            >
              Đóng
            </button>

            <button
              onClick={handleSaveGrading}
              disabled={isSubmitting || loading}
              className="flex-1 sm:flex-initial px-6 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-black text-xs rounded-2xl shadow-lg border-b-4 border-amber-700 flex items-center justify-center gap-2 disabled:opacity-50 active:translate-y-0.5 transition-all"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Đang Lưu Điểm...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" /> Lưu Kết Quả Chấm Bài
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
