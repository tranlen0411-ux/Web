import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import {
  UserCheck,
  ShieldAlert,
  CheckCircle2,
  X,
  School,
  User,
  AlertCircle,
  RefreshCw,
  UserMinus,
  CheckSquare,
  Square
} from 'lucide-react';
import { useSound } from '../../context/SoundContext';

export function AssignTeacherModal({
  isOpen,
  onClose,
  onSaved,
  classesList: initialClasses = null,
  teachersList: initialTeachers = null
}) {
  const { triggerSound } = useSound();

  const [classesList, setClassesList] = useState([]);
  const [teachersList, setTeachersList] = useState([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState('');
  const [selectedClassIds, setSelectedClassIds] = useState(new Set());
  const [initialTeacherClassIds, setInitialTeacherClassIds] = useState(new Set());

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [showConfirmReassign, setShowConfirmReassign] = useState(false);
  const [reassignedClassesList, setReassignedClassesList] = useState([]);

  useEffect(() => {
    if (isOpen) {
      fetchInitialData();
    } else {
      setSelectedTeacherId('');
      setSelectedClassIds(new Set());
      setInitialTeacherClassIds(new Set());
      setErrorMessage('');
      setSuccessMessage('');
      setShowConfirmReassign(false);
      setReassignedClassesList([]);
    }
  }, [isOpen]);

  const fetchInitialData = async () => {
    try {
      setIsLoading(true);
      setErrorMessage('');

      let classesData = initialClasses;
      let teachersData = initialTeachers;

      if (!classesData || classesData.length === 0) {
        const { data: cData, error: classesErr } = await supabase
          .from('classes')
          .select('id, name, code, grade_level, teacher_id')
          .order('grade_level')
          .order('name');
        if (classesErr) throw classesErr;
        classesData = cData || [];
      }

      if (!teachersData || teachersData.length === 0) {
        const { data: tData, error: teachersErr } = await supabase
          .from('profiles')
          .select('id, full_name, email, role, is_disabled')
          .eq('role', 'teacher')
          .order('full_name');
        if (teachersErr) throw teachersErr;
        teachersData = (tData || []).filter(t => !t.is_disabled);
      }

      const activeTeachers = (teachersData || []).filter(t => !t.is_disabled);
      setClassesList(classesData || []);
      setTeachersList(activeTeachers);

      if (activeTeachers.length > 0) {
        const firstTeacher = activeTeachers[0];
        setSelectedTeacherId(firstTeacher.id);
        updateTeacherClassesSelection(firstTeacher.id, classesData || []);
      }
    } catch (err) {
      setErrorMessage('Lỗi khi tải dữ liệu phân công: ' + (err.message || String(err)));
    } finally {
      setIsLoading(false);
    }
  };

  const updateTeacherClassesSelection = (teacherId, classes) => {
    const assignedIds = new Set();
    (classes || []).forEach(c => {
      if (c.teacher_id === teacherId) {
        assignedIds.add(c.id);
      }
    });
    setSelectedClassIds(new Set(assignedIds));
    setInitialTeacherClassIds(new Set(assignedIds));
  };

  const handleTeacherChange = (e) => {
    const teacherId = e.target.value;
    setSelectedTeacherId(teacherId);
    setErrorMessage('');
    setSuccessMessage('');
    setShowConfirmReassign(false);
    updateTeacherClassesSelection(teacherId, classesList);
  };

  const handleToggleClass = (classId) => {
    const newSet = new Set(selectedClassIds);
    if (newSet.has(classId)) {
      newSet.delete(classId);
    } else {
      newSet.add(classId);
    }
    setSelectedClassIds(newSet);
    setErrorMessage('');
    setSuccessMessage('');
    setShowConfirmReassign(false);
  };

  const handleSelectAllClasses = () => {
    if (selectedClassIds.size === classesList.length) {
      setSelectedClassIds(new Set());
    } else {
      setSelectedClassIds(new Set(classesList.map(c => c.id)));
    }
  };

  // Gỡ phân công nhanh cho 1 lớp cụ thể
  const handleUnassignSingleClass = async (classItem) => {
    try {
      setIsSaving(true);
      setErrorMessage('');
      setSuccessMessage('');

      const { data, error } = await supabase.rpc('remove_teacher_from_class', {
        p_teacher_id: classItem.teacher_id,
        p_class_id: classItem.id
      });

      if (error) throw error;
      if (data && !data.success) {
        throw new Error(data.message || 'Không thể gỡ giáo viên khỏi lớp.');
      }

      triggerSound('click');
      const updatedClasses = classesList.map(c => {
        if (c.id === classItem.id) {
          return { ...c, teacher_id: null };
        }
        return c;
      });
      setClassesList(updatedClasses);

      const newSelected = new Set(selectedClassIds);
      newSelected.delete(classItem.id);
      setSelectedClassIds(newSelected);

      setSuccessMessage(`Đã gỡ giáo viên phụ trách khỏi lớp "${classItem.name}" thành công!`);

      if (onSaved) {
        onSaved();
      }
    } catch (err) {
      triggerSound('error');
      setErrorMessage('Lỗi khi gỡ giáo viên: ' + (err.message || String(err)));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveClick = () => {
    setErrorMessage('');
    setSuccessMessage('');

    if (!selectedTeacherId) {
      setErrorMessage('Vui lòng chọn Giáo viên phụ trách.');
      return;
    }

    // Kiểm tra xem có lớp nào được chọn đang thuộc về giáo viên khác không
    const otherTeacherClasses = [];
    selectedClassIds.forEach(cId => {
      const cls = classesList.find(c => c.id === cId);
      if (cls && cls.teacher_id && cls.teacher_id !== selectedTeacherId) {
        const currentTeacher = teachersList.find(t => t.id === cls.teacher_id);
        otherTeacherClasses.push({
          className: cls.name,
          currentTeacherName: currentTeacher?.full_name || 'Giáo viên khác'
        });
      }
    });

    if (otherTeacherClasses.length > 0) {
      setReassignedClassesList(otherTeacherClasses);
      setShowConfirmReassign(true);
      return;
    }

    executeAssignTeacher();
  };

  const executeAssignTeacher = async () => {
    try {
      setIsSaving(true);
      setErrorMessage('');
      setSuccessMessage('');

      const classIdsArray = Array.from(selectedClassIds);

      // Gọi duy nhất 1 RPC đồng bộ toàn bộ danh sách lớp của giáo viên (Atomic 100%)
      const { data: assignRes, error: assignErr } = await supabase.rpc('assign_teacher_to_classes', {
        p_teacher_id: selectedTeacherId,
        p_class_ids: classIdsArray
      });

      if (assignErr) throw assignErr;
      if (assignRes && !assignRes.success) {
        throw new Error(assignRes.message || 'Phân công không thành công.');
      }

      // Cập nhật state nội bộ sau khi RPC thành công
      const updatedClasses = classesList.map(c => {
        if (selectedClassIds.has(c.id)) {
          return { ...c, teacher_id: selectedTeacherId };
        } else if (c.teacher_id === selectedTeacherId) {
          return { ...c, teacher_id: null };
        }
        return c;
      });

      setClassesList(updatedClasses);
      setInitialTeacherClassIds(new Set(selectedClassIds));

      const teacherObj = teachersList.find(t => t.id === selectedTeacherId);
      triggerSound('victory');
      setSuccessMessage(`Đã cập nhật phân công lớp cho giáo viên ${teacherObj?.full_name || ''} thành công!`);
      setShowConfirmReassign(false);

      if (onSaved) {
        onSaved();
      }

      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err) {
      triggerSound('error');
      setErrorMessage('Lỗi khi thực hiện phân công: ' + (err.message || String(err)));
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  const currentTeacherObj = teachersList.find(t => t.id === selectedTeacherId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white w-full max-w-2xl rounded-3xl border-4 border-sky-300 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* HEADER */}
        <div className="bg-gradient-to-r from-sky-500 to-indigo-600 px-6 py-4 text-white flex items-center justify-between border-b-4 border-sky-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center text-xl font-bold">
              👩‍🏫
            </div>
            <div>
              <h2 className="text-lg font-black tracking-wide">Phân Công Giáo Viên Cho Lớp Học</h2>
              <p className="text-xs text-sky-100 font-semibold">Gán một hoặc nhiều lớp cho giáo viên phụ trách (Không ảnh hưởng dữ liệu học sinh)</p>
            </div>
          </div>
          <button
            onClick={() => {
              triggerSound('click');
              onClose();
            }}
            className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
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

              {/* 1. CHỌN GIÁO VIÊN */}
              <div>
                <label className="block text-xs font-black uppercase text-slate-700 mb-1.5 flex items-center gap-1.5">
                  <User className="w-4 h-4 text-indigo-600" /> 1. Chọn Giáo Viên Phụ Trách
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

              {/* 2. DANH SÁCH LỚP HỌC (MULTI-CHECKBOX) */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-black uppercase text-slate-700 flex items-center gap-1.5">
                    <School className="w-4 h-4 text-sky-600" /> 2. Danh Sách Lớp Phụ Trách ({selectedClassIds.size}/{classesList.length} lớp đã chọn)
                  </label>
                  <button
                    type="button"
                    onClick={handleSelectAllClasses}
                    className="text-xs font-bold text-sky-600 hover:text-sky-800 transition-colors cursor-pointer"
                  >
                    {selectedClassIds.size === classesList.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                  </button>
                </div>

                <div className="border-2 border-slate-200 rounded-2xl p-2 max-h-64 overflow-y-auto space-y-1.5 bg-slate-50/50 divide-y divide-slate-100">
                  {classesList.map(cls => {
                    const isChecked = selectedClassIds.has(cls.id);
                    const isCurrentTeacher = cls.teacher_id === selectedTeacherId;
                    const isOtherTeacher = cls.teacher_id && cls.teacher_id !== selectedTeacherId;
                    const assignedTeacher = teachersList.find(t => t.id === cls.teacher_id);

                    return (
                      <div
                        key={cls.id}
                        className={`pt-1.5 first:pt-0 flex items-center justify-between p-2 rounded-xl transition-colors ${
                          isChecked ? 'bg-sky-50/80 border border-sky-200' : 'hover:bg-slate-100'
                        }`}
                      >
                        <label className="flex items-center gap-3 flex-1 cursor-pointer min-w-0">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleClass(cls.id)}
                            className="hidden"
                          />
                          <div className="text-sky-600 flex-shrink-0">
                            {isChecked ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-slate-400" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-black text-slate-800">{cls.name}</span>
                              <span className="px-1.5 py-0.5 bg-slate-200 text-slate-700 font-bold text-[10px] rounded">
                                Khối {cls.grade_level || 1}
                              </span>
                            </div>
                            <div className="text-[11px] mt-0.5">
                              {isCurrentTeacher ? (
                                <span className="text-emerald-700 font-bold">
                                  ✓ Đang do giáo viên này phụ trách
                                </span>
                              ) : isOtherTeacher ? (
                                <span className="text-amber-700 font-semibold">
                                  ⚠️ Đang do: <strong className="font-black">{assignedTeacher?.full_name || 'GV khác'}</strong>
                                </span>
                              ) : (
                                <span className="text-slate-400 italic">
                                  Chưa phân công giáo viên
                                </span>
                              )}
                            </div>
                          </div>
                        </label>

                        {cls.teacher_id && (
                          <button
                            type="button"
                            onClick={() => handleUnassignSingleClass(cls)}
                            disabled={isSaving}
                            className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-black text-[10px] rounded-lg transition-colors cursor-pointer flex-shrink-0"
                            title="Gỡ giáo viên phụ trách khỏi lớp này"
                          >
                            <UserMinus className="w-3 h-3 inline mr-1" /> Gỡ GV
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* KHUNG CẢNH BÁO THAY ĐỔI GIÁO VIÊN */}
              {showConfirmReassign && reassignedClassesList.length > 0 && (
                <div className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-300 text-amber-900 text-xs font-bold space-y-3 animate-fadeIn">
                  <div className="flex items-start gap-2.5">
                    <ShieldAlert className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-black text-amber-950">Xác Nhận Thay Đổi Giáo Viên Phụ Trách</p>
                      <p className="mt-1 leading-relaxed">
                        Các lớp sau đây đang được phụ trách bởi giáo viên khác. Bạn có chắc chắn muốn chuyển giao sang{' '}
                        <span className="font-black text-indigo-700">{currentTeacherObj?.full_name}</span>?
                      </p>
                      <ul className="list-disc list-inside mt-1.5 space-y-0.5 text-slate-700">
                        {reassignedClassesList.map((rc, idx) => (
                          <li key={idx}>
                            Lớp <span className="font-black">{rc.className}</span> (Hiện tại: <span className="font-bold text-rose-700">{rc.currentTeacherName}</span>)
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-amber-200">
                    <button
                      type="button"
                      onClick={() => setShowConfirmReassign(false)}
                      className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-black text-xs cursor-pointer"
                    >
                      Hủy Bỏ
                    </button>
                    <button
                      type="button"
                      onClick={executeAssignTeacher}
                      disabled={isSaving}
                      className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-black text-xs shadow-md cursor-pointer"
                    >
                      Xác Nhận Thay Đổi
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* FOOTER */}
        <div className="p-4 bg-slate-50 border-t-2 border-slate-200 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              triggerSound('click');
              onClose();
            }}
            className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-black text-xs rounded-2xl transition-colors cursor-pointer"
          >
            Đóng
          </button>
          <button
            type="button"
            onClick={handleSaveClick}
            disabled={isSaving || isLoading || !selectedTeacherId}
            className="px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-50 font-black text-xs rounded-2xl border-b-4 border-sky-800 shadow-md flex items-center gap-2 active:translate-y-0.5 cursor-pointer"
          >
            {isSaving ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" /> Đang Lưu Phân Công...
              </>
            ) : (
              <>
                <UserCheck className="w-4 h-4" /> Lưu Phân Công ({selectedClassIds.size} Lớp)
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
