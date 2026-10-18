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
  Layers,
  Radio,
  FileText,
  ExternalLink,
  ShieldCheck,
  Award,
  AlertTriangle,
  Lock,
  RefreshCw,
} from 'lucide-react';
import {
  ALL_THEME_OPTIONS,
  HEROIC_TRACKS,
  SELECTION_MODE_CUSTOM,
  SELECTION_MODE_THEME,
} from '../../services/competitionMusicThemes.js';

/**
 * HostAudioControls component (Host Only V1 & V2 Heroic Orchestral)
 *
 * Renders audio controls in the Host Top Bar:
 * - Direct "Bật âm thanh" unlock button when locked by browser autoplay
 * - Volume / Mute quick toggle
 * - Popover for granular control:
 *   - Master Sound, Background Music, Sound Effects, Volume Slider
 *   - Tab 1: "Chủ đề có sẵn" (Preset Themes)
 *   - Tab 2: "Chọn riêng (Giao hưởng)" (Custom Selection: Lobby & Question)
 *   - Tab 3: "Bản quyền & Ghi công" (Attribution & Licensing)
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
  // Heroic Orchestral extensions
  selectionMode = SELECTION_MODE_THEME,
  setSelectionMode,
  customLobbyTrackId = 'km_at_launch',
  setCustomLobbyTrack,
  customQuestionTrackId = 'sb_titan',
  setCustomQuestionTrack,
  previewTrack,
  previewingTrackId,
  audioConfigStatus = 'idle',
  onSaveAndSync,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('preset'); // 'preset' | 'custom' | 'attribution'
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
        {audioConfigStatus === 'unsynced' && (
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" title="Có thay đổi nhạc chưa lưu & đồng bộ" />
        )}
        <ChevronDown className="w-3.5 h-3.5 opacity-70" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-[340px] sm:w-[560px] md:w-[620px] max-w-[95vw] bg-white rounded-2xl shadow-xl border border-slate-200 p-4 z-50 space-y-4 animate-in fade-in zoom-in-95 duration-150 max-h-[85vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 uppercase tracking-wide">
              <SlidersHorizontal className="w-3.5 h-3.5 text-amber-500" />
              Cài đặt âm thanh Host
            </h3>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
              Heroic Orchestral V2
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

          {/* SYNC STATUS BAR: When unsynced or saving (both in Waiting and Live Game) */}
          {audioConfigStatus === 'unsynced' && (
            <div className="flex items-center justify-between p-2.5 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900 shadow-2xs">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Chưa lưu & đồng bộ với học sinh</span>
              </div>
              <button
                type="button"
                data-testid="popover-btn-save-sync-audio"
                onClick={onSaveAndSync}
                className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-xs shadow-xs transition"
              >
                Lưu & Đồng bộ
              </button>
            </div>
          )}
          {audioConfigStatus === 'saving' && (
            <div className="flex items-center gap-2 p-2 bg-sky-50 border border-sky-200 rounded-xl text-xs text-sky-800 font-semibold animate-pulse">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-600" />
              <span>Đang lưu và đồng bộ với phòng thi...</span>
            </div>
          )}
          {audioConfigStatus === 'failed' && (
            <div className="flex items-center justify-between p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>Chưa thể lưu cấu hình âm thanh</span>
              </div>
              <button
                type="button"
                data-testid="popover-btn-retry-save-audio"
                onClick={onSaveAndSync}
                className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold text-xs shadow-xs transition"
              >
                Thử lại
              </button>
            </div>
          )}
          {isGameActive && audioConfigStatus === 'saved' && (
            <div className="flex items-center gap-2 p-2.5 bg-sky-50 border border-sky-200 rounded-xl text-[11px] text-sky-800 font-medium">
              <Radio className="w-3.5 h-3.5 text-sky-600 shrink-0" />
              <span>Trận đấu đang diễn ra • Bạn có thể chọn nhạc mới bất kỳ lúc nào và bấm <strong>Lưu & Đồng bộ</strong> để chuyển bài cho học sinh.</span>
            </div>
          )}

          {/* Library Navigation Tabs */}
          <div className="flex items-center gap-1.5 border-b border-slate-200 pb-1 text-xs">
            <button
              type="button"
              onClick={() => {
                setActiveTab('preset');
                if (stopPreview) stopPreview();
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition ${
                activeTab === 'preset'
                  ? 'bg-amber-500 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Disc className="w-3.5 h-3.5" />
              <span>Chủ đề có sẵn</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('custom');
                if (stopPreview) stopPreview();
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition ${
                activeTab === 'custom'
                  ? 'bg-amber-500 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Chọn riêng (Giao hưởng)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('attribution');
                if (stopPreview) stopPreview();
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition ${
                activeTab === 'attribution'
                  ? 'bg-amber-500 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Bản quyền & Nguồn</span>
            </button>
          </div>

          {/* TAB 1: CHỦ ĐỀ CÓ SẴN (PRESET THEMES) */}
          {activeTab === 'preset' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-slate-500">
                  Chọn trọn bộ phong cách nhạc cho phòng thi (áp dụng sảnh chờ & thời gian làm bài).
                </p>
                {isGameActive && (
                  <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded font-medium">
                    Đang thi đấu
                  </span>
                )}
              </div>

              {/* 2-Column Responsive Card Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                {ALL_THEME_OPTIONS.map((theme) => {
                  const isSelected = selectionMode === SELECTION_MODE_THEME && themeId === theme.id;
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
                          <span className="text-xs font-bold text-slate-800 line-clamp-1 flex items-center gap-1">
                            {theme.id === 'heroic_orchestral' && (
                              <Award className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                            )}
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
                            onClick={() => previewTheme && previewTheme(theme.id)}
                            title={
                              isPreviewing
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
                              ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-60'
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
          )}

          {/* TAB 2: CHỌN RIÊNG LẺ (GIAO HƯỞNG) */}
          {activeTab === 'custom' && (
            <div className="space-y-4">
              <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-2.5 text-[11px] text-amber-900 leading-snug">
                <span className="font-bold">Chế độ chọn riêng:</span> Bạn có thể chỉ định độc lập bản nhạc cho <strong>Sảnh chờ</strong> và <strong>Thời gian làm bài</strong> từ 5 kiệt tác giao hưởng của Scott Buckley & Kevin MacLeod.
                {selectionMode === SELECTION_MODE_CUSTOM && (
                  <span className="block mt-1 text-emerald-700 font-semibold">
                    ✓ Đang kích hoạt chế độ Tùy chỉnh riêng.
                  </span>
                )}
              </div>

              {/* Danh sách 5 tác phẩm */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-700 flex items-center justify-between">
                  <span>Kho 5 bản giao hưởng anh hùng:</span>
                  <span className="text-[10px] text-slate-400 font-normal">Chất lượng bản thu gốc</span>
                </h4>

                <div className="space-y-2">
                  {HEROIC_TRACKS.map((track) => {
                    const isLobbySelected = selectionMode === SELECTION_MODE_CUSTOM && customLobbyTrackId === track.id;
                    const isQuestionSelected = selectionMode === SELECTION_MODE_CUSTOM && customQuestionTrackId === track.id;
                    const isPreviewing = previewingTrackId === track.id;

                    return (
                      <div
                        key={track.id}
                        className={`p-3 rounded-xl border transition-all ${
                          isLobbySelected || isQuestionSelected
                            ? 'border-amber-400 bg-amber-50/50 shadow-xs'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          {/* Info */}
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-800">{track.title}</span>
                              <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded font-medium">
                                {track.artist}
                              </span>
                              <span className="text-[10px] text-slate-400">{track.duration}</span>
                            </div>
                            <p className="text-[11px] text-slate-500 line-clamp-1">{track.description}</p>
                          </div>

                          {/* Controls */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            {/* Preview button */}
                            <button
                              type="button"
                              onClick={() => previewTrack && previewTrack(track.id)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition ${
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

                            {/* Select for Lobby */}
                            <button
                              type="button"
                              onClick={() => setCustomLobbyTrack && setCustomLobbyTrack(track.id)}
                              className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition ${
                                isLobbySelected
                                  ? 'bg-amber-500 text-white border-amber-500 shadow-xs'
                                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-300'
                              }`}
                            >
                              {isLobbySelected ? '✓ Đang làm Sảnh' : 'Chọn cho Sảnh'}
                            </button>

                            {/* Select for Question */}
                            <button
                              type="button"
                              onClick={() => setCustomQuestionTrack && setCustomQuestionTrack(track.id)}
                              className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition ${
                                isQuestionSelected
                                  ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-300'
                              }`}
                            >
                              {isQuestionSelected ? '✓ Đang làm Bài' : 'Chọn cho Làm bài'}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: BẢN QUYỀN & GHI CÔNG (ATTRIBUTION) */}
          {activeTab === 'attribution' && (
            <div className="space-y-3">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] text-slate-600 space-y-1">
                <div className="font-bold text-slate-800 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  Chứng minh nguồn cấp phép & Bảo vệ bản quyền
                </div>
                <p>
                  Toàn bộ 5 tác phẩm đều được phát hành theo giấy phép <strong>Creative Commons Attribution 4.0 International (CC-BY 4.0)</strong>, tải trực tiếp từ trang chính thức của tác giả Scott Buckley và Kevin MacLeod.
                </p>
                <p className="text-[10px] text-slate-500">
                  • Bản thu âm nguyên gốc, giữ toàn vẹn chất lượng âm thanh 100%.<br />
                  • 0% tài nguyên lấy từ SCORM; tuân thủ nghiêm ngặt Copyright Guard.
                </p>
              </div>

              <div className="space-y-2.5 max-h-[40vh] overflow-y-auto pr-1">
                {HEROIC_TRACKS.map((track) => (
                  <div key={track.id} className="p-2.5 rounded-xl border border-slate-200 bg-white space-y-1.5 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 text-xs">{track.title}</span>
                      <a
                        href={track.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 text-[10px] text-amber-700 hover:text-amber-900 underline font-medium"
                      >
                        Trang tác giả <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </div>
                    <div className="text-slate-500">
                      Tác giả: <strong>{track.artist}</strong> | Giấy phép: <a href={track.licenseUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{track.license}</a>
                      {track.isrc && <span> | ISRC: <code>{track.isrc}</code></span>}
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded p-1.5 font-mono text-[10px] text-slate-700 select-all whitespace-pre-line">
                      {track.attribution}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
