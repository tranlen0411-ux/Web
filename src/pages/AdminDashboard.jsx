import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  ShieldCheck, 
  Users, 
  Gamepad2, 
  GraduationCap, 
  Plus, 
  Trash2, 
  Edit2, 
  Lock, 
  UserPlus,
  Info,
  KeyRound
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { AddGameModal } from '../components/dashboard/AddGameModal';
import { EditGameModal } from '../components/dashboard/EditGameModal';
import { UserFormModal } from '../components/dashboard/UserFormModal';
import { UserDeleteModal } from '../components/dashboard/UserDeleteModal';
import { StudentPinModal } from '../components/dashboard/StudentPinModal';
import { ParentCodeCell } from '../components/common/ParentCodeCell';
import { useSound } from '../context/SoundContext';

export const AdminDashboard = () => {
  const { profile } = useAuth();
  const { triggerSound } = useSound();
  const [searchParams] = useSearchParams();

  // Xác định tab chủ đạo dựa vào URL param ?tab=games hoặc ?tab=users
  const tabParam = searchParams.get('tab');
  const [activeAdminTab, setActiveAdminTab] = useState(
    tabParam === 'games' ? 'games' : 'users'
  );

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'games' || tab === 'users') {
      setActiveAdminTab(tab);
    }
  }, [searchParams]);

  const [stats, setStats] = useState({ users: 0, games: 0, classes: 0 });
  const [usersList, setUsersList] = useState([]);
  const [gamesList, setGamesList] = useState([]);
  const [loading, setLoading] = useState(true);

  // Trạng thái PIN học sinh (cache boolean true/false theo student.id)
  const [pinStatusMap, setPinStatusMap] = useState({});
  const [userForPin, setUserForPin] = useState(null);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  // Modals state
  const [isAddGameOpen, setIsAddGameOpen] = useState(false);
  const [isEditGameOpen, setIsEditGameOpen] = useState(false);
  const [gameToEdit, setGameToEdit] = useState(null);

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
      // 1. Thống kê tổng số
      const { count: uCount } = await supabase.from('profiles').select('id', { count: 'exact', head: true });
      const { count: gCount } = await supabase.from('games').select('id', { count: 'exact', head: true });
      const { count: cCount } = await supabase.from('classes').select('id', { count: 'exact', head: true });

      setStats({ users: uCount || 0, games: gCount || 0, classes: cCount || 0 });

      // 2. Lấy danh sách người dùng
      const { data: uData } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      const sortedUsers = uData || [];
      setUsersList(sortedUsers);

      // Kiểm tra trạng thái PIN học sinh qua RPC has_student_pin
      const studentUsers = sortedUsers.filter(u => u.role === 'student');
      const pMap = {};
      await Promise.all(
        studentUsers.map(async (st) => {
          try {
            const { data } = await supabase.rpc('has_student_pin', { p_student_id: st.id });
            pMap[st.id] = (data === true);
          } catch (err) {
            pMap[st.id] = false;
          }
        })
      );
      setPinStatusMap(pMap);

      // 3. Lấy danh sách trò chơi
      const { data: gData } = await supabase
        .from('games')
        .select('*')
        .order('created_at', { ascending: false });
      
      setGamesList(gData || []);
    } catch (err) {
      console.error('Fetch admin data error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteGame = async (gameId) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa trò chơi này khỏi kho?')) return;
    
    triggerSound('click');
    try {
      const { error } = await supabase.from('games').delete().eq('id', gameId);
      if (error) throw error;
      fetchAdminData();
    } catch (err) {
      alert('Lỗi khi xóa game: ' + err.message);
    }
  };

  const teachersList = usersList.filter(u => u.role === 'teacher');

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      
      {/* TOAST FEEDBACK NOTIFICATION */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 p-4 bg-emerald-600 text-white font-black text-xs rounded-2xl shadow-2xl animate-bounce flex items-center gap-2">
          <span>✨ {toastMsg}</span>
        </div>
      )}

      {/* HEADER BANNER ADMIN */}
      <div className="bg-gradient-to-r from-slate-900 via-amber-950 to-slate-900 rounded-3xl border-4 border-amber-400 p-6 sm:p-8 text-white shadow-xl mb-8 flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-3 py-1 bg-amber-400 text-amber-950 text-xs font-black rounded-xl uppercase flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> Bảng Quản Trị Hệ Thống High-Security
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black">Học Vui System Administration</h1>
          <p className="text-xs sm:text-sm font-bold text-amber-200 mt-1">
            Quản lý tài khoản, nâng quyền Giáo viên, đặt PIN học sinh, chỉnh sửa trò chơi và theo dõi toàn bộ hệ thống.
          </p>
        </div>

        {/* THỐNG KÊ NHANH */}
        <div className="flex gap-3 text-center">
          <div className="bg-white/10 backdrop-blur-md px-4 py-2.5 rounded-2xl border border-amber-300/30">
            <span className="text-xl font-black text-amber-300 block">{stats.users}</span>
            <span className="text-[10px] font-black text-slate-300 uppercase">Tài Khoản</span>
          </div>
          <div className="bg-white/10 backdrop-blur-md px-4 py-2.5 rounded-2xl border border-amber-300/30">
            <span className="text-xl font-black text-amber-300 block">{stats.games}</span>
            <span className="text-[10px] font-black text-slate-300 uppercase">Trò Chơi</span>
          </div>
          <div className="bg-white/10 backdrop-blur-md px-4 py-2.5 rounded-2xl border border-amber-300/30">
            <span className="text-xl font-black text-amber-300 block">{stats.classes}</span>
            <span className="text-[10px] font-black text-slate-300 uppercase">Lớp Học</span>
          </div>
        </div>
      </div>

      {/* TAB NAVIGATION CHÍNH DÀNH CHO ADMIN */}
      <div className="flex flex-wrap bg-white p-2 rounded-2xl border-4 border-amber-200 mb-8 gap-2">
        <button
          onClick={() => { setActiveAdminTab('users'); triggerSound('click'); }}
          className={`flex-1 min-w-[140px] py-3 text-xs sm:text-sm font-black rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeAdminTab === 'users'
              ? 'bg-amber-500 text-white shadow-md border-b-4 border-amber-700'
              : 'text-slate-600 hover:bg-amber-50'
          }`}
        >
          <Users className="w-4 h-4" /> Quản Lý Người Dùng ({usersList.length})
        </button>

        <button
          onClick={() => { setActiveAdminTab('games'); triggerSound('click'); }}
          className={`flex-1 min-w-[140px] py-3 text-xs sm:text-sm font-black rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeAdminTab === 'games'
              ? 'bg-sky-500 text-white shadow-md border-b-4 border-sky-700'
              : 'text-slate-600 hover:bg-amber-50'
          }`}
        >
          <Gamepad2 className="w-4 h-4" /> Quản Lý Kho Trò Chơi ({gamesList.length})
        </button>
      </div>

      {/* TAB 1: QUẢN LÝ TÀI KHOẢN NGƯỜI DÙNG */}
      {activeAdminTab === 'users' && (
        <div className="mb-10 animate-fadeIn">
          <div className="flex items-center justify-between gap-4 mb-4">
            <h3 className="text-xl font-black text-slate-800 flex items-center gap-2">
              <Users className="w-6 h-6 text-amber-600" /> Danh Sách Tài Khoản Người Dùng ({usersList.length})
            </h3>

            <button
              onClick={() => {
                setUserToEdit(null);
                setIsFormModalOpen(true);
                triggerSound('click');
              }}
              className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs sm:text-sm rounded-2xl border-b-4 border-emerald-700 shadow-md flex items-center gap-2 active:translate-y-0.5"
            >
              <UserPlus className="w-4 h-4" /> + Tạo Tài Khoản Mới
            </button>
          </div>

          <div className="bg-white rounded-3xl border-4 border-amber-200 overflow-hidden shadow-sm overflow-x-auto">
            <table className="w-full text-left text-xs font-bold whitespace-nowrap">
              <thead className="bg-amber-100 text-amber-950 uppercase border-b-2 border-amber-200">
                <tr>
                  <th className="p-3">Họ và Tên</th>
                  <th className="p-3">Email</th>
                  <th className="p-3">Vai Trò</th>
                  <th className="p-3">Mã Tra Cứu PH</th>
                  <th className="p-3">Khối</th>
                  <th className="p-3">Tổng Sao</th>
                  <th className="p-3">Trạng Thái</th>
                  <th className="p-3 text-right">Thao Tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100 text-slate-700">
                {usersList.map((u) => {
                  const isSelf = u.id === profile?.id;
                  const isStudent = u.role === 'student';
                  const hasPin = pinStatusMap[u.id] === true;

                  return (
                    <tr key={u.id} className="hover:bg-amber-50">
                      <td className="p-3 font-black text-slate-800">
                        <div className="flex items-center gap-2">
                          <img src={u.avatar_url || 'https://api.dicebear.com/7.x/bottts/svg?seed=Pikachu'} alt="" className="w-7 h-7 rounded-full bg-slate-100 border border-amber-300" />
                          <span>{u.full_name}</span>
                          {isSelf && (
                            <span className="px-1.5 py-0.5 bg-amber-400 text-amber-950 text-[9px] font-black rounded uppercase">Bạn</span>
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

                      <td className="p-3">
                        {isStudent ? (
                          <ParentCodeCell code={u.parent_access_code} />
                        ) : (
                          <span className="text-slate-300 font-normal">—</span>
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
                          {isStudent && (
                            <button
                              onClick={() => {
                                setUserForPin(u);
                                setIsPinModalOpen(true);
                                triggerSound('click');
                              }}
                              className={`p-1.5 rounded-lg transition-colors ${
                                hasPin
                                  ? 'bg-amber-100 hover:bg-amber-200 text-amber-800'
                                  : 'bg-yellow-100 hover:bg-yellow-200 text-yellow-800 animate-pulse'
                              }`}
                              title={hasPin ? 'Reset mã PIN' : 'Đặt mã PIN'}
                            >
                              <KeyRound className="w-4 h-4" />
                            </button>
                          )}

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
      )}

      {/* TAB 2: QUẢN LÝ KHO TRÒ CHƠI DÀNH CHO ADMIN */}
      {activeAdminTab === 'games' && (
        <div className="mb-10 animate-fadeIn">
          <div className="flex items-center justify-between gap-4 mb-4">
            <h3 className="text-xl font-black text-slate-800 flex items-center gap-2">
              <Gamepad2 className="w-6 h-6 text-sky-600" /> Quản Lý Danh Sách Trò Chơi Trong Kho ({gamesList.length})
            </h3>

            <button
              onClick={() => { setIsAddGameOpen(true); triggerSound('click'); }}
              className="px-4 py-2.5 bg-sky-500 hover:bg-sky-600 text-white font-black text-xs sm:text-sm rounded-2xl border-b-4 border-sky-700 shadow-md flex items-center gap-2 active:translate-y-0.5"
            >
              <Plus className="w-4 h-4" /> + Thêm Game Mới Vào Kho
            </button>
          </div>

          <div className="bg-white rounded-3xl border-4 border-amber-200 overflow-hidden shadow-sm">
            <table className="w-full text-left text-xs font-bold">
              <thead className="bg-amber-100 text-amber-950 uppercase border-b-2 border-amber-200">
                <tr>
                  <th className="p-3">Hình Ảnh & Tên Trò Chơi</th>
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
                    <td className="p-3 font-black text-amber-900 flex items-center gap-3">
                      <img
                        src={g.thumbnail_url || 'https://images.unsplash.com/photo-1606326608606-aa0b62935f2b?w=500&auto=format&fit=crop&q=60'}
                        alt=""
                        className="w-10 h-10 rounded-xl object-cover border border-amber-300 shrink-0"
                      />
                      <span>{g.title}</span>
                    </td>
                    <td className="p-3 uppercase text-sky-600">{g.game_type}</td>
                    <td className="p-3">Khối {g.grade_level}</td>
                    <td className="p-3">{g.subject}</td>
                    <td className="p-3 text-amber-600">{g.play_count || 0} lượt</td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => {
                            setGameToEdit(g);
                            setIsEditGameOpen(true);
                            triggerSound('click');
                          }}
                          className="p-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg transition-colors"
                          title="Sửa trò chơi & thay ảnh"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => handleDeleteGame(g.id)}
                          className="p-1.5 bg-rose-100 hover:bg-rose-200 text-rose-700 rounded-lg transition-colors"
                          title="Xóa game"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODALS */}
      <AddGameModal
        isOpen={isAddGameOpen}
        onClose={() => setIsAddGameOpen(false)}
        onAdded={() => fetchAdminData()}
      />

      <EditGameModal
        isOpen={isEditGameOpen}
        onClose={() => setIsEditGameOpen(false)}
        gameToEdit={gameToEdit}
        onSaved={() => fetchAdminData()}
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

      <StudentPinModal
        isOpen={isPinModalOpen}
        onClose={() => setIsPinModalOpen(false)}
        student={userForPin}
        onSuccess={(studentId) => {
          setPinStatusMap(prev => ({ ...prev, [studentId]: true }));
          const isReset = pinStatusMap[studentId] === true;
          setToastMsg(isReset ? 'Đã reset mã PIN cho học sinh.' : 'Đã đặt mã PIN cho học sinh.');
          setTimeout(() => setToastMsg(''), 3500);
        }}
      />

    </div>
  );
};
