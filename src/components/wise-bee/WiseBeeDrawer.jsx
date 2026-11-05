// src/components/wise-bee/WiseBeeDrawer.jsx
// Cửa sổ trò chuyện dạng Drawer (React Portal) dành cho Ong Thông Thái (R1 Mock Prototype)
// Quy tắc Ephemeral Chat: Chỉ lưu trong RAM của phiên; đóng Drawer hoặc kết thúc phiên là xóa sạch.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Send, RotateCcw } from 'lucide-react';
import {
  getWiseBeeRoleConfig,
  MAX_QUESTION_LENGTH_BY_ROLE,
  MAX_TURNS_PER_SESSION,
  requestWiseBeeMockReply,
  VALID_WISE_BEE_ROLES,
} from '../../services/wiseBeeClient.js';
import { WiseBeeSafetyBanner } from './WiseBeeSafetyBanner.jsx';
import { WiseBeePromptChips } from './WiseBeePromptChips.jsx';
import { WiseBeeMessageList } from './WiseBeeMessageList.jsx';

export const FOCUSABLE_SELECTOR =
  'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Lấy danh sách các phần tử tương tác có thể nhận focus bên trong Drawer (phục vụ Focus Trap)
 */
export function getDrawerFocusableElements(container) {
  if (!container || typeof container.querySelectorAll !== 'function') {
    return [];
  }
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el) => {
    if (!el || el.disabled) return false;
    if (typeof el.getAttribute === 'function' && el.getAttribute('aria-hidden') === 'true') {
      return false;
    }
    return true;
  });
}

