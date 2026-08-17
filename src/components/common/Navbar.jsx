import React, { useState, useEffect } from 'react';
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
  Filter
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { SoundToggle } from './SoundToggle';
import { useSound } from '../../context/SoundContext';
import { formatClassLabel } from '../../utils/helpers';
import { ChangePasswordModal } from './ChangePasswordModal';
import { supabase } from '../../lib/supabase';

export const Navbar = () => {
  const { user, profile, signOut, globalClassFilter, setGlobalClassFilter } = useAuth();
  const { triggerSound } = useSound();
  const navigate = useNavigate();
  const location = useLocation();

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isChangePassOpen, setIsChangePassOpen] = useState(false);
  const [headerClasses, setHeaderClasses] = useState([]);
  const [headerClassesLoaded, setHeaderClassesLoaded] = useState(false);

  const role = profile?.role || 'student';

  // 1. Lấy danh sách Lớp Học thuộc quyền hạn người dùng để hiển thị trên Dropdown Header
  useEffect(() => {
    const fetchHeaderClasses = async () => {
      if (!user || !profile) {
        setHeaderClasses([]);
        setHeaderClassesLoaded(false);
        return;
      }

      setHeaderClassesLoaded(false);

      try {
        if (role === 'admin') {
          const { data, error } = await supabase
            .from('classes')
            .select('id, name, grade_level')
            .order('grade_level');

          if (error) {
            console.error('❌ Lỗi truy vấn danh sách lớp Admin:', error.message);
            return;
          }

          setHeaderClasses(data || []);
          setHeaderClassesLoaded(true);

        } else if (role === 'teacher') {
          const { data, error } = await supabase
            .from('classes')
            .select('id, name, grade_level')
            .eq('teacher_id', profile.id);

          if (error) {
            console.error('❌ Lỗi truy vấn danh sách lớp Giáo viên:', error.message);
            return;
          }

          setHeaderClasses(data || []);
          setHeaderClassesLoaded(true);

        } else if (role === 'student') {
          const { data: memberData, error } = await supabase
            .from('class_members')
            .select('classes:class_id(id, name, grade_level)')
            .eq('student_id', profile.id);

          if (error) {
            console.error('❌ Lỗi truy vấn danh sách lớp Học sinh:', error.message);
            return;
          }

          const parsedClasses = (memberData || []).map(m => m.classes).filter(Boolean);
          setHeaderClasses(parsedClasses);
          setHeaderClassesLoaded(true);
        }
      } catch (err) {
        console.error('❌ Lỗi ngoại lệ khi tải danh sách lớp header:', err);
      }
    };

    fetchHeaderClasses();
  }, [user, profile?.id, role]);

  // 2. CHỈ KIỂM TRA VÀ TỰ ĐỘNG KHÔI PHỤC globalClassFilter VỀ 'ALL' SAU KHI ĐÃ TẢI XONG DỮ LIỆU (headerClassesLoaded === true)
  useEffect(() => {
    if (headerClassesLoaded && globalClassFilter !== 'ALL' && globalClassFilter !== 'NO_CLASS') {
      const isValid = headerClasses.some(c => c.id === globalClassFilter);
      if (!isValid) {
        setGlobalClassFilter('ALL');
      }
    }
  }, [headerClassesLoaded, headerClasses, globalClassFilter, setGlobalClassFilter]);

  const handleNavClick = (path) => {
    triggerSound('click');
    setIsMenuOpen(false);
    navigate(path);
  };

  const handleGamesNavClick = () => {
    triggerSound('click');
    setIsMenuOpen(false);
    if (role === 'admin') {
      navigate('/admin?tab=games');
    } else if (role === 'teacher') {
      navigate('/teacher?tab=games');
    } else {
      navigate('/student?tab=games');
    }
  };

  const handleDashboardNavClick = () => {
    triggerSound('click');
    setIsMenuOpen(false);
    if (role === 'admin') {
      navigate('/admin?tab=users');
    } else if (role === 'teacher') {
      navigate('/teacher?tab=classes');
    } else {
      navigate('/student?tab=learning');
    }
  };

  const handleLogout = async () => {
    triggerSound('click');
    setIsMenuOpen(false);
    setHeaderClasses([]);
    setHeaderClassesLoaded(false);
    await signOut();
    navigate('/auth');
  };

  // Đọc tab parameter từ URL để tính toán chính xác trạng thái Active loại trừ lẫn nhau
  const searchParams = new URLSearchParams(location.search);
  const currentTab = searchParams.get('tab');

  const isGamesActive =
    (role === 'admin' && location.pathname === '/admin' && currentTab === 'games') ||
    (role === 'teacher' && location.pathname === '/teacher' && currentTab === 'games') ||
    (role === 'student' && location.pathname === '/student' && (currentTab === 'games' || !currentTab));

  const isDashboardActive =
    (role === 'admin' && location.pathname === '/admin' && (currentTab === 'users' || currentTab === 'exercises' || currentTab === 'academic-assignments')) ||
    (role === 'teacher' && location.pathname === '/teacher' && (currentTab === 'classes' || currentTab === 'exercises' || currentTab === 'academic-assignments')) ||
    (role === 'student' && location.pathname === '/student' && currentTab === 'learning');

  const isLeaderboardActive = location.pathname === '/leaderboard';
  const isMaterialsActive = location.pathname === '/materials';

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

        {/* ĐIỀU HƯỚNG CHÍNH MÀN HÌNH MÁY TÍNH (DESKTOP >= lg) */}
        {/* THỨ TỰ CHUẨN: Kho Trò Chơi ➔ Bảng Xếp Hạng ➔ Dashboard theo role ➔ Góc Tài Liệu */}
        <nav className="hidden lg:flex items-center gap-2">

          {/* BỘ LỌC LỚP HEADER TOÀN CỤC MÁY TÍNH */}
          {user && (
            <div className="flex items-center gap-1.5 bg-amber-50 px-3 py-1.5 rounded-2xl border-2 border-amber-200 mr-1">
              <Filter className="w-3.5 h-3.5 text-amber-700 shrink-0" />
              <span className="text-xs font-black text-amber-950 shrink-0">🏫 Lớp:</span>
              <select
                value={globalClassFilter}
                onChange={(e) => {
                  setGlobalClassFilter(e.target.value);
                  triggerSound('click');
                }}
                className="bg-transparent text-xs font-bold text-amber-900 focus:outline-none cursor-pointer max-w-[140px] truncate"
              >
                <option value="ALL">🌐 Tất cả các lớp</option>
                <option value="NO_CLASS">📌 Bài giảng chung</option>
                {headerClasses.map(c => (
                  <option key={c.id} value={c.id}>
                    🏫 {formatClassLabel(c.name)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 1. NÚT KHO TRÒ CHƠI */}
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

          {/* 2. NÚT BẢNG XẾP HẠNG */}
          <button
            onClick={() => handleNavClick('/leaderboard')}
            className={`px-4 py-2.5 rounded-2xl font-black text-sm transition-all flex items-center gap-2 border-2 ${
              isLeaderboardActive
                ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-amber-50 hover:text-amber-600'
            }`}
          >
            <Trophy className="w-4 h-4 text-amber-400" /> Bảng Xếp Hạng
          </button>

          {/* 3. DASHBOARD THEO ROLE (GÓC HỌC TẬP / LỚP & GIAO BÀI / QUẢN TRỊ HỆ THỐNG) */}
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

          {/* 4. NÚT GÓC TÀI LIỆU */}
          {user && (
            <button
              onClick={() => handleNavClick('/materials')}
              className={`px-4 py-2.5 rounded-2xl font-black text-sm transition-all flex items-center gap-2 border-2 ${
                isMaterialsActive
                  ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-amber-50 hover:text-amber-600'
              }`}
            >
              <BookOpen className="w-4 h-4 text-amber-400" /> Góc Tài Liệu
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

              {/* DROPDOWN MENU USER & ĐIỀU HƯỚNG MOBILE */}
              {isMenuOpen && (
                <div className="absolute right-0 mt-2 w-64 bg-white rounded-3xl border-4 border-amber-200 shadow-xl py-2 z-50 animate-fadeIn">
                  <div className="px-4 py-2 border-b-2 border-slate-100 mb-1">
                    <p className="text-xs text-slate-500 font-bold">Tài khoản vai trò</p>
                    <p className="text-sm font-black text-amber-900 capitalize">
                      {role === 'admin' ? '🛡️ Quản trị viên' : role === 'teacher' ? '👩‍🏫 Giáo viên' : '🎒 Học sinh'}
                    </p>
                  </div>

                  {/* NÚT ĐIỀU HƯỚNG MOBILE/TABLET (ĐỒNG BỘ THỨ TỰ & ACTIVE VỚI DESKTOP) */}
                  <div className="lg:hidden border-b-2 border-slate-100 pb-1 mb-1">
                    {/* 1. KHO TRÒ CHƠI */}
                    <button
                      onClick={handleGamesNavClick}
                      className={`w-full text-left px-4 py-2 text-sm font-bold flex items-center gap-2 ${
                        isGamesActive ? 'bg-sky-50 text-sky-700 font-black' : 'text-slate-700 hover:bg-amber-50'
                      }`}
                    >
                      <Gamepad2 className="w-4 h-4 text-sky-500" /> Kho Trò Chơi
                    </button>

                    {/* 2. BẢNG XẾP HẠNG */}
                    <button
                      onClick={() => handleNavClick('/leaderboard')}
                      className={`w-full text-left px-4 py-2 text-sm font-bold flex items-center gap-2 ${
                        isLeaderboardActive ? 'bg-amber-50 text-amber-900 font-black' : 'text-slate-700 hover:bg-amber-50'
                      }`}
                    >
                      <Trophy className="w-4 h-4 text-amber-500" /> Bảng Xếp Hạng
                    </button>

                    {/* 3. DASHBOARD THEO ROLE */}
                    <button
                      onClick={handleDashboardNavClick}
                      className={`w-full text-left px-4 py-2 text-sm font-bold flex items-center gap-2 ${
                        isDashboardActive ? 'bg-emerald-50 text-emerald-800 font-black' : 'text-slate-700 hover:bg-amber-50'
                      }`}
                    >
                      {role === 'admin' && <ShieldCheck className="w-4 h-4 text-emerald-600" />}
                      {role === 'teacher' && <GraduationCap className="w-4 h-4 text-emerald-600" />}
                      {role === 'student' && <BookOpen className="w-4 h-4 text-emerald-600" />}
                      {role === 'admin' ? 'Quản Trị Hệ Thống' : role === 'teacher' ? 'Lớp & Giao Bài' : 'Góc Học Tập'}
                    </button>

                    {/* 4. GÓC TÀI LIỆU */}
                    <button
                      onClick={() => handleNavClick('/materials')}
                      className={`w-full text-left px-4 py-2 text-sm font-bold flex items-center gap-2 ${
                        isMaterialsActive ? 'bg-amber-50 text-amber-900 font-black' : 'text-slate-700 hover:bg-amber-50'
                      }`}
                    >
                      <BookOpen className="w-4 h-4 text-amber-500" /> Góc Tài Liệu
                    </button>
                  </div>

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

      {/* THANH BỘ LỌC LỚP HEADER DÀNH RIÊNG CHO MÀN HÌNH NHỎ ĐIỆN THOẠI & MÁY TÍNH BẢNG (< lg) */}
      {user && (
        <div className="lg:hidden bg-amber-100/80 border-t-2 border-amber-200 px-3 py-2 flex items-center justify-center">
          <div className="flex items-center gap-2 w-full max-w-sm">
            <Filter className="w-4 h-4 text-amber-800 shrink-0" />
            <span className="text-xs font-black text-amber-950 shrink-0">🏫 Lớp:</span>
            <select
              value={globalClassFilter}
              onChange={(e) => {
                setGlobalClassFilter(e.target.value);
                triggerSound('click');
              }}
              className="w-full bg-white border-2 border-amber-300 rounded-xl px-2.5 py-1 text-xs font-bold text-amber-950 focus:outline-none focus:border-amber-500 shadow-sm truncate"
            >
              <option value="ALL">🌐 Tất cả các lớp</option>
              <option value="NO_CLASS">📌 Bài giảng chung</option>
              {headerClasses.map(c => (
                <option key={c.id} value={c.id}>
                  🏫 Lớp {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <ChangePasswordModal
        isOpen={isChangePassOpen}
        onClose={() => setIsChangePassOpen(false)}
      />
    </header>
  );
};
