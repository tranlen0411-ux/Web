// src/components/notifications/NotificationBell.jsx
// Biểu tượng chuông thông báo dành cho Học sinh & Giáo viên (Notifications V1 R3-B1 & R3-E1)
// Tích hợp Polling an toàn với Page Visibility API & Auth State Isolation
// Hỗ trợ cả Học sinh và Giáo viên; Tuyệt đối không bật cho Admin hoặc Anon

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Bell, BellRing } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { getUnreadNotificationCount } from '../../services/notificationClient.js';
import { NotificationDrawer } from './NotificationDrawer.jsx';

const POLLING_INTERVAL_MS = 60000; // 60 giây mỗi chu kỳ
const MIN_VISIBILITY_REFRESH_GAP_MS = 60000; // Tối thiểu 60 giây giữa các lần refresh tự động khi đổi tab

export const NotificationBell = () => {
  const { user, profile } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Lưu trữ thời điểm fetch gần nhất để throttle khi đổi visibility
  const lastFetchTimeRef = useRef(0);
  const isMountedRef = useRef(true);
  const currentUserIdRef = useRef(user?.id);

  // Phân quyền: Học sinh (R3-B1) và Giáo viên (R3-E1). Không kích hoạt cho Admin hoặc Anon.
  const isStudent = user && profile?.role === 'student';
  const isTeacher = user && profile?.role === 'teacher';
  const isRecipient = isStudent || isTeacher;

  /**
   * Gọi hàm đếm số thông báo chưa đọc từ Backend
   */
  const fetchUnreadCount = useCallback(async () => {
    // Chỉ thực thi nếu người dùng là học sinh hoặc giáo viên và đang có phiên đăng nhập
    if (!user || (!isStudent && !isTeacher)) {
      if (isMountedRef.current) setUnreadCount(0);
      return;
    }

    // Nếu tab trình duyệt đang ẩn, không gọi request
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return;
    }

    try {
      const activeUserId = user.id;
      const res = await getUnreadNotificationCount();

      // Kiểm tra component còn mount và đúng user hiện tại không (chống race condition)
      if (isMountedRef.current && currentUserIdRef.current === activeUserId) {
        if (res.ok && typeof res.data === 'number') {
          setUnreadCount(res.data);
        }
        lastFetchTimeRef.current = Date.now();
      }
    } catch {
      // Giữ nguyên trạng thái trước đó, không làm sập giao diện
    }
  }, [user, isStudent, isTeacher]);

  // Quản lý cách ly tài khoản (Auth State Isolation):
  // Khi đăng xuất hoặc đổi tài khoản -> lập tức reset toàn bộ state
  useEffect(() => {
    currentUserIdRef.current = user?.id;

    if (!user || (!isStudent && !isTeacher)) {
      setUnreadCount(0);
      setIsDrawerOpen(false);
      return;
    }

    // Tải ngay khi người dùng đăng nhập hoặc chuyển sang vai trò người nhận (học sinh / giáo viên)
    fetchUnreadCount();
  }, [user, isStudent, isTeacher, fetchUnreadCount]);

  // Quản lý chu kỳ Polling và Visibility Change an toàn
  useEffect(() => {
    isMountedRef.current = true;

    if (!isRecipient) return;

    // 1. Timer polling định kỳ 60 giây khi trang hiển thị
    const intervalId = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchUnreadCount();
      }
    }, POLLING_INTERVAL_MS);

    // 2. Lắng nghe sự kiện chuyển đổi tab (Visibility Change)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const now = Date.now();
        // Chỉ refresh nếu đã quá 60 giây kể từ lần gọi gần nhất (tránh spam request khi user đổi tab liên tục)
        if (now - lastFetchTimeRef.current >= MIN_VISIBILITY_REFRESH_GAP_MS) {
          fetchUnreadCount();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMountedRef.current = false;
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isRecipient, fetchUnreadCount]);

  // Trong R3-E1: HIỂN THỊ CHO HỌC SINH VÀ GIÁO VIÊN ĐÃ ĐĂNG NHẬP (KHÔNG HIỆN CHO ADMIN HOẶC ANON)
  if (!isRecipient) {
    return null;
  }

  const hasUnread = unreadCount > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsDrawerOpen((prev) => !prev)}
        aria-label="Thông báo của bạn"
        title={hasUnread ? `Bạn có ${unreadCount} thông báo chưa đọc` : 'Hộp thư thông báo'}
        className={`p-2 rounded-2xl border-2 transition-all relative flex items-center justify-center active:scale-95 ${
          hasUnread
            ? 'bg-amber-50 hover:bg-amber-100 border-amber-300 text-amber-900 shadow-sm'
            : 'bg-slate-50 hover:bg-amber-50 border-slate-200 text-slate-600 hover:text-amber-900'
        }`}
      >
        {/* Biểu tượng chuông */}
        {hasUnread ? (
          <BellRing className="w-5 h-5 text-amber-700 animate-wiggle" />
        ) : (
          <Bell className="w-5 h-5" />
        )}

        {/* Badge số chưa đọc (Chỉ hiện khi > 0, tuyệt đối không hiện số 0) */}
        {hasUnread && (
          <span
            className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white text-[10px] font-black min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center border-2 border-white shadow-sm"
            aria-hidden="true"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Hộp thư danh sách thông báo Drawer */}
      <NotificationDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        unreadCount={unreadCount}
        onRefreshUnread={fetchUnreadCount}
      />
    </>
  );
};
