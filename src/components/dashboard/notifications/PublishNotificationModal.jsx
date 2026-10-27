// src/components/dashboard/notifications/PublishNotificationModal.jsx
// Modal xác nhận xuất bản bản nháp thông báo dành cho Giáo viên (Notifications V1 R3-C2B)
// Xác minh toàn vẹn phạm vi lớp, chống double-submit đồng bộ, không tự retry, Zero Trust

import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Send,
  AlertCircle,
  AlertTriangle,
  School,
  RefreshCw,
  Clock,
  CheckCircle2
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext.jsx';
import { publishNotification } from '../../../services/notificationClient.js';
import { formatClassLabel } from '../../../utils/helpers.js';

export const PublishNotificationModal = ({
  isOpen,
  onClose,
  draft,
  classes = [],
  onPublished
}) => {
  const { user, profile } = useAuth();

  const [isPublishing, setIsPublishing] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const isSubmittingRef = useRef(false);
  const previouslyFocusedRef = useRef(null);
  const currentUserIdRef = useRef(user?.id);

  useEffect(() => {
    currentUserIdRef.current = user?.id;
  }, [user?.id]);

  // Quản lý Focus khi mở và trả Focus khi đóng modal
  useEffect(() => {
    if (isOpen) {
      previouslyFocusedRef.current = document.activeElement;
      isSubmittingRef.current = false;
      setIsPublishing(false);
      setErrorMessage(null);
    } else {
      if (previouslyFocusedRef.current && typeof previouslyFocusedRef.current.focus === 'function') {
        previouslyFocusedRef.current.focus();
      }
      setIsPublishing(false);
      isSubmittingRef.current = false;
      setErrorMessage(null);
    }
  }, [isOpen]);

  // Phím tắt Escape để đóng modal (chỉ khi không đang xuất bản)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen && !isPublishing && !isSubmittingRef.current) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isPublishing, onClose]);

  // Đóng modal lập tức nếu người dùng đăng xuất hoặc đổi tài khoản
  useEffect(() => {
    if (!user && isOpen) {
      onClose();
    }
  }, [user, isOpen, onClose]);

  if (!isOpen || !draft) return null;

  // 1. Xác thực ranh giới phân công lớp (Class Boundary Check - All-or-Nothing)
  const validClasses = Array.isArray(classes) ? classes : [];
  const validClassMap = new Map(validClasses.map((c) => [c.id, c.name]));

  const isIndividual = draft.target_type === 'individual';
  const targetClassIds = Array.isArray(draft.target_class_ids) ? draft.target_class_ids : [];

  // Tên các lớp nhận thông báo
  const targetClassNames = targetClassIds.map((id) => {
    const name = validClassMap.get(id);
    return name ? formatClassLabel(name) : null;
  });

  // Kiểm tra tính hợp lệ:
  // Nếu là individual: Bắt buộc có target_student_id hoặc target_student_name_snapshot
  // Nếu là classes: mọi lớp trong target_class_ids PHẢI nằm trong danh sách lớp giáo viên đang phụ trách
  const hasInvalidClass = isIndividual
    ? (!draft.target_student_id && !draft.target_student_name_snapshot)
    : (targetClassIds.length === 0 || targetClassIds.some((id) => !validClassMap.has(id)));

  // Nhãn hiển thị mức độ ưu tiên
  const priorityLabels = {
    urgent: { label: '🚨 Khẩn cấp', badge: 'bg-rose-100 text-rose-900 border-rose-300' },
    high: { label: '⭐ Quan trọng', badge: 'bg-amber-100 text-amber-950 border-amber-300' },
    normal: { label: '📌 Thường', badge: 'bg-sky-50 text-sky-900 border-sky-300' }
  };
  const currentPriority = priorityLabels[draft.priority] || priorityLabels.normal;

  /**
   * Xử lý xác nhận xuất bản thông báo
   */
  const handleConfirmPublish = async () => {
    // 1. Chặn nếu đang xử lý (chống double-submit đồng bộ bằng ref & state)
    if (isPublishing) return;
    if (isSubmittingRef.current) return;

    // 2. Kiểm tra vai trò và phiên người dùng
    if (!user || profile?.role !== 'teacher') {
      setErrorMessage('Phiên làm việc không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.');
      return;
    }

    // 3. Chặn tuyệt đối nếu lớp hoặc đối tượng không xác định
    if (hasInvalidClass) {
      setErrorMessage(
        isIndividual
          ? 'Thông tin học sinh nhận thông báo không còn hợp lệ hoặc đã bị vô hiệu hóa. Thao tác xuất bản bị chặn.'
          : 'Một hoặc nhiều lớp nhận không còn thuộc quyền quản lý của Thầy/Cô (hoặc danh sách lớp không xác định). Thao tác xuất bản bị chặn.'
      );
      return;
    }

    // 4. Khóa đồng bộ
    isSubmittingRef.current = true;
    setIsPublishing(true);
    setErrorMessage(null);

    const activeUserId = user.id;

    try {
      // 5. Gọi RPC publishNotification đúng một lần duy nhất
      const res = await publishNotification(draft.id);

      // Chống Race Condition nếu user đổi tài khoản trong lúc request đang gửi
      if (currentUserIdRef.current !== activeUserId) {
        isSubmittingRef.current = false;
        return;
      }

      // 6. Xử lý phản hồi từ server (Zero Trust - không tự giả lập thành công)
      if (!res.ok) {
        isSubmittingRef.current = false;
        setIsPublishing(false);

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
          setErrorMessage(res.error?.message || 'Không thể xuất bản thông báo. Vui lòng thử lại.');
        }
        return;
      }

      // Bắt buộc xác nhận thành công cả hai điều kiện: res.ok === true && res.data === true
      if (res.ok === true && res.data === true) {
        // 7. THÀNH CÔNG: Mở khóa, gọi callback thông báo cho parent và đóng modal
        isSubmittingRef.current = false;
        setIsPublishing(false);

        if (typeof onPublished === 'function') {
          onPublished(draft);
        }
        onClose();
        return;
      }

      // Trường hợp máy chủ chưa xác nhận thành công (res.data !== true)
      isSubmittingRef.current = false;
      setIsPublishing(false);
      setErrorMessage(
        res.error?.message ||
        'Máy chủ chưa xác nhận xuất bản thông báo thành công. Vui lòng kiểm tra lại trạng thái thông báo trước khi thử lại.'
      );
      return;
    } catch (err) {
      isSubmittingRef.current = false;
      if (currentUserIdRef.current === activeUserId) {
        setIsPublishing(false);
        const errStr = String(err?.message || '');
        if (
          errStr.toLowerCase().includes('fetch') ||
          errStr.toLowerCase().includes('network')
        ) {
          setErrorMessage(
            'Lỗi kết nối mạng: Không rõ thao tác đã thành công hay chưa. Vui lòng kiểm tra lại danh sách hoặc tải lại trang trước khi thử tiếp.'
          );
        } else {
          setErrorMessage(err?.message || 'Đã xảy ra lỗi kết nối khi xuất bản thông báo.');
        }
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-modal-title"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
        onClick={() => {
          if (!isPublishing && !isSubmittingRef.current) onClose();
        }}
        aria-hidden="true"
      />

      {/* Thân Modal */}
      <div className="relative bg-white rounded-3xl border-4 border-emerald-300 shadow-2xl w-full max-w-lg overflow-hidden z-10 flex flex-col max-h-[90vh] animate-fadeIn">
        {/* Header Modal */}
        <header className="px-6 py-4 bg-gradient-to-r from-emerald-100 to-teal-100 border-b-2 border-emerald-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-white border-2 border-emerald-300 flex items-center justify-center text-xl shadow-sm text-emerald-600">
              <Send className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <h2
                id="publish-modal-title"
                className="text-base sm:text-lg font-black text-emerald-950 flex items-center gap-1.5"
              >
                Xác Nhận Xuất Bản Thông Báo
              </h2>
              <p className="text-[11px] font-bold text-emerald-800">
                Kiểm tra thông tin trước khi gửi tới học sinh
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              if (!isPublishing && !isSubmittingRef.current) onClose();
            }}
            disabled={isPublishing}
            aria-label="Đóng hộp thoại"
            className="p-2 rounded-2xl text-slate-600 hover:bg-white hover:text-rose-600 active:scale-95 transition-all border-2 border-transparent hover:border-emerald-200 shadow-sm disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Nội dung chi tiết cần xác nhận */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1 text-left">
          {/* Cảnh báo lỗi nếu lớp không còn hợp lệ */}
          {hasInvalidClass && (
            <div className="p-3.5 bg-rose-50 border-2 border-rose-300 rounded-2xl flex items-start gap-2.5 text-xs text-rose-900">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-black text-sm">Cảnh báo phạm vi lớp học không hợp lệ!</p>
                <p className="font-bold text-slate-600 mt-0.5">
                  Một hoặc nhiều lớp nhận trong bản nháp này không còn thuộc quyền quản lý của Thầy/Cô. Để bảo vệ an toàn dữ liệu, Thao tác xuất bản đã bị khóa.
                </p>
              </div>
            </div>
          )}

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

          {/* Tiêu đề thông báo */}
          <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
            <span className="text-[11px] font-bold text-slate-400 block mb-0.5">Tiêu đề:</span>
            <h3 className="text-sm sm:text-base font-black text-slate-900 break-words">
              {draft.title}
            </h3>
          </div>

          {/* Mức độ ưu tiên & Danh sách lớp */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200">
              <span className="text-[11px] font-bold text-slate-400 block mb-1">Mức độ ưu tiên:</span>
              <span
                className={`inline-block px-2.5 py-1 text-xs font-black rounded-xl border ${currentPriority.badge}`}
              >
                {currentPriority.label}
              </span>
            </div>

            <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200">
              <span className="text-[11px] font-bold text-slate-400 block mb-1">
                {isIndividual ? 'Học sinh nhận thông báo:' : 'Lớp nhận thông báo:'}
              </span>
              {isIndividual ? (
                <div className="flex items-center gap-1.5">
                  <span className="px-2.5 py-1 bg-amber-100 text-amber-950 font-black text-xs rounded-xl border border-amber-300 truncate">
                    👨‍🎓 {draft.target_student_name_snapshot || 'Học sinh cá nhân'}
                  </span>
                </div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {targetClassNames.length > 0 && !hasInvalidClass ? (
                    targetClassNames.map((name, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 bg-amber-100 text-amber-950 font-black text-[11px] rounded-lg border border-amber-300"
                      >
                        {name}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-rose-600 font-bold">Không xác định / Không hợp lệ</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Nội dung thông báo preview */}
          <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
            <span className="text-[11px] font-bold text-slate-400 block mb-1">Nội dung chi tiết:</span>
            <p className="text-xs text-slate-700 whitespace-pre-line leading-relaxed max-h-40 overflow-y-auto font-medium">
              {draft.content}
            </p>
          </div>

          <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-2xl text-[11px] text-amber-900 font-bold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              Sau khi xuất bản, toàn bộ học sinh trong các lớp trên sẽ nhận được thông báo ngay lập tức.
            </span>
          </div>
        </div>

        {/* Footer Modal */}
        <footer className="px-6 py-4 bg-slate-50 border-t-2 border-slate-100 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isPublishing}
            className="px-5 py-2.5 bg-white text-slate-700 hover:bg-slate-100 font-black text-xs rounded-2xl border-2 border-slate-200 transition-all disabled:opacity-50"
          >
            Hủy
          </button>

          <button
            type="button"
            onClick={handleConfirmPublish}
            disabled={isPublishing || hasInvalidClass}
            className="px-6 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-black text-xs sm:text-sm rounded-2xl border-b-4 border-emerald-700 shadow-md flex items-center gap-2 active:translate-y-0.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isPublishing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Đang xuất bản...</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                <span>Xác Nhận Xuất Bản</span>
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  );
};
