import React from 'react';
import { Trophy } from 'lucide-react';

export function SpectatorLeaderboardView({ leaderboard = [] }) {
  const safeLeaderboard = Array.isArray(leaderboard) ? leaderboard : [];
  const rank1 = safeLeaderboard.filter((p) => Number(p.rank) === 1);
  const rank2 = safeLeaderboard.filter((p) => Number(p.rank) === 2);
  const rank3 = safeLeaderboard.filter((p) => Number(p.rank) === 3);

  const hasPodium = rank1.length > 0 || rank2.length > 0 || rank3.length > 0;

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6 sm:space-y-8 animate-fade-in">
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs sm:text-sm font-black uppercase tracking-wider">
          <Trophy className="w-4 h-4 text-amber-400" />
          BẢNG XẾP HẠNG TRỰC TIẾP
        </div>
        <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight">
          Top Thí Sinh Dẫn Đầu
        </h2>
      </div>

      {/* Top 3 Podium Highlights (Tie-Safe & Preserves Authoritative Gaps) */}
      {hasPodium && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 pt-4">
          {/* Silver - Rank 2 */}
          {rank2.length > 0 && (
            <div className="order-2 sm:order-1 bg-slate-900/80 border-2 border-slate-400/50 rounded-3xl p-6 text-center space-y-4 shadow-xl">
              <div className="w-12 h-12 rounded-2xl bg-slate-300 text-slate-950 font-black text-xl flex items-center justify-center mx-auto shadow-md">
                #2
              </div>
              <div className="space-y-3">
                {rank2.map((p, idx) => (
                  <div key={p.participant_id || idx} className="space-y-1">
                    <h4 className="text-xl font-black text-white truncate">
                      {p.display_name}
                    </h4>
                    <div className="text-2xl font-black text-slate-300 font-mono">
                      {p.total_score ?? 0} đ
                    </div>
                    <div className="text-xs text-slate-400">
                      Đúng {p.correct_count ?? 0} câu
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Gold - Rank 1 (Tallest / Center) */}
          {rank1.length > 0 && (
            <div className="order-1 sm:order-2 bg-gradient-to-b from-amber-950/80 to-slate-900/90 border-2 border-amber-400 rounded-3xl p-6 sm:p-8 text-center space-y-4 shadow-2xl shadow-amber-500/20 transform sm:-translate-y-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-300 to-amber-500 text-slate-950 font-black text-3xl flex items-center justify-center mx-auto shadow-lg shadow-amber-500/30">
                👑 1
              </div>
              <div className="space-y-3">
                {rank1.map((p, idx) => (
                  <div key={p.participant_id || idx} className="space-y-1">
                    <h4 className="text-2xl font-black text-amber-300 truncate">
                      {p.display_name}
                    </h4>
                    <div className="text-3xl sm:text-4xl font-black text-amber-400 font-mono">
                      {p.total_score ?? 0} đ
                    </div>
                    <div className="text-xs font-bold text-amber-300/80">
                      Đúng {p.correct_count ?? 0} câu
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bronze - Rank 3 */}
          {rank3.length > 0 && (
            <div className="order-3 sm:order-3 bg-slate-900/80 border-2 border-amber-700/50 rounded-3xl p-6 text-center space-y-4 shadow-xl">
              <div className="w-12 h-12 rounded-2xl bg-amber-700 text-amber-100 font-black text-xl flex items-center justify-center mx-auto shadow-md">
                #3
              </div>
              <div className="space-y-3">
                {rank3.map((p, idx) => (
                  <div key={p.participant_id || idx} className="space-y-1">
                    <h4 className="text-xl font-black text-white truncate">
                      {p.display_name}
                    </h4>
                    <div className="text-2xl font-black text-amber-500 font-mono">
                      {p.total_score ?? 0} đ
                    </div>
                    <div className="text-xs text-slate-400">
                      Đúng {p.correct_count ?? 0} câu
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Leaderboard Table (Authoritative Backend Ranks & Tie-Safe) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-800 text-xs font-black text-slate-400 uppercase tracking-wider">
              <th className="py-3 px-4 w-20 text-center">Hạng</th>
              <th className="py-3 px-4">Thí Sinh</th>
              <th className="py-3 px-4 text-center">Số Câu Đúng</th>
              <th className="py-3 px-4 text-right">Tổng Điểm</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-medium text-sm sm:text-base">
            {safeLeaderboard.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-8 text-center text-slate-500 italic">
                  Chưa có dữ liệu bảng xếp hạng...
                </td>
              </tr>
            ) : (
              safeLeaderboard.slice(0, 10).map((row, idx) => {
                const numericRank = Number(row.rank);
                const isTop3 = numericRank <= 3;
                return (
                  <tr key={row.participant_id || idx} className={isTop3 ? 'bg-amber-500/5' : ''}>
                    <td className="py-3.5 px-4 text-center">
                      <span className={`inline-block font-mono font-black px-2.5 py-1 rounded-xl text-xs sm:text-sm ${
                        numericRank === 1 ? 'bg-amber-400 text-slate-950' :
                        numericRank === 2 ? 'bg-slate-300 text-slate-950' :
                        numericRank === 3 ? 'bg-amber-700 text-white' :
                        'bg-slate-800 text-slate-300'
                      }`}>
                        #{row.rank}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-bold text-slate-100">
                      {row.display_name}
                    </td>
                    <td className="py-3.5 px-4 text-center font-mono text-slate-300">
                      {row.correct_count ?? 0}
                    </td>
                    <td className="py-3.5 px-4 text-right font-black font-mono text-amber-400 text-base sm:text-lg">
                      {row.total_score ?? 0} đ
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
