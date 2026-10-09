import React from 'react';
import { Sparkles, Users } from 'lucide-react';

export function SpectatorWaitingView({ snapshot, participants = [] }) {
  return (
    <div className="w-full max-w-6xl mx-auto space-y-8 text-center animate-fade-in">
      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-sm font-black tracking-wider uppercase">
          <Sparkles className="w-4 h-4 animate-spin" />
          Đấu Trường Trực Tiếp
        </div>
        <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight">
          {snapshot?.title}
        </h2>
        <p className="text-base sm:text-xl text-slate-400 font-medium">
          Đang chờ bắt đầu... Thí sinh nhập mã phòng để vào sảnh thi đấu
        </p>
      </div>

      {/* Huge Room Code Display */}
      <div className="inline-block bg-gradient-to-b from-slate-900 to-slate-900/90 border-2 border-amber-400/40 rounded-3xl p-6 sm:p-10 shadow-2xl shadow-amber-500/10">
        <span className="text-xs sm:text-sm font-bold text-amber-400/80 uppercase tracking-widest block mb-2">
          MÃ PHÒNG THI ĐẤU
        </span>
        <div className="text-5xl sm:text-8xl font-black text-amber-400 font-mono tracking-widest drop-shadow-md">
          {snapshot?.room_code || '------'}
        </div>
        <div className="mt-4 text-xs sm:text-sm text-slate-400 flex items-center justify-center gap-2 font-medium">
          <Users className="w-4 h-4 text-sky-400" />
          Đã tham gia: <strong className="text-white font-bold text-base">{participants.length}</strong> / {snapshot?.max_participants || 100} thí sinh
        </div>
      </div>

      {/* Participants Avatar Wall */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 sm:p-8 backdrop-blur-xs">
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center justify-center gap-2">
          <Users className="w-4 h-4 text-sky-400" />
          Danh Sách Thí Sinh Trong Sảnh Chờ
        </h3>
        {participants.length === 0 ? (
          <p className="text-sm text-slate-500 italic py-6">
            Chưa có thí sinh nào vào phòng... Hãy chia sẻ mã phòng cho học sinh!
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-3 max-h-60 overflow-y-auto p-2">
            {participants.map((p) => (
              <div
                key={p.id}
                className="px-4 py-2 rounded-2xl bg-slate-800/80 border border-slate-700/80 flex items-center gap-2.5 shadow-md animate-scale-in"
              >
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 text-slate-950 font-black text-xs flex items-center justify-center flex-shrink-0">
                  {p.display_name?.charAt(0)?.toUpperCase() || 'H'}
                </div>
                <span className="text-sm font-bold text-slate-200">
                  {p.display_name}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
