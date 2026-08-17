import React, { useState, useEffect } from 'react';
import { Trophy, Medal, Star, Sparkles, Award, BookOpen, Gamepad2, Filter, Users, CheckCircle2, ChevronRight, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton';
import { useSound } from '../context/SoundContext';

export const LeaderboardView = () => {
  const { triggerSound } = useSound();
  
  // Tab chế độ: 'game' (Xếp hạng Trò chơi) | 'academic' (Xếp hạng Học thuật)
  const [activeTab, setActiveTab] = useState('game');

  // --- THÔNG TIN THÀNH VIÊN VÀ TOÀN BỘ LỚP TRONG HỆ THỐNG ---
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [allSystemClasses, setAllSystemClasses] = useState([]);
  const [userMyClasses, setUserMyClasses] = useState([]);

  // --- STATE DÀNH CHO TAB TRÒ CHƠI ---
  const [gameGradeFilter, setGameGradeFilter] = useState('ALL');
  const [gameClassFilter, setGameClassFilter] = useState('ALL_IN_GRADE');
  const [gameStudents, setGameStudents] = useState([]);
  const [loadingGame, setLoadingGame] = useState(false);

  // --- STATE DÀNH CHO TAB HỌC THUẬT ---
  const [selectedAcademicClassId, setSelectedAcademicClassId] = useState('');
  const [academicSubject, setAcademicSubject] = useState('ALL');
  const [academicTimeRange, setAcademicTimeRange] = useState('ALL');
  const [academicData, setAcademicData] = useState(null);
  const [loadingAcademic, setLoadingAcademic] = useState(false);
  const [academicError, setAcademicError] = useState('');

  // 1. Load thông tin User đăng nhập & Toàn bộ danh sách Lớp học
  useEffect(() => {
    fetchUserProfileAndClasses();
  }, []);

  const fetchUserProfileAndClasses = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUser(user);

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      setUserProfile(profile);

      // Tải tất cả các lớp trong hệ thống
      const { data: sysClasses } = await supabase
        .from('classes')
        .select('*')
        .order('grade_level', { ascending: true })
        .order('name', { ascending: true });

      setAllSystemClasses(sysClasses || []);

      // Xác định các lớp gắn liền với vai trò người dùng
      if (profile?.role === 'student') {
        const { data: cm } = await supabase
          .from('class_members')
          .select('class_id, classes(*)')
          .eq('student_id', user.id);

        const myClasses = (cm || []).map(item => item.classes).filter(Boolean);
        setUserMyClasses(myClasses);
        if (myClasses.length > 0) {
          setSelectedAcademicClassId(myClasses[0].id);
        }
        if (profile?.grade_level) {
          setGameGradeFilter(profile.grade_level);
        }

      } else if (profile?.role === 'teacher') {
        const myClasses = (sysClasses || []).filter(c => c.teacher_id === user.id);
        setUserMyClasses(myClasses);
        if (myClasses.length > 0) {
          setSelectedAcademicClassId(myClasses[0].id);
        }

      } else if (profile?.role === 'admin') {
        setUserMyClasses(sysClasses || []);
        if (sysClasses && sysClasses.length > 0) {
          setSelectedAcademicClassId(sysClasses[0].id);
        }
      }
    } catch (err) {
      console.error('Fetch user profile and classes error:', err);
    }
  };

  // 2. TỰ ĐỘNG RESET BỘ LỌC LỚP TRÒ CHƠI KHI ĐỔI KHỐI (RESET CLASS FILTER ON GRADE CHANGE)
  const handleGameGradeChange = (newGrade) => {
    setGameGradeFilter(newGrade);
    setGameClassFilter('ALL_IN_GRADE'); // Đặt lại bộ lọc lớp về "Tất cả các lớp trong khối"
    triggerSound('click');
  };

  // 3. FETCH BẢNG XẾP HẠNG TRÒ CHƠI (SAO THƯỞNG & XU)
  useEffect(() => {
    if (activeTab === 'game') {
      fetchGameLeaderboard();
    }
  }, [activeTab, gameGradeFilter, gameClassFilter]);

  const fetchGameLeaderboard = async () => {
    setLoadingGame(true);
    try {
      // 1. Thử gọi RPC SECURITY DEFINER get_game_leaderboard kiểm tra phân quyền chặt chẽ phía Supabase
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('get_game_leaderboard', {
        p_grade_filter: gameGradeFilter.toString(),
        p_class_id: gameClassFilter.toString()
      });

      if (!rpcErr && rpcRes && rpcRes.success) {
        setGameStudents(rpcRes.leaderboard || []);
        return;
      }

      // 2. Dự phòng truy vấn dữ liệu từ client nếu RPC chưa nạp trên CSDL Supabase
      let resultStudents = [];
      if (gameClassFilter !== 'ALL_IN_GRADE') {
        if (userProfile?.role === 'teacher') {
          const isManaged = userMyClasses.some(c => c.id === gameClassFilter);
          if (!isManaged) {
            setGameStudents([]);
            setLoadingGame(false);
            return;
          }
        }

        const { data: members } = await supabase
          .from('class_members')
          .select('student_id, class_id, profiles!inner(*), classes!inner(name, grade_level)')
          .eq('class_id', gameClassFilter)
          .eq('profiles.role', 'student');

        resultStudents = (members || []).map(m => ({
          ...m.profiles,
          class_name: m.classes?.name,
          grade_level: m.classes?.grade_level || m.profiles?.grade_level
        })).sort((a, b) => (b.total_stars || 0) - (a.total_stars || 0) || (b.total_coins || 0) - (a.total_coins || 0));

      } else {
        let query = supabase
          .from('profiles')
          .select('*')
          .eq('role', 'student')
          .order('total_stars', { ascending: false })
          .order('total_coins', { ascending: false })
          .limit(30);

        if (gameGradeFilter !== 'ALL') {
          query = query.eq('grade_level', parseInt(gameGradeFilter));
        }

        const { data: profiles } = await query;

        if (profiles && profiles.length > 0) {
          const studentIds = profiles.map(p => p.id);
          const { data: members } = await supabase
            .from('class_members')
            .select('student_id, classes(name)')
            .in('student_id', studentIds);

          const studentClassMap = {};
          (members || []).forEach(m => {
            if (m.classes?.name) studentClassMap[m.student_id] = m.classes.name;
          });

          resultStudents = profiles.map(p => ({
            ...p,
            class_name: studentClassMap[p.id] || null
          }));
        }
      }

      setGameStudents(resultStudents);
    } catch (err) {
      console.error('Fetch game leaderboard error:', err);
    } finally {
      setLoadingGame(false);
    }
  };

  // 4. FETCH BẢNG XẾP HẠNG HỌC THUẬT (GIỮ NGUYÊN 100% CÔNG THỨC VÀ RPC HỌC THUẬT)
  useEffect(() => {
    if (activeTab === 'academic' && selectedAcademicClassId) {
      fetchAcademicLeaderboard();
    }
  }, [activeTab, selectedAcademicClassId, academicSubject, academicTimeRange]);

  const fetchAcademicLeaderboard = async () => {
    if (!selectedAcademicClassId) return;
    setLoadingAcademic(true);
    setAcademicError('');

    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('get_academic_class_leaderboard', {
        p_class_id: selectedAcademicClassId,
        p_time_range: academicTimeRange,
        p_subject: academicSubject
      });

      if (rpcErr) {
        let errMsg = rpcErr.message || 'Lỗi hệ thống khi tải bảng xếp hạng.';
        if (errMsg.includes('function') || rpcErr.code === 'PGRST202') {
          errMsg = '❌ CSDL chưa nạp RPC [get_academic_class_leaderboard]. Vui lòng chạy file ADD_ACADEMIC_CLASS_LEADERBOARD.sql trong Supabase SQL Editor!';
        }
        setAcademicError(errMsg);
        setAcademicData(null);
      } else if (rpcRes && rpcRes.success) {
        setAcademicData(rpcRes);
      } else {
        setAcademicError(rpcRes?.message || 'Không thể lấy dữ liệu Bảng xếp hạng Học thuật.');
        setAcademicData(null);
      }
    } catch (err) {
      console.error('Fetch academic leaderboard error:', err);
      setAcademicError('Lỗi kết nối: ' + err.message);
    } finally {
      setLoadingAcademic(false);
    }
  };

  const formatClassLabel = (name) => {
    if (!name) return 'Lớp Học';
    if (name.toLowerCase().startsWith('lớp') || name.toLowerCase().startsWith('khối')) return name;
    return `Lớp ${name}`;
  };

  // Danh sách các Khối có sẵn phù hợp với Vai trò người dùng
  const getGameAvailableGrades = () => {
    if (userProfile?.role === 'admin') {
      return ['ALL', 1, 2, 3, 4, 5];
    } else if (userProfile?.role === 'teacher') {
      return [1, 2, 3, 4, 5];
    } else if (userProfile?.role === 'student') {
      // Học sinh chỉ được xem khối của mình (không được xem Toàn trường)
      return [userProfile?.grade_level || 1];
    }
    return [1, 2, 3, 4, 5];
  };

  // Danh sách các Lớp có sẵn theo Khối đã chọn cho Tab Trò chơi
  const getGameClassesForSelectedGrade = () => {
    if (gameGradeFilter === 'ALL') return [];

    const gradeInt = parseInt(gameGradeFilter);
    const classesInGrade = allSystemClasses.filter(c => c.grade_level === gradeInt);

    if (userProfile?.role === 'teacher') {
      // Giáo viên: Chỉ được chọn các lớp do mình phụ trách
      return classesInGrade.filter(c => c.teacher_id === currentUser?.id);
    } else if (userProfile?.role === 'student') {
      // Học sinh: CHỈ ĐƯỢC CHỌN LỚP CỦA CHÍNH MÌNH (không được chọn riêng lớp khác trong cùng khối)
      return userMyClasses.filter(c => c.grade_level === gradeInt);
    }
    // Admin: Được chọn tất cả các lớp trong khối
    return classesInGrade;
  };

  // Tiêu đề động cho Bảng xếp hạng Trò chơi
  const getGameLeaderboardTitle = () => {
    if (gameGradeFilter === 'ALL') {
      return '🎮 Bảng Xếp Hạng Trò Chơi – Toàn Trường';
    }
    if (gameClassFilter === 'ALL_IN_GRADE') {
      return `🎮 Bảng Xếp Hạng Trò Chơi – Khối ${gameGradeFilter} (Tất cả các lớp)`;
    }
    const targetClass = allSystemClasses.find(c => c.id === gameClassFilter);
    return `🎮 Bảng Xếp Hạng Trò Chơi – ${formatClassLabel(targetClass?.name)}`;
  };

  const getRankBadge = (rank, isTied = false) => {
    switch (rank) {
      case 1:
        return (
          <div className="flex flex-col items-center">
            <span className="text-3xl">🥇</span>
            {isTied && <span className="text-[10px] font-black text-amber-700 bg-amber-200 px-1.5 py-0.5 rounded-full">Đồng hạng</span>}
          </div>
        );
      case 2:
        return (
          <div className="flex flex-col items-center">
            <span className="text-3xl">🥈</span>
            {isTied && <span className="text-[10px] font-black text-slate-700 bg-slate-200 px-1.5 py-0.5 rounded-full">Đồng hạng</span>}
          </div>
        );
      case 3:
        return (
          <div className="flex flex-col items-center">
            <span className="text-3xl">🥉</span>
            {isTied && <span className="text-[10px] font-black text-orange-700 bg-orange-200 px-1.5 py-0.5 rounded-full">Đồng hạng</span>}
          </div>
        );
      default:
        return (
          <div className="flex flex-col items-center">
            <span className="w-8 h-8 rounded-full bg-amber-100 border-2 border-amber-300 flex items-center justify-center font-black text-amber-900 text-sm">
              {rank}
            </span>
            {isTied && <span className="text-[9px] font-black text-slate-600 bg-slate-100 px-1 py-0.2 rounded-full mt-0.5">Đồng hạng</span>}
          </div>
        );
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      
      {/* HEADER BẢNG XẾP HẠNG VỚI TAB CHUYỂN ĐỔI CHẾ ĐỘ */}
      <div className="bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 rounded-3xl border-4 border-amber-600 p-6 sm:p-8 text-center text-amber-950 shadow-xl mb-8">
        <Trophy className="w-16 h-16 text-amber-900 mx-auto mb-2 animate-bounce" />
        <h1 className="text-3xl font-black">BẢNG XẾP HẠNG VUI HỌC TIỂU HỌC</h1>
        <p className="text-xs sm:text-sm font-bold text-amber-900 mt-1 max-w-md mx-auto">
          Tuyên dương các bé học sinh có điểm số xuất sắc và thành tích thi đua cao nhất!
        </p>

        {/* CHỌN TAB CHẾ ĐỘ: TRÒ CHƠI HOẶC HỌC THUẬT */}
        <div className="mt-6 flex justify-center gap-2 max-w-md mx-auto p-1.5 bg-amber-950/20 backdrop-blur-md rounded-2xl border border-amber-600">
          <button
            type="button"
            onClick={() => { setActiveTab('game'); triggerSound('click'); }}
            className={`flex-1 py-2.5 px-4 rounded-xl font-black text-xs sm:text-sm transition-all flex items-center justify-center gap-2 ${
              activeTab === 'game'
                ? 'bg-amber-950 text-amber-300 shadow-md scale-105'
                : 'text-amber-950 hover:bg-white/20'
            }`}
          >
            <Gamepad2 className="w-4 h-4" /> 🎮 Bảng Xếp Hạng Trò Chơi
          </button>
          
          <button
            type="button"
            onClick={() => { setActiveTab('academic'); triggerSound('click'); }}
            className={`flex-1 py-2.5 px-4 rounded-xl font-black text-xs sm:text-sm transition-all flex items-center justify-center gap-2 ${
              activeTab === 'academic'
                ? 'bg-indigo-950 text-indigo-200 shadow-md scale-105'
                : 'text-amber-950 hover:bg-white/20'
            }`}
          >
            <BookOpen className="w-4 h-4 text-indigo-300" /> 📘 Xếp Hạng Học Thuật (Theo Lớp)
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: BẢNG XẾP HẠNG TRÒ CHƠI (BỘ LỌC PHỤ THUỘC: KHỐI & LỚP)             */}
      {/* ========================================================================= */}
      {activeTab === 'game' && (
        <div className="space-y-6">
          
          {/* BỘ LỌC KHỐI & LỚP CHO TRÒ CHƠI */}
          <div className="bg-amber-50/80 p-5 rounded-3xl border-2 border-amber-200 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-amber-200/60 pb-3">
              <h3 className="text-sm font-black text-amber-950 flex items-center gap-1.5">
                <Gamepad2 className="w-4 h-4 text-amber-600" /> {getGameLeaderboardTitle()}
              </h3>
              <span className="text-[11px] font-bold bg-amber-200 text-amber-950 px-2.5 py-0.5 rounded-full">
                Xếp hạng theo Sao 🌟 & Xu 🪙
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              
              {/* 1. BỘ LỌC KHỐI */}
              <div>
                <label className="block text-xs font-black text-amber-950 mb-1.5 flex items-center gap-1">
                  <Filter className="w-3.5 h-3.5 text-amber-600" /> Chọn Khối Lớp:
                </label>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {getGameAvailableGrades().map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => handleGameGradeChange(g)}
                      className={`px-3 py-1.5 rounded-xl font-black text-xs transition-all ${
                        gameGradeFilter == g
                          ? 'bg-amber-950 text-amber-300 border-2 border-amber-900 shadow-sm'
                          : 'bg-white text-amber-900 hover:bg-amber-100 border border-amber-200'
                      }`}
                    >
                      {g === 'ALL' ? 'Toàn Trường' : `Khối ${g}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* 2. BỘ LỌC LỚP PHỤ THUỘC THEO KHỐI ĐÃ CHỌN */}
              <div>
                <label className="block text-xs font-black text-amber-950 mb-1.5 flex items-center gap-1">
                  <Users className="w-3.5 h-3.5 text-amber-600" /> Chọn Lớp Thuộc Khối:
                </label>

                {gameGradeFilter === 'ALL' ? (
                  <div className="p-2.5 bg-amber-100/60 border border-amber-200 rounded-2xl text-xs font-bold text-amber-900 flex items-center justify-between">
                    <span>Đang xem xếp hạng chung Toàn Trường</span>
                    <span className="text-[10px] text-amber-700 font-extrabold">Tất cả các lớp</span>
                  </div>
                ) : (
                  <select
                    value={gameClassFilter}
                    onChange={(e) => {
                      setGameClassFilter(e.target.value);
                      triggerSound('click');
                    }}
                    className="w-full p-2.5 bg-white border-2 border-amber-300 rounded-2xl font-extrabold text-xs text-amber-950 focus:ring-2 focus:ring-amber-500 focus:outline-none shadow-sm"
                  >
                    <option value="ALL_IN_GRADE">
                      🏫 Tất cả các lớp trong Khối {gameGradeFilter}
                    </option>

                    {getGameClassesForSelectedGrade().map((c) => (
                      <option key={c.id} value={c.id}>
                        📍 {formatClassLabel(c.name)} {c.teacher_id === currentUser?.id ? '(Lớp bạn phụ trách)' : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>

            </div>
          </div>

          {/* DANH SÁCH TOP HỌC SINH TRÒ CHƠI */}
          {loadingGame ? (
            <LoadingSkeleton type="page" />
          ) : gameStudents.length > 0 ? (
            <div className="space-y-3">
              {gameStudents.map((st, idx) => (
                <div
                  key={st.id || idx}
                  className={`p-4 rounded-3xl border-4 transition-all flex items-center justify-between shadow-sm ${
                    idx === 0
                      ? 'bg-gradient-to-r from-amber-100 to-yellow-100 border-amber-400 shadow-md scale-[1.01]'
                      : idx === 1
                      ? 'bg-gradient-to-r from-slate-100 to-slate-200 border-slate-300'
                      : idx === 2
                      ? 'bg-gradient-to-r from-orange-100 to-amber-100 border-orange-300'
                      : 'bg-white border-amber-100 hover:border-amber-300'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 text-center font-black">
                      {getRankBadge(idx + 1)}
                    </div>

                    <img
                      src={st.avatar_url || 'https://api.dicebear.com/7.x/bottts/svg?seed=Pikachu'}
                      alt=""
                      className="w-12 h-12 rounded-2xl border-2 border-amber-300 bg-white shrink-0"
                    />

                    <div>
                      <h4 className="text-base font-black text-slate-800 flex items-center gap-2">
                        {st.full_name || 'Học Sinh'}
                      </h4>

                      {/* KHỦNG HIỂN THỊ CỘT TÊN LỚP NẾU XEM TOÀN KHỐI / TOÀN TRƯỜNG */}
                      <div className="flex items-center gap-2 mt-0.5">
                        {st.class_name ? (
                          <span className="inline-block px-2.5 py-0.5 bg-amber-200 text-amber-950 font-black text-[11px] rounded-lg border border-amber-300">
                            🏫 {formatClassLabel(st.class_name)}
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 bg-amber-100 text-amber-900 font-extrabold text-[10px] rounded-lg">
                            Khối {st.grade_level || 1}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-base font-black text-amber-600 flex items-center gap-1 justify-end">
                        <Star className="w-4 h-4 fill-amber-400" /> {st.total_stars || 0} 🌟
                      </p>
                      <p className="text-xs font-bold text-slate-500">{st.total_coins || 0} 🪙 Xu</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 bg-white rounded-3xl border-4 border-amber-200">
              <Award className="w-12 h-12 text-amber-400 mx-auto mb-2" />
              <h3 className="text-lg font-black text-amber-900">Chưa có bảng xếp hạng trò chơi</h3>
              <p className="text-xs font-bold text-slate-500">Hãy là người đầu tiên chơi game để tích lũy Sao Thưởng nhé!</p>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: BẢNG XẾP HẠNG HỌC THUẬT (GIỮ NGUYÊN 100% QUY TẮC & RPC HỌC THUẬT)      */}
      {/* ========================================================================= */}
      {activeTab === 'academic' && (
        <div className="space-y-6">
          
          {/* BỘ LỌC HỌC THUẬT: CHỌN LỚP, MÔN HỌC & KHOẢNG THỜI GIAN */}
          <div className="bg-indigo-50/70 p-5 rounded-3xl border-2 border-indigo-200 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              
              {/* CHỌN LỚP (BẮT BUỘC) */}
              <div>
                <label className="block text-xs font-black text-indigo-950 mb-1 flex items-center gap-1">
                  <Users className="w-3.5 h-3.5 text-indigo-600" /> Lớp Học:
                </label>
                {userProfile?.role === 'student' ? (
                  <div className="p-2.5 bg-white border border-indigo-200 rounded-2xl text-xs font-black text-indigo-900 flex items-center justify-between">
                    <span>🏫 {selectedAcademicClassId ? formatClassLabel(userMyClasses.find(c => c.id === selectedAcademicClassId)?.name) : 'Chưa xếp lớp'}</span>
                    <span className="text-[10px] bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full font-bold">Lớp của bạn</span>
                  </div>
                ) : (
                  <select
                    value={selectedAcademicClassId}
                    onChange={(e) => setSelectedAcademicClassId(e.target.value)}
                    className="w-full p-2.5 bg-white border-2 border-indigo-200 rounded-2xl font-extrabold text-xs text-indigo-950 focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                  >
                    {userMyClasses.length === 0 ? (
                      <option value="">Chưa có lớp nào</option>
                    ) : (
                      userMyClasses.map(c => (
                        <option key={c.id} value={c.id}>
                          🏫 {formatClassLabel(c.name)} (Khối {c.grade_level})
                        </option>
                      ))
                    )}
                  </select>
                )}
              </div>

              {/* MÔN HỌC */}
              <div>
                <label className="block text-xs font-black text-indigo-950 mb-1 flex items-center gap-1">
                  <BookOpen className="w-3.5 h-3.5 text-indigo-600" /> Môn Học:
                </label>
                <select
                  value={academicSubject}
                  onChange={(e) => setAcademicSubject(e.target.value)}
                  className="w-full p-2.5 bg-white border-2 border-indigo-200 rounded-2xl font-extrabold text-xs text-indigo-950 focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                >
                  <option value="ALL">Tất cả môn học</option>
                  <option value="Toán">Toán học 📐</option>
                  <option value="Tiếng Việt">Tiếng Việt 📚</option>
                </select>
              </div>

              {/* KHOẢNG THỜI GIAN */}
              <div>
                <label className="block text-xs font-black text-indigo-950 mb-1 flex items-center gap-1">
                  <Filter className="w-3.5 h-3.5 text-indigo-600" /> Thời Gian:
                </label>
                <select
                  value={academicTimeRange}
                  onChange={(e) => setAcademicTimeRange(e.target.value)}
                  className="w-full p-2.5 bg-white border-2 border-indigo-200 rounded-2xl font-extrabold text-xs text-indigo-950 focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                >
                  <option value="ALL">Tất cả bài tập</option>
                  <option value="MONTH">Tháng này 📅</option>
                  <option value="SEMESTER">Học kỳ này 🎓</option>
                </select>
              </div>

            </div>

            {/* THÔNG TIN TÓM TẮT ĐIỀU KIỆN XẾP HẠNG HỌC THUẬT */}
            <div className="p-3 bg-white/80 rounded-2xl border border-indigo-100 text-[11px] text-indigo-900 font-bold flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
              <span>
                <strong>Quy tắc xếp hạng học thuật:</strong> Chỉ tính kết quả các bài tập chính thức được giao cho lớp và có bật tính năng xếp hạng. Điểm xếp hạng = (Tổng điểm tốt nhất / Tổng điểm tối đa các bài được giao) × 100%.
              </span>
            </div>
          </div>

          {/* THÔNG BÁO LỖI NẾU CÓ */}
          {academicError && (
            <div className="p-4 bg-rose-50 border-2 border-rose-200 rounded-3xl text-xs font-black text-rose-800 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
              <span>{academicError}</span>
            </div>
          )}

          {/* DANH SÁCH XẾP HẠNG HỌC THUẬT */}
          {loadingAcademic ? (
            <LoadingSkeleton type="page" />
          ) : !selectedAcademicClassId ? (
            <div className="text-center py-12 bg-white rounded-3xl border-4 border-indigo-200">
              <Users className="w-12 h-12 text-indigo-400 mx-auto mb-2" />
              <h3 className="text-lg font-black text-indigo-900">Vui lòng chọn Lớp học</h3>
              <p className="text-xs font-bold text-slate-500">Vui lòng chọn một lớp cụ thể để xem Bảng xếp hạng Học thuật.</p>
            </div>
          ) : academicData && academicData.leaderboard && academicData.leaderboard.length > 0 ? (
            <div className="space-y-4">
              
              {/* THỐNG KÊ TỔNG THỂ CỦA LỚP */}
              <div className="flex items-center justify-between px-2 text-xs font-black text-indigo-950">
                <span>🏫 {formatClassLabel(academicData.class_info?.class_name)} ({academicData.leaderboard.length} Học sinh)</span>
                <span className="bg-indigo-100 text-indigo-900 px-3 py-1 rounded-xl">
                  Tổng {academicData.total_valid_exercises || 0} bài tập tính xếp hạng (Tối đa {academicData.total_class_max_score || 0} điểm)
                </span>
              </div>

              <div className="space-y-3">
                {academicData.leaderboard.map((item) => (
                  <div
                    key={item.student_id}
                    className={`p-4 rounded-3xl border-4 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm ${
                      item.rank === 1
                        ? 'bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-100 border-amber-400 shadow-md'
                        : item.rank === 2
                        ? 'bg-gradient-to-r from-slate-50 to-slate-100 border-slate-300'
                        : item.rank === 3
                        ? 'bg-gradient-to-r from-orange-50 to-amber-50 border-orange-300'
                        : 'bg-white border-indigo-100 hover:border-indigo-300'
                    }`}
                  >
                    {/* AVATAR VÀ THÔNG TIN HỌC SINH */}
                    <div className="flex items-center gap-3">
                      <div className="w-10 text-center font-black shrink-0">
                        {getRankBadge(item.rank, item.is_tied)}
                      </div>

                      <img
                        src={item.avatar_url || 'https://api.dicebear.com/7.x/bottts/svg?seed=Pikachu'}
                        alt=""
                        className="w-12 h-12 rounded-2xl border-2 border-indigo-200 bg-white shrink-0"
                      />

                      <div>
                        <h4 className="text-base font-black text-slate-800 flex items-center gap-1.5">
                          {item.full_name || 'Học sinh'}
                        </h4>
                        <div className="flex items-center gap-2 mt-0.5 text-[11px] font-bold text-slate-500">
                          <span>Đã làm: <strong className="text-indigo-900">{item.completed_count} / {item.total_valid_count} bài</strong></span>
                          <span>•</span>
                          <span>ĐTB: <strong className="text-emerald-700">{item.avg_score} đ</strong></span>
                        </div>
                      </div>
                    </div>

                    {/* ĐIỂM XẾP HẠNG HỌC THUẬT (%) VỚI PROGRESS BAR */}
                    <div className="flex items-center gap-4 self-end sm:self-auto min-w-[200px] w-full sm:w-auto">
                      <div className="w-full text-right">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-[10px] font-black text-slate-500 uppercase">Điểm Học Thuật</span>
                          <span className="text-lg font-black text-indigo-700">
                            {item.academic_score_pct}%
                          </span>
                        </div>

                        {/* THANH TIẾN TRÌNH PERCENTAGE */}
                        <div className="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden p-0.5 border border-slate-300">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              item.academic_score_pct >= 90
                                ? 'bg-gradient-to-r from-emerald-400 to-teal-500'
                                : item.academic_score_pct >= 70
                                ? 'bg-gradient-to-r from-indigo-400 to-blue-500'
                                : item.academic_score_pct >= 50
                                ? 'bg-gradient-to-r from-amber-400 to-yellow-500'
                                : 'bg-gradient-to-r from-rose-400 to-red-500'
                            }`}
                            style={{ width: `${Math.max(item.academic_score_pct, 4)}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-slate-400 font-bold">
                          Đạt {item.total_earned_score} / {academicData.total_class_max_score} đ
                        </span>
                      </div>
                    </div>

                  </div>
                ))}
              </div>

            </div>
          ) : (
            <div className="text-center py-12 bg-white rounded-3xl border-4 border-indigo-200">
              <Award className="w-12 h-12 text-indigo-400 mx-auto mb-2" />
              <h3 className="text-lg font-black text-indigo-900">Lớp chưa có bài tập tính xếp hạng</h3>
              <p className="text-xs font-bold text-slate-500 max-w-sm mx-auto mt-1">
                Lớp này chưa có bài tập chính thức nào được giao và bật tính năng xếp hạng học thuật.
              </p>
            </div>
          )}

        </div>
      )}

    </div>
  );
};
