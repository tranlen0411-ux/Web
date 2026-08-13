import React, { useState } from 'react';
import { Eye, EyeOff, Copy, Check } from 'lucide-react';
import { useSound } from '../../context/SoundContext';

export const ParentCodeCell = ({ code }) => {
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const { triggerSound } = useSound();

  if (!code) {
    return <span className="text-slate-400 italic text-[11px]">Chưa tạo mã</span>;
  }

  const maskedCode = 'PAR-' + '•'.repeat(24);

  const handleCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(code);
    setCopied(true);
    triggerSound('click');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="inline-flex items-center gap-1.5 font-mono text-xs">
      <span className="font-bold text-amber-950 bg-amber-50 px-2 py-1 rounded-xl border border-amber-200 shadow-inner tracking-wider select-all">
        {showCode ? code : maskedCode}
      </span>

      <button
        onClick={(e) => { e.stopPropagation(); setShowCode(!showCode); triggerSound('click'); }}
        className="p-1.5 text-slate-500 hover:text-purple-700 hover:bg-purple-50 rounded-lg transition-colors"
        title={showCode ? "Ẩn mã tra cứu" : "Xem mã tra cứu Phụ huynh"}
        type="button"
      >
        {showCode ? <EyeOff className="w-3.5 h-3.5 text-purple-600" /> : <Eye className="w-3.5 h-3.5" />}
      </button>

      <button
        onClick={handleCopy}
        className="p-1.5 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors"
        title="Sao chép mã tra cứu Phụ huynh"
        type="button"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-600 font-bold" /> : <Copy className="w-3.5 h-3.5" />}
      </button>

      {copied && (
        <span className="text-[10px] font-black text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-lg animate-fadeIn border border-emerald-300">
          ✓ Đã sao chép mã tra cứu phụ huynh.
        </span>
      )}
    </div>
  );
};
