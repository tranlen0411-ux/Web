// src/components/dashboard/notifications/CreateNotificationModal.jsx
// Modal Soạn thông báo lớp học & Lưu bản nháp dành riêng cho Giáo viên (Notifications V1 R3-C2A)
// Giới hạn phạm vi: Chỉ chọn lớp phụ trách (target_type='classes'), publish_now=false bắt buộc, Zero Mutation khác

import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  FileText,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  School,
  Sparkles,
  Check,
  User,
  Search
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext.jsx';
import {
  createNotification,
  createIndividualNotification,
  searchStudentsForNotification
} from '../../../services/notificationClient.js';
import { formatClassLabel } from '../../../utils/helpers.js';

export const CreateNotificationModal = ({
  isOpen,
  onClose,
  classes = [],
  onDraftCreated
}) => {
  const { user, profile } = useAuth();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState('normal'); // 'normal' | 'high' | 'urgent'
  const [category, setCategory] = useState('general'); // 'general' | 'exercise' | 'exam'
  const [selectedClassIds, setSelectedClassIds] = useState([]);

  // Trạng thái cho chế độ người nhận: 'classes' (Lớp học) | 'individual' (Cá nhân học sinh)
  const [targetMode, setTargetMode] = useState('classes');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [studentSearchQuery, setStudentSearchQuery] = useState('');
  const [studentFilterClassId, setStudentFilterClassId] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearchingStudents, setIsSearchingStudents] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [searchRetryCount, setSearchRetryCount] = useState(0);
  const searchRequestIdRef = useRef(0);

  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const titleInputRef = useRef(null);
  const studentSearchInputRef = useRef(null);
  const previouslyFocusedRef = useRef(null);
  const isMountedRef = useRef(true);
  const currentUserIdRef = useRef(user?.id);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    currentUserIdRef.current = user?.id;
  }, [user?.id]);

  // Quản lý Focus khi mở và trả Focus khi đóng modal
  useEffect(() => {
    if (isOpen) {
      previouslyFocusedRef.current = document.activeElement;
      isSubmittingRef.current = false;
      // Focus vào ô tiêu đề
      setTimeout(() => {
        titleInputRef.current?.focus();
      }, 50);
    } else {
      if (previouslyFocusedRef.current && typeof previouslyFocusedRef.current.focus === 'function') {
        previouslyFocusedRef.current.focus();
      }
      // Dọn form khi đóng modal
      setTitle('');
      setContent('');
      setPriority('normal');
      setCategory('general');
      setSelectedClassIds([]);
      setTargetMode('classes');
      setSelectedStudent(null);
      setStudentSearchQuery('');
      setStudentFilterClassId('');
      setSearchResults([]);
      setIsSearchingStudents(false);
      setSearchError(null);
      setSearchRetryCount(0);
      searchRequestIdRef.current = 0;
      setErrorMessage(null);
      setIsSaving(false);
      isSubmittingRef.current = false;
    }
  }, [isOpen]);

  // Phím tắt Escape để đóng modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen && !isSaving && !isSubmittingRef.current) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSaving, onClose]);

  // Khi người dùng đăng xuất trong lúc modal đang mở
  useEffect(() => {
    if (!user && isOpen) {
      onClose();
    }
  }, [user, isOpen, onClose]);

  // Tự động tìm kiếm học sinh khi ở chế độ cá nhân (debounce 300ms)
  useEffect(() => {
    if (!isOpen || targetMode !== 'individual' || selectedStudent) {
      setSearchResults([]);
      setSearchError(null);
      setIsSearchingStudents(false);
      return;
    }

    const trimmed = studentSearchQuery.trim();
    if (!trimmed && !studentFilterClassId) {
      setSearchResults([]);
      setSearchError(null);
      setIsSearchingStudents(false);
      return;
    }

    const currentRequestId = ++searchRequestIdRef.current;
    setIsSearchingStudents(true);
    setSearchError(null);

    const timer = setTimeout(async () => {
      try {
        const res = await searchStudentsForNotification({
          query: trimmed,
          classId: studentFilterClassId || null,
          limit: 10
        });

        // Bỏ qua kết quả cũ nếu đã có request mới hơn (Chống race-condition)
        if (searchRequestIdRef.current !== currentRequestId) return;

        if (res.ok && Array.isArray(res.data)) {
          setSearchResults(res.data);
          setSearchError(null);
        } else {
          setSearchResults([]);
          setSearchError(res.error?.message || 'Không thể tìm kiếm học sinh. Vui lòng thử lại.');
        }
      } catch (err) {
        if (searchRequestIdRef.current === currentRequestId) {
          setSearchResults([]);
          setSearchError(err?.message || 'Lỗi kết nối khi tìm kiếm học sinh.');
        }
      } finally {
        if (searchRequestIdRef.current === currentRequestId) {
          setIsSearchingStudents(false);
        }
      }
    }, 300);

    return () => {
      clearTimeout(timer);
    };
  }, [isOpen, targetMode, selectedStudent, studentSearchQuery, studentFilterClassId, searchRetryCount]);

  const handleRetrySearch = () => {
    setSearchRetryCount((c) => c + 1);
  };

  if (!isOpen) return null;

  const validClasses = Array.isArray(classes) ? classes : [];
  const hasClasses = validClasses.length > 0;

  /**
   * Chọn hoặc bỏ chọn một lớp học
   */
  const handleToggleClass = (classId) => {
    if (isSaving || isSubmittingRef.current) return;
    setErrorMessage(null);
    setSelectedClassIds((prev) =>
      prev.includes(classId) ? prev.filter((id) => id !== classId) : [...prev, classId]
    );
  };

  /**
   * Chọn tất cả các lớp của giáo viên
   */
  const handleSelectAllClasses = () => {
    if (isSaving || isSubmittingRef.current) return;
    setErrorMessage(null);
    if (selectedClassIds.length === validClasses.length) {
      setSelectedClassIds([]);
    } else {
      setSelectedClassIds(validClasses.map((c) => c.id));
    }
  };

  /**
   * Chọn học sinh mục tiêu trong danh sách tìm kiếm
   */
  const handleSelectStudent = (stu) => {
    if (isSaving || isSubmittingRef.current) return;
    setSelectedStudent(stu);
    setSearchResults([]);
    setSearchError(null);
    setStudentSearchQuery('');
    setErrorMessage(null);
  };

  /**
   * Bỏ chọn học sinh hiện tại để tìm học sinh khác
   */
  const handleClearSelectedStudent = () => {
    if (isSaving || isSubmittingRef.current) return;
    setSelectedStudent(null);
    setSearchResults([]);
    setSearchError(null);
    setTimeout(() => {
      studentSearchInputRef.current?.focus();
    }, 50);
  };

  /**
   * Xử lý lưu bản nháp thông báo (publish_now = false)
   */
  const handleSaveDraft = async (e) => {
    e.preventDefault();

    // 1. Chặn submit nếu đang lưu (chống double-submit)
    if (isSaving) return;
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    // 2. Kiểm tra phiên đăng nhập
    if (!user || profile?.role !== 'teacher') {
      isSubmittingRef.current = false;
      setErrorMessage('Phiên làm việc không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.');
      return;
    }

    // 3. Kiểm tra danh sách lớp học
    if (!hasClasses) {
      isSubmittingRef.current = false;
      setErrorMessage('Thầy/Cô chưa có lớp học nào được phân công để tạo thông báo.');
      return;
    }

    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();

    // 4. Validate tiêu đề
    if (!trimmedTitle) {
      isSubmittingRef.current = false;
      setErrorMessage('Vui lòng nhập tiêu đề thông báo.');
      titleInputRef.current?.focus();
      return;
    }
    if (trimmedTitle.length > 200) {
      isSubmittingRef.current = false;
      setErrorMessage('Tiêu đề thông báo không được vượt quá 200 ký tự.');
      return;
    }

    // 5. Validate nội dung
    if (!trimmedContent) {
      isSubmittingRef.current = false;
      setErrorMessage('Vui lòng nhập nội dung thông báo.');
      return;
    }
    if (trimmedContent.length > 5000) {
      isSubmittingRef.current = false;
      setErrorMessage('Nội dung thông báo không được vượt quá 5000 ký tự.');
      return;
    }

    const activeUserId = user.id;

    // 6. Xử lý theo từng chế độ người nhận
    if (targetMode === 'classes') {
      // Validate lớp nhận tin (ít nhất 1 lớp)
      if (selectedClassIds.length === 0) {
        isSubmittingRef.current = false;
        setErrorMessage('Vui lòng chọn ít nhất một lớp học nhận thông báo.');
        return;
      }

      // Bảo vệ ranh giới All-or-Nothing
      const validClassIdSet = new Set(validClasses.map((c) => c.id));
      const hasInvalidClass = selectedClassIds.some((id) => !validClassIdSet.has(id));

      if (hasInvalidClass) {
        isSubmittingRef.current = false;
        setErrorMessage(
          'Một hoặc nhiều lớp học đã chọn không còn thuộc quyền quản lý của Thầy/Cô. Toàn bộ thao tác đã bị dừng để đảm bảo an toàn. Vui lòng tải lại danh sách lớp.'
        );
        return;
      }

      const safeSelectedClassIds = selectedClassIds.filter((id) => validClassIdSet.has(id));
      if (safeSelectedClassIds.length === 0) {
        isSubmittingRef.current = false;
        setErrorMessage('Các lớp được chọn không hợp lệ hoặc không thuộc quyền quản lý của Thầy/Cô.');
        return;
      }

      setIsSaving(true);
      setErrorMessage(null);

      try {
        const res = await createNotification({
          title: trimmedTitle,
          content: trimmedContent,
          priority: priority || 'normal',
          category: category || 'general',
          targetType: 'classes',
          targetClassIds: safeSelectedClassIds,
          publishNow: false
        });

        if (currentUserIdRef.current !== activeUserId) {
          isSubmittingRef.current = false;
          return;
        }

        if (!res.ok) {
          isSubmittingRef.current = false;
          setIsSaving(false);
          setErrorMessage(res.error?.message || 'Không thể lưu bản nháp thông báo. Vui lòng thử lại.');
          return;
        }

        isSubmittingRef.current = false;
        setIsSaving(false);
        if (typeof onDraftCreated === 'function') {
          onDraftCreated(res.data);
        }
        onClose();
      } catch (err) {
        isSubmittingRef.current = false;
        if (currentUserIdRef.current === activeUserId) {
          setIsSaving(false);
          setErrorMessage(err?.message || 'Đã xảy ra lỗi kết nối khi lưu bản nháp.');
        }
      }
    } else if (targetMode === 'individual') {
      // Validate học sinh duy nhất được chọn
      const studentId = selectedStudent?.student_id || selectedStudent?.id;
      if (!selectedStudent || !studentId) {
        isSubmittingRef.current = false;
        setErrorMessage('Vui lòng tìm kiếm và chọn một học sinh nhận thông báo.');
        studentSearchInputRef.current?.focus();
        return;
      }

      setIsSaving(true);
      setErrorMessage(null);

      try {
        const res = await createIndividualNotification({
          title: trimmedTitle,
          content: trimmedContent,
          priority: priority || 'normal',
          category: category || 'general',
          targetStudentId: studentId,
          publishNow: false
        });

        if (currentUserIdRef.current !== activeUserId) {
          isSubmittingRef.current = false;
          return;
        }

        if (!res.ok) {
          isSubmittingRef.current = false;
          setIsSaving(false);
          setErrorMessage(res.error?.message || 'Không thể lưu bản nháp thông báo cá nhân. Vui lòng thử lại.');
          return;
        }

        isSubmittingRef.current = false;
        setIsSaving(false);
        if (typeof onDraftCreated === 'function') {
          onDraftCreated(res.data);
        }
        onClose();
      } catch (err) {
        isSubmittingRef.current = false;
        if (currentUserIdRef.current === activeUserId) {
          setIsSaving(false);
          setErrorMessage(err?.message || 'Đã xảy ra lỗi kết nối khi lưu bản nháp.');
        }
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-notification-title"
    >
      {/* Nền mờ Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm transition-opacity"
        onClick={() => {
          if (!isSaving) onClose();
        }}
        aria-hidden="true"
      />

      {/* Thân Modal */}
      <div className="relative bg-white rounded-3xl border-4 border-amber-300 shadow-2xl w-full max-w-2xl overflow-hidden z-10 flex flex-col max-h-[92vh] animate-fadeIn">
        {/* HEADER MODAL */}
        <header className="px-6 py-4 bg-gradient-to-r from-amber-100 to-yellow-100 border-b-2 border-amber-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-white border-2 border-amber-300 flex items-center justify-center text-xl shadow-sm">
              📝
            </div>
            <div>
              <h2 id="create-notification-title" className="text-base sm:text-lg font-black text-amber-950 flex items-center gap-1.5">
                Soạn Thông Báo Lớp Học
              </h2>
              <p className="text-[11px] font-bold text-amber-800">
                Lưu bản nháp trước khi xuất bản cho học sinh
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              if (!isSaving) onClose();
            }}
            disabled={isSaving}
            aria-label="Đóng hộp thoại"
            className="p-2 rounded-2xl text-slate-600 hover:bg-white hover:text-rose-600 active:scale-95 transition-all border-2 border-transparent hover:border-amber-200 shadow-sm disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* NỘI DUNG FORM SOẠN THẢO */}
        <form onSubmit={handleSaveDraft} className="p-6 overflow-y-auto space-y-5 flex-1 text-left">
          {/* CẢNH BÁO NẾU GIÁO VIÊN CHƯA ĐƯỢC PHÂN CÔNG LỚP */}
          {!hasClasses && (
            <div className="p-4 bg-amber-50 border-2 border-amber-300 rounded-2xl flex items-start gap-3 text-amber-950 text-xs">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-black text-sm">Thầy/Cô chưa được phân công lớp học nào!</p>
                <p className="font-bold text-slate-600 mt-1">
                  Vui lòng liên hệ Quản trị viên nhà trường để được phân công lớp phụ trách trước khi soạn thông báo.
                </p>
              </div>
            </div>
          )}

          {/* BANNER BÁO LỖI NẾU CÓ */}
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

          {/* 1. TIÊU ĐỀ THÔNG BÁO */}
          <div>
            <label htmlFor="notif-title" className="block text-xs font-black text-amber-950 mb-1.5">
              Tiêu đề thông báo <span className="text-rose-500">*</span>
            </label>
            <input
              ref={titleInputRef}
              id="notif-title"
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setErrorMessage(null);
              }}
              disabled={isSaving || !hasClasses}
              maxLength={200}
              placeholder="Ví dụ: Nhắc nhở nộp bài tập Tuần 8, Lịch học bù thứ Bảy..."
              className="w-full px-4 py-2.5 rounded-2xl border-2 border-slate-200 focus:border-amber-400 focus:outline-none text-xs sm:text-sm font-bold text-slate-800 transition-all placeholder:text-slate-400 disabled:bg-slate-50"
            />
            <div className="flex justify-end mt-1 text-[11px] font-bold text-slate-400">
              {title.length}/200 ký tự
            </div>
          </div>

          {/* 2. CHỌN MỨC ĐỘ ƯU TIÊN VÀ PHÂN LOẠI */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Mức độ ưu tiên */}
            <div>
              <label className="block text-xs font-black text-amber-950 mb-1.5">
                Mức độ ưu tiên
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => setPriority('normal')}
                  disabled={isSaving}
                  className={`py-2 px-2 rounded-xl text-xs font-black border-2 transition-all text-center ${
                    priority === 'normal'
                      ? 'bg-sky-50 border-sky-400 text-sky-900 shadow-sm'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  📌 Thường
                </button>

                <button
                  type="button"
                  onClick={() => setPriority('high')}
                  disabled={isSaving}
                  className={`py-2 px-2 rounded-xl text-xs font-black border-2 transition-all text-center ${
                    priority === 'high'
                      ? 'bg-amber-100 border-amber-400 text-amber-950 shadow-sm'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  ⭐ Quan trọng
                </button>

                <button
                  type="button"
                  onClick={() => setPriority('urgent')}
                  disabled={isSaving}
                  className={`py-2 px-2 rounded-xl text-xs font-black border-2 transition-all text-center ${
                    priority === 'urgent'
                      ? 'bg-rose-100 border-rose-400 text-rose-950 shadow-sm'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  🚨 Khẩn cấp
                </button>
              </div>
            </div>

            {/* Phân loại nội dung */}
            <div>
              <label htmlFor="notif-category" className="block text-xs font-black text-amber-950 mb-1.5">
                Chủ đề thông báo
              </label>
              <select
                id="notif-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={isSaving}
                className="w-full px-3 py-2 rounded-xl border-2 border-slate-200 focus:border-amber-400 focus:outline-none text-xs font-bold text-slate-800 bg-white"
              >
                <option value="general">📢 Thông báo chung</option>
                <option value="exercise">📚 Bài tập về nhà</option>
                <option value="exam">📝 Lịch kiểm tra / Ôn tập</option>
              </select>
            </div>
          </div>

          {/* 3. ĐỐI TƯỢNG NHẬN THÔNG BÁO (LỚP HỌC HOẶC CÁ NHÂN HỌC SINH) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-black text-amber-950 flex items-center gap-1.5">
                <School className="w-3.5 h-3.5 text-amber-600" />
                <span>Đối tượng nhận thông báo: <span className="text-rose-500">*</span></span>
              </label>
              <span className="text-[11px] font-bold text-slate-400">
                Chỉ gửi trong phạm vi các lớp Thầy/Cô phụ trách
              </span>
            </div>

            {/* Chuyển đổi chế độ: Cả lớp vs Cá nhân học sinh */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setTargetMode('classes');
                  setErrorMessage(null);
                }}
                disabled={isSaving}
                className={`py-2 px-3 rounded-xl border-2 text-xs font-black transition-all flex items-center justify-center gap-1.5 ${
                  targetMode === 'classes'
                    ? 'bg-amber-100 border-amber-400 text-amber-950 shadow-sm'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <School className="w-4 h-4" />
                <span>Gửi tới Lớp học</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setTargetMode('individual');
                  setErrorMessage(null);
                }}
                disabled={isSaving}
                className={`py-2 px-3 rounded-xl border-2 text-xs font-black transition-all flex items-center justify-center gap-1.5 ${
                  targetMode === 'individual'
                    ? 'bg-amber-100 border-amber-400 text-amber-950 shadow-sm'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <User className="w-4 h-4" />
                <span>Gửi riêng Học sinh</span>
              </button>
            </div>

            {/* CHẾ ĐỘ 1: GỬI TỚI LỚP HỌC PHỤ TRÁCH */}
            {targetMode === 'classes' && (
              <div className="p-3 bg-slate-50/70 border-2 border-slate-200 rounded-2xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-slate-700">
                    Chọn các lớp nhận tin:
                  </span>
                  {hasClasses && (
                    <button
                      type="button"
                      onClick={handleSelectAllClasses}
                      disabled={isSaving}
                      className="text-[11px] font-black text-sky-600 hover:text-sky-800 underline"
                    >
                      {selectedClassIds.length === validClasses.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                    </button>
                  )}
                </div>

                {hasClasses ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto p-1">
                    {validClasses.map((cls) => {
                      const isChecked = selectedClassIds.includes(cls.id);
                      return (
                        <label
                          key={cls.id}
                          onClick={() => handleToggleClass(cls.id)}
                          className={`p-2.5 rounded-xl border-2 cursor-pointer flex items-center gap-2.5 transition-all text-xs font-bold ${
                            isChecked
                              ? 'bg-amber-100/70 border-amber-400 text-amber-950'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <div
                            className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 ${
                              isChecked
                                ? 'bg-amber-500 border-amber-600 text-white'
                                : 'border-slate-300 bg-white'
                            }`}
                          >
                            {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                          </div>

                          <div className="truncate">
                            <span className="font-black">{formatClassLabel(cls.name)}</span>
                            {cls.grade_level && (
                              <span className="text-[10px] text-slate-500 ml-1.5">
                                (Khối {cls.grade_level})
                              </span>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-3 bg-slate-100 rounded-xl text-center text-xs text-slate-500 font-bold">
                    Không tìm thấy lớp học nào do Thầy/Cô phụ trách.
                  </div>
                )}
                <p className="text-[11px] font-bold text-slate-500">
                  Đã chọn: <strong className="text-amber-950">{selectedClassIds.length}</strong> lớp học.
                </p>
              </div>
            )}

            {/* CHẾ ĐỘ 2: GỬI RIÊNG CHO MỘT CÁ NHÂN HỌC SINH */}
            {targetMode === 'individual' && (
              <div className="p-3.5 bg-amber-50/50 border-2 border-amber-200 rounded-2xl space-y-3">
                {selectedStudent ? (
                  /* ĐÃ CHỌN HỌC SINH */
                  <div className="p-3 bg-white border-2 border-amber-400 rounded-xl flex items-center justify-between gap-3 shadow-sm">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-900 border border-amber-300 flex items-center justify-center font-black text-sm shrink-0">
                        👨‍🎓
                      </div>
                      <div className="truncate">
                        <p className="text-xs font-black text-slate-900 truncate">
                          {selectedStudent.full_name || selectedStudent.username}
                        </p>
                        <p className="text-[11px] font-bold text-slate-500 truncate">
                          Mã: <span className="text-amber-950 font-black">{selectedStudent.student_code || 'Chưa cập nhật'}</span>
                          {selectedStudent.class_name && (
                            <> • Lớp: <span className="text-amber-950 font-black">{formatClassLabel(selectedStudent.class_name)}</span></>
                          )}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleClearSelectedStudent}
                      disabled={isSaving}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-black rounded-lg transition-all shrink-0 border border-slate-300"
                    >
                      Đổi học sinh
                    </button>
                  </div>
                ) : (
                  /* CHƯA CHỌN: TÌM KIẾM HỌC SINH */
                  <div className="space-y-2.5">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {/* Lọc theo lớp phụ trách */}
                      <div className="sm:col-span-1">
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          Lọc theo lớp:
                        </label>
                        <select
                          value={studentFilterClassId}
                          onChange={(e) => setStudentFilterClassId(e.target.value)}
                          disabled={isSaving}
                          className="w-full px-2.5 py-2 bg-white border-2 border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-amber-400"
                        >
                          <option value="">Tất cả lớp của tôi</option>
                          {validClasses.map((c) => (
                            <option key={c.id} value={c.id}>
                              {formatClassLabel(c.name)}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Ô nhập tìm kiếm */}
                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          Tìm kiếm học sinh:
                        </label>
                        <div className="relative">
                          <input
                            ref={studentSearchInputRef}
                            type="text"
                            value={studentSearchQuery}
                            onChange={(e) => setStudentSearchQuery(e.target.value)}
                            disabled={isSaving}
                            placeholder="Nhập họ tên hoặc mã học sinh..."
                            className="w-full pl-8 pr-3 py-2 bg-white border-2 border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-amber-400 placeholder:text-slate-400"
                          />
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                        </div>
                      </div>
                    </div>

                    {/* Trạng thái tìm kiếm & Kết quả */}
                    {isSearchingStudents ? (
                      <div className="p-3 bg-white rounded-xl border border-slate-200 text-center text-xs text-slate-500 font-bold flex items-center justify-center gap-2">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-600" />
                        <span>Đang tìm kiếm học sinh trong danh sách phụ trách...</span>
                      </div>
                    ) : searchError ? (
                      <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center justify-between gap-2 animate-fadeIn">
                        <div className="flex items-center gap-2 min-w-0">
                          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                          <span className="font-bold truncate">{searchError}</span>
                        </div>
                        <button
                          type="button"
                          onClick={handleRetrySearch}
                          className="px-2.5 py-1 bg-white hover:bg-rose-100 text-rose-700 text-[11px] font-black rounded-lg border border-rose-300 transition-all shrink-0 shadow-xs"
                        >
                          Thử lại
                        </button>
                      </div>
                    ) : searchResults.length > 0 ? (
                      <div className="space-y-1.5 max-h-40 overflow-y-auto p-1 bg-white border border-slate-200 rounded-xl">
                        {searchResults.map((stu) => {
                          const stuKey = stu.student_id || stu.id;
                          return (
                            <div
                              key={stuKey}
                              className="p-2 rounded-lg hover:bg-amber-50 border border-transparent hover:border-amber-200 flex items-center justify-between gap-2 transition-all"
                            >
                              <div className="truncate">
                                <span className="text-xs font-black text-slate-900 block truncate">
                                  {stu.full_name || stu.username}
                                </span>
                                <span className="text-[10px] font-bold text-slate-500">
                                  Mã: {stu.student_code || '---'} • Lớp: {formatClassLabel(stu.class_name)}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleSelectStudent(stu)}
                                disabled={isSaving}
                                className="px-2.5 py-1 bg-amber-400 hover:bg-amber-500 text-amber-950 text-[11px] font-black rounded-lg transition-all shrink-0 shadow-xs"
                              >
                                Chọn
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      (studentSearchQuery.trim() || studentFilterClassId) && (
                        <p className="text-[11px] font-bold text-slate-500 p-2 text-center bg-white rounded-xl border border-slate-200">
                          Không tìm thấy học sinh nào phù hợp trong các lớp Thầy/Cô phụ trách.
                        </p>
                      )
                    )}

                    {!selectedStudent && !studentSearchQuery.trim() && !studentFilterClassId && (
                      <p className="text-[11px] font-bold text-slate-500 text-center py-1">
                        * Nhập tên hoặc mã học sinh vào ô trên để tìm và chọn đúng một học sinh nhận tin.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 4. NỘI DUNG THÔNG BÁO */}
          <div>
            <label htmlFor="notif-content" className="block text-xs font-black text-amber-950 mb-1.5">
              Nội dung thông báo <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="notif-content"
              rows={5}
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                setErrorMessage(null);
              }}
              disabled={isSaving || !hasClasses}
              maxLength={5000}
              placeholder="Nhập nội dung chi tiết thông báo gửi đến các em học sinh và phụ huynh..."
              className="w-full px-4 py-3 rounded-2xl border-2 border-slate-200 focus:border-amber-400 focus:outline-none text-xs sm:text-sm font-medium text-slate-800 transition-all placeholder:text-slate-400 disabled:bg-slate-50 resize-y"
            />
            <div className="flex justify-end mt-1 text-[11px] font-bold text-slate-400">
              {content.length}/5000 ký tự
            </div>
          </div>
        </form>

        {/* FOOTER MODAL */}
        <footer className="px-6 py-4 bg-slate-50 border-t-2 border-slate-100 flex items-center justify-between gap-3">
          <p className="text-[11px] font-bold text-slate-500 hidden sm:block">
            * Thông báo sẽ được lưu ở trạng thái Bản nháp để Thầy/Cô kiểm tra trước khi gửi.
          </p>

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-5 py-2.5 bg-white text-slate-700 hover:bg-slate-100 font-black text-xs rounded-2xl border-2 border-slate-200 transition-all disabled:opacity-50"
            >
              Hủy
            </button>

            {/* Nút LƯU BẢN NHÁP (publish_now = false) */}
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={isSaving || !hasClasses}
              className="px-6 py-2.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-amber-950 font-black text-xs sm:text-sm rounded-2xl border-b-4 border-amber-600 shadow-md flex items-center gap-2 active:translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Đang lưu bản nháp...</span>
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4" />
                  <span>Lưu Bản Nháp</span>
                </>
              )}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};
