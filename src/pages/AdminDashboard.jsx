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
  BookOpen,
  Edit2,
  Lock,
  UserPlus
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { AddGameModal } from '../components/dashboard/AddGameModal';
import { UserFormModal } from '../components/dashboard/UserFormModal';
import { UserDeleteModal } from '../components/dashboard/UserDeleteModal';
import { useSound } from '../context/SoundContext';

export const AdminDashboard = () => {
  const { profile } = useAuth();
  const { triggerSound } = useSound();

  const [stats, setStats] = useState({ users: 0, games: 0, classes: 0 });
  const [usersList, setUsersList] = useState([]);
  const [gamesList, setGamesList] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [isAddGameOpen, setIsAddGameOpen] = useState(false);
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [userToEdit, setUserToEdit] = useState(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState(null);

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
    } fontally {
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

  const teachersList = usersList.filter(u => u.role === 'teacher');

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

      {/* QUẢN LÝ TÀI KHOẢN NGƯỜI DÙNG */}
      <div className="mb-10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <h3 className="text-xl font-black text-slate-800 flex items-center gap-2">
            <Users className="w-6 h-6 text-emerald-600" /> Danh Sách Tài Khoản Người Dùng ({usersList.length})
          </h3>

          <button
            onClick={() => {
              setUserToEdit(null);
              setIsFormModalOpen(true);
              triggerSound('click');
            }}
            className="px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-black text-xs sm:text-sm rounded-2xl border-b-4 border-purple-800 shadow-md flex items-center gap-2 active:translate-y-0.5 self-start sm:self-auto"
          >
            <UserPlus className="w-4 h-4" /> + Thêm Tài Khoản
          </button>
        </div>

        <div className="bg-white rounded-3xl border-4 border-amber-200 overflow-hidden shadow-sm">
          <table className="w-full text-left text-xs font-bold">
            <thead className="bg-amber-100 text-amber-950 uppercase border-b-2 border-amber-200">
              <tr>
                <th className="p-3">Họ và Tên</th>
                <th className="p-3">Email / Mã</th>
                <th className="p-3">Vai Trò</th>
                <th className="p-3">Khối</th>
                <th className="p-3">Tổng Sao</th>
                <th className="p-3">Trạng Thái</th>
                <th className="p-3 text-right">Thao Tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-100 text-slate-700">
              {usersList.map((u) => {
                const isSelf = u.id === profile?.id;
                return (
                  <tr key={u.id} className="hover:bg-amber-50">
                    <td className="p-3 font-black text-slate-800 flex items-center gap-2">
                      <img src={u.avatar_url} alt="" className="w-7 h-7 rounded-full bg-slate-100 border border-amber-300" />
                      <div>
                        <span>{u.full_name}</span>
                        {isSelf && (
                          <span className="ml-1.5 px-1.5 py-0.5 bg-purple-100 text-purple-700 text-[10px] font-black rounded">
                            (Bạn)
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-slate-500 font-mono">{u.email}</td>
                    <td className="p-3 uppercase">
                      {u.role === 'admin' ? (
                        <span className="px-2 py-0.5 bg-purple-100 text-purple-700 font-black rounded-lg">🛡️ Admin</span>
                      ) : u.role === 'teacher' ? (
                        <span className="px-2 py-0.5 bg-sky-100 text-sky-700 font-black rounded-lg">👩‍🏫 Teacher</span>
                      ) : (
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 font-black rounded-lg">🎓 Student</span>
                      )}
                    </td>
                    <td className="p-3">Khối {u.grade_level || 1}</td>
                    <td className="p-3 text-amber-600 font-extrabold">{u.total_stars || 0} 🌟</td>
                    <td className="p-3">
                      {u.is_disabled ? (
                        <span className="px-2 py-0.5 bg-rose-100 text-rose-700 font-extrabold rounded-lg flex items-center gap-1 w-max">
                          <Lock className="w-3 h-3" /> Đã khóa
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 font-extrabold rounded-lg w-max inline-block">
                          🟢 Hoạt động
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* NÚT SỬA */}
                        <button
                          onClick={() => {
                            setUserToEdit(u);
                            setIsFormModalOpen(true);
                            triggerSound('click');
                          }}
                          className="p-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg transition-colors"
                          title="Sửa thông tin"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>

                        {/* NÚT KHÓA / MỞ KHÓA */}
                        <button
                          disabled={isSelf}
                          onClick={() => {
                            setUserToDelete(u);
                            setIsDeleteModalOpen(true);
                            triggerSound('click');
                          }}
                          className={`p-1.5 rounded-lg transition-colors ${
                            isSelf
                              ? 'opacity-30 cursor-not-allowed bg-slate-100 text-slate-400'
                              : u.is_disabled
                              ? 'bg-emerald-100 hover:bg-emerald-200 text-emerald-700'
                              : 'bg-amber-100 hover:bg-amber-200 text-amber-700'
                          }`}
                          title={isSelf ? 'Không thể tự khóa tài khoản của bạn' : u.is_disabled ? 'Mở khóa tài khoản' : 'Khóa tài khoản'}
                        >
                          <Lock className="w-4 h-4" />
                        </button>

                        {/* NÚT XÓA */}
                        <button
                          disabled={isSelf}
                          onClick={() => {
                            setUserToDelete(u);
                            setIsDeleteModalOpen(true);
                            triggerSound('click');
                          }}
                          className={`p-1.5 rounded-lg transition-colors ${
                            isSelf
                              ? 'opacity-30 cursor-not-allowed bg-slate-100 text-slate-400'
                              : 'bg-rose-100 hover:bg-rose-200 text-rose-700'
                          }`}
                          title={isSelf ? 'Không thể tự xóa tài khoản của bạn' : 'Xóa tài khoản'}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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

      {/* MODALS */}
      <AddGameModal
        isOpen={isAddGameOpen}
        onClose={() => setIsAddGameOpen(false)}
        onAdded={() => fetchAdminData()}
      />

      <UserFormModal
        isOpen={isFormModalOpen}
        onClose={() => setIsFormModalOpen(false)}
        userToEdit={userToEdit}
        onSaved={() => fetchAdminData()}
      />

      <UserDeleteModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        userToDelete={userToDelete}
        teachersList={teachersList}
        onActionCompleted={() => fetchAdminData()}
      />

    </div>
  );
};
