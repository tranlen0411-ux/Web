// src/components/notifications/NotificationDetailModal.jsx
// Hộp thoại xem chi tiết thông báo & trạng thái đọc dành cho Học sinh (Notifications V1 R3-B2)
// Quản lý Accessibility, Focus Trap, Escape key & Render văn bản thuần an toàn chống XSS

import React, { useEffect, useRef } from 'react';
import {
  X,
  Clock,
  User,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Sparkles
} from 'lucide-react';

/**
 * Format thời gian hiển thị đầy đủ ngày giờ
 */
function formatFullDateTime(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${hours}:${minutes} - Ngày ${day}/${month}/${year}`;
  } catch {
    return '';
  }
}

export const NotificationDetailModal = ({
  isOpen,
  notification,
  onClose,
  isMarkingRead = false,
  markReadError = null,
  onRetryMarkAsRead
}) => {
  const closeButtonRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  // Quản lý focus: Lưu phần tử active trước khi mở và trả focus khi đóng
  useEffect(() => {
    if (isOpen) {
      previouslyFocusedRef.current = document.activeElement;
      // Focus vào nút đóng khi modal mở
      setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 50);
    } else {
      if (previouslyFocusedRef.current && typeof previouslyFocusedRef.current.focus === 'function') {
        previouslyFocusedRef.current.focus();
      }
    }
  }, [isOpen]);

  // Hỗ trợ phím Escape để đóng modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !notification) return null;

  const isUrgent = notification.priority === 'urgent';
  const isHigh = notification.priority === 'high';
  const isRead = Boolean(notification.is_read);

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notification-detail-title"
      aria-describedby="notification-detail-content"
    >
      {/* Nền mờ Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Thân Modal */}
      <div className="relative bg-white rounded-3xl border-4 border-amber-300 shadow-2xl w-full max-w-lg overflow-hidden z-10 flex flex-col max-h-[90vh] animate-fadeIn">
        {/* HEADER MODAL */}
        <header
          className={`px-6 py-4 flex items-center justify-between border-b-2 ${
            isUrgent
              ? 'bg-gradient-to-r from-rose-100 to-amber-100 border-rose-200'
              : isHigh
              ? 'bg-gradient-to-r from-amber-100 to-yellow-100 border-amber-200'
              : 'bg-gradient-to-r from-sky-100 to-amber-50 border-sky-200'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-white border-2 border-amber-300 flex items-center justify-center text-xl shadow-sm">
              {isUrgent ? '🚨' : isHigh ? '⭐' : '📢'}
            </div>
            <div>
              <span className="text-[11px] font-black uppercase tracking-wider block text-amber-900">
                {isUrgent
                  ? 'Thông Báo Khẩn Cấp'
                  : isHigh
                  ? 'Thông Báo Quan Trọng'
                  : 'Thông Báo Từ Lớp Học'}
              </span>
              <p className="text-xs font-bold text-slate-600 flex items-center gap-1">
                <span>{notification.sender_name || 'Nhà trường'}</span>
                <Sparkles className="w-3 h-3 text-amber-500 fill-amber-400" />
              </p>
            </div>
          </div>

          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Đóng hộp thoại thông báo"
            className="p-2 rounded-2xl text-slate-600 hover:bg-white hover:text-rose-600 active:scale-95 transition-all border-2 border-transparent hover:border-amber-200 shadow-sm"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* NỘI DUNG CHI TIẾT */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {/* Banner trạng thái Đã đọc / Đang đánh dấu / Lỗi */}
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              {isRead ? (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-50 border border-emerald-200 text-emerald-800 font-black rounded-xl">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  Đã đọc
                </span>
              ) : isMarkingRead ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 border border-amber-200 text-amber-800 font-bold rounded-xl animate-pulse">
                  <RefreshCw className="w-3 h-3 animate-spin text-amber-600" />
                  Đang ghi nhận đã đọc...
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-rose-50 border border-rose-200 text-rose-800 font-black rounded-xl">
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  Chưa đọc
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 text-[11px] font-bold text-slate-500">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>{formatFullDateTime(notification.published_at)}</span>
            </div>
          </div>

          {/* Banner hiển thị lỗi đánh dấu đã đọc (nếu có) kèm nút thử lại */}
          {markReadError && (
            <div className="p-3 bg-rose-50 border-2 border-rose-200 rounded-2xl flex items-center justify-between text-xs text-rose-800">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span className="font-bold">
                  {typeof markReadError === 'string'
                    ? markReadError
                    : markReadError?.message || 'Chưa thể ghi nhận trạng thái đã đọc.'}
                </span>
              </div>
              {typeof onRetryMarkAsRead === 'function' && (
                <button
                  onClick={onRetryMarkAsRead}
                  disabled={isMarkingRead}
                  className="font-black underline text-rose-900 hover:text-rose-700 ml-2 shrink-0 disabled:opacity-50"
                >
                  Thử lại
                </button>
              )}
            </div>
          )}

          {/* Tiêu đề thông báo */}
          <h2
            id="notification-detail-title"
            className="text-lg font-black text-amber-950 leading-snug break-words"
          >
            {notification.title}
          </h2>

          {/* Nội dung thông báo thuần text (chống XSS) */}
          <div
            id="notification-detail-content"
            className="p-4 bg-amber-50/50 rounded-2xl border-2 border-amber-100 text-sm font-medium text-slate-800 leading-relaxed whitespace-pre-line break-words select-text"
          >
            {notification.content}
          </div>

          {/* Thông tin người gửi chi tiết */}
          <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between text-xs font-bold text-slate-600">
            <span className="flex items-center gap-1.5 truncate">
              <User className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span>Người gửi: {notification.sender_name || 'Nhà trường'}</span>
            </span>

            {isRead && notification.read_at && (
              <span className="text-[11px] text-slate-400 truncate ml-2">
                Đọc lúc: {formatFullDateTime(notification.read_at)}
              </span>
            )}
          </div>
        </div>

        {/* FOOTER MODAL */}
        <footer className="px-6 py-3.5 bg-slate-50 border-t-2 border-slate-100 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-amber-950 font-black text-sm rounded-2xl border-2 border-amber-400 shadow-sm active:scale-95 transition-all"
          >
            Đã hiểu rồi!
          </button>
        </footer>
      </div>
    </div>
  );
};
