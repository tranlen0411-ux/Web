// src/components/dashboard/exams/StudentExamResultModal.jsx
// Modal Xem Kết Quả & Nhận Xét Bài Thi Dành Cho Học Sinh (Phase B2 - Student Result View V1)

import React, { useState, useEffect } from 'react';
import {
  X,
  Award,
  Star,
  CheckCircle2,
  AlertCircle,
  Clock,
  BookOpen,
  MessageSquare,
  FileText,
  ExternalLink,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { createExamStudentClient } from '../../../services/examStudentClient.js';
import { useSound } from '../../../context/SoundContext.jsx';

export const StudentExamResultModal = ({
  isOpen,
  onClose,
  attemptId,
}) => {
  const { triggerSound } = useSound();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [resultData, setResultData] = useState(null);

  useEffect(() => {
    if (isOpen && attemptId) {
      fetchResult();
    }
  }, [isOpen, attemptId]);

  const fetchResult = async () => {
    if (!attemptId) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const client = createExamStudentClient();
      const res = await client.getStudentAttemptResult({ attempt_id: attemptId });

      if (res && res.ok && res.data) {
        setResultData(res.data);
      } else {
        if (res.safeErrorCode === 'ERR_RESULT_NOT_FINAL' || res.safeErrorCode === 'RESULT_NOT_FINAL') {
          setErrorMsg('Bài thi của em đang được Thầy/Cô chấm điểm. Vui lòng quay lại sau khi có điểm hoàn tất.');
        } else if (res.safeErrorCode === 'ATTEMPT_NOT_FOUND') {
          setErrorMsg('Không tìm thấy thông tin bài thi của em.');
        } else if (res.safeErrorCode === 'FORBIDDEN_ROLE') {
          setErrorMsg('Chỉ học sinh mới có quyền xem kết quả bài làm này.');
        } else {
          setErrorMsg(res.error?.message || 'Không thể tải kết quả bài làm. Vui lòng thử lại.');
        }
      }
    } catch (err) {
      setErrorMsg(err?.message || 'Lỗi kết nối khi tải kết quả bài thi.');
    } finally {
      setLoading(false);
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

  const attempt = resultData?.attempt;
  const exam = resultData?.exam;
  const questions = resultData?.questions || [];

  return (
    <div className="fixed inset-0 z-[9990] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white w-[96vw] md:w-[92vw] max-w-4xl max-h-[calc(100vh-1rem)] sm:max-h-[calc(100vh-2rem)] md:max-h-[90vh] h-[92vh] sm:h-[90vh] my-auto rounded-3xl border-4 border-indigo-400 shadow-2xl p-4 sm:p-6 flex flex-col min-h-0 overflow-hidden animate-fadeIn shrink-0">
        {/* MODAL HEADER */}
        <div className="flex items-center justify-between pb-4 border-b-2 border-indigo-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-indigo-100 border border-indigo-200 flex items-center justify-center text-indigo-700 font-black shrink-0">
              <Award className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2.5 py-0.5 bg-indigo-50 text-indigo-800 font-black text-xs rounded-lg border border-indigo-200">
                  {exam?.subject || 'Môn học'} - Khối {exam?.grade_level || 1}
                </span>
                <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 font-black text-xs rounded-lg border border-emerald-300 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Đã chấm xong
                </span>
              </div>
              <h2 className="text-lg sm:text-xl font-black text-slate-900 mt-0.5">
                Kết Quả Bài Thi: {exam?.title || 'Đề kiểm tra'}
              </h2>
            </div>
          </div>

          <button
            onClick={() => onClose?.()}
            className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl transition-all shrink-0 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
            title="Đóng bảng kết quả"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ERROR / NOTIFICATION BANNER */}
        {errorMsg && (
          <div className="mt-3 p-3.5 bg-rose-50 border-2 border-rose-200 text-rose-800 rounded-2xl text-xs font-bold flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button
              onClick={fetchResult}
              className="px-3 py-1 bg-rose-600 text-white font-black text-xs rounded-lg hover:bg-rose-700 transition-all"
            >
              Thử Lại
            </button>
          </div>
        )}

        {/* MODAL BODY */}
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-16">
            <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mb-2" />
            <p className="text-xs font-bold text-slate-400">Đang tải kết quả bài thi của em...</p>
          </div>
        ) : !resultData ? (
          <div className="flex-1 flex flex-col items-center justify-center py-16 text-center">
            <FileText className="w-12 h-12 text-slate-300 mb-2" />
            <h4 className="text-sm font-black text-slate-700">Chưa có dữ liệu kết quả</h4>
            <p className="text-xs font-bold text-slate-400 mt-1">
              Không thể hiển thị kết quả bài làm vào lúc này.
            </p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-4 pt-3 pr-1 sm:pr-2">
            {/* SCORE SUMMARY CARDS */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* TỔNG ĐIỂM */}
              <div className="p-3.5 bg-gradient-to-br from-emerald-500 to-teal-600 text-white rounded-2xl shadow-md border-b-4 border-emerald-700">
                <span className="text-[11px] font-black uppercase text-emerald-100 block">
                  Tổng Điểm Đạt Được
                </span>
                <span className="text-2xl font-black mt-0.5 block">
                  {Number(attempt?.total_score || 0).toFixed(2)}
                  <span className="text-sm font-bold text-emerald-100">
                    {' '}/ {Number(attempt?.max_score || 0).toFixed(2)} đ
                  </span>
                </span>
              </div>

              {/* ĐIỂM TRẮC NGHIỆM */}
              <div className="p-3.5 bg-sky-50 border border-sky-200 rounded-2xl">
                <span className="text-[11px] font-bold text-sky-800 block">Điểm Trắc Nghiệm</span>
                <span className="text-xl font-black text-sky-900 mt-0.5 block">
                  {Number(attempt?.objective_score || 0).toFixed(2)} đ
                </span>
              </div>

              {/* ĐIỂM TỰ LUẬN */}
              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl">
                <span className="text-[11px] font-black text-amber-800 block">Điểm Tự Luận</span>
                <span className="text-xl font-black text-amber-900 mt-0.5 block">
                  {Number(attempt?.manual_score || 0).toFixed(2)} đ
                </span>
              </div>

              {/* SAO THƯỞNG / THỜI GIAN NỘP */}
              <div className="p-3.5 bg-indigo-50 border border-indigo-200 rounded-2xl">
                <span className="text-[11px] font-black text-indigo-800 block">Thời Gian Nộp</span>
                <span className="text-xs font-extrabold text-indigo-950 mt-1 block">
                  {formatDateTime(attempt?.submitted_at)}
                </span>
                {Number(attempt?.reward_stars_awarded) > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs font-black text-amber-600 mt-1">
                    +{attempt.reward_stars_awarded} <Star className="w-3.5 h-3.5 fill-amber-400" />
                  </span>
                )}
              </div>
            </div>

            {/* TEACHER OVERALL FEEDBACK */}
            {attempt?.teacher_feedback && attempt.teacher_feedback.trim() && (
              <div className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 rounded-2xl border-2 border-amber-200 shadow-sm space-y-1.5">
                <h4 className="text-xs font-black text-amber-900 flex items-center gap-1.5">
                  <MessageSquare className="w-4 h-4 text-amber-600" /> Lời Nhận Xét Của Thầy/Cô:
                </h4>
                <p className="text-xs font-bold text-slate-800 leading-relaxed pl-5 whitespace-pre-wrap">
                  {attempt.teacher_feedback}
                </p>
              </div>
            )}

            {/* QUESTION REVIEW LIST */}
            <div className="space-y-3 pt-1">
              <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5" /> Chi Tiết Câu Hỏi & Bài Làm Của Em ({questions.length})
              </h3>

              {questions.map((q) => {
                const isManual = q.question_type === 'essay' || q.question_type === 'image_upload' || q.question_type === 'file_upload';

                return (
                  <div
                    key={q.exam_question_id}
                    className="bg-white p-4 rounded-2xl border-2 border-slate-200 shadow-sm space-y-3"
                  >
                    {/* QUESTION HEADER */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2.5 py-0.5 bg-slate-900 text-white font-black text-xs rounded-xl">
                          Câu {q.question_number}
                        </span>
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-700 font-bold text-xs rounded-lg">
                          {getQuestionTypeLabel(q.question_type)}
                        </span>
                      </div>

                      <div className="text-right">
                        <span className="text-xs font-black text-slate-700">
                          Điểm đạt được:{' '}
                          <span className="text-emerald-700 font-black text-sm">
                            {Number(q.points_earned || 0).toFixed(2)} / {Number(q.points_possible || 0).toFixed(2)} đ
                          </span>
                        </span>
                      </div>
                    </div>

                    {/* QUESTION PROMPT */}
                    <div className="text-xs sm:text-sm font-bold text-slate-800 leading-relaxed">
                      {q.prompt}
                    </div>

                    {/* MULTIPLE CHOICE CONTEXT (IF AVAILABLE) */}
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

                    {/* STUDENT ANSWER */}
                    <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100 space-y-1">
                      <span className="text-[11px] font-black text-indigo-900 block">
                        Câu trả lời của em:
                      </span>

                      {q.student_answer !== null && q.student_answer !== undefined ? (
                        <div className="text-xs font-extrabold text-slate-900 whitespace-pre-wrap">
                          {typeof q.student_answer === 'object'
                            ? JSON.stringify(q.student_answer, null, 2)
                            : String(q.student_answer)}
                        </div>
                      ) : q.file_url ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-700">Tệp đã nộp:</span>
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
                          Em chưa trả lời câu hỏi này.
                        </div>
                      )}
                    </div>

                    {/* TEACHER COMMENT FOR QUESTION */}
                    {q.teacher_comment && q.teacher_comment.trim() && (
                      <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs font-bold text-amber-900 flex items-start gap-2">
                        <MessageSquare className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-black">Nhận xét của Thầy/Cô: </span>
                          <span className="text-slate-800">{q.teacher_comment}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* MODAL FOOTER */}
        <div className="pt-3 border-t-2 border-slate-100 flex justify-end shrink-0">
          <button
            onClick={() => onClose?.()}
            className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs rounded-2xl transition-all focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};

export default StudentExamResultModal;
