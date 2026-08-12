import React, { useState, useEffect } from 'react';
import { 
  GraduationCap, 
  Plus, 
  Users, 
  Gamepad2, 
  Award, 
  BarChart2, 
  CheckCircle2, 
  Copy,
  BookOpen
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ClassManageModal } from '../components/dashboard/ClassManageModal';
import { AssignGameModal } from '../components/dashboard/AssignGameModal';
import { AddGameModal } from '../components/dashboard/AddGameModal';
import { useSound } from '../context/SoundContext';

export const TeacherDashboard = () => {
  const { profile } = useAuth();
  const { triggerSound } = useSound();

  const [classes, setClasses] = useState([]);
  const [games, setGames] = useState([]);
  const [studentProgressList, setStudentProgressList] = useState([]);
  
  const [isClassModalOpen, setIsClassModalOpen] = useState(false);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [isAddGameModalOpen, setIsAddGameModalOpen] = useState(false);
  const [selectedGameForAssign, setSelectedGameForAssign] = useState(null);
  
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile?.id) {
      fetchTeacherData();
    }
  }, [profile?.id]);

  const fetchTeacherData = async () => {
    setLoading(true);
    try {
      // 1. Lấy danh sách lớp học của giáo viên
      const { data: classData } = await supabase
        .from('classes')
        .select('*')
        .eq('teacher_id', profile.id);
      
      setClasses(classData || []);

      // 2. Lấy kho game công khai và game do GV đóng góp
      const { data: gameData } = await supabase
        .from('games')
        .select('*')
        .order('created_at', { ascending: false });
      
      setGames(gameData || []);

      // 3. Lấy tiến độ làm bài của học sinh
      const { data: progressData } = await supabase
        .from('student_progress')
        .select(`
          *,
          profiles:student_id (full_name, email, grade_level, total_stars),
          games:game_id (title, subject)
        `)
        .order('completed_at', { ascending: false })
        .limit(20);

      setStudentProgressList(progressData || []);
    } catch (err) {
      console.error('Fetch teacher dashboard error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAssignModal = (game) => {
    triggerSound('click');
    setSelectedGameForAssign(game);
    setIsAssignModalOpen(true);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      
      {/* HEADER BANNER GIÁO VIÊN */}
      <div className="bg-gradient-to-r from-emerald-500 to-green-600 rounded-3xl border-4 border-emerald-700 p-6 sm:p-8 text-white shadow-lg mb-8 flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-3 py-1 bg-emerald-800 text-emerald-200 text-xs font-black rounded-xl uppercase">
              👩‍🏫 Bảng Quản Lý Giảng Dạy
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black">{profile?.full_name || 'Giáo Viên Tiểu Học'}</h1>
          <p className="text-xs sm:text-sm font-bold text-emerald-100 mt-1">
            Quản lý Lớp học, tạo bài tập trò chơi tương tác và xem báo cáo tiến độ học sinh.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => { setIsClassModalOpen(true); triggerSound('click'); }}
            className="px-5 py-3 bg-amber-400 hover:bg-amber-300 text-amber-950 font-black text-xs sm:text-sm rounded-2xl border-b-4 border-amber-600 shadow-md flex items-center gap-2 active:translate-y-0.5 transition-all"
          >
            <Plus className="w-4 h-4" /> Tạo Lớp Học Mới
          </button>

          <button
            onClick={() => { setIsAddGameModalOpen(true); triggerSound('click'); }}
            className="px-5 py-3 bg-white text-emerald-900 hover:bg-emerald-50 font-black text-xs sm:text-sm rounded-2xl border-b-4 border-emerald-200 shadow-md flex items-center gap-2 active:translate-y-0.5 transition-all"
          >
            <Gamepad2 className="w-4 h-4 text-emerald-600" /> Thêm Trò Chơi Mới
          </button>
        </div>
      </div>

      {/* DANH SÁCH LỚP HỌC */}
      <div className="mb-10">
        <h3 className="text-xl font-black text-slate-800 mb-4 flex items-center gap-2">
          <GraduationCap className="w-6 h-6 text-emerald-600" /> Danh Sách Lớp Học Do Thầy/Cô Quản Lý ({classes.length})
        </h3>

        {classes.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
            {classes.map((cls) => (
              <div key={cls.id} className="bg-white p-5 rounded-3xl border-4 border-amber-200 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="px-3 py-1 bg-amber-100 text-amber-900 text-xs font-black rounded-xl border border-amber-300">
                      Khối {cls.grade_level}
                    </span>
                    <span className="text-xs font-extrabold text-slate-400">Tạo mới</span>
                  </div>
                  <h4 className="text-lg font-black text-slate-800 mb-2">{cls.name}</h4>
                  <div className="bg-amber-50 p-2.5 rounded-2xl border border-amber-200 flex items-center justify-between text-xs font-bold mb-4">
                    <span className="text-slate-600">Mã Lớp Học:</span>
                    <span className="font-black text-sky-600 text-sm tracking-wider">{cls.code}</span>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-slate-500">
                  <span className="flex items-center gap-1"><Users className="w-4 h-4 text-amber-500" /> Học Sinh</span>
                  <span className="text-emerald-600 font-black">Hoạt Động</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 bg-white rounded-3xl border-4 border-amber-200">
            <GraduationCap className="w-12 h-12 text-amber-400 mx-auto mb-2" />
            <h4 className="text-base font-black text-amber-900">Thầy/Cô chưa tạo lớp học nào</h4>
            <p className="text-xs font-bold text-slate-500 mb-3">Tạo lớp học để học sinh gia nhập và làm bài tập nhé!</p>
            <button
              onClick={() => setIsClassModalOpen(true)}
              className="px-4 py-2 bg-amber-400 text-amber-950 font-black text-xs rounded-xl shadow-md"
            >
              + Tạo Lớp Học Ngay
            </button>
          </div>
        )}
      </div>

      {/* KHO GAME & GIAO BÀI TẬP */}
      <div className="mb-10">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-black text-slate-800 flex items-center gap-2">
            <Gamepad2 className="w-6 h-6 text-sky-600" /> Kho Trò Chơi — Giao Bài Cho Học Sinh
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {games.slice(0, 8).map((game) => (
            <div key={game.id} className="bg-white p-4 rounded-3xl border-4 border-amber-200 shadow-sm flex flex-col justify-between">
              <div>
                <img
                  src={game.thumbnail_url || 'https://images.unsplash.com/photo-1606326608606-aa0b62935f2b?w=500&auto=format&fit=crop&q=60'}
                  alt={game.title}
                  className="w-full h-36 object-cover rounded-2xl border-2 border-amber-100 mb-3"
                />
                <h4 className="text-sm font-black text-slate-800 line-clamp-1">{game.title}</h4>
                <p className="text-[11px] font-bold text-slate-500 mt-0.5 mb-3">Khối {game.grade_level} • Môn {game.subject}</p>
              </div>

              <button
                onClick={() => handleOpenAssignModal(game)}
                className="w-full py-2 bg-amber-400 hover:bg-amber-500 text-amber-950 font-black text-xs rounded-xl border-b-2 border-amber-600 shadow-sm flex items-center justify-center gap-1"
              >
                <BookOpen className="w-3.5 h-3.5" /> Giao Bài Ngay
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* BÁO CÁO TIẾN ĐỘ HỌC SINH */}
      <div>
        <h3 className="text-xl font-black text-slate-800 mb-4 flex items-center gap-2">
          <BarChart2 className="w-6 h-6 text-purple-600" /> Báo Cáo Kết Quả & Tiến Độ Làm Bài Mới Nhất
        </h3>

        <div className="bg-white rounded-3xl border-4 border-amber-200 overflow-hidden shadow-sm">
          {studentProgressList.length > 0 ? (
            <table className="w-full text-left text-xs font-bold">
              <thead className="bg-amber-100 text-amber-950 uppercase border-b-2 border-amber-200">
                <tr>
                  <th className="p-3">Học Sinh</th>
                  <th className="p-3">Khối</th>
                  <th className="p-3">Tên Trò Chơi</th>
                  <th className="p-3">Điểm Số</th>
                  <th className="p-3">Sao Thưởng</th>
                  <th className="p-3">Thời Gian Hoàn Thành</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100 text-slate-700">
                {studentProgressList.map((sp) => (
                  <tr key={sp.id} className="hover:bg-amber-50">
                    <td className="p-3 font-black text-amber-900">{sp.profiles?.full_name || 'Học Sinh'}</td>
                    <td className="p-3">Lớp {sp.profiles?.grade_level || 1}</td>
                    <td className="p-3 text-slate-800">{sp.games?.title || 'Game Học Tập'}</td>
                    <td className="p-3 text-sky-600 font-extrabold">{sp.score} điểm</td>
                    <td className="p-3 text-amber-600 font-extrabold">+{sp.stars_earned} 🌟</td>
                    <td className="p-3 text-slate-500">{new Date(sp.completed_at).toLocaleString('vi-VN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center text-slate-500 font-bold">
              Chưa có dữ liệu tiến độ của học sinh.
            </div>
          )}
        </div>
      </div>

      {/* MODALS */}
      <ClassManageModal
        isOpen={isClassModalOpen}
        onClose={() => setIsClassModalOpen(false)}
        onCreated={() => fetchTeacherData()}
      />

      <AssignGameModal
        isOpen={isAssignModalOpen}
        onClose={() => setIsAssignModalOpen(false)}
        game={selectedGameForAssign}
      />

      <AddGameModal
        isOpen={isAddGameModalOpen}
        onClose={() => setIsAddGameModalOpen(false)}
        onAdded={() => fetchTeacherData()}
      />

    </div>
  );
};
