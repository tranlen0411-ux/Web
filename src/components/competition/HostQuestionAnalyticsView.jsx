import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  BarChart3,
  TrendingDown,
  Clock,
  CheckCircle2,
  XCircle,
  HelpCircle,
  RefreshCw,
  AlertCircle,
  Sparkles,
  Award,
  Users,
  Layers,
  Flame,
  Info
} from 'lucide-react';
import { getHostQuestionAnalytics } from '../../services/competitionClient.js';

export const HostQuestionAnalyticsView = ({
  sessionId,
  onBackToPodium
}) => {
  const [analyticsData, setAnalyticsData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchAnalytics = useCallback(async () => {
    if (!sessionId) return;
    setIsLoading(true);
    setError(null);

    const res = await getHostQuestionAnalytics(sessionId);
    if (res.success && res.data) {
      setAnalyticsData(res.data);
    } else {
      setError(res.message || 'Không thể tải dữ liệu phân tích câu hỏi.');
    }
    setIsLoading(false);
  }, [sessionId]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const questions = useMemo(() => {
    return Array.isArray(analyticsData?.questions) ? analyticsData.questions : [];
  }, [analyticsData]);

  const summary = useMemo(() => {
    return analyticsData?.summary || {
      total_questions: 0,
      final_roster_count: 0,
      total_answered_instances: 0,
      total_correct_instances: 0,
      total_unanswered_instances: 0,
      overall_accuracy_percent: 0
    };
  }, [analyticsData]);

  // Derive Top 3 Hardest Questions (lowest accuracy_percent)
  // Tie order: accuracy_percent ASC, unanswered_count DESC, question_order ASC
  const topHardest = useMemo(() => {
    if (!questions.length) return [];
    return [...questions]
      .filter(q => q.final_roster_count > 0)
      .sort((a, b) => {
        if (a.accuracy_percent !== b.accuracy_percent) {
          return a.accuracy_percent - b.accuracy_percent;
        }
        if (a.unanswered_count !== b.unanswered_count) {
          return b.unanswered_count - a.unanswered_count;
        }
        return a.question_order - b.question_order;
      })
      .slice(0, 3);
  }, [questions]);

  // Derive Top 3 Slowest Questions (highest average_response_time_ms)
  // Tie order: average_response_time_ms DESC, question_order ASC
  // Zero-answer questions are strictly excluded
  const topSlowest = useMemo(() => {
    if (!questions.length) return [];
    return [...questions]
      .filter(q => q.answered_count > 0)
      .sort((a, b) => {
        if (a.average_response_time_ms !== b.average_response_time_ms) {
          return b.average_response_time_ms - a.average_response_time_ms;
        }
        return a.question_order - b.question_order;
      })
      .slice(0, 3);
  }, [questions]);

  // Loading State
  if (isLoading && !analyticsData) {
    return (
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-12 text-center space-y-4">
        <div className="w-14 h-14 bg-sky-50 rounded-2xl flex items-center justify-center text-sky-600 mx-auto border border-sky-200">
          <RefreshCw className="w-7 h-7 animate-spin" />
        </div>
        <h3 className="text-lg font-black text-slate-800">Đang tổng hợp phân tích bài thi...</h3>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          Hệ thống đang tính toán tỷ lệ chính xác, phân bố các đáp án và thời gian phản hồi từ toàn bộ bài nộp.
        </p>
      </div>
    );
  }

  // Error State
  if (error && !analyticsData) {
    return (
      <div className="bg-white rounded-3xl border border-rose-200 shadow-sm p-8 text-center space-y-4">
        <div className="w-14 h-14 bg-rose-50 rounded-2xl flex items-center justify-center text-rose-600 mx-auto border border-rose-200">
          <AlertCircle className="w-7 h-7" />
        </div>
        <div>
          <h3 className="text-base font-black text-slate-800">Không thể tải báo cáo phân tích</h3>
          <p className="text-xs text-rose-600 font-semibold mt-1">{error}</p>
        </div>
        <div className="flex items-center justify-center gap-3 pt-2">
          {onBackToPodium && (
            <button
              type="button"
              onClick={onBackToPodium}
              className="px-5 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-xs transition"
            >
              Quay lại Bục Vinh Danh
            </button>
          )}
          <button
            type="button"
            onClick={fetchAnalytics}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs shadow-md transition"
          >
            <RefreshCw className="w-4 h-4" />
            Thử Tải Lại
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* SECTION A: SUMMARY METRICS */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-sky-50 text-sky-700 border border-sky-200">
              <BarChart3 className="w-3.5 h-3.5 text-sky-600" />
              Báo Cáo Phân Tích Độ Khó &amp; Độ Chính Xác
            </div>
            <h3 className="text-xl sm:text-2xl font-black text-slate-800">Tổng Quan Toàn Bộ Đề Thi</h3>
          </div>

          <button
            type="button"
            onClick={fetchAnalytics}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Làm Mới Số Liệu
          </button>
        </div>

        {/* 3 Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200 flex items-center gap-4">
            <div className="w-12 h-12 bg-white rounded-xl shadow-xs border border-slate-200 flex items-center justify-center text-sky-600 flex-shrink-0">
              <Layers className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-500">Tổng số câu hỏi</div>
              <div className="text-2xl font-black text-slate-800">{summary.total_questions} <span className="text-xs font-normal text-slate-400">câu</span></div>
            </div>
          </div>

          <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200 flex items-center gap-4">
            <div className="w-12 h-12 bg-white rounded-xl shadow-xs border border-slate-200 flex items-center justify-center text-indigo-600 flex-shrink-0">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-500">Tổng thí sinh cuối phiên</div>
              <div className="text-2xl font-black text-slate-800">{summary.final_roster_count} <span className="text-xs font-normal text-slate-400">học sinh</span></div>
            </div>
          </div>

          <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200 flex items-center gap-4">
            <div className="w-12 h-12 bg-white rounded-xl shadow-xs border border-slate-200 flex items-center justify-center text-emerald-600 flex-shrink-0">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-500">Tỷ lệ đúng chung toàn bài</div>
              <div className="text-2xl font-black text-emerald-600">{summary.overall_accuracy_percent}%</div>
            </div>
          </div>
        </div>

        {/* Explanatory Microcopy Notice */}
        <div className="flex items-start gap-2.5 p-3.5 bg-sky-50/70 rounded-2xl border border-sky-100 text-sky-900 text-xs font-medium">
          <Info className="w-4 h-4 text-sky-600 flex-shrink-0 mt-0.5" />
          <p>
            Thống kê tính trên danh sách thí sinh cuối phiên; người tham gia muộn có thể được tính là chưa trả lời ở các câu trước.
          </p>
        </div>
      </div>

      {/* SECTION B: TOP INSIGHTS (Hardest & Slowest) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Top 3 Hardest */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-2 text-rose-700 border-b border-slate-100 pb-3">
            <TrendingDown className="w-5 h-5 text-rose-600" />
            <h4 className="font-black text-base text-slate-800">Top 3 Câu Khó Nhất (Tỷ lệ đúng thấp nhất)</h4>
          </div>

          {topHardest.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4">Chưa có dữ liệu câu hỏi.</p>
          ) : (
            <div className="space-y-3">
              {topHardest.map((q, idx) => (
                <div
                  key={q.question_id}
                  className="flex items-center justify-between p-3.5 rounded-2xl bg-rose-50/50 border border-rose-100 gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-6 h-6 rounded-full bg-rose-200 text-rose-900 text-xs font-black flex items-center justify-center flex-shrink-0">
                      #{idx + 1}
                    </span>
                    <div className="min-w-0">
                      <span className="text-xs font-black text-slate-800 block truncate">
                        Câu {q.question_order}: {q.question_text}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {q.correct_count}/{q.final_roster_count} đúng • {q.unanswered_count} chưa làm
                      </span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className="text-sm font-black text-rose-600 block">
                      {q.accuracy_percent}%
                    </span>
                    <span className="text-[10px] font-bold text-slate-400">chính xác</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top 3 Slowest */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-2 text-amber-700 border-b border-slate-100 pb-3">
            <Clock className="w-5 h-5 text-amber-600" />
            <h4 className="font-black text-base text-slate-800">Top 3 Câu Mất Nhiều Thời Gian Nhất</h4>
          </div>

          {topSlowest.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4">Chưa có câu hỏi nào có lượt trả lời.</p>
          ) : (
            <div className="space-y-3">
              {topSlowest.map((q, idx) => (
                <div
                  key={q.question_id}
                  className="flex items-center justify-between p-3.5 rounded-2xl bg-amber-50/50 border border-amber-100 gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-6 h-6 rounded-full bg-amber-200 text-amber-900 text-xs font-black flex items-center justify-center flex-shrink-0">
                      #{idx + 1}
                    </span>
                    <div className="min-w-0">
                      <span className="text-xs font-black text-slate-800 block truncate">
                        Câu {q.question_order}: {q.question_text}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {q.answered_count} lượt nộp • Giới hạn {q.time_limit_seconds}s
                      </span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className="text-sm font-black text-amber-600 block">
                      {(q.average_response_time_ms / 1000).toFixed(1)}s
                    </span>
                    <span className="text-[10px] font-bold text-slate-400">trung bình</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* SECTION C: QUESTION DETAILS LIST */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
        <div className="border-b border-slate-100 pb-4">
          <h3 className="text-lg sm:text-xl font-black text-slate-800 flex items-center gap-2">
            <Award className="w-5 h-5 text-indigo-600" />
            Chi Tiết Phân Tích Từng Câu Hỏi
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Xem số liệu phản hồi và biểu đồ phân bố lựa chọn của học sinh theo từng đáp án.
          </p>
        </div>

        <div className="space-y-6">
          {questions.map((q) => {
            const isChoiceType = ['single_choice', 'true_false', 'multiple_choice'].includes(q.question_type);
            const accuracyColor =
              q.accuracy_percent >= 75
                ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
                : q.accuracy_percent >= 50
                ? 'text-amber-600 bg-amber-50 border-amber-200'
                : 'text-rose-600 bg-rose-50 border-rose-200';

            return (
              <div
                key={q.question_id}
                className="rounded-2xl border-2 border-slate-150 p-5 sm:p-6 space-y-5 bg-slate-50/40 hover:bg-slate-50/80 transition shadow-2xs"
              >
                {/* Question Header & Meta */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/70 pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-3 py-1 rounded-xl bg-slate-900 text-white font-black text-xs">
                      Câu {q.question_order}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-lg bg-slate-200 text-slate-700 text-[11px] font-bold">
                      {q.question_type === 'single_choice'
                        ? 'Trắc nghiệm 1 đáp án'
                        : q.question_type === 'multiple_choice'
                        ? 'Trắc nghiệm nhiều đáp án'
                        : q.question_type === 'true_false'
                        ? 'Đúng / Sai'
                        : 'Tự luận ngắn'}
                    </span>
                    <span className="text-xs font-bold text-slate-500">
                      • {q.points} điểm • {q.time_limit_seconds}s
                    </span>
                  </div>

                  {/* Accuracy Badge */}
                  <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black border ${accuracyColor}`}>
                    <span>Độ chính xác:</span>
                    <span>{q.accuracy_percent}%</span>
                  </div>
                </div>

                {/* Question Text */}
                <p className="text-sm sm:text-base font-bold text-slate-800 leading-relaxed">
                  {q.question_text}
                </p>

                {/* Metric Summary Chips */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-2xs text-center">
                    <div className="text-[11px] font-bold text-slate-500 flex items-center justify-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      Làm đúng
                    </div>
                    <div className="text-lg font-black text-emerald-600 mt-0.5">
                      {q.correct_count} <span className="text-[11px] font-normal text-slate-400">/{q.final_roster_count}</span>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-2xs text-center">
                    <div className="text-[11px] font-bold text-slate-500 flex items-center justify-center gap-1">
                      <XCircle className="w-3.5 h-3.5 text-rose-500" />
                      Làm sai
                    </div>
                    <div className="text-lg font-black text-rose-600 mt-0.5">
                      {q.incorrect_count} <span className="text-[11px] font-normal text-slate-400">/{q.final_roster_count}</span>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-2xs text-center">
                    <div className="text-[11px] font-bold text-slate-500 flex items-center justify-center gap-1">
                      <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
                      Chưa nộp bài
                    </div>
                    <div className="text-lg font-black text-slate-600 mt-0.5">
                      {q.unanswered_count} <span className="text-[11px] font-normal text-slate-400">/{q.final_roster_count}</span>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-2xs text-center">
                    <div className="text-[11px] font-bold text-slate-500 flex items-center justify-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-amber-500" />
                      Thời gian TB
                    </div>
                    <div className="text-lg font-black text-amber-600 mt-0.5">
                      {q.answered_count > 0 ? `${(q.average_response_time_ms / 1000).toFixed(1)}s` : '—'}
                    </div>
                  </div>
                </div>

                {/* Option Distribution Bars */}
                {isChoiceType && Array.isArray(q.option_distribution) && q.option_distribution.length > 0 && (
                  <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 space-y-3">
                    <div className="text-xs font-black text-slate-700 flex items-center justify-between border-b border-slate-100 pb-2">
                      <span>Phân Bố Lựa Chọn ({q.answered_count} lượt nộp)</span>
                      <span className="text-[11px] font-normal text-slate-400">Tỷ lệ theo số bài đã nộp</span>
                    </div>

                    <div className="space-y-2.5">
                      {q.option_distribution.map((opt, optIndex) => {
                        const optChar = String.fromCharCode(65 + optIndex);
                        const isCorrect = Boolean(opt.is_correct);

                        return (
                          <div key={opt.option_id || optIndex} className="space-y-1">
                            <div className="flex items-center justify-between text-xs gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={`w-5 h-5 rounded-md text-[11px] font-black flex items-center justify-center flex-shrink-0 ${
                                  isCorrect ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'
                                }`}>
                                  {optChar}
                                </span>
                                <span className="font-bold text-slate-700 truncate" title={opt.option_text}>
                                  {opt.option_text}
                                </span>
                                {isCorrect && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-extrabold text-[10px] flex-shrink-0">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                    Đáp án đúng
                                  </span>
                                )}
                              </div>

                              <div className="text-right flex-shrink-0 font-bold text-slate-600">
                                <span>{opt.selection_count} lượt</span>
                                <span className="ml-1.5 text-slate-400">({opt.selection_percent}%)</span>
                              </div>
                            </div>

                            {/* Progress Bar */}
                            <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${
                                  isCorrect ? 'bg-emerald-500' : 'bg-sky-400'
                                }`}
                                style={{ width: `${Math.min(opt.selection_percent, 100)}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Short Answer Notice */}
                {q.question_type === 'short_answer' && (
                  <div className="p-3 bg-slate-100 rounded-xl text-xs text-slate-600 font-medium">
                    Câu hỏi tự luận ngắn: Hệ thống chấm điểm tự động dựa trên từ khóa. Tỷ lệ hoàn thành đạt {q.accuracy_percent}%.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
