import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gamepad2, Sparkles, UserCheck, ShieldCheck, GraduationCap, ArrowRight, User } from 'lucide-react';
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
    e.preventDefault();
    setErrorMsg('');
    triggerSound('click');
    setLoading(true);

    try {
      if (mode === 'student_quick') {
        if (!studentCode) {
          setErrorMsg('Bé vui lòng nhập Mã Học Sinh hoặc Tên Đăng Nhập!');
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

  return (
    <div className="min-h-[85vh] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl border-4 border-amber-300 p-6 sm:p-8 shadow-2xl relative overflow-hidden">
        
        {/* LOGO TIÊU ĐỀ */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-gradient-to-tr from-amber-400 to-yellow-300 rounded-3xl border-4 border-amber-400 flex items-center justify-center mx-auto mb-3 shadow-md">
            <Gamepad2 className="w-9 h-9 text-amber-950" />
          </div>
          <h2 className="text-2xl font-black text-amber-950">VUA TIỂU HỌC HỌC VUI</h2>
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
                  placeholder="Ví dụ: HS102 hoặc nam2017"
                  value={studentCode}
                  onChange={(e) => setStudentCode(e.target.value)}
                  className="w-full p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl font-black text-sm text-slate-800 focus:outline-none focus:border-amber-400"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 mb-1">
                  Họ và Tên Bé (Tùy chọn):
                </label>
                <input
                  type="text"
                  placeholder="Ví dụ: Nguyễn Văn Nam"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl font-bold text-sm text-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 mb-1">
                  Bé Đang Học Khối Lớp Mấy?
                </label>
                <select
                  value={gradeLevel}
                  onChange={(e) => setGradeLevel(e.target.value)}
                  className="w-full p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl font-bold text-sm text-slate-800"
                >
                  <option value="1">Lớp 1 (6 tuổi)</option>
                  <option value="2">Lớp 2 (7 tuổi)</option>
                  <option value="3">Lớp 3 (8 tuổi)</option>
                  <option value="4">Lớp 4 (9 tuổi)</option>
                  <option value="5">Lớp 5 (10 tuổi)</option>
                </select>
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
