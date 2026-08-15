import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  GraduationCap, 
  Plus, 
  Users, 
  Gamepad2, 
  Award, 
  BarChart2, 
  BookOpen,
  Info,
  ShieldCheck,
  KeyRound,
  Edit2,
  RefreshCw,
  Calendar,
  Clock
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ClassManageModal } from '../components/dashboard/ClassManageModal';
import { AssignGameModal } from '../components/dashboard/AssignGameModal';
import { AddGameModal } from '../components/dashboard/AddGameModal';
import { EditGameModal } from '../components/dashboard/EditGameModal';
import { EditAssignmentModal } from '../components/dashboard/EditAssignmentModal';
import { StudentPinModal } from '../components/dashboard/StudentPinModal';
import { ParentCodeCell } from '../components/common/ParentCodeCell';
import { useSound } from '../context/SoundContext';
import { ExerciseListTab } from '../components/dashboard/exercises/ExerciseListTab';

export const TeacherDashboard = () => {
  const { profile } = useAuth();
  const { triggerSound } = useSound();
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(() => {
    if (tabParam === 'exercises') return 'exercises';
    if (tabParam === 'games') return 'games';
    if (tabParam === 'classes') return 'classes';
    return 'classes';
  });

  // Tự động đồng bộ URL query parameter cho Giáo viên
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'games' || tab === 'classes') {
      setActiveTab(tab);
    } else {
      setSearchParams({ tab: 'classes' }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const [classes, setClasses] = useState([]);
  const [games, setGames] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [studentProgressList, setStudentProgressList] = useState([]);
  const [managedStudents, setManagedStudents] = useState([]);
  
  const [isClassModalOpen, setIsClassModalOpen] = useState(false);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [isAddGameModalOpen, setIsAddGameModalOpen] = useState(false);
  const [selectedGameForAssign, setSelectedGameForAssign] = useState(null);

  // Modal Sửa Trò Chơi
  const [isEditGameOpen, setIsEditGameOpen] = useState(false);
  const [gameToEdit, setGameToEdit] = useState(null);

  // Modal Sửa / Thay Bài Giao
  const [isEditAssignOpen, setIsEditAssignOpen] = useState(false);
  const [assignmentToEdit, setAssignmentToEdit] = useState(null);

  // Trạng thái PIN dành cho Giáo viên quản lý
  const [pinStatusMap, setPinStatusMap] = useState({});
  const [userForPin, setUserForPin] = useState(null);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile?.id) {
      fetchTeacherData();
    }
  }, [profile?.id]);

  const fetchTeacherData = async () => {
    setLoading(true);
    try {
      // 1. Lấy danh sách lớp học do Giáo viên quản lý
      const { data: classData } = await supabase
        .from('classes')
        .select('*')
        .eq('teacher_id', profile.id);
      
      setClasses(classData || []);

      const classIds = (classData || []).map(c => c.id);

      // 2. Lấy danh sách Học sinh thuộc các Lớp học do Giáo viên này quản lý
      let studentsInMyClasses = [];
      if (classIds.length > 0) {
        const { data: memberData } = await supabase
          .from('class_members')
          .select(`
            student_id,
            classes:class_id(name, grade_level),
            profiles:student_id(id, full_name, email, grade_level, total_stars, parent_access_code, student_code)
          `)
          .in('class_id', classIds);

        studentsInMyClasses = (memberData || [])
          .map(m => ({
            ...m.profiles,
            className: m.classes?.name,
            classGrade: m.classes?.grade_level
          }))
          .filter(s => s && s.id);
      }
      setManagedStudents(studentsInMyClasses);

      // Kiểm tra trạng thái PIN học sinh thuộc lớp quản lý qua RPC has_student_pin
      const pMap = {};
      await Promise.all(
        studentsInMyClasses.map(async (st) => {
          try {
            const { data } = await supabase.rpc('has_student_pin', { p_student_id: st.id });
            pMap[st.id] = (data === true);
          } catch (err) {
            pMap[st.id] = false;
          }
        })
      );
      setPinStatusMap(pMap);

      // 3. Lấy kho game công khai và game do GV đóng góp
      const { data: gameData } = await supabase
        .from('games')
        .select('*')
        .order('created_at', { ascending: false });
      
      setGames(gameData || []);

      // 4. Lấy danh sách lượt giao bài của các lớp do Giáo viên này phụ trách
      if (classIds.length > 0) {
        const { data: assignData } = await supabase
          .from('assignments')
          .select(`
            *,
            games:game_id (title, subject, grade_level, thumbnail_url),
            classes:class_id (name, grade_level)
          `)
          .in('class_id', classIds)
          .order('created_at', { ascending: false });

        setAssignments(assignData || []);
      } else {
        setAssignments([]);
      }

      // 5. Lấy tiến độ làm bài của học sinh
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

  const showToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3500);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      
      {/* TOAST FEEDBACK NOTIFICATION */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 p-4 bg-emerald-600 text-white font-black text-xs rounded-2xl shadow-2xl animate-bounce flex items-center gap-2">
          <span>✨ {toastMsg}</span>
        </div>
      )}

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
            Quản lý Lớp học, giao bài tập, thay bài giao, chỉnh sửa trò chơi nguồn và quản lý mã PIN học sinh.
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

      {/* TABS CHUYỂN ĐỔI KHU VỰC GIÁO VIÊN */}
      <div className="flex flex-wrap bg-white p-2 rounded-2xl border-4 border-amber-200 mb-8 gap-2">
        <button
          onClick={() => {
            setActiveTab('classes');
            triggerSound('click');
            setSearchParams({ tab: 'classes' }, { replace: true });
          }}
          className={`flex-1 min-w-[140px] py-3 text-xs sm:text-sm font-black rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeTab === 'classes'
              ? 'bg-emerald-500 text-white shadow-md border-b-4 border-emerald-700'
              : 'text-slate-600 hover:bg-amber-50'
          }`}
        >
          <GraduationCap className="w-4 h-4" /> Quản Lý Lớp & Học Sinh ({classes.length})
        </button>

        <button
          onClick={() => {
            setActiveTab('games');
            triggerSound('click');
            setSearchParams({ tab: 'games' }, { replace: true });
          }}
          className={`flex-1 min-w-[140px] py-3 text-xs sm:text-sm font-black rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeTab === 'games'
              ? 'bg-sky-500 text-white shadow-md border-b-4 border-sky-700'
              : 'text-slate-600 hover:bg-amber-50'
          }`}
        >
          <Gamepad2 className="w-4 h-4" /> Kho Trò Chơi & Giao Trò Chơi ({games.length})
        </button>

        <button
          onClick={() => {
            setActiveTab('exercises');
            triggerSound('click');
            setSearchParams({ tab: 'exercises' }, { replace: true });
          }}
          className={`flex-1 min-w-[140px] py-3 text-xs sm:text-sm font-black rounded-xl transition-all flex items-center justify-center gap-2 ${
            activeTab === 'exercises'
              ? 'bg-amber-500 text-white shadow-md border-b-4 border-amber-700'
              : 'text-slate-600 hover:bg-amber-50'
          }`}
        >
          <BookOpen className="w-4 h-4" /> Quản Lý Bài Tập Học Thuật
        </button>
      </div>

      {activeTab === 'exercises' && (
        <ExerciseListTab role="teacher" />
      )}

      {/* KHU VỰC 1: QUẢN LÝ LỚP HỌC & HỌC SINH (tab=classes) */}
      {activeTab === 'classes' && (
        <>
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
                      <span className="flex items-center gap-1"><Users className="w-4 h-4 text-amber-500" /> Học Sinh Trong Lớp</span>
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

          {/* DANH SÁCH HỌC SINH TRONG LỚP & ĐẶT MÃ PIN */}
          <div className="mb-10">
            <h3 className="text-xl font-black text-slate-800 mb-3 flex items-center gap-2">
              <Users className="w-6 h-6 text-purple-600" /> Danh Sách Học Sinh Trong Lớp & Đặt Mã PIN ({managedStudents.length})
            </h3>

            <div className="p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl mb-4 flex items-center gap-2 text-xs font-bold text-amber-900">
              <Info className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                <strong>Mã Tra Cứu Phụ Huynh & Mã PIN:</strong> Thầy/Cô có thể tạo Mã PIN đăng nhập cho học sinh trong lớp để các bé vào học ngay.
              </span>
            </div>

            <div className="bg-white rounded-3xl border-4 border-amber-200 overflow-hidden shadow-sm overflow-x-auto">
              {managedStudents.length > 0 ? (
                <table className="w-full text-left text-xs font-bold whitespace-nowrap">
                  <thead className="bg-amber-100 text-amber-950 uppercase border-b-2 border-amber-200">
                    <tr>
                      <th className="p-3">Tên Học Sinh</th>
                      <th className="p-3">Lớp Học</th>
                      <th className="p-3">Khối</th>
                      <th className="p-3">Tổng Sao</th>
                      <th className="p-3">Mã Tra Cứu PH</th>
                      <th className="p-3 text-right">Thao Tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100 text-slate-700">
                    {managedStudents.map((st) => {
                      const hasPin = pinStatusMap[st.id] === true;
                      return (
                        <tr key={st.id} className="hover:bg-amber-50">
                          <td className="p-3 font-black text-slate-800 flex items-center gap-2">
                            <img src={st.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${st.id}`} alt="" className="w-7 h-7 rounded-full bg-slate-100 border border-amber-300" />
                            <span>{st.full_name}</span>
                          </td>
                          <td className="p-3 text-sky-700 font-extrabold">{st.className || 'Chưa xếp lớp'}</td>
                          <td className="p-3">Khối {st.grade_level || 1}</td>
                          <td className="p-3 text-amber-600 font-extrabold">{st.total_stars || 0} 🌟</td>
                          <td className="p-3">
                            <ParentCodeCell code={st.parent_access_code} />
                          </td>
                          <td className="p-3 text-right">
                            <button
                              onClick={() => {
                                setUserForPin(st);
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
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="p-6 text-center text-slate-500 font-bold">
                  Chưa có học sinh nào gia nhập các lớp học của Thầy/Cô. Thầy/Cô hãy gửi Mã Lớp cho học sinh nhé!
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* KHU VỰC 2: KHO TRÒ CHƠI, THAY BÀI GIAO & BÁO CÁO TIẾN ĐỘ (tab=games) */}
      {activeTab === 'games' && (
        <>
          {/* QUẢN LÝ CÁC LƯỢT GIAO BÀI CHO LỚP CỦA GIÁO VIÊN */}
          <div className="mb-10">
            <h3 className="text-xl font-black text-slate-800 mb-3 flex items-center gap-2">
              <RefreshCw className="w-6 h-6 text-amber-600" /> Danh Sách Lượt Giao Bài & Thay Trò Chơi Đã Giao ({assignments.length})
            </h3>
            
            <div className="bg-white rounded-3xl border-4 border-amber-200 overflow-hidden shadow-sm overflow-x-auto">
              {assignments.length > 0 ? (
                <table className="w-full text-left text-xs font-bold whitespace-nowrap">
                  <thead className="bg-amber-100 text-amber-950 uppercase border-b-2 border-amber-200">
                    <tr>
                      <th className="p-3">Tên Trò Chơi Đã Giao</th>
                      <th className="p-3">Lớp Nhận Bài</th>
                      <th className="p-3">Sao Thưởng</th>
                      <th className="p-3">Hạn Hoàn Thành</th>
                      <th className="p-3">Trạng Thái</th>
                      <th className="p-3 text-right">Thao Tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100 text-slate-700">
                    {assignments.map((asg) => {
                      const isActive = asg.status === 'active' || !asg.status;
                      const isArchived = asg.status === 'archived';
                      const isCancelled = asg.status === 'cancelled';

                      return (
                        <tr key={asg.id} className="hover:bg-amber-50">
                          <td className="p-3 font-black text-amber-950 flex items-center gap-2.5">
                            <img
                              src={asg.games?.thumbnail_url || 'https://images.unsplash.com/photo-1606326608606-aa0b62935f2b?w=500&auto=format&fit=crop&q=60'}
                              alt=""
                              className="w-8 h-8 rounded-lg object-cover border border-amber-300"
                            />
                            <span>{asg.games?.title || 'Trò chơi'}</span>
                          </td>
                          <td className="p-3 text-sky-700 font-black">Lớp {asg.classes?.name}</td>
                          <td className="p-3 text-amber-600 font-black">+{asg.reward_stars} 🌟</td>
                          <td className="p-3 text-slate-500">
                            {asg.due_date ? new Date(asg.due_date).toLocaleDateString('vi-VN') : 'Không hạn'}
                          </td>
                          <td className="p-3">
                            {isActive && (
                              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-extrabold rounded-lg">
                                🟢 Hoạt động
                              </span>
                            )}
                            {isArchived && (
                              <span className="px-2 py-0.5 bg-amber-100 text-amber-800 font-extrabold rounded-lg" title="Bài giao cũ đã thay trò chơi mới (Lịch sử làm bài được lưu giữ)">
                                🟡 Đã lưu trữ
                              </span>
                            )}
                            {isCancelled && (
                              <span className="px-2 py-0.5 bg-rose-100 text-rose-800 font-extrabold rounded-lg" title="Bài giao đã hủy">
                                🔴 Đã hủy
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            {isActive ? (
                              <button
                                onClick={() => {
                                  setAssignmentToEdit(asg);
                                  setIsEditAssignOpen(true);
                                  triggerSound('click');
                                }}
                                className="px-3 py-1.5 bg-sky-100 hover:bg-sky-200 text-sky-800 font-black text-xs rounded-xl flex items-center gap-1 ml-auto"
                                title="Thay trò chơi hoặc sửa hạn bài giao"
                              >
                                <RefreshCw className="w-3.5 h-3.5" /> Thay / Sửa Bài Giao
                              </button>
                            ) : (
                              <span className="text-slate-400 font-bold text-[11px]">Đã lưu vết</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="p-6 text-center text-slate-500 font-bold">
                  Thầy/Cô chưa giao trò chơi nào cho các lớp học. Thử chọn game bên dưới để giao ngay nhé!
                </div>
              )}
            </div>
          </div>

          {/* KHO GAME & GIAO BÀI TẬP */}
          <div className="mb-10">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-black text-slate-800 flex items-center gap-2">
                <Gamepad2 className="w-6 h-6 text-sky-600" /> Kho Trò Chơi — Giao Bài Cho Học Sinh ({games.length})
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {games.map((game) => {
                // Phân quyền: Giáo viên CHỈ ĐƯỢC SỬA trò chơi do chính mình tạo (author_id = profile.id)
                const isAuthor = game.author_id === profile?.id;

                return (
                  <div key={game.id} className="bg-white p-4 rounded-3xl border-4 border-amber-200 shadow-sm flex flex-col justify-between relative group">
                    
                    {/* NÚT SỬA TRÒ CHƠI NGUỒN CHO GIÁO VIÊN TẠO GAME */}
                    {isAuthor && (
                      <button
                        onClick={() => {
                          setGameToEdit(game);
                          setIsEditGameOpen(true);
                          triggerSound('click');
                        }}
                        className="absolute top-2 right-2 p-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl shadow-md border border-amber-600 z-10 transition-transform active:scale-95"
                        title="Sửa trò chơi do Thầy/Cô tạo"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    )}

                    <div>
                      <img
                        src={game.thumbnail_url || 'https://images.unsplash.com/photo-1606326608606-aa0b62935f2b?w=500&auto=format&fit=crop&q=60'}
                        alt={game.title}
                        className="w-full h-36 object-cover rounded-2xl border-2 border-amber-100 mb-3"
                      />
                      <h4 className="text-sm font-black text-slate-800 line-clamp-1">{game.title}</h4>
                      <p className="text-[11px] font-bold text-slate-500 mt-0.5 mb-3">
                        Khối {game.grade_level} • Môn {game.subject} {isAuthor && <span className="text-emerald-600 font-black">(Của tôi)</span>}
                      </p>
                    </div>

                    <button
                      onClick={() => handleOpenAssignModal(game)}
                      className="w-full py-2 bg-amber-400 hover:bg-amber-500 text-amber-950 font-black text-xs rounded-xl border-b-2 border-amber-600 shadow-sm flex items-center justify-center gap-1"
                    >
                      <BookOpen className="w-3.5 h-3.5" /> Giao Bài Ngay
                    </button>
                  </div>
                );
              })}
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
        </>
      )}

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
        onAssigned={() => fetchTeacherData()}
      />

      <AddGameModal
        isOpen={isAddGameModalOpen}
        onClose={() => setIsAddGameModalOpen(false)}
        onAdded={() => fetchTeacherData()}
      />

      {/* MODAL SỬA TRÒ CHƠI DÀNH CHO GIÁO VIÊN TẠO GAME */}
      <EditGameModal
        isOpen={isEditGameOpen}
        onClose={() => setIsEditGameOpen(false)}
        gameToEdit={gameToEdit}
        onSaved={() => fetchTeacherData()}
      />

      {/* MODAL SỬA / THAY BÀI GIAO DÀNH CHO LỚP CỦA GIÁO VIÊN */}
      <EditAssignmentModal
        isOpen={isEditAssignOpen}
        onClose={() => setIsEditAssignOpen(false)}
        assignmentToEdit={assignmentToEdit}
        availableGames={games}
        onSaved={() => {
          fetchTeacherData();
          showToast('Đã cập nhật bài giao thành công!');
        }}
        onDeleted={() => {
          fetchTeacherData();
          showToast('Đã hủy lượt giao bài thành công!');
        }}
      />

      {/* MODAL ĐẶT / RESET MÃ PIN DÀNH CHO HỌC SINH THUỘC LỚP CỦA GIÁO VIÊN */}
      <StudentPinModal
        isOpen={isPinModalOpen}
        onClose={() => setIsPinModalOpen(false)}
        student={userForPin}
        onSuccess={(studentId) => {
          setPinStatusMap(prev => ({ ...prev, [studentId]: true }));
          const isReset = pinStatusMap[studentId] === true;
          showToast(isReset ? 'Đã reset mã PIN cho học sinh.' : 'Đã đặt mã PIN cho học sinh.');
        }}
      />

    </div>
  );
};
