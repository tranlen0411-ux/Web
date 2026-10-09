import React from 'react';
import { Trophy, Medal } from 'lucide-react';

export function SpectatorFinishedView({ leaderboard = [] }) {
  const safeLeaderboard = Array.isArray(leaderboard) ? leaderboard : [];
  const rank1Winners = safeLeaderboard.filter((p) => p.rank === 1);
  const rank2Winners = safeLeaderboard.filter((p) => p.rank === 2);
  const rank3Winners = safeLeaderboard.filter((p) => p.rank === 3);

  return (
    <div className="w-full max-w-6xl mx-auto space-y-8 text-center animate-fade-in">
      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black text-sm sm:text-base uppercase tracking-wider shadow-lg shadow-amber-500/20">
          <Trophy className="w-5 h-5" />
          KẾT QUẢ CHUNG CUỘC
        </div>
        <h2 className="text-3xl sm:text-6xl font-black text-white tracking-tight">
          Vinh Danh Nhà Vô Địch
        </h2>
        <p className="text-base sm:text-lg text-slate-400">
          Trận đấu đã chính thức khép lại. Chúc mừng tất cả các thí sinh!
        </p>
      </div>

      {/* Grand Podium Presentation (Handles Ties for Rank 1/2/3 safely) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 items-end pt-8 max-w-4xl mx-auto">
        {/* Rank 2 Podium Block */}
        <div className="order-2 sm:order-1 bg-gradient-to-b from-slate-800 to-slate-900 border-2 border-slate-400 rounded-3xl p-6 text-center space-y-3 shadow-xl">
          <div className="w-14 h-14 rounded-2xl bg-slate-300 text-slate-950 font-black text-2xl flex items-center justify-center mx-auto shadow-md">
            🥈
          </div>
          <span className="text-xs font-black uppercase tracking-widest text-slate-400 block">HẠNG NHÌ</span>
          {rank2Winners.map((winner) => (
            <div key={winner.participant_id} className="space-y-1">
              <h3 className="text-xl font-black text-white truncate">{winner.display_name}</h3>
              <div className="text-2xl font-black text-slate-300 font-mono">{winner.total_score} đ</div>
            </div>
          ))}
          {rank2Winners.length === 0 && (
            <div className="text-slate-500 text-sm italic">Không có</div>
          )}
        </div>

        {/* Rank 1 Podium Block (Center, Highest) */}
        <div className="order-1 sm:order-2 bg-gradient-to-b from-amber-900/90 to-slate-900 border-4 border-amber-400 rounded-3xl p-8 text-center space-y-4 shadow-2xl shadow-amber-500/30 transform sm:-translate-y-8">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-amber-300 via-amber-400 to-amber-600 text-slate-950 font-black text-4xl flex items-center justify-center mx-auto shadow-xl shadow-amber-500/40 animate-pulse">
            👑
          </div>
          <span className="text-sm font-black uppercase tracking-widest text-amber-400 block">QUÁN QUÂN</span>
          {rank1Winners.map((winner) => (
            <div key={winner.participant_id} className="space-y-1">
              <h3 className="text-2xl sm:text-3xl font-black text-amber-300 truncate">{winner.display_name}</h3>
              <div className="text-4xl font-black text-amber-400 font-mono">{winner.total_score} đ</div>
            </div>
          ))}
        </div>

        {/* Rank 3 Podium Block */}
        <div className="order-3 sm:order-3 bg-gradient-to-b from-slate-800 to-slate-900 border-2 border-amber-700 rounded-3xl p-6 text-center space-y-3 shadow-xl">
          <div className="w-14 h-14 rounded-2xl bg-amber-700 text-amber-100 font-black text-2xl flex items-center justify-center mx-auto shadow-md">
            🥉
          </div>
          <span className="text-xs font-black uppercase tracking-widest text-amber-600 block">HẠNG BA</span>
          {rank3Winners.map((winner) => (
            <div key={winner.participant_id} className="space-y-1">
              <h3 className="text-xl font-black text-white truncate">{winner.display_name}</h3>
              <div className="text-2xl font-black text-amber-500 font-mono">{winner.total_score} đ</div>
            </div>
          ))}
          {rank3Winners.length === 0 && (
            <div className="text-slate-500 text-sm italic">Không có</div>
          )}
        </div>
      </div>

      {/* Bottom Leaderboard Summary List */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 max-w-4xl mx-auto text-left shadow-xl">
        <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Medal className="w-4 h-4 text-amber-400" />
          Bảng Điểm Tổng Hợp Cuối Cùng
        </h4>
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {safeLeaderboard.map((row) => (
            <div
              key={row.participant_id}
              className="flex items-center justify-between p-3 rounded-xl bg-slate-800/60 border border-slate-700/60"
            >
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-lg bg-slate-700 font-mono font-bold text-xs flex items-center justify-center text-slate-200">
                  #{row.rank}
                </span>
                <span className="font-bold text-slate-100">{row.display_name}</span>
              </div>
              <div className="font-mono font-black text-amber-400 text-base">
                {row.total_score} đ
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
