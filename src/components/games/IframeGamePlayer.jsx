import React, { useState } from 'react';
import { ExternalLink, CheckCircle2, Sparkles, AlertCircle } from 'lucide-react';
import { useSound } from '../../context/SoundContext';

export const IframeGamePlayer = ({ game, onComplete }) => {
  const { triggerSound } = useSound();
  const [hasClaimed, setHasClaimed] = useState(false);

  const handleClaimReward = () => {
    if (hasClaimed) return;
    triggerSound('victory');
    setHasClaimed(true);
    if (onComplete) {
      onComplete(15, 120);
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col items-center">
      
      {/* FRAME CHƠI GAME */}
      <div className="w-full bg-slate-900 rounded-3xl border-4 border-amber-300 overflow-hidden shadow-2xl relative mb-4">
        
        {/* TOP BAR IFRAME */}
        <div className="bg-slate-800 px-4 py-2.5 flex items-center justify-between border-b border-slate-700">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-rose-500"></span>
            <span className="w-3 h-3 rounded-full bg-amber-500"></span>
            <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
            <span className="text-xs font-bold text-slate-300 ml-2 truncate max-w-xs">{game.title}</span>
          </div>

          <a
            href={game.game_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-bold text-amber-400 hover:text-amber-300 flex items-center gap-1 bg-slate-700 px-3 py-1 rounded-lg border border-slate-600 transition-colors"
          >
            Mở Trang Gốc <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        {/* CONTAINER IFRAME EMBED */}
        <div className="relative w-full h-[550px] bg-slate-950 flex items-center justify-center">
          <iframe
            src={game.game_url}
            title={game.title}
            className="w-full h-full border-0"
            allow="fullscreen; autoplay"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          ></iframe>
        </div>
      </div>

      {/* FOOTER NÚT BÁO HOÀN THÀNH */}
      <div className="bg-amber-100 border-2 border-amber-300 p-4 rounded-2xl w-full max-w-xl text-center flex flex-col items-center">
        <p className="text-xs font-extrabold text-amber-900 mb-2 flex items-center gap-1">
          <AlertCircle className="w-4 h-4 text-amber-600" /> Sau khi chơi xong trên màn hình, bé nhớ bấm nút bên dưới để nhận Sao Thưởng nhé!
        </p>

        <button
          onClick={handleClaimReward}
          disabled={hasClaimed}
          className={`px-6 py-3 rounded-2xl font-black text-sm border-b-4 shadow-lg flex items-center gap-2 transition-all ${
            hasClaimed
              ? 'bg-emerald-500 text-white border-emerald-700 opacity-90'
              : 'bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-white border-amber-700 active:translate-y-0.5'
          }`}
        >
          {hasClaimed ? (
            <>
              <CheckCircle2 className="w-5 h-5 text-white" /> Bé Đã Nhận +15 Sao Thưởng! 🎉
            </>
          ) : (
            <>
              <Sparkles className="w-5 h-5 text-yellow-200 animate-spin" /> Em Đã Hoàn Thành Bài Game & Nhận Sao 🌟
            </>
          )}
        </button>
      </div>

    </div>
  );
};
