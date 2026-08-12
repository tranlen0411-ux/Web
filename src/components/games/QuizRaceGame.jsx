import React, { useState, useEffect } from 'react';
import { Flag, Trophy, CheckCircle2, XCircle, RotateCcw, Zap } from 'lucide-react';
import { useSound } from '../../context/SoundContext';

const QUIZ_QUESTIONS = [
  {
    id: 1,
    question: "Kết quả của phép tính: 15 + 25 = ?",
    options: ["30", "35", "40", "45"],
    answer: 2
  },
  {
    id: 2,
    question: "Từ nào dưới đây viết ĐÚNG chính tả Tiếng Việt?",
    options: ["Nắng xớm", "Nắng sớm", "Lắng sớm", "Lắng xớm"],
    answer: 1
  },
  {
    id: 3,
    question: "Từ Tiếng Anh nào có nghĩa là 'Quả Táo'?",
    options: ["Banana", "Orange", "Apple", "Mango"],
    answer: 2
  },
  {
    id: 4,
    question: "Loại cây nào hút nước và khoáng chất chủ yếu qua bộ phận nào?",
    options: ["Lá cây", "Rễ cây", "Thân cây", "Hoa"],
    answer: 1
  },
  {
    id: 5,
    question: "Hình nào dưới đây có 4 cạnh bằng nhau và 4 góc vuông?",
    options: ["Hình tròn", "Hình tam giác", "Hình chữ nhật", "Hình vuông"],
    answer: 3
  }
];

