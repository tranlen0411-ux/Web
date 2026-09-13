// src/components/dashboard/exams/ExamManagementTab.jsx
// Bảng Quản Lý Đề Kiểm Tra Exam Builder V1 (Dành Cho Admin & Giáo Viên)

import React, { useState, useEffect } from 'react';
import {
  GraduationCap,
  Plus,
  Search,
  Filter,
  RefreshCw,
  Clock,
  Calendar,
  Layers,
  Send,
  Edit2,
  AlertCircle,
  CheckCircle2,
  Lock,
  Globe,
  User,
  Info,
  ShieldCheck,
  Eye,
  FileText,
  Trash2,
  AlertTriangle,
  Loader2,
  Archive,
  X
} from 'lucide-react';
import { createExamManagementClient } from '../../../services/examManagementClient.js';
import { ExamEditorModal } from './ExamEditorModal.jsx';
import { AssignExamModal } from './AssignExamModal.jsx';
import { ExamResultsModal } from './ExamResultsModal.jsx';
import { useSound } from '../../../context/SoundContext.jsx';

export const ExamManagementTab = ({
  role = 'teacher',
  classes = [],
  globalClassFilter = 'ALL',
}) => {
  const { triggerSound } = useSound();

  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [toastMsg, setToastMsg] = useState('');

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('ALL');
  const [selectedGrade, setSelectedGrade] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');

  // Modals state
  const [isEditorModalOpen, setIsEditorModalOpen] = useState(false);
  const [examToEdit, setExamToEdit] = useState(null);

  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [examToAssign, setExamToAssign] = useState(null);

  const [isResultsModalOpen, setIsResultsModalOpen] = useState(false);
  const [examForResults, setExamForResults] = useState(null);

  // Safe Delete Modal state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [examToDelete, setExamToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const showToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 4000);
  };

  useEffect(() => {
    fetchTests();
  }, [role, selectedStatus]);

  const fetchTests = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const client = createExamManagementClient();
      const res = await client.listTests({
        status: selectedStatus === 'archived' ? 'archived' : undefined,
        includeArchived: selectedStatus === 'archived',
      });
      if (res.ok && res.data && Array.isArray(res.data.tests)) {
        setTests(res.data.tests);
      } else {
        setErrorMsg(res.error?.message || 'Không thể tải danh sách đề thi.');
      }
    } catch (err) {
      setErrorMsg(err?.message || 'Lỗi hệ thống khi tải danh sách đề thi.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenCreateModal = () => {
    triggerSound('click');
    setExamToEdit(null);
    setIsEditorModalOpen(true);
  };

  const handleOpenEditModal = (exam) => {
    const isPublished = exam?.active_version?.status === 'published';
    if (isPublished) {
      showToast('ℹ️ Đề thi đã xuất bản ở trạng thái bất biến, không thể chỉnh sửa trực tiếp.');
      return;
    }
    triggerSound('click');
    setExamToEdit(exam);
    setIsEditorModalOpen(true);
  };

  const handleOpenAssignModal = (exam) => {
    triggerSound('click');
    const isPublished = exam.active_version?.status === 'published';
    if (!isPublished) {
      showToast('⚠️ Đề thi này chưa được xuất bản. Vui lòng xuất bản trước khi giao cho lớp.');
      return;
    }
    setExamToAssign(exam);
    setIsAssignModalOpen(true);
  };

  const handleOpenResultsModal = (exam) => {
    triggerSound('click');
    setExamForResults(exam);
    setIsResultsModalOpen(true);
  };

  const handleOpenDeleteModal = (exam) => {
    triggerSound('click');
    setExamToDelete(exam);
    setDeleteError('');
    setIsDeleteModalOpen(true);
  };

  const handleCloseDeleteModal = () => {
    if (isDeleting) return;
    setIsDeleteModalOpen(false);
    setExamToDelete(null);
    setDeleteError('');
  };

  const handleConfirmDelete = async () => {
    if (!examToDelete || isDeleting) return;
    setIsDeleting(true);
    setDeleteError('');
    try {
      const client = createExamManagementClient();
      const res = await client.deleteTest({ examId: examToDelete.id });
      if (res.ok) {
        triggerSound('success');
        const action = res.data?.action;
        if (action === 'deleted') {
          showToast('🗑️ Đã xóa vĩnh viễn đề thi nháp thành công.');
        } else if (action === 'archived') {
          showToast('📦 Đã lưu trữ đề thi an toàn; toàn bộ lịch sử và kết quả học sinh được bảo toàn.');
        } else {
          showToast('ℹ️ ' + (res.data?.message || 'Đề thi đã được xử lý an toàn.'));
        }
        setIsDeleteModalOpen(false);
        setExamToDelete(null);
        await fetchTests();
      } else {
        triggerSound('error');
        setDeleteError(res.error?.message || 'Không thể xóa hoặc lưu trữ đề thi.');
      }
    } catch (err) {
      triggerSound('error');
      setDeleteError(err?.message || 'Lỗi hệ thống khi xóa đề thi.');
    } finally {
      setIsDeleting(false);
    }
  };

  const formatScheduleDateTime = (isoStr) => {
    if (!isoStr) return null;
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return null;
      return d.toLocaleString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch (_) {
      return null;
    }
  };

  const filteredTests = tests.filter((t) => {
    const effectiveTitle = t.active_version?.title || t.title || '';
    const effectiveSubject = t.active_version?.subject || t.subject || '';
    const effectiveGrade = t.active_version?.grade_level || t.grade_level;

    const matchesSearch =
      effectiveTitle.toLowerCase().includes(searchTerm.toLowerCase()) ||
      effectiveSubject.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (t.author_name && t.author_name.toLowerCase().includes(searchTerm.toLowerCase()));

    if (!matchesSearch) return false;

    if (selectedSubject !== 'ALL' && effectiveSubject !== selectedSubject) {
      return false;
    }

    if (selectedGrade !== 'ALL' && String(effectiveGrade) !== String(selectedGrade)) {
      return false;
    }

    if (selectedStatus === 'archived') {
      if (t.status !== 'archived') return false;
    } else if (selectedStatus !== 'ALL') {
      const vStatus = t.active_version?.status || t.status;
      if (selectedStatus === 'published' && vStatus !== 'published') return false;
      if (selectedStatus === 'draft' && vStatus !== 'draft') return false;
    }

    return true;
  });

  return (
    <div className="space-y-6">
      {/* TOAST FEEDBACK NOTIFICATION */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-[10000] p-4 bg-emerald-600 text-white font-black text-xs rounded-2xl shadow-2xl animate-bounce flex items-center gap-2">
          <span>{toastMsg}</span>
        </div>
      )}

      {/* HEADER BANNER */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-gradient-to-r from-indigo-900 via-indigo-800 to-indigo-950 p-6 rounded-3xl border-4 border-indigo-400 text-white shadow-xl">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-3 py-1 bg-indigo-500/40 text-indigo-200 text-xs font-black rounded-xl uppercase flex items-center gap-1 border border-indigo-300/30">
              <GraduationCap className="w-3.5 h-3.5" /> Exam Builder V1
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black">Hệ Thống Quản Lý Đề Kiểm Tra</h2>
          <p className="text-xs sm:text-sm font-bold text-indigo-200 mt-1">
            {role === 'admin'
              ? 'Quản lý toàn bộ ngân hàng đề thi của trường, xuất bản và phân công lịch thi linh hoạt.'
              : 'Soạn đề kiểm tra định kỳ, thiết lập thời gian mở đề, hạn chót vào làm và giao cho các lớp trực tiếp giảng dạy.'}
          </p>
        </div>

        <button
          onClick={handleOpenCreateModal}
          className="px-5 py-3 bg-amber-400 hover:bg-amber-300 text-amber-950 font-black text-xs sm:text-sm rounded-2xl border-b-4 border-amber-600 shadow-lg flex items-center gap-2 active:translate-y-0.5 transition-all shrink-0"
        >
          <Plus className="w-4 h-4" /> + Soạn Đề Thi Mới
        </button>
      </div>

      {/* ERROR BANNER */}
      {errorMsg && (
        <div className="p-4 bg-rose-50 border-2 border-rose-200 text-rose-800 rounded-2xl text-xs font-bold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            onClick={fetchTests}
            className="px-3 py-1 bg-rose-600 text-white font-black text-xs rounded-lg hover:bg-rose-700 transition-all"
          >
            Thử Lại
          </button>
        </div>
      )}

      {/* FILTER & SEARCH CONTROLS */}
      <div className="bg-white p-4 rounded-3xl border-2 border-slate-200 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row items-center gap-3">
          {/* SEARCH INPUT */}
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Tìm kiếm theo tên đề thi, môn học hoặc tác giả..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* FILTER SUBJECT */}
          <select
            value={selectedSubject}
            onChange={(e) => setSelectedSubject(e.target.value)}
            className="w-full sm:w-40 p-2.5 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-xs text-slate-700"
          >
            <option value="ALL">Tất cả môn học</option>
            <option value="Toán">Toán</option>
            <option value="Tiếng Việt">Tiếng Việt</option>
            <option value="Tiếng Anh">Tiếng Anh</option>
            <option value="Tự nhiên & Xã hội">Tự nhiên & Xã hội</option>
            <option value="Khoa học">Khoa học</option>
            <option value="Lịch sử & Địa lý">Lịch sử & Địa lý</option>
            <option value="Tin học">Tin học</option>
            <option value="Đạo đức">Đạo đức</option>
          </select>

          {/* FILTER GRADE */}
          <select
            value={selectedGrade}
            onChange={(e) => setSelectedGrade(e.target.value)}
            className="w-full sm:w-36 p-2.5 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-xs text-slate-700"
          >
            <option value="ALL">Tất cả khối</option>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((g) => (
              <option key={g} value={g}>
                Khối {g}
              </option>
            ))}
          </select>

          {/* FILTER STATUS */}
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="w-full sm:w-44 p-2.5 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-xs text-slate-700"
          >
            <option value="ALL">Tất cả đề đang hoạt động</option>
            <option value="published">Đã xuất bản</option>
            <option value="draft">Bản nháp</option>
            <option value="archived">📦 Đã lưu trữ (Archived)</option>
          </select>

          {/* REFRESH BUTTON */}
          <button
            onClick={fetchTests}
            disabled={loading}
            className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl transition-all shrink-0"
            title="Tải lại danh sách"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* EXAM LIST TABLE */}
      <div className="bg-white rounded-3xl border-4 border-slate-200 overflow-hidden shadow-sm">
        {loading ? (
          <div className="text-center py-16">
            <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mx-auto mb-2" />
            <p className="text-xs font-bold text-slate-400">Đang tải danh sách đề thi...</p>
          </div>
        ) : filteredTests.length === 0 ? (
          <div className="text-center py-16 p-6">
            <GraduationCap className="w-12 h-12 text-slate-300 mx-auto mb-2" />
            <h4 className="text-sm font-black text-slate-700">Chưa có đề thi nào trong danh sách</h4>
            <p className="text-xs font-bold text-slate-400 mt-1 mb-4">
              {role === 'admin'
                ? 'Hệ thống chưa có đề thi nào phù hợp với bộ lọc.'
                : 'Thầy/Cô chưa có đề thi nào phù hợp với bộ lọc hiện tại.'}
            </p>
            {selectedStatus !== 'archived' && (
              <button
                onClick={handleOpenCreateModal}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-2xl shadow-md transition-all inline-flex items-center gap-2"
              >
                <Plus className="w-4 h-4" /> Soạn Đề Thi Mới
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-bold whitespace-nowrap min-w-[920px]">
              <thead className="bg-slate-100 text-slate-700 uppercase border-b-2 border-slate-200 text-[11px]">
                <tr>
                  <th className="p-4">Tên Đề Thi</th>
                  <th className="p-4">Môn Học & Khối</th>
                  {role === 'admin' && <th className="p-4">Người Tạo</th>}
                  <th className="p-4">Trạng Thái</th>
                  <th className="p-4">Thời Lượng</th>
                  <th className="p-4">Lịch Thi Linh Hoạt</th>
                  <th className="p-4 text-center min-w-[280px]">Thao Tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {filteredTests.map((t) => {
                  const activeV = t.active_version;
                  const isArchived = t.status === 'archived';
                  const isPublished = activeV?.status === 'published';
                  const startsAtFormatted = formatScheduleDateTime(activeV?.starts_at);
                  const lastStartAtFormatted = formatScheduleDateTime(activeV?.last_start_at);
                  const dueDateFormatted = formatScheduleDateTime(activeV?.due_date);

                  return (
                    <tr key={t.id} className="hover:bg-indigo-50/30 transition-colors">
                      {/* TÊN ĐỀ THI */}
                      <td className="p-4 max-w-xs">
                        <div className="font-black text-slate-900 text-sm">{activeV?.title || t.title}</div>
                        {activeV?.total_points !== undefined && (
                          <span className="text-[11px] font-bold text-slate-400">
                            Thang điểm: {Number(activeV.total_points).toFixed(2)} đ
                          </span>
                        )}
                      </td>

                      {/* MÔN HỌC & KHỐI */}
                      <td className="p-4">
                        <div className="flex items-center gap-1.5">
                          <span className="px-2 py-0.5 bg-indigo-50 text-indigo-800 rounded-lg text-xs font-black border border-indigo-200">
                            {activeV?.subject || t.subject}
                          </span>
                          <span className="px-2 py-0.5 bg-amber-50 text-amber-800 rounded-lg text-xs font-black border border-amber-200">
                            Khối {activeV?.grade_level || t.grade_level}
                          </span>
                        </div>
                      </td>

                      {/* NGƯỜI TẠO (ADMIN XEM) */}
                      {role === 'admin' && (
                        <td className="p-4">
                          <div className="flex items-center gap-1.5 text-xs text-slate-700">
                            <User className="w-3.5 h-3.5 text-slate-400" />
                            <span>{t.author_name || 'Giáo viên'}</span>
                          </div>
                        </td>
                      )}

                      {/* TRẠNG THÁI */}
                      <td className="p-4">
                        {isArchived ? (
                          <span className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-xl text-[11px] font-black border border-slate-300 flex items-center gap-1 w-fit">
                            <Archive className="w-3 h-3 text-slate-500" />
                            Đã Lưu Trữ
                          </span>
                        ) : isPublished ? (
                          <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-xl text-[11px] font-black border border-emerald-300 flex items-center gap-1 w-fit">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            Đã Xuất Bản (v{activeV?.version_number || 1})
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 bg-amber-100 text-amber-900 rounded-xl text-[11px] font-black border border-amber-300 flex items-center gap-1 w-fit">
                            <Clock className="w-3 h-3 text-amber-600" />
                            Bản Nháp (v{activeV?.version_number || 1})
                          </span>
                        )}
                      </td>

                      {/* THỜI LƯỢNG */}
                      <td className="p-4">
                        {activeV?.duration_minutes ? (
                          <span className="font-extrabold text-slate-700 flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            {activeV.duration_minutes} phút
                          </span>
                        ) : (
                          <span className="text-slate-400">Không giới hạn</span>
                        )}
                      </td>

                      {/* LỊCH THI LINH HOẠT */}
                      <td className="p-4 text-[11px] space-y-0.5 max-w-xs">
                        {startsAtFormatted && (
                          <div className="text-slate-600">
                            <span className="font-bold text-slate-400">Mở đề:</span> {startsAtFormatted}
                          </div>
                        )}
                        {lastStartAtFormatted && (
                          <div className="text-amber-700 font-bold">
                            <span className="text-slate-400">Hạn vào thi:</span> {lastStartAtFormatted}
                          </div>
                        )}
                        {dueDateFormatted && (
                          <div className="text-rose-700 font-bold">
                            <span className="text-slate-400">Hạn nộp cưỡng chế:</span> {dueDateFormatted}
                          </div>
                        )}
                        {!startsAtFormatted && !lastStartAtFormatted && !dueDateFormatted && (
                          <span className="text-slate-400 font-normal">Chưa đặt lịch cố định</span>
                        )}
                      </td>

                      {/* THAO TÁC */}
                      <td className="p-4 text-center min-w-[280px]">
                        <div className="flex items-center justify-center flex-wrap gap-1.5 sm:gap-2 max-w-[340px] mx-auto">
                          {isArchived ? (
                            <>
                              <span className="px-2.5 py-1 text-[11px] font-bold text-slate-400 italic">
                                (Đã lưu trữ)
                              </span>
                              <button
                                onClick={() => handleOpenResultsModal(t)}
                                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black inline-flex items-center gap-1.5 shadow-sm active:translate-y-0.5 transition-all shrink-0 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1"
                                title="Xem danh sách kết quả bài làm học sinh của đề thi đã lưu trữ"
                              >
                                <FileText className="w-3.5 h-3.5" /> Xem Kết Quả
                              </button>
                            </>
                          ) : isPublished ? (
                            <>
                              <button
                                disabled
                                className="px-3 py-1.5 bg-slate-100 text-slate-400 rounded-xl text-xs font-black inline-flex items-center gap-1.5 border border-slate-200 cursor-not-allowed shrink-0 select-none"
                                title="Đề thi đã xuất bản ở trạng thái cố định, không thể chỉnh sửa trực tiếp"
                              >
                                <Lock className="w-3.5 h-3.5 text-slate-400" /> Đã Xuất Bản
                              </button>

                              <button
                                onClick={() => handleOpenResultsModal(t)}
                                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black inline-flex items-center gap-1.5 shadow-sm active:translate-y-0.5 transition-all shrink-0 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1"
                                title="Xem danh sách kết quả bài làm và chấm bài tự luận"
                              >
                                <FileText className="w-3.5 h-3.5" /> Xem Kết Quả
                              </button>

                              <button
                                onClick={() => handleOpenAssignModal(t)}
                                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black inline-flex items-center gap-1.5 transition-all shadow-sm active:translate-y-0.5 shrink-0 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
                                title="Giao đề thi cho lớp học"
                              >
                                <Send className="w-3.5 h-3.5" /> Giao Cho Lớp
                              </button>

                              <button
                                onClick={() => handleOpenDeleteModal(t)}
                                className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 hover:text-rose-800 rounded-xl text-xs font-black inline-flex items-center gap-1.5 transition-all border border-rose-200 focus:outline-none focus:ring-2 focus:ring-rose-400 focus:ring-offset-1 shrink-0"
                                title="Lưu trữ (ẩn) đề thi này sau khi kỳ thi kết thúc"
                              >
                                <Trash2 className="w-3.5 h-3.5 text-rose-600" /> Xóa
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => handleOpenEditModal(t)}
                                className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black inline-flex items-center gap-1.5 transition-all shrink-0 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
                                title="Chỉnh sửa bản nháp đề thi"
                              >
                                <Edit2 className="w-3.5 h-3.5" /> Chỉnh Sửa
                              </button>

                              <button
                                disabled
                                className="px-3.5 py-1.5 rounded-xl text-xs font-black inline-flex items-center gap-1.5 transition-all shadow-sm shrink-0 bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
                                title="Xuất bản đề thi trước khi giao"
                              >
                                <Send className="w-3.5 h-3.5" /> Giao Cho Lớp
                              </button>

                              <button
                                onClick={() => handleOpenDeleteModal(t)}
                                className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 hover:text-rose-800 rounded-xl text-xs font-black inline-flex items-center gap-1.5 transition-all border border-rose-200 focus:outline-none focus:ring-2 focus:ring-rose-400 focus:ring-offset-1 shrink-0"
                                title="Xóa vĩnh viễn bản nháp đề thi"
                              >
                                <Trash2 className="w-3.5 h-3.5 text-rose-600" /> Xóa
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL SOẠN ĐỀ THI */}
      {isEditorModalOpen && (
        <ExamEditorModal
          isOpen={isEditorModalOpen}
          onClose={(msg) => {
            setIsEditorModalOpen(false);
            setExamToEdit(null);
            if (msg) showToast(msg);
          }}
          examToEdit={examToEdit}
          role={role}
          onSaved={() => fetchTests()}
        />
      )}

      {/* MODAL GIAO ĐỀ THI */}
      {isAssignModalOpen && examToAssign && (
        <AssignExamModal
          isOpen={isAssignModalOpen}
          onClose={(msg) => {
            setIsAssignModalOpen(false);
            setExamToAssign(null);
            if (msg) showToast(msg);
          }}
          exam={examToAssign}
          classes={classes}
          role={role}
          onAssigned={() => fetchTests()}
        />
      )}

      {/* MODAL XEM KẾT QUẢ & CHẤM BÀI */}
      {isResultsModalOpen && examForResults && (
        <ExamResultsModal
          isOpen={isResultsModalOpen}
          onClose={(msg) => {
            setIsResultsModalOpen(false);
            setExamForResults(null);
            if (msg) showToast(msg);
          }}
          exam={examForResults}
          classes={classes}
          role={role}
        />
      )}

      {/* MODAL XÁC NHẬN XÓA / LƯU TRỮ AN TOÀN */}
      {isDeleteModalOpen && examToDelete && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-3xl border-4 border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden animate-scaleIn">
            {/* MODAL HEADER */}
            <div className="p-5 flex items-center justify-between border-b bg-rose-50/80 border-rose-100 text-rose-900">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-rose-600 text-white shadow-md shadow-rose-200">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black">
                    Xác Nhận Xóa / Lưu Trữ Đề Thi
                  </h3>
                  <p className="text-xs font-bold opacity-75">
                    Hệ thống tự động áp dụng quy tắc bảo toàn dữ liệu
                  </p>
                </div>
              </div>
              <button
                onClick={handleCloseDeleteModal}
                disabled={isDeleting}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-all disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* MODAL BODY */}
            <div className="p-6 space-y-4">
              {/* TÊN ĐỀ THI & THÔNG TIN */}
              <div className="p-4 bg-slate-50 rounded-2xl border-2 border-slate-100 space-y-2">
                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Đề kiểm tra được chọn
                </div>
                <div className="text-sm font-black text-slate-900">
                  {examToDelete.active_version?.title || examToDelete.title || 'Chưa đặt tiêu đề'}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-black border border-indigo-100">
                    {examToDelete.active_version?.subject || examToDelete.subject}
                  </span>
                  <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded-lg text-xs font-black border border-amber-100">
                    Khối {examToDelete.active_version?.grade_level || examToDelete.grade_level}
                  </span>
                  {examToDelete.active_version?.status === 'published' ? (
                    <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-black border border-emerald-200 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Đã Xuất Bản
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 bg-slate-200 text-slate-700 rounded-lg text-xs font-black">
                      Bản Nháp
                    </span>
                  )}
                </div>
              </div>

              {/* QUY TẮC XỬ LÝ AN TOÀN */}
              <div className="p-4 bg-slate-50 rounded-2xl border-2 border-slate-200 text-slate-700 text-xs space-y-2.5">
                <div className="flex items-center gap-2 font-black text-slate-800 text-[13px]">
                  <Info className="w-4 h-4 shrink-0 text-indigo-600" />
                  <span>Quy tắc bảo vệ dữ liệu tự động:</span>
                </div>
                <ul className="space-y-2 text-[12px] font-semibold text-slate-600 pl-1 leading-relaxed">
                  <li className="flex items-start gap-2">
                    <span className="text-rose-600 font-bold shrink-0">🗑️ Bản nháp sạch:</span>
                    <span>Đề chưa từng xuất bản, chưa giao lớp và chưa có bài làm sẽ được <strong>xóa vĩnh viễn</strong>.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-amber-600 font-bold shrink-0">📦 Đề đã sử dụng:</span>
                    <span>Đề đã xuất bản hoặc đã giao sẽ được <strong>chuyển sang Lưu trữ (Archived)</strong> sau khi kỳ thi kết thúc. Toàn bộ bài làm, điểm số học sinh được <strong>bảo toàn 100%</strong>.</span>
                  </li>
                  <li className="flex items-start gap-2 text-rose-700">
                    <span className="font-bold shrink-0">⚠️ Đang diễn ra:</span>
                    <span>Nếu đề thi đang trong thời gian mở hoặc có học sinh đang làm bài dở dang, hệ thống sẽ <strong>từ chối thao tác</strong> để bảo vệ bài thi học sinh.</span>
                  </li>
                </ul>
              </div>

              {/* THÔNG BÁO LỖI NẾU CÓ */}
              {deleteError && (
                <div className="p-3.5 bg-rose-100 border border-rose-300 text-rose-800 rounded-xl text-xs font-bold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{deleteError}</span>
                </div>
              )}
            </div>

            {/* MODAL FOOTER */}
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={handleCloseDeleteModal}
                disabled={isDeleting}
                className="px-4 py-2.5 bg-white hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-xl border border-slate-200 transition-all disabled:opacity-50"
              >
                Hủy Bỏ
              </button>

              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-5 py-2.5 font-black text-xs rounded-xl text-white shadow-md flex items-center gap-2 transition-all active:translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed bg-rose-600 hover:bg-rose-700 border-b-2 border-rose-800"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Đang xử lý...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    <span>Xác Nhận Xóa / Lưu Trữ</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

