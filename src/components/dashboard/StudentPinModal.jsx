import React, { useState, useEffect } from 'react';
import { X, KeyRound, CheckCircle2, ShieldCheck, Lock } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export const StudentPinModal = ({ isOpen, onClose, student }) => {
  const [hasPin, setHasPin] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (isOpen && student?.id) {
      checkStudentPinStatus();
    } else {
      setNewPin('');
      setConfirmPin('');
      setErrorMsg('');
      setSuccessMsg('');
    }
  }, [isOpen, student?.id]);

  // Kiểm tra an toàn xem Học sinh đã có PIN hay chưa qua RPC has_student_pin (Không expose pin_hash)
  const checkStudentPinStatus = async () => {
    setChecking(true);
    try {
      const { data, error } = await supabase.rpc('has_student_pin', {
        p_student_id: student.id
      });
      if (!error && typeof data === 'boolean') {
        setHasPin(data);
      } else {
        setHasPin(false);
      }
    } catch (err) {
      console.error('Error checking PIN status:', err);
      setHasPin(false);
    } finally {
      setChecking(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!newPin || newPin.length < 4) {
      setErrorMsg('Mã PIN mới phải có độ dài tối thiểu 4 ký tự.');
      return;
    }

    if (newPin !== confirmPin) {
      setErrorMsg('Mã PIN xác nhận không trùng khớp.');
      return;
    }

    setLoading(true);
    try {
      // Gọi RPC set_student_pin của Postgres để hash và lưu PIN an toàn
      const { data, error } = await supabase.rpc('set_student_pin', {
        p_student_id: student.id,
        p_pin: newPin.trim()
      });

      // Xóa sạch PIN khỏi state ngay lập tức
      setNewPin('');
      setConfirmPin('');

      if (error) {
        throw error;
      }

      setSuccessMsg(hasPin ? '🔑 Reset Mã PIN cho học sinh thành công!' : '🔑 Đặt Mã PIN ban đầu cho học sinh thành công!');
      setHasPin(true);
      setTimeout(() => {
        setSuccessMsg('');
        onClose();
      }, 1500);

    } catch (err) {
      console.error('Set PIN error:', err);
      setErrorMsg(err.message || 'Lỗi khi cập nhật Mã PIN cho học sinh.');
      setNewPin('');
      setConfirmPin('');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !student) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-md bg-white rounded-3xl border-4 border-amber-300 p-6 shadow-2xl">
        
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 bg-slate-100 rounded-full hover:bg-slate-200 text-slate-500"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-xl font-black text-amber-950 mb-1 flex items-center gap-2">
          <KeyRound className="w-6 h-6 text-amber-600" /> 
          {hasPin ? 'Reset Mã PIN Đăng Nhập' : 'Đặt Mã PIN Ban Đầu'}
        </h3>
        <p className="text-xs font-bold text-slate-500 mb-4">
          Học sinh: <span className="text-amber-800 font-extrabold">{student.full_name}</span>
        </p>

        {checking ? (
          <div className="p-8 text-center text-xs font-bold text-slate-500">
            Đang kiểm tra trạng thái PIN...
          </div>
        ) : (
          <>
            <div className="mb-4 p-3 bg-amber-50 rounded-2xl border border-amber-200 text-xs font-bold text-amber-900 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-amber-600 shrink-0" />
              <span>
                {hasPin 
                  ? 'Học sinh này ĐÃ CÓ Mã PIN. Nhập bên dưới để cấp lại PIN mới.' 
                  : 'Học sinh CHƯA CÓ Mã PIN. Vui lòng thiết lập PIN đầu tiên để bé đăng nhập.'}
              </span>
            </div>

            {errorMsg && (
              <div className="mb-4 p-3 bg-rose-100 border-2 border-rose-300 text-rose-800 text-xs font-bold rounded-xl text-center">
                ⚠️ {errorMsg}
              </div>
            )}

            {successMsg ? (
              <div className="p-4 bg-emerald-100 border-2 border-emerald-400 text-emerald-900 rounded-2xl text-center font-black flex items-center justify-center gap-2">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" /> {successMsg}
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1 flex items-center gap-1">
                    <Lock className="w-3.5 h-3.5 text-amber-600" /> Mã PIN Mới (Tối thiểu 4 ký tự):
                  </label>
                  <input
                    type="password"
                    maxLength={6}
                    placeholder="Nhập mã PIN mới..."
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value)}
                    className="w-full p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl font-black text-sm text-slate-800 tracking-widest"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1 flex items-center gap-1">
                    <Lock className="w-3.5 h-3.5 text-amber-600" /> Xác Nhận Mã PIN Mới:
                  </label>
                  <input
                    type="password"
                    maxLength={6}
                    placeholder="Nhập lại mã PIN mới..."
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value)}
                    className="w-full p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl font-black text-sm text-slate-800 tracking-widest"
                    required
                  />
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2.5 bg-slate-100 text-slate-600 font-bold text-xs rounded-xl hover:bg-slate-200"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs rounded-xl border-b-4 border-amber-700 shadow-md active:translate-y-0.5"
                  >
                    {loading ? 'Đang lưu...' : hasPin ? '🔑 XÁC NHẬN RESET PIN' : '🔑 LƯU MÃ PIN BAN ĐẦU'}
                  </button>
                </div>
              </form>
            )}
          </>
        )}

      </div>
    </div>
  );
};
