import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import {
  School,
  User,
  CheckCircle2,
  X,
  AlertCircle,
  RefreshCw,
  ArrowRightLeft,
  UserMinus,
  UserCheck,
  ShieldAlert
} from 'lucide-react';
import { useSound } from '../../context/SoundContext';

export function StudentClassAssignmentModal({
  isOpen,
  onClose,
  student,
  currentClasses = [],
  classesList = [],
  onSaved
}) {
  const { triggerSound } = useSound();

  const [selectedClassId, setSelectedClassId] = useState('');
  const [reason, setReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [showConfirmTransfer, setShowConfirmTransfer] = useState(false);
  const [showConfirmRemove, setShowConfirmRemove] = useState(false);

  // Lớp active hiện tại của học sinh (nếu có)
  const currentClass = currentClasses && currentClasses.length > 0 ? currentClasses[0] : null;

  useEffect(() => {
    if (isOpen) {
      setErrorMessage('');
      setSuccessMessage('');
      setReason('');
      setShowConfirmTransfer(false);
      setShowConfirmRemove(false);

      if (currentClass) {
        // Mặc định chọn lớp hiện tại hoặc lớp đầu tiên khác nếu có
        setSelectedClassId(currentClass.id);
      } else if (classesList && classesList.length > 0) {
        setSelectedClassId(classesList[0].id);
      } else {
        setSelectedClassId('');
      }
    }
  }, [isOpen, student, currentClass, classesList]);

  if (!isOpen || !student) return null;

  const targetClassObj = (classesList || []).find(c => c.id === selectedClassId);
  const isTransfer = currentClass && selectedClassId && currentClass.id !== selectedClassId;
  const isAssign = !currentClass && selectedClassId;
  const isSameClass = currentClass && selectedClassId && currentClass.id === selectedClassId;

  // Thực hiện Xếp lớp mới (assign_student_to_class)
  const handleAssign = async () => {
    if (!selectedClassId) {
      setErrorMessage('Vui lòng chọn lớp học.');
      return;
    }

    try {
      setIsSaving(true);
      setErrorMessage('');
      setSuccessMessage('');

      const { data, error } = await supabase.rpc('assign_student_to_class', {
        p_student_id: student.id,
        p_class_id: selectedClassId,
        p_reason: reason.trim() || 'Admin xếp lớp cho học sinh'
      });

      if (error) throw error;
      if (data && !data.success) {
        throw new Error(data.message || 'Không thể xếp lớp cho học sinh.');
      }

      triggerSound('victory');
      setSuccessMessage(data.message || 'Đã xếp lớp thành công!');

      if (onSaved) {
        onSaved(student.id, selectedClassId, 'assign');
      }

      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err) {
      triggerSound('error');
      setErrorMessage('Lỗi khi xếp lớp: ' + (err.message || String(err)));
    } finally {
      setIsSaving(false);
    }
  };

  // Thực hiện Chuyển lớp (transfer_student_class)
  const handleTransfer = async () => {
    if (!selectedClassId || !currentClass) {
      setErrorMessage('Vui lòng chọn lớp đích hợp lệ.');
      return;
    }

    try {
      setIsSaving(true);
      setErrorMessage('');
      setSuccessMessage('');

      const { data, error } = await supabase.rpc('transfer_student_class', {
        p_student_id: student.id,
        p_from_class_id: currentClass.id,
        p_to_class_id: selectedClassId,
        p_reason: reason.trim() || `Chuyển từ lớp ${currentClass.name} sang ${targetClassObj?.name}`
      });

      if (error) throw error;
      if (data && !data.success) {
        throw new Error(data.message || 'Không thể chuyển lớp.');
      }

      triggerSound('victory');
      setSuccessMessage(data.message || 'Đã chuyển lớp thành công!');
      setShowConfirmTransfer(false);

      if (onSaved) {
        onSaved(student.id, selectedClassId, 'transfer');
      }

      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err) {
      triggerSound('error');
      setErrorMessage('Lỗi khi chuyển lớp: ' + (err.message || String(err)));
    } finally {
      setIsSaving(false);
    }
  };

  // Thực hiện Gỡ khỏi lớp (remove_student_from_class)
  const handleRemove = async () => {
    if (!currentClass) {
      setErrorMessage('Học sinh hiện chưa thuộc lớp nào.');
      return;
    }

    try {
      setIsSaving(true);
      setErrorMessage('');
      setSuccessMessage('');

      const { data, error } = await supabase.rpc('remove_student_from_class', {
        p_student_id: student.id,
        p_class_id: currentClass.id,
        p_reason: reason.trim() || 'Admin gỡ học sinh khỏi lớp'
      });

      if (error) throw error;
      if (data && !data.success) {
        throw new Error(data.message || 'Không thể gỡ học sinh khỏi lớp.');
      }

      triggerSound('click');
      setSuccessMessage(data.message || 'Đã gỡ học sinh khỏi lớp thành công!');
      setShowConfirmRemove(false);

      if (onSaved) {
        onSaved(student.id, null, 'remove');
      }

      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err) {
      triggerSound('error');
      setErrorMessage('Lỗi khi gỡ khỏi lớp: ' + (err.message || String(err)));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white w-full max-w-lg rounded-3xl border-4 border-sky-300 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* HEADER */}
        <div className="bg-gradient-to-r from-sky-500 to-indigo-600 px-6 py-4 text-white flex items-center justify-between border-b-4 border-sky-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center text-xl font-bold">
              🎓
            </div>
            <div>
              <h2 className="text-lg font-black tracking-wide">Quản Lý Lớp Học Sinh</h2>
              <p className="text-xs text-sky-100 font-semibold">Xếp lớp, chuyển lớp hoặc gỡ khỏi lớp (Lưu trọn vẹn lịch sử học tập)</p>
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

          {/* 1. THÔNG TIN HỌC SINH */}
          <div className="p-4 rounded-2xl bg-sky-50/70 border-2 border-sky-200 flex items-center gap-3.5">
            <img
              src={student.avatar_url || 'https://api.dicebear.com/7.x/bottts/svg?seed=Pikachu'}
              alt=""
              className="w-11 h-11 rounded-full bg-white border-2 border-sky-300 flex-shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-black text-slate-800 truncate">{student.full_name}</p>
                {student.student_code && (
                  <span className="px-2 py-0.5 bg-sky-200/80 text-sky-900 font-mono font-black text-[10px] rounded-lg">
                    {student.student_code}
                  </span>
                )}
              </div>
              <p className="text-xs font-mono text-slate-500 truncate">{student.email}</p>
            </div>
          </div>

          {/* 2. LỚP HIỆN TẠI */}
          <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200">
            <label className="block text-[11px] font-black uppercase text-slate-500 mb-1 flex items-center gap-1.5">
              <School className="w-4 h-4 text-slate-500" /> Lớp học hiện tại
            </label>
            {currentClass ? (
              <div className="flex items-center justify-between mt-1">
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 bg-emerald-100 text-emerald-800 font-black rounded-xl text-xs border border-emerald-300">
                    {currentClass.name} (Khối {currentClass.grade_level || 1})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    triggerSound('click');
                    setShowConfirmRemove(true);
                    setShowConfirmTransfer(false);
                  }}
                  disabled={isSaving}
                  className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 font-black text-xs rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <UserMinus className="w-3.5 h-3.5" /> Gỡ khỏi lớp
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 mt-1 text-slate-500 font-bold text-xs italic">
                <AlertCircle className="w-4 h-4 text-amber-500" /> Chưa được xếp lớp (NO_CLASS).
              </div>
            )}
          </div>

          {/* 3. CHỌN LỚP ĐÍCH */}
          <div>
            <label className="block text-xs font-black uppercase text-slate-700 mb-1.5 flex items-center gap-1.5">
              <School className="w-4 h-4 text-sky-600" /> {currentClass ? 'Chọn Lớp Mới Cần Chuyển Đến' : 'Chọn Lớp Cần Xếp'}
            </label>
            <select
              value={selectedClassId}
              onChange={(e) => {
                setSelectedClassId(e.target.value);
                setErrorMessage('');
                setShowConfirmTransfer(false);
                setShowConfirmRemove(false);
              }}
              className="w-full px-4 py-3 rounded-2xl border-2 border-slate-200 bg-slate-50 font-bold text-sm text-slate-800 focus:border-sky-500 focus:bg-white outline-none transition-colors"
            >
              <option value="" disabled>-- Chọn lớp học --</option>
              {classesList.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} — Khối {c.grade_level || 1} {c.code ? `(${c.code})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* 4. LÝ DO XẾP/CHUYỂN/GỠ LỚP (TÙY CHỌN) */}
          <div>
            <label className="block text-xs font-black uppercase text-slate-700 mb-1.5">
              Lý do điều chỉnh (Ghi chú lịch sử quản trị)
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="VD: Chuyển lớp đầu năm học, điều chỉnh theo yêu cầu..."
              className="w-full px-4 py-2.5 rounded-2xl border-2 border-slate-200 bg-slate-50 text-xs font-bold text-slate-800 focus:border-sky-500 focus:bg-white outline-none transition-colors"
            />
          </div>

          {/* KHUNG XÁC NHẬN CHUYỂN LỚP */}
          {showConfirmTransfer && (
            <div className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-300 text-amber-900 text-xs font-bold space-y-3 animate-fadeIn">
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-black text-amber-950">Xác Nhận Chuyển Lớp Cho Học Sinh</p>
                  <p className="mt-1 leading-relaxed">
                    Bạn có chắc chắn muốn chuyển học sinh <span className="font-black">{student.full_name}</span> từ lớp{' '}
                    <span className="font-black text-rose-700 underline">{currentClass?.name}</span> sang{' '}
                    <span className="font-black text-emerald-700 underline">{targetClassObj?.name}</span>?
                  </p>
                  <p className="text-[11px] text-slate-500 font-semibold mt-1">
                    * Toàn bộ điểm số, bài làm và lịch sử học tập trước đó của học sinh sẽ được giữ nguyên 100%.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-amber-200">
                <button
                  type="button"
                  onClick={() => setShowConfirmTransfer(false)}
                  className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-black text-xs cursor-pointer"
                >
                  Hủy Bỏ
                </button>
                <button
                  type="button"
                  onClick={handleTransfer}
                  disabled={isSaving}
                  className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-black text-xs shadow-md cursor-pointer flex items-center gap-1.5"
                >
                  {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ArrowRightLeft className="w-3.5 h-3.5" />}
                  Xác Nhận Chuyển Lớp
                </button>
              </div>
            </div>
          )}

          {/* KHUNG XÁC NHẬN GỠ KHỎI LỚP */}
          {showConfirmRemove && (
            <div className="p-4 rounded-2xl bg-rose-50 border-2 border-rose-300 text-rose-900 text-xs font-bold space-y-3 animate-fadeIn">
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-black text-rose-950">Xác Nhận Gỡ Học Sinh Khỏi Lớp</p>
                  <p className="mt-1 leading-relaxed">
                    Bạn có chắc chắn muốn gỡ học sinh <span className="font-black">{student.full_name}</span> ra khỏi lớp{' '}
                    <span className="font-black text-rose-700 underline">{currentClass?.name}</span>?
                  </p>
                  <p className="text-[11px] text-slate-500 font-semibold mt-1">
                    * Học sinh sẽ chuyển về trạng thái Chưa xếp lớp (NO_CLASS). Lịch sử học tập vẫn được bảo lưu trọn vẹn.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-rose-200">
                <button
                  type="button"
                  onClick={() => setShowConfirmRemove(false)}
                  className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-black text-xs cursor-pointer"
                >
                  Hủy Bỏ
                </button>
                <button
                  type="button"
                  onClick={handleRemove}
                  disabled={isSaving}
                  className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-black text-xs shadow-md cursor-pointer flex items-center gap-1.5"
                >
                  {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <UserMinus className="w-3.5 h-3.5" />}
                  Xác Nhận Gỡ Lớp
                </button>
              </div>
            </div>
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

          {isAssign && (
            <button
              type="button"
              onClick={handleAssign}
              disabled={isSaving || !selectedClassId}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 font-black text-xs rounded-2xl border-b-4 border-emerald-800 shadow-md flex items-center gap-2 active:translate-y-0.5 cursor-pointer"
            >
              {isSaving ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Đang Xếp Lớp...
                </>
              ) : (
                <>
                  <UserCheck className="w-4 h-4" /> Xếp Vào Lớp Này
                </>
              )}
            </button>
          )}

          {isTransfer && !showConfirmTransfer && (
            <button
              type="button"
              onClick={() => {
                triggerSound('click');
                setShowConfirmTransfer(true);
                setShowConfirmRemove(false);
              }}
              disabled={isSaving || !selectedClassId}
              className="px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-50 font-black text-xs rounded-2xl border-b-4 border-sky-800 shadow-md flex items-center gap-2 active:translate-y-0.5 cursor-pointer"
            >
              <ArrowRightLeft className="w-4 h-4" /> Chuyển Sang Lớp Này
            </button>
          )}

          {isSameClass && (
            <span className="text-xs font-bold text-slate-400 italic px-3 py-2">
              Học sinh đã thuộc lớp này
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
