// src/components/dashboard/notifications/AdminRecallNotificationModal.jsx
// Modal xác nhận thu hồi thông báo dành cho Quản trị viên (Notifications V1 R3-D2B)
// Cảnh báo không thể hoàn tác, không xóa lịch sử, nhập lý do thu hồi (tối đa 500 ký tự),
// Strict Boolean RPC guard, chống double-submit đồng bộ, Zero-Trust

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  X,
  AlertTriangle,
  RefreshCw,
  AlertCircle,
  FileText,
  ShieldAlert,
  School,
  Layers,
  GraduationCap
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext.jsx';
import { recallNotification, getNotificationById } from '../../../services/notificationClient.js';
import { formatClassLabel } from '../../../utils/helpers.js';

export const AdminRecallNotificationModal = ({
  isOpen,
  onClose,
  notification,
  classes = [],
  onRecalled
}) => {
  const { user, profile } = useAuth();

  const [recallReason, setRecallReason] = useState('');
  const [isRecalling, setIsRecalling] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [freshNotification, setFreshNotification] = useState(null);
  const [isLoadingFresh, setIsLoadingFresh] = useState(false);

  const isSubmittingRef = useRef(false);
  const previouslyFocusedRef = useRef(null);
  const currentUserIdRef = useRef(user?.id);
  const reasonInputRef = useRef(null);

  useEffect(() => {
    currentUserIdRef.current = user?.id;
  }, [user?.id]);

  // Quản lý Focus khi mở và trả Focus khi đóng modal
  useEffect(() => {
    if (isOpen && notification) {
      previouslyFocusedRef.current = document.activeElement;
      isSubmittingRef.current = false;
      setIsRecalling(false);
      setRecallReason('');
      setErrorMessage(null);
      setFreshNotification(notification);

      setTimeout(() => {
        reasonInputRef.current?.focus();
      }, 50);

      // Thực hiện truy vấn đọc an toàn để đối chiếu dữ liệu mới nhất
      let isMounted = true;
      setIsLoadingFresh(true);
      getNotificationById(notification.id)
        .then((res) => {
          if (!isMounted) return;
          setIsLoadingFresh(false);
          if (res.ok && res.data) {
            setFreshNotification(res.data);
          }
        })
        .catch(() => {
          if (isMounted) setIsLoadingFresh(false);
        });

      return () => {
        isMounted = false;
      };
    } else {
      if (previouslyFocusedRef.current && typeof previouslyFocusedRef.current.focus === 'function') {
        previouslyFocusedRef.current.focus();
      }
      setIsRecalling(false);
      isSubmittingRef.current = false;
      setRecallReason('');
      setErrorMessage(null);
      setFreshNotification(null);
    }
  }, [isOpen, notification]);

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

  const targetClassMap = useMemo(() => {
    const map = new Map();
    if (Array.isArray(classes)) {
      classes.forEach((c) => {
        if (c?.id && c?.name) {
          map.set(c.id, formatClassLabel(c.name));
        }
      });
    }
    return map;
  }, [classes]);

  if (!isOpen || !notification) return null;

  const activeNotif = freshNotification || notification;
  const isAlreadyRecalled = Boolean(activeNotif.is_recalled);
  const isNotPublished = !activeNotif.is_published;
  const targetType = activeNotif.target_type || 'all';
  const targetClassIds = Array.isArray(activeNotif.target_class_ids) ? activeNotif.target_class_ids : [];

  // Nhãn phạm vi người nhận
  const renderScopeSummary = () => {
    if (targetType === 'all') {
      return (
        <span className="inline-flex items-center gap-1 text-purple-900 font-bold">
          <School className="w-3.5 h-3.5 text-purple-600" />
          Toàn trường (Giáo viên & Học sinh active)
        </span>
      );
    }
    if (targetType === 'grade') {
      return (
        <span className="inline-flex items-center gap-1 text-indigo-900 font-bold">
          <Layers className="w-3.5 h-3.5 text-indigo-600" />
          Khối {activeNotif.target_grade_level} (Chỉ học sinh)
        </span>
      );
    }
    if (targetType === 'classes') {
      const classNames = targetClassIds.map((cid) => targetClassMap.get(cid) || cid.slice(0, 6));
      return (
        <span className="inline-flex items-center gap-1 text-emerald-900 font-bold">
          <GraduationCap className="w-3.5 h-3.5 text-emerald-600" />
          Lớp: {classNames.join(', ')}
        </span>
      );
    }
    return 'Chưa xác định';
  };

  /**
   * Xử lý Admin xác nhận thu hồi
   */
  const handleConfirmRecall = async () => {
    // 1. Chặn submit nếu đang thực hiện (chống double-click đồng bộ bằng ref & state)
    if (isRecalling) return;
    if (isSubmittingRef.current) return;

    // 2. Kiểm tra vai trò Admin
    if (!user || profile?.role !== 'admin') {
      setErrorMessage('Quyền truy cập bị từ chối: Chỉ Quản trị viên mới được thu hồi thông báo này.');
      return;
    }

    // 3. Chặn thu hồi nếu thông báo đã thu hồi hoặc chưa xuất bản
    if (isAlreadyRecalled) {
      setErrorMessage('Thông báo này đã được thu hồi trước đó.');
      return;
    }

    if (isNotPublished) {
      setErrorMessage('Bản nháp chưa xuất bản không thể thu hồi. Vui lòng quản lý trong mục Bản nháp.');
      return;
    }

    const trimmedReason = recallReason.trim();
    if (trimmedReason.length > 500) {
      setErrorMessage('Lý do thu hồi không được vượt quá 500 ký tự.');
      return;
    }

    // 4. Khóa đồng bộ
    isSubmittingRef.current = true;
    setIsRecalling(true);
    setErrorMessage(null);

    const activeUserId = user.id;

    try {
      // 5. Gọi RPC recallNotification đúng 1 lần duy nhất, không tự ý retry
      const res = await recallNotification(
        activeNotif.id,
        trimmedReason.length > 0 ? trimmedReason : null
      );

      // Chống Race Condition nếu user đổi tài khoản trong lúc gửi request
      if (currentUserIdRef.current !== activeUserId) {
        isSubmittingRef.current = false;
        return;
      }

      // 6. Xử lý phản hồi từ server
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

      // 7. STRICT BOOLEAN GUARD: res.ok === true && res.data === true
      if (res.ok === true && res.data === true) {
        isSubmittingRef.current = false;
        setIsRecalling(false);

        if (typeof onRecalled === 'function') {
          onRecalled(activeNotif);
        }
        onClose();
        return;
      }

      // Trường hợp máy chủ không xác nhận boolean true
      isSubmittingRef.current = false;
      setIsRecalling(false);
      setErrorMessage(
        res.error?.message ||
        'Máy chủ chưa xác nhận thu hồi thông báo thành công. Vui lòng kiểm tra lại trạng thái thông báo trước khi thử lại.'
      );
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-recall-modal-title"
    >
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border-2 border-rose-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header Modal */}
        <div className="px-6 py-4 border-b border-rose-100 flex items-center justify-between bg-gradient-to-r from-rose-50 via-red-50/40 to-white">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-rose-600 text-white flex items-center justify-center shadow-md shadow-rose-200">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 id="admin-recall-modal-title" className="text-base font-black text-rose-950">
                Xác Nhận Thu Hồi Thông Báo
              </h2>
              <p className="text-[11px] font-bold text-slate-500">
                Quyền Quản trị viên toàn trường
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isRecalling}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all disabled:opacity-40"
            aria-label="Đóng modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nội dung modal */}
        <div className="p-6 overflow-y-auto space-y-4 text-xs">
          {/* Thông báo lỗi nếu có */}
          {errorMessage && (
            <div
              className="p-3.5 bg-rose-50 border-2 border-rose-200 rounded-2xl text-rose-800 flex items-start gap-2.5 animate-fadeIn"
              role="alert"
            >
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-black">Thao tác chưa hoàn tất</p>
                <p className="font-bold text-[11px] leading-relaxed">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Đang đối chiếu trạng thái */}
          {isLoadingFresh && (
            <div className="p-2.5 bg-rose-50/70 border border-rose-200 rounded-xl text-rose-800 text-[11px] font-bold flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 text-rose-600 animate-spin" />
              <span>Đang đối chiếu trạng thái thông báo mới nhất từ máy chủ...</span>
            </div>
          )}

          {/* Cảnh báo đã thu hồi */}
          {isAlreadyRecalled && (
            <div className="p-3.5 bg-rose-50 border-2 border-rose-300 rounded-2xl text-rose-900 font-bold flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>
                Thông báo này đã được thu hồi trước đó trong hệ thống.
              </span>
            </div>
          )}

          {/* CẢNH BÁO BẢO TOÀN LỊCH SỬ & KHÔNG THỂ HOÀN TÁC */}
          <div className="p-4 bg-amber-50 border-2 border-amber-300 rounded-2xl text-amber-950 space-y-1.5">
            <div className="flex items-center gap-2 font-black text-amber-900">
              <ShieldAlert className="w-4 h-4 text-amber-600" />
              <span>Cảnh báo ảnh hưởng nghiệp vụ</span>
            </div>
            <p className="text-[11px] leading-relaxed font-bold text-amber-900">
              Hành động này sẽ ngừng hiển thị thông báo đối với tất cả người nhận. Lịch sử thông báo vẫn được lưu trữ trong hệ thống và không thể hoàn tác.
            </p>
          </div>

          {/* Thông tin thông báo sẽ thu hồi */}
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2.5">
            <div>
              <p className="text-[11px] font-bold text-slate-400 mb-0.5">Tiêu đề thông báo:</p>
              <h3 className="text-sm font-black text-slate-900 break-words leading-snug">
                {activeNotif.title}
              </h3>
            </div>

            <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-bold text-slate-400 mb-0.5">Phạm vi:</p>
                <div>{renderScopeSummary()}</div>
              </div>

              <div className="text-right">
                <p className="text-[11px] font-bold text-slate-400 mb-0.5">Người tạo:</p>
                <span className="font-bold text-slate-700">
                  {activeNotif.sender_name_snapshot || 'Hệ thống'}
                </span>
              </div>
            </div>
          </div>

          {/* Nhập lý do thu hồi (tối đa 500 ký tự) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="admin-recall-reason" className="block text-xs font-black text-slate-800 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-rose-600" />
                Lý do thu hồi (tùy chọn)
              </label>
              <span className={`text-[10px] font-bold ${recallReason.length > 500 ? 'text-rose-600' : 'text-slate-400'}`}>
                {recallReason.length} / 500 ký tự
              </span>
            </div>

            <textarea
              id="admin-recall-reason"
              ref={reasonInputRef}
              value={recallReason}
              onChange={(e) => {
                setRecallReason(e.target.value);
                setErrorMessage(null);
              }}
              disabled={isRecalling || isAlreadyRecalled}
              maxLength={500}
              rows={3}
              placeholder="Nhập lý do thu hồi thông báo (ví dụ: Thay đổi kế hoạch toàn trường, đính chính thông tin...)"
              className="w-full px-3.5 py-2.5 bg-slate-50 border-2 border-slate-200 focus:border-rose-500 rounded-2xl text-xs font-medium text-slate-800 placeholder-slate-400 outline-none transition-all resize-none"
            />
          </div>
        </div>

        {/* Footer Modal */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={isRecalling}
            className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-2xl text-xs font-black transition-all disabled:opacity-40"
          >
            Hủy bỏ
          </button>

          <button
            type="button"
            onClick={handleConfirmRecall}
            disabled={isRecalling || isAlreadyRecalled || isNotPublished || recallReason.length > 500}
            className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-2xl text-xs font-black flex items-center gap-1.5 shadow-md shadow-rose-200 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isRecalling ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Đang thu hồi...</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-4 h-4" />
                <span>Xác nhận thu hồi</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
