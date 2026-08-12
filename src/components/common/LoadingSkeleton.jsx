import React from 'react';
import { Gamepad2 } from 'lucide-react';

export const LoadingSkeleton = ({ count = 4, type = 'card' }) => {
  if (type === 'page') {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-8 text-center animate-pulse">
        <div className="w-20 h-20 bg-amber-200 rounded-3xl flex items-center justify-center mb-4 border-4 border-amber-300">
          <Gamepad2 className="w-10 h-10 text-amber-500 animate-spin" />
        </div>
        <h3 className="text-xl font-bold text-amber-800 font-sans">Đang tải kho trò chơi học vui...</h3>
        <p className="text-amber-600 text-sm mt-1">Các bé đợi một chút nhé! 🌟</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
      {Array.from({ length: count }).map((_, idx) => (
        <div 
          key={idx} 
          className="bg-white rounded-3xl border-4 border-amber-100 overflow-hidden p-4 shadow-sm animate-pulse flex flex-col space-y-3"
        >
          <div className="w-full h-40 bg-amber-100 rounded-2xl"></div>
          <div className="h-6 bg-amber-100 rounded-xl w-3/4"></div>
          <div className="h-4 bg-amber-50 rounded-lg w-full"></div>
          <div className="h-4 bg-amber-50 rounded-lg w-2/3"></div>
          <div className="pt-2 flex justify-between items-center">
            <div className="h-8 bg-amber-100 rounded-full w-20"></div>
            <div className="h-10 bg-amber-300 rounded-2xl w-24"></div>
          </div>
        </div>
      ))}
    </div>
  );
};
