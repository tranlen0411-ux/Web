// src/components/dashboard/notifications/AdminCreateNotificationModal.jsx
// Modal Soạn thông báo & Lưu bản nháp dành riêng cho Quản trị viên (Notifications V1 R3-D2A)
// Hỗ trợ 3 phạm vi: Toàn trường ('all'), Theo khối ('grade'), Theo lớp ('classes')
// R3-D2A: Khóa cứng publishNow = false (Chỉ tạo bản nháp), Zero Mutation khác

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  X,
  FileText,
  AlertCircle,
  School,
  Layers,
  GraduationCap,
  ShieldCheck,
  Check,
  CheckCircle2,
  RefreshCw,
  Info,
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

// Danh sách khối lớp hợp lệ theo quy chuẩn nghiệp vụ (Khối 1 đến Khối 5)
const VALID_GRADE_LEVELS = [1, 2, 3, 4, 5];

export const AdminCreateNotificationModal = ({
  isOpen,
  onClose,
  classes = [],
  isClassesComplete = false,
  onDraftCreated
}) => {
  const { user, profile } = useAuth();

  // Các trường dữ liệu biểu mẫu
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState('normal'); // 'normal' | 'high' | 'urgent'
  const [category, setCategory] = useState('general'); // 'general' | 'system' | 'exercise' | 'exam' | 'material'

  // Phạm vi người nhận: 'all' | 'grade' | 'classes' | 'individual'
  const [targetType, setTargetType] = useState('all');
  const [targetGradeLevel, setTargetGradeLevel] = useState(1);
  const [selectedClassIds, setSelectedClassIds] = useState([]);

  // Dữ liệu cho phạm vi Cá nhân học sinh ('individual')
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [studentSearchQuery, setStudentSearchQuery] = useState('');
  const [studentFilterGrade, setStudentFilterGrade] = useState('');
  const [studentFilterClassId, setStudentFilterClassId] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearchingStudents, setIsSearchingStudents] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  // Refs quản lý focus, lifecycle và chống double-submit đồng bộ
  const titleInputRef = useRef(null);
  const studentSearchInputRef = useRef(null);
  const previouslyFocusedRef = useRef(null);
  const currentUserIdRef = useRef(user?.id);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    currentUserIdRef.current = user?.id;
  }, [user?.id]);

  // Danh sách lớp hợp lệ toàn hệ thống
  const validClasses = useMemo(() => {
    return Array.isArray(classes) ? classes : [];
  }, [classes]);

  // Gom nhóm lớp học theo khối để Admin dễ dàng chọn
  const classesByGrade = useMemo(() => {
    const map = new Map();
    VALID_GRADE_LEVELS.forEach((g) => map.set(g, []));
    validClasses.forEach((c) => {
      const g = Number(c.grade_level);
      if (map.has(g)) {
        map.get(g).push(c);
      } else {
        if (!map.has('other')) map.set('other', []);
        map.get('other').push(c);
      }
    });
    return map;
  }, [validClasses]);

  // Quản lý Focus khi mở và trả Focus khi đóng modal
  useEffect(() => {
    if (isOpen) {
      previouslyFocusedRef.current = document.activeElement;
      isSubmittingRef.current = false;
      setTimeout(() => {
        titleInputRef.current?.focus();
      }, 50);
    } else {
      if (previouslyFocusedRef.current && typeof previouslyFocusedRef.current.focus === 'function') {
        previouslyFocusedRef.current.focus();
      }
      // Dọn form về trạng thái mặc định khi đóng modal
      setTitle('');
      setContent('');
      setPriority('normal');
      setCategory('general');
      setTargetType('all');
      setTargetGradeLevel(1);
      setSelectedClassIds([]);
      setSelectedStudent(null);
      setStudentSearchQuery('');
      setStudentFilterGrade('');
      setStudentFilterClassId('');
      setSearchResults([]);
      setIsSearchingStudents(false);
      setErrorMessage(null);
      setIsSaving(false);
      isSubmittingRef.current = false;
    }
  }, [isOpen]);

  // Phím tắt Escape để đóng modal an toàn
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen && !isSaving && !isSubmittingRef.current) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSaving, onClose]);

  // Đăng xuất hoặc chuyển tài khoản khi đang mở modal -> lập tức đóng modal
  useEffect(() => {
    if (!user && isOpen) {
      onClose();
    }
  }, [user, isOpen, onClose]);

  // Debounced search học sinh toàn trường cho Admin
  useEffect(() => {
    if (!isOpen || targetType !== 'individual' || selectedStudent) {
      setSearchResults([]);
      return;
    }

    const trimmed = studentSearchQuery.trim();
    if (!trimmed && !studentFilterGrade && !studentFilterClassId) {
      setSearchResults([]);
      return;
    }

    let isCurrent = true;
    const timer = setTimeout(async () => {
      setIsSearchingStudents(true);
      try {
        const res = await searchStudentsForNotification({
          query: trimmed,
          gradeLevel: studentFilterGrade ? Number(studentFilterGrade) : null,
          classId: studentFilterClassId || null,
          limit: 10
        });
        if (isCurrent && res.ok && Array.isArray(res.data)) {
          setSearchResults(res.data);
        }
      } catch (err) {
        // Lỗi tìm kiếm không làm văng form
      } finally {
        if (isCurrent) {
          setIsSearchingStudents(false);
        }
      }
    }, 300);

    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [isOpen, targetType, selectedStudent, studentSearchQuery, studentFilterGrade, studentFilterClassId]);

  if (!isOpen) return null;

  /**
   * Chuyển đổi loại phạm vi mục tiêu
   * Tuyệt đối không giữ lại dữ liệu rác của phạm vi cũ
   */
  const handleScopeTypeChange = (newType) => {
    if (isSaving || isSubmittingRef.current) return;
    setErrorMessage(null);
    setTargetType(newType);

    if (newType === 'all') {
      // Phạm vi toàn trường: Xóa khối và danh sách lớp, học sinh
      setTargetGradeLevel(null);
      setSelectedClassIds([]);
      setSelectedStudent(null);
    } else if (newType === 'grade') {
      // Phạm vi theo khối: Đặt khối mặc định (1), xóa danh sách lớp, học sinh
      setTargetGradeLevel((prev) => (prev && VALID_GRADE_LEVELS.includes(prev) ? prev : 1));
      setSelectedClassIds([]);
      setSelectedStudent(null);
    } else if (newType === 'classes') {
      // Phạm vi theo lớp: Xóa khối, học sinh
      setTargetGradeLevel(null);
      setSelectedStudent(null);
    } else if (newType === 'individual') {
      // Phạm vi cá nhân: Xóa khối và danh sách lớp
      setTargetGradeLevel(null);
      setSelectedClassIds([]);
    }
  };

  /**
   * Chọn học sinh mục tiêu trong danh sách tìm kiếm
   */
  const handleSelectStudent = (stu) => {
    if (isSaving || isSubmittingRef.current) return;
    setSelectedStudent(stu);
    setSearchResults([]);
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
    setTimeout(() => {
      studentSearchInputRef.current?.focus();
    }, 50);
  };

  /**
   * Chọn / Bỏ chọn một lớp học
   */
  const handleToggleClass = (classId) => {
    if (isSaving || isSubmittingRef.current) return;
    setErrorMessage(null);
    setSelectedClassIds((prev) =>
      prev.includes(classId) ? prev.filter((id) => id !== classId) : [...prev, classId]
    );
  };

  /**
   * Chọn tất cả lớp trong một khối
   */
  const handleToggleGradeClasses = (grade) => {
    if (isSaving || isSubmittingRef.current) return;
    setErrorMessage(null);
    const gradeClasses = classesByGrade.get(grade) || [];
    const gradeClassIds = gradeClasses.map((c) => c.id);
    const allSelected = gradeClassIds.every((id) => selectedClassIds.includes(id));

    if (allSelected) {
      setSelectedClassIds((prev) => prev.filter((id) => !gradeClassIds.includes(id)));
    } else {
      setSelectedClassIds((prev) => Array.from(new Set([...prev, ...gradeClassIds])));
    }
  };

  /**
   * Chọn tất cả lớp học trong toàn trường
   */
  const handleSelectAllClasses = () => {
    if (isSaving || isSubmittingRef.current) return;
    if (!isClassesComplete) {
      setErrorMessage('Không thể chọn tất cả lớp khi dữ liệu danh sách lớp chưa được tải đầy đủ.');
      return;
    }
    setErrorMessage(null);
    if (selectedClassIds.length === validClasses.length) {
      setSelectedClassIds([]);
    } else {
      setSelectedClassIds(validClasses.map((c) => c.id));
    }
  };

  /**
   * Xử lý Lưu bản nháp (R3-D2A: publishNow = false bắt buộc)
   */
  const handleSaveDraft = async (e) => {
    if (e) e.preventDefault();

    // 1. Chống double-submit bằng cờ đồng bộ và state
    if (isSaving) return;
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    // 2. Bảo vệ phân quyền: Chỉ Admin mới có quyền thực thi
    if (!user || profile?.role !== 'admin') {
      isSubmittingRef.current = false;
      setErrorMessage('Quyền truy cập bị từ chối: Chỉ Quản trị viên mới được tạo thông báo hệ thống.');
      return;
    }

    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();

    // 3. Validate tiêu đề
    if (!trimmedTitle) {
      isSubmittingRef.current = false;
      setErrorMessage('Vui lòng nhập tiêu đề thông báo.');
      titleInputRef.current?.focus();
      return;
    }
    if (trimmedTitle.length > 255) {
      isSubmittingRef.current = false;
      setErrorMessage('Tiêu đề thông báo không được vượt quá 255 ký tự.');
      return;
    }

    // 4. Validate nội dung
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

    // 5. Validate phạm vi người nhận & Xây dựng payload an toàn
    let payloadTargetType = targetType;
    let payloadGradeLevel = null;
    let payloadClassIds = [];

    if (targetType === 'all') {
      payloadTargetType = 'all';
      payloadGradeLevel = null;
      payloadClassIds = [];
    } else if (targetType === 'grade') {
      const g = Number(targetGradeLevel);
      if (!VALID_GRADE_LEVELS.includes(g)) {
        isSubmittingRef.current = false;
        setErrorMessage('Khối lớp được chọn không hợp lệ. Vui lòng chọn khối từ 1 đến 5.');
        return;
      }
      payloadTargetType = 'grade';
      payloadGradeLevel = g;
      payloadClassIds = [];
    } else if (targetType === 'classes') {
      if (!isClassesComplete) {
        isSubmittingRef.current = false;
        setErrorMessage('Không thể tạo thông báo theo lớp: Dữ liệu danh sách lớp chưa được tải đầy đủ từ hệ thống (Fail-Closed).');
        return;
      }
      if (validClasses.length === 0) {
        isSubmittingRef.current = false;
        setErrorMessage('Không thể gửi theo lớp: Hệ thống chưa tải được danh sách lớp học.');
        return;
      }
      if (selectedClassIds.length === 0) {
        isSubmittingRef.current = false;
        setErrorMessage('Vui lòng chọn ít nhất một lớp học nhận thông báo.');
        return;
      }

      // Nguyên tắc All-or-Nothing: Nếu có bất kỳ lớp nào không hợp lệ, từ chối toàn bộ thao tác
      const validClassIdSet = new Set(validClasses.map((c) => c.id));
      const hasInvalidClass = selectedClassIds.some((id) => !validClassIdSet.has(id));

      if (hasInvalidClass) {
        isSubmittingRef.current = false;
        setErrorMessage(
          'Một hoặc nhiều lớp học đã chọn không tồn tại trong hệ thống. Thao tác đã bị dừng lại để đảm bảo tính toàn vẹn dữ liệu (All-or-Nothing).'
        );
        return;
      }

      payloadTargetType = 'classes';
      payloadGradeLevel = null;
      payloadClassIds = selectedClassIds;
    } else if (targetType === 'individual') {
      if (!selectedStudent || !selectedStudent.id) {
        isSubmittingRef.current = false;
        setErrorMessage('Vui lòng tìm kiếm và chọn một học sinh nhận thông báo.');
        studentSearchInputRef.current?.focus();
        return;
      }
      payloadTargetType = 'individual';
      payloadGradeLevel = null;
      payloadClassIds = [];
    } else {
      isSubmittingRef.current = false;
      setErrorMessage('Loại phạm vi người nhận không hợp lệ.');
      return;
    }

    const activeUserId = user.id;
    setIsSaving(true);
    setErrorMessage(null);

    try {
      // GỌI RPC TẠO BẢN NHÁP: publishNow = false BẮT BUỘC KHÓA CỨNG TRONG MỌI TRƯỜNG HỢP
      let res;
      if (payloadTargetType === 'individual') {
        res = await createIndividualNotification({
          title: trimmedTitle,
          content: trimmedContent,
          priority: priority || 'normal',
          category: category || 'general',
          targetStudentId: selectedStudent.id,
          publishNow: false
        });
      } else {
        res = await createNotification({
          title: trimmedTitle,
          content: trimmedContent,
          priority: priority || 'normal',
          category: category || 'general',
          targetType: payloadTargetType,
          targetGradeLevel: payloadGradeLevel,
          targetClassIds: payloadClassIds,
          publishNow: false
        });
      }

      // Chống Race Condition nếu user đăng xuất hoặc đổi tài khoản khi request đang xử lý
      if (currentUserIdRef.current !== activeUserId) {
        isSubmittingRef.current = false;
        return;
      }

      setIsSaving(false);
      isSubmittingRef.current = false;

      if (!res.ok) {
        setErrorMessage(res.error?.message || 'Không thể lưu bản nháp thông báo. Vui lòng thử lại.');
        return;
      }

      // Khi thành công: res.data chứa UUID của thông báo bản nháp vừa tạo
      if (res.data) {
        if (typeof onDraftCreated === 'function') {
          onDraftCreated(res.data);
        }
        onClose();
      } else {
        // Trường hợp không rõ kết quả: Hướng dẫn Admin kiểm tra lại danh sách
        setErrorMessage(
          'Máy chủ đã xử lý nhưng chưa xác nhận mã thông báo. Vui lòng đóng cửa sổ và kiểm tra lại danh sách thông báo trước khi thử lại.'
        );
      }
    } catch (err) {
      if (currentUserIdRef.current === activeUserId) {
        setIsSaving(false);
        isSubmittingRef.current = false;
        setErrorMessage(
          err?.message ||
            'Đã xảy ra lỗi kết nối khi lưu bản nháp. Vui lòng kiểm tra lại danh sách trước khi gửi lại.'
        );
      }
    }
  };

  // Helper hiển thị nhãn tóm tắt phạm vi mục tiêu trước khi lưu
  const renderTargetScopeSummary = () => {
    if (targetType === 'all') {
      return (
        <span className="text-purple-700 font-bold">
          Toàn trường (Tất cả Giáo viên & Học sinh đang hoạt động)
        </span>
      );
    }
    if (targetType === 'grade') {
      return (
        <span className="text-indigo-700 font-bold">
          Toàn bộ Khối {targetGradeLevel || 1} (Tất cả học sinh thuộc khối {targetGradeLevel || 1})
        </span>
      );
    }
    if (targetType === 'classes') {
      if (selectedClassIds.length === 0) {
        return <span className="text-amber-700 font-bold">Chưa chọn lớp nào</span>;
      }
      return (
        <span className="text-emerald-700 font-bold">
          {selectedClassIds.length} lớp học được chọn
        </span>
      );
    }
    if (targetType === 'individual') {
      if (!selectedStudent) {
        return <span className="text-rose-600 font-bold">Chưa chọn học sinh nhận tin</span>;
      }
      return (
        <span className="text-purple-800 font-bold">
          Học sinh: {selectedStudent.full_name || selectedStudent.username} {selectedStudent.student_code ? `(${selectedStudent.student_code})` : ''} {selectedStudent.class_name ? `• ${formatClassLabel(selectedStudent.class_name)}` : ''}
        </span>
      );
    }
    return <span className="text-slate-500 font-bold">Chưa xác định</span>;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-create-notif-title"
    >
      <div className="bg-white rounded-3xl border-4 border-purple-200 shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* HEADER MODAL */}
        <div className="p-5 sm:p-6 border-b border-purple-100 flex items-center justify-between bg-gradient-to-r from-purple-50 via-white to-purple-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-purple-600 text-white flex items-center justify-center shadow-md">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2
                  id="admin-create-notif-title"
                  className="text-lg sm:text-xl font-black text-slate-900"
                >
                  Soạn thông báo
                </h2>
                <span className="px-2.5 py-0.5 bg-purple-100 text-purple-900 text-[10px] font-black rounded-lg uppercase flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" /> Admin
                </span>
              </div>
              <p className="text-xs font-bold text-slate-500 mt-0.5">
                Tạo và lưu bản nháp thông báo toàn hệ thống trường học
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isSaving}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all disabled:opacity-50"
            aria-label="Đóng cửa sổ"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* THÔNG BÁO LỖI NẾU CÓ */}
        {errorMessage && (
          <div className="mx-6 mt-4 p-4 bg-rose-50 border-2 border-rose-200 rounded-2xl text-xs text-rose-800 flex items-start gap-2.5 animate-shake">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold">{errorMessage}</span>
              <p className="text-[11px] text-rose-600 font-medium">
                Nội dung bạn đang soạn thảo vẫn được giữ nguyên để chỉnh sửa tiếp.
              </p>
            </div>
          </div>
        )}

        {/* FORM SOẠN THẢO */}
        <form onSubmit={handleSaveDraft} className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
          {/* TIÊU ĐỀ */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="admin-notif-title" className="text-xs font-black text-slate-800">
                Tiêu đề thông báo <span className="text-rose-500">*</span>
              </label>
              <span className="text-[11px] font-bold text-slate-400">
                {title.length}/255 ký tự
              </span>
            </div>
            <input
              id="admin-notif-title"
              ref={titleInputRef}
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setErrorMessage(null);
              }}
              disabled={isSaving}
              maxLength={255}
              placeholder="Ví dụ: Kế hoạch tổ chức Hội khỏe Phù Đổng toàn trường..."
              className="w-full px-4 py-2.5 bg-slate-50 border-2 border-slate-200 focus:border-purple-500 focus:bg-white rounded-2xl text-xs font-bold text-slate-900 outline-none transition-all placeholder:text-slate-400 disabled:opacity-60"
            />
          </div>

          {/* NỘI DUNG */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="admin-notif-content" className="text-xs font-black text-slate-800">
                Nội dung chi tiết <span className="text-rose-500">*</span>
              </label>
              <span className="text-[11px] font-bold text-slate-400">
                {content.length}/5000 ký tự
              </span>
            </div>
            <textarea
              id="admin-notif-content"
              rows={4}
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                setErrorMessage(null);
              }}
              disabled={isSaving}
              maxLength={5000}
              placeholder="Nhập nội dung thông báo gửi đến giáo viên hoặc học sinh..."
              className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-200 focus:border-purple-500 focus:bg-white rounded-2xl text-xs font-medium text-slate-900 outline-none transition-all placeholder:text-slate-400 disabled:opacity-60 resize-none leading-relaxed"
            />
          </div>

          {/* PHÂN LOẠI & MỨC ƯU TIÊN */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Mức độ ưu tiên */}
            <div>
              <label htmlFor="admin-notif-priority" className="block text-xs font-black text-slate-800 mb-1.5">
                Mức độ ưu tiên
              </label>
              <select
                id="admin-notif-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                disabled={isSaving}
                className="w-full px-3.5 py-2.5 bg-slate-50 border-2 border-slate-200 focus:border-purple-500 rounded-2xl text-xs font-bold text-slate-800 outline-none transition-all"
              >
                <option value="normal">Bình thường (Thông báo chung)</option>
                <option value="high">⭐ Quan trọng (Cần chú ý)</option>
                <option value="urgent">🚨 Khẩn cấp (Ưu tiên cao nhất)</option>
              </select>
            </div>

            {/* Phân loại danh mục */}
            <div>
              <label htmlFor="admin-notif-category" className="block text-xs font-black text-slate-800 mb-1.5">
                Chuyên mục
              </label>
              <select
                id="admin-notif-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={isSaving}
                className="w-full px-3.5 py-2.5 bg-slate-50 border-2 border-slate-200 focus:border-purple-500 rounded-2xl text-xs font-bold text-slate-800 outline-none transition-all"
              >
                <option value="general">Thông báo chung</option>
                <option value="system">Hệ thống & Kỹ thuật</option>
                <option value="exam">Kỳ thi & Khảo sát</option>
                <option value="exercise">Bài tập học thuật</option>
                <option value="material">Học liệu bài giảng</option>
              </select>
            </div>
          </div>

          {/* BỘ CHỌN PHẠM VI NGƯỜI NHẬN */}
          <div className="space-y-3 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <label className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                <School className="w-4 h-4 text-purple-600" />
                Phạm vi người nhận <span className="text-rose-500">*</span>
              </label>
              <span className="text-[11px] font-bold text-slate-400">
                Chỉ Admin được gửi Toàn trường hoặc Theo khối
              </span>
            </div>

            {/* 4 LỰA CHỌN PHẠM VI CHỦ ĐẠO CHO ADMIN */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <button
                type="button"
                onClick={() => handleScopeTypeChange('all')}
                disabled={isSaving}
                className={`p-3 rounded-2xl border-2 text-left transition-all ${
                  targetType === 'all'
                    ? 'border-purple-600 bg-purple-50/70 shadow-sm'
                    : 'border-slate-200 hover:border-purple-300 bg-white'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-black text-purple-950 flex items-center gap-1">
                    <School className="w-3.5 h-3.5 text-purple-600" /> Toàn trường
                  </span>
                  {targetType === 'all' && (
                    <div className="w-4 h-4 rounded-full bg-purple-600 text-white flex items-center justify-center">
                      <Check className="w-3 h-3" />
                    </div>
                  )}
                </div>
                <p className="text-[10px] font-medium text-slate-500 leading-tight">
                  Tất cả GV & HS toàn trường
                </p>
              </button>

              <button
                type="button"
                onClick={() => handleScopeTypeChange('grade')}
                disabled={isSaving}
                className={`p-3 rounded-2xl border-2 text-left transition-all ${
                  targetType === 'grade'
                    ? 'border-indigo-600 bg-indigo-50/70 shadow-sm'
                    : 'border-slate-200 hover:border-indigo-300 bg-white'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-black text-indigo-950 flex items-center gap-1">
                    <Layers className="w-3.5 h-3.5 text-indigo-600" /> Theo Khối
                  </span>
                  {targetType === 'grade' && (
                    <div className="w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center">
                      <Check className="w-3 h-3" />
                    </div>
                  )}
                </div>
                <p className="text-[10px] font-medium text-slate-500 leading-tight">
                  Toàn bộ học sinh 1 khối
                </p>
              </button>

              <button
                type="button"
                onClick={() => handleScopeTypeChange('classes')}
                disabled={isSaving}
                className={`p-3 rounded-2xl border-2 text-left transition-all ${
                  targetType === 'classes'
                    ? 'border-emerald-600 bg-emerald-50/70 shadow-sm'
                    : 'border-slate-200 hover:border-emerald-300 bg-white'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-black text-emerald-950 flex items-center gap-1">
                    <GraduationCap className="w-3.5 h-3.5 text-emerald-600" /> Theo Lớp
                  </span>
                  {targetType === 'classes' && (
                    <div className="w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center">
                      <Check className="w-3 h-3" />
                    </div>
                  )}
                </div>
                <p className="text-[10px] font-medium text-slate-500 leading-tight">
                  Một hoặc nhiều lớp
                </p>
              </button>

              <button
                type="button"
                onClick={() => handleScopeTypeChange('individual')}
                disabled={isSaving}
                className={`p-3 rounded-2xl border-2 text-left transition-all ${
                  targetType === 'individual'
                    ? 'border-purple-600 bg-purple-50/70 shadow-sm'
                    : 'border-slate-200 hover:border-purple-300 bg-white'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-black text-purple-950 flex items-center gap-1">
                    <User className="w-3.5 h-3.5 text-purple-600" /> Cá nhân HS
                  </span>
                  {targetType === 'individual' && (
                    <div className="w-4 h-4 rounded-full bg-purple-600 text-white flex items-center justify-center">
                      <Check className="w-3 h-3" />
                    </div>
                  )}
                </div>
                <p className="text-[10px] font-medium text-slate-500 leading-tight">
                  Gửi riêng 1 học sinh
                </p>
              </button>
            </div>

            {/* NỘI DUNG TÙY CHỈNH THEO PHẠM VI B: THEO KHỐI */}
            {targetType === 'grade' && (
              <div className="p-4 bg-indigo-50/60 rounded-2xl border border-indigo-200 space-y-2.5 animate-fadeIn">
                <label className="block text-xs font-black text-indigo-950">
                  Chọn khối lớp nhận thông báo:
                </label>
                <div className="flex flex-wrap gap-2">
                  {VALID_GRADE_LEVELS.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => {
                        setTargetGradeLevel(g);
                        setErrorMessage(null);
                      }}
                      disabled={isSaving}
                      className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${
                        targetGradeLevel === g
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'bg-white text-slate-700 hover:bg-indigo-100 border border-indigo-200'
                      }`}
                    >
                      Khối {g}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* NỘI DUNG TÙY CHỈNH THEO PHẠM VI C: THEO LỚP */}
            {targetType === 'classes' && (
              <div className="p-4 bg-emerald-50/40 rounded-2xl border border-emerald-200 space-y-3 animate-fadeIn">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-emerald-950">
                    Danh sách lớp học toàn trường ({validClasses.length} lớp):
                  </span>
                  {validClasses.length > 0 && (
                    <button
                      type="button"
                      onClick={handleSelectAllClasses}
                      disabled={isSaving || !isClassesComplete}
                      className="text-xs font-bold text-emerald-700 hover:text-emerald-900 underline disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {selectedClassIds.length === validClasses.length
                        ? 'Bỏ chọn tất cả'
                        : 'Chọn tất cả'}
                    </button>
                  )}
                </div>

                {!isClassesComplete && (
                  <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900 font-bold flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <span>
                      Dữ liệu danh sách lớp chưa được tải đầy đủ hoặc có lỗi kết nối. Để đảm bảo an toàn tuyệt đối (Fail-Closed), không thể chọn tất cả lớp hoặc lưu thông báo theo lớp lúc này.
                    </span>
                  </div>
                )}

                {validClasses.length === 0 ? (
                  <p className="text-xs font-bold text-slate-400 py-3 text-center">
                    Không tìm thấy danh sách lớp học hoặc hệ thống chưa có lớp nào.
                  </p>
                ) : (
                  <div className="space-y-3 max-h-48 overflow-y-auto pr-1">
                    {VALID_GRADE_LEVELS.map((g) => {
                      const gradeClasses = classesByGrade.get(g) || [];
                      if (gradeClasses.length === 0) return null;
                      return (
                        <div key={g} className="space-y-1.5">
                          <div className="flex items-center justify-between text-[11px] font-black text-slate-500 uppercase px-1">
                            <span>Khối {g}</span>
                            <button
                              type="button"
                              onClick={() => handleToggleGradeClasses(g)}
                              disabled={isSaving}
                              className="text-[10px] font-bold text-indigo-600 hover:underline lowercase"
                            >
                              chọn khối {g}
                            </button>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                            {gradeClasses.map((c) => {
                              const isChecked = selectedClassIds.includes(c.id);
                              return (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() => handleToggleClass(c.id)}
                                  disabled={isSaving}
                                  className={`px-3 py-2 rounded-xl text-xs font-bold text-left transition-all border flex items-center justify-between gap-1 ${
                                    isChecked
                                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                                      : 'bg-white text-slate-700 hover:bg-emerald-50 border-slate-200'
                                  }`}
                                >
                                  <span className="truncate">{formatClassLabel(c.name)}</span>
                                  {isChecked && <Check className="w-3.5 h-3.5 shrink-0" />}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* NỘI DUNG TÙY CHỈNH THEO PHẠM VI D: CÁ NHÂN HỌC SINH */}
            {targetType === 'individual' && (
              <div className="p-4 bg-purple-50/50 rounded-2xl border border-purple-200 space-y-3 animate-fadeIn">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-purple-950">
                    Chọn học sinh nhận thông báo:
                  </span>
                  <span className="text-[11px] font-bold text-slate-400">
                    Phạm vi: Toàn trường
                  </span>
                </div>

                {selectedStudent ? (
                  /* ĐÃ CHỌN HỌC SINH */
                  <div className="p-3 bg-white border-2 border-purple-400 rounded-xl flex items-center justify-between gap-3 shadow-sm">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-900 border border-purple-300 flex items-center justify-center font-black text-base shrink-0">
                        👨‍🎓
                      </div>
                      <div className="truncate">
                        <p className="text-xs font-black text-slate-900 truncate">
                          {selectedStudent.full_name || selectedStudent.username}
                        </p>
                        <p className="text-[11px] font-bold text-slate-500 truncate">
                          Mã HS: <span className="text-purple-950 font-black">{selectedStudent.student_code || '---'}</span>
                          {selectedStudent.class_name && (
                            <> • Lớp: <span className="text-purple-950 font-black">{formatClassLabel(selectedStudent.class_name)}</span></>
                          )}
                          {selectedStudent.grade_level && (
                            <> (Khối {selectedStudent.grade_level})</>
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
                  /* CHƯA CHỌN: BỘ LỌC VÀ TÌM KIẾM HỌC SINH */
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {/* Lọc Khối */}
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          Lọc theo Khối:
                        </label>
                        <select
                          value={studentFilterGrade}
                          onChange={(e) => {
                            setStudentFilterGrade(e.target.value);
                            setStudentFilterClassId('');
                          }}
                          disabled={isSaving}
                          className="w-full px-2.5 py-2 bg-white border-2 border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-purple-500"
                        >
                          <option value="">Tất cả các khối</option>
                          {VALID_GRADE_LEVELS.map((g) => (
                            <option key={g} value={g}>
                              Khối {g}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Lọc Lớp */}
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          Lọc theo Lớp:
                        </label>
                        <select
                          value={studentFilterClassId}
                          onChange={(e) => setStudentFilterClassId(e.target.value)}
                          disabled={isSaving}
                          className="w-full px-2.5 py-2 bg-white border-2 border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-purple-500"
                        >
                          <option value="">Tất cả các lớp</option>
                          {validClasses
                            .filter((c) => !studentFilterGrade || Number(c.grade_level) === Number(studentFilterGrade))
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {formatClassLabel(c.name)} {c.grade_level ? `(K${c.grade_level})` : ''}
                              </option>
                            ))}
                        </select>
                      </div>

                      {/* Ô nhập tìm kiếm */}
                      <div>
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
                            placeholder="Tên hoặc mã HS..."
                            className="w-full pl-8 pr-3 py-2 bg-white border-2 border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-purple-500 placeholder:text-slate-400"
                          />
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                        </div>
                      </div>
                    </div>

                    {/* Trạng thái tìm kiếm & Kết quả */}
                    {isSearchingStudents ? (
                      <div className="p-3 bg-white rounded-xl border border-slate-200 text-center text-xs text-slate-500 font-bold flex items-center justify-center gap-2">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-purple-600" />
                        <span>Đang tìm kiếm học sinh trong toàn trường...</span>
                      </div>
                    ) : searchResults.length > 0 ? (
                      <div className="space-y-1.5 max-h-44 overflow-y-auto p-1 bg-white border border-slate-200 rounded-xl">
                        {searchResults.map((stu) => (
                          <div
                            key={stu.id}
                            className="p-2 rounded-lg hover:bg-purple-50 border border-transparent hover:border-purple-200 flex items-center justify-between gap-2 transition-all"
                          >
                            <div className="truncate">
                              <span className="text-xs font-black text-slate-900 block truncate">
                                {stu.full_name || stu.username}
                              </span>
                              <span className="text-[10px] font-bold text-slate-500">
                                Mã: {stu.student_code || '---'} • Lớp: {formatClassLabel(stu.class_name)} {stu.grade_level ? `(Khối ${stu.grade_level})` : ''}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleSelectStudent(stu)}
                              disabled={isSaving}
                              className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white text-[11px] font-black rounded-lg transition-all shrink-0 shadow-xs"
                            >
                              Chọn
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      (studentSearchQuery.trim() || studentFilterGrade || studentFilterClassId) && (
                        <p className="text-[11px] font-bold text-slate-500 p-2 text-center bg-white rounded-xl border border-slate-200">
                          Không tìm thấy học sinh nào phù hợp với bộ lọc và từ khóa tìm kiếm.
                        </p>
                      )
                    )}

                    {!selectedStudent && !studentSearchQuery.trim() && !studentFilterGrade && !studentFilterClassId && (
                      <p className="text-[11px] font-bold text-slate-500 text-center py-1">
                        * Nhập tên hoặc mã học sinh vào ô trên (hoặc chọn Khối/Lớp) để tìm và chọn đúng một học sinh nhận tin.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* TÓM TẮT PHẠM VI MỤC TIÊU TRƯỚC KHI LƯU */}
          <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-xs flex items-center gap-2">
            <Info className="w-4 h-4 text-purple-600 shrink-0" />
            <div className="truncate">
              <span className="font-bold text-slate-600">Phạm vi mục tiêu: </span>
              {renderTargetScopeSummary()}
            </div>
          </div>
        </form>

        {/* FOOTER MODAL - CHỈ CÓ NÚT HỦY VÀ LƯU BẢN NHÁP (KHÔNG CÓ GỬI NGAY HAY XUẤT BẢN) */}
        <div className="p-5 border-t border-purple-100 flex items-center justify-between bg-slate-50">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-600 hover:bg-white text-xs font-bold transition-all disabled:opacity-50"
          >
            Hủy
          </button>

          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={isSaving || !title.trim() || !content.trim()}
            className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 active:scale-95 text-white text-xs font-black rounded-xl shadow-md transition-all flex items-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
          >
            {isSaving ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Đang lưu bản nháp...</span>
              </>
            ) : (
              <>
                <FileText className="w-3.5 h-3.5" />
                <span>Lưu bản nháp</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