export const WiseBeeDrawer = ({
  isOpen,
  role,
  activeUserId,
  onClose,
  launcherButtonRef,
}) => {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastFailedQuestion, setLastFailedQuestion] = useState('');

  const drawerAsideRef = useRef(null);
  const inputRef = useRef(null);
  const closeButtonRef = useRef(null);
  const requestCounterRef = useRef(0);
  const currentUserIdRef = useRef(activeUserId);
  const currentRoleRef = useRef(role);

  const isValidRole = VALID_WISE_BEE_ROLES.includes(role);
  const roleConfig = getWiseBeeRoleConfig(role);
  const maxLength = MAX_QUESTION_LENGTH_BY_ROLE[role] || 400;

  // Số lượt người dùng đã hỏi trong phiên hiện tại
  const userTurnCount = messages.filter((m) => m.sender === 'user').length;
  const isSessionTurnLimitReached = userTurnCount >= MAX_TURNS_PER_SESSION;

  /**
   * Xóa toàn bộ dữ liệu hội thoại tạm thời trong RAM
   */
  const clearEphemeralSession = useCallback(() => {
    requestCounterRef.current += 1; // Hủy mọi phản hồi đang chờ
    setMessages([]);
    setInputText('');
    setIsLoading(false);
    setError(null);
    setLastFailedQuestion('');
  }, []);

  /**
   * Đóng Drawer và thực thi chính sách "đóng phiên là mất" (xóa toàn bộ RAM)
   */
  const handleCloseAndWipe = useCallback(() => {
    clearEphemeralSession();
    if (typeof onClose === 'function') {
      onClose();
    }
    // Trả lại focus về nút mở Ong Thông Thái sau khi React render lại nút mở trong DOM
    setTimeout(() => {
      if (
        launcherButtonRef?.current &&
        launcherButtonRef.current.isConnected !== false &&
        typeof launcherButtonRef.current.focus === 'function'
      ) {
        launcherButtonRef.current?.focus();
      }
    }, 0);
  }, [clearEphemeralSession, onClose, launcherButtonRef]);

  // Cách ly tài khoản & vai trò: Khi đổi tài khoản, đăng xuất hoặc đóng Drawer -> xóa sạch RAM
  useEffect(() => {
    if (
      !isOpen ||
      !activeUserId ||
      !isValidRole ||
      currentUserIdRef.current !== activeUserId ||
      currentRoleRef.current !== role
    ) {
      clearEphemeralSession();
    }
    currentUserIdRef.current = activeUserId;
    currentRoleRef.current = role;
  }, [isOpen, activeUserId, role, isValidRole, clearEphemeralSession]);

  // Quản lý phím ESC, Focus Trap (Tab / Shift+Tab) và focus ban đầu khi mở Drawer
  useEffect(() => {
    if (!isOpen || !isValidRole) return undefined;

    const focusTimer = setTimeout(() => {
      if (inputRef.current && typeof inputRef.current.focus === 'function') {
        inputRef.current.focus();
      } else if (closeButtonRef.current && typeof closeButtonRef.current.focus === 'function') {
        closeButtonRef.current.focus();
      }
    }, 30);

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        handleCloseAndWipe();
        return;
      }

      if (event.key === 'Tab') {
        const container = drawerAsideRef.current;
        const focusables = getDrawerFocusableElements(container);
        if (focusables.length === 0) {
          event.preventDefault();
          return;
        }

        const firstEl = focusables[0];
        const lastEl = focusables[focusables.length - 1];
        const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
        const isInsideDrawer =
          activeEl &&
          container &&
          typeof container.contains === 'function' &&
          container.contains(activeEl);

        if (event.shiftKey) {
          if (!isInsideDrawer || activeEl === firstEl) {
            event.preventDefault();
            lastEl.focus();
          }
        } else if (!isInsideDrawer || activeEl === lastEl) {
          event.preventDefault();
          firstEl.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isValidRole, handleCloseAndWipe]);

  /**
   * Gửi câu hỏi vào Mock Provider cục bộ
   */
  const submitQuestion = async (rawQuestionText) => {
    if (!isOpen || !isValidRole || !activeUserId || isLoading) return;

    if (isSessionTurnLimitReached) {
      setError({
        code: 'SESSION_LIMIT_REACHED',
        message: `Phiên trò chuyện đã đạt tối đa ${MAX_TURNS_PER_SESSION} lượt hỏi. Vui lòng nhấn "Làm mới phiên" để bắt đầu phiên mới nhé!`,
        retryable: false,
      });
      return;
    }

    const cleanQuestion = typeof rawQuestionText === 'string' ? rawQuestionText.trim() : '';
    if (!cleanQuestion) {
      setError({
        code: 'EMPTY_INPUT',
        message: 'Vui lòng nhập câu hỏi hoặc chọn một gợi ý mẫu bên trên.',
        retryable: false,
      });
      return;
    }

    const currentReqId = ++requestCounterRef.current;
    const expectedUserId = activeUserId;
    const expectedRole = role;

    setError(null);
    setLastFailedQuestion('');
    setIsLoading(true);

    const res = await requestWiseBeeMockReply({
      role: expectedRole,
      question: cleanQuestion,
    });

    // Chặn race condition nếu đã đóng Drawer hoặc chuyển tài khoản
    if (
      currentReqId !== requestCounterRef.current ||
      currentUserIdRef.current !== expectedUserId ||
      currentRoleRef.current !== expectedRole
    ) {
      return;
    }

    setIsLoading(false);

    if (!res.ok) {
      const isRetryable = res.error?.code === 'MOCK_TEMPORARY_ERROR';
      if (isRetryable) {
        setLastFailedQuestion(cleanQuestion);
      }
      setError({
        code: res.error?.code || 'MOCK_ERROR',
        message: res.error?.message || 'Không thể xử lý câu hỏi lúc này.',
        retryable: isRetryable,
      });
      return;
    }

    const nowId = `${Date.now()}-${currentReqId}`;
    setInputText('');
    setMessages((prev) => [
      ...prev,
      {
        id: `user-${nowId}`,
        sender: 'user',
        text: cleanQuestion,
      },
      {
        id: `bee-${nowId}`,
        sender: 'assistant',
        text: res.data.reply,
      },
    ]);
  };

  const handleFormSubmit = (event) => {
    event.preventDefault();
    submitQuestion(inputText);
  };

  const handlePromptChipSelect = (promptText) => {
    setInputText(promptText);
    submitQuestion(promptText);
  };

  const handleRetryLast = () => {
    if (!lastFailedQuestion) return;
    submitQuestion(lastFailedQuestion);
  };

  if (!isOpen || !isValidRole || !roleConfig || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      data-wise-bee-portal="true"
      className="fixed inset-0 z-50 overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wise-bee-drawer-title"
    >
      {/* Lớp nền mờ: nhấn ra ngoài để đóng và xóa hội thoại tạm */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
        onClick={handleCloseAndWipe}
        aria-hidden="true"
      />

      {/* Ngăn kéo bên phải */}
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-0 sm:pl-10">
        <aside
          ref={drawerAsideRef}
          className="w-screen max-w-md bg-white shadow-2xl border-l-4 border-amber-300 flex flex-col h-full"
        >
          {/* Header Ong Thông Thái: Tiêu đề "🐝 Ong Thông Thái" rõ ràng, vai trò ở dòng phụ */}
          <header className="px-3.5 sm:px-4 py-3 bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-300 border-b-4 border-amber-500 flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h2
                id="wise-bee-drawer-title"
                className="text-base sm:text-lg font-black text-amber-950 leading-tight"
              >
                {roleConfig.headerTitle || '🐝 Ong Thông Thái'}
              </h2>
              <p className="text-[11px] sm:text-xs font-extrabold text-amber-900 mt-0.5 leading-snug">
                {roleConfig.roleSubtitle || roleConfig.badgeText}
              </p>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={clearEphemeralSession}
                title="Kết thúc phiên hiện tại và xóa nội dung trò chuyện"
                aria-label="Làm mới phiên trò chuyện"
                className="px-2.5 py-1.5 rounded-xl bg-amber-100 hover:bg-white text-amber-950 font-black text-xs border-2 border-amber-600 flex items-center gap-1 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-900"
              >
                <RotateCcw className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Làm mới</span>
              </button>

              <button
                ref={closeButtonRef}
                type="button"
                onClick={handleCloseAndWipe}
                aria-label="Đóng Ong Thông Thái và xóa cuộc trò chuyện tạm thời"
                title="Đóng cửa sổ (ESC)"
                className="p-2 rounded-xl bg-white/90 hover:bg-white text-amber-950 border-2 border-amber-600 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-900"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </header>

          {/* Thanh cảnh báo an toàn & nhận diện bản mô phỏng */}
          <WiseBeeSafetyBanner role={role} />

          {/* Các nút câu hỏi gợi ý theo vai trò */}
          <WiseBeePromptChips
            role={role}
            onSelectPrompt={handlePromptChipSelect}
            disabled={isLoading || isSessionTurnLimitReached}
          />

          {/* Danh sách tin nhắn trong phiên */}
          <WiseBeeMessageList
            role={role}
            messages={messages}
            isLoading={isLoading}
            error={error}
            onRetryLastQuestion={handleRetryLast}
          />

          {/* Khu vực nhập câu hỏi cuối Drawer */}
          <footer className="p-3 bg-white border-t-2 border-amber-200">
            <form onSubmit={handleFormSubmit} className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-600 px-1">
                <span>
                  Lượt: {userTurnCount}/{MAX_TURNS_PER_SESSION} • 🔒 Tự xóa khi đóng phiên
                </span>
                <span>
                  {inputText.length}/{maxLength} ký tự
                </span>
              </div>

              <div className="flex items-end gap-2">
                <label htmlFor="wise-bee-question-input" className="sr-only">
                  Nhập câu hỏi cho Ong Thông Thái
                </label>
                <textarea
                  id="wise-bee-question-input"
                  ref={inputRef}
                  rows={2}
                  maxLength={maxLength}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  disabled={isLoading || isSessionTurnLimitReached}
                  placeholder={
                    isSessionTurnLimitReached
                      ? 'Đã hết lượt hỏi trong phiên. Nhấn "Làm mới" để tiếp tục.'
                      : 'Nhập câu hỏi hoặc bấm chọn gợi ý phía trên...'
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      submitQuestion(inputText);
                    }
                  }}
                  className="flex-1 resize-none rounded-2xl border-2 border-amber-300 px-3 py-2 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-300 disabled:bg-slate-100 disabled:text-slate-500"
                />

                <button
                  type="submit"
                  disabled={isLoading || isSessionTurnLimitReached || !inputText.trim()}
                  aria-label="Gửi câu hỏi cho Ong Thông Thái"
                  className="px-4 py-3 rounded-2xl bg-amber-500 hover:bg-amber-600 text-amber-950 font-black text-xs border-2 border-amber-700 shadow-xs flex items-center gap-1.5 transition-all active:scale-95 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                >
                  <Send className="w-4 h-4" aria-hidden="true" />
                  <span>Gửi</span>
                </button>
              </div>
            </form>
          </footer>
        </aside>
      </div>
    </div>,
    document.body
  );
};
