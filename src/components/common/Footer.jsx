import React from 'react';
import { Gamepad2, Heart, Sparkles } from 'lucide-react';

export const Footer = () => {
  return (
    <footer className="bg-amber-100 border-t-4 border-amber-300 py-10 mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center flex flex-col items-center">
        
        <div className="flex items-center gap-2 mb-3">
          <div className="w-10 h-10 bg-amber-400 rounded-xl flex items-center justify-center border-2 border-amber-500 shadow-sm">
            <Gamepad2 className="w-6 h-6 text-amber-950" />
          </div>
          <span className="text-xl font-black text-amber-950">KHO TRÒ CHƠI HỌC VUI TIỂU HỌC</span>
        </div>

        <p className="text-sm font-semibold text-amber-800 max-w-md mb-4">
          Nền tảng trò chơi tương tác giáo dục tiểu học dành cho các bé Khối lớp 1, 2, 3, 4, 5 chuẩn GDPT 2018. Học mà chơi, chơi mà học!
        </p>

        <div className="flex flex-wrap justify-center gap-3 text-xs font-extrabold text-amber-900 mb-6">
          <span className="px-3 py-1 bg-amber-200 rounded-full border border-amber-300">📐 Toán Học</span>
          <span className="px-3 py-1 bg-amber-200 rounded-full border border-amber-300">📖 Tiếng Việt</span>
          <span className="px-3 py-1 bg-amber-200 rounded-full border border-amber-300">🇬🇧 Tiếng Anh</span>
          <span className="px-3 py-1 bg-amber-200 rounded-full border border-amber-300">🌱 Tự Nhiên & Xã Hội</span>
          <span className="px-3 py-1 bg-amber-200 rounded-full border border-amber-300">🗺️ Lịch Sử & Địa Lý</span>
        </div>

        <p className="text-xs font-bold text-amber-700 flex items-center gap-1">
          Thiết kế với <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500 animate-bounce" /> dành riêng cho Học sinh, Giáo viên và Phụ huynh Tiểu học.
        </p>
      </div>
    </footer>
  );
};
