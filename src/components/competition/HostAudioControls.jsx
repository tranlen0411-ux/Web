import React, { useState, useRef, useEffect } from 'react';
import {
  Volume2,
  VolumeX,
  Music,
  Bell,
  Sparkles,
  SlidersHorizontal,
  ChevronDown,
  Play,
  Square,
  Check,
  Disc,
} from 'lucide-react';
import { ALL_THEME_OPTIONS } from '../../services/competitionMusicThemes.js';

/**
 * HostAudioControls component (Host Only V1)
 *
 * Renders audio controls in the Host Top Bar:
 * - Direct "Bật âm thanh" unlock button when locked by browser autoplay
 * - Volume / Mute quick toggle
 * - Popover for granular control:
 *   - Master Sound, Background Music, Sound Effects, Volume Slider
 *   - "Chủ đề nhạc nền" 2-column library with preview & selection controls
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
  themeId = 'classroom_chill',
  setThemeId,
  previewTheme,
  stopPreview,
  previewingThemeId,
  isGameActive = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef(null);

  // Close popover when clicking outside & stop active preview
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setIsOpen(false);
        if (stopPreview) stopPreview();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, stopPreview]);

  // Cleanup active preview on component unmount
  useEffect(() => {
    return () => {
      if (stopPreview) stopPreview();
    };
  }, [stopPreview]);

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
        <div className="absolute right-0 mt-2 w-[340px] sm:w-[500px] max-w-[95vw] bg-white rounded-2xl shadow-xl border border-slate-200 p-4 z-50 space-y-4 animate-in fade-in zoom-in-95 duration-150 max-h-[85vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 uppercase tracking-wide">
              <SlidersHorizontal className="w-3.5 h-3.5 text-amber-500" />
              Cài đặt âm thanh Host
            </h3>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
              Host V1
            </span>
          </div>

          {/* Quick Toggles */}
          <div className="space-y-3 bg-slate-50/70 p-3 rounded-xl border border-slate-100">
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
            <div className="pt-2 border-t border-slate-200/60 space-y-1.5">
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

          {/* Theme Library Section */}
          <div className="space-y-2 pt-1 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                <Disc className="w-3.5 h-3.5 text-amber-500" />
                <span>Chủ đề nhạc nền</span>
              </div>
              {isGameActive && (
                <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded font-medium">
                  Đang thi đấu
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500">
              Chọn phong cách nhạc cho phòng thi (áp dụng sảnh chờ & thời gian làm bài).
            </p>

            {/* 2-Column Responsive Card Grid (1 col on mobile, 2 col on tablet/desktop) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              {ALL_THEME_OPTIONS.map((theme) => {
                const isSelected = themeId === theme.id;
                const isPreviewing = previewingThemeId === theme.id;
                const isAvailable = theme.available !== false;
                const hasPreview = isAvailable && Boolean(theme.lobbyTrack);

                return (
                  <div
                    key={theme.id}
                    className={`flex flex-col justify-between p-3 rounded-xl border transition-all text-left ${
                      isSelected
                        ? 'border-amber-400 bg-amber-50/70 shadow-sm ring-1 ring-amber-400/50'
                        : isAvailable
                        ? 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60'
                        : 'border-slate-200 bg-slate-50/60 opacity-80 border-dashed'
                    }`}
                  >
                    {/* Top Content */}
                    <div>
                      <div className="flex items-start justify-between gap-1">
                        <span className="text-xs font-bold text-slate-800 line-clamp-1">
                          {theme.name}
                        </span>
                        {isSelected ? (
                          <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-800 bg-amber-100/90 px-1.5 py-0.5 rounded-full border border-amber-200">
                            <Check className="w-2.5 h-2.5" />
                            Đang chọn
                          </span>
                        ) : !isAvailable ? (
                          <span className="shrink-0 inline-flex items-center text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-200">
                            Chờ kiểm tra học liệu
                          </span>
                        ) : null}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1 line-clamp-2 min-h-[30px] leading-tight">
                        {theme.description}
                      </p>
                    </div>

                    {/* Bottom Actions */}
                    <div className="flex items-center justify-between gap-1.5 mt-3 pt-2 border-t border-slate-100">
                      {/* Nghe thử button */}
                      {hasPreview ? (
                        <button
                          type="button"
                          disabled={isGameActive}
                          onClick={() => previewTheme && previewTheme(theme.id)}
                          title={
                            isGameActive
                              ? 'Không khả dụng khi trận đấu đang diễn ra'
                              : isPreviewing
                              ? 'Dừng nghe thử'
                              : 'Nghe thử bản nhạc sảnh chờ'
                          }
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition disabled:opacity-40 disabled:cursor-not-allowed ${
                            isPreviewing
                              ? 'bg-amber-100 text-amber-800 border-amber-300 animate-pulse font-bold'
                              : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                          }`}
                        >
                          {isPreviewing ? (
                            <>
                              <Square className="w-2.5 h-2.5 fill-current" />
                              Dừng
                            </>
                          ) : (
                            <>
                              <Play className="w-2.5 h-2.5 fill-current" />
                              Nghe thử
                            </>
                          )}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled
                          title={!isAvailable ? 'Chờ kiểm tra bản quyền học liệu SCORM' : 'Chủ đề không có nhạc nền'}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border border-slate-200 text-slate-400 bg-slate-100/70 cursor-not-allowed opacity-60"
                        >
                          <Play className="w-2.5 h-2.5 fill-current" />
                          Nghe thử
                        </button>
                      )}

                      {/* Chọn button */}
                      <button
                        type="button"
                        disabled={isSelected || !isAvailable}
                        onClick={() => setThemeId && setThemeId(theme.id)}
                        title={!isAvailable ? 'Học liệu chưa được duyệt' : undefined}
                        className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition ${
                          isSelected
                            ? 'bg-amber-200/60 text-amber-900 cursor-default font-bold'
                            : !isAvailable
                            ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                            : 'bg-amber-500 hover:bg-amber-600 active:scale-95 text-white shadow-xs'
                        }`}
                      >
                        {isSelected ? 'Đã chọn' : !isAvailable ? 'Chưa khả dụng' : 'Chọn'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
