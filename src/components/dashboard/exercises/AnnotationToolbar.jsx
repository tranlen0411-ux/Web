import React from 'react';
import { 
  Pen, Minus, Circle, ArrowUpRight, Check, X, Eraser, Hand, 
  RotateCcw, RotateCw, Trash2, 
  Save, Loader2, AlertTriangle, AlertCircle, RefreshCw,
  ZoomIn, ZoomOut, Maximize2, StickyNote
} from 'lucide-react';
import { MIN_SCALE, MAX_SCALE } from '../../../utils/annotationViewportMath';

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
 * AnnotationToolbar: Thanh công cụ chấm bài & vẽ chú thích trên ảnh (Quick Tools: Pen, Line, Ellipse, Arrow, Stamps, Note, Undo/Redo)
 */
export const AnnotationToolbar = ({
  activeTool = 'pen',
  onSelectTool,
  activeColor = '#ef4444',
  onSelectColor,
  strokeWidth = 4,
  onSelectStrokeWidth,
  onUndo,
  onRedo,
  onClear,
  canUndo = false,
  canRedo = false,
  canClear = false,
  readOnly = false,
  saveStatus = 'idle', // 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error'
  version = 0,
  onManualSave,
  onReloadLatest,
  // Viewport Zoom & Pan controls
  scale = 1,
  onZoomIn,
  onZoomOut,
  onResetZoom,
}) => {
  const isShapeOrPenTool = ['pen', 'line', 'ellipse', 'arrow'].includes(activeTool);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-slate-900/90 backdrop-blur-md rounded-2xl border border-slate-700 shadow-xl text-white">
      
      {/* 1. CÁC CÔNG CỤ CHẤM VẼ & DI CHUYỂN (TOOLS) */}
      <div className="flex items-center flex-wrap gap-1 bg-slate-800/80 p-1 rounded-xl border border-slate-700">
        {/* Bút vẽ tự do */}
        <button
          type="button"
          onClick={() => onSelectTool?.('pen')}
          disabled={readOnly}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-black transition-all ${
            activeTool === 'pen'
              ? 'bg-amber-500 text-white shadow-md'
              : 'text-slate-300 hover:text-white hover:bg-slate-700'
          }`}
          title="Bút vẽ tự do (Pen)"
        >
          <Pen className="w-3.5 h-3.5" />
          <span>Vẽ</span>
        </button>

        {/* Đoạn thẳng (Line) */}
        <button
          type="button"
          onClick={() => onSelectTool?.('line')}
          disabled={readOnly}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-black transition-all ${
            activeTool === 'line'
              ? 'bg-amber-500 text-white shadow-md'
              : 'text-slate-300 hover:text-white hover:bg-slate-700'
          }`}
          title="Đoạn thẳng (Line)"
        >
          <Minus className="w-3.5 h-3.5" />
          <span>Thẳng</span>
        </button>

        {/* Khoanh tròn / Elip (Circle/Ellipse) */}
        <button
          type="button"
          onClick={() => onSelectTool?.('ellipse')}
          disabled={readOnly}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-black transition-all ${
            activeTool === 'ellipse'
              ? 'bg-amber-500 text-white shadow-md'
              : 'text-slate-300 hover:text-white hover:bg-slate-700'
          }`}
          title="Khoanh vùng elip / hình tròn (Circle/Ellipse)"
        >
          <Circle className="w-3.5 h-3.5" />
          <span>Khoanh</span>
        </button>

        {/* Mũi tên (Arrow) */}
        <button
          type="button"
          onClick={() => onSelectTool?.('arrow')}
          disabled={readOnly}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-black transition-all ${
            activeTool === 'arrow'
              ? 'bg-amber-500 text-white shadow-md'
              : 'text-slate-300 hover:text-white hover:bg-slate-700'
          }`}
          title="Mũi tên chỉ dẫn (Arrow)"
        >
          <ArrowUpRight className="w-3.5 h-3.5" />
          <span>Mũi tên</span>
        </button>

        {/* Dấu đúng */}
        <button
          type="button"
          onClick={() => onSelectTool?.('check')}
          disabled={readOnly}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-black transition-all ${
            activeTool === 'check'
              ? 'bg-emerald-600 text-white shadow-md'
              : 'text-emerald-400 hover:text-emerald-300 hover:bg-slate-700'
          }`}
          title="Dấu đúng (Check Stamp)"
        >
          <Check className="w-3.5 h-3.5" />
          <span>Đúng</span>
        </button>

        {/* Dấu sai */}
        <button
          type="button"
          onClick={() => onSelectTool?.('cross')}
          disabled={readOnly}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-black transition-all ${
            activeTool === 'cross'
              ? 'bg-rose-600 text-white shadow-md'
              : 'text-rose-400 hover:text-rose-300 hover:bg-slate-700'
          }`}
          title="Dấu sai (Cross Stamp)"
        >
          <X className="w-3.5 h-3.5" />
          <span>Sai</span>
        </button>

        {/* Ghi chú nhận xét */}
        <button
          type="button"
          onClick={() => onSelectTool?.('note')}
          disabled={readOnly}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-black transition-all ${
            activeTool === 'note'
              ? 'bg-amber-600 text-white shadow-md'
              : 'text-amber-400 hover:text-amber-300 hover:bg-slate-700'
          }`}
          title="Ghi chú nhận xét (Text Note)"
        >
          <StickyNote className="w-3.5 h-3.5" />
          <span>Ghi chú</span>
        </button>

        {/* Tẩy nét */}
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

        {/* Kéo xem */}
        <button
          type="button"
          onClick={() => onSelectTool?.('pan')}
          disabled={readOnly}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-black transition-all ${
            activeTool === 'pan'
              ? 'bg-sky-600 text-white shadow-md'
              : 'text-slate-300 hover:text-white hover:bg-slate-700'
          }`}
          title="Di chuyển khung nhìn (Pan Mode)"
        >
          <Hand className="w-3.5 h-3.5" />
          <span>Kéo</span>
        </button>
      </div>

      {/* 2. CỤM ĐIỀU KHIỂN THU PHÓNG (ZOOM CONTROLS) */}
      <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-xl border border-slate-700">
        <button
          type="button"
          onClick={onZoomOut}
          disabled={readOnly || scale <= MIN_SCALE}
          className="flex items-center justify-center w-7 h-7 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
          title="Thu nhỏ (-25%)"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>

        <span className="text-[11px] font-black text-slate-200 px-1.5 min-w-[42px] text-center select-none" title="Tỉ lệ thu phóng hiện tại">
          {Math.round(scale * 100)}%
        </span>

        <button
          type="button"
          onClick={onZoomIn}
          disabled={readOnly || scale >= MAX_SCALE}
          className="flex items-center justify-center w-7 h-7 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
          title="Phóng to (+25%)"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={onResetZoom}
          disabled={readOnly || scale === 1}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
          title="Đặt lại tỉ lệ 100%"
        >
          <Maximize2 className="w-3 h-3" />
          <span>100%</span>
        </button>
      </div>

      {/* 3. CHỌN MÀU SẮC (COLORS) */}
      <div className="flex items-center gap-1.5 bg-slate-800/80 px-2 py-1 rounded-xl border border-slate-700">
        <span className="text-[10px] font-black text-slate-400 mr-1 hidden sm:inline">Màu:</span>
        {COLORS.map(c => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelectColor?.(c.value)}
            disabled={readOnly || !isShapeOrPenTool}
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

      {/* 4. ĐỘ DÀY NÉT VẼ (STROKE WIDTH) */}
      <div className="flex items-center gap-1 bg-slate-800/80 px-2 py-1 rounded-xl border border-slate-700">
        <span className="text-[10px] font-black text-slate-400 mr-1 hidden sm:inline">Nét:</span>
        {STROKE_WIDTHS.map(sw => (
          <button
            key={sw.id}
            type="button"
            onClick={() => onSelectStrokeWidth?.(sw.value)}
            disabled={readOnly || !isShapeOrPenTool}
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

      {/* 5. HOÀN TÁC, LÀM LẠI, XÓA & LƯU NHÁP OCC (ACTIONS & STATUS) */}
      <div className="flex items-center gap-1.5">
        {/* Nút Hoàn tác (Undo) */}
        <button
          type="button"
          onClick={onUndo}
          disabled={readOnly || !canUndo}
          className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 text-slate-200 rounded-xl text-xs font-black transition-colors border border-slate-700"
          title="Hoàn tác thao tác gần nhất (Undo)"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Hoàn tác</span>
        </button>

        {/* Nút Làm lại (Redo) */}
        <button
          type="button"
          onClick={onRedo}
          disabled={readOnly || !canRedo}
          className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 text-slate-200 rounded-xl text-xs font-black transition-colors border border-slate-700"
          title="Làm lại thao tác vừa hoàn tác (Redo)"
        >
          <RotateCw className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Làm lại</span>
        </button>

        {/* Nút Xóa hết (Clear All) */}
        <button
          type="button"
          onClick={onClear}
          disabled={readOnly || !canClear}
          className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-950/60 hover:bg-rose-900/80 disabled:opacity-40 disabled:hover:bg-rose-950/60 text-rose-300 rounded-xl text-xs font-black transition-colors border border-rose-800/50"
          title="Xóa toàn bộ nét vẽ và ghi chú trên ảnh này"
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
