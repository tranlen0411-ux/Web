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
  FileText
} from 'lucide-react';
import { createExamManagementClient } from '../../../services/examManagementClient.js';
import { ExamEditorModal } from './ExamEditorModal.jsx';
import { AssignExamModal } from './AssignExamModal.jsx';
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

  const showToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 4000);
  };

  useEffect(() => {
    fetchTests();
  }, [role]);

  const fetchTests = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const client = createExamManagementClient();
      const res = await client.listTests();
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
    const matchesSearch =
      t.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (t.author_name && t.author_name.toLowerCase().includes(searchTerm.toLowerCase()));

    if (!matchesSearch) return false;

    if (selectedSubject !== 'ALL' && t.subject !== selectedSubject) {
      return false;
    }

    if (selectedGrade !== 'ALL' && String(t.grade_level) !== String(selectedGrade)) {
      return false;
    }

    if (selectedStatus !== 'ALL') {
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
            className="w-full sm:w-36 p-2.5 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-xs text-slate-700"
          >
            <option value="ALL">Tất cả trạng thái</option>
            <option value="published">Đã xuất bản</option>
            <option value="draft">Bản nháp</option>
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
                ? 'Hệ thống chưa có đề thi nào được tạo.'
                : 'Thầy/Cô chưa tạo đề thi nào. Bấm vào nút bên dưới để bắt đầu soạn đề nhé!'}
            </p>
            <button
              onClick={handleOpenCreateModal}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-2xl shadow-md transition-all inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> Soạn Đề Thi Mới
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-bold whitespace-nowrap">
              <thead className="bg-slate-100 text-slate-700 uppercase border-b-2 border-slate-200 text-[11px]">
                <tr>
                  <th className="p-4">Tên Đề Thi</th>
                  <th className="p-4">Môn Học & Khối</th>
                  {role === 'admin' && <th className="p-4">Người Tạo</th>}
                  <th className="p-4">Trạng Thái</th>
                  <th className="p-4">Thời Lượng</th>
                  <th className="p-4">Lịch Thi Linh Hoạt</th>
                  <th className="p-4 text-center">Thao Tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {filteredTests.map((t) => {
                  const activeV = t.active_version;
                  const isPublished = activeV?.status === 'published';
                  const startsAtFormatted = formatScheduleDateTime(activeV?.starts_at);
                  const lastStartAtFormatted = formatScheduleDateTime(activeV?.last_start_at);
                  const dueDateFormatted = formatScheduleDateTime(activeV?.due_date);

                  return (
                    <tr key={t.id} className="hover:bg-indigo-50/30 transition-colors">
                      {/* TÊN ĐỀ THI */}
                      <td className="p-4 max-w-xs">
                        <div className="font-black text-slate-900 text-sm">{t.title}</div>
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
                            {t.subject}
                          </span>
                          <span className="px-2 py-0.5 bg-amber-50 text-amber-800 rounded-lg text-xs font-black border border-amber-200">
                            Khối {t.grade_level}
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
                        {isPublished ? (
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
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {isPublished ? (
                            <button
                              disabled
                              className="px-3 py-1.5 bg-slate-100 text-slate-400 rounded-xl text-xs font-black flex items-center gap-1.5 border border-slate-200 cursor-not-allowed"
                              title="Đề thi đã xuất bản ở trạng thái cố định, không thể chỉnh sửa trực tiếp"
                            >
                              <Lock className="w-3.5 h-3.5 text-slate-400" /> Đã Xuất Bản
                            </button>
                          ) : (
                            <button
                              onClick={() => handleOpenEditModal(t)}
                              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all"
                              title="Chỉnh sửa bản nháp đề thi"
                            >
                              <Edit2 className="w-3.5 h-3.5" /> Chỉnh Sửa
                            </button>
                          )}

                          <button
                            onClick={() => handleOpenAssignModal(t)}
                            disabled={!isPublished}
                            className={`px-3.5 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all shadow-sm ${
                              isPublished
                                ? 'bg-indigo-600 hover:bg-indigo-700 text-white active:translate-y-0.5'
                                : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                            }`}
                            title={isPublished ? 'Giao đề thi cho lớp học' : 'Xuất bản đề thi trước khi giao'}
                          >
                            <Send className="w-3.5 h-3.5" /> Giao Cho Lớp
                          </button>
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
    </div>
  );
};
