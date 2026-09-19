import React, { useState, useRef, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import {
  MAX_NOTE_TEXT_LENGTH,
  NOTE_COLOR_WHITELIST,
  DEFAULT_NOTE_COLOR,
} from '../../../utils/annotationNoteUtils';

/**
 * AnnotationNotePopover: Inline/Floating Note Editor for Teacher Annotation Canvas (Phase 2 - P2-B2)
 * Supports plain-text textarea, Vietnamese IME composition safety, character counting, color picker, delete button, and keyboard shortcuts.
 */
export const AnnotationNotePopover = ({
  isOpen,
  positionStyle = {},
  initialText = '',
  initialColor = DEFAULT_NOTE_COLOR,
  isEditing = false,
  onSave,
  onDelete,
  onCancel,
}) => {
  const [text, setText] = useState(initialText);
  const [color, setColor] = useState(initialColor);
  const [isComposing, setIsComposing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const textareaRef = useRef(null);
  const popoverRef = useRef(null);

  // Sync and auto-focus textarea when opened
  useEffect(() => {
    if (isOpen) {
      setText(initialText);
      setColor(initialColor);
      setShowDeleteConfirm(false);
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, initialText, initialColor]);

  if (!isOpen) return null;

  const trimmedText = text.trim();
  const isSaveDisabled = trimmedText.length === 0;

  const handleSave = () => {
    if (isSaveDisabled) {
      // Block save for empty/whitespace note (do not silently delete)
      return;
    }
    onSave?.({
      text: trimmedText.slice(0, MAX_NOTE_TEXT_LENGTH),
      color,
    });
  };

  const handleDelete = () => {
    onDelete?.();
  };

  const handleKeyDown = (e) => {
    // 1. ESC -> Cancel
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel?.();
      return;
    }

    // 2. Ctrl + Enter / Cmd + Enter -> Save (unless Vietnamese IME is composing or save is disabled)
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !isComposing) {
      e.preventDefault();
      e.stopPropagation();
      if (!isSaveDisabled) {
        handleSave();
      }
      return;
    }
  };

  return (
    <div
      ref={popoverRef}
      className="absolute z-30 w-72 sm:w-80 rounded-xl bg-slate-900/95 backdrop-blur-md border border-slate-700 shadow-2xl p-3 text-slate-100 animate-in fade-in zoom-in-95 duration-150 select-none"
      style={{
        ...positionStyle,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
        <div className="flex items-center gap-1.5 font-semibold text-xs text-amber-400">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3z" />
            <path d="M15 3v6h6" />
          </svg>
          <span>{isEditing ? 'Chỉnh sửa ghi chú' : 'Thêm ghi chú bài làm'}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Delete Button in Header (Visible ONLY when editing existing note) */}
          {isEditing && onDelete && (
            <div>
              {showDeleteConfirm ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="px-1.5 py-0.5 text-[10px] rounded font-semibold bg-rose-600 hover:bg-rose-500 text-white transition-colors"
                    aria-label="Xác nhận xóa ghi chú"
                  >
                    Xóa ngay
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-1 py-0.5 text-[10px] rounded text-slate-400 hover:text-slate-200"
                    aria-label="Hủy xóa"
                  >
                    Không
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="p-1 rounded text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 transition-colors"
                  title="Xóa ghi chú này"
                  aria-label="Xóa ghi chú"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
          <div className="text-[11px] text-slate-400">
            {text.length}/{MAX_NOTE_TEXT_LENGTH}
          </div>
        </div>
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={text}
        maxLength={MAX_NOTE_TEXT_LENGTH}
        onChange={(e) => setText(e.target.value)}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => setIsComposing(false)}
        onKeyDown={handleKeyDown}
        placeholder="Nhập nội dung nhận xét hoặc lời nhắc cho học sinh..."
        rows={3}
        className="w-full text-xs rounded-lg bg-slate-950 border border-slate-700/80 p-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 resize-none transition-all"
        aria-label="Nội dung ghi chú"
      />

      {/* Footer: Color Swatches & Action Buttons */}
      <div className="flex items-center justify-between mt-2.5 pt-1">
        {/* Color Palette */}
        <div className="flex items-center gap-1.5" aria-label="Chọn màu ghi chú">
          {NOTE_COLOR_WHITELIST.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={`w-5 h-5 rounded-full transition-transform ${
                color === c ? 'scale-125 ring-2 ring-white shadow-sm' : 'opacity-80 hover:opacity-100 hover:scale-110'
              }`}
              style={{ backgroundColor: c }}
              aria-label={`Màu ${c}`}
            />
          ))}
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            className="px-2.5 py-1 text-xs rounded-md font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            aria-label="Hủy tạo ghi chú"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaveDisabled}
            className="px-3 py-1 text-xs rounded-md font-medium bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-semibold shadow transition-all"
            aria-label="Lưu ghi chú"
          >
            Lưu
          </button>
        </div>
      </div>

      <div className="mt-1.5 text-[10px] text-slate-500 text-right">
        Ctrl+Enter để lưu • Esc để hủy
      </div>
    </div>
  );
};
