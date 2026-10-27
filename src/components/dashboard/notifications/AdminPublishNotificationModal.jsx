// src/components/dashboard/notifications/AdminPublishNotificationModal.jsx
// Modal xác nhận xuất bản thông báo dành cho Quản trị viên (Notifications V1 R3-D2B)
// Xác minh phạm vi người nhận 3 cấp (Toàn trường, Khối, Lớp), Fail-Closed classes completeness,
// Strict Boolean RPC guard, chống double-submit đồng bộ, Zero-Trust

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  X,
  Send,
  AlertCircle,
  AlertTriangle,
  School,
  RefreshCw,
  Clock,
  Layers,
  GraduationCap,
  ShieldCheck,
  CheckCircle2
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext.jsx';
import { publishNotification, getNotificationById } from '../../../services/notificationClient.js';
import { formatClassLabel } from '../../../utils/helpers.js';

export const AdminPublishNotificationModal = ({
  isOpen,
  onClose,
  notification,
  classes = [],
  isClassesComplete = false,
  onPublished
}) => {
  const { user, profile } = useAuth();

  const [isPublishing, setIsPublishing] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [freshNotification, setFreshNotification] = useState(null);
  const [isLoadingFresh, setIsLoadingFresh] = useState(false);

  const isSubmittingRef = useRef(false);
  const previouslyFocusedRef = useRef(null);
  const currentUserIdRef = useRef(user?.id);

  useEffect(() => {
    currentUserIdRef.current = user?.id;
  }, [user?.id]);

  // Quản lý Focus khi mở và trả Focus khi đóng modal
  useEffect(() => {
    if (isOpen && notification) {
      previouslyFocusedRef.current = document.activeElement;
      isSubmittingRef.current = false;
      setIsPublishing(false);
      setErrorMessage(null);
      setFreshNotification(notification);

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
      setIsPublishing(false);
      isSubmittingRef.current = false;
      setErrorMessage(null);
      setFreshNotification(null);
    }
  }, [isOpen, notification]);

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

  // Kiểm tra tính hợp lệ cơ bản
  const isAlreadyRecalled = Boolean(activeNotif.is_recalled);
  const isAlreadyPublished = Boolean(activeNotif.is_published && !activeNotif.is_recalled);
  const targetType = activeNotif.target_type || 'all';
  const targetClassIds = Array.isArray(activeNotif.target_class_ids) ? activeNotif.target_class_ids : [];

  // Xác thực ranh giới lớp học nếu phạm vi là 'classes' (Fail-Closed)
  const isClassesScope = targetType === 'classes';
  const hasIncompleteClassesData = isClassesScope && (!isClassesComplete || targetClassIds.length === 0);
  const hasMissingClassInList = isClassesScope && targetClassIds.some((id) => !targetClassMap.has(id));
  const isClassesBlocked = isClassesScope && (hasIncompleteClassesData || hasMissingClassInList);

  // Mức độ ưu tiên
  const priorityLabels = {
    urgent: { label: '🚨 Khẩn cấp', badge: 'bg-rose-100 text-rose-900 border-rose-300' },
    high: { label: '⭐ Quan trọng', badge: 'bg-amber-100 text-amber-950 border-amber-300' },
    normal: { label: '📌 Thường', badge: 'bg-sky-50 text-sky-900 border-sky-300' }
  };
  const currentPriority = priorityLabels[activeNotif.priority] || priorityLabels.normal;

  // Chuyên mục
  const categoryLabels = {
    general: 'Thông báo chung',
    system: 'Hệ thống & Kỹ thuật',
    exam: 'Kỳ thi & Khảo sát',
    exercise: 'Bài tập học thuật',
    material: 'Học liệu bài giảng'
  };
  const currentCategory = categoryLabels[activeNotif.category] || 'Thông báo chung';

  /**
   * Xử lý Admin xác nhận xuất bản
   */
  const handleConfirmPublish = async () => {
    // 1. Chống double-submit đồng bộ bằng ref & state
    if (isPublishing) return;
    if (isSubmittingRef.current) return;

    // 2. Kiểm tra vai trò Admin
    if (!user || profile?.role !== 'admin') {
      setErrorMessage('Quyền truy cập bị từ chối: Chỉ Quản trị viên mới được xuất bản thông báo này.');
      return;
    }

    // 3. Chặn xuất bản thông báo đã thu hồi
    if (isAlreadyRecalled) {
      setErrorMessage('Thông báo đã bị thu hồi, không thể xuất bản hoặc xuất bản lại.');
      return;
    }

    // 4. Chặn nếu phạm vi theo lớp mà dữ liệu lớp không đầy đủ hoặc có lớp không xác định
    if (isClassesBlocked) {
      setErrorMessage(
        'Dữ liệu danh sách lớp chưa được tải đầy đủ hoặc có lớp nhận không xác định. Thao tác xuất bản bị chặn để đảm bảo an toàn tuyệt đối (Fail-Closed).'
      );
      return;
    }

    // 5. Khóa đồng bộ
    isSubmittingRef.current = true;
    setIsPublishing(true);
    setErrorMessage(null);

    const activeUserId = user.id;

    try {
      // 6. Gọi RPC publishNotification đúng 1 lần duy nhất, không tự ý retry
      const res = await publishNotification(activeNotif.id);

      // Chống Race Condition nếu user đổi tài khoản trong lúc gửi request
      if (currentUserIdRef.current !== activeUserId) {
        isSubmittingRef.current = false;
        return;
      }

      // 7. Xử lý phản hồi từ server
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

      // 8. STRICT BOOLEAN GUARD: res.ok === true && res.data === true
      if (res.ok === true && res.data === true) {
        isSubmittingRef.current = false;
        setIsPublishing(false);

        if (typeof onPublished === 'function') {
          onPublished(activeNotif);
        }
        onClose();
        return;
      }

      // Trường hợp máy chủ không xác nhận boolean true
      isSubmittingRef.current = false;
      setIsPublishing(false);
      setErrorMessage(
        res.error?.message ||
        'Máy chủ chưa xác nhận xuất bản thông báo thành công. Vui lòng kiểm tra lại trạng thái thông báo trước khi thử lại.'
      );
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-publish-modal-title"
    >
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border-2 border-purple-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header Modal */}
        <div className="px-6 py-4 border-b border-purple-100 flex items-center justify-between bg-gradient-to-r from-purple-50 via-indigo-50/40 to-white">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-purple-600 text-white flex items-center justify-center shadow-md shadow-purple-200">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <h2 id="admin-publish-modal-title" className="text-base font-black text-purple-950">
                Xác Nhận Xuất Bản Thông Báo
              </h2>
              <p className="text-[11px] font-bold text-slate-500">
                Quyền Quản trị viên toàn trường
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isPublishing}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all disabled:opacity-40"
            aria-label="Đóng modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nội dung xác nhận */}
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

          {/* Cảnh báo nếu thông báo đã thu hồi */}
          {isAlreadyRecalled && (
            <div className="p-3.5 bg-rose-50 border-2 border-rose-300 rounded-2xl text-rose-900 font-bold flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>
                Thông báo này đã bị thu hồi trước đó. Theo quy chuẩn bảo mật và toàn vẹn dữ liệu, thông báo đã thu hồi không thể xuất bản lại.
              </span>
            </div>
          )}

          {/* Cảnh báo nếu thông báo đã xuất bản */}
          {isAlreadyPublished && (
            <div className="p-3.5 bg-emerald-50 border-2 border-emerald-300 rounded-2xl text-emerald-900 font-bold flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>
                Thông báo này hiện đã ở trạng thái đã xuất bản trong hệ thống.
              </span>
            </div>
          )}

          {/* Loading dữ liệu đối chiếu */}
          {isLoadingFresh && (
            <div className="p-2.5 bg-purple-50/70 border border-purple-200 rounded-xl text-purple-800 text-[11px] font-bold flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 text-purple-600 animate-spin" />
              <span>Đang đối chiếu trạng thái thông báo mới nhất từ máy chủ...</span>
            </div>
          )}

          {/* Chi tiết thông báo chuẩn bị phát hành */}
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`px-2.5 py-0.5 border rounded-lg text-[10px] font-black ${currentPriority.badge}`}>
                {currentPriority.label}
              </span>
              <span className="px-2.5 py-0.5 bg-white border border-slate-200 rounded-lg text-[10px] font-bold text-slate-700">
                Chuyên mục: <strong className="text-slate-900">{currentCategory}</strong>
              </span>
            </div>

            <div>
              <p className="text-[11px] font-bold text-slate-400 mb-0.5">Tiêu đề:</p>
              <h3 className="text-sm font-black text-slate-900 break-words leading-snug">
                {activeNotif.title}
              </h3>
            </div>

            <div>
              <p className="text-[11px] font-bold text-slate-400 mb-0.5">Nội dung tóm tắt:</p>
              <p className="text-slate-700 whitespace-pre-line break-words max-h-36 overflow-y-auto leading-relaxed bg-white p-3 rounded-xl border border-slate-200 font-medium">
                {activeNotif.content}
              </p>
            </div>
          </div>

          {/* CẢNH BÁO PHẠM VI NGƯỜI NHẬN CHUẨN XÁC THEO HỢP ĐỒNG BACKEND */}
          <div className="p-4 rounded-2xl border-2 space-y-2 bg-purple-50/40 border-purple-200">
            <div className="flex items-center gap-2 text-purple-950 font-black">
              <School className="w-4 h-4 text-purple-600" />
              <span>Phạm vi đối tượng nhận thông báo</span>
            </div>

            {/* 1. Trường hợp TOÀN TRƯỜNG ('all') */}
            {targetType === 'all' && (
              <div className="p-3 bg-white rounded-xl border border-purple-200 text-purple-900 font-bold space-y-1">
                <p className="text-xs text-purple-950 font-black flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-purple-600" />
                  Toàn trường (Tất cả Giáo viên & Học sinh active)
                </p>
                <p className="text-[11px] text-slate-700 leading-relaxed">
                  Thông báo sẽ được gửi tới Giáo viên và Học sinh đang hoạt động trên toàn trường.
                </p>
              </div>
            )}

            {/* 2. Trường hợp THEO KHỐI ('grade') */}
            {targetType === 'grade' && (
              <div className="p-3 bg-white rounded-xl border border-indigo-200 text-indigo-900 font-bold space-y-1">
                <p className="text-xs text-indigo-950 font-black flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-indigo-600" />
                  Khối {activeNotif.target_grade_level}
                </p>
                <p className="text-[11px] text-slate-700 leading-relaxed">
                  Chỉ gửi tới Học sinh thuộc khối đã chọn; Giáo viên không nhận thông báo này.
                </p>
              </div>
            )}

            {/* 3. Trường hợp THEO LỚP ('classes') */}
            {targetType === 'classes' && (
              <div className="p-3 bg-white rounded-xl border border-emerald-200 text-emerald-900 font-bold space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-emerald-950 font-black flex items-center gap-1.5">
                    <GraduationCap className="w-4 h-4 text-emerald-600" />
                    Theo các lớp được chọn ({targetClassIds.length} lớp)
                  </p>
                </div>

                {/* Danh sách tên lớp nhận tin */}
                <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pt-1">
                  {targetClassIds.map((cid) => {
                    const cName = targetClassMap.get(cid);
                    return (
                      <span
                        key={cid}
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${
                          cName
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                            : 'bg-rose-50 border-rose-200 text-rose-800'
                        }`}
                      >
                        {cName || `Lớp không xác định (${cid.slice(0, 6)})`}
                      </span>
                    );
                  })}
                </div>

                <p className="text-[11px] text-slate-700 leading-relaxed pt-1 border-t border-slate-100">
                  Chỉ gửi tới Học sinh thuộc các lớp được chọn; Giáo viên không nhận thông báo này.
                </p>

                {/* Fail-Closed Guard Warning */}
                {isClassesBlocked && (
                  <div className="p-2.5 bg-rose-50 border border-rose-300 rounded-xl text-rose-900 text-[11px] font-bold flex items-start gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <span>
                      Dữ liệu danh sách lớp chưa được tải đầy đủ từ máy chủ hoặc có lớp không xác định. Thao tác xuất bản theo lớp bị khóa an toàn (Fail-Closed).
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* 4. Trường hợp CÁ NHÂN HỌC SINH ('individual') */}
            {targetType === 'individual' && (
              <div className="p-3 bg-white rounded-xl border border-purple-200 text-purple-900 font-bold space-y-2">
                <p className="text-xs text-purple-950 font-black flex items-center gap-1.5">
                  <User className="w-4 h-4 text-purple-600" />
                  Gửi riêng cho cá nhân học sinh
                </p>
                <div className="p-2.5 bg-purple-50 rounded-lg border border-purple-100 flex items-center gap-2">
                  <span className="text-sm">👨‍🎓</span>
                  <div className="truncate">
                    <p className="text-xs font-black text-purple-950 truncate">
                      {activeNotif.target_student_name_snapshot || 'Học sinh cá nhân'}
                    </p>
                    {activeNotif.target_student_id && (
                      <p className="text-[10px] text-purple-700 truncate font-mono">
                        UUID: {activeNotif.target_student_id}
                      </p>
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-slate-700 leading-relaxed">
                  Thông báo sẽ xuất hiện duy nhất trong Hộp thư của học sinh này. Các học sinh khác và giáo viên không thể xem.
                </p>
              </div>
            )}

            <p className="text-[10px] text-slate-500 italic">
              * Hệ thống tạo snapshot người nhận tức thời tại thời điểm xuất bản; không hiển thị số lượng suy đoán.
            </p>
          </div>
        </div>

        {/* Footer Modal: Nút hành động */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={isPublishing}
            className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-2xl text-xs font-black transition-all disabled:opacity-40"
          >
            Hủy bỏ
          </button>

          <button
            type="button"
            onClick={handleConfirmPublish}
            disabled={isPublishing || isAlreadyRecalled || isAlreadyPublished || isClassesBlocked}
            className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-2xl text-xs font-black flex items-center gap-1.5 shadow-md shadow-purple-200 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isPublishing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Đang xuất bản...</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                <span>Xác nhận xuất bản</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
