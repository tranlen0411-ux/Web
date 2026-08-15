import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { 
  Gamepad2, 
  Trophy, 
  User, 
  LogOut, 
  BookOpen, 
  Sparkles, 
  ShieldCheck, 
  GraduationCap,
  ChevronDown,
  Lock,
  FileText
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { SoundToggle } from './SoundToggle';
import { useSound } from '../../context/SoundContext';
import { ChangePasswordModal } from './ChangePasswordModal';

export const Navbar = () => {
  const { user, profile, signOut } = useAuth();
  const { triggerSound } = useSound();
  const navigate = useNavigate();
  const location = useLocation();

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isChangePassOpen, setIsChangePassOpen] = useState(false);

  const role = profile?.role || 'student';

  const handleNavClick = (path) => {
    triggerSound('click');
    navigate(path);
  };

  // Điều hướng Kho Trò Chơi theo đúng vai trò role
  const handleGamesNavClick = () => {
    triggerSound('click');
    if (role === 'admin') {
      navigate('/admin?tab=games');
    } else if (role === 'teacher') {
      navigate('/teacher');
    } else {
      navigate('/student');
    }
  };

  // Điều hướng Bảng Quản Lý theo đúng vai trò role
  const handleDashboardNavClick = () => {
    triggerSound('click');
    if (role === 'admin') {
      navigate('/admin?tab=users');
    } else if (role === 'teacher') {
      navigate('/teacher');
    } else {
      navigate('/student');
    }
  };

  const handleLogout = async () => {
    triggerSound('click');
    await signOut();
    navigate('/auth');
  };

  // Kiểm tra active cho nút Kho Trò Chơi
  const isGamesActive = 
    (role === 'admin' && location.pathname === '/admin' && location.search.includes('tab=games')) ||
    (role === 'teacher' && location.pathname === '/teacher' && !location.pathname.includes('materials')) ||
    (role === 'student' && (location.pathname === '/' || location.pathname === '/student'));

  // Kiểm tra active cho nút Bảng Quản Lý theo Role
  const isDashboardActive = 
    (role === 'admin' && location.pathname === '/admin' && !location.search.includes('tab=games')) ||
    (role === 'teacher' && location.pathname === '/teacher') ||
    (role === 'student' && location.pathname === '/student');

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b-4 border-amber-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
        
        {/* LOGO CÚ TIỂU HỌC HỌC VUI */}
        <a 
          href="/" 
          onClick={(e) => {
            e.preventDefault();
            handleGamesNavClick();
          }}
          className="flex items-center gap-3 group cursor-pointer"
        >
          <div className="w-12 h-12 bg-gradient-to-tr from-amber-400 via-yellow-400 to-amber-300 rounded-2xl border-4 border-amber-300 flex items-center justify-center shadow-md transform group-hover:rotate-6 transition-transform text-2xl">
            🦉
          </div>
          <div>
            <span className="text-xl font-black text-amber-900 tracking-tight flex items-center gap-1">
              HỌC VUI <Sparkles className="w-4 h-4 text-amber-500 fill-amber-400" />
            </span>
            <span className="text-xs font-black text-sky-600 uppercase tracking-wider block -mt-1">
              Kho Trò Chơi & Bài Giảng
            </span>
          </div>
        </a>

        {/* ĐIỀU HƯỚNG CHÍNH CHUẨN ROLE */}
        <nav className="hidden md:flex items-center gap-2">
          {/* NÚT KHO TRÒ CHƠI */}
          <button
            onClick={handleGamesNavClick}
            className={`px-4 py-2.5 rounded-2xl font-black text-sm transition-all flex items-center gap-2 border-2 ${
              isGamesActive
                ? 'bg-sky-500 text-white border-sky-600 shadow-sm' 
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-sky-50 hover:text-sky-600'
            }`}
          >
            <Gamepad2 className="w-4 h-4" /> Kho Trò Chơi
          </button>

          {/* NÚT GÓC TÀI LIỆU (DÀNH CHO TẤT CẢ USER ĐÃ ĐĂNG NHẬP) */}
          {user && (
            <button
              onClick={() => handleNavClick('/materials')}
              className={`px-4 py-2.5 rounded-2xl font-black text-sm transition-all flex items-center gap-2 border-2 ${
                location.pathname === '/materials'
                  ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-amber-50 hover:text-amber-600'
              }`}
            >
              <BookOpen className="w-4 h-4 text-amber-400" /> Góc Tài Liệu
            </button>
          )}

          {/* NÚT BẢNG XẾP HẠNG */}
          <button
            onClick={() => handleNavClick('/leaderboard')}
            className={`px-4 py-2.5 rounded-2xl font-black text-sm transition-all flex items-center gap-2 border-2 ${
              location.pathname === '/leaderboard' 
                ? 'bg-amber-500 text-white border-amber-600 shadow-sm' 
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-amber-50 hover:text-amber-600'
            }`}
          >
            <Trophy className="w-4 h-4 text-amber-400" /> Bảng Xếp Hạng
          </button>

          {/* DASHBOARD THEO ROLE */}
          {user && (
            <button
              onClick={handleDashboardNavClick}
              className={`px-4 py-2.5 rounded-2xl font-black text-sm transition-all flex items-center gap-2 border-2 ${
                isDashboardActive
                  ? 'bg-emerald-500 text-white border-emerald-600 shadow-sm'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-emerald-50 hover:text-emerald-600'
              }`}
            >
              {role === 'admin' && <ShieldCheck className="w-4 h-4" />}
              {role === 'teacher' && <GraduationCap className="w-4 h-4" />}
              {role === 'student' && <BookOpen className="w-4 h-4" />}
              {role === 'admin' ? 'Quản Trị Hệ Thống' : role === 'teacher' ? 'Lớp & Giao Bài' : 'Góc Học Tập'}
            </button>
          )}
        </nav>

        {/* THÔNG TIN NGƯỜI DÙNG & ÂM THANH */}
        <div className="flex items-center gap-3">
          <SoundToggle />

          {user ? (
            <div className="relative">
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="flex items-center gap-2 p-1.5 pr-3 bg-amber-50 hover:bg-amber-100 rounded-2xl border-2 border-amber-200 transition-all"
              >
                <img
                  src={profile?.avatar_url || 'https://api.dicebear.com/7.x/bottts/svg?seed=Pikachu'}
                  alt="Avatar"
                  className="w-9 h-9 rounded-xl border-2 border-amber-300 bg-white"
                />
                <div className="text-left hidden sm:block">
                  <p className="text-xs font-black text-amber-900 truncate max-w-[120px]">
                    {profile?.full_name || (role === 'admin' ? 'Quản trị viên' : role === 'teacher' ? 'Giáo viên' : 'Học sinh')}
                  </p>
                  <div className="flex items-center gap-2 text-[10px] font-bold text-amber-700">
                    {role === 'student' ? (
                      <>
                        <span className="flex items-center gap-0.5">🌟 {profile?.total_stars || 0}</span>
                        <span className="flex items-center gap-0.5">🪙 {profile?.total_coins || 0}</span>
                      </>
                    ) : (
                      <span className="text-emerald-700 font-extrabold flex items-center gap-1">
                        {role === 'admin' ? '🛡️ Admin System' : '👩‍🏫 Giáo Viên'}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronDown className="w-4 h-4 text-amber-700" />
              </button>

              {/* DROPDOWN MENU */}
              {isMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-3xl border-4 border-amber-200 shadow-xl py-2 z-50 animate-fadeIn">
                  <div className="px-4 py-2 border-b-2 border-slate-100 mb-1">
                    <p className="text-xs text-slate-500 font-bold">Tài khoản vai trò</p>
                    <p className="text-sm font-black text-amber-900 capitalize">
                      {role === 'admin' ? '🛡️ Quản trị viên' : role === 'teacher' ? '👩‍🏫 Giáo viên' : '🎒 Học sinh'}
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      setIsMenuOpen(false);
                      handleNavClick('/materials');
                    }}
                    className="w-full text-left px-4 py-2 text-sm font-bold text-slate-700 hover:bg-amber-50 hover:text-amber-900 flex items-center gap-2"
                  >
                    <BookOpen className="w-4 h-4 text-amber-500" /> Góc Tài Liệu
                  </button>

                  <button
                    onClick={() => {
                      setIsMenuOpen(false);
                      handleDashboardNavClick();
                    }}
                    className="w-full text-left px-4 py-2 text-sm font-bold text-slate-700 hover:bg-amber-50 hover:text-amber-900 flex items-center gap-2"
                  >
                    <User className="w-4 h-4 text-amber-500" /> Hồ Sơ & Bảng Quản Lý
                  </button>

                  <button
                    onClick={() => {
                      setIsMenuOpen(false);
                      triggerSound('click');
                      setIsChangePassOpen(true);
                    }}
                    className="w-full text-left px-4 py-2 text-sm font-bold text-slate-700 hover:bg-amber-50 hover:text-amber-900 flex items-center gap-2"
                  >
                    <Lock className="w-4 h-4 text-amber-500" /> Đổi Mật Khẩu
                  </button>

                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-2 text-sm font-bold text-rose-600 hover:bg-rose-50 flex items-center gap-2 border-t border-slate-100 mt-1"
                  >
                    <LogOut className="w-4 h-4" /> Đăng Xuất
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => handleNavClick('/auth')}
              className="px-5 py-2.5 bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700 text-white font-black text-sm rounded-2xl border-b-4 border-sky-700 shadow-md active:translate-y-0.5 transition-all"
            >
              Đăng Nhập
            </button>
          )}
        </div>

      </div>

      <ChangePasswordModal
        isOpen={isChangePassOpen}
        onClose={() => setIsChangePassOpen(false)}
      />
    </header>
  );
};
