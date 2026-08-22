import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Sparkles,
  Trophy,
  Award,
  BookOpen,
  Gamepad2,
  GraduationCap,
  CheckCircle2,
  Clock,
  Star,
  Users
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { GameCard } from '../components/games/GameCard';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton';
import { useSound } from '../context/SoundContext';

import { ExerciseListTab } from '../components/dashboard/exercises/ExerciseListTab';

export const StudentDashboard = () => {
  const { profile, refreshProfile } = useAuth();
  const { triggerSound } = useSound();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(() => {
    if (tabParam === 'exercises' || tabParam === 'academic_exercises' || tabParam === 'academic-assignments') return 'academic_exercises';
    if (tabParam === 'learning' || tabParam === 'assignments') return 'assignments';
    if (tabParam === 'badges') return 'badges';
    if (tabParam === 'history') return 'history';
    if (tabParam === 'games' || tabParam === 'library') return 'library';
    return 'library';
  });

  // Tự động đồng bộ tab parameter từ URL cho Học sinh
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'games' || tab === 'library') {
      setActiveTab('library');
    } else if (tab === 'exercises' || tab === 'academic_exercises' || tab === 'academic-assignments') {
      setActiveTab('academic_exercises');
    } else if (tab === 'learning' || tab === 'assignments') {
      setActiveTab('assignments');
    } else if (tab === 'badges') {
      setActiveTab('badges');
    } else if (tab === 'history') {
      setActiveTab('history');
    } else {
      setSearchParams({ tab: 'games' }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const [selectedGrade, setSelectedGrade] = useState(profile?.grade_level || 1);
  const [selectedSubject, setSelectedSubject] = useState('ALL');

  const [games, setGames] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [academicExercises, setAcademicExercises] = useState([]);
  const [badges, setBadges] = useState([]);
  const [studentBadges, setStudentBadges] = useState([]);
  const [history, setHistory] = useState([]);

  const [classCodeInput, setClassCodeInput] = useState('');
  const [joinMsg, setJoinMsg] = useState('');
  const [loading, setLoading] = useState(true);

  // Lắng nghe thay đổi profile?.id để gọi fetchInitialData chính xác khi học sinh đăng nhập
  useEffect(() => {
    fetchInitialData();
  }, [selectedGrade, selectedSubject, profile?.id]);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Games công khai
      let query = supabase.from('games').select('*').eq('is_public', true);
      if (selectedGrade !== 'ALL') {
        query = query.eq('grade_level', parseInt(selectedGrade));
      }
      if (selectedSubject !== 'ALL') {
        query = query.eq('subject', selectedSubject);
      }
      const { data: gamesData } = await query;
      setGames(gamesData || []);

      if (profile?.id) {
        // 2. Fetch Assignments theo đúng các Lớp Học mà Học Sinh này đang tham gia
        const { data: myClassMembers, error: memberErr } = await supabase
          .from('class_members')
          .select('class_id')
          .eq('student_id', profile.id);

        if (memberErr) {
          console.error('Error fetching student class memberships:', memberErr);
        }

        const myClassIds = (myClassMembers || []).map(c => c.class_id);

        let fetchedAssignments = [];
        if (myClassIds.length > 0) {
          const { data: assignData, error: assignErr } = await supabase
            .from('assignments')
            .select(`
              id, reward_stars, due_date, created_at,
              games:game_id (*),
              classes:class_id (
                id, name, code, grade_level, teacher_id,
                profiles:teacher_id (full_name)
              )
            `)
            .in('class_id', myClassIds)
            .eq('status', 'active')
            .order('created_at', { ascending: false });

          if (assignErr) {
            console.error('Error fetching assignments:', assignErr);
          } else if (assignData) {
            fetchedAssignments = assignData;
          }
        }
        setAssignments(fetchedAssignments);

        // 2.1 Fetch Academic Exercises theo các Lớp Học mà Học Sinh này tham gia
        let fetchedAcademicExercises = [];
        let assignedExerciseIds = [];
        if (myClassIds.length > 0) {
          const { data: assignRecords } = await supabase
            .from('academic_exercise_assignments')
            .select('exercise_id')
            .in('class_id', myClassIds);

          assignedExerciseIds = (assignRecords || []).map(a => a.exercise_id).filter(Boolean);
        }

        let exQuery = supabase
          .from('academic_exercises')
          .select('id')
          .eq('status', 'published')
          .order('created_at', { ascending: false });

        const filterConditions = ['is_global.eq.true'];
        if (myClassIds.length > 0) {
          filterConditions.push(`class_id.in.(${myClassIds.join(',')})`);
        }
        if (assignedExerciseIds.length > 0) {
          filterConditions.push(`id.in.(${assignedExerciseIds.join(',')})`);
        }

        exQuery = exQuery.or(filterConditions.join(','));

        const { data: acExData, error: acExErr } = await exQuery;
        if (!acExErr && acExData) {
          const uniqueAcademicExercises = Array.from(new Map(acExData.map(item => [item.id, item])).values());
          fetchedAcademicExercises = uniqueAcademicExercises;
        }
        setAcademicExercises(fetchedAcademicExercises);

        // 3. Fetch Badges & Student Badges
        const { data: allBadges } = await supabase.from('badges').select('*');
        const { data: myBadges } = await supabase
          .from('student_badges')
          .select('badge_id')
          .eq('student_id', profile.id);

        setBadges(allBadges || []);
        setStudentBadges(myBadges?.map(b => b.badge_id) || []);

        // 4. Fetch Progress History
        const { data: historyData } = await supabase
          .from('student_progress')
          .select(`
            *,
            games:game_id (title, subject)
          `)
          .eq('student_id', profile.id)
          .order('completed_at', { ascending: false });

        setHistory(historyData || []);
      }
    } catch (err) {
      console.error('Fetch student dashboard error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Gia nhập Lớp học bằng mã Code từ Giáo viên
  const handleJoinClass = async (e) => {
    e.preventDefault();
    if (!classCodeInput || !profile?.id) return;

    triggerSound('click');
    setJoinMsg('');
    try {
      // 1. Thử gọi RPC join_class_by_code an toàn tuyệt đối
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('join_class_by_code', {
        p_code: classCodeInput.trim()
      });

      if (!rpcErr && rpcRes) {
        if (rpcRes.success) {
          triggerSound('victory');
          setJoinMsg(`🎉 ${rpcRes.message}`);
          setClassCodeInput('');
          fetchInitialData();
        } else {
          setJoinMsg(`❌ ${rpcRes.message}`);
        }
        return;
      }

      // 2. Dự phòng truy vấn bảng trực tiếp nếu RPC chưa được khởi tạo
      const { data: classData, error: classErr } = await supabase
        .from('classes')
        .select('id, name')
        .eq('code', classCodeInput.trim().toUpperCase())
        .single();

      if (classErr || !classData) {
        setJoinMsg('❌ Mã lớp không tồn tại. Bé kiểm tra lại nhé!');
        return;
      }

      const { error: joinErr } = await supabase
        .from('class_members')
        .insert({
          class_id: classData.id,
          student_id: profile.id
        });

      if (joinErr && joinErr.code === '23505') {
        setJoinMsg(`ℹ️ Bé đã gia nhập lớp ${classData.name} trước đó rồi!`);
      } else if (joinErr) {
        throw joinErr;
      } else {
        triggerSound('victory');
        setJoinMsg(`🎉 Chúc mừng bé đã gia nhập lớp ${classData.name} thành công!`);
        setClassCodeInput('');
        fetchInitialData();
      }
    } catch (err) {
      console.error('Join class error:', err);
      setJoinMsg('Lỗi khi gia nhập lớp học.');
    }
  };

  const handlePlayGame = (game, assignmentId = null) => {
    triggerSound('click');
    navigate(`/play/${game.id}`, { state: { assignmentId } });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

      {/* BANNER NỀN BỐ CỤC CHUẨN ĐẸP CÂN ĐỐI NẰM DƯỚI LỐI ĐI SÂN TRƯỜNG */}
      <div className="relative overflow-hidden rounded-3xl border-4 border-amber-400 shadow-xl mb-8 h-[220px] sm:h-[260px]">
        {/* 1. ẢNH NỀN BANNER CHÍNH THỨC DÙNG CHUNG */}
        <img
          src="/images/student_banner.png"
          alt="Student Banner Background"
          className="absolute inset-0 w-full h-full object-cover object-center"
        />

        {/* 2. OVERLAY LỚP PHỦ MỊN */}
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/25 via-transparent to-slate-950/20 pointer-events-none" />

        {/* 3. KHUNG SAO THƯỞNG & XU TÍCH LŨY TRÊN BẦU TRỜI GÓC PHẢI */}
        <div className="absolute top-3 right-3 sm:top-4 sm:right-6 z-20 bg-white/95 backdrop-blur-md px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-2xl sm:rounded-3xl border-2 border-amber-300 shadow-2xl text-amber-950 flex items-center gap-2.5 sm:gap-3">
          <div className="text-center px-2 border-r border-amber-200">
            <span className="text-sm sm:text-base drop-shadow-sm">🌟</span>
            <span className="text-xs sm:text-sm font-black text-amber-900 ml-1">{profile?.total_stars || 0}</span>
            <span className="text-[8px] font-black text-amber-700 uppercase block -mt-1">SAO THƯỞNG</span>
          </div>

          <div className="text-center px-2">
            <span className="text-sm sm:text-base drop-shadow-sm">🪙</span>
            <span className="text-xs sm:text-sm font-black text-amber-900 ml-1">{profile?.total_coins || 0}</span>
            <span className="text-[8px] font-black text-amber-700 uppercase block -mt-1">XU TÍCH LŨY</span>
          </div>
        </div>

        {/* 4. KHUNG THÔNG TIN HỌC SINH CÂN ĐỐI DỜI SANG TRÁI (bottom-3 sm:bottom-4 left-[46%] -translate-x-1/2) */}
        <div className="absolute bottom-3 sm:bottom-4 left-[46%] -translate-x-1/2 z-20 w-max max-w-[85%]">
          <div className="flex items-center gap-2.5 bg-slate-900/85 backdrop-blur-md px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-xl sm:rounded-2xl border-2 border-amber-300/90 shadow-2xl">
            <img
              src={profile?.avatar_url || 'https://api.dicebear.com/7.x/bottts/svg?seed=Pikachu'}
              alt="Avatar"
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg border-2 border-white bg-white shadow shrink-0"
            />
            <div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <h1 className="text-[11px] sm:text-xs font-black text-white tracking-tight drop-shadow">
                  {profile?.full_name || 'Học Sinh Vui Học'}
                </h1>
                <span className="px-1.5 py-0.5 bg-amber-400 text-amber-950 text-[9px] font-black rounded uppercase shadow">
                  {profile?.role === 'admin' ? '🛡️ Admin' : profile?.role === 'teacher' ? '👩‍🏫 Giáo viên' : `Khối ${profile?.grade_level || 1}`}
                </span>
              </div>
              <p className="text-[9px] font-extrabold text-amber-200 drop-shadow mt-0.5">
                🎮 Kho Trò Chơi Học Tập Tiểu Học
              </p>
            </div>
          </div>
        </div>

      </div>

      {/* FORM GIA NHẬP LỚP HỌC */}
      <div className="bg-amber-50 rounded-2xl border-2 border-amber-200 p-4 mb-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <GraduationCap className="w-6 h-6 text-amber-600" />
          <div>
            <h4 className="text-sm font-black text-amber-950">Gia Nhập Lớp Học Của Thầy/Cô</h4>
            <p className="text-xs text-amber-800 font-semibold">Nhập Mã Lớp được Thầy/Cô cấp để nhận bài tập trò chơi.</p>
          </div>
        </div>

        <form onSubmit={handleJoinClass} className="flex gap-2 w-full sm:w-auto">
          <input
            type="text"
            placeholder="Mã Lớp (VD: LOP1A)"
            value={classCodeInput}
            onChange={(e) => setClassCodeInput(e.target.value)}
            className="p-2.5 bg-white border-2 border-amber-300 rounded-xl font-black text-xs uppercase w-full sm:w-40 text-slate-800"
          />
          <button
            type="submit"
            className="px-4 py-2.5 bg-sky-500 hover:bg-sky-600 text-white font-black text-xs rounded-xl shadow-md whitespace-nowrap"
          >
            Vào Lớp
          </button>
        </form>
      </div>

      {joinMsg && (
        <div className="mb-6 p-3 bg-white border-2 border-amber-300 text-xs font-bold rounded-xl text-amber-900">
          {joinMsg}
        </div>
      )}

      {/* TABS ĐIỀU HƯỚNG BẢNG ĐIỀU KHIỂN */}
      <div className="flex flex-wrap bg-white p-2 rounded-2xl border-4 border-amber-200 mb-6 gap-2">
        <button
          onClick={() => {
            setActiveTab('library');
            triggerSound('click');
            setSearchParams({ tab: 'games' }, { replace: true });
          }}
          className={`flex-1 min-w-[120px] py-3 text-xs sm:text-sm font-black rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeTab === 'library'
              ? 'bg-sky-500 text-white shadow-md border-b-4 border-sky-700'
              : 'text-slate-600 hover:bg-amber-50'
          }`}
        >
          <Gamepad2 className="w-4 h-4" /> Kho Game Học Tập ({games.length})
        </button>

        <button
          onClick={() => {
            setActiveTab('academic_exercises');
            triggerSound('click');
            setSearchParams({ tab: 'exercises' }, { replace: true });
          }}
          className={`flex-1 min-w-[120px] py-3 text-xs sm:text-sm font-black rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeTab === 'academic_exercises'
              ? 'bg-amber-600 text-white shadow-md border-b-4 border-amber-800'
              : 'text-slate-600 hover:bg-amber-50'
          }`}
        >
          <BookOpen className="w-4 h-4" /> Bài Tập Học Thuật ({academicExercises.length})
        </button>

        <button
          onClick={() => {
            setActiveTab('assignments');
            triggerSound('click');
            setSearchParams({ tab: 'learning' }, { replace: true });
          }}
          className={`flex-1 min-w-[120px] py-3 text-xs sm:text-sm font-black rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeTab === 'assignments'
              ? 'bg-amber-500 text-white shadow-md border-b-4 border-amber-700'
              : 'text-slate-600 hover:bg-amber-50'
          }`}
        >
          <Gamepad2 className="w-4 h-4" /> Trò Chơi Đã Giao ({assignments.length})
        </button>

        <button
          onClick={() => {
            setActiveTab('badges');
            triggerSound('click');
            setSearchParams({ tab: 'badges' }, { replace: true });
          }}
          className={`flex-1 min-w-[120px] py-3 text-xs sm:text-sm font-black rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeTab === 'badges'
              ? 'bg-emerald-500 text-white shadow-md border-b-4 border-emerald-700'
              : 'text-slate-600 hover:bg-amber-50'
          }`}
        >
          <Award className="w-4 h-4" /> Bộ Sưu Tầm Huy Hiệu
        </button>

        <button
          onClick={() => {
            setActiveTab('history');
            triggerSound('click');
            setSearchParams({ tab: 'history' }, { replace: true });
          }}
          className={`flex-1 min-w-[120px] py-3 text-xs sm:text-sm font-black rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeTab === 'history'
              ? 'bg-purple-500 text-white shadow-md border-b-4 border-purple-700'
              : 'text-slate-600 hover:bg-amber-50'
          }`}
        >
          <Clock className="w-4 h-4" /> Lịch Sử Chơi
        </button>
      </div>

      {activeTab === 'academic_exercises' && (
        <ExerciseListTab role="student" onLoaded={setAcademicExercises} />
      )}

      {/* NỘI DUNG THEO TAB */}
      {activeTab === 'library' && (
        <div>
          {/* BỘ LỌC KHỐI & MÔN HỌC */}
          <div className="bg-white p-4 rounded-2xl border-2 border-amber-200 mb-6 flex flex-wrap gap-4 items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-slate-700">Khối Lớp:</span>
              <div className="flex gap-1 flex-wrap">
                {['ALL', 1, 2, 3, 4, 5].map((g) => (
                  <button
                    key={g}
                    onClick={() => { setSelectedGrade(g); triggerSound('click'); }}
                    className={`px-3 py-1.5 rounded-xl font-extrabold text-xs transition-all ${
                      selectedGrade == g
                        ? 'bg-amber-400 text-amber-950 border-2 border-amber-500 shadow-sm'
                        : 'bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100'
                    }`}
                  >
                    {g === 'ALL' ? 'Tất Cả Khối' : `Lớp ${g}`}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-slate-700">Môn Học:</span>
              <select
                value={selectedSubject}
                onChange={(e) => { setSelectedSubject(e.target.value); triggerSound('click'); }}
                className="p-2 bg-amber-50 border-2 border-amber-200 rounded-xl text-xs font-black text-slate-800"
              >
                <option value="ALL">Tất Cả Môn Học</option>
                <option value="Toán">📐 Toán Học</option>
                <option value="Tiếng Việt">📖 Tiếng Việt</option>
                <option value="Tiếng Anh">🇬🇧 Tiếng Anh</option>
                <option value="Tự nhiên & Xã hội">🌱 Tự nhiên & Xã hội</option>
              </select>
            </div>
          </div>

          {/* DANH SÁCH GAME KHO */}
          {loading ? (
            <LoadingSkeleton count={4} />
          ) : games.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {games.map((g) => (
                <GameCard key={g.id} game={g} onPlay={handlePlayGame} />
              ))}
            </div>
          ) : (
            <div className="text-center py-12 bg-white rounded-3xl border-4 border-amber-200">
              <Gamepad2 className="w-12 h-12 text-amber-400 mx-auto mb-2" />
              <h3 className="text-lg font-black text-amber-900">Chưa có trò chơi phù hợp bộ lọc</h3>
              <p className="text-xs font-bold text-slate-500">Bé hãy thử chọn lại Khối lớp hoặc Môn học khác nhé!</p>
            </div>
          )}
        </div>
      )}

      {/* TAB BÀI TẬP ĐƯỢC GIAO THẬT TỪ SUPABASE (AUTH-ASSIGNMENTS) */}
      {activeTab === 'assignments' && (
        <div className="space-y-4 animate-fadeIn">
          {assignments.length > 0 ? (
            assignments.map((item) => {
              const teacherName = item.classes?.profiles?.full_name || 'Giáo viên';
              const className = item.classes?.name || 'Lớp học';
              const gradeLevel = item.games?.grade_level || item.classes?.grade_level || 1;
              const subject = item.games?.subject || 'Học Tập';
              const assignedDate = item.created_at ? new Date(item.created_at).toLocaleDateString('vi-VN') : 'Mới giao';
              const dueDateText = item.due_date ? new Date(item.due_date).toLocaleDateString('vi-VN') : 'Không giới hạn';

              return (
                <div
                  key={item.id}
                  className="bg-white p-5 rounded-3xl border-4 border-amber-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4 hover:border-amber-400 transition-all"
                >
                  <div className="flex items-center gap-4 w-full sm:w-auto">
                    <img
                      src={item.games?.thumbnail_url || 'https://images.unsplash.com/photo-1596495578065-6e0763fa1178?w=500&auto=format&fit=crop&q=60'}
                      alt={item.games?.title}
                      className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl object-cover border-2 border-amber-300 shadow-sm shrink-0"
                    />
                    <div>
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="px-2.5 py-0.5 bg-amber-100 text-amber-900 text-[10px] font-black rounded-lg border border-amber-300">
                          Khối {gradeLevel} • Môn {subject}
                        </span>
                        <span className="px-2.5 py-0.5 bg-sky-100 text-sky-900 text-[10px] font-black rounded-lg border border-sky-300">
                          Lớp: {className}
                        </span>
                      </div>
                      <h4 className="text-base sm:text-lg font-black text-slate-800 line-clamp-1">{item.games?.title}</h4>
                      <p className="text-xs font-bold text-slate-500 mt-0.5">
                        👩‍🏫 Người giao: <span className="text-amber-800 font-extrabold">{teacherName}</span>
                        <span className="mx-1.5">•</span>
                        📅 Ngày giao: <span className="text-slate-700">{assignedDate}</span>
                        <span className="mx-1.5">•</span>
                        ⏳ Hạn: <span className="text-rose-600 font-extrabold">{dueDateText}</span>
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-xs font-black text-amber-600">
                          Thưởng hoàn thành: +{item.reward_stars || 10} 🌟
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handlePlayGame(item.games, item.id)}
                    className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-600 hover:to-green-600 text-white font-black text-xs sm:text-sm rounded-2xl shadow-md border-b-4 border-emerald-700 whitespace-nowrap active:translate-y-0.5 transition-all flex items-center justify-center gap-2"
                  >
                    🚀 LÀM BÀI NGAY
                  </button>
                </div>
              );
            })
          ) : (
            <div className="text-center py-12 bg-white rounded-3xl border-4 border-amber-200">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-2" />
              <h3 className="text-lg font-black text-amber-900">Bé đã hoàn thành hết bài tập được giao!</h3>
              <p className="text-xs font-bold text-slate-500">Bé có thể chơi game tự do ở Kho Trò Chơi nhé.</p>
            </div>
          )}
        </div>
      )}

      {/* TAB BỘ SƯU TẦM HUY HIỆU */}
      {activeTab === 'badges' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {badges.map((badge) => {
            const isUnlocked = studentBadges.includes(badge.id);

            return (
              <div
                key={badge.id}
                className={`p-4 rounded-3xl border-4 text-center transition-all ${
                  isUnlocked
                    ? 'bg-amber-50 border-amber-400 shadow-md'
                    : 'bg-slate-100 border-slate-300 opacity-60 grayscale'
                }`}
              >
                <div className="text-4xl mb-2">{badge.icon_url}</div>
                <h4 className="text-sm font-black text-amber-950 mb-1">{badge.title}</h4>
                <p className="text-[11px] font-bold text-slate-600 mb-2">{badge.description}</p>
                <span className={`inline-block px-2.5 py-0.5 text-[10px] font-black rounded-full border ${
                  isUnlocked ? 'bg-emerald-200 text-emerald-900 border-emerald-300' : 'bg-slate-200 text-slate-600 border-slate-300'
                }`}>
                  {isUnlocked ? '✓ Đã Mở Khóa' : `Cần ${badge.required_stars} 🌟`}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* TAB LỊCH SỬ CHƠI */}
      {activeTab === 'history' && (
        <div className="bg-white rounded-3xl border-4 border-amber-200 overflow-hidden shadow-sm">
          {history.length > 0 ? (
            <table className="w-full text-left text-xs font-bold">
              <thead className="bg-amber-100 text-amber-950 uppercase border-b-2 border-amber-200">
                <tr>
                  <th className="p-3">Tên Trò Chơi</th>
                  <th className="p-3">Điểm Số</th>
                  <th className="p-3">Sao Thưởng</th>
                  <th className="p-3">Thời Gian</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100 text-slate-700">
                {history.map((h) => (
                  <tr key={h.id} className="hover:bg-amber-50">
                    <td className="p-3 font-black text-amber-900">{h.games?.title || 'Game Học Tập'}</td>
                    <td className="p-3 text-sky-600">{h.score} điểm</td>
                    <td className="p-3 text-amber-600">+{h.stars_earned} 🌟</td>
                    <td className="p-3 text-slate-500">{new Date(h.completed_at).toLocaleDateString('vi-VN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center text-slate-500 font-bold">
              Bé chưa có lịch sử chơi game nào. Hãy chọn game để tích lũy sao nhé!
            </div>
          )}
        </div>
      )}

    </div>
  );
};
