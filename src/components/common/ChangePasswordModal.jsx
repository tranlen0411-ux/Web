import React, { useState } from 'react';
import { X, Lock, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useSound } from '../../context/SoundContext';

export const ChangePasswordModal = ({ isOpen, onClose }) => {
  const { triggerSound } = useSound();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState({ type: '', text: '' });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMsg({ type: '', text: '' });

    if (newPassword.length < 6) {
      setMsg({ type: 'error', text: 'Mật khẩu mới phải có ít nhất 6 ký tự!' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setMsg({ type: 'error', text: 'Mật khẩu xác nhận không trùng khớp!' });
      return;
    }

    setLoading(true);
    triggerSound('click');
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) throw error;

      triggerSound('victory');
      setMsg({ type: 'success', text: '🎉 Đổi mật khẩu thành công!' });
      setTimeout(() => {
        setNewPassword('');
        setConfirmPassword('');
        setMsg({ type: '', text: '' });
        onClose();
      }, 1500);
    } catch (err) {
      console.error('Change password error:', err);
      setMsg({ type: 'error', text: err.message || 'Không thể đổi mật khẩu.' });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-md bg-white rounded-3xl border-4 border-amber-300 p-6 shadow-2xl">
        
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 bg-slate-100 rounded-full hover:bg-slate-200 text-slate-500"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-xl font-black text-amber-900 mb-1 flex items-center gap-2">
          <Lock className="w-6 h-6 text-amber-600" /> Đổi Mật Khẩu Tài Khoản
        </h3>
        <p className="text-xs font-bold text-slate-500 mb-4">
          Nhập mật khẩu mới để bảo mật tài khoản Supabase của bạn.
        </p>

        {msg.text && (
          <div className={`p-3 rounded-xl border-2 text-xs font-bold mb-4 flex items-center gap-2 ${
            msg.type === 'success' ? 'bg-emerald-100 border-emerald-300 text-emerald-900' : 'bg-rose-100 border-rose-300 text-rose-900'
          }`}>
            {msg.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertCircle className="w-4 h-4 text-rose-600" />}
            <span>{msg.text}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-black text-slate-700 mb-1">Mật khẩu mới:</label>
            <input
              type="password"
              placeholder="Ít nhất 6 ký tự..."
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl font-bold text-sm text-slate-800"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-black text-slate-700 mb-1">Xác nhận mật khẩu mới:</label>
            <input
              type="password"
              placeholder="Gõ lại mật khẩu mới..."
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl font-bold text-sm text-slate-800"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-black text-sm rounded-2xl border-b-4 border-amber-700 shadow-md active:translate-y-0.5"
          >
            {loading ? 'Đang Đổi Mật Khẩu...' : '🚀 LƯU MẬT KHẨU MỚI'}
          </button>
        </form>

      </div>
    </div>
  );
};
