import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import {
  RotateCcw,
  School,
  Users,
  Gamepad2,
  BookOpen,
  Calendar,
  AlertCircle,
  CheckCircle2,
  X,
  RefreshCw,
  History,
  ShieldAlert,
  HelpCircle,
  Sparkles,
  ArrowRight,
  Undo2
} from 'lucide-react';

export function ResetScoresModal({ isOpen, onClose, onApplied, initialClassId = '' }) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  // Tabs: 'create' (Thiết lập mới) | 'history' (Lịch sử & Hoàn tác)
  const [activeTab, setActiveTab] = useState('create');

  // Form states
  const [classesList, setClassesList] = useState([]);
  const [studentsList, setStudentsList] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState(initialClassId);
  const [selectedStudentIds, setSelectedStudentIds] = useState([]);
  const [isSelectAllStudents, setIsSelectAllStudents] = useState(true);

  const [scope, setScope] = useState('both'); // 'game' | 'academic' | 'both'
  const [timeMode, setTimeMode] = useState('cutoff'); // 'week' | 'month' | 'hk1' | 'hk2' | 'full_year' | 'cutoff' | 'custom'
  const [customFromDate, setCustomFromDate] = useState('');
  const [customUntilDate, setCustomUntilDate] = useState('');
  const [reason, setReason] = useState('Bắt đầu đợt thi đua mới');

  // Preview & Action states
  const [previewData, setPreviewData] = useState(null);
  const [isLoadingClasses, setIsLoadingClasses] = useState(false);
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Active baselines for class (History / Undo)
  const [activeBaselines, setActiveBaselines] = useState([]);
  const [isLoadingBaselines, setIsLoadingBaselines] = useState(false);
  const [revokingId, setRevokingId] = useState(null);

  useEffect(() => {
    if (isOpen) {
      fetchClasses();
      setActiveTab('create');
      setErrorMessage('');
      setSuccessMessage('');
      setShowConfirmModal(false);
    } else {
      setPreviewData(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (selectedClassId) {
      fetchStudents(selectedClassId);
      fetchActiveBaselines(selectedClassId);
    } else {
      setStudentsList([]);
      setSelectedStudentIds([]);
      setActiveBaselines([]);
    }
  }, [selectedClassId]);

  // Tự động kích hoạt preview khi các thông số thay đổi
  useEffect(() => {
    if (isOpen && selectedClassId && activeTab === 'create') {
      triggerPreview();
    }
  }, [selectedClassId, selectedStudentIds, isSelectAllStudents, scope, timeMode, customFromDate, customUntilDate]);

  const fetchClasses = async () => {
    try {
      setIsLoadingClasses(true);
      let query = supabase.from('classes').select('id, name, grade_level, teacher_id').order('name');
      if (!isAdmin) {
        query = query.eq('teacher_id', profile?.id);
      }
      const { data, error } = await query;
      if (error) throw error;

      const list = data || [];
      setClassesList(list);

      if (list.length > 0) {
        const found = initialClassId && list.some(c => c.id === initialClassId);
        const chosenId = found ? initialClassId : list[0].id;
        setSelectedClassId(chosenId);
      }
    } catch (err) {
      setErrorMessage('Lỗi tải danh sách lớp học: ' + (err.message || String(err)));
    } finally {
      setIsLoadingClasses(false);
    }
  };

  const fetchStudents = async (classId) => {
    try {
      setIsLoadingStudents(true);
      const { data, error } = await supabase
        .from('class_members')
        .select('student_id, profiles:student_id (id, full_name, avatar_url, role)')
        .eq('class_id', classId);

      if (error) throw error;

      const formatted = (data || [])
        .map(item => item.profiles)
        .filter(p => p && p.role === 'student');

      setStudentsList(formatted);
      if (isSelectAllStudents) {
        setSelectedStudentIds(formatted.map(s => s.id));
      }
    } catch (err) {
      setErrorMessage('Lỗi tải danh sách học sinh: ' + (err.message || String(err)));
    } finally {
      setIsLoadingStudents(false);
    }
  };

  const fetchActiveBaselines = async (classId) => {
    try {
      setIsLoadingBaselines(true);
      const { data, error } = await supabase.rpc('get_class_score_baselines', {
        p_class_id: classId
      });
      if (error) throw error;
      if (data && data.success) {
        setActiveBaselines(data.baselines || []);
      }
    } catch (err) {
      console.error('Error fetching baselines:', err);
    } finally {
      setIsLoadingBaselines(false);
    }
  };

  // Tính toán thời gian (start, end) dựa theo timeMode
  const computeTimeRange = () => {
    const now = new Date();
    let fromIso = null;
    let untilIso = null;

    if (timeMode === 'week') {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      const startOfWeek = new Date(now.setDate(diff));
      startOfWeek.setHours(0, 0, 0, 0);
      fromIso = startOfWeek.toISOString();
      untilIso = null; // Mốc tính điểm mới từ đầu tuần này
    } else if (timeMode === 'month') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      startOfMonth.setHours(0, 0, 0, 0);
      fromIso = startOfMonth.toISOString();
      untilIso = null; // Mốc tính điểm mới từ đầu tháng này
    } else if (timeMode === 'hk1') {
      fromIso = '2026-09-01T00:00:00+07:00';
      untilIso = null; // Mốc tính điểm mới từ đầu Học kỳ 1
    } else if (timeMode === 'hk2') {
      fromIso = '2027-01-10T00:00:00+07:00';
      untilIso = null; // Mốc tính điểm mới từ đầu Học kỳ 2
    } else if (timeMode === 'full_year') {
      fromIso = '2026-09-01T00:00:00+07:00';
      untilIso = null; // Mốc tính điểm mới từ đầu Năm học
    } else if (timeMode === 'cutoff') {
      fromIso = customFromDate ? new Date(customFromDate).toISOString() : new Date().toISOString();
      untilIso = null; // Mốc bắt đầu tính điểm mới
    }

    return { fromIso, untilIso };
  };

  const triggerPreview = async () => {
    if (!selectedClassId) return;

    const { fromIso, untilIso } = computeTimeRange();
    if (!fromIso) return;

    try {
      setIsPreviewing(true);
      setErrorMessage('');

      const targetStudents = isSelectAllStudents
        ? studentsList.map(s => s.id)
        : selectedStudentIds;

      if (targetStudents.length === 0) {
        setPreviewData(null);
        return;
      }

      const { data, error } = await supabase.rpc('preview_score_baseline_reset', {
        p_class_id: selectedClassId,
        p_student_ids: targetStudents,
        p_scope: scope,
        p_effective_from: fromIso,
        p_effective_until: untilIso
      });

      if (error) throw error;
      if (data && !data.success) {
        throw new Error(data.message || 'Lỗi xem trước tác động.');
      }

      setPreviewData(data);
    } catch (err) {
      console.warn('Preview baseline warning:', err.message);
      setPreviewData(null);
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleApplyBaseline = async () => {
    if (!selectedClassId) {
      setErrorMessage('Vui lòng chọn Lớp học.');
      return;
    }

    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setErrorMessage('Vui lòng nhập lý do thiết lập mốc xuất phát mới.');
      return;
    }

    const { fromIso, untilIso } = computeTimeRange();
    if (!fromIso) {
      setErrorMessage('Vui lòng chọn mốc thời gian bắt đầu hợp lệ.');
      return;
    }

    const targetStudents = isSelectAllStudents
      ? studentsList.map(s => s.id)
      : selectedStudentIds;

    if (targetStudents.length === 0) {
      setErrorMessage('Vui lòng chọn ít nhất 1 học sinh.');
      return;
    }

    try {
      setIsApplying(true);
      setErrorMessage('');
      setSuccessMessage('');

      const { data, error } = await supabase.rpc('admin_teacher_set_score_baseline', {
        p_class_id: selectedClassId,
        p_student_ids: targetStudents,
        p_scope: scope,
        p_effective_from: fromIso,
        p_effective_until: untilIso,
        p_reason: trimmedReason
      });

      if (error) throw error;
      if (data && !data.success) {
        throw new Error(data.message || 'Lỗi áp dụng mốc xuất phát mới.');
      }

      setSuccessMessage(data.message || 'Thiết lập mốc xuất phát mới thành công!');
      setShowConfirmModal(false);

      // Cập nhật lại lịch sử
      fetchActiveBaselines(selectedClassId);

      if (onApplied) {
        onApplied();
      }
    } catch (err) {
      setErrorMessage('Lỗi thực hiện: ' + (err.message || String(err)));
    } finally {
      setIsApplying(false);
    }
  };

  const handleRevokeBaseline = async (baselineId) => {
    if (!window.confirm('Bạn có chắc chắn muốn HỦY BỎ mốc xuất phát này và KHÔI PHỤC điểm cũ cho học sinh trên Bảng xếp hạng?')) {
      return;
    }

    try {
      setRevokingId(baselineId);
      setErrorMessage('');
      setSuccessMessage('');

      const { data, error } = await supabase.rpc('admin_teacher_revoke_score_baseline', {
        p_baseline_id: baselineId,
        p_reason: 'Hoàn tác mốc xuất phát'
      });

      if (error) throw error;
      if (data && !data.success) {
        throw new Error(data.message || 'Lỗi thu hồi mốc xuất phát.');
      }

      setSuccessMessage('Đã hủy mốc xuất phát thành công! Điểm cũ đã được phục hồi trên Bảng xếp hạng.');
      fetchActiveBaselines(selectedClassId);

      if (onApplied) {
        onApplied();
      }
    } catch (err) {
      setErrorMessage('Lỗi khi hủy mốc: ' + (err.message || String(err)));
    } finally {
      setRevokingId(null);
    }
  };

  const toggleStudent = (studentId) => {
    setIsSelectAllStudents(false);
    setSelectedStudentIds(prev =>
      prev.includes(studentId)
        ? prev.filter(id => id !== studentId)
        : [...prev, studentId]
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white w-full max-w-2xl rounded-3xl border-4 border-amber-300 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">

        {/* HEADER */}
        <div className="bg-gradient-to-r from-amber-500 via-amber-600 to-indigo-600 px-6 py-4 text-white flex items-center justify-between border-b-4 border-amber-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center text-xl font-bold shadow-inner">
              🔄
            </div>
            <div>
              <h2 className="text-lg font-black tracking-wide">Thiết Lập Mốc Xuất Phát Mới (Reset Điểm)</h2>
              <p className="text-xs text-amber-100 font-semibold">Tạo đợt đua top mới an toàn — Giữ nguyên 100% dữ liệu bài làm gốc</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* TABS CHUYỂN ĐỔI */}
        <div className="flex bg-amber-50 p-2 border-b-2 border-amber-200 gap-2">
          <button
            onClick={() => { setActiveTab('create'); setErrorMessage(''); }}
            className={`flex-1 py-2.5 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'create'
                ? 'bg-amber-500 text-white shadow-sm border-b-2 border-amber-700'
                : 'text-slate-600 hover:bg-amber-100/60'
            }`}
          >
            <Sparkles className="w-4 h-4" /> Thiết Lập Mốc Mới
          </button>
          <button
            onClick={() => { setActiveTab('history'); setErrorMessage(''); }}
            className={`flex-1 py-2.5 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'history'
                ? 'bg-indigo-600 text-white shadow-sm border-b-2 border-indigo-800'
                : 'text-slate-600 hover:bg-indigo-50'
            }`}
          >
            <History className="w-4 h-4" /> Lịch Sử & Hoàn Tác ({activeBaselines.length})
          </button>
        </div>

        {/* BODY */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {errorMessage && (
            <div className="p-4 rounded-2xl bg-rose-50 border-2 border-rose-200 text-rose-700 text-xs font-extrabold flex items-center gap-3 animate-shake">
              <AlertCircle className="w-5 h-5 flex-shrink-0 text-rose-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-4 rounded-2xl bg-emerald-50 border-2 border-emerald-200 text-emerald-700 text-xs font-extrabold flex items-center gap-3 animate-fadeIn">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-600" />
              <span>{successMessage}</span>
            </div>
          )}

          {activeTab === 'create' ? (
            <>
              {/* 1. CHỌN LỚP HỌC */}
              <div>
                <label className="block text-xs font-black uppercase text-slate-700 mb-1.5 flex items-center gap-1.5">
                  <School className="w-4 h-4 text-amber-600" /> 1. Chọn Lớp Học Áp Dụng
                </label>
                <select
                  value={selectedClassId}
                  onChange={(e) => setSelectedClassId(e.target.value)}
                  disabled={isLoadingClasses}
                  className="w-full px-4 py-3 rounded-2xl border-2 border-slate-200 bg-slate-50 font-bold text-sm text-slate-800 focus:border-amber-500 focus:bg-white outline-none transition-colors"
                >
                  {classesList.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} (Khối {c.grade_level || 1})
                    </option>
                  ))}
                </select>
              </div>

              {/* 2. CHỌN HỌC SINH */}
              <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black uppercase text-slate-700 flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-indigo-600" /> 2. Đối Tượng Học Sinh ({isSelectAllStudents ? studentsList.length : selectedStudentIds.length}/{studentsList.length})
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      if (isSelectAllStudents) {
                        setIsSelectAllStudents(false);
                        setSelectedStudentIds([]);
                      } else {
                        setIsSelectAllStudents(true);
                        setSelectedStudentIds(studentsList.map(s => s.id));
                      }
                    }}
                    className="text-xs font-black text-indigo-600 hover:text-indigo-800 underline"
                  >
                    {isSelectAllStudents ? 'Bỏ chọn tất cả' : 'Chọn tất cả cả lớp'}
                  </button>
                </div>

                {isLoadingStudents ? (
                  <div className="py-4 text-center text-xs font-bold text-slate-400">Đang tải danh sách học sinh...</div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-36 overflow-y-auto p-1">
                    {studentsList.map(st => {
                      const isChecked = isSelectAllStudents || selectedStudentIds.includes(st.id);
                      return (
                        <label
                          key={st.id}
                          className={`flex items-center gap-2 p-2 rounded-xl border text-xs font-bold cursor-pointer transition-all ${
                            isChecked
                              ? 'bg-indigo-50 border-indigo-300 text-indigo-900 font-black'
                              : 'bg-white border-slate-200 text-slate-600 opacity-70'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleStudent(st.id)}
                            className="rounded text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="truncate">{st.full_name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 3. PHÂN LOẠI ĐIỂM SỐ */}
              <div>
                <label className="block text-xs font-black uppercase text-slate-700 mb-1.5 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-600" /> 3. Phân Loại Điểm Cần Thiết Lập Mốc Mới
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setScope('game')}
                    className={`p-3 rounded-2xl border-2 font-black text-xs flex flex-col items-center gap-1 transition-all ${
                      scope === 'game'
                        ? 'bg-amber-100 border-amber-500 text-amber-950 shadow-sm'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Gamepad2 className="w-5 h-5 text-amber-600" />
                    <span>🎮 Điểm Trò Chơi</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setScope('academic')}
                    className={`p-3 rounded-2xl border-2 font-black text-xs flex flex-col items-center gap-1 transition-all ${
                      scope === 'academic'
                        ? 'bg-emerald-100 border-emerald-500 text-emerald-950 shadow-sm'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <BookOpen className="w-5 h-5 text-emerald-600" />
                    <span>📚 Điểm Học Thuật</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setScope('both')}
                    className={`p-3 rounded-2xl border-2 font-black text-xs flex flex-col items-center gap-1 transition-all ${
                      scope === 'both'
                        ? 'bg-indigo-100 border-indigo-500 text-indigo-950 shadow-sm'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Sparkles className="w-5 h-5 text-indigo-600" />
                    <span>🌟 Cả Hai Loại</span>
                  </button>
                </div>
              </div>

              {/* 4. KHOẢNG THỜI GIAN RESET */}
              <div>
                <label className="block text-xs font-black uppercase text-slate-700 mb-1.5 flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-sky-600" /> 4. Mốc Thời Gian / Phạm Vi Áp Dụng
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2.5">
                  {[
                    { key: 'cutoff', label: '🚀 Mốc Mới (Từ Ngày Chọn)' },
                    { key: 'week', label: 'Tuần Này' },
                    { key: 'month', label: 'Tháng Này' },
                    { key: 'hk1', label: 'Học Kỳ 1' },
                    { key: 'hk2', label: 'Học Kỳ 2' },
                    { key: 'full_year', label: 'Cả Năm Học' },
                    { key: 'custom', label: 'Tùy Chọn' }
                  ].map(m => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setTimeMode(m.key)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
                        timeMode === m.key
                          ? 'bg-sky-600 text-white shadow-sm'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                {(timeMode === 'cutoff' || timeMode === 'custom') && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-slate-50 rounded-2xl border-2 border-slate-200 animate-fadeIn">
                    <div>
                      <span className="block text-[11px] font-black uppercase text-slate-500 mb-1">
                        {timeMode === 'cutoff' ? 'Mốc Bắt Đầu Tính Điểm Mới:' : 'Từ Ngày:'}
                      </span>
                      <input
                        type="datetime-local"
                        value={customFromDate}
                        onChange={(e) => setCustomFromDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-xs bg-white outline-none focus:border-sky-500"
                      />
                    </div>
                    {timeMode === 'custom' && (
                      <div>
                        <span className="block text-[11px] font-black uppercase text-slate-500 mb-1">Đến Ngày (Không Bắt Buộc):</span>
                        <input
                          type="datetime-local"
                          value={customUntilDate}
                          onChange={(e) => setCustomUntilDate(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-xs bg-white outline-none focus:border-sky-500"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 5. TỔNG HỢP TÁC ĐỘNG DỰ KIẾN (PREVIEW IMPACT) */}
              <div className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-300 space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase text-amber-950 flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-amber-600" /> Tóm Tắt Tác Động Lên Bảng Xếp Hạng
                  </h4>
                  {isPreviewing && (
                    <span className="text-[11px] font-bold text-amber-700 flex items-center gap-1">
                      <RefreshCw className="w-3 h-3 animate-spin" /> Đang tính toán...
                    </span>
                  )}
                </div>

                {previewData ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-center">
                    <div className="p-2 bg-white rounded-xl border border-amber-200">
                      <span className="text-lg font-black text-indigo-700 block">{previewData.student_count}</span>
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Học Sinh</span>
                    </div>
                    <div className="p-2 bg-white rounded-xl border border-amber-200">
                      <span className="text-lg font-black text-amber-600 block">{previewData.affected_games_count}</span>
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Lượt Game Cũ</span>
                    </div>
                    <div className="p-2 bg-white rounded-xl border border-amber-200">
                      <span className="text-lg font-black text-amber-600 block">{previewData.affected_game_stars} 🌟</span>
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Sao Đưa Về Mốc</span>
                    </div>
                    <div className="p-2 bg-white rounded-xl border border-amber-200">
                      <span className="text-lg font-black text-emerald-600 block">{previewData.affected_submissions_count}</span>
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Bài Nộp Học Thuật</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs font-bold text-slate-500 italic">Vui lòng chọn thông tin để xem tóm tắt tác động.</p>
                )}

                <div className="p-2.5 bg-sky-50 rounded-xl border border-sky-200 text-sky-900 text-[11px] font-bold flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-sky-600 flex-shrink-0 mt-0.5" />
                  <span>
                    <strong>An toàn dữ liệu 100%:</strong> Toàn bộ bài làm học sinh, điểm số bài tập và các kỳ xếp hạng đã đóng (CLOSED) được bảo lưu nguyên vẹn trong hệ thống.
                  </span>
                </div>
              </div>

              {/* 6. LÝ DO THIẾT LẬP */}
              <div>
                <label className="block text-xs font-black uppercase text-slate-700 mb-1.5 flex items-center gap-1.5">
                  📝 5. Lý Do Thiết Lập Mốc Mới (Bắt Buộc)
                </label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ví dụ: Bắt đầu đợt thi đua Tháng 10 chào mừng 20/11..."
                  className="w-full px-4 py-2.5 rounded-2xl border-2 border-slate-200 font-bold text-xs bg-slate-50 outline-none focus:border-amber-500 focus:bg-white"
                />
              </div>

              {/* HỘP THOẠI XÁC NHẬN CUỐI CÙNG */}
              {showConfirmModal && (
                <div className="p-4 rounded-2xl bg-rose-50 border-2 border-rose-300 text-rose-900 text-xs font-bold space-y-3 animate-fadeIn">
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-black text-rose-950 text-sm">Xác Nhận Thiết Lập Mốc Xuất Phát Mới</p>
                      <p className="mt-1 leading-relaxed">
                        Bạn đang thiết lập mốc xuất phát mới cho <span className="font-black text-indigo-700">{previewData?.student_count || 0} học sinh</span> lớp <span className="font-black underline">{previewData?.class_name}</span>.
                        Điểm xếp hạng trước mốc này sẽ không được tính vào bảng xếp hạng mới (có thể Hoàn tác bất kỳ lúc nào).
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-rose-200">
                    <button
                      type="button"
                      onClick={() => setShowConfirmModal(false)}
                      className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-black text-xs"
                    >
                      Hủy Bỏ
                    </button>
                    <button
                      type="button"
                      onClick={handleApplyBaseline}
                      disabled={isApplying}
                      className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-black text-xs shadow-md flex items-center gap-1.5"
                    >
                      {isApplying ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                      Xác Nhận Áp Dụng Ngay
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* TAB LỊCH SỬ & HOÀN TÁC (UNDO) */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black uppercase text-slate-700 flex items-center gap-1.5">
                  <History className="w-4 h-4 text-indigo-600" /> Danh Sách Mốc Xuất Phát Đang Áp Dụng Cho Lớp
                </h3>
                <button
                  type="button"
                  onClick={() => fetchActiveBaselines(selectedClassId)}
                  className="text-xs font-bold text-indigo-600 hover:underline flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" /> Làm mới
                </button>
              </div>

              {isLoadingBaselines ? (
                <div className="py-8 text-center text-xs font-bold text-slate-400">Đang tải lịch sử mốc xuất phát...</div>
              ) : activeBaselines.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 text-slate-500 font-bold text-xs space-y-1">
                  <p>✨ Lớp học hiện đang tính điểm theo mặc định ban đầu.</p>
                  <p className="text-[11px] text-slate-400">Chưa có mốc xuất phát mới nào được kích hoạt.</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {activeBaselines.map((bl) => (
                    <div
                      key={bl.id}
                      className="p-3.5 rounded-2xl bg-white border-2 border-indigo-100 hover:border-indigo-300 shadow-sm flex items-center justify-between gap-3 transition-all"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-black text-slate-800 text-xs">{bl.student_name}</span>
                          <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase bg-indigo-50 text-indigo-700">
                            {bl.scope === 'both' ? '🎮 Game + 📚 Học thuật' : bl.scope === 'game' ? '🎮 Trò chơi' : '📚 Học thuật'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 font-bold">
                          Mốc áp dụng từ: <span className="font-mono text-slate-700">{new Date(bl.effective_from).toLocaleDateString('vi-VN')}</span> {bl.effective_until ? `đến ${new Date(bl.effective_until).toLocaleDateString('vi-VN')}` : '(Mốc xuất phát mới)'}
                        </p>
                        <p className="text-[11px] text-amber-700 font-semibold italic">Lý do: "{bl.reason}"</p>
                      </div>

                      <button
                        type="button"
                        disabled={revokingId === bl.id}
                        onClick={() => handleRevokeBaseline(bl.id)}
                        className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl font-black text-xs flex items-center gap-1.5 transition-colors"
                        title="Hủy mốc xuất phát và khôi phục điểm cũ"
                      >
                        {revokingId === bl.id ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Undo2 className="w-3.5 h-3.5" />
                        )}
                        Hoàn Tác
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div className="p-4 bg-slate-50 border-t-2 border-slate-200 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-black text-xs rounded-2xl transition-colors"
          >
            Đóng
          </button>
          {activeTab === 'create' && (
            <button
              type="button"
              onClick={() => setShowConfirmModal(true)}
              disabled={isApplying || isPreviewing || !selectedClassId || (!isSelectAllStudents && selectedStudentIds.length === 0)}
              className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50 font-black text-xs rounded-2xl border-b-4 border-amber-700 shadow-md flex items-center gap-2 active:translate-y-0.5"
            >
              {isApplying ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Đang Lưu...
                </>
              ) : (
                <>
                  <RotateCcw className="w-4 h-4" /> Thiết Lập Mốc Mới
                </>
              )}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
