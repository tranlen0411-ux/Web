import React, { useState, useEffect, useRef } from 'react';
import { 
  Trophy, RotateCcw, ArrowLeft, Volume2, VolumeX, Sparkles, 
  CheckCircle2, XCircle, Play, Star, HelpCircle, AlertCircle, Loader2, MoveRight
} from 'lucide-react';
import { useSound } from '../../context/SoundContext';
import { LEARNING_GAMES_DATA, getGameQuestions, shuffleArray } from '../../data/learningGamesData';

export const Grade12GamePlayer = ({ gameKey, onComplete, assignmentId = null }) => {
  const { triggerSound, isMuted, toggleSound } = useSound();
  const gameConfig = LEARNING_GAMES_DATA[gameKey] || LEARNING_GAMES_DATA['train-numbers'];

  const [gameState, setGameState] = useState('start'); // 'start' | 'playing' | 'saving' | 'result'
  const [questions, setQuestions] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [isCorrect, setIsCorrect] = useState(false);

  // Trạng thái lưu kết quả từ RPC
  const [saveResult, setSaveResult] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Thao tác ghép từ cho game Nhà Máy Câu Văn
  const [assembledWords, setAssembledWords] = useState([]);
  const [availableWords, setAvailableWords] = useState([]);

  const startTimeRef = useRef(null);
  const completedRef = useRef(false);

  // Khởi tạo lượt chơi mới
  const startNewGame = () => {
    triggerSound('click');
    const qList = getGameQuestions(gameKey, 12);
    setQuestions(qList);
    setCurrentIdx(0);
    setScore(0);
    setCorrectCount(0);
    setSelectedAnswer(null);
    setIsAnswered(false);
    setFeedbackMsg('');
    setIsCorrect(false);
    setSaveResult(null);
    setIsSubmitting(false);
    completedRef.current = false;
    startTimeRef.current = Date.now();
    setGameState('playing');

    if (gameKey === 'sentence-factory' && qList.length > 0) {
      initSentenceFactory(qList[0]);
    }
  };

  useEffect(() => {
    if (gameState === 'playing' && gameKey === 'sentence-factory' && questions[currentIdx]) {
      initSentenceFactory(questions[currentIdx]);
    }
  }, [currentIdx, gameState]);

  const initSentenceFactory = (q) => {
    if (!q) return;
    setAssembledWords([]);
    setAvailableWords(shuffleArray(q.words));
  };

  // Trả lời câu hỏi thông thường
  const handleAnswerSelect = (ans) => {
    if (isAnswered) return;
    setSelectedAnswer(ans);
    setIsAnswered(true);

    const currentQ = questions[currentIdx];
    let correct = false;

    if (gameKey === 'fish-compare' || gameKey === 'train-numbers') {
      correct = String(ans) === String(currentQ.answer || currentQ.correctCount);
    } else {
      correct = String(ans) === String(currentQ.answer);
    }

    setIsCorrect(correct);

    if (correct) {
      triggerSound('correct');
      setScore((s) => s + 10);
      setCorrectCount((c) => c + 1);
      setFeedbackMsg('🎉 Giỏi lắm! Trả lời rất chính xác!');
    } else {
      triggerSound('wrong');
      setFeedbackMsg(`💡 Chưa đúng rồi! Đáp án đúng là: ${currentQ.answer || currentQ.correctCount}`);
    }
  };

  // Ghép câu cho Nhà Máy Câu Văn
  const handleWordClick = (word, indexInAvailable) => {
    if (isAnswered) return;
    triggerSound('click');
    setAssembledWords((prev) => [...prev, word]);
    setAvailableWords((prev) => prev.filter((_, idx) => idx !== indexInAvailable));
  };

  const handleRemoveWord = (word, indexInAssembled) => {
    if (isAnswered) return;
    triggerSound('click');
    setAssembledWords((prev) => prev.filter((_, idx) => idx !== indexInAssembled));
    setAvailableWords((prev) => [...prev, word]);
  };

  const checkSentenceAssembly = () => {
    if (isAnswered) return;
    setIsAnswered(true);
    const currentQ = questions[currentIdx];
    const userSentence = assembledWords.join(' ');
    const targetSentence = currentQ.correct.join(' ');
    const correct = userSentence === targetSentence;

    setIsCorrect(correct);

    if (correct) {
      triggerSound('correct');
      setScore((s) => s + 10);
      setCorrectCount((c) => c + 1);
      setFeedbackMsg('🎉 Tuyệt vời! Câu văn hoàn thành rất chuẩn xác!');
    } else {
      triggerSound('wrong');
      setFeedbackMsg(`💡 Câu đúng phải là: "${targetSentence}"`);
    }
  };

  // Chuyển sang câu tiếp theo
  const handleNextQuestion = () => {
    triggerSound('click');
    setSelectedAnswer(null);
    setIsAnswered(false);
    setFeedbackMsg('');
    setIsCorrect(false);

    if (currentIdx + 1 < questions.length) {
      setCurrentIdx((c) => c + 1);
    } else {
      finishGame();
    }
  };

  // Hoàn tất lượt chơi và gọi RPC lưu kết quả
  const finishGame = async () => {
    if (completedRef.current) return;
    completedRef.current = true;

    setGameState('saving');
    setIsSubmitting(true);

    const totalSec = Math.max(10, Math.floor((Date.now() - (startTimeRef.current || Date.now())) / 1000));
    const finalScore = Math.round((correctCount / Math.max(1, questions.length)) * 100);

    if (onComplete) {
      const res = await onComplete(finalScore, totalSec, assignmentId);
      setIsSubmitting(false);

      if (res && res.success) {
        setSaveResult(res);
        setGameState('result');
      } else {
        setSaveResult({
          success: false,
          message: res?.message || 'Không thể kết nối CSDL để lưu kết quả.'
        });
        setGameState('result');
      }
    } else {
      setIsSubmitting(false);
      setGameState('result');
    }
  };

  // Thử lưu kết quả lại khi bị lỗi mạng/RPC
  const handleRetrySave = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setSaveResult(null);

    const totalSec = Math.max(10, Math.floor((Date.now() - (startTimeRef.current || Date.now())) / 1000));
    const finalScore = Math.round((correctCount / Math.max(1, questions.length)) * 100);

    if (onComplete) {
      const res = await onComplete(finalScore, totalSec, assignmentId);
      setIsSubmitting(false);
      if (res && res.success) {
        setSaveResult(res);
      } else {
        setSaveResult({
          success: false,
          message: res?.message || 'Không thể kết nối CSDL để lưu kết quả.'
        });
      }
    } else {
      setIsSubmitting(false);
    }
  };

  // Xử lý khi chọn chơi lại
  const handleReplayClick = () => {
    if (saveResult && saveResult.success === false) {
      if (!window.confirm('Kết quả lượt chơi chưa được lưu vào CSDL. Thầy/Cô hoặc bé có chắc chắn muốn bỏ qua kết quả này để chơi lại không?')) {
        return;
      }
    }
    startNewGame();
  };

  const progressPercent = Math.min(100, Math.round(((currentIdx + (isAnswered ? 1 : 0)) / Math.max(1, questions.length)) * 100));

  // ==========================================================================
  // 1. MÀN HÌNH HƯỚNG DẪN BAN ĐẦU (START SCREEN)
  // ==========================================================================
  if (gameState === 'start') {
    return (
      <div className="w-full max-w-2xl mx-auto bg-white rounded-3xl border-4 border-amber-300 p-8 shadow-2xl text-center animate-fadeIn">
        <div className="w-20 h-20 bg-amber-100 rounded-3xl border-4 border-amber-300 flex items-center justify-center mx-auto mb-4 text-4xl shadow-inner">
          {gameKey === 'train-numbers' && '🚂'}
          {gameKey === 'bee-math' && '🐝'}
          {gameKey === 'fish-compare' && '🐟'}
          {gameKey === 'rhyme-garden' && '🌸'}
          {gameKey === 'squirrel-reading' && '🐿️'}
          {gameKey === 'speed-racing-100' && '🏎️'}
          {gameKey === 'multiplication-treasure' && '🏴‍☠️'}
          {gameKey === 'smart-clock' && '⏰'}
          {gameKey === 'sentence-factory' && '🏭'}
          {gameKey === 'jungle-discovery' && '🌳'}
        </div>

        <h2 className="text-2xl sm:text-3xl font-black text-amber-950 mb-2">
          {gameConfig.title}
        </h2>
        
        <div className="flex justify-center gap-2 mb-4">
          <span className="px-3 py-1 bg-amber-400 text-amber-950 font-black text-xs rounded-xl border border-amber-500">
            Khối {gameConfig.grade}
          </span>
          <span className="px-3 py-1 bg-sky-100 text-sky-900 font-black text-xs rounded-xl border border-sky-300">
            Môn {gameConfig.subject}
          </span>
        </div>

        <div className="bg-amber-50/80 p-5 rounded-2xl border-2 border-amber-200 mb-6 text-left">
          <h4 className="text-xs font-black text-amber-900 uppercase tracking-wider mb-1 flex items-center gap-1">
            <HelpCircle className="w-4 h-4 text-amber-600" /> Hướng Dẫn Cách Chơi:
          </h4>
          <p className="text-sm font-bold text-slate-700 leading-relaxed">
            {gameConfig.instruction}
          </p>
        </div>

        <button
          onClick={startNewGame}
          className="w-full py-4 bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-600 hover:to-green-600 text-white font-black text-base rounded-2xl border-b-4 border-emerald-700 shadow-xl flex items-center justify-center gap-2 active:translate-y-0.5 transition-all"
        >
          <Play className="w-5 h-5 fill-white" /> Bắt Đầu Chơi Ngay
        </button>
      </div>
    );
  }

  // ==========================================================================
  // 2. MÀN HÌNH ĐANG LƯU KẾT QUẢ (SAVING SCREEN)
  // ==========================================================================
  if (gameState === 'saving') {
    return (
      <div className="w-full max-w-md mx-auto bg-white rounded-3xl border-4 border-amber-300 p-8 shadow-2xl text-center animate-fadeIn">
        <Loader2 className="w-12 h-12 text-sky-600 animate-spin mx-auto mb-4" />
        <h3 className="text-xl font-black text-slate-800 mb-1">Đang Lưu Kết Quả Bài Làm...</h3>
        <p className="text-xs font-bold text-slate-500">
          Vui lòng đợi trong giây lát, hệ thống đang kết nối CSDL an toàn.
        </p>
      </div>
    );
  }

  // ==========================================================================
  // 3. MÀN HÌNH KẾT QUẢ (RESULT SCREEN)
  // ==========================================================================
  if (gameState === 'result') {
    const accuracy = Math.round((correctCount / Math.max(1, questions.length)) * 100);
    const isSaveSuccess = saveResult && saveResult.success === true;
    const isPreview = saveResult?.is_preview === true;
    const isAlreadyCompleted = saveResult?.already_completed === true;

    return (
      <div className="w-full max-w-xl mx-auto bg-gradient-to-b from-amber-400 to-yellow-500 text-amber-950 rounded-3xl border-4 border-amber-600 p-8 shadow-2xl text-center animate-fadeIn">
        <Trophy className="w-20 h-20 mx-auto mb-3 text-amber-900 animate-bounce" />
        <h2 className="text-3xl font-black mb-1">Hoàn Thành Tuyệt Vời!</h2>
        <p className="text-sm font-extrabold text-amber-900/80 mb-4">
          Bé đã hoàn tất thử thách: <span className="underline">{gameConfig.title}</span>
        </p>

        {/* CẢNH BÁO / THÔNG BÁO TRẠNG THÁI LƯU RPC */}
        {isPreview && (
          <div className="mb-4 p-3 bg-sky-100 border-2 border-sky-300 rounded-2xl text-sky-900 font-bold text-xs">
            💡 <strong>Chế độ xem thử:</strong> Thầy/Cô đang mở game ở quyền Quản trị/Giáo viên nên kết quả không tính điểm thưởng.
          </div>
        )}

        {isAlreadyCompleted && (
          <div className="mb-4 p-3 bg-amber-100 border-2 border-amber-400 rounded-2xl text-amber-950 font-bold text-xs">
            ℹ️ <strong>Đã hoàn thành trước đó:</strong> Bài giao này đã được ghi nhận hoàn thành trong CSDL.
          </div>
        )}

        {saveResult && saveResult.success === false && (
          <div className="mb-4 p-4 bg-rose-100 border-2 border-rose-400 rounded-2xl text-rose-950 font-bold text-xs text-left">
            <div className="flex items-center gap-2 mb-2 text-rose-700 font-black">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>Chưa thể lưu kết quả bài làm:</span>
            </div>
            <p className="mb-3 text-slate-700">{saveResult.message}</p>
            <button
              onClick={handleRetrySave}
              disabled={isSubmitting}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-black text-xs rounded-xl shadow flex items-center justify-center gap-1.5 active:scale-95 disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              {isSubmitting ? 'Đang Thử Lại...' : 'Thử Lưu Kết Quả Lại'}
            </button>
          </div>
        )}

        {/* THỐNG KÊ ĐIỂM VÀ SAO */}
        <div className="grid grid-cols-3 gap-3 mb-6 bg-white/90 p-4 rounded-2xl border-2 border-amber-600 shadow-inner">
          <div className="text-center">
            <p className="text-[11px] font-black text-slate-500">Số Câu Đúng</p>
            <p className="text-2xl font-black text-emerald-600">{correctCount} / {questions.length}</p>
          </div>
          <div className="text-center border-x-2 border-slate-200">
            <p className="text-[11px] font-black text-slate-500">Tỷ Lệ Đúng</p>
            <p className="text-2xl font-black text-sky-600">{accuracy}%</p>
          </div>
          <div className="text-center">
            <p className="text-[11px] font-black text-slate-500">Sao Thực Nhận</p>
            <p className="text-2xl font-black text-amber-500 flex items-center justify-center gap-1">
              +{isSaveSuccess ? (saveResult.stars_earned || 0) : 0} <Star className="w-5 h-5 fill-amber-500" />
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={handleReplayClick}
            className="flex-1 py-3 bg-slate-900 hover:bg-slate-950 text-white font-black text-sm rounded-2xl border-b-4 border-black shadow-md flex items-center justify-center gap-2 active:translate-y-0.5 transition-all"
          >
            <RotateCcw className="w-4 h-4" /> Chơi Lại Vòng Khác
          </button>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // 4. MÀN HÌNH CHƠI GAME ĐANG DIỄN RA (PLAYING SCREEN)
  // ==========================================================================
  const currentQ = questions[currentIdx];

  return (
    <div className="w-full max-w-3xl mx-auto bg-white rounded-3xl border-4 border-amber-300 p-4 sm:p-6 shadow-2xl">
      
      {/* HEADER GAME BAR: PROGRESS, SOUND TOGGLE */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b-2 border-amber-100">
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-amber-100 text-amber-900 font-extrabold text-xs rounded-xl border border-amber-300">
            Câu {currentIdx + 1} / {questions.length}
          </span>
          <span className="text-xs font-black text-sky-600">
            Đúng: {correctCount} câu
          </span>
        </div>

        <button
          onClick={toggleSound}
          aria-label={isMuted ? 'Bật âm thanh' : 'Tắt âm thanh'}
          className="p-2 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded-xl border border-amber-300 transition-colors"
          title={isMuted ? 'Bật âm thanh' : 'Tắt âm thanh'}
        >
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-emerald-600" />}
        </button>
      </div>

      {/* PROGRESS BAR */}
      <div className="w-full bg-amber-100 h-3 rounded-full overflow-hidden mb-6 border border-amber-300">
        <div 
          className="h-full bg-gradient-to-r from-amber-400 to-emerald-500 transition-all duration-300 rounded-full"
          style={{ width: `${progressPercent}%` }}
        ></div>
      </div>

      {/* ==================================================================== */}
      {/* CÁC ENGINE GAME RIÊNG BIỆT CHO 10 GAME HỌC TẬP                        */}
      {/* ==================================================================== */}

      {/* GAME 1: ĐOÀN TÀU SỐ HỌC (TRAIN NUMBERS) */}
      {gameKey === 'train-numbers' && (
        <div className="text-center">
          <h3 className="text-base sm:text-lg font-black text-slate-800 mb-3">
            {currentQ.prompt}
          </h3>

          {/* HÌNH ẢNH ĐỒ VẬT CẦN ĐẾM */}
          <div className="bg-amber-50 p-6 rounded-2xl border-2 border-amber-200 mb-6 flex flex-wrap items-center justify-center gap-3 min-h-[100px]">
            {currentQ.items && currentQ.items.length > 0 ? (
              currentQ.items.map((it, idx) => (
                <span key={idx} className="text-4xl">
                  {it}
                </span>
              ))
            ) : (
              <span className="text-slate-400 font-bold text-sm">Không có vật nào cả!</span>
            )}
          </div>

          {/* ĐOÀN TÀU CÁC TOA MANG SỐ */}
          <p className="text-xs font-black text-amber-900 mb-2">Chọn toa tàu mang số đúng:</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {currentQ.options.map((opt, idx) => {
              let btnStyle = 'bg-amber-400 hover:bg-amber-500 text-amber-950 border-amber-600';
              if (isAnswered) {
                if (opt === currentQ.correctCount) {
                  btnStyle = 'bg-emerald-500 text-white border-emerald-700';
                } else if (opt === selectedAnswer) {
                  btnStyle = 'bg-rose-500 text-white border-rose-700';
                } else {
                  btnStyle = 'bg-slate-200 text-slate-400 border-slate-300 opacity-60';
                }
              }

              return (
                <button
                  key={idx}
                  onClick={() => handleAnswerSelect(opt)}
                  disabled={isAnswered}
                  className={`p-4 rounded-2xl font-black text-2xl border-b-4 transition-all shadow-md active:translate-y-0.5 flex flex-col items-center justify-center ${btnStyle}`}
                >
                  <span className="text-xs font-bold opacity-80">Toa Số</span>
                  <span>🚂 {opt}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* GAME 2: ONG TÌM PHÉP TÍNH (BEE MATH) */}
      {gameKey === 'bee-math' && (
        <div className="text-center">
          <div className="bg-amber-50 p-4 rounded-2xl border-2 border-amber-200 mb-4 flex items-center justify-center gap-3">
            <span className="text-4xl">🐝</span>
            <h3 className="text-base sm:text-lg font-black text-slate-800">
              {currentQ.question}
            </h3>
          </div>

          <p className="text-xs font-black text-amber-900 mb-3">Chọn bông hoa chứa kết quả chuẩn xác:</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {currentQ.options.map((opt, idx) => {
              let btnStyle = 'bg-white hover:bg-amber-100 border-amber-300 text-slate-800';
              if (isAnswered) {
                if (opt === currentQ.answer) {
                  btnStyle = 'bg-emerald-500 text-white border-emerald-700';
                } else if (opt === selectedAnswer) {
                  btnStyle = 'bg-rose-500 text-white border-rose-700';
                } else {
                  btnStyle = 'bg-slate-100 text-slate-400 border-slate-200 opacity-60';
                }
              }

              return (
                <button
                  key={idx}
                  onClick={() => handleAnswerSelect(opt)}
                  disabled={isAnswered}
                  className={`p-4 rounded-2xl font-black text-xl border-3 transition-all shadow-sm flex flex-col items-center justify-center ${btnStyle}`}
                >
                  <span className="text-2xl mb-1">🌸</span>
                  <span>{opt}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* GAME 3: CÁ CON SO SÁNH SỐ (FISH COMPARE) */}
      {gameKey === 'fish-compare' && (
        <div className="text-center">
          <h3 className="text-base sm:text-lg font-black text-slate-800 mb-4">
            So sánh hai số sau đây:
          </h3>

          <div className="bg-sky-50 p-6 rounded-2xl border-2 border-sky-200 mb-6 flex items-center justify-center gap-6">
            <div className="w-20 h-20 bg-sky-200 text-sky-950 rounded-2xl border-4 border-sky-400 flex items-center justify-center font-black text-3xl shadow-md">
              {currentQ.num1}
            </div>
            <div className="w-16 h-16 bg-white text-amber-600 rounded-2xl border-4 border-amber-300 flex items-center justify-center font-black text-3xl shadow-inner">
              {isAnswered ? selectedAnswer || currentQ.answer : '?'}
            </div>
            <div className="w-20 h-20 bg-sky-200 text-sky-950 rounded-2xl border-4 border-sky-400 flex items-center justify-center font-black text-3xl shadow-md">
              {currentQ.num2}
            </div>
          </div>

          <p className="text-xs font-black text-sky-900 mb-3">Bong bóng dấu phù hợp:</p>
          <div className="flex justify-center gap-4 mb-6">
            {['>', '<', '='].map((sign) => {
              let btnStyle = 'bg-white hover:bg-sky-100 border-sky-300 text-sky-900';
              if (isAnswered) {
                if (sign === currentQ.answer) {
                  btnStyle = 'bg-emerald-500 text-white border-emerald-700';
                } else if (sign === selectedAnswer) {
                  btnStyle = 'bg-rose-500 text-white border-rose-700';
                } else {
                  btnStyle = 'bg-slate-100 text-slate-400 border-slate-200 opacity-60';
                }
              }

              return (
                <button
                  key={sign}
                  onClick={() => handleAnswerSelect(sign)}
                  disabled={isAnswered}
                  className={`w-20 h-20 rounded-full font-black text-3xl border-4 transition-all shadow-md flex items-center justify-center active:scale-95 ${btnStyle}`}
                >
                  {sign}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* GAME 4: KHU VƯỜN ÂM VẦN (RHYME GARDEN) */}
      {gameKey === 'rhyme-garden' && (
        <div className="text-center">
          <h3 className="text-base sm:text-lg font-black text-slate-800 mb-3">
            {currentQ.prompt}
          </h3>

          <div className="bg-emerald-50 p-6 rounded-2xl border-2 border-emerald-200 mb-6 flex items-center justify-center gap-4">
            <div className="px-5 py-3 bg-emerald-200 text-emerald-950 font-black text-2xl rounded-2xl border-2 border-emerald-400">
              {currentQ.consonant}
            </div>
            <span className="text-2xl font-black text-emerald-600">+</span>
            <div className="px-5 py-3 bg-emerald-200 text-emerald-950 font-black text-2xl rounded-2xl border-2 border-emerald-400">
              {currentQ.rhyme}
            </div>
            <span className="text-2xl font-black text-emerald-600">=</span>
            <div className="px-5 py-3 bg-white text-rose-600 font-black text-2xl rounded-2xl border-2 border-rose-300 min-w-[80px]">
              {isAnswered ? selectedAnswer || currentQ.answer : '?'}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {currentQ.options.map((opt, idx) => {
              let btnStyle = 'bg-white hover:bg-emerald-100 border-emerald-300 text-slate-800';
              if (isAnswered) {
                if (opt === currentQ.answer) {
                  btnStyle = 'bg-emerald-500 text-white border-emerald-700';
                } else if (opt === selectedAnswer) {
                  btnStyle = 'bg-rose-500 text-white border-rose-700';
                } else {
                  btnStyle = 'bg-slate-100 text-slate-400 border-slate-200 opacity-60';
                }
              }

              return (
                <button
                  key={idx}
                  onClick={() => handleAnswerSelect(opt)}
                  disabled={isAnswered}
                  className={`p-4 rounded-2xl font-black text-lg border-3 transition-all shadow-sm ${btnStyle}`}
                >
                  🌸 {opt}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* GAME 5: SÓC CON ĐỌC HIỂU (SQUIRREL READING) */}
      {gameKey === 'squirrel-reading' && (
        <div className="text-left">
          <div className="bg-amber-50 p-5 rounded-2xl border-2 border-amber-200 mb-4">
            <p className="text-xs font-black text-amber-900 uppercase mb-1 flex items-center gap-1">
              🐿️ Đọc văn bản ngắn:
            </p>
            <p className="text-sm sm:text-base font-bold text-slate-800 leading-relaxed italic">
              "{currentQ.passage}"
            </p>
          </div>

          <h3 className="text-base font-black text-slate-900 mb-3">
            ❓ {currentQ.question}
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            {currentQ.options.map((opt, idx) => {
              let btnStyle = 'bg-white hover:bg-amber-100 border-amber-300 text-slate-800';
              if (isAnswered) {
                if (opt === currentQ.answer) {
                  btnStyle = 'bg-emerald-500 text-white border-emerald-700';
                } else if (opt === selectedAnswer) {
                  btnStyle = 'bg-rose-500 text-white border-rose-700';
                } else {
                  btnStyle = 'bg-slate-100 text-slate-400 border-slate-200 opacity-60';
                }
              }

              return (
                <button
                  key={idx}
                  onClick={() => handleAnswerSelect(opt)}
                  disabled={isAnswered}
                  className={`p-3.5 rounded-2xl font-bold text-sm text-left border-3 transition-all shadow-sm flex items-center justify-between ${btnStyle}`}
                >
                  <span>{opt}</span>
                  {isAnswered && opt === currentQ.answer && <CheckCircle2 className="w-5 h-5 text-white" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* GAME 6: ĐƯỜNG ĐUA TRONG PHẠM VI 100 (SPEED RACING 100) */}
      {gameKey === 'speed-racing-100' && (
        <div className="text-center">
          {/* TRACK GRAPHIC */}
          <div className="mb-4 bg-slate-900 p-4 rounded-2xl border-4 border-amber-400 relative overflow-hidden shadow-inner">
            <div className="flex justify-between text-xs font-black text-amber-300 mb-2 uppercase">
              <span>🏁 Vạch Xuất Phát</span>
              <span>🏎️ Đua Tốc Độ</span>
              <span>🏆 Đích Đến</span>
            </div>
            <div className="relative w-full h-12 bg-slate-800 rounded-xl border-2 border-slate-700 flex items-center px-2">
              <div className="absolute top-1/2 left-0 right-0 border-t-2 border-dashed border-slate-600"></div>
              <div 
                className="absolute transition-all duration-500 ease-out text-3xl"
                style={{ left: `calc(${progressPercent}% - 24px)` }}
              >
                🏎️
              </div>
            </div>
          </div>

          <h3 className="text-xl font-black text-slate-800 mb-4">
            {currentQ.question}
          </h3>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {currentQ.options.map((opt, idx) => {
              let btnStyle = 'bg-white hover:bg-amber-100 border-amber-300 text-slate-800';
              if (isAnswered) {
                if (opt === currentQ.answer) {
                  btnStyle = 'bg-emerald-500 text-white border-emerald-700';
                } else if (opt === selectedAnswer) {
                  btnStyle = 'bg-rose-500 text-white border-rose-700';
                } else {
                  btnStyle = 'bg-slate-100 text-slate-400 border-slate-200 opacity-60';
                }
              }

              return (
                <button
                  key={idx}
                  onClick={() => handleAnswerSelect(opt)}
                  disabled={isAnswered}
                  className={`p-4 rounded-2xl font-black text-xl border-3 transition-all shadow-sm ${btnStyle}`}
                >
                  ⚡ {opt}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* GAME 7: THÁM HIỂM BẢNG NHÂN (MULTIPLICATION TREASURE) */}
      {gameKey === 'multiplication-treasure' && (
        <div className="text-center">
          <div className="bg-amber-50 p-4 rounded-2xl border-2 border-amber-200 mb-4 flex items-center justify-center gap-3">
            <span className="text-4xl">🏴‍☠️</span>
            <h3 className="text-lg font-black text-slate-800">
              {currentQ.question}
            </h3>
          </div>

          <p className="text-xs font-black text-amber-900 mb-3">Mở rương chứa chìa khóa đúng:</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {currentQ.options.map((opt, idx) => {
              let btnStyle = 'bg-white hover:bg-amber-100 border-amber-300 text-slate-800';
              if (isAnswered) {
                if (opt === currentQ.answer) {
                  btnStyle = 'bg-emerald-500 text-white border-emerald-700';
                } else if (opt === selectedAnswer) {
                  btnStyle = 'bg-rose-500 text-white border-rose-700';
                } else {
                  btnStyle = 'bg-slate-100 text-slate-400 border-slate-200 opacity-60';
                }
              }

              return (
                <button
                  key={idx}
                  onClick={() => handleAnswerSelect(opt)}
                  disabled={isAnswered}
                  className={`p-4 rounded-2xl font-black text-xl border-3 transition-all shadow-sm flex flex-col items-center justify-center ${btnStyle}`}
                >
                  <span className="text-2xl mb-1">👑</span>
                  <span>{opt}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* GAME 8: ĐỒNG HỒ THÔNG MINH (SMART CLOCK - DYNAMIC HTML/CSS ANALOG CLOCK FACE - NO SVG) */}
      {gameKey === 'smart-clock' && (
        <div className="text-center">
          <h3 className="text-base sm:text-lg font-black text-slate-800 mb-3">
            Quan sát mặt đồng hồ kim và chọn thời gian đúng:
          </h3>

          {/* DYNAMIC HTML/CSS ANALOG CLOCK FACE (BẰNG HTML/CSS NGUYÊN KHỐI, KHÔNG DÙNG THẺ SVG) */}
          <div className="flex justify-center mb-6">
            <div className="relative w-48 h-48 bg-amber-50 rounded-full border-8 border-amber-400 shadow-xl flex items-center justify-center">
              {/* CÁC CON SỐ TRÊN MẶT ĐỒNG HỒ 1-12 */}
              {[12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((num, i) => {
                const angle = i * 30;
                return (
                  <span
                    key={num}
                    className="absolute font-black text-amber-950 text-sm select-none"
                    style={{
                      transform: `rotate(${angle}deg) translateY(-72px) rotate(-${angle}deg)`
                    }}
                  >
                    {num}
                  </span>
                );
              })}

              {/* KIM GIỜ (SLATE COLOR) */}
              <div
                className="absolute top-1/2 left-1/2 w-1.5 h-14 bg-slate-900 rounded-full origin-bottom shadow-md"
                style={{
                  transform: `translate(-50%, -100%) rotate(${((currentQ.hour % 12) + currentQ.minute / 60) * 30}deg)`
                }}
              />

              {/* KIM PHÚT (ROSE RED COLOR) */}
              <div
                className="absolute top-1/2 left-1/2 w-1 h-20 bg-rose-600 rounded-full origin-bottom shadow-md"
                style={{
                  transform: `translate(-50%, -100%) rotate(${currentQ.minute * 6}deg)`
                }}
              />

              {/* CHỐT GIỮA MẶT ĐỒNG HỒ */}
              <div className="w-4 h-4 bg-amber-500 rounded-full z-10 border-2 border-amber-700 shadow-sm" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-6">
            {currentQ.options.map((opt, idx) => {
              let btnStyle = 'bg-white hover:bg-amber-100 border-amber-300 text-slate-800';
              if (isAnswered) {
                if (opt === currentQ.answer) {
                  btnStyle = 'bg-emerald-500 text-white border-emerald-700';
                } else if (opt === selectedAnswer) {
                  btnStyle = 'bg-rose-500 text-white border-rose-700';
                } else {
                  btnStyle = 'bg-slate-100 text-slate-400 border-slate-200 opacity-60';
                }
              }

              return (
                <button
                  key={idx}
                  onClick={() => handleAnswerSelect(opt)}
                  disabled={isAnswered}
                  className={`p-3.5 rounded-2xl font-black text-sm sm:text-base border-3 transition-all shadow-sm ${btnStyle}`}
                >
                  ⏰ {opt}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* GAME 9: NHÀ MÁY CÂU VĂN (SENTENCE FACTORY) */}
      {gameKey === 'sentence-factory' && (
        <div className="text-center">
          <h3 className="text-base sm:text-lg font-black text-slate-800 mb-3">
            Bấm các từ theo thứ tự để ghép thành câu hoàn chỉnh:
          </h3>

          {/* VÙNG CÂU ĐÃ GHÉP */}
          <div className="bg-amber-50 p-4 rounded-2xl border-2 border-amber-200 mb-4 min-h-[70px] flex flex-wrap items-center justify-center gap-2">
            {assembledWords.length > 0 ? (
              assembledWords.map((w, idx) => (
                <button
                  key={idx}
                  onClick={() => handleRemoveWord(w, idx)}
                  disabled={isAnswered}
                  className="px-3.5 py-2 bg-sky-500 text-white font-black text-sm rounded-xl border-b-2 border-sky-700 shadow-sm animate-fadeIn"
                >
                  {w} ✕
                </button>
              ))
            ) : (
              <span className="text-slate-400 font-bold text-xs">Chạm vào các từ bên dưới để ghép câu...</span>
            )}
          </div>

          {/* VÙNG TỪ CÒN LẠI */}
          <div className="flex flex-wrap justify-center gap-2 mb-6 min-h-[60px]">
            {availableWords.map((w, idx) => (
              <button
                key={idx}
                onClick={() => handleWordClick(w, idx)}
                disabled={isAnswered}
                className="px-4 py-2.5 bg-white hover:bg-amber-100 text-amber-950 font-black text-sm rounded-xl border-2 border-amber-300 shadow-sm active:scale-95 transition-all"
              >
                {w}
              </button>
            ))}
          </div>

          {!isAnswered && (
            <button
              onClick={checkSentenceAssembly}
              disabled={assembledWords.length === 0}
              className="px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-sm rounded-2xl border-b-4 border-emerald-700 shadow-md active:translate-y-0.5 transition-all disabled:opacity-50"
            >
              Kiểm Tra Câu Văn 🏭
            </button>
          )}
        </div>
      )}

      {/* GAME 10: RỪNG XANH KỲ THÚ (JUNGLE DISCOVERY) */}
      {gameKey === 'jungle-discovery' && (
        <div className="text-center">
          <div className="bg-emerald-50 p-5 rounded-2xl border-2 border-emerald-200 mb-4 flex items-center justify-center gap-3">
            <span className="text-4xl">🌳</span>
            <div>
              <span className="px-3 py-1 bg-emerald-200 text-emerald-950 font-black text-xs rounded-xl border border-emerald-300 mb-1 inline-block">
                {currentQ.item}
              </span>
              <h3 className="text-base sm:text-lg font-black text-slate-800">
                {currentQ.prompt}
              </h3>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            {currentQ.options.map((opt, idx) => {
              let btnStyle = 'bg-white hover:bg-emerald-100 border-emerald-300 text-slate-800';
              if (isAnswered) {
                if (opt === currentQ.answer) {
                  btnStyle = 'bg-emerald-500 text-white border-emerald-700';
                } else if (opt === selectedAnswer) {
                  btnStyle = 'bg-rose-500 text-white border-rose-700';
                } else {
                  btnStyle = 'bg-slate-100 text-slate-400 border-slate-200 opacity-60';
                }
              }

              return (
                <button
                  key={idx}
                  onClick={() => handleAnswerSelect(opt)}
                  disabled={isAnswered}
                  className={`p-4 rounded-2xl font-bold text-sm border-3 transition-all shadow-sm ${btnStyle}`}
                >
                  🍃 {opt}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* KHU VỰC PHẢN HỒI NÚT TIẾP THEO                                      */}
      {/* ==================================================================== */}
      {isAnswered && (
        <div className="mt-6 pt-4 border-t-2 border-amber-100 flex flex-col sm:flex-row items-center justify-between gap-3 animate-fadeIn">
          <div className={`p-3 rounded-xl font-extrabold text-xs flex items-center gap-2 w-full sm:w-auto ${isCorrect ? 'bg-emerald-50 text-emerald-800 border border-emerald-300' : 'bg-rose-50 text-rose-800 border border-rose-300'}`}>
            {isCorrect ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <XCircle className="w-4 h-4 text-rose-600 shrink-0" />}
            <span>{feedbackMsg}</span>
          </div>

          <button
            onClick={handleNextQuestion}
            className="w-full sm:w-auto px-6 py-3 bg-sky-500 hover:bg-sky-600 text-white font-black text-sm rounded-2xl border-b-4 border-sky-700 shadow-md flex items-center justify-center gap-2 active:translate-y-0.5 transition-all shrink-0"
          >
            <span>Câu Tiếp Theo</span> <MoveRight className="w-4 h-4" />
          </button>
        </div>
      )}

    </div>
  );
};
