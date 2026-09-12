// src/components/dashboard/exams/ExamResultsModal.jsx
// Modal Bảng Kết Quả & Danh Sách Lượt Làm Bài Thi Dành Cho Giáo Viên / Admin (Phase B2)

import React, { useState, useEffect } from 'react';
import {
  X,
  Search,
  Filter,
  RefreshCw,
  GraduationCap,
  FileText,
  User,
  Clock,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Award,
  Eye,
  Edit3,
  Layers,
  ChevronRight,
} from 'lucide-react';
import { createExamManagementClient } from '../../../services/examManagementClient.js';
import { ExamGradingModal } from './ExamGradingModal.jsx';
import { useSound } from '../../../context/SoundContext.jsx';

export const ExamResultsModal = ({
  isOpen,
  onClose,
  exam,
  role = 'teacher',
  classes = [],
}) => {
  const { triggerSound } = useSound();

  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [toastMsg, setToastMsg] = useState('');

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');

  // Modal chấm điểm / xem chi tiết 1 attempt
  const [selectedAttemptId, setSelectedAttemptId] = useState(null);
  const [isGradingModalOpen, setIsGradingModalOpen] = useState(false);

  const showToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 4000);
  };

  useEffect(() => {
    if (isOpen && exam) {
      fetchAttempts();
    }
  }, [isOpen, exam?.id]);

  const fetchAttempts = async () => {
    if (!exam) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const client = createExamManagementClient();
      const res = await client.listExamAttempts({
        examId: exam.id,
        versionId: exam.active_version?.id || exam.current_version_id,
      });

      if (res.ok && res.data && Array.isArray(res.data.attempts)) {
        setAttempts(res.data.attempts);
      } else {
        setErrorMsg(res.error?.message || 'Không thể tải danh sách kết quả bài làm.');
      }
    } catch (err) {
      setErrorMsg(err?.message || 'Lỗi hệ thống khi tải kết quả bài thi.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenGradingModal = (attempt) => {
    triggerSound?.('click');
    setSelectedAttemptId(attempt.id);
    setIsGradingModalOpen(true);
  };

  const handleGradedSuccess = (resultData) => {
    showToast('✅ Đã cập nhật điểm và trạng thái bài làm!');
    fetchAttempts();
  };

  const formatDateTime = (isoStr) => {
    if (!isoStr) return '---';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return '---';
      return d.toLocaleString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch (_) {
      return '---';
    }
  };

  // Lọc danh sách attempts
  const filteredAttempts = attempts.filter((att) => {
    const matchesSearch =
      (att.student_name && att.student_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (att.class_name && att.class_name.toLowerCase().includes(searchTerm.toLowerCase()));

    if (!matchesSearch) return false;

    if (selectedClassId !== 'ALL' && att.class_id !== selectedClassId) {
      return false;
    }

    if (selectedStatus !== 'ALL') {
      if (selectedStatus === 'pending_manual_grade' && att.status !== 'pending_manual_grade') {
        return false;
      }
      if (selectedStatus === 'graded' && att.status !== 'graded') {
        return false;
      }
      if (selectedStatus === 'draft' && att.status !== 'draft') {
        return false;
      }
    }

    return true;
  });

  // Thống kê nhanh
  const totalAttemptsCount = attempts.length;
  const pendingGradingCount = attempts.filter((a) => a.status === 'pending_manual_grade').length;
  const gradedCount = attempts.filter((a) => a.status === 'graded').length;

  const gradedAttempts = attempts.filter((a) => a.status === 'graded' && a.total_score !== null);
  const avgScore =
    gradedAttempts.length > 0
      ? (
          gradedAttempts.reduce((acc, a) => acc + Number(a.total_score || 0), 0) /
          gradedAttempts.length
        ).toFixed(2)
      : '---';

  if (!isOpen || !exam) return null;

  return (
    <div className="fixed inset-0 z-[9990] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white w-[96vw] md:w-[92vw] max-w-6xl h-[90vh] max-h-[90vh] rounded-3xl border-4 border-indigo-400 shadow-2xl p-4 sm:p-6 flex flex-col overflow-hidden animate-fadeIn">
        {/* TOAST NOTIFICATION */}
        {toastMsg && (
          <div className="fixed bottom-6 right-6 z-[10001] p-4 bg-emerald-600 text-white font-black text-xs rounded-2xl shadow-2xl animate-bounce flex items-center gap-2">
            <span>{toastMsg}</span>
          </div>
        )}

        {/* MODAL HEADER */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b-2 border-indigo-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-indigo-100 border border-indigo-200 flex items-center justify-center text-indigo-700 font-black shrink-0">
              <GraduationCap className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2.5 py-0.5 bg-indigo-50 text-indigo-800 font-black text-xs rounded-lg border border-indigo-200">
                  {exam.subject} - Khối {exam.grade_level}
                </span>
                <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 font-black text-xs rounded-lg border border-emerald-300 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Đã Xuất Bản (v
                  {exam.active_version?.version_number || 1})
                </span>
              </div>
              <h2 className="text-lg sm:text-xl font-black text-slate-900 mt-0.5">
                Bảng Kết Quả & Chấm Bài: {exam.title}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button
              onClick={fetchAttempts}
              disabled={loading}
              className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl transition-all"
              title="Tải lại danh sách"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => onClose?.()}
              className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl transition-all"
              title="Đóng bảng kết quả"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ERROR BANNER */}
        {errorMsg && (
          <div className="mt-3 p-3.5 bg-rose-50 border-2 border-rose-200 text-rose-800 rounded-2xl text-xs font-bold flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button
              onClick={fetchAttempts}
              className="px-3 py-1 bg-rose-600 text-white font-black text-xs rounded-lg hover:bg-rose-700 transition-all"
            >
              Thử Lại
            </button>
          </div>
        )}

        {/* STATS OVERVIEW CARDS */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 shrink-0">
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl">
            <span className="text-[11px] font-bold text-slate-500 block">Tổng lượt nộp</span>
            <span className="text-lg font-black text-slate-900">{totalAttemptsCount}</span>
          </div>

          <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl">
            <span className="text-[11px] font-black text-amber-800 block">Chờ chấm tự luận</span>
            <span className="text-lg font-black text-amber-900 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-amber-600" />
              {pendingGradingCount}
            </span>
          </div>

          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl">
            <span className="text-[11px] font-black text-emerald-800 block">Đã chấm xong</span>
            <span className="text-lg font-black text-emerald-900">{gradedCount}</span>
          </div>

          <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-2xl">
            <span className="text-[11px] font-black text-indigo-800 block">Điểm trung bình</span>
            <span className="text-lg font-black text-indigo-900">
              {avgScore} {avgScore !== '---' ? 'đ' : ''}
            </span>
          </div>
        </div>

        {/* FILTER CONTROLS */}
        <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200 mt-3 flex flex-col sm:flex-row items-center gap-2.5 shrink-0">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              placeholder="Tìm kiếm theo tên học sinh hoặc lớp..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <select
            value={selectedClassId}
            onChange={(e) => setSelectedClassId(e.target.value)}
            className="w-full sm:w-44 p-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700"
          >
            <option value="ALL">Tất cả lớp học</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="w-full sm:w-44 p-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700"
          >
            <option value="ALL">Tất cả trạng thái</option>
            <option value="pending_manual_grade">Chờ chấm tự luận</option>
            <option value="graded">Đã chấm</option>
            <option value="draft">Đang làm bài</option>
          </select>
        </div>

        {/* ATTEMPTS TABLE */}
        <div className="flex-1 overflow-y-auto mt-3 rounded-2xl border-2 border-slate-200 overflow-hidden shadow-inner bg-white">
          {loading ? (
            <div className="text-center py-16">
              <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mx-auto mb-2" />
              <p className="text-xs font-bold text-slate-400">Đang tải danh sách bài làm...</p>
            </div>
          ) : filteredAttempts.length === 0 ? (
            <div className="text-center py-16 p-6">
              <FileText className="w-12 h-12 text-slate-300 mx-auto mb-2" />
              <h4 className="text-sm font-black text-slate-700">Chưa có kết quả làm bài nào</h4>
              <p className="text-xs font-bold text-slate-400 mt-1">
                Chưa có học sinh nào nộp bài thi này hoặc không có dữ liệu khớp bộ lọc.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-bold whitespace-nowrap min-w-[960px]">
                <thead className="bg-slate-100 text-slate-700 uppercase border-b-2 border-slate-200 text-[11px] sticky top-0 z-10">
                  <tr>
                    <th className="p-3.5">Học Sinh</th>
                    <th className="p-3.5">Lớp</th>
                    <th className="p-3.5">Lượt</th>
                    <th className="p-3.5">Bắt Đầu Lúc</th>
                    <th className="p-3.5">Nộp Bài Lúc</th>
                    <th className="p-3.5">Trạng Thái</th>
                    <th className="p-3.5 text-right">Điểm TN</th>
                    <th className="p-3.5 text-right">Điểm TL</th>
                    <th className="p-3.5 text-right">Tổng Điểm</th>
                    <th className="p-3.5 text-center min-w-[140px]">Thao Tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {filteredAttempts.map((att) => {
                    const isPendingManual = att.status === 'pending_manual_grade';
                    const isGraded = att.status === 'graded';
                    const isDraft = att.status === 'draft';

                    const objScoreStr =
                      att.objective_score !== null && att.objective_score !== undefined
                        ? Number(att.objective_score).toFixed(2)
                        : '---';

                    const manualScoreStr =
                      att.manual_score !== null && att.manual_score !== undefined
                        ? Number(att.manual_score).toFixed(2)
                        : isPendingManual
                        ? 'Chờ chấm'
                        : '---';

                    const totalScoreStr =
                      att.total_score !== null && att.total_score !== undefined
                        ? Number(att.total_score).toFixed(2)
                        : isPendingManual
                        ? 'Chờ chấm'
                        : '---';

                    const maxScoreStr = Number(att.max_score || 0).toFixed(2);

                    return (
                      <tr
                        key={att.id}
                        className={`hover:bg-indigo-50/40 transition-colors ${
                          isPendingManual ? 'bg-amber-50/30' : ''
                        }`}
                      >
                        {/* HỌC SINH */}
                        <td className="p-3.5">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-800 flex items-center justify-center font-black text-xs shrink-0">
                              {att.student_name?.charAt(0) || 'H'}
                            </div>
                            <span className="font-black text-slate-900">{att.student_name}</span>
                          </div>
                        </td>

                        {/* LỚP */}
                        <td className="p-3.5">
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md text-[11px] font-bold">
                            {att.class_name || 'Lớp học'}
                          </span>
                        </td>

                        {/* LƯỢT LÀM */}
                        <td className="p-3.5">
                          <span className="text-slate-600 font-extrabold">
                            #{att.attempt_number || 1}
                          </span>
                        </td>

                        {/* BẮT ĐẦU */}
                        <td className="p-3.5 text-[11px] text-slate-500">
                          {formatDateTime(att.started_at)}
                        </td>

                        {/* NỘP BÀI */}
                        <td className="p-3.5 text-[11px] text-slate-700 font-extrabold">
                          {formatDateTime(att.submitted_at)}
                        </td>

                        {/* TRẠNG THÁI */}
                        <td className="p-3.5">
                          {isPendingManual ? (
                            <span className="px-2.5 py-1 bg-amber-100 text-amber-900 rounded-xl text-[11px] font-black border border-amber-300 flex items-center gap-1 w-fit">
                              <Sparkles className="w-3 h-3 text-amber-600 shrink-0" /> Chờ chấm tự luận
                            </span>
                          ) : isGraded ? (
                            <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-xl text-[11px] font-black border border-emerald-300 flex items-center gap-1 w-fit">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" /> Đã hoàn tất
                            </span>
                          ) : isDraft ? (
                            <span className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-xl text-[11px] font-black w-fit">
                              Đang làm bài
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-xl text-[11px] font-black w-fit">
                              {att.status}
                            </span>
                          )}
                        </td>

                        {/* ĐIỂM TRẮC NGHIỆM */}
                        <td className="p-3.5 text-right font-bold text-sky-700">{objScoreStr}</td>

                        {/* ĐIỂM TỰ LUẬN */}
                        <td className="p-3.5 text-right font-bold text-amber-800">
                          {manualScoreStr}
                        </td>

                        {/* TỔNG ĐIỂM */}
                        <td className="p-3.5 text-right">
                          {isGraded ? (
                            <span className="font-black text-emerald-700 text-sm">
                              {totalScoreStr} / {maxScoreStr} đ
                            </span>
                          ) : (
                            <span className="font-bold text-slate-400">
                              {totalScoreStr} / {maxScoreStr} đ
                            </span>
                          )}
                        </td>

                        {/* THAO TÁC */}
                        <td className="p-3.5 text-center min-w-[140px]">
                          {isPendingManual ? (
                            <button
                              onClick={() => handleOpenGradingModal(att)}
                              className="px-3.5 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-black text-xs rounded-xl shadow-md border-b-2 border-amber-700 inline-flex items-center justify-center gap-1.5 mx-auto active:translate-y-0.5 transition-all shrink-0 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1"
                              title="Chấm điểm các câu tự luận của bài thi này"
                            >
                              <Edit3 className="w-3.5 h-3.5 shrink-0" /> <span className="whitespace-nowrap">Chấm Bài</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => handleOpenGradingModal(att)}
                              className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs rounded-xl inline-flex items-center justify-center gap-1.5 mx-auto transition-all shrink-0 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
                              title="Xem chi tiết câu hỏi và bài làm học sinh"
                            >
                              <Eye className="w-3.5 h-3.5 text-slate-500 shrink-0" /> <span className="whitespace-nowrap">Xem Chi Tiết</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* MODAL FOOTER */}
        <div className="pt-3 flex justify-end shrink-0">
          <button
            onClick={() => onClose?.()}
            className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs rounded-2xl transition-all"
          >
            Đóng
          </button>
        </div>
      </div>

      {/* MODAL CHẤM BÀI CHI TIẾT */}
      {isGradingModalOpen && selectedAttemptId && (
        <ExamGradingModal
          isOpen={isGradingModalOpen}
          attemptId={selectedAttemptId}
          role={role}
          onClose={() => {
            setIsGradingModalOpen(false);
            setSelectedAttemptId(null);
          }}
          onGraded={handleGradedSuccess}
        />
      )}
    </div>
  );
};
