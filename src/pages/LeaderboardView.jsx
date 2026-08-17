import React, { useState, useEffect } from 'react';
import { Trophy, Medal, Star, Sparkles, Award, BookOpen, Gamepad2, Filter, Users, CheckCircle2, ChevronRight, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton';
import { useSound } from '../context/SoundContext';

export const LeaderboardView = () => {
  const { triggerSound } = useSound();
  
  // Tab chế độ: 'game' (Xếp hạng Trò chơi) | 'academic' (Xếp hạng Học thuật)
  const [activeTab, setActiveTab] = useState('game');

  // --- STATE DÀNH CHO TAB TRÒ CHƠI ---
  const [gameGradeFilter, setGameGradeFilter] = useState('ALL');
  const [gameStudents, setGameStudents] = useState([]);
  const [loadingGame, setLoadingGame] = useState(false);

  // --- STATE DÀNH CHO TAB HỌC THUẬT ---
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [userClasses, setUserClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [academicSubject, setAcademicSubject] = useState('ALL');
  const [academicTimeRange, setAcademicTimeRange] = useState('ALL');
  const [academicData, setAcademicData] = useState(null);
  const [loadingAcademic, setLoadingAcademic] = useState(false);
  const [academicError, setAcademicError] = useState('');

  // 1. Load thông tin User đăng nhập
  useEffect(() => {
    fetchUserProfile();
  }, []);

  const fetchUserProfile = async () => {
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

      // Lấy danh sách lớp phù hợp với vai trò
      if (profile?.role === 'student') {
        const { data: cm } = await supabase
          .from('class_members')
          .select('class_id, classes(*)')
          .eq('student_id', user.id);

        const classes = (cm || []).map(item => item.classes).filter(Boolean);
        setUserClasses(classes);
        if (classes.length > 0) setSelectedClassId(classes[0].id);

      } else if (profile?.role === 'teacher') {
        const { data: classes } = await supabase
          .from('classes')
          .select('*')
          .eq('teacher_id', user.id)
          .order('name');

        setUserClasses(classes || []);
        if (classes && classes.length > 0) setSelectedClassId(classes[0].id);

      } else if (profile?.role === 'admin') {
        const { data: classes } = await supabase
          .from('classes')
          .select('*')
          .order('grade_level', { ascending: true })
          .order('name', { ascending: true });

        setUserClasses(classes || []);
        if (classes && classes.length > 0) setSelectedClassId(classes[0].id);
      }
    } catch (err) {
      console.error('Fetch user profile error:', err);
    }
  };

  // 2. Fetch Leaderboard Trò chơi
  useEffect(() => {
    if (activeTab === 'game') {
      fetchGameLeaderboard();
    }
  }, [activeTab, gameGradeFilter]);

  const fetchGameLeaderboard = async () => {
    setLoadingGame(true);
    try {
      let query = supabase
        .from('profiles')
        .select('*')
        .eq('role', 'student')
        .order('total_stars', { ascending: false })
        .limit(20);

      if (gameGradeFilter !== 'ALL') {
        query = query.eq('grade_level', parseInt(gameGradeFilter));
      }

      const { data } = await query;
      setGameStudents(data || []);
    } catch (err) {
      console.error('Fetch game leaderboard error:', err);
    } finally {
      setLoadingGame(false);
    }
  };

  // 3. Fetch Leaderboard Học thuật
  useEffect(() => {
    if (activeTab === 'academic' && selectedClassId) {
      fetchAcademicLeaderboard();
    }
  }, [activeTab, selectedClassId, academicSubject, academicTimeRange]);

  const fetchAcademicLeaderboard = async () => {
    if (!selectedClassId) return;
    setLoadingAcademic(true);
    setAcademicError('');

    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('get_academic_class_leaderboard', {
        p_class_id: selectedClassId,
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
      {/* TAB 1: BẢNG XẾP HẠNG TRÒ CHƠI (SAO & XU TÍCH LŨY)                         */}
      {/* ========================================================================= */}
      {activeTab === 'game' && (
        <div className="space-y-6">
          {/* LỌC KHỐI LỚP TRÒ CHƠI */}
          <div className="flex justify-center items-center gap-2 flex-wrap bg-amber-50 p-4 rounded-2xl border border-amber-200">
            <span className="text-xs font-black text-amber-900 flex items-center gap-1">
              <Filter className="w-3.5 h-3.5" /> Khối Lớp:
            </span>
            {['ALL', 1, 2, 3, 4, 5].map((g) => (
              <button
                key={g}
                onClick={() => { setGameGradeFilter(g); triggerSound('click'); }}
                className={`px-3.5 py-1.5 rounded-xl font-black text-xs transition-all ${
                  gameGradeFilter == g
                    ? 'bg-amber-950 text-amber-300 border border-amber-900 shadow-sm'
                    : 'bg-white text-amber-900 hover:bg-amber-100 border border-amber-200'
                }`}
              >
                {g === 'ALL' ? 'Toàn Trường' : `Khối ${g}`}
              </button>
            ))}
          </div>

          {/* DANH SÁCH TOP TRÒ CHƠI */}
          {loadingGame ? (
            <LoadingSkeleton type="page" />
          ) : gameStudents.length > 0 ? (
            <div className="space-y-3">
              {gameStudents.map((st, idx) => (
                <div
                  key={st.id || idx}
                  className={`p-4 rounded-3xl border-4 transition-all flex items-center justify-between shadow-sm ${
                    idx === 0
                      ? 'bg-gradient-to-r from-amber-100 to-yellow-100 border-amber-400 shadow-md scale-[1.02]'
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
                      className="w-12 h-12 rounded-2xl border-2 border-amber-300 bg-white"
                    />

                    <div>
                      <h4 className="text-base font-black text-slate-800">{st.full_name || 'Học Sinh'}</h4>
                      <span className="inline-block px-2 py-0.5 bg-amber-200 text-amber-900 font-extrabold text-[10px] rounded-lg">
                        Lớp {st.grade_level || 1}
                      </span>
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
      {/* TAB 2: BẢNG XẾP HẠNG HỌC THUẬT (TÍNH THEO LỚP & ĐIỂM BÀI TẬP CHÍNH THỨC)    */}
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
                    <span>🏫 {selectedClassId ? formatClassLabel(userClasses.find(c => c.id === selectedClassId)?.name) : 'Chưa xếp lớp'}</span>
                    <span className="text-[10px] bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full font-bold">Lớp của bạn</span>
                  </div>
                ) : (
                  <select
                    value={selectedClassId}
                    onChange={(e) => setSelectedClassId(e.target.value)}
                    className="w-full p-2.5 bg-white border-2 border-indigo-200 rounded-2xl font-extrabold text-xs text-indigo-950 focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                  >
                    {userClasses.length === 0 ? (
                      <option value="">Chưa có lớp nào</option>
                    ) : (
                      userClasses.map(c => (
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
          ) : !selectedClassId ? (
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
