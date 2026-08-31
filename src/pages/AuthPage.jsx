import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gamepad2, Sparkles, User, ShieldCheck, GraduationCap, BookOpen, Lock, KeyRound, Camera, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSound } from '../context/SoundContext';
import { ParentReportModal } from '../components/parent/ParentReportModal';
import { StudentQrScannerModal } from '../components/auth/StudentQrScannerModal';

export const AuthPage = () => {
  const { signIn, signUp, signInWithGoogle, quickStudentSignIn, qrStudentSignIn } = useAuth();
  const { triggerSound } = useSound();
  const navigate = useNavigate();

  const [mode, setMode] = useState('student_quick'); // 'student_quick' | 'email_login' | 'email_signup'
  const [role, setRole] = useState('student');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [gradeLevel, setGradeLevel] = useState(1);
  const [studentCode, setStudentCode] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);

  const [isQrScannerOpen, setIsQrScannerOpen] = useState(false);
  const [scannedQrId, setScannedQrId] = useState(null);
  const [isParentModalOpen, setIsParentModalOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    setErrorMsg('');
    triggerSound('click');
    setLoading(true);

    try {
      if (mode === 'student_quick') {
        if (scannedQrId) {
          // Luồng 1: Đăng nhập bằng Thẻ QR + Mã PIN
          if (!pin.trim()) {
            setErrorMsg('Vui lòng nhập mã PIN bí mật!');
            setLoading(false);
            return;
          }
          const res = await qrStudentSignIn(scannedQrId, pin.trim());
          setPin(''); // Xóa PIN khỏi state ngay sau khi xử lý
          if (res.error) throw res.error;
          setScannedQrId(null); // Xóa QR ID khỏi bộ nhớ sau khi đăng nhập thành công
          triggerSound('victory');
          navigate('/student');
        } else {
          // Luồng 2: Đăng nhập bằng Mã Học Sinh + Mã PIN truyền thống
          if (!studentCode.trim() || !pin.trim()) {
            setErrorMsg('Vui lòng nhập đủ Mã Học Sinh và Mã PIN!');
            setLoading(false);
            return;
          }
          const res = await quickStudentSignIn(studentCode.trim(), pin.trim());
          setPin(''); // Xóa PIN khỏi state ngay sau khi xử lý
          if (res.error) throw res.error;
          triggerSound('victory');
          navigate('/student');
        }
      } else if (mode === 'email_login') {
        const res = await signIn({ email: email.trim(), password });
        if (res.error) throw res.error;
        triggerSound('victory');
        navigate('/');
      } else if (mode === 'email_signup') {
        const res = await signUp({ email: email.trim(), password, fullName: fullName.trim(), role, gradeLevel });
        if (res.error) throw res.error;
        triggerSound('victory');
        navigate('/');
      }
    } catch (err) {
      console.error('Auth error:', err?.message || 'Authentication failed');
      setErrorMsg(err?.message || (scannedQrId ? 'Mã QR hoặc PIN không hợp lệ.' : 'Mã học sinh hoặc PIN không hợp lệ.'));
      setPin('');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    triggerSound('click');
    setLoading(true);
    const res = await signInWithGoogle();
    if (res.error) {
      setErrorMsg(res.error.message || 'Lỗi đăng nhập bằng Google.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center p-4 flex-col">
      <div className="w-full max-w-md bg-white rounded-3xl border-4 border-amber-300 p-6 sm:p-8 shadow-2xl relative overflow-hidden">
        
        {/* LOGO TIÊU ĐỀ */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-gradient-to-tr from-amber-400 to-yellow-300 rounded-3xl border-4 border-amber-400 flex items-center justify-center mx-auto mb-3 shadow-md">
            <Gamepad2 className="w-9 h-9 text-amber-950" />
          </div>
          <h2 className="text-2xl font-black text-amber-950 uppercase tracking-tight">VUA TIỂU HỌC HỌC VUI</h2>
          <p className="text-xs font-bold text-amber-700 mt-0.5">
            Đăng nhập để tích lũy Sao Thưởng & Chơi Trò Chơi Học Tập!
          </p>
        </div>

        {/* NÚT TRA CỨU MÃ PHỤ HUYNH KHÔNG CẦN ACCOUNT */}
        <button
          onClick={() => { triggerSound('click'); setIsParentModalOpen(true); }}
          className="w-full py-2.5 mb-5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-black text-xs rounded-2xl border-b-4 border-emerald-800 shadow-sm flex items-center justify-center gap-2 active:translate-y-0.5 transition-all"
        >
          👨‍👩‍👧 PHỤ HUYNH TRA CỨU BÁO CÁO (Không cần tài khoản)
        </button>

        {/* TAB CHUYỂN ĐỔI CHẾ ĐỘ ĐĂNG NHẬP */}
        <div className="flex bg-amber-100 p-1.5 rounded-2xl mb-5 border-2 border-amber-200">
          <button
            onClick={() => { setMode('student_quick'); setScannedQrId(null); setErrorMsg(''); triggerSound('click'); }}
            className={`flex-1 py-2 text-xs font-black rounded-xl transition-all ${
              mode === 'student_quick'
                ? 'bg-amber-400 text-amber-950 shadow-sm'
                : 'text-amber-800 hover:bg-amber-200'
            }`}
          >
            🎒 Học Sinh Đăng Nhập Nhanh
          </button>
          <button
            onClick={() => { setMode('email_login'); setScannedQrId(null); setErrorMsg(''); triggerSound('click'); }}
            className={`flex-1 py-2 text-xs font-black rounded-xl transition-all ${
              mode !== 'student_quick'
                ? 'bg-sky-500 text-white shadow-sm'
                : 'text-amber-800 hover:bg-amber-200'
            }`}
          >
            📧 Giáo Viên / Phụ Huynh
          </button>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 bg-rose-100 border-2 border-rose-300 text-rose-800 text-xs font-bold rounded-xl text-center">
            ⚠️ {errorMsg}
          </div>
        )}

        {/* GOOGLE OAUTH */}
        {mode !== 'student_quick' && (
          <div className="mb-4">
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full py-3 bg-white hover:bg-slate-50 text-slate-800 font-black text-xs rounded-2xl border-2 border-slate-300 shadow-sm flex items-center justify-center gap-3 transition-all active:translate-y-0.5"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
              </svg>
              ĐĂNG NHẬP NHANH VỚI GOOGLE
            </button>
            
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
              <div className="relative flex justify-center text-[10px] uppercase font-black tracking-widest text-slate-400">
                <span className="bg-white px-2">Hoặc Đăng Nhập Email</span>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          
          {/* LUỒNG ĐĂNG NHẬP NHANH CHO HỌC SINH THẬT KÈM MÃ PIN BẢO MẬT */}
          {mode === 'student_quick' && (
            <>
              {/* NÚT QUÉT MÃ QR HOẶC TRẠNG THÁI ĐÃ NHẬN QR */}
              {!scannedQrId ? (
                <button
                  type="button"
                  onClick={() => { triggerSound('click'); setIsQrScannerOpen(true); }}
                  className="w-full py-3 bg-gradient-to-r from-amber-400 to-yellow-400 hover:from-amber-500 hover:to-yellow-500 text-amber-950 font-black text-xs rounded-2xl border-2 border-amber-300 shadow-sm flex items-center justify-center gap-2 active:translate-y-0.5 transition-all mb-3"
                >
                  <Camera className="w-4 h-4 text-amber-900" /> 📷 QUÉT THẺ QR ĐĂNG NHẬP
                </button>
              ) : (
                <div className="p-3.5 bg-emerald-50 border-2 border-emerald-300 rounded-2xl flex items-center justify-between text-emerald-900 text-xs font-black mb-3 shadow-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-base">✅</span>
                    <div className="text-left">
                      <p className="font-black text-emerald-950">Đã nhận thẻ QR — hãy nhập mã PIN</p>
                      <p className="text-[11px] font-bold text-emerald-700">Mã học sinh đã được điền tự động</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setScannedQrId(null);
                      setErrorMsg('');
                    }}
                    className="px-2.5 py-1 bg-white border border-emerald-300 rounded-xl text-[11px] text-rose-600 hover:bg-rose-50 font-bold transition-colors"
                  >
                    Quét lại
                  </button>
                </div>
              )}

              {/* ẨN TRƯỜNG MÃ HỌC SINH NẾU ĐÃ NHẬN MÃ QR */}
              {!scannedQrId && (
                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1.5">
                    Mã Học Sinh / Tên Đăng Nhập:
                  </label>
                  <input
                    type="text"
                    placeholder="Nhập Mã Học Sinh..."
                    value={studentCode}
                    onChange={(e) => setStudentCode(e.target.value)}
                    className="w-full p-3.5 bg-amber-50 border-2 border-amber-200 rounded-2xl font-black text-sm text-slate-800 focus:outline-none focus:border-amber-400 shadow-inner uppercase"
                    required={!scannedQrId}
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5 flex items-center gap-1">
                  <KeyRound className="w-3.5 h-3.5 text-amber-600" /> Mã PIN Bí Mật:
                </label>
                <div className="relative">
                  <input
                    type={showPin ? 'text' : 'password'}
                    maxLength={6}
                    placeholder="Nhập mã PIN..."
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    className="w-full p-3.5 pr-12 bg-amber-50 border-2 border-amber-200 rounded-2xl font-black text-sm text-slate-800 focus:outline-none focus:border-amber-400 shadow-inner tracking-widest"
                    required
                    autoFocus={Boolean(scannedQrId)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin(!showPin)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-amber-700 rounded-xl transition-colors"
                    aria-label={showPin ? 'Ẩn mã PIN' : 'Hiện mã PIN'}
                    title={showPin ? 'Ẩn mã PIN' : 'Hiện mã PIN'}
                  >
                    {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* LUỒNG EMAIL PASS FOR TEACHER / ADMIN / PARENTS */}
          {mode !== 'student_quick' && (
            <>
              {mode === 'email_signup' && (
                <>
                  <div>
                    <label className="block text-xs font-black text-slate-700 mb-1">Họ và Tên:</label>
                    <input
                      type="text"
                      placeholder="Nguyễn Văn A"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl font-bold text-sm"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-black text-slate-700 mb-1">Đăng ký vai trò:</label>
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      className="w-full p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl font-bold text-sm bg-white"
                    >
                      <option value="teacher">👩‍🏫 Giáo Viên Tiểu Học</option>
                      <option value="student">🎒 Học Sinh Tiểu Học</option>
                    </select>
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs font-black text-slate-700 mb-1">Email đăng nhập:</label>
                <input
                  type="email"
                  placeholder="co.hoa@hoclapvui.edu.vn"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl font-bold text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 mb-1">Mật khẩu:</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl font-bold text-sm"
                  required
                />
              </div>
            </>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-white font-black text-base rounded-2xl border-b-4 border-amber-700 shadow-md flex items-center justify-center gap-2 active:translate-y-0.5 transition-all mt-4"
          >
            {loading ? 'Đang Xử Lý...' : mode === 'email_signup' ? 'ĐĂNG KÝ TÀI KHOẢN 🚀' : 'VÀO HỌC NGAY 🚀'}
          </button>
        </form>

        {/* FOOTER SWITCH MODES */}
        {mode !== 'student_quick' && (
          <div className="mt-5 text-center">
            {mode === 'email_login' ? (
              <button
                onClick={() => setMode('email_signup')}
                className="text-xs font-bold text-sky-600 hover:underline"
              >
                Chưa có tài khoản? Tạo tài khoản Giáo viên / Học sinh mới
              </button>
            ) : (
              <button
                onClick={() => setMode('email_login')}
                className="text-xs font-bold text-sky-600 hover:underline"
              >
                Đã có tài khoản? Đăng nhập ngay
              </button>
            )}
          </div>
        )}

      </div>

      {/* MODAL AUTH-04 PHỤ HUYNH */}
      <ParentReportModal
        isOpen={isParentModalOpen}
        onClose={() => setIsParentModalOpen(false)}
      />

      {/* MODAL QUÉT QR HỌC SINH (PHASE 2C UI) */}
      {isQrScannerOpen && (
        <StudentQrScannerModal
          onClose={() => setIsQrScannerOpen(false)}
          onScanSuccess={(qrId) => {
            setScannedQrId(qrId);
            setIsQrScannerOpen(false);
          }}
        />
      )}
    </div>
  );
};
