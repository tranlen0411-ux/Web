// src/components/dashboard/notifications/AdminNotificationManagementTab.jsx
// Tab Quản lý Thông báo toàn trường dành riêng cho Quản trị viên (Notifications V1 R3-D1 - READ ONLY UI)
// Thiết kế High-Security Zero-Trust, phân trang tất định, cách ly tài khoản, không có thao tác ghi

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
  User,
  ShieldCheck,
  Layers,
  Plus,
  CheckCircle2
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext.jsx';
import { getSentNotifications } from '../../../services/notificationClient.js';
import { formatClassLabel } from '../../../utils/helpers.js';
import { AdminCreateNotificationModal } from './AdminCreateNotificationModal.jsx';
import { AdminPublishNotificationModal } from './AdminPublishNotificationModal.jsx';
import { AdminRecallNotificationModal } from './AdminRecallNotificationModal.jsx';

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

export const AdminNotificationManagementTab = ({ classes = [], isClassesComplete = false }) => {
  const { user, profile } = useAuth();

  // Bộ lọc trạng thái: 'all' | 'draft' | 'published' | 'recalled'
  const [statusFilter, setStatusFilter] = useState('all');
  const [notifications, setNotifications] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // State mở modal Soạn thông báo (R3-D2A)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [successFeedback, setSuccessFeedback] = useState(null);

  // State mở modal Xuất bản & Thu hồi (R3-D2B)
  const [publishModalItem, setPublishModalItem] = useState(null);
  const [recallModalItem, setRecallModalItem] = useState(null);

  // Quản lý chặn Stale Response và cách ly phiên tài khoản
  const activeRequestIdRef = useRef(0);
  const currentUserIdRef = useRef(user?.id);

  useEffect(() => {
    currentUserIdRef.current = user?.id;
  }, [user?.id]);

  // Tạo map tên lớp từ classes prop để hiển thị thân thiện (nếu có)
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
   * Tải toàn bộ danh sách thông báo hệ thống dành cho Admin
   * Sử dụng RLS database: Admin có quyền SELECT toàn bộ thông báo của tất cả người gửi
   */
  const fetchAdminNotifications = useCallback(
    async (pageToLoad, filterToApply) => {
      // Bảo vệ phân quyền: Chỉ tải nếu user tồn tại và là Admin
      if (!user || profile?.role !== 'admin') {
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

        // Chống Race Condition: Bỏ qua nếu có request mới hơn hoặc user đã đổi tài khoản
        if (
          currentRequestId !== activeRequestIdRef.current ||
          currentUserIdRef.current !== activeUserId
        ) {
          return;
        }

        setLoading(false);

        if (!res.ok) {
          setError(res.error?.message || 'Không thể tải danh sách thông báo quản trị. Vui lòng thử lại.');
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

  // Kích hoạt tải dữ liệu khi trang hoặc bộ lọc thay đổi
  useEffect(() => {
    fetchAdminNotifications(currentPage, statusFilter);
  }, [currentPage, statusFilter, fetchAdminNotifications]);

  // Khi đăng xuất hoặc chuyển đổi tài khoản -> lập tức reset toàn bộ dữ liệu khỏi state
  useEffect(() => {
    if (!user || profile?.role !== 'admin') {
      setNotifications([]);
      setTotalCount(0);
      setCurrentPage(1);
      setError(null);
      setIsCreateModalOpen(false);
      setSuccessFeedback(null);
    }
  }, [user, profile?.role]);

  // Xử lý khi tạo bản nháp thành công: Refresh danh sách và thông báo cho Admin
  const handleDraftCreated = useCallback((newDraftId) => {
    setIsCreateModalOpen(false);
    setSuccessFeedback('✨ Đã lưu bản nháp thông báo thành công! Bản nháp đã được ghi nhận vào danh sách.');
    // Tự động chuyển về bộ lọc tất cả hoặc bản nháp để hiển thị bản nháp vừa tạo ở trang 1
    setCurrentPage(1);
    fetchAdminNotifications(1, statusFilter);

    // Tự tắt feedback sau 5s
    setTimeout(() => {
      setSuccessFeedback(null);
    }, 5000);
  }, [fetchAdminNotifications, statusFilter]);

  // Xử lý khi xuất bản thành công (R3-D2B): Refresh danh sách và thông báo cho Admin
  const handlePublished = useCallback((publishedNotif) => {
    setPublishModalItem(null);
    setSuccessFeedback(`✨ Đã xuất bản thành công thông báo: "${publishedNotif?.title || ''}".`);
    fetchAdminNotifications(currentPage, statusFilter);
    setTimeout(() => {
      setSuccessFeedback(null);
    }, 5000);
  }, [fetchAdminNotifications, currentPage, statusFilter]);

  // Xử lý khi thu hồi thành công (R3-D2B): Refresh danh sách và thông báo cho Admin
  const handleRecalled = useCallback((recalledNotif) => {
    setRecallModalItem(null);
    setSuccessFeedback(`⚠️ Đã thu hồi thành công thông báo: "${recalledNotif?.title || ''}".`);
    fetchAdminNotifications(currentPage, statusFilter);
    setTimeout(() => {
      setSuccessFeedback(null);
    }, 5000);
  }, [fetchAdminNotifications, currentPage, statusFilter]);

  // Chuyển đổi bộ lọc trạng thái
  const handleFilterChange = (newStatus) => {
    setStatusFilter(newStatus);
    setCurrentPage(1);
  };

  // Tính tổng số trang
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

  // Helper hiển thị nhãn phạm vi nhận tin
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

  // Kiểm tra ranh giới bảo mật: Không phải admin thì từ chối render
  if (profile && profile.role !== 'admin') {
    return (
      <div className="p-8 text-center bg-rose-50 border-2 border-rose-200 rounded-3xl">
        <AlertTriangle className="w-8 h-8 text-rose-600 mx-auto mb-2" />
        <h3 className="text-base font-black text-rose-950">Quyền truy cập bị từ chối</h3>
        <p className="text-xs text-rose-700 mt-1 font-bold">
          Chỉ Quản trị viên (Admin) mới có quyền truy cập khu vực Quản lý Thông báo toàn trường.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* HEADER KHU VỰC QUẢN LÝ THÔNG BÁO DÀNH CHO ADMIN */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 sm:p-6 rounded-3xl border-4 border-purple-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-3 py-1 bg-purple-100 text-purple-900 text-xs font-black rounded-xl uppercase flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> Quản Lý Thông Báo Hệ Thống
            </span>
            <span className="text-xs font-bold text-slate-500">
              (Chế độ Giám sát Chỉ Đọc – R3-D1)
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-800">
            Giám Sát & Lịch Sử Thông Báo Toàn Trường
          </h2>
          <p className="text-xs sm:text-sm font-bold text-slate-500 mt-0.5">
            Theo dõi tất cả thông báo do Quản trị viên và Giáo viên tạo trong toàn bộ hệ thống trường học.
          </p>
        </div>

        {/* Nhóm nút hành động: Soạn thông báo & Làm mới */}
        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex-1 sm:flex-none px-5 py-2.5 bg-purple-600 hover:bg-purple-700 active:scale-95 text-white rounded-2xl font-black text-xs flex items-center justify-center gap-2 transition-all shadow-md"
          >
            <Plus className="w-4 h-4" />
            <span>Soạn thông báo</span>
          </button>

          <button
            onClick={() => fetchAdminNotifications(currentPage, statusFilter)}
            disabled={loading}
            className="px-4 py-2.5 bg-slate-50 hover:bg-purple-50 text-slate-700 hover:text-purple-900 border-2 border-slate-200 hover:border-purple-300 rounded-2xl font-black text-xs flex items-center gap-2 active:scale-95 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Làm mới</span>
          </button>
        </div>
      </div>

      {/* FEEDBACK THÀNH CÔNG */}
      {successFeedback && (
        <div className="p-4 bg-emerald-50 border-2 border-emerald-200 rounded-2xl flex items-center gap-2.5 text-emerald-900 text-xs font-black animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successFeedback}</span>
        </div>
      )}

      {/* BỘ LỌC TRẠNG THÁI (FILTERS) */}
      <div className="flex flex-wrap items-center gap-2 bg-white p-2.5 rounded-2xl border-2 border-purple-200">
        <button
          onClick={() => handleFilterChange('all')}
          className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${
            statusFilter === 'all'
              ? 'bg-purple-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-purple-50'
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
              ? 'bg-emerald-600 text-white shadow-sm'
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
              ? 'bg-rose-600 text-white shadow-sm'
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
            onClick={() => fetchAdminNotifications(currentPage, statusFilter)}
            className="font-black text-rose-900 underline hover:text-rose-700"
          >
            Thử lại
          </button>
        </div>
      )}

      {/* DANH SÁCH THÔNG BÁO QUẢN TRỊ */}
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

        {/* Empty state: Không có dữ liệu giả */}
        {!loading && !error && notifications.length === 0 && (
          <div className="py-16 px-4 text-center bg-white rounded-3xl border-4 border-purple-200">
            <div className="w-16 h-16 mx-auto mb-3 bg-purple-50 text-purple-600 rounded-3xl flex items-center justify-center text-3xl shadow-inner">
              <Inbox className="w-8 h-8 text-purple-500" />
            </div>
            <h3 className="text-base font-black text-purple-950">
              {statusFilter === 'draft'
                ? 'Không có bản nháp nào trong hệ thống'
                : statusFilter === 'published'
                ? 'Chưa có thông báo nào được phát hành'
                : statusFilter === 'recalled'
                ? 'Không có thông báo nào bị thu hồi'
                : 'Chưa có thông báo nào trong toàn trường'}
            </h3>
            <p className="text-xs font-bold text-slate-500 mt-1 max-w-sm mx-auto">
              Khi Giáo viên hoặc Quản trị viên tạo thông báo, lịch sử và trạng thái sẽ được ghi nhận minh bạch tại đây.
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
                    : 'border-purple-200 hover:border-purple-300'
                }`}
              >
                {/* Header Card: Trạng thái + Người gửi + Mức ưu tiên + Thời gian */}
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

                    {/* Người tạo thông báo */}
                    <span className="px-2.5 py-1 bg-slate-100 border border-slate-200 text-slate-800 text-[11px] font-bold rounded-xl inline-flex items-center gap-1">
                      <User className="w-3 h-3 text-purple-600" />
                      <span>{item.sender_name_snapshot || 'Hệ thống'}</span>
                    </span>

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
                <h3 className="text-base font-black text-slate-900 leading-snug break-words">
                  {item.title}
                </h3>

                {/* Nội dung thông báo tóm tắt an toàn chống XSS */}
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

                {/* Footer Card: Phạm vi nhận tin & Nút thao tác (Xuất bản / Thu hồi) */}
                <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between text-xs font-bold text-slate-600 gap-2">
                  <span className="flex items-center gap-1.5 truncate max-w-md">
                    <School className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                    <span className="truncate">
                      Gửi tới: <strong className="text-purple-950">{renderTargetScopeLabel(item)}</strong>
                    </span>
                  </span>

                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400 mr-1">
                      Mã: <code className="font-mono text-slate-500">{item.id?.slice(0, 8)}</code>
                    </span>

                    {/* Nút Xuất bản: Chỉ hiện cho bản nháp chưa xuất bản và chưa thu hồi */}
                    {isDraft && !isRecalled && (
                      <button
                        type="button"
                        onClick={() => setPublishModalItem(item)}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black inline-flex items-center gap-1.5 shadow-sm transition-all"
                        aria-label={`Xuất bản thông báo ${item.title}`}
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Xuất bản</span>
                      </button>
                    )}

                    {/* Nút Thu hồi: Chỉ hiện cho thông báo đã xuất bản và chưa thu hồi */}
                    {isPublished && !isRecalled && (
                      <button
                        type="button"
                        onClick={() => setRecallModalItem(item)}
                        className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 rounded-xl text-xs font-black inline-flex items-center gap-1.5 shadow-sm transition-all"
                        aria-label={`Thu hồi thông báo ${item.title}`}
                      >
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                        <span>Thu hồi</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
      </div>

      {/* THANH PHÂN TRANG (PAGINATION) */}
      {!loading && totalCount > PAGE_SIZE && (
        <div className="flex items-center justify-between bg-white px-5 py-3.5 rounded-2xl border-2 border-purple-200">
          <p className="text-xs font-bold text-slate-600">
            Hiển thị trang <strong className="text-purple-950">{currentPage}</strong> / {totalPages} (Tổng số {totalCount} thông báo)
          </p>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrevPage}
              disabled={currentPage <= 1 || loading}
              className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-purple-50 disabled:opacity-40 disabled:hover:bg-white transition-all"
              aria-label="Trang trước"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <span className="px-3 py-1 bg-purple-50 rounded-xl text-xs font-black text-purple-900 border border-purple-200">
              {currentPage}
            </span>

            <button
              onClick={handleNextPage}
              disabled={currentPage >= totalPages || loading}
              className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-purple-50 disabled:opacity-40 disabled:hover:bg-white transition-all"
              aria-label="Trang sau"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* MODAL SOẠN VÀ LƯU BẢN NHÁP THÔNG BÁO DÀNH CHO ADMIN (R3-D2A) */}
      <AdminCreateNotificationModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        classes={classes}
        isClassesComplete={isClassesComplete}
        onDraftCreated={handleDraftCreated}
      />

      {/* MODAL XÁC NHẬN XUẤT BẢN THÔNG BÁO DÀNH CHO ADMIN (R3-D2B) */}
      <AdminPublishNotificationModal
        isOpen={Boolean(publishModalItem)}
        onClose={() => setPublishModalItem(null)}
        notification={publishModalItem}
        classes={classes}
        isClassesComplete={isClassesComplete}
        onPublished={handlePublished}
      />

      {/* MODAL XÁC NHẬN THU HỒI THÔNG BÁO DÀNH CHO ADMIN (R3-D2B) */}
      <AdminRecallNotificationModal
        isOpen={Boolean(recallModalItem)}
        onClose={() => setRecallModalItem(null)}
        notification={recallModalItem}
        classes={classes}
        onRecalled={handleRecalled}
      />
    </div>
  );
};
