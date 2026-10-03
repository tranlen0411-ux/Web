import React from 'react';
import { Gamepad2, Sparkles } from 'lucide-react';

export const CompetitionStudentPage = () => {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="bg-white rounded-3xl p-8 border-4 border-sky-200 shadow-sm text-center">
        <div className="w-16 h-16 bg-sky-100 rounded-2xl flex items-center justify-center mx-auto mb-4 border-2 border-sky-300">
          <Gamepad2 className="w-8 h-8 text-sky-600" />
        </div>
        <h1 className="text-2xl font-black text-sky-950 mb-2 flex items-center justify-center gap-2">
          Đấu Trường Trực Tuyến — Student foundation ready <Sparkles className="w-5 h-5 text-amber-500 fill-amber-400" />
        </h1>
        <p className="text-sm font-bold text-slate-600">
          Nền tảng đấu trường thời gian thực dành cho Học sinh (Phase F1).
        </p>
      </div>
    </div>
  );
};
