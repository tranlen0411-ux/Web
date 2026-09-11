// src/components/dashboard/exams/AssignExamModal.jsx
// Modal giao đề thi đã xuất bản cho lớp học (Admin & Teacher Scope)

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Send,
  GraduationCap,
  Calendar,
  Clock,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Info,
  Layers,
  Award
} from 'lucide-react';
import { createExamManagementClient } from '../../../services/examManagementClient.js';
import { formatClassLabel } from '../../../utils/helpers.js';

export const AssignExamModal = ({
  isOpen,
  onClose,
  exam,
  classes = [],
  role = 'teacher',
  onAssigned,
}) => {
  const [selectedClassId, setSelectedClassId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [lastStartAt, setLastStartAt] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [countsTowardRanking, setCountsTowardRanking] = useState(true);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (isOpen && exam?.active_version) {
      const v = exam.active_version;
      // Điền trước giá trị từ phiên bản đề thi nếu có
      setStartsAt(v.starts_at ? formatDateTimeLocal(v.starts_at) : '');
      setLastStartAt(v.last_start_at ? formatDateTimeLocal(v.last_start_at) : '');
      setDueDate(v.due_date ? formatDateTimeLocal(v.due_date) : '');
      setSelectedClassId(classes.length > 0 ? classes[0].id : '');
      setErrorMsg('');
    }
  }, [isOpen, exam, classes]);

  if (!isOpen || !exam) return null;

  const activeVersion = exam.active_version;
  const isPublished = activeVersion?.status === 'published';

  function formatDateTimeLocal(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return '';
      const offset = d.getTimezoneOffset() * 60000;
      const local = new Date(d.getTime() - offset);
      return local.toISOString().slice(0, 16);
    } catch (_) {
      return '';
    }
  }

  const handleConfirmAssign = async (e) => {
    e.preventDefault();
    if (!selectedClassId) {
      setErrorMsg('Vui lòng chọn lớp học để giao đề thi.');
      return;
    }

    if (!isPublished) {
      setErrorMsg('Chỉ đề thi đã xuất bản (published) mới có thể giao cho lớp học.');
      return;
    }

    // Kiểm tra tính hợp lệ của lịch thi
    if (startsAt && lastStartAt && new Date(lastStartAt).getTime() < new Date(startsAt).getTime()) {
      setErrorMsg('Hạn chót vào làm bài không thể sớm hơn thời gian mở đề.');
      return;
    }
    if (lastStartAt && dueDate && new Date(lastStartAt).getTime() > new Date(dueDate).getTime()) {
      setErrorMsg('Hạn chót vào làm bài không thể muộn hơn hạn nộp bài cưỡng chế.');
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      const client = createExamManagementClient();
      const res = await client.createAssignment({
        exam_version_id: activeVersion.id,
        class_id: selectedClassId,
        starts_at: startsAt ? new Date(startsAt).toISOString() : null,
        last_start_at: lastStartAt ? new Date(lastStartAt).toISOString() : null,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
        counts_toward_ranking: countsTowardRanking,
      });

      if (!res.ok) {
        setErrorMsg(res.error?.message || 'Không thể giao đề thi cho lớp học.');
        return;
      }

      if (typeof onAssigned === 'function') {
        onAssigned(res.data);
      }
      onClose('🎉 Đã giao đề thi cho lớp học thành công!');
    } catch (err) {
      setErrorMsg(err.message || 'Lỗi hệ thống khi giao đề thi.');
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-slate-900/65 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-xl rounded-3xl border-4 border-indigo-300 shadow-2xl flex flex-col overflow-hidden animate-fadeIn my-8">
        {/* HEADER */}
        <div className="flex items-center justify-between px-6 py-4 border-b-2 border-indigo-100 bg-indigo-50/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-600 text-white rounded-2xl shadow-md">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-800">Giao Đề Kiểm Tra Cho Lớp Học</h3>
              <p className="text-xs font-bold text-indigo-700">Exam Builder V1</p>
            </div>
          </div>
          <button
            onClick={() => onClose()}
            disabled={loading}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-white rounded-xl transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* BODY */}
        <form onSubmit={handleConfirmAssign} className="p-6 space-y-5">
          {errorMsg && (
            <div className="p-3.5 bg-rose-50 border-2 border-rose-200 text-rose-800 rounded-2xl text-xs font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* THÔNG TIN ĐỀ THI ĐƯỢC CHỌN */}
          <div className="p-4 bg-slate-50 border-2 border-slate-200 rounded-2xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-slate-500 uppercase">Đề thi xuất bản</span>
              <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 text-[11px] font-black rounded-lg border border-emerald-300">
                Phiên bản v{activeVersion?.version_number || 1}
              </span>
            </div>
            <h4 className="text-sm font-black text-slate-800">{exam.title}</h4>
            <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-slate-600 pt-1">
              <span>Môn: <strong className="text-indigo-600">{exam.subject}</strong></span>
              <span>•</span>
              <span>Khối: <strong className="text-amber-600">{exam.grade_level}</strong></span>
              {activeVersion?.duration_minutes && (
                <>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <strong>{activeVersion.duration_minutes} phút</strong>
                  </span>
                </>
              )}
            </div>
          </div>

          {/* CHỌN LỚP HỌC */}
          <div>
            <label className="block text-xs font-black text-slate-800 mb-1.5 flex items-center gap-1.5">
              <GraduationCap className="w-4 h-4 text-indigo-600" />
              Chọn Lớp Học Tiếp Nhận Đề Thi <span className="text-rose-500">*</span>
            </label>
            {classes.length > 0 ? (
              <select
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
                className="w-full p-3 bg-indigo-50/50 border-2 border-indigo-200 rounded-2xl font-bold text-xs text-slate-800 focus:outline-none focus:border-indigo-500 transition-all"
              >
                {classes.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {formatClassLabel(cls.name)} (Khối {cls.grade_level})
                  </option>
                ))}
              </select>
            ) : (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs font-bold text-amber-900">
                ⚠️ Không tìm thấy lớp học nào do Thầy/Cô quản lý. Vui lòng tạo lớp học trước khi giao bài.
              </div>
            )}
            <p className="text-[11px] font-bold text-slate-400 mt-1">
              {role === 'teacher'
                ? 'Chỉ hiển thị các lớp học do Thầy/Cô trực tiếp phụ trách (Bảo mật Server-Side).'
                : 'Quản trị viên có thể giao đề cho bất kỳ lớp học nào trong trường.'}
            </p>
          </div>

          {/* LỊCH THI LINH HOẠT (PHASE A SUPPORTED) */}
          <div className="p-4 bg-indigo-50/40 border-2 border-indigo-100 rounded-2xl space-y-3">
            <h5 className="text-xs font-black text-indigo-950 flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-indigo-600" />
              Cấu Hình Lịch Thi Linh Hoạt Cho Lớp Này
            </h5>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Thời gian mở đề (starts_at):
                </label>
                <input
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  className="w-full p-2.5 bg-white border border-indigo-200 rounded-xl font-bold text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Hạn chót vào làm bài (last_start_at):
                </label>
                <input
                  type="datetime-local"
                  value={lastStartAt}
                  onChange={(e) => setLastStartAt(e.target.value)}
                  className="w-full p-2.5 bg-white border border-indigo-200 rounded-xl font-bold text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Hạn nộp bài cưỡng chế (due_date):
                </label>
                <input
                  type="datetime-local"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full p-2.5 bg-white border border-indigo-200 rounded-xl font-bold text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="p-3 bg-white/80 rounded-xl border border-indigo-100 text-[11px] font-bold text-slate-500 space-y-1">
              <div className="flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
                <span><strong>Thời gian mở đề:</strong> Học sinh chỉ có thể bấm vào làm sau thời điểm này.</span>
              </div>
              <div className="flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
                <span><strong>Hạn chót vào làm:</strong> Sau mốc này, học sinh chưa thi sẽ không được bắt đầu làm bài.</span>
              </div>
              <div className="flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
                <span><strong>Hạn nộp bài cưỡng chế:</strong> Đóng phòng thi, bài chưa nộp sẽ bị hết giờ.</span>
              </div>
            </div>
          </div>

          {/* TÍNH ĐIỂM XẾP HẠNG */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="countsRanking"
              checked={countsTowardRanking}
              onChange={(e) => setCountsTowardRanking(e.target.checked)}
              className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
            />
            <label htmlFor="countsRanking" className="text-xs font-bold text-slate-700 cursor-pointer">
              Tính điểm bài kiểm tra này vào Bảng Xếp Hạng học kỳ
            </label>
          </div>

          {/* FOOTER ACTIONS */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => onClose()}
              disabled={loading}
              className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs rounded-xl transition-all"
            >
              Hủy
            </button>

            <button
              type="submit"
              disabled={loading || classes.length === 0 || !isPublished}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-xl shadow-md border-b-4 border-indigo-800 flex items-center gap-2 active:translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Đang giao đề...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Xác Nhận Giao Đề Thi
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
