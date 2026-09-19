import React from 'react';
import { 
  Pen, Check, X, Eraser, RotateCcw, Trash2, 
  Save, Loader2, AlertTriangle, AlertCircle, RefreshCw 
} from 'lucide-react';

const COLORS = [
  { id: 'red', value: '#ef4444', label: 'Đỏ' },
  { id: 'blue', value: '#3b82f6', label: 'Xanh dương' },
  { id: 'green', value: '#10b981', label: 'Xanh lá' },
  { id: 'dark', value: '#1e293b', label: 'Đen' }
];

const STROKE_WIDTHS = [
  { id: 'small', value: 2, label: 'Nhỏ', px: '2px' },
  { id: 'medium', value: 4, label: 'Vừa', px: '4px' },
  { id: 'large', value: 7, label: 'Lớn', px: '7px' }
];

/**
 * AnnotationToolbar: Thanh công cụ chấm bài & vẽ chú thích trên ảnh (Step C2 - Draft Save & OCC)
 */
export const AnnotationToolbar = ({
  activeTool = 'pen',
  onSelectTool,
  activeColor = '#ef4444',
  onSelectColor,
  strokeWidth = 4,
  onSelectStrokeWidth,
  onUndo,
  onClear,
  canUndo = false,
  readOnly = false,
  saveStatus = 'idle', // 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error'
  version = 0,
  onManualSave,
  onReloadLatest
}) => {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-slate-900/90 backdrop-blur-md rounded-2xl border border-slate-700 shadow-xl text-white">
      
      {/* 1. CÁC CÔNG CỤ CHẤM VẼ (TOOLS) */}
      <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-xl border border-slate-700">
        <button
          type="button"
          onClick={() => onSelectTool?.('pen')}
          disabled={readOnly}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all ${
            activeTool === 'pen'
              ? 'bg-amber-500 text-white shadow-md'
              : 'text-slate-300 hover:text-white hover:bg-slate-700'
          }`}
          title="Bút vẽ tự do (Pen)"
        >
          <Pen className="w-3.5 h-3.5" />
          <span>Vẽ</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectTool?.('check')}
          disabled={readOnly}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all ${
            activeTool === 'check'
              ? 'bg-emerald-600 text-white shadow-md'
              : 'text-emerald-400 hover:text-emerald-300 hover:bg-slate-700'
          }`}
          title="Dấu đúng (Check Stamp)"
        >
          <Check className="w-3.5 h-3.5" />
          <span>Đúng</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectTool?.('cross')}
          disabled={readOnly}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all ${
            activeTool === 'cross'
              ? 'bg-rose-600 text-white shadow-md'
              : 'text-rose-400 hover:text-rose-300 hover:bg-slate-700'
          }`}
          title="Dấu sai (Cross Stamp)"
        >
          <X className="w-3.5 h-3.5" />
          <span>Sai</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectTool?.('eraser')}
          disabled={readOnly}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-black transition-all ${
            activeTool === 'eraser'
              ? 'bg-amber-600 text-white shadow-md'
              : 'text-slate-300 hover:text-white hover:bg-slate-700'
          }`}
          title="Xóa nét khi click (Eraser)"
        >
          <Eraser className="w-3.5 h-3.5" />
          <span>Tẩy</span>
        </button>
      </div>

      {/* 2. CHỌN MÀU SẮC (COLORS) */}
      <div className="flex items-center gap-1.5 bg-slate-800/80 px-2 py-1 rounded-xl border border-slate-700">
        <span className="text-[10px] font-black text-slate-400 mr-1 hidden sm:inline">Màu:</span>
        {COLORS.map(c => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelectColor?.(c.value)}
            disabled={readOnly || activeTool === 'check' || activeTool === 'cross'}
            className={`w-6 h-6 rounded-full transition-transform flex items-center justify-center ${
              activeColor === c.value
                ? 'scale-110 ring-2 ring-white ring-offset-2 ring-offset-slate-900'
                : 'opacity-70 hover:opacity-100'
            } disabled:opacity-30`}
            style={{ backgroundColor: c.value }}
            title={c.label}
          />
        ))}
      </div>

      {/* 3. ĐỘ DÀY NÉT VẼ (STROKE WIDTH) */}
      <div className="flex items-center gap-1 bg-slate-800/80 px-2 py-1 rounded-xl border border-slate-700">
        <span className="text-[10px] font-black text-slate-400 mr-1 hidden sm:inline">Nét:</span>
        {STROKE_WIDTHS.map(sw => (
          <button
            key={sw.id}
            type="button"
            onClick={() => onSelectStrokeWidth?.(sw.value)}
            disabled={readOnly || activeTool !== 'pen'}
            className={`px-2 py-1 rounded-lg text-[10px] font-black transition-all flex items-center justify-center ${
              strokeWidth === sw.value
                ? 'bg-slate-600 text-white'
                : 'text-slate-400 hover:text-white'
            } disabled:opacity-30`}
            title={`Độ dày ${sw.label}`}
          >
            {sw.label}
          </button>
        ))}
      </div>

      {/* 4. HOÀN TÁC, XÓA & LƯU NHÁP OCC (ACTIONS & STATUS) */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onUndo}
          disabled={readOnly || !canUndo}
          className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 text-slate-200 rounded-xl text-xs font-black transition-colors border border-slate-700"
          title="Hoàn tác nét gần nhất (Undo)"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Hoàn tác</span>
        </button>

        <button
          type="button"
          onClick={onClear}
          disabled={readOnly || !canUndo}
          className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-950/60 hover:bg-rose-900/80 disabled:opacity-40 disabled:hover:bg-rose-950/60 text-rose-300 rounded-xl text-xs font-black transition-colors border border-rose-800/50"
          title="Xóa toàn bộ nét vẽ trên ảnh này"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Xóa hết</span>
        </button>

        {/* CHỈ BÁO TRẠNG THÁI LƯU NHÁP (SAVE STATUS INDICATOR) */}
        <div className="flex items-center px-2 py-1 bg-slate-800/90 rounded-xl border border-slate-700 text-xs font-bold">
          {saveStatus === 'saving' && (
            <span className="text-sky-400 flex items-center gap-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span className="hidden sm:inline">Đang lưu...</span>
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="text-emerald-400 flex items-center gap-1" title={`Đã lưu nháp phiên bản v${version}`}>
              <Check className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Đã lưu (v{version})</span>
            </span>
          )}
          {saveStatus === 'dirty' && (
            <span className="text-amber-400 flex items-center gap-1.5" title="Nét vẽ mới chưa được lưu">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
              <span className="hidden sm:inline">Chưa lưu</span>
            </span>
          )}
          {saveStatus === 'conflict' && (
            <span className="text-rose-400 flex items-center gap-1" title="Xung đột phiên bản">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
              <span className="hidden sm:inline">Xung đột</span>
            </span>
          )}
          {saveStatus === 'error' && (
            <span className="text-rose-400 flex items-center gap-1" title="Lỗi lưu">
              <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
              <span className="hidden sm:inline">Lỗi lưu</span>
            </span>
          )}
          {saveStatus === 'idle' && (
            <span className="text-slate-400 text-[10px]">
              {version > 0 ? `v${version}` : 'Sẵn sàng'}
            </span>
          )}
        </div>

        {/* NÚT TẢI LẠI KHI XUNG ĐỘT HOẶC LỖI */}
        {saveStatus === 'conflict' && onReloadLatest && (
          <button
            type="button"
            onClick={onReloadLatest}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black transition-colors shadow-md animate-pulse"
            title="Tải lại phiên bản mới nhất từ máy chủ"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Tải lại</span>
          </button>
        )}

        {/* NÚT LƯU THỦ CÔNG (MANUAL SAVE) */}
        <button
          type="button"
          onClick={onManualSave}
          disabled={readOnly || saveStatus === 'saving' || saveStatus === 'saved' || saveStatus === 'idle'}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:hover:bg-amber-500 text-white rounded-xl text-xs font-black transition-all shadow-md active:translate-y-0.5"
          title="Lưu bản nháp nét chấm ngay lập tức"
        >
          {saveStatus === 'saving' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          <span>Lưu nháp</span>
        </button>
      </div>

    </div>
  );
};
