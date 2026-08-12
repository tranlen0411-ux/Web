import React from 'react';
import { Play, Sparkles, Trophy, Users, BookOpen } from 'lucide-react';
import { useSound } from '../../context/SoundContext';

export const GameCard = ({ game, onPlay }) => {
  const { triggerSound } = useSound();

  const handlePlayClick = () => {
    triggerSound('click');
    onPlay(game);
  };

  const getSubjectColor = (subject) => {
    switch (subject) {
      case 'Toán': return 'bg-sky-100 text-sky-800 border-sky-300';
      case 'Tiếng Việt': return 'bg-rose-100 text-rose-800 border-rose-300';
      case 'Tiếng Anh': return 'bg-purple-100 text-purple-800 border-purple-300';
      case 'Tự nhiên & Xã hội': return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      default: return 'bg-amber-100 text-amber-800 border-amber-300';
    }
  };

  return (
    <div className="group relative bg-white rounded-3xl border-4 border-amber-200 hover:border-amber-400 p-4 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col justify-between hover:-translate-y-1">
      
      {/* THUMBNAIL HÌNH ẢNH */}
      <div>
        <div className="relative w-full h-44 rounded-2xl overflow-hidden border-2 border-amber-100 mb-3 bg-amber-50">
          <img
            src={game.thumbnail_url || 'https://images.unsplash.com/photo-1606326608606-aa0b62935f2b?w=500&auto=format&fit=crop&q=60'}
            alt={game.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
          
          {/* BADGE KHỐI LỚP & LOẠI GAME */}
          <div className="absolute top-2 left-2 flex gap-1.5 flex-wrap">
            <span className="px-2.5 py-1 bg-amber-400 text-amber-950 text-xs font-black rounded-xl border border-amber-500 shadow-sm">
              Khối {game.grade_level}
            </span>
            <span className={`px-2.5 py-1 text-xs font-black rounded-xl border shadow-sm ${getSubjectColor(game.subject)}`}>
              {game.subject}
            </span>
          </div>

          <div className="absolute bottom-2 right-2 bg-slate-900/70 text-white text-[10px] font-bold px-2 py-0.5 rounded-lg flex items-center gap-1 backdrop-blur-sm">
            <Users className="w-3 h-3 text-amber-300" /> {game.play_count || 0} lượt chơi
          </div>
        </div>

        {/* TIÊU ĐỀ & MÔ TẢ */}
        <h3 className="text-lg font-black text-slate-800 line-clamp-1 group-hover:text-amber-600 transition-colors">
          {game.title}
        </h3>
        <p className="text-xs font-semibold text-slate-500 line-clamp-2 mt-1 mb-4">
          {game.description || 'Trò chơi tương tác rèn luyện kiến thức vui vẻ sinh động.'}
        </p>
      </div>

      {/* FOOTER NÚT CHƠI */}
      <div className="pt-2 border-t-2 border-slate-100 flex items-center justify-between">
        <span className="text-xs font-black text-amber-600 flex items-center gap-1">
          <Sparkles className="w-3.5 h-3.5" /> +10 Sao Thưởng
        </span>

        <button
          onClick={handlePlayClick}
          className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-600 hover:to-green-600 text-white font-black text-xs rounded-xl shadow-md border-b-2 border-emerald-700 flex items-center gap-1.5 active:translate-y-0.5 transition-all"
        >
          <Play className="w-3.5 h-3.5 fill-white" /> Chơi Ngay
        </button>
      </div>

    </div>
  );
};
