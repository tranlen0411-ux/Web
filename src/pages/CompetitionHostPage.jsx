import React from 'react';
import { Trophy, ShieldCheck } from 'lucide-react';

export const CompetitionHostPage = () => {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="bg-white rounded-3xl p-8 border-4 border-amber-200 shadow-sm text-center">
        <div className="w-16 h-16 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto mb-4 border-2 border-amber-300">
          <Trophy className="w-8 h-8 text-amber-600" />
        </div>
        <h1 className="text-2xl font-black text-amber-950 mb-2">
          Đấu Trường Trực Tuyến — Host foundation ready
        </h1>
        <p className="text-sm font-bold text-slate-600 flex items-center justify-center gap-1">
          <ShieldCheck className="w-4 h-4 text-emerald-600" /> Nền tảng điều khiển phòng thi dành cho Quản trị viên & Giáo viên (Phase F1).
        </p>
      </div>
    </div>
  );
};
