import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gamepad2, Sparkles, UserCheck, ShieldCheck, GraduationCap, ArrowRight, User, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSound } from '../context/SoundContext';

export const AuthPage = () => {
  const { signIn, signUp, quickStudentSignIn } = useAuth();
  const { triggerSound } = useSound();
  const navigate = useNavigate();

  const [mode, setMode] = useState('student_quick'); // 'student_quick' | 'email_login' | 'email_signup'
  const [role, setRole] = useState('student');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [gradeLevel, setGradeLevel] = useState(1);
  const [studentCode, setStudentCode] = useState('');

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

  // Hàm kích hoạt Đăng nhập 1-Click Tài khoản Thử nghiệm mẫu
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
      setErrorMsg('Không thể đăng nhập. Hãy đảm bảo Thầy/Cô đã nạp file sample_data.sql vào Supabase.');
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
          <h2 className="text-2xl font-black text-amber-950">KHO TRÒ CHƠI HỌC VUI</h2>
          <p className="text-xs font-bold text-amber-700 mt-0.5">
            Đăng nhập để tích lũy Sao Thưởng & Chơi Trò Chơi Học Tập!
          </p>
        </div>

        {/* TAB CHUYỂN ĐỔI CHẾ ĐỘ ĐĂNG NHẬP */}
        <div className="flex bg-amber-100 p-1.5 rounded-2xl mb-6 border-2 border-amber-200">
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

        <form onSubmit={handleSubmit} className="space-y-4">
          
          {/* LUỒNG ĐĂNG NHẬP NHANH CHO HỌC SINH */}
          {mode === 'student_quick' && (
            <>
              <div>
                <label className="block text-xs font-black text-slate-700 mb-1">
                  Mã Học Sinh / Tên Đăng Nhập Nhanh:
                </label>
                <input
                  type="text"
                  placeholder="Ví dụ: HS101 hoặc nam2017"
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
                    <label className="block text-xs font-black text-slate-700 mb-1">Vai Trò Tài Khoản:</label>
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
                  placeholder="name@example.com"
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
          <div className="mt-5 p-3 bg-sky-50 rounded-2xl border border-sky-200">
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
    </div>
  );
};
