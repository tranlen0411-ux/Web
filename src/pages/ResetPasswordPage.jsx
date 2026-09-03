import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, KeyRound, CheckCircle2, AlertCircle, Eye, EyeOff, ArrowLeft, RefreshCw, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useSound } from '../context/SoundContext';

export const ResetPasswordPage = () => {
  const { loading: authLoading, isPasswordRecovery, clearPasswordRecoveryState } = useAuth();
  const { triggerSound } = useSound();
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    // FIX-03: Defense-in-depth submit guard
    if (!isPasswordRecovery) {
      setErrorMsg('Phiên đặt lại mật khẩu không còn hợp lệ.');
      return;
    }

    if (newPassword.length < 6) {
      setErrorMsg('Mật khẩu mới phải có ít nhất 6 ký tự.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg('Mật khẩu xác nhận không trùng khớp.');
      return;
    }

    setSubmitting(true);
    triggerSound('click');

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      // FIX-02: Sanitize error mapping without exposing raw error.message
      if (error) {
        setSubmitting(false);
        const isWeakOrShort =
          error.message?.toLowerCase().includes('password') ||
          error.message?.toLowerCase().includes('characters') ||
          error.code === 'weak_password';
        if (isWeakOrShort) {
          setErrorMsg('Mật khẩu mới chưa đáp ứng yêu cầu bảo mật. Vui lòng chọn mật khẩu mạnh hơn.');
        } else {
          setErrorMsg('Không thể cập nhật mật khẩu. Vui lòng thử lại.');
        }
        return;
      }

      triggerSound('victory');

      // 1. Xóa trạng thái recovery
      clearPasswordRecoveryState();

      // 2. FIX-04: Đăng xuất phiên làm việc tạm thời và kiểm tra kết quả
      const { error: signOutError } = await supabase.auth.signOut();

      if (signOutError) {
        setSubmitting(false);
        setErrorMsg('Mật khẩu đã được đổi, nhưng phiên đăng nhập chưa thể kết thúc. Vui lòng thử đăng xuất lại.');
        return;
      }

      // 3. Điều hướng về /auth kèm thông báo thành công
      navigate('/auth', {
        state: { message: 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại bằng mật khẩu mới.' },
        replace: true
      });
    } catch (_err) {
      setSubmitting(false);
      setErrorMsg('Không thể cập nhật mật khẩu. Vui lòng thử lại.');
    }
  };

  // Trạng thái 1: CHECKING (Đang khởi tạo auth)
  if (authLoading) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-4">
        <div className="text-center p-8 bg-white rounded-3xl border-4 border-amber-300 shadow-xl max-w-sm w-full">
          <RefreshCw className="w-8 h-8 text-amber-600 animate-spin mx-auto mb-3" />
          <p className="text-sm font-black text-amber-950">Đang kiểm tra liên kết xác thực...</p>
          <p className="text-xs font-semibold text-slate-400 mt-1">Vui lòng chờ trong giây lát</p>
        </div>
      </div>
    );
  }

  // Trạng thái 2: INVALID_RECOVERY (Fail-closed: Không có event PASSWORD_RECOVERY)
  if (!isPasswordRecovery) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-3xl border-4 border-rose-300 p-6 sm:p-8 shadow-2xl text-center">
          <div className="w-14 h-14 bg-rose-100 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-rose-200">
            <AlertCircle className="w-8 h-8 text-rose-600" />
          </div>

          <h3 className="text-lg font-black text-slate-900 mb-2">
            Liên kết không hợp lệ hoặc đã hết hạn
          </h3>

          <p className="text-xs font-semibold text-slate-600 leading-relaxed mb-6 bg-rose-50/70 p-3.5 rounded-2xl border border-rose-200/80 text-left">
            Liên kết đặt lại mật khẩu có thể đã được sử dụng hoặc đã hết thời gian hiệu lực. Để đảm bảo an toàn, vui lòng quay lại trang đăng nhập và gửi yêu cầu mới.
          </p>

          <button
            type="button"
            onClick={() => {
              triggerSound('click');
              navigate('/auth', { replace: true });
            }}
            className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-white font-black text-xs sm:text-sm rounded-2xl border-b-4 border-amber-700 shadow-md flex items-center justify-center gap-2 active:translate-y-0.5 transition-all"
          >
            <ArrowLeft className="w-4 h-4" /> Quay lại Đăng nhập / Gửi lại link
          </button>
        </div>
      </div>
    );
  }

  // Trạng thái 3: VALID_RECOVERY (Đã xác nhận sự kiện PASSWORD_RECOVERY)
  return (
    <div className="min-h-[80vh] flex items-center justify-center p-4 flex-col">
      <div className="w-full max-w-md bg-white rounded-3xl border-4 border-amber-300 p-6 sm:p-8 shadow-2xl relative">
        {/* TIÊU ĐỀ */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-gradient-to-tr from-amber-400 to-yellow-300 rounded-2xl border-2 border-amber-400 flex items-center justify-center mx-auto mb-3 shadow-sm">
            <Lock className="w-7 h-7 text-amber-950" />
          </div>
          <h2 className="text-xl font-black text-amber-950 uppercase tracking-tight">Đặt Lại Mật Khẩu Mới</h2>
          <p className="text-xs font-bold text-amber-700 mt-1">
            Nhập mật khẩu mới an toàn cho tài khoản của bạn.
          </p>
        </div>

        {/* THÔNG BÁO LỖI */}
        {errorMsg && (
          <div className="mb-4 p-3 bg-rose-100 border-2 border-rose-300 text-rose-800 text-xs font-bold rounded-xl text-center flex items-center justify-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-black text-slate-700 mb-1 flex items-center gap-1">
              <KeyRound className="w-3.5 h-3.5 text-amber-600" /> Mật khẩu mới:
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Ít nhất 6 ký tự..."
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full p-3.5 pr-12 bg-amber-50 border-2 border-amber-200 rounded-2xl font-bold text-sm text-slate-800 focus:outline-none focus:border-amber-400"
                required
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-amber-700 rounded-xl transition-colors"
                aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-black text-slate-700 mb-1 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-amber-600" /> Xác nhận mật khẩu mới:
            </label>
            <div className="relative">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                placeholder="Gõ lại mật khẩu mới..."
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full p-3.5 pr-12 bg-amber-50 border-2 border-amber-200 rounded-2xl font-bold text-sm text-slate-800 focus:outline-none focus:border-amber-400"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-amber-700 rounded-xl transition-colors"
                aria-label={showConfirmPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                title={showConfirmPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              >
                {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-white font-black text-base rounded-2xl border-b-4 border-amber-700 shadow-md flex items-center justify-center gap-2 active:translate-y-0.5 transition-all mt-4 disabled:opacity-50"
          >
            {submitting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Đang Lưu Mật Khẩu...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>LƯU MẬT KHẨU MỚI 🚀</span>
              </>
            )}
          </button>
        </form>

        <div className="mt-5 text-center">
          <button
            type="button"
            onClick={() => {
              clearPasswordRecoveryState();
              navigate('/auth', { replace: true });
            }}
            className="text-xs font-bold text-sky-600 hover:underline inline-flex items-center gap-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Hủy và quay lại Đăng nhập
          </button>
        </div>
      </div>
    </div>
  );
};

export default ResetPasswordPage;
