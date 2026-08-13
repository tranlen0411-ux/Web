import React, { useState, useEffect } from 'react';
import { X, UserPlus, Save, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export const UserFormModal = ({ isOpen, onClose, userToEdit, onSaved }) => {
  const isEditMode = !!userToEdit;

  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '123456',
    role: 'student',
    gradeLevel: 1,
    totalStars: 0,
    totalCoins: 0,
  });

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (userToEdit) {
      setFormData({
        fullName: userToEdit.full_name || '',
        email: userToEdit.email || '',
        password: '',
        role: userToEdit.role || 'student',
        gradeLevel: userToEdit.grade_level || 1,
        totalStars: userToEdit.total_stars || 0,
        totalCoins: userToEdit.total_coins || 0,
      });
    } else {
      setFormData({
        fullName: '',
        email: '',
        password: '123456',
        role: 'student',
        gradeLevel: 1,
        totalStars: 0,
        totalCoins: 0,
      });
    }
    setErrorMsg('');
    setSuccessMsg('');
  }, [userToEdit, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      if (isEditMode) {
        // Mode CHỈNH SỬA TÀI KHOẢN (gọi RPC admin_update_profile)
        const { data, error } = await supabase.rpc('admin_update_profile', {
          p_target_user_id: userToEdit.id,
          p_full_name: formData.fullName,
          p_role: formData.role,
          p_grade_level: parseInt(formData.gradeLevel),
          p_total_stars: parseInt(formData.totalStars),
          p_total_coins: parseInt(formData.totalCoins),
        });

        if (error) throw error;
        if (!data?.success) {
          setErrorMsg(data?.message || 'Có lỗi xảy ra khi cập nhật.');
          return;
        }

        setSuccessMsg(data.message || 'Cập nhật thành công!');
        setTimeout(() => {
          onSaved();
          onClose();
        }, 800);
      } else {
        // Mode THÊM MỚI TÀI KHOẢN
        if (!formData.fullName.trim()) {
          setErrorMsg('Vui lòng nhập Họ và Tên.');
          setLoading(false);
          return;
        }

        if (!formData.email.trim()) {
          setErrorMsg('Vui lòng nhập địa chỉ Email.');
          setLoading(false);
          return;
        }

        if (formData.password.length < 6) {
          setErrorMsg('Mật khẩu tối thiểu phải từ 6 ký tự.');
          setLoading(false);
          return;
        }

        // Gọi trực tiếp Supabase Edge Function admin-create-user (Admin API createUser)
        const { data, error } = await supabase.functions.invoke('admin-create-user', {
          body: {
            email: formData.email.trim(),
            password: formData.password,
            fullName: formData.fullName.trim(),
            role: formData.role,
            gradeLevel: parseInt(formData.gradeLevel),
          }
        });

        if (error) {
          throw new Error(error.message || 'Có lỗi khi gọi Edge Function admin-create-user');
        }

        if (!data?.success) {
          setErrorMsg(data?.message || 'Không thể tạo tài khoản.');
          return;
        }

        setSuccessMsg(data.message || 'Thêm tài khoản mới thành công!');
        setTimeout(() => {
          onSaved();
          onClose();
        }, 800);
      }
    } catch (err) {
      console.error('User form submit error:', err);
      setErrorMsg(err.message || 'Có lỗi xảy ra trong quá trình xử lý.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white w-full max-w-lg rounded-3xl border-4 border-amber-300 shadow-2xl overflow-hidden flex flex-col">
        
        {/* MODAL HEADER */}
        <div className="bg-gradient-to-r from-purple-700 to-indigo-800 p-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/30 flex items-center justify-center border border-purple-300/40">
              {isEditMode ? <Save className="w-5 h-5 text-amber-300" /> : <UserPlus className="w-5 h-5 text-amber-300" />}
            </div>
            <div>
              <h3 className="font-black text-lg sm:text-xl leading-tight">
                {isEditMode ? 'Chỉnh Sửa Thông Tin Tài Khoản' : '+ Thêm Tài Khoản Mới'}
              </h3>
              <p className="text-xs text-purple-200 font-bold">
                {isEditMode ? `Cập nhật thông tin cho (${userToEdit.email})` : 'Tạo mới qua Edge Function admin-create-user'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/20 rounded-full text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* MODAL BODY */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          
          {errorMsg && (
            <div className="p-3 bg-rose-50 border-2 border-rose-300 text-rose-800 rounded-2xl text-xs font-bold flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-600 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 bg-emerald-50 border-2 border-emerald-300 text-emerald-800 rounded-2xl text-xs font-bold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* HỌ VÀ TÊN */}
          <div>
            <label className="block text-xs font-black text-slate-700 uppercase mb-1">
              Họ và Tên <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={formData.fullName}
              onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
              placeholder="VD: Nguyen Van A"
              className="w-full px-4 py-2.5 rounded-2xl border-2 border-amber-200 focus:border-purple-600 focus:outline-none text-xs font-bold"
            />
          </div>

          {/* EMAIL */}
          <div>
            <label className="block text-xs font-black text-slate-700 uppercase mb-1">
              Địa chỉ Email <span className="text-rose-500">*</span>
            </label>
            <input
              type="email"
              required
              disabled={isEditMode}
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="VD: hs_an@hoclapvui.edu.vn"
              className={`w-full px-4 py-2.5 rounded-2xl border-2 border-amber-200 focus:border-purple-600 focus:outline-none text-xs font-bold ${
                isEditMode ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : ''
              }`}
            />
          </div>

          {/* MẬT KHẨU BAN ĐẦU (CHỈ KHI THÊM MỚI) */}
          {!isEditMode && (
            <div>
              <label className="block text-xs font-black text-slate-700 uppercase mb-1">
                Mật Khẩu Mặc Định <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                minLength={6}
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="Tối thiểu 6 ký tự (VD: 123456)"
                className="w-full px-4 py-2.5 rounded-2xl border-2 border-amber-200 focus:border-purple-600 focus:outline-none text-xs font-bold font-mono"
              />
            </div>
          )}

          {/* VAI TRÒ & KHỐI LỚP */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-black text-slate-700 uppercase mb-1">
                Vai Trò <span className="text-rose-500">*</span>
              </label>
              <select
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                className="w-full px-4 py-2.5 rounded-2xl border-2 border-amber-200 focus:border-purple-600 focus:outline-none text-xs font-bold bg-white"
              >
                <option value="student">🎓 Học Sinh (Student)</option>
                <option value="teacher">👩‍🏫 Giáo Viên (Teacher)</option>
                {isEditMode && <option value="admin">🛡️ Quản Trị (Admin)</option>}
              </select>
            </div>

            <div>
              <label className="block text-xs font-black text-slate-700 uppercase mb-1">
                Khối Lớp <span className="text-rose-500">*</span>
              </label>
              <select
                value={formData.gradeLevel}
                onChange={(e) => setFormData({ ...formData, gradeLevel: e.target.value })}
                className="w-full px-4 py-2.5 rounded-2xl border-2 border-amber-200 focus:border-purple-600 focus:outline-none text-xs font-bold bg-white"
              >
                <option value={1}>Khối 1</option>
                <option value={2}>Khối 2</option>
                <option value={3}>Khối 3</option>
                <option value={4}>Khối 4</option>
                <option value={5}>Khối 5</option>
              </select>
            </div>
          </div>

          {/* TỔNG SAO VÀ TỔNG XU (CHỈ KHI EDIT) */}
          {isEditMode && (
            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-amber-100">
              <div>
                <label className="block text-xs font-black text-amber-700 uppercase mb-1">
                  🌟 Tổng Số Sao
                </label>
                <input
                  type="number"
                  min={0}
                  value={formData.totalStars}
                  onChange={(e) => setFormData({ ...formData, totalStars: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-2xl border-2 border-amber-200 focus:border-purple-600 focus:outline-none text-xs font-extrabold text-amber-900"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-amber-700 uppercase mb-1">
                  🪙 Tổng Số Xu
                </label>
                <input
                  type="number"
                  min={0}
                  value={formData.totalCoins}
                  onChange={(e) => setFormData({ ...formData, totalCoins: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-2xl border-2 border-amber-200 focus:border-purple-600 focus:outline-none text-xs font-extrabold text-amber-900"
                />
              </div>
            </div>
          )}

          {/* ACTIONS */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-amber-100">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs rounded-2xl"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-black text-xs rounded-2xl shadow-md flex items-center gap-2 active:translate-y-0.5"
            >
              {loading ? (
                <span>Đang xử lý...</span>
              ) : isEditMode ? (
                <>
                  <Save className="w-4 h-4" /> Lưu Thay Đổi
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" /> Tạo Tài Khoản
                </>
              )}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
};
