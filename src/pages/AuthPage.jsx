import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gamepad2, Sparkles, UserCheck, ShieldCheck, GraduationCap, ArrowRight, User, Zap, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSound } from '../context/SoundContext';
import { ParentReportModal } from '../components/parent/ParentReportModal';

export const AuthPage = () => {
  const { signIn, signUp, signInWithGoogle, quickStudentSignIn } = useAuth();
  const { triggerSound } = useSound();
  const navigate = useNavigate();

  const [mode, setMode] = useState('student_quick'); // 'student_quick' | 'email_login' | 'email_signup'
  const [role, setRole] = useState('student');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [gradeLevel, setGradeLevel] = useState(1);
  const [studentCode, setStudentCode] = useState('');

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
        if (!studentCode) {
          setErrorMsg('Bé vui lòng nhập Mã Học Sinh hoặc chọn nút Đăng Nhập 1-Click!');
          setLoading(false);
          return;
        }
        const res = await quickStudentSignIn(studentCode, fullName || 'Học Sinh Tiểu Học', gradeLevel);
        if (res.error) throw res.error;
        triggerSound('victory');
        navigate('/student');
      } else if (mode === 'email_login') {
        const res = await signIn({ email, password });
        if (res.error) throw res.error;
        triggerSound('victory');
        navigate('/');
      } else if (mode === 'email_signup') {
        const res = await signUp({ email, password, fullName, role, gradeLevel });
        if (res.error) throw res.error;
        triggerSound('victory');
        navigate('/');
      }
    } catch (err) {
      console.error('Auth error:', err);
      setErrorMsg(err.message || 'Có lỗi xảy ra trong quá trình xác thực.');
    } finally {
      setLoading(false);
    }
  };

  // AUTH-02: Đăng nhập Google OAuth
  const handleGoogleSignIn = async () => {
    triggerSound('click');
    setLoading(true);
    const res = await signInWithGoogle();
    if (res.error) {
      setErrorMsg(res.error.message || 'Lỗi đăng nhập bằng Google.');
      setLoading(false);
    }
  };

  // Nút chọn đăng nhập 1-Click tài khoản mẫu
  const handlePresetLogin = async (presetEmail, presetPass) => {
    triggerSound('click');
    setMode('email_login');
    setEmail(presetEmail);
    setPassword(presetPass);
    setLoading(true);
    setErrorMsg('');

    try {
      const res = await signIn({ email: presetEmail, password: presetPass });
      if (res.error) throw res.error;
      triggerSound('victory');
      navigate('/');
    } catch (err) {
      console.error('Preset login error:', err);
      setErrorMsg('Không thể đăng nhập. Vui lòng đảm bảo đã nạp dữ liệu mẫu trên Supabase.');
    } finally {
      setLoading(false);
    }
  };

  const handlePresetStudentQuick = async (code, name, grade) => {
    triggerSound('click');
    setMode('student_quick');
    setStudentCode(code);
    setFullName(name);
    setGradeLevel(grade);
    setLoading(true);

    try {
      const res = await quickStudentSignIn(code, name, grade);
      if (res.error) throw res.error;
      triggerSound('victory');
      navigate('/student');
    } catch (err) {
      console.error('Quick student login error:', err);
      setErrorMsg('Lỗi đăng nhập nhanh học sinh.');
    } finally {
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

        {/* NÚT AUTH-04: TRA CỨU MÃ PHỤ HUYNH KHÔNG CẦN ACCOUNT */}
        <button
          onClick={() => { triggerSound('click'); setIsParentModalOpen(true); }}
          className="w-full py-2.5 mb-5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-black text-xs rounded-2xl border-b-4 border-emerald-800 shadow-sm flex items-center justify-center gap-2 active:translate-y-0.5 transition-all"
        >
          👨‍👩‍👧 PHỤ HUYNH TRA CỨU BÁO CÁO (AUTH-04 - Không cần tài khoản)
        </button>

        {/* TAB CHUYỂN ĐỔI CHẾ ĐỘ ĐĂNG NHẬP (AUTH-01) */}
        <div className="flex bg-amber-100 p-1.5 rounded-2xl mb-5 border-2 border-amber-200">
          <button
            onClick={() => { setMode('student_quick'); setErrorMsg(''); triggerSound('click'); }}
            className={`flex-1 py-2 text-xs font-black rounded-xl transition-all ${
              mode === 'student_quick'
                ? 'bg-amber-400 text-amber-950 shadow-sm'
                : 'text-amber-800 hover:bg-amber-200'
            }`}
          >
            🎒 Học Sinh Đăng Nhập Nhanh
          </button>
          <button
            onClick={() => { setMode('email_login'); setErrorMsg(''); triggerSound('click'); }}
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

        {/* AUTH-02: NÚT ĐĂNG NHẬP GOOGLE OAUTH */}
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
              ĐĂNG NHẬP NHANH VỚI GOOGLE (AUTH-02)
            </button>
            
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
              <div className="relative flex justify-center text-[10px] uppercase font-black tracking-widest text-slate-400">
                <span className="bg-white px-2">Hoặc Đăng Nhập Email</span>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          
          {/* LUỒNG ĐĂNG NHẬP NHANH CHO HỌC SINH */}
          {mode === 'student_quick' && (
            <>
              <div>
                <label className="block text-xs font-black text-slate-700 mb-1">
                  Mã Học Sinh / Tên Đăng Nhập Nhanh:
                </label>
                <input
                  type="text"
                  placeholder="Ví dụ: HS101, HS202, HS303..."
                  value={studentCode}
                  onChange={(e) => setStudentCode(e.target.value)}
                  className="w-full p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl font-black text-sm text-slate-800 focus:outline-none focus:border-amber-400"
                  required
                />
              </div>

              {/* NÚT CHỌN HỌC SINH MẪU 1-CLICK */}
              <div className="bg-amber-50 p-3 rounded-2xl border border-amber-200">
                <p className="text-[11px] font-black text-amber-900 mb-2 flex items-center gap-1">
                  <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-400" /> Bấm 1-Click chọn Học sinh thử nghiệm:
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => handlePresetStudentQuick('HS101', 'Nguyễn Văn Nam', 1)}
                    className="p-2 bg-white hover:bg-amber-100 rounded-xl border border-amber-300 font-bold text-slate-700 text-left"
                  >
                    🎒 Nam (Khối 1)
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePresetStudentQuick('HS202', 'Lê Thúy An', 2)}
                    className="p-2 bg-white hover:bg-amber-100 rounded-xl border border-amber-300 font-bold text-slate-700 text-left"
                  >
                    🎒 An (Khối 2)
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePresetStudentQuick('HS303', 'Trần Minh Đức', 3)}
                    className="p-2 bg-white hover:bg-amber-100 rounded-xl border border-amber-300 font-bold text-slate-700 text-left"
                  >
                    🎒 Đức (Khối 3)
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePresetStudentQuick('HS404', 'Phạm Gia Bảo', 4)}
                    className="p-2 bg-white hover:bg-amber-100 rounded-xl border border-amber-300 font-bold text-slate-700 text-left"
                  >
                    🎒 Bảo (Khối 4)
                  </button>
                </div>
              </div>
            </>
          )}

          {/* LUỒNG EMAIL PASS FOR TEACHER / ADMIN / PARENTS (AUTH-01) */}
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
                    <label className="block text-xs font-black text-slate-700 mb-1">Phân Quyền RLS 3 Cấp (AUTH-03):</label>
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      className="w-full p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl font-bold text-sm"
                    >
                      <option value="teacher">👩‍🏫 Giáo Viên Tiểu Học</option>
                      <option value="student">🎒 Học Sinh Tiểu Học</option>
                      <option value="admin">🛡️ Quản Trị Viên (Admin)</option>
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
            {loading ? 'Đang Xử Lý...' : 'VÀO HỌC NGAY 🚀'}
          </button>
        </form>

        {/* NÚT ĐĂNG NHẬP 1-CLICK TÀI KHOẢN MẪU CHO GIÁO VIÊN & ADMIN */}
        {mode !== 'student_quick' && (
          <div className="mt-4 p-3 bg-sky-50 rounded-2xl border border-sky-200">
            <p className="text-[11px] font-black text-sky-900 mb-2 flex items-center gap-1">
              <Zap className="w-3.5 h-3.5 text-sky-600 fill-sky-500" /> Bấm 1-Click Đăng nhập Tài khoản Thử nghiệm:
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={() => handlePresetLogin('co.hoa@hoclapvui.edu.vn', '123456')}
                className="p-2 bg-white hover:bg-sky-100 rounded-xl border border-sky-300 font-bold text-sky-900 text-left"
              >
                👩‍🏫 Cô Hoa (Pass: 123456)
              </button>

              <button
                type="button"
                onClick={() => handlePresetLogin('thay.minh@hoclapvui.edu.vn', '123456')}
                className="p-2 bg-white hover:bg-sky-100 rounded-xl border border-sky-300 font-bold text-sky-900 text-left"
              >
                👨‍🏫 Thầy Minh (Pass: 123456)
              </button>

              <button
                type="button"
                onClick={() => handlePresetLogin('admin@hoclapvui.edu.vn', 'admin123456')}
                className="p-2 bg-white hover:bg-purple-100 rounded-xl border border-purple-300 font-bold text-purple-900 text-left col-span-2"
              >
                🛡️ Quản Trị Viên Admin (Pass: admin123456)
              </button>
            </div>
          </div>
        )}

        {/* FOOTER SWITCH MODES */}
        {mode !== 'student_quick' && (
          <div className="mt-4 text-center">
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
    </div>
  );
};
