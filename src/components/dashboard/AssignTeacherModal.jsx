import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { UserCheck, ShieldAlert, CheckCircle2, X, School, User, AlertCircle, RefreshCw } from 'lucide-react';

export function AssignTeacherModal({ isOpen, onClose, onSaved }) {
  const [classesList, setClassesList] = useState([]);
  const [teachersList, setTeachersList] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedTeacherId, setSelectedTeacherId] = useState('');
  const [currentTeacherInfo, setCurrentTeacherInfo] = useState(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchInitialData();
    } else {
      setSelectedClassId('');
      setSelectedTeacherId('');
      setCurrentTeacherInfo(null);
      setErrorMessage('');
      setSuccessMessage('');
      setShowConfirmDialog(false);
    }
  }, [isOpen]);

  const fetchInitialData = async () => {
    try {
      setIsLoading(true);
      setErrorMessage('');

      // 1. Tải danh sách tất cả các Lớp học (Không dùng updated_at)
      const { data: classesData, error: classesErr } = await supabase
        .from('classes')
        .select('id, name, code, grade_level, teacher_id')
        .order('name');

      if (classesErr) throw classesErr;

      // 2. Tải danh sách hồ sơ Giáo viên (role = teacher và !is_disabled)
      const { data: teachersData, error: teachersErr } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, is_disabled')
        .eq('role', 'teacher')
        .order('full_name');

      if (teachersErr) throw teachersErr;

      const activeTeachers = (teachersData || []).filter(t => !t.is_disabled);

      setClassesList(classesData || []);
      setTeachersList(activeTeachers);

      if (classesData && classesData.length > 0) {
        const firstClass = classesData[0];
        setSelectedClassId(firstClass.id);
        updateSelectedClassState(firstClass, activeTeachers);
      }
    } catch (err) {
      setErrorMessage('Lỗi khi tải dữ liệu phân công: ' + (err.message || String(err)));
    } finally {
      setIsLoading(false);
    }
  };

  const updateSelectedClassState = (targetClass, teachers) => {
    if (!targetClass) {
      setCurrentTeacherInfo(null);
      setSelectedTeacherId('');
      return;
    }

    const currentTeacherId = targetClass.teacher_id || '';
    setSelectedTeacherId(currentTeacherId);

    if (currentTeacherId) {
      const matchTeacher = teachers.find(t => t.id === currentTeacherId);
      setCurrentTeacherInfo(matchTeacher || { id: currentTeacherId, full_name: 'Giáo viên không xác định', email: '-' });
    } else {
      setCurrentTeacherInfo(null);
    }
  };

  const handleClassChange = (e) => {
    const classId = e.target.value;
    setSelectedClassId(classId);
    setErrorMessage('');
    setSuccessMessage('');

    const targetClass = classesList.find(c => c.id === classId);
    updateSelectedClassState(targetClass, teachersList);
  };

  const handleTeacherChange = (e) => {
    setSelectedTeacherId(e.target.value);
    setErrorMessage('');
    setSuccessMessage('');
  };

  const executeAssignTeacher = async (teacherIdToSet) => {
    if (!selectedClassId) {
      setErrorMessage('Vui lòng chọn Lớp học.');
      return;
    }

    const newTeacherId = teacherIdToSet || selectedTeacherId;
    if (!newTeacherId) {
      setErrorMessage('Vui lòng chọn Giáo viên phụ trách mới (Mỗi lớp luôn cần có 1 giáo viên phụ trách).');
      return;
    }

    try {
      setIsSaving(true);
      setErrorMessage('');
      setSuccessMessage('');

      const targetClass = classesList.find(c => c.id === selectedClassId);

      // Gọi duy nhất RPC admin_assign_teacher_to_class
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('admin_assign_teacher_to_class', {
        p_class_id: selectedClassId,
        p_teacher_id: newTeacherId
      });

      if (rpcErr) {
        throw rpcErr;
      }
      if (rpcRes && !rpcRes.success) {
        throw new Error(rpcRes.message || 'Phân công không thành công từ RPC server.');
      }

      // Cập nhật state nội bộ sau khi lưu thành công
      const updatedClasses = classesList.map(c => {
        if (c.id === selectedClassId) {
          return { ...c, teacher_id: newTeacherId };
        }
        return c;
      });

      setClassesList(updatedClasses);
      updateSelectedClassState(updatedClasses.find(c => c.id === selectedClassId), teachersList);

      setSuccessMessage(`Đã phân công giáo viên phụ trách lớp "${targetClass?.name}" thành công!`);
      setShowConfirmDialog(false);

      if (onSaved) {
        onSaved();
      }
    } catch (err) {
      setErrorMessage('Lỗi khi thực hiện phân công: ' + (err.message || String(err)));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveClick = () => {
    setErrorMessage('');
    setSuccessMessage('');

    if (!selectedTeacherId) {
      setErrorMessage('Vui lòng chọn Giáo viên mới phụ trách.');
      return;
    }

    const targetClass = classesList.find(c => c.id === selectedClassId);
    const currentTeacherId = targetClass?.teacher_id || '';

    // Kiểm tra nếu chuyển đổi từ Giáo viên A sang Giáo viên B khác
    if (currentTeacherId && selectedTeacherId && currentTeacherId !== selectedTeacherId) {
      setShowConfirmDialog(true);
      return;
    }

    executeAssignTeacher(selectedTeacherId);
  };

  if (!isOpen) return null;

  const targetClass = classesList.find(c => c.id === selectedClassId);
  const newTeacherObj = teachersList.find(t => t.id === selectedTeacherId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white w-full max-w-xl rounded-3xl border-4 border-sky-300 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* HEADER */}
        <div className="bg-gradient-to-r from-sky-500 to-indigo-600 px-6 py-4 text-white flex items-center justify-between border-b-4 border-sky-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center text-xl font-bold">
              👩‍🏫
            </div>
            <div>
              <h2 className="text-lg font-black tracking-wide">Phân Công Giáo Viên Cho Lớp</h2>
              <p className="text-xs text-sky-100 font-semibold">Chỉnh sửa duy nhất Giáo viên phụ trách (Giữ nguyên dữ liệu học sinh)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* BODY */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-10 space-y-3">
              <RefreshCw className="w-8 h-8 text-sky-600 animate-spin" />
              <p className="text-sm font-bold text-slate-600">Đang tải danh sách Lớp học và Giáo viên...</p>
            </div>
          ) : (
            <>
              {/* Thông báo Lỗi */}
              {errorMessage && (
                <div className="p-4 rounded-2xl bg-rose-50 border-2 border-rose-200 text-rose-700 text-xs font-extrabold flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 flex-shrink-0 text-rose-600" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Thông báo Thành công */}
              {successMessage && (
                <div className="p-4 rounded-2xl bg-emerald-50 border-2 border-emerald-200 text-emerald-700 text-xs font-extrabold flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-600" />
                  <span>{successMessage}</span>
                </div>
              )}

              {/* 1. CHỌN LỚP HỌC */}
              <div>
                <label className="block text-xs font-black uppercase text-slate-700 mb-1.5 flex items-center gap-1.5">
                  <School className="w-4 h-4 text-sky-600" /> 1. Chọn Lớp Học
                </label>
                <select
                  value={selectedClassId}
                  onChange={handleClassChange}
                  className="w-full px-4 py-3 rounded-2xl border-2 border-slate-200 bg-slate-50 font-bold text-sm text-slate-800 focus:border-sky-500 focus:bg-white outline-none transition-colors"
                >
                  {classesList.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} — Khối {c.grade_level || 1} {c.code ? `(${c.code})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* 2. GIÁO VIÊN HIỆN TẠI */}
              <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200">
                <label className="block text-[11px] font-black uppercase text-slate-500 mb-1">
                  2. Giáo viên phụ trách hiện tại
                </label>
                {currentTeacherInfo ? (
                  <div className="flex items-center gap-3 mt-1">
                    <div className="w-9 h-9 rounded-full bg-sky-100 border border-sky-300 flex items-center justify-center text-sky-700 font-black text-sm">
                      👩‍🏫
                    </div>
                    <div>
                      <p className="text-sm font-black text-slate-800">{currentTeacherInfo.full_name}</p>
                      <p className="text-xs font-mono text-slate-500">{currentTeacherInfo.email}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 mt-1 text-slate-500 font-bold text-xs italic">
                    <AlertCircle className="w-4 h-4 text-amber-500" /> Chưa có thông tin giáo viên phụ trách.
                  </div>
                )}
              </div>

              {/* 3. CHỌN GIÁO VIÊN MỚI */}
              <div>
                <label className="block text-xs font-black uppercase text-slate-700 mb-1.5 flex items-center gap-1.5">
                  <User className="w-4 h-4 text-indigo-600" /> 3. Chọn Giáo Viên Phụ Trách Mới
                </label>
                <select
                  value={selectedTeacherId}
                  onChange={handleTeacherChange}
                  className="w-full px-4 py-3 rounded-2xl border-2 border-slate-200 bg-slate-50 font-bold text-sm text-slate-800 focus:border-indigo-500 focus:bg-white outline-none transition-colors"
                >
                  <option value="" disabled>-- Chọn giáo viên từ danh sách --</option>
                  {teachersList.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.full_name} ({t.email})
                    </option>
                  ))}
                </select>
              </div>

              {/* KHỦNG XÁC NHẬN CHUYỂN ĐỔI */}
              {showConfirmDialog && (
                <div className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-300 text-amber-900 text-xs font-bold space-y-3 animate-fadeIn">
                  <div className="flex items-start gap-2.5">
                    <ShieldAlert className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-black text-amber-950">Xác Nhận Thay Đổi Giáo Viên Phụ Trách</p>
                      <p className="mt-1 leading-relaxed">
                        Bạn đang thay đổi giáo viên phụ trách lớp <span className="font-black underline">{targetClass?.name}</span> từ{' '}
                        <span className="font-black text-rose-700">{currentTeacherInfo?.full_name || 'Chưa có'}</span> sang{' '}
                        <span className="font-black text-emerald-700">{newTeacherObj?.full_name || 'Giáo viên mới'}</span>.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-amber-200">
                    <button
                      onClick={() => setShowConfirmDialog(false)}
                      className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-black text-xs"
                    >
                      Hủy Bỏ
                    </button>
                    <button
                      onClick={() => executeAssignTeacher(selectedTeacherId)}
                      disabled={isSaving}
                      className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-black text-xs shadow-md"
                    >
                      Xác Nhận Thay Đổi
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* FOOTER - KHÔNG CÒN NÚT HỦY PHÂN CÔNG */}
        <div className="p-4 bg-slate-50 border-t-2 border-slate-200 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-black text-xs rounded-2xl transition-colors"
          >
            Đóng
          </button>
          <button
            type="button"
            onClick={handleSaveClick}
            disabled={isSaving || isLoading || !selectedClassId || !selectedTeacherId}
            className="px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-50 font-black text-xs rounded-2xl border-b-4 border-sky-800 shadow-md flex items-center gap-2 active:translate-y-0.5"
          >
            {isSaving ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" /> Đang Lưu...
              </>
            ) : (
              <>
                <UserCheck className="w-4 h-4" /> Lưu Phân Công
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
