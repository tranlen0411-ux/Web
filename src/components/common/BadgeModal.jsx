import React, { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { Award, Sparkles, X } from 'lucide-react';
import { useSound } from '../../context/SoundContext';

export const BadgeModal = ({ isOpen, onClose, badge = null, starsEarned = 0 }) => {
  const { triggerSound } = useSound();

  useEffect(() => {
    if (isOpen) {
      triggerSound('victory');
      
      // Bắn pháo hoa ăn mừng Confetti
      try {
        confetti({
          particleCount: 120,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#0284c7', '#f59e0b', '#10b981', '#f43f5e', '#a855f7']
        });
      } catch (err) {
        console.log('Confetti error:', err);
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-md bg-gradient-to-b from-amber-50 to-orange-100 rounded-3xl border-4 border-amber-300 p-6 shadow-2xl text-center flex flex-col items-center">
        
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 bg-white/80 rounded-full hover:bg-white text-slate-500 hover:text-slate-700 shadow-sm"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="w-24 h-24 bg-gradient-to-tr from-amber-400 to-yellow-300 rounded-full border-4 border-white shadow-lg flex items-center justify-center mb-3 animate-bounce">
          {badge?.icon_url ? (
            <span className="text-5xl">{badge.icon_url}</span>
          ) : (
            <Award className="w-12 h-12 text-amber-900" />
          )}
        </div>

        <span className="inline-flex items-center gap-1 px-3 py-1 bg-amber-200 text-amber-900 font-extrabold text-xs rounded-full border border-amber-300 mb-2 uppercase tracking-wide">
          <Sparkles className="w-3.5 h-3.5" /> Chúc Mừng Bé Xuất Sắc!
        </span>

        <h3 className="text-2xl font-black text-amber-900 mb-1">
          {badge?.title || 'Hoàn Thành Bài Tập!'}
        </h3>

        <p className="text-sm text-amber-800 font-medium mb-4 px-2">
          {badge?.description || `Bé đã tích lũy thêm +${starsEarned} Sao thưởng vào Góc Học Tập!`}
        </p>

        {starsEarned > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-200/80 rounded-2xl border-2 border-amber-300 mb-5">
            <span className="text-2xl">🌟</span>
            <span className="text-lg font-black text-amber-900">+{starsEarned} Sao Thưởng</span>
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full py-3 px-6 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-white font-black text-lg rounded-2xl shadow-lg border-b-4 border-amber-700 active:translate-y-0.5 transition-all"
        >
          Tuyệt Vời! Tiếp Tục Chơi 🚀
        </button>
      </div>
    </div>
  );
};
