import React, { useState, useRef, useEffect } from 'react';
import { Volume2, VolumeX, Music, Bell, Sparkles, SlidersHorizontal, ChevronDown } from 'lucide-react';

/**
 * HostAudioControls component (Host Only V1)
 *
 * Renders audio controls in the Host Top Bar:
 * - Direct "Bật âm thanh" unlock button when locked by browser autoplay
 * - Volume / Mute quick toggle
 * - Popover for granular control: Master Sound, Background Music, Sound Effects, Volume Slider
 */
export function HostAudioControls({
  isUnlocked,
  unlockAudio,
  isSoundEnabled,
  toggleSound,
  isMusicEnabled,
  setMusicEnabled,
  isSfxEnabled,
  setSfxEnabled,
  volume,
  setVolume,
  isMusicAvailable = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef(null);

  // Close popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // When audio is locked, show prominent unlock trigger
  if (!isUnlocked) {
    return (
      <button
        type="button"
        onClick={unlockAudio}
        title="Kích hoạt âm thanh và nhạc nền cho phòng thi đấu"
        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white shadow-sm transition active:scale-95 animate-pulse"
      >
        <Sparkles className="w-4 h-4" />
        Bật âm thanh
      </button>
    );
  }

  const volumePercent = Math.round(volume * 100);

  return (
    <div className="relative inline-block" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title={isSoundEnabled ? `Âm thanh phòng thi (${volumePercent}%)` : 'Đang tắt âm thanh phòng thi'}
        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition shadow-sm ${
          isSoundEnabled
            ? 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
            : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
        }`}
      >
        {isSoundEnabled ? (
          <Volume2 className="w-4 h-4 text-amber-600" />
        ) : (
          <VolumeX className="w-4 h-4 text-slate-400" />
        )}
        <span className="hidden sm:inline">Âm thanh</span>
        <ChevronDown className="w-3.5 h-3.5 opacity-70" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 bg-white rounded-2xl shadow-xl border border-slate-200 p-4 z-50 space-y-4 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 uppercase tracking-wide">
              <SlidersHorizontal className="w-3.5 h-3.5 text-amber-500" />
              Cài đặt âm thanh Host
            </h3>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
              Host V1
            </span>
          </div>

          {/* Master Sound Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isSoundEnabled ? (
                <Volume2 className="w-4 h-4 text-amber-500" />
              ) : (
                <VolumeX className="w-4 h-4 text-slate-400" />
              )}
              <div>
                <div className="text-xs font-bold text-slate-700">Âm thanh chung</div>
                <div className="text-[10px] text-slate-400">Bật/tắt toàn bộ âm thanh</div>
              </div>
            </div>
            <button
              type="button"
              onClick={toggleSound}
              className={`w-11 h-6 flex items-center rounded-full p-1 transition duration-200 ${
                isSoundEnabled ? 'bg-amber-500 justify-end' : 'bg-slate-300 justify-start'
              }`}
            >
              <div className="bg-white w-4 h-4 rounded-full shadow-md" />
            </button>
          </div>

          {/* Music Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Music className={`w-4 h-4 ${isMusicAvailable && isMusicEnabled && isSoundEnabled ? 'text-amber-500' : 'text-slate-400'}`} />
              <div>
                <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  Nhạc nền
                  {!isMusicAvailable && (
                    <span className="text-[10px] font-medium text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                      Chưa khả dụng
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-400">
                  {!isMusicAvailable ? 'Chưa có tệp nhạc' : 'Sảnh chờ & thời gian làm bài'}
                </div>
              </div>
            </div>
            <button
              type="button"
              disabled={!isSoundEnabled || !isMusicAvailable}
              onClick={() => setMusicEnabled(!isMusicEnabled)}
              title={!isMusicAvailable ? 'Chưa có tệp nhạc nền' : undefined}
              className={`w-11 h-6 flex items-center rounded-full p-1 transition duration-200 disabled:opacity-40 ${
                isMusicAvailable && isMusicEnabled && isSoundEnabled ? 'bg-amber-500 justify-end' : 'bg-slate-300 justify-start'
              }`}
            >
              <div className="bg-white w-4 h-4 rounded-full shadow-md" />
            </button>
          </div>

          {/* SFX Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className={`w-4 h-4 ${isSfxEnabled && isSoundEnabled ? 'text-amber-500' : 'text-slate-400'}`} />
              <div>
                <div className="text-xs font-bold text-slate-700">Hiệu ứng âm thanh</div>
                <div className="text-[10px] text-slate-400">Đếm ngược, hết giờ, kết quả</div>
              </div>
            </div>
            <button
              type="button"
              disabled={!isSoundEnabled}
              onClick={() => setSfxEnabled(!isSfxEnabled)}
              className={`w-11 h-6 flex items-center rounded-full p-1 transition duration-200 disabled:opacity-40 ${
                isSfxEnabled && isSoundEnabled ? 'bg-amber-500 justify-end' : 'bg-slate-300 justify-start'
              }`}
            >
              <div className="bg-white w-4 h-4 rounded-full shadow-md" />
            </button>
          </div>

          {/* Volume Slider */}
          <div className="pt-2 border-t border-slate-100 space-y-1.5">
            <div className="flex justify-between text-xs font-semibold text-slate-700">
              <span>Âm lượng</span>
              <span className="text-amber-600 font-bold">{volumePercent}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              disabled={!isSoundEnabled}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer disabled:opacity-40"
            />
          </div>
        </div>
      )}
    </div>
  );
}
