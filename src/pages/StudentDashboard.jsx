import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Sparkles, 
  Trophy, 
  Award, 
  BookOpen, 
  Gamepad2, 
  GraduationCap, 
  Plus, 
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

export const StudentDashboard = () => {
  const { profile, refreshProfile } = useAuth();
  const { triggerSound } = useSound();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('library'); // 'library' | 'assignments' | 'badges' | 'history'
  const [selectedGrade, setSelectedGrade] = useState(profile?.grade_level || 1);
  const [selectedSubject, setSelectedSubject] = useState('ALL');
  
  const [games, setGames] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [badges, setBadges] = useState([]);
  const [studentBadges, setStudentBadges] = useState([]);
  const [history, setHistory] = useState([]);
  
  const [classCodeInput, setClassCodeInput] = useState('');
  const [joinMsg, setJoinMsg] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchInitialData();
  }, [selectedGrade, selectedSubject]);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Games
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
        // 2. Fetch Assignments
        const { data: assignData } = await supabase
          .from('assignments')
          .select(`
            id, reward_stars, due_date,
            games:game_id (*),
            classes:class_id (name, code)
          `);
        setAssignments(assignData || []);

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
        setJoinMsg(`🎉 Chúc mừng bé gia nhập thành công lớp ${classData.name}!`);
        setClassCodeInput('');
        fetchInitialData();
      }
    } catch (err) {
      console.error('Join error:', err);
      setJoinMsg('❌ Có lỗi khi gia nhập lớp học.');
    }
  };

  const handlePlayGame = (game) => {
    triggerSound('click');
    navigate(`/play/${game.id}`);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      
      {/* HEADER GÓC HỌC TẬP CÁ NHÂN */}
      <div className="bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-300 rounded-3xl border-4 border-amber-500 p-6 sm:p-8 shadow-lg mb-8 text-amber-950 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <img
            src={profile?.avatar_url || 'https://api.dicebear.com/7.x/bottts/svg?seed=Pikachu'}
            alt="Avatar"
            className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl border-4 border-white bg-white shadow-md"
          />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl sm:text-3xl font-black">{profile?.full_name || 'Học Sinh Vui Học'}</h1>
              <span className="px-3 py-1 bg-amber-950 text-amber-200 text-xs font-black rounded-xl uppercase">
                Khối {profile?.grade_level || 1}
              </span>
            </div>
            <p className="text-xs sm:text-sm font-bold text-amber-900 mt-1">
              🎒 Góc Học Tập Cá Nhân — Tích lũy Sao Thưởng để mở khóa Huy Hiệu!
            </p>
          </div>
        </div>

        {/* KHUNG THỐNG KÊ SAO & XU */}
        <div className="flex items-center gap-4 bg-white/90 backdrop-blur-sm p-4 rounded-2xl border-2 border-amber-500 shadow-inner">
          <div className="text-center px-3 border-r-2 border-amber-200">
            <span className="text-3xl">🌟</span>
            <p className="text-2xl font-black text-amber-900">{profile?.total_stars || 0}</p>
            <span className="text-[10px] font-extrabold text-amber-700 uppercase">Sao Thưởng</span>
          </div>

          <div className="text-center px-3">
            <span className="text-3xl">🪙</span>
            <p className="text-2xl font-black text-amber-900">{profile?.total_coins || 0}</p>
            <span className="text-[10px] font-extrabold text-amber-700 uppercase">Xu Tích Lũy</span>
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
          onClick={() => { setActiveTab('library'); triggerSound('click'); }}
          className={`flex-1 min-w-[120px] py-3 text-xs sm:text-sm font-black rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeTab === 'library'
              ? 'bg-sky-500 text-white shadow-md border-b-4 border-sky-700'
              : 'text-slate-600 hover:bg-amber-50'
          }`}
        >
          <Gamepad2 className="w-4 h-4" /> Kho Game Học Tập ({games.length})
        </button>

        <button
          onClick={() => { setActiveTab('assignments'); triggerSound('click'); }}
          className={`flex-1 min-w-[120px] py-3 text-xs sm:text-sm font-black rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeTab === 'assignments'
              ? 'bg-amber-500 text-white shadow-md border-b-4 border-amber-700'
              : 'text-slate-600 hover:bg-amber-50'
          }`}
        >
          <BookOpen className="w-4 h-4" /> Bài Tập Được Giao ({assignments.length})
        </button>

        <button
          onClick={() => { setActiveTab('badges'); triggerSound('click'); }}
          className={`flex-1 min-w-[120px] py-3 text-xs sm:text-sm font-black rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeTab === 'badges'
              ? 'bg-emerald-500 text-white shadow-md border-b-4 border-emerald-700'
              : 'text-slate-600 hover:bg-amber-50'
          }`}
        >
          <Award className="w-4 h-4" /> Bộ Sưu Tầm Huy Hiệu
        </button>

        <button
          onClick={() => { setActiveTab('history'); triggerSound('click'); }}
          className={`flex-1 min-w-[120px] py-3 text-xs sm:text-sm font-black rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeTab === 'history'
              ? 'bg-purple-500 text-white shadow-md border-b-4 border-purple-700'
              : 'text-slate-600 hover:bg-amber-50'
          }`}
        >
          <Clock className="w-4 h-4" /> Lịch Sử Chơi
        </button>
      </div>

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

      {/* TAB BÀI TẬP ĐƯỢC GIAO */}
      {activeTab === 'assignments' && (
        <div className="space-y-4">
          {assignments.length > 0 ? (
            assignments.map((item) => (
              <div
                key={item.id}
                className="bg-white p-5 rounded-2xl border-3 border-amber-300 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4"
              >
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-amber-100 rounded-2xl border-2 border-amber-300 flex items-center justify-center text-2xl">
                    🎯
                  </div>
                  <div>
                    <h4 className="text-base font-black text-slate-800">{item.games?.title}</h4>
                    <p className="text-xs font-bold text-slate-500">
                      Lớp: <span className="text-amber-700">{item.classes?.name}</span> • Thưởng: <span className="text-amber-600">+{item.reward_stars} 🌟</span>
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => handlePlayGame(item.games)}
                  className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-600 hover:to-green-600 text-white font-black text-xs rounded-xl shadow-md border-b-2 border-emerald-700"
                >
                  Làm Bài Ngay 🚀
                </button>
              </div>
            ))
          ) : (
            <div className="text-center py-12 bg-white rounded-3xl border-4 border-amber-200">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-2" />
              <h3 className="text-lg font-black text-amber-900">Bé đã hoàn thành hết bài tập!</h3>
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
