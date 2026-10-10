import React from 'react';
import { Clock, Pause } from 'lucide-react';

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const OPTION_THEMES = [
  { bg: 'bg-rose-950/60', border: 'border-rose-500/50', badge: 'bg-rose-500 text-white', text: 'text-rose-100' },
  { bg: 'bg-sky-950/60', border: 'border-sky-500/50', badge: 'bg-sky-500 text-white', text: 'text-sky-100' },
  { bg: 'bg-amber-950/60', border: 'border-amber-500/50', badge: 'bg-amber-500 text-white', text: 'text-amber-100' },
  { bg: 'bg-emerald-950/60', border: 'border-emerald-500/50', badge: 'bg-emerald-500 text-white', text: 'text-emerald-100' },
  { bg: 'bg-indigo-950/60', border: 'border-indigo-500/50', badge: 'bg-indigo-500 text-white', text: 'text-indigo-100' },
  { bg: 'bg-purple-950/60', border: 'border-purple-500/50', badge: 'bg-purple-500 text-white', text: 'text-purple-100' }
];

export function SpectatorLiveQuestionView({
  snapshot,
  activeQuestion,
  effectiveTotalQuestions,
  submissionStats,
  participantsCount = 0,
  timeLeftSeconds
}) {
  return (
    <div className="w-full max-w-6xl mx-auto space-y-6 sm:space-y-8 animate-fade-in">
      {/* Paused Banner */}
      {snapshot?.status === 'paused' && (
        <div className="w-full bg-amber-500/20 border-2 border-amber-500 rounded-2xl p-4 flex items-center justify-center gap-3 text-amber-300 animate-pulse">
          <Pause className="w-6 h-6" />
          <span className="text-lg sm:text-xl font-black uppercase tracking-wider">
            Trận Đấu Đang Tạm Dừng
          </span>
        </div>
      )}

      {/* Question Progress Header & Large Countdown Timer */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-900/80 border border-slate-800 rounded-3xl p-6 sm:p-8 backdrop-blur-md shadow-xl">
        <div className="flex items-center gap-4">
          <div className="px-5 py-2.5 rounded-2xl bg-sky-500/20 border border-sky-500/40 text-sky-400 font-black text-xl sm:text-2xl font-mono">
            Câu {snapshot?.current_question_index || 1} / {effectiveTotalQuestions}
          </div>
          <div>
            <span className="text-xs text-slate-400 uppercase font-bold tracking-wider block">
              Tiến độ nộp bài
            </span>
            <span className="text-base sm:text-lg font-bold text-slate-200">
              Đã trả lời: <strong className="text-emerald-400 font-mono text-xl">{submissionStats?.submitted_count || 0}</strong> / {submissionStats?.total_participants || participantsCount}
            </span>
          </div>
        </div>

        {/* Countdown Timer Display */}
        {timeLeftSeconds !== null && (
          <div className={`flex items-center gap-3 px-6 py-3 rounded-2xl border-2 font-mono font-black ${
            timeLeftSeconds <= 5
              ? 'bg-rose-950/80 border-rose-500 text-rose-400 animate-bounce'
              : 'bg-slate-950/80 border-amber-500/50 text-amber-400'
          }`}>
            <Clock className="w-6 h-6" />
            <span className="text-3xl sm:text-5xl">{timeLeftSeconds}s</span>
          </div>
        )}
      </div>

      {/* Question Card (Neutral Presentation - ZERO Correct Answer Leak) */}
      <div className="bg-gradient-to-b from-slate-900 to-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-10 shadow-2xl space-y-8">
        <h2 className="text-2xl sm:text-4xl font-black text-white leading-snug tracking-tight text-center sm:text-left">
          {activeQuestion?.question_text || 'Đang hiển thị câu hỏi thi đấu...'}
        </h2>

        {activeQuestion?.image_url && (
          <div className="max-w-md mx-auto rounded-2xl overflow-hidden border border-slate-700 shadow-lg">
            <img src={activeQuestion.image_url} alt="Minh họa câu hỏi" className="w-full h-auto object-contain max-h-72" />
          </div>
        )}

        {/* Options Grid OR Matching View OR Short Answer Placeholder (Neutral style: No correct answer, No percentages) */}
        {activeQuestion?.question_type === 'short_answer' ? (
          <div className="text-center py-10 px-6 rounded-2xl bg-slate-950/50 border border-slate-800 text-slate-300">
            <div className="text-xl sm:text-2xl font-black text-sky-400 mb-2">Câu hỏi điền vào chỗ trống</div>
            <div className="text-sm sm:text-base text-slate-400">
              Các thí sinh đang nhập câu trả lời trực tiếp trên thiết bị của mình.
            </div>
          </div>
        ) : activeQuestion?.question_type === 'matching' ? (
          <div className="space-y-4">
            <div className="text-center text-sm font-bold text-sky-400 mb-2">
              Câu hỏi nối cặp tương ứng giữa vế trái và vế phải
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
              {/* Vế Trái */}
              <div className="space-y-3">
                <div className="text-xs font-black uppercase tracking-wider text-slate-400 px-2">
                  Vế Trái
                </div>
                {(activeQuestion?.options || []).filter(o => o.side === 'left').map((opt, idx) => (
                  <div
                    key={opt.id || idx}
                    className="p-4 sm:p-5 rounded-2xl border-2 bg-slate-950/60 border-slate-800 flex items-center gap-3 shadow-md"
                  >
                    <div className="w-8 h-8 rounded-lg bg-sky-500/20 border border-sky-500/40 text-sky-300 font-black text-sm flex items-center justify-center shrink-0">
                      {idx + 1}
                    </div>
                    <span className="text-base sm:text-lg font-bold text-slate-200 leading-snug break-words">
                      {opt.text}
                    </span>
                  </div>
                ))}
              </div>

              {/* Vế Phải */}
              <div className="space-y-3">
                <div className="text-xs font-black uppercase tracking-wider text-slate-400 px-2">
                  Vế Phải
                </div>
                {(activeQuestion?.options || []).filter(o => o.side === 'right').map((opt, idx) => (
                  <div
                    key={opt.id || idx}
                    className="p-4 sm:p-5 rounded-2xl border-2 bg-slate-950/60 border-slate-800 flex items-center gap-3 shadow-md"
                  >
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-black text-sm flex items-center justify-center shrink-0">
                      {String.fromCharCode(65 + idx)}
                    </div>
                    <span className="text-base sm:text-lg font-bold text-slate-200 leading-snug break-words">
                      {opt.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            {activeQuestion?.options && activeQuestion.options.length > 0 ? (
              activeQuestion.options.map((opt, idx) => {
                const theme = OPTION_THEMES[idx % OPTION_THEMES.length];
                return (
                  <div
                    key={opt.id || idx}
                    className={`p-5 sm:p-6 rounded-2xl border-2 ${theme.bg} ${theme.border} flex items-center gap-4 shadow-lg transition-transform`}
                  >
                    <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl ${theme.badge} font-black text-lg sm:text-xl flex items-center justify-center flex-shrink-0 shadow-md`}>
                      {OPTION_LETTERS[idx] || (idx + 1)}
                    </div>
                    <span className={`text-lg sm:text-2xl font-bold ${theme.text} leading-snug`}>
                      {opt.text}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="col-span-2 text-center py-8 text-slate-500 italic">
                Chờ dữ liệu các lựa chọn...
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
