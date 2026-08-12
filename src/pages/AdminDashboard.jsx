import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  Users, 
  Gamepad2, 
  GraduationCap, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  Settings,
  BookOpen
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { AddGameModal } from '../components/dashboard/AddGameModal';
import { useSound } from '../context/SoundContext';

export const AdminDashboard = () => {
  const { profile } = useAuth();
  const { triggerSound } = useSound();

  const [stats, setStats] = useState({ users: 0, games: 0, classes: 0 });
  const [usersList, setUsersList] = useState([]);
  const [gamesList, setGamesList] = useState([]);
  const [isAddGameOpen, setIsAddGameOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAdminData();
  }, []);

  const fetchAdminData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Users
      const { data: usersData, count: userCount } = await supabase
        .from('profiles')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      // 2. Fetch Games
      const { data: gamesData, count: gameCount } = await supabase
        .from('games')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      // 3. Fetch Classes
      const { count: classCount } = await supabase
        .from('classes')
        .select('*', { count: 'exact', head: true });

      setUsersList(usersData || []);
      setGamesList(gamesData || []);
      setStats({
        users: userCount || 0,
        games: gameCount || 0,
        classes: classCount || 0
      });
    } catch (err) {
      console.error('Fetch admin data error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteGame = async (gameId) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa game này khỏi kho không?')) return;
    triggerSound('click');
    try {
      await supabase.from('games').delete().eq('id', gameId);
      fetchAdminData();
    } catch (err) {
      console.error('Delete game error:', err);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      
      {/* HEADER ADMIN */}
      <div className="bg-gradient-to-r from-purple-600 to-indigo-700 rounded-3xl border-4 border-purple-800 p-6 sm:p-8 text-white shadow-lg mb-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <span className="px-3 py-1 bg-purple-900 text-purple-200 text-xs font-black rounded-xl uppercase">
            🛡️ Bảng Quản Trị Hệ Thống
          </span>
          <h1 className="text-2xl sm:text-3xl font-black mt-1">Quản Lý Kho Game & Người Dùng</h1>
          <p className="text-xs sm:text-sm font-bold text-purple-100 mt-0.5">
            Hệ thống Quản trị tổng thể Kho Trò Chơi Học Vui Tiểu Học.
          </p>
        </div>

        <button
          onClick={() => { setIsAddGameOpen(true); triggerSound('click'); }}
          className="px-5 py-3 bg-amber-400 hover:bg-amber-300 text-amber-950 font-black text-xs sm:text-sm rounded-2xl border-b-4 border-amber-600 shadow-md flex items-center gap-2 active:translate-y-0.5"
        >
          <Plus className="w-4 h-4" /> Thêm Game Mới Vào Kho
        </button>
      </div>

      {/* THỐNG KÊ TỔNG THỂ */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-10">
        <div className="bg-white p-5 rounded-3xl border-4 border-amber-200 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 bg-sky-100 rounded-2xl border-2 border-sky-300 flex items-center justify-center text-sky-600">
            <Users className="w-8 h-8" />
          </div>
          <div>
            <p className="text-2xl font-black text-slate-800">{stats.users}</p>
            <span className="text-xs font-bold text-slate-500 uppercase">Tổng Người Dùng</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-3xl border-4 border-amber-200 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 bg-emerald-100 rounded-2xl border-2 border-emerald-300 flex items-center justify-center text-emerald-600">
            <Gamepad2 className="w-8 h-8" />
          </div>
          <div>
            <p className="text-2xl font-black text-slate-800">{stats.games}</p>
            <span className="text-xs font-bold text-slate-500 uppercase">Trò Chơi Trong Kho</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-3xl border-4 border-amber-200 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 bg-amber-100 rounded-2xl border-2 border-amber-300 flex items-center justify-center text-amber-600">
            <GraduationCap className="w-8 h-8" />
          </div>
          <div>
            <p className="text-2xl font-black text-slate-800">{stats.classes}</p>
            <span className="text-xs font-bold text-slate-500 uppercase">Lớp Học Đã Tạo</span>
          </div>
        </div>
      </div>

      {/* DUYỆT & QUẢN LÝ KHO GAME */}
      <div className="mb-10">
        <h3 className="text-xl font-black text-slate-800 mb-4 flex items-center gap-2">
          <Gamepad2 className="w-6 h-6 text-sky-600" /> Quản Lý Danh Sách Trò Chơi ({gamesList.length})
        </h3>

        <div className="bg-white rounded-3xl border-4 border-amber-200 overflow-hidden shadow-sm">
          <table className="w-full text-left text-xs font-bold">
            <thead className="bg-amber-100 text-amber-950 uppercase border-b-2 border-amber-200">
              <tr>
                <th className="p-3">Tên Trò Chơi</th>
                <th className="p-3">Loại Game</th>
                <th className="p-3">Khối</th>
                <th className="p-3">Môn Học</th>
                <th className="p-3">Lượt Chơi</th>
                <th className="p-3 text-right">Thao Tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-100 text-slate-700">
              {gamesList.map((g) => (
                <tr key={g.id} className="hover:bg-amber-50">
                  <td className="p-3 font-black text-amber-900">{g.title}</td>
                  <td className="p-3 uppercase text-sky-600">{g.game_type}</td>
                  <td className="p-3">Khối {g.grade_level}</td>
                  <td className="p-3">{g.subject}</td>
                  <td className="p-3 text-amber-600">{g.play_count} lượt</td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => handleDeleteGame(g.id)}
                      className="p-1.5 bg-rose-100 hover:bg-rose-200 text-rose-700 rounded-lg"
                      title="Xóa game"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* QUẢN LÝ NGƯỜI DÙNG */}
      <div>
        <h3 className="text-xl font-black text-slate-800 mb-4 flex items-center gap-2">
          <Users className="w-6 h-6 text-emerald-600" /> Danh Sách Tài Khoản Người Dùng ({usersList.length})
        </h3>

        <div className="bg-white rounded-3xl border-4 border-amber-200 overflow-hidden shadow-sm">
          <table className="w-full text-left text-xs font-bold">
            <thead className="bg-amber-100 text-amber-950 uppercase border-b-2 border-amber-200">
              <tr>
                <th className="p-3">Họ và Tên</th>
                <th className="p-3">Email / Mã</th>
                <th className="p-3">Vai Trò</th>
                <th className="p-3">Khối</th>
                <th className="p-3">Tổng Sao</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-100 text-slate-700">
              {usersList.map((u) => (
                <tr key={u.id} className="hover:bg-amber-50">
                  <td className="p-3 font-black text-slate-800 flex items-center gap-2">
                    <img src={u.avatar_url} alt="" className="w-6 h-6 rounded-full bg-slate-100" />
                    {u.full_name}
                  </td>
                  <td className="p-3 text-slate-500">{u.email}</td>
                  <td className="p-3 uppercase text-purple-700 font-extrabold">{u.role}</td>
                  <td className="p-3">Khối {u.grade_level || 1}</td>
                  <td className="p-3 text-amber-600 font-extrabold">{u.total_stars || 0} 🌟</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AddGameModal
        isOpen={isAddGameOpen}
        onClose={() => setIsAddGameOpen(false)}
        onAdded={() => fetchAdminData()}
      />

    </div>
  );
};
