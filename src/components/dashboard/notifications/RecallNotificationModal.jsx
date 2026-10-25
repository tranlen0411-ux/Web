// src/components/dashboard/notifications/RecallNotificationModal.jsx
// Modal xác nhận thu hồi thông báo dành cho Giáo viên (Notifications V1 R3-C2B)
// Nhập lý do thu hồi, cảnh báo bảo toàn biên nhận lịch sử, chống double-submit, Zero Mutation khác

import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  AlertTriangle,
  RefreshCw,
  AlertCircle,
  FileText,
  ShieldAlert
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext.jsx';
import { recallNotification } from '../../../services/notificationClient.js';

export const RecallNotificationModal = ({
  isOpen,
  onClose,
  notification,
  onRecalled
}) => {
  const { user, profile } = useAuth();

  const [recallReason, setRecallReason] = useState('');
  const [isRecalling, setIsRecalling] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const isSubmittingRef = useRef(false);
  const previouslyFocusedRef = useRef(null);
  const currentUserIdRef = useRef(user?.id);
  const reasonInputRef = useRef(null);

  useEffect(() => {
    currentUserIdRef.current = user?.id;
  }, [user?.id]);

  // Quản lý Focus khi mở và trả Focus khi đóng modal
  useEffect(() => {
    if (isOpen) {
      previouslyFocusedRef.current = document.activeElement;
      isSubmittingRef.current = false;
      setIsRecalling(false);
      setRecallReason('');
      setErrorMessage(null);
      setTimeout(() => {
        reasonInputRef.current?.focus();
      }, 50);
    } else {
      if (previouslyFocusedRef.current && typeof previouslyFocusedRef.current.focus === 'function') {
        previouslyFocusedRef.current.focus();
      }
      setIsRecalling(false);
      isSubmittingRef.current = false;
      setRecallReason('');
      setErrorMessage(null);
    }
  }, [isOpen]);

  // Phím tắt Escape để đóng modal (chỉ khi không đang thực hiện)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen && !isRecalling && !isSubmittingRef.current) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isRecalling, onClose]);

  // Đóng modal lập tức nếu người dùng đăng xuất hoặc đổi tài khoản
  useEffect(() => {
    if (!user && isOpen) {
      onClose();
    }
  }, [user, isOpen, onClose]);

  if (!isOpen || !notification) return null;

  /**
   * Xử lý xác nhận thu hồi thông báo
   */
  const handleConfirmRecall = async () => {
    // 1. Chặn submit nếu đang thực hiện (chống double-click đồng bộ bằng ref & state)
    if (isRecalling) return;
    if (isSubmittingRef.current) return;

    // 2. Kiểm tra vai trò và phiên người dùng
    if (!user || profile?.role !== 'teacher') {
      setErrorMessage('Phiên làm việc không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.');
      return;
    }

    const trimmedReason = recallReason.trim();
    if (trimmedReason.length > 500) {
      setErrorMessage('Lý do thu hồi không được vượt quá 500 ký tự.');
      return;
    }

    // 3. Khóa đồng bộ
    isSubmittingRef.current = true;
    setIsRecalling(true);
    setErrorMessage(null);

    const activeUserId = user.id;

    try {
      // 4. Gọi RPC recallNotification đúng một lần duy nhất
      const res = await recallNotification(
        notification.id,
        trimmedReason.length > 0 ? trimmedReason : null
      );

      // Chống Race Condition nếu user đổi tài khoản trong lúc request đang gửi
      if (currentUserIdRef.current !== activeUserId) {
        isSubmittingRef.current = false;
        return;
      }

      // 5. Xử lý phản hồi từ server
      if (!res.ok) {
        isSubmittingRef.current = false;
        setIsRecalling(false);

        const errorStr = String(res.error?.message || '');
        if (
          errorStr.toLowerCase().includes('fetch') ||
          errorStr.toLowerCase().includes('network') ||
          errorStr.toLowerCase().includes('kết nối')
        ) {
          setErrorMessage(
            'Lỗi kết nối mạng: Không rõ thao tác đã thành công hay chưa. Vui lòng kiểm tra lại danh sách hoặc tải lại trang trước khi thử tiếp.'
          );
        } else {
          setErrorMessage(res.error?.message || 'Không thể thu hồi thông báo. Vui lòng thử lại.');
        }
        return;
      }

      // Bắt buộc xác nhận thành công cả hai điều kiện: res.ok === true && res.data === true
      if (res.ok === true && res.data === true) {
        // 6. THÀNH CÔNG: Mở khóa, gọi callback thông báo cho parent và đóng modal
        isSubmittingRef.current = false;
        setIsRecalling(false);

        if (typeof onRecalled === 'function') {
          onRecalled(notification);
        }
        onClose();
        return;
      }

      // Trường hợp máy chủ chưa xác nhận thành công (res.data !== true)
      isSubmittingRef.current = false;
      setIsRecalling(false);
      setErrorMessage(
        res.error?.message ||
        'Máy chủ chưa xác nhận thu hồi thông báo thành công. Vui lòng kiểm tra lại trạng thái thông báo trước khi thử lại.'
      );
      return;
    } catch (err) {
      isSubmittingRef.current = false;
      if (currentUserIdRef.current === activeUserId) {
        setIsRecalling(false);
        const errStr = String(err?.message || '');
        if (
          errStr.toLowerCase().includes('fetch') ||
          errStr.toLowerCase().includes('network')
        ) {
          setErrorMessage(
            'Lỗi kết nối mạng: Không rõ thao tác đã thành công hay chưa. Vui lòng kiểm tra lại danh sách hoặc tải lại trang trước khi thử tiếp.'
          );
        } else {
          setErrorMessage(err?.message || 'Đã xảy ra lỗi kết nối khi thu hồi thông báo.');
        }
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recall-modal-title"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
        onClick={() => {
          if (!isRecalling && !isSubmittingRef.current) onClose();
        }}
        aria-hidden="true"
      />

      {/* Thân Modal */}
      <div className="relative bg-white rounded-3xl border-4 border-rose-300 shadow-2xl w-full max-w-lg overflow-hidden z-10 flex flex-col max-h-[90vh] animate-fadeIn">
        {/* Header Modal */}
        <header className="px-6 py-4 bg-gradient-to-r from-rose-100 to-pink-100 border-b-2 border-rose-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-white border-2 border-rose-300 flex items-center justify-center text-xl shadow-sm text-rose-600">
              <AlertTriangle className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <h2
                id="recall-modal-title"
                className="text-base sm:text-lg font-black text-rose-950 flex items-center gap-1.5"
              >
                Thu Hồi Thông Báo
              </h2>
              <p className="text-[11px] font-bold text-rose-800">
                Gỡ thông báo khỏi hộp thư thông thường của học sinh
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              if (!isRecalling && !isSubmittingRef.current) onClose();
            }}
            disabled={isRecalling}
            aria-label="Đóng hộp thoại"
            className="p-2 rounded-2xl text-slate-600 hover:bg-white hover:text-rose-600 active:scale-95 transition-all border-2 border-transparent hover:border-rose-200 shadow-sm disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Nội dung chi tiết */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1 text-left">
          {/* Cảnh báo quy tắc thu hồi */}
          <div className="p-3.5 bg-rose-50 border-2 border-rose-200 rounded-2xl flex items-start gap-2.5 text-xs text-rose-900">
            <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-black text-sm">Lưu ý quan trọng về thu hồi thông báo:</p>
              <p className="font-bold text-slate-700 leading-relaxed">
                Thông báo sẽ <strong>không còn xuất hiện trong hộp thư thông thường</strong> của các em học sinh. Tuy nhiên, lịch sử biên nhận và phát hành vẫn được hệ thống lưu trữ phục vụ quản trị và đối soát minh bạch.
              </p>
              <p className="font-bold text-rose-800">
                * Thông báo sau khi thu hồi sẽ KHÔNG THỂ xuất bản lại.
              </p>
            </div>
          </div>

          {/* Banner lỗi từ RPC hoặc kết nối */}
          {errorMessage && (
            <div className="p-3.5 bg-rose-50 border-2 border-rose-200 rounded-2xl flex items-center justify-between text-xs text-rose-800">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span className="font-bold">{errorMessage}</span>
              </div>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="text-rose-600 hover:text-rose-900 font-black ml-2"
              >
                ✕
              </button>
            </div>
          )}

          {/* Thông tin thông báo sắp thu hồi */}
          <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
            <span className="text-[11px] font-bold text-slate-400 block mb-0.5">Tiêu đề thông báo:</span>
            <h3 className="text-sm sm:text-base font-black text-slate-900 break-words">
              {notification.title}
            </h3>
          </div>

          {/* Trường nhập lý do thu hồi */}
          <div>
            <label htmlFor="recall-reason" className="block text-xs font-black text-slate-800 mb-1.5">
              Lý do thu hồi (tùy chọn hoặc ghi chú đối soát):
            </label>
            <textarea
              ref={reasonInputRef}
              id="recall-reason"
              rows={3}
              value={recallReason}
              onChange={(e) => {
                setRecallReason(e.target.value);
                setErrorMessage(null);
              }}
              disabled={isRecalling}
              maxLength={500}
              placeholder="Ví dụ: Thay đổi thời gian thi học kỳ, gửi nhầm tệp đính kèm, cập nhật nội dung mới..."
              className="w-full px-4 py-2.5 rounded-2xl border-2 border-slate-200 focus:border-rose-400 focus:outline-none text-xs sm:text-sm font-medium text-slate-800 transition-all placeholder:text-slate-400 disabled:bg-slate-50 resize-y"
            />
            <div className="flex justify-end mt-1 text-[11px] font-bold text-slate-400">
              {recallReason.length}/500 ký tự
            </div>
          </div>
        </div>

        {/* Footer Modal */}
        <footer className="px-6 py-4 bg-slate-50 border-t-2 border-slate-100 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isRecalling}
            className="px-5 py-2.5 bg-white text-slate-700 hover:bg-slate-100 font-black text-xs rounded-2xl border-2 border-slate-200 transition-all disabled:opacity-50"
          >
            Hủy
          </button>

          <button
            type="button"
            onClick={handleConfirmRecall}
            disabled={isRecalling}
            className="px-6 py-2.5 bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 text-white font-black text-xs sm:text-sm rounded-2xl border-b-4 border-rose-800 shadow-md flex items-center gap-2 active:translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRecalling ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Đang thu hồi...</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-4 h-4" />
                <span>Xác Nhận Thu Hồi</span>
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  );
};
