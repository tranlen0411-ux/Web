import React, { useState, useRef, useEffect } from 'react';
import { Volume2, VolumeX, Volume1, Music, Sparkles } from 'lucide-react';

/**
 * StudentAudioControls component (Competition V1 - R19)
 *
 * Provides dedicated audio controls for Students & Guests:
 * - When in_class: Displays a subtle informative badge ("Thi tại lớp: Âm thanh từ máy Thầy/Cô")
 * - When online:
 *   - "Bật âm thanh" button when browser autoplay is locked
 *   - Mute/Unmute quick toggle
 *   - Volume slider popup
 */
export function StudentAudioControls({
  isInClass = true,
  isOnline = false,
  isStudentAudioUnlocked = false,
  needsPlaybackRetry = false,
  unlockStudentAudio,
  retryStudentAudio,
  isStudentMuted = false,
  toggleStudentMute,
  volume = 0.5,
  setVolume,
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

  // 1. Chế độ Thi tại lớp (In-Class Mode) -> Hiển thị huy hiệu thông báo, không phát âm thanh
  if (isInClass) {
    return (
      <div
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-500 text-xs font-semibold select-none"
        title="Phòng thi đang ở chế độ Thi tại lớp. Âm thanh chỉ phát từ loa của Thầy/Cô."
      >
        <VolumeX className="w-3.5 h-3.5 text-slate-400" />
        <span className="hidden sm:inline">Thi tại lớp: Âm thanh từ Thầy/Cô</span>
        <span className="sm:hidden">Loa lớp học</span>
      </div>
    );
  }

  // 2. Chế độ Thi trực tuyến (Online Mode)
  return (
    <div className="relative inline-flex items-center gap-1.5" ref={popoverRef}>
      {/* Nút mở khóa Autoplay nếu trình duyệt chưa kích hoạt */}
      {!isStudentAudioUnlocked ? (
        <button
          type="button"
          onClick={unlockStudentAudio}
          data-testid="btn-student-audio-unlock"
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold shadow-sm animate-pulse transition"
          title="Bấm để kích hoạt âm thanh thi đấu trên thiết bị của bạn"
        >
          <Volume2 className="w-3.5 h-3.5" />
          <span>Bật âm thanh</span>
        </button>
      ) : needsPlaybackRetry ? (
        /* Nút khôi phục nếu trình duyệt từ chối tự phát bài mới trong nền */
        <button
          type="button"
          onClick={retryStudentAudio || unlockStudentAudio}
          data-testid="btn-student-audio-retry"
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold shadow-sm animate-pulse transition"
          title="Trình duyệt tạm dừng bài nhạc mới. Bấm để khôi phục âm thanh!"
        >
          <Volume2 className="w-3.5 h-3.5" />
          <span>Khôi phục âm thanh</span>
        </button>
      ) : (
        /* Nút chuyển đổi Tắt/Bật tiếng & Menu âm lượng */
        <div className="flex items-center bg-white border border-slate-200 rounded-full shadow-2xs p-0.5">
          <button
            type="button"
            onClick={toggleStudentMute}
            className={`p-1.5 rounded-full transition ${
              isStudentMuted
                ? 'text-rose-500 hover:bg-rose-50'
                : 'text-sky-600 hover:bg-sky-50'
            }`}
            title={isStudentMuted ? 'Mở lại âm thanh' : 'Tắt tiếng thi đấu'}
            aria-label={isStudentMuted ? 'Mở lại âm thanh' : 'Tắt tiếng'}
          >
            {isStudentMuted ? (
              <VolumeX className="w-3.5 h-3.5" />
            ) : volume > 0.5 ? (
              <Volume2 className="w-3.5 h-3.5" />
            ) : (
              <Volume1 className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="px-2 py-0.5 text-[11px] font-bold text-slate-600 hover:text-slate-900 border-l border-slate-200 transition"
            title="Điều chỉnh âm lượng"
          >
            {isStudentMuted ? 'Tắt' : `${Math.round((volume || 0.5) * 100)}%`}
          </button>
        </div>
      )}

      {/* Popover trượt điều chỉnh âm lượng */}
      {isOpen && !isInClass && (
        <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-2xl shadow-xl border border-slate-200 p-3 z-50 animate-fadeIn space-y-2.5">
          <div className="flex items-center justify-between text-xs font-bold text-slate-700">
            <span className="flex items-center gap-1">
              <Music className="w-3.5 h-3.5 text-sky-500" />
              Âm lượng
            </span>
            <span className="text-sky-600">{Math.round((volume || 0.5) * 100)}%</span>
          </div>

          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={isStudentMuted ? 0 : volume}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (setVolume) setVolume(val);
              if (isStudentMuted && val > 0 && toggleStudentMute) {
                toggleStudentMute();
              }
            }}
            className="w-full accent-sky-500 h-1.5 bg-slate-100 rounded-lg cursor-pointer"
          />

          <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-[11px]">
            <button
              type="button"
              onClick={toggleStudentMute}
              className="text-slate-500 hover:text-slate-800 font-semibold"
            >
              {isStudentMuted ? 'Mở tiếng' : 'Tắt tiếng'}
            </button>
            <span className="text-slate-400 font-medium">Trực tuyến</span>
          </div>
        </div>
      )}
    </div>
  );
}
