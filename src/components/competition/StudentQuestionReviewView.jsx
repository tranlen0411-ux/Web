import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Clock,
  Sparkles,
  BookOpen,
  Award,
  RefreshCw,
  AlertCircle,
  Check,
  X,
  ListFilter,
  Layers,
} from 'lucide-react';

/**
 * Helper to get option letter: 0 -> A, 1 -> B, 2 -> C, 3 -> D
 */
const getOptionLetter = (index) => {
  return String.fromCharCode(65 + index);
};

export const StudentQuestionReviewView = ({
  reviewData,
  isLoading,
  error,
  onRetry,
  onBack,
}) => {
  // Filter State: 'ALL' | 'CORRECT' | 'INCORRECT' | 'UNANSWERED'
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [pendingScrollTargetId, setPendingScrollTargetId] = useState(null);

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <div className="w-16 h-16 bg-sky-100 rounded-3xl flex items-center justify-center mx-auto mb-4 border-2 border-sky-300">
          <RefreshCw className="w-8 h-8 text-sky-600 animate-spin" />
        </div>
        <h2 className="text-xl font-black text-slate-800 mb-2">Đang tải chi tiết bài làm...</h2>
        <p className="text-sm font-semibold text-slate-500">Vui lòng chờ trong giây lát.</p>
      </div>
    );
  }

  if (error || !reviewData || !Array.isArray(reviewData.questions)) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="bg-white rounded-3xl border-4 border-rose-200 shadow-md p-8 text-center">
          <div className="w-16 h-16 bg-rose-100 rounded-2xl flex items-center justify-center mx-auto mb-4 border-2 border-rose-300">
            <AlertCircle className="w-8 h-8 text-rose-600" />
          </div>
          <h2 className="text-2xl font-black text-rose-950 mb-2">
            Không Thể Tải Dữ Liệu Xem Lại
          </h2>
          <p className="text-slate-600 font-semibold mb-6 text-sm">
            {error || 'Đã xảy ra lỗi khi tải danh sách câu hỏi xem lại.'}
          </p>
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={onBack}
              className="px-6 py-3 border-2 border-slate-300 hover:border-slate-400 text-slate-700 font-bold text-sm rounded-xl transition-all"
            >
              Quay lại bảng thành tích
            </button>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="px-6 py-3 bg-sky-500 hover:bg-sky-600 text-white font-bold text-sm rounded-xl shadow-md transition-all flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Thử tải lại</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const questions = reviewData.questions;
  const totalQuestions = questions.length;
  const correctCount = questions.filter(q => q.student_answer?.is_correct === true).length;
  const totalPointsAwarded = questions.reduce((sum, q) => sum + (parseFloat(q.student_answer?.points_awarded) || 0), 0);
  const totalMaxPoints = questions.reduce((sum, q) => sum + (parseFloat(q.points) || 0), 0);

  // R6 Counts Calculation
  const filterCounts = useMemo(() => {
    let correct = 0;
    let incorrect = 0;
    let unanswered = 0;

    for (const q of questions) {
      if (!q.student_answer) {
        unanswered++;
      } else if (q.student_answer.is_correct === true) {
        correct++;
      } else {
        incorrect++;
      }
    }

    return {
      all: questions.length,
      correct,
      incorrect,
      unanswered,
    };
  }, [questions]);

  // R6 Filtered Questions
  const filteredQuestions = useMemo(() => {
    if (statusFilter === 'CORRECT') {
      return questions.filter(q => q.student_answer?.is_correct === true);
    }
    if (statusFilter === 'INCORRECT') {
      return questions.filter(q => q.student_answer && q.student_answer.is_correct === false);
    }
    if (statusFilter === 'UNANSWERED') {
      return questions.filter(q => !q.student_answer);
    }
    return questions;
  }, [questions, statusFilter]);

  // Scroll to pending target when filter updates to ALL
  useEffect(() => {
    if (pendingScrollTargetId) {
      const animFrame = requestAnimationFrame(() => {
        const el = document.getElementById(pendingScrollTargetId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        setPendingScrollTargetId(null);
      });
      return () => cancelAnimationFrame(animFrame);
    }
  }, [pendingScrollTargetId, filteredQuestions]);

  // Handler for Quick Question Jump
  const handleJumpToQuestion = useCallback((targetQuestion) => {
    const targetId = `review-question-${targetQuestion.question_id || targetQuestion.question_order}`;
    
    // Check if target question is currently visible in filteredQuestions
    const isVisible = filteredQuestions.some(
      q => (q.question_id && q.question_id === targetQuestion.question_id) || q.question_order === targetQuestion.question_order
    );

    if (!isVisible) {
      // Auto switch filter to ALL, then scroll
      setStatusFilter('ALL');
      setPendingScrollTargetId(targetId);
    } else {
      const el = document.getElementById(targetId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [filteredQuestions]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
      {/* Top Action & Navigation Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 pb-4 border-b-2 border-slate-200">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border-2 border-slate-200 hover:border-slate-300 rounded-2xl text-slate-700 font-black text-sm shadow-sm active:scale-95 transition-all focus:outline-none focus:ring-2 focus:ring-slate-400"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Quay Lại Bảng Thành Tích</span>
        </button>

        <div className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 border-2 border-indigo-200 rounded-2xl text-indigo-900 font-black text-xs sm:text-sm">
          <BookOpen className="w-4 h-4 text-indigo-600" />
          <span>Chế Độ Xem Lại Bài Làm</span>
        </div>
      </div>

      {/* Summary Stat Banner */}
      <div className="bg-gradient-to-br from-sky-500 via-indigo-600 to-violet-600 rounded-3xl p-6 sm:p-8 text-white shadow-lg mb-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="text-center sm:text-left">
            <h1 className="text-2xl sm:text-3xl font-black mb-1 flex items-center justify-center sm:justify-start gap-2">
              Xem Lại Toàn Bộ Câu Hỏi <Sparkles className="w-6 h-6 text-amber-300 fill-amber-300" />
            </h1>
            <p className="text-sky-100 font-medium text-sm sm:text-base">
              Đối chiếu đáp án của bạn với đáp án chuẩn và lời giải thích từ giáo viên.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 shrink-0 text-center">
            <div className="bg-white/15 backdrop-blur-sm rounded-2xl p-3 border border-white/20">
              <div className="text-xs font-bold text-sky-200 mb-0.5">Số câu đúng</div>
              <div className="text-xl sm:text-2xl font-black text-emerald-300">
                {correctCount}/{totalQuestions}
              </div>
            </div>

            <div className="bg-white/15 backdrop-blur-sm rounded-2xl p-3 border border-white/20">
              <div className="text-xs font-bold text-sky-200 mb-0.5">Tổng điểm</div>
              <div className="text-xl sm:text-2xl font-black text-amber-300">
                {totalPointsAwarded} <span className="text-xs font-semibold text-white/70">/{totalMaxPoints}đ</span>
              </div>
            </div>

            <div className="bg-white/15 backdrop-blur-sm rounded-2xl p-3 border border-white/20">
              <div className="text-xs font-bold text-sky-200 mb-0.5">Tỷ lệ đúng</div>
              <div className="text-xl sm:text-2xl font-black text-white">
                {totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0}%
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* R6 Feature 1: Filter Tab Bar */}
      <div className="bg-white rounded-3xl border-2 border-slate-200 shadow-sm p-4 sm:p-5 mb-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-100">
          <div className="inline-flex items-center gap-2 text-slate-800 font-black text-sm">
            <ListFilter className="w-4 h-4 text-indigo-600" />
            <span>Bộ Lọc Trạng Thái Câu Hỏi</span>
          </div>

          <div className="text-xs font-bold text-slate-500">
            Hiển thị: <span className="text-slate-800 font-black">{filteredQuestions.length}/{totalQuestions}</span> câu
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Bộ lọc trạng thái câu hỏi">
          <button
            type="button"
            onClick={() => setStatusFilter('ALL')}
            aria-pressed={statusFilter === 'ALL'}
            className={`px-4 py-2 rounded-2xl text-xs sm:text-sm font-black transition-all flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
              statusFilter === 'ALL'
                ? 'bg-indigo-600 text-white shadow-sm scale-[1.02]'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200/80 border border-slate-200'
            }`}
          >
            <span>Tất cả</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
              statusFilter === 'ALL' ? 'bg-indigo-700/80 text-white' : 'bg-slate-200 text-slate-700'
            }`}>
              {filterCounts.all}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('CORRECT')}
            aria-pressed={statusFilter === 'CORRECT'}
            className={`px-4 py-2 rounded-2xl text-xs sm:text-sm font-black transition-all flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-emerald-400 ${
              statusFilter === 'CORRECT'
                ? 'bg-emerald-600 text-white shadow-sm scale-[1.02]'
                : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100/80 border border-emerald-200'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Đúng</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
              statusFilter === 'CORRECT' ? 'bg-emerald-700/80 text-white' : 'bg-emerald-200 text-emerald-900'
            }`}>
              {filterCounts.correct}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('INCORRECT')}
            aria-pressed={statusFilter === 'INCORRECT'}
            className={`px-4 py-2 rounded-2xl text-xs sm:text-sm font-black transition-all flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-rose-400 ${
              statusFilter === 'INCORRECT'
                ? 'bg-rose-600 text-white shadow-sm scale-[1.02]'
                : 'bg-rose-50 text-rose-800 hover:bg-rose-100/80 border border-rose-200'
            }`}
          >
            <XCircle className="w-4 h-4" />
            <span>Sai</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
              statusFilter === 'INCORRECT' ? 'bg-rose-700/80 text-white' : 'bg-rose-200 text-rose-900'
            }`}>
              {filterCounts.incorrect}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('UNANSWERED')}
            aria-pressed={statusFilter === 'UNANSWERED'}
            className={`px-4 py-2 rounded-2xl text-xs sm:text-sm font-black transition-all flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-slate-400 ${
              statusFilter === 'UNANSWERED'
                ? 'bg-slate-700 text-white shadow-sm scale-[1.02]'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200/80 border border-slate-200'
            }`}
          >
            <HelpCircle className="w-4 h-4" />
            <span>Chưa trả lời</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
              statusFilter === 'UNANSWERED' ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-700'
            }`}>
              {filterCounts.unanswered}
            </span>
          </button>
        </div>
      </div>

      {/* R6 Feature 2: Quick Question Navigation Grid */}
      <div className="bg-white rounded-3xl border-2 border-slate-200 shadow-sm p-4 sm:p-5 mb-8">
        <div className="flex items-center justify-between gap-3 mb-3 pb-2 border-b border-slate-100">
          <div className="inline-flex items-center gap-2 text-slate-800 font-black text-sm">
            <Layers className="w-4 h-4 text-sky-600" />
            <span>Điều Hướng Nhanh Câu Hỏi</span>
          </div>

          <div className="flex items-center gap-3 text-xs font-bold text-slate-500">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Đúng
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" /> Sai
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-400 inline-block" /> Chưa làm
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Danh sách điều hướng nhanh từng câu hỏi">
          {questions.map((q, idx) => {
            const studentAns = q.student_answer;
            const isAnswered = studentAns !== null && studentAns !== undefined;
            const isCorrect = isAnswered && studentAns.is_correct === true;
            const qNum = q.question_order || idx + 1;

            const statusText = !isAnswered ? 'Chưa trả lời' : isCorrect ? 'Đúng' : 'Sai';
            const ariaLabel = `Câu ${qNum} — ${statusText}`;

            let buttonClass = 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200';
            let iconElement = <HelpCircle className="w-3 h-3 text-slate-500 shrink-0" />;

            if (isAnswered && isCorrect) {
              buttonClass = 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100';
              iconElement = <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />;
            } else if (isAnswered && !isCorrect) {
              buttonClass = 'bg-rose-50 text-rose-900 border-rose-300 hover:bg-rose-100';
              iconElement = <XCircle className="w-3 h-3 text-rose-600 shrink-0" />;
            }

            return (
              <button
                key={q.question_id || idx}
                type="button"
                onClick={() => handleJumpToQuestion(q)}
                aria-label={ariaLabel}
                title={ariaLabel}
                className={`min-w-[44px] h-10 px-2.5 py-1.5 rounded-xl border-2 font-black text-xs sm:text-sm flex items-center justify-center gap-1 transition-all active:scale-95 focus:outline-none focus:ring-2 focus:ring-sky-400 ${buttonClass}`}
              >
                <span>{qNum}</span>
                {iconElement}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter Empty State */}
      {filteredQuestions.length === 0 && (
        <div className="bg-slate-50 rounded-3xl border-2 border-dashed border-slate-300 p-12 text-center my-6">
          <div className="w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center mx-auto mb-3 text-slate-500">
            <ListFilter className="w-6 h-6" />
          </div>
          <h3 className="text-base font-black text-slate-700 mb-1">
            Không có câu hỏi nào trong mục này
          </h3>
          <p className="text-xs font-semibold text-slate-500 mb-4">
            Bạn có thể chuyển sang bộ lọc khác hoặc xem toàn bộ bài thi.
          </p>
          <button
            type="button"
            onClick={() => setStatusFilter('ALL')}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black shadow-sm transition-all"
          >
            Xem tất cả ({filterCounts.all} câu)
          </button>
        </div>
      )}

      {/* Questions List */}
      <div className="space-y-6">
        {filteredQuestions.map((q, qIdx) => {
          const studentAns = q.student_answer;
          const isAnswered = studentAns !== null && studentAns !== undefined;
          const isCorrect = isAnswered && studentAns.is_correct === true;
          const selectedOptionIds = studentAns?.selected_option_ids || [];

          // Resolve correct option IDs / targets based on canonical shape
          const correctOptionId = q.correct_answer?.option_id;
          const correctOptionIds = q.correct_answer?.option_ids || (correctOptionId ? [correctOptionId] : []);
          const acceptedAnswers = q.correct_answer?.accepted_answers || [];

          const targetDomId = `review-question-${q.question_id || q.question_order || qIdx + 1}`;

          return (
            <div
              key={q.question_id || qIdx}
              id={targetDomId}
              className={`bg-white rounded-3xl border-3 shadow-sm overflow-hidden transition-all scroll-mt-24 ${
                !isAnswered
                  ? 'border-slate-200'
                  : isCorrect
                  ? 'border-emerald-200 ring-1 ring-emerald-100'
                  : 'border-rose-200 ring-1 ring-rose-100'
              }`}
            >
              {/* Question Header Status */}
              <div
                className={`px-6 py-4 flex flex-wrap items-center justify-between gap-3 border-b-2 ${
                  !isAnswered
                    ? 'bg-slate-50 border-slate-100 text-slate-700'
                    : isCorrect
                    ? 'bg-emerald-50/80 border-emerald-100 text-emerald-950'
                    : 'bg-rose-50/80 border-rose-100 text-rose-950'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`px-3 py-1 rounded-xl font-black text-xs sm:text-sm text-white ${
                      !isAnswered
                        ? 'bg-slate-600'
                        : isCorrect
                        ? 'bg-emerald-600'
                        : 'bg-rose-600'
                    }`}
                  >
                    Câu {q.question_order || qIdx + 1}
                  </span>

                  {/* Status Badge with Text & Icon */}
                  {!isAnswered ? (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-200 text-slate-700 rounded-xl font-black text-xs">
                      <HelpCircle className="w-3.5 h-3.5" />
                      <span>Chưa trả lời</span>
                    </div>
                  ) : isCorrect ? (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-200 text-emerald-900 rounded-xl font-black text-xs">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                      <span>Chính xác (+{studentAns.points_awarded ?? q.points}đ)</span>
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-rose-200 text-rose-900 rounded-xl font-black text-xs">
                      <XCircle className="w-3.5 h-3.5 text-rose-700" />
                      <span>Chưa đúng (0đ)</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-4 text-xs font-bold text-slate-500">
                  {isAnswered && studentAns.time_taken_ms !== undefined && (
                    <div className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      <span>{Math.round(studentAns.time_taken_ms / 1000)}s</span>
                    </div>
                  )}
                  <div>
                    Điểm: <span className="font-black text-slate-700">{q.points}đ</span>
                  </div>
                </div>
              </div>

              {/* Question Body */}
              <div className="p-6 sm:p-8">
                {/* Question Text */}
                <h2 className="text-lg sm:text-xl font-black text-slate-800 mb-6 leading-relaxed">
                  {q.question_text}
                </h2>

                {/* Options Layout (Choice / True-False) */}
                {Array.isArray(q.options) && q.options.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                    {q.options.map((opt, optIdx) => {
                      const letter = getOptionLetter(optIdx);
                      const isOptionSelected = selectedOptionIds.includes(opt.id);
                      const isOptionCorrect = correctOptionIds.includes(opt.id);

                      let cardStyle = 'bg-slate-50/50 border-slate-200 text-slate-700';
                      let letterStyle = 'bg-slate-100 text-slate-700 border-slate-300';

                      if (isOptionCorrect && isOptionSelected) {
                        cardStyle = 'bg-emerald-50 border-emerald-500 ring-2 ring-emerald-300';
                        letterStyle = 'bg-emerald-500 text-white border-emerald-600';
                      } else if (isOptionCorrect && !isOptionSelected) {
                        cardStyle = 'bg-emerald-50/60 border-emerald-400 border-dashed';
                        letterStyle = 'bg-emerald-100 text-emerald-800 border-emerald-300';
                      } else if (!isOptionCorrect && isOptionSelected) {
                        cardStyle = 'bg-rose-50 border-rose-400 ring-2 ring-rose-200';
                        letterStyle = 'bg-rose-500 text-white border-rose-600';
                      }

                      return (
                        <div
                          key={opt.id || optIdx}
                          className={`p-4 rounded-2xl border-3 flex items-start gap-3.5 transition-all ${cardStyle}`}
                        >
                          <div
                            className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-sm shrink-0 border-2 ${letterStyle}`}
                          >
                            {letter}
                          </div>

                          <div className="flex-1 min-w-0 pt-0.5">
                            <div className="text-sm sm:text-base font-bold text-slate-800 break-words">
                              {opt.text || opt.label || 'Lựa chọn'}
                            </div>

                            {/* Badges Container */}
                            <div className="flex flex-wrap items-center gap-1.5 mt-2">
                              {isOptionSelected && (
                                <span
                                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-black ${
                                    isOptionCorrect
                                      ? 'bg-emerald-200 text-emerald-900'
                                      : 'bg-rose-200 text-rose-900'
                                  }`}
                                >
                                  {isOptionCorrect ? <Check className="w-3 h-3 stroke-[3]" /> : <X className="w-3 h-3 stroke-[3]" />}
                                  <span>Đáp án của bạn</span>
                                </span>
                              )}

                              {isOptionCorrect && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-600 text-white rounded-lg text-xs font-black">
                                  <Check className="w-3 h-3 stroke-[3]" />
                                  <span>Đáp án đúng</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Short Answer Format */}
                {q.question_type === 'short_answer' && (
                  <div className="bg-slate-50 border-2 border-slate-200 rounded-2xl p-5 mb-6 space-y-3">
                    <div>
                      <div className="text-xs font-bold text-slate-500 mb-1">Đáp án của bạn:</div>
                      <div
                        className={`text-base font-black px-4 py-2 rounded-xl border-2 ${
                          !isAnswered
                            ? 'bg-slate-100 text-slate-500 border-slate-200 italic'
                            : isCorrect
                            ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                            : 'bg-rose-50 text-rose-900 border-rose-300'
                        }`}
                      >
                        {isAnswered && studentAns.text_answer ? studentAns.text_answer : 'Chưa trả lời'}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-bold text-slate-500 mb-1">Đáp án đúng được chấp nhận:</div>
                      <div className="text-sm font-black text-emerald-900 bg-emerald-50 px-4 py-2 rounded-xl border-2 border-emerald-300">
                        {acceptedAnswers.length > 0 ? acceptedAnswers.join(' / ') : '(Không có)'}
                      </div>
                    </div>
                  </div>
                )}

                {/* Explanation Card */}
                {q.explanation && q.explanation.trim() !== '' && (
                  <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300/80 rounded-2xl p-4 sm:p-5 text-left">
                    <div className="flex items-center gap-2 text-amber-900 font-black text-xs sm:text-sm uppercase tracking-wider mb-2">
                      <Sparkles className="w-4 h-4 text-amber-600 fill-amber-500" />
                      <span>Lời Giải Thích / Hướng Dẫn</span>
                    </div>
                    <p className="text-sm sm:text-base font-semibold text-amber-950 leading-relaxed">
                      {q.explanation}
                    </p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Back Button */}
      <div className="mt-8 text-center">
        <button
          type="button"
          onClick={onBack}
          className="px-8 py-3.5 bg-slate-800 hover:bg-slate-900 text-white font-black text-base rounded-2xl transition-all shadow-md active:scale-95 inline-flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Quay Về Bảng Thành Tích</span>
        </button>
      </div>
    </div>
  );
};

