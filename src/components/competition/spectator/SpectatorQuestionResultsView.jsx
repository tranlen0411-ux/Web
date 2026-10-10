import React from 'react';
import { CheckCircle2 } from 'lucide-react';

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export function SpectatorQuestionResultsView({
  snapshot,
  activeQuestion,
  questionResults,
  participantsCount = 0
}) {
  return (
    <div className="w-full max-w-6xl mx-auto space-y-6 sm:space-y-8 animate-fade-in">
      <div className="flex items-center justify-between bg-slate-900/80 border border-slate-800 rounded-3xl p-6 sm:p-8 backdrop-blur-md shadow-xl">
        <div>
          <span className="text-xs text-emerald-400 uppercase font-black tracking-widest block mb-1">
            KẾT QUẢ CÂU HỎI ĐÃ ĐÓNG
          </span>
          <h2 className="text-2xl sm:text-4xl font-black text-white">
            Kết Quả Câu {questionResults?.order_index || snapshot?.current_question_index || 1}
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-xs text-slate-400 uppercase font-bold block">Độ chính xác</span>
            <span className="text-2xl sm:text-4xl font-black text-emerald-400 font-mono">
              {Math.round(questionResults?.correct_percentage ?? 0)}%
            </span>
          </div>
        </div>
      </div>

      {/* Question Text */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl space-y-6">
        <h3 className="text-xl sm:text-2xl font-black text-slate-200">
          {questionResults?.question_text || activeQuestion?.question_text}
        </h3>

        {/* Aggregate Distribution Bar Cards OR Short Answer Result Card */}
        {questionResults?.question_type === 'short_answer' || activeQuestion?.question_type === 'short_answer' ? (
          <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="text-xs font-black uppercase tracking-wider text-sky-400">
              Câu hỏi điền vào chỗ trống
            </div>
            <p className="text-sm sm:text-base font-semibold text-slate-300">
              Các thí sinh đã nhập câu trả lời trực tiếp trên thiết bị của mình. Kết quả được hệ thống tự động đối chiếu và bảo mật chi tiết từng bài làm.
            </p>
            <div className="text-xs text-slate-400 italic">
              Hệ thống so sánh chuỗi không phân biệt chữ hoa/thường và đã tự động loại bỏ khoảng trắng thừa.
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {questionResults?.options && questionResults.options.map((opt, idx) => {
              const isCorrect = Boolean(opt.is_correct);
              const count = opt.count || 0;
              const totalSub = questionResults.submitted_count || 1;
              const percent = Math.round((count / totalSub) * 100);

              return (
                <div
                  key={opt.id || idx}
                  className={`p-4 sm:p-5 rounded-2xl border-2 transition-all relative overflow-hidden ${
                    isCorrect
                      ? 'bg-emerald-950/70 border-emerald-500/80 shadow-lg shadow-emerald-950/50'
                      : 'bg-slate-900/70 border-slate-800'
                  }`}
                >
                  {/* Background fill bar */}
                  <div
                    className={`absolute top-0 bottom-0 left-0 opacity-20 ${isCorrect ? 'bg-emerald-500' : 'bg-slate-500'}`}
                    style={{ width: `${percent}%` }}
                  />

                  <div className="relative z-10 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl font-black text-base sm:text-lg flex items-center justify-center flex-shrink-0 ${
                        isCorrect ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300'
                      }`}>
                        {OPTION_LETTERS[idx] || (idx + 1)}
                      </div>
                      <span className={`text-base sm:text-xl font-bold ${isCorrect ? 'text-emerald-200' : 'text-slate-200'}`}>
                        {opt.text}
                      </span>
                      {isCorrect && (
                        <span className="inline-flex items-center gap-1 text-xs font-black bg-emerald-500/30 border border-emerald-500/50 text-emerald-300 px-2.5 py-1 rounded-full">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Đáp án đúng
                        </span>
                      )}
                    </div>

                    <div className="text-right font-mono flex items-center gap-3">
                      <span className="text-sm text-slate-400">
                        {count} lượt
                      </span>
                      <span className={`text-lg sm:text-2xl font-black ${isCorrect ? 'text-emerald-400' : 'text-slate-300'}`}>
                        {percent}%
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Aggregate Counts Bottom Line */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-slate-800 text-center">
          <div className="bg-slate-950/60 p-3 rounded-2xl border border-slate-800">
            <span className="text-xs text-slate-400 block">Tổng đã nộp</span>
            <span className="text-xl font-black text-white font-mono">{questionResults?.submitted_count || 0}</span>
          </div>
          <div className="bg-emerald-950/40 p-3 rounded-2xl border border-emerald-900/50">
            <span className="text-xs text-emerald-400 block">Trả lời đúng</span>
            <span className="text-xl font-black text-emerald-300 font-mono">{questionResults?.correct_count || 0}</span>
          </div>
          <div className="bg-rose-950/40 p-3 rounded-2xl border border-rose-900/50">
            <span className="text-xs text-rose-400 block">Trả lời sai / Chưa nộp</span>
            <span className="text-xl font-black text-rose-300 font-mono">{questionResults?.incorrect_count || 0}</span>
          </div>
          <div className="bg-sky-950/40 p-3 rounded-2xl border border-sky-900/50">
            <span className="text-xs text-sky-400 block">Tổng thí sinh</span>
            <span className="text-xl font-black text-sky-300 font-mono">{questionResults?.total_participants || participantsCount}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
