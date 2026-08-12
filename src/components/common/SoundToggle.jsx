import React from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { useSound } from '../../context/SoundContext';

export const SoundToggle = () => {
  const { isSoundEnabled, toggleSound, triggerSound } = useSound();

  const handleClick = () => {
    toggleSound();
    triggerSound('click');
  };

  return (
    <button
      onClick={handleClick}
      title={isSoundEnabled ? "Tắt âm thanh hiệu ứng" : "Bật âm thanh hiệu ứng"}
      className={`p-2.5 rounded-2xl flex items-center justify-center transition-all duration-200 shadow-sm active:translate-y-0.5 ${
        isSoundEnabled
          ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 border-2 border-amber-300'
          : 'bg-slate-200 text-slate-500 hover:bg-slate-300 border-2 border-slate-300'
      }`}
    >
      {isSoundEnabled ? (
        <Volume2 className="w-5 h-5 animate-pulse text-amber-600" />
      ) : (
        <VolumeX className="w-5 h-5 text-slate-400" />
      )}
    </button>
  );
};
