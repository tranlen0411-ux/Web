import React, { useState, useEffect } from 'react';
import { RotateCcw, Sparkles, Timer, Trophy, CheckCircle2 } from 'lucide-react';
import { useSound } from '../../context/SoundContext';

const CARD_DATA_SETS = [
  // Bộ 1: Toán học tiểu học
  [
    { id: 1, content: '2 + 3', matchId: 1, type: 'text' },
    { id: 2, content: '5', matchId: 1, type: 'text' },
    { id: 3, content: '4 × 2', matchId: 2, type: 'text' },
    { id: 4, content: '8', matchId: 2, type: 'text' },
    { id: 5, content: '10 - 4', matchId: 3, type: 'text' },
    { id: 6, content: '6', matchId: 3, type: 'text' },
    { id: 7, content: '9 ÷ 3', matchId: 4, type: 'text' },
    { id: 8, content: '3', matchId: 4, type: 'text' },
  ],
  // Bộ 2: Từ vựng Tiếng Anh
  [
    { id: 1, content: '🐱 Cat', matchId: 1, type: 'text' },
    { id: 2, content: 'Con Mèo', matchId: 1, type: 'text' },
    { id: 3, content: '🐶 Dog', matchId: 2, type: 'text' },
    { id: 4, content: 'Con Chó', matchId: 2, type: 'text' },
    { id: 5, content: '🍎 Apple', matchId: 3, type: 'text' },
    { id: 6, content: 'Quả Táo', matchId: 3, type: 'text' },
    { id: 7, content: '☀️ Sun', matchId: 4, type: 'text' },
    { id: 8, content: 'Mặt Trời', matchId: 4, type: 'text' },
  ]
];

export const MemoryGame = ({ onComplete }) => {
  const { triggerSound } = useSound();
  const [cards, setCards] = useState([]);
  const [flippedCards, setFlippedCards] = useState([]);
  const [matchedPairs, setMatchedPairs] = useState([]);
  const [moves, setMoves] = useState(0);
  const [timer, setTimer] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFinished, setIsFinished] = useState(false);

  // Tráo bài ngẫu nhiên
  const shuffleCards = () => {
    const randomDataset = CARD_DATA_SETS[Math.floor(Math.random() * CARD_DATA_SETS.length)];
    const shuffled = [...randomDataset]
      .sort(() => Math.random() - 0.5)
      .map((card, index) => ({ ...card, uniqueKey: index }));

    setCards(shuffled);
    setFlippedCards([]);
    setMatchedPairs([]);
    setMoves(0);
    setTimer(0);
    setIsPlaying(true);
    setIsFinished(false);
  };

  useEffect(() => {
    shuffleCards();
  }, []);

  // Bộ đếm thời gian
  useEffect(() => {
    let interval = null;
    if (isPlaying && !isFinished) {
      interval = setInterval(() => {
        setTimer((prev) => prev + 1);
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isPlaying, isFinished]);

  // Xử lý khi click vào thẻ
  const handleCardClick = (index) => {
    if (flippedCards.length === 2 || flippedCards.includes(index) || matchedPairs.includes(cards[index].matchId)) {
      return;
    }

    triggerSound('flip');
    const newFlipped = [...flippedCards, index];
    setFlippedCards(newFlipped);

    // Kiểm tra khi mở đủ 2 thẻ
    if (newFlipped.length === 2) {
      setMoves((m) => m + 1);
      const firstCard = cards[newFlipped[0]];
      const secondCard = cards[newFlipped[1]];

      if (firstCard.matchId === secondCard.matchId) {
        // Đúng cặp
        setTimeout(() => {
          triggerSound('correct');
          const newMatched = [...matchedPairs, firstCard.matchId];
          setMatchedPairs(newMatched);
          setFlippedCards([]);

          // Kiểm tra hoàn thành tất cả
          if (newMatched.length === cards.length / 2) {
            setIsFinished(true);
            setIsPlaying(false);
            const stars = Math.max(10, 20 - Math.floor(moves / 2));
            if (onComplete) onComplete(stars, timer);
          }
        }, 500);
      } else {
        // Sai cặp -> Đóng thẻ lại
        setTimeout(() => {
          triggerSound('wrong');
          setFlippedCards([]);
        }, 1000);
      }
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto bg-white rounded-3xl border-4 border-amber-300 p-6 shadow-xl text-center">
      
      {/* HEADER BẢNG ĐIỂM & BỘ ĐẾM */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 bg-amber-50 p-4 rounded-2xl border-2 border-amber-200">
        <div className="flex items-center gap-2 font-black text-amber-900">
          <Timer className="w-5 h-5 text-amber-600 animate-pulse" />
          <span>Thời gian: <span className="text-amber-600">{timer}s</span></span>
        </div>

        <div className="flex items-center gap-2 font-black text-amber-900">
          <Sparkles className="w-5 h-5 text-amber-500" />
          <span>Lượt mở: <span className="text-sky-600">{moves}</span></span>
        </div>

        <button
          onClick={shuffleCards}
          className="px-3.5 py-1.5 bg-amber-200 hover:bg-amber-300 text-amber-900 font-extrabold text-xs rounded-xl border border-amber-400 flex items-center gap-1 transition-all"
        >
          <RotateCcw className="w-4 h-4" /> Chơi Lại
        </button>
      </div>

      {/* LƯỚI THẺ BÀI LẬT */}
      <div className="grid grid-cols-4 gap-3 sm:gap-4 mb-6">
        {cards.map((card, idx) => {
          const isFlipped = flippedCards.includes(idx) || matchedPairs.includes(card.matchId);
          const isMatched = matchedPairs.includes(card.matchId);

          return (
            <button
              key={idx}
              onClick={() => handleCardClick(idx)}
              disabled={isFlipped}
              className={`h-24 sm:h-28 rounded-2xl font-black text-lg sm:text-xl transition-all duration-300 transform flex flex-col items-center justify-center border-4 shadow-md ${
                isFlipped
                  ? isMatched
                    ? 'bg-emerald-100 border-emerald-400 text-emerald-900 scale-95'
                    : 'bg-amber-100 border-amber-400 text-amber-900 rotate-y-180'
                  : 'bg-gradient-to-tr from-sky-400 to-sky-500 border-sky-600 hover:bg-sky-400 active:scale-95 text-white'
              }`}
            >
              {isFlipped ? (
                <span className="animate-fadeIn">{card.content}</span>
              ) : (
                <span className="text-2xl">❓</span>
              )}
            </button>
          );
        })}
      </div>

      {/* THÔNG BÁO HOÀN THÀNH */}
      {isFinished && (
        <div className="bg-gradient-to-r from-emerald-400 to-green-500 text-white p-4 rounded-2xl border-4 border-emerald-600 shadow-lg animate-bounce">
          <h4 className="text-xl font-black flex items-center justify-center gap-2">
            <CheckCircle2 className="w-6 h-6" /> Xuất Sắc! Bé Đã Thắng Game Lật Thẻ!
          </h4>
          <p className="text-xs font-bold mt-1">Bé hoàn thành trong {timer} giây với {moves} lượt mở.</p>
        </div>
      )}

    </div>
  );
};
