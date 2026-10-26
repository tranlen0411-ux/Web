// src/components/notifications/NotificationDrawer.jsx
// Hộp thư xem danh sách thông báo dành riêng cho Học sinh (Notifications V1 R3-B2)
// Hỗ trợ xem chi tiết NotificationDetailModal & Đánh dấu đã đọc qua RPC markNotificationAsRead

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  RefreshCw,
  Bell,
  Inbox,
  AlertCircle,
  Clock,
  User,
  CheckCircle2,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { getMyNotifications, markNotificationAsRead } from '../../services/notificationClient.js';
import { NotificationDetailModal } from './NotificationDetailModal.jsx';

const PAGE_SIZE = 20;

/**
 * Format thời gian gửi thân thiện với học sinh
 */
function formatNotificationTime(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();

    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');

    if (isToday) {
      return `Hôm nay, ${hours}:${minutes}`;
    }

    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${d.getFullYear()} ${hours}:${minutes}`;
  } catch {
    return '';
  }
}

export const NotificationDrawer = ({
  isOpen,
  onClose,
  unreadCount = 0,
  onRefreshUnread
}) => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'unread'
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  // State quản lý xem chi tiết và đánh dấu đã đọc (R3-B2)
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isMarkingRead, setIsMarkingRead] = useState(false);
  const [markReadError, setMarkReadError] = useState(null);

  // Quản lý chặn double-click và cách ly phiên tài khoản
  const markingIdRef = useRef(null);
  const activeRequestIdRef = useRef(0);
  const currentUserIdRef = useRef(user?.id);

  useEffect(() => {
    currentUserIdRef.current = user?.id;
  }, [user?.id]);

  /**
   * Tải dữ liệu trang đầu tiên (offset = 0)
   */
  const fetchFirstPage = useCallback(
    async (tabMode) => {
      const currentRequestId = ++activeRequestIdRef.current;
      setLoading(true);
      setError(null);

      const unreadOnly = tabMode === 'unread';
      const res = await getMyNotifications({
        limit: PAGE_SIZE,
        offset: 0,
        unreadOnly
      });

      // Nếu có request mới hơn thì bỏ qua kết quả cũ
      if (currentRequestId !== activeRequestIdRef.current) return;

      setLoading(false);

      if (!res.ok) {
        setError(res.error?.message || 'Không thể tải thông báo. Vui lòng thử lại.');
        setNotifications([]);
        setHasMore(false);
        return;
      }

      const items = Array.isArray(res.data) ? res.data : [];
      setNotifications(items);
      setOffset(items.length);
      setHasMore(items.length >= PAGE_SIZE);

      // Cập nhật lại số chưa đọc ở chuông từ backend
      if (typeof onRefreshUnread === 'function') {
        onRefreshUnread();
      }
    },
    [onRefreshUnread]
  );

  /**
   * Tải thêm thông báo (phân trang)
   */
  const handleLoadMore = async () => {
    if (loadingMore || !hasMore) return;

    setLoadingMore(true);
    const unreadOnly = activeTab === 'unread';

    const res = await getMyNotifications({
      limit: PAGE_SIZE,
      offset: offset,
      unreadOnly
    });

    setLoadingMore(false);

    if (!res.ok) {
      setError(res.error?.message || 'Không thể tải thêm thông báo.');
      return;
    }

    const newItems = Array.isArray(res.data) ? res.data : [];
    setNotifications((prev) => [...prev, ...newItems]);
    setOffset((prev) => prev + newItems.length);
    setHasMore(newItems.length >= PAGE_SIZE);
  };

  /**
   * Thực hiện gọi RPC đánh dấu đã đọc một cách an toàn
   */
  const executeMarkAsRead = async (item) => {
    if (!item?.id || item.is_read) return;

    // Chặn request trùng lặp và double-click
    if (markingIdRef.current === item.id) return;

    markingIdRef.current = item.id;
    setIsMarkingRead(true);
    setMarkReadError(null);

    const activeUserId = user?.id;

    try {
      const res = await markNotificationAsRead(item.id);

      // Cách ly chuyển đổi tài khoản (Auth Switch Isolation):
      // Nếu user đăng xuất hoặc đổi tài khoản trong lúc request đang bay -> dừng ngay lập tức
      if (currentUserIdRef.current !== activeUserId) return;

      if (res.ok) {
        if (res.data === true) {
          const readTimestamp = new Date().toISOString();

          // 1. Cập nhật state danh sách cục bộ
          setNotifications((prev) =>
            prev.map((n) =>
              n.id === item.id ? { ...n, is_read: true, read_at: readTimestamp } : n
            )
          );

          // 2. Cập nhật item đang xem trong modal
          setSelectedNotification((prev) =>
            prev && prev.id === item.id
              ? { ...prev, is_read: true, read_at: readTimestamp }
              : prev
          );

          // 3. Yêu cầu NotificationBell refresh unread count chính xác từ Backend
          if (typeof onRefreshUnread === 'function') {
            onRefreshUnread();
          }
        } else {
          setMarkReadError(
            res.error ||
            new Error('Máy chủ chưa xác nhận đánh dấu đã đọc thành công.')
          );
        }
      } else {
        // Lỗi: Giữ nguyên trạng thái chưa đọc, hiển thị lỗi trong modal
        setMarkReadError(res.error);

        // Nếu thông báo đã bị thu hồi hoặc mất quyền nhận -> refresh lại danh sách để loại bỏ bản ghi
        const errCode = res.error?.code;
        if (
          errCode === 'FORBIDDEN_RECALLED' ||
          errCode === 'FORBIDDEN_NOT_RECIPIENT' ||
          errCode === 'NOT_FOUND'
        ) {
          fetchFirstPage(activeTab);
        }
      }
    } catch (err) {
      if (currentUserIdRef.current === activeUserId) {
        setMarkReadError(err);
      }
    } finally {
      if (currentUserIdRef.current === activeUserId) {
        setIsMarkingRead(false);
        markingIdRef.current = null;
      }
    }
  };

  /**
   * Mở xem chi tiết thông báo
   */
  const handleOpenDetail = (item) => {
    setSelectedNotification(item);
    setIsDetailOpen(true);
    setMarkReadError(null);

    // CHỈ GỌI RPC KHI THÔNG BÁO ĐANG CHƯA ĐỌC
    if (!item.is_read) {
      executeMarkAsRead(item);
    }
  };

  /**
   * Đóng xem chi tiết
   */
  const handleCloseDetail = () => {
    setIsDetailOpen(false);
    setSelectedNotification(null);
    setMarkReadError(null);
    markingIdRef.current = null;

    // Nếu đang ở tab Chưa đọc và có thông báo vừa đọc xong -> refresh để đồng bộ danh sách
    if (activeTab === 'unread') {
      fetchFirstPage('unread');
    }
  };

  // Kích hoạt tải dữ liệu khi Drawer mở hoặc khi đổi tab
  useEffect(() => {
    if (isOpen) {
      fetchFirstPage(activeTab);
    } else {
      setError(null);
      setIsDetailOpen(false);
      setSelectedNotification(null);
      setMarkReadError(null);
    }
  }, [isOpen, activeTab, fetchFirstPage]);

  // Đóng Drawer khi bấm phím Escape (nếu modal detail chưa mở)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen && !isDetailOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isDetailOpen, onClose]);

  // Khi đăng xuất hoặc không có user -> dọn sạch toàn bộ state
  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setSelectedNotification(null);
      setIsDetailOpen(false);
      markingIdRef.current = null;
    }
  }, [user]);

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-50 overflow-hidden">
        {/* Nền mờ Backdrop */}
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />

        {/* Thân Drawer trượt từ bên phải */}
        <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
          <aside
            className="w-screen max-w-md bg-white border-l-4 border-amber-300 shadow-2xl flex flex-col focus:outline-none"
            role="dialog"
            aria-modal="true"
            aria-labelledby="drawer-title"
          >
            {/* HEADER DRAWER */}
            <header className="px-5 py-4 bg-gradient-to-r from-amber-100/90 to-yellow-100/90 border-b-2 border-amber-200 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-400 border-2 border-amber-300 flex items-center justify-center text-lg shadow-sm">
                  📬
                </div>
                <div>
                  <h2 id="drawer-title" className="text-base font-black text-amber-950 flex items-center gap-1.5">
                    Hộp Thư Thông Báo
                  </h2>
                  <p className="text-[11px] font-bold text-amber-800">
                    Tin tức từ Thầy Cô & Nhà Trường
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                {/* Nút làm mới danh sách */}
                <button
                  onClick={() => fetchFirstPage(activeTab)}
                  disabled={loading}
                  title="Làm mới"
                  className="p-2 rounded-xl text-amber-800 hover:bg-amber-200/80 active:scale-95 transition-all disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>

                {/* Nút đóng */}
                <button
                  onClick={onClose}
                  title="Đóng"
                  className="p-2 rounded-xl text-slate-600 hover:bg-rose-100 hover:text-rose-700 active:scale-95 transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </header>

            {/* TAB CHUYỂN CHẾ ĐỘ XEM: TẤT CẢ / CHƯA ĐỌC */}
            <nav className="flex items-center border-b-2 border-slate-100 bg-amber-50/40 px-5 pt-2">
              <button
                onClick={() => setActiveTab('all')}
                className={`pb-2.5 px-3 font-black text-xs transition-all relative flex items-center gap-1.5 ${
                  activeTab === 'all'
                    ? 'text-amber-900 border-b-2 border-amber-500'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <span>Tất cả</span>
              </button>

              <button
                onClick={() => setActiveTab('unread')}
                className={`pb-2.5 px-3 font-black text-xs transition-all relative flex items-center gap-1.5 ${
                  activeTab === 'unread'
                    ? 'text-amber-900 border-b-2 border-amber-500'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <span>Chưa đọc</span>
                {unreadCount > 0 && (
                  <span className="bg-rose-500 text-white text-[10px] font-black px-1.5 py-0.2 rounded-full">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
            </nav>

            {/* DANH SÁCH THÔNG BÁO */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {/* Trạng thái lỗi */}
              {error && (
                <div className="p-3.5 bg-rose-50 border-2 border-rose-200 rounded-2xl flex items-start gap-2.5 text-rose-800 text-xs">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-bold">{error}</p>
                    <button
                      onClick={() => fetchFirstPage(activeTab)}
                      className="mt-2 inline-flex items-center gap-1 font-black text-rose-700 underline hover:text-rose-900"
                    >
                      <RefreshCw className="w-3 h-3" /> Thử lại ngay
                    </button>
                  </div>
                </div>
              )}

              {/* Trạng thái tải lần đầu */}
              {loading && notifications.length === 0 && (
                <div className="space-y-3 pt-2">
                  {[1, 2, 3].map((n) => (
                    <div
                      key={n}
                      className="p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl animate-pulse space-y-2"
                    >
                      <div className="h-4 bg-slate-200 rounded w-3/4" />
                      <div className="h-3 bg-slate-200 rounded w-full" />
                      <div className="h-3 bg-slate-200 rounded w-1/2" />
                    </div>
                  ))}
                </div>
              )}

              {/* Trạng thái danh sách rỗng */}
              {!loading && !error && notifications.length === 0 && (
                <div className="py-12 px-4 text-center">
                  <div className="w-16 h-16 mx-auto mb-3 bg-amber-100 text-amber-600 rounded-3xl flex items-center justify-center text-3xl shadow-inner">
                    <Inbox className="w-8 h-8 text-amber-500" />
                  </div>
                  <p className="text-sm font-black text-amber-950">
                    {activeTab === 'unread'
                      ? 'Bạn đã đọc hết thông báo rồi! 🎉'
                      : 'Chưa có thông báo nào dành cho bạn!'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                    {activeTab === 'unread'
                      ? 'Thật tuyệt vời! Hãy đón chờ các thông báo mới từ Thầy Cô nhé.'
                      : 'Các thông báo mới về bài tập và hoạt động lớp sẽ hiển thị tại đây.'}
                  </p>
                </div>
              )}

              {/* Danh sách item thông báo */}
              {notifications.map((item) => {
                const isUrgent = item.priority === 'urgent';
                const isHigh = item.priority === 'high';
                const isUnread = !item.is_read;

                return (
                  <article
                    key={item.id}
                    onClick={() => handleOpenDetail(item)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleOpenDetail(item);
                      }
                    }}
                    className={`p-4 rounded-2xl border-2 transition-all text-left relative cursor-pointer hover:shadow-md active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-amber-400 ${
                      isUnread
                        ? 'bg-amber-50/70 border-amber-300 hover:border-amber-400 shadow-sm'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {/* Dòng Header: Mức ưu tiên + Trạng thái Đã đọc/Chưa đọc */}
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-1.5">
                        {isUrgent && (
                          <span className="px-2 py-0.5 bg-rose-100 border border-rose-300 text-rose-800 text-[10px] font-black rounded-lg">
                            🚨 Khẩn cấp
                          </span>
                        )}
                        {isHigh && (
                          <span className="px-2 py-0.5 bg-amber-100 border border-amber-300 text-amber-800 text-[10px] font-black rounded-lg">
                            ⭐ Quan trọng
                          </span>
                        )}
                        {!isUrgent && !isHigh && (
                          <span className="px-2 py-0.5 bg-sky-50 border border-sky-200 text-sky-800 text-[10px] font-black rounded-lg">
                            📌 Thông báo
                          </span>
                        )}
                      </div>

                      <div>
                        {isUnread ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-black text-amber-800 bg-amber-200/60 px-2 py-0.5 rounded-full">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                            Mới
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400">
                            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                            Đã đọc
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Tiêu đề thông báo */}
                    <h3 className="text-sm font-black text-amber-950 mb-1 leading-snug break-words">
                      {item.title}
                    </h3>

                    {/* Nội dung tóm tắt thuần text (chống XSS) */}
                    <p className="text-xs text-slate-700 whitespace-pre-line line-clamp-2 mb-2.5 break-words">
                      {item.content}
                    </p>

                    {/* Footer thông báo: Người gửi + Thời gian + Gợi ý xem */}
                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] font-bold text-slate-500">
                      <span className="flex items-center gap-1 truncate max-w-[170px]">
                        <User className="w-3 h-3 text-amber-600 shrink-0" />
                        <span className="truncate">{item.sender_name || 'Nhà trường'}</span>
                      </span>

                      <div className="flex items-center gap-1 shrink-0 text-amber-800">
                        <Clock className="w-3 h-3 text-slate-400" />
                        <span>{formatNotificationTime(item.published_at)}</span>
                        <ChevronRight className="w-3.5 h-3.5 ml-0.5 text-amber-600" />
                      </div>
                    </div>
                  </article>
                );
              })}

              {/* Nút Tải thêm phân trang */}
              {hasMore && (
                <div className="pt-2 pb-1 text-center">
                  <button
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="w-full py-2.5 px-4 bg-amber-50 hover:bg-amber-100 border-2 border-amber-200 rounded-2xl text-xs font-black text-amber-900 flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
                  >
                    {loadingMore ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Đang tải thêm...</span>
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-3.5 h-3.5" />
                        <span>Xem thêm thông báo cũ hơn</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>

      {/* Modal xem chi tiết và đánh dấu đã đọc (R3-B2) */}
      <NotificationDetailModal
        isOpen={isDetailOpen}
        notification={selectedNotification}
        onClose={handleCloseDetail}
        isMarkingRead={isMarkingRead}
        markReadError={markReadError}
        onRetryMarkAsRead={() => {
          if (selectedNotification && !selectedNotification.is_read) {
            executeMarkAsRead(selectedNotification);
          }
        }}
      />
    </>,
    document.body
  );
};