export const QuizRaceGame = ({ onComplete }) => {
  const { triggerSound } = useSound();
  const [currentIdx, setCurrentIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [selectedOpt, setSelectedOpt] = useState(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [isFinished, setIsFinished] = useState(false);

  const restartQuiz = () => {
    setCurrentIdx(0);
    setScore(0);
    setStreak(0);
    setSelectedOpt(null);
    setIsAnswered(false);
    setIsFinished(false);
  };

  const handleSelectOption = (index) => {
    if (isAnswered) return;
    
    setSelectedOpt(index);
    setIsAnswered(true);
    const q = QUIZ_QUESTIONS[currentIdx];

    if (index === q.answer) {
      triggerSound('correct');
      setScore((s) => s + 20);
      setStreak((st) => st + 1);
    } else {
      triggerSound('wrong');
      setStreak(0);
    }
  };

  const handleNextQuestion = () => {
    triggerSound('click');
    if (currentIdx + 1 < QUIZ_QUESTIONS.length) {
      setCurrentIdx((c) => c + 1);
      setSelectedOpt(null);
      setIsAnswered(false);
    } else {
      setIsFinished(true);
      triggerSound('victory');
      const starsEarned = Math.max(10, Math.floor(score / 5));
      if (onComplete) onComplete(starsEarned, 60);
    }
  };

  const progressPercent = Math.min(100, Math.round(((currentIdx + (isAnswered ? 1 : 0)) / QUIZ_QUESTIONS.length) * 100));
  const currentQ = QUIZ_QUESTIONS[currentIdx];

  return (
    <div className="w-full max-w-2xl mx-auto bg-white rounded-3xl border-4 border-amber-300 p-6 shadow-xl text-center">
      
      {/* ĐƯỜNG ĐUA XE ĐUA ĐỘNG */}
      <div className="mb-6 bg-slate-900 p-4 rounded-2xl border-4 border-amber-400 relative overflow-hidden shadow-inner">
        <div className="flex justify-between text-xs font-black text-amber-300 mb-2 uppercase tracking-widest">
          <span>🏁 Vạch Xuất Phát</span>
          <span className="flex items-center gap-1 text-yellow-400">
            <Zap className="w-4 h-4" /> Streak: {streak}x
          </span>
          <span>🏁 Đích Đến</span>
        </div>

        {/* ĐƯỜNG ĐUA THUẬN */}
        <div className="relative w-full h-12 bg-slate-800 rounded-xl border-2 border-slate-700 flex items-center px-2">
          <div className="absolute top-1/2 left-0 right-0 border-t-2 border-dashed border-slate-600"></div>
          
          {/* XE ĐUA CHẠY THEO PROGRESS */}
          <div 
            className="absolute transition-all duration-500 ease-out text-3xl"
            style={{ left: `calc(${progressPercent}% - 24px)` }}
          >
            🏎️
          </div>
        </div>
      </div>

      {/* CÂU HỎI TRẮC NGHIỆM */}
      {!isFinished ? (
        <div className="text-left bg-amber-50/80 p-5 rounded-2xl border-2 border-amber-200 mb-6">
          <div className="flex justify-between items-center mb-3">
            <span className="px-3 py-1 bg-amber-200 text-amber-900 font-extrabold text-xs rounded-xl border border-amber-300">
              Câu hỏi {currentIdx + 1} / {QUIZ_QUESTIONS.length}
            </span>
            <span className="text-sm font-black text-sky-600">Điểm: {score}</span>
          </div>

          <h3 className="text-lg font-black text-slate-800 mb-4">
            {currentQ.question}
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {currentQ.options.map((opt, idx) => {
              let btnStyle = 'bg-white hover:bg-amber-100 border-amber-200 text-slate-700';

              if (isAnswered) {
                if (idx === currentQ.answer) {
                  btnStyle = 'bg-emerald-500 text-white border-emerald-600 shadow-md';
                } else if (idx === selectedOpt) {
                  btnStyle = 'bg-rose-500 text-white border-rose-600 shadow-md';
                } else {
                  btnStyle = 'bg-slate-100 text-slate-400 border-slate-200 opacity-60';
                }
              }

              return (
                <button
                  key={idx}
                  onClick={() => handleSelectOption(idx)}
                  disabled={isAnswered}
                  className={`p-3.5 rounded-2xl font-bold text-sm text-left border-3 transition-all flex items-center justify-between shadow-sm active:translate-y-0.5 ${btnStyle}`}
                >
                  <span>{opt}</span>
                  {isAnswered && idx === currentQ.answer && <CheckCircle2 className="w-5 h-5 text-white" />}
                  {isAnswered && idx === selectedOpt && idx !== currentQ.answer && <XCircle className="w-5 h-5 text-white" />}
                </button>
              );
            })}
          </div>

          {/* NÚT CÂU TÍẾP THEO */}
          {isAnswered && (
            <div className="mt-5 flex justify-end">
              <button
                onClick={handleNextQuestion}
                className="px-6 py-2.5 bg-sky-500 hover:bg-sky-600 text-white font-black text-sm rounded-xl border-b-4 border-sky-700 shadow-md flex items-center gap-2 active:translate-y-0.5 transition-all"
              >
                Câu Tiếp Theo 🚀
              </button>
            </div>
          )}
        </div>
      ) : (
        /* KẾT QUẢ ĐUA XE */
        <div className="bg-gradient-to-r from-amber-400 to-yellow-500 text-amber-950 p-6 rounded-2xl border-4 border-amber-600 shadow-xl">
          <Trophy className="w-16 h-16 mx-auto mb-2 text-amber-900 animate-bounce" />
          <h3 className="text-2xl font-black mb-1">Xe Đua Của Bé Đã Về Đích!</h3>
          <p className="text-sm font-bold mb-4">Tổng điểm đạt được: <span className="text-xl text-white underline">{score} điểm</span></p>

          <button
            onClick={restartQuiz}
            className="px-6 py-2.5 bg-slate-900 text-white font-black text-sm rounded-xl border-b-4 border-slate-950 shadow-md flex items-center justify-center gap-2 mx-auto"
          >
            <RotateCcw className="w-4 h-4" /> Đua Lại Vòng Khác
          </button>
        </div>
      )}

    </div>
  );
};
