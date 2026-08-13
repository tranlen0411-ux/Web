import React, { useState, useEffect } from 'react';
import { X, AlertTriangle, Lock, Trash2, ShieldAlert } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export const UserDeleteModal = ({ isOpen, onClose, userToDelete, teachersList, onActionCompleted }) => {
  const [ownedClassesCount, setOwnedClassesCount] = useState(0);
  const [selectedNewTeacher, setSelectedNewTeacher] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (userToDelete && userToDelete.role === 'teacher') {
      checkTeacherClasses(userToDelete.id);
    } else {
      setOwnedClassesCount(0);
    }
    setSelectedNewTeacher('');
    setErrorMsg('');
  }, [userToDelete, isOpen]);

  const checkTeacherClasses = async (teacherId) => {
    try {
      const { count, error } = await supabase
        .from('classes')
        .select('*', { count: 'exact', head: true })
        .eq('teacher_id', teacherId);

      if (!error) {
        setOwnedClassesCount(count || 0);
      }
    } catch (err) {
      console.error('Error checking teacher classes:', err);
    }
  };

  if (!isOpen || !userToDelete) return null;

  // Xử lý Khóa / Mở khóa tài khoản via Edge Function admin-toggle-status
  const handleToggleLock = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const { data, error } = await supabase.functions.invoke('admin-toggle-status', {
        body: {
          targetUserId: userToDelete.id,
          isDisabled: !userToDelete.is_disabled
        }
      });

      if (error) {
        throw new Error(error.message || 'Có lỗi khi gọi Edge Function admin-toggle-status');
      }

      if (!data?.success) {
        setErrorMsg(data?.message || 'Không thể thay đổi trạng thái khóa.');
        return;
      }

      onActionCompleted();
      onClose();
    } catch (err) {
      console.error('Toggle lock error:', err);
      setErrorMsg(err.message || 'Có lỗi xảy ra.');
    } finally {
      setLoading(false);
    }
  };

  // Xử lý Xóa vĩnh viễn via Edge Function admin-delete-user
  const handleDeletePermanent = async () => {
    if (ownedClassesCount > 0 && !selectedNewTeacher) {
      setErrorMsg('Vui lòng chọn Giáo viên mới để nhận chuyển giao lớp trước khi xóa.');
      return;
    }

    if (!window.confirm(`Bạn có CHẮC CHẮN muốn xóa vĩnh viễn tài khoản ${userToDelete.full_name}?`)) return;

    setLoading(true);
    setErrorMsg('');
    try {
      const { data, error } = await supabase.functions.invoke('admin-delete-user', {
        body: {
          targetUserId: userToDelete.id,
          reassignTeacherId: selectedNewTeacher || null
        }
      });

      if (error) {
        throw new Error(error.message || 'Có lỗi khi gọi Edge Function admin-delete-user');
      }

      if (!data?.success) {
        setErrorMsg(data?.message || 'Không thể xóa tài khoản.');
        return;
      }

      onActionCompleted();
      onClose();
    } catch (err) {
      console.error('Delete permanent error:', err);
      setErrorMsg(err.message || 'Có lỗi xảy ra.');
    } finally {
      setLoading(false);
    }
  };

  const availableTeachers = teachersList.filter(t => t.id !== userToDelete.id && !t.is_disabled);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white w-full max-w-md rounded-3xl border-4 border-amber-300 shadow-2xl overflow-hidden flex flex-col">
        
        {/* MODAL HEADER */}
        <div className="bg-gradient-to-r from-rose-600 to-amber-700 p-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center border border-white/30">
              <AlertTriangle className="w-5 h-5 text-amber-200" />
            </div>
            <div>
              <h3 className="font-black text-lg leading-tight">Quản Lý Tài Khoản</h3>
              <p className="text-xs text-amber-100 font-bold">{userToDelete.full_name} ({userToDelete.email})</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-full text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* MODAL BODY */}
        <div className="p-6 space-y-4">

          {errorMsg && (
            <div className="p-3 bg-rose-50 border-2 border-rose-300 text-rose-800 rounded-2xl text-xs font-bold flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-600 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* CẢNH BÁO LỚP HỌC ĐANG QUẢN LÝ NẾU LÀ GIÁO VIÊN */}
          {ownedClassesCount > 0 && (
            <div className="p-4 bg-amber-50 border-2 border-amber-300 rounded-2xl text-amber-900 text-xs font-bold space-y-2">
              <p className="font-black text-amber-950 flex items-center gap-1.5 text-sm">
                ⚠️ Giáo viên này đang quản lý {ownedClassesCount} lớp học!
              </p>
              <p>
                Nếu xóa vĩnh viễn, bạn cần chọn Giáo viên nhận chuyển giao các lớp học này để tránh làm mất tiến độ học sinh.
              </p>

              <div className="pt-2">
                <label className="block text-xs font-black text-slate-700 uppercase mb-1">
                  Chọn Giáo Viên Nhận Lớp:
                </label>
                <select
                  value={selectedNewTeacher}
                  onChange={(e) => setSelectedNewTeacher(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border-2 border-amber-300 bg-white font-bold text-xs"
                >
                  <option value="">-- Chọn Giáo Viên Thay Thế --</option>
                  {availableTeachers.map(t => (
                    <option key={t.id} value={t.id}>{t.full_name} ({t.email})</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* LỜI KHUYÊN KHÓA TÀI KHOẢN AN TOÀN */}
          <div className="p-3 bg-sky-50 border-2 border-sky-200 text-sky-900 rounded-2xl text-xs font-bold">
            <p className="font-black text-sky-950">💡 Lựa chọn an toàn:</p>
            <p className="mt-0.5">
              Khóa tài khoản sẽ chặn đăng nhập nhưng <strong>giữ nguyên 100% Lớp học, Tiến độ, Điểm số, Sao & Xu</strong>.
            </p>
          </div>

          {/* ACTIONS */}
          <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-4 border-t border-amber-100">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs rounded-2xl"
            >
              Hủy
            </button>

            {/* BUTTON KHÓA / MỞ KHÓA */}
            <button
              type="button"
              disabled={loading}
              onClick={handleToggleLock}
              className={`w-full sm:w-auto px-4 py-2.5 font-black text-xs rounded-2xl shadow-sm flex items-center justify-center gap-1.5 ${
                userToDelete.is_disabled
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : 'bg-amber-500 hover:bg-amber-600 text-white'
              }`}
            >
              <Lock className="w-4 h-4" />
              {userToDelete.is_disabled ? 'Mở Khóa Tài Khoản' : 'Khóa Tài Khoản (An Toàn)'}
            </button>

            {/* BUTTON XÓA VĨNH VIỄN */}
            <button
              type="button"
              disabled={loading}
              onClick={handleDeletePermanent}
              className="w-full sm:w-auto px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-black text-xs rounded-2xl shadow-sm flex items-center justify-center gap-1.5"
            >
              <Trash2 className="w-4 h-4" />
              Xóa Vĩnh Viễn
            </button>
          </div>

        </div>

      </div>
    </div>
  );
};
