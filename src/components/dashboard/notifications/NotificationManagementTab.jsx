// src/components/dashboard/notifications/NotificationManagementTab.jsx
// Tab Quản lý Thông báo dành cho Giáo viên (Notifications V1 R3-C1 - READ ONLY UI)
// Thiết kế thân thiện, bảo mật Zero-Trust, phân trang ổn định, cách ly tài khoản

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Bell,
  RefreshCw,
  AlertCircle,
  Clock,
  Send,
  FileText,
  AlertTriangle,
  School,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Plus,
  CheckCircle2
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext.jsx';
import { getSentNotifications } from '../../../services/notificationClient.js';
import { formatClassLabel } from '../../../utils/helpers.js';
import { CreateNotificationModal } from './CreateNotificationModal.jsx';
import { PublishNotificationModal } from './PublishNotificationModal.jsx';
import { RecallNotificationModal } from './RecallNotificationModal.jsx';

const PAGE_SIZE = 20;

/**
 * Format thời gian hiển thị ngày giờ chuẩn Tiếng Việt
 */
function formatDateTime(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${hours}:${minutes} - ${day}/${month}/${year}`;
  } catch {
    return '';
  }
}

export const NotificationManagementTab = ({ role = 'teacher', classes = [] }) => {
  const { user, profile } = useAuth();

  // Bộ lọc trạng thái: 'all' | 'draft' | 'published' | 'recalled'
  const [statusFilter, setStatusFilter] = useState('all');
  const [notifications, setNotifications] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Trạng thái Modal Soạn Thông Báo & Toast thông báo (R3-C2A)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // Trạng thái Modal Xuất Bản Bản Nháp & Thu Hồi Thông Báo (R3-C2B)
  const [selectedDraftForPublish, setSelectedDraftForPublish] = useState(null);
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);

  const [selectedNotifForRecall, setSelectedNotifForRecall] = useState(null);
  const [isRecallModalOpen, setIsRecallModalOpen] = useState(false);

  // Quản lý chặn Stale Response và cách ly phiên tài khoản
  const activeRequestIdRef = useRef(0);
  const currentUserIdRef = useRef(user?.id);

  useEffect(() => {
    currentUserIdRef.current = user?.id;
  }, [user?.id]);

  // Tạo map tên lớp từ classes prop để hiển thị thân thiện
  const classNameMap = useRef(new Map());
  useEffect(() => {
    const map = new Map();
    if (Array.isArray(classes)) {
      classes.forEach((c) => {
        if (c?.id && c?.name) {
          map.set(c.id, formatClassLabel(c.name));
        }
      });
    }
    classNameMap.current = map;
  }, [classes]);

  /**
   * Tải danh sách thông báo đã tạo từ Backend
   */
  const fetchSentNotifications = useCallback(
    async (pageToLoad, filterToApply) => {
      // Chỉ tải nếu đã đăng nhập và mang vai trò hợp lệ
      if (!user || (profile?.role !== 'teacher' && profile?.role !== 'admin')) {
        setNotifications([]);
        setTotalCount(0);
        return;
      }

      const currentRequestId = ++activeRequestIdRef.current;
      const activeUserId = user.id;

      setLoading(true);
      setError(null);

      const offset = (pageToLoad - 1) * PAGE_SIZE;

      try {
        const res = await getSentNotifications({
          limit: PAGE_SIZE,
          offset,
          status: filterToApply
        });

        // Chống Race Condition: Kiểm tra request mới nhất và đúng user
        if (
          currentRequestId !== activeRequestIdRef.current ||
          currentUserIdRef.current !== activeUserId
        ) {
          return;
        }

        setLoading(false);

        if (!res.ok) {
          setError(res.error?.message || 'Không thể tải danh sách thông báo. Vui lòng thử lại.');
          setNotifications([]);
          setTotalCount(0);
          return;
        }

        setNotifications(Array.isArray(res.data) ? res.data : []);
        setTotalCount(typeof res.count === 'number' ? res.count : 0);
      } catch (err) {
        if (
          currentRequestId === activeRequestIdRef.current &&
          currentUserIdRef.current === activeUserId
        ) {
          setLoading(false);
          setError(err?.message || 'Đã xảy ra lỗi kết nối khi tải danh sách.');
          setNotifications([]);
          setTotalCount(0);
        }
      }
    },
    [user, profile?.role]
  );

  // Kích hoạt tải dữ liệu khi trang hoặc bộ lọc trạng thái thay đổi
  useEffect(() => {
    fetchSentNotifications(currentPage, statusFilter);
  }, [currentPage, statusFilter, fetchSentNotifications]);

  // Khi đăng xuất hoặc chuyển đổi tài khoản -> lập tức reset toàn bộ dữ liệu & đóng modal
  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setTotalCount(0);
      setCurrentPage(1);
      setError(null);
      setIsCreateModalOpen(false);
      setIsPublishModalOpen(false);
      setSelectedDraftForPublish(null);
      setIsRecallModalOpen(false);
      setSelectedNotifForRecall(null);
    }
  }, [user]);

  /**
   * Chuyển đổi bộ lọc trạng thái
   */
  const handleFilterChange = (newStatus) => {
    setStatusFilter(newStatus);
    setCurrentPage(1); // Reset về trang 1
  };

  /**
   * Callback sau khi Thầy/Cô lưu bản nháp thành công từ CreateNotificationModal
   */
  const handleDraftCreated = () => {
    setToastMessage('Đã lưu bản nháp thông báo thành công!');
    setTimeout(() => {
      setToastMessage(null);
    }, 4500);

    // Nếu đang ở bộ lọc Đã gửi hoặc Đã thu hồi, chuyển về 'all' để Thầy/Cô thấy ngay bản nháp vừa tạo
    if (statusFilter === 'published' || statusFilter === 'recalled') {
      setStatusFilter('all');
    }
    setCurrentPage(1);
    fetchSentNotifications(1, statusFilter === 'published' || statusFilter === 'recalled' ? 'all' : statusFilter);
  };

  /**
   * Mở modal xuất bản bản nháp (R3-C2B)
   */
  const handleOpenPublishModal = (draft) => {
    setSelectedDraftForPublish(draft);
    setIsPublishModalOpen(true);
  };

  /**
   * Callback sau khi xuất bản bản nháp thành công (R3-C2B)
   */
  const handlePublished = () => {
    setToastMessage('Đã xuất bản thông báo tới học sinh thành công!');
    setTimeout(() => {
      setToastMessage(null);
    }, 4500);

    // Làm mới danh sách và cập nhật trạng thái
    fetchSentNotifications(currentPage, statusFilter);
  };

  /**
   * Mở modal thu hồi thông báo (R3-C2B)
   */
  const handleOpenRecallModal = (notif) => {
    setSelectedNotifForRecall(notif);
    setIsRecallModalOpen(true);
  };

  /**
   * Callback sau khi thu hồi thông báo thành công (R3-C2B)
   */
  const handleRecalled = () => {
    setToastMessage('Đã thu hồi thông báo thành công!');
    setTimeout(() => {
      setToastMessage(null);
    }, 4500);

    // Làm mới danh sách và cập nhật trạng thái
    fetchSentNotifications(currentPage, statusFilter);
  };

  /**
   * Chuyển trang phân trang
   */
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const handlePrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage((prev) => prev - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage((prev) => prev + 1);
    }
  };

  /**
   * Helper hiển thị nhãn phạm vi nhận tin
   */
  const renderTargetScopeLabel = (item) => {
    if (item.target_type === 'classes') {
      const classIds = Array.isArray(item.target_class_ids) ? item.target_class_ids : [];
      if (classIds.length === 0) return 'Chưa gán lớp';

      const names = classIds
        .map((id) => classNameMap.current.get(id))
        .filter(Boolean);

      if (names.length > 0) {
        return names.join(', ');
      }
      return `${classIds.length} lớp học được chọn`;
    }

    if (item.target_type === 'grade') {
      return `Toàn bộ Khối ${item.target_grade_level || ''}`;
    }

    if (item.target_type === 'all') {
      return 'Toàn trường (Tất cả Giáo viên & Học sinh)';
    }

    return 'Không xác định';
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* HEADER KHU VỰC QUẢN LÝ THÔNG BÁO */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 sm:p-6 rounded-3xl border-4 border-amber-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-3 py-1 bg-rose-100 text-rose-800 text-xs font-black rounded-xl uppercase">
              📢 Quản Lý Tin Nhắn & Thông Báo Lớp
            </span>
            <span className="text-xs font-bold text-slate-500">
              (Chế độ xem danh sách – R3-C1)
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-800">
            Lịch Sử Thông Báo Lớp Học
          </h2>
          <p className="text-xs sm:text-sm font-bold text-slate-500 mt-0.5">
            Xem lại các bản nháp, thông báo đã phát hành hoặc thông báo đã thu hồi của Thầy/Cô.
          </p>
        </div>

        {/* Nhóm nút hành động: Soạn thông báo mới & Làm mới */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="px-4 py-2.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-amber-950 font-black text-xs rounded-2xl border-b-4 border-amber-600 shadow-sm flex items-center gap-1.5 active:translate-y-0.5 transition-all"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>Soạn Thông Báo</span>
          </button>

          <button
            onClick={() => fetchSentNotifications(currentPage, statusFilter)}
            disabled={loading}
            className="px-4 py-2.5 bg-slate-50 hover:bg-amber-50 text-slate-700 hover:text-amber-900 border-2 border-slate-200 rounded-2xl font-black text-xs flex items-center gap-2 active:scale-95 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Làm mới</span>
          </button>
        </div>
      </div>

      {/* TOAST THÔNG BÁO LƯU BẢN NHÁP THÀNH CÔNG */}
      {toastMessage && (
        <div className="p-4 bg-emerald-50 border-2 border-emerald-300 rounded-2xl flex items-center justify-between text-emerald-900 text-xs shadow-sm animate-fadeIn">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-bold">{toastMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="text-emerald-700 hover:text-emerald-900 font-black ml-2"
          >
            ✕
          </button>
        </div>
      )}

      {/* BỘ LỌC TRẠNG THÁI (FILTERS) */}
      <div className="flex flex-wrap items-center gap-2 bg-white p-2.5 rounded-2xl border-2 border-amber-200">
        <button
          onClick={() => handleFilterChange('all')}
          className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${
            statusFilter === 'all'
              ? 'bg-amber-500 text-white shadow-sm'
              : 'text-slate-600 hover:bg-amber-50'
          }`}
        >
          <span>Tất cả</span>
          <span className="bg-white/30 text-white text-[10px] px-1.5 py-0.2 rounded-full">
            {totalCount}
          </span>
        </button>

        <button
          onClick={() => handleFilterChange('published')}
          className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${
            statusFilter === 'published'
              ? 'bg-emerald-500 text-white shadow-sm'
              : 'text-slate-600 hover:bg-emerald-50'
          }`}
        >
          <Send className="w-3.5 h-3.5" />
          <span>Đã gửi</span>
        </button>

        <button
          onClick={() => handleFilterChange('draft')}
          className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${
            statusFilter === 'draft'
              ? 'bg-slate-700 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Bản nháp</span>
        </button>

        <button
          onClick={() => handleFilterChange('recalled')}
          className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${
            statusFilter === 'recalled'
              ? 'bg-rose-500 text-white shadow-sm'
              : 'text-slate-600 hover:bg-rose-50'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>Đã thu hồi</span>
        </button>
      </div>

      {/* HIỂN THỊ LỖI NẾU CÓ */}
      {error && (
        <div className="p-4 bg-rose-50 border-2 border-rose-200 rounded-2xl flex items-center justify-between text-rose-800 text-xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-bold">{error}</span>
          </div>
          <button
            onClick={() => fetchSentNotifications(currentPage, statusFilter)}
            className="font-black text-rose-900 underline hover:text-rose-700"
          >
            Thử lại
          </button>
        </div>
      )}

      {/* DANH SÁCH THÔNG BÁO QUẢN LÝ */}
      <div className="space-y-4">
        {/* Loading skeleton */}
        {loading && notifications.length === 0 && (
          <div className="space-y-3">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="p-5 bg-white rounded-3xl border-2 border-slate-200 animate-pulse space-y-3"
              >
                <div className="h-5 bg-slate-200 rounded w-1/3" />
                <div className="h-4 bg-slate-100 rounded w-full" />
                <div className="h-4 bg-slate-100 rounded w-2/3" />
              </div>
            ))}
          </div>
        )}

        {/* Empty state: Tuyệt đối không tạo dữ liệu giả */}
        {!loading && !error && notifications.length === 0 && (
          <div className="py-16 px-4 text-center bg-white rounded-3xl border-4 border-amber-200">
            <div className="w-16 h-16 mx-auto mb-3 bg-amber-50 text-amber-600 rounded-3xl flex items-center justify-center text-3xl shadow-inner">
              <Inbox className="w-8 h-8 text-amber-500" />
            </div>
            <h3 className="text-base font-black text-amber-950">
              {statusFilter === 'draft'
                ? 'Không có bản nháp nào'
                : statusFilter === 'published'
                ? 'Chưa có thông báo nào được phát hành'
                : statusFilter === 'recalled'
                ? 'Không có thông báo nào bị thu hồi'
                : 'Thầy/Cô chưa tạo thông báo nào'}
            </h3>
            <p className="text-xs font-bold text-slate-500 mt-1 max-w-sm mx-auto">
              Khi Thầy/Cô soạn và phát hành thông báo cho các lớp học, toàn bộ lịch sử sẽ hiển thị đầy đủ tại đây.
            </p>
          </div>
        )}

        {/* Danh sách bản ghi thực tế */}
        {!loading &&
          notifications.map((item) => {
            const isDraft = !item.is_published;
            const isRecalled = Boolean(item.is_recalled);
            const isPublished = item.is_published && !isRecalled;
            const isUrgent = item.priority === 'urgent';
            const isHigh = item.priority === 'high';

            return (
              <div
                key={item.id}
                className={`p-5 bg-white rounded-3xl border-2 transition-all space-y-3 shadow-sm ${
                  isRecalled
                    ? 'border-rose-200 bg-rose-50/20'
                    : isDraft
                    ? 'border-slate-300 bg-slate-50/30'
                    : 'border-amber-200 hover:border-amber-300'
                }`}
              >
                {/* Header Card: Trạng thái + Mức ưu tiên + Thời gian */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {/* Badge trạng thái */}
                    {isPublished && (
                      <span className="px-3 py-1 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-black rounded-xl inline-flex items-center gap-1">
                        <Send className="w-3 h-3 text-emerald-600" />
                        Đã gửi
                      </span>
                    )}
                    {isDraft && (
                      <span className="px-3 py-1 bg-slate-100 border border-slate-300 text-slate-700 text-xs font-black rounded-xl inline-flex items-center gap-1">
                        <FileText className="w-3 h-3 text-slate-500" />
                        Bản nháp
                      </span>
                    )}
                    {isRecalled && (
                      <span className="px-3 py-1 bg-rose-100 border border-rose-300 text-rose-800 text-xs font-black rounded-xl inline-flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 text-rose-600" />
                        Đã thu hồi
                      </span>
                    )}

                    {/* Mức ưu tiên */}
                    {isUrgent && (
                      <span className="px-2.5 py-0.5 bg-rose-100 text-rose-800 text-[10px] font-black rounded-lg">
                        🚨 Khẩn cấp
                      </span>
                    )}
                    {isHigh && (
                      <span className="px-2.5 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-black rounded-lg">
                        ⭐ Quan trọng
                      </span>
                    )}
                  </div>

                  {/* Thời gian */}
                  <div className="flex items-center gap-1 text-[11px] font-bold text-slate-400">
                    <Clock className="w-3.5 h-3.5" />
                    <span>
                      {isPublished && item.published_at
                        ? `Phát hành: ${formatDateTime(item.published_at)}`
                        : `Tạo lúc: ${formatDateTime(item.created_at)}`}
                    </span>
                  </div>
                </div>

                {/* Tiêu đề thông báo */}
                <h3 className="text-base font-black text-amber-950 leading-snug break-words">
                  {item.title}
                </h3>

                {/* Nội dung thông báo thuần văn bản an toàn */}
                <p className="text-xs text-slate-700 whitespace-pre-line line-clamp-3 leading-relaxed break-words font-medium">
                  {item.content}
                </p>

                {/* Lý do thu hồi (nếu có) */}
                {isRecalled && item.recall_reason && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-bold flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
                    <span>Lý do thu hồi: {item.recall_reason}</span>
                  </div>
                )}

                {/* Footer Card: Phạm vi lớp mục tiêu & Thao tác Giáo viên */}
                <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between text-xs font-bold text-slate-600 gap-2">
                  <span className="flex items-center gap-1.5 truncate max-w-md">
                    <School className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span className="truncate">
                      Gửi tới: <strong className="text-amber-950">{renderTargetScopeLabel(item)}</strong>
                    </span>
                  </span>

                  <div className="flex items-center gap-2">
                    {/* NÚT XUẤT BẢN: CHỈ CHO BẢN NHÁP CHƯA THU HỒI DÀNH CHO GIÁO VIÊN */}
                    {isDraft && !isRecalled && profile?.role === 'teacher' && (
                      <button
                        type="button"
                        onClick={() => handleOpenPublishModal(item)}
                        className="px-3 py-1.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-black text-xs rounded-xl shadow-sm flex items-center gap-1.5 active:scale-95 transition-all"
                        title="Kiểm tra và xuất bản bản nháp này"
                      >
                        <Send className="w-3 h-3 stroke-[2.5]" />
                        <span>Xuất bản</span>
                      </button>
                    )}

                    {/* NÚT THU HỒI: CHỈ CHO THÔNG BÁO ĐÃ PHÁT HÀNH VÀ CHƯA BỊ THU HỒI */}
                    {isPublished && !isRecalled && profile?.role === 'teacher' && (
                      <button
                        type="button"
                        onClick={() => handleOpenRecallModal(item)}
                        className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 font-black text-xs rounded-xl shadow-sm flex items-center gap-1.5 active:scale-95 transition-all"
                        title="Thu hồi thông báo đã phát hành"
                      >
                        <AlertTriangle className="w-3 h-3 text-rose-600" />
                        <span>Thu hồi</span>
                      </button>
                    )}

                    <span className="text-[11px] text-slate-400">
                      Mã tin: <code className="font-mono text-slate-500">{item.id?.slice(0, 8)}</code>
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
      </div>

      {/* THANH PHÂN TRANG (PAGINATION) */}
      {!loading && totalCount > PAGE_SIZE && (
        <div className="flex items-center justify-between bg-white px-5 py-3.5 rounded-2xl border-2 border-amber-200">
          <p className="text-xs font-bold text-slate-600">
            Hiển thị trang <strong className="text-amber-950">{currentPage}</strong> / {totalPages} (Tổng số {totalCount} thông báo)
          </p>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrevPage}
              disabled={currentPage <= 1 || loading}
              className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-amber-50 disabled:opacity-40 disabled:hover:bg-white transition-all"
              aria-label="Trang trước"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <span className="px-3 py-1 bg-amber-50 rounded-xl text-xs font-black text-amber-900 border border-amber-200">
              {currentPage}
            </span>

            <button
              onClick={handleNextPage}
              disabled={currentPage >= totalPages || loading}
              className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-amber-50 disabled:opacity-40 disabled:hover:bg-white transition-all"
              aria-label="Trang sau"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* MODAL SOẠN THÔNG BÁO & LƯU BẢN NHÁP (R3-C2A) */}
      <CreateNotificationModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        classes={classes}
        onDraftCreated={handleDraftCreated}
      />

      {/* MODAL XÁC NHẬN XUẤT BẢN BẢN NHÁP (R3-C2B) */}
      <PublishNotificationModal
        isOpen={isPublishModalOpen}
        onClose={() => {
          setIsPublishModalOpen(false);
          setSelectedDraftForPublish(null);
        }}
        draft={selectedDraftForPublish}
        classes={classes}
        onPublished={handlePublished}
      />

      {/* MODAL XÁC NHẬN THU HỒI THÔNG BÁO (R3-C2B) */}
      <RecallNotificationModal
        isOpen={isRecallModalOpen}
        onClose={() => {
          setIsRecallModalOpen(false);
          setSelectedNotifForRecall(null);
        }}
        notification={selectedNotifForRecall}
        onRecalled={handleRecalled}
      />
    </div>
  );
};
